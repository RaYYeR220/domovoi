/**
 * Where the spirit puts things.
 *
 * Turns the room's furniture boxes into flat "tops" (table tops, shelf tops,
 * the couch seat…) and picks spots spread around the seated player, so that at
 * any moment some of the spirit's things are out of view. If the room has no
 * usable furniture, the spirit hangs a few little shelves of its own.
 */

import type { Obb } from './attention.js';
import type { PropKind, RealLabel } from './anomalies.js';
import { type Rng, shuffle } from './rng.js';
import {
  type Quat,
  type V3,
  addScaled,
  distance,
  dot,
  rotate,
  sub,
  v3,
  yawOf,
} from './vec.js';

export interface Furniture {
  id: string;
  label: RealLabel | 'floor' | 'wall' | 'ceiling' | 'unknown';
  obb: Obb;
}

export interface Top {
  id: string;
  furnitureId: string;
  label: Furniture['label'];
  center: V3;
  /** In-plane unit axes and half sizes. */
  u: V3;
  v: V3;
  halfU: number;
  halfV: number;
  /** Synthetic shelves the spirit made because the room had nothing usable. */
  synthetic?: boolean;
}

export interface Seat {
  /** Player head position when seated. */
  head: V3;
  /** Yaw the player faces, radians (0 = facing -Z). */
  yaw: number;
}

export interface Spot {
  topId: string;
  position: V3;
  /** Yaw relative to the seat's forward, radians, + = right. */
  bearing: number;
  distance: number;
  score: number;
}

const UP: V3 = { x: 0, y: 1, z: 0 };

const LABEL_SCORE: Partial<Record<Furniture['label'], number>> = {
  table: 1,
  shelf: 0.95,
  storage: 0.9,
  other: 0.5,
  couch: 0.45,
  bed: 0.35,
  floor: 0.15,
};

const AXES: V3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

/** The upward-facing face of a furniture box. */
export function topOf(f: Furniture): Top | null {
  const world = AXES.map((a) => rotate(f.obb.orientation, a));
  const halves = [f.obb.halfExtents.x, f.obb.halfExtents.y, f.obb.halfExtents.z];
  let upIdx = 0;
  let best = 0;
  world.forEach((a, i) => {
    const d = Math.abs(dot(a, UP));
    if (d > best) {
      best = d;
      upIdx = i;
    }
  });
  if (best < 0.85) return null; // tilted box, no usable top
  const sign = dot(world[upIdx], UP) >= 0 ? 1 : -1;
  const center = addScaled(f.obb.center, world[upIdx], halves[upIdx] * sign);
  const others = [0, 1, 2].filter((i) => i !== upIdx);
  return {
    id: `${f.id}:top`,
    furnitureId: f.id,
    label: f.label,
    center,
    u: world[others[0]],
    v: world[others[1]],
    halfU: halves[others[0]],
    halfV: halves[others[1]],
  };
}

export interface SpotOptions {
  /** Max |bearing| from the seat's forward, radians (airplane-seat friendly). */
  maxBearing: number;
  minDistance: number;
  maxDistance: number;
  minHeight: number;
  maxHeight: number;
  edgeMargin: number;
  grid: number;
}

export const DEFAULT_SPOTS: SpotOptions = {
  maxBearing: (100 * Math.PI) / 180,
  minDistance: 0.45,
  maxDistance: 3.6,
  minHeight: 0.15,
  maxHeight: 2.0,
  edgeMargin: 0.07,
  grid: 0.16,
};

export function bearingFrom(seat: Seat, p: V3): number {
  const rel = sub(p, seat.head);
  const yaw = Math.atan2(-rel.x, -rel.z); // yaw of the direction, 0 = -Z
  let b = seat.yaw - yaw; // + = to the right
  while (b > Math.PI) b -= Math.PI * 2;
  while (b < -Math.PI) b += Math.PI * 2;
  return b;
}

/** Candidate spots on every usable top, filtered for a seated player. */
export function candidateSpots(tops: readonly Top[], seat: Seat, opts: SpotOptions = DEFAULT_SPOTS): Spot[] {
  const out: Spot[] = [];
  for (const top of tops) {
    const labelScore = top.synthetic ? 0.8 : LABEL_SCORE[top.label] ?? 0.3;
    if (top.label === 'floor' || top.label === 'wall' || top.label === 'ceiling') continue;
    const nu = Math.max(0, Math.floor((top.halfU - opts.edgeMargin) / opts.grid));
    const nv = Math.max(0, Math.floor((top.halfV - opts.edgeMargin) / opts.grid));
    for (let i = -nu; i <= nu; i++) {
      for (let j = -nv; j <= nv; j++) {
        const p = addScaled(addScaled(top.center, top.u, i * opts.grid), top.v, j * opts.grid);
        if (p.y < opts.minHeight || p.y > opts.maxHeight) continue;
        const d = distance(p, seat.head);
        if (d < opts.minDistance || d > opts.maxDistance) continue;
        const bearing = bearingFrom(seat, p);
        if (Math.abs(bearing) > opts.maxBearing) continue;
        const comfort = d < 0.8 ? 0.7 : d > 2.6 ? 0.75 : 1;
        out.push({ topId: top.id, position: p, bearing, distance: d, score: labelScore * comfort });
      }
    }
  }
  return out;
}

