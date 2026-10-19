import { describe, expect, test } from 'vitest';
import { startBackfill } from '../dayLog';
import { getDay, earliestDataDate } from '../dayView';
import { addExercise, changeSchedule, renameExercise } from '../scheduleEdits';
import { shiftToday } from '../shift';
import { emptyState } from '../state';
import { logSets, makeCtx, routineId, run, seedRoutine } from './fixtures';

const MON = '2026-10-19';
const CHEST = ['Bench press', 'Incline dumbbell press', 'Cable fly', 'Tricep pushdown'];

function chest(today = MON) {
  const ctx = makeCtx(today);
  const s = seedRoutine(emptyState(), ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate: MON, exercises: CHEST });
  return { ctx, s, id: routineId(s, 'Chest & Tricep') };
}

describe('getDay', () => {
  test('today_with_routine_lists_scheduled_exercises_and_summary', () => {
    const { ctx, s, id } = chest();
    const v = getDay(s, ctx, MON);
    expect(v.kind).toBe('today');
    expect(v.routine).toEqual({ routineId: id, title: 'Chest & Tricep', repeatRule: 'weekly', startDate: MON, source: 'schedule' });
    expect(v.exercises.map((x) => x.name)).toEqual(CHEST);
    expect(v.exercises[0]).toEqual({ position: 0, name: 'Bench press', setCount: 3, summary: '3 sets' });
    expect(v.totals).toEqual({ exercises: 4, sets: 12, volumeKg: 0 });
    expect(v).toMatchObject({ status: null, hasLog: false, canEditSchedule: true, canLogSets: true, canBackfill: false, canGymMissed: true, restoreShiftId: null });
  });

  test('logged_day_uses_log_values_after_routine_rename', () => {
    const { s, id } = chest();
    const ctx = makeCtx('2026-10-26', 100);
    let s1 = logSets(s, ctx, MON, 'Bench press', [[10, 60], [8, 70]]);
    s1 = run(s1, changeSchedule(s1, ctx, { routineId: id, date: '2026-10-26', title: 'Push', repeatRule: 'weekly' }));
    s1 = run(s1, renameExercise(s1, ctx, { date: '2026-10-26', position: 0, name: 'Flat bench' }));
    const v = getDay(s1, ctx, MON);
    expect(v.kind).toBe('past');
    expect(v.hasLog).toBe(true);
    expect(v.routine).toMatchObject({ routineId: id, title: 'Chest & Tricep', repeatRule: 'weekly', startDate: MON, source: 'log' });
    expect(v.exercises.map((x) => x.name)).toEqual(CHEST);
    expect(v.exercises[0].summary).toBe('2 sets · 8 reps · 70 kg');
    expect(v.totals.volumeKg).toBe(1160);
    expect(getDay(s1, ctx, '2026-10-26').routine?.title).toBe('Push');
    expect(getDay(s1, ctx, '2026-10-26').exercises[0].name).toBe('Flat bench');
  });

  test('future_day_is_schedule_editable_but_not_loggable_flags', () => {
    const { ctx, s } = chest();
    const v = getDay(s, ctx, '2026-10-26');
    expect(v).toMatchObject({ kind: 'future', canEditSchedule: true, canLogSets: false, canBackfill: false, canGymMissed: false });
    expect(v.routine?.title).toBe('Chest & Tricep');
    expect(v.exercises).toHaveLength(4);
  });

  test('past_unlogged_scheduled_day_lists_exercises_without_sets_and_cannot_edit_schedule', () => {
    const { s } = chest();
    const ctx = makeCtx('2026-10-21', 100);
    const v = getDay(s, ctx, MON);
    expect(v).toMatchObject({ kind: 'past', hasLog: false, canEditSchedule: false, canLogSets: true, canBackfill: false, canGymMissed: false });
    expect(v.routine?.source).toBe('schedule');
    expect(v.exercises.map((x) => x.summary)).toEqual(['3 sets', '3 sets', '3 sets', '3 sets']);
  });

  test('empty_past_day_can_backfill', () => {
    const { s } = chest();
    const ctx = makeCtx('2026-10-21', 100);
    const v = getDay(s, ctx, '2026-10-20');
    expect(v).toMatchObject({ kind: 'past', routine: null, exercises: [], hasLog: false, canBackfill: true, canLogSets: false, canEditSchedule: false, nextUp: null });
    expect(v.totals).toEqual({ exercises: 0, sets: 0, volumeKg: 0 });
  });

  test('backfilled_day_has_source_backfill_and_no_schedule_controls', () => {
    const { s } = chest();
    const ctx = makeCtx('2026-10-21', 100);
    let s1 = run(s, startBackfill(s, ctx, { date: '2026-10-20', title: 'Cardio' }));
    s1 = run(s1, addExercise(s1, ctx, { date: '2026-10-20', name: 'Rowing' }));
    const v = getDay(s1, ctx, '2026-10-20');
    expect(v.routine).toEqual({ routineId: null, title: 'Cardio', repeatRule: null, startDate: null, source: 'backfill' });
    expect(v).toMatchObject({ hasLog: true, canBackfill: false, canEditSchedule: false, canLogSets: true, nextUp: null });
    expect(v.exercises.map((x) => x.name)).toEqual(['Rowing']);
  });

  test('missed_today_after_catch_up_shows_title_badge_status_and_restoreShiftId', () => {
    const { ctx, s, id } = chest();
    const changes = shiftToday(s, ctx, 'catch_up');
    const s1 = run(s, changes);
    const shiftId = changes.find((c) => c.table === 'shifts')!.row.id;
    const v = getDay(s1, ctx, MON);
    expect(v.status).toBe('missed');
    expect(v.routine).toMatchObject({ routineId: id, title: 'Chest & Tricep', source: 'log' });
    expect(v.exercises.map((x) => x.name)).toEqual(CHEST);
    expect(v.restoreShiftId).toBe(shiftId);
    expect(v.canGymMissed).toBe(false);
    expect(getDay(s1, ctx, '2026-10-20').routine?.title).toBe('Chest & Tricep');
  });

  test('restoreShiftId_null_after_edit', () => {
    const { ctx, s } = chest();
    let s1 = run(s, shiftToday(s, ctx, 'catch_up'));
    s1 = run(s1, addExercise(s1, ctx, { date: '2026-10-20', name: 'Dip' }));
    const v = getDay(s1, ctx, MON);
    expect(v.status).toBe('missed');
    expect(v.restoreShiftId).toBeNull();
    expect(getDay(s1, ctx, '2026-10-20').restoreShiftId).toBeNull();
  });

  test('nextUp_for_weekly_routine', () => {
    const { ctx, s } = chest();
    expect(getDay(s, ctx, MON).nextUp).toBe('2026-10-26');
    expect(getDay(s, ctx, '2026-10-26').nextUp).toBe('2026-11-02');
  });
});

describe('earliestDataDate', () => {
  test('earliestDataDate', () => {
    expect(earliestDataDate(emptyState(), makeCtx(MON))).toBe(MON);
    const ctx = makeCtx('2026-10-21', 100);
    const s = seedRoutine(emptyState(), ctx, { title: 'Later', repeatRule: 'weekly', startDate: '2026-11-02' });
    expect(earliestDataDate(s, ctx)).toBe('2026-10-21');
    const s1 = seedRoutine(s, ctx, { title: 'Chest', repeatRule: 'weekly', startDate: '2026-10-12' });
    expect(earliestDataDate(s1, ctx)).toBe('2026-10-12');
    const s2 = run(s1, startBackfill(s1, ctx, { date: '2026-10-01', title: 'Run' }));
    expect(earliestDataDate(s2, ctx)).toBe('2026-10-01');
  });
});
