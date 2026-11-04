// Blocks' leaderboard check (see verify/protocol.ts): the Worker plays the run again, chunk by chunk, with the same
// rules and the pieces its seed deals, and takes the score only if the stack tops out on it.
//
// init: { board: 'blocks' } (solo play has the one board).
// events: [step, what] in order, each stamped with the fixed step it came before (see STEP in logic.ts): 'l' or 'r' a
// column over, 'd' a row down by a drag (a point), 'cw' or 'ccw' a turn, 'hold', 'drop' a hard drop; or
// [step, 'soft', 1 | 0] as the soft drop key goes down or up. Only what took effect is recorded (a move into a wall
// isn't), so each one must take effect in the replay too.
// at: the run's step count at the end of the chunk.
import { FEED_MS, type Verifier } from '../../verify/protocol.ts';
import { createGame, dragDown, hardDrop, holdPiece, move, rotate, runRandom, STEP, tick, type BlocksGame } from './logic.ts';

export const BOARD = 'blocks';
/** Four hours of play: more than any game, and a bound on the work a run can ask of the Worker. */
export const MAX_TICKS = Math.round((4 * 3600) / STEP);
/** A chunk covers FEED_MS of play (the page sends one that often); one that claims twice that is not from the game. */
export const MAX_CHUNK_TICKS = Math.round((2 * FEED_MS) / 1000 / STEP);
/** The page sends a chunk early once it holds 1,000 moves (see kit/run.ts); twice that is not from the game. */
export const MAX_CHUNK_EVENTS = 2_000;
/**
 * Hard drops a second at most (the fastest players place six or seven pieces a second, and mashing the key tops the
 * stack out in a couple of seconds), with a few to spare for a short chunk: each one locks a piece, the most work a
 * move asks of the replay.
 */
export const MAX_DROPS_PER_SECOND = 10;
const SPARE_DROPS = 8;

export type Run = { g: BlocksGame; rand: () => number; soft: boolean };

const stepAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TICKS;

/** Plays the run on to step `to`, or until the stack tops out. */
function playTo(run: Run, to: number) {
  while (run.g.ticks < to && !run.g.over) tick(run.g, run.soft, run.rand);
}

/** Does one recorded move. False when the game could not have done it then. */
function apply(run: Run, what: unknown, on: unknown): boolean {
  const g = run.g;
  switch (what) {
    case 'l':
      return move(g, -1);
    case 'r':
      return move(g, 1);
    case 'd':
      return dragDown(g);
    case 'cw':
      return rotate(g, 1);
    case 'ccw':
      return rotate(g, -1);
    case 'hold':
      return holdPiece(g, run.rand);
    case 'drop':
      if (!g.active) return false;
      hardDrop(g, run.rand);
      return true;
    case 'soft':
      // (the key goes down, then up: the page records each change once)
      if ((on !== 0 && on !== 1) || (on === 1) === run.soft) return false;
      run.soft = on === 1;
      return true;
    default:
      return false;
  }
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init) || Object.keys(init).length !== 1 || (init as { board?: unknown }).board !== BOARD) return 'bad start';
    const rand = runRandom(seed);
    return { state: { g: createGame(rand), rand, soft: false }, board: BOARD };
  },
  feed(run, events, at) {
    const g = run.g;
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !stepAt(at) || at < g.ticks || at - g.ticks > MAX_CHUNK_TICKS) return 'bad chunk';
    let drops = SPARE_DROPS + MAX_DROPS_PER_SECOND * (at - g.ticks) * STEP;
    for (const e of events) {
      if (!Array.isArray(e) || e.length < 2 || e.length > 3 || (e[1] === 'soft') !== (e.length === 3)) return 'bad chunk';
      const t = e[0];
      if (!stepAt(t) || t < g.ticks || t > at) return 'bad chunk';
      if (e[1] === 'drop' && --drops < 0) return 'too many drops';
      playTo(run, t);
      // nothing the player does counts once the stack is over the top (the page records nothing after it)
      if (g.over) return 'move after the game ended';
      if (!apply(run, e[1], e[2])) return 'impossible move';
    }
    playTo(run, at);
    // (a game that ended before the run's clock did is not the game the page played)
    if (g.ticks !== at) return 'clock does not replay';
    return { ms: g.ticks * STEP * 1000 };
  },
  end(run) {
    if (!run.g.over) return 'still playing';
    return { score: run.g.score };
  },
  // a frame dropped here and there, and a minute and a half of pauses: slowing the fall down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 90_000 },
};
