import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ visible, onClose, children }: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-5">
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        <View className="w-full max-w-[440px] bg-surface rounded-[24px] p-6">{children}</View>
      </View>
    </Modal>
  );
}
