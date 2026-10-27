import { createWorld, distance, FIELD, stepWorld, teamDir, type Command, type Player, type Team, type World } from './logic.ts';

export const LEVEL_NAMES = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVEL_NAMES)[number];
const reaction = { easy: 0.45, normal: 0.3, hard: 0.18 } as const;
const keeperReaction = { easy: 0.3, normal: 0.22, hard: 0.15 } as const;
const noise = { easy: 1.2, normal: 0.3, hard: 0.08 } as const;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function nearest(world: World, team: Team, point = world.ball) {
  return world.players.filter((p) => p.team === team).sort((a, b) => distance(a, point) - distance(b, point))[0]!;
}

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

export function keeperTarget(world: World, keeper: Player) {
  const direction = teamDir(keeper.team, world.endsSwapped);
  const goalX = -direction * (FIELD.length / 2 - 0.35);
  const oneOnOne = Math.abs(world.ball.x - goalX) < 10 && Math.abs(world.ball.z) < 6;
  const plane = goalX + direction * 1.4;
  const towardGoal = world.ball.vx * -direction > 0.4;
  const flight = towardGoal ? clamp((plane - world.ball.x) / world.ball.vx, 0, 2.5) : 0;
  const interceptZ = world.ball.z + world.ball.vz * flight;
  return {
    x: goalX + (world.ball.x - goalX) * (oneOnOne ? 0.22 : 0.08),
    z: clamp(interceptZ * (oneOnOne ? 0.72 : 0.55), -4.4, 4.4),
  };
}

