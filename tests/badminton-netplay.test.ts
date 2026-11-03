// Badminton online: a host and a guest in one process, over a link with latency and jitter (the fast channel unordered,
// the reliable one in order). The host runs the match the way Badminton.tsx does for two people (Host below follows
// its simulate, strike, launchServe and message handling), the guest runs badminton-netplay.ts the way the page does.
// Both players are scripted, and the guest's only sees what its own screen shows. Measured the old way (an older host
// and guest: snapshots applied as they arrive, keys and swings played on the host when they get there) and the new way.
// `BADMINTON_NET_REPORT=1 node --test tests/badminton-netplay.test.ts` prints the numbers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  awardPoint, chooseShot, createFlight, directionOf, FIXED_STEP, HALF_SMASH_POWER, newMatch, opposite, planShot, PLAYER_MAX_ACCURACY, smashCharge,
  smashRecoveryMs, startNextGame, stepFlight, takeInterval, type Direction, type FlightState, type Intent, type MatchState, type ShotOptions, type ShotType,
  type Side, type Point2D,
} from '../src/os/games/badminton.ts';
import {
  CHARGE_MIN_MS, clampToHalf, PLAYER_SWING_COOLDOWN_MS, PLAYER_SWING_MS, playerContact, playerStroke, RACKET_REACH, racketPoint, stepPlayerBody,
} from '../src/os/games/badminton-cpu.ts';
import { NET_VERSION, parseGuestMessage, parsePong, parseSnapshot, type GuestMessage, type HitMessage, type Launch, type NetPhase, type NetSnapshot, type ServeMessage } from '../src/os/apps/badminton-net.ts';
import {
  flightAt, GuestNet, HostNet, launchSteps, LegacyGuest, moveOf, REWIND_MAX, seededRandom, smashFreezeMs, STEP_MS,
  type Body, type GuestInput, type LegacyCourt, type ServeTake,
} from '../src/os/apps/badminton-netplay.ts';

const report = !!process.env.BADMINTON_NET_REPORT;
const REMOTE_SWING_MS = 90;
const SNAPSHOT_MS = 33;

function rng(seed: number) {
  return seededRandom(seed * 7919 + 13);
}

/** Each way: `oneWay` ms plus up to `jitter` more. The reliable channel keeps order (a message waits for the one before it). */
type LinkSpec = { oneWay: number; jitter: number };
type Wire = { at: number; n: number; to: 'host' | 'guest'; d: unknown };

class Link {
  private queue: Wire[] = [];
  private n = 0;
  private ordered = new Map<string, number>();
  private readonly rand: () => number;
  private readonly spec: LinkSpec;
  constructor(spec: LinkSpec, seed: number) {
    this.spec = spec;
    this.rand = rng(seed);
  }
  send(now: number, to: 'host' | 'guest', d: unknown, fast: boolean) {
    let at = now + this.spec.oneWay + this.rand() * this.spec.jitter;
    if (!fast) {
      at = Math.max(at, this.ordered.get(to) ?? 0);
      this.ordered.set(to, at);
    }
    // (on the wire it is JSON)
    this.queue.push({ at, n: this.n++, to, d: JSON.parse(JSON.stringify(d)) });
  }
  due(now: number) {
    const ready = this.queue.filter((wire) => wire.at <= now).sort((a, b) => a.at - b.at || a.n - b.n);
    this.queue = this.queue.filter((wire) => wire.at > now);
    return ready;
  }
}

const newBody = (): Body => ({
  x: 0, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, swingStart: -1e9, swingUntil: 0, intent: 'normal', power: HALF_SMASH_POWER, chargeStart: null, recoverUntil: 0,
});
const still = (): GuestInput => ({ left: false, right: false, seekX: null });

type HostHit = { side: Side; warp: number; n: number; accuracy: number; type: ShotType; requested: ShotType; contact: Point2D; at: number };

