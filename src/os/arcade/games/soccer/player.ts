import type * as T from 'three';

type Three = typeof import('three');

export const TAU = Math.PI * 2;
export type Foot = 'l' | 'r';
export type SoccerClip = 'pass' | 'shot' | 'lob' | 'trap' | 'tackle' | 'slide' | 'dive' | 'catch' | 'celebrate' | 'skill';

export function wrapAngle(angle: number) {
  if (!Number.isFinite(angle)) return 0;
  let a = (angle + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function approachAngle(current: number, target: number, rate: number, dt: number, maxSpeed = Infinity) {
  const delta = wrapAngle(target - current);
  let step = delta * (1 - Math.exp(-rate * Math.max(0, dt)));
  const cap = maxSpeed * Math.max(0, dt);
  if (step > cap) step = cap;
  else if (step < -cap) step = -cap;
  return wrapAngle(current + step);
}

export function gaitCycleLength(speed: number) {
  const s = Math.max(0, speed);
  return s >= 1 ? 1.1 + 0.4 * s : 1.5 * Math.sqrt(s);
}

export function gaitPhaseRate(speed: number) {
  if (!(speed > 0)) return 0;
  return TAU * speed / gaitCycleLength(speed);
}

export function strideAmplitude(speed: number, legLength: number) {
  if (!(speed > 0) || !(legLength > 0)) return 0;
  return Math.min(0.8, gaitCycleLength(speed) / (TAU * legLength));
}

export function preferredFoot(id: number): Foot {
  return (id * 7 + 3) % 5 === 0 ? 'l' : 'r';
}

export function kickingFoot(facing: number, dirX: number, dirZ: number, preferred: Foot = 'r'): Foot {
  if (Math.hypot(dirX, dirZ) < 1e-6) return preferred;
  const rel = wrapAngle(Math.atan2(dirX, dirZ) - facing);
  if (preferred === 'r') return rel < -0.6 ? 'l' : 'r';
  return rel > 0.6 ? 'r' : 'l';
}

export function bodyFrameVelocity(yaw: number, vx: number, vz: number, out: { forward: number; side: number }) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  out.forward = vx * s + vz * c;
  out.side = vx * c - vz * s;
  return out;
}

export function legVerticalReach(hipPitch: number, knee: number, thighLength: number, shinLength: number) {
  return thighLength * Math.cos(hipPitch) + shinLength * Math.cos(hipPitch + knee);
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dampTo = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

const BONE_NAMES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'] as const;
const PELVIS = 0, SPINE1 = 1, SPINE2 = 2, SPINE3 = 3, NECK = 4, HEAD = 5, CLAV = [6, 7], ARM = [8, 9], FORE = [10, 11], THIGH = [14, 15], CALF = [16, 17], FOOT = [18, 19];
const BONES = BONE_NAMES.length;
const FIG = BONES * 3;
const FX = FIG, FY = FIG + 1, FZ = FIG + 2, FPITCH = FIG + 3, FROLL = FIG + 4, FFREE = FIG + 5, FHEIGHT = FIG + 6;
const CHANNELS = FIG + 7;
const L = 0, R = 1;
const SIDE = [1, -1];
const RELAXED_ARM = 0.58;

type RigBone = { bone: T.Bone; pre: T.Quaternion; post: T.Quaternion; hinge: T.Vector3 | null; bindFlex: number };

export type SoccerAnimator = {
  figure: T.Group;
  rig: (RigBone | null)[];
  bound: boolean;
  thigh: number; shin: number; hip: number;
  base: Float32Array; pose: Float32Array; keyA: Float32Array; keyB: Float32Array;
  q: T.Quaternion; e: T.Euler; frame: { forward: number; side: number };
  phase: number; prevVx: number; prevVz: number; accForward: number; accSide: number;
  jockey: number; keeper: number; lookYaw: number; lookPitch: number; charge: number;
  clip: SoccerClip | null; clipTime: number; clipDuration: number; clipSide: number; clipPower: number;
  seed: number; foot: Foot;
};

export type SoccerAnimationInput = {
  vx: number; vz: number; yaw: number; scale: number; time: number;
  carrying: boolean; jockey: boolean; keeperSet: boolean;
  lookX: number; lookY: number; lookZ: number;
  charge: number | null;
};

export function createSoccerAnimationInput(): SoccerAnimationInput {
  return { vx: 0, vz: 0, yaw: 0, scale: 1, time: 0, carrying: false, jockey: false, keeperSet: false, lookX: 0, lookY: 0, lookZ: 1, charge: null };
}

export function createSoccerAnimator(THREE: Three, seed: number, foot: Foot): SoccerAnimator {
  return {
    figure: new THREE.Group(), rig: [], bound: false, thigh: 0.48, shin: 0.45, hip: 1,
    base: new Float32Array(CHANNELS), pose: new Float32Array(CHANNELS), keyA: new Float32Array(CHANNELS), keyB: new Float32Array(CHANNELS),
    q: new THREE.Quaternion(), e: new THREE.Euler(), frame: { forward: 0, side: 0 },
    phase: seed * 1.7 % TAU, prevVx: 0, prevVz: 0, accForward: 0, accSide: 0, jockey: 0, keeper: 0, lookYaw: 0, lookPitch: 0, charge: 0,
    clip: null, clipTime: 0, clipDuration: 0, clipSide: 1, clipPower: 0.5, seed, foot,
  };
}

export function bindSoccerRig(THREE: Three, anim: SoccerAnimator, body: T.Object3D) {
  anim.figure.add(body);
  anim.figure.updateMatrixWorld(true);
  const figureInverse = anim.figure.matrixWorld.clone().invert();
  const figureQuat = anim.figure.getWorldQuaternion(new THREE.Quaternion()).invert();
  const relQuat = (object: T.Object3D) => figureQuat.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion()));
  const relPos = (object: T.Object3D) => object.getWorldPosition(new THREE.Vector3()).applyMatrix4(figureInverse);
  const byName = new Map<string, T.Bone>();
  body.traverse((object) => { if ((object as T.Bone).isBone) byName.set(object.name, object as T.Bone); });
  anim.rig = BONE_NAMES.map((name) => {
    const bone = byName.get(name);
    if (!bone || !bone.parent) return null;
    return { bone, pre: relQuat(bone.parent).invert(), post: relQuat(bone), hinge: null, bindFlex: 0 };
  });
  for (const side of [L, R]) {
    const upper = byName.get(BONE_NAMES[ARM[side]!]!), fore = byName.get(BONE_NAMES[FORE[side]!]!), hand = byName.get(BONE_NAMES[FORE[side]! + 2]!);
    const rig = anim.rig[FORE[side]!];
    if (!upper || !fore || !hand || !rig) continue;
    const u = relPos(fore).sub(relPos(upper)).normalize();
    const f = relPos(hand).sub(relPos(fore)).normalize();
    const hinge = new THREE.Vector3().crossVectors(u, f);
    if (hinge.lengthSq() < 1e-6) hinge.set(-1, 0, 0);
    rig.hinge = hinge.normalize();
    rig.bindFlex = Math.acos(clamp(u.dot(f), -1, 1));
  }
  const thigh = byName.get('thigh_l'), calf = byName.get('calf_l'), ankle = byName.get('foot_l');
  if (thigh && calf && ankle) {
    anim.thigh = relPos(calf).distanceTo(relPos(thigh));
    anim.shin = relPos(ankle).distanceTo(relPos(calf));
    anim.hip = relPos(thigh).y;
  }
  anim.bound = true;
}

