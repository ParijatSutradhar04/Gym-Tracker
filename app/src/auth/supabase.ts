import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY } from './gate';
import { createTokenSource } from './tokens';

export { AUTH_STORAGE_KEY };

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Until the Supabase project exists these are blank, and the app is still worth running on its local data,
// so this warns instead of throwing. `createClient` throws on an empty URL or key, so placeholders keep the
// import from crashing; a sign-in before real values exist fails at the network layer instead.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set — sign-in will not work yet.');
}

// AsyncStorage rather than expo-secure-store: a session can exceed SecureStore's 2048 bytes per key, and this
// is one person's app on their own device. AsyncStorage is localStorage on web, so both keep the session.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

export const supabaseTokenSource = createTokenSource(supabase.auth);
