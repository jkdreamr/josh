import type * as T from 'three';

type Three = typeof import('three');

export const TAU = Math.PI * 2;
export type Foot = 'l' | 'r';
export type SoccerClip = 'pass' | 'shot' | 'lob' | 'trap' | 'tackle' | 'slide' | 'dive' | 'catch' | 'celebrate' | 'skill' | 'plant' | 'touch';

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
  const cadence = 1.8 + 0.15 * smooth(0, 1, s) + 1.45 * smooth(1, 7, s) + 0.8 * smooth(7, 9, s);
  return 2 * s / cadence;
}

export const SOCCER_TOE_LENGTH = 0.18;

function gaitHeight(speed: number, length: number) {
  return length * 0.99 - 0.055 * smooth(0, 0.9, speed) - 0.04 * smooth(7, 9, speed);
}

function toePitch(speed: number, u: number, duty: number) {
  return smooth(1, 4, speed) * (0.45 + 0.1 * smooth(0, 0.25, u / duty) + 0.25 * smooth(0.65, 1, u / duty));
}

export function gaitDutyFactor(speed: number, legLength = 0.93, scale = 1, sole = 0) {
  const pitch = toePitch(speed, 0, 1), toe = SOCCER_TOE_LENGTH * scale;
  const vertical = gaitHeight(speed, legLength) + 0.001 + sole * (1 - Math.cos(pitch)) - toe * Math.sin(pitch);
  const reach = legLength * (0.995 - 0.025 * smooth(1, 4, speed));
  const halfTravel = Math.max(0, Math.sqrt(Math.max(0, reach * reach - vertical * vertical)) - toe * (1 - Math.cos(pitch)) - sole * Math.sin(pitch));
  const nominal = mix(0.62, 0.29, smooth(1, 5, speed)) - 0.09 * smooth(5, 9, speed);
  return speed > 0 ? Math.min(nominal, 2 * halfTravel / gaitCycleLength(speed)) : 0.62;
}

export function soccerTouchPhase(foot: Foot) { return foot === 'l' ? 0 : Math.PI; }

/** Angles for a downward bind-pose leg; target coordinates are relative to its hip. */
export function solveSoccerLeg(x: number, y: number, z: number, thigh: number, shin: number, out: Float32Array, offset = 0) {
  const d = clamp(Math.hypot(x, y, z), Math.abs(thigh - shin) + 1e-5, 0.995 * (thigh + shin));
  const vertical = Math.hypot(x, y);
  const knee = Math.acos(clamp((d * d - thigh * thigh - shin * shin) / (2 * thigh * shin), -1, 1));
  out[offset] = Math.atan2(-z, vertical) - Math.atan2(shin * Math.sin(knee), thigh + shin * Math.cos(knee));
  out[offset + 1] = knee;
  out[offset + 2] = Math.atan2(x, -y);
}

export function soccerFootTarget(phase: number, speed: number, forward: number, side: number, out: Float32Array, legLength = 0.93, scale = 1, sole = 0) {
  const u = ((phase / TAU) % 1 + 1) % 1, duty = gaitDutyFactor(speed, legLength, scale, sole);
  const travel = gaitCycleLength(speed) * duty;
  const swing = clamp((u - duty) / (1 - duty), 0, 1);
  const recovery = swing < 0.5 ? 0.42 * smooth(3, 7, speed) * Math.sin(TAU * swing) ** 2 : 0;
  const along = u < duty ? travel * (0.5 - u / duty) : travel * (-0.5 + smooth(0, 1, swing)) - recovery;
  out[0] = speed > 0 ? along * side / speed : 0;
  out[1] = u < duty ? 0 : smooth(0.05, 0.9, speed) * (0.035 + 0.22 * smooth(0, 9, speed)) * Math.sin(Math.PI * swing) ** 2;
  out[2] = speed > 0 ? along * forward / speed : 0;
}

