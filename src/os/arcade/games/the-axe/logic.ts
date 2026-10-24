import { mulberry32 } from '../../kit/party-core.ts';

export type Mode = 'classic' | 'big' | 'tree';
export type Level = 0 | 1 | 2;
export type Input = { x: number; y: number; sprint: boolean };
export type PlayerConfig = { seat: number; team: 0 | 1; name: string; ai: Level | null };
export type Player = {
  id: number; seat: number; team: 0 | 1; name: string; ai: Level | null;
  x: number; y: number; vx: number; vy: number; face: number;
  stamina: number; sprinting: boolean; restT: number;
  jailed: boolean; jailSlot: number; immuneT: number;
  safe: boolean; safeT: number; stunT: number; boostT: number;
  carrying: number; tags: number; caps: number; frees: number;
};
export type Axe = { owner: 0 | 1 | -1; homeX: number; homeY: number; x: number; y: number; carrier: number };
export type Pickup = { id: number; kind: 'drum' | 'costume'; x: number; y: number };
export type Phase = 'count' | 'play' | 'scored' | 'over';
export type GameEvent =
  | { type: 'tag'; by: number; who: number; x: number; y: number }
  | { type: 'free'; by: number; count: number; team: 0 | 1 }
  | { type: 'steal'; who: number; axe: number }
  | { type: 'drop'; axe: number; x: number; y: number }
  | { type: 'capture'; who: number; team: 0 | 1 }
  | { type: 'pickup'; who: number; kind: 'drum' | 'costume'; x: number; y: number }
  | { type: 'stun'; who: number; by: number }
  | { type: 'tree'; who: number; by: number }
  | { type: 'phase'; phase: Phase }
  | { type: 'overtime' };
export type World = {
  mode: Mode; seed: number; rng: () => number;
  players: Player[]; axes: Axe[]; pickups: Pickup[]; nextPickupId: number; pickupT: number;
  phase: Phase; phaseT: number; clock: number; overtime: boolean;
  score: [number, number]; treeScore: number[]; tree: number;
  winner: 0 | 1 | null; winnerId: number; time: number; acc: number;
};
export type Obstacle =
  | { kind: 'fountain' | 'hedge' | 'rack'; shape: 'circle'; x: number; y: number; r: number }
  | { kind: 'fountain' | 'hedge' | 'rack'; shape: 'rect'; x: number; y: number; w: number; h: number };

export const FIELD = {
  L: 60, W: 34, MID: 30, END: 6,
  JAILS: [{ x: 8, y: 1, w: 6, h: 6 }, { x: 46, y: 27, w: 6, h: 6 }],
} as const;
export const PLAYER_R = 0.9;
export const PEDESTAL_R = 1.3;
export const CAPS_TO_WIN = 3;
export const MATCH_TIME = 240;
export const TREE_TIME = 120;
export const STEP = 1 / 60;
export const OBSTACLES: Obstacle[] = [
  { kind: 'fountain', shape: 'circle', x: 30, y: 17, r: 2.4 },
  { kind: 'hedge', shape: 'rect', x: 22, y: 4, w: 1.4, h: 7 },
  { kind: 'hedge', shape: 'rect', x: 36.6, y: 23, w: 1.4, h: 7 },
  { kind: 'hedge', shape: 'rect', x: 24, y: 20, w: 1.4, h: 6 },
  { kind: 'hedge', shape: 'rect', x: 34.6, y: 8, w: 1.4, h: 6 },
  { kind: 'rack', shape: 'rect', x: 26, y: 10.5, w: 3.5, h: 0.8 },
  { kind: 'rack', shape: 'rect', x: 30.5, y: 22.7, w: 3.5, h: 0.8 },
  { kind: 'rack', shape: 'rect', x: 26.5, y: 27, w: 3, h: 0.8 },
  { kind: 'rack', shape: 'rect', x: 30.5, y: 6.2, w: 3, h: 0.8 },
];

const emptyInput = (): Input => ({ x: 0, y: 0, sprint: false });
export const halfOf = (x: number): 0 | 1 => x < FIELD.MID ? 0 : 1;
export const obstaclesFor = (mode: Mode): Obstacle[] => mode === 'big' ? OBSTACLES.filter((o) => o.kind !== 'fountain') : OBSTACLES;
export const jailRect = (team: 0 | 1) => FIELD.JAILS[team];

