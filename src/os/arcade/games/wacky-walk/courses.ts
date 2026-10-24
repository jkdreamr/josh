import { hash } from './rng.ts';
import type { Collider, Course, CourseId, Pose, RaceId, Shape, Vec3, Waypoint } from './types.ts';

export const RACES: readonly RaceId[] = ['oval', 'fountain', 'palm'];
export const COURSE_NAMES: Record<CourseId, string> = {
  oval: 'the oval',
  fountain: 'claw fountain',
  palm: 'palm drive',
  tiles: 'main quad tiles',
  hoover: 'hoover climb',
};
export const LIMITS: Record<CourseId, number> = { oval: 120, fountain: 120, palm: 120, tiles: 90, hoover: 150 };

const palette = (ground: number, skyTop: number, skyBottom: number, fog: number) => ({ ground, skyTop, skyBottom, fog });

function pose(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): Pose {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return {
    x, y, z,
    m: [
      cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
      cp * sr, cp * cr, -sp,
      -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
    ],
  };
}

function buildBase(id: CourseId, seed: number, kind: Course['kind'], limit = LIMITS[id]): Course {
  const course: Course = {
    id, name: COURSE_NAMES[id], kind, seed, colliders: [], zones: [], spawns: [], startYaw: 0,
    killY: -12, limit, path: [], decor: [], palette: palette(0x83b978, 0xa9dafa, 0xe5f2ec, 0xc4dfdb),
  };
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      course.spawns.push({ x: (col - 2) * 1.55, y: 0.03, z: -4.5 - row * 1.45 });
    }
  }
  return course;
}

function add(
  course: Course,
  shape: Shape,
  look: Collider['look'],
  x: number,
  y: number,
  z: number,
  options: {
    yaw?: number; pitch?: number; roll?: number; bounce?: number; slip?: boolean; spring?: number;
    at?: (t: number, out: Pose) => void; tile?: Collider['tile']; tint?: number; on?: boolean;
  } = {},
): Collider {
  const p = pose(x, y, z, options.yaw ?? 0, options.pitch ?? 0, options.roll ?? 0);
  const collider: Collider = {
    id: course.colliders.length, shape, look, pose: p, prev: { ...p, m: [...p.m] },
    on: options.on ?? true,
  };
  if (options.at) collider.at = options.at;
  if (options.bounce !== undefined) collider.bounce = options.bounce;
  if (options.slip) collider.slip = true;
  if (options.spring !== undefined) collider.spring = options.spring;
  if (options.tile) collider.tile = options.tile;
  if (options.tint !== undefined) collider.tint = options.tint;
  course.colliders.push(collider);
  return collider;
}

function floor(course: Course, from: number, to: number, look: Collider['look'] = 'grass', y = -0.35) {
  add(course, { kind: 'box', hx: 9, hy: 0.35, hz: (to - from) / 2 }, look, 0, y, (from + to) / 2);
}

function checkpoint(course: Course, index: number, z: number, x = 0, y = 0) {
  const spawn = { x, y: y + 0.04, z: z - 2.4 };
  course.zones.push({ kind: 'checkpoint', x, y: y + 1, z, hx: 8.5, hy: 2, hz: 2.3, index, spawn });
}

function racePath(course: Course, finishZ: number, yAt: (z: number) => number = () => 0): Waypoint[] {
  const path: Waypoint[] = [];
  for (let z = -2; z <= finishZ; z += 8) {
    const special = course.id === 'oval' && (z === 22 || z === 38 || z === 54 || z === 78);
    path.push({ x: 0, y: yAt(z), z, r: 3, lane: 5.5, ...(special ? { jump: true } : {}) });
  }
  path.push({ x: 0, y: yAt(finishZ), z: finishZ, r: 2.5, lane: 4 });
  return path;
}

