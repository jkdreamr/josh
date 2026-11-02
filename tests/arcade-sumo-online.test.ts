// Sumo online: a host and a guest over a slow, jittery link, each run the way the game runs it, with the old netcode
// (the guest eased its own car toward the host's stale word every state, drew everyone else where the latest state put
// them and stepped on the frame's capped dt) and the new (netsync: the host plays the guest's stick step for step, the
// guest forecasts the host's game from each state). Prints what a guest would feel with both, and holds the new to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { think } from '../src/os/arcade/games/sumo/ai.ts';
import { STEP, createWorld, noInput, step, stepOnce, type Input, type World } from '../src/os/arcade/games/sumo/logic.ts';
import { CAR_BOT, CAR_DASH, CAR_FALLING, CAR_IN, CAR_LEFT, CAR_OUT, hostState, inputOf, parsePacket, wireInput, type PackedCar, type StateNet, type StatePacket } from '../src/os/arcade/games/sumo/net.ts';
import { GuestNet, GuestStick, Glide, HostNet, KEYFRAME, Pacer, applyHead, easeOwn, pace, stepsAt } from '../src/os/arcade/games/sumo/netsync.ts';

type Script = (t: number) => Input;
type Options = {
  logic: 'old' | 'new';
  /** One way, in ms, plus up to `jitter` more; `loss`: the share of fast packets lost. */
  latency: number;
  jitter: number;
  loss?: number;
  hostFrame?: number;
  guestFrame?: number;
  guest: Script;
  host?: Script;
  seconds: number;
  seed?: number;
  /** Bots the host drives too (seats 2 on). */
  bots?: number;
  /** Called after every host frame and guest frame (new netcode), to watch more than the frames record. */
  watch?: (side: 'host' | 'guest', world: World) => void;
};
type Pose = { x: number; z: number };
/** `ideal`: where the guest's own stick alone puts its car (the same frames, no network). */
/** `down`: each car falling or in the water. */
/** `fix`: how far the guest's own car was drawn off its forecast (what's left of a correction; new netcode only). */
type GuestFrame = { t: number; own: Pose; ideal: Pose; other: Pose; input: Input; fight: boolean; down: boolean[]; fix: number };
type HostFrame = { t: number; guest: Pose; host: Pose; down: boolean[] };
const sunk = (world: World) => world.cars.map((car) => car.falling || car.out);

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

/** A tiny event queue on a pretend clock (ms). */
class Clock {
  now = 0;
  private queue: { at: number; order: number; run: () => void }[] = [];
  private order = 0;
  at(at: number, run: () => void) {
    const entry = { at, order: this.order++, run };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].at > at || (this.queue[i - 1].at === at && this.queue[i - 1].order > entry.order))) i--;
    this.queue.splice(i, 0, entry);
  }
  every(ms: number, start: number, run: () => void, until: number) {
    for (let t = start; t <= until; t += ms) this.at(t, run);
  }
  run(until: number) {
    while (this.queue.length && this.queue[0].at <= until) {
      const next = this.queue.shift()!;
      this.now = next.at;
      next.run();
    }
  }
}

/** One way of a connection: fast packets each on their own (and some lost), reliable ones in order. */
class Wire {
  private lastReliable = 0;
  private clock: Clock;
  private o: Options;
  private rand: () => number;
  constructor(clock: Clock, o: Options, rand: () => number) {
    this.clock = clock;
    this.o = o;
    this.rand = rand;
  }
  send(data: unknown, reliable: boolean, deliver: (data: unknown) => void) {
    const copy = JSON.parse(JSON.stringify(data));
    const delay = this.o.latency + this.rand() * this.o.jitter;
    if (!reliable && this.rand() < (this.o.loss ?? 0)) return;
    let at = this.clock.now + delay;
    if (reliable) at = this.lastReliable = Math.max(this.lastReliable, at);
    this.clock.at(at, () => deliver(copy));
  }
}

const roster = [
  { seat: 0, color: 0, ai: null, name: 'Host' },
  { seat: 1, color: 1, ai: null, name: 'Guest' },
];
const GUEST = 1;
const HOST = 0;

function packCars(world: World): PackedCar[] {
  return world.cars.map((car) => ({
    x: car.x, z: car.z, y: car.y, vx: car.vx, vz: car.vz, yaw: car.yaw, charge: car.charge,
    flags: (car.out ? CAR_OUT : CAR_IN) | (car.falling ? CAR_FALLING : 0) | (car.dashT > 0 ? CAR_DASH : 0) | (car.ai !== null ? CAR_BOT : 0) | (car.left ? CAR_LEFT : 0),
  }));
}

