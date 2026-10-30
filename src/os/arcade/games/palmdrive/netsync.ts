// Palm Drive's online race apart from the screen: what each client sends and when, how it reads what comes in, where
// it shows other people's karts, and how its race keeps time. Pure (no React, no three), so tests can run a whole room.
//
// Timing. Online, a race runs on the wall clock (Pacer): a slow frame, a busy main thread or a tab in the background
// is caught up in steps of at most STEP_MAX, rather than the race running in slow motion and its clock (and every set
// piece on it) drifting away from everyone else's. Every guest keeps its race clock on the host's (HostClock: the
// round trip of its own kart through the host, as the host's state echoes it), so all the clocks in a race agree.
// Every kart's state carries the race time its owner sampled it at (`t`); a receiver drops anything older than what
// it has (fast packets can arrive out of order) and carries the kart on from then to now the way it was going, blending
// over from where it was showing (see glide), so the kart is where its owner has it, not a moment behind, and never
// jumps. A guest whose link to the host goes through the room sends its kart to everyone at once, rather than through
// the host and back out (two more trips through the room). Thrown items say when they were thrown, and are carried on
// to where they have got to by now.
import { BLEND, boom, carried, catchCloud, catchUp, createRace, GRAVITY, hornAt, inkFrom, isCc, powFrom, removeThing, RIVALS, robbed, spawn, step, stolen, strike, type Cc, type Ev, type Kart, type NetState, type Race, type Racer } from './logic.ts';
import { applyFlags, carOf, endOf, events, F_SPIN, F_SUNK, F_TUMBLE, finishOrder, guestState, hostState, parsePacket, winnerOf, type Car, type Echo, type NetEv } from './net.ts';
import { fromLook, type Look } from './garage.ts';
import { isCourse, type CourseId } from './courses.ts';

/** Kart states go out this often (15 a second); every KEYFRAME-th goes reliably, with every kart in it. */
export const SEND_MS = 66;
export const KEYFRAME = 5;
/** The longest single step of the simulation (the solo game's frame clamp), and how far behind the wall clock a race may fall before it stops catching up. */
export const STEP_MAX = 1 / 20;
export const BACKLOG_MAX = 90;
/** Bots run out of time like everyone else, this long after the first kart home. */
export const TIME_LIMIT = 30;

export const SEAT_COLORS = ['#e53935', '#1e88e5', '#3fae4a', '#fdd835', '#8e24aa', '#fb8c00', '#ec407a', '#00acc1'];

/** The room as the race sees it: this player's seat, whether it hosts, the people and the bots in it, and the round. */
export type Seats = { seat: number; isHost: boolean; round: number; players: { seat: number; name: string }[]; bots: { seat: number; name: string }[] };

/** Everyone in an online race, people and bots, in seat order (the order of the grid). */
export const racersOf = (o: Seats) => [...new Set([...o.players.map((p) => p.seat), ...o.bots.map((b) => b.seat)])].sort((a, b) => a - b);

/**
 * Everyone online starts in their seat's color; karts take their owner's look once their first state arrives.
 * Bots race as the CPU drivers they are named after: the host drives them and everyone else sees them through its packets.
 */
export function onlineRace(o: Seats, cc: Cc, course: CourseId, roster: number[], countdown: number, look: Look, laps?: number): Race {
  const racers: Racer[] = roster.map((seat) => {
    const bot = o.bots.findIndex((b) => b.seat === seat);
    if (bot >= 0) return { ...RIVALS[bot % RIVALS.length], name: o.bots[bot].name, kind: o.isHost ? 'cpu' : 'remote', seat };
    return {
      name: o.players.find((p) => p.seat === seat)?.name ?? `Player ${seat + 1}`,
      color: seat === o.seat ? look.color : SEAT_COLORS[seat % SEAT_COLORS.length],
      hat: seat === o.seat ? look.hat : 'cap',
      gear: seat === o.seat ? look.gear : undefined,
      kind: seat === o.seat ? 'player' : 'remote',
      seat,
    };
  });
  return createRace({ cc, course, racers, countdown, laps, idBase: o.seat * 1_000_000 + 1 });
}

