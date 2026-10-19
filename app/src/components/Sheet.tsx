import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useLayout } from '../data/hooks';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

/** Bottom sheet on phones; the same content as a centered card on desktop. */
export function Sheet({ visible, onClose, children, title }: Props) {
  const { isDesktop } = useLayout();
  return (
    <Modal transparent visible={visible} animationType={isDesktop ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View className={`flex-1 bg-black/70 ${isDesktop ? 'items-center justify-center' : 'justify-end'}`}>
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        {isDesktop ? (
          <View className="w-full max-w-[440px] bg-surface rounded-[24px] px-5 py-6">
            {title ? <Text className="font-sans-medium text-ink text-[22px] mb-3">{title}</Text> : null}
            {children}
          </View>
        ) : (
          <View className="bg-surface rounded-t-[24px] pt-3 px-5 pb-[34px]">
            <View className="items-center mb-4">
              <View className="w-9 h-1 rounded-sm bg-faint" />
            </View>
            {title ? <Text className="font-sans-medium text-ink text-[22px] mb-3">{title}</Text> : null}
            {children}
          </View>
        )}
      </View>
    </Modal>
  );
}
