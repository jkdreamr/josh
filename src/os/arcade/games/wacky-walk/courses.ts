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
    killY: -12, limit, path: [], decor: [], palette: palette(0x5d8747, 0x48708a, 0xb9ad9b, 0xb9ad9b),
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

function floor(course: Course, from: number, to: number, look: Collider['look'] = 'grass', y = -0.35, hx = 9, slip = false) {
  add(course, { kind: 'box', hx, hy: 0.35, hz: (to - from) / 2 }, look, 0, y, (from + to) / 2, { slip });
}

function checkpoint(course: Course, index: number, z: number, x = 0, y = 0) {
  const spawn = { x, y: y + 0.04, z: z - 2.4 };
  course.zones.push({ kind: 'checkpoint', x, y: y + 1, z, hx: 8.5, hy: 2, hz: 2.3, index, spawn });
}

function racePath(course: Course, finishZ: number, yAt: (z: number) => number = () => 0): Waypoint[] {
  const path: Waypoint[] = [];
  for (let z = -2; z <= finishZ; z += 8) {
    const jump = course.id === 'oval' && z === 78;
    const narrow = course.id === 'oval' && z >= 94 && z <= 102;
    path.push({
      x: 0, y: yAt(z), z, r: narrow ? 1.5 : 3, lane: narrow ? 1.5 : 5.5,
      ...(jump ? { jump: true } : {}),
    });
  }
  path.push({ x: 0, y: yAt(finishZ), z: finishZ, r: 2.5, lane: 4 });
  return path;
}

function campusDecor(course: Course, finishZ: number, kind: 'oval' | 'fountain' | 'palm' = 'oval') {
  for (let z = kind === 'palm' ? 7 : -4, i = 0; z <= finishZ + 4; z += kind === 'palm' ? 10 : 12, i++) {
    if (kind === 'fountain' && Math.abs(z - 63) < 13) continue;
    const y = kind === 'palm' ? (z - 7) * 0.16 : 0;
    const leftKind = kind === 'palm' ? 'palm' : i % 3 === 0 ? 'palm' : 'tree';
    const rightKind = kind === 'palm' ? 'palm' : i % 3 === 1 ? 'palm' : 'tree';
    course.decor.push({ kind: leftKind, x: -13.4, y, z, s: kind === 'palm' ? 1.2 : 1.1, yaw: 0 });
    course.decor.push({ kind: rightKind, x: 13.4, y: kind === 'palm' ? y + 0.8 : 0, z: z + (kind === 'palm' ? 0 : 5), s: kind === 'palm' ? 1.2 : 1.2, yaw: 0 });
  }
  if (kind !== 'palm') course.decor.push({ kind: 'tower', x: -40, y: 0, z: finishZ + 64, s: 1.3, yaw: 0 });
  if (kind === 'palm') {
    course.decor.push({ kind: 'arcade', x: 0, y: 0, z: finishZ + 32, s: 1.2, yaw: 0 });
    course.decor.push({ kind: 'roof', x: 0, y: 0, z: finishZ + 32, s: 1.2, yaw: 0 });
  }
  course.decor.push({ kind: 'stands', x: 40, y: 0, z: 4, s: 1.4, yaw: 0 });
}

