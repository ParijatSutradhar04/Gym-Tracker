import { describe, expect, test } from 'vitest';
import { addDays, eachDay } from '../dates';
import { scheduleOn } from '../schedule';
import { addExercise } from '../scheduleEdits';
import { syncSets } from '../sets';
import { gymMissedAvailable, previewShift, restorableShift, restoreShift, shiftToday, skipToday } from '../shift';
import { emptyState, getIndex } from '../state';
import type { Ctx, DataState } from '../types';
import { addVersion, expectCode, logSets, makeCtx, routineId, run, scheduleSnapshot, seedRoutine, seedWeek } from './fixtures';

const MON = '2026-10-19';

function week(): { ctx: Ctx; s: DataState } {
  const ctx = makeCtx(MON);
  return { ctx, s: seedWeek(emptyState(), ctx) };
}

/** A ctx for another day that keeps issuing fresh ids and later timestamps. */
const dayCtx = (today: string, seq: number) => makeCtx(today, seq);

const title = (s: DataState, d: string) => scheduleOn(s, d)?.title ?? null;
const dayRow = (s: DataState, d: string) => getIndex(s).dayByDate.get(d);
const liveShift = (s: DataState) => [...s.shifts.values()].find((x) => x.deletedAt === null) ?? null;

/** After a permanent shift on `today`, every day from tomorrow shows what the day before it showed. */
function expectShiftedByOne(before: DataState, after: DataState, today: string, to: string) {
  expect(title(after, today)).toBeNull();
  const want = eachDay(addDays(today, 1), to).map((d) => [d, title(before, addDays(d, -1))]);
  expect(scheduleSnapshot(after, addDays(today, 1), to)).toEqual(want);
}

describe('gymMissedAvailable', () => {
  test('gym_missed_availability', () => {
    const { ctx, s } = week();
    expect(gymMissedAvailable(s, ctx)).toBe(true);

    const tue = dayCtx('2026-10-20', 100);
    const solo = seedRoutine(emptyState(), tue, { title: 'Chest', repeatRule: 'weekly', startDate: MON });
    expect(gymMissedAvailable(solo, tue)).toBe(false);

    const skipped = run(s, skipToday(s, ctx));
    expect(gymMissedAvailable(skipped, ctx)).toBe(false);
    expectCode(() => skipToday(skipped, ctx), 'NOT_AVAILABLE');
    expectCode(() => shiftToday(skipped, ctx, 'catch_up'), 'NOT_AVAILABLE');

    const logged = logSets(s, ctx, MON, 'Bench press', [[10, 60]]);
    expect(gymMissedAvailable(logged, ctx)).toBe(false);
    const cleared = run(logged, syncSets(logged, ctx, { date: MON, position: 0, rows: [], includeUntouched: true }));
    expect(gymMissedAvailable(cleared, ctx)).toBe(true);
  });

  test('new_day_reevaluates_availability', () => {
    const ctx = makeCtx(MON);
    const s = seedRoutine(emptyState(), ctx, { title: 'Chest', repeatRule: 'weekly', startDate: MON });
    const s1 = run(s, skipToday(s, ctx));
    const tue = dayCtx('2026-10-20', 100);
    expect(gymMissedAvailable(s1, tue)).toBe(false);
    expect(restorableShift(s1, tue)).toBeNull();
    expect(gymMissedAvailable(s1, dayCtx('2026-10-26', 200))).toBe(true);
  });
});

describe('skip', () => {
  test('skip_marks_today_skipped_and_moves_nothing', () => {
    const { ctx, s } = week();
    const before = scheduleSnapshot(s, MON, '2026-11-15');
    const s1 = run(s, skipToday(s, ctx));
    expect(dayRow(s1, MON)?.status).toBe('skipped');
    expect(dayRow(s1, MON)?.title).toBe('Chest');
    expect(dayRow(s1, MON)?.shiftId).toBe(liveShift(s1)?.id);
    expect(scheduleSnapshot(s1, MON, '2026-11-15')).toEqual(before);
  });
});

