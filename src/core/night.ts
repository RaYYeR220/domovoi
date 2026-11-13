/**
 * One night with the domovoi.
 *
 * The night is a deterministic state machine over a seed. Each tick it may ask
 * the room for things the player hasn't looked at for a while and plan one
 * change on them. The player wins by reaching dawn without letting too many
 * changes pile up; catching a change (framing it) puts it right.
 *
 * It never touches geometry. The XR layer answers "what is unseen right now"
 * and "can this plan be applied here", and renders the result.
 */

import {
  ANOMALIES,
  type AnomalyDef,
  type AnomalyKind,
  type AnomalyPlan,
  type Candidate,
  paramsFor,
} from './anomalies.js';
import { type Rng, createRng, range, weightedPick } from './rng.js';

export interface NightOptions {
  seed: number;
  /** 1-based count of nights this player has had; unlocks new tricks. */
  nightIndex: number;
  /** Length of the night in seconds of play (pauses don't count). */
  duration: number;
  /** Unresolved changes at which the room "tips" and the night is lost. */
  loseAt: number;
  /** Seconds before the first trick. */
  firstDelay: number;
  /** A thing must be out of sight at least this long to be touched. */
  minUnseen: number;
  /** Gap between tricks at the start and at the end of the night, seconds. */
  gapStart: number;
  gapEnd: number;
  /** Force the very first trick (used by the first-night tutorial). */
  firstKind?: AnomalyKind;
}

export const DEFAULT_NIGHT: Omit<NightOptions, 'seed' | 'nightIndex'> = {
  duration: 420,
  loseAt: 5,
  firstDelay: 14,
  minUnseen: 1.2,
  gapStart: 26,
  gapEnd: 11,
};

export type NightStatus = 'running' | 'won' | 'lost';

export interface ActiveAnomaly {
  plan: AnomalyPlan;
  appliedAt: number;
}

export interface NightResult {
  status: Exclude<NightStatus, 'running'>;
  caught: number;
  missed: number;
  falseReports: number;
  tricks: number;
  /** 0–3 */
  stars: number;
  fastestCatch: number | null;
}

export type NightEvent =
  | { type: 'trick'; plan: AnomalyPlan }
  | { type: 'caught'; plans: AnomalyPlan[]; elapsed: number }
  | { type: 'nothing'; elapsed: number }
  | { type: 'unease'; level: number }
  | { type: 'end'; result: NightResult };

/** What the night needs from the room each tick. */
export interface RoomView {
  candidates(): readonly Candidate[];
  /** Apply the change. Return false if it cannot happen here (no room to slide, etc.). */
  apply(plan: AnomalyPlan): boolean;
}

export class Night {
  readonly opts: NightOptions;
  private readonly rng: Rng;
  private clock = 0;
  private nextAt: number;
  private seq = 0;
  private _status: NightStatus = 'running';
  readonly active = new Map<string, ActiveAnomaly>();
  private caught: ActiveAnomaly[] = [];
  private catchTimes: number[] = [];
  private falseReports = 0;
  private tricks = 0;
  private result: NightResult | null = null;

  constructor(opts: Partial<NightOptions> & Pick<NightOptions, 'seed' | 'nightIndex'>) {
    this.opts = { ...DEFAULT_NIGHT, ...opts };
    this.rng = createRng(this.opts.seed);
    this.nextAt = this.opts.firstDelay;
  }

  get status(): NightStatus {
    return this._status;
  }

  get elapsed(): number {
    return this.clock;
  }

  /** 0 at dusk, 1 at dawn. */
  get progress(): number {
    return Math.min(1, this.clock / this.opts.duration);
  }

  /** 0..1, how close the room is to tipping. */
  get unease(): number {
    return Math.min(1, this.active.size / (this.opts.loseAt - 1));
  }

  get final(): NightResult | null {
    return this.result;
  }

  /** Advance the night by `dt` seconds of unpaused play. */
  tick(dt: number, room: RoomView): NightEvent[] {
    if (this._status !== 'running') return [];
    const events: NightEvent[] = [];
    this.clock += dt;

    if (this.clock >= this.opts.duration) {
      events.push(this.finish('won'));
      return events;
    }

    if (this.clock >= this.nextAt) {
      const plan = this.planTrick(room);
      if (plan) {
        this.active.set(plan.id, { plan, appliedAt: this.clock });
        this.tricks++;
        events.push({ type: 'trick', plan });
        events.push({ type: 'unease', level: this.unease });
        this.nextAt = this.clock + this.gap();
        if (this.active.size >= this.opts.loseAt) events.push(this.finish('lost'));
      } else {
        // Nothing is out of sight yet: the spirit waits for the player to look away.
        this.nextAt = this.clock + 0.75;
      }
    }
    return events;
  }

