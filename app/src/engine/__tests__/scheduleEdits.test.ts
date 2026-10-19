import { describe, expect, test } from 'vitest';
import { dayExercises, ensureDayLog } from '../dayLog';
import { scheduleOn } from '../schedule';
import {
  addExercise,
  addSchedule,
  changeSchedule,
  deleteExercise,
  renameExercise,
  routineTitleSuggestions,
  setsLostOnDelete,
  stopRoutine,
} from '../scheduleEdits';
import { emptyState, getIndex, liveRows } from '../state';
import type { DataState } from '../types';
import { addMove, expectCode, logSets, makeCtx, routineId, run, seedRoutine } from './fixtures';

function chest(today = '2026-10-19', startDate = '2026-10-19', exercises = ['Bench press', 'Cable fly']) {
  const ctx = makeCtx(today);
  const s = seedRoutine(emptyState(), ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate, exercises });
  return { ctx, s, id: routineId(s, 'Chest & Tricep') };
}

const title = (s: DataState, d: string) => scheduleOn(s, d)?.title ?? null;
const versions = (s: DataState, id: string) => getIndex(s).versionsByRoutine.get(id) ?? [];

describe('changeSchedule', () => {
  test('edit_forward_rename_and_repeat_leaves_earlier_dates_untouched', () => {
    const { ctx, s, id } = chest('2026-11-02');
    const s1 = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-11-02', title: 'Push', repeatRule: 'twice_weekly' }));
    expect(title(s1, '2026-10-19')).toBe('Chest & Tricep');
    expect(title(s1, '2026-10-26')).toBe('Chest & Tricep');
    expect(title(s1, '2026-11-02')).toBe('Push');
    expect(title(s1, '2026-11-05')).toBe('Push');
    expect(title(s1, '2026-11-09')).toBe('Push');
    expect(title(s1, '2026-11-03')).toBeNull();
  });

  test('rename_only_keeps_the_anchor', () => {
    const { ctx, s, id } = chest();
    const s1 = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-11-04', title: 'Chest Day', repeatRule: 'weekly' }));
    expect(title(s1, '2026-11-09')).toBe('Chest Day');
    expect(title(s1, '2026-11-04')).toBeNull();
    expect(title(s1, '2026-11-02')).toBe('Chest & Tricep');
    expect(scheduleOn(s1, '2026-11-09')?.exercises).toEqual(['Bench press', 'Cable fly']);
  });

  test('repeat_change_reanchors_to_the_chosen_date', () => {
    const { ctx, s, id } = chest();
    const s1 = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-11-04', title: 'Chest & Tricep', repeatRule: 'biweekly' }));
    expect(title(s1, '2026-11-04')).toBe('Chest & Tricep');
    expect(title(s1, '2026-11-18')).toBe('Chest & Tricep');
    expect(title(s1, '2026-11-09')).toBeNull();
    expect(title(s1, '2026-11-11')).toBeNull();
  });

  test('change_on_same_effective_date_updates_in_place', () => {
    const { ctx, s, id } = chest();
    let s1 = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-11-04', title: 'A', repeatRule: 'weekly' }));
    s1 = run(s1, changeSchedule(s1, ctx, { routineId: id, date: '2026-11-04', title: 'B', repeatRule: 'weekly' }));
    expect(versions(s1, id).map((v) => [v.effectiveFrom, v.title])).toEqual([
      ['2026-10-19', 'Chest & Tricep'],
      ['2026-11-04', 'B'],
    ]);
  });

  test('change_tombstones_later_versions', () => {
    const { ctx, s, id } = chest();
    let s1 = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-11-16', title: 'Later', repeatRule: 'weekly' }));
    s1 = run(s1, changeSchedule(s1, ctx, { routineId: id, date: '2026-11-02', title: 'Push', repeatRule: 'weekly' }));
    expect(versions(s1, id).map((v) => v.title)).toEqual(['Chest & Tricep', 'Push']);
    expect(title(s1, '2026-11-16')).toBe('Push');
  });

  test('change_in_the_past_throws_NOT_EDITABLE_PAST', () => {
    const { ctx, s, id } = chest('2026-10-20');
    expectCode(() => changeSchedule(s, ctx, { routineId: id, date: '2026-10-19', title: 'X', repeatRule: 'weekly' }), 'NOT_EDITABLE_PAST');
  });

  test('change_on_ended_routine_throws_NOT_FOUND', () => {
    const { ctx, s, id } = chest();
    const s1 = run(s, stopRoutine(s, ctx, { routineId: id, date: '2026-10-26' }));
    expectCode(() => changeSchedule(s1, ctx, { routineId: id, date: '2026-11-02', title: 'X', repeatRule: 'weekly' }), 'NOT_FOUND');
    expectCode(() => changeSchedule(s1, ctx, { routineId: 'nope', date: '2026-11-02', title: 'X', repeatRule: 'weekly' }), 'NOT_FOUND');
  });
});

