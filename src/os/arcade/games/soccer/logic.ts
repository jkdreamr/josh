import { stepBall, type BallState } from './physics.ts';

export const FIELD = { length: 42, width: 26, goalWidth: 5, goalHeight: 2.2, penaltyDepth: 8, penaltyWidth: 14, centerRadius: 4 } as const;
export const STEP = 1 / 60;
export const PLAYER_COUNT = 10;
export type Team = 0 | 1;
export type Slot = 'GK' | 'DEF' | 'LM' | 'RM' | 'FWD';
export type Action = 'pass' | 'through' | 'lob' | 'shoot' | 'finesse' | 'tackle' | 'slide' | 'skill';
export type Point = { x: number; z: number };
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
  action: string;
};
export type Command = { move: Point; sprint?: boolean; action?: Action | null; heldAction?: Action | null; aim?: Point; power?: number; pressed?: boolean; press?: boolean };
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
};

const slots: Slot[] = ['GK', 'DEF', 'LM', 'RM', 'FWD'];
const formations: Point[] = [{ x: -18.4, z: 0 }, { x: -12, z: 0 }, { x: -8, z: -6 }, { x: -8, z: 6 }, { x: -3.5, z: 0 }];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const teamDir = (team: Team, swapped = false) => (team === 0 ? 1 : -1) * (swapped ? -1 : 1);
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

export function createWorld(seed = 71423, halfLength = 120, humans: 1 | 2 = 1): World {
  const players: Player[] = [];
  for (const team of [0, 1] as const) {
    for (let i = 0; i < 5; i++) {
      const p = formations[i]!;
      const dir = teamDir(team);
      const homeHuman = team === 0 && (i === 1 || (humans === 2 && i === 2));
      players.push({
        id: team * 5 + i, team, slot: slots[i]!, x: p.x * dir, z: p.z, vx: 0, vz: 0,
        facing: dir * Math.PI / 2, stamina: 1, human: homeHuman, controlled: homeHuman && (i === 1 || humans === 1),
        cooldown: 0, action: 'idle',
      });
    }
  }
  const world: World = {
    players, ball: { x: 0, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false },
    score: [0, 0], clock: halfLength, halfLength, half: 1, endsSwapped: false,
    phase: 'restart', restart: 'kickoff', restartTeam: 0, restartAt: { x: 0, z: 0 },
    lastTouch: 0, seed: seed >>> 0 || 1, event: 'kick off', eventTime: 1.35, restartClock: 0, controlled: [1, 6], kickEvent: null, passTarget: null, passControl: false,
  };
  return world;
}

export function rng(world: World) {
  world.seed = (Math.imul(world.seed, 1664525) + 1013904223) >>> 0;
  return world.seed / 4294967296;
}

export function switchPlayer(world: World, team: Team, direction: Point = { x: 0, z: 0 }) {
  const currentId = world.controlled[team];
  const candidates = world.players.filter((p) => p.team === team && !(p.human && p.id !== currentId));
  if (!candidates.length) return currentId;
  const ball = { x: world.ball.x, z: world.ball.z };
  const norm = Math.hypot(direction.x, direction.z);
  const chosen = [...candidates].sort((a, b) => {
    const score = (p: Player) => norm > 0.2
      ? distance(p, ball) - (0.8 * ((p.x - ball.x) * direction.x + (p.z - ball.z) * direction.z) / norm)
      : distance(p, ball);
    return score(a) - score(b);
  })[0]!;
  for (const p of world.players) {
    if (p.team !== team || p.human && p.id !== currentId) continue;
    p.human = p.id === chosen.id;
    p.controlled = p.id === chosen.id;
  }
  world.controlled[team] = chosen.id;
  return chosen.id;
}

