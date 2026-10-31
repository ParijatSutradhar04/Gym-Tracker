import { describe, expect, test } from 'vitest';
import { deleteExercise, renameExercise } from '../scheduleEdits';
import { prefillRows, syncSets } from '../sets';
import { emptyState, getIndex } from '../state';
import type { DataState } from '../types';
import { logSets, makeCtx, run, seedRoutine } from './fixtures';

const TODAY = '2026-10-19';
const PAST = '2026-10-12';

function curls(today = TODAY) {
  const ctx = makeCtx(today);
  const s = seedRoutine(emptyState(), ctx, {
    title: 'Arms',
    repeatRule: 'weekly',
    startDate: '2026-10-05',
    exercises: ['Preacher curl', 'Hammer curl', 'Cable curl'],
  });
  return { ctx, s };
}

const orders = (s: DataState, date = TODAY) =>
  Object.fromEntries((getIndex(s).exercisesByDate.get(date) ?? []).map((x) => [x.name, x.performedOrder]));

function setOrder(s: DataState, date: string, name: string, performedOrder: number | null): DataState {
  const x = getIndex(s).exercisesByDate.get(date)!.find((e) => e.name === name)!;
  return run(s, [{ table: 'day_exercises', row: { ...x, performedOrder } }]);
}

describe('performed order', () => {
  test('first_logged_set_gets_the_next_number', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14]]);
    s = logSets(s, ctx, TODAY, 'Preacher curl', [[10, 20]]);
    expect(orders(s)).toEqual({ 'Preacher curl': 2, 'Hammer curl': 1, 'Cable curl': null });
  });

  test('later_sets_never_change_the_number', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14]]);
    s = logSets(s, ctx, TODAY, 'Preacher curl', [[10, 20]]);
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14], [8, 14]]);
    expect(orders(s)).toMatchObject({ 'Hammer curl': 1, 'Preacher curl': 2 });
  });

  test('weight_only_row_gets_no_number_until_reps', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[null, 20]]);
    expect(orders(s)['Hammer curl']).toBeNull();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 20]]);
    expect(orders(s)['Hammer curl']).toBe(1);
  });

  test('done_on_prefilled_rows_assigns_the_number', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, PAST, 'Cable curl', [[12, 30]]);
    const rows = prefillRows(s, TODAY, 'Cable curl');
    s = run(s, syncSets(s, ctx, { date: TODAY, position: 2, rows, includeUntouched: true }));
    expect(orders(s)['Cable curl']).toBe(1);
  });

  function threeLogged() {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Preacher curl', [[10, 20]]);
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14]]);
    s = logSets(s, ctx, TODAY, 'Cable curl', [[12, 30]]);
    return { ctx, s };
  }

  test('clearing_the_last_logged_set_removes_the_number_and_closes_the_gap', () => {
    let { ctx, s } = threeLogged();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[null, null]]);
    expect(orders(s)).toEqual({ 'Preacher curl': 1, 'Hammer curl': null, 'Cable curl': 2 });
  });

  test('deleting_every_row_removes_the_number', () => {
    let { ctx, s } = threeLogged();
    s = run(s, syncSets(s, ctx, { date: TODAY, position: 1, rows: [], includeUntouched: true }));
    expect(orders(s)).toEqual({ 'Preacher curl': 1, 'Hammer curl': null, 'Cable curl': 2 });
  });

  test('order_change_is_in_the_same_change_set_as_the_set', () => {
    const { ctx, s } = curls();
    const changes = syncSets(s, ctx, {
      date: TODAY,
      position: 1,
      rows: [{ reps: 10, weightKg: 14, touched: true, isDrop: false }],
      includeUntouched: false,
    });
    expect(changes.some((c) => c.table === 'sets')).toBe(true);
    const exercise = changes.filter((c) => c.table === 'day_exercises' && c.row.id === getIndex(run(s, changes)).exercisesByDate.get(TODAY)![1].id);
    expect(exercise.map((c) => (c.row as { performedOrder: number | null }).performedOrder)).toEqual([1]);
  });

  test('exercise_logged_before_the_update_stays_unnumbered', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Preacher curl', [[10, 20]]);
    s = setOrder(s, TODAY, 'Preacher curl', null);
    s = logSets(s, ctx, TODAY, 'Preacher curl', [[10, 20], [8, 20]]);
    expect(orders(s)['Preacher curl']).toBeNull();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14]]);
    expect(orders(s)).toMatchObject({ 'Preacher curl': null, 'Hammer curl': 1 });
  });

  test('duplicate_numbers_from_a_merge_are_kept', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Preacher curl', [[10, 20]]);
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14]]);
    s = setOrder(s, TODAY, 'Hammer curl', 1);
    s = logSets(s, ctx, TODAY, 'Cable curl', [[12, 30]]);
    expect(orders(s)).toEqual({ 'Preacher curl': 1, 'Hammer curl': 1, 'Cable curl': 2 });
  });

  for (const date of [PAST, TODAY]) {
    test(`deleting_an_exercise_removes_its_number_and_closes_the_gap (${date})`, () => {
      let { ctx, s } = curls();
      for (const name of ['Preacher curl', 'Hammer curl', 'Cable curl']) s = logSets(s, ctx, date, name, [[10, 20]]);
      s = run(s, deleteExercise(s, ctx, { date, position: 1 }));
      expect(orders(s, date)).toEqual({ 'Preacher curl': 1, 'Cable curl': 2 });
    });
  }

  test('rename_keeps_the_number', () => {
    let { ctx, s } = curls();
    s = logSets(s, ctx, TODAY, 'Hammer curl', [[10, 14]]);
    s = run(s, renameExercise(s, ctx, { date: TODAY, position: 1, name: 'Rope hammer curl' }));
    expect(orders(s)['Rope hammer curl']).toBe(1);
  });
});
