// Stack's leaderboard check (see verify/protocol.ts): the Worker slides and drops the slabs again, chunk by chunk, and
// takes the score only if the tower ends on it, at a pace that kept up with its own clock.
//
// init: {} (Stack has one board, and nothing in it is random: every tower starts the same, and the seed decides nothing).
// events: the tick each drop came on (STEP each), in order.
// at: the run's tick count at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { create, drop, STEP, tick, type State } from './logic.ts';

/** A chunk covers a few seconds (FEED_MS); one that claims a minute is not from the game. */
export const MAX_CHUNK_TICKS = Math.round(60 / STEP);
export const MAX_CHUNK_EVENTS = 4_000;

type Run = { s: State };

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export const verifier: Verifier<Run> = {
  start(_seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init) || Object.keys(init).length) return 'bad start';
    return { state: { s: create() }, board: 'stack' };
  },
  feed(run, events, at) {
    const s = run.s;
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !count(at) || at < s.ticks || at - s.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    for (const t of events) {
      if (!count(t) || t < s.ticks || t > at) return 'bad chunk';
      // nothing drops once a slab has missed (the slide stops there, and so does the run's clock)
      if (s.over) return 'drop after the miss';
      while (s.ticks < t) tick(s);
      drop(s);
    }
    while (s.ticks < at && !s.over) tick(s);
    if (s.ticks !== at) return 'clock past the miss';
    return { ms: s.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.s.over) return 'still stacking';
    return { score: run.s.score };
  },
  // a frame dropped here and there, and a minute and a half of pauses: slowing the slabs down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 90_000 },
};
