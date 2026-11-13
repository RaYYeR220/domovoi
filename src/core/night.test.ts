import { describe, expect, it } from 'vitest';
import type { AnomalyPlan, Candidate } from './anomalies.js';
import { Night, type NightEvent, type RoomView } from './night.js';

/** A fake room: a fixed set of things, some of which are "out of sight". */
function fakeRoom(opts: { unseen?: string[]; refuse?: (p: AnomalyPlan) => boolean } = {}) {
  const props: Candidate[] = [
    { id: 'cup', source: 'prop', propKind: 'teacup', unseenFor: 0 },
    { id: 'candle', source: 'prop', propKind: 'candle', unseenFor: 0 },
    { id: 'books', source: 'prop', propKind: 'books', unseenFor: 0 },
    { id: 'clock', source: 'prop', propKind: 'clock', unseenFor: 0 },
    { id: 'lamp', source: 'real', label: 'lamp', unseenFor: 0 },
    { id: 'table', source: 'real', label: 'table', unseenFor: 0 },
  ];
  const unseen = new Set(opts.unseen ?? props.map((p) => p.id));
  const applied: AnomalyPlan[] = [];
  const room: RoomView & { applied: AnomalyPlan[]; setUnseen(ids: string[]): void } = {
    applied,
    setUnseen(ids) {
      unseen.clear();
      ids.forEach((i) => unseen.add(i));
    },
    candidates: () =>
      props.map((p) => ({ ...p, unseenFor: unseen.has(p.id) ? 10 : 0 })),
    apply: (plan) => {
      if (opts.refuse?.(plan)) return false;
      applied.push(plan);
      return true;
    },
  };
  return room;
}

function run(night: Night, room: RoomView, seconds: number, step = 0.25): NightEvent[] {
  const out: NightEvent[] = [];
  for (let t = 0; t < seconds; t += step) out.push(...night.tick(step, room));
  return out;
}

const tricksOf = (events: NightEvent[]) =>
  events.filter((e): e is Extract<NightEvent, { type: 'trick' }> => e.type === 'trick').map((e) => e.plan);

describe('Night', () => {
  it('is deterministic for a seed (same night for everyone today)', () => {
    const a = run(new Night({ seed: 42, nightIndex: 3 }), fakeRoom(), 200);
    const b = run(new Night({ seed: 42, nightIndex: 3 }), fakeRoom(), 200);
    expect(tricksOf(a)).toEqual(tricksOf(b));
    const c = run(new Night({ seed: 43, nightIndex: 3 }), fakeRoom(), 200);
    expect(tricksOf(c)).not.toEqual(tricksOf(a));
  });

  it('never touches something the player can see', () => {
    const room = fakeRoom({ unseen: ['books'] });
    const tricks = tricksOf(run(new Night({ seed: 7, nightIndex: 1, loseAt: 99 }), room, 120));
    expect(tricks.length).toBeGreaterThan(0);
    // The only unseen thing is the books; once busy, nothing else may be touched.
    for (const t of tricks) expect(t.targetId).toBe('books');
    expect(tricks.length).toBe(1);
  });

  it('waits while everything is in view, then strikes when the player looks away', () => {
    const room = fakeRoom({ unseen: [] });
    const night = new Night({ seed: 1, nightIndex: 1 });
    expect(tricksOf(run(night, room, 60))).toHaveLength(0);
    room.setUnseen(['cup']);
    const later = tricksOf(run(night, room, 2));
    expect(later).toHaveLength(1);
    expect(later[0].targetId).toBe('cup');
  });

  it('the first-night tutorial can force the opening trick', () => {
    const night = new Night({ seed: 9, nightIndex: 1, firstKind: 'state' });
    const first = tricksOf(run(night, fakeRoom(), 30))[0];
    expect(first.kind).toBe('state');
    expect(first.targetId).toBe('candle');
  });

  it('only uses tricks the spirit has learned by this night', () => {
    const tricks = tricksOf(run(new Night({ seed: 3, nightIndex: 1, loseAt: 99 }), fakeRoom(), 420));
    for (const t of tricks) expect(['vanish', 'appear', 'shift', 'turn', 'state', 'lamp-on']).toContain(t.kind);
  });

  it('catching a change resolves it; an empty photo is a false report', () => {
    const night = new Night({ seed: 5, nightIndex: 1, loseAt: 99 });
    const room = fakeRoom();
    const [first] = tricksOf(run(night, room, 20));
    expect(night.active.size).toBe(1);
    const miss = night.report(['nothing-here']);
    expect(miss[0].type).toBe('nothing');
    const hit = night.report([first.targetId]);
    expect(hit[0].type).toBe('caught');
    expect(night.active.size).toBe(0);
  });

  it('a room with too many unresolved changes tips and the night is lost', () => {
    const night = new Night({ seed: 11, nightIndex: 1, loseAt: 3, gapStart: 2, gapEnd: 2 });
    const events = run(night, fakeRoom(), 60);
    const end = events.find((e) => e.type === 'end');
    expect(end && end.type === 'end' && end.result.status).toBe('lost');
    expect(night.status).toBe('lost');
  });

  it('reaching dawn wins, and a clean night earns three stars', () => {
    const night = new Night({ seed: 21, nightIndex: 1, duration: 120 });
    const room = fakeRoom();
    let end: NightEvent | undefined;
    for (let t = 0; t < 130 && !end; t += 0.5) {
      for (const e of night.tick(0.5, room)) {
        if (e.type === 'trick') night.report([e.plan.targetId]);
        if (e.type === 'end') end = e;
      }
    }
    expect(end?.type).toBe('end');
    if (end?.type === 'end') {
      expect(end.result.status).toBe('won');
      expect(end.result.missed).toBe(0);
      expect(end.result.stars).toBe(3);
    }
  });

  it('gets bolder through the night (shorter gaps late)', () => {
    const night = new Night({ seed: 8, nightIndex: 2, loseAt: 999 });
    const room = fakeRoom();
    const times: number[] = [];
    for (let t = 0; t < 420; t += 0.25) {
      for (const e of night.tick(0.25, room)) {
        if (e.type === 'trick') {
          times.push(e.plan.at);
          night.report([e.plan.targetId]); // keep targets free
        }
      }
    }
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const early = gaps.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const late = gaps.slice(-3).reduce((a, b) => a + b, 0) / 3;
    expect(late).toBeLessThan(early);
  });

  it('rarely repeats the same trick twice in a row', () => {
    const night = new Night({ seed: 12, nightIndex: 3, loseAt: 999 });
    const room = fakeRoom();
    const kinds: string[] = [];
    for (let t = 0; t < 420; t += 0.25) {
      for (const e of night.tick(0.25, room)) {
        if (e.type === 'trick') {
          kinds.push(e.plan.kind);
          night.report([e.plan.targetId]);
        }
      }
    }
    const repeats = kinds.slice(1).filter((k, i) => k === kinds[i]).length;
    expect(kinds.length).toBeGreaterThan(10);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(5);
    expect(repeats / kinds.length).toBeLessThan(0.2);
  });

  it('skips a trick the room cannot host and tries another', () => {
    const room = fakeRoom({ refuse: (p) => p.kind === 'shift' });
    const tricks = tricksOf(run(new Night({ seed: 4, nightIndex: 1, loseAt: 99 }), room, 300));
    expect(tricks.length).toBeGreaterThan(3);
    expect(tricks.every((t) => t.kind !== 'shift')).toBe(true);
  });
});
