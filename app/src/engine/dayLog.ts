import type { DateStr } from './dates';
import { stableId } from './ids';
import { scheduleOn, versionAt } from './schedule';
import { getIndex } from './state';
import { EngineError, type Change, type Ctx, type DataState, type Day, type DayExercise } from './types';

export interface DayExerciseItem {
  position: number;
  name: string;
}

/** Live day-exercise rows of a logged day, in display order. */
export function loggedExercises(state: DataState, date: DateStr): DayExercise[] | null {
  const idx = getIndex(state);
  if (!idx.dayByDate.get(date)?.hasLog) return null;
  return idx.exercisesByDate.get(date) ?? [];
}

/** The displayed exercise list: the day log when there is one, else the scheduled routine. Positions are list indexes. */
export function dayExercises(state: DataState, date: DateStr): DayExerciseItem[] {
  const logged = loggedExercises(state, date);
  const names = logged ? logged.map((x) => x.name) : (scheduleOn(state, date)?.exercises ?? []);
  return names.map((name, position) => ({ position, name }));
}

/**
 * Creates the day log (title + exercise snapshot) if the date has none. The day and each snapshotted
 * exercise (`date|index`) get derived ids, so a second device snapshotting the same date writes the same
 * rows; a tombstone left under one of those ids is simply overwritten by the newer live row.
 */
export function ensureDayLog(state: DataState, ctx: Ctx, date: DateStr): Change[] {
  const day = getIndex(state).dayByDate.get(date);
  if (day?.hasLog) return [];
  const sched = scheduleOn(state, date);
  let routineId: string | null;
  let title: string;
  let exercises: string[];
  if (day && day.title !== null) {
    routineId = day.routineId;
    title = day.title;
    exercises =
      sched && sched.routineId === routineId
        ? sched.exercises
        : routineId
          ? (versionAt(state, routineId, date)?.exercises ?? [])
          : [];
  } else if (sched) {
    routineId = sched.routineId;
    title = sched.title;
    exercises = sched.exercises;
  } else {
    throw new EngineError('NO_ROUTINE');
  }
  const now = ctx.now();
  const dayRow: Day = day
    ? { ...day, routineId, title, hasLog: true, updatedAt: now }
    : { id: stableId('day', date), updatedAt: now, deletedAt: null, date, status: null, shiftId: null, routineId, title, hasLog: true };
  return [
    { table: 'days', row: dayRow },
    ...exercises.map(
      (name, position): Change => ({
        table: 'day_exercises',
        row: { id: stableId('day_exercise', `${date}|${position}`), updatedAt: now, deletedAt: null, date, position, name },
      }),
    ),
  ];
}

/** A titled, empty log for a past day that had nothing planned. */
export function startBackfill(state: DataState, ctx: Ctx, args: { date: DateStr; title: string }): Change[] {
  const { date } = args;
  const day = getIndex(state).dayByDate.get(date);
  if (date >= ctx.today || day?.hasLog || scheduleOn(state, date) !== null) throw new EngineError('NOT_AVAILABLE');
  const title = args.title.trim();
  if (!title) throw new EngineError('EMPTY_NAME');
  const now = ctx.now();
  const row: Day = day
    ? { ...day, routineId: null, title, hasLog: true, updatedAt: now }
    : { id: stableId('day', date), updatedAt: now, deletedAt: null, date, status: null, shiftId: null, routineId: null, title, hasLog: true };
  return [{ table: 'days', row }];
}
