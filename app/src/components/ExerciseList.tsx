import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useActions, useGymState } from '../data/hooks';
import { formatCount, type DateStr } from '../engine/dates';
import type { DayView, ExerciseView } from '../engine/dayView';
import { MAX_NAME_LENGTH } from '../engine/names';
import { setsLostOnDelete } from '../engine/scheduleEdits';
import { EngineError } from '../engine/types';
import { colors } from '../theme';
import { Button } from './Button';
import { Dialog } from './Dialog';
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
  const state = useGymState();
  const actions = useActions();
  const [name, setName] = useState('');
  // A delete that would take logged sets with it asks first; nothing else does.
  const [confirm, setConfirm] = useState<{ date: DateStr; position: number; name: string; sets: number } | null>(null);
  if (!day.routine && !day.hasLog) return null;
  const { date } = day;

  const remove = (x: ExerciseView) => {
    const sets = setsLostOnDelete(state, date, x.position);
    if (sets > 0) setConfirm({ date, position: x.position, name: x.name, sets });
    else ignoreEngineError(() => actions.deleteExercise({ date, position: x.position }));
  };

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
            onDelete={() => remove(x)}
          />
        ))}
        <TextInput
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChangeText={setName}
          onSubmitEditing={add}
          placeholder="+ Type exercise name…"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          blurOnSubmit={false}
          className="h-14 rounded-[10px] border border-border px-4 font-sans text-ink text-[14px]"
        />
      </View>
      <Dialog visible={confirm !== null} onClose={() => setConfirm(null)}>
        {confirm ? (
          <View className="gap-4">
            <Text className="font-sans-medium text-ink text-[22px]">Delete {confirm.name}?</Text>
            <Text className="font-sans text-muted text-[14px] leading-5">
              This also deletes {confirm.sets === 1 ? '1 logged set' : `${confirm.sets} logged sets`} from this day.
            </Text>
            <Button
              variant="primary"
              label="Delete"
              onPress={() => {
                ignoreEngineError(() => actions.deleteExercise({ date: confirm.date, position: confirm.position }));
                setConfirm(null);
              }}
            />
            <Button variant="secondary" label="Cancel" onPress={() => setConfirm(null)} />
          </View>
        ) : null}
      </Dialog>
    </View>
  );
}
