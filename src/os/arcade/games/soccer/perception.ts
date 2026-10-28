import type { Level } from './ai.ts';
import { FIELD, STEP, tackleWindow, type Player, type World } from './logic.ts';

export const PERCEPTION_DELAY: Record<Level, number> = { easy: 0.35, normal: 0.25, hard: 0.17 };
const EXTRAPOLATE: Record<Level, number> = { easy: 0, normal: 1, hard: 1 };
export const LUNGE_COMMIT = 0.3;

type Sample = { tick: number; x: number; y: number; z: number; vx: number; vz: number; facing: number; action: string };
type Lunge = { from: number; until: number; x: number; z: number };
type PerceptionState = {
  tick: number;
  samples: Map<number | 'ball', Sample[]>;
  passTarget: number | null;
  passSeenAt: number;
  lunges: Map<number, Lunge>;
};
export type Seen = { x: number; y: number; z: number; vx: number; vz: number; facing: number; action: string };

const states = new WeakMap<World, PerceptionState>();

function createState(tick: number): PerceptionState {
  return { tick: tick - 1, samples: new Map(), passTarget: null, passSeenAt: tick, lunges: new Map() };
}

function stateFor(world: World, tick: number) {
  let state = states.get(world);
  if (!state || tick < state.tick) {
    state = createState(tick);
    states.set(world, state);
  }
  return state;
}

function addSample(state: PerceptionState, id: number | 'ball', sample: Sample) {
  const samples = state.samples.get(id) ?? [];
  samples.push(sample);
  if (samples.length > 30) samples.shift();
  state.samples.set(id, samples);
}

export function observe(world: World, tick: number) {
  const state = stateFor(world, tick);
  if (tick === state.tick) return;
  state.tick = tick;
  if (world.phase !== 'live') {
    state.samples.clear();
    state.lunges.clear();
    state.passTarget = null;
    state.passSeenAt = tick;
    return;
  }
  for (const player of world.players) {
    if (player.sentOff) continue;
    addSample(state, player.id, {
      tick, x: player.x, y: 0, z: player.z, vx: player.vx, vz: player.vz,
      facing: player.facing, action: player.action,
    });
  }
  addSample(state, 'ball', {
    tick, x: world.ball.x, y: world.ball.y, z: world.ball.z, vx: world.ball.vx, vz: world.ball.vz,
    facing: 0, action: 'idle',
  });
  if (world.passTarget !== null && world.passTarget !== state.passTarget) state.passSeenAt = tick;
  state.passTarget = world.passTarget;
}

function currentState(world: World, id: number | 'ball'): Seen {
  if (id === 'ball') return {
    x: world.ball.x, y: world.ball.y, z: world.ball.z, vx: world.ball.vx, vz: world.ball.vz, facing: 0, action: 'idle',
  };
  const player = world.players.find((entry) => entry.id === id);
  return player
    ? { x: player.x, y: 0, z: player.z, vx: player.vx, vz: player.vz, facing: player.facing, action: player.action }
    : { x: 0, y: 0, z: 0, vx: 0, vz: 0, facing: 0, action: 'idle' };
}

export function perceive(world: World, id: number | 'ball', level: Level, tick: number): Seen {
  const delay = Math.round(PERCEPTION_DELAY[level] * 60);
  const history = states.get(world)?.samples.get(id);
  if (!history?.length) return currentState(world, id);
  const cutoff = tick - delay;
  let sample: Sample | undefined;
  for (const candidate of history) {
    if (candidate.tick <= cutoff) sample = candidate;
    else break;
  }
  sample ??= history[0];
  if (!sample) return currentState(world, id);
  const elapsed = Math.min(tick - sample.tick, delay) * STEP * EXTRAPOLATE[level];
  return {
    x: Math.max(-FIELD.length / 2, Math.min(FIELD.length / 2, sample.x + sample.vx * elapsed)),
    y: sample.y,
    z: Math.max(-FIELD.width / 2, Math.min(FIELD.width / 2, sample.z + sample.vz * elapsed)),
    vx: sample.vx,
    vz: sample.vz,
    facing: sample.facing,
    action: sample.action,
  };
}

export function passRead(world: World, level: Level, tick: number) {
  const state = states.get(world);
  return state !== undefined && state.passTarget !== null
    && tick - state.passSeenAt >= Math.round(PERCEPTION_DELAY[level] * 60);
}

export function perceivedTackleWindow(world: World, player: Player, seenOpponent: Player, seenBall: Seen) {
  const shadow = {
    ...world,
    ball: { ...world.ball, x: seenBall.x, y: seenBall.y, z: seenBall.z },
    players: [player, seenOpponent],
  } as World;
  return tackleWindow(shadow, player);
}

export function commitLunge(world: World, id: number, tick: number, move: { x: number; z: number }) {
  stateFor(world, tick).lunges.set(id, {
    from: tick, until: tick + Math.round(LUNGE_COMMIT * 60), x: move.x, z: move.z,
  });
}

export function activeLunge(world: World, id: number, tick: number) {
  const lunge = states.get(world)?.lunges.get(id);
  if (!lunge) return undefined;
  if (tick >= lunge.until) {
    states.get(world)?.lunges.delete(id);
    return undefined;
  }
  if (lunge.from < tick) return lunge;
  return undefined;
}
