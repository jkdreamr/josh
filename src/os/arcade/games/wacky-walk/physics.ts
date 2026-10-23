import { applyTouch } from './courses.ts';
import type { Body, Bump, Collider, Course, Input, Pose, Shape, Vec3, Zone } from './types.ts';
import { EV } from './types.ts';

export const STEP = 1 / 60;
export const RADIUS = 0.42;
export const HEIGHT = 1.4;
export const BIG_HIT = 12;

const RUN_SPEED = 7.2;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 14;
const GRAVITY = 28;
const JUMP_SPEED = 10.5;
const MAX_FALL = 30;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const MAX_SPEED = 32;
const RAY_EPS = 1e-8;
const hitTimers = new WeakMap<Body, number>();
const diveUsed = new WeakMap<Body, boolean>();
const zoneState = new WeakMap<Body, Set<number>>();
const bounds = new WeakMap<Collider, number>();

export function ident(): number[] {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function setPose(out: Pose, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0): void {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  out.x = x; out.y = y; out.z = z;
  out.m[0] = cy * cr + sy * sp * sr;
  out.m[1] = -cy * sr + sy * sp * cr;
  out.m[2] = sy * cp;
  out.m[3] = cp * sr;
  out.m[4] = cp * cr;
  out.m[5] = -sp;
  out.m[6] = -sy * cr + cy * sp * sr;
  out.m[7] = sy * sr + cy * sp * cr;
  out.m[8] = cy * cp;
}

export function poseOf(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): Pose {
  const pose = { x, y, z, m: ident() };
  setPose(pose, x, y, z, yaw, pitch, roll);
  return pose;
}

/** Inverse rotation is applied first, then the pose translation is removed. */
export function toLocal(pose: Pose, point: Vec3): Vec3 {
  const x = point.x - pose.x, y = point.y - pose.y, z = point.z - pose.z;
  return {
    x: pose.m[0] * x + pose.m[3] * y + pose.m[6] * z,
    y: pose.m[1] * x + pose.m[4] * y + pose.m[7] * z,
    z: pose.m[2] * x + pose.m[5] * y + pose.m[8] * z,
  };
}

/** Rotate the local point into world space, then add the pose translation. */
export function toWorld(pose: Pose, point: Vec3): Vec3 {
  return {
    x: pose.x + pose.m[0] * point.x + pose.m[1] * point.y + pose.m[2] * point.z,
    y: pose.y + pose.m[3] * point.x + pose.m[4] * point.y + pose.m[5] * point.z,
    z: pose.z + pose.m[6] * point.x + pose.m[7] * point.y + pose.m[8] * point.z,
  };
}

export function createBody(x: number, y: number, z: number, yaw: number): Body {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, state: 'run', stateT: 0, ground: -1,
    coyote: 0, buffer: 0, slip: 0, squash: 0, squashV: 0, ev: 0,
  };
}

export function respawn(body: Body, point: Vec3, yaw: number): void {
  body.x = point.x; body.y = point.y; body.z = point.z;
  body.vx = 0; body.vy = 0; body.vz = 0; body.yaw = yaw;
  body.state = 'run'; body.stateT = 0; body.ground = -1;
  body.coyote = 0; body.buffer = 0; body.slip = 0;
  body.squash = -0.2; body.squashV = 0; body.ev = 0;
  hitTimers.set(body, 0);
  diveUsed.set(body, false);
  zoneState.delete(body);
}

export function updateCourse(course: Course, t: number): void {
  for (const collider of course.colliders) {
    const previous = collider.prev, current = collider.pose;
    previous.x = current.x; previous.y = current.y; previous.z = current.z;
    for (let i = 0; i < 9; i++) previous.m[i] = current.m[i];
    if (collider.at) collider.at(t, current);
    if (collider.tile?.fallAt !== null && collider.tile?.fallAt !== undefined) {
      collider.on = t < collider.tile.fallAt + 1.2;
    }
  }
}

type Contact = { distance: number; normal: Vec3; collider: Collider };

function shapeBound(shape: Shape): number {
  if (shape.kind === 'sphere') return shape.r;
  if (shape.kind === 'cyl') return Math.hypot(shape.r, shape.hy);
  return Math.hypot(shape.hx, shape.hy, shape.hz);
}

