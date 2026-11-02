// Vehicles a royale leaves parked by its roads and towns: a four seat jeep and a two seat motorbike. They are driven
// with the same Input as walking (W/S throttle, brake and reverse, A/D steer, Space the handbrake, F in and out).
// Arcade physics: the wheels follow the ground and tilt the body, a slope slows a climb and a cliff stops it, water
// slows it and deep water floods the engine. The hull collides as a row of circles pushed out of walls, trunks, rocks
// and other cars, and a move that would leave it deeper in anything is undone, so it never ends up inside one. Bullets,
// grenades and crashes wear its health down; at none it blows up and hurts whoever is in and around it. Pure TS like
// match.ts, which runs it (only in a royale: the other modes have no cars).
import { PERSON_HEALTH, damage, type Actor, type Input, type Match } from './match.ts';
import { clamp, mulberry32 } from './noise.ts';
import { GRAVITY, RADIUS, STAND_H, SWIM_DEPTH, blockedAt, forEachNear, groundAt, newHit, rayWorld, rockTop } from './physics.ts';
import { onLand } from './royale.ts';
import { floorAt, heightAt, normalAt } from './terrain.ts';
import { K_BOX, K_TRUNK, type World } from './world.ts';

export type CarKind = 'jeep' | 'bike';

export type CarSpec = {
  name: string;
  /** Half length and half width of the hull, and the circles it collides as (centers along it, back positive). */
  hl: number;
  hw: number;
  circles: number[];
  r: number;
  /** The hull's underside and top above the ground under it (what bullets hit). */
  floor: number;
  top: number;
  /** Axles apart, wheels apart (0 for a bike's single track), and the wheel radius. */
  wheelbase: number;
  track: number;
  wheel: number;
  hp: number;
  /** Top speed forward and backing up (m/s), acceleration and braking (m/s²). */
  vmax: number;
  vrev: number;
  accel: number;
  brake: number;
  /** Steering lock at a standstill (radians) and how hard the tyres hold sideways. */
  steer: number;
  grip: number;
  /** Seats: x to the right, the hips' height above the ground, z toward the back. The first one drives. */
  seats: [number, number, number][];
  /** Water deeper than this floods the engine. */
  wade: number;
};

export const CARS: Record<CarKind, CarSpec> = {
  jeep: {
    name: 'Jeep',
    hl: 2.2,
    hw: 1,
    circles: [-1.2, 0, 1.2],
    r: 1,
    floor: 0.4,
    top: 1.3,
    wheelbase: 2.7,
    track: 1.7,
    wheel: 0.42,
    hp: 600,
    vmax: 27,
    vrev: 8,
    accel: 10,
    brake: 16,
    steer: 0.55,
    grip: 8,
    seats: [
      [-0.45, 1, -0.15],
      [0.45, 1, -0.15],
      [-0.45, 1.05, 0.95],
      [0.45, 1.05, 0.95],
    ],
    wade: 1,
  },
  bike: {
    name: 'Motorbike',
    hl: 1.1,
    hw: 0.42,
    circles: [-0.62, 0.62],
    r: 0.45,
    floor: 0.3,
    top: 1.05,
    wheelbase: 1.45,
    track: 0,
    wheel: 0.33,
    hp: 260,
    vmax: 32,
    vrev: 4,
    accel: 12,
    brake: 18,
    steer: 0.6,
    grip: 7,
    seats: [
      [0, 0.95, 0.05],
      [0, 1, 0.6],
    ],
    wade: 0.7,
  },
};

export type Car = {
  id: number;
  kind: CarKind;
  /** Where it stands: the middle of the ground under its wheels. */
  x: number;
  y: number;
  z: number;
  /** Heading (forward is (-sin yaw, -cos yaw), as for an actor), nose up, and right side up, radians. */
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  /** Forward speed (negative backing up), the front wheels' turn (-1 to 1, + right), and how far they have rolled. */
  speed: number;
  steer: number;
  spin: number;
  /** What the driver asks for this frame: throttle (-1 to 1), steering, the handbrake. */
  throttle: number;
  turn: number;
  brake: boolean;
  hp: number;
  /** False once it has blown up: a burnt out wreck that stays where it is, in the way. */
  alive: boolean;
  /** Who sits in each seat (an actor id, or -1); seat 0 drives. */
  seats: number[];
  onGround: boolean;
  /** Parked and settled: skipped until something wakes it. */
  sleep: boolean;
  /** Stood in deep water: the engine won't pull until it is out. */
  flooded: boolean;
  /** Who hurt it last and when (the knockouts if it blows are theirs), and who drove it last (a run over with nobody at
   * the wheel is still theirs). */
  lastHit: number;
  hurtT: number;
  lastDriver: number;
  /** When it blew up. */
  wreckT: number;
  /** A bot on its way to drive it, or -1 (so two don't race for the same one). */
  claim: number;
};

/** The hips above a seated body's feet (the soldier's hip joint): a rider's body stands this far below the seat. */
export const HIP = 0.95;
/** How close to a hull counts as at the door. */
export const CAR_REACH = 1.5;
/** Things lower than this above the wheels are driven over; anything taller is in the way. */
const STEP = 0.45;
/** A slope pulls a car back this hard (m/s² at vertical): a jeep climbs about 40 degrees, no more. */
const SLOPE_G = 12.5;
/** Steeper than this (nose or side) and it won't go on climbing. */
const MAX_PITCH = 0.72;
const MAX_ROLL = 0.62;

