import { describe, expect, test } from 'vitest';
import { applyChanges, emptyState } from '../../engine/state';
import { AUTH_STORAGE_KEY, hasLocalData, readStoredSession, resolveGate } from '../gate';

describe('resolveGate', () => {
  test.each([
    ['native', true, true, 'app'],
    ['native', true, false, 'app'],
    ['native', false, true, 'app_signin_prompt'],
    ['native', false, false, 'login'],
    ['web', true, true, 'app'],
    ['web', true, false, 'app'],
    ['web', false, true, 'login'],
    ['web', false, false, 'login'],
  ] as const)('%s stored=%s localData=%s gives %s', (platform, hasStoredSession, localData, expected) => {
    expect(resolveGate({ platform, hasStoredSession, hasLocalData: localData })).toBe(expected);
  });

  test('expired_stored_session_still_opens_the_app', () => {
    // An expired access token is still a stored session: the gate never asks the network.
    expect(resolveGate({ platform: 'native', hasStoredSession: true, hasLocalData: true })).toBe('app');
    expect(resolveGate({ platform: 'web', hasStoredSession: true, hasLocalData: false })).toBe('app');
  });

  test('fresh_native_install_shows_login', () => {
    expect(resolveGate({ platform: 'native', hasStoredSession: false, hasLocalData: false })).toBe('login');
  });

  test('native_with_local_data_but_no_session_shows_signin_prompt_not_login', () => {
    expect(resolveGate({ platform: 'native', hasStoredSession: false, hasLocalData: true })).toBe('app_signin_prompt');
  });

  test('web_without_session_shows_login', () => {
    expect(resolveGate({ platform: 'web', hasStoredSession: false, hasLocalData: false })).toBe('login');
  });
});

describe('readStoredSession', () => {
  const storage = (values: Record<string, string>) => ({
    asked: [] as string[],
    async getItem(key: string) {
      this.asked.push(key);
      return values[key] ?? null;
    },
  });

  test('a_stored_session_counts_even_with_an_expired_access_token', async () => {
    const expired = JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1 });
    const s = storage({ [AUTH_STORAGE_KEY]: expired });
    expect(await readStoredSession(s)).toBe(true);
    expect(s.asked).toEqual(['gt:v1:auth']);
  });

  test('no_stored_session', async () => {
    expect(await readStoredSession(storage({}))).toBe(false);
  });
});

describe('hasLocalData', () => {
  test('any_row_in_any_table_counts', () => {
    expect(hasLocalData(emptyState())).toBe(false);
    const state = applyChanges(emptyState(), [
      {
        table: 'sets',
        row: { id: 's1', updatedAt: '2026-10-19T12:00:00.000Z', deletedAt: null, dayExerciseId: 'x1', setNumber: 1, reps: 8, weightKg: 60 },
      },
    ]);
    expect(hasLocalData(state)).toBe(true);
  });
});
