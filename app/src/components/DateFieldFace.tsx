import { Text, View } from 'react-native';
import { MONTH_NAMES, type DateStr } from '../engine/dates';
import { colors } from '../theme';
import { Icon } from './icons';

/** `2026-09-01` -> `Sep 01, 2026` */
function display(date: DateStr): string {
  const [y, m, d] = date.split('-');
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${d}, ${y}`;
}

/** The look of a From/To date input; DateField (per platform) adds the picker. */
export function DateFieldFace({ label, value }: { label: string; value: DateStr }) {
  return (
    <View className="h-[60px] rounded-[10px] border border-border bg-bg px-[14px] flex-row items-center justify-between">
      <View className="gap-[5px]">
        <Text className="font-sans text-muted text-[10px]">{label}</Text>
        <Text className="font-mono text-ink text-[14px]">{display(value)}</Text>
      </View>
      <Icon name="CalendarDays" size={20} color={colors.muted} />
    </View>
  );
}
