import { describe, expect, it } from 'vitest';
import poses from './__fixtures__/iwer-hand-poses.json';
import {
  HAND_JOINTS,
  type HandJoints,
  Shutter,
  coneContains,
  detectFrame,
  detectL,
  frameContains,
  straightness,
  transformJoints,
} from './frame-gesture.js';
import { type V3, add, addScaled, cross, dot, normalize, scale, sub } from './vec.js';

// Joint positions of the emulator's own "finger-gun" pose (the L shape).
const fingerGun = poses['finger-gun'] as Record<string, number[]>;
const toV = (p: number[]): V3 => ({ x: p[0], y: p[1], z: p[2] });
const IDENTITY = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

function localL() {
  const j = transformJoints(fingerGun, IDENTITY, { x: 0, y: 0, z: 0 });
  const l = detectL(j);
  if (!l) throw new Error('fixture finger-gun is not detected as an L');
  return { j, l };
}

/** Builds the second hand by turning the first 180° about the frame normal. */
function framePair(w: number, h: number, worldOffset: V3) {
  const { j, l } = localL();
  const u = normalize(l.thumbDir);
  const v = normalize(sub(l.indexDir, scale(u, dot(l.indexDir, u))));
  const n = normalize(cross(u, v));
  const diag = add(scale(u, w), scale(v, h));
  const rot = (p: V3) => sub(scale(n, 2 * dot(p, n)), p); // 180° about n
  const second = {} as HandJoints;
  for (const name of HAND_JOINTS) {
    const rel = sub(j[name], l.corner);
    second[name] = add(add(add(rot(rel), l.corner), diag), worldOffset);
  }
  const first = {} as HandJoints;
  for (const name of HAND_JOINTS) first[name] = add(j[name], worldOffset);
  return { first, second, n, center: add(add(l.corner, scale(diag, 0.5)), worldOffset) };
}

describe('detectL', () => {
  it('recognises the emulator finger-gun pose as an L', () => {
    const { l } = localL();
    expect(l.score).toBeGreaterThan(0.5);
  });

  it('rejects an open hand and a fist', () => {
    const open = transformJoints(poses.open as Record<string, number[]>, IDENTITY, { x: 0, y: 0, z: 0 });
    const fist = transformJoints(poses.fist as Record<string, number[]>, IDENTITY, { x: 0, y: 0, z: 0 });
    expect(detectL(open)).toBeNull();
    expect(detectL(fist)).toBeNull();
  });

  it('is invariant to where and how the hand is held', () => {
    const basis = {
      x: { x: 0, y: 0, z: -1 },
      y: { x: 0, y: 1, z: 0 },
      z: { x: 1, y: 0, z: 0 },
    }; // turned 90° about +Y
    const j = transformJoints(fingerGun, basis, { x: 0.4, y: 1.3, z: -0.5 });
    expect(detectL(j)).not.toBeNull();
  });

  it('straightness is 1 for a line and lower for a bent chain', () => {
    expect(straightness([toV([0, 0, 0]), toV([0, 0, 1]), toV([0, 0, 2])])).toBeCloseTo(1);
    expect(straightness([toV([0, 0, 0]), toV([0, 1, 0]), toV([1, 1, 0])])).toBeLessThan(0.75);
  });
});

describe('detectFrame', () => {
  const eye = { x: 0, y: 1.6, z: 0.3 };

  it('two opposing L shapes make a frame of the right size', () => {
    const { first, second } = framePair(0.22, 0.14, { x: -0.1, y: 1.4, z: -0.35 });
    const f = detectFrame(detectL(first), detectL(second), eye);
    expect(f).not.toBeNull();
    expect(f!.width).toBeCloseTo(0.22, 2);
    expect(f!.height).toBeCloseTo(0.14, 2);
  });

  it('rejects two L shapes pointing the same way', () => {
    const { first } = framePair(0.2, 0.2, { x: 0, y: 1.4, z: -0.35 });
    const shifted = {} as HandJoints;
    for (const name of HAND_JOINTS) shifted[name] = add(first[name], { x: 0.2, y: 0.1, z: 0 });
    expect(detectFrame(detectL(first), detectL(shifted), eye)).toBeNull();
  });

  it('rejects a frame that is too small to mean anything', () => {
    const { first, second } = framePair(0.02, 0.02, { x: 0, y: 1.4, z: -0.35 });
    expect(detectFrame(detectL(first), detectL(second), eye)).toBeNull();
  });

  it('frames what lies behind it as seen from the eye', () => {
    const { first, second, center } = framePair(0.24, 0.16, { x: -0.12, y: 1.45, z: -0.35 });
    const f = detectFrame(detectL(first), detectL(second), eye)!;
    const through = addScaled(eye, sub(center, eye), 4); // straight through the frame centre
    expect(frameContains(f, eye, through)).toBe(true);
    const offToSide = add(through, { x: 2, y: 0, z: 0 });
    expect(frameContains(f, eye, offToSide)).toBe(false);
    const behindViewer = addScaled(eye, sub(center, eye), -2);
    expect(frameContains(f, eye, behindViewer)).toBe(false);
  });
});

describe('Shutter', () => {
  const eye = { x: 0, y: 1.6, z: 0.3 };
  const { first, second } = framePair(0.2, 0.15, { x: 0, y: 1.4, z: -0.35 });
  const frame = detectFrame(detectL(first), detectL(second), eye)!;

  it('fires after the frame is held still', () => {
    const s = new Shutter(0.5, 1.0);
    expect(s.update(0, frame).phase).toBe('aiming');
    expect(s.update(0.3, frame).phase).toBe('aiming');
    expect(s.update(0.55, frame).phase).toBe('snap');
    expect(s.update(0.6, frame).phase).toBe('idle'); // cooldown
  });

  it('does not fire while the frame keeps moving', () => {
    const s = new Shutter(0.5, 1.0);
    for (let t = 0; t < 2; t += 0.1) {
      const moved = { ...frame, center: add(frame.center, { x: t * 0.5, y: 0, z: 0 }) };
      expect(s.update(t, moved).phase).not.toBe('snap');
    }
  });

  it('resets when the hands drop', () => {
    const s = new Shutter(0.5, 1.0);
    s.update(0, frame);
    s.update(0.4, null);
    expect(s.update(0.5, frame).phase).toBe('aiming');
  });
});

describe('coneContains (pinch fallback)', () => {
  it('accepts a point near the gaze ray', () => {
    const eye = { x: 0, y: 1.6, z: 0 };
    expect(coneContains(eye, { x: 0, y: 0, z: -1 }, { x: 0.1, y: 1.6, z: -2 }, 0.1)).toBe(true);
    expect(coneContains(eye, { x: 0, y: 0, z: -1 }, { x: 1, y: 1.6, z: -1 }, 0.1)).toBe(false);
  });
});
