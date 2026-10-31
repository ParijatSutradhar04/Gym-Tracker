import { describe, expect, test } from 'vitest';
import { getSetsSheet, numberSets, parseRepsInput, parseWeightInput, prefillRows, removalEnd, syncSets, type SetDraft } from '../sets';
import { emptyState, getIndex, liveRows } from '../state';
import type { SetRow } from '../types';
import { expectCode, logSets, makeCtx, run, seedRoutine } from './fixtures';

const empty = { reps: null, weightKg: null, touched: false, isDrop: false };
const draft = (reps: number | null, weightKg: number | null, touched = true, isDrop = false): SetDraft => ({ reps, weightKg, touched, isDrop });

function chest(today = '2026-10-19') {
  const ctx = makeCtx(today);
  const s = seedRoutine(emptyState(), ctx, {
    title: 'Chest & Tricep',
    repeatRule: 'weekly',
    startDate: '2026-10-12',
    exercises: ['Bench press', 'Pull-up'],
  });
  return { ctx, s };
}

const liveSets = (s: ReturnType<typeof emptyState>) =>
  liveRows(s, 'sets').sort((a, b) => a.setNumber - b.setNumber).map((x) => [x.setNumber, x.reps, x.weightKg]);

describe('prefill', () => {
  test('first_time_exercise_gets_three_empty_rows', () => {
    const { s } = chest();
    expect(prefillRows(s, '2026-10-19', 'Bench press')).toEqual([empty, empty, empty]);
  });

  test('prefill_uses_most_recent_earlier_session_by_name_across_routines', () => {
    let { ctx, s } = chest();
    s = seedRoutine(s, ctx, { title: 'B', repeatRule: 'never', startDate: '2026-10-15', exercises: [' bench PRESS'] });
    s = seedRoutine(s, ctx, { title: 'C', repeatRule: 'never', startDate: '2026-10-17', exercises: ['Bench press'] });
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [8, 62.5]]);
    s = logSets(s, ctx, '2026-10-15', 'Bench press', [[12, 65]]);
    s = logSets(s, ctx, '2026-10-17', 'Bench press', [[null, 70]]);
    expect(prefillRows(s, '2026-10-19', 'Bench press')).toEqual([{ reps: 12, weightKg: 65, touched: false, isDrop: false }]);
    expect(prefillRows(s, '2026-10-15', 'Bench press')).toEqual([
      { reps: 10, weightKg: 60, touched: false, isDrop: false },
      { reps: 8, weightKg: 62.5, touched: false, isDrop: false },
    ]);
    expect(prefillRows(s, '2026-10-12', 'Bench press')).toEqual([empty, empty, empty]);
  });

  test('renamed_exercise_starts_fresh_history', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60]]);
    expect(prefillRows(s, '2026-10-19', 'Flat bench')).toEqual([empty, empty, empty]);
  });
});

describe('syncSets', () => {
  test('close_does_not_save_untouched_prefill', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [8, 62.5]]);
    const rows = prefillRows(s, '2026-10-19', 'Bench press');
    expect(syncSets(s, ctx, { date: '2026-10-19', position: 0, rows, includeUntouched: false })).toEqual([]);
    expect(getIndex(s).dayByDate.get('2026-10-19')).toBeUndefined();
  });

  test('done_saves_all_rows_as_shown', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [8, 62.5]]);
    const rows = prefillRows(s, '2026-10-19', 'Bench press');
    const s1 = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 0, rows, includeUntouched: true }));
    const today = getIndex(s1).exercisesByDate.get('2026-10-19')![0];
    const sets = getIndex(s1).setsByExercise.get(today.id)!;
    expect(sets.map((x) => [x.setNumber, x.reps, x.weightKg])).toEqual([[1, 10, 60], [2, 8, 62.5]]);
    const again = syncSets(s1, ctx, { date: '2026-10-19', position: 0, rows, includeUntouched: true });
    const s2 = run(s1, again);
    expect(getIndex(s2).setsByExercise.get(today.id)!.map((x) => x.id)).toEqual(sets.map((x) => x.id));
    expect(liveRows(s2, 'sets')).toHaveLength(4);
  });

  test('typing_one_value_saves_only_that_row', () => {
    const { ctx, s } = chest();
    const rows = [draft(null, null, false), draft(8, null), draft(null, null, false)];
    const s1 = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 0, rows, includeUntouched: false }));
    expect(liveSets(s1)).toEqual([[2, 8, null]]);
    expect(getIndex(s1).dayByDate.get('2026-10-19')?.hasLog).toBe(true);
  });

  test('clearing_a_touched_row_deletes_the_set', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 60]]);
    const rows = [draft(10, 60), draft(null, null)];
    s = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 0, rows, includeUntouched: false }));
    expect(liveSets(s)).toEqual([[1, 10, 60]]);
  });

  test('shrinking_rows_tombstones_extra_sets', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 60], [6, 60]]);
    s = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 0, rows: [draft(10, 60)], includeUntouched: false }));
    expect(liveSets(s)).toEqual([[1, 10, 60]]);
    expect(s.sets.size).toBe(3);
  });

  test('deleting_all_rows_tombstones_all_sets', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 60]]);
    s = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 0, rows: [], includeUntouched: false }));
    expect(liveSets(s)).toEqual([]);
  });

  test('future_day_is_read_only', () => {
    const { ctx, s } = chest();
    expectCode(
      () => syncSets(s, ctx, { date: '2026-10-26', position: 0, rows: [draft(10, 60)], includeUntouched: false }),
      'READ_ONLY_FUTURE',
    );
    expect(getSetsSheet(s, ctx, '2026-10-26', 0).readOnly).toBe(true);
  });

  test('past_day_is_editable', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Pull-up', [[12, null]]);
    expect(liveSets(s)).toEqual([[1, 12, null]]);
    const sheet = getSetsSheet(s, ctx, '2026-10-12', 1);
    expect(sheet).toMatchObject({ routineTitle: 'Chest & Tricep', exerciseName: 'Pull-up', readOnly: false, prefilled: false });
    expect(sheet.rows).toEqual([draft(12, null)]);
  });

  test('sheet_prefills_from_history', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60]]);
    const sheet = getSetsSheet(s, ctx, '2026-10-19', 0);
    expect(sheet.prefilled).toBe(true);
    expect(sheet.rows).toEqual([draft(10, 60, false)]);
    expect(getSetsSheet(s, ctx, '2026-10-19', 1).prefilled).toBe(false);
  });

  test('position_out_of_range_throws_NOT_FOUND', () => {
    const { ctx, s } = chest();
    expectCode(() => syncSets(s, ctx, { date: '2026-10-19', position: 2, rows: [draft(1, 1)], includeUntouched: false }), 'NOT_FOUND');
    expectCode(() => getSetsSheet(s, ctx, '2026-10-19', 5), 'NOT_FOUND');
  });

  test('bodyweight_row_saves_reps_with_null_kg', () => {
    const { ctx, s } = chest();
    const s1 = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 1, rows: [draft(15, null)], includeUntouched: false }));
    expect(liveSets(s1)).toEqual([[1, 15, null]]);
  });
});