describe('addSchedule and stopRoutine', () => {
  test('addSchedule_creates_routine_and_version', () => {
    const ctx = makeCtx('2026-10-19');
    const s = run(emptyState(), addSchedule(emptyState(), ctx, { date: '2026-10-21', title: 'Legs', repeatRule: 'weekly', exercises: ['Squat'] }));
    expect(liveRows(s, 'routines')).toHaveLength(1);
    expect(scheduleOn(s, '2026-10-28')).toMatchObject({ title: 'Legs', startDate: '2026-10-21', exercises: ['Squat'] });
    expectCode(() => addSchedule(s, ctx, { date: '2026-10-18', title: 'Old', repeatRule: 'weekly' }), 'NOT_EDITABLE_PAST');
  });

  test('stop_routine_ends_from_date', () => {
    const { ctx, s: s0, id } = chest();
    const s = run(s0, ensureDayLog(s0, ctx, '2026-10-19'));
    const s1 = run(s, stopRoutine(s, ctx, { routineId: id, date: '2026-11-02' }));
    expect(title(s1, '2026-10-26')).toBe('Chest & Tricep');
    expect(title(s1, '2026-11-02')).toBeNull();
    expect(title(s1, '2026-11-09')).toBeNull();
    expect(getIndex(s1).dayByDate.get('2026-10-19')?.title).toBe('Chest & Tricep');
  });
});

