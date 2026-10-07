import { useContext, useEffect, useRef } from 'react';
import { ShellContext } from './context';

/** Friendly names that match several physical keys. */
export const keyAliases: Record<string, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  action: ['Space', 'Enter'],
};

/** Keys that would scroll the page or click a focused button if we let them through. */
export const scrollKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'PageUp', 'PageDown', 'Home', 'End', 'Enter']);

export type KeyListener = (code: string, e: KeyboardEvent | null) => void;

/** Held/pressed state for KeyboardEvent.code values (e.g. 'ArrowLeft', 'KeyW', 'Space') plus the aliases above. */
export class KeyState {
  private held = new Set<string>();
  private hits = new Set<string>();
  readonly listeners = new Set<KeyListener>();

  private expand(names: string[]) {
    return names.flatMap((n) => keyAliases[n] ?? [n]);
  }
  /** True while any of the keys is held. */
  down(...names: string[]) {
    return this.expand(names).some((c) => this.held.has(c));
  }
  /** True once per physical press of any of the keys (consumes the press). */
  pressed(...names: string[]) {
    let hit = false;
    for (const c of this.expand(names))
      if (this.hits.delete(c)) hit = true;
    return hit;
  }
  /** -1, 0 or 1 from two opposing keys, e.g. axis('left', 'right'). */
  axis(neg: string, pos: string) {
    return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0);
  }
  press(code: string, e: KeyboardEvent | null = null) {
    if (!this.held.has(code)) this.hits.add(code);
    this.held.add(code);
    this.listeners.forEach((f) => f(code, e));
  }
  release(code: string) {
    this.held.delete(code);
  }
  clear() {
    this.held.clear();
    this.hits.clear();
  }
}

const fallback = new KeyState();

/**
 * Keyboard state for the current game. Keys are only captured while focus is inside the game, and they stop
 * propagating so OS shortcuts and page scrolling never fire. Cmd/Ctrl/Alt combos always pass through.
 * onPress (optional) fires on every key down, including repeats and on-screen touch buttons.
 */
export function useKeys(onPress?: KeyListener): KeyState {
  const shell = useContext(ShellContext);
  const keys = shell?.keys ?? fallback;
  const cb = useRef(onPress);
  cb.current = onPress;
  useEffect(() => {
    if (!onPress) return;
    const f: KeyListener = (c, e) => cb.current?.(c, e);
    keys.listeners.add(f);
    return () => {
      keys.listeners.delete(f);
    };
  }, [keys, !!onPress]);
  return keys;
}
