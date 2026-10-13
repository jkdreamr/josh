// Pure rules for Palm Drive: the course, steering, items, hits and scoring. No DOM, no three.js.
//
// The course is a list of hazard rows. Every obstacle has a meeting point `m`: the distance down the road where
// it reaches your kart. Cones sit still; oncoming cars drive toward you at a fixed share of your own speed, so
// they also arrive exactly at `m` however fast you go. That keeps a seeded course identical for every racer and
// lets the generator prove each row is passable: from every open lane of a row you can reach an open lane of
// the next one in the room between them, even flat out with every coin and a mushroom.
export const LANES = 3;
export const LANE_W = 2.3;
export const CAR_W = 1.7;
export const CAR_L = 3.8;
export const CONE_R = 0.45;
/** Obstacles and pickups come into view this far ahead. */
export const SPAWN_Z = 120;
export const MIN_SPEED = 14;
export const MAX_SPEED = 44;
/** Base speed grows with distance: v² = MIN_SPEED² + 2·ACCEL·dist, up to MAX_SPEED. */
export const ACCEL = 0.55;
/** Oncoming cars drive toward you at this share of your speed. */
export const ONCOMING = 0.3;
/** Lateral easing rate toward the lane centre, per second. */
export const STEER_K = 9;

export const COUNTDOWN = 3;
/** Pressing gas this close before GO gives a rocket start. */
export const ROCKET_WINDOW = 0.5;
export const BALLOONS = 3;
export const MAX_COINS = 10;
/** Extra top speed per coin. */
export const COIN_TOP = 0.5;
export const BOOST_DV = 12;
export const MUSHROOM_T = 1.4;
export const DASH_T = 0.9;
export const ROCKET_T = 1.2;
export const STAR_T = 6;
export const STAR_DV = 5;
export const ROLL_T = 0.9;
export const SPIN_T = 0.9;
export const SAFE_T = 1.8;
export const SHELL_V = 80;
export const RECOVER = 10;
export const BOOST_ACCEL = 40;
export const DECEL = 14;

/** Free road between rows, in seconds at top speed, before any lane change. */
export const GAP_TIME = 0.25;
/** Extra free road per lane you may have to cross. */
export const LANE_TIME = 0.2;
export const FIRST_ROW = 70;
export const FIRST_BOX = 160;
export const BOX_EVERY = 260;

export type Rng = () => number;
export type Kind = 'car' | 'cone';
export type Obstacle = { id: number; kind: Kind; lane: number; m: number; hue: number; hitAt?: number };
export type PickupKind = 'coin' | 'box' | 'dash';
export type Pickup = { id: number; kind: PickupKind; lane: number; m: number; taken?: boolean };
/** A hazard row: obstacles meet you within m ± h and `open` lanes are clear. */
export type Row = { m: number; h: number; open: number[] };
export type Course = { seed: number; rand: Rng; rows: Row[]; obstacles: Obstacle[]; pickups: Pickup[]; last: Row; nextBox: number; nextId: number };
export type Item = 'mushroom' | 'star' | 'shell';
export type Shell = { id: number; lane: number; p: number };

export type State = {
  lane: number;
  x: number;
  speed: number;
  dist: number;
  /** Seconds since GO; negative during the countdown. */
  time: number;
  course: Course;
  balloons: number;
  coins: number;
  item: Item | null;
  /** Item box roulette left; the item is usable when it hits 0. */
  roll: number;
  boost: number;
  star: number;
  spin: number;
  safe: number;
  shells: Shell[];
  shotId: number;
  /** Gas pressed during the countdown: the time it was pressed, or null. */
  gas: number | null;
  out: boolean;
  hitBy: Obstacle | null;
};

export type Events = {
  go: boolean;
  /** Countdown number that just appeared (3, 2, 1). */
  beep: number | null;
  rocket: boolean;
  coins: number;
  box: boolean;
  got: Item | null;
  dash: boolean;
  hit: Obstacle | null;
  smash: Obstacle[];
  out: boolean;
};

