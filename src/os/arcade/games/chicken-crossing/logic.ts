export const COLUMNS = 9;
export const HOP_TIME = 0.16;
export const REPEAT_TIME = 0.21;
export const STEP = 1 / 120;
export const TRAFFIC_SPAN = COLUMNS + 8;
export const CHICKEN_HALF = 0.18;
export const CAR_HALF_Y = 0.26;
export const TRAIN_HALF_Y = 0.3;
export const FLOAT_SLACK = 0.05;
export const FOLLOW = 3.5;
export const IDLE_GRACE = 5;
export const IDLE_PUSH = 1.0;
export const WARN_TIME = 1.5;
export const BIOME_ROWS = 50;
export const BIOMES = ['meadow', 'orchard', 'dunes', 'tundra'] as const;
export type Biome = (typeof BIOMES)[number];
export type Direction = 'up' | 'down' | 'left' | 'right';
export type LaneKind = 'grass' | 'road' | 'rail' | 'river';
export type Car = { x: number; width: number; color: number; kind: 'car' | 'truck' | 'racer' };
export type Float = { x: number; width: number; kind: 'log' | 'pad' };
export type Train = { x: number; length: number; speed: number; wait: number; warning: boolean; running: boolean; cycle: number };
export type Lane = {
  row: number; kind: LaneKind; biome: Biome; direction: -1 | 1; speed: number;
  cars: Car[]; floats: Float[]; train: Train | null;
  trees: number[];
  coin: number | null; collected: boolean; seed: number;
};
export type Hop = { fromX: number; fromY: number; toX: number; toY: number; elapsed: number; carry: number };
export type Death = 'car' | 'train' | 'water' | 'drift' | 'hawk';
export type State = {
  seed: number; x: number; y: number; facing: Direction; hop: Hop | null; queued: Direction | null; repeat: number;
  time: number; acc: number; maxRow: number; coins: number; score: number;
  dead: boolean; death: Death | null;
  ride: number | null;
  scroll: number;
  started: boolean;
  idle: number;
  landedAt: number;
  lanes: Lane[]; nextRow: number; group: number;
};
export type Input = { held: Direction | null; press: Direction | null };
export type Events = { hopped: boolean; landed: boolean; scored: number; collected: boolean; crashed: boolean; milestone: boolean; bell: boolean; splash: boolean; biome: boolean; blocked: boolean };

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

export function biomeAt(row: number): Biome {
  return BIOMES[Math.floor(row / BIOME_ROWS) % BIOMES.length];
}

export function laneAt(s: State, row: number): Lane | undefined {
  return s.lanes.find((lane) => lane.row === row);
}

export function floatUnder(lane: Lane, x: number): number {
  return lane.floats.findIndex((float) => Math.abs(x - float.x) <= float.width / 2 + FLOAT_SLACK);
}

export const speedAt = (row: number) => Math.min(4.1, 1.2 + row * 0.035);

function groupRng(seed: number, group: number): () => number {
  return rng32(seed ^ Math.imul(group + 1, 0x9e3779b1));
}

function rowSeed(seed: number, row: number): number {
  return seed ^ Math.imul(row + 1, 2654435761);
}

function treeColumns(rng: () => number, maxTrees: number, biome: Biome, startRow: boolean): number[] {
  const trees: number[] = [];
  const density = biome === 'orchard' ? 0.68 : biome === 'meadow' ? 0.42 : 0.54;
  const left = startRow ? [0, 1] : [1, 2];
  const right = startRow ? [7, 8] : [6, 7];
  if (maxTrees >= 2 && rng() < density) trees.push(...left);
  if (maxTrees >= 4 && rng() < density) trees.push(...right);
  return trees.sort((a, b) => a - b);
}

