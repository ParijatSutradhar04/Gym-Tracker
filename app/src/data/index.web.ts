import { supabaseTokenSource } from '../auth/supabase';
import { API_BASE, createSyncApi } from '../sync/api';
import { newId } from './ids';
import { RemoteStore } from './RemoteStore';

/** The website's storage: the server itself. Metro picks this file over index.ts for web builds. */
export function createDataStore(): RemoteStore {
  return new RemoteStore(createSyncApi({ baseUrl: API_BASE, tokens: supabaseTokenSource }), {
    newId,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}