function makeOval(seed: number): Course {
  const course = buildBase('oval', seed, 'race');
  course.killY = -14;
  course.palette = palette(0x5b8042, 0x47718e, 0xb7a991, 0xb7a991);
  floor(course, -12, 18);
  floor(course, 18, 48);
  floor(course, 48, 74);
  floor(course, 84, 92);
  floor(course, 92, 108, 'path', -0.35, 4);
  floor(course, 108, 112);
  floor(course, 112, 132);
  for (let i = 0; i < 5; i++) {
    const z = 18 + i * 7.5;
    const baseYaw = i * 0.6;
    add(course, { kind: 'box', hx: 8.8, hy: 0.4, hz: 0.5 }, 'tube', 0, 0.55, z, {
      bounce: 11,
      at: (t, out) => setPose(out, 0, 0.55, z, baseYaw + Math.sin(t * 0.68 + i * 1.7) * 0.36),
    });
  }
  for (const [z, y, speed] of [[54, 0.72, 0.9], [62, 0.72, -1], [62, 2.1, 1.15], [70, 0.72, 1.1]] as const) {
    add(course, { kind: 'box', hx: 8.8, hy: 0.22, hz: 0.28 }, 'bar', 0, y, z, {
      bounce: y > 1 ? 13 : 10,
      at: (t, out) => setPose(out, 0, y, z, t * speed + hash(seed, z) / 0xffffffff),
    });
  }
  for (const x of [-4.4, 4.4]) {
    add(course, { kind: 'box', hx: 0.7, hy: 0.12, hz: 0.7 }, 'pad', x, 0.12, 78, { spring: 13 });
  }
  add(course, { kind: 'box', hx: 3.2, hy: 0.12, hz: 1.6 }, 'pad', 0, 0.12, 78, { spring: 13 });
  add(course, { kind: 'box', hx: 2.3, hy: 0.35, hz: 2.4 }, 'stone', 0, -0.15, 83, {
    tint: 0xff4fa3,
    at: (t, out) => setPose(out, Math.sin(t * 0.9) * 2.2, 0.4, 83, t * 0.35),
  });
  add(course, { kind: 'box', hx: 8.8, hy: 0.24, hz: 0.35 }, 'bar', 0, 2.1, 100, {
    bounce: 11, at: (t, out) => setPose(out, 0, 2.1, 100, Math.sin(t * 0.8) * 0.35),
  });
  for (const [z, phase] of [[116, 0], [122, 2.1]] as const) {
    add(course, { kind: 'box', hx: 1.1, hy: 0.5, hz: 0.7 }, 'bumper', 0, 0.5, z, {
      bounce: 11, at: (t, out) => setPose(out, Math.sin(t * 0.9 + phase) * 4.8, 0.5, z),
    });
  }
  course.zones.push({ kind: 'finish', x: 0, y: 1.2, z: 126, hx: 8, hy: 2, hz: 1.5 });
  [0, 30, 52, 91, 113].forEach((z, i) => checkpoint(course, i, z));
  course.path = racePath(course, 124);
  campusDecor(course, 130);
  return course;
}

function makeFountain(seed: number): Course {
  const course = buildBase('fountain', seed, 'race');
  course.killY = -12;
  course.palette = palette(0x5d8747, 0x47718e, 0xb9ad9b, 0xb9ad9b);
  floor(course, -12, 32, 'path');
  floor(course, 32, 52, 'wet', -0.35, 9, true);
  floor(course, 74, 102, 'path');
  floor(course, 102, 132, 'path');
  for (let i = 0; i < 6; i++) add(course, { kind: 'cyl', r: 2, hy: 0.3 }, 'stone', i % 2 ? -1.2 : 1.2, 0.08, 56 + i * 3.2);
  for (let i = 0; i < 8; i++) {
    const z = 21 + i * 4.2;
    const x = -8 + i * (16 / 7);
    course.zones.push({
      kind: 'jet', x, y: 1.1, z, hx: 1.2, hy: 1.3, hz: 2.1,
      push: { x: i < 4 ? 12 : -12, y: 1.8, z: 1 },
      on: (t) => ((t + hash(seed, i) / 0xffffffff * 2) % 3.8) < 0.65,
    });
  }
  for (const [z, y, speed] of [[88, 0.72, 1.25], [96, 1.75, -1.3]] as const) add(course, { kind: 'box', hx: 8.8, hy: 0.22, hz: 0.28 }, 'bar', 0, y, z, { bounce: 11, at: (t, out) => setPose(out, 0, y, z, t * speed) });
  course.decor.push({ kind: 'fountain', x: 17.4, y: 0, z: 63, s: 0.9, yaw: 0 });
  course.zones.push({ kind: 'finish', x: 0, y: 1, z: 126, hx: 8, hy: 2, hz: 1.5 });
  [0, 31, 53, 77, 104].forEach((z, i) => checkpoint(course, i, z));
  course.path = [
    ...racePath(course, 124).filter((node) => node.z < 50 || node.z > 74),
    { x: 0, y: 0, z: 50, r: 2, lane: 1 },
    ...Array.from({ length: 6 }, (_, i) => ({
      x: i % 2 ? -1.2 : 1.2, y: 0.25, z: 56 + i * 3.2, r: 1.8, lane: 0.2,
      jump: true, jumpDistance: i === 0 ? 10.5 : 6,
    })),
  ].sort((a, b) => a.z - b.z);
  for (const node of course.path) if (node.z >= 18 && node.z <= 46) {
    node.waitFor = (t) => !course.zones.some((zone) =>
      zone.kind === 'jet' && zone.on?.(t) && Math.hypot(zone.x - node.x, zone.z - node.z) < 3.2,
    );
  }
  campusDecor(course, 130, 'fountain');
  return course;
}

