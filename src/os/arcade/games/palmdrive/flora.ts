// The trees of the road courses, each kind one instanced mesh of many parts (its colors in the vertex colors, a tint per
// tree), swaying a little in the breeze: valley and coast live oaks, Canary Island date palms like those down Palm
// Drive, blue gums in their windbreaks, and shrubs.
import type { T } from './gl';
import { canvas, scatter, texture } from './scenery';

type Three = typeof import('three');
type RGB = [number, number, number];

/** Merges parts into one geometry with vertex colors: a part's own `color`, or the colors its geometry carries. */
function merge(THREE: Three, parts: { g: T.BufferGeometry; m: T.Matrix4; color?: RGB }[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const part of parts) {
    const g = part.g.index ? part.g.toNonIndexed() : part.g;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const c = g.getAttribute('color');
    nm.copy(part.m).invert().transpose();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).applyMatrix4(part.m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, k).transformDirection(nm);
      nrm.push(v.x, v.y, v.z);
      if (part.color) col.push(...part.color);
      else if (c) col.push(c.getX(k), c.getY(k), c.getZ(k));
      else col.push(1, 1, 1);
    }
    if (g !== part.g) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const rgb = (THREE: Three, hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** A lump of foliage: an icosphere pushed in and out, darker underneath and on its shaded side, a little ragged. */
function lump(THREE: Three, seed: number, light: RGB, dark: RGB) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  const r = scatter(seed);
  const bumps = Array.from({ length: 5 }, () => [r() * 6, r() * 6, r() * 6, 0.1 + r() * 0.12]);
  const col: number[] = [];
  const nrm: number[] = [];
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    // (soft: lit as the round lump it nearly is, not facet by facet)
    const l = Math.hypot(x, y + 0.25, z);
    nrm.push(x / l, (y + 0.25) / l, z / l);
    let f = 1;
    for (const [a, b, c, amp] of bumps) f += amp * Math.sin(x * a + y * b + z * c);
    // (flattened underneath, as a canopy is)
    p.setXYZ(k, x * f, y * f * (y < 0 ? 0.7 : 1), z * f);
    const u = Math.min(1, Math.max(0, y * 0.5 + 0.5));
    const sh = 0.55 + 0.45 * u;
    col.push(dark[0] + (light[0] - dark[0]) * sh, dark[1] + (light[1] - dark[1]) * sh, dark[2] + (light[2] - dark[2]) * sh);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** A tapered limb from a to b, rough barked. */
function limb(THREE: Three, a: [number, number, number], b: [number, number, number], r0: number, r1: number, color: RGB) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  m.compose(new THREE.Vector3(a[0] + dx / 2, a[1] + dy / 2, a[2] + dz / 2), q, new THREE.Vector3(1, 1, 1));
  return { g, m, color };
}

const at = (THREE: Three, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

/** The breeze: foliage (vertex y above `from`) sways, more the higher it is; the sway's clock is shared by every tree. */
const breeze = { value: 0 };
function swaying(THREE: Three, key: string, from: number, amount: number) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBreeze = breeze;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBreeze;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       vec3 tp = instanceMatrix[3].xyz;
       #else
       vec3 tp = vec3(0.0);
       #endif
       float tph = tp.x * 0.13 + tp.z * 0.11;
       float lift = max(0.0, position.y - ${from.toFixed(2)});
       transformed.x += sin(uBreeze * 1.1 + tph) * ${amount.toFixed(3)} * lift;
       transformed.z += cos(uBreeze * 0.9 + tph * 1.3) * ${(amount * 0.6).toFixed(3)} * lift;`,
    );
  };
  mat.customProgramCacheKey = () => `pd-flora-${key}`;
  return mat;
}

/** Sets the breeze's clock (once a frame). */
export function floraTick(clock: number) {
  breeze.value = clock;
}

type Spot = { x: number; z: number; r: number };

/**
 * Instanced meshes of `geo`, one instance per spot (sized, turned and tinted a little each), in patches 120 m across so
 * those off screen (and out of the sun's shadow box) are not drawn.
 */
function plant(THREE: Three, scene: T.Scene, dummy: T.Object3D, geo: T.BufferGeometry, mat: T.Material, spots: { x: number; y?: number; z: number; s: number; sy?: number }[], seed: number) {
  if (!spots.length) return;
  const r = scatter(seed);
  const tint = new THREE.Color();
  const PATCH = 200;
  const cells = new Map<string, typeof spots>();
  for (const p of spots) {
    const key = `${Math.floor(p.x / PATCH)},${Math.floor(p.z / PATCH)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(p);
  }
  for (const list of cells.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y ?? 0, p.z);
      dummy.rotation.set(0, r() * Math.PI * 2, 0);
      dummy.scale.set(p.s, p.sy ?? p.s, p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const k = 0.85 + r() * 0.3;
      mesh.setColorAt(i, tint.setRGB(k * (0.94 + r() * 0.12), k, k * (0.9 + r() * 0.15)));
    });
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(1);
}

