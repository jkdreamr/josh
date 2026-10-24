export type Pace = 'relaxed' | 'standard';
export type Point = { x: number; y: number };
export type Target = Point & { id: number; radius: number };
export type Pattern =
  | 'fixed' | 'rails' | 'bounce' | 'carousel' | 'eight'
  | 'pendulum' | 'pretzel' | 'trampoline' | 'spin' | 'bloom' | 'ricochet'
  | 'moons' | 'whirlpool' | 'hop' | 'shell' | 'darts' | 'hornets';
type Move = Exclude<Pattern, 'fixed'>;
export type Wave = {
  name: string;
  hint: string;
  goal: number;
  seconds: number;
  speed: number;
  /** Each target's motion. Usually all three match; Mayhem waves give each target its own. */
  patterns: readonly [Pattern, Pattern, Pattern];
  size: number;
  /** How hard the pace lurches. Past 1, the whole gallery briefly runs backwards before surging on. */
  surge: number;
};

const all = <P extends Pattern>(p: P) => [p, p, p] as const;

/** The hand-built opening. After it, waveAt keeps generating harder waves for as long as the player lasts. */
export const WAVES: readonly Wave[] = [
  { name: 'Warm Up', hint: 'Find the center', goal: 4, seconds: 16, speed: 0, patterns: all('fixed'), size: 1, surge: 0 },
  { name: 'On Rails', hint: 'Follow the glide', goal: 5, seconds: 18, speed: 0.85, patterns: all('rails'), size: 1, surge: 0 },
  { name: 'Bounce', hint: 'Catch the rhythm', goal: 6, seconds: 20, speed: 1.1, patterns: all('bounce'), size: 1, surge: 0 },
  { name: 'Carousel', hint: 'Keep them in sight', goal: 7, seconds: 22, speed: 1.25, patterns: all('carousel'), size: 1, surge: 0 },
  { name: 'Figure Eight', hint: 'Stay on the loop', goal: 8, seconds: 24, speed: 1.4, patterns: all('eight'), size: 1, surge: 0 },
];

const MOVES: Record<Move, { name: string; hint: string }> = {
  rails: { name: 'On Rails', hint: 'Follow the glide' },
  bounce: { name: 'Bounce', hint: 'Catch the rhythm' },
  carousel: { name: 'Carousel', hint: 'Keep them in sight' },
  eight: { name: 'Figure Eight', hint: 'Stay on the loop' },
  pendulum: { name: 'Pendulum', hint: 'Lead the swing' },
  pretzel: { name: 'Pretzel', hint: 'Read the loops' },
  trampoline: { name: 'Trampoline', hint: 'Slowest at the peak' },
  spin: { name: 'Counterspin', hint: 'Two rings, two ways' },
  bloom: { name: 'Bloom', hint: 'Petals cross in the middle' },
  ricochet: { name: 'Ricochet', hint: 'Straight lines, hard bounces' },
  moons: { name: 'Moons', hint: 'A spin inside a spin' },
  whirlpool: { name: 'Whirlpool', hint: 'In and out' },
  hop: { name: 'Pop Up', hint: 'They will not wait' },
  shell: { name: 'Shell Game', hint: 'Keep your eye on one' },
  darts: { name: 'Darts', hint: 'Hit them while they rest' },
  hornets: { name: 'Hornets', hint: 'Nothing to predict' },
};

/** Wave six on introduces these one at a time, calmest first. */
const DEBUTS: readonly Move[] = ['pendulum', 'pretzel', 'trampoline', 'spin', 'bloom', 'ricochet', 'moons', 'whirlpool', 'hop', 'shell', 'darts', 'hornets'];
/** Then every moving pattern comes back in this order, a numeral higher each lap. */
const CYCLE: readonly Move[] = ['rails', 'pendulum', 'bounce', 'pretzel', 'carousel', 'trampoline', 'eight', 'spin', 'bloom', 'ricochet', 'moons', 'whirlpool', 'hop', 'shell', 'darts', 'hornets'];

const NUMERALS = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const;
function roman(n: number) {
  let out = '';
  for (const [value, glyph] of NUMERALS) for (; n >= value; n -= value) out += glyph;
  return out;
}
const numbered = (name: string, n: number) => (n > 1 ? `${name} ${roman(n)}` : name);

