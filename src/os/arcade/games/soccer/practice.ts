import { computeAI, type Level } from './ai.ts';
import { createWorld, distance, FIELD, nearestCarrier, rng, stepWorld, TEAM_SIZE, type Command, type Player, type Point, type World } from './logic.ts';

export const PRACTICE_MODE = 'practice';
export type DrillId = 'free' | 'passing' | 'finishing' | 'slalom' | 'defending';
export type Drill = { id: DrillId; name: string; blurb: string; unit: string; lowerIsBetter?: boolean };
export const DRILLS: readonly Drill[] = [
  { id: 'free', name: 'Free play', blurb: 'three teammates and a keeper, no clock', unit: 'goals' },
  { id: 'passing', name: 'Passing gates', blurb: 'pass through the lit gate, 45 seconds', unit: 'gates' },
  { id: 'finishing', name: 'Finishing', blurb: 'ten shots: power, placement, finesse', unit: 'pts' },
  { id: 'slalom', name: 'Dribble slalom', blurb: 'weave the cones, sprint home, three runs', unit: 's', lowerIsBetter: true },
  { id: 'defending', name: 'Defending', blurb: 'jockey and tackle five dribblers', unit: 'won' },
];
export const drillById = (id: DrillId) => DRILLS.find((drill) => drill.id === id)!;

export type MarkerColor = 'lit' | 'idle' | 'done' | 'warn';
export type PracticeMarker = { kind: 'cone' | 'post' | 'disc' | 'line'; x: number; z: number; x2?: number; z2?: number; color: MarkerColor };
export type PracticeEvent = 'goal' | 'good' | 'bad' | 'done';

type Gate = { a: Point; b: Point; target: number; from: number; crossed: boolean };
type Shot = { taken: boolean; timer: number; action: string; power: number; still: number };
type Run = { started: boolean; time: number; next: number; penalty: number; skills: number; lost: number; lastAction: string; skillCones: number[] };
type Rep = { timer: number; won: number; cut: number; decideAt: number };

export type PracticeState = {
  drill: DrillId;
  phase: 'running' | 'done';
  time: number;
  limit: number;
  score: number;
  best: number | null;
  newBest: boolean;
  attempt: number;
  attempts: number;
  prompt: string;
  hint: string;
  markers: PracticeMarker[];
  events: PracticeEvent[];
  active: number[];
  stations: Record<number, Point>;
  support: Record<number, number>;
  supportAt: number;
  awayHold: number;
  loose: number;
  lastCarrier: number;
  gate: Gate | null;
  shot: Shot;
  run: Run;
  runs: number[];
  rep: Rep;
};

const HOME_GK = 0;
const HUMAN = 6;
const AWAY_GK = TEAM_SIZE;
const DRIBBLER = TEAM_SIZE + 9;
const GOAL_X = FIELD.length / 2;
const SIDE = FIELD.width / 2 - 0.3;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const ROSTER: Record<DrillId, number[]> = {
  free: [HUMAN, 8, 9, 10, AWAY_GK],
  passing: [HUMAN, 9, 10, AWAY_GK],
  finishing: [HUMAN, AWAY_GK],
  slalom: [HUMAN, AWAY_GK],
  defending: [HUMAN, DRIBBLER, AWAY_GK],
};
const LIMIT: Record<DrillId, number> = { free: 0, passing: 45, finishing: 0, slalom: 0, defending: 0 };
const ATTEMPTS: Record<DrillId, number> = { free: 0, passing: 0, finishing: 10, slalom: 3, defending: 5 };

export const SHOT_SPOTS: readonly Point[] = [
  { x: 34, z: 0 }, { x: 32, z: -9 }, { x: 32, z: 9 }, { x: 36, z: -4 }, { x: 33, z: 6 },
  { x: 30, z: -12 }, { x: 37, z: 5 }, { x: 33, z: -3 }, { x: 35, z: 10 }, { x: 31, z: -7 },
];
const SHOT_KIND = ['power', 'power', 'power', 'placed', 'placed', 'placed', 'finesse', 'finesse', 'finesse', 'finesse'] as const;
export const SLALOM_CONES: readonly Point[] = [0, 6, 12, 18, 24].map((x) => ({ x, z: 0 }));
const SLALOM_START = { x: -9, z: 0 };
const SLALOM_FINISH = 33;
const coneSide = (index: number) => index % 2 === 0 ? -1 : 1;
const DEFEND_LINE = -30;
const DEFEND_STARTS = [0, -6, 6, -3, 4];
const STATION_POOL: readonly Point[] = [
  { x: -8, z: -10 }, { x: -8, z: 10 }, { x: 2, z: -17 }, { x: 2, z: 17 }, { x: 10, z: -4 },
  { x: 10, z: 7 }, { x: 18, z: -13 }, { x: 18, z: 13 }, { x: 0, z: 0 }, { x: 22, z: 0 }, { x: -14, z: 0 },
];
const SUPPORT_SPOTS: readonly Point[] = [
  { x: 13, z: -12 }, { x: 13, z: 12 }, { x: 22, z: 0 }, { x: -8, z: -9 }, { x: -8, z: 9 }, { x: 6, z: -20 }, { x: 6, z: 20 }, { x: 20, z: -18 }, { x: 20, z: 18 },
];