function stateOf(world: World, net?: HostNet) {
  const tm = world.phase === 'count' || world.phase === 'over' ? world.timer : world.fightTime;
  return hostState(1, world.phase, tm, world.radius, world.round, world.wins, world.cars.map((car) => car.seat), 1, packCars(world), world.cars.map((car) => car.name), net?.state(world));
}

/** Runs a match's opening (countdown, then the scripts from 3.5 s) and records what each side showed. */
function run(o: Options) {
  const clock = new Clock();
  const rand = rng(o.seed ?? 7);
  const up = new Wire(clock, o, rand);
  const down = new Wire(clock, o, rand);
  const hostScript = o.host ?? (() => noInput());
  const until = o.seconds * 1000;
  const cars = [...roster, ...Array.from({ length: o.bots ?? 0 }, (_, i) => ({ seat: i + 2, color: i + 2, ai: 1 as const, name: `Bot ${i + 1}` }))];
  const hostWorld = createWorld(cars, 1);
  const guestWorld = createWorld(cars, 1);
  const guestFrames: GuestFrame[] = [];
  const hostFrames: HostFrame[] = [];
  const seconds = () => clock.now / 1000;
  const own = (): Pose => ({ x: guestWorld.cars[GUEST].x, z: guestWorld.cars[GUEST].z });
  // (the guest's own stick on its own, with no host: where its car goes when nobody touches it)
  const idealWorld = createWorld(roster, 1);
  const idealNet = new GuestNet();
  const idealPacer = new Pacer(0);
  const ideal = (input: Input): Pose => {
    idealNet.advance(idealWorld, idealPacer.due(seconds()), GUEST, input);
    const drawn = idealNet.drawn(idealWorld)[GUEST];
    return { x: drawn.x, z: drawn.z };
  };

  if (o.logic === 'old') {
    // the host, as index.tsx had it: each guest's latest stick, the frame's capped dt, caught up from a timer
    let remote = noInput();
    let lastSimWall = 0;
    let ticks = 0;
    const update = (dt: number) => {
      step(hostWorld, [hostScript(seconds()), remote], dt);
      lastSimWall = seconds();
    };
    let lastHost = 0;
    clock.every(o.hostFrame ?? 1000 / 60, 3, () => {
      update(Math.min(0.05, seconds() - lastHost));
      lastHost = seconds();
      hostFrames.push({ t: clock.now, guest: { x: hostWorld.cars[GUEST].x, z: hostWorld.cars[GUEST].z }, host: { x: hostWorld.cars[HOST].x, z: hostWorld.cars[HOST].z }, down: sunk(hostWorld) });
    }, until);
    clock.every(50, 1, () => {
      let catchup = seconds() - lastSimWall;
      if (catchup > 0.08) {
        while (catchup > 0.001) {
          const part = Math.min(0.25, catchup);
          update(part);
          catchup -= part;
        }
        lastSimWall = seconds();
      }
      ticks++;
      down.send(stateOf(hostWorld), ticks % 5 === 0, (data) => {
        const packet = parsePacket(data) as StatePacket;
        applyHead(guestWorld, packet);
        packet.cars.forEach((packed, i) => {
          const car = guestWorld.cars[i];
          if (i === GUEST) easeOwn(car, packed);
          else {
            car.x = packed.x;
            car.z = packed.z;
            car.vx = packed.vx;
            car.vz = packed.vz;
          }
          car.y = packed.y;
          car.yaw = packed.yaw;
          car.charge = packed.charge;
          car.falling = !!(packed.flags & CAR_FALLING);
          car.out = !!(packed.flags & CAR_OUT);
          car.dashT = packed.flags & CAR_DASH ? 0.2 : 0;
        });
      });
    }, until);
    clock.every(50, 2, () => {
      const input = o.guest(seconds());
      up.send(inputOf(1, input), false, (data) => {
        const packet = parsePacket(data);
        if (packet?.k === 'i') remote = { x: packet.x, y: packet.y, dash: packet.d };
      });
    }, until);
    // the guest: its own car forecast on the frame's capped dt, everyone else coasting
    let lastGuest = 0;
    clock.every(o.guestFrame ?? 1000 / 60, 5, () => {
      const dt = Math.min(0.05, seconds() - lastGuest);
      lastGuest = seconds();
      const input = o.guest(seconds());
      step(guestWorld, [noInput(), input], dt, { authoritative: false });
      guestFrames.push({ t: clock.now, own: own(), ideal: ideal(wireInput(input)), other: { x: guestWorld.cars[HOST].x, z: guestWorld.cars[HOST].z }, input, fight: guestWorld.phase === 'fight', down: sunk(guestWorld), fix: 0 });
    }, until);
  } else {
    const hostNet = new HostNet();
    const hostPacer = new Pacer(0);
    let ticks = 0;
    const update = () => {
      const input = hostScript(seconds());
      pace(hostWorld, hostPacer.due(seconds()), () => hostNet.tick(hostWorld, (car) => (car.ai !== null ? think(hostWorld, car.id, car.ai) : car.seat === 0 ? input : null)));
      o.watch?.('host', hostWorld);
    };
    clock.every(o.hostFrame ?? 1000 / 60, 3, () => {
      update();
      hostFrames.push({ t: clock.now, guest: { x: hostWorld.cars[GUEST].x, z: hostWorld.cars[GUEST].z }, host: { x: hostWorld.cars[HOST].x, z: hostWorld.cars[HOST].z }, down: sunk(hostWorld) });
    }, until);
    const guestNet = new GuestNet();
    const guestPacer = new Pacer(0);
    clock.every(50, 1, () => {
      if (hostPacer.since(seconds()) > 0.08) update();
      ticks++;
      down.send(stateOf(hostWorld, hostNet), ticks % KEYFRAME === 0, (data) => {
        const packet = parsePacket(data) as StatePacket;
        if (packet.n === undefined || guestNet.stale(packet.n)) return;
        guestNet.receive(guestWorld, packet as StatePacket & StateNet, GUEST);
      });
    }, until);
    const guestUpdate = () => {
      const dt = guestPacer.due(seconds());
      const input = wireInput(o.guest(seconds()));
      guestNet.advance(guestWorld, dt, GUEST, input);
      const out = guestNet.outgoing(clock.now);
      if (out) {
        const packet = inputOf(1, out.stick, out.steps);
        const hear = (data: unknown) => {
          const parsed = parsePacket(data);
          if (parsed?.k === 'i') hostNet.hear(1, parsed, stepsAt(hostWorld, hostPacer, seconds()));
        };
        up.send(packet, false, hear);
        if (out.dash) up.send(packet, true, hear);
      }
      guestNet.fade(dt);
      o.watch?.('guest', guestWorld);
      const drawn = guestNet.drawn(guestWorld);
      const car = guestWorld.cars[GUEST];
      const on = guestWorld.phase === 'fight' && !car.out ? guestWorld.acc : 0;
      const fix = Math.hypot(drawn[GUEST].x - car.x - car.vx * on, drawn[GUEST].z - car.z - car.vz * on);
      guestFrames.push({ t: clock.now, own: { x: drawn[GUEST].x, z: drawn[GUEST].z }, ideal: ideal(input), other: { x: drawn[HOST].x, z: drawn[HOST].z }, input, fight: guestWorld.phase === 'fight', down: sunk(guestWorld), fix });
    };
    clock.every(o.guestFrame ?? 1000 / 60, 5, guestUpdate, until);
    clock.every(50, 2, () => {
      if (guestPacer.since(seconds()) > 0.08) guestUpdate();
    }, until);
  }
  clock.run(until);
  return { guestFrames, hostFrames, hostWorld, guestWorld };
}

