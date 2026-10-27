import { createBall, stepBall, type BallState } from './physics.ts';
import { FIELD } from './field.ts';
export { FIELD } from './field.ts';

export const STEP = 1 / 60;
export const PLAYER_COUNT = 22;
export const TEAM_SIZE = 11;
export type Team = 0 | 1;
export type Slot = 'GK' | 'LB' | 'CB' | 'RB' | 'CM' | 'LW' | 'ST' | 'RW';
export type Action = 'pass' | 'through' | 'lob' | 'shoot' | 'finesse' | 'tackle' | 'slide' | 'skill';
export type Point = { x: number; z: number };
export const FORMATION = [
  { slot: 'GK', x: -50, z: 0 },
  { slot: 'LB', x: -36, z: -24 },
  { slot: 'CB', x: -39, z: -9 },
  { slot: 'CB', x: -39, z: 9 },
  { slot: 'RB', x: -36, z: 24 },
  { slot: 'CM', x: -22, z: -13 },
  { slot: 'CM', x: -26, z: 0 },
  { slot: 'CM', x: -22, z: 13 },
  { slot: 'LW', x: -8, z: -26 },
  { slot: 'ST', x: -2, z: 0 },
  { slot: 'RW', x: -8, z: 26 },
] as const satisfies readonly { slot: Slot; x: number; z: number }[];
export type Player = Point & {
  id: number;
  team: Team;
  slot: Slot;
  vx: number;
  vz: number;
  facing: number;
  stamina: number;
  human: boolean;
  controlled: boolean;
  cooldown: number;
  touchCd?: number;
  planting?: boolean;
  buffer?: { action: Action; power: number; aim: Point; t: number } | null;
  slide?: { x: number; z: number; t: number; won: boolean } | null;
  action: string;
};
export type Command = { move: Point; sprint?: boolean; jockey?: boolean; autoJockey?: boolean; contain?: boolean; switchDir?: Point | null; switchNearest?: boolean; action?: Action | null; heldAction?: Action | null; aim?: Point; power?: number; pressed?: boolean; press?: boolean };
export type Restart = 'kickoff' | 'kick-in' | 'corner' | 'goal-kick' | 'free-kick' | 'penalty' | null;
export type World = {
  players: Player[];
  ball: BallState;
  score: [number, number];
  clock: number;
  halfLength: number;
  half: 1 | 2;
  endsSwapped: boolean;
  phase: 'live' | 'restart' | 'goal' | 'half-time' | 'full-time';
  restart: Restart;
  restartTeam: Team;
  restartAt: Point;
  lastTouch: Team;
  seed: number;
  event: string;
  eventTime: number;
  restartClock: number;
  controlled: [number, number];
  kickEvent: { playerId: number; action: Action; power: number; time: number } | null;
  passTarget: number | null;
  passControl: boolean;
  carrierId?: number | null;
  lastToucherId?: number | null;
  passPoint?: Point | null;
  switchAt?: [number, number];
  switchWait?: [number, number];
  dribbleAt?: [number, number];
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const teamOf = (id: number): Team => id < TEAM_SIZE ? 0 : 1;
export const jerseyNumber = (id: number) => id % TEAM_SIZE + 1;
export const teamDir = (team: Team, swapped = false) => (team === 0 ? 1 : -1) * (swapped ? -1 : 1);
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function placeKickoffPositions(world: World, kickoffTeam: Team) {
  for (const player of world.players) {
    const formation = FORMATION[player.id % TEAM_SIZE]!;
    const direction = teamDir(player.team, world.endsSwapped);
    player.x = formation.x * direction;
    player.z = formation.z;
    if (player.slot === 'ST') {
      if (player.team === kickoffTeam) {
        player.x = -direction * 2;
        player.z = 0;
      } else {
        player.x = -direction * (FIELD.centerRadius + 0.25);
        player.z = 0;
      }
    }
    player.vx = 0;
    player.vz = 0;
  }
}

export function createWorld(seed = 71423, halfLength = 120, humans: 1 | 2 = 1): World {
  const players: Player[] = [];
  for (const team of [0, 1] as const) {
    for (let i = 0; i < TEAM_SIZE; i++) {
      const p = FORMATION[i]!;
      const dir = teamDir(team);
      const homeHuman = team === 0 && (i === 6 || (humans === 2 && i === 9));
      players.push({
        id: team * TEAM_SIZE + i, team, slot: p.slot, x: p.x * dir, z: p.z, vx: 0, vz: 0,
        facing: dir * Math.PI / 2, stamina: 1, human: homeHuman, controlled: homeHuman,
        cooldown: 0, touchCd: 0, planting: false, buffer: null, slide: null, action: 'idle',
      });
    }
  }
  const world: World = {
    players, ball: { x: 0, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false },
    score: [0, 0], clock: halfLength, halfLength, half: 1, endsSwapped: false,
    phase: 'restart', restart: 'kickoff', restartTeam: 0, restartAt: { x: 0, z: 0 },
    lastTouch: 0, seed: seed >>> 0 || 1, event: 'kick off', eventTime: 1.35, restartClock: 0, controlled: [6, TEAM_SIZE + 6], kickEvent: null, passTarget: null, passControl: false, carrierId: null, lastToucherId: null, passPoint: null,
    switchAt: [-1, -1], switchWait: [0, 0], dribbleAt: [-1, -1],
  };
  placeKickoffPositions(world, 0);
  return world;
}

export function restartTaker(world: World) {
  return (world.restart === 'goal-kick'
    ? world.players.find((player) => player.team === world.restartTeam && player.slot === 'GK')
    : world.restart === 'kickoff'
      ? world.players.find((player) => player.team === world.restartTeam && player.slot === 'ST')
      : undefined)
    ?? world.players.find((player) => player.team === world.restartTeam && player.controlled)
    ?? world.players.filter((player) => player.team === world.restartTeam).sort((a, b) => distance(a, world.restartAt) - distance(b, world.restartAt))[0]!;
}

export function rng(world: World) {
  world.seed = (Math.imul(world.seed, 1664525) + 1013904223) >>> 0;
  return world.seed / 4294967296;
}

export function switchPlayer(world: World, team: Team, direction: Point = { x: 0, z: 0 }) {
  const currentId = world.controlled[team];
  const current = world.players.find((p) => p.id === currentId);
  const candidates = world.players.filter((p) => p.team === team && p.id !== currentId && !p.human);
  if (!candidates.length) return currentId;
  const norm = Math.hypot(direction.x, direction.z);
  const angle = (p: Player) => current ? Math.acos(clamp(((p.x - current.x) * direction.x + (p.z - current.z) * direction.z) / ((distance(p, current) || 1) * norm), -1, 1)) : Math.PI;
  const eligible = norm > 0.2 ? candidates.filter((p) => angle(p) <= Math.PI / 3) : candidates;
  const chosen = eligible.sort((a, b) => norm > 0.2 ? angle(a) - angle(b) : switchScore(world, a) - switchScore(world, b))[0];
  if (!chosen) return currentId;
  transferControl(world, team, chosen.id);
  return chosen.id;
}

function switchScore(world: World, p: Player) {
  return distance(p, world.ball) + ((p.x - world.ball.x) * teamDir(p.team, world.endsSwapped) > 0 ? 2.5 : 0);
}

function transferControl(world: World, team: Team, id: number) {
  const currentId = world.controlled[team];
  for (const p of world.players) {
    if (p.team !== team || p.human && p.id !== currentId) continue;
    p.human = p.id === id;
    p.controlled = p.id === id;
  }
  world.controlled[team] = id;
}

export function movePlayer(player: Player, input: Point, sprint: boolean, carrying: boolean, dt: number, jockey = false) {
  const magnitude = Math.hypot(input.x, input.z);
  const top = jockey ? (sprint ? 5 : 3.2) : (sprint ? 9 * (0.75 + 0.25 * Math.min(1, player.stamina / 0.35)) : 7) * (carrying ? 0.9 : 1);
  let speed = Math.hypot(player.vx, player.vz);
  let angle = speed > 0 ? Math.atan2(player.vx, player.vz) : player.facing;
  if (magnitude < 0.08) {
    player.planting = false;
    speed = Math.max(0, speed - 31.5 * dt);
  } else {
    const targetAngle = Math.atan2(input.x, input.z);
    const delta = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
    if (!jockey && ((Math.abs(delta) > 2.2 && speed > 4 * 7 / 6) || (player.planting && speed > 2.5 * 7 / 6))) {
      player.planting = true;
      speed = Math.max(0, speed - 31.5 * dt);
    } else {
      player.planting = false;
      const slow = 2.5 * 7 / 6;
      const turn = (16 + (3 - 16) * clamp((speed - slow) / (9 - slow), 0, 1)) * (carrying ? 0.85 : 1) * dt;
      angle += jockey || speed <= slow ? delta : clamp(delta, -turn, turn);
      const target = top * Math.min(1, magnitude) * (jockey ? 1 : Math.max(0.25, Math.cos(targetAngle - angle)));
      speed += clamp(target - speed, -31.5 * dt, (speed < 7 ? 40 * 7 / 6 : 9) * dt);
    }
  }
  if (jockey) speed = Math.min(speed, top);
  if (player.action === 'tackle-miss' && player.cooldown > 0) speed = Math.min(speed, 2);
  player.vx = Math.sin(angle) * speed;
  player.vz = Math.cos(angle) * speed;
  if (speed > 0.04) player.facing = Math.atan2(player.vx, player.vz);
  player.x = clamp(player.x + player.vx * dt, -FIELD.length / 2 + 0.3, FIELD.length / 2 - 0.3);
  player.z = clamp(player.z + player.vz * dt, -FIELD.width / 2 + 0.3, FIELD.width / 2 - 0.3);
  player.stamina = clamp(player.stamina + (sprint && magnitude > 0.2 ? -0.11 : 0.06) * dt, 0, 1);
  player.cooldown = Math.max(0, player.cooldown - dt);
}

export function nearestCarrier(world: World) {
  if (world.ball.y > 0.75) return undefined;
  const eligible = (p: Player) => !p.slide && !(p.touchCd! > 0) && !(p.cooldown > 0 && (p.action === 'kick' || p.action === 'pass')) && distance(p, world.ball) < 0.64;
  return world.players.find((p) => p.id === world.carrierId && eligible(p)) ?? world.players.find(eligible);
}

function rollingFlight(speed: number, range: number) {
  const ball = createBall(); ball.vx = speed;
  let travelled = 0, time = 0;
  while (travelled < range && ball.vx > 0.01 && time < 12) {
    ball.x = 0;
    stepBall(ball, STEP);
    travelled += ball.x; time += STEP;
  }
  return { speed: travelled >= range ? ball.vx : 0, time };
}

export function groundPassSpeed(range: number, arrivalSpeed = 4) {
  let low = 4, high = 40;
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2;
    if (rollingFlight(mid, range).speed < arrivalSpeed) low = mid;
    else high = mid;
  }
  return clamp((low + high) / 2, 8, 25);
}

