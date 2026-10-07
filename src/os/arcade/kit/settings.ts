import { useCallback, useSyncExternalStore } from 'react';

/**
 * A per-game choice (mode, difficulty, side) remembered in localStorage under `arcade:<key>`.
 * Read it with useSetting() both in the shell's setup controls and in the game, so Play, Restart
 * and Play Again all use the last choice.
 */
export type Setting<T extends string> = { key: string; values: readonly T[]; fallback: T };

export function defineSetting<T extends string>(key: string, values: readonly T[], fallback: T): Setting<T> {
  return { key, values, fallback };
}

const storageKey = (key: string) => `arcade:${key}`;
const listeners = new Set<() => void>();
const memory = new Map<string, string>();

export function getSetting<T extends string>(s: Setting<T>): T {
  let v: string | null | undefined = memory.get(s.key);
  if (v === undefined) {
    try {
      v = typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey(s.key));
    } catch {
      v = null;
    }
  }
  return (s.values as readonly string[]).includes(v ?? '') ? (v as T) : s.fallback;
}

export function setSetting<T extends string>(s: Setting<T>, value: T) {
  memory.set(s.key, value);
  try {
    window.localStorage.setItem(storageKey(s.key), value);
  } catch {
    /* private mode: kept in memory only */
  }
  listeners.forEach((f) => f());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSetting<T extends string>(s: Setting<T>): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getSetting(s),
    () => s.fallback,
  );
  const set = useCallback((v: T) => setSetting(s, v), [s]);
  return [value, set];
}
