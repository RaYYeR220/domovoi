/**
 * A second picture frame next to real wall art. width/height = outer frame
 * size. Local origin = centre on the wall plane, normal +Z; the frame stands
 * 2 cm off the wall. Thin dark mitred wood + a muted colour-field painting
 * (canvas weave, brush drag, feathered fields) chosen deterministically from
 * the size. Fades and settles in from 94% scale. One draw call.
 */

import { Group, Mesh, Vector2, Vector3 } from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { GLSL_NOISE, GLSL_SDF, GeoBuilder, easeOutCubic, hexToRGB, premulMaterial, smoothstep01 } from './common.js';
import { GLSL_WOOD, addMitredFrame } from './frame.js';
import { ToggleBase } from './toggle.js';

const PALETTES: number[][] = [
  [0xa89a86, 0xa5654c, 0x4b5566, 0xc49a55],
  [0xcdc2ae, 0x7f8f78, 0x6a5a66, 0xa0603e],
  [0x5e5b4e, 0xb08c4f, 0x6b7c8f, 0xd8ccb4],
  [0xbfb3a0, 0x5d6b7c, 0xa77d5e, 0x3f4a44],
];

const VERT = /* glsl */ `
attribute vec4 aData;
attribute vec3 aExtra;
varying vec4 vD;
varying vec3 vN;
void main() {
  vD = aData;
  vN = aExtra;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uFade;
uniform vec2 uHalf;
uniform float uFw;
uniform float uSeed;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uP3;
varying vec4 vD;
varying vec3 vN;
${GLSL_NOISE}
${GLSL_SDF}
${GLSL_WOOD}

float field(vec2 uv, vec2 c, vec2 h, float seed) {
  float rag = (vnoise(uv * vec2(7.0, 5.0) + seed) - 0.5) * 0.03 + (vnoise(uv * vec2(30.0, 60.0) + seed * 2.0) - 0.5) * 0.008;
  float sd = sdRoundBox(uv - c, h, 0.02) + rag;
  return 1.0 - smoothstep(-0.022, 0.02, sd);
}

void main() {
  vec3 c;
  if (vD.z < 0.5) {
    vec2 p = vD.xy;
    vec2 uv = p / (2.0 * uHalf) + 0.5;
    float asp = uHalf.x / uHalf.y;
    vec2 m = vec2(0.11, 0.11 * asp);
    c = uP0;
    c = mix(c, uP1, field(uv, vec2(0.5, 0.66), vec2(0.5 - m.x, 0.2), uSeed));
    c = mix(c, uP2, field(uv, vec2(0.5, 0.265), vec2(0.5 - m.x, 0.135), uSeed + 5.0));
    float band = field(uv, vec2(0.5, 0.448), vec2(0.5 - m.x - 0.04, 0.006), uSeed + 9.0);
    c = mix(c, uP3, band * 0.6);
    float drag = vnoise(vec2(p.x * 36.0, p.y * 240.0) + uSeed) * 0.6 + vnoise(vec2(p.x * 110.0, p.y * 640.0)) * 0.4;
    c *= 0.9 + 0.14 * drag;
    float weave = sin(p.x * 2400.0) * sin(p.y * 2400.0);
    c *= 0.985 + 0.02 * weave;
    vec2 e = uHalf - abs(p);
    float ein = min(e.x, e.y);
    float top = uHalf.y - p.y;
    c *= mix(0.55, 1.0, smoothstep(0.0, 0.008, ein));
    c *= mix(0.75, 1.0, smoothstep(0.0, 0.02, top));
    c *= 0.95 + 0.06 * uv.y;
  } else {
    c = woodShade(vD.xy, normalize(vN), vD.w, vec3(0.2, 0.14, 0.1), uFw);
  }
  gl_FragColor = vec4(c, 1.0) * uFade;
}
`;

export class ArtTwin extends ToggleBase {
  private readonly inner = new Group();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor(width: number, height: number) {
    super(0.75, 0.5);
    const w = Math.max(width, 0.08);
    const h = Math.max(height, 0.08);
    const fw = Math.min(Math.max(Math.min(w, h) * 0.055, 0.012), 0.03);
    const iw = w / 2 - fw;
    const ih = h / 2 - fw;
    const zPaint = 0.007;

    const b = new GeoBuilder(3);
    const v0 = b.vert(-iw, -ih, zPaint, -iw, -ih, 0, 0, 0, 0, 1);
    const v1 = b.vert(iw, -ih, zPaint, iw, -ih, 0, 0, 0, 0, 1);
    const v2 = b.vert(iw, ih, zPaint, iw, ih, 0, 0, 0, 0, 1);
    const v3 = b.vert(-iw, ih, zPaint, -iw, ih, 0, 0, 0, 0, 1);
    b.quad(v0, v1, v2, v3);
    addMitredFrame(b, iw, ih, fw, 0.02, zPaint, 0, 1);

    const sh = Math.abs(Math.sin(w * 127.1 + h * 311.7) * 43758.5453) % 1;
    const pal = PALETTES[Math.floor(sh * PALETTES.length) % PALETTES.length];
    const cols = pal.map((hex) => {
      const v = new Vector3();
      hexToRGB(hex, v);
      return v;
    });
    this.mat = premulMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthWrite: true,
      uniforms: {
        uFade: { value: 0 },
        uHalf: { value: new Vector2(iw, ih) },
        uFw: { value: fw },
        uSeed: { value: sh * 50 },
        uP0: { value: cols[0] },
        uP1: { value: cols[1] },
        uP2: { value: cols[2] },
        uP3: { value: cols[3] },
      },
    });
    this.mesh = new Mesh(b.build(), this.mat);
    this.inner.add(this.mesh);
    this.object.add(this.inner);
    this.object.name = 'domovoi-art-twin';
  }

  protected apply(f: number): void {
    const e = smoothstep01(f);
    this.mat.uniforms.uFade.value = e;
    this.inner.scale.setScalar(0.94 + 0.06 * easeOutCubic(f));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.object.removeFromParent();
  }
}
