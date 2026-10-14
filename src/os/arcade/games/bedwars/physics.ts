// Player movement, Minecraft 1.8 style: 20 ticks a second, velocities in blocks per tick, ground friction 0.546,
// gravity 0.08 with 0.98 drag, 0.42 jumps, 0.6 step-up, and sneaking that will not walk you off an edge.
// Pure, so bots, the host and every client run exactly the same code.
import { isLadder } from './blocks.ts';
import type { World } from './world.ts';

export const TICK = 1 / 20;
export const WIDTH = 0.6;
export const HEIGHT = 1.8;
export const EYE = 1.62;
export const EYE_SNEAK = 1.54;
const HALF = WIDTH / 2;
const STEP = 0.6;
const GRAVITY = 0.08;
const AIR_DRAG = 0.98;
const GROUND = 0.6 * 0.91;
const AIR = 0.91;
const WALK = 0.1;
export const JUMP_V = 0.42;

export type Body = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Radians. 0 looks down -z; positive turns left (three.js camera convention). */
  yaw: number;
  /** Radians, positive looks up. */
  pitch: number;
  onGround: boolean;
  collidedH: boolean;
  sneaking: boolean;
  sprinting: boolean;
  fallDistance: number;
  jumpTicks: number;
  onLadder: boolean;
  /** Distance of the last fall worth damage (over 3 blocks), set on landing for the owner to report. */
  landed: number;
};

export type MoveInput = {
  /** -1..1, forward positive */
  forward: number;
  /** -1..1, right positive */
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
};

export type Effects = { speed: number; jump: number; slow: number };
export const NO_EFFECTS: Effects = { speed: 0, jump: 0, slow: 0 };

export const newBody = (x = 0, y = 0, z = 0, yaw = 0): Body => ({
  x,
  y,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw,
  pitch: 0,
  onGround: false,
  collidedH: false,
  sneaking: false,
  sprinting: false,
  fallDistance: 0,
  jumpTicks: 0,
  onLadder: false,
  landed: 0,
});

export const forwardX = (yaw: number) => -Math.sin(yaw);
export const forwardZ = (yaw: number) => -Math.cos(yaw);

const boxes: number[] = [];

/** Can the sprint state be on given this input (Minecraft: moving forward, not sneaking, not into a wall). */
export function canSprint(b: Body, inp: MoveInput) {
  return inp.forward > 0.8 && !inp.sneak && !b.collidedH;
}

/** One 20 Hz tick of movement for a body. */
export function stepBody(world: World, b: Body, inp: MoveInput, fx: Effects = NO_EFFECTS) {
  b.sneaking = inp.sneak;
  if (inp.sprint && canSprint(b, inp)) b.sprinting = true;
  else if (!canSprint(b, inp)) b.sprinting = false;

  let forward = inp.forward * 0.98;
  let strafe = inp.strafe * 0.98;
  if (b.sneaking) {
    forward *= 0.3;
    strafe *= 0.3;
  }

  // jumping
  if (b.jumpTicks > 0) b.jumpTicks--;
  if (inp.jump) {
    if (b.onGround && b.jumpTicks === 0) {
      b.vy = JUMP_V + 0.1 * fx.jump;
      if (b.sprinting) {
        b.vx += forwardX(b.yaw) * 0.2;
        b.vz += forwardZ(b.yaw) * 0.2;
      }
      b.jumpTicks = 10;
    }
  } else b.jumpTicks = 0;

  const slip = b.onGround ? GROUND : AIR;
  let speed = WALK * (1 + 0.2 * fx.speed) * Math.max(0, 1 - 0.15 * fx.slow);
  if (b.sprinting) speed *= 1.3;
  const accel = b.onGround ? speed * (0.16277136 / (slip * slip * slip)) : b.sprinting ? 0.026 : 0.02;
  let f = strafe * strafe + forward * forward;
  if (f >= 1e-4) {
    f = Math.max(1, Math.sqrt(f));
    f = accel / f;
    const s = strafe * f;
    const fw = forward * f;
    const sin = Math.sin(b.yaw);
    const cos = Math.cos(b.yaw);
    // right is (cos, -sin), forward is (-sin, -cos)
    b.vx += s * cos - fw * sin;
    b.vz += -s * sin - fw * cos;
  }

  b.onLadder = isLadder(world.get(b.x, b.y, b.z)) || isLadder(world.get(b.x, b.y + 1, b.z));
  if (b.onLadder) {
    b.vx = Math.max(-0.15, Math.min(0.15, b.vx));
    b.vz = Math.max(-0.15, Math.min(0.15, b.vz));
    b.fallDistance = 0;
    if (b.vy < -0.15) b.vy = -0.15;
    if (b.sneaking && b.vy < 0) b.vy = 0;
  }

  move(world, b, b.vx, b.vy, b.vz);

  if (b.collidedH && b.onLadder) b.vy = 0.2;
  b.vy -= GRAVITY;
  b.vy *= AIR_DRAG;
  b.vx *= slip;
  b.vz *= slip;
  if (Math.abs(b.vx) < 0.003) b.vx = 0;
  if (Math.abs(b.vz) < 0.003) b.vz = 0;
}

/** No block in the way of the body's box moved by (dx, dy, dz). */
function free(world: World, b: Body, dx: number, dy: number, dz: number) {
  return !world.boxHitsBlocks(b.x - HALF + dx, b.y + dy, b.z - HALF + dz, b.x + HALF + dx, b.y + HEIGHT + dy, b.z + HALF + dz);
}