export function groundPassPower(range: number, arrivalSpeed = 4) {
  const ideal = groundPassSpeed(range);
  const desired = arrivalSpeed === 4 ? ideal : groundPassSpeed(range, arrivalSpeed);
  return clamp((desired / ideal - 0.82) / 0.4, 0.1, 1);
}

export function groundPassTarget(ball: Point, receiver: Pick<Player, 'x' | 'z' | 'vx' | 'vz'>): Point {
  const range = distance(ball, receiver);
  const time = range / groundPassSpeed(range);
  return {
    x: clamp(receiver.x + receiver.vx * time, -FIELD.length / 2 + 0.3, FIELD.length / 2 - 0.3),
    z: clamp(receiver.z + receiver.vz * time, -FIELD.width / 2 + 0.3, FIELD.width / 2 - 0.3),
  };
}

export function isCross(world: World, player: Player) {
  return Math.abs(player.z) > FIELD.penaltyWidth / 2 && player.x * teamDir(player.team, world.endsSwapped) > FIELD.length / 6;
}

function lobSpeed(range: number, loft: number) {
  let speed = Math.sqrt(range * 9.81 / Math.sin(2 * loft)) * 1.06;
  for (let i = 0; i < 4; i++) {
    const ball = createBall();
    ball.vx = speed * Math.cos(loft); ball.vy = speed * Math.sin(loft); ball.grounded = false;
    let travelled = 0;
    for (let frame = 0; frame < 600; frame++) {
      const falling = ball.vy < 0;
      ball.x = 0;
      stepBall(ball, STEP); travelled += ball.x;
      if (falling && ball.vy >= 0) break;
    }
    speed *= Math.sqrt(range / Math.max(0.1, travelled));
  }
  return speed;
}

