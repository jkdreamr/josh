// Real models in the renderer: a loaded glTF scene baked into plain float geometry in model space (one part per
// material, the file's node transforms and quantization folded in), drawn instanced with materials lit like the rest of
// the world.
import type { Assets, AssetKey } from '../assets.ts';
import type { ModelKey, World } from '../world.ts';
import { patch, type Shared, type T, type Three } from './common.ts';

export type Part = { geo: T.BufferGeometry; mat: T.MeshStandardMaterial };
export type Model = { parts: Part[]; min: T.Vector3; max: T.Vector3 };

/** A float copy of a (possibly quantized) attribute. */
function floatAttr(THREE: Three, a: T.BufferAttribute | T.InterleavedBufferAttribute) {
  const n = a.count;
  const k = a.itemSize;
  const out = new Float32Array(n * k);
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, k);
}

/** Bakes a scene into parts, optionally moved by a matrix (applied after the file's own transforms). */
export function bakeModel(THREE: Three, root: T.Object3D, matrix?: T.Matrix4): Model {
  root.updateMatrixWorld(true);
  const parts: Part[] = [];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) geo.setAttribute(name, name === 'position' || name === 'normal' ? floatAttr(THREE, a) : a);
    if (src.index) geo.setIndex(src.index);
    m.copy(mesh.matrixWorld);
    if (matrix) m.premultiply(matrix);
    geo.applyMatrix4(m);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    min.min(geo.boundingBox!.min);
    max.max(geo.boundingBox!.max);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    parts.push({ geo, mat: mats[0] as T.MeshStandardMaterial });
  });
  return { parts, min, max };
}

/** The baked model for an asset key, or null when it didn't load. */
export function modelOf(THREE: Three, assets: Assets, key: AssetKey, matrix?: T.Matrix4): Model | null {
  const root = assets[key];
  return root ? bakeModel(THREE, root, matrix) : null;
}

/** A material copy lit like the world (baked sun shadow, fog), sharing the file's textures. */
export function worldMaterial(THREE: Three, mat: T.MeshStandardMaterial, shared: Shared, tint?: [number, number, number]) {
  const m = mat.clone();
  if (tint) m.color.multiply(new THREE.Color(...tint));
  m.side = THREE.FrontSide;
  patch(m, shared, { key: 'dz-real' });
  return m;
}

/**
 * Instanced copies of a model at the given transforms: one draw call per part. Returns the group and a disposer for
 * what it created (the loaded textures stay, they belong to the shared assets).
 */
export function instanced(THREE: Three, model: Model, at: T.Matrix4[], shared: Shared, shadows: boolean) {
  const group = new THREE.Group();
  const made: { geo: T.BufferGeometry; mat: T.Material }[] = [];
  if (!at.length) return { group, dispose() {} };
  for (const p of model.parts) {
    const mat = worldMaterial(THREE, p.mat, shared);
    const mesh = new THREE.InstancedMesh(p.geo, mat, at.length);
    at.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
    made.push({ geo: p.geo, mat });
  }
  return {
    group,
    dispose() {
      for (const x of made) {
        x.geo.dispose();
        x.mat.dispose();
      }
    },
  };
}

/** Small things that never cast a shadow (they'd cost a shadow pass draw each for a few pixels). */
const SMALL: ModelKey[] = ['jerry', 'gas', 'propane', 'helmet', 'shield', 'cup', 'pan'];

/** Every model the world placed (cover and clutter), instanced per kind. */
export function placedModels(THREE: Three, w: World, shared: Shared, shadows: boolean, assets: Assets) {
  const group = new THREE.Group();
  const byKey = new Map<ModelKey, T.Matrix4[]>();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const p of w.models) {
    let list = byKey.get(p.key);
    if (!list) byKey.set(p.key, (list = []));
    list.push(new THREE.Matrix4().makeRotationAxis(yAxis, p.yaw).setPosition(p.x, p.y, p.z));
  }
  for (const [key, at] of byKey) {
    const model = modelOf(THREE, assets, key);
    if (model) group.add(instanced(THREE, model, at, shared, shadows && !SMALL.includes(key)).group);
  }
  // cover whose model didn't load still shows where its collider is
  const missing = w.models.filter((p) => p.size && !assets[p.key]);
  if (missing.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.9 });
    patch(mat, shared, { key: 'dz-real-box' });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, missing.length);
    missing.forEach((p, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeRotationAxis(yAxis, p.yaw).scale(new THREE.Vector3(...p.size!)).setPosition(p.x, p.y, p.z)));
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