function worldNormal(pose: Pose, local: Vec3): Vec3 {
  const x = pose.m[0] * local.x + pose.m[1] * local.y + pose.m[2] * local.z;
  const y = pose.m[3] * local.x + pose.m[4] * local.y + pose.m[5] * local.z;
  const z = pose.m[6] * local.x + pose.m[7] * local.y + pose.m[8] * local.z;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function pointShape(point: Vec3, shape: Shape): { distance: number; normal: Vec3 } {
  if (shape.kind === 'sphere') {
    const length = Math.hypot(point.x, point.y, point.z);
    const divisor = length || 1;
    return { distance: Math.max(0, length - shape.r), normal: { x: point.x / divisor, y: point.y / divisor, z: point.z / divisor } };
  }
  if (shape.kind === 'cyl') {
    const radial = Math.hypot(point.x, point.z);
    const outsideR = Math.max(0, radial - shape.r);
    const outsideY = Math.max(0, Math.abs(point.y) - shape.hy);
    if (outsideR || outsideY) {
      const length = Math.hypot(outsideR, outsideY) || 1;
      return {
        distance: length,
        normal: { x: radial ? point.x / radial * outsideR / length : 0, y: Math.sign(point.y || 1) * outsideY / length, z: radial ? point.z / radial * outsideR / length : 0 },
      };
    }
    const sideGap = shape.r - radial, capGap = shape.hy - Math.abs(point.y);
    if (sideGap < capGap) {
      const d = radial || 1;
      return { distance: 0, normal: { x: point.x / d, y: 0, z: point.z / d } };
    }
    return { distance: 0, normal: { x: 0, y: Math.sign(point.y || 1), z: 0 } };
  }
  const qx = Math.max(-shape.hx, Math.min(shape.hx, point.x));
  const qy = Math.max(-shape.hy, Math.min(shape.hy, point.y));
  const qz = Math.max(-shape.hz, Math.min(shape.hz, point.z));
  const dx = point.x - qx, dy = point.y - qy, dz = point.z - qz;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > 1e-7) return { distance, normal: { x: dx / distance, y: dy / distance, z: dz / distance } };
  const gaps = [shape.hx - Math.abs(point.x), shape.hy - Math.abs(point.y), shape.hz - Math.abs(point.z)];
  const axis = gaps[0] < gaps[1] ? (gaps[0] < gaps[2] ? 0 : 2) : (gaps[1] < gaps[2] ? 1 : 2);
  const normal = { x: 0, y: 0, z: 0 };
  if (axis === 0) normal.x = Math.sign(point.x || 1);
  else if (axis === 1) normal.y = Math.sign(point.y || 1);
  else normal.z = Math.sign(point.z || 1);
  return { distance: 0, normal };
}

function contactAt(body: Body, collider: Collider): Contact | null {
  const bound = bounds.get(collider) ?? shapeBound(collider.shape);
  if (!bounds.has(collider)) bounds.set(collider, bound);
  const dx = body.x - collider.pose.x, dy = body.y + HEIGHT / 2 - collider.pose.y, dz = body.z - collider.pose.z;
  if (dx * dx + dy * dy + dz * dz > (bound + HEIGHT / 2 + RADIUS) ** 2) return null;
  const samples = 7;
  let nearest: Contact | null = null;
  for (let i = 0; i < samples; i++) {
    const worldPoint = { x: body.x, y: body.y + RADIUS + (HEIGHT - 2 * RADIUS) * i / (samples - 1), z: body.z };
    const local = toLocal(collider.pose, worldPoint);
    const sample = pointShape(local, collider.shape);
    if (nearest && sample.distance >= nearest.distance) continue;
    nearest = { distance: sample.distance, normal: worldNormal(collider.pose, sample.normal), collider };
  }
  return nearest && nearest.distance <= RADIUS + 0.01 ? nearest : null;
}

