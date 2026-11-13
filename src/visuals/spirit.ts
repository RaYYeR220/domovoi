/**
 * The domovoi: a ~9 cm ember of warm fluff with two bead eyes.
 *
 * One draw call: a merged mesh holding (in index order) an additive halo
 * billboard, the fluffy body sphere (eyes are SDFs on its surface) and a few
 * drifting motes. Premultiplied blending lets the halo add light while the
 * body and eyes stay solid.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, SphereGeometry, Vector3 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { GLSL_NOISE, clamp01, damp, premulMaterial, rng } from './common.js';
import type { SpiritMood, SpiritVisual } from './types.js';

const BODY_R = 0.036;
const HALO_R = 0.078;
const MOTES = 9;

interface MoodParams {
  eyeScale: number;
  lidTop: number;
  lidBot: number;
  tilt: number;
  curve: number;
  asym: number;
  happy: number;
  glow: number;
  roll: number;
  glance: number;
  bob: number;
  sink: number;
  breathPeriod: number;
}

const MOODS: Record<SpiritMood, MoodParams> = {
  idle: { eyeScale: 1, lidTop: 1.25, lidBot: -1.25, tilt: 0, curve: 0, asym: 0, happy: 0, glow: 1, roll: 0, glance: 0, bob: 1, sink: 0, breathPeriod: 3.6 },
  curious: { eyeScale: 1.12, lidTop: 1.25, lidBot: -1.25, tilt: 0, curve: 0, asym: 0, happy: 0, glow: 1.05, roll: 0.2, glance: 0, bob: 0.8, sink: 0, breathPeriod: 3.2 },
  sly: { eyeScale: 1.05, lidTop: 0.28, lidBot: -0.8, tilt: -0.04, curve: 0.18, asym: 0.12, happy: 0, glow: 0.92, roll: -0.07, glance: 0.08, bob: 0.7, sink: 0.002, breathPeriod: 3.8 },
  caught: { eyeScale: 1.34, lidTop: 1.25, lidBot: -1.25, tilt: 0, curve: 0, asym: 0, happy: 0, glow: 1.08, roll: 0, glance: 0, bob: 0.4, sink: -0.004, breathPeriod: 2.2 },
  happy: { eyeScale: 1.05, lidTop: 1.25, lidBot: -1.25, tilt: 0, curve: 0, asym: 0, happy: 1, glow: 1.14, roll: 0.05, glance: 0, bob: 1.2, sink: 0, breathPeriod: 3.0 },
  sleepy: { eyeScale: 1, lidTop: -0.05, lidBot: -1.25, tilt: -0.16, curve: 0, asym: 0, happy: 0, glow: 0.74, roll: 0.1, glance: 0, bob: 0.55, sink: 0.006, breathPeriod: 5.6 },
};

const VERT = /* glsl */ `
uniform float uTime;
uniform float uBodyR;
uniform float uHaloR;
uniform vec3 uSquash;
attribute vec4 aData;
varying vec2 vC;
varying float vKind;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
varying float vA;

void main() {
  float kind = aData.z;
  vKind = kind;
  vC = aData.xy;
  vA = 1.0;
  vObjN = vec3(0.0, 0.0, 1.0);
  vViewN = vec3(0.0, 0.0, 1.0);
  vViewPos = vec3(0.0, 0.0, -1.0);
  float ms = length(modelViewMatrix[0].xyz);
  vec4 mv;
  if (kind < 0.5) {
    mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += aData.xy * uHaloR * ms;
  } else if (kind < 1.5) {
    vObjN = position;
    mv = modelViewMatrix * vec4(position * uBodyR * uSquash, 1.0);
    vViewN = normalize(normalMatrix * (position / uSquash));
    vViewPos = mv.xyz;
  } else {
    float s = aData.w;
    float period = 4.5 + 3.0 * fract(s * 7.13);
    float ph = fract(uTime / period + s * 3.7);
    float ang = 6.2831853 * fract(s * 3.71) + uTime * (0.1 + 0.12 * fract(s * 5.3));
    float rad = uBodyR * (1.3 + 0.8 * fract(s * 9.17));
    vec3 c = vec3(cos(ang) * rad, mix(-0.7, 1.6, ph) * uBodyR, sin(ang) * rad);
    vec4 mc = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv = modelViewMatrix * vec4(c, 1.0);
    float lat = length(mv.xy - mc.xy);
    float behind = step(mv.z, mc.z);
    float occ = 1.0 - behind * (1.0 - smoothstep(uBodyR * ms * 0.85, uBodyR * ms * 1.15, lat));
    vA = sin(3.14159 * ph) * occ * (0.45 + 0.55 * fract(s * 13.7));
    mv.xy += aData.xy * (0.0015 + 0.0011 * fract(s * 2.9)) * ms;
  }
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uPresence;
uniform float uGlow;
uniform float uFlash;
uniform float uBodyR;
uniform float uHaloR;
uniform float uEyeScale;
uniform float uLidTop;
uniform float uLidBot;
uniform float uLidTilt;
uniform float uLidCurve;
uniform float uLidAsym;
uniform float uHappy;
uniform float uGlance;
varying vec2 vC;
varying float vKind;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
varying float vA;

${GLSL_NOISE}

float sdArc(vec2 p, vec2 sc, float ra, float rb) {
  p.x = abs(p.x);
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}

// x = eye coverage, y = specular, z = socket shade
vec3 eye(vec2 n, float side, float fwN) {
  float R = 0.104 * uEyeScale;
  vec2 c = vec2(side * 0.315 + uGlance, 0.1);
  vec2 p = (n - c) / R;
  float fw = fwN / R * 1.1 + 1e-4;
  float outer = p.x * side;
  float dE = length(p / vec2(1.0, 1.12)) - 1.0;
  float top = uLidTop + uLidAsym * side + uLidTilt * outer - 0.14 * p.x * p.x * smoothstep(1.0, 0.3, uLidTop);
  float bot = uLidBot + uLidCurve * (1.0 - p.x * p.x);
  float dBead = max(dE, max(p.y - top, bot - p.y));
  float bead = 1.0 - smoothstep(-fw, fw, dBead);
  float dArc = sdArc(p - vec2(0.0, -0.32), vec2(0.866, 0.5), 0.8, 0.2);
  float arc = 1.0 - smoothstep(-fw, fw, dArc);
  float cov = mix(bead, arc, uHappy);
  float spY = min(0.42, top - 0.24);
  float spR = mix(0.09, 0.15, smoothstep(0.2, 0.9, top));
  float sp = 1.0 - smoothstep(spR - fw, spR + fw, length(p - vec2(-0.32, spY)));
  sp = max(sp, 0.45 * (1.0 - smoothstep(0.065 - fw, 0.065 + fw, length(p - vec2(0.3, max(-0.42, bot + 0.2))))));
  sp *= bead * (1.0 - uHappy) * smoothstep(-0.2, 0.25, top - bot - 0.55);
  float socket = (1.0 - smoothstep(0.7, 1.7, length(p * vec2(0.9, 0.8)))) * (1.0 - uHappy * 0.7) * smoothstep(-0.6, 0.8, top - bot);
  return vec3(cov, sp, socket);
}

void main() {
  float fwN = fwidth(vObjN.y) + fwidth(vObjN.x) * 0.5;
  vec4 outc;
  if (vKind < 0.5) {
    // halo: additive glow + a normal-blended tufty fringe that breaks the silhouette
    float r = length(vC);
    float rb = uBodyR / uHaloR;
    vec2 dir = vC / max(r, 1e-4);
    float fil = vnoise(dir * 3.2 + vec2(0.0, uTime * 0.16)) * 0.6 + vnoise(dir * 8.5 - vec2(uTime * 0.11, 0.0)) * 0.4;
    float x = max(r - rb * 0.9, 0.0) / (1.0 - rb * 0.9);
    float g = exp(-x * 4.8) * (0.4 + 0.7 * fil) + exp(-x * 18.0) * 0.35;
    g *= 1.0 - smoothstep(0.7, 1.0, x);
    vec3 gcol = mix(vec3(1.0, 0.68, 0.36), vec3(1.0, 0.9, 0.74), exp(-x * 7.0));
    float tuft = vnoise(dir * 7.5 + vec2(uTime * 0.06, -uTime * 0.045)) * 0.6
               + vnoise(dir * 19.0 - vec2(uTime * 0.035)) * 0.4;
    float strand = vnoise(dir * (24.0 + r * 9.0) + vec2(3.7, uTime * 0.02));
    float fr = rb * (1.03 + 0.22 * tuft + 0.06 * strand);
    float fringe = 1.0 - smoothstep(rb * 0.9, fr, r);
    fringe *= fringe * (0.7 + 0.3 * strand) * smoothstep(rb * 0.75, rb * 0.9, r);
    float fa = fringe * 0.7;
    vec3 fcol = mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 0.95, 0.86), strand) * (uGlow + uFlash * 0.7);
    outc = vec4(fcol * fa + gcol * g * 0.38 * (uGlow + uFlash * 1.6), fa);
  } else if (vKind < 1.5) {
    vec3 N = normalize(vViewN);
    vec3 V = normalize(-vViewPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    vec3 on = normalize(vObjN);
    float fur = vnoise3(on * 5.0 + vec3(0.0, -uTime * 0.1, uTime * 0.04)) * 0.7
              + vnoise3(on * 13.0 + vec3(uTime * 0.05)) * 0.3;
    float pr = sqrt(max(1.0 - ndv * ndv, 0.0));
    float rimT = pow(smoothstep(0.3, 1.04, pr + (fur - 0.5) * 0.08), 1.7);
    vec3 amber = vec3(1.0, 0.68, 0.34);
    vec3 deep = vec3(0.88, 0.47, 0.2);
    vec3 cream = vec3(1.0, 0.91, 0.78);
    vec3 col = mix(amber, cream, rimT);
    float ember = vnoise3(on * 2.3 + vec3(uTime * 0.13, -uTime * 0.09, 0.0));
    col *= 0.95 + 0.12 * ember * (1.0 - rimT);
    col = mix(col, deep, (1.0 - rimT) * smoothstep(0.1, -0.95, on.y) * 0.45);
    col *= (0.94 + 0.09 * fur) * (uGlow + uFlash * 0.7);
    float a = smoothstep(0.0, 0.45, ndv + (fur - 0.5) * 0.3);
    vec3 e1 = eye(on.xy, -1.0, fwN);
    vec3 e2 = eye(on.xy, 1.0, fwN);
    float front = smoothstep(0.3, 0.5, on.z);
    float cov = max(e1.x, e2.x) * front;
    float sp = max(e1.y, e2.y) * front;
    col *= 1.0 - 0.13 * max(e1.z, e2.z) * front;
    col = mix(col, vec3(0.12, 0.08, 0.055), cov);
    col = mix(col, vec3(1.0, 0.97, 0.92), sp);
    a = max(a, cov);
    outc = vec4(col * a, a);
  } else {
    float r = length(vC);
    float m = exp(-r * r * 5.0) * (1.0 - smoothstep(0.7, 1.0, r));
    outc = vec4(vec3(1.0, 0.82, 0.55) * m * vA * 0.85, 0.0);
  }
  gl_FragColor = outc * uPresence;
}
`;

