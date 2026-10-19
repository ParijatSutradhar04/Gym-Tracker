import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useActions, useCtx, useGymState } from '../data/hooks';
import { addDays, MONTH_NAMES, WEEKDAY_FULL, weekdayIndex } from '../engine/dates';
import type { DayView } from '../engine/dayView';
import { previewShift } from '../engine/shift';
import { EngineError } from '../engine/types';
import { colors, accentTint } from '../theme';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './icons';
import { IconButton } from './IconButton';

type Mode = 'catch_up' | 'permanent';

interface Props {
  visible: boolean;
  onClose: () => void;
  day: DayView;
  /** Called after Skip or Shift succeeds, with the toast message for the Undo bar. */
  onDone?: (message: string) => void;
}

function longDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${WEEKDAY_FULL[weekdayIndex(date)]}, ${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${d}`;
}

/** Mounted only while visible, so it always opens on step 1. */
export function GymMissedDialog({ visible, onClose, day, onDone }: Props) {
  return (
    <Dialog visible={visible} onClose={onClose}>
      {visible ? <DialogBody onClose={onClose} day={day} onDone={onDone} /> : null}
    </Dialog>
  );
}

function DialogBody({ onClose, day, onDone }: Omit<Props, 'visible'>) {
  const state = useGymState();
  const ctx = useCtx();
  const actions = useActions();
  const [step, setStep] = useState<'choose' | 'shift'>('choose');
  const [mode, setMode] = useState<Mode>('catch_up');

  const run = (fn: () => void, message: string) => {
    try {
      fn();
    } catch (e) {
      // The day changed under us (logged a set, midnight): nothing to do any more.
      if (!(e instanceof EngineError)) throw e;
      onClose();
      return;
    }
    onClose();
    onDone?.(message);
  };

  if (step === 'shift') {
    return (
      <View className="gap-4">
        <View className="flex-row items-center justify-between">
          <IconButton icon="ArrowLeft" onPress={() => setStep('choose')} accessibilityLabel="Back" />
          <IconButton icon="X" onPress={onClose} accessibilityLabel="Close" />
        </View>
        <Text className="font-sans-medium text-ink text-[26px]">Shift Day</Text>
        <View className="gap-2" accessibilityRole="radiogroup">
          <ModeCard
            label="Catch up this week"
            text={previewShift(state, ctx, 'catch_up').text}
            selected={mode === 'catch_up'}
            onPress={() => setMode('catch_up')}
          />
          <ModeCard
            label="Move my split for good"
            text={previewShift(state, ctx, 'permanent').text}
            selected={mode === 'permanent'}
            onPress={() => setMode('permanent')}
          />
        </View>
        <Button variant="primary" label="Shift" onPress={() => run(() => actions.shiftToday(mode), 'Routine shifted')} />
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <View className="w-12 h-12 rounded-[10px] bg-surface-2 items-center justify-center">
          <Icon name="CalendarX" size={22} color={colors.accent} />
        </View>
        <IconButton icon="X" onPress={onClose} accessibilityLabel="Close" />
      </View>
      <Text className="font-sans-medium text-ink text-[26px]">Missed the gym?</Text>
      <Text className="font-sans text-muted text-[14px] leading-5 -mt-2">
        Life happens. Choose what to do with today's {day.routine?.title ?? ''} routine.
      </Text>
      <Pressable accessibilityRole="button" onPress={() => setStep('shift')} className="rounded-[10px] bg-accent p-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-medium text-on-accent text-[17px]">Shift Day</Text>
          <Icon name="ArrowRight" size={20} color={colors.onAccent} />
        </View>
        <Text className="font-sans text-on-accent text-[13px] leading-5 mt-2">
          Move today's routine forward by 1 day, to {longDate(addDays(day.date, 1))}.
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => run(() => actions.skipToday(), 'Today skipped')}
        className="rounded-[10px] bg-surface-2 p-4"
      >
        <Text className="font-sans-semibold text-ink text-[17px]">Skip</Text>
        <Text className="font-sans text-muted text-[13px] leading-5 mt-2">
          Mark today inactive. Keep the rest of your schedule as it is.
        </Text>
      </Pressable>
    </View>
  );
}

function ModeCard({ label, text, selected, onPress }: { label: string; text: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={selected ? { backgroundColor: accentTint } : undefined}
      className={`rounded-[10px] p-4 border ${selected ? 'border-accent' : 'border-transparent bg-surface-2'}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className={`text-[14px] ${selected ? 'font-sans-semibold text-accent' : 'font-sans text-ink'}`}>{label}</Text>
        <View
          className={`w-5 h-5 rounded-full items-center justify-center border-[1.5px] ${selected ? 'border-accent' : 'border-faint'}`}
        >
          {selected ? <View className="w-2.5 h-2.5 rounded-full bg-accent" /> : null}
        </View>
      </View>
      <Text className="font-sans text-muted text-[12px] leading-[18px] mt-2">{text}</Text>
    </Pressable>
  );
}
