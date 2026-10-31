import { describe, expect, test } from 'vitest';
import { buildCsv, csvFileName, CSV_COLUMNS, exportRange } from '../csv';
import { ensureDayLog, startBackfill } from '../dayLog';
import { addExercise, changeSchedule, deleteExercise } from '../scheduleEdits';
import { syncSets } from '../sets';
import { emptyState, getIndex } from '../state';
import type { Ctx, DataState, Day } from '../types';
import { expectCode, logSets, makeCtx, routineId, run, seedRoutine } from './fixtures';

const TODAY = '2026-10-19';
const HEADER = 'date,weekday,routine,exercise,set_number,reps,weight_kg,volume_kg,status';

function markDay(s: DataState, ctx: Ctx, date: string, status: Day['status']): DataState {
  const s1 = run(s, ensureDayLog(s, ctx, date));
  const day = getIndex(s1).dayByDate.get(date)!;
  return run(s1, [{ table: 'days', row: { ...day, status, shiftId: 'sh-' + date, updatedAt: ctx.now() } }]);
}

function seeded(title = 'Chest & Tricep', exercises = ['Bench press', 'Pull-up']) {
  const ctx = makeCtx(TODAY);
  const s = seedRoutine(emptyState(), ctx, { title, repeatRule: 'weekly', startDate: '2026-09-07', exercises });
  return { ctx, s, id: routineId(s, title) };
}

function fixture() {
  const { ctx, s: s0, id } = seeded();
  let s = logSets(s0, ctx, '2026-09-07', 'Bench press', [[10, 60], [8, 62.5]]);
  s = logSets(s, ctx, '2026-09-07', 'Pull-up', [[12, null]]);
  s = markDay(s, ctx, '2026-09-14', 'skipped');
  s = markDay(s, ctx, '2026-09-21', 'missed');
  return { ctx, s, id };
}

const lines = (csv: string) => csv.split('\n');