function collide(body: Body, course: Course, wasGrounded: boolean, t: number): void {
  let grounded = false, groundId = -1, groundSlip = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const collider of course.colliders) {
      if (!collider.on) continue;
      const contact = contactAt(body, collider);
      if (!contact) continue;
      const penetration = Math.max(0, RADIUS - contact.distance);
      const normal = contact.normal;
      body.x += normal.x * (penetration + 0.0001);
      body.y += normal.y * (penetration + 0.0001);
      body.z += normal.z * (penetration + 0.0001);
      const vn = body.vx * normal.x + body.vy * normal.y + body.vz * normal.z;
      if (vn < 0) {
        const bounce = normal.y > 0.55 ? 0.04 : 0.12;
        body.vx -= (1 + bounce) * vn * normal.x;
        body.vy -= (1 + bounce) * vn * normal.y;
        body.vz -= (1 + bounce) * vn * normal.z;
      }
      if (normal.y > 0.55) {
        grounded = true; groundId = collider.id; groundSlip = collider.slip ? 1 : 0;
        if (body.vy < 0) body.vy = 0;
        if (!wasGrounded && body.state !== 'stun') {
          body.ev |= EV.LAND;
          body.squash = Math.min(0.48, Math.max(0.12, -vn * 0.025));
          body.squashV = -2.5;
          if (collider.tile) applyTouch(course, collider.id, t);
          if (collider.spring) {
            body.vy = collider.spring;
            body.ground = -1;
            grounded = false;
            groundId = -1;
            body.state = 'air';
            body.stateT = 0;
            body.ev |= EV.SPRING;
            continue;
          }
          if (body.state === 'dive') {
            body.state = 'flop'; body.stateT = 0;
          } else if (body.state === 'air') {
            body.state = 'run'; body.stateT = 0;
          }
        }
      }
      if (collider.tile && !wasGrounded) applyTouch(course, collider.id, t);
      if (collider.bounce !== undefined && Math.hypot(normal.x, normal.z) > 0.35) {
        const timer = hitTimers.get(body) ?? 0;
        if (timer <= 0) {
          const ownX = (collider.pose.x - collider.prev.x) / STEP;
          const ownZ = (collider.pose.z - collider.prev.z) / STEP;
          const speed = collider.bounce;
          const horizontal = Math.hypot(normal.x, normal.z) || 1;
          body.vx = normal.x / horizontal * speed + ownX * 0.35;
          body.vz = normal.z / horizontal * speed + ownZ * 0.35;
          body.vy = Math.max(body.vy, speed * 0.35);
          body.ev |= EV.HIT;
          if (speed >= BIG_HIT) {
            body.state = 'stun'; body.stateT = 0;
            body.ev |= EV.BIG_HIT;
          }
          hitTimers.set(body, 0.35);
        }
      }
    }
  }
  body.ground = grounded ? groundId : -1;
  body.slip = groundSlip;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(-10000, Math.min(10000, value)) : 0;
}

function carryRider(body: Body, course: Course): void {
  if (body.ground < 0) return;
  const collider = course.colliders[body.ground];
  if (!collider?.on || !collider.at) return;
  const local = toLocal(collider.prev, { x: body.x, y: body.y, z: body.z });
  const current = toWorld(collider.pose, local);
  body.x += current.x - body.x;
  body.y += current.y - body.y;
  body.z += current.z - body.z;
}

function insideColliderZone(zone: Zone, x: number, y: number, z: number): boolean {
  return Math.abs(x - zone.x) <= zone.hx && Math.abs(y - zone.y) <= zone.hy && Math.abs(z - zone.z) <= zone.hz;
}

export function insideZone(zone: Zone, x: number, y: number, z: number): boolean {
  return insideColliderZone(zone, x, y, z);
}

