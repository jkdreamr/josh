/**
 * Online badminton, the parts that make a guest's game feel like the host's: kept apart from the page so the tests can
 * run a host and a guest over a slow, uneven link.
 *
 * - A guest moves its own athlete (the host takes its word on where it is, carried on to the host's moment the way the
 *   athlete runs, unless the players have been put in place for a serve since), so its keys answer on the next frame and
 *   nothing pulls it back.
 * - A guest reads the host's clock (pings, or the host's snapshots before a ping comes back), and the host says how each
 *   flight left the racket (Launch), so the guest runs the shuttle on the same physics to the moment it draws: where the
 *   host has it, on the host's clock, with no jumps between snapshots.
 * - A guest's swing meets the shuttle as it is drawn here, on the same rules as offline (playerContact, playerStroke),
 *   and the return is played straight away; the host is told when (host clock), where, and the seed of its scatter. The
 *   host checks that against where it had the shuttle then and plays the same shot from then, carried on to now. So a
 *   well timed swing is judged as the guest saw it (favoring the hitter), and the host sees the return start a little way
 *   out (the time word of it took). To leave room for that word, the host waits that long (HostNet.grace) before calling
 *   a shuttle down on the guest's side.
 * - The other athlete is drawn a moment behind, between the host's snapshots on its clock. The shuttle is drawn on the
 *   host's clock too: on time while it comes to this guest, a little behind while it goes to the host, so the host's
 *   return is known before the shuttle reaches it and the shuttle never jumps back.
 *
 * Older peers still play: an older host never says NetSnapshot.v, and a guest then plays the old way (LegacyGuest); an
 * older guest sends its controls and swings, and the host plays them as they come, as before.
 */
import {
  createFlight, directionOf, FIXED_STEP, HALF_SMASH_POWER, planShot, PLAYER_MAX_ACCURACY, PLAYER_RUN_SPEED, smashCharge, smashRecoveryMs, stepFlight,
  type Direction, type FlightState, type Intent, type Point2D, type ShotType, type Side,
} from '../games/badminton.ts';
import {
  CHARGE_MIN_MS, clampToHalf, PLAYER_GRAVITY, PLAYER_STEP, PLAYER_SWING_COOLDOWN_MS, PLAYER_SWING_MS, playerContact, playerStroke, RACKET_REACH, racketPoint,
  stepPlayerBody,
} from '../games/badminton-cpu.ts';
import { trailPoint, type GuestMessage, type HitMessage, type Launch, type NetPhase, type NetSnapshot, type OwnReport, type ServeMessage } from './badminton-net.ts';
import type { Impact, LandingMark } from './badminton-draw.ts';

/** One step of the match (ms): the host's clock moves on this much per step. */
export const STEP_MS = PLAYER_STEP * 1000;
/** The oldest moment (ms back on the host's clock) a host plays a guest's return or serve from. */
export const REWIND_MAX = 400;
/** Added to the latest a guest's word has arrived, for how long the host waits on its return. */
const GRACE_PAD = 60;
/** How far a guest may say the shuttle was from where the host had it at that moment (metres). */
const BALL_SLACK = 0.5;
/** How far beyond running distance a guest may say it was from the host's copy of it (metres). */
const PLAYER_SLACK = 1.2;
/** Higher than any jump goes (5.2 m/s against 12.4 m/s², about 1.09 m). */
const MAX_JUMP = 1.2;
/** The furthest the host carries a guest's word on its own athlete on (ms). */
const CARRY_MAX = 300;
/** How often a guest says where its own athlete is (ms). */
const REPORT_MS = 33;
/** How long a corrected shuttle takes to come together with where it is (ms, time constant). */
const FIX_TIME = 70;
/** A guest's clock within CLOCK_FAR (ms) of its reading runs at most CLOCK_SLEW faster or slower until they agree. */
const CLOCK_FAR = 250;
const CLOCK_SLEW = 0.06;
/** How quickly (ms per ms) the shuttle comes back on time as it comes to this guest, and falls behind as it goes away. */
const LAG_IN = 0.35;
const LAG_OUT = 0.25;
/** A frame catches up at most this many steps (a quarter second). */
const MAX_STEPS = 60;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

/** How long a smash holds the court still, from how hard it was charged (0..1). */
export function smashFreezeMs(charge: number) {
  return 30 + 90 * charge;
}

/** The same numbers on both screens from the same seed, for a shot's scatter. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * How many steps a launched shuttle has flown by host time t: the step it was played on, then every step after it that
 * the beat after a smash doesn't hold still. -1 before it was played.
 */
export function launchSteps(launch: Launch, t: number): number {
  if (t < launch.at) return -1;
  const total = Math.floor((t - launch.at) / STEP_MS + 1e-6) + 1;
  const frozen = clamp(Math.ceil((launch.fz - launch.at) / STEP_MS - 1e-6) - 1, 0, total - 1);
  return total - frozen;
}

/** The shuttle of `launch` at host time t (the flight as launched before then). */
export function flightAt(launch: Launch, t: number): FlightState {
  let flight = launch.f;
  for (let step = launchSteps(launch, t); step > 0 && flight.status === 'flying'; step--) flight = stepFlight(flight, FIXED_STEP);
  return flight;
}

