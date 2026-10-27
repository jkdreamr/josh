import { createWorld, distance, FIELD, FORMATION, findReceiver, groundPassPower, isCross, movePlayer, nearestCarrier, restartTaker, shotAim, shotError, shotOverchargeThreshold, shotSpeed, STEP, stepWorld, teamDir, type Command, type Player, type Point, type Team, type World } from './logic.ts';

export const LEVEL_NAMES = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVEL_NAMES)[number];
const reaction = { easy: 0.6, normal: 0.3, hard: 0.18 } as const;
const keeperReaction = { easy: 0.6, normal: 0.42, hard: 0.2 } as const;
const keeperReadDelay = { easy: 0.7, normal: 0.36, hard: 0.16 } as const;
const keeperReadNoise = { easy: 0.28, normal: 0.08, hard: 0.01 } as const;
const decisionInterval = { easy: 0.7, normal: 0.3, hard: 0.24 } as const;
const noise = { easy: 0.65, normal: 0.2, hard: 0.03 } as const;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const outfield = (player: Player) => player.slot !== 'GK';
type Role = { line: 'gk' | 'def' | 'mid' | 'att'; lateral: number; freedom: number; overlap?: boolean };
const ROLES: Record<string, Role> = {
  GK: { line: 'gk', lateral: 0, freedom: 0 },
  DEF: { line: 'def', lateral: 0, freedom: 0.04 },
  LM: { line: 'mid', lateral: -0.36, freedom: 0.12, overlap: true },
  RM: { line: 'mid', lateral: 0.36, freedom: 0.12, overlap: true },
  FWD: { line: 'att', lateral: 0, freedom: 0.2 },
  LB: { line: 'def', lateral: -0.38, freedom: 0.1, overlap: true },
  CB: { line: 'def', lateral: 0, freedom: 0.03 },
  LCB: { line: 'def', lateral: -0.13, freedom: 0.03 },
  RCB: { line: 'def', lateral: 0.13, freedom: 0.03 },
  RB: { line: 'def', lateral: 0.38, freedom: 0.1, overlap: true },
  CM: { line: 'mid', lateral: 0, freedom: 0.1 },
  LCM: { line: 'mid', lateral: -0.19, freedom: 0.1 },
  RCM: { line: 'mid', lateral: 0.19, freedom: 0.1 },
  LW: { line: 'att', lateral: -0.36, freedom: 0.19 },
  ST: { line: 'att', lateral: 0, freedom: 0.2 },
  RW: { line: 'att', lateral: 0.36, freedom: 0.19 },
};
const roleOf = (p: Player): Role => ROLES[p.slot] ?? { line: 'mid', lateral: 0, freedom: 0.1 };
const longitudinal = (fraction: number) => FIELD.length * fraction;
const lateral = (fraction: number) => FIELD.width * fraction;
const rosterIndex = (world: World, p: Player) => world.players.filter((q) => q.team === p.team).indexOf(p);
const targetMove = (player: Player, x: number, z: number, arrivalRadius = 0.35) => {
  const dx = x - player.x, dz = z - player.z;
  const gap = Math.hypot(dx, dz);
  return gap < arrivalRadius ? { x: 0, z: 0 } : { x: dx / Math.max(1.4, gap), z: dz / Math.max(1.4, gap) };
};

type TeamState = { possession: boolean; changedAt: number };
type KeeperRead = { startedAt: number; decided: boolean; dive: boolean; kick: World['kickEvent'] };
type MatchState = {
  tick: number;
  carrier: Player | null;
  possession: Team;
  teams: [TeamState, TeamState];
  runs: Map<number, { until: number; x: number; z: number }>;
  keeperReads: Map<number, KeeperRead>;
  keeperTargets: Map<number, Point>;
};
const matches = new WeakMap<World, MatchState>();