export function playSoccerClip(anim: SoccerAnimator, clip: SoccerClip, side = 1, power = 0.5) {
  const durations: Record<SoccerClip, number> = { pass: 0.46, shot: 0.62, lob: 0.56, trap: 0.4, tackle: 0.42, slide: 0.88, dive: 1.15, catch: 0.62, celebrate: 2.6, skill: 0.44 };
  anim.clip = clip;
  anim.clipTime = 0;
  anim.clipDuration = durations[clip];
  anim.clipSide = side >= 0 ? 1 : -1;
  anim.clipPower = clamp(power, 0, 1);
}

export function soccerClipActive(anim: SoccerAnimator) {
  return anim.clip !== null && anim.clipTime < anim.clipDuration;
}

function put(p: Float32Array, bone: number, x: number, y = 0, z = 0) {
  const i = bone * 3; p[i] = x; p[i + 1] = y; p[i + 2] = z;
}
function add(p: Float32Array, bone: number, x: number, y = 0, z = 0) {
  const i = bone * 3; p[i]! += x; p[i + 1]! += y; p[i + 2]! += z;
}
function arm(p: Float32Array, side: number, swing: number, abduct: number, flex: number) {
  put(p, ARM[side]!, swing, 0, SIDE[side]! * (abduct - RELAXED_ARM));
  put(p, FORE[side]!, flex);
}
function blendInto(out: Float32Array, a: Float32Array, b: Float32Array, t: number) {
  for (let i = 0; i < CHANNELS; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
}

function locomotion(anim: SoccerAnimator, input: SoccerAnimationInput, speed: number, dt: number) {
  const p = anim.base;
  p.fill(0);
  const { forward, side } = anim.frame;
  const move = smooth(0.05, 0.9, speed);
  const run = smooth(0.8, 7.5, speed);
  const sag = speed > 0.05 ? forward / speed : 1;
  const lat = speed > 0.05 ? side / speed : 0;
  const A = strideAmplitude(speed, (anim.thigh + anim.shin) * input.scale);
  const s = Math.sin(anim.phase), c = Math.cos(anim.phase);
  const swing = [Math.max(0, c), Math.max(0, -c)];
  const stance = [Math.max(0, -c), Math.max(0, c)];
  const idle = 1 - move;
  const t = input.time + anim.seed * 3.1;
  const breath = Math.sin(t * 1.7) * 0.018;
  const shift = Math.sin(t * 0.42);
  const kneeSwing = mix(0.55, 1.8, run) * (sag < -0.3 ? 0.55 : 1);
  for (const leg of [L, R]) {
    const sign = leg === L ? -1 : 1;
    const hipDrive = -0.38 * run * swing[leg]! * Math.max(0, sag);
    put(p, THIGH[leg]!, sign * A * s * sag + hipDrive - 0.04 * run, 0, SIDE[leg]! * 0.03 + sign * -A * s * lat * 0.85);
    const unloaded = leg === L ? Math.max(0, shift) : Math.max(0, -shift);
    put(p, CALF[leg]!, 0.06 + move * (kneeSwing * swing[leg]! + mix(0.1, 0.42, run) * stance[leg]!) + idle * 0.16 * unloaded);
  }
  put(p, PELVIS, 0.04 * run, -0.14 * run * s * sag, idle * 0.035 * shift);
  put(p, SPINE1, 0.03 + 0.14 * run * Math.max(0, sag), 0, 0);
  put(p, SPINE2, breath + 0.03 * run, 0.12 * run * s * sag, 0);
  put(p, CLAV[L]!, 0, 0, breath * 0.8);
  put(p, CLAV[R]!, 0, 0, -breath * 0.8);
  const armAmp = move * mix(0.22, 0.85, run);
  const flex = mix(0.32, mix(1.2, 1.55, run), move);
  arm(p, L, armAmp * s * sag + 0.04, 0.1 + 0.08 * run + 0.25 * Math.abs(lat) * move, flex - 0.22 * run * s * sag);
  arm(p, R, -armAmp * s * sag + 0.04, 0.1 + 0.08 * run + 0.25 * Math.abs(lat) * move, flex + 0.22 * run * s * sag);
  anim.jockey = dampTo(anim.jockey, input.jockey ? 1 : 0, 6, dt);
  anim.keeper = dampTo(anim.keeper, input.keeperSet ? 1 : 0, 5, dt);
  const j = anim.jockey * (1 - anim.keeper), k = anim.keeper;
  for (const leg of [L, R]) {
    add(p, THIGH[leg]!, -0.32 * j - 0.42 * k, 0, SIDE[leg]! * (0.08 * j + 0.16 * k));
    add(p, CALF[leg]!, 0.55 * j + 0.8 * k);
    add(p, ARM[leg]!, -0.22 * j - 0.55 * k, 0, SIDE[leg]! * (0.22 * j + 0.45 * k));
    add(p, FORE[leg]!, 0.35 * j + 0.55 * k);
  }
  add(p, SPINE1, 0.2 * j + 0.3 * k);
  const charge = input.charge;
  anim.charge = charge === null ? 0 : dampTo(anim.charge, clamp(charge, 0, 1), 14, dt);
  if (anim.charge > 0.01 && input.carrying) {
    anim.keyA.set(p);
    kickKey(anim.keyA, 0, anim.foot === 'l' ? 1 : -1, 0.6 + 0.4 * anim.charge, false);
    blendInto(p, p, anim.keyA, Math.min(0.85, anim.charge));
  }
  look(anim, p);
  p[FPITCH] = clamp(anim.accForward * 0.012, -0.08, 0.13) + 0.05 * run * Math.max(0, sag);
  p[FROLL] = clamp(-anim.accSide * 0.016, -0.2, 0.2);
  p[FX] = idle * 0.025 * shift;
  p[FY] = move * run * run * 0.05 * s * s;
}

function look(anim: SoccerAnimator, p: Float32Array) {
  const yaw = anim.lookYaw, pitch = anim.lookPitch;
  add(p, SPINE3, 0, 0.15 * yaw, 0);
  add(p, NECK, 0.3 * pitch, 0.3 * yaw, 0);
  add(p, HEAD, 0.55 * pitch, 0.45 * yaw, 0);
}

function kickKey(p: Float32Array, stage: number, sK: number, power: number, lob: boolean) {
  const K = sK > 0 ? L : R, O = K === L ? R : L;
  if (stage === 0) {
    put(p, THIGH[K]!, 0.35 + 0.35 * power, 0, 0);
    put(p, CALF[K]!, 1.5);
    put(p, FOOT[K]!, 0.5);
    put(p, THIGH[O]!, -0.22, 0, SIDE[O]! * 0.05);
    put(p, CALF[O]!, 0.45);
    put(p, PELVIS, 0.06, sK * 0.3, 0);
    put(p, SPINE2, 0.04, -sK * 0.22, 0);
    add(p, SPINE1, 0.08);
  } else if (stage === 1) {
    put(p, THIGH[K]!, -0.45, 0, -SIDE[K]! * 0.1);
    put(p, CALF[K]!, 0.35);
    put(p, FOOT[K]!, 0.45);
    put(p, THIGH[O]!, -0.2, 0, SIDE[O]! * 0.05);
    put(p, CALF[O]!, 0.4);
    put(p, PELVIS, 0.05, 0, 0);
    put(p, SPINE2, 0.02, 0, 0);
    put(p, SPINE1, lob ? -0.06 : 0.22);
  } else {
    put(p, THIGH[K]!, -(0.6 + 0.65 * power), 0, -SIDE[K]! * 0.12);
    put(p, CALF[K]!, 0.2);
    put(p, FOOT[K]!, 0.3);
    put(p, THIGH[O]!, -0.1, 0, SIDE[O]! * 0.05);
    put(p, CALF[O]!, 0.32);
    put(p, PELVIS, 0.02, -sK * 0.3, 0);
    put(p, SPINE2, 0, sK * 0.18, 0);
    put(p, SPINE1, lob ? -0.12 : 0.04);
  }
  arm(p, O, stage === 2 ? -0.35 : 0.25, 1.05, 0.7);
  arm(p, K, stage === 0 ? -0.35 : 0.3, 0.35, 0.9);
}

function clipKey(anim: SoccerAnimator, p: Float32Array, clip: SoccerClip, stage: number, time: number) {
  const sK = anim.clipSide, K = sK > 0 ? L : R, O = K === L ? R : L, pw = anim.clipPower;
  switch (clip) {
    case 'pass': case 'shot': case 'lob':
      kickKey(p, stage, sK, clip === 'pass' ? 0.35 * pw : 0.5 + 0.5 * pw, clip === 'lob');
      break;
    case 'trap':
      put(p, THIGH[K]!, stage === 0 ? -0.55 : -0.18, 0, -SIDE[K]! * 0.15);
      put(p, CALF[K]!, stage === 0 ? 0.85 : 0.4);
      put(p, FOOT[K]!, -0.2, SIDE[K]! * 0.4, 0);
      put(p, CALF[O]!, 0.3);
      arm(p, O, 0, 0.55, 0.6); arm(p, K, 0, 0.4, 0.6);
      add(p, SPINE1, 0.1);
      break;
    case 'tackle':
      put(p, THIGH[K]!, stage === 0 ? -0.5 : -0.95, 0, SIDE[K]! * 0.1);
      put(p, CALF[K]!, 0.15);
      put(p, FOOT[K]!, -0.25);
      put(p, THIGH[O]!, 0.25);
      put(p, CALF[O]!, 0.95);
      put(p, SPINE1, 0.42);
      arm(p, L, -0.2, 0.75, 0.6); arm(p, R, -0.2, 0.75, 0.6);
      p[FPITCH] = 0.08;
      break;
    case 'slide': {
      const pitch = stage === 0 ? -0.35 : -1.05;
      const roll = (stage === 0 ? -0.1 : -0.38) * SIDE[O]!;
      put(p, PELVIS, 0, 0, 0);
      put(p, THIGH[K]!, stage === 0 ? -0.3 : -0.5, 0, -SIDE[K]! * 0.05);
      put(p, CALF[K]!, 0.1);
      put(p, FOOT[K]!, -0.3);
      put(p, THIGH[O]!, -0.15, 0, SIDE[O]! * 0.1);
      put(p, CALF[O]!, stage === 0 ? 1 : 1.85);
      put(p, FOOT[O]!, 0.4);
      put(p, SPINE1, stage === 0 ? 0.2 : 0.4);
      put(p, SPINE2, 0.15);
      put(p, HEAD, 0.35);
      arm(p, O, 0.95, 0.75, 0.25);
      arm(p, K, -0.9, 0.55, 0.8);
      p[FPITCH] = pitch; p[FROLL] = roll; p[FFREE] = stage === 0 ? 0.4 : 1;
      p[FHEIGHT] = 0.16 - anim.hip * Math.cos(pitch) * Math.cos(roll);
      p[FZ] = anim.hip * Math.sin(-pitch) * 0.55;
      break;
    }
    case 'dive': {
      const d = sK;
      if (stage === 0) {
        for (const leg of [L, R]) { put(p, THIGH[leg]!, -0.5, 0, SIDE[leg]! * 0.14); put(p, CALF[leg]!, 0.95); }
        arm(p, L, -0.6, 0.5, 0.8); arm(p, R, -0.6, 0.5, 0.8);
        put(p, SPINE1, 0.35);
      } else {
        const D = d > 0 ? L : R, U = D === L ? R : L;
        const roll = stage === 1 ? 1.3 : 1.45;
        arm(p, D, -0.25, 2.75, 0.12);
        arm(p, U, -0.45, 2.45, 0.25);
        put(p, THIGH[D]!, 0, 0, SIDE[D]! * 0.1);
        put(p, CALF[D]!, 0.15);
        put(p, THIGH[U]!, -0.55, 0, SIDE[U]! * 0.2);
        put(p, CALF[U]!, 0.9);
        put(p, SPINE1, 0.1, 0, -d * 0.12);
        p[FROLL] = -d * roll;
        p[FX] = d * (stage === 1 ? 0.25 : 0.35);
        p[FFREE] = 1;
        p[FHEIGHT] = stage === 1 ? 0.42 : 0.08 + anim.hip * 0.02;
      }
      break;
    }
    case 'catch':
      for (const leg of [L, R]) { put(p, THIGH[leg]!, -0.3, 0, SIDE[leg]! * 0.1); put(p, CALF[leg]!, 0.55); }
      arm(p, L, stage === 0 ? -1.2 : -0.75, 0.32, 1.35); arm(p, R, stage === 0 ? -1.2 : -0.75, 0.32, 1.35);
      put(p, SPINE1, 0.3);
      break;
    case 'celebrate': {
      const variant = Math.floor(anim.seed * 13) % 3;
      if (variant === 0) {
        const hop = Math.abs(Math.sin(time * 6.5));
        arm(p, L, -0.25, 2.7, 0.35); arm(p, R, -0.25, 2.7, 0.35);
        for (const leg of [L, R]) { put(p, THIGH[leg]!, -0.25 * (1 - hop)); put(p, CALF[leg]!, 0.5 * (1 - hop)); }
        put(p, SPINE1, -0.12); put(p, HEAD, -0.3);
        p[FY] = 0.22 * hop;
      } else if (variant === 1) {
        arm(p, R, -2.5 + 0.3 * Math.sin(time * 9), 0.3, 1.4);
        arm(p, L, 0.2, 0.2, 1.1);
        put(p, THIGH[L]!, -0.35); put(p, CALF[L]!, 0.55); put(p, CALF[R]!, 0.3);
        put(p, SPINE1, -0.15); put(p, HEAD, -0.25);
      } else {
        const step = Math.sin(time * 8);
        arm(p, L, 0, 1.5, 0.1); arm(p, R, 0, 1.5, 0.1);
        put(p, THIGH[L]!, -0.35 * Math.max(0, step)); put(p, THIGH[R]!, -0.35 * Math.max(0, -step));
        put(p, CALF[L]!, 0.7 * Math.max(0, step)); put(p, CALF[R]!, 0.7 * Math.max(0, -step));
        p[FROLL] = 0.22 * Math.sin(time * 2.4);
      }
      break;
    }
    case 'skill': {
      const u = Math.sin(Math.PI * clamp(time / 0.36, 0, 1));
      put(p, THIGH[K]!, -0.55 * u, 0, SIDE[K]! * (0.45 * Math.sin(TAU * clamp(time / 0.36, 0, 1))));
      put(p, CALF[K]!, 0.7 * u);
      put(p, CALF[O]!, 0.35);
      put(p, PELVIS, 0, 0, -SIDE[K]! * 0.12 * u);
      arm(p, O, 0, 0.6, 0.6);
      p[FROLL] = -SIDE[O]! * 0.12 * u;
      break;
    }
  }
}

const STAGES: Record<SoccerClip, readonly number[]> = {
  pass: [0, 0.07, 0.24], shot: [0, 0.08, 0.28], lob: [0, 0.08, 0.26], trap: [0, 0.12], tackle: [0, 0.09],
  slide: [0, 0.13], dive: [0, 0.1, 0.42], catch: [0, 0.14], celebrate: [0], skill: [0],
};
const FADE_OUT: Record<SoccerClip, number> = { pass: 0.2, shot: 0.24, lob: 0.22, trap: 0.18, tackle: 0.16, slide: 0.24, dive: 0.32, catch: 0.2, celebrate: 0.35, skill: 0.12 };

export function updateSoccerAnimator(anim: SoccerAnimator, input: SoccerAnimationInput, dt: number) {
  const step = clamp(dt, 0, 0.25);
  const speed = Math.hypot(input.vx, input.vz);
  bodyFrameVelocity(input.yaw, input.vx, input.vz, anim.frame);
  if (step > 0) {
    const ax = (input.vx - anim.prevVx) / step, az = (input.vz - anim.prevVz) / step;
    const s = Math.sin(input.yaw), c = Math.cos(input.yaw);
    anim.accForward = dampTo(anim.accForward, clamp(ax * s + az * c, -30, 30), 6, step);
    anim.accSide = dampTo(anim.accSide, clamp(ax * c - az * s, -30, 30), 6, step);
  }
  anim.prevVx = input.vx; anim.prevVz = input.vz;
  const lateral = speed > 0.05 ? Math.abs(anim.frame.side) / speed : 0;
  anim.phase = (anim.phase + gaitPhaseRate(speed) * (1 + 0.5 * lateral * anim.jockey) * step) % TAU;
  const horizontal = Math.hypot(input.lookX, input.lookZ);
  const lookYaw = horizontal > 0.4 ? clamp(wrapAngle(Math.atan2(input.lookX, input.lookZ) - input.yaw), -1.15, 1.15) : 0;
  const lookPitch = clamp(Math.atan2(1.6 * input.scale - input.lookY, Math.max(0.6, horizontal)) - 0.1, -0.5, 0.6);
  anim.lookYaw = dampTo(anim.lookYaw, lookYaw, 7, step);
  anim.lookPitch = dampTo(anim.lookPitch, lookPitch, 7, step);
  locomotion(anim, input, speed, step);
  const p = anim.pose;
  if (anim.clip && anim.clipTime < anim.clipDuration) {
    anim.clipTime += step;
    const clip = anim.clip, time = anim.clipTime;
    const stages = STAGES[clip];
    let stage = 0;
    while (stage + 1 < stages.length && time >= stages[stage + 1]!) stage++;
    anim.keyA.set(anim.base);
    clipKey(anim, anim.keyA, clip, stage, time);
    if (stage + 1 < stages.length) {
      anim.keyB.set(anim.base);
      clipKey(anim, anim.keyB, clip, stage + 1, time);
      const from = stages[stage]!, to = stages[stage + 1]!;
      blendInto(anim.keyA, anim.keyA, anim.keyB, smooth(0, 1, (time - from) / (to - from)));
    }
    if (clip !== 'slide' && clip !== 'dive' && clip !== 'celebrate') look(anim, anim.keyA);
    const weight = Math.min(clamp(time / 0.05, 0, 1), clamp((anim.clipDuration - time) / FADE_OUT[clip], 0, 1));
    blendInto(p, anim.base, anim.keyA, weight);
    if (time >= anim.clipDuration) anim.clip = null;
  } else {
    anim.clip = null;
    p.set(anim.base);
  }
  plant(anim, p, speed);
  apply(anim, p);
}

function plant(anim: SoccerAnimator, p: Float32Array, speed: number) {
  const pelvis = p[PELVIS * 3]!;
  const reach = [0, 0];
  for (const leg of [L, R]) {
    const hip = pelvis + p[THIGH[leg]! * 3]!;
    const knee = p[CALF[leg]! * 3]!;
    reach[leg] = legVerticalReach(hip, knee, anim.thigh, anim.shin) * Math.cos(p[THIGH[leg]! * 3 + 2]!);
    const flat = -(hip + knee);
    const i = FOOT[leg]! * 3;
    if (p[i] === 0) p[i] = flat;
  }
  const move = smooth(0.05, 0.9, speed);
  const stanceLeft = smooth(-0.3, 0.3, -Math.cos(anim.phase));
  const support = mix(Math.max(reach[L]!, reach[R]!), mix(reach[R]!, reach[L]!, stanceLeft), move * 0.8);
  const grounded = (anim.thigh + anim.shin) - support;
  const free = clamp(p[FFREE]!, 0, 1);
  p[FY] = mix(-grounded + p[FY]!, p[FHEIGHT]!, free);
}

function apply(anim: SoccerAnimator, p: Float32Array) {
  const { q, e } = anim;
  for (let i = 0; i < BONES; i++) {
    const rig = anim.rig[i];
    if (!rig) continue;
    const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
    if (rig.hinge) q.setFromAxisAngle(rig.hinge, x - rig.bindFlex);
    else q.setFromEuler(e.set(x, y, z, 'XYZ'));
    rig.bone.quaternion.copy(rig.pre).multiply(q).multiply(rig.post);
  }
  anim.figure.position.set(p[FX]!, p[FY]!, p[FZ]!);
  anim.figure.rotation.set(p[FPITCH]!, 0, p[FROLL]!);
}

export function soccerDribbleOffset(anim: SoccerAnimator, speed: number) {
  const touch = anim.foot === 'l' ? Math.PI / 2 : Math.PI * 1.5;
  let u = (anim.phase - touch) / TAU;
  u -= Math.floor(u);
  const amp = 0.14 * smooth(0.8, 4, speed);
  return u < 0.12 ? -amp + 2 * amp * smooth(0, 0.12, u) : amp - 2 * amp * smooth(0.12, 1, u);
}

export function soccerLegPhase(anim: SoccerAnimator) {
  return anim.phase;
}
