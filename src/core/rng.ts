/**
 * Deterministic randomness. A night is a pure function of its seed, so the same
 * night can be replayed, shared as a link, and tested.
 */

export type Rng = () => number;

/** mulberry32: small, fast, good enough for gameplay. Returns [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The seed of "tonight" for everyone on the same calendar date. */
export function seedForDate(key: string): number {
  return hashString(`domovoi:${key}`);
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function int(rng: Rng, min: number, maxInclusive: number): number {
  return Math.floor(range(rng, min, maxInclusive + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from an empty list');
  return items[Math.floor(rng() * items.length)];
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Picks an item with probability proportional to its weight. */
export function weightedPick<T>(
  rng: Rng,
  items: readonly T[],
  weight: (item: T) => number,
): T | undefined {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const item of items) {
    r -= Math.max(0, weight(item));
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
