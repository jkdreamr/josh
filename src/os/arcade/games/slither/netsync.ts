// Noodle's online play apart from the screen: how a guest moves its own snake, how the host takes its word for it, and
// where a guest draws everyone else. Pure (no React, no canvas), so tests can run a host and guests over a slow link.
//
// A guest steers its own snake itself, by the same rules the host's world uses (steer in world.ts), so a turn or a
// boost shows on its next tick rather than a round trip and two buffers later. Every tick it tells the host where its
// head went (each packet repeats the last few ticks, so a lost one costs nothing). The host walks the snake along that
// path, a point a tick, as long as the snake could have gone that way (no faster than its speed, no sharper than its
// turn rate); a point it couldn't have reached is pulled back to the nearest one it could. It walks the points at the
// pace the guest made them (each is numbered by the guest's tick), as far behind as the least delayed packet plus
// the link's recent jitter, so a late or bunched packet doesn't make the snake lurch for everyone else. A point later
// than that is walked as soon as it comes; one that hasn't come when due (most likely in a lost packet, so it comes
// a tick late in the next) has the snake carry on a tick the way it was going. Older guests, which only send where
// they are steering, are steered by that on the host as before.
//
// The host alone decides crashes and meals, on its own picture of the arena. It never corrects a guest's snake while
// it lives: it moves one itself only when it spawns it, takes it over because the guest has gone quiet (a hidden tab,
// a stalled link), or finds its reports out of step with what the snake could do. Each of those bumps the snake's
// warp, which goes out with every state; a guest whose snake's warp went up takes the host's position for it and
// moves on from there, and the host ignores whatever a guest says about an older warp.
//
// Fairness. The host judges a guest's head where the guest last said it was (about half a round trip behind the
// guest's own screen) against everyone else where the host has them now, while the guest sees everyone else a little
// over half a round trip plus INTERP in the past. Bodies stay where they were laid, so running into one is judged as
// the guest saw it. A head-on meeting, or another snake cutting across the guest's nose, is judged on the host's
// view, where the guest is a moment behind and the other snake a moment ahead of what the guest saw: the guest can
// lose a race to a cut that looked like a near miss, and a cut the guest makes lands a moment later than it looked.
// That is the usual .io trade, for a snake that never waits on the host and is never pulled back.
//
// Everyone else a guest sees is drawn INTERP behind the host's newest state, eased between the states either side
// of that moment on the host's clock (the tick each was taken at) rather than by when the packets happened to
// arrive, so a late or bunched packet doesn't make them stutter.
import { REPORT_TICKS, quantAngle, type OwnReport, type SnakeState } from './net.ts';
import {
  BOOST_MIN, BOOST_SPEED, SPEED, TICK, angleDiff, eats, growBody, maxTurnRate, placeHead, steer, wrapAngle,
  type Input, type PathPoint, type Pellet, type Snake, type World,
} from './world.ts';

/** The host sends everyone's heads this often (20 a second). */
export const STATE_EVERY = 1 / 20;
/** A guest draws everyone else this far behind the host's newest state, so there is nearly always a state either side. */
export const INTERP = 0.1;
/** A guest snake the host has heard nothing from for this long carries on the way it was steering (see HostHeads.input). */
export const QUIET = 0.5;
/** A guest that has heard nothing from the host for this long holds its own snake still: the host's round has stopped. */
export const SILENT = 1;
/** A guest sends at least this often, moving or not, so the host knows it is still there. */
export const KEEPALIVE = 0.1;
/** Online rounds keep to the wall clock, making up at most this much of a slow frame. */
export const CATCH_UP = 0.25;

/** How much faster and sharper than the rules a reported path may be (rounding, and a mass a moment out of date). */
const SLACK = 1.15;
/** A guest may boost on a mass this far below the minimum: its copy of its mass is a moment old. */
const BOOST_GRACE = 1;
/** How far the first point after a warp may be from where the host has the snake (it moved on from a state a moment old). */
const FIRST_REACH = 160;
/** A reported point this far beyond what the rules allow means the guest is out of step: the host warps its snake. */
const RESYNC = 60;
/** Reported points the host holds for a snake (a host whose page was hidden comes back to a pile of them). */
const QUEUE_MAX = 90;
/** A pellet a guest's own snake ate comes back if the host hasn't taken it away after this long. */
const UNEATEN = 1.5;
/** The most the host holds a guest's points back to even out the link's jitter. */
const PLAYOUT_MAX = 0.1;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const hundredth = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------
// Host

