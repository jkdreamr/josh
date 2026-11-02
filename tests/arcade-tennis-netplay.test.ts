// Tennis online: a host and its guests in one process, over a link with latency and jitter (the fast channel unordered,
// the reliable one in order), each running the game the way the page does (netplay.ts). The guests are played by a
// scripted player that only sees what its own screen shows. Measured the old way (an older host, which the guest then
// plays the old way: everything 100 ms behind arrival, its own player eased toward the host's word) and the new way.
// `TENNIS_NET_REPORT=1 node --test tests/arcade-tennis-netplay.test.ts` prints the numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COURT_LENGTH, createWorld, IDEAL_SWING_LEAD, movePlayer, predictContactPoint, scorePoint, STEP, stepBall, stepWorld, strikeRadius, timingLabel,
  type Command, type Event, type Format, type Level, type MoveInput, type Player, type ShotKind, type World,
} from '../src/os/arcade/games/tennis/logic.ts';
import { hitOf, moveOf, parsePacket, pingOf, serveOf, stateOf, swingOf, type Packet } from '../src/os/arcade/games/tennis/net.ts';
import { ballAt, GuestNet, HostNet, REWIND_MAX, scratchOf } from '../src/os/arcade/games/tennis/netplay.ts';

const report = !!process.env.TENNIS_NET_REPORT;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each way: `oneWay` ms plus up to `jitter` more. The reliable channel keeps order (a message waits for the one before it). */
type LinkSpec = { oneWay: number; jitter: number };
type Wire = { at: number; n: number; to: number; from: number; d: unknown };

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
  send(now: number, from: number, to: number, d: unknown, fast: boolean) {
    let at = now + this.spec.oneWay + this.rand() * this.spec.jitter;
    if (!fast) {
      const key = `${from}>${to}`;
      at = Math.max(at, this.ordered.get(key) ?? 0);
      this.ordered.set(key, at);
    }
    // (on the wire it is JSON: functions and undefined fall away)
    this.queue.push({ at, n: this.n++, to, from, d: JSON.parse(JSON.stringify(d)) });
  }
  due(now: number) {
    const ready = this.queue.filter((wire) => wire.at <= now).sort((a, b) => a.at - b.at || a.n - b.n);
    this.queue = this.queue.filter((wire) => wire.at > now);
    return ready;
  }
}

/**
 * When, from what `view` shows, a swing pressed now would be perfectly timed: the ball run on (as the screen will show
 * it) to where it first comes within reach of `me` standing still, and IDEAL_SWING_LEAD before its closest approach
 * from there. Seconds from now, or null if it never comes within reach.
 */
function pressIn(view: World, me: Player) {
  const sim = scratchOf(view);
  const still = { ...me, vx: 0, vz: 0 };
  const reach = strikeRadius(view.level);
  const events: Event[] = [];
  for (let t = 0; t < 1.5; t += STEP) {
    sim.clock += STEP;
    stepBall(sim, events);
    if (!sim.ball.inPlay || (sim.phase !== 'rally' && sim.phase !== 'serve-flight') || sim.held) return null;
    const ball = sim.ball;
    const legal = sim.phase === 'rally' && ball.bounces === 1;
    if (!legal || ball.p.y < 0.15 || ball.p.y > 2.9 || Math.hypot(ball.p.x - still.x, ball.p.z - still.z) > reach) continue;
    const speedSq = ball.v.x ** 2 + ball.v.z ** 2;
    const closest = t + STEP - ((ball.p.x - still.x) * ball.v.x + (ball.p.z - still.z) * ball.v.z) / speedSq;
    return closest - IDEAL_SWING_LEAD;
  }
  return null;
}

/**
 * A player who only knows what its screen shows: moves to meet the ball, presses so the swing is perfectly timed as
 * the screen shows it (to the frame, as a good player would), tosses and serves at the top of the toss.
 */