/** The match as Badminton.tsx runs it on an online host, for two people (no computer, no pause, no interval cards). */
class Host {
  clock = 0;
  phase: NetPhase = 'serve';
  phaseUntil = 0;
  freezeUntil = 0;
  athletes: Record<Side, Body> = { a: newBody(), b: newBody() };
  controls: Record<Side, GuestInput> = { a: still(), b: still() };
  flight: FlightState | null = null;
  launch: Launch | null = null;
  heldAt: number | null = null;
  warp = 0;
  rallyShots = 0;
  rallyStart = 0;
  lastShot: { type: ShotType; speed: number; power?: number } | null = null;
  match: MatchState;
  net = new HostNet();
  stepping = false;
  hits: HostHit[] = [];
  /** How long ago (ms, host clock) each guest return it took was played. */
  ages: number[] = [];
  points = 0;
  phaseAt = 0;
  /** The shuttle after each step (for how far the guest's drawing is from it). */
  path: { clock: number; n: number; x: number; y: number; flying: boolean }[] = [];
  private accumulator = 0;
  private last: number | null = null;
  frameAt = 0;
  private readonly rand: () => number;
  readonly legacy: boolean;
  constructor(legacy: boolean, server: Side, seed: number) {
    this.legacy = legacy;
    this.rand = rng(seed);
    this.match = { ...newMatch('match'), server };
    this.beginServe();
  }
  dir(side: Side): Direction {
    return directionOf(side, this.match);
  }
  beginServe() {
    this.phase = 'serve';
    this.phaseAt = this.clock;
    this.flight = null;
    this.launch = null;
    this.heldAt = null;
    this.lastShot = null;
    this.rallyShots = 0;
    for (const side of ['a', 'b'] as Side[]) {
      const body = this.athletes[side];
      body.x = -this.dir(side) * (this.match.server === side ? 2.9 : 3.6);
      Object.assign(body, { vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, swingUntil: 0, chargeStart: null, recoverUntil: 0 });
      this.controls[side].seekX = null;
    }
    this.warp += 1;
  }
  finish(winner: Side) {
    this.match = awardPoint(this.match, winner);
    this.points++;
    this.phase = 'point';
    this.phaseUntil = this.clock + 1500;
  }
  advance() {
    if (this.phase !== 'point' || this.clock < this.phaseUntil) return;
    if (this.match.matchWinner) this.match = { ...newMatch('match'), server: this.match.matchWinner };
    else if (this.match.gameWinner) this.match = startNextGame(this.match);
    else if (this.match.intervalDue) this.match = takeInterval(this.match);
    this.beginServe();
  }
  swing(side: Side, intent: Intent, power = HALF_SMASH_POWER) {
    const body = this.athletes[side];
    if (this.phase === 'serve') {
      if (this.match.server === side) this.launchServe(side, intent);
      return;
    }
    if (this.phase !== 'rally' || this.clock < body.swingStart + PLAYER_SWING_COOLDOWN_MS) return;
    body.swingStart = this.clock;
    body.swingUntil = this.clock + PLAYER_SWING_MS + (side === 'b' ? REMOTE_SWING_MS : 0);
    body.intent = intent;
    body.power = power;
  }
  launchServe(side: Side, intent: Intent, from?: ServeTake) {
    const direction = this.dir(side);
    const body = this.athletes[side];
    const at = from ? from.at : this.clock;
    const start = { x: (from ? from.x : body.x) + direction * 0.45, y: 1.05 };
    const plan = planShot(intent === 'power' ? 'high-serve' : 'serve', direction, start, from ? from.random : this.rand, PLAYER_MAX_ACCURACY);
    body.swingStart = at;
    body.swingUntil = 0;
    body.intent = 'soft';
    if (plan.fault) {
      this.finish(opposite(side));
      return;
    }
    this.flight = createFlight(start, plan.velocity, side, direction, true);
    const launchAt = from || this.stepping ? at : at + STEP_MS;
    this.launch = { n: 1, at: launchAt, fz: launchAt, s: plan.type, p: HALF_SMASH_POWER, f: this.flight };
    this.phase = 'rally';
    this.rallyStart = at;
    this.rallyShots = 1;
    this.lastShot = { type: plan.type, speed: Math.hypot(plan.velocity.vx, plan.velocity.vy) };
  }
  strike(side: Side, type: ShotType, contact: Point2D, accuracy: number, options: ShotOptions, at = this.clock, random = this.rand) {
    const direction = this.dir(side);
    const plan = planShot(type, direction, contact, random, accuracy, options);
    const power = options.power ?? HALF_SMASH_POWER;
    const heading = this.flight ? this.flight.heading : 0;
    this.flight = createFlight(contact, plan.velocity, side, direction, false, heading);
    this.rallyShots += 1;
    const speed = Math.hypot(plan.velocity.vx, plan.velocity.vy);
    this.lastShot = plan.type === 'smash' ? { type: plan.type, speed, power } : { type: plan.type, speed };
    const strong = plan.type === 'smash';
    if (strong) {
      this.freezeUntil = at + smashFreezeMs(smashCharge(power));
      this.athletes[side].recoverUntil = at + smashRecoveryMs(power);
    }
    this.launch = { n: this.rallyShots, at, fz: strong ? this.freezeUntil : at, s: plan.type, p: power, f: this.flight };
    this.hits.push({ side, warp: this.warp, n: this.rallyShots - 1, accuracy, type: plan.type, requested: type, contact: { ...contact }, at });
  }
  private tryContacts() {
    const flight = this.flight!;
    const side = opposite(flight.hitter);
    const body = this.athletes[side];
    const hit = playerContact(body, flight, this.dir(side));
    if (!hit) return;
    if (side === 'b' && this.net.modern) return;
    if (this.clock > body.swingUntil) return;
    body.swingUntil = 0;
    const stroke = playerStroke(body, hit.contact, hit.distance, this.clock, this.lastShot?.type ?? null, flight.elapsed);
    this.strike(side, stroke.type, hit.contact, stroke.accuracy, { power: stroke.power });
  }
  private settle() {
    const flight = this.flight;
    if (!flight || flight.status === 'flying') return;
    const wait = flight.hitter === 'a' ? this.net.grace(this.clock) : 0;
    if (wait > 0) {
      this.heldAt ??= this.clock;
      if (this.clock < this.heldAt + wait) return;
    }
    this.heldAt = null;
    this.finish(flight.status === 'fault' ? opposite(flight.hitter) : flight.hitter);
  }
  private step() {
    this.clock += STEP_MS;
    if (this.clock < this.freezeUntil) return;
    for (const side of ['a', 'b'] as Side[]) {
      const body = this.athletes[side];
      const charging = body.chargeStart !== null && this.clock - body.chargeStart > CHARGE_MIN_MS;
      stepPlayerBody(body, moveOf(this.controls[side], body.x), this.dir(side), this.clock < body.recoverUntil, charging);
    }
    if (this.phase === 'rally' && this.flight && this.flight.status === 'flying') {
      this.tryContacts();
      if (this.flight.status === 'flying') {
        this.flight = stepFlight(this.flight, FIXED_STEP);
        this.settle();
      }
    } else if (this.phase === 'rally' && this.flight) this.settle();
  }
  /** One frame at wall time `now` (ms), catching up a slow one. */
  frame(now: number) {
    const dt = this.last === null ? 0 : Math.min(250, now - this.last);
    this.last = now;
    this.accumulator += dt;
    this.stepping = true;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.step();
      this.net.record(this.clock, this.rallyShots, this.flight);
      this.path.push({ clock: this.clock, n: this.rallyShots, x: this.flight?.shuttle.x ?? 0, y: this.flight?.shuttle.y ?? 0, flying: this.flight?.status === 'flying' });
    }
    if (this.path.length > 1200) this.path.splice(0, this.path.length - 1200);
    this.stepping = false;
    this.frameAt = now;
    this.advance();
  }
  snapshot(): NetSnapshot {
    const athlete = (body: Body) => ({ x: body.x, vx: body.vx, jump: body.jump, jumpVelocity: body.jumpVelocity, swingStart: body.swingStart, intent: body.intent, cs: body.chargeStart });
    const snap: NetSnapshot = {
      t: 's', clock: this.clock, phase: this.phase, a: athlete(this.athletes.a), b: athlete(this.athletes.b), flight: this.flight, marks: [], impact: null, shake: 0,
      rallyShots: this.rallyShots, lastShot: this.lastShot, v: NET_VERSION, w: this.warp, e: this.match.endsSwitched, sv: this.match.server, l: this.flight ? this.launch : null,
    };
    if (this.legacy) {
      // (what an older host sent)
      for (const key of ['v', 'w', 'e', 'sv', 'l'] as const) delete snap[key];
      delete snap.a.cs;
      delete snap.b.cs;
    }
    return snap;
  }
  /** A message from the guest, as the page's onMessage takes it. Returns an answer for the guest, if any. */
  receive(message: GuestMessage, now: number): GuestMessage | null {
    const b = this.athletes.b;
    if (message.t === 'png') return { t: 'png', q: message.q, c: this.clock + Math.max(0, Math.min(100, now - this.frameAt)) };
    if (message.t === 'go') return null;
    if (message.t === 'own') {
      if (this.net.own(b, message, this.clock, this.warp, this.dir('b'))) this.controls.b = { left: message.m < 0, right: message.m > 0, seekX: null };
    } else if (message.t === 'hit' && message.at !== undefined) this.takeHit(message);
    else if (message.t === 'sv') this.takeServe(message);
    else if (this.net.modern) return null;
    else if (message.t === 'in') this.controls.b = { left: message.c.left, right: message.c.right, seekX: this.controls.b.seekX };
    else if (message.t === 'jump') b.jumpRequested = true;
    else if (message.t === 'seek') this.controls.b.seekX = message.x;
    else if (message.t === 'hit') this.swing('b', message.intent ?? 'normal', message.power);
    return null;
  }
  private takeHit(message: HitMessage) {
    const b = this.athletes.b;
    const take = this.net.hit(message, { clock: this.clock, phase: this.phase, n: this.rallyShots, flight: this.flight, incoming: this.lastShot?.type ?? null, body: b, direction: this.dir('b') });
    if (!take) return;
    b.swingUntil = 0;
    b.intent = take.intent;
    this.heldAt = null;
    this.ages.push(this.clock - take.at);
    this.strike('b', take.type, take.contact, take.accuracy, { power: take.power }, take.at, take.random);
    this.flight = flightAt(this.launch!, this.clock);
    this.net.record(this.clock, this.rallyShots, this.flight);
  }
  private takeServe(message: ServeMessage) {
    const take = this.net.serve(message, { clock: this.clock, phase: this.phase, server: this.match.server, warp: this.warp, body: this.athletes.b, direction: this.dir('b') });
    if (!take) return;
    this.launchServe('b', take.intent, take);
    if (this.flight && this.launch) this.flight = flightAt(this.launch, this.clock);
    this.net.record(this.clock, this.rallyShots, this.flight);
  }
  /** Where the host had the shuttle at host time t. */
  shuttleAt(t: number) {
    let found: Host['path'][number] | null = null;
    for (const entry of this.path) {
      if (entry.clock > t + 1e-6) break;
      found = entry;
    }
    return found;
  }
}

