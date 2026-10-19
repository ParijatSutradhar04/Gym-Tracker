import { Text, View } from 'react-native';
import { formatCount } from '../engine/dates';

interface Props {
  exercises: number;
  sets: number;
  volumeKg: number;
}

export function StatsCard({ exercises, sets, volumeKg }: Props) {
  return (
    <View className="rounded-[16px] bg-surface p-6 flex-row justify-between">
      <Cell label="EXERCISES" value={formatCount(exercises)} />
      <Cell label="TOTAL SETS" value={formatCount(sets)} />
      <Cell label="VOLUME" value={volumeKg > 0 ? `${volumeKg.toLocaleString('en-US')} kg` : '—'} />
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-3">
      <Text className="font-sans text-faint text-[10px] tracking-wider">{label}</Text>
      <Text className="font-mono-medium text-ink text-[28px]">{value}</Text>
    </View>
  );
}
