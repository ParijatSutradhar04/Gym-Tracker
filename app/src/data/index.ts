import type { DataStore, OutboxApi } from './DataStore';
import { newId, nowIso } from './ids';
import { LocalStore } from './LocalStore';
import { asyncStorageAdapter } from './storage';

/** The one place the app picks its storage implementation. */
export function createDataStore(): DataStore & OutboxApi {
  return new LocalStore(asyncStorageAdapter, { newId, now: nowIso });
}