export function newCar(id: number, kind: CarKind, x: number, y: number, z: number, yaw: number): Car {
  return { id, kind, x, y, z, yaw, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, speed: 0, steer: 0, spin: 0, throttle: 0, turn: 0, brake: false, hp: CARS[kind].hp, alive: true, seats: new Array(CARS[kind].seats.length).fill(-1), onGround: true, sleep: false, flooded: false, lastHit: -1, hurtT: -99, lastDriver: -1, wreckT: -1, claim: -1 };
}

// ---------------------------------------------------------------------------------------------------------------
// shape

/** Rotates a point from a car's frame (x right, y up, z back) into the world, tilt included. */
export function carPoint(c: Car, lx: number, ly: number, lz: number, out: { x: number; y: number; z: number }) {
  const cr = Math.cos(c.roll);
  const sr = Math.sin(c.roll);
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  // roll about z, then pitch about x, then yaw about y (three.js 'YXZ', as the renderer draws it)
  const x1 = lx * cr - ly * sr;
  const y1 = lx * sr + ly * cr;
  const y2 = y1 * cp - lz * sp;
  const z2 = y1 * sp + lz * cp;
  out.x = c.x + x1 * cy + z2 * sy;
  out.y = c.y + y2;
  out.z = c.z - x1 * sy + z2 * cy;
  return out;
}

/** A world point in a car's flat frame (tilt ignored): x right, z back. */
function toLocal(c: Car, x: number, z: number, out: { x: number; z: number }) {
  const dx = x - c.x;
  const dz = z - c.z;
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  out.x = dx * cy - dz * sy;
  out.z = dx * sy + dz * cy;
  return out;
}

const loc = { x: 0, z: 0 };
const pt = { x: 0, y: 0, z: 0 };

/** How far a point lies outside a car's hull, flat (0 inside). */
export function hullDist(c: Car, x: number, z: number) {
  const S = CARS[c.kind];
  toLocal(c, x, z, loc);
  const ox = Math.max(0, Math.abs(loc.x) - S.hw);
  const oz = Math.max(0, Math.abs(loc.z) - S.hl);
  return Math.hypot(ox, oz);
}

// ---------------------------------------------------------------------------------------------------------------
// collision

/** Overlap of one circle (at height y0 to y1) with the world's colliders: the push out of them, summed. */
const push = { x: 0, z: 0, depth: 0 };
function circleWorld(w: World, cx: number, cz: number, r: number, y0: number, y1: number) {
  push.x = 0;
  push.z = 0;
  push.depth = 0;
  forEachNear(w, cx - r - 0.2, cz - r - 0.2, cx + r + 0.2, cz + r + 0.2, (kind, i) => {
    let dx = 0;
    let dz = 0;
    let d = 0;
    let rr = 0;
    if (kind === K_BOX) {
      const o = w.boxes[i];
      if (o.y1 <= y0 || o.y0 >= y1) return;
      const px = Math.min(o.x1, Math.max(o.x0, cx));
      const pz = Math.min(o.z1, Math.max(o.z0, cz));
      dx = cx - px;
      dz = cz - pz;
      d = Math.hypot(dx, dz);
      if (d >= r) return;
      if (d < 1e-6) {
        // the middle is inside: out by the nearest side
        const l = cx - o.x0;
        const rt = o.x1 - cx;
        const f = cz - o.z0;
        const k = o.z1 - cz;
        const mn = Math.min(l, rt, f, k);
        const nx = mn === l ? -1 : mn === rt ? 1 : 0;
        const nz = nx !== 0 ? 0 : mn === f ? -1 : 1;
        push.x += nx * (mn + r);
        push.z += nz * (mn + r);
        push.depth += mn + r;
        return;
      }
      push.x += (dx / d) * (r - d);
      push.z += (dz / d) * (r - d);
      push.depth += r - d;
      return;
    }
    if (kind === K_TRUNK) {
      const t = w.trunks[i];
      if (t.y1 <= y0 || t.y0 >= y1) return;
      dx = cx - t.x;
      dz = cz - t.z;
      rr = t.r + r;
    } else {
      const k = w.rocks[i];
      dx = cx - k.x;
      dz = cz - k.z;
      rr = k.r * 0.9 + r;
      const dd = Math.hypot(dx, dz);
      if (dd >= rr || rockTop(k.r, k.y, Math.max(0, dd - r * 0.5)) <= y0 || k.y - k.r >= y1) return;
    }
    d = Math.hypot(dx, dz);
    if (d >= rr) return;
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    push.x += nx * (rr - d);
    push.z += nz * (rr - d);
    push.depth += rr - d;
  });
}