/** flightAt for times that mostly go forward: carried on from the last answer instead of from the racket each time. */
class FlightCursor {
  private launch: Launch | null = null;
  private done = 0;
  private flight: FlightState | null = null;

  at(launch: Launch, t: number): FlightState | null {
    const steps = launchSteps(launch, t);
    if (steps < 0) return null;
    if (this.launch !== launch || !this.flight || steps < this.done) {
      this.launch = launch;
      this.flight = launch.f;
      this.done = 0;
    }
    while (this.done < steps && this.flight.status === 'flying') {
      this.flight = stepFlight(this.flight, FIXED_STEP);
      this.done++;
    }
    return this.flight;
  }
}

/**
 * A guest's reading of the host's clock (ms). A ping says it best: the host answers with its clock, so it is ahead of
 * ours by c - now + rtt / 2, read from the quickest recent round trip. Until one comes back the host's snapshots stand
 * in: each says the host's clock was at least its time when it arrived, so the least delayed one is taken, drifting up
 * slowly so a slower connection is followed too. The clock in use moves toward the reading a few percent at a time.
 */
export class GuestClock {
  /** Round trips (ms) and how far our clock was ahead of the host's (local less host, ms). */
  private pongs: { rtt: number; offset: number }[] = [];
  private floor: number | null = null;
  private used: number | null = null;

  state(hostClock: number, now: number) {
    const offset = now - hostClock;
    this.floor = this.floor === null || offset < this.floor ? offset : this.floor + (offset - this.floor) * 0.02;
  }

  pong(sent: number, hostClock: number, now: number) {
    const rtt = now - sent;
    if (!(rtt >= 0 && rtt < 2000)) return;
    const offset = now - (hostClock + rtt / 2);
    // (one that disagrees with the others by more than their trips allow means a clock moved, a host that stalled: start over)
    this.pongs = this.pongs.filter((pong) => Math.abs(pong.offset - offset) <= (pong.rtt + rtt) / 2 + 10);
    this.pongs.push({ rtt, offset });
    if (this.pongs.length > 8) this.pongs.shift();
  }

  private get best() {
    let best: { rtt: number; offset: number } | null = null;
    for (const pong of this.pongs) if (!best || pong.rtt < best.rtt) best = pong;
    return best;
  }

  /** The time word takes to come from the host (half the quickest recent round trip, ms), or a guess before one. */
  get oneWay() {
    return this.best ? this.best.rtt / 2 : 50;
  }

  /** The host's clock at our `now` (ms), the clock in use having moved toward its reading for `dt` ms; null before any word. */
  read(now: number, dt: number): number | null {
    const best = this.best;
    const target = best ? Math.min(best.offset, this.floor ?? best.offset) : this.floor;
    if (target === null) return null;
    if (this.used === null || Math.abs(target - this.used) > CLOCK_FAR) this.used = target;
    else this.used += clamp(target - this.used, -CLOCK_SLEW * dt, CLOCK_SLEW * dt);
    return now - this.used;
  }
}

/** An athlete as this guest moves its own: the player's body, swing and smash wind-up, on the host's clock. */
export type Body = {
  x: number;
  vx: number;
  jump: number;
  jumpVelocity: number;
  jumpRequested: boolean;
  swingStart: number;
  swingUntil: number;
  intent: Intent;
  power: number;
  chargeStart: number | null;
  recoverUntil: number;
};
export type GuestInput = { left: boolean; right: boolean; seekX: number | null };
export type ViewAthlete = { x: number; vx: number; jump: number; jumpVelocity: number; swingStart: number; intent: Intent; chargeStart: number | null };
/** What a guest draws, every time on `clock`. */
export type GuestView = {
  clock: number;
  phase: NetPhase;
  athletes: Record<Side, ViewAthlete>;
  flight: FlightState | null;
  trail: Point2D[];
  marks: LandingMark[];
  impact: Impact | null;
  shake: number;
  rallyShots: number;
  lastShot: { type: ShotType; speed: number; power?: number } | null;
};
export type GuestEvent = { kind: 'hit'; type: ShotType; speed: number } | { kind: 'land' } | { kind: 'net' };
/** Something to send the host: on the fast channel, or (`reliable` too) on both. */
export type Out = { d: GuestMessage; fast?: boolean; reliable?: boolean };
export type GuestFrame = { view: GuestView | null; out: Out[]; events: GuestEvent[] };

/** Which way a player is running: to where it was dragged, or by the keys held. */
export function moveOf(input: GuestInput, x: number): -1 | 0 | 1 {
  if (input.seekX !== null) {
    const gap = input.seekX - x;
    return Math.abs(gap) > 0.08 ? (Math.sign(gap) as -1 | 1) : 0;
  }
  return ((input.right ? 1 : 0) - (input.left ? 1 : 0)) as -1 | 0 | 1;
}

const keyOf = (launch: Launch | null) => (launch ? `${launch.n}:${launch.at}` : '');

/**
 * A guest's side of an online match (side b), or a spectator's: give it the host's packets (receive, pong), the keys
 * (press, hold, jump, frame) and it hands back the court to draw, what to send the host, and what to play sounds for.
 */
