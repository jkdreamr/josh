// Breakout's leaderboard check (see verify/protocol.ts): the Worker plays the run again, chunk by chunk, with the same
// rules and the seed it picked (which aims every serve and drops every power-up), and takes the score only if the last
// ball goes down on it.
//
// init: { f: [width, height, top, bottom] }: the playfield as the run began (from the window's size, see fieldFor).
// events, in order, each stamped with the step it came before (the run's step count then):
//   [step, 'p', x]  the pointer (mouse or finger) leads the paddle to x, in eighths of a field unit
//   [step, 'k', a]  the arrow keys hold the paddle (-1 left, 0 neither, 1 right) and the pointer lets go
//   [step, 's']     a serve (only when a ball waits on the paddle)
//   [step, 'f', width, height, top, bottom]  the window was resized
// at: the run's step count at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { createBreakout, resizeBreakout, rng32, serve, STEP, stepBreakout, type BreakoutState, type Field } from './logic.ts';

/** Two hours of play: more than any run, and a bound on the work a run can ask of the Worker. */
export const MAX_TICKS = Math.round(7200 / STEP);
/** A chunk covers a few seconds (FEED_MS); one that claims a minute is not from the game. */
export const MAX_CHUNK_TICKS = Math.round(60 / STEP);
export const MAX_CHUNK_EVENTS = 4_000;
/** The pointer can wander off the canvas (it is captured while pressed), but not this far. */
const MAX_POINTER = 1_000_000;

type Run = { g: BreakoutState; rng: () => number; axis: number; x: number | null };

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const stepAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TICKS;

/**
 * A playfield a real window gives (see fieldFor and the page's layout): 480 to 1000 wide, 360 to 900 tall, the bricks
 * starting at least a tenth of the way down and the paddle at least this far off the bottom. (A tiny window pushes
 * the bricks and the paddle in a long way, so there is no tighter bound on those.)
 */
export function fieldOf(f: unknown): Field | null {
  if (!Array.isArray(f) || f.length !== 4 || !f.every(num)) return null;
  const [width, height, top, bottom] = f as number[];
  if (width < 480 || width > 1000 || height < 360 || height > 900) return null;
  if (top < height * 0.1 || top > 1e5 || bottom < Math.min(Math.max(22, height * 0.05), height * 0.06) || bottom > 1e5) return null;
  return { width, height, top, bottom };
}

/** Steps the run up to `to` (or until the last ball is gone). False when that comes first. */
function playTo(run: Run, to: number) {
  while (run.g.ticks < to && !run.g.ended) stepBreakout(run.g, STEP, run.x === null ? run.axis : 0, run.x, run.rng);
  return run.g.ticks >= to;
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init)) return 'bad start';
    const field = fieldOf((init as { f?: unknown }).f);
    if (!field) return 'bad start';
    return { state: { g: createBreakout(1, field), rng: rng32(seed), axis: 0, x: null }, board: 'breakout' };
  },
  feed(run, events, at) {
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !stepAt(at) || at < run.g.ticks || at - run.g.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    for (const e of events) {
      if (!Array.isArray(e) || !stepAt(e[0]) || e[0] < run.g.ticks || e[0] > at) return 'bad chunk';
      // nothing the game counts happens once the last ball is gone (it records nothing after)
      if (!playTo(run, e[0]) || run.g.ended) return 'event after the end';
      const kind = e[1];
      if (kind === 's' && e.length === 2) {
        if (!serve(run.g, run.rng)) return 'no ball to serve';
      } else if (kind === 'p' && e.length === 3 && num(e[2]) && Math.abs(e[2]) <= MAX_POINTER && Number.isInteger(e[2] * 8)) {
        run.x = e[2];
        run.axis = 0;
      } else if (kind === 'k' && e.length === 3 && (e[2] === -1 || e[2] === 0 || e[2] === 1)) {
        run.axis = e[2];
        run.x = null;
      } else if (kind === 'f' && e.length === 6) {
        const field = fieldOf(e.slice(2));
        if (!field) return 'bad chunk';
        resizeBreakout(run.g, field);
      } else return 'bad chunk';
    }
    // (the page stops its clock with the last ball, so a chunk can't run on past it)
    if (!playTo(run, at)) return 'clock after the end';
    return { ms: run.g.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.g.ended) return 'still playing';
    return { score: run.g.score };
  },
  // a frame dropped here and there, and two minutes of pauses: slowing the game down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 120_000 },
};
