import { describe, expect, test, vi } from 'vitest';
import { LocalStore } from '../../data/LocalStore';
import { MemoryStorage } from '../../data/storage';
import type { Change } from '../../engine/types';
import {
  AuthError,
  createSyncApi,
  HttpError,
  NetworkError,
  type PullPage,
  type PushEntry,
  type PushResult,
  type SyncApi,
  type TokenSource,
} from '../api';
import { createCursorStore } from '../cursor';
import { nextRetryDelayMs, SyncEngine } from '../SyncEngine';

const NOW = Date.UTC(2026, 9, 19, 12);
const iso = (ms: number) => new Date(ms).toISOString();

const set = (id: string, reps: number, updatedAt = iso(NOW)): Change => ({
  table: 'sets',
  row: { id, updatedAt, deletedAt: null, dayExerciseId: 'x1', setNumber: 1, reps, weightKg: 60 },
});

const day = (id: string): Change => ({
  table: 'days',
  row: { id, date: '2026-10-19', updatedAt: iso(NOW), deletedAt: null, status: null, shiftId: null, routineId: null, title: 'Chest', hasLog: true },
});

interface Hold {
  arrive(): void;
  gate: Promise<void>;
}

/** The API's push/pull rules in memory: rows keyed (table, id), last-write-wins, a server-assigned seq as the cursor. */
class FakeServer implements SyncApi {
  rows = new Map<string, { change: Change; seq: number }>();
  calls: ('pull' | 'push')[] = [];
  pushes: PushEntry[][] = [];
  time = NOW;
  reject: (e: PushEntry) => string | null = () => null;
  /** Drops this entry id from the response, as a buggy server might. */
  forget: string | null = null;
  failNext: { pull?: Error; push?: { error: Error; afterCommit: boolean } } = {};
  private holds: Record<'pull' | 'push', Hold[]> = { pull: [], push: [] };
  private seq = 0;

  seed(...changes: Change[]): void {
    for (const change of changes) this.rows.set(`${change.table}:${change.row.id}`, { change, seq: ++this.seq });
  }

  /** The next request of this kind waits for `release()`; `reached` resolves once it is in. */
  hold(kind: 'pull' | 'push') {
    let arrive!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((r) => (arrive = r));
    const gate = new Promise<void>((r) => (release = r));
    this.holds[kind].push({ arrive, gate });
    return { reached, release };
  }

  async pull(cursor: number, limit = 500): Promise<PullPage> {
    this.calls.push('pull');
    await this.wait('pull');
    const error = this.failNext.pull;
    this.failNext.pull = undefined;
    if (error) throw error;
    const after = [...this.rows.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
    const page = after.slice(0, limit);
    return {
      changes: page.map((r) => r.change),
      cursor: page.length > 0 ? page[page.length - 1].seq : cursor,
      hasMore: after.length > limit,
      serverTime: iso(this.time),
    };
  }

  async push(entries: PushEntry[]): Promise<PushResult> {
    this.calls.push('push');
    this.pushes.push(entries);
    await this.wait('push');
    const fail = this.failNext.push;
    this.failNext.push = undefined;
    if (fail && !fail.afterCommit) throw fail.error;
    const acked: string[] = [];
    const rejected: { id: string; reason: string }[] = [];
    for (const e of entries) {
      const reason = this.reject(e);
      if (reason) {
        rejected.push({ id: e.id, reason });
        continue;
      }
      const key = `${e.table}:${e.row.id}`;
      const current = this.rows.get(key);
      if (!current || current.change.row.updatedAt < e.row.updatedAt) {
        this.rows.set(key, { change: { table: e.table, row: e.row } as Change, seq: ++this.seq });
      }
      if (e.id !== this.forget) acked.push(e.id);
    }
    if (fail) throw fail.error;
    return { acked, rejected, serverTime: iso(this.time) };
  }

  private async wait(kind: 'pull' | 'push'): Promise<void> {
    const hold = this.holds[kind].shift();
    if (!hold) return;
    hold.arrive();
    await hold.gate;
  }
}

/** Serves the fake server over HTTP, for tests that go through createSyncApi. */
function fetchFor(server: FakeServer): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  return (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/sync/pull')) {
      return json(await server.pull(Number(u.searchParams.get('cursor')), Number(u.searchParams.get('limit'))));
    }
    return json(await server.push((JSON.parse(init.body as string) as { entries: PushEntry[] }).entries));
  }) as unknown as typeof fetch;
}