export class GuestNet {
  readonly clock = new GuestClock();
  readonly watching: boolean;
  /** The host plays this guest's own moves and shots (its snapshots say so). */
  modern = false;
  /** This guest's own athlete, as it moves here. */
  own: Body | null = null;
  /** The host's clock as of the own athlete's last step (ms). */
  ownClock: number | null = null;
  /** The host's clock as last read, and the moment the shuttle was last drawn at (host clock, ms). */
  hostNow = 0;
  ballTime: number | null = null;
  /** The host time the shuttle in the last view is drawn at (ms). */
  drawnAt: number | null = null;
  /** How far behind the host's clock the shuttle is drawn (ms). */
  ballLag = 0;
  /** The court last drawn. */
  view: GuestView | null = null;

  private snaps: NetSnapshot[] = [];
  private warp = -1;
  /** The host's launches this placing, oldest first. */
  private launches: Launch[] = [];
  /** This guest's own return or serve, drawn before the host's word of it. */
  private struck: { launch: Launch; w: number; until: number } | null = null;
  /** No step moves before this (host clock): the beat after a smash. */
  private frozenUntil = -Infinity;
  private cursor = new FlightCursor();
  private shownKey = '';
  /** The shots of this placing that have been heard. */
  private heard = new Set<number>();
  private shownFlying = false;
  private shownAt = -Infinity;
  private shownPos: Point2D | null = null;
  private fix = { x: 0, y: 0 };
  private trail: Point2D[] = [];
  private marks: LandingMark[] = [];
  private shake = 0;
  private last: number | null = null;
  private move: -1 | 0 | 1 = 0;
  private sentMove: -1 | 0 | 1 | null = null;
  private sentAt = -Infinity;
  private pingAt = -Infinity;
  private pingCount = 0;
  /** Pings sent and not yet answered (our clock), so an answer to someone else's is not taken for ours. */
  private pings: number[] = [];

  constructor(watching = false) {
    this.watching = watching;
  }

  /** A snapshot from the host, arriving at our `now` (ms). */
  receive(snap: NetSnapshot, now: number) {
    if (snap.v !== undefined) this.modern = true;
    // (the fast channel can bring them out of order: kept in the host's order, one per moment)
    if (this.snaps.some((entry) => entry.clock === snap.clock)) return;
    this.clock.state(snap.clock, now);
    const index = this.snaps.findIndex((entry) => entry.clock > snap.clock);
    if (index < 0) this.snaps.push(snap);
    else this.snaps.splice(index, 0, snap);
    if (this.snaps.length > 16) this.snaps.shift();
    if (this.snaps.at(-1) === snap) this.newest(snap);
    if ((snap.w ?? 0) === this.warp && snap.l) this.learn(snap.l);
  }

  /** The host's answer to a ping, arriving at our `now`. */
  pong(sent: number, hostClock: number, now: number) {
    const index = this.pings.indexOf(sent);
    if (index < 0) return;
    this.pings.splice(index, 1);
    this.clock.pong(sent, hostClock, now);
  }

  /** The host's newest word: everyone put in place for a serve, or this guest's own shot taken or turned down. */
  private newest(snap: NetSnapshot) {
    const warp = snap.w ?? 0;
    if (warp !== this.warp) {
      this.warp = warp;
      this.snaps = this.snaps.filter((entry) => (entry.w ?? 0) === warp);
      this.launches = [];
      this.struck = null;
      this.marks = [];
      this.heard.clear();
      this.own = this.watching ? null : {
        x: snap.b.x, vx: snap.b.vx, jump: snap.b.jump, jumpVelocity: snap.b.jumpVelocity, jumpRequested: false,
        swingStart: snap.b.swingStart, swingUntil: 0, intent: snap.b.intent, power: HALF_SMASH_POWER, chargeStart: null, recoverUntil: 0,
      };
    }
    // (the rally was called before word of this guest's shot reached the host, or the host would have it by now)
    const struck = this.struck;
    if (struck && snap.clock >= struck.launch.at && snap.phase !== 'rally' && snap.phase !== 'serve') this.struck = null;
  }

  private learn(launch: Launch) {
    if (this.launches.some((entry) => entry.n === launch.n && entry.at === launch.at)) return;
    this.launches = this.launches.filter((entry) => entry.n !== launch.n);
    const index = this.launches.findIndex((entry) => entry.at > launch.at);
    if (index < 0) this.launches.push(launch);
    else this.launches.splice(index, 0, launch);
    if (this.launches.length > 6) this.launches.shift();
    this.frozenUntil = Math.max(this.frozenUntil, launch.fz);
    // (the host has this guest's shot, or the rally has gone on past it)
    if (this.struck && launch.n >= this.struck.launch.n) this.struck = null;
  }

  /** The flight in play at host time t: the newest launched by then. */
  private launchAt(t: number): Launch | null {
    let best: Launch | null = null;
    for (const launch of this.launches) if (launch.at <= t && (!best || launch.at >= best.at)) best = launch;
    const mine = this.struck?.launch;
    if (mine && mine.at <= t && (!best || mine.at >= best.at)) best = mine;
    return best;
  }

  private direction(): Direction {
    return directionOf('b', { endsSwitched: this.snaps.at(-1)?.e ?? false });
  }

