import type { PointCall, World } from './logic.ts';

export const REPLAY_DURATION = 2.5;
export const REPLAY_SPEED = 0.35;
export const REPLAY_BUFFER_SECONDS = 3;
export const REPLAY_SOURCE_SECONDS = REPLAY_DURATION * REPLAY_SPEED;
export const REPLAY_POINT_CLOCK = REPLAY_DURATION + 0.55;

export function rallyCounterLabel(shots: number) {
  return shots >= 4 ? `Rally ${Math.floor(shots)}` : '';
}

export type ReplayFrame = { at: number; world: World };
export type ReplaySelection = {
  frames: ReplayFrame[];
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  speed: number;
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
  duration = REPLAY_DURATION,
  speed = REPLAY_SPEED,
): ReplaySelection | null {
  if (!shouldReplay(point)) return null;

  const sourceEnd = now;
  const sourceStart = sourceEnd - duration * speed;
  const frames = buffer.filter((frame) => frame.at >= sourceStart && frame.at <= sourceEnd);
  if (frames.length < 2) return null;
  return { frames: [...frames], sourceStart: frames[0]!.at, sourceEnd: frames.at(-1)!.at, duration, speed };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function sampleReplay(selection: ReplaySelection, elapsed: number): World {
  const frames = selection.frames;
  const first = frames[0]!;
  const last = frames.at(-1)!;
  const time = Math.min(last.at, first.at + Math.max(0, elapsed) * selection.speed);
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