describe('buildCsv', () => {
  test('header_and_columns_in_order', () => {
    const { s } = fixture();
    expect(CSV_COLUMNS.join(',')).toBe(HEADER);
    expect(lines(buildCsv(s, '2026-09-01', TODAY, TODAY))[0]).toBe(HEADER);
  });

  test('set_rows', () => {
    const { s } = fixture();
    const out = lines(buildCsv(s, '2026-09-07', '2026-09-07', TODAY));
    expect(out).toEqual([
      HEADER,
      '2026-09-07,Mon,Chest & Tricep,Bench press,1,10,60,600,logged',
      '2026-09-07,Mon,Chest & Tricep,Bench press,2,8,62.5,500,logged',
      '2026-09-07,Mon,Chest & Tricep,Pull-up,1,12,,,logged',
      '',
    ]);
  });

  test('status_rows', () => {
    const { s } = fixture();
    const out = lines(buildCsv(s, '2026-09-08', '2026-10-18', TODAY));
    expect(out).toEqual([
      HEADER,
      '2026-09-14,Mon,Chest & Tricep,,,,,,skipped',
      '2026-09-21,Mon,Chest & Tricep,,,,,,missed',
      '2026-09-28,Mon,Chest & Tricep,,,,,,not_logged',
      '2026-10-05,Mon,Chest & Tricep,,,,,,not_logged',
      '2026-10-12,Mon,Chest & Tricep,,,,,,not_logged',
      '',
    ]);
  });

  test('range_edges_are_inclusive', () => {
    const { s } = fixture();
    const out = buildCsv(s, '2026-09-14', '2026-09-21', TODAY);
    expect(out).toContain('2026-09-14,');
    expect(out).toContain('2026-09-21,');
    expect(out).not.toContain('2026-09-07');
    expect(out).not.toContain('2026-09-28');
  });

  test('future_and_today_and_rest_days_produce_no_rows', () => {
    const { s } = fixture();
    const rows = lines(buildCsv(s, '2026-09-01', '2026-11-30', TODAY)).slice(1, -1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.slice(0, 10) < TODAY)).toBe(true);
    expect(rows.every((r) => r.slice(11, 14) === 'Mon')).toBe(true);
  });

  test('todays_logged_sets_and_status_are_exported', () => {
    const { ctx, s } = fixture();
    const s1 = logSets(s, ctx, TODAY, 'Bench press', [[5, 80]]);
    expect(buildCsv(s1, TODAY, TODAY, TODAY)).toBe(`${HEADER}\n2026-10-19,Mon,Chest & Tricep,Bench press,1,5,80,400,logged\n`);
    const s2 = markDay(s, ctx, TODAY, 'skipped');
    expect(buildCsv(s2, TODAY, TODAY, TODAY)).toBe(`${HEADER}\n2026-10-19,Mon,Chest & Tricep,,,,,,skipped\n`);
  });

  test('names_are_as_logged_that_day', () => {
    const { ctx, s, id } = fixture();
    const s1 = run(s, changeSchedule(s, ctx, { routineId: id, date: TODAY, title: 'Push', repeatRule: 'weekly' }));
    const out = buildCsv(s1, '2026-09-07', '2026-09-07', TODAY);
    expect(out).toContain('2026-09-07,Mon,Chest & Tricep,Bench press,1,10,60,600,logged');
    expect(out).not.toContain('Push');
  });

  test('quoting', () => {
    const { ctx, s } = seeded('Legs, core', ['5" plate']);
    const s1 = logSets(s, ctx, '2026-09-07', '5" plate', [[10, 20]]);
    expect(lines(buildCsv(s1, '2026-09-07', '2026-09-07', TODAY))[1]).toBe('2026-09-07,Mon,"Legs, core","5"" plate",1,10,20,200,logged');
  });

  test('sorted_by_date_exercise_order_then_set', () => {
    const { ctx, s } = seeded();
    let s1 = logSets(s, ctx, '2026-09-14', 'Pull-up', [[12, null]]);
    s1 = logSets(s1, ctx, '2026-09-14', 'Bench press', [[10, 60], [8, 62.5]]);
    s1 = logSets(s1, ctx, '2026-09-07', 'Bench press', [[1, 1]]);
    const out = lines(buildCsv(s1, '2026-09-07', '2026-09-14', TODAY)).map((l) => l.split(',').slice(0, 5).join(','));
    expect(out.slice(1, -1)).toEqual([
      '2026-09-07,Mon,Chest & Tricep,Bench press,1',
      '2026-09-14,Mon,Chest & Tricep,Bench press,1',
      '2026-09-14,Mon,Chest & Tricep,Bench press,2',
      '2026-09-14,Mon,Chest & Tricep,Pull-up,1',
    ]);
  });

  test('empty_range_returns_header_only', () => {
    expect(buildCsv(emptyState(), '2026-09-01', '2026-10-18', TODAY)).toBe(HEADER + '\n');
  });

  test('backfilled_day_exports_with_its_title', () => {
    const { ctx, s } = seeded();
    let s1 = run(s, startBackfill(s, ctx, { date: '2026-09-09', title: 'Cardio' }));
    s1 = run(s1, addExercise(s1, ctx, { date: '2026-09-09', name: 'Rowing' }));
    s1 = logSets(s1, ctx, '2026-09-09', 'Rowing', [[20, null]]);
    expect(lines(buildCsv(s1, '2026-09-09', '2026-09-09', TODAY))[1]).toBe('2026-09-09,Wed,Cardio,Rowing,1,20,,,logged');
  });

  test('deleted_sets_and_exercises_are_not_exported', () => {
    const { ctx, s } = fixture();
    const rows = [{ reps: 10, weightKg: 60, touched: true, isDrop: false }];
    let s1 = run(s, syncSets(s, ctx, { date: '2026-09-07', position: 0, rows, includeUntouched: true }));
    s1 = run(s1, deleteExercise(s1, ctx, { date: '2026-09-07', position: 1 }));
    expect(lines(buildCsv(s1, '2026-09-07', '2026-09-07', TODAY)).slice(1)).toEqual([
      '2026-09-07,Mon,Chest & Tricep,Bench press,1,10,60,600,logged',
      '',
    ]);
  });

  test('sets_without_reps_are_not_rows', () => {
    const { ctx, s } = seeded();
    const s1 = logSets(s, ctx, '2026-09-07', 'Bench press', [[null, 60]]);
    expect(lines(buildCsv(s1, '2026-09-07', '2026-09-07', TODAY))[1]).toBe('2026-09-07,Mon,Chest & Tricep,,,,,,not_logged');
  });
});

describe('ranges', () => {
  test('ranges', () => {
    expect(exportRange('last_month', TODAY)).toEqual({ from: '2026-09-19', to: TODAY });
    expect(exportRange('last_3_months', TODAY)).toEqual({ from: '2026-07-19', to: TODAY });
    expect(exportRange('last_month', '2026-03-31').from).toBe('2026-02-28');
    expect(exportRange('last_month', '2028-03-31').from).toBe('2028-02-29');
    expect(exportRange('last_3_months', '2026-08-31').from).toBe('2026-05-31');
    expect(exportRange('custom', TODAY, { from: '2026-10-01', to: '2026-12-01' })).toEqual({ from: '2026-10-01', to: TODAY });
    expectCode(() => exportRange('custom', TODAY, { from: '2026-10-10', to: '2026-10-01' }), 'INVALID_RANGE');
    expectCode(() => exportRange('custom', TODAY, { from: '2026-10-25', to: '2026-10-30' }), 'INVALID_RANGE');
  });

  test('csv_file_name', () => {
    expect(csvFileName('2026-09-01', '2026-10-18')).toBe('gym-log_2026-09-01_to_2026-10-18.csv');
  });
});
