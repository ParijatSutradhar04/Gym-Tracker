import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useLayout } from '../data/hooks';
import { IconButton } from './IconButton';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Close X at the top right of the content, beside the title. */
  showClose?: boolean;
}

/** Bottom sheet on phones; the same content as a centered card on desktop. */
export function Sheet({ visible, onClose, children, title, showClose }: Props) {
  const { isDesktop } = useLayout();
  const header = (
    <View className="relative">
      {title ? <Text className={`font-sans-medium text-ink text-[22px] mb-3 ${showClose ? 'pr-12' : ''}`}>{title}</Text> : null}
      {showClose ? (
        <View className="absolute right-0 top-0 z-10">
          <IconButton icon="X" onPress={onClose} accessibilityLabel="Close" />
        </View>
      ) : null}
    </View>
  );
  return (
    <Modal transparent visible={visible} animationType={isDesktop ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View className={`flex-1 bg-black/70 ${isDesktop ? 'items-center justify-center' : 'justify-end'}`}>
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        {isDesktop ? (
          <View className="w-full max-w-[440px] bg-surface rounded-[24px] px-5 py-6">
            {header}
            {children}
          </View>
        ) : (
          <View className="bg-surface rounded-t-[24px] pt-3 px-5 pb-[34px]">
            <View className="items-center mb-4">
              <View className="w-9 h-1 rounded-sm bg-faint" />
            </View>
            {header}
            {children}
          </View>
        )}
      </View>
    </Modal>
  );
}
