/**
 * Online play, the parts that make a guest's game feel like the host's: kept apart from the page so the tests can run a
 * host and a guest over a slow, uneven link.
 *
 * - A guest moves its own player (the host takes its word on where it is, carried on to the host's moment the way the
 *   player moves, unless the game put the players back for a serve since), so its stick answers on the next frame and
 *   nothing pulls it back.
 * - A guest reads the host's clock (pings, or the host's states before a ping comes back) and runs the ball on the host's
 *   own physics from the host's latest word, so the ball it plays is where the host has it, timed on the host's clock.
 * - A guest finds where its swing meets the ball as it sees it, plays the return straight away, and tells the host when
 *   (on the host's clock) and where. The host checks that against where it had the ball then and plays the return from
 *   then, carrying the ball on to now. So a well timed swing is judged as the guest saw it (favoring the hitter); the
 *   other side sees the returned ball start a few metres out, the time word of it took to arrive. To leave room for that
 *   word, the host waits that long (World.grace) before calling a rally over on a guest's side, and a teammate (a bot
 *   in doubles) that hit the same ball after the guest did has its hit taken back.
 * - Others are drawn a moment behind, between the host's states on its clock. The ball is drawn on the host's clock too,
 *   on time while it comes to this guest and a little behind while it goes to the other side, so an opponent's return
 *   is known before the ball reaches them and the ball never jumps back.
 *
 * Older peers still play: an older host never says it takes a guest's own moves (StatePacket.v), and a guest then plays
 * the old way (legacyFrame); an older guest sends no times or places, and the host times its presses itself as before.
 */
import {
  clamp, contactSwing, movePlayer, serveSwing, STEP, stepBall, strikeBall, strikeRadius, SWING_BUFFER, tossHeight, tossServe,
  type Ball, type Command, type Event, type MoveInput, type Phase, type Player, type ShotKind, type Swing, type Vec3, type World,
} from './logic.ts';
import {
  commandOf, hitOf, moveOf, NET_VERSION, pingOf, serveOf, strikeOf, swingOf,
  type MovePacket, type Packet, type ServePacket, type Strike,
} from './net.ts';

/** The oldest moment (host clock, seconds back) a host plays a guest's return or serve from. */
export const REWIND_MAX = 0.4;
/** Added to the latest a guest's word has arrived, for how long the host waits on that guest's return. */
const GRACE_PAD = 0.06;
/** How far a guest may say the ball was from where the host had it at that moment (metres). */
const BALL_SLACK = 0.6;
/** How far beyond running distance a guest may say it was from where it last said (metres). */
const PLAYER_SLACK = 1.2;
const TOP_SPEED = 6.6;
/** The furthest the host carries a guest's word on its own player on (seconds). */
const CARRY_MAX = 0.3;
/** How often a guest says where its own player is (ms). */
const REPORT_MS = 33;
/** How long a corrected ball takes to come together with where it is (seconds, time constant). */
const FIX_TIME = 0.07;
/** The furthest the ball is carried on past the host's latest word (seconds). */
const AHEAD_MAX = 0.5;
/** A guest's clock within CLOCK_FAR of its reading runs at most CLOCK_SLEW faster or slower until they agree. */
const CLOCK_FAR = 0.25;
const CLOCK_SLEW = 0.06;

/** Something a guest sends the host: on the fast channel, or (`reliable` too) on both. */
export type Out = { d: Packet; fast?: boolean; reliable?: boolean };

const flight = (phase: Phase) => phase === 'rally' || phase === 'serve-flight';
const cloneBall = (ball: Ball): Ball => ({ ...ball, p: { ...ball.p }, prev: { ...ball.prev }, v: { ...ball.v }, spin: { ...ball.spin } });
const clonePlayer = (player: Player): Player => ({ ...player, input: { ...player.input }, pending: player.pending && { ...player.pending } });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A copy of `world` to run on without touching it (a call can move the players and change the score). */
export function scratchOf(world: World): World {
  return {
    ...world,
    players: world.players.map(clonePlayer),
    ball: cloneBall(world.ball),
    match: {
      ...world.match,
      games: [...world.match.games],
      sets: [...world.match.sets],
      points: [...world.match.points],
      tbPoints: [...world.match.tbPoints],
      completedSets: world.match.completedSets.map((set) => [...set]),
    },
    receiverFlip: [...world.receiverFlip],
    grace: world.grace && [...world.grace],
    held: world.held && { ...world.held },
  };
}

/**
 * `base` (the world at base.clock) carried on to host time `t`, on the host's own ball physics: whole steps, then the
 * part of one more, so a ball drawn between steps still moves smoothly. Only the ball (and a toss) moves.
 */
