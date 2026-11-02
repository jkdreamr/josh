// Sumo's online game apart from the screen: what a guest sends and how the host plays it, how a guest shows the host's
// game, and how both keep time. Pure (no React, no three), so tests can run a host and a guest over a slow link.
//
// Bumping is the whole game, so the host keeps the say over every car: a guest owning its own car would have every
// bump between two people worked out twice, once on each side, with neither knowing which. A guest still never waits:
// - Time. Online, host and guests step on the wall clock (Pacer), not the frame's capped dt, so a slow frame is caught
//   up rather than played in slow motion, and a guest's game keeps pace with the host's.
// - Steps. A guest numbers its steps and says at which step its stick changed. The host plays a guest's step s at its
//   own step s + lag, the lag set from how late that guest's packets come (nine in ten arrive before they're due), so
//   the host drives the guest's car with exactly the stick the guest had, step for step. Each state says which guest
//   step every car was at, and what stick everyone was driving with.
// - Forecast. A guest's game is the host's game as it will be once the guest's newest stick reaches it. On each state
//   it goes back to the host's step and plays on from there to now: its own stick for every step the host hasn't had
//   yet, everyone else on the stick the host last had them on. Its own car answers on the next frame, and while nobody
//   surprises it the forecast is what the host goes on to do, so its car is never pulled back. A surprise (someone
//   turned or dashed after their last state, a bump that came of it) arrives with the next state; where that moves a
//   car on screen, the car is drawn easing over (within a few tenths of a second, keeping its speed, so another car's
//   surprise bends its path) rather than jumping. Between steps, every car is drawn carried on at its speed.
// - Watching. A spectator draws the host's states a tenth of a second behind the host's clock, eased between the two
//   either side.
import { STEP, noInput, stepOnce, type Car, type Event, type Input, type World } from './logic.ts';
import { CAR_DASH, CAR_FALLING, CAR_OUT, wireInput, type InputPacket, type PackedCar, type StateNet, type StatePacket, type StickChange } from './net.ts';

/** A guest sends its stick at least this often (and at once when it changes); the host its state, every KEYFRAME-th reliably. */
export const SEND_MS = 50;
export const KEYFRAME = 5;
/** The most wall time stepped in one go (after a longer stall, the game skips ahead rather than racing through it). */
export const CATCH_UP_MAX = 2;

const same = (a: Input, b: Input) => a.x === b.x && a.y === b.y && a.dash === b.dash;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Online play's clock: how much wall time each update has to step (seconds, on performance.now()'s clock). */
export class Pacer {
  last: number | null;
  constructor(now: number | null = null) {
    this.last = now;
  }
  /** The time since the last call, to step now (none the first time). */
  due(now: number): number {
    const last = this.last ?? now;
    this.last = now;
    return Math.min(CATCH_UP_MAX, Math.max(0, now - last));
  }
  since(now: number): number {
    return this.last === null ? 0 : Math.max(0, now - this.last);
  }
}

/** Runs `dt` more seconds of fixed steps (the world keeps what's left over for next time), `each` taking one step. */
export function pace(world: World, dt: number, each: () => void) {
  world.acc += dt;
  while (world.acc + 1e-9 >= STEP && world.phase !== 'done') {
    world.acc -= STEP;
    each();
  }
  if (world.phase === 'done') world.acc = 0;
}

/** The host's step count as of `now`, fractions and all (when a guest's packet came in). */
export const stepsAt = (world: World, pacer: Pacer, now: number) => world.tick + (world.acc + pacer.since(now)) / STEP;

/** How many of a guest's latest packets its lag is set from (two seconds' worth at the least). */
const LATE_SAMPLES = 40;
/**
 * The lag waits for nine packets in ten, but for no more than JITTER_MAX steps more than the quickest of them (past
 * that, a packet held up in a stall is just late, rather than every step after it waiting for the next stall). It comes
 * down a step at a time, at most every LOWER_EVERY host steps, and only when well clear.
 */
