export type Pace = 'relaxed' | 'standard';
export type Point = { x: number; y: number };
export type Target = Point & { id: number; radius: number };
export type Pattern = 'fixed' | 'rails' | 'bounce' | 'carousel' | 'eight' | 'pendulum' | 'pretzel' | 'spin' | 'ricochet' | 'hop';
export type Wave = { name: string; hint: string; goal: number; seconds: number; speed: number; pattern: Pattern; size: number };

/** The hand-built opening. After it, waveAt keeps generating harder waves for as long as the player lasts. */
export const WAVES: readonly Wave[] = [
  { name: 'Warm Up', hint: 'Find the center', goal: 4, seconds: 16, speed: 0, pattern: 'fixed', size: 1 },
  { name: 'On Rails', hint: 'Follow the glide', goal: 5, seconds: 18, speed: 0.85, pattern: 'rails', size: 1 },
  { name: 'Bounce', hint: 'Catch the rhythm', goal: 6, seconds: 20, speed: 1.1, pattern: 'bounce', size: 1 },
  { name: 'Carousel', hint: 'Keep them in sight', goal: 7, seconds: 22, speed: 1.25, pattern: 'carousel', size: 1 },
  { name: 'Figure Eight', hint: 'Stay on the loop', goal: 8, seconds: 24, speed: 1.4, pattern: 'eight', size: 1 },
];

/** Generated waves cycle through these; a returning pattern gets a numeral, e.g. Carousel II. */
const ENCORE: readonly { pattern: Pattern; name: string; hint: string }[] = [
  { pattern: 'pendulum', name: 'Pendulum', hint: 'Lead the swing' },
  { pattern: 'pretzel', name: 'Pretzel', hint: 'Read the loops' },
  { pattern: 'spin', name: 'Counterspin', hint: 'Two rings, two ways' },
  { pattern: 'ricochet', name: 'Ricochet', hint: 'Straight lines, hard bounces' },
  { pattern: 'hop', name: 'Pop Up', hint: 'They will not wait' },
  { pattern: 'rails', name: 'On Rails', hint: 'Faster glide' },
  { pattern: 'bounce', name: 'Bounce', hint: 'Faster rhythm' },
  { pattern: 'carousel', name: 'Carousel', hint: 'Faster spin' },
  { pattern: 'eight', name: 'Figure Eight', hint: 'Faster loop' },
];

const NUMERALS = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const;
function roman(n: number) {
  let out = '';
  for (const [value, glyph] of NUMERALS) for (; n >= value; n -= value) out += glyph;
  return out;
}

/**
 * Every wave from the sixth on is generated, so the range never runs out. Each one asks for a few more
 * targets, less time per target, faster motion, and smaller targets, easing toward a hard ceiling.
 */
export function waveAt(n: number): Wave {
  if (n < WAVES.length) return WAVES[Math.max(0, n)];
  const step = n - WAVES.length + 1;
  const encore = ENCORE[(step - 1) % ENCORE.length];
  const repeats = Math.floor((step - 1) / ENCORE.length) + (WAVES.some((w) => w.pattern === encore.pattern) ? 1 : 0);
  const goal = Math.min(15, 8 + Math.ceil(step / 2));
  return {
    name: repeats ? `${encore.name} ${roman(repeats + 1)}` : encore.name,
    hint: encore.hint,
    goal,
    seconds: goal * (1.7 + 1.3 * 0.9 ** step),
    speed: 1.4 + 1.0 * (1 - 0.92 ** step),
    pattern: encore.pattern,
    size: 0.68 + 0.32 * 0.93 ** step,
  };
}

export const INTRO_SECONDS = 1.2;
export const CLEAR_SECONDS = 1.1;
export const RESPAWN_SECONDS = 0.38;

export type RangeState = {
  pace: Pace;
  wave: number;
  phase: 'intro' | 'live' | 'clear' | 'over';
  phaseLeft: number;
  timeLeft: number;
  motionTime: number;
  waveHits: number;
  hits: number;
  misses: number;
  bullseyes: number;
  combo: number;
  bestCombo: number;
  score: number;
  bonus: number;
  cooldowns: number[];
};

