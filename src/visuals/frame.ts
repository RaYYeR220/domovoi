/** Mitred wooden frame geometry + wood shading, shared by Board and ArtTwin. */

import type { GeoBuilder } from './common.js';

/**
 * Appends a mitred rectangular frame to `b` (extraSize 3 = normal).
 * Inner opening half-size (iw, ih), bar width fw. Faces: front at zFront,
 * inner lip down to zLip, outer side down to zBack.
 * aData = (along, across, kind, face) with face 0 front, 1 lip, 2 outer.
 */
export function addMitredFrame(
  b: GeoBuilder,
  iw: number,
  ih: number,
  fw: number,
  zFront: number,
  zLip: number,
  zBack: number,
  kind: number,
): void {
  const ow = iw + fw;
  const oh = ih + fw;
  const I = [
    [-iw, -ih],
    [iw, -ih],
    [iw, ih],
    [-iw, ih],
  ];
  const O = [
    [-ow, -oh],
    [ow, -oh],
    [ow, oh],
    [-ow, oh],
  ];
  const N = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const lipDepth = zFront - zLip;
  const outDepth = zFront - zBack;
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    const horiz = k % 2 === 0;
    const al = (p: number[]): number => (horiz ? p[0] : p[1]);
    const nx = N[k][0];
    const ny = N[k][1];
    // front
    const f0 = b.vert(O[k][0], O[k][1], zFront, al(O[k]), fw, kind, 0, 0, 0, 1);
    const f1 = b.vert(O[k1][0], O[k1][1], zFront, al(O[k1]), fw, kind, 0, 0, 0, 1);
    const f2 = b.vert(I[k1][0], I[k1][1], zFront, al(I[k1]), 0, kind, 0, 0, 0, 1);
    const f3 = b.vert(I[k][0], I[k][1], zFront, al(I[k]), 0, kind, 0, 0, 0, 1);
    b.quad(f0, f1, f2, f3);
    // inner lip (faces inward)
    const l0 = b.vert(I[k][0], I[k][1], zFront, al(I[k]), 0, kind, 1, -nx, -ny, 0);
    const l1 = b.vert(I[k1][0], I[k1][1], zFront, al(I[k1]), 0, kind, 1, -nx, -ny, 0);
    const l2 = b.vert(I[k1][0], I[k1][1], zLip, al(I[k1]), lipDepth, kind, 1, -nx, -ny, 0);
    const l3 = b.vert(I[k][0], I[k][1], zLip, al(I[k]), lipDepth, kind, 1, -nx, -ny, 0);
    b.quad(l0, l1, l2, l3);
    // outer side (faces outward)
    const o0 = b.vert(O[k1][0], O[k1][1], zFront, al(O[k1]), 0, kind, 2, nx, ny, 0);
    const o1 = b.vert(O[k][0], O[k][1], zFront, al(O[k]), 0, kind, 2, nx, ny, 0);
    const o2 = b.vert(O[k][0], O[k][1], zBack, al(O[k]), outDepth, kind, 2, nx, ny, 0);
    const o3 = b.vert(O[k1][0], O[k1][1], zBack, al(O[k1]), outDepth, kind, 2, nx, ny, 0);
    b.quad(o0, o1, o2, o3);
  }
}

/**
 * Wood: longitudinal streaks + faint growth lines, lit by a fixed soft key
 * light from upper-left-front (the visuals are unlit on purpose so they look
 * the same in any room).
 * g = (along, across) metres, n = object-space normal, face = 0/1/2.
 */
export const GLSL_WOOD = /* glsl */ `
vec3 woodShade(vec2 g, vec3 n, float face, vec3 base, float fw) {
  float streak = vnoise(vec2(g.x * 7.0, g.y * 380.0)) * 0.6 + vnoise(vec2(g.x * 26.0, g.y * 1400.0)) * 0.4;
  float rings = sin(g.y * 700.0 + vnoise(vec2(g.x * 3.0, g.y * 40.0)) * 7.0) * 0.5 + 0.5;
  vec3 c = base * (0.8 + 0.32 * streak) * (0.93 + 0.07 * rings);
  vec3 L = normalize(vec3(-0.3, 0.72, 0.62));
  float lit = 0.42 + 0.62 * max(dot(n, L), 0.0);
  c *= lit;
  if (face < 0.5) {
    // fine highlight on the inner front arris, soft darkening toward the outer edge
    float edgeIn = 1.0 - smoothstep(0.0, 0.0008, g.y);
    c += vec3(0.07, 0.055, 0.04) * edgeIn;
    c *= 1.0 - 0.12 * smoothstep(fw * 0.6, fw, g.y);
  }
  return c;
}
`;
