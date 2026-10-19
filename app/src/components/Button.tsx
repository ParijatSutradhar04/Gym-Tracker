import { Pressable, Text, View } from 'react-native';
import { colors } from '../theme';
import { Icon, type IconName } from './icons';

interface Props {
  variant: 'primary' | 'secondary' | 'outline';
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
}

const BOX = {
  primary: 'bg-accent',
  secondary: 'bg-surface-2',
  outline: 'border border-border',
} as const;

export function Button({ variant, label, onPress, icon, disabled }: Props) {
  const textColor = variant === 'primary' ? 'text-on-accent' : 'text-ink';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-[52px] rounded-[10px] flex-row items-center justify-center gap-2 ${BOX[variant]} ${disabled ? 'opacity-40' : ''}`}
    >
      {icon ? (
        <View>
          <Icon name={icon} size={18} color={variant === 'primary' ? colors.onAccent : colors.ink} />
        </View>
      ) : null}
      <Text className={`font-sans-semibold text-[15px] ${textColor}`}>{label}</Text>
    </Pressable>
  );
}
