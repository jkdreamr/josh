import { createWorld, distance, FIELD, FORMATION, restartTaker, stepWorld, teamDir, TEAM_SIZE, type Command, type Player, type Team, type World } from './logic.ts';

export const LEVEL_NAMES = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVEL_NAMES)[number];
const reaction = { easy: 0.45, normal: 0.3, hard: 0.18 } as const;
const keeperReaction = { easy: 0.3, normal: 0.22, hard: 0.15 } as const;
const decisionInterval = { easy: 0.55, normal: 0.3, hard: 0.24 } as const;
const noise = { easy: 0.28, normal: 0.1, hard: 0.02 } as const;
const keeperTargetScratch = { x: 0, z: 0 };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const outfield = (player: Player) => player.slot !== 'GK';
const targetMove = (player: Player, x: number, z: number) => {
  const dx = x - player.x;
  const dz = z - player.z;
  return Math.hypot(dx, dz) <= 0.6 ? { x: 0, z: 0 } : { x: dx, z: dz };
};

function laneScore(world: World, from: Player, to: Player) {
  let danger = 0;
  for (const opponent of world.players) {
    if (opponent.team === from.team) continue;
    const dx = to.x - from.x, dz = to.z - from.z;
    const n = Math.hypot(dx, dz) || 1;
    const t = clamp(((opponent.x - from.x) * dx + (opponent.z - from.z) * dz) / (n * n), 0, 1);
    const d = Math.hypot(opponent.x - from.x - dx * t, opponent.z - from.z - dz * t);
    if (d < 1.5) danger += (1.5 - d) * (1 - t * 0.25);
  }
  return danger;
}

export function keeperTarget(world: World, keeper: Player, target = { x: 0, z: 0 }) {
  const direction = teamDir(keeper.team, world.endsSwapped);
  const goalX = -direction * (FIELD.length / 2 - 0.35);
  const oneOnOne = Math.abs(world.ball.x - goalX) < FIELD.penaltyDepth * 0.6 && Math.abs(world.ball.z) < FIELD.penaltyWidth * 0.15;
  const plane = goalX + direction * 1.4;
  const towardGoal = world.ball.vx * -direction > 0.4;
  const flight = towardGoal ? clamp((plane - world.ball.x) / world.ball.vx, 0, 2.5) : 0;
  const interceptZ = world.ball.z + world.ball.vz * flight;
  target.x = goalX + (world.ball.x - goalX) * (oneOnOne ? 0.22 : 0.08);
  target.z = clamp(interceptZ * (oneOnOne ? 0.72 : 0.55), -FIELD.goalWidth / 2 - 0.8, FIELD.goalWidth / 2 + 0.8);
  return target;
}