const JITTER_MAX = 9;
const LOWER_EVERY = 10;
/** A change in a packet's history counts toward how late the packet is only if this recent (an old one is just news to a host that wasn't listening). */
const RECENT = 30;

/** One guest's stick as the host has heard it. */
export class GuestStick {
  /** The stick's changes by guest step, oldest first. */
  private changes: { at: number; input: Input }[] = [];
  /** How late each packet came: the host's step as it arrived, less the guest step it was sent at. */
  private late: number[] = [];
  private lowered = -Infinity;
  /** The last word from an older guest, which doesn't number its steps (then the host just drives on it). */
  private plain: Input | null = null;
  /** The host plays the guest's step s at its own step s + lag (null until the guest's first numbered packet). */
  lag: number | null = null;

  hear(packet: InputPacket, hostAt: number) {
    const input = { x: packet.x, y: packet.y, dash: packet.d };
    if (packet.q === undefined) {
      this.plain = input;
      return;
    }
    this.plain = null;
    // how late it is, by the oldest step it was first to tell (a change that waited for a later packet counts as late)
    let fresh = packet.q;
    for (const [at, x, y, d] of packet.h ?? []) if (this.note(at, { x, y, dash: d === 1 }) && packet.q - at <= RECENT) fresh = Math.min(fresh, at);
    // (a change the history left out: taken to be at the step the packet is for)
    if (!same(this.stickAt(packet.q), input)) this.note(packet.q, input);
    this.late.push(hostAt - fresh);
    if (this.late.length > LATE_SAMPLES) this.late.shift();
    const sorted = [...this.late].sort((a, b) => a - b);
    const due = Math.min(Math.ceil(sorted[Math.floor((sorted.length - 1) * 0.9)]), Math.ceil(sorted[0]) + JITTER_MAX);
    if (this.lag === null) this.lag = due + 1;
    else if (due > this.lag) this.lag = due;
    else if (due < this.lag - 1 && hostAt - this.lowered >= LOWER_EVERY) {
      this.lag--;
      this.lowered = hostAt;
    }
    const forget = hostAt - this.lag - 240;
    while (this.changes.length > 1 && this.changes[1].at <= forget) this.changes.shift();
  }

  /** The stick for host step `step`, and the guest step that is (-1 for an older guest). */
  at(step: number): { input: Input; ack: number } {
    if (this.plain || this.lag === null) return { input: this.plain ?? noInput(), ack: -1 };
    const ack = step - this.lag;
    return { input: this.stickAt(ack), ack: ack >= 0 ? ack : -1 };
  }

  /** Adds a change; true when it was news. */
  private note(at: number, input: Input): boolean {
    let i = this.changes.length;
    while (i > 0 && this.changes[i - 1].at > at) i--;
    const there = i > 0 && this.changes[i - 1].at === at ? this.changes[i - 1] : null;
    if (there && same(there.input, input)) return false;
    if (there) there.input = input;
    else this.changes.splice(i, 0, { at, input });
    return true;
  }

  private stickAt(step: number): Input {
    for (let i = this.changes.length - 1; i >= 0; i--) if (this.changes[i].at <= step) return this.changes[i].input;
    return noInput();
  }
}

/** The host's side: every guest's stick, and what each car drove with in the latest step. */
export class HostNet {
  readonly sticks = new Map<number, GuestStick>();
  private applied: { input: Input; ack: number }[] = [];

  hear(seat: number, packet: InputPacket, hostAt: number) {
    let stick = this.sticks.get(seat);
    if (!stick) this.sticks.set(seat, (stick = new GuestStick()));
    stick.hear(packet, hostAt);
  }

  /**
   * One host step. `drive` gives the stick of every car the host drives itself (its own, bots, cars whose player left)
   * and null for a guest's car, which goes by that guest's stick at the guest step due now.
   */
  tick(world: World, drive: (car: Car) => Input | null): Event[] {
    const step = world.tick + 1;
    this.applied = world.cars.map((car) => {
      const input = drive(car);
      if (input) return { input, ack: -1 };
      return this.sticks.get(car.seat)?.at(step) ?? { input: noInput(), ack: -1 };
    });
    return stepOnce(world, this.applied.map((entry) => entry.input));
  }

