export type BoatKind = 'human' | 'bot' | 'replay';
export type BotProfile = 'jv' | 'cal' | 'world';

export type TracePoint = { t: number; d: number };

export type BoatSpec = {
  kind: BoatKind;
  name?: string;
  color?: string;
  effort?: number;
  profile?: BotProfile;
  targetSplit?: number;
  trace?: TracePoint[];
};

export type BoatMetrics = {
  name: string;
  kind: BoatKind;
  distance: number;
  elapsed: number;
  rate: number | null;
  split: number | null;
  avgSplit: number | null;
  dps: number | null;
  strokes: number;
  phase: 'drive' | 'recovery';
  fraction: number;
  speed: number;
  swing: number;
  legs: number;
  wbal: number;
  power10: number;
  power10Max: number;
  power10Left: number;
  lenRush: number;
  finishTime: number | null;
};

type Boat = BoatSpec & {
  name: string;
  distance: number;
  speed: number;
  effort: number;
  driveDuration: number;
  driveElapsed: number;
  driveForce: number;
  driveEnd: number | null;
  metabolicRate: number;
  lastCatch: number | null;
  lastCatchDistance: number;
  rate: number | null;
  split: number | null;
  dps: number | null;
  strokes: number;
  intervals: number[];
  swing: number;
  wbal: number;
  averagePower: number;
  lenRush: number;
  power10Calls: number;
  power10Left: number;
  nextBotCatch: number;
  finishTime: number | null;
};

export type Race = {
  distance: 500 | 1000 | 2000;
  boats: Boat[];
  started: boolean;
  elapsed: number;
  accumulator: number;
  finished: boolean;
};

