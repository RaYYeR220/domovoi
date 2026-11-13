/**
 * Hand viewfinder: L-brackets at the four corners, a 30% hairline rectangle,
 * a shutter ring at the centre and a white flash fill. One dynamic mesh, one
 * draw call. Strokes carry a soft dark shadow so they read over bright
 * passthrough.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, Mesh, Quaternion, Vector3 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { clamp01, premulMaterial } from './common.js';
import type { FrameCorners, ViewfinderVisual } from './types.js';

/** Bracket stroke half-width and ribbon half-width (incl. shadow), metres. */
const BW = 0.0011;
const BO = 0.0027;
/** Hairline. */
const HW = 0.00038;
const HO = 0.0013;
const FLASH_DUR = 0.25;

const V_FILL = 0;
const V_LOOP = 4;
const V_BRK = 12;
const V_RING = 36;
const V_TOTAL = 40;
const RING_SX = [-1, 1, 1, -1];
const RING_SY = [-1, -1, 1, 1];

const VERT = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uNormal;
attribute vec4 aData;
varying vec4 vD;
varying float vSide;
void main() {
  vD = aData;
  vec3 nW = normalize(mat3(modelMatrix) * uNormal);
  vec3 cW = (modelMatrix * vec4(uCenter, 1.0)).xyz;
  vSide = dot(nW, cameraPosition - cW) >= 0.0 ? 1.0 : -1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uProgress;
uniform float uFlash;
uniform float uArmLen;
uniform float uRingR;
uniform float uRingS;
varying vec4 vD;
varying float vSide;

const float BW = ${BW.toFixed(6)};
const float BO = ${BO.toFixed(6)};
const float HW = ${HW.toFixed(6)};
const float HO = ${HO.toFixed(6)};

// white stroke (alpha wA) over a soft dark shadow (alpha sA); premultiplied.
vec4 stroke(float sd, float aa, float soft, float wA, float sA) {
  float w = (1.0 - smoothstep(-aa, aa, sd)) * wA;
  float s = (1.0 - smoothstep(-aa, soft, sd)) * sA;
  vec4 dark = vec4(vec3(0.04, 0.035, 0.03) * s, s);
  return vec4(vec3(w), w) + dark * (1.0 - w);
}

void main() {
  float kind = vD.z;
  vec4 c = vec4(0.0);
  if (kind < 0.5) {
    float f = uFlash;
    c = vec4(vec3(f * 0.85), f * 0.5);
  } else if (kind < 1.5) {
    float d = abs(vD.x) * HO;
    float aa = max(fwidth(d), 1e-6) * 0.75;
    c = stroke(d - HW, aa, HO - HW, 0.3, 0.16);
  } else if (kind < 2.5) {
    float d = abs(vD.x) * BO;
    float al = vD.y;
    float aa = max(max(fwidth(d), fwidth(al)), 1e-6) * 0.75;
    float sd = max(d - BW, max(-al, al - 2.0 * uArmLen));
    c = stroke(sd, aa, BO - BW, 1.0, 0.46);
  } else {
    vec2 p = vD.xy * uRingS;
    float r = length(p);
    float aa = max(fwidth(r), 1e-6) * 0.75;
    float ang = atan(p.x * vSide, p.y);
    float fr = (ang < 0.0 ? ang + 6.2831853 : ang) / 6.2831853;
    float aaA = aa / max(6.2831853 * r, 1e-4);
    float fill = smoothstep(fr - aaA, fr + aaA, uProgress);
    float dr = abs(r - uRingR);
    float sdTrack = dr - 0.00045;
    float sdArc = dr - 0.0009;
    float sdDot = r - 0.0007;
    vec4 track = stroke(sdTrack, aa, 0.0014, 0.34, 0.26);
    vec4 arc = stroke(sdArc, aa, 0.0016, 1.0, 0.44) * fill;
    vec4 dotc = stroke(sdDot, aa, 0.0011, 0.75, 0.3);
    c = arc + track * (1.0 - arc.a);
    c = dotc + c * (1.0 - dotc.a);
  }
  gl_FragColor = c * uOpacity;
}
`;

function buildGeometry(): BufferGeometry {
  const pos = new Float32Array(V_TOTAL * 3);
  const data = new Float32Array(V_TOTAL * 4);
  const set = (v: number, a: number, b: number, kind: number): void => {
    data[v * 4] = a;
    data[v * 4 + 1] = b;
    data[v * 4 + 2] = kind;
  };
  const idx: number[] = [];
  // fill
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  for (let i = 0; i < 4; i++) set(V_FILL + i, uv[i * 2], uv[i * 2 + 1], 0);
  idx.push(0, 1, 2, 0, 2, 3);
  // hairline loop: corner k -> (outer = 2k, inner = 2k+1)
  for (let k = 0; k < 4; k++) {
    set(V_LOOP + k * 2, 1, 0, 1);
    set(V_LOOP + k * 2 + 1, -1, 0, 1);
    const a = V_LOOP + k * 2;
    const b = V_LOOP + ((k + 1) % 4) * 2;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
  }
  // brackets: per corner [A+, A-, C+, C-, B+, B-]
  for (let k = 0; k < 4; k++) {
    const base = V_BRK + k * 6;
    for (let j = 0; j < 3; j++) {
      set(base + j * 2, 1, 0, 2);
      set(base + j * 2 + 1, -1, 0, 2);
    }
    for (let j = 0; j < 2; j++) {
      const a = base + j * 2;
      const b = a + 2;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  // ring quad
  const rc = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < 4; i++) set(V_RING + i, rc[i * 2], rc[i * 2 + 1], 3);
  idx.push(V_RING, V_RING + 1, V_RING + 2, V_RING, V_RING + 2, V_RING + 3);
  const g = new BufferGeometry();
  const pAttr = new BufferAttribute(pos, 3);
  pAttr.setUsage(DynamicDrawUsage);
  const dAttr = new BufferAttribute(data, 4);
  dAttr.setUsage(DynamicDrawUsage);
  g.setAttribute('position', pAttr);
  g.setAttribute('aData', dAttr);
  g.setIndex(idx);
  return g;
}

export class Viewfinder implements ViewfinderVisual {
  readonly object = new Group();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly pos: BufferAttribute;
  private readonly data: BufferAttribute;
  private readonly local: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly pc: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private hasFrame = false;
  private everSet = false;
  private opacity = 0;
  private progress = 0;
  private flashT = -1;
  // scratch
  private readonly c = new Vector3();
  private readonly n = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly o1 = new Vector3();
  private readonly o2 = new Vector3();
  private readonly m = new Vector3();
  private readonly ex = new Vector3();
  private readonly ey = new Vector3();
  private readonly tmp = new Vector3();
  private readonly q = new Quaternion();
  /** Writes a vertex position (bound once, no per-frame closure). */
  private readonly put = (v: number, p: Vector3): void => {
    const P = this.pos.array as Float32Array;
    P[v * 3] = p.x;
    P[v * 3 + 1] = p.y;
    P[v * 3 + 2] = p.z;
  };

  constructor() {
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      depthTest: false,
      uniforms: {
        uOpacity: { value: 0 },
        uProgress: { value: 0 },
        uFlash: { value: 0 },
        uArmLen: { value: 0.02 },
        uRingR: { value: 0.0085 },
        uRingS: { value: 0.012 },
        uCenter: { value: new Vector3() },
        uNormal: { value: new Vector3(0, 0, 1) },
      },
    });
    const geo = buildGeometry();
    this.pos = geo.getAttribute('position') as BufferAttribute;
    this.data = geo.getAttribute('aData') as BufferAttribute;
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.object.add(this.mesh);
    this.object.visible = false;
    this.object.name = 'domovoi-viewfinder';
  }

  setFrame(corners: FrameCorners | null, progress: number): void {
    this.progress = clamp01(progress);
    if (!corners) {
      this.hasFrame = false;
      return;
    }
    this.hasFrame = true;
    this.everSet = true;
    for (let i = 0; i < 4; i++) {
      this.local[i].copy(corners[i]);
      this.object.worldToLocal(this.local[i]);
    }
  }

  flash(): void {
    this.flashT = 0;
  }

  update(dtIn: number): void {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    const target = this.hasFrame ? 1 : 0;
    const rate = this.hasFrame ? 1 / 0.1 : 1 / 0.14;
    this.opacity = target > this.opacity ? Math.min(1, this.opacity + dt * rate) : Math.max(0, this.opacity - dt * rate);

    let flash = 0;
    let pulse = 0;
    if (this.flashT >= 0) {
      this.flashT += dt;
      const ft = this.flashT;
      flash = ft < 0.03 ? ft / 0.03 : Math.exp(-(ft - 0.03) * 14);
      pulse = Math.sin(Math.PI * Math.min(ft / FLASH_DUR, 1));
      if (ft > FLASH_DUR + 0.05) {
        this.flashT = -1;
        flash = 0;
        pulse = 0;
      }
    }

    const vis = this.everSet && (this.opacity > 0.001 || this.flashT >= 0);
    this.object.visible = vis;
    if (!vis) return;

    this.rebuild(pulse, flash > 0.002);
    const u = this.mat.uniforms;
    u.uOpacity.value = this.opacity * this.opacity * (3 - 2 * this.opacity);
    u.uProgress.value = this.progress;
    u.uFlash.value = flash;
  }

  private rebuild(pulse: number, showFill: boolean): void {
    const { pc, c, n, a, b, o1, o2, m, ex, ey, tmp } = this;
    const D = this.data.array as Float32Array;
    const put = this.put;

    c.set(0, 0, 0);
    for (let i = 0; i < 4; i++) c.add(this.local[i]);
    c.multiplyScalar(0.25);
    for (let i = 0; i < 4; i++) pc[i].copy(this.local[i]).lerp(c, 0.035 * pulse);

    a.subVectors(pc[2], pc[0]);
    b.subVectors(pc[3], pc[1]);
    n.crossVectors(a, b);
    if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
    n.normalize();

    let minSide = Infinity;
    for (let i = 0; i < 4; i++) minSide = Math.min(minSide, pc[i].distanceTo(pc[(i + 1) % 4]));
    const L = Math.min(Math.max(minSide * 0.16, 0.012), 0.032, minSide * 0.45);

    // fill (collapsed unless flashing)
    for (let i = 0; i < 4; i++) put(V_FILL + i, showFill ? pc[i] : c);

    for (let k = 0; k < 4; k++) {
      const prev = pc[(k + 3) % 4];
      const cur = pc[k];
      const next = pc[(k + 1) % 4];
      // incoming / outgoing directions for the loop
      a.subVectors(cur, prev).normalize();
      b.subVectors(next, cur).normalize();
      o1.crossVectors(n, a).normalize();
      o2.crossVectors(n, b).normalize();
      m.addVectors(o1, o2).normalize();
      const ml = HO / Math.max(m.dot(o1), 0.25);
      tmp.copy(cur).addScaledVector(m, ml);
      put(V_LOOP + k * 2, tmp);
      tmp.copy(cur).addScaledVector(m, -ml);
      put(V_LOOP + k * 2 + 1, tmp);

      // bracket polyline A' -> C -> B'
      const base = V_BRK + k * 6;
      // a = direction C->prev, b = direction C->next
      a.subVectors(prev, cur).normalize();
      b.subVectors(next, cur).normalize();
      // segment 1 runs A'->C (dir -a), segment 2 runs C->B' (dir b)
      tmp.copy(a).negate();
      o1.crossVectors(n, tmp).normalize();
      o2.crossVectors(n, b).normalize();
      m.addVectors(o1, o2).normalize();
      const bl = BO / Math.max(m.dot(o1), 0.25);
      const ext = L + BO;
      tmp.copy(cur).addScaledVector(a, ext).addScaledVector(o1, BO);
      put(base, tmp);
      tmp.copy(cur).addScaledVector(a, ext).addScaledVector(o1, -BO);
      put(base + 1, tmp);
      tmp.copy(cur).addScaledVector(m, bl);
      put(base + 2, tmp);
      tmp.copy(cur).addScaledVector(m, -bl);
      put(base + 3, tmp);
      tmp.copy(cur).addScaledVector(b, ext).addScaledVector(o2, BO);
      put(base + 4, tmp);
      tmp.copy(cur).addScaledVector(b, ext).addScaledVector(o2, -BO);
      put(base + 5, tmp);
      D[(base + 0) * 4 + 1] = -BO;
      D[(base + 1) * 4 + 1] = -BO;
      D[(base + 2) * 4 + 1] = L;
      D[(base + 3) * 4 + 1] = L;
      D[(base + 4) * 4 + 1] = 2 * L + BO;
      D[(base + 5) * 4 + 1] = 2 * L + BO;
    }

    // ring: "up" = world up projected into the frame plane
    this.object.getWorldQuaternion(this.q).invert();
    ey.set(0, 1, 0).applyQuaternion(this.q);
    ey.addScaledVector(n, -ey.dot(n));
    if (ey.lengthSq() < 0.01) ey.subVectors(pc[3], pc[0]);
    ey.normalize();
    ex.crossVectors(ey, n).normalize();
    const R = Math.min(Math.max(minSide * 0.06, 0.006), 0.0095);
    const S = R + 0.0028;
    for (let i = 0; i < 4; i++) {
      tmp.copy(c).addScaledVector(ex, RING_SX[i] * S).addScaledVector(ey, RING_SY[i] * S);
      put(V_RING + i, tmp);
    }

    const u = this.mat.uniforms;
    u.uArmLen.value = L;
    u.uRingR.value = R;
    u.uRingS.value = S;
    (u.uCenter.value as Vector3).copy(c);
    (u.uNormal.value as Vector3).copy(n);
    this.pos.needsUpdate = true;
    this.data.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
