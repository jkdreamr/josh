// Pure rules for Dino Run: physics, spawning, collisions and scoring. World units, y up from the ground.
// No DOM here so tests can run it under plain node.

export type Box = { x: number; y: number; w: number; h: number };
export type Kind = 'small' | 'large' | 'flyer';
export type Obstacle = { kind: Kind; x: number; y: number; w: number; h: number; count: number; seed: number };
export type Input = { jump: boolean; duck: boolean };
export type Events = { jumped: boolean; landed: boolean; crashed: boolean; milestone: number; night: boolean | null };

export const DINO_X = 40;
export const DINO_W = 40;
export const DINO_H = 44;
export const DUCK_W = 54;
export const DUCK_H = 26;
export const GRAVITY = 2160;
export const JUMP_V = 600;
/** Releasing jump early caps the upward speed, for short hops. */
export const HOP_V = 300;
/** A tap always lifts at least this long before the hop cap applies. */
export const MIN_HOLD = 0.06;
export const FAST_FALL = 2.6;
export const START_SPEED = 360;
export const MAX_SPEED = 800;
export const ACCEL = 4.5;
export const SCORE_RATE = 0.025;
export const FLYER_SCORE = 250;
export const MILESTONE = 100;
export const NIGHT_EVERY = 700;
export const SMALL_W = 17;
export const SMALL_H = 35;
export const LARGE_W = 25;
export const LARGE_H = 50;
export const FLYER_W = 46;
export const FLYER_H = 30;
/** Flyer bottoms: low must be jumped, mid must be ducked (or jumped), high clears a standing dino. */
export const FLYER_Y = [3, 21, 43] as const;
const STEP = 1 / 120;

/** Hit boxes relative to the dino's bottom-left, slightly smaller than the drawing to feel fair. */
export const dinoBoxes = (ducking: boolean): Box[] =>
  ducking
    ? [
        { x: 6, y: 2, w: 30, h: 16 },
        { x: 34, y: 6, w: 18, h: 13 },
      ]
    : [
        { x: 21, y: 29, w: 18, h: 14 },
        { x: 7, y: 11, w: 23, h: 20 },
        { x: 11, y: 1, w: 14, h: 11 },
      ];

export function obstacleBoxes(o: Obstacle): Box[] {
  if (o.kind === 'flyer')
    return [
      { x: 8, y: 9, w: 26, h: 9 },
      { x: 32, y: 10, w: 12, h: 8 },
    ];
  const unit = o.kind === 'small' ? SMALL_W : LARGE_W;
  const boxes: Box[] = [];
  for (let i = 0; i < o.count; i++) boxes.push({ x: i * unit + 3, y: 0, w: unit - 6, h: o.h - 3 });
  return boxes;
}

export type State = {
  y: number;
  vy: number;
  ground: boolean;
  ducking: boolean;
  /** Jump held since takeoff, for variable height. */
  holding: boolean;
  /** Seconds since takeoff. */
  air: number;
  speed: number;
  distance: number;
  score: number;
  time: number;
  obstacles: Obstacle[];
  /** Distance left before the next spawn. */
  next: number;
  lastKinds: Kind[];
  dead: boolean;
  viewW: number;
};

export function createState(viewW: number): State {
  return {
    y: 0,
    vy: 0,
    ground: true,
    ducking: false,
    holding: false,
    air: 0,
    speed: START_SPEED,
    distance: 0,
    score: 0,
    time: 0,
    obstacles: [],
    next: Math.max(260, viewW * 0.55),
    lastKinds: [],
    dead: false,
    viewW,
  };
}

export const isNight = (score: number) => Math.floor(score / NIGHT_EVERY) % 2 === 1;
export const speedAt = (time: number) => Math.min(MAX_SPEED, START_SPEED + ACCEL * time);

/** Clear gap (in world units) to leave after an obstacle of width w at the current speed. Always long enough to land and jump again. */
export const gapFor = (speed: number, w: number, r: number) => w + speed * (0.62 + r * 0.62) + 36;