function jailPosition(team: 0 | 1, slot: number) {
  const jail = jailRect(team);
  const count = 12;
  const col = slot % 4;
  const row = Math.floor(slot / 4) % 3;
  return { x: jail.x + 1 + col * (jail.w - 2) / 3, y: jail.y + 1 + row * (jail.h - 2) / 2, count };
}

function playerFrom(config: PlayerConfig, id: number): Player {
  return {
    id, seat: config.seat, team: config.team, name: config.name, ai: config.ai,
    x: 0, y: 0, vx: 0, vy: 0, face: 0,
    stamina: 1, sprinting: false, restT: 0,
    jailed: false, jailSlot: -1, immuneT: 1,
    safe: false, safeT: 0, stunT: 0, boostT: 0, carrying: -1,
    tags: 0, caps: 0, frees: 0,
  };
}

export function createWorld(configs: PlayerConfig[], mode: Mode, seed: number): World {
  const rng = mulberry32(seed);
  const players = configs.slice(0, 10).map((config, id) => {
    const player = playerFrom(config, id);
    if (mode === 'tree') player.team = ((config.seat >= 0 ? config.seat : id) % 2) as 0 | 1;
    return player;
  });
  const world: World = {
    mode, seed, rng, players,
    axes: [], pickups: [], nextPickupId: 0, pickupT: 8,
    phase: 'count', phaseT: 3, clock: mode === 'tree' ? TREE_TIME : MATCH_TIME, overtime: false,
    score: [0, 0], treeScore: players.map(() => 0),
    tree: -1, winner: null, winnerId: -1, time: 0, acc: 0,
  };
  if (mode === 'tree' && world.players.length) world.tree = Math.floor(rng() * world.players.length);
  spawnAll(world);
  return world;
}

export function spawnAll(world: World) {
  const byTeam: [Player[], Player[]] = [[], []];
  for (const player of world.players) byTeam[player.team].push(player);
  for (const team of [0, 1] as const) {
    byTeam[team].forEach((player, index) => {
      const y = byTeam[team].length === 1 ? FIELD.W / 2 : 6 + index * (FIELD.W - 12) / (byTeam[team].length - 1);
      player.x = team === 0 ? 9 : 51;
      player.y = y;
    });
  }
  if (world.mode === 'tree') {
    const count = world.players.length;
    world.players.forEach((player, index) => {
      const angle = (index * Math.PI * 2) / Math.max(1, count);
      player.x = FIELD.MID + Math.cos(angle) * 11;
      player.y = FIELD.W / 2 + Math.sin(angle) * 11;
    });
  }
  for (const player of world.players) {
    player.vx = 0; player.vy = 0; player.face = player.team === 0 ? 0 : Math.PI;
    player.stamina = 1; player.sprinting = false; player.restT = 0;
    player.jailed = false; player.jailSlot = -1; player.safe = false; player.safeT = 0;
    player.immuneT = world.mode === 'tree' && player.id === world.tree ? 2 : 1;
    player.stunT = 0; player.boostT = 0; player.carrying = -1;
  }
  if (world.mode === 'classic') {
    world.axes = [
      { owner: 0, homeX: 3, homeY: 17, x: 3, y: 17, carrier: -1 },
      { owner: 1, homeX: 57, homeY: 17, x: 57, y: 17, carrier: -1 },
    ];
  } else if (world.mode === 'big') {
    world.axes = [{ owner: -1, homeX: 30, homeY: 17, x: 30, y: 17, carrier: -1 }];
  } else world.axes = [];
  world.pickups = [];
  world.pickupT = 8;
}

function boundedInput(input: Input | undefined): Input {
  if (!input) return emptyInput();
  let x = Number.isFinite(input.x) ? input.x : 0;
  let y = Number.isFinite(input.y) ? input.y : 0;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y, sprint: input.sprint === true };
}

function circleObstacle(p: Player, obstacle: Extract<Obstacle, { shape: 'circle' }>) {
  let dx = p.x - obstacle.x;
  let dy = p.y - obstacle.y;
  let distance = Math.hypot(dx, dy);
  const overlap = PLAYER_R + obstacle.r - distance;
  if (overlap <= 0) return;
  if (distance < 1e-6) { dx = 1; dy = 0; distance = 1; }
  const nx = dx / distance;
  const ny = dy / distance;
  p.x += nx * overlap;
  p.y += ny * overlap;
  const normal = p.vx * nx + p.vy * ny;
  if (normal < 0) { p.vx -= normal * nx; p.vy -= normal * ny; }
}