export function movePlayer(player: Player, input: Point, sprint: boolean, carrying: boolean, dt: number) {
  const magnitude = Math.hypot(input.x, input.z);
  const nx = magnitude > 1 ? input.x / magnitude : input.x;
  const nz = magnitude > 1 ? input.z / magnitude : input.z;
  const top = (sprint && player.stamina > 0.07 ? 8 : 6) * (carrying ? 0.88 : 1);
  const targetX = nx * top;
  const targetZ = nz * top;
  const accel = 34 * dt;
  player.vx += clamp(targetX - player.vx, -accel, accel);
  player.vz += clamp(targetZ - player.vz, -accel, accel);
  const speed = Math.hypot(player.vx, player.vz);
  if (speed > top) {
    player.vx *= top / speed;
    player.vz *= top / speed;
  }
  if (magnitude < 0.08) {
    player.vx *= Math.exp(-10 * dt);
    player.vz *= Math.exp(-10 * dt);
    if (Math.hypot(player.vx, player.vz) < 0.04) player.vx = player.vz = 0;
  } else {
    player.facing = Math.atan2(player.vx, player.vz);
  }
  player.x = clamp(player.x + player.vx * dt, -20.7, 20.7);
  player.z = clamp(player.z + player.vz * dt, -12.6, 12.6);
  player.stamina = clamp(player.stamina + (sprint && magnitude > 0.2 ? -0.11 : 0.06) * dt, 0, 1);
  player.cooldown = Math.max(0, player.cooldown - dt);
}

function nearestCarrier(world: World) {
  if (world.ball.y > 0.75) return null;
  return world.players.find((p) => !(p.cooldown > 0 && (p.action === 'kick' || p.action === 'pass')) && distance(p, world.ball) < 0.64);
}

function kick(world: World, player: Player, action: Action, command: Command) {
  const d = teamDir(player.team, world.endsSwapped);
  const charge = clamp(command.power ?? 0.48, 0.12, 1);
  const aim = command.aim ?? { x: d, z: 0 };
  const receiver = action === 'pass' || action === 'through' || action === 'lob'
    ? findReceiver(world, player, aim, action === 'through')
    : null;
  let targetX = player.x + aim.x;
  let targetZ = player.z + aim.z;
  if (receiver) {
    const distanceToReceiver = distance(player, receiver);
    const passSpeed = Math.max(3, (6 + distanceToReceiver * 0.72) * (0.45 + charge * 0.75));
    const travelTime = distanceToReceiver / passSpeed;
    targetX = receiver.x + receiver.vx * travelTime;
    targetZ = receiver.z + receiver.vz * travelTime;
    if (action === 'through') {
      const runSpeed = Math.hypot(receiver.vx, receiver.vz);
      const runX = runSpeed > 0.25 ? receiver.vx / runSpeed : d;
      const runZ = runSpeed > 0.25 ? receiver.vz / runSpeed : 0;
      const lead = 4 + charge * 4;
      targetX += runX * lead;
      targetZ += runZ * lead;
    }
    if (action === 'lob') {
      targetX = receiver.x + receiver.vx * 0.7;
      targetZ = receiver.z + receiver.vz * 0.7;
    }
  }
  const shotTargetZ = action === 'shoot' || action === 'finesse'
    ? clamp(player.z + (Math.sign(aim.z || -player.z || 1) * Math.min(3.7, Math.abs(aim.z) * 2.5 + 1.1)), -FIELD.goalWidth * 0.42, FIELD.goalWidth * 0.42)
    : targetZ;
  if (action === 'shoot' || action === 'finesse') {
    targetX = d * (FIELD.length / 2 + 1);
    targetZ = shotTargetZ;
  }
  const directionX = targetX - player.x;
  const directionZ = targetZ - player.z;
  const distanceToTarget = Math.hypot(directionX, directionZ) || 1;
  const baseAngle = Math.atan2(directionZ, directionX);
  const opponents = world.players.filter((p) => p.team !== player.team);
  const pressure = Math.min(...opponents.map((p) => distance(p, player)));
  const goalDistance = Math.hypot(FIELD.length / 2 - Math.abs(player.x), player.z);
  const angleFactor = clamp(Math.abs(player.z) / Math.max(3, goalDistance), 0, 1);
  const shotError = action === 'shoot' || action === 'finesse'
    ? 0.035 + goalDistance * 0.005 + angleFactor * 0.16 + (pressure < 1.5 ? 0.12 : 0) + (1 - player.stamina) * 0.12
    : 0.015 + (1 - player.stamina) * 0.06;
  const error = (rng(world) - 0.5) * (shotError + charge * (action === 'finesse' ? 0.025 : 0.09));
  const a = baseAngle + error;
  const speed = action === 'pass'
    ? Math.max(3, (6 + distanceToTarget * 0.72) * (0.45 + charge * 0.75))
    : action === 'through' ? 11 + charge * 11
      : action === 'lob' ? 10 + charge * 9
        : action === 'finesse' ? 15 + charge * 8
          : 14 + charge * 16;
  const loft = action === 'lob'
    ? 0.42
    : action === 'through'
      ? 0.14
      : action === 'shoot' || action === 'finesse'
        ? 0.08 + charge * 0.08 + Math.max(0, charge - 0.85) * 2.8
        : 0.05;
  const horizontal = speed * Math.cos(loft);
  world.ball.vx = Math.cos(a) * horizontal;
  world.ball.vz = Math.sin(a) * horizontal;
  world.ball.vy = speed * Math.sin(loft);
  world.ball.spin = action === 'finesse' ? Math.sign(directionZ || 1) * 9 : 0;
  world.ball.grounded = false;
  world.ball.inNet = false;
  world.lastTouch = player.team;
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
}

