import { Pressable } from 'react-native';
import { Icon, type IconName } from './icons';

interface Props {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
}

export function IconButton({ icon, onPress, accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="w-11 h-11 rounded-[10px] bg-surface-2 items-center justify-center"
    >
      <Icon name={icon} size={20} />
    </Pressable>
  );
}