function makeGrass(s: State, row: number, aboveRiver: boolean, startRow = false): Lane {
  const seed = rowSeed(s.seed, row);
  const rng = rng32(seed);
  const biome = biomeAt(row);
  const density = Math.min(4, 2 + Math.floor(row / 90));
  const trees = treeColumns(rng, startRow || aboveRiver ? 2 : density, biome, startRow);
  const open = Array.from({ length: COLUMNS }, (_, column) => column).filter((column) => !trees.includes(column));
  const coin = !startRow && rng() < 0.35 ? open[Math.floor(rng() * open.length)] : null;
  return { row, kind: 'grass', biome, direction: 1, speed: 0, cars: [], floats: [], train: null, trees, coin, collected: false, seed };
}

function chooseBand(rng: () => number, biome: Biome): 'road' | 'river' | 'rail' {
  const weights: Record<Biome, [number, number, number]> = {
    meadow: [0.55, 0.3, 0.15],
    orchard: [0.45, 0.3, 0.25],
    dunes: [0.5, 0.2, 0.3],
    tundra: [0.35, 0.45, 0.2],
  };
  const [road, river] = weights[biome];
  const n = rng();
  return n < road ? 'road' : n < road + river ? 'river' : 'rail';
}

function allocateGaps(total: number, count: number, minimum: number, maximum: number, rng: () => number): number[] {
  const gaps = Array.from({ length: count }, () => minimum + rng() * (maximum - minimum));
  let remainder = total - gaps.reduce((sum, gap) => sum + gap, 0);
  for (let i = 0; i < count && Math.abs(remainder) > 1e-9; i++) {
    const room = remainder > 0 ? maximum - gaps[i] : gaps[i] - minimum;
    const change = Math.sign(remainder) * Math.min(Math.abs(remainder), room);
    gaps[i] += change;
    remainder -= change;
  }
  return gaps;
}

function makeCars(seed: number, row: number, direction: -1 | 1, speed: number, rng: () => number): Car[] {
  const patterns = ['sedans', 'trucks', 'racers', 'mixed'] as const;
  const pattern = patterns[Math.floor(rng() * patterns.length)];
  const count = pattern === 'sedans' ? 2 + Math.floor(rng() * 3)
    : pattern === 'trucks' ? 1 + Math.floor(rng() * 3)
      : pattern === 'racers' ? 1 + Math.floor(rng() * 2)
        : 2 + Math.floor(rng() * 3);
  const cars = Array.from({ length: count }, (_, i): Car => {
    const kind = pattern === 'sedans' ? 'car'
      : pattern === 'trucks' ? 'truck'
        : pattern === 'racers' ? 'racer'
          : i % 3 === 0 ? 'truck' : i % 3 === 1 ? 'racer' : 'car';
    return { x: 0, width: kind === 'truck' ? 2.05 : kind === 'racer' ? 1 : 1.25, color: Math.floor(rng() * 5), kind };
  });
  const motion = (car: Car) => speed * (car.kind === 'truck' ? 0.65 : car.kind === 'racer' ? Math.min(1.5, 5.5 / speed) : 1);
  const maximumMotion = Math.max(...cars.map(motion));
  const minimumGap = Math.max(speed, maximumMotion) * HOP_TIME + 2 * CHICKEN_HALF + 0.5 + 0.12;
  const free = TRAFFIC_SPAN - cars.reduce((sum, car) => sum + car.width, 0);
  const gaps = allocateGaps(free, count, minimumGap, Math.max(minimumGap, free / count + minimumGap), rng);
  let cursor = -4 + gaps[count - 1] / 2 + cars[0].width / 2;
  for (let i = 0; i < count; i++) {
    cars[i].x = cursor;
    const next = (i + 1) % count;
    cursor += cars[i].width / 2 + gaps[i] + cars[next].width / 2;
  }
  const phase = rng() * TRAFFIC_SPAN;
  for (const car of cars) car.x = wrapX(car.x + phase);
  void seed;
  void row;
  void direction;
  return cars;
}

