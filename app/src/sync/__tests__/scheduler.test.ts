import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createScheduler } from '../scheduler';
import type { SyncPhase, SyncStatus } from '../SyncEngine';

/** A cycle that ends in each of `phases` in turn, then `idle`. Records the fake time of each call. */
function fakeEngine(...phases: SyncPhase[]) {
  let status: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: null, lastError: null };
  const at: number[] = [];
  return {
    at,
    syncOnce: async () => {
      at.push(Date.now());
      status = { ...status, phase: phases.shift() ?? 'idle' };
    },
    getStatus: () => status,
  };
}

function fakeOutbox(count = 0) {
  const listeners = new Set<() => void>();
  const bump = (by: number) => {
    count += by;
    for (const fn of listeners) fn();
  };
  return {
    count: async () => count,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    commit: () => bump(1),
    ack: () => bump(-1),
  };
}

function setup(engine = fakeEngine(), outbox = fakeOutbox()) {
  const scheduler = createScheduler({ engine, outbox, timers: { setTimeout, clearTimeout } });
  return { engine, outbox, scheduler };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createScheduler', () => {
  test('start_runs_one_cycle_immediately', async () => {
    const { engine, scheduler } = setup();
    scheduler.start();
    await settle();
    expect(engine.at).toEqual([0]);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(engine.at).toEqual([0]);
  });

  test('commit_burst_debounces_to_one_cycle_after_1500ms', async () => {
    const { engine, outbox, scheduler } = setup();
    scheduler.start();
    await settle();
    for (let i = 0; i < 5; i++) {
      outbox.commit();
      await vi.advanceTimersByTimeAsync(i < 4 ? 200 : 0);
    }
    // The last commit was at 800 ms.
    await vi.advanceTimersByTimeAsync(800 + 1499 - Date.now());
    expect(engine.at).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);
    expect(engine.at).toEqual([0, 2300]);
  });

  test('ack_does_not_retrigger', async () => {
    const { engine, outbox, scheduler } = setup(fakeEngine(), fakeOutbox(3));
    scheduler.start();
    await settle();
    outbox.ack();
    outbox.ack();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.at).toEqual([0]);
  });

  test('failure_retries_with_backoff_until_success', async () => {
    const { engine, scheduler } = setup(fakeEngine('offline', 'error', 'offline'));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(engine.at).toEqual([0, 2000, 2000 + 4000, 2000 + 4000 + 8000]);
  });

  test('no_retry_while_auth_required', async () => {
    const { engine, scheduler } = setup(fakeEngine('auth_required'));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(engine.at).toEqual([0]);
  });

  test('foreground_runs_immediately', async () => {
    const { engine, scheduler } = setup();
    scheduler.start();
    await settle();
    scheduler.onForeground();
    await settle();
    expect(engine.at).toEqual([0, 0]);
  });

  test('stop_clears_pending_timers', async () => {
    const { engine, outbox, scheduler } = setup(fakeEngine('offline'));
    scheduler.start();
    await settle();
    outbox.commit();
    await settle();
    expect(vi.getTimerCount()).toBe(2);

    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    outbox.commit();
    scheduler.onForeground();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(engine.at).toEqual([0]);
  });

  test('a_cycle_that_finishes_after_stop_schedules_nothing', async () => {
    let finish!: () => void;
    const engine = {
      at: [] as number[],
      syncOnce: () => new Promise<void>((r) => (finish = r)),
      getStatus: (): SyncStatus => ({ phase: 'offline', pending: 1, lastSyncedAt: null, lastError: 'x' }),
    };
    const { scheduler } = setup(engine as never);
    scheduler.start();
    scheduler.stop();
    finish();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});