/** The fastest a remote kart is taken to be turning (radians a second, a hairpin at speed, not a spin), and slowing down (m/s², half that speeding up). */
const TURN_MAX = 2.5;
const ACCEL_MAX = 24;
/** How far off a new report may put a remote kart and still have it blend over (any further and it just goes there), and the longest the blend takes. */
const SNAP = 30;
const BLEND_MAX = 0.5;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The furthest on a thrown item is carried to make up for the time word of it took (see applyEvent). */
const CATCH_MAX = 0.5;

/** The oldest a report is taken to be: anything older (a clock not yet set, a long stall) is carried on this far at most. */
export const AGE_MAX = 1;

/**
 * One sender's reports as seen here. `at` takes a report's time on the sender's race clock (the same as ours, see
 * HostClock) and gives the time it is taken to be current at, or null for one no newer than a report already seen.
 */
export class SampleClock {
  private last = -Infinity;
  at(local: number, sample: number): number | null {
    if (!(sample > this.last)) return null;
    this.last = sample;
    return Math.min(local, Math.max(sample, local - AGE_MAX));
  }
}

/**
 * A guest's reading of the host's race clock against its own, from its kart's round trips through the host: it sent
 * the kart at its time `t`, the host held it `hold` seconds and sent its state at host time T, and that arrived here
 * at our time `now`, so the host's clock is ahead of ours by T - now + rtt / 2, where rtt = now - t - hold. The
 * quickest recent round trip says it best (the least room for the two ways to differ).
 */
/** How many round trips the host's clock is read from (the quickest of them): ten seconds' worth. */
const SAMPLES = 150;
/** A guest's clock within CLOCK_NEAR of the host's is left be; off by up to CLOCK_FAR it runs at most CLOCK_SLEW faster or slower until it agrees. */
const CLOCK_NEAR = 0.004;
const CLOCK_FAR = 0.25;
const CLOCK_SLEW = 0.06;

export class HostClock {
  private samples: { rtt: number; ahead: number }[] = [];
  observe(t: number, hold: number, hostT: number, now: number) {
    const rtt = now - t - hold;
    if (!(rtt >= 0 && rtt < 2)) return;
    this.samples.push({ rtt, ahead: hostT - now + rtt / 2 });
    if (this.samples.length > SAMPLES) this.samples.shift();
  }
  /** How far the host's clock is ahead of ours (seconds; behind when negative), or 0 before any round trip. */
  get ahead(): number {
    let best: { rtt: number; ahead: number } | null = null;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best?.ahead ?? 0;
  }
  /** Our clock moved on by `d` more than the wall clock did. */
  moved(d: number) {
    for (const s of this.samples) s.ahead -= d;
  }
}

/** What a client keeps about the online race beyond the race itself. */
export type Net = {
  /** The race is set (the host's from the start, a guest's from the host's first state). */
  synced: boolean;
  ticks: number;
  roster: number[];
  /** On the host: the bots it drives this race, and those still out on the course when time ran out. */
  bots: Set<number>;
  botsOut: Set<number>;
  /** Racers who left this race: out for good, even if a newcomer takes their seat number. */
  gone: Set<number>;
  /**
   * On the host: each guest's latest state, the sample time of the one last passed on to everyone, and the guests
   * whose states go to everyone themselves (only every keyframe is passed on for them).
   */
  cars: Map<number, Car>;
  relayed: Map<number, number>;
  all: Set<number>;
  /** The sample time of each guest's state last sent back to them, in full or as an echo. */
  echoed: Map<number, number>;
  /** Each sender's reports (see SampleClock); on the host, the race time each guest's latest one came in at. */
  clocks: Map<number, SampleClock>;
  heard: Map<number, number>;
  /** A guest's reading of the host's clock, and when (race time) it sent each of its latest states, by their sample times. */
  host: HostClock;
  sent: Map<number, number>;
  /** Item events to send, in the order they happened, in runs by the seat of the kart that made them (this player's, or a bot the host drives). */
  outbox: [number, NetEv[]][];
  /** Out of time: the race goes on without us and the host still calls the result. */
  dnf: boolean;
  end: { w: number | null; order: [number, number][] } | null;
  /** Ticks since the host called the race (it says so a few times, then once a second, for anyone who missed it). */
  endTicks: number;
  /** Laps, when not the usual (shorter races, for tests). */
  laps?: number;
};

