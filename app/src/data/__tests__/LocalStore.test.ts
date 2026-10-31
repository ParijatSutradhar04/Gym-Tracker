import { describe, expect, test } from 'vitest';
import { applyChanges, emptyState } from '../../engine/state';
import type { Change, Day, SetRow } from '../../engine/types';
import { StoreCorruptError } from '../DataStore';
import { LocalStore } from '../LocalStore';
import { MemoryStorage } from '../storage';

function deps() {
  let n = 0;
  let ms = 0;
  return { newId: () => `ob-${++n}`, now: () => new Date(Date.UTC(2026, 9, 19, 12) + ms++).toISOString() };
}

const day = (id: string, date: string, updatedAt = '2026-10-19T10:00:00.000Z', extra: Partial<Day> = {}): Change => ({
  table: 'days',
  row: { id, date, updatedAt, deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true, ...extra },
});

const set = (id: string, n: number): Change => ({
  table: 'sets',
  row: { id, updatedAt: '2026-10-19T10:00:00.000Z', deletedAt: null, dayExerciseId: 'x1', setNumber: n, reps: 10, weightKg: 60, isDrop: false } satisfies SetRow,
});

async function opened(storage = new MemoryStorage()) {
  const store = new LocalStore(storage, deps());
  await store.load();
  return { storage, store };
}

