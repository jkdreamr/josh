// Noodle online: a host and two guests over a slow, jittery link, the way index.tsx runs them, measured with the old
// netcode (guests send where they steer, the host moves everyone and sends heads 12 times a second, guests draw
// everything, their own snake included, 83 ms behind packet arrival) and the new one (netsync.ts). Plus the pieces.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { movePacket, parsePacket, snapshotPackets, statePacket, type Packet, type SnakeState } from '../src/os/arcade/games/slither/net.ts';
import {
  HostClock, HostHeads, INTERP, OwnSnake, QUIET, SILENT, STATE_EVERY, StateBuffer, WallClock, interpolateStates,
} from '../src/os/arcade/games/slither/netsync.ts';
import { applyHeadState, loadSnapshot } from '../src/os/arcade/games/slither/session.ts';
import {
  BOOST_SPEED, SPEED, TICK, addPellet, addSnake, angleDiff, bodyCount, createWorld, maxTurnRate, step,
  type Input, type Snake, type World,
} from '../src/os/arcade/games/slither/world.ts';

// ---------------------------------------------------------------------------------------------------------------
// A link: each message takes `latency` plus up to `jitter` ms. Fast messages go unordered and a `loss` share never
// arrive; reliable ones arrive in order.

type Link = { latency: number; jitter: number; loss: number };

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

