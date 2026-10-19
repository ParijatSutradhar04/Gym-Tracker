import { describe, expect, test } from 'vitest';
import type { Change } from '../../engine/types';
import { AuthError, createSyncApi, HttpError, NetworkError, type PullPage, type PushEntry, type PushResult, type SyncApi } from '../../sync/api';
import { RemoteStore } from '../RemoteStore';

const T = '2026-10-19T12:00:00.000Z';

const day = (i: number, updatedAt = T): Change => ({
  table: 'days',
  row: { id: `d${i}`, date: '2026-10-19', updatedAt, deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true },
});

/**
 * A server holding `rows` at seq 1…n that acks every push. `pushFails` lists errors the next pushes throw, in
 * order; `reject` turns down entries for these row ids.
 */
function fakeApi(rows: Change[] = []) {
  const pulls: [number, number | undefined][] = [];
  const pushes: PushEntry[][] = [];
  const pushFails: Error[] = [];
  const reject = new Set<string>();
  const api: SyncApi = {
    async pull(cursor, limit): Promise<PullPage> {
      pulls.push([cursor, limit]);
      const changes = rows.slice(cursor, cursor + (limit ?? 500));
      return { changes, cursor: cursor + changes.length, hasMore: cursor + changes.length < rows.length, serverTime: T };
    },
    async push(entries): Promise<PushResult> {
      pushes.push(entries);
      const fail = pushFails.shift();
      if (fail) throw fail;
      const rejected = entries.filter((e) => reject.has(e.row.id)).map((e) => ({ id: e.id, reason: 'reps must be at most 999' }));
      const acked = entries.filter((e) => !reject.has(e.row.id)).map((e) => e.id);
      return { acked, rejected, serverTime: T };
    },
  };
  return { api, rows, pulls, pushes, pushFails, reject };
}

