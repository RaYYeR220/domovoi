/**
 * The game controller: glues the engine-free core (attention, night, hand
 * frame, placement, progress) to the live XR room.
 */

import { type Entity, Vector3, type World } from '@iwsdk/core';
import type { AnomalyPlan, Candidate, PropKind } from '../core/anomalies.js';
import { AttentionTracker, type Fov, QUEST3_FOV, type Pose, isInView } from '../core/attention.js';
import { type Frame, coneContains, frameContains } from '../core/frame-gesture.js';
import { Night, type NightEvent, type NightResult, type RoomView } from '../core/night.js';
import {
  type Placement,
  type Seat,
  type Top,
  assignProps,
  candidateSpots,
  chooseSpots,
  clampToTop,
  syntheticShelves,
} from '../core/placement.js';
import {
  type NightPlan,
  type NightRecord,
  type SaveData,
  decodeShare,
  loadSave,
  planTonight,
  recordNight,
} from '../core/progress.js';
import { createRng } from '../core/rng.js';
import { DEG, type V3, distance, yawOf } from '../core/vec.js';
import { Prop } from './props.js';
import { hangSpiritShelves } from './shelves.js';
import type { RealThing, RoomModel } from './room.js';

export type Phase = 'lobby' | 'scanning' | 'arrival' | 'night' | 'dawn';

export type GameEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'placed'; prop: Prop }
  | { type: 'trick'; plan: AnomalyPlan; at: V3[] }
  | { type: 'caught'; plans: AnomalyPlan[]; at: V3[] }
  | { type: 'nothing' }
  | { type: 'snap'; frame: Frame | null; eye: V3; dir: V3; framedIds: string[]; caught: boolean }
  | { type: 'unease'; level: number }
  | { type: 'dawn'; result: NightResult; record: NightRecord };

type Listener = (e: GameEvent) => void;

/** Things on the first night, in the order the spirit brings them. */
const FIRST_SET: PropKind[] = ['candle', 'teacup', 'books', 'clock', 'plant', 'jug', 'toy', 'lantern', 'frame', 'milk-bowl'];
/** Things the spirit keeps in its pocket for "appear" tricks. */
const GUESTS: PropKind[] = ['spectacles', 'watch', 'spoon', 'apple'];

const SAVE_KEY = 'domovoi.save.v1';

const DEBUG = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

function logEvent(e: GameEvent): void {
  const r = (p: V3) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
  switch (e.type) {
    case 'trick':
      console.info(`[domovoi] trick ${e.plan.id} ${e.plan.kind} on ${e.plan.targetId}${e.plan.partnerId ? ' + ' + e.plan.partnerId : ''} at ${e.at.map(r).join(' ')}`);
      break;
    case 'caught':
      console.info(`[domovoi] caught ${e.plans.map((p) => p.kind + ':' + p.targetId).join(', ')}`);
      break;
    case 'snap':
      console.info(`[domovoi] snap ${e.frame ? 'frame' : 'gaze'} caught=${e.caught} ids=${e.framedIds.join(',')}`);
      break;
    case 'placed':
      console.info(`[domovoi] placed ${e.prop.id} at ${r(e.prop.cur.pos)}`);
      break;
    case 'phase':
      console.info(`[domovoi] phase ${e.phase}`);
      break;
    case 'dawn':
      console.info(`[domovoi] dawn ${JSON.stringify(e.result)}`);
      break;
    default:
      console.info(`[domovoi] ${e.type}`);
  }
}

/** Overlay hooks for tricks on the player's real things (lamp, screen, window…). */
export interface RealEffects {
  activate(plan: AnomalyPlan, real: RealThing): V3 | null;
  deactivate(plan: AnomalyPlan): void;
}

