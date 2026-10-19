// Calendar dates are 'YYYY-MM-DD' strings. All arithmetic goes through Date.UTC so DST never shifts a day.
export type DateStr = string;

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

function toUtcMs(d: DateStr): number {
  const m = DATE_RE.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): DateStr {
  const dt = new Date(ms);
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  return fromUtcMs(toUtcMs(s)) === s;
}

export function addDays(d: DateStr, n: number): DateStr {
  return fromUtcMs(toUtcMs(d) + n * DAY_MS);
}

/** Whole days from a to b (b minus a). */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(d: DateStr): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return ((new Date(toUtcMs(d)).getUTCDay() + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** Moves by n calendar months, clamping the day to the target month's last day. */
export function addMonthsClamped(d: DateStr, n: number): DateStr {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromUtcMs(Date.UTC(ny, nm, Math.min(day, lastDay)));
}

/** Every date from `from` to `to`, inclusive; empty when from > to. */
export function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let ms = toUtcMs(from), end = toUtcMs(to); ms <= end; ms += DAY_MS) out.push(fromUtcMs(ms));
  return out;
}

export function todayLocal(now: Date): DateStr {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function msUntilNextMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

export function formatCount(n: number): string {
  return pad2(n);
}

/** Up to 2 decimals, no trailing zeros: 60 → "60", 22.5 → "22.5". */
export function formatKg(n: number): string {
  return String(Math.round(n * 100) / 100);
}