describe('LocalStore', () => {
  test('empty_storage_loads_empty_state', async () => {
    const store = new LocalStore(new MemoryStorage(), deps());
    expect(await store.load()).toEqual(emptyState());
    expect(await store.count()).toBe(0);
  });

  test('committed_rows_survive_restart', async () => {
    const { storage, store } = await opened();
    const changes = [day('a1', '2026-10-19'), set('b2', 1)];
    await store.commit(changes);
    const again = new LocalStore(storage, deps());
    expect(await again.load()).toEqual(applyChanges(emptyState(), changes));
  });

  test('commit_appends_one_outbox_entry_per_change_in_order', async () => {
    const { store } = await opened();
    const changes = [day('a1', '2026-10-19'), set('b2', 1)];
    await store.commit(changes);
    const entries = await store.peek(10);
    expect(entries.map((e) => [e.seq, e.table, e.rowId])).toEqual([
      [1, 'days', 'a1'],
      [2, 'sets', 'b2'],
    ]);
    expect(entries[0].change).toEqual(changes[0]);
    expect(entries[0].id).not.toBe(entries[1].id);
    expect(await store.count()).toBe(2);
    expect((await store.peek(1)).map((e) => e.seq)).toEqual([1]);
  });

  test('outbox_survives_restart_and_keeps_sequence', async () => {
    const { storage, store } = await opened();
    await store.commit([day('a1', '2026-10-19'), day('a2', '2026-10-20')]);
    const again = new LocalStore(storage, { ...deps(), newId: () => 'later' });
    await again.load();
    expect(await again.count()).toBe(2);
    await again.commit([day('a3', '2026-10-21')]);
    expect((await again.peek(10)).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  test('ack_removes_only_acked_entries', async () => {
    const { storage, store } = await opened();
    await store.commit([day('a1', '2026-10-19'), day('a2', '2026-10-20'), day('a3', '2026-10-21')]);
    const [first, , third] = await store.peek(10);
    await store.ack([first.id, third.id]);
    expect((await store.peek(10)).map((e) => e.rowId)).toEqual(['a2']);
    const again = new LocalStore(storage, deps());
    await again.load();
    expect((await again.peek(10)).map((e) => e.rowId)).toEqual(['a2']);
  });

  test('subscribe_fires_on_commit_and_ack', async () => {
    const { store } = await opened();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    await store.commit([day('a1', '2026-10-19')]);
    expect(calls).toBe(1);
    await store.ack([(await store.peek(1))[0].id]);
    expect(calls).toBe(2);
    off();
    await store.commit([day('a2', '2026-10-20')]);
    expect(calls).toBe(2);
  });

  test('commit_is_atomic', async () => {
    const { storage, store } = await opened();
    await store.commit([day('a1', '2026-10-19')]);
    const before = storage.snapshot();
    storage.failNextWrite();
    await expect(store.commit([day('a2', '2026-10-20'), set('b2', 1)])).rejects.toThrow();
    expect(storage.snapshot()).toEqual(before);
    expect(await store.count()).toBe(1);
    await store.commit([day('a3', '2026-10-21')]);
    expect((await store.peek(10)).map((e) => e.seq)).toEqual([1, 2]);
    const again = new LocalStore(storage, deps());
    const s = await again.load();
    expect([...s.days.keys()].sort()).toEqual(['a1', 'a3']);
  });

  test('soft_delete_is_stored_as_a_tombstone_and_enqueued', async () => {
    const { storage, store } = await opened();
    await store.commit([day('a1', '2026-10-19')]);
    const gone = day('a1', '2026-10-19', '2026-10-19T11:00:00.000Z', { deletedAt: '2026-10-19T11:00:00.000Z' });
    await store.commit([gone]);
    const s = await new LocalStore(storage, deps()).load();
    expect(s.days.get('a1')?.deletedAt).toBe('2026-10-19T11:00:00.000Z');
    expect((await store.peek(10))[1].change).toEqual(gone);
  });

  test('applyRemote_is_last_write_wins_and_skips_outbox', async () => {
    const { storage, store } = await opened();
    await store.commit([day('a1', '2026-10-19', '2026-10-19T10:00:00.000Z', { title: 'Local' })]);
    await store.applyRemote([day('a1', '2026-10-19', '2026-10-19T09:00:00.000Z', { title: 'Older' })]);
    expect((await new LocalStore(storage, deps()).load()).days.get('a1')?.title).toBe('Local');
    await store.applyRemote([day('a1', '2026-10-19', '2026-10-19T11:00:00.000Z', { title: 'Newer' }), day('r1', '2026-10-01')]);
    const s = await new LocalStore(storage, deps()).load();
    expect(s.days.get('a1')?.title).toBe('Newer');
    expect(s.days.has('r1')).toBe(true);
    expect(await store.count()).toBe(1);
  });

  test('rows_spread_across_buckets_and_reload_identically', async () => {
    const { storage, store } = await opened();
    let seed = 7;
    const hex = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed.toString(16).padStart(8, '0').slice(2);
    };
    const changes = Array.from({ length: 60 }, (_, i) => set(`${hex()}-${i}`, i + 1));
    await store.commit(changes);
    const buckets = Object.keys(storage.snapshot()).filter((k) => k.startsWith('gt:v1:row:sets:'));
    expect(buckets.length).toBeGreaterThan(8);
    expect(buckets.every((k) => /^gt:v1:row:sets:[0-9a-f]$/.test(k))).toBe(true);
    expect(await new LocalStore(storage, deps()).load()).toEqual(applyChanges(emptyState(), changes));
  });

  test('corrupt_bucket_throws_StoreCorruptError_without_writing', async () => {
    const { storage, store } = await opened();
    await store.commit([day('a1', '2026-10-19')]);
    await storage.multiSet([['gt:v1:row:days:0', '{not json']]);
    const before = storage.snapshot();
    await expect(new LocalStore(storage, deps()).load()).rejects.toBeInstanceOf(StoreCorruptError);
    expect(storage.snapshot()).toEqual(before);
  });

  test('newer_schema_version_throws_StoreCorruptError', async () => {
    const storage = new MemoryStorage();
    await storage.multiSet([['gt:v1:meta', JSON.stringify({ schemaVersion: 2, outboxSeq: 0 })]]);
    const before = storage.snapshot();
    await expect(new LocalStore(storage, deps()).load()).rejects.toBeInstanceOf(StoreCorruptError);
    expect(storage.snapshot()).toEqual(before);
  });
});
