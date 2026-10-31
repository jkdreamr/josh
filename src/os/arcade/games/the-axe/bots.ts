import { FIELD, PEDESTAL_R, PLAYER_R, halfOf, jailRect, obstaclesFor, type Input, type Level, type Player, type World } from './logic.ts';

// The bots play as a team. Each tick a team plan (cached per world) hands out roles that stick unless the game
// changes: carriers carry, one teammate breaks the jail when the timed jailbreak is too far off, a share of the team
// defends (hunting the most dangerous intruders, the axe carrier first, and guarding the axe and the jail door), and the
// rest attack. Attackers wait on their own side of the midline, where nobody can tag them, and only run for the axe
// when they can get there before any defender can cut them off; anyone caught on the wrong half runs home dodging.

export type BotRole = 'attack' | 'defend' | 'jailbreak' | 'carry' | 'tree-run' | 'tree-chase';
export type BotMemory = {
  role: BotRole;
  thinkT: number;
  /** Where the bot is headed (the point it steers for between decisions). */
  target: { x: number; y: number };
  /** Between decisions: seek the target, or keep the dodge it picked. */
  aim: 'seek' | 'dir';
  dir: { x: number; y: number };
  sprint: boolean;
  /** Slow down on arriving (holding a spot), rather than run through it (chasing). */
  ease: boolean;
  last: Input;
  targetId: number;
  waypoint: { x: number; y: number } | null;
  /** A run for the axe or the jail is under way (kept unless it turns hopeless). */
  committed: boolean;
  /** How long it has waited at the midline for an opening. */
  waitT: number;
  /** The lane it waits in, or runs a carried axe home along. */
  lane: number;
  jukeSide: number;
};

export function makeMemory(): BotMemory {
  return {
    role: 'attack', thinkT: 0, target: { x: FIELD.MID, y: FIELD.W / 2 }, aim: 'seek', dir: { x: 0, y: 0 }, sprint: false, ease: false,
    last: { x: 0, y: 0, sprint: false }, targetId: -1, waypoint: null, committed: false, waitT: 0, lane: FIELD.W / 2, jukeSide: 1,
  };
}

type Point = { x: number; y: number };
/** Per level: decision time, top speed, the head start an attacker wants before running in, how far it leads a target. */
const REACT = [0.32, 0.16, 0.07] as const;
const SPEED_SCALE = [0.8, 0.94, 1] as const;
const MARGIN = [0.55, 0.3, 0.12] as const;
const LEAD = [0.35, 0.75, 1] as const;
const BASE_SPEED = 8.5;
const TAG_RANGE = PLAYER_R * 2 + 0.15;
const LANES = [5, 17, 29] as const;
/** How far ahead (seconds) a carrier looks when dodging: it is slow, so it has to see trouble coming. */
const CARRY_LOOK = 0.8;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const levelOf = (p: Player): Level => p.ai ?? 1;
/** Toward the team's own end along x: -1 for stanford (left), 1 for cal. */
const homeward = (team: 0 | 1) => team === 0 ? -1 : 1;
/** A point just inside the team's own half, where nobody can tag it. */
const safeX = (team: 0 | 1) => FIELD.MID + homeward(team) * 1.4;
const onOwnHalf = (p: Point, team: 0 | 1) => halfOf(p.x) === team;
const pedestal = (team: 0 | 1) => ({ x: team === 0 ? 3 : 57, y: 17 });
const jailCenter = (team: 0 | 1) => {
  const j = jailRect(team);
  return { x: j.x + j.w / 2, y: j.y + j.h / 2 };
};

/** The axe this team is after: the other team's, or the one in the middle. */
function goalAxe(world: World, team: 0 | 1) {
  return world.mode === 'big' ? world.axes[0] : world.axes.find((axe) => axe.owner !== team);
}

/** The nearest point where a carrier on this team scores. */
function scorePoint(world: World, team: 0 | 1, from: Point): Point {
  const x = world.mode === 'big' ? (team === 0 ? FIELD.L - 3.5 : 3.5) : (team === 0 ? 3.5 : FIELD.L - 3.5);
  return { x, y: clamp(from.y, 4, FIELD.W - 4) };
}

/** Whether `e` could tag `p` standing at `at` (ignoring how far away it is). */
const canTag = (e: Player, p: Player, at: Point) => e.team !== p.team && !e.jailed && !e.safe && !p.safe && halfOf(at.x) === e.team;

function topSpeed(p: Player) {
  let speed = BASE_SPEED;
  if (p.carrying >= 0) speed *= 0.85;
  else if (p.stamina > 0.12 && !p.safe) speed *= 1.55;
  if (p.boostT > 0) speed *= 1.35;
  return speed;
}

