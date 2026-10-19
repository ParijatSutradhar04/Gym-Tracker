import { describe, expect, test } from 'vitest';
import { dayExercises, ensureDayLog, startBackfill } from '../dayLog';
import { emptyState, getIndex } from '../state';
import { expectCode, makeCtx, run, seedRoutine } from './fixtures';

function chest(today = '2026-10-19') {
  const ctx = makeCtx(today);
  const s = seedRoutine(emptyState(), ctx, {
    title: 'Chest & Tricep',
    repeatRule: 'weekly',
    startDate: '2026-10-19',
    exercises: ['Bench press', 'Cable fly'],
  });
  return { ctx, s };
}

describe('dayLog', () => {
  test('ensureDayLog_snapshots_title_and_exercises', () => {
    const { ctx, s } = chest();
    const s1 = run(s, ensureDayLog(s, ctx, '2026-10-19'));
    const idx = getIndex(s1);
    const day = idx.dayByDate.get('2026-10-19');
    expect(day).toMatchObject({ title: 'Chest & Tricep', hasLog: true, status: null });
    expect(day?.routineId).toBe(getIndex(s).versionsByRoutine.keys().next().value);
    expect(idx.exercisesByDate.get('2026-10-19')?.map((x) => [x.position, x.name])).toEqual([
      [0, 'Bench press'],
      [1, 'Cable fly'],
    ]);
    expect(dayExercises(s1, '2026-10-19')).toEqual([
      { position: 0, name: 'Bench press' },
      { position: 1, name: 'Cable fly' },
    ]);
  });

  test('ensureDayLog_noop_when_logged', () => {
    const { ctx, s } = chest();
    const s1 = run(s, ensureDayLog(s, ctx, '2026-10-19'));
    expect(ensureDayLog(s1, ctx, '2026-10-19')).toEqual([]);
  });

  test('ensureDayLog_without_routine_throws_NO_ROUTINE', () => {
    const { ctx, s } = chest();
    expectCode(() => ensureDayLog(s, ctx, '2026-10-20'), 'NO_ROUTINE');
  });

  test('dayExercises_unlogged_day_lists_the_schedule', () => {
    const { s } = chest();
    expect(dayExercises(s, '2026-10-26').map((x) => x.name)).toEqual(['Bench press', 'Cable fly']);
    expect(dayExercises(s, '2026-10-20')).toEqual([]);
  });

  test('startBackfill_creates_titled_empty_log_on_past_day', () => {
    const { ctx, s } = chest();
    const s1 = run(s, startBackfill(s, ctx, { date: '2026-10-14', title: 'Legs day' }));
    expect(getIndex(s1).dayByDate.get('2026-10-14')).toMatchObject({ routineId: null, title: 'Legs day', hasLog: true, status: null });
    expect(dayExercises(s1, '2026-10-14')).toEqual([]);
  });

  test('startBackfill_rejects_today_future_and_scheduled_days', () => {
    const { ctx, s } = chest('2026-10-26');
    expectCode(() => startBackfill(s, ctx, { date: '2026-10-19', title: 'X' }), 'NOT_AVAILABLE');
    expectCode(() => startBackfill(s, ctx, { date: '2026-10-26', title: 'X' }), 'NOT_AVAILABLE');
    expectCode(() => startBackfill(s, ctx, { date: '2026-10-27', title: 'X' }), 'NOT_AVAILABLE');
    const s1 = run(s, startBackfill(s, ctx, { date: '2026-10-21', title: 'X' }));
    expectCode(() => startBackfill(s1, ctx, { date: '2026-10-21', title: 'Y' }), 'NOT_AVAILABLE');
  });

  test('startBackfill_blank_title_throws_EMPTY_NAME', () => {
    const { ctx, s } = chest();
    expectCode(() => startBackfill(s, ctx, { date: '2026-10-14', title: '   ' }), 'EMPTY_NAME');
    const s1 = run(s, startBackfill(s, ctx, { date: '2026-10-14', title: '  Legs day  ' }));
    expect(getIndex(s1).dayByDate.get('2026-10-14')?.title).toBe('Legs day');
  });
});
