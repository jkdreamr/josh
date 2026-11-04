// Invaders' leaderboard check (see verify/protocol.ts): the Worker plays the run again, chunk by chunk, with the same
// rules and the seed it picked (which fires every invader's shot, sends every saucer and chips every shield), and
// takes the score only if the last cannon goes down (or the invaders land) on it.
//
// init: {} (every round starts the same: wave 1, its banner up for a second).
// events, in order, each stamped with the step it came before (the run's step count then):
//   [step, 'p', x]  the pointer (mouse or finger) leads the cannon to x, in eighths of a field unit
//   [step, 'k', a]  the arrow keys hold the cannon (-1 left, 0 neither, 1 right) and the pointer lets go
//   [step, 'f']     a shot (only when the cannon can fire: up, between waves, with fewer than two shots out)
// at: the run's step count at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { firePlayerShot, newRound, rng32, STEP, steerToward, stepInvaders, type InvadersState } from './logic.ts';

/** Two hours of play: more than any run, and a bound on the work a run can ask of the Worker. */
export const MAX_TICKS = Math.round(7200 / STEP);
/** A chunk covers a few seconds (FEED_MS); one that claims a minute is not from the game. */
export const MAX_CHUNK_TICKS = Math.round(60 / STEP);
export const MAX_CHUNK_EVENTS = 4_000;
/** The pointer can wander off the canvas (it is captured while pressed), but not this far. */
const MAX_POINTER = 1_000_000;

type Run = { g: InvadersState; rng: () => number; axis: number; target: number | null };

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const stepAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TICKS;

/** Steps the run up to `to` (or until it ends). False when that comes first. */
function playTo(run: Run, to: number) {
  const g = run.g;
  while (g.ticks < to && !g.ended) stepInvaders(g, STEP, run.target === null ? run.axis : steerToward(g, run.target, STEP), run.rng);
  return g.ticks >= to;
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init) || Object.keys(init).length) return 'bad start';
    const rng = rng32(seed);
    return { state: { g: newRound(rng), rng, axis: 0, target: null }, board: 'invaders' };
  },
  feed(run, events, at) {
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !stepAt(at) || at < run.g.ticks || at - run.g.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    for (const e of events) {
      if (!Array.isArray(e) || !stepAt(e[0]) || e[0] < run.g.ticks || e[0] > at) return 'bad chunk';
      // nothing the game counts happens once the run is over (it records nothing after)
      if (!playTo(run, e[0]) || run.g.ended) return 'event after the end';
      const kind = e[1];
      if (kind === 'f' && e.length === 2) {
        if (!firePlayerShot(run.g)) return 'cannot fire';
      } else if (kind === 'p' && e.length === 3 && num(e[2]) && Math.abs(e[2]) <= MAX_POINTER && Number.isInteger(e[2] * 8)) {
        run.target = e[2];
        run.axis = 0;
      } else if (kind === 'k' && e.length === 3 && (e[2] === -1 || e[2] === 0 || e[2] === 1)) {
        run.axis = e[2];
        run.target = null;
      } else return 'bad chunk';
    }
    // (the page stops its clock when the run is over, so a chunk can't run on past it)
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
