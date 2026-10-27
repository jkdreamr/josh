import { hash, mulberry32 } from './rng.ts';
import { progressOf } from './courses.ts';
import { capsuleOverlapsPose, groundBelow, HEIGHT, RUN_SPEED } from './physics.ts';
import type { Body, Course, Input, Pose, Waypoint } from './types.ts';

export type Brain = {
  id: number;
  skill: number;
  seed: number;
  random: () => number;
  lane: number;
  wander: number;
  wanderT: number;
  hesitation: number;
  jumpCooldown: number;
  diveCooldown: number;
  next: number;
  targetTile: number;
  targetT: number;
  courseId: Course['id'] | null;
  lastProgress: number;
};

type Claim = { owner: number; until: number };
const tileClaims = new WeakMap<Course, Map<number, Claim>>();
type HazardPrediction = { hitAt: number; low: boolean; sideStep: number };
const hazardPose: Pose = { x: 0, y: 0, z: 0, m: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
const hazardResult: HazardPrediction = { hitAt: 0, low: false, sideStep: 0 };
const coconutEscapeLanes = [-3.5, -1.75, 1.75, 3.5] as const;
const LOW_HAZARD_HEIGHT = 1.25;

function colliderRadius(shape: Course['colliders'][number]['shape']): number {
  if (shape.kind === 'sphere') return shape.r;
  if (shape.kind === 'cyl') return Math.hypot(shape.r, shape.hy);
  return Math.hypot(shape.hx, shape.hy, shape.hz);
}

function hazardVerticalExtent(shape: Course['colliders'][number]['shape'], pose: Pose): number {
  const m = pose.m;
  if (shape.kind === 'sphere') return shape.r;
  if (shape.kind === 'cyl') return Math.abs(m[4]) * shape.hy + Math.hypot(m[3], m[5]) * shape.r;
  return Math.abs(m[3]) * shape.hx + Math.abs(m[4]) * shape.hy + Math.abs(m[5]) * shape.hz;
}

export function hazardAhead(
  course: Course,
  body: Body,
  dirX: number,
  dirZ: number,
  t: number,
  horizon = 0.9,
  pose = hazardPose,
  result = hazardResult,
): HazardPrediction | null {
  const directionLength = Math.hypot(dirX, dirZ);
  if (directionLength < 0.001) {
    const speed = Math.hypot(body.vx, body.vz);
    dirX = speed > 0.05 ? body.vx / speed : Math.sin(body.yaw);
    dirZ = speed > 0.05 ? body.vz / speed : Math.cos(body.yaw);
  } else {
    dirX /= directionLength;
    dirZ /= directionLength;
  }
  const samples = Math.min(12, Math.max(1, Math.ceil(horizon / 0.08)));
  const sampleStep = horizon / samples;
  let earliest = Infinity;
  result.sideStep = 0;
  for (const collider of course.colliders) {
    if (!collider.at || collider.bounce === undefined) continue;
    const bound = colliderRadius(collider.shape);
    const dx = collider.pose.x - body.x, dz = collider.pose.z - body.z;
    const along = dx * dirX + dz * dirZ;
    const side = Math.abs(dx * dirZ - dz * dirX);
    if (along < -bound || along > 7 + bound || side > 2.2 + bound) continue;
    const wasOn = collider.on;
    for (let i = 1; i <= samples; i++) {
      const hitAt = sampleStep * i;
      const active = (collider.at(t + hitAt, pose), collider.on);
      collider.on = wasOn;
      if (!active) continue;
      const x = body.x + dirX * RUN_SPEED * hitAt;
      const z = body.z + dirZ * RUN_SPEED * hitAt;
      if (!capsuleOverlapsPose(x, body.y, z, collider.shape, pose, 0.15)) continue;
      const extentY = hazardVerticalExtent(collider.shape, pose);
      const top = pose.y + extentY;
      const bottom = pose.y - extentY;
      if (bottom > body.y + HEIGHT + 0.05) continue;
      if (hitAt < earliest) {
        const groundY = groundBelow(course, pose.x, top + 0.25, pose.z, 30, collider.id);
        earliest = hitAt;
        result.hitAt = hitAt;
        result.low = top - (groundY ?? body.y) <= LOW_HAZARD_HEIGHT;
        if (collider.look === 'coconut') {
          let nearestLane = 0;
          let nearestDistance = Infinity;
          for (const lane of coconutEscapeLanes) {
            if (capsuleOverlapsPose(lane, body.y, z, collider.shape, pose, 0.15)) continue;
            const distance = Math.abs(lane - x);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestLane = lane;
            }
          }
          result.sideStep = nearestLane === 0 && nearestDistance === Infinity ? 0 : Math.sign(nearestLane - x);
        }
      }
      break;
    }
    collider.on = wasOn;
  }
  return earliest < Infinity ? result : null;
}