function matchState(world: World, tick: number) {
  let state = matches.get(world);
  if (!state || tick < state.tick) {
    state = { tick: -1, carrier: null, possession: world.lastTouch,
      teams: [{ possession: world.lastTouch === 0, changedAt: tick }, { possession: world.lastTouch === 1, changedAt: tick }], runs: new Map(), keeperReads: new Map(), keeperTargets: new Map() };
    matches.set(world, state);
  }
  if (state.tick === tick) return state;
  state.tick = tick;
  state.carrier = nearestCarrier(world) ?? null;
  const possession = state.carrier?.team ?? world.lastTouch;
  if (possession !== state.possession) {
    state.possession = possession;
    for (const team of [0, 1] as const) {
      state.teams[team] = { possession: possession === team, changedAt: tick };
    }
    state.runs.clear();
  }
  const kick = world.kickEvent;
  if (kick && (kick.action === 'pass' || kick.action === 'through')) {
    const passer = world.players.find((p) => p.id === kick.playerId)!;
    state.runs.set(passer.id, { until: tick + 78,
      x: clamp(passer.x + teamDir(passer.team, world.endsSwapped) * longitudinal(0.14), -longitudinal(0.44), longitudinal(0.44)),
      z: clamp(passer.z + (passer.z > 0 ? -1 : 1) * lateral(0.1), -lateral(0.4), lateral(0.4)) });
  }
  if (world.phase !== 'live') { state.runs.clear(); state.keeperReads.clear(); state.keeperTargets.clear(); }
  for (const [id, run] of state.runs) if (run.until < tick) state.runs.delete(id);
  return state;
}

function laneClearance(world: World, from: Point, to: Point, team: Team, shot = false) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length2 = dx * dx + dz * dz || 1;
  let clearance = 10;
  for (const p of world.players) {
    if (p.team === team || shot && !outfield(p)) continue;
    const t = ((p.x - from.x) * dx + (p.z - from.z) * dz) / length2;
    if (t <= 0.04 || t >= 1.05) continue;
    clearance = Math.min(clearance, Math.hypot(p.x - from.x - dx * t, p.z - from.z - dz * t));
  }
  return clearance;
}

export function keeperTarget(world: World, keeper: Player, target = { x: 0, z: 0 }) {
  const dir = teamDir(keeper.team, world.endsSwapped);
  const goalX = -dir * FIELD.length / 2;
  const near = clamp(1 - Math.abs(world.ball.x - goalX) / longitudinal(0.38), 0, 1);
  const ballDepth = Math.max(0.5, (world.ball.x - goalX) * dir);
  const leftAngle = Math.atan2(world.ball.z + FIELD.goalWidth / 2, ballDepth);
  const rightAngle = Math.atan2(world.ball.z - FIELD.goalWidth / 2, ballDepth);
  const bisector = (leftAngle + rightAngle) / 2;
  const offLine = 0.65 + near * 2;
  target.x = goalX + dir * offLine;
  const postLimit = FIELD.goalWidth / 2 - FIELD.goalWidth * 0.04;
  target.z = clamp(Math.tan(bisector) * offLine, -postLimit, postLimit);
  const plane = goalX + dir * 1.5;
  const towardGoal = world.ball.vx * -dir > 3;
  const flight = towardGoal ? (plane - world.ball.x) / world.ball.vx : -1;
  if (flight >= 0 && flight < 1.4) {
    const prediction = flight * 0.13;
    target.z = clamp(target.z * (1 - prediction) + (world.ball.z + world.ball.vz * flight) * prediction, -FIELD.goalWidth / 2, FIELD.goalWidth / 2);
  }
  return target;
}

function readKeeperShot(world: World, keeper: Player, level: Level, tick: number, state: MatchState) {
  const dir = teamDir(keeper.team, world.endsSwapped);
  const flight = (-dir * (FIELD.length / 2 - 1.5) - world.ball.x) / world.ball.vx;
  const crossing = world.ball.z + world.ball.vz * flight;
  const kick = world.kickEvent;
  const struck = kick && (kick.action === 'shoot' || kick.action === 'finesse');
  const incoming = world.ball.vx * -dir > (struck ? 3 : 8) && flight > 0 && flight < 1.6
    && Math.abs(crossing) < FIELD.goalWidth / 2 + 1.5;
  if (!incoming) {
    state.keeperReads.delete(keeper.id);
    if (keeper.action === 'dive') keeper.action = 'ready';
    return;
  }
  let read = state.keeperReads.get(keeper.id);
  if (!read || struck && read.kick !== kick) {
    read = { startedAt: tick, decided: false, dive: false, kick };
    state.keeperReads.set(keeper.id, read);
  }
  if (!read.decided && tick - read.startedAt >= Math.round(keeperReadDelay[level] * 60)) {
    const error = Math.sin((read.startedAt + rosterIndex(world, keeper) * 17) * 0.73) * FIELD.goalWidth * keeperReadNoise[level];
    const predicted = crossing + error;
    read.dive = Math.abs(predicted - keeper.z) > 1.1 && Math.abs(predicted) < FIELD.goalWidth / 2 + 0.5;
    read.decided = true;
  }
  keeper.action = read.decided && read.dive ? 'dive' : 'ready';
}

