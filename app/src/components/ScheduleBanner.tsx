import { Pressable, Text, View } from 'react-native';
import { REPEAT_LABELS } from '../engine/repeat';
import type { DayView } from '../engine/dayView';
import { colors } from '../theme';
import { Badge } from './Badge';
import { Icon } from './icons';

interface Props {
  day: DayView;
  onAdd: () => void;
  onChange: () => void;
}

export function ScheduleBanner({ day, onAdd, onChange }: Props) {
  const { routine } = day;
  if (!routine) {
    if (!day.canEditSchedule) return null;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        className="h-[104px] rounded-[16px] bg-surface items-center justify-center"
      >
        <Text className="font-sans-semibold text-accent text-[16px]">+ Add Schedule</Text>
      </Pressable>
    );
  }
  const editable = day.canEditSchedule && routine.routineId !== null;
  const rule = routine.repeatRule;
  return (
    <View className="rounded-[16px] bg-surface p-5">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-sans-medium text-ink text-[22px] flex-1" numberOfLines={2}>
          {routine.title}
        </Text>
        {editable ? (
          <ChangeButton onPress={onChange} />
        ) : day.status ? (
          <Badge tone={day.status} label={day.status === 'missed' ? 'Missed' : 'Skipped'} />
        ) : null}
      </View>
      {editable && rule ? (
        <Pressable accessibilityRole="button" onPress={onChange} className="flex-row items-center gap-2 mt-4 self-start">
          <Icon name="Repeat2" size={16} color={colors.accent} />
          <Text className="font-sans text-muted text-[14px]">{REPEAT_LABELS[rule]}</Text>
          <Icon name="ChevronDown" size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ChangeButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-8 px-4 rounded-[8px] bg-surface-2 items-center justify-center"
    >
      <Text className="font-sans-semibold text-ink text-[13px]">Change</Text>
    </Pressable>
  );
}
