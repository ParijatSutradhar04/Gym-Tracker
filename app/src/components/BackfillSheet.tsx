import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useActions } from '../data/hooks';
import { MONTH_NAMES, type DateStr } from '../engine/dates';
import { MAX_NAME_LENGTH } from '../engine/names';
import { EngineError } from '../engine/types';
import { colors } from '../theme';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface Props {
  date: DateStr;
  visible: boolean;
  onClose: () => void;
}

function monDd(date: DateStr): string {
  const [, m, d] = date.split('-');
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${d}`;
}

/** Mounted only while visible, so the title starts blank on every open. */
export function BackfillSheet({ date, visible, onClose }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Log a workout" showClose>
      {visible ? <BackfillForm date={date} onClose={onClose} /> : null}
    </Sheet>
  );
}

function BackfillForm({ date, onClose }: Omit<Props, 'visible'>) {
  const actions = useActions();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    try {
      actions.startBackfill({ date, title });
      onClose();
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      setError(e.code === 'EMPTY_NAME' ? 'Enter a workout name.' : 'Could not log a workout on this day.');
    }
  };

  return (
    <View className="gap-4">
      <Text className="font-sans text-muted text-[12px] -mt-2">
        <Text className="font-mono">{monDd(date)}</Text> · One-off
      </Text>
      <TextInput
        value={title}
        maxLength={MAX_NAME_LENGTH}
        onChangeText={(t) => {
          setTitle(t);
          setError(null);
        }}
        placeholder="Workout name"
        placeholderTextColor={colors.faint}
        autoCapitalize="words"
        className="h-12 rounded-[10px] border border-border bg-bg px-4 font-sans text-ink text-[15px]"
      />
      {error ? <Text className="font-sans text-muted text-[12px]">{error}</Text> : null}
      <Button variant="primary" label="Start logging" onPress={start} disabled={!title.trim()} />
    </View>
  );
}