const SHOT_AIM_WIDTH = FIELD.goalWidth * 0.43;

export function shotTargetZ(player: Pick<Player, 'z'>, stick: Point) {
  const length = Math.hypot(stick.x, stick.z);
  return length > 0.2 ? stick.z / length * SHOT_AIM_WIDTH : -Math.sign(player.z || -1) * FIELD.goalWidth * 0.24;
}

export function shotAim(targetZ: number, direction: number): Point {
  const z = clamp(targetZ / SHOT_AIM_WIDTH, -1, 1);
  return { x: direction * Math.sqrt(1 - z * z), z };
}

function kick(world: World, player: Player, action: Action, command: Command) {
  const d = teamDir(player.team, world.endsSwapped);
  const charge = clamp(command.power ?? 0.45, 0.1, 1);
  const stick = command.aim ?? command.move;
  const stickLength = Math.hypot(stick.x, stick.z);
  const aim = stickLength > 0.2 ? { x: stick.x / stickLength, z: stick.z / stickLength } : { x: Math.sin(player.facing), z: Math.cos(player.facing) };
  const shot = action === 'shoot' || action === 'finesse';
  const cross = action === 'lob' && isCross(world, player);
  const receiver = !shot ? findReceiver(world, player, aim, action === 'through', cross) : undefined;
  let target = receiver ? { x: receiver.x, z: receiver.z } : { x: player.x + aim.x * (5 + charge * 25), z: player.z + aim.z * (5 + charge * 25) };
  let speed = 0, loft = 0;
  world.passPoint = null;
  if (action === 'pass') {
    if (receiver) target = groundPassTarget(world.ball, receiver);
    speed = clamp(groundPassSpeed(distance(world.ball, target)) * (0.82 + 0.4 * charge), 8, 25);
  } else if (action === 'through') {
    const runSpeed = receiver ? Math.hypot(receiver.vx, receiver.vz) : 0;
    const fallback = { x: d + aim.x * 0.25, z: aim.z * 0.25 };
    const norm = Math.hypot(fallback.x, fallback.z);
    const run = receiver && runSpeed > 1 ? { x: receiver.vx / runSpeed, z: receiver.vz / runSpeed } : { x: fallback.x / norm, z: fallback.z / norm };
    const lead = 3 + charge * 12;
    const origin = receiver ?? player;
    target = { x: origin.x + run.x * lead, z: origin.z + run.z * lead };
    const range = distance(world.ball, target);
    const arrival = lead / 7.5 + 0.15;
    let low = groundPassSpeed(range), high = 25;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (rollingFlight(mid, range).time > arrival) low = mid;
      else high = mid;
    }
    speed = Math.min(25, (low + high) / 2);
    world.passPoint = target;
  } else if (action === 'lob') {
    loft = cross ? 0.5 : 0.62;
    if (receiver) target = { x: receiver.x + receiver.vx * 0.7, z: receiver.z + receiver.vz * 0.7 };
    else target = { x: player.x + aim.x * (8 + charge * 42), z: player.z + aim.z * (8 + charge * 42) };
    const range = distance(world.ball, target) * (receiver ? 0.8 + charge * 0.4 : 1);
    if (lobSpeed(range, loft) > 24) loft = 0.7;
    speed = Math.min(24, lobSpeed(range, loft));
  } else {
    target = { x: d * FIELD.length / 2, z: shotTargetZ(player, stick) };
    const goalDistance = distance(player, { x: d * FIELD.length / 2, z: 0 });
    const threshold = 0.78 + clamp(goalDistance / 60, 0, 0.14) + (action === 'finesse' ? 0.06 : 0);
    loft = 0.07 + charge * 0.09 + Math.max(0, charge - threshold) * 3.2;
    speed = action === 'finesse' ? 12 + charge * 9 : 15 + charge * 17;
  }
  const dx = target.x - world.ball.x, dz = target.z - world.ball.z;
  const baseAngle = Math.atan2(dz, dx);
  const pressure = Math.min(...world.players.filter((p) => p.team !== player.team).map((p) => distance(p, player)));
  const bodyAngle = Math.abs(Math.atan2(Math.sin(Math.PI / 2 - baseAngle - player.facing), Math.cos(Math.PI / 2 - baseAngle - player.facing)));
  let error = shot ? 0.03 + distance(player, target) * 0.004 + Math.max(0, bodyAngle - 0.6) * 0.22
    + (pressure < 1.5 ? 0.1 : 0) + (Math.hypot(player.vx, player.vz) > 6.5 * 9 / 8 ? 0.09 : 0) + (1 - player.stamina) * 0.08 + charge * 0.06 : 0.015 + (1 - player.stamina) * 0.06;
  if (action === 'finesse') error *= 0.6;
  const angle = baseAngle + (rng(world) - 0.5) * error;
  if (shot) loft += (rng(world) - 0.5) * error * 0.25;
  const horizontal = speed * Math.cos(loft);
  world.ball.vx = Math.cos(angle) * horizontal;
  world.ball.vz = Math.sin(angle) * horizontal;
  world.ball.vy = speed * Math.sin(loft);
  world.ball.spin = action === 'finesse' ? -Math.sign(player.z || target.z || 1) * d * 9 : 0;
  world.ball.grounded = loft === 0;
  if (world.ball.grounded) world.ball.y = 0.11;
  world.ball.inNet = false;
  world.lastTouch = player.team;
  world.lastToucherId = player.id;
  world.kickEvent = { playerId: player.id, action, power: charge, time: world.clock };
  if (action === 'pass' || action === 'through' || action === 'lob') {
    world.passTarget = receiver?.id ?? null;
    world.passControl = !!receiver && player.human;
  } else {
    world.passTarget = null;
    world.passControl = false;
  }
  player.action = action === 'shoot' || action === 'finesse' ? 'kick' : 'pass';
  player.cooldown = 0.28;
  player.buffer = null;
}

