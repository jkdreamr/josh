// Campaign progress for Bubble Shooter: best stars and score per level, unlocked in order.
// Pure parsing helpers so node tests can cover the corrupt-data paths.
import { LEVEL_IDS } from './levels.ts';

export type Progress = { stars: Record<string, number>; best: Record<string, number> };
export const PROG_KEY = 'arcade:bubble-shooter:progress';

/** Validates stored progress JSON: unknown ids and out-of-range values are dropped. */
export function parseProgress(raw: string | null): Progress {
  const out: Progress = { stars: {}, best: {} };
  if (!raw) return out;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!p || typeof p !== 'object') return out;
  const clean = (m: unknown, min: number, max: number) => {
    const o: Record<string, number> = {};
    if (m && typeof m === 'object')
      for (const [k, v] of Object.entries(m as Record<string, unknown>))
        if (LEVEL_IDS.includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) o[k] = Math.floor(v);
    return o;
  };
  out.stars = clean((p as Progress).stars, 1, 3);
  out.best = clean((p as Progress).best, 0, 10_000_000);
  return out;
}

export function loadProgress(): Progress {
  try {
    return parseProgress(window.localStorage.getItem(PROG_KEY));
  } catch {
    return { stars: {}, best: {} };
  }
}

export function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(PROG_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** Records a clear. Returns true when it beat the stored stars or score. */
export function recordClear(p: Progress, id: string, stars: number, score: number): boolean {
  const better = stars > (p.stars[id] ?? 0) || score > (p.best[id] ?? -1);
  p.stars[id] = Math.max(stars, p.stars[id] ?? 0);
  p.best[id] = Math.max(score, p.best[id] ?? 0);
  return better;
}

/** Level n+1 opens once level n has been cleared. */
export function unlocked(p: Progress, id: string): boolean {
  const i = LEVEL_IDS.indexOf(id);
  if (i <= 0) return i === 0;
  return (p.stars[LEVEL_IDS[i - 1]] ?? 0) > 0;
}

export function totalStars(p: Progress): number {
  return Object.values(p.stars).reduce((n, s) => n + s, 0);
}
