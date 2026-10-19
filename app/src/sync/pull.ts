import type { Change } from '../engine/types';
import type { SyncApi } from './api';
import type { CursorStore } from './cursor';

/**
 * Pulls every page since the saved cursor. Each page is applied before the cursor moves past it, so a
 * failure or a crash part-way leaves the cursor at the last page that was applied and the next pull
 * picks up from there.
 */
export async function pullAll(deps: {
  api: SyncApi;
  cursor: CursorStore;
  apply(changes: Change[]): Promise<void>;
  limit?: number;
}): Promise<{ pages: number; changes: number; serverTime: string | null }> {
  let cursor = await deps.cursor.get();
  let pages = 0;
  let changes = 0;
  let serverTime: string | null = null;
  for (;;) {
    const page = await deps.api.pull(cursor, deps.limit);
    pages++;
    serverTime = page.serverTime;
    if (page.changes.length > 0) {
      await deps.apply(page.changes);
      changes += page.changes.length;
    }
    if (page.cursor !== cursor) await deps.cursor.set(page.cursor);
    if (!page.hasMore) return { pages, changes, serverTime };
    // Asking again from the same cursor would get the same page forever.
    if (page.cursor <= cursor) throw new Error(`The pull cursor did not advance past ${cursor}`);
    cursor = page.cursor;
  }
}