function rectObstacle(p: Player, obstacle: Extract<Obstacle, { shape: 'rect' }>) {
  const left = obstacle.x - PLAYER_R;
  const right = obstacle.x + obstacle.w + PLAYER_R;
  const top = obstacle.y - PLAYER_R;
  const bottom = obstacle.y + obstacle.h + PLAYER_R;
  if (p.x < left || p.x > right || p.y < top || p.y > bottom) return;
  const distances = [
    { d: p.x - left, nx: -1, ny: 0, x: left },
    { d: right - p.x, nx: 1, ny: 0, x: right },
    { d: p.y - top, nx: 0, ny: -1, y: top },
    { d: bottom - p.y, nx: 0, ny: 1, y: bottom },
  ];
  const side = distances.reduce((a, b) => a.d < b.d ? a : b);
  if ('x' in side) p.x = side.x!;
  else p.y = side.y!;
  const normal = p.vx * side.nx + p.vy * side.ny;
  if (normal < 0) { p.vx -= normal * side.nx; p.vy -= normal * side.ny; }
}

export function collideObstacles(p: Player, mode: Mode) {
  for (const obstacle of obstaclesFor(mode)) {
    if (obstacle.shape === 'circle') circleObstacle(p, obstacle);
    else rectObstacle(p, obstacle);
  }
  p.x = Math.max(PLAYER_R, Math.min(FIELD.L - PLAYER_R, p.x));
  p.y = Math.max(PLAYER_R, Math.min(FIELD.W - PLAYER_R, p.y));
}

export function movePlayer(p: Player, input: Input, dt: number, world: World) {
  if (p.jailed) {
    const spot = jailPosition((1 - p.team) as 0 | 1, Math.max(0, p.jailSlot));
    p.x = spot.x; p.y = spot.y; p.vx = 0; p.vy = 0; p.sprinting = false;
    return;
  }
  const command = boundedInput(input);
  const wasSprintRequested = command.sprint;
  const wasSprinting = p.sprinting;
  const canSprint = wasSprintRequested && p.stamina > 0 && p.carrying < 0 && !p.safe;
  let speed = 8.5;
  if (p.carrying >= 0) speed *= 0.85;
  if (canSprint) speed *= 1.55;
  if (p.boostT > 0) speed *= 1.35;
  if (world.mode === 'tree' && world.tree === p.id) speed *= 1.06;
  if (p.stunT > 0) speed = 0;
  p.sprinting = canSprint && p.stunT <= 0 && Math.hypot(command.x, command.y) > 0;
  const tx = command.x * speed;
  const ty = command.y * speed;
  const blend = Math.min(1, 12 * dt);
  p.vx += (tx - p.vx) * blend;
  p.vy += (ty - p.vy) * blend;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  collideObstacles(p, world.mode);
  if (Math.hypot(p.vx, p.vy) > 0.5) p.face = Math.atan2(p.vy, p.vx);
  if (p.sprinting) {
    p.stamina = Math.max(0, p.stamina - 0.55 * dt);
    if (p.stamina === 0) p.restT = 1;
  } else {
    if (wasSprinting && !wasSprintRequested) p.restT = Math.max(p.restT, 0.35);
    if (p.restT > 0) p.restT = Math.max(0, p.restT - dt);
    else p.stamina = Math.min(1, p.stamina + 0.3 * dt);
  }
}

function tickTimers(world: World, dt: number) {
  for (const player of world.players) {
    player.immuneT = Math.max(0, player.immuneT - dt);
    player.stunT = Math.max(0, player.stunT - dt);
    player.boostT = Math.max(0, player.boostT - dt);
    if (player.safe) {
      player.safeT -= dt;
      if (halfOf(player.x) === player.team || player.safeT <= 0) {
        player.safe = false;
        player.safeT = 0;
        player.immuneT = 1.5;
      }
    }
  }
}

function nextJailSlot(world: World, jailTeam: 0 | 1) {
  const occupied = new Set(world.players
    .filter((p) => p.jailed && (1 - p.team) === jailTeam)
    .map((p) => p.jailSlot));
  let slot = 0;
  while (occupied.has(slot) && slot < 12) slot++;
  return slot;
}

