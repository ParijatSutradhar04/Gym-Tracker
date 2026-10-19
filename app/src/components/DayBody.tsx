import { useState } from 'react';
import { Text, View } from 'react-native';
import { useCtx, useGymState } from '../data/hooks';
import type { DateStr } from '../engine/dates';
import { getDay } from '../engine/dayView';
import { colors } from '../theme';
import { ExerciseList } from './ExerciseList';
import { Icon } from './icons';
import { ScheduleBanner } from './ScheduleBanner';
import { ScheduleSheet } from './ScheduleSheet';
import { SetsSheet } from './SetsSheet';

export function DayBody({ date }: { date: DateStr }) {
  const state = useGymState();
  const ctx = useCtx();
  const day = getDay(state, ctx, date);
  const [scheduleMode, setScheduleMode] = useState<'add' | 'change' | null>(null);
  const [openPosition, setOpenPosition] = useState<number | null>(null);
  const empty = day.canEditSchedule && !day.routine;
  return (
    <View className="px-5">
      <ScheduleBanner day={day} onAdd={() => setScheduleMode('add')} onChange={() => setScheduleMode('change')} />
      {empty ? (
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
      ) : null}
      <ExerciseList day={day} onSelect={setOpenPosition} />
      <ScheduleSheet
        mode={scheduleMode ?? 'add'}
        date={date}
        day={day}
        visible={scheduleMode !== null}
        onClose={() => setScheduleMode(null)}
      />
      <SetsSheet
        date={date}
        position={openPosition ?? 0}
        visible={openPosition !== null}
        onClose={() => setOpenPosition(null)}
      />
    </View>
  );
}