export function ballAt(base: World, t: number): World {
  const world = scratchOf(base);
  const span = clamp(t - base.clock, 0, AHEAD_MAX);
  world.clock = base.clock;
  if (world.phase === 'serve-toss') {
    world.serveClock += span;
    world.ball.p.y = tossHeight(world.serveClock);
  } else if (flight(world.phase) && world.ball.inPlay) {
    const steps = Math.floor(span / STEP + 1e-6);
    const events: Event[] = [];
    for (let i = 0; i < steps && flight(world.phase) && world.ball.inPlay; i++) {
      world.clock += STEP;
      stepBall(world, events);
    }
    const part = (span - steps * STEP) / STEP;
    if (part > 1e-6 && flight(world.phase) && world.ball.inPlay) {
      const next = scratchOf(world);
      stepBall(next, events);
      if (next.ball.inPlay) {
        world.ball.p = { x: lerp(world.ball.p.x, next.ball.p.x, part), y: lerp(world.ball.p.y, next.ball.p.y, part), z: lerp(world.ball.p.z, next.ball.p.z, part) };
      }
    }
  }
  world.clock = base.clock + span;
  world.ball.prev = { ...world.ball.p };
  return world;
}

/**
 * A guest's reading of the host's clock (seconds). A ping says it best: the host answers with its clock, so it is
 * ahead of ours by c - now + rtt / 2, read from the quickest recent round trip. Until one comes back (an older host
 * doesn't answer) the host's states stand in: each says the host's clock was at least its time when it arrived, so the
 * least delayed one is taken (the host's clock less the quickest trip one way), drifting up slowly so a slower
 * connection is followed too. The clock in use moves toward the reading a few percent at a time, so nothing jumps.
 */
export class GuestClock {
  /** Round trips (seconds) and how far our clock was ahead of the host's (local less host, seconds). */
  private pongs: { rtt: number; offset: number }[] = [];
  private floor: number | null = null;
  private used: number | null = null;

  state(hostClock: number, now: number) {
    const offset = now / 1000 - hostClock;
    this.floor = this.floor === null || offset < this.floor ? offset : this.floor + (offset - this.floor) * 0.02;
  }

  pong(sent: number, hostClock: number, now: number) {
    const rtt = (now - sent) / 1000;
    if (!(rtt >= 0 && rtt < 2)) return;
    const offset = now / 1000 - (hostClock + rtt / 2);
    // (one that disagrees with the others by more than their trips allow means a clock moved, a host that stalled: start over)
    this.pongs = this.pongs.filter((pong) => Math.abs(pong.offset - offset) <= (pong.rtt + rtt) / 2 + 0.01);
    this.pongs.push({ rtt, offset });
    if (this.pongs.length > 8) this.pongs.shift();
  }

  private get best() {
    let best: { rtt: number; offset: number } | null = null;
    for (const pong of this.pongs) if (!best || pong.rtt < best.rtt) best = pong;
    return best;
  }

  /** Whether a ping has come back. */
  get pinged() {
    return this.pongs.length > 0;
  }

  /** The time word takes to come from the host (half the quickest recent round trip, seconds), or a guess before one. */
  get oneWay() {
    return this.best ? this.best.rtt / 2 : 0.05;
  }

  /** The host's clock at our `now` (ms), the clock in use having moved toward its reading for `dt` seconds; null before any word. */
  read(now: number, dt: number): number | null {
    const best = this.best;
    const target = best ? Math.min(best.offset, this.floor ?? best.offset) : this.floor;
    if (target === null) return null;
    if (this.used === null || Math.abs(target - this.used) > CLOCK_FAR) this.used = target;
    else this.used += clamp(target - this.used, -CLOCK_SLEW * dt, CLOCK_SLEW * dt);
    return now / 1000 - this.used;
  }
}

/** A guest's own return or serve, drawn before the host's word of it: the world just after it, at host time `at`. */
type Struck = { shot: number; at: number; base: World; confirmed: number | null; until: number };

export type GuestFrame = { world: World | null; out: Out[]; events: Event[] };

/**
 * A guest's side of an online match: give it the host's packets (receive), the keys (press, frame) and it hands back
 * the world to draw, what to send the host, and its own hits' events for sound and the timing call.
 */
export class GuestNet {
  readonly seat: number;
  readonly round: number;
  readonly clock = new GuestClock();
  /** The host takes this guest's own moves and returns (its states say so). */
  modern = false;
  /** This guest's own player, as it moves here (newer hosts). */
  own: Player | null = null;
  /** A swing key pressed and waiting for the ball, at host time `at` as the ball was drawn. */
  pending: { kind: ShotKind; at: number; aim: number } | null = null;
  /** The world last drawn. */
  view: World | null = null;
  /** The host's clock as last read, and the moment the ball was last drawn at (host clock). */
  hostNow = 0;
  ballTime: number | null = null;
  /** How far behind the host's clock the ball is drawn (seconds). */
  ballLag = 0;

  private snaps: World[] = [];
  /** The ball as last drawn, before any fading out of a correction. */
  private shown: World | null = null;
  private warp = -1;
  private ownFrom = { x: 0, z: 0 };
  /** Time the own player has still to be moved, under a step (it is drawn that far between its last two steps). */
  ownAcc = 0;
  private toss: number | null = null;
  private struck: Struck | null = null;
  private fix = { x: 0, y: 0, z: 0 };
  private source: World | null = null;
  private last: number | null = null;
  private sentAt = -Infinity;
  private sentInput: MoveInput = { x: 0, z: 0 };
  private pingAt = -Infinity;
  private pings = 0;
  private events: Event[] = [];
  // (playing an older host, the old way)
  private legacySnaps: { at: number; state: World }[] = [];
  private legacyWorld: World | null = null;
  private prediction: Player | null = null;
  private legacySent: MoveInput = { x: 0, z: 0 };
  private legacySentAt = 0;