/** Seconds for `e` to get within tagging reach of `at`. */
const reachTime = (e: Player, at: Point) => Math.max(0, distance(e, at) - TAG_RANGE) / topSpeed(e) + e.stunT;

/** Seconds for `p` to run `d` from now, sprinting while its stamina lasts. */
function runTime(p: Player, d: number) {
  const scale = SPEED_SCALE[levelOf(p)];
  let walk = BASE_SPEED * scale * (p.boostT > 0 ? 1.35 : 1);
  if (p.carrying >= 0) return d / (walk * 0.85);
  const sprint = walk * 1.55;
  const sprintFor = p.safe ? 0 : p.stamina / 0.55;
  if (d <= sprint * sprintFor) return d / sprint;
  return sprintFor + (d - sprint * sprintFor) / walk;
}

/**
 * How much time to spare `p` has running the path through `points` (the last one trimmed by `stopShort`): the least,
 * over every spot along it on the other half, of how long the quickest tagger needs to get there after `p` does.
 * Infinity when nobody can get in its way.
 */
function pathSlack(world: World, p: Player, points: Point[], stopShort = 0) {
  const enemies = world.players.filter((e) => e.team !== p.team && !e.jailed && !e.safe);
  let slack = Infinity;
  let from: Point = p;
  let travelled = 0;
  for (let leg = 0; leg < points.length; leg++) {
    let to = points[leg];
    let length = distance(from, to);
    if (leg === points.length - 1 && stopShort > 0) {
      const keep = Math.max(0, length - stopShort);
      to = length > 1e-6 ? { x: from.x + (to.x - from.x) * keep / length, y: from.y + (to.y - from.y) * keep / length } : to;
      length = keep;
    }
    const samples = Math.max(1, Math.ceil(length / 1.5));
    for (let i = 1; i <= samples; i++) {
      const f = i / samples;
      const at = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
      const mine = runTime(p, travelled + length * f);
      if (mine < p.immuneT) continue;
      for (const e of enemies) if (canTag(e, p, at)) slack = Math.min(slack, reachTime(e, at) + 0.12 - mine);
    }
    travelled += length;
    from = to;
  }
  return slack;
}

// ---------- obstacles and routes ----------

const blockedGrid = new Map<string, Uint8Array>();
function blockedCells(world: World) {
  let grid = blockedGrid.get(world.mode);
  if (!grid) {
    grid = new Uint8Array(61 * 35);
    for (let y = 0; y <= 34; y++) for (let x = 0; x <= 60; x++) grid[y * 61 + x] = pointBlocked(world, x, y) ? 1 : 0;
    blockedGrid.set(world.mode, grid);
  }
  return grid;
}

function pointBlocked(world: World, x: number, y: number) {
  if (x < PLAYER_R || x > FIELD.L - PLAYER_R || y < PLAYER_R || y > FIELD.W - PLAYER_R) return true;
  for (const obstacle of obstaclesFor(world.mode)) {
    if (obstacle.shape === 'circle') {
      if (Math.hypot(x - obstacle.x, y - obstacle.y) < obstacle.r + PLAYER_R + 0.12) return true;
    } else {
      const dx = Math.max(obstacle.x - x, 0, x - (obstacle.x + obstacle.w));
      const dy = Math.max(obstacle.y - y, 0, y - (obstacle.y + obstacle.h));
      if (Math.hypot(dx, dy) < PLAYER_R + 0.12) return true;
    }
  }
  return false;
}

function lineBlocked(world: World, from: Point, to: Point) {
  const length = distance(from, to);
  const checks = Math.ceil(length / 0.7);
  for (let i = 1; i < checks; i++) {
    const f = i / checks;
    if (pointBlocked(world, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f)) return true;
  }
  return false;
}

type HeapNode = { id: number; cost: number };
function heapPush(heap: HeapNode[], node: HeapNode) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].cost <= node.cost) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = node;
}

function heapPop(heap: HeapNode[]): HeapNode | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (!heap.length || !last) return top;
  let i = 0;
  while (i * 2 + 1 < heap.length) {
    let child = i * 2 + 1;
    if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
    if (last.cost <= heap[child].cost) break;
    heap[i] = heap[child];
    i = child;
  }
  heap[i] = last;
  return top;
}

function nearestWalkable(grid: Uint8Array, x: number, y: number) {
  for (let radius = 0; radius <= 5; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const px = clamp(Math.round(x) + dx, 1, 59);
      const py = clamp(Math.round(y) + dy, 1, 33);
      if (!grid[py * 61 + px]) return { x: px, y: py, id: py * 61 + px };
    }
  }
  return null;
}

