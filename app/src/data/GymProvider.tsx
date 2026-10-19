import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { LoadFailedScreen } from '../components/LoadFailedScreen';
import { msUntilNextMidnight, todayLocal, type DateStr } from '../engine/dates';
import { HttpError, NetworkError } from '../sync/api';
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
  // Bumped by Retry on the website's load-failed screen to load again.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const today = useTodayClock();
  useEffect(() => {
    let live = true;
    store.init().then(
      () => {
        if (!live) return;
        setError(null);
        setReady(true);
      },
      (e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRetrying(false);
      },
    );
    return () => {
      live = false;
    };
  }, [store, attempt]);
  // The server could not be reached or failed; asking again may work. (Only the website loads from the server.)
  if (error instanceof NetworkError || error instanceof HttpError) {
    const retry = () => {
      setRetrying(true);
      setAttempt((a) => a + 1);
    };
    return <LoadFailedScreen message={error.message} retrying={retrying} onRetry={retry} />;
  }
  if (error) return <LoadErrorScreen message={error.message} />;
  if (!ready) return null;
  return (
    <StoreContext.Provider value={store}>
      <TodayContext.Provider value={today}>
        <SyncRuntime data={data} gym={store}>
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
