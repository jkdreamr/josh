// Snake's leaderboard check (see verify/protocol.ts): the Worker steers the snake again, chunk by chunk, with the food
// dropped where the seed it picked says, and takes the score only if the snake ends on it.
//
// init: { cols, rows, dir }: the board as the round began (21 by 13 cells, either way round) and the way its first key
// pointed (DIRECTIONS: 0 up, 1 right, 2 down, 3 left).
// events: in order, [step, dir] for a turn the snake took in after `step` steps, or `step` alone when it hesitated at
// the edge before the next one (the grace before a step that would kill it, see advance in logic.ts).
// at: the steps taken at the end of the chunk.
import type { Verifier } from '../../verify/protocol.ts';
import { createSnake, DIRECTIONS, GRACE, GRID, MAX_SPEED, queueDirection, rng32, speedForLength, startSnake, stepSnake, wouldDie, type SnakeState } from './logic.ts';

/** A chunk covers a few seconds (FEED_MS); one that claims a minute's steps at top speed is not from the game. */
export const MAX_CHUNK_STEPS = Math.ceil(60 * MAX_SPEED);
export const MAX_CHUNK_EVENTS = 4_000;

/** time: seconds the steps so far took on the page's clock (from the first, which comes as the round starts). */
type Run = { s: SnakeState; rng: () => number; steps: number; grace: boolean; time: number };

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Takes the next step as the page's clock does (see advance), timing it. Why the page couldn't have, or null. */
function stepOn(run: Run): string | null {
  const s = run.s;
  if (!s.alive || s.won) return 'step after the end';
  const grace = run.grace;
  if (run.steps > 0) run.time += (1 / speedForLength(s.segments.length)) * (grace ? GRACE : 1);
  run.grace = false;
  run.steps++;
  // the page hesitates before every step that would kill the snake, and records that it did (a step that kills is just
  // one wouldDie foresaw, so the step's own result says it, without looking ahead every step)
  if (stepSnake(s, run.rng) === 'dead' && !grace) return 'no grace';
  return null;
}

function stepTo(run: Run, to: number): string | null {
  while (run.steps < to) {
    const why = stepOn(run);
    if (why) return why;
  }
  return null;
}

export const verifier: Verifier<Run> = {
  start(seed, init) {
    if (!init || typeof init !== 'object') return 'bad start';
    const { cols, rows, dir } = init as { cols?: unknown; rows?: unknown; dir?: unknown };
    const board = (cols === GRID.long && rows === GRID.short) || (cols === GRID.short && rows === GRID.long);
    if (!board || !Number.isInteger(dir) || (dir as number) < 0 || (dir as number) > 3) return 'bad start';
    const rng = rng32(seed);
    const s = createSnake(cols as number, rows as number, rng);
    startSnake(s, DIRECTIONS[dir as number]);
    return { state: { s, rng, steps: 0, grace: false, time: 0 }, board: 'snake' };
  },
  feed(run, events, at) {
    if (!Array.isArray(events) || events.length > MAX_CHUNK_EVENTS || !count(at) || at < run.steps || at - run.steps > MAX_CHUNK_STEPS) return 'bad chunk';
    for (const e of events) {
      const t = Array.isArray(e) ? e[0] : e;
      if (!count(t) || t < run.steps || t > at) return 'bad chunk';
      if (Array.isArray(e) && (e.length !== 2 || !Number.isInteger(e[1]) || e[1] < 0 || e[1] > 3)) return 'bad chunk';
      const why = stepTo(run, t);
      if (why) return why;
      if (Array.isArray(e)) {
        // (the page records only the turns the snake took in: not a reversal, a repeat, or a third in a row)
        if (!queueDirection(run.s, DIRECTIONS[e[1]])) return 'impossible turn';
      } else {
        // (once a step, and only when the step would kill it)
        if (run.grace || !wouldDie(run.s)) return 'bad grace';
        run.grace = true;
      }
    }
    const why = stepTo(run, at);
    if (why) return why;
    return { ms: run.time * 1000 };
  },
  end(run) {
    if (run.s.alive && !run.s.won) return 'still playing';
    return { score: run.s.score };
  },
  // a frame dropped here and there, and a minute and a half of pauses: slowing the snake down for long doesn't rank
  pace: { slow: 0.15, pauseMs: 90_000 },
};
