// Getting up onto things: a mantle onto a ledge you face (a wall, a crate, a car, a low roof), a vault over something
// low you run at (a sandbag wall, a fence, a window sill), and ladders. Pure geometry on the world's colliders, so the
// same input gives the same climb on every machine and under node. A climb is a short move along a fixed path whose
// every part was checked clear before it starts (never into anything solid, never through a wall); match.ts plays it
// out and the renderer shows it.
import { CROUCH_H, RADIUS, STAND_H, STEP_UP, forEachNear, groundAt, rockTop } from './physics.ts';
import { K_BOX, K_TRUNK, type Ladder, type World } from './world.ts';

/** A ledge is mantled onto from this high over the ground you jumped from, up to MANTLE_HI. */
export const MANTLE_LO = 0.9;
export const MANTLE_HI = 2.1;
/** Running at something no higher than this (and thin enough), you vault over it. */
export const VAULT_HI = 1.15;
/** Pressing jump this long after leaving the ground still catches a ledge. */
export const GRAB_T = 0.6;
/** How far out from a ladder's face a body hangs on it, and how fast it climbs up and down (m/s). */
export const LADDER_OFF = RADIUS + 0.2;
export const LADDER_UP = 2.4;
export const LADDER_DOWN = 3;

/**
 * A climb under way: k is 1 a mantle up onto a ledge, 2 a vault over something low, 3 off the top of a ladder onto
 * what it leads to, 4 off a roof onto the top of a ladder (`lad`, which it holds once there). It runs dur seconds from
 * (x0, y0, z0) to (x1, y1, z1), passing over at height ym.
 */
export type Climb = { k: number; t: number; dur: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; ym: number; lad: number };

/** The highest top of the colliders over (x, z) that stand in the way of a body at y (taller than a step, starting below
 * its chest): -Infinity when nothing does, Infinity when one of them is too tall to climb (or a tree or a rock). */
function inWay(w: World, x: number, z: number, y: number) {
  const lo = y + 0.35;
  const hi = y + MANTLE_HI + 0.02;
  let top = -Infinity;
  forEachNear(w, x - 0.05, z - 0.05, x + 0.05, z + 0.05, (kind, i) => {
    if (top === Infinity) return;
    if (kind === K_BOX) {
      const b = w.boxes[i];
      if (x <= b.x0 || x >= b.x1 || z <= b.z0 || z >= b.z1 || b.y1 <= lo || b.y0 >= y + 1.5) return;
      if (b.y1 > hi) top = Infinity;
      else if (b.y1 > top) top = b.y1;
    } else if (kind === K_TRUNK) {
      const t = w.trunks[i];
      if (t.y1 > lo && Math.hypot(x - t.x, z - t.z) < t.r) top = Infinity;
    } else {
      const k = w.rocks[i];
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < k.r && rockTop(k.r, k.y, d) > lo) top = Infinity;
    }
  });
  return top;
}

/** The highest top over (x, z) of the boxes reaching from below ylo up past it (no higher than yhi). */
function under(w: World, x: number, z: number, ylo: number, yhi: number) {
  let top = -Infinity;
  forEachNear(w, x - 0.05, z - 0.05, x + 0.05, z + 0.05, (kind, i) => {
    if (kind !== K_BOX) return;
    const b = w.boxes[i];
    if (x <= b.x0 || x >= b.x1 || z <= b.z0 || z >= b.z1 || b.y1 <= ylo || b.y0 >= yhi) return;
    if (b.y1 > top) top = b.y1;
  });
  return top;
}

/** Nothing solid in a body of radius r swept from (ax, az) to (bx, bz) between heights ylo and yhi? */
export function sweepClear(w: World, ax: number, az: number, bx: number, bz: number, ylo: number, yhi: number, r: number) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.1));
  let hit = false;
  for (let s = 0; s <= n && !hit; s++) {
    const x = ax + ((bx - ax) * s) / n;
    const z = az + ((bz - az) * s) / n;
    forEachNear(w, x - r, z - r, x + r, z + r, (kind, i) => {
      if (hit) return;
      if (kind === K_BOX) {
        const o = w.boxes[i];
        if (o.y1 <= ylo || o.y0 >= yhi) return;
        const cx = Math.min(o.x1, Math.max(o.x0, x));
        const cz = Math.min(o.z1, Math.max(o.z0, z));
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) hit = true;
      } else if (kind === K_TRUNK) {
        const t = w.trunks[i];
        if (t.y1 > ylo && t.y0 < yhi && Math.hypot(x - t.x, z - t.z) < t.r + r) hit = true;
      } else {
        const k = w.rocks[i];
        const dd = Math.hypot(x - k.x, z - k.z);
        if (dd < k.r * 0.9 + r && rockTop(k.r, k.y, Math.max(0, dd - r)) > ylo && k.y - k.r < yhi) hit = true;
      }
    });
  }
  return !hit;
}

