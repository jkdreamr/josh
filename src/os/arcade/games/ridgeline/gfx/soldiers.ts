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
  update(m: Match, hide: number, time: number): void;
  /** World position of an actor's muzzle, from the last update. */
  muzzle(id: number, out: T.Vector3): T.Vector3;
  dispose(): void;
};

type Rig = { mesh: T.SkinnedMesh; bones: T.Bone[]; guns: Map<string, T.Mesh>; kit: string; muzzle: T.Vector3 };

export function soldiers(THREE: Three, shared: Shared, shadows: boolean, real: Part | null): Soldiers {
  const group = new THREE.Group();
  const build = real ? SOLDIER_BUILD : LOFT_BUILD;
  const kits = new Map<string, { geo: T.BufferGeometry; mats: T.Material[]; camo: T.Texture | null }>();
  const gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
  patch(gunMat, shared, { key: 'dz-gun-lite' });
  const rigs = new Map<number, Rig>();
  const pose = makePoser(THREE, build);
  const tmp = new THREE.Vector3();

  const kitFor = (key: string) => {
    let k = kits.get(key);
    if (!k && real) {
      k = { geo: real.geo, mats: [worldMaterial(THREE, real.mat, shared, TINT[key] ?? TINT.multicam)], camo: null };
      kits.set(key, k);
    }
    if (!k) {
      const o = OUTFITS[key];
      const geo = soldierGeometry(THREE, o);
      const mats = outfitMaterials(THREE, shared, o.uniform, key.length * 131 + 7);
      k = { geo, mats: [mats.fabric, mats.hard, mats.lens], camo: mats.camo };
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
    r = { mesh, bones, guns: new Map(), kit: key, muzzle: new THREE.Vector3(0, -1000, 0) };
    rigs.set(a.id, r);
    return r;
  };

  const gunFor = (r: Rig, id: WeaponId, side: number) => {
    const key = `${id}${side}`;
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
    update(m, hide, time) {
      const seen = new Set<number>();
      for (const a of m.actors) {
        const r = rigFor(m, a);
        seen.add(a.id);
        const gone = a.id === hide || (!a.alive && m.mode === 'dm' && time - a.deathT > 2.6);
        r.mesh.visible = !gone;
        if (gone) continue;
        const b = a.body;
        const dead = !a.alive;
        const fall = dead ? Math.min(1, (time - a.deathT) / 0.55) : 0;
        const fallE = fall * fall * (3 - 2 * fall);
        r.mesh.position.set(b.x, b.y - (b.swim ? 0.25 : 0) - fallE * 0.08, b.z);
        r.mesh.rotation.set(dead ? fallE * 1.45 : 0, a.yaw, 0, 'YXZ');
        const g = currentGun(a);
        const id = g?.id ?? null;
        const side = sideOf(m, a);
        for (const [gid, gg] of r.guns) gg.visible = gid === `${id}${side}` && !dead;
        const gg = id && !dead ? gunFor(r, id, side) : null;
        pose(r.bones, gg, {
          pitch: a.pitch,
          crouch: a.crouch,
          speed: Math.min(1, Math.hypot(b.vx, b.vz) / RUN),
          phase: a.phase,
          air: !b.onGround && !b.swim,
          dead,
          gun: id ? gunModel(THREE, id, side) : null,
          pistol: !!id && WEAPONS[id].cls === 'pistol',
        });
        r.mesh.updateMatrixWorld(true);
        if (gg && id) {
          const mz = gunModel(THREE, id, side).muzzle;
          r.muzzle.copy(gg.localToWorld(tmp.set(mz[0], mz[1], mz[2])));
        }
      }
      for (const [id, r] of rigs) if (!seen.has(id)) r.mesh.visible = false;
    },
    dispose() {
      for (const r of rigs.values()) r.mesh.skeleton.dispose();
      for (const k of kits.values()) {
        if (k.geo !== real?.geo) k.geo.dispose();
        for (const mat of k.mats) mat.dispose();
        k.camo?.dispose();
      }
      real?.geo.dispose();
      gunMat.dispose();
    },
  };
}
