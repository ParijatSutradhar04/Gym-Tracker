import { Pressable, Text, View } from 'react-native';
import { useCtx, useGymState } from '../data/hooks';
import type { DateStr } from '../engine/dates';
import { getDay } from '../engine/dayView';
import { colors } from '../theme';
import { Icon } from './icons';

export function DayBody({ date }: { date: DateStr }) {
  const state = useGymState();
  const ctx = useCtx();
  const day = getDay(state, ctx, date);
  if (day.canEditSchedule && !day.routine) {
    return (
      <View className="px-5">
        <Pressable
          accessibilityRole="button"
          className="h-[104px] rounded-[16px] bg-surface items-center justify-center"
        >
          <Text className="font-sans-semibold text-accent text-[16px]">+ Add Schedule</Text>
        </Pressable>
        <View className="items-center mt-16 px-4">
          <View className="w-[72px] h-[72px] rounded-[20px] bg-surface items-center justify-center">
            <Icon name="CalendarPlus" size={28} color={colors.accent} />
          </View>
          <Text className="font-sans-medium text-ink text-[20px] mt-6 text-center">Make room for progress.</Text>
          <Text className="font-sans text-muted text-[14px] mt-3 text-center leading-5">
            Add a schedule to plan your routine. Your exercises and sets will live here.
          </Text>
          <Text className="font-sans text-faint text-[10px] mt-6 tracking-wider text-center">
            YOUR NEXT REP STARTS WITH A PLAN
          </Text>
        </View>
      </View>
    );
  }
  return null;
}
