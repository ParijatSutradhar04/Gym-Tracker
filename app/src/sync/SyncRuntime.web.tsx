import { useEffect, type ReactNode } from 'react';
import type { DataStore } from '../data/DataStore';
import type { GymStore } from '../data/GymStore';
import { RemoteStore } from '../data/RemoteStore';
import { createFocusRefresh } from './focusRefresh';

type Props = { data: DataStore; gym: GymStore; children: ReactNode };

/**
 * The website keeps no outbox: each edit goes straight to the server. What runs here pulls in other
 * devices' edits whenever the tab comes back into view or the connection returns.
 */
export function SyncRuntime({ data, gym, children }: Props) {
  useEffect(() => {
    if (!(data instanceof RemoteStore)) throw new Error('The website must load its data with RemoteStore');
    return createFocusRefresh({
      pull: () => data.pullDelta(),
      apply: (changes) => gym.applyRemote(changes),
      isOnline: () => navigator.onLine,
      subscribe: onTabReturn,
    });
  }, [data, gym]);
  return <>{children}</>;
}

function onTabReturn(fn: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', fn);
  window.addEventListener('online', fn);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', fn);
    window.removeEventListener('online', fn);
  };
}