describe('exercise edits', () => {
  test('deleting_exercise_today_does_not_touch_past_logs', () => {
    let { ctx, s } = chest('2026-10-19', '2026-10-05');
    s = logSets(s, ctx, '2026-10-12', 'Cable fly', [[12, 20]]);
    const pastFly = getIndex(s).exercisesByDate.get('2026-10-12')![1];
    s = run(s, deleteExercise(s, ctx, { date: '2026-10-19', position: 1 }));
    expect(s.day_exercises.get(pastFly.id)?.deletedAt).toBeNull();
    expect(getIndex(s).setsByExercise.get(pastFly.id)).toHaveLength(1);
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Bench press']);
    expect(scheduleOn(s, '2026-10-19')?.exercises).toEqual(['Bench press']);
    expect(dayExercises(s, '2026-10-05').map((x) => x.name)).toEqual(['Bench press', 'Cable fly']);
  });

  test('exercise_edit_today_updates_todays_log_too', () => {
    let { ctx, s } = chest();
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 60]]);
    const bench = getIndex(s).exercisesByDate.get('2026-10-19')![0];
    s = run(s, renameExercise(s, ctx, { date: '2026-10-19', position: 0, name: 'Flat bench' }));
    const renamed = getIndex(s).exercisesByDate.get('2026-10-19')![0];
    expect(renamed).toMatchObject({ id: bench.id, name: 'Flat bench' });
    expect(getIndex(s).setsByExercise.get(bench.id)).toHaveLength(2);
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Flat bench', 'Cable fly']);
    s = run(s, deleteExercise(s, ctx, { date: '2026-10-19', position: 0 }));
    expect(dayExercises(s, '2026-10-19').map((x) => x.name)).toEqual(['Cable fly']);
    expect(getIndex(s).setsByExercise.get(bench.id)).toBeUndefined();
    expect(liveRows(s, 'sets')).toHaveLength(0);
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Cable fly']);
    s = run(s, addExercise(s, ctx, { date: '2026-10-19', name: 'Dips' }));
    expect(dayExercises(s, '2026-10-19').map((x) => x.name)).toEqual(['Cable fly', 'Dips']);
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Cable fly', 'Dips']);
  });

  test('exercise_edit_propagates_to_later_versions', () => {
    let { ctx, s, id } = chest();
    s = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-11-16', title: 'Chest Later', repeatRule: 'weekly' }));
    s = run(s, addExercise(s, ctx, { date: '2026-10-19', name: 'Dips' }));
    s = run(s, renameExercise(s, ctx, { date: '2026-10-19', position: 0, name: 'Flat bench' }));
    s = run(s, deleteExercise(s, ctx, { date: '2026-10-19', position: 1 }));
    expect(scheduleOn(s, '2026-11-16')).toMatchObject({ title: 'Chest Later', exercises: ['Flat bench', 'Dips'] });
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Flat bench', 'Dips']);
  });

  test('future_edit_changes_only_versions_from_that_date', () => {
    let { ctx, s } = chest();
    s = run(s, addExercise(s, ctx, { date: '2026-11-02', name: 'Dips' }));
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Bench press', 'Cable fly']);
    expect(scheduleOn(s, '2026-11-02')?.exercises).toEqual(['Bench press', 'Cable fly', 'Dips']);
    expect(liveRows(s, 'days')).toHaveLength(0);
  });

  test('exercise_edit_on_past_day_changes_only_that_log', () => {
    let { ctx, s } = chest('2026-10-26');
    const before = liveRows(s, 'routine_versions').map((v) => [v.id, v.updatedAt]);
    s = run(s, addExercise(s, ctx, { date: '2026-10-19', name: 'Dips' }));
    s = run(s, renameExercise(s, ctx, { date: '2026-10-19', position: 0, name: 'Incline' }));
    s = run(s, deleteExercise(s, ctx, { date: '2026-10-19', position: 1 }));
    expect(liveRows(s, 'routine_versions').map((v) => [v.id, v.updatedAt])).toEqual(before);
    expect(dayExercises(s, '2026-10-19').map((x) => x.name)).toEqual(['Incline', 'Dips']);
    expect(scheduleOn(s, '2026-10-26')?.exercises).toEqual(['Bench press', 'Cable fly']);
  });

  test('exercise_edit_on_past_day_without_routine_or_log_throws_NO_ROUTINE', () => {
    const { ctx, s } = chest('2026-10-26');
    expectCode(() => addExercise(s, ctx, { date: '2026-10-20', name: 'Dips' }), 'NO_ROUTINE');
    expectCode(() => addExercise(s, ctx, { date: '2026-10-27', name: 'Dips' }), 'NO_ROUTINE');
  });

  test('sets_lost_on_delete_counts_what_deleteExercise_removes', () => {
    let { ctx, s } = chest('2026-10-19', '2026-10-12');
    expect(setsLostOnDelete(s, '2026-10-19', 0)).toBe(0);
    s = logSets(s, ctx, '2026-10-19', 'Bench press', [[10, 60], [8, 60]]);
    s = logSets(s, ctx, '2026-10-12', 'Cable fly', [[12, 20]]);
    const removed = (date: string, position: number) =>
      deleteExercise(s, ctx, { date, position }).filter((c) => c.table === 'sets').length;
    expect(setsLostOnDelete(s, '2026-10-19', 0)).toBe(2);
    expect(setsLostOnDelete(s, '2026-10-19', 0)).toBe(removed('2026-10-19', 0));
    expect(setsLostOnDelete(s, '2026-10-19', 1)).toBe(0);
    expect(setsLostOnDelete(s, '2026-10-12', 1)).toBe(removed('2026-10-12', 1));
    expect(setsLostOnDelete(s, '2026-10-12', 1)).toBe(1);
    expect(setsLostOnDelete(s, '2026-10-26', 0)).toBe(0);
  });

  test('position_out_of_range_throws_NOT_FOUND', () => {
    const { ctx, s } = chest();
    expectCode(() => renameExercise(s, ctx, { date: '2026-10-19', position: 2, name: 'X' }), 'NOT_FOUND');
    expectCode(() => deleteExercise(s, ctx, { date: '2026-10-19', position: -1 }), 'NOT_FOUND');
  });

  test('blank_names_rejected_and_names_trimmed', () => {
    const { ctx, s } = chest();
    expectCode(() => addSchedule(s, ctx, { date: '2026-10-20', title: '   ', repeatRule: 'weekly' }), 'EMPTY_NAME');
    expectCode(() => addExercise(s, ctx, { date: '2026-10-19', name: '  ' }), 'EMPTY_NAME');
    expectCode(() => renameExercise(s, ctx, { date: '2026-10-19', position: 0, name: ' ' }), 'EMPTY_NAME');
    let s1 = run(s, addSchedule(s, ctx, { date: '2026-10-20', title: '  Squat  ', repeatRule: 'weekly' }));
    expect(title(s1, '2026-10-20')).toBe('Squat');
    s1 = run(s1, addExercise(s1, ctx, { date: '2026-10-19', name: '  Squat  ' }));
    s1 = run(s1, renameExercise(s1, ctx, { date: '2026-10-19', position: 0, name: '  Front squat ' }));
    expect(scheduleOn(s1, '2026-10-19')?.exercises).toEqual(['Front squat', 'Cable fly', 'Squat']);
  });

  test('edit_on_a_moved_occurrence_carries_forward_from_its_new_date', () => {
    const ctx = makeCtx('2026-10-24');
    let s = seedRoutine(emptyState(), ctx, { title: 'Arms', repeatRule: 'weekly', startDate: '2026-10-23', exercises: ['Curl'] });
    const id = routineId(s, 'Arms');
    s = addMove(s, ctx, { routineId: id, fromDate: '2026-10-23', toDate: '2026-10-24' });

    const renamed = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-10-24', title: 'Arms+', repeatRule: 'weekly' }));
    expect(title(renamed, '2026-10-24')).toBe('Arms+');
    expect(title(renamed, '2026-10-30')).toBe('Arms+');
    expect(title(renamed, '2026-10-23')).toBeNull();

    const re = run(s, changeSchedule(s, ctx, { routineId: id, date: '2026-10-24', title: 'Arms', repeatRule: 'biweekly' }));
    expect(title(re, '2026-10-24')).toBe('Arms');
    expect(title(re, '2026-11-07')).toBe('Arms');
    expect(title(re, '2026-10-30')).toBeNull();
    expect(title(re, '2026-10-31')).toBeNull();

    const added = run(s, addExercise(s, ctx, { date: '2026-10-24', name: 'Dip' }));
    expect(scheduleOn(added, '2026-10-24')?.exercises).toEqual(['Curl', 'Dip']);
    expect(scheduleOn(added, '2026-10-30')?.exercises).toEqual(['Curl', 'Dip']);
    expect(getIndex(added).versionsByRoutine.get(id)!.map((v) => [v.effectiveFrom, v.exercises])).toEqual([
      ['2026-10-23', ['Curl']],
      ['2026-10-24', ['Curl', 'Dip']],
    ]);
  });
});

