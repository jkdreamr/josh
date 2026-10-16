export const STEP = 1 / 60;
export const TARGET = 3;
export const CAR_RADIUS = 0.9;
export const MASS = 1;
export const ACCEL = 22;
export const MAX_SPEED = 8.5;
export const R0 = (cars: number) => Math.min(14, 9 + 0.6 * cars);
export const LEVELS = [0, 1, 2] as const;
export type Level = (typeof LEVELS)[number];
export type Phase = 'count' | 'fight' | 'over' | 'done';
export type Input = { x: number; y: number; dash: boolean };
export type CarConfig = { seat: number; color: number; ai: Level | null; name: string };
export type Car = CarConfig & {
  id: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  yaw: number;
  charge: number;
  cool: number;
  dashT: number;
  falling: boolean;
  out: boolean;
  dashHeld: boolean;
  aiTarget: number;
  aiTimer: number;
  aiAimX: number;
  aiAimZ: number;
  aiDashHold: number;
  aiDashReady: boolean;
  left: boolean;
};
export type Event =
  | { type: 'bump' }
  | { type: 'dash'; car: number; power: number }
  | { type: 'hit'; a: number; b: number; power: number }
  | { type: 'splash'; car: number; x: number; z: number }
  | { type: 'round'; winner: number | null };
export type World = {
  cars: Car[];
  radius: number;
  startRadius: number;
  phase: Phase;
  timer: number;
  fightTime: number;
  round: number;
  acc: number;
  wins: number[];
  roundWinner: number | null;
  seed: number;
  random: () => number;
};

export const noInput = (): Input => ({ x: 0, y: 0, dash: false });

export function rng32(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function beginRound(world: World) {
  world.startRadius = R0(world.cars.length);
  world.radius = world.startRadius;
  world.phase = 'count';
  world.timer = 3;
  world.fightTime = 0;
  world.acc = 0;
  world.roundWinner = null;
  const count = world.cars.length;
  const spawn = world.startRadius * 0.6;
  for (const car of world.cars) {
    const slot = (car.id + world.round - 1) % count;
    const angle = (slot * Math.PI * 2) / count;
    car.x = Math.cos(angle) * spawn;
    car.z = Math.sin(angle) * spawn;
    car.y = 0;
    car.vx = 0;
    car.vz = 0;
    car.yaw = Math.atan2(-car.x, -car.z);
    car.charge = 0;
    car.cool = 0;
    car.dashT = 0;
    car.falling = false;
    car.out = false;
    car.dashHeld = false;
    car.aiTarget = -1;
    car.aiTimer = 0;
    car.aiAimX = 0;
    car.aiAimZ = 0;
    car.aiDashHold = 0;
    car.aiDashReady = false;
  }
}

export function createWorld(entries: readonly CarConfig[], seed = 1): World {
  const random = rng32(seed);
  const cars = entries.slice(0, 8).map((entry, id): Car => ({
    ...entry,
    id,
    x: 0,
    z: 0,
    y: 0,
    vx: 0,
    vz: 0,
    yaw: 0,
    charge: 0,
    cool: 0,
    dashT: 0,
    falling: false,
    out: false,
    dashHeld: false,
    aiTarget: -1,
    aiTimer: 0,
    aiAimX: 0,
    aiAimZ: 0,
    aiDashHold: 0,
    aiDashReady: false,
    left: false,
  }));
  const world: World = {
    cars,
    radius: 0,
    startRadius: 0,
    phase: 'count',
    timer: 3,
    fightTime: 0,
    round: 1,
    acc: 0,
    wins: cars.map(() => 0),
    roundWinner: null,
    seed,
    random,
  };
  if (cars.length) beginRound(world);
  return world;
}

export function nextRound(world: World) {
  if (matchWinner(world) !== null) {
    world.phase = 'done';
    return;
  }
  world.round++;
  beginRound(world);
}

export function matchWinner(world: World): number | null {
  const index = world.wins.findIndex((wins) => wins >= TARGET);
  return index < 0 ? null : world.cars[index]?.id ?? null;
}

export function takeoverDeparted(world: World, present: readonly number[], level: Level): number[] {
  const changed: number[] = [];
  for (const car of world.cars) {
    if (car.seat >= 0 && car.ai === null && !present.includes(car.seat)) {
      car.ai = level;
      car.left = true;
      changed.push(car.seat);
    }
  }
  return changed;
}

function radiusAt(world: World) {
  const elapsed = world.fightTime - 6;
  if (elapsed <= 0) return world.startRadius;
  const slowDuration = (world.startRadius - 4.5) / 0.18;
  if (elapsed <= slowDuration) return Math.max(4.5, world.startRadius - elapsed * 0.18);
  const sudden = elapsed - slowDuration - 15;
  return Math.max(2.6, 4.5 - Math.max(0, sudden) * 0.45);
}

function boundedInput(input: Input | undefined): Input {
  if (!input) return noInput();
  let { x, y } = input;
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  return { x, y, dash: input.dash === true };
}

function launch(car: Car, input: Input, events: Event[]) {
  const magnitude = Math.hypot(input.x, input.y);
  const angle = magnitude > 0.08 ? Math.atan2(input.x, input.y) : car.yaw;
  const speed = 9 + 11 * car.charge;
  car.vx = Math.sin(angle) * speed;
  car.vz = Math.cos(angle) * speed;
  car.yaw = angle;
  car.dashT = 0.35;
  car.cool = 1.3;
  car.charge = 0;
  events.push({ type: 'dash', car: car.id, power: speed });
}

function moveCar(car: Car, input: Input, dt: number, events: Event[]) {
  const cooldown = car.cool;
  car.cool = Math.max(0, car.cool - dt);
  car.dashT = Math.max(0, car.dashT - dt);
  if (input.dash && cooldown <= 0) car.charge = Math.min(1, car.charge + dt / 0.7);
  else if (!input.dash && car.dashHeld && car.charge > 0 && cooldown <= 0) launch(car, input, events);
  car.dashHeld = input.dash;

  const inputLength = Math.hypot(input.x, input.y);
  const acceleration = ACCEL * (input.dash && car.charge > 0 ? 0.4 : 1);
  if (inputLength > 0.001) {
    car.vx += (input.x / inputLength) * acceleration * dt;
    car.vz += (input.y / inputLength) * acceleration * dt;
  }
  const drag = car.dashT > 0 ? Math.exp(-0.6 * dt) : Math.exp(-2 * dt) * (inputLength > 0.001 ? 1 : Math.exp(-1.5 * dt));
  car.vx *= drag;
  car.vz *= drag;
  const speed = Math.hypot(car.vx, car.vz);
  if (car.dashT <= 0 && speed > MAX_SPEED) {
    const soft = MAX_SPEED + (speed - MAX_SPEED) * Math.exp(-5 * dt);
    car.vx *= soft / speed;
    car.vz *= soft / speed;
  }
  const movedSpeed = Math.hypot(car.vx, car.vz);
  if (movedSpeed > 0.08) {
    const target = Math.atan2(car.vx, car.vz);
    const delta = Math.atan2(Math.sin(target - car.yaw), Math.cos(target - car.yaw));
    car.yaw += delta * (1 - Math.exp(-8 * dt));
  }
  car.x += car.vx * dt;
  car.z += car.vz * dt;
}

function collide(a: Car, b: Car, events: Event[]) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let distance = Math.hypot(dx, dz);
  const overlap = CAR_RADIUS * 2 - distance;
  if (overlap <= 0) return;
  if (distance < 1e-6) {
    distance = 1;
  }
  const nx = distance === 1 && Math.hypot(dx, dz) < 1e-6 ? (a.id < b.id ? 1 : -1) : dx / distance;
  const nz = distance === 1 && Math.hypot(dx, dz) < 1e-6 ? 0 : dz / distance;
  const massA = MASS * (a.dashT > 0 ? 2 : 1);
  const massB = MASS * (b.dashT > 0 ? 2 : 1);
  const invA = 1 / massA;
  const invB = 1 / massB;
  const separate = overlap / (invA + invB);
  a.x -= nx * separate * invA;
  a.z -= nz * separate * invA;
  b.x += nx * separate * invB;
  b.z += nz * separate * invB;
  const relative = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (relative >= 0) return;
  const impulse = (-(1 + 1.2) * relative) / (invA + invB);
  a.vx -= impulse * invA * nx;
  a.vz -= impulse * invA * nz;
  b.vx += impulse * invB * nx;
  b.vz += impulse * invB * nz;
  events.push({ type: 'hit', a: a.id, b: b.id, power: impulse });
}

