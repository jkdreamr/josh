// Dino Run's leaderboard check (see verify/protocol.ts): the Worker runs the course again, chunk by chunk, with the
// obstacles drawn from the seed it picked, and takes the score only if the dino goes down on it.
//
// init: { w }: the view's width in world units as the run began (obstacles come in at its right edge).
// events: in order, [tick, keys] when the keys held change (1 jump, 2 duck, 3 both, 0 neither), or [tick, 'w', width]
// when the view's width does, `tick` being the steps taken (STEP each) before it applies.
// at: the run's tick count at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { createState, hop, rng32, STEP, tick, VIEW_MAX, VIEW_MIN, type Events, type Input, type State } from './logic.ts';

/** A chunk covers a few seconds (FEED_MS); one that claims a minute is not from the game. */
export const MAX_CHUNK_TICKS = Math.round(60 / STEP);
export const MAX_CHUNK_EVENTS = 4_000;

type Run = { s: State; rng: () => number; keys: number; input: Input; ev: Events };

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const view = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= VIEW_MIN && n <= VIEW_MAX;

/** Runs on to tick `to` with the keys held (or until the dino goes down). */
function runTo(run: Run, to: number) {
  while (run.s.ticks < to && !run.s.dead) tick(run.s, run.input, run.rng, run.ev);
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object') return 'bad start';
    const { w } = init as { w?: unknown };
    if (!view(w)) return 'bad start';
    // (as the page starts a run: its first world, the view it has, and the hop)
    const s = createState(600);
    s.viewW = w;
    hop(s);
    const ev: Events = { jumped: false, landed: false, crashed: false, milestone: 0, night: null };
    return { state: { s, rng: rng32(seed), keys: 0, input: { jump: false, duck: false }, ev }, board: 'dino' };
  },
  feed(run, events, at) {
    const s = run.s;
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !count(at) || at < s.ticks || at - s.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    for (const e of events) {
      if (!Array.isArray(e) || !count(e[0]) || e[0] < s.ticks || e[0] > at) return 'bad chunk';
      // (the page records only changes: keys that differ from the ones held, a width that differs from the view's)
      if (e.length === 2) {
        if (!Number.isInteger(e[1]) || e[1] < 0 || e[1] > 3 || e[1] === run.keys) return 'bad chunk';
      } else if (e.length !== 3 || e[1] !== 'w' || !view(e[2]) || e[2] === s.viewW) return 'bad chunk';
      runTo(run, e[0]);
      // nothing the game counts happens once the dino is down (it records neither keys nor widths after the crash)
      if (s.dead) return 'event after the crash';
      if (e.length === 2) {
        run.keys = e[1];
        run.input = { jump: (e[1] & 1) !== 0, duck: (e[1] & 2) !== 0 };
      } else s.viewW = e[2];
    }
    runTo(run, at);
    if (s.ticks !== at) return 'clock past the crash';
    return { ms: s.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.s.dead) return 'still running';
    return { score: Math.floor(run.s.score) };
  },
  // a frame dropped here and there, and a minute and a half of pauses: slowing the run down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 90_000 },
};