  constructor(seat: number, round: number) {
    this.seat = seat;
    this.round = round;
  }

  /** A packet from the host, arriving at our `now` (ms). */
  receive(packet: Packet, now: number) {
    if (packet.k === 'png') {
      if (packet.c !== undefined) this.clock.pong(packet.q, packet.c, now);
      return;
    }
    if (packet.k !== 'S') return;
    const state = packet.state;
    if ((packet.v ?? 0) >= NET_VERSION) this.modern = true;
    const newest = this.snaps.at(-1);
    if (newest && (newest.format !== state.format || newest.players.length !== state.players.length)) {
      this.snaps = [];
      this.own = null;
      this.warp = -1;
      this.legacySnaps = [];
      this.legacyWorld = null;
      this.prediction = null;
    }
    this.legacySnaps.push({ at: now, state });
    if (this.legacySnaps.length > 12) this.legacySnaps.shift();
    this.legacyWorld ??= scratchOf(state);
    // (the fast channel can bring them out of order: kept in the host's order, one per moment)
    if (this.snaps.some((snap) => snap.clock === state.clock)) return;
    this.clock.state(state.clock, now);
    const at = this.snaps.findIndex((snap) => snap.clock > state.clock);
    if (at < 0) this.snaps.push(state);
    else this.snaps.splice(at, 0, state);
    if (this.snaps.length > 16) this.snaps.shift();
    if (this.snaps.at(-1) === state) this.newest(state);
  }

  /** The host's newest word: this guest's own player put back for a serve, its own toss and return taken or turned down. */
  private newest(state: World) {
    const mine = state.players.find((player) => player.seat === this.seat);
    if (!mine || mine.ai !== null) this.own = null;
    else if ((state.warp ?? 0) !== this.warp || !this.own) {
      this.own = clonePlayer(mine);
      this.own.pending = null;
      this.ownFrom = { x: mine.x, z: mine.z };
      this.ownAcc = 0;
      this.pending = null;
      this.toss = null;
      this.struck = null;
    }
    this.warp = state.warp ?? 0;
    if (this.own && mine) {
      this.own.name = mine.name;
      this.own.connected = mine.connected;
    }
    if (this.toss !== null && (state.phase !== 'serve-ready' || state.serverSeat !== this.seat || state.clock > this.toss + 1.5)) this.toss = null;
    const struck = this.struck;
    if (struck && struck.confirmed === null) {
      // (taken: the host's ball is this return, or the rally has gone on past it; a teammate's hit of the same shot is not it)
      const mine = state.ball.rallyShot > struck.shot || (state.ball.rallyShot === struck.shot
        && distance3(ballAt(struck.base, state.clock).ball.p, state.ball.p) < 1);
      if (mine) struck.confirmed = Math.max(state.clock, struck.at);
      else if (state.clock > struck.at && (state.phase === 'point' || state.phase === 'done' || state.phase === 'serve-ready')) this.struck = null;
    }
  }

  private me(world: World | null) {
    return world?.players.find((player) => player.seat === this.seat) ?? null;
  }

  /** A shot key: a toss or a serve when this guest serves, else a swing that waits for the ball. What to send. */
  press(kind: ShotKind, now: number): Out[] {
    const view = this.view;
    const player = this.me(view);
    if (!view || !player || player.ai !== null || !player.connected) return [];
    const round = this.round;
    const own = this.modern ? this.own : null;
    // (all on the host's clock, at the moment the ball was drawn)
    const drawnAt = this.ballTime ?? this.hostNow;
    if ((view.phase === 'serve-ready' || view.phase === 'serve-toss') && view.serverSeat === this.seat) {
      if (view.phase === 'serve-ready') {
        if (!own) return [{ d: serveOf(round, 'toss') }];
        this.toss = drawnAt;
        own.serveToss = 1;
        return [{ d: serveOf(round, 'toss', 0, 'topspin', { at: drawnAt }) }];
      }
      const serveKind = kind === 'slice' || kind === 'flat' ? kind : 'topspin';
      if (!own || !this.shown) return [{ d: serveOf(round, 'serve', player.input.x, serveKind) }];
      const at = drawnAt;
      const delta = clamp(this.shown.serveClock - 0.56, -1, 1);
      const ball = { ...this.shown.ball.p };
      const aim = clamp(own.input.x, -1, 1);
      const world = scratchOf(view);
      const server = this.me(world)!;
      Object.assign(server, clonePlayer(own));
      world.ball.p = { ...ball };
      world.ball.prev = { ...ball };
      world.clock = at;
      const events: Event[] = [];
      if (serveSwing(world, this.seat, delta, aim, serveKind, events)) {
        this.struck = { shot: world.ball.rallyShot, at, base: world, confirmed: null, until: now + 2500 };
        own.swing = server.swing;
        own.swingKind = server.swingKind;
        own.serveToss = 0;
        this.events.push(...events.filter((event) => event.type === 'hit'));
      }
      return [{ d: serveOf(round, 'serve', aim, serveKind, { at, delta, ball, x: own.x, z: own.z }) }];
    }
    if (!flight(view.phase) || !view.ball.inPlay || view.ball.canHitTeam !== player.team) return [];
    const aim = (own ?? player).input.x;
    const swing: Swing = { kind, aim, delta: 0 };
    if (!own) return [{ d: swingOf(round, view.ball.rallyShot, swing) }];
    if (this.pending) {
      this.pending.kind = kind;
      this.pending.aim = aim;
    } else this.pending = { kind, at: drawnAt, aim };
    return [{ d: swingOf(round, view.ball.rallyShot, swing, drawnAt) }];
  }