describe('input parsing', () => {
  test('parseRepsInput', () => {
    expect(parseRepsInput('10')).toBe(10);
    expect(parseRepsInput(' 12 ')).toBe(12);
    expect(parseRepsInput('')).toBeNull();
    expect(parseRepsInput('10.5')).toBe('invalid');
    expect(parseRepsInput('-5')).toBe('invalid');
    expect(parseRepsInput('abc')).toBe('invalid');
    expect(parseRepsInput('1000')).toBe('invalid');
    expect(parseRepsInput('999')).toBe(999);
  });

  test('parseWeightInput', () => {
    expect(parseWeightInput('60')).toBe(60);
    expect(parseWeightInput('22,5')).toBe(22.5);
    expect(parseWeightInput('22.5')).toBe(22.5);
    expect(parseWeightInput('')).toBeNull();
    expect(parseWeightInput('-1')).toBe('invalid');
    expect(parseWeightInput('1e3')).toBe('invalid');
    expect(parseWeightInput('1.2.3')).toBe('invalid');
    expect(parseWeightInput('1001')).toBe('invalid');
    expect(parseWeightInput('1000')).toBe(1000);
  });
});

describe('drop sets', () => {
  const kinds = (...drops: boolean[]) => drops.map((isDrop) => ({ isDrop }));
  const liveDrops = (s: ReturnType<typeof emptyState>) =>
    liveRows(s, 'sets').sort((a, b) => a.setNumber - b.setNumber).map((x) => [x.setNumber, x.isDrop]);

  test('numberSets_numbers_drops_under_their_set_and_treats_a_first_row_drop_as_a_set', () => {
    expect(numberSets(kinds(false, true, true, false))).toEqual([
      { number: 1, isDrop: false },
      { number: 1, isDrop: true },
      { number: 1, isDrop: true },
      { number: 2, isDrop: false },
    ]);
    expect(numberSets(kinds(true, true, false))).toEqual([
      { number: 1, isDrop: false },
      { number: 1, isDrop: true },
      { number: 2, isDrop: false },
    ]);
  });

  test('removalEnd_takes_a_sets_drops_and_only_the_drop', () => {
    const rows = kinds(false, true, true, false);
    expect(removalEnd(rows, 0)).toBe(3);
    expect(removalEnd(rows, 1)).toBe(2);
    expect(removalEnd(rows, 3)).toBe(4);
  });

  test('drop_rows_save_isDrop', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 45, true], [10, 60]]);
    expect(liveDrops(s)).toEqual([[1, false], [2, true], [3, false]]);
  });

  test('toggling_a_row_to_a_drop_saves_it', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 45]]);
    const changes = syncSets(s, ctx, { date: '2026-10-19', position: 0, rows: [draft(10, 60), draft(8, 45, true, true)], includeUntouched: false });
    expect(changes.filter((c) => c.table === 'sets').map((c) => [(c.row as SetRow).setNumber, (c.row as SetRow).isDrop])).toEqual([[2, true]]);
  });

  test('toggling_an_untouched_row_saves_only_that_row', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [8, 45], [6, 30]]);
    const rows = prefillRows(s, '2026-10-19', 'Bench press');
    rows[1] = { ...rows[1], touched: true, isDrop: true };
    s = run(s, syncSets(s, ctx, { date: '2026-10-19', position: 0, rows, includeUntouched: false }));
    const today = getIndex(s).exercisesByDate.get('2026-10-19')![0];
    expect(getIndex(s).setsByExercise.get(today.id)!.map((x) => [x.setNumber, x.reps, x.isDrop])).toEqual([[2, 8, true]]);
  });

  test('first_row_is_never_saved_as_a_drop', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[8, 45, true], [6, 30, true]]);
    expect(liveDrops(s)).toEqual([[1, false], [2, true]]);
  });

  test('prefill_copies_drops', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [8, 45, true]]);
    expect(prefillRows(s, '2026-10-19', 'Bench press').map((r) => r.isDrop)).toEqual([false, true]);
  });

  test('sheet_rows_carry_isDrop', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 45, true]]);
    expect(getSetsSheet(s, ctx, '2026-10-19', 0).rows.map((r) => r.isDrop)).toEqual([false, true]);
  });
});
