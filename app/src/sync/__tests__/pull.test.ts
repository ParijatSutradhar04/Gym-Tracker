import { describe, expect, test } from 'vitest';
import { MemoryStorage } from '../../data/storage';
import type { Change } from '../../engine/types';
import type { PullPage, SyncApi } from '../api';
import { createCursorStore, type CursorStore } from '../cursor';
import { pullAll } from '../pull';

const T = '2026-10-19T12:00:00.000Z';

const day = (i: number): Change => ({
  table: 'days',
  row: { id: `d${i}`, date: '2026-10-19', updatedAt: T, deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true },
});

/** A server holding `total` changes at seq 1…total; records every pull as [cursor, limit]. */
function fakeServer(total: number) {
  const rows = Array.from({ length: total }, (_, i) => day(i));
  const requests: [number, number | undefined][] = [];
  const api: SyncApi = {
    push: () => Promise.reject(new Error('not used')),
    pull: async (cursor, limit): Promise<PullPage> => {
      requests.push([cursor, limit]);
      const changes = rows.slice(cursor, cursor + (limit ?? 500));
      return { changes, cursor: cursor + changes.length, hasMore: cursor + changes.length < total, serverTime: T };
    },
  };
  return { api, requests };
}

/** Records what was applied; `failOn` makes that call (1-based) throw. */
function applier(log: string[] = [], failOn?: number) {
  const applied: Change[] = [];
  let calls = 0;
  const apply = async (changes: Change[]) => {
    if (++calls === failOn) throw new Error('apply failed');
    applied.push(...changes);
    log.push(`apply:${changes.length}`);
  };
  return { apply, applied };
}

function loggedCursor(cursor: CursorStore, log: string[]): CursorStore {
  return {
    get: () => cursor.get(),
    set: async (n) => {
      await cursor.set(n);
      log.push(`set:${n}`);
    },
  };
}

describe('pullAll', () => {
  test('pages_until_hasMore_is_false', async () => {
    const { api, requests } = fakeServer(1200);
    const cursor = createCursorStore(new MemoryStorage());
    const { apply, applied } = applier();

    const result = await pullAll({ api, cursor, apply });

    expect(result).toEqual({ pages: 3, changes: 1200, serverTime: T });
    expect(requests.map(([c]) => c)).toEqual([0, 500, 1000]);
    expect(applied).toHaveLength(1200);
    expect(await cursor.get()).toBe(1200);
  });

  test('passes_the_limit_through', async () => {
    const { api, requests } = fakeServer(5);
    await pullAll({ api, cursor: createCursorStore(new MemoryStorage()), apply: applier().apply, limit: 2 });

    expect(requests).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  test('cursor_is_saved_after_each_page_and_after_apply', async () => {
    const log: string[] = [];
    const { api } = fakeServer(700);
    const cursor = loggedCursor(createCursorStore(new MemoryStorage()), log);

    await pullAll({ api, cursor, apply: applier(log).apply });

    expect(log).toEqual(['apply:500', 'set:500', 'apply:200', 'set:700']);
  });

  test('apply_failure_does_not_advance_the_cursor', async () => {
    const { api } = fakeServer(700);
    const cursor = createCursorStore(new MemoryStorage());

    await expect(pullAll({ api, cursor, apply: applier([], 2).apply })).rejects.toThrow('apply failed');

    expect(await cursor.get()).toBe(500);
  });

  test('crash_after_page_one_resumes_from_the_saved_cursor', async () => {
    const storage = new MemoryStorage();
    const { api, requests } = fakeServer(1200);
    await pullAll({ api, cursor: createCursorStore(storage), apply: applier([], 2).apply }).catch(() => {});
    requests.length = 0;

    const again = applier();
    const result = await pullAll({ api, cursor: createCursorStore(storage), apply: again.apply });

    expect(requests.map(([c]) => c)).toEqual([500, 1000]);
    expect(again.applied.map((c) => c.row.id)).toEqual(Array.from({ length: 700 }, (_, i) => `d${i + 500}`));
    expect(result).toMatchObject({ pages: 2, changes: 700 });
    expect(await createCursorStore(storage).get()).toBe(1200);
  });

  test('empty_pull_applies_nothing', async () => {
    const log: string[] = [];
    const { api, requests } = fakeServer(0);
    const cursor = loggedCursor(createCursorStore(new MemoryStorage()), log);

    const result = await pullAll({ api, cursor, apply: applier(log).apply });

    expect(result).toEqual({ pages: 1, changes: 0, serverTime: T });
    expect(requests).toHaveLength(1);
    expect(log).toEqual([]);
  });

  test('stalled_cursor_throws_instead_of_looping', async () => {
    let requests = 0;
    const api: SyncApi = {
      push: () => Promise.reject(new Error('not used')),
      pull: async (cursor) => {
        if (++requests > 3) throw new Error('looped');
        return { changes: [], cursor, hasMore: true, serverTime: T };
      },
    };

    await expect(pullAll({ api, cursor: createCursorStore(new MemoryStorage()), apply: applier().apply })).rejects.toThrow(
      /did not advance/,
    );
    expect(requests).toBe(1);
  });
});