function carrierCommand(world: World, player: Player, level: Level, tick: number): Command {
  const dir = teamDir(player.team, world.endsSwapped);
  const decisionTick = tick % Math.round(decisionInterval[level] * 60) === 0;
  const goalX = dir * (FIELD.length / 2);
  const goalDistance = Math.hypot(goalX - player.x, player.z);
  let pressure = Infinity;
  let nearestOpponent: Player | null = null;
  for (const opponent of world.players) {
    if (opponent.team === player.team) continue;
    const d = distance(opponent, player);
    if (d < pressure) { pressure = d; nearestOpponent = opponent; }
  }
  const evade = nearestOpponent
    ? clamp((player.z - nearestOpponent.z) * 0.12 + (player.x - nearestOpponent.x) * -dir * 0.08, -0.5, 0.5)
    : 0;
  const lane = clamp(player.z * -0.08 + evade, -0.8, 0.8);
  if (!decisionTick) return { move: { x: dir, z: lane }, sprint: goalDistance > 9, aim: { x: dir, z: lane * 0.45 } };
  const angle = Math.max(0, 1 - Math.abs(player.z) / (FIELD.penaltyWidth / 4));
  const xg = clamp((FIELD.penaltyDepth - goalDistance) / FIELD.penaltyDepth, 0, 1) * angle;
  if (pressure < 0.9 && player.x * dir < -7) {
    return { move: { x: -dir, z: player.z > 0 ? -0.7 : 0.7 }, action: 'lob', pressed: true, power: 0.78, aim: { x: dir, z: player.z > 0 ? -0.7 : 0.7 } };
  }
  if (xg > 0.35 && goalDistance < FIELD.penaltyDepth * 1.2 && Math.abs(player.z) < FIELD.penaltyWidth / 4 && pressure > 1.4) {
    const targetZ = -Math.sign(player.z) * FIELD.goalWidth * 0.29;
    const corner = (targetZ - player.z) / Math.max(8, goalDistance);
    return { move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power: clamp(0.7 + (17 - goalDistance) * 0.012, 0.64, 0.88), aim: { x: dir, z: corner } };
  }
  let candidate: { target: Player; through: boolean; score: number; lane: number } | null = null;
  for (const target of world.players) {
    if (target.team !== player.team || target.id === player.id) continue;
    const forward = (target.x - player.x) * dir;
    const danger = laneScore(world, player, target);
    let space = Infinity;
    for (const opponent of world.players) {
      if (opponent.team === player.team) continue;
      space = Math.min(space, distance(opponent, target));
    }
    const through = (target.slot === 'ST' || target.slot === 'LW' || target.slot === 'RW')
      && Math.abs(target.x - player.x) > FIELD.goalWidth * 0.6 && space > FIELD.goalWidth * 0.3;
    const optionNoise = Math.sin((tick + target.id * 13 + player.id * 7) * 0.37) * noise[level];
    const score = forward * 0.11 + Math.min(FIELD.goalWidth, space) * 0.13 - danger * 0.5 + optionNoise;
    if (!candidate || score > candidate.score) candidate = { target, through, score, lane: danger };
  }
  if (candidate && candidate.score > 0.08 && (pressure < FIELD.goalWidth * 0.6 || candidate.score > 0.7)) {
    const target = candidate.target;
    const lead = candidate.through ? 1.5 : 0;
    return {
      move: { x: 0, z: 0 },
      action: candidate.through ? 'through' : 'pass',
      pressed: true,
      power: candidate.through ? 0.66 : clamp(0.44 + distance(player, target) * 0.022, 0.45, 0.72),
      aim: { x: target.x + target.vx * lead - player.x + (candidate.through ? dir * 2 : 0), z: target.z + target.vz * lead - player.z },
    };
  }
  return { move: { x: dir, z: lane }, sprint: goalDistance > 9, aim: { x: dir, z: lane * 0.45 } };
}

