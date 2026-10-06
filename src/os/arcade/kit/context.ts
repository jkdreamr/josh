import { createContext, type RefObject } from 'react';
import type { GameMeta } from '../types';
import type { KeyState } from './keys';

export type GameStatus = 'ready' | 'playing' | 'paused' | 'over';
export type GameOverInfo = { title?: string; detail?: string };

export type ShellApi = {
  meta: GameMeta;
  status: GameStatus;
  /** Bumps on every restart. Children of <GameShell> remount on restart unless remount={false}. */
  round: number;
  /** False while the tab is hidden, the Chrome tab is in the background, or the game is off screen. */
  active: boolean;
  compact: boolean;
  /** True on touch devices (phone and iPad frames). */
  touch: boolean;
  keys: KeyState;
  root: RefObject<HTMLDivElement | null>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  /** Ends the round and shows the Game Over overlay. Pass a score to record it against the best. */
  gameOver: (score?: number, info?: GameOverInfo) => void;
  /** Live score shown in the top-left pill (null hides it). */
  setScore: (score: number | null) => void;
  /** Ask idle games to redraw once (useCanvas calls this after a resize). */
  invalidate: () => void;
  onInvalidate: (fn: () => void) => () => void;
};

export const ShellContext = createContext<ShellApi | null>(null);
