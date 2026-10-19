import { describe, expect, test } from 'vitest';
import { addDays, eachDay } from '../dates';
import { occursOn } from '../repeat';
import type { RepeatRule } from '../types';

const S = '2026-10-19';
const v = (repeatRule: RepeatRule, startDate = S, extra: { effectiveFrom?: string; ended?: boolean } = {}) => ({
  repeatRule,
  startDate,
  effectiveFrom: extra.effectiveFrom ?? startDate,
  ended: extra.ended ?? false,
});

describe('occursOn', () => {
  test('weekly_lands_on_S_plus_multiples_of_7', () => {
    for (const d of ['2026-10-19', '2026-10-26', '2026-11-02']) expect(occursOn(v('weekly'), d)).toBe(true);
    for (const d of ['2026-10-20', '2026-10-12']) expect(occursOn(v('weekly'), d)).toBe(false);
  });

  test('biweekly', () => {
    for (const d of ['2026-10-19', '2026-11-02', '2026-11-16']) expect(occursOn(v('biweekly'), d)).toBe(true);
    expect(occursOn(v('biweekly'), '2026-10-26')).toBe(false);
  });

  test('never_only_start', () => {
    expect(occursOn(v('never'), '2026-10-19')).toBe(true);
    expect(occursOn(v('never'), '2026-10-26')).toBe(false);
  });

  test.each([
    ['2026-10-19', 'Mon+Thu'],
    ['2026-10-20', 'Tue+Fri'],
    ['2026-10-21', 'Wed+Sat'],
    ['2026-10-22', 'Thu+Sun'],
    ['2026-10-23', 'Fri+Mon'],
    ['2026-10-24', 'Sat+Tue'],
    ['2026-10-25', 'Sun+Wed'],
  ])('twice_weekly_from_every_weekday start %s → %s', (start) => {
    const window = eachDay(start, addDays(start, 13));
    const hits = window.filter((d) => occursOn(v('twice_weekly', start), d));
    expect(hits).toEqual([0, 3, 7, 10].map((n) => addDays(start, n)));
    for (const d of eachDay(addDays(start, -14), addDays(start, -1))) {
      expect(occursOn(v('twice_weekly', start), d)).toBe(false);
    }
  });

  test('weekly_across_leap_day', () => {
    expect(occursOn(v('weekly', '2028-02-22'), '2028-02-29')).toBe(true);
  });

  test('ended_version_never_occurs', () => {
    expect(occursOn(v('weekly', S, { ended: true }), S)).toBe(false);
    expect(occursOn(v('never', S, { ended: true }), S)).toBe(false);
  });

  test('not_before_effectiveFrom', () => {
    expect(occursOn(v('weekly', S, { effectiveFrom: '2026-11-01' }), '2026-10-26')).toBe(false);
    expect(occursOn(v('weekly', S, { effectiveFrom: '2026-11-01' }), '2026-11-02')).toBe(true);
  });
});