export function findReceiver(world: World, from: Player, direction: Point, through: boolean, cross = false) {
  const dirLen = Math.hypot(direction.x, direction.z) || 1;
  const ax = direction.x / dirLen;
  const az = direction.z / dirLen;
  const dir = teamDir(from.team, world.endsSwapped);
  let receiver: Player | undefined;
  let bestScore = Infinity;
  for (const player of world.players) {
    if (player.team !== from.team || player.id === from.id) continue;
    const dx = player.x - from.x;
    const dz = player.z - from.z;
    const forward = dx * ax + dz * az;
    const targetDistance = Math.hypot(dx, dz) || 1;
    const angle = Math.acos(clamp(forward / targetDistance, -1, 1));
    if (angle > Math.PI * 2 / 9) continue;
    let blocked = false;
    for (const opponent of world.players) {
      if (opponent.team === from.team) continue;
      if (pointLineDistance(opponent, from, player) < 1.2 && distance(from, opponent) < targetDistance) {
        blocked = true;
        break;
      }
    }
    const inBox = player.x * dir > FIELD.length / 2 - FIELD.penaltyDepth && Math.abs(player.z) < FIELD.penaltyWidth / 2;
    const score = angle * 18 + targetDistance * 0.12 + (blocked ? 8 : 0) - (cross && inBox ? 12 : 0)
      + (forward < -1 ? 14 : 0) - (through ? Math.max(-4, forward * 0.28) : forward * 0.08) - dx * dir * 0.14;
    if (score < bestScore) { receiver = player; bestScore = score; }
  }
  return receiver;
}

function pointLineDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length2 = dx * dx + dz * dz || 1;
  const t = clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / length2, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

function approachAngle(player: Player, enemy: Player) {
  const from = Math.atan2(player.x - enemy.x, player.z - enemy.z);
  return Math.abs(Math.atan2(Math.sin(enemy.facing - from), Math.cos(enemy.facing - from)));
}

function foul(world: World, player: Player, enemy: Player) {
  const ownGoal = -teamDir(player.team, world.endsSwapped) * FIELD.length / 2;
  const penalty = Math.abs(enemy.x - ownGoal) <= FIELD.penaltyDepth && Math.abs(enemy.z) <= FIELD.penaltyWidth / 2;
  setRestart(world, enemy.team, penalty ? 'penalty' : 'free-kick', enemy);
}

function slideStep(world: World, player: Player, dt: number) {
  const slide = player.slide!;
  const active = Math.min(dt, Math.max(0, 0.5 - slide.t));
  const speed = 9 * Math.max(0, 1 - slide.t / 0.65);
  player.vx = active > 0 ? slide.x * speed : 0;
  player.vz = active > 0 ? slide.z * speed : 0;
  player.x = clamp(player.x + player.vx * active, -FIELD.length / 2 + 0.3, FIELD.length / 2 - 0.3);
  player.z = clamp(player.z + player.vz * active, -FIELD.width / 2 + 0.3, FIELD.width / 2 - 0.3);
  player.facing = Math.atan2(slide.x, slide.z);
  if (active > 0 && !slide.won) {
    const enemy = world.players.filter((p) => p.team !== player.team && distance(p, world.ball) < 2.5)
      .sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
    const ballContact = world.ball.y < 0.75 && distance(player, world.ball) < 0.85;
    const bodyContact = enemy && distance(player, enemy) < 0.7;
    if (enemy && (bodyContact && (!ballContact || distance(player, enemy) < distance(player, world.ball)) || ballContact && distance(player, enemy) < 1.5 && approachAngle(player, enemy) > 1.9)) {
      foul(world, player, enemy);
      return;
    }
    if (ballContact) {
      const pokeSpeed = 6 + rng(world) * 3;
      world.ball.vx = slide.x * pokeSpeed;
      world.ball.vz = slide.z * pokeSpeed;
      world.ball.vy = 0;
      world.lastTouch = player.team; world.lastToucherId = player.id;
      if (enemy) enemy.touchCd = 0.3;
      slide.won = true;
    }
  }
  slide.t += dt;
  player.cooldown = Math.max(0, 0.95 - slide.t);
  player.action = slide.t < 0.5 ? 'slide' : 'get-up';
  if (slide.t >= 0.95) { player.slide = null; player.action = 'idle'; }
}

