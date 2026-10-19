import type { DateStr } from './dates';
import { dayExercises } from './dayLog';
import { nextOccurrence, scheduleOn, versionAt } from './schedule';
import { gymMissedAvailable, restorableShift } from './shift';
import { getIndex, liveRows } from './state';
import { dayTotals, exerciseSummary } from './summary';
import type { Ctx, DataState, RepeatRule } from './types';

export interface ExerciseView {
  position: number;
  name: string;
  setCount: number;
  summary: string;
}

export interface DayView {
  date: DateStr;
  kind: 'past' | 'today' | 'future';
  status: 'missed' | 'skipped' | null;
  routine: {
    routineId: string | null;
    title: string;
    repeatRule: RepeatRule | null;
    startDate: DateStr | null;
    source: 'log' | 'schedule' | 'backfill';
  } | null;
  exercises: ExerciseView[];
  hasLog: boolean;
  canEditSchedule: boolean;
  canLogSets: boolean;
  canBackfill: boolean;
  canGymMissed: boolean;
  restoreShiftId: string | null;
  totals: { exercises: number; sets: number; volumeKg: number };
  nextUp: DateStr | null;
}

/** Everything a day screen shows. A logged (or shifted) day shows its title as it was; others the schedule. */
export function getDay(state: DataState, ctx: Ctx, date: DateStr): DayView {
  const { today } = ctx;
  const day = getIndex(state).dayByDate.get(date);
  const hasLog = day?.hasLog === true;
  const sched = scheduleOn(state, date);
  let routine: DayView['routine'] = null;
  if (day && (hasLog || day.status) && day.title !== null) {
    const { routineId } = day;
    const v = routineId === null ? null : sched?.routineId === routineId ? sched : versionAt(state, routineId, date);
    routine = {
      routineId,
      title: day.title,
      repeatRule: v?.repeatRule ?? null,
      startDate: v?.startDate ?? null,
      source: routineId === null ? 'backfill' : 'log',
    };
  } else if (sched) {
    routine = { routineId: sched.routineId, title: sched.title, repeatRule: sched.repeatRule, startDate: sched.startDate, source: 'schedule' };
  }
  const exercises = dayExercises(state, date).map(({ position, name }): ExerciseView => {
    const { setCount, text } = exerciseSummary(state, date, position);
    return { position, name, setCount, summary: text };
  });
  const liveRoutine = routine?.routineId ? state.routines.get(routine.routineId) : undefined;
  return {
    date,
    kind: date < today ? 'past' : date === today ? 'today' : 'future',
    status: day?.status ?? null,
    routine,
    exercises,
    hasLog,
    canEditSchedule: date >= today,
    canLogSets: date <= today && routine !== null,
    canBackfill: date < today && routine === null && !hasLog,
    canGymMissed: date === today && gymMissedAvailable(state, ctx),
    restoreShiftId: date === today ? (restorableShift(state, ctx)?.id ?? null) : null,
    totals: dayTotals(state, date),
    nextUp: liveRoutine && liveRoutine.deletedAt === null ? nextOccurrence(state, liveRoutine.id, date) : null,
  };
}

/** First date with any data (day rows, routine versions), never later than today. */
export function earliestDataDate(state: DataState, ctx: Ctx): DateStr {
  let earliest = ctx.today;
  for (const d of liveRows(state, 'days')) if (d.date < earliest) earliest = d.date;
  for (const v of liveRows(state, 'routine_versions')) if (v.effectiveFrom < earliest) earliest = v.effectiveFrom;
  return earliest;
}