/** Back and forth along z, a key at a time (each run long enough to reach full speed), from 3.5 s. */
const shuttle = (period = 0.9, start = 3.5): Script => (t) => {
  if (t < start) return noInput();
  const leg = Math.floor((t - start + period / 2) / period);
  return { x: 0, y: leg % 2 === 0 ? 1 : -1, dash: false };
};
/** A thumb going round on a touch stick: a new heading every frame. */
const circle = (start = 3.5): Script => (t) => {
  if (t < start) return noInput();
  const a = (t - start) * 3.5;
  return { x: Math.cos(a), y: Math.sin(a), dash: false };
};

/**
 * Pull-backs: frames (from 3.5 s) where the guest's car on screen fell back more than 5 mm against where its own stick
 * took it that frame (the ideal run's move), and the worst of them. Also how far behind its stick it was drawn.
 */
function pullBacks(frames: GuestFrame[], from = 3.5) {
  let count = 0;
  let worst = 0;
  let behind = 0;
  let behindWorst = 0;
  let n = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t / 1000 < from) continue;
    const [a, b] = [frames[i - 1], frames[i]];
    const ix = b.ideal.x - a.ideal.x;
    const iz = b.ideal.z - a.ideal.z;
    const length = Math.hypot(ix, iz);
    const off = Math.hypot(b.own.x - b.ideal.x, b.own.z - b.ideal.z);
    behind += off;
    behindWorst = Math.max(behindWorst, off);
    n++;
    if (length < 1e-4) continue;
    const back = -(((b.own.x - a.own.x) - ix) * ix + ((b.own.z - a.own.z) - iz) * iz) / length;
    if (back > 0.005) {
      count++;
      worst = Math.max(worst, back);
    }
  }
  return { count, worst, behind: behind / Math.max(1, n), behindWorst };
}

