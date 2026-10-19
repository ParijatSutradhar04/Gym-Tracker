import type { DateStr } from '../engine/dates';
import { SetsEditor } from './SetsEditor';
import { Sheet } from './Sheet';

interface Props {
  date: DateStr;
  position: number;
  visible: boolean;
  onClose: () => void;
}

/** Closing with X does not sync again: typed values are already saved and untouched pre-fills stay unsaved. */
export function SetsSheet({ date, position, visible, onClose }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} showClose>
      {visible ? (
        <SetsEditor key={`${date}:${position}`} date={date} position={position} readOnly={false} showDone onDone={onClose} />
      ) : null}
    </Sheet>
  );
}