const secondsFor = (wave: number, pace: Pace) => waveAt(wave).seconds * (pace === 'relaxed' ? 1.4 : 1);
export const multiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 3));
export const accuracy = (g: RangeState) => (g.hits + g.misses ? Math.round((g.hits / (g.hits + g.misses)) * 100) : 0);

export function createRange(pace: Pace = 'standard'): RangeState {
  return {
    pace, wave: 0, phase: 'intro', phaseLeft: INTRO_SECONDS,
    timeLeft: secondsFor(0, pace), motionTime: 0, waveHits: 0,
    hits: 0, misses: 0, bullseyes: 0, combo: 0, bestCombo: 0,
    score: 0, bonus: 0, cooldowns: [0, 0, 0],
  };
}

/** The only way a round ends is the wave clock running out; clearing a wave always leads to another. */
export function stepRange(g: RangeState, dt: number): 'wave' | 'over' | undefined {
  if (!Number.isFinite(dt) || dt <= 0 || g.phase === 'over') return;
  if (g.phase === 'intro' || g.phase === 'clear') {
    g.phaseLeft = Math.max(0, g.phaseLeft - dt);
    if (g.phaseLeft > 0) return;
    if (g.phase === 'intro') {
      g.phase = 'live';
      return;
    }
    g.wave++;
    g.phase = 'intro';
    g.phaseLeft = INTRO_SECONDS;
    g.timeLeft = secondsFor(g.wave, g.pace);
    g.motionTime = 0;
    g.waveHits = 0;
    g.cooldowns = [0, 0, 0];
    return 'wave';
  }
  g.timeLeft = Math.max(0, g.timeLeft - dt);
  g.motionTime += dt * (g.pace === 'relaxed' ? 0.65 : 1);
  g.cooldowns = g.cooldowns.map((n) => Math.max(0, n - dt));
  if (g.timeLeft === 0) {
    g.phase = 'over';
    return 'over';
  }
}

export const PENDULUM = { pivot: 0.04, lengths: [0.3, 0.52, 0.74], swing: 0.9, reach: 0.3 } as const;
export const RICOCHET = { left: 0.2, top: 0.21, width: 0.6, height: 0.58 } as const;
const HOP_EVERY = 2.6;

/** A pendulum target hanging from the top center, `angle` radians from straight down. */
export function pendulumPoint(slot: number, angle: number): Point {
  return {
    x: 0.5 + PENDULUM.reach * (Math.sin(angle) / Math.sin(PENDULUM.swing)),
    y: PENDULUM.pivot + PENDULUM.lengths[slot] * Math.cos(angle),
  };
}

// A triangle wave in [-1, 1]: constant speed with a sharp turn at each wall.
const zigzag = (u: number) => (2 / Math.PI) * Math.asin(Math.sin(u));