export function cpuShotChoice(world: World, player: Player, level: Level, tick: number, dt = STEP) {
  const prepared = { ...player };
  movePlayer(prepared, { x: 0, z: 0 }, false, true, dt);
  const dir = teamDir(player.team, world.endsSwapped);
  const goalX = dir * FIELD.length / 2;
  const range = Math.max(0.1, Math.abs(goalX - world.ball.x));
  const planeRange = Math.max(0.1, range - 1.5);
  const keeper = world.players.find((p) => p.team !== player.team && p.slot === 'GK');
  const uncertainty = Math.sin((tick + rosterIndex(world, player) * 31) * 0.37);
  const estimate = level === 'hard' ? 1 : level === 'normal' ? 0.9 + uncertainty * 0.1 : 0.65 + uncertainty * 0.3;
  const keeperZ = (keeper?.z ?? 0) + uncertainty * (level === 'hard' ? 0 : noise[level]);
  const half = FIELD.goalWidth / 2 - 0.11;
  const low = Math.atan2(-half - world.ball.z, range), high = Math.atan2(half - world.ball.z, range);
  const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  const safePower = Math.min(0.9, shotOverchargeThreshold(distance(prepared, { x: goalX, z: 0 })) - 0.025);
  let best = { targetZ: 0, power: safePower, probability: -1, onTarget: -1 };
  let safe: typeof best | undefined;
  for (const power of [0.65, 0.75, safePower]) {
    const flight = planeRange / shotSpeed(power);
    const dive = clamp((flight - keeperReadDelay.normal + reaction.normal / 2) / reaction.normal, 0, 1);
    const targets = Array.from({ length: 25 }, (_, i) => (i / 12 - 1) * FIELD.goalWidth * 0.43);
    for (const sign of [-1, 1]) {
      let z = sign * FIELD.goalWidth * 0.43;
      for (let i = 0; i < 3; i++) {
        const error = shotError(world, prepared, { x: goalX, z }, power) * estimate;
        const edge = sign > 0 ? high : low;
        z = clamp(world.ball.z + range * Math.tan(edge - sign * error / 2), -FIELD.goalWidth * 0.43, FIELD.goalWidth * 0.43);
      }
      targets.push(clamp(z - sign * 0.03, -FIELD.goalWidth * 0.43, FIELD.goalWidth * 0.43));
    }
    for (const targetZ of targets) {
      const error = shotError(world, prepared, { x: goalX, z: targetZ }, power) * estimate;
      const angle = Math.atan2(targetZ - world.ball.z, range);
      const a = angle - error / 2, b = angle + error / 2;
      const onTarget = overlap(a, b, low, high) / error;
      const saved = (reach: number) => overlap(Math.max(a, low), Math.min(b, high), Math.atan2(keeperZ - reach - world.ball.z, planeRange), Math.atan2(keeperZ + reach - world.ball.z, planeRange)) / error;
      const probability = onTarget - (keeper ? saved(1.1) * (1 - dive) + saved(2.4) * dive : 0);
      if (probability > best.probability + 1e-9 || Math.abs(probability - best.probability) <= 1e-9
        && (onTarget > best.onTarget + 1e-9 || Math.abs(onTarget - best.onTarget) <= 1e-9 && power > best.power)) {
        best = { targetZ, power, probability, onTarget };
      }
      if (onTarget >= 1 - 1e-9 && (!safe || probability > safe.probability + 1e-9
        || Math.abs(probability - safe.probability) <= 1e-9 && power > safe.power)) safe = { targetZ, power, probability, onTarget };
    }
  }
  return safe ?? best;
}

