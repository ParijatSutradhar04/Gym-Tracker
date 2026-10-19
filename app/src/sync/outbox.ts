import type { OutboxEntry } from '../data/DataStore';
import type { PushEntry } from './api';

/**
 * One push entry per row: its newest outbox entry by seq, since the server keeps only the latest version
 * of a row anyway. Rows go in the order of their first entry, so a row made before another still reaches
 * the server first. `ackIds` is every entry's id, the superseded ones included, to ack once the push lands.
 */
export function coalesceEntries(entries: OutboxEntry[]): { send: PushEntry[]; ackIds: string[] } {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  // A Map keeps a key where it was first inserted when the value is replaced.
  const newest = new Map<string, OutboxEntry>();
  for (const e of ordered) newest.set(e.table + '\u0000' + e.rowId, e);
  return {
    send: [...newest.values()].map((e) => ({ id: e.id, table: e.table, row: e.change.row })),
    ackIds: ordered.map((e) => e.id),
  };
}