function applyAction(world: World, player: Player, command: Command) {
  if (!command.action || !command.pressed || player.cooldown > 0) return;
  const capSpeed = () => {
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 9) {
      player.vx = player.vx / speed * 9;
      player.vz = player.vz / speed * 9;
    }
  };
  if (command.action === 'tackle' || command.action === 'slide') {
    player.buffer = null;
    if (command.action === 'slide') {
      player.slide = { x: Math.sin(player.facing), z: Math.cos(player.facing), t: 0, won: false };
      player.cooldown = 0.95; player.action = 'slide';
      return;
    }
    const enemy = world.players.filter((p) => p.team !== player.team).sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
    const ballDistance = distance(player, world.ball);
    if (ballDistance < 1.5 && world.ball.y < 0.75) {
      const angle = enemy ? approachAngle(player, enemy) : 0;
      const exposed = !enemy || distance(enemy, world.ball) > 0.55;
      const behind = angle > 1.9;
      const chance = (angle < 1.3 ? 0.55 : behind ? 0.15 : 0.3) * (enemy?.action === 'shield' ? 0.4 : 1);
      if (!exposed && behind && rng(world) < 0.35) {
        foul(world, player, enemy!);
        player.cooldown = 0.6; player.action = 'tackle-miss';
        return;
      }
      if (exposed || rng(world) < chance) {
        const loose = rng(world) >= 0.5;
        const touch = loose ? 1 : 0.42;
        world.ball.x = player.x + Math.sin(player.facing) * touch;
        world.ball.z = player.z + Math.cos(player.facing) * touch;
        world.ball.y = 0.11;
        world.ball.grounded = true;
        world.ball.vx = player.vx * 0.35;
        world.ball.vy = 0;
        world.ball.vz = player.vz * 0.35;
        world.lastTouch = player.team;
        world.lastToucherId = player.id;
        if (enemy) enemy.touchCd = 0.25;
        player.cooldown = 0.35; player.action = 'tackle';
        capSpeed();
        return;
      }
    }
    player.cooldown = ballDistance < 1.5 ? 0.6 : 0.35;
    player.touchCd = player.cooldown;
    player.action = 'tackle-miss';
    if (ballDistance >= 1.5) {
      player.vx = Math.sin(player.facing) * 2;
      player.vz = Math.cos(player.facing) * 2;
    }
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 2) { player.vx *= 2 / speed; player.vz *= 2 / speed; }
    return;
  }
  if (command.action === 'skill') {
    const dir = teamDir(player.team, world.endsSwapped);
    player.vx -= dir * 2.2;
    player.action = 'skill';
    player.cooldown = 0.42;
    capSpeed();
    return;
  }
  const carrier = nearestCarrier(world);
  if (carrier?.id !== player.id) {
    if (!carrier && distance(player, world.ball) <= 3) {
      player.buffer = { action: command.action, power: command.power ?? 0.45, aim: command.aim ?? command.move, t: 0.35 };
    }
    return;
  }
  kick(world, player, command.action, command);
}

function setRestart(world: World, team: Team, restart: Exclude<Restart, null>, at: Point) {
  world.phase = 'restart';
  world.restart = restart;
  world.restartTeam = team;
  const direction = teamDir(team, world.endsSwapped);
  const point = restart === 'penalty'
    ? { x: direction * (FIELD.length / 2 - FIELD.penaltySpot), z: 0 }
    : at;
  world.restartAt = {
    x: clamp(point.x, -FIELD.length / 2 + 0.15, FIELD.length / 2 - 0.15),
    z: clamp(point.z, -FIELD.width / 2 + 0.15, FIELD.width / 2 - 0.15),
  };
  world.ball = { x: world.restartAt.x, y: 0.11, z: world.restartAt.z, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  world.event = restart === 'goal-kick' ? 'goal kick' : restart;
  world.eventTime = 2;
  world.restartClock = 0;
  world.lastToucherId = null;
  world.carrierId = null;
  world.passPoint = null;
  world.passTarget = null;
  for (const p of world.players) { p.buffer = null; p.slide = null; }
  world.switchWait = [0, 0];
}

function goalSide(world: World, carrier: Player, team: Team, gap: number): Point {
  const dx = -teamDir(team, world.endsSwapped) * FIELD.length / 2 - carrier.x;
  const dz = -carrier.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: carrier.x + dx / length * gap, z: carrier.z + dz / length * gap };
}