function carrierCommand(world: World, player: Player, level: Level, tick: number, dt = STEP): Command {
  const dir = teamDir(player.team, world.endsSwapped);
  const goalX = dir * FIELD.length / 2;
  const goalDistance = Math.hypot(goalX - player.x, player.z);
  const opponents = world.players.filter((p) => p.team !== player.team);
  const pressure = Math.min(...opponents.map((p) => distance(p, player)));
  const facingForward = Math.sin(player.facing) * dir > 0.4;
  const nearest = [...opponents].sort((a, b) => distance(a, player) - distance(b, player))[0]!;
  const evade = opponents.reduce((z, p) => {
    const gap = distance(p, player);
    return gap < 3 ? z + (player.z - p.z) / Math.max(0.5, gap) : z;
  }, 0);
  const blocked = (nearest.x - player.x) * dir > 0 && pressure < 3;
  const escape = Math.sign(player.z - nearest.z || (roleOf(player).lateral || 1));
  const movement = { x: dir * (blocked ? 0.45 : 1), z: clamp(-player.z * (goalDistance < longitudinal(0.38) ? 0.22 : 0.06) + evade * 0.6 + (blocked ? escape : 0), -1, 1) };
  const wait: Command = { move: movement, aim: { x: dir, z: -player.z * 0.05 }, sprint: false };
  const interval = Math.round(decisionInterval[level] * 60);
  if ((tick + rosterIndex(world, player) * 3) % interval !== 0 || player.cooldown > 0) return wait;
  const qualityNoise = Math.sin((tick + rosterIndex(world, player) * 31) * 0.37) * noise[level];
  const shotLane = laneClearance(world, player, { x: goalX, z: -Math.sign(player.z) * FIELD.goalWidth * 0.32 }, player.team, true);
  const goodAngle = Math.abs(player.z) < lateral(level === 'easy' ? 0.21 : 0.18) && Math.abs(player.z) / Math.max(3, Math.abs(goalX - player.x)) < 0.8;
  const shootRange = level === 'easy' ? 18 : 12;
  if (goalDistance < shootRange && goodAngle && pressure > 1.5 + qualityNoise && shotLane > 0.18 + Math.abs(qualityNoise) * 0.3) {
    const choice = cpuShotChoice(world, player, level, tick, dt);
    return { move: { x: 0, z: 0 }, action: 'shoot', pressed: true,
      power: choice.power, aim: shotAim(choice.targetZ, dir) };
  }
  const lastDefender = Math.max(...opponents.filter(outfield).map((p) => p.x * dir));
  let best: { receiver: Player; action: 'pass' | 'through' | 'lob'; score: number } | null = null;
  for (const receiver of world.players) {
    if (receiver.team !== player.team || receiver.id === player.id) continue;
    const gap = distance(player, receiver);
    if (gap < 3 || gap > longitudinal(0.4)) continue;
    const forward = (receiver.x - player.x) * dir;
    const space = Math.min(...opponents.map((p) => distance(p, receiver)));
    const lane = laneClearance(world, player, receiver, player.team);
    const optionNoise = Math.sin((tick + rosterIndex(world, receiver) * 17) * 0.19) * noise[level];
    if (lane < 0.8 - optionNoise * 0.5 || space < 1.2 - optionNoise * 0.5) continue;
    let action: 'pass' | 'through' | 'lob' = 'pass';
    if (facingForward && pressure > 3 && forward > longitudinal(0.12) && gap < longitudinal(0.31)
      && receiver.x * dir > lastDefender - 1 && receiver.vx * dir > 2 && space > 4) action = 'through';
    if (Math.abs(player.z) > lateral(0.3) && player.x * dir > longitudinal(0.22) && roleOf(receiver).line === 'att'
      && Math.abs(receiver.z) < lateral(0.2) && space > 3) action = 'lob';
    const aim = { x: receiver.x - player.x, z: receiver.z - player.z };
    if (findReceiver(world, player, aim, action === 'through', action === 'lob' && isCross(world, player))?.id !== receiver.id) continue;
    const score = forward * 0.16 + Math.min(space, 6) * 0.12 + Math.min(lane, 4) * 0.08
      - gap * 0.025 + (action === 'through' ? 0.5 : 0) + optionNoise
      + (receiver.slot === 'GK' ? -0.8 : 0);
    if (!best || score > best.score) best = { receiver, action, score };
  }
  if (best && ((pressure < 2.5 && (best.receiver.x - player.x) * dir > -1) || pressure < 1.4
    || (best.score > 1.5 && (best.receiver.x - player.x) * dir > 4) || player.slot === 'GK')) {
    return { move: { x: 0, z: 0 }, action: best.action, pressed: true,
      power: best.action === 'pass' ? groundPassPower(distance(player, best.receiver)) : 0.5,
      aim: { x: best.receiver.x - player.x, z: best.receiver.z - player.z } };
  }
  if (player.slot === 'GK') return { move: { x: 0, z: 0 } };
  return wait;
}