export function newNet(o: Seats | null): Net {
  return {
    synced: !o || o.isHost,
    ticks: 0,
    roster: o ? racersOf(o) : [],
    bots: new Set(o?.isHost ? o.bots.map((b) => b.seat) : []),
    botsOut: new Set(),
    gone: new Set(),
    cars: new Map(),
    relayed: new Map(),
    all: new Set(),
    echoed: new Map(),
    clocks: new Map(),
    heard: new Map(),
    host: new HostClock(),
    sent: new Map(),
    outbox: [],
    dnf: false,
    end: null,
    endTicks: 0,
  };
}

/** A kart whose driver left the race: parked out of sight, rather than frozen on the track. */
export function park(k: Kart) {
  k.left = true;
  k.net = null;
  k.x = k.z = 1e5;
  k.v = 0;
}

/** Shows a remote kart where its owner said it was, unless that word is older than what we have. True when it moved. */
export function applyCar(n: Net, r: Race, seat: number, car: Omit<Car, 'seat'>): boolean {
  const k = r.karts.find((x) => x.seat === seat && x.kind === 'remote');
  if (!k || k.left) return false;
  let at = r.time;
  // (an older client says nothing of when: then it is as of now, as it always was)
  if (car.t !== null) {
    let clock = n.clocks.get(seat);
    if (!clock) n.clocks.set(seat, (clock = new SampleClock()));
    const when = clock.at(r.time, car.t);
    if (when === null) return false;
    at = when;
  }
  const prev = k.net;
  const span = prev ? at - prev.at : 0;
  const hurt = !!(car.f & (F_SPIN | F_TUMBLE | F_SUNK));
  const next: NetState = { x: car.x, z: car.z, h: car.h, v: car.v, prog: car.p, done: car.fin >= 0 ? car.fin : null, flags: car.f, at };
  if (car.t === null) {
    // (an older client: placed as of now, the difference fading out as it always did)
    const now = carried({ x: car.x, z: car.z, h: car.h, v: car.v }, 0);
    const jump = !prev || Math.hypot(k.x - now.x, k.z - now.z) > 8;
    k.net = { ...next, ox: jump ? 0 : k.x - now.x, oz: jump ? 0 : k.z - now.z, w: 0 };
    k.y = car.y;
  } else {
    // How it was going, from the report before: turning (not while spun or tumbling, which is no way to take a bend),
    // speeding up or slowing down, which way it was really going, rising or falling. Nothing of the kind after a long
    // gap, or when it was set back on the road (`put`: it was in the water, or its owner's own reports jump).
    const moved = prev ? Math.hypot(car.x - prev.x, car.z - prev.z) : 0;
    const put = !prev || !!(prev.flags & F_SUNK) || moved > 70 * Math.max(span, 0) + 3;
    if (prev && !put && prev.since !== undefined && span > 0.02 && span < 0.5) {
      const w = hurt ? 0 : Math.max(-TURN_MAX, Math.min(TURN_MAX, wrapAngle(car.h - prev.h) / span));
      const a = Math.max(-ACCEL_MAX, Math.min(hurt ? 0 : ACCEL_MAX / 2, (car.v - prev.v) / span));
      next.w = w;
      next.a = a;
      // the way it went from the report before, which is the way it is going now, turned on by half the span (and
      // its heading when it barely moved, which says nothing)
      if (moved > 0.05) {
        next.dir = Math.atan2(car.x - prev.x, car.z - prev.z) + (w * span) / 2;
        next.u = moved / span + (a * span) / 2;
      }
      const py = prev.y ?? 0;
      next.vy = car.y > 0.02 ? (car.y - py) / span - (py > 0.02 ? (GRAVITY * span) / 2 : 0) : 0;
    } else next.vy = 0;
    next.y = car.y;
    // What the kart was showing against where the report before, carried on, has it now: the blend starts from there
    // (see glide), taking longer the further it has to go (a kart that shot off on a boost or a bullet while word of it
    // was on its way, which no guess could have seen coming), unless the kart was set back on the road, or is so far
    // off nothing would look right, when it just goes there.
    const seen = prev && prev.since !== undefined ? carried(prev, r.time - prev.at) : null;
    const target = carried(next, r.time - at);
    const off = Math.hypot(k.x - target.x, k.z - target.z);
    if (prev && seen && !put && off <= SNAP) {
      prev.from = null;
      next.from = prev;
      next.fx = k.x - seen.x;
      next.fz = k.z - seen.z;
      next.fy = k.y - (seen.y ?? k.y);
      next.bl = Math.min(BLEND_MAX, BLEND + off / 40);
    } else next.from = null;
    next.since = r.time;
    k.net = next;
    if (!next.from) {
      k.x = target.x;
      k.z = target.z;
      k.y = target.y ?? car.y;
    }
  }
  applyFlags(k, car.f);
  const look = car.look >= 0 ? fromLook(car.look) : null;
  if (look) Object.assign(k, look);
  return true;
}

