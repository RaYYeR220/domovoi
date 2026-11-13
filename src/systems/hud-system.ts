/**
 * Everything the player reads: tiny hint cards that follow the gaze (kept in
 * the central, Glasses-safe part of the view), a moon dial on the left wrist,
 * and the dawn card with poke/pinch buttons.
 */

import {
  Follower,
  FollowBehavior,
  Group,
  PokeInteractable,
  Pressed,
  Quaternion,
  RayInteractable,
  Matrix4,
  Vector3,
  createSystem,
  type Entity,
} from '@iwsdk/core';
import qrcode from 'qrcode-generator';
import type { NightRecord } from '../core/progress.js';
import { encodeShare, giftsEarned, nextGift, streak, trust } from '../core/progress.js';
import { dateKey } from '../core/rng.js';
import { UIButton } from '../game/components.js';
import type { Game, GameEvent } from '../game/game.js';
import type { HandReader } from '../game/hands.js';
import {
  AMBER,
  CanvasPanel,
  DISPLAY,
  HAIR,
  MUTED,
  PAPER,
  TEXT,
  card,
  drawIcon,
  iconDawn,
  iconFrame,
  iconLookAway,
  iconMoon,
  loadFonts,
  roundRect,
  stars,
} from '../ui/canvas-panel.js';

type HintKind = 'none' | 'arrival' | 'look-away' | 'frame-it' | 'caught' | 'nothing' | 'pause';