/** Moves a body by an offset against the world's collision boxes, Minecraft's moveEntity. */
export function move(world: World, b: Body, dx: number, dy: number, dz: number) {
  // sneaking on the ground: never step off an edge
  if (b.onGround && b.sneaking) {
    const s = 0.05;
    while (dx !== 0 && free(world, b, dx, -1, 0)) dx = Math.abs(dx) < s ? 0 : dx > 0 ? dx - s : dx + s;
    while (dz !== 0 && free(world, b, 0, -1, dz)) dz = Math.abs(dz) < s ? 0 : dz > 0 ? dz - s : dz + s;
    while (dx !== 0 && dz !== 0 && free(world, b, dx, -1, dz)) {
      dx = Math.abs(dx) < s ? 0 : dx > 0 ? dx - s : dx + s;
      dz = Math.abs(dz) < s ? 0 : dz > 0 ? dz - s : dz + s;
    }
  }
  const ox = dx;
  const oy = dy;
  const oz = dz;
  let x0 = b.x - HALF;
  let y0 = b.y;
  let z0 = b.z - HALF;
  const n = world.collectBoxes(Math.min(x0, x0 + dx), Math.min(y0, y0 + dy), Math.min(z0, z0 + dz), Math.max(x0 + WIDTH, x0 + WIDTH + dx), Math.max(y0 + HEIGHT, y0 + HEIGHT + dy) + STEP, Math.max(z0 + WIDTH, z0 + WIDTH + dz), boxes);

  dy = clipY(boxes, n, x0, y0, z0, dy);
  y0 += dy;
  dx = clipX(boxes, n, x0, y0, z0, dx);
  x0 += dx;
  dz = clipZ(boxes, n, x0, y0, z0, dz);
  z0 += dz;

  const groundedNow = b.onGround || (oy !== dy && oy < 0);
  // step up onto a half block or a bed edge
  if (groundedNow && (ox !== dx || oz !== dz)) {
    let sx0 = b.x - HALF;
    let sy0 = b.y;
    let sz0 = b.z - HALF;
    let sy = clipY(boxes, n, sx0, sy0, sz0, STEP);
    sy0 += sy;
    const sx = clipX(boxes, n, sx0, sy0, sz0, ox);
    sx0 += sx;
    const sz = clipZ(boxes, n, sx0, sy0, sz0, oz);
    sz0 += sz;
    const down = clipY(boxes, n, sx0, sy0, sz0, -sy);
    sy0 += down;
    sy += down;
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-9) {
      x0 = sx0;
      y0 = sy0;
      z0 = sz0;
      dx = sx;
      dy = sy;
      dz = sz;
    }
  }

  b.x = x0 + HALF;
  b.y = y0;
  b.z = z0 + HALF;
  b.collidedH = ox !== dx || oz !== dz;
  const hitY = oy !== dy;
  const wasGround = b.onGround;
  b.onGround = hitY && oy < 0;
  if (ox !== dx) b.vx = 0;
  if (oz !== dz) b.vz = 0;
  if (hitY) b.vy = 0;

  // fall distance and landing
  if (b.onGround) {
    if (!wasGround && b.fallDistance > 3) b.landed = b.fallDistance;
    b.fallDistance = 0;
  } else if (dy < 0) b.fallDistance -= dy;
}

function clipY(bx: number[], n: number, x0: number, y0: number, z0: number, dy: number) {
  const x1 = x0 + WIDTH;
  const y1 = y0 + HEIGHT;
  const z1 = z0 + WIDTH;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (bx[o + 3] <= x0 || bx[o] >= x1 || bx[o + 5] <= z0 || bx[o + 2] >= z1) continue;
    if (dy > 0 && bx[o + 1] >= y1 - 1e-7) dy = Math.min(dy, bx[o + 1] - y1);
    else if (dy < 0 && bx[o + 4] <= y0 + 1e-7) dy = Math.max(dy, bx[o + 4] - y0);
  }
  return dy;
}

function clipX(bx: number[], n: number, x0: number, y0: number, z0: number, dx: number) {
  const x1 = x0 + WIDTH;
  const y1 = y0 + HEIGHT;
  const z1 = z0 + WIDTH;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (bx[o + 4] <= y0 || bx[o + 1] >= y1 || bx[o + 5] <= z0 || bx[o + 2] >= z1) continue;
    if (dx > 0 && bx[o] >= x1 - 1e-7) dx = Math.min(dx, bx[o] - x1);
    else if (dx < 0 && bx[o + 3] <= x0 + 1e-7) dx = Math.max(dx, bx[o + 3] - x0);
  }
  return dx;
}

function clipZ(bx: number[], n: number, x0: number, y0: number, z0: number, dz: number) {
  const x1 = x0 + WIDTH;
  const y1 = y0 + HEIGHT;
  const z1 = z0 + WIDTH;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (bx[o + 4] <= y0 || bx[o + 1] >= y1 || bx[o + 3] <= x0 || bx[o] >= x1) continue;
    if (dz > 0 && bx[o + 2] >= z1 - 1e-7) dz = Math.min(dz, bx[o + 2] - z1);
    else if (dz < 0 && bx[o + 5] <= z0 + 1e-7) dz = Math.max(dz, bx[o + 5] - z0);
  }
  return dz;
}

/** Does a player standing at (x, y, z) overlap a block cell? Used to stop blocks being placed inside people. */
export function bodyOverlapsCell(bx: number, by: number, bz: number, x: number, y: number, z: number) {
  return bx + HALF > x && bx - HALF < x + 1 && by + HEIGHT > y && by < y + 1 && bz + HALF > z && bz - HALF < z + 1;
}
