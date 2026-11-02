// Animated first person arms: skinned arms holding a gun, with the file's own draw, fire and reload animations, for the
// guns that have such a model. The clips are not played on a clock; each frame sets them from what the gun is doing
// (draw from the swap timer, reload from the reload timer, so they always end with the game's own timers) and blends
// them with weights that ease in and out. The fire clip runs in two slots so a new shot crossfades over the last one.
import type { AssetKey, Assets } from '../assets.ts';
import type { WeaponId } from '../weapons.ts';
import { WEAPONS } from '../weapons.ts';
import type { T, Three } from './common.ts';

type V3 = [number, number, number];

/**
 * Per model: the file, the gun's bone, the clips, and points on the gun in the model's own space as it stands on the
 * fire clip's first frame (meters, the model looking down +z): the rear and front sights (the sight line) and the
 * muzzle. hip is where the rear sight sits in the camera's space when not aiming, with a little yaw (toward the
 * middle) and roll; relief is how far in front of the eye the rear sight sits when aiming.
 */
type AnimSpec = {
  key: AssetKey;
  bone: string;
  clips: { draw: string; fire: string; reload: string; reloadEmpty?: string };
  rear: V3;
  front: V3;
  muzzle: V3;
  hip: V3;
  yaw: number;
  roll: number;
  relief: number;
  /** How much of the fire clip shows while aiming (the rest is the steady aimed pose). */
  adsFire: number;
};

const SPECS: Partial<Record<WeaponId, AnimSpec>> = {
  kestrel: {
    key: 'vm-m4',
    bone: 'Main_j_049',
    clips: { draw: 'Draw', fire: 'Fire', reload: 'Reload', reloadEmpty: 'Reload_Empty' },
    rear: [-0.057, 1.533, 0.055],
    front: [-0.057, 1.533, 0.46],
    muzzle: [-0.057, 1.464, 0.632],
    hip: [0.07, -0.055, -0.15],
    yaw: 0.04,
    roll: 0.03,
    relief: 0.16,
    adsFire: 0.4,
  },
  hornet: {
    key: 'vm-vector',
    bone: 'main_j_02',
    clips: { draw: 'Draw', fire: 'Shoot', reload: 'Reload' },
    rear: [-0.1235, 1.5, 0.015],
    front: [-0.1235, 1.503, 0.311],
    muzzle: [-0.1228, 1.433, 0.425],
    hip: [0.05, -0.015, -0.2],
    yaw: 0.04,
    roll: 0.03,
    relief: 0.17,
    adsFire: 0.4,
  },
  wren: {
    key: 'vm-mk23',
    bone: 'main_j_050',
    clips: { draw: 'Draw', fire: 'Shoot', reload: 'Reload' },
    rear: [-0.1075, 1.541, -0.03],
    front: [-0.1078, 1.541, 0.18],
    muzzle: [-0.108, 1.512, 0.203],
    hip: [0.05, -0.05, -0.28],
    yaw: 0.03,
    roll: 0.02,
    relief: 0.34,
    adsFire: 0.5,
  },
};

/** What the animated arms need to know each frame. */
export type ArmsState = {
  /** Swap timer as a fraction (1 just switched, 0 ready). */
  switching: number;
  /** Reload progress 0..1 (0 when not reloading). */
  reload: number;
  /** The magazine was empty when this reload started. */
  empty: boolean;
  ads: number;
};

export type AnimArms = {
  id: WeaponId;
  /** The model, placed so the rear sight is at its origin and the sight line runs down -z. */
  holder: T.Group;
  /** Where the holder's origin goes (camera space) at the hip and aimed, and its hip yaw and roll. */
  hip: V3;
  relief: number;
  yaw: number;
  roll: number;
  /** Restarts the fire clip. */
  shoot(): void;
  /** Sets the pose for this frame (call only while visible). */
  pose(st: ArmsState, dt: number): void;
  /** The muzzle in the scene's world space. */
  muzzle(out: T.Vector3): T.Vector3;
  /** Back to the ready pose, nothing playing (when it comes into view). */
  reset(): void;
  dispose(): void;
};

const ease = (w: number, target: number, rate: number, dt: number) => w + (target - w) * (1 - Math.exp(-dt * rate));

