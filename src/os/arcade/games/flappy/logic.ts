// Pure Flappy Tree rules. World units: the playfield is always H tall, width follows the aspect ratio.

export const H = 600;
export const GROUND = 520;
export const CEIL = -40;
export const R = 15;
export const GRAVITY = 1650;
export const FLAP_V = -470;
export const MAX_FALL = 760;
export const COL_W = 70;
export const SPACING = 230;
export const START_SPEED = 170;
export const MAX_SPEED = 230;
export const GAP_START = 168;
export const GAP_MIN = 128;
export const MARGIN = 70;
export const MAX_SHIFT = 160;
export const STEP = 1 / 120;

export type Column = { x: number; gapY: number; gap: number; passed: boolean };

export type State = {
  w: number;
  birdX: number;
  y: number;
  vy: number;
  rot: number;
  cols: Column[];
  score: number;
  dist: number;
  time: number;
  dead: boolean;
  grounded: boolean;
  acc: number;
};

export type Events = { flapped: boolean; scored: number; crashed: boolean; landed: boolean };

export type Medal = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';

export const MEDALS: { medal: Exclude<Medal, 'none'>; at: number }[] = [
  { medal: 'bronze', at: 10 },
  { medal: 'silver', at: 20 },
  { medal: 'gold', at: 30 },
  { medal: 'platinum', at: 40 },
];

export function medalFor(score: number): Medal {
  let m: Medal = 'none';
  for (const t of MEDALS) if (score >= t.at) m = t.medal;
  return m;
}

/** Next medal threshold above score, or null once platinum is earned. */
export function nextMedal(score: number): number | null {
  for (const t of MEDALS) if (score < t.at) return t.at;
  return null;
}

export const birdXFor = (w: number) => Math.round(Math.min(Math.max(w * 0.3, 90), 220));

export function createState(w: number): State {
  return {
    w,
    birdX: birdXFor(w),
    y: H * 0.42,
    vy: 0,
    rot: 0,
    cols: [],
    score: 0,
    dist: 0,
    time: 0,
    dead: false,
    grounded: false,
    acc: 0,
  };
}

export const speedFor = (score: number) => Math.min(MAX_SPEED, START_SPEED + score * 1.5);
export const gapFor = (score: number) => Math.max(GAP_MIN, GAP_START - score * 1.2);

export function resize(s: State, w: number) {
  s.w = w;
  s.birdX = birdXFor(w);
}

/** Picks a gap center that stays on screen and never jumps too far from the previous one. */
export function nextGapY(prev: number | null, gap: number, r: number): number {
  const lo = MARGIN + gap / 2;
  const hi = GROUND - MARGIN - gap / 2;
  let y = lo + (hi - lo) * r;
  if (prev !== null) y = Math.min(prev + MAX_SHIFT, Math.max(prev - MAX_SHIFT, y));
  return Math.min(hi, Math.max(lo, y));
}

export function spawn(s: State, rng: () => number) {
  const last = s.cols[s.cols.length - 1];
  const x = last ? last.x + SPACING : Math.max(s.w + 40, s.birdX + 360);
  const gap = gapFor(s.score + s.cols.filter((c) => !c.passed).length);
  s.cols.push({ x, gapY: nextGapY(last ? last.gapY : null, gap, rng()), gap, passed: false });
}

/** Circle versus axis aligned rectangle. */
export function hitRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number) {
  const nx = Math.max(x, Math.min(cx, x + w));
  const ny = Math.max(y, Math.min(cy, y + h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function hitsColumn(s: State, c: Column, r = R) {
  const top = c.gapY - c.gap / 2;
  const bot = c.gapY + c.gap / 2;
  return hitRect(s.birdX, s.y, r, c.x, -1000, COL_W, top + 1000) || hitRect(s.birdX, s.y, r, c.x, bot, COL_W, GROUND - bot + 40);
}

export function flap(s: State): boolean {
  if (s.dead) return false;
  s.vy = FLAP_V;
  return true;
}

function sub(s: State, dt: number, rng: () => number, ev: Events) {
  s.time += dt;
  s.vy = Math.min(MAX_FALL, s.vy + GRAVITY * dt);
  s.y += s.vy * dt;
  const target = s.vy < 0 ? -0.42 : Math.min(1.45, (s.vy / MAX_FALL) * 1.7 - 0.25);
  s.rot += (target - s.rot) * Math.min(1, dt * (s.vy < 0 ? 18 : 6));
  if (s.y < CEIL) {
    s.y = CEIL;
    s.vy = Math.max(0, s.vy);
  }
  if (s.y + R >= GROUND) {
    s.y = GROUND - R;
    s.vy = 0;
    if (!s.grounded) {
      s.grounded = true;
      ev.landed = true;
    }
    if (!s.dead) {
      s.dead = true;
      ev.crashed = true;
    }
    return;
  }
  if (s.dead) return;
  const v = speedFor(s.score);
  s.dist += v * dt;
  for (const c of s.cols) {
    c.x -= v * dt;
    if (!c.passed && c.x + COL_W / 2 < s.birdX) {
      c.passed = true;
      s.score += 1;
      ev.scored += 1;
    }
    if (hitsColumn(s, c)) {
      s.dead = true;
      ev.crashed = true;
      s.vy = Math.max(s.vy, 120);
      return;
    }
  }
  s.cols = s.cols.filter((c) => c.x + COL_W > -40);
  while (!s.cols.length || s.cols[s.cols.length - 1].x < s.w + SPACING) spawn(s, rng);
}

export function step(s: State, dt: number, input: { flap: boolean }, rng: () => number): Events {
  const ev: Events = { flapped: false, scored: 0, crashed: false, landed: false };
  if (input.flap) ev.flapped = flap(s);
  s.acc += Math.min(dt, 0.1);
  while (s.acc >= STEP) {
    s.acc -= STEP;
    sub(s, STEP, rng, ev);
    if (s.grounded) {
      s.acc = 0;
      break;
    }
  }
  return ev;
}

/** Idle bob used before the first flap. */
export const hover = (t: number) => H * 0.42 + Math.sin(t * 5) * 8;

/** Simple controller used by tests: flap whenever the tree sinks below a point just under the next gap center. */
export function autopilot(s: State): boolean {
  const c = s.cols.find((k) => k.x + COL_W > s.birdX - R);
  const target = c ? c.gapY + c.gap * 0.18 : H * 0.45;
  return s.y > target && s.vy > -60;
}

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
