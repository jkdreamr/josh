import { createState, rng32, step, STEP, type State } from './logic.ts';

export const RUN_VERSION = 1;
export const RUN_TTL_MS = 15 * 60_000;
export const MAX_RUN_TICKS = 120 * 60 * 10;
export const MIN_FLAP_TICKS = 10;
export const MAX_FLAPS = Math.ceil(MAX_RUN_TICKS / MIN_FLAP_TICKS);
export const REPLAY_WIDTH = 800;

export type RunTicket = { token: string; seed: number; version: number };
export type FlappyProof = RunTicket & { ticks: number; flaps: number[] };
export type Replay = { world: State; rng: () => number; tick: number; flaps: number[]; lastFlap: number; ended: number | null };

export function createReplay(seed: number): Replay {
  return { world: createState(REPLAY_WIDTH), rng: rng32(seed), tick: 0, flaps: [], lastFlap: -MIN_FLAP_TICKS, ended: null };
}

/** One input decision per physics tick, independent of rendering, viewport and idle animation. */
export function tickReplay(run: Replay, flap: boolean) {
  const accepted = flap && !run.world.dead && run.tick - run.lastFlap >= MIN_FLAP_TICKS;
  if (accepted) {
    run.lastFlap = run.tick;
    run.flaps.push(run.tick);
  }
  const events = step(run.world, STEP, { flap: accepted }, run.rng);
  run.tick++;
  if (events.crashed && run.ended === null) run.ended = run.tick;
  return events;
}

export function verifyReplay(seed: number, proof: unknown, claimedScore: number, elapsedMs: number): { score: number } | { error: string } {
  if (!proof || typeof proof !== 'object') return { error: 'missing replay' };
  const p = proof as FlappyProof;
  if (p.version !== RUN_VERSION || p.seed !== seed) return { error: 'wrong course' };
  if (!Number.isInteger(p.ticks) || p.ticks < 1 || p.ticks > MAX_RUN_TICKS || p.ticks * STEP * 1000 > elapsedMs + 250) return { error: 'invalid duration' };
  if (!Array.isArray(p.flaps) || p.flaps.length < 1 || p.flaps.length > MAX_FLAPS || p.flaps[0] !== 0) return { error: 'invalid inputs' };
  let last = -MIN_FLAP_TICKS;
  for (const tick of p.flaps) {
    if (!Number.isInteger(tick) || tick < 0 || tick >= p.ticks || tick - last < MIN_FLAP_TICKS) return { error: 'invalid inputs' };
    last = tick;
  }
  if (!Number.isInteger(claimedScore) || claimedScore < 0) return { error: 'invalid score' };
  const run = createReplay(seed);
  let input = 0;
  while (run.tick < p.ticks) {
    const flap = p.flaps[input] === run.tick;
    if (flap) input++;
    tickReplay(run, flap);
    if (run.world.dead && run.tick !== p.ticks) return { error: 'run already ended' };
  }
  if (!run.world.dead || run.world.score !== claimedScore) return { error: 'replay mismatch' };
  return { score: run.world.score };
}
