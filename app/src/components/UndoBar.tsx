import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

const UNDO_MS = 6000;

interface Props {
  message: string;
  onUndo: () => void;
  onExpire: () => void;
}

export function UndoBar({ message, onUndo, onExpire }: Props) {
  useEffect(() => {
    const t = setTimeout(onExpire, UNDO_MS);
    return () => clearTimeout(t);
  }, [message, onExpire]);
  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <View className="absolute bottom-[44px] left-5 right-5 h-12 rounded-[10px] bg-surface-2 px-4 flex-row items-center justify-between">
        <Text className="font-sans text-ink text-[14px]">{message}</Text>
        <Pressable accessibilityRole="button" onPress={onUndo} className="h-11 justify-center pl-4">
          <Text className="font-sans-semibold text-accent text-[14px]">Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}
