/**
 * 5–9 small pale flowers opening on top of a real plant. size = plant
 * bounding box, local origin = box centre. Each flower is five cupped petals
 * + a stippled centre, shaped and opened entirely in the vertex shader;
 * flowers are instanced (one draw call, opaque).
 */

import {
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { GLSL_NOISE, GeoBuilder, clamp01, rng } from './common.js';
import { ToggleBase } from './toggle.js';

const PETALS = 5;
const T_STEPS = 7;
const S_STEPS = 5;
const STAGGER = 0.3;

const VERT = /* glsl */ `
uniform float uOpen;
uniform float uTime;
attribute vec4 aData;   // t, s, phi, kind
attribute vec4 aInst;   // delay, tint, seed, petal scale
varying vec2 vTS;
varying float vKind;
varying float vTint;
varying float vLit;
varying vec2 vDisc;

void main() {
  float local = clamp((uOpen - aInst.x) / (1.0 - ${STAGGER.toFixed(2)}), 0.0, 1.0);
  float grow = smoothstep(0.0, 0.38, local);
  float op = smoothstep(0.12, 1.0, local);
  op = 1.0 - pow(1.0 - op, 2.6);
  float sway = sin(uTime * 0.9 + aInst.z * 6.2831) * 0.035 * op;
  float th = mix(0.1, 1.12, op) + sway;
  float curl = mix(0.04, 0.5, op);
  vec3 p;
  vec3 n;
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (aData.w < 0.5) {
    float t = aData.x;
    float s = aData.y;
    float phi = aData.z + sin(aInst.z * 17.0 + aData.z * 3.0) * 0.08;
    vec3 r = vec3(cos(phi), 0.0, sin(phi));
    vec3 tg = vec3(-sin(phi), 0.0, cos(phi));
    float thm = th + curl * t;
    vec3 dir = r * sin(thm) + up * cos(thm);
    vec3 inN = up * sin(thm) - r * cos(thm);
    float w = 0.44 * pow(max(sin(3.14159 * pow(t, 1.3)), 0.0), 0.75);
    float cup = 0.12 + 0.2 * op;
    p = dir * t * aInst.w + tg * s * w + inN * (s * s) * w * cup;
    p += up * 0.05;
    n = normalize(inN - tg * s * cup * 1.6);
    vTS = vec2(t, s);
    vDisc = vec2(0.0);
  } else {
    p = vec3(aData.x, 0.0, aData.y) * 0.17 + up * (0.075 + 0.02 * (1.0 - dot(aData.xy, aData.xy)));
    n = up;
    vTS = vec2(0.0);
    vDisc = aData.xy;
  }
  p *= grow;
  vec4 wp = instanceMatrix * vec4(p, 1.0);
  vec3 wn = normalize(mat3(instanceMatrix) * n);
  vec3 L = normalize(vec3(0.3, 1.0, 0.45));
  vLit = 0.72 + 0.3 * abs(dot(wn, L));
  vKind = aData.w;
  vTint = aInst.y;
  gl_Position = projectionMatrix * modelViewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
varying vec2 vTS;
varying float vKind;
varying float vTint;
varying float vLit;
varying vec2 vDisc;
${GLSL_NOISE}
void main() {
  vec3 c;
  if (vKind < 0.5) {
    float t = vTS.x;
    float s = vTS.y;
    vec3 base = vec3(0.86, 0.86, 0.68);
    vec3 body = vec3(0.975, 0.958, 0.93);
    vec3 tip = vTint < 0.33 ? vec3(0.985, 0.95, 0.9) : (vTint < 0.66 ? vec3(0.97, 0.88, 0.9) : vec3(0.9, 0.89, 0.97));
    c = mix(base, body, smoothstep(0.0, 0.32, t));
    c = mix(c, tip, smoothstep(0.45, 1.0, t) * 0.85);
    c *= 1.0 - 0.05 * (1.0 - smoothstep(0.0, 0.06, abs(s))) * smoothstep(0.1, 0.5, t) * (1.0 - t);
    c *= 1.0 - 0.1 * s * s * smoothstep(0.2, 0.9, t);
    c *= vLit;
  } else {
    float r = length(vDisc);
    float dots = step(0.72, hash12(floor(vDisc * 9.0 + 3.0)));
    c = mix(vec3(0.82, 0.64, 0.3), vec3(0.62, 0.45, 0.2), dots * 0.6);
    c *= 0.85 + 0.2 * (1.0 - r);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

function buildFlowerGeometry(): GeoBuilder {
  const b = new GeoBuilder();
  for (let k = 0; k < PETALS; k++) {
    const phi = (k / PETALS) * Math.PI * 2;
    const base = b.count;
    for (let i = 0; i < T_STEPS; i++) {
      const t = i / (T_STEPS - 1);
      for (let j = 0; j < S_STEPS; j++) {
        const s = (j / (S_STEPS - 1)) * 2 - 1;
        b.vert(0, 0, 0, t, s, phi, 0);
      }
    }
    for (let i = 0; i < T_STEPS - 1; i++) {
      for (let j = 0; j < S_STEPS - 1; j++) {
        const a = base + i * S_STEPS + j;
        b.quad(a, a + 1, a + S_STEPS + 1, a + S_STEPS);
      }
    }
  }
  const SEG = 10;
  const centre = b.vert(0, 0, 0, 0, 0, 0, 1);
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    b.vert(0, 0, 0, Math.cos(a), Math.sin(a), 0, 1);
  }
  for (let i = 0; i < SEG; i++) b.tri(centre, centre + 1 + ((i + 1) % SEG), centre + 1 + i);
  return b;
}

export class Bloom extends ToggleBase {
  private readonly mesh: InstancedMesh;
  private readonly mat: ShaderMaterial;

  constructor(size: Vector3, seed: number) {
    super(1.0, 0.7);
    const sx = Math.max(size.x, 0.06);
    const sy = Math.max(size.y, 0.06);
    const sz = Math.max(size.z, 0.06);
    const r = rng(Math.floor(seed * 1000003) ^ 0x5bd1e995);
    const count = 5 + Math.floor(r() * 5);
    const k = Math.min(Math.max(Math.min(sx, sz) * 0.05, 0.009), 0.016);

    const geo = buildFlowerGeometry().build();
    const inst = new Float32Array(count * 4);
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      uniforms: { uOpen: { value: 0 }, uTime: { value: 0 } },
    });
    this.mesh = new InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;

    // scatter on the crown (ellipse), rejection-sampled for spacing
    const pts: number[][] = [];
    const rx = sx * 0.33;
    const rz = sz * 0.33;
    const minD = k * 2.4;
    for (let tries = 0; pts.length < count && tries < 400; tries++) {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r());
      const x = Math.cos(a) * rad * rx;
      const z = Math.sin(a) * rad * rz;
      if (pts.every((p) => Math.hypot(p[0] - x, p[1] - z) > minD) || tries > 300) pts.push([x, z, rad]);
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const spin = new Quaternion();
    const axis = new Vector3();
    const Y = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const scl = new Vector3();
    for (let i = 0; i < count; i++) {
      const [x, z, rad] = pts[i];
      // dome-shaped crown: flowers sit lower toward the rim
      const y = sy / 2 + 0.004 - sy * (0.16 * rad * rad + r() * 0.03);
      const outward = Math.atan2(z, x);
      const tilt = 0.05 + rad * 0.28 + r() * 0.06;
      // lean away from the crown centre, random spin about the stem
      axis.set(Math.sin(outward), 0, -Math.cos(outward));
      q.setFromAxisAngle(axis, tilt).multiply(spin.setFromAxisAngle(Y, r() * Math.PI * 2));
      const sc = k * (0.85 + r() * 0.3);
      pos.set(x, y, z);
      scl.setScalar(sc);
      m.compose(pos, q, scl);
      this.mesh.setMatrixAt(i, m);
      inst[i * 4] = (i / Math.max(1, count - 1)) * STAGGER * (0.6 + r() * 0.4);
      inst[i * 4 + 1] = r();
      inst[i * 4 + 2] = r();
      inst[i * 4 + 3] = 0.92 + r() * 0.16;
    }
    geo.setAttribute('aInst', new InstancedBufferAttribute(inst, 4));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.object.add(this.mesh);
    this.object.name = 'domovoi-bloom';
  }

  protected apply(f: number, _dt: number, t: number): void {
    const u = this.mat.uniforms;
    u.uOpen.value = clamp01(f);
    if (t >= 0) u.uTime.value = t;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    this.object.removeFromParent();
  }
}
