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
import { applyChanges, emptyState } from '../engine/state';
import type { Change, Ctx, DataState } from '../engine/types';
import type { DataStore } from './DataStore';

/**
 * The app's single source of state. Dispatch is optimistic: memory and subscribers update at once,
 * and writes go to the DataStore one at a time, in dispatch order. Changes a write failed to save
 * ride along with the next write (or `retry`); `lastError` stays set until they are saved.
 */
export class GymStore {
  lastError: Error | null = null;
  private state: DataState = emptyState();
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private unsaved: Change[] = [];

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

  dispatch(changes: Change[]): void {
    if (changes.length === 0) return;
    this.state = applyChanges(this.state, changes);
    this.notify();
    this.save(changes);
  }

  /** Tries again to save the changes earlier writes failed to save. */
  retry(): void {
    this.save([]);
  }

  /** Resolves once every write dispatched so far has settled. */
  whenIdle(): Promise<void> {
    return this.chain;
  }

  private save(changes: readonly Change[]): void {
    this.chain = this.chain.then(async () => {
      const batch = [...this.unsaved, ...changes];
      if (batch.length === 0) return;
      try {
        await this.store.commit(batch);
        this.unsaved = [];
        if (this.lastError) {
          this.lastError = null;
          this.notify();
        }
      } catch (err: unknown) {
        this.unsaved = batch;
        this.lastError = err instanceof Error ? err : new Error(String(err));
        console.warn('GymStore: saving changes failed', err);
        this.notify();
      }
    });
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