/** The next point to make for on the way to `target`: the target itself in the open, else a corner round the hedges. */
export function routeAround(world: World, from: Point, target: Point): Point {
  if (!lineBlocked(world, from, target)) return target;
  const grid = blockedCells(world);
  const start = nearestWalkable(grid, from.x, from.y);
  const goal = nearestWalkable(grid, target.x, target.y);
  if (!start || !goal) return target;
  const total = 61 * 35;
  const costs = new Float32Array(total).fill(Infinity);
  const previous = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  costs[start.id] = 0;
  const heap: HeapNode[] = [];
  heapPush(heap, { id: start.id, cost: distance(start, goal) });
  let found = false;
  while (heap.length) {
    const current = heapPop(heap)!;
    if (closed[current.id]) continue;
    if (current.id === goal.id) { found = true; break; }
    closed[current.id] = 1;
    const x = current.id % 61;
    const y = Math.floor(current.id / 61);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || nx > 59 || ny < 1 || ny > 33) continue;
      const next = ny * 61 + nx;
      if (grid[next] || closed[next]) continue;
      const cost = costs[current.id] + (dx && dy ? Math.SQRT2 : 1);
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      previous[next] = current.id;
      heapPush(heap, { id: next, cost: cost + Math.hypot(nx - goal.x, ny - goal.y) });
    }
  }
  if (!found) return target;
  // the furthest point along the path still in plain sight
  let best: Point | null = null;
  for (let node = goal.id; node !== start.id && node >= 0; node = previous[node]) {
    const point = { x: node % 61, y: Math.floor(node / 61) };
    if (!lineBlocked(world, from, point)) { best = point; break; }
  }
  return best ?? target;
}

// ---------- the team plan ----------

type Plan = {
  roles: Map<number, BotRole>;
  /** Defenders sent after an intruder: bot id to enemy id. */
  chase: Map<number, number>;
  /** Defenders left to guard: bot id to the spot to hold. */
  guard: Map<number, Point>;
  /** The attackers are all going at once, each down its own lane (bot id to lane). */
  rush: Map<number, number> | null;
};
type PlanCache = {
  time: number; key: string; plans: [Plan | null, Plan | null]; prev: [Map<number, BotRole>, Map<number, BotRole>];
  /** When each team's next all-out rush starts, and until when the current one runs. */
  rushAt: [number, number]; rushUntil: [number, number];
};
const plans = new WeakMap<World, PlanCache>();

function teamPlan(world: World, team: 0 | 1): Plan {
  let cache = plans.get(world);
  if (!cache) {
    cache = { time: -1, key: '', plans: [null, null], prev: [new Map(), new Map()], rushAt: [4 + world.rng() * 4, 4 + world.rng() * 4], rushUntil: [0, 0] };
    plans.set(world, cache);
  }
  // (a plan holds for one tick, and only while nobody has been jailed, freed or picked up an axe in it)
  const key = world.players.map((p) => `${p.jailed ? 1 : 0}${p.safe ? 1 : 0}${p.carrying}${p.ai === null ? 'h' : ''}`).join();
  if (cache.time !== world.time || cache.key !== key) {
    cache.time = world.time;
    cache.key = key;
    cache.plans = [null, null];
  }
  let plan = cache.plans[team];
  if (!plan) {
    plan = makePlan(world, team, cache.prev[team]);
    // every so often the attackers stop waiting for an opening and all go at once, spread across the lanes: the
    // defense can't cover every one of them
    if (world.time < cache.rushAt[team] - 20) cache.rushAt[team] = world.time + 4;
    if (world.time >= cache.rushAt[team]) {
      cache.rushUntil[team] = world.time + 3.2;
      cache.rushAt[team] = world.time + 5 + world.rng() * 5;
    }
    if (world.time < cache.rushUntil[team]) {
      const attackers = [...plan.roles].filter(([, role]) => role === 'attack' || role === 'jailbreak').map(([id]) => world.players[id]);
      if (attackers.length) {
        plan.rush = new Map();
        attackers.sort((a, b) => a.y - b.y || a.id - b.id).forEach((p, i) => plan!.rush!.set(p.id, LANES[Math.round((i + 0.5) * LANES.length / attackers.length - 0.5)]));
      }
    }
    cache.plans[team] = plan;
    cache.prev[team] = plan.roles;
  }
  return plan;
}

/** Enemies in this team's half, most dangerous first: carriers, then whoever is closest to the axe or the jail door. */
function intruders(world: World, team: 0 | 1) {
  const axe = pedestal(team);
  const holding = world.players.some((p) => p.jailed && p.team !== team);
  const jail = jailCenter(team);
  const danger = (e: Player) => {
    if (e.carrying >= 0) return -100 + distance(e, scorePoint(world, e.team, e));
    let d = world.mode === 'big' ? distance(e, goalAxe(world, e.team) ?? axe) : distance(e, axe);
    if (holding) d = Math.min(d, distance(e, jail) * 0.8);
    return d;
  };
  return world.players
    .filter((e) => e.team !== team && !e.jailed && !e.safe && onOwnHalf(e, team))
    .sort((a, b) => danger(a) - danger(b) || a.id - b.id);
}

