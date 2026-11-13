import { pointInObb, segmentHitsObb } from './attention.js';
import type { Furniture } from './placement.js';
import { type V3, dot, rotate, sub } from './vec.js';

/** A flat rectangle the scene reported on the room (a wall, or something hanging on one). */
export interface WallPanel {
  label: string;
  center: V3;
  normal: V3;
  right: V3;
  up: V3;
  halfW: number;
  halfH: number;
  vertical: boolean;
}

export interface BoardSize {
  w: number;
  h: number;
}

export interface BoardSpot {
  at: V3;
  /** Into the room, toward the player. */
  normal: V3;
  /** 1, or smaller when only a tight gap is free (a kitchen backsplash). */
  scale: number;
}

/** How far in front of a wall furniture still counts as standing at it (and so in front of the board). */
const AT_WALL = 1.0;
const MARGIN = 0.1;
/** A long room's end wall still works; nearer walls win on score. */
const MAX_REACH = 6.5;
/** Heights tried around eye level (m), best first; a small drop finds the gap above a counter. */
const HEIGHTS = [0, -0.04, -0.08, 0.15, 0.3, 0.45];
/** Board sizes tried, largest first: a smaller one only if nothing fits full size. */
const SCALES = [1, 0.8];

/**
 * Where the evidence board goes: a free stretch of real wall in front of the seat.
 * Free means nothing hangs there (pictures, windows, doors), nothing stands in
 * front of it (a floor lamp, a bookcase, a plant), and nothing in the room is
 * between the player and it. A low sofa under it is fine. If the natural height
 * is blocked the board may go a little higher. Returns null when no wall works.
 */
export function pickBoardSpot(
  panels: readonly WallPanel[],
  furniture: readonly Furniture[],
  head: V3,
  yaw: number,
  size: BoardSize,
): BoardSpot | null {
  for (const scale of SCALES) {
    const spot = pickAtSize(panels, furniture, head, yaw, { w: size.w * scale, h: size.h * scale });
    if (spot) return { ...spot, scale };
  }
  return null;
}

function pickAtSize(
  panels: readonly WallPanel[],
  furniture: readonly Furniture[],
  head: V3,
  yaw: number,
  size: BoardSize,
): Omit<BoardSpot, 'scale'> | null {
  const hanging = panels.filter((p) => p.vertical && p.label !== 'wall');
  const solid = furniture.filter((f) => f.label !== 'floor' && f.label !== 'ceiling' && f.label !== 'wall');
  const corners = solid.map((f) => cornersOf(f));
  let best: { at: V3; normal: V3; score: number } | null = null;

  for (const wall of panels) {
    if (!wall.vertical || wall.label !== 'wall') continue;
    if (wall.halfW < size.w / 2 + 0.05 || wall.halfH < size.h / 2 + 0.05) continue;
    // Face the room: the side the player is on.
    const flip = dot(sub(head, wall.center), wall.normal) < 0 ? -1 : 1;
    const n = { x: wall.normal.x * flip, y: wall.normal.y * flip, z: wall.normal.z * flip };
    const right = { x: wall.right.x * flip, y: 0, z: wall.right.z * flip };

    const top = wall.center.y + wall.halfH - size.h / 2 - 0.1;
    const low = wall.center.y - wall.halfH + size.h / 2 + 0.3;
    const eye = Math.min(top, Math.max(low, head.y + 0.08));

    for (let k = -10; k <= 10; k++) {
      const u = k * 0.2;
      if (Math.abs(u) > wall.halfW - size.w / 2 - 0.05) continue;
      const base = { x: wall.center.x + right.x * u, z: wall.center.z + right.z * u };
      const dx = base.x - head.x;
      const dz = base.z - head.z;
      const d = Math.hypot(dx, dz);
      if (d < 1 || d > MAX_REACH) continue;
      let bearing = yaw - Math.atan2(-dx, -dz);
      bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
      if (Math.abs(bearing) > 1.3) continue;

      for (const lift of HEIGHTS) {
        const y = eye + lift;
        if (y > top + 1e-6 || y < low - 1e-6) continue;
        const at = { x: base.x + n.x * 0.015, y, z: base.z + n.z * 0.015 };
        if (!wallIsFree(wall, n, right, u, y, size, hanging)) continue;
        if (somethingStandsInFront(wall, n, right, u, y, size, corners)) continue;
        if (!inPlainSight(head, at, right, size, solid)) continue;
        // Slightly off-centre walls are best: visible, but not where the action is.
        const score = Math.abs(Math.abs(bearing) - 0.5) + Math.abs(d - 2.2) * 0.3 + Math.abs(lift) * 2;
        if (!best || score < best.score) best = { at, normal: n, score };
        break;
      }
    }
  }
  return best ? { at: best.at, normal: best.normal } : null;
}