/**
 * Picks `count` spots spread out in bearing and space. Greedy farthest-point
 * selection weighted by spot quality.
 */
export function chooseSpots(spots: readonly Spot[], count: number, rng: Rng, minSeparation = 0.32): Spot[] {
  if (spots.length === 0) return [];
  const pool = shuffle(rng, spots);
  pool.sort((a, b) => b.score - a.score);
  const chosen: Spot[] = [pool[0]];
  const perTop = new Map<string, number>([[pool[0].topId, 1]]);
  while (chosen.length < count) {
    let best: Spot | null = null;
    let bestValue = -Infinity;
    for (const s of pool) {
      if (chosen.includes(s)) continue;
      const near = Math.min(...chosen.map((c) => distance(c.position, s.position)));
      if (near < minSeparation) continue;
      const angular = Math.min(...chosen.map((c) => Math.abs(c.bearing - s.bearing)));
      const crowd = perTop.get(s.topId) ?? 0;
      const value = s.score + angular * 0.9 + Math.min(near, 1.5) * 0.3 - crowd * 0.25;
      if (value > bestValue) {
        bestValue = value;
        best = s;
      }
    }
    if (!best) break;
    chosen.push(best);
    perTop.set(best.topId, (perTop.get(best.topId) ?? 0) + 1);
  }
  return chosen;
}

/** Little floating shelves for a room with no usable furniture (or no room scan). */
export function syntheticShelves(seat: Seat): Top[] {
  const bearings = [-75, -35, 0, 35, 75].map((d) => (d * Math.PI) / 180);
  return bearings.map((b, i) => {
    const yaw = seat.yaw - b;
    const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
    const dist = i === 2 ? 1.1 : 1.35;
    const center = {
      x: seat.head.x + dir.x * dist,
      y: seat.head.y - 0.35 + (i % 2) * 0.12,
      z: seat.head.z + dir.z * dist,
    };
    const u = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }; // perpendicular to dir
    return {
      id: `shelf-${i}`,
      furnitureId: `shelf-${i}`,
      label: 'shelf' as const,
      center,
      u,
      v: dir,
      halfU: 0.22,
      halfV: 0.09,
      synthetic: true,
    };
  });
}

const PREFERRED: Record<PropKind, Furniture['label'][]> = {
  teacup: ['table'],
  'milk-bowl': ['table', 'storage'],
  candle: ['table', 'shelf', 'storage'],
  clock: ['shelf', 'storage', 'table'],
  plant: ['shelf', 'storage', 'table'],
  books: ['shelf', 'table', 'couch'],
  frame: ['shelf', 'storage', 'table'],
  jug: ['table', 'shelf'],
  toy: ['couch', 'bed', 'table', 'shelf'],
  lantern: ['shelf', 'table', 'storage'],
  apple: ['table'],
  key: ['table', 'shelf'],
};

export interface Placement {
  propId: string;
  kind: PropKind;
  spot: Spot;
  /** Facing yaw for the prop: turned toward the player. */
  yaw: number;
}

/** Matches props to spots, honouring where each thing naturally belongs. */
export function assignProps(
  kinds: readonly PropKind[],
  spots: readonly Spot[],
  tops: readonly Top[],
  seat: Seat,
): Placement[] {
  const labelOf = new Map(tops.map((t) => [t.id, t.label]));
  const free = spots.slice();
  const out: Placement[] = [];
  kinds.forEach((kind, i) => {
    if (free.length === 0) return;
    let idx = -1;
    for (const label of PREFERRED[kind]) {
      idx = free.findIndex((s) => labelOf.get(s.topId) === label);
      if (idx >= 0) break;
    }
    if (idx < 0) idx = 0;
    const [spot] = free.splice(idx, 1);
    const toPlayer = sub(seat.head, spot.position);
    out.push({ propId: `${kind}-${i}`, kind, spot, yaw: Math.atan2(toPlayer.x, toPlayer.z) });
  });
  return out;
}

/** Yaw of an orientation (for seat estimation from the head pose). */
export function seatFromHead(head: V3, orientation: Quat): Seat {
  return { head: { ...head }, yaw: yawOf(orientation) };
}

/** Clamp a point to stay on a top (used by the "shift" trick). */
export function clampToTop(top: Top, p: V3, margin = 0.06): V3 {
  const rel = sub(p, top.center);
  const s = Math.max(-(top.halfU - margin), Math.min(top.halfU - margin, dot(rel, top.u)));
  const t = Math.max(-(top.halfV - margin), Math.min(top.halfV - margin, dot(rel, top.v)));
  return addScaled(addScaled({ ...top.center }, top.u, s), top.v, t, v3());
}
