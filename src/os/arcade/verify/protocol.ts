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
  start(seed: number, init: unknown): { state: S; board: string } | string;
  /**
   * Plays a chunk of the run on: `events` as the game recorded them since the last chunk, `at` the run's own clock at
   * the end of the chunk (in whatever unit the game stamps events with). The game time (ms) the run has reached, or why
   * the chunk can't be part of a real run.
   */
  feed(state: S, events: unknown, at: unknown): { ms: number } | string;
  /** The score the run ended on, once its last chunk is in, or why there is none (it hasn't ended, say). */
  end(state: S): { score: number } | string;
  /** How the run's clock may lag the Worker's (see paceError). Games with no clock of their own leave it out. */
  pace?: Pace;
  /**
   * Partial checks only (see the README): what this verifier can't check, for the record. Absent for a full replay.
   */
  partial?: string;
};

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

/** How often the game sends a chunk while it plays, and the most a chunk or a run may hold. */
export const FEED_MS = 8_000;
export const MAX_CHUNK_BYTES = 64 * 1024;
export const MAX_CHUNKS = 2_000;
