import type { DateStr } from './dates';
import { dayExercises, ensureDayLog, loggedExercises } from './dayLog';
import { normalizeName, requireName } from './names';
import { scheduleOn, versionAt } from './schedule';
import { orderChanges } from './order';
import { applyChanges, createRecorder, getIndex, liveRows } from './state';
import { EngineError, type Change, type Ctx, type DataState, type RepeatRule, type RoutineVersion } from './types';

function requireEditable(ctx: Ctx, date: DateStr): void {
  if (date < ctx.today) throw new EngineError('NOT_EDITABLE_PAST');
}

/** Locks today's unlocked shifts so a later Restore never has to untangle edits made after it. */
export function lockTodaysShift(state: DataState, ctx: Ctx): Change[] {
  const now = ctx.now();
  return liveRows(state, 'shifts')
    .filter((s) => s.date === ctx.today && !s.locked)
    .map((s): Change => ({ table: 'shifts', row: { ...s, locked: true, updatedAt: now } }));
}

const laterVersions = (state: DataState, routineId: string, date: DateStr) =>
  (getIndex(state).versionsByRoutine.get(routineId) ?? []).filter((v) => v.effectiveFrom > date);

/** Upserts the version at `date` (in place when one starts that day) with `patch`, tombstoning later versions. */
function versionFrom(state: DataState, ctx: Ctx, base: RoutineVersion, date: DateStr, patch: Partial<RoutineVersion>): Change[] {
  const now = ctx.now();
  const row: RoutineVersion =
    base.effectiveFrom === date
      ? { ...base, ...patch, updatedAt: now }
      : { ...base, ...patch, id: ctx.newId(), effectiveFrom: date, updatedAt: now, deletedAt: null };
  return [
    { table: 'routine_versions', row },
    ...laterVersions(state, base.routineId, date).map(
      (v): Change => ({ table: 'routine_versions', row: { ...v, updatedAt: now, deletedAt: now } }),
    ),
  ];
}

export function addSchedule(
  state: DataState,
  ctx: Ctx,
  args: { date: DateStr; title: string; repeatRule: RepeatRule; exercises?: string[] },
): Change[] {
  requireEditable(ctx, args.date);
  const title = requireName(args.title);
  const now = ctx.now();
  const routineId = ctx.newId();
  const exercises = (args.exercises ?? []).map((x) => x.trim()).filter(Boolean);
  return [
    { table: 'routines', row: { id: routineId, updatedAt: now, deletedAt: null, createdAt: now } },
    {
      table: 'routine_versions',
      row: {
        id: ctx.newId(),
        updatedAt: now,
        deletedAt: null,
        routineId,
        effectiveFrom: args.date,
        title,
        repeatRule: args.repeatRule,
        startDate: args.date,
        exercises,
        ended: false,
      },
    },
    ...lockTodaysShift(state, ctx),
  ];
}

/** Edit-forward: a new version from `date`; the repeat anchor moves to `date` only when the rule changes. */
export function changeSchedule(
  state: DataState,
  ctx: Ctx,
  args: { routineId: string; date: DateStr; title: string; repeatRule: RepeatRule },
): Change[] {
  requireEditable(ctx, args.date);
  const title = requireName(args.title);
  const current = versionAt(state, args.routineId, args.date);
  if (!current || current.ended) throw new EngineError('NOT_FOUND');
  const startDate = args.repeatRule !== current.repeatRule ? args.date : current.startDate;
  return [
    ...versionFrom(state, ctx, current, args.date, { title, repeatRule: args.repeatRule, startDate }),
    ...lockTodaysShift(state, ctx),
  ];
}

export function stopRoutine(state: DataState, ctx: Ctx, args: { routineId: string; date: DateStr }): Change[] {
  requireEditable(ctx, args.date);
  const current = versionAt(state, args.routineId, args.date);
  if (!current || current.ended) throw new EngineError('NOT_FOUND');
  return [...versionFrom(state, ctx, current, args.date, { ended: true }), ...lockTodaysShift(state, ctx)];
}

type ExerciseOp =
  | { kind: 'add'; name: string }
  | { kind: 'rename'; position: number; from: string; name: string }
  | { kind: 'delete'; position: number; from: string };

/** Applies the op to a version's list: by position on the edited date's own list, by name on later versions. */
function applyOp(list: string[], op: ExerciseOp, byPosition: boolean): string[] {
  if (op.kind === 'add') {
    return byPosition || !list.some((x) => normalizeName(x) === normalizeName(op.name)) ? [...list, op.name] : list;
  }
  const i = byPosition ? op.position : list.findIndex((x) => normalizeName(x) === normalizeName(op.from));
  if (i < 0 || i >= list.length) return list;
  return op.kind === 'rename' ? list.map((x, j) => (j === i ? op.name : x)) : list.filter((_, j) => j !== i);
}