function campusDecor(course: Course, finishZ: number, kind: 'oval' | 'fountain' | 'palm' = 'oval') {
  const colors = [0xb13a42, 0xdaa949, 0x718fc9, 0x75ad81];
  for (let z = -4, i = 0; z <= finishZ + 4; z += 12, i++) {
    course.decor.push({ kind: i % 3 === 0 ? 'palm' : 'tree', x: -13.5, y: 0, z, s: 1.1, yaw: 0 });
    course.decor.push({ kind: i % 3 === 1 ? 'palm' : 'tree', x: 13.5, y: 0, z: z + 5, s: 1.2, yaw: 0 });
    if (kind !== 'palm') {
      course.decor.push({ kind: 'lamp', x: -10.4, y: 0, z: z + 4, s: 0.85, yaw: 0 });
      course.decor.push({ kind: 'lamp', x: 10.4, y: 0, z: z + 9, s: 0.85, yaw: 0 });
    }
    if (i % 2 === 0) {
      course.decor.push({ kind: 'banner', x: i % 4 ? -10.8 : 10.8, y: 3.2, z: z + 2, s: 1, yaw: i % 4 ? 0 : Math.PI, color: colors[i % colors.length] });
    }
  }
  course.decor.push({ kind: 'tower', x: -32, y: 0, z: finishZ + 50, s: 7, yaw: 0 });
  course.decor.push({ kind: 'stands', x: 40, y: 0, z: 4, s: 1.4, yaw: 0 });
}

function makeOval(seed: number): Course {
  const course = buildBase('oval', seed, 'race');
  course.killY = -14;
  course.palette = palette(0x78ad72, 0x99d5f2, 0xf3e6cf, 0xc4e0d9);
  floor(course, -12, 18);
  floor(course, 18, 48);
  floor(course, 48, 76);
  floor(course, 82, 112);
  floor(course, 112, 132);
  for (let i = 0; i < 3; i++) {
    const z = 20 + i * 15;
    const baseYaw = i * 0.6;
    add(course, { kind: 'box', hx: 7.2, hy: 0.48, hz: 0.55 }, 'tube', 0, 0.78, z, {
      bounce: 9,
      at: (t, out) => setPose(out, 0, 0.78, z, baseYaw + Math.sin(t * 0.8 + i) * 0.72),
    });
  }
  for (const [z, y, speed] of [[54, 0.75, 1.15], [62, 1.8, -1.4], [69, 0.72, 1.7]] as const) {
    add(course, { kind: 'box', hx: 7.8, hy: 0.22, hz: 0.28 }, 'bar', 0, y, z, {
      bounce: y > 1 ? 13 : 10,
      at: (t, out) => setPose(out, 0, y, z, t * speed + hash(seed, z) / 0xffffffff),
    });
  }
  for (const x of [-4.4, 4.4]) {
    add(course, { kind: 'box', hx: 0.7, hy: 0.12, hz: 0.7 }, 'pad', x, 0.12, 78, { spring: 13 });
  }
  add(course, { kind: 'box', hx: 3.2, hy: 0.12, hz: 1.6 }, 'pad', 0, 0.12, 78, { spring: 13 });
  add(course, { kind: 'box', hx: 2.3, hy: 0.35, hz: 2.4 }, 'stone', 0, -0.15, 83, {
    at: (t, out) => setPose(out, Math.sin(t * 0.9) * 2.2, 0.4, 83, t * 0.35),
  });
  course.decor.push({ kind: 'arch', x: 0, y: 0, z: 124, s: 1.6, yaw: 0 });
  course.zones.push({ kind: 'finish', x: 0, y: 1.2, z: 126, hx: 8, hy: 2, hz: 1.5 });
  [0, 30, 52, 91, 113].forEach((z, i) => checkpoint(course, i, z));
  course.path = racePath(course, 124);
  campusDecor(course, 130);
  return course;
}

