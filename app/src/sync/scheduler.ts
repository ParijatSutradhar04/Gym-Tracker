import type { OutboxApi } from '../data/DataStore';
import { nextRetryDelayMs, type SyncEngine } from './SyncEngine';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** How long after the last of a burst of edits the push waits, so one set's worth of taps is one cycle. */
export const DEBOUNCE_MS = 1500;

/**
 * When to sync: once on start, shortly after edits, on coming back to the foreground, and on a growing delay
 * after a cycle that failed for a reason time can fix. A cycle waiting on a sign-in is not retried.
 */
export function createScheduler(deps: {
  engine: Pick<SyncEngine, 'syncOnce' | 'getStatus'>;
  outbox: Pick<OutboxApi, 'count' | 'subscribe'>;
  timers: Timers;
  debounceMs?: number;
}): { start(): void; stop(): void; onForeground(): void } {
  const { setTimeout: set, clearTimeout: clear } = deps.timers;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let debounce: unknown = null;
  let retry: unknown = null;
  let failures = 0;
  let lastCount: number | null = null;
  let countSeq = 0;
  /** Only the newest run decides whether to retry; older ones finish into the same cycle or an earlier one. */
  let runSeq = 0;

  const clearTimers = () => {
    if (debounce !== null) clear(debounce);
    if (retry !== null) clear(retry);
    debounce = retry = null;
  };

  const run = async () => {
    // The cycle about to run covers whatever those timers were waiting to send.
    clearTimers();
    const seq = ++runSeq;
    await deps.engine.syncOnce();
    if (!started || seq !== runSeq) return;
    const { phase } = deps.engine.getStatus();
    if (phase === 'offline' || phase === 'error') {
      failures++;
      retry = set(() => {
        retry = null;
        void run();
      }, nextRetryDelayMs(failures));
    } else {
      failures = 0;
    }
  };

  const onOutbox = async () => {
    const seq = ++countSeq;
    const count = await deps.outbox.count();
    if (!started || seq !== countSeq) return;
    const rose = lastCount !== null && count > lastCount;
    lastCount = count;
    if (!rose) return;
    if (debounce !== null) clear(debounce);
    debounce = set(() => {
      debounce = null;
      void run();
    }, debounceMs);
  };

  return {
    start() {
      if (started) return;
      started = true;
      unsubscribe = deps.outbox.subscribe(() => void onOutbox());
      void onOutbox();
      void run();
    },
    stop() {
      started = false;
      unsubscribe?.();
      unsubscribe = null;
      clearTimers();
      lastCount = null;
      failures = 0;
    },
    onForeground() {
      if (started) void run();
    },
  };
}
