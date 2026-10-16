export const TICK = 1 / 30;
export const SPEED = 150;
export const BOOST_SPEED = 300;
export const BOOST_MIN = 12;
export const BOOST_DRAIN = 3.5;
export const SPACING = 7;
export const GRID_SIZE = 80;
export const FIELD_NAMES = ['Ziti', 'Rigatoni', 'Fusilli', 'Orzo', 'Penne', 'Farfalle', 'Udon', 'Soba', 'Ramen', 'Linguine', 'Gnocchi', 'Rotini', 'Capellini', 'Tagliatelle', 'Macaroni'];

export type Level = 'easy' | 'normal' | 'hard';
export type Point = { x: number; y: number };
export type Input = { target: number; boost: boolean };
export type Skin = { name: string; color: string; light: string };
export const SKINS: readonly Skin[] = [
  { name: 'Citrus', color: '#f6bd4b', light: '#fff0b2' },
  { name: 'Mint', color: '#36d399', light: '#bcffe5' },
  { name: 'Berry', color: '#ff6b8c', light: '#ffc0cf' },
  { name: 'Sky', color: '#61c8ff', light: '#c4edff' },
  { name: 'Violet', color: '#ad88ff', light: '#dfd0ff' },
  { name: 'Tangerine', color: '#ff8a52', light: '#ffd1b8' },
  { name: 'Lime', color: '#c9ed5a', light: '#efffb6' },
  { name: 'Ice', color: '#82eee3', light: '#d1fffa' },
];

export type Snake = {
  id: number;
  name: string;
  seat: number;
  color: number;
  skin: number;
  bot: boolean;
  eligible: boolean;
  alive: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  angle: number;
  prevAngle: number;
  vx: number;
  vy: number;
  mass: number;
  peak: number;
  kills: number;
  body: Point[];
  pathDistance: number;
  boosting: boolean;
  boostDrop: number;
  respawnAt: number | null;
  respawnDelay: number;
  reaction: number;
};

export type Pellet = {
  id: number;
  x: number;
  y: number;
  value: number;
  color: number;
  born: number;
  natural: boolean;
};

export type World = {
  seed: number;
  radius: number;
  snakes: Snake[];
  pellets: Pellet[];
  tick: number;
  clock: number;
  nextPelletId: number;
  random: () => number;
  pelletTarget: number;
  pelletFill: number;
};

export type WorldEvent =
  | { type: 'death'; id: number; killer: number | null; mass: number; x: number; y: number }
  | { type: 'eat'; id: number; pellet: number; value: number }
  | { type: 'pellet'; pellet: Pellet }
  | { type: 'remove'; pellet: number }
  | { type: 'spawn'; id: number; x: number; y: number; angle: number };

