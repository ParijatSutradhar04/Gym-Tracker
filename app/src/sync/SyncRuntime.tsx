import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Modal } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { supabase, supabaseTokenSource } from '../auth/supabase';
import type { DataStore, OutboxApi } from '../data/DataStore';
import type { GymStore } from '../data/GymStore';
import { asyncStorageAdapter } from '../data/storage';
import { LoginScreen } from '../screens/LoginScreen';
import { API_BASE, createSyncApi } from './api';
import { createCursorStore } from './cursor';
import { createScheduler } from './scheduler';
import { SyncEngine } from './SyncEngine';
import { SyncContext, type SyncHandle } from './useSyncStatus';

type Props = { data: DataStore & OutboxApi; gym: GymStore; children: ReactNode };

/** Syncs the phone's outbox with the server while there is a session. The website's version is the .web file. */
export function SyncRuntime({ data: outbox, gym, children }: Props) {
  const { hasStoredSession } = useAuth();
  const [engine] = useState(
    () =>
      new SyncEngine({
        outbox,
        api: createSyncApi({ baseUrl: API_BASE, tokens: supabaseTokenSource }),
        cursor: createCursorStore(asyncStorageAdapter),
        apply: (changes) => gym.applyRemote(changes),
        now: () => Date.now(),
      }),
  );
  const [scheduler] = useState(() =>
    createScheduler({
      engine,
      outbox,
      timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as number) },
    }),
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!hasStoredSession) return;
    scheduler.start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') scheduler.onForeground();
    });
    return () => {
      sub.remove();
      scheduler.stop();
    };
  }, [hasStoredSession, scheduler]);

  useEffect(() => {
    // A new session lifts `auth_required`, whichever screen it was signed in from.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') engine.resume();
    });
    return () => data.subscription.unsubscribe();
  }, [engine]);

  const handle = useMemo<SyncHandle>(
    () => ({
      subscribe: (fn) => engine.subscribe(fn),
      getStatus: () => engine.getStatus(),
      signIn: () => setSigningIn(true),
    }),
    [engine],
  );

  return (
    <SyncContext.Provider value={handle}>
      {children}
      <Modal visible={signingIn} animationType="slide" onRequestClose={() => setSigningIn(false)}>
        <LoginScreen onSignedIn={() => setSigningIn(false)} />
      </Modal>
    </SyncContext.Provider>
  );
}
