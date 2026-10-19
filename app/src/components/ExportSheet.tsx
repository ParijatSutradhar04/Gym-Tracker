import { useState } from 'react';
import { Text, View } from 'react-native';
import { useGymState, useToday } from '../data/hooks';
import { addDays } from '../engine/dates';
import { buildCsv, csvFileName, exportRange, type ExportRangeKind } from '../engine/csv';
import { EngineError } from '../engine/types';
import { saveCsv } from '../export/saveCsv';
import { Button } from './Button';
import { DateField } from './DateField';
import { RadioRow } from './RadioRow';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const OPTIONS: { kind: ExportRangeKind; label: string }[] = [
  { kind: 'last_month', label: 'Last Month' },
  { kind: 'last_3_months', label: 'Last 3 Months' },
  { kind: 'custom', label: 'Custom' },
];

/** Mounted only while visible, so the range resets on every open. */
export function ExportSheet({ visible, onClose }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Export your training" showClose>
      {visible ? <ExportForm onClose={onClose} /> : null}
    </Sheet>
  );
}

function ExportForm({ onClose }: { onClose: () => void }) {
  const state = useGymState();
  const today = useToday();
  const [kind, setKind] = useState<ExportRangeKind>('last_month');
  const [from, setFrom] = useState(() => addDays(today, -30));
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const badRange = kind === 'custom' && from > to;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const range = exportRange(kind, today, { from, to });
      await saveCsv(buildCsv(state, range.from, range.to, today), csvFileName(range.from, range.to));
      onClose();
    } catch (e) {
      if (e instanceof EngineError && e.code !== 'INVALID_RANGE') throw e;
      setError("Couldn't export. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-4">
      <Text className="font-sans text-muted text-[12px] -mt-2">Your workouts, sets and weights. In CSV.</Text>
      <View className="gap-2" accessibilityRole="radiogroup">
        {OPTIONS.map((o) => (
          <RadioRow
            key={o.kind}
            label={o.label}
            selected={kind === o.kind}
            onPress={() => {
              setKind(o.kind);
              setError(null);
            }}
          />
        ))}
      </View>
      {kind === 'custom' ? (
        <View className="gap-3">
          <DateField label="From Date" value={from} onChange={setFrom} maxDate={today} />
          <DateField label="To Date" value={to} onChange={setTo} maxDate={today} />
          {badRange ? <Text className="font-sans text-muted text-[12px]">From date must be before To date.</Text> : null}
        </View>
      ) : null}
      {error ? <Text className="font-sans text-muted text-[12px]">{error}</Text> : null}
      <Button variant="primary" icon="Download" label="Download CSV" onPress={download} disabled={badRange || busy} />
      <Text className="font-sans text-faint text-[10px] text-center">Includes all logged workouts in your selected range.</Text>
    </View>
  );
}
