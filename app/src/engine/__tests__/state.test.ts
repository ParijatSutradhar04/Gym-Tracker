import { describe, expect, test } from 'vitest';
import { applyChanges, createRecorder, emptyState, getIndex, liveRows, mergeRemote } from '../state';
import type { Change, Day } from '../types';

const day = (id: string, date: string, updatedAt: string, extra: Partial<Day> = {}): Change => ({
  table: 'days',
  row: { id, date, updatedAt, deletedAt: null, status: null, shiftId: null, routineId: null, title: null, hasLog: false, ...extra },
});

describe('state', () => {
  test('applyChanges_is_immutable_and_keeps_tombstones', () => {
    const s0 = emptyState();
    const s1 = applyChanges(s0, [day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z')]);
    expect(s0.days.size).toBe(0);
    expect(s1.days.get('d1')?.date).toBe('2026-10-19');
    const s2 = applyChanges(s1, [day('d1', '2026-10-19', '2026-10-19T11:00:00.000Z', { deletedAt: '2026-10-19T11:00:00.000Z' })]);
    expect(s1.days.get('d1')?.deletedAt).toBeNull();
    expect(s2.days.get('d1')?.deletedAt).toBe('2026-10-19T11:00:00.000Z');
    expect(liveRows(s2, 'days')).toEqual([]);
    expect(s2.routines).toBe(s1.routines);
  });

  test('mergeRemote_newer_updatedAt_wins', () => {
    const s1 = applyChanges(emptyState(), [day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z', { title: 'local' })]);
    const remote = day('d1', '2026-10-19', '2026-10-19T10:00:00.001Z', { title: 'remote' });
    const absent = day('d2', '2026-10-20', '2026-10-01T00:00:00.000Z');
    const { state, accepted } = mergeRemote(s1, [remote, absent]);
    expect(state.days.get('d1')?.title).toBe('remote');
    expect(state.days.get('d2')).toBeDefined();
    expect(accepted).toEqual([remote, absent]);
  });

  test('mergeRemote_older_or_equal_is_rejected', () => {
    const s1 = applyChanges(emptyState(), [day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z', { title: 'local' })]);
    const older = day('d1', '2026-10-19', '2026-10-19T09:00:00.000Z', { title: 'older' });
    const equal = day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z', { title: 'equal' });
    const { state, accepted } = mergeRemote(s1, [older, equal]);
    expect(state.days.get('d1')?.title).toBe('local');
    expect(accepted).toEqual([]);
    expect(state).toBe(s1);
  });

  test('mergeRemote_tombstone_propagates', () => {
    const s1 = applyChanges(emptyState(), [day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z')]);
    const tomb = day('d1', '2026-10-19', '2026-10-19T12:00:00.000Z', { deletedAt: '2026-10-19T12:00:00.000Z' });
    const { state } = mergeRemote(s1, [tomb]);
    expect(state.days.get('d1')?.deletedAt).toBe('2026-10-19T12:00:00.000Z');
    expect(getIndex(state).dayByDate.get('2026-10-19')).toBeUndefined();
  });

  test('getIndex_is_memoized_per_state', () => {
    const s1 = applyChanges(emptyState(), [day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z')]);
    expect(getIndex(s1)).toBe(getIndex(s1));
    const s2 = applyChanges(s1, [day('d2', '2026-10-20', '2026-10-19T10:00:00.000Z')]);
    expect(getIndex(s2)).not.toBe(getIndex(s1));
    expect(getIndex(s2).dayByDate.get('2026-10-20')?.id).toBe('d2');
  });

  test('getIndex_picks_lowest_id_when_two_days_share_a_date', () => {
    const s = applyChanges(emptyState(), [
      day('b', '2026-10-19', '2026-10-19T10:00:00.000Z'),
      day('a', '2026-10-19', '2026-10-19T11:00:00.000Z'),
    ]);
    expect(getIndex(s).dayByDate.get('2026-10-19')?.id).toBe('a');
  });

  test('getIndex_orders_exercises_sets_versions_and_moves', () => {
    const t = '2026-10-19T10:00:00.000Z';
    const base = { updatedAt: t, deletedAt: null };
    const s = applyChanges(emptyState(), [
      { table: 'day_exercises', row: { id: 'x2', ...base, date: '2026-10-19', position: 1, name: 'B' } },
      { table: 'day_exercises', row: { id: 'x1', ...base, date: '2026-10-19', position: 1, name: 'A' } },
      { table: 'day_exercises', row: { id: 'x0', ...base, date: '2026-10-19', position: 0, name: 'Z' } },
      { table: 'sets', row: { id: 's2', ...base, dayExerciseId: 'x0', setNumber: 2, reps: 8, weightKg: null } },
      { table: 'sets', row: { id: 's1', ...base, dayExerciseId: 'x0', setNumber: 1, reps: 10, weightKg: 60 } },
      { table: 'routine_versions', row: { id: 'v2', ...base, routineId: 'r', effectiveFrom: '2026-11-01', title: 'T', repeatRule: 'weekly', startDate: '2026-10-19', exercises: [], ended: false } },
      { table: 'routine_versions', row: { id: 'v1', ...base, routineId: 'r', effectiveFrom: '2026-10-19', title: 'T', repeatRule: 'weekly', startDate: '2026-10-19', exercises: [], ended: false } },
      { table: 'occurrence_moves', row: { id: 'm2', updatedAt: '2026-10-19T09:00:00.000Z', deletedAt: null, routineId: 'r', fromDate: '2026-10-19', toDate: '2026-10-20', shiftId: 'sh' } },
      { table: 'occurrence_moves', row: { id: 'm1', updatedAt: t, deletedAt: null, routineId: 'r', fromDate: '2026-10-20', toDate: '2026-10-21', shiftId: 'sh' } },
    ]);
    const idx = getIndex(s);
    expect(idx.exercisesByDate.get('2026-10-19')?.map((x) => x.id)).toEqual(['x0', 'x1', 'x2']);
    expect(idx.setsByExercise.get('x0')?.map((x) => x.setNumber)).toEqual([1, 2]);
    expect(idx.versionsByRoutine.get('r')?.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(idx.moves.map((m) => m.id)).toEqual(['m2', 'm1']);
  });

  test('createRecorder_exposes_intermediate_state', () => {
    const rec = createRecorder(emptyState());
    rec.apply([day('d1', '2026-10-19', '2026-10-19T10:00:00.000Z')]);
    expect(rec.state().days.get('d1')).toBeDefined();
    rec.apply([day('d2', '2026-10-20', '2026-10-19T10:00:00.000Z')]);
    expect(rec.changes().map((c) => c.row.id)).toEqual(['d1', 'd2']);
    expect(getIndex(rec.state()).dayByDate.size).toBe(2);
  });
});