export function readBest(drill: DrillId): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(`soccer:practice-best:${drill}`);
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

export function better(drill: DrillId, score: number, best: number | null) {
  if (drill === 'free') return false;
  if (best === null) return drill === 'slalom' ? score > 0 : score > 0;
  return drillById(drill).lowerIsBetter ? score < best : score > best;
}

function saveBest(state: PracticeState) {
  if (!better(state.drill, state.score, state.best)) return;
  state.best = state.score;
  state.newBest = true;
  try { globalThis.localStorage?.setItem(`soccer:practice-best:${state.drill}`, String(state.score)); } catch {}
}

export function createPracticeState(drill: DrillId = 'free', best = readBest(drill)): PracticeState {
  return {
    drill, phase: 'running', time: 0, limit: LIMIT[drill], score: 0, best, newBest: false,
    attempt: 0, attempts: ATTEMPTS[drill], prompt: '', hint: '', markers: [], events: [], active: [...ROSTER[drill]],
    stations: {}, support: {}, supportAt: -1, awayHold: 0, loose: 0, lastCarrier: HUMAN, gate: null,
    shot: { taken: false, timer: 0, action: '', power: 0, still: 0 },
    run: { started: false, time: 0, next: 0, penalty: 0, skills: 0, lost: 0, lastAction: 'idle', skillCones: [] },
    runs: [], rep: { timer: 0, won: 0, cut: 1, decideAt: 0 },
  };
}

export function createPracticeWorld(seed: number, state: PracticeState) {
  const world = createWorld(seed, 360, 1);
  world.practice = true;
  setupDrill(state, world);
  return world;
}

const isActive = (state: PracticeState, id: number) => state.active.includes(id);

function benchSpot(state: PracticeState, id: number): Point {
  const benched = Array.from({ length: TEAM_SIZE * 2 }, (_, i) => i).filter((i) => !isActive(state, i));
  return { x: -48 + benched.indexOf(id) * 2.2, z: -SIDE };
}

function settle(player: Player, at: Point, facing: number) {
  player.x = clamp(at.x, -GOAL_X + 0.3, GOAL_X - 0.3); player.z = clamp(at.z, -SIDE, SIDE);
  player.vx = 0; player.vz = 0; player.facing = facing;
  player.action = 'idle'; player.slide = null; player.buffer = null; player.cooldown = 0; player.touchCd = 0; player.planting = false;
}

function pinBench(state: PracticeState, world: World) {
  for (const player of world.players) {
    if (isActive(state, player.id)) continue;
    if (player.human) { player.human = false; player.controlled = false; }
    settle(player, benchSpot(state, player.id), 0);
  }
}

const faceTo = (from: Point, to: Point) => Math.atan2(to.x - from.x, to.z - from.z);

