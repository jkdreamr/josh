// What each game of a round is: which micro-game (three for a final exam), how fast, and its seed. Everything comes
// from the round's seed and the game's number, so the host only has to send the seed and every client agrees.
import { MICRO } from './micro/index.ts';
import { mix, mulberry32, shuffled } from './rng.ts';

export const TIERS_EVERY = 5;
export const BOSS_EVERY = 10;
export const MAX_TIER = 12;

export type Plan = { n: number; ids: string[]; tier: number; boss: boolean; seed: number; difficulty: number; pace: number };

export const tierOf = (n: number) => Math.min(MAX_TIER, Math.floor(n / TIERS_EVERY));
export const isBoss = (n: number) => n % BOSS_EVERY === BOSS_EVERY - 1;
export const difficultyOf = (tier: number, boss = false) => Math.min(1, (tier + (boss ? 1 : 0)) / 4);
export const paceOf = (tier: number) => Math.min(1.75, 1 + Math.max(0, tier - 2) * 0.09);

/** One bag of every micro-game per dozen non-boss games, so nothing repeats until the rest have come up. */
function fromBag(seed: number, normalN: number) {
  const bag = shuffled(mulberry32(mix(seed, Math.floor(normalN / MICRO.length), 1)), MICRO.map((m) => m.id));
  return bag[normalN % MICRO.length];
}

export function planGame(seed: number, n: number): Plan {
  const tier = tierOf(n);
  const boss = isBoss(n);
  const gameSeed = mix(seed, n, 2);
  const normalN = n - Math.floor(n / BOSS_EVERY);
  const ids = boss ? shuffled(mulberry32(mix(seed, n, 3)), MICRO.map((m) => m.id)).slice(0, 3) : [fromBag(seed, normalN)];
  return { n, ids, tier, boss, seed: gameSeed, difficulty: difficultyOf(tier, boss), pace: paceOf(tier + (boss ? 1 : 0)) };
}

/** Seconds of play: a final exam is three quick games back to back. */
export function playTime(plan: Pick<Plan, 'ids' | 'tier' | 'boss'>, duration: (id: string, tier: number) => number) {
  if (!plan.boss) return duration(plan.ids[0], plan.tier);
  return plan.ids.reduce((sum, id) => sum + bossPart(duration(id, plan.tier)), 0);
}
export const bossPart = (d: number) => Math.min(3.6, d);
/** The command flash before play; longer when a decoy curse is in play, so everyone stays in step. */
export const commandTime = (tier: number, decoy: boolean) => Math.max(0.7, 1 - tier * 0.04) + (decoy ? 0.6 : 0);
/** The results beat between games. */
export const resultsTime = (tier: number) => Math.max(1.4, 2 - tier * 0.08);