export function stepBody(body: Body, input: Input, course: Course, t: number, dt: number, others: readonly Bump[]): void {
  dt = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : STEP));
  body.ev = 0;
  const priorGround = body.ground;
  body.stateT += dt;
  hitTimers.set(body, Math.max(0, (hitTimers.get(body) ?? 0) - dt));
  body.buffer = input.jump ? JUMP_BUFFER : Math.max(0, body.buffer - dt);
  carryRider(body, course);

  if (priorGround >= 0) body.coyote = COYOTE_TIME;
  else body.coyote = Math.max(0, body.coyote - dt);
  if (input.dive && !diveUsed.get(body) && body.state !== 'stun' && body.state !== 'flop') {
    const moveLength = Math.hypot(input.mx, input.mz);
    const dirX = moveLength > 0.05 ? input.mx / moveLength : Math.sin(body.yaw);
    const dirZ = moveLength > 0.05 ? input.mz / moveLength : Math.cos(body.yaw);
    const forward = body.vx * dirX + body.vz * dirZ;
    const speed = Math.max(forward, 10.5);
    body.vx += dirX * (speed - forward);
    body.vz += dirZ * (speed - forward);
    body.vy = Math.max(body.vy, 4);
    body.state = 'dive'; body.stateT = 0;
    body.ev |= EV.DIVE;
    diveUsed.set(body, true);
  }
  const canControl = body.state !== 'stun' && body.state !== 'flop';
  let mx = Number.isFinite(input.mx) ? input.mx : 0, mz = Number.isFinite(input.mz) ? input.mz : 0;
  const magnitude = Math.hypot(mx, mz);
  if (magnitude > 1) { mx /= magnitude; mz /= magnitude; }
  if (canControl && body.buffer > 0 && (body.ground >= 0 || body.coyote > 0) && body.state !== 'dive') {
    body.vy = JUMP_SPEED;
    body.ground = -1; body.coyote = 0; body.buffer = 0;
    body.state = 'air'; body.stateT = 0;
    body.squash = -0.22; body.squashV = 2.2;
    body.ev |= EV.JUMP;
    diveUsed.set(body, false);
  }
  if (canControl) {
    const desiredX = mx * RUN_SPEED, desiredZ = mz * RUN_SPEED;
    const accel = body.ground >= 0 ? (body.slip ? 10 : GROUND_ACCEL) : AIR_ACCEL;
    const friction = body.ground >= 0 && magnitude < 0.05 ? (body.slip ? 0.5 : 22) : 0;
    if (magnitude > 0.05 || body.ground < 0) {
      body.vx += Math.max(-accel * dt, Math.min(accel * dt, desiredX - body.vx));
      body.vz += Math.max(-accel * dt, Math.min(accel * dt, desiredZ - body.vz));
    }
    if (friction) {
      const factor = Math.max(0, 1 - friction * dt);
      body.vx *= factor; body.vz *= factor;
    }
    if (magnitude > 0.08) {
      const targetYaw = Math.atan2(mx, mz);
      let delta = ((targetYaw - body.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      body.yaw += delta * Math.min(1, dt * 10);
    }
  } else if (body.state === 'stun') {
    body.vx *= Math.max(0, 1 - dt * 1.1);
    body.vz *= Math.max(0, 1 - dt * 1.1);
  } else {
    body.vx *= Math.max(0, 1 - dt * 1.8);
    body.vz *= Math.max(0, 1 - dt * 1.8);
  }
  if (body.ground < 0) body.vy = Math.max(-MAX_FALL, body.vy - GRAVITY * dt);
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.z += body.vz * dt;

  const wasGrounded = priorGround >= 0;
  collide(body, course, wasGrounded, t);
  const zoneSet = zoneState.get(body) ?? new Set<number>();
  const activeZones = new Set<number>();
  for (let i = 0; i < course.zones.length; i++) {
    const zone = course.zones[i];
    if (zone.kind !== 'jet' || (zone.on && !zone.on(t)) || !insideZone(zone, body.x, body.y + HEIGHT / 2, body.z)) continue;
    activeZones.add(i);
    if (!zoneSet.has(i)) body.ev |= EV.SPLASH;
    if (zone.push) {
      body.vx += zone.push.x * dt;
      body.vy += zone.push.y * dt;
      body.vz += zone.push.z * dt;
    }
  }
  zoneState.set(body, activeZones);

  for (const other of others) {
    const dy = body.y - other.y;
    if (dy > HEIGHT + 0.3 || dy < -HEIGHT - 0.3) continue;
    let dx = body.x - other.x, dz = body.z - other.z;
    const distance = Math.hypot(dx, dz), overlap = RADIUS * 2 - distance;
    if (overlap <= 0) continue;
    if (distance < 1e-6) { dx = 1; dz = 0; }
    else { dx /= distance; dz /= distance; }
    body.x += dx * overlap * 0.5;
    body.z += dz * overlap * 0.5;
    body.vx += dx * 0.7 + other.vx * 0.08;
    body.vz += dz * 0.7 + other.vz * 0.08;
  }

  if (body.state === 'flop' && body.stateT >= 0.6) {
    body.state = 'run'; body.stateT = 0; body.ev |= EV.GET_UP;
  } else if (body.state === 'stun' && body.stateT >= 0.9) {
    body.state = 'flop'; body.stateT = 0;
  }
  if (body.ground >= 0 && body.state === 'run') diveUsed.set(body, false);
  const springAccel = -100 * body.squash - 17 * body.squashV;
  body.squashV = safeNumber(body.squashV + springAccel * dt);
  body.squash = safeNumber(body.squash + body.squashV * dt);
  body.squash = Math.max(-0.32, Math.min(0.55, body.squash));
  body.x = safeNumber(body.x); body.y = safeNumber(body.y); body.z = safeNumber(body.z);
  body.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, safeNumber(body.vx)));
  body.vy = Math.max(-MAX_FALL, Math.min(MAX_SPEED, safeNumber(body.vy)));
  body.vz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, safeNumber(body.vz)));
  body.yaw = safeNumber(body.yaw);
}

