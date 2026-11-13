/**
 * Reads the player's real room from WebXR scene understanding (planes and
 * labelled meshes) into the engine-free structures the game core uses.
 */

import {
  type Entity,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  XRMesh,
  XRPlane,
} from '@iwsdk/core';
import type { RealLabel } from '../core/anomalies.js';
import type { Obb } from '../core/attention.js';
import { type Furniture, type Top, topOf } from '../core/placement.js';
import type { V3 } from '../core/vec.js';

export type RoomLabel = Furniture['label'];

/** Quest reports labels with spaces, hyphens or synonyms; fold them. */
export function normalizeLabel(raw: string | undefined | null): RoomLabel {
  const l = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (l) {
    case 'desk':
    case 'table':
      return 'table';
    case 'couch':
    case 'sofa':
      return 'couch';
    case 'window':
    case 'window_frame':
      return 'window_frame';
    case 'door':
    case 'door_frame':
      return 'door_frame';
    case 'wall_art':
    case 'picture':
      return 'wall_art';
    case 'lamp':
    case 'screen':
    case 'plant':
    case 'shelf':
    case 'storage':
    case 'bed':
      return l;
    case 'floor':
    case 'ceiling':
      return l;
    case 'wall':
    case 'wall_face':
    case 'invisible_wall_face':
      return 'wall';
    case 'other':
      return 'other';
    default:
      return 'unknown';
  }
}

/** A flat rectangle on the room (walls, wall art, windows, doors, floor). */
export interface Panel {
  id: string;
  label: RoomLabel;
  center: V3;
  /** Unit normal facing into the room / toward the player. */
  normal: V3;
  /** Unit axes across the panel (right, up for vertical panels). */
  right: V3;
  up: V3;
  halfW: number;
  halfH: number;
  vertical: boolean;
}

/** Something real the spirit can play with (lamp, screen, window…). */
export interface RealThing {
  id: string;
  label: RealLabel;
  center: V3;
  /** Bounding size, metres. */
  size: V3;
  obb?: Obb;
  panel?: Panel;
}

export interface RoomModel {
  furniture: Furniture[];
  tops: Top[];
  panels: Panel[];
  reals: RealThing[];
  occluders: Obb[];
  floorY: number;
  /** The unlabelled whole-room mesh, if the device provides one. */
  globalMesh: Mesh | null;
  planeCount: number;
  meshCount: number;
}

const m4 = new Matrix4();
const pos = new Vector3();
const quat = new Quaternion();
const scl = new Vector3();
const tmp = new Vector3();

const toV = (v: Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });

function meshToFurniture(entity: Entity, index: number): { furniture?: Furniture; global?: Mesh } {
  const obj = entity.object3D;
  if (!obj) return {};
  const bounded = entity.getValue(XRMesh, 'isBounded3D') as boolean;
  if (!bounded) return { global: obj instanceof Mesh ? obj : undefined };
  const label = normalizeLabel(entity.getValue(XRMesh, 'semanticLabel') as string);
  const min = entity.getVectorView(XRMesh, 'min');
  const max = entity.getVectorView(XRMesh, 'max');
  obj.updateWorldMatrix(true, false);
  m4.copy(obj.matrixWorld);
  m4.decompose(pos, quat, scl);
  // Local box centre → world.
  tmp.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2).applyMatrix4(m4);
  const furniture: Furniture = {
    id: `mesh-${label}-${index}`,
    label,
    obb: {
      center: toV(tmp),
      halfExtents: {
        x: Math.abs((max[0] - min[0]) / 2),
        y: Math.abs((max[1] - min[1]) / 2),
        z: Math.abs((max[2] - min[2]) / 2),
      },
      orientation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    },
  };
  return { furniture };
}

interface XRPlaneLike {
  orientation?: string;
  semanticLabel?: string;
  polygon?: Array<{ x: number; y: number; z: number }>;
}

