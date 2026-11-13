/**
 * Sound. Quiet by design: the room tone and crickets sit under everything, the
 * clock ticks where the clock is, and every trick leaves a soft sound where it
 * happened, the one hint you get about which way to look.
 */

import { AudioSource, AudioUtils, type Entity, PlaybackMode, createSystem } from '@iwsdk/core';
import type { V3 } from '../core/vec.js';
import type { Game, GameEvent } from '../game/game.js';
import type { Prop } from '../game/props.js';

const A = (f: string) => `${import.meta.env.BASE_URL}audio/${f}`;

export class AudioDirectorSystem extends createSystem({}) {
  private game!: Game;
  private room: Entity | null = null;
  private crickets: Entity | null = null;
  private musicBox: Entity | null = null;
  private clock: Entity | null = null;

  init(): void {
    this.game = this.globals.game as Game;
    this.cleanupFuncs.push(this.game.on((e) => this.onGame(e)));
  }

  private loop(src: string, volume: number, at?: V3, parent?: Entity): Entity {
    const e = this.world.createTransformEntity(undefined, parent ? { parent } : { parent: this.world.sceneEntity, persistent: true });
    if (at) e.object3D!.position.set(at.x, at.y, at.z);
    e.addComponent(AudioSource, {
      src,
      loop: true,
      volume,
      positional: Boolean(at || parent),
      refDistance: 0.6,
      rolloffFactor: 1.4,
      autoplay: false,
      playbackMode: PlaybackMode.Ignore,
    });
    return e;
  }

  private once(file: string, volume: number, at?: V3): void {
    AudioUtils.createOneShot(this.world, A(file), {
      volume,
      positional: Boolean(at),
      position: at,
    });
  }

  private onGame(e: GameEvent): void {
    switch (e.type) {
      case 'phase':
        if (e.phase === 'arrival') {
          this.room ??= this.loop(A('room-tone-loop.ogg'), 0.16);
          AudioUtils.play(this.room, 2);
          this.musicBox ??= this.loop(A('music-box-loop.ogg'), 0.18);
          AudioUtils.play(this.musicBox, 1.5);
        }
        if (e.phase === 'night') {
          if (this.musicBox) AudioUtils.pause(this.musicBox, 3);
          this.crickets ??= this.loop(A('night-crickets-loop.ogg'), 0.2);
          AudioUtils.play(this.crickets, 3);
          if (this.clock) AudioUtils.play(this.clock, 1);
          this.once('wood-creak.mp3', 0.25);
        }
        if (e.phase === 'dawn') {
          if (this.crickets) AudioUtils.pause(this.crickets, 2);
          if (this.clock) AudioUtils.pause(this.clock, 1);
          this.once('dawn-birdsong.mp3', 0.5);
          this.once('bell-tree.mp3', 0.35);
        }
        break;
      case 'placed':
        this.onPlaced(e.prop);
        break;
      case 'trick': {
        const at = e.at[0];
        if (!at) break;
        const kind = e.plan.kind;
        if (kind === 'lamp-on') this.once('lamp-click.mp3', 0.45, at);
        else if (kind === 'state') this.once('shimmer.mp3', 0.3, at);
        else if (kind === 'appear' || kind === 'shelf-guest') this.once('cup-clink.mp3', 0.3, at);
        else if (kind === 'screen-static') this.once('xylophone-blink.mp3', 0.25, at);
        else this.once(Math.random() < 0.5 ? 'wood-creak.mp3' : 'cloth-rustle.mp3', 0.32, at);
        break;
      }
      case 'snap':
        this.once('shutter.mp3', 0.55);
        setTimeout(() => this.once('polaroid.mp3', 0.45), 220);
        if (!e.caught && e.framedIds.length > 0) {
          // The spirit giggles from somewhere you aren't looking.
          const h = this.game.head.position;
          const o = this.game.head.orientation;
          const behind = { x: h.x + 2 * (o.x * o.z + o.w * o.y) * 1.8, y: h.y - 0.3, z: h.z + (1 - 2 * (o.x * o.x + o.y * o.y)) * 1.8 };
          setTimeout(() => this.once('tee-hee.mp3', 0.4, behind), 500);
        }
        break;
      case 'caught':
        this.once('catch-chime.mp3', 0.6, e.at[0]);
        setTimeout(() => this.once('pin-cork.mp3', 0.35), 4300);
        break;
    }
  }

  private onPlaced(prop: Prop): void {
    this.once('shimmer.mp3', 0.18, prop.center);
    if (prop.kind === 'clock' && !this.clock) {
      this.clock = this.loop(A('clock-tick-loop.ogg'), 0.32, undefined, prop.entity);
      AudioUtils.play(this.clock, 1);
    }
  }
}