export const W_REF = 3600;
const A_INT = 1650;
const BONK_CAP = 0.8;
const MASS = 870;
const DRAG = 12;
const CP = 2150;
const W_PRIME_MAX = 100_000;
const STEP = 1 / 240;
const BOT_TARGETS: Record<BotProfile, { split: number; rate: number; name: string }> = {
  jv: { split: 93, rate: 34, name: 'jv' },
  cal: { split: 86, rate: 37, name: 'cal' },
  world: { split: 79.67, rate: 39, name: 'world best' },
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function makeBoat(spec: BoatSpec): Boat {
  const profile = spec.profile ? BOT_TARGETS[spec.profile] : undefined;
  return {
    ...spec,
    name: spec.name ?? profile?.name ?? (spec.kind === 'human' ? 'you' : spec.kind),
    distance: 0,
    speed: 0,
    effort: spec.effort ?? 1,
    driveDuration: 0,
    driveElapsed: 0,
    driveForce: 0,
    driveEnd: null,
    metabolicRate: 30,
    lastCatch: null,
    lastCatchDistance: 0,
    rate: null,
    split: null,
    dps: null,
    strokes: 0,
    intervals: [],
    swing: 0.5,
    wbal: W_PRIME_MAX,
    averagePower: 0,
    lenRush: 1,
    power10Calls: 0,
    power10Left: 0,
    nextBotCatch: 0,
    finishTime: null,
  };
}

function botRate(boat: Boat, distance: number, raceDistance: number): number {
  const profile = boat.profile ? BOT_TARGETS[boat.profile] : undefined;
  const base = profile?.rate ?? 34;
  if (boat.distance >= raceDistance - 250) return base + 4;
  return boat.strokes < 10 ? 44 : base;
}

function registerCatch(boat: Boat, race: Race, bot = false): void {
  if (boat.finishTime !== null || (boat.driveDuration > 0 && boat.driveElapsed < boat.driveDuration)) return;
  const now = race.elapsed;
  const interval = boat.lastCatch === null ? 60 / 30 : now - boat.lastCatch;
  if (boat.lastCatch !== null && interval > 0) {
    boat.rate = 60 / interval;
    boat.dps = Math.max(0, boat.distance - boat.lastCatchDistance);
    boat.split = boat.dps > 0 ? (500 * interval) / boat.dps : null;
    boat.intervals.push(interval);
    if (boat.intervals.length > 4) boat.intervals.shift();
    if (boat.intervals.length >= 3) {
      const mean = boat.intervals.reduce((sum, value) => sum + value, 0) / boat.intervals.length;
      const variance = boat.intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / boat.intervals.length;
      const consistency = clamp((1 - Math.sqrt(variance) / mean - 0.85) / 0.13, 0, 1);
      boat.swing += 0.35 * (consistency - boat.swing);
    }
  }

  const shownRate = boat.rate ?? 30;
  const rateOverage = Math.max(0, shownRate - 36);
  const lenRate = Math.max(0.55, 1 - 0.004 * rateOverage - 0.0008 * rateOverage ** 2);
  let work = W_REF * boat.effort * lenRate * (0.94 + 0.08 * boat.swing);
  if (boat.power10Left > 0) work *= 1.1;
  if (boat.driveEnd !== null) {
    const recovery = now - boat.driveEnd;
    boat.lenRush = recovery < 0.5 ? clamp((recovery - 0.15) / 0.35, 0.25, 1) : 1;
    work *= boat.lenRush;
  } else {
    boat.lenRush = 1;
  }
  if (boat.wbal / W_PRIME_MAX < 0.25) work *= 0.9 + 0.4 * (boat.wbal / W_PRIME_MAX);
  const delivered = boat.wbal <= 0 ? Math.min(work, BONK_CAP * CP * interval) : work;
  boat.averagePower = delivered / Math.max(interval, 1 / 240);
  boat.metabolicRate = 60 / Math.max(interval, 1 / 240);
  boat.driveDuration = clamp(0.78 - 0.005 * (shownRate - 30), 0.62, 0.85);
  boat.driveElapsed = 0;
  boat.driveForce = (delivered * Math.PI) / (2 * boat.driveDuration * Math.max(boat.speed, 2));
  boat.lastCatch = now;
  boat.lastCatchDistance = boat.distance;
  boat.strokes += 1;
  if (boat.power10Left > 0) boat.power10Left -= 1;
  if (bot) {
    boat.nextBotCatch = now + 60 / botRate(boat, boat.distance, race.distance);
  }
}

function fixedStep(race: Race): void {
  if (!race.started || race.finished) return;
  const t0 = race.elapsed;
  const d0 = race.boats.map((boat) => boat.distance);

  race.boats.forEach((boat, index) => {
    if (boat.kind === 'replay') {
      const trace = boat.trace ?? [];
      const next = trace.find((point) => point.t >= t0 + STEP);
      const prev = [...trace].reverse().find((point) => point.t <= t0) ?? trace[0];
      if (prev && next && next.t > prev.t) {
        const ratio = clamp((t0 + STEP - prev.t) / (next.t - prev.t), 0, 1);
        boat.distance = prev.d + (next.d - prev.d) * ratio;
        boat.speed = (next.d - prev.d) / (next.t - prev.t);
      } else if (prev) {
        boat.distance = prev.d;
        boat.speed = 0;
      }
      if (boat.finishTime === null && boat.distance >= race.distance) {
        const prevTrace = [...trace].reverse().find((point) => point.d < race.distance);
        const nextTrace = trace.find((point) => point.d >= race.distance);
        boat.finishTime = prevTrace && nextTrace && nextTrace.d > prevTrace.d
          ? prevTrace.t + ((race.distance - prevTrace.d) / (nextTrace.d - prevTrace.d)) * (nextTrace.t - prevTrace.t)
          : t0 + STEP;
      }
      return;
    }
    if (boat.kind === 'bot' && t0 + 1e-9 >= boat.nextBotCatch) registerCatch(boat, race, true);
    const driving = boat.driveElapsed < boat.driveDuration;
    const force = driving ? boat.driveForce * Math.sin(Math.PI * boat.driveElapsed / boat.driveDuration) : 0;
    const acceleration = (force - DRAG * boat.speed * boat.speed) / MASS;
    boat.speed = Math.max(0, boat.speed + acceleration * STEP);
    boat.distance += boat.speed * STEP;
    if (driving) {
      boat.driveElapsed += STEP;
      if (boat.driveElapsed >= boat.driveDuration) boat.driveEnd = t0 + STEP;
    }
    if (boat.kind !== 'bot') {
      const cost = boat.averagePower + A_INT * (boat.metabolicRate / 60) ** 3 - A_INT * (34 / 60) ** 3;
      if (cost > CP) boat.wbal -= (cost - CP) * STEP;
      else boat.wbal += (CP - cost) * STEP * (1 - boat.wbal / W_PRIME_MAX);
      boat.wbal = clamp(boat.wbal, 0, W_PRIME_MAX);
    }
  });

  race.elapsed += STEP;
  race.boats.forEach((boat, index) => {
    if (boat.finishTime === null && boat.distance >= race.distance) {
      const delta = boat.distance - d0[index];
      boat.finishTime = delta > 0 ? t0 + ((race.distance - d0[index]) / delta) * STEP : race.elapsed;
      boat.distance = race.distance;
    }
  });
  race.finished = race.boats.filter((boat) => boat.kind !== 'replay').every((boat) => boat.finishTime !== null);
}

function simulateBot(distance: Race['distance'], profile: BotProfile, effort: number): number {
  const race: Race = {
    distance,
    boats: [makeBoat({ kind: 'bot', profile, effort })],
    started: true,
    elapsed: 0,
    accumulator: 0,
    finished: false,
  };
  while (!race.finished && race.elapsed < 1200) fixedStep(race);
  return race.boats[0].finishTime ?? Infinity;
}

function calibrateBot(distance: Race['distance'], profile: BotProfile): number {
  const targetTime = BOT_TARGETS[profile].split * distance / 500;
  let low = 0.05;
  let high = 3;
  for (let i = 0; i < 30; i += 1) {
    const effort = (low + high) / 2;
    if (simulateBot(distance, profile, effort) > targetTime) low = effort;
    else high = effort;
  }
  return (low + high) / 2;
}

export function createRace({ distance, boats }: { distance: Race['distance']; boats: BoatSpec[] }): Race {
  const race: Race = {
    distance,
    boats: boats.map((spec) => {
      const boat = makeBoat(spec);
      if (boat.kind === 'bot' && boat.profile && boat.targetSplit === undefined && boat.effort === 1) {
        boat.effort = calibrateBot(distance, boat.profile);
      }
      return boat;
    }),
    started: false,
    elapsed: 0,
    accumulator: 0,
    finished: false,
  };
  return race;
}

export function startSignal(race: Race): void {
  race.started = true;
  race.elapsed = 0;
  race.accumulator = 0;
  race.finished = false;
  for (const boat of race.boats) {
    boat.nextBotCatch = 0;
  }
}

export function catchStroke(race: Race, boatIdx: number): 'false-start' | 'caught' | 'ignored' | 'finished' {
  if (!race.started) return 'false-start';
  const boat = race.boats[boatIdx];
  if (!boat || boat.finishTime !== null) return 'finished';
  if (boat.driveElapsed < boat.driveDuration) return 'ignored';
  const previousStrokes = boat.strokes;
  registerCatch(boat, race);
  return boat.strokes > previousStrokes ? 'caught' : 'ignored';
}

export function callPower10(race: Race, boatIdx: number): boolean {
  if (!race.started) return false;
  const boat = race.boats[boatIdx];
  const limit = race.distance === 2000 ? 3 : 2;
  if (!boat || boat.kind !== 'human' || boat.finishTime !== null || boat.power10Calls >= limit || boat.power10Left > 0) return false;
  boat.power10Calls += 1;
  boat.power10Left = 10;
  return true;
}

export function step(race: Race, dtSeconds: number): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !race.started || race.finished) return;
  race.accumulator += dtSeconds;
  while (race.accumulator + 1e-12 >= STEP && !race.finished) {
    fixedStep(race);
    race.accumulator -= STEP;
  }
}

