// Word Guess's leaderboard check (see verify/protocol.ts). The board is the Daily Word Streak, which only the Worker
// keeps (Verifier.daily): a run is one device's daily word, and this checks it was the day's word, played that day,
// and solved (or not) in the guesses the page sent. The Worker then carries the device's streak on, and that streak is
// what the run can put on the board, so a streak can't be typed in, or kept in a browser's storage and edited there.
//
// init: { day, rows }: the day's number (dayNumber of the Pacific date) and the guesses already made on this device
//   before the run began (a daily left half done and come back to).
// events, in order: [t, guess], t whole ms since the run began (the page's clock), each guess five letters a to z.
// at: the page's clock as the chunk was sent.
//
// What no check here can stop: the day's word comes from a list the page holds (the game plays offline too), so a
// player who reads it out of the page, or out of a friend, wins that day. A streak still takes a win every day, one
// game a day on a device, each on its own day by the Worker's clock.
import { WALL_CLOCK, type Verifier } from '../../verify/protocol.ts';
import { ANSWERS } from './answers.ts';
import { dailyIndex, dayNumber, pacificDate, TRIES, unpack, WORD } from './logic.ts';

export const BOARD = 'wordguess';
/** A day, and a little: the most a daily can be left open and come back to, and a bound on the clock a run claims. */
const MAX_AT = 26 * 3_600_000;

const LIST = unpack(ANSWERS);
const isGuess = (g: unknown): g is string => typeof g === 'string' && g.length === WORD && /^[a-z]+$/.test(g);

type Run = { day: number; answer: string; rows: string[]; at: number };

const won = (run: Run) => run.rows[run.rows.length - 1] === run.answer;
const over = (run: Run) => won(run) || run.rows.length >= TRIES;

export const verifier: Verifier<Run> = {
  daily: true,
  // (a guess isn't timed: the board is a streak of days, and the Worker keeps the days)
  pace: WALL_CLOCK,
  start(_seed, init, run) {
    if (!init || typeof init !== 'object' || Array.isArray(init)) return 'bad start';
    const { day, rows } = init as { day?: unknown; rows?: unknown };
    // the day the run was opened, in California, where the daily word turns over
    if (!run || !Number.isSafeInteger(run.issued) || day !== dayNumber(pacificDate(new Date(run.issued)))) return 'wrong day';
    if (!Array.isArray(rows) || rows.length >= TRIES || !rows.every(isGuess)) return 'bad start';
    const answer = LIST[dailyIndex(day, LIST.length)];
    // (a daily already solved is over: there is nothing left to play)
    if (rows.includes(answer)) return 'bad start';
    return { state: { day, answer, rows: [...rows], at: 0 }, board: BOARD };
  },
  feed(run, events, at) {
    if (!Number.isSafeInteger(at) || (at as number) < run.at || (at as number) > MAX_AT) return 'bad chunk';
    if (!Array.isArray(events) || events.length > TRIES) return 'bad chunk';
    let last = run.at;
    for (const e of events) {
      if (!Array.isArray(e) || e.length !== 2) return 'bad chunk';
      const [t, guess] = e as [unknown, unknown];
      if (!Number.isSafeInteger(t) || (t as number) < last || (t as number) > (at as number) || !isGuess(guess)) return 'bad chunk';
      if (over(run)) return 'guess after the end';
      run.rows.push(guess);
      last = t as number;
    }
    run.at = at as number;
    return { ms: run.at };
  },
  end(run) {
    if (!over(run)) return 'still guessing';
    const solved = won(run);
    return { score: solved ? run.rows.length : 0, day: { day: run.day, won: solved } };
  },
};