function shapeTarget(world: World, p: Player, state: MatchState) {
  if (!state.carrier && world.passTarget === p.id && world.passPoint) return { ...world.passPoint };
  const dir = teamDir(p.team, world.endsSwapped);
  const ballProgress = world.ball.x * dir;
  const hasBall = state.possession === p.team;
  const role = roleOf(p);
  const anchor = hasBall ? clamp(ballProgress - longitudinal(0.07), -longitudinal(0.24), longitudinal(0.19))
    : clamp(ballProgress - longitudinal(0.1), -longitudinal(0.31), longitudinal(0.1));
  const siblings = world.players.filter((q) => q.team === p.team && q.slot === p.slot);
  const homeSide = FORMATION[rosterIndex(world, p)]?.slot === p.slot
    ? FORMATION[rosterIndex(world, p)]!.z / FIELD.width
    : role.lateral + (siblings.indexOf(p) - (siblings.length - 1) / 2) * 0.24;
  const side = world.ball.z * (hasBall ? 0.15 : 0.5);
  let progress = anchor + longitudinal(role.line === 'def' ? (hasBall ? -0.17 : -0.15) : role.line === 'att' ? (hasBall ? 0.21 : 0.15) : 0.02);
  let z = lateral(homeSide) * (hasBall ? 1 : 0.75) + side;
  if (hasBall && role.line === 'def' && ballProgress > 0) progress = clamp(ballProgress - longitudinal(0.29), -longitudinal(0.05), longitudinal(0.12));
  const carrier = state.carrier;
  if (hasBall && carrier?.team === p.team) {
    const dirFacing = Math.sin(carrier.facing) * dir;
    if (role.line === 'att') {
      const line = Math.max(...world.players.filter((q) => q.team !== p.team && outfield(q)).map((q) => q.x * dir));
      const pressure = Math.min(...world.players.filter((q) => q.team !== p.team).map((q) => distance(q, carrier)));
      progress = carrier.x * dir + longitudinal(0.13);
      if (dirFacing > 0.4 && pressure > 3.5 && tickWindow(state.tick)) progress = Math.max(progress, line + 1);
      z = lateral(homeSide) + (carrier.z > 0 ? -1 : 1) * lateral(0.1);
    }
    if (role.overlap && Math.sign(carrier.z) === Math.sign(z) && Math.abs(carrier.z) > lateral(0.2)) progress += longitudinal(role.freedom);
  }
  const run = state.runs.get(p.id);
  if (hasBall && run) return { x: run.x, z: run.z };
  const keeper = world.players.find((q) => q.team === p.team && q.slot === 'GK')!;
  progress = Math.max(progress, keeper.x * dir + 0.75);
  return { x: dir * clamp(progress, -longitudinal(0.44), longitudinal(0.44)), z: clamp(z, -lateral(0.4), lateral(0.4)) };
}

const tickWindow = (tick: number) => tick % 180 < 75;

