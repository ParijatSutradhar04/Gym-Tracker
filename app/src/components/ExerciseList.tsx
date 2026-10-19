import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useActions } from '../data/hooks';
import { formatCount } from '../engine/dates';
import type { DayView } from '../engine/dayView';
import { EngineError } from '../engine/types';
import { colors } from '../theme';
import { ExerciseTile } from './ExerciseTile';

interface Props {
  day: DayView;
  selectedPosition?: number | null;
  onSelect: (position: number) => void;
  /** Optional line shown under the heading (desktop prompts). */
  hint?: string;
}

/** Engine EMPTY_NAME (and a stale position) are ignored; anything else is a bug and surfaces. */
function ignoreEngineError(fn: () => void) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
  }
}

export function ExerciseList({ day, selectedPosition, onSelect, hint }: Props) {
  const actions = useActions();
  const [name, setName] = useState('');
  if (!day.routine && !day.hasLog) return null;
  const { date } = day;

  const add = () => {
    if (!name.trim()) return;
    ignoreEngineError(() => actions.addExercise({ date, name }));
    setName('');
  };

  return (
    <View className="mt-6">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-sans-semibold text-ink text-[16px]">Exercises</Text>
        {day.routine ? (
          <Text className="font-mono text-muted text-[10px]">
            {formatCount(day.totals.exercises)} exercises / {day.totals.sets} sets
          </Text>
        ) : null}
      </View>
      {hint ? <Text className="font-sans text-muted text-[12px] mb-3">{hint}</Text> : null}
      <View className="gap-2">
        {day.exercises.map((x) => (
          <ExerciseTile
            key={`${x.position}:${x.name}`}
            exercise={x}
            selected={selectedPosition === x.position}
            onPress={() => onSelect(x.position)}
            onRename={(n) => ignoreEngineError(() => actions.renameExercise({ date, position: x.position, name: n }))}
            onDelete={() => ignoreEngineError(() => actions.deleteExercise({ date, position: x.position }))}
          />
        ))}
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
          placeholder="+ Type exercise name…"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          blurOnSubmit={false}
          className="h-14 rounded-[10px] border border-border px-4 font-sans text-ink text-[14px]"
        />
      </View>
    </View>
  );
}