/** Room to stand at (x, z) on the floor at y: nothing from a step over it up to a standing head (as physics sees it). */
const standRoom = (w: World, x: number, z: number, y: number) => sweepClear(w, x, z, x, z, y + STEP_UP, y + STAND_H, RADIUS);

/**
 * The climb a body at (x, y, z) facing yaw gets from pressing jump, or null: a vault when it runs (`run`) at something
 * low and thin enough with clear ground past it, else a mantle onto a ledge 0.9 to 2.1 m over `base` (the ground it
 * jumped from, its feet when standing) with room to stand on top. The ledge must run on either side of the middle (not
 * a post), the way up and over must be clear for the body, and nothing too tall may stand in the way.
 */
export function findClimb(w: World, x: number, y: number, z: number, yaw: number, run: boolean, base = y): Climb | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const sx = Math.cos(yaw);
  const sz = -Math.sin(yaw);
  // the face: the first point ahead where something stands in the way
  let face = -1;
  let Y = -Infinity;
  for (let d = RADIUS + 0.02; d <= RADIUS + 0.75; d += 0.06) {
    const t = inWay(w, x + fx * d, z + fz * d, y);
    if (t === -Infinity) continue;
    if (t === Infinity) return null;
    face = d;
    Y = t;
    break;
  }
  if (face < 0 || Y - base > MANTLE_HI + 1e-6) return null;
  // the same ledge a hand's width either side
  for (const s of [-0.22, 0.22]) {
    let found = false;
    for (let d = face - 0.12; d <= face + 0.3 && !found; d += 0.06) {
      const t = inWay(w, x + fx * d + sx * s, z + fz * d + sz * s, y);
      if (t === Infinity || (t !== -Infinity && Math.abs(t - Y) > 0.12)) return null;
      found = t !== -Infinity;
    }
    if (!found) return null;
  }
  const r = RADIUS * 0.8;
  // a vault: over the top within a little over a meter, crouched low over it, and down the far side
  if (run && Y - y <= VAULT_HI) {
    let far = -1;
    for (let d = face + 0.06; d <= face + 1.3; d += 0.06)
      if (under(w, x + fx * d, z + fz * d, Y - 0.3, Y + 0.05) === -Infinity) {
        far = d;
        break;
      }
    if (far > 0) {
      const lx = x + fx * (far + RADIUS + 0.08);
      const lz = z + fz * (far + RADIUS + 0.08);
      const g = groundAt(w, lx, lz, Y);
      const ym = Y + 0.05;
      const end = Math.max(g, Math.min(y, ym - 0.4));
      if (g > Y - 6 && sweepClear(w, x, z, x, z, y + STEP_UP, ym + 1, r) && sweepClear(w, x, z, lx, lz, ym - 0.02, ym + 1, r) && sweepClear(w, lx, lz, lx, lz, end + STEP_UP, Math.max(ym + 1, end + STAND_H), r) && standRoom(w, lx, lz, g))
        return { k: 2, t: 0, dur: 0.46, x0: x, y0: y, z0: z, x1: lx, y1: end, z1: lz, ym, lad: -1 };
    }
  }
  // a mantle: up the face and onto the top, standing
  if (Y - base < MANTLE_LO || Y - y < 0.25) return null;
  const dx = x + fx * (face + RADIUS + 0.12);
  const dz = z + fz * (face + RADIUS + 0.12);
  const top = groundAt(w, dx, dz, Y);
  const lip = groundAt(w, x + fx * (face + 0.25), z + fz * (face + 0.25), Y);
  if (top < Y - 0.05 || top > Y + 0.3 || lip < Y - 0.05) return null;
  if (!standRoom(w, dx, dz, top) || !sweepClear(w, x, z, x, z, y + STEP_UP, top + STAND_H, r) || !sweepClear(w, x, z, dx, dz, top + 0.03, top + STAND_H, r)) return null;
  const h = top - y;
  return { k: 1, t: 0, dur: 0.32 + 0.2 * h, x0: x, y0: y, z0: z, x1: dx, y1: top, z1: dz, ym: top, lad: -1 };
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Where a climb has the body at its time (its feet). Each part of the path was checked clear before it started:
 * straight up where the body stood, then across at the height it goes over, then (a vault) down where it lands. */
