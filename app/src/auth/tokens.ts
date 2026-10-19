import { AuthError, NetworkError, type TokenSource } from '../sync/api';

type SessionReply = Promise<{
  data: { session: { access_token: string } | null };
  error: { name: string; message?: string } | null;
}>;

/** The slice of `supabase.auth` the token source uses. */
export interface AuthLike {
  getSession(): SessionReply;
  refreshSession(): SessionReply;
}

/** supabase-js names the error it gives when a request to the auth server never got an answer. */
const RETRYABLE = 'AuthRetryableFetchError';

async function tokenFrom(call: () => SessionReply, what: string): Promise<string> {
  let reply: Awaited<SessionReply>;
  try {
    reply = await call();
  } catch (err) {
    throw new NetworkError(`Could not reach the sign-in server: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { data, error } = reply;
  if (error) {
    const detail = error.message || error.name;
    if (error.name === RETRYABLE) throw new NetworkError(`Could not reach the sign-in server: ${detail}`);
    throw new AuthError(`${what}: ${detail}`);
  }
  if (!data.session) throw new AuthError('Not signed in');
  return data.session.access_token;
}

/**
 * Tokens for the sync API. A refresh that failed for want of a network is a NetworkError, so the phone shows
 * offline and keeps its session; only an answer from the auth server that the session is gone is an AuthError.
 */
export function createTokenSource(auth: AuthLike): TokenSource {
  return {
    getToken: () => tokenFrom(() => auth.getSession(), 'The session could not be read'),
    refreshToken: () => tokenFrom(() => auth.refreshSession(), 'The session could not be refreshed'),
  };
}
