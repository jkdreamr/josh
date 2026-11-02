// Light Cycles online in one process: a host and a guest riding against each other over a slow, jittery link, on a
// simulated clock, wired the way the game wires net.ts, or (mode 'old') the way the game was before stamped turns (the
// guest sent bare turns the host made on its next step, and showed only the host's ticks). Used by
// arcade-lightcycles-online.test.ts, and by hand to measure: node tests/lightcycles-sim.ts
import { createArena, step, steer, think, DX, DY, type Arena, type Dir } from '../src/os/arcade/games/lightcycles/cycles.ts';
import { applyTick, dueTurn, Glide, guestView, heard, HostClock, inputDelay, landing, nextWay, PING_MS, planned, prune, queueTurn, takeTurn, type Ahead, type RiderState, type Turn } from '../src/os/arcade/games/lightcycles/net.ts';

/** A seeded random number generator, so a run is the same every time. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One way's network (ms): base latency, extra up to `jitter`, and a `loss` share held up by a retransmit (`rto`). In order, like the reliable channel. */
export type Link = { latency: number; jitter: number; loss?: number; rto?: number };

type Msg = Record<string, unknown> & { type: string };
const READY = 1.8;
/** A frame (seconds): host and guest both draw 60 a second. */
export const FRAME_S = 1 / 60;
const FRAME = FRAME_S;
/** The guest's clock reads this much more than the host's (they never share one). */
const SKEW = 1234.5;

export type Run = {
  /** Frames from a guest's key press to its own cycle moving the new way on its screen. */
  response: number[];
  /** Times its own cycle went back along its path, or a cell it showed was taken back. */
  backward: number;
  /** Frames its own cycle stood still while riding. */
  stalls: number;
  frames: number;
  /** How far its own cycle on its screen was from where the host had it (cells). */
  error: number[];
  /** Turns the host made later than the guest saw them made (steps). */
  late: number[];
  /** Times another rider's head jumped on the guest's screen (more than half a cell in a frame). */
  jumps: number;
  /** The input delay the host settled on (seconds). */
  delay: number;
  /** How far the guest's clock (the step it shows) was ahead of the host's (steps; behind when negative). */
  clock: number[];
};

/**
 * Rides one round, host (seat 0, rider 0) and guest (seat 1, rider 1), with a bot as rider 2 when `bot`. Both people
 * ride a staircase, turning every `every` seconds. `mode` 'old' is the game before stamped turns.
 */