  /** The hit key went down (or a tap ended): a serve when this guest serves, else a swing that waits for the shuttle. What to send. */
  press(intent: Intent, power: number, now: number): Out[] {
    const own = this.own;
    const view = this.view;
    const newest = this.snaps.at(-1);
    if (!own || !view || !newest || this.ownClock === null) return [];
    if (view.phase === 'serve') {
      if (newest.phase !== 'serve' || newest.sv !== 'b' || this.struck) return [];
      const direction = this.direction();
      const at = this.ballTime ?? this.ownClock;
      const start = { x: own.x + direction * 0.45, y: 1.05 };
      const seed = newSeed();
      const plan = planShot(intent === 'power' ? 'high-serve' : 'serve', direction, start, seededRandom(seed), PLAYER_MAX_ACCURACY);
      own.swingStart = this.ownClock;
      own.swingUntil = 0;
      own.intent = 'soft';
      // (a fault has no flight: the host calls it)
      if (!plan.fault) {
        this.struck = { launch: { n: 1, at, fz: at, s: plan.type, p: HALF_SMASH_POWER, f: createFlight(start, plan.velocity, 'b', direction, true) }, w: this.warp, until: now + 2000 };
      }
      const serve: ServeMessage = { t: 'sv', at, x: own.x, intent, seed, w: this.warp };
      return [{ d: serve, fast: true, reliable: true }];
    }
    if (view.phase !== 'rally' || this.ownClock < own.swingStart + PLAYER_SWING_COOLDOWN_MS) return [];
    own.swingStart = this.ownClock;
    own.swingUntil = this.ownClock + PLAYER_SWING_MS;
    own.intent = intent;
    own.power = clamp(power, 0, 1);
    return [];
  }

  /** The hit key held (a smash winding up) or let go. */
  hold(down: boolean) {
    if (!this.own) return;
    this.own.chargeStart = down && this.ownClock !== null ? this.ownClock : null;
  }

  jump() {
    if (this.own) this.own.jumpRequested = true;
  }

  /** One frame at our `now` (ms), with the keys at `input`: the court to draw, what to send, and what was heard. */
  frame(now: number, input: GuestInput): GuestFrame {
    const dt = this.last === null ? 0 : clamp(now - this.last, 0, 250);
    this.last = now;
    const out: Out[] = [];
    const events: GuestEvent[] = [];
    if (!this.watching && now - this.pingAt >= (this.pingCount < 6 ? 250 : 1000)) {
      this.pingAt = now;
      this.pingCount++;
      this.pings.push(now);
      if (this.pings.length > 8) this.pings.shift();
      out.push({ d: { t: 'png', q: now }, fast: true });
    }
    const newest = this.snaps.at(-1);
    if (!newest || !this.modern) return { view: null, out, events };
    const hostNow = this.clock.read(now, dt) ?? newest.clock;
    this.hostNow = hostNow;
    const direction = this.direction();
    if (this.struck && now > this.struck.until) this.struck = null;
    this.steerLag(dt, direction, newest);

    // this guest's own athlete, on the host's steps, meeting the shuttle as it is drawn here
    if (this.ownClock === null || Math.abs(hostNow - this.ownClock) > CLOCK_FAR) {
      this.ownClock = hostNow;
      this.ballTime = null;
    }
    const own = this.own;
    let steps = 0;
    while (this.ownClock + STEP_MS <= hostNow + 1e-6 && steps < MAX_STEPS) {
      this.ownClock += STEP_MS;
      steps++;
      const t = this.advanceBall(this.ownClock - this.ballLag);
      if (!own || this.ownClock < this.frozenUntil) continue;
      this.move = moveOf(input, own.x);
      const charging = own.chargeStart !== null && this.ownClock - own.chargeStart > CHARGE_MIN_MS;
      stepPlayerBody(own, this.move, direction, this.ownClock < own.recoverUntil, charging);
      if (this.ownClock <= own.swingUntil && !this.struck) this.contact(own, t, direction, now, out);
    }
    if (steps >= MAX_STEPS) this.ownClock = hostNow;
    if (own && steps === 0) this.move = moveOf(input, own.x);
    const drawAt = this.advanceBall(Math.max(this.ballTime ?? -Infinity, hostNow - this.ballLag), false);

    // where this guest is, for the host
    if (own) {
      const report: OwnReport = {
        t: 'own', x: round(own.x), vx: round(own.vx), j: round(own.jump), jv: round(own.jumpVelocity), m: this.move,
        cs: own.chargeStart, ss: own.swingStart, in: own.intent, w: this.warp, at: round(this.ownClock, 2),
      };
      if (this.move !== this.sentMove) {
        this.sentMove = this.move;
        this.sentAt = now;
        out.push({ d: report });
      } else if (now - this.sentAt >= REPORT_MS) {
        this.sentAt = now;
        out.push({ d: report, fast: true });
      }
    }

    this.drawnAt = drawAt;
    this.view = this.compose(newest, hostNow, drawAt, dt, events);
    return { view: this.view, out, events };
  }

