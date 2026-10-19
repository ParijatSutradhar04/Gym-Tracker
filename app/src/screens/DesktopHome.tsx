import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackfillSheet } from '../components/BackfillSheet';
import { DateBar } from '../components/DateBar';
import { ExerciseList } from '../components/ExerciseList';
import { Icon } from '../components/icons';
import { IconButton } from '../components/IconButton';
import { ScheduleBanner } from '../components/ScheduleBanner';
import { SaveErrorBanner } from '../components/SaveErrorBanner';
import { ScheduleSheet } from '../components/ScheduleSheet';
import { SetsEditor } from '../components/SetsEditor';
import { StatsCard } from '../components/StatsCard';
import { SyncStatusSlot } from '../components/SyncStatusSlot';
import { useActions, useCtx, useGymState, useToday } from '../data/hooks';
import { MONTH_NAMES, WEEKDAY_FULL, WEEKDAY_SHORT, weekdayIndex, type DateStr } from '../engine/dates';
import { getDay, type DayView } from '../engine/dayView';
import { MAX_NAME_LENGTH } from '../engine/names';
import { EngineError } from '../engine/types';
import { colors } from '../theme';

interface Props {
  selected: DateStr;
  onSelect: (date: DateStr) => void;
  onExport: () => void;
  onGymMissed: () => void;
}

const monthShort = (date: DateStr) => MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3);

/** `SUN, OCT 18, 2026` */
function headerDate(date: DateStr): string {
  return `${WEEKDAY_SHORT[weekdayIndex(date)]}, ${monthShort(date)} ${date.slice(8)}, ${date.slice(0, 4)}`.toUpperCase();
}

function repeatLine(day: DayView): string | null {
  const rule = day.routine?.repeatRule;
  if (!rule) return null;
  const weekday = WEEKDAY_FULL[weekdayIndex(day.routine?.startDate ?? day.date)];
  const text = {
    weekly: `Repeats every ${weekday}`,
    twice_weekly: 'Repeats twice a week',
    biweekly: 'Repeats every 2 weeks',
    never: 'One-off',
  }[rule];
  if (!day.nextUp) return text;
  return `${text} · Next up: ${MONTH_NAMES[Number(day.nextUp.slice(5, 7)) - 1]} ${day.nextUp.slice(8)}`;
}