type BotView = { phase: NetPhase; me: { x: number; vx: number; jump: number }; flight: FlightState | null; shot: number };
type Decision = { input: GuestInput; press: Intent | null; expect: { type: ShotType; at: Point2D } | null };

/**
 * A player who only knows what its screen shows: runs to meet the shuttle, and swings at the moment it comes closest to
 * the racket (to the frame, as a good player would), so the contact is as clean as the screen allows. Serves after a beat.
 */
class Bot {
  private readonly side: Side;
  private readonly rand: () => number;
  private incoming = -1;
  private reactAt = 0;
  private pressed = false;
  private servePhase = false;
  private serveAt = 0;
  private intent: Intent = 'normal';
  /** How far ahead of the closest approach it swings (ms): a player who has learned how late its swings land. */
  private readonly lead: number;
  constructor(side: Side, seed: number, lead = 0) {
    this.side = side;
    this.rand = rng(seed);
    this.lead = lead;
  }
  decide(view: BotView | null, now: number, server: Side, direction: Direction, serves = true): Decision {
    const nothing: Decision = { input: still(), press: null, expect: null };
    if (!view) return nothing;
    const me = view.me;
    if (view.phase === 'serve') {
      if (!this.servePhase) {
        this.servePhase = true;
        this.serveAt = now + 500 + this.rand() * 300;
        // (a new rally: its shots count from 1 again)
        this.incoming = -1;
      }
      if (serves && server === this.side && now >= this.serveAt) {
        this.serveAt = Infinity;
        return { input: still(), press: this.rand() < 0.3 ? 'power' : 'normal', expect: null };
      }
      return nothing;
    }
    this.servePhase = false;
    const flight = view.flight;
    if (flight && flight.status === 'flying' && flight.hitter !== this.side) {
      if (this.incoming !== view.shot) {
        this.incoming = view.shot;
        this.reactAt = now + 140 + this.rand() * 80;
        // (now and then it lets one go, so points end)
        this.pressed = this.rand() < 0.06;
        this.intent = this.rand() < 0.25 ? 'soft' : this.rand() < 0.2 ? 'power' : 'normal';
      }
      if (now < this.reactAt) return nothing;
      // where to stand: the racket where the shuttle first comes down to 1.6 m on this side
      let preview = flight;
      let target: number | null = null;
      for (let t = 0; t < 2.5 && preview.status === 'flying'; t += FIXED_STEP) {
        const { x, y } = preview.shuttle;
        if (x * direction < 0 && y <= 1.6) {
          target = clampToHalf(x - direction * 0.5, direction);
          break;
        }
        preview = stepFlight(preview, FIXED_STEP);
      }
      const input: GuestInput = { left: false, right: false, seekX: target };
      // the swing: when the shuttle is (lead ms from) as close to the racket as it will come
      if (!this.pressed) {
        const racket = racketPoint(me.x, me.jump, direction);
        const gap = (f: FlightState) => Math.hypot(f.shuttle.x - racket.x, f.shuttle.y - racket.y);
        let then = flight;
        for (let t = 0; t < this.lead && then.status === 'flying'; t += STEP_MS) then = stepFlight(then, FIXED_STEP);
        const close = gap(then);
        let next = then;
        for (let i = 0; i < 2; i++) next = stepFlight(next, FIXED_STEP);
        if (then.status === 'flying' && then.shuttle.x * direction <= 0.12 && close < RACKET_REACH * 0.85 && gap(next) >= close) {
          this.pressed = true;
          return { input, press: this.intent, expect: { type: chooseShot(this.intent, then.shuttle), at: { x: then.shuttle.x, y: then.shuttle.y } } };
        }
      }
      return { input, press: null, expect: null };
    }
    return { input: { left: false, right: false, seekX: clampToHalf(-direction * 3.1, direction) }, press: null, expect: null };
  }
}

