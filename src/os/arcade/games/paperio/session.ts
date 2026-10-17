// Online rounds: the host and guest controllers. Pure (no DOM): everything goes through the Net interface, so a host
// and guests can be run against each other in node with an in-memory room.
//
// Responsiveness first. Every client moves its own head locally with no input lag and reports its path at 30 Hz
// (each report repeats the two before it, so a lost packet costs nothing). The host walks those reported paths
// through the same rules as everyone else, runs the bots, and is the only one who decides kills and captures. It
// broadcasts numbered board ops (reliable) and head states at 20 Hz (fast). Guests predict their own captures and
// own-trail crashes so those feel instant, draw everyone else 100 ms in the past between states, and compare a board
// hash with the host's now and then; anything out of step (a gap in the ops, a hash that disagrees twice) asks the
// host for a snapshot of the whole board.
import type { Level } from './bots.ts';
import { lerpPose, type Ctl, type Net, type Pose } from './ctl.ts';
import { HUMAN_RESPAWN, createMatch, finish, matchTick, standings, type Match } from './match.ts';
import {
  F_ALIVE,
  F_OUT,
  decodeRows,
  endPacket,
  helloPacket,
  initPacket,
  movePacket,
  opPackets,
  parsePacket,
  pausePacket,
  quant,
  resyncPacket,
  snapshotPackets,
  splitOp,
  statePacket,
  type HeadState,
  type NetOp,
  type Packet,
  type RosterEntry,
  type SnapPlayer,
} from './net.ts';
import { PALETTE, skinOf } from './skins.ts';
import {
  RADIUS,
  TICK,
  addPlayer,
  applyDeath,
  applyRuns,
  clearTrail,
  createWorld,
  drive,
  driveTo,
  kill,
  loadOwners,
  ownerHash,
  percent,
  spawnAt,
  step,
  type Player,
  type World,
} from './world.ts';

/** Seconds of countdown before an online round moves. */
export const GO = 3;
/** Remote heads are drawn this far in the past, between two states. */
export const DELAY = 0.1;
const STATE_EVERY = 1 / 20;
const HASH_EVERY = 1;
/** A guest that hears nothing from the host for this long holds still: the host's round has stopped (a phone asleep). */
const SILENT = 1;

export type OnlineOpts = { skin: number; fill: number; level: Level; length: number; seed?: number };

// ---------------------------------------------------------------------------------------------------------------
// Interpolation track for a head seen from afar

export class Track {
  private t = new Float64Array(24);
  private x = new Float64Array(24);
  private y = new Float64Array(24);
  private h = new Float64Array(24);
  private f = new Uint8Array(24);
  private n = 0;

  reset() {
    this.n = 0;
  }

  /** Adds a sample; anything not newer than the last one (late or duplicated packets) is dropped. */
  push(time: number, x: number, y: number, h: number, f: number) {
    if (this.n && time <= this.t[this.n - 1]) return;
    if (this.n === this.t.length) {
      this.t.copyWithin(0, 1);
      this.x.copyWithin(0, 1);
      this.y.copyWithin(0, 1);
      this.h.copyWithin(0, 1);
      this.f.copyWithin(0, 1);
      this.n--;
    }
    const i = this.n++;
    this.t[i] = time;
    this.x[i] = x;
    this.y[i] = y;
    this.h[i] = h;
    this.f[i] = f;
  }

  get size() {
    return this.n;
  }

