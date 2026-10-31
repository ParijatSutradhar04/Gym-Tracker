import { describe, expect, test } from 'vitest';
import { dayTotals, dayVolume, exerciseSummary } from '../summary';
import { emptyState, liveRows } from '../state';
import { logSets, makeCtx, run, seedRoutine } from './fixtures';

function chest() {
  const ctx = makeCtx('2026-10-19');
  const s = seedRoutine(emptyState(), ctx, {
    title: 'Chest & Tricep',
    repeatRule: 'weekly',
    startDate: '2026-10-12',
    exercises: ['Bench press', 'Dips'],
  });
  return { ctx, s };
}

describe('summary', () => {
  test('summary_uses_heaviest_set', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [12, 62.5], [8, 62.5]]);
    expect(exerciseSummary(s, '2026-10-19', 0)).toEqual({ setCount: 3, text: '3 sets · 12 reps · 62.5 kg' });
  });

  test('summary_bodyweight_only', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Dips', [[15, null], [12, null]]);
    expect(exerciseSummary(s, '2026-10-19', 1).text).toBe('2 sets · 15 reps');
  });

  test('summary_nothing_logged_uses_prefill_count', () => {
    let { ctx, s } = chest();
    expect(exerciseSummary(s, '2026-10-19', 0)).toEqual({ setCount: 3, text: '3 sets' });
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [10, 60], [8, 60], [6, 60]]);
    expect(exerciseSummary(s, '2026-10-19', 0).text).toBe('4 sets');
  });

  test('summary_singular', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[5, 100]]);
    expect(exerciseSummary(s, '2026-10-19', 0).text).toBe('1 set · 5 reps · 100 kg');
    s = logSets(s, ctx, '2026-10-12', 'Dips', [[5, null]]);
    expect(exerciseSummary(s, '2026-10-19', 1).text).toBe('1 set');
  });

  test('volume_excludes_bodyweight', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [12, 62.5], [8, 62.5], [9, null]]);
    expect(dayVolume(s, '2026-10-19')).toBe(1850);
  });

  test('totals_count_exercises_and_logged_sets', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 60]]);
    s = logSets(s, ctx, '2026-10-19', 'Dips', [[12, null]]);
    expect(dayTotals(s, '2026-10-19')).toEqual({ exercises: 2, sets: 3, volumeKg: 1080 });
  });
});

describe('summary with drops', () => {
  test('drops_count_toward_volume_not_sets', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 45, true], [6, 30, true]]);
    expect(exerciseSummary(s, '2026-10-19', 0)).toEqual({ setCount: 1, text: '1 set · 10 reps · 60 kg' });
    expect(dayVolume(s, '2026-10-19')).toBe(1140);
  });

  test('prefill_count_excludes_drops', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-12', 'Bench press', [[10, 60], [10, 60], [8, 45, true]]);
    expect(exerciseSummary(s, '2026-10-19', 0)).toEqual({ setCount: 2, text: '2 sets' });
  });

  test('orphan_first_row_drop_counts_as_a_set', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60]]);
    const [only] = liveRows(s, 'sets');
    s = run(s, [{ table: 'sets', row: { ...only, isDrop: true } }]);
    expect(exerciseSummary(s, '2026-10-19', 0).setCount).toBe(1);
  });
});