/** Small deterministic generator (mulberry32) so a seed always builds the same course. */
export function rng32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_W;
export const baseSpeed = (dist: number) => Math.min(MAX_SPEED, Math.sqrt(MIN_SPEED * MIN_SPEED + 2 * ACCEL * Math.max(0, dist)));
/** The fastest anyone can be going at this point of the road (outside a star). */
export const topSpeed = (dist: number) => baseSpeed(dist) + MAX_COINS * COIN_TOP + BOOST_DV;
/** Designed spacing between rows; tightens as you go. The fairness rule can only widen it. */
export const gapFor = (dist: number) => Math.max(24, 48 - dist / 60);
/** How far a row's obstacles reach either side of its meeting point, in your own distance. */
export const hitHalf = (kind: Kind) => (kind === 'car' ? CAR_L / (1 + ONCOMING) : CAR_L / 2 + CONE_R);
const share = (kind: Kind) => (kind === 'car' ? ONCOMING : 0);
/** Distance ahead of you that an obstacle is drawn at, when you have driven `dist`. */
export const zOf = (o: Obstacle, dist: number) => (1 + share(o.kind)) * (o.m - dist);

/** Lanes you might have to cross: the worst case over every open lane of `from` to its nearest open lane in `to`. */
export function reach(from: number[], to: number[]) {
  let worst = 0;
  for (const a of from) worst = Math.max(worst, Math.min(...to.map((b) => Math.abs(a - b))));
  return worst;
}

const BLOCKS: Record<1 | 2, number[][]> = { 1: [[0], [1], [2]], 2: [[0, 1], [0, 2], [1, 2]] };
const ALL = [0, 1, 2];

export function createCourse(seed: number): Course {
  return { seed: seed >>> 0, rand: rng32(seed), rows: [], obstacles: [], pickups: [], last: { m: 0, h: 0, open: ALL }, nextBox: FIRST_BOX, nextId: 1 };
}

function addRow(c: Course) {
  const r = c.rand;
  const prev = c.last;
  const two = prev.m > 150 && r() < Math.min(0.65, 0.3 + prev.m / 4000);
  // Now and then a row asks for a switch across the road; the spacing below grows to fit it.
  const across = r() < 0.15 ? 2 : 1;
  const options = BLOCKS[two ? 2 : 1].filter((b) => reach(prev.open, ALL.filter((l) => !b.includes(l))) <= across);
  const blocked = options[Math.floor(r() * options.length)];
  const open = ALL.filter((l) => !blocked.includes(l));
  const draft = blocked.map((lane) => {
    const kind: Kind = r() < 0.6 ? 'car' : 'cone';
    return { kind, lane, jitter: kind === 'cone' ? (r() - 0.5) * 2 : 0, hue: Math.floor(r() * 360) };
  });
  const h = Math.max(...draft.map((o) => hitHalf(o.kind) + Math.abs(o.jitter)));
  const lanes = reach(prev.open, open);
  const need = prev.h + h + topSpeed(prev.m + 120) * (GAP_TIME + LANE_TIME * lanes);
  const m = c.rows.length ? prev.m + Math.max(gapFor(prev.m), need) : Math.max(FIRST_ROW, need);
  for (const o of draft) c.obstacles.push({ id: c.nextId++, kind: o.kind, lane: o.lane, m: m + o.jitter, hue: o.hue });

  // Pickups go in the free road between the two rows.
  const from = prev.m + prev.h;
  const to = m - h;
  const free = to - from;
  const mid = (from + to) / 2;
  const both = open.filter((l) => prev.open.includes(l));
  if (mid >= c.nextBox && free >= 8) {
    for (const lane of ALL) c.pickups.push({ id: c.nextId++, kind: 'box', lane, m: mid });
    c.nextBox = mid + BOX_EVERY + r() * 120;
  } else if (both.length && free >= 10 && r() < 0.55) {
    const lane = both[Math.floor(r() * both.length)];
    const n = Math.min(5, Math.floor((free - 4) / 3) + 1);
    for (let i = 0; i < n; i++) c.pickups.push({ id: c.nextId++, kind: 'coin', lane, m: mid + (i - (n - 1) / 2) * 3 });
  } else if (both.length && prev.m > 200 && free >= 8 && r() < 0.3) {
    c.pickups.push({ id: c.nextId++, kind: 'dash', lane: both[Math.floor(r() * both.length)], m: mid });
  }

  const row = { m, h, open };
  c.rows.push(row);
  c.last = row;
}

