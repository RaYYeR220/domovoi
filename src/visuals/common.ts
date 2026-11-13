/**
 * Shared helpers for the procedural visuals: blending presets, GLSL noise,
 * fade state, seeded RNG, canvas helpers.
 *
 * Colour convention: every ShaderMaterial here writes display-space (sRGB)
 * values directly and skips three's colour-space chunk, so what you author is
 * what lands in the framebuffer, in the desktop preview and in XR alike.
 *
 * Blending convention: premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA). A
 * fragment that outputs alpha 0 is pure additive light (glows, sparkles);
 * alpha 1 is an opaque surface. One draw call can therefore mix a glow halo
 * with a solid body, and in passthrough (premultiplied compositor) alpha-0
 * light adds on top of the camera feed instead of veiling it.
 */

import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CustomBlending,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
} from '@iwsdk/core';
import type { IUniform, Side } from '@iwsdk/core';

export interface PremulOptions {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, IUniform>;
  side?: Side;
  depthWrite?: boolean;
  depthTest?: boolean;
}

/** Transparent ShaderMaterial with premultiplied-alpha blending. */
export function premulMaterial(o: PremulOptions): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: o.vertexShader,
    fragmentShader: o.fragmentShader,
    uniforms: o.uniforms,
    side: o.side ?? FrontSide,
    transparent: true,
    depthWrite: o.depthWrite ?? false,
    depthTest: o.depthTest ?? true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}

/** Small, mobile-friendly noise set (no textures). */
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float fbm2(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.07 + 13.1) * 0.3 + vnoise(p * 4.13 + 7.7) * 0.1;
}
`;

/** Box SDF (centre at origin, half-size b), negative inside. */
export const GLSL_SDF = /* glsl */ `
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
`;

/**
 * A domed push-pin head seen from the front with its soft drop shadow.
 * q = offset from the pin centre (metres). Returns premultiplied colour.
 */
export const GLSL_PIN = /* glsl */ `
vec4 pushPin(vec2 q, float rad, vec3 col) {
  float sh = (1.0 - smoothstep(rad * 0.3, rad * 1.75, length(q - vec2(0.45, -0.7) * rad))) * 0.42;
  float r = length(q);
  float aa = max(fwidth(r), 1e-6);
  float head = 1.0 - smoothstep(rad - aa, rad + aa, r);
  vec2 nq = q / rad;
  float zq = sqrt(max(1.0 - dot(nq, nq), 0.0));
  vec3 N = normalize(vec3(nq * 0.9, zq + 0.15));
  vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
  float diff = 0.42 + 0.58 * max(dot(N, L), 0.0);
  float spec = pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  vec3 c = col * diff + vec3(spec * 0.5);
  vec4 headC = vec4(c * head, head);
  return headC + vec4(0.0, 0.0, 0.0, sh) * (1.0 - head);
}
`;

/** Hex colour → display-space (sRGB) components, no colour management. */
export function hexToRGB(hex: number, out: { x: number; y: number; z: number }): void {
  out.x = ((hex >> 16) & 255) / 255;
  out.y = ((hex >> 8) & 255) / 255;
  out.z = (hex & 255) / 255;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep01 = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (v: number): number => {
  const x = 1 - clamp01(v);
  return 1 - x * x * x;
};
/** Frame-rate independent exponential approach (rate in 1/s). */
export const damp = (cur: number, target: number, rate: number, dt: number): number =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

/**
 * Linear 0..1 ramp toward a target with a fixed duration; `eased` applies a
 * smoothstep so in/out both read as soft, restrained motion.
 */
export class Fade {
  value = 0;
  target = 0;
  constructor(
    public durationIn = 0.6,
    public durationOut = 0.6,
  ) {}
  set(on: boolean, immediate = false): void {
    this.target = on ? 1 : 0;
    if (immediate) this.value = this.target;
  }
  update(dt: number): void {
    if (this.value < this.target) {
      this.value = Math.min(this.target, this.value + dt / Math.max(1e-4, this.durationIn));
    } else if (this.value > this.target) {
      this.value = Math.max(this.target, this.value - dt / Math.max(1e-4, this.durationOut));
    }
  }
  get eased(): number {
    return smoothstep01(this.value);
  }
  get on(): boolean {
    return this.target > 0.5;
  }
}

/** mulberry32 — deterministic, tiny. */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of (i, k) to 0..1. */
export function hash01(i: number, k: number): number {
  const s = Math.sin(i * 127.1 + k * 311.7 + 17.13) * 43758.5453;
  return s - Math.floor(s);
}

export function makeCanvas(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('visuals: 2D canvas unavailable');
  return { canvas, ctx };
}

/** CanvasTexture with mipmaps; colour space left as-is (raw sRGB sampling). */
export function canvasTexture(canvas: HTMLCanvasElement, mipmaps = true): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Fit `text` into maxWidth by shrinking the font size; returns the size used. */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFor: (px: number) => string,
  startPx: number,
  maxWidth: number,
  minPx = 10,
): number {
  let px = startPx;
  ctx.font = fontFor(px);
  while (px > minPx && ctx.measureText(text).width > maxWidth) {
    px -= 1;
    ctx.font = fontFor(px);
  }
  return px;
}

/**
 * Tiny geometry builder: push vertices with a position and one vec4 data
 * attribute, then quads/triangles by index. Keeps merged meshes to one call.
 */
export class GeoBuilder {
  pos: number[] = [];
  data: number[] = [];
  idx: number[] = [];
  extra: number[] = [];
  constructor(public extraSize = 0) {}
  get count(): number {
    return this.pos.length / 3;
  }
  vert(x: number, y: number, z: number, a: number, b: number, c: number, d: number, ...e: number[]): number {
    this.pos.push(x, y, z);
    this.data.push(a, b, c, d);
    for (let i = 0; i < this.extraSize; i++) this.extra.push(e[i] ?? 0);
    return this.count - 1;
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  build(extraName = 'aExtra'): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aData', new BufferAttribute(new Float32Array(this.data), 4));
    if (this.extraSize > 0) {
      g.setAttribute(extraName, new BufferAttribute(new Float32Array(this.extra), this.extraSize));
    }
    const n = this.count;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    return g;
  }
}
