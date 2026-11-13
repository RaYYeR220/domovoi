/**
 * Contracts for the procedural visuals. Every visual is a plain Three.js
 * object tree plus a per-frame update; the game systems own placement,
 * timing and lifetime.
 */

import type { Object3D, Texture, Vector3 } from '@iwsdk/core';

export interface Visual {
  /** Root to add under an entity's object3D. */
  readonly object: Object3D;
  /** Called every frame while alive. dt and t in seconds. */
  update(dt: number, t: number): void;
  dispose(): void;
}

/** A visual that fades/animates in and out. */
export interface Toggle extends Visual {
  /** Animate to on/off. `immediate` skips the animation. */
  setActive(on: boolean, immediate?: boolean): void;
  readonly active: boolean;
}

export type SpiritMood = 'idle' | 'curious' | 'sly' | 'caught' | 'happy' | 'sleepy';

/** The domovoi: a small warm ember of fluff with two bead eyes. ~9 cm across. */
export interface SpiritVisual extends Visual {
  setMood(mood: SpiritMood): void;
  /** Eyes and body lean toward a world point. */
  lookAt(worldPoint: Vector3): void;
  /** 0..1 overall presence (0 = invisible, for dashing through blind spots). */
  setPresence(p: number): void;
  /** Little hop/bounce, e.g. when it giggles. */
  hop(): void;
}

/** Corners in world space, ordered around the rectangle. */
export type FrameCorners = [Vector3, Vector3, Vector3, Vector3];

/** The hand viewfinder overlay drawn between the player's hands. */
export interface ViewfinderVisual extends Visual {
  /** null hides it. progress 0..1 fills the shutter ring. */
  setFrame(corners: FrameCorners | null, progress: number): void;
  /** White flash + shutter feedback at the current frame. */
  flash(): void;
}

/** A polaroid card (8.8 × 10.7 cm) whose image "develops" over a few seconds. */
export interface PolaroidVisual extends Visual {
  setImage(tex: Texture): void;
  /** 0 = blank/dark, 1 = fully developed. */
  setDevelop(v: number): void;
  /** Handwritten-style caption under the image, e.g. "the teacup · 9:41 pm". */
  setCaption(text: string): void;
}

/** Cork evidence board, hung on a real wall. Size in metres. */
export interface BoardVisual extends Visual {
  /** Local position (on the board plane) for slot i of n, with a slight random tilt. */
  slotTransform(i: number, n: number): { x: number; y: number; rotZ: number };
  /** Title card text, e.g. "Night 3 · 5 caught · 1 missed". */
  setTitle(text: string): void;
}

/** Sparkle burst where a change is caught and undone. */
export interface BurstVisual extends Visual {
  play(at: Vector3, color?: number): void;
}

export interface VisualFactories {
  createSpirit(): SpiritVisual;
  createViewfinder(): ViewfinderVisual;
  createPolaroid(): PolaroidVisual;
  createBoard(width: number, height: number): BoardVisual;
  createBurst(): BurstVisual;
  /** Warm halo + light cone over a real lamp. size = lamp bounding box (m). */
  createLampGlow(size: Vector3): Toggle;
  /** Snow/static on a real screen's front face. */
  createScreenStatic(width: number, height: number): Toggle;
  /** A night sky with a moon "through" a real window. */
  createNightWindow(width: number, height: number): Toggle;
  /** Small flowers opening on a real plant. size = plant bounding box. */
  createBloom(size: Vector3, seed: number): Toggle;
  /** A second picture frame appearing next to real wall art. */
  createArtTwin(width: number, height: number): Toggle;
  /** Lit flame for the candle prop (state trick). */
  createFlame(): Toggle;
}
