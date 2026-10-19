import { TABLES } from '../engine/state';
import type { Change, TableName } from '../engine/types';

/** No answer came back: offline, a dropped connection, or no response within the timeout. Retrying may help. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** There is no session the server accepts. Only signing in again fixes it. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** The server answered, but with an error status or a body this app can't read. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface TokenSource {
  /** The current access token. Throws AuthError with no session, NetworkError when a refresh it needed failed retryably. */
  getToken(): Promise<string>;
  /** A fresh token, for when the server turned the current one down. Throws as getToken does. */
  refreshToken(): Promise<string>;
}

/** One outbox row to push; `id` is the OutboxEntry id the server acks. */
export interface PushEntry {
  id: string;
  table: TableName;
  row: Change['row'];
}

export interface PushResult {
  acked: string[];
  rejected: { id: string; reason: string }[];
  serverTime: string;
}

export interface PullPage {
  changes: Change[];
  cursor: number;
  hasMore: boolean;
  serverTime: string;
}

export interface SyncApi {
  push(entries: PushEntry[]): Promise<PushResult>;
  pull(cursor: number, limit?: number): Promise<PullPage>;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_PULL_LIMIT = 500;

// Android/iOS have no origin to be relative to, so they need an absolute API
// origin. Web is served same-origin with the API (see /vercel.json), so it
// can stay on a relative path — unless EXPO_PUBLIC_API_URL is set, which lets
// local web dev point at a standalone `uvicorn` instead of a dev-server proxy
// Metro doesn't provide.
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ? `${process.env.EXPO_PUBLIC_API_URL}/api` : '/api';

const KNOWN_TABLES = new Set<string>(TABLES);

interface Reply {
  status: number;
  ok: boolean;
  text: string;
}

/**
 * The sync endpoints with the session's bearer token. A 401 gets one token refresh and one retry; a second
 * 401 is an AuthError. Each attempt (headers and body) must finish within `timeoutMs` or it is aborted as a
 * NetworkError, since a request on a dead connection can otherwise hang for minutes.
 */
export function createSyncApi(deps: {
  baseUrl: string;
  tokens: TokenSource;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): SyncApi {
  // Looked up per call rather than captured, so a fetch polyfilled after this module loads is the one used.
  const send = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function attempt(url: string, method: string, body: string | undefined, token: string): Promise<Reply> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new NetworkError(`No response from the server within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
    const exchange = (async (): Promise<Reply> => {
      try {
        const res = await send(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body,
          signal: controller.signal,
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      } catch (err: unknown) {
        throw new NetworkError(`Could not reach the server: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    try {
      return await Promise.race([exchange, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = deps.baseUrl + path;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let reply = await attempt(url, method, payload, await deps.tokens.getToken());
    if (reply.status === 401) {
      reply = await attempt(url, method, payload, await deps.tokens.refreshToken());
      if (reply.status === 401) throw new AuthError('The server did not accept the session');
    }
    const parsed = parseJson(reply.text);
    if (!reply.ok) throw new HttpError(reply.status, serverMessage(parsed) ?? `Request failed with status ${reply.status}`);
    if (parsed === null || typeof parsed !== 'object') {
      throw new HttpError(reply.status, 'The server sent a response this app cannot read');
    }
    return parsed as T;
  }

  return {
    push: (entries) => request<PushResult>('/sync/push', 'POST', { entries }),
    async pull(cursor, limit = DEFAULT_PULL_LIMIT) {
      const page = await request<PullPage>(`/sync/pull?cursor=${cursor}&limit=${limit}`, 'GET');
      // A table added by a newer app version would break the merge here; this version has nowhere to put it.
      return { ...page, changes: page.changes.filter((c) => KNOWN_TABLES.has(c.table)) };
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `error` is what the API's own handlers send; `detail` is FastAPI's shape for the 401s it raises. */
function serverMessage(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const { error, detail } = body as { error?: unknown; detail?: unknown };
  if (typeof error === 'string') return error;
  if (typeof detail === 'string') return detail;
  return null;
}
