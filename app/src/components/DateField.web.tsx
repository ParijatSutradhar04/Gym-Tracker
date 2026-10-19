import { View } from 'react-native';
import type { DateStr } from '../engine/dates';
import { DateFieldFace } from './DateFieldFace';

interface Props {
  label: string;
  value: DateStr;
  onChange: (date: DateStr) => void;
  maxDate: DateStr;
}

/** The native `<input type="date">` sits invisibly over the field so the browser's own picker opens. */
export function DateField({ label, value, onChange, maxDate }: Props) {
  return (
    <View>
      <DateFieldFace label={label} value={value} />
      <input
        type="date"
        aria-label={label}
        value={value}
        max={maxDate}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        onClick={(e) => e.currentTarget.showPicker?.()}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
      />
    </View>
  );
}