function setup(server = fakeApi()) {
  let n = 0;
  const slept: number[] = [];
  const store = new RemoteStore(server.api, {
    newId: () => `e${++n}`,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { ...server, store, slept };
}

describe('RemoteStore', () => {
  test('load_pages_until_hasMore_false_and_builds_the_state', async () => {
    const { store, pulls } = setup(fakeApi(Array.from({ length: 1200 }, (_, i) => day(i))));
    const state = await store.load();
    expect(pulls).toEqual([
      [0, 500],
      [500, 500],
      [1000, 500],
    ]);
    expect(state.days.size).toBe(1200);
    expect(state.days.get('d1199')?.title).toBe('Chest');
    expect(state.sets.size).toBe(0);
  });

  test('load_rejects_with_NetworkError_when_offline', async () => {
    const server = fakeApi([day(1)]);
    server.api.pull = () => Promise.reject(new NetworkError('Could not reach the server: offline'));
    const { store } = setup(server);
    await expect(store.load()).rejects.toBeInstanceOf(NetworkError);
  });

  test('load_starts_from_cursor_0_every_time', async () => {
    const { store, rows, pulls } = setup(fakeApi([day(1), day(2)]));
    await store.load();
    rows.push(day(3));
    const state = await store.load();
    expect(pulls.map(([cursor]) => cursor)).toEqual([0, 0]);
    expect(state.days.size).toBe(3);
  });

  test('commit_pushes_changes_as_entries_with_fresh_ids', async () => {
    const { store, pushes } = setup();
    await store.commit([day(1), day(2)]);
    await store.commit([day(1, '2026-10-19T12:00:01.000Z')]);
    expect(pushes).toEqual([
      [
        { id: 'e1', table: 'days', row: day(1).row },
        { id: 'e2', table: 'days', row: day(2).row },
      ],
      [{ id: 'e3', table: 'days', row: day(1, '2026-10-19T12:00:01.000Z').row }],
    ]);
  });

  test('commit_splits_more_than_200_changes_into_pushes_of_200', async () => {
    const { store, pushes } = setup();
    await store.commit(Array.from({ length: 450 }, (_, i) => day(i)));
    expect(pushes.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(pushes[2][49].row.id).toBe('d449');
  });

  test('commit_retries_network_errors_with_1_2_4s_backoff_then_succeeds', async () => {
    const { store, pushes, pushFails, slept } = setup();
    pushFails.push(new NetworkError('offline'), new NetworkError('offline'));
    await store.commit([day(1)]);
    expect(slept).toEqual([1000, 2000]);
    expect(pushes).toHaveLength(3);
    // A retry sends the same entries, so the server can recognise them.
    expect(pushes[2]).toEqual(pushes[0]);
  });

  test('commit_retries_5xx_but_not_4xx', async () => {
    const { store, pushes, pushFails, slept } = setup();
    pushFails.push(new HttpError(503, 'Service unavailable'));
    await store.commit([day(1)]);
    expect(slept).toEqual([1000]);

    pushFails.push(new HttpError(413, 'Too many changes'));
    await expect(store.commit([day(2)])).rejects.toThrow('Too many changes');
    expect(slept).toEqual([1000]);
    expect(pushes).toHaveLength(3);
  });

  test('commit_gives_up_after_5_attempts_and_throws', async () => {
    const { store, pushes, pushFails, slept } = setup();
    for (let i = 0; i < 10; i++) pushFails.push(new NetworkError(`offline ${i}`));
    await expect(store.commit([day(1)])).rejects.toThrow('offline 5');
    expect(slept).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(pushes).toHaveLength(6);
  });

  test('commit_throws_when_the_server_rejects_an_entry', async () => {
    const { store, reject } = setup();
    reject.add('d2');
    await expect(store.commit([day(1), day(2)])).rejects.toThrow('reps must be at most 999');
  });

  test('commit_throws_when_the_server_leaves_an_entry_unanswered', async () => {
    const server = fakeApi();
    server.api.push = async (entries) => ({ acked: entries.slice(1).map((e) => e.id), rejected: [], serverTime: T });
    const { store } = setup(server);
    await expect(store.commit([day(1), day(2)])).rejects.toThrow('The server did not confirm 1 of 2 changes');
  });

  test('commit_401_surfaces_AuthError', async () => {
    let requests = 0;
    const api = createSyncApi({
      baseUrl: '/api',
      tokens: { getToken: async () => 'old', refreshToken: async () => 'new' },
      fetch: (async () => {
        requests++;
        return new Response(JSON.stringify({ detail: 'Invalid token' }), { status: 401 });
      }) as typeof fetch,
    });
    const slept: number[] = [];
    const store = new RemoteStore(api, { newId: () => 'e1', sleep: async (ms) => void slept.push(ms) });
    await expect(store.commit([day(1)])).rejects.toBeInstanceOf(AuthError);
    // One refresh and one retry inside the API; RemoteStore itself does not retry.
    expect(requests).toBe(2);
    expect(slept).toEqual([]);
  });

  test('pullDelta_returns_changes_since_the_cursor_and_advances_it', async () => {
    const { store, rows, pulls } = setup(fakeApi([day(1), day(2)]));
    await store.load();
    rows.push(day(3), day(4));
    expect(await store.pullDelta()).toEqual([day(3), day(4)]);
    expect(await store.pullDelta()).toEqual([]);
    expect(pulls.map(([cursor]) => cursor)).toEqual([0, 2, 4]);
  });

  test('pullDelta_pages_until_hasMore_false', async () => {
    const { store, rows } = setup(fakeApi());
    await store.load();
    rows.push(...Array.from({ length: 700 }, (_, i) => day(i)));
    expect(await store.pullDelta()).toHaveLength(700);
  });

  test('applyRemote_is_a_noop', async () => {
    const { store, pulls, pushes } = setup();
    await store.applyRemote([day(1)]);
    expect(pulls).toEqual([]);
    expect(pushes).toEqual([]);
  });
});
