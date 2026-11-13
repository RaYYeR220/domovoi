/**
 * Between nights: what the domovoi remembers about you.
 *
 * One "official" night per calendar day (everyone gets the same night that
 * day), a streak of days in a row, the spirit's trust, and the small gifts it
 * leaves on your real shelf as trust grows. Practice and shared nights are
 * playable any time but don't move the streak.
 */

import { dateKey, seedForDate } from './rng.js';

export const SAVE_VERSION = 1;

export interface NightRecord {
  date: string;
  seed: number;
  index: number;
  kind: 'official' | 'practice' | 'shared';
  status: 'won' | 'lost';
  caught: number;
  missed: number;
  falseReports: number;
  stars: number;
}

export type GiftKind = 'button' | 'feather' | 'acorn' | 'key' | 'thimble' | 'bell';

export interface Gift {
  kind: GiftKind;
  /** Trust needed. */
  at: number;
  /** One line the spirit "leaves" with it. */
  note: string;
}

export const GIFTS: readonly Gift[] = [
  { kind: 'button', at: 3, note: 'A button. You lost it years ago. It found it.' },
  { kind: 'feather', at: 7, note: 'A feather, for luck.' },
  { kind: 'acorn', at: 12, note: 'An acorn. It thinks you should plant it.' },
  { kind: 'key', at: 18, note: 'A small key. It won’t say to what.' },
  { kind: 'thimble', at: 25, note: 'A thimble. For mending things.' },
  { kind: 'bell', at: 34, note: 'A little bell. Ring it and it will come.' },
];

export interface SaveData {
  v: number;
  nights: NightRecord[];
  settings: {
    eyesOnly: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
    captions: boolean;
  };
  /** Seen the first-night introduction. */
  introduced: boolean;
}

export function emptySave(): SaveData {
  return {
    v: SAVE_VERSION,
    nights: [],
    settings: { eyesOnly: false, reducedMotion: false, highContrast: false, captions: true },
    introduced: false,
  };
}

/** Parse saved JSON defensively: bad or old data never breaks the game. */
export function loadSave(raw: string | null | undefined): SaveData {
  if (!raw) return emptySave();
  try {
    const data = JSON.parse(raw) as Partial<SaveData>;
    const base = emptySave();
    return {
      v: SAVE_VERSION,
      nights: Array.isArray(data.nights) ? data.nights.filter(isRecord) : [],
      settings: { ...base.settings, ...(data.settings ?? {}) },
      introduced: Boolean(data.introduced),
    };
  } catch {
    return emptySave();
  }
}

function isRecord(r: unknown): r is NightRecord {
  const n = r as NightRecord;
  return (
    n != null &&
    typeof n.date === 'string' &&
    typeof n.seed === 'number' &&
    (n.status === 'won' || n.status === 'lost')
  );
}

export const officialNights = (s: SaveData) => s.nights.filter((n) => n.kind === 'official');

/** 1-based index of the next official night (drives which tricks the spirit knows). */
export function nextNightIndex(s: SaveData): number {
  return officialNights(s).length + 1;
}

export function playedToday(s: SaveData, today: string): boolean {
  return officialNights(s).some((n) => n.date === today);
}

export function trust(s: SaveData): number {
  let t = 0;
  for (const n of s.nights) {
    if (n.kind !== 'official') continue;
    t += n.status === 'won' ? 2 + n.stars : 1;
  }
  return t;
}

export function giftsEarned(s: SaveData): Gift[] {
  const t = trust(s);
  return GIFTS.filter((g) => t >= g.at);
}

export function nextGift(s: SaveData): Gift | null {
  const t = trust(s);
  return GIFTS.find((g) => g.at > t) ?? null;
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

/** Consecutive days with an official night, counting back from today (or yesterday). */
export function streak(s: SaveData, today: string): number {
  const days = new Set(officialNights(s).map((n) => n.date));
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = shiftDay(cursor, -1);
  }
  return count;
}

export interface NightPlan {
  seed: number;
  index: number;
  kind: NightRecord['kind'];
  date: string;
}

/** Decide what tonight is: today's official night, a practice night, or a shared one. */
export function planTonight(
  s: SaveData,
  now: Date,
  shared?: { seed: number; index: number } | null,
  practiceSalt = 0,
): NightPlan {
  const today = dateKey(now);
  if (shared) return { seed: shared.seed, index: shared.index, kind: 'shared', date: today };
  if (!playedToday(s, today)) {
    return { seed: seedForDate(today), index: nextNightIndex(s), kind: 'official', date: today };
  }
  return {
    seed: (seedForDate(today) ^ (0x9e3779b9 + practiceSalt * 2654435761)) >>> 0,
    index: Math.max(1, nextNightIndex(s) - 1),
    kind: 'practice',
    date: today,
  };
}

export function recordNight(s: SaveData, record: NightRecord): SaveData {
  return { ...s, nights: [...s.nights, record].slice(-200) };
}

// --- Sharing a night -------------------------------------------------------

/** `?night=<seed36>-<index36>`: the same night, played in someone else's room. */
export function encodeShare(seed: number, index: number): string {
  return `${(seed >>> 0).toString(36)}-${Math.max(1, index).toString(36)}`;
}

export function decodeShare(param: string | null | undefined): { seed: number; index: number } | null {
  if (!param) return null;
  const m = /^([0-9a-z]{1,7})-([0-9a-z]{1,3})$/.exec(param.trim().toLowerCase());
  if (!m) return null;
  const seed = parseInt(m[1], 36);
  const index = parseInt(m[2], 36);
  if (!Number.isFinite(seed) || seed > 0xffffffff || !Number.isFinite(index) || index < 1 || index > 99) return null;
  return { seed: seed >>> 0, index };
}