type Sample = { now: number; shown: number; host: number; move: number };
type BallSample = { shot: number; p: Point2D; v: Point2D; live: boolean; error: number | null; behind: number | null };

type SimOptions = {
  /** Play the old way: an older host (no v in its snapshots) and an older guest (keys and swings). */
  legacy: boolean;
  link: LinkSpec;
  seconds: number;
  /** A fixed move for the guest instead of the scripted player, as [from s, to s, -1 | 1] spans, with nobody serving. */
  moves?: [number, number, -1 | 1][];
  seed?: number;
  /** The guest swings this long (ms) before the shuttle comes closest, as it sees it. */
  lead?: number;
};

/** One run: the host's match, the guest's netplay (or the old guest), frames at 60 Hz, snapshots at 30 Hz. */
function simulate(options: SimOptions) {
  // (the guest picks its scatter seeds with Math.random: seeded here, so every run plays the same match)
  const random = Math.random;
  Math.random = rng((options.seed ?? 3) + 99);
  try {
    return run(options);
  } finally {
    Math.random = random;
  }
}

function run(options: SimOptions) {
  const seed = options.seed ?? 3;
  const host = new Host(options.legacy, 'a', seed);
  const link = new Link(options.link, seed * 7 + 1);
  const hostBot = new Bot('a', 21);
  const guestBot = new Bot('b', 11, options.lead ?? 0);
  const net = new GuestNet();
  const old = new LegacyGuest();
  const court: LegacyCourt = {
    clock: 0, phase: 'serve', athletes: { a: { ...newBody() }, b: { ...newBody() } }, flight: null, trail: [], marks: [], impact: null, shake: 0, rallyShots: 0, lastShot: null,
  };
  let oldControls = { left: false, right: false, jump: false, soft: false };
  let oldSeek: number | null = null;
  const samples: Sample[] = [];
  const balls: BallSample[] = [];
  const presses = new Map<string, { type: ShotType; at: Point2D } | null>();
  let pressCount = 0;
  let strikes = 0;
  let lastSent = -Infinity;
  let sentLaunch: Launch | null = null;
  const toGuest = (now: number, d: unknown, fast: boolean) => link.send(now, 'guest', d, fast);
  const toHost = (now: number, d: GuestMessage, fast: boolean, reliable = false) => {
    if (d.t === 'hit' && d.at !== undefined) strikes++;
    if (fast) link.send(now, 'host', d, true);
    if (!fast || reliable) link.send(now, 'host', d, false);
  };
  const end = options.seconds * 1000;
  const frameMs = 1000 / 60;
  let hostFrame = 0;
  let guestFrame = 0;
  let guestLast: number | null = null;
  for (let now = 0; now <= end; now++) {
    for (const wire of link.due(now)) {
      if (wire.to === 'host') {
        const message = parseGuestMessage(wire.d);
        assert.ok(message, `a guest message failed to parse: ${JSON.stringify(wire.d).slice(0, 200)}`);
        const answer = host.receive(message, now);
        if (answer) toGuest(now, answer, true);
      } else {
        const snap = parseSnapshot(wire.d);
        if (snap) {
          net.receive(snap, now);
          old.receive(snap);
          continue;
        }
        const pong = parsePong(wire.d);
        assert.ok(pong, 'a host message failed to parse');
        net.pong(pong.q, pong.c, now);
      }
    }
    if (now >= hostFrame * frameMs) {
      hostFrame++;
      const decision = options.moves ? null : hostBot.decide({ phase: host.phase, me: host.athletes.a, flight: host.flight, shot: host.rallyShots }, now, host.match.server, host.dir('a'));
      if (decision) {
        host.controls.a = decision.input;
        if (decision.press) host.swing('a', decision.press);
      }
      host.frame(now);
      const fresh = !options.legacy && host.launch !== sentLaunch;
      if (host.clock - lastSent >= SNAPSHOT_MS || fresh) {
        lastSent = host.clock;
        sentLaunch = host.launch;
        toGuest(now, host.snapshot(), true);
      }
    }
    if (now >= guestFrame * frameMs + 7) {
      guestFrame++;
      const dt = guestLast === null ? 0 : Math.min(50, now - guestLast);
      guestLast = now;
      const direction = host.dir('b');
      let move: -1 | 0 | 1 = 0;
      let decision: Decision = { input: still(), press: null, expect: null };
      const seen: BotView | null = options.legacy
        ? { phase: court.phase, me: court.athletes.b, flight: court.flight, shot: court.rallyShots }
        : net.view && { phase: net.view.phase, me: net.view.athletes.b, flight: net.view.flight, shot: net.view.rallyShots };
      if (options.moves) {
        const span = options.moves.find(([from, to]) => now >= from * 1000 && now < to * 1000);
        move = span ? span[2] : 0;
        decision = { input: { left: move < 0, right: move > 0, seekX: null }, press: null, expect: null };
      } else decision = guestBot.decide(seen, now, host.match.server, direction);
      if (decision.press && seen) {
        if (seen.phase === 'rally') {
          pressCount++;
          presses.set(`${host.warp}:${seen.shot}`, decision.expect);
        }
        if (options.legacy) toHost(now, { t: 'hit', intent: decision.press, power: HALF_SMASH_POWER }, false);
        else for (const out of net.press(decision.press, HALF_SMASH_POWER, now)) toHost(now, out.d, !!out.fast, !!out.reliable);
      }
      let shown: number;
      let ball: { flight: FlightState | null; shot: number; at: number | null };
      if (options.legacy) {
        // (the old guest: its keys when they change, and its drag)
        const keys = { left: decision.input.left, right: decision.input.right, jump: false, soft: false };
        if (keys.left !== oldControls.left || keys.right !== oldControls.right) {
          oldControls = keys;
          toHost(now, { t: 'in', c: keys }, false);
        }
        const seek = decision.input.seekX;
        if (seek !== oldSeek && (seek === null || oldSeek === null || Math.abs(seek - oldSeek) > 0.04)) {
          oldSeek = seek;
          toHost(now, { t: 'seek', x: seek }, false);
        }
        old.step(court, dt / 1000, { a: host.dir('a'), b: direction });
        shown = court.athletes.b.x;
        ball = { flight: court.flight, shot: court.rallyShots, at: court.clock };
      } else {
        const frame = net.frame(now, decision.input);
        for (const out of frame.out) toHost(now, out.d, !!out.fast, !!out.reliable);
        shown = frame.view ? frame.view.athletes.b.x : host.athletes.b.x;
        ball = { flight: frame.view?.flight ?? null, shot: frame.view?.rallyShots ?? 0, at: net.drawnAt };
      }
      samples.push({ now, shown, host: host.athletes.b.x, move });
      if (ball.flight) {
        const real = ball.at === null ? null : host.shuttleAt(ball.at);
        const live = ball.flight.status === 'flying';
        const error = real && real.flying && live && real.n === ball.shot ? Math.hypot(real.x - ball.flight.shuttle.x, real.y - ball.flight.shuttle.y) : null;
        balls.push({ shot: ball.shot, p: { x: ball.flight.shuttle.x, y: ball.flight.shuttle.y }, v: { x: ball.flight.shuttle.vx, y: ball.flight.shuttle.vy }, live, error, behind: ball.at === null ? null : host.clock + Math.min(100, now - host.frameAt) - ball.at });
      } else balls.push({ shot: ball.shot, p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, live: false, error: null, behind: null });
    }
  }
  return { host, net, samples, balls, presses, pressCount, strikes };
}

