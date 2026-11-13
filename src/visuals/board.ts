/**
 * Cork evidence board with a thin mitred walnut frame and a pinned title card.
 *
 * Local frame: origin = centre of the cork face, board plane = XY, front = +Z.
 * Cork face at z = 0, frame front at z = +9 mm, back against the wall at
 * z = -12 mm. Pin polaroids at z ≈ +2 mm (stagger by ~0.5 mm if they overlap).
 * width/height = outer size including the frame.
 *
 * Two draw calls: board (cork + frame, opaque) and title card (+ pins, shadow).
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, RepeatWrapping, ShaderMaterial, Vector2 } from '@iwsdk/core';
import type { CanvasTexture } from '@iwsdk/core';
import {
  GLSL_NOISE,
  GLSL_PIN,
  GLSL_SDF,
  GeoBuilder,
  canvasTexture,
  fitFont,
  hash01,
  makeCanvas,
  premulMaterial,
  rng,
} from './common.js';
import { GLSL_WOOD, addMitredFrame } from './frame.js';
import { POLAROID_H, POLAROID_W } from './polaroid.js';
import type { BoardVisual } from './types.js';

const CORK_TILE = 0.22;
const TITLE_PX_W = 1024;
const TITLE_PX_H = 232;

let corkCache: CanvasTexture | null = null;
let corkUsers = 0;

function corkTexture(): CanvasTexture {
  if (corkCache) {
    corkUsers++;
    return corkCache;
  }
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const r = rng(4242);
  ctx.fillStyle = '#b08658';
  ctx.fillRect(0, 0, S, S);
  const blob = (x: number, y: number, rx: number, ry: number, rot: number, style: string): void => {
    ctx.fillStyle = style;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = x + ox * S;
        const py = y + oy * S;
        if (px < -8 || px > S + 8 || py < -8 || py > S + 8) continue;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  // granules: mid tones, then dark pits, then light flecks
  const layers: [number, number, number, string[]][] = [
    [5200, 1.2, 3.4, ['rgba(160,118,74,0.55)', 'rgba(188,144,96,0.5)', 'rgba(146,104,64,0.5)']],
    [2600, 0.6, 1.8, ['rgba(108,72,40,0.55)', 'rgba(92,60,34,0.5)', 'rgba(124,84,48,0.45)']],
    [1500, 0.5, 1.4, ['rgba(214,176,124,0.55)', 'rgba(226,190,140,0.45)']],
    [420, 0.4, 0.9, ['rgba(64,40,22,0.6)']],
  ];
  for (const [count, rMin, rMax, styles] of layers) {
    for (let i = 0; i < count; i++) {
      const rr = rMin + (rMax - rMin) * r() * r();
      blob(r() * S, r() * S, rr * (0.7 + r() * 0.6), rr * (0.6 + r() * 0.5), r() * Math.PI, styles[(r() * styles.length) | 0]);
    }
  }
  const tex = canvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  corkCache = tex;
  corkUsers = 1;
  return tex;
}

function releaseCork(): void {
  corkUsers--;
  if (corkUsers <= 0 && corkCache) {
    corkCache.dispose();
    corkCache = null;
    corkUsers = 0;
  }
}

const BOARD_VERT = /* glsl */ `
attribute vec4 aData;
attribute vec3 aExtra;
varying vec4 vD;
varying vec3 vN;
void main() {
  vD = aData;
  vN = aExtra;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BOARD_FRAG = /* glsl */ `