export function DesktopHome({ selected, onSelect, onExport, onGymMissed }: Props) {
  const state = useGymState();
  const ctx = useCtx();
  const today = useToday();
  const actions = useActions();
  const day = getDay(state, ctx, selected);
  // The sheet keeps the date it opened on, so midnight moving the selection never retargets it.
  const [schedule, setSchedule] = useState<{ mode: 'add' | 'change'; date: DateStr } | null>(null);
  const [backfillOpen, setBackfillOpen] = useState(false);
  // The pick is scoped to a date; a stale or missing position falls back to the first exercise.
  const [pick, setPick] = useState<{ date: DateStr; position: number } | null>(null);
  const picked = pick?.date === selected ? pick.position : null;
  const current = day.exercises.find((x) => x.position === picked) ?? day.exercises[0] ?? null;
  const empty = day.canEditSchedule && !day.routine;
  const repeats = repeatLine(day);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="h-[88px] px-12 flex-row items-center border-b border-border">
        <IconButton icon="FileDown" onPress={onExport} accessibilityLabel="Export CSV" />
        <View className="flex-row items-center gap-3 ml-6">
          <Icon name="Dumbbell" size={24} color={colors.accent} />
          <Text className="font-sans-semibold text-ink text-[24px]">Gym Tracker</Text>
        </View>
        <Text className="font-sans-medium text-accent text-[14px] ml-16">Workout</Text>
        <Text className="font-sans text-muted text-[14px] ml-8 flex-1">Your training, one day at a time.</Text>
        <View className="mr-6">
          <SyncStatusSlot />
        </View>
        <Text className="font-mono text-muted text-[12px]">{headerDate(today)}</Text>
      </View>
      <SaveErrorBanner />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="w-full max-w-[1360px] self-center px-20 pt-12 pb-10 flex-1">
          <View className="flex-row items-start justify-between">
            <View>
              <Text className="font-sans-semibold text-accent text-[11px] tracking-wider">THE DAILY PRACTICE</Text>
              <Text className="font-sans-medium text-ink text-[40px] mt-3">
                {selected === today ? "Today's workout" : 'Workout'}
              </Text>
              {selected === today ? null : (
                <Text className="font-mono text-muted text-[12px] mt-1">{headerDate(selected)}</Text>
              )}
            </View>
            {day.canGymMissed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Gym Missed"
                onPress={onGymMissed}
                className="h-12 px-6 rounded-[100px] bg-accent flex-row items-center justify-center gap-2"
              >
                <Icon name="CalendarX" size={18} color={colors.onAccent} />
                <Text className="font-sans-semibold text-on-accent text-[14px]">Gym Missed</Text>
              </Pressable>
            ) : null}
          </View>

          <View className="flex-row gap-8 mt-10 items-start">
            <View className="flex-1">
              <DateBar selected={selected} onSelect={onSelect} inset={0} />
              <ScheduleBanner
                day={day}
                onAdd={() => setSchedule({ mode: 'add', date: selected })}
                onChange={() => setSchedule({ mode: 'change', date: selected })}
                onBackfill={() => setBackfillOpen(true)}
                onRestore={(shiftId) => {
                  try {
                    actions.restoreShift(shiftId);
                  } catch (e) {
                    // Already restored or locked by a schedule edit: the banner re-renders without Restore.
                    if (!(e instanceof EngineError)) throw e;
                  }
                }}
              />
              {day.canBackfill ? (
                <Text className="font-sans text-muted text-[14px] mt-6 text-center">Nothing logged for this day.</Text>
              ) : null}
              <ExerciseList
                day={day}
                selectedPosition={current?.position ?? null}
                onSelect={(position) => setPick({ date: selected, position })}
                hint="Select an exercise to edit its sets ↗"
              />
            </View>

            <View className="flex-1 gap-6">
              <StatsCard exercises={day.totals.exercises} sets={day.totals.sets} volumeKg={day.totals.volumeKg} />
              {current ? (
                <View className="rounded-[16px] bg-surface p-6">
                  <Text className="font-sans-semibold text-accent text-[10px] tracking-wider">SET DETAILS</Text>
                  <PanelTitle
                    key={`${selected}:${current.position}:${current.name}`}
                    name={current.name}
                    onRename={(name) => {
                      try {
                        actions.renameExercise({ date: selected, position: current.position, name });
                      } catch (e) {
                        if (!(e instanceof EngineError)) throw e;
                      }
                    }}
                  />
                  <Text className="font-sans text-muted text-[12px] mt-3 mb-5">
                    Record your reps and weight for each set.
                  </Text>
                  {/* Keyed by name too: deleting an exercise shifts the next one into this position. */}
                  <SetsEditor
                    key={`${selected}:${current.position}:${current.name}`}
                    date={selected}
                    position={current.position}
                    readOnly={false}
                    showDone
                    bare
                  />
                  <View className="flex-row items-center gap-2 mt-5">
                    <Icon name="Check" size={14} color={colors.accent} />
                    <Text className="font-sans text-muted text-[11px]">All changes saved automatically</Text>
                  </View>
                </View>
              ) : (
                <View className="rounded-[16px] bg-surface p-6">
                  <Text className="font-sans-semibold text-accent text-[10px] tracking-wider">SET DETAILS</Text>
                  <Text className="font-sans text-muted text-[14px] mt-3">
                    {empty ? 'Add a schedule to plan your routine.' : 'Add an exercise to log its sets.'}
                  </Text>
                </View>
              )}
              {repeats ? (
                <View className="flex-row items-center gap-3">
                  <Icon name="Repeat2" size={16} color={colors.muted} />
                  <Text className="font-sans text-muted text-[13px]">{repeats}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View className="flex-row items-center justify-between mt-auto pt-16">
            <Text className="font-sans text-faint text-[10px] tracking-wider">CONSISTENCY OVER EVERYTHING.</Text>
            <Text className="font-mono text-faint text-[10px] tracking-wider">METRIC / KG</Text>
          </View>
        </View>
      </ScrollView>
      <ScheduleSheet
        mode={schedule?.mode ?? 'add'}
        date={schedule?.date ?? selected}
        day={schedule && schedule.date !== selected ? getDay(state, ctx, schedule.date) : day}
        visible={schedule !== null}
        onClose={() => setSchedule(null)}
      />
      <BackfillSheet date={selected} visible={backfillOpen} onClose={() => setBackfillOpen(false)} />
    </SafeAreaView>
  );
}

/** Exercise name with a Pencil that swaps it for an input; Enter or blur saves, Escape cancels. */
function PanelTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const settled = useRef(true); // Enter, Escape and the blur that follows must not apply twice
  const finish = (apply: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = draft?.trim();
    setDraft(null);
    if (apply && next && next !== name) onRename(next);
  };
  return (
    <View className="flex-row items-center justify-between mt-3">
      {draft !== null ? (
        <TextInput
          autoFocus
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          onChangeText={setDraft}
          onSubmitEditing={() => finish(true)}
          onBlur={() => finish(true)}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Escape') finish(false);
          }}
          selectTextOnFocus
          className="flex-1 min-w-0 h-11 font-sans-medium text-ink text-[28px] p-0"
        />
      ) : (
        <Text className="flex-1 font-sans-medium text-ink text-[28px]" numberOfLines={1}>
          {name}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rename ${name}`}
        onPress={() => {
          settled.current = false;
          setDraft(name);
        }}
        className="w-11 h-11 items-center justify-center"
      >
        <Icon name="Pencil" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}
