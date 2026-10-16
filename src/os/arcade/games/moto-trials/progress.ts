// Solo progress for Moto Trials: best times and stars per level, unlocked in order.
// Pure parsing helpers so node tests can cover the corrupt-data paths.
import { LEVEL_IDS } from './levels.ts';

export type Progress = { best: Record<string, number>; stars: Record<string, number> };
export const PROG_KEY = 'arcade:moto-trials:progress';

/** Validates stored progress JSON: unknown ids, non-finite or negative values are dropped. */
export function parseProgress(raw: string | null): Progress {
  const out: Progress = { best: {}, stars: {} };
  if (!raw) return out;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!p || typeof p !== 'object') return out;
  const clean = (m: unknown, max: number) => {
    const o: Record<string, number> = {};
    if (m && typeof m === 'object') {
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        if (LEVEL_IDS.includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max) o[k] = v;
      }
    }
    return o;
  };
  out.best = clean((p as Progress).best, 3_600_000);
  const stars = clean((p as Progress).stars, 3);
  for (const [k, v] of Object.entries(stars)) out.stars[k] = Math.floor(v);
  return out;
}

export function loadProgress(): Progress {
  try {
    return parseProgress(window.localStorage.getItem(PROG_KEY));
  } catch {
    return { best: {}, stars: {} };
  }
}

export function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(PROG_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** Level i+1 unlocks once level i has a recorded best. Online rooms open everything. */
export function unlocked(prog: Progress, id: string): boolean {
  const i = LEVEL_IDS.indexOf(id);
  if (i <= 0) return i === 0;
  return typeof prog.best[LEVEL_IDS[i - 1]] === 'number';
}

/** Sum of the best times over every level, or null while any level is un-cleared. */
export function tourTotal(prog: Progress): number | null {
  let sum = 0;
  for (const id of LEVEL_IDS) {
    const b = prog.best[id];
    if (typeof b !== 'number') return null;
    sum += b;
  }
  return sum;
}

/** How many levels still need a first clear before the tour time exists. */
export function tourLeft(prog: Progress): number {
  return LEVEL_IDS.filter((id) => typeof prog.best[id] !== 'number').length;
}