describe('suggestions', () => {
  test('suggestions_are_distinct_recent_first_and_include_ended', () => {
    const ctx = makeCtx('2026-10-19');
    let s = seedRoutine(emptyState(), ctx, { title: 'Legs', repeatRule: 'weekly', startDate: '2026-10-19', exercises: ['Squat'] });
    s = seedRoutine(s, ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate: '2026-10-20', exercises: ['Bench press'] });
    s = seedRoutine(s, ctx, { title: 'legs', repeatRule: 'weekly', startDate: '2026-10-21', exercises: ['Lunge'] });
    const latestLegs = routineId(s, 'legs');
    s = run(s, addExercise(s, ctx, { date: '2026-10-28', name: 'Calf raise' }));
    s = run(s, stopRoutine(s, ctx, { routineId: latestLegs, date: '2026-11-04' }));
    expect(routineTitleSuggestions(s, 'leg')).toEqual([{ title: 'legs', exercises: ['Lunge', 'Calf raise'] }]);
    expect(routineTitleSuggestions(s, '').map((x) => x.title)).toEqual(['legs', 'Chest & Tricep']);
  });
});

describe('lockTodaysShift', () => {
  test('schedule_edits_lock_todays_shift', () => {
    const base = chest('2026-10-19', '2026-10-12');
    const s = run(base.s, [
      {
        table: 'shifts',
        row: { id: 'sh1', updatedAt: '2026-10-19T08:00:00.000Z', deletedAt: null, date: '2026-10-19', mode: 'skip', locked: false, created: [], before: [] },
      },
    ]);
    const { ctx, id } = base;
    const locks = (changes: ReturnType<typeof addExercise>) =>
      changes.some((c) => c.table === 'shifts' && c.row.id === 'sh1' && c.row.locked);
    expect(locks(addSchedule(s, ctx, { date: '2026-10-20', title: 'Legs', repeatRule: 'weekly' }))).toBe(true);
    expect(locks(changeSchedule(s, ctx, { routineId: id, date: '2026-10-26', title: 'X', repeatRule: 'weekly' }))).toBe(true);
    expect(locks(stopRoutine(s, ctx, { routineId: id, date: '2026-10-26' }))).toBe(true);
    expect(locks(addExercise(s, ctx, { date: '2026-10-19', name: 'Dips' }))).toBe(true);
    expect(locks(renameExercise(s, ctx, { date: '2026-10-26', position: 0, name: 'Y' }))).toBe(true);
    expect(locks(deleteExercise(s, ctx, { date: '2026-10-19', position: 0 }))).toBe(true);
    expect(locks(addExercise(s, ctx, { date: '2026-10-12', name: 'Dips' }))).toBe(false);
  });
});
