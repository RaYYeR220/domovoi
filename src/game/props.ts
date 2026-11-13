/**
 * The spirit's household things: loading, placing on real surfaces, and the
 * physical side of every trick (and of undoing it when caught).
 */

import {
  AssetManager,
  Box3,
  ContactShadow,
  CylinderGeometry,
  DepthOccludable,
  type Entity,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
  type World,
} from '@iwsdk/core';
import type { PropKind } from '../core/anomalies.js';
import type { Top } from '../core/placement.js';
import type { V3 } from '../core/vec.js';
import { SpiritThing } from './components.js';

export const PROP_ASSET: Record<PropKind, string> = {
  teacup: 'prop-teacup',
  'milk-bowl': 'prop-milk-bowl',
  candle: 'prop-candle',
  clock: 'prop-clock',
  plant: 'prop-plant',
  books: 'prop-books',
  frame: 'prop-frame',
  jug: 'prop-jug',
  toy: 'prop-toy',
  lantern: 'prop-lantern',
  apple: 'prop-apple',
  spectacles: 'prop-spectacles',
  watch: 'prop-watch',
  spoon: 'prop-spoon',
};

/** Friendly names, used on polaroid captions. */
export const PROP_NAME: Record<PropKind, string> = {
  teacup: 'the teacup',
  'milk-bowl': 'the milk bowl',
  candle: 'the candle',
  clock: 'the clock',
  plant: 'the little plant',
  books: 'the books',
  frame: 'the picture',
  jug: 'the jug',
  toy: 'the wooden elephant',
  lantern: 'the lantern',
  apple: 'the apple',
  spectacles: 'your spectacles',
  watch: 'the pocket watch',
  spoon: 'the spoon',
};

export async function preloadProps(): Promise<void> {
  await Promise.all(
    Object.values(PROP_ASSET).map((id) =>
      AssetManager.loadGLTFById(id).catch((e) => console.warn('[props] failed to load', id, e)),
    ),
  );
}

interface Pose {
  pos: Vector3;
  yaw: number;
  scale: number;
  flip: number; // 0 upright, 1 upside down
}

