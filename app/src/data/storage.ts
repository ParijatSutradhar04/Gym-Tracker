import AsyncStorage from '@react-native-async-storage/async-storage';

/** The slice of AsyncStorage the store uses. `multiSet` must write all pairs or none. */
export interface KeyValueStorage {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: string[]): Promise<readonly [string, string | null][]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
}

/** In-memory storage for tests. `failNextWrite()` makes the next write reject before touching anything. */
export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  private failWrite = false;

  failNextWrite(): void {
    this.failWrite = true;
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.data);
  }

  async getAllKeys(): Promise<readonly string[]> {
    return [...this.data.keys()];
  }

  async multiGet(keys: string[]): Promise<readonly [string, string | null][]> {
    return keys.map((k) => [k, this.data.get(k) ?? null]);
  }

  async multiSet(pairs: [string, string][]): Promise<void> {
    this.checkWrite();
    for (const [k, v] of pairs) this.data.set(k, v);
  }

  async multiRemove(keys: string[]): Promise<void> {
    this.checkWrite();
    for (const k of keys) this.data.delete(k);
  }

  private checkWrite(): void {
    if (!this.failWrite) return;
    this.failWrite = false;
    throw new Error('MemoryStorage: simulated write failure');
  }
}

/** The app's only use of AsyncStorage. */
export const asyncStorageAdapter: KeyValueStorage = {
  getAllKeys: () => AsyncStorage.getAllKeys(),
  multiGet: (keys) => AsyncStorage.multiGet(keys),
  multiSet: (pairs) => AsyncStorage.multiSet(pairs),
  multiRemove: (keys) => AsyncStorage.multiRemove(keys),
};