export function computeAI(world: World, level: Level, dt: number, tick: number, team?: Team, commands = new Map<number, Command>()) {
  commands.clear();
  const state = matchState(world, tick);
  const carrier = state.carrier;
  const targets = new Map<number, Point>();
  for (const side of [0, 1] as const) {
    if (team !== undefined && team !== side) continue;
    const players = world.players.filter((p) => p.team === side);
    const dir = teamDir(side, world.endsSwapped);
    const ownGoal = { x: -dir * FIELD.length / 2, z: 0 };
    const defenders = players.filter(outfield).sort((a, b) => distance(a, world.ball) - distance(b, world.ball));
    const presser = defenders[0];
    const cover = defenders[1];
    const threats = world.players.filter((p) => p.team !== side && outfield(p) && p.id !== carrier?.id)
      .sort((a, b) => distance(a, ownGoal) - distance(b, ownGoal));
    const marked = new Set<number>();
    for (const p of players) {
      if (p.human || p.controlled) continue;
      if (world.phase !== 'live') {
        if (world.phase === 'restart' && side === world.restartTeam) {
          const taker = restartTaker(world);
          if (p.id === taker.id) {
            const receiver = players.filter((q) => q.id !== p.id && outfield(q))
              .sort((a, b) => distance(a, world.restartAt) - distance(b, world.restartAt))[0]!;
            commands.set(p.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.4,
              aim: { x: receiver.x - world.restartAt.x, z: receiver.z - world.restartAt.z } });
          }
        }
        continue;
      }
      if (p.slot === 'GK') {
        if (carrier?.id === p.id) {
          const command = world.event === 'keeper claims it' && world.eventTime > 0.25
            ? { move: { x: 0, z: 0 } } : carrierCommand(world, p, level, tick);
          command.move = { x: 0, z: 0 };
          commands.set(p.id, command);
          continue;
        }
        readKeeperShot(world, p, level, tick, state);
        const reacts = tick % Math.round(keeperReaction[level] * 60) === 0;
        if (reacts || !state.keeperTargets.has(p.id) || Math.abs(p.z) > FIELD.goalWidth / 2 + 1
          || Math.abs(p.x - ownGoal.x) > FIELD.penaltyDepth - 1) state.keeperTargets.set(p.id, keeperTarget(world, p));
        const target = state.keeperTargets.get(p.id)!;
        commands.set(p.id, { move: targetMove(p, target.x, target.z), sprint: false });
        continue;
      }
      if (carrier?.id === p.id) {
        commands.set(p.id, carrierCommand(world, p, level, tick, dt));
        continue;
      }
      if (state.possession !== side || !carrier && world.passTarget === null) {
        if (p.id === presser?.id) {
          const receiver = world.players.find((q) => q.id === world.passTarget && q.team !== side);
          const opponent = carrier?.team !== side ? carrier ?? receiver : receiver;
          if (opponent) {
            const dx = ownGoal.x - opponent.x, dz = -opponent.z;
            const length = Math.hypot(dx, dz) || 1;
            const target = { x: opponent.x + dx / length * 2, z: opponent.z + dz / length * 2 };
            const move = targetMove(p, target.x, target.z);
            const gap = distance(p, world.ball);
            const facingAway = Math.sin(opponent.facing) * -dir < 0.2;
            const exposed = distance(opponent, world.ball) > 0.48;
            const reacts = (tick + rosterIndex(world, p) * 2) % Math.round(reaction[level] * 60) === 0;
            commands.set(p.id, { move: gap < 1.38 && reacts && (exposed || facingAway) ? targetMove(p, world.ball.x, world.ball.z) : distance(p, target) < 0.65
              ? { x: opponent.vx / 6, z: opponent.vz / 6 } : move,
              sprint: distance(p, target) > 4, action: carrier && gap < 1.38 && (exposed || facingAway) ? 'tackle' : null, pressed: reacts });
          } else {
            const flight = clamp(distance(p, world.ball) / 8, 0, 0.7);
            commands.set(p.id, { move: targetMove(p, clamp(world.ball.x + world.ball.vx * flight, -FIELD.length / 2, FIELD.length / 2),
              clamp(world.ball.z + world.ball.vz * flight, -FIELD.width / 2, FIELD.width / 2)), sprint: true });
          }
          continue;
        }
        if (p.id === cover?.id && carrier?.team !== side && carrier) {
          const dx = ownGoal.x - carrier.x, dz = -carrier.z;
          const length = Math.hypot(dx, dz) || 1;
          targets.set(p.id, { x: carrier.x + dx / length * longitudinal(0.135), z: carrier.z + dz / length * longitudinal(0.135) });
          continue;
        }
      }
      let target = shapeTarget(world, p, state);
      let marking: Player | undefined;
      if (state.possession !== side) {
        const line = roleOf(p).line;
        const threat = threats.find((q) => !marked.has(q.id) && distance(q, target) < longitudinal(0.14)
          && roleOf(q).line === (line === 'def' ? 'att' : line === 'att' ? 'def' : 'mid'));
        if (threat) {
          marking = threat;
          marked.add(threat.id);
          const dx = ownGoal.x - threat.x, dz = -threat.z;
          const length = Math.hypot(dx, dz) || 1;
          target = { x: threat.x + dx / length * 1.5, z: threat.z + dz / length * 1.5 };
        }
      }
      if (roleOf(p).line === 'def' && distance(p, world.ball) > 12) {
        const time = tick * dt;
        if (marking) {
          const angle = Math.sin(time * 1.35 + p.id * 1.7) * 0.22;
          const dx = target.x - marking.x, dz = target.z - marking.z;
          target = { x: marking.x + dx * Math.cos(angle) - dz * Math.sin(angle), z: marking.z + dx * Math.sin(angle) + dz * Math.cos(angle) };
        } else target = {
          x: clamp(target.x + Math.sin(time * 1.35 + p.id * 1.7) * 0.45, -FIELD.length / 2 + 0.3, FIELD.length / 2 - 0.3),
          z: clamp(target.z + Math.cos(time * 1.05 + p.id * 0.9) * 0.65, -FIELD.width / 2 + 0.3, FIELD.width / 2 - 0.3),
        };
      }
      targets.set(p.id, target);
    }
  }
  const shaped = world.players.filter((p) => targets.has(p.id));
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < shaped.length; i++) {
    const a = shaped[i]!, ta = targets.get(a.id)!;
    for (let j = i + 1; j < shaped.length; j++) {
      const b = shaped[j]!, tb = targets.get(b.id)!;
      if (a.team !== b.team) continue;
      let dx = tb.x - ta.x, dz = tb.z - ta.z;
      const gap = Math.hypot(dx, dz);
      if (gap >= 9) continue;
      if (gap < 0.01) { dx = 0; dz = roleOf(a).lateral < 0 ? 1 : -1; }
      const scale = (9 - gap) / (Math.hypot(dx, dz) || 1) / 2;
      ta.x -= dx * scale; ta.z -= dz * scale;
      tb.x += dx * scale; tb.z += dz * scale;
    }
  }
  for (const p of shaped) {
    const target = targets.get(p.id)!;
    const dir = teamDir(p.team, world.endsSwapped);
    const keeper = world.players.find((q) => q.team === p.team && q.slot === 'GK')!;
    const progress = Math.max(target.x * dir, keeper.x * dir + 0.75);
    commands.set(p.id, { move: targetMove(p, dir * clamp(progress, -longitudinal(0.44), longitudinal(0.44)), clamp(target.z, -lateral(0.4), lateral(0.4)),
      roleOf(p).line === 'def' && distance(p, world.ball) > 12 ? 0.08 : 0.35),
      sprint: state.possession !== p.team && tick - state.teams[p.team].changedAt < 90 });
  }
  for (const p of world.phase === 'live' ? world.players : []) {
    const command = commands.get(p.id);
    if (!command || !outfield(p) || p.id === carrier?.id) continue;
    let x = 0, z = 0;
    for (const mate of world.players) {
      if (mate.team !== p.team || mate.id === p.id || !outfield(mate)) continue;
      const gap = distance(p, mate);
      if (gap >= 8) continue;
      const strength = (8 - gap) / 8;
      x += (p.x - mate.x) / Math.max(0.5, gap) * strength;
      z += (p.z - mate.z) / Math.max(0.5, gap) * strength;
    }
    command.move = { x: command.move.x + x * 1.2, z: command.move.z + z * 1.2 };
  }
  return commands;
}