  /** What a state adds for guests that forecast it (see StateNet), as of the latest step. */
  state(world: World): StateNet {
    return {
      n: world.tick,
      ak: world.cars.map((_, i) => this.applied[i]?.ack ?? -1),
      ci: world.cars.map((_, i) => {
        const input = wireInput(this.applied[i]?.input ?? noInput());
        return [input.x, input.y, input.dash ? 1 : 0];
      }),
      cx: world.cars.map((car) => [car.dashT, car.cool, car.dashHeld ? 1 : 0]),
    };
  }
}

/** A guest takes the round, phase, clocks and float from each state (its cars are set one by one, see setCar). */
export function applyHead(world: World, packet: StatePacket) {
  const previousPhase = world.phase;
  const previousWins = world.wins;
  world.round = packet.rn;
  world.wins = [...packet.wins];
  world.phase = packet.ph;
  world.radius = packet.rad;
  if (packet.ph === 'over' && previousPhase !== 'over') {
    const winner = packet.wins.findIndex((wins, index) => wins > (previousWins[index] ?? 0));
    world.roundWinner = winner < 0 ? null : winner;
  } else if (packet.ph === 'count') {
    world.roundWinner = null;
  }
  if (packet.ph === 'count' || packet.ph === 'over') world.timer = packet.tm;
  else {
    world.fightTime = packet.tm;
    world.timer = 0;
  }
  // (a round lining up: the float at its full size and the fight clock at nought, as a guest's forecast plays on from)
  if (packet.ph === 'count') {
    world.fightTime = 0;
    world.startRadius = packet.rad;
  }
}

/** A car as the host's state has it (with a newer host's dash details, `dash`, or a guess at them). */
export function setCar(car: Car, packed: PackedCar, dash?: [number, number, 0 | 1]) {
  car.x = packed.x;
  car.z = packed.z;
  car.y = packed.y;
  car.vx = packed.vx;
  car.vz = packed.vz;
  car.yaw = packed.yaw;
  car.charge = packed.charge;
  car.falling = !!(packed.flags & CAR_FALLING);
  car.out = !!(packed.flags & CAR_OUT);
  if (dash) {
    car.dashT = dash[0];
    car.cool = dash[1];
    car.dashHeld = dash[2] === 1;
  } else car.dashT = packed.flags & CAR_DASH ? 0.2 : 0;
}

/**
 * An older host's word on a guest's own car, which says nothing of when it was: eased toward, or jumped to when far
 * out. (All a guest can do with such a host; it pulls the car back toward where it was a round trip ago.)
 */
export function easeOwn(car: Car, packed: PackedCar) {
  const error = Math.hypot(car.x - packed.x, car.z - packed.z);
  const k = error > 1.5 ? 1 : 0.35;
  car.x += (packed.x - car.x) * k;
  car.z += (packed.z - car.z) * k;
  car.vx += (packed.vx - car.vx) * k;
  car.vz += (packed.vz - car.vz) * k;
}

/** Where a car is drawn. */
export type Pose = { x: number; z: number; y: number; yaw: number };
const poseOf = ({ x, z, y, yaw }: Car): Pose => ({ x, z, y, yaw });

