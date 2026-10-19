import { describe, expect, test } from 'vitest';
import { eachDay } from '../dates';
import { stableId } from '../ids';

const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('stableId', () => {
  test('stableId_is_deterministic_and_uuid_shaped', () => {
    const id = stableId('day', '2026-10-19');
    expect(id).toMatch(UUID_V8);
    expect(stableId('day', '2026-10-19')).toBe(id);
    expect(stableId('day', '2026-10-20')).not.toBe(id);
    expect(stableId('day_exercise', '2026-10-19')).not.toBe(id);
    expect(stableId('set', '2026-10-19')).not.toBe(id);
  });

  test('stableId_output_is_pinned_across_app_versions', () => {
    // Two app versions that derive different ids for the same day stop converging; never change this value.
    expect(stableId('day', '2026-10-19')).toBe('49229737-119b-8b45-b20b-aa8bcd6080d8');
  });

  test('no_collisions_over_1000_keys', () => {
    const dates = eachDay('2026-01-01', '2028-09-26');
    expect(dates).toHaveLength(1000);
    const ids = new Set<string>();
    for (const [i, date] of dates.entries()) {
      ids.add(stableId('day', date));
      ids.add(stableId('day_exercise', `${date}|${i % 8}`));
      ids.add(stableId('set', `${stableId('day_exercise', `${date}|0`)}|${(i % 12) + 1}`));
    }
    expect(ids.size).toBe(3000);
    for (const id of ids) expect(id).toMatch(UUID_V8);
  });
});
