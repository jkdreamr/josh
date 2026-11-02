// The game loop's timing, kept apart from React so tests can use it.

export const MAX_DT = 1 / 20;
/** The most time a realtime loop catches up on in one frame (beyond it, the game skips ahead rather than racing). */
export const MAX_CATCH_UP = 1 / 4;

/**
 * Splits `elapsed` seconds into update steps of at most MAX_DT. A plain loop takes one step of at most MAX_DT, so a
 * frame slower than that plays in slow motion; a realtime loop takes as many as cover the elapsed time (up to
 * MAX_CATCH_UP), so the game keeps to the clock. The first frame steps 0.
 */
export function loopSteps(elapsed: number, realtime: boolean): number[] {
  const dt = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (!realtime) return [Math.min(dt, MAX_DT)];
  let left = Math.min(dt, MAX_CATCH_UP);
  if (left <= 0) return [0];
  const steps: number[] = [];
  while (left > 1e-9) {
    const step = Math.min(left, MAX_DT);
    steps.push(step);
    left -= step;
  }
  return steps;
}
