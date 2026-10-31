import { addMonthsClamped, eachDay, formatKg, WEEKDAY_SHORT, weekdayIndex, type DateStr } from './dates';
import { scheduleBetween } from './schedule';
import { numberSets } from './sets';
import { getIndex } from './state';
import { EngineError, type DataState } from './types';

export const CSV_COLUMNS = [
  'date',
  'weekday',
  'routine',
  'exercise',
  'exercise_order',
  'set_number',
  'is_drop',
  'reps',
  'weight_kg',
  'volume_kg',
  'status',
] as const;

export type ExportRangeKind = 'last_month' | 'last_3_months' | 'custom';

/** Inclusive range ending today at the latest; future dates are never exported. */
export function exportRange(kind: ExportRangeKind, today: DateStr, custom?: { from: DateStr; to: DateStr }): { from: DateStr; to: DateStr } {
  if (kind !== 'custom') return { from: addMonthsClamped(today, kind === 'last_month' ? -1 : -3), to: today };
  if (!custom) throw new EngineError('INVALID_RANGE');
  const to = custom.to > today ? today : custom.to;
  if (custom.from > to) throw new EngineError('INVALID_RANGE');
  return { from: custom.from, to };
}

export function csvFileName(from: DateStr, to: DateStr): string {
  return `gym-log_${from}_to_${to}.csv`;
}

/** RFC 4180: quote fields holding a comma, quote or line break; double inner quotes. */
function field(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per logged set (day-log names), else one status row for a day that was skipped, missed,
 * or planned but not logged before today. Rest days and future dates produce nothing. Exercises run in
 * the order they were done (those without an order after, by position); a drop repeats its set's number.
 */
export function buildCsv(state: DataState, from: DateStr, to: DateStr, today: DateStr): string {
  const out: string[] = [CSV_COLUMNS.join(',')];
  const last = to > today ? today : to;
  if (from <= last) {
    const idx = getIndex(state);
    const sched = scheduleBetween(state, from, last);
    for (const date of eachDay(from, last)) {
      const day = idx.dayByDate.get(date);
      const weekday = WEEKDAY_SHORT[weekdayIndex(date)];
      const routine = (day?.hasLog || day?.status ? day.title : null) ?? sched.get(date)?.title ?? '';
      let logged = 0;
      if (day?.hasLog) {
        const exercises = [...(idx.exercisesByDate.get(date) ?? [])].sort(
          (a, b) => (a.performedOrder ?? Infinity) - (b.performedOrder ?? Infinity),
        );
        for (const x of exercises) {
          const sets = idx.setsByExercise.get(x.id) ?? [];
          const kinds = numberSets(sets);
          for (const [i, s] of sets.entries()) {
            if (s.reps === null) continue;
            logged++;
            const volume = s.weightKg === null ? null : formatKg(s.reps * s.weightKg);
            const weight = s.weightKg === null ? null : formatKg(s.weightKg);
            const { number, isDrop } = kinds[i];
            out.push([date, weekday, routine, x.name, x.performedOrder, number, String(isDrop), s.reps, weight, volume, 'logged'].map(field).join(','));
          }
        }
      }
      if (logged > 0) continue;
      const planned = sched.has(date) || (day?.hasLog === true && day.routineId !== null);
      const status = day?.status ?? (date < today && planned ? 'not_logged' : null);
      if (status) out.push([date, weekday, routine, null, null, null, null, null, null, null, status].map(field).join(','));
    }
  }
  return out.join('\n') + '\n';
}
