import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useActions, useCtx, useGymState } from '../data/hooks';
import { clashWarning, previewClashes } from '../engine/clash';
import { MONTH_NAMES, type DateStr } from '../engine/dates';
import type { DayView } from '../engine/dayView';
import { REPEAT_LABELS } from '../engine/repeat';
import { routineTitleSuggestions } from '../engine/scheduleEdits';
import { EngineError, type RepeatRule } from '../engine/types';
import { colors } from '../theme';
import { Button } from './Button';
import { Icon } from './icons';
import { RadioRow } from './RadioRow';
import { Sheet } from './Sheet';

interface Props {
  mode: 'add' | 'change';
  date: DateStr;
  day: DayView;
  visible: boolean;
  onClose: () => void;
}

const RULES = Object.keys(REPEAT_LABELS) as RepeatRule[];

function monDd(date: DateStr): string {
  const [, m, d] = date.split('-');
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${d}`;
}

/** Mounted only while visible, so its form state starts fresh on every open. */
export function ScheduleSheet({ visible, onClose, ...rest }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Repeat schedule" showClose>
      {visible ? <ScheduleForm onClose={onClose} {...rest} /> : null}
    </Sheet>
  );
}

function ScheduleForm({ mode, date, day, onClose }: Omit<Props, 'visible'>) {
  const state = useGymState();
  const ctx = useCtx();
  const actions = useActions();
  const [title, setTitle] = useState(mode === 'change' ? (day.routine?.title ?? '') : '');
  const [rule, setRule] = useState<RepeatRule>(mode === 'change' ? (day.routine?.repeatRule ?? 'weekly') : 'weekly');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const routineId = day.routine?.routineId ?? null;
  const trimmed = title.trim();

  const suggestions = useMemo(
    () => (mode === 'add' && trimmed ? routineTitleSuggestions(state, trimmed).filter((s) => s.title !== trimmed) : []),
    [mode, state, trimmed],
  );

  const warning = useMemo(() => {
    if (!trimmed) return null;
    if (mode === 'change' && !routineId) return null;
    const cmd =
      mode === 'add'
        ? ({ kind: 'add', args: { date, title: trimmed, repeatRule: rule } } as const)
        : ({ kind: 'change', args: { routineId: routineId!, date, title: trimmed, repeatRule: rule } } as const);
    return clashWarning(previewClashes(state, ctx, cmd));
  }, [mode, state, ctx, date, trimmed, rule, routineId]);

  const run = (fn: () => void) => {
    try {
      fn();
      onClose();
    } catch (e) {
      if (e instanceof EngineError && e.code === 'EMPTY_NAME') setError('Enter a routine name.');
      else if (e instanceof EngineError) setError('Could not save this change.');
      else throw e;
    }
  };

  const save = () =>
    run(() => {
      if (mode === 'add') actions.addSchedule({ date, title, repeatRule: rule, exercises: picked ?? undefined });
      else actions.changeSchedule({ routineId: routineId!, date, title, repeatRule: rule });
    });

  const startsLabel = date === ctx.today ? 'today' : monDd(date);

  return (
    <View className="gap-4">
      <Text className="font-sans text-muted text-[12px] -mt-2">
        {trimmed || 'Routine'} · Starts <Text className="font-mono">{startsLabel}</Text>
      </Text>
      <TextInput
        value={title}
        onChangeText={(t) => {
          setTitle(t);
          setPicked(null);
          setError(null);
        }}
        placeholder="Routine name"
        placeholderTextColor={colors.faint}
        autoCapitalize="words"
        className="h-12 rounded-[10px] border border-border bg-bg px-4 font-sans text-ink text-[15px]"
      />
      {suggestions.length > 0 ? (
        <View className="gap-1">
          {suggestions.slice(0, 4).map((s) => (
            <Pressable
              key={s.title}
              accessibilityRole="button"
              onPress={() => {
                setTitle(s.title);
                setPicked(s.exercises);
              }}
              className="h-10 rounded-[8px] bg-surface-2 px-4 justify-center"
            >
              <Text className="font-sans text-ink text-[14px]">{s.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text className="font-sans text-muted text-[12px]">{error}</Text> : null}
      <View className="gap-2" accessibilityRole="radiogroup">
        {RULES.map((r) => (
          <RadioRow key={r} label={REPEAT_LABELS[r]} selected={rule === r} onPress={() => setRule(r)} />
        ))}
      </View>
      {warning ? (
        <View className="flex-row items-start gap-2">
          <Icon name="TriangleAlert" size={14} color={colors.muted} />
          <Text className="font-sans text-muted text-[12px] flex-1">{warning}</Text>
        </View>
      ) : null}
      <Button variant="primary" label="Save recurrence" onPress={save} disabled={!trimmed} />
      {mode === 'change' && routineId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => run(() => actions.stopRoutine({ routineId, date }))}
          className="h-11 items-center justify-center"
        >
          <Text className="font-sans-semibold text-muted text-[14px]">Stop this routine from {monDd(date)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