function planeToPanel(entity: Entity, index: number, viewer: V3): Panel | null {
  const obj = entity.object3D;
  const plane = entity.getValue(XRPlane, '_plane') as XRPlaneLike | undefined;
  if (!obj || !plane?.polygon || plane.polygon.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of plane.polygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  obj.updateWorldMatrix(true, false);
  m4.copy(obj.matrixWorld);
  m4.decompose(pos, quat, scl);
  const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyMatrix4(m4);
  const normal = new Vector3(0, 1, 0).applyQuaternion(quat).normalize();
  const ax = new Vector3(1, 0, 0).applyQuaternion(quat).normalize();
  const az = new Vector3(0, 0, 1).applyQuaternion(quat).normalize();
  // Face the panel toward the player.
  tmp.set(viewer.x, viewer.y, viewer.z).sub(center);
  if (normal.dot(tmp) < 0) normal.negate();
  const vertical = Math.abs(normal.y) < 0.5;
  let right: Vector3;
  let up: Vector3;
  let halfW: number;
  let halfH: number;
  if (vertical) {
    // Pick the in-plane axis closest to world up as "up".
    const azUp = Math.abs(az.y) >= Math.abs(ax.y);
    up = (azUp ? az : ax).clone();
    if (up.y < 0) up.negate();
    right = new Vector3().crossVectors(up, normal).normalize();
    halfW = (azUp ? maxX - minX : maxZ - minZ) / 2;
    halfH = (azUp ? maxZ - minZ : maxX - minX) / 2;
  } else {
    right = ax;
    up = az;
    halfW = (maxX - minX) / 2;
    halfH = (maxZ - minZ) / 2;
  }
  const label = normalizeLabel(plane.semanticLabel ?? (vertical ? 'wall' : 'floor'));
  return {
    id: `plane-${label}-${index}`,
    label,
    center: toV(center),
    normal: toV(normal),
    right: toV(right),
    up: toV(up),
    halfW,
    halfH,
    vertical,
  };
}

const REAL_FROM_MESH: RealLabel[] = ['lamp', 'screen', 'plant', 'shelf', 'storage', 'table', 'couch', 'bed'];
const REAL_FROM_PANEL: RealLabel[] = ['wall_art', 'window_frame', 'door_frame', 'screen'];

export function buildRoom(meshes: Iterable<Entity>, planes: Iterable<Entity>, viewer: V3): RoomModel {
  const furniture: Furniture[] = [];
  let globalMesh: Mesh | null = null;
  let meshCount = 0;
  let i = 0;
  for (const e of meshes) {
    meshCount++;
    const r = meshToFurniture(e, i++);
    if (r.furniture) furniture.push(r.furniture);
    if (r.global) globalMesh = r.global;
  }
  const panels: Panel[] = [];
  let planeCount = 0;
  i = 0;
  for (const e of planes) {
    planeCount++;
    const p = planeToPanel(e, i++, viewer);
    if (p) panels.push(p);
  }
  // Tables reported only as planes (no mesh) still make good tops.
  for (const p of panels) {
    if (!p.vertical && (p.label === 'table' || p.label === 'shelf' || p.label === 'storage')) {
      const dup = furniture.some(
        (f) => f.label === p.label && Math.hypot(f.obb.center.x - p.center.x, f.obb.center.z - p.center.z) < 0.3,
      );
      if (!dup) {
        furniture.push({
          id: `${p.id}-box`,
          label: p.label,
          obb: {
            center: { x: p.center.x, y: p.center.y - 0.01, z: p.center.z },
            halfExtents: { x: p.halfW, y: 0.01, z: p.halfH },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
        });
      }
    }
  }

  const floor = panels.find((p) => p.label === 'floor');
  const floorY = floor ? floor.center.y : 0;

  const tops = furniture
    .filter((f) => f.label !== 'lamp' && f.label !== 'plant' && f.label !== 'screen')
    .map(topOf)
    .filter((t): t is Top => t != null);

  const reals: RealThing[] = [];
  for (const f of furniture) {
    if (!REAL_FROM_MESH.includes(f.label as RealLabel)) continue;
    const h = f.obb.halfExtents;
    reals.push({
      id: f.id,
      label: f.label as RealLabel,
      center: f.obb.center,
      size: { x: h.x * 2, y: h.y * 2, z: h.z * 2 },
      obb: f.obb,
    });
  }
  for (const p of panels) {
    if (!p.vertical || !REAL_FROM_PANEL.includes(p.label as RealLabel)) continue;
    reals.push({
      id: p.id,
      label: p.label as RealLabel,
      center: p.center,
      size: { x: p.halfW * 2, y: p.halfH * 2, z: 0.02 },
      panel: p,
    });
  }

  // Big furniture hides things behind it; small things (lamps, plants) don't count.
  const occluders = furniture
    .filter((f) => ['couch', 'shelf', 'storage', 'bed', 'table', 'screen', 'other'].includes(f.label))
    .filter((f) => f.obb.halfExtents.x * f.obb.halfExtents.y * f.obb.halfExtents.z > 0.004)
    .map((f) => f.obb);

  return { furniture, tops, panels, reals, occluders, floorY, globalMesh, planeCount, meshCount };
}
