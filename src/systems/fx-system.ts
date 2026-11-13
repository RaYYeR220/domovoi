/**
 * Presentation: the spirit itself, the viewfinder between your hands, sparkle
 * bursts, and the overlays that make your real lamp, screen, window, plant and
 * pictures misbehave.
 */

import { Group, Quaternion, Vector3, createSystem, type Entity } from '@iwsdk/core';
import type { AnomalyPlan } from '../core/anomalies.js';
import type { V3 } from '../core/vec.js';
import type { Game, GameEvent, RealEffects } from '../game/game.js';
import type { Prop } from '../game/props.js';
import type { RealThing } from '../game/room.js';
import type { BurstVisual, FrameCorners, SpiritVisual, Toggle, ViewfinderVisual, Visual } from '../visuals/types.js';
import { visuals } from '../visuals/index.js';
import type { GestureState } from './game-system.js';

interface Overlay {
  entity: Entity;
  visual: Toggle;
  /** Dispose after fading out. */
  disposeAt: number;
}

const v = (p: V3) => new Vector3(p.x, p.y, p.z);

export class FxSystem extends createSystem({}) {
  private game!: Game;
  private gesture!: GestureState;
  private spirit!: SpiritVisual;
  private spiritRoot = new Group();
  private viewfinder!: ViewfinderVisual;
  private bursts: BurstVisual[] = [];
  private burstIndex = 0;
  private readonly overlays = new Map<string, Overlay>();
  private readonly flames = new Map<string, { visual: Toggle; entity: Entity }>();
  private readonly ambient: Visual[] = [];
  private spiritTarget = new Vector3();
  private spiritPresence = 0;
  private spiritPresenceTarget = 0;
  private glimpseUntil = 0;
  private lastProgress = 0;
  private readonly corners: FrameCorners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly look = new Vector3();
  private readonly hq = new Quaternion();

  init(): void {
    this.game = this.globals.game as Game;
    this.gesture = this.globals.gesture as GestureState;

    this.spirit = visuals.createSpirit();
    this.spiritRoot.add(this.spirit.object);
    this.world.createTransformEntity(this.spiritRoot, { parent: this.world.sceneEntity, persistent: true });
    this.spirit.setPresence(0);

    this.viewfinder = visuals.createViewfinder();
    this.world.createTransformEntity(this.viewfinder.object, { parent: this.world.sceneEntity, persistent: true });

    for (let i = 0; i < 4; i++) {
      const b = visuals.createBurst();
      this.bursts.push(b);
      this.world.createTransformEntity(b.object, { parent: this.world.sceneEntity, persistent: true });
    }

    const hidden = ((this.globals as Record<string, unknown>).photoHidden ??= []) as import('@iwsdk/core').Object3D[];
    hidden.push(this.viewfinder.object, ...this.bursts.map((b) => b.object));
    this.game.realEffects = this.realEffects;
    this.cleanupFuncs.push(this.game.on((e) => this.onGame(e)));
  }

  private burst(at: V3, color?: number): void {
    const b = this.bursts[this.burstIndex++ % this.bursts.length];
    b.play(v(at), color);
  }

  private onGame(e: GameEvent): void {
    switch (e.type) {
      case 'phase':
        if (e.phase === 'arrival') {
          this.placeSpiritInFront(0.85);
          this.spirit.setMood('curious');
          this.spiritPresenceTarget = 1;
        }
        if (e.phase === 'night') {
          this.spirit.setMood('sly');
          this.spirit.hop();
          // It slips away into the room once the night begins.
          setTimeout(() => {
            if (this.game.phase === 'night') this.spiritPresenceTarget = 0;
          }, 2500);
        }
        if (e.phase === 'dawn') {
          this.placeSpiritInFront(0.8);
          this.spirit.setMood('sleepy');
          this.spiritPresenceTarget = 1;
        }
        break;
      case 'placed':
        this.onPlaced(e.prop);
        break;
      case 'trick':
        this.maybeGlimpse(e.at);
        break;
      case 'caught':
        for (const p of e.at) this.burst(p, 0xffc070);
        this.peekAt(e.at[0], 'caught');
        break;
      case 'snap':
        this.viewfinder.flash();
        break;
    }
  }