async function setup(api?: (server: FakeServer) => SyncApi) {
  const storage = new MemoryStorage();
  let n = 0;
  const local = new LocalStore(storage, { newId: () => `ob-${++n}`, now: () => iso(NOW) });
  await local.load();
  const server = new FakeServer();
  const applied: Change[] = [];
  const clock = { ms: NOW };
  const engine = new SyncEngine({
    outbox: local,
    api: api ? api(server) : server,
    cursor: createCursorStore(storage),
    apply: async (changes) => {
      applied.push(...changes);
      await local.applyRemote(changes);
    },
    now: () => clock.ms,
  });
  return { storage, local, server, engine, applied, clock };
}

describe('SyncEngine', () => {
  test('push_sends_the_outbox_in_batches_of_200_then_acks', async () => {
    const { local, server, engine } = await setup();
    await local.commit(Array.from({ length: 450 }, (_, i) => set(`s${i}`, 1)));

    await engine.syncOnce();

    expect(server.pushes.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(await local.count()).toBe(0);
    expect(server.rows.size).toBe(450);
    expect(engine.getStatus()).toEqual({ phase: 'idle', pending: 0, lastSyncedAt: iso(NOW), lastError: null });
  });

  test('coalesced_edits_send_one_row_but_ack_every_entry', async () => {
    const { local, server, engine } = await setup();
    for (let i = 1; i <= 10; i++) await local.commit([set('s1', i, iso(NOW + i))]);

    await engine.syncOnce();

    expect(server.pushes).toHaveLength(1);
    expect(server.pushes[0]).toHaveLength(1);
    expect(server.pushes[0][0].row).toMatchObject({ id: 's1', reps: 10 });
    expect(await local.count()).toBe(0);
  });

  test('cycle_order_is_pull_push_pull_and_skips_the_second_pull_when_nothing_was_pushed', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1)]);

    await engine.syncOnce();
    expect(server.calls).toEqual(['pull', 'push', 'pull']);

    server.calls.length = 0;
    await engine.syncOnce();
    expect(server.calls).toEqual(['pull']);
  });

  test('rejected_entries_are_acked_reported_and_do_not_block_the_rest', async () => {
    const { local, server, engine } = await setup();
    server.reject = (e) => (e.row.id === 's2' ? 'reps must be at most 999' : null);
    await local.commit([set('s1', 1), set('s2', 1000), set('s3', 1)]);

    await engine.syncOnce();

    expect(await local.count()).toBe(0);
    expect([...server.rows.keys()].sort()).toEqual(['sets:s1', 'sets:s3']);
    expect(engine.getStatus().phase).toBe('idle');
    expect(engine.getStatus().lastError).toContain('reps must be at most 999');
  });

  test('entries_the_server_did_not_confirm_stay_in_the_outbox', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1), set('s2', 1)]);
    server.forget = 'ob-2';

    await engine.syncOnce();

    expect((await local.peek(10)).map((e) => e.id)).toEqual(['ob-2']);
    expect(engine.getStatus().phase).toBe('error');
    expect(server.pushes).toHaveLength(1);
  });

  test('timeout_after_server_commit_retries_same_entries_and_acks', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1), set('s2', 1), set('s3', 1)]);
    server.failNext.push = { error: new NetworkError('No response from the server within 20s'), afterCommit: true };

    await engine.syncOnce();
    expect(await local.count()).toBe(3);
    expect(engine.getStatus().phase).toBe('offline');

    await engine.syncOnce();
    expect(server.pushes).toHaveLength(2);
    expect(server.pushes[1].map((e) => e.id)).toEqual(server.pushes[0].map((e) => e.id));
    expect(await local.count()).toBe(0);
    expect(server.rows.size).toBe(3);
    expect(engine.getStatus().phase).toBe('idle');
  });

  test('network_error_keeps_the_outbox_and_sets_offline', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1)]);
    server.failNext.pull = new NetworkError('Could not reach the server: Network request failed');

    await engine.syncOnce();

    expect(server.calls).toEqual(['pull']);
    expect(await local.count()).toBe(1);
    expect(engine.getStatus()).toMatchObject({
      phase: 'offline',
      pending: 1,
      lastSyncedAt: null,
      lastError: 'Could not reach the server: Network request failed',
    });
  });

  test('server_500_sets_error_and_keeps_the_outbox', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1)]);
    server.failNext.push = { error: new HttpError(500, 'Internal server error'), afterCommit: false };

    await engine.syncOnce();

    expect(await local.count()).toBe(1);
    expect(engine.getStatus()).toMatchObject({ phase: 'error', lastError: 'Internal server error' });
  });

  test('nextRetryDelayMs', () => {
    expect([0, 1, 2, 5, 6, 20].map(nextRetryDelayMs)).toEqual([0, 2000, 4000, 32000, 60000, 60000]);
  });

  test('auth_error_sets_auth_required_and_resume_syncs_again', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1)]);
    server.failNext.pull = new AuthError('The server did not accept the session');

    await engine.syncOnce();
    expect(engine.getStatus().phase).toBe('auth_required');
    expect(await local.count()).toBe(1);

    server.calls.length = 0;
    await engine.syncOnce();
    expect(server.calls).toEqual([]);
    expect(engine.getStatus().phase).toBe('auth_required');

    engine.resume();
    await vi.waitFor(() => expect(engine.getStatus().phase).toBe('idle'));
    expect(server.calls).toEqual(['pull', 'push', 'pull']);
    expect(await local.count()).toBe(0);
  });

  test('sign_in_during_a_cycle_that_hits_auth_error_still_syncs', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1)]);
    server.failNext.pull = new AuthError('The server did not accept the session');
    const held = server.hold('pull');
    const cycle = engine.syncOnce();
    await held.reached;

    engine.resume();
    held.release();
    await cycle;
    await vi.waitFor(() => expect(engine.getStatus().phase).toBe('idle'));

    expect(await local.count()).toBe(0);
  });

  test('expired_session_offline_is_offline_not_auth_required', async () => {
    let online = false;
    const tokens: TokenSource = {
      getToken: async () => {
        if (!online) throw new NetworkError('Could not refresh the session');
        return 'tok';
      },
      refreshToken: async () => 'tok',
    };
    const { local, engine } = await setup((server) =>
      createSyncApi({ baseUrl: 'http://localhost:8000/api', tokens, fetch: fetchFor(server) }),
    );
    await local.commit([set('s1', 1)]);

    await engine.syncOnce();
    expect(engine.getStatus().phase).toBe('offline');
    expect(await local.count()).toBe(1);

    online = true;
    await engine.syncOnce();
    expect(engine.getStatus().phase).toBe('idle');
    expect(await local.count()).toBe(0);
  });

  test('clock_skew_pauses_push_but_still_pulls', async () => {
    const { local, server, engine, applied, clock } = await setup();
    server.seed(day('d1'));
    await local.commit([set('s1', 1)]);
    server.time = NOW + 20 * 60_000;

    await engine.syncOnce();

    expect(engine.getStatus().phase).toBe('clock_skew');
    expect(server.calls).toEqual(['pull']);
    expect(applied.map((c) => c.row.id)).toEqual(['d1']);
    expect(await local.count()).toBe(1);

    clock.ms = server.time;
    await engine.syncOnce();

    expect(server.calls).toEqual(['pull', 'pull', 'push', 'pull']);
    expect(await local.count()).toBe(0);
    expect(engine.getStatus().phase).toBe('idle');
  });

  test('edit_made_during_a_push_survives_the_ack', async () => {
    const { local, server, engine } = await setup();
    await local.commit([set('s1', 1), set('s2', 1)]);
    const first = server.hold('push');
    const cycle = engine.syncOnce();
    await first.reached;

    await local.commit([set('s3', 1)]);
    const second = server.hold('push');
    first.release();
    await second.reached;
    expect((await local.peek(10)).map((e) => e.rowId)).toEqual(['s3']);

    second.release();
    await cycle;
    expect(server.pushes.map((p) => p.map((e) => e.row.id))).toEqual([['s1', 's2'], ['s3']]);
    expect(await local.count()).toBe(0);
  });

  test('overlapping_syncOnce_calls_run_one_follow_up_cycle', async () => {
    const { server, engine } = await setup();
    const held = server.hold('pull');
    const a = engine.syncOnce();
    await held.reached;
    expect(engine.getStatus().phase).toBe('syncing');

    const b = engine.syncOnce();
    const c = engine.syncOnce();
    held.release();
    await Promise.all([a, b, c]);

    expect(server.calls).toEqual(['pull', 'pull']);
    expect(engine.getStatus().phase).toBe('idle');
  });

  test('status_pending_follows_outbox_subscription', async () => {
    const { local, engine } = await setup();
    const seen: number[] = [];
    const unsubscribe = engine.subscribe(() => seen.push(engine.getStatus().pending));

    await local.commit([set('s1', 1)]);
    await local.commit([set('s2', 1)]);
    await vi.waitFor(() => expect(engine.getStatus().pending).toBe(2));
    await engine.syncOnce();

    expect(engine.getStatus().pending).toBe(0);
    expect(seen).toContain(1);
    expect(seen).toContain(2);
    expect(seen[seen.length - 1]).toBe(0);

    unsubscribe();
    const before = seen.length;
    await local.commit([set('s3', 1)]);
    await vi.waitFor(() => expect(engine.getStatus().pending).toBe(1));
    expect(seen).toHaveLength(before);
  });
});
