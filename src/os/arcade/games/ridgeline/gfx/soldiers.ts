// The soldiers on the field: one skinned body per actor (geometry shared by everyone in the same kit), holding the gun
// they actually carry, posed every frame. The body is the project owner's soldier outfit when it has loaded (the kit
// recolors its cloth and gear, and some kits wear its helmet: your team in coyote with helmets, the other team in the
// outfit's own black with bare balaclavas), else the old real soldier (tinted per kit), else the lofted one. In
// deathmatch everyone draws a kit of their own.
import type { Assets } from '../assets.ts';
import type { Actor, Match } from '../match.ts';
import { PRONE_SPEED, RUN, currentGun } from '../match.ts';
import { PAVISE, WEAPONS, type WeaponId } from '../weapons.ts';
import type { World } from '../world.ts';
import { BONE, LOFT_BUILD, OUTFIT_BUILD, SOLDIER_BUILD, makePoser, skeleton, soldierGeometry, type Build } from './body.ts';
import { patch, roundBox, type Shared, type T, type Three } from './common.ts';
import { OUTFITS, outfitMaterials } from './gear.ts';
import { gunLiteGeometry, gunModel } from './guns.ts';
import { bakeModel, modelOf, worldMaterial, type Part } from './models.ts';

/**
 * Each kit: the tint on the old soldier's texture, and on the outfit the color its cloth and gear take (sRGB, for a
 * texel of the outfit's mean brightness), how much of it they take, and whether the helmet goes on.
 */
const KITS: Record<string, { tint: [number, number, number]; color: number; recolor: number; helmet: boolean }> = {
  multicam: { tint: [1.12, 1.0, 0.84], color: 0x6c6150, recolor: 0.8, helmet: true },
  black: { tint: [0.33, 0.35, 0.39], color: 0x2c2e32, recolor: 0, helmet: false },
  ranger: { tint: [0.78, 0.92, 0.7], color: 0x525e42, recolor: 0.8, helmet: true },
  coyote: { tint: [1.22, 1.02, 0.76], color: 0x856a4a, recolor: 0.85, helmet: false },
  woodland: { tint: [0.7, 0.86, 0.6], color: 0x4c5537, recolor: 0.8, helmet: false },
  urban: { tint: [0.95, 0.98, 1.06], color: 0x63686e, recolor: 0.75, helmet: true },
};

/** The outfit texture's mean linear brightness where a kit recolors it (measured by the bake). */
const OUTFIT_LUMA = 0.0196;

/** Name colors for the HUD (kill feed, deathmatch). */
const DM_COLORS = [0x7cc6ff, 0xff7a5c, 0xffd23c, 0x7cff6a, 0xff6ad5, 0x6af0ff, 0xb08cff, 0xffffff];
const DM_KITS = ['multicam', 'black', 'ranger', 'coyote', 'woodland', 'urban', 'multicam', 'black'];

export function paletteOf(m: Match, a: Actor) {
  // your side blue, the other side red, whichever side you are on
  return { band: m.mode === 'breach' ? (a.team === m.actors[m.me].team ? 0x7cc6ff : 0xff7a5c) : DM_COLORS[a.id % DM_COLORS.length] };
}

/** The kit an actor wears. */
export function kitOf(m: Match, a: Actor) {
  return m.mode === 'breach' ? (a.team === m.actors[m.me].team ? 'multicam' : 'black') : DM_KITS[a.id % DM_KITS.length];
}

