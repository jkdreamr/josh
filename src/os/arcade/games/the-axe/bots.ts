import { FIELD, PLAYER_R, halfOf, jailRect, obstaclesFor, type Input, type Player, type World } from './logic.ts';

export type BotRole = 'attack' | 'defend' | 'jailbreak' | 'carry' | 'tree-run' | 'tree-chase';
export type BotMemory = {
  role: BotRole;
  thinkT: number;
  target: { x: number; y: number };
  jukePhase: number;
  jukeSide: number;
  sprintHold: number;
  last: Input;
  targetId: number;
  waypoint: { x: number; y: number } | null;
  waypointTarget: { x: number; y: number } | null;
  carryLane: number;
  carryLaneReached: boolean;
};

export function makeMemory(): BotMemory {
  return {
    role: 'attack', thinkT: 0, target: { x: 30, y: 17 }, jukePhase: 0, jukeSide: 1,
    sprintHold: 0, last: { x: 0, y: 0, sprint: false }, targetId: -1, waypoint: null, waypointTarget: null,
    carryLane: 17, carryLaneReached: false,
  };
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const homeX = (team: 0 | 1) => team === 0 ? 3 : 57;
const ownHalfGoal = (team: 0 | 1) => team === 0 ? 25.5 : 34.5;
const enemyEnd = (team: 0 | 1) => team === 0 ? { x: 57, y: 17 } : { x: 3, y: 17 };
const LANES = [6, 17, 28] as const;

function segmentDistance(point: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq)) : 0;
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

function saferCarrierLane(world: World, player: Player, previous: number) {
  const goal = homeX(player.team);
  const enemies = world.players.filter((p) => p.team !== player.team && !p.jailed && !p.safe);
  const risk = (lane: number) => enemies.reduce((sum, enemy) => (
    sum + 1 / (1 + segmentDistance(enemy, player, { x: goal, y: lane }))
  ), 0);
  let best: number = LANES[0];
  for (const lane of LANES.slice(1)) if (risk(lane) < risk(best)) best = lane;
  const oldLane = LANES.includes(previous as (typeof LANES)[number]) ? previous : 17;
  return risk(oldLane) <= risk(best) * 1.08 + 0.02 ? oldLane : best;
}

function closestPlayer(players: Player[], from: Player, predicate: (p: Player) => boolean) {
  return players.filter((p) => p.id !== from.id && predicate(p))
    .sort((a, b) => distance(from, a) - distance(from, b) || a.id - b.id)[0];
}

