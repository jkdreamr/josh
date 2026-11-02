// Light Cycles online, apart from the screen: when a turn lands, how the host takes people's turns, how a guest keeps
// time with the host, and where a guest shows every rider until the host's word comes. Pure (no DOM), so tests can
// run a host and a guest over a slow link.
//
// The host runs the arena and sends every step to everyone (a tick). A turn lands on a step: the move that takes the
// arena to tick `at`. Offline it lands on the next step, as it always has. Online everyone's turns, the host's own
// included, land a moment later (the input delay: about the slowest guest's one-way trip to the host, 30 to 150 ms,
// and none when the only others are bots). A guest stamps each turn with the step it lands on, so it reaches the host
// before that step comes round and the host makes the turn exactly where the guest made it. The host tells everyone
// each turn as it takes it (a plan), so every screen knows people's turns before they land. A turn that comes too
// late for its step (a lag spike longer than the delay) lands on the host's next step instead, and its sender is put
// right. Bots decide on the host as they always have; the host only works out their next move as soon as the step
// before it is done (nothing about the arena changes in between), so it goes out with that tick and guests see bots
// turn a step early.
//
// A guest keeps the host's clock (HostClock: its pings' round trips, and the ticks themselves) and shows the arena as
// it is on the host now (predict): the host's last tick carried on by the moves it knows are coming (everyone's
// planned turns, bots' next moves), and straight on beyond. So its own cycle moves smoothly, turns the moment the
// player can see it will (a turn landing on the next step bends the head at once) and turns on the host where it
// turned here, and nothing waits for a tick. A cycle about to hit something holds at the wall until the host says.
//
// The trade-off: everyone online turns a beat later than offline (the input delay), the same for everyone, rather
// than a guest's turns landing late (crashing it where it didn't crash) or the host's arena being rewound under it.
import { opposite, DX, DY, type Arena, type Dir } from './cycles.ts';

/**
 * A turn, and the step it lands on: the move that takes the arena to tick `at` (offline 0, the next step whenever that
 * is). A guest numbers its own (`n`) and marks one `heard` once the host has said where it took it.
 */
export type Turn = { dir: Dir; at: number; n?: number; heard?: boolean };

/** Turns a rider can have waiting, as offline. */
export const QUEUE_MAX = 2;
/** The online input delay (seconds): the slowest guest's one-way trip and a margin, within MIN and MAX. FIRST until the trips are known. */
export const DELAY_MIN = 0.03;
export const DELAY_MAX = 0.15;
export const DELAY_FIRST = 0.08;
const DELAY_MARGIN = 0.025;
/** How often a guest pings the host (ms). */
export const PING_MS = 400;
/** How far past the host's last tick a guest shows the arena (seconds): further than any steady link needs, so only a stall stops it. */
export const LEAD = 0.25;
/** Turns a guest sent that the host never answered, this many steps after they were due, are given up on. */
const UNHEARD_STEPS = 12;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * The input delay for an online match (seconds), from the round trip to the host (ms) of each person riding it as a
 * guest, null while one isn't known yet. None with nobody to wait for (the host alone with bots).
 */
export function inputDelay(trips: readonly (number | null)[]): number {
  if (!trips.length) return 0;
  const known = trips.filter((t): t is number => t !== null);
  const slowest = known.length ? clamp(Math.max(...known) / 2000 + DELAY_MARGIN, DELAY_MIN, DELAY_MAX) : DELAY_FIRST;
  return known.length < trips.length ? Math.max(DELAY_FIRST, slowest) : slowest;
}

/**
 * The step a turn made now lands on: `delay` steps on from `phase` (the steps done, and how far into the next one),
 * never before the next step, and after the turn before it (`after`).
 */
export function landing(phase: number, delay: number, after = 0): number {
  return Math.max(Math.floor(phase) + 1, Math.ceil(phase + delay - 1e-6), after + 1);
}

/** Queues a turn (heading: the way the rider is going after the turns already waiting), as offline: never the way it's going or straight back, and two at most. */
export function queueTurn(q: Turn[], heading: Dir, turn: Turn): boolean {
  const last = q.length ? q[q.length - 1].dir : heading;
  if (q.length >= QUEUE_MAX || turn.dir === last || turn.dir === opposite(last)) return false;
  q.push(turn);
  return true;
}

