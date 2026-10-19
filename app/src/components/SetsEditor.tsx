import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useActions, useCtx, useGymState } from '../data/hooks';
import { formatKg, type DateStr } from '../engine/dates';
import { getSetsSheet, parseRepsInput, parseWeightInput, type SetDraft } from '../engine/sets';
import { colors } from '../theme';
import { Button } from './Button';
import { Icon } from './icons';

interface Props {
  date: DateStr;
  position: number;
  showDone: boolean;
  readOnly: boolean;
  onDone?: () => void;
}

interface Row {
  draft: SetDraft;
  repsText: string;
  kgText: string;
  repsBad: boolean;
  kgBad: boolean;
}

const toRow = (draft: SetDraft): Row => ({
  draft,
  repsText: draft.reps === null ? '' : String(draft.reps),
  kgText: draft.weightKg === null ? '' : formatKg(draft.weightKg),
  repsBad: false,
  kgBad: false,
});

/** Shared body of the mobile sheet and the desktop panel. Key it by date + position. */
export function SetsEditor({ date, position, showDone, readOnly, onDone }: Props) {
  const state = useGymState();
  const ctx = useCtx();
  const actions = useActions();
  const [info] = useState(() => getSetsSheet(state, ctx, date, position));
  const [rows, setRows] = useState<Row[]>(() => info.rows.map(toRow));
  const locked = readOnly || info.readOnly;

  const sync = (next: Row[], includeUntouched: boolean) =>
    actions.syncSets({ date, position, rows: next.map((r) => r.draft), includeUntouched });

  const commit = (next: Row[]) => {
    setRows(next);
    sync(next, false);
  };

  const edit = (i: number, field: 'reps' | 'kg', text: string) => {
    const row = rows[i];
    const parsed = field === 'reps' ? parseRepsInput(text) : parseWeightInput(text);
    const bad = parsed === 'invalid';
    const draft: SetDraft = bad
      ? row.draft
      : { ...row.draft, touched: true, ...(field === 'reps' ? { reps: parsed } : { weightKg: parsed }) };
    const updated: Row =
      field === 'reps' ? { ...row, draft, repsText: text, repsBad: bad } : { ...row, draft, kgText: text, kgBad: bad };
    commit(rows.map((r, j) => (j === i ? updated : r)));
  };

  const addSet = () => {
    const last = rows[rows.length - 1]?.draft;
    setRows([...rows, toRow({ reps: last?.reps ?? null, weightKg: last?.weightKg ?? null, touched: false })]);
  };

  const done = () => {
    sync(rows, true);
    onDone?.();
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 640 }}>
      <View className="pr-12">
        <Text className="font-sans-semibold text-accent text-[10px] tracking-wider uppercase">{info.routineTitle}</Text>
        <Text className="font-sans-medium text-ink text-[28px] mt-1">{info.exerciseName}</Text>
      </View>
      <Text className="font-sans text-muted text-[12px] mt-3 mb-5">Dial in your reps. Build on your last set.</Text>
      <View className="gap-3">
        {rows.map((r, i) => (
          <View key={i}>
            <View className="flex-row items-center gap-2">
              <Text className="font-sans text-muted text-[12px] w-9">Set {i + 1}</Text>
              <Field
                value={r.repsText}
                suffix="Reps"
                keyboardType="number-pad"
                disabled={locked}
                onChangeText={(t) => edit(i, 'reps', t)}
              />
              <Field
                value={r.kgText}
                suffix="kg"
                keyboardType="decimal-pad"
                disabled={locked}
                onChangeText={(t) => edit(i, 'kg', t)}
              />
              {locked ? (
                <View className="w-11" />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete set ${i + 1}`}
                  onPress={() => commit(rows.filter((_, j) => j !== i))}
                  className="w-11 h-11 items-center justify-center"
                >
                  <Icon name="X" size={18} color={colors.ink} />
                </Pressable>
              )}
            </View>
            {r.repsBad || r.kgBad ? (
              <Text className="font-sans text-muted text-[11px] ml-11 mt-1">Invalid</Text>
            ) : null}
          </View>
        ))}
      </View>
      {locked ? (
        <Text className="font-sans text-muted text-[12px] mt-5 text-center">Sets can be logged on the day.</Text>
      ) : (
        <View className="gap-3 mt-5">
          <Pressable
            accessibilityRole="button"
            onPress={addSet}
            className="h-[52px] rounded-[10px] border border-border items-center justify-center"
          >
            <Text className="font-sans-semibold text-accent text-[15px]">+ Add Set</Text>
          </Pressable>
          {showDone ? <Button variant="primary" label="Done" onPress={done} /> : null}
        </View>
      )}
    </ScrollView>
  );
}

interface FieldProps {
  value: string;
  suffix: string;
  keyboardType: 'number-pad' | 'decimal-pad';
  disabled: boolean;
  onChangeText: (t: string) => void;
}

function Field({ value, suffix, keyboardType, disabled, onChangeText }: FieldProps) {
  return (
    <View className={`flex-1 h-12 rounded-[10px] border border-border bg-bg flex-row items-center px-3 ${disabled ? 'opacity-50' : ''}`}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        keyboardType={keyboardType}
        selectTextOnFocus
        placeholderTextColor={colors.faint}
        accessibilityLabel={suffix}
        className="flex-1 font-mono text-ink text-[22px] p-0"
      />
      <Text className="font-sans text-muted text-[11px] ml-1">{suffix}</Text>
    </View>
  );
}