/** Which side's version of a gun an actor carries (the other team fields AKs and Berettas). */
export function sideOf(m: Match, a: Actor) {
  return m.mode === 'breach' ? a.team : a.id % 2;
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

type Rig = { mesh: T.SkinnedMesh; bones: T.Bone[]; guns: Map<number, T.Mesh>; kit: string; muzzle: T.Vector3; frame: number; posedAt: number; lod: boolean; shield: T.Group | null };

/** The ballistic shield on a soldier (model space: its bottom edge, a little left of the middle): raised, square in
 * front at the height the rules use (lower crouched); carried, slung on the back. The model stands 1.57 m tall. */
const SHIELD_K = PAVISE.tall / 1.566;
/** Turns the model's face to the front. */
export const SHIELD_FACE = 0;


const GUN_IDS = Object.keys(WEAPONS) as WeaponId[];
/** One number per gun and side, so the per frame lookups build no strings. */
const gunKey = (id: WeaponId, side: number) => GUN_IDS.indexOf(id) * 2 + side;

/** Lying down, the model (1.57 m, its feet at the origin) tips forward onto its front around a point this far back
 * from the head, and rests this high on its chest; a full lean rolls it this far over (the spine bends the rest). */
const LIE_BACK = 1.5;
const LIE_UP = 0.13;
const LEAN_ROLL = 0.13;

/** On a ladder the body faces it, wherever its owner looks. */
function ladderYaw(w: World, x: number, z: number, yaw: number) {
  for (const l of w.ladders) if (Math.abs(l.x - x) < 1.2 && Math.abs(l.z - z) < 1.2) return Math.atan2(l.nx, l.nz);
  return yaw;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far soldiers are drawn at all, at full detail, and with a shadow (the outfit's near copy is the heavier, so it
 * hands over to the far one sooner: at 32 m a soldier stands under a tenth of the screen). */
const FAR = 330;
const NEAR = 45;
const NEAR_OUTFIT = 32;
const SHADOW = 50;

/**
 * The real soldier models: the outfit's body and helmet, near and far (all on one textured material), or the old
 * soldier when the outfit didn't load, with the joints each was skinned to.
 */
export type Look = { build: Build; mat: T.MeshStandardMaterial; body: T.BufferGeometry; lod: T.BufferGeometry | null; helmet: T.BufferGeometry | null; helmetLod: T.BufferGeometry | null; outfit: boolean };

export function soldierLook(THREE: Three, assets: Assets): Look | null {
  const part = (root: T.Object3D | undefined, name: string): Part | null => {
    const node = root?.getObjectByName(name);
    return node ? (bakeModel(THREE, node).parts[0] ?? null) : null;
  };
  const body = part(assets.outfit, 'outfit');
  if (body) {
    // the far copies carry no textures of their own: they draw with the near one's material
    const far = (name: string) => part(assets['outfit-lod'], name)?.geo ?? null;
    return { build: OUTFIT_BUILD, mat: body.mat, body: body.geo, lod: far('outfit'), helmet: part(assets.outfit, 'helmet')?.geo ?? null, helmetLod: far('helmet'), outfit: true };
  }
  const old = modelOf(THREE, assets, 'soldier')?.parts[0];
  if (!old) return null;
  return { build: SOLDIER_BUILD, mat: old.mat, body: old.geo, lod: modelOf(THREE, assets, 'soldier-lod')?.parts[0]?.geo ?? null, helmet: null, helmetLod: null, outfit: false };
}

/** One geometry of several (position, normal, uv and skinning; the uv and weights dequantized to floats). */
function mergeGeometries(THREE: Three, geos: T.BufferGeometry[]) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    const src = geos.map((g) => g.getAttribute(name));
    const k = src[0].itemSize;
    const n = src.reduce((sum, a) => sum + a.count, 0) * k;
    const arr = name === 'skinIndex' ? new Uint16Array(n) : new Float32Array(n);
    let o = 0;
    for (const a of src) for (let i = 0; i < a.count; i++, o++) for (let c = 0; c < k; c++) arr[o * k + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  const index = new Uint32Array(geos.reduce((sum, g) => sum + g.index!.count, 0));
  let o = 0;
  let base = 0;
  for (const g of geos) {
    for (let i = 0; i < g.index!.count; i++) index[o++] = g.index!.getX(i) + base;
    base += g.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** The outfit's material for a kit: lit like the world, its cloth and gear recolored where the texture's alpha lets it. */
function outfitMaterial(THREE: Three, src: T.MeshStandardMaterial, shared: Shared, kit: (typeof KITS)[string]) {
  const m = src.clone();
  m.side = THREE.FrontSide;
  patch(m, shared, {
    key: 'dz-outfit',
    uniforms: { dzKit: { value: new THREE.Color(kit.color) }, dzRecolor: { value: kit.recolor } },
    fragDecl: 'uniform vec3 dzKit;\nuniform float dzRecolor;',
    // the kit's color, shaded by the texture's own light and dark (its contrast softened)
    albedo: `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  float dzL = max(1e-4, dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  vec3 dzRe = dzKit * pow(dzL / ${OUTFIT_LUMA.toFixed(4)}, 0.7);
  diffuseColor.rgb *= mix(sampledDiffuseColor.rgb, dzRe, dzRecolor * sampledDiffuseColor.a);
#endif`,
  });
  return m;
}

export function soldiers(THREE: Three, shared: Shared, shadows: boolean, look: Look | null, shieldParts: Part[] = []): Soldiers {
  const group = new THREE.Group();
  const build = look?.build ?? LOFT_BUILD;
  /** The outfit with its helmet on, near and far, made when a kit first wears it. */
  let helmeted: [T.BufferGeometry, T.BufferGeometry | null] | null = null;
  const kits = new Map<string, { geo: T.BufferGeometry; lod: T.BufferGeometry | null; mats: T.Material[]; camo: T.Texture | null }>();
  const gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
  patch(gunMat, shared, { key: 'dz-gun-lite' });
  const rigs = new Map<number, Rig>();
  // the shield's parts lit like the world, shared by everyone carrying one (a plain slab if the model didn't load)
  const shieldLook: { geo: T.BufferGeometry; mat: T.Material }[] = shieldParts.length
    ? shieldParts.map((p) => ({ geo: p.geo, mat: worldMaterial(THREE, p.mat, shared) }))
    : [{ geo: roundBox(THREE, 0.62, 1.56, 0.05, 0.2, 2).translate(0, 0.78, 0), mat: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.4 }) }];
  if (!shieldParts.length) patch(shieldLook[0].mat as T.MeshStandardMaterial, shared, { key: 'dz-shield' });
  const shieldFor = (r: Rig) => {
    if (!r.shield) {
      r.shield = new THREE.Group();
      for (const p of shieldLook) {
        const mesh = new THREE.Mesh(p.geo, p.mat);
        mesh.castShadow = shadows;
        r.shield.add(mesh);
      }
      r.shield.scale.setScalar(SHIELD_K);
      r.mesh.add(r.shield);
    }
    return r.shield;
  };
  const pose = makePoser(THREE, build);
  const tmp = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  let frame = 0;
  let lastMatch: Match | null = null;
  /** Bodies made only to compile shaders. */
  const warmers: T.SkinnedMesh[] = [];

  const kitFor = (key: string) => {
    let k = kits.get(key);
    if (!k && look) {
      const kit = KITS[key] ?? KITS.multicam;
      const mats = [look.outfit ? outfitMaterial(THREE, look.mat, shared, kit) : worldMaterial(THREE, look.mat, shared, kit.tint)];
      if (look.outfit && kit.helmet && look.helmet) {
        helmeted ??= [mergeGeometries(THREE, [look.body, look.helmet]), look.lod ? mergeGeometries(THREE, [look.lod, look.helmetLod ?? look.helmet]) : null];
        k = { geo: helmeted[0], lod: helmeted[1], mats, camo: null };
      } else k = { geo: look.body, lod: look.lod, mats, camo: null };
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
    r = { mesh, bones, guns: new Map(), kit: key, muzzle: new THREE.Vector3(0, -1000, 0), frame: 0, posedAt: -1, lod: false, shield: null };
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
      Object.keys(KITS).forEach((key, i) => {
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
      if (m !== lastMatch) {
        lastMatch = m;
        for (const r of rigs.values()) r.posedAt = -1;
      }
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
          r.muzzle.set(0, -1000, 0);
          continue;
        }
        const dist = Math.hypot(b.x - cx, b.z - cz);
        sphere.center.set(b.x, b.y + 0.9, b.z);
        if (dist > FAR || !frustum.intersectsSphere(sphere)) {
          r.mesh.visible = false;
          r.muzzle.set(0, -1000, 0);
          continue;
        }
        r.mesh.visible = true;
        // far away: the light mesh, no shadow, and a pose every other (or fourth) frame
        const k = kitFor(r.kit);
        const useLod = !!k.lod && dist > (look?.outfit ? NEAR_OUTFIT : NEAR);
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
        // in a vehicle: seated, tilted with it (the driver faces the way it goes, a passenger where they look)
        const car = !dead && a.car >= 0 ? m.cars[a.car] : null;
        const seat = car ? (a.carSeat === 0 ? 1 : 2) : 0;
        // lying down: down on the knees first, then forward onto the front, the head where the body's eyes are
        const pr = car || sky ? 0 : a.prone;
        const lie = smooth(0.35, 1, pr);
        const kneel = Math.min(1, pr * 2.5) * (1 - lie);
        const tilt = -lie * Math.PI * 0.5;
        const back = Math.sin(-tilt) * LIE_BACK;
        r.mesh.position.set(b.x + Math.sin(a.yaw) * back, b.y - (b.swim ? 0.25 : 0) - fallE * 0.08 * (1 - lie) + lie * LIE_UP, b.z + Math.cos(a.yaw) * back);
        if (car) r.mesh.rotation.set(car.pitch, seat === 1 ? car.yaw : a.yaw, car.roll, 'YXZ');
        else r.mesh.rotation.set(dead ? (lie > 0.5 ? tilt : fallE * 1.45) : sky === 1 ? -1.25 : tilt, a.climbAnim === 2 && !dead ? ladderYaw(m.world, b.x, b.z, a.yaw) : a.yaw, dead ? 0 : -a.lean * LEAN_ROLL, 'YXZ');
        // a shield carried: up in front, or on the back
        if (a.pavise > 0 && !dead && !sky && !car) {
          const sh = shieldFor(r);
          sh.visible = true;
          if (a.paviseUp) {
            sh.position.set(-0.04, PAVISE.low[0] + (PAVISE.low[1] - PAVISE.low[0]) * a.crouch, -PAVISE.ahead);
            sh.rotation.set(0, SHIELD_FACE, 0);
          } else {
            sh.position.set(0, 0.42 - a.crouch * 0.4, 0.2);
            sh.rotation.set(0.08, SHIELD_FACE + Math.PI, 0);
          }
        } else if (r.shield) r.shield.visible = false;
        const g = sky || seat === 1 ? null : currentGun(a);
        const id = g?.id ?? null;
        const side = sideOf(m, a);
        const want = id && !dead && dist < 160 ? gunKey(id, side) : -1;
        for (const [gid, gg] of r.guns) gg.visible = gid === want;
        const gg = want >= 0 && id ? gunFor(r, id, side) : null;
        pose(r.bones, gg, {
          pitch: seat === 1 ? 0 : a.pitch,
          crouch: seat ? 0 : Math.max(a.crouch, kneel),
          lie,
          tilt,
          crawl: lie > 0.9 ? Math.min(1, Math.hypot(b.vx, b.vz) / PRONE_SPEED) : 0,
          lean: dead || seat ? 0 : a.lean,
          climb: dead || seat || sky ? 0 : a.climbAnim,
          climbT: a.climbT,
          speed: seat ? 0 : Math.min(1, Math.hypot(b.vx, b.vz) / RUN),
          phase: a.phase,
          air: !seat && !b.onGround && !b.swim,
          dead,
          gun: gg && id ? gunModel(THREE, id, side) : null,
          pistol: !!id && WEAPONS[id].cls === 'pistol',
          sky,
          seat,
        });
        r.mesh.updateMatrixWorld(true);
        if (gg && id) {
          const mz = gunModel(THREE, id, side).muzzle;
          r.muzzle.copy(gg.localToWorld(tmp.set(mz[0], mz[1], mz[2])));
        } else r.muzzle.set(0, -1000, 0);
      }
      for (const r of rigs.values()) if (r.frame !== frame) r.mesh.visible = false;
    },
    dispose() {
      for (const r of rigs.values()) r.mesh.skeleton.dispose();
      for (const k of kits.values()) {
        if (!look) k.geo.dispose();
        for (const mat of k.mats) mat.dispose();
        k.camo?.dispose();
      }
      for (const g of [look?.body, look?.lod, look?.helmet, look?.helmetLod, ...(helmeted ?? [])]) g?.dispose();
      gunMat.dispose();
      for (const p of shieldLook) {
        p.mat.dispose();
        p.geo.dispose();
      }
    },
  };
}
