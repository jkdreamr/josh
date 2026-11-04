// How a game proves a leaderboard score to the Worker. Pure: shared by the games (which record runs) and the Worker
// (which replays them).
//
// A run is opened as play begins (POST /runs), which picks the seed the run's randomness must come from. The game says
// how the run starts (POST /runs/start: `init`, which also names the board), then sends what the player did in chunks
// as it plays (POST /runs/feed), and its last chunk with the score it ended on (POST /runs/finish). The Worker plays
// each chunk on through the game's own rules (a Verifier) as it arrives, so no one request has much to do, and checks
// the run keeps pace with its own clock. The score only goes on the board if the replay ends on it, once.

/** What a game's verifier does with a run, holding whatever state it needs between chunks (kept in memory). */
export type Verifier<S = unknown> = {
  /**
   * A run's state from its seed and how it says it starts, with the board it counts for (one of the owner's boards),
   * or why it can't be.
   */
  start(seed: number, init: unknown, run: RunInfo): { state: S; board: string } | string;
  /**
   * Plays a chunk of the run on: `events` as the game recorded them since the last chunk, `at` the run's own clock at
   * the end of the chunk (in whatever unit the game stamps events with). The game time (ms) the run has reached, or why
   * the chunk can't be part of a real run.
   */
  feed(state: S, events: unknown, at: unknown): { ms: number } | string;
  /**
   * The score the run ended on, once its last chunk is in, or why there is none (it hasn't ended, say). A `daily`
   * verifier also says which day the run played and whether it won it.
   */
  end(state: S): { score: number; day?: { day: number; won: boolean } } | string;
  /** How the run's clock may lag the Worker's (see paceError). Games with no clock of their own leave it out. */
  pace?: Pace;
  /**
   * Partial checks only (see the README): what this verifier can't check, for the record. Absent for a full replay.
   */
  partial?: string;
  /**
   * A board whose score is a streak of days won, one game a day (Word Guess). A streak is longer than any one run, so
   * the Worker keeps it, for each device (a random key the page keeps, sent with /runs/start): a run's `end` gives the
   * day it played and whether it won, the Worker carries the device's streak on (or ends it), and that streak is the
   * score the run can put on the board. A device plays each day once.
   */
  daily?: true;
};

/** What the Worker knows of a run as it starts: when it was opened (ms, the Worker's clock). */
export type RunInfo = { issued: number };

/** A device's key for daily boards: random, kept by the page, sent with /runs/start. */
export const isDeviceKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(v);

/**
 * slow: how much longer than its game time a run may take on the Worker's clock (0.15 is 15%: a frame here and there).
 * pauseMs: time on top of that for pauses. A game whose clock is the wall clock itself (puzzles, card games) uses
 * WALL_CLOCK: its time can't run ahead of the Worker's, and may lag it as long as it likes.
 */
export type Pace = { slow: number; pauseMs: number };
export const WALL_CLOCK: Pace = { slow: Number.POSITIVE_INFINITY, pauseMs: Number.POSITIVE_INFINITY };
/** How far a run's clock may run ahead of the Worker's: the trip to the Worker, and a little drift. */
export const AHEAD_MS = 2_500;

/** Why a run's game time `gameMs` can't be right `wallMs` after its start on the Worker's clock, or null. */
export function paceError(gameMs: number, wallMs: number, pace: Pace | undefined): string | null {
  if (!Number.isFinite(gameMs) || gameMs < 0) return 'bad clock';
  if (gameMs > wallMs + AHEAD_MS) return 'too fast';
  if (pace && wallMs > gameMs * (1 + pace.slow) + pace.pauseMs) return 'too slow';
  return null;
}

/**
 * How often the game sends a chunk while it plays: the first soon (the Worker's first replay of a run warms it up, so
 * it gets little to do), then every FEED_MS (each chunk is a request, and the Workers Free plan allows 100,000 a day).
 * And the most a chunk or a run may hold.
 */
export const FIRST_FEED_MS = 4_000;
export const FEED_MS = 15_000;
export const MAX_CHUNK_BYTES = 64 * 1024;
export const MAX_CHUNKS = 2_000;