/** Overlap of one circle with other cars' circles (wrecks too): the push out, summed, and the last one touched. */
let touched: Car | null = null;
function circleCars(m: Match, self: Car, cx: number, cz: number, r: number, y: number) {
  touched = null;
  let px = 0;
  let pz = 0;
  let depth = 0;
  for (const o of m.cars) {
    if (o === self || Math.abs(o.x - cx) > 6 || Math.abs(o.z - cz) > 6 || Math.abs(o.y - y) > 2.5) continue;
    const S = CARS[o.kind];
    const fx = -Math.sin(o.yaw);
    const fz = -Math.cos(o.yaw);
    for (const lz of S.circles) {
      const ox = o.x - fx * lz;
      const oz = o.z - fz * lz;
      const dx = cx - ox;
      const dz = cz - oz;
      const d = Math.hypot(dx, dz);
      const rr = r + S.r;
      if (d >= rr) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      px += nx * (rr - d);
      pz += nz * (rr - d);
      depth += rr - d;
      touched = o;
    }
  }
  push.x = px;
  push.z = pz;
  push.depth = depth;
}

/** How deep a car would be in anything (walls, trunks, rocks, other cars, the edge) at a place, heading and height. */
function overlap(m: Match, c: Car, x: number, z: number, yaw: number, y: number) {
  const S = CARS[c.kind];
  const w = m.world;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let sum = 0;
  for (const lz of S.circles) {
    const cx = x - fx * lz;
    const cz = z - fz * lz;
    circleWorld(w, cx, cz, S.r, y + STEP, y + S.top + 0.3);
    sum += push.depth;
    circleCars(m, c, cx, cz, S.r, y);
    sum += push.depth;
    const A = w.arena;
    sum += Math.max(0, Math.abs(cx) + S.r - A) + Math.max(0, Math.abs(cz) + S.r - A);
  }
  return sum;
}

/** How deep a car is in anything right now (0 when clear): it should never be more than a hair. */
export const carOverlap = (m: Match, c: Car) => overlap(m, c, c.x, c.z, c.yaw, c.y);

/** Ground under each wheel, and the car's height, nose and side tilt from them (riding up on a crest between them). */
const wheels = { y: 0, pitch: 0, roll: 0 };
function wheelGround(w: World, c: Car, x: number, z: number, yaw: number) {
  const S = CARS[c.kind];
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const hb = S.wheelbase / 2;
  const ht = S.track / 2;
  const reach = c.y - 0.05;
  if (ht > 0) {
    const fl = groundAt(w, x + fx * hb - rx * ht, z + fz * hb - rz * ht, reach);
    const fr = groundAt(w, x + fx * hb + rx * ht, z + fz * hb + rz * ht, reach);
    const bl = groundAt(w, x - fx * hb - rx * ht, z - fz * hb - rz * ht, reach);
    const br = groundAt(w, x - fx * hb + rx * ht, z - fz * hb + rz * ht, reach);
    wheels.y = Math.max((fl + fr + bl + br) / 4, groundAt(w, x, z, reach) - S.floor + 0.1);
    wheels.pitch = Math.atan2((fl + fr - bl - br) / 2, S.wheelbase);
    wheels.roll = Math.atan2((fr + br - fl - bl) / 2, S.track);
  } else {
    const f = groundAt(w, x + fx * hb, z + fz * hb, reach);
    const b = groundAt(w, x - fx * hb, z - fz * hb, reach);
    wheels.y = Math.max((f + b) / 2, groundAt(w, x, z, reach) - S.floor + 0.1);
    wheels.pitch = Math.atan2(f - b, S.wheelbase);
    wheels.roll = 0;
  }
  return wheels;
}

// ---------------------------------------------------------------------------------------------------------------
// placing them

/** Could a car stand here: dry, level enough, on the land, clear of everything and of the other cars? */
function fits(w: World, cars: Car[], kind: CarKind, x: number, z: number, yaw: number) {
  const S = CARS[kind];
  const t = w.terrain;
  if (Math.abs(x) > w.arena - 12 || Math.abs(z) > w.arena - 12 || !onLand(w, x, z)) return false;
  for (const o of cars) if (Math.hypot(o.x - x, o.z - z) < 9) return false;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of [-1, 1])
    for (const s of [-1, 1]) {
      const h = floorAt(t, x + fx * S.hl * k - fz * S.hw * s, z + fz * S.hl * k + fx * S.hw * s);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  if (hi - lo > 0.9 || normalAt(t, x, z).y < 0.9) return false;
  if (t.hasWater && !t.ice && heightAt(t, x, z) < t.water + 0.4) return false;
  for (const lz of S.circles) {
    circleWorld(w, x - fx * lz, z - fz * lz, S.r + 0.4, lo - 0.3, hi + S.top + 0.5);
    if (push.depth > 0) return false;
  }
  return true;
}