export function boatMetrics(race: Race, index: number): BoatMetrics {
  const boat = race.boats[index];
  const power10Max = race.distance === 2000 ? 3 : 2;
  const elapsed = boat.finishTime ?? race.elapsed;
  const elapsedSinceCatch = boat.lastCatch === null ? Infinity : race.elapsed - boat.lastCatch;
  const phase = boat.driveElapsed < boat.driveDuration ? 'drive' : 'recovery';
  return {
    name: boat.name,
    kind: boat.kind,
    distance: boat.distance,
    elapsed,
    rate: elapsedSinceCatch > 6 ? null : boat.rate,
    split: boat.split,
    avgSplit: boat.distance > 0 ? (elapsed / boat.distance) * 500 : null,
    dps: boat.dps,
    strokes: boat.strokes,
    phase,
    fraction: phase === 'drive'
      ? clamp(boat.driveElapsed / Math.max(boat.driveDuration, 1e-9), 0, 1)
      : clamp((race.elapsed - (boat.driveEnd ?? 0)) / Math.max((boat.rate ? 60 / boat.rate : 2) - boat.driveDuration, 1e-9), 0, 1),
    speed: boat.speed,
    swing: boat.swing,
    legs: boat.wbal / W_PRIME_MAX,
    wbal: boat.wbal,
    power10: power10Max - boat.power10Calls,
    power10Max,
    power10Left: boat.power10Left,
    lenRush: boat.lenRush,
    finishTime: boat.finishTime,
  };
}