export function assignRoles(world: World, teamFilter?: 0 | 1): Map<number, BotRole> {
  const roles = new Map<number, BotRole>();
  if (world.mode === 'tree') {
    for (const p of world.players) {
      if (p.ai !== null && (teamFilter === undefined || p.team === teamFilter)) roles.set(p.id, p.id === world.tree ? 'tree-run' : 'tree-chase');
    }
    return roles;
  }
  for (const player of world.players) {
    if (player.ai !== null && player.carrying >= 0 && (teamFilter === undefined || player.team === teamFilter)) roles.set(player.id, 'carry');
  }
  for (const team of [0, 1] as const) {
    if (teamFilter !== undefined && team !== teamFilter) continue;
    const jailedCount = world.players.filter((p) => p.team === team && p.jailed).length;
    const freeBots = world.players.filter((p) => p.team === team && p.ai !== null && !p.jailed && p.carrying < 0);
    if (jailedCount && freeBots.length) {
      const jail = jailRect((1 - team) as 0 | 1);
      const rescuer = freeBots.slice().sort((a, b) => {
        const da = distance(a, { x: jail.x + jail.w / 2, y: jail.y + jail.h / 2 });
        const db = distance(b, { x: jail.x + jail.w / 2, y: jail.y + jail.h / 2 });
        return da - db || a.id - b.id;
      })[0];
      roles.set(rescuer.id, 'jailbreak');
    }
    const eligible = freeBots.filter((p) => !roles.has(p.id));
    const freeCount = world.players.filter((p) => p.team === team && !p.jailed).length;
    const enemyCarrier = world.players.some((p) => p.team !== team && p.carrying >= 0);
    let defenders = Math.round(freeCount * 0.4);
    if (freeCount === 1) defenders = enemyCarrier ? 1 : 0;
    const pedestal = { x: homeX(team), y: 17 };
    eligible.sort((a, b) => distance(a, pedestal) - distance(b, pedestal) || a.id - b.id);
    for (const p of eligible.slice(0, Math.min(defenders, eligible.length))) roles.set(p.id, 'defend');
    for (const p of eligible) if (!roles.has(p.id)) roles.set(p.id, 'attack');
  }
  return roles;
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

function lineBlocked(world: World, from: { x: number; y: number }, to: { x: number; y: number }) {
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

function nearestWalkable(world: World, x: number, y: number) {
  let best: { x: number; y: number; id: number } | null = null;
  for (let radius = 0; radius <= 5 && !best; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const px = Math.max(1, Math.min(59, Math.round(x) + dx));
      const py = Math.max(1, Math.min(33, Math.round(y) + dy));
      if (pointBlocked(world, px, py)) continue;
      best = { x: px, y: py, id: py * 60 + px };
      break;
    }
  }
  return best;
}

function routeAround(world: World, from: Player, target: { x: number; y: number }) {
  if (!lineBlocked(world, from, target)) return target;
  const start = nearestWalkable(world, from.x, from.y);
  const goal = nearestWalkable(world, target.x, target.y);
  if (!start || !goal) return target;
  const total = 60 * 35;
  const costs = new Float32Array(total);
  costs.fill(Infinity);
  const previous = new Int32Array(total);
  previous.fill(-1);
  const closed = new Uint8Array(total);
  costs[start.id] = 0;
  const heap: HeapNode[] = [];
  heapPush(heap, { id: start.id, cost: distance(start, goal) });
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  let found = false;
  while (heap.length) {
    const current = heapPop(heap)!;
    if (closed[current.id]) continue;
    if (current.id === goal.id) { found = true; break; }
    closed[current.id] = 1;
    const x = current.id % 60;
    const y = Math.floor(current.id / 60);
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || nx > 59 || ny < 1 || ny > 33 || pointBlocked(world, nx, ny)) continue;
      const next = ny * 60 + nx;
      if (closed[next]) continue;
      const cost = costs[current.id] + (dx && dy ? Math.SQRT2 : 1);
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      previous[next] = current.id;
      heapPush(heap, { id: next, cost: cost + distance({ x: nx, y: ny }, goal) });
    }
  }
  if (!found) return target;
  const path: number[] = [];
  for (let node = goal.id; node !== start.id && node >= 0; node = previous[node]) path.push(node);
  let step = path[0];
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (distance(from, { x: node % 60, y: Math.floor(node / 60) }) > 4) {
      step = node;
      break;
    }
  }
  return step === undefined ? target : { x: step % 60, y: Math.floor(step / 60) };
}

