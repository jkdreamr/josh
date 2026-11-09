import type { PointCall, World } from './logic.ts';

export const REPLAY_BUFFER_SECONDS = 4;
export const REPLAY_SOURCE_SECONDS = 2.4;
export const REPLAY_FAST_SOURCE_SECONDS = 1.8;
export const REPLAY_SLOW_SOURCE_SECONDS = 0.6;
export const REPLAY_FAST_SPEED = 0.9;
export const REPLAY_SLOW_SPEED = 0.3;
export const REPLAY_HOLD_SECONDS = 0.4;
export const REPLAY_DURATION =
  REPLAY_FAST_SOURCE_SECONDS / REPLAY_FAST_SPEED
  + REPLAY_SLOW_SOURCE_SECONDS / REPLAY_SLOW_SPEED
  + REPLAY_HOLD_SECONDS;
export const REPLAY_POINT_CLOCK = REPLAY_DURATION + 1.1;

export function rallyCounterLabel(shots: number) {
  return shots >= 4 ? `Rally ${Math.floor(shots)}` : '';
}

export type ReplayFrame = { at: number; world: World };
export type ReplaySelection = {
  frames: ReplayFrame[];
  sourceStart: number;
  sourceEnd: number;
  fastSourceEnd: number;
  fastDuration: number;
  slowDuration: number;
  holdDuration: number;
  duration: number;
};

export type ReplayPoint = {
  call: PointCall;
  rallyShots: number;
  pointWinner: number;
  lastHitter: number;
};

export function shouldReplay(point: ReplayPoint) {
  const ace = point.call === 'point' && point.rallyShots === 1;
  const cleanWinner = point.lastHitter === point.pointWinner;
  return ace || cleanWinner || point.rallyShots >= 6;
}

function cloneWorld(world: World): World {
  return {
    ...world,
    players: world.players.map((player) => ({
      ...player,
      input: { ...player.input },
      pending: player.pending ? { ...player.pending } : null,
    })),
    ball: {
      ...world.ball,
      p: { ...world.ball.p },
      prev: { ...world.ball.prev },
      v: { ...world.ball.v },
      spin: { ...world.ball.spin },
    },
    match: {
      ...world.match,
      games: [...world.match.games],
      sets: [...world.match.sets],
      points: [...world.match.points],
      tbPoints: [...world.match.tbPoints],
      completedSets: world.match.completedSets.map((set) => [...set]),
    },
    receiverFlip: [...world.receiverFlip],
  };
}

export function appendReplayFrame(buffer: readonly ReplayFrame[], world: World, maxSeconds = REPLAY_BUFFER_SECONDS) {
  const frame = { at: world.clock, world: cloneWorld(world) };
  const cutoff = frame.at - maxSeconds;
  const first = buffer.findIndex((entry) => entry.at >= cutoff);
  return [...(first < 0 ? [] : buffer.slice(first)), frame];
}

export function selectReplay(
  buffer: readonly ReplayFrame[],
  point: ReplayPoint,
  now = buffer.at(-1)?.at ?? 0,
): ReplaySelection | null {
  if (!shouldReplay(point)) return null;

  const requestedStart = now - REPLAY_SOURCE_SECONDS;
  const frames = buffer.filter((frame) => frame.at >= requestedStart && frame.at <= now);
  if (frames.length < 2) return null;
  const sourceStart = frames[0]!.at;
  const sourceEnd = frames.at(-1)!.at;
  const sourceSeconds = Math.min(REPLAY_SOURCE_SECONDS, sourceEnd - sourceStart);
  const slowSourceSeconds = Math.min(REPLAY_SLOW_SOURCE_SECONDS, sourceSeconds);
  const fastSourceSeconds = Math.min(REPLAY_FAST_SOURCE_SECONDS, sourceSeconds - slowSourceSeconds);
  const fastDuration = fastSourceSeconds / REPLAY_FAST_SPEED;
  const slowDuration = slowSourceSeconds / REPLAY_SLOW_SPEED;
  const holdDuration = REPLAY_HOLD_SECONDS;
  return {
    frames: [...frames],
    sourceStart,
    sourceEnd,
    fastSourceEnd: sourceStart + fastSourceSeconds,
    fastDuration,
    slowDuration,
    holdDuration,
    duration: fastDuration + slowDuration + holdDuration,
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function sampleReplay(selection: ReplaySelection, elapsed: number): World {
  const frames = selection.frames;
  const time = replaySourceTime(selection, elapsed);
  let nextIndex = frames.findIndex((frame) => frame.at >= time);
  if (nextIndex < 0) nextIndex = frames.length - 1;
  const next = frames[nextIndex]!;
  const previous = frames[Math.max(0, nextIndex - 1)]!;
  const span = next.at - previous.at;
  const alpha = span > 0 ? (time - previous.at) / span : 0;
  const world = cloneWorld(previous.world);
  world.clock = time;
  world.ball.p.x = lerp(previous.world.ball.p.x, next.world.ball.p.x, alpha);
  world.ball.p.y = lerp(previous.world.ball.p.y, next.world.ball.p.y, alpha);
  world.ball.p.z = lerp(previous.world.ball.p.z, next.world.ball.p.z, alpha);
  world.ball.prev = { ...world.ball.p };
  world.ball.v.x = lerp(previous.world.ball.v.x, next.world.ball.v.x, alpha);
  world.ball.v.y = lerp(previous.world.ball.v.y, next.world.ball.v.y, alpha);
  world.ball.v.z = lerp(previous.world.ball.v.z, next.world.ball.v.z, alpha);
  for (let index = 0; index < world.players.length; index++) {
    const player = world.players[index]!;
    const nextPlayer = next.world.players[index]!;
    player.x = lerp(player.x, nextPlayer.x, alpha);
    player.z = lerp(player.z, nextPlayer.z, alpha);
    player.prevX = player.x;
    player.prevZ = player.z;
    player.vx = lerp(player.vx, nextPlayer.vx, alpha);
    player.vz = lerp(player.vz, nextPlayer.vz, alpha);
    player.swing = lerp(player.swing, nextPlayer.swing, alpha);
    player.anim = lerp(player.anim, nextPlayer.anim, alpha);
    player.serveToss = lerp(player.serveToss, nextPlayer.serveToss, alpha);
  }
  world.acc = 0;
  return world;
}

export function replaySourceTime(selection: ReplaySelection, elapsed: number) {
  const time = Math.max(0, elapsed);
  if (time < selection.fastDuration) return Math.min(selection.fastSourceEnd, selection.sourceStart + time * REPLAY_FAST_SPEED);
  const slowEnd = selection.fastDuration + selection.slowDuration;
  if (time < slowEnd) return Math.min(selection.sourceEnd, selection.fastSourceEnd + (time - selection.fastDuration) * REPLAY_SLOW_SPEED);
  return selection.sourceEnd;
}

export function replayProgress(selection: ReplaySelection, elapsed: number) {
  const time = Math.max(0, elapsed);
  return {
    t: selection.duration > 0 ? Math.min(1, time / selection.duration) : 1,
    slow: time >= selection.fastDuration,
  };
}