function clearBall(world: World, at: Point, carrier?: Player) {
  const facing = carrier?.facing ?? 0;
  const x = carrier ? carrier.x + Math.sin(facing) * 0.45 : at.x;
  const z = carrier ? carrier.z + Math.cos(facing) * 0.45 : at.z;
  world.ball = { x, y: 0.11, z, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  world.phase = 'live'; world.restart = null; world.passTarget = null; world.passControl = false; world.passPoint = null;
  world.carrierId = null; world.lastToucherId = carrier?.id ?? null; world.lastTouch = carrier?.team ?? 0; world.kickEvent = null;
}

function giveControl(world: World, to: Player) {
  if (to.human) return;
  const humans = world.players.filter((p) => p.team === to.team && p.human);
  const from = humans.sort((a, b) => distance(a, to) - distance(b, to))[0];
  if (from) { from.human = false; from.controlled = false; }
  to.human = true; to.controlled = true;
  if (!from || world.controlled[to.team] === from.id) world.controlled[to.team] = to.id;
}

function ensureControl(state: PracticeState, world: World) {
  pinBench(state, world);
  const outfield = world.players.filter((p) => p.team === 0 && p.slot !== 'GK' && isActive(state, p.id));
  if (!world.players.some((p) => p.team === 0 && p.human)) {
    const pick = outfield.sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
    if (pick) { pick.human = true; pick.controlled = true; world.controlled[0] = pick.id; }
  }
  const controlled = world.players[world.controlled[0]];
  if (!controlled?.human) {
    const human = world.players.find((p) => p.team === 0 && p.human);
    if (human) world.controlled[0] = human.id;
  }
  const carrier = nearestCarrier(world);
  if (carrier && carrier.team === 0 && !carrier.human && carrier.slot !== 'GK' && isActive(state, carrier.id)) giveControl(world, carrier);
  if (!isActive(state, world.controlled[1])) world.controlled[1] = AWAY_GK;
}

const humanPlayer = (world: World) => world.players[world.controlled[0]]!;

function resetKeeper(world: World) {
  settle(world.players[AWAY_GK]!, { x: GOAL_X - 1.6, z: 0 }, -Math.PI / 2);
}

function nextGate(state: PracticeState, world: World, fromId: number) {
  const options = state.active.filter((id) => id !== fromId && id !== AWAY_GK);
  const target = options[Math.floor(rng(world) * options.length)] ?? options[0]!;
  const from = world.players[fromId]!;
  const to = world.players[target]!;
  const point = state.stations[target] ?? to;
  const origin = state.stations[fromId] ?? from;
  const mid = { x: (origin.x + point.x) / 2, z: (origin.z + point.z) / 2 };
  const length = distance(origin, point) || 1;
  const normal = { x: -(point.z - origin.z) / length, z: (point.x - origin.x) / length };
  state.gate = { a: { x: mid.x + normal.x * 1.6, z: mid.z + normal.z * 1.6 }, b: { x: mid.x - normal.x * 1.6, z: mid.z - normal.z * 1.6 }, target, from: fromId, crossed: false };
}

function freeStation(state: PracticeState, world: World, id: number) {
  const taken = Object.entries(state.stations).filter(([key]) => Number(key) !== id).map(([, point]) => point);
  const choices = STATION_POOL.filter((spot) => taken.every((point) => distance(point, spot) > 11));
  state.stations[id] = choices[Math.floor(rng(world) * choices.length)] ?? STATION_POOL[0]!;
}

function respawn(state: PracticeState, world: World) {
  state.loose = 0; state.awayHold = 0;
  const human = humanPlayer(world);
  if (state.drill === 'free') {
    const at = { x: clamp(human.x, -40, GOAL_X - 12), z: clamp(human.z, -SIDE + 4, SIDE - 4) };
    settle(human, at, faceTo(at, { x: GOAL_X, z: 0 }));
    resetKeeper(world);
    clearBall(world, at, human);
  } else if (state.drill === 'passing') {
    const carrier = world.players[state.lastCarrier]!;
    if (!carrier.human) giveControl(world, carrier);
    const at = state.stations[carrier.id] ?? carrier;
    const target = state.gate ? world.players[state.gate.target]! : { x: GOAL_X, z: 0 };
    settle(carrier, at, faceTo(at, target));
    clearBall(world, at, carrier);
  } else if (state.drill === 'finishing') {
    const spot = SHOT_SPOTS[state.attempt % SHOT_SPOTS.length]!;
    settle(human, spot, faceTo(spot, { x: GOAL_X, z: 0 }));
    resetKeeper(world);
    clearBall(world, spot, human);
    state.shot = { taken: false, timer: 0, action: '', power: 0, still: 0 };
  } else if (state.drill === 'slalom') {
    settle(human, SLALOM_START, Math.PI / 2);
    clearBall(world, SLALOM_START, human);
    state.run = { started: false, time: 0, next: 0, penalty: 0, skills: 0, lost: 0, lastAction: 'idle', skillCones: [] };
  } else {
    const dribbler = world.players[DRIBBLER]!;
    const start = { x: 10, z: DEFEND_STARTS[state.attempt % DEFEND_STARTS.length]! };
    settle(dribbler, start, -Math.PI / 2);
    settle(human, { x: -8, z: 0 }, Math.PI / 2);
    clearBall(world, start, dribbler);
    state.rep = { timer: 0, won: 0, cut: rng(world) < 0.5 ? -1 : 1, decideAt: 0.8 };
  }
}

export function setupDrill(state: PracticeState, world: World) {
  world.practice = true;
  Object.assign(state, createPracticeState(state.drill, state.best), { events: [] });
  world.phase = 'live'; world.restart = null; world.event = ''; world.eventTime = 0;
  world.halfLength = 360; world.clock = 360; world.half = 1; world.endsSwapped = false; world.score = [0, 0];
  world.switchAt = [-1, -1]; world.switchWait = [0, 0]; world.dribbleAt = [-1, -1];
  const humans = world.players.filter((p) => p.human).map((p) => p.id);
  for (const player of world.players) {
    const human = isActive(state, player.id) && player.team === 0 && (humans.includes(player.id) || (player.id === HUMAN && !humans.some((id) => isActive(state, id))));
    player.human = human; player.controlled = human; player.stamina = 1;
  }
  world.controlled = [HUMAN, state.drill === 'defending' ? DRIBBLER : AWAY_GK];
  const human = world.players[HUMAN]!;
  if (!human.human) giveControl(world, human);
  world.controlled[0] = HUMAN;
  pinBench(state, world);
  resetKeeper(world);
  if (state.drill === 'free') {
    settle(human, { x: 12, z: 0 }, Math.PI / 2);
    settle(world.players[8]!, { x: 25, z: -14 }, Math.PI / 2);
    settle(world.players[9]!, { x: 34, z: 2 }, Math.PI / 2);
    settle(world.players[10]!, { x: 25, z: 14 }, Math.PI / 2);
  } else if (state.drill === 'passing') {
    state.stations = { [HUMAN]: { x: -6, z: 0 }, 9: { x: 10, z: -9 }, 10: { x: 10, z: 10 } };
    for (const id of [HUMAN, 9, 10]) settle(world.players[id]!, state.stations[id]!, Math.PI / 2);
    state.lastCarrier = HUMAN;
    nextGate(state, world, HUMAN);
  }
  respawn(state, world);
  updatePrompt(state);
  state.markers = markersFor(state, world);
}

export function selectDrill(state: PracticeState, world: World, drill: DrillId) {
  state.drill = drill;
  state.best = readBest(drill);
  setupDrill(state, world);
}

function laneClearance(world: World, state: PracticeState, from: Point, to: Point) {
  let clear = Infinity;
  for (const id of state.active) {
    const p = world.players[id]!;
    if (p.team !== 1) continue;
    const dx = to.x - from.x, dz = to.z - from.z;
    const t = clamp(((p.x - from.x) * dx + (p.z - from.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    clear = Math.min(clear, Math.hypot(p.x - (from.x + dx * t), p.z - (from.z + dz * t)));
  }
  return clear;
}

export function supportTarget(world: World, state: PracticeState, id: number): Point {
  const slot = state.support[id];
  const anchor = nearestCarrier(world) ?? world.ball;
  const offset = SUPPORT_SPOTS[slot ?? 0]!;
  const ahead = clamp(anchor.x + offset.x, -GOAL_X + 6, GOAL_X - 6);
  return { x: ahead, z: clamp(anchor.z + offset.z, -SIDE + 2, SIDE - 2) };
}

function assignSupport(state: PracticeState, world: World) {
  const carrier = nearestCarrier(world);
  const anchor = carrier ?? world.ball;
  const mates = state.active.filter((id) => id !== AWAY_GK && world.players[id]!.team === 0 && id !== carrier?.id && world.players[id]!.slot !== 'GK');
  const claimed: Point[] = [];
  const next: Record<number, number> = {};
  for (const id of mates) {
    const mate = world.players[id]!;
    let bestSlot = 0, bestScore = Infinity;
    SUPPORT_SPOTS.forEach((offset, slot) => {
      if (Object.values(next).includes(slot)) return;
      const spot = { x: clamp(anchor.x + offset.x, -GOAL_X + 6, GOAL_X - 6), z: clamp(anchor.z + offset.z, -SIDE + 2, SIDE - 2) };
      const lane = laneClearance(world, state, anchor, spot);
      const crowd = claimed.reduce((sum, point) => sum + Math.max(0, 9 - distance(point, spot)) * 2, 0);
      const range = distance(anchor, spot);
      const score = distance(mate, spot) * 0.18 + (lane < 2.5 ? 14 : 0) + crowd - offset.x * 0.08
        + (range < 7 ? 10 : 0) + (state.support[id] === slot ? -2.5 : 0);
      if (score < bestScore) { bestScore = score; bestSlot = slot; }
    });
    next[id] = bestSlot;
    claimed.push(supportTarget(world, { ...state, support: next }, id));
  }
  state.support = next;
}

function steer(player: Player, target: Point, sprintGap = 8): Command {
  const dx = target.x - player.x, dz = target.z - player.z;
  const gap = Math.hypot(dx, dz);
  if (gap < 0.4) return { move: { x: 0, z: 0 } };
  return { move: { x: dx / Math.max(1.4, gap), z: dz / Math.max(1.4, gap) }, sprint: gap > sprintGap };
}

function dribblerCommand(state: PracticeState, world: World): Command {
  const dribbler = world.players[DRIBBLER]!;
  const defender = humanPlayer(world);
  const carrier = nearestCarrier(world);
  if (carrier?.id !== DRIBBLER) {
    if (carrier || distance(dribbler, world.ball) > 6) return { move: { x: 0, z: 0 } };
    return steer(dribbler, world.ball, 2);
  }
  const rep = state.rep;
  if (rep.timer >= rep.decideAt) {
    if (rng(world) < 0.45) rep.cut = -rep.cut;
    rep.decideAt = rep.timer + 0.9 + rng(world) * 0.8;
  }
  const ahead = defender.x < dribbler.x + 0.5;
  const gap = distance(defender, dribbler);
  let targetZ = dribbler.z * 0.6;
  if (ahead && gap < 8) targetZ = clamp(defender.z + rep.cut * 6, -14, 14);
  const beside = ahead && Math.abs(defender.x - dribbler.x) < 1.6 && Math.abs(defender.z - dribbler.z) > 1.2;
  const move = { x: -1, z: clamp((targetZ - dribbler.z) / 4, -1.2, 1.2) };
  const length = Math.hypot(move.x, move.z);
  return { move: { x: move.x / length, z: move.z / length }, sprint: !ahead || beside };
}

export function practiceAI(world: World, state: PracticeState, level: Level, dt: number, tick: number, scratch = new Map<number, Command>()) {
  const commands = new Map<number, Command>();
  if (state.phase === 'done') return commands;
  const keeper = computeAI(world, level, dt, tick, 1, scratch).get(AWAY_GK);
  if (keeper) {
    if (state.drill === 'finishing' && level === 'easy') {
      world.players[AWAY_GK]!.action = 'ready';
      commands.set(AWAY_GK, { move: { x: 0, z: 0 } });
    } else commands.set(AWAY_GK, { ...keeper });
  }
  if (state.drill === 'free') {
    if (tick - state.supportAt >= 30 || state.supportAt < 0) { assignSupport(state, world); state.supportAt = tick; }
    for (const id of state.active) {
      const mate = world.players[id]!;
      if (mate.team !== 0 || mate.human || id === world.passTarget) continue;
      commands.set(id, steer(mate, supportTarget(world, state, id)));
    }
  } else if (state.drill === 'passing') {
    for (const id of state.active) {
      const mate = world.players[id]!;
      if (mate.team !== 0 || mate.human || id === world.passTarget) continue;
      const station = state.stations[id];
      if (station) {
        const command = steer(mate, station, 5);
        if (!command.move.x && !command.move.z) mate.facing = faceTo(mate, world.ball);
        commands.set(id, command);
      }
    }
  } else if (state.drill === 'defending') {
    commands.set(DRIBBLER, dribblerCommand(state, world));
  }
  return commands;
}

function sanitize(state: PracticeState, command: Command): Command {
  const clean: Command = { ...command, press: false };
  if (state.drill !== 'free' && state.drill !== 'passing') { clean.switchNearest = false; clean.switchDir = null; }
  return clean;
}

function crossed(a: Point, b: Point, c: Point, d: Point) {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function flash(state: PracticeState, world: World, text: string, event: PracticeEvent) {
  world.event = text; world.eventTime = 1.3;
  state.events.push(event);
}

function finishDrill(state: PracticeState, world: World) {
  state.phase = 'done';
  saveBest(state);
  flash(state, world, state.newBest ? 'new best!' : 'drill complete', 'done');
  updatePrompt(state);
}

function nextAttempt(state: PracticeState, world: World) {
  state.attempt++;
  if (state.attempts && state.attempt >= state.attempts) { finishDrill(state, world); return; }
  respawn(state, world);
  updatePrompt(state);
}

export function stepPractice(state: PracticeState, world: World, dt: number, userCommands: Map<number, Command>, level: Level = 'normal', tick = 0, scratch?: Map<number, Command>) {
  if (state.phase === 'done') { world.eventTime = Math.max(0, world.eventTime - dt); return; }
  const practiceOffside = state.drill === 'passing' ? world.rules?.offside : undefined;
  if (practiceOffside !== undefined && world.rules) {
    world.rules.offside = false;
    world.rules.snapshot = null;
  }
  const commands = practiceAI(world, state, level, dt, tick, scratch);
  for (const [id, command] of userCommands) if (isActive(state, id)) commands.set(id, sanitize(state, command));
  if (world.clock < 60) {
    const shift = world.halfLength - world.clock;
    world.clock += shift;
    world.switchAt = (world.switchAt ?? [-1, -1]).map((v) => v - shift) as [number, number];
    world.dribbleAt = (world.dribbleAt ?? [-1, -1]).map((v) => v - shift) as [number, number];
  }
  const before = { x: world.ball.x, z: world.ball.z };
  const goals = world.score[0];
  world.score[1] = 0;
  stepWorld(world, dt, commands);
  if (practiceOffside !== undefined && world.rules) world.rules.offside = practiceOffside;
  state.time += dt;
  const goal = world.score[0] > goals;
  const goalZ = world.ball.z;
  world.score[1] = 0;
  const stopped = world.phase !== 'live' ? world.restart ?? world.phase : null;
  if (world.phase !== 'live') { world.phase = 'live'; world.restart = null; }
  ensureControl(state, world);
  const carrier = nearestCarrier(world);
  const human = humanPlayer(world);
  if (state.drill === 'free') {
    if (goal) { state.score++; flash(state, world, 'goal!', 'goal'); respawn(state, world); }
    else if (stopped) {
      if (distance(world.players[AWAY_GK]!, world.ball) < 3) flash(state, world, 'saved', 'bad');
      respawn(state, world);
    }
    else if (carrier?.team === 1) {
      state.awayHold += dt;
      if (state.awayHold > 0.45) { flash(state, world, 'saved', 'bad'); respawn(state, world); }
    } else state.awayHold = 0;
    state.loose = !carrier && Math.hypot(world.ball.vx, world.ball.vz) < 1 ? state.loose + dt : 0;
    if (state.loose > 5) respawn(state, world);
  } else if (state.drill === 'passing') {
    const gate = state.gate;
    if (gate && !gate.crossed && crossed(before, world.ball, gate.a, gate.b)) gate.crossed = true;
    if (carrier && carrier.team === 0) {
      if (gate && carrier.id !== gate.from) {
        if (carrier.id === gate.target && gate.crossed) { state.score++; flash(state, world, 'through the gate!', 'good'); }
        else flash(state, world, carrier.id === gate.target ? 'missed the gate' : 'wrong teammate', 'bad');
        freeStation(state, world, gate.from);
        nextGate(state, world, carrier.id);
        updatePrompt(state);
      }
      state.lastCarrier = carrier.id;
      state.loose = 0;
    } else if (!carrier) {
      state.loose += Math.hypot(world.ball.vx, world.ball.vz) < 1 ? dt * 2 : dt;
    }
    if (stopped || carrier?.team === 1 || state.loose > 4.5) { flash(state, world, 'reset', 'bad'); if (gate) gate.crossed = false; respawn(state, world); }
    if (state.time >= state.limit) finishDrill(state, world);
  } else if (state.drill === 'finishing') {
    const shot = state.shot;
    const kick = world.kickEvent;
    if (kick && kick.playerId === human.id && (kick.action === 'shoot' || kick.action === 'finesse') && !shot.taken) {
      shot.taken = true; shot.action = kick.action; shot.power = kick.power; shot.timer = 0;
    }
    shot.timer += dt;
    const kind = SHOT_KIND[state.attempt % SHOT_KIND.length]!;
    if (goal) {
      const technique = kind === 'power' ? shot.action === 'shoot' && shot.power >= 0.4
        : kind === 'placed' ? Math.abs(goalZ) > 1.7 : shot.action === 'finesse';
      state.score += technique ? 2 : 1;
      flash(state, world, technique ? 'goal! +2' : 'goal! +1', 'goal');
      nextAttempt(state, world);
    } else if (stopped || carrier?.team === 1 || world.lastToucherId === AWAY_GK && !carrier) {
      const keeper = world.players[AWAY_GK]!;
      flash(state, world, world.lastToucherId === AWAY_GK || carrier?.team === 1 || distance(keeper, world.ball) < 3 ? 'saved' : 'missed', 'bad');
      nextAttempt(state, world);
    } else if (shot.taken) {
      shot.still = Math.hypot(world.ball.vx, world.ball.vz) < 1 ? shot.still + dt : 0;
      if (shot.still > 0.6 || shot.timer > 4) { flash(state, world, 'missed', 'bad'); nextAttempt(state, world); }
    } else if (shot.timer > 9) { flash(state, world, 'too slow', 'bad'); nextAttempt(state, world); }
  } else if (state.drill === 'slalom') {
    const run = state.run;
    const ballGap = distance(human, world.ball);
    if (!run.started && Math.hypot(human.vx, human.vz) > 0.5) run.started = true;
    if (run.started) run.time += dt;
    if (human.action === 'skill' && run.lastAction !== 'skill') {
      const near = SLALOM_CONES.findIndex((cone) => distance(cone, human) < 3.5);
      if (near >= 0 && !run.skillCones.includes(near) && run.skills < 3) { run.skills++; run.skillCones.push(near); flash(state, world, 'skill -0.5s', 'good'); }
    }
    run.lastAction = human.action;
    const cone = SLALOM_CONES[run.next];
    if (cone && human.x >= cone.x) {
      const side = coneSide(run.next);
      if (Math.sign(human.z) === side && Math.abs(human.z) > 0.3 && Math.abs(human.z) < 8 && ballGap < 3) state.events.push('good');
      else { run.penalty += 2; flash(state, world, 'missed cone +2s', 'bad'); }
      run.next++;
    }
    run.lost = ballGap > 4 ? run.lost + dt : 0;
    if (stopped || run.lost > 1.2 || run.time > 40) { flash(state, world, 'lost it, go again', 'bad'); respawn(state, world); }
    else if (run.next >= SLALOM_CONES.length && human.x >= SLALOM_FINISH && ballGap < 3.5) {
      const total = Math.max(1, Math.round((run.time + run.penalty - run.skills * 0.5) * 100) / 100);
      state.runs.push(total);
      state.score = Math.min(...state.runs);
      flash(state, world, `${total.toFixed(2)}s`, 'good');
      nextAttempt(state, world);
    }
  } else {
    const rep = state.rep;
    const dribbler = world.players[DRIBBLER]!;
    rep.timer += dt;
    const win = (text: string) => { state.score++; flash(state, world, text, 'good'); nextAttempt(state, world); };
    if (stopped === 'free-kick' || stopped === 'penalty') { flash(state, world, 'foul! tackle from the front', 'bad'); nextAttempt(state, world); }
    else if (stopped) win('forced it out');
    else if (carrier?.team === 0) {
      rep.won += dt;
      if (rep.won > 0.3) win('won it!');
    } else if (!carrier && world.lastTouch === 0 && distance(dribbler, world.ball) > 4) win('poked away!');
    else if (carrier?.id === DRIBBLER && dribbler.x <= DEFEND_LINE) { flash(state, world, 'beaten', 'bad'); nextAttempt(state, world); }
    else if (rep.timer > 10) win('held him up');
    else if (!carrier) rep.won = 0;
  }
  state.markers = markersFor(state, world);
}

export function markersFor(state: PracticeState, world: World): PracticeMarker[] {
  const markers: PracticeMarker[] = [];
  if (state.drill === 'passing' && state.gate) {
    const color: MarkerColor = state.gate.crossed ? 'done' : 'lit';
    markers.push({ kind: 'post', ...state.gate.a, color }, { kind: 'post', ...state.gate.b, color });
    markers.push({ kind: 'line', x: state.gate.a.x, z: state.gate.a.z, x2: state.gate.b.x, z2: state.gate.b.z, color });
    const target = world.players[state.gate.target]!;
    markers.push({ kind: 'disc', x: target.x, z: target.z, color: 'lit' });
  } else if (state.drill === 'finishing') {
    const kind = SHOT_KIND[state.attempt % SHOT_KIND.length];
    if (kind === 'placed') for (const side of [-1, 1]) markers.push({ kind: 'disc', x: GOAL_X - 0.6, z: side * 2.9, color: 'lit' });
    if (!state.shot.taken) {
      const spot = SHOT_SPOTS[state.attempt % SHOT_SPOTS.length]!;
      markers.push({ kind: 'disc', x: spot.x, z: spot.z, color: 'idle' });
    }
  } else if (state.drill === 'slalom') {
    SLALOM_CONES.forEach((cone, index) => {
      const color: MarkerColor = index < state.run.next ? 'done' : index === state.run.next ? 'lit' : 'idle';
      markers.push({ kind: 'cone', x: cone.x, z: cone.z, color });
      if (index === state.run.next) markers.push({ kind: 'disc', x: cone.x, z: coneSide(index) * 2, color: 'lit' });
    });
    const color: MarkerColor = state.run.next >= SLALOM_CONES.length ? 'lit' : 'idle';
    markers.push({ kind: 'post', x: SLALOM_FINISH, z: -5, color }, { kind: 'post', x: SLALOM_FINISH, z: 5, color });
    markers.push({ kind: 'line', x: SLALOM_FINISH, z: -5, x2: SLALOM_FINISH, z2: 5, color });
  } else if (state.drill === 'defending') {
    markers.push({ kind: 'line', x: DEFEND_LINE, z: -14, x2: DEFEND_LINE, z2: 14, color: 'warn' });
    markers.push({ kind: 'cone', x: DEFEND_LINE, z: -14, color: 'warn' }, { kind: 'cone', x: DEFEND_LINE, z: 14, color: 'warn' });
  }
  return markers;
}

function updatePrompt(state: PracticeState) {
  const step = state.drill === 'passing' ? Math.min(3, state.score) : state.attempt;
  if (state.phase === 'done') {
    state.prompt = 'drill complete';
    state.hint = 'pick another drill, or run it again';
    return;
  }
  if (state.drill === 'free') {
    state.prompt = 'free play: score on the keeper';
    state.hint = 'your teammates always find space. tap {A} to pass, hold {B} to shoot';
  } else if (state.drill === 'passing') {
    state.prompt = ['point {stick} at the glowing gate, then tap {A}', 'the next gate lights up after every pass', 'find the gate fast: you have 45 seconds', 'hold {A} longer for a firmer pass on long gates'][step]!;
    state.hint = 'the pass has to go through the gate to the lit teammate';
  } else if (state.drill === 'finishing') {
    const kind = SHOT_KIND[step % SHOT_KIND.length];
    state.prompt = kind === 'power' ? 'hold {B} to charge, let go before the red' : kind === 'placed' ? 'aim {stick} at a corner while you hold {B}' : 'hold {RB} while you shoot {B} to curl a finesse shot';
    state.hint = `shot ${Math.min(state.attempts, step + 1)} of ${state.attempts} · goals score 1, +1 with the move asked`;
  } else if (state.drill === 'slalom') {
    state.prompt = ['weave: pass each cone on its lit side', 'hold {sprint} on the straight to the finish', 'tap {LB} beside a cone for a skill move, -0.5s each'][step % 3]!;
    state.hint = `run ${Math.min(state.attempts, step + 1)} of ${state.attempts} · missed cones add 2s`;
  } else {
    state.prompt = ['hold {A} to contain: you stay goal side', 'walk him wide: steer without {sprint} to jockey', 'tap {B} to tackle when the ball leaves his foot', 'tackles from behind are fouls: stay in front', 'stop him before the red line'][step % 5]!;
    state.hint = `dribbler ${Math.min(state.attempts, step + 1)} of ${state.attempts}`;
  }
}

export type TutorialStep = 'move' | 'pass' | 'shoot' | 'done';
export type TutorialState = { step: TutorialStep; stepTime: number; total: number; moved: number; finished: boolean };
export const TUTORIAL_KEY = 'soccer:tutorial-done';
export const TUTORIAL_SECONDS = 20;
const STEP_LIMIT = 6.5;

export function createTutorial(): TutorialState {
  return { step: 'move', stepTime: 0, total: 0, moved: 0, finished: false };
}

export function stepTutorial(state: TutorialState, input: { moving: boolean; passed: boolean; shot: boolean }, dt: number): TutorialState {
  if (state.finished) return state;
  const next = { ...state, stepTime: state.stepTime + dt, total: state.total + dt };
  const advance = (step: TutorialStep) => { next.step = step; next.stepTime = 0; };
  if (next.step === 'move') {
    next.moved = input.moving ? next.moved + dt : next.moved;
    if (next.moved >= 1.2 || next.stepTime >= STEP_LIMIT) advance('pass');
  } else if (next.step === 'pass') {
    if (input.passed || next.stepTime >= STEP_LIMIT) advance('shoot');
  } else if (next.step === 'shoot') {
    if (input.shot || next.stepTime >= STEP_LIMIT) advance('done');
  } else if (next.stepTime >= 1.5) next.finished = true;
  if (next.total >= TUTORIAL_SECONDS) next.finished = true;
  return next;
}

export function tutorialSeen() {
  try { return globalThis.localStorage?.getItem(TUTORIAL_KEY) === '1'; } catch { return true; }
}

export function markTutorialSeen() {
  try { globalThis.localStorage?.setItem(TUTORIAL_KEY, '1'); } catch {}
}

export const isPracticeMode = (mode: string) => mode === PRACTICE_MODE;
export { HOME_GK as PRACTICE_HOME_KEEPER };
