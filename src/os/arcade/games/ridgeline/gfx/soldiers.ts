// The soldiers on the field: one skinned body per actor (geometry shared by everyone in the same kit), holding the gun
// they actually carry, posed every frame. The body is the real soldier model when it has loaded (tinted per kit: your
// team in warm tan, the other team in charcoal), else the lofted one. In deathmatch everyone draws a kit of their own.
import type { Actor, Match } from '../match.ts';
import { RUN, currentGun } from '../match.ts';
import { WEAPONS, type WeaponId } from '../weapons.ts';
import { BONE, LOFT_BUILD, SOLDIER_BUILD, makePoser, skeleton, soldierGeometry } from './body.ts';
import { patch, type Shared, type T, type Three } from './common.ts';
import { OUTFITS, outfitMaterials } from './gear.ts';
import { gunLiteGeometry, gunModel } from './guns.ts';
import { worldMaterial, type Part } from './models.ts';

/** How each kit tints the real soldier's texture. */
const TINT: Record<string, [number, number, number]> = {
  multicam: [1.12, 1.0, 0.84],
  black: [0.33, 0.35, 0.39],
  ranger: [0.78, 0.92, 0.7],
  coyote: [1.22, 1.02, 0.76],
  woodland: [0.7, 0.86, 0.6],
  urban: [0.95, 0.98, 1.06],
};

/** Name colors for the HUD (kill feed, deathmatch). */
const DM_COLORS = [0x7cc6ff, 0xff7a5c, 0xffd23c, 0x7cff6a, 0xff6ad5, 0x6af0ff, 0xb08cff, 0xffffff];
const DM_KITS = ['multicam', 'black', 'ranger', 'coyote', 'woodland', 'urban', 'multicam', 'black'];

export function paletteOf(m: Match, a: Actor) {
  return { band: m.mode === 'uplink' ? (a.team === 0 ? 0x7cc6ff : 0xff7a5c) : DM_COLORS[a.id % DM_COLORS.length] };
}

/** The kit an actor wears. */
export function kitOf(m: Match, a: Actor) {
  return m.mode === 'uplink' ? (a.team === 0 ? 'multicam' : 'black') : DM_KITS[a.id % DM_KITS.length];
}

/** Which side's version of a gun an actor carries (the other team fields AKs and Berettas). */
export function sideOf(m: Match, a: Actor) {
  return m.mode === 'uplink' ? a.team : a.id % 2;
}

export type Soldiers = {
  group: T.Group;
  update(m: Match, hide: number, time: number, camera: T.Camera): void;
  /** World position of an actor's muzzle, from the last update. */
  muzzle(id: number, out: T.Vector3): T.Vector3;
  /** Builds a body in every kit, full and light, with a gun, in front of the camera, so their shaders compile now; call the result to take them away. */
  prewarm(camera: T.Camera): () => void;
  dispose(): void;
};

type Rig = { mesh: T.SkinnedMesh; bones: T.Bone[]; guns: Map<number, T.Mesh>; kit: string; muzzle: T.Vector3; frame: number; posedAt: number; lod: boolean };

const GUN_IDS = Object.keys(WEAPONS) as WeaponId[];
/** One number per gun and side, so the per frame lookups build no strings. */
const gunKey = (id: WeaponId, side: number) => GUN_IDS.indexOf(id) * 2 + side;

/** How far soldiers are drawn at all, at full detail, and with a shadow. */
const FAR = 330;
const NEAR = 45;
const SHADOW = 50;

