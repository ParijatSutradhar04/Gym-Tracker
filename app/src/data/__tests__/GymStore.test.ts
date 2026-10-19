import { afterEach, describe, expect, test, vi } from 'vitest';
import { getDay } from '../../engine/dayView';
import { persistedSets } from '../../engine/sets';
import { EngineError, type Change, type SetRow } from '../../engine/types';
import type { PullPage, SyncApi } from '../../sync/api';
import { createCursorStore } from '../../sync/cursor';
import { pullAll } from '../../sync/pull';
import { StoreCorruptError } from '../DataStore';
import { createActions, GymStore } from '../GymStore';
import { LocalStore } from '../LocalStore';
import { MemoryStorage } from '../storage';

const TODAY = '2026-10-19';

function deps(tag = 'id') {
  let n = 0;
  let ms = 0;
  return { newId: () => `${tag}-${++n}`, now: () => new Date(Date.UTC(2026, 9, 19, 12) + ms++).toISOString() };
}

const day = (id: string, title = 'Chest'): Change => ({
  table: 'days',
  row: { id, date: TODAY, updatedAt: '2026-10-19T10:00:00.000Z', deletedAt: null, status: null, shiftId: null, routineId: null, title, hasLog: true },
});

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 19, h, m)).toISOString();

const set = (updatedAt: string, reps: number): Change => ({
  table: 'sets',
  row: { id: 's1', updatedAt, deletedAt: null, dayExerciseId: 'x1', setNumber: 1, reps, weightKg: 60 },
});

/** A SyncApi whose pull is answered by hand; `asked` resolves once the request is out. */
function latePull() {
  let answer!: (page: PullPage) => void;
  let requested!: () => void;
  const asked = new Promise<void>((resolve) => (requested = resolve));
  const api: SyncApi = {
    push: () => Promise.reject(new Error('not used')),
    pull: () => {
      requested();
      return new Promise<PullPage>((resolve) => (answer = resolve));
    },
  };
  return { api, asked, answer: (page: PullPage) => answer(page) };
}

async function opened(storage = new MemoryStorage()) {
  const local = new LocalStore(storage, deps('ob'));
  const gym = new GymStore(local, deps());
  await gym.init();
  return { storage, local, gym };
}

afterEach(() => vi.restoreAllMocks());