export class Game {
  readonly world: World;
  phase: Phase = 'lobby';
  save: SaveData;
  tonight: NightPlan;
  room: RoomModel | null = null;
  seat: Seat | null = null;
  tops: Top[] = [];
  readonly props = new Map<string, Prop>();
  readonly attention = new AttentionTracker({ margin: 9 * DEG });
  night: Night | null = null;
  head: Pose = { position: { x: 0, y: 1.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  fov: Fov = QUEST3_FOV;
  paused = false;
  realEffects: RealEffects | null = null;
  /** Where the evidence board hangs (set once it is up). */
  boardAt: V3 | null = null;
  /** Hung on a real wall (false: no free wall, it stands in the air in front of you). */
  boardOnWall = false;
  /** Where each active trick can be seen (for framing). */
  private readonly focus = new Map<string, V3[]>();
  private readonly guestProps = new Map<string, Prop>();
  private readonly listeners: Listener[] = [];
  private clock = 0;
  private arrivalQueue: Placement[] = [];
  private arrivalTimer = 0;
  firstCatchDone = false;
  private nightNo = 0;
  /** Caught changes are put right only after their photo is taken. */
  private pendingUndo: AnomalyPlan[] = [];
  firstTrickDone = false;

  constructor(world: World) {
    this.world = world;
    this.save = loadSave(readStorage(SAVE_KEY));
    const q = new URLSearchParams(location.search);
    const flag = (k: string) => (q.has(k) ? q.get(k) !== '0' : undefined);
    this.save.settings = {
      eyesOnly: flag('eyes') ?? this.save.settings.eyesOnly,
      captions: flag('captions') ?? this.save.settings.captions,
      reducedMotion: flag('calm') ?? this.save.settings.reducedMotion,
      highContrast: flag('contrast') ?? this.save.settings.highContrast,
    };
    const shared = decodeShare(new URLSearchParams(location.search).get('night'));
    this.tonight = planTonight(this.save, new Date(), shared);
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  emit(e: GameEvent): void {
    if (DEBUG) logEvent(e);
    for (const fn of this.listeners) fn(e);
  }

  setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.emit({ type: 'phase', phase: p });
  }

  get time(): number {
    return this.clock;
  }

  // --- Setting up the room ---------------------------------------------------

  /** Called once the room is known: decide the seat and where things go. */
  furnish(room: RoomModel, head: Pose): void {
    this.room = room;
    this.seat = { head: { ...head.position }, yaw: yawOf(head.orientation) };
    const rng = createRng(this.tonight.seed ^ 0x5eed);
    let tops = room.tops;
    let spots = chooseSpots(candidateSpots(tops, this.seat), 9, rng);
    if (spots.length < 5) {
      // Not enough real furniture (or no room scan): the spirit hangs its own shelves.
      tops = [...tops, ...syntheticShelves(this.seat)];
      spots = chooseSpots(candidateSpots(tops, this.seat), 8, rng, 0.2);
    }
    this.tops = tops;
    this.shelves = hangSpiritShelves(this.world, tops);
    const kinds = FIRST_SET.slice(0, spots.length);
    const placements = assignProps(kinds, spots, tops, this.seat);
    // Bring things in from the centre outwards so the first few land in view.
    placements.sort((a, b) => Math.abs(a.spot.bearing) - Math.abs(b.spot.bearing));
    this.arrivalQueue = placements;
    this.arrivalTimer = 1.2;
    this.setPhase('arrival');
  }

  /** The spirit's own shelves, when the room had too few surfaces. */
  private shelves: Entity[] = [];

  get syntheticTops(): Top[] {
    return this.tops.filter((t) => t.synthetic);
  }

  // --- Per-frame -------------------------------------------------------------

  update(dt: number, head: Pose, fov: Fov): void {
    this.head = head;
    this.fov = fov;
    if (this.paused) return;
    this.clock += dt;
    for (const p of this.props.values()) p.update(dt);
    for (const p of this.guestProps.values()) p.update(dt);
    this.attention.update(this.clock, head, fov, this.watchables(), this.room?.occluders ?? []);

    if (this.phase === 'arrival') this.updateArrival(dt);
    if (this.phase === 'night' && this.night) {
      this.night.quiet = this.held;
      for (const e of this.night.tick(dt, this.roomView)) this.onNightEvent(e);
    }
  }

  private updateArrival(dt: number): void {
    this.arrivalTimer -= dt;
    if (this.arrivalTimer > 0) return;
    const next = this.arrivalQueue.shift();
    if (!next) {
      this.startNight();
      return;
    }
    const prop = new Prop(this.world, next.propId, next.kind, next.spot.topId, next.spot.position, next.yaw);
    this.props.set(prop.id, prop);
    this.attention.touch(prop.id, this.clock);
    this.emit({ type: 'placed', prop });
    this.arrivalTimer = 0.9;
  }

  startNight(): void {
    const first = !this.save.introduced;
    const lengthParam = Number(new URLSearchParams(location.search).get('length'));
    const duration = Number.isFinite(lengthParam) && lengthParam >= 30 && lengthParam <= 900 ? lengthParam : undefined;
    this.nightNo++;
    this.night = new Night({
      idPrefix: `n${this.nightNo}-`,
      seed: this.tonight.seed,
      nightIndex: this.tonight.index,
      ...(duration ? { duration, gapStart: Math.min(26, duration / 8), gapEnd: Math.min(11, duration / 16) } : {}),
      firstKind: first ? (this.hasProp('candle') ? 'state' : 'vanish') : undefined,
      firstDelay: first ? 3 : 12,
    });
    this.setPhase('night');
  }

  private hasProp(kind: PropKind): boolean {
    for (const p of this.props.values()) if (p.kind === kind) return true;
    return false;
  }

  private readonly watchList: Array<{ id: string; position: V3; radius: number }> = [];
  private watchCount = -1;

  /** Everything the attention tracker watches. Rebuilt only when the set changes. */
  private watchables() {
    const synthetic = this.syntheticTops;
    const count = this.props.size + (this.room?.reals.length ?? 0) + synthetic.length;
    if (count !== this.watchCount) {
      this.watchCount = count;
      this.watchList.length = 0;
      for (const p of this.props.values()) this.watchList.push({ id: p.id, position: p.center, radius: p.radius });
      for (const r of this.room?.reals ?? []) {
        this.watchList.push({ id: r.id, position: r.center, radius: Math.max(r.size.x, r.size.y, r.size.z) * 0.35 });
      }
      for (const t of synthetic) this.watchList.push({ id: t.id, position: t.center, radius: 0.22 });
    } else {
      let i = 0;
      for (const p of this.props.values()) this.watchList[i++].position = p.center;
    }
    return this.watchList;
  }

  // --- The room as the night sees it ----------------------------------------

  readonly roomView: RoomView = {
    candidates: () => {
      const out: Candidate[] = [];
      for (const p of this.props.values()) {
        out.push({
          id: p.id,
          source: 'prop',
          propKind: p.kind,
          unseenFor: this.attention.unseenFor(p.id, this.clock),
          busy: p.hidden,
        });
      }
      for (const r of this.room?.reals ?? []) {
        out.push({ id: r.id, source: 'real', label: r.label, unseenFor: this.attention.unseenFor(r.id, this.clock) });
      }
      for (const t of this.syntheticTops) {
        // The spirit's own shelves can receive guests too.
        out.push({ id: t.id, source: 'real', label: 'shelf', unseenFor: this.attention.unseenFor(t.id, this.clock) });
      }
      return out;
    },
    apply: (plan) => this.applyTrick(plan),
  };

  private visibleNow(p: V3, radius = 0.08): boolean {
    return isInView(this.head, this.fov, p, radius, 9 * DEG);
  }

  private topById(id: string): Top | undefined {
    return this.tops.find((t) => t.id === id);
  }

  private topForReal(id: string): Top | undefined {
    return this.tops.find((t) => t.furnitureId === id || t.id === id);
  }

  private applyTrick(plan: AnomalyPlan): boolean {
    const prop = this.props.get(plan.targetId);
    switch (plan.kind) {
      case 'shift': {
        if (!prop) return false;
        const top = this.topById(prop.topId);
        if (!top) return false;
        const a = plan.params.angle;
        const d = plan.params.distance;
        const raw = {
          x: prop.cur.pos.x + (top.u.x * Math.cos(a) + top.v.x * Math.sin(a)) * d,
          y: prop.cur.pos.y,
          z: prop.cur.pos.z + (top.u.z * Math.cos(a) + top.v.z * Math.sin(a)) * d,
        };
        const dest = clampToTop(top, raw, prop.radius + 0.02);
        if (distance(dest, prop.cur.pos) < 0.08) return false;
        if (this.collides(dest, prop.radius, prop.id) || this.visibleNow(dest)) return false;
        this.focus.set(plan.id, [dest]);
        prop.set({ pos: new Vector3(dest.x, dest.y, dest.z) });
        return true;
      }
      case 'turn':
        if (!prop) return false;
        prop.set({ yaw: prop.cur.yaw + plan.params.yaw });
        this.focus.set(plan.id, [prop.center]);
        return true;
      case 'vanish':
        if (!prop || prop.hidden) return false;
        this.focus.set(plan.id, [prop.center]);
        prop.set({}, 0);
        return true;
      case 'flip':
        if (!prop) return false;
        prop.set({ flip: 1 });
        this.focus.set(plan.id, [prop.center]);
        return true;
      case 'grow':
      case 'shrink':
        if (!prop) return false;
        prop.set({ scale: plan.params.scale });
        this.focus.set(plan.id, [prop.center]);
        return true;
      case 'state':
        if (!prop) return false;
        if (prop.kind === 'frame') prop.setState({ tilted: true });
        else if (prop.kind === 'clock') prop.setState({ jumped: true });
        else prop.setState({ lit: true });
        this.focus.set(plan.id, [prop.center]);
        return true;
      case 'swap': {
        const other = plan.partnerId ? this.props.get(plan.partnerId) : undefined;
        if (!prop || !other) return false;
        const a = prop.cur.pos.clone();
        const b = other.cur.pos.clone();
        const ta = prop.topId;
        prop.set({ pos: b });
        other.set({ pos: a });
        prop.topId = other.topId;
        other.topId = ta;
        this.focus.set(plan.id, [prop.center, other.center]);
        return true;
      }
      case 'appear':
      case 'shelf-guest': {
        const top = this.topForReal(plan.targetId);
        if (!top) return false;
        const kind = GUESTS.find((k) => ![...this.guestProps.values()].some((g) => g.kind === k));
        if (!kind) return false;
        const rng = createRng(plan.params.slot ?? 1);
        for (let attempt = 0; attempt < 8; attempt++) {
          const s = (rng() * 2 - 1) * Math.max(0, top.halfU - 0.08);
          const t = (rng() * 2 - 1) * Math.max(0, top.halfV - 0.06);
          const p = {
            x: top.center.x + top.u.x * s + top.v.x * t,
            y: top.center.y,
            z: top.center.z + top.u.z * s + top.v.z * t,
          };
          if (this.collides(p, 0.07) || this.visibleNow(p)) continue;
          const guest = new Prop(this.world, `guest-${plan.id}`, kind, top.id, p, rng() * Math.PI * 2);
          this.guestProps.set(plan.id, guest);
          this.focus.set(plan.id, [guest.center]);
          return true;
        }
        return false;
      }
      default: {
        // Tricks on the player's own things.
        const real = this.room?.reals.find((r) => r.id === plan.targetId);
        if (!real || !this.realEffects) return false;
        const at = this.realEffects.activate(plan, real);
        if (!at) return false;
        this.focus.set(plan.id, [at, real.center]);
        return true;
      }
    }
  }

  private collides(p: V3, radius: number, except?: string): boolean {
    for (const q of this.props.values()) {
      if (q.id === except || q.hidden) continue;
      if (distance(p, q.cur.pos) < radius + q.radius + 0.03) return true;
    }
    for (const g of this.guestProps.values()) {
      if (distance(p, g.cur.pos) < radius + g.radius + 0.03) return true;
    }
    return false;
  }

  private undoTrick(plan: AnomalyPlan): void {
    const prop = this.props.get(plan.targetId);
    switch (plan.kind) {
      case 'appear':
      case 'shelf-guest': {
        const g = this.guestProps.get(plan.id);
        if (g) {
          g.animateTo({}, 0, 0.6);
          setTimeout(() => {
            g.entity.dispose();
            if (this.guestProps.get(plan.id) === g) this.guestProps.delete(plan.id);
          }, 800);
        }
        break;
      }
      case 'swap': {
        prop?.restoreHome();
        const other = plan.partnerId ? this.props.get(plan.partnerId) : undefined;
        other?.restoreHome();
        if (prop && other) {
          const t = prop.topId;
          prop.topId = other.topId;
          other.topId = t;
        }
        break;
      }
      case 'shift':
      case 'turn':
      case 'vanish':
      case 'flip':
      case 'grow':
      case 'shrink':
      case 'state':
        prop?.restoreHome();
        break;
      default:
        this.realEffects?.deactivate(plan);
    }
    this.focus.delete(plan.id);
  }

  // --- Reporting -------------------------------------------------------------

  /** What a photo taken with this frame (or gaze cone) shows. */
  framed(test: (p: V3) => boolean): string[] {
    const ids = new Set<string>();
    for (const p of this.props.values()) if (!p.hidden && test(p.center)) ids.add(p.id);
    for (const r of this.room?.reals ?? []) if (test(r.center)) ids.add(r.id);
    if (this.night) {
      for (const [planId, points] of this.focus) {
        const a = this.night.active.get(planId);
        if (a && points.some(test)) ids.add(a.plan.targetId);
      }
    }
    return [...ids];
  }

  /** The spirit thing (or active change) closest to a gaze ray, within a cone. */
  gazeTarget(eye: V3, dir: V3, halfAngle: number): { id: string; at: V3 } | null {
    let best: { id: string; at: V3; a: number } | null = null;
    const consider = (id: string, p: V3) => {
      const a = angleTo(eye, dir, p);
      if (a <= halfAngle && (!best || a < best.a)) best = { id, at: p, a };
    };
    for (const p of this.props.values()) if (!p.hidden) consider(p.id, p.center);
    for (const r of this.room?.reals ?? []) consider(r.id, r.center);
    if (this.night) {
      for (const [planId, points] of this.focus) {
        const a = this.night.active.get(planId);
        if (a) for (const p of points) consider(a.plan.targetId, p);
      }
    }
    const b = best as { id: string; at: V3 } | null;
    return b ? { id: b.id, at: b.at } : null;
  }

  /** A photo from the two-hand frame. */
  snapFrame(frame: Frame, eye: V3): void {
    const ids = this.framed((p) => frameContains(frame, eye, p, 0.015));
    const dir = { x: frame.center.x - eye.x, y: frame.center.y - eye.y, z: frame.center.z - eye.z };
    this.report(ids, frame, eye, dir);
  }

  /**
   * A photo along the gaze (pinch or eyes-only fallback). An eyes-only dwell is
   * just looking: it takes a photo only when something there has changed, so
   * resting your eyes on the room never fills the board with empty pictures.
   * Returns whether a photo was taken.
   */
  snapGaze(eye: V3, dir: V3, halfAngle = 7 * DEG, forgiving = false): boolean {
    const ids = this.framed((p) => coneContains(eye, dir, p, halfAngle));
    if (forgiving && !this.anyChanged(ids)) return false;
    this.report(ids, null, eye, dir, forgiving);
    return true;
  }

  /** True if any of these things is currently changed. */
  private anyChanged(ids: string[]): boolean {
    if (!this.night) return false;
    const set = new Set(ids);
    for (const a of this.night.active.values()) {
      if (set.has(a.plan.targetId) || (a.plan.partnerId != null && set.has(a.plan.partnerId))) return true;
    }
    return false;
  }

  private report(ids: string[], frame: Frame | null, eye: V3, dir: V3, forgiving = false): void {
    let caught = false;
    // Eyes-only dwell never counts as an accusation: looking around is free.
    const accuse = !forgiving || this.anyChanged(ids);
    if (this.phase === 'night' && this.night && ids.length > 0 && accuse) {
      for (const e of this.night.report(ids)) {
        if (e.type === 'caught') caught = true;
        this.onNightEvent(e);
      }
    }
    this.emit({ type: 'snap', frame, eye, dir, framedIds: ids, caught });
    // Put things right only now, after the photo has captured them changed.
    for (const plan of this.pendingUndo.splice(0)) this.undoTrick(plan);
  }

  /** Back to the start (the player left the immersive session). */
  reset(): void {
    for (const s of this.shelves) s.dispose();
    this.shelves = [];
    for (const p of this.props.values()) p.entity.dispose();
    for (const g of this.guestProps.values()) g.entity.dispose();
    if (this.night) for (const a of this.night.active.values()) this.realEffects?.deactivate(a.plan);
    this.props.clear();
    this.guestProps.clear();
    this.focus.clear();
    this.pendingUndo = [];
    this.night = null;
    this.room = null;
    this.tops = [];
    this.seat = null;
    this.boardAt = null;
    this.boardOnWall = false;
    this.watchCount = -1;
    this.setPhase('lobby');
  }

  private onNightEvent(e: NightEvent): void {
    switch (e.type) {
      case 'trick':
        this.firstTrickDone = true;
        this.emit({ type: 'trick', plan: e.plan, at: this.focus.get(e.plan.id) ?? [] });
        break;
      case 'caught': {
        const at: V3[] = [];
        for (const plan of e.plans) {
          at.push(...(this.focus.get(plan.id) ?? []));
          this.pendingUndo.push(plan);
        }
        if (!this.firstCatchDone) {
          this.firstCatchDone = true;
          this.save = { ...this.save, introduced: true };
          writeStorage(SAVE_KEY, JSON.stringify(this.save));
        }
        this.emit({ type: 'caught', plans: e.plans, at });
        break;
      }
      case 'nothing':
        this.emit({ type: 'nothing' });
        break;
      case 'unease':
        this.emit({ type: 'unease', level: e.level });
        break;
      case 'end':
        this.finishNight(e.result);
        break;
    }
  }

  private finishNight(result: NightResult): void {
    const record: NightRecord = {
      date: this.tonight.date,
      seed: this.tonight.seed,
      index: this.tonight.index,
      kind: this.tonight.kind,
      status: result.status,
      caught: result.caught,
      missed: result.missed,
      falseReports: result.falseReports,
      stars: result.stars,
    };
    this.save = recordNight(this.save, record);
    writeStorage(SAVE_KEY, JSON.stringify(this.save));
    // Dawn puts everything right.
    if (this.night) for (const a of [...this.night.active.values()]) this.undoTrick(a.plan);
    this.setPhase('dawn');
    this.emit({ type: 'dawn', result, record });
  }

  /** Start another night (practice or tomorrow's), keeping the room furnished. */
  again(): void {
    this.tonight = planTonight(this.save, new Date(), null, Math.floor(Math.random() * 1e6));
    this.startNight();
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  /** For automated tests and the room report. */
  roomReport(): Record<string, unknown> {
    const r = this.room;
    const byLabel: Record<string, number> = {};
    for (const x of r?.reals ?? []) byLabel[x.label] = (byLabel[x.label] ?? 0) + 1;
    const bearings = [...this.props.values()].map((p) => {
      const dx = p.cur.pos.x - (this.seat?.head.x ?? 0);
      const dz = p.cur.pos.z - (this.seat?.head.z ?? 0);
      let b = (this.seat?.yaw ?? 0) - Math.atan2(-dx, -dz);
      b = Math.atan2(Math.sin(b), Math.cos(b));
      return Math.round((b * 180) / Math.PI);
    });
    return {
      meshes: r?.meshCount ?? 0,
      planes: r?.planeCount ?? 0,
      tops: this.tops.filter((t) => !t.synthetic).length,
      syntheticShelves: this.syntheticTops.length,
      realThings: byLabel,
      props: this.props.size,
      propBearingsDeg: bearings.sort((a, b) => a - b),
      board: this.boardAt == null ? null : this.boardOnWall ? 'wall' : 'air',
    };
  }

  /** Scripted mode (tests, filming): the night keeps time, the spirit only plays explicit tricks. */
  held = false;
  private scriptSeq = 0;

  /** Make one specific change now (only if it can't be seen happening). */
  scriptTrick(kind: AnomalyPlan['kind'], targetId: string, partnerId?: string, params: Record<string, number> = {}): boolean {
    if (!this.night) return false;
    const plan: AnomalyPlan = {
      id: `s${++this.scriptSeq}-${kind}`,
      kind,
      targetId,
      partnerId,
      params: { angle: 0.6, distance: 0.3, yaw: 2.2, scale: 1.4, slot: 7, ...params },
      subtlety: 1,
      at: this.night.elapsed,
    };
    if (!this.applyTrick(plan)) return false;
    this.night.inject(plan);
    this.emit({ type: 'trick', plan, at: this.focus.get(plan.id) ?? [] });
    return true;
  }

  /** For automated tests: what is currently changed, and where to look. */
  activeTricks(): Array<{ id: string; kind: string; targetId: string; points: V3[] }> {
    if (!this.night) return [];
    return [...this.night.active.values()].map((a) => ({
      id: a.plan.id,
      kind: a.plan.kind,
      targetId: a.plan.targetId,
      points: this.focus.get(a.plan.id) ?? [],
    }));
  }
}

function angleTo(eye: V3, dir: V3, p: V3): number {
  const vx = p.x - eye.x;
  const vy = p.y - eye.y;
  const vz = p.z - eye.z;
  const l = Math.hypot(vx, vy, vz) * Math.hypot(dir.x, dir.y, dir.z);
  if (l < 1e-9) return 0;
  return Math.acos(Math.min(1, Math.max(-1, (vx * dir.x + vy * dir.y + vz * dir.z) / l)));
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the night still plays, it just isn't remembered.
  }
}