/** Parks a royale's vehicles (the same seed, the same places): beside the road into each town, then along the roads. */
export function spawnCars(w: World, seed: number, want = 16): Car[] {
  const r = mulberry32(seed * 17 + 5);
  const cars: Car[] = [];
  const kindOf = () => (cars.length % 3 === 2 ? 'bike' : 'jeep');
  /** Tries the side of a road at a point on it (`dx, dz` along it), a few steps either way. */
  const roadside = (px: number, pz: number, dx: number, dz: number) => {
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l;
    const uz = dz / l;
    const side = r() < 0.5 ? -1 : 1;
    const kind = kindOf();
    const off = kind === 'bike' ? 3 : 3.6;
    for (const along of [0, 4, -4, 8, -8])
      for (const s of [side, -side]) {
        const x = px + ux * along - uz * off * s;
        const z = pz + uz * along + ux * off * s;
        // parked along the road, either way round
        const yaw = Math.atan2(-ux, -uz) + (r() < 0.5 ? Math.PI : 0);
        if (fits(w, cars, kind, x, z, yaw)) {
          cars.push(newCar(cars.length, kind, x, floorAt(w.terrain, x, z), z, yaw));
          return true;
        }
      }
    return false;
  };
  // beside the road nearest each town
  const towns = w.towns.filter((t) => Math.abs(t.x) < w.arena - 15 && Math.abs(t.z) < w.arena - 15);
  for (let i = towns.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [towns[i], towns[j]] = [towns[j], towns[i]];
  }
  for (const town of towns) {
    if (cars.length >= want * 0.7) break;
    let best = -1;
    let bestRoad: number[] | null = null;
    let bestD = 45;
    for (const pts of w.roads)
      for (let i = 0; i < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - town.x, pts[i + 1] - town.z);
        // (not right in the middle of town, where the buildings crowd the road)
        if (d < bestD && d > 14) {
          bestD = d;
          best = i;
          bestRoad = pts;
        }
      }
    if (!bestRoad) continue;
    const i = best;
    const j = i + 2 < bestRoad.length ? i + 2 : i - 2;
    if (j < 0) continue;
    const s = j > i ? 1 : -1;
    roadside(bestRoad[i], bestRoad[i + 1], (bestRoad[j] - bestRoad[i]) * s, (bestRoad[j + 1] - bestRoad[i + 1]) * s);
  }
  // then along the roads out in the country
  const roads = w.roads.filter((p) => p.length >= 4);
  for (let k = 0; k < 300 && cars.length < want && roads.length; k++) {
    const pts = roads[Math.floor(r() * roads.length)];
    const i = Math.floor(r() * (pts.length / 2 - 1)) * 2;
    const f = r();
    const x = pts[i] + (pts[i + 2] - pts[i]) * f;
    const z = pts[i + 1] + (pts[i + 3] - pts[i + 1]) * f;
    if (cars.some((o) => Math.hypot(o.x - x, o.z - z) < 40)) continue;
    roadside(x, z, pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  }
  return cars;
}

// ---------------------------------------------------------------------------------------------------------------
// getting in and out