function build(THREE: Three, id: WeaponId, spec: AnimSpec, src: T.Object3D): AnimArms | null {
  const clips = src.animations;
  const find = (name: string | undefined) => (name ? clips.find((c) => c.name === name) : undefined);
  const drawClip = find(spec.clips.draw);
  const fireClip = find(spec.clips.fire);
  const reloadClip = find(spec.clips.reload);
  const emptyClip = find(spec.clips.reloadEmpty) ?? reloadClip;
  const bone = src.getObjectByName(spec.bone);
  if (!drawClip || !fireClip || !reloadClip || !emptyClip || !bone) return null;

  const holder = new THREE.Group();
  const align = new THREE.Group();
  holder.add(align);
  src.position.set(0, 0, 0);
  src.quaternion.identity();
  src.scale.setScalar(1);
  align.add(src);
  src.traverse((o) => {
    // always in view, and a skinned mesh's bounds follow its rest pose rather than the animation
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = false;
  });

  const mixer = new THREE.AnimationMixer(src);
  const fireClip2 = fireClip.clone();
  const draw = mixer.clipAction(drawClip);
  const fires = [mixer.clipAction(fireClip), mixer.clipAction(fireClip2)];
  const reload = mixer.clipAction(reloadClip);
  const empty = emptyClip === reloadClip ? reload : mixer.clipAction(emptyClip);
  const all = [draw, ...fires, reload, ...(empty === reload ? [] : [empty])];
  for (const a of all) {
    a.play();
    a.setEffectiveWeight(0);
  }
  const end = (c: T.AnimationClip) => Math.max(0, c.duration - 1e-4);

  // the points on the gun, held in the gun bone's space so they follow it through every clip
  const boneInv = new THREE.Matrix4();
  const at = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(boneInv);
  const setOnly = (a: T.AnimationAction, t: number) => {
    for (const x of all) x.setEffectiveWeight(0);
    a.setEffectiveWeight(1);
    a.time = t;
    mixer.update(0);
    src.updateMatrixWorld(true);
  };
  setOnly(fires[0], 0);
  boneInv.copy(bone.matrixWorld).invert();
  const rearB = at(spec.rear);
  const frontB = at(spec.front);
  const muzzleB = at(spec.muzzle);

  // ready pose: the end of the draw. The sight line there decides how the model sits in the holder.
  setOnly(draw, end(drawClip));
  const rear = rearB.clone().applyMatrix4(bone.matrixWorld);
  const front = frontB.clone().applyMatrix4(bone.matrixWorld);
  // the model looks down +z: turn it round to look down -z like the camera, then square the sight line with -z
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  rear.applyQuaternion(turn);
  front.applyQuaternion(turn);
  const line = front.sub(rear).normalize();
  const square = new THREE.Quaternion().setFromUnitVectors(line, new THREE.Vector3(0, 0, -1));
  align.quaternion.copy(square).multiply(turn);
  align.position.copy(rear).applyQuaternion(square).negate();
  align.updateMatrix();

  let wDraw = 1;
  let wReload = 0;
  const wFire = [0, 0];
  const tFire = [0, 0];
  let slot = 0;
  let reloading = false;
  let emptyReload = false;
  const fireEnd = end(fireClip);

  return {
    id,
    holder,
    hip: spec.hip,
    relief: spec.relief,
    yaw: spec.yaw,
    roll: spec.roll,
    shoot() {
      slot = 1 - slot;
      tFire[slot] = 0;
    },
    reset() {
      wReload = 0;
      wFire[0] = wFire[1] = 0;
      tFire[0] = tFire[1] = fireEnd;
      reloading = false;
    },
    pose(st, dt) {
      // reload: picks its clip when it starts, and its time follows the game's reload timer
      const isReload = st.reload > 0 && st.reload < 1;
      if (isReload && !reloading) emptyReload = st.empty;
      reloading = isReload;
      const ra = emptyReload ? empty : reload;
      const ro = ra === reload ? empty : reload;
      if (isReload) ra.time = st.reload * end(ra.getClip());
      wReload = ease(wReload, isReload ? 1 : 0, isReload ? 14 : 9, dt);
      // fire: each slot plays from its shot, the newest crossfading in quickly over the older
      for (let i = 0; i < 2; i++) {
        tFire[i] = Math.min(fireEnd, tFire[i] + dt);
        const live = tFire[i] < fireEnd && !isReload && st.switching <= 0;
        const target = live && i === slot ? 1 : 0;
        wFire[i] = ease(wFire[i], target, target ? 40 : i === slot ? 8 : 25, dt);
        fires[i].time = tFire[i];
      }
      // draw: its time follows the swap timer; at rest it holds its last frame, the ready pose
      draw.time = (1 - Math.min(1, Math.max(0, st.switching))) * end(drawClip);
      const fireK = 1 - st.ads * (1 - spec.adsFire);
      let f0 = wFire[0] * fireK;
      let f1 = wFire[1] * fireK;
      const fs = f0 + f1;
      if (fs > 1) {
        f0 /= fs;
        f1 /= fs;
      }
      const r = Math.min(1, wReload);
      f0 *= 1 - r;
      f1 *= 1 - r;
      wDraw = Math.max(0, 1 - r - f0 - f1);
      draw.setEffectiveWeight(wDraw);
      fires[0].setEffectiveWeight(f0);
      fires[1].setEffectiveWeight(f1);
      ra.setEffectiveWeight(r);
      if (ro !== ra) ro.setEffectiveWeight(0);
      mixer.update(0);
    },
    muzzle(out) {
      bone.updateWorldMatrix(true, false);
      return out.copy(muzzleB).applyMatrix4(bone.matrixWorld);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheClip(fireClip2);
      mixer.uncacheRoot(src);
      align.remove(src);
      // the loaded model's GPU copies (the model itself stays loaded and uploads again if another view shows it)
      const seen = new Set<unknown>();
      src.traverse((o) => {
        const m = o as T.Mesh;
        if (!m.isMesh) return;
        if (!seen.has(m.geometry)) {
          seen.add(m.geometry);
          m.geometry.dispose();
        }
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          if (seen.has(mat)) continue;
          seen.add(mat);
          for (const v of Object.values(mat)) if (v && (v as T.Texture).isTexture && !seen.has(v)) {
            seen.add(v);
            (v as T.Texture).dispose();
          }
          mat.dispose();
        }
      });
    },
  };
}

/** The animated arms for every gun whose model loaded (the rest keep the static view model). */
export function animatedArms(THREE: Three, assets: Assets | null | undefined) {
  const out = new Map<WeaponId, AnimArms>();
  if (!assets) return out;
  for (const id of Object.keys(SPECS) as WeaponId[]) {
    const spec = SPECS[id]!;
    const src = assets[spec.key];
    if (!src || !WEAPONS[id]) continue;
    try {
      const arms = build(THREE, id, spec, src);
      if (arms) out.set(id, arms);
    } catch {
      // a broken file: that gun keeps the static model
    }
  }
  return out;
}