/** The least (or most) of what came in the last two to four seconds. */
class Recent {
  private current: number;
  private previous: number;
  private since = -Infinity;
  private readonly most: boolean;
  constructor(most: boolean) {
    this.most = most;
    this.current = this.previous = most ? -Infinity : Infinity;
  }
  add(value: number, now: number) {
    if (now - this.since >= 2) {
      this.previous = this.current;
      this.current = this.most ? -Infinity : Infinity;
      this.since = now;
    }
    this.current = this.most ? Math.max(this.current, value) : Math.min(this.current, value);
  }
  get value() {
    return this.most ? Math.max(this.current, this.previous) : Math.min(this.current, this.previous);
  }
}

type Reported = { n: number; x: number; y: number; angle: number; boost: boolean };
type Guest = {
  /** Its moves come from its owner's reports (or it waits for them); false: steered by its target, as older guests are. */
  follows: boolean;
  /** Its owner reports where its snake goes (an older guest doesn't). */
  reports: boolean;
  /** The guest tick of the last point walked this warp (-1: none yet). */
  last: number;
  queue: Reported[];
  /** When its last move packet came (host seconds). */
  heard: number;
  target: number;
  boost: boolean;
  /** How far behind the guest's tick clock its packets come (the least lately), and how much later than that they vary. */
  lag: Recent;
  jitter: Recent;
  /** Whether it was carried on a tick on its own because the point due then hadn't come (a lost packet): that point is skipped when it does. */
  ahead: boolean;
  /** Whether the last point walked was boosting, and how far it turned. */
  boosted: boolean;
  turned: number;
};
export type MoveReport = { target: number; boost: boolean } & Partial<OwnReport>;

/** The host's side of guests' own snakes: their reported paths, and each snake's warp. */
export class HostHeads {
  private guests = new Map<number, Guest>();
  private warps: number[] = [];

  /** (A guest the host hasn't heard from yet waits for its word, heading the way it was.) */
  private guest(id: number, now: number, target: number): Guest {
    let g = this.guests.get(id);
    if (!g) {
      g = {
        follows: true, reports: true, last: -1, queue: [], heard: now, target, boost: false,
        lag: new Recent(false), jitter: new Recent(true), ahead: false, boosted: false, turned: 0,
      };
      this.guests.set(id, g);
    }
    return g;
  }

  warp(id: number) {
    return this.warps[id] ?? 0;
  }

  /** Every snake's warp, in id order, for the state packet. */
  warpList(world: World): number[] {
    return world.snakes.map((snake) => this.warp(snake.id));
  }

  /**
   * The host moved this snake itself (spawned it, took it over, pulled it back into step): older reports no longer
   * count, and a guest that reports waits for its word from here.
   */
  moved(id: number) {
    this.warps[id] = this.warp(id) + 1;
    const g = this.guests.get(id);
    if (g) {
      g.follows = g.reports;
      g.last = -1;
      g.queue = [];
      g.lag = new Recent(false);
      g.jitter = new Recent(true);
      g.ahead = false;
    }
  }

  /** Someone new steers this snake (a person took a bot's seat, or joined again): it waits for their word, from where it is. */
  reset(snake: Snake, now: number) {
    const g = this.guest(snake.id, now, snake.angle);
    g.reports = true;
    this.moved(snake.id);
    g.heard = now;
    g.target = snake.angle;
    g.boost = false;
  }

  /** A guest's move packet for its snake, at host time `now` (seconds). */
  receive(id: number, move: MoveReport, now: number) {
    const g = this.guest(id, now, move.target);
    g.heard = now;
    g.target = move.target;
    g.boost = move.boost;
    // an older guest says only where it is steering
    if (move.p === undefined || move.n === undefined || move.w === undefined) {
      g.follows = g.reports = false;
      return;
    }
    g.reports = true;
    // about a snake the host has moved since (or, -1, one the guest hasn't picked up yet): it hasn't heard yet
    if (move.w !== this.warp(id)) return;
    g.follows = true;
    const count = Math.floor(move.p.length / 4);
    let newest = g.queue.length ? g.queue[g.queue.length - 1].n : g.last;
    // (only a packet with a new tick in it times the link: one repeating the last, sent while it waits, would look late)
    if (count && move.n > newest) {
      const lag = now - move.n * TICK;
      g.lag.add(lag, now);
      g.jitter.add(lag - g.lag.value, now);
    }
    for (let i = 0; i < count; i++) {
      const n = move.n - (count - 1 - i);
      if (n <= newest) continue;
      g.queue.push({ n, x: move.p[i * 4], y: move.p[i * 4 + 1], angle: move.p[i * 4 + 2], boost: move.p[i * 4 + 3] === 1 });
      newest = n;
    }
    if (g.queue.length > QUEUE_MAX) g.queue.splice(0, g.queue.length - QUEUE_MAX);
  }

