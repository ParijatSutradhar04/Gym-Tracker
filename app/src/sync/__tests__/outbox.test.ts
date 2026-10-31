import { describe, expect, test } from 'vitest';
import type { OutboxEntry } from '../../data/DataStore';
import type { Change } from '../../engine/types';
import { coalesceEntries } from '../outbox';

const T = (s: number) => new Date(Date.UTC(2026, 9, 19, 12, 0, s)).toISOString();

const set = (id: string, reps: number, s: number): Change => ({
  table: 'sets',
  row: { id, updatedAt: T(s), deletedAt: null, dayExerciseId: 'x1', setNumber: 1, reps, weightKg: 60, isDrop: false },
});

const day = (id: string, s: number): Change => ({
  table: 'days',
  row: { id, date: '2026-10-19', updatedAt: T(s), deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true },
});

const entry = (seq: number, change: Change): OutboxEntry => ({
  seq,
  id: `ob-${seq}`,
  table: change.table,
  rowId: change.row.id,
  change,
  at: T(seq),
});

describe('coalesceEntries', () => {
  test('keeps_the_newest_entry_per_row_and_acks_all_ids', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1, set('s1', i + 1, i + 1)));

    const { send, ackIds } = coalesceEntries(entries);

    expect(send).toEqual([{ id: 'ob-10', table: 'sets', row: set('s1', 10, 10).row }]);
    expect(ackIds).toEqual(entries.map((e) => e.id));
  });

  test('same_row_id_in_different_tables_stays_separate', () => {
    const { send, ackIds } = coalesceEntries([entry(1, day('x', 1)), entry(2, set('x', 5, 2))]);

    expect(send.map((e) => [e.table, e.row.id])).toEqual([
      ['days', 'x'],
      ['sets', 'x'],
    ]);
    expect(ackIds).toEqual(['ob-1', 'ob-2']);
  });

  test('send_order_follows_first_seq', () => {
    const { send } = coalesceEntries([
      entry(1, day('a', 1)),
      entry(2, set('b', 5, 2)),
      entry(3, day('a', 3)),
      entry(4, set('c', 8, 4)),
    ]);

    expect(send.map((e) => [e.id, e.row.id])).toEqual([
      ['ob-3', 'a'],
      ['ob-2', 'b'],
      ['ob-4', 'c'],
    ]);
  });

  test('newest_is_by_seq_even_when_entries_arrive_out_of_order', () => {
    const { send, ackIds } = coalesceEntries([entry(3, set('s1', 3, 3)), entry(1, set('s1', 1, 1)), entry(2, day('a', 2))]);

    expect(send.map((e) => e.id)).toEqual(['ob-3', 'ob-2']);
    expect(ackIds).toEqual(['ob-1', 'ob-2', 'ob-3']);
  });

  test('nothing_to_send', () => {
    expect(coalesceEntries([])).toEqual({ send: [], ackIds: [] });
  });
});
