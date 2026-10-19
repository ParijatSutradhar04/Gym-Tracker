import { afterEach, describe, expect, test, vi } from 'vitest';
import { getDay } from '../../engine/dayView';
import { EngineError, type Change } from '../../engine/types';
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
});
