/**
 * Ids derived from what a row is rather than from a random draw, so two devices that log the same day
 * offline write the same rows and last-write-wins merges them instead of showing every tile twice.
 *
 * The hash is cyrb128 over the UTF-16 code units of `kind:key`, laid out as an RFC 9562 version-8
 * (custom) UUID. It is not cryptographic and doesn't need to be: the keys are the user's own dates and
 * ids. Changing it changes every derived id, so devices on different app versions would stop
 * converging; the test pins one value for that reason.
 */
export type StableKind = 'day' | 'day_exercise' | 'set';

function cyrb128(s: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Lowercase UUID for a day (`date`), a snapshotted day exercise (`date|name|occurrence`) or a set (`dayExerciseId|setNumber`). */
export function stableId(kind: StableKind, key: string): string {
  const hex = cyrb128(kind + ':' + key)
    .map((h) => h.toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