/** The car an actor would get into with F: alive, with a free seat, its hull within reach. */
export function carNear(m: Match, a: Actor): Car | null {
  if (!m.cars.length || !a.alive || a.drop || a.car >= 0) return null;
  let best: Car | null = null;
  let bestD = CAR_REACH;
  for (const c of m.cars) {
    if (!c.alive || Math.abs(c.x - a.body.x) > 5 || Math.abs(c.z - a.body.z) > 5 || Math.abs(a.body.y - c.y) > 2.2) continue;
    if (!c.seats.includes(-1)) continue;
    const d = hullDist(c, a.body.x, a.body.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function enterCar(m: Match, a: Actor, c: Car) {
  if (!c.alive || a.car >= 0) return false;
  // the wheel if it's free, else the first free seat
  const k = c.seats[0] < 0 ? 0 : c.seats.indexOf(-1);
  if (k < 0) return false;
  c.seats[k] = a.id;
  if (c.claim === a.id) c.claim = -1;
  a.car = c.id;
  a.carSeat = k;
  a.crouch = 0;
  a.ads = 0;
  a.healT = 0;
  a.healKind = null;
  if (k === 0) {
    a.reloadT = 0;
    c.lastDriver = a.id;
  }
  c.sleep = false;
  seatBody(c, a);
  m.events.push({ t: 'car', a: a.id, car: c.id, on: true });
  return true;
}

/** Puts a rider's body in its seat, moving with the car. */
function seatBody(c: Car, a: Actor) {
  const s = CARS[c.kind].seats[a.carSeat];
  carPoint(c, s[0], s[1], s[2], pt);
  const b = a.body;
  b.x = pt.x;
  b.y = pt.y - HIP;
  b.z = pt.z;
  b.vx = c.vx;
  b.vy = 0;
  b.vz = c.vz;
  b.onGround = true;
  b.swim = false;
  b.height = STAND_H;
}

/** Is a standing body at (x, y, z) inside any car's hull? */
function inCar(m: Match, x: number, z: number, y: number) {
  for (const c of m.cars) {
    if (Math.abs(c.x - x) > 5 || Math.abs(c.z - z) > 5) continue;
    if (y > c.y + CARS[c.kind].top || y + STAND_H < c.y) continue;
    if (hullDist(c, x, z) < RADIUS + 0.05) return true;
  }
  return false;
}

/** Where someone getting out stands: beside their seat if it's clear, else the other side, the back, the front, or
 * further round; dry ground first. */
function exitSpot(m: Match, c: Car, seat: number, out: { x: number; y: number; z: number }) {
  const w = m.world;
  const t = w.terrain;
  const S = CARS[c.kind];
  const s = S.seats[seat] ?? S.seats[0];
  const side = s[0] > 0.01 ? 1 : -1;
  const ox = S.hw + 0.75;
  const near: [number, number][] = [
    [side * ox, s[2]],
    [side * ox, s[2] + 1.1],
    [side * ox, s[2] - 1.1],
    [-side * ox, s[2]],
    [0, S.hl + 0.8],
    [0, -S.hl - 0.8],
  ];
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  const deepHere = t.hasWater && !t.ice && heightAt(t, c.x, c.z) < t.water - SWIM_DEPTH;
  for (let pass = 0; pass < 2; pass++) {
    const tryAt = (lx: number, lz: number) => {
      const x = c.x + lx * cy + lz * sy;
      const z = c.z - lx * sy + lz * cy;
      if (Math.abs(x) > w.arena - 1 || Math.abs(z) > w.arena - 1) return false;
      const y = groundAt(w, x, z, c.y + 0.9);
      if (Math.abs(y - c.y) > 3) return false;
      if (pass === 0 && !deepHere && t.hasWater && !t.ice && heightAt(t, x, z) < t.water - SWIM_DEPTH) return false;
      if (blockedAt(w, x, z, y) || inCar(m, x, z, y)) return false;
      out.x = x;
      out.y = y;
      out.z = z;
      return true;
    };
    for (const [lx, lz] of near) if (tryAt(lx, lz)) return true;
    for (const rad of [3, 4.5, 6.5])
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        if (tryAt(Math.cos(a) * rad, Math.sin(a) * rad)) return true;
      }
  }
  return false;
}

const spot = { x: 0, y: 0, z: 0 };
/** Gets an actor out (F, a knockout, the car blowing up): on the ground beside it, never inside a wall. */
export function leaveCar(m: Match, a: Actor) {
  if (a.car < 0) return;
  const c = m.cars[a.car];
  const seat = a.carSeat;
  a.car = -1;
  a.carSeat = -1;
  if (!c) return;
  if (c.seats[seat] === a.id) c.seats[seat] = -1;
  const b = a.body;
  if (exitSpot(m, c, seat, spot)) {
    b.x = spot.x;
    b.y = spot.y;
    b.z = spot.z;
  } else {
    // boxed in on every side: out over the top
    b.x = c.x;
    b.z = c.z;
    b.y = c.y + CARS[c.kind].top + 0.05;
  }
  // stepping off a moving car keeps a little of its speed
  b.vx = c.vx * 0.3;
  b.vz = c.vz * 0.3;
  b.vy = 0;
  b.onGround = false;
  b.height = STAND_H;
  a.lastX = b.x;
  a.lastZ = b.z;
  c.sleep = false;
  m.events.push({ t: 'car', a: a.id, car: c.id, on: false });
}

/** A rider's controls: the driver's go to the car (and they do nothing else); a passenger keeps their hands for the
 * gun, and takes the wheel if it is free and they press on. Returns the input the rest of the actor's frame sees. */
export function rideInput(m: Match, a: Actor, inp: Input): Input {
  const c = m.cars[a.car];
  // nobody at the wheel: a passenger who steps on it slides over and drives
  if (c && a.carSeat > 0 && c.seats[0] < 0 && inp.mz !== 0) {
    c.seats[a.carSeat] = -1;
    c.seats[0] = a.id;
    a.carSeat = 0;
    c.lastDriver = a.id;
    a.reloadT = 0;
    a.ads = 0;
    a.healT = 0;
    a.healKind = null;
  }
  if (a.carSeat === 0 && c) {
    c.throttle = clamp(inp.mz, -1, 1);
    c.turn = clamp(inp.mx, -1, 1);
    c.brake = inp.jump;
    return { ...inp, mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, ads: false, throw: null, heal: false, reload: false, use: false };
  }
  return { ...inp, mx: 0, mz: 0, jump: false, crouch: false, walk: false, use: false };
}

// ---------------------------------------------------------------------------------------------------------------
// damage

/** Wears a car down; at none it blows up. `from` is who did it (-1 nobody: a crash). */
export function hurtCar(m: Match, c: Car, dmg: number, from: number) {
  if (!c.alive || dmg <= 0) return;
  c.hp -= dmg;
  if (from >= 0) c.lastHit = from;
  c.hurtT = m.time;
  c.sleep = false;
  if (c.hp <= 0) blowCar(m, c);
}

const blastHit = newHit();
/** The car goes up: whoever is in it is thrown clear and badly hurt, and the blast hurts people and cars around it. */
function blowCar(m: Match, c: Car) {
  const S = CARS[c.kind];
  c.alive = false;
  c.hp = 0;
  c.wreckT = m.time;
  c.vx = c.vy = c.vz = 0;
  c.speed = 0;
  c.throttle = 0;
  c.claim = -1;
  // the knockouts belong to whoever wrecked it lately, else to nobody (it crashed)
  const by = c.lastHit >= 0 && m.time - c.hurtT < 12 ? c.lastHit : -1;
  const cx = c.x;
  const cy = c.y + S.top * 0.7;
  const cz = c.z;
  m.events.push({ t: 'boom', x: cx, y: cy, z: cz });
  m.sounds.push({ x: cx, z: cz, t: m.time, team: -1, range: 140, who: by });
  const riders: Actor[] = [];
  for (const id of c.seats) if (id >= 0) riders.push(m.actors[id]);
  for (const a of riders) {
    leaveCar(m, a);
    damage(m, a, 120, by, 'car', 'body', a.body.x, a.body.y + 1, a.body.z);
  }
  const R = 8;
  for (const a of m.actors) {
    if (!a.alive || a.drop === 1 || riders.includes(a)) continue;
    const ay = a.body.y + a.body.height * 0.55;
    const dx = a.body.x - cx;
    const dy = ay - cy;
    const dz = a.body.z - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d > R) continue;
    const l = d || 1;
    rayWorld(m.world, cx, cy, cz, dx / l, dy / l, dz / l, l, blastHit);
    const cover = blastHit.kind === 'none' ? 1 : 0.25;
    damage(m, a, 130 * Math.pow(1 - d / R, 1.2) * cover, by, 'car', 'body', a.body.x, ay, a.body.z);
  }
  for (const o of m.cars) {
    if (o === c || !o.alive) continue;
    const d = Math.hypot(o.x - cx, o.z - cz);
    if (d < R + 2) hurtCar(m, o, 320 * (1 - d / (R + 2)), by);
  }
}

/** A grenade or other blast at a point: cars near it take it hard. */
export function blastCars(m: Match, x: number, y: number, z: number, R: number, dmg: number, from: number) {
  for (const c of m.cars) {
    if (!c.alive || Math.abs(c.x - x) > R + 3 || Math.abs(c.z - z) > R + 3) continue;
    const d = Math.max(0, Math.hypot(hullDist(c, x, z), Math.max(0, c.y - y, y - c.y - CARS[c.kind].top)));
    if (d < R) hurtCar(m, c, dmg * (1 - d / R), from);
  }
}

/** The first car a bullet's segment meets (the shooter's own excepted): its id, the distance and the face's normal. */
export const carHit = { car: -1, t: 0, nx: 0, ny: 0, nz: 0 };
export function rayCars(m: Match, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, skip: number) {
  carHit.car = -1;
  carHit.t = max;
  for (const c of m.cars) {
    if (c.id === skip) continue;
    const S = CARS[c.kind];
    // broad phase: the segment must pass near the car's middle
    const mx = c.x - ox;
    const mz = c.z - oz;
    const along = clamp(mx * dx + mz * dz, 0, max);
    if ((mx - dx * along) ** 2 + (mz - dz * along) ** 2 > (S.hl + 1) ** 2) continue;
    // the segment in the car's flat frame, against its box
    const cy = Math.cos(c.yaw);
    const sy = Math.sin(c.yaw);
    const lx = mx * -cy + mz * sy;
    const lz = mx * -sy - mz * cy;
    const ldx = dx * cy - dz * sy;
    const ldz = dx * sy + dz * cy;
    let t0 = 0;
    let t1 = carHit.t;
    let axis = -1;
    let sign = 0;
    const slab = (o: number, d: number, lo: number, hi: number, ax: number) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      let s = -1;
      if (ta > tb) {
        const tmp = ta;
        ta = tb;
        tb = tmp;
        s = 1;
      }
      if (ta > t0) {
        t0 = ta;
        axis = ax;
        sign = s;
      }
      if (tb < t1) t1 = tb;
      return t0 <= t1;
    };
    if (!slab(lx, ldx, -S.hw, S.hw, 0) || !slab(oy, dy, c.y + S.floor, c.y + S.top, 1) || !slab(lz, ldz, -S.hl, S.hl, 2) || axis < 0) continue;
    carHit.car = c.id;
    carHit.t = t0;
    // the face's normal back in the world
    const nlx = axis === 0 ? sign : 0;
    const nlz = axis === 2 ? sign : 0;
    carHit.nx = nlx * cy + nlz * sy;
    carHit.nz = -nlx * sy + nlz * cy;
    carHit.ny = axis === 1 ? sign : 0;
  }
  return carHit.car >= 0;
}

