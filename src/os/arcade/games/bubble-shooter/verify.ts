// Bubble Shooter's leaderboard check (see verify/protocol.ts): the Worker plays an Endless run again, chunk by chunk,
// with the same rules and the board its seed lays out, and takes the score only if the bubbles reach the line on it.
// Only Endless ranks: a level shows no score when it ends (its stars and best stay on this device).
//
// init: { mode: 'endless' }.
// events: in order, each stamped with the fixed step it came before (see STEP in logic.ts): [step, angle] a shot at that
// aim (radians, as the launcher held it), or a bare step for a swap of the two bubbles in the launcher. Only shots that
// went and swaps that happened are recorded, so each one must go in the replay too.
// at: the run's step count at the end of the chunk.
import { FEED_MS, type Verifier } from '../../verify/protocol.ts';
import { createGame, fire, MIN_ANGLE, STEP, swap, tick, type Game } from './logic.ts';

export const BOARD = 'bubble-shooter';
/** Four hours of play: more than any run, and a bound on the work a run can ask of the Worker. */
export const MAX_TICKS = Math.round((4 * 3600) / STEP);
/** A chunk covers FEED_MS of play (the page sends one that often); one that claims twice that is not from the game. */
export const MAX_CHUNK_TICKS = Math.round((2 * FEED_MS) / 1000 / STEP);
/** The page sends a chunk early once it holds 1,000 (see kit/run.ts); twice that is not from the game. */
export const MAX_CHUNK_EVENTS = 2_000;
/**
 * Shots a second at most (one flies at a time, and nobody keeps up more than a few a second, even trading two keys at
 * the line), with a few to spare for a short chunk: each one traces its path and settles, the most work a run asks of
 * the replay.
 */
export const MAX_SHOTS_PER_SECOND = 8;
const SPARE_SHOTS = 8;

export type Run = { g: Game };

const stepAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TICKS;
const aim = (a: unknown): a is number => typeof a === 'number' && a >= MIN_ANGLE && a <= Math.PI - MIN_ANGLE;

/** Plays the run on to step `to`, or until the bubbles reach the line. */
function playTo(g: Game, to: number) {
  while (g.ticks < to && !g.ended) tick(g);
  // (the pops and bounces the page draws from: nothing here reads them)
  g.effects.length = 0;
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init) || Object.keys(init).length !== 1 || (init as { mode?: unknown }).mode !== 'endless') return 'bad start';
    return { state: { g: createGame({ mode: 'endless', seed }) }, board: BOARD };
  },
  feed(run, events, at) {
    const g = run.g;
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !stepAt(at) || at < g.ticks || at - g.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    let shots = SPARE_SHOTS + MAX_SHOTS_PER_SECOND * (at - g.ticks) * STEP;
    for (const e of events) {
      const shot = Array.isArray(e);
      const t = shot ? e[0] : e;
      if (!stepAt(t) || t < g.ticks || t > at || (shot && (e.length !== 2 || !aim(e[1])))) return 'bad chunk';
      if (shot && --shots < 0) return 'too many shots';
      playTo(g, t);
      // nothing the player does counts once the bubbles are at the line (the page records nothing after it)
      if (g.ended) return 'move after the game ended';
      if (shot ? !fire(g, e[1]) : !swap(g)) return 'impossible move';
    }
    playTo(g, at);
    // (a run that ended before the run's clock did is not the run the page played)
    if (g.ticks !== at) return 'clock does not replay';
    return { ms: g.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.g.ended) return 'still playing';
    return { score: run.g.score };
  },
  // a frame dropped here and there, and a minute and a half of pauses: slowing the rows down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 90_000 },
};