/** Nothing already hanging on this wall overlaps the board (with a margin). */
function wallIsFree(wall: WallPanel, n: V3, right: V3, u: number, y: number, size: BoardSize, hanging: readonly WallPanel[]): boolean {
  for (const p of hanging) {
    const rel = sub(p.center, wall.center);
    if (Math.abs(dot(rel, n)) > 0.2) continue; // on another wall
    const pu = dot(rel, right);
    const halfU = Math.abs(dot(p.right, right)) * p.halfW;
    if (Math.abs(pu - u) < halfU + size.w / 2 + MARGIN && Math.abs(p.center.y - y) < p.halfH + size.h / 2 + MARGIN) return false;
  }
  return true;
}

/** No furniture stands at the wall in front of the board: rising above its bottom edge, and not hung wholly above it. */
function somethingStandsInFront(wall: WallPanel, n: V3, right: V3, u: number, y: number, size: BoardSize, corners: readonly V3[][]): boolean {
  const bottom = y - size.h / 2;
  const top = y + size.h / 2;
  for (const cs of corners) {
    let nMin = Infinity;
    let nMax = -Infinity;
    let uMin = Infinity;
    let uMax = -Infinity;
    let yMax = -Infinity;
    let yMin = Infinity;
    for (const c of cs) {
      const rel = sub(c, wall.center);
      const cn = dot(rel, n);
      const cu = dot(rel, right);
      nMin = Math.min(nMin, cn);
      nMax = Math.max(nMax, cn);
      uMin = Math.min(uMin, cu);
      uMax = Math.max(uMax, cu);
      yMax = Math.max(yMax, c.y);
      yMin = Math.min(yMin, c.y);
    }
    if (nMax < -0.05 || nMin > AT_WALL) continue; // behind the wall, or out in the room
    if (uMax < u - size.w / 2 - MARGIN || uMin > u + size.w / 2 + MARGIN) continue; // beside it
    if (yMax < bottom - 0.02) continue; // low enough to sit under it (a sofa, a counter)
    if (yMin > top + 0.02) continue; // hung wholly above it (wall cabinets)
    return true;
  }
  return false;
}

/** The player can see the board's middle and all four corners from the seat. */
function inPlainSight(head: V3, at: V3, right: V3, size: BoardSize, solid: readonly Furniture[]): boolean {
  const hw = size.w / 2 - 0.05;
  const hh = size.h / 2 - 0.05;
  const points = [
    at,
    { x: at.x + right.x * hw, y: at.y + hh, z: at.z + right.z * hw },
    { x: at.x - right.x * hw, y: at.y + hh, z: at.z - right.z * hw },
    { x: at.x + right.x * hw, y: at.y - hh, z: at.z + right.z * hw },
    { x: at.x - right.x * hw, y: at.y - hh, z: at.z - right.z * hw },
  ];
  for (const f of solid) {
    if (pointInObb(head, f.obb, 0.05)) continue; // the chair you sit in
    for (const p of points) if (segmentHitsObb(head, p, f.obb, 0.02)) return false;
  }
  return true;
}

function cornersOf(f: Furniture): V3[] {
  const { center: c, halfExtents: h, orientation: q } = f.obb;
  const out: V3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const r = rotate(q, { x: sx * h.x, y: sy * h.y, z: sz * h.z });
        out.push({ x: c.x + r.x, y: c.y + r.y, z: c.z + r.z });
      }
  return out;
}