/** A car's moving parts, and the world's, as a guest's forecast had them after one of its steps. */
type Moving = Pick<Car, 'x' | 'z' | 'y' | 'vx' | 'vz' | 'yaw' | 'charge' | 'cool' | 'dashT' | 'dashHeld' | 'falling' | 'out'>;
type Saved = { tick: number; phase: World['phase']; timer: number; fightTime: number; radius: number; cars: Moving[] };
const movingOf = ({ x, z, y, vx, vz, yaw, charge, cool, dashT, dashHeld, falling, out }: Car): Moving => ({ x, z, y, vx, vz, yaw, charge, cool, dashT, dashHeld, falling, out });
/** The wire rounds to hundredths: anything within this of the forecast is the forecast. */
const ROUNDING = 0.0051;
const near = (a: number, b: number) => Math.abs(a - b) <= ROUNDING;
const agrees = (car: Car, saved: Moving) => near(car.x, saved.x) && near(car.z, saved.z) && near(car.y, saved.y)
  && near(car.vx, saved.vx) && near(car.vz, saved.vz) && near(wrap(car.yaw - saved.yaw), 0) && near(car.charge, saved.charge)
  && near(car.cool, saved.cool) && near(car.dashT, saved.dashT) && car.dashHeld === saved.dashHeld && car.falling === saved.falling && car.out === saved.out;

/** Steps of a guest's own stick kept (over eight seconds: far more than any round trip), and of its forecast. */
const LOG = 512;
const HISTORY = 256;
/** The most steps a state is played on by (two seconds; a guest further adrift than that waits for the next). */
const REWIND_MAX = 120;
/**
 * How a correction fades: a car is drawn off where it is by a spring that settles in about four times this (seconds),
 * without overshooting. Everyone else's starts out moving the way the car was drawn moving, so a turn or a dash we
 * couldn't see coming bends the car's path rather than stopping it dead in a frame; ours (the rare bump someone else's
 * surprise gave us) takes the new heading at once, so the bump is felt, and only the gap closes gently. A car further
 * than SNAP from where it was drawn just goes there.
 */
const SETTLE_OWN = 0.04;
const SETTLE = 0.1;
const SNAP = 4;

/** Whether a car moves between steps (mid-fight, not in the water): 1 or 0. */
const glides = (world: World, car: Car) => (world.phase === 'fight' && !car.out ? 1 : 0);

/** A car's correction: how far off it is drawn (x, z, y, yaw), and how fast that is changing (vx, vz). */
type Correction = { x: number; z: number; y: number; yaw: number; vx: number; vz: number };
const none = (): Correction => ({ x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0 });

/** A guest's side: its own steps and stick, and the forecast of the host's game it shows. */
export class GuestNet {
  /** Steps this guest has run (its clock, one a STEP of wall time). */
  step = 0;
  /** The host plays our step s at its step s + lag (from its states; null until the first that names our car). */
  lag: number | null = null;
  /** The host step of the newest state taken (older ones, which the fast channel can deliver late, are left). */
  newest = -1;
  /** What each car is driving with as of the newest state: the forecast drives everyone but us on it. */
  held: Input[] = [];
  private log: Input[] = [];
  private changes: StickChange[] = [];
  private stick = noInput();
  private history: (Saved | undefined)[] = [];
  private own = -1;
  private offsets: Correction[] = [];
  private sent: Input | null = null;
  private sentAt = -Infinity;

  /**
   * A frame's worth of steps (`dt` seconds of them) with the stick read this frame (as the wire carries it): our car is
   * `own` (-1 for none). A slow frame's catch-up steps are time gone by before the stick was read, so they keep the
   * stick as it was, and the new one takes over in the last step (so the host hears of it at once, not steps late).
   */
  advance(world: World, dt: number, own: number, input: Input): Event[] {
    const events: Event[] = [];
    this.own = own;
    world.acc += dt;
    let steps = 0;
    while (world.acc + 1e-9 >= STEP) {
      world.acc -= STEP;
      steps++;
    }
    for (let i = 1; i <= steps && world.phase !== 'done'; i++) events.push(...this.tick(world, own, i === steps ? input : this.stick));
    if (world.phase === 'done') world.acc = 0;
    return events;
  }

  /** One step: our car (`own`, -1 for none) on this step's stick, everyone else as the host had them. */
  tick(world: World, own: number, input: Input): Event[] {
    this.step++;
    this.log[this.step % LOG] = input;
    if (!same(input, this.stick)) {
      this.stick = input;
      this.changes.push([this.step, input.x, input.y, input.dash ? 1 : 0]);
      if (this.changes.length > 12) this.changes.shift();
    }
    return this.forecast(world, own, input);
  }

