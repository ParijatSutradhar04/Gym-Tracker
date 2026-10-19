import { Pressable, Text, View } from 'react-native';
import { colors } from '../theme';
import { Icon } from './icons';

interface Props {
  visible: boolean;
  onPress: () => void;
}

export function GymMissedFab({ visible, onPress }: Props) {
  if (!visible) return null;
  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Gym Missed"
        onPress={onPress}
        className="absolute bottom-[44px] right-5 w-[134px] h-12 rounded-[100px] bg-accent flex-row items-center justify-center gap-2"
      >
        <Icon name="CalendarX" size={18} color={colors.onAccent} />
        <Text className="font-sans-semibold text-on-accent text-[14px]">Gym Missed</Text>
      </Pressable>
    </View>
  );
}