export function createBrain(id: number, skill: number, seed: number): Brain {
  const random = mulberry32(hash(seed, id, 0x77ac));
  return {
    id, skill: Math.max(0.3, Math.min(0.95, skill)), seed, random,
    lane: (random() * 2 - 1) * 0.7, wander: 0, wanderT: 0, hesitation: 0,
    jumpCooldown: 0, diveCooldown: 0, next: 0, targetTile: -1, targetT: 0,
    courseId: null, lastProgress: 0,
  };
}

export function resetBrain(brain: Brain, course: Course): void {
  brain.next = 0;
  brain.targetTile = -1;
  brain.targetT = 0;
  brain.courseId = course.id;
  brain.jumpCooldown = 0;
  brain.diveCooldown = 0;
  brain.hesitation = 0;
  brain.lastProgress = 0;
  brain.lane = (brain.random() * 2 - 1) * 0.75;
  brain.wanderT = 0;
}

function nearestTile(brain: Brain, body: Body, course: Course, t: number): number {
  let map = tileClaims.get(course);
  if (!map) {
    map = new Map();
    tileClaims.set(course, map);
  }
  const currentLayer = Math.max(0, Math.min(2, Math.round(Math.max(0, -body.y) / 7)));
  let target = -1, best = Infinity, targetLayer = currentLayer;
  for (const collider of course.colliders) {
    const tile = collider.tile;
    if (!tile || !collider.on || tile.touchedAt !== null || tile.fallAt !== null) continue;
    const claim = map.get(collider.id);
    if (claim && claim.until > t && claim.owner !== brain.id) continue;
    const layerGap = tile.layer - currentLayer;
    if (layerGap < 0 || layerGap > 1) continue;
    if (target >= 0 && tile.layer > targetLayer) continue;
    const dx = collider.pose.x - body.x, dz = collider.pose.z - body.z;
    const distance = dx * dx + dz * dz + Math.max(0, layerGap) * 6;
    if (tile.layer < targetLayer || distance < best) {
      best = distance;
      target = collider.id;
      targetLayer = tile.layer;
    }
  }
  if (target >= 0) {
    map.set(target, { owner: brain.id, until: t + 1.4 });
    brain.targetT = t;
  }
  return target;
}

function direction(x: number, z: number): { x: number; z: number; length: number } {
  const length = Math.hypot(x, z);
  return length > 0.001 ? { x: x / length, z: z / length, length } : { x: 0, z: 0, length: 0 };
}

function routeTarget(brain: Brain, body: Body, course: Course, t: number): Waypoint | null {
  if (!course.path.length) return null;
  const progress = progressOf(course, body.x, body.y, body.z);
  if (progress + 0.03 < brain.lastProgress) {
    let nearest = brain.next, distance = Infinity;
    for (let i = 0; i < course.path.length; i++) {
      const node = course.path[i];
      const d = (node.x - body.x) ** 2 + (node.z - body.z) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    }
    brain.next = nearest;
  } else if (progress > brain.lastProgress) {
    brain.lastProgress = progress;
  }
  brain.next = Math.max(0, Math.min(course.path.length - 1, brain.next));
  let target = course.path[brain.next];
  let dx = target.x - body.x, dz = target.z - body.z;
  if (Math.hypot(dx, dz) <= target.r && brain.next < course.path.length - 1 && (!target.jump || body.ground < 0)) {
    brain.next++;
    target = course.path[brain.next];
    dx = target.x - body.x; dz = target.z - body.z;
  }
  if (target.waitFor && !target.waitFor(t) && brain.random() > (0.2 + brain.skill * 0.7)) {
    brain.hesitation = Math.max(brain.hesitation, 0.2 + (1 - brain.skill) * 0.65);
  }
  return target;
}

