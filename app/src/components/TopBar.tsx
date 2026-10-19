import { Text, View } from 'react-native';
import { colors } from '../theme';
import { Icon } from './icons';
import { IconButton } from './IconButton';
import { SyncStatusSlot } from './SyncStatusSlot';

export function TopBar({ onExport }: { onExport: () => void }) {
  return (
    <View className="h-[60px] px-4 flex-row items-center">
      {/* Equal sides keep the title centered when the sync slot shows text. */}
      <View className="flex-1 items-start">
        <IconButton icon="FileDown" onPress={onExport} accessibilityLabel="Export CSV" />
      </View>
      <Text className="font-sans-semibold text-ink text-[20px] mx-2">Gym Tracker</Text>
      <View className="flex-1 flex-row items-center justify-end gap-2">
        <SyncStatusSlot />
        <Icon name="Dumbbell" size={22} color={colors.accent} />
      </View>
    </View>
  );
}
