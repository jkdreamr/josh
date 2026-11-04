// 2048's leaderboard check (see verify/protocol.ts): the Worker slides the tiles again, chunk by chunk, with every new
// tile dealt from the seed it picked, and takes the score only if the board ends stuck on it.
//
// init: {} (2048 has one board, and every game starts the same way: two tiles from the seed).
// events: [ms, move] in order: ms since the run began (2048 is turn based, so its time is the wall clock), and the
// slide (0 left, 1 right, 2 up, 3 down; only ones that moved a tile) or 4 for the one undo.
// at: ms since the run began, at the end of the chunk.
import { WALL_CLOCK, type Verifier } from '../../verify/protocol.ts';
import { canMove, createGame, MOVES, seeded, slide, spawn, UNDO, type Grid } from './logic.ts';

/** The page sends a chunk every few seconds, or sooner once it holds a thousand moves (no hand slides that fast). */
export const MAX_CHUNK_EVENTS = 1_000;
/** A month of play: past what any run is kept for, and a bound on the run's clock. */
export const MAX_MS = 31 * 24 * 3_600_000;

type Run = { grid: Grid; score: number; rng: () => number; previous: { grid: Grid; score: number } | null; undoUsed: boolean; ms: number };

const msAt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_MS;

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object' || Array.isArray(init) || Object.keys(init).length) return 'bad start';
    const rng = seeded(seed);
    return { state: { grid: createGame(rng), score: 0, rng, previous: null, undoUsed: false, ms: 0 }, board: '2048' };
  },
  feed(run, events, at) {
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !msAt(at) || at < run.ms) return 'bad chunk';
    for (const e of events) {
      if (!Array.isArray(e) || e.length !== 2 || !msAt(e[0]) || e[0] < run.ms || e[0] > at) return 'bad chunk';
      const m = e[1];
      if (!Number.isInteger(m) || m < 0 || m > UNDO) return 'bad chunk';
      run.ms = e[0];
      if (m === UNDO) {
        // (the page offers it once, and only with a slide to take back)
        if (run.undoUsed || !run.previous) return 'no undo';
        run.grid = run.previous.grid;
        run.score = run.previous.score;
        run.previous = null;
        run.undoUsed = true;
        continue;
      }
      const slid = slide(run.grid, MOVES[m]);
      // a slide that moves nothing deals no tile, and the page doesn't record it (nor anything once the board is stuck)
      if (!slid.moved) return 'impossible move';
      if (!run.undoUsed) run.previous = { grid: run.grid, score: run.score };
      run.grid = spawn(slid.grid, run.rng).grid;
      run.score += slid.gained;
    }
    run.ms = at;
    return { ms: at };
  },
  end(run) {
    if (canMove(run.grid)) return 'still playing';
    return { score: run.score };
  },
  pace: WALL_CLOCK,
};