  /** The shuttle's moment, moved on to t (never back, short of a clock that moved a long way). */
  private advanceBall(t: number, keep = true) {
    const last = this.ballTime;
    const at = last !== null && t < last && last - t < CLOCK_FAR ? last : t;
    if (keep) this.ballTime = at;
    return at;
  }

  /**
   * How far behind the host's clock the shuttle is drawn: nothing while it comes to this guest (so it is played where
   * the host has it), and once it is over the net going to the host, as far behind as the host's athlete is drawn (so
   * word of the host's return comes before the shuttle reaches it), changing a little at a time.
   */
  private steerLag(dt: number, direction: Direction, newest: NetSnapshot) {
    const far = clamp(this.clock.oneWay + 1000 / 30 + 10, 40, 250);
    const flight = this.view?.flight ?? null;
    let target = this.ballLag;
    let rate = 0;
    if (!this.own) {
      target = far;
      rate = 1;
    } else if (!flight || flight.status !== 'flying') {
      target = newest.phase === 'serve' && newest.sv === 'b' ? 0 : far;
      rate = 1;
    } else if (flight.hitter === 'a') {
      target = 0;
      rate = LAG_IN;
    } else if (flight.shuttle.x * direction > 0) {
      target = far;
      rate = LAG_OUT;
    }
    this.ballLag += clamp(target - this.ballLag, -rate * dt, rate * dt);
  }

  /** The swing at the shuttle of the moment t: if it meets it, the return is played here and told to the host. */
  private contact(own: Body, t: number, direction: Direction, now: number, out: Out[]) {
    const launch = this.launchAt(t);
    if (!launch || t < launch.fz) return;
    const flight = this.cursor.at(launch, t);
    if (!flight || flight.status !== 'flying' || flight.hitter !== 'a') return;
    const hit = playerContact(own, flight, direction);
    if (!hit) return;
    own.swingUntil = 0;
    const clock = this.ownClock!;
    const stroke = playerStroke(own, hit.contact, hit.distance, clock, launch.s, flight.elapsed);
    const seed = newSeed();
    const plan = planShot(stroke.type, direction, hit.contact, seededRandom(seed), stroke.accuracy, { power: stroke.power });
    const strong = plan.type === 'smash';
    const fz = strong ? t + smashFreezeMs(smashCharge(stroke.power)) : t;
    const struck: Launch = { n: launch.n + 1, at: t, fz, s: plan.type, p: stroke.power, f: createFlight(hit.contact, plan.velocity, 'b', direction, false, flight.heading) };
    if (strong) {
      own.recoverUntil = t + smashRecoveryMs(stroke.power);
      this.frozenUntil = Math.max(this.frozenUntil, fz);
    }
    this.struck = { launch: struck, w: this.warp, until: now + 2000 };
    const message: HitMessage = {
      t: 'hit', intent: own.intent, power: stroke.power, at: t, n: launch.n, sx: hit.contact.x, sy: hit.contact.y, x: own.x, j: own.jump, el: flight.elapsed, seed,
    };
    out.push({ d: message, fast: true, reliable: true });
  }