// ---------------------------------------------------------------------------------------------------------------
// driving

const before = { x: 0, z: 0, yaw: 0 };

/** One car's frame: engine, brakes, slopes, steering and grip, then the move, pushed out of what it meets. */
function drive(m: Match, c: Car, driver: Actor | null, dt: number) {
  const S = CARS[c.kind];
  const w = m.world;
  const t = w.terrain;
  let thr = driver ? c.throttle : 0;
  const turn = driver ? c.turn : 0;
  const hand = driver ? c.brake : true;
  // water: wading slows it, deep water floods the engine (it dries out once back in the shallows)
  const depth = t.hasWater && !t.ice ? t.water - heightAt(t, c.x, c.z) : -9;
  if (depth > S.wade) c.flooded = true;
  else if (depth < S.wade * 0.4) c.flooded = false;
  if (c.flooded) thr = 0;
  const wet = clamp((depth - 0.2) / Math.max(0.1, S.wade - 0.2), 0, 1);
  const vmax = S.vmax * (1 - 0.72 * wet);
  const ice = t.ice && heightAt(t, c.x, c.z) < t.water;
  c.steer += clamp(turn - c.steer, -dt * 3.2, dt * 3.2);
  const n = Math.min(8, Math.max(1, Math.ceil((Math.hypot(c.vx, c.vz) * dt) / 0.3)));
  const h = dt / n;
  let vf = 0;
  for (let s = 0; s < n; s++) {
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const rx = -fz;
    const rz = fx;
    vf = c.vx * fx + c.vz * fz;
    let vl = c.vx * rx + c.vz * rz;
    if (c.onGround) {
      // engine and brakes
      if (thr > 0) vf += vf < -0.3 ? S.brake * thr * h : S.accel * thr * Math.max(0, 1 - vf / vmax) * h;
      else if (thr < 0) vf += vf > 0.3 ? -S.brake * -thr * h : -S.accel * 0.7 * -thr * Math.max(0, 1 + vf / S.vrev) * h;
      // rolling, the air and the water hold it back; the handbrake (or nobody at the wheel) stops it
      const drag = (0.5 + 0.011 * vf * vf + 7 * wet + (thr === 0 ? 1.2 : 0)) * h + (hand ? (driver ? 9 : 14) * h : 0);
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag);
      // a slope pulls it back down
      vf -= SLOPE_G * Math.sin(c.pitch) * h;
      // the tyres hold it in line (less with the handbrake on, much less on ice)
      vl *= Math.exp(-(hand && driver ? 1.6 : S.grip) * (ice ? 0.25 : 1) * h);
    }
    // steering: the front wheels turn it about the back axle, a little less lock the faster it goes
    const lock = S.steer / (1 + Math.abs(vf) / 15);
    const nyaw = c.onGround ? c.yaw - ((vf * Math.tan(c.steer * lock)) / S.wheelbase) * h : c.yaw;
    c.vx = fx * vf + rx * vl;
    c.vz = fz * vf + rz * vl;
    move(m, c, c.x + c.vx * h, c.z + c.vz * h, nyaw, h);
  }
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  c.speed = c.vx * fx + c.vz * fz;
  c.spin += (c.speed * dt) / S.wheel;
  // a bike leans into its turns
  if (S.track === 0) c.roll = -c.steer * clamp(Math.abs(c.speed) / 12, 0, 1) * 0.42;
}