/** Builds the course out to `until` meters. */
export function extend(c: Course, until: number) {
  while (c.last.m < until) addRow(c);
}

/** Drops rows, obstacles and pickups well behind `dist`. */
function prune(c: Course, dist: number) {
  const behind = dist - 30;
  if (c.rows.length && c.rows[0].m < behind) c.rows = c.rows.filter((r) => r.m + r.h >= behind);
  if (c.obstacles.length && c.obstacles[0].m < behind) c.obstacles = c.obstacles.filter((o) => o.m >= behind);
  if (c.pickups.length && c.pickups[0].m < behind) c.pickups = c.pickups.filter((p) => p.m >= behind);
}

/** A new run. Online racers line up across the lanes; every lane starts with a fair road ahead. */
export function create(seed = (Math.random() * 2 ** 32) >>> 0, countdown = COUNTDOWN, lane = 1): State {
  const course = createCourse(seed);
  extend(course, SPAWN_Z + 40);
  return {
    lane,
    x: laneX(lane),
    speed: 0,
    dist: 0,
    time: -countdown,
    course,
    balloons: BALLOONS,
    coins: 0,
    item: null,
    roll: 0,
    boost: 0,
    star: 0,
    spin: 0,
    safe: 0,
    shells: [],
    shotId: 1,
    gas: null,
    out: false,
    hitBy: null,
  };
}

export const racing = (s: State) => !s.out && s.time >= 0;

export function steer(s: State, dir: -1 | 1) {
  if (!racing(s) || s.spin > 0) return;
  s.lane = Math.min(LANES - 1, Math.max(0, s.lane + dir));
}

/** Gas during the countdown; the last press before GO decides the rocket start. */
export function gas(s: State) {
  if (s.time < 0 && !s.out) s.gas = s.time;
}

/** Uses the held item. Returns it, or null when there is nothing ready. */
export function fireItem(s: State): Item | null {
  if (!racing(s) || !s.item || s.roll > 0) return null;
  const item = s.item;
  s.item = null;
  if (item === 'mushroom') s.boost = Math.max(s.boost, MUSHROOM_T);
  else if (item === 'star') s.star = STAR_T;
  else s.shells.push({ id: s.shotId++, lane: s.lane, p: s.dist + 2 });
  return item;
}

/** Item box odds: the fewer balloons you have left, the likelier a star. */
export function rollItem(s: State, rng: Rng): Item {
  const star = 0.12 + 0.08 * (BALLOONS - s.balloons);
  const v = rng();
  return v < star ? 'star' : v < star + (1 - star) * 0.55 ? 'mushroom' : 'shell';
}

const noEvents = (): Events => ({ go: false, beep: null, rocket: false, coins: 0, box: false, got: null, dash: false, hit: null, smash: [], out: false });

