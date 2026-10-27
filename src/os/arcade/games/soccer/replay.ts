import type { World } from './logic.ts';

export const REPLAY_SECONDS = 4;
export type ReplayFrame = { time: number; world: World };

export function appendReplayFrame(buffer: ReplayFrame[], world: World, time: number) {
  buffer.push({ time, world: structuredClone(world) });
  while (buffer.length && buffer[0]!.time < time - REPLAY_SECONDS) buffer.shift();
}

export function sampleReplay(buffer: ReplayFrame[], time: number) {
  if (!buffer.length) return null;
  let best = buffer[0]!;
  for (const frame of buffer) {
    if (Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
  }
  return best.world;
}

export function selectReplay(buffer: ReplayFrame[], end: number) {
  return buffer.filter((frame) => frame.time >= end - REPLAY_SECONDS && frame.time <= end);
}