  /**
   * The court to draw at the shuttle's moment `drawAt`: the shuttle run on from its launch (between steps, with any
   * jump from a late word faded out), the host's athlete a moment behind between its snapshots, this guest's own athlete
   * as it is here; and the sounds, marks and shake of what the shuttle did, as offline.
   */
  private compose(newest: NetSnapshot, hostNow: number, drawAt: number, dt: number, events: GuestEvent[]): GuestView {
    const clock = this.ownClock ?? hostNow;
    const launch = this.launchAt(drawAt);
    let flight = launch ? this.cursor.at(launch, drawAt) : null;
    const key = keyOf(launch);
    let pos: Point2D | null = null;
    if (launch && flight) {
      pos = { x: flight.shuttle.x, y: flight.shuttle.y };
      // (between steps, unless it is held still or down)
      const part = (drawAt - launch.at) / STEP_MS + 1e-6;
      const fraction = part - Math.floor(part);
      if (flight.status === 'flying' && drawAt >= launch.fz && fraction > 1e-3) {
        const next = stepFlight(flight, FIXED_STEP);
        if (next.status === 'flying') pos = { x: lerp(pos.x, next.shuttle.x, fraction), y: lerp(pos.y, next.shuttle.y, fraction) };
      }
    }
    if (key !== this.shownKey) {
      // a shuttle that was drawn on past its new launch for want of word: the jump fades out instead
      if (launch && pos && this.shownFlying && this.shownPos && launch.at < this.shownAt) {
        const then = flightAt(launch, this.shownAt);
        if (then.status === 'flying') {
          const jump = { x: this.shownPos.x - then.shuttle.x, y: this.shownPos.y - then.shuttle.y };
          if (Math.hypot(jump.x, jump.y) < 6) this.fix = { x: this.fix.x + jump.x, y: this.fix.y + jump.y };
        }
      }
      // (each shot heard once: not again when a return the host turned down gives way to the shot it answered)
      if (launch && !this.heard.has(launch.n)) {
        this.heard.add(launch.n);
        const speed = Math.hypot(launch.f.shuttle.vx, launch.f.shuttle.vy);
        events.push({ kind: 'hit', type: launch.s, speed });
        if (launch.s === 'smash') this.shake = 1.5 + 6.5 * smashCharge(launch.p);
        else if (launch.s === 'drive') this.shake = 1.2;
      }
      this.trail = [];
      this.shownKey = key;
      this.shownFlying = !!flight && flight.status === 'flying';
    } else if (flight && this.shownFlying && flight.status !== 'flying') {
      this.shownFlying = false;
      const cause = flight.status === 'fault' && flight.fault ? flight.fault : 'in';
      events.push({ kind: cause === 'net' ? 'net' : 'land' });
      this.marks.push({ x: flight.shuttle.x, at: drawAt, kind: cause === 'in' ? 'in' : cause === 'net' ? 'net' : 'out' });
    }
    this.shownAt = drawAt;
    this.shownPos = pos;
    const keep = Math.exp(-dt / FIX_TIME);
    this.fix = { x: this.fix.x * keep, y: this.fix.y * keep };
    this.shake = Math.max(0, this.shake - dt * 0.016);
    if (flight && pos) {
      const drawn = { x: pos.x + this.fix.x, y: pos.y + this.fix.y };
      flight = { ...flight, shuttle: { ...flight.shuttle, ...drawn } };
      if (flight.status === 'flying') this.trail = trailPoint(this.trail, drawn);
      else this.trail = [];
    }
    this.marks = this.marks.filter((mark) => drawAt - mark.at < 1000);
    // everything on the own athlete's clock: what happened at the shuttle's moment shows that much later
    const ballShift = clock - drawAt;
    const othersAt = Math.min(drawAt, hostNow - clamp(this.clock.oneWay + 1000 / 30 + 10, 40, 250));
    const othersShift = clock - othersAt;
    const athletes = { a: this.others('a', othersAt, othersShift), b: this.own ? this.ownView(this.own) : this.others('b', othersAt, othersShift) };
    const struck = !!this.struck && launch === this.struck.launch;
    const charge = launch && launch.s === 'smash' ? smashCharge(launch.p) : 0;
    return {
      clock,
      phase: struck ? 'rally' : newest.phase,
      athletes,
      flight,
      trail: flight && flight.status === 'flying' ? this.trail : [],
      marks: this.marks.map((mark) => ({ ...mark, at: mark.at + ballShift })),
      impact: launch ? { x: launch.f.shuttle.x, y: launch.f.shuttle.y, at: launch.at + ballShift, strong: launch.s === 'smash', charge } : null,
      shake: this.shake,
      rallyShots: launch ? launch.n : newest.phase === 'serve' ? 0 : newest.rallyShots,
      lastShot: launch
        ? launch.s === 'smash'
          ? { type: launch.s, speed: Math.hypot(launch.f.shuttle.vx, launch.f.shuttle.vy), power: launch.p }
          : { type: launch.s, speed: Math.hypot(launch.f.shuttle.vx, launch.f.shuttle.vy) }
        : null,
    };
  }

  private ownView(own: Body): ViewAthlete {
    return { x: own.x, vx: own.vx, jump: own.jump, jumpVelocity: own.jumpVelocity, swingStart: own.swingStart, intent: own.intent, chargeStart: own.chargeStart };
  }

  /** An athlete the host moves, at host time t, between its snapshots (or carried on a little past the newest), shifted onto the drawing clock. */
  private others(side: Side, t: number, shift: number): ViewAthlete {
    let older = this.snaps[0]!;
    let newer = older;
    for (const snap of this.snaps) {
      newer = snap;
      if (snap.clock > t) break;
      older = snap;
    }
    const a = older[side];
    const b = newer[side];
    const span = newer.clock - older.clock;
    const u = span > 0 ? clamp((t - older.clock) / span, 0, 1) : 0;
    const ahead = newer === older ? clamp(t - newer.clock, 0, 100) / 1000 : 0;
    const jump = Math.max(0, lerp(a.jump, b.jump, u) + (b.jump > 0 ? b.jumpVelocity * ahead - PLAYER_GRAVITY * ahead * ahead / 2 : 0));
    return {
      x: lerp(a.x, b.x, u) + b.vx * ahead,
      vx: b.vx,
      jump,
      jumpVelocity: b.jumpVelocity,
      swingStart: b.swingStart + shift,
      intent: b.intent,
      chargeStart: typeof b.cs === 'number' ? b.cs + shift : null,
    };
  }
}

/** The host's copy of the guest's athlete, as HostNet moves it. */
export type HostBody = {
  x: number;
  vx: number;
  jump: number;
  jumpVelocity: number;
  jumpRequested: boolean;
  recoverUntil: number;
  swingStart: number;
  intent: Intent;
  chargeStart: number | null;
};
/** A guest's return the host takes: the stroke to play from `contact` at host time `at`, with the guest's scatter. */
export type HitTake = { at: number; contact: Point2D; type: ShotType; accuracy: number; power: number; intent: Intent; random: () => number };
export type ServeTake = { at: number; x: number; intent: Intent; random: () => number };

/**
 * The host's side: the guest's own moves, returns and serves taken (and checked) as they come, the shuttle's recent path
 * to check them against, and how long to wait on the guest before calling a shuttle down on its side.
 */
