import { describe, expect, test } from 'vitest';
import { loggedExercises } from '../dayLog';
import { getDay } from '../dayView';
import { addExercise, deleteExercise } from '../scheduleEdits';
import { persistedSets, syncSets } from '../sets';
import { skipToday } from '../shift';
import { emptyState, liveRows, mergeRemote, TABLES } from '../state';
import type { Change, Ctx, DataState } from '../types';
import { logSets, makeCtx, run, seedRoutine } from './fixtures';

const TODAY = '2026-10-19';

/** A synced base with one weekly routine, and two devices editing their own copies; B's clock runs a minute ahead. */
function twoDevices(exercises = ['Bench press', 'Cable fly']) {
  const base = seedRoutine(emptyState(), makeCtx(TODAY), {
    title: 'Chest & Tricep',
    repeatRule: 'weekly',
    startDate: TODAY,
    exercises,
  });
  return { base, a: makeCtx(TODAY, 1000), b: makeCtx(TODAY, 2000, 60_000) };
}

/** Every row `state` holds that `base` does not hold as the same object: what that device would push. */
function changesSince(base: DataState, state: DataState): Change[] {
  return TABLES.flatMap((table) => {
    const before = base[table] as Map<string, unknown>;
    return [...(state[table] as Map<string, Change['row']>).values()]
      .filter((row) => before.get(row.id) !== row)
      .map((row) => ({ table, row }) as Change);
  });
}

/** Each device merges everything the other wrote since `base`. */
function exchange(base: DataState, a: DataState, b: DataState): [DataState, DataState] {
  return [mergeRemote(a, changesSince(base, b)).state, mergeRemote(b, changesSince(base, a)).state];
}

function live(state: DataState) {
  return Object.fromEntries(TABLES.map((t) => [t, liveRows(state, t).sort((x, y) => (x.id < y.id ? -1 : 1))]));
}

function names(state: DataState, ctx: Ctx) {
  return getDay(state, ctx, TODAY).exercises.map((x) => x.name);
}

function sets(state: DataState, position: number) {
  return persistedSets(state, TODAY, position).map((s) => [s.setNumber, s.reps, s.weightKg]);
}

function add(state: DataState, ctx: Ctx, name: string): DataState {
  return run(state, addExercise(state, ctx, { date: TODAY, name }));
}

describe('two devices converge', () => {
  test('two_devices_logging_the_same_day_converge', () => {
    const { base, a, b } = twoDevices();
    const onA = logSets(base, a, TODAY, 'Bench press', [[10, 60]]);
    const onB = logSets(base, b, TODAY, 'Bench press', [[8, 62.5]]);

    const [mergedA, mergedB] = exchange(base, onA, onB);

    expect(live(mergedA)).toEqual(live(mergedB));
    for (const s of [mergedA, mergedB]) {
      expect(getDay(s, a, TODAY).exercises).toHaveLength(2);
      expect(names(s, a)).toEqual(['Bench press', 'Cable fly']);
      expect(sets(s, 0)).toEqual([[1, 8, 62.5]]);
    }
  });

  test('skip_on_two_devices_leaves_one_day_row', () => {
    const { base, a, b } = twoDevices();
    const onA = run(base, skipToday(base, a));
    const onB = run(base, skipToday(base, b));

    const [mergedA, mergedB] = exchange(base, onA, onB);

    expect(live(mergedA)).toEqual(live(mergedB));
    for (const s of [mergedA, mergedB]) {
      expect(liveRows(s, 'days').filter((d) => d.date === TODAY)).toHaveLength(1);
      expect(getDay(s, a, TODAY).status).toBe('skipped');
      expect(names(s, a)).toEqual(['Bench press', 'Cable fly']);
    }
  });

  test('deleted_then_relogged_set_reuses_the_same_row_id', () => {
    const { base, a } = twoDevices();
    const logged = logSets(base, a, TODAY, 'Bench press', [[10, 60]]);
    const [first] = persistedSets(logged, TODAY, 0);

    const cleared = run(logged, syncSets(logged, a, { date: TODAY, position: 0, rows: [], includeUntouched: true }));
    expect(sets(cleared, 0)).toEqual([]);
    expect(cleared.sets.get(first.id)?.deletedAt).not.toBeNull();

    const relogged = logSets(cleared, a, TODAY, 'Bench press', [[12, 55]]);
    const [again] = persistedSets(relogged, TODAY, 0);
    expect(again).toMatchObject({ id: first.id, deletedAt: null, setNumber: 1, reps: 12, weightKg: 55 });
    expect(relogged.sets.size).toBe(1);
  });

  test('exercises_added_on_two_devices_both_survive', () => {
    const { base, a, b } = twoDevices();
    const onA = add(logSets(base, a, TODAY, 'Bench press', [[10, 60]]), a, 'Dips');
    const onB = add(add(logSets(base, b, TODAY, 'Cable fly', [[12, 20]]), b, 'Dips'), b, 'Pushups');

    const [mergedA, mergedB] = exchange(base, onA, onB);

    expect(live(mergedA)).toEqual(live(mergedB));
    expect(names(mergedA, a)).toEqual(['Bench press', 'Cable fly', 'Dips', 'Dips', 'Pushups']);
    expect(sets(mergedA, 0)).toEqual([[1, 10, 60]]);
    expect(sets(mergedA, 1)).toEqual([[1, 12, 20]]);

    const deduped = run(mergedA, deleteExercise(mergedA, a, { date: TODAY, position: 3 }));
    expect(names(deduped, a)).toEqual(['Bench press', 'Cable fly', 'Dips', 'Pushups']);
  });

  test('add_after_delete_never_reuses_a_live_exercise_id', () => {
    const { base, a } = twoDevices(['Bench press', 'Cable fly', 'Dips']);
    const logged = logSets(base, a, TODAY, 'Dips', [[15, null]]);
    const dips = loggedExercises(logged, TODAY)![2];

    const withoutFly = run(logged, deleteExercise(logged, a, { date: TODAY, position: 1 }));
    const withPushups = add(withoutFly, a, 'Pushups');

    const rows = loggedExercises(withPushups, TODAY)!;
    expect(rows.map((x) => x.name)).toEqual(['Bench press', 'Dips', 'Pushups']);
    expect(rows[1]).toMatchObject({ id: dips.id, name: 'Dips', position: 2 });
    expect(sets(withPushups, 1)).toEqual([[1, 15, null]]);
    expect(rows[2].position).toBe(3);
    expect(withoutFly.day_exercises.has(rows[2].id)).toBe(false);
  });
});