// A stable pseudo-random number in [0, 1) for a stream and an index.
function noise(stream: number, n: number) {
  let h = Math.imul(stream + 1, 0x9e3779b1) ^ Math.imul(n + 0x632be5ab, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Every wave from the sixth on is generated, so the range never runs out. The first twelve each debut a
 * new pattern. After that, patterns return with numerals, every fourth wave is Mayhem (three different
 * patterns at once), and the pace starts to lurch and double back. Throughout, each wave asks for more
 * targets with less time per target, faster motion, and smaller targets, easing toward a hard ceiling.
 */
export function waveAt(n: number): Wave {
  if (n < WAVES.length) return WAVES[Math.max(0, n)];
  const step = n - WAVES.length + 1;
  const goal = Math.min(18, 8 + Math.ceil(step / 2));
  const ramp = {
    goal,
    seconds: goal * (1.7 + 1.3 * 0.9 ** step),
    speed: 1.4 + 1.3 * (1 - 0.94 ** step),
    size: 0.62 + 0.38 * 0.94 ** step,
    surge: step > DEBUTS.length ? 1.6 * (1 - 0.88 ** (step - DEBUTS.length)) : 0,
  };
  if (step <= DEBUTS.length) {
    const move = DEBUTS[step - 1];
    return { ...MOVES[move], ...ramp, patterns: all(move) };
  }
  const k = step - DEBUTS.length - 1;
  const block = Math.floor(k / 4);
  if (k % 4 === 3) {
    const pool = [...CYCLE];
    const pick = (i: number) => pool.splice(Math.floor(noise(40 + i, block) * pool.length), 1)[0];
    const patterns = [pick(0), pick(1), pick(2)] as const;
    return { name: numbered('Mayhem', block + 1), hint: patterns.map((p) => MOVES[p].name).join(' + '), ...ramp, patterns };
  }
  const c = block * 3 + (k % 4);
  const move = CYCLE[c % CYCLE.length];
  return { name: numbered(MOVES[move].name, 2 + Math.floor(c / CYCLE.length)), hint: MOVES[move].hint, ...ramp, patterns: all(move) };
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
const DART_EVERY = 2.4;
const SHELL_EVERY = 1.9;
const SHELL_SWAPS = [[0, 1], [1, 2], [0, 2]] as const;
const SURGE_RATE = 1.2;

/** A pendulum target hanging from the top center, `angle` radians from straight down. */
export function pendulumPoint(slot: number, angle: number): Point {
  return {
    x: 0.5 + PENDULUM.reach * (Math.sin(angle) / Math.sin(PENDULUM.swing)),
    y: PENDULUM.pivot + PENDULUM.lengths[slot] * Math.cos(angle),
  };
}

// A triangle wave in [-1, 1]: constant speed with a sharp turn at each wall.
const zigzag = (u: number) => (2 / Math.PI) * Math.asin(Math.sin(u));
const ease = (s: number) => s * s * (3 - 2 * s);
const dartSpot = (slot: number, n: number): Point => ({ x: 0.2 + 0.6 * noise(slot + 10, n), y: 0.22 + 0.56 * noise(slot + 13, n) });

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
    case 'trampoline':
      // A bouncing ball: a sharp turn at the floor, a slow hang at the top, drifting side to side.
      return { x: 0.5 + 0.3 * Math.sin(0.55 * t + phase), y: 0.78 - 0.56 * Math.abs(Math.sin(1.3 * t + phase / 2)) };
    case 'spin': {
      // The outer pair turns one way; the middle target turns faster the other way on an inner ring.
      if (slot === 1) return { x: 0.5 + 0.14 * Math.cos(-1.5 * t), y: 0.5 + 0.13 * Math.sin(-1.5 * t) };
      const a = t + (slot ? Math.PI : 0);
      return { x: 0.5 + 0.3 * Math.cos(a), y: 0.5 + 0.29 * Math.sin(a) };
    }
    case 'bloom': {
      // A four-petal rose: every target dives through the middle twice a lap.
      const u = t + phase;
      const r = Math.cos(2 * u);
      return { x: 0.5 + 0.3 * r * Math.cos(u), y: 0.5 + 0.29 * r * Math.sin(u) };
    }
    case 'ricochet': {
      const box = RICOCHET;
      const x = (1 + zigzag(1.3 * t + phase)) / 2;
      const y = (1 + zigzag(1.7 * t + phase * 1.6)) / 2;
      return { x: box.left + box.width * x, y: box.top + box.height * y };
    }
    case 'moons': {
      // Three moons circle a hub that is itself circling the range.
      const hub = 0.6 * t;
      const a = 1.6 * t + phase;
      return { x: 0.5 + 0.15 * Math.cos(hub) + 0.15 * Math.cos(a), y: 0.5 + 0.14 * Math.sin(hub) + 0.15 * Math.sin(a) };
    }
    case 'whirlpool': {
      // Round and round while the radius breathes in toward the drain and back out.
      const r = 0.5 + 0.5 * Math.sin(0.7 * t + phase);
      const a = 1.5 * t + phase;
      return { x: 0.5 + (0.06 + 0.24 * r) * Math.cos(a), y: 0.5 + (0.06 + 0.23 * r) * Math.sin(a) };
    }
    case 'hop': {
      // Each target holds still, then jumps somewhere new in its own column; the three hop out of step.
      const n = Math.floor(t / HOP_EVERY + slot / 3);
      return { x: 0.2 + slot * 0.2 + 0.2 * noise(slot, n), y: 0.22 + 0.56 * noise(slot + 3, n) };
    }
    case 'shell': {
      // Three cups on a shelf. One pair at a time trades places, one passing over and the other under.
      const v = t / SHELL_EVERY;
      const n = Math.floor(v);
      const swap = (k: number) => SHELL_SWAPS[Math.floor(noise(7, k) * 3)];
      let spot = slot;
      for (let k = 0; k < n; k++) {
        const [a, b] = swap(k);
        spot = spot === a ? b : spot === b ? a : spot;
      }
      const [a, b] = swap(n);
      const s = Math.min(1, (v - n) / 0.6);
      const x = (i: number) => 0.2 + i * 0.3;
      if (spot !== a && spot !== b) return { x: x(spot), y: 0.5 };
      const to = spot === a ? b : a;
      if (s === 1) return { x: x(to), y: 0.5 };
      return { x: x(spot) + (x(to) - x(spot)) * ease(s), y: 0.5 + (spot === a ? -0.26 : 0.26) * Math.sin(Math.PI * s) };
    }
    case 'darts': {
      // Rest, then streak to a new spot anywhere on the range.
      const v = t / DART_EVERY + slot / 3;
      const n = Math.floor(v);
      const s = ease(Math.max(0, (v - n - 0.55) / 0.45));
      const from = dartSpot(slot, n);
      const to = dartSpot(slot, n + 1);
      return { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s };
    }
    case 'hornets': {
      // Overlapping wobbles at unrelated rates, so the path never settles into a shape.
      const a = slot * 1.7;
      return {
        x: 0.5 + 0.18 * Math.sin(1.13 * t + a) + 0.12 * Math.sin(2.71 * t + 2 * a + 1),
        y: 0.5 + 0.17 * Math.sin(1.37 * t + a + 2) + 0.12 * Math.sin(2.29 * t + 3 * a),
      };
    }
  }
}

/** Radians of motion `time` seconds into a wave: steady, then lurching, then doubling back as the surge grows. */
export function motionAt(w: Wave, time: number) {
  return w.speed * (time + (w.surge / SURGE_RATE) * Math.sin(SURGE_RATE * time));
}

export function targetPosition(wave: number, slot: number, time: number): Point {
  const w = waveAt(wave);
  return patternPoint(w.patterns[slot], slot, motionAt(w, time));
}

export function targetsFor(g: RangeState, width: number, height: number): Target[] {
  if (width <= 0 || height <= 0 || g.phase === 'clear' || g.phase === 'over') return [];
  const w = waveAt(g.wave);
  // Later waves shrink the targets, but never below a fingertip.
  const radius = radiusFor(g.wave, width, height);
  const t = motionAt(w, g.motionTime);
  return g.cooldowns.flatMap((cooldown, slot) => {
    if (cooldown > 0) return [];
    const p = toCanvas(patternPoint(w.patterns[slot], slot, t), width, height, radius);
    return [{ id: slot, ...p, radius }];
  });
}

/** The target radius for a wave on a canvas of this size. */
export function radiusFor(wave: number, width: number, height: number) {
  const full = Math.min(54, Math.max(24, Math.min(width / 10, height / 6.5)), width / 7, height / 4.5);
  return Math.max(Math.min(24, full), full * waveAt(wave).size);
}

/**
 * Normalized range space to canvas pixels. Patterns live between 0.2 and 0.8; on a roomy canvas that maps
 * straight across, and on a short or narrow one the band stretches so a target never pokes past the edge.
 */
export function toCanvas(p: Point, width: number, height: number, radius: number): Point {
  const axis = (v: number, size: number) => {
    const margin = Math.min(size / 2, Math.max(size * 0.2, radius + 4));
    return margin + ((v - 0.2) / 0.6) * (size - 2 * margin);
  };
  return { x: axis(p.x, width), y: axis(p.y, height) };
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