class Scripted {
  private incoming = -1;
  private reactAt = 0;
  private pressed = false;
  private tossAt = -Infinity;
  private serveAt = -Infinity;
  private readonly rand: () => number;
  readonly seat: number;
  constructor(seat: number, seed: number) {
    this.seat = seat;
    this.rand = rng(seed);
  }
  decide(view: World | null, now: number): { input: MoveInput; press: ShotKind | null } {
    const me = view?.players.find((player) => player.seat === this.seat);
    if (!view || !me) return { input: { x: 0, z: 0 }, press: null };
    const home = { x: 0, z: me.team === 0 ? COURT_LENGTH / 2 - 1.2 : -COURT_LENGTH / 2 + 1.2 };
    if (view.serverSeat === me.seat && view.phase === 'serve-ready') {
      if (now - this.tossAt > 600 && now - this.serveAt > 600) {
        this.tossAt = now;
        return { input: { x: 0, z: 0 }, press: 'topspin' };
      }
      return { input: { x: 0, z: 0 }, press: null };
    }
    if (view.serverSeat === me.seat && view.phase === 'serve-toss') {
      if (view.serveClock >= 0.555 && now - this.serveAt > 600) {
        this.serveAt = now;
        return { input: { x: 0, z: 0 }, press: 'topspin' };
      }
      return { input: { x: 0, z: 0 }, press: null };
    }
    const ball = view.ball;
    if ((view.phase === 'rally' || view.phase === 'serve-flight') && ball.inPlay && ball.canHitTeam === me.team) {
      if (this.incoming !== ball.rallyShot) {
        this.incoming = ball.rallyShot;
        this.reactAt = now + 150 + this.rand() * 100;
        this.pressed = false;
      }
      if (now < this.reactAt || this.pressed) return { input: { x: 0, z: 0 }, press: null };
      const target = predictContactPoint(ball, me);
      const dx = target.x - me.x;
      const dz = target.z - me.z;
      const length = Math.hypot(dx, dz) || 1;
      const due = length < 1.2 ? pressIn(view, me) : null;
      if (due !== null && due <= 1 / 120) {
        this.pressed = true;
        return { input: { x: 0, z: 0 }, press: 'topspin' };
      }
      return { input: length > 0.6 ? { x: dx / length, z: dz / length } : { x: 0, z: 0 }, press: null };
    }
    const dx = home.x - me.x;
    const dz = home.z - me.z;
    const length = Math.hypot(dx, dz);
    return { input: length > 0.5 ? { x: dx / length, z: dz / length } : { x: 0, z: 0 }, press: null };
  }
}

type Sample = { now: number; shown: { x: number; z: number }; host: { x: number; z: number }; input: MoveInput; acc: number };
type BallSample = { shot: number; p: { x: number; y: number; z: number }; v: { x: number; y: number; z: number }; live: boolean };

type SimOptions = {
  /** Play the old way: the host's states say nothing of the new netplay, the guest sends what older guests sent. */
  legacy: boolean;
  link: LinkSpec;
  seconds: number;
  format?: Format;
  level?: Level;
  /** Seats played by guests (the rest are the host's bots). */
  guests: number[];
  /** A fixed stick for one guest instead of the scripted player: [from s, to s, input] spans, the ball kept dead. */
  moves?: [number, number, MoveInput][];
  seed?: number;
};

