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
