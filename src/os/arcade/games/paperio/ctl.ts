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
};

export type OnlineInfo = {
  /** True once the host's round has arrived (guests wait for it). */
  ready(): boolean;
  /** The host calls the end of the round (time up); everyone gets the same result. */
  finish(): void;
  result(): { winner: number | null; order: number[]; winnerSeat: number | null };
  /** A line for the HUD while something is off (waiting for the host, catching up). */
  status(): string | null;
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
  dispose(): void;
  online?: OnlineInfo;
};

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