function makePalm(seed: number): Course {
  const course = buildBase('palm', seed, 'race');
  course.killY = -18;
  course.palette = palette(0x5d8747, 0x47718e, 0xb9ad9b, 0xb9ad9b);
  const rampPitch = -0.16;
  for (let section = 0; section < 6; section++) {
    const z = section * 21 + 7;
    const y = section * 3.4;
    add(course, { kind: 'box', hx: section === 2 || section === 4 ? 4.2 : 8.2, hy: 0.45, hz: section === 0 ? 14 : 11 }, section % 2 ? 'path' : 'grass', 0, y, z, { pitch: rampPitch });
    if (section < 5) add(course, { kind: 'box', hx: 8.5, hy: 0.4, hz: 2.3 }, 'stone', 0, y + 1.8, z + 13);
  }
  // Seeded coconuts cycle through a fixed pool so their motion stays allocation-free.
  const coconutLanes = [-3.5, 3.5, -1.75, 1.75, 0, 3.5, -3.5, 1.75, -1.75, 3.5];
  for (let i = 0; i < 10; i++) {
    const lane = coconutLanes[i];
    const section = i % 5;
    const z0 = section * 21 + 7;
    const start = (hash(seed, i, 17) / 0xffffffff) * 5;
    const collider = add(course, { kind: 'sphere', r: 0.5 }, 'coconut', lane, section * 3.4 + 0.5, z0 + 8, {
      bounce: 10, on: false,
      at: (t, out) => {
        const cycle = (t + start) % 5;
        const active = cycle < 1.8;
        collider.on = active;
        const down = Math.max(0, cycle - 0.3) * 6;
        setPose(out, lane, section * 3.4 + 0.5 + Math.sin(cycle * 2) * 0.2, z0 + 13 - down);
      },
    });
  }
  for (let i = 0; i < 7; i++) {
    const z = 28 + i * 20;
    const y = Math.floor(z / 21) * 3.4 + 0.75;
    add(course, { kind: 'box', hx: 8, hy: 0.2, hz: 0.38 }, 'frond', 0, y, z, {
      bounce: 8,
      at: (t, out) => setPose(out, 0, y, z, Math.sin(t * 1.5 + i) * 0.45, Math.sin(t * 1.4 + i) * 0.12),
    });
  }
  course.zones.push({ kind: 'finish', x: 0, y: 20, z: 126, hx: 8, hy: 3, hz: 1.7 });
  for (let i = 0; i < 7; i++) checkpoint(course, i, i * 21, 0, i * 3.4);
  course.path = Array.from({ length: 16 }, (_, i) => {
    const z = i * 8;
    const y = z * 0.16;
    const section = Math.min(5, Math.floor(z / 21));
    return { x: 0, y, z, r: 3.2, lane: section === 2 || section === 4 ? 1.2 : 1.4, ...(i % 3 === 2 ? { jump: true } : {}) };
  });
  course.path.push({ x: 0, y: 20, z: 124, r: 2.5, lane: 4 });
  campusDecor(course, 128, 'palm');
  return course;
}

