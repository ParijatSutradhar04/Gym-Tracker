import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ExerciseView } from '../engine/dayView';
import { MAX_NAME_LENGTH } from '../engine/names';
import { accentTint, colors } from '../theme';
import { Icon } from './icons';

interface Props {
  exercise: ExerciseView;
  selected?: boolean;
  onPress: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

export function ExerciseTile({ exercise, selected, onPress, onRename, onDelete }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const settled = useRef(true); // Enter, Escape and the blur that follows must not apply twice

  const start = () => {
    settled.current = false;
    setDraft(exercise.name);
  };
  const finish = (apply: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = draft?.trim();
    setDraft(null);
    if (apply && name && name !== exercise.name) onRename(name);
  };

  return (
    <View
      style={selected ? { backgroundColor: accentTint } : undefined}
      className={`h-16 rounded-[10px] pl-[14px] pr-1 flex-row items-center border ${
        selected ? 'border-accent' : 'border-transparent bg-surface'
      }`}
    >
      {editing ? (
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
          className="flex-1 min-w-0 h-10 font-sans-semibold text-ink text-[14px]"
        />
      ) : (
        <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 justify-center h-full">
          <Text className="font-sans-semibold text-ink text-[14px]" numberOfLines={1}>
            {exercise.name}
          </Text>
          <Text className="font-mono text-muted text-[10px] mt-1" numberOfLines={1}>
            {exercise.summary}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rename ${exercise.name}`}
        onPress={start}
        className="w-11 h-11 items-center justify-center"
      >
        <Icon name="Pencil" size={18} color={colors.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${exercise.name}`}
        onPress={onDelete}
        className="w-11 h-11 items-center justify-center"
      >
        <Icon name="X" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}
