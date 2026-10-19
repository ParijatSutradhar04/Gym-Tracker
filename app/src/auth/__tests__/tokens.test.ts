import { describe, expect, test } from 'vitest';
import { AuthError, NetworkError } from '../../sync/api';
import { createTokenSource, type AuthLike } from '../tokens';

type Reply = Awaited<ReturnType<AuthLike['getSession']>>;

const session = (token: string): Reply => ({ data: { session: { access_token: token } }, error: null });
const failed = (name: string, message = 'failed'): Reply => ({ data: { session: null }, error: { name, message } });
const none: Reply = { data: { session: null }, error: null };

function fakeAuth(over: { getSession?: () => Promise<Reply>; refreshSession?: () => Promise<Reply> }): AuthLike {
  return {
    getSession: over.getSession ?? (async () => none),
    refreshSession: over.refreshSession ?? (async () => none),
  };
}

describe('createTokenSource', () => {
  test('getToken_returns_the_access_token', async () => {
    const tokens = createTokenSource(fakeAuth({ getSession: async () => session('tok-1') }));
    expect(await tokens.getToken()).toBe('tok-1');
  });

  test('getToken_without_a_session_throws_AuthError', async () => {
    const tokens = createTokenSource(fakeAuth({ getSession: async () => none }));
    await expect(tokens.getToken()).rejects.toBeInstanceOf(AuthError);
  });

  test('getToken_when_refresh_failed_retryably_throws_NetworkError', async () => {
    const tokens = createTokenSource(
      fakeAuth({ getSession: async () => failed('AuthRetryableFetchError', 'Failed to fetch') }),
    );
    const err = await tokens.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain('Failed to fetch');
  });

  test('getToken_when_the_auth_call_itself_throws_is_a_NetworkError', async () => {
    const tokens = createTokenSource(
      fakeAuth({
        getSession: async () => {
          throw new TypeError('Network request failed');
        },
      }),
    );
    await expect(tokens.getToken()).rejects.toBeInstanceOf(NetworkError);
  });

  test('refreshToken_returns_the_new_token', async () => {
    const tokens = createTokenSource(fakeAuth({ refreshSession: async () => session('tok-2') }));
    expect(await tokens.refreshToken()).toBe('tok-2');
  });

  test('refreshToken_with_invalid_refresh_token_throws_AuthError', async () => {
    const tokens = createTokenSource(
      fakeAuth({ refreshSession: async () => failed('AuthApiError', 'Invalid Refresh Token: Refresh Token Not Found') }),
    );
    await expect(tokens.refreshToken()).rejects.toBeInstanceOf(AuthError);
  });

  test('refreshToken_offline_throws_NetworkError', async () => {
    const tokens = createTokenSource(fakeAuth({ refreshSession: async () => failed('AuthRetryableFetchError') }));
    await expect(tokens.refreshToken()).rejects.toBeInstanceOf(NetworkError);
  });
});
