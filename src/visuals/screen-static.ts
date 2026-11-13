/**
 * TV snow on a real screen's front face. Plane of the given size centred on
 * the local origin, normal +Z (offset 2 mm forward). Hash noise at a fixed
 * cell count across the width (so it stays a few pixels coarse at any
 * distance), 30 fps refresh, scanlines, a slow rolling band, soft vignette
 * and feathered edges. One draw call.
 */

import { Mesh, PlaneGeometry, Vector2 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { GLSL_NOISE, premulMaterial, smoothstep01 } from './common.js';
import { ToggleBase } from './toggle.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uPop;
uniform vec2 uSize;
uniform vec2 uCells;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec2 p = vUv * uSize;
  float frame = floor(uTime * 30.0);
  // occasional horizontal tear: rows shift sideways for a frame
  float row = floor(vUv.y * uCells.y);
  float tear = step(0.985, hash12(vec2(floor(row / 6.0), frame))) * (hash12(vec2(row, frame)) - 0.5) * 18.0;
  vec2 cell = floor(vUv * uCells + vec2(tear, 0.0));
  float n = hash13(vec3(cell, mod(frame, 997.0)));
  n = n * n * (3.0 - 2.0 * n);
  float scan = 0.86 + 0.14 * step(0.5, fract(vUv.y * uCells.y * 0.5));
  float band = smoothstep(0.0, 0.18, fract(vUv.y * 0.7 - uTime * 0.11)) * (1.0 - smoothstep(0.18, 0.4, fract(vUv.y * 0.7 - uTime * 0.11)));
  float lum = n * scan * (0.8 + 0.28 * band) * (0.92 + 0.08 * sin(uTime * 61.0));
  vec2 q = (vUv - 0.5) * 2.0;
  float vig = 1.0 - 0.38 * dot(q * vec2(0.85, 0.95), q * vec2(0.85, 0.95));
  vec3 col = vec3(lum * vig) * vec3(0.93, 0.97, 1.03) * (1.0 + uPop);
  float edge = min(min(p.x, uSize.x - p.x), min(p.y, uSize.y - p.y));
  float a = smoothstep(0.0, min(uSize.x, uSize.y) * 0.035, edge) * 0.93 * uFade;
  gl_FragColor = vec4(min(col, vec3(1.0)) * a, a);
}
`;

export class ScreenStatic extends ToggleBase {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private onTime = -1;

  constructor(width: number, height: number) {
    super(0.35, 0.3);
    const w = Math.max(width, 0.05);
    const h = Math.max(height, 0.05);
    const cellsX = 220;
    const cellsY = Math.max(16, Math.round((cellsX * h) / w));
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 0 },
        uPop: { value: 0 },
        uSize: { value: new Vector2(w, h) },
        uCells: { value: new Vector2(cellsX, cellsY) },
      },
    });
    const g = new PlaneGeometry(w, h);
    g.translate(0, 0, 0.002);
    this.mesh = new Mesh(g, this.mat);
    this.object.add(this.mesh);
    this.object.name = 'domovoi-screen-static';
  }

  override setActive(on: boolean, immediate = false): void {
    if (on && !this.fade.on) this.onTime = 0;
    super.setActive(on, immediate);
  }

  protected apply(f: number, dt: number, t: number): void {
    const u = this.mat.uniforms;
    u.uFade.value = smoothstep01(f);
    if (t >= 0) u.uTime.value = t;
    if (this.onTime >= 0) {
      this.onTime += dt;
      // a short brightness pop as the "signal" hits the screen
      u.uPop.value = 0.35 * Math.exp(-this.onTime * 9) * Math.min(1, this.onTime * 30);
      if (this.onTime > 0.8) {
        this.onTime = -1;
        u.uPop.value = 0;
      }
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