/**
 * Oaks: a short stout trunk forking into a few limbs under a broad, lumpy, rounded crown; two shapes, so a grove is not
 * all the same tree. Each spot's r is the crown's radius (as the old round oaks were sized).
 */
export function oakTrees(THREE: Three, scene: T.Scene, dummy: T.Object3D, spots: Spot[], palette: { light: number; dark: number } = { light: 0x6d9a45, dark: 0x22381a }) {
  const bark = rgb(THREE, 0x4e3c2c);
  const light = rgb(THREE, palette.light);
  const dark = rgb(THREE, palette.dark);
  const kinds = [0, 1].map((v) => {
    const r = scatter(41 + v * 17);
    // (a unit tree: its crown about 1 across at about 1.5 up)
    const parts: { g: T.BufferGeometry; m: T.Matrix4; color?: RGB }[] = [];
    parts.push(limb(THREE, [0, -0.1, 0], [0.04, 0.7, 0], 0.2, 0.14, bark));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + v;
      parts.push(limb(THREE, [0.04, 0.6, 0], [Math.cos(a) * 0.5, 1.15 + r() * 0.2, Math.sin(a) * 0.5], 0.1, 0.05, bark));
    }
    // (a full crown: a big lump in the middle, a ring round it, a few on top)
    const lumps = v ? 8 : 7;
    for (let k = 0; k < lumps; k++) {
      const a = (k / lumps) * Math.PI * 2 + r();
      const top = k >= lumps - 2;
      const d = k === 0 ? 0 : top ? 0.2 + r() * 0.2 : 0.55 + r() * 0.2;
      const s = k === 0 ? 0.85 : top ? 0.55 + r() * 0.15 : 0.5 + r() * 0.2;
      const g = lump(THREE, 100 + v * 10 + k, light, dark);
      parts.push({ g, m: at(THREE, Math.cos(a) * d, k === 0 ? 1.5 : top ? 1.95 + r() * 0.2 : 1.35 + r() * 0.3, Math.sin(a) * d, s * 1.1, s * 0.95, s * 1.1) });
    }
    const out = merge(THREE, parts);
    for (const p of parts) p.g.dispose();
    return out;
  });
  const mat = swaying(THREE, 'oak', 1.0, 0.025);
  kinds.forEach((g, v) => plant(THREE, scene, dummy, g, mat, spots.filter((_, i) => i % 2 === v).map((o) => ({ x: o.x, z: o.z, s: o.r })), 7 + v));
}

/**
 * Canary Island date palms: a stout trunk patterned with old leaf bases, a pineapple of them under the crown, and a
 * great round crown of arching fronds, each a midrib with its leaflets in a V along it, the old ones hanging down
 * brown. A palm's height is its trunk's.
 */
