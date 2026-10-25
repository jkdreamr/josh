// Computer students. Each has a skill: its chance to pass a game at the slowest speed, which drops as the speed
// rises and drops more on a final exam. The host rolls their results from the round's seed.
import { mix, mulberry32 } from './rng.ts';

export const BOT_ARCHETYPES: readonly { name: string; skill: number }[] = [
  { name: 'the ta', skill: 0.95 },
  { name: 'pset grinder', skill: 0.92 },
  { name: 'frosh', skill: 0.82 },
  { name: 'coterm', skill: 0.9 },
  { name: 'nap pod regular', skill: 0.78 },
  { name: 'band kid', skill: 0.86 },
  { name: 'econ major', skill: 0.84 },
  { name: 'grad student', skill: 0.9 },
  { name: 'the rower', skill: 0.85 },
  { name: 'senior', skill: 0.88 },
  { name: 'fountain hopper', skill: 0.8 },
  { name: 'tree fan', skill: 0.83 },
];
export const BOT_NAMES = BOT_ARCHETYPES.map((b) => b.name);

/** Skill by name (for online bots named by the shell), with a fallback for unknown names. */
export function skillOf(name: string, seat = 0) {
  return BOT_ARCHETYPES.find((b) => b.name === name)?.skill ?? 0.8 + ((seat * 37) % 10) / 100;
}

export function passChance(skill: number, tier: number, boss: boolean) {
  return Math.max(0.1, Math.min(0.98, skill - tier * 0.07 - (boss ? 0.15 : 0)));
}

/** Whether a bot passes game n, the same on any machine given the round's seed. */
export function botPasses(seed: number, n: number, seat: number, skill: number, tier: number, boss: boolean) {
  return mulberry32(mix(seed, n, seat, 5))() < passChance(skill, tier, boss);
}

/** When during play a bot's tile shows its result, as a share of the play time. */
export const botRevealAt = (seed: number, n: number, seat: number) => 0.35 + mulberry32(mix(seed, n, seat, 9))() * 0.6;