/**
 * Stutter: jolts in the host's car as the guest drew it, frames where the speed it was drawn moving at changed by 1.2
 * m/s more than the hardest turn could in that frame (40 m/s², so 1.9 m/s at 60 fps: a 3 cm hitch, a jump or a stall),
 * and the worst change (m/s). The host's car drives back and forth, turning at full lock with no bumps.
 */
function stutter(guest: GuestFrame[], from = 3.6) {
  let count = 0;
  let steady = 0;
  let worst = 0;
  for (let i = 2; i < guest.length; i++) {
    const t = guest[i].t / 1000;
    if (t < from) continue;
    const [a, b, c] = [guest[i - 2].other, guest[i - 1].other, guest[i].other];
    const dt = (guest[i].t - guest[i - 1].t) / 1000;
    const jolt = Math.hypot(c.x - 2 * b.x + a.x, c.z - 2 * b.z + a.z) / dt;
    if (jolt > 1.2 + 40 * dt) {
      count++;
      // (the second half of each of the host's legs: its stick held, at full speed, well after it last turned)
      if ((t - 3.6 + 0.55) % 1.1 > 0.55 + 0.2) steady++;
    }
    worst = Math.max(worst, jolt);
  }
  return { count, steady, worst };
}

/**
 * A car as the guest drew it against the host's own run, lined up by the delay (ms) that fits best: mean and worst
 * distance, from `from` seconds, while the car is on the float on both sides. `now`: the mean at no delay.
 */
function agreement(guest: GuestFrame[], host: HostFrame[], car: number, from: number) {
  const drawn = (frame: GuestFrame) => (car === GUEST ? frame.own : frame.other);
  const truth = (frame: HostFrame) => (car === GUEST ? frame.guest : frame.host);
  const hostAt = (t: number) => {
    const i = host.findIndex((frame) => frame.t >= t);
    if (i <= 0 || host[i].down[car] || host[i - 1].down[car]) return null;
    const a = host[i - 1];
    const b = host[i];
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return { x: truth(a).x + (truth(b).x - truth(a).x) * k, z: truth(a).z + (truth(b).z - truth(a).z) * k };
  };
  let best = { delay: 0, mean: Infinity, worst: 0 };
  let now = 0;
  for (let delay = 0; delay <= 400; delay += 5) {
    let sum = 0;
    let worst = 0;
    let count = 0;
    for (const frame of guest) {
      if (frame.t < from * 1000 || frame.down[car]) continue;
      const at = hostAt(frame.t + delay);
      if (!at) continue;
      const d = Math.hypot(drawn(frame).x - at.x, drawn(frame).z - at.z);
      sum += d;
      worst = Math.max(worst, d);
      count++;
    }
    const mean = sum / Math.max(1, count);
    if (delay === 0) now = mean;
    if (mean < best.mean) best = { delay, mean, worst };
  }
  return { ...best, now };
}

/** Frames from the first press until the drawn own car moved. */
function response(frames: GuestFrame[]) {
  const first = frames.findIndex((frame) => frame.input.x !== 0 || frame.input.y !== 0);
  const start = frames[first - 1]?.own ?? frames[first].own;
  for (let i = first; i < frames.length; i++) {
    if (Math.hypot(frames[i].own.x - start.x, frames[i].own.z - start.z) > 1e-3) return i - first + 1;
  }
  return Infinity;
}

const fmt = (n: number, digits = 3) => n.toFixed(digits);

function measure(o: Options) {
  const { guestFrames, hostFrames } = run(o);
  return {
    response: response(guestFrames),
    pull: pullBacks(guestFrames),
    agree: agreement(guestFrames, hostFrames, GUEST, 4.5),
    other: stutter(guestFrames),
  };
}

