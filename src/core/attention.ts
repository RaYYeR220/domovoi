/**
 * Attention: what the player can see right now, and for how long each thing
 * has gone unseen.
 *
 * The whole game rests on one promise: the spirit only changes something the
 * player could not have seen change. "Could not have seen" means the object is
 * outside the headset's actual field of view (plus a safety margin), or hidden
 * behind real furniture, and has stayed that way for a while.
 *
 * The field of view is not hard-coded. It is read from the XR projection
 * matrices every frame, so on a narrower device (Meta VR Glasses, ~70°×66°)
 * the blind zone is genuinely larger and the spirit gets bolder.
 */

import {
  type Quat,
  type V3,
  dot,
  lengthSq,
  rotate,
  sub,
  v3,
} from './vec.js';

/** Half-angles of a view frustum, radians, measured from straight ahead. */
export interface Fov {
  left: number;
  right: number;
  up: number;
  down: number;
}

export interface Pose {
  position: V3;
  orientation: Quat;
}

/** Oriented box used for real-world occluders (couch, shelf, table…). */
export interface Obb {
  center: V3;
  halfExtents: V3;
  orientation: Quat;
}

export const QUEST3_FOV: Fov = deg({ left: 55, right: 55, up: 48, down: 48 });
/** Meta VR Glasses, per-eye projection as reported by the device (asymmetric: more below than above). */
export const GLASSES_FOV: Fov = deg({ left: 37, right: 37, up: 25, down: 43 });
/** Meta's recommended design area for VR Glasses (58°×54°). */
export const GLASSES_DESIGN_AREA: Fov = deg({ left: 29, right: 29, up: 27, down: 27 });

function deg(f: Fov): Fov {
  const k = Math.PI / 180;
  return { left: f.left * k, right: f.right * k, up: f.up * k, down: f.down * k };
}

/**
 * Field of view of one eye from a WebGL-style column-major perspective
 * projection matrix (as delivered by `XRView.projectionMatrix`).
 */
export function fovFromProjection(m: ArrayLike<number>): Fov {
  const m0 = m[0];
  const m5 = m[5];
  const m8 = m[8];
  const m9 = m[9];
  const leftTan = (1 - m8) / m0; // -l/n
  const rightTan = (1 + m8) / m0; // r/n
  const downTan = (1 - m9) / m5; // -b/n
  const upTan = (1 + m9) / m5; // t/n
  return {
    left: Math.atan(leftTan),
    right: Math.atan(rightTan),
    up: Math.atan(upTan),
    down: Math.atan(downTan),
  };
}

/** The union of two eyes' frusta, as seen from the head. */
export function unionFov(a: Fov, b: Fov): Fov {
  return {
    left: Math.max(a.left, b.left),
    right: Math.max(a.right, b.right),
    up: Math.max(a.up, b.up),
    down: Math.max(a.down, b.down),
  };
}

export interface HeadSpaceAngles {
  /** + is to the player's right, radians. */
  yaw: number;
  /** + is up, radians. */
  pitch: number;
  distance: number;
}

const scratchA = v3();
const scratchB = v3();

const anglesOut: HeadSpaceAngles = { yaw: 0, pitch: 0, distance: 0 };

/**
 * Where a world point sits relative to the head's view direction.
 * Returns a shared object (read it immediately; it is reused on the next call).
 */
export function headSpaceAngles(head: Pose, point: V3): HeadSpaceAngles {
  const rel = sub(point, head.position, scratchA);
  const local = rotateInv(head.orientation, rel, scratchB);
  const horizontal = Math.sqrt(local.x * local.x + local.z * local.z);
  anglesOut.yaw = Math.atan2(local.x, -local.z);
  anglesOut.pitch = Math.atan2(local.y, horizontal);
  anglesOut.distance = Math.sqrt(lengthSq(local));
  return anglesOut;
}

/**
 * True if any part of a sphere of `radius` around `point` falls inside the
 * field of view widened by `margin` radians.
 */
export function isInView(
  head: Pose,
  fov: Fov,
  point: V3,
  radius = 0,
  margin = 0,
): boolean {
  const a = headSpaceAngles(head, point);
  if (a.distance < 1e-4) return true;
  const angularRadius = Math.asin(Math.min(1, radius / a.distance));
  const slack = angularRadius + margin;
  return (
    a.yaw >= -(fov.left + slack) &&
    a.yaw <= fov.right + slack &&
    a.pitch >= -(fov.down + slack) &&
    a.pitch <= fov.up + slack
  );
}

/** Angle between the view direction and the direction to `point`, radians. */
export function angleFromGaze(head: Pose, point: V3): number {
  const rel = sub(point, head.position, scratchA);
  const forward = rotate(head.orientation, { x: 0, y: 0, z: -1 }, scratchB);
  const l = Math.sqrt(lengthSq(rel));
  if (l < 1e-6) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot(rel, forward) / l)));
}