/** How the guest's own athlete moved against its keys, and how far the host's copy of it was. */
function movement(samples: Sample[], moves: [number, number, -1 | 1][]) {
  let backward = 0;
  const firstMove: number[] = [];
  const moving: number[] = [];
  const atRest: number[] = [];
  let waiting: number | null = null;
  for (let index = 1; index < samples.length; index++) {
    const sample = samples[index]!;
    const before = samples[index - 1]!;
    const step = sample.shown - before.shown;
    const along = step * sample.move;
    if (sample.move !== 0 && sample.move !== before.move) waiting = 0;
    if (waiting !== null) {
      waiting++;
      if (along > 1e-4) {
        firstMove.push(waiting);
        waiting = null;
      }
    }
    if (sample.move !== 0 && sample.move === before.move && along < -1e-3) backward++;
    const gap = Math.abs(sample.shown - sample.host);
    if (sample.move !== 0) moving.push(gap);
    else if (moves.some(([, to]) => sample.now >= to * 1000 + 400 && sample.now < to * 1000 + 600)) atRest.push(gap);
  }
  const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
  return { firstMove: Math.max(...firstMove), backward, hostGapMoving: mean(moving), hostGapMax: Math.max(0, ...moving), hostGapAtRest: Math.max(0, ...atRest) };
}

/** How smoothly the guest's shuttle moved in flight: frames where it jumped (more than its speed explains) or went backward. */
function smoothness(balls: BallSample[]) {
  let jumps = 0;
  let backward = 0;
  let worst = 0;
  let since = 0;
  const errors: number[] = [];
  for (let index = 1; index < balls.length; index++) {
    const a = balls[index - 1]!;
    const b = balls[index]!;
    since = a.shot === b.shot ? since + 1 : 0;
    if (b.error !== null) errors.push(b.error);
    // (the first frames of each shot are left out: the shuttle leaves the racket with a jump in speed, offline too)
    if (!a.live || !b.live || since < 6) continue;
    const dt = 1 / 60;
    const off = Math.hypot(b.p.x - a.p.x - a.v.x * dt, b.p.y - a.p.y - a.v.y * dt);
    worst = Math.max(worst, off);
    if (off > 0.3) jumps++;
    if ((b.p.x - a.p.x) * a.v.x + (b.p.y - a.p.y) * a.v.y < -0.01) backward++;
  }
  errors.sort((x, y) => x - y);
  const behind = balls.flatMap((ball) => (ball.live && ball.behind !== null ? [ball.behind] : []));
  return {
    jumps, backward, worst, errorMean: errors.reduce((sum, n) => sum + n, 0) / Math.max(1, errors.length), error95: errors[Math.floor(errors.length * 0.95)] ?? 0,
    behind: behind.reduce((sum, n) => sum + n, 0) / Math.max(1, behind.length),
  };
}

function rally(options: SimOptions) {
  const run = simulate(options);
  const returns = run.host.hits.filter((hit) => hit.side === 'b');
  const clean = returns.filter((hit) => hit.accuracy >= 0.9).length;
  // (the stroke the screen showed: where the shuttle was drawn when the swing went, against where the host played it)
  const asSeen = returns.filter((hit) => run.presses.get(`${hit.warp}:${hit.n}`)?.type === hit.requested).length;
  const offsets = returns.flatMap((hit) => {
    const seen = run.presses.get(`${hit.warp}:${hit.n}`);
    return seen ? [Math.hypot(seen.at.x - hit.contact.x, seen.at.y - hit.contact.y)] : [];
  });
  return {
    points: run.host.points,
    presses: run.pressCount,
    returns: returns.length,
    strikes: run.strikes,
    clean,
    asSeen,
    offset: offsets.reduce((sum, n) => sum + n, 0) / Math.max(1, offsets.length),
    age: run.host.ages.reduce((sum, n) => sum + n, 0) / Math.max(1, run.host.ages.length),
    accuracy: returns.reduce((sum, hit) => sum + hit.accuracy, 0) / Math.max(1, returns.length),
    ball: smoothness(run.balls),
    run,
  };
}

const MOVES: [number, number, -1 | 1][] = [
  [0.5, 1.1, 1],
  [1.6, 2.2, -1],
  [2.8, 3.2, 1],
  [3.8, 4.6, -1],
  [5.2, 5.6, 1],
];
const RTT100: LinkSpec = { oneWay: 40, jitter: 25 };
const RTT150: LinkSpec = { oneWay: 65, jitter: 30 };