/** One run: the host's world and HostNet, each guest's GuestNet, frames at 60 Hz, states at 30 Hz. */
function simulate(options: SimOptions) {
  const level = options.level ?? 1;
  const format = options.format ?? 'singles';
  const seats = format === 'doubles' ? 4 : 2;
  const world = createWorld({
    format, level, length: 'set', seed: options.seed ?? 3,
    players: Array.from({ length: seats }, (_, seat) => ({ ai: options.guests.includes(seat) ? null : level })),
  });
  if (options.moves) {
    world.phase = 'rally';
    world.ball.inPlay = false;
  } else {
    // (the first guest serves the first game: the point ends at once and the players line up for its serve)
    world.serverSeat = options.guests[0]!;
    scorePoint(world, 0);
    world.pointClock = STEP / 2;
  }
  const host = new HostNet();
  const link = new Link(options.link, (options.seed ?? 3) * 7 + 1);
  const guests = options.guests.map((seat, index) => ({
    seat, net: new GuestNet(seat, 1), player: new Scripted(seat, 11 + index), last: null as World | null,
    samples: [] as Sample[], balls: [] as BallSample[], frame: 0,
  }));
  const commands: Command[] = [];
  const stats = {
    hits: [] as { seat: number; delta: number }[], serves: 0, serveSpeed: 0, faults: 0, points: 0,
    presses: new Map<number, number>(), strikes: new Map<number, number>(),
  };
  let hostFrameAt = 0;
  let hostLast: number | null = null;
  let nextState = 0;
  const sendState = (now: number) => {
    for (const guest of guests) {
      const packet = stateOf(1, world);
      if (options.legacy) delete packet.v;
      link.send(now, 0, guest.seat, packet, true);
    }
  };
  const count = (map: Map<number, number>, seat: number) => map.set(seat, (map.get(seat) ?? 0) + 1);
  const hostEvents = (events: Event[]) => {
    for (const event of events) {
      if (event.type === 'hit' && !event.serve && options.guests.includes(event.seat)) stats.hits.push({ seat: event.seat, delta: event.delta ?? NaN });
      if (event.type === 'hit' && event.serve && options.guests.includes(event.seat)) {
        stats.serves++;
        stats.serveSpeed += event.speed;
      }
      if (event.type === 'call' && (event.call === 'fault' || event.call === 'double fault') && options.guests.includes(world.serverSeat)) stats.faults++;
      if (event.type === 'point') stats.points++;
    }
  };
  const toHost = (now: number, from: number, out: { d: Packet; fast?: boolean; reliable?: boolean }) => {
    if (out.d.k === 'hit') count(stats.strikes, from);
    // (an older guest never pings)
    if (options.legacy && out.d.k === 'png') return;
    link.send(now, from, 0, out.d, !!out.fast && !out.reliable);
  };
  const end = options.seconds * 1000;
  const frameMs = 1000 / 60;
  let hostFrame = 0;
  for (let now = 0; now <= end; now++) {
    for (const wire of link.due(now)) {
      const packet = parsePacket(wire.d);
      assert.ok(packet, `a packet failed to parse: ${JSON.stringify(wire.d).slice(0, 200)}`);
      if (wire.to === 0) {
        const hostNow = world.clock + world.acc + Math.min(0.1, (now - hostFrameAt) / 1000);
        const heard = host.receive(world, wire.from, packet, hostNow, 1);
        if (heard.command) commands.push(heard.command);
        if (heard.reply) link.send(now, 0, wire.from, heard.reply, true);
        if (heard.events) hostEvents(heard.events);
        if (heard.state && !options.legacy) sendState(now);
      } else guests.find((guest) => guest.seat === wire.to)!.net.receive(packet, now);
    }
    if (now >= hostFrame * frameMs) {
      hostFrame++;
      const dt = hostLast === null ? 0 : (now - hostLast) / 1000;
      hostLast = now;
      host.setGrace(world, () => true);
      const events = stepWorld(world, commands.splice(0), dt);
      host.record(world);
      hostFrameAt = now;
      hostEvents(events);
      if (!options.legacy && events.some((event) => event.type === 'hit')) sendState(now);
    }
    if (now >= nextState) {
      nextState += 1000 / 30;
      sendState(now);
    }
    for (const guest of guests) {
      if (now < guest.frame * frameMs + 7) continue;
      guest.frame++;
      let input: MoveInput = { x: 0, z: 0 };
      if (options.moves) {
        const span = options.moves.find(([from, to]) => now >= from * 1000 && now < to * 1000);
        input = span ? span[2] : { x: 0, z: 0 };
      } else {
        const decision = guest.player.decide(guest.last, now);
        input = decision.input;
        if (decision.press) {
          count(stats.presses, guest.seat);
          for (const out of guest.net.press(decision.press, now)) toHost(now, guest.seat, out);
        }
      }
      const frame = guest.net.frame(now, input);
      for (const out of frame.out) toHost(now, guest.seat, out);
      guest.last = frame.world;
      const shown = frame.world?.players.find((player) => player.seat === guest.seat);
      const real = world.players.find((player) => player.seat === guest.seat)!;
      if (shown) guest.samples.push({ now, shown: { x: shown.x, z: shown.z }, host: { x: real.x, z: real.z }, input, acc: guest.net.ownAcc });
      if (frame.world) {
        const ball = frame.world.ball;
        guest.balls.push({ shot: ball.rallyShot, p: { ...ball.p }, v: { ...ball.v }, live: ball.inPlay && (frame.world.phase === 'rally' || frame.world.phase === 'serve-flight') });
      }
    }
  }
  return { world, guests, stats };
}

