import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useWin } from '../types.ts';

/** A game the visitor has open, with its room code while that room is public. The Lounge shows it next to their name. */
export type Playing = { game: string; room?: string };

type Report = { playing: Playing; at: number };

const reports = new Map<symbol, Report>();
const listeners = new Set<() => void>();
let current: Playing | null = null;
/** Bumped whenever a game is opened or its window comes to the front: the latest one is what's shown. */
let clock = 0;

function update() {
  let latest: Report | null = null;
  for (const report of reports.values()) if (!latest || report.at > latest.at) latest = report;
  const next = latest?.playing ?? null;
  if (next?.game === current?.game && next?.room === current?.room) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Says a game is open. The returned handle brings it back to the front, or says it's closed. */
export function reportPlaying(playing: Playing): { touch: () => void; stop: () => void } {
  const key = Symbol(playing.game);
  reports.set(key, { playing, at: ++clock });
  update();
  return {
    touch: () => {
      const report = reports.get(key);
      if (!report) return;
      report.at = ++clock;
      update();
    },
    stop: () => {
      reports.delete(key);
      update();
    },
  };
}

export const currentPlaying = () => current;

export function onPlaying(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * While mounted, says `game` is open (with `room` while that room is public). When several windows have games open, the
 * one in the front window most recently is the one shown.
 */
export function usePlayingReport(game: string | null | undefined, room?: string | null) {
  const { active } = useWin();
  const handle = useRef<ReturnType<typeof reportPlaying> | null>(null);
  useEffect(() => {
    if (!game) return;
    const report = reportPlaying(room ? { game, room } : { game });
    handle.current = report;
    return () => {
      report.stop();
      if (handle.current === report) handle.current = null;
    };
  }, [game, room]);
  useEffect(() => {
    if (active) handle.current?.touch();
  }, [active]);
}

/** What the visitor is playing right now, if anything. */
export function usePlaying(): Playing | null {
  return useSyncExternalStore(onPlaying, currentPlaying, () => null);
}
