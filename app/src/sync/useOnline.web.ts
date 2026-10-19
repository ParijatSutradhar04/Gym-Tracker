import { useSyncExternalStore } from 'react';

function subscribe(fn: () => void): () => void {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

/**
 * The browser's own view of whether it has a connection. It can read online with no route to the server;
 * a save then fails, retries, and shows the save banner.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