class Wire {
  private queue: { at: number; n: number; to: string; from: number; data: string }[] = [];
  private lastReliable = new Map<string, number>();
  private n = 0;
  private link: Link;
  private rand: () => number;
  constructor(link: Link, rand: () => number) {
    this.link = link;
    this.rand = rand;
  }
  send(now: number, from: number, to: string, value: Packet, fast: boolean) {
    if (fast && this.rand() < this.link.loss) return;
    let at = now + this.link.latency + this.rand() * this.link.jitter;
    if (!fast) {
      at = Math.max(at, this.lastReliable.get(to) ?? 0);
      this.lastReliable.set(to, at);
    }
    this.queue.push({ at, n: this.n++, to, from, data: JSON.stringify(value) });
  }
  due(now: number) {
    const ready = this.queue.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.n - b.n);
    this.queue = this.queue.filter((m) => m.at > now);
    return ready.map((m) => ({ to: m.to, from: m.from, msg: parsePacket(JSON.parse(m.data)) }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The arena: the host's own snake (seat 0) and guest 2's go straight; guest 1 zigzags, boosting for a while.

function place(world: World, id: number, x: number, y: number, angle: number, mass: number) {
  const snake = addSnake(world, { id, name: `Seat ${id}`, seat: id, bot: false, skin: id, respawnDelay: 3 });
  snake.x = snake.px = x;
  snake.y = snake.py = y;
  snake.angle = snake.prevAngle = angle;
  snake.mass = snake.peak = mass;
  snake.body = Array.from({ length: bodyCount(mass) }, (_, i) => ({ x: x - Math.cos(angle) * i * 7, y: y - Math.sin(angle) * i * 7 }));
  return snake;
}

function arena(): World {
  const world = createWorld({ seed: 5, radius: 4000, fillPellets: false });
  world.pelletTarget = 0;
  place(world, 0, -1500, -500, 0, 20);
  place(world, 1, -1500, 0, 0, 30);
  place(world, 2, -1500, 500, 0, 20);
  return world;
}

/** A guest's copy of the host's world, from its snapshot packets (as a guest joins). */
function joined(host: World): World {
  const world = createWorld({ seed: 5, radius: 4000, fillPellets: false });
  for (const snake of host.snakes) addSnake(world, { id: snake.id, name: snake.name, seat: snake.seat, skin: snake.skin, respawnDelay: 3 });
  const data = snapshotPackets(host, 1, 1).flatMap((part) => {
    const parsed = parsePacket(JSON.parse(JSON.stringify(part)));
    return parsed?.k === 'Z' ? parsed.data : [];
  });
  loadSnapshot(world, data);
  return world;
}

const steering = (t: number): Input => ({
  target: t < 1 ? 0 : Math.floor((t - 1) / 0.9) % 2 === 0 ? 0.9 : -0.9,
  boost: t >= 4.2 && t < 5.6,
});

// ---------------------------------------------------------------------------------------------------------------
// Hosts and guests, old and new, run as index.tsx runs them. Each frame gets its time (`now`, seconds) and the frame
// loop's step (`dt`, at most 1/20 s, as the kit clamps it).

interface HostModel { world: World; frame(now: number, dt: number, send: (value: Packet) => void): void; receive(seat: number, msg: Packet, now: number): void }
/** `path`: where the guest has had its own snake (each tick it moved it, or each frame it drew it). */
interface GuestModel {
  world: World; id: number; path: { x: number; y: number }[];
  frame(now: number, dt: number, input: Input, send: (value: Packet) => void): void; receive(msg: Packet, now: number): void;
}

class OldHost implements HostModel {
  world = arena();
  private acc = 0;
  private sendIn = 0;
  private remote = new Map<number, Input>();
  private seqs = new Map<number, number>();
  frame(_now: number, dt: number, send: (value: Packet) => void) {
    const world = this.world;
    this.acc = Math.min(TICK * 6, this.acc + dt);
    while (this.acc >= TICK) {
      const inputs = new Map<number, Input>();
      for (const snake of world.snakes) {
        inputs.set(snake.id, snake.id === 0 ? { target: 0, boost: false } : this.remote.get(snake.id) ?? { target: snake.angle, boost: false });
      }
      step(world, inputs);
      this.acc -= TICK;
    }
    this.sendIn += dt;
    if (this.sendIn >= 1 / 12) {
      this.sendIn = 0;
      send(statePacket(1, world));
    }
  }
  receive(seat: number, msg: Packet) {
    if (msg.k !== 'M') return;
    if (msg.seq <= (this.seqs.get(seat) ?? -1)) return;
    this.seqs.set(seat, msg.seq);
    this.remote.set(seat, { target: msg.target, boost: msg.boost });
  }
}

class OldGuest implements GuestModel {
  world: World;
  path: { x: number; y: number }[] = [];
  private samples: { receivedAt: number; tick: number; clock: number; snakes: SnakeState[] }[] = [];
  private tickSeen = -1;
  private sendIn = 0;
  private seq = 0;
  private last = { target: 99, boost: false };
  id: number;
  constructor(host: World, id: number) {
    this.world = joined(host);
    this.id = id;
  }
  frame(now: number, dt: number, input: Input, send: (value: Packet) => void) {
    this.sendIn += dt;
    if (this.sendIn >= 0.08) {
      this.sendIn = 0;
      const changed = Math.abs(angleDiff(input.target, this.last.target)) > 0.04 || input.boost !== this.last.boost;
      if (changed || this.world.tick % 3 === 0) {
        this.last = { target: input.target, boost: input.boost };
        send(movePacket(1, ++this.seq, input.target, input.boost));
      }
    }
    const samples = this.samples;
    if (!samples.length) return;
    const renderAt = now * 1000 - 1000 / 12;
    let before = samples[0];
    let after = samples[samples.length - 1];
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].receivedAt >= renderAt) {
        before = samples[i - 1];
        after = samples[i];
        break;
      }
    }
    const span = after.receivedAt - before.receivedAt;
    const alpha = before === after ? 1 : Math.max(0, Math.min(1, (renderAt - before.receivedAt) / Math.max(1, span)));
    this.world.clock = before.clock + (after.clock - before.clock) * alpha;
    this.world.tick = Math.floor(before.tick + (after.tick - before.tick) * alpha);
    applyHeadState(this.world, interpolateStates({ t: 0, snakes: before.snakes }, { t: 0, snakes: after.snakes }, alpha));
    this.path.push({ x: this.world.snakes[this.id].x, y: this.world.snakes[this.id].y });
  }
  receive(msg: Packet, now: number) {
    if (msg.k !== 'S' || msg.tick <= this.tickSeen) return;
    this.tickSeen = msg.tick;
    this.samples.push({ receivedAt: now * 1000, tick: msg.tick, clock: msg.clock, snakes: msg.snakes });
    if (this.samples.length > 4) this.samples.shift();
  }
}