function makePlan(world: World, team: 0 | 1, prev: Map<number, BotRole>): Plan {
  const roles = new Map<number, BotRole>();
  const chase = new Map<number, number>();
  const guard = new Map<number, Point>();
  const plan: Plan = { roles, chase, guard, rush: null };
  const bots = world.players.filter((p) => p.team === team && p.ai !== null && !p.jailed);
  if (world.mode === 'tree') {
    for (const p of bots) roles.set(p.id, p.id === world.tree ? 'tree-run' : 'tree-chase');
    return plan;
  }
  for (const p of bots) if (p.carrying >= 0) roles.set(p.id, 'carry');
  const free = world.players.filter((p) => p.team === team && !p.jailed);
  const open = () => bots.filter((p) => !roles.has(p.id) && !p.safe);
  const threats = intruders(world, team);
  const enemyCarrier = world.players.find((p) => p.team !== team && p.carrying >= 0 && !p.jailed);

  // one teammate breaks the jail, unless it opens by itself before they could get there
  const prisoners = world.players.filter((p) => p.team === team && p.jailed).length;
  if (prisoners) {
    const jail = jailCenter((1 - team) as 0 | 1);
    // (from our own side: someone still out on theirs, just let out of that jail, is busy getting home)
    const rescuer = open()
      .filter((p) => (onOwnHalf(p, team) || distance(p, jail) < 5) && runTime(p, distance(p, jail)) + 1.5 < world.jailT)
      .sort((a, b) => Number(prev.get(b.id) === 'jailbreak') - Number(prev.get(a.id) === 'jailbreak')
        || distance(a, jail) - distance(b, jail) || a.id - b.id)[0];
    if (rescuer && (open().length > 1 || !threats.length)) roles.set(rescuer.id, 'jailbreak');
  }

  // defenders: about two in five of the team (people on their own end count), more while an enemy has the axe
  let wanted = free.length >= 2 ? Math.max(1, Math.round(free.length * 0.4)) : threats.length ? 1 : 0;
  const humansHome = free.filter((p) => p.ai === null && onOwnHalf(p, team) && Math.abs(p.x - pedestal(team).x) < 18).length;
  wanted = Math.max(threats.length ? 1 : 0, wanted - humansHome);
  if (enemyCarrier) wanted = Math.max(wanted, Math.min(open().length, 2 + Math.floor(free.length / 3)));
  const home = pedestal(team);
  const candidates = open().sort((a, b) => {
    const stick = Number(prev.get(b.id) === 'defend') - Number(prev.get(a.id) === 'defend');
    // (anyone stuck out on the other half is the last to be called back)
    const away = (p: Player) => onOwnHalf(p, team) ? 0 : 30;
    const da = (enemyCarrier ? distance(a, enemyCarrier) : distance(a, home)) + away(a);
    const db = (enemyCarrier ? distance(b, enemyCarrier) : distance(b, home)) + away(b);
    return (enemyCarrier ? 0 : stick) || da - db || a.id - b.id;
  });
  const defenders = candidates.slice(0, wanted);
  for (const p of defenders) roles.set(p.id, 'defend');
  for (const p of open()) roles.set(p.id, 'attack');

  // each intruder gets the defender who can reach it soonest (a carrier gets two); the rest guard
  const left = defenders.slice();
  for (const threat of threats) {
    for (let n = 0; n < (threat.carrying >= 0 ? 2 : 1) && left.length; n++) {
      left.sort((a, b) => distance(a, threat) / topSpeed(a) - distance(b, threat) / topSpeed(b) || a.id - b.id);
      chase.set(left.shift()!.id, threat.id);
    }
  }
  const spots = guardSpots(world, team, left.length);
  left.sort((a, b) => a.y - b.y || a.id - b.id).forEach((p, i) => guard.set(p.id, spots[i]));
  return plan;
}