export function computeAI(world: World, level: Level, dt: number, tick: number, team?: Team, commands = new Map<number, Command>()) {
  commands.clear();
  let carrier: Player | null = null;
  for (const player of world.players) {
    if (distance(player, world.ball) < 0.64) { carrier = player; break; }
  }
  const pressers = new Map<Team, Player>();
  const secondPressers = new Map<Team, Player>();
  for (const side of [0, 1] as const) {
    const candidates = world.players
      .filter((player) => player.team === side && outfield(player) && !player.human && !player.controlled)
      .sort((a, b) => distance(a, world.ball) - distance(b, world.ball));
    if (candidates[0]) pressers.set(side, candidates[0]);
    if (candidates[1]) secondPressers.set(side, candidates[1]);
  }
  const targets = new Map<number, { x: number; z: number }>();
  for (const p of world.players) {
    if (team !== undefined && p.team !== team) continue;
    if (p.human || p.controlled) continue;
    if (world.phase !== 'live') {
      if (world.phase === 'restart' && p.team === world.restartTeam) {
        const taker = restartTaker(world);
        if (p.id === taker.id) commands.set(p.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim: { x: teamDir(p.team, world.endsSwapped), z: 0 } });
      }
      continue;
    }
    if (p.slot === 'GK') {
      const target = keeperTarget(world, p, keeperTargetScratch);
      const oneOnOne = Math.abs(world.ball.x - target.x) < FIELD.penaltyDepth * 0.6 && Math.abs(world.ball.z) < FIELD.penaltyWidth * 0.15;
      if (carrier?.id === p.id) {
        if (world.event === 'keeper claims it' && world.eventTime > 0.05) {
          commands.set(p.id, { move: { x: 0, z: 0 } });
          continue;
        }
        let receiver: Player | null = null;
        let safestLane = Infinity;
        for (const candidate of world.players) {
          if (candidate.team !== p.team || candidate.id === p.id) continue;
          const lane = laneScore(world, p, candidate);
          if (lane < safestLane) { safestLane = lane; receiver = candidate; }
        }
        commands.set(p.id, receiver
          ? { move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.55, aim: { x: receiver.x - p.x, z: receiver.z - p.z } }
          : { move: { x: 0, z: 0 } });
        continue;
      }
      if (world.event === 'keeper claims it' && world.lastTouch === p.team && distance(p, world.ball) < 1.4) {
        commands.set(p.id, { move: { x: world.ball.x - p.x, z: world.ball.z - p.z }, sprint: false });
        continue;
      }
      const reacts = tick % Math.max(1, Math.round(keeperReaction[level] * 60)) === 0;
      if (reacts && Math.hypot(world.ball.vx, world.ball.vy, world.ball.vz) > 16) {
        p.action = Math.abs(target.z - p.z) <= 2.4 ? 'dive' : 'ready';
      }
      commands.set(p.id, { move: reacts ? { x: target.x - p.x, z: target.z - p.z } : { x: p.vx, z: p.vz }, sprint: oneOnOne || distance(p, target) > FIELD.goalWidth * 0.35 });
      continue;
    }
    if (carrier?.id === p.id) {
      commands.set(p.id, carrierCommand(world, p, level, tick));
      continue;
    }
    const ownCarrier = carrier?.team === p.team ? carrier : null;
    const opponent = carrier?.team !== p.team ? carrier : null;
    const presser = pressers.get(p.team);
    if (!ownCarrier && presser?.id === p.id) {
      const gap = distance(p, world.ball);
      const movement = opponent && gap <= 1.35
        ? { x: 0, z: 0 }
        : targetMove(p, world.ball.x, world.ball.z);
      commands.set(p.id, {
        move: movement,
        sprint: gap > 3,
        action: gap < 1.4 ? 'tackle' : null,
        pressed: tick % Math.round(reaction[level] * 60) === 0,
      });
      continue;
    }
    const attackDir = teamDir(p.team, world.endsSwapped);
    const home = FORMATION[p.id % TEAM_SIZE]!;
    const defender = p.slot === 'LB' || p.slot === 'CB' || p.slot === 'RB';
    const wide = p.slot === 'LW' || p.slot === 'RW';
    let targetX: number;
    let targetZ: number;
    if (ownCarrier) {
      if (p.slot === 'ST') {
        let lastDefenderProgress = -Infinity;
        for (const candidate of world.players) {
          if (candidate.team === p.team || !outfield(candidate)) continue;
          lastDefenderProgress = Math.max(lastDefenderProgress, candidate.x * attackDir);
        }
        targetX = attackDir * Math.max(ownCarrier.x * attackDir + FIELD.goalWidth * 0.8, lastDefenderProgress - FIELD.goalWidth * 0.25);
        targetZ = -Math.sign(ownCarrier.z) * FIELD.goalWidth * 0.4;
      } else if (wide) {
        targetX = ownCarrier.x + attackDir * FIELD.goalWidth * 0.4;
        targetZ = home.z;
      } else if (p.slot === 'CM') {
        targetX = ownCarrier.x - attackDir * FIELD.goalWidth;
        targetZ = home.z * 0.35;
      } else {
        targetX = ownCarrier.x - attackDir * FIELD.penaltyDepth * 0.42;
        targetZ = ownCarrier.z * 0.3;
      }
    } else {
      const secondPresser = secondPressers.get(p.team);
      if (opponent && secondPresser?.id === p.id) {
        let runner: Player | null = null;
        let runnerScore = -Infinity;
        const opponentDir = -attackDir;
        for (const candidate of world.players) {
          if (candidate.team !== opponent.team || candidate.id === opponent.id || !outfield(candidate)) continue;
          const score = (candidate.x - opponent.x) * opponentDir - distance(opponent, candidate) * 0.2;
          if (score > runnerScore) { runner = candidate; runnerScore = score; }
        }
        if (runner) {
          targetX = opponent.x + (runner.x - opponent.x) * 0.4;
          targetZ = opponent.z + (runner.z - opponent.z) * 0.4;
        } else {
          targetX = world.ball.x;
          targetZ = world.ball.z;
        }
      } else if (defender) {
        const ownGoalX = -attackDir * (FIELD.length / 2);
        const dx = ownGoalX - world.ball.x;
        const dz = -world.ball.z;
        const length = Math.hypot(dx, dz) || 1;
        const keeper = world.players.find((candidate) => candidate.team === p.team && candidate.slot === 'GK')!;
        const goalSideX = world.ball.x + dx / length * FIELD.goalWidth * 0.96;
        targetX = attackDir * Math.max(goalSideX * attackDir, keeper.x * attackDir + 0.75);
        targetZ = world.ball.z + dz / length * FIELD.goalWidth * 0.96;
      } else if (wide) {
        targetX = world.ball.x - attackDir * FIELD.goalWidth * 0.48;
        targetZ = home.z + 0.35 * world.ball.z;
      } else if (p.slot === 'CM') {
        targetX = world.ball.x - attackDir * FIELD.goalWidth * 0.48;
        targetZ = home.z + 0.2 * world.ball.z;
      } else {
        targetX = world.ball.x + attackDir * FIELD.goalWidth * 0.28;
        targetZ = -0.4 * world.ball.z;
      }
    }
    targetX = clamp(targetX, -FIELD.length / 2 + 1, FIELD.length / 2 - 1);
    targetZ = clamp(targetZ, -FIELD.width / 2 + 1, FIELD.width / 2 - 1);
    targets.set(p.id, { x: targetX, z: targetZ });
  }
  const separated = world.players.filter((player) => outfield(player)
    && !player.human && !player.controlled && player.id !== carrier?.id && player.id !== pressers.get(player.team)?.id
    && targets.has(player.id));
  for (let i = 0; i < separated.length; i++) {
    const a = separated[i]!;
    const targetA = targets.get(a.id)!;
    for (let j = i + 1; j < separated.length; j++) {
      const b = separated[j]!;
      if (a.team !== b.team) continue;
      const targetB = targets.get(b.id)!;
      let dx = targetB.x - targetA.x;
      let dz = targetB.z - targetA.z;
      let gap = Math.hypot(dx, dz);
      if (gap >= 4) continue;
      if (gap < 0.001) {
        dx = b.x - a.x;
        dz = b.z - a.z;
        gap = Math.hypot(dx, dz);
      }
      if (gap < 0.001) {
        dx = a.id < b.id ? 1 : -1;
        dz = 0;
        gap = 1;
      }
      const push = (4 - gap) / 2;
      targetA.x = clamp(targetA.x - dx / gap * push, -FIELD.length / 2 + 1, FIELD.length / 2 - 1);
      targetA.z = clamp(targetA.z - dz / gap * push, -FIELD.width / 2 + 1, FIELD.width / 2 - 1);
      targetB.x = clamp(targetB.x + dx / gap * push, -FIELD.length / 2 + 1, FIELD.length / 2 - 1);
      targetB.z = clamp(targetB.z + dz / gap * push, -FIELD.width / 2 + 1, FIELD.width / 2 - 1);
    }
  }
  for (const p of separated) {
    const target = targets.get(p.id)!;
    commands.set(p.id, { move: targetMove(p, target.x, target.z), sprint: false });
  }
  void dt;
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
      for (const [id, command] of generated) if (world.players[id]?.team === team) commands.set(id, command);
    }
    stepWorld(world, 1 / 60, commands);
    observe?.(world);
    tick++;
  }
  return world;
}
