import { FIELD, teamDir, type Team, type World } from './logic.ts';
import { slewViewBasis, type ViewBasis } from './input.ts';

export type CameraMode = 'broadcast' | 'end' | 'replay' | 'intro' | 'setpiece';
export type Vec3 = { x: number; y: number; z: number };
export type CameraGoal = { position: Vec3; target: Vec3; fov: number };
export type Spring = { value: Vec3; velocity: Vec3 };
export const CAMERA_LIMITS = { speed: 32, acceleration: 96, zoomSpeed: 12, zoomAcceleration: 36 };
const vector = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const spring = (): Spring => ({ value: vector(), velocity: vector() });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function stepSpring(state: Spring, goal: Vec3, dt: number, frequency: number, maxSpeed: number, maxAcceleration: number) {
  let remaining = Math.max(0, Math.min(0.1, dt));
  while (remaining > 1e-9) {
    const h = Math.min(remaining, 1 / 120);
    let ax = frequency ** 2 * (goal.x - state.value.x) - 2 * frequency * state.velocity.x;
    let ay = frequency ** 2 * (goal.y - state.value.y) - 2 * frequency * state.velocity.y;
    let az = frequency ** 2 * (goal.z - state.value.z) - 2 * frequency * state.velocity.z;
    const forceScale = Math.min(1, maxAcceleration / (Math.hypot(ax, ay, az) || 1));
    ax *= forceScale; ay *= forceScale; az *= forceScale;
    const vx = state.velocity.x + ax * h, vy = state.velocity.y + ay * h, vz = state.velocity.z + az * h;
    const speedScale = Math.min(1, maxSpeed / (Math.hypot(vx, vy, vz) || 1));
    state.velocity.x = vx * speedScale;
    state.velocity.y = vy * speedScale;
    state.velocity.z = vz * speedScale;
    state.value.x += state.velocity.x * h;
    state.value.y += state.velocity.y * h;
    state.value.z += state.velocity.z * h;
    remaining -= h;
  }
}

export function createCameraRig() {
  return { ready: false, target: spring(), offset: spring(), zoom: spring(), position: vector() };
}

export function stepCameraRig(rig: ReturnType<typeof createCameraRig>, goal: CameraGoal, dt: number) {
  const offset = vector(goal.position.x - goal.target.x, goal.position.y - goal.target.y, goal.position.z - goal.target.z);
  const zoom = vector(goal.fov);
  if (!rig.ready) {
    Object.assign(rig.target.value, goal.target);
    Object.assign(rig.offset.value, offset);
    Object.assign(rig.zoom.value, zoom);
    rig.ready = true;
  } else {
    // Track one centre plus an offset: broadcast position and look-at translate together, never yaw on a switch.
    stepSpring(rig.target, goal.target, dt, 7, 22, 64);
    stepSpring(rig.offset, offset, dt, 6, 10, 32);
    stepSpring(rig.zoom, zoom, dt, 5, CAMERA_LIMITS.zoomSpeed, CAMERA_LIMITS.zoomAcceleration);
  }
  rig.position.x = rig.target.value.x + rig.offset.value.x;
  rig.position.y = rig.target.value.y + rig.offset.value.y;
  rig.position.z = rig.target.value.z + rig.offset.value.z;
  return rig;
}

export function broadcastGoal(world: World, humanTeam: Team, aspect: number): CameraGoal {
  const player = world.players.find((p) => p.id === world.controlled[humanTeam] && !p.sentOff);
  const dx = (player?.x ?? world.ball.x) - world.ball.x, dz = (player?.z ?? world.ball.z) - world.ball.z;
  const weight = player ? Math.min(0.08, 1.8 / (Math.hypot(dx, dz) || 1)) : 0;
  const leadSpeed = Math.hypot(world.ball.vx, world.ball.vz);
  const lead = Math.min(0.24, 5 / (leadSpeed || 1));
  const dir = teamDir(humanTeam, world.endsSwapped), portrait = aspect < 0.72;
  const target = vector(
    clamp(world.ball.x + world.ball.vx * lead + dx * weight, -FIELD.length / 2 + 3, FIELD.length / 2 - 3) + dir * FIELD.goalWidth * 0.5,
    0.55,
    clamp(world.ball.z + world.ball.vz * lead + dz * weight, -FIELD.width / 2 + 3, FIELD.width / 2 - 3) * 0.55,
  );
  const position = portrait
    ? vector(target.x - dir * FIELD.width * 0.42, target.y + FIELD.width * 0.24, target.z)
    : vector(target.x, target.y + FIELD.width * 0.30, target.z - FIELD.width * 0.68);
  // Widen gradually for a long pass rather than teleporting to keep a distant cursor in frame.
  const spread = Math.min(8, Math.max(0, Math.hypot(dx, dz) - 12) * 0.18);
  return { position, target, fov: (portrait ? 68 : 31) + spread };
}

export function cameraGoal(world: World, humanTeam: Team, aspect: number, mode: CameraMode, introProgress = 1): CameraGoal {
  const goal = broadcastGoal(world, humanTeam, aspect);
  const dir = teamDir(humanTeam, world.endsSwapped), portrait = aspect < 0.72;
  if (mode === 'intro') {
    const p = clamp(introProgress, 0, 1), t = p * p * (3 - 2 * p);
    goal.position.x = -FIELD.length * 0.62 * (1 - t) + goal.position.x * t;
    goal.position.y = 30 * (1 - t) + goal.position.y * t;
    goal.position.z = -FIELD.width * 0.9 * (1 - t) + goal.position.z * t;
    goal.target.x *= t; goal.target.z *= t;
    goal.fov = 50 + (goal.fov - 50) * t;
  } else if (mode === 'replay' || mode === 'end') {
    goal.target = vector(world.ball.x * 0.35 + dir * FIELD.goalWidth * 0.2, 0.55, world.ball.z * 0.22);
    goal.position = mode === 'replay'
      ? vector(world.ball.x - dir * FIELD.goalWidth * 1.1, 5.2, world.ball.z + FIELD.width * 0.2)
      : vector(goal.target.x - dir * FIELD.length * 0.26, FIELD.width * 0.2, goal.target.z);
    goal.fov = mode === 'replay' ? 36 : 28;
  } else if (mode === 'setpiece' && world.setPiece) {
    const piece = world.setPiece, dx = piece.aim.x - world.ball.x, dz = piece.aim.z - world.ball.z;
    const gap = Math.max(0.01, Math.hypot(dx, dz)), penalty = piece.kind === 'penalty', behind = penalty ? 6 : 9;
    goal.target = { ...piece.aim };
    goal.position = vector(world.ball.x - dx / gap * behind, penalty ? 1.9 : 3.5, world.ball.z - dz / gap * behind + (penalty ? 2.4 : 0));
    if (piece.kind === 'corner') {
      goal.position.x = clamp(goal.position.x, -FIELD.length / 2 + 3, FIELD.length / 2 - 3);
      goal.position.z = clamp(goal.position.z, -FIELD.width / 2 + 5, FIELD.width / 2 - 5);
      goal.position.y = 8;
    }
    goal.fov = portrait ? 62 : 42;
  }
  return goal;
}

export function stepCameraBasis(current: ViewBasis, world: World, humanTeam: Team, aspect: number, mode: CameraMode, dt: number): ViewBasis {
  if (mode === 'replay' || mode === 'setpiece') return current;
  const forward = mode === 'end' || aspect < 0.72 ? { x: teamDir(humanTeam, world.endsSwapped), z: 0 } : { x: 0, z: 1 };
  return slewViewBasis(current, { forward, right: { x: -forward.z, z: forward.x } }, dt);
}