function sendHome(world: World, axeIndex: number, events: GameEvent[], droppedAt?: { x: number; y: number }) {
  const axe = world.axes[axeIndex];
  if (!axe) return;
  if (axe.carrier >= 0) {
    const carrier = world.players[axe.carrier];
    if (carrier) carrier.carrying = -1;
  }
  axe.carrier = -1;
  axe.x = axe.homeX;
  axe.y = axe.homeY;
  if (droppedAt) events.push({ type: 'drop', axe: axeIndex, x: droppedAt.x, y: droppedAt.y });
}

function tagAndFree(world: World, events: GameEvent[]) {
  if (world.mode === 'tree') {
    const tree = world.players[world.tree];
    if (!tree || tree.immuneT > 0 || tree.jailed || tree.stunT > 0) return;
    for (const player of world.players) {
      if (player.id === tree.id || player.jailed || player.stunT > 0) continue;
      if (Math.hypot(player.x - tree.x, player.y - tree.y) >= PLAYER_R * 2 + 0.15) continue;
      const oldTree = tree.id;
      world.tree = player.id;
      player.immuneT = 1.5;
      tree.stunT = 0.6;
      events.push({ type: 'tree', who: player.id, by: oldTree });
      break;
    }
    return;
  }

  for (const tagger of world.players) {
    if (tagger.jailed || tagger.safe || tagger.stunT > 0) continue;
    for (const target of world.players) {
      if (target.team === tagger.team || target.jailed || target.safe || target.immuneT > 0 || halfOf(target.x) !== tagger.team) continue;
      if (Math.hypot(target.x - tagger.x, target.y - tagger.y) >= PLAYER_R * 2 + 0.15) continue;
      const tagX = target.x;
      const tagY = target.y;
      target.jailed = true;
      target.jailSlot = nextJailSlot(world, tagger.team);
      target.vx = 0; target.vy = 0; target.sprinting = false;
      const spot = jailPosition(tagger.team, target.jailSlot);
      target.x = spot.x; target.y = spot.y;
      tagger.tags++;
      if (target.carrying >= 0) sendHome(world, target.carrying, events, { x: tagX, y: tagY });
      events.push({ type: 'tag', by: tagger.id, who: target.id, x: tagX, y: tagY });
    }
  }

  for (const rescuer of world.players) {
    if (rescuer.jailed || rescuer.safe || rescuer.stunT > 0 || rescuer.carrying >= 0) continue;
    const jailTeam = (1 - rescuer.team) as 0 | 1;
    const jail = jailRect(jailTeam);
    const nearestX = Math.max(jail.x, Math.min(rescuer.x, jail.x + jail.w));
    const nearestY = Math.max(jail.y, Math.min(rescuer.y, jail.y + jail.h));
    if (Math.hypot(rescuer.x - nearestX, rescuer.y - nearestY) > PLAYER_R) continue;
    const captives = world.players.filter((p) => p.jailed && p.team === rescuer.team);
    if (!captives.length) continue;
    for (const captive of captives) {
      captive.jailed = false;
      captive.safe = true;
      captive.safeT = 7;
      captive.jailSlot = -1;
    }
    rescuer.safe = true;
    rescuer.safeT = 7;
    rescuer.frees++;
    events.push({ type: 'free', by: rescuer.id, count: captives.length, team: rescuer.team });
  }
}

function separatePlayers(players: Player[], mode: Mode) {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (a.jailed) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (b.jailed) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      const overlap = PLAYER_R * 2 - distance;
      if (overlap <= 0) continue;
      if (distance < 1e-6) { dx = a.id < b.id ? 1 : -1; dy = 0; distance = 1; }
      const nx = dx / distance;
      const ny = dy / distance;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      collideObstacles(a, mode);
      collideObstacles(b, mode);
    }
  }
}

