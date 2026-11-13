import { describe, expect, it } from 'vitest';
import { type BoardSize, type WallPanel, pickBoardSpot } from './board-spot.js';
import type { Furniture } from './placement.js';

const SIZE: BoardSize = { w: 0.8, h: 0.56 };
const head = { x: 0, y: 1.15, z: 0 };
const ID = { x: 0, y: 0, z: 0, w: 1 };

/** The wall in front of the seat: 5 m wide, 2.7 m tall, 3 m ahead, facing the player. */
const front: WallPanel = {
  label: 'wall',
  center: { x: 0, y: 1.35, z: -3 },
  normal: { x: 0, y: 0, z: 1 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  halfW: 2.5,
  halfH: 1.35,
  vertical: true,
};

const box = (label: Furniture['label'], c: [number, number, number], h: [number, number, number]): Furniture => ({
  id: `${label}-${c.join(',')}`,
  label,
  obb: { center: { x: c[0], y: c[1], z: c[2] }, halfExtents: { x: h[0], y: h[1], z: h[2] }, orientation: ID },
});

/** The board's rectangle, for a wall facing +z. */
const boardRect = (at: { x: number; y: number }, s: BoardSize) => ({ x0: at.x - s.w / 2, x1: at.x + s.w / 2, y0: at.y - s.h / 2, y1: at.y + s.h / 2 });

/** Does the board's rectangle on the wall overlap this x-range at heights above `top`? */
const overlapsColumn = (at: { x: number; y: number }, x0: number, x1: number, top: number) =>
  at.x + SIZE.w / 2 > x0 && at.x - SIZE.w / 2 < x1 && at.y - SIZE.h / 2 < top;

describe('pickBoardSpot', () => {
  it('hangs the board on a wall in front of the seat, facing the player', () => {
    const spot = pickBoardSpot([front], [], head, 0, SIZE)!;
    expect(spot).not.toBeNull();
    expect(spot.at.z).toBeGreaterThan(-3);
    expect(spot.at.z).toBeLessThan(-2.9);
    expect(spot.normal.z).toBeGreaterThan(0.99);
  });

  it('never hangs behind a floor lamp standing at the wall', () => {
    const free = pickBoardSpot([front], [], head, 0, SIZE)!;
    // A floor lamp right where the board would go: shade up to 1.6 m, 30 cm off the wall.
    const lamp = box('lamp', [free.at.x, 0.8, -2.7], [0.2, 0.8, 0.2]);
    const spot = pickBoardSpot([front], [lamp], head, 0, SIZE)!;
    expect(spot).not.toBeNull();
    expect(overlapsColumn(spot.at, free.at.x - 0.2, free.at.x + 0.2, 1.6)).toBe(false);
  });

  it('keeps a margin from a lamp standing just beside it, even out of the line of sight', () => {
    const free = pickBoardSpot([front], [], head, 0, SIZE)!;
    // On the far side of the board from the player, touching its edge: the sightlines miss it.
    const out = Math.sign(free.at.x) || 1;
    const lampX = free.at.x + out * (SIZE.w / 2 + 0.06);
    const lamp = box('lamp', [lampX, 0.8, -2.8], [0.05, 0.8, 0.05]);
    const spot = pickBoardSpot([front], [lamp], head, 0, SIZE)!;
    expect(spot).not.toBeNull();
    expect(overlapsColumn(spot.at, lampX - 0.05 - 0.08, lampX + 0.05 + 0.08, 1.6)).toBe(false);
  });

  it('is happy above a low sofa against the wall', () => {
    const free = pickBoardSpot([front], [], head, 0, SIZE)!;
    const sofa = box('couch', [free.at.x, 0.4, -2.55], [1.0, 0.4, 0.45]);
    const spot = pickBoardSpot([front], [sofa], head, 0, SIZE)!;
    expect(spot.at.x).toBeCloseTo(free.at.x, 5);
  });

  it('does not cover a picture or a window on the same wall', () => {
    const free = pickBoardSpot([front], [], head, 0, SIZE)!;
    const art: WallPanel = { ...front, label: 'wall_art', center: { x: free.at.x, y: free.at.y, z: -2.99 }, halfW: 0.4, halfH: 0.3 };
    const spot = pickBoardSpot([front, art], [], head, 0, SIZE)!;
    const r = boardRect(spot.at, SIZE);
    const clear = r.x1 < art.center.x - art.halfW || r.x0 > art.center.x + art.halfW || r.y1 < art.center.y - art.halfH || r.y0 > art.center.y + art.halfH;
    expect(clear).toBe(true);
  });

  it('keeps a clear line of sight from the seat', () => {
    const free = pickBoardSpot([front], [], head, 0, SIZE)!;
    // A tall bookcase in the middle of the room, between the seat and that spot.
    const mid = { x: free.at.x / 2, z: free.at.z / 2 };
    const shelf = box('shelf', [mid.x, 1.0, mid.z], [0.45, 1.0, 0.2]);
    const spot = pickBoardSpot([front], [shelf], head, 0, SIZE)!;
    expect(spot).not.toBeNull();
    expect(Math.abs(spot.at.x - free.at.x)).toBeGreaterThan(0.3);
  });

  it('fits a smaller board on a kitchen backsplash, between the counter and the wall cabinets', () => {
    // Counter along the whole wall (top 0.96 m), wall cabinets above it from 1.54 m: a 58 cm gap.
    const counter = box('table', [0, 0.5, -2.7], [2.5, 0.46, 0.3]);
    const cabinets = box('shelf', [0, 1.9, -2.82], [2.5, 0.36, 0.18]);
    const spot = pickBoardSpot([front], [counter, cabinets], head, 0, SIZE)!;
    expect(spot).not.toBeNull();
    expect(spot.scale).toBeLessThan(1);
    const half = (SIZE.h * spot.scale) / 2;
    expect(spot.at.y - half).toBeGreaterThan(0.96);
    expect(spot.at.y + half).toBeLessThan(1.54);
  });

  it('keeps the full-size board whenever one fits', () => {
    expect(pickBoardSpot([front], [], head, 0, SIZE)!.scale).toBe(1);
  });

  it('uses the far wall of a long room when it is the only free one', () => {
    const far: WallPanel = { ...front, center: { x: 0, y: 1.35, z: -5.8 } };
    const spot = pickBoardSpot([far], [], head, 0, SIZE);
    expect(spot).not.toBeNull();
    expect(spot!.at.z).toBeGreaterThan(-5.8);
  });

  it('turns a wall normal that points away from the room toward the player', () => {
    const flipped: WallPanel = { ...front, normal: { x: 0, y: 0, z: -1 }, right: { x: -1, y: 0, z: 0 } };
    const spot = pickBoardSpot([flipped], [], head, 0, SIZE)!;
    expect(spot.normal.z).toBeGreaterThan(0.99);
    expect(spot.at.z).toBeGreaterThan(-3);
  });

  it('gives up when no wall has a free stretch', () => {
    const lamps = Array.from({ length: 21 }, (_, i) => box('lamp', [-2.5 + i * 0.25, 1.2, -2.7], [0.15, 1.2, 0.15]));
    expect(pickBoardSpot([front], lamps, head, 0, SIZE)).toBeNull();
    expect(pickBoardSpot([], [], head, 0, SIZE)).toBeNull();
  });
});
