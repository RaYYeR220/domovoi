/**
 * Raw WebXR hand reading: 25 joint positions per hand, plus pinch and the
 * Quest microgesture thumb tap. Kept allocation-free per frame.
 */

import { HAND_JOINTS, type HandJoints } from '../core/frame-gesture.js';

export interface HandFrame {
  joints: HandJoints;
  tracked: boolean;
  /** Pinch strength 0..1 from the hand's xr-standard gamepad (button 0). */
  pinch: number;
  /** Rising edge of the Quest thumb-tap microgesture (button 9) this frame. */
  thumbTap: boolean;
}

const JOINT_COUNT = HAND_JOINTS.length;

function makeJoints(): HandJoints {
  const j = {} as HandJoints;
  for (const name of HAND_JOINTS) j[name] = { x: 0, y: 0, z: 0 };
  return j;
}

export class HandReader {
  readonly left: HandFrame = { joints: makeJoints(), tracked: false, pinch: 0, thumbTap: false };
  readonly right: HandFrame = { joints: makeJoints(), tracked: false, pinch: 0, thumbTap: false };
  private readonly buf = new Float32Array(JOINT_COUNT * 16);
  private readonly spaces: XRJointSpace[] = new Array(JOINT_COUNT);
  private readonly lastTap = { left: false, right: false };

  update(frame: XRFrame | undefined | null, refSpace: XRReferenceSpace | null | undefined): void {
    this.left.tracked = false;
    this.right.tracked = false;
    this.left.thumbTap = false;
    this.right.thumbTap = false;
    if (!frame || !refSpace) return;
    for (const source of frame.session.inputSources) {
      const hand = source.hand;
      if (!hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
      const out = source.handedness === 'left' ? this.left : this.right;
      out.tracked = this.readJoints(frame, refSpace, hand, out);
      const pad = source.gamepad;
      out.pinch = pad?.buttons[0]?.value ?? 0;
      const tap = Boolean(pad?.buttons[9]?.pressed);
      out.thumbTap = tap && !this.lastTap[source.handedness];
      this.lastTap[source.handedness] = tap;
    }
  }

  private readJoints(frame: XRFrame, ref: XRReferenceSpace, hand: XRHand, out: HandFrame): boolean {
    for (let i = 0; i < JOINT_COUNT; i++) {
      const space = hand.get(HAND_JOINTS[i] as XRHandJoint);
      if (!space) return false;
      this.spaces[i] = space;
    }
    const fill = (frame as XRFrame & {
      fillPoses?: (spaces: XRSpace[], base: XRSpace, out: Float32Array) => boolean;
    }).fillPoses;
    if (fill) {
      if (!fill.call(frame, this.spaces, ref, this.buf)) return false;
      for (let i = 0; i < JOINT_COUNT; i++) {
        const p = out.joints[HAND_JOINTS[i]];
        p.x = this.buf[i * 16 + 12];
        p.y = this.buf[i * 16 + 13];
        p.z = this.buf[i * 16 + 14];
      }
      return true;
    }
    for (let i = 0; i < JOINT_COUNT; i++) {
      const pose = frame.getJointPose?.(this.spaces[i], ref);
      if (!pose) return false;
      const p = out.joints[HAND_JOINTS[i]];
      p.x = pose.transform.position.x;
      p.y = pose.transform.position.y;
      p.z = pose.transform.position.z;
    }
    return true;
  }
}