function makeFountain(seed: number): Course {
  const course = buildBase('fountain', seed, 'race');
  course.killY = -12;
  course.palette = palette(0x85b77b, 0xa7dcf2, 0xf5e5d2, 0xc9dfdc);
  floor(course, -12, 32, 'path');
  floor(course, 32, 54, 'sand');
  floor(course, 74, 102, 'path');
  floor(course, 102, 132, 'path');
  floor(course, 54, 74, 'path');
  add(course, { kind: 'cyl', r: 2.8, hy: 0.28 }, 'stone', 0, -0.02, 63);
  add(course, { kind: 'cyl', r: 1.45, hy: 0.3 }, 'stone', -5.2, 0.08, 64);
  add(course, { kind: 'cyl', r: 1.45, hy: 0.3 }, 'stone', 5.2, 0.08, 64);
  add(course, { kind: 'box', hx: 2.1, hy: 0.12, hz: 1.2 }, 'stone', 0, 0.1, 56);
  add(course, { kind: 'box', hx: 2.1, hy: 0.12, hz: 1.2 }, 'stone', 0, 0.1, 70);
  for (let i = 0; i < 4; i++) {
    const z = 23 + i * 8;
    course.zones.push({
      kind: 'jet', x: i % 2 ? 3.6 : -3.6, y: 1.1, z, hx: 2.1, hy: 1.3, hz: 2.4,
      push: { x: i % 2 ? -13 : 13, y: 2.5, z: 1.5 },
      on: (t) => ((t + hash(seed, i) / 0xffffffff * 2.5) % 2.5) < 1.2,
    });
  }
  for (const x of [-7, 7]) {
    add(course, { kind: 'box', hx: 1, hy: 0.06, hz: 9 }, 'wet', x, 0.02, 43, { slip: true });
  }
  add(course, { kind: 'box', hx: 6.1, hy: 0.23, hz: 0.3 }, 'bar', 0, 1.1, 91, {
    bounce: 10,
    at: (t, out) => setPose(out, 0, 1.1, 91, t * 1.25),
  });
  add(course, { kind: 'cyl', r: 1.15, hy: 0.35 }, 'stone', 0, 0.35, 91);
  course.decor.push({ kind: 'fountain', x: 0, y: 0, z: 63, s: 2.4, yaw: 0 });
  course.decor.push({ kind: 'arch', x: 0, y: 0, z: 124, s: 1.7, yaw: 0 });
  course.zones.push({ kind: 'finish', x: 0, y: 1, z: 126, hx: 8, hy: 2, hz: 1.5 });
  [0, 31, 53, 77, 104].forEach((z, i) => checkpoint(course, i, z));
  course.path = racePath(course, 124);
  campusDecor(course, 130, 'fountain');
  return course;
}

function makePalm(seed: number): Course {
  const course = buildBase('palm', seed, 'race');
  course.killY = -18;
  course.palette = palette(0x7eae73, 0x92ceee, 0xf3e1c8, 0xc0d9d5);
  const rampPitch = -0.16;
  for (let section = 0; section < 6; section++) {
    const z = section * 21 + 7;
    const y = section * 3.4;
    add(course, { kind: 'box', hx: 8.2, hy: 0.45, hz: section === 0 ? 14 : 11 }, section % 2 ? 'path' : 'grass', 0, y, z, { pitch: rampPitch });
    if (section < 5) add(course, { kind: 'box', hx: 8.5, hy: 0.4, hz: 2.3 }, 'stone', 0, y + 1.8, z + 13);
  }
  // Seeded coconuts cycle through a fixed pool so their motion stays allocation-free.
  for (let i = 0; i < 8; i++) {
    const lane = [-6, -4, -2, 2, 4, 6, -3, 3][i];
    const section = i % 5;
    const z0 = section * 21 + 7;
    const start = (hash(seed, i, 17) / 0xffffffff) * 4.8;
    const collider = add(course, { kind: 'sphere', r: 0.68 }, 'coconut', lane, section * 3.4 + 2, z0 + 8, {
      bounce: 10, on: false,
      at: (t, out) => {
        const cycle = (t + start) % 6.5;
        const active = cycle < 3.5;
        collider.on = active;
        const down = Math.max(0, cycle - 0.25) * 4.7;
        setPose(out, lane, section * 3.4 + 2 + Math.sin(cycle * 2) * 0.3, z0 + 13 - down);
      },
    });
  }
  for (let i = 0; i < 5; i++) {
    const z = 28 + i * 20;
    const y = Math.floor(z / 21) * 3.4 + 2.4;
    add(course, { kind: 'box', hx: 3.5, hy: 0.2, hz: 0.38 }, 'frond', 0, y, z, {
      bounce: 11,
      at: (t, out) => setPose(out, 0, y, z, Math.sin(t * 1.1 + i) * 0.65, Math.sin(t * 1.7 + i) * 0.2),
    });
  }
  course.decor.push({ kind: 'arch', x: 0, y: 18.5, z: 124, s: 1.6, yaw: 0 });
  course.zones.push({ kind: 'finish', x: 0, y: 20, z: 126, hx: 8, hy: 3, hz: 1.7 });
  for (let i = 0; i < 7; i++) checkpoint(course, i, i * 21, 0, i * 3.4);
  course.path = Array.from({ length: 16 }, (_, i) => {
    const z = i * 8;
    const y = z * 0.16;
    return { x: 0, y, z, r: 3.2, lane: 4.7, ...(i % 3 === 2 ? { jump: true } : {}) };
  });
  course.path.push({ x: 0, y: 20, z: 124, r: 2.5, lane: 4 });
  campusDecor(course, 128, 'palm');
  return course;
}

