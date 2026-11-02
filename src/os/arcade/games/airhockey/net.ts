// Air Hockey online, apart from the screen: who calls what, what each side sends, and how the match keeps time. Pure
// (no React, no three.js), so a test can play a match over a slow link (tests/arcade-airhockey-net.test.ts).
//
// Each player owns their own half of the table. The puck belongs to the half it is in, and only the screen it belongs
// to plays it for real: there the player's own mallet meets it exactly as they see both (its speed included), so a hit
// they see is a hit, a save is a save, and a goal into their end is theirs to give away. When the puck crosses the
// center line its owner hands it over with where it was, how it moved and when (a pass). The other screen carries the
// puck on from the owner's latest word, its own mallet still in play as it moved then (so a mallet that met the puck
// as it came over the line keeps its hit when the pass arrives), and only guesses at the owner's hits with the owner's
// mallet as last heard, until word of them comes. The host still keeps the score; a guest that lets one in says so in
// its next reports, and serves, as the rules have the player scored on do.
//
// Timing. Both screens run the match on the host's clock (a guest reads it from the round trips of its reports, see
// HostClock) in steps of at most SUB, catching up slow frames, so word from the other side (stamped with that clock)
// is carried on to now, and the puck is where the other screen has it at the same moment rather than a trip behind.
//
// The trade-off (favor the defender): a shot the other player gets a mallet to on their screen is blocked or hit back
// even if, on yours, their mallet (drawn from their latest word) looked a little off; you see the puck come back off
// it a moment late, slightly further along.
//
// Packets stay readable by older clients: an older host reads the guest's `x` and `z`, an older guest reads the host's
// `state` and `event`. A host that hears no clock from its guest (an older one) plays the whole table itself as before;
// a guest whose host sends no clock (an older one) follows its snapshots as before (index.tsx).
// (No top level `t` or `k` in a packet: the room takes those as a message's kind when it thins out what spectators get.)
import { L, MAX_SPEED, SERVE_FREEZE, W, clampMallet, goal, moveMalletTo, step, type Event, type State, type V2 } from './logic.ts';

/** Reports go out this often, the match steps at most this far at a time (the game's own substep), and a stalled screen catches up this far at most (seconds). */
export const SEND_S = 1 / 30;
export const SUB = 1 / 120;
const BACKLOG = 0.25;
/** The furthest the other mallet is carried on past its latest report, and how long our own mallet's path is kept for replays. */
const LEAD = 0.06;
const KEEP = 1;
/** A correction of the puck this far or more (table units) is shown at once instead of being faded out. */
const ERR_MAX = 0.6;
/** How an older guest's mallet was moved on the host: toward its latest report, at most this fast. */
const LEGACY_SPEED = 9;
/** A mallet hit softer than this is resting contact (index.tsx), and one this soon after the last is the same hit. */
const SOFT = 0.3;
const HIT_GAP = 0.08;

type Side = 0 | 1;
/** A puck on the wire: x, z, vx, vz, and what is left of the serve freeze. */
export type PuckWire = [number, number, number, number, number];
/** Guest to host, SEND_S apart (fast). `c`: the guest's own clock (ms), echoed back. Once its clock is set: `at` (host clock, ms), `turn`, `pts`, its hits so far, and the puck while it is the guest's. */
export type MalletMsg = { game: 'airhockey'; type: 'mallet'; x: number; z: number; vx?: number; vz?: number; c?: number; at?: number; turn?: number; pts?: number; hits?: number; puck?: PuckWire };
/** Host to everyone, SEND_S apart (fast). `echo`: the guest's newest `c` and how long (ms) the host held it before this went out. */
export type SnapshotMsg = { game: 'airhockey'; type: 'snapshot'; state: State; at?: number; turn?: number; echo?: [number, number] };
/** The puck crossed into the receiver's half at `at`. Fast and reliable. */
export type PassMsg = { game: 'airhockey'; type: 'pass'; at: number; turn: number; pts: number; puck: PuckWire };
/** Host to everyone, reliable: what happened, and the match it left. */
export type EventsMsg = { game: 'airhockey'; type: 'events'; event: Event; state?: State; at?: number; turn?: number };
export type Out = { data: MalletMsg | SnapshotMsg | PassMsg; fast: boolean; reliable: boolean };

