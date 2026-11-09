import type { PointCall, World } from './logic.ts';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const REPLAY_BUFFER_SECONDS = 4;
export const REPLAY_SOURCE_SECONDS = 2.4;
export const REPLAY_HIT_SLOW_SOURCE_SECONDS = 0.7;
export const REPLAY_FALLBACK_SLOW_SOURCE_SECONDS = 0.6;
export const REPLAY_FAST_SOURCE_SECONDS = REPLAY_SOURCE_SECONDS - REPLAY_HIT_SLOW_SOURCE_SECONDS;
export const REPLAY_SLOW_SOURCE_SECONDS = REPLAY_HIT_SLOW_SOURCE_SECONDS;
export const REPLAY_FAST_SPEED = 0.9;
export const REPLAY_SLOW_SPEED = 0.3;
export const REPLAY_HOLD_SECONDS = 0.4;
export const REPLAY_DURATION =
  REPLAY_FAST_SOURCE_SECONDS / REPLAY_FAST_SPEED
  + REPLAY_HIT_SLOW_SOURCE_SECONDS / REPLAY_SLOW_SPEED
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
  slowSourceStart: number;
  slowSourceEnd: number;
  fastBeforeDuration: number;
  fastDuration: number;
  slowDuration: number;
  fastAfterDuration: number;
  holdDuration: number;
  duration: number;
  hitAt: number | null;
  hitTeam: number | null;
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
  let hitAt: number | null = null;
  let hitTeam: number | null = null;
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]!.world.ball;
    const current = frames[index]!.world.ball;
    if (current.inPlay && (!previous.inPlay
      || current.rallyShot !== previous.rallyShot
      || current.hitByTeam !== previous.hitByTeam)) {
      hitAt = frames[index]!.at;
      hitTeam = current.hitByTeam;
    }
  }
  let slowSourceStart: number;
  let slowSourceEnd: number;
  if (hitAt === null) {
    const fallbackSlowSeconds = Math.min(REPLAY_FALLBACK_SLOW_SOURCE_SECONDS, sourceSeconds);
    slowSourceStart = sourceEnd - fallbackSlowSeconds;
    slowSourceEnd = sourceEnd;
    hitTeam = point.lastHitter >= 0 ? point.lastHitter : frames.at(-1)!.world.ball.hitByTeam;
  } else {
    slowSourceStart = clamp(hitAt - 0.25, sourceStart, sourceEnd);
    slowSourceEnd = clamp(hitAt + 0.45, sourceStart, sourceEnd);
  }
  const slowSourceSeconds = Math.max(0, slowSourceEnd - slowSourceStart);
  const fastBeforeSourceSeconds = Math.max(0, slowSourceStart - sourceStart);
  const fastAfterSourceSeconds = Math.max(0, sourceEnd - slowSourceEnd);
  const fastBeforeDuration = fastBeforeSourceSeconds / REPLAY_FAST_SPEED;
  const fastDuration = fastBeforeDuration;
  const slowDuration = slowSourceSeconds / REPLAY_SLOW_SPEED;
  const fastAfterDuration = fastAfterSourceSeconds / REPLAY_FAST_SPEED;
  const holdDuration = REPLAY_HOLD_SECONDS;
  const duration = fastBeforeDuration + slowDuration + fastAfterDuration + holdDuration;
  return {
    frames: [...frames],
    sourceStart,
    sourceEnd,
    slowSourceStart,
    slowSourceEnd,
    fastBeforeDuration,
    fastDuration,
    slowDuration,
    fastAfterDuration,
    holdDuration,
    duration,
    hitAt,
    hitTeam,
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
  const discreteBall = alpha >= 0.5 ? next.world.ball : previous.world.ball;
  world.ball.inPlay = discreteBall.inPlay;
  world.ball.hitByTeam = discreteBall.hitByTeam;
  world.ball.canHitTeam = discreteBall.canHitTeam;
  world.ball.rallyShot = discreteBall.rallyShot;
  world.ball.bounces = discreteBall.bounces;
  world.ball.targetTeam = discreteBall.targetTeam;
  world.ball.lastBounceTeam = discreteBall.lastBounceTeam;
  world.ball.netCord = discreteBall.netCord;
  world.ball.shotKind = discreteBall.shotKind;
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
  if (time < selection.fastBeforeDuration) {
    return Math.min(selection.slowSourceStart, selection.sourceStart + time * REPLAY_FAST_SPEED);
  }
  const slowEnd = selection.fastBeforeDuration + selection.slowDuration;
  if (time < slowEnd) {
    return Math.min(selection.slowSourceEnd, selection.slowSourceStart + (time - selection.fastBeforeDuration) * REPLAY_SLOW_SPEED);
  }
  const fastEnd = slowEnd + selection.fastAfterDuration;
  if (time < fastEnd) {
    return Math.min(selection.sourceEnd, selection.slowSourceEnd + (time - slowEnd) * REPLAY_FAST_SPEED);
  }
  return selection.sourceEnd;
}

export function replayProgress(selection: ReplaySelection, elapsed: number) {
  const time = Math.max(0, elapsed);
  const slowStart = selection.fastBeforeDuration;
  const slowEnd = slowStart + selection.slowDuration;
  const slow = time >= slowStart && time < slowEnd;
  return {
    t: selection.duration > 0 ? Math.min(1, time / selection.duration) : 1,
    slow,
    slowProgress: slow && selection.slowDuration > 0
      ? clamp((time - slowStart) / selection.slowDuration, 0, 1)
      : 0,
  };
}
