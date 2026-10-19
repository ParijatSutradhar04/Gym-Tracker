import type { ReactNode } from 'react';

/** The phone keeps working offline, so there is nothing to pause. The website's version is the .web file. */
export function ConnectivityShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
