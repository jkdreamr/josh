import type { Club } from './teams.ts';

// Simulated penalties for off-screen ties; on-pitch shootout comes from setpieces.ts.
export function simulateShootout(seed: number, home: Club, away: Club) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const chance = (attack: number, defense: number) => Math.max(0.6, Math.min(0.9, 0.75 + 0.01 * (attack - defense) / 2));
  const probabilities = [
    chance(home.ratings.attack, away.ratings.defense),
    chance(away.ratings.attack, home.ratings.defense),
  ] as const;
  const kicks: [boolean[], boolean[]] = [[], []];
  const score: [number, number] = [0, 0];
  const kick = (side: 0 | 1) => {
    const goal = random() < probabilities[side];
    kicks[side].push(goal);
    if (goal) score[side]++;
  };
  for (let round = 0; round < 5; round++) {
    kick(0);
    kick(1);
    const remaining = 4 - round;
    if (score[0] > score[1] + remaining || score[1] > score[0] + remaining) return { score, kicks };
  }
  while (score[0] === score[1]) {
    kick(0);
    kick(1);
  }
  return { score, kicks };
}