/** How a guest's own player moved against its stick, and against where the same stick moves a player with no network. */
function movement(samples: Sample[], moves: [number, number, MoveInput][], world: World, seat: number) {
  // the same stick on the same frames with no network (an offline frame: the steps since the last, drawn between the
  // last two): where the player should be drawn
  const reference = scratchOf(world);
  const ideal = reference.players.find((player) => player.seat === seat)!;
  const start = samples[0]!;
  ideal.x = start.shown.x;
  ideal.z = start.shown.z;
  ideal.vx = 0;
  ideal.vz = 0;
  let from = { x: ideal.x, z: ideal.z };
  let acc = start.acc;
  let backward = 0;
  let drag = 0;
  let slide = 0;
  const firstMove: number[] = [];
  const atRest: number[] = [];
  const moving: number[] = [];
  let waitingSince: number | null = null;
  let waitFrames = 0;
  for (let index = 1; index < samples.length; index++) {
    const sample = samples[index]!;
    const before = samples[index - 1]!;
    acc += (sample.now - before.now) / 1000;
    ideal.input = { ...sample.input };
    while (acc + 1e-9 >= STEP) {
      from = { x: ideal.x, z: ideal.z };
      movePlayer(reference, ideal, STEP);
      acc -= STEP;
    }
    const drawn = { x: from.x + (ideal.x - from.x) * acc / STEP, z: from.z + (ideal.z - from.z) * acc / STEP };
    const held = sample.input.x !== 0 || sample.input.z !== 0;
    const step = { x: sample.shown.x - before.shown.x, z: sample.shown.z - before.shown.z };
    const along = step.x * sample.input.x + step.z * sample.input.z;
    const changed = sample.input.x !== before.input.x || sample.input.z !== before.input.z;
    if (changed && held) {
      waitingSince = sample.now;
      waitFrames = 0;
    }
    if (waitingSince !== null) {
      waitFrames++;
      if (along > 1e-4) {
        firstMove.push(waitFrames);
        waitingSince = null;
      }
    }
    if (held && !changed && along < -1e-3) backward++;
    const error = Math.hypot(sample.shown.x - drawn.x, sample.shown.z - drawn.z);
    if (held) drag = Math.max(drag, error);
    else slide = Math.max(slide, error);
    const gap = Math.hypot(sample.shown.x - sample.host.x, sample.shown.z - sample.host.z);
    if (held) moving.push(gap);
    else if (moves.some(([, to]) => sample.now >= to * 1000 + 400 && sample.now < to * 1000 + 600)) atRest.push(gap);
  }
  const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
  return {
    firstMove: Math.max(...firstMove),
    backward,
    drag,
    slide,
    hostGapMoving: mean(moving),
    hostGapMax: Math.max(...moving, 0),
    hostGapAtRest: Math.max(...atRest, 0),
  };
}

/**
 * How smoothly a guest's ball moved in flight: frames where it jumped (more than its own speed explains) or went
 * backward. The first 0.15 s of each shot are left out: the game itself puts the ball on the racket as it is hit (a
 * jump of up to a metre, offline too), which the guest draws closing in over those frames.
 */
function smoothness(balls: BallSample[]) {
  let jumps = 0;
  let backward = 0;
  let worst = 0;
  let since = 0;
  for (let index = 1; index < balls.length; index++) {
    const a = balls[index - 1]!;
    const b = balls[index]!;
    since = a.shot === b.shot ? since + 1 : 0;
    if (!a.live || !b.live || since < 9) continue;
    const dt = 1 / 60;
    const off = Math.hypot(b.p.x - a.p.x - a.v.x * dt, b.p.z - a.p.z - a.v.z * dt);
    worst = Math.max(worst, off);
    if (off > 0.25) jumps++;
    const along = (b.p.x - a.p.x) * a.v.x + (b.p.z - a.p.z) * a.v.z;
    if (along < -0.01) backward++;
  }
  return { jumps, backward, worst };
}

function rally(options: SimOptions) {
  const run = simulate(options);
  const seat = options.guests[0]!;
  const hits = run.stats.hits.filter((hit) => hit.seat === seat);
  const perfect = hits.filter((hit) => timingLabel(hit.delta) === 'perfect').length;
  const meanDelta = hits.reduce((sum, hit) => sum + Math.abs(hit.delta), 0) / Math.max(1, hits.length);
  const guest = run.guests[0]!;
  const gaps = guest.samples.map((sample) => Math.hypot(sample.shown.x - sample.host.x, sample.shown.z - sample.host.z));
  return {
    points: run.stats.points,
    presses: run.stats.presses.get(seat) ?? 0,
    returns: hits.length,
    perfect,
    meanDelta,
    strikes: run.stats.strikes.get(seat) ?? 0,
    serves: run.stats.serves,
    serveSpeed: run.stats.serveSpeed / Math.max(1, run.stats.serves),
    faults: run.stats.faults,
    hostGapMean: gaps.reduce((sum, n) => sum + n, 0) / Math.max(1, gaps.length),
    ball: smoothness(guest.balls),
    run,
  };
}

const MOVES: [number, number, MoveInput][] = [
  [0.6, 2.1, { x: 1, z: 0 }],
  [2.8, 4.3, { x: -1, z: 0 }],
  [5.0, 5.9, { x: 0, z: 1 }],
  [6.6, 7.5, { x: 0, z: -1 }],
  [8.2, 9.4, { x: 0.71, z: 0.71 }],
];
const RTT100: LinkSpec = { oneWay: 40, jitter: 25 };
const RTT150: LinkSpec = { oneWay: 65, jitter: 30 };

