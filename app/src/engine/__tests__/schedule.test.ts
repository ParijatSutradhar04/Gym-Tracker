import { describe, expect, test } from 'vitest';
import { droppedOccurrences, nextOccurrence, scheduleBetween, scheduleOn } from '../schedule';
import { emptyState } from '../state';
import { addMove, addVersion, makeCtx, routineId, seedRoutine } from './fixtures';

function chestAndLegs() {
  const ctx = makeCtx('2026-10-19');
  let s = seedRoutine(emptyState(), ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate: '2026-10-19' });
  s = seedRoutine(s, ctx, { title: 'Legs', repeatRule: 'twice_weekly', startDate: '2026-10-23' });
  return { ctx, s };
}

describe('schedule', () => {
  test('clash_earlier_created_routine_keeps_the_day', () => {
    const { s } = chestAndLegs();
    expect(scheduleOn(s, '2026-10-26')?.title).toBe('Chest & Tricep');
    expect(scheduleOn(s, '2026-10-30')?.title).toBe('Legs');
    expect(scheduleOn(s, '2026-11-02')?.title).toBe('Chest & Tricep');
    expect(scheduleOn(s, '2026-10-27')).toBeNull();
    expect(droppedOccurrences(s, routineId(s, 'Legs'), '2026-10-19', '2026-11-09')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
    ]);
  });

  test('clash_tie_on_createdAt_uses_lower_id', () => {
    const ctx = makeCtx('2026-10-19');
    const createdAt = '2026-10-01T00:00:00.000Z';
    let s = seedRoutine(emptyState(), ctx, { id: 'r-b', title: 'B', repeatRule: 'weekly', startDate: '2026-10-19', createdAt });
    s = seedRoutine(s, ctx, { id: 'r-a', title: 'A', repeatRule: 'weekly', startDate: '2026-10-19', createdAt });
    expect(scheduleOn(s, '2026-10-19')?.title).toBe('A');
    expect(droppedOccurrences(s, 'r-b', '2026-10-19', '2026-10-26')).toEqual(['2026-10-19', '2026-10-26']);
  });

  test('same_routine_never_duplicates_on_a_date', () => {
    const ctx = makeCtx('2026-10-19');
    let s = seedRoutine(emptyState(), ctx, { title: 'Full', repeatRule: 'twice_weekly', startDate: '2026-10-19' });
    const id = routineId(s, 'Full');
    s = addMove(s, ctx, { routineId: id, fromDate: '2026-10-19', toDate: '2026-10-22' });
    const week = scheduleBetween(s, '2026-10-19', '2026-10-25');
    expect([...week.keys()]).toEqual(['2026-10-22']);
    expect(droppedOccurrences(s, id, '2026-10-19', '2026-10-25')).toEqual([]);
  });

  test('version_in_effect_is_latest_not_after_date', () => {
    const ctx = makeCtx('2026-11-02');
    let s = seedRoutine(emptyState(), ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate: '2026-10-19' });
    s = addVersion(s, ctx, routineId(s, 'Chest & Tricep'), { effectiveFrom: '2026-11-02', title: 'Push', repeatRule: 'twice_weekly' });
    expect(scheduleOn(s, '2026-10-26')?.title).toBe('Chest & Tricep');
    expect(scheduleOn(s, '2026-11-02')?.title).toBe('Push');
    expect(scheduleOn(s, '2026-11-05')?.title).toBe('Push');
    expect(scheduleOn(s, '2026-10-29')).toBeNull();
  });

  test('unlogged_past_day_keeps_planned_routine', () => {
    const ctx = makeCtx('2026-11-02');
    let s = seedRoutine(emptyState(), ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate: '2026-10-19' });
    s = addVersion(s, ctx, routineId(s, 'Chest & Tricep'), { effectiveFrom: '2026-11-02', title: 'Push' });
    expect(scheduleOn(s, '2026-10-19')?.title).toBe('Chest & Tricep');
  });

  test('moves_redate_an_occurrence', () => {
    const ctx = makeCtx('2026-10-23');
    let s = seedRoutine(emptyState(), ctx, { title: 'Arms', repeatRule: 'weekly', startDate: '2026-10-23' });
    s = addMove(s, ctx, { routineId: routineId(s, 'Arms'), fromDate: '2026-10-23', toDate: '2026-10-24' });
    expect(scheduleOn(s, '2026-10-24')?.title).toBe('Arms');
    expect(scheduleOn(s, '2026-10-23')).toBeNull();
    expect(scheduleOn(s, '2026-10-30')?.title).toBe('Arms');
  });

  test('moves_chain_in_updatedAt_order', () => {
    const ctx = makeCtx('2026-10-23');
    let s = seedRoutine(emptyState(), ctx, { title: 'Arms', repeatRule: 'weekly', startDate: '2026-10-23' });
    const id = routineId(s, 'Arms');
    s = addMove(s, ctx, { routineId: id, fromDate: '2026-10-23', toDate: '2026-10-24' });
    s = addMove(s, ctx, { routineId: id, fromDate: '2026-10-24', toDate: '2026-10-25' });
    const week = scheduleBetween(s, '2026-10-23', '2026-10-29');
    expect([...week.keys()]).toEqual(['2026-10-25']);
  });

  test('moved_entry_uses_version_at_destination', () => {
    const ctx = makeCtx('2026-10-23');
    let s = seedRoutine(emptyState(), ctx, { title: 'Arms', repeatRule: 'weekly', startDate: '2026-10-23', exercises: ['Curl'] });
    const id = routineId(s, 'Arms');
    s = addMove(s, ctx, { routineId: id, fromDate: '2026-10-23', toDate: '2026-10-24' });
    s = addVersion(s, ctx, id, { effectiveFrom: '2026-10-24', title: 'Arms+', exercises: ['Curl', 'Dip'] });
    const sat = scheduleOn(s, '2026-10-24');
    expect(sat?.title).toBe('Arms+');
    expect(sat?.exercises).toEqual(['Curl', 'Dip']);
  });

  test('deleted_move_is_ignored', () => {
    const ctx = makeCtx('2026-10-23');
    let s = seedRoutine(emptyState(), ctx, { title: 'Arms', repeatRule: 'weekly', startDate: '2026-10-23' });
    s = addMove(s, ctx, { routineId: routineId(s, 'Arms'), fromDate: '2026-10-23', toDate: '2026-10-24', deleted: true });
    expect(scheduleOn(s, '2026-10-23')?.title).toBe('Arms');
    expect(scheduleOn(s, '2026-10-24')).toBeNull();
  });

  test('move_from_before_the_window_lands_inside_it', () => {
    const ctx = makeCtx('2026-10-23');
    let s = seedRoutine(emptyState(), ctx, { title: 'Arms', repeatRule: 'weekly', startDate: '2026-10-23' });
    s = addMove(s, ctx, { routineId: routineId(s, 'Arms'), fromDate: '2026-10-23', toDate: '2026-10-25' });
    expect([...scheduleBetween(s, '2026-10-24', '2026-10-26').keys()]).toEqual(['2026-10-25']);
  });

  test('ended_routine_releases_its_days_to_the_clashing_routine', () => {
    const { ctx, s: s0 } = chestAndLegs();
    const s = addVersion(s0, ctx, routineId(s0, 'Chest & Tricep'), { effectiveFrom: '2026-10-26', ended: true });
    expect(scheduleOn(s, '2026-10-26')?.title).toBe('Legs');
    expect(scheduleOn(s, '2026-10-19')?.title).toBe('Chest & Tricep');
  });

  test('nextOccurrence', () => {
    const ctx = makeCtx('2026-10-19');
    let s = seedRoutine(emptyState(), ctx, { title: 'Sunday', repeatRule: 'weekly', startDate: '2026-10-18' });
    s = seedRoutine(s, ctx, { title: 'Once', repeatRule: 'never', startDate: '2026-10-01' });
    expect(nextOccurrence(s, routineId(s, 'Sunday'), '2026-10-18')).toBe('2026-10-25');
    expect(nextOccurrence(s, routineId(s, 'Once'), '2026-10-19')).toBeNull();
  });
});