function makeTiles(seed: number): Course {
  const course = buildBase('tiles', seed, 'survival', 90);
  course.killY = -22;
  course.palette = palette(0x5d8747, 0x47718e, 0xb9ad9b, 0xb9ad9b);
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
  course.palette = palette(0x5d8747, 0x47718e, 0xb9ad9b, 0xb9ad9b);
  add(course, { kind: 'cyl', r: 2.1, hy: 20 }, 'sand', 0, 18, 0, { tint: 0xffd5a3 });
  add(course, { kind: 'box', hx: 5.5, hy: 0.45, hz: 6.5 }, 'sand', 0, -0.3, 0, { tint: 0xe8d5b7 });
  const nodes: Waypoint[] = [];
  const platformLevels = 23;
  const checkpointLevels = new Set([8, 16]);
  const platformColors = [0xb99c64, 0xa54a3d, 0x667a6c, 0x7597a7, 0xc1a978];
  course.zones.push({ kind: 'checkpoint', index: 0, x: 0, y: 0.8, z: 0, hx: 4.5, hy: 1.8, hz: 4.5, spawn: { x: 0, y: 0.3, z: 0 } });
  for (let i = 1; i <= platformLevels; i++) {
    const angle = i * 0.47;
    const x = Math.cos(angle) * 5;
    const z = Math.sin(angle) * 5;
    const y = i * 1.65;
    const at = i % 2 === 0;
    add(course, { kind: 'box', hx: 2.4, hy: 0.32, hz: 2.4 }, 'pad', x, y, z, {
      spring: i % 5 === 0 ? 12 : undefined,
      tint: platformColors[(i - 1) % platformColors.length],
      at: at ? (t, out) => setPose(out, x + Math.sin(t * 0.7 + i) * 0.8, y, z + Math.cos(t * 0.65 + i) * 0.8, t * 0.15) : undefined,
    });
    nodes.push({ x, y: y + 0.5, z, r: 2.6, jump: true, dive: i % 4 === 0, lane: 1.8 });
    if (i % 5 === 0) {
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

export function goalOf(course: Course): { x: number; y: number; z: number; label: 'finish' | 'crown' } | null {
  if (course.id === 'tiles') return null;
  const label = course.id === 'hoover' ? 'crown' : 'finish';
  const zone = course.zones.find((item) => item.kind === (label === 'crown' ? 'crown' : 'finish'));
  return zone ? { x: zone.x, y: zone.y, z: zone.z, label } : null;
}

export function goalDistance(course: Course, _x: number, y: number, z: number): number {
  const goal = goalOf(course);
  if (!goal) return 0;
  return Math.max(0, course.id === 'hoover' ? goal.y - y : goal.z - z);
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
  const fallAt = tile.touchedAt + 0.55;
  if (tile.fallAt === null || fallAt < tile.fallAt) tile.fallAt = fallAt;
  return true;
}

export const touchTile = applyTouch;

/** Host tile events supply the absolute fall time; the tile disappears 1.2s after that instant. */
export function tileFall(course: Course, id: number, at: number): boolean {
  const collider = course.colliders.find((item) => item.id === id && item.tile);
  if (!collider?.tile || !Number.isFinite(at)) return false;
  const tile = collider.tile;
  if (tile.touchedAt === null || at < tile.touchedAt + 0.55) tile.touchedAt = Math.max(0, at - 0.55);
  if (tile.fallAt === null || at < tile.fallAt) tile.fallAt = at;
  return true;
}
