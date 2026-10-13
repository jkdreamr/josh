import { useCallback, useSyncExternalStore } from 'react';

/**
 * A per-game choice (mode, difficulty, side) remembered in localStorage under `arcade:<key>`.
 * Read it with useSetting() both in the shell's setup controls and in the game, so Play, Restart
 * and Play Again all use the last choice. Start the key with the game id (`<id>:mode`).
 * Changing a setting on the Pause card means the round in progress no longer matches it, so the
 * shell offers New Game instead of Resume. Mark purely cosmetic settings the game applies
 * mid-round (scenery, colors) with `{ live: true }` to keep Resume.
 */
export type Setting<T extends string> = { key: string; values: readonly T[]; fallback: T; live?: boolean };

export function defineSetting<T extends string>(key: string, values: readonly T[], fallback: T, opts: { live?: boolean } = {}): Setting<T> {
  return opts.live ? { key, values, fallback, live: true } : { key, values, fallback };
}

export type SettingChange = { key: string; from: string; to: string; live: boolean };
const changeListeners = new Set<(change: SettingChange) => void>();

/** Called whenever a setting takes a new value. Returns the unsubscribe function. */
export function onSettingChange(fn: (change: SettingChange) => void) {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

/**
 * Folds one change into the settings changed since a pause began (key to its value at the pause).
 * Switching back to the original value undoes it. Returns true while any setting still differs.
 */
export function trackSettingChange(changed: Map<string, string>, change: SettingChange): boolean {
  if (!change.live) {
    if (!changed.has(change.key)) changed.set(change.key, change.from);
    if (changed.get(change.key) === change.to) changed.delete(change.key);
  }
  return changed.size > 0;
}

/** True when a setting key belongs to the game (`<id>:mode`, `<id>-scenery` or just `<id>`). */
export const isGameSetting = (key: string, game: string) => key === game || key.startsWith(`${game}:`) || key.startsWith(`${game}-`);

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
  const from = getSetting(s);
  memory.set(s.key, value);
  try {
    window.localStorage.setItem(storageKey(s.key), value);
  } catch {
    /* private mode: kept in memory only */
  }
  listeners.forEach((f) => f());
  if (from !== value) changeListeners.forEach((f) => f({ key: s.key, from, to: value, live: !!s.live }));
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
