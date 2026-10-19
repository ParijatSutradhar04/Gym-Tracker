import { describe, expect, test } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  diffDays,
  eachDay,
  formatCount,
  formatKg,
  isValidDate,
  msUntilNextMidnight,
  todayLocal,
  weekdayIndex,
} from '../dates';

describe('dates', () => {
  test('addDays_crosses_month_year_and_leap', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-19', -19)).toBe('2026-09-30');
  });

  test('addDays_is_dst_safe', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });

  test('weekdayIndex', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0);
    expect(weekdayIndex('2026-10-25')).toBe(6);
  });

  test('addMonthsClamped_clamps', () => {
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-08-31', -3)).toBe('2026-05-31');
    expect(addMonthsClamped('2026-05-31', -3)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-10-19', -1)).toBe('2026-09-19');
  });

  test('todayLocal_uses_local_calendar_date', () => {
    expect(todayLocal(new Date(2026, 9, 19, 23, 59))).toBe('2026-10-19');
    expect(msUntilNextMidnight(new Date(2026, 9, 19, 23, 59, 0))).toBe(60000);
  });

  test('formatCount_and_formatKg', () => {
    expect(formatCount(4)).toBe('04');
    expect(formatCount(12)).toBe('12');
    expect(formatKg(60)).toBe('60');
    expect(formatKg(22.5)).toBe('22.5');
    expect(formatKg(62.5)).toBe('62.5');
    expect(formatKg(0.1 + 0.2)).toBe('0.3');
  });

  test('eachDay_inclusive', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(eachDay('2026-10-19', '2026-10-19')).toEqual(['2026-10-19']);
    expect(eachDay('2026-10-20', '2026-10-19')).toEqual([]);
  });

  test('isValidDate', () => {
    expect(isValidDate('2026-10-19')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-1-5')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});
