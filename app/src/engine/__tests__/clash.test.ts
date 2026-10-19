import { describe, expect, test } from 'vitest';
import { clashWarning, previewClashes } from '../clash';
import { emptyState } from '../state';
import { makeCtx, routineId, seedRoutine } from './fixtures';

function chest() {
  const ctx = makeCtx('2026-10-19');
  const s = seedRoutine(emptyState(), ctx, { title: 'Chest & Tricep', repeatRule: 'weekly', startDate: '2026-10-19' });
  return { ctx, s };
}

describe('clash preview', () => {
  test('legs_twice_weekly_from_friday_vs_chest_weekly_monday_warns', () => {
    const { ctx, s } = chest();
    const clashes = previewClashes(s, ctx, { kind: 'add', args: { date: '2026-10-23', title: 'Legs', repeatRule: 'twice_weekly' } });
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ weekday: 'Mon', holderTitle: 'Chest & Tricep' });
    expect(clashes[0].dates[0]).toBe('2026-10-26');
    expect(clashWarning(clashes)).toBe('Mondays are taken by Chest & Tricep.');
  });

  test('no_clash_returns_null', () => {
    const { ctx, s } = chest();
    const clashes = previewClashes(s, ctx, { kind: 'add', args: { date: '2026-10-21', title: 'Legs', repeatRule: 'weekly' } });
    expect(clashes).toEqual([]);
    expect(clashWarning(clashes)).toBeNull();
  });

  test('routine_that_wins_its_day_gets_no_warning', () => {
    let { ctx, s } = chest();
    s = seedRoutine(s, ctx, { title: 'Legs', repeatRule: 'weekly', startDate: '2026-10-23' });
    const clashes = previewClashes(s, ctx, {
      kind: 'change',
      args: { routineId: routineId(s, 'Chest & Tricep'), date: '2026-10-23', title: 'Chest & Tricep', repeatRule: 'twice_weekly' },
    });
    expect(clashes).toEqual([]);
  });

  test('warning_uses_the_candidate_horizon_only', () => {
    let { ctx, s } = chest();
    s = seedRoutine(s, ctx, { title: 'Late', repeatRule: 'weekly', startDate: '2027-06-02' });
    s = seedRoutine(s, ctx, { title: 'Loser', repeatRule: 'weekly', startDate: '2026-10-26' });
    const cmd = { kind: 'add' as const, args: { date: '2026-10-21', title: 'Legs', repeatRule: 'weekly' as const } };
    expect(previewClashes(s, ctx, cmd)).toEqual([]);
    const far = previewClashes(s, ctx, cmd, 400);
    expect(far.map((c) => [c.weekday, c.holderTitle])).toEqual([['Wed', 'Late']]);
  });

  test('several_clashes_join_with_a_space', () => {
    let { ctx, s } = chest();
    s = seedRoutine(s, ctx, { title: 'Legs', repeatRule: 'weekly', startDate: '2026-10-22' });
    const clashes = previewClashes(s, ctx, { kind: 'add', args: { date: '2026-10-19', title: 'Full', repeatRule: 'twice_weekly' } });
    expect(clashWarning(clashes)).toBe('Mondays are taken by Chest & Tricep. Thursdays are taken by Legs.');
  });
});