type Mark = { at: number; x: number; z: number; vx: number; vz: number };

/** How many round trips the host's clock is read from (the quickest wins), a reading off by more than this is jumped to, and how fast it is eased toward otherwise. */
const SAMPLES = 90;
const CLOCK_FAR = 0.25;
const CLOCK_SLEW = 0.1;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * A guest's reading of the host's clock against its own, from round trips: it sent a report at its time `c`, the host
 * held it `hold` seconds and sent a snapshot at host time `hostT`, which arrived here at our time `now`, so the host's
 * clock is ahead of ours by hostT - now + rtt / 2, where rtt = now - c - hold. The quickest recent trip says it best.
 */
export class HostClock {
  private samples: { rtt: number; ahead: number }[] = [];
  private goal = 0;
  /** Seconds the host's clock is ahead of ours (behind when negative), once `synced`. */
  ahead = 0;
  synced = false;
  observe(c: number, hold: number, hostT: number, now: number) {
    const rtt = now - c - hold;
    if (!(rtt >= 0 && rtt < 2)) return;
    this.samples.push({ rtt, ahead: hostT - now + rtt / 2 });
    if (this.samples.length > SAMPLES) this.samples.shift();
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.goal = best.ahead;
    if (!this.synced || Math.abs(this.goal - this.ahead) > CLOCK_FAR) {
      this.ahead = this.goal;
      this.synced = true;
    }
  }
  /** Eases toward the best reading, a little each frame, so the match never jumps. */
  tick(dt: number) {
    this.ahead += clamp(this.goal - this.ahead, -dt * CLOCK_SLEW, dt * CLOCK_SLEW);
  }
}

export type Net = {
  me: Side;
  /** Running this protocol: the host always, a guest once its host speaks it and its clock is set. */
  live: boolean;
  /** Host: the guest speaks it too (its reports carry the host's clock), and when (host clock) its latest report came. */
  peer: boolean;
  heardAt: number;
  /** Hand-overs of the puck this match: the host holds it while even, the guest while odd. */
  turn: number;
  /** Where the match is, on the host's clock (seconds). */
  t: number;
  clock: HostClock;
  /** The other mallet's reports, newest last, and our own mallet's path (both on the host's clock). */
  them: Mark[];
  mine: Mark[];
  /** Host, an older guest: where its mallet was last reported. */
  target: V2 | null;
  /** The newest word on the puck taken from the other side (its time), so older word is dropped. */
  heard: number;
  /** Our own hits so far and when the last was (a guest sends the count), and the guest's heard of (on the host), so each sounds once. */
  hits: number;
  hitAt: number;
  theirHits: number;
  /** A pass that came before the goal it follows (fast packets can overtake): taken once that goal is in. */
  pending: PassMsg | null;
  /** Since when (host clock) the other side's word has had the puck handed to us with no pass here yet (see overdue). */
  lost: number | null;
  /** How far the puck and the other mallet are drawn from where they are, after a correction (faded out). */
  err: V2;
  themErr: V2;
  /** Host: the guest's newest clock reading and when it came (host clock), to echo. */
  echo: { c: number; at: number } | null;
  sendIn: number;
  out: Out[];
};

export function newNet(me: Side, clock = new HostClock()): Net {
  return {
    me, live: me === 0, peer: false, heardAt: 0, turn: 0, t: 0, clock, them: [], mine: [], target: null, heard: -Infinity, hits: 0, hitAt: -Infinity, theirHits: 0,
    pending: null, lost: null, err: { x: 0, z: 0 }, themErr: { x: 0, z: 0 }, echo: null, sendIn: 0, out: [],
  };
}