export function palmTrees(THREE: Three, scene: T.Scene, dummy: T.Object3D, palms: { x: number; z: number; hgt: number }[]) {
  if (!palms.length) return;
  // the trunk: a unit-high column (scaled to each palm's height), its leaf scars in bands
  const trunk = (() => {
    const g = new THREE.CylinderGeometry(0.4, 0.5, 1, 9, 10, false);
    g.translate(0, 0.5, 0);
    const p = g.getAttribute('position');
    const col: number[] = [];
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      // (thicker under the crown, where the old leaf bases pile up, and a little swollen at the foot)
      const knob = y > 0.88 ? 1 + (y - 0.88) * 3.5 : y < 0.1 ? 1 + (0.1 - y) * 1.5 : 1;
      p.setX(k, p.getX(k) * knob);
      p.setZ(k, p.getZ(k) * knob);
      const c = y > 0.88 ? 0.8 : 1;
      col.push(c, c * 0.96, c * 0.9);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  })();
  // the crown: arching fronds round it, the lower tiers drooping further, a few dead ones hanging
  const crown = (() => {
    const pos: number[] = [];
    const col: number[] = [];
    const r = scatter(61);
    const frond = (a: number, rise: number, len: number, droop: number, green: RGB, tip: RGB) => {
      const N = 9;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const px = -dz;
      const pz = dx;
      const pt = (u: number) => [dx * len * u, rise * u - droop * u * u, dz * len * u];
      for (let i = 0; i < N; i++) {
        const u0 = i / N;
        const u1 = (i + 1) / N;
        const a0 = pt(u0);
        const a1 = pt(u1);
        const w = 0.035 * (1 - u0);
        // (the midrib)
        pos.push(a0[0] - px * w, a0[1], a0[2] - pz * w, a0[0] + px * w, a0[1], a0[2] + pz * w, a1[0], a1[1], a1[2]);
        col.push(...green, ...green, ...green);
        if (u0 < 0.12) continue;
        // (a pair of leaflets, raised in a V, longest in the middle of the frond)
        const lf = 0.55 * Math.sin(Math.PI * Math.min(1, u0 * 1.05)) + 0.12;
        for (const sd of [-1, 1]) {
          const ex = a0[0] + px * sd * lf + dx * lf * 0.35;
          const ey = a0[1] + lf * 0.35 - 0.06;
          const ez = a0[2] + pz * sd * lf + dz * lf * 0.35;
          pos.push(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], ex, ey, ez);
          const k = 0.9 + r() * 0.2;
          col.push(...green, ...green, ...tip.map((c) => c * k));
        }
      }
    };
    const greens: [RGB, RGB][] = [
      [rgb(THREE, 0x2e5a22), rgb(THREE, 0x6f9a3a)],
      [rgb(THREE, 0x37662a), rgb(THREE, 0x86a848)],
    ];
    const tiers = [
      { n: 9, rise: 1.6, len: 4.4, droop: 2.4, off: 0 },
      { n: 9, rise: 1.0, len: 4.6, droop: 3.6, off: 0.35 },
      { n: 7, rise: 2.3, len: 3.2, droop: 1.2, off: 0.7 },
    ];
    tiers.forEach((tr, ti) => {
      for (let k = 0; k < tr.n; k++) {
        const [g0, g1] = greens[(k + ti) % 2];
        frond((k / tr.n) * Math.PI * 2 + tr.off + r() * 0.2, tr.rise, tr.len * (0.9 + r() * 0.2), tr.droop * (0.85 + r() * 0.3), g0, g1);
      }
    });
    // (the dead fronds, hanging straight down the trunk)
    const brown = rgb(THREE, 0x8a6a3e);
    for (let k = 0; k < 5; k++) frond((k / 5) * Math.PI * 2 + 0.2, -0.2, 0.9, 2.4, brown, rgb(THREE, 0xb08a52));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const nrm = g.getAttribute('normal');
    for (let k = 0; k < nrm.count; k++) {
      const ny = Math.abs(nrm.getY(k)) + 0.6;
      const l = Math.hypot(nrm.getX(k), ny, nrm.getZ(k));
      nrm.setXYZ(k, nrm.getX(k) / l, ny / l, nrm.getZ(k) / l);
    }
    return g;
  })();
  // (the leaf scars: a diamond pattern of old leaf bases, round and round the trunk)
  const bark = texture(
    THREE,
    canvas(64, 64, (c) => {
      c.fillStyle = '#8a7a62';
      c.fillRect(0, 0, 64, 64);
      for (let row = 0; row < 4; row++) {
        for (let k = -1; k < 5; k++) {
          const x = k * 16 + (row % 2) * 8;
          const y = row * 16;
          c.fillStyle = row % 2 ? '#9c8a6e' : '#a8967a';
          c.beginPath();
          c.moveTo(x, y + 8);
          c.lineTo(x + 8, y);
          c.lineTo(x + 16, y + 8);
          c.lineTo(x + 8, y + 16);
          c.closePath();
          c.fill();
          c.strokeStyle = 'rgba(50,40,30,0.55)';
          c.lineWidth = 1.5;
          c.stroke();
        }
      }
    }),
  );
  bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
  bark.repeat.set(3, 10);
  const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: bark });
  plant(THREE, scene, dummy, trunk, trunkMat, palms.map((p) => ({ x: p.x, z: p.z, s: 1, sy: p.hgt })), 3);
  plant(THREE, scene, dummy, crown, swaying(THREE, 'palm', -2.5, 0.03), palms.map((p) => ({ x: p.x, y: p.hgt + 0.1, z: p.z, s: 1.05 })), 5);
}

