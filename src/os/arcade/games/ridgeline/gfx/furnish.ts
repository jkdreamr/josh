// The real furniture and street props (Poly Haven, CC0): one file of models sharing one material, its color, normal and
// AO/rough/metal maps atlases of theirs. dress.ts puts them down while the buildings are built (where the file loaded:
// its boxes otherwise), and they are drawn as two batches of one draw call each, whatever the count: what stands in the
// buildings, darkened like the rooms and casting no shadow, and what stands outside, casting shadows. Only those near
// you are drawn, picked again as you move.
import type { Assets } from '../assets.ts';
import { bakeModel, floatAttr, worldMaterial, type Model } from './models.ts';
import type { Shared, T, Three } from './common.ts';

/** The models in props.glb, by node name. */
export const PROP_KEYS = ['bed', 'table', 'chair', 'sideboard', 'cabinet', 'shelf', 'rack', 'stove', 'sofa', 'bench', 'ubox', 'bins', 'cask', 'ladder', 'vice', 'nightstand', 'stool', 'cans', 'tin', 'bucket', 'wcan', 'rim'] as const;
export type PropKey = (typeof PROP_KEYS)[number];

/** Where the real props go as the buildings are built: which ones loaded, and each one put down. */
export type Props = {
  has(k: PropKey): boolean;
  /** One standing at (x, y, z), its front (+z) turned to yaw, then tipped by pitch (about its x) and roll (about its z);
   * inside a building or out in the open. */
  put(k: PropKey, x: number, y: number, z: number, yaw: number, inside: boolean, pitch?: number, roll?: number): void;
};

export type PropKit = Props & { models: Map<PropKey, Model>; puts: { k: PropKey; m: T.Matrix4; inside: boolean }[] };

/** The loaded props (none when the file didn't load), ready to be put down. */
export function propKit(THREE: Three, assets: Assets): PropKit {
  const models = new Map<PropKey, Model>();
  // (none without the batches to draw them in: the boxes stand in then)
  const root = THREE.BatchedMesh ? assets.props : undefined;
  if (root)
    for (const k of PROP_KEYS) {
      const node = root.getObjectByName(k);
      const model = node && bakeModel(THREE, node);
      if (model?.parts.length === 1) models.set(k, model);
    }
  const puts: PropKit['puts'] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    models,
    puts,
    has: (k) => models.has(k),
    put(k, x, y, z, yaw, inside, pitch = 0, roll = 0) {
      if (!models.has(k)) return;
      q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));
      puts.push({ k, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, one), inside });
    },
  };
}

/** How far out the props are drawn, inside and out, at each detail level (0 draws no furniture). */
const RANGE = [
  [0, 60],
  [32, 90],
  [48, 120],
];
/** The rooms' darkening (as the boxes inside get, see props.ts). */
const INSIDE = 0.6;

export type Furnished = { group: T.Group; near(x: number, z: number): void; shown(): number; dispose(): void };

/** The props put down, in their two batches. */
export function furnished(THREE: Three, kit: PropKit, shared: Shared, level: number, shadows: boolean): Furnished {
  const group = new THREE.Group();
  const first = kit.models.values().next().value;
  if (!kit.puts.length || !first) return { group, near() {}, shown: () => 0, dispose() {} };
  const mat = worldMaterial(THREE, first.parts[0].mat, shared);
  // (every geometry in float, with the same three attributes, as a batch wants)
  const geos = new Map<PropKey, T.BufferGeometry>();
  for (const [k, model] of kit.models) {
    const src = model.parts[0].geo;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = src.getAttribute(name);
      if (a) g.setAttribute(name, a.array instanceof Float32Array && !a.normalized && !(a as T.InterleavedBufferAttribute).isInterleavedBufferAttribute ? a : floatAttr(THREE, a));
    }
    g.setIndex(src.index);
    geos.set(k, g);
  }
  const batches: { mesh: T.BatchedMesh; at: Float32Array; range: number }[] = [];
  for (const inside of [true, false]) {
    const list = kit.puts.filter((p) => p.inside === inside);
    const range = RANGE[Math.min(2, level)][inside ? 0 : 1];
    if (!list.length || !range) continue;
    const used = [...new Set(list.map((p) => p.k))];
    let nv = 0;
    let ni = 0;
    for (const k of used) {
      const g = geos.get(k)!;
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : 0;
    }
    const mesh = new THREE.BatchedMesh(list.length, nv, ni, mat);
    const ids = new Map(used.map((k) => [k, mesh.addGeometry(geos.get(k)!)]));
    const dark = new THREE.Color(INSIDE, INSIDE, INSIDE);
    const at = new Float32Array(list.length * 2);
    list.forEach((p, i) => {
      const id = mesh.addInstance(ids.get(p.k)!);
      mesh.setMatrixAt(id, p.m);
      if (inside) mesh.setColorAt(id, dark);
      mesh.setVisibleAt(id, false);
      at[i * 2] = p.m.elements[12];
      at[i * 2 + 1] = p.m.elements[14];
    });
    mesh.castShadow = shadows && !inside;
    mesh.receiveShadow = true;
    group.add(mesh);
    batches.push({ mesh, at, range });
  }
  let lastX = Infinity;
  let lastZ = Infinity;
  let shown = 0;
  return {
    group,
    near(x, z) {
      if (Math.hypot(x - lastX, z - lastZ) < 4) return;
      lastX = x;
      lastZ = z;
      shown = 0;
      for (const b of batches) {
        const r2 = b.range * b.range;
        for (let i = 0; i < b.at.length / 2; i++) {
          const dx = b.at[i * 2] - x;
          const dz = b.at[i * 2 + 1] - z;
          const on = dx * dx + dz * dz < r2;
          b.mesh.setVisibleAt(i, on);
          if (on) shown++;
        }
      }
    },
    shown: () => shown,
    dispose() {
      for (const b of batches) b.mesh.dispose();
      for (const g of geos.values()) g.dispose();
      mat.dispose();
    },
  };
}