/** Where idle defenders stand: between the axe and the nearest attackers, and at the jail door when it is about to open. */
function guardSpots(world: World, team: 0 | 1, count: number): Point[] {
  const spots: Point[] = [];
  if (!count) return spots;
  const holding = world.players.some((p) => p.jailed && p.team !== team);
  if (holding && world.jailT < 3.5) {
    const jail = jailCenter(team);
    spots.push({ x: jail.x - homeward(team) * 4.5, y: jail.y + (jail.y < FIELD.W / 2 ? 3 : -3) });
  }
  const axe = world.mode === 'big' ? { x: FIELD.L / 2 + homeward(team) * 6, y: FIELD.W / 2 } : pedestal(team);
  const attackers = world.players
    .filter((e) => e.team !== team && !e.jailed && !e.safe)
    .sort((a, b) => distance(a, axe) - distance(b, axe) || a.id - b.id);
  for (let i = spots.length; i < count; i++) {
    const e = attackers[(i - spots.length) % Math.max(1, attackers.length)];
    const toward = e ? { x: e.x - axe.x, y: e.y - axe.y } : { x: -homeward(team), y: 0 };
    const length = Math.max(1e-6, Math.hypot(toward.x, toward.y));
    const reach = clamp(length * 0.45, 4, 11);
    const spread = (i - (count - 1) / 2) * 2.2;
    let x = axe.x + toward.x / length * reach - toward.y / length * spread;
    const y = clamp(axe.y + toward.y / length * reach + toward.x / length * spread, 2.5, FIELD.W - 2.5);
    x = team === 0 ? clamp(x, 2.5, FIELD.MID - 2) : clamp(x, FIELD.MID + 2, FIELD.L - 2.5);
    spots.push({ x, y });
  }
  return spots;
}

/** Kept for tests and tools: every bot's role this tick. */
export function assignRoles(world: World, teamFilter?: 0 | 1): Map<number, BotRole> {
  const roles = new Map<number, BotRole>();
  for (const team of [0, 1] as const) {
    if (teamFilter !== undefined && team !== teamFilter) continue;
    for (const [id, role] of teamPlan(world, team).roles) roles.set(id, role);
  }
  return roles;
}

// ---------- moves ----------

type Move = { target: Point; sprint: boolean; id?: number; dodge?: Point; ease?: boolean };

/** Where to run to meet `e`, leading it by up to its speed times the time to get there. */
function intercept(p: Player, e: Player, lead: number): Point {
  let at: Point = e;
  for (let i = 0; i < 3; i++) {
    const t = Math.min(1.2, runTime(p, Math.max(0, distance(p, at) - TAG_RANGE * 0.5))) * lead;
    at = { x: e.x + e.vx * t, y: e.y + e.vy * t };
  }
  return { x: clamp(at.x, 1, FIELD.L - 1), y: clamp(at.y, 1, FIELD.W - 1) };
}

/**
 * The best way to run from `p` toward `goal` with taggers about: each of a ring of headings is scored on how far it
 * gets toward the goal against how close the taggers could be once it has gone a little way along it.
 */
function dodge(world: World, p: Player, goal: Point, memory: BotMemory, look = 0.45): Point {
  const route = routeAround(world, p, goal);
  const toward = { x: route.x - p.x, y: route.y - p.y };
  const length = Math.max(1e-6, Math.hypot(toward.x, toward.y));
  const base = { x: toward.x / length, y: toward.y / length };
  const level = levelOf(p);
  const speed = runTime(p, 1) > 0 ? 1 / runTime(p, 1) : BASE_SPEED;
  const enemies = world.players.filter((e) => e.team !== p.team && !e.jailed && !e.safe && distance(e, p) < 14);
  const headings = level === 0 ? 8 : level === 1 ? 16 : 24;
  let best = base;
  let bestScore = -Infinity;
  for (let k = -1; k < headings; k++) {
    const dir = k < 0 ? base : { x: Math.cos((k / headings) * Math.PI * 2), y: Math.sin((k / headings) * Math.PI * 2) };
    const ahead = { x: p.x + dir.x * speed * look, y: p.y + dir.y * speed * look };
    const half = { x: p.x + dir.x * speed * look * 0.5, y: p.y + dir.y * speed * look * 0.5 };
    if (pointBlocked(world, ahead.x, ahead.y) || pointBlocked(world, half.x, half.y)) continue;
    let danger = 0;
    // (still protected for a while: taggers matter less, but it shouldn't come out of it standing next to one)
    const shield = p.immuneT > 0.8 ? 0.45 : 1;
    for (const e of enemies) {
      if (!canTag(e, p, ahead)) continue;
      // how close it ends up to where the tagger is headed, against how much ground the tagger covers meanwhile
      const lead = e.stunT > 0 ? 0 : look * 0.5;
      const gap = Math.hypot(ahead.x - (e.x + e.vx * lead), ahead.y - (e.y + e.vy * lead));
      const radius = 3 + topSpeed(e) * look * 0.6;
      if (gap < radius) danger += (radius - gap) / radius * shield;
    }
    // (corners and sidelines are where people get pinned)
    const edge = Math.min(ahead.x, FIELD.L - ahead.x, ahead.y, FIELD.W - ahead.y);
    if (edge < 2.5) danger += (2.5 - edge) / 2.5 * 0.35;
    const progress = dir.x * base.x + dir.y * base.y;
    const keep = dir.x * memory.dir.x + dir.y * memory.dir.y;
    const score = progress - danger * (level === 0 ? 1.2 : 2.6) + keep * 0.08 + (k < 0 ? 0.02 : 0);
    if (score > bestScore) { bestScore = score; best = dir; }
  }
  return { x: p.x + best.x * 6, y: p.y + best.y * 6 };
}

function segmentDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq, 0, 1) : 0;
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

/** Running home with nothing in hand (freed, or an attack gone wrong): the nearest safe ground, dodging. */
function runHome(world: World, p: Player, memory: BotMemory): Move {
  const goal = { x: safeX(p.team) + homeward(p.team) * 2, y: clamp(p.y, 3, FIELD.W - 3) };
  return { target: goal, dodge: dodge(world, p, goal, memory), sprint: true };
}

function attackMove(world: World, p: Player, memory: BotMemory, goal: Point, reach: number, rng: () => number, rushLane?: number): Move {
  const level = levelOf(p);
  const exposed = !onOwnHalf(p, p.team);
  if (rushLane !== undefined) {
    // all in: cross on our own lane, then dodge for the goal; there are more of us than they can cover
    const entry = { x: FIELD.MID - homeward(p.team) * 2.5, y: rushLane };
    memory.committed = true;
    memory.waitT = 0;
    if (!exposed && Math.abs(p.y - rushLane) > 3) return { target: entry, sprint: false };
    return { target: goal, dodge: exposed ? dodge(world, p, goal, memory) : undefined, sprint: true };
  }
  // run straight in, or by a lane to the far side of a hedge
  const routes: Point[][] = [[goal]];
  if (!exposed) {
    for (const lane of LANES) routes.push([{ x: FIELD.MID - homeward(p.team) * 2.5, y: lane }, goal]);
  }
  let best = routes[0];
  let bestSlack = -Infinity;
  for (const route of routes) {
    const slack = pathSlack(world, p, route, reach) - (route.length > 1 ? 0.05 : 0);
    if (slack > bestSlack) { bestSlack = slack; best = route; }
  }
  // the longer it has waited (and the later in the match, behind), the less of a head start it holds out for
  const behind = world.score[p.team] < world.score[1 - p.team] && world.clock < 60 && !world.overtime;
  const patience = Math.min(0.6, memory.waitT * 0.06) + (behind ? 0.2 : 0);
  const need = MARGIN[level] - patience + (level === 0 ? (rng() - 0.5) * 0.6 : 0);
  if (memory.committed ? bestSlack > need - 0.45 : bestSlack > need) {
    memory.committed = true;
    memory.waitT = 0;
    const next = best[0];
    // in the open with someone close: dodge on the way rather than run into them
    if (exposed && bestSlack < 0.4) return { target: goal, dodge: dodge(world, p, goal, memory), sprint: true };
    return { target: next, sprint: true };
  }
  memory.committed = false;
  if (exposed && p.immuneT < 0.3) return runHome(world, p, memory);
  // wait on the safe side of the midline across from the weakest lane, getting the breath back for the run
  memory.waitT += REACT[level];
  const laneSlack = LANES.map((lane) => pathSlack(world, p, [{ x: FIELD.MID - homeward(p.team) * 2.5, y: lane }, goal], reach));
  let lane = memory.lane;
  const bestLane = LANES[laneSlack.indexOf(Math.max(...laneSlack))];
  if (!LANES.includes(lane as (typeof LANES)[number]) || laneSlack[LANES.indexOf(lane as (typeof LANES)[number])] < Math.max(...laneSlack) - 0.3) lane = bestLane;
  memory.lane = lane;
  const shuffle = Math.sin(world.time * 1.7 + p.id * 2.1) * 3;
  return { target: { x: safeX(p.team), y: clamp(lane + shuffle, 2, FIELD.W - 2) }, sprint: false, ease: true };
}

/**
 * Tag an intruder this bot happens to be near, if it is standing on its own half. An attacker waiting at the midline
 * only turns on a carrier or someone already deep in (left to it, the two lines of attackers would tag everyone who
 * ever crossed, and nobody would score).
 */
function opportunistic(world: World, p: Player, attacker = false): Move | null {
  if (!onOwnHalf(p, p.team) || p.safe) return null;
  const deep = (e: Player) => Math.abs(e.x - FIELD.MID) > 6;
  const near = world.players
    .filter((e) => e.team !== p.team && !e.jailed && !e.safe && onOwnHalf(e, p.team)
      && (!attacker || e.carrying >= 0 || deep(e)) && distance(e, p) < (e.carrying >= 0 ? 9 : 4.5))
    .sort((a, b) => distance(a, p) - distance(b, p) || a.id - b.id)[0];
  return near ? chaseMove(p, near) : null;
}