test('a guest moves its own athlete on the next frame, with no pull-back, and the host keeps up', () => {
  for (const link of [RTT100, RTT150]) {
    const [before, after] = [true, false].map((legacy) => movement(simulate({ legacy, link, seconds: 6.5, moves: MOVES }).samples, MOVES));
    if (report) {
      const show = (m: ReturnType<typeof movement>) => `first move after ${m.firstMove} frame(s), ${m.backward} backward frames, host copy off by ${m.hostGapMoving.toFixed(3)} m moving (max ${m.hostGapMax.toFixed(2)}), ${m.hostGapAtRest.toFixed(4)} m at rest`;
      console.log(`movement rtt~${link.oneWay * 2 + link.jitter} ms before: ${show(before!)}`);
      console.log(`movement rtt~${link.oneWay * 2 + link.jitter} ms after:  ${show(after!)}`);
    }
    assert.equal(after!.firstMove, 1, 'the guest moves on the next frame');
    assert.equal(after!.backward, 0, 'nothing pulls the guest back');
    assert.ok(after!.hostGapAtRest < 0.01, `the host has the guest where it stopped (${after!.hostGapAtRest})`);
    assert.ok(after!.hostGapMoving < 0.25, `the host's copy follows the guest closely (${after!.hostGapMoving})`);
    assert.ok(before!.firstMove > 3, 'the old way waited for the host');
  }
});

test('a guest plays a fair rally: swings timed on its own screen are judged as it saw them, and the shuttle runs smooth', () => {
  const show = (r: ReturnType<typeof rally>) => `${r.points} points, ${r.returns}/${r.presses} swings returned, ${r.clean} clean (${(100 * r.clean / Math.max(1, r.returns)).toFixed(0)}%), mean accuracy ${r.accuracy.toFixed(2)}, ${r.asSeen} the stroke the screen showed (${(100 * r.asSeen / Math.max(1, r.returns)).toFixed(0)}%), met ${r.offset.toFixed(2)} m from where it was drawn, shuttle: ${r.ball.jumps} jumps ${r.ball.backward} backward (worst ${r.ball.worst.toFixed(2)} m), off the host's by ${r.ball.errorMean.toFixed(3)} m (95% ${r.ball.error95.toFixed(2)}) at a moment ${r.ball.behind.toFixed(0)} ms behind the host's clock; host played returns ${r.age.toFixed(0)} ms after they were hit`;
  // the same players with no network, for what their timing earns
  const offline = rally({ legacy: false, link: { oneWay: 0, jitter: 0 }, seconds: 120 });
  if (report) console.log(`rally no network:     ${show(offline)}`);
  for (const link of [RTT100, RTT150]) {
    const before = rally({ legacy: true, link, seconds: 120 });
    // (the old way at its best: a player who has learned to swing a trip early)
    const early = rally({ legacy: true, link, seconds: 120, lead: link.oneWay * 2 + link.jitter + 16 });
    const after = rally({ legacy: false, link, seconds: 120 });
    if (report) {
      console.log(`rally rtt~${link.oneWay * 2 + link.jitter} ms before: ${show(before)}`);
      console.log(`rally rtt~${link.oneWay * 2 + link.jitter} ms before, swinging a trip early: ${show(early)}`);
      console.log(`rally rtt~${link.oneWay * 2 + link.jitter} ms after:  ${show(after)} (${after.strikes} returns sent)`);
    }
    assert.ok(after.points >= 8, `points get played (${after.points})`);
    assert.ok(after.returns >= 20, `the guest returns the shuttle (${after.returns})`);
    assert.ok(after.returns >= after.strikes - 1, `the host takes the guest's returns (${after.returns} of ${after.strikes})`);
    const rate = (r: typeof after) => r.returns / Math.max(1, r.presses);
    assert.ok(rate(after) >= rate(offline) - 0.05, `swings meet the shuttle as often as with no network (${rate(after)} vs ${rate(offline)})`);
    assert.ok(after.accuracy >= offline.accuracy - 0.03, `contact as clean as with no network (${after.accuracy} vs ${offline.accuracy})`);
    assert.ok(after.asSeen >= after.returns * 0.9, 'the stroke played is the one the guest\'s screen showed');
    for (const old of [before, early]) assert.ok(after.accuracy > old.accuracy + 0.05 || rate(after) > rate(old) + 0.1, `judged better than the old way (${after.accuracy} vs ${old.accuracy})`);
    assert.equal(after.ball.backward, 0, 'the shuttle never goes backward on the guest');
    assert.ok(after.ball.jumps <= before.ball.jumps / 5, `the shuttle jumps far less than before (${after.ball.jumps} vs ${before.ball.jumps})`);
  }
});

test('the guest serves on its own screen at once, and the host plays that serve', () => {
  const host = new Host(false, 'b', 5);
  const net = new GuestNet();
  host.frame(0);
  for (let now = 0; now < 400; now += 16) {
    net.receive(parseSnapshot(JSON.parse(JSON.stringify(host.snapshot())))!, now + 40);
    host.frame(now + 16);
    net.frame(now + 41, still());
  }
  assert.equal(net.view?.phase, 'serve');
  const sent = net.press('normal', HALF_SMASH_POWER, 420);
  assert.equal(sent.length, 1);
  const frame = net.frame(425, still());
  assert.equal(frame.view?.phase, 'rally', 'the guest sees its serve go at once');
  assert.ok(frame.view?.flight?.status === 'flying' && frame.view.flight.hitter === 'b');
  // the host gets it a trip later and plays the same serve from that moment
  host.frame(460);
  host.receive(parseGuestMessage(JSON.parse(JSON.stringify(sent[0]!.d)))!, 460);
  assert.equal(host.phase, 'rally');
  const guestLaunch = (sent[0]!.d as ServeMessage);
  assert.equal(host.launch?.at, guestLaunch.at);
  const mine = flightAt(host.launch!, host.clock);
  assert.deepEqual(mine.shuttle, host.flight!.shuttle);
  // and the guest, seeing the host's word of it, carries on without a jump
  net.receive(parseSnapshot(JSON.parse(JSON.stringify(host.snapshot())))!, 500);
  const before = net.frame(500, still()).view!.flight!.shuttle;
  const after = net.frame(516, still()).view!.flight!.shuttle;
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.4);
});

test('a launch says where the shuttle is at any moment, as the host steps it, smash beat included', () => {
  const host = new Host(false, 'a', 9);
  host.phase = 'rally';
  host.rallyShots = 3;
  host.flight = createFlight({ x: 2, y: 2 }, { vx: -6, vy: 1 }, 'b', -1);
  host.clock = 1000;
  // a full smash from the host, played inside a step as tryContacts does
  host.stepping = true;
  host.strike('a', 'smash', { x: -1.5, y: 2.6 }, 1, { power: 1 });
  host.flight = stepFlight(host.flight!, FIXED_STEP);
  const launch = host.launch!;
  assert.ok(launch.fz > launch.at + 100, 'a full smash holds still for a beat');
  for (let i = 0; i < 120; i++) {
    host.clock += STEP_MS;
    if (host.clock >= host.freezeUntil && host.flight.status === 'flying') host.flight = stepFlight(host.flight, FIXED_STEP);
    assert.deepEqual(flightAt(launch, host.clock).shuttle, host.flight.shuttle, `step ${i}`);
  }
  assert.equal(launchSteps(launch, launch.at - 1), -1);
});

