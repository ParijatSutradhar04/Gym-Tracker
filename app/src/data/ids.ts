import { randomUUID } from 'expo-crypto';

export function newId(): string {
  return randomUUID();
}

let last = 0;

/** Wall-clock ISO time, strictly increasing within this process. Commands rely on later writes sorting later. */
export function nowIso(): string {
  last = Math.max(Date.now(), last + 1);
  return new Date(last).toISOString();
}