  /**
   * What to tell the host now (after a frame's steps), if anything: the stick as of our latest step, at once when it
   * changed (a change that waited for the next packet would reach the host late), otherwise every SEND_MS. `dash`: the
   * dash button changed, which also goes reliably. `now` in milliseconds.
   */
  outgoing(now: number): { stick: Input; steps: { q: number; h: StickChange[] }; dash: boolean } | null {
    const before = this.sent;
    if (before && same(before, this.stick) && now - this.sentAt < SEND_MS) return null;
    this.sent = this.stick;
    this.sentAt = now;
    // the changes of the last fifth of a second (and always the latest, however old), so a lost packet's still arrive
    const recent = this.changes.filter(([at]) => at > this.step - 12);
    const h = (recent.length ? recent : this.changes.slice(-1)).slice(-8);
    return { stick: this.stick, steps: { q: this.step, h }, dash: !before || before.dash !== this.stick.dash };
  }

  /**
   * A newer host's state (one with StateNet's additions), for the host's step n. A car whose state there agrees with
   * what our forecast had for that step (to the wire's rounding) keeps the forecast's (nothing surprised it); any other
   * takes the host's. Then the world plays on to the step we're at, our own stick for each step since the one the host
   * had for us, and wherever that moved a car on screen, the difference becomes a correction that fades.
   */
  receive(world: World, packet: StatePacket & StateNet, own: number): Event[] {
    const drawn = this.drawn(world).map((car, i) => ({ ...poseOf(car), vx: car.vx + (this.offsets[i]?.vx ?? 0), vz: car.vz + (this.offsets[i]?.vz ?? 0) }));
    const spare = world.acc;
    const n = packet.n;
    this.own = own;
    const ours = this.history[n % HISTORY]?.tick === n ? this.history[n % HISTORY]! : null;
    this.newest = n;
    this.held = packet.ci.map(([x, y, d]) => ({ x, y, dash: d === 1 }));
    const ack = own >= 0 ? packet.ak[own] ?? -1 : -1;
    if (ack >= 0) this.lag = n - ack;
    applyHead(world, packet);
    packet.cars.forEach((packed, i) => {
      const car = world.cars[i];
      if (!car) return;
      setCar(car, packed, packet.cx[i]);
      if (ours?.cars[i] && agrees(car, ours.cars[i])) Object.assign(car, ours.cars[i]);
    });
    if (ours && ours.phase === world.phase && near(ours.timer, world.timer) && near(ours.fightTime, world.fightTime) && near(ours.radius, world.radius)) {
      world.timer = ours.timer;
      world.fightTime = ours.fightTime;
      world.radius = ours.radius;
    }
    world.tick = n;
    this.save(world);
    const events: Event[] = [];
    if (this.lag !== null) {
      const ahead = Math.min(REWIND_MAX, this.step + this.lag - n);
      for (let i = 0; i < ahead; i++) events.push(...this.forecast(world, own, this.stickAt(world.tick + 1 - this.lag)));
    }
    this.offsets = world.cars.map((car, i) => {
      const was = drawn[i];
      const x = car.x + glides(world, car) * spare * car.vx;
      const z = car.z + glides(world, car) * spare * car.vz;
      // (the countdown is cars lined up for a round, never a correction)
      if (!was || world.phase === 'count' || car.out || Math.hypot(was.x - x, was.z - z) > SNAP) return none();
      const moving = i !== own;
      return { x: was.x - x, z: was.z - z, y: was.y - car.y, yaw: wrap(was.yaw - car.yaw), vx: moving ? was.vx - car.vx : 0, vz: moving ? was.vz - car.vz : 0 };
    });
    return events;
  }

  /** Whether a state from host step n is older than one already taken (a new host counts from its own step, so far back is new). */
  stale(n: number): boolean {
    return n <= this.newest && this.newest - n < 600;
  }

