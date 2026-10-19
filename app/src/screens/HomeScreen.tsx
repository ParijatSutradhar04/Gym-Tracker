import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateBar } from '../components/DateBar';
import { DayBody } from '../components/DayBody';
import { ExportSheet } from '../components/ExportSheet';
import { GymMissedDialog } from '../components/GymMissedDialog';
import { GymMissedFab } from '../components/GymMissedFab';
import { TopBar } from '../components/TopBar';
import { UndoBar } from '../components/UndoBar';
import { useActions, useCtx, useGymState, useGymStore, useToday } from '../data/hooks';
import { getDay } from '../engine/dayView';
import { restorableShift } from '../engine/shift';
import { EngineError } from '../engine/types';

export function HomeScreen() {
  const today = useToday();
  const state = useGymState();
  const store = useGymStore();
  const ctx = useCtx();
  const actions = useActions();
  const [selected, setSelected] = useState(today);
  const [exportOpen, setExportOpen] = useState(false);
  const [missedOpen, setMissedOpen] = useState(false);
  const [undo, setUndo] = useState<{ message: string; shiftId: string } | null>(null);
  const prevToday = useRef(today);
  if (prevToday.current !== today) {
    // Midnight rolled over: a selection that was "today" follows the clock.
    if (selected === prevToday.current) setSelected(today);
    prevToday.current = today;
  }

  const day = getDay(state, ctx, selected);
  // The bar only stands while its shift is still restorable (a schedule edit locks it).
  const undoShiftId = restorableShift(state, ctx)?.id ?? null;
  const showUndo = undo !== null && undo.shiftId === undoShiftId;
  const dismissUndo = useCallback(() => setUndo(null), []);

  const onMissedDone = (message: string) => {
    const shift = restorableShift(store.getState(), ctx);
    if (shift) setUndo({ message, shiftId: shift.id });
  };
  const onUndo = () => {
    if (!undo) return;
    try {
      actions.restoreShift(undo.shiftId);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
    setUndo(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <TopBar onExport={() => setExportOpen(true)} />
      <DateBar selected={selected} onSelect={setSelected} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <DayBody date={selected} />
      </ScrollView>
      <View pointerEvents="box-none" className="absolute inset-0">
        <GymMissedFab visible={day.canGymMissed} onPress={() => setMissedOpen(true)} />
        {showUndo ? <UndoBar message={undo.message} onUndo={onUndo} onExpire={dismissUndo} /> : null}
      </View>
      <GymMissedDialog visible={missedOpen} onClose={() => setMissedOpen(false)} day={day} onDone={onMissedDone} />
      <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} />
    </SafeAreaView>
  );
}
