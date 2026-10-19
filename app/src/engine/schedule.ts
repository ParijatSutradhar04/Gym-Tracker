import { addDays, eachDay, type DateStr } from './dates';
import { occursOn } from './repeat';
import { getIndex } from './state';
import type { DataState, RepeatRule, RoutineVersion } from './types';

export interface Scheduled {
  routineId: string;
  versionId: string;
  title: string;
  repeatRule: RepeatRule;
  startDate: DateStr;
  exercises: string[];
}

/** Latest live version of the routine with effectiveFrom <= date. */
export function versionAt(state: DataState, routineId: string, date: DateStr): RoutineVersion | null {
  const versions = getIndex(state).versionsByRoutine.get(routineId);
  let found: RoutineVersion | null = null;
  if (versions) {
    for (const v of versions) {
      if (v.effectiveFrom > date) break;
      found = v;
    }
  }
  return found;
}

interface Resolution {
  winners: Map<DateStr, Scheduled>;
  dropped: Map<string, DateStr[]>;
}

const cache = new WeakMap<DataState, Map<string, Resolution>>();

function occursAt(state: DataState, routineId: string, date: DateStr): boolean {
  const v = versionAt(state, routineId, date);
  return v !== null && occursOn(v, date);
}

/**
 * Base occurrences per routine, then live moves in updatedAt order re-date (routine, fromDate) → toDate,
 * then clashes go to the earlier-created routine (tie: lower id).
 */
function resolve(state: DataState, from: DateStr, to: DateStr): Resolution {
  let perState = cache.get(state);
  if (!perState) cache.set(state, (perState = new Map()));
  const key = from + '|' + to;
  const hit = perState.get(key);
  if (hit) return hit;

  const idx = getIndex(state);
  const days = eachDay(from, to);
  // routineId → (current date → original occurrence date)
  const entries = new Map<string, Map<DateStr, DateStr>>();
  for (const routineId of idx.versionsByRoutine.keys()) {
    const routine = state.routines.get(routineId);
    if (!routine || routine.deletedAt !== null) continue;
    const dates = new Map<DateStr, DateStr>();
    for (const d of days) if (occursAt(state, routineId, d)) dates.set(d, d);
    entries.set(routineId, dates);
  }
  // A move can bring an occurrence from outside the window into it.
  for (const m of idx.moves) {
    const dates = entries.get(m.routineId);
    if (dates && (m.fromDate < from || m.fromDate > to) && occursAt(state, m.routineId, m.fromDate)) {
      dates.set(m.fromDate, m.fromDate);
    }
  }
  for (const m of idx.moves) {
    const dates = entries.get(m.routineId);
    const origin = dates?.get(m.fromDate);
    if (!dates || origin === undefined) continue;
    dates.delete(m.fromDate);
    if (!dates.has(m.toDate)) dates.set(m.toDate, origin);
  }

  const order = [...entries.keys()].sort((a, b) => {
    const ca = state.routines.get(a)!.createdAt;
    const cb = state.routines.get(b)!.createdAt;
    return ca < cb ? -1 : ca > cb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  const winners = new Map<DateStr, Scheduled>();
  const dropped = new Map<string, DateStr[]>();
  for (const d of days) {
    for (const routineId of order) {
      const origin = entries.get(routineId)!.get(d);
      if (origin === undefined) continue;
      if (winners.has(d)) {
        const list = dropped.get(routineId);
        if (list) list.push(d);
        else dropped.set(routineId, [d]);
        continue;
      }
      // A moved entry shows the version in effect where it landed.
      const v = versionAt(state, routineId, d) ?? versionAt(state, routineId, origin)!;
      winners.set(d, {
        routineId,
        versionId: v.id,
        title: v.title,
        repeatRule: v.repeatRule,
        startDate: v.startDate,
        exercises: v.exercises,
      });
    }
  }
  const result = { winners, dropped };
  perState.set(key, result);
  return result;
}

export function scheduleBetween(state: DataState, from: DateStr, to: DateStr): Map<DateStr, Scheduled> {
  return resolve(state, from, to).winners;
}

export function scheduleOn(state: DataState, date: DateStr): Scheduled | null {
  return resolve(state, date, date).winners.get(date) ?? null;
}

/** Dates in [from, to] where this routine had an occurrence that lost a clash. */
export function droppedOccurrences(state: DataState, routineId: string, from: DateStr, to: DateStr): DateStr[] {
  return resolve(state, from, to).dropped.get(routineId) ?? [];
}

/** First date after `after` (exclusive) the routine is scheduled, scanning 400 days. */
export function nextOccurrence(state: DataState, routineId: string, after: DateStr): DateStr | null {
  for (const [d, s] of scheduleBetween(state, addDays(after, 1), addDays(after, 400))) {
    if (s.routineId === routineId) return d;
  }
  return null;
}