function rayShape(from: Vec3, to: Vec3, pose: Pose, shape: Shape): number | null {
  const a = toLocal(pose, from), b = toLocal(pose, to);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  if (shape.kind === 'box') {
    let low = 0, high = 1;
    const starts = [a.x, a.y, a.z], directions = [dx, dy, dz];
    const extents = [shape.hx, shape.hy, shape.hz];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(directions[axis]) < RAY_EPS) {
        if (starts[axis] < -extents[axis] || starts[axis] > extents[axis]) return null;
        continue;
      }
      let near = (-extents[axis] - starts[axis]) / directions[axis];
      let far = (extents[axis] - starts[axis]) / directions[axis];
      if (near > far) [near, far] = [far, near];
      low = Math.max(low, near); high = Math.min(high, far);
      if (low > high) return null;
    }
    return low >= 0 && low <= 1 ? low : high >= 0 && high <= 1 ? high : null;
  }
  if (shape.kind === 'sphere') {
    if (shape.r < 1) return null;
    const A = dx * dx + dy * dy + dz * dz;
    const B = 2 * (a.x * dx + a.y * dy + a.z * dz);
    const C = a.x * a.x + a.y * a.y + a.z * a.z - shape.r * shape.r;
    const discriminant = B * B - 4 * A * C;
    if (A <= RAY_EPS || discriminant < 0) return null;
    const first = (-B - Math.sqrt(discriminant)) / (2 * A);
    const second = (-B + Math.sqrt(discriminant)) / (2 * A);
    return first >= 0 && first <= 1 ? first : second >= 0 && second <= 1 ? second : null;
  }
  const A = dx * dx + dz * dz, B = 2 * (a.x * dx + a.z * dz), C = a.x * a.x + a.z * a.z - shape.r * shape.r;
  let best: number | null = null;
  const discriminant = B * B - 4 * A * C;
  if (A > RAY_EPS && discriminant >= 0) {
    for (const u of [(-B - Math.sqrt(discriminant)) / (2 * A), (-B + Math.sqrt(discriminant)) / (2 * A)]) {
      const y = a.y + dy * u;
      if (u >= 0 && u <= 1 && Math.abs(y) <= shape.hy && (best === null || u < best)) best = u;
    }
  }
  if (Math.abs(dy) > RAY_EPS) {
    for (const cap of [-shape.hy, shape.hy]) {
      const u = (cap - a.y) / dy;
      const x = a.x + dx * u, z = a.z + dz * u;
      if (u >= 0 && u <= 1 && x * x + z * z <= shape.r * shape.r && (best === null || u < best)) best = u;
    }
  }
  return best;
}

/** camera raycasts include moving tiles but skip hidden and other moving colliders. */
export function rayCast(course: Course, from: Vec3, to: Vec3, camera = false): number {
  let best = 1;
  let hit = false;
  for (const collider of course.colliders) {
    if (!collider.on || (camera && (collider.look === 'hidden' || (collider.at && !collider.tile)))) continue;
    const fraction = rayShape(from, to, collider.pose, collider.shape);
    if (fraction !== null && fraction < best) { best = fraction; hit = true; }
  }
  return hit ? best : 1;
}

export function groundBelow(course: Course, x: number, y: number, z: number, maxDrop = 30): number | null {
  const endY = y - maxDrop;
  const fraction = rayCast(course, { x, y, z }, { x, y: endY, z });
  return fraction >= 1 ? null : y + (endY - y) * fraction;
}