export function findReceiver(world: World, from: Player, direction: Point, through: boolean) {
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
    const score = angle * 18 + targetDistance * 0.12 + (blocked ? 8 : 0)
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

function applyAction(world: World, player: Player, command: Command) {
  if (!command.action || !command.pressed || player.cooldown > 0) return;
  const capSpeed = () => {
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 8) {
      player.vx = player.vx / speed * 8;
      player.vz = player.vz / speed * 8;
    }
  };
  if (command.action === 'tackle' || command.action === 'slide') {
    const enemy = world.players.filter((p) => p.team !== player.team).sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
    const ballDistance = distance(player, world.ball);
    if (enemy && ballDistance < (command.action === 'slide' ? 3 : 1.4)) {
      const from = Math.atan2(player.x - enemy.x, player.z - enemy.z);
      const behind = Math.abs(Math.atan2(Math.sin(enemy.facing - from), Math.cos(enemy.facing - from))) > 2.1;
      const towardBall = Math.atan2(world.ball.x - player.x, world.ball.z - player.z);
      const facingError = Math.abs(Math.atan2(Math.sin(towardBall - player.facing), Math.cos(towardBall - player.facing)));
      if (behind && command.action === 'slide') {
        world.event = 'foul'; world.eventTime = 1.5;
        setRestart(world, enemy.team, 'free-kick', { x: world.ball.x, z: world.ball.z });
        if (Math.abs(world.ball.x) > FIELD.length / 2 - FIELD.penaltyDepth) world.restart = 'penalty';
      } else if (command.action === 'slide' || facingError < 1.3) {
        const touch = command.action === 'slide' ? 0.58 : 0.42;
        world.ball.x = player.x + Math.sin(player.facing) * touch;
        world.ball.z = player.z + Math.cos(player.facing) * touch;
        world.ball.y = 0.11;
        world.ball.grounded = true;
        world.ball.vx = player.vx * 0.35;
        world.ball.vy = 0;
        world.ball.vz = player.vz * 0.35;
        world.lastTouch = player.team;
      }
    }
    player.cooldown = command.action === 'slide' ? 0.7 : 0.35;
    player.action = command.action;
    capSpeed();
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
  if (!nearestCarrier(world) || nearestCarrier(world)?.id !== player.id) return;
  const aim = command.aim ?? { x: teamDir(player.team, world.endsSwapped), z: 0 };
  if (command.action === 'pass' || command.action === 'through') {
    const target = findReceiver(world, player, aim, command.action === 'through');
    if (target) {
      const lead = command.action === 'through' ? 2 : 0;
      const tx = target.x + target.vx * lead;
      const tz = target.z + target.vz * lead;
      kick(world, player, command.action, { ...command, aim: { x: tx - player.x, z: tz - player.z } });
      return;
    }
  }
  kick(world, player, command.action, command);
}

function setRestart(world: World, team: Team, restart: Exclude<Restart, null>, at: Point) {
  world.phase = 'restart';
  world.restart = restart;
  world.restartTeam = team;
  world.restartAt = { x: clamp(at.x, -20, 20), z: clamp(at.z, -12, 12) };
  world.ball = { x: world.restartAt.x, y: 0.11, z: world.restartAt.z, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  world.event = restart === 'goal-kick' ? 'goal kick' : restart;
  world.eventTime = 2;
  world.restartClock = 0;
}

export function resolveBoundary(world: World) {
  const b = world.ball;
  if (Math.abs(b.z) > FIELD.width / 2 + 0.04) {
    const awarded: Team = world.lastTouch === 0 ? 1 : 0;
    setRestart(world, awarded, 'kick-in', { x: clamp(b.x, -20, 20), z: Math.sign(b.z) * (FIELD.width / 2 - 0.15) });
    return 'kick-in';
  }
  if (Math.abs(b.x) > FIELD.length / 2 + 0.12) {
    const defending: Team = b.x > 0 ? (world.endsSwapped ? 0 : 1) : (world.endsSwapped ? 1 : 0);
    const attacking: Team = defending === 0 ? 1 : 0;
    if (world.lastTouch === defending) {
      setRestart(world, attacking, 'corner', { x: Math.sign(b.x) * 20.6, z: Math.sign(b.z || 1) * 12.1 });
      return 'corner';
    }
    setRestart(world, defending, 'goal-kick', { x: Math.sign(b.x) * 15, z: 0 });
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

export function stepWorld(world: World, dt: number, commands: Map<number, Command> = new Map()) {
  const t = Math.min(0.05, Math.max(0, dt));
  world.eventTime = Math.max(0, world.eventTime - t);
  world.kickEvent = null;
  if (world.phase === 'full-time') return;
  if (world.phase === 'goal' || world.phase === 'half-time') {
    if (world.eventTime <= 0) {
    if (world.phase === 'half-time') {
      world.half = 2; world.endsSwapped = !world.endsSwapped; world.clock = world.halfLength;
        world.phase = 'restart'; world.restart = 'kickoff'; world.restartTeam = 1; world.event = 'second half'; world.eventTime = 2; world.restartClock = 0;
      } else {
        world.phase = 'restart';
        world.ball.x = 0; world.ball.z = 0; world.ball.y = 0.11;
        world.restartAt = { x: 0, z: 0 };
        world.eventTime = 2;
        world.restartClock = 0;
      }
    }
    return;
  }
  if (world.phase === 'restart') {
    world.restartClock += t;
    for (const p of world.players) {
      if (p.team === world.restartTeam && p.controlled) movePlayer(p, commands.get(p.id)?.move ?? { x: 0, z: 0 }, !!commands.get(p.id)?.sprint, false, t);
      if (p.team !== world.restartTeam && world.restart === 'kickoff') {
        const direction = teamDir(p.team, world.endsSwapped);
        if (p.x * direction > 0) p.x = -direction * 0.8;
        if (Math.hypot(p.x, p.z) < 4) {
          const angle = Math.atan2(p.z, p.x);
          p.x = Math.cos(angle) * 4;
          p.z = Math.sin(angle) * 4;
        }
      } else if (p.team !== world.restartTeam && distance(p, world.restartAt) < 4) {
        const dx = p.x - world.restartAt.x;
        const dz = p.z - world.restartAt.z;
        const d = Math.hypot(dx, dz) || 1;
        p.x = world.restartAt.x + dx / d * 4;
        p.z = world.restartAt.z + dz / d * 4;
      }
    }
    const taker = (world.restart === 'goal-kick'
      ? world.players.find((p) => p.team === world.restartTeam && p.slot === 'GK')
      : undefined)
      ?? world.players.find((p) => p.team === world.restartTeam && p.controlled)
      ?? world.players.filter((p) => p.team === world.restartTeam).sort((a, b) => distance(a, world.restartAt) - distance(b, world.restartAt))[0]!;
    const action = commands.get(taker.id);
    world.clock = Math.max(0, world.clock - t);
    const moved = Math.hypot(action?.move.x ?? 0, action?.move.z ?? 0) > 0.05;
    if ((action?.pressed && action.action) || moved || world.restartClock >= 10) {
      world.phase = 'live';
      world.ball.x = world.restartAt.x; world.ball.z = world.restartAt.z; world.ball.y = 0.11;
      if (action?.action) kick(world, taker, action.action, action);
      world.restart = null;
    }
    return;
  }
  const previousX = world.ball.x;
  const carrier = nearestCarrier(world);
  for (const p of world.players) {
    const command = commands.get(p.id);
    if (p.human && !p.controlled) continue;
    if (p.human && !command) continue;
    const receiving = world.passTarget === p.id && !carrier;
    const receiveMove = receiving ? { x: world.ball.x - p.x, z: world.ball.z - p.z } : command?.move ?? { x: 0, z: 0 };
    movePlayer(p, receiveMove, receiving || !!command?.sprint, carrier?.id === p.id, t);
    if (command) applyAction(world, p, command);
  }
  for (const command of commands.values()) {
    if (!command.press) continue;
    const player = world.players.find((p) => commands.get(p.id) === command);
    const team = player?.team;
    if (!player || team === undefined) continue;
    const carrier = world.players.find((p) => p.team !== team && distance(p, world.ball) < 1.2);
    if (!carrier) continue;
    const presser = world.players.filter((p) => p.team === team && !p.human).sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
    if (presser) {
      const command = commands.get(presser.id) ?? { move: { x: 0, z: 0 } };
      command.move = { x: world.ball.x - presser.x, z: world.ball.z - presser.z };
      command.sprint = true;
      commands.set(presser.id, command);
    }
  }
  const nowCarrier = nearestCarrier(world);
  if (carrier?.human && (!nowCarrier || nowCarrier.id !== carrier.id)) {
    switchPlayer(world, carrier.team);
  }
  if (nowCarrier && world.passTarget === nowCarrier.id) {
    if (world.passControl) {
      for (const teammate of world.players) {
        if (teammate.team !== nowCarrier.team) continue;
        teammate.human = teammate.id === nowCarrier.id;
        teammate.controlled = teammate.id === nowCarrier.id;
      }
      world.controlled[nowCarrier.team] = nowCarrier.id;
    }
    world.passTarget = null;
    world.passControl = false;
  }
  if (nowCarrier) {
    world.lastTouch = nowCarrier.team;
    const d = teamDir(nowCarrier.team, world.endsSwapped);
    const touchDistance = 0.62 + (Math.hypot(nowCarrier.vx, nowCarrier.vz) > 6 ? 0.18 : 0);
    const touchX = nowCarrier.x + Math.sin(nowCarrier.facing || d * Math.PI / 2) * touchDistance;
    const touchZ = nowCarrier.z + Math.cos(nowCarrier.facing || d * Math.PI / 2) * touchDistance;
    if (world.ball.grounded) {
      world.ball.x += (touchX - world.ball.x) * Math.min(1, t * 7);
      world.ball.z += (touchZ - world.ball.z) * Math.min(1, t * 7);
      world.ball.vx = nowCarrier.vx * 0.35;
      world.ball.vz = nowCarrier.vz * 0.35;
    }
  }
  stepBall(world.ball, t);
  resolveKeeperContact(world, previousX);
  if (goalCrossing(world, previousX)) return;
  resolveBoundary(world);
  world.clock = Math.max(0, world.clock - t);
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