/** A guest that has said nothing for this long (a hidden tab, a stalled link) leaves its half to the host until it speaks again. */
const QUIET_S = 1;

/** The host plays the whole table itself, as before this protocol: for an older guest, or one gone quiet. */
export const alone = (net: Net) => net.me === 0 && (!net.peer || net.t - net.heardAt > QUIET_S);

/** How long the other side's word may say the puck is ours before we take it without the pass (which comes reliably, so only one that couldn't be taken). */
const LOST_S = 1;

/** The other side says (as of `at`) it handed the puck over, same goals, and no pass has come for a while: true once it is overdue. */
function overdue(net: Net, at: number, turn: unknown, same: boolean): boolean {
  if (finite(turn) && turn === net.turn + 1 && (turn % 2 === 0 ? 0 : 1) === net.me && same) {
    if (net.lost === null) net.lost = at;
    else if (at - net.lost > LOST_S) {
      net.lost = null;
      return true;
    }
  } else net.lost = null;
  return false;
}

/** Which half a puck at z is in (player 0 defends +z); on the line it stays with whoever has it. */
export const halfOf = (z: number, holding: Side): Side => (z > 0 ? 0 : z < 0 ? 1 : holding);
export const holder = (net: Net): Side => (net.turn % 2 === 0 ? 0 : 1);
const other = (s: Side): Side => (s === 0 ? 1 : 0);
const pts = (s: State) => s.score[0] + s.score[1];
/** This screen's reading of the host's clock. */
export const clockOf = (net: Net, local: number) => (net.me === 0 ? local : local + net.clock.ahead);
const ms = (s: number) => Math.round(s * 1000);
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export const toWire = (s: State): PuckWire => [r4(s.puck.x), r4(s.puck.z), r4(s.puck.vx), r4(s.puck.vz), r4(Math.max(0, s.freeze))];
function setPuck(s: State, w: PuckWire) {
  [s.puck.x, s.puck.z, s.puck.vx, s.puck.vz] = w;
  s.freeze = w[4];
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A puck on the table (a goal mouth included), no faster than a mallet can send one (the speed cap only applies on the step after a hit). */
export const isPuck = (v: unknown): v is PuckWire =>
  Array.isArray(v) && v.length === 5 && v.every(finite) && Math.abs(v[0]) <= W / 2 + 0.2 && Math.abs(v[1]) <= L / 2 + 0.5
  && Math.hypot(v[2], v[3]) <= MAX_SPEED * 6 && v[4] >= 0 && v[4] <= SERVE_FREEZE + 0.01;
/** Enough of a match to take from the host. */
export const isState = (v: unknown): v is State => {
  const s = v as State | null;
  return !!s && typeof s === 'object' && Array.isArray(s.score) && s.score.length === 2 && s.score.every(finite)
    && !!s.puck && [s.puck.x, s.puck.z, s.puck.vx, s.puck.vz].every(finite)
    && Array.isArray(s.mallets) && s.mallets.length === 2 && s.mallets.every((m) => m && [m.x, m.z, m.vx, m.vz].every(finite))
    && finite(s.freeze) && (s.serve === 0 || s.serve === 1) && (s.winner === null || s.winner === 0 || s.winner === 1);
};

/** Where a mallet is at `at` by its reports: eased between the two either side, or carried on (up to `lead`) past the newest. */
function markAt(marks: Mark[], at: number, lead: number): Mark | null {
  const n = marks.length;
  if (!n) return null;
  const last = marks[n - 1];
  if (at >= last.at) {
    const k = Math.min(at - last.at, lead);
    return { at, x: last.x + last.vx * k, z: last.z + last.vz * k, vx: last.vx, vz: last.vz };
  }
  for (let i = n - 1; i > 0; i--) {
    const a = marks[i - 1];
    const b = marks[i];
    if (a.at <= at) {
      const k = (at - a.at) / (b.at - a.at || 1);
      return { at, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, vx: b.vx, vz: b.vz };
    }
  }
  return marks[0];
}

/** The other mallet at `at`: where its reports put it (an older guest's is moved toward its latest, as before). */
function placeThem(net: Net, s: State, at: number, h: number) {
  const side = other(net.me);
  const m = s.mallets[side];
  if (net.me === 0 && !net.peer) {
    if (net.target) moveMalletTo(s, side, net.target, h, LEGACY_SPEED);
    else {
      m.vx = 0;
      m.vz = 0;
    }
    return;
  }
  const mark = markAt(net.them, at, LEAD);
  if (!mark) return;
  m.x = mark.x;
  m.z = mark.z;
  m.vx = mark.vx;
  m.vz = mark.vz;
  clampMallet(m, side);
}

/** One step of the match. Only the puck's owner calls a goal, only into its own end; the owner hands the puck over when it leaves. */
function tick(net: Net, s: State, h: number): Event {
  const legacy = alone(net);
  const mine = legacy || holder(net) === net.me;
  placeThem(net, s, net.t + h, h);
  const ev = step(s, h, { hold: legacy ? [false, false] : [!mine || net.me !== 0, !mine || net.me !== 1] });
  net.t += h;
  if (mine && !legacy && s.winner === null && halfOf(s.puck.z, net.me) !== net.me) {
    net.turn++;
    net.out.push({ data: { game: 'airhockey', type: 'pass', at: ms(net.t), turn: net.turn, pts: pts(s), puck: toWire(s) }, fast: true, reliable: true });
  }
  return ev;
}

/** Folds one step's happenings into a frame's: the hardest hit, the hardest wall, any goal. */
function fold(into: Event, e: Event) {
  if (e.wall) {
    into.wall = true;
    into.wallPower = Math.max(into.wallPower ?? 0, e.wallPower ?? 0);
  }
  if (e.hit !== undefined && (e.power ?? 0) >= (into.power ?? 0)) {
    into.hit = e.hit;
    into.power = e.power;
  }
  if (e.at) into.at = e.at;
  if (e.goal !== undefined) into.goal = e.goal;
  if (e.win !== undefined) into.win = e.win;
}

/**
 * Takes word from the other side as of `at` (`set` puts it in) and plays the match on from then to where it was, our
 * own mallet where it was at each moment, so the puck is where that word puts it now. What the puck was drawn at stays
 * on screen as an offset that fades. Returns any goal the replay decided; hits and walls in it stay quiet.
 */
function replay(net: Net, s: State, at: number, set: () => void): Event {
  const end = net.t;
  const shown = { x: s.puck.x + net.err.x, z: s.puck.z + net.err.z };
  const m = s.mallets[net.me];
  const live = { x: m.x, z: m.z, vx: m.vx, vz: m.vz };
  set();
  net.t = clamp(at, end - KEEP, end);
  const out: Event = {};
  while (net.t < end - 1e-9) {
    const h = Math.min(SUB, end - net.t);
    const mark = markAt(net.mine, net.t + h, 0);
    if (mark) {
      m.x = mark.x;
      m.z = mark.z;
      m.vx = mark.vx;
      m.vz = mark.vz;
    }
    const e = tick(net, s, h);
    if (e.goal !== undefined) out.goal = e.goal;
    if (e.win !== undefined) out.win = e.win;
  }
  net.t = end;
  Object.assign(m, live);
  const ex = shown.x - s.puck.x;
  const ez = shown.z - s.puck.z;
  net.err = Math.hypot(ex, ez) < ERR_MAX ? { x: ex, z: ez } : { x: 0, z: 0 };
  if (net.me === 1 && out.goal === 0) ownUp(net, s);
  return out;
}

/**
 * One frame: plays the match on to now on the host's clock, our own mallet moved by `drive` at each step, and queues
 * what to send. Returns what happened, for sound and light (a hit by the other mallet is only a guess here, so it
 * waits for word).
 */
export function frame(net: Net, s: State, local: number, dt: number, drive: (s: State, side: Side, h: number) => void): Event {
  const out: Event = {};
  if (!net.live) return out;
  net.clock.tick(dt);
  const now = clockOf(net, local);
  if (!(net.t > 0) || net.t > now + BACKLOG) net.t = now;
  if (now - net.t > BACKLOG) net.t = now - BACKLOG;
  const legacy = alone(net);
  while (net.t < now - 1e-6) {
    const h = Math.min(SUB, now - net.t);
    if (s.winner === null) drive(s, net.me, h);
    const e = tick(net, s, h);
    if (e.hit !== undefined && !legacy && e.hit !== net.me) e.hit = undefined;
    if (e.hit === net.me && (e.power ?? 0) > SOFT) {
      if (net.t - net.hitAt > HIT_GAP) net.hits++;
      net.hitAt = net.t;
    }
    fold(out, e);
    const m = s.mallets[net.me];
    net.mine.push({ at: net.t, x: m.x, z: m.z, vx: m.vx, vz: m.vz });
  }
  while (net.mine.length && net.mine[0].at < net.t - KEEP) net.mine.shift();
  const fade = Math.exp(-dt * 12);
  net.err.x *= fade;
  net.err.z *= fade;
  const themFade = Math.exp(-dt * 14);
  net.themErr.x *= themFade;
  net.themErr.z *= themFade;
  net.sendIn -= dt;
  if (net.me === 1 && out.goal === 0) ownUp(net, s);
  else if (net.sendIn <= 0) {
    net.sendIn = Math.max(0, net.sendIn + SEND_S);
    net.out.push(report(net, s, local));
  }
  return out;
}

function report(net: Net, s: State, local?: number): Out {
  if (net.me === 0) {
    const data: SnapshotMsg = { game: 'airhockey', type: 'snapshot', state: s, at: ms(net.t), turn: net.turn };
    if (net.echo && local !== undefined) data.echo = [net.echo.c, ms(local - net.echo.at)];
    return { data, fast: true, reliable: false };
  }
  const m = s.mallets[1];
  const data: MalletMsg = { game: 'airhockey', type: 'mallet', x: r4(m.x), z: r4(m.z), vx: r4(m.vx), vz: r4(m.vz), at: ms(net.t), turn: net.turn, pts: pts(s), hits: net.hits };
  if (local !== undefined) data.c = ms(local);
  if (holder(net) === 1) data.puck = toWire(s);
  return { data, fast: true, reliable: false };
}

/**
 * Guest: it let one in, so it says so at once, and reliably (its reports carry the goals), so the host has the goal
 * even if this was the last one and the match stops here with it.
 */
function ownUp(net: Net, s: State) {
  net.sendIn = SEND_S;
  net.out.push({ ...report(net, s), reliable: true });
}

/** A guest that isn't running this yet (its host is older, or its clock isn't set) still sends its mallet, and its clock to be echoed. */
export function legacyReport(s: State, local: number): MalletMsg {
  const m = s.mallets[1];
  return { game: 'airhockey', type: 'mallet', x: r4(m.x), z: r4(m.z), vx: r4(m.vx), vz: r4(m.vz), c: ms(local) };
}

/** Takes a new report of the other mallet, keeping where it is drawn steady (the jump fades out). */
function hearThem(net: Net, at: number, x: number, z: number, vx: number, vz: number) {
  const last = net.them[net.them.length - 1];
  // (word from well before the newest means the sender's clock was reset: start over)
  if (last && at < last.at - 0.5) net.them.length = 0;
  else if (last && at <= last.at) return false;
  const before = markAt(net.them, net.t, LEAD);
  net.them.push({ at, x, z, vx, vz });
  if (net.them.length > 16) net.them.shift();
  const after = markAt(net.them, net.t, LEAD);
  if (before && after) {
    const jx = before.x - after.x + net.themErr.x;
    const jz = before.z - after.z + net.themErr.z;
    net.themErr = Math.hypot(jx, jz) < ERR_MAX ? { x: jx, z: jz } : { x: 0, z: 0 };
  }
  return true;
}

/** Host: a guest's report. Returns what to sound and pass on: a hit the guest made, and a goal it let in. */
export function hostHears(net: Net, s: State, msg: MalletMsg, local: number): Event {
  const ev: Event = {};
  if (!finite(msg.x) || !finite(msg.z)) return ev;
  if (finite(msg.c)) net.echo = { c: msg.c, at: local };
  if (!finite(msg.at)) {
    net.target = { x: msg.x, z: msg.z };
    return ev;
  }
  net.peer = true;
  const at = msg.at / 1000;
  // (word from far off the host's own clock can't be placed: a guest still setting its clock)
  if (at > net.t + BACKLOG || at < net.t - KEEP) return ev;
  if (!hearThem(net, at, msg.x, msg.z, finite(msg.vx) ? msg.vx : 0, finite(msg.vz) ? msg.vz : 0)) return ev;
  net.heardAt = net.t;
  // (the puck is where our word on it from the guest put it, carried on since)
  if (overdue(net, at, msg.turn, msg.pts === pts(s))) net.turn = msg.turn!;
  const puck = isPuck(msg.puck) ? msg.puck : null;
  if (finite(msg.hits) && msg.hits > net.theirHits) {
    net.theirHits = msg.hits;
    if (puck) {
      ev.hit = 1;
      ev.power = Math.hypot(puck[2], puck[3]);
      ev.at = { x: puck[0], z: puck[1] };
    }
  }
  // the guest's word on the puck in its half (a puck on its side of the line, as its owner would have it)
  if (puck && puck[1] <= 0.05 && msg.turn === net.turn && holder(net) === 1 && at > net.heard) {
    const conceded = msg.pts === pts(s) + 1;
    if (msg.pts !== pts(s) && !conceded) return ev;
    net.heard = at;
    fold(ev, replay(net, s, at, () => {
      // (a guest that let one in serves: the goal is ours, and the puck is where the guest has it)
      if (conceded) goal(s, 0, ev);
      setPuck(s, puck);
    }));
  }
  return ev;
}

/** Either side: the puck crossed into our half. Returns what to sound (on the host: a goal the guest let in before it). */
export function hearPass(net: Net, s: State, msg: PassMsg): Event {
  const ev: Event = {};
  if (!net.live || !finite(msg.at) || !finite(msg.turn) || !finite(msg.pts) || !isPuck(msg.puck)) return ev;
  if (msg.turn <= net.turn || (msg.turn - net.turn) % 2 !== 1 || (msg.turn % 2 === 0 ? 0 : 1) !== net.me) return ev;
  const at = msg.at / 1000;
  const puck = msg.puck;
  // (a guest's goal against itself that no report has brought yet: it came first)
  if (net.me === 0 && msg.pts === pts(s) + 1) goal(s, 0, ev);
  if (msg.pts !== pts(s)) {
    // (a guest that hasn't heard the goal this follows yet: it takes the pass once it has)
    if (net.me === 1 && msg.pts > pts(s)) net.pending = msg;
    return ev;
  }
  net.turn = msg.turn;
  net.heard = at;
  fold(ev, replay(net, s, at, () => setPuck(s, puck)));
  return ev;
}

/**
 * Guest: a host snapshot. Returns null while the guest isn't running this (an older host, or no clock yet: index.tsx
 * follows the snapshot as before), otherwise what to sound (a goal the host let in, heard here first).
 */
export function guestHears(net: Net, s: State, msg: SnapshotMsg, local: number): Event | null {
  if (!finite(msg.at) || !finite(msg.turn) || !isState(msg.state)) return null;
  const at = msg.at / 1000;
  if (msg.echo && msg.echo.length === 2 && msg.echo.every(finite)) net.clock.observe(msg.echo[0] / 1000, msg.echo[1] / 1000, at, local);
  if (!net.clock.synced) return null;
  const h = msg.state;
  const ev: Event = {};
  const host = h.mallets[0];
  if (!net.live) {
    // take over from following snapshots: this one is where the match is
    net.live = true;
    net.t = clockOf(net, local);
    hearThem(net, at, host.x, host.z, host.vx, host.vz);
    take(net, s, h, at, msg.turn, ev);
    return ev;
  }
  hearThem(net, at, host.x, host.z, host.vx, host.vz);
  if (pts(h) > pts(s)) take(net, s, h, at, msg.turn, ev);
  else if (overdue(net, at, msg.turn, pts(h) === pts(s))) {
    // (the host's word on the puck since it handed it over: take it from there)
    net.turn = msg.turn;
    net.heard = at;
    fold(ev, replay(net, s, at, () => setPuck(s, [h.puck.x, h.puck.z, h.puck.vx, h.puck.vz, clamp(h.freeze, 0, SERVE_FREEZE)])));
  } else if (pts(h) === pts(s) && msg.turn === net.turn && holder(net) === 0 && at > net.heard) {
    net.heard = at;
    fold(ev, replay(net, s, at, () => setPuck(s, [h.puck.x, h.puck.z, h.puck.vx, h.puck.vz, clamp(h.freeze, 0, SERVE_FREEZE)])));
  }
  return ev;
}

/** Guest: the host's events. Returns what to sound here: the host's hits (walls, our own hits and every goal are ours already). */
export function guestEvents(net: Net, s: State, msg: EventsMsg): Event {
  const ev: Event = {};
  const e = msg.event;
  if (e && typeof e === 'object' && e.hit === 0) {
    ev.hit = 0;
    ev.power = finite(e.power) ? e.power : undefined;
    ev.at = e.at;
  }
  if (net.live && finite(msg.at) && isState(msg.state) && pts(msg.state) > pts(s)) take(net, s, msg.state, msg.at / 1000, finite(msg.turn) ? msg.turn : null, ev);
  return ev;
}

/** Guest: the host has a goal this screen hasn't: take the host's match as it was at `at` and play it on to now. */
function take(net: Net, s: State, h: State, at: number, turn: number | null, ev: Event) {
  for (const side of [0, 1] as Side[]) if (h.score[side] > s.score[side]) ev.goal = side;
  if (h.winner !== null && s.winner === null) ev.win = h.winner;
  if (turn !== null) net.turn = turn;
  net.heard = at;
  replay(net, s, at, () => {
    s.score = [h.score[0], h.score[1]];
    s.winner = h.winner;
    s.serve = h.serve;
    setPuck(s, [h.puck.x, h.puck.z, h.puck.vx, h.puck.vz, clamp(h.freeze, 0, SERVE_FREEZE)]);
  });
  const waiting = net.pending;
  net.pending = null;
  if (waiting && waiting.pts === pts(s)) fold(ev, hearPass(net, s, waiting));
}

/** Where to draw the puck and the other mallet on this screen. */
export const shownPuck = (net: Net, s: State): V2 => ({ x: s.puck.x + net.err.x, z: s.puck.z + net.err.z });
export function shownThem(net: Net, s: State): V2 {
  const side = other(net.me);
  const m = s.mallets[side];
  const r = m.r;
  const x = clamp(m.x + net.themErr.x, -W / 2 + r, W / 2 - r);
  const z = side === 0 ? clamp(m.z + net.themErr.z, r, L / 2 - r) : clamp(m.z + net.themErr.z, -(L / 2 - r), -r);
  return { x, z };
}
