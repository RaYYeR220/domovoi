/**
 * Procedural visuals for Domovoi. See ./types.ts for the contract.
 *
 * Conventions shared by all factories:
 * - Units are metres; planar visuals face +Z; `object` is a plain Group the
 *   caller places, `update(dt, t)` must run every frame while alive.
 * - Toggles start hidden (`object.visible = false`) and hide themselves again
 *   once fully faded out, so idle visuals cost no draw calls.
 * - Shaders write display-space colour directly (no tone mapping / colour
 *   management) and use premultiplied blending, so glows add light over
 *   passthrough rather than veiling it.
 */

import type { Vector3 } from '@iwsdk/core';
import { ArtTwin } from './art-twin.js';
import { Bloom } from './bloom.js';
import { Board } from './board.js';
import { Burst } from './burst.js';
import { Flame } from './flame.js';
import { LampGlow } from './lamp-glow.js';
import { NightWindow } from './night-window.js';
import { Polaroid } from './polaroid.js';
import { ScreenStatic } from './screen-static.js';
import { Spirit } from './spirit.js';
import type { VisualFactories } from './types.js';
import { Viewfinder } from './viewfinder.js';

export const visuals: VisualFactories = {
  createSpirit: () => new Spirit(),
  createViewfinder: () => new Viewfinder(),
  createPolaroid: () => new Polaroid(),
  createBoard: (width: number, height: number) => new Board(width, height),
  createBurst: () => new Burst(),
  createLampGlow: (size: Vector3) => new LampGlow(size),
  createScreenStatic: (width: number, height: number) => new ScreenStatic(width, height),
  createNightWindow: (width: number, height: number) => new NightWindow(width, height),
  createBloom: (size: Vector3, seed: number) => new Bloom(size, seed),
  createArtTwin: (width: number, height: number) => new ArtTwin(width, height),
  createFlame: () => new Flame(),
};

export { POLAROID_H, POLAROID_W } from './polaroid.js';
export type * from './types.js';
export { ArtTwin, Bloom, Board, Burst, Flame, LampGlow, NightWindow, Polaroid, ScreenStatic, Spirit, Viewfinder };