export function soldiers(THREE: Three, shared: Shared, shadows: boolean, real: Part | null, lod: Part | null): Soldiers {
  const group = new THREE.Group();
  const build = real ? SOLDIER_BUILD : LOFT_BUILD;
  const kits = new Map<string, { geo: T.BufferGeometry; lod: T.BufferGeometry | null; mats: T.Material[]; camo: T.Texture | null }>();
  const gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
  patch(gunMat, shared, { key: 'dz-gun-lite' });
  const rigs = new Map<number, Rig>();
  const pose = makePoser(THREE, build);
  const tmp = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  let frame = 0;
  /** Bodies made only to compile shaders. */
  const warmers: T.SkinnedMesh[] = [];

  const kitFor = (key: string) => {
    let k = kits.get(key);
    if (!k && real) {
      k = { geo: real.geo, lod: lod?.geo ?? null, mats: [worldMaterial(THREE, real.mat, shared, TINT[key] ?? TINT.multicam)], camo: null };
      kits.set(key, k);
    }
    if (!k) {
      const o = OUTFITS[key];
      const geo = soldierGeometry(THREE, o);
      const mats = outfitMaterials(THREE, shared, o.uniform, key.length * 131 + 7);
      k = { geo, lod: null, mats: [mats.fabric, mats.hard, mats.lens], camo: mats.camo };
      kits.set(key, k);
    }
    return k;
  };

  const rigFor = (m: Match, a: Actor) => {
    const key = kitOf(m, a);
    let r = rigs.get(a.id);
    if (r && r.kit === key) return r;
    if (r) {
      group.remove(r.mesh);
      r.mesh.skeleton.dispose();
    }
    const k = kitFor(key);
    const { bones, skeleton: sk } = skeleton(THREE, build.joints);
    const mesh = new THREE.SkinnedMesh(k.geo, k.mats.length === 1 ? k.mats[0] : k.mats);
    mesh.add(bones[0]);
    mesh.bind(sk);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    r = { mesh, bones, guns: new Map(), kit: key, muzzle: new THREE.Vector3(0, -1000, 0), frame: 0, posedAt: -1, lod: false };
    rigs.set(a.id, r);
    return r;
  };

  const gunFor = (r: Rig, id: WeaponId, side: number) => {
    const key = gunKey(id, side);
    let g = r.guns.get(key);
    if (!g) {
      g = new THREE.Mesh(gunLiteGeometry(THREE, gunModel(THREE, id, side)), gunMat);
      g.castShadow = false;
      r.bones[BONE.chest].add(g);
      r.guns.set(key, g);
    }
    return g;
  };

  return {
    group,
    muzzle(id, v) {
      const r = rigs.get(id);
      return r ? v.copy(r.muzzle) : v.set(0, -1000, 0);
    },
    prewarm(camera) {
      camera.getWorldDirection(tmp);
      Object.keys(TINT).forEach((key, i) => {
        const k = kitFor(key);
        for (const geo of k.lod ? [k.geo, k.lod] : [k.geo]) {
          const { bones, skeleton: sk } = skeleton(THREE, build.joints);
          const mesh = new THREE.SkinnedMesh(geo, k.mats.length === 1 ? k.mats[0] : k.mats);
          mesh.add(bones[0]);
          mesh.bind(sk);
          mesh.castShadow = shadows;
          mesh.frustumCulled = false;
          mesh.position.copy(camera.position).addScaledVector(tmp, 4 + i);
          const gun = new THREE.Mesh(gunLiteGeometry(THREE, gunModel(THREE, 'kestrel', 0)), gunMat);
          bones[BONE.chest].add(gun);
          group.add(mesh);
          warmers.push(mesh);
        }
      });
      return () => {
        for (const w of warmers) {
          group.remove(w);
          w.skeleton.dispose();
        }
        warmers.length = 0;
      };
    },
    update(m, hide, time, camera) {
      frame++;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      const cx = camera.position.x;
      const cz = camera.position.z;
      for (const a of m.actors) {
        const r = rigFor(m, a);
        r.frame = frame;
        const b = a.body;
        const dead = !a.alive;
        // gone: the one you look out of, anyone aboard the transport, and the fallen after a while
        const gone = a.id === hide || a.drop === 1 || (dead && time - a.deathT > (m.mode === 'dm' ? 2.6 : 40));
        if (gone) {
          r.mesh.visible = false;
          continue;
        }
        const dist = Math.hypot(b.x - cx, b.z - cz);
        sphere.center.set(b.x, b.y + 0.9, b.z);
        if (dist > FAR || !frustum.intersectsSphere(sphere)) {
          r.mesh.visible = false;
          continue;
        }
        r.mesh.visible = true;
        // far away: the light mesh, no shadow, and a pose every other (or fourth) frame
        const k = kitFor(r.kit);
        const useLod = !!k.lod && dist > NEAR;
        if (useLod !== r.lod) {
          r.mesh.geometry = useLod ? k.lod! : k.geo;
          r.lod = useLod;
        }
        r.mesh.castShadow = shadows && dist < SHADOW;
        const fall = dead ? Math.min(1, (time - a.deathT) / 0.55) : 0;
        const settled = dead && fall >= 1 && r.posedAt > a.deathT + 0.55;
        const every = dist > 180 ? 4 : dist > 90 ? 2 : 1;
        if (settled || (every > 1 && (frame + a.id) % every !== 0 && r.posedAt >= 0)) continue;
        r.posedAt = time;
        const fallE = fall * fall * (3 - 2 * fall);
        const sky = a.drop === 2 ? 1 : a.drop === 3 ? 2 : 0;
        r.mesh.position.set(b.x, b.y - (b.swim ? 0.25 : 0) - fallE * 0.08, b.z);
        r.mesh.rotation.set(dead ? fallE * 1.45 : sky === 1 ? -1.25 : 0, a.yaw, 0, 'YXZ');
        const g = sky ? null : currentGun(a);
        const id = g?.id ?? null;
        const side = sideOf(m, a);
        const want = id && !dead && dist < 160 ? gunKey(id, side) : -1;
        for (const [gid, gg] of r.guns) gg.visible = gid === want;
        const gg = want >= 0 && id ? gunFor(r, id, side) : null;
        pose(r.bones, gg, {
          pitch: a.pitch,
          crouch: a.crouch,
          speed: Math.min(1, Math.hypot(b.vx, b.vz) / RUN),
          phase: a.phase,
          air: !b.onGround && !b.swim,
          dead,
          gun: gg && id ? gunModel(THREE, id, side) : null,
          pistol: !!id && WEAPONS[id].cls === 'pistol',
          sky,
        });
        r.mesh.updateMatrixWorld(true);
        if (gg && id) {
          const mz = gunModel(THREE, id, side).muzzle;
          r.muzzle.copy(gg.localToWorld(tmp.set(mz[0], mz[1], mz[2])));
        }
      }
      for (const r of rigs.values()) if (r.frame !== frame) r.mesh.visible = false;
    },
    dispose() {
      for (const r of rigs.values()) r.mesh.skeleton.dispose();
      for (const k of kits.values()) {
        if (k.geo !== real?.geo) k.geo.dispose();
        for (const mat of k.mats) mat.dispose();
        k.camo?.dispose();
      }
      real?.geo.dispose();
      lod?.geo.dispose();
      gunMat.dispose();
    },
  };
}
