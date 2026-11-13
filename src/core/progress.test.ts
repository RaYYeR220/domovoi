import { describe, expect, it } from 'vitest';
import {
  type NightRecord,
  decodeShare,
  emptySave,
  encodeShare,
  giftsEarned,
  loadSave,
  nextGift,
  nextNightIndex,
  planTonight,
  recordNight,
  streak,
  trust,
} from './progress.js';
import { seedForDate } from './rng.js';

const rec = (date: string, over: Partial<NightRecord> = {}): NightRecord => ({
  date,
  seed: 1,
  index: 1,
  kind: 'official',
  status: 'won',
  caught: 5,
  missed: 0,
  falseReports: 0,
  stars: 3,
  ...over,
});

describe('save data', () => {
  it('survives garbage and missing fields', () => {
    expect(loadSave('not json').nights).toEqual([]);
    expect(loadSave(null).settings.captions).toBe(true);
    const partial = loadSave(JSON.stringify({ nights: [rec('2026-11-10'), { junk: 1 }], settings: { eyesOnly: true } }));
    expect(partial.nights).toHaveLength(1);
    expect(partial.settings.eyesOnly).toBe(true);
    expect(partial.settings.captions).toBe(true);
  });
});

describe('tonight', () => {
  const now = new Date(2026, 10, 13, 21, 0); // 13 Nov 2026, evening

  it('the first night of the day is the same official night for everyone', () => {
    const p = planTonight(emptySave(), now);
    expect(p.kind).toBe('official');
    expect(p.seed).toBe(seedForDate('2026-11-13'));
    expect(p.index).toBe(1);
  });

  it('after tonight’s official night, more play is practice', () => {
    const s = recordNight(emptySave(), rec('2026-11-13'));
    const p = planTonight(s, now);
    expect(p.kind).toBe('practice');
    expect(p.seed).not.toBe(seedForDate('2026-11-13'));
  });

  it('a shared link plays the sharer’s night', () => {
    const p = planTonight(emptySave(), now, { seed: 1234, index: 4 });
    expect(p).toMatchObject({ kind: 'shared', seed: 1234, index: 4 });
  });

  it('each official night teaches the spirit new tricks', () => {
    let s = emptySave();
    s = recordNight(s, rec('2026-11-11'));
    s = recordNight(s, rec('2026-11-12', { kind: 'practice' }));
    expect(nextNightIndex(s)).toBe(2);
  });
});

describe('streak, trust and gifts', () => {
  it('counts consecutive days back from today or yesterday', () => {
    let s = emptySave();
    for (const d of ['2026-11-09', '2026-11-11', '2026-11-12']) s = recordNight(s, rec(d));
    expect(streak(s, '2026-11-13')).toBe(2); // 12 and 11; 10 missing
    s = recordNight(s, rec('2026-11-13'));
    expect(streak(s, '2026-11-13')).toBe(3);
    expect(streak(s, '2026-11-15')).toBe(0);
  });

  it('streak handles month boundaries', () => {
    let s = emptySave();
    for (const d of ['2026-10-30', '2026-10-31', '2026-11-01']) s = recordNight(s, rec(d));
    expect(streak(s, '2026-11-01')).toBe(3);
  });

  it('trust grows with nights and unlocks gifts in order', () => {
    let s = emptySave();
    expect(giftsEarned(s)).toHaveLength(0);
    expect(nextGift(s)?.kind).toBe('button');
    s = recordNight(s, rec('2026-11-12', { stars: 1 })); // +3
    expect(trust(s)).toBe(3);
    expect(giftsEarned(s).map((g) => g.kind)).toEqual(['button']);
    s = recordNight(s, rec('2026-11-13', { status: 'lost', stars: 0 })); // +1
    expect(trust(s)).toBe(4);
  });
});

describe('share links', () => {
  it('round-trips a night', () => {
    const code = encodeShare(seedForDate('2026-11-13'), 3);
    expect(decodeShare(code)).toEqual({ seed: seedForDate('2026-11-13'), index: 3 });
  });

  it('rejects junk', () => {
    expect(decodeShare('')).toBeNull();
    expect(decodeShare('<script>')).toBeNull();
    expect(decodeShare('zzzzzzzz-1')).toBeNull();
    expect(decodeShare('abc-0')).toBeNull();
  });
});
