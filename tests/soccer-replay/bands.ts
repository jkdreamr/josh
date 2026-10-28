// Balance contracts from arcade-soccer-ai.test.ts and arcade-soccer-laws.test.ts.
export const BALANCE = {
  goals: [1, 5],
  maxGoals: 8,
  shotsPerGoal: [3, 10],
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