export function step(s: State, dt: number, rng: Rng = Math.random): Events {
  const ev = noEvents();
  if (s.out) return ev;
  const before = s.time;
  s.time += dt;
  if (s.time < 0) {
    const n = Math.ceil(-s.time);
    if (n !== Math.ceil(-before) && n <= COUNTDOWN) ev.beep = n;
    return ev;
  }
  if (before < 0) {
    ev.go = true;
    if (s.gas !== null && s.gas >= -ROCKET_WINDOW) {
      s.boost = ROCKET_T;
      ev.rocket = true;
    }
  }
  const c = s.course;

  for (const k of ['boost', 'star', 'spin', 'safe'] as const) s[k] = Math.max(0, s[k] - dt);
  if (s.roll > 0) {
    s.roll = Math.max(0, s.roll - dt);
    if (s.roll === 0) ev.got = s.item;
  }

  // speed eases toward the target: base for this stretch, plus coins and boosts
  const target = baseSpeed(s.dist) + s.coins * COIN_TOP + (s.boost > 0 ? BOOST_DV : 0) + (s.star > 0 ? STAR_DV : 0);
  if (s.speed < target) s.speed = Math.min(target, s.speed + (s.boost > 0 ? BOOST_ACCEL : RECOVER) * dt);
  else s.speed = Math.max(target, s.speed - DECEL * dt);
  s.speed = Math.min(s.speed, topSpeed(s.dist) + (s.star > 0 ? STAR_DV : 0));

  const from = s.dist;
  s.dist += s.speed * dt;
  const to = s.dist;
  s.x = laneX(s.lane) + (s.x - laneX(s.lane)) * Math.exp(-STEER_K * dt);
  extend(c, to + SPAWN_Z + 40);

  for (const p of c.pickups) {
    const reachM = p.kind === 'dash' ? 2.2 : 1.2;
    if (p.taken || p.m + reachM < from || p.m - reachM > to) continue;
    const dx = Math.abs(laneX(p.lane) - s.x);
    if (p.kind === 'coin' && dx < 1.2) {
      p.taken = true;
      s.coins = Math.min(MAX_COINS, s.coins + 1);
      ev.coins++;
    } else if (p.kind === 'box' && dx < 1.5) {
      p.taken = true;
      ev.box = true;
      if (!s.item && s.roll === 0) {
        s.item = rollItem(s, rng);
        s.roll = ROLL_T;
      }
    } else if (p.kind === 'dash' && dx < 1.15) {
      p.taken = true;
      s.boost = Math.max(s.boost, DASH_T);
      ev.dash = true;
    }
  }

  // shells slide ahead in their lane and knock out the first thing they reach
  for (const sh of s.shells) sh.p += Math.max(SHELL_V, s.speed + 30) * dt;
  s.shells = s.shells.filter((sh) => {
    let first: Obstacle | null = null;
    let firstP = Infinity;
    for (const o of c.obstacles) {
      if (o.hitAt !== undefined || o.lane !== sh.lane || o.m + hitHalf(o.kind) < to) continue;
      const p = to + zOf(o, to);
      if (p <= sh.p + 1 && p < firstP) {
        first = o;
        firstP = p;
      }
    }
    if (first) {
      first.hitAt = s.time;
      ev.smash.push(first);
      return false;
    }
    return sh.p - to < SPAWN_Z;
  });

  for (const o of c.obstacles) {
    if (o.hitAt !== undefined || !hits(s.x, o, from, to)) continue;
    if (s.star > 0) {
      o.hitAt = s.time;
      ev.smash.push(o);
      continue;
    }
    if (s.safe > 0) continue;
    o.hitAt = s.time;
    s.hitBy = o;
    ev.hit = o;
    s.balloons--;
    s.coins = Math.max(0, s.coins - 3);
    s.speed *= 0.35;
    s.boost = 0;
    s.spin = SPIN_T;
    s.safe = SAFE_T;
    if (s.balloons <= 0) {
      s.out = true;
      ev.out = true;
    }
    break;
  }
  prune(c, to);
  return ev;
}

/** Does a kart at lateral position x touch this obstacle while driving from `from` to `to`? */
export function hits(x: number, o: Obstacle, from: number, to = from): boolean {
  const half = hitHalf(o.kind);
  if (o.m + half <= from || o.m - half >= to) return false;
  const reachX = o.kind === 'car' ? CAR_W : CAR_W / 2 + CONE_R;
  return Math.abs(laneX(o.lane) - x) < reachX;
}

export const score = (s: State) => Math.floor(s.dist);
export const kmh = (s: State) => Math.round(s.speed * 3.6);

/** 1st, 2nd, 3rd... */
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Your place among the racers by distance driven; ties go to you. */
export const placeOf = (dist: number, others: number[]) => 1 + others.filter((d) => d > dist).length;
