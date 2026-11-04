// Undergrowth from scanned plants: bushes round the trees and along the forest edges, ferns under the trees and fallen
// branches on the forest floor. They are only drawn near you (each kind's instances are refilled from a fixed list as
// you move, and dithered out toward the edge of its reach), never collide and cast no shadow: dressing, not cover. They
// come from a seeded generator of their own, so every machine sees the same bushes and the world's layout is untouched.
import type { Assets, AssetKey } from '../assets.ts';
import { mulberry32 } from '../noise.ts';
import { forEachNear } from '../physics.ts';
import { CELL, T_HALF, T_RES, heightAt, normalAt } from '../terrain.ts';
import { ARENA, K_BOX, type World } from '../world.ts';
import { DOUBLE, patch, type Shared, type T, type Three } from './common.ts';
import { bakeModel } from './models.ts';

/** A kind: its model, how far off it is drawn, its size range, and how many may show at once. */
type Kind = { key: AssetKey; range: number; scale: [number, number]; max: number; lean: boolean };

const KINDS: Record<string, Kind> = {
  shrub: { key: 'shrub', range: 110, scale: [0.6, 0.85], max: 200, lean: false },
  shrub2: { key: 'shrub2', range: 110, scale: [0.55, 0.8], max: 200, lean: false },
  fern: { key: 'fern', range: 50, scale: [0.9, 1.4], max: 320, lean: true },
  branches: { key: 'branches', range: 45, scale: [0.8, 1.3], max: 70, lean: true },
};

const BRUSH_VERT = /* glsl */ `
attribute float aSway;
uniform float uTime;
uniform vec2 uWind;
`;
const BRUSH_SWAY = /* glsl */ `
{
  float ph = 0.0;
  #ifdef USE_INSTANCING
  ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
  #endif
  float s = sin(uTime * 1.6 + ph) * 0.09 + sin(uTime * 3.1 + ph * 1.7) * 0.04;
  transformed.xz += uWind * s * aSway;
  transformed.y += sin(uTime * 4.0 + position.x * 5.0 + position.z * 4.0 + ph) * 0.012 * aSway;
}
`;

/** `shown()` is how many plants are drawn now. */
export type Brush = { group: T.Group; near(x: number, z: number): void; shown(): number; dispose(): void };