function prepareDefense(world: World, commands: Map<number, Command>, carrier: Player | undefined, dt: number) {
  const now = world.halfLength * world.half - world.clock;
  world.switchAt ??= [-1, -1]; world.switchWait ??= [0, 0]; world.dribbleAt ??= [-1, -1];
  for (const p of world.players) {
    const original = commands.get(p.id);
    if (!original) continue;
    const command = { ...original };
    commands.set(p.id, command);
    if (carrier?.id !== p.id) {
      if (command.switchNearest || command.switchDir || command.action === 'pass' && command.pressed && (command.power ?? 0.1) < 0.3) {
        if (p.human && p.controlled) {
          const id = switchPlayer(world, p.team, command.switchDir ?? undefined);
          world.switchAt[p.team] = now;
          if (id !== p.id) { commands.delete(p.id); commands.set(id, { ...command, action: null, pressed: false, switchNearest: false, switchDir: null }); }
        }
        command.action = null; command.pressed = false;
      }
      if (carrier?.team !== p.team) command.contain ||= command.heldAction === 'pass';
      if (carrier || distance(p, world.ball) > 3) {
        if (command.action === 'shoot') command.action = 'tackle';
        else if (command.action === 'lob') command.action = 'slide';
        else if (command.action === 'through') command.action = null;
      }
    }
    if (!command.press || !carrier || carrier.team === p.team) continue;
    const presser = world.players.filter((mate) => mate.team === p.team && !mate.human && !mate.slide)
      .sort((a, b) => distance(a, carrier) - distance(b, carrier))[0];
    if (presser) {
      const target = goalSide(world, carrier, p.team, 1.6);
      commands.set(presser.id, { ...commands.get(presser.id), move: { x: target.x - presser.x, z: target.z - presser.z }, sprint: true });
    }
  }
  for (const team of [0, 1] as const) {
    const current = world.players.find((p) => p.id === world.controlled[team]);
    if (!current?.human) continue;
    if (carrier?.id === current.id || (current.touchCd ?? 0) > 0) world.dribbleAt[team] = now;
    const ownPass = world.passTarget != null && world.players.some((p) => p.id === world.passTarget && p.team === team);
    const eligible = !carrier && Math.hypot(world.ball.vx, world.ball.vz) > 3 && !ownPass
      && now - world.dribbleAt[team] >= 0.3;
    if (!eligible) { world.switchWait[team] = 0; continue; }
    world.switchWait[team] += dt;
    if (world.switchWait[team] + 1e-9 < 0.25 || now - world.switchAt[team] < 0.6) continue;
    const best = world.players.filter((p) => p.team === team && !p.human)
      .sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
    if (best && distance(best, world.ball) + 2.5 <= distance(current, world.ball)) {
      transferControl(world, team, best.id); world.switchAt[team] = now; world.switchWait[team] = 0;
    }
  }
}

export function resolveBoundary(world: World) {
  const b = world.ball;
  if (Math.abs(b.z) > FIELD.width / 2 + 0.04) {
    const awarded: Team = world.lastTouch === 0 ? 1 : 0;
    setRestart(world, awarded, 'kick-in', {
      x: clamp(b.x, -FIELD.length / 2 + 0.15, FIELD.length / 2 - 0.15),
      z: Math.sign(b.z) * (FIELD.width / 2 - 0.15),
    });
    return 'kick-in';
  }
  if (Math.abs(b.x) > FIELD.length / 2 + 0.12) {
    const defending: Team = b.x > 0 ? (world.endsSwapped ? 0 : 1) : (world.endsSwapped ? 1 : 0);
    const attacking: Team = defending === 0 ? 1 : 0;
    if (world.lastTouch === defending) {
      setRestart(world, attacking, 'corner', {
        x: Math.sign(b.x) * (FIELD.length / 2 - 0.15),
        z: Math.sign(b.z || 1) * (FIELD.width / 2 - 0.15),
      });
      return 'corner';
    }
    const goalDirection = teamDir(defending, world.endsSwapped);
    setRestart(world, defending, 'goal-kick', {
      x: -goalDirection * (FIELD.length / 2 - FIELD.goalAreaDepth),
      z: 0,
    });
    return 'goal-kick';
  }
  return null;
}

export function resolveKeeperContact(world: World, previousX: number) {
  const ball = world.ball;
  for (const keeper of world.players.filter((p) => p.slot === 'GK')) {
    const direction = teamDir(keeper.team, world.endsSwapped);
    const plane = -direction * (FIELD.length / 2 - 1.5);
    const crossed = direction > 0 ? previousX > plane && ball.x <= plane : previousX < plane && ball.x >= plane;
    const reach = keeper.action === 'dive' ? 2.4 : 1.1;
    if (!crossed || ball.y < 0 || ball.y > 2.55 || Math.abs(ball.z - keeper.z) > reach) continue;
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    ball.x = plane + direction * 0.16;
    ball.z = clamp(ball.z, keeper.z - 2.4, keeper.z + 2.4);
    ball.inNet = false;
    if (speed < 17) {
      ball.y = 0.11; ball.vx = ball.vy = ball.vz = 0; ball.grounded = true;
      keeper.action = 'catch';
      world.event = 'keeper claims it';
    } else {
      ball.vx = direction * Math.max(4, speed * 0.42);
      ball.vy = Math.max(1.2, Math.abs(ball.vy) * 0.34);
      ball.vz = clamp((ball.z - keeper.z) * 2.4, -7, 7);
      ball.grounded = false;
      keeper.action = 'parry';
      world.event = 'keeper parries';
    }
    world.eventTime = 1.1;
    world.lastTouch = keeper.team;
    world.lastToucherId = keeper.id;
    return true;
  }
  return false;
}

function scoreGoal(world: World, scoring: Team) {
  world.score[scoring]++;
  world.phase = 'goal';
  world.restart = 'kickoff';
  world.restartTeam = scoring === 0 ? 1 : 0;
  world.event = scoring === 0 ? 'bay city goal!' : 'northshore goal!';
  world.eventTime = 3;
  world.ball.vx = world.ball.vy = world.ball.vz = 0;
}

