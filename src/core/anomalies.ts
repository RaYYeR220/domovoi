/**
 * The spirit's repertoire. An anomaly is a *plan* (pure data); the XR layer
 * turns a plan into a visible change and can undo it when it is caught.
 */

import { type Rng, range } from './rng.js';

/** Household props the spirit brings into the room on the first night. */
export type PropKind =
  | 'teacup'
  | 'milk-bowl'
  | 'candle'
  | 'clock'
  | 'plant'
  | 'books'
  | 'frame'
  | 'jug'
  | 'toy'
  | 'lantern'
  | 'apple'
  | 'spectacles'
  | 'watch'
  | 'spoon';

/** Semantic labels Quest reports for real furniture and room parts. */
export type RealLabel =
  | 'lamp'
  | 'screen'
  | 'plant'
  | 'couch'
  | 'table'
  | 'shelf'
  | 'storage'
  | 'wall_art'
  | 'window_frame'
  | 'door_frame'
  | 'bed'
  | 'other';

export type AnomalyKind =
  | 'shift' // slides along its surface
  | 'turn' // rotates in place
  | 'vanish' // gone
  | 'appear' // something new shows up
  | 'swap' // two props trade places
  | 'flip' // upside down
  | 'grow' // a little bigger
  | 'shrink' // a little smaller
  | 'state' // prop-specific: candle lit, clock jumps, book opens, frame tilts
  | 'lamp-on' // your real lamp glows
  | 'screen-static' // your real screen shows snow
  | 'plant-bloom' // your real plant flowers
  | 'art-twin' // your real wall art gets a twin
  | 'window-night' // your real window shows a night sky
  | 'shelf-guest'; // a tiny jar appears on your real shelf

export interface Candidate {
  id: string;
  /** 'prop' = something the spirit placed; 'real' = the player's own furniture. */
  source: 'prop' | 'real';
  propKind?: PropKind;
  label?: RealLabel;
  /** Seconds this has been out of the player's sight. */
  unseenFor: number;
  /** True if a prop is currently hidden (vanished) and so can't be changed further. */
  busy?: boolean;
}

export interface AnomalyDef {
  kind: AnomalyKind;
  /** 1 = blatant, 5 = very subtle. */
  subtlety: number;
  /** First night (1-based) on which the spirit knows this trick. */
  unlockNight: number;
  /** How many targets the trick needs. */
  arity: 1 | 2;
  appliesTo: (c: Candidate) => boolean;
}

const prop = (kinds?: PropKind[]) => (c: Candidate) =>
  c.source === 'prop' && !c.busy && (!kinds || (c.propKind != null && kinds.includes(c.propKind)));
const real = (labels: RealLabel[]) => (c: Candidate) =>
  c.source === 'real' && !c.busy && c.label != null && labels.includes(c.label);

const STATEFUL: PropKind[] = ['candle', 'lantern', 'frame', 'clock'];
const FLIPPABLE: PropKind[] = ['teacup', 'milk-bowl', 'books', 'jug', 'toy', 'frame', 'clock', 'spectacles', 'spoon'];

export const ANOMALIES: readonly AnomalyDef[] = [
  { kind: 'vanish', subtlety: 1, unlockNight: 1, arity: 1, appliesTo: prop() },
  { kind: 'appear', subtlety: 1, unlockNight: 1, arity: 1, appliesTo: (c) => c.source === 'real' && !c.busy && (c.label === 'table' || c.label === 'shelf' || c.label === 'storage') },
  { kind: 'shift', subtlety: 2, unlockNight: 1, arity: 1, appliesTo: prop() },
  { kind: 'turn', subtlety: 3, unlockNight: 1, arity: 1, appliesTo: prop(['teacup', 'jug', 'toy', 'clock', 'frame', 'books', 'lantern', 'milk-bowl', 'spectacles', 'watch', 'spoon']) },
  { kind: 'state', subtlety: 2, unlockNight: 1, arity: 1, appliesTo: prop(STATEFUL) },
  { kind: 'lamp-on', subtlety: 1, unlockNight: 1, arity: 1, appliesTo: real(['lamp']) },
  { kind: 'flip', subtlety: 2, unlockNight: 2, arity: 1, appliesTo: prop(FLIPPABLE) },
  { kind: 'screen-static', subtlety: 1, unlockNight: 2, arity: 1, appliesTo: real(['screen']) },
  { kind: 'plant-bloom', subtlety: 2, unlockNight: 2, arity: 1, appliesTo: real(['plant']) },
  { kind: 'art-twin', subtlety: 2, unlockNight: 2, arity: 1, appliesTo: real(['wall_art']) },
  { kind: 'swap', subtlety: 3, unlockNight: 3, arity: 2, appliesTo: prop() },
  { kind: 'grow', subtlety: 4, unlockNight: 3, arity: 1, appliesTo: prop() },
  { kind: 'shrink', subtlety: 4, unlockNight: 3, arity: 1, appliesTo: prop() },
  { kind: 'window-night', subtlety: 1, unlockNight: 3, arity: 1, appliesTo: real(['window_frame']) },
  { kind: 'shelf-guest', subtlety: 3, unlockNight: 2, arity: 1, appliesTo: real(['shelf', 'storage']) },
];

export function defOf(kind: AnomalyKind): AnomalyDef {
  const d = ANOMALIES.find((a) => a.kind === kind);
  if (!d) throw new Error(`unknown anomaly ${kind}`);
  return d;
}

export interface AnomalyPlan {
  id: string;
  kind: AnomalyKind;
  targetId: string;
  partnerId?: string;
  /** Kind-specific numbers, all derived from the night's seed. */
  params: Record<string, number>;
  subtlety: number;
  /** Night clock time the plan was made, seconds. */
  at: number;
}

/**
 * Kind-specific parameters. Subtle tricks get smaller amounts: a teacup slid
 * 12 cm is harder to spot than one slid 35 cm.
 */
export function paramsFor(kind: AnomalyKind, rng: Rng, intensity: number): Record<string, number> {
  // intensity: 1 = obvious, 0 = subtle
  const k = Math.min(1, Math.max(0, intensity));
  switch (kind) {
    case 'shift':
      return { angle: range(rng, 0, Math.PI * 2), distance: 0.12 + 0.26 * k };
    case 'turn': {
      const sign = rng() < 0.5 ? -1 : 1;
      return { yaw: sign * (0.6 + 2.4 * k) }; // ~35°..~175°
    }
    case 'grow':
      return { scale: 1.25 + 0.35 * k };
    case 'shrink':
      return { scale: 0.75 - 0.2 * k };
    case 'state':
      return { variant: Math.floor(rng() * 3) };
    case 'appear':
      return { slot: Math.floor(rng() * 1000) };
    case 'shelf-guest':
      return { slot: Math.floor(rng() * 1000) };
    default:
      return {};
  }
}
