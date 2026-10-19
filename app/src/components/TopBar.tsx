import { Text, View } from 'react-native';
import { colors } from '../theme';
import { Icon } from './icons';
import { IconButton } from './IconButton';
import { SyncStatusSlot } from './SyncStatusSlot';

export function TopBar({ onExport }: { onExport: () => void }) {
  return (
    <View className="h-[60px] px-4 flex-row items-center justify-between">
      <IconButton icon="FileDown" onPress={onExport} accessibilityLabel="Export CSV" />
      <Text className="font-sans-semibold text-ink text-[20px]">Gym Tracker</Text>
      <View className="w-11 flex-row items-center justify-end gap-2">
        <SyncStatusSlot />
        <Icon name="Dumbbell" size={22} color={colors.accent} />
      </View>
    </View>
  );
}