function makeFloats(kind: 'log' | 'pad', rng: () => number): Float[] {
  const count = kind === 'log' ? 4 : 8;
  const widths = Array.from({ length: count }, () => kind === 'log' ? 2 + Math.floor(rng() * 3) : 1);
  if (kind === 'log') {
    let sum = widths.reduce((a, b) => a + b, 0);
    while (sum < 11) {
      const i = Math.floor(rng() * count);
      if (widths[i] < 4) { widths[i]++; sum++; }
    }
    while (sum > 13) {
      const i = Math.floor(rng() * count);
      if (widths[i] > 2) { widths[i]--; sum--; }
    }
  }
  const minimum = kind === 'log' ? 1 : 0.6;
  const maximum = kind === 'log' ? 2.2 : 1.6;
  const gaps = allocateGaps(TRAFFIC_SPAN - widths.reduce((a, b) => a + b, 0), count, minimum, maximum, rng);
  const floats: Float[] = [];
  let edge = -4;
  for (let i = 0; i < count; i++) {
    floats.push({ x: edge + widths[i] / 2, width: widths[i], kind });
    edge += widths[i] + gaps[i];
  }
  return floats;
}

function makeLane(s: State, row: number, kind: 'road' | 'rail' | 'river', previous: Lane | undefined): Lane {
  const seed = rowSeed(s.seed, row);
  const rng = rng32(seed);
  const biome = biomeAt(row);
  let direction: -1 | 1 = rng() < 0.5 ? -1 : 1;
  if (kind === 'river' && previous?.kind === 'river') direction = previous.direction === 1 ? -1 : 1;
  const speed = kind === 'road' ? speedAt(row) * (0.8 + rng() * 0.2)
    : kind === 'river' ? (rng() < 0.65 ? 0.9 + Math.min(1.3, row * 0.006) * rng() : 0.4 + rng() * 0.5)
      : 0;
  const lane: Lane = {
    row, kind, biome, direction, speed, cars: [], floats: [], train: null, trees: [], coin: null, collected: false, seed,
  };
  if (kind === 'road') {
    lane.cars = makeCars(seed, row, direction, speed, rng);
    lane.coin = rng() < 0.12 ? Math.floor(rng() * COLUMNS) : null;
  } else if (kind === 'river') {
    const logs = rng() < 0.58;
    lane.speed = logs ? 0.9 + Math.min(1.3, row * 0.006) * rng() : 0.4 + rng() * 0.5;
    lane.floats = makeFloats(logs ? 'log' : 'pad', rng);
  } else {
    const length = 6 + Math.floor(rng() * 5);
    const trainSpeed = 18 + rng() * 6;
    const firstWarningDelay = WARN_TIME + 1 + rng() * 3.5;
    lane.train = { x: direction === 1 ? -length / 2 - 2 : COLUMNS + length / 2 + 1, length, speed: trainSpeed, wait: firstWarningDelay, warning: false, running: false, cycle: 0 };
  }
  return lane;
}

export function extendCourse(s: State, through: number): void {
  while (s.nextRow <= through) {
    const rng = groupRng(s.seed, s.group);
    let kind = chooseBand(rng, biomeAt(s.nextRow));
    if (s.nextRow < 8 && kind === 'river') kind = 'road';
    if (s.nextRow < 12 && kind === 'rail') kind = 'road';
    let length = kind === 'road' ? 1 + Math.floor(rng() * Math.min(5, 1 + Math.floor(s.group / 2)))
      : kind === 'river' ? 1 + Math.floor(rng() * Math.min(4, 1 + Math.floor(s.group / 2)))
        : 1 + Math.floor(rng() * Math.min(2, 1 + Math.floor(s.group / 3)));
    if (kind === 'river' && s.nextRow < 8) length = 1;
    if (kind === 'rail' && s.nextRow < 12) length = 1;
    for (let i = 0; i < length; i++) {
      const row = s.nextRow++;
      const previous = laneAt(s, row - 1);
      s.lanes.push(makeLane(s, row, kind, previous));
    }
    const grassCount = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < grassCount; i++) {
      const row = s.nextRow++;
      const aboveRiver = laneAt(s, row - 1)?.kind === 'river';
      s.lanes.push(makeGrass(s, row, aboveRiver));
    }
    s.group++;
  }
}