function report(label: string, o: Omit<Options, 'logic'>) {
  const results = { old: measure({ ...o, logic: 'old' }), new: measure({ ...o, logic: 'new' }) };
  console.log(`${label}\n${(['old', 'new'] as const).map((logic) => {
    const r = results[logic];
    return `  ${logic}: moves ${r.response} frame(s) after the press; pulled back ${r.pull.count}x (worst ${fmt(r.pull.worst)}); drawn ${fmt(r.pull.behind)} mean / ${fmt(r.pull.behindWorst)} worst off its own stick; host's copy ${fmt(r.agree.mean)} mean / ${fmt(r.agree.worst)} worst off the guest's (best fit ${r.agree.delay} ms behind; ${fmt(r.agree.now)} at the same instant); other car jolted ${r.other.count}x, ${r.other.steady} while steady (worst ${fmt(r.other.worst, 1)} m/s)`;
  }).join('\n')}`);
  return results;
}

const hostShuttle: Script = (t) => (t < 3.6 ? noInput() : { x: 0, y: Math.floor((t - 3.6 + 0.55) / 1.1) % 2 === 0 ? -1 : 1, dash: false });

test('a guest drives with no pull-back over 60 to 150 ms round trips, on the old netcode and the new', { timeout: 120_000 }, () => {
  for (const [latency, jitter] of [[30, 20], [75, 30]] as const) {
    const o = { latency, jitter, loss: 0.02, seconds: 11, host: hostShuttle };
    const keys = report(`keys, ${latency * 2} ms round trip, ${jitter} ms jitter, 2% loss`, { ...o, guest: shuttle() });
    const touch = report(`touch circle, ${latency * 2} ms round trip, ${jitter} ms jitter, 2% loss`, { ...o, guest: circle() });
    const slow = report(`keys, 15 fps guest, ${latency * 2} ms round trip, ${jitter} ms jitter, 2% loss`, { ...o, guest: shuttle(), guestFrame: 1000 / 15 });
    const fast = report(`keys, 144 Hz guest, ${latency * 2} ms round trip, ${jitter} ms jitter, 2% loss`, { ...o, guest: shuttle(), guestFrame: 1000 / 144 });
    const slowHost = report(`keys, 15 fps host, ${latency * 2} ms round trip, ${jitter} ms jitter, 2% loss`, { ...o, guest: shuttle(), hostFrame: 1000 / 15 });
    for (const r of [keys.new, touch.new, slow.new, fast.new, slowHost.new]) {
      // (at 144 Hz, some frames run no 60 Hz step: the car moves within one step, 17 ms, either way)
      assert.ok(r.response <= (r === fast.new ? 3 : 1), `the guest's own car moved ${r.response} frames after the press`);
      assert.equal(r.pull.count, 0, `the guest's own car was pulled back ${r.pull.count} times`);
      assert.ok(r.pull.behindWorst < 0.05, `the guest's own car was drawn ${r.pull.behindWorst} off its stick`);
      assert.ok(r.agree.mean < 0.01, `the host's copy is ${r.agree.mean} from the guest's car`);
      assert.equal(r.other.steady, 0, `the host's car jolted ${r.other.steady} times on the guest's screen while driving steadily`);
      // (a 15 fps frame takes in most of a correction at once)
      assert.ok(r.other.worst < (r === slow.new ? slow.old.other.worst : 6), `the host's car jolted by ${r.other.worst} m/s on the guest's screen`);
    }
    // what the old netcode did: pulled the guest's car back toward the host's stale word, and the host's car stuttered
    assert.ok(keys.old.pull.count > 50 && slow.old.pull.count > 20 && slowHost.old.pull.count > 50);
    assert.ok(keys.new.other.count * 5 < keys.old.other.count);
  }
});

/** Sticks held from given moments (seconds), in order, the last to the end. */
const moves = (...legs: [number, Input][]): Script => (t) => {
  let input = noInput();
  for (const [from, stick] of legs) if (t >= from) input = stick;
  return input;
};
const firstDown = (frames: { t: number; down: boolean[] }[], car: number) => frames.find((frame) => frame.down[car])?.t ?? Infinity;

