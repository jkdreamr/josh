// The contract every micro-game follows. A micro-game is one file in micro/ that exports a MicroGame and is listed in
// micro/index.ts. It works in arena units: a 100 by 100 square the frame fits to the screen, y pointing down.

export type InputKind = 'tap' | 'drag' | 'hold' | 'swipe' | 'mash' | 'none';
export type Outcome = 'pending' | 'pass' | 'fail';
export type Key = 'left' | 'right' | 'up' | 'down' | 'action';
export type Held = Record<Key, boolean>;

export interface MicroInstance {
  /** Pass or fail decided early (a fail usually ends it at once; a pass can wait for time up). */
  outcome: Outcome;
  /** dt in seconds; t is seconds since play started; held is which keys are down right now. */
  update(dt: number, t: number, held: Held): void;
  /** Draw in arena units: the context is already scaled and translated so the arena is 0..100 on both axes. */
  render(ctx: CanvasRenderingContext2D, t: number): void;
  /** Pointer in arena units (can fall outside 0..100). For `keys: 'cursor'` games the frame also drives these from the keyboard. */
  down?(x: number, y: number): void;
  move?(x: number, y: number): void;
  up?(x: number, y: number): void;
  /** Keyboard, for `keys: 'direct'` games. */
  press?(key: Key): void;
  release?(key: Key): void;
  /** The timer ran out while still pending: the final call. */
  timeUp(): 'pass' | 'fail';
}

export interface MicroGame {
  id: string;
  title: string;
  /** The word that flashes before it, lowercase, ending with ! */
  command: string;
  input: InputKind;
  /**
   * 'cursor': arrow keys move a virtual pointer and space presses it, fed through down/move/up.
   * 'direct': keys go to press/release (space is 'action').
   */
  keys: 'cursor' | 'direct';
  /** Short line shown under the command, for touch and for keys. */
  hint: { touch: string; keys: string };
  /** Seconds of play at a speed tier (0 is the slowest). */
  duration(tier: number): number;
  /** difficulty runs 0 (first games) to 1 (top speed); seed makes every client build the same game. */
  create(seed: number, difficulty: number): MicroInstance;
}

/** The usual timer: about 5 s at first, down to 3 s at speed. */
export const standardDuration = (base = 5, floor = 3) => (tier: number) => Math.max(floor, base - tier * 0.4);