function makeTiles(seed: number): Course {
  const course = buildBase('tiles', seed, 'survival', 90);
  course.killY = -22;
  course.palette = palette(0x79a975, 0xa8d7ef, 0xf3e8dc, 0xc6dbd5);
  const rings = [5, 4, 4];
  for (let layer = 0; layer < 3; layer++) {
    const ring = rings[layer];
    const spacing = 2.42;
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        if (Math.abs(q + r) > ring) continue;
      const x = (q + r / 2) * spacing;
      const z = r * spacing * 0.866;
      const baseY = -layer * 7;
      const tile = { layer, touchedAt: null as number | null, fallAt: null as number | null };
      let collider: Collider;
      collider = add(course, { kind: 'cyl', r: 1.55, hy: 0.26 }, 'hex', x, baseY, z, {
        tile,
        at: (t, out) => {
          if (tile.fallAt === null || t < tile.fallAt) {
            setPose(out, x, baseY + (tile.touchedAt === null ? 0 : Math.sin((t - tile.touchedAt) * 27) * 0.035), z);
            collider.on = true;
          } else {
            const elapsed = t - tile.fallAt;
            setPose(out, x, baseY - Math.min(11, elapsed * elapsed * 5.5), z);
            collider.on = elapsed < 1.2;
          }
        },
      });
      }
    }
  }
  course.zones.push({ kind: 'checkpoint', index: 0, x: 0, y: 1, z: 0, hx: 8, hy: 2, hz: 8, spawn: { x: 0, y: 0.3, z: 0 } });
  course.zones.push({ kind: 'finish', x: 0, y: 1.2, z: 0, hx: 1.5, hy: 1.2, hz: 1.5 });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    course.spawns[i] = { x: Math.cos(a) * 4.6, y: 0.35, z: Math.sin(a) * 4.6 };
  }
  course.path = [];
  return course;
}

function makeHoover(seed: number): Course {
  const course = buildBase('hoover', seed, 'final', 150);
  course.killY = -7;
  course.startYaw = -2.4;
  course.palette = palette(0x82ad78, 0x87c4ec, 0xffe6c5, 0xb6d4d3);
  add(course, { kind: 'cyl', r: 2.1, hy: 20 }, 'sand', 0, 18, 0);
  add(course, { kind: 'box', hx: 5.5, hy: 0.45, hz: 6.5 }, 'gold', 0, -0.3, 0);
  const nodes: Waypoint[] = [];
  const platformLevels = 23;
  const checkpointLevels = new Set([0, 6, 12, 18]);
  for (let i = 1; i <= platformLevels; i++) {
    const angle = i * 0.47;
    const x = Math.cos(angle) * 4.3;
    const z = Math.sin(angle) * 4.3;
    const y = i * 1.65;
    const at = i % 3 === 0;
    add(course, { kind: 'box', hx: 2.8, hy: 0.32, hz: 2.8 }, 'pad', x, y, z, {
      spring: i % 5 === 0 ? 12 : undefined,
      at: at ? (t, out) => setPose(out, x + Math.sin(t * 0.7 + i) * 0.8, y, z + Math.cos(t * 0.65 + i) * 0.8, t * 0.15) : undefined,
    });
    nodes.push({ x, y: y + 0.5, z, r: 2.6, jump: true, dive: i % 4 === 0, lane: 1.8 });
    if (i % 7 === 0) {
      add(course, { kind: 'box', hx: 4.4, hy: 0.18, hz: 0.32 }, 'bar', 0, y + 1.5, 0, {
        bounce: 13,
        at: (t, out) => setPose(out, 0, y + 1.5, 0, t * (i % 2 ? 1.4 : -1.2)),
      });
    }
    if (checkpointLevels.has(i)) {
      course.zones.push({
        kind: 'checkpoint', index: course.zones.filter((zone) => zone.kind === 'checkpoint').length,
        x, y: y + 1, z, hx: 3.5, hy: 2, hz: 3.5, spawn: { x, y: y + 0.4, z },
      });
    }
  }
  const crownY = platformLevels * 1.65 + 1.3;
  add(course, { kind: 'cyl', r: 3, hy: 0.45 }, 'gold', 0, platformLevels * 1.65, 0);
  course.zones.push({ kind: 'crown', x: 0, y: crownY, z: 0, hx: 3, hy: 2, hz: 3 });
  course.zones.push({ kind: 'finish', x: 0, y: crownY, z: 0, hx: 3, hy: 2, hz: 3 });
  nodes.push({ x: 0, y: crownY, z: 0, r: 2, lane: 2 });
  course.path = nodes;
  course.spawns = course.spawns.map((_, i) => ({
    x: ((i % 5) - 2) * 1.4, y: 0.15, z: 5.6 + Math.floor(i / 5) * 0.18,
  }));
  course.decor.push({ kind: 'tower', x: -26, y: 0, z: -34, s: 2.8, yaw: 0 });
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    if (i % 3) course.decor.push({ kind: 'arch', x: Math.cos(a) * 22, y: 0, z: Math.sin(a) * 22, s: 1.1, yaw: -a });
  }
  return course;
}

