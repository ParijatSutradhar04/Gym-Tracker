import type { DateStr } from './dates';

export type TableName =
  | 'routines'
  | 'routine_versions'
  | 'days'
  | 'shifts'
  | 'occurrence_moves'
  | 'day_exercises'
  | 'sets';

export interface BaseRow {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type RepeatRule = 'weekly' | 'twice_weekly' | 'biweekly' | 'never';

export interface Routine extends BaseRow {
  createdAt: string;
}

export interface RoutineVersion extends BaseRow {
  routineId: string;
  effectiveFrom: DateStr;
  title: string;
  repeatRule: RepeatRule;
  startDate: DateStr;
  exercises: string[];
  ended: boolean;
}

export interface Day extends BaseRow {
  date: DateStr;
  status: 'missed' | 'skipped' | null;
  shiftId: string | null;
  routineId: string | null;
  title: string | null;
  hasLog: boolean;
}

export interface RowRef {
  table: TableName;
  id: string;
}

export interface Shift extends BaseRow {
  date: DateStr;
  mode: 'skip' | 'catch_up' | 'permanent';
  locked: boolean;
  /** Rows this shift created; tombstoned on restore. */
  created: RowRef[];
  /** Full prior rows to re-upsert on restore. */
  before: Change[];
}

export interface OccurrenceMove extends BaseRow {
  routineId: string;
  fromDate: DateStr;
  toDate: DateStr;
  shiftId: string;
}

export interface DayExercise extends BaseRow {
  date: DateStr;
  position: number;
  name: string;
}

export interface SetRow extends BaseRow {
  dayExerciseId: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
}

interface RowTypes {
  routines: Routine;
  routine_versions: RoutineVersion;
  days: Day;
  shifts: Shift;
  occurrence_moves: OccurrenceMove;
  day_exercises: DayExercise;
  sets: SetRow;
}

export type RowOf<T extends TableName> = RowTypes[T];

export type Change = { [T in TableName]: { table: T; row: RowOf<T> } }[TableName];

export type DataState = { [T in TableName]: Map<string, RowOf<T>> };

export interface Ctx {
  now(): string;
  newId(): string;
  today: DateStr;
}

export type EngineErrorCode =
  | 'EMPTY_NAME'
  | 'NAME_TOO_LONG'
  | 'READ_ONLY_FUTURE'
  | 'NOT_EDITABLE_PAST'
  | 'NO_ROUTINE'
  | 'NOT_AVAILABLE'
  | 'INVALID_RANGE'
  | 'NOT_FOUND';

export class EngineError extends Error {
  constructor(public code: EngineErrorCode, message: string = code) {
    super(message);
    this.name = 'EngineError';
  }
}
