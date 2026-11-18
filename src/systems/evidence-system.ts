/**
 * Spirit photographs and the evidence board.
 *
 * A photo is rendered from the player's eye through the hand frame. Passthrough
 * pixels aren't available to the web, so the camera sees the room the way the
 * headset understands it: the scanned room mesh, drawn in soft sepia, with the
 * spirit's things in it. It develops in front of you like a Polaroid and, if it
 * caught something, flies to a cork board hung on your real wall. The board is
 * held by a persistent spatial anchor, so tomorrow it is on the same wall.
 */

import {
  CanvasTexture,
  Color,
  Matrix4,
  type Entity,
  Group,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  XRAnchor,
  XRMesh,
  XRPlane,
  createSystem,
} from '@iwsdk/core';
import type { AnomalyPlan } from '../core/anomalies.js';
import { pickBoardSpot } from '../core/board-spot.js';
import type { V3 } from '../core/vec.js';
import type { Game, GameEvent } from '../game/game.js';
import { type StoredPhoto, loadPhotos, savePhoto } from '../game/photo-store.js';
import { PROP_NAME } from '../game/props.js';
import type { BoardVisual, PolaroidVisual } from '../visuals/types.js';
import { visuals } from '../visuals/index.js';

const PHOTO_LAYER = 3;

/** Linear 8-bit to sRGB 8-bit (plain render targets are written in linear light). */
const SRGB_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  SRGB_LUT[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
}
const PHOTO_SIZE = 384;
const BOARD_W = 0.8;
const BOARD_H = 0.56;
const BOARD_SLOTS = 12;
const BOARD_KEY = 'domovoi.board.v1';
const ANCHOR_KEY = 'iwsdk_scene_anchor_uuid';