function goalCrossing(world: World, previousX: number) {
  const b = world.ball;
  const halfGoal = FIELD.goalWidth / 2 - 0.11;
  if (Math.abs(b.z) > halfGoal || b.y > FIELD.goalHeight - 0.11) return false;
  if (previousX <= FIELD.length / 2 - 0.11 && b.x > FIELD.length / 2 + 0.11) {
    scoreGoal(world, world.endsSwapped ? 1 : 0); return true;
  }
  if (previousX >= -FIELD.length / 2 + 0.11 && b.x < -FIELD.length / 2 - 0.11) {
    scoreGoal(world, world.endsSwapped ? 0 : 1); return true;
  }
  return false;
}

export function stepWorld(world: World, dt: number, commands: Map<number, Command> = new Map(), clockScale = 1) {
  const t = Math.min(0.05, Math.max(0, dt));
  const clockStep = t * Math.max(0, Math.min(20, Number.isFinite(clockScale) ? clockScale : 1));
  world.eventTime = Math.max(0, world.eventTime - t);
  world.kickEvent = null;
  if (world.phase === 'full-time') return;
  if (world.phase === 'goal' || world.phase === 'half-time') {
    if (world.eventTime <= 0) {
    if (world.phase === 'half-time') {
      world.half = 2; world.endsSwapped = !world.endsSwapped; world.clock = world.halfLength;
        world.phase = 'restart'; world.restart = 'kickoff'; world.restartTeam = 1; world.event = 'second half'; world.eventTime = 2; world.restartClock = 0;
        world.restartAt = { x: 0, z: 0 };
        placeKickoffPositions(world, 1);
      } else {
        world.phase = 'restart';
        world.ball.x = 0; world.ball.z = 0; world.ball.y = 0.11;
        world.restartAt = { x: 0, z: 0 };
        world.eventTime = 2;
        world.restartClock = 0;
        placeKickoffPositions(world, world.restartTeam);
      }
    }
    return;
  }
  if (world.phase === 'restart') {
    world.restartClock += t;
    const taker = restartTaker(world);
    for (const p of world.players) {
      if (p.team === world.restartTeam && p.controlled) movePlayer(p, commands.get(p.id)?.move ?? { x: 0, z: 0 }, !!commands.get(p.id)?.sprint, false, t);
      if (world.restart === 'kickoff' && p.id !== taker.id) {
        const direction = teamDir(p.team, world.endsSwapped);
        if (p.x * direction > 0) p.x = -direction * 0.8;
        if (Math.hypot(p.x, p.z) < FIELD.centerRadius + 0.25) {
          const radius = FIELD.centerRadius + 0.25;
          const x = Math.sqrt(Math.max(0, radius * radius - Math.min(radius, Math.abs(p.z)) ** 2));
          p.x = -direction * x;
        }
      } else if (p.team !== world.restartTeam && distance(p, world.restartAt) < FIELD.centerRadius) {
        const dx = p.x - world.restartAt.x;
        const dz = p.z - world.restartAt.z;
        const d = Math.hypot(dx, dz) || 1;
        p.x = world.restartAt.x + dx / d * FIELD.centerRadius;
        p.z = world.restartAt.z + dz / d * FIELD.centerRadius;
      }
    }
    const action = commands.get(taker.id);
    world.clock = Math.max(0, world.clock - clockStep);
    const moved = world.players.some((player) => player.team === world.restartTeam && player.controlled
      && Math.hypot(commands.get(player.id)?.move.x ?? 0, commands.get(player.id)?.move.z ?? 0) > 0.05);
    if ((action?.pressed && action.action) || moved || world.restartClock >= 10) {
      world.phase = 'live';
      world.ball.x = world.restartAt.x; world.ball.z = world.restartAt.z; world.ball.y = 0.11;
      if (action?.action) kick(world, taker, action.action, action);
      world.restart = null;
    }
    return;
  }
  const previousX = world.ball.x;
  for (const p of world.players) {
    p.touchCd = Math.max(0, (p.touchCd ?? 0) - t);
    if (p.buffer) { p.buffer.t -= t; if (p.buffer.t <= 0) p.buffer = null; }
  }
  const carrier = nearestCarrier(world);
  commands = new Map(commands);
  prepareDefense(world, commands, carrier, t);
  for (const p of world.players) {
    const command = commands.get(p.id);
    if (p.slide) {
      slideStep(world, p, t);
      if (world.phase !== 'live') return;
      continue;
    }
    const neutral = Math.hypot(command?.move.x ?? 0, command?.move.z ?? 0) < 0.15;
    const receiving = world.passTarget === p.id && !carrier && (!p.human || neutral);
    if (p.human && !receiving && !p.buffer && (!p.controlled || !command)) continue;
    if (receiving && world.passPoint && distance(p, world.passPoint) < 0.7) world.passPoint = null;
    const receiveTarget = world.passPoint ?? world.ball;
    const receiveGap = distance(p, receiveTarget);
    const receiveMove = receiving ? { x: (receiveTarget.x - p.x) / Math.max(2, receiveGap), z: (receiveTarget.z - p.z) / Math.max(2, receiveGap) } : command?.move ?? { x: 0, z: 0 };
    const enemy = carrier && carrier.team !== p.team ? carrier : undefined;
    const contain = enemy && (command?.contain || command?.heldAction === 'pass');
    const jockey = !!command?.jockey || !!(command?.autoJockey && enemy && distance(p, enemy) < 4 && !command.sprint && Math.hypot(command.move.x, command.move.z) > 0.1);
    const target = contain ? goalSide(world, enemy!, p.team, 1.4) : undefined;
    movePlayer(p, target ? { x: target.x - p.x, z: target.z - p.z } : receiveMove, !contain && (receiving ? receiveGap > 3 : !!command?.sprint), carrier?.id === p.id, t, jockey || !!contain);
    if ((jockey || contain) && enemy) {
      p.facing = Math.atan2(enemy.x - p.x, enemy.z - p.z);
      if (p.cooldown <= 0) p.action = 'jockey';
    } else if (p.action === 'jockey' || p.action === 'tackle-miss' && p.cooldown <= 0) p.action = 'idle';
    if (command) applyAction(world, p, command);
    if (world.phase !== 'live') return;
    if (p.buffer && p.cooldown <= 0 && nearestCarrier(world)?.id === p.id) {
      kick(world, p, p.buffer.action, { move: command?.move ?? { x: 0, z: 0 }, ...p.buffer });
    }
  }
  const nowCarrier = nearestCarrier(world);
  if (nowCarrier && world.passTarget === nowCarrier.id) {
    if (world.passControl) {
      if (!nowCarrier.human || nowCarrier.controlled) transferControl(world, nowCarrier.team, nowCarrier.id);
    }
    world.passTarget = null;
    world.passControl = false;
    world.passPoint = null;
  }
  if (nowCarrier) {
    world.lastTouch = nowCarrier.team;
    const command = commands.get(nowCarrier.id);
    const stick = Math.hypot(command?.move.x ?? 0, command?.move.z ?? 0);
    const speed = Math.hypot(nowCarrier.vx, nowCarrier.vz);
    const opponent = world.players.filter((p) => p.team !== nowCarrier.team).sort((a, b) => distance(a, nowCarrier) - distance(b, nowCarrier))[0];
    const pressure = opponent ? distance(opponent, nowCarrier) : Infinity;
    const rel = Math.hypot(world.ball.vx - nowCarrier.vx, world.ball.vz - nowCarrier.vz, world.ball.vy);
    const badChance = clamp((rel - 10) * 0.05 + (command?.sprint ? 0.12 : 0) + (pressure < 1.5 ? 0.12 : 0) + (world.ball.y > 0.3 ? 0.1 : 0) - (stick < 0.15 ? 0.05 : 0), 0, 0.7);
    const heavy = world.carrierId !== nowCarrier.id && world.lastToucherId !== nowCarrier.id && rel > 4 && badChance > 0 && rng(world) < badChance;
    world.lastToucherId = nowCarrier.id;
    const shield = stick < 0.15 && pressure < 2.2;
    if (shield && opponent) {
      nowCarrier.action = 'shield';
      const away = Math.atan2(nowCarrier.x - opponent.x, nowCarrier.z - opponent.z);
      const delta = Math.atan2(Math.sin(away - nowCarrier.facing), Math.cos(away - nowCarrier.facing));
      nowCarrier.facing += clamp(delta, -16 * t, 16 * t);
      nowCarrier.facing = Math.atan2(Math.sin(nowCarrier.facing), Math.cos(nowCarrier.facing));
      if (speed > 2) { nowCarrier.vx *= 2 / speed; nowCarrier.vz *= 2 / speed; }
    } else if (nowCarrier.action === 'shield') nowCarrier.action = 'idle';
    const frontBlocked = world.players.some((p) => p.team !== nowCarrier.team && distance(p, nowCarrier) < 2
      && (p.x - nowCarrier.x) * Math.sin(nowCarrier.facing) + (p.z - nowCarrier.z) * Math.cos(nowCarrier.facing) > 0);
    if (heavy || (speed >= 6.5 * 9 / 8 && stick >= 0.15 && !frontBlocked && distance(nowCarrier, world.ball) <= 0.7)) {
      const angle = nowCarrier.facing + (heavy ? (rng(world) - 0.5) * 0.9 : 0);
      const push = heavy ? 1.5 + rel * 0.22 : speed * 1.45;
      world.ball.vx = Math.sin(angle) * push;
      world.ball.vz = Math.cos(angle) * push;
      nowCarrier.touchCd = heavy ? 0.3 : 0.35;
    } else {
      const touchDistance = shield ? 0.42 : 0.45;
      const touchAngle = shield && opponent ? Math.atan2(nowCarrier.x - opponent.x, nowCarrier.z - opponent.z) : nowCarrier.facing;
      const touchX = nowCarrier.x + Math.sin(touchAngle) * touchDistance;
      const touchZ = nowCarrier.z + Math.cos(touchAngle) * touchDistance;
      const settle = world.carrierId !== nowCarrier.id || shield ? 1 : Math.min(1, t * 14);
      world.ball.x += (touchX - world.ball.x) * settle;
      world.ball.z += (touchZ - world.ball.z) * settle;
      world.ball.y = 0.11; world.ball.vy = 0; world.ball.grounded = true;
      world.ball.vx = nowCarrier.vx * 0.35;
      world.ball.vz = nowCarrier.vz * 0.35;
    }
  }
  world.carrierId = nowCarrier && !(nowCarrier.touchCd! > 0) ? nowCarrier.id : null;
  stepBall(world.ball, t);
  resolveKeeperContact(world, previousX);
  if (goalCrossing(world, previousX)) return;
  resolveBoundary(world);
  world.clock = Math.max(0, world.clock - clockStep);
  if (world.clock <= 0) {
    if (world.half === 1) {
      world.phase = 'half-time'; world.event = 'half time'; world.eventTime = 2;
    } else {
      world.phase = 'full-time'; world.event = 'full time';
    }
  }
}

export function matchClock(world: World) {
  const elapsed = world.half === 1 ? world.halfLength - world.clock : world.halfLength * 2 - world.clock;
  const total = world.halfLength * 2;
  return Math.floor(clamp(elapsed / total, 0, 1) * 90);
}

export function humanControl(world: World, team: Team, playerId: number) {
  for (const p of world.players) if (p.team === team && p.human) p.controlled = p.id === playerId;
  world.controlled[team] = playerId;
}
