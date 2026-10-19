import { applyChanges, emptyState, mergeRemote, restampRows, TABLES } from '../engine/state';
import type { BaseRow, Change, DataState, TableName } from '../engine/types';
import { StoreCorruptError, type DataStore, type OutboxApi, type OutboxEntry } from './DataStore';
import type { KeyValueStorage } from './storage';

const PREFIX = 'gt:v1:';
const META_KEY = PREFIX + 'meta';
const ROW_PREFIX = PREFIX + 'row:';
const OB_PREFIX = PREFIX + 'ob:';
const SCHEMA_VERSION = 1;

interface Meta {
  schemaVersion: number;
  outboxSeq: number;
}

/** First character of the id when it is hex (UUIDs always are), otherwise its char code mod 16. */
function bucketOf(id: string): string {
  const c = id.charAt(0).toLowerCase();
  return /[0-9a-f]/.test(c) ? c : (id.charCodeAt(0) % 16).toString(16);
}

const rowKey = (table: TableName, id: string) => `${ROW_PREFIX}${table}:${bucketOf(id)}`;
const obKey = (seq: number) => OB_PREFIX + String(seq).padStart(12, '0');

function parse(key: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new StoreCorruptError(`Unreadable value at ${key}`);
  }
}

/**
 * Rows live in 16 buckets per table (a JSON array each); every outbox entry has its own key.
 * The loaded buckets stay in memory so a commit rewrites only the buckets it touches.
 */
export class LocalStore implements DataStore, OutboxApi {
  private state: DataState = emptyState();
  private buckets = new Map<string, Map<string, BaseRow>>();
  private outbox: OutboxEntry[] = [];
  private outboxSeq = 0;
  private loaded = false;
  private listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly deps: { newId(): string; now(): string },
  ) {}

  async load(): Promise<DataState> {
    const keys = (await this.storage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    const pairs = keys.length ? await this.storage.multiGet([...keys]) : [];
    let state = emptyState();
    const buckets = new Map<string, Map<string, BaseRow>>();
    const outbox: OutboxEntry[] = [];
    let seq = 0;
    for (const [key, raw] of pairs) {
      if (raw === null) continue;
      const value = parse(key, raw);
      if (key === META_KEY) {
        const meta = value as Meta;
        if (typeof meta?.schemaVersion !== 'number' || meta.schemaVersion > SCHEMA_VERSION) {
          throw new StoreCorruptError(`Unsupported schema version at ${key}`);
        }
        seq = Math.max(seq, meta.outboxSeq ?? 0);
      } else if (key.startsWith(ROW_PREFIX)) {
        const table = key.slice(ROW_PREFIX.length).split(':')[0] as TableName;
        if (!TABLES.includes(table) || !Array.isArray(value)) throw new StoreCorruptError(`Bad row bucket at ${key}`);
        const rows = value as BaseRow[];
        buckets.set(key, new Map(rows.map((r) => [r.id, r])));
        state = applyChanges(state, rows.map((row) => ({ table, row }) as Change));
      } else if (key.startsWith(OB_PREFIX)) {
        const entry = value as OutboxEntry;
        if (typeof entry?.seq !== 'number' || !entry.change) throw new StoreCorruptError(`Bad outbox entry at ${key}`);
        outbox.push(entry);
        seq = Math.max(seq, entry.seq);
      }
    }
    this.state = state;
    this.buckets = buckets;
    this.outbox = outbox.sort((a, b) => a.seq - b.seq);
    this.outboxSeq = seq;
    this.loaded = true;
    return state;
  }

  async commit(changes: readonly Change[]): Promise<void> {
    this.ensureLoaded();
    if (changes.length === 0) return;
    let seq = this.outboxSeq;
    const at = this.deps.now();
    const entries = changes.map((change): OutboxEntry => ({
      seq: ++seq,
      id: this.deps.newId(),
      table: change.table,
      rowId: change.row.id,
      change,
      at,
    }));
    await this.write(changes, entries, seq);
    this.notify();
  }

  async applyRemote(changes: readonly Change[]): Promise<void> {
    this.ensureLoaded();
    const { accepted } = mergeRemote(this.state, changes);
    if (accepted.length === 0) return;
    await this.write(accepted, [], this.outboxSeq);
  }

  /**
   * Restamps every stored row stamped after `after` to `now`, and points every outbox entry stamped after
   * `after` at its row's current version, in place and in one write. See GymStore.restamp.
   */
  async restamp(after: string, now: string): Promise<void> {
    this.ensureLoaded();
    const rows = restampRows(this.state, after, now);
    const latest = applyChanges(this.state, rows);
    const rewritten = this.outbox
      .filter((e) => e.change.row.updatedAt > after)
      .map((e): OutboxEntry => {
        const row = (latest[e.table] as Map<string, BaseRow>).get(e.rowId) ?? { ...e.change.row, updatedAt: now };
        return { ...e, change: { table: e.table, row } as Change };
      });
    if (rows.length === 0 && rewritten.length === 0) return;
    await this.write(rows, [], this.outboxSeq, rewritten);
  }

  async peek(limit: number): Promise<OutboxEntry[]> {
    return this.outbox.slice(0, limit);
  }

  async ack(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    const gone = this.outbox.filter((e) => drop.has(e.id));
    if (gone.length === 0) return;
    await this.storage.multiRemove(gone.map((e) => obKey(e.seq)));
    this.outbox = this.outbox.filter((e) => !drop.has(e.id));
    this.notify();
  }

  async count(): Promise<number> {
    return this.outbox.length;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * One multiSet of touched buckets, meta, new outbox keys and `rewritten` entries (same keys, new contents).
   * Memory changes only after it succeeds.
   */
  private async write(changes: readonly Change[], entries: OutboxEntry[], seq: number, rewritten: OutboxEntry[] = []): Promise<void> {
    const touched = new Map<string, Map<string, BaseRow>>();
    for (const c of changes) {
      const key = rowKey(c.table, c.row.id);
      let bucket = touched.get(key);
      if (!bucket) {
        bucket = new Map(this.buckets.get(key));
        touched.set(key, bucket);
      }
      bucket.set(c.row.id, c.row);
    }
    const pairs: [string, string][] = [...touched].map(([key, rows]) => [key, JSON.stringify([...rows.values()])]);
    pairs.push([META_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, outboxSeq: seq } satisfies Meta)]);
    for (const e of [...entries, ...rewritten]) pairs.push([obKey(e.seq), JSON.stringify(e)]);
    await this.storage.multiSet(pairs);
    for (const [key, rows] of touched) this.buckets.set(key, rows);
    this.state = applyChanges(this.state, changes);
    const swap = new Map(rewritten.map((e) => [e.id, e]));
    this.outbox = this.outbox.map((e) => swap.get(e.id) ?? e).concat(entries);
    this.outboxSeq = seq;
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('LocalStore.load() must finish before writing');
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
