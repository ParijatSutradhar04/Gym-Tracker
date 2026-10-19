import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

const { nowIso } = await import('../ids');

afterEach(() => vi.restoreAllMocks());

describe('nowIso', () => {
  test('is_strictly_increasing_when_the_clock_stands_still_or_goes_back', () => {
    const clock = [Date.UTC(2026, 9, 19, 12), Date.UTC(2026, 9, 19, 12), Date.UTC(2026, 9, 19, 11)];
    vi.spyOn(Date, 'now').mockImplementation(() => clock.shift() ?? Date.UTC(2026, 9, 19, 11));
    const out = Array.from({ length: 5 }, () => nowIso());
    for (let i = 1; i < out.length; i++) expect(out[i] > out[i - 1]).toBe(true);
    expect(out[0]).toBe('2026-10-19T12:00:00.000Z');
    expect(out[1]).toBe('2026-10-19T12:00:00.001Z');
  });
});