/**
 * The host takes a person's turn, meant to land on step `at` (from a guest older than stamps, undefined: the next
 * step, as it always was). One too late for its step lands on the next one, and turns keep their order, one a step.
 * Returns the step it lands on, or null when it isn't taken.
 */
export function takeTurn(q: Turn[], dir: Dir, at: number | undefined, tick: number): number | null {
  if (at === undefined ? q.length >= QUEUE_MAX || q[q.length - 1]?.dir === dir : q.length >= QUEUE_MAX + 2) return null;
  const land = Math.max(tick + 1, (q[q.length - 1]?.at ?? 0) + 1, Math.min(at ?? 0, tick + 64));
  q.push({ dir, at: land });
  return land;
}

/** The turn a rider makes on the step to tick `k`, taken off its queue (null: it goes on the way it was going). As offline, one it can't make is dropped. */
export function dueTurn(q: Turn[], dir: Dir, k: number): Dir | null {
  while (q.length && q[0].at <= k) {
    const t = q.shift()!;
    if (t.dir !== dir && t.dir !== opposite(dir)) return t.dir;
  }
  return null;
}

/** The way a rider's move to tick `k` goes, leaving its queue be. */
export function nextWay(q: readonly Turn[], dir: Dir, k: number): Dir {
  for (const t of q) {
    if (t.at > k) break;
    if (t.dir !== dir && t.dir !== opposite(dir)) return t.dir;
  }
  return dir;
}

/** A guest heard where the host took one of its own turns (-1: it didn't). */
export function heard(q: Turn[], n: number, at: number) {
  const i = q.findIndex((t) => t.n === n);
  if (i < 0) return;
  if (at < 0) q.splice(i, 1);
  else q[i] = { ...q[i], at, heard: true };
}

/** Someone else's turn, as the host planned it. */
export function planned(q: Turn[], dir: Dir, at: number) {
  if (q.some((t) => t.at === at)) return;
  q.push({ dir, at });
  q.sort((p, r) => p.at - r.at);
}

/** A tick from the host: turns that have landed are done with. A guest keeps its own until the host says where it took them. */
export function prune(queue: Turn[][], tick: number, own: number) {
  queue.forEach((q, id) => {
    for (let i = q.length - 1; i >= 0; i--) {
      const t = q[i];
      if (t.at <= tick && (id !== own || t.heard || t.at < tick - UNHEARD_STEPS)) q.splice(i, 1);
    }
  });
}

/** A guest's own turns as the host will take them: one the host hasn't had yet whose step has gone by lands on the next step (it's late), one a step. */
export function ownPlan(q: readonly Turn[], tick: number): Turn[] {
  let last = tick;
  return q.map((t) => {
    const at = t.heard ? t.at : Math.max(t.at, last + 1);
    last = at;
    return { dir: t.dir, at };
  });
}

/** A rider as the host sends it each tick. */
export type RiderState = { id: number; x: number; y: number; dir: Dir; next: Dir; alive: boolean };

/** A guest takes in the host's riders after a step: each one that moved claims its new cell. */
export function applyTick(a: Arena, riders: readonly RiderState[], tick: number) {
  for (const snapshot of riders) {
    const rider = a.riders[snapshot.id];
    if (!rider) continue;
    if (snapshot.x !== rider.x || snapshot.y !== rider.y) {
      const head = snapshot.y * a.w + snapshot.x;
      if (a.cells[head] === 0) {
        a.cells[head] = rider.id + 1;
        rider.trail.push(head);
      }
    }
    Object.assign(rider, snapshot);
  }
  a.tick = tick || a.tick;
}

/**
 * The arena as a guest shows it: the host's last tick carried on to step `to`. Per rider: the cells it has taken
 * since that tick, its head, the way it last moved and the way its next move goes, and whether that move is blocked
 * (it is about to crash, as far as anyone here can tell; it holds there until the host says).
 */
export type Ahead = { to: number; cells: number[][]; x: number[]; y: number[]; dir: Dir[]; next: Dir[]; blocked: boolean[] };

