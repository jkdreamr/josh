// The third person camera: over the right shoulder, pulled in when something is behind it, and where its crosshair
// rests. Shots still leave the soldier's eye (see fire in match.ts), toward that point: the camera shows more round a
// corner than the eye sees, but never lets a shot through what the eye can't see past. Pure, so it runs under node.
import { rayCars, carHit } from './cars.ts';
import { clamp } from './noise.ts';
import { newHit, rayWorld, type Hit } from './physics.ts';
import { floorAt } from './terrain.ts';
import { eyeX, eyeY, eyeZ, proneOf, rayActors, viewDir, type Actor, type Match, type Vec3 } from './match.ts';

/** Over the shoulder: how far out to the right, up and back from the eye (lying down: lower and closer). */
const SIDE = 0.58;
const UP = 0.24;
const BACK = 2.5;
const PRONE_UP = 0.42;
const PRONE_BACK = 2.1;
/** How far short of whatever is behind it the camera stops. */
const PAD = 0.28;
/** How far the crosshair's point is looked for. */
const REACH = 900;

export type Cam = Vec3 & { /** How far back from the eye it ended up (pulled in: less). */ dist: number };

const camHit = newHit();

/**
 * Where the third person camera sits for an actor looking along yaw and pitch: out over the right shoulder and back,
 * pulled in where a wall, a tree or the ground is in between (the way the vehicle camera does it).
 */
export function shoulderCam(m: Match, a: Actor, yaw: number, pitch: number, out: Cam, hit: Hit = camHit) {
  const d = viewDir(yaw, pitch);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const low = proneOf(a);
  const back = BACK + (PRONE_BACK - BACK) * low;
  const up = UP + (PRONE_UP - UP) * low;
  const px = eyeX(a);
  const py = eyeY(a);
  const pz = eyeZ(a);
  // the spot wanted, then a ray from the eye toward it: stopped short of the first thing in the way
  const tx = rx * SIDE - d.x * back;
  const ty = up - d.y * back;
  const tz = rz * SIDE - d.z * back;
  const len = Math.hypot(tx, ty, tz);
  rayWorld(m.world, px, py, pz, tx / len, ty / len, tz / len, len + PAD, hit);
  const k = hit.kind === 'none' ? 1 : clamp((hit.t - PAD) / len, 0.05, 1);
  out.x = px + tx * k;
  out.y = py + ty * k;
  out.z = pz + tz * k;
  out.y = Math.max(out.y, floorAt(m.world.terrain, out.x, out.z) + 0.2);
  out.dist = back * k;
  return out;
}

/**
 * The point the crosshair rests on: along the camera's ray (from where it passes the eye, so nothing behind the
 * soldier counts), the first wall, ground, vehicle or body other than the actor's own; far off when there is none.
 */
export function aimPoint(m: Match, a: Actor, cam: Vec3, yaw: number, pitch: number, out: Vec3, hit: Hit = camHit) {
  const d = viewDir(yaw, pitch);
  const t0 = Math.max(0, (eyeX(a) - cam.x) * d.x + (eyeY(a) - cam.y) * d.y + (eyeZ(a) - cam.z) * d.z);
  const ox = cam.x + d.x * t0;
  const oy = cam.y + d.y * t0;
  const oz = cam.z + d.z * t0;
  rayWorld(m.world, ox, oy, oz, d.x, d.y, d.z, REACH, hit);
  let t = hit.kind === 'none' ? REACH : hit.t;
  if (m.cars.length && rayCars(m, ox, oy, oz, d.x, d.y, d.z, t, a.car)) t = Math.min(t, carHit.t);
  const at = rayActors(m, ox, oy, oz, d.x, d.y, d.z, t, a.id);
  if (at >= 0) t = at;
  out.x = ox + d.x * t;
  out.y = oy + d.y * t;
  out.z = oz + d.z * t;
  return out;
}