export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const radiusOf = (mass: number) => Math.max(6, Math.min(26, 6 + Math.sqrt(mass) * 0.55));
export const bodyCount = (mass: number) => Math.max(12, Math.min(1800, Math.floor(8 + Math.pow(mass, 0.62) * 1.3)));
export const maxTurnRate = (snake: Snake) => 4.2 * Math.pow(9 / radiusOf(snake.mass), 0.28);
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const cellKey = (x: number, y: number) => `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;

export function createWorld(opts: { seed?: number; radius?: number; snakeCount?: number; fillPellets?: boolean } = {}): World {
  const seed = opts.seed ?? 1;
  const radius = opts.radius ?? 1700;
  const world: World = {
    seed, radius, snakes: [], pellets: [], tick: 0, clock: 0, nextPelletId: 1,
    random: mulberry32(seed), pelletTarget: Math.max(80, Math.min(2400, Math.floor(Math.PI * radius * radius / 9000))),
    pelletFill: 0,
  };
  for (let i = 0; i < (opts.snakeCount ?? 0); i++) {
    addSnake(world, { id: i, name: i === 0 ? 'you' : FIELD_NAMES[(i - 1) % FIELD_NAMES.length], seat: -1, bot: i !== 0, skin: i % SKINS.length, respawnDelay: 2.4 });
  }
  if (opts.fillPellets !== false) fillPellets(world, world.pelletTarget);
  return world;
}

export function addSnake(world: World, input: Partial<Pick<Snake, 'id' | 'name' | 'seat' | 'bot' | 'eligible' | 'skin' | 'color' | 'respawnDelay'>> = {}): Snake {
  const id = input.id ?? world.snakes.length;
  const snake: Snake = {
    id,
    name: input.name ?? `Noodle ${id + 1}`,
    seat: input.seat ?? -1,
    color: input.color ?? input.skin ?? id % SKINS.length,
    skin: (input.skin ?? id) % SKINS.length,
    bot: input.bot ?? false,
    eligible: input.eligible ?? (input.seat !== undefined && input.seat >= 0),
    alive: false, x: 0, y: 0, px: 0, py: 0, angle: 0, prevAngle: 0, vx: 0, vy: 0,
    mass: 10, peak: 10, kills: 0, body: [], pathDistance: 0, boosting: false, boostDrop: 0,
    respawnAt: null, respawnDelay: input.respawnDelay ?? 3, reaction: 0,
  };
  world.snakes.push(snake);
  spawnSnake(world, snake);
  return snake;
}

export function spawnSnake(world: World, snake: Snake): WorldEvent {
  let x = 0;
  let y = 0;
  let best = -Infinity;
  const maxR = world.radius * 0.76;
  for (let attempt = 0; attempt < 80; attempt++) {
    const a = world.random() * Math.PI * 2;
    const r = Math.sqrt(world.random()) * maxR;
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r;
    let nearest = world.radius;
    for (const other of world.snakes) {
      if (other === snake || !other.alive) continue;
      nearest = Math.min(nearest, Math.hypot(cx - other.x, cy - other.y));
      for (let i = 0; i < other.body.length; i += 3) nearest = Math.min(nearest, Math.hypot(cx - other.body[i].x, cy - other.body[i].y));
    }
    if (nearest > best) {
      best = nearest;
      x = cx;
      y = cy;
    }
    if (nearest >= 300) {
      x = cx;
      y = cy;
      break;
    }
  }
  snake.x = snake.px = x;
  snake.y = snake.py = y;
  snake.angle = snake.prevAngle = Math.atan2(-y, -x) + (world.random() - 0.5) * 0.5;
  snake.vx = snake.vy = 0;
  snake.mass = 10;
  snake.peak = Math.max(snake.peak, 10);
  snake.alive = true;
  snake.boosting = false;
  snake.boostDrop = 0;
  snake.pathDistance = 0;
  snake.body = Array.from({ length: bodyCount(snake.mass) }, (_, i) => ({
    x: x - Math.cos(snake.angle) * i * SPACING,
    y: y - Math.sin(snake.angle) * i * SPACING,
  }));
  snake.respawnAt = null;
  return { type: 'spawn', id: snake.id, x, y, angle: snake.angle };
}

export function createSoloWorld(seed: number, skin = 0): World {
  const world = createWorld({ seed, radius: 1700, fillPellets: false });
  for (let i = 0; i < 15; i++) {
    const snake = addSnake(world, {
      id: i,
      name: i === 0 ? 'you' : FIELD_NAMES[(i - 1) % FIELD_NAMES.length],
      seat: -1,
      bot: i !== 0,
      eligible: false,
      skin: i === 0 ? skin : (i + 1) % SKINS.length,
      respawnDelay: 2.4,
    });
    if (i === 0) snake.peak = 10;
  }
  fillPellets(world, world.pelletTarget);
  return world;
}

export function fillPellets(world: World, count: number) {
  for (let i = 0; i < count; i++) {
    const a = world.random() * Math.PI * 2;
    const r = Math.sqrt(world.random()) * (world.radius - 30);
    addPellet(world, { x: Math.cos(a) * r, y: Math.sin(a) * r }, true);
  }
}

export function addPellet(world: World, point: Point, natural = false, value?: number, color = 0): Pellet {
  const pellet: Pellet = {
    id: world.nextPelletId++, x: point.x, y: point.y,
    value: value ?? (natural ? 1 + world.random() * 1.4 : 1 + world.random() * 5),
    color, born: world.clock, natural,
  };
  world.pellets.push(pellet);
  return pellet;
}

export function setPellet(world: World, pellet: Pellet) {
  world.nextPelletId = Math.max(world.nextPelletId, pellet.id + 1);
  world.pellets.push(pellet);
}

function addHistory(snake: Snake, oldX: number, oldY: number, newX: number, newY: number) {
  let dx = newX - oldX;
  let dy = newY - oldY;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const ux = dx / length;
  const uy = dy / length;
  let moved = SPACING - snake.pathDistance;
  while (moved <= length) {
    snake.body.unshift({ x: oldX + ux * moved, y: oldY + uy * moved });
    moved += SPACING;
  }
  snake.pathDistance = (snake.pathDistance + length) % SPACING;
  const max = bodyCount(snake.mass) + 2;
  if (snake.body.length > max) snake.body.length = max;
  dx = 0;
  dy = 0;
}

function buildGrid(snakes: Snake[]) {
  const grid = new Map<string, { snake: Snake; point: Point; head: boolean }[]>();
  for (const snake of snakes) {
    if (!snake.alive) continue;
    for (let i = 0; i < snake.body.length; i++) {
      const point = snake.body[i];
      const key = cellKey(point.x, point.y);
      const bucket = grid.get(key);
      const item = { snake, point, head: i === 0 };
      if (bucket) bucket.push(item);
      else grid.set(key, [item]);
    }
  }
  return grid;
}

export type BodyGrid = ReturnType<typeof buildGrid>;

function nearGrid(grid: Map<string, { snake: Snake; point: Point; head: boolean }[]>, x: number, y: number, radius: number) {
  const minX = Math.floor((x - radius) / GRID_SIZE);
  const maxX = Math.floor((x + radius) / GRID_SIZE);
  const minY = Math.floor((y - radius) / GRID_SIZE);
  const maxY = Math.floor((y + radius) / GRID_SIZE);
  const found: { snake: Snake; point: Point; head: boolean }[] = [];
  for (let gy = minY; gy <= maxY; gy++) for (let gx = minX; gx <= maxX; gx++) {
    const bucket = grid.get(`${gx},${gy}`);
    if (bucket) found.push(...bucket);
  }
  return found;
}

function makeDeathPellets(world: World, snake: Snake, events: WorldEvent[]) {
  const amount = snake.mass * 0.8;
  const count = Math.max(1, Math.ceil(amount / 8));
  for (let i = 0; i < count; i++) {
    const point = snake.body[Math.min(snake.body.length - 1, Math.floor((i / count) * snake.body.length))] ?? snake;
    const value = amount / count;
    const pellet = addPellet(world, point, false, value, snake.color);
    events.push({ type: 'pellet', pellet });
  }
}

export function step(
  world: World,
  inputs: ReadonlyMap<number, Input> | ReadonlyArray<Input | undefined> | Record<number, Input> = [],
  bodyGrid: BodyGrid = buildGrid(world.snakes),
): WorldEvent[] {
  const events: WorldEvent[] = [];
  world.tick++;
  world.clock += TICK;
  const getInput = (id: number): Input | undefined => inputs instanceof Map
    ? inputs.get(id)
    : Array.isArray(inputs)
      ? inputs[id]
      : (inputs as Record<number, Input>)[id];

  for (const snake of world.snakes) {
    if (!snake.alive) {
      if (snake.respawnAt !== null && snake.respawnAt <= world.clock) events.push(spawnSnake(world, snake));
      continue;
    }
    const input = getInput(snake.id);
    const target = input?.target ?? snake.angle;
    const turn = clamp(angleDiff(target, snake.angle), -maxTurnRate(snake) * TICK, maxTurnRate(snake) * TICK);
    snake.prevAngle = snake.angle;
    snake.px = snake.x;
    snake.py = snake.y;
    snake.angle += turn;
    snake.boosting = !!input?.boost && snake.mass > BOOST_MIN;
    const oldX = snake.x;
    const oldY = snake.y;
    const speed = snake.boosting ? BOOST_SPEED : SPEED;
    snake.vx = Math.cos(snake.angle) * speed;
    snake.vy = Math.sin(snake.angle) * speed;
    snake.x += snake.vx * TICK;
    snake.y += snake.vy * TICK;
    addHistory(snake, oldX, oldY, snake.x, snake.y);
    if (snake.boosting) {
      const drain = Math.min(snake.mass - BOOST_MIN, BOOST_DRAIN * TICK);
      snake.mass -= drain;
      snake.boostDrop += drain * 0.82;
      if (snake.boostDrop >= 0.6) {
        const tail = snake.body[Math.min(snake.body.length - 1, bodyCount(snake.mass) - 1)] ?? snake;
        const pellet = addPellet(world, tail, false, snake.boostDrop, snake.color);
        events.push({ type: 'pellet', pellet });
        snake.boostDrop = 0;
      }
    }
    snake.mass = Math.max(1, snake.mass);
    snake.peak = Math.max(snake.peak, snake.mass);
    while (snake.body.length < bodyCount(snake.mass)) {
      const tail = snake.body[snake.body.length - 1] ?? snake;
      snake.body.push({ x: tail.x - Math.cos(snake.angle) * SPACING, y: tail.y - Math.sin(snake.angle) * SPACING });
    }
  }

  const deaths = new Map<number, number | null>();
  for (const snake of world.snakes) {
    if (!snake.alive) continue;
    const r = radiusOf(snake.mass);
    if (Math.hypot(snake.x, snake.y) + r >= world.radius) {
      deaths.set(snake.id, null);
      continue;
    }
    const nearby = nearGrid(bodyGrid, snake.x, snake.y, r + 28);
    for (const point of nearby) {
      if (point.snake === snake || !point.snake.alive) continue;
      const reach = r + radiusOf(point.snake.mass);
      const dx = snake.x - point.point.x;
      const dy = snake.y - point.point.y;
      if (dx * dx + dy * dy <= reach * reach) {
        deaths.set(snake.id, point.snake.id);
        break;
      }
    }
  }

  for (const [id, killerId] of deaths) {
    const snake = world.snakes.find((s) => s.id === id);
    if (!snake || !snake.alive) continue;
    const mass = snake.mass;
    snake.alive = false;
    snake.boosting = false;
    snake.respawnAt = snake.respawnDelay > 0 ? world.clock + snake.respawnDelay : null;
    if (killerId !== null && killerId !== id) {
      const killer = world.snakes.find((s) => s.id === killerId);
      if (killer) killer.kills++;
    }
    makeDeathPellets(world, snake, events);
    events.push({ type: 'death', id, killer: killerId, mass, x: snake.x, y: snake.y });
  }

  const pellets = new Map<string, Pellet[]>();
  for (const pellet of world.pellets) {
    const key = cellKey(pellet.x, pellet.y);
    const bucket = pellets.get(key);
    if (bucket) bucket.push(pellet);
    else pellets.set(key, [pellet]);
  }
  const eaten = new Set<number>();
  for (const snake of world.snakes) {
    if (!snake.alive) continue;
    const reach = radiusOf(snake.mass) + 16;
    const candidates: Pellet[] = [];
    const minX = Math.floor((snake.x - reach) / GRID_SIZE);
    const maxX = Math.floor((snake.x + reach) / GRID_SIZE);
    const minY = Math.floor((snake.y - reach) / GRID_SIZE);
    const maxY = Math.floor((snake.y + reach) / GRID_SIZE);
    for (let gy = minY; gy <= maxY; gy++) for (let gx = minX; gx <= maxX; gx++) candidates.push(...(pellets.get(`${gx},${gy}`) ?? []));
    for (const pellet of candidates) {
      if (eaten.has(pellet.id)) continue;
      const dx = snake.x - pellet.x;
      const dy = snake.y - pellet.y;
      const pull = radiusOf(snake.mass) + 9 + Math.sqrt(pellet.value) * 2;
      if (dx * dx + dy * dy <= pull * pull) {
        eaten.add(pellet.id);
        snake.mass += pellet.value;
        snake.peak = Math.max(snake.peak, snake.mass);
        events.push({ type: 'eat', id: snake.id, pellet: pellet.id, value: pellet.value });
        events.push({ type: 'remove', pellet: pellet.id });
      }
    }
  }
  if (eaten.size) world.pellets = world.pellets.filter((p) => !eaten.has(p.id));
  const expired = world.pellets.filter((p) => !p.natural && world.clock - p.born >= 32);
  for (const pellet of expired) events.push({ type: 'remove', pellet: pellet.id });
  if (expired.length) {
    const expiredIds = new Set(expired.map((pellet) => pellet.id));
    world.pellets = world.pellets.filter((pellet) => !expiredIds.has(pellet.id));
  }
  world.pelletFill -= TICK;
  if (world.pellets.filter((p) => p.natural).length < world.pelletTarget && world.pelletFill <= 0) {
    world.pelletFill = 0.12;
    const pellet = addPellet(world, (() => {
      const a = world.random() * Math.PI * 2;
      const r = Math.sqrt(world.random()) * (world.radius - 30);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    })(), true);
    events.push({ type: 'pellet', pellet });
  }
  return events;
}

export function bodyGridFor(world: World): BodyGrid {
  return buildGrid(world.snakes);
}

export function nearbyBody(grid: ReturnType<typeof buildGrid>, x: number, y: number, radius: number) {
  return nearGrid(grid, x, y, radius);
}
