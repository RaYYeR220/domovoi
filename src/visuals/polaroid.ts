/**
 * Polaroid card, 8.8 × 10.7 cm, image window 7.9 × 7.9 cm. The image is
 * processed like a Victorian spirit photograph (sepia, halation, vignette,
 * grain) and "develops" from a dark blue-grey through a cold emerging image
 * into warm sepia. Caption is a hand-lettered canvas in the bottom margin.
 *
 * One draw call: soft contact shadow, card (front paper / dark back) and a
 * push-pin, merged.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, SRGBColorSpace, Vector4 } from '@iwsdk/core';
import type { CanvasTexture, ShaderMaterial, Texture } from '@iwsdk/core';
import { GLSL_NOISE, GLSL_PIN, GLSL_SDF, canvasTexture, clamp01, fitFont, makeCanvas, premulMaterial, rng } from './common.js';
import type { PolaroidVisual } from './types.js';

export const POLAROID_W = 0.088;
export const POLAROID_H = 0.107;
const IMG = 0.079;
const TOP = 0.0055;
const IMG_CY = POLAROID_H / 2 - TOP - IMG / 2;
const CAP_CY = -POLAROID_H / 2 + (POLAROID_H - TOP - IMG) / 2 - 0.0005;
const CAP_W = 0.077;
const CAP_H = 0.0145;
const PIN_Y = POLAROID_H / 2 - 0.0042;
const PIN_R = 0.0026;
const CAP_PX_W = 1024;
const CAP_PX_H = 192;

const VERT = /* glsl */ `
attribute vec4 aData;
varying vec4 vD;
void main() {
  vD = aData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uImg;
uniform sampler2D uCaption;
uniform float uHasImg;
uniform float uImgSRGB;
uniform vec4 uImgXform;
uniform float uDevelop;
uniform float uPinned;
varying vec4 vD;

${GLSL_NOISE}
${GLSL_SDF}
${GLSL_PIN}

const vec2 HALF = vec2(${(POLAROID_W / 2).toFixed(5)}, ${(POLAROID_H / 2).toFixed(5)});
const vec2 IMG_C = vec2(0.0, ${IMG_CY.toFixed(5)});
const float IMG_H = ${(IMG / 2).toFixed(5)};
const vec2 CAP_C = vec2(0.0, ${CAP_CY.toFixed(5)});
const vec2 CAP_S = vec2(${CAP_W.toFixed(5)}, ${CAP_H.toFixed(5)});
const vec2 PIN_C = vec2(0.0, ${PIN_Y.toFixed(5)});

vec3 sampleImg(vec2 uv) {
  vec3 c = texture2D(uImg, uv).rgb;
  if (uImgSRGB > 0.5) c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  return c;
}

// spirit-photograph treatment; returns luminance-based sepia + the raw luma
vec4 spiritPhoto(vec2 uv) {
  vec2 t = uv * uImgXform.xy + uImgXform.zw;
  float l;
  if (uHasImg > 0.5) {
    const vec3 W = vec3(0.299, 0.587, 0.114);
    float c = dot(sampleImg(t), W);
    float o = 0.007;
    float b = (dot(sampleImg(t + vec2(o, 0.0)), W) + dot(sampleImg(t - vec2(o, 0.0)), W)
             + dot(sampleImg(t + vec2(0.0, o)), W) + dot(sampleImg(t - vec2(0.0, o)), W)) * 0.25;
    l = max(c, mix(c, b, 0.65));
  } else {
    l = 0.28 + 0.32 * fbm2(uv * 3.0 + 4.0) + 0.3 * exp(-dot(uv - vec2(0.56, 0.52), uv - vec2(0.56, 0.52)) * 18.0);
  }
  l = smoothstep(0.0, 1.0, l * 0.9 + 0.05);
  vec3 sep = mix(vec3(0.15, 0.095, 0.06), vec3(0.6, 0.45, 0.3), smoothstep(0.0, 0.55, l));
  sep = mix(sep, vec3(0.95, 0.88, 0.74), smoothstep(0.45, 1.0, l));
  float vig = smoothstep(0.8, 0.18, length((uv - 0.5) * vec2(1.0, 1.06)));
  sep *= mix(0.42, 1.0, vig);
  sep *= 0.93 + 0.09 * vnoise(uv * 5.0 + 3.1);
  sep += (hash12(floor(uv * 460.0)) - 0.5) * 0.035;
  return vec4(sep, l);
}

void main() {
  float kind = vD.z;
  vec2 p = vD.xy;
  vec4 outc = vec4(0.0);
  if (kind < 0.5) {
    if (!gl_FrontFacing) discard;
    float sd = sdRoundBox(p - vec2(0.0008, -0.0018), HALF, 0.0015);
    float a = (1.0 - smoothstep(-0.0012, 0.0036, sd)) * 0.32;
    outc = vec4(0.0, 0.0, 0.0, a);
  } else if (kind < 1.5) {
    float sdCard = sdRoundBox(p, HALF, 0.001);
    float aa = max(length(fwidth(p)), 1e-6) * 0.7;
    float cardA = 1.0 - smoothstep(-aa, aa, sdCard);
    float fib = vnoise(p * vec2(900.0, 1500.0)) * 0.5 + vnoise(p * 2600.0) * 0.5;
    if (!gl_FrontFacing) {
      vec3 back = vec3(0.17, 0.165, 0.16) * (0.96 + 0.06 * fib);
      outc = vec4(back * cardA, cardA);
    } else {
      vec3 paper = vec3(0.945, 0.93, 0.9) * (0.976 + 0.04 * fib);
      paper *= 1.0 - 0.05 * (1.0 - smoothstep(0.0, 0.0012, -sdCard));
      paper *= mix(vec3(1.0), vec3(0.99, 0.975, 0.94), smoothstep(0.04, -0.05, p.y));
      vec3 col = paper;

      // image window
      vec2 q = p - IMG_C;
      float sdImg = sdBox(q, vec2(IMG_H));
      vec2 uv = q / (2.0 * IMG_H) + 0.5;
      vec4 ph = spiritPhoto(clamp(uv, 0.0, 1.0));
      float d = uDevelop;
      float nn = vnoise(uv * 4.0 + 11.0);
      float e = smoothstep(0.0, 0.5, d * 1.35 - (1.0 - ph.w) * 0.35 - nn * 0.18 + 0.02);
      vec3 cold = mix(vec3(0.16, 0.19, 0.23), vec3(0.42, 0.47, 0.52) * (0.35 + 0.9 * ph.w), e);
      vec3 img = mix(cold, ph.rgb, smoothstep(0.45, 1.0, d));
      // slight inner shade along the top lip of the window
      img *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.0015, IMG_H - q.y));
      float imgA = 1.0 - smoothstep(-aa, aa, sdImg);
      col = mix(col, img, imgA);
      col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.0005, abs(sdImg)));

      // caption ink
      vec2 cuv = (p - CAP_C) / CAP_S + 0.5;
      float ink = texture2D(uCaption, clamp(cuv, 0.0, 1.0)).a;
      ink *= step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
      col = mix(col, vec3(0.15, 0.17, 0.26), ink * 0.9);
      outc = vec4(col * cardA, cardA);
    }
  } else {
    if (!gl_FrontFacing) discard;
    outc = pushPin(p - PIN_C, ${PIN_R.toFixed(5)}, vec3(0.56, 0.18, 0.15)) * uPinned;
  }
  gl_FragColor = outc;
}
`;

