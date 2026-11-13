import { describe, expect, it } from 'vitest';
import {
  type Furniture,
  type Seat,
  assignProps,
  bearingFrom,
  candidateSpots,
  chooseSpots,
  clampToTop,
  syntheticShelves,
  topOf,
} from './placement.js';
import { createRng } from './rng.js';
import { DEG, distance, quatFromYaw } from './vec.js';

const ID = { x: 0, y: 0, z: 0, w: 1 };
const seat: Seat = { head: { x: 0, y: 1.15, z: 0 }, yaw: 0 };

const room: Furniture[] = [
  // coffee table in front
  { id: 'table', label: 'table', obb: { center: { x: 0, y: 0.22, z: -1.2 }, halfExtents: { x: 0.55, y: 0.22, z: 0.3 }, orientation: ID } },
  // bookshelf on the left
  { id: 'shelf', label: 'shelf', obb: { center: { x: -1.6, y: 0.5, z: -0.6 }, halfExtents: { x: 0.2, y: 0.5, z: 0.45 }, orientation: ID } },
  // side table on the right
  { id: 'side', label: 'table', obb: { center: { x: 1.4, y: 0.3, z: -0.4 }, halfExtents: { x: 0.25, y: 0.3, z: 0.25 }, orientation: ID } },
  // something behind the player (must be ignored: airplane-seat rule)
  { id: 'behind', label: 'storage', obb: { center: { x: 0, y: 0.4, z: 2 }, halfExtents: { x: 0.4, y: 0.4, z: 0.2 }, orientation: ID } },
];

describe('topOf', () => {
  it('finds the upward face of an axis-aligned box', () => {
    const t = topOf(room[0])!;
    expect(t.center.y).toBeCloseTo(0.44);
    expect(t.halfU * t.halfV).toBeCloseTo(0.55 * 0.3);
  });

  it('finds the top of a box whose local Z points up (Quest mesh frames vary)', () => {
    const q = { x: -0.7071068, y: 0, z: 0, w: 0.7071068 }; // local +Z -> world +Y
    const f: Furniture = { id: 'r', label: 'table', obb: { center: { x: 0, y: 0.4, z: -1 }, halfExtents: { x: 0.5, y: 0.3, z: 0.4 }, orientation: q } };
    const t = topOf(f)!;
    expect(t.center.y).toBeCloseTo(0.8);
  });
});

describe('spots', () => {
  const tops = room.map(topOf).filter((t) => t != null);

  it('bearing is + to the right of the seat', () => {
    expect(bearingFrom(seat, { x: 1, y: 1, z: -1 })).toBeCloseTo(45 * DEG);
    expect(bearingFrom(seat, { x: -1, y: 1, z: -1 })).toBeCloseTo(-45 * DEG);
  });

  it('never offers spots behind the seated player', () => {
    const spots = candidateSpots(tops, seat);
    expect(spots.length).toBeGreaterThan(5);
    expect(spots.every((s) => s.topId !== 'behind:top')).toBe(true);
  });

  it('spreads the spirit’s things around the player, not in one clump', () => {
    const chosen = chooseSpots(candidateSpots(tops, seat), 7, createRng(1));
    expect(chosen.length).toBeGreaterThanOrEqual(6);
    const bearings = chosen.map((s) => s.bearing);
    expect(Math.min(...bearings)).toBeLessThan(-40 * DEG);
    expect(Math.max(...bearings)).toBeGreaterThan(40 * DEG);
    for (let i = 0; i < chosen.length; i++)
      for (let j = i + 1; j < chosen.length; j++)
        expect(distance(chosen[i].position, chosen[j].position)).toBeGreaterThan(0.3);
  });

  it('builds its own little shelves in an empty room', () => {
    const shelves = syntheticShelves(seat);
    const chosen = chooseSpots(candidateSpots(shelves, seat), 5, createRng(2), 0.2);
    expect(chosen.length).toBe(5);
  });

  it('puts cups on tables and books on shelves when it can', () => {
    const chosen = chooseSpots(candidateSpots(tops, seat), 6, createRng(3));
    const placed = assignProps(['books', 'teacup'], chosen, tops, { ...seat, yaw: 0 });
    const topLabel = (id: string) => tops.find((t) => t.id === id)!.label;
    expect(topLabel(placed[0].spot.topId)).toBe('shelf');
    expect(topLabel(placed[1].spot.topId)).toBe('table');
  });

  it('clampToTop keeps a slid prop on its surface', () => {
    const t = topOf(room[0])!;
    const p = clampToTop(t, { x: 5, y: 0.44, z: -1.2 });
    expect(p.x).toBeLessThanOrEqual(0.55);
    expect(p.y).toBeCloseTo(0.44);
  });

  it('works with a rotated room', () => {
    const rotated: Furniture = { ...room[0], obb: { ...room[0].obb, orientation: quatFromYaw(30 * DEG) } };
    expect(topOf(rotated)).not.toBeNull();
  });
});