/** The scanned room as the "spirit film" sees it: faceted, warm, fading with depth. */
const ghostMaterial = new ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vView;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vView;
    void main() {
      vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
      float light = 0.45 + 0.55 * clamp(dot(n, normalize(vec3(0.35, 0.8, 0.45))), 0.0, 1.0);
      float depth = clamp((-vView.z - 0.5) / 6.0, 0.0, 1.0);
      vec3 near = vec3(0.97, 0.9, 0.78);
      vec3 far = vec3(0.46, 0.4, 0.33);
      vec3 col = mix(near * light, far, depth * 0.7);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

interface Flying {
  visual: PolaroidVisual;
  group: Group;
  entity?: Entity;
  born: number;
  caught: boolean;
  slot: number;
  phase: 'develop' | 'fly' | 'pinned' | 'fall';
  from: Vector3;
  fromQ: Quaternion;
}

export class EvidenceSystem extends createSystem({
  meshes: { required: [XRMesh] },
  planes: { required: [XRPlane] },
}) {
  private game!: Game;
  private board: BoardVisual | null = null;
  private boardGroup = new Group();
  private boardEntity: Entity | null = null;
  private boardRestored = false;
  private anchorAtStart: string | null = null;
  private sessionClock = 0;
  private readonly polaroids: Flying[] = [];
  private readonly rt = new WebGLRenderTarget(PHOTO_SIZE, PHOTO_SIZE);
  private readonly cam = new PerspectiveCamera(24, 1, 0.03, 30);
  private readonly pixels = new Uint8Array(PHOTO_SIZE * PHOTO_SIZE * 4);
  private readonly canvas = document.createElement('canvas');
  private readonly tmp = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly clearColor = new Color();
  private caughtTonight = 0;
  private readonly ghosts = new Map<Mesh, Mesh>();
  private readonly desired = new Matrix4();
  private readonly inv = new Matrix4();
  private attachedAt = -1;
  private boardFixed = false;
  private readonly flyDest = new Vector3();
  private readonly flyQ = new Quaternion();
  private lastCaught: AnomalyPlan[] = [];

  init(): void {
    this.game = this.globals.game as Game;
    (this.globals as Record<string, unknown>).photoHidden ??= [] as Object3D[];
    this.canvas.width = PHOTO_SIZE;
    this.canvas.height = PHOTO_SIZE;
    this.cam.layers.set(0);
    this.cam.layers.enable(PHOTO_LAYER);

    // The room as the photo sees it. Scene-understanding meshes are invisible, so
    // their "ghosts" live as separate photo-only objects, re-synced before each shot.
    const ghostify = (e: Entity) => {
      const obj = e.object3D;
      if (!(obj instanceof Mesh) || this.ghosts.has(obj)) return;
      const ghost = new Mesh(obj.geometry, ghostMaterial);
      ghost.layers.set(PHOTO_LAYER);
      ghost.matrixAutoUpdate = false;
      ghost.frustumCulled = false;
      this.scene.add(ghost);
      this.ghosts.set(obj, ghost);
    };
    const unghost = (e: Entity) => {
      const obj = e.object3D;
      const ghost = obj ? this.ghosts.get(obj as Mesh) : undefined;
      if (ghost) {
        ghost.removeFromParent();
        this.ghosts.delete(obj as Mesh);
      }
    };
    this.queries.meshes.subscribe('qualify', ghostify);
    this.queries.planes.subscribe('qualify', ghostify);
    this.queries.meshes.subscribe('disqualify', unghost);
    this.queries.planes.subscribe('disqualify', unghost);
    this.cleanupFuncs.push(this.game.on((e) => this.onGame(e)));
    try {
      this.anchorAtStart = localStorage.getItem(ANCHOR_KEY);
    } catch {
      this.anchorAtStart = null;
    }
  }

  private onGame(e: GameEvent): void {
    switch (e.type) {
      case 'phase':
        if (e.phase === 'arrival' && !this.board) this.hangBoard();
        if (e.phase === 'night') {
          this.caughtTonight = 0;
          this.updateTitle();
        }
        break;
      case 'snap':
        this.takePhoto(e.eye, e.frame ? e.frame.center : addScaled(e.eye, e.dir, 1.2), e.frame, e.framedIds, e.caught);
        break;
      case 'caught':
        this.lastCaught = e.plans;
        this.caughtTonight += e.plans.length;
        this.updateTitle();
        break;
      case 'dawn':
        this.updateTitle();
        break;
    }
  }

  private updateTitle(): void {
    const t = this.game.tonight;
    const label = t.kind === 'official' ? `Night ${t.index}` : t.kind === 'shared' ? 'A shared night' : 'Practice';
    this.board?.setTitle(`${label} · ${this.caughtTonight} caught`);
  }

  // --- The board ---------------------------------------------------------------

  private hangBoard(): void {
    const room = this.game.room;
    const seat = this.game.seat;
    if (!seat) return;
    const wall = room ? pickBoardSpot(room.panels, room.furniture, seat.head, seat.yaw, { w: BOARD_W, h: BOARD_H }) : null;
    this.game.boardOnWall = wall != null;
    this.boardGroup.scale.setScalar(wall?.scale ?? 1);
    if (wall) {
      this.boardGroup.position.set(wall.at.x, wall.at.y, wall.at.z);
      this.boardGroup.up.set(0, 1, 0);
      this.boardGroup.lookAt(wall.at.x + wall.normal.x, wall.at.y + wall.normal.y, wall.at.z + wall.normal.z);
    } else {
      // No walls known: the board leans in the air, front-left, facing you.
      const yaw = seat.yaw + 0.55;
      // A little above eye level, clear of the spirit's own shelves below it.
      this.boardGroup.position.set(seat.head.x - Math.sin(yaw) * 1.5, seat.head.y + 0.4, seat.head.z - Math.cos(yaw) * 1.5);
      this.boardGroup.lookAt(seat.head.x, seat.head.y + 0.4, seat.head.z);
    }
    this.board = visuals.createBoard(BOARD_W, BOARD_H);
    this.boardGroup.add(this.board.object);
    this.boardGroup.updateMatrixWorld(true);
    this.desired.copy(this.boardGroup.matrixWorld);
    this.boardEntity = this.world.createTransformEntity(this.boardGroup);
    this.boardEntity.addComponent(XRAnchor);
    const bp = this.boardGroup.position;
    this.game.boardAt = { x: bp.x, y: bp.y, z: bp.z };
    this.updateTitle();
    // Last nights' evidence goes back up.
    loadPhotos().then((photos) => {
      const caught = photos.filter((p) => p.caught).slice(-BOARD_SLOTS + 2);
      for (const p of caught) this.pinStored(p);
    });
  }

  /**
   * Same anchor as yesterday: put the board exactly where it was. Otherwise keep
   * it where it was hung today, expressed relative to the anchor, and remember it.
   */
  private persistBoard(): void {
    if (!this.boardEntity || this.boardRestored) return;
    if (!this.boardEntity.getValue(XRAnchor, 'attached')) return;
    if (this.attachedAt < 0) {
      this.attachedAt = this.sessionClock;
      return;
    }
    // Give the anchor a moment to take its pose, then wait for its id (a new
    // anchor only gets one once it has been made persistent).
    if (this.sessionClock - this.attachedAt < 0.3) return;
    let now: string | null = null;
    let saved: { uuid: string; p: number[]; q: number[] } | null = null;
    try {
      now = localStorage.getItem(ANCHOR_KEY);
      saved = JSON.parse(localStorage.getItem(BOARD_KEY) ?? 'null');
    } catch {
      this.boardRestored = true;
      return;
    }
    const obj = this.boardGroup;
    const restoredAnchor = now != null && now === this.anchorAtStart;
    if (saved && restoredAnchor && saved.uuid === now) {
      obj.position.fromArray(saved.p);
      obj.quaternion.fromArray(saved.q);
      this.boardRestored = true;
      console.info('[domovoi] evidence board restored to its spot from last time');
    } else {
      if (!this.boardFixed) {
        // attach() keeps the world pose from before the anchor pose arrived:
        // re-express today's spot relative to the anchor as it is now.
        const parent = obj.parent;
        if (parent) {
          parent.updateWorldMatrix(true, false);
          this.inv.copy(parent.matrixWorld).invert();
          this.inv.multiply(this.desired).decompose(obj.position, obj.quaternion, obj.scale);
        }
        this.boardFixed = true;
      }
      if (now == null) {
        // No persistent id yet; give up quietly after a while (no persistence here).
        if (this.sessionClock - this.attachedAt > 15) this.boardRestored = true;
        return;
      }
      try {
        localStorage.setItem(BOARD_KEY, JSON.stringify({ uuid: now, p: obj.position.toArray(), q: obj.quaternion.toArray() }));
      } catch {
        // Storage blocked: the board just won't remember its spot.
      }
      this.boardRestored = true;
    }
    obj.updateWorldMatrix(true, false);
    const wp = obj.getWorldPosition(this.tmp);
    this.game.boardAt = { x: wp.x, y: wp.y, z: wp.z };
  }

  private nextSlot(): number {
    const used = new Set(this.polaroids.filter((p) => p.caught).map((p) => p.slot));
    for (let i = 0; i < BOARD_SLOTS; i++) if (!used.has(i)) return i;
    // Board full: the oldest comes down.
    const oldest = this.polaroids.find((p) => p.caught && p.phase === 'pinned');
    if (oldest) this.removePolaroid(oldest);
    return oldest?.slot ?? 0;
  }

  private placeOnBoard(f: Flying): void {
    if (!this.board) return;
    const s = this.board.slotTransform(f.slot, BOARD_SLOTS);
    this.boardGroup.add(f.group);
    f.group.position.set(s.x, s.y, 0.002 + f.slot * 0.0004);
    f.group.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), s.rotZ);
    f.group.scale.setScalar(1);
    (f.visual as PolaroidVisual & { setPinned?: (b: boolean) => void }).setPinned?.(true);
  }

  private pinStored(p: StoredPhoto): void {
    const img = new Image();
    img.onload = () => {
      const visual = visuals.createPolaroid();
      const tex = new CanvasTexture(imageToCanvas(img));
      tex.colorSpace = SRGBColorSpace;
      visual.setImage(tex);
      visual.setDevelop(1);
      visual.setCaption(p.caption);
      const group = new Group();
      group.add(visual.object);
      const f: Flying = {
        visual,
        group,
        born: -999,
        caught: true,
        slot: this.nextSlot(),
        phase: 'pinned',
        from: new Vector3(),
        fromQ: new Quaternion(),
      };
      this.polaroids.push(f);
      this.placeOnBoard(f);
    };
    img.src = p.image;
  }

  private removePolaroid(f: Flying): void {
    if (f.entity && f.phase !== 'pinned') f.entity.dispose();
    f.group.removeFromParent();
    f.visual.dispose();
    const i = this.polaroids.indexOf(f);
    if (i >= 0) this.polaroids.splice(i, 1);
  }

  // --- Taking a photo --------------------------------------------------------------

  private takePhoto(eye: V3, target: V3, frame: { width: number; height: number; center: V3 } | null, ids: string[], caught: boolean): void {
    const canvas = this.renderPhoto(eye, target, frame);
    const visual = visuals.createPolaroid();
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    visual.setImage(tex);
    visual.setDevelop(0);
    const what = caught && this.lastCaught.length ? this.describeTrick(this.lastCaught[0]) : this.describe(ids);
    this.lastCaught = [];
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const caption = caught ? `${what} · ${time}` : `nothing amiss · ${time}`;
    visual.setCaption(caption);
    (visual as PolaroidVisual & { setPinned?: (b: boolean) => void }).setPinned?.(false);

    // The print slides out in front of you, just below the frame.
    const group = new Group();
    group.add(visual.object);
    const dir = new Vector3(target.x - eye.x, target.y - eye.y, target.z - eye.z).normalize();
    const at = new Vector3(eye.x, eye.y, eye.z).addScaledVector(dir, 0.42);
    at.y -= 0.09;
    group.position.copy(at);
    group.lookAt(eye.x, eye.y, eye.z);
    const entity = this.world.createTransformEntity(group);
    const f: Flying = {
      visual,
      group,
      entity,
      born: this.game.time,
      caught,
      slot: caught ? this.nextSlot() : -1,
      phase: 'develop',
      from: new Vector3(),
      fromQ: new Quaternion(),
    };
    this.polaroids.push(f);

    if (caught) {
      savePhoto({
        id: `p${Date.now()}`,
        date: this.game.tonight.date,
        caption,
        caught,
        image: canvas.toDataURL('image/jpeg', 0.8),
        createdAt: Date.now(),
      });
    }
  }

  private describeTrick(plan: AnomalyPlan): string {
    const prop = this.game.props.get(plan.targetId);
    const name = prop ? PROP_NAME[prop.kind] : this.describe([plan.targetId]);
    switch (plan.kind) {
      case 'shift':
        return `${name}, moved`;
      case 'turn':
        return `${name}, turned`;
      case 'vanish':
        return `${name}, gone`;
      case 'flip':
        return `${name}, upside down`;
      case 'grow':
        return `${name}, grown`;
      case 'shrink':
        return `${name}, shrunk`;
      case 'swap':
        return `${name}, swapped`;
      case 'state':
        return prop?.kind === 'frame' ? `${name}, crooked` : prop?.kind === 'clock' ? `${name}, hours ahead` : `${name}, lit`;
      case 'appear':
      case 'shelf-guest':
        return 'a visitor on the shelf';
      case 'lamp-on':
        return 'your lamp, on';
      case 'screen-static':
        return 'your screen, snowing';
      case 'plant-bloom':
        return 'your plant, in bloom';
      case 'art-twin':
        return 'your picture, twice';
      case 'window-night':
        return 'your window, at night';
      default:
        return name;
    }
  }

  private describe(ids: string[]): string {
    for (const id of ids) {
      const p = this.game.props.get(id);
      if (p) return PROP_NAME[p.kind];
    }
    for (const id of ids) {
      const r = this.game.room?.reals.find((x) => x.id === id);
      if (r) return `your ${r.label.replace('_frame', '').replace('wall_art', 'picture')}`;
    }
    return 'something';
  }

  private syncGhosts(): void {
    for (const [src, ghost] of this.ghosts) {
      src.updateWorldMatrix(true, false);
      ghost.matrix.copy(src.matrixWorld);
      ghost.matrixWorld.copy(src.matrixWorld);
      if (ghost.geometry !== src.geometry) ghost.geometry = src.geometry;
    }
  }

  private renderPhoto(eye: V3, target: V3, frame: { width: number; height: number; center: V3 } | null): HTMLCanvasElement {
    const renderer = this.renderer;
    this.syncGhosts();
    const dist = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
    const extent = frame ? Math.max(frame.width, frame.height) : dist * 0.42;
    const fov = (2 * Math.atan(extent / 2 / Math.max(0.05, frame ? dist : dist))) * (180 / Math.PI);
    this.cam.fov = Math.min(70, Math.max(10, fov));
    this.cam.position.set(eye.x, eye.y, eye.z);
    this.cam.lookAt(target.x, target.y, target.z);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);

    const hidden = (this.globals.photoHidden as Object3D[]) ?? [];
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    for (const f of this.polaroids) if (f.phase !== 'pinned') f.group.visible = false;

    const xrEnabled = renderer.xr.enabled;
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(this.clearColor);
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x4a3e31, 1);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, PHOTO_SIZE, PHOTO_SIZE, this.pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.xr.enabled = xrEnabled;

    hidden.forEach((o, i) => (o.visible = was[i]));
    for (const f of this.polaroids) f.group.visible = true;

    // Pixels come bottom-up and in linear light; flip and encode to sRGB.
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(PHOTO_SIZE, PHOTO_SIZE);
    const row = PHOTO_SIZE * 4;
    const px = this.pixels;
    const lut = SRGB_LUT;
    for (let y = 0; y < PHOTO_SIZE; y++) {
      const src = (PHOTO_SIZE - 1 - y) * row;
      const dst = y * row;
      for (let i = 0; i < row; i += 4) {
        img.data[dst + i] = lut[px[src + i]];
        img.data[dst + i + 1] = lut[px[src + i + 1]];
        img.data[dst + i + 2] = lut[px[src + i + 2]];
        img.data[dst + i + 3] = 255;
      }
    }
    const out = document.createElement('canvas');
    out.width = PHOTO_SIZE;
    out.height = PHOTO_SIZE;
    out.getContext('2d')!.putImageData(img, 0, 0);
    return out;
  }

  update(dt: number, t: number): void {
    this.sessionClock += dt;
    this.persistBoard();
    this.board?.update(dt, t);
    const now = this.game.time;
    for (let i = this.polaroids.length - 1; i >= 0; i--) {
      const f = this.polaroids[i];
      f.visual.update(dt, t);
      const age = now - f.born;
      if (f.phase === 'develop') {
        f.visual.setDevelop(Math.min(1, age / 2.4));
        f.group.position.y += dt * 0.004; // a gentle float in the hand
        if (age > 3.2) {
          if (f.caught && this.board) {
            f.phase = 'fly';
            f.from.copy(f.group.getWorldPosition(this.tmp));
            f.fromQ.copy(f.group.getWorldQuaternion(this.tmpQ));
            f.born = now;
          } else {
            f.phase = 'fall';
            f.born = now;
          }
        }
      } else if (f.phase === 'fly') {
        const k = Math.min(1, (now - f.born) / 1.1);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const s = this.board!.slotTransform(f.slot, BOARD_SLOTS);
        const dest = this.flyDest.set(s.x, s.y, 0.002).applyMatrix4(this.boardGroup.matrixWorld);
        const destQ = this.boardGroup.getWorldQuaternion(this.flyQ);
        f.group.position.lerpVectors(f.from, dest, e);
        f.group.position.y += Math.sin(Math.PI * e) * 0.12;
        f.group.quaternion.slerpQuaternions(f.fromQ, destQ, e);
        // Arrive at the board's own size (it may be hung smaller in a tight spot).
        f.group.scale.setScalar(1 + (this.boardGroup.scale.x - 1) * e);
        if (k >= 1) {
          f.phase = 'pinned';
          f.group.removeFromParent();
          this.placeOnBoard(f);
        }
      } else if (f.phase === 'fall') {
        const k = (now - f.born) / 0.9;
        f.group.position.y -= dt * 0.25 * k;
        f.group.scale.setScalar(Math.max(0.001, 1 - k));
        if (k >= 1) this.removePolaroid(f);
      }
    }
  }
}

function addScaled(a: V3, d: V3, s: number): V3 {
  return { x: a.x + d.x * s, y: a.y + d.y * s, z: a.z + d.z * s };
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

