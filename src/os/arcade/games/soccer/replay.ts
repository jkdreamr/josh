import type { World } from './logic.ts';
import { wrapAngle } from './player.ts';

export const REPLAY_SECONDS = 6;
type PlayerFrame = { x: number; z: number; vx: number; vz: number; facing: number; cooldown: number; action: string };
type BallFrame = { x: number; y: number; z: number; vx: number; vy: number; vz: number };
export type ReplayFrame = { time: number; players: PlayerFrame[]; ball: BallFrame };

export function createReplayWorld(template: World): World {
  return {
    ...template,
    players: template.players.map((player) => ({ ...player })),
    ball: { ...template.ball },
    score: [...template.score],
    restartAt: { ...template.restartAt },
    controlled: [...template.controlled],
    kickEvent: null,
  };
}

export function appendReplayFrame(buffer: ReplayFrame[], world: World, time: number) {
  buffer.push({
    time,
    players: world.players.map(({ x, z, vx, vz, facing, cooldown, action }) => ({ x, z, vx, vz, facing, cooldown, action })),
    ball: {
      x: world.ball.x, y: world.ball.y, z: world.ball.z,
      vx: world.ball.vx, vy: world.ball.vy, vz: world.ball.vz,
    },
  });
  while (buffer.length && buffer[0]!.time < time - REPLAY_SECONDS) buffer.shift();
}

export function sampleReplay(buffer: ReplayFrame[], time: number, template: World, output?: World | null): World | null {
  if (!buffer.length) return null;
  let before = buffer[0]!;
  let after = before;
  for (let i = 0; i < buffer.length; i++) {
    const frame = buffer[i]!;
    if (frame.time <= time) before = frame;
    if (frame.time >= time) {
      after = frame;
      break;
    }
    after = frame;
  }
  const amount = after.time > before.time
    ? Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)))
    : 0;
  const result = output ?? createReplayWorld(template);
  for (let i = 0; i < result.players.length; i++) {
    const player = result.players[i]!;
    const a = before.players[i]!;
    const b = after.players[i]!;
    player.x = a.x + (b.x - a.x) * amount;
    player.z = a.z + (b.z - a.z) * amount;
    player.vx = a.vx + (b.vx - a.vx) * amount;
    player.vz = a.vz + (b.vz - a.vz) * amount;
    player.facing = wrapAngle(a.facing + wrapAngle(b.facing - a.facing) * amount);
    player.cooldown = a.cooldown + (b.cooldown - a.cooldown) * amount;
    player.action = amount < 0.5 ? a.action : b.action;
  }
  result.ball.x = before.ball.x + (after.ball.x - before.ball.x) * amount;
  result.ball.y = before.ball.y + (after.ball.y - before.ball.y) * amount;
  result.ball.z = before.ball.z + (after.ball.z - before.ball.z) * amount;
  result.ball.vx = before.ball.vx + (after.ball.vx - before.ball.vx) * amount;
  result.ball.vy = before.ball.vy + (after.ball.vy - before.ball.vy) * amount;
  result.ball.vz = before.ball.vz + (after.ball.vz - before.ball.vz) * amount;
  result.score[0] = template.score[0];
  result.score[1] = template.score[1];
  result.clock = template.clock;
  result.phase = template.phase;
  result.event = template.event;
  result.eventTime = template.eventTime;
  result.half = template.half;
  result.endsSwapped = template.endsSwapped;
  result.kickEvent = null;
  return result;
}

export function selectReplay(buffer: ReplayFrame[], end: number) {
  return buffer.filter((frame) => frame.time >= end - REPLAY_SECONDS && frame.time <= end);
}
