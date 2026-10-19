import type { DateStr } from './dates';
import { dayExercises, ensureDayLog, loggedExercises } from './dayLog';
import { scheduleOn } from './schedule';
import { createRecorder, getIndex } from './state';
import { EngineError, type Change, type Ctx, type DataState, type SetRow } from './types';

export interface SetDraft {
  reps: number | null;
  weightKg: number | null;
  touched: boolean;
}

const EMPTY_ROWS = 3;
const MAX_REPS = 999;
const MAX_KG = 1000;

export function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

/** Live sets of the exercise at `position` on a logged day; [] when the day has no log. */
export function persistedSets(state: DataState, date: DateStr, position: number): SetRow[] {
  const row = loggedExercises(state, date)?.[position];
  return row ? (getIndex(state).setsByExercise.get(row.id) ?? []) : [];
}

/** Rows from the most recent earlier session of this exercise (by name, any routine) with logged sets. */
function historyRows(state: DataState, date: DateStr, exerciseName: string): SetDraft[] | null {
  const idx = getIndex(state);
  const name = normalizeName(exerciseName);
  let bestDate: DateStr | null = null;
  let best: SetRow[] | null = null;
  for (const [d, exercises] of idx.exercisesByDate) {
    if (d >= date || (bestDate !== null && d <= bestDate)) continue;
    for (const x of exercises) {
      if (normalizeName(x.name) !== name) continue;
      const sets = idx.setsByExercise.get(x.id);
      if (sets?.some((s) => s.reps !== null)) {
        bestDate = d;
        best = sets;
        break;
      }
    }
  }
  return best && best.map((s) => ({ reps: s.reps, weightKg: s.weightKg, touched: false }));
}

export function prefillRows(state: DataState, date: DateStr, exerciseName: string): SetDraft[] {
  return (
    historyRows(state, date, exerciseName) ??
    Array.from({ length: EMPTY_ROWS }, () => ({ reps: null, weightKg: null, touched: false }))
  );
}

export interface SetsSheet {
  routineTitle: string;
  exerciseName: string;
  rows: SetDraft[];
  prefilled: boolean;
  readOnly: boolean;
}

export function getSetsSheet(state: DataState, ctx: Ctx, date: DateStr, position: number): SetsSheet {
  const exercise = dayExercises(state, date)[position];
  if (!exercise) throw new EngineError('NOT_FOUND');
  const day = getIndex(state).dayByDate.get(date);
  const routineTitle = (day?.hasLog ? day.title : scheduleOn(state, date)?.title) ?? '';
  const persisted = persistedSets(state, date, position);
  const readOnly = date > ctx.today;
  if (persisted.length > 0) {
    const rows = persisted.map((s) => ({ reps: s.reps, weightKg: s.weightKg, touched: true }));
    return { routineTitle, exerciseName: exercise.name, rows, prefilled: false, readOnly };
  }
  const history = historyRows(state, date, exercise.name);
  return {
    routineTitle,
    exerciseName: exercise.name,
    rows: history ?? prefillRows(state, date, exercise.name),
    prefilled: history !== null,
    readOnly,
  };
}

/**
 * Makes the persisted sets match `rows` (row i = set i+1). Untouched rows are only written when
 * includeUntouched (Done). Creates the day log lazily, so peeking at a sheet saves nothing.
 */
export function syncSets(
  state: DataState,
  ctx: Ctx,
  args: { date: DateStr; position: number; rows: SetDraft[]; includeUntouched: boolean },
): Change[] {
  const { date, position, rows, includeUntouched } = args;
  if (date > ctx.today) throw new EngineError('READ_ONLY_FUTURE');
  if (!dayExercises(state, date)[position]) throw new EngineError('NOT_FOUND');

  const written = rows.map((r) => (r.touched || includeUntouched) && (r.reps !== null || r.weightKg !== null));
  const byNumber = new Map<number, SetRow>();
  for (const s of persistedSets(state, date, position)) if (!byNumber.has(s.setNumber)) byNumber.set(s.setNumber, s);

  const now = ctx.now();
  const deletes: Change[] = [];
  for (const [n, s] of byNumber) {
    if (n > rows.length || !written[n - 1]) deletes.push({ table: 'sets', row: { ...s, updatedAt: now, deletedAt: now } });
  }
  const pending = rows.flatMap((r, i) => {
    if (!written[i]) return [];
    const prev = byNumber.get(i + 1);
    return prev && prev.reps === r.reps && prev.weightKg === r.weightKg ? [] : [{ setNumber: i + 1, row: r, prev }];
  });
  if (pending.length === 0 && deletes.length === 0) return [];

  const rec = createRecorder(state);
  rec.apply(ensureDayLog(state, ctx, date));
  const dayExerciseId = loggedExercises(rec.state(), date)![position].id;
  rec.apply(deletes);
  rec.apply(
    pending.map(({ setNumber, row, prev }): Change => ({
      table: 'sets',
      row: prev
        ? { ...prev, reps: row.reps, weightKg: row.weightKg, updatedAt: now }
        : { id: ctx.newId(), updatedAt: now, deletedAt: null, dayExerciseId, setNumber, reps: row.reps, weightKg: row.weightKg },
    })),
  );
  return rec.changes();
}

/** Whole reps 0..999; '' → null. */
export function parseRepsInput(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'invalid';
  const n = Number(t);
  return n <= MAX_REPS ? n : 'invalid';
}

/** Kilograms 0..1000, '.' or ',' as decimal separator; '' → null. */
export function parseWeightInput(text: string): number | null | 'invalid' {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return 'invalid';
  const n = Number(t);
  return n <= MAX_KG ? n : 'invalid';
}
