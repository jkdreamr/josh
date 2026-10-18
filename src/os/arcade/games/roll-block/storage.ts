// Progress for Roll Block: which level to open and the best (lowest) move count per level.
// localStorage under arcade:roll-block:progress; falls back to memory when storage is unavailable.

const KEY = 'arcade:roll-block:progress';

export type Progress = { current: number; best: Record<string, number> };

let memory: Progress = { current: 0, best: {} };

function clean(v: unknown, levelCount: number): Progress {
  const p = v && typeof v === 'object' ? (v as Progress) : null;
  const best: Record<string, number> = {};
  if (p && p.best && typeof p.best === 'object') {
    for (const [k, n] of Object.entries(p.best)) {
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) best[k] = Math.floor(n);
    }
  }
  const current = p && typeof p.current === 'number' && p.current >= 0 ? Math.floor(p.current) : 0;
  return { current: Math.min(current, Math.max(0, levelCount - 1)), best };
}

export function readProgress(levelCount: number): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return (memory = clean(JSON.parse(raw), levelCount));
  } catch {
    /* storage unavailable or bad json: use memory */
  }
  return memory;
}

export function writeProgress(p: Progress) {
  memory = p;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: keep the in-memory copy */
  }
}

/** The level to open: picking one from the list makes it the one a restart or reload comes back to. */
export function selectLevel(p: Progress, idx: number): Progress {
  return { current: idx, best: p.best };
}

export type Clear = { progress: Progress; best: number; prev: number | undefined; allCleared: boolean; next: number };

/**
 * Records a clear of level `idx` in `moves`. Next goes to the following level, or after the last one to the first
 * level not yet cleared. The campaign is done only once every level has a best, never just because the last one was beaten.
 */
export function recordClear(p: Progress, ids: readonly string[], idx: number, moves: number): Clear {
  const id = ids[idx];
  const prev = p.best[id];
  const best = Math.min(prev ?? Infinity, moves);
  const bests = { ...p.best, [id]: best };
  const open = ids.findIndex((k) => bests[k] === undefined);
  const isLast = idx + 1 >= ids.length;
  const allCleared = open < 0 && (prev === undefined || isLast);
  const next = !isLast ? idx + 1 : open < 0 ? 0 : open;
  return { progress: { current: allCleared ? 0 : next, best: bests }, best, prev, allCleared, next };
}
