// Chicken Crossing's leaderboard check (see verify/protocol.ts): the Worker plays the run again, chunk by chunk, with
// the same rules on the course its seed lays out (every lane, car, log, train and coin), and takes the score only if
// the chicken meets its end on it.
//
// init: {} (the course comes from the seed, and every run starts at the bottom of it).
// events, in order, each stamped with the step it came before (the run's step count then):
//   [step, 'p', direction]  a hop asked for (a key, tap or swipe): 'up', 'down', 'left' or 'right'
//   [step, 'h', direction]  the direction key held down from now on, or null for none
//   [step, 'r']             the game paused or went on, which drops a hop waiting its turn and the key repeat's wait
// at: the run's step count at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { createState, noEvents, STEP, tick, type Direction, type State } from './logic.ts';

/** Two hours of play: more than any run, and a bound on the work a run can ask of the Worker. */
export const MAX_TICKS = Math.round(7200 / STEP);
/** A chunk covers a few seconds (FEED_MS); one that claims a minute is not from the game. */
export const MAX_CHUNK_TICKS = Math.round(60 / STEP);
export const MAX_CHUNK_EVENTS = 4_000;

type Run = { s: State; held: Direction | null };

const DIRECTIONS: readonly unknown[] = ['up', 'down', 'left', 'right'];
const direction = (d: unknown): d is Direction => DIRECTIONS.includes(d);
const stepAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TICKS;

/** Steps the run up to `to` (or until the chicken is gone). False when that comes first. */
function playTo(run: Run, to: number) {
  const ev = noEvents();
  while (run.s.ticks < to && !run.s.dead) tick(run.s, run.held, ev);
  return run.s.ticks >= to;
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init) || Object.keys(init).length) return 'bad start';
    return { state: { s: createState(seed), held: null }, board: 'chicken-crossing' };
  },
  feed(run, events, at) {
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !stepAt(at) || at < run.s.ticks || at - run.s.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    for (const e of events) {
      if (!Array.isArray(e) || !stepAt(e[0]) || e[0] < run.s.ticks || e[0] > at) return 'bad chunk';
      // nothing the game counts happens once the chicken is gone (it records nothing after)
      if (!playTo(run, e[0]) || run.s.dead) return 'event after the end';
      const kind = e[1];
      if (kind === 'p' && e.length === 3 && direction(e[2])) run.s.queued = e[2];
      else if (kind === 'h' && e.length === 3 && (e[2] === null || direction(e[2]))) run.held = e[2];
      else if (kind === 'r' && e.length === 2) {
        run.s.queued = null;
        run.s.repeat = 0;
      } else return 'bad chunk';
    }
    // (the page stops its clock with the chicken, so a chunk can't run on past it)
    if (!playTo(run, at)) return 'clock after the end';
    return { ms: run.s.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.s.dead) return 'still hopping';
    return { score: run.s.score };
  },
  // a frame dropped here and there, and two minutes of pauses: slowing the game down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 120_000 },
};
