import { describe, expect, test, vi } from 'vitest';
import type { Change } from '../../engine/types';
import { createFocusRefresh } from '../focusRefresh';

const T = '2026-10-19T12:00:00.000Z';

const day = (i: number): Change => ({
  table: 'days',
  row: { id: `d${i}`, date: '2026-10-19', updatedAt: T, deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true },
});

/** `fire` stands in for the tab coming back into view; `pulls` holds each pull until resolved or rejected. */
function setup() {
  const listeners = new Set<() => void>();
  const pulls: { resolve(c: Change[]): void; reject(e: Error): void }[] = [];
  const applied: Change[][] = [];
  let online = true;
  const stop = createFocusRefresh({
    pull: () => new Promise<Change[]>((resolve, reject) => pulls.push({ resolve, reject })),
    apply: async (changes) => void applied.push(changes),
    isOnline: () => online,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
  const fire = () => listeners.forEach((fn) => fn());
  return { fire, pulls, applied, stop, listeners, setOnline: (v: boolean) => (online = v) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('createFocusRefresh', () => {
  // A tab left open on a stale day picks up the phone's edits without a reload.
  test('refreshes_when_the_event_fires', async () => {
    const { fire, pulls, applied } = setup();
    expect(pulls).toHaveLength(0);
    fire();
    expect(pulls).toHaveLength(1);
    pulls[0].resolve([day(1)]);
    await settle();
    expect(applied).toEqual([[day(1)]]);
  });

  test('overlapping_events_coalesce_into_one_pull', async () => {
    const { fire, pulls, applied } = setup();
    fire();
    fire();
    fire();
    expect(pulls).toHaveLength(1);
    pulls[0].resolve([day(1)]);
    await settle();
    expect(applied).toHaveLength(1);

    fire();
    expect(pulls).toHaveLength(2);
  });

  test('skips_while_offline', () => {
    const { fire, pulls, setOnline } = setup();
    setOnline(false);
    fire();
    expect(pulls).toHaveLength(0);
    setOnline(true);
    fire();
    expect(pulls).toHaveLength(1);
  });

  test('a_failed_pull_is_swallowed_and_the_next_event_retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fire, pulls, applied } = setup();
    fire();
    pulls[0].reject(new Error('Could not reach the server'));
    await settle();
    expect(applied).toEqual([]);
    expect(warn).toHaveBeenCalled();

    fire();
    expect(pulls).toHaveLength(2);
    pulls[1].resolve([day(2)]);
    await settle();
    expect(applied).toEqual([[day(2)]]);
    warn.mockRestore();
  });

  test('empty_pulls_apply_nothing_and_unsubscribe_stops_listening', async () => {
    const { fire, pulls, applied, stop, listeners } = setup();
    fire();
    pulls[0].resolve([]);
    await settle();
    expect(applied).toEqual([]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
