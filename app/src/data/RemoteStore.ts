import { emptyState, mergeRemote } from '../engine/state';
import type { Change, DataState } from '../engine/types';
import { HttpError, NetworkError, type PushEntry, type SyncApi } from '../sync/api';
import type { DataStore } from './DataStore';

const PULL_LIMIT = 500;
const PUSH_BATCH = 200;
/** Waits before each retry of a push that failed for a reason time can fix; after the last, commit gives up. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/**
 * The website's store: the server is the only copy. `load` reads everything, `commit` pushes straight to the
 * server, and `pullDelta` fetches what other devices changed since. Nothing is kept in the browser.
 */
export class RemoteStore implements DataStore {
  private cursor = 0;

  constructor(
    private readonly api: SyncApi,
    private readonly deps: { newId(): string; sleep(ms: number): Promise<void> },
  ) {}

  async load(): Promise<DataState> {
    const { changes, cursor } = await this.pullFrom(0);
    this.cursor = cursor;
    return mergeRemote(emptyState(), changes).state;
  }

  async commit(changes: readonly Change[]): Promise<void> {
    for (let i = 0; i < changes.length; i += PUSH_BATCH) {
      const entries = changes
        .slice(i, i + PUSH_BATCH)
        .map((c): PushEntry => ({ id: this.deps.newId(), table: c.table, row: c.row }));
      await this.push(entries);
    }
  }

  /** The website persists nothing, so rows pulled into memory have nowhere else to go. */
  async applyRemote(_changes: readonly Change[]): Promise<void> {}

  async pullDelta(): Promise<Change[]> {
    const { changes, cursor } = await this.pullFrom(this.cursor);
    this.cursor = cursor;
    return changes;
  }

  private async pullFrom(start: number): Promise<{ changes: Change[]; cursor: number }> {
    const changes: Change[] = [];
    let cursor = start;
    for (;;) {
      const page = await this.api.pull(cursor, PULL_LIMIT);
      changes.push(...page.changes);
      if (!page.hasMore) return { changes, cursor: page.cursor };
      // Asking again from the same cursor would get the same page forever.
      if (page.cursor <= cursor) throw new Error(`The pull cursor did not advance past ${cursor}`);
      cursor = page.cursor;
    }
  }

  private async push(entries: PushEntry[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.api.push(entries);
        if (result.rejected.length > 0) {
          const reasons = [...new Set(result.rejected.map((r) => r.reason))].join('; ');
          throw new Error(`The server turned down ${result.rejected.length} change(s): ${reasons}`);
        }
        const acked = new Set(result.acked);
        const missing = entries.filter((e) => !acked.has(e.id)).length;
        if (missing > 0) throw new Error(`The server did not confirm ${missing} of ${entries.length} changes`);
        return;
      } catch (err: unknown) {
        if (!retryable(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
        await this.deps.sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
}

function retryable(err: unknown): boolean {
  return err instanceof NetworkError || (err instanceof HttpError && err.status >= 500);
}
