import type { DateStr } from '../engine/dates';
import { startBackfill } from '../engine/dayLog';
import {
  addExercise,
  addSchedule,
  changeSchedule,
  deleteExercise,
  renameExercise,
  stopRoutine,
} from '../engine/scheduleEdits';
import { syncSets } from '../engine/sets';
import { restoreShift, shiftToday, skipToday } from '../engine/shift';
import { applyChanges, emptyState, mergeRemote, restampRows } from '../engine/state';
import type { Change, Ctx, DataState } from '../engine/types';
import type { DataStore } from './DataStore';

/**
 * The app's single source of state. Dispatch is optimistic: memory and subscribers update at once,
 * and writes go to the DataStore one at a time, in dispatch order. Changes a write failed to save
 * ride along with the next write (or `retry`); `lastError` stays set until they are saved.
 *
 * Rows pulled from the server come in through `applyRemote`, on the same queue but without outbox
 * entries. While writes are paused (the website offline) dispatch refuses edits; pulls still apply.
 */
export class GymStore {
  lastError: Error | null = null;
  private state: DataState = emptyState();
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private unsaved: Change[] = [];
  private unsavedRemote: Change[] = [];
  private writesPaused = false;

  constructor(
    private readonly store: DataStore,
    private readonly deps: { newId(): string; now(): string },
  ) {}

  async init(): Promise<void> {
    this.state = await this.store.load();
    this.notify();
  }

  getState = (): DataState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  ctx(today: DateStr): Ctx {
    return { today, now: this.deps.now, newId: this.deps.newId };
  }

  /** False, with nothing changed, while writes are paused. */
  dispatch(changes: Change[]): boolean {
    if (this.writesPaused) return false;
    if (changes.length === 0) return true;
    this.state = applyChanges(this.state, changes);
    this.notify();
    this.save(changes);
    return true;
  }

  setWritesPaused(paused: boolean): void {
    this.writesPaused = paused;
  }

  /**
   * Merges server rows last-write-wins against memory, so a pull that raced a local edit can't undo it.
   * Accepted rows show at once and are saved after every write queued before them. Rejects when saving
   * failed, so the caller keeps its cursor; the rows are kept and saved by the next applyRemote or retry.
   */
  applyRemote(changes: Change[]): Promise<void> {
    const { state, accepted } = mergeRemote(this.state, changes);
    if (accepted.length > 0) {
      this.state = state;
      this.notify();
    }
    const saved = this.chain.then(() => this.saveRemote(accepted));
    this.chain = saved.catch(() => {});
    return saved;
  }

  /**
   * Puts every row stamped after `after` to `now`, here and in the store, ignoring last-write-wins: rows a
   * device clock stamped while it ran fast would otherwise beat every edit until real time caught up. A
   * queued change to such a row becomes the row's current version, so whichever copy reaches the server
   * first already holds the last edit. Runs after the writes queued before it; rejects if saving fails.
   */
  restamp(after: string, now: string): Promise<void> {
    const fresh = restampRows(this.state, after, now);
    if (fresh.length > 0) {
      this.state = applyChanges(this.state, fresh);
      this.notify();
    }
    this.unsaved = this.unsaved.map((c) =>
      c.row.updatedAt > after
        ? ({ table: c.table, row: (this.state[c.table] as Map<string, Change['row']>).get(c.row.id) ?? { ...c.row, updatedAt: now } } as Change)
        : c,
    );
    const done = this.chain.then(() => this.store.restamp?.(after, now));
    this.chain = done.catch(() => {});
    return done;
  }

  /** Tries again to save the changes earlier writes failed to save. */
  retry(): void {
    this.save([]);
    this.chain = this.chain.then(() => this.saveRemote([])).catch(() => {});
  }

  /** Resolves once every write dispatched so far has settled. */
  whenIdle(): Promise<void> {
    return this.chain;
  }

  private save(changes: readonly Change[]): void {
    this.chain = this.chain.then(async () => {
      // A failed change that memory has since replaced with a newer row (a later edit, or a server row)
      // is dropped: writing it now would put the older version back on disk.
      const batch = [...this.unsaved.filter((c) => !this.replaced(c)), ...changes];
      if (batch.length === 0) {
        this.unsaved = [];
        this.settled();
        return;
      }
      try {
        await this.store.commit(batch);
        this.unsaved = [];
        this.settled();
      } catch (err: unknown) {
        this.unsaved = batch;
        this.failed(err);
      }
    });
  }

  private async saveRemote(accepted: readonly Change[]): Promise<void> {
    const batch = [...this.unsavedRemote, ...accepted];
    if (batch.length === 0) return;
    try {
      await this.store.applyRemote(batch);
      this.unsavedRemote = [];
      this.settled();
    } catch (err: unknown) {
      this.unsavedRemote = batch;
      this.failed(err);
      throw err;
    }
  }

  private replaced(c: Change): boolean {
    const current = (this.state[c.table] as Map<string, { updatedAt: string }>).get(c.row.id);
    return current !== undefined && current.updatedAt > c.row.updatedAt;
  }

  private settled(): void {
    if (this.lastError && this.unsaved.length === 0 && this.unsavedRemote.length === 0) {
      this.lastError = null;
      this.notify();
    }
  }

  private failed(err: unknown): void {
    this.lastError = err instanceof Error ? err : new Error(String(err));
    console.warn('GymStore: saving changes failed', err);
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

const COMMANDS = {
  addSchedule,
  changeSchedule,
  stopRoutine,
  addExercise,
  renameExercise,
  deleteExercise,
  startBackfill,
  syncSets,
  skipToday,
  shiftToday,
  restoreShift,
};

type Command = (state: DataState, ctx: Ctx, ...args: never[]) => Change[];
type ArgsOf<F> = F extends (state: DataState, ctx: Ctx, ...args: infer A) => Change[] ? A : never;

export type Actions = { [K in keyof typeof COMMANDS]: (...args: ArgsOf<(typeof COMMANDS)[K]>) => void };

/** Each action runs its engine command on the current state with a fresh Ctx and dispatches the result. */
export function createActions(store: GymStore, today: () => DateStr): Actions {
  const actions: Record<string, (...args: never[]) => void> = {};
  for (const [name, command] of Object.entries(COMMANDS) as [string, Command][]) {
    actions[name] = (...args) => store.dispatch(command(store.getState(), store.ctx(today()), ...args));
  }
  return actions as Actions;
}