function startFall(car: Car, world: World) {
  if (!car.falling && !car.out && Math.hypot(car.x, car.z) > world.radius + 0.15) {
    car.falling = true;
    car.y = 0;
  }
}

function finishRound(world: World, winner: number | null, events: Event[]) {
  world.roundWinner = winner;
  world.phase = 'over';
  world.timer = 2.4;
  if (winner !== null) world.wins[winner]++;
  events.push({ type: 'round', winner });
}

function simulate(world: World, inputs: Input[], events: Event[]) {
  if (world.phase === 'count') {
    world.timer -= STEP;
    if (world.timer <= 0) {
      world.phase = 'fight';
      world.timer = 0;
      events.push({ type: 'bump' });
    }
    return;
  }
  if (world.phase === 'over') {
    world.timer -= STEP;
    if (world.timer <= 0) {
      if (matchWinner(world) !== null) world.phase = 'done';
      else nextRound(world);
    }
    return;
  }
  if (world.phase !== 'fight') return;

  world.fightTime += STEP;
  world.radius = radiusAt(world);
  for (const car of world.cars) {
    if (car.out) continue;
    if (car.falling) {
      car.y -= 18 * STEP;
      car.x += car.vx * STEP;
      car.z += car.vz * STEP;
      if (car.y < -2.5) {
        car.out = true;
        events.push({ type: 'splash', car: car.id, x: car.x, z: car.z });
      }
      continue;
    }
    moveCar(car, boundedInput(inputs[car.id]), STEP, events);
    startFall(car, world);
  }

  for (let i = 0; i < world.cars.length; i++) {
    const a = world.cars[i];
    if (a.out || a.falling) continue;
    for (let j = i + 1; j < world.cars.length; j++) {
      const b = world.cars[j];
      if (!b.out && !b.falling) collide(a, b, events);
    }
  }
  for (const car of world.cars) if (!car.out) startFall(car, world);

  if (world.fightTime >= 100) {
    const remaining = world.cars.filter((car) => !car.out).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    finishRound(world, remaining[0]?.id ?? null, events);
    return;
  }
  if (world.cars.length > 1) {
    const standing = world.cars.filter((car) => !car.out && !car.falling);
    const falling = world.cars.some((car) => car.falling);
    if (standing.length <= 1 && !falling) finishRound(world, standing[0]?.id ?? null, events);
  }
}

export function step(world: World, inputs: Input[], dt: number): Event[] {
  if (!Number.isFinite(dt) || dt <= 0 || world.phase === 'done') return [];
  world.acc += dt;
  const events: Event[] = [];
  while (world.acc + 1e-9 >= STEP && (world.phase as Phase) !== 'done') {
    world.acc -= STEP;
    simulate(world, inputs, events);
  }
  return events;
}