  /** The stick let go (the window lost focus). What to send. */
  stop(now: number): Out[] {
    if (this.own) this.own.input = { x: 0, z: 0 };
    this.sentInput = { x: 0, z: 0 };
    this.sentAt = now;
    this.legacySent = { x: 0, z: 0 };
    this.legacySentAt = now;
    if (this.seat < 0 || !this.view) return [];
    return [{ d: moveOf(this.round, { x: 0, z: 0 }, this.ownMove()) }];
  }

  private ownMove() {
    const own = this.modern ? this.own : null;
    return own ? { x: own.x, z: own.z, vx: own.vx, vz: own.vz, warp: this.warp, at: this.hostNow - this.ownAcc } : undefined;
  }

  /** One frame at our `now` (ms), with the stick at `input`: the world to draw, what to send, this guest's own hits. */
  frame(now: number, input: MoveInput): GuestFrame {
    const dt = this.last === null ? 0 : clamp((now - this.last) / 1000, 0, 0.25);
    const legacyDt = this.last === null ? 0 : clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const out: Out[] = [];
    const events = this.events.splice(0);
    if (this.seat >= 0 && now - this.pingAt >= (this.pings < 6 ? 250 : 1000)) {
      this.pingAt = now;
      this.pings++;
      out.push({ d: pingOf(this.round, now), fast: true });
    }
    const newest = this.snaps.at(-1);
    if (!newest) return { world: null, out, events };
    if (!this.modern) {
      this.view = this.legacyFrame(now, legacyDt, input, out);
      return { world: this.view, out, events };
    }
    const hostNow = this.clock.read(now, dt) ?? newest.clock;
    this.hostNow = hostNow;
    const own = this.own;

    // this guest's own player: moved here, on the host's steps
    const tossing = this.toss !== null && newest.phase === 'serve-ready' && newest.serverSeat === this.seat;
    if (own) {
      own.input = { x: clamp(input.x, -1, 1), z: clamp(input.z, -1, 1) };
      const still = newest.phase === 'point' || newest.phase === 'done';
      const moving = { ...newest, phase: tossing ? 'serve-toss' as const : newest.phase };
      this.ownAcc += dt;
      while (this.ownAcc + 1e-9 >= STEP) {
        this.ownFrom = { x: own.x, z: own.z };
        if (!still) movePlayer(moving, own, STEP);
        this.ownAcc -= STEP;
      }
    }

    // the ball: on time while it comes to this side, a little behind while it goes to the other
    const myTeam = own?.team ?? (this.seat >= 0 ? this.seat % 2 : null);
    this.steerLag(dt, myTeam);
    let ballTime = hostNow - this.ballLag;
    if (this.ballTime !== null && ballTime < this.ballTime && this.ballTime - ballTime < CLOCK_FAR) ballTime = this.ballTime;
    this.ballTime = ballTime;
    const struck = this.struck;
    if (struck && (now > struck.until || (struck.confirmed !== null && ballTime >= struck.confirmed))) this.struck = null;
    let source: World;
    if (this.struck && ballTime >= this.struck.at) source = this.struck.base;
    else {
      source = this.snaps[0]!;
      for (const snap of this.snaps) if (snap.clock <= ballTime) source = snap;
    }
    const shown = ballAt(source, ballTime);
    if (tossing) {
      shown.phase = 'serve-toss';
      shown.serveClock = Math.max(0, ballTime - this.toss!);
      shown.ball.p.y = tossHeight(shown.serveClock);
      shown.ball.prev = { ...shown.ball.p };
    }
    this.correct(source, shown, ballTime, dt);
    this.shown = shown;

    // this guest's swing meets the ball as it is drawn here
    if (own && this.pending && !this.struck) this.swing(shown, ballTime, now, out, events);

    // where this guest is, for the host
    const ownMove = this.ownMove();
    if (own && ownMove && (own.input.x !== this.sentInput.x || own.input.z !== this.sentInput.z)) {
      this.sentInput = { ...own.input };
      this.sentAt = now;
      out.push({ d: moveOf(this.round, own.input, ownMove) });
    } else if (own && ownMove && now - this.sentAt >= REPORT_MS) {
      this.sentAt = now;
      out.push({ d: moveOf(this.round, own.input, ownMove), fast: true });
    }

    this.view = this.compose(newest, source, shown, hostNow);
    return { world: this.view, out, events };
  }