function grabAndScore(world: World, events: GameEvent[]) {
  for (const axe of world.axes) {
    if (axe.carrier >= 0) {
      const carrier = world.players[axe.carrier];
      if (!carrier || carrier.jailed) { sendHome(world, world.axes.indexOf(axe), events); continue; }
      axe.x = carrier.x;
      axe.y = carrier.y;
    } else {
      for (const player of world.players) {
        if (player.jailed || player.safe || player.stunT > 0 || player.carrying >= 0) continue;
        const canTake = world.mode === 'big' || player.team !== axe.owner;
        if (!canTake || Math.hypot(player.x - axe.x, player.y - axe.y) >= PLAYER_R + PEDESTAL_R) continue;
        axe.carrier = player.id;
        player.carrying = world.axes.indexOf(axe);
        player.immuneT = 1.6;
        events.push({ type: 'steal', who: player.id, axe: player.carrying });
        break;
      }
    }
    if (axe.carrier < 0) continue;
    const carrier = world.players[axe.carrier];
    if (!carrier || carrier.jailed || carrier.safe) continue;
    const scored = world.mode === 'big'
      ? (carrier.team === 0 ? carrier.x > FIELD.L - FIELD.END : carrier.x < FIELD.END)
      : halfOf(carrier.x) === carrier.team && (carrier.team === 0 ? carrier.x < FIELD.END : carrier.x > FIELD.L - FIELD.END);
    if (!scored) continue;
    carrier.caps++;
    world.score[carrier.team]++;
    events.push({ type: 'capture', who: carrier.id, team: carrier.team });
    for (let i = 0; i < world.axes.length; i++) sendHome(world, i, events);
    world.phase = 'scored';
    world.phaseT = 2.8;
    events.push({ type: 'phase', phase: 'scored' });
    break;
  }
}

function spawnPickup(world: World) {
  for (let tries = 0; tries < 32; tries++) {
    const x = 21 + world.rng() * 18;
    const y = 3 + world.rng() * 28;
    const blocked = obstaclesFor(world.mode).some((o) => o.shape === 'circle'
      ? Math.hypot(x - o.x, y - o.y) < o.r + 1
      : x > o.x - 1 && x < o.x + o.w + 1 && y > o.y - 1 && y < o.y + o.h + 1);
    if (blocked) continue;
    world.pickups.push({ id: world.nextPickupId++, kind: world.rng() < 0.5 ? 'drum' : 'costume', x, y });
    return;
  }
}

function pickupsStep(world: World, dt: number, events: GameEvent[]) {
  if (world.pickups.length < 2) {
    world.pickupT -= dt;
    if (world.pickupT <= 0) {
      spawnPickup(world);
      world.pickupT = 10 + world.rng() * 4;
    }
  }
  for (let index = world.pickups.length - 1; index >= 0; index--) {
    const pickup = world.pickups[index];
    const taker = world.players.find((p) => !p.jailed && !p.safe && p.stunT <= 0
      && Math.hypot(p.x - pickup.x, p.y - pickup.y) < PLAYER_R + 0.9);
    if (!taker) continue;
    if (pickup.kind === 'costume') taker.boostT = 3.5;
    else {
      for (const other of world.players) {
        const enemy = world.mode === 'tree' ? other.id !== taker.id : other.team !== taker.team;
        if (enemy && !other.jailed && Math.hypot(other.x - taker.x, other.y - taker.y) <= 7) {
          other.stunT = 1.3;
          events.push({ type: 'stun', who: other.id, by: taker.id });
        }
      }
    }
    events.push({ type: 'pickup', who: taker.id, kind: pickup.kind, x: pickup.x, y: pickup.y });
    world.pickups.splice(index, 1);
  }
}

function matchWinner(world: World) {
  return world.score[0] >= CAPS_TO_WIN || world.score[1] >= CAPS_TO_WIN || world.overtime;
}

function finish(world: World, team: 0 | 1 | null, events: GameEvent[]) {
  world.winner = team;
  world.winnerId = -1;
  world.phase = 'over';
  world.phaseT = 0;
  events.push({ type: 'phase', phase: 'over' });
}

