import type { OutboxApi, OutboxEntry } from '../data/DataStore';
import type { Change } from '../engine/types';
import { AuthError, NetworkError, type SyncApi } from './api';
import type { CursorStore } from './cursor';
import { coalesceEntries } from './outbox';
import { pullAll } from './pull';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'auth_required' | 'clock_skew' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Outbox entries not yet on the server. */
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** Beyond this, a pushed row's updatedAt could win conflicts it should lose, so pushes wait for the clock. */
export const MAX_CLOCK_SKEW_MS = 300_000;
/** The server's limit per push. */
export const PUSH_BATCH = 200;

/** How long to wait before retrying after `failures` failed cycles in a row: 2 s doubling, at most a minute. */
export function nextRetryDelayMs(failures: number): number {
  return failures <= 0 ? 0 : Math.min(2000 * 2 ** (failures - 1), 60_000);
}

const rowKey = (table: string, id: string) => table + '\u0000' + id;

/**
 * Moves the outbox to the server and the server's changes here. A cycle pulls, pushes the outbox a batch at
 * a time, then pulls again to pick up what the push changed. Any failure leaves the outbox as it was, so the
 * next cycle sends the same entries again, which the server applies at most once.
 */
export class SyncEngine {
  private status: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: null, lastError: null };
  private readonly listeners = new Set<() => void>();
  private current: Promise<void> | null = null;
  private next: Promise<void> | null = null;
  /** Set by an AuthError; only resume() clears it. */
  private authBlocked = false;
  /** Bumped by resume(), so an AuthError from a cycle that started before a sign-in doesn't block. */
  private authEpoch = 0;
  private countSeq = 0;

  constructor(
    private readonly deps: {
      outbox: OutboxApi;
      api: SyncApi;
      cursor: CursorStore;
      apply(changes: Change[]): Promise<void>;
      now(): number;
    },
  ) {
    deps.outbox.subscribe(() => void this.refreshPending());
    void this.refreshPending();
  }

  /** Runs one cycle. A call while one is running gets a single follow-up cycle, shared by every such call. */
  syncOnce(): Promise<void> {
    if (!this.current) {
      this.current = this.cycle().finally(() => {
        this.current = null;
      });
      return this.current;
    }
    this.next ??= this.current.then(() => {
      this.next = null;
      return this.syncOnce();
    });
    return this.next;
  }

  /** The same object until something changes. */
  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** After a sign-in: lifts `auth_required` and syncs. */
  resume(): void {
    this.authEpoch++;
    this.authBlocked = false;
    if (this.status.phase === 'auth_required') this.update({ phase: 'idle' });
    void this.syncOnce();
  }

  private async cycle(): Promise<void> {
    if (this.authBlocked) return;
    const epoch = this.authEpoch;
    this.update({ phase: 'syncing' });
    let phase: SyncPhase;
    let lastError: string | null = null;
    let synced = false;
    try {
      const { serverTime } = await this.pull();
      if (serverTime !== null && Math.abs(this.deps.now() - Date.parse(serverTime)) > MAX_CLOCK_SKEW_MS) {
        phase = 'clock_skew';
        lastError = 'The device clock is more than 5 minutes off the server clock';
      } else {
        const { pushed, reasons } = await this.pushAll();
        if (pushed) await this.pull();
        phase = 'idle';
        synced = true;
        if (reasons.length > 0) {
          const count = reasons.length === 1 ? '1 change' : `${reasons.length} changes`;
          lastError = `The server turned down ${count}: ${[...new Set(reasons)].join('; ')}`;
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof AuthError) {
        // A sign-in during this cycle means a fresh session is waiting; its follow-up cycle uses it.
        phase = epoch === this.authEpoch ? 'auth_required' : 'error';
        if (phase === 'auth_required') this.authBlocked = true;
      } else {
        phase = err instanceof NetworkError ? 'offline' : 'error';
      }
    }
    await this.refreshPending();
    this.update({
      phase,
      lastError,
      ...(synced ? { lastSyncedAt: new Date(this.deps.now()).toISOString() } : {}),
    });
  }

  private pull() {
    return pullAll({ api: this.deps.api, cursor: this.deps.cursor, apply: this.deps.apply });
  }

  /**
   * Pushes until the outbox is empty, including entries committed meanwhile. Each batch is coalesced to one
   * row per (table, id); an entry is acked only once the server has answered for its row, accepted or
   * rejected. Returns whether anything was sent and the reasons for any rejections.
   */
  private async pushAll(): Promise<{ pushed: boolean; reasons: string[] }> {
    let pushed = false;
    const reasons: string[] = [];
    for (;;) {
      const batch: OutboxEntry[] = await this.deps.outbox.peek(PUSH_BATCH);
      if (batch.length === 0) return { pushed, reasons };
      const { send } = coalesceEntries(batch);
      const result = await this.deps.api.push(send);
      pushed = true;
      const answered = new Set([...result.acked, ...result.rejected.map((r) => r.id)]);
      const done = new Set(send.filter((e) => answered.has(e.id)).map((e) => rowKey(e.table, e.row.id)));
      await this.deps.outbox.ack(batch.filter((e) => done.has(rowKey(e.table, e.rowId))).map((e) => e.id));
      reasons.push(...result.rejected.map((r) => r.reason));
      // Peeking again would send the unanswered entries straight back.
      if (done.size < send.length) {
        throw new Error(`The server did not confirm ${send.length - done.size} of ${send.length} changes`);
      }
    }
  }

  private async refreshPending(): Promise<void> {
    const seq = ++this.countSeq;
    const pending = await this.deps.outbox.count();
    if (seq === this.countSeq && pending !== this.status.pending) this.update({ pending });
  }

  private update(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn();
  }
}