/**
 * Carries the host's last tick on to step `to`: every rider makes the turns it is known to have coming (`queue`, a
 * guest's own as ownPlan has them, at index `own`) and the host's word on its next move (a bot's), and goes straight
 * on otherwise. Moves are made as the host makes them, all at once, except that nobody crashes: a rider whose way is
 * taken stops short of it.
 */
export function predict(a: Arena, queue: readonly (readonly Turn[])[], own: number, to: number): Ahead {
  const cells = a.cells.slice();
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < a.w && y < a.h && cells[y * a.w + x] === 0;
  const plans = a.riders.map((r) => (r.id === own ? ownPlan(queue[r.id] ?? [], a.tick) : (queue[r.id] ?? []).slice()));
  const ahead: Ahead = { to: Math.max(a.tick, to), cells: [], x: [], y: [], dir: [], next: [], blocked: [] };
  for (const r of a.riders) {
    ahead.cells.push([]);
    ahead.x.push(r.x);
    ahead.y.push(r.y);
    ahead.dir.push(r.dir);
    ahead.next.push(r.next);
    ahead.blocked.push(!r.alive);
  }
  for (let k = a.tick + 1; k <= to; k++) {
    const moves = new Map<number, number[]>();
    for (const r of a.riders) {
      const id = r.id;
      if (ahead.blocked[id]) continue;
      // (the first step goes the way the host said, a bot's next move; after that, straight on)
      const way = dueTurn(plans[id], ahead.dir[id], k) ?? (k === a.tick + 1 ? ahead.next[id] : ahead.dir[id]);
      ahead.next[id] = way;
      const nx = ahead.x[id] + DX[way];
      const ny = ahead.y[id] + DY[way];
      if (!free(nx, ny)) {
        ahead.blocked[id] = true;
        continue;
      }
      const key = ny * a.w + nx;
      const list = moves.get(key);
      if (list) list.push(id);
      else moves.set(key, [id]);
    }
    for (const [key, ids] of moves) {
      if (ids.length > 1) {
        for (const id of ids) ahead.blocked[id] = true;
        continue;
      }
      const id = ids[0];
      ahead.x[id] = key % a.w;
      ahead.y[id] = (key - ahead.x[id]) / a.w;
      ahead.dir[id] = ahead.next[id];
      ahead.cells[id].push(key);
      cells[key] = id + 1;
    }
  }
  for (const r of a.riders) {
    const id = r.id;
    if (ahead.blocked[id]) continue;
    // (the first step past the tick goes the way the host said; later ones straight on, unless a turn is planned)
    const base = ahead.to === a.tick ? ahead.next[id] : ahead.dir[id];
    const way = nextWay(plans[id], ahead.dir[id], ahead.to + 1);
    ahead.next[id] = way !== ahead.dir[id] ? way : base;
    if (!free(ahead.x[id] + DX[ahead.next[id]], ahead.y[id] + DY[ahead.next[id]])) ahead.blocked[id] = true;
  }
  return ahead;
}

/**
 * What a guest shows at `phase` on the host's clock (steps): the arena carried on that far, but never more than LEAD
 * past the host's last tick, and the step on screen (the steps done, and how far into the next one).
 */
export function guestView(a: Arena, queue: readonly (readonly Turn[])[], own: number, phase: number, period: number): { ahead: Ahead; shown: number } {
  const to = Math.max(a.tick, Math.min(Math.floor(phase), a.tick + Math.max(2, Math.ceil(LEAD / period))));
  return { ahead: predict(a, queue, own, to), shown: Math.max(to, Math.min(phase, to + 1)) };
}

/** How long a head takes to glide over a jump (seconds). */
const GLIDE = 0.06;

/**
 * Where to draw each rider's head online, gliding it over a jump rather than snapping it there: a turn heard of after
 * the head had set off the way it was going (a plan that came late, a bot turning), or a guess put right. A move
 * further than the rider could ride in the frame becomes a gap that closes in about GLIDE seconds.
 */