export function createState(seed = 1): State {
  const s: State = {
    seed, x: 4, y: 0, facing: 'up', hop: null, queued: null, repeat: 0, time: 0, acc: 0,
    maxRow: 0, coins: 0, score: 0, dead: false, death: null, ride: null, scroll: -2,
    started: false, idle: 0, landedAt: -1, lanes: [], nextRow: 3, group: 0,
  };
  s.lanes.push(makeGrass(s, 0, false, true), makeGrass(s, 1, false, true), makeGrass(s, 2, false, true));
  s.lanes.push(makeLane(s, 3, 'road', undefined));
  s.nextRow = 4;
  s.group = 1;
  extendCourse(s, 20);
  return s;
}

function floatVelocity(s: State): number {
  if (s.ride === null) return 0;
  const lane = laneAt(s, Math.round(s.y));
  return lane?.kind === 'river' ? lane.direction * lane.speed : 0;
}

export function startHop(s: State, direction: Direction): boolean {
  if (s.dead || s.hop) return false;
  const fromLane = laneAt(s, Math.round(s.y));
  const riding = s.ride !== null && fromLane?.kind === 'river';
  const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const dy = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
  const x = s.x + dx;
  const y = s.y + dy;
  if (dx && (riding ? x < -0.4 || x > COLUMNS - 0.6 : x < 0 || x >= COLUMNS)) {
    s.facing = direction;
    return false;
  }
  if (y < Math.max(0, s.maxRow - 3)) return false;
  s.facing = direction;
  const targetLane = laneAt(s, y);
  let toX = x;
  if (riding && !dx && targetLane?.kind !== 'river') toX = Math.max(0, Math.min(COLUMNS - 1, Math.round(x)));
  if (targetLane?.kind === 'grass' && targetLane.trees.includes(Math.round(toX))) return false;
  const carry = riding ? floatVelocity(s) : 0;
  s.hop = { fromX: s.x, fromY: s.y, toX, toY: y, elapsed: 0, carry };
  s.ride = null;
  if (!s.started) s.started = true;
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

function wrapX(x: number): number {
  return ((x + 4) % TRAFFIC_SPAN + TRAFFIC_SPAN) % TRAFFIC_SPAN - 4;
}

function carVelocities(lane: Lane, dt: number): Map<Car, number> {
  const count = lane.cars.length;
  if (!count) return new Map();
  const direction = lane.direction;
  const ordered = [...lane.cars].sort((a, b) => direction === 1 ? a.x - b.x : b.x - a.x);
  const motion = (car: Car) => lane.speed * (car.kind === 'truck' ? 0.65 : car.kind === 'racer' ? Math.min(1.5, 5.5 / lane.speed) : 1);
  if (count === 1) return new Map([[ordered[0], direction * motion(ordered[0])]]);
  const speeds = ordered.map(motion);
  const minGap = Math.max(lane.speed, ...speeds) * HOP_TIME + 2 * CHICKEN_HALF + 0.5 + 0.12;
  const gaps = ordered.map((car, i) => {
    const next = ordered[(i + 1) % count];
    const centerGap = direction === 1
      ? (next.x - car.x + TRAFFIC_SPAN) % TRAFFIC_SPAN
      : (car.x - next.x + TRAFFIC_SPAN) % TRAFFIC_SPAN;
    return centerGap - (car.width + next.width) / 2;
  });
  for (let pass = 0; pass < count; pass++) {
    let changed = false;
    for (let i = count - 1; i >= 0; i--) {
      const next = (i + 1) % count;
      const maximum = speeds[next] + (gaps[i] - minGap) / dt;
      if (speeds[i] > maximum) {
        speeds[i] = Math.max(0, maximum);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return new Map(ordered.map((car, i) => [car, direction * speeds[i]]));
}

function trainHit(
  lane: Lane,
  train: Train,
  oldChickenX: number,
  newChickenX: number,
  oldChickenY: number,
  newChickenY: number,
  oldTrainX: number,
  newTrainX: number,
): boolean {
  return train.running && sweptHit(
    oldChickenX - oldTrainX, oldChickenY - lane.row,
    newChickenX - newTrainX, newChickenY - lane.row,
    train.length / 2 + CHICKEN_HALF - 0.05, TRAIN_HALF_Y + CHICKEN_HALF,
  );
}

function updateTrain(s: State, lane: Lane, train: Train, dt: number, ev: Events): number {
  if (!train.running) {
    const before = train.wait;
    train.wait -= dt;
    if (!train.warning && before > WARN_TIME && train.wait <= WARN_TIME) {
      train.warning = true;
      if (Math.abs(lane.row - s.y) <= 7) ev.bell = true;
    }
    if (train.wait <= 0) {
      train.running = true;
      train.warning = false;
      train.x = lane.direction === 1 ? -train.length / 2 - 2 : COLUMNS + train.length / 2 + 1;
    }
  }
  if (train.running) {
    const oldX = train.x;
    train.x += lane.direction * train.speed * dt;
    const gone = lane.direction === 1 ? train.x - train.length / 2 > COLUMNS + 4 : train.x + train.length / 2 < -4;
    if (gone) {
      train.running = false;
      train.warning = false;
      train.cycle++;
      train.wait = 2.5 + rng32(lane.seed ^ train.cycle)() * 3.5 + WARN_TIME;
      return train.x;
    }
    return oldX;
  }
  return train.x;
}

function substep(s: State, dt: number, ev: Events): void {
  const oldX = s.x;
  const oldY = s.y;
  s.time += dt;
  s.repeat = Math.max(0, s.repeat - dt);

  const hop = s.hop;
  if (hop) {
    hop.fromX += hop.carry * dt;
    hop.toX += hop.carry * dt;
    hop.elapsed = Math.min(HOP_TIME, hop.elapsed + dt);
    const t = hop.elapsed / HOP_TIME;
    s.x = hop.fromX + (hop.toX - hop.fromX) * t;
    s.y = hop.fromY + (hop.toY - hop.fromY) * t;
  } else if (s.ride !== null) {
    s.x += floatVelocity(s) * dt;
  }

  for (const lane of s.lanes) {
    if (lane.kind === 'road') {
      const oldCars: { car: Car; x: number }[] = [];
      const velocities = carVelocities(lane, dt);
      for (const car of lane.cars) {
        oldCars.push({ car, x: car.x });
        car.x = wrapX(car.x + velocities.get(car)! * dt);
      }
      for (const { car, x: oldCar } of oldCars) {
        const delta = ((car.x - oldCar + TRAFFIC_SPAN / 2) % TRAFFIC_SPAN + TRAFFIC_SPAN) % TRAFFIC_SPAN - TRAFFIC_SPAN / 2;
        const nextCar = oldCar + delta;
        const hitX = car.width / 2 - 0.08 + CHICKEN_HALF;
        const hitY = CAR_HALF_Y + CHICKEN_HALF;
        if (sweptHit(oldX - oldCar, oldY - lane.row, s.x - nextCar, s.y - lane.row, hitX, hitY)) {
          s.dead = true;
          s.death = 'car';
          ev.crashed = true;
        }
      }
    } else if (lane.kind === 'river') {
      for (const float of lane.floats) float.x = wrapX(float.x + lane.direction * lane.speed * dt);
    } else if (lane.kind === 'rail' && lane.train) {
      const train = lane.train;
      const oldTrainX = train.x;
      updateTrain(s, lane, train, dt, ev);
      if (trainHit(lane, train, oldX, s.x, oldY, s.y, oldTrainX, train.x)) {
        s.dead = true;
        s.death = 'train';
        ev.crashed = true;
      }
    }
  }
  if (s.dead) return;

  if (s.ride !== null && (s.x < -0.5 || s.x > COLUMNS - 0.5)) {
    s.dead = true;
    s.death = 'drift';
    ev.crashed = true;
    return;
  }

  if (hop && hop.elapsed >= HOP_TIME) {
    s.x = hop.toX;
    s.y = hop.toY;
    s.hop = null;
    ev.landed = true;
    s.landedAt = s.time;
    const targetLane = laneAt(s, Math.round(s.y));
    if (targetLane?.kind === 'river') {
      const index = floatUnder(targetLane, s.x);
      if (index < 0) {
        s.dead = true;
        s.death = 'water';
        ev.splash = true;
        ev.crashed = true;
        return;
      }
      const float = targetLane.floats[index];
      const slot = Math.max(0, Math.min(float.width - 1, Math.round(s.x - (float.x - (float.width - 1) / 2))));
      s.x = float.x - (float.width - 1) / 2 + slot;
      s.ride = index;
    } else {
      s.ride = null;
      s.x = Math.max(0, Math.min(COLUMNS - 1, Math.round(s.x)));
    }
    const before = s.maxRow;
    const previousBiome = Math.floor(before / BIOME_ROWS);
    const prevScore = s.score;
    s.maxRow = Math.max(s.maxRow, s.y);
    if (s.maxRow > before) s.idle = 0;
    s.score = s.maxRow + s.coins * 3;
    ev.scored += s.score - prevScore;
    ev.milestone ||= Math.floor(before / 12) < Math.floor(s.maxRow / 12);
    ev.biome ||= Math.floor(s.maxRow / BIOME_ROWS) > previousBiome;
    const lane = laneAt(s, Math.round(s.y));
    if (lane && lane.coin === s.x && !lane.collected) {
      lane.collected = true;
      s.coins++;
      s.score += 3;
      ev.scored += 3;
      ev.collected = true;
    }
    extendCourse(s, s.maxRow + 20);
    s.lanes = s.lanes.filter((item) => item.row >= s.maxRow - 5);
  }

  if (s.started) {
    s.idle += dt;
    const creep = 0.3 + Math.min(0.4, s.maxRow / 500) + (s.idle > IDLE_GRACE ? IDLE_PUSH : 0);
    s.scroll += creep * dt;
    s.scroll = Math.max(s.scroll, s.y - FOLLOW);
    if (s.y < s.scroll) {
      s.dead = true;
      s.death = 'hawk';
      ev.crashed = true;
    }
  }
}

export function step(s: State, dt: number, input: Input = { held: null, press: null }): Events {
  const ev: Events = { hopped: false, landed: false, scored: 0, collected: false, crashed: false, milestone: false, bell: false, splash: false, biome: false, blocked: false };
  if (s.dead || dt <= 0) return ev;
  if (input.press) s.queued = input.press;
  s.acc += Math.min(dt, 0.1);
  while (s.acc >= STEP && !s.dead) {
    s.acc -= STEP;
    if (!s.hop) {
      const direction = s.queued ?? (s.repeat <= 0 ? input.held : null);
      s.queued = null;
      if (direction) {
        const fromX = s.x;
        const fromY = s.y;
        const fromLane = laneAt(s, Math.round(s.y));
        const riding = s.ride !== null && fromLane?.kind === 'river';
        const targetX = fromX + (direction === 'left' ? -1 : direction === 'right' ? 1 : 0);
        const targetY = fromY + (direction === 'up' ? 1 : direction === 'down' ? -1 : 0);
        const targetLane = laneAt(s, targetY);
        const edgeBlocked = (direction === 'left' || direction === 'right') &&
          (riding ? targetX < -0.4 || targetX > COLUMNS - 0.6 : targetX < 0 || targetX >= COLUMNS);
        const treeBlocked = targetLane?.kind === 'grass' && targetLane.trees.includes(Math.round(riding && direction !== 'left' && direction !== 'right' ? fromX : targetX));
        if (startHop(s, direction)) {
          ev.hopped = true;
          s.repeat = REPEAT_TIME;
        } else if (edgeBlocked || treeBlocked) {
          s.facing = direction;
          ev.blocked = true;
        }
      }
    }
    substep(s, STEP, ev);
  }
  return ev;
}
