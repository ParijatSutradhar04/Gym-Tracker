import { addDays, WEEKDAY_FULL, WEEKDAY_SHORT, weekdayIndex, type DateStr } from './dates';
import { droppedOccurrences, scheduleOn } from './schedule';
import { addSchedule, changeSchedule } from './scheduleEdits';
import { applyChanges } from './state';
import { EngineError, type Change, type Ctx, type DataState } from './types';

export type ScheduleCommand =
  | { kind: 'add'; args: Parameters<typeof addSchedule>[2] }
  | { kind: 'change'; args: Parameters<typeof changeSchedule>[2] };

export interface ClashInfo {
  weekday: string;
  holderTitle: string;
  dates: DateStr[];
}

/** Occurrences the candidate routine would lose to existing ones over the horizon, by weekday and holder. */
export function previewClashes(state: DataState, ctx: Ctx, cmd: ScheduleCommand, horizonDays = 182): ClashInfo[] {
  let changes: Change[];
  try {
    changes = cmd.kind === 'add' ? addSchedule(state, ctx, cmd.args) : changeSchedule(state, ctx, cmd.args);
  } catch (e) {
    if (e instanceof EngineError) return []; // incomplete input: nothing to preview yet
    throw e;
  }
  const routineId = cmd.kind === 'add' ? changes.find((c) => c.table === 'routines')!.row.id : cmd.args.routineId;
  const scratch = applyChanges(state, changes);
  const { date } = cmd.args;
  const groups = new Map<string, ClashInfo>();
  for (const d of droppedOccurrences(scratch, routineId, date, addDays(date, horizonDays))) {
    const weekday = WEEKDAY_SHORT[weekdayIndex(d)];
    const holderTitle = scheduleOn(scratch, d)?.title ?? '';
    const key = weekday + '\u0000' + holderTitle;
    const group = groups.get(key);
    if (group) group.dates.push(d);
    else groups.set(key, { weekday, holderTitle, dates: [d] });
  }
  return [...groups.values()];
}

/** "Mondays are taken by Chest & Tricep." — one sentence per clash; null when none. */
export function clashWarning(clashes: ClashInfo[]): string | null {
  if (clashes.length === 0) return null;
  return clashes
    .map((c) => `${WEEKDAY_FULL[WEEKDAY_SHORT.indexOf(c.weekday as (typeof WEEKDAY_SHORT)[number])]}s are taken by ${c.holderTitle}.`)
    .join(' ');
}