/** Rotates `v` by the inverse of unit quaternion `q` (no allocation). */
function rotateInv(q: Quat, v: V3, out: V3): V3 {
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  const x = v.x + q.w * tx + (qy * tz - qz * ty);
  const y = v.y + q.w * ty + (qz * tx - qx * tz);
  const z = v.z + q.w * tz + (qx * ty - qy * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

const sA = v3();
const sB = v3();
const sD = v3();
const sP = v3();

function axisSlab(la: number, d: number, h: number, range: { tMin: number; tMax: number }): boolean {
  if (Math.abs(d) < 1e-9) return la >= -h && la <= h;
  let t1 = (-h - la) / d;
  let t2 = (h - la) / d;
  if (t1 > t2) {
    const t = t1;
    t1 = t2;
    t2 = t;
  }
  if (t1 > range.tMin) range.tMin = t1;
  if (t2 < range.tMax) range.tMax = t2;
  return range.tMin <= range.tMax;
}

const slabRange = { tMin: 0, tMax: 1 };

/**
 * Segment–oriented-box intersection (slab test in the box's frame).
 * `shrink` pulls each face in by that many metres so that things resting on a
 * surface are not considered hidden by the surface they rest on.
 * Allocation-free: it runs for every watched thing × every occluder each frame.
 */
export function segmentHitsObb(a: V3, b: V3, box: Obb, shrink = 0): boolean {
  const la = rotateInv(box.orientation, sub(a, box.center, sP), sA);
  const lb = rotateInv(box.orientation, sub(b, box.center, sP), sB);
  const d = sub(lb, la, sD);
  slabRange.tMin = 0;
  slabRange.tMax = 1;
  const h = box.halfExtents;
  return (
    axisSlab(la.x, d.x, Math.max(0, h.x - shrink), slabRange) &&
    axisSlab(la.y, d.y, Math.max(0, h.y - shrink), slabRange) &&
    axisSlab(la.z, d.z, Math.max(0, h.z - shrink), slabRange)
  );
}

export function pointInObb(p: V3, box: Obb, pad = 0): boolean {
  const l = rotateInv(box.orientation, sub(p, box.center, sP), sA);
  return (
    Math.abs(l.x) <= box.halfExtents.x + pad &&
    Math.abs(l.y) <= box.halfExtents.y + pad &&
    Math.abs(l.z) <= box.halfExtents.z + pad
  );
}

/** True if the straight line from eye to target passes through an occluder. */
export function isOccluded(eye: V3, target: V3, occluders: readonly Obb[]): boolean {
  for (const box of occluders) {
    // A box that contains the target is its support or container, not a blocker.
    if (pointInObb(target, box, 0.03)) continue;
    if (segmentHitsObb(eye, target, box, 0.02)) return true;
  }
  return false;
}

export interface Watchable {
  id: string;
  position: V3;
  radius: number;
}

interface WatchState {
  visible: boolean;
  lastSeen: number;
}

export interface AttentionOptions {
  /** Extra angular margin outside the FoV before something counts as unseen. */
  margin: number;
}

/**
 * Tracks per-object visibility over time. Feed it every frame; ask it which
 * objects have been out of sight long enough to be safely changed.
 */
export class AttentionTracker {
  private readonly states = new Map<string, WatchState>();
  private readonly opts: AttentionOptions;

  constructor(opts: Partial<AttentionOptions> = {}) {
    this.opts = { margin: (10 * Math.PI) / 180, ...opts };
  }

  update(
    now: number,
    head: Pose,
    fov: Fov,
    targets: readonly Watchable[],
    occluders: readonly Obb[] = [],
  ): void {
    for (const t of targets) {
      const inCone = isInView(head, fov, t.position, t.radius, this.opts.margin);
      const visible = inCone && !isOccluded(head.position, t.position, occluders);
      let s = this.states.get(t.id);
      if (!s) {
        s = { visible, lastSeen: visible ? now : -Infinity };
        this.states.set(t.id, s);
      }
      s.visible = visible;
      if (visible) s.lastSeen = now;
    }
  }

  /** Mark an object as freshly seen (e.g. it was just placed in front of the player). */
  touch(id: string, now: number): void {
    const s = this.states.get(id);
    if (s) s.lastSeen = now;
    else this.states.set(id, { visible: false, lastSeen: now });
  }

  forget(id: string): void {
    this.states.delete(id);
  }

  isVisible(id: string): boolean {
    return this.states.get(id)?.visible ?? false;
  }

  /** Seconds since the object was last visible; 0 while visible. */
  unseenFor(id: string, now: number): number {
    const s = this.states.get(id);
    if (!s) return 0;
    if (s.visible) return 0;
    return now - s.lastSeen;
  }

  /** Objects that are not visible now and have not been for at least `minSeconds`. */
  blindSpots(now: number, minSeconds: number): string[] {
    const out: string[] = [];
    for (const [id, s] of this.states) {
      if (!s.visible && now - s.lastSeen >= minSeconds) out.push(id);
    }
    return out;
  }
}

/**
 * Share of a seated player's surroundings that is out of sight at any moment:
 * directions within ±maxYaw and ±maxPitch of straight ahead, weighted by solid
 * angle, that fall outside the field of view (plus margin).
 */
export function blindFraction(fov: Fov, margin = 0, maxYaw = (100 * Math.PI) / 180, maxPitch = (50 * Math.PI) / 180): number {
  const head: Pose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  let total = 0;
  let blind = 0;
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const yaw = -maxYaw + (2 * maxYaw * i) / steps;
    for (let j = 0; j <= steps; j++) {
      const pitch = -maxPitch + (2 * maxPitch * j) / steps;
      const w = Math.cos(pitch);
      const p = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      total += w;
      if (!isInView(head, fov, p, 0, margin)) blind += w;
    }
  }
  return blind / total;
}
