import type { Ctx, DataState, Change } from '../types';
import type { DateStr } from '../dates';
import { applyChanges } from '../state';

export function makeCtx(today: DateStr, startSeq = 0): Ctx {
  let seq = startSeq;
  let ms = 0;
  const base = Date.parse(today + 'T12:00:00.000Z');
  return {
    today,
    newId: () => `id-${++seq}`,
    now: () => new Date(base + ms++).toISOString(),
  };
}

export function run(state: DataState, changes: Change[]): DataState {
  return applyChanges(state, changes);
}