interface Tween {
  from: Pose;
  to: Pose;
  t: number;
  dur: number;
  fadeFrom: number;
  fadeTo: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Prop {
  readonly id: string;
  readonly kind: PropKind;
  readonly entity: Entity;
  readonly root: Group;
  /** Model inside root; root carries position/yaw, pivot handles flip/scale. */
  private readonly pivot: Group;
  readonly height: number;
  readonly radius: number;
  topId: string;
  home: Pose;
  cur: Pose;
  /** 0..1 visibility (vanished = 0). */
  presence = 1;
  private tween: Tween | null = null;
  /** Prop-specific state toggles (candle lit, frame tilted, clock jumped…). */
  state = { lit: false, tilted: false, jumped: false };
  /** Clock hands (alarm clock asset), with their resting rotations. */
  private hands: { hour: Object3D; minute: Object3D; second: Object3D; rest: Quaternion[] } | null = null;
  private tickClock = 0;
  private readonly stateHooks: Array<(s: Prop['state']) => void> = [];

  constructor(world: World, id: string, kind: PropKind, topId: string, at: V3, yaw: number) {
    this.id = id;
    this.kind = kind;
    this.topId = topId;
    this.root = new Group();
    this.root.name = id;
    this.pivot = new Group();
    this.root.add(this.pivot);
    const gltf = AssetManager.getGLTF(PROP_ASSET[kind]);
    const model: Object3D = gltf?.scene ?? fallbackModel();
    model.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.pivot.add(model);
    if (kind === 'clock') {
      const hour = model.getObjectByName('houd_hand') ?? model.getObjectByName('hour_hand');
      const minute = model.getObjectByName('minute_hand');
      const second = model.getObjectByName('second_hand');
      if (hour && minute && second) {
        this.hands = { hour, minute, second, rest: [hour.quaternion.clone(), minute.quaternion.clone(), second.quaternion.clone()] };
      }
    }
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    this.height = Math.max(0.02, size.y);
    this.radius = Math.max(0.03, Math.hypot(size.x, size.z) / 2);
    // Sit the model on its base even if the asset's pivot isn't at the bottom.
    model.position.y -= box.min.y;

    this.home = { pos: new Vector3(at.x, at.y, at.z), yaw, scale: 1, flip: 0 };
    this.cur = clonePose(this.home);
    this.applyPose(this.cur, 1);

    this.entity = world.createTransformEntity(this.root);
    this.entity.addComponent(SpiritThing, { thingId: id });
    // Real objects in front (a vase, your hand) hide the spirit's things.
    this.entity.addComponent(DepthOccludable);
    const shadow = world.createTransformEntity(new Group(), { parent: this.entity });
    shadow.object3D!.position.set(0, 0.002, 0);
    shadow.addComponent(ContactShadow, {
      size: [size.x * 1.7 + 0.04, size.z * 1.7 + 0.04],
      opacity: 0.38,
    });
  }

  private readonly centerCache: V3 = { x: 0, y: 0, z: 0 };

  /** Where the eye should look to "see" this prop (cached object, updated on read). */
  get center(): V3 {
    const p = this.cur.pos;
    const c = this.centerCache;
    c.x = p.x;
    c.y = p.y + this.height * 0.5 * this.cur.scale;
    c.z = p.z;
    return c;
  }

  get hidden(): boolean {
    return this.presence < 0.5;
  }

  onState(fn: (s: Prop['state']) => void): void {
    this.stateHooks.push(fn);
  }

  setState(next: Partial<Prop['state']>): void {
    Object.assign(this.state, next);
    for (const fn of this.stateHooks) fn(this.state);
    // The picture "leans" when tilted.
    if (this.kind === 'frame') this.pivot.rotation.z = this.state.tilted ? MathUtils.degToRad(18) : 0;
    // The clock: when it "jumps", the time is suddenly wrong and the second hand stops.
    if (this.hands) {
      const [h, m, s] = this.hands.rest;
      this.hands.hour.quaternion.copy(h);
      this.hands.minute.quaternion.copy(m);
      this.hands.second.quaternion.copy(s);
      if (this.state.jumped) {
        this.hands.hour.quaternion.premultiply(FACE_TURN.setFromAxisAngle(FACE_AXIS, -MathUtils.degToRad(105)));
        this.hands.minute.quaternion.premultiply(FACE_TURN.setFromAxisAngle(FACE_AXIS, -MathUtils.degToRad(160)));
      }
    }
  }

  /** Change instantly (the player isn't looking). */
  set(pose: Partial<Pose>, presence = this.presence): void {
    this.tween = null;
    Object.assign(this.cur, pose, pose.pos ? { pos: pose.pos.clone() } : {});
    this.presence = presence;
    this.applyPose(this.cur, presence);
  }

  /** Animate (the player is watching, e.g. putting things right). */
  animateTo(pose: Partial<Pose>, presence: number, dur = 0.7): void {
    const to = { ...clonePose(this.cur), ...pose };
    if (pose.pos) to.pos = pose.pos.clone();
    this.tween = { from: clonePose(this.cur), to, t: 0, dur, fadeFrom: this.presence, fadeTo: presence };
  }

  restoreHome(dur = 0.8): void {
    this.animateTo(this.home, 1, dur);
    this.setState({ lit: false, tilted: false, jumped: false });
  }

  update(dt: number): void {
    // A real clock ticks: one step of the second hand a second (unless time has stopped).
    if (this.hands && !this.state.jumped) {
      this.tickClock += dt;
      if (this.tickClock >= 1) {
        this.tickClock -= 1;
        this.hands.second.quaternion.premultiply(FACE_TURN.setFromAxisAngle(FACE_AXIS, -MathUtils.degToRad(6)));
      }
    }
    if (!this.tween) return;
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const k = ease(tw.t);
    this.cur.pos.lerpVectors(tw.from.pos, tw.to.pos, k);
    // A little lift in the middle reads as "carried back".
    const lift = Math.sin(Math.PI * k) * 0.05 * (tw.from.pos.distanceTo(tw.to.pos) > 0.02 ? 1 : 0);
    this.cur.yaw = tw.from.yaw + shortestAngle(tw.from.yaw, tw.to.yaw) * k;
    this.cur.scale = MathUtils.lerp(tw.from.scale, tw.to.scale, k);
    this.cur.flip = MathUtils.lerp(tw.from.flip, tw.to.flip, k);
    this.presence = MathUtils.lerp(tw.fadeFrom, tw.fadeTo, k);
    this.applyPose(this.cur, this.presence, lift);
    if (tw.t >= 1) this.tween = null;
  }

  private applyPose(p: Pose, presence: number, lift = 0): void {
    this.root.position.set(p.pos.x, p.pos.y + lift, p.pos.z);
    this.root.rotation.set(0, p.yaw, 0);
    const s = p.scale * (presence <= 0.001 ? 0.0001 : 0.6 + 0.4 * presence);
    this.pivot.scale.setScalar(s);
    this.pivot.rotation.x = Math.PI * p.flip;
    // Upside down, the model rotates about its base: lift it by its height.
    this.pivot.position.y = this.height * p.scale * p.flip;
    this.root.visible = presence > 0.01;
  }
}

const FACE_AXIS = new Vector3(0, 0, 1);
const FACE_TURN = new Quaternion();

function clonePose(p: Pose): Pose {
  return { pos: p.pos.clone(), yaw: p.yaw, scale: p.scale, flip: p.flip };
}

function shortestAngle(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Used only if a model failed to load: a plain little pot, never a crash. */
function fallbackModel(): Object3D {
  const mesh = new Mesh(
    new CylinderGeometry(0.035, 0.03, 0.08, 20),
    new MeshStandardMaterial({ color: 0xb08a63, roughness: 0.7 }),
  );
  mesh.position.y = 0.04;
  const g = new Group();
  g.add(mesh);
  return g;
}

/** World position on a top at in-plane offsets (s along u, t along v). */
export function onTop(top: Top, s: number, t: number): Vector3 {
  return new Vector3(
    top.center.x + top.u.x * s + top.v.x * t,
    top.center.y + top.u.y * s + top.v.y * t,
    top.center.z + top.u.z * s + top.v.z * t,
  );
}
