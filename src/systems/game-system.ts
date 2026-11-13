/**
 * Drives the Game every frame: reads the head pose, the real field of view
 * from the XR projection matrices, and the hands; turns the room scan into a
 * furnished room; turns gestures into photos.
 */

import {
  AssetManager,
  Matrix4,
  Quaternion,
  Vector3,
  VisibilityState,
  XRMesh,
  XRPlane,
  createSystem,
} from '@iwsdk/core';
import { type Fov, QUEST3_FOV, fovFromProjection, unionFov } from '../core/attention.js';
import { type Frame, Shutter, detectFrame, detectL } from '../core/frame-gesture.js';
import type { V3 } from '../core/vec.js';
import { Game } from '../game/game.js';
import { HandReader } from '../game/hands.js';
import { preloadProps } from '../game/props.js';
import { buildRoom } from '../game/room.js';

export interface GestureState {
  frame: Frame | null;
  progress: number;
  /** Head-gaze reticle target distance, for the pinch fallback. */
  gazeArmed: boolean;
}

export class GameSystem extends createSystem({
  meshes: { required: [XRMesh] },
  planes: { required: [XRPlane] },
}) {
  game!: Game;
  readonly hands = new HandReader();
  readonly gesture: GestureState = { frame: null, progress: 0, gazeArmed: false };
  private readonly shutter = new Shutter(0.55, 1.4, 0.03);
  private readonly headPos = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly fwd = new Vector3();
  private readonly m = new Matrix4();
  private sessionTime = 0;
  private assetsReady = false;
  private pinchHeld = 0;
  private pinchFired = false;
  private fov: Fov = QUEST3_FOV;

  init(): void {
    this.game = new Game(this.world);
    (this.globals as Record<string, unknown>).game = this.game;
    (this.globals as Record<string, unknown>).gesture = this.gesture;
    (this.globals as Record<string, unknown>).hands = this.hands;
    if (import.meta.env.DEV) {
      (window as unknown as { __domovoi: Game }).__domovoi = this.game;
      (window as unknown as { __assets: typeof AssetManager }).__assets = AssetManager;
    }
    preloadProps().then(() => {
      this.assetsReady = true;
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        const away = s === VisibilityState.Hidden || s === VisibilityState.VisibleBlurred;
        this.game.setPaused(away);
        if (s === VisibilityState.Visible) {
          this.world.session?.updateTargetFrameRate?.(72).catch(() => {});
        }
      }),
    );
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!inXR) {
      this.sessionTime = 0;
      return;
    }
    this.sessionTime += dt;

    // Head pose and the real field of view of this device.
    this.player.head.getWorldPosition(this.headPos);
    this.player.head.getWorldQuaternion(this.headQuat);
    const xrCam = this.renderer.xr.getCamera();
    const eyes = (xrCam as unknown as { cameras?: Array<{ projectionMatrix: { elements: ArrayLike<number> } }> }).cameras;
    if (eyes && eyes.length > 0) {
      let f = fovFromProjection(eyes[0].projectionMatrix.elements);
      for (let i = 1; i < eyes.length; i++) f = unionFov(f, fovFromProjection(eyes[i].projectionMatrix.elements));
      if (Number.isFinite(f.left) && f.left > 0.2) this.fov = f;
    }
    const head = {
      position: { x: this.headPos.x, y: this.headPos.y, z: this.headPos.z },
      orientation: { x: this.headQuat.x, y: this.headQuat.y, z: this.headQuat.z, w: this.headQuat.w },
    };

    const game = this.game;
    if (game.phase === 'lobby') game.setPhase('scanning');
    if (game.phase === 'scanning') this.tryFurnish(head);

    game.update(dt, head, this.fov);
    this.updateHands(head.position);
  }

  private tryFurnish(head: { position: V3; orientation: { x: number; y: number; z: number; w: number } }): void {
    if (!this.assetsReady) return;
    const meshes = this.queries.meshes.entities;
    const planes = this.queries.planes.entities;
    const haveRoom = meshes.size + planes.size > 0;
    // Give scene understanding a moment to report; never wait forever.
    if ((haveRoom && this.sessionTime > 2.5) || this.sessionTime > 7) {
      const room = buildRoom(meshes, planes, head.position);
      console.info(
        `[domovoi] room: ${room.meshCount} meshes, ${room.planeCount} planes, ${room.tops.length} tops, ${room.reals.length} real things`,
        room.reals.map((r) => r.label).join(','),
      );
      const p = this.player.position;
      console.info(
        `[domovoi] head world (${head.position.x.toFixed(2)}, ${head.position.y.toFixed(2)}, ${head.position.z.toFixed(2)}) player (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) rotY ${this.player.rotation.y.toFixed(2)}`,
      );
      this.game.furnish(room, head);
    }
  }

  private updateHands(eye: V3): void {
    const frame = this.xrFrame;
    const ref = this.renderer.xr.getReferenceSpace();
    this.hands.update(frame, ref);
    const game = this.game;
    const L = this.hands.left.tracked ? detectL(this.hands.left.joints) : null;
    const R = this.hands.right.tracked ? detectL(this.hands.right.joints) : null;
    const fr = detectFrame(L, R, eye) ?? detectFrame(R, L, eye);
    const canShoot = game.phase === 'night' || game.phase === 'arrival';
    const st = this.shutter.update(game.time, canShoot ? fr : null);
    this.gesture.frame = fr;
    this.gesture.progress = st.phase === 'aiming' ? st.progress : st.phase === 'snap' ? 1 : 0;
    if (st.phase === 'snap') game.snapFrame(st.frame, eye);

    // Pinch / thumb-tap fallback along the head gaze (one hand is enough).
    this.fwd.set(0, 0, -1).applyQuaternion(this.headQuat);
    const dir = { x: this.fwd.x, y: this.fwd.y, z: this.fwd.z };
    const pinch = fr ? 0 : Math.max(this.hands.left.pinch, this.hands.right.pinch);
    if (pinch > 0.9) {
      this.pinchHeld += 1 / 72;
      if (!this.pinchFired && this.pinchHeld > 0.22 && canShoot) {
        this.pinchFired = true;
        game.snapGaze(eye, dir);
      }
    } else if (pinch < 0.6) {
      this.pinchHeld = 0;
      this.pinchFired = false;
    }
    if ((this.hands.left.thumbTap || this.hands.right.thumbTap) && canShoot) game.snapGaze(eye, dir);
    this.gesture.gazeArmed = this.pinchHeld > 0;
  }
}
