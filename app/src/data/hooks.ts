import { useMemo, useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';
import { todayLocal } from '../engine/dates';
import type { Ctx, DataState } from '../engine/types';
import { useGymStore, useToday } from './GymProvider';
import { createActions, type Actions } from './GymStore';
import { newId, nowIso } from './ids';

export { useGymStore, useToday };
export type { Actions };

export function useGymState(): DataState {
  const store = useGymStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useCtx(): Ctx {
  const today = useToday();
  return useMemo(() => ({ today, now: nowIso, newId }), [today]);
}

/** Actions read the wall-clock date when they run, so a write never uses a date the clock has left behind. */
export function useActions(): Actions {
  const store = useGymStore();
  return useMemo(() => createActions(store, () => todayLocal(new Date())), [store]);
}

/** The last save failure, or null once every change is saved. */
export function useSaveError(): Error | null {
  const store = useGymStore();
  return useSyncExternalStore(store.subscribe, () => store.lastError);
}

export function useLayout(): { isDesktop: boolean } {
  const { width } = useWindowDimensions();
  return { isDesktop: width >= 900 };
}
