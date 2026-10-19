import type { KeyValueStorage } from '../data/storage';

/** Beside LocalStore's own `gt:v1:` keys, which its load() leaves alone. */
const KEY = 'gt:v1:sync';

/** The last server seq this device has applied. */
export interface CursorStore {
  get(): Promise<number>;
  set(n: number): Promise<void>;
}

/**
 * Stored as `{"cursor": n}`. A missing or unreadable value reads as 0, which re-pulls everything: safe,
 * because merging a row this device already has changes nothing.
 */
export function createCursorStore(storage: KeyValueStorage): CursorStore {
  return {
    async get() {
      const [[, raw]] = await storage.multiGet([KEY]);
      if (raw === null) return 0;
      try {
        const cursor = (JSON.parse(raw) as { cursor?: unknown } | null)?.cursor;
        return typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
      } catch {
        return 0;
      }
    },
    async set(n) {
      await storage.multiSet([[KEY, JSON.stringify({ cursor: n })]]);
    },
  };
}