function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const data: number[] = [];
  const idx: number[] = [];
  const rect = (cx: number, cy: number, hw: number, hh: number, z: number, kind: number): void => {
    const b = pos.length / 3;
    const xs = [-1, 1, 1, -1];
    const ys = [-1, -1, 1, 1];
    for (let i = 0; i < 4; i++) {
      const x = cx + xs[i] * hw;
      const y = cy + ys[i] * hh;
      pos.push(x, y, z);
      data.push(x, y, kind, 0);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  rect(0.0008, -0.0018, POLAROID_W / 2 + 0.005, POLAROID_H / 2 + 0.005, -0.0006, 0);
  rect(0, 0, POLAROID_W / 2, POLAROID_H / 2, 0, 1);
  rect(0, PIN_Y, 0.006, 0.006, 0.0012, 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aData', new BufferAttribute(new Float32Array(data), 4));
  g.setIndex(idx);
  return g;
}

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const CAPTION_FONT = (px: number): string => `italic 400 ${px}px Georgia, 'Times New Roman', 'Noto Serif', serif`;

export class Polaroid implements PolaroidVisual {
  readonly object = new Group();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly capCtx: CanvasRenderingContext2D;
  private readonly capTex: CanvasTexture;
  private img: Texture | null = null;
  private imgW = 0;
  private imgH = 0;

  constructor() {
    const { canvas, ctx } = makeCanvas(CAP_PX_W, CAP_PX_H);
    this.capCtx = ctx;
    this.capTex = canvasTexture(canvas);
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      uniforms: {
        uImg: { value: null },
        uCaption: { value: this.capTex },
        uHasImg: { value: 0 },
        uImgSRGB: { value: 0 },
        uImgXform: { value: new Vector4(1, 1, 0, 0) },
        uDevelop: { value: 0 },
        uPinned: { value: 1 },
      },
    });
    this.mesh = new Mesh(buildGeometry(), this.mat);
    this.object.add(this.mesh);
    this.object.name = 'domovoi-polaroid';
  }

  setImage(tex: Texture): void {
    this.img = tex;
    this.imgW = 0;
    this.imgH = 0;
    const u = this.mat.uniforms;
    u.uImg.value = tex;
    u.uHasImg.value = 1;
    u.uImgSRGB.value = tex.colorSpace === SRGBColorSpace ? 1 : 0;
    this.refreshAspect();
  }

  setDevelop(v: number): void {
    this.mat.uniforms.uDevelop.value = clamp01(v);
  }

  setCaption(text: string): void {
    const ctx = this.capCtx;
    const W = CAP_PX_W;
    const H = CAP_PX_H;
    ctx.clearRect(0, 0, W, H);
    const t = text.trim();
    if (t) {
      const px = fitFont(ctx, t, CAPTION_FONT, 84, W * 0.9, 28);
      ctx.font = CAPTION_FONT(px);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, px * 0.028);
      ctx.lineJoin = 'round';
      const total = ctx.measureText(t).width;
      let x = (W - total) / 2;
      const r = rng(strHash(t));
      const base = H * 0.64;
      for (const ch of t) {
        const w = ctx.measureText(ch).width;
        ctx.save();
        const cx = x + w / 2;
        ctx.translate(cx, base + (r() - 0.5) * px * 0.05 + (cx - W / 2) * 0.012);
        ctx.rotate((r() - 0.5) * 0.06 + 0.012);
        ctx.globalAlpha = 0.84 + r() * 0.16;
        ctx.fillText(ch, -w / 2, 0);
        ctx.strokeText(ch, -w / 2, 0);
        ctx.restore();
        x += w;
      }
    }
    this.capTex.needsUpdate = true;
  }

  /** Not part of the contract: hide the push-pin while the card is in hand. */
  setPinned(on: boolean): void {
    this.mat.uniforms.uPinned.value = on ? 1 : 0;
  }

  private refreshAspect(): void {
    const im = this.img?.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
    if (!im) return;
    const w = im.videoWidth || im.width || 0;
    const h = im.videoHeight || im.height || 0;
    if (!w || !h || (w === this.imgW && h === this.imgH)) return;
    this.imgW = w;
    this.imgH = h;
    const a = w / h;
    const x = this.mat.uniforms.uImgXform.value as Vector4;
    if (a >= 1) x.set(1 / a, 1, (1 - 1 / a) / 2, 0);
    else x.set(1, a, 0, (1 - a) / 2);
  }

  update(): void {
    if (this.img && !this.imgW) this.refreshAspect();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.capTex.dispose();
    this.object.removeFromParent();
  }
}
