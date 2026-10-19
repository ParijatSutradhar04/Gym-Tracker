import { addDays, WEEKDAY_FULL, WEEKDAY_SHORT, weekdayIndex, type DateStr } from './dates';
import { ensureDayLog } from './dayLog';
import { occursOn } from './repeat';
import { scheduleBetween, scheduleOn, versionAt, type Scheduled } from './schedule';
import { createRecorder, getIndex } from './state';
import { EngineError, type Change, type Ctx, type DataState, type RowRef, type Shift } from './types';

/** How far ahead catch-up looks for a rest day to absorb the run. */
const CATCH_UP_DAYS = 7;

function hasSetsOn(state: DataState, date: DateStr): boolean {
  const idx = getIndex(state);
  return (idx.exercisesByDate.get(date) ?? []).some((x) => (idx.setsByExercise.get(x.id)?.length ?? 0) > 0);
}

/** Today has a routine, no status yet, and no logged sets. */
export function gymMissedAvailable(state: DataState, ctx: Ctx): boolean {
  return (
    scheduleOn(state, ctx.today) !== null &&
    !getIndex(state).dayByDate.get(ctx.today)?.status &&
    !hasSetsOn(state, ctx.today)
  );
}

interface CatchUpRun {
  run: [DateStr, Scheduled][];
  restDay: DateStr;
}

/** Consecutive scheduled days from today up to the first rest day within a week; null when there is none. */
function catchUpRun(state: DataState, today: DateStr): CatchUpRun | null {
  const window = scheduleBetween(state, today, addDays(today, CATCH_UP_DAYS));
  const run: [DateStr, Scheduled][] = [];
  for (let i = 0; i <= CATCH_UP_DAYS; i++) {
    const d = addDays(today, i);
    const s = window.get(d);
    if (!s) return i === 0 ? null : { run, restDay: d };
    run.push([d, s]);
  }
  return null;
}

/** One-off moves d → d+1 for the run; the latest first, so a routine on two run days never collides with itself. */
function catchUpMoves(ctx: Ctx, shiftId: string, { run }: CatchUpRun): Change[] {
  return [...run].reverse().map(
    ([d, s]): Change => ({
      table: 'occurrence_moves',
      row: { id: ctx.newId(), updatedAt: ctx.now(), deletedAt: null, routineId: s.routineId, fromDate: d, toDate: addDays(d, 1), shiftId },
    }),
  );
}

/**
 * Every occurrence from today on moves one day later: each live routine gets a copy of today's version
 * effective tomorrow with its anchor +1 day, later versions shift +1 day, every move date on or after today
 * shifts +1 day, and today's own base occurrences move to tomorrow (merging with the copy) so moves off
 * today keep working. Moves are written in application order (updatedAt), today's first.
 */
function permanentChanges(state: DataState, ctx: Ctx, shiftId: string): Change[] {
  const { today } = ctx;
  const tomorrow = addDays(today, 1);
  const idx = getIndex(state);
  const versions: Change[] = [];
  const todayMoves: Change[] = [];
  for (const [routineId, list] of idx.versionsByRoutine) {
    const routine = state.routines.get(routineId);
    if (!routine || routine.deletedAt !== null) continue;
    const now = ctx.now();
    const current = versionAt(state, routineId, today);
    if (current && !current.ended && !(current.repeatRule === 'never' && current.startDate < today)) {
      versions.push({
        table: 'routine_versions',
        row: { ...current, id: ctx.newId(), effectiveFrom: tomorrow, startDate: addDays(current.startDate, 1), updatedAt: now, deletedAt: null },
      });
    }
    for (const v of list) {
      if (v.effectiveFrom <= today) continue;
      versions.push({
        table: 'routine_versions',
        row: { ...v, effectiveFrom: addDays(v.effectiveFrom, 1), startDate: addDays(v.startDate, 1), updatedAt: now },
      });
    }
    if (current && occursOn(current, today)) {
      todayMoves.push({
        table: 'occurrence_moves',
        row: { id: ctx.newId(), updatedAt: ctx.now(), deletedAt: null, routineId, fromDate: today, toDate: tomorrow, shiftId },
      });
    }
  }
  const bump = (d: DateStr) => (d >= today ? addDays(d, 1) : d);
  const laterMoves = idx.moves
    .filter((m) => m.fromDate >= today || m.toDate >= today)
    .map((m): Change => ({ table: 'occurrence_moves', row: { ...m, fromDate: bump(m.fromDate), toDate: bump(m.toDate), updatedAt: ctx.now() } }));
  return [...versions, ...todayMoves, ...laterMoves];
}

function priorRow(state: DataState, c: Change): Change | null {
  const row = (state[c.table] as Map<string, Change['row']>).get(c.row.id);
  return row ? ({ table: c.table, row } as Change) : null;
}

