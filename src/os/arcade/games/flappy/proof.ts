// Proof that a Flappy Tree score was flown, for the global leaderboard. Pure: the game records it, the Worker checks it.
//
// The Worker hands out each run's seed, so the columns are its own. The game records what can't be worked out from the
// seed: the playfield width (and any change to it), where the tree hovered when the run began, and the step each flap
// came on. The Worker flies the run again with the same rules and takes the score only if it comes out the same, and
// only if the run took at least as long as it says (and was not slowed down for long).
import { createState, flap, H, resize, rng32, STEP, tick, type Events, type State } from './logic.ts';

export const PROOF_VERSION = 1;
export type FlappyProof = {
  v: typeof PROOF_VERSION;
  /** Playfield width when the run began. */
  w: number;
  /** Where the tree was when the first flap came (it hovers before then). */
  y0: number;
  /** The step each flap came on, in order (several in one step are fine). */
  flaps: number[];
  /** Playfield width changes after the run began: [step, width]. */
  sizes: [number, number][];
};

/** The widest and narrowest playfields a real window gives (H is 600, so 120 is a 1:5 window and 4000 nearly 7:1). */
export const W_MIN = 120;
export const W_MAX = 4000;
/** An hour of flying: more than any run, and a bound on the work a replay can be asked for. */
export const MAX_TICKS = Math.round(3600 / STEP);
export const MAX_FLAPS = 60_000;
export const MAX_SIZES = 2_000;
/** How far the tree hovers either side of its rest height before the first flap (see hover). */
const HOVER = 8;

const steps = (v: unknown, max: number): v is number[] => {
  if (!Array.isArray(v) || v.length > max) return false;
  let last = 0;
  for (const n of v) {
    if (!Number.isSafeInteger(n) || n < last || n > MAX_TICKS) return false;
    last = n;
  }
  return true;
};

/** A proof as sent over the wire, checked for shape and range, or null. */
export function parseProof(value: unknown): FlappyProof | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (p.v !== PROOF_VERSION) return null;
  const width = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= W_MIN && n <= W_MAX;
  if (!width(p.w) || typeof p.y0 !== 'number' || !Number.isFinite(p.y0) || Math.abs(p.y0 - H * 0.42) > HOVER + 1e-6) return null;
  if (!steps(p.flaps, MAX_FLAPS) || !(p.flaps as number[]).length) return null;
  if (!Array.isArray(p.sizes) || p.sizes.length > MAX_SIZES) return null;
  let last = 0;
  for (const row of p.sizes) {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || row[0] < last || row[0] > MAX_TICKS || !width(row[1])) return null;
    last = row[0];
  }
  return { v: PROOF_VERSION, w: p.w, y0: p.y0, flaps: p.flaps as number[], sizes: p.sizes as [number, number][] };
}

/**
 * Flies the run again from its seed. The score it ends on and how many steps it took, or null when the proof can't be
 * a real run: the tree never comes down, or flaps are said to come after it already crashed.
 */
export function replay(seed: number, proof: FlappyProof): { score: number; ticks: number } | null {
  const s: State = createState(proof.w);
  s.y = proof.y0;
  const rng = rng32(seed);
  const ev: Events = { flapped: false, scored: 0, crashed: false, landed: false };
  const lastEvent = Math.max(proof.flaps[proof.flaps.length - 1] ?? 0, proof.sizes.length ? proof.sizes[proof.sizes.length - 1][0] : 0);
  // (with no flap left, the tree is on the ground within a few seconds)
  const limit = Math.min(MAX_TICKS, lastEvent + Math.round(10 / STEP));
  let f = 0;
  let z = 0;
  while (s.ticks <= limit) {
    while (z < proof.sizes.length && proof.sizes[z][0] === s.ticks) resize(s, proof.sizes[z++][1]);
    while (f < proof.flaps.length && proof.flaps[f] === s.ticks) {
      // a flap the game counted can't come after the crash
      if (s.dead) return null;
      flap(s);
      f++;
    }
    tick(s, rng, ev);
    if (s.grounded) break;
  }
  if (!s.dead || !s.grounded || f < proof.flaps.length || z < proof.sizes.length) return null;
  return { score: s.score, ticks: s.ticks };
}

/** Slack the clock allows a run: some for the network, and for pausing (a run paused longer doesn't rank). */
export const LATE_MS = 2_000;
export const PAUSE_MS = 90_000;
export const SLOW_SHARE = 0.15;

/**
 * Whether a run with this seed, begun `elapsedMs` ago, scored `score`: why not, or null when it did. The run must
 * replay to the score, must not have finished faster than it can be flown, and must not have taken far longer
 * (a game slowed down is easier to fly).
 */
export function checkRun(seed: number, proofValue: unknown, score: number, elapsedMs: number): string | null {
  const proof = parseProof(proofValue);
  if (!proof) return 'bad proof';
  const run = replay(seed, proof);
  if (!run || run.score !== score) return 'score does not replay';
  const flownMs = run.ticks * STEP * 1000;
  if (elapsedMs + LATE_MS < flownMs) return 'too fast';
  if (elapsedMs > flownMs * (1 + SLOW_SHARE) + PAUSE_MS) return 'too slow';
  return null;
}
