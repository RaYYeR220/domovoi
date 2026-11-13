/**
 * Night sky "through" a real window. Plane of the given size centred on the
 * local origin, normal +Z (offset 2 mm forward). The sky is sampled by view
 * direction from each eye (not by plane position), so the moon and stars sit
 * at optical infinity behind the glass — parallax and stereo both read as
 * real depth. Deep-blue gradient, crescent moon with halo, twinkling stars,
 * slow thin clouds, feathered edges. One draw call.
 */

import { Mesh, PlaneGeometry, Vector2 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { GLSL_NOISE, premulMaterial, smoothstep01 } from './common.js';
import { ToggleBase } from './toggle.js';

const VERT = /* glsl */ `
uniform vec2 uSize;
uniform float uD0;
varying vec2 vP;
varying vec2 vSky;
void main() {
  vP = position.xy;
  // per-eye camera position (works with multiview: viewMatrix is per view)
  vec3 camW = -(transpose(mat3(viewMatrix)) * viewMatrix[3].xyz);
  vec3 camO = (inverse(modelMatrix) * vec4(camW, 1.0)).xyz;
  float dist = max(camO.z, 0.25);
  // lateral parallax of a sky at infinity, softly saturated so the moon
  // never slides out of the frame; partial zoom compensation with distance
  vec2 sat = uSize * 0.2;
  vec2 off = sat * tanh(camO.xy / sat);
  float k = clamp(pow(uD0 / dist, 0.6), 0.8, 1.5);
  vSky = (position.xy - off) * k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uD0;
uniform float uMoonR;
uniform vec2 uMoon;
uniform vec2 uSize;
varying vec2 vP;
varying vec2 vSky;
${GLSL_NOISE}
void main() {
  vec2 s = vSky;
  float sf = smoothstep(0.35, 1.0, uFade);

  float el = s.y;
  vec3 col = mix(vec3(0.12, 0.15, 0.27), vec3(0.055, 0.095, 0.2), smoothstep(-0.7, 0.0, el));
  col = mix(col, vec3(0.03, 0.052, 0.125), smoothstep(0.0, 0.9, el));

  vec2 mq = s - uMoon;
  float mr = length(mq);
  float glow = exp(-max(mr - uMoonR, 0.0) / (uMoonR * 1.5)) * 0.2 + exp(-mr / (uMoonR * 9.0)) * 0.07;
  col += vec3(0.55, 0.6, 0.74) * glow * sf;

  vec2 g = s / 0.05;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float fw = max(fwidth(g.x), 1e-4);
  float h = hash12(id + 7.0);
  vec2 off = (hash22(id) - 0.5) * 0.7;
  float d = length(f - off);
  float bright = fract(h * 31.7);
  float tw = 0.55 + 0.45 * sin(uTime * (1.1 + 2.6 * fract(h * 13.3)) + h * 40.0);
  float star = step(0.865, h) * exp(-d * d / (fw * fw * (1.1 + 2.6 * bright))) * (0.35 + 0.65 * bright) * tw;
  star *= smoothstep(uMoonR * 1.4, uMoonR * 3.5, mr);
  col += vec3(0.86, 0.88, 0.95) * star * sf;

  float aa = max(fwidth(mr), 1e-5);
  float disc = 1.0 - smoothstep(uMoonR - aa, uMoonR + aa, mr);
  float cut = 1.0 - smoothstep(uMoonR * 0.9 - aa, uMoonR * 0.9 + aa, length(mq - vec2(-0.4, 0.22) * uMoonR));
  float cres = disc * (1.0 - cut);
  vec3 moonCol = vec3(0.97, 0.93, 0.81) * (0.9 + 0.1 * vnoise(mq / uMoonR * 3.0 + 5.0));
  col = mix(col, vec3(0.085, 0.11, 0.19), disc * cut * 0.55 * sf);
  col = mix(col, moonCol, cres * sf);

  float cl = fbm2(s * vec2(1.7, 6.0) + vec2(uTime * 0.012, 3.0));
  float cm = smoothstep(0.5, 0.78, cl) * (1.0 - smoothstep(0.05, 0.7, el)) * 0.55;
  vec3 cloudCol = mix(vec3(0.05, 0.07, 0.14), vec3(0.4, 0.42, 0.5), exp(-mr / (uMoonR * 5.0)));
  col = mix(col, cloudCol, cm * sf);

  vec2 e2 = uSize * 0.5 - abs(vP);
  float edge = min(e2.x, e2.y);
  float a = smoothstep(0.0, min(uSize.x, uSize.y) * 0.035, edge) * 0.97 * smoothstep(0.0, 0.6, uFade);
  gl_FragColor = vec4(col * a, a);
}
`;

export class NightWindow extends ToggleBase {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor(width: number, height: number) {
    super(0.9, 0.7);
    const w = Math.max(width, 0.05);
    const h = Math.max(height, 0.05);
    const moonR = Math.min(Math.max(0.065 * Math.min(w, h), 0.022), 0.05);
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 0 },
        uD0: { value: 1.6 },
        uMoonR: { value: moonR },
        uMoon: { value: new Vector2(w * 0.15, h * 0.17) },
        uSize: { value: new Vector2(w, h) },
      },
    });
    const g = new PlaneGeometry(w, h);
    g.translate(0, 0, 0.002);
    this.mesh = new Mesh(g, this.mat);
    this.object.add(this.mesh);
    this.object.name = 'domovoi-night-window';
  }

  protected apply(f: number, _dt: number, t: number): void {
    const u = this.mat.uniforms;
    u.uFade.value = smoothstep01(f);
    if (t >= 0) u.uTime.value = t;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
