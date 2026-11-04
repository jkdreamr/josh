// Flappy Tree's leaderboard check (see verify/protocol.ts): the Worker flies the run again, chunk by chunk, with the
// same rules and the seed it picked, and takes the score only if the tree comes down on it.
//
// init: { w, y0 }: the playfield width as the run began, and where the tree hovered at the first flap.
// events: the step each flap came on (a number), or a playfield width change ([step, width]), in order.
// at: the run's step count at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { createState, flap, H, resize, rng32, STEP, tick, type Events, type State } from './logic.ts';

/** The widest and narrowest playfields a real window gives (H is 600: 120 is a 1:5 window, 4000 nearly 7:1). */
export const W_MIN = 120;
export const W_MAX = 4000;
/** An hour of flying: more than any run, and a bound on the work a run can ask of the Worker. */
export const MAX_TICKS = Math.round(3600 / STEP);
/** A chunk covers a few seconds (FEED_MS); one that claims a minute is not from the game. */
export const MAX_CHUNK_TICKS = Math.round(60 / STEP);
export const MAX_CHUNK_EVENTS = 4_000;
/** How far the tree hovers either side of its rest height before the first flap (see hover). */
const HOVER = 8;

type Run = { s: State; rng: () => number; ev: Events };

const width = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= W_MIN && n <= W_MAX;
const stepAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TICKS;

/** Steps the run up to `to` (or until the tree is down). False when an event would come after it landed. */
function flyTo(run: Run, to: number) {
  while (run.s.ticks < to && !run.s.grounded) tick(run.s, run.rng, run.ev);
  return !run.s.grounded || run.s.ticks >= to;
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object') return 'bad start';
    const { w, y0 } = init as { w?: unknown; y0?: unknown };
    if (!width(w) || typeof y0 !== 'number' || !Number.isFinite(y0) || Math.abs(y0 - H * 0.42) > HOVER + 1e-6) return 'bad start';
    const s = createState(w);
    s.y = y0;
    return { state: { s, rng: rng32(seed), ev: { flapped: false, scored: 0, crashed: false, landed: false } }, board: 'flappy' };
  },
  feed(run, events, at) {
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !stepAt(at) || at < run.s.ticks || at - run.s.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    for (const e of events) {
      const t = Array.isArray(e) ? e[0] : e;
      if (!stepAt(t) || t < run.s.ticks || t > at) return 'bad chunk';
      if (Array.isArray(e) && (e.length !== 2 || !width(e[1]))) return 'bad chunk';
      flyTo(run, t);
      // nothing the game counts happens once the tree is down (it records neither flaps nor resizes after the crash)
      if (run.s.dead) return 'event after the crash';
      if (Array.isArray(e)) resize(run.s, e[1]);
      else flap(run.s);
    }
    flyTo(run, at);
    return { ms: run.s.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.s.dead || !run.s.grounded) return 'still flying';
    return { score: run.s.score };
  },
  // a frame dropped here and there, and a minute and a half of pauses: slowing the game down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 90_000 },
};
