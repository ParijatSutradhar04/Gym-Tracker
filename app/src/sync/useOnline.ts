/** The phone saves locally and syncs when it can, so nothing in it waits on a connection. */
export function useOnline(): boolean {
  return true;
}