function targetFor(world: World, player: Player, role: BotRole, memory: BotMemory) {
  const team = player.team;
  const prediction = player.ai === 0 ? 0 : player.ai === 1 ? 0.5 : 1;
  if (player.safe) return { target: { x: ownHalfGoal(team), y: player.y }, id: -1 };
  if (role === 'jailbreak') {
    const jail = jailRect((1 - team) as 0 | 1);
    return { target: { x: jail.x + jail.w / 2, y: jail.y + jail.h / 2 }, id: -1 };
  }
  if (role === 'carry') {
    if (world.mode === 'big') return { target: enemyEnd(team), id: -1 };
    memory.carryLane = saferCarrierLane(world, player, memory.carryLane);
    const lanePoint = { x: homeX(team), y: memory.carryLane };
    if (!memory.carryLaneReached && distance(player, lanePoint) < 2.5) memory.carryLaneReached = true;
    return { target: memory.carryLaneReached ? { x: homeX(team), y: 17 } : lanePoint, id: -1 };
  }
  if (role === 'defend') {
    const roles = assignRoles(world, team);
    const defenders = world.players.filter((p) => p.ai !== null && p.team === team && !p.jailed && !p.safe && roles.get(p.id) === 'defend');
    const enemyInOwnHalf = (p: Player) => p.team !== team && !p.jailed && !p.safe
      && (team === 0 ? p.x < FIELD.MID : p.x >= FIELD.MID);
    const carriers = world.players.filter((p) => enemyInOwnHalf(p) && p.carrying >= 0);
    const threats = carriers.length ? carriers : world.players.filter(enemyInOwnHalf);
    let chaserId = -1;
    let assignedThreat: Player | undefined;
    let closestPair = Infinity;
    for (const defender of defenders) {
      for (const threat of threats) {
        const d = distance(defender, threat);
        if (d < closestPair || (d === closestPair && defender.id < chaserId)) {
          closestPair = d;
          chaserId = defender.id;
          assignedThreat = threat;
        }
      }
    }
    const localThreat = closestPlayer(threats, player, () => true);
    if (player.id === chaserId && assignedThreat) {
      const lag = player.ai === 0 ? 0.25 : player.ai === 1 ? 0.12 : 0;
      return { target: { x: assignedThreat.x - assignedThreat.vx * lag, y: assignedThreat.y - assignedThreat.vy * lag }, id: assignedThreat.id };
    }
    if (localThreat && distance(player, localThreat) <= 4) return { target: { x: localThreat.x, y: localThreat.y }, id: localThreat.id };
    const index = Math.max(0, defenders.findIndex((p) => p.id === player.id));
    const guardY = 6 + (index + 1) * (FIELD.W - 12) / (defenders.length + 1);
    return {
      target: { x: homeX(team) + (team === 0 ? 8 : -8), y: guardY },
      id: -1,
    };
  }
  if (role === 'tree-run') {
    const enemies = world.players.filter((p) => p.id !== player.id && !p.jailed && !p.safe);
    let x = 0;
    let y = 0;
    for (const enemy of enemies) {
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (d > 14) continue;
      const weight = 1 / (d * d);
      x += dx / d * weight;
      y += dy / d * weight;
    }
    if (player.x < 4) x += (4 - player.x) / 4;
    if (player.x > FIELD.L - 4) x -= (player.x - FIELD.L + 4) / 4;
    if (player.y < 4) y += (4 - player.y) / 4;
    if (player.y > FIELD.W - 4) y -= (player.y - FIELD.W + 4) / 4;
    if (Math.hypot(x, y) < 1e-4) x = team === 0 ? 1 : -1;
    return { target: { x: Math.max(2, Math.min(58, player.x + x * 12)), y: Math.max(2, Math.min(32, player.y + y * 12)) }, id: -1 };
  }
  if (role === 'tree-chase') {
    const tree = world.players[world.tree];
    if (!tree) return { target: { x: 30, y: 17 }, id: -1 };
    const lead = prediction;
    return { target: { x: tree.x + tree.vx * lead, y: tree.y + tree.vy * lead }, id: tree.id };
  }
  const relevantAxe = world.mode === 'big' ? world.axes[0] : world.axes.find((axe) => axe.owner !== team);
  if (player.carrying >= 0) {
    return { target: world.mode === 'big' ? enemyEnd(team) : { x: homeX(team), y: 17 }, id: -1 };
  }
  if (relevantAxe) {
    if (relevantAxe.carrier >= 0) {
      const carrier = world.players[relevantAxe.carrier];
      if (carrier?.team === team) {
        const enemy = closestPlayer(world.players, carrier, (p) => p.team !== team && !p.jailed && !p.safe
          && distance(carrier, p) <= 10);
        if (enemy) {
          const d = Math.max(1e-6, distance(carrier, enemy));
          return { target: { x: carrier.x + (enemy.x - carrier.x) / d * 1.5, y: carrier.y + (enemy.y - carrier.y) / d * 1.5 }, id: carrier.id };
        }
        const direction = team === 0 ? 1 : -1;
        return { target: { x: carrier.x + direction * 1.5, y: carrier.y + (player.id % 2 ? 1 : -1) }, id: carrier.id };
      }
      return { target: { x: relevantAxe.x + (carrier?.vx ?? 0) * prediction, y: relevantAxe.y + (carrier?.vy ?? 0) * prediction }, id: carrier?.id ?? -1 };
    }
    const roles = assignRoles(world, team);
    const attackers = world.players.filter((p) => p.ai !== null && p.team === team && !p.jailed
      && p.carrying < 0 && roles.get(p.id) === 'attack');
    const seeker = attackers.slice().sort((a, b) => distance(a, relevantAxe) - distance(b, relevantAxe) || a.id - b.id)[0];
    if (seeker && player.id !== seeker.id) {
      const lane = LANES[Math.max(0, attackers.findIndex((p) => p.id === player.id)) % LANES.length];
      return { target: { x: FIELD.MID + (team === 0 ? 5 : -5), y: lane }, id: -1 };
    }
    return { target: { x: relevantAxe.x, y: relevantAxe.y }, id: -1 };
  }
  return { target: { x: FIELD.MID, y: FIELD.W / 2 }, id: -1 };
}