  /**
   * How a guest's snake moves this tick (host time `now`, seconds): along the points its owner reported that are due
   * by now (none: it holds still until they are), or, for an older guest or one gone quiet, toward its target.
   */
  input(snake: Snake, now: number): Input {
    const g = this.guest(snake.id, now, snake.angle);
    if (g.follows && now - g.heard > QUIET) {
      // gone quiet: it carries on the way it was steering, and the guest picks up from wherever that takes it
      this.moved(snake.id);
      g.follows = false;
    }
    if (!g.follows) return { target: g.target, boost: g.boost };
    const path = this.walkable(snake, g, now);
    return { target: snake.angle, boost: false, path };
  }

  /** The points due by `now`, as a path the snake could have taken: each within its speed and turn rate of the one before. */
  private walkable(snake: Snake, g: Guest, now: number): PathPoint[] {
    const path: PathPoint[] = [];
    let x = snake.x;
    let y = snake.y;
    let angle = snake.angle;
    // A point is due once its guest tick is this far behind (the least delayed packet's lag, plus the jitter lately).
    // The snake keeps to a point a tick while one is due within half a tick either way, so a due time that falls
    // right on a tick doesn't flip between a tick with none and a tick with two; points further behind than that
    // are caught up at once.
    const due = now - g.lag.value - Math.min(PLAYOUT_MAX, Math.max(0, g.jitter.value));
    let ready = 0;
    let behind = 0;
    for (const p of g.queue) {
      if (p.n * TICK <= due + TICK / 2) ready++;
      if (p.n * TICK <= due - TICK / 2) behind++;
    }
    const take = behind + (ready > behind ? 1 : 0);
    if (!take && g.last >= 0 && !g.ahead) {
      // Nothing due: most likely a lost packet, whose point comes with the next one a tick late. The snake carries
      // on a tick the way it was going (and turning) rather than stopping dead, and skips that point when it comes.
      const speed = g.boosted && snake.mass > BOOST_MIN ? BOOST_SPEED : SPEED;
      const heading = wrapAngle(angle + g.turned);
      g.ahead = true;
      return [{ x: x + Math.cos(heading) * speed * TICK, y: y + Math.sin(heading) * speed * TICK, angle: heading, boost: g.boosted }];
    }
    let used = 0;
    for (const p of g.queue) {
      if (used >= take) break;
      used++;
      if (g.ahead) {
        // (the tick it was carried on for)
        g.ahead = false;
        g.last = p.n;
        continue;
      }
      const first = g.last < 0;
      const ticks = first ? 1 : clamp(p.n - g.last, 1, 30);
      const speed = p.boost && snake.mass > BOOST_MIN - BOOST_GRACE ? BOOST_SPEED : SPEED;
      const reach = first ? FIRST_REACH : speed * TICK * ticks * SLACK + 0.5;
      const turn = first ? Math.PI : maxTurnRate(snake) * TICK * ticks * SLACK + 0.02;
      const dx = p.x - x;
      const dy = p.y - y;
      const distance = Math.hypot(dx, dy);
      const off = distance > 1e-6 ? angleDiff(Math.atan2(dy, dx), angle) : 0;
      let nx = p.x;
      let ny = p.y;
      if (distance > reach || Math.abs(off) > turn) {
        const heading = angle + clamp(off, -turn, turn);
        const go = Math.min(distance, reach);
        nx = x + Math.cos(heading) * go;
        ny = y + Math.sin(heading) * go;
      }
      g.last = p.n;
      if (Math.hypot(p.x - nx, p.y - ny) > RESYNC) {
        // (not a path this snake could take: have the guest pick up from where the host has it)
        this.moved(snake.id);
        break;
      }
      const turned = clamp(angleDiff(p.angle, angle), -turn, turn);
      g.turned = first ? 0 : turned / ticks;
      angle = wrapAngle(angle + turned);
      path.push({ x: nx, y: ny, angle, boost: p.boost });
      g.boosted = p.boost;
      x = nx;
      y = ny;
    }
    // (after a warp the queue is a new, empty one)
    g.queue.splice(0, used);
    return path;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Guest

/** A guest's own snake: moved here a tick at a time, and reported to the host. */
export class OwnSnake {
  /** The host's warp of our snake that we moved on from; -1 until a host that takes our word has said (an older one never does). */
  warp = -1;
  /** Ticks we have moved our snake, which number our reports. */
  n = 0;
  /** x, y, angle, boost of our last few ticks. */
  private trail: number[] = [];
  private fresh = false;
  private sentAt = -Infinity;
  /** Pellets we ate here that the host hasn't taken away yet. */
  private hidden = new Map<number, { pellet: Pellet; at: number }>();

  /** Whether we move our snake ourselves: the host takes our word for it. */
  get moving() {
    return this.warp >= 0;
  }

  /** A new round, or a host that doesn't take our word: we wait for the host to say where our snake is. */
  reset() {
    this.warp = -1;
    this.trail = [];
    this.fresh = false;
    this.hidden.clear();
  }

  /**
   * One tick of our own snake under our own steering, by the host's rules for moving (crashes and meals are the host's
   * to decide). Pellets it reaches are hidden right away, as the host will eat them; returns how many.
   */
  tick(world: World, snake: Snake, input: Input, now: number): number {
    if (!this.moving || !snake.alive) return 0;
    steer(snake, input);
    growBody(snake);
    this.n++;
    this.trail.push(hundredth(snake.x), hundredth(snake.y), quantAngle(snake.angle), snake.boosting ? 1 : 0);
    if (this.trail.length > REPORT_TICKS * 4) this.trail.splice(0, this.trail.length - REPORT_TICKS * 4);
    this.fresh = true;
    let ate = 0;
    for (const pellet of world.pellets) {
      if (Math.abs(pellet.x - snake.x) > 60 || Math.abs(pellet.y - snake.y) > 60 || !eats(snake, snake, pellet)) continue;
      this.hidden.set(pellet.id, { pellet, at: now });
      ate++;
    }
    if (ate) world.pellets = world.pellets.filter((pellet) => !this.hidden.has(pellet.id));
    return ate;
  }

  /** The host took a pellet away (eaten by us or by anyone). */
  removed(id: number) {
    this.hidden.delete(id);
  }

  /** Pellets we hid that the host never took away come back (it saw our snake miss them); a snapshot replaces them all. */
  expire(world: World, now: number, snapshot = false) {
    for (const [id, { pellet, at }] of this.hidden) {
      if (!snapshot && now - at < UNEATEN) continue;
      this.hidden.delete(id);
      if (!snapshot && !world.pellets.some((p) => p.id === id)) world.pellets.push(pellet);
    }
  }

  /** Whether to send a move now: a host that takes our word hears after every tick we moved; any host, at least every KEEPALIVE. */
  due(now: number, steeringChanged: boolean): boolean {
    const gap = now - this.sentAt;
    if (this.moving) return this.fresh || gap >= KEEPALIVE;
    return gap >= TICK * 0.9 && (steeringChanged || gap >= KEEPALIVE);
  }

  /** Our part of a move packet (warp -1 and no points until we have picked up our snake); marks it sent. */
  report(now: number): OwnReport {
    this.fresh = false;
    this.sentAt = now;
    return { n: this.n, w: this.warp, p: this.moving ? [...this.trail] : [] };
  }

  /**
   * The host's newest state for our snake (with its warp, from a host that takes our word). Its length and score are
   * always the host's. Where it is stays ours, unless the host moved it (the warp went up): then we take the host's
   * position and carry on from there. Returns whether it moved our snake.
   */
  fromHost(snake: Snake, row: SnakeState, warp: number | undefined): boolean {
    const [, x, y, angle, mass, alive, kills, , , , peak] = row;
    snake.kills = kills;
    snake.peak = Math.max(snake.peak, peak);
    if (warp === undefined || warp < this.warp) return false;
    snake.mass = mass;
    if (warp === this.warp) {
      // (a death reaches us as an op too; a state from before it may still be on its way, so only a death counts here)
      if (!alive && snake.alive) {
        snake.alive = false;
        snake.boosting = false;
      }
      return false;
    }
    const wasAlive = snake.alive;
    this.warp = warp;
    this.trail = [];
    snake.alive = alive;
    snake.respawnAt = alive ? null : snake.respawnAt;
    if (alive) placeHead(snake, x, y, angle, !wasAlive);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Drawing everyone else

/** The host's clock as a guest sees it: from the least delayed state, creeping up slowly so a slower link is followed too. */
export class HostClock {
  private offset: number | null = null;

  reset() {
    this.offset = null;
  }

  /** A state taken at host time `t` arrived at local time `now` (both seconds). */
  heard(t: number, now: number) {
    const offset = now - t;
    this.offset = this.offset === null || offset < this.offset ? offset : this.offset + (offset - this.offset) * 0.02;
  }

  /** Host time at local time `now`, or null before any state came. */
  at(now: number): number | null {
    return this.offset === null ? null : now - this.offset;
  }
}

export type StateSample = { t: number; snakes: SnakeState[] };

/** Rows eased between two states; a head that jumped (a respawn) goes straight to where it landed rather than sliding there. */
export function interpolateStates(before: StateSample, after: StateSample, alpha: number): SnakeState[] {
  const previous = new Map(before.snakes.map((row) => [row[0], row]));
  return after.snakes.map((row): SnakeState => {
    const old = previous.get(row[0]);
    if (!old) return row;
    if (Math.hypot(row[1] - old[1], row[2] - old[2]) > 120) return alpha < 0.5 ? old : row;
    return [
      row[0],
      old[1] + (row[1] - old[1]) * alpha,
      old[2] + (row[2] - old[2]) * alpha,
      old[3] + angleDiff(row[3], old[3]) * alpha,
      old[4] + (row[4] - old[4]) * Math.min(1, alpha),
      alpha < 0.5 ? old[5] : row[5],
      row[6],
      alpha < 0.5 ? old[7] : row[7],
      old[8] + (row[8] - old[8]) * Math.min(1, alpha),
      old[9] + (row[9] - old[9]) * Math.min(1, alpha),
      Math.max(old[10], row[10]),
    ] as SnakeState;
  });
}

/** The host's recent states, by the host time each was taken at. */
export class StateBuffer {
  private list: StateSample[] = [];

  reset() {
    this.list = [];
  }

  get size() {
    return this.list.length;
  }

  /** A state taken at host time `t`; one no newer than the newest (fast packets can arrive out of order) is dropped. */
  push(sample: StateSample) {
    const newest = this.list[this.list.length - 1];
    if (newest && sample.t <= newest.t) return;
    this.list.push(sample);
    if (this.list.length > 12) this.list.splice(0, this.list.length - 12);
  }

  /** The newest state. */
  get latest(): StateSample | null {
    return this.list[this.list.length - 1] ?? null;
  }

  /** Everyone at host time `t`: eased between the states either side of it, carried on a moment past the newest, then held. */
  at(t: number): StateSample | null {
    const list = this.list;
    if (!list.length) return null;
    if (list.length === 1 || t <= list[0].t) return list[0];
    let i = 1;
    while (i < list.length - 1 && list[i].t < t) i++;
    const before = list[i - 1];
    const after = list[i];
    const span = Math.max(1e-3, after.t - before.t);
    const alpha = clamp((t - before.t) / span, 0, 1 + 0.05 / span);
    return { t: before.t + span * alpha, snakes: interpolateStates(before, after, alpha) };
  }
}

/** Seconds of wall clock since the last frame, at most CATCH_UP: an online round makes up a slow frame rather than playing it in slow motion. */
export class WallClock {
  private last = -1;

  reset() {
    this.last = -1;
  }

  /** `now`: the frame's time (ms); `dt`: the frame loop's step (0 on its first frame after a stop, which starts the clock over). */
  elapsed(now: number, dt: number): number {
    const last = this.last;
    this.last = now;
    if (last < 0 || dt === 0) return 0;
    return clamp((now - last) / 1000, 0, CATCH_UP);
  }
}