test('a guest dashes the host\'s parked car off the float: the host\'s car goes where the guest saw it go', () => {
  const guest = moves([3.5, { x: 1, y: 0, dash: false }], [4.3, { x: 1, y: 0, dash: true }], [4.75, { x: 1, y: 0, dash: false }], [5.3, noInput()]);
  for (const [latency, jitter] of [[30, 20], [75, 30]] as const) {
    const lines: string[] = [];
    for (const logic of ['old', 'new'] as const) {
      const { guestFrames, hostFrames, hostWorld, guestWorld } = run({ logic, latency, jitter, loss: 0.02, seconds: 7.5, guest });
      const hit = agreement(guestFrames, hostFrames, HOST, 4.5);
      const shown = firstDown(guestFrames, HOST);
      const fell = firstDown(hostFrames, HOST);
      lines.push(`  ${logic}: host's car as the guest drew it ${fmt(hit.mean)} mean / ${fmt(hit.worst)} worst off the host's (best fit ${hit.delay} ms); it fell on the host at ${fell.toFixed(0)} ms and on the guest's screen at ${shown.toFixed(0)} ms`);
      // the host calls it, and the guest's game says the same
      assert.equal(hostWorld.cars[HOST].out, true, `${logic}: the host's car stayed on the float`);
      assert.equal(hostWorld.roundWinner, GUEST);
      assert.equal(guestWorld.roundWinner, GUEST);
      if (logic === 'new') {
        assert.ok(hit.mean < 0.02 && hit.worst < 0.1, `the host's car was drawn ${hit.mean} (worst ${hit.worst}) off where it went`);
        // the guest sees its bump land at once (a lag ahead of the host, rather than a round trip behind)
        assert.ok(shown < fell, `the guest saw the fall at ${shown}, the host had it at ${fell}`);
      }
    }
    console.log(`the guest dashes the parked host off, ${latency * 2} ms round trip:\n${lines.join('\n')}`);
  }
});

test('the host turns late into a parked guest and shoves it off: the guest takes the hit, and both agree on the ring-out', () => {
  // the host starts off past the guest, then swings in at it: the guest's forecast has it going by, until it turns
  const host = moves([3.5, { x: -0.8, y: 0.6, dash: false }], [4, { x: -0.6, y: -0.8, dash: false }], [4.45, { x: -1, y: 0, dash: false }], [5.3, { x: -1, y: 0.3, dash: false }]);
  for (const [latency, jitter] of [[30, 20], [75, 30]] as const) {
    const lines: string[] = [];
    for (const logic of ['old', 'new'] as const) {
      const { guestFrames, hostFrames, hostWorld, guestWorld } = run({ logic, latency, jitter, loss: 0.02, seconds: 8.5, guest: () => noInput(), host });
      const hitAt = hostFrames.find((frame) => Math.hypot(frame.guest.x + 6.12, frame.guest.z) > 0.05)?.t ?? Infinity;
      const after = agreement(guestFrames, hostFrames, GUEST, hitAt / 1000 + 0.4);
      lines.push(`  ${logic}: hit on the host at ${hitAt.toFixed(0)} ms; from 0.4 s after, the guest's car ${fmt(after.mean)} mean / ${fmt(after.worst)} worst off the host's copy (best fit ${after.delay} ms); it fell on the host at ${firstDown(hostFrames, GUEST).toFixed(0)} ms, on the guest's screen at ${firstDown(guestFrames, GUEST).toFixed(0)} ms`);
      assert.ok(hitAt < 6000, `${logic}: the host never reached the guest`);
      assert.equal(hostWorld.cars[GUEST].out, true, `${logic}: the guest stayed on the float`);
      assert.equal(hostWorld.roundWinner, HOST);
      assert.equal(guestWorld.roundWinner, HOST);
      if (logic === 'new') assert.ok(after.mean < 0.02, `after the hit the guest's car is ${after.mean} off the host's copy`);
    }
    console.log(`the host turns late into the guest, ${latency * 2} ms round trip:\n${lines.join('\n')}`);
  }
});

