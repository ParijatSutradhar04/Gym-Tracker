import { Text, View } from 'react-native';

interface Props {
  tone: 'missed' | 'skipped';
  label: string;
}

export function Badge({ tone, label }: Props) {
  const box = tone === 'missed' ? 'bg-accent' : 'bg-surface-2';
  const text = tone === 'missed' ? 'text-on-accent' : 'text-muted';
  return (
    <View className={`rounded-full px-2.5 py-1 ${box}`}>
      <Text className={`font-sans-semibold text-[11px] uppercase tracking-wide ${text}`}>{label}</Text>
    </View>
  );
}
