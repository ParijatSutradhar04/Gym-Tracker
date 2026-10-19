import { diffDays, type DateStr } from './dates';
import type { RepeatRule, RoutineVersion } from './types';

export const REPEAT_LABELS: Record<RepeatRule, string> = {
  weekly: 'Once a week',
  twice_weekly: 'Twice a week',
  biweekly: 'Once every 2 weeks',
  never: 'Never',
};

/** Whether this version's repeat rule lands on `date`. Twice a week = the start weekday and three days later. */
export function occursOn(
  v: Pick<RoutineVersion, 'repeatRule' | 'startDate' | 'effectiveFrom' | 'ended'>,
  date: DateStr,
): boolean {
  if (v.ended || date < v.effectiveFrom || date < v.startDate) return false;
  const d = diffDays(v.startDate, date);
  switch (v.repeatRule) {
    case 'weekly':
      return d % 7 === 0;
    case 'biweekly':
      return d % 14 === 0;
    case 'twice_weekly':
      return d % 7 === 0 || d % 7 === 3;
    case 'never':
      return date === v.startDate;
  }
}
