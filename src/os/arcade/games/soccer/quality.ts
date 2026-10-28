export function createQualityGovernor(o: { budgetMs?: number; holdMs?: number; gapMs?: number; alpha?: number } = {}) {
  const budgetMs = o.budgetMs ?? 20;
  const holdMs = o.holdMs ?? 1500;
  const gapMs = o.gapMs ?? 250;
  const alpha = o.alpha ?? 0.08;
  let lastAt: number | null = null;
  let overMs = 0;
  let average = 16.7;

  return {
    sample(now: number): boolean {
      if (lastAt === null || now - lastAt > gapMs) {
        lastAt = now;
        overMs = 0;
        return false;
      }
      const interval = now - lastAt;
      lastAt = now;
      average = average * (1 - alpha) + interval * alpha;
      if (average > budgetMs) {
        overMs += interval;
        if (overMs >= holdMs) {
          overMs = 0;
          average = 1000 / 60;
          return true;
        }
      } else {
        overMs = 0;
      }
      return false;
    },
    reset() {
      lastAt = null;
      overMs = 0;
      average = 16.7;
    },
    get avgMs() {
      return average;
    },
  };
}