function buildGeometry(): BufferGeometry {
  const sphere = new SphereGeometry(1, 30, 22);
  const sPos = sphere.getAttribute('position');
  const sIdx = sphere.getIndex();
  const sCount = sPos.count;
  const total = 4 + sCount + MOTES * 4;
  const pos = new Float32Array(total * 3);
  const data = new Float32Array(total * 4);
  const idx: number[] = [];
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  let v = 0;
  const quad = (kind: number, seed: number): void => {
    const base = v;
    for (let i = 0; i < 4; i++) {
      data[v * 4] = corners[i * 2];
      data[v * 4 + 1] = corners[i * 2 + 1];
      data[v * 4 + 2] = kind;
      data[v * 4 + 3] = seed;
      v++;
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(0, 0);
  const bodyBase = v;
  for (let i = 0; i < sCount; i++) {
    pos[v * 3] = sPos.getX(i);
    pos[v * 3 + 1] = sPos.getY(i);
    pos[v * 3 + 2] = sPos.getZ(i);
    data[v * 4 + 2] = 1;
    v++;
  }
  if (sIdx) for (let i = 0; i < sIdx.count; i++) idx.push(bodyBase + sIdx.getX(i));
  const r = rng(91);
  for (let m = 0; m < MOTES; m++) quad(2, (m + r()) / MOTES);
  sphere.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aData', new BufferAttribute(data, 4));
  g.setIndex(idx);
  return g;
}

const wrapAngle = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};

export class Spirit implements SpiritVisual {
  readonly object = new Group();
  private readonly mover = new Group();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private mood: SpiritMood = 'idle';
  private readonly cur: MoodParams = { ...MOODS.idle };
  private presence = 1;
  private presenceTarget = 1;
  private hopT = -1;
  private hopH = 0.026;
  private hopDur = 0.36;
  private flash = 0;
  private blinkWait = 2.5;
  private blinkPhase = -1;
  private blinkDur = 0.16;
  private breathPh = 0;
  private bobPh = 0;
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private hasLook = false;
  private readonly lookWorld = new Vector3();
  private readonly tmp = new Vector3();
  private readonly lean = new Vector3();
  private readonly rand = rng(1337);

  constructor() {
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPresence: { value: 1 },
        uGlow: { value: 1 },
        uFlash: { value: 0 },
        uBodyR: { value: BODY_R },
        uHaloR: { value: HALO_R },
        uSquash: { value: new Vector3(1, 1, 1) },
        uEyeScale: { value: 1 },
        uLidTop: { value: 1.25 },
        uLidBot: { value: -1.25 },
        uLidTilt: { value: 0 },
        uLidCurve: { value: 0 },
        uLidAsym: { value: 0 },
        uHappy: { value: 0 },
        uGlance: { value: 0 },
      },
    });
    this.mesh = new Mesh(buildGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.rotation.order = 'YXZ';
    this.mover.add(this.mesh);
    this.object.add(this.mover);
    this.object.name = 'domovoi-spirit';
  }

  setMood(mood: SpiritMood): void {
    if (mood === this.mood) return;
    if (mood === 'caught') {
      this.flash = 1;
      this.startHop(0.011, 0.22);
    }
    this.mood = mood;
    this.blinkPhase = -1;
    this.blinkWait = mood === 'sleepy' ? 1.2 : mood === 'caught' ? 2.5 + this.rand() * 2 : 0.8 + this.rand() * 2;
  }

  lookAt(worldPoint: Vector3): void {
    this.lookWorld.copy(worldPoint);
    this.hasLook = true;
  }

  setPresence(p: number): void {
    this.presenceTarget = clamp01(p);
  }

  hop(): void {
    this.startHop(0.026, 0.36);
  }

  private startHop(h: number, dur: number): void {
    this.hopT = 0;
    this.hopH = h;
    this.hopDur = dur;
  }

  update(dtIn: number, t: number): void {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    const u = this.mat.uniforms;

    this.presence = damp(this.presence, this.presenceTarget, 30, dt);
    if (Math.abs(this.presence - this.presenceTarget) < 0.002) this.presence = this.presenceTarget;
    this.object.visible = this.presence > 0.003;
    if (!this.object.visible) return;

    const target = MOODS[this.mood];
    const c = this.cur;
    const k = 10;
    c.eyeScale = damp(c.eyeScale, target.eyeScale, k, dt);
    c.lidTop = damp(c.lidTop, target.lidTop, k, dt);
    c.lidBot = damp(c.lidBot, target.lidBot, k, dt);
    c.tilt = damp(c.tilt, target.tilt, k, dt);
    c.curve = damp(c.curve, target.curve, k, dt);
    c.asym = damp(c.asym, target.asym, k, dt);
    c.happy = damp(c.happy, target.happy, 12, dt);
    c.glow = damp(c.glow, target.glow, 4, dt);
    c.roll = damp(c.roll, target.roll, 5, dt);
    c.glance = damp(c.glance, target.glance, 6, dt);
    c.bob = damp(c.bob, target.bob, 3, dt);
    c.sink = damp(c.sink, target.sink, 3, dt);
    c.breathPeriod = damp(c.breathPeriod, target.breathPeriod, 2, dt);
    this.flash *= Math.exp(-dt * 5);

    // Blinks: quick close, slower open; long and lazy when sleepy.
    let blink = 0;
    if (this.blinkPhase < 0) {
      this.blinkWait -= dt;
      if (this.blinkWait <= 0 && this.mood !== 'happy') {
        this.blinkPhase = 0;
        this.blinkDur = this.mood === 'sleepy' ? 0.6 : 0.17;
      }
    } else {
      this.blinkPhase += dt / this.blinkDur;
      const ph = this.blinkPhase;
      blink = ph < 0.4 ? ph / 0.4 : 1 - (ph - 0.4) / 0.6;
      blink = blink * blink * (3 - 2 * blink);
      if (ph >= 1) {
        this.blinkPhase = -1;
        blink = 0;
        this.blinkWait = this.mood === 'sleepy' ? 2.5 + this.rand() * 3 : 2.2 + this.rand() * 4.5;
      }
    }

    // Breathing + floating bob (phase-accumulated so mood changes never jump).
    this.breathPh += dt / c.breathPeriod;
    this.bobPh += dt / (c.breathPeriod * 0.78);
    const breath = Math.sin(this.breathPh * Math.PI * 2);
    const amp = this.mood === 'sleepy' ? 1.4 : 1;
    let sy = 1 + 0.026 * breath * amp;
    let sxz = 1 - 0.012 * breath * amp;
    let y =
      c.bob * (0.0055 * Math.sin(this.bobPh * Math.PI * 2) + 0.0018 * Math.sin(this.bobPh * Math.PI * 4.6 + 1.1)) -
      c.sink;

    if (this.hopT >= 0) {
      this.hopT += dt;
      const hu = this.hopT / this.hopDur;
      if (hu < 1) {
        y += this.hopH * 4 * hu * (1 - hu);
        const s = Math.sin(Math.PI * hu) * (this.hopH / 0.026);
        sy *= 1 + 0.06 * s;
        sxz *= 1 - 0.03 * s;
      } else if (hu < 1.3) {
        const s = Math.sin((Math.PI * (hu - 1)) / 0.3) * (this.hopH / 0.026);
        sy *= 1 - 0.055 * s;
        sxz *= 1 + 0.028 * s;
      } else {
        this.hopT = -1;
      }
    }

    // Look-at: yaw/pitch of the face (+Z) toward the target, plus a small lean.
    this.lean.set(0, 0, 0);
    if (this.hasLook) {
      this.tmp.copy(this.lookWorld);
      this.object.worldToLocal(this.tmp);
      const dx = this.tmp.x;
      const dy = this.tmp.y - this.mover.position.y;
      const dz = this.tmp.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz + Math.abs(dy) > 1e-4) {
        this.yawTarget = Math.atan2(dx, dz);
        this.pitchTarget = Math.max(-0.55, Math.min(0.55, -Math.atan2(dy, Math.max(horiz, 1e-4))));
        const len = Math.hypot(dx, dy, dz);
        this.lean.set(dx / len, dy / len, dz / len).multiplyScalar(0.004);
      }
    }
    this.yaw += wrapAngle(this.yawTarget - this.yaw) * (1 - Math.exp(-6 * dt));
    this.pitch = damp(this.pitch, this.pitchTarget, 6, dt);
    const sway = 0.035 * Math.sin(t * 0.7) * c.bob;
    this.mesh.rotation.set(this.pitch, this.yaw, c.roll + sway);

    const pScale = 0.82 + 0.18 * this.presence;
    this.mover.position.set(this.lean.x, y + this.lean.y, this.lean.z);
    this.mover.scale.setScalar(pScale);

    u.uTime.value = t;
    u.uPresence.value = this.presence;
    u.uGlow.value = c.glow * (1 + 0.04 * breath);
    u.uFlash.value = this.flash;
    (u.uSquash.value as Vector3).set(sxz, sy, sxz);
    u.uEyeScale.value = c.eyeScale * (1 + 0.05 * this.flash);
    u.uLidTop.value = c.lidTop + (-1.2 - c.lidTop) * blink;
    u.uLidBot.value = c.lidBot + (-0.5 - c.lidBot) * blink * 0.4;
    u.uLidTilt.value = c.tilt;
    u.uLidCurve.value = c.curve * (1 - blink);
    u.uLidAsym.value = c.asym * (1 - blink);
    u.uHappy.value = c.happy;
    u.uGlance.value = c.glance;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