test('a guest moves its own player at once, with no drag, pull-back or slide, and the host keeps up', () => {
  for (const link of [RTT100, RTT150]) {
    const results = [true, false].map((legacy) => {
      const run = simulate({ legacy, link, seconds: 10.5, guests: [1], moves: MOVES });
      return movement(run.guests[0]!.samples, MOVES, run.world, 1);
    });
    const [before, after] = results as [ReturnType<typeof movement>, ReturnType<typeof movement>];
    if (report) {
      const show = (m: typeof before) => `first move after ${m.firstMove} frame(s), ${m.backward} backward frames, drag ${m.drag.toFixed(2)} m, slide ${m.slide.toFixed(2)} m, host copy off by ${m.hostGapMoving.toFixed(2)} m moving (max ${m.hostGapMax.toFixed(2)}), ${m.hostGapAtRest.toFixed(3)} m at rest`;
      console.log(`movement rtt~${link.oneWay * 2 + link.jitter} ms before: ${show(before)}`);
      console.log(`movement rtt~${link.oneWay * 2 + link.jitter} ms after:  ${show(after)}`);
    }
    assert.equal(after.firstMove, 1, 'the guest moves on the next frame');
    assert.equal(after.backward, 0, 'nothing pulls the guest back');
    assert.ok(after.drag < 0.02, `the guest keeps up with its stick (drag ${after.drag})`);
    assert.ok(after.slide < 0.02, `the guest stops when it lets go (slide ${after.slide})`);
    assert.ok(after.hostGapAtRest < 0.01, `the host has the guest where it stopped (${after.hostGapAtRest})`);
    assert.ok(after.hostGapMoving < 0.25, `the host's copy follows the guest closely (${after.hostGapMoving})`);
    assert.ok(before.drag > after.drag * 10, 'the old way dragged');
  }
});

test('a guest plays a fair rally: swings timed on its own screen are judged as it saw them, and the ball runs smooth', () => {
  const show = (r: ReturnType<typeof rally>) => `${r.points} points, ${r.returns}/${r.presses} presses returned, ${r.perfect} perfect (${(100 * r.perfect / Math.max(1, r.returns)).toFixed(0)}%), mean |delta| ${r.meanDelta.toFixed(3)} s, ${r.serves} serves at ${r.serveSpeed.toFixed(0)} km/h ${r.faults} faults, guest-vs-host player ${r.hostGapMean.toFixed(2)} m, ball: ${r.ball.jumps} jumps ${r.ball.backward} backward (worst ${r.ball.worst.toFixed(2)} m)`;
  // the same player with no network at all, for what its timing earns
  const offline = rally({ legacy: false, link: { oneWay: 0, jitter: 0 }, seconds: 150, guests: [1] });
  if (report) console.log(`rally no network:     ${show(offline)}`);
  for (const link of [RTT100, RTT150]) {
    const before = rally({ legacy: true, link, seconds: 150, guests: [1] });
    const after = rally({ legacy: false, link, seconds: 150, guests: [1] });
    if (report) {
      console.log(`rally rtt~${link.oneWay * 2 + link.jitter} ms before: ${show(before)}`);
      console.log(`rally rtt~${link.oneWay * 2 + link.jitter} ms after:  ${show(after)} (${after.strikes} returns sent)`);
    }
    assert.ok(after.points >= 4, `points get played (${after.points})`);
    assert.ok(after.returns >= 20, `the guest returns the ball (${after.returns})`);
    assert.ok(after.returns >= after.strikes - 1, `the host takes the guest's returns (${after.returns} of ${after.strikes})`);
    const rate = (r: typeof after) => r.perfect / Math.max(1, r.returns);
    assert.ok(rate(after) >= rate(offline) - 0.1, `judged as well as with no network (${rate(after)} vs ${rate(offline)})`);
    assert.ok(rate(after) > rate(before) + 0.3, `judged better than the old way (${rate(after)} vs ${rate(before)})`);
    assert.ok(after.meanDelta < offline.meanDelta + 0.02, `swings judged on the guest's own timing (mean ${after.meanDelta})`);
    assert.equal(after.ball.backward, 0, 'the ball never goes backward on the guest');
    assert.ok(after.ball.jumps < before.ball.jumps / 5, `the ball jumps far less than before (${after.ball.jumps} vs ${before.ball.jumps})`);
  }
});

