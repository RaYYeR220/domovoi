/**
 * Crisp text panels for XR, drawn on a canvas. Warm dark glass, cream type,
 * one amber accent, hairlines instead of shadows.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';

export const INK = '#17120d';
export const PAPER = '#f3ece0';
export const AMBER = '#ffb35c';
export const MUTED = 'rgba(243, 236, 224, 0.64)';
export const HAIR = 'rgba(243, 236, 224, 0.14)';
export const DISPLAY = "'Fraunces Variable', Georgia, serif";
export const TEXT = "'Inter Variable', system-ui, sans-serif";

let fontsReady: Promise<void> | null = null;

/** Canvas text needs the faces loaded first. */
export function loadFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(`500 48px ${DISPLAY}`),
      document.fonts.load(`600 48px ${DISPLAY}`),
      document.fonts.load(`400 32px ${TEXT}`),
      document.fonts.load(`600 32px ${TEXT}`),
    ])
      .then(() => undefined)
      .catch(() => undefined);
  }
  return fontsReady;
}

export class CanvasPanel {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly widthPx: number;
  readonly heightPx: number;
  private readonly material: MeshBasicMaterial;

  /** Size in metres; `ppm` = pixels per metre (2000 ≈ crisp at arm's length). */
  constructor(
    readonly width: number,
    readonly height: number,
    ppm = 2000,
  ) {
    this.widthPx = Math.round(width * ppm);
    this.heightPx = Math.round(height * ppm);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, height), this.material);
    this.mesh.renderOrder = 10;
  }

  set opacity(v: number) {
    this.material.opacity = v;
    this.mesh.visible = v > 0.01;
  }

  get opacity(): number {
    return this.material.opacity;
  }

  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.widthPx, this.heightPx);
    fn(ctx, this.widthPx, this.heightPx);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The card ground: warm dark glass with a hairline edge. */
export function card(ctx: CanvasRenderingContext2D, w: number, h: number, radius = 0.12): void {
  const r = Math.min(w, h) * radius;
  roundRect(ctx, 2, 2, w - 4, h - 4, r);
  ctx.fillStyle = 'rgba(23, 18, 13, 0.86)';
  ctx.fill();
  ctx.lineWidth = Math.max(2, w * 0.003);
  ctx.strokeStyle = HAIR;
  ctx.stroke();
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(/\s+/);
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}

// --- Line icons (stroke only, drawn in a unit box) -------------------------

type IconFn = (ctx: CanvasRenderingContext2D) => void;

/** An eye glancing aside, with a turn arrow: "look away". */
export const iconLookAway: IconFn = (c) => {
  c.beginPath();
  c.moveTo(0.08, 0.5);
  c.quadraticCurveTo(0.42, 0.18, 0.76, 0.5);
  c.quadraticCurveTo(0.42, 0.82, 0.08, 0.5);
  c.stroke();
  c.beginPath();
  c.arc(0.56, 0.5, 0.09, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(0.5, 0.5, 0.42, -0.5, 0.55);
  c.stroke();
  c.beginPath();
  c.moveTo(0.85, 0.66);
  c.lineTo(0.95, 0.75);
  c.lineTo(0.98, 0.6);
  c.stroke();
};

/** Two L-shaped hands making a frame. */
export const iconFrame: IconFn = (c) => {
  const corner = (x: number, y: number, dx: number, dy: number) => {
    c.beginPath();
    c.moveTo(x + dx * 0.36, y);
    c.lineTo(x, y);
    c.lineTo(x, y + dy * 0.26);
    c.stroke();
  };
  corner(0.1, 0.22, 1, 1);
  corner(0.9, 0.78, -1, -1);
  c.save();
  c.globalAlpha *= 0.35;
  c.strokeRect(0.1, 0.22, 0.8, 0.56);
  c.restore();
  c.beginPath();
  c.arc(0.5, 0.5, 0.07, 0, Math.PI * 2);
  c.stroke();
};

/** A crescent moon. */
export const iconMoon: IconFn = (c) => {
  c.beginPath();
  c.arc(0.5, 0.5, 0.34, 0.6, Math.PI * 2 - 0.6);
  c.arc(0.62, 0.42, 0.28, Math.PI * 2 - 0.9, 0.9, true);
  c.closePath();
  c.fill();
};

/** A sun rising over a line: dawn. */
export const iconDawn: IconFn = (c) => {
  c.beginPath();
  c.arc(0.5, 0.66, 0.22, Math.PI, 0);
  c.stroke();
  c.beginPath();
  c.moveTo(0.06, 0.66);
  c.lineTo(0.94, 0.66);
  c.stroke();
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i + 1) * (Math.PI / 6);
    c.beginPath();
    c.moveTo(0.5 + Math.cos(a) * 0.3, 0.66 + Math.sin(a) * 0.3);
    c.lineTo(0.5 + Math.cos(a) * 0.4, 0.66 + Math.sin(a) * 0.4);
    c.stroke();
  }
};

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconFn,
  x: number,
  y: number,
  size: number,
  color = PAPER,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.lineWidth = 0.055;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  icon(ctx);
  ctx.restore();
}

export function stars(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, filled: number): void {
  for (let i = 0; i < 3; i++) {
    const cx = x + i * size * 1.25;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? size / 2 : size / 4.6;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const px = cx + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (i < filled) {
      ctx.fillStyle = AMBER;
      ctx.fill();
    } else {
      ctx.lineWidth = size * 0.06;
      ctx.strokeStyle = MUTED;
      ctx.stroke();
    }
  }
}
