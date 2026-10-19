import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Pressable } from 'react-native';
import { todayLocal, type DateStr } from '../engine/dates';
import { DateFieldFace } from './DateFieldFace';

interface Props {
  label: string;
  value: DateStr;
  onChange: (date: DateStr) => void;
  maxDate: DateStr;
}

/** Local-time Date at noon: only used to talk to the native picker, never for schedule math. */
function toPickerDate(date: DateStr): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function DateField({ label, value, onChange, maxDate }: Props) {
  const open = () =>
    DateTimePickerAndroid.open({
      value: toPickerDate(value),
      mode: 'date',
      maximumDate: toPickerDate(maxDate),
      onValueChange: (_event, picked) => onChange(todayLocal(picked)),
    });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={open}>
      <DateFieldFace label={label} value={value} />
    </Pressable>
  );
}