/** Blue gums: tall, pale, peeling trunks leaning a little, a sparse crown of drooping grey-green clumps high up. */
export function gumTrees(THREE: Three, scene: T.Scene, dummy: T.Object3D, gums: { x: number; z: number; h: number }[]) {
  if (!gums.length) return;
  const r = scatter(83);
  const pale = rgb(THREE, 0xd8cfbf);
  const parts: { g: T.BufferGeometry; m: T.Matrix4; color?: RGB }[] = [];
  // (a unit-high tree)
  parts.push(limb(THREE, [0, -0.02, 0], [0.03, 0.62, 0], 0.03, 0.02, pale));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    parts.push(limb(THREE, [0.03, 0.55, 0], [0.03 + Math.cos(a) * 0.12, 0.8, Math.sin(a) * 0.12], 0.012, 0.006, pale));
  }
  const light = rgb(THREE, 0x8fa682);
  const dark = rgb(THREE, 0x34452e);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r();
    const d = k ? 0.05 + r() * 0.06 : 0;
    const s = 0.08 + r() * 0.05;
    parts.push({ g: lump(THREE, 300 + k, light, dark), m: at(THREE, 0.03 + Math.cos(a) * d, 0.68 + r() * 0.26, Math.sin(a) * d, s, s * 1.4, s) });
  }
  const g = merge(THREE, parts);
  for (const p of parts) p.g.dispose();
  // (the crown's lumps were sized for a unit-high tree: scaled across with its height too, it would be too broad on the
  // tallest, so x and z are scaled less)
  plant(THREE, scene, dummy, g, swaying(THREE, 'gum', 0.5, 0.012), gums.map((p) => ({ x: p.x, z: p.z, s: p.h * 0.75, sy: p.h })), 9);
}

/** Round shrubs (a hedge's worth of them), sitting on the ground. */
export function shrubs(THREE: Three, scene: T.Scene, dummy: T.Object3D, spots: { x: number; z: number; r: number }[], light = 0x5f8f3a, dark = 0x1f3818) {
  const g = lump(THREE, 77, rgb(THREE, light), rgb(THREE, dark));
  g.translate(0, 0.45, 0);
  plant(THREE, scene, dummy, g, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.map((s) => ({ x: s.x, z: s.z, s: s.r })), 13);
}