class NewHost implements HostModel {
  world = arena();
  heads = new HostHeads();
  private wall = new WallClock();
  private acc = 0;
  private sendIn = 0;
  private seqs = new Map<number, number>();
  frame(now: number, dt: number, send: (value: Packet) => void) {
    const world = this.world;
    const elapsed = this.wall.elapsed(now * 1000, dt);
    this.acc = Math.min(TICK * 8, this.acc + elapsed);
    while (this.acc >= TICK) {
      const inputs = new Map<number, Input>();
      for (const snake of world.snakes) inputs.set(snake.id, snake.id === 0 ? { target: 0, boost: false } : this.heads.input(snake, now - (this.acc - TICK)));
      for (const event of step(world, inputs)) if (event.type === 'spawn') this.heads.moved(event.id);
      this.acc -= TICK;
    }
    this.sendIn += elapsed;
    if (this.sendIn >= STATE_EVERY) {
      this.sendIn = Math.min(STATE_EVERY, this.sendIn - STATE_EVERY);
      send(statePacket(1, world, this.heads.warpList(world)));
    }
  }
  receive(seat: number, msg: Packet, now: number) {
    if (msg.k !== 'M') return;
    if (msg.seq <= (this.seqs.get(seat) ?? -1)) return;
    this.seqs.set(seat, msg.seq);
    this.heads.receive(seat, msg, now);
  }
}

