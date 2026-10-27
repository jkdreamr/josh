import type { World } from './logic.ts';

export const REPLAY_SECONDS = 6;
type PlayerFrame = { x: number; z: number; facing: number; action: string };
type BallFrame = { x: number; y: number; z: number; vx: number; vy: number; vz: number };
export type ReplayFrame = { time: number; players: PlayerFrame[]; ball: BallFrame };

export function appendReplayFrame(buffer: ReplayFrame[], world: World, time: number) {
  buffer.push({
    time,
    players: world.players.map(({ x, z, facing, action }) => ({ x, z, facing, action })),
    ball: {
      x: world.ball.x, y: world.ball.y, z: world.ball.z,
      vx: world.ball.vx, vy: world.ball.vy, vz: world.ball.vz,
    },
  });
  while (buffer.length && buffer[0]!.time < time - REPLAY_SECONDS) buffer.shift();
}

export function sampleReplay(buffer: ReplayFrame[], time: number, template: World): World | null {
  if (!buffer.length) return null;
  let before = buffer[0]!;
  let after = before;
  for (const frame of buffer) {
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
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return {
    ...template,
    players: template.players.map((player, index) => {
      const a = before.players[index]!;
      const b = after.players[index]!;
      return { ...player, x: mix(a.x, b.x), z: mix(a.z, b.z), facing: mix(a.facing, b.facing), action: amount < 0.5 ? a.action : b.action };
    }),
    ball: {
      ...template.ball,
      x: mix(before.ball.x, after.ball.x), y: mix(before.ball.y, after.ball.y), z: mix(before.ball.z, after.ball.z),
      vx: mix(before.ball.vx, after.ball.vx), vy: mix(before.ball.vy, after.ball.vy), vz: mix(before.ball.vz, after.ball.vz),
    },
  };
}

export function selectReplay(buffer: ReplayFrame[], end: number) {
  return buffer.filter((frame) => frame.time >= end - REPLAY_SECONDS && frame.time <= end);
}
