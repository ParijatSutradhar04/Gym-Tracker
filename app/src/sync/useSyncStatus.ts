import { createContext, useContext, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthProvider';
import type { SyncStatus } from './SyncEngine';

export interface SyncHandle {
  subscribe(fn: () => void): () => void;
  getStatus(): SyncStatus;
  /** Opens the sign-in sheet. */
  signIn(): void;
}

/** Null where nothing syncs from this device: the website. */
export const SyncContext = createContext<SyncHandle | null>(null);

const IDLE: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: null, lastError: null };
const none = () => () => {};
const idle = () => IDLE;
const noop = () => {};

/**
 * The engine's status, except that a phone with no stored session reads as `auth_required`: no cycle runs
 * without one, so the engine itself would never get there.
 */
export function useSyncStatus(): SyncStatus & { signIn(): void } {
  const sync = useContext(SyncContext);
  const { hasStoredSession } = useAuth();
  const status = useSyncExternalStore(sync?.subscribe ?? none, sync?.getStatus ?? idle);
  const phase = sync && !hasStoredSession ? 'auth_required' : status.phase;
  return { ...status, phase, signIn: sync?.signIn ?? noop };
}
