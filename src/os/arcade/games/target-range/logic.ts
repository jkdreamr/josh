export type Pace = 'relaxed' | 'standard';
export type Point = { x: number; y: number };
export type Target = Point & { id: number; radius: number };
export const WAVES = [
  { name: 'Warm Up', hint: 'Find the center', goal: 4, seconds: 16, speed: 0 },
  { name: 'On Rails', hint: 'Follow the glide', goal: 5, seconds: 18, speed: 0.85 },
  { name: 'Bounce', hint: 'Catch the rhythm', goal: 6, seconds: 20, speed: 1.1 },
  { name: 'Carousel', hint: 'Keep them in sight', goal: 7, seconds: 22, speed: 1.25 },
  { name: 'Figure Eight', hint: 'Finish strong', goal: 8, seconds: 24, speed: 1.4 },
] as const;
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
  won: boolean;
};

const secondsFor = (wave: number, pace: Pace) => WAVES[wave].seconds * (pace === 'relaxed' ? 1.4 : 1);
export const multiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 3));
export const accuracy = (g: RangeState) => (g.hits + g.misses ? Math.round((g.hits / (g.hits + g.misses)) * 100) : 0);

export function createRange(pace: Pace = 'standard'): RangeState {
  return {
    pace, wave: 0, phase: 'intro', phaseLeft: INTRO_SECONDS,
    timeLeft: secondsFor(0, pace), motionTime: 0, waveHits: 0,
    hits: 0, misses: 0, bullseyes: 0, combo: 0, bestCombo: 0,
    score: 0, bonus: 0, cooldowns: [0, 0, 0], won: false,
  };
}

export function stepRange(g: RangeState, dt: number): 'wave' | 'over' | undefined {
  if (!Number.isFinite(dt) || dt <= 0 || g.phase === 'over') return;
  if (g.phase === 'intro' || g.phase === 'clear') {
    g.phaseLeft = Math.max(0, g.phaseLeft - dt);
    if (g.phaseLeft > 0) return;
    if (g.phase === 'intro') g.phase = 'live';
    else if (g.wave === WAVES.length - 1) {
      g.phase = 'over';
      g.won = true;
      return 'over';
    } else {
      g.wave++;
      g.phase = 'intro';
      g.phaseLeft = INTRO_SECONDS;
      g.timeLeft = secondsFor(g.wave, g.pace);
      g.motionTime = 0;
      g.waveHits = 0;
      g.cooldowns = [0, 0, 0];
      return 'wave';
    }
    return;
  }
  g.timeLeft = Math.max(0, g.timeLeft - dt);
  g.motionTime += dt * (g.pace === 'relaxed' ? 0.65 : 1);
  g.cooldowns = g.cooldowns.map((n) => Math.max(0, n - dt));
  if (g.timeLeft === 0) {
    g.phase = 'over';
    return 'over';
  }
}

export function targetPosition(wave: number, slot: number, time: number): Point {
  const t = time * WAVES[wave].speed;
  const phase = (slot * Math.PI * 2) / 3;
  if (wave === 0) return { x: 0.2 + slot * 0.3, y: slot === 1 ? 0.35 : 0.62 };
  if (wave === 1) return { x: 0.5 + 0.29 * Math.sin(t + phase), y: 0.22 + slot * 0.28 };
  if (wave === 2) return { x: 0.2 + slot * 0.3, y: 0.5 + 0.29 * Math.sin(t + phase) };
  if (wave === 3) return { x: 0.5 + 0.3 * Math.cos(t + phase), y: 0.5 + 0.29 * Math.sin(t + phase) };
  return { x: 0.5 + 0.29 * Math.sin(t + phase), y: 0.5 + 0.29 * Math.sin(2 * (t + phase)) };
}

export function targetsFor(g: RangeState, width: number, height: number): Target[] {
  if (width <= 0 || height <= 0 || g.phase === 'clear' || g.phase === 'over') return [];
  const radius = Math.min(42, Math.max(24, Math.min(width / 9, height / 5.8)), width / 7, height / 4.5);
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
  const cleared = g.waveHits >= WAVES[g.wave].goal;
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