  private onPlaced(prop: Prop): void {
    // The spirit dashes to the spot; a sparkle as the thing appears.
    this.spiritTarget.set(prop.cur.pos.x, prop.cur.pos.y + prop.height + 0.08, prop.cur.pos.z);
    this.spirit.hop();
    this.burst(prop.center, 0xffd9a0);
    prop.onState((s) => this.setFlame(prop, s.lit));
  }

  private setFlame(prop: Prop, lit: boolean): void {
    if (prop.kind !== 'candle' && prop.kind !== 'lantern') return;
    let f = this.flames.get(prop.id);
    if (!f) {
      const visual = visuals.createFlame();
      const holder = new Group();
      holder.add(visual.object);
      // Wick height: near the top of the candlestick; lantern: middle.
      holder.position.set(0, prop.kind === 'candle' ? prop.height * 0.98 : prop.height * 0.42, 0);
      const entity = this.world.createTransformEntity(holder, { parent: prop.entity });
      f = { visual, entity };
      this.flames.set(prop.id, f);
    }
    f.visual.setActive(lit, false);
  }

  private placeSpiritInFront(dist: number): void {
    const seat = this.game.seat;
    const head = seat?.head ?? this.game.head.position;
    const yaw = seat?.yaw ?? 0;
    // Prefer the top closest to straight ahead.
    let best: V3 | null = null;
    let bestScore = Infinity;
    for (const t of this.game.tops) {
      const dx = t.center.x - head.x;
      const dz = t.center.z - head.z;
      const bearing = Math.atan2(-dx, -dz) - yaw;
      const d = Math.hypot(dx, dz);
      const score = Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing))) * 2 + Math.abs(d - dist);
      if (score < bestScore && d > 0.4 && d < 2.2) {
        bestScore = score;
        best = t.center;
      }
    }
    if (best) this.spiritTarget.set(best.x, best.y + 0.12, best.z);
    else this.spiritTarget.set(head.x - Math.sin(yaw) * dist, head.y - 0.25, head.z - Math.cos(yaw) * dist);
    if (this.spiritPresence < 0.05) this.spiritRoot.position.copy(this.spiritTarget);
  }

  /** Sometimes the spirit is glimpsed at the edge of your vision, on the side it was busy. */
  private maybeGlimpse(at: V3[]): void {
    if (at.length === 0 || Math.random() > 0.45) return;
    const head = this.game.head;
    const p = at[0];
    const toward = new Vector3(p.x - head.position.x, 0, p.z - head.position.z).normalize();
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.headQuat());
    fwd.y = 0;
    fwd.normalize();
    // Peek from just inside the edge of the view, on that side.
    const side = Math.sign(fwd.x * toward.z - fwd.z * toward.x) || 1;
    const angle = (this.game.fov.left + this.game.fov.right) / 2 - 0.12;
    const dir = fwd.clone().applyAxisAngle(new Vector3(0, 1, 0), side * angle);
    this.spiritRoot.position.set(
      head.position.x + dir.x * 1.6,
      head.position.y - 0.35,
      head.position.z + dir.z * 1.6,
    );
    this.spiritTarget.copy(this.spiritRoot.position).addScaledVector(dir, 0.6);
    this.spirit.setMood('sly');
    this.glimpseUntil = this.game.time + 0.9;
    this.spiritPresenceTarget = 0.85;
  }

  private peekAt(p: V3 | undefined, mood: 'caught' | 'happy'): void {
    if (!p) return;
    this.spiritRoot.position.set(p.x, p.y + 0.22, p.z);
    this.spiritTarget.set(p.x, p.y + 0.3, p.z);
    this.spirit.setMood(mood);
    this.spirit.hop();
    this.glimpseUntil = this.game.time + 1.4;
    this.spiritPresenceTarget = 1;
  }

  private headQuat(): Quaternion {
    const o = this.game.head.orientation;
    return this.hq.set(o.x, o.y, o.z, o.w);
  }

  update(dt: number, t: number): void {
    // Spirit motion and presence.
    if (this.game.phase === 'night' && this.glimpseUntil > 0 && this.game.time > this.glimpseUntil) {
      this.glimpseUntil = 0;
      this.spiritPresenceTarget = 0;
    }
    this.spiritPresence += (this.spiritPresenceTarget - this.spiritPresence) * Math.min(1, dt * 5);
    this.spirit.setPresence(this.spiritPresence);
    this.spiritRoot.position.lerp(this.spiritTarget, Math.min(1, dt * 3.2));
    const hp = this.game.head.position;
    this.look.set(hp.x, hp.y, hp.z);
    this.spirit.lookAt(this.look);
    this.spirit.update(dt, t);

    // Viewfinder between the hands.
    const fr = this.gesture.frame;
    if (fr) {
      fr.corners.forEach((c, i) => this.corners[i].set(c.x, c.y, c.z));
      this.viewfinder.setFrame(this.corners, this.gesture.progress);
    } else {
      this.viewfinder.setFrame(null, 0);
    }
    this.lastProgress = this.gesture.progress;
    this.viewfinder.update(dt, t);

    for (const b of this.bursts) b.update(dt, t);
    for (const f of this.flames.values()) f.visual.update(dt, t);
    for (const [id, o] of this.overlays) {
      o.visual.update(dt, t);
      if (o.disposeAt > 0 && t > o.disposeAt) {
        o.entity.dispose();
        o.visual.dispose();
        this.overlays.delete(id);
      }
    }
    for (const a of this.ambient) a.update(dt, t);
  }

  // --- Tricks on the player's real things -------------------------------------

  private readonly realEffects: RealEffects = {
    activate: (plan: AnomalyPlan, real: RealThing) => this.activateReal(plan, real),
    deactivate: (plan: AnomalyPlan) => {
      const o = this.overlays.get(plan.id);
      if (!o) return;
      o.visual.setActive(false);
      o.disposeAt = performance.now() / 1000 + 1.5;
    },
  };

  private activateReal(plan: AnomalyPlan, real: RealThing): V3 | null {
    const holder = new Group();
    let visual: Toggle;
    let focus: V3 = real.center;
    const size = new Vector3(real.size.x, real.size.y, real.size.z);
    switch (plan.kind) {
      case 'lamp-on': {
        visual = visuals.createLampGlow(size);
        holder.position.set(real.center.x, real.center.y, real.center.z);
        if (real.obb) {
          const o = real.obb.orientation;
          holder.quaternion.set(o.x, o.y, o.z, o.w);
        }
        break;
      }
      case 'plant-bloom': {
        visual = visuals.createBloom(size, plan.params.slot ?? 7);
        holder.position.set(real.center.x, real.center.y, real.center.z);
        focus = { x: real.center.x, y: real.center.y + real.size.y / 2, z: real.center.z };
        break;
      }
      case 'screen-static':
      case 'window-night':
      case 'art-twin': {
        const panel = real.panel;
        const w = panel ? panel.halfW * 2 : Math.max(real.size.x, real.size.z);
        const h = panel ? panel.halfH * 2 : real.size.y;
        const n = panel?.normal ?? this.facePlayer(real.center);
        const right = panel?.right ?? { x: -n.z, y: 0, z: n.x };
        const up = panel?.up ?? { x: 0, y: 1, z: 0 };
        let c = { ...real.center };
        if (!panel && real.obb) {
          // A screen mesh: put the overlay on the face toward the player.
          const half = Math.min(real.size.x, real.size.z) / 2;
          c = { x: c.x + n.x * (half + 0.01), y: c.y, z: c.z + n.z * (half + 0.01) };
        }
        if (plan.kind === 'art-twin') {
          c = { x: c.x + right.x * w * 1.25, y: c.y, z: c.z + right.z * w * 1.25 };
          visual = visuals.createArtTwin(w, h);
        } else if (plan.kind === 'window-night') {
          visual = visuals.createNightWindow(w, h);
        } else {
          visual = visuals.createScreenStatic(w * 0.96, h * 0.92);
        }
        holder.position.set(c.x + n.x * 0.012, c.y + n.y * 0.012, c.z + n.z * 0.012);
        holder.up.set(up.x, up.y, up.z);
        holder.lookAt(c.x + n.x, c.y + n.y, c.z + n.z);
        focus = c;
        break;
      }
      default:
        return null;
    }
    holder.add(visual.object);
    const entity = this.world.createTransformEntity(holder);
    visual.setActive(true, true);
    this.overlays.set(plan.id, { entity, visual, disposeAt: 0 });
    return focus;
  }

  private facePlayer(p: V3): V3 {
    const h = this.game.head.position;
    const d = new Vector3(h.x - p.x, 0, h.z - p.z).normalize();
    return { x: d.x, y: 0, z: d.z };
  }
}
