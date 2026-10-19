import type { Change, Ctx, DataState, RepeatRule, RoutineVersion } from '../types';
import type { DateStr } from '../dates';
import { applyChanges, getIndex } from '../state';

export function makeCtx(today: DateStr, startSeq = 0): Ctx {
  let seq = startSeq;
  let ms = 0;
  const base = Date.parse(today + 'T12:00:00.000Z');
  return {
    today,
    newId: () => `id-${++seq}`,
    now: () => new Date(base + ms++).toISOString(),
  };
}

export function run(state: DataState, changes: Change[]): DataState {
  return applyChanges(state, changes);
}

export interface SeedRoutine {
  title: string;
  repeatRule: RepeatRule;
  startDate: DateStr;
  exercises?: string[];
  createdAt?: string;
  id?: string;
}

/** Creates a `routines` row and one `routine_versions` row with effectiveFrom = startDate. */
export function seedRoutine(state: DataState, ctx: Ctx, r: SeedRoutine): DataState {
  const now = ctx.now();
  const routineId = r.id ?? ctx.newId();
  return applyChanges(state, [
    { table: 'routines', row: { id: routineId, updatedAt: now, deletedAt: null, createdAt: r.createdAt ?? now } },
    {
      table: 'routine_versions',
      row: {
        id: ctx.newId(),
        updatedAt: now,
        deletedAt: null,
        routineId,
        effectiveFrom: r.startDate,
        title: r.title,
        repeatRule: r.repeatRule,
        startDate: r.startDate,
        exercises: r.exercises ?? [],
        ended: false,
      },
    },
  ]);
}

/** Id of the routine whose latest version has this title. */
export function routineId(state: DataState, title: string): string {
  for (const [id, versions] of getIndex(state).versionsByRoutine) {
    if (versions.some((v) => v.title === title)) return id;
  }
  throw new Error(`No routine titled ${title}`);
}

/** Adds a version copied from the routine's latest one, with overrides. */
export function addVersion(
  state: DataState,
  ctx: Ctx,
  rid: string,
  v: Partial<RoutineVersion> & { effectiveFrom: DateStr },
): DataState {
  const versions = getIndex(state).versionsByRoutine.get(rid) ?? [];
  const last = versions[versions.length - 1];
  return applyChanges(state, [
    { table: 'routine_versions', row: { ...last, ...v, id: ctx.newId(), updatedAt: ctx.now(), deletedAt: null } },
  ]);
}

export function addMove(
  state: DataState,
  ctx: Ctx,
  m: { routineId: string; fromDate: DateStr; toDate: DateStr; deleted?: boolean },
): DataState {
  const now = ctx.now();
  return applyChanges(state, [
    {
      table: 'occurrence_moves',
      row: {
        id: ctx.newId(),
        updatedAt: now,
        deletedAt: m.deleted ? now : null,
        routineId: m.routineId,
        fromDate: m.fromDate,
        toDate: m.toDate,
        shiftId: 'shift-test',
      },
    },
  ]);
}