export class Glide {
  private heads = new Map<number, { x: number; y: number; ox: number; oy: number }>();
  clear() {
    this.heads.clear();
  }
  /** Rider `id`'s head is at (x, y) (cells) now, `dt` seconds on from the last frame, riding `speed` cells a second. */
  at(id: number, x: number, y: number, dt: number, speed: number): { x: number; y: number } {
    const was = this.heads.get(id);
    let ox = 0;
    let oy = 0;
    if (was) {
      const fade = Math.exp(-Math.max(0, dt) / GLIDE);
      const jump = Math.hypot(x - was.x, y - was.y);
      // (from where it was drawn, or on from the gap it was already closing; a new round's start is too far to glide)
      const from = jump > speed * dt * 1.5 + 0.05 && jump < 3 ? { x: was.x + was.ox, y: was.y + was.oy } : { x: x + was.ox, y: y + was.oy };
      ox = (from.x - x) * fade;
      oy = (from.y - y) * fade;
      if (jump >= 3) ox = oy = 0;
    }
    this.heads.set(id, { x, y, ox, oy });
    return { x: x + ox, y: y + oy };
  }
}

/** How long a guest keeps what it reads of the host's clock (seconds): long enough to catch a quick packet, short enough to follow a host that slows down. */
const WINDOW = 1.5;
/** Round trips kept, for the delay and the quickest one-way trip. */
const TRIPS = 12;

/**
 * A guest's reading of where the host is in the round (in steps: the steps done, and how far into the next one; the
 * countdown counts up to 0 from below), against its own clock (seconds). A ping's answer says where the host was as it
 * answered, half a round trip ago (the quickest round trip says it best); a tick says where the host was as it sent it,
 * at least the quickest one-way trip ago (the least delayed tick of the last moments says it best). What it shows never
 * goes back and eases onto a new reading, so a cycle carried on by it never jumps.
 */
export class HostClock {
  private trips: number[] = [];
  private pongs: { at: number; trip: number; ahead: number }[] = [];
  private ticks: { at: number; ahead: number }[] = [];
  private period = 1;
  private shown: number | null = null;
  private shownAt = 0;

  /** A new round, with its own step length: what was read of the last one is no good. */
  reset(period: number) {
    this.period = period;
    this.pongs = [];
    this.ticks = [];
    this.shown = null;
  }
  /** A ping sent at our time `sent` came back at `now`; the host was at `phase` as it answered (null: between rounds). */
  pong(sent: number, phase: number | null, now: number) {
    const trip = now - sent;
    if (!(trip >= 0 && trip < 3)) return;
    this.trips.push(trip);
    if (this.trips.length > TRIPS) this.trips.shift();
    if (phase === null || !Number.isFinite(phase)) return;
    this.pongs.push({ at: now, trip, ahead: phase + trip / 2 / this.period - now / this.period });
    while (this.pongs.length > 1 && this.pongs[0].at < now - WINDOW * 2) this.pongs.shift();
  }
  /** A tick the host sent at `phase` came in at our time `now`. */
  tick(phase: number, now: number) {
    if (!this.trips.length || !Number.isFinite(phase)) return;
    this.ticks.push({ at: now, ahead: phase + Math.min(...this.trips) / 2 / this.period - now / this.period });
    while (this.ticks.length > 1 && this.ticks[0].at < now - WINDOW) this.ticks.shift();
  }
  /** The round trip to tell the host (ms): one of the slowest lately, as the host has to wait for those. Null before any. */
  get trip(): number | null {
    if (!this.trips.length) return null;
    const sorted = this.trips.slice().sort((p, q) => q - p);
    return Math.round(sorted[Math.min(sorted.length - 1, sorted.length >= 6 ? 1 : 0)] * 1000);
  }
  /** Where the host is now, or null before anything says. */
  phase(now: number): number | null {
    let best: number | null = null;
    if (this.ticks.length) best = Math.max(...this.ticks.map((t) => t.ahead));
    else if (this.pongs.length) best = this.pongs.reduce((p, q) => (q.trip < p.trip ? q : p)).ahead;
    if (best === null) return null;
    const target = now / this.period + best;
    if (this.shown === null || target - (this.shown + (now - this.shownAt) / this.period) > 1) {
      this.shown = this.shown === null ? target : Math.max(this.shown, target);
    } else {
      const dt = Math.max(0, now - this.shownAt);
      const run = this.shown + dt / this.period;
      // (at most twice as fast or a standstill: a quarter second to settle)
      this.shown = run + clamp((target - run) * Math.min(1, dt * 4), -dt / this.period, dt / this.period);
    }
    this.shownAt = now;
    return this.shown;
  }
}