test('newer packets carry what the forecast needs in optional fields, and older ones still parse', () => {
  const world = createWorld(roster, 3);
  // a car that has spun round a few times and one knocked very fast: held to what parsePacket takes, not thrown away
  world.cars[0].yaw = 20;
  world.cars[1].vx = 64;
  const net = new HostNet();
  net.tick(world, () => noInput());
  const sent = stateOf(world, net);
  const packet = parsePacket(JSON.parse(JSON.stringify(sent))) as StatePacket;
  assert.equal(packet.k, 'S');
  assert.equal(packet.n, 1);
  assert.deepEqual(packet.ak, [-1, -1]);
  assert.ok(Math.abs(packet.cars[0].yaw) <= Math.PI && packet.cars[1].vx === 50);
  // what an older guest reads of it is all still there and valid: every new field sits beside the old ones
  const { n: _n, ak: _ak, ci: _ci, cx: _cx, ...older } = sent as Record<string, unknown>;
  assert.deepEqual(parsePacket(older), (({ n, ak, ci, cx, ...rest }) => rest)(packet));
  // an older host's state (no step) parses, and half a newer one doesn't
  assert.equal(parsePacket(older)?.k, 'S');
  assert.equal(parsePacket({ ...older, n: 4 }), null);
  assert.equal(parsePacket({ ...sent, ak: [0] }), null);
  assert.equal(parsePacket({ ...sent, ci: [[2, 0, 0], [0, 0, 0]] }), null);
  // a guest's stick: an older host reads x, y, d as ever; a newer one also its step and latest changes
  const stick = inputOf(1, { x: 0.7071, y: 0.7071, dash: true }, { q: 40, h: [[31, 0, 1, 0], [40, 0.71, 0.71, 1]] });
  assert.deepEqual(parsePacket(stick), { k: 'i', r: 1, x: 0.71, y: 0.71, d: true, q: 40, h: [[31, 0, 1, 0], [40, 0.71, 0.71, 1]] });
  assert.deepEqual(parsePacket(inputOf(1, { x: 1, y: 0, dash: false })), { k: 'i', r: 1, x: 1, y: 0, d: false });
  assert.equal(parsePacket({ ...stick, h: [[41, 0, 0, 0]] }), null);
  assert.equal(parsePacket({ ...stick, h: [[40, 0, 0, 0], [31, 0, 0, 0]] }), null);
  assert.equal(parsePacket({ ...stick, q: -1 }), null);
  assert.deepEqual(wireInput({ x: 0.126, y: -0.2, dash: true }), { x: 0.13, y: -0.2, dash: true });
});

test('with every stick known, a guest\'s forecast is the host\'s game step for step until a car lands in the water', () => {
  const four = [0, 1, 2, 3].map((seat) => ({ seat, color: seat, ai: 1 as const, name: `Car ${seat}` }));
  const host = createWorld(four, 12);
  const guest = createWorld(four, 12);
  let compared = 0;
  for (let i = 0; i < 60 * 40 && !host.cars.some((car) => car.out); i++) {
    const inputs = host.cars.map((car) => think(host, car.id, 1));
    stepOnce(host, inputs);
    stepOnce(guest, inputs, true);
    if (host.cars.some((car) => car.out)) break;
    assert.equal(guest.phase, host.phase);
    assert.equal(guest.tick, host.tick);
    assert.deepEqual(guest.cars.map(({ x, z, vx, vz, falling }) => [x, z, vx, vz, falling]), host.cars.map(({ x, z, vx, vz, falling }) => [x, z, vx, vz, falling]));
    compared++;
  }
  assert.ok(compared > 60 * 4 && host.cars.some((car) => car.out), 'no car went in the water');
  // the forecast never calls a car in the water or a round over itself: it waits under the surface for the host
  for (let i = 0; i < 60; i++) stepOnce(guest, host.cars.map(() => noInput()), true);
  assert.ok(guest.cars.every((car) => !car.out) && guest.phase === 'fight');
  assert.ok(guest.cars.some((car) => car.falling && car.y === -2.5));
});

