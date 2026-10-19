import type { Change } from '../engine/types';

/**
 * Pulls what other devices changed each time `subscribe`'s event fires (the website: the tab is shown or
 * focused, or the connection comes back). Events while a pull is running are dropped, since that pull covers
 * them. A failed pull is logged and left for the next event. Returns the unsubscribe.
 */
export function createFocusRefresh(deps: {
  pull(): Promise<Change[]>;
  apply(changes: Change[]): Promise<void>;
  isOnline(): boolean;
  subscribe(fn: () => void): () => void;
}): () => void {
  let running = false;

  const refresh = async () => {
    if (running || !deps.isOnline()) return;
    running = true;
    try {
      const changes = await deps.pull();
      if (changes.length > 0) await deps.apply(changes);
    } catch (err: unknown) {
      console.warn('Refreshing from the server failed', err);
    } finally {
      running = false;
    }
  };

  return deps.subscribe(() => void refresh());
}
