// Soldiers: every body part of every soldier is one instanced mesh (about fourteen draw calls for the whole lobby),
// posed each frame by a little forward kinematics: hips, spine and head follow the aim, legs walk a cycle tied to the
// distance moved, the arms hold the gun, and a knocked out soldier falls over.
import type { Actor, Match } from '../match.ts';
import { RUN } from '../match.ts';
import { patch, lin, roundBox, type Shared, type T, type Three } from './common.ts';

type PartKey = 'pelvis' | 'torso' | 'vest' | 'pack' | 'head' | 'helmet' | 'uarm' | 'farm' | 'hand' | 'thigh' | 'shin' | 'boot' | 'gun' | 'band';
const PER: Record<PartKey, number> = { pelvis: 1, torso: 1, vest: 1, pack: 1, head: 1, helmet: 1, uarm: 2, farm: 2, hand: 2, thigh: 2, shin: 2, boot: 2, gun: 1, band: 2 };

type Palette = { shirt: number; pants: number; gear: number; helmet: number; band: number };
const TEAM: Palette[] = [
  { shirt: 0x3d4c5e, pants: 0x2e3946, gear: 0x262c34, helmet: 0x37434f, band: 0x3fa9ff },
  { shirt: 0x7a6a4c, pants: 0x5c5240, gear: 0x463f30, helmet: 0x665a43, band: 0xff5a3c },
];
const DM: Palette[] = [
  { shirt: 0x3d4c5e, pants: 0x2e3946, gear: 0x262c34, helmet: 0x37434f, band: 0x3fa9ff },
  { shirt: 0x7a6a4c, pants: 0x5c5240, gear: 0x463f30, helmet: 0x665a43, band: 0xff5a3c },
  { shirt: 0x4b5a3a, pants: 0x3a4430, gear: 0x2e3326, helmet: 0x47533a, band: 0xffd23c },
  { shirt: 0x5a5a5e, pants: 0x3c3c40, gear: 0x2a2a2e, helmet: 0x4a4a50, band: 0x7cff6a },
  { shirt: 0x6a4a3a, pants: 0x4a3a30, gear: 0x352a24, helmet: 0x5a4436, band: 0xff6ad5 },
  { shirt: 0x2e4a4a, pants: 0x263838, gear: 0x1e2a2a, helmet: 0x2e4444, band: 0x6af0ff },
  { shirt: 0x8a8070, pants: 0x605848, gear: 0x403a30, helmet: 0x7a7060, band: 0xb08cff },
  { shirt: 0x3a3a4e, pants: 0x2a2a3a, gear: 0x20202a, helmet: 0x34344a, band: 0xffffff },
];
const SKIN = [0xe0b294, 0xc68c6a, 0x9a6648, 0x6e4632, 0xf0c8a8, 0xb07a58];

export function paletteOf(m: Match, a: Actor): Palette {
  return m.mode === 'uplink' ? TEAM[a.team] : DM[a.id % DM.length];
}