export function ride(mode: 'old' | 'new', link: Link, seed: number, opts: { bot?: boolean; seconds?: number; every?: number } = {}): Run {
  const rand = rng(seed);
  const botRand = rng(seed + 99);
  const seconds = opts.seconds ?? 4;
  const every = opts.every ?? 0.33;
  const count = opts.bot ? 3 : 2;
  const period = 1 / 11;
  const out: Run = { response: [], backward: 0, stalls: 0, frames: 0, error: [], late: [], jumps: 0, delay: 0, clock: [] };

  // The wire: in order each way.
  const pending: { at: number; fn: () => void }[] = [];
  const lastAt = { up: 0, down: 0 };
  const wire = (way: 'up' | 'down', now: number, fn: () => void) => {
    const extra = rand() * link.jitter + (link.loss && rand() < link.loss ? link.rto ?? 200 : 0);
    const at = Math.max(lastAt[way], now + (link.latency + extra) / 1000);
    lastAt[way] = at;
    pending.push({ at, fn });
  };

  // ---- Host ----
  const host = {
    arena: createArena(84, 72, count, 2),
    queue: [] as Turn[][],
    phase: 'ready' as 'ready' | 'run' | 'over',
    timer: READY,
    acc: 0,
    frameAt: 0,
    delay: 0,
    thought: [] as number[],
    trip: null as number | null,
    /** The step each of the guest's turns landed on, by its number (new) or press order (old). */
    landed: [] as number[],
  };
  host.queue = host.arena.riders.map(() => []);
  const hostPhase = (now: number) => {
    const since = Math.max(0, Math.min(0.05, now - host.frameAt));
    if (host.phase === 'ready') return -Math.max(0, host.timer - since) / period;
    if (host.phase === 'run') return host.arena.tick + (host.acc + since) / period;
    return null;
  };
  const toGuest = (now: number, m: Msg) => wire('down', now, () => guestHears(m));
  const hostHears = (m: Msg) => {
    const now = time;
    if (m.type === 'turn') {
      const q = host.queue[1];
      if (mode === 'old') {
        // (the old host: queued as it came, for its next step)
        const d = m.dir as Dir;
        if (q.length < 2 && q[q.length - 1]?.dir !== d) q.push({ dir: d, at: 0, n: m.n as number });
        return;
      }
      const land = takeTurn(q, m.dir as Dir, m.at as number, host.arena.tick);
      if (land !== null) q[q.length - 1].n = m.n as number;
      toGuest(now, { type: 'plan', id: 1, at: land ?? -1, dir: m.dir, n: m.n });
    }
    if (m.type === 'ping') {
      if (typeof m.rtt === 'number') host.trip = m.rtt;
      if (host.phase === 'ready' && host.arena.tick === 0) host.delay = inputDelay([host.trip]);
      toGuest(now, { type: 'pong', t: m.t, ph: hostPhase(now), delay: host.delay });
    }
  };
  const hostPress = (d: Dir) => {
    const r = host.arena.riders[0];
    const q = host.queue[0];
    if (host.phase !== 'run' || !r.alive) return;
    if (mode === 'old') {
      queueTurn(q, r.next, { dir: d, at: 0 });
      return;
    }
    const at = landing(host.arena.tick + host.acc / period, host.delay / period, q.length ? q[q.length - 1].at : 0);
    if (queueTurn(q, r.next, { dir: d, at })) toGuest(time, { type: 'plan', id: 0, at, dir: d });
  };
  const hostFrame = (now: number) => {
    host.frameAt = now;
    if (host.phase === 'ready') {
      host.timer -= FRAME;
      if (host.timer <= 0) host.phase = 'run';
      return;
    }
    if (host.phase !== 'run') return;
    host.acc += FRAME;
    const a = host.arena;
    while (host.acc >= period && host.phase === 'run') {
      host.acc -= period;
      for (const r of a.riders) {
        if (!r.alive) continue;
        if (r.cpu) {
          if (host.thought[r.id] !== a.tick) steer(r, think(a, r, 2, botRand));
          continue;
        }
        const q = host.queue[r.id];
        const was = q.slice();
        const d = dueTurn(q, r.dir, a.tick + 1);
        if (d === null) continue;
        steer(r, d);
        // (the turn made is the last one taken off the queue)
        const n = was[was.length - q.length - 1].n;
        if (r.id === 1 && n !== undefined) host.landed[n] = a.tick + 1;
      }
      step(a);
      if (!a.riders[0].alive || !a.riders[1].alive) host.phase = 'over';
      if (mode === 'new' && host.phase === 'run') {
        for (const r of a.riders) {
          if (!r.alive || !r.cpu) continue;
          steer(r, think(a, r, 2, botRand));
          host.thought[r.id] = a.tick;
        }
      }
      toGuest(now, {
        type: 'tick', tick: a.tick, acc: host.acc, phase: host.phase === 'over' ? 'crash' : 'run',
        riders: a.riders.map(({ id, x, y, dir, next, alive }) => ({ id, x, y, dir, next, alive })),
        ...(mode === 'new' ? { delay: host.delay } : {}),
      });
    }
  };
  /** Where the host has a rider now: its cell, and how far on toward the next. */
  const hostHead = (id: number, now: number) => {
    const r = host.arena.riders[id];
    const f = host.phase === 'run' ? Math.min(1, (host.acc + Math.max(0, now - host.frameAt)) / period) : 0;
    const way = r.cpu ? r.next : nextWay(host.queue[id], r.dir, host.arena.tick + 1);
    return { x: r.x + DX[way] * f, y: r.y + DY[way] * f };
  };

  // ---- Guest ----
  const guest = {
    arena: null as Arena | null,
    queue: [] as Turn[][],
    phase: 'wait' as 'wait' | 'ready' | 'run' | 'over',
    timer: 0,
    acc: 0,
    delay: 0,
    lockstep: false,
    sent: 0,
    ahead: null as Ahead | null,
    shown: 0,
    clock: new HostClock(),
  };
  const guestHears = (m: Msg) => {
    const local = time + SKEW;
    if (m.type === 'round') {
      guest.arena = createArena(84, 72, count, count);
      guest.queue = guest.arena.riders.map(() => []);
      guest.lockstep = typeof m.delay === 'number';
      guest.delay = (m.delay as number) ?? 0;
      guest.phase = 'ready';
      guest.timer = READY;
      guest.clock.reset(period);
      return;
    }
    if (!guest.arena) return;
    if (m.type === 'tick') {
      applyTick(guest.arena, m.riders as RiderState[], m.tick as number);
      if (typeof m.delay === 'number') guest.delay = m.delay;
      prune(guest.queue, guest.arena.tick, 1);
      guest.acc = m.acc as number;
      guest.phase = m.phase === 'crash' ? 'over' : 'run';
      if (guest.lockstep) guest.clock.tick(guest.arena.tick + guest.acc / period, local);
    }
    if (m.type === 'plan') {
      const q = guest.queue[m.id as number];
      if (m.id === 1) heard(q, m.n as number, m.at as number);
      else if ((m.at as number) > guest.arena.tick) planned(q, m.dir as Dir, m.at as number);
    }
    if (m.type === 'pong') {
      guest.clock.pong(m.t as number, m.ph as number | null, local);
      if (guest.lockstep) guest.delay = m.delay as number;
    }
  };
  const toHost = (now: number, m: Msg) => wire('up', now, () => hostHears(m));
  /** The guest's own presses: when, which way, and (old) the step it saw coming. */
  const presses: { at: number; dir: Dir; n: number; meant: number }[] = [];
  const guestPress = (d: Dir) => {
    const a = guest.arena;
    if (!a || guest.phase !== 'run') return;
    const r = a.riders[1];
    if (!guest.lockstep) {
      // (the old guest: straight to the host; it lands on the host's next step after it gets there)
      if (!r.alive) return;
      const n = ++guest.sent;
      presses.push({ at: time, dir: d, n, meant: a.tick + 1 });
      toHost(time, { type: 'turn', dir: d, n });
      return;
    }
    if (!guest.ahead) return;
    const q = guest.queue[1];
    const turn: Turn = { dir: d, at: landing(guest.shown, guest.delay / period, q.length ? q[q.length - 1].at : 0), n: guest.sent + 1, heard: false };
    const heading = q.length ? q[q.length - 1].dir : guest.ahead.next[1];
    if (!queueTurn(q, heading, turn)) return;
    guest.sent++;
    presses.push({ at: time, dir: d, n: turn.n!, meant: turn.at });
    toHost(time, { type: 'turn', dir: d, at: turn.at, n: turn.n, r: 1 });
  };
  /** What the guest draws for a rider (as the game's render does): the cells of its wall and where its head is. */
  const glide = new Glide();
  const drawn = (id: number) => {
    const a = guest.arena!;
    const r = a.riders[id];
    if (guest.ahead) {
      const ahead = guest.ahead;
      const frac = Math.max(0, Math.min(1, guest.shown - ahead.to));
      const f = ahead.blocked[id] ? Math.min(frac, 0.5) : frac;
      const way = ahead.next[id];
      const head = glide.at(id, ahead.x[id] + DX[way] * f, ahead.y[id] + DY[way] * f, FRAME, 1 / period);
      return { cells: r.trail.concat(ahead.cells[id]), x: head.x, y: head.y, f };
    }
    const f = guest.phase === 'run' ? Math.min(1, guest.acc / period) : 0;
    return { cells: r.trail.slice(), x: r.x + DX[r.dir] * f, y: r.y + DY[r.dir] * f, f };
  };
  let before: ReturnType<typeof drawn> | null = null;
  const othersBefore = new Map<number, { x: number; y: number }>();
  const guestFrame = (now: number) => {
    const local = now + SKEW;
    const a = guest.arena;
    if (!a) return;
    if (guest.phase === 'ready') {
      guest.timer -= FRAME;
      const est = guest.lockstep ? guest.clock.phase(local) : null;
      if (est !== null) guest.timer = Math.min(guest.timer, -est * period);
      if (guest.timer <= 0) guest.phase = 'run';
      return;
    }
    if (guest.phase !== 'run') return;
    guest.acc += FRAME;
    if (guest.lockstep) {
      const view = guestView(a, guest.queue, 1, guest.clock.phase(local) ?? a.tick + Math.min(1, guest.acc / period), period);
      guest.ahead = view.ahead;
      guest.shown = view.shown;
    }
    const heads = a.riders.map((r) => drawn(r.id));
    // Measure, while both people ride on the host.
    if (host.phase !== 'run' || a.tick < 1) return;
    const me = heads[1];
    const truth = hostHead(1, now);
    out.frames++;
    out.error.push(Math.hypot(me.x - truth.x, me.y - truth.y));
    if (guest.ahead) out.clock.push(guest.shown - (host.arena.tick + (host.acc + now - host.frameAt) / period));
    if (before) {
      const moved = me.cells.length - 1 + me.f - (before.cells.length - 1 + before.f);
      const rewritten = before.cells.some((c, i) => i < me.cells.length && me.cells[i] !== c);
      if (moved < -0.02 || rewritten) out.backward++;
      if (moved < 0.02) out.stalls++;
    }
    before = me;
    for (let id = 0; id < count; id++) {
      if (id === 1 || !a.riders[id].alive) continue;
      const d = heads[id];
      const was = othersBefore.get(id);
      if (was && Math.hypot(d.x - was.x, d.y - was.y) > 0.5) out.jumps++;
      othersBefore.set(id, { x: d.x, y: d.y });
    }
    // Presses still waiting to show: the cycle moved the new way this frame.
    for (const p of presses) {
      if ((p as { shown?: boolean }).shown || !prev) continue;
      if ((me.x - prev.x) * DX[p.dir] + (me.y - prev.y) * DY[p.dir] > 0.05) {
        (p as { shown?: boolean }).shown = true;
        out.response.push(Math.ceil((now - p.at) / FRAME - 1e-9));
      }
    }
    prev = { x: me.x, y: me.y };
  };
  let prev: { x: number; y: number } | null = null;

  // ---- The run: a round packet, a countdown, then both ride their staircases ----
  let time = 0;
  toGuest(0, { type: 'round', ...(mode === 'new' ? { delay: (host.delay = inputDelay([null])) } : {}) });
  const end = READY + seconds;
  let nextPing = 0.05;
  let hostTurns = READY + 0.2;
  let guestTurns = READY + 0.37;
  let hostWay = 0;
  let guestWay = 0;
  for (let ms = 0; ms <= end * 1000; ms++) {
    time = ms / 1000;
    pending.sort((p, q) => p.at - q.at);
    while (pending.length && pending[0].at <= time) pending.shift()!.fn();
    if (mode === 'new' && time >= nextPing) {
      nextPing += PING_MS / 1000;
      toHost(time, { type: 'ping', t: time + SKEW, rtt: guest.clock.trip ?? undefined });
    }
    if (time >= hostTurns) {
      hostTurns += every;
      hostPress(([0, 1] as Dir[])[hostWay++ % 2]);
    }
    if (time >= guestTurns) {
      guestTurns += every;
      guestPress(([2, 3] as Dir[])[guestWay++ % 2]);
    }
    // (60 frames a second each, the guest's 7 ms after the host's; counted in whole numbers, so none is lost or doubled)
    if (Math.floor((ms * 3) / 50) !== Math.floor(((ms - 1) * 3) / 50)) hostFrame(time);
    if (ms >= 7 && Math.floor(((ms - 7) * 3) / 50) !== Math.floor(((ms - 8) * 3) / 50)) guestFrame(time);
  }
  for (const p of presses) {
    const landed = host.landed[p.n];
    if (landed !== undefined) out.late.push(landed - p.meant);
  }
  out.delay = host.delay;
  return out;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);
