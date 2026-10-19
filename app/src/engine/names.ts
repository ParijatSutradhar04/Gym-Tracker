import { EngineError } from './types';

/** The server's limit on a routine, workout or exercise name, in characters (code points). */
export const MAX_NAME_LENGTH = 200;

export function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

/** The name trimmed; throws when that leaves nothing, or more than the server takes. */
export function requireName(name: string): string {
  const t = name.trim();
  if (!t) throw new EngineError('EMPTY_NAME');
  if ([...t].length > MAX_NAME_LENGTH) throw new EngineError('NAME_TOO_LONG');
  return t;
}
