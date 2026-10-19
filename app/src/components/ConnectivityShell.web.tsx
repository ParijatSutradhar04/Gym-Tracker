import { useEffect, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useGymStore } from '../data/hooks';
import { useOnline } from '../sync/useOnline';

/**
 * The website saves only to the server, so while the browser is offline edits are paused behind a banner.
 * Coming back online lifts the pause; SyncRuntime pulls whatever changed meanwhile.
 */
export function ConnectivityShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const gym = useGymStore();
  useEffect(() => {
    gym.setWritesPaused(!online);
  }, [gym, online]);
  return (
    <View className="flex-1 bg-bg">
      {online ? null : (
        <View accessibilityRole="alert" className="bg-surface-2 px-4 py-3 items-center">
          <Text className="font-sans text-ink text-[13px] text-center">You're offline. Changes won't save</Text>
        </View>
      )}
      <View className={online ? 'flex-1' : 'flex-1 opacity-40'} style={{ pointerEvents: online ? 'auto' : 'none' }}>
        {children}
      </View>
    </View>
  );
}