function carrierCommand(world: World, player: Player, level: Level, tick: number): Command {
  const dir = teamDir(player.team, world.endsSwapped);
  const reactionTick = tick % Math.round(reaction[level] * 60) === 0;
  const goalX = dir * (FIELD.length / 2);
  const goalDistance = Math.hypot(goalX - player.x, player.z);
  const opponents = world.players.filter((p) => p.team !== player.team);
  const pressure = Math.min(...opponents.map((p) => distance(p, player)));
  const angle = Math.max(0, 1 - Math.abs(player.z) / 9);
  const xg = clamp((17 - goalDistance) / 17, 0, 1) * angle;
  if (pressure < 0.9 && player.x * dir < -7) {
    return { move: { x: -dir, z: player.z > 0 ? -0.7 : 0.7 }, action: 'lob', pressed: true, power: 0.78, aim: { x: dir, z: player.z > 0 ? -0.7 : 0.7 } };
  }
  const shotThreshold = level === 'easy' ? 0.28 : 0.16;
  if (reactionTick && xg > shotThreshold && goalDistance < 20 && Math.abs(player.z) < 10 && pressure > 1.4) {
    const targetZ = (level === 'easy' ? 1 : -1) * Math.sign(player.z || 1) * 2.1;
    const corner = (targetZ - player.z) / Math.max(8, goalDistance);
    return { move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power: clamp(0.7 + (17 - goalDistance) * 0.012, 0.64, 0.88), aim: { x: dir, z: corner } };
  }
  const candidates = world.players.filter((p) => p.team === player.team && p.id !== player.id);
  const candidate = candidates.map((target) => {
    const forward = (target.x - player.x) * dir;
    const lane = laneScore(world, player, target);
    const space = Math.min(...opponents.map((opponent) => distance(opponent, target)));
    const through = (target.slot === 'FWD' || target.slot === 'LM' || target.slot === 'RM')
      && Math.abs(target.x - player.x) > 3 && space > 2.2;
    const score = forward * 0.11 + Math.min(5, space) * 0.13 - lane * (level === 'hard' ? 0.65 : level === 'normal' ? 0.5 : 0.3);
    return { target, through, score, lane };
  }).sort((a, b) => b.score - a.score)[0];
  if (reactionTick && candidate && candidate.score > (level === 'easy' ? 0.18 : 0.08) && (pressure < 4.5 || candidate.score > 0.7)) {
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
  const noiseTurn = Math.sin((tick + player.id * 3) * 0.37) * noise[level];
  const lane = clamp(player.z * -0.08 + noiseTurn, -0.8, 0.8);
  return { move: { x: dir, z: lane }, sprint: goalDistance > 9, aim: { x: dir, z: lane * 0.45 } };
}

export function computeAI(world: World, level: Level, dt: number, tick: number, team?: Team) {
  const commands = new Map<number, Command>();
  const nearBall = [nearest(world, 0), nearest(world, 1)];
  const carrier = world.players.find((p) => distance(p, world.ball) < 0.64);
  for (const p of world.players) {
    if (team !== undefined && p.team !== team) continue;
    if (p.human || p.controlled) continue;
    if (world.phase !== 'live') {
      if (world.phase === 'restart' && p.team === world.restartTeam) {
        const taker = (world.restart === 'goal-kick'
          ? world.players.find((candidate) => candidate.team === world.restartTeam && candidate.slot === 'GK')
          : undefined)
          ?? world.players.find((candidate) => candidate.team === world.restartTeam && candidate.controlled)
          ?? world.players.filter((candidate) => candidate.team === world.restartTeam).sort((a, b) => distance(a, world.restartAt) - distance(b, world.restartAt))[0]!;
        if (p.id === taker.id) commands.set(p.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim: { x: teamDir(p.team, world.endsSwapped), z: 0 } });
      }
      continue;
    }
    if (p.slot === 'GK') {
      const target = keeperTarget(world, p);
      const oneOnOne = Math.abs(world.ball.x - target.x) < 10 && Math.abs(world.ball.z) < 6;
      if (carrier?.id === p.id) {
        if (world.event === 'keeper claims it' && world.eventTime > 0.05) {
          commands.set(p.id, { move: { x: 0, z: 0 } });
          continue;
        }
        const receiver = world.players
          .filter((candidate) => candidate.team === p.team && candidate.id !== p.id)
          .sort((a, b) => laneScore(world, p, a) - laneScore(world, p, b))[0];
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
        p.action = Math.abs(target.z - p.z) <= 1 ? 'dive' : 'ready';
      }
      commands.set(p.id, { move: reacts ? { x: target.x - p.x, z: target.z - p.z } : { x: p.vx, z: p.vz }, sprint: oneOnOne || distance(p, target) > 2.5 });
      continue;
    }
    if (carrier?.id === p.id) {
      commands.set(p.id, carrierCommand(world, p, level, tick));
      continue;
    }
    const ownCarrier = carrier?.team === p.team ? carrier : null;
    const opponent = carrier?.team !== p.team ? carrier : null;
    if (!ownCarrier && nearBall[p.team]?.id === p.id) {
      const dx = world.ball.x - p.x, dz = world.ball.z - p.z;
      commands.set(p.id, { move: { x: dx, z: dz }, sprint: distance(p, world.ball) > 4, action: distance(p, world.ball) < 1.2 ? 'tackle' : null, pressed: tick % Math.round(reaction[level] * 60) === 0 });
      continue;
    }
    if (opponent && nearBall[p.team]?.id === p.id) {
      const bites = opponent.action === 'skill' && opponent.cooldown > 0 && tick % Math.round(reaction[level] * 60) === 0 && level !== 'hard';
      const targetX = bites ? opponent.x + Math.sign(opponent.vx || teamDir(p.team, world.endsSwapped)) * 2 : opponent.x;
      const targetZ = bites ? opponent.z + Math.sign(opponent.vz || 1) * 1.2 : opponent.z;
      const dx = targetX - p.x, dz = targetZ - p.z;
      commands.set(p.id, { move: { x: dx, z: dz }, sprint: distance(p, opponent) > 3, action: distance(p, opponent) < 1.25 ? 'tackle' : null, pressed: tick % Math.round(reaction[level] * 60) === 0 });
      continue;
    }
    const attackDir = teamDir(p.team, world.endsSwapped);
    const slotDepth = { GK: 18.4, DEF: 12, LM: 8, RM: 8, FWD: 3.5 }[p.slot];
    const slotWidth = p.slot === 'LM' ? -6 : p.slot === 'RM' ? 6 : 0;
    let supportX = ownCarrier
      ? ownCarrier.x + attackDir * (p.slot === 'FWD' ? 4 : p.slot === 'DEF' ? -5 : 1)
      : -attackDir * slotDepth + world.ball.x * 0.35;
    let supportZ = ownCarrier
      ? ownCarrier.z + (p.slot === 'LM' ? -5 : p.slot === 'RM' ? 5 : 0)
      : slotWidth + world.ball.z * 0.25;
    if (opponent) {
      const runner = world.players
        .filter((candidate) => candidate.team === opponent.team && candidate.id !== opponent.id && candidate.slot !== 'GK')
        .sort((a, b) => ((b.x - opponent.x) * attackDir - distance(opponent, b) * 0.2) - ((a.x - opponent.x) * attackDir - distance(opponent, a) * 0.2))[0];
      if (runner) {
        supportX = (opponent.x + runner.x) / 2;
        supportZ = (opponent.z + runner.z) / 2;
      }
    }
    const targetX = clamp(supportX * 0.55 + p.x * 0.45, -18.8, 18.8);
    const targetZ = clamp(supportZ * 0.55 + world.ball.z * 0.2 + p.z * 0.25, -11, 11);
    commands.set(p.id, { move: { x: targetX - p.x, z: targetZ - p.z }, sprint: false });
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