export function pickObstacle(s: State, rng: () => number): Obstacle {
  const flyers = s.score >= FLYER_SCORE;
  let kind: Kind;
  for (;;) {
    const r = rng();
    kind = flyers && r < 0.22 ? 'flyer' : r < 0.6 ? 'small' : 'large';
    const run = s.lastKinds.length >= 2 && s.lastKinds.every((k) => k === kind);
    if (!run) break;
  }
  const seed = Math.floor(rng() * 1e6);
  if (kind === 'flyer') {
    const y = FLYER_Y[Math.floor(rng() * FLYER_Y.length) % FLYER_Y.length];
    return { kind, x: s.viewW + 20, y, w: FLYER_W, h: FLYER_H, count: 1, seed };
  }
  const maxCount = s.speed < 420 ? 1 : s.speed < 520 ? 2 : 3;
  const count = kind === 'large' ? 1 + Math.floor(rng() * Math.min(maxCount, 2)) : 1 + Math.floor(rng() * maxCount);
  const unit = kind === 'small' ? SMALL_W : LARGE_W;
  return { kind, x: s.viewW + 20, y: 0, w: unit * count, h: kind === 'small' ? SMALL_H : LARGE_H, count, seed };
}

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function collides(s: State, o: Obstacle) {
  for (const d of dinoBoxes(s.ducking)) {
    const a = { x: DINO_X + d.x, y: s.y + d.y, w: d.w, h: d.h };
    for (const b of obstacleBoxes(o)) if (overlaps(a, { x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h })) return true;
  }
  return false;
}

/** Flyers drift a touch faster than the ground. */
const flyerBoost = (o: Obstacle) => (o.kind === 'flyer' ? 0.06 : 0);

function substep(s: State, h: number, input: Input, rng: () => number, ev: Events) {
  if (s.ground) {
    s.ducking = input.duck && !input.jump;
    if (input.jump) {
      s.vy = JUMP_V;
      s.ground = false;
      s.ducking = false;
      s.holding = true;
      s.air = 0;
      ev.jumped = true;
    }
  }
  if (!s.ground) {
    s.air += h;
    if (!input.jump && s.air > MIN_HOLD) s.holding = false;
    if (!s.holding && s.vy > HOP_V) s.vy = HOP_V;
    s.ducking = false;
    s.vy -= GRAVITY * (input.duck ? FAST_FALL : 1) * h;
    s.y += s.vy * h;
    if (s.y <= 0) {
      s.y = 0;
      s.vy = 0;
      s.ground = true;
      s.ducking = input.duck;
      ev.landed = true;
    }
  }

  s.time += h;
  s.speed = speedAt(s.time);
  const dx = s.speed * h;
  s.distance += dx;
  const before = s.score;
  s.score += dx * SCORE_RATE;
  const m = Math.floor(s.score / MILESTONE);
  if (m > Math.floor(before / MILESTONE)) ev.milestone = m * MILESTONE;
  if (Math.floor(s.score / NIGHT_EVERY) !== Math.floor(before / NIGHT_EVERY)) ev.night = isNight(s.score);

  for (const o of s.obstacles) o.x -= dx * (1 + flyerBoost(o));
  s.obstacles = s.obstacles.filter((o) => o.x + o.w > -40);

  s.next -= dx;
  if (s.next <= 0) {
    const o = pickObstacle(s, rng);
    s.obstacles.push(o);
    s.lastKinds = [...s.lastKinds, o.kind].slice(-2);
    s.next = gapFor(s.speed, o.w, rng());
  }

  for (const o of s.obstacles)
    if (collides(s, o)) {
      s.dead = true;
      ev.crashed = true;
      return;
    }
}

/** Advances the world by dt seconds (split into fixed small steps). */
export function step(s: State, dt: number, input: Input, rng: () => number): Events {
  const ev: Events = { jumped: false, landed: false, crashed: false, milestone: 0, night: null };
  if (s.dead) return ev;
  let left = dt;
  while (left > 1e-9 && !s.dead) {
    const h = Math.min(STEP, left);
    substep(s, h, input, rng, ev);
    left -= h;
  }
  return ev;
}

/** Simple autopilot, used by the tests to prove every generated course can be cleared. */
export function autopilot(s: State): Input {
  const front = DINO_X + DINO_W;
  const o = s.obstacles.find((x) => x.x + x.w > DINO_X);
  if (!o) return { jump: false, duck: false };
  const d = o.x - front;
  if (o.kind === 'flyer' && o.y === FLYER_Y[2]) return { jump: false, duck: false };
  if (o.kind === 'flyer' && o.y === FLYER_Y[1]) return { jump: false, duck: d < 140 };
  return { jump: (!s.ground && s.vy > 0) || (d <= s.speed * 0.13 && d > -10), duck: false };
}

/** Deterministic PRNG (mulberry32). */
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

export const pad = (n: number) => String(Math.floor(n)).padStart(5, '0');
