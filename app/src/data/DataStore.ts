import type { Change, DataState, TableName } from '../engine/types';

/** One local change waiting to be pushed to the server, in commit order. */
export interface OutboxEntry {
  seq: number;
  id: string;
  table: TableName;
  rowId: string;
  change: Change;
  at: string;
}

export interface DataStore {
  load(): Promise<DataState>;
  /** Persists the rows and appends one outbox entry per change, all in one write. */
  commit(changes: readonly Change[]): Promise<void>;
  /** Merges server rows last-write-wins. Never touches the outbox. */
  applyRemote(changes: readonly Change[]): Promise<void>;
  /** The phone's store only: see GymStore.restamp. */
  restamp?(after: string, now: string): Promise<void>;
}

export interface OutboxApi {
  /** The oldest `limit` entries, seq order. */
  peek(limit: number): Promise<OutboxEntry[]>;
  ack(ids: string[]): Promise<void>;
  count(): Promise<number>;
  /** Called after every commit and ack. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

/** Stored data could not be read. Nothing was written. */
export class StoreCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreCorruptError';
  }
}
