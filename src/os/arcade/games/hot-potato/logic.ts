// Hot Potato rules, kept pure so they run under node: the fuse length, how the fuse looks as it burns (never a
// straight line, so nobody can read the time left off it), how fast it ticks, the prompt piles and the loss tally.
import type { Rng } from '../../kit/party-core.ts';
import { CATEGORIES, LETTERS } from './prompts.ts';

export type PromptKind = 'category' | 'letters';
export type Prompt = { kind: PromptKind; text: string };
export type PromptMode = 'categories' | 'letters' | 'mix';
export type FuseSetting = 'short' | 'normal' | 'long';

/** Fuse length range in seconds for each setting. */
export const FUSES: Record<FuseSetting, readonly [number, number]> = {
  short: [10, 25],
  normal: [15, 40],
  long: [25, 60],
};

/** Sips for whoever is holding it, in the Drinks rule. */
export const LOSER_SIPS = 2;

/** Every prompt for a mode. */
export function promptsFor(mode: PromptMode): Prompt[] {
  const out: Prompt[] = [];
  if (mode !== 'letters') for (const text of CATEGORIES) out.push({ kind: 'category', text });
  if (mode !== 'categories') for (const text of LETTERS) out.push({ kind: 'letters', text });
  return out;
}

/** A random fuse length in seconds inside the setting's range. */
export function fuseLength(setting: FuseSetting, rng: Rng = Math.random): number {
  const [lo, hi] = FUSES[setting] ?? FUSES.normal;
  return lo + rng() * (hi - lo);
}

/** How the fuse burns: knots of [share of the time gone, share of the fuse gone], from [0, 0] to [1, end]. */
export type Burn = readonly (readonly [number, number])[];

/** The fuse blows with this share of it burned, picked per round so the stub left at the boom gives nothing away. */
export const BURN_END: readonly [number, number] = [0.78, 0.95];

/**
 * A burn profile for one round. The fuse alternates between surging and crawling (speeds 0.25x to 2.2x) over
 * segments of uneven length, so how far it has burned says little about how long is left.
 */
export function burnProfile(rng: Rng = Math.random, segments = 6): Burn {
  const n = Math.max(2, Math.floor(segments));
  const times = Array.from({ length: n }, () => 0.6 + rng() * 0.8);
  const fastFirst = rng() < 0.5;
  const speeds = times.map((_, i) => ((i % 2 === 0) === fastFirst ? 1.3 + rng() * 0.9 : 0.25 + rng() * 0.45));
  const end = BURN_END[0] + rng() * (BURN_END[1] - BURN_END[0]);
  const tSum = times.reduce((a, b) => a + b, 0);
  const bSum = times.reduce((a, t, i) => a + t * speeds[i], 0);
  const knots: [number, number][] = [[0, 0]];
  let t = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    t += times[i] / tSum;
    b += ((times[i] * speeds[i]) / bSum) * end;
    knots.push([t, b]);
  }
  knots[n] = [1, end];
  return knots;
}

/** Share of the fuse burned when `p` of the time is gone. */
export function burnAt(burn: Burn, p: number): number {
  if (!burn.length) return 0;
  const x = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
  for (let i = 1; i < burn.length; i++) {
    const [t1, b1] = burn[i];
    if (x <= t1) {
      const [t0, b0] = burn[i - 1];
      return t1 > t0 ? b0 + ((b1 - b0) * (x - t0)) / (t1 - t0) : b1;
    }
  }
  return burn[burn.length - 1][1];
}

export const TICK_MIN = 0.1;
export const TICK_MAX = 1.1;

/**
 * Seconds until the next tick with `left` seconds on the fuse: a steady tick while there's plenty of time, speeding
 * up over the last 20 seconds or so, always with some jitter so nobody can count it down.
 */
export function tickGap(left: number, rng: Rng = Math.random): number {
  const l = Math.max(0, Number.isFinite(left) ? left : 0);
  const base = 0.14 + 0.8 * Math.min(1, l / 24) ** 0.8;
  return Math.min(TICK_MAX, Math.max(TICK_MIN, base * (0.75 + rng() * 0.5)));
}

/** Who starts a round: whoever lost the last one, or anyone at random. */
export function nextStarter(players: number, lastLoser: number | null, rng: Rng = Math.random): number {
  if (players <= 0) return 0;
  if (lastLoser !== null && lastLoser >= 0 && lastLoser < players) return lastLoser;
  return Math.floor(rng() * players);
}

/** Rounds lost this session, by player name (names survive editing the roster between rounds). */
export type Tally = Readonly<Record<string, number>>;

const own = (t: Tally, name: string) => Object.prototype.hasOwnProperty.call(t, name);

export const lossesOf = (t: Tally, name: string): number => (own(t, name) ? t[name] : 0);

export function addLoss(t: Tally, name: string): Tally {
  const out: Record<string, number> = { ...t };
  Object.defineProperty(out, name, { value: lossesOf(t, name) + 1, enumerable: true, writable: true, configurable: true });
  return out;
}

/** Takes back one loss (the Undo after tapping the wrong name). */
export function removeLoss(t: Tally, name: string): Tally {
  const n = lossesOf(t, name) - 1;
  const out: Record<string, number> = { ...t };
  if (n > 0) Object.defineProperty(out, name, { value: n, enumerable: true, writable: true, configurable: true });
  else delete out[name];
  return out;
}

export type Standing = { name: string; seat: number; losses: number };

/** The table from most losses to fewest; ties keep seating order. */
export function standings(t: Tally, names: readonly string[]): Standing[] {
  return names.map((name, seat) => ({ name, seat, losses: lossesOf(t, name) })).sort((a, b) => b.losses - a.losses || a.seat - b.seat);
}

/** The session leader: whoever has lost the most (everyone tied at the top), or nobody before the first loss. */
export function leaders(t: Tally, names: readonly string[]): string[] {
  const max = Math.max(0, ...names.map((n) => lossesOf(t, n)));
  return max > 0 ? names.filter((n) => lossesOf(t, n) === max) : [];
}