export class HostNet {
  /** The guest moves itself and plays its own shots (it has said where it is). */
  modern = false;
  private heard = -Infinity;
  private took: number | null = null;
  private lags: { clock: number; lag: number }[] = [];
  /** The shuttle after each step lately: host clock, the shot it was, the flight. */
  private trail: { clock: number; n: number; flight: FlightState }[] = [];

  /** After each step: the shuttle as it is now, to check the guest's returns against the moment it saw. */
  record(clock: number, n: number, flight: FlightState | null) {
    const last = this.trail.at(-1);
    if (last && last.clock >= clock) this.trail.pop();
    if (flight) this.trail.push({ clock, n, flight });
    while (this.trail.length > 2 && this.trail[0]!.clock < clock - REWIND_MAX - 100) this.trail.shift();
  }

  private lag(clock: number, at: number) {
    this.lags.push({ clock, lag: Math.max(0, clock - at) });
    if (this.lags.length > 120) this.lags.shift();
  }

  /** How long (ms) a shuttle down on the guest's side waits for its return: the longest its word took lately, padded and capped. */
  grace(clock: number) {
    if (!this.modern) return 0;
    let late = 0;
    let any = false;
    for (const sample of this.lags) {
      if (sample.clock < clock - 3000) continue;
      late = Math.max(late, sample.lag);
      any = true;
    }
    return clamp((any ? late : 120) + GRACE_PAD, 50, REWIND_MAX);
  }

  /**
   * The guest's word on where its own athlete is: taken unless the players have been put in place since (warp) or it is
   * older than the last, carried on to the host's moment the way the athlete runs, and held to what it could have run.
   */
  own(body: HostBody, report: OwnReport, clock: number, warp: number, direction: Direction): boolean {
    if (report.w !== warp || report.at <= this.heard) return false;
    this.heard = report.at;
    this.modern = true;
    this.lag(clock, report.at);
    const moved = { x: report.x, vx: report.vx, jump: report.j, jumpVelocity: report.jv, jumpRequested: false, recoverUntil: body.recoverUntil };
    const until = report.at + clamp(clock - report.at, 0, CARRY_MAX) + 1e-6;
    for (let t = report.at + STEP_MS; t <= until; t += STEP_MS) {
      stepPlayerBody(moved, report.m, direction, t < body.recoverUntil, report.cs !== null && t - report.cs > CHARGE_MIN_MS);
    }
    const since = this.took === null ? 1000 : clamp(clock - this.took, 0, 1000);
    this.took = clock;
    const dx = moved.x - body.x;
    const reach = PLAYER_RUN_SPEED * since / 1000 + 0.6;
    body.x = clampToHalf(Math.abs(dx) > reach ? body.x + Math.sign(dx) * reach : moved.x, direction);
    body.vx = moved.vx;
    body.jump = clamp(moved.jump, 0, MAX_JUMP);
    body.jumpVelocity = moved.jumpVelocity;
    body.chargeStart = report.cs;
    if (report.ss > body.swingStart) {
      body.swingStart = report.ss;
      body.intent = report.in;
    }
    return true;
  }

  /** Where the host had shot n's shuttle at host time t, if it was in the air then. */
  private shuttleThen(t: number, n: number): { x: number; y: number; elapsed: number } | null {
    let index = -1;
    for (let i = 0; i < this.trail.length; i++) {
      if (this.trail[i]!.clock > t + 1e-6) break;
      index = i;
    }
    const then = this.trail[index];
    if (!then || then.n !== n || then.flight.status !== 'flying') return null;
    const next = this.trail[index + 1];
    const { x, y } = then.flight.shuttle;
    if (!next || next.n !== n || next.flight.status !== 'flying' || next.clock <= then.clock) return { x, y, elapsed: then.flight.elapsed };
    const u = clamp((t - then.clock) / (next.clock - then.clock), 0, 1);
    return { x: lerp(x, next.flight.shuttle.x, u), y: lerp(y, next.flight.shuttle.y, u), elapsed: then.flight.elapsed };
  }

  /**
   * A guest's return: taken if the shot it hit is still the one in play (in the air or down and waiting on this word),
   * was in the air where the guest met it at that moment, and in reach of an athlete about where the host has it. The
   * stroke is worked out from the guest's contact the way the guest did, so it plays the same shot.
   */
  hit(message: HitMessage, context: { clock: number; phase: NetPhase; n: number; flight: FlightState | null; incoming: ShotType | null; body: HostBody; direction: Direction }): HitTake | null {
    const { at, n, sx, sy, x, j, el, seed } = message;
    if (at === undefined || n === undefined || sx === undefined || sy === undefined || x === undefined || j === undefined || el === undefined || seed === undefined) return null;
    const { clock, direction } = context;
    this.lag(clock, at);
    const age = clock - at;
    if (age > REWIND_MAX || age < -50) return null;
    if (context.phase !== 'rally' || !context.flight || context.flight.hitter !== 'a' || context.n !== n) return null;
    const then = this.shuttleThen(at, n);
    if (!then || Math.hypot(then.x - sx, then.y - sy) > BALL_SLACK || sx * direction > 0.12) return null;
    if (Math.abs(x - context.body.x) > PLAYER_RUN_SPEED * Math.max(0, age) / 1000 + PLAYER_SLACK || j > MAX_JUMP) return null;
    const contact = { x: sx, y: sy };
    const racket = racketPoint(x, j, direction);
    const distance = Math.hypot(contact.x - racket.x, contact.y - racket.y);
    if (distance > RACKET_REACH + 1e-9) return null;
    const intent = message.intent ?? 'normal';
    const flightSeconds = clamp(el, then.elapsed - 0.05, then.elapsed + 0.05);
    const stroke = playerStroke({ chargeStart: null, power: clamp(message.power ?? HALF_SMASH_POWER, 0, 1), intent }, contact, distance, at, context.incoming, flightSeconds);
    return { at, contact, type: stroke.type, accuracy: stroke.accuracy, power: stroke.power, intent, random: seededRandom(seed) };
  }