  /**
   * The player framed a set of things. Any active change among them is caught
   * and undone by the XR layer; an empty photo is a false report.
   */
  report(framedIds: readonly string[]): NightEvent[] {
    if (this._status !== 'running') return [];
    const framed = new Set(framedIds);
    const hits: AnomalyPlan[] = [];
    for (const [id, a] of this.active) {
      const p = a.plan;
      if (framed.has(p.targetId) || (p.partnerId != null && framed.has(p.partnerId))) {
        hits.push(p);
        this.caught.push(a);
        this.catchTimes.push(this.clock - a.appliedAt);
        this.active.delete(id);
      }
    }
    if (hits.length > 0) {
      return [
        { type: 'caught', plans: hits, elapsed: this.clock },
        { type: 'unease', level: this.unease },
      ];
    }
    this.falseReports++;
    // A wrong accusation emboldens the spirit: the next trick comes sooner.
    this.nextAt = Math.min(this.nextAt, this.clock + this.gap() * 0.5);
    return [{ type: 'nothing', elapsed: this.clock }];
  }

  /** End early (player quit). Counts as lost but keeps the tallies. */
  abandon(): NightEvent {
    return this.finish('lost');
  }

  private finish(status: 'won' | 'lost'): NightEvent {
    this._status = status;
    const caught = this.caught.length;
    const missed = this.active.size;
    let stars = 0;
    if (status === 'won') {
      stars = 1;
      const total = caught + missed;
      if (total === 0 || caught / total >= 0.75) stars = 2;
      if (missed === 0 && this.falseReports <= 1 && caught > 0) stars = 3;
    }
    this.result = {
      status,
      caught,
      missed,
      falseReports: this.falseReports,
      tricks: this.tricks,
      stars,
      fastestCatch: this.catchTimes.length ? Math.min(...this.catchTimes) : null,
    };
    return { type: 'end', result: this.result };
  }

  private gap(): number {
    const t = this.progress;
    const base = this.opts.gapStart + (this.opts.gapEnd - this.opts.gapStart) * t;
    return base * range(this.rng, 0.8, 1.2);
  }

  /** Subtlety the spirit aims for right now: blatant early, sly late. */
  private targetSubtlety(): number {
    return 1 + 3 * this.progress + Math.min(1, (this.opts.nightIndex - 1) * 0.25);
  }

  private planTrick(room: RoomView): AnomalyPlan | null {
    const all = room.candidates();
    const busyTargets = new Set<string>();
    for (const a of this.active.values()) {
      busyTargets.add(a.plan.targetId);
      if (a.plan.partnerId) busyTargets.add(a.plan.partnerId);
    }
    const unseen = all.filter(
      (c) => c.unseenFor >= this.opts.minUnseen && !busyTargets.has(c.id) && !c.busy,
    );
    if (unseen.length === 0) return null;

    const known = ANOMALIES.filter((d) => d.unlockNight <= this.opts.nightIndex);
    const forced = this.seq === 0 ? this.opts.firstKind : undefined;
    const want = this.targetSubtlety();

    // Try a few times: the chosen trick may not fit any unseen target.
    for (let attempt = 0; attempt < 6; attempt++) {
      const def: AnomalyDef | undefined = forced
        ? known.find((d) => d.kind === forced) ?? ANOMALIES.find((d) => d.kind === forced)
        : weightedPick(this.rng, known, (d) => {
            const fits = unseen.some(d.appliesTo);
            if (!fits) return 0;
            const closeness = 1 / (1 + Math.abs(d.subtlety - want));
            return closeness * closeness;
          });
      if (!def) return null;
      const targets = unseen
        .filter(def.appliesTo)
        // Prefer whatever the player has neglected longest.
        .sort((a, b) => b.unseenFor - a.unseenFor);
      if (targets.length < def.arity) {
        if (forced) return null; // wait until the forced trick can happen
        continue;
      }
      const pickFrom = targets.slice(0, Math.max(def.arity, 3));
      const i = Math.floor(this.rng() * pickFrom.length);
      const target = pickFrom[i];
      const partner =
        def.arity === 2 ? pickFrom.filter((c) => c.id !== target.id)[0] : undefined;
      if (def.arity === 2 && !partner) continue;
      const intensity = 1 - this.progress;
      const plan: AnomalyPlan = {
        id: `t${++this.seq}`,
        kind: def.kind,
        targetId: target.id,
        partnerId: partner?.id,
        params: paramsFor(def.kind, this.rng, intensity),
        subtlety: def.subtlety,
        at: this.clock,
      };
      if (room.apply(plan)) return plan;
      this.seq--;
      if (forced) return null;
    }
    return null;
  }
}