  /** Pose at `time`: between the samples around it, held (a short extrapolation at most) past the newest. Returns the flags. */
  sample(time: number, out: Pose): number {
    const n = this.n;
    if (!n) return 0;
    const t = this.t;
    if (time <= t[0]) {
      out.x = this.x[0];
      out.y = this.y[0];
      out.h = this.h[0];
      return this.f[0];
    }
    for (let i = n - 1; i > 0; i--) {
      if (t[i - 1] <= time && time <= t[i]) {
        const k = (time - t[i - 1]) / Math.max(1e-6, t[i] - t[i - 1]);
        // a jump (a respawn) snaps instead of sliding across the map
        const dx = this.x[i] - this.x[i - 1];
        const dy = this.y[i] - this.y[i - 1];
        if (dx * dx + dy * dy > 40 * 40) {
          out.x = this.x[i];
          out.y = this.y[i];
          out.h = this.h[i];
          return this.f[i];
        }
        out.x = this.x[i - 1] + dx * k;
        out.y = this.y[i - 1] + dy * k;
        const dh = Math.atan2(Math.sin(this.h[i] - this.h[i - 1]), Math.cos(this.h[i] - this.h[i - 1]));
        out.h = this.h[i - 1] + dh * k;
        return k < 0.5 ? this.f[i - 1] : this.f[i];
      }
    }
    // past the newest: carry on along the heading for a moment, then hold
    const i = n - 1;
    const ahead = Math.min(0.15, time - t[i]);
    const prev = Math.max(0, i - 1);
    const span = t[i] - t[prev];
    const vx = span > 0 ? (this.x[i] - this.x[prev]) / span : 0;
    const vy = span > 0 ? (this.y[i] - this.y[prev]) / span : 0;
    out.x = this.x[i] + (vx * vx + vy * vy < 80 * 80 ? vx * ahead : 0);
    out.y = this.y[i] + (vx * vx + vy * vy < 80 * 80 ? vy * ahead : 0);
    out.h = this.h[i];
    return this.f[i];
  }
}

const posePlaceholder = (): Pose => ({ x: 0, y: 0, h: 0, alive: false, out: false });

