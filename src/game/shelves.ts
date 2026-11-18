import { BoxGeometry, DepthOccludable, type Entity, Group, Mesh, MeshStandardMaterial, type World } from '@iwsdk/core';
import type { Top } from '../core/placement.js';

const THICK = 0.022;
const wood = new MeshStandardMaterial({ color: 0x7a5034, roughness: 0.78, metalness: 0 });
// A faint ember-coloured edge underneath: these shelves are the spirit's, not yours.
const ember = new MeshStandardMaterial({ color: 0x2a1a10, emissive: 0xffb35c, emissiveIntensity: 0.35, roughness: 1 });

/**
 * When the room has too little furniture (or no scan at all), the spirit hangs its own small
 * shelves around the seat. Each is a thin wooden plank under one synthetic top, so its things
 * stand on something instead of floating.
 */
export function hangSpiritShelves(world: World, tops: readonly Top[]): Entity[] {
  return tops
    .filter((t) => t.synthetic)
    .map((t) => {
      const w = t.halfU * 2 + 0.06;
      const d = t.halfV * 2 + 0.04;
      const g = new Group();
      const plank = new Mesh(new BoxGeometry(w, THICK, d), wood);
      plank.position.y = -THICK / 2;
      const edge = new Mesh(new BoxGeometry(w * 0.92, 0.004, d * 0.85), ember);
      edge.position.y = -THICK - 0.002;
      g.add(plank, edge);
      g.position.set(t.center.x, t.center.y, t.center.z);
      // local x along the top's long axis u
      g.rotation.y = Math.atan2(-t.u.z, t.u.x);
      const entity = world.createTransformEntity(g);
      entity.addComponent(DepthOccludable);
      return entity;
    });
}