describe('catch up', () => {
  test('catch_up_example_split', () => {
    const { ctx, s } = week();
    const s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    expect(dayRow(s1, MON)?.status).toBe('missed');
    expect(dayRow(s1, MON)?.title).toBe('Chest');
    expect(scheduleOn(s1, MON)).toBeNull();
    expect(scheduleSnapshot(s1, '2026-10-20', '2026-10-27')).toEqual([
      ['2026-10-20', 'Chest'],
      ['2026-10-21', 'Back'],
      ['2026-10-22', 'Legs'],
      ['2026-10-23', 'Shoulders'],
      ['2026-10-24', 'Arms'],
      ['2026-10-25', null],
      ['2026-10-26', 'Chest'],
      ['2026-10-27', 'Back'],
    ]);
  });

  test('catch_up_with_no_rest_day_equals_permanent', () => {
    const { ctx, s } = week();
    let full = seedRoutine(s, ctx, { title: 'Cardio', repeatRule: 'weekly', startDate: '2026-10-24' });
    full = seedRoutine(full, ctx, { title: 'Stretch', repeatRule: 'weekly', startDate: '2026-10-25' });
    const a = run(full, shiftToday(full, makeCtx(MON, 100), 'catch_up'));
    const b = run(full, shiftToday(full, makeCtx(MON, 100), 'permanent'));
    expect(scheduleSnapshot(a, MON, '2026-11-30')).toEqual(scheduleSnapshot(b, MON, '2026-11-30'));
    expect(title(a, '2026-10-20')).toBe('Chest');
    expect(title(a, '2026-10-26')).toBe('Stretch');
  });

  test('catch_up_shifts_compose_in_one_week', () => {
    const { ctx, s } = week();
    const s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    const tue = dayCtx('2026-10-20', 100);
    const s2 = run(s1, shiftToday(s1, tue, 'catch_up'));
    expect(dayRow(s2, '2026-10-20')?.status).toBe('missed');
    expect(dayRow(s2, '2026-10-20')?.title).toBe('Chest');
    expect(scheduleSnapshot(s2, '2026-10-20', '2026-10-26')).toEqual([
      ['2026-10-20', null],
      ['2026-10-21', 'Chest'],
      ['2026-10-22', 'Back'],
      ['2026-10-23', 'Legs'],
      ['2026-10-24', 'Shoulders'],
      ['2026-10-25', 'Arms'],
      ['2026-10-26', 'Chest'],
    ]);
  });
});

describe('permanent', () => {
  test('permanent_moves_twice_weekly_and_never', () => {
    const ctx = makeCtx(MON);
    let s = seedRoutine(emptyState(), ctx, { title: 'Chest', repeatRule: 'twice_weekly', startDate: MON });
    s = seedRoutine(s, ctx, { title: 'Arms', repeatRule: 'never', startDate: '2026-10-21' });
    const s1 = run(s, shiftToday(s, ctx, 'permanent'));
    expect(scheduleSnapshot(s1, MON, '2026-10-31')).toEqual([
      ['2026-10-19', null],
      ['2026-10-20', 'Chest'],
      ['2026-10-21', null],
      ['2026-10-22', 'Arms'],
      ['2026-10-23', 'Chest'],
      ['2026-10-24', null],
      ['2026-10-25', null],
      ['2026-10-26', null],
      ['2026-10-27', 'Chest'],
      ['2026-10-28', null],
      ['2026-10-29', null],
      ['2026-10-30', 'Chest'],
      ['2026-10-31', null],
    ]);
  });

  test('permanent_moves_weekly_biweekly_and_later_versions', () => {
    const ctx = makeCtx(MON);
    let s = seedRoutine(emptyState(), ctx, { title: 'Chest', repeatRule: 'weekly', startDate: MON });
    const chest = routineId(s, 'Chest');
    s = addVersion(s, ctx, chest, { effectiveFrom: '2026-11-02', title: 'Push' });
    s = seedRoutine(s, ctx, { title: 'Legs', repeatRule: 'biweekly', startDate: '2026-10-21' });
    const s1 = run(s, shiftToday(s, ctx, 'permanent'));
    const versions = getIndex(s1).versionsByRoutine.get(chest)!;
    expect(versions.map((v) => v.effectiveFrom)).toEqual(['2026-10-19', '2026-10-20', '2026-11-03']);
    expect(title(s1, '2026-10-26')).toBeNull();
    expect(title(s1, '2026-10-27')).toBe('Chest');
    expect(title(s1, '2026-11-02')).toBeNull();
    expect(title(s1, '2026-11-03')).toBe('Push');
    expect(title(s1, '2026-10-22')).toBe('Legs');
    expect(title(s1, '2026-10-29')).toBeNull();
    expect(title(s1, '2026-11-04')).toBeNull();
    expect(title(s1, '2026-11-05')).toBe('Legs');
    expectShiftedByOne(s, s1, MON, '2026-12-31');
  });

  test('occurrence_present_only_via_a_move_moves_to_tomorrow', () => {
    const ctx = makeCtx(MON);
    const s = seedRoutine(emptyState(), ctx, { title: 'Chest', repeatRule: 'weekly', startDate: MON });
    const s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    expect(title(s1, '2026-10-20')).toBe('Chest');
    const tue = dayCtx('2026-10-20', 100);
    const s2 = run(s1, shiftToday(s1, tue, 'permanent'));
    expect(title(s2, '2026-10-20')).toBeNull();
    expect(title(s2, '2026-10-21')).toBe('Chest');
    expect(title(s2, '2026-10-26')).toBeNull();
    expect(title(s2, '2026-10-27')).toBe('Chest');
  });

  test('permanent_after_a_catch_up_shifts_every_later_day_by_one', () => {
    const { ctx, s } = week();
    const s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    const tue = dayCtx('2026-10-20', 100);
    const s2 = run(s1, shiftToday(s1, tue, 'permanent'));
    expectShiftedByOne(s1, s2, '2026-10-20', '2026-12-31');
  });

  test('permanent_moves_todays_occurrence_when_a_version_starts_tomorrow', () => {
    const ctx = makeCtx(MON);
    let s = seedRoutine(emptyState(), ctx, { title: 'Chest', repeatRule: 'weekly', startDate: MON });
    s = addVersion(s, ctx, routineId(s, 'Chest'), { effectiveFrom: '2026-10-20', repeatRule: 'twice_weekly', startDate: '2026-10-20' });
    const s1 = run(s, shiftToday(s, ctx, 'permanent'));
    expect(title(s1, '2026-10-20')).toBe('Chest');
    expectShiftedByOne(s, s1, MON, '2026-12-31');
  });
});

