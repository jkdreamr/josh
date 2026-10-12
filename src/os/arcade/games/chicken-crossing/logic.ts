export const COLUMNS = 9;
export const HOP_TIME = 0.16;
export const REPEAT_TIME = 0.21;
export const STEP = 1 / 120;
export const TRAFFIC_SPAN = COLUMNS + 8;
export const CHICKEN_HALF = 0.18;

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Car = { x: number; width: number; color: number; truck: boolean };
export type Lane = {
  row: number;
  kind: 'grass' | 'road';
  direction: -1 | 1;
  speed: number;
  cars: Car[];
  corn: number | null;
  collected: boolean;
  seed: number;
};
export type Hop = { fromX: number; fromY: number; toX: number; toY: number; elapsed: number };
export type State = {
  seed: number;
  x: number;
  y: number;
  facing: Direction;
  hop: Hop | null;
  queued: Direction | null;
  repeat: number;
  time: number;
  acc: number;
  maxRow: number;
  corn: number;
  score: number;
  dead: boolean;
  lanes: Lane[];
  nextRow: number;
  group: number;
};
export type Input = { held: Direction | null; press: Direction | null };
export type Events = { hopped: boolean; landed: boolean; scored: number; collected: boolean; crashed: boolean; milestone: boolean };

export function rng32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const speedAt = (row: number) => Math.min(4.1, 1.2 + row * 0.035);
export const roadsInGroup = (group: number, seed: number) => 1 + Math.floor(rng32(seed ^ Math.imul(group + 1, 977))() * Math.min(4, 1 + Math.floor(group / 2)));

function makeLane(s: State, row: number, road: boolean, corn: boolean): Lane {
  const seed = s.seed ^ Math.imul(row + 1, 2654435761);
  const rng = rng32(seed);
  const direction = rng() < 0.5 ? -1 : 1;
  const speed = speedAt(row) * (0.8 + rng() * 0.2);
  const count = Math.min(4, 2 + Math.floor(row / 18));
  const phase = rng() * TRAFFIC_SPAN;
  const cars: Car[] = [];
  if (road)
    for (let i = 0; i < count; i++) {
      const truck = row > 8 && rng() < 0.35;
      cars.push({ x: -4 + ((phase + (i * TRAFFIC_SPAN) / count) % TRAFFIC_SPAN), width: truck ? 2.05 : 1.25, color: Math.floor(rng() * 5), truck });
    }
  return { row, kind: road ? 'road' : 'grass', direction, speed, cars, corn: corn ? 1 + Math.floor(rng() * (COLUMNS - 2)) : null, collected: false, seed };
}

export function extendCourse(s: State, through: number) {
  while (s.nextRow <= through) {
    const count = roadsInGroup(s.group, s.seed);
    for (let i = 0; i < count; i++) s.lanes.push(makeLane(s, s.nextRow++, true, false));
    s.lanes.push(makeLane(s, s.nextRow++, false, true));
    if (s.group % 4 === 3) s.lanes.push(makeLane(s, s.nextRow++, false, false));
    s.group++;
  }
}

export function createState(seed = 1): State {
  const s: State = {
    seed, x: 4, y: 0, facing: 'up', hop: null, queued: null, repeat: 0, time: 0, acc: 0,
    maxRow: 0, corn: 0, score: 0, dead: false, lanes: [], nextRow: 2, group: 0,
  };
  s.lanes.push(makeLane(s, 0, false, false), makeLane(s, 1, false, false));
  extendCourse(s, 20);
  return s;
}

export function startHop(s: State, direction: Direction): boolean {
  if (s.dead || s.hop) return false;
  const x = s.x + (direction === 'left' ? -1 : direction === 'right' ? 1 : 0);
  const y = s.y + (direction === 'up' ? 1 : direction === 'down' ? -1 : 0);
  if (x < 0 || x >= COLUMNS || y < Math.max(0, s.maxRow - 3)) return false;
  s.facing = direction;
  s.hop = { fromX: s.x, fromY: s.y, toX: x, toY: y, elapsed: 0 };
  return true;
}

/** A moving chicken against a moving vehicle, in relative coordinates. */
export function sweptHit(ax: number, ay: number, bx: number, by: number, halfX: number, halfY: number): boolean {
  let enter = 0;
  let exit = 1;
  for (const [a, b, half] of [[ax, bx, halfX], [ay, by, halfY]]) {
    const delta = b - a;
    if (Math.abs(delta) < 1e-10) {
      if (Math.abs(a) >= half) return false;
      continue;
    }
    const t1 = (-half - a) / delta;
    const t2 = (half - a) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter >= exit) return false;
  }
  return enter < exit;
}

function substep(s: State, dt: number, ev: Events) {
  const oldX = s.x;
  const oldY = s.y;
  s.time += dt;
  s.repeat = Math.max(0, s.repeat - dt);
  const hop = s.hop;
  if (hop) {
    hop.elapsed = Math.min(HOP_TIME, hop.elapsed + dt);
    const t = hop.elapsed / HOP_TIME;
    s.x = hop.fromX + (hop.toX - hop.fromX) * t;
    s.y = hop.fromY + (hop.toY - hop.fromY) * t;
  }
  for (const lane of s.lanes) {
    for (const car of lane.cars) {
      const oldCar = car.x;
      const nextCar = oldCar + lane.direction * lane.speed * dt;
      if (sweptHit(oldX - oldCar, oldY - lane.row, s.x - nextCar, s.y - lane.row, car.width / 2 - 0.08 + CHICKEN_HALF, 0.26 + CHICKEN_HALF)) {
        s.dead = true;
        ev.crashed = true;
      }
      car.x = ((nextCar + 4 + TRAFFIC_SPAN) % TRAFFIC_SPAN) - 4;
    }
  }
  if (s.dead) return;
  if (hop && hop.elapsed >= HOP_TIME) {
    s.x = hop.toX;
    s.y = hop.toY;
    s.hop = null;
    ev.landed = true;
    const prev = s.score;
    const before = s.maxRow;
    s.maxRow = Math.max(s.maxRow, s.y);
    const lane = s.lanes.find((l) => l.row === s.y);
    if (lane && lane.corn === s.x && !lane.collected) {
      lane.collected = true;
      s.corn++;
      ev.collected = true;
    }
    s.score = s.maxRow + s.corn * 3;
    ev.scored += s.score - prev;
    ev.milestone ||= Math.floor(before / 12) < Math.floor(s.maxRow / 12);
    extendCourse(s, s.maxRow + 20);
    s.lanes = s.lanes.filter((l) => l.row >= s.maxRow - 5);
  }
}

export function step(s: State, dt: number, input: Input = { held: null, press: null }): Events {
  const ev: Events = { hopped: false, landed: false, scored: 0, collected: false, crashed: false, milestone: false };
  if (s.dead || dt <= 0) return ev;
  if (input.press) s.queued = input.press;
  s.acc += Math.min(dt, 0.1);
  while (s.acc >= STEP && !s.dead) {
    s.acc -= STEP;
    if (!s.hop) {
      const direction = s.queued ?? (s.repeat <= 0 ? input.held : null);
      s.queued = null;
      if (direction && startHop(s, direction)) {
        ev.hopped = true;
        s.repeat = REPEAT_TIME;
      }
    }
    substep(s, STEP, ev);
  }
  return ev;
}
