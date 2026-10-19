import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { readStoredSession } from './gate';
import { supabase } from './supabase';

interface AuthState {
  hasStoredSession: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ hasStoredSession: false, loading: true });
  useEffect(() => {
    let live = true;
    let seq = 0;
    const check = () => {
      const n = ++seq;
      const settle = (hasStoredSession: boolean) => live && n === seq && setState({ hasStoredSession, loading: false });
      readStoredSession(AsyncStorage).then(settle, () => settle(false));
    };
    check();
    // supabase-js saves or removes the stored session before it emits, so re-reading storage on each event
    // follows a sign-in or sign-out, while an offline INITIAL_SESSION with no session changes nothing.
    const { data } = supabase.auth.onAuthStateChange(() => check());
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Supabase's advice for React Native: refresh tokens only while the app is in the foreground.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void supabase.auth.startAutoRefresh();
      else void supabase.auth.stopAutoRefresh();
    });
    return () => sub.remove();
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