export const summary = (r: Run) => ({
  delayMs: Math.round(r.delay * 1000),
  responseFrames: `${mean(r.response).toFixed(1)} mean, ${Math.max(0, ...r.response)} max`,
  backward: r.backward,
  stallFrames: `${r.stalls} of ${r.frames}`,
  errorCells: `${mean(r.error).toFixed(2)} mean, ${pct(r.error, 0.95).toFixed(2)} p95, ${Math.max(0, ...r.error).toFixed(2)} max`,
  lateTurns: `${r.late.filter((n) => n > 0).length} of ${r.late.length} (${mean(r.late).toFixed(2)} steps mean)`,
  otherJumps: r.jumps,
  clockSteps: r.clock.length ? `${mean(r.clock).toFixed(2)} mean, ${Math.min(...r.clock).toFixed(2)} to ${Math.max(...r.clock).toFixed(2)}` : '',
});

export const LINKS: [string, Link][] = [
  ['RTT 60-100 ms', { latency: 30, jitter: 20 }],
  ['RTT 120-180 ms', { latency: 60, jitter: 30 }],
  ['RTT 120-180 ms, 1% held 200 ms', { latency: 60, jitter: 30, loss: 0.01, rto: 200 }],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, link] of LINKS) {
    for (const bot of [false, true]) {
      for (const seed of [1, 2, 3]) {
        console.log(name, bot ? 'with a bot' : '', 'seed', seed);
        console.log('  before', summary(ride('old', link, seed, { bot })));
        console.log('  after ', summary(ride('new', link, seed, { bot })));
      }
    }
  }
}