/**
 * Snapshots today's log, sets today's status and applies `body`; the shift row records every row it
 * created and the prior copy of every row it changed, which is all Restore needs.
 */
function recordShift(
  state: DataState,
  ctx: Ctx,
  mode: Shift['mode'],
  body: (shiftId: string) => Change[],
): Change[] {
  if (!gymMissedAvailable(state, ctx)) throw new EngineError('NOT_AVAILABLE');
  const { today } = ctx;
  const shiftId = ctx.newId();
  const rec = createRecorder(state);
  rec.apply(ensureDayLog(state, ctx, today));
  const day = getIndex(rec.state()).dayByDate.get(today)!;
  rec.apply([{ table: 'days', row: { ...day, status: mode === 'skip' ? 'skipped' : 'missed', shiftId, updatedAt: ctx.now() } }]);
  rec.apply(body(shiftId));

  const changes = rec.changes();
  const created: RowRef[] = [];
  const before: Change[] = [];
  for (const c of changes) {
    const prior = priorRow(state, c);
    if (prior) before.push(prior);
    else created.push({ table: c.table, id: c.row.id });
  }
  const now = ctx.now();
  const shift: Shift = { id: shiftId, updatedAt: now, deletedAt: null, date: today, mode, locked: false, created, before };
  return [{ table: 'shifts', row: shift }, ...changes];
}

/** Marks today skipped; nothing else moves. */
export function skipToday(state: DataState, ctx: Ctx): Change[] {
  return recordShift(state, ctx, 'skip', () => []);
}

/** Marks today missed and moves today's routine to tomorrow. Catch-up without a rest day in a week is permanent. */
export function shiftToday(state: DataState, ctx: Ctx, mode: 'catch_up' | 'permanent'): Change[] {
  const run = mode === 'catch_up' ? catchUpRun(state, ctx.today) : null;
  return run
    ? recordShift(state, ctx, 'catch_up', (shiftId) => catchUpMoves(ctx, shiftId, run))
    : recordShift(state, ctx, 'permanent', (shiftId) => permanentChanges(state, ctx, shiftId));
}

export function previewShift(state: DataState, ctx: Ctx, mode: 'catch_up' | 'permanent'): { text: string } {
  const { today } = ctx;
  const run = mode === 'catch_up' ? catchUpRun(state, today) : null;
  if (run) {
    const [, last] = run.run[run.run.length - 1];
    return {
      text: `${last.title} moves to ${WEEKDAY_SHORT[weekdayIndex(run.restDay)]}. Back to your usual days next ${WEEKDAY_FULL[weekdayIndex(today)]}.`,
    };
  }
  const title = scheduleOn(state, today)?.title ?? '';
  return { text: `${title} moves to ${WEEKDAY_FULL[weekdayIndex(addDays(today, 1))]}s from now on.` };
}

/** Today's shift while its status still stands and no schedule edit has locked it. */
export function restorableShift(state: DataState, ctx: Ctx): Shift | null {
  const day = getIndex(state).dayByDate.get(ctx.today);
  if (!day?.status || !day.shiftId) return null;
  const shift = state.shifts.get(day.shiftId);
  return shift && shift.deletedAt === null && shift.date === ctx.today && !shift.locked ? shift : null;
}

/**
 * Undo / Restore: tombstones what the shift created and re-writes what it changed. Sets logged after the
 * shift keep today's log (only the status comes off), so a restore never loses a workout.
 */
export function restoreShift(state: DataState, ctx: Ctx, shiftId: string): Change[] {
  const shift = restorableShift(state, ctx);
  if (!shift || shift.id !== shiftId) throw new EngineError('NOT_AVAILABLE');
  const keepLog = hasSetsOn(state, ctx.today);
  const keep = (table: RowRef['table']) => keepLog && (table === 'days' || table === 'day_exercises');
  const out: Change[] = [];
  for (const ref of shift.created) {
    if (keep(ref.table)) continue;
    const row = (state[ref.table] as Map<string, Change['row']>).get(ref.id);
    if (row && row.deletedAt === null) {
      const now = ctx.now();
      out.push({ table: ref.table, row: { ...row, updatedAt: now, deletedAt: now } } as Change);
    }
  }
  for (const c of shift.before) if (!keep(c.table)) out.push({ table: c.table, row: { ...c.row, updatedAt: ctx.now() } } as Change);
  if (keepLog) {
    const day = getIndex(state).dayByDate.get(ctx.today)!;
    out.push({ table: 'days', row: { ...day, status: null, shiftId: null, updatedAt: ctx.now() } });
  }
  const now = ctx.now();
  out.push({ table: 'shifts', row: { ...shift, updatedAt: now, deletedAt: now } });
  return out;
}
