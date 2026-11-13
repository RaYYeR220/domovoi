/**
 * Candle flame for the candle prop. Local origin = flame base (wick tip).
 * A cylindrical billboard teardrop (blue root, hot core, orange skin) that
 * sways and flickers from layered noise, plus a small additive glow sprite.
 * Lighting grows from a bead; going out shrinks it. One draw call.
 */

import { Mesh } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { GLSL_NOISE, GeoBuilder, easeOutCubic, premulMaterial, smoothstep01 } from './common.js';
import { ToggleBase } from './toggle.js';

const FLAME_H = 0.032;
const FLAME_W = 0.0068;
const GLOW_R = 0.075;

const VERT = /* glsl */ `
uniform float uScale;
uniform float uFlick;
attribute vec4 aData;
varying vec2 vC;
varying float vKind;
void main() {
  vC = aData.xy;
  vKind = aData.z;
  float ms = length(modelViewMatrix[0].xyz);
  vec4 mv;
  if (aData.z < 0.5) {
    mv = modelViewMatrix * vec4(0.0, ${(FLAME_H * 0.38).toFixed(4)} * uScale, 0.0, 1.0);
    mv.xy += aData.xy * ${GLOW_R.toFixed(3)} * (0.55 + 0.45 * uScale) * ms;
  } else {
    vec4 c = modelViewMatrix * vec4(0.0, -0.003, 0.0, 1.0);
    vec3 upV = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 toCam = normalize(-c.xyz);
    vec3 rightV = cross(upV, toCam);
    rightV = length(rightV) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(rightV);
    float h = ${FLAME_H.toFixed(4)} * uScale * uFlick;
    float w = ${FLAME_W.toFixed(4)} * mix(0.5, 1.0, uScale);
    mv = vec4(c.xyz + (rightV * aData.x * w + upV * aData.y * h) * ms, 1.0);
  }
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uBright;
varying vec2 vC;
varying float vKind;
${GLSL_NOISE}
void main() {
  vec4 o;
  if (vKind < 0.5) {
    float r = length(vC);
    float g = (exp(-r * r * 7.0) * 0.2 + exp(-r * 9.0) * 0.12) * (1.0 - smoothstep(0.7, 1.0, r));
    o = vec4(vec3(1.0, 0.68, 0.34) * g * uBright, 0.0);
  } else {
    float y = vC.y;
    float sway = (vnoise(vec2(uTime * 1.9, 3.0)) - 0.5) * 0.45 + (vnoise(vec2(uTime * 6.5, 9.0)) - 0.5) * 0.12;
    float x = vC.x - sway * y * y;
    float w = 2.2 * pow(max(y, 0.0), 0.45) * pow(max(1.0 - y, 0.0), 0.95);
    float d = abs(x) / max(w, 1e-3);
    float body = (1.0 - smoothstep(0.5, 1.0, d)) * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.9, 1.0, y));
    float core = (1.0 - smoothstep(0.0, 0.62, d)) * smoothstep(0.1, 0.24, y) * (1.0 - smoothstep(0.32, 0.78, y));
    float blue = (1.0 - smoothstep(0.08, 0.26, y)) * (1.0 - smoothstep(0.35, 1.0, d)) * smoothstep(0.0, 0.05, y);
    float gap = (1.0 - smoothstep(0.0, 0.14, y)) * (1.0 - smoothstep(0.0, 0.45, d));
    vec3 outer = vec3(1.0, 0.52, 0.16);
    vec3 mid = vec3(1.0, 0.78, 0.38);
    vec3 hot = vec3(1.0, 0.96, 0.86);
    vec3 c = mix(outer, mid, 1.0 - smoothstep(0.3, 0.95, d));
    c = mix(c, hot, core * 0.9);
    c *= body;
    c += vec3(0.3, 0.42, 1.0) * blue * 0.32 * (1.0 - core);
    c *= 1.0 - gap * 0.7;
    o = vec4(c * uBright, body * 0.28);
  }
  gl_FragColor = o * uFade;
}
`;

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 1D smooth value noise for CPU-side flicker (no allocation). */
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

export class Flame extends ToggleBase {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor() {
    super(0.45, 0.28);
    const b = new GeoBuilder();
    const quad = (kind: number, y0: number, y1: number): void => {
      const a = b.vert(0, 0, 0, -1, y0, kind, 0);
      const c = b.vert(0, 0, 0, 1, y0, kind, 0);
      const d = b.vert(0, 0, 0, 1, y1, kind, 0);
      const e = b.vert(0, 0, 0, -1, y1, kind, 0);
      b.quad(a, c, d, e);
    };
    quad(0, -1, 1);
    quad(1, 0, 1);
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 0 },
        uBright: { value: 1 },
        uScale: { value: 0 },
        uFlick: { value: 1 },
      },
    });
    this.mesh = new Mesh(b.build(), this.mat);
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.object.name = 'domovoi-flame';
  }

  protected apply(f: number, _dt: number, t: number): void {
    const u = this.mat.uniforms;
    const lighting = this.fade.on;
    u.uFade.value = smoothstep01(Math.min(1, f * 1.6));
    u.uScale.value = lighting ? easeOutCubic(f) : 0.25 + 0.75 * f;
    if (t >= 0) {
      u.uTime.value = t;
      u.uFlick.value = 1 + 0.07 * (noise1(t * 3.1) - 0.5) * 2 + 0.018 * Math.sin(t * 17.0);
      u.uBright.value = 1 + 0.09 * (noise1(t * 4.3 + 10) - 0.5) * 2;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
