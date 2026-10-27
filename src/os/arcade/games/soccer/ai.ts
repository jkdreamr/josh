import { createWorld, distance, FIELD, stepWorld, teamDir, type Command, type Player, type Team, type World } from './logic.ts';

export const LEVEL_NAMES = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVEL_NAMES)[number];
const reaction = { easy: 0.45, normal: 0.3, hard: 0.18 } as const;
const noise = { easy: 0.75, normal: 0.3, hard: 0.08 } as const;
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

function carrierCommand(world: World, player: Player, level: Level, tick: number): Command {
  const dir = teamDir(player.team, world.endsSwapped);
  const goalX = dir * (FIELD.length / 2);
  const goalDistance = Math.hypot(goalX - player.x, player.z);
  const opponents = world.players.filter((p) => p.team !== player.team);
  const pressure = Math.min(...opponents.map((p) => distance(p, player)));
  if (goalDistance < 17 && Math.abs(player.z) < 8 && pressure > 2.1) {
    const corner = Math.sign(player.z || 1) * 0.72;
    return { move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power: clamp(0.7 + (17 - goalDistance) * 0.012, 0.64, 0.88), aim: { x: dir, z: corner } };
  }
  if (pressure < 1.7) {
    const teammates = world.players.filter((p) => p.team === player.team && p.id !== player.id);
    const target = teammates.sort((a, b) => (laneScore(world, player, a) - (a.x - player.x) * dir * 0.15) - (laneScore(world, player, b) - (b.x - player.x) * dir * 0.15))[0];
    if (target && laneScore(world, player, target) < 1.6) {
      return { move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.55, aim: { x: target.x - player.x, z: target.z - player.z } };
    }
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
        const taker = world.players.find((candidate) => candidate.team === world.restartTeam && candidate.controlled)
          ?? world.players.filter((candidate) => candidate.team === world.restartTeam).sort((a, b) => distance(a, world.restartAt) - distance(b, world.restartAt))[0]!;
        if (p.id === taker.id) commands.set(p.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim: { x: teamDir(p.team, world.endsSwapped), z: 0 } });
      }
      continue;
    }
    if (p.slot === 'GK') {
      const direction = teamDir(p.team, world.endsSwapped);
      const target = { x: -direction * 18.7, z: clamp(world.ball.z * 0.55, -4.4, 4.4) };
      commands.set(p.id, { move: { x: target.x - p.x, z: target.z - p.z }, sprint: distance(p, target) > 2.5 });
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
      const dx = opponent.x - p.x, dz = opponent.z - p.z;
      commands.set(p.id, { move: { x: dx, z: dz }, sprint: distance(p, opponent) > 3, action: distance(p, opponent) < 1.25 ? 'tackle' : null, pressed: tick % Math.round(reaction[level] * 60) === 0 });
      continue;
    }
    const attackDir = teamDir(p.team, world.endsSwapped);
    const supportX = ownCarrier ? ownCarrier.x - attackDir * (p.slot === 'FWD' ? -4 : 4) : world.ball.x - attackDir * (p.slot === 'DEF' ? 5 : 1);
    const supportZ = p.slot === 'LM' ? -7 : p.slot === 'RM' ? 7 : 0;
    const targetX = clamp(supportX * 0.55 + p.x * 0.45, -18.8, 18.8);
    const targetZ = clamp(supportZ * 0.55 + world.ball.z * 0.2 + p.z * 0.25, -11, 11);
    commands.set(p.id, { move: { x: targetX - p.x, z: targetZ - p.z }, sprint: false });
  }
  void dt;
  return commands;
}

export function simulateCpuMatch(seed: number, levelHome: Level, levelAway: Level, seconds = 240) {
  const world = createWorld(seed, seconds / 2, 1);
  for (const p of world.players) { p.human = false; p.controlled = false; }
  world.halfLength = seconds / 2;
  let tick = 0;
  while (world.phase !== 'full-time' && tick < seconds * 60 + 300) {
    const commands = new Map<number, Command>();
    for (const team of [0, 1] as const) {
      const generated = computeAI(world, team === 0 ? levelHome : levelAway, 1 / 60, tick, team);
      for (const [id, command] of generated) if (world.players[id]?.team === team) commands.set(id, command);
    }
    stepWorld(world, 1 / 60, commands);
    tick++;
  }
  return world;
}