export class HudSystem extends createSystem({
  pressed: { required: [UIButton, Pressed] },
}) {
  private game!: Game;
  private hands!: HandReader;
  private hint!: CanvasPanel;
  private hintEntity!: Entity;
  private hintKind: HintKind = 'none';
  private hintUntil = 0;
  private hintFade = 0;
  private dial!: CanvasPanel;
  private dialGroup = new Group();
  private dialTimer = 0;
  private dawnRoot: Entity | null = null;
  private dawnPanels: CanvasPanel[] = [];
  private qr: CanvasPanel | null = null;
  private lastRecord: NightRecord | null = null;
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly basis = new Matrix4();

  init(): void {
    this.game = this.globals.game as Game;
    this.hands = this.globals.hands as HandReader;
    loadFonts();

    this.hint = new CanvasPanel(0.44, 0.075, 2200);
    this.hint.opacity = 0;
    this.hintEntity = this.world.createTransformEntity(this.hint.mesh, { parent: this.world.sceneEntity, persistent: true });
    this.hintEntity.addComponent(Follower, {
      target: this.player.head,
      offsetPosition: [0, -0.2, -0.66],
      behavior: FollowBehavior.FaceTarget,
      maxAngle: 18,
      tolerance: 0.15,
      speed: 4,
    });

    this.dial = new CanvasPanel(0.056, 0.056, 4000);
    this.dial.mesh.renderOrder = 12;
    this.dialGroup.add(this.dial.mesh);
    this.world.createTransformEntity(this.dialGroup, { parent: this.world.sceneEntity, persistent: true });
    this.dialGroup.visible = false;

    const hidden = ((this.globals as Record<string, unknown>).photoHidden ??= []) as import('@iwsdk/core').Object3D[];
    hidden.push(this.hint.mesh, this.dialGroup);
    this.cleanupFuncs.push(this.game.on((e) => this.onGame(e)));
    this.queries.pressed.subscribe('qualify', (entity) => {
      this.onButton(entity.getValue(UIButton, 'action') as string);
    });
  }

  private onGame(e: GameEvent): void {
    const introduced = this.game.save.introduced;
    switch (e.type) {
      case 'phase':
        if (e.phase === 'arrival') this.showHint('arrival', 6);
        if (e.phase === 'night' && !introduced) this.showHint('look-away', 999);
        if (e.phase === 'night') this.hideDawn();
        break;
      case 'trick':
        if (!introduced && this.hintKind === 'look-away') this.showHint('frame-it', 999);
        break;
      case 'caught':
        this.showHint('caught', 2.6);
        break;
      case 'snap':
        if (!e.caught && e.framedIds.length > 0) this.showHint('nothing', 2.2);
        break;
      case 'dawn':
        this.lastRecord = e.record;
        this.showHint('none', 0);
        this.showDawn(e.record);
        break;
    }
  }

  private showHint(kind: HintKind, seconds: number): void {
    this.hintKind = kind;
    this.hintUntil = this.game.time + seconds;
    if (kind === 'none') return;
    this.hint.draw((ctx, w, h) => {
      const text: Record<HintKind, [string, string]> = {
        none: ['', ''],
        arrival: ['Someone is moving in.', 'Stay seated and watch your things.'],
        'look-away': ['It only moves things', 'when you look away.'],
        'frame-it': ['Something changed.', 'Frame it with both hands.'],
        caught: ['Caught.', 'It put it back.'],
        nothing: ['Nothing changed there.', 'Somewhere, a small giggle.'],
        pause: ['Paused.', ''],
      };
      const [a, b] = text[kind];
      const titleFont = `600 ${h * 0.3}px ${DISPLAY}`;
      const subFont = `400 ${h * 0.21}px ${TEXT}`;
      ctx.font = titleFont;
      const ta = ctx.measureText(a).width;
      ctx.font = subFont;
      const tb = ctx.measureText(b).width;
      const pad = h * 0.2;
      const icon = h - pad * 2;
      const contentW = pad * 1.2 + icon + pad + Math.max(ta, tb) + pad * 1.6;
      const x0 = (w - contentW) / 2;
      ctx.save();
      ctx.translate(x0, 0);
      card(ctx, contentW, h, 0.5);
      const iconFn =
        kind === 'look-away' ? iconLookAway : kind === 'frame-it' ? iconFrame : kind === 'arrival' ? iconMoon : iconDawn;
      drawIcon(ctx, iconFn, pad * 1.2, pad, icon, kind === 'caught' ? AMBER : PAPER);
      const x = pad * 1.2 + icon + pad;
      ctx.fillStyle = PAPER;
      ctx.font = titleFont;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(a, x, h * 0.47);
      ctx.fillStyle = MUTED;
      ctx.font = subFont;
      ctx.fillText(b, x, h * 0.78);
      ctx.restore();
    });
  }

  update(dt: number): void {
    // Hint card fade.
    const want = this.hintKind !== 'none' && this.game.time < this.hintUntil && !this.game.paused ? 1 : 0;
    this.hintFade += (want - this.hintFade) * Math.min(1, dt * 6);
    this.hint.opacity = this.hintFade;
    if (want === 0 && this.hintFade < 0.02) this.hintKind = this.hintKind === 'none' ? 'none' : this.hintKind;

    this.updateDial(dt);
  }

  /** The moon dial rides the back of the left wrist. */
  private updateDial(dt: number): void {
    const left = this.hands.left;
    const night = this.game.night;
    const show = left.tracked && this.game.phase === 'night' && night != null;
    this.dialGroup.visible = show;
    if (!show || !night) return;
    const j = left.joints;
    const wrist = j.wrist;
    const mid = j['middle-finger-metacarpal'];
    const idx = j['index-finger-metacarpal'];
    const pinky = j['pinky-finger-metacarpal'];
    // Hand frame: forward along the hand, side across the knuckles, normal out of the back of the hand.
    const fwd = new Vector3(mid.x - wrist.x, mid.y - wrist.y, mid.z - wrist.z).normalize();
    const side = new Vector3(idx.x - pinky.x, idx.y - pinky.y, idx.z - pinky.z).normalize();
    const back = new Vector3().crossVectors(side, fwd).normalize(); // left hand: back of hand
    this.dialGroup.position.set(wrist.x, wrist.y, wrist.z).addScaledVector(fwd, -0.035).addScaledVector(back, 0.03);
    const m = new Vector3().crossVectors(fwd, back);
    const basis = this.basis;
    basis.makeBasis(m.normalize(), fwd, back);
    this.tmpQ.setFromRotationMatrix(basis);
    this.dialGroup.quaternion.copy(this.tmpQ);

    this.dialTimer -= dt;
    if (this.dialTimer > 0) return;
    this.dialTimer = 0.25;
    const progress = night.progress;
    const active = night.active.size;
    const loseAt = night.opts.loseAt;
    this.dial.draw((ctx, w, h) => {
      const c = w / 2;
      ctx.beginPath();
      ctx.arc(c, c, c - 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(23, 18, 13, 0.88)';
      ctx.fill();
      ctx.lineWidth = w * 0.01;
      ctx.strokeStyle = HAIR;
      ctx.stroke();
      // Night arc: from dusk (left) over the top to dawn (right).
      ctx.lineCap = 'round';
      ctx.lineWidth = w * 0.035;
      ctx.strokeStyle = 'rgba(243, 236, 224, 0.18)';
      ctx.beginPath();
      ctx.arc(c, c * 1.08, c * 0.66, Math.PI, 0);
      ctx.stroke();
      ctx.strokeStyle = AMBER;
      ctx.beginPath();
      ctx.arc(c, c * 1.08, c * 0.66, Math.PI, Math.PI + Math.PI * progress);
      ctx.stroke();
      const a = Math.PI + Math.PI * progress;
      drawIcon(ctx, iconMoon, c + Math.cos(a) * c * 0.66 - w * 0.07, c * 1.08 + Math.sin(a) * c * 0.66 - w * 0.07, w * 0.14, PAPER);
      // Unease pips: unresolved changes in the room.
      for (let i = 0; i < loseAt - 1; i++) {
        const x = c + (i - (loseAt - 2) / 2) * w * 0.11;
        ctx.beginPath();
        ctx.arc(x, h * 0.72, w * 0.028, 0, Math.PI * 2);
        if (i < active) {
          ctx.fillStyle = AMBER;
          ctx.fill();
        } else {
          ctx.lineWidth = w * 0.01;
          ctx.strokeStyle = MUTED;
          ctx.stroke();
        }
      }
      const left = Math.max(0, night.opts.duration - night.elapsed);
      ctx.fillStyle = MUTED;
      ctx.font = `500 ${w * 0.085}px ${TEXT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, c, h * 0.9);
    });
  }

  // --- Dawn ------------------------------------------------------------------

  private showDawn(record: NightRecord): void {
    this.hideDawn();
    const root = new Group();
    const seat = this.game.seat;
    const yaw = seat?.yaw ?? 0;
    const head = seat?.head ?? { x: 0, y: 1.2, z: 0 };
    const dir = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    root.position.set(head.x + dir.x * 0.75, head.y - 0.12, head.z + dir.z * 0.75);
    root.rotation.set(-0.12, yaw, 0, 'YXZ');
    this.dawnRoot = this.world.createTransformEntity(root);
    ((this.globals as Record<string, unknown>).photoHidden as import('@iwsdk/core').Object3D[] | undefined)?.push(root);

    const panel = new CanvasPanel(0.46, 0.3, 2200);
    this.dawnPanels.push(panel);
    const save = this.game.save;
    const today = dateKey(new Date());
    const s = streak(save, today);
    const gifts = giftsEarned(save);
    const next = nextGift(save);
    const t = trust(save);
    const won = record.status === 'won';
    panel.draw((ctx, w, h) => {
      card(ctx, w, h, 0.06);
      const pad = w * 0.07;
      drawIcon(ctx, won ? iconDawn : iconMoon, pad, pad * 0.9, h * 0.13, AMBER);
      ctx.fillStyle = PAPER;
      ctx.font = `600 ${h * 0.12}px ${DISPLAY}`;
      ctx.fillText(won ? 'Dawn.' : 'The room tipped.', pad + h * 0.17, pad * 0.9 + h * 0.105);
      ctx.fillStyle = MUTED;
      ctx.font = `400 ${h * 0.05}px ${TEXT}`;
      const label = record.kind === 'official' ? `Night ${record.index}` : record.kind === 'shared' ? 'A shared night' : 'Practice night';
      ctx.fillText(`${label} · ${record.date}`, pad + h * 0.17, pad * 0.9 + h * 0.17);

      const y0 = h * 0.42;
      const col = (x: number, big: string, small: string) => {
        ctx.fillStyle = PAPER;
        ctx.font = `500 ${h * 0.13}px ${DISPLAY}`;
        ctx.fillText(big, x, y0);
        ctx.fillStyle = MUTED;
        ctx.font = `400 ${h * 0.045}px ${TEXT}`;
        ctx.fillText(small, x, y0 + h * 0.065);
      };
      col(pad, String(record.caught), 'caught');
      col(pad + w * 0.2, String(record.missed), 'missed');
      col(pad + w * 0.4, String(s), s === 1 ? 'night in a row' : 'nights in a row');
      stars(ctx, pad + w * 0.66, y0 - h * 0.045, h * 0.075, record.stars);

      ctx.strokeStyle = HAIR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, h * 0.56);
      ctx.lineTo(w - pad, h * 0.56);
      ctx.stroke();

      ctx.fillStyle = PAPER;
      ctx.font = `italic 400 ${h * 0.055}px ${DISPLAY}`;
      const newest = gifts[gifts.length - 1];
      const line = newest && record.kind === 'official'
        ? newest.note
        : next
          ? `It is starting to trust you (${t}/${next.at}).`
          : 'It trusts you completely.';
      ctx.fillText(line, pad, h * 0.65);
    });
    panel.mesh.position.set(0, 0.06, 0);
    root.add(panel.mesh);

    const buttons: Array<[string, string]> = [
      ['again', 'Another night'],
      ['share', 'Share this night'],
      ['done', 'Done'],
    ];
    buttons.forEach(([action, text], i) => {
      const b = new CanvasPanel(0.135, 0.044, 2400);
      this.dawnPanels.push(b);
      b.draw((ctx, w, h) => {
        roundRect(ctx, 2, 2, w - 4, h - 4, h / 2 - 2);
        ctx.fillStyle = i === 0 ? AMBER : 'rgba(243, 236, 224, 0.1)';
        ctx.fill();
        ctx.strokeStyle = i === 0 ? AMBER : HAIR;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = i === 0 ? '#17120d' : PAPER;
        ctx.font = `600 ${h * 0.38}px ${TEXT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 + 1);
      });
      b.mesh.position.set((i - 1) * 0.15, -0.115, 0.004);
      const e = this.world.createTransformEntity(b.mesh, { parent: this.dawnRoot! });
      e.addComponent(UIButton, { action });
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
    });
  }

  private hideDawn(): void {
    if (this.dawnRoot) {
      this.dawnRoot.dispose();
      this.dawnRoot = null;
    }
    for (const p of this.dawnPanels) p.dispose();
    this.dawnPanels = [];
    this.qr = null;
  }

  private onButton(action: string): void {
    if (action === 'again') {
      this.hideDawn();
      this.game.again();
    } else if (action === 'share') {
      this.showQr();
    } else if (action === 'done') {
      this.hideDawn();
      this.world.exitXR();
    }
  }

  private showQr(): void {
    if (!this.dawnRoot || this.qr || !this.lastRecord) return;
    const code = encodeShare(this.lastRecord.seed, this.lastRecord.index);
    const link = `${location.origin}${location.pathname}?night=${code}`;
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    const n = qr.getModuleCount();
    const panel = new CanvasPanel(0.2, 0.24, 2200);
    panel.draw((ctx, w, h) => {
      card(ctx, w, h, 0.08);
      const size = w * 0.72;
      const x0 = (w - size) / 2;
      const y0 = w * 0.12;
      ctx.fillStyle = PAPER;
      roundRect(ctx, x0 - 10, y0 - 10, size + 20, size + 20, 14);
      ctx.fill();
      ctx.fillStyle = '#17120d';
      const cell = size / n;
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x0 + c * cell, y0 + r * cell, cell + 0.5, cell + 0.5);
      ctx.fillStyle = PAPER;
      ctx.textAlign = 'center';
      ctx.font = `600 ${h * 0.055}px ${DISPLAY}`;
      ctx.fillText('Same night, another house.', w / 2, y0 + size + h * 0.1);
      ctx.fillStyle = MUTED;
      ctx.font = `400 ${h * 0.04}px ${TEXT}`;
      ctx.fillText(`?night=${code}`, w / 2, y0 + size + h * 0.16);
    });
    panel.mesh.position.set(0.34, 0.04, 0.02);
    panel.mesh.rotation.y = -0.35;
    this.dawnRoot.object3D!.add(panel.mesh);
    this.dawnPanels.push(panel);
    this.qr = panel;
  }
}
