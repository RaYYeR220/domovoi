/**
 * The viewfinder: two hands in an "L" make a picture frame, the gesture
 * everyone knows from film directors and photographers.
 *
 * Works from raw WebXR hand joints (25 per hand). It is deliberately forgiving:
 * hand tracking on Quest is noisy when hands are close together, so every test
 * uses angles and ratios with generous tolerances and the shutter only fires
 * once the frame has been held still for a moment.
 */

import {
  type V3,
  add,
  addScaled,
  angleBetween,
  cross,
  distance,
  dot,
  lerp,
  normalize,
  scale,
  sub,
  v3,
} from './vec.js';

export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type HandJointName = (typeof HAND_JOINTS)[number];
export type HandJoints = Record<HandJointName, V3>;

const D = Math.PI / 180;

/** Straightness of a joint chain: 1 = perfectly straight, lower = bent. */
export function straightness(points: readonly V3[]): number {
  let path = 0;
  for (let i = 1; i < points.length; i++) path += distance(points[i - 1], points[i]);
  if (path < 1e-6) return 0;
  return distance(points[0], points[points.length - 1]) / path;
}

/** A finger counts as curled when its tip is closer to the wrist than its knuckle. */
function curled(j: HandJoints, finger: 'middle' | 'ring' | 'pinky'): boolean {
  const tip = j[`${finger}-finger-tip`];
  const knuckle = j[`${finger}-finger-phalanx-proximal`];
  return distance(j.wrist, tip) < distance(j.wrist, knuckle) * 1.05;
}

/** Closest point between two infinite lines p1 + t·d1 and p2 + s·d2 (midpoint of the gap). */
export function lineClosestPoint(p1: V3, d1: V3, p2: V3, d2: V3): V3 {
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const b = dot(d1, d2);
  const c = dot(d2, d2);
  const d = dot(d1, r);
  const e = dot(d2, r);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return lerp(p1, p2, 0.5);
  const t = (b * e - c * d) / den;
  const s = (a * e - b * d) / den;
  const q1 = addScaled(p1, d1, t);
  const q2 = addScaled(p2, d2, s);
  return lerp(q1, q2, 0.5);
}

export interface LShape {
  /** Where the index line and the thumb line meet: the corner of the frame. */
  corner: V3;
  indexDir: V3;
  thumbDir: V3;
  /** 0..1 confidence. */
  score: number;
}

export interface LOptions {
  minIndexStraight: number;
  minThumbStraight: number;
  minThumbIndexAngle: number;
  maxThumbIndexAngle: number;
  /** Require middle/ring/pinky curled (true = strict L). */
  requireCurl: boolean;
}

export const DEFAULT_L: LOptions = {
  minIndexStraight: 0.9,
  minThumbStraight: 0.82,
  minThumbIndexAngle: 45 * D,
  maxThumbIndexAngle: 135 * D,
  requireCurl: true,
};

/** Detects one hand making an "L" (index out, thumb out, other fingers tucked). */
export function detectL(j: HandJoints, opts: LOptions = DEFAULT_L): LShape | null {
  const indexChain = [
    j['index-finger-phalanx-proximal'],
    j['index-finger-phalanx-intermediate'],
    j['index-finger-phalanx-distal'],
    j['index-finger-tip'],
  ];
  const thumbChain = [j['thumb-phalanx-proximal'], j['thumb-phalanx-distal'], j['thumb-tip']];
  const si = straightness(indexChain);
  const st = straightness(thumbChain);
  if (si < opts.minIndexStraight || st < opts.minThumbStraight) return null;

  const indexDir = normalize(sub(j['index-finger-tip'], j['index-finger-phalanx-proximal']));
  const thumbDir = normalize(sub(j['thumb-tip'], j['thumb-phalanx-proximal']));
  const angle = angleBetween(indexDir, thumbDir);
  if (angle < opts.minThumbIndexAngle || angle > opts.maxThumbIndexAngle) return null;

  if (opts.requireCurl) {
    const tucked = ['middle', 'ring', 'pinky'].filter((f) => curled(j, f as 'middle')).length;
    if (tucked < 2) return null; // allow one sloppy finger
  }

  const corner = lineClosestPoint(
    j['index-finger-phalanx-proximal'],
    indexDir,
    j['thumb-phalanx-proximal'],
    thumbDir,
  );
  const squareness = 1 - Math.abs(angle - Math.PI / 2) / (Math.PI / 4);
  const score = Math.max(0, Math.min(1, 0.5 * squareness + 0.25 * si + 0.25 * st));
  return { corner, indexDir, thumbDir, score };
}

export interface Frame {
  /** Corners in order: A (first hand's corner), A+u·w, B (second hand), A+v·h. */
  corners: [V3, V3, V3, V3];
  origin: V3;
  /** Unit edge directions from the origin corner. */
  u: V3;
  v: V3;
  /** Unit normal pointing away from the eye, into the scene. */
  normal: V3;
  width: number;
  height: number;
  center: V3;
}

export interface FrameOptions {
  minEdge: number;
  maxEdge: number;
  /** How far the two corners may sit off a common plane, metres. */
  maxSkew: number;
  /** Minimum angle for "opposite" finger directions. */
  minOpposite: number;
}