/** Moves a car to (nx, nz) heading nyaw if it can: out of what it runs into, never onto a cliff, never deeper into
 * anything than it was. Then its height and tilt from the ground under its wheels. */
function move(m: Match, c: Car, nx: number, nz: number, nyaw: number, h: number) {
  const S = CARS[c.kind];
  const w = m.world;
  before.x = c.x;
  before.z = c.z;
  before.yaw = c.yaw;
  const was = overlap(m, c, c.x, c.z, c.yaw, c.y);
  // pushed out of what it meets, a couple of passes (a corner pushes from two sides)
  let hitX = 0;
  let hitZ = 0;
  let other: Car | null = null;
  const fx = -Math.sin(nyaw);
  const fz = -Math.cos(nyaw);
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const lz of S.circles) {
      const cx = nx - fx * lz;
      const cz = nz - fz * lz;
      circleWorld(w, cx, cz, S.r, c.y + STEP, c.y + S.top + 0.3);
      if (push.depth > 0) {
        nx += push.x;
        nz += push.z;
        hitX += push.x;
        hitZ += push.z;
        moved = true;
      }
      circleCars(m, c, nx - fx * lz, nz - fz * lz, S.r, c.y);
      if (push.depth > 0) {
        nx += push.x;
        nz += push.z;
        hitX += push.x;
        hitZ += push.z;
        other = touched;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const A = w.arena - S.r;
  const ex = clamp(nx, -A, A) - nx;
  const ez = clamp(nz, -A, A) - nz;
  if (ex || ez) {
    nx += ex;
    nz += ez;
    hitX += ex;
    hitZ += ez;
  }
  // the height it would have there (on the ground, or falling) must leave it clear too
  let g = wheelGround(w, c, nx, nz, nyaw);
  const fall = c.y + c.vy * h - GRAVITY * h * h;
  const flying = fall > g.y + 0.03 && (!c.onGround || c.vy > 0.5 || fall > g.y + 0.25);
  let ok = overlap(m, c, nx, nz, nyaw, flying ? fall : g.y) <= Math.max(0.01, was - 1e-4);
  // the ground there: too steep to climb (or to drive across) and getting steeper, it is a wall
  if (ok) {
    const rising = g.y > c.y + 0.02;
    if ((Math.abs(g.pitch) > MAX_PITCH && Math.abs(g.pitch) > Math.abs(c.pitch) + 1e-3 && rising) || (Math.abs(g.roll) > MAX_ROLL && Math.abs(g.roll) > Math.abs(c.roll) + 1e-3 && rising)) {
      ok = false;
      hitX = before.x - nx;
      hitZ = before.z - nz;
    }
  }
  if (!ok) {
    // nowhere to go: stay put, and the push is straight back along the way it came
    nx = before.x;
    nz = before.z;
    nyaw = before.yaw;
    if (!hitX && !hitZ) {
      hitX = -c.vx;
      hitZ = -c.vz;
    }
  }
  c.x = nx;
  c.z = nz;
  c.yaw = nyaw;
  // what it hit takes the speed into it (with a little bounce), and a hard hit hurts it and its riders
  const hl = Math.hypot(hitX, hitZ);
  if (hl > 1e-6) {
    const ux = hitX / hl;
    const uz = hitZ / hl;
    const vn = c.vx * ux + c.vz * uz;
    if (vn < 0) {
      c.vx -= 1.25 * vn * ux;
      c.vz -= 1.25 * vn * uz;
      const hard = -vn;
      if (other && other.alive) {
        // the other car is shoved along
        other.vx -= vn * ux * 0.6;
        other.vz -= vn * uz * 0.6;
        other.sleep = false;
        if (hard > 6) hurtCar(m, other, (hard - 6) * 9, c.seats[0]);
      }
      crash(m, c, hard);
    }
    if (!ok) {
      c.vx *= 0.5;
      c.vz *= 0.5;
    }
  }
  // height: on the ground, or flying off a crest until it comes down
  if (!ok) {
    g = wheelGround(w, c, c.x, c.z, c.yaw);
    // held where it was: settling there must not sink it into anything either (else it rests on it)
    const air = fall > g.y + 0.03 && (!c.onGround || c.vy > 0.5 || fall > g.y + 0.25);
    if (overlap(m, c, c.x, c.z, c.yaw, air ? fall : g.y) > Math.max(0.01, was + 1e-4)) {
      c.vy = 0;
      c.onGround = true;
      return;
    }
  }
  if (fall > g.y + 0.03 && (!c.onGround || c.vy > 0.5 || fall > g.y + 0.25)) {
    c.vy -= GRAVITY * h;
    c.y = fall;
    c.onGround = false;
    // in the air the body levels out a little
    c.pitch *= 1 - Math.min(1, h * 0.8);
  } else {
    if (!c.onGround && c.vy < -9) crash(m, c, -c.vy - 4);
    // (the climb's rate carries it off a crest; eased, so a kerb is a bump and not a launch)
    c.vy = c.onGround ? clamp(c.vy + ((g.y - c.y) / h - c.vy) * 0.5, -15, 7) : 0;
    c.y = g.y;
    c.onGround = true;
    c.pitch = g.pitch;
    if (S.track > 0) c.roll = g.roll;
  }
}

/** A hard knock: the car is hurt, and over a point its riders too. */
function crash(m: Match, c: Car, hard: number) {
  if (hard < 5) return;
  m.events.push({ t: 'crash', x: c.x, y: c.y + 0.8, z: c.z, v: hard });
  hurtCar(m, c, (hard - 5) * 11, -1);
  if (hard > 13)
    for (const id of c.seats)
      if (id >= 0) {
        const a = m.actors[id];
        if (a.alive) damage(m, a, (hard - 13) * 4, -1, 'car', 'body', a.body.x, a.body.y + 1, a.body.z);
      }
}

/** Someone on foot in a car's way: knocked down hard at speed, else just moved aside. */
function bump(m: Match, c: Car, moving: boolean) {
  const S = CARS[c.kind];
  const speed = Math.abs(c.speed);
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  for (const a of m.actors) {
    if (!a.alive || a.drop || a.car >= 0) continue;
    const b = a.body;
    if (Math.abs(b.x - c.x) > S.hl + 1 || Math.abs(b.z - c.z) > S.hl + 1) continue;
    if (b.y > c.y + S.top || b.y + b.height < c.y + 0.1) continue;
    toLocal(c, b.x, b.z, loc);
    const ex = S.hw + RADIUS - Math.abs(loc.x);
    const ez = S.hl + RADIUS - Math.abs(loc.z);
    if (ex <= 0 || ez <= 0) continue;
    if (moving && speed > 4.5) {
      if (m.time - a.runT > 0.8) {
        a.runT = m.time;
        const by = c.seats[0] >= 0 ? c.seats[0] : c.lastDriver;
        // (run down at speed is a knockout for a person too: their extra health doesn't save them here)
        damage(m, a, (speed - 3) * 12 * (a.bot ? 1 : PERSON_HEALTH), by, 'car', 'body', b.x, b.y + 1, b.z);
        // thrown up and along
        b.vx = c.vx * 0.8 + (loc.x > 0 ? cy : -cy) * 2.5;
        b.vz = c.vz * 0.8 + (loc.x > 0 ? -sy : sy) * 2.5;
        b.vy = 4.5;
        b.onGround = false;
        c.vx *= 0.88;
        c.vz *= 0.88;
        m.events.push({ t: 'crash', x: b.x, y: b.y + 1, z: b.z, v: speed * 0.5 });
      }
    }
    // out of the hull the short way, unless that would be into a wall
    let lx = loc.x;
    let lz = loc.z;
    if (ex < ez) lx += Math.sign(loc.x || 1) * ex;
    else lz += Math.sign(loc.z || 1) * ez;
    const x = c.x + lx * cy + lz * sy;
    const z = c.z - lx * sy + lz * cy;
    if (!blockedAt(m.world, x, z, b.y)) {
      b.x = x;
      b.z = z;
    }
  }
}

/** Every car's frame (after the actors have acted: the drivers have set their controls). */
export function stepCars(m: Match, dt: number) {
  for (const c of m.cars) {
    if (!c.alive) {
      bump(m, c, false);
      continue;
    }
    // (a seat whose rider is gone, by whatever way, is free again)
    for (let k = 0; k < c.seats.length; k++) {
      const id = c.seats[k];
      if (id >= 0 && (!m.actors[id].alive || m.actors[id].car !== c.id)) c.seats[k] = -1;
    }
    const driver = c.seats[0] >= 0 ? m.actors[c.seats[0]] : null;
    let empty = true;
    for (const id of c.seats) if (id >= 0) empty = false;
    if (c.sleep && empty) {
      bump(m, c, false);
      continue;
    }
    c.sleep = false;
    drive(m, c, driver, dt);
    for (const id of c.seats) if (id >= 0) seatBody(c, m.actors[id]);
    bump(m, c, true);
    // parked and still: rest until something wakes it
    if (empty && c.onGround && Math.hypot(c.vx, c.vz) < 0.05) {
      c.vx = c.vz = c.vy = 0;
      c.speed = 0;
      c.sleep = true;
    }
  }
}