  /** A guest's serve: taken in its own serve of this placing, from where it says it stood (held near the host's copy), as long ago as it says (up to REWIND_MAX). */
  serve(message: ServeMessage, context: { clock: number; phase: NetPhase; server: Side; warp: number; body: HostBody; direction: Direction }): ServeTake | null {
    if (context.phase !== 'serve' || context.server !== 'b' || message.w !== context.warp) return null;
    this.lag(context.clock, message.at);
    const at = clamp(message.at, context.clock - REWIND_MAX, context.clock);
    const slack = PLAYER_RUN_SPEED * (context.clock - at) / 1000 + PLAYER_SLACK;
    const x = clampToHalf(context.body.x + clamp(message.x - context.body.x, -slack, slack), context.direction);
    return { at, x, intent: message.intent, random: seededRandom(message.seed) };
  }
}

/** The court as an older host's guest keeps it: the fields the old way reads and writes. */
export type LegacyCourt = {
  clock: number;
  phase: NetPhase;
  athletes: Record<Side, { x: number; vx: number; jump: number; jumpVelocity: number; swingStart: number; intent: Intent }>;
  flight: FlightState | null;
  trail: Point2D[];
  marks: LandingMark[];
  impact: Impact | null;
  shake: number;
  rallyShots: number;
  lastShot: { type: ShotType; speed: number; power?: number } | null;
};

/** Playing an older host, the old way: its latest court as it arrives, then the shuttle and players carried on until the next. */
export class LegacyGuest {
  private pending: NetSnapshot | null = null;
  private newest = -Infinity;
  private accumulator = 0;

  receive(snap: NetSnapshot) {
    if (snap.clock < this.newest) return;
    this.newest = snap.clock;
    this.pending = snap;
  }

  /** One frame of `dt` seconds on `court`, with each side's end of the court as `directions`. What was heard. */
  step(court: LegacyCourt, dt: number, directions: Record<Side, Direction>): GuestEvent[] {
    const events: GuestEvent[] = [];
    const snap = this.pending;
    if (snap) {
      this.pending = null;
      if (snap.impact && snap.impact.at !== court.impact?.at && snap.lastShot) events.push({ kind: 'hit', type: snap.lastShot.type, speed: snap.lastShot.speed });
      const mark = snap.marks[snap.marks.length - 1];
      if (mark && mark.at !== court.marks[court.marks.length - 1]?.at) events.push({ kind: mark.kind === 'net' ? 'net' : 'land' });
      court.clock = snap.clock;
      court.phase = snap.phase;
      for (const side of ['a', 'b'] as Side[]) {
        const athlete = court.athletes[side];
        const from = snap[side];
        athlete.x = from.x;
        athlete.vx = from.vx;
        athlete.jump = from.jump;
        athlete.jumpVelocity = from.jumpVelocity;
        athlete.swingStart = from.swingStart;
        athlete.intent = from.intent;
      }
      court.flight = snap.flight;
      court.marks = snap.marks;
      court.impact = snap.impact;
      court.shake = snap.shake;
      court.rallyShots = snap.rallyShots;
      court.lastShot = snap.lastShot;
      if (!court.flight || court.flight.status !== 'flying') court.trail = [];
      else court.trail = trailPoint(court.trail, court.flight.shuttle);
      return events;
    }
    this.accumulator += dt;
    while (this.accumulator >= PLAYER_STEP) {
      this.accumulator -= PLAYER_STEP;
      court.clock += STEP_MS;
      for (const side of ['a', 'b'] as Side[]) {
        const athlete = court.athletes[side];
        athlete.x = clampToHalf(athlete.x + athlete.vx * PLAYER_STEP, directions[side]);
        if (athlete.jumpVelocity !== 0 || athlete.jump > 0) {
          athlete.jumpVelocity -= PLAYER_GRAVITY * PLAYER_STEP;
          athlete.jump = Math.max(0, athlete.jump + athlete.jumpVelocity * PLAYER_STEP);
          if (athlete.jump === 0 && athlete.jumpVelocity < 0) athlete.jumpVelocity = 0;
        }
      }
      if (court.flight && court.flight.status === 'flying') {
        court.flight = stepFlight(court.flight, PLAYER_STEP);
        court.trail = trailPoint(court.trail, court.flight.shuttle);
      }
    }
    court.shake = Math.max(0, court.shake - dt * 16);
    return events;
  }
}
