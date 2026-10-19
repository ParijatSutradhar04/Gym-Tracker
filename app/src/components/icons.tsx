import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  Check,
  ChevronDown,
  Download,
  Dumbbell,
  FileDown,
  Pencil,
  Repeat2,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { colors } from '../theme';

const ICONS = {
  Dumbbell,
  FileDown,
  Download,
  Pencil,
  X,
  Repeat2,
  ChevronDown,
  CalendarDays,
  CalendarX,
  CalendarPlus,
  ArrowRight,
  ArrowLeft,
  Check,
  ArrowUpRight,
  TriangleAlert,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  const Glyph = ICONS[name];
  return <Glyph size={size} color={color} strokeWidth={1.75} />;
}