class NewGuest implements GuestModel {
  world: World;
  path: { x: number; y: number }[] = [];
  own = new OwnSnake();
  private wall = new WallClock();
  private states = new StateBuffer();
  private clock = new HostClock();
  private heardAt = -Infinity;
  private acc = 0;
  private tickSeen = -1;
  private seq = 0;
  private last = { target: 99, boost: false };
  id: number;
  constructor(host: World, id: number) {
    this.world = joined(host);
    this.id = id;
  }
  frame(now: number, dt: number, input: Input, send: (value: Packet) => void) {
    const world = this.world;
    const me = world.snakes[this.id];
    const elapsed = this.wall.elapsed(now * 1000, dt);
    if (me.alive && this.own.moving && now - this.heardAt <= SILENT) {
      this.acc = Math.min(TICK * 8, this.acc + elapsed);
      while (this.acc >= TICK) {
        this.acc -= TICK;
        this.own.tick(world, me, input, now);
        this.path.push({ x: me.x, y: me.y });
      }
    } else this.acc = 0;
    this.own.expire(world, now);
    const changed = Math.abs(angleDiff(input.target, this.last.target)) > 0.04 || input.boost !== this.last.boost;
    if (this.own.due(now, changed)) {
      this.last = { target: input.target, boost: input.boost };
      send(movePacket(1, ++this.seq, input.target, input.boost, this.own.report(now)));
    }
    const hostNow = this.clock.at(now);
    const sample = hostNow === null ? null : this.states.at(hostNow - INTERP);
    if (sample) {
      world.clock = sample.t;
      applyHeadState(world, this.own.moving ? sample.snakes.filter((row) => row[0] !== this.id) : sample.snakes);
    }
  }
  receive(msg: Packet, now: number) {
    if (msg.k !== 'S' || msg.tick <= this.tickSeen) return;
    this.tickSeen = msg.tick;
    this.clock.heard(msg.tick * TICK, now);
    this.states.push({ t: msg.tick * TICK, snakes: msg.snakes });
    this.heardAt = now;
    const index = msg.snakes.findIndex((row) => row[0] === this.id);
    if (index >= 0) this.own.fromHost(this.world.snakes[this.id], msg.snakes[index], msg.w?.[index]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A run, and what it measures

type Metrics = {
  /** Frames from a new steering input until guest 1's own snake turns on its own screen (mean, max). */
  turnFrames: [number, number];
  /** Frames in which guest 1's own snake went backward on its own screen while moving steadily. */
  ownBackward: number;
  /** Guest 1's own head on its screen vs the host's copy at the same moment, px (mean, max). */
  sameTime: [number, number];
  /** How far the host's copy of guest 1's head strays from the path guest 1 drew for itself, px (max). */
  offPath: number;
  /** Share of frames where a remote snake's on-screen speed is more than 30% off a speed it can go: host's snake on guest 1, guest 1's on guest 2. */
  uneven: [number, number];
  /** Frames where a remote snake went backward on screen (both views). */
  remoteBackward: number;
};

/** `hitches`: now and then a frame takes far longer (150 ms on guest 1, 120 ms on the host), as a busy page's does. */
function run(kind: 'old' | 'new', link: Link, hitches = false, seed = 1): Metrics {
  const rand = rng(seed);
  const wire = new Wire(link, rand);
  const host: HostModel = kind === 'old' ? new OldHost() : new NewHost();
  const guests: GuestModel[] = kind === 'old'
    ? [new OldGuest(host.world, 1), new OldGuest(host.world, 2)]
    : [new NewGuest(host.world, 1), new NewGuest(host.world, 2)];
  const names = ['g1', 'g2'];
  const end = 8000;
  let hostNext = 0;
  const guestNext = [3, 9];
  const guestLast = [-1, -1];
  let hostLast = -1;

  const ownTrace: { t: number; x: number; y: number; a: number }[] = [];
  const hostCopy: { t: number; x: number; y: number }[] = [];
  const turns: { t: number; at: number; heading: number; dir: number }[] = [];
  const remote: { dt: number; dx: number; dy: number; a: number; boost: boolean }[][] = [[], []];
  let lastTarget = 0;

  for (let ms = 0; ms <= end; ms++) {
    for (const { to, from, msg } of wire.due(ms)) {
      if (!msg) continue;
      if (to === 'host') host.receive(from, msg, ms / 1000);
      else guests[names.indexOf(to)].receive(msg, ms / 1000);
    }
    if (ms >= hostNext) {
      const dt = hostLast < 0 ? 0 : Math.min(1 / 20, (ms - hostLast) / 1000);
      hostLast = ms;
      hostNext += 1000 / 60 + (hitches && ms % 2500 < 1000 / 60 && ms > 1000 ? 120 : 0);
      host.frame(ms / 1000, dt, (value) => {
        for (const name of names) wire.send(ms, 0, name, value, true);
      });
      const copy = host.world.snakes[1];
      hostCopy.push({ t: ms, x: copy.x, y: copy.y });
    }
    guests.forEach((guest, g) => {
      if (ms < guestNext[g]) return;
      const dt = guestLast[g] < 0 ? 0 : Math.min(1 / 20, (ms - guestLast[g]) / 1000);
      const span = (ms - guestLast[g]) / 1000;
      guestLast[g] = ms;
      // frames a little uneven, as a browser's are
      guestNext[g] += 1000 / 60 + (rand() - 0.5) * 6 + (hitches && g === 0 && ms % 2000 < 20 && ms > 1000 ? 150 : 0);
      const input = g === 0 ? steering(ms / 1000) : { target: 0, boost: false };
      const watched = guest.world.snakes[g === 0 ? 0 : 1];
      const before = { x: watched.x, y: watched.y };
      const me = guest.world.snakes[guest.id];
      if (g === 0 && input.target !== lastTarget) {
        turns.push({ t: ms, at: ownTrace.length, heading: me.angle, dir: Math.sign(angleDiff(input.target, me.angle)) });
        lastTarget = input.target;
      }
      guest.frame(ms / 1000, dt, input, (value) => wire.send(ms, guest.id, 'host', value, true));
      if (g === 0) ownTrace.push({ t: ms, x: me.x, y: me.y, a: me.angle });
      if (ms > 1500 && dt > 0) remote[g].push({ dt: span, dx: watched.x - before.x, dy: watched.y - before.y, a: watched.angle, boost: watched.boosting });
    });
  }

  const turnFrames = turns.map((turn) => {
    const k = ownTrace.slice(turn.at).findIndex((p) => angleDiff(p.a, turn.heading) * turn.dir > 0.005);
    return k < 0 ? Infinity : k;
  });
  let ownBackward = 0;
  for (let i = 1; i < ownTrace.length; i++) {
    const a = ownTrace[i - 1];
    const b = ownTrace[i];
    if (a.t < 1500) continue;
    if ((b.x - a.x) * Math.cos(a.a) + (b.y - a.y) * Math.sin(a.a) < -0.5) ownBackward++;
  }
  const sameTime: number[] = [];
  for (const p of ownTrace) {
    if (p.t < 1500) continue;
    const h = hostCopy.findLast((c) => c.t <= p.t);
    if (h) sameTime.push(Math.hypot(h.x - p.x, h.y - p.y));
  }
  let offPath = 0;
  const traced = guests[0].path;
  for (const h of hostCopy) {
    if (h.t < 1500 || h.t > end - 500) continue;
    let best = Infinity;
    for (let i = 1; i < traced.length; i++) best = Math.min(best, segmentDistance(h, traced[i - 1], traced[i]));
    offPath = Math.max(offPath, best);
  }
  const uneven = remote.map((frames) => {
    let off = 0;
    for (const f of frames) {
      const speed = Math.hypot(f.dx, f.dy) / f.dt;
      if (Math.min(Math.abs(speed - SPEED), Math.abs(speed - BOOST_SPEED)) > SPEED * 0.3) off++;
    }
    return off / Math.max(1, frames.length);
  }) as [number, number];
  const remoteBackward = remote.flat().filter((f) => f.dx * Math.cos(f.a) + f.dy * Math.sin(f.a) < -0.5).length;
  const mean = (list: number[]) => list.reduce((sum, n) => sum + n, 0) / Math.max(1, list.length);
  return {
    turnFrames: [mean(turnFrames), Math.max(...turnFrames)],
    ownBackward,
    sameTime: [mean(sameTime), Math.max(...sameTime)],
    offPath,
    uneven,
    remoteBackward,
  };
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const k = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - dx * k, p.y - a.y - dy * k);
}

const LINKS: [string, Link, boolean][] = [
  ['60 ms round trip, 20 ms jitter, 1% loss', { latency: 25, jitter: 20, loss: 0.01 }, false],
  ['150 ms round trip, 40 ms jitter, 2% loss', { latency: 60, jitter: 40, loss: 0.02 }, false],
  ['150 ms round trip, 40 ms jitter, 2% loss, frame hitches', { latency: 60, jitter: 40, loss: 0.02 }, true],
];

const show = (m: Metrics) => [
  `turn after ${m.turnFrames[0].toFixed(1)} frames (max ${m.turnFrames[1]})`,
  `own backward ${m.ownBackward}`,
  `host copy off by ${m.sameTime[0].toFixed(1)} px (max ${m.sameTime[1].toFixed(1)}), off path ${m.offPath.toFixed(2)} px`,
  `remote uneven ${(m.uneven[0] * 100).toFixed(1)}% / ${(m.uneven[1] * 100).toFixed(1)}%, remote backward ${m.remoteBackward}`,
].join('; ');

test('over a slow jittery link a guest steers its own snake at once, never pulled back, and sees the rest move evenly', (t: TestContext) => {
  for (const [name, link, hitches] of LINKS) {
    const before = run('old', link, hitches);
    const after = run('new', link, hitches);
    t.diagnostic(`${name}`);
    t.diagnostic(`  before: ${show(before)}`);
    t.diagnostic(`  after:  ${show(after)}`);
    // the guest's own snake turns on the next frame or the one after (the world moves in 30 Hz ticks), not a round trip later
    assert.ok(after.turnFrames[1] <= 2, `own turn shows within 2 frames, took ${after.turnFrames[1]}`);
    assert.ok(before.turnFrames[0] > after.turnFrames[0] + 8);
    assert.equal(after.ownBackward, 0);
    // the host walks the path the guest took, a moment behind it (a tick it carried on for a missing point can be a
    // pixel or so off where the guest went)
    assert.ok(after.offPath < 2, `host copy strays ${after.offPath.toFixed(2)} px from the guest's own path`);
    assert.ok(after.sameTime[0] < before.sameTime[0]);
    assert.equal(after.remoteBackward, 0);
    assert.ok(after.uneven[0] < before.uneven[0] && after.uneven[1] < before.uneven[1]);
    // (a page that stalls for a frame stalls what it shows of everyone, and the host's view of its snake)
    if (!hitches) assert.ok(after.uneven[0] < 0.05 && after.uneven[1] < 0.05, `remote snakes uneven on ${show(after)}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The pieces

function oneSnake(mass = 20) {
  const world = createWorld({ seed: 3, radius: 3000, fillPellets: false });
  world.pelletTarget = 0;
  return { world, snake: place(world, 1, 0, 0, 0, mass) };
}

/** A guest's own report of ticks first..first+count-1 under `input`, from a copy of `snake`. */
function reported(snake: Snake, ticks: number, input: Input, warp = 0) {
  const { world: copyWorld, snake: copy } = oneSnake(snake.mass);
  Object.assign(copy, { x: snake.x, y: snake.y, angle: snake.angle, body: snake.body.slice() });
  const own = new OwnSnake();
  own.fromHost(copy, [copy.id, copy.x, copy.y, copy.angle, copy.mass, true, 0, false, 0, 0, copy.mass], warp);
  const reports = [];
  for (let i = 0; i < ticks; i++) {
    own.tick(copyWorld, copy, input, i * TICK);
    reports.push(own.report(i * TICK));
  }
  return { reports, copy };
}

test('the host walks a guest along the path it reported, judging crashes and pellets at every point', () => {
  const { world, snake } = oneSnake();
  const heads = new HostHeads();
  const { reports, copy } = reported(snake, 9, { target: 1, boost: false });
  // three packets of three ticks each arrive in one burst
  for (const report of [reports[2], reports[5], reports[8]]) heads.receive(1, { target: 1, boost: false, ...report }, 0);
  const input = heads.input(snake, 0);
  assert.equal(input.path?.length, 9);
  step(world, { 1: input });
  assert.ok(Math.hypot(snake.x - copy.x, snake.y - copy.y) < 0.02, 'the host copy ends where the guest is');
  assert.ok(Math.abs(angleDiff(snake.angle, copy.angle)) < 1e-3);

  // a pellet passed mid-burst is eaten, and a body crossed mid-burst kills (neither is near where the burst ends)
  const burst = (setup: (world: World) => void) => {
    const run2 = oneSnake();
    setup(run2.world);
    const h2 = new HostHeads();
    h2.receive(1, { target: 0, boost: false, ...reported(run2.snake, 9, { target: 0, boost: false }).reports[8] }, 0);
    return { snake: run2.snake, events: step(run2.world, { 1: h2.input(run2.snake, 0) }) };
  };
  let pellet = 0;
  const fed = burst((w) => {
    pellet = addPellet(w, { x: 20, y: 0 }, false, 1).id;
  });
  assert.ok(fed.events.some((e) => e.type === 'eat' && e.pellet === pellet));
  const crossed = burst((w) => {
    const crossing = place(w, 2, 22, -60, Math.PI / 2, 10);
    crossing.body = Array.from({ length: 30 }, (_, i) => ({ x: 22, y: 56 - i * 4 }));
  });
  assert.equal(crossed.snake.alive, false, 'its head crossed a body between ticks the host saw');
});

test('the host holds a reported path to what the snake could do, and ignores reports about an older warp', () => {
  const { world, snake } = oneSnake();
  const heads = new HostHeads();
  heads.receive(1, { target: 0, boost: false, n: 1, w: 0, p: [5, 0, 0, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.ok(Math.abs(snake.x - 5) < 1e-9);
  // too far for a tick: no further than its speed (with a little slack), straight on
  heads.receive(1, { target: 0, boost: false, n: 2, w: 0, p: [40, 0, 0, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.ok(snake.x - 5 <= SPEED * TICK * 1.15 + 0.5 + 1e-9 && snake.x - 5 > SPEED * TICK);
  // too sharp: no sharper than its turn rate
  const x = snake.x;
  heads.receive(1, { target: 0, boost: false, n: 3, w: 0, p: [x, 5, Math.PI / 2, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.ok(Math.abs(snake.angle) <= maxTurnRate(snake) * TICK * 1.15 + 0.02 + 1e-9);
  // a boost the host's copy of its mass doesn't allow moves it at normal speed
  snake.mass = 8;
  const y = snake.y;
  const x2 = snake.x;
  heads.receive(1, { target: 0, boost: true, n: 4, w: 0, p: [x2 + 10, y, snake.angle, 1] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.ok(Math.hypot(snake.x - x2, snake.y - y) <= SPEED * TICK * 1.15 + 0.5 + 1e-9);
  // a report about the snake before the host moved it again is dropped
  heads.moved(1);
  const held = { x: snake.x, y: snake.y };
  heads.receive(1, { target: 0, boost: false, n: 5, w: 0, p: [snake.x + 5, snake.y, 0, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.deepEqual({ x: snake.x, y: snake.y }, held);
  // a point way off what the rules allow bumps the warp, so the guest picks up from the host's copy
  heads.receive(1, { target: 0, boost: false, n: 6, w: 1, p: [snake.x + 5, snake.y, 0, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  heads.receive(1, { target: 0, boost: false, n: 7, w: 1, p: [snake.x + 400, snake.y, 0, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.equal(heads.warp(1), 2);
});

test('a guest\'s missing point is carried on for a tick, and a guest gone quiet is steered by its last word', () => {
  const { world, snake } = oneSnake();
  const heads = new HostHeads();
  heads.receive(1, { target: 0.5, boost: false, n: 1, w: 0, p: [5, 0, 0, 0] }, 0);
  step(world, { 1: heads.input(snake, 0) });
  assert.equal(snake.x, 5);
  // the next point is due and hasn't come (a lost packet): it carries on a tick the way it was going...
  step(world, { 1: heads.input(snake, 0.05) });
  assert.ok(Math.abs(snake.x - 10) < 1e-9);
  // ...and when that point comes with the next one, it skips it rather than stepping back
  heads.receive(1, { target: 0.5, boost: false, n: 3, w: 0, p: [5, 0, 0, 0, 10.2, 0, 0, 0, 15.2, 0, 0, 0] }, 0.07);
  const caught = heads.input(snake, 0.07);
  assert.deepEqual(caught.path?.map((point) => point.x), [15.2]);
  step(world, { 1: caught });
  // with nothing more coming, it carries on one tick at most, then holds still
  step(world, { 1: heads.input(snake, 0.2) });
  const x = snake.x;
  assert.ok(Math.abs(x - 20.2) < 1e-9);
  step(world, { 1: heads.input(snake, 0.3) });
  step(world, { 1: heads.input(snake, 0.4) });
  assert.equal(snake.x, x);
  // gone quiet: steered by where it last said it was steering, and the guest is told to pick up from there
  const input = heads.input(snake, 0.07 + QUIET + 0.01);
  assert.equal(input.path, undefined);
  assert.equal(input.target, 0.5);
  assert.equal(heads.warp(1), 1);
  // an older guest (no reports) is steered by its target all along
  const old = new HostHeads();
  old.receive(1, { target: 0.3, boost: true }, 0);
  assert.deepEqual(old.input(snake, 0), { target: 0.3, boost: true });
});

test('a guest keeps its own snake where it has it, and takes the host\'s position only when the warp goes up', () => {
  const { world, snake } = oneSnake();
  const own = new OwnSnake();
  const row = (x: number, alive = true, mass = 20): SnakeState => [1, x, 0, 0, mass, alive, 2, false, 150, 0, 25];
  assert.equal(own.moving, false);
  assert.equal(own.fromHost(snake, row(100), undefined), false, 'an older host never hands the snake over');
  assert.equal(own.moving, false);
  assert.equal(own.fromHost(snake, row(0), 0), true);
  assert.equal(own.moving, true);
  for (let i = 0; i < 6; i++) own.tick(world, snake, { target: 0, boost: false }, 0);
  const x = snake.x;
  // the host's (older) view of our snake changes length and score, never where it is
  own.fromHost(snake, row(x - 20, true, 26), 0);
  assert.equal(snake.x, x);
  assert.equal(snake.mass, 26);
  assert.equal(snake.kills, 2);
  // dead on the host is dead here; then a respawn (warp up) puts it where the host spawned it
  own.fromHost(snake, row(x, false), 0);
  assert.equal(snake.alive, false);
  assert.equal(own.fromHost(snake, row(-700), 1), true);
  assert.equal(snake.alive, true);
  assert.equal(snake.x, -700);
  assert.equal(snake.body.length, bodyCount(snake.mass));
  assert.equal(own.report(0).w, 1);
  // a state from before that warp, arriving late, is old news
  assert.equal(own.fromHost(snake, row(x, false), 0), false);
  assert.equal(snake.alive, true);
});

test('a guest hides pellets its own snake eats right away, and brings them back if the host never takes them', () => {
  const { world, snake } = oneSnake();
  const own = new OwnSnake();
  own.fromHost(snake, [1, 0, 0, 0, 20, true, 0, false, 0, 0, 20], 0);
  const a = addPellet(world, { x: 12, y: 0 }, false, 1);
  const b = addPellet(world, { x: 14, y: 2 }, false, 1);
  assert.equal(own.tick(world, snake, { target: 0, boost: false }, 10), 2);
  assert.equal(world.pellets.length, 0);
  own.removed(a.id);
  own.expire(world, 10.5);
  assert.equal(world.pellets.length, 0);
  own.expire(world, 12);
  assert.deepEqual(world.pellets.map((p) => p.id), [b.id]);
});

test('others are drawn on the host clock between states, and a respawn jumps rather than sliding', () => {
  const clock = new HostClock();
  const states = new StateBuffer();
  const row = (x: number): SnakeState => [0, x, 0, 0, 10, true, 0, false, 150, 0, 10];
  // states 50 ms apart on the host, arriving bunched and late
  clock.heard(0, 10.03);
  states.push({ t: 0, snakes: [row(0)] });
  clock.heard(0.05, 10.2);
  states.push({ t: 0.05, snakes: [row(7.5)] });
  clock.heard(0.1, 10.13);
  states.push({ t: 0.1, snakes: [row(15)] });
  assert.ok(Math.abs(clock.at(10.13)! - 0.1) < 1e-9, 'the least delayed state sets the clock');
  assert.ok(Math.abs(states.at(0.075)!.snakes[0][1] - 11.25) < 1e-9);
  // an older state arriving late is dropped
  states.push({ t: 0.06, snakes: [row(999)] });
  assert.equal(states.size, 3);
  const jump = interpolateStates({ t: 0, snakes: [row(0)] }, { t: 1, snakes: [row(900)] }, 0.4);
  assert.equal(jump[0][1], 0);
});

test('move and state packets carry the new fields optionally, and both shapes parse', (t: TestContext) => {
  const world = createWorld({ seed: 2, radius: 3000, fillPellets: false });
  world.pelletTarget = 0;
  for (let i = 0; i < 16; i++) place(world, i, i * 150 - 1200, 30, 0.3, 40 + i * 17);
  for (let i = 0; i < 20; i++) step(world, world.snakes.map((snake) => ({ target: snake.angle + 0.37, boost: snake.id % 3 === 0 })));
  const plain = parsePacket(JSON.parse(JSON.stringify(statePacket(3, world))));
  assert.ok(plain?.k === 'S' && plain.w === undefined && plain.snakes.every((row) => row.length === 11));
  const warped = parsePacket(JSON.parse(JSON.stringify(statePacket(3, world, [4, 1]))));
  assert.ok(warped?.k === 'S' && warped.w?.length === 16 && warped.w[0] === 4 && warped.w[2] === 0);
  // 16 snakes at 20 a second cost no more than the full-precision states did at 12
  const now = JSON.stringify(statePacket(3, world, new Array(16).fill(0))).length;
  const was = JSON.stringify({ t: 'sl', r: 3, k: 'S', tick: world.tick, clock: world.clock, snakes: world.snakes.map((s) => [s.id, s.x, s.y, s.angle, s.mass, s.alive, s.kills, s.boosting, s.vx, s.vy, s.peak]) }).length;
  t.diagnostic(`state for 16 snakes: ${was} bytes before (x12/s = ${(was * 12 / 1024).toFixed(1)} KB/s a guest), ${now} after (x20/s = ${(now * 20 / 1024).toFixed(1)} KB/s)`);
  assert.ok(now * 20 <= was * 12);
  assert.equal(parsePacket({ ...statePacket(3, world), w: [1, 2] }), null);
  const report = { n: 12, w: 0, p: [1.25, -3.5, 0.5, 1, 2.5, -3, 0.52, 1] };
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(movePacket(3, 7, 0.5, true, report)))), { t: 'sl', r: 3, k: 'M', seq: 7, target: 0.5, boost: true, ...report });
  assert.deepEqual(parsePacket(movePacket(3, 7, 0.5, true, { n: 0, w: -1, p: [] })), { t: 'sl', r: 3, k: 'M', seq: 7, target: 0.5, boost: true, n: 0, w: -1, p: [] });
  for (const p of [[1, 2, 3], [1, 2, 0.5, 2], [9000, 0, 0, 0], new Array(16).fill(0)]) {
    assert.equal(parsePacket({ ...movePacket(3, 7, 0.5, true), n: 1, w: 0, p }), null);
  }
  assert.equal(parsePacket({ ...movePacket(3, 7, 0.5, true), n: 1, p: [] }), null, 'a report comes whole');
});
