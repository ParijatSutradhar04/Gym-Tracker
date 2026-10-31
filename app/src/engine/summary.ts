import type { DateStr } from './dates';
import { formatKg } from './dates';
import { dayExercises } from './dayLog';
import { isLogged } from './order';
import { numberSets, persistedSets, prefillRows } from './sets';
import type { DataState, SetRow } from './types';

const plural = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`;
const setCount = (rows: readonly { isDrop: boolean }[]) => numberSets(rows).filter((r) => !r.isDrop).length;

/**
 * Tile line: "3 sets · 12 reps · 62.5 kg" from the heaviest logged row; "3 sets" when nothing is logged.
 * Drops are not counted as sets.
 */
export function exerciseSummary(state: DataState, date: DateStr, position: number): { setCount: number; text: string } {
  const logged = persistedSets(state, date, position).filter(isLogged);
  const count = setCount(logged);
  if (logged.length === 0) {
    const name = dayExercises(state, date)[position]?.name ?? '';
    const n = setCount(prefillRows(state, date, name));
    return { setCount: n, text: plural(n) };
  }
  const weighted = logged.filter((s) => s.weightKg !== null);
  let text: string;
  if (weighted.length > 0) {
    const top = weighted.reduce((a, b) =>
      b.weightKg! > a.weightKg! || (b.weightKg === a.weightKg && b.reps! > a.reps!) ? b : a,
    );
    text = `${plural(count)} · ${top.reps} reps · ${formatKg(top.weightKg!)} kg`;
  } else {
    text = `${plural(count)} · ${Math.max(...logged.map((s) => s.reps!))} reps`;
  }
  return { setCount: count, text };
}

/** Σ reps × kg over logged sets with a weight (bodyweight excluded). */
export function dayVolume(state: DataState, date: DateStr): number {
  let total = 0;
  for (const { position } of dayExercises(state, date)) {
    for (const s of persistedSets(state, date, position)) {
      if (s.reps !== null && s.weightKg !== null) total += s.reps * s.weightKg;
    }
  }
  return Math.round(total * 100) / 100;
}

export function dayTotals(state: DataState, date: DateStr): { exercises: number; sets: number; volumeKg: number } {
  const exercises = dayExercises(state, date);
  const sets = exercises.reduce((n, x) => n + exerciseSummary(state, date, x.position).setCount, 0);
  return { exercises: exercises.length, sets, volumeKg: dayVolume(state, date) };
}