test('the host plays a guest\'s stick at the guest\'s own steps, a lag behind that covers its late packets', () => {
  const stick = new GuestStick();
  const at = (q: number, x: number, h: [number, number, number, 0 | 1][] = []) => ({ k: 'i' as const, r: 1, x, y: 0, d: false, q, h });
  // packets arrive 4 to 6 steps after they were sent
  for (let q = 1; q <= 40; q++) stick.hear(at(q, 0), q + 4 + (q % 3));
  assert.equal(stick.lag, 6);
  // a change at guest step 50, heard at host step 55, is played at host step 56, not before
  stick.hear(at(50, 1, [[50, 1, 0, 0]]), 55);
  assert.deepEqual(stick.at(55), { input: { x: 0, y: 0, dash: false }, ack: 49 });
  assert.deepEqual(stick.at(56), { input: { x: 1, y: 0, dash: false }, ack: 50 });
  // a change that waited for a later packet (a guest batching them) counts as late, and the lag grows to cover it
  for (let q = 60; q <= 100; q += 4) stick.hear(at(q, q % 8 ? 1 : 0.5, [[q - 3, q % 8 ? 1 : 0.5, 0, 0]]), q + 5);
  assert.ok(stick.lag! >= 8, `lag ${stick.lag}`);
  // a second-long stall holds up a burst of packets: the lag waits for no more than 9 steps over the quickest, and is
  // back within a few seconds once packets come on time again
  const stalled = new GuestStick();
  let q = 0;
  for (; q < 120; q += 3) stalled.hear(at(q, 0), q + 5);
  const before = stalled.lag!;
  for (let late = 60; late > 0; late -= 3, q += 3) stalled.hear(at(q, 0), q + 5 + late);
  assert.ok(stalled.lag! <= before + 9, `lag ${stalled.lag} after the stall, ${before} before`);
  for (const until = q + 300; q < until; q += 3) stalled.hear(at(q, 0), q + 5);
  assert.equal(stalled.lag, before);
  // an old change that's news (a host that wasn't listening yet) isn't taken for a late one
  const fresh = new GuestStick();
  fresh.hear(at(500, 1, [[100, 1, 0, 0]]), 505);
  assert.equal(fresh.lag, 6);
  // an older guest (no steps) is driven on its latest word, as before
  const older = new GuestStick();
  older.hear({ k: 'i', r: 1, x: 0.5, y: 0.5, d: true }, 10);
  assert.deepEqual(older.at(11), { input: { x: 0.5, y: 0.5, dash: true }, ack: -1 });
});

test('a spectator draws the host\'s states eased in between, a moment behind, through jitter', () => {
  const world = createWorld(roster, 1);
  const glide = new Glide();
  const rand = rng(3);
  const drawn: number[] = [];
  let n = 0;
  let next = 0;
  const arrivals: { at: number; n: number; x: number }[] = [];
  for (let t = 0; t < 3000; t += 50) {
    n = Math.round(t / (1000 / 60));
    arrivals.push({ at: t + 40 + rand() * 40, n, x: -5 + n * STEP * 4 });
  }
  arrivals.sort((a, b) => a.at - b.at);
  for (let t = 0; t < 3000; t += 1000 / 60) {
    while (next < arrivals.length && arrivals[next].at <= t) {
      world.cars[0].x = arrivals[next].x;
      glide.push(arrivals[next].n, world, arrivals[next].at / 1000);
      next++;
    }
    drawn.push(glide.drawn(world, t / 1000)[0].x);
  }
  const moves = drawn.slice(30).map((x, i, all) => (i ? x - all[i - 1] : 4 / 60)).slice(1);
  // 4 units a second is 6.7 cm a frame: never backward, never more than half again that
  assert.ok(moves.every((move) => move >= 0 && move < 0.1), `frame moves ${Math.min(...moves)} to ${Math.max(...moves)}`);
});

test('a busy room (two bots shoving everyone) keeps the guest in step with the host, round after round', { timeout: 60_000 }, () => {
  for (const [latency, jitter] of [[30, 20], [75, 30]] as const) {
    const winners = { host: [] as (number | null)[], guest: [] as (number | null)[] };
    const phase = { host: '', guest: '' };
    const watch = (side: 'host' | 'guest', world: World) => {
      if (phase[side] !== 'over' && world.phase === 'over') winners[side].push(world.roundWinner);
      phase[side] = world.phase;
      for (const car of world.cars) assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.vx), `${side}: a car went off the map`);
    };
    const { guestFrames, hostFrames } = run({ logic: 'new', latency, jitter, loss: 0.02, seconds: 45, guest: circle(), host: hostShuttle, bots: 2, watch });
    const agree = agreement(guestFrames, hostFrames, GUEST, 4.5);
    const fixes = guestFrames.filter((frame) => frame.fix > 0.05).length;
    const worst = Math.max(...guestFrames.map((frame) => frame.fix));
    console.log(`busy room, ${latency * 2} ms round trip: rounds won (host) ${winners.host.join(', ')} / (guest) ${winners.guest.join(', ')}; guest's car ${fmt(agree.mean)} mean off the host's copy (best fit ${agree.delay} ms); drawn over 5 cm off its forecast in ${fixes} of ${guestFrames.length} frames (bumps it couldn't see coming), worst ${fmt(worst)}`);
    assert.ok(winners.host.length >= 2, 'fewer than two rounds were played');
    assert.deepEqual(winners.guest, winners.host);
    assert.ok(agree.mean < 0.1, `the guest's car was ${agree.mean} off the host's copy`);
  }
});
