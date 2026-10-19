import { Pressable, Text, View } from 'react-native';
import { useSyncStatus } from '../sync/useSyncStatus';

const label = 'font-sans text-muted text-[12px] text-right shrink';

/** The top bar's sync state: a dot while changes wait to sync, and a line of text when sync needs the user. */
export function SyncStatusSlot() {
  const { phase, pending, signIn } = useSyncStatus();
  const dot = pending > 0 && (
    <View accessible accessibilityLabel="Unsynced changes" className="w-2 h-2 rounded-full bg-accent" />
  );
  if (phase === 'auth_required') {
    return (
      <View className="flex-row items-center gap-2 shrink">
        <Pressable onPress={signIn} accessibilityRole="button" hitSlop={8} className="shrink">
          <Text numberOfLines={2} className={label}>
            Sign in to sync
          </Text>
        </Pressable>
        {dot}
      </View>
    );
  }
  if (phase === 'clock_skew') {
    return (
      <View className="flex-row items-center gap-2 shrink">
        <Text numberOfLines={2} className={label}>
          Check your device clock
        </Text>
        {dot}
      </View>
    );
  }
  return dot || null;
}
