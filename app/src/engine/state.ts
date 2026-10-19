import type { DateStr } from './dates';
import type {
  Change,
  DataState,
  Day,
  DayExercise,
  OccurrenceMove,
  RoutineVersion,
  RowOf,
  SetRow,
  TableName,
} from './types';

export const TABLES: readonly TableName[] = [
  'routines',
  'routine_versions',
  'days',
  'shifts',
  'occurrence_moves',
  'day_exercises',
  'sets',
];

export function emptyState(): DataState {
  return {
    routines: new Map(),
    routine_versions: new Map(),
    days: new Map(),
    shifts: new Map(),
    occurrence_moves: new Map(),
    day_exercises: new Map(),
    sets: new Map(),
  };
}

/** Returns a new state with each change's row replacing the row with the same id. Untouched tables keep their Map. */
export function applyChanges(state: DataState, changes: readonly Change[]): DataState {
  if (changes.length === 0) return state;
  const next = { ...state } as DataState;
  const copied = new Set<TableName>();
  for (const c of changes) {
    if (!copied.has(c.table)) {
      (next as Record<TableName, Map<string, unknown>>)[c.table] = new Map(state[c.table] as Map<string, unknown>);
      copied.add(c.table);
    }
    (next[c.table] as Map<string, unknown>).set(c.row.id, c.row);
  }
  return next;
}

/** Last-write-wins: a remote row is taken only when absent locally or strictly newer by updatedAt. */
export function mergeRemote(state: DataState, changes: readonly Change[]): { state: DataState; accepted: Change[] } {
  const accepted: Change[] = [];
  const seen = new Map<string, string>();
  for (const c of changes) {
    const key = c.table + '\u0000' + c.row.id;
    const local = seen.get(key) ?? (state[c.table] as Map<string, { updatedAt: string }>).get(c.row.id)?.updatedAt;
    if (local === undefined || c.row.updatedAt > local) {
      accepted.push(c);
      seen.set(key, c.row.updatedAt);
    }
  }
  return { state: applyChanges(state, accepted), accepted };
}

/**
 * Every row stamped after `after`, restamped to `now`, tombstones included. A device clock that ran fast
 * leaves rows that would otherwise win every merge until real time caught up.
 */
export function restampRows(state: DataState, after: string, now: string): Change[] {
  return TABLES.flatMap((table) =>
    [...(state[table] as Map<string, Change['row']>).values()]
      .filter((row) => row.updatedAt > after)
      .map((row) => ({ table, row: { ...row, updatedAt: now } }) as Change),
  );
}

export interface Recorder {
  state(): DataState;
  apply(changes: Change[]): void;
  changes(): Change[];
}

/**
 * Lets a command read its own intermediate writes while collecting them. A row written twice keeps
 * only its last write (in its first slot), so a command never emits two same-timestamp versions of a row.
 */
export function createRecorder(initial: DataState): Recorder {
  let current = initial;
  const all: Change[] = [];
  const slot = new Map<string, number>();
  return {
    state: () => current,
    apply(changes) {
      current = applyChanges(current, changes);
      for (const c of changes) {
        const key = c.table + ':' + c.row.id;
        const i = slot.get(key);
        if (i === undefined) {
          slot.set(key, all.length);
          all.push(c);
        } else all[i] = c;
      }
    },
    changes: () => all.slice(),
  };
}

export function liveRows<T extends TableName>(state: DataState, table: T): RowOf<T>[] {
  const out: RowOf<T>[] = [];
  for (const row of (state[table] as Map<string, RowOf<T>>).values()) if (row.deletedAt === null) out.push(row);
  return out;
}

export interface Index {
  /** Live versions per routine, sorted by effectiveFrom. */
  versionsByRoutine: Map<string, RoutineVersion[]>;
  /** One live day row per date; lowest id wins on duplicates. */
  dayByDate: Map<DateStr, Day>;
  /** Live day exercises per date, sorted by position then id. */
  exercisesByDate: Map<DateStr, DayExercise[]>;
  /** Live sets per day exercise, sorted by setNumber. */
  setsByExercise: Map<string, SetRow[]>;
  /** Live occurrence moves, sorted by updatedAt then id. */
  moves: OccurrenceMove[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function group<R, K>(rows: R[], key: (r: R) => K): Map<K, R[]> {
  const m = new Map<K, R[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const indexCache = new WeakMap<DataState, Index>();

export function getIndex(state: DataState): Index {
  const cached = indexCache.get(state);
  if (cached) return cached;

  const versionsByRoutine = group(liveRows(state, 'routine_versions'), (v) => v.routineId);
  for (const list of versionsByRoutine.values()) list.sort((a, b) => cmp(a.effectiveFrom, b.effectiveFrom) || cmp(a.id, b.id));

  const dayByDate = new Map<DateStr, Day>();
  for (const d of liveRows(state, 'days')) {
    const prev = dayByDate.get(d.date);
    if (!prev || d.id < prev.id) dayByDate.set(d.date, d);
  }

  const exercisesByDate = group(liveRows(state, 'day_exercises'), (x) => x.date);
  for (const list of exercisesByDate.values()) list.sort((a, b) => a.position - b.position || cmp(a.id, b.id));

  const setsByExercise = group(liveRows(state, 'sets'), (s) => s.dayExerciseId);
  for (const list of setsByExercise.values()) list.sort((a, b) => a.setNumber - b.setNumber || cmp(a.id, b.id));

  const moves = liveRows(state, 'occurrence_moves').sort((a, b) => cmp(a.updatedAt, b.updatedAt) || cmp(a.id, b.id));

  const index: Index = { versionsByRoutine, dayByDate, exercisesByDate, setsByExercise, moves };
  indexCache.set(state, index);
  return index;
}
