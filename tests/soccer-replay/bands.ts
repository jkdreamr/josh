// Balance contracts from arcade-soccer-ai.test.ts and arcade-soccer-laws.test.ts.
export const BALANCE = {
  goals: [1, 5],
  maxGoals: 8,
  // Real top-flight football averages roughly 9–11 shots per goal; 12 leaves room for seed variance in 8-match cohorts.
  shotsPerGoal: [3, 12],
  completion: [0.65, 0.9],
  possession: [0.35, 0.65],
  homeWinLossGap: 3,
  homeSampleSize: 8,
  fouls: 2,
  offsides: 2.5,
  reds: 0,
  ladderGap: 2,
  ladderSampleSize: 10,
  hardEasyWins: 7,
  hardEasyLosses: 1,
} as const;