function chaseMove(p: Player, e: Player): Move {
  const at = intercept(p, e, LEAD[levelOf(p)]);
  // a chaser stops at the midline: past it, it can't tag and could be tagged
  const x = p.team === 0 ? Math.min(at.x, FIELD.MID - 0.6) : Math.max(at.x, FIELD.MID + 0.6);
  const d = distance(p, e);
  const level = levelOf(p);
  const sprint = level === 0 ? d < 6 && p.stamina > 0.4 : d < (level === 2 ? 16 : 11) || e.carrying >= 0;
  return { target: { x, y: at.y }, sprint, id: e.id };
}

function carryMove(world: World, p: Player, memory: BotMemory): Move {
  const goal = scorePoint(world, p.team, p);
  const safe = world.mode === 'classic' && onOwnHalf(p, p.team);
  if (safe) return { target: { x: goal.x + homeward(p.team) * 2, y: goal.y }, sprint: false };
  // pick the lane home furthest from the taggers, then dodge along it
  const enemies = world.players.filter((e) => e.team !== p.team && !e.jailed && !e.safe);
  const risk = (lane: number) => enemies.reduce((sum, e) => sum + 1 / (1 + segmentDistance(e, p, { x: safeX(p.team), y: lane })), 0);
  const best = LANES.reduce((a, b) => risk(b) < risk(a) ? b : a, LANES[1] as number);
  if (!LANES.includes(memory.lane as (typeof LANES)[number]) || risk(memory.lane) > risk(best) * 1.1 + 0.02) memory.lane = best;
  const via = world.mode === 'classic' && Math.abs(p.x - safeX(p.team)) > 6 ? { x: safeX(p.team), y: memory.lane } : goal;
  return { target: via, dodge: dodge(world, p, via, memory, CARRY_LOOK), sprint: false };
}

/** A teammate has the axe: get between it and whoever is closest to catching it, or clear the way ahead. */
function escortMove(world: World, p: Player, carrier: Player): Move {
  const chaser = world.players
    .filter((e) => e.team !== p.team && !e.jailed && !e.safe && canTag(e, carrier, carrier))
    .sort((a, b) => reachTime(a, carrier) - reachTime(b, carrier) || a.id - b.id)[0];
  if (chaser && distance(chaser, carrier) < 12) {
    const d = Math.max(1e-6, distance(chaser, carrier));
    const block = { x: carrier.x + (chaser.x - carrier.x) / d * 2.1, y: carrier.y + (chaser.y - carrier.y) / d * 2.1 };
    // (only from ground where it can't be tagged itself, or while the carrier still needs it)
    return { target: block, sprint: true, id: carrier.id };
  }
  const ahead = scorePoint(world, p.team, carrier);
  const dir = Math.sign(ahead.x - carrier.x) || homeward(p.team);
  return { target: { x: carrier.x + dir * 3, y: clamp(carrier.y + (p.id % 2 ? 2.5 : -2.5), 2, FIELD.W - 2) }, sprint: false, id: carrier.id, ease: true };
}

function defendMove(world: World, p: Player, plan: Plan, memory: BotMemory): Move {
  // (called back from the other half: get home in one piece first)
  if (!onOwnHalf(p, p.team) && p.immuneT < 0.3) return runHome(world, p, memory);
  const chasing = plan.chase.get(p.id);
  const e = chasing !== undefined ? world.players[chasing] : undefined;
  if (e && !e.jailed && !e.safe) return chaseMove(p, e);
  const near = opportunistic(world, p);
  if (near) return near;
  const spot = plan.guard.get(p.id) ?? pedestal(p.team);
  return { target: spot, sprint: distance(p, spot) > 8 && p.stamina > 0.7, ease: true };
}

function treeMove(world: World, p: Player, role: BotRole): Move {
  if (role === 'tree-chase') {
    const tree = world.players[world.tree];
    if (!tree) return { target: { x: FIELD.MID, y: FIELD.W / 2 }, sprint: false };
    const at = intercept(p, tree, LEAD[levelOf(p)]);
    return { target: at, sprint: distance(p, tree) < (levelOf(p) === 0 ? 5 : 14), id: tree.id };
  }
  let x = 0;
  let y = 0;
  for (const e of world.players) {
    if (e.id === p.id || e.jailed || e.stunT > 0) continue;
    const dx = p.x - (e.x + e.vx * 0.3);
    const dy = p.y - (e.y + e.vy * 0.3);
    const d = Math.max(1, Math.hypot(dx, dy));
    if (d > 15) continue;
    x += dx / d / (d * d);
    y += dy / d / (d * d);
  }
  // (and away from walls and corners, toward open grass)
  const margin = 5;
  if (p.x < margin) x += (margin - p.x) / margin * 0.08;
  if (p.x > FIELD.L - margin) x -= (p.x - FIELD.L + margin) / margin * 0.08;
  if (p.y < margin) y += (margin - p.y) / margin * 0.08;
  if (p.y > FIELD.W - margin) y -= (p.y - FIELD.W + margin) / margin * 0.08;
  if (Math.hypot(x, y) < 1e-5) { x = FIELD.MID - p.x; y = FIELD.W / 2 - p.y; }
  const length = Math.max(1e-6, Math.hypot(x, y));
  return { target: { x: clamp(p.x + x / length * 10, 2, FIELD.L - 2), y: clamp(p.y + y / length * 10, 2, FIELD.W - 2) }, sprint: true };
}