  /**
   * How far behind the host's clock the ball is drawn: nothing while it comes to this guest's side (so it is played
   * where the host has it), up to a trip's time while it is on the other side going to them (so word of their return
   * comes before the ball reaches them), changing a little at a time so the ball only runs a bit slower or faster.
   */
  private steerLag(dt: number, myTeam: number | null) {
    const view = this.view;
    const far = clamp(this.clock.oneWay + 0.02, 0.02, 0.2);
    let target = this.ballLag;
    let rate = 0;
    if (myTeam === null || !view) {
      target = 0;
      rate = 1;
    } else if (!flight(view.phase) || !view.ball.inPlay) {
      target = view.serverSeat === this.seat ? 0 : far;
      rate = 1;
    } else if (view.ball.canHitTeam === myTeam) {
      target = 0;
      rate = 0.35;
    } else if ((view.ball.p.z >= 0 ? 0 : 1) !== myTeam) {
      target = far;
      rate = 0.15;
    }
    this.ballLag += clamp(target - this.ballLag, -rate * dt, rate * dt);
  }

  /** When the ball's source changes (a new word from the host), any jump is faded out instead of shown. */
  private correct(source: World, shown: World, ballTime: number, dt: number) {
    const previous = this.source;
    this.source = source;
    if (previous && previous !== source) {
      if (source === this.struck?.base || !flight(shown.phase) || !shown.ball.inPlay) this.fix = { x: 0, y: 0, z: 0 };
      else {
        const before = ballAt(previous, ballTime);
        const jump = { x: before.ball.p.x - shown.ball.p.x, y: before.ball.p.y - shown.ball.p.y, z: before.ball.p.z - shown.ball.p.z };
        if (before.ball.inPlay && flight(before.phase) && Math.hypot(jump.x, jump.y, jump.z) < 6) {
          this.fix = { x: this.fix.x + jump.x, y: this.fix.y + jump.y, z: this.fix.z + jump.z };
        } else this.fix = { x: 0, y: 0, z: 0 };
      }
    }
    const keep = Math.exp(-dt / FIX_TIME);
    this.fix = { x: this.fix.x * keep, y: this.fix.y * keep, z: this.fix.z * keep };
  }

  /** The waiting swing at the ball as drawn (`shown`, at host time `ballTime`): a return played here and told to the host, or a whiff. */
  private swing(shown: World, ballTime: number, now: number, out: Out[], events: Event[]) {
    const own = this.own!;
    const pending = this.pending!;
    const world = scratchOf(shown);
    const me = this.me(world);
    if (!me) return;
    Object.assign(me, clonePlayer(own));
    me.pending = null;
    const swing = contactSwing(world, me, pending);
    if (!swing) {
      if (ballTime - pending.at + 1e-9 >= SWING_BUFFER) {
        this.pending = null;
        own.swing = 0.42;
        own.swingKind = pending.kind;
      }
      return;
    }
    const strike: Strike = {
      shot: world.ball.rallyShot, at: ballTime, kind: swing.kind, aim: swing.aim, depth: swing.depth ?? 0,
      delta: clamp(swing.delta, -1, 1), ball: { ...world.ball.p }, x: me.x, z: me.z,
    };
    swing.delta = strike.delta;
    const hit: Event[] = [];
    this.pending = null;
    if (!strikeBall(world, me, swing, hit)) return;
    this.struck = { shot: world.ball.rallyShot, at: ballTime, base: world, confirmed: null, until: now + 2500 };
    own.swing = me.swing;
    own.swingKind = me.swingKind;
    own.swingLunge = me.swingLunge;
    own.lungeX = me.lungeX;
    own.lungeZ = me.lungeZ;
    events.push(...hit);
    out.push({ d: hitOf(this.round, strike), fast: true, reliable: true });
  }

  /**
   * The world to draw: the play (phase, toss, ball) as at the ball's time, the score and the like as of the host word
   * it came from, others a moment behind the host's clock, and this guest's own player as it is here.
   */
  private compose(newest: World, source: World, shown: World, hostNow: number): World {
    const othersAt = hostNow - clamp(this.clock.oneWay + 1 / 30 + 0.02, 0.04, 0.3);
    let older = this.snaps[0]!;
    let newer = older;
    for (const snap of this.snaps) {
      newer = snap;
      if (snap.clock > othersAt) break;
      older = snap;
    }
    const span = newer.clock - older.clock;
    const t = span > 0 ? clamp((othersAt - older.clock) / span, 0, 1) : 0;
    const ahead = newer === older ? clamp(othersAt - newer.clock, 0, 0.1) : 0;
    const own = this.own;
    const alpha = clamp(this.ownAcc / STEP, 0, 1);
    const players = newest.players.map((player, index) => {
      if (own && player.seat === this.seat) {
        const x = lerp(this.ownFrom.x, own.x, alpha);
        const z = lerp(this.ownFrom.z, own.z, alpha);
        return { ...clonePlayer(own), name: player.name, ai: player.ai, connected: player.connected, x, z, prevX: x, prevZ: z };
      }
      const a = older.players[index] ?? player;
      const b = newer.players[index] ?? player;
      const x = lerp(a.x, b.x, t) + b.vx * ahead;
      const z = lerp(a.z, b.z, t) + b.vz * ahead;
      return { ...b, name: player.name, ai: player.ai, connected: player.connected, x, z, prevX: x, prevZ: z };
    });
    const p = { x: shown.ball.p.x + this.fix.x, y: shown.ball.p.y + this.fix.y, z: shown.ball.p.z + this.fix.z };
    return {
      ...source,
      phase: shown.phase,
      serveClock: shown.serveClock,
      players,
      ball: { ...shown.ball, p, prev: { ...p } },
      held: shown.held ?? null,
      clock: hostNow,
      acc: STEP,
    };
  }

