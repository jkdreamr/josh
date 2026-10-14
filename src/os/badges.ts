import { useSyncExternalStore } from 'react';
import type { AppId } from './types';

/** Unread counts apps put on their Dock icons (the Lounge, while it has messages you haven't seen). */
const counts = new Map<AppId, number>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setBadge(app: AppId, n: number) {
  const next = Math.max(0, Math.floor(n));
  if ((counts.get(app) ?? 0) === next) return;
  if (next) counts.set(app, next);
  else counts.delete(app);
  for (const listener of listeners) listener();
}

export const badgeOf = (app: AppId) => counts.get(app) ?? 0;

/** "3", or "99+" past that. */
export const badgeLabel = (n: number) => (n > 99 ? '99+' : String(n));

export function useBadge(app: AppId): number {
  return useSyncExternalStore(subscribe, () => badgeOf(app), () => 0);
}