function geoms(THREE: Three): Record<PartKey, T.BufferGeometry> {
  const cap = (r: number, l: number, dy: number, sx = 1, sz = 1) => {
    const g = new THREE.CapsuleGeometry(r, l, 4, 10);
    g.scale(sx, 1, sz);
    g.translate(0, dy, 0);
    return g;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = roundBox(THREE, w, h, d, 0.22);
    g.translate(x, y, z);
    return g;
  };
  const merge = (list: T.BufferGeometry[]) => {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    list.forEach((g) => g.dispose());
    parts.forEach((g) => g.dispose());
    return out;
  };
  const head = new THREE.SphereGeometry(0.108, 14, 10);
  head.scale(0.95, 1.12, 1);
  head.translate(0, 0.13, -0.01);
  const helmet = new THREE.SphereGeometry(0.132, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
  helmet.translate(0, 0.165, 0);
  const band = new THREE.CylinderGeometry(0.064, 0.064, 0.06, 10, 1, true);
  band.translate(0, -0.07, 0);
  return {
    pelvis: box(0.32, 0.2, 0.21, 0, 0, 0),
    torso: cap(0.165, 0.28, 0.3, 1.25, 0.74),
    vest: merge([box(0.4, 0.36, 0.29, 0, 0.34, -0.005), box(0.1, 0.09, 0.06, -0.1, 0.3, -0.17), box(0.1, 0.09, 0.06, 0.06, 0.3, -0.17), box(0.1, 0.09, 0.06, 0.14, 0.42, -0.165)]),
    pack: merge([box(0.3, 0.38, 0.15, 0, 0.33, 0.21), box(0.24, 0.08, 0.12, 0, 0.12, 0.2)]),
    head,
    helmet,
    uarm: cap(0.056, 0.2, -0.155),
    farm: cap(0.05, 0.19, -0.145),
    hand: box(0.07, 0.1, 0.06, 0, -0.05, 0),
    thigh: cap(0.077, 0.3, -0.22),
    shin: cap(0.062, 0.31, -0.22),
    boot: box(0.11, 0.1, 0.27, 0, -0.04, -0.05),
    gun: merge([box(0.055, 0.1, 0.62, 0, 0.02, -0.18), box(0.045, 0.16, 0.07, 0, -0.08, -0.12), box(0.05, 0.12, 0.22, 0, 0, 0.2), box(0.025, 0.025, 0.25, 0, 0.04, -0.6), box(0.04, 0.05, 0.12, 0, 0.1, -0.15)]),
    band,
  };
}

export type Soldiers = {
  group: T.Group;
  update(m: Match, hide: number, time: number): void;
  /** World position of an actor's muzzle, from the last update. */
  muzzle(id: number, out: T.Vector3): T.Vector3;
};

export function soldiers(THREE: Three, shared: Shared, count: number, shadows: boolean): Soldiers {
  const group = new THREE.Group();
  const g = geoms(THREE);
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.88 });
  patch(cloth, shared, {
    key: 'dz-cloth',
    vertDecl: 'varying vec3 vObj;',
    vertBody: 'vObj = position;',
    fragDecl: 'varying vec3 vObj;',
    albedo: `{
      float n = dzNoise(vObj.xy * 11.0 + vObj.z * 7.0) * 0.6 + dzNoise(vObj.zy * 23.0) * 0.4;
      diffuseColor.rgb *= mix(0.78, 1.18, smoothstep(0.35, 0.65, n));
    }`,
  });
  const skin = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  patch(skin, shared, { key: 'dz-skin' });
  const metal = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.42, metalness: 0.65 });
  patch(metal, shared, { key: 'dz-metal' });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const matOf: Record<PartKey, T.Material> = { pelvis: cloth, torso: cloth, vest: cloth, pack: cloth, head: skin, helmet: cloth, uarm: cloth, farm: cloth, hand: skin, thigh: cloth, shin: cloth, boot: cloth, gun: metal, band: glow };
  const meshes = {} as Record<PartKey, T.InstancedMesh>;
  for (const key of Object.keys(PER) as PartKey[]) {
    const mesh = new THREE.InstancedMesh(g[key], matOf[key], count * PER[key]);
    mesh.castShadow = shadows && key !== 'band';
    mesh.receiveShadow = key !== 'band';
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    meshes[key] = mesh;
  }
  const M = THREE.Matrix4;
  const root = new M();
  const hips = new M();
  const spine = new M();
  const neck = new M();
  const tmp = new M();
  const tmp2 = new M();
  const out = new M();
  const elbow = new M();
  const kneeM = new M();
  const rot = new M();
  const linCache = new Map<number, [number, number, number]>();
  const color = new THREE.Color();
  const muzzles = new Map<number, [number, number, number]>();
  const muzzleLocal = new THREE.Vector3();
  const counts = {} as Record<PartKey, number>;
  const put = (key: PartKey, mat: T.Matrix4, hex: number) => {
    const mesh = meshes[key];
    const i = counts[key]++;
    mesh.setMatrixAt(i, mat);
    let c = linCache.get(hex);
    if (!c) linCache.set(hex, (c = lin(hex)));
    mesh.setColorAt(i, color.setRGB(c[0], c[1], c[2]));
  };
  /** out = parent * T(x, y, z) * Rx(ax) * Ry(ay) * Rz(az) */
  const joint = (dst: T.Matrix4, parent: T.Matrix4, x: number, y: number, z: number, ax: number, ay = 0, az = 0) => {
    tmp.makeTranslation(x, y, z);
    dst.multiplyMatrices(parent, tmp);
    if (ax) dst.multiply(rot.makeRotationX(ax));
    if (ay) dst.multiply(rot.makeRotationY(ay));
    if (az) dst.multiply(rot.makeRotationZ(az));
    return dst;
  };
  return {
    group,
    muzzle(id, v) {
      const p = muzzles.get(id);
      return p ? v.set(p[0], p[1], p[2]) : v.set(0, -1000, 0);
    },
    update(m, hide, time) {
      for (const k of Object.keys(PER) as PartKey[]) counts[k] = 0;
      for (const a of m.actors) {
        if (a.id === hide) continue;
        const dead = !a.alive;
        if (dead && m.mode === 'dm' && time - a.deathT > 2.6) continue;
        const pal = paletteOf(m, a);
        const skinHex = SKIN[a.look % SKIN.length];
        const b = a.body;
        const sp = Math.min(1, Math.hypot(b.vx, b.vz) / RUN);
        const ph = a.phase * 2.2;
        const crouch = a.crouch;
        const air = b.onGround || b.swim ? 0 : 1;
        // knocked out: tip over backward around the feet over half a second
        const fall = dead ? Math.min(1, (time - a.deathT) / 0.55) : 0;
        const fallE = fall * fall * (3 - 2 * fall);
        root.makeTranslation(b.x, b.y - (b.swim ? 0.2 : 0), b.z);
        root.multiply(rot.makeRotationY(a.yaw));
        if (dead) {
          root.multiply(rot.makeRotationX(fallE * 1.5));
          root.multiply(tmp2.makeTranslation(0, -fallE * 0.12, 0));
        }
        const pitch = dead ? 0 : a.pitch;
        const bob = Math.abs(Math.sin(ph)) * 0.045 * sp * (1 - crouch * 0.5);
        const hipH = 0.95 - crouch * 0.33 - air * 0.08;
        joint(hips, root, 0, hipH + bob, 0, -0.1 * sp - crouch * 0.35);
        put('pelvis', hips, pal.pants);
        joint(spine, hips, 0, 0.08, 0, pitch * 0.35 + crouch * 0.25);
        put('torso', spine, pal.shirt);
        put('vest', spine, pal.gear);
        put('pack', spine, pal.gear);
        joint(neck, spine, 0, 0.58, 0, pitch * 0.45);
        put('head', neck, skinHex);
        put('helmet', neck, pal.helmet);
        // arms hold the gun out front, both raised with the aim; spread when down
        for (const side of [1, -1]) {
          // rifle hold: the right elbow down and out with the forearm level to the grip, the left arm reaching along the gun
          const up = dead ? 0.3 + side * 0.2 : side > 0 ? 0.42 + pitch * 0.5 : 0.85 + pitch * 0.55;
          const outA = dead ? side * 1.1 : side > 0 ? 0.32 : -0.42;
          const sh = joint(tmp2, spine, side * 0.215, 0.5, 0, up, 0, outA);
          put('uarm', sh, pal.shirt);
          put('band', sh, pal.band);
          const el = joint(elbow, sh, 0, -0.3, 0, dead ? 0.2 : side > 0 ? 1.25 : 0.65, 0, dead ? 0 : side > 0 ? -0.5 : 0.55);
          put('farm', el, pal.shirt);
          joint(out, el, 0, -0.28, 0, 0);
          put('hand', out, skinHex);
        }
        // the gun at the chest, along the aim
        joint(out, spine, 0.11, 0.4, -0.26, dead ? -1.2 : pitch * 0.2, 0, dead ? 0.8 : 0);
        put('gun', out, 0xffffff);
        muzzleLocal.set(0, 0.04, -0.74).applyMatrix4(out);
        muzzles.set(a.id, [muzzleLocal.x, muzzleLocal.y, muzzleLocal.z]);
        // legs: swing with the walk cycle, bend to crouch, tuck in the air
        for (const side of [1, -1]) {
          const s = Math.sin(ph + (side > 0 ? 0 : Math.PI));
          const swing = dead ? side * 0.1 : s * 0.55 * sp + crouch * 1.05 + air * 0.45;
          const knee = dead ? 0.15 : Math.max(0, -Math.cos(ph + (side > 0 ? 0 : Math.PI))) * 0.9 * sp + crouch * 1.75 + air * 0.8;
          const hip = joint(tmp2, hips, side * 0.1, -0.06, 0, swing, 0, dead ? side * 0.15 : 0);
          put('thigh', hip, pal.pants);
          const kn = joint(kneeM, hip, 0, -0.44, 0, -knee);
          put('shin', kn, pal.pants);
          joint(out, kn, 0, -0.44, 0, knee - swing * 0.6 - crouch * 0.6);
          put('boot', out, 0x1e1c1a);
        }
      }
      for (const k of Object.keys(PER) as PartKey[]) {
        const mesh = meshes[k];
        mesh.count = counts[k];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