function setPose(out: Pose, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
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

export function buildCourse(id: CourseId, seed: number): Course {
  if (id === 'oval') return makeOval(seed);
  if (id === 'fountain') return makeFountain(seed);
  if (id === 'palm') return makePalm(seed);
  if (id === 'tiles') return makeTiles(seed);
  return makeHoover(seed);
}

export function progressOf(course: Course, x: number, y: number, z: number): number {
  if (course.kind === 'survival' || course.path.length < 2) return 0;
  let best = Infinity, along = 0, total = 0, bestAlong = 0;
  for (let i = 0; i < course.path.length - 1; i++) {
    const a = course.path[i], b = course.path[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / len2));
    const px = a.x + dx * u, py = a.y + dy * u, pz = a.z + dz * u;
    const distance = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
    const length = Math.sqrt(len2);
    if (distance < best) { best = distance; bestAlong = along + length * u; }
    along += length;
    total += length;
  }
  return total > 0 ? Math.max(0, Math.min(1, bestAlong / total)) : 0;
}

export function respawnPoint(course: Course, checkpointIndex: number, slot: number): Vec3 {
  const zone = course.zones.find((item) => item.kind === 'checkpoint' && item.index === checkpointIndex);
  const base = zone?.spawn ?? course.spawns[0] ?? { x: 0, y: 0, z: 0 };
  const offset = ((Math.floor(slot) % 5) - 2) * 0.62;
  return { x: base.x + offset, y: base.y, z: base.z + (((Math.floor(slot / 5) % 4) - 1.5) * 0.42) };
}

export function checkpointAt(course: Course, x: number, y: number, z: number): number {
  let found = -1;
  for (const zone of course.zones) {
    if (zone.kind !== 'checkpoint') continue;
    if (Math.abs(x - zone.x) <= zone.hx && Math.abs(y - zone.y) <= zone.hy && Math.abs(z - zone.z) <= zone.hz) {
      found = Math.max(found, zone.index ?? -1);
    }
  }
  return found;
}

export function applyTouch(course: Course, id: number, touchedAt: number): boolean {
  const collider = course.colliders.find((item) => item.id === id && item.tile);
  if (!collider?.tile || !Number.isFinite(touchedAt)) return false;
  const tile = collider.tile;
  if (tile.touchedAt === null || touchedAt < tile.touchedAt) tile.touchedAt = touchedAt;
  const fallAt = tile.touchedAt + 0.85;
  if (tile.fallAt === null || fallAt < tile.fallAt) tile.fallAt = fallAt;
  return true;
}

export const touchTile = applyTouch;

/** Host tile events supply the absolute fall time; the tile disappears 1.2s after that instant. */
export function tileFall(course: Course, id: number, at: number): boolean {
  const collider = course.colliders.find((item) => item.id === id && item.tile);
  if (!collider?.tile || !Number.isFinite(at)) return false;
  const tile = collider.tile;
  if (tile.touchedAt === null || at < tile.touchedAt + 0.85) tile.touchedAt = Math.max(0, at - 0.85);
  if (tile.fallAt === null || at < tile.fallAt) tile.fallAt = at;
  return true;
}
