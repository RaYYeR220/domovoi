import { describe, expect, it } from 'vitest';
import {
  AttentionTracker,
  GLASSES_FOV,
  QUEST3_FOV,
  fovFromProjection,
  headSpaceAngles,
  isInView,
  isOccluded,
  segmentHitsObb,
  type Obb,
  type Pose,
} from './attention.js';
import { DEG, quatFromYaw, quatFromYawPitch } from './vec.js';

const head = (yawDeg = 0, pitchDeg = 0): Pose => ({
  position: { x: 0, y: 1.2, z: 0 },
  orientation: quatFromYawPitch(yawDeg * DEG, pitchDeg * DEG),
});

describe('headSpaceAngles', () => {
  it('puts a point straight ahead at yaw 0, pitch 0', () => {
    const a = headSpaceAngles(head(), { x: 0, y: 1.2, z: -2 });
    expect(a.yaw).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(0);
    expect(a.distance).toBeCloseTo(2);
  });

  it('reports + yaw for points to the right and + pitch for points above', () => {
    expect(headSpaceAngles(head(), { x: 1, y: 1.2, z: -1 }).yaw).toBeCloseTo(45 * DEG);
    expect(headSpaceAngles(head(), { x: 0, y: 2.2, z: -1 }).pitch).toBeCloseTo(45 * DEG);
  });

  it('follows head rotation (turning left 90° brings a left point to centre)', () => {
    const turnedLeft = { ...head(), orientation: quatFromYaw(90 * DEG) };
    const a = headSpaceAngles(turnedLeft, { x: -2, y: 1.2, z: 0 });
    expect(a.yaw).toBeCloseTo(0);
  });
});

describe('isInView', () => {
  it('sees things in front and not behind', () => {
    expect(isInView(head(), QUEST3_FOV, { x: 0, y: 1.2, z: -2 })).toBe(true);
    expect(isInView(head(), QUEST3_FOV, { x: 0, y: 1.2, z: 2 })).toBe(false);
  });

  it('respects the narrower Meta VR Glasses field of view', () => {
    // 45° to the right: inside Quest 3 (55° half), outside Glasses (35° half).
    const p = { x: 1, y: 1.2, z: -1 };
    expect(isInView(head(), QUEST3_FOV, p)).toBe(true);
    expect(isInView(head(), GLASSES_FOV, p)).toBe(false);
  });

  it('widens by object radius and margin', () => {
    const p = { x: Math.tan(60 * DEG) * 2, y: 1.2, z: -2 }; // 60° right
    expect(isInView(head(), QUEST3_FOV, p)).toBe(false);
    expect(isInView(head(), QUEST3_FOV, p, 0, 10 * DEG)).toBe(true);
  });
});

describe('fovFromProjection', () => {
  it('recovers a symmetric 90° frustum', () => {
    // perspective(fovY=90°, aspect=1): m0 = m5 = 1, m8 = m9 = 0
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = -1;
    m[11] = -1;
    const f = fovFromProjection(m);
    expect(f.left).toBeCloseTo(45 * DEG);
    expect(f.right).toBeCloseTo(45 * DEG);
    expect(f.up).toBeCloseTo(45 * DEG);
    expect(f.down).toBeCloseTo(45 * DEG);
  });

  it('recovers an asymmetric (canted-eye) frustum', () => {
    // l = -1, r = 2, b = -1, t = 1 at n = 1
    const m = new Float32Array(16);
    m[0] = 2 / 3;
    m[8] = 1 / 3;
    m[5] = 1;
    m[9] = 0;
    const f = fovFromProjection(m);
    expect(Math.tan(f.left)).toBeCloseTo(1);
    expect(Math.tan(f.right)).toBeCloseTo(2);
  });
});

describe('occlusion', () => {
  const couch: Obb = {
    center: { x: 0, y: 0.45, z: -2 },
    halfExtents: { x: 1, y: 0.45, z: 0.45 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };

  it('a couch hides a cup on the floor behind it', () => {
    expect(isOccluded({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0.05, z: -3 }, [couch])).toBe(true);
  });

  it('does not hide a cup resting on top of the couch (its support)', () => {
    expect(isOccluded({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0.9, z: -2 }, [couch])).toBe(false);
  });

  it('segment test respects box rotation', () => {
    const rotated: Obb = { ...couch, orientation: quatFromYaw(90 * DEG) };
    // Rotated 90°, the couch spans z ∈ [-3, -1] at x ∈ [-0.45, 0.45]
    expect(segmentHitsObb({ x: -2, y: 0.4, z: -2.8 }, { x: 2, y: 0.4, z: -2.8 }, rotated)).toBe(true);
    expect(segmentHitsObb({ x: -2, y: 0.4, z: -0.5 }, { x: 2, y: 0.4, z: -0.5 }, rotated)).toBe(false);
  });
});

describe('AttentionTracker', () => {
  const cup = { id: 'cup', position: { x: 0, y: 1.0, z: -1.5 }, radius: 0.05 };
  const clock = { id: 'clock', position: { x: -1.5, y: 1.4, z: 0.2 }, radius: 0.08 };

  it('counts unseen time only while out of view', () => {
    const t = new AttentionTracker();
    t.update(0, head(0), QUEST3_FOV, [cup, clock]);
    expect(t.isVisible('cup')).toBe(true);
    expect(t.isVisible('clock')).toBe(false);
    t.update(5, head(0), QUEST3_FOV, [cup, clock]);
    expect(t.unseenFor('cup', 5)).toBe(0);
    expect(t.blindSpots(5, 3)).toEqual(['clock']);
  });

  it('turning the head away starts the clock on what is behind you', () => {
    const t = new AttentionTracker();
    t.update(0, head(0), QUEST3_FOV, [cup]);
    t.update(1, head(180), QUEST3_FOV, [cup]);
    expect(t.unseenFor('cup', 3)).toBeCloseTo(3 - 0);
    expect(t.blindSpots(3, 2)).toEqual(['cup']);
    t.update(4, head(0), QUEST3_FOV, [cup]);
    expect(t.blindSpots(4, 0)).toEqual([]);
  });

  it('a seated glance to the side reveals the side object', () => {
    const t = new AttentionTracker();
    t.update(0, head(0), QUEST3_FOV, [clock]);
    t.update(1, head(80), QUEST3_FOV, [clock]); // turn left 80°
    expect(t.isVisible('clock')).toBe(true);
  });
});