  /**
   * Where each car is drawn: where it is, carried on at its speed for the part of a step since (so a screen faster than
   * the 60 steps a second still sees it move every frame), plus what's left of its correction.
   */
  drawn(world: World): Car[] {
    return world.cars.map((car, i) => {
      const offset = this.offsets[i] ?? none();
      const on = glides(world, car) * world.acc;
      return { ...car, x: car.x + car.vx * on + offset.x, z: car.z + car.vz * on + offset.z, y: car.y + offset.y, yaw: car.yaw + offset.yaw };
    });
  }

  /** Lets every correction settle by `dt` seconds' worth (a critically damped spring, worked out exactly). */
  fade(dt: number) {
    this.offsets.forEach((offset, i) => {
      const w = 1 / (i === this.own ? SETTLE_OWN : SETTLE);
      const k = Math.exp(-w * dt);
      const cx = offset.vx + w * offset.x;
      const cz = offset.vz + w * offset.z;
      offset.x = (offset.x + cx * dt) * k;
      offset.z = (offset.z + cz * dt) * k;
      offset.vx = (offset.vx - w * cx * dt) * k;
      offset.vz = (offset.vz - w * cz * dt) * k;
      offset.y *= k;
      offset.yaw *= k;
    });
  }

  /** One step of the forecast (our car on `input`), kept in the history. */
  private forecast(world: World, own: number, input: Input): Event[] {
    const events = stepOnce(world, world.cars.map((_, i) => (i === own ? input : this.held[i] ?? noInput())), true);
    this.save(world);
    return events;
  }

  private save(world: World) {
    this.history[world.tick % HISTORY] = { tick: world.tick, phase: world.phase, timer: world.timer, fightTime: world.fightTime, radius: world.radius, cars: world.cars.map(movingOf) };
  }

  private stickAt(step: number): Input {
    if (step < 1 || step > this.step || step <= this.step - LOG) return noInput();
    return this.log[step % LOG] ?? noInput();
  }
}

/** A spectator draws the host's states this far behind (seconds), from this many of the latest. */
const BEHIND = 0.1;
const SNAPSHOTS = 12;

/** A spectator's view: the host's states, eased between, a moment behind the host's clock. */
export class Glide {
  private snaps: { t: number; cars: Pose[] }[] = [];
  /** Our clock less the host's, as low as it has been lately (the least delayed state), drifting up slowly. */
  private offset: number | null = null;

  /** A state, applied to `world`, from the host's step n, arriving `now` (seconds). */
  push(n: number, world: World, now: number) {
    const t = n * STEP;
    const newest = this.snaps[this.snaps.length - 1];
    if (newest && t <= newest.t) return;
    const offset = now - t;
    this.offset = this.offset === null || offset < this.offset ? offset : this.offset + (offset - this.offset) * 0.02;
    this.snaps.push({ t, cars: world.cars.map(poseOf) });
    if (this.snaps.length > SNAPSHOTS) this.snaps.shift();
  }

  drawn(world: World, now: number): Car[] {
    const snaps = this.snaps;
    if (snaps.length < 2 || this.offset === null) return world.cars;
    const at = now - this.offset - BEHIND;
    let older = snaps[0];
    let newer = snaps[1];
    for (let i = 1; i < snaps.length; i++) {
      older = snaps[i - 1];
      newer = snaps[i];
      if (newer.t >= at) break;
    }
    const span = Math.max(1e-3, newer.t - older.t);
    // (past the newest state, carried on a little way rather than stopping dead)
    const k = Math.max(0, Math.min(1 + 0.05 / span, (at - older.t) / span));
    return world.cars.map((car, i) => {
      const from = older.cars[i];
      const to = newer.cars[i];
      if (!from || !to || Math.hypot(to.x - from.x, to.z - from.z) > SNAP) return car;
      return {
        ...car,
        x: from.x + (to.x - from.x) * k,
        z: from.z + (to.z - from.z) * k,
        y: from.y + (to.y - from.y) * Math.min(1, k),
        yaw: from.yaw + wrap(to.yaw - from.yaw) * Math.min(1, k),
      };
    });
  }
}
