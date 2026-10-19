import { Pressable, Text } from 'react-native';
import { useGymStore, useSaveError } from '../data/hooks';
import { colors } from '../theme';
import { Icon } from './icons';

/** Stands while a change lives only in memory; tapping tries the save again (the next edit does too). */
export function SaveErrorBanner() {
  const store = useGymStore();
  const error = useSaveError();
  if (!error) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => store.retry()}
      className="mx-4 my-2 rounded-[10px] bg-surface-2 px-4 py-3 flex-row items-center gap-2"
    >
      <Icon name="TriangleAlert" size={16} color={colors.accent} />
      <Text className="font-sans text-ink text-[13px] flex-1">Not saved on this device. Tap to retry.</Text>
    </Pressable>
  );
}