test('doubles with two guests and two bots plays through, every guest returning the ball', () => {
  const run = simulate({ legacy: false, link: RTT100, seconds: 90, format: 'doubles', guests: [1, 2] });
  const hits = (seat: number) => run.stats.hits.filter((hit) => hit.seat === seat).length;
  if (report) console.log(`doubles: ${run.stats.points} points, ${run.world.rallyShot} shots in the rally at the end, guest 1 ${hits(1)} returns of ${run.stats.strikes.get(1) ?? 0} sent, guest 2 ${hits(2)} of ${run.stats.strikes.get(2) ?? 0}`);
  assert.ok(run.stats.points >= 1 || run.world.rallyShot >= 30, 'the match goes on');
  assert.ok(hits(1) >= 3 && hits(2) >= 3, 'both guests return the ball');
  // (a bot partner that got to the ball first, on the host's clock, keeps its shot: the rest are the guests')
  for (const seat of [1, 2]) assert.ok(hits(seat) >= (run.stats.strikes.get(seat) ?? 0) * 0.7, 'the host takes the guests\' returns');
  for (const guest of run.guests) {
    assert.ok(guest.net.modern);
    const gaps = guest.samples.map((sample) => Math.hypot(sample.shown.x - sample.host.x, sample.shown.z - sample.host.z));
    assert.ok(gaps.reduce((sum, n) => sum + n, 0) / gaps.length < 0.3, 'the host keeps up with each guest');
  }
});

test('a rally call waits out a guest\'s grace, and a return it took in time plays on from when it was hit', () => {
  const world = createWorld({ level: 1, players: [{ ai: 1 }, { ai: null }] });
  const guest = world.players[1]!;
  world.phase = 'rally';
  world.clock = 5;
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.canHitTeam = 1;
  world.ball.targetTeam = 1;
  world.ball.bounces = 1;
  world.ball.rallyShot = world.rallyShot = 3;
  world.ball.p = { x: guest.x + 1.2, y: 1, z: guest.z + 1 };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: -4, z: -14 };
  world.grace = [0, 0.2];
  // without grace, the second bounce ends the point at once
  const plain = scratchOf(world);
  plain.grace = undefined;
  let called = false;
  for (let i = 0; i < 60 && !called; i++) called = stepWorld(plain, [], STEP).some((event) => event.type === 'point');
  assert.ok(called);
  // with it, the call waits: the ball bounces on
  const host = new HostNet();
  let held: World['held'] = null;
  const contact = { ...world.ball.p };
  const at = world.clock;
  host.record(world);
  for (let i = 0; i < 60 && !held; i++) {
    stepWorld(world, [], STEP);
    host.record(world);
    held = world.held ?? null;
  }
  assert.ok(held, 'the call is held');
  assert.equal(world.phase, 'rally');
  // a return the guest hit before the second bounce is taken, from where it met the ball
  const heard = host.receive(world, 1, parsePacket(JSON.parse(JSON.stringify(hitOf(1, {
    shot: 3, at, kind: 'topspin', aim: 0, depth: 0, delta: 0.01, ball: contact, x: guest.x, z: guest.z,
  }))))!, world.clock, 1);
  assert.ok(heard.events?.some((event) => event.type === 'hit' && event.seat === 1), 'the return is played');
  assert.equal(world.held, null);
  assert.equal(world.ball.canHitTeam, 0);
  assert.equal(world.ball.rallyShot, 4);
  // carried on from then: already on its way back
  assert.ok(world.ball.p.z > contact.z + 1, 'the ball is already on its way back');
  // a return of the same ball again, or one hit after the call, is turned down
  assert.deepEqual(host.receive(world, 1, parsePacket(JSON.parse(JSON.stringify(hitOf(1, {
    shot: 3, at, kind: 'topspin', aim: 0, depth: 0, delta: 0, ball: contact, x: guest.x, z: guest.z,
  }))))!, world.clock, 1), {});
  // and with nobody returning, the held call is made once the grace runs out
  const late = scratchOf(plain);
  late.phase = 'rally';
  late.ball = { ...world.ball, p: { x: 0, y: 0.5, z: -8 }, prev: { x: 0, y: 0.5, z: -8 }, v: { x: 0, y: -3, z: -10 }, bounces: 1, canHitTeam: 1, hitByTeam: 0, inPlay: true };
  late.grace = [0, 0.2];
  late.held = null;
  let heldAt: number | null = null;
  let calledAt: number | null = null;
  for (let i = 0; i < 240 && calledAt === null; i++) {
    const events = stepWorld(late, [], STEP);
    if (late.held && heldAt === null) heldAt = late.clock;
    if (events.some((event) => event.type === 'point')) calledAt = late.clock;
  }
  assert.ok(heldAt !== null && calledAt !== null);
  assert.ok(Math.abs(calledAt! - heldAt! - 0.2) < 2 * STEP, `called after the grace (${calledAt! - heldAt!})`);
});