/**
 * Plays someone else's item event here. age: how long ago it happened on their screen (word of it takes that long), so
 * a shell they threw is carried on to where it has got to by now, rather than starting out that far behind.
 */
export function applyEvent(r: Race, from: number, ev: NetEv, age = 0) {
  const idx = (seat: number) => r.karts.findIndex((k) => k.seat === seat);
  if (ev.y === 'spawn') {
    if (r.things.some((t) => t.id === ev.id)) return;
    const th = spawn(r, { id: ev.id, kind: ev.kind, owner: idx(from), x: ev.x, z: ev.z, y: ev.yy, vx: ev.vx, vz: ev.vz, vy: ev.vy, grace: ev.gr, target: ev.tg >= 0 ? idx(ev.tg) : -1, prog: ev.pg }, false);
    if (age > 0) catchUp(r, th, age);
  } else if (ev.y === 'gone') removeThing(r, ev.id, false);
  else if (ev.y === 'bolt') strike(r, idx(from));
  else if (ev.y === 'ink') inkFrom(r, idx(from));
  else if (ev.y === 'horn') hornAt(r, idx(from), ev.x, ev.z);
  else if (ev.y === 'boom') boom(r, ev.x, ev.z, idx(from));
  else if (ev.y === 'stole') {
    // the coin goes to the kart whose slam it was, if this client drives it: this player's, or a bot on the host
    const k = r.karts.find((x) => x.seat === ev.to);
    if (k && (k.idx === r.me || k.kind === 'cpu')) stolen(r, k);
  } else if (ev.y === 'boo' || ev.y === 'cloud') {
    // someone's Boo took the item of a kart we drive, or their thunder cloud jumped onto it
    const k = r.karts.find((x) => x.seat === ev.to);
    if (!k || (k.idx !== r.me && k.kind !== 'cpu')) return;
    if (ev.y === 'cloud') catchCloud(r, k, ev.left, idx(from));
    else {
      if (k.item) r.events.push({ t: 'boo', k: k.idx, by: idx(from), item: k.item });
      robbed(r, k);
    }
  } else if (ev.y === 'pow') powFrom(r, idx(from), ev.at);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Queues what everyone else needs to hear of an event here (items thrown, hits that pay out, and so on). */
export function outgoing(n: Net, r: Race, e: Ev) {
  const me = r.karts[r.me]?.seat ?? 0;
  // an event goes out under the kart that made it: ours, or on the host a bot it drives
  const by = (k: number) => (k === r.me || r.karts[k]?.kind === 'cpu' ? r.karts[k].seat : me);
  const send = (seat: number, ev: NetEv) => {
    const run = n.outbox[n.outbox.length - 1];
    if (run && run[0] === seat) run[1].push(ev);
    else n.outbox.push([seat, [ev]]);
  };
  const round = round2;
  if (e.t === 'spawn' && e.thing.local) {
    const th = e.thing;
    send(by(th.owner), { y: 'spawn', id: th.id, kind: th.kind, x: round(th.x), z: round(th.z), vx: round(th.vx), vz: round(th.vz), vy: round(th.vy), yy: round(th.y), tg: r.karts[th.target]?.seat ?? -1, pg: round(th.prog), gr: round(th.grace) });
  } else if (e.t === 'gone' && e.local) send(me, { y: 'gone', id: e.id });
  else if (e.t === 'bolt') send(by(e.k), { y: 'bolt' });
  else if (e.t === 'ink') send(by(e.k), { y: 'ink' });
  else if (e.t === 'horn') send(by(e.k), { y: 'horn', x: round(e.x), z: round(e.z) });
  else if (e.t === 'boom') send(me, { y: 'boom', x: round(e.x), z: round(e.z) });
  // a kart we drive was slammed by someone else's: tell them they won its coin
  else if (e.t === 'slammed' && e.coin && (e.k === r.me || r.karts[e.k]?.kind === 'cpu') && r.karts[e.by]?.kind === 'remote') send(by(e.k), { y: 'stole', to: r.karts[e.by].seat });
  else if (e.t === 'pow') send(by(e.k), { y: 'pow', at: round(e.at) });
  // a kart we drive took someone else's item with a Boo, or bumped its thunder cloud onto them: their client takes it
  // from here
  else if ((e.t === 'boo' || e.t === 'cloud') && (e.by === r.me || r.karts[e.by]?.kind === 'cpu') && r.karts[e.k]?.kind === 'remote') {
    send(by(e.by), e.t === 'boo' ? { y: 'boo', to: r.karts[e.k].seat } : { y: 'cloud', to: r.karts[e.k].seat, left: round(e.left) });
  }
}

/** The item events waiting to go out, as packets (and the outbox emptied). */
export const flushEvents = (n: Net, round: number, at: number | null = null) => n.outbox.splice(0).map(([origin, evs]) => events(round, origin, evs, at));

/** A packet to send, whether it may go the fast way (unreliable: the next one replaces it), and whether everyone should get it straight from us where they can (see RoomLink.send). */
export type Out = { d: unknown; fast?: boolean; everyone?: boolean };

/** What a packet that came in means for the screen: a fresh race to switch to, sitting the race out, or the result. */
export type Heard = { race?: Race; sitOut?: true; end?: { w: number | null; order: [number, number][] }; relay?: unknown } | null;

/** Reads a packet from seat `from`. `look`: this player's look, for a race set up from the host's first state. */
export function receive(n: Net, r: Race, o: Seats, from: number, d: unknown, look: () => Look, lag = 0): Heard {
  const p = parsePacket(d);
  if (!p || p.round !== o.round) return null;
  if (p.k === 's') {
    if (from === 0 || from === o.seat) return null;
    // a guest's kart, straight from it through the room (the host passes it on too, later: whichever comes first counts)
    if (!o.isHost) {
      if (n.synced && n.roster.includes(from)) applyCar(n, r, from, p.car);
      return null;
    }
    const prev = n.cars.get(from);
    // (fast packets can overtake each other: an older state never replaces a newer one)
    if (prev && p.car.t !== null && prev.t !== null && prev.t >= p.car.t) return null;
    n.cars.set(from, { seat: from, ...p.car });
    if (p.all) n.all.add(from);
    else n.all.delete(from);
    n.heard.set(from, r.time + lag);
    applyCar(n, r, from, p.car);
    return null;
  }
  if (p.k === 'S') {
    if (o.isHost || from !== 0) return null;
    let race: Race | undefined;
    if (!n.synced) {
      // Left out of the host's race (joined just as it was set): sit it out rather than wait for good.
      if (!p.roster.includes(o.seat)) return { sitOut: true };
      race = onlineRace(o, isCc(p.cc) ? p.cc : r.cc, isCourse(p.course) ? p.course : r.course, p.roster, p.go, look(), n.laps);
      n.roster = p.roster;
      n.synced = true;
    }
    const now = race ?? r;
    for (const car of p.cars) {
      if (car.seat !== o.seat) applyCar(n, now, car.seat, car);
      // our own kart, back from the host: a round trip, to set our clock by
      else if (car.t !== null && car.hold !== undefined && !race) n.host.observe(n.sent.get(car.t) ?? car.t, car.hold / 1000, -p.go, now.time + lag);
    }
    for (const [seat, t, hold] of p.echoes) if (seat === o.seat && !race) n.host.observe(n.sent.get(t) ?? t, hold / 1000, -p.go, now.time + lag);
    return race ? { race } : null;
  }
  if (p.k === 'e') {
    if (p.o === o.seat) return null;
    const age = p.at === null || !n.synced ? 0 : Math.max(0, Math.min(CATCH_MAX, r.time + lag - p.at));
    for (const ev of p.ev) applyEvent(r, p.o, ev, age);
    return o.isHost ? { relay: d } : null;
  }
  if (p.k === 'end') {
    if (from !== 0 || o.isHost || n.end) return null;
    n.end = { w: p.w, order: p.order };
    return { end: n.end };
  }
  return null;
}

/**
 * One network tick: this player's kart (a guest's to everyone, see RoomLink.send; the host's, every guest's and every
 * bot's to everyone), and on the host the call once nobody is still racing. Guests' karts go on to everyone as they
 * come in; one the host has already passed on, or that went to everyone itself (`everyone`: this guest's does, its link
 * to the host going through the room), waits for the next keyframe, which carries every kart reliably. lag: how far
 * the wall clock is ahead of the race (see Pacer.lag), so the host's clock and the round trips are read to the moment.
 */
export function tick(n: Net, r: Race, o: Seats, look: number, lag = 0, everyone = false): { out: Out[]; end?: { w: number | null; order: [number, number][] } } {
  if (!n.synced) return { out: [] };
  n.ticks++;
  const out: Out[] = [];
  const me = r.karts[r.me];
  const car = carOf(me, look, r.time);
  const mine = { ...car, fin: n.dnf ? -2 : car.fin };
  // a kart whose driver left the room is parked out of sight, rather than frozen on the track
  for (const k of r.karts) if (k.kind === 'remote' && !k.left && !o.players.some((p) => p.seat === k.seat) && !o.bots.some((b) => b.seat === k.seat)) park(k);
  const key = n.ticks % KEYFRAME === 0;
  if (!o.isHost) {
    // (when it went, which can be a moment after the state was taken, for timing its round trip through the host; a
    // state sent again, with no frame in between, keeps the time it first went, which is the one the host holds on to)
    if (mine.t !== null && !n.sent.has(mine.t)) {
      n.sent.set(mine.t, r.time + lag);
      if (n.sent.size > 40) n.sent.delete(n.sent.keys().next().value!);
    }
    out.push({ d: guestState(o.round, mine, everyone), fast: !key && mine.fin === -1, everyone: true });
    return { out };
  }
  for (const seat of n.roster) if (!n.bots.has(seat) && !o.players.some((p) => p.seat === seat)) n.gone.add(seat);
  const present = n.roster.filter((seat) => !n.bots.has(seat) && !n.gone.has(seat));
  const bots = r.karts.filter((k) => k.kind === 'cpu' && n.bots.has(k.seat));
  if (r.first !== null && r.time - r.first > TIME_LIMIT) for (const k of bots) if (k.done === null) n.botsOut.add(k.seat);
  const botCars = bots.map((k): Car => {
    const c = carOf(k, -1, r.time);
    return { seat: k.seat, ...c, fin: n.botsOut.has(k.seat) ? -2 : c.fin };
  });
  const guests = present.filter((s) => s !== o.seat && n.cars.has(s)).map((s) => n.cars.get(s)!);
  const fresh = guests
    .filter((c) => key || c.t === null || (c.t > (n.relayed.get(c.seat) ?? -Infinity) && !n.all.has(c.seat)))
    .map((c) => (c.t === null ? c : { ...c, hold: Math.max(0, (r.time + lag - (n.heard.get(c.seat) ?? r.time + lag)) * 1000) }));
  for (const c of fresh) {
    if (c.t === null) continue;
    n.relayed.set(c.seat, c.t);
    n.echoed.set(c.seat, c.t);
  }
  // (and for those that went to everyone themselves, just their sample times back, for each to time its round trip by)
  const echoes: Echo[] = [];
  for (const c of guests) {
    if (c.t === null || !(c.t > (n.echoed.get(c.seat) ?? -Infinity))) continue;
    n.echoed.set(c.seat, c.t);
    echoes.push([c.seat, c.t, (r.time + lag - (n.heard.get(c.seat) ?? r.time + lag)) * 1000]);
  }
  const cars: Car[] = [{ seat: o.seat, ...mine }, ...fresh, ...botCars];
  out.push({ d: hostState(o.round, -(r.time + lag), r.cc, n.roster, cars, r.course, echoes), fast: !key });
  // the host calls the race once nobody still in the room, and no bot, is racing
  const fins: [number, number][] = [...present.map((s): [number, number] => [s, s === o.seat ? mine.fin : n.cars.get(s)?.fin ?? -1]), ...botCars.map((c): [number, number] => [c.seat, c.fin])];
  let end: { w: number | null; order: [number, number][] } | undefined;
  if (!n.end && r.time > 0 && fins.every(([, fin]) => fin !== -1)) {
    const order = finishOrder(fins);
    n.end = end = { w: winnerOf(order), order };
  }
  if (n.end) {
    n.endTicks++;
    // said a few times, then once a second for a minute, for anyone whose connection dropped as it was called
    if (n.endTicks <= 4 || (n.endTicks % 15 === 0 && n.endTicks < 15 * 60)) out.push({ d: endOf(o.round, n.end.w, n.end.order) });
  }
  return { out, end };
}

/**
 * How much race time a guest runs for `dt` of wall clock: a few percent more or less while its clock is off the host's,
 * so the clocks come together without anything on the screen jumping or running fast (its own kart included). Only a
 * clock well off (a race just set up from the host's first word, a long stall) is caught up faster.
 */
export function onHostClock(n: Net, isHost: boolean, dt: number): number {
  if (isHost || dt <= 0) return dt;
  const off = n.host.ahead;
  let fix: number;
  if (off > CLOCK_FAR) fix = Math.min(off, Math.max(dt * 0.5, off - 0.2));
  else if (off < -CLOCK_FAR) fix = Math.max(off, -dt * 0.5);
  else if (Math.abs(off) < CLOCK_NEAR) fix = 0;
  else fix = Math.max(-dt * CLOCK_SLEW, Math.min(dt * CLOCK_SLEW, off));
  n.host.moved(fix);
  return dt + fix;
}

/** Runs the race `dt` seconds on, in steps of at most STEP_MAX, handing each step's events to `each`. */
export function advance(r: Race, dt: number, each: (evs: Ev[], dt: number) => void) {
  let left = dt;
  while (left > 1e-9) {
    const d = Math.min(left, STEP_MAX);
    step(r, d);
    each(r.events.splice(0), d);
    left -= d;
  }
}

/**
 * Keeps an online race on the wall clock: `take(now)` (milliseconds) is how much race time to run now, everything
 * since the last call up to `cap` seconds (the rest is caught up on the next calls, so a long stall doesn't freeze one
 * frame), and never more than BACKLOG_MAX behind.
 */
export class Pacer {
  private last: number | null = null;
  private owed = 0;
  take(now: number, cap: number): number {
    if (this.last !== null) this.owed = Math.min(BACKLOG_MAX, this.owed + Math.max(0, now - this.last) / 1000);
    // (a frame's own time can be a moment before the network tick that just ran: never counted twice)
    if (this.last === null || now > this.last) this.last = now;
    const dt = Math.min(this.owed, cap);
    this.owed -= dt;
    return dt;
  }
  /** How much further on (seconds) the race would be at `now` (milliseconds) had it just run: what is owed, and the time since it last did. */
  lag(now: number): number {
    return this.owed + (this.last === null ? 0 : Math.max(0, now - this.last) / 1000);
  }
  /** Race time still owed (seconds). */
  get behind() {
    return this.owed;
  }
  /** Starts counting from `now` with nothing owed (a race being set up). */
  reset(now: number | null = null) {
    this.last = now;
    this.owed = 0;
  }
}