describe('restore', () => {
  for (const mode of ['skip', 'catch_up', 'permanent'] as const) {
    test(`restore_returns_the_exact_prior_schedule (${mode})`, () => {
      const { ctx, s } = week();
      const before = scheduleSnapshot(s, MON, '2026-12-31');
      const s1 = run(s, mode === 'skip' ? skipToday(s, ctx) : shiftToday(s, ctx, mode));
      const shift = restorableShift(s1, ctx)!;
      expect(shift).not.toBeNull();
      const dayId = dayRow(s1, MON)!.id;
      const s2 = run(s1, restoreShift(s1, ctx, shift.id));
      expect(scheduleSnapshot(s2, MON, '2026-12-31')).toEqual(before);
      expect(dayRow(s2, MON)).toBeUndefined();
      expect(s2.days.get(dayId)?.deletedAt).not.toBeNull();
      expect(s2.shifts.get(shift.id)?.deletedAt).not.toBeNull();
      expect(gymMissedAvailable(s2, ctx)).toBe(true);
    });
  }

  test('restore_keeps_a_day_row_that_existed_before_the_shift', () => {
    const { ctx, s } = week();
    const logged = logSets(s, ctx, MON, 'Bench press', [[10, 60]]);
    const s0 = run(logged, syncSets(logged, ctx, { date: MON, position: 0, rows: [], includeUntouched: true }));
    const prior = dayRow(s0, MON)!;
    const s1 = run(s0, shiftToday(s0, ctx, 'catch_up'));
    const s2 = run(s1, restoreShift(s1, ctx, restorableShift(s1, ctx)!.id));
    expect(dayRow(s2, MON)).toMatchObject({ id: prior.id, status: null, shiftId: null, hasLog: true, title: 'Chest' });
    expect(title(s2, '2026-10-20')).toBe('Back');
  });

  test('restore_not_offered_after_a_schedule_edit', () => {
    const { ctx, s } = week();
    const s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    const shiftId = restorableShift(s1, ctx)!.id;
    const s2 = run(s1, addExercise(s1, ctx, { date: MON, name: 'Dip' }));
    expect(restorableShift(s2, ctx)).toBeNull();
    expectCode(() => restoreShift(s2, ctx, shiftId), 'NOT_AVAILABLE');
  });

  test('logging_a_set_does_not_block_restore', () => {
    const { ctx, s } = week();
    const before = scheduleSnapshot(s, MON, '2026-12-31');
    const s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    const s2 = logSets(s1, ctx, MON, 'Bench press', [[8, 70]]);
    const shift = restorableShift(s2, ctx);
    expect(shift).not.toBeNull();
    const s3 = run(s2, restoreShift(s2, ctx, shift!.id));
    expect(scheduleSnapshot(s3, MON, '2026-12-31')).toEqual(before);
    // The sets logged after the shift survive; only the status comes off.
    expect(dayRow(s3, MON)).toMatchObject({ status: null, shiftId: null, hasLog: true, title: 'Chest' });
    const bench = getIndex(s3).exercisesByDate.get(MON)![0];
    expect(getIndex(s3).setsByExercise.get(bench.id)?.map((x) => [x.reps, x.weightKg])).toEqual([[8, 70]]);
  });

  test('restore_not_offered_the_next_day', () => {
    const { ctx, s } = week();
    const s1 = run(s, skipToday(s, ctx));
    const shiftId = restorableShift(s1, ctx)!.id;
    const tue = dayCtx('2026-10-20', 100);
    expect(restorableShift(s1, tue)).toBeNull();
    expectCode(() => restoreShift(s1, tue, shiftId), 'NOT_AVAILABLE');
  });

  test('restore_rejects_an_unknown_shift_id', () => {
    const { ctx, s } = week();
    const s1 = run(s, skipToday(s, ctx));
    expectCode(() => restoreShift(s1, ctx, 'nope'), 'NOT_AVAILABLE');
  });
});

describe('previewShift', () => {
  test('preview_text_uses_real_names', () => {
    const { ctx, s } = week();
    expect(previewShift(s, ctx, 'catch_up').text).toBe('Arms moves to Sat. Back to your usual days next Monday.');
    expect(previewShift(s, ctx, 'permanent').text).toBe('Chest moves to Tuesdays from now on.');
    let full = seedRoutine(s, ctx, { title: 'Cardio', repeatRule: 'weekly', startDate: '2026-10-24' });
    full = seedRoutine(full, ctx, { title: 'Stretch', repeatRule: 'weekly', startDate: '2026-10-25' });
    expect(previewShift(full, ctx, 'catch_up').text).toBe(previewShift(full, ctx, 'permanent').text);
  });
});