test('the host turns down returns of a ball nobody could have hit, or from too long ago', () => {
  const world = createWorld({ level: 1, players: [{ ai: 1 }, { ai: null }] });
  const guest = world.players[1]!;
  world.phase = 'rally';
  world.clock = 5;
  world.ball.inPlay = true;
  world.ball.canHitTeam = 1;
  world.ball.bounces = 1;
  world.ball.rallyShot = world.rallyShot = 2;
  world.ball.p = { x: guest.x + 1, y: 1, z: guest.z };
  world.ball.v = { x: 0, y: 0, z: -10 };
  const host = new HostNet();
  host.record(world);
  const strike = { shot: 2, at: 5, kind: 'topspin' as const, aim: 0, depth: 0, delta: 0, ball: { ...world.ball.p }, x: guest.x, z: guest.z };
  const take = (changes: Partial<typeof strike>) => host.receive(world, 1, parsePacket(JSON.parse(JSON.stringify(hitOf(1, { ...strike, ...changes }))))!, world.clock, 1);
  assert.deepEqual(take({ shot: 1 }), {}, 'an old shot');
  assert.deepEqual(take({ at: 5 - REWIND_MAX - 0.05 }), {}, 'too long ago');
  assert.deepEqual(take({ ball: { x: world.ball.p.x + 3, y: 1, z: world.ball.p.z } }), {}, 'not where the ball was');
  assert.deepEqual(take({ x: guest.x - 3 }), {}, 'out of reach');
  assert.ok(take({}).events?.length, 'and the real one is taken');
});

test('a guest reads the host clock from pings, and from states when the host never answers', () => {
  const net = new GuestNet(1, 1);
  const world = createWorld({ players: [{ ai: 1 }, { ai: null }] });
  // the host's clock is 40 s ahead of ours; word takes 50 ms each way
  const hostAt = (local: number) => local / 1000 + 40;
  for (let local = 0; local < 2000; local += 33) {
    world.clock = hostAt(local - 50);
    net.receive(parsePacket(JSON.parse(JSON.stringify(stateOf(1, world))))!, local);
  }
  const fromStates = net.clock.read(2000, 0)!;
  assert.ok(Math.abs(fromStates - (hostAt(2000) - 0.05)) < 0.005, 'states alone: the host clock less the trip');
  net.receive(parsePacket(pingOf(1, 1900, hostAt(1950)))!, 2000);
  for (let i = 0; i < 100; i++) net.clock.read(2000 + i * 16, 0.016);
  assert.ok(Math.abs(net.clock.read(3600, 0.016)! - hostAt(3600)) < 0.01, 'a ping: the host clock itself');
});

test('the ball carried on from the host\'s word matches the host\'s own ball', () => {
  const world = createWorld({ level: 1, players: [{ ai: null }, { ai: 1 }] });
  world.phase = 'rally';
  world.ball.inPlay = true;
  world.ball.canHitTeam = 1;
  world.ball.hitByTeam = 0;
  world.ball.targetTeam = 1;
  world.ball.p = { x: 0, y: 1, z: 10 };
  world.ball.v = { x: 1, y: 4, z: -22 };
  world.ball.spin = { x: 0, y: 2, z: 60 };
  const base = scratchOf(world);
  for (let i = 0; i < 48; i++) stepWorld(world, [], STEP);
  const carried = ballAt(base, world.clock);
  assert.ok(Math.hypot(carried.ball.p.x - world.ball.p.x, carried.ball.p.y - world.ball.p.y, carried.ball.p.z - world.ball.p.z) < 1e-6);
});