  /**
   * Playing an older host, the old way: everything drawn 100 ms behind the host's states as they arrived, this guest's
   * own player run here from its stick but eased toward the host's (late) word of it, and the stick sent when it changes.
   */
  private legacyFrame(now: number, dt: number, input: MoveInput, out: Out[]): World {
    const snapshots = this.legacySnaps;
    const current = this.legacyWorld!;
    const renderAt = now - 100;
    let before = snapshots[0]!;
    let after = snapshots[snapshots.length - 1]!;
    for (let index = 1; index < snapshots.length; index++) {
      const candidate = snapshots[index]!;
      if (candidate.at >= renderAt) {
        before = snapshots[index - 1]!;
        after = candidate;
        break;
      }
      before = candidate;
    }
    const span = after.at - before.at;
    const alpha = span > 0 ? clamp((renderAt - before.at) / span, 0, 1) : 1;
    const older = before.state;
    const newer = after.state;
    const latest = snapshots[snapshots.length - 1]!.state;
    Object.assign(current, latest);
    current.players = latest.players.map((player, index) => {
      const a = older.players[index] ?? player;
      const b = newer.players[index] ?? player;
      return { ...player, x: lerp(a.x, b.x, alpha), z: lerp(a.z, b.z, alpha), prevX: lerp(a.x, b.x, alpha), prevZ: lerp(a.z, b.z, alpha) };
    });
    const a = older.ball.p;
    const b = newer.ball.p;
    const p = { x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha), z: lerp(a.z, b.z, alpha) };
    current.ball = { ...latest.ball, p, prev: { ...p } };
    const local = current.players.find((player) => player.seat === this.seat);
    if (local) {
      let prediction = this.prediction;
      if (!prediction || prediction.seat !== local.seat) {
        prediction = clonePlayer(local);
        this.prediction = prediction;
      }
      prediction.input = { ...input };
      movePlayer(current, prediction, dt);
      const error = Math.hypot(local.x - prediction.x, local.z - prediction.z);
      if (error > 1.5) {
        prediction.x = local.x;
        prediction.z = local.z;
      } else {
        prediction.x += (local.x - prediction.x) * 0.15;
        prediction.z += (local.z - prediction.z) * 0.15;
      }
      local.x = prediction.x;
      local.z = prediction.z;
      if (local.ai === null && local.connected
        && (input.x !== this.legacySent.x || input.z !== this.legacySent.z || input.x !== local.input.x || input.z !== local.input.z)
        && now - this.legacySentAt >= 50) {
        this.legacySent = { ...input };
        this.legacySentAt = now;
        out.push({ d: moveOf(this.round, input) });
      }
      local.input = { ...input };
    }
    current.acc = STEP;
    return current;
  }
}

/** What the host does with a guest's packet. */
export type HostHeard = {
  /** An older guest's stick or key, for the next step. */
  command?: Command;
  /** What playing a guest's toss, serve or return just now made happen. */
  events?: Event[];
  /** Send this back to that guest alone (an answer to its ping). */
  reply?: Packet;
  /** The world changed under the host's states: send one now. */
  state?: boolean;
};

type Remote = { lags: { clock: number; lag: number }[]; heard: number; took: number | null };
/** The ball after a host frame. */
type Moment = { clock: number; ball: Ball; phase: Phase; held: World['held'] };

/**
 * The host's side: guests' own moves, returns and serves taken (and checked) as they come, the ball's recent path to
 * check them against, and how long to wait on each team's guests before calling a rally over.
 */
export class HostNet {
  /** Guests that move themselves and send their own returns, by seat. */
  private remotes = new Map<number, Remote>();
  /** The ball after each frame lately (host clock). */
  private trail: Moment[] = [];

  /** After each frame: the ball as it is now, to check guests' returns against the moment they saw. */
  record(world: World) {
    const last = this.trail.at(-1);
    if (last && last.clock >= world.clock) this.trail.pop();
    this.trail.push({ clock: world.clock, ball: cloneBall(world.ball), phase: world.phase, held: world.held && { ...world.held } });
    while (this.trail.length > 2 && this.trail[0]!.clock < world.clock - REWIND_MAX - 0.1) this.trail.shift();
  }