function steer(world: World, player: Player, role: BotRole, target: { x: number; y: number }, targetId: number, memory: BotMemory) {
  const level = player.ai ?? 1;
  const route = routeAround(world, player, target);
  let dx = route.x - player.x;
  let dy = route.y - player.y;
  const avoidRadius = level === 0 ? 4 : level === 1 ? 6 : 8;
  for (const other of world.players) {
    if (other.id === player.id || other.jailed || other.safe || other.id === targetId) continue;
    const ex = player.x - other.x;
    const ey = player.y - other.y;
    const d = Math.hypot(ex, ey);
    const shouldAvoid = other.team !== player.team && (role === 'carry' || halfOf(player.x) !== player.team);
    if (!shouldAvoid || d > avoidRadius || d < 1e-6) continue;
    const weight = (avoidRadius - d) / avoidRadius * (level === 0 ? 0.12 : level === 1 ? 0.3 : 0.5) / Math.max(1, d * 0.35);
    dx += ex / d * weight * 2;
    dy += ey / d * weight * 2;
  }
  if (level > 0 && distance(player, target) < avoidRadius) {
    const amplitude = level === 1 ? 0.5 : 1;
    const length = Math.max(1e-6, Math.hypot(dx, dy));
    const wobble = Math.sin(memory.jukePhase) * memory.jukeSide * amplitude;
    dx += (-dy / length) * wobble;
    dy += (dx / length) * wobble;
  }
  if (role === 'carry') {
    const threat = closestPlayer(world.players, player, (p) => p.team !== player.team && !p.jailed && !p.safe
      && distance(player, p) < 3);
    const length = Math.max(1e-6, Math.hypot(dx, dy));
    if (threat) {
      const side = memory.jukeSide * 0.85;
      const sideX = -dy / length;
      const sideY = dx / length;
      dx += sideX * side;
      dy += sideY * side;
    }
  }
  const length = Math.hypot(dx, dy);
  if (length > 0) { dx /= length; dy /= length; }
  const d = distance(player, target);
  const canChase = role === 'attack' || role === 'defend' || role === 'jailbreak' || role === 'tree-chase';
  const canFlee = role === 'tree-run';
  const sprint = player.stamina > (level === 0 ? 0.55 : level === 1 ? 0.3 : 0.12)
    && player.carrying < 0 && !player.safe && player.stunT <= 0
    && (level === 0 ? canChase && d < 5 : level === 1 ? canChase || canFlee : (canChase || canFlee) && d > 3);
  const speedScale = level === 0 ? 0.78 : level === 1 ? 0.92 : 1;
  return { x: Number.isFinite(dx) ? dx * speedScale : 0, y: Number.isFinite(dy) ? dy * speedScale : 0, sprint };
}

export function think(world: World, playerId: number, memory: BotMemory, rng: () => number = world.rng, dt = 1 / 60): Input {
  const player = world.players[playerId];
  if (!player || player.ai === null || player.jailed || world.phase === 'over') return { x: 0, y: 0, sprint: false };
  if (world.phase !== 'play') return { x: 0, y: 0, sprint: false };
  memory.thinkT = Math.max(0, memory.thinkT - dt);
  memory.jukePhase += dt * (player.ai === 0 ? 1.8 : 3.5);
  if (memory.thinkT > 0) return memory.last;
  memory.thinkT = player.ai === 0 ? 0.38 : player.ai === 1 ? 0.2 : 0.08;
  const role = assignRoles(world, player.team).get(player.id) ?? 'attack';
  memory.role = role;
  if (role !== 'carry') memory.carryLaneReached = false;
  const { target, id } = targetFor(world, player, role, memory);
  const waypointDistance = memory.waypoint ? distance(player, memory.waypoint) : Infinity;
  if (id !== memory.targetId || !memory.waypointTarget
    || distance(target, memory.waypointTarget) > (player.ai === 2 ? 0.9 : 1.8)
    || waypointDistance > 2.2 || (waypointDistance < 1.2 && distance(player, target) > 2.2)) {
    memory.targetId = id;
    memory.target = { ...target };
    memory.waypointTarget = { ...target };
    memory.waypoint = routeAround(world, player, target);
  }
  if (rng() < 0.5) memory.jukeSide *= -1;
  memory.last = steer(world, player, role, memory.waypoint ?? target, id, memory);
  return memory.last;
}