export const DEFAULT_FRAME: FrameOptions = {
  minEdge: 0.05,
  maxEdge: 0.75,
  maxSkew: 0.09,
  minOpposite: 125 * D,
};

/**
 * Two L's facing each other form a rectangle. Accepts the classic director's
 * frame (index opposite index, thumb opposite thumb) and the crossed variant
 * (index opposite thumb).
 */
export function detectFrame(
  a: LShape | null,
  b: LShape | null,
  eye: V3,
  opts: FrameOptions = DEFAULT_FRAME,
): Frame | null {
  if (!a || !b) return null;
  const straight =
    angleBetween(a.indexDir, b.indexDir) >= opts.minOpposite &&
    angleBetween(a.thumbDir, b.thumbDir) >= opts.minOpposite;
  const crossed =
    angleBetween(a.indexDir, b.thumbDir) >= opts.minOpposite &&
    angleBetween(a.thumbDir, b.indexDir) >= opts.minOpposite;
  if (!straight && !crossed) return null;

  // Orthonormal basis from the first hand's L.
  const u = normalize(a.thumbDir);
  const vRaw = sub(a.indexDir, scale(u, dot(a.indexDir, u)));
  const v = normalize(vRaw);
  const n = normalize(cross(u, v));
  const diag = sub(b.corner, a.corner);
  const w = dot(diag, u);
  const h = dot(diag, v);
  const skew = Math.abs(dot(diag, n));
  if (w < opts.minEdge || h < opts.minEdge) return null;
  if (w > opts.maxEdge || h > opts.maxEdge) return null;
  if (skew > opts.maxSkew) return null;

  const origin = a.corner;
  const c1 = addScaled(origin, u, w);
  const c3 = addScaled(origin, v, h);
  const c2 = addScaled(c1, v, h);
  const center = addScaled(addScaled(origin, u, w / 2), v, h / 2);
  // Point the normal into the scene (away from the eye).
  const toCenter = sub(center, eye);
  const normal = dot(n, toCenter) < 0 ? scale(n, -1) : n;
  return { corners: [origin, c1, c2, c3], origin, u, v, normal, width: w, height: h, center };
}

/**
 * Does the frame, seen from `eye`, contain `point`? Casts the eye→point ray
 * onto the frame's plane and checks the hit lies inside the rectangle.
 * `margin` enlarges the rectangle (metres at the frame's distance).
 */
export function frameContains(frame: Frame, eye: V3, point: V3, margin = 0.01): boolean {
  const dir = sub(point, eye);
  const denom = dot(dir, frame.normal);
  if (denom <= 1e-6) return false; // point behind the eye relative to the frame
  const t = dot(sub(frame.origin, eye), frame.normal) / denom;
  if (t <= 0) return false;
  if (t > 1.02) {
    // the frame plane lies beyond the point: point is between eye and frame
    return false;
  }
  const hit = addScaled(eye, dir, t);
  const rel = sub(hit, frame.origin);
  const s = dot(rel, frame.u);
  const r = dot(rel, frame.v);
  return s >= -margin && s <= frame.width + margin && r >= -margin && r <= frame.height + margin;
}

/** For the pinch fallback: is `point` within a cone around a gaze ray? */
export function coneContains(eye: V3, dir: V3, point: V3, halfAngle: number): boolean {
  return angleBetween(dir, sub(point, eye)) <= halfAngle;
}

export type ShutterState =
  | { phase: 'idle' }
  | { phase: 'aiming'; progress: number }
  | { phase: 'snap'; frame: Frame };

/**
 * Fires once the frame has been held still for `dwell` seconds, then waits for
 * a short cooldown so one long hold doesn't take a burst of photos.
 */
export class Shutter {
  private since = -1;
  private anchor: V3 = v3();
  private anchorSize = 0;
  private lastSnap = -Infinity;

  constructor(
    private readonly dwell = 0.55,
    private readonly cooldown = 1.4,
    private readonly maxDrift = 0.03,
  ) {}

  update(now: number, frame: Frame | null): ShutterState {
    if (!frame) {
      this.since = -1;
      return { phase: 'idle' };
    }
    if (now - this.lastSnap < this.cooldown) return { phase: 'idle' };
    const size = frame.width + frame.height;
    const moved =
      this.since < 0 ||
      distance(frame.center, this.anchor) > this.maxDrift ||
      Math.abs(size - this.anchorSize) > this.maxDrift * 1.5;
    if (moved) {
      this.since = now;
      this.anchor = { ...frame.center };
      this.anchorSize = size;
      return { phase: 'aiming', progress: 0 };
    }
    const progress = (now - this.since) / this.dwell;
    if (progress >= 1) {
      this.lastSnap = now;
      this.since = -1;
      return { phase: 'snap', frame };
    }
    return { phase: 'aiming', progress };
  }
}

/** Utility for tests and the emulator: rigidly place a hand pose in the world. */
export function transformJoints(
  local: Record<string, readonly number[]>,
  basis: { x: V3; y: V3; z: V3 },
  origin: V3,
): HandJoints {
  const out = {} as HandJoints;
  for (const name of HAND_JOINTS) {
    const p = local[name];
    const w = add(
      origin,
      add(add(scale(basis.x, p[0]), scale(basis.y, p[1])), scale(basis.z, p[2])),
    );
    out[name] = w;
  }
  return out;
}