  /** Before each frame: how long a rally call on each team waits for its guests (World.grace), from how late their word arrives. */
  setGrace(world: World, present: (seat: number) => boolean) {
    const grace: [number, number] = [0, 0];
    for (const [seat, remote] of this.remotes) {
      const player = world.players.find((entry) => entry.seat === seat);
      if (!player || player.ai !== null || !player.connected || !present(seat)) continue;
      grace[player.team] = Math.max(grace[player.team]!, this.lateness(remote, world.clock));
    }
    world.grace = grace[0] > 0 || grace[1] > 0 ? grace : undefined;
  }

  /** The longest a guest's word took lately (host clock now less the time it was sent for), padded and capped. */
  private lateness(remote: Remote, clock: number) {
    let late = 0;
    let any = false;
    for (const sample of remote.lags) {
      if (sample.clock < clock - 3) continue;
      late = Math.max(late, sample.lag);
      any = true;
    }
    return clamp((any ? late : 0.12) + GRACE_PAD, 0.05, REWIND_MAX);
  }

  /** A guest left its seat (a bot took it): stop waiting on it. */
  forget(seat: number) {
    this.remotes.delete(seat);
  }

  private remote(seat: number, at: number | undefined, hostNow: number) {
    let remote = this.remotes.get(seat);
    if (!remote) {
      remote = { lags: [], heard: -Infinity, took: null };
      this.remotes.set(seat, remote);
    }
    if (at !== undefined) {
      remote.lags.push({ clock: hostNow, lag: Math.max(0, hostNow - at) });
      if (remote.lags.length > 120) remote.lags.shift();
    }
    return remote;
  }

  /**
   * A packet from the guest in seat `from`, at host time `hostNow` (the world's clock plus the time since its last
   * frame). Moves and calls to make now are made here; anything else comes back to the page.
   */
  receive(world: World, from: number, packet: Packet, hostNow: number, round: number): HostHeard {
    if (packet.k === 'png') return packet.c === undefined ? { reply: pingOf(round, packet.q, hostNow) } : {};
    const player = world.players.find((entry) => entry.seat === from);
    if (!player || player.ai !== null || !player.connected) return {};
    if (packet.k === 'mv') {
      if (packet.at === undefined) return { command: commandOf(packet, from) ?? undefined };
      this.takeOwn(world, player, packet, this.remote(from, packet.at, hostNow));
      return {};
    }
    if (packet.k === 'sw') {
      // (a newer guest finds where it meets the ball itself; its return follows)
      if (packet.c) {
        this.remote(from, packet.at, hostNow);
        return {};
      }
      if (packet.shot !== world.ball.rallyShot || !flight(world.phase) || !world.ball.inPlay || world.ball.canHitTeam !== player.team) return {};
      return { command: commandOf(packet, from) ?? undefined };
    }
    if (packet.k === 'toss' || packet.k === 'serve') {
      if (from !== world.serverSeat) return {};
      if (packet.at === undefined) return { command: commandOf(packet, from) ?? undefined };
      this.remote(from, packet.at, hostNow);
      if (packet.k === 'toss') {
        if (!tossServe(world, from)) return {};
        // (begun when the guest tossed, as it shows it)
        world.serveClock = clamp(world.clock - packet.at, 0, REWIND_MAX);
        world.ball.p.y = tossHeight(world.serveClock);
        world.ball.prev = { ...world.ball.p };
        return { state: true };
      }
      if (packet.delta === undefined) return { command: commandOf(packet, from) ?? undefined };
      return this.takeServe(world, player, packet);
    }
    if (packet.k === 'hit') {
      this.remote(from, packet.at, hostNow);
      return this.takeStrike(world, player, strikeOf(packet));
    }
    return {};
  }

  /**
   * A guest's word on where its own player is: taken unless the game put the players back since (warp) or holds them
   * still, carried on to the world's moment the way the player moves, and held to what it could have run since its last.
   */
  private takeOwn(world: World, player: Player, packet: MovePacket, remote: Remote) {
    const at = packet.at!;
    if (at <= remote.heard || packet.w !== (world.warp ?? 0)) return;
    remote.heard = at;
    player.input = { x: clamp(packet.x, -1, 1), z: clamp(packet.z, -1, 1) };
    if (world.phase === 'point' || world.phase === 'done' || (world.phase === 'serve-toss' && world.serverSeat === player.seat)) return;
    const moved = clonePlayer(player);
    moved.x = packet.px!;
    moved.z = packet.pz!;
    moved.vx = packet.vx!;
    moved.vz = packet.vz!;
    const age = clamp(world.clock - at, 0, CARRY_MAX);
    for (let t = STEP; t <= age + 1e-9; t += STEP) movePlayer(world, moved, STEP);
    const since = remote.took === null ? 1 : clamp(world.clock - remote.took, 0, 1);
    remote.took = world.clock;
    const dx = moved.x - player.x;
    const dz = moved.z - player.z;
    const far = Math.hypot(dx, dz);
    const reach = TOP_SPEED * since + 0.6;
    const k = far > reach ? reach / far : 1;
    player.x += dx * k;
    player.z += dz * k;
    player.vx = moved.vx;
    player.vz = moved.vz;
    // (kept inside the player's own bounds)
    movePlayer(world, player, 0);
  }