function simulate(world: World, inputs: Input[], events: GameEvent[]) {
  if (world.phase === 'over') return;
  if (world.phase === 'count') {
    world.phaseT -= STEP;
    if (world.phaseT <= 0) {
      world.phase = 'play';
      world.phaseT = 0;
      events.push({ type: 'phase', phase: 'play' });
    }
    return;
  }
  if (world.phase === 'scored') {
    world.phaseT -= STEP;
    for (const player of world.players) {
      player.vx *= Math.exp(-8 * STEP);
      player.vy *= Math.exp(-8 * STEP);
    }
    if (world.phaseT <= 0) {
      if (matchWinner(world)) finish(world, world.score[0] === world.score[1] ? null : world.score[0] > world.score[1] ? 0 : 1, events);
      else {
        spawnAll(world);
        world.phase = 'count';
        world.phaseT = 3;
        events.push({ type: 'phase', phase: 'count' });
      }
    }
    return;
  }

  world.time += STEP;
  tickTimers(world, STEP);
  if (world.mode === 'tree') {
    world.treeScore[world.tree] += STEP;
    world.clock = Math.max(0, world.clock - STEP);
  } else if (!world.overtime) world.clock = Math.max(0, world.clock - STEP);

  for (const player of world.players) movePlayer(player, inputs[player.id] ?? emptyInput(), STEP, world);
  tagAndFree(world, events);
  separatePlayers(world.players, world.mode);
  grabAndScore(world, events);
  pickupsStep(world, STEP, events);
  if (world.phase !== 'play') return;

  if (world.mode === 'tree' && world.clock <= 0) {
    world.winnerId = world.treeScore.reduce((best, score, id) => score > world.treeScore[best] ? id : best, 0);
    world.winner = world.players[world.winnerId]?.team ?? null;
    world.phase = 'over';
    events.push({ type: 'phase', phase: 'over' });
    return;
  }
  if (world.mode !== 'tree' && world.clock <= 0) {
    if (world.score[0] !== world.score[1]) {
      finish(world, world.score[0] > world.score[1] ? 0 : 1, events);
    } else if (!world.overtime) {
      world.overtime = true;
      events.push({ type: 'overtime' });
    }
  }
}

export function step(world: World, inputs: Input[], dt: number): GameEvent[] {
  if (!Number.isFinite(dt) || dt <= 0 || world.phase === 'over') return [];
  world.acc += dt;
  const events: GameEvent[] = [];
  while (world.acc + 1e-9 >= STEP && !isOver(world)) {
    world.acc -= STEP;
    simulate(world, inputs, events);
  }
  return events;
}

function isOver(world: World) {
  return world.phase === 'over';
}

export function takeoverDeparted(world: World, liveSeats: number[], level: Level): number[] {
  const taken: number[] = [];
  for (const player of world.players) {
    if (player.seat >= 0 && player.ai === null && !liveSeats.includes(player.seat)) {
      player.ai = level;
      taken.push(player.seat);
    }
  }
  return taken;
}

export function assignTeams(seats: { seat: number; bot: boolean }[]): Map<number, 0 | 1> {
  const result = new Map<number, 0 | 1>();
  const humans = seats.filter((s) => !s.bot).slice().sort((a, b) => a.seat - b.seat);
  humans.forEach((entry, index) => result.set(entry.seat, (index % 2) as 0 | 1));
  const counts = [0, 0];
  for (const team of result.values()) counts[team]++;
  for (const bot of seats.filter((s) => s.bot).slice().sort((a, b) => a.seat - b.seat)) {
    const team: 0 | 1 = counts[0] <= counts[1] ? 0 : 1;
    result.set(bot.seat, team);
    counts[team]++;
  }
  return result;
}

export function soloRoster(teamSize: number, level: Level, twoPlayer: boolean, botNames: readonly string[]): PlayerConfig[] {
  const size = Math.max(1, Math.min(5, Math.floor(teamSize)));
  const configs: PlayerConfig[] = [];
  if (twoPlayer) {
    configs.push({ seat: -1, team: 0, name: 'p1', ai: null }, { seat: -1, team: 1, name: 'p2', ai: null });
  } else configs.push({ seat: -1, team: 0, name: 'you', ai: null });
  let nameIndex = 0;
  const nextName = () => botNames[nameIndex++] ?? `bot ${nameIndex}`;
  if (twoPlayer) {
    for (let i = 1; i < size; i++) configs.push({ seat: -1, team: 0, name: nextName(), ai: level });
    for (let i = 1; i < size; i++) configs.push({ seat: -1, team: 1, name: nextName(), ai: level });
  } else {
    for (let i = 1; i < size; i++) configs.push({ seat: -1, team: 0, name: nextName(), ai: level });
    for (let i = 0; i < size; i++) configs.push({ seat: -1, team: 1, name: nextName(), ai: level });
  }
  return configs;
}
