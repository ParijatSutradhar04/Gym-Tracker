import type { DateStr } from './dates';
import { getIndex } from './state';
import type { Change, DataState, SetRow } from './types';

export function isLogged(set: SetRow): boolean {
  return set.reps !== null;
}

/**
 * The day exercise rows whose performedOrder must change on `date`, read from the state after a command's
 * other writes. Numbers stay dense (1…n) when an exercise loses its last logged set or is deleted; equal
 * numbers left by a two-device merge stay equal. Only `firstLogged` (an exercise that just got its first
 * logged set) can gain a number, so days logged before the order existed are never guessed at.
 */
export function orderChanges(state: DataState, date: DateStr, now: string, firstLogged?: string): Change[] {
  const idx = getIndex(state);
  const exercises = idx.exercisesByDate.get(date) ?? [];
  const logged = (id: string) => (idx.setsByExercise.get(id) ?? []).some(isLogged);
  const kept = [...new Set(exercises.flatMap((x) => (x.performedOrder != null && logged(x.id) ? [x.performedOrder] : [])))];
  kept.sort((a, b) => a - b);
  return exercises.flatMap((x): Change[] => {
    const current = x.performedOrder ?? null;
    let next = current;
    if (current !== null) next = logged(x.id) ? kept.indexOf(current) + 1 : null;
    else if (x.id === firstLogged && logged(x.id)) next = kept.length + 1;
    return next === current ? [] : [{ table: 'day_exercises', row: { ...x, performedOrder: next, updatedAt: now } }];
  });
}
