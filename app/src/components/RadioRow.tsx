import { Pressable, Text, View } from 'react-native';
import { accentTint } from '../theme';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function RadioRow({ label, selected, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={selected ? { backgroundColor: accentTint } : undefined}
      className={`h-[54px] rounded-[10px] px-4 flex-row items-center justify-between border ${
        selected ? 'border-accent' : 'border-transparent bg-surface-2'
      }`}
    >
      <Text className={`text-[14px] ${selected ? 'font-sans-semibold text-accent' : 'font-sans text-ink'}`}>{label}</Text>
      <View
        className={`w-5 h-5 rounded-full items-center justify-center border-[1.5px] ${selected ? 'border-accent' : 'border-faint'}`}
      >
        {selected ? <View className="w-2.5 h-2.5 rounded-full bg-accent" /> : null}
      </View>
    </Pressable>
  );
}