export function brush(THREE: Three, w: World, shared: Shared, assets: Assets, density: number): Brush {
  const group = new THREE.Group();
  const made: { dispose(): void }[] = [];
  const def = w.def;
  const list: Record<string, number[]> = {};
  const want = (name: string) => {
    if (def.id === 'mesa') return name === 'shrub' || name === 'shrub2' || name === 'branches';
    if (def.id === 'frost') return name !== 'fern';
    return true;
  };
  if (density <= 0) return { group, near() {}, shown: () => 0, dispose() {} };
  const r = mulberry32(def.seed * 7 + 4099);
  const t = w.terrain;
  const nrm = { x: 0, y: 1, z: 0 };
  const lim = Math.min(T_HALF - 10, Math.max(ARENA + 70, w.arena + 30));
  // free ground: not under water, not steep, not bare (roads and yards), and clear of buildings and cover
  const free = (x: number, z: number, room: number) => {
    if (Math.abs(x) > T_HALF - 4 || Math.abs(z) > T_HALF - 4) return false;
    const y = heightAt(t, x, z);
    if (t.hasWater && y < t.water + 0.5) return false;
    if (normalAt(t, x, z, nrm).y < 0.88) return false;
    const i = Math.round((x + T_HALF) / CELL);
    const j = Math.round((z + T_HALF) / CELL);
    if (w.light[(j * T_RES + i) * 4 + 3] > 70) return false;
    let hit = false;
    forEachNear(w, x - room, z - room, x + room, z + room, (kind, k) => {
      if (hit || kind !== K_BOX) return;
      const b = w.boxes[k];
      if (x > b.x0 - room && x < b.x1 + room && z > b.z0 - room && z < b.z1 + room) hit = true;
    });
    return !hit;
  };
  const put = (name: string, x: number, z: number) => {
    const k = KINDS[name];
    const room = name === 'fern' ? 0.6 : 1.4;
    if (!want(name) || !free(x, z, room)) return;
    // nothing a person could crouch in on the sites or in the spawns
    if (name.startsWith('shrub') && [...w.sites, ...w.spawns].some((p) => Math.hypot(p.x - x, p.z - z) < 16)) return;
    const s = k.scale[0] + r() * (k.scale[1] - k.scale[0]);
    // low, wide things lie along the slope; bushes grow straight up (sunk a little so no edge hangs in the air)
    const tilt = k.lean ? nrm : { x: 0, y: 1, z: 0 };
    const sink = k.lean ? 0.04 : 0.1 + (1 - nrm.y) * 2.5;
    (list[name] ??= []).push(x, heightAt(t, x, z) - sink, z, r() * Math.PI * 2, s, tilt.x, tilt.y, tilt.z);
  };
  // round the trees in and near the arena: a bush or two at the foot, ferns and fallen branches in the shade
  for (const tr of w.trees) {
    if (Math.abs(tr.x) > lim || Math.abs(tr.z) > lim || tr.kind === 'cactus' || tr.kind === 'palm') continue;
    const a = r() * Math.PI * 2;
    const d = 2.2 + r() * 2.8;
    if (r() < 0.45 * density) put(r() < 0.5 ? 'shrub' : 'shrub2', tr.x + Math.cos(a) * d, tr.z + Math.sin(a) * d);
    if (r() < 0.7 * density) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const b = r() * Math.PI * 2;
        const e = 1.2 + r() * 4;
        put('fern', tr.x + Math.cos(b) * e, tr.z + Math.sin(b) * e);
      }
    }
    if (r() < 0.22 * density) {
      const b = r() * Math.PI * 2;
      put('branches', tr.x + Math.cos(b) * (2 + r() * 3), tr.z + Math.sin(b) * (2 + r() * 3));
    }
  }
  // a scatter of lone bushes over the open ground (as many per square meter on the big royale island)
  const lone = Math.round(240 * density * (def.id === 'mesa' ? 0.6 : 1) * ((lim * lim) / ((ARENA + 70) * (ARENA + 70))));
  for (let k = 0; k < lone; k++) put(r() < 0.5 ? 'shrub' : 'shrub2', (r() * 2 - 1) * lim, (r() * 2 - 1) * lim);

  const tint = def.id === 'mesa' ? [0.95, 0.8, 0.5] : def.id === 'frost' ? [0.7, 0.78, 0.72] : def.id === 'isles' ? [0.95, 1.08, 0.8] : [0.95, 1, 0.9];
  const kinds: { mesh: T.InstancedMesh; src: number[]; range: number }[] = [];
  for (const [name, src] of Object.entries(list)) {
    const k = KINDS[name];
    const root = assets[k.key];
    if (!root || !src.length) continue;
    const model = bakeModel(THREE, root);
    const h = Math.max(0.05, model.max.y - model.min.y);
    for (const part of model.parts) {
      const geo = part.geo;
      const p = geo.attributes.position as T.BufferAttribute;
      const sway = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) sway[i] = Math.min(1, Math.max(0, p.getY(i) / h)) * (k.lean ? 0.6 : 1);
      geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
      const mat = part.mat.clone();
      mat.side = DOUBLE;
      mat.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]));
      // dithered out over the last fifth of the reach, snow on what faces up in the frost
      patch(mat, shared, {
        key: `dz-brush-${mat.alphaTest > 0 ? 'cut' : 'solid'}`,
        vertDecl: BRUSH_VERT,
        vertBody: BRUSH_SWAY,
        uniforms: { uRange: { value: k.range } },
        fragDecl: 'uniform float uRange;\nuniform float uSnowCover;',
        replace: [
          [
            '#include <alphatest_fragment>',
            `#include <alphatest_fragment>
            {
              float dzFade = 1.0 - smoothstep(uRange * 0.78, uRange, length(vDzWp.xz - cameraPosition.xz));
              if (dzHash(floor(gl_FragCoord.xy)) > dzFade) discard;
              vec3 dzWN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uSnowCover * smoothstep(0.3, 0.85, abs(dzWN.y)) * 0.75);
            }`,
          ],
        ],
        light: `{
          vec3 dzV = normalize(vDzWp - cameraPosition);
          float dzTr = pow(max(dot(dzV, uSunDir), 0.0), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * dzTr * 0.18 * dzBaked(vDzWp.xz).r;
        }`,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, k.max);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      kinds.push({ mesh, src, range: k.range });
      made.push(geo, mat);
    }
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const slope = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let lastX = Infinity;
  let lastZ = Infinity;
  return {
    group,
    near(x, z) {
      if (Math.hypot(x - lastX, z - lastZ) < 6) return;
      lastX = x;
      lastZ = z;
      for (const k of kinds) {
        const src = k.src;
        const max = k.mesh.instanceMatrix.count;
        const outer = (k.range + 6) * (k.range + 6);
        const inner = outer * 0.25;
        let n = 0;
        // the nearer half of the reach first, so a thick wood fills from you outward when there are too many
        for (let pass = 0; pass < 2; pass++)
          for (let i = 0; i < src.length && n < max; i += 8) {
            const dx = src[i] - x;
            const dz = src[i + 2] - z;
            const d2 = dx * dx + dz * dz;
            if (pass === 0 ? d2 > inner : d2 <= inner || d2 > outer) continue;
            q.setFromUnitVectors(up, slope.set(src[i + 5], src[i + 6], src[i + 7])).multiply(spin.setFromAxisAngle(up, src[i + 3]));
            pos.set(src[i], src[i + 1], src[i + 2]);
            scl.setScalar(src[i + 4]);
            k.mesh.setMatrixAt(n++, m4.compose(pos, q, scl));
          }
        k.mesh.count = n;
        k.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    shown: () => kinds.reduce((n, k) => n + k.mesh.count, 0),
    dispose() {
      for (const d of made) d.dispose();
    },
  };
}