test('the host turns down returns of a shuttle nobody could have hit, or from too long ago, and takes the real one', () => {
  const host = new Host(false, 'a', 4);
  host.phase = 'rally';
  host.rallyShots = 2;
  host.clock = 5000;
  const b = host.athletes.b;
  // a drive at the guest, standing where it comes down through 1.3 m (the racket at the shuttle)
  host.flight = createFlight({ x: -2, y: 1.6 }, { vx: 14, vy: 2 }, 'a', 1);
  host.lastShot = { type: 'drive', speed: 14 };
  let preview = host.flight;
  while (preview.status === 'flying' && !(preview.shuttle.x > 0.6 && preview.shuttle.y < 1.3)) preview = stepFlight(preview, FIXED_STEP);
  assert.equal(preview.status, 'flying');
  b.x = preview.shuttle.x + 0.5;
  host.net.own(b, { t: 'own', x: b.x, vx: 0, j: 0, jv: 0, m: 0, cs: null, ss: -1e9, in: 'normal', w: host.warp, at: 5000 }, 5000, host.warp, -1);
  let met: FlightState | null = null;
  let metAt = 0;
  // the host's shuttle flies on (nobody here swings) a little past where the guest met it, while word of it comes
  for (let i = 0; i < 600 && host.flight.status === 'flying' && (met === null || host.clock < metAt + 60); i++) {
    host.clock += STEP_MS;
    const flight = stepFlight(host.flight, FIXED_STEP);
    if (flight.status !== 'flying') break;
    host.flight = flight;
    host.net.record(host.clock, host.rallyShots, host.flight);
    if (!met && flight.elapsed >= preview.elapsed - 1e-9) {
      met = flight;
      metAt = host.clock;
    }
  }
  const reach = met && playerContact(b, met, -1);
  assert.ok(reach, 'the drive reaches the guest');
  const strike: HitMessage = { t: 'hit', intent: 'normal', power: HALF_SMASH_POWER, at: metAt, n: 2, sx: met!.shuttle.x, sy: met!.shuttle.y, x: b.x, j: 0, el: met!.elapsed, seed: 77 };
  const context = () => ({ clock: host.clock, phase: host.phase, n: host.rallyShots, flight: host.flight, incoming: host.lastShot?.type ?? null, body: b, direction: -1 as Direction });
  const take = (changes: Partial<HitMessage>) => host.net.hit(parseGuestMessage(JSON.parse(JSON.stringify({ ...strike, ...changes })))! as HitMessage, context());
  assert.equal(take({ n: 1 }), null, 'an old shot');
  assert.equal(take({ at: host.clock - REWIND_MAX - 20 }), null, 'too long ago');
  assert.equal(take({ sx: met!.shuttle.x + 1.5 }), null, 'not where the shuttle was');
  assert.equal(take({ x: 6.5 }), null, 'out of reach');
  const real = take({});
  assert.ok(real, 'and the real one is taken');
  // the same stroke and the same flight the guest played from the same contact and seed
  const guest = playerStroke({ chargeStart: null, power: HALF_SMASH_POWER, intent: 'normal' }, met!.shuttle, reach!.distance, metAt, 'drive', met!.elapsed);
  assert.equal(real.type, guest.type);
  assert.equal(real.accuracy, guest.accuracy);
  const mine = planShot(guest.type, -1, met!.shuttle, seededRandom(77), guest.accuracy, { power: guest.power });
  const theirs = planShot(real.type, -1, real.contact, real.random, real.accuracy, { power: real.power });
  assert.deepEqual(theirs.velocity, mine.velocity);
});

test('a shuttle down on the guest\'s side waits out its grace, and a return played before it landed is taken', () => {
  const host = new Host(false, 'a', 6);
  host.phase = 'rally';
  host.rallyShots = 4;
  host.clock = 2000;
  const b = host.athletes.b;
  b.x = 3;
  host.net.own(b, { t: 'own', x: 3, vx: 0, j: 0, jv: 0, m: 0, cs: null, ss: -1e9, in: 'normal', w: host.warp, at: 1880 }, 2000, host.warp, -1);
  assert.ok(host.net.grace(2000) >= 150, 'the guest\'s word comes 120 ms late, so the call waits longer than that');
  // a net shot dropping onto the guest's side, out of anyone's reach
  host.flight = createFlight({ x: -0.5, y: 1.7 }, { vx: 2, vy: 0.5 }, 'a', 1);
  host.lastShot = { type: 'net', speed: 2 };
  let landedAt: number | null = null;
  let flying: FlightState | null = null;
  let flyingAt = 0;
  for (let i = 0; i < 600 && host.phase === 'rally'; i++) {
    host.frame(i * STEP_MS);
    if (host.flight?.status === 'flying') {
      flying = host.flight;
      flyingAt = host.clock;
    } else if (landedAt === null && host.flight) landedAt = host.clock;
  }
  assert.ok(landedAt !== null && host.phase === 'point');
  const called = host.clock;
  assert.ok(called - landedAt! >= host.net.grace(called) - 2 * STEP_MS, `the call waited (${called - landedAt!} ms)`);
  // the same again, with the guest's return of it (met just before it landed) arriving during the wait
  const again = new Host(false, 'a', 6);
  again.phase = 'rally';
  again.rallyShots = 4;
  again.clock = 2000;
  again.athletes.b.x = flying!.shuttle.x + 0.6;
  again.net.own(again.athletes.b, { t: 'own', x: again.athletes.b.x, vx: 0, j: 0, jv: 0, m: 0, cs: null, ss: -1e9, in: 'normal', w: again.warp, at: 1880 }, 2000, again.warp, -1);
  again.flight = createFlight({ x: -0.5, y: 1.7 }, { vx: 2, vy: 0.5 }, 'a', 1);
  again.lastShot = { type: 'net', speed: 2 };
  let start = 0;
  while (again.clock < landedAt! + 20) again.frame(start++ * STEP_MS);
  assert.equal(again.phase, 'rally', 'still waiting');
  const reach = playerContact(again.athletes.b, flying!, -1);
  assert.ok(reach, 'the guest could reach it then');
  again.receive({ t: 'hit', intent: 'normal', power: HALF_SMASH_POWER, at: flyingAt, n: 4, sx: flying!.shuttle.x, sy: flying!.shuttle.y, x: again.athletes.b.x, j: 0, el: flying!.elapsed, seed: 5 }, 0);
  assert.equal(again.rallyShots, 5, 'the return is played');
  assert.equal(again.flight?.hitter, 'b');
  assert.equal(again.flight?.status, 'flying');
});