function decide(world: World, p: Player, role: BotRole, plan: Plan, memory: BotMemory, rng: () => number): Move {
  if (role === 'tree-run' || role === 'tree-chase') return treeMove(world, p, role);
  // freed by a teammate: walk home, nobody can tag us
  if (p.safe) return { target: { x: safeX(p.team) + homeward(p.team) * 3, y: p.y }, sprint: false };
  if (role === 'carry') return carryMove(world, p, memory);
  if (role === 'defend') return defendMove(world, p, plan, memory);
  const near = opportunistic(world, p, true);
  if (near) return near;
  if (role === 'jailbreak') {
    const jail = jailRect((1 - p.team) as 0 | 1);
    const door = { x: clamp(p.x, jail.x, jail.x + jail.w), y: clamp(p.y, jail.y, jail.y + jail.h) };
    return attackMove(world, p, memory, door, PLAYER_R * 0.5, rng, plan.rush?.get(p.id));
  }
  const axe = goalAxe(world, p.team);
  if (!axe) return { target: { x: FIELD.MID, y: FIELD.W / 2 }, sprint: false };
  if (axe.carrier >= 0) {
    const carrier = world.players[axe.carrier];
    if (carrier && carrier.team === p.team) return escortMove(world, p, carrier);
    // (in big game a rival has the one axe: hunt it down where we can)
    if (carrier && onOwnHalf(carrier, p.team)) return chaseMove(p, carrier);
    if (!onOwnHalf(p, p.team) && p.immuneT < 0.3) return runHome(world, p, memory);
    return { target: { x: safeX(p.team), y: clamp(carrier?.y ?? p.y, 2, FIELD.W - 2) }, sprint: false, ease: true };
  }
  return attackMove(world, p, memory, axe, PLAYER_R + PEDESTAL_R - 0.25, rng, plan.rush?.get(p.id));
}

/** The stick toward a point: round any hedge in the way, at this bot's pace. */
function seek(world: World, p: Player, memory: BotMemory, to: Point): Point {
  if (!memory.waypoint || distance(p, memory.waypoint) < 1) memory.waypoint = routeAround(world, p, to);
  const way = memory.waypoint;
  const dx = way.x - p.x;
  const dy = way.y - p.y;
  const length = Math.hypot(dx, dy);
  // (ease off when arriving, so it holds a spot rather than circling it)
  const pace = !memory.ease || memory.waypoint !== to ? 1 : length < 0.15 ? 0 : Math.min(1, length / 1.2);
  return length > 1e-6 ? { x: dx / length * pace, y: dy / length * pace } : { x: 0, y: 0 };
}

export function think(world: World, playerId: number, memory: BotMemory, rng: () => number = world.rng, dt = 1 / 60): Input {
  const player = world.players[playerId];
  if (!player || player.ai === null || player.jailed || world.phase !== 'play') return { x: 0, y: 0, sprint: false };
  const level = levelOf(player);
  memory.thinkT = Math.max(0, memory.thinkT - dt);
  if (memory.thinkT <= 0) {
    memory.thinkT = REACT[level] * (0.8 + rng() * 0.4);
    const plan = teamPlan(world, player.team);
    const role = plan.roles.get(player.id) ?? 'attack';
    if (role !== memory.role) { memory.committed = false; memory.waitT = 0; }
    memory.role = role;
    const move = decide(world, player, role, plan, memory, rng);
    memory.targetId = move.id ?? -1;
    memory.sprint = move.sprint && player.stunT <= 0;
    memory.ease = !!move.ease;
    if (move.dodge) {
      memory.aim = 'dir';
      const dx = move.dodge.x - player.x;
      const dy = move.dodge.y - player.y;
      const length = Math.max(1e-6, Math.hypot(dx, dy));
      memory.dir = { x: dx / length, y: dy / length };
      memory.target = move.target;
      memory.waypoint = null;
    } else {
      memory.aim = 'seek';
      if (distance(memory.target, move.target) > 0.5) memory.waypoint = null;
      memory.target = move.target;
    }
  }
  const stick = memory.aim === 'dir' ? memory.dir : seek(world, player, memory, memory.target);
  if (memory.aim === 'seek') memory.dir = stick;
  const scale = SPEED_SCALE[level];
  memory.last = { x: Number.isFinite(stick.x) ? stick.x * scale : 0, y: Number.isFinite(stick.y) ? stick.y * scale : 0, sprint: memory.sprint };
  return memory.last;
}