export function thinkBot(brain: Brain, body: Body, course: Course, t: number, dt: number): Input {
  dt = Math.max(0, Math.min(0.1, dt));
  brain.jumpCooldown = Math.max(0, brain.jumpCooldown - dt);
  brain.diveCooldown = Math.max(0, brain.diveCooldown - dt);
  brain.hesitation = Math.max(0, brain.hesitation - dt);
  brain.wanderT -= dt;
  if (brain.courseId !== course.id) resetBrain(brain, course);
  let targetX = body.x, targetZ = body.z, jump = false, dive = false;
  let waitingForSafeWindow = false;

  if (course.kind === 'survival') {
    const current = course.colliders[body.ground];
    if (brain.targetTile < 0 || brain.targetT + 1.1 < t || !course.colliders[brain.targetTile]?.on ||
        course.colliders[brain.targetTile]?.tile?.touchedAt !== null) {
      brain.targetTile = nearestTile(brain, body, course, t);
    }
    const tile = course.colliders[brain.targetTile];
    if (tile) {
      targetX = tile.pose.x;
      targetZ = tile.pose.z;
      const targetLayer = tile.tile?.layer ?? 0;
      if (targetLayer > Math.round(Math.max(0, -body.y) / 7)) jump = true;
    } else {
      targetX = -body.x * 0.3;
      targetZ = -body.z * 0.3;
    }
    if (current?.tile?.touchedAt !== null && body.ground >= 0) {
      jump = true;
      brain.targetTile = -1;
    }
  } else {
    const node = routeTarget(brain, body, course, t);
    if (node) {
      waitingForSafeWindow = !!node.waitFor && !node.waitFor(t);
      const lane = node.lane ?? 2;
      brain.lane = Math.max(-lane, Math.min(lane, brain.lane));
      targetX = node.x + Math.max(-lane, Math.min(lane, brain.lane + brain.wander));
      targetZ = node.z;
      const distance = Math.hypot(targetX - body.x, targetZ - body.z);
      const timingError = (brain.random() - 0.5) * (1 - brain.skill) * 1.2;
      if (node.jump && distance < (node.jumpDistance ?? 5.5) + timingError && distance > 1 && brain.jumpCooldown <= 0 &&
          (body.ground >= 0 || body.coyote > 0)) {
        jump = brain.random() > (1 - brain.skill) * 0.48;
        if (jump) brain.jumpCooldown = 0.65 + brain.random() * 0.42;
      }
      if (node.dive && distance < 3.2 && brain.diveCooldown <= 0 && body.state === 'air') {
        dive = brain.random() < brain.skill * 0.6;
        if (dive) brain.diveCooldown = 1.2;
      }
      if (node.waitFor && !node.waitFor(t) && brain.random() < 0.03 + (1 - brain.skill) * 0.13) {
        brain.hesitation = Math.max(brain.hesitation, 0.35);
      }
    }
  }
  if (brain.wanderT <= 0) {
    brain.wander = (brain.random() * 2 - 1) * (0.25 + (1 - brain.skill) * 0.85);
    brain.wanderT = 0.55 + brain.random() * 1.1;
  }
  const toward = direction(targetX - body.x, targetZ - body.z);
  let mx = toward.x, mz = toward.z;
  if (waitingForSafeWindow) {
    mx *= 0.08;
    mz *= 0.08;
    jump = false;
    dive = false;
  }

  const intendedDirection = direction(mx, mz);
  const prediction = hazardAhead(course, body, intendedDirection.x, intendedDirection.z, t);
  if (prediction && brain.random() >= (1 - brain.skill) * 0.3) {
    const reactionDelay = 0.04 + (1 - brain.skill) * 0.28;
    const timingError = (brain.random() - 0.5) * (1 - brain.skill) * 0.28;
    const reactionAt = prediction.hitAt - reactionDelay + timingError;
    let jumped = false;
    if (prediction.low && reactionAt >= 0.2 && reactionAt <= 0.4 &&
        brain.jumpCooldown <= 0 && (body.ground >= 0 || body.coyote > 0)) {
      if (brain.random() > (1 - brain.skill) * 0.5) {
        jump = true;
        brain.jumpCooldown = 0.72;
        jumped = true;
      }
    }
    if (prediction.sideStep && reactionAt > 0 && !jumped) {
      const escape = direction(prediction.sideStep * 1.8, intendedDirection.z * 1.2);
      mx = escape.x;
      mz = escape.z;
      jump = false;
      dive = false;
    } else if (!prediction.low && reactionAt > 0 && !jumped) {
      mx = prediction.hitAt < 0.2 ? -intendedDirection.x * 0.12 : 0;
      mz = prediction.hitAt < 0.2 ? -intendedDirection.z * 0.12 : 0;
      jump = false;
      dive = false;
    }
  }
  if (brain.hesitation > 0 && brain.random() < (1 - brain.skill) * 0.25) {
    mx *= 0.15; mz *= 0.15;
    jump = false;
  }
  if (brain.random() < dt * (1 - brain.skill) * 0.018) {
    mx *= brain.random() * 0.45;
    mz *= brain.random() * 0.45;
    jump = false;
  }
  const input = direction(mx, mz);
  return { mx: input.x, mz: input.z, jump, dive };
}