test('new packets parse, older ones still do, and bad ones are turned down', () => {
  const own = { t: 'own', x: 3.1234, vx: -2, j: 0.2, jv: 1, m: -1, cs: null, ss: 1200, in: 'power', w: 3, at: 4567.25 };
  assert.deepEqual(parseGuestMessage(JSON.parse(JSON.stringify(own))), own);
  assert.equal(parseGuestMessage({ ...own, m: 2 }), null);
  assert.equal(parseGuestMessage({ ...own, x: 'left' }), null);
  assert.equal(parseGuestMessage({ ...own, cs: undefined }), null);
  const hit = { t: 'hit', intent: 'soft', power: 0.4, at: 100, n: 3, sx: 2, sy: 1.5, x: 2.4, j: 0, el: 0.8, seed: 12345 };
  assert.deepEqual(parseGuestMessage(hit), hit);
  assert.equal(parseGuestMessage({ ...hit, seed: -1 }), null);
  assert.equal(parseGuestMessage({ ...hit, n: undefined }), null);
  assert.deepEqual(parseGuestMessage({ t: 'hit', intent: 'power', power: 0.3 }), { t: 'hit', intent: 'power', power: 0.3 }, 'an older guest\'s swing');
  assert.deepEqual(parseGuestMessage({ t: 'sv', at: 10, x: 3, intent: 'normal', seed: 9, w: 2 }), { t: 'sv', at: 10, x: 3, intent: 'normal', seed: 9, w: 2 });
  assert.equal(parseGuestMessage({ t: 'sv', at: 10, x: 3, intent: 'nuke', seed: 9, w: 2 }), null);
  assert.deepEqual(parseGuestMessage({ t: 'png', q: 5 }), { t: 'png', q: 5 });
  assert.deepEqual(parsePong({ t: 'png', q: 5, c: 900 }), { q: 5, c: 900 });
  // a newer host's snapshot: the new fields, and what an older guest reads of it is as before
  const host = new Host(false, 'a', 2);
  host.phase = 'rally';
  host.rallyShots = 1;
  host.flight = createFlight({ x: -2, y: 1.1 }, { vx: 8, vy: 4 }, 'a', 1, true);
  host.launch = { n: 1, at: 0, fz: 0, s: 'serve', p: HALF_SMASH_POWER, f: host.flight };
  host.athletes.a.chargeStart = 12;
  const snap = parseSnapshot(JSON.parse(JSON.stringify(host.snapshot())))!;
  assert.ok(snap.v === NET_VERSION && snap.w === host.warp && snap.sv === 'a' && snap.l?.n === 1 && snap.a.cs === 12);
  assert.deepEqual(snap.l?.f, host.flight);
  assert.equal(parseSnapshot({ ...host.snapshot(), l: { n: 1 } }), null);
  assert.equal(parseSnapshot({ ...host.snapshot(), w: 'x' }), null);
  const older = parseSnapshot(JSON.parse(JSON.stringify(new Host(true, 'a', 2).snapshot())))!;
  assert.ok(older && older.v === undefined && older.l === undefined);
  assert.equal(new GuestNet().frame(0, still()).view, null);
});

test('an older host gets the old packets, and its guest still plays the old way', () => {
  const run = rally({ legacy: true, link: RTT100, seconds: 40 });
  assert.equal(run.run.net.modern, false);
  assert.ok(run.points >= 2);
  assert.ok(run.returns >= 3, 'the guest returns the shuttle the old way');
});

test('a spectator draws the host\'s court on its clock, with nothing of its own and nothing to send', () => {
  const host = new Host(false, 'a', 8);
  const watcher = new GuestNet(true);
  const bot = new Bot('a', 3);
  let drawn = 0;
  for (let now = 0; now < 4000; now += 16) {
    const decision = bot.decide({ phase: host.phase, me: host.athletes.a, flight: host.flight, shot: host.rallyShots }, now, host.match.server, host.dir('a'));
    host.controls.a = decision.input;
    if (decision.press) host.swing('a', decision.press);
    host.frame(now);
    if (now % 64 === 0) watcher.receive(parseSnapshot(JSON.parse(JSON.stringify(host.snapshot())))!, now + 40);
    const frame = watcher.frame(now + 41, still());
    assert.equal(frame.out.length, 0);
    if (frame.view?.flight) drawn++;
  }
  assert.ok(watcher.own === null && watcher.modern);
  assert.ok(drawn > 10, 'the shuttle is drawn');
});

test('a guest reads the host clock from pings, and from snapshots before one comes back', () => {
  const net = new GuestNet();
  const host = new Host(false, 'a', 1);
  // the host's clock is 40 s ahead of ours; word takes 50 ms each way
  const hostAt = (local: number) => local + 40_000;
  for (let local = 0; local < 2000; local += 33) {
    host.clock = hostAt(local - 50);
    net.receive(parseSnapshot(JSON.parse(JSON.stringify(host.snapshot())))!, local);
  }
  assert.ok(Math.abs(net.clock.read(2000, 0)! - (hostAt(2000) - 50)) < 5, 'snapshots alone: the host clock less the trip');
  net.frame(1900, still());
  net.pong(1900, hostAt(1950), 2000);
  for (let i = 0; i < 100; i++) net.clock.read(2000 + i * 16, 16);
  assert.ok(Math.abs(net.clock.read(3600, 16)! - hostAt(3600)) < 5, 'a ping: the host clock itself');
  net.pong(1234, hostAt(1950), 2000);
  assert.ok(Math.abs(net.clock.read(3616, 16)! - hostAt(3616)) < 5, 'an answer to a ping it never sent changes nothing');
});
