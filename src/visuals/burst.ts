/**
 * Sparkle burst (0.6 s): a camera-facing ring of tiny warm glints flying out
 * with ease-out, a soft expanding ring and a brief core flash. Additive, one
 * draw call, hidden when idle. play() restarts it.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { hexToRGB, premulMaterial, rng } from './common.js';
import type { BurstVisual } from './types.js';

const SPARKS = 28;
const DUR = 0.6;
const RING_R = 0.1;

const VERT = /* glsl */ `
uniform float uT;
uniform float uDur;
attribute vec4 aData;   // corner.xy, kind, seed
attribute vec4 aExtra;  // angle, speed, size, life
varying vec2 vC;
varying float vKind;
varying float vI;
void main() {
  float u = clamp(uT / uDur, 0.0, 1.0);
  float ms = length(modelViewMatrix[0].xyz);
  vC = aData.xy;
  vKind = aData.z;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  if (aData.z < 0.5) {
    float s = aData.w;
    float e = 1.0 - pow(1.0 - u, 3.0);
    float ang = aExtra.x;
    float rad = 0.07 * aExtra.y * e;
    mv.xy += vec2(cos(ang), sin(ang)) * rad * ms;
    mv.y += 0.012 * u * ms;
    mv.z += (fract(s * 7.31) - 0.5) * 0.03 * e * ms;
    float life = 1.0 - smoothstep(aExtra.w * 0.55, aExtra.w, u);
    float size = aExtra.z * (1.0 - 0.55 * u);
    mv.xy += aData.xy * size * ms;
    vI = life * smoothstep(0.0, 0.03, u) * (0.62 + 0.38 * sin(uT * 42.0 + s * 31.0));
  } else {
    mv.xy += aData.xy * ${RING_R.toFixed(3)} * ms;
    vI = 1.0;
  }
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uT;
uniform float uDur;
uniform vec3 uColor;
varying vec2 vC;
varying float vKind;
varying float vI;
void main() {
  float u = clamp(uT / uDur, 0.0, 1.0);
  vec3 c;
  if (vKind < 0.5) {
    vec2 p = vC;
    float d = length(p);
    float core = exp(-d * d * 10.0);
    float glint = exp(-abs(p.x) * 11.0) * exp(-abs(p.y) * 2.0) + exp(-abs(p.y) * 11.0) * exp(-abs(p.x) * 2.0);
    float shape = (core + glint * 0.55) * (1.0 - smoothstep(0.75, 1.0, d));
    c = mix(uColor, vec3(1.0, 0.98, 0.93), core * 0.65) * shape * vI;
  } else {
    float r = length(vC) * ${RING_R.toFixed(3)};
    float k = min(u / 0.85, 1.0);
    float rt = ${(RING_R * 0.82).toFixed(4)} * (1.0 - pow(1.0 - k, 2.4));
    float w = mix(0.0045, 0.0012, u);
    float ring = exp(-pow((r - rt) / w, 2.0)) * pow(1.0 - u, 2.0) * 0.32;
    float flash = exp(-r * r / (0.014 * 0.014)) * (1.0 - smoothstep(0.0, 0.28, u)) * 0.7;
    c = uColor * (ring + flash) * (1.0 - smoothstep(0.92, 1.0, length(vC)));
  }
  gl_FragColor = vec4(c, 0.0);
}
`;

function buildGeometry(): BufferGeometry {
  const total = (SPARKS + 1) * 4;
  const pos = new Float32Array(total * 3);
  const data = new Float32Array(total * 4);
  const extra = new Float32Array(total * 4);
  const idx: number[] = [];
  const cx = [-1, 1, 1, -1];
  const cy = [-1, -1, 1, 1];
  const r = rng(2024);
  let v = 0;
  for (let q = 0; q <= SPARKS; q++) {
    const kind = q === SPARKS ? 1 : 0;
    const seed = r();
    const ang = (q / SPARKS) * Math.PI * 2 + (r() - 0.5) * 0.18;
    const speed = 0.8 + r() * 0.45;
    const size = 0.0024 + r() * 0.0022;
    const life = 0.6 + r() * 0.4;
    const base = v;
    for (let i = 0; i < 4; i++) {
      data.set([cx[i], cy[i], kind, seed], v * 4);
      extra.set([ang, speed, size, life], v * 4);
      v++;
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aData', new BufferAttribute(data, 4));
  g.setAttribute('aExtra', new BufferAttribute(extra, 4));
  g.setIndex(idx);
  return g;
}

export class Burst implements BurstVisual {
  readonly object = new Group();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private t = -1;
  private readonly tmp = new Vector3();

  constructor() {
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: true,
      uniforms: {
        uT: { value: 0 },
        uDur: { value: DUR },
        uColor: { value: new Vector3(1, 0.81, 0.54) },
      },
    });
    this.mesh = new Mesh(buildGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.object.visible = false;
    this.object.name = 'domovoi-burst';
  }

  play(at: Vector3, color?: number): void {
    this.tmp.copy(at);
    if (this.object.parent) this.object.parent.worldToLocal(this.tmp);
    this.object.position.copy(this.tmp);
    hexToRGB(color ?? 0xffcf8a, this.mat.uniforms.uColor.value as Vector3);
    this.t = 0;
    this.mat.uniforms.uT.value = 0;
    this.object.visible = true;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += Math.min(Math.max(dt, 0), 0.1);
    this.mat.uniforms.uT.value = this.t;
    if (this.t > DUR + 0.02) {
      this.t = -1;
      this.object.visible = false;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
