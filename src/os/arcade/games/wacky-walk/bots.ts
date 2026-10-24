import { hash, mulberry32 } from './rng.ts';
import { progressOf } from './courses.ts';
import type { Body, Course, Input, Waypoint } from './types.ts';

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
  const moveDirection = direction(body.vx, body.vz);

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
      const lane = node.lane ?? 2;
      brain.lane = Math.max(-lane, Math.min(lane, brain.lane));
      targetX = node.x + brain.lane + brain.wander;
      targetZ = node.z;
      const distance = Math.hypot(targetX - body.x, targetZ - body.z);
      const timingError = (brain.random() - 0.5) * (1 - brain.skill) * 1.2;
      if (node.jump && distance < 5.5 + timingError && distance > 1 && brain.jumpCooldown <= 0 &&
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

  // Read the deterministic pose at the next short horizon before committing to a jump.
  let nearestHazard = Infinity, hazardDx = 0, hazardDz = 0;
  for (const collider of course.colliders) {
    if (!collider.on || !collider.bounce) continue;
    const scale = 0.42 / (1 / 60);
    const futureX = collider.pose.x + (collider.pose.x - collider.prev.x) * scale;
    const futureZ = collider.pose.z + (collider.pose.z - collider.prev.z) * scale;
    const dx = futureX - body.x, dz = futureZ - body.z;
    const along = dx * moveDirection.x + dz * moveDirection.z;
    const side = Math.abs(dx * moveDirection.z - dz * moveDirection.x);
    const threshold = 2.1 + (collider.shape.kind === 'box' ? collider.shape.hx * 0.35 : 0.7);
    if (along > 0 && along < nearestHazard && side < threshold) {
      nearestHazard = along;
      hazardDx = dx; hazardDz = dz;
    }
  }
  if (nearestHazard < 4.5 && brain.skill > 0.42 && brain.jumpCooldown <= 0 &&
      (body.ground >= 0 || body.coyote > 0)) {
    jump = brain.random() < 0.45 + brain.skill * 0.5;
    if (jump) brain.jumpCooldown = 0.75;
    if (brain.skill < 0.65 && brain.random() < 0.25) {
      const side = direction(-hazardDz, hazardDx);
      mx = side.x; mz = side.z;
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