export function simulateCpuMatch(seed: number, levelHome: Level, levelAway: Level, seconds = 240, observe?: (world: World) => void) {
  const world = createWorld(seed, seconds / 2, 1);
  for (const p of world.players) { p.human = false; p.controlled = false; }
  world.halfLength = seconds / 2;
  let tick = 0;
  while (world.phase !== 'full-time' && tick < (seconds + Math.max(60, seconds * 0.2)) * 60) {
    const commands = new Map<number, Command>();
    for (const team of [0, 1] as const) {
      const generated = computeAI(world, team === 0 ? levelHome : levelAway, 1 / 60, tick, team);
      for (const [id, command] of generated) commands.set(id, command);
    }
    stepWorld(world, 1 / 60, commands);
    observe?.(world);
    tick++;
  }
  return world;
}

export type CpuTeamStats = {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  passesAttempted: number;
  passesCompleted: number;
  possessionTicks: number;
  possessionShare: number;
  tacklesWon: number;
};

export function createMatchStatsObserver() {
  const empty = (): CpuTeamStats => ({ goals: 0, shots: 0, shotsOnTarget: 0, passesAttempted: 0, passesCompleted: 0, possessionTicks: 0, possessionShare: 0, tacklesWon: 0 });
  const stats = { teams: [empty(), empty()] as [CpuTeamStats, CpuTeamStats], liveTicks: 0 };
  let previousPhase: World['phase'] = 'restart';
  let previousTouch: Team = 0;
  let shot: Team | null = null;
  let pass: { team: Team; playerId: number; departed: boolean } | null = null;
  const cooldowns = new Map<number, number>();
  const observe = (world: World) => {
    const carrier = world.players.find((p) => distance(p, world.ball) < 0.64);
    const event = world.kickEvent;
    // Resolve the previous flight before registering a new kick by its receiver.
    if (pass && carrier) {
      if (carrier.id !== pass.playerId || pass.departed) {
        if (carrier.team === pass.team && carrier.id !== pass.playerId) stats.teams[pass.team].passesCompleted++;
        pass = null;
      }
    } else if (pass) pass.departed = true;
    const keeperContact = world.eventTime === 1.1 && (world.event === 'keeper claims it' || world.event === 'keeper parries');
    if (shot !== null && (world.score[shot] > stats.teams[shot].goals || (keeperContact && world.lastTouch !== shot))) {
      stats.teams[shot].shotsOnTarget++;
      shot = null;
    }
    if (event) {
      pass = null;
      shot = null;
      const player = world.players.find((p) => p.id === event.playerId)!;
      if (event.action === 'shoot' || event.action === 'finesse') {
        stats.teams[player.team].shots++;
        shot = player.team;
      } else if (previousPhase === 'live' && (event.action === 'pass' || event.action === 'through' || event.action === 'lob')) {
        stats.teams[player.team].passesAttempted++;
        pass = { team: player.team, playerId: player.id, departed: !carrier || carrier.id !== player.id };
      }
    }
    if (world.phase === 'live') {
      stats.liveTicks++;
      if (carrier) stats.teams[carrier.team].possessionTicks++;
      // Successful tackles have no event; infer wins from a new tackle and a change of last touch.
      if (world.lastTouch !== previousTouch) {
        const tackler = world.players.find((p) => p.team === world.lastTouch
          && (p.action === 'tackle' || p.action === 'slide')
          && p.cooldown > (cooldowns.get(p.id) ?? 0) && distance(p, world.ball) < 0.64);
        if (tackler) stats.teams[tackler.team].tacklesWon++;
      }
    } else {
      pass = null;
      shot = null;
    }
    if (shot !== null && ((carrier && carrier.team !== shot) || keeperContact)) shot = null;
    for (const team of [0, 1] as const) {
      stats.teams[team].goals = world.score[team];
      stats.teams[team].possessionShare = stats.liveTicks ? stats.teams[team].possessionTicks / stats.liveTicks : 0;
    }
    for (const player of world.players) cooldowns.set(player.id, player.cooldown);
    previousPhase = world.phase;
    previousTouch = world.lastTouch;
  };
  return { stats, observe };
}

export function simulateCpuMatchStats(seed: number, levelHome: Level, levelAway: Level, seconds = 240) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be finite and non-negative');
  const { stats, observe } = createMatchStatsObserver();
  const world = seconds === 0 ? createWorld(seed, 0) : simulateCpuMatch(seed, levelHome, levelAway, seconds, observe);
  return { ...stats, world };
}