/** A guest's skin decides its color when that color is still free. */
function lookFor(w: World, id: number, skin: number): number {
  const want = skinOf(skin).color;
  const taken = new Set(w.players.filter((p) => p && p.id !== id).map((p) => p.color));
  if (!taken.has(want)) return want;
  return w.players[id]?.color ?? [...PALETTE.keys()].find((c) => !taken.has(c)) ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Host

export function hostCtl(net: Net, opts: OnlineOpts): Ctl {
  const seats = [...net.players()].sort((a, b) => a.seat - b.seat);
  const humans = seats.map((s) => ({ name: s.name.slice(0, 16) || `player ${s.seat + 1}`, skin: s.seat === net.seat ? opts.skin : (s.seat * 5) % 3, kind: (s.seat === net.seat ? 'local' : 'remote') as 'local' | 'remote', seat: s.seat }));
  const bots = opts.fill > 0 ? Math.max(0, Math.min(16, opts.fill) - humans.length) : 0;
  const m: Match = createMatch({ seed: opts.seed ?? ((Math.random() * 2 ** 31) | 0), humans, bots, level: opts.level, respawn: true, duration: opts.length * 60 });
  const w = m.w;
  const round = net.round;
  const bySeat = new Map<number, number>();
  for (const p of w.players) if (p.seat >= 0) bySeat.set(p.seat, p.id);
  const lives = new Int32Array(16);
  const lastSample = new Int32Array(16).fill(-1);
  const tracks = Array.from({ length: 16 }, () => new Track());
  const gone = new Set<number>();
  let pending: NetOp[] = [];
  let seq = 0;
  let snap = 0;
  let go = GO;
  let clock = 0;
  let stateIn = 0;
  let hashIn = 0;
  let result: { winner: number | null; order: number[]; winnerSeat: number | null } | null = null;
  /** The host's page is hidden, so its round is not running: guests hold still, and their moves wait here. */
  let away = false;
  let held: { id: number; pk: Extract<Packet, { k: 'M' }> }[] = [];
  // Everyone this round is for (late joiners sit it out, so none of it goes their way).
  const roundSeats = seats.map((s) => s.seat).filter((seat) => seat !== net.seat);

  // the board so far, as ops in the order it was built
  for (const p of w.players) {
    if (!p.alive) continue;
    pending.push({ k: 'spawn', id: p.id, cx: Math.floor(p.x), cy: Math.floor(p.y), h: p.h });
    lives[p.id]++;
  }
  w.onOp = (op) => {
    if (op.k === 'spawn') {
      lives[op.id]++;
      lastSample[op.id] = -1;
      tracks[op.id].reset();
    }
    pending.push(op);
  };

  const roster = (): RosterEntry[] => w.players.map((p) => ({ id: p.id, seat: p.seat, name: p.name, color: p.color, skin: p.skin, bot: p.kind === 'bot' }));
  const snapPlayers = (): SnapPlayer[] => w.players.map((p) => ({ id: p.id, alive: p.alive, x: p.x, y: p.y, h: p.h, out: p.out, life: lives[p.id] }));

  /** To every seat playing this round that is still in the room. */
  function sendAll(pk: unknown, fast = false) {
    const here = net.players();
    for (const seat of roundSeats) if (here.some((p) => p.seat === seat)) net.send(pk, fast ? { to: seat, fast } : { to: seat });
  }

  function flush() {
    if (!pending.length) return;
    const ops = pending.flatMap((op) => splitOp(op));
    pending = [];
    const first = seq + 1;
    seq += ops.length;
    for (const pk of opPackets(round, first, ops)) sendAll(pk);
  }

  /** Once the round is over: the result, the last ops, then the end for everyone, right away (the loop stops now). */
  function conclude() {
    if (!m.over || result) return;
    const order = standings(m);
    const winnerSeat = m.winner === null ? null : (w.players[m.winner]?.seat ?? null);
    result = { winner: m.winner, order, winnerSeat: winnerSeat !== null && winnerSeat >= 0 ? winnerSeat : null };
    flush();
    sendAll(endPacket(round, result.winner, result.order, result.order.map((id) => percent(w, id))));
    net.report(result.winnerSeat);
  }

  /** Walks a guest's reported path through the rules. */
  function applyMove(id: number, pk: Extract<Packet, { k: 'M' }>) {
    const p = w.players[id];
    if (!p || p.kind !== 'remote' || pk.life !== lives[id]) return;
    const count = pk.pts.length / 2;
    for (let i = 0; i < count; i++) {
      const s = pk.seq - (count - 1 - i);
      if (s <= lastSample[id]) continue;
      lastSample[id] = s;
      let x = pk.pts[i * 2];
      let y = pk.pts[i * 2 + 1];
      // keep reported heads inside the arena
      const dx = x - w.c;
      const dy = y - w.c;
      const lim = w.r - 2;
      const dd = Math.hypot(dx, dy);
      if (dd > lim) {
        x = quant(w.c + (dx / dd) * lim);
        y = quant(w.c + (dy / dd) * lim);
      }
      driveTo(w, p, x, y, pk.h);
      tracks[id].push(clock, x, y, pk.h, (p.alive ? F_ALIVE : 0) | (p.out ? F_OUT : 0));
      if (!p.alive) break;
    }
    if (pk.dead && p.alive) kill(w, p, -1, 'self');
  }

  function sendSnapshot(to: number) {
    flush();
    snap++;
    for (const pk of snapshotPackets(round, snap, seq, w.owner, w.n, snapPlayers())) net.send(pk, { to });
  }

  const off = net.onMessage((from, d) => {
    const pk = parsePacket(d);
    if (!pk || pk.round !== round || from === net.seat) return;
    const id = bySeat.get(from);
    if (pk.k === 'H') {
      if (id === undefined) return;
      const p = w.players[id];
      if (p.skin !== pk.skin) {
        p.skin = pk.skin;
        p.color = lookFor(w, id, pk.skin);
        pending.push({ k: 'look', id, color: p.color, skin: p.skin });
      }
      flush();
      net.send(initPacket(round, w.r, m.opts.duration, go, roster()), { to: from });
      sendSnapshot(from);
      if (away) net.send(pausePacket(round, true), { to: from });
      return;
    }
    if (pk.k === 'Q') {
      if (id !== undefined) sendSnapshot(from);
      return;
    }
    if (pk.k !== 'M' || id === undefined || go > 0 || m.over) return;
    // while the host is away nothing moves; the few moves already on their way are walked when it is back
    if (away) {
      if (held.length < 600) held.push({ id, pk });
      return;
    }
    applyMove(id, pk);
  });

  const heads: HeadState[] = [];
  let seen: { seat: number }[] | null = null;

  return {
    w,
    locals: [bySeat.get(net.seat) ?? 0],
    duration: m.opts.duration,
    elapsed: () => m.elapsed,
    tick() {
      if (away) return;
      if (go > 0) {
        go = Math.max(0, go - TICK);
        return;
      }
      if (m.over) return;
      // bots and the host's own head move here; remote heads moved as their reports came in
      matchTick(m);
      conclude();
    },
    frame(dt) {
      clock += dt;
      // players who left the room are out for good
      const now = net.players();
      if (now !== seen) {
        seen = now;
        for (const [seat, id] of bySeat) {
          if (now.some((p) => p.seat === seat) || gone.has(id)) continue;
          gone.add(id);
          const p = w.players[id];
          if (p.alive) kill(w, p, -1, 'left');
        }
      }
      for (const id of gone) w.players[id].respawnAt = -1;
      flush();
      stateIn -= dt;
      hashIn -= dt;
      if (stateIn <= 0) {
        stateIn = STATE_EVERY;
        heads.length = 0;
        for (const p of w.players) {
          if (!p) continue;
          heads.push({ id: p.id, x: p.x, y: p.y, h: p.h, f: (p.alive ? F_ALIVE : 0) | (p.out ? F_OUT : 0), kills: p.kills, life: lives[p.id] });
        }
        const hash = hashIn <= 0 ? ownerHash(w) : null;
        if (hashIn <= 0) hashIn = HASH_EVERY;
        sendAll(statePacket(round, w.tick, m.elapsed, go, seq, hash, heads), true);
      }
    },
    isOver: () => m.over,
    winner: () => m.winner,
    pose(p, alpha, out) {
      if (p.kind === 'remote' && tracks[p.id].size) {
        tracks[p.id].sample(clock - DELAY, out);
        out.alive = p.alive;
        out.out = p.out;
        return;
      }
      lerpPose(p, alpha, out);
    },
    respawnIn: (p) => (p.respawnAt > 0 && p.respawnAt !== Infinity ? Math.max(0, p.respawnAt - w.time) : p.respawnAt < 0 ? null : HUMAN_RESPAWN),
    countdown: () => go,
    dispose() {
      off();
      w.onOp = null;
    },
    online: {
      ready: () => true,
      finish() {
        if (!m.over) finish(m);
        conclude();
      },
      result() {
        conclude();
        return result ?? { winner: m.winner, order: standings(m), winnerSeat: null };
      },
      status: () => null,
      setAway(on) {
        if (on === away || result) return;
        away = on;
        flush();
        sendAll(pausePacket(round, on));
        if (!on) {
          const list = held;
          held = [];
          for (const h of list) if (!m.over) applyMove(h.id, h.pk);
        }
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Guest

export function guestCtl(net: Net, opts: OnlineOpts): Ctl {
  const round = net.round;
  let w: World = createWorld({ radius: RADIUS, authority: false });
  let me = -1;
  let inited = false;
  let version = 0;
  let duration = Infinity;
  let elapsed = 0;
  let go = GO;
  let hostClock = -1;
  let applied = 0;
  const buffer = new Map<number, NetOp>();
  let gapSince = -1;
  let life = 0;
  let sampleSeq = 0;
  let ticks = 0;
  const samples: number[] = [];
  const tracks = Array.from({ length: 16 }, () => new Track());
  const killsSeen = new Int32Array(16);
  const aliveDiff = new Float64Array(16).fill(-1);
  let helloIn = 0;
  let resyncIn = 0;
  let hashMiss = 0;
  let predicted = 0;
  let predictedAt = -99;
  let clock = 0;
  let deadSends = 0;
  let snapAt: { snap: number; seq: number; parts: number; got: Map<number, { y0: number; rows: number[][] }>; players: SnapPlayer[] } | null = null;
  let snapLoaded = false;
  let result: { winner: number | null; order: number[]; winnerSeat: number | null } | null = null;
  let ended = false;
  /** The host said its page is hidden; and when its last state arrived (silence means the same thing). */
  let hostAway = false;
  let stateAt = -1;
  const ghostOff = new Float64Array(16).fill(-1);
  const pose = posePlaceholder();

  /** Holding still: the host's round is not running, so nothing here may move either. */
  const held = () => hostAway || (snapLoaded && stateAt >= 0 && clock - stateAt > SILENT);

  function setup(roster: RosterEntry[], radius: number) {
    w = createWorld({ radius, authority: false });
    const sorted = [...roster].sort((a, b) => a.id - b.id);
    for (const r of sorted) {
      const mine = r.seat === net.seat && !r.bot;
      const p = addPlayer(w, { id: r.id, name: r.name, color: r.color, skin: r.skin, kind: mine ? 'local' : 'ghost', seat: r.bot ? -1 : r.seat });
      if (mine) {
        p.manual = true;
        me = r.id;
      }
    }
    // fill any holes so ids index players
    for (let i = 0; i < w.players.length; i++) if (!w.players[i]) addPlayer(w, { id: i, name: '', color: 0, kind: 'ghost' });
    inited = true;
    version++;
  }

  function applyOp(op: NetOp) {
    const p = w.players[op.id];
    if (!p) return;
    if (op.k === 'spawn') {
      spawnAt(w, p, op.cx, op.cy, op.h);
      if (op.id === me) {
        life++;
        samples.length = 0;
        deadSends = 0;
      } else {
        tracks[op.id].reset();
        tracks[op.id].push(hostClock, p.x, p.y, p.h, F_ALIVE);
      }
      return;
    }
    if (op.k === 'look') {
      p.color = op.color;
      p.skin = op.skin;
      version++;
      return;
    }
    if (op.k === 'die') {
      applyDeath(w, op.id, op.by, op.cause);
      return;
    }
    // a capture
    if (op.id === me) {
      if ('more' in op) {
        applyRuns(w, op.id, op.runs);
        return;
      }
      if (predicted > 0) {
        predicted--;
        applyRuns(w, op.id, op.runs);
        return;
      }
      // the host closed a loop we did not see coming: follow it
      const before = w.counts[me + 1];
      const seeds = p.trail.slice(0, p.trailLen);
      if (p.out) {
        clearTrail(w, p);
        p.out = false;
      }
      applyRuns(w, op.id, op.runs);
      w.events.push({ t: 'capture', id: me, gained: w.counts[me + 1] - before, cells: seeds, x: p.x, y: p.y });
      return;
    }
    const before = w.counts[op.id + 1];
    const seeds = 'more' in op ? new Int32Array(0) : p.trail.slice(0, p.trailLen);
    if (!('more' in op)) clearTrail(w, p);
    applyRuns(w, op.id, op.runs);
    w.events.push({ t: 'capture', id: op.id, gained: w.counts[op.id + 1] - before, cells: seeds, x: p.x, y: p.y });
  }

  function drain() {
    while (buffer.has(applied + 1)) {
      const op = buffer.get(applied + 1)!;
      buffer.delete(applied + 1);
      applied++;
      applyOp(op);
    }
    gapSince = buffer.size ? (gapSince < 0 ? clock : gapSince) : -1;
  }

  function loadSnapshot() {
    if (!snapAt) return;
    const s = snapAt;
    snapAt = null;
    const grid = new Uint8Array(w.n * w.n);
    for (const part of s.got.values()) if (!decodeRows(grid, w.n, part.y0, part.rows)) return;
    loadOwners(w, grid);
    applied = s.seq;
    for (const k of [...buffer.keys()]) if (k <= applied) buffer.delete(k);
    predicted = 0;
    hashMiss = 0;
    for (const sp of s.players) {
      const p = w.players[sp.id];
      if (!p) continue;
      if (sp.id === me) {
        life = sp.life;
        if (sp.alive && !p.alive) {
          p.alive = true;
          p.joined = true;
          p.x = p.px = p.rx = quant(sp.x);
          p.y = p.py = p.ry = quant(sp.y);
          p.h = p.ph = sp.h;
          p.out = false;
          p.trailLen = 0;
          samples.length = 0;
        } else if (!sp.alive && p.alive) {
          p.alive = false;
          clearTrail(w, p);
        }
        continue;
      }
      p.joined = p.joined || sp.alive;
      if (p.alive !== sp.alive) {
        p.alive = sp.alive;
        if (!sp.alive) clearTrail(w, p);
      }
      p.x = p.rx = sp.x;
      p.y = p.ry = sp.y;
      p.h = sp.h;
      tracks[sp.id].reset();
      tracks[sp.id].push(hostClock, sp.x, sp.y, sp.h, (sp.alive ? F_ALIVE : 0) | (sp.out ? F_OUT : 0));
    }
    snapLoaded = true;
    drain();
  }

  const off = net.onMessage((from, d) => {
    if (from !== 0) return;
    const pk = parsePacket(d);
    if (!pk || pk.round !== round) return;
    if (pk.k === 'I') {
      if (inited) return;
      if (!pk.roster.some((r) => r.seat === net.seat && !r.bot)) return; // joined after this round began
      setup(pk.roster, pk.radius);
      duration = pk.duration;
      go = pk.go;
      return;
    }
    if (pk.k === 'O') {
      for (let i = 0; i < pk.ops.length; i++) {
        const s = pk.seq + i;
        if (s > applied) buffer.set(s, pk.ops[i]);
      }
      if (inited && snapLoaded) drain();
      return;
    }
    if (pk.k === 'Z') {
      if (!inited) return;
      if (!snapAt || snapAt.snap !== pk.snap) snapAt = { snap: pk.snap, seq: pk.seq, parts: pk.parts, got: new Map(), players: [] };
      snapAt.got.set(pk.part, { y0: pk.y0, rows: pk.rows });
      if (pk.part === 0) snapAt.players = pk.players;
      if (snapAt.got.size === snapAt.parts) loadSnapshot();
      return;
    }
    if (pk.k === 'P') {
      hostAway = pk.away;
      if (!hostAway) stateAt = clock;
      return;
    }
    if (pk.k === 'S') {
      if (!inited) return;
      stateAt = clock;
      const t = pk.tick / 60;
      if (hostClock < 0 || Math.abs(hostClock - t) > 0.5) hostClock = t;
      else if (t > hostClock) hostClock += (t - hostClock) * 0.15;
      go = pk.go;
      if (Math.abs(elapsed - pk.elapsed) > 0.25) elapsed = pk.elapsed;
      for (const hs of pk.heads) {
        const p = w.players[hs.id];
        if (!p) continue;
        killsSeen[hs.id] = hs.kills;
        if (p.kills < hs.kills) p.kills = hs.kills;
        const hostAlive = (hs.f & F_ALIVE) !== 0;
        // the ops decide who lives; if a state disagrees for a whole second, believe it
        if (hostAlive !== p.alive) {
          if (aliveDiff[hs.id] < 0) aliveDiff[hs.id] = clock;
          else if (clock - aliveDiff[hs.id] > 1) {
            aliveDiff[hs.id] = -1;
            if (hs.id === me) {
              if (!hostAlive) {
                p.alive = false;
                clearTrail(w, p);
              } else if (hs.life !== life) {
                life = hs.life;
                p.alive = true;
                p.joined = true;
                p.x = p.px = p.rx = quant(hs.x);
                p.y = p.py = p.ry = quant(hs.y);
                p.out = false;
                samples.length = 0;
              }
            } else {
              p.alive = hostAlive;
              p.joined = true;
              if (!hostAlive) clearTrail(w, p);
            }
          }
        } else aliveDiff[hs.id] = -1;
        if (hs.id !== me) tracks[hs.id].push(t, hs.x, hs.y, hs.h, hs.f);
      }
      // compare boards when we are exactly where the host was and nothing of ours is still in flight
      if (pk.hash !== null && snapLoaded && pk.seq === applied && predicted === 0 && clock - predictedAt > 1.5) {
        if (ownerHash(w) === pk.hash) hashMiss = 0;
        else if (++hashMiss >= 2) requestResync();
      }
      return;
    }
    if (pk.k === 'E') {
      if (ended) return;
      ended = true;
      const winnerSeat = pk.winner === null ? null : (w.players[pk.winner]?.seat ?? null);
      result = { winner: pk.winner, order: pk.order, winnerSeat: winnerSeat !== null && winnerSeat >= 0 ? winnerSeat : null };
      net.report(result.winnerSeat);
    }
  });

  function requestResync() {
    if (resyncIn > 0) return;
    resyncIn = 3;
    hashMiss = 0;
    net.send(resyncPacket(round));
  }

  function sendMove(p: Player, dead: boolean) {
    sampleSeq++;
    net.send(movePacket(round, life, sampleSeq, samples, p.h, dead), { fast: true });
  }

  return {
    get w() {
      return w;
    },
    get locals() {
      return me >= 0 ? [me] : [];
    },
    get duration() {
      return duration;
    },
    elapsed: () => elapsed,
    tick() {
      if (!inited || held()) return;
      if (go > 0) {
        go = Math.max(0, go - TICK);
        return;
      }
      if (ended) return;
      elapsed += TICK;
      step(w);
      const p = w.players[me];
      if (!p || !p.alive || !snapLoaded) return;
      ticks++;
      if (ticks % 2 !== 0) return;
      // our rules position follows the head in the same steps the host will walk
      const wasOut = p.out;
      const qx = quant(p.x);
      const qy = quant(p.y);
      drive(w, p, qx, qy);
      if (wasOut && !p.out && p.alive) {
        predicted++;
        predictedAt = clock;
      }
      samples.push(qx, qy);
      if (samples.length > 6) samples.splice(0, samples.length - 6);
      sendMove(p, !p.alive);
    },
    frame(dt) {
      clock += dt;
      if (hostClock >= 0) hostClock += dt;
      if (!inited || !snapLoaded) {
        helloIn -= dt;
        if (helloIn <= 0) {
          helloIn = 0.6;
          net.send(helloPacket(round, opts.skin));
        }
      }
      resyncIn -= dt;
      // a capture we predicted that the host never confirmed stops blocking the board check
      if (predicted > 0 && clock - predictedAt > 2.5) predicted = 0;
      if (gapSince >= 0 && clock - gapSince > 1.5) {
        gapSince = clock;
        requestResync();
      }
      const p = w.players[me];
      if (p && !p.alive && p.joined && deadSends < 3 && samples.length) {
        deadSends++;
        sendMove(p, true);
      }
      // everyone else: drawn a moment in the past, their trails drawn where they are seen
      const at = hostClock - DELAY;
      for (const g of w.players) {
        if (!g || g.id === me || !g.alive) continue;
        const flags = tracks[g.id].sample(at, pose);
        if (!tracks[g.id].size) continue;
        g.px = g.x;
        g.py = g.y;
        g.ph = g.h;
        g.x = pose.x;
        g.y = pose.y;
        g.h = pose.h;
        const out = (flags & F_OUT) !== 0;
        // a jump (missed states, a respawn) moves the head without drawing a trail across the map
        if (Math.abs(g.x - g.rx) + Math.abs(g.y - g.ry) > 40) {
          g.rx = g.x;
          g.ry = g.y;
        }
        if (out) {
          ghostOff[g.id] = -1;
          if (!g.out) {
            g.out = true;
            g.rx = g.x;
            g.ry = g.y;
          }
          drive(w, g, g.x, g.y);
        } else {
          g.rx = g.x;
          g.ry = g.y;
          // home: their capture op clears the trail; if it never comes, let it go after a moment
          if (g.out) {
            if (ghostOff[g.id] < 0) ghostOff[g.id] = clock;
            else if (clock - ghostOff[g.id] > 0.5) {
              ghostOff[g.id] = -1;
              clearTrail(w, g);
              g.out = false;
            }
          }
        }
      }
    },
    isOver: () => ended,
    winner: () => result?.winner ?? null,
    pose(p, alpha, out) {
      if (p.id === me) {
        lerpPose(p, alpha, out);
        return;
      }
      out.x = p.x;
      out.y = p.y;
      out.h = p.h;
      out.alive = p.alive;
      out.out = p.out;
    },
    respawnIn: (p) => (p.alive ? null : Math.max(0, HUMAN_RESPAWN - (w.time - p.diedAt))),
    countdown: () => (inited ? go : GO),
    version: () => version,
    dispose() {
      off();
    },
    online: {
      ready: () => inited && snapLoaded,
      finish() {},
      result: () => result ?? { winner: null, order: [], winnerSeat: null },
      status: () =>
        ended ? null : !inited || !snapLoaded ? 'waiting for the host' : hostAway ? 'the host stepped away' : held() ? 'waiting for the host' : gapSince >= 0 && clock - gapSince > 0.6 ? 'catching up' : null,
      setAway() {},
    },
  };
}

export function createOnline(net: Net, opts: OnlineOpts): Ctl {
  return net.isHost ? hostCtl(net, opts) : guestCtl(net, opts);
}