export function climbAt(c: Climb, out: { x: number; y: number; z: number }) {
  const t = Math.min(1, Math.max(0, c.t / c.dur));
  // (the share of the time spent going up, and the time it is over and coming down)
  const up = c.k === 1 ? 0.55 : c.k === 2 ? 0.3 : 0;
  const over = c.k === 2 ? 0.78 : 1;
  if (t < up) {
    out.x = c.x0;
    out.z = c.z0;
    out.y = c.y0 + (c.ym - c.y0) * ease(t / up);
  } else if (t < over) {
    const e = ease((t - up) / (over - up));
    out.x = c.x0 + (c.x1 - c.x0) * e;
    out.z = c.z0 + (c.z1 - c.z0) * e;
    out.y = c.ym;
  } else {
    out.x = c.x1;
    out.z = c.z1;
    out.y = over < 1 ? c.ym + (c.y1 - c.ym) * ease((t - over) / (1 - over)) : c.y1;
  }
  return out;
}

/** How low a climb has the body (its height) at its time: hunched over the top of a mantle, tucked under a meter going
 * over a vault (what its path was checked clear for), standing again at the end. */
export function climbHeight(c: Climb) {
  if (c.k > 2) return STAND_H;
  const t = Math.min(1, c.t / c.dur);
  if (c.k === 1) return STAND_H + (CROUCH_H - 0.15 - STAND_H) * Math.sin(Math.PI * Math.min(1, t * 1.15));
  const low = 0.95;
  return t < 0.3 ? STAND_H + (low - STAND_H) * ease(t / 0.3) : t < 0.78 ? low : low + (STAND_H - low) * ease((t - 0.78) / 0.22);
}

/** Where a body hangs on a ladder. */
export const ladderSpot = (l: Ladder): [number, number] => [l.x + l.nx * LADDER_OFF, l.z + l.nz * LADDER_OFF];

/**
 * The ladder a body at (x, y, z) gets onto moving along the world direction (mx, mz), or null: at its foot walking into
 * it, or at its top (on the roof or platform it comes up to, in line with it) walking out over the edge.
 */
export function ladderToGet(w: World, x: number, y: number, z: number, mx: number, mz: number): { i: number; top: boolean } | null {
  for (let i = 0; i < w.ladders.length; i++) {
    const l = w.ladders[i];
    const dx = x - l.x;
    const dz = z - l.z;
    if (Math.abs(dx) > 2 || Math.abs(dz) > 2) continue;
    const out = dx * l.nx + dz * l.nz;
    const side = -dx * l.nz + dz * l.nx;
    const into = -(mx * l.nx + mz * l.nz);
    // (a tower's ladder has no wall behind it: walking on past its face, under the tower, still takes hold of it)
    if (Math.abs(side) < l.hw + 0.25 && y < l.y1 - 0.6 && y > l.y0 - 0.5 && y < l.y0 + 1.3 && out > -0.7 && out < LADDER_OFF + 0.45 && into > 0.5) return { i, top: false };
    if (Math.abs(side) < 0.3 && Math.abs(y - l.y1) < 0.35 && out < 0.3 && out > -1.3 && into < -0.5) return { i, top: true };
  }
  return null;
}

/** Off the top of a ladder onto what it leads to: the climb there, or null if anything is in the way. */
export function ladderOff(w: World, i: number, y: number): Climb | null {
  const l = w.ladders[i];
  const [px, pz] = ladderSpot(l);
  const qx = l.x - l.nx * 0.78;
  const qz = l.z - l.nz * 0.78;
  const g = groundAt(w, qx, qz, l.y1);
  if (Math.abs(g - l.y1) > 0.3 || !standRoom(w, qx, qz, g) || !sweepClear(w, px, pz, qx, qz, Math.max(g, y) + 0.03, Math.max(g, y) + STAND_H, RADIUS * 0.8)) return null;
  return { k: 3, t: 0, dur: 0.45, x0: px, y0: y, z0: pz, x1: qx, y1: g, z1: qz, ym: Math.max(g, y), lad: -1 };
}

/** From the roof (or platform) at (x, z) onto the top of a ladder: the climb there, or null if anything is in the way. */
export function ladderOn(w: World, i: number, x: number, y: number, z: number): Climb | null {
  const l = w.ladders[i];
  const [px, pz] = ladderSpot(l);
  if (!sweepClear(w, x, z, px, pz, y + 0.03, y + STAND_H, RADIUS * 0.8)) return null;
  return { k: 4, t: 0, dur: 0.4, x0: x, y0: y, z0: z, x1: px, y1: y, z1: pz, ym: y, lad: i };
}
