import { TABLES } from '../engine/state';
import type { DataState } from '../engine/types';

/** Where Supabase keeps the session, beside the app's other `gt:v1:` keys. Here so the gate can read it without loading the client. */
export const AUTH_STORAGE_KEY = 'gt:v1:auth';

export type Gate = 'login' | 'app' | 'app_signin_prompt';

/**
 * What the app opens to. A stored session opens the app even if its access token has expired: the token is
 * refreshed when there is a network, and a phone offline for a week still opens straight into its data. With
 * no session the website has nothing to show, but a phone with logged workouts opens them and asks to sign in.
 */
export function resolveGate(i: { platform: 'native' | 'web'; hasStoredSession: boolean; hasLocalData: boolean }): Gate {
  if (i.hasStoredSession) return 'app';
  if (i.platform === 'native' && i.hasLocalData) return 'app_signin_prompt';
  return 'login';
}

/**
 * Reads the stored session straight from storage. `getSession()` would try to refresh an expired token and,
 * offline, report no session, which would look like a sign-out.
 */
export async function readStoredSession(storage: { getItem(key: string): Promise<string | null> }): Promise<boolean> {
  return (await storage.getItem(AUTH_STORAGE_KEY)) !== null;
}

/** Any row counts, deleted ones too: they are still this phone's history. */
export function hasLocalData(state: DataState): boolean {
  return TABLES.some((t) => state[t].size > 0);
}
