// Real models in the renderer: a loaded glTF scene baked into plain float geometry in model space (one part per
// material, the file's node transforms and quantization folded in), drawn instanced with materials lit like the rest of
// the world.
import type { Assets, AssetKey } from '../assets.ts';
import { CRATE_COLOR, CRATE_SIZE, type ModelKey, type Piece, type World } from '../world.ts';
import { lin, patch, type Shared, type T, type Three } from './common.ts';

export type Part = { geo: T.BufferGeometry; mat: T.MeshStandardMaterial };
export type Model = { parts: Part[]; min: T.Vector3; max: T.Vector3 };

/** A float copy of a (possibly quantized) attribute. */
export function floatAttr(THREE: Three, a: T.BufferAttribute | T.InterleavedBufferAttribute) {
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
export function instanced(THREE: Three, model: Model, at: T.Matrix4[], shared: Shared, shadows: boolean, tints?: (T.Color | null)[]) {
  const group = new THREE.Group();
  const made: { geo: T.BufferGeometry; mat: T.Material }[] = [];
  if (!at.length) return { group, dispose() {} };
  const white = new THREE.Color(1, 1, 1);
  for (const p of model.parts) {
    const mat = worldMaterial(THREE, p.mat, shared);
    const mesh = new THREE.InstancedMesh(p.geo, mat, at.length);
    at.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    if (tints) tints.forEach((c, i) => mesh.setColorAt(i, c ?? white));
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
const SMALL: ModelKey[] = ['jerry', 'gas', 'propane', 'helmet', 'shield', 'cup', 'pan', 'tyre', 'toolbox', 'ammo-crate', 'stump', 'stump2', 'log'];

/** A box of the world's crates (cover, and the stacks inside barns). */
export const isCrate = (p: Piece) =>
  p.part === 'wood' && p.color === CRATE_COLOR && Math.abs(p.x1 - p.x0 - CRATE_SIZE) < 0.02 && Math.abs(p.z1 - p.z0 - CRATE_SIZE) < 0.02 && Math.abs(p.y1 - p.y0 - CRATE_SIZE) < 0.02;

/** Which crate pieces the real crate stacks draw instead of the buildings (none when neither stack loaded). */
export function crateSkip(assets: Assets): ((p: Piece) => boolean) | undefined {
  return assets['crate-wood'] || assets['crate-mil'] ? isCrate : undefined;
}

/** The barrel photo's mean color (the drums are painted over it). */
const BARREL = 0x45576c;

/** A stable hash of a point, 0 to 1, to vary the look of things placed there. */
const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Every model the world placed (cover and clutter), instanced per kind. */
export function placedModels(THREE: Three, w: World, shared: Shared, shadows: boolean, assets: Assets) {
  const group = new THREE.Group();
  const byKey = new Map<ModelKey, { at: T.Matrix4[]; tint: (T.Color | null)[]; lie: boolean[] }>();
  const yAxis = new THREE.Vector3(0, 1, 0);
  let tinted = false;
  for (const p of w.models) {
    let list = byKey.get(p.key);
    if (!list) byKey.set(p.key, (list = { at: [], tint: [], lie: [] }));
    list.at.push(new THREE.Matrix4().makeRotationAxis(yAxis, p.yaw).setPosition(p.x, p.y, p.z));
    // (a painted drum: its paint over the model's own blue as the ratio of the two, so the photo's wear still shows)
    const [r, g, b] = lin(p.tint ?? 0);
    const [br, bg, bb] = lin(BARREL);
    list.tint.push(p.tint === undefined ? null : new THREE.Color((r / br) * 1.3, (g / bg) * 1.3, (b / bb) * 1.3));
    list.lie.push(!!p.lie);
    if (p.tint !== undefined) tinted = true;
  }
  for (const [key, list] of byKey) {
    const model = modelOf(THREE, assets, key);
    if (!model) continue;
    // one lying on its side turns about its own across axis, its middle at its radius over the ground
    list.lie.forEach((lie, i) => {
      if (!lie) return;
      const r = Math.max(model.max.x, model.max.z);
      const h = model.max.y - model.min.y;
      const m = list.at[i];
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const yaw = new THREE.Matrix4().extractRotation(m);
      m.copy(new THREE.Matrix4().makeTranslation(p.x, p.y + r, p.z).multiply(yaw).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, -model.min.y - h / 2, 0)));
    });
    group.add(instanced(THREE, model, list.at, shared, shadows && !SMALL.includes(key), tinted && list.tint.some((c) => c) ? list.tint : undefined).group);
  }
  // each crate box is a stack of real crates, long wooden ones or closed ammo crates, turned a random quarter
  const stacks = (['crate-wood', 'crate-mil'] as const).filter((k) => assets[k]);
  if (stacks.length) {
    const at: T.Matrix4[][] = stacks.map(() => []);
    for (const p of w.pieces) {
      if (!isCrate(p)) continue;
      const x = (p.x0 + p.x1) / 2;
      const z = (p.z0 + p.z1) / 2;
      const h = hash(x, z);
      at[Math.floor(h * stacks.length) % stacks.length].push(new THREE.Matrix4().makeRotationAxis(yAxis, Math.floor(h * 97) * (Math.PI / 2)).setPosition(x, p.y0, z));
    }
    stacks.forEach((k, i) => {
      const model = modelOf(THREE, assets, k);
      if (model) group.add(instanced(THREE, model, at[i], shared, shadows).group);
    });
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
