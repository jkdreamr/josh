import { useCallback, useState } from 'react';

const keyOf = (id: string) => `arcade:best:${id}`;

function read(id: string): number | null {
  try {
    const v = window.localStorage.getItem(keyOf(id));
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Best score for a game, persisted in localStorage. submit() returns true when the score is a new best. */
export function useHighScore(id: string, opts: { lowerIsBetter?: boolean } = {}) {
  const [best, setBest] = useState<number | null>(() => (typeof window === 'undefined' ? null : read(id)));
  const lower = !!opts.lowerIsBetter;
  const submit = useCallback(
    (score: number) => {
      const prev = read(id);
      const better = prev === null || (lower ? score < prev : score > prev);
      if (!better) return false;
      setBest(score);
      try {
        window.localStorage.setItem(keyOf(id), String(score));
      } catch {
        /* private mode: keep it in memory only */
      }
      return true;
    },
    [id, lower],
  );
  return { best, submit };
}
