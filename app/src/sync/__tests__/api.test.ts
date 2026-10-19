import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Change } from '../../engine/types';
import { AuthError, createSyncApi, HttpError, NetworkError, type PushEntry, type TokenSource } from '../api';

const BASE = 'http://localhost:8000/api';
const T = '2026-10-19T12:00:00.000Z';

const DAY: Change = {
  table: 'days',
  row: { id: 'd1', date: '2026-10-19', updatedAt: T, deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true },
};

type Reply = Response | Error | 'hang';

/** A fetch that answers with `replies` in order and records every request. 'hang' never settles, even when aborted. */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (next === undefined) throw new Error('fakeFetch: no reply left');
    if (next === 'hang') return new Promise<Response>(() => {});
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const page = (over: object = {}) => json(200, { changes: [], cursor: 0, hasMore: false, serverTime: T, ...over });

/** Hands out tok-1; each refresh hands out the next one. */
function tokens(over: Partial<TokenSource> = {}) {
  let n = 1;
  const source = {
    refreshed: 0,
    getToken: async () => `tok-${n}`,
    refreshToken: async () => {
      source.refreshed++;
      return `tok-${++n}`;
    },
    ...over,
  };
  return source;
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

afterEach(() => vi.useRealTimers());

describe('createSyncApi', () => {
  test('push_posts_entries_with_bearer_token', async () => {
    const { fn, calls } = fakeFetch(json(200, { acked: ['e1'], rejected: [], serverTime: T }));
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });
    const entries: PushEntry[] = [{ id: 'e1', table: DAY.table, row: DAY.row }];

    await expect(api.push(entries)).resolves.toEqual({ acked: ['e1'], rejected: [], serverTime: T });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/sync/push`);
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0].init, 'Authorization')).toBe('Bearer tok-1');
    expect(header(calls[0].init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ entries });
  });

  test('pull_builds_cursor_and_limit_query', async () => {
    const { fn, calls } = fakeFetch(page({ changes: [DAY], cursor: 7 }), page({ cursor: 42 }));
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });

    await expect(api.pull(0)).resolves.toEqual({ changes: [DAY], cursor: 7, hasMore: false, serverTime: T });
    await api.pull(42, 1000);

    expect(calls.map((c) => c.url)).toEqual([`${BASE}/sync/pull?cursor=0&limit=500`, `${BASE}/sync/pull?cursor=42&limit=1000`]);
    expect(calls[0].init.method).toBe('GET');
    expect(header(calls[0].init, 'Authorization')).toBe('Bearer tok-1');
  });

  test('pull_skips_changes_for_tables_this_app_does_not_know', async () => {
    const future = { table: 'supersets', row: { id: 'x1', updatedAt: T, deletedAt: null } };
    const { fn } = fakeFetch(page({ changes: [future, DAY], cursor: 2 }));
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });

    await expect(api.pull(0)).resolves.toMatchObject({ changes: [DAY], cursor: 2 });
  });

  test('401_refreshes_the_token_once_and_retries', async () => {
    const t = tokens();
    const { fn, calls } = fakeFetch(json(401, { detail: 'Token expired' }), page({ cursor: 3 }));
    const api = createSyncApi({ baseUrl: BASE, tokens: t, fetch: fn });

    await expect(api.pull(0)).resolves.toMatchObject({ cursor: 3 });

    expect(t.refreshed).toBe(1);
    expect(calls.map((c) => header(c.init, 'Authorization'))).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  test('second_401_throws_AuthError', async () => {
    const t = tokens();
    const { fn, calls } = fakeFetch(json(401, { detail: 'Token expired' }), json(401, { detail: 'Invalid token' }));
    const api = createSyncApi({ baseUrl: BASE, tokens: t, fetch: fn });

    await expect(api.pull(0)).rejects.toBeInstanceOf(AuthError);

    expect(calls).toHaveLength(2);
    expect(t.refreshed).toBe(1);
  });

  test('fetch_rejection_throws_NetworkError', async () => {
    const { fn } = fakeFetch(new TypeError('Network request failed'));
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });

    await expect(api.pull(0)).rejects.toBeInstanceOf(NetworkError);
  });

  test('request_that_never_resolves_times_out_as_NetworkError', async () => {
    vi.useFakeTimers();
    const { fn, calls } = fakeFetch('hang');
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });
    const settled = vi.fn();

    const pending = api.pull(0);
    pending.then(settled, settled);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).rejects.toBeInstanceOf(NetworkError);
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  test('5xx_throws_HttpError_with_status', async () => {
    const { fn } = fakeFetch(
      json(500, { error: 'Internal server error' }),
      new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });

    await expect(api.pull(0)).rejects.toMatchObject({ name: 'HttpError', status: 500, message: 'Internal server error' });
    const err = await api.pull(0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 502, message: 'Request failed with status 502' });
  });

  test('4xx_keeps_the_server_error_message', async () => {
    const { fn } = fakeFetch(json(413, { error: 'A push carries at most 200 entries', details: null }));
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });

    const err = await api.push([]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 413, message: 'A push carries at most 200 entries' });
  });

  test('unreadable_2xx_body_throws_HttpError', async () => {
    // What a misrouted /api request gets back from the website's catch-all rewrite.
    const { fn } = fakeFetch(new Response('<!DOCTYPE html><title>Gym Tracker</title>', { status: 200 }));
    const api = createSyncApi({ baseUrl: BASE, tokens: tokens(), fetch: fn });

    await expect(api.pull(0)).rejects.toMatchObject({ name: 'HttpError', status: 200 });
  });

  test('token_source_NetworkError_propagates', async () => {
    const offline = fakeFetch();
    const api = createSyncApi({
      baseUrl: BASE,
      tokens: tokens({ getToken: () => Promise.reject(new NetworkError('Refresh failed')) }),
      fetch: offline.fn,
    });
    await expect(api.pull(0)).rejects.toBeInstanceOf(NetworkError);
    expect(offline.calls).toHaveLength(0);

    const signedOut = createSyncApi({
      baseUrl: BASE,
      tokens: tokens({ getToken: () => Promise.reject(new AuthError('No session')) }),
      fetch: offline.fn,
    });
    await expect(signedOut.push([])).rejects.toBeInstanceOf(AuthError);
    expect(offline.calls).toHaveLength(0);
  });
});