  /** The host's ball at host time `at`: carried on from the last frame before then (or from now, for a moment after it). */
  private ballThen(world: World, at: number): World | null {
    let from: Moment | null = null;
    for (const moment of this.trail) {
      if (moment.clock > at + 1e-9) break;
      from = moment;
    }
    if (!from) return null;
    return ballAt({ ...world, ball: from.ball, phase: from.phase, held: from.held, clock: from.clock }, at);
  }

  /**
   * A guest's return: taken if the ball it hit was live then (not already dead and waiting on its call), in play for its
   * team, where the host had it then, and in the guest's reach from about where it has said it is; and if nobody has
   * hit that ball since, or only a teammate after the guest did (the guest hit it first, so the teammate's hit is taken
   * back). Played from that moment (the ball where the guest met it, the guest where it stood) and carried on to now.
   */
  private takeStrike(world: World, player: Player, strike: Strike): HostHeard {
    const ball = world.ball;
    const age = world.clock - strike.at;
    if (age > REWIND_MAX || age < -0.1) return {};
    let undo: Moment | null = null;
    if (ball.rallyShot === strike.shot + 1 && ball.hitByTeam === player.team) {
      const after = this.trail.find((moment) => moment.ball.rallyShot === strike.shot + 1);
      if (!after || strike.at >= after.clock) return {};
      undo = this.trail.filter((moment) => moment.clock < after.clock && moment.ball.rallyShot === strike.shot).at(-1) ?? null;
      if (!undo) return {};
    } else if (!flight(world.phase) || !ball.inPlay || ball.rallyShot !== strike.shot) return {};
    else if (world.held && strike.at >= world.held.at - 1e-9) return {};
    const then = this.ballThen(world, strike.at);
    if (!then) return {};
    const live = then.ball.inPlay && !then.held && then.ball.bounces < 2 && then.ball.canHitTeam === player.team
      && (then.phase === 'rally' || (then.phase === 'serve-flight' && then.ball.bounces > 0));
    if (!live || then.ball.rallyShot !== strike.shot || distance3(then.ball.p, strike.ball) > BALL_SLACK) return {};
    if (Math.hypot(strike.ball.x - strike.x, strike.ball.z - strike.z) > strikeRadius(world.level) + 0.1
      || strike.ball.y < 0.1 || strike.ball.y > 3) return {};
    if (Math.hypot(strike.x - player.x, strike.z - player.z) > TOP_SPEED * Math.max(0, age) + PLAYER_SLACK) return {};
    if (undo) {
      world.ball = cloneBall(undo.ball);
      world.rallyShot = strike.shot;
    }
    const kept = { x: player.x, z: player.z };
    player.x = strike.x;
    player.z = strike.z;
    world.ball.p = { ...strike.ball };
    world.ball.prev = { ...strike.ball };
    world.held = null;
    world.phase = then.phase;
    const events: Event[] = [];
    const hit = strikeBall(world, player, { kind: strike.kind, aim: strike.aim, delta: strike.delta, depth: strike.depth }, events);
    player.x = kept.x;
    player.z = kept.z;
    if (hit) this.carry(world, age, events);
    return { events, state: true };
  }

  /**
   * A guest's serve: its swing as it timed it, from the toss as it was then (the ball where the guest met it, if that
   * is about where the host had it) and the server where it stood, carried on to now.
   */
  private takeServe(world: World, player: Player, packet: ServePacket): HostHeard {
    if (world.phase !== 'serve-toss') return {};
    const age = clamp(world.clock - packet.at!, 0, REWIND_MAX);
    const toss = { x: world.ball.p.x, y: tossHeight(Math.max(0, world.serveClock - age)), z: world.ball.p.z };
    const said = { x: packet.bx!, y: packet.by!, z: packet.bz! };
    const ball = distance3(said, toss) <= BALL_SLACK ? said : toss;
    const near = Math.hypot(packet.px! - player.x, packet.pz! - player.z) <= PLAYER_SLACK;
    const kept = { x: player.x, z: player.z };
    if (near) {
      player.x = packet.px!;
      player.z = packet.pz!;
    }
    world.ball.p = { ...ball };
    world.ball.prev = { ...ball };
    const events: Event[] = [];
    const served = serveSwing(world, player.seat, packet.delta!, packet.aim, packet.kind ?? 'topspin', events);
    player.x = kept.x;
    player.z = kept.z;
    if (served) this.carry(world, age, events);
    return { events, state: true };
  }

  /** A ball just played from `age` seconds ago, carried on to now. */
  private carry(world: World, age: number, events: Event[]) {
    const steps = Math.round(age / STEP);
    for (let i = 0; i < steps && flight(world.phase) && world.ball.inPlay; i++) {
      world.ball.prev = { ...world.ball.p };
      if (stepBall(world, events)) break;
    }
  }
}