export function soccerFootPitch(phase: number, speed: number, duty = gaitDutyFactor(speed)) {
  const u = ((phase / TAU) % 1 + 1) % 1;
  if (u < duty) return toePitch(speed, u, duty);
  return mix(toePitch(speed, duty, duty), toePitch(speed, 0, duty), smooth(0, 1, (u - duty) / (1 - duty)));
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
const LEGS = [L, R] as const;
const SIDE = [1, -1];
const RELAXED_ARM = 0.58;

type RigBone = { bone: T.Bone; pre: T.Quaternion; post: T.Quaternion; hinge: T.Vector3 | null; bindFlex: number };

export type SoccerAnimator = {
  figure: T.Group;
  rig: (RigBone | null)[];
  bound: boolean;
  thigh: number; shin: number; hip: number;
  sole: number; hips: T.Vector3[]; pelvisOrigin: T.Vector3; fk: T.Vector3; fkOffset: T.Vector3; fkQ: T.Quaternion; pelvisQ: T.Quaternion; figureQ: T.Quaternion;
  base: Float32Array; pose: Float32Array; keyA: Float32Array; keyB: Float32Array;
  q: T.Quaternion; legQ: T.Quaternion; e: T.Euler; frame: { forward: number; side: number };
  phase: number; prevVx: number; prevVz: number; accForward: number; accSide: number;
  jockey: number; keeper: number; lookYaw: number; lookPitch: number; charge: number;
  clip: SoccerClip | null; clipTime: number; clipDuration: number; clipSide: number; clipPower: number; clipCharged: boolean;
  seed: number; foot: Foot;
  last: Float32Array; transition: Float32Array; target: Float32Array; ik: Float32Array;
  blendTime: number; initialized: boolean; wasPlanting: boolean; prevYaw: number; turn: number;
};

export type SoccerAnimationInput = {
  vx: number; vz: number; yaw: number; scale: number; time: number;
  carrying: boolean; jockey: boolean; keeperSet: boolean; planting: boolean;
  lookX: number; lookY: number; lookZ: number;
  charge: number | null;
  chargeClip?: 'pass' | 'shot' | 'lob';
};

export function createSoccerAnimationInput(): SoccerAnimationInput {
  return { vx: 0, vz: 0, yaw: 0, scale: 1, time: 0, carrying: false, jockey: false, keeperSet: false, planting: false, lookX: 0, lookY: 0, lookZ: 1, charge: null };
}

export function createSoccerAnimator(THREE: Three, seed: number, foot: Foot): SoccerAnimator {
  return {
    figure: new THREE.Group(), rig: [], bound: false, thigh: 0.48, shin: 0.45, hip: 1,
    sole: 0, hips: [new THREE.Vector3(), new THREE.Vector3()], pelvisOrigin: new THREE.Vector3(), fk: new THREE.Vector3(), fkOffset: new THREE.Vector3(), fkQ: new THREE.Quaternion(), pelvisQ: new THREE.Quaternion(), figureQ: new THREE.Quaternion(),
    base: new Float32Array(CHANNELS), pose: new Float32Array(CHANNELS), keyA: new Float32Array(CHANNELS), keyB: new Float32Array(CHANNELS),
    q: new THREE.Quaternion(), legQ: new THREE.Quaternion(), e: new THREE.Euler(), frame: { forward: 0, side: 0 },
    phase: seed * 1.7 % TAU, prevVx: 0, prevVz: 0, accForward: 0, accSide: 0, jockey: 0, keeper: 0, lookYaw: 0, lookPitch: 0, charge: 0,
    clip: null, clipTime: 0, clipDuration: 0, clipSide: 1, clipPower: 0.5, clipCharged: false, seed, foot,
    last: new Float32Array(CHANNELS), transition: new Float32Array(CHANNELS), target: new Float32Array(3), ik: new Float32Array(3), blendTime: 0.12, initialized: false, wasPlanting: false, prevYaw: 0, turn: 0,
  };
}

export function bindSoccerRig(THREE: Three, anim: SoccerAnimator, body: T.Object3D) {
  anim.figure.add(body);
  anim.figure.updateWorldMatrix(true, true);
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
  for (const side of LEGS) {
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
    anim.sole = Math.max(0, relPos(ankle).y);
  }
  const pelvis = byName.get('pelvis');
  if (pelvis) anim.pelvisOrigin.copy(relPos(pelvis));
  const down = new THREE.Vector3(0, -1, 0);
  for (const side of LEGS) {
    const upper = anim.rig[THIGH[side]!], lower = anim.rig[CALF[side]!], foot = anim.rig[FOOT[side]!];
    if (!upper || !lower || !foot) continue;
    anim.hips[side]!.copy(relPos(upper.bone)).sub(anim.pelvisOrigin);
    const upperBasis = new THREE.Quaternion().setFromUnitVectors(relPos(lower.bone).sub(relPos(upper.bone)).normalize(), down).multiply(relQuat(upper.bone));
    const lowerBasis = new THREE.Quaternion().setFromUnitVectors(relPos(foot.bone).sub(relPos(lower.bone)).normalize(), down).multiply(relQuat(lower.bone));
    upper.post.copy(upperBasis);
    lower.pre.copy(upperBasis).invert(); lower.post.copy(lowerBasis);
    foot.pre.copy(lowerBasis).invert();
  }
  anim.bound = true;
}

export const SOCCER_CLIP_CONTACT = { pass: 0.07, shot: 0.08, lob: 0.08, touch: 0.08, tackle: 0.09, skill: 0.18 } as const;

export function kickClipStartTime(clip: SoccerClip, charged: boolean) {
  // Called at the authoritative event; visible contact trails by at most two charged or three uncharged frames, without delaying the ball.
  const contact = clip in SOCCER_CLIP_CONTACT ? SOCCER_CLIP_CONTACT[clip as keyof typeof SOCCER_CLIP_CONTACT] : 0;
  const kick = clip === 'pass' || clip === 'shot' || clip === 'lob';
  return Math.max(0, contact - (kick ? charged ? 2 : 3 : charged ? 0 : 2) / 60);
}

export function playSoccerClip(anim: SoccerAnimator, clip: SoccerClip, side = 1, power = 0.5, startAt = 0) {
  const durations: Record<SoccerClip, number> = { pass: 0.58, shot: 0.78, lob: 0.78, trap: 0.4, tackle: 0.42, slide: 1.5, dive: 1.7, catch: 1.2, celebrate: 2.6, skill: 0.44, plant: 0.4, touch: 0.25 };
  anim.transition.set(anim.last); anim.blendTime = 0;
  anim.clip = clip;
  anim.clipTime = Number.isFinite(startAt) ? clamp(startAt, 0, durations[clip]) : 0;
  anim.clipDuration = durations[clip];
  anim.clipSide = side >= 0 ? 1 : -1;
  anim.clipPower = clamp(power, 0, 1);
  anim.clipCharged = anim.charge > 0.2;
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
  const s = Math.sin(anim.phase);
  const idle = 1 - move;
  const t = input.time + anim.seed * 3.1;
  const breath = Math.sin(t * 1.7) * 0.018;
  const shift = Math.sin(t * 0.42);
  const scale = Math.max(0.01, input.scale);
  const length = (anim.thigh + anim.shin) * scale;
  const duty = gaitDutyFactor(speed, length, scale, anim.sole * scale);
  const halfPhase = ((anim.phase / TAU) % 0.5 + 0.5) % 0.5;
  const flight = duty < 0.5 && halfPhase > duty ? Math.sin(Math.PI * (halfPhase - duty) / (0.5 - duty)) ** 2 : 0;
  const height = gaitHeight(speed, length) + anim.sole * scale + 0.025 * run * flight;
  p[FY] = (height - anim.hip * scale) / scale;
  for (const leg of LEGS) {
    const phase = anim.phase + leg * Math.PI;
    soccerFootTarget(phase, speed, forward, side, anim.target, length, scale, anim.sole * scale);
    const pitch = soccerFootPitch(phase, speed, duty);
    const toe = SOCCER_TOE_LENGTH * scale;
    anim.target[1]! += toe * Math.sin(pitch) + anim.sole * scale * Math.cos(pitch);
    anim.target[2]! += toe * (1 - Math.cos(pitch)) + anim.sole * scale * Math.sin(pitch);
    const u = ((phase / TAU) % 1 + 1) % 1;
    if (u >= duty) {
      const reach = length * 0.97;
      const horizontalSq = anim.target[0]! ** 2 + anim.target[2]! ** 2;
      const foldedSq = (anim.thigh ** 2 + anim.shin ** 2 + 2 * anim.thigh * anim.shin * Math.cos(1.2)) * scale * scale;
      const soleHeight = toe * Math.sin(pitch) + anim.sole * scale * Math.cos(pitch);
      anim.target[1] = Math.max(soleHeight, Math.min(anim.target[1]!, height - Math.sqrt(Math.max(0, foldedSq - horizontalSq))));
      anim.target[1] = Math.max(anim.target[1]!, height - Math.sqrt(Math.max(0, reach * reach - horizontalSq)));
    }
    solveSoccerLeg(anim.target[0]!, -height + anim.target[1]!, anim.target[2]!, anim.thigh * scale, anim.shin * scale, anim.ik);
    put(p, THIGH[leg]!, anim.ik[0]!, 0, anim.ik[2]!);
    put(p, CALF[leg]!, anim.ik[1]!);
    put(p, FOOT[leg]!, -anim.ik[0]! - anim.ik[1]! + pitch, 0, -anim.ik[2]!);
  }
  put(p, PELVIS, 0, 0, 0);
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
  for (const leg of LEGS) {
    add(p, ARM[leg]!, -0.22 * j - 0.55 * k, 0, SIDE[leg]! * (0.22 * j + 0.45 * k));
    add(p, FORE[leg]!, 0.35 * j + 0.55 * k);
  }
  add(p, SPINE1, 0.2 * j + 0.3 * k);
  const charge = input.charge;
  anim.charge = charge === null ? 0 : dampTo(anim.charge, clamp(charge, 0, 1), 14, dt);
  if (anim.charge > 0.01 && input.carrying) {
    anim.keyA.set(p);
    kickKey(anim, anim.keyA, 0, anim.foot === 'l' ? 1 : -1, 0.6 + 0.4 * anim.charge, input.chargeClip === 'lob', input.chargeClip === 'pass');
    blendInto(p, p, anim.keyA, smooth(0, 0.7, anim.charge));
  }
  look(anim, p);
  add(p, SPINE1, clamp(anim.accForward * 0.012, -0.08, 0.13));
  add(p, SPINE2, 0, 0, anim.turn);
  add(p, HEAD, 0, -anim.turn * 0.5);
  add(p, SPINE1, 0, 0, idle * 0.025 * shift);
}

function look(anim: SoccerAnimator, p: Float32Array) {
  const yaw = anim.lookYaw, pitch = anim.lookPitch;
  add(p, SPINE3, 0, 0.15 * yaw, 0);
  add(p, NECK, 0.3 * pitch, 0.3 * yaw, 0);
  add(p, HEAD, 0.55 * pitch, 0.45 * yaw, 0);
}

function kickKey(anim: SoccerAnimator, p: Float32Array, stage: number, sK: number, power: number, lob: boolean, pass = false) {
  const K = sK > 0 ? L : R, O = K === L ? R : L;
  if (stage === 0) {
    kickKey(anim, p, 1, sK, power, lob, pass);
    put(p, THIGH[K]!, (pass ? 0.4 : 1) * (0.2 + 0.2 * power), pass ? SIDE[K]! * 0.18 : 0);
    put(p, CALF[K]!, pass ? 0.75 : 1.57 + 0.25 * power);
    put(p, FOOT[K]!, 0.05, pass ? SIDE[K]! * 0.9 : 0);
    put(p, SPINE2, 0.04, -sK * 0.22, 0);
    put(p, SPINE1, 0.18);
  } else if (stage === 1) {
    const height = (anim.thigh + anim.shin) * 0.94 + anim.sole;
    const yaw = pass ? SIDE[K]! * 0.9 : 0;
    solveSoccerLeg(-anim.hips[K]!.x - SOCCER_TOE_LENGTH * Math.sin(yaw), anim.sole + (pass ? 0.13 : 0.07) - height, (pass ? 0.4 : 0.36) - SOCCER_TOE_LENGTH * Math.cos(yaw), anim.thigh, anim.shin, anim.ik);
    put(p, THIGH[K]!, anim.ik[0]!, pass ? SIDE[K]! * 0.18 : 0, anim.ik[2]!);
    put(p, CALF[K]!, anim.ik[1]!);
    put(p, FOOT[K]!, -anim.ik[0]! - anim.ik[1]!, yaw);
    solveSoccerLeg(0, anim.sole - height, 0.18, anim.thigh, anim.shin, anim.ik);
    put(p, THIGH[O]!, anim.ik[0]!);
    put(p, CALF[O]!, anim.ik[1]!);
    put(p, FOOT[O]!, -anim.ik[0]! - anim.ik[1]!);
    put(p, PELVIS, 0, 0, 0);
    p[FY] = height - anim.hip;
    put(p, SPINE2, 0.02, 0, 0);
    put(p, SPINE1, lob ? -0.06 : 0.22);
  } else {
    put(p, THIGH[K]!, pass ? -0.5 : -(0.6 + 0.95 * power), 0, -SIDE[K]! * 0.12);
    put(p, CALF[K]!, 0.2);
    put(p, FOOT[K]!, pass ? 0 : lob ? -0.25 : 0.3, pass ? SIDE[K]! * 0.9 : 0);
    put(p, THIGH[O]!, -0.1, 0, SIDE[O]! * 0.05);
    put(p, CALF[O]!, 0.32);
    put(p, PELVIS, 0.02, -sK * 0.3, 0);
    put(p, SPINE2, 0, sK * 0.18, 0);
    put(p, SPINE1, lob ? -0.28 : 0.28);
  }
  arm(p, O, stage === 2 ? -0.35 : 0.25, 1.05, 0.7);
  arm(p, K, stage === 0 ? -0.35 : 0.3, pass ? 0.35 : 0.9, 0.9);
}

function clipKey(anim: SoccerAnimator, p: Float32Array, clip: SoccerClip, stage: number, time: number) {
  const sK = anim.clipSide, K = sK > 0 ? L : R, O = K === L ? R : L, pw = anim.clipPower;
  switch (clip) {
    case 'pass': case 'shot': case 'lob':
      kickKey(anim, p, stage, sK, pw, clip === 'lob', clip === 'pass');
      if (stage === 0 && !anim.clipCharged) {
        put(p, THIGH[K]!, clip === 'pass' ? 0.06 : 0.14, clip === 'pass' ? SIDE[K]! * 0.18 : 0);
        put(p, CALF[K]!, clip === 'pass' ? 0.65 : 1);
      }
      if (clip === 'lob') { if (stage !== 1) put(p, FOOT[K]!, stage === 0 ? 0.45 : -0.45); put(p, SPINE1, -0.18); }
      break;
    case 'touch':
      add(p, THIGH[K]!, stage === 0 ? 0.12 : -0.25);
      add(p, CALF[K]!, stage === 0 ? 0.18 : -0.1);
      put(p, FOOT[K]!, stage === 0 ? -0.2 : 0.4);
      break;
    case 'plant':
      put(p, THIGH[K]!, -0.45, 0, SIDE[K]! * 0.16);
      put(p, CALF[K]!, 0.85);
      put(p, SPINE1, -0.25);
      put(p, PELVIS, 0, stage === 0 ? -sK * 0.18 : sK * 0.35);
      arm(p, O, -0.25, 0.9, 0.8);
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
      if (stage >= 4) break;
      if (stage === 0 || stage === 3) {
        for (const leg of LEGS) { put(p, THIGH[leg]!, stage === 0 ? -0.65 : -0.1); put(p, CALF[leg]!, stage === 0 ? 1.25 : 1.6); put(p, FOOT[leg]!, stage === 0 ? -0.6 : -1.5); }
        put(p, SPINE1, 0.55);
        arm(p, L, -0.8, 0.45, 0.4); arm(p, R, -0.8, 0.45, 0.4);
        p[FY] = (stage === 0 ? 0.82 : 0.6) - anim.hip;
        break;
      }
      put(p, PELVIS, 0, 0, 0);
      put(p, THIGH[K]!, -1.56);
      put(p, CALF[K]!, 0.1);
      put(p, FOOT[K]!, 1.46);
      put(p, THIGH[O]!, -2.4, 0, SIDE[O]! * 0.1);
      put(p, CALF[O]!, 2.75);
      put(p, FOOT[O]!, -0.35);
      put(p, SPINE1, -0.45);
      put(p, SPINE2, -0.2);
      put(p, HEAD, 0.35);
      arm(p, O, 0.55, 0.35, 0.15);
      arm(p, K, -0.65, 0.7, 0.65);
      p[FY] = 0.15 - anim.pelvisOrigin.y;
      break;
    }
    case 'dive': {
      const d = sK;
      if (stage >= 5) break;
      if (stage === 0 || stage === 4) {
        for (const leg of LEGS) { put(p, THIGH[leg]!, -0.5, 0, SIDE[leg]! * 0.14); put(p, CALF[leg]!, 0.95); }
        if (stage === 4) for (const leg of LEGS) { put(p, THIGH[leg]!, -0.1); put(p, CALF[leg]!, 1.6); put(p, FOOT[leg]!, -1.5); }
        arm(p, L, -0.6, 0.5, 0.8); arm(p, R, -0.6, 0.5, 0.8);
        put(p, SPINE1, stage === 4 ? 0.6 : 0.35);
        if (stage === 4) p[FY] = 0.6 - anim.hip;
      } else {
        const D = d > 0 ? L : R, U = D === L ? R : L;
        const roll = stage === 1 ? 1.3 : 1.45;
        arm(p, D, -0.15, 3.2, 0.12);
        arm(p, U, -0.15, 3.2, 0.12);
        put(p, THIGH[D]!, 0, 0, SIDE[D]! * 0.1);
        put(p, CALF[D]!, 0.15);
        put(p, THIGH[U]!, -0.15, 0, SIDE[U]! * 0.2);
        put(p, CALF[U]!, 0.15);
        put(p, SPINE1, 0.1, 0, -d * 0.12);
        p[FROLL] = -d * roll;
        p[FX] = d * (stage === 1 ? 0.25 : 0.35);
        p[FY] = stage === 1 ? 0.32 : 0.08;
      }
      break;
    }
    case 'catch':
      for (const leg of LEGS) { put(p, THIGH[leg]!, -0.3, 0, SIDE[leg]! * 0.1); put(p, CALF[leg]!, 0.55); }
      arm(p, L, stage === 0 ? -1.35 : -0.45, stage === 0 ? -0.2 : -0.25, stage === 0 ? 0.35 : 1.85);
      arm(p, R, stage === 0 ? -1.35 : -0.45, stage === 0 ? -0.2 : -0.25, stage === 0 ? 0.35 : 1.85);
      put(p, SPINE1, 0.12);
      break;
    case 'celebrate': {
      const variant = Math.floor(anim.seed * 13) % 4;
      if (variant === 0) {
        const hop = Math.abs(Math.sin(time * 6.5));
        arm(p, L, -0.25, 2.7, 0.35); arm(p, R, -0.25, 2.7, 0.35);
        for (const leg of LEGS) { put(p, THIGH[leg]!, -0.25 * (1 - hop)); put(p, CALF[leg]!, 0.5 * (1 - hop)); }
        put(p, SPINE1, -0.12); put(p, HEAD, -0.3);
        p[FY] = 0.22 * hop;
      } else if (variant === 1) {
        arm(p, R, -2.5 + 0.3 * Math.sin(time * 9), 0.3, 1.4);
        arm(p, L, 0.2, 0.2, 1.1);
        put(p, THIGH[L]!, -0.35); put(p, CALF[L]!, 0.55); put(p, CALF[R]!, 0.3);
        put(p, SPINE1, -0.15); put(p, HEAD, -0.25);
      } else if (variant === 2) {
        const step = Math.sin(time * 8);
        arm(p, L, 0, 1.5, 0.1); arm(p, R, 0, 1.5, 0.1);
        put(p, THIGH[L]!, -0.35 * Math.max(0, step)); put(p, THIGH[R]!, -0.35 * Math.max(0, -step));
        put(p, CALF[L]!, 0.7 * Math.max(0, step)); put(p, CALF[R]!, 0.7 * Math.max(0, -step));
        p[FROLL] = 0.22 * Math.sin(time * 2.4);
      } else {
        arm(p, L, 0.1, 1.65, 0.08); arm(p, R, 0.1, 1.65, 0.08);
        put(p, SPINE1, 0.2); put(p, HEAD, -0.15);
        p[FROLL] = 0.12 * Math.sin(time * 3);
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
  pass: [0, 0.07, 0.25], shot: [0, 0.08, 0.3], lob: [0, 0.08, 0.3], trap: [0, 0.12], tackle: [0, 0.09],
  slide: [0, 0.12, 0.85, 1, 1.35], dive: [0, 0.3, 0.55, 0.95, 1.15, 1.55], catch: [0, 0.32], celebrate: [0], skill: [0], plant: [0, 0.2], touch: [0, 0.08],
};
const FADE_OUT: Record<SoccerClip, number> = { pass: 0.2, shot: 0.24, lob: 0.22, trap: 0.18, tackle: 0.16, slide: 0.15, dive: 0.15, catch: 0.2, celebrate: 0.35, skill: 0.12, plant: 0.16, touch: 0.1 };

export function updateSoccerAnimator(anim: SoccerAnimator, input: SoccerAnimationInput, dt: number) {
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
  const speed = Number.isFinite(input.vx + input.vz) ? Math.hypot(input.vx, input.vz) : 0;
  if (dt > 0.08 && anim.initialized) { anim.transition.set(anim.last); anim.blendTime = 0; }
  if (input.planting && !anim.wasPlanting && speed > 3 && !soccerClipActive(anim)) playSoccerClip(anim, 'plant', anim.accSide > 0 ? -1 : 1);
  anim.wasPlanting = input.planting;
  const yawRate = step > 0 && anim.initialized ? wrapAngle(input.yaw - anim.prevYaw) / step : 0;
  anim.prevYaw = input.yaw;
  anim.turn = dampTo(anim.turn, clamp(-(speed * yawRate + anim.accSide) * 0.018, -0.28, 0.28), 7, step);
  bodyFrameVelocity(input.yaw, input.vx, input.vz, anim.frame);
  if (step > 0) {
    const ax = (input.vx - anim.prevVx) / step, az = (input.vz - anim.prevVz) / step;
    const s = Math.sin(input.yaw), c = Math.cos(input.yaw);
    anim.accForward = dampTo(anim.accForward, clamp(ax * s + az * c, -30, 30), 6, step);
    anim.accSide = dampTo(anim.accSide, clamp(ax * c - az * s, -30, 30), 6, step);
  }
  anim.prevVx = input.vx; anim.prevVz = input.vz;
  anim.phase = (anim.phase + gaitPhaseRate(speed) * step) % TAU;
  const horizontal = Math.hypot(input.lookX, input.lookZ);
  const lookYaw = horizontal > 0.4 ? clamp(wrapAngle(Math.atan2(input.lookX, input.lookZ) - input.yaw), -1.15, 1.15) : 0;
  const lookPitch = clamp(Math.atan2(1.6 * input.scale - input.lookY, Math.max(0.6, horizontal)) - 0.1, -0.5, 0.6);
  anim.lookYaw = dampTo(anim.lookYaw, lookYaw, 7, step);
  anim.lookPitch = dampTo(anim.lookPitch, lookPitch, 7, step);
  locomotion(anim, input, speed, step);
  const p = anim.pose;
  const hadClip = soccerClipActive(anim);
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
      const attack = (clip === 'pass' || clip === 'shot' || clip === 'lob') && stage === 0;
      const start = attack ? Math.max(from, to - 2 / 60) : from;
      blendInto(anim.keyA, anim.keyA, anim.keyB, smooth(0, 1, (time - start) / (to - start)));
    }
    if (clip === 'slide' && time >= 0.85) {
      const height = mix(0.15, anim.hip + anim.base[FY]!, smooth(0.85, 1.35, time));
      anim.keyA[FY] = height - anim.hip;
      for (const leg of LEGS) {
        const z = leg === (anim.clipSide > 0 ? L : R) ? mix(0.93, 0, smooth(0.85, 1.1, time)) : mix(0.17, 0, smooth(0.85, 1.35, time));
        solveSoccerLeg(0, anim.sole - height, z, anim.thigh, anim.shin, anim.ik);
        put(anim.keyA, THIGH[leg]!, anim.ik[0]!);
        put(anim.keyA, CALF[leg]!, anim.ik[1]!);
        put(anim.keyA, FOOT[leg]!, -anim.ik[0]! - anim.ik[1]!);
      }
    }
    if (clip !== 'slide' && clip !== 'dive' && clip !== 'celebrate') look(anim, anim.keyA);
    const weight = Math.min(clamp(time / 0.05, 0, 1), clamp((anim.clipDuration - time) / FADE_OUT[clip], 0, 1));
    blendInto(p, anim.base, anim.keyA, weight);
    if (time >= anim.clipDuration) anim.clip = null;
  } else {
    anim.clip = null;
    p.set(anim.base);
  }
  if (hadClip && !anim.clip) { anim.transition.set(anim.last); anim.blendTime = 0; }
  const transitioning = anim.initialized && anim.blendTime < 0.12;
  if (transitioning) {
    anim.blendTime = Math.min(0.12, anim.blendTime + step);
    blendInto(p, anim.transition, p, smooth(0, 0.12, anim.blendTime));
  }
  const kick = anim.clip === 'pass' || anim.clip === 'shot' || anim.clip === 'lob';
  const contact = kick ? SOCCER_CLIP_CONTACT[anim.clip as 'pass' | 'shot' | 'lob'] : -1;
  const kickingLeg = anim.clipSide > 0 ? L : R;
  if (kick) {
    const weight = clamp((anim.clipDuration - anim.clipTime) / FADE_OUT[anim.clip!], 0, 1);
    for (let joint = 0; joint < 3; joint++) {
      const bone = joint === 0 ? THIGH[kickingLeg]! : joint === 1 ? CALF[kickingLeg]! : FOOT[kickingLeg]!;
      for (let axis = bone * 3; axis < bone * 3 + 3; axis++) p[axis] = mix(anim.base[axis]!, anim.keyA[axis]!, weight);
    }
  }
  for (let i = 0; i < CHANNELS; i++) {
    if (!Number.isFinite(p[i])) p[i] = Number.isFinite(anim.last[i]) ? anim.last[i]! : 0;
  }
  if (anim.initialized && (transitioning || hadClip || anim.charge > 0.01 && input.carrying)) {
    for (let i = 0; i < FIG; i += 3) {
      const distance = Math.abs(p[i]! - anim.last[i]!) + Math.abs(p[i + 1]! - anim.last[i + 1]!) + Math.abs(p[i + 2]! - anim.last[i + 2]!);
      // Only the final pre-contact frame and contact frame permit a fast striking leg.
      const striking = kick && anim.clipTime > contact - 2 / 60 + 1e-8 && anim.clipTime <= contact + 1e-8 && (i / 3 === THIGH[kickingLeg] || i / 3 === CALF[kickingLeg] || i / 3 === FOOT[kickingLeg]);
      const weight = Math.min(1, (striking ? 0.6 : 0.24) / Math.max(1e-8, distance));
      for (let axis = i; axis < i + 3; axis++) p[axis] = mix(anim.last[axis]!, p[axis]!, weight);
    }
  }
  plant(anim, p);
  anim.last.set(p); anim.initialized = true;
  apply(anim, p);
}

function plant(anim: SoccerAnimator, p: Float32Array) {
  const { e, q, fk, fkOffset, fkQ, pelvisQ, figureQ } = anim;
  pelvisQ.setFromEuler(e.set(p[0]!, p[1]!, p[2]!));
  figureQ.setFromEuler(e.set(p[FPITCH]!, 0, p[FROLL]!));
  let minimum = Infinity;
  for (const leg of LEGS) {
    if (!anim.rig[THIGH[leg]!]) continue;
    const thigh = THIGH[leg]! * 3, calf = CALF[leg]! * 3, foot = FOOT[leg]! * 3;
    fk.copy(anim.hips[leg]!).applyQuaternion(pelvisQ).add(anim.pelvisOrigin);
    fkQ.copy(pelvisQ).multiply(q.setFromEuler(e.set(p[thigh]!, p[thigh + 1]!, p[thigh + 2]!, 'ZYX')));
    fk.add(fkOffset.set(0, -anim.thigh, 0).applyQuaternion(fkQ));
    fkQ.multiply(q.setFromEuler(e.set(p[calf]!, p[calf + 1]!, p[calf + 2]!, 'XYZ')));
    fk.add(fkOffset.set(0, -anim.shin, 0).applyQuaternion(fkQ));
    const flex = p[thigh]! + p[calf]!;
    fkQ.multiply(q.setFromEuler(e.set(-flex, 0, 0)));
    fkQ.multiply(q.setFromEuler(e.set(0, 0, p[foot + 2]!)));
    fkQ.multiply(q.setFromEuler(e.set(p[foot]! + flex, p[foot + 1]!, 0)));
    for (let point = 0; point < 2; point++) {
      const z = point === 0 ? -0.06 : SOCCER_TOE_LENGTH;
      fkOffset.set(0, -anim.sole, z).applyQuaternion(fkQ).add(fk).applyQuaternion(figureQ);
      minimum = Math.min(minimum, fkOffset.y);
    }
  }
  if (Number.isFinite(minimum)) p[FY] = Math.max(p[FY]!, -minimum);
}

function apply(anim: SoccerAnimator, p: Float32Array) {
  const { q, e } = anim;
  for (let i = 0; i < BONES; i++) {
    const rig = anim.rig[i];
    if (!rig) continue;
    const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
    if (i === FOOT[L] || i === FOOT[R]) {
      const leg = i === FOOT[L] ? L : R;
      const flex = p[THIGH[leg]! * 3]! + p[CALF[leg]! * 3]!;
      q.setFromEuler(e.set(-flex, 0, 0));
      q.multiply(anim.legQ.setFromEuler(e.set(0, 0, z)));
      q.multiply(anim.legQ.setFromEuler(e.set(x + flex, y, 0)));
    } else if (rig.hinge) q.setFromAxisAngle(rig.hinge, x - rig.bindFlex);
    else q.setFromEuler(e.set(x, y, z, i === THIGH[L] || i === THIGH[R] ? 'ZYX' : 'XYZ'));
    rig.bone.quaternion.copy(rig.pre).multiply(q).multiply(rig.post);
  }
  anim.figure.position.set(p[FX]!, p[FY]!, p[FZ]!);
  anim.figure.rotation.set(p[FPITCH]!, 0, p[FROLL]!);
}

export function soccerDribbleOffset(anim: SoccerAnimator, speed: number) {
  const touch = soccerTouchPhase(anim.foot);
  let u = (anim.phase - touch) / TAU;
  u -= Math.floor(u);
  const amp = 0.14 * smooth(0.8, 4, speed);
  return u < 0.12 ? -amp + 2 * amp * smooth(0, 0.12, u) : amp - 2 * amp * smooth(0.12, 1, u);
}

export function soccerLegPhase(anim: SoccerAnimator) {
  return anim.phase;
}