// A stable pseudo-random number in [0, 1) for one slot's nth hop.
function noise(slot: number, n: number) {
  let h = Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(n + 0x632be5ab, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Where a slot's target sits in normalized canvas space after `t` radians of motion. Always within 0.2 to 0.8. */
export function patternPoint(pattern: Pattern, slot: number, t: number): Point {
  const phase = (slot * Math.PI * 2) / 3;
  switch (pattern) {
    case 'fixed': return { x: 0.2 + slot * 0.3, y: slot === 1 ? 0.35 : 0.62 };
    case 'rails': return { x: 0.5 + 0.29 * Math.sin(t + phase), y: 0.22 + slot * 0.28 };
    case 'bounce': return { x: 0.2 + slot * 0.3, y: 0.5 + 0.29 * Math.sin(t + phase) };
    case 'carousel': return { x: 0.5 + 0.3 * Math.cos(t + phase), y: 0.5 + 0.29 * Math.sin(t + phase) };
    case 'eight': return { x: 0.5 + 0.29 * Math.sin(t + phase), y: 0.5 + 0.29 * Math.sin(2 * (t + phase)) };
    case 'pendulum': return pendulumPoint(slot, PENDULUM.swing * Math.sin(t * (1.15 - slot * 0.13) + phase));
    case 'pretzel': {
      // A 3:2 Lissajous knot the three targets chase each other around. Spacing them a third of the way
      // around would line them up in one column, so they sit a quarter turn apart instead.
      const u = t + (slot * Math.PI) / 2;
      return { x: 0.5 + 0.3 * Math.sin(1.5 * u), y: 0.5 + 0.29 * Math.sin(u) };
    }
    case 'spin': {
      // The outer pair turns one way; the middle target turns faster the other way on an inner ring.
      if (slot === 1) return { x: 0.5 + 0.14 * Math.cos(-1.5 * t), y: 0.5 + 0.13 * Math.sin(-1.5 * t) };
      const a = t + (slot ? Math.PI : 0);
      return { x: 0.5 + 0.3 * Math.cos(a), y: 0.5 + 0.29 * Math.sin(a) };
    }
    case 'ricochet': {
      const box = RICOCHET;
      const x = (1 + zigzag(1.3 * t + phase)) / 2;
      const y = (1 + zigzag(1.7 * t + phase * 1.6)) / 2;
      return { x: box.left + box.width * x, y: box.top + box.height * y };
    }
    case 'hop': {
      // Each target holds still, then jumps somewhere new in its own column; the three hop out of step.
      const n = Math.floor(t / HOP_EVERY + slot / 3);
      return { x: 0.2 + slot * 0.2 + 0.2 * noise(slot, n), y: 0.22 + 0.56 * noise(slot + 3, n) };
    }
  }
}

export function targetPosition(wave: number, slot: number, time: number): Point {
  const w = waveAt(wave);
  return patternPoint(w.pattern, slot, time * w.speed);
}

export function targetsFor(g: RangeState, width: number, height: number): Target[] {
  if (width <= 0 || height <= 0 || g.phase === 'clear' || g.phase === 'over') return [];
  const full = Math.min(42, Math.max(24, Math.min(width / 9, height / 5.8)), width / 7, height / 4.5);
  // Later waves shrink the targets, but never below a fingertip.
  const radius = Math.max(Math.min(24, full), full * waveAt(g.wave).size);
  return g.cooldowns.flatMap((cooldown, slot) => {
    if (cooldown > 0) return [];
    const p = targetPosition(g.wave, slot, g.motionTime);
    return [{ id: slot, x: p.x * width, y: p.y * height, radius }];
  });
}

export function hitTest(point: Point, targets: readonly Target[]): { target: Target; bullseye: boolean } | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  // The last target is painted in front when the figure-eight paths cross.
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= target.radius) return { target, bullseye: distance <= target.radius * 0.3 };
  }
  return null;
}

export type Shot = { kind: 'hit' | 'bullseye' | 'miss'; points: number; target?: Target; cleared?: boolean };

export function shootRange(g: RangeState, point: Point, targets: readonly Target[]): Shot | null {
  if (g.phase !== 'live' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const hit = hitTest(point, targets.filter((t) => g.cooldowns[t.id] === 0));
  if (!hit) {
    g.misses++;
    g.combo = 0;
    return { kind: 'miss', points: 0 };
  }
  g.hits++;
  g.waveHits++;
  g.combo++;
  g.bestCombo = Math.max(g.bestCombo, g.combo);
  if (hit.bullseye) g.bullseyes++;
  const points = (hit.bullseye ? 150 : 100) * multiplier(g.combo);
  g.score += points;
  g.cooldowns[hit.target.id] = RESPAWN_SECONDS;
  const cleared = g.waveHits >= waveAt(g.wave).goal;
  if (cleared) {
    g.bonus = Math.ceil(g.timeLeft) * 10;
    g.score += g.bonus;
    g.phase = 'clear';
    g.phaseLeft = CLEAR_SECONDS;
  }
  return { kind: hit.bullseye ? 'bullseye' : 'hit', points, target: hit.target, cleared };
}

export function localAim(offsetX: number, offsetY: number, width: number, height: number): Point | null {
  if (![offsetX, offsetY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (offsetX < 0 || offsetY < 0 || offsetX > width || offsetY > height) return null;
  return { x: offsetX, y: offsetY };
}
