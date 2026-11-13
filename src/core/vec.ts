/**
 * Tiny allocation-aware vector helpers for the game core.
 *
 * The core is engine-free on purpose: it is unit-tested in Node and fed plain
 * numbers by the XR adapter systems. Functions that return a vector accept an
 * optional `out` so hot paths can reuse scratch objects.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export function copy(a: V3, out: V3 = v3()): V3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add(a: V3, b: V3, out: V3 = v3()): V3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(a: V3, b: V3, out: V3 = v3()): V3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(a: V3, s: number, out: V3 = v3()): V3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function addScaled(a: V3, b: V3, s: number, out: V3 = v3()): V3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export function cross(a: V3, b: V3, out: V3 = v3()): V3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export const lengthSq = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: V3): number => Math.sqrt(lengthSq(a));

export function distance(a: V3, b: V3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalize(a: V3, out: V3 = v3()): V3 {
  const l = length(a);
  if (l < 1e-9) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  return scale(a, 1 / l, out);
}

export function lerp(a: V3, b: V3, t: number, out: V3 = v3()): V3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** Angle between two vectors in radians (0..π). */
export function angleBetween(a: V3, b: V3): number {
  const d = Math.sqrt(lengthSq(a) * lengthSq(b));
  if (d < 1e-12) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / d)));
}

/** Rotates `v` by unit quaternion `q`. */
export function rotate(q: Quat, v: V3, out: V3 = v3()): V3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Quaternion from a yaw angle (rotation about +Y), radians. */
export function quatFromYaw(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Quaternion from yaw then pitch (YX order), radians. */
export function quatFromYawPitch(yaw: number, pitch: number): Quat {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = qYaw * qPitch
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/** Yaw of the forward (-Z) direction rotated by q, radians, 0 = facing -Z. */
export function yawOf(q: Quat): number {
  const f = rotate(q, { x: 0, y: 0, z: -1 });
  return Math.atan2(-f.x, -f.z);
}

export const DEG = Math.PI / 180;
