import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { msUntilNextMidnight, todayLocal, type DateStr } from '../engine/dates';
import { SyncRuntime } from '../sync/SyncRuntime';
import { GymStore } from './GymStore';
import { newId, nowIso } from './ids';
import { createDataStore } from './index';

const StoreContext = createContext<GymStore | null>(null);
const TodayContext = createContext<DateStr | null>(null);

/** The local date, refreshed just after midnight and whenever the app comes back to the foreground. */
function useTodayClock(): DateStr {
  const [today, setToday] = useState(() => todayLocal(new Date()));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setToday(todayLocal(new Date()));
      setTick((t) => t + 1);
    }, msUntilNextMidnight(new Date()) + 50);
    return () => clearTimeout(timer);
  }, [tick]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setToday(todayLocal(new Date()));
      setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);
  return today;
}

function LoadErrorScreen({ message }: { message: string }) {
  return (
    <View className="flex-1 bg-bg items-center justify-center px-8">
      <Text className="font-sans-semibold text-ink text-lg mb-2">Can't read saved data</Text>
      <Text className="font-sans text-muted text-center mb-4">{message}</Text>
      <Text className="font-sans text-faint text-center">Nothing was changed or deleted.</Text>
    </View>
  );
}

export function GymProvider({ children }: { children: ReactNode }) {
  const [{ data, store }] = useState(() => {
    const data = createDataStore();
    return { data, store: new GymStore(data, { newId, now: nowIso }) };
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const today = useTodayClock();
  useEffect(() => {
    let live = true;
    store.init().then(
      () => live && setReady(true),
      (e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [store]);
  if (error) return <LoadErrorScreen message={error.message} />;
  if (!ready) return null;
  return (
    <StoreContext.Provider value={store}>
      <TodayContext.Provider value={today}>
        <SyncRuntime outbox={data} gym={store}>
          {children}
        </SyncRuntime>
      </TodayContext.Provider>
    </StoreContext.Provider>
  );
}

export function useGymStore(): GymStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useGymStore must be used inside GymProvider');
  return store;
}

export function useToday(): DateStr {
  const today = useContext(TodayContext);
  if (today === null) throw new Error('useToday must be used inside GymProvider');
  return today;
}
