/** Base for on/off visuals: owns the fade and hides the tree when fully off. */

import { Group } from '@iwsdk/core';
import { Fade } from './common.js';
import type { Toggle } from './types.js';

export abstract class ToggleBase implements Toggle {
  readonly object = new Group();
  protected readonly fade: Fade;

  constructor(durIn: number, durOut: number) {
    this.fade = new Fade(durIn, durOut);
    this.object.visible = false;
  }

  get active(): boolean {
    return this.fade.on;
  }

  setActive(on: boolean, immediate = false): void {
    this.fade.set(on, immediate);
    if (on || this.fade.value > 0) this.object.visible = true;
    this.apply(this.fade.value, 0, -1);
  }

  update(dtIn: number, t: number): void {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    this.fade.update(dt);
    const vis = this.fade.value > 0;
    this.object.visible = vis;
    if (vis) this.apply(this.fade.value, dt, t);
  }

  /** f = raw linear 0..1 fade value; t < 0 means "no clock yet". */
  protected abstract apply(f: number, dt: number, t: number): void;
  abstract dispose(): void;
}