function editVersions(state: DataState, ctx: Ctx, routineId: string, date: DateStr, op: ExerciseOp, logged: boolean): Change[] {
  const base = versionAt(state, routineId, date);
  if (!base) return [];
  const now = ctx.now();
  const exercises = applyOp(base.exercises, op, !logged);
  const row: RoutineVersion =
    base.effectiveFrom === date
      ? { ...base, exercises, updatedAt: now }
      : { ...base, exercises, id: ctx.newId(), effectiveFrom: date, updatedAt: now, deletedAt: null };
  const out: Change[] = [{ table: 'routine_versions', row }];
  for (const v of laterVersions(state, routineId, date)) {
    const next = applyOp(v.exercises, op, false);
    if (next !== v.exercises) out.push({ table: 'routine_versions', row: { ...v, exercises: next, updatedAt: now } });
  }
  return out;
}

function editLog(state: DataState, ctx: Ctx, date: DateStr, op: ExerciseOp): Change[] {
  const rows = loggedExercises(state, date) ?? [];
  const now = ctx.now();
  if (op.kind === 'add') {
    let max = -1;
    for (const x of state.day_exercises.values()) if (x.date === date && x.position > max) max = x.position;
    return [{ table: 'day_exercises', row: { id: ctx.newId(), updatedAt: now, deletedAt: null, date, position: max + 1, name: op.name, performedOrder: null } }];
  }
  const target = rows[op.position];
  if (op.kind === 'rename') return [{ table: 'day_exercises', row: { ...target, name: op.name, updatedAt: now } }];
  const removed: Change[] = [
    { table: 'day_exercises', row: { ...target, performedOrder: null, updatedAt: now, deletedAt: now } },
    ...(getIndex(state).setsByExercise.get(target.id) ?? []).map(
      (s): Change => ({ table: 'sets', row: { ...s, updatedAt: now, deletedAt: now } }),
    ),
  ];
  return [...removed, ...orderChanges(applyChanges(state, removed), date, now)];
}

/**
 * Future: routine versions only. Today: versions, plus today's log when there is one.
 * Past: that day's log only (created on demand), never the routine.
 */
function editExercise(state: DataState, ctx: Ctx, date: DateStr, op: ExerciseOp): Change[] {
  if (op.kind !== 'add' && !dayExercises(state, date)[op.position]) {
    if (date < ctx.today) ensureDayLog(state, ctx, date); // NO_ROUTINE beats NOT_FOUND on an empty past day
    if (!dayExercises(state, date).length && date >= ctx.today && !scheduleOn(state, date)) throw new EngineError('NO_ROUTINE');
    throw new EngineError('NOT_FOUND');
  }
  if (date < ctx.today) {
    const rec = createRecorder(state);
    rec.apply(ensureDayLog(state, ctx, date));
    rec.apply(editLog(rec.state(), ctx, date, op));
    return rec.changes();
  }
  const day = getIndex(state).dayByDate.get(date);
  const logged = date === ctx.today && day?.hasLog === true;
  const routineId = logged ? day!.routineId : (scheduleOn(state, date)?.routineId ?? null);
  if (!routineId && !logged) throw new EngineError('NO_ROUTINE');
  return [
    ...(routineId ? editVersions(state, ctx, routineId, date, op, logged) : []),
    ...(logged ? editLog(state, ctx, date, op) : []),
    ...lockTodaysShift(state, ctx),
  ];
}

export function addExercise(state: DataState, ctx: Ctx, args: { date: DateStr; name: string }): Change[] {
  return editExercise(state, ctx, args.date, { kind: 'add', name: requireName(args.name) });
}

export function renameExercise(state: DataState, ctx: Ctx, args: { date: DateStr; position: number; name: string }): Change[] {
  const name = requireName(args.name);
  const from = dayExercises(state, args.date)[args.position]?.name ?? '';
  return editExercise(state, ctx, args.date, { kind: 'rename', position: args.position, from, name });
}

/** How many sets deleting the exercise at this position would remove; only a day's log holds sets. */
export function setsLostOnDelete(state: DataState, date: DateStr, position: number): number {
  const target = loggedExercises(state, date)?.[position];
  return target ? (getIndex(state).setsByExercise.get(target.id)?.length ?? 0) : 0;
}

export function deleteExercise(state: DataState, ctx: Ctx, args: { date: DateStr; position: number }): Change[] {
  const from = dayExercises(state, args.date)[args.position]?.name ?? '';
  return editExercise(state, ctx, args.date, { kind: 'delete', position: args.position, from });
}

/** Past routine titles (ended ones too), distinct case-insensitively, most recently created first. */
export function routineTitleSuggestions(state: DataState, query: string): { title: string; exercises: string[] }[] {
  const q = normalizeName(query);
  const idx = getIndex(state);
  const routines = liveRows(state, 'routines').sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1,
  );
  const seen = new Set<string>();
  const out: { title: string; exercises: string[] }[] = [];
  for (const r of routines) {
    const versions = idx.versionsByRoutine.get(r.id);
    const latest = versions?.[versions.length - 1];
    if (!latest) continue;
    const key = normalizeName(latest.title);
    if (seen.has(key) || !key.includes(q)) continue;
    seen.add(key);
    out.push({ title: latest.title, exercises: latest.exercises });
  }
  return out;
}
