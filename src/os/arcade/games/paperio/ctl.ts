// Controllers: who runs the world. Local modes run a Match; online rounds run a host or guest session. Pure.
import { matchTick, type Match } from './match.ts';
import type { Player, World } from './world.ts';

export type Pose = { x: number; y: number; h: number; alive: boolean; out: boolean };

/** What an online round knows about the room (the game builds it from the kit's useOnline()). */
export type Net = {
  seat: number;
  round: number;
  isHost: boolean;
  players(): { seat: number; name: string }[];
  send(d: unknown, opts?: { to?: number; fast?: boolean }): void;
  onMessage(fn: (from: number, d: unknown) => void): () => void;
  /** Reports the round's winner (a seat) for the room's Online Wins board. */
  report(winnerSeat: number | null): void;
};

export type OnlineInfo = {
  /** True once the host's round has arrived (guests wait for it). */
  ready(): boolean;
  /** The host calls the end of the round (time up); everyone gets the same result. */
  finish(): void;
  result(): { winner: number | null; order: number[]; winnerSeat: number | null };
  /** A line for the HUD while something is off (waiting for the host, catching up). */
  status(): string | null;
  /** This page was hidden or shown. A hidden host's round stops, so it tells everyone to hold still. */
  setAway(away: boolean): void;
};

export type Ctl = {
  w: World;
  /** Players steered on this device (one, or two in split screen). */
  locals: number[];
  duration: number;
  elapsed(): number;
  tick(): void;
  isOver(): boolean;
  winner(): number | null;
  /** Interpolated pose of a head for drawing. */
  pose(p: Player, alpha: number, out: Pose): void;
  /** Seconds until a dead player is back, or null when they are not coming back. */
  respawnIn(p: Player): number | null;
  /** Once per rendered frame with real seconds (network sends and receives). */
  frame?(dt: number): void;
  /** Seconds before the round starts moving (online countdown), 0 once it runs. */
  countdown?(): number;
  /** Bumps when the world or its players are replaced (a guest's round arriving). */
  version?(): number;
  dispose(): void;
  online?: OnlineInfo;
};

/**
 * Arrow keys and WASD the way Paper.io 2 reads them: each key names a direction on the screen (up is north, and the
 * camera never turns), two neighbouring keys aim between them, and the head swings round toward that heading at the
 * usual turn rate. Letting go keeps the heading the head has reached. Returns the heading to aim at, NaN while held
 * keys cancel out (left with right: the head runs straight on), or null when no key is held (the mouse or a finger
 * steers instead).
 */
export function keyAim(up: boolean, down: boolean, left: boolean, right: boolean): number | null {
  if (!up && !down && !left && !right) return null;
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  return x || y ? Math.atan2(y, x) : NaN;
}

/**
 * The up, down, left and right keys that steer local player `i`. Alone, the kit's aliases cover both the arrows and
 * WASD; in split screen player 1 has WASD and player 2 the arrows.
 */
export function steerKeys(i: number, split: boolean): readonly [string, string, string, string] {
  if (!split) return ['up', 'down', 'left', 'right'];
  return i === 0 ? ['KeyW', 'KeyS', 'KeyA', 'KeyD'] : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
}

export function lerpPose(p: Player, alpha: number, out: Pose) {
  out.x = p.px + (p.x - p.px) * alpha;
  out.y = p.py + (p.y - p.py) * alpha;
  const dh = Math.atan2(Math.sin(p.h - p.ph), Math.cos(p.h - p.ph));
  out.h = p.ph + dh * alpha;
  out.alive = p.alive;
  out.out = p.out;
}

export function localCtl(m: Match, locals: number[]): Ctl {
  return {
    w: m.w,
    locals,
    duration: m.opts.duration,
    elapsed: () => m.elapsed,
    tick: () => matchTick(m),
    isOver: () => m.over,
    winner: () => m.winner,
    pose: lerpPose,
    respawnIn: (p) => (p.respawnAt > 0 && p.respawnAt !== Infinity ? Math.max(0, p.respawnAt - m.w.time) : m.opts.respawn ? 3 : null),
    dispose() {},
  };
}