test('new packets parse, and carry what older peers read in the shapes they read it', () => {
  const own = { x: 1.23456, z: -9.87654, vx: 3.21, vz: -0.5, warp: 4, at: 12.3456 };
  const move = parsePacket(JSON.parse(JSON.stringify(moveOf(2, { x: 1, z: -0.5 }, own))));
  assert.ok(move?.k === 'mv' && move.px === 1.235 && move.w === 4 && move.at === 12.3456);
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(moveOf(2, { x: 1, z: -0.5 })))), { k: 'mv', r: 2, x: 1, z: -0.5 });
  assert.equal(parsePacket({ ...moveOf(2, { x: 1, z: 0 }, own), w: -1 }), null);
  const swing = parsePacket(JSON.parse(JSON.stringify(swingOf(2, 5, { kind: 'slice', aim: -1, delta: 0 }, 7.5))));
  assert.ok(swing?.k === 'sw' && swing.c === 1 && swing.at === 7.5 && swing.shot === 5 && swing.swipe === 0);
  const serve = parsePacket(JSON.parse(JSON.stringify(serveOf(2, 'serve', 0.5, 'flat', { at: 3, delta: -0.02, ball: { x: 1, y: 2.4, z: 11 }, x: 1.2, z: 11.2 }))));
  assert.ok(serve?.k === 'serve' && serve.kind === 'flat' && serve.aim === 0.5 && serve.delta === -0.02 && serve.by === 2.4);
  const hit = parsePacket(JSON.parse(JSON.stringify(hitOf(2, { shot: 3, at: 4, kind: 'volley', aim: 0.3, depth: -1, delta: 0.05, ball: { x: 1, y: 1, z: -9 }, x: 0.4, z: -10 }))));
  assert.ok(hit?.k === 'hit' && hit.kind === 'volley' && hit.bz === -9);
  assert.equal(parsePacket({ ...hitOf(2, { shot: 3, at: 4, kind: 'volley', aim: 0.3, depth: -1, delta: 0.05, ball: { x: 1, y: 1, z: -9 }, x: 0.4, z: -10 }), bx: 99 }), null);
  const state = stateOf(2, Object.assign(createWorld({ format: 'doubles' }), { grace: [0, 0.2] as [number, number], held: { winner: 1, call: 'out' as const, at: 3 } }));
  const parsed = parsePacket(JSON.parse(JSON.stringify(state)));
  assert.ok(parsed?.k === 'S' && parsed.v === 2 && parsed.state.grace?.[1] === 0.2 && parsed.state.held?.call === 'out');
  assert.equal(parsePacket(JSON.parse(JSON.stringify({ ...state, state: { ...state.state, grace: [0, 5] } }))), null);
  // what an older peer reads: the same fields, within the same bounds, under the same names
  const old = JSON.parse(JSON.stringify(moveOf(2, { x: 0.25, z: 0 }, own)));
  assert.ok(Math.abs(old.x * 100 - Math.round(old.x * 100)) < 1e-6 && old.k === 'mv' && old.t === 'tennis');
  const oldSwing = JSON.parse(JSON.stringify(swingOf(2, 5, { kind: 'lob', aim: 0.2, delta: 0 }, 7.5)));
  assert.ok(Number.isSafeInteger(oldSwing.shot) && oldSwing.delta === 0 && oldSwing.kind === 'lob' && oldSwing.swipe === 0);
  const oldServe = JSON.parse(JSON.stringify(serveOf(2, 'toss', 0, 'topspin', { at: 3 })));
  assert.ok(oldServe.k === 'toss' && oldServe.aim === 0);
});

test('an older host (no word of the new netplay) gets the old packets, and its guest still plays', () => {
  const run = simulate({ legacy: true, link: RTT100, seconds: 40, guests: [1] });
  assert.equal(run.guests[0]!.net.modern, false);
  assert.ok(run.stats.points >= 2);
  assert.ok(run.stats.hits.length >= 3, 'the guest returns the ball the old way');
});

test('a spectator draws the host\'s world on its clock, with nothing of its own and nothing to send', () => {
  const world = createWorld({ players: [{ ai: 1 }, { ai: 1 }] });
  const watcher = new GuestNet(-1, 1);
  let drawn: World | null = null;
  for (let now = 0; now < 3000; now += 16) {
    if (now % 32 === 0) watcher.receive(parsePacket(JSON.parse(JSON.stringify(stateOf(1, world))))!, now + 40);
    stepWorld(world, [], 0.016);
    const frame = watcher.frame(now + 41, { x: 0, z: 0 });
    assert.equal(frame.out.length, 0);
    drawn = frame.world ?? drawn;
  }
  assert.ok(drawn && watcher.own === null && watcher.modern);
  assert.ok(drawn.players.length === 2 && Number.isFinite(drawn.ball.p.x));
});

test('a guest that turns into a bot (it left) is no longer waited on', () => {
  const world = createWorld({ players: [{ ai: 1 }, { ai: null }] });
  const host = new HostNet();
  host.receive(world, 1, parsePacket(JSON.parse(JSON.stringify(moveOf(1, { x: 0, z: 0 }, { x: world.players[1]!.x, z: world.players[1]!.z, vx: 0, vz: 0, warp: world.warp ?? 0, at: 0 }))))!, 0.05, 1);
  host.setGrace(world, () => true);
  assert.ok((world.grace?.[1] ?? 0) > 0);
  host.setGrace(world, () => false);
  assert.equal(world.grace, undefined);
  host.receive(world, 1, parsePacket(JSON.parse(JSON.stringify(moveOf(1, { x: 0, z: 0 }, { x: 0, z: -10, vx: 0, vz: 0, warp: world.warp ?? 0, at: 0.1 }))))!, 0.15, 1);
  world.players[1]!.ai = 1;
  host.forget(1);
  host.setGrace(world, () => true);
  assert.equal(world.grace, undefined);
});