describe('GymStore', () => {
  test('dispatch_updates_state_and_notifies_synchronously', async () => {
    const { local, gym } = await opened();
    const seen: number[] = [];
    gym.subscribe(() => seen.push(gym.getState().days.size));
    gym.dispatch([day('a1')]);
    expect(seen).toEqual([1]);
    expect(await local.count()).toBe(0);
    await gym.whenIdle();
    expect(await local.count()).toBe(1);
  });

  test('writes_persist_in_dispatch_order', async () => {
    const { storage, gym } = await opened();
    for (let i = 0; i < 50; i++) gym.dispatch([day(`d${i}`), day('counter', `t${i}`)]);
    await gym.whenIdle();
    const again = new LocalStore(storage, deps('ob'));
    const s = await again.load();
    expect(s.days.size).toBe(51);
    expect(s.days.get('counter')?.title).toBe('t49');
    const order = (await again.peek(1000)).map((e) => e.rowId);
    expect(order).toEqual(Array.from({ length: 50 }, (_, i) => [`d${i}`, 'counter']).flat());
  });

  test('change_made_before_restart_is_present_after_restart_and_in_outbox', async () => {
    const { storage, gym } = await opened();
    const actions = createActions(gym, () => TODAY);
    actions.addSchedule({ date: TODAY, title: 'Chest', repeatRule: 'weekly', exercises: ['Bench press'] });
    actions.syncSets({ date: TODAY, position: 0, rows: [{ reps: 10, weightKg: 60, touched: true }], includeUntouched: true });
    await gym.whenIdle();

    const local = new LocalStore(storage, deps('ob'));
    const restarted = new GymStore(local, deps('again'));
    await restarted.init();
    const v = getDay(restarted.getState(), restarted.ctx(TODAY), TODAY);
    expect(v.hasLog).toBe(true);
    expect(v.exercises[0]).toMatchObject({ name: 'Bench press', setCount: 1 });
    expect(v.totals.volumeKg).toBe(600);
    expect(await local.count()).toBeGreaterThan(0);
  });

  test('failed_write_keeps_ui_state_and_sets_lastError', async () => {
    const { storage, gym } = await opened();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failNextWrite();
    gym.dispatch([day('a1')]);
    await gym.whenIdle();
    expect(gym.getState().days.has('a1')).toBe(true);
    expect(gym.lastError).toBeInstanceOf(Error);
    expect(warn).toHaveBeenCalled();
    gym.dispatch([day('a2')]);
    await gym.whenIdle();
    expect((await new LocalStore(storage, deps('ob')).load()).days.has('a2')).toBe(true);
  });

  test('failed_changes_are_saved_with_the_next_write', async () => {
    const { storage, gym } = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failNextWrite();
    gym.dispatch([day('a1')]);
    await gym.whenIdle();
    gym.dispatch([day('a2')]);
    await gym.whenIdle();
    const s = await new LocalStore(storage, deps('ob')).load();
    expect([...s.days.keys()].sort()).toEqual(['a1', 'a2']);
    expect(gym.lastError).toBeNull();
  });

  test('retry_saves_failed_changes_without_a_new_edit', async () => {
    const { storage, gym } = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failNextWrite();
    gym.dispatch([day('a1')]);
    await gym.whenIdle();
    gym.retry();
    await gym.whenIdle();
    expect((await new LocalStore(storage, deps('ob')).load()).days.has('a1')).toBe(true);
    expect(gym.lastError).toBeNull();
  });

  test('save_failure_and_recovery_notify_subscribers', async () => {
    const { storage, gym } = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errors: (Error | null)[] = [];
    gym.subscribe(() => errors.push(gym.lastError));
    storage.failNextWrite();
    gym.dispatch([day('a1')]);
    await gym.whenIdle();
    gym.retry();
    await gym.whenIdle();
    expect(errors.map((e) => e !== null)).toEqual([false, true, false]);
  });

  test('init_propagates_StoreCorruptError', async () => {
    const storage = new MemoryStorage();
    await storage.multiSet([['gt:v1:row:days:a', '{not json']]);
    const gym = new GymStore(new LocalStore(storage, deps('ob')), deps());
    await expect(gym.init()).rejects.toBeInstanceOf(StoreCorruptError);
  });

  test('actions_dispatch_engine_changes_and_propagate_engine_errors', async () => {
    const { gym } = await opened();
    const actions = createActions(gym, () => TODAY);
    let calls = 0;
    gym.subscribe(() => calls++);
    expect(() => actions.addSchedule({ date: '2026-10-18', title: 'Chest', repeatRule: 'weekly' })).toThrow(EngineError);
    expect(calls).toBe(0);
    actions.addSchedule({ date: TODAY, title: 'Chest', repeatRule: 'weekly', exercises: ['Bench press'] });
    actions.skipToday();
    expect(calls).toBe(2);
    expect([...gym.getState().days.values()][0]).toMatchObject({ date: TODAY, status: 'skipped', title: 'Chest' });
  });

  test('restamp_rewrites_future_rows_in_memory_and_on_disk_after_queued_writes', async () => {
    const { storage, gym } = await opened();
    gym.dispatch([set(at(14), 8)]); // stamped by a clock two hours fast
    gym.dispatch([day('d1')]);

    await gym.restamp(at(12, 5), at(12));

    expect(gym.getState().sets.get('s1')).toMatchObject({ reps: 8, updatedAt: at(12) });
    expect(gym.getState().days.get('d1')?.updatedAt).toBe(at(10));
    const reloaded = new LocalStore(storage, deps('ob2'));
    expect((await reloaded.load()).sets.get('s1')?.updatedAt).toBe(at(12));
    expect((await reloaded.peek(10)).map((e) => [e.rowId, e.change.row.updatedAt])).toEqual([
      ['s1', at(12)],
      ['d1', at(10)],
    ]);
  });

  test('applyRemote_merges_notifies_and_persists_after_pending_commits', async () => {
    const { storage, local, gym } = await opened();
    const order: string[] = [];
    const commit = local.commit.bind(local);
    const applyRemote = local.applyRemote.bind(local);
    vi.spyOn(local, 'commit').mockImplementation(async (c) => {
      order.push('commit');
      await commit(c);
      order.push('commit saved');
    });
    vi.spyOn(local, 'applyRemote').mockImplementation(async (c) => {
      order.push('remote');
      await applyRemote(c);
      order.push('remote saved');
    });
    const seen: string[][] = [];
    gym.subscribe(() => seen.push([...gym.getState().days.keys()]));

    gym.dispatch([day('a1')]);
    const saving = gym.applyRemote([day('r1', 'Back')]);
    expect(seen).toEqual([['a1'], ['a1', 'r1']]);
    await saving;

    expect(order).toEqual(['commit', 'commit saved', 'remote', 'remote saved']);
    const reloaded = new LocalStore(storage, deps('ob'));
    expect([...(await reloaded.load()).days.keys()].sort()).toEqual(['a1', 'r1']);
    expect((await reloaded.peek(10)).map((e) => e.rowId)).toEqual(['a1']);
  });

  test('remote_older_than_a_local_edit_is_ignored', async () => {
    const { storage, local, gym } = await opened();
    const remote = vi.spyOn(local, 'applyRemote');
    gym.dispatch([set(at(12, 2), 10)]);
    const mine = gym.getState().sets.get('s1');
    let calls = 0;
    gym.subscribe(() => calls++);

    const older = set(at(12, 1), 99);
    await gym.applyRemote([older]);
    await gym.whenIdle();

    expect(gym.getState().sets.get('s1')).toBe(mine);
    expect(calls).toBe(0);
    expect(remote.mock.calls.flatMap(([changes]) => changes)).not.toContainEqual(older);
    expect((await new LocalStore(storage, deps('ob')).load()).sets.get('s1')?.reps).toBe(10);
  });

  test('pull_in_flight_during_a_local_edit_does_not_clobber_it', async () => {
    const { storage, gym } = await opened();
    const { api, asked, answer } = latePull();
    const pulling = pullAll({ api, cursor: createCursorStore(storage), apply: (c) => gym.applyRemote(c) });
    await asked;

    gym.dispatch([set(at(12, 2), 10)]);
    answer({ changes: [set(at(12, 1), 99)], cursor: 1, hasMore: false, serverTime: at(12) });
    await pulling;
    await gym.whenIdle();

    expect(gym.getState().sets.get('s1')?.reps).toBe(10);
    const reloaded = new LocalStore(storage, deps('ob'));
    expect((await reloaded.load()).sets.get('s1')?.reps).toBe(10);
    expect((await reloaded.peek(10)).map((e) => [e.rowId, (e.change.row as SetRow).reps])).toEqual([['s1', 10]]);
    expect(await createCursorStore(storage).get()).toBe(1);
  });

  test('remote_tombstone_removes_the_row_from_the_view', async () => {
    const { gym } = await opened();
    const actions = createActions(gym, () => TODAY);
    actions.addSchedule({ date: TODAY, title: 'Chest', repeatRule: 'weekly', exercises: ['Bench press'] });
    actions.syncSets({ date: TODAY, position: 0, rows: [{ reps: 10, weightKg: 60, touched: true }], includeUntouched: true });
    const [mine] = persistedSets(gym.getState(), TODAY, 0);
    expect(getDay(gym.getState(), gym.ctx(TODAY), TODAY).totals.volumeKg).toBe(600);

    await gym.applyRemote([{ table: 'sets', row: { ...mine, updatedAt: at(13), deletedAt: at(13) } }]);

    expect(persistedSets(gym.getState(), TODAY, 0)).toEqual([]);
    expect(getDay(gym.getState(), gym.ctx(TODAY), TODAY).totals.volumeKg).toBe(0);
  });

  test('dispatch_returns_false_and_changes_nothing_while_paused', async () => {
    const { local, gym } = await opened();
    const before = gym.getState();
    let calls = 0;
    gym.subscribe(() => calls++);

    gym.setWritesPaused(true);
    expect(gym.dispatch([day('a1')])).toBe(false);
    await gym.whenIdle();

    expect(gym.getState()).toBe(before);
    expect(calls).toBe(0);
    expect(await local.count()).toBe(0);

    gym.setWritesPaused(false);
    expect(gym.dispatch([day('a1')])).toBe(true);
    expect(gym.getState().days.has('a1')).toBe(true);
  });

  test('applyRemote_still_works_while_paused', async () => {
    const { storage, gym } = await opened();
    gym.setWritesPaused(true);

    await gym.applyRemote([day('r1')]);

    expect(gym.getState().days.has('r1')).toBe(true);
    expect((await new LocalStore(storage, deps('ob')).load()).days.has('r1')).toBe(true);
  });

  test('remote_rows_a_failed_write_dropped_are_saved_by_the_next_pull', async () => {
    const { storage, gym } = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failNextWrite();

    await expect(gym.applyRemote([day('r1')])).rejects.toThrow();
    expect(gym.getState().days.has('r1')).toBe(true);
    expect(gym.lastError).toBeInstanceOf(Error);

    // The failed pull kept its cursor, so the next one brings the same row: in memory already, not yet on disk.
    await gym.applyRemote([day('r1')]);

    expect((await new LocalStore(storage, deps('ob')).load()).days.has('r1')).toBe(true);
    expect(gym.lastError).toBeNull();
  });

  test('retry_also_saves_remote_rows_a_failed_write_dropped', async () => {
    const { storage, gym } = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failNextWrite();
    await gym.applyRemote([day('r1')]).catch(() => {});

    gym.retry();
    await gym.whenIdle();

    const reloaded = new LocalStore(storage, deps('ob'));
    expect((await reloaded.load()).days.has('r1')).toBe(true);
    expect(await reloaded.count()).toBe(0);
    expect(gym.lastError).toBeNull();
  });

  test('unsaved_change_replaced_by_a_newer_remote_row_is_not_written_back', async () => {
    const { storage, gym } = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failNextWrite();
    gym.dispatch([set(at(12, 1), 10)]);
    await gym.whenIdle();

    await gym.applyRemote([set(at(12, 5), 12)]);
    gym.retry();
    await gym.whenIdle();

    expect(gym.getState().sets.get('s1')?.reps).toBe(12);
    const reloaded = new LocalStore(storage, deps('ob'));
    expect((await reloaded.load()).sets.get('s1')?.reps).toBe(12);
    expect(await reloaded.count()).toBe(0);
    expect(gym.lastError).toBeNull();
  });
});
