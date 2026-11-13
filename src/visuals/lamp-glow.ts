/**
 * Warm lamp glow over a real lamp. Local origin = centre of the lamp's
 * bounding box. A wide soft halo + bright core sprite near the top of the box
 * and a faint open cone of light falling downward (fresnel-faded so it reads
 * as volume, not a shape). All additive, one draw call.
 */

import { CylinderGeometry, Mesh, Vector3 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { DoubleSide } from '@iwsdk/core';
import { GeoBuilder, premulMaterial, smoothstep01 } from './common.js';
import { ToggleBase } from './toggle.js';

const VERT = /* glsl */ `
uniform float uGlowY;
uniform float uConeH;
uniform float uHaloR;
uniform float uCoreR;
uniform float uPull;
attribute vec4 aData;
attribute vec3 aExtra;
varying vec2 vC;
varying float vKind;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  vKind = aData.z;
  vC = aData.xy;
  vH = 0.0;
  vN = vec3(0.0, 0.0, 1.0);
  vV = vec3(0.0, 0.0, 1.0);
  float ms = length(modelViewMatrix[0].xyz);
  vec4 mv;
  if (aData.z < 0.5) {
    mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * aExtra);
    vV = -mv.xyz;
    vH = (uGlowY - position.y) / uConeH;
  } else {
    mv = modelViewMatrix * vec4(0.0, uGlowY, 0.0, 1.0);
    mv.xyz += normalize(-mv.xyz) * min(uPull * ms, max(-mv.z - 0.05, 0.0));
    mv.xy += aData.xy * (aData.z < 1.5 ? uHaloR : uCoreR) * ms;
  }
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uFade;
uniform float uBreath;
varying vec2 vC;
varying float vKind;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 warm = vec3(1.0, 0.74, 0.42);
  vec3 c;
  if (vKind < 0.5) {
    float f = abs(dot(normalize(vN), normalize(vV)));
    float h = clamp(vH, 0.0, 1.0);
    float a = pow(f, 1.7) * pow(1.0 - h, 2.3) * smoothstep(0.02, 0.16, h);
    c = mix(warm, vec3(1.0, 0.88, 0.7), 0.4) * a * 0.075;
  } else if (vKind < 1.5) {
    float r = length(vC);
    float g = (exp(-r * r * 5.5) * 0.24 + exp(-r * 3.6) * 0.1) * (1.0 - smoothstep(0.72, 1.0, r));
    c = warm * g;
  } else {
    float r = length(vC);
    float g = exp(-r * r * 8.0) * 0.55 * (1.0 - smoothstep(0.6, 1.0, r));
    c = mix(warm, vec3(1.0, 0.95, 0.86), 0.55) * g;
  }
  gl_FragColor = vec4(c * uFade * uBreath, 0.0);
}
`;

export class LampGlow extends ToggleBase {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor(size: Vector3) {
    super(0.6, 0.6);
    const sx = Math.max(size.x, 0.05);
    const sy = Math.max(size.y, 0.05);
    const sz = Math.max(size.z, 0.05);
    const wide = Math.max(sx, sz);
    const glowY = sy / 2 - Math.min(0.05, sy * 0.12);
    const coneH = sy + 0.3;
    const rTop = wide * 0.3;
    const rBot = rTop + coneH * 0.55;

    const b = new GeoBuilder(3);
    const cone = new CylinderGeometry(rTop, rBot, coneH, 40, 1, true);
    cone.translate(0, glowY - coneH / 2, 0);
    const cp = cone.getAttribute('position');
    const cn = cone.getAttribute('normal');
    for (let i = 0; i < cp.count; i++) {
      b.vert(cp.getX(i), cp.getY(i), cp.getZ(i), 0, 0, 0, 0, cn.getX(i), cn.getY(i), cn.getZ(i));
    }
    const ci = cone.getIndex();
    if (ci) for (let i = 0; i < ci.count; i += 3) b.tri(ci.getX(i), ci.getX(i + 1), ci.getX(i + 2));
    cone.dispose();
    const quad = (kind: number): void => {
      const v0 = b.vert(0, 0, 0, -1, -1, kind, 0);
      const v1 = b.vert(0, 0, 0, 1, -1, kind, 0);
      const v2 = b.vert(0, 0, 0, 1, 1, kind, 0);
      const v3 = b.vert(0, 0, 0, -1, 1, kind, 0);
      b.quad(v0, v1, v2, v3);
    };
    quad(1);
    quad(2);

    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      uniforms: {
        uGlowY: { value: glowY },
        uConeH: { value: coneH },
        uHaloR: { value: wide * 0.85 + 0.1 },
        uCoreR: { value: wide * 0.3 + 0.03 },
        uPull: { value: wide * 0.6 },
        uFade: { value: 0 },
        uBreath: { value: 1 },
      },
    });
    this.mesh = new Mesh(b.build(), this.mat);
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.object.name = 'domovoi-lamp-glow';
  }

  protected apply(f: number, _dt: number, t: number): void {
    const u = this.mat.uniforms;
    // warm-up reads like a filament: brightness lags slightly behind the fade
    u.uFade.value = smoothstep01(f) * (0.85 + 0.15 * f);
    if (t >= 0) u.uBreath.value = 1 + 0.015 * Math.sin(t * 1.3) + 0.008 * Math.sin(t * 3.1);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