uniform sampler2D uCork;
uniform vec2 uHalf;
uniform float uFw;
varying vec4 vD;
varying vec3 vN;
${GLSL_NOISE}
${GLSL_WOOD}
void main() {
  vec3 c;
  if (vD.z < 0.5) {
    vec2 p = vD.xy;
    c = texture2D(uCork, p / ${CORK_TILE.toFixed(3)}).rgb;
    // large-scale mottling from a second, much coarser tap (breaks tiling, no ALU noise)
    vec3 m = texture2D(uCork, p / 1.37 + 0.31).rgb;
    c *= 0.9 + 0.2 * smoothstep(0.35, 0.8, dot(m, vec3(0.45, 0.4, 0.15)));
    float dx = uHalf.x - abs(p.x);
    float dy = uHalf.y - abs(p.y);
    float shY = p.y > 0.0 ? smoothstep(0.0, 0.032, dy) : smoothstep(0.0, 0.01, dy);
    float shX = p.x < 0.0 ? smoothstep(0.0, 0.02, dx) : smoothstep(0.0, 0.012, dx);
    c *= mix(0.6, 1.0, min(shX, shY));
    c *= 0.92 + 0.1 * (p.y / uHalf.y * 0.5 + 0.5);
  } else {
    c = woodShade(vD.xy, normalize(vN), vD.w, vec3(0.36, 0.245, 0.17), uFw);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const TITLE_VERT = /* glsl */ `
attribute vec4 aData;
varying vec4 vD;
void main() {
  vD = aData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TITLE_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uHalf;
uniform vec2 uPinA;
uniform vec2 uPinB;
varying vec4 vD;
${GLSL_SDF}
${GLSL_PIN}
void main() {
  vec2 p = vD.xy;
  vec4 o;
  if (vD.z < 0.5) {
    float sd = sdRoundBox(p, uHalf, 0.0008);
    float aa = max(length(fwidth(p)), 1e-6) * 0.7;
    float a = 1.0 - smoothstep(-aa, aa, sd);
    vec3 c = texture2D(uTex, p / (2.0 * uHalf) + 0.5).rgb;
    c *= 0.96 + 0.04 * (p.y / uHalf.y * 0.5 + 0.5);
    o = vec4(c * a, a);
  } else if (vD.z < 1.5) {
    float sd = sdRoundBox(p - vec2(0.0008, -0.0016), uHalf, 0.0015);
    o = vec4(0.0, 0.0, 0.0, (1.0 - smoothstep(-0.001, 0.0034, sd)) * 0.3);
  } else {
    vec2 c = vD.w < 0.5 ? uPinA : uPinB;
    o = pushPin(p - c, 0.0024, vec3(0.56, 0.18, 0.15));
  }
  gl_FragColor = o;
}
`;

export class Board implements BoardVisual {
  readonly object = new Group();
  private readonly boardMesh: Mesh;
  private readonly boardMat: ShaderMaterial;
  private readonly titleMesh: Mesh;
  private readonly titleMat: ShaderMaterial;
  private readonly titleCtx: CanvasRenderingContext2D;
  private readonly titleTex: CanvasTexture;
  private readonly corkW: number;
  private readonly corkH: number;
  private readonly titleBottom: number;

  constructor(width: number, height: number) {
    const w = Math.max(width, 0.2);
    const h = Math.max(height, 0.2);
    const fw = Math.min(Math.max(Math.min(w, h) * 0.024, 0.014), 0.022);
    const iw = w / 2 - fw;
    const ih = h / 2 - fw;
    this.corkW = iw * 2;
    this.corkH = ih * 2;

    const b = new GeoBuilder(3);
    const c0 = b.vert(-iw, -ih, 0, -iw, -ih, 0, 0, 0, 0, 1);
    const c1 = b.vert(iw, -ih, 0, iw, -ih, 0, 0, 0, 0, 1);
    const c2 = b.vert(iw, ih, 0, iw, ih, 0, 0, 0, 0, 1);
    const c3 = b.vert(-iw, ih, 0, -iw, ih, 0, 0, 0, 0, 1);
    b.quad(c0, c1, c2, c3);
    addMitredFrame(b, iw, ih, fw, 0.009, 0, -0.012, 1);
    this.boardMat = new ShaderMaterial({
      vertexShader: BOARD_VERT,
      fragmentShader: BOARD_FRAG,
      uniforms: {
        uCork: { value: corkTexture() },
        uHalf: { value: new Vector2(iw, ih) },
        uFw: { value: fw },
      },
    });
    this.boardMesh = new Mesh(b.build(), this.boardMat);
    this.object.add(this.boardMesh);

    // title card
    const cw = Math.min(Math.max(this.corkW * 0.3, 0.15), 0.26);
    const ch = (cw * TITLE_PX_H) / TITLE_PX_W;
    const ty = ih - 0.014 - ch / 2;
    this.titleBottom = ty - ch / 2;
    const { ctx, canvas } = makeCanvas(TITLE_PX_W, TITLE_PX_H);
    this.titleCtx = ctx;
    this.titleTex = canvasTexture(canvas);
    const pinA = new Vector2(-cw / 2 + 0.011, ch / 2 - 0.0075);
    const pinB = new Vector2(cw / 2 - 0.011, ch / 2 - 0.0075);
    this.titleMat = premulMaterial({
      vertexShader: TITLE_VERT,
      fragmentShader: TITLE_FRAG,
      uniforms: {
        uTex: { value: this.titleTex },
        uHalf: { value: new Vector2(cw / 2, ch / 2) },
        uPinA: { value: pinA },
        uPinB: { value: pinB },
      },
    });
    const pos: number[] = [];
    const data: number[] = [];
    const idx: number[] = [];
    const rect = (cx: number, cy: number, hw: number, hh: number, z: number, kind: number, tag: number): void => {
      const base = pos.length / 3;
      const xs = [-1, 1, 1, -1];
      const ys = [-1, -1, 1, 1];
      for (let i = 0; i < 4; i++) {
        const x = cx + xs[i] * hw;
        const y = cy + ys[i] * hh;
        pos.push(x, y, z);
        data.push(x, y, kind, tag);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    rect(0.0008, -0.0016, cw / 2 + 0.005, ch / 2 + 0.005, -0.0005, 1, 0);
    rect(0, 0, cw / 2, ch / 2, 0, 0, 0);
    rect(pinA.x, pinA.y, 0.0055, 0.0055, 0.0008, 2, 0);
    rect(pinB.x, pinB.y, 0.0055, 0.0055, 0.0008, 2, 1);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    tg.setAttribute('aData', new BufferAttribute(new Float32Array(data), 4));
    tg.setIndex(idx);
    this.titleMesh = new Mesh(tg, this.titleMat);
    this.titleMesh.position.set(0, ty, 0.0015);
    this.titleMesh.rotation.z = -0.012;
    this.object.add(this.titleMesh);
    this.object.name = 'domovoi-board';
    this.setTitle('');
  }

  slotTransform(i: number, n: number): { x: number; y: number; rotZ: number } {
    const count = Math.max(1, Math.floor(n));
    const idx = Math.min(Math.max(0, Math.floor(i)), count - 1);
    const pad = 0.018;
    const left = -this.corkW / 2 + pad;
    const right = this.corkW / 2 - pad;
    const top = this.titleBottom - 0.012;
    const bottom = -this.corkH / 2 + pad;
    const aw = Math.max(right - left, POLAROID_W);
    const ah = Math.max(top - bottom, POLAROID_H);
    // pick the column count that gives each card the most room
    let cols = 1;
    let best = -Infinity;
    for (let c = 1; c <= count; c++) {
      const rows = Math.ceil(count / c);
      const fit = Math.min(aw / c / (POLAROID_W * 1.12), ah / rows / (POLAROID_H * 1.08));
      if (fit > best + 1e-6) {
        best = fit;
        cols = c;
      }
    }
    const rows = Math.ceil(count / cols);
    const row = Math.floor(idx / cols);
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const col = idx - row * cols;
    const cellW = aw / cols;
    const cellH = ah / rows;
    // centre short last rows; keep the block centred if cells are roomy
    const blockW = Math.min(aw, cols * POLAROID_W * 1.35);
    const blockH = Math.min(ah, rows * POLAROID_H * 1.25);
    const stepX = blockW / cols;
    const stepY = blockH / rows;
    const x0 = (left + right) / 2 - (inRow * stepX) / 2;
    const y0 = (top + bottom) / 2 + blockH / 2;
    const spareX = Math.max(0, Math.min(cellW, stepX) - POLAROID_W);
    const spareY = Math.max(0, Math.min(cellH, stepY) - POLAROID_H);
    const jx = (hash01(idx, 1) - 0.5) * Math.min(0.016, spareX * 0.5 + 0.004);
    const jy = (hash01(idx, 2) - 0.5) * Math.min(0.014, spareY * 0.5 + 0.004);
    const rotZ = (hash01(idx, 3) * 2 - 1) * ((4 * Math.PI) / 180);
    return {
      x: x0 + stepX * (col + 0.5) + jx,
      y: y0 - stepY * (row + 0.5) + jy,
      rotZ,
    };
  }

  setTitle(text: string): void {
    const ctx = this.titleCtx;
    const W = TITLE_PX_W;
    const H = TITLE_PX_H;
    ctx.fillStyle = '#f1eee6';
    ctx.fillRect(0, 0, W, H);
    const r = rng(77);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(120,105,80,0.05)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
    ctx.fillStyle = 'rgba(190,72,64,0.75)';
    ctx.fillRect(0, 62, W, 3);
    ctx.fillStyle = 'rgba(96,128,168,0.22)';
    ctx.fillRect(0, 168, W, 2);
    const t = text.trim().toUpperCase();
    if (t) {
      const font = (px: number): string => `600 ${px}px Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
      const c2 = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      const px = fitFont(ctx, t, (p) => font(p), 60, W * 0.84, 18);
      if ('letterSpacing' in c2) {
        c2.letterSpacing = `${Math.round(px * 0.14)}px`;
        // re-fit with tracking applied
        let p2 = px;
        while (p2 > 18 && ctx.measureText(t).width > W * 0.84) {
          p2 -= 1;
          ctx.font = font(p2);
          c2.letterSpacing = `${Math.round(p2 * 0.14)}px`;
        }
      }
      ctx.fillStyle = '#2a2826';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, W / 2, 118);
      if ('letterSpacing' in c2) c2.letterSpacing = '0px';
    }
    this.titleTex.needsUpdate = true;
  }

  update(): void {
    /* static */
  }

  dispose(): void {
    this.boardMesh.geometry.dispose();
    this.boardMat.dispose();
    this.titleMesh.geometry.dispose();
    this.titleMat.dispose();
    this.titleTex.dispose();
    releaseCork();
    this.object.removeFromParent();
  }
}
