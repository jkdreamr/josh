// Pong online, apart from the screen: who calls what, what each side sends, and how the match keeps time. Pure (no
// React, no DOM), so a test can play a match over a slow link (tests/arcade-pong-net.test.ts).
//
// Each player calls their own end. The ball belongs to the half it is in (the host's up to the center line, the
// guest's past it), and only the screen it belongs to plays it for real: there its own paddle meets it exactly as that
// player sees both, so a return they see is a return, and a ball they let by is their point to give away. When the
// ball crosses the center line, its owner hands it over with where it was and when (a pass); a guest who lets the ball
// by hands it back the same way, with the point in it, for the host to serve. The other screen carries the ball on
// from the owner's latest word and only guesses at the owner's hits (with the owner's paddle as last heard) until word
// of them comes. The host still serves, keeps the score and counts the rally.
//
// Timing. Both screens run the match on the host's clock (a guest reads it from the round trips of its reports, see
// HostClock) in steps of at most SUB, catching up slow frames, so word from the other side (stamped with that clock)
// is carried on to now, and the ball is where the other screen has it at the same moment rather than a trip behind.
//
// The trade-off (favor the defender): a shot the other player reaches on their screen comes back even if, on yours,
// their paddle (drawn from their latest word) looked a little short; you see it come back off their paddle a moment
// late, slightly further along.
//
// Packets stay readable by older clients: an older host reads the guest's `y` and nothing else, an older guest reads
// the host's `match` and `events`. A host that hears no clock from its guest (an older one) plays the whole court
// itself as before; a guest whose host sends no clock (an older one) follows its snapshots as before (index.tsx).
// (No top level `t` or `k` in a packet: the room takes those as a message's kind when it thins out what spectators get.)
import { BALL_R, COURT, PADDLE, clamp, other, paddleX, point, step, steerPaddle, type Ball, type Match, type Paddle, type PongEvent, type Rng, type Side } from './pong.ts';

/** Reports go out this often, the match steps at most this far at a time, and a stalled screen catches up this far at most (seconds). */
export const SEND_S = 1 / 30;
export const SUB = 1 / 120;
const BACKLOG = 0.25;
/** The furthest the other paddle is carried on past its latest report, and how long our own paddle's path is kept for replays. */
const LEAD = 0.1;
const KEEP = 1;
/** A correction of the ball this far or more is shown at once instead of being faded out. */
const ERR_MAX = 14;
/** How an older guest's paddle was steered on the host: toward its latest report at the pointer speed (index.tsx). */
const LEGACY_SPEED = 420;

/** A ball on the wire: x, y, vx, vy, spin. */
export type Wire = [number, number, number, number, number];
/** Guest to host, SEND_S apart (fast). `c`: the guest's own clock (ms), echoed back. Once its clock is set: `at` (host clock, ms), `turn`, `pts`, and the ball while it is the guest's. */
export type PaddleMsg = { game: 'pong'; type: 'paddle'; y: number; vy?: number; c?: number; at?: number; turn?: number; pts?: number; ball?: Wire; rally?: number };
/** Host to everyone, SEND_S apart (fast). `echo`: the guest's newest `c` and how long (ms) the host held it before this went out. */
export type SnapshotMsg = { game: 'pong'; type: 'snapshot'; match: Match; at?: number; turn?: number; echo?: [number, number] };
/** The ball crossed into the receiver's half at `at` (a guest's carries the point it gave away, if `pts` went up). Fast and reliable. */
export type PassMsg = { game: 'pong'; type: 'pass'; at: number; turn: number; pts: number; ball: Wire; rally: number };
/** Host to everyone, reliable: what happened, and the match it left. */
export type EventsMsg = { game: 'pong'; type: 'events'; events: PongEvent[]; match?: Match; at?: number; turn?: number };
export type Out = { data: PaddleMsg | SnapshotMsg | PassMsg; fast: boolean; reliable: boolean };

type Mark = { at: number; y: number; vy: number };

/** How many round trips the host's clock is read from (the quickest wins), a reading off by more than this is jumped to, and how fast it is eased toward otherwise. */
const SAMPLES = 90;
const CLOCK_FAR = 0.25;
const CLOCK_SLEW = 0.1;

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
  /** Hand-overs of the ball this match: the host holds it while even, the guest while odd. */
  turn: number;
  /** Where the match is, on the host's clock (seconds). */
  t: number;
  clock: HostClock;
  /** The other paddle's reports, newest last, and our own paddle's path (both on the host's clock). */
  them: Mark[];
  mine: Mark[];
  /** Host, an older guest: where its paddle was last reported. */
  target: number | null;
  /** The newest word on the ball taken from the other side (its time), so older word is dropped. */
  heard: number;
  /** Host: the rally count it last passed on or heard back, so each return the guest makes sounds once. */
  rallyHeard: number;
  /** A pass that came before the point it follows (fast packets can overtake): taken once that point is in. */
  pending: PassMsg | null;
  /** Since when (host clock) the other side's word has had the ball handed to us with no pass here yet (see overdue). */
  lost: number | null;
  /** How far the ball and the other paddle are drawn from where they are, after a correction (faded out). */
  err: { x: number; y: number };
  themErr: number;
  /** Host: the guest's newest clock reading and when it came (host clock), to echo. */
  echo: { c: number; at: number } | null;
  sendIn: number;
  out: Out[];
};

export function newNet(me: Side, clock = new HostClock()): Net {
  return {
    me, live: me === 0, peer: false, heardAt: 0, turn: 0, t: 0, clock, them: [], mine: [], target: null, heard: -Infinity, rallyHeard: 0,
    pending: null, lost: null, err: { x: 0, y: 0 }, themErr: 0, echo: null, sendIn: 0, out: [],
  };
}

/** A guest that has said nothing for this long (a hidden tab, a stalled link) leaves its end to the host until it speaks again. */
const QUIET_S = 1;

/** The host plays the whole court itself, as before this protocol: for an older guest, or one gone quiet. */
export const alone = (net: Net) => net.me === 0 && (!net.peer || net.t - net.heardAt > QUIET_S);

/** How long the other side's word may say the ball is ours before we take it without the pass (which comes reliably, so only one that couldn't be taken). */
const LOST_S = 1;

/** The other side says (as of `at`) it handed the ball over, same points, and no pass has come for a while: true once it is overdue. */
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

/** Which half a ball at x is in, and who holds the ball now. */
export const halfOf = (x: number): Side => (x > COURT.w / 2 ? 1 : 0);
export const holder = (net: Net): Side => (net.turn % 2 === 0 ? 0 : 1);
const pts = (m: Match) => m.score[0] + m.score[1];
/** This screen's reading of the host's clock. */
export const clockOf = (net: Net, local: number) => (net.me === 0 ? local : local + net.clock.ahead);
const ms = (s: number) => Math.round(s * 1000);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const toWire = (b: Ball): Wire => [r3(b.x), r3(b.y), r3(b.vx), r3(b.vy), r3(b.spin)];
function setBall(b: Ball, w: Wire) {
  [b.x, b.y, b.vx, b.vy, b.spin] = w;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isWire = (v: unknown): v is Wire =>
  Array.isArray(v) && v.length === 5 && v.every(finite) && Math.abs(v[0] - COURT.w / 2) < COURT.w && Math.abs(v[1] - COURT.h / 2) < COURT.h
  && Math.abs(v[2]) < 400 && Math.abs(v[3]) < 400 && Math.abs(v[4]) < 20;
/** Enough of a match to take from the host. */
export const isMatch = (v: unknown): v is Match => {
  const m = v as Match | null;
  return !!m && typeof m === 'object' && Array.isArray(m.score) && m.score.length === 2 && m.score.every(finite)
    && !!m.ball && [m.ball.x, m.ball.y, m.ball.vx, m.ball.vy, m.ball.spin].every(finite)
    && Array.isArray(m.paddles) && m.paddles.length === 2 && m.paddles.every((p) => p && finite(p.y) && finite(p.vy))
    && finite(m.serveIn) && (m.serveTo === 0 || m.serveTo === 1) && finite(m.rally) && (m.winner === null || m.winner === 0 || m.winner === 1);
};

/** Where a paddle is at `at` by its reports: eased between the two either side, or carried on a little past the newest. */
function markAt(marks: Mark[], at: number): Mark | null {
  const n = marks.length;
  if (!n) return null;
  const last = marks[n - 1];
  if (at >= last.at) return { at, y: last.y + last.vy * Math.min(at - last.at, LEAD), vy: last.vy };
  for (let i = n - 1; i > 0; i--) {
    const a = marks[i - 1];
    const b = marks[i];
    if (a.at <= at) {
      const k = (at - a.at) / (b.at - a.at || 1);
      return { at, y: a.y + (b.y - a.y) * k, vy: b.vy };
    }
  }
  return marks[0];
}

const HALF = PADDLE.h / 2;

/** The other paddle at `at`: where its reports put it (an older guest's is steered toward its latest, as before). */
function placeThem(net: Net, m: Match, at: number, h: number) {
  const p = m.paddles[other(net.me)];
  if (net.me === 0 && !net.peer) {
    if (net.target !== null) steerPaddle(p, net.target, h, LEGACY_SPEED);
    else p.vy *= Math.max(0, 1 - h * 14);
    return;
  }
  const mark = markAt(net.them, at);
  if (!mark) return;
  p.y = clamp(mark.y, HALF, COURT.h - HALF);
  p.vy = mark.vy;
}

/** One step of the match. Only the ball's owner calls a point, only at its own end; the owner hands the ball over when it leaves. */
function tick(net: Net, m: Match, h: number, events: PongEvent[], rng: Rng) {
  const legacy = alone(net);
  const mine = legacy || holder(net) === net.me;
  placeThem(net, m, net.t + h, h);
  const longest = m.longest;
  step(m, h, events, rng, { hold: legacy ? [false, false] : [!mine || net.me !== 0, !mine || net.me !== 1], noServe: net.me === 1 });
  // (a hit this screen only guessed at doesn't count toward the longest rally: the owner's word sets it)
  if (!mine) m.longest = longest;
  net.t += h;
  // A ball out past us comes back to center, in the host's half, so a guest's point goes back with the hand-over.
  if (mine && !legacy && halfOf(m.ball.x) !== net.me) handOver(net, m);
}

function handOver(net: Net, m: Match) {
  net.turn++;
  if (net.me === 0) net.rallyHeard = m.rally;
  net.out.push({ data: { game: 'pong', type: 'pass', at: ms(net.t), turn: net.turn, pts: pts(m), ball: toWire(m.ball), rally: m.rally }, fast: true, reliable: true });
}

/**
 * Takes word from the other side as of `at` (`set` puts it in) and plays the match on from then to where it was, our
 * own paddle where it was at each moment, so the ball is where that word puts it now. What the ball was drawn at stays
 * on screen as an offset that fades. Returns what the replay decided (a point, a serve); hits and walls in it stay quiet.
 */
function replay(net: Net, m: Match, at: number, set: () => void, rng: Rng): PongEvent[] {
  const end = net.t;
  const shown = { x: m.ball.x + net.err.x, y: m.ball.y + net.err.y };
  const live = m.paddles[net.me];
  const now = { y: live.y, vy: live.vy };
  set();
  net.t = clamp(at, end - KEEP, end);
  const events: PongEvent[] = [];
  while (net.t < end - 1e-9) {
    const h = Math.min(SUB, end - net.t);
    const mark = markAt(net.mine, net.t + h);
    if (mark) {
      live.y = mark.y;
      live.vy = mark.vy;
    }
    tick(net, m, h, events, rng);
  }
  net.t = end;
  live.y = now.y;
  live.vy = now.vy;
  const ex = shown.x - m.ball.x;
  const ey = shown.y - m.ball.y;
  net.err = Math.hypot(ex, ey) < ERR_MAX ? { x: ex, y: ey } : { x: 0, y: 0 };
  return events.filter((e) => e.kind !== 'wall' && e.kind !== 'paddle');
}

/**
 * One frame: plays the match on to now on the host's clock, our own paddle driven by `drive` at each step, and queues
 * what to send. Returns what to sound and show (a hit on the other paddle is only a guess here, so it waits for word).
 */
export function frame(net: Net, m: Match, local: number, dt: number, drive: (p: Paddle, h: number) => void, rng: Rng = Math.random): PongEvent[] {
  const events: PongEvent[] = [];
  if (!net.live) return events;
  net.clock.tick(dt);
  const now = clockOf(net, local);
  if (!(net.t > 0) || net.t > now + BACKLOG) net.t = now;
  if (now - net.t > BACKLOG) net.t = now - BACKLOG;
  while (net.t < now - 1e-6) {
    const h = Math.min(SUB, now - net.t);
    drive(m.paddles[net.me], h);
    tick(net, m, h, events, rng);
    const p = m.paddles[net.me];
    net.mine.push({ at: net.t, y: p.y, vy: p.vy });
  }
  while (net.mine.length && net.mine[0].at < net.t - KEEP) net.mine.shift();
  const fade = Math.exp(-dt * 12);
  net.err.x *= fade;
  net.err.y *= fade;
  net.themErr *= Math.exp(-dt * 14);
  net.sendIn -= dt;
  if (net.sendIn <= 0) {
    net.sendIn = Math.max(0, net.sendIn + SEND_S);
    net.out.push(report(net, m, local));
  }
  return alone(net) ? events : events.filter((e) => !(e.kind === 'paddle' && e.side !== net.me));
}

function report(net: Net, m: Match, local: number): Out {
  if (net.me === 0) {
    const data: SnapshotMsg = { game: 'pong', type: 'snapshot', match: m, at: ms(net.t), turn: net.turn };
    if (net.echo) data.echo = [net.echo.c, ms(local - net.echo.at)];
    return { data, fast: true, reliable: false };
  }
  const p = m.paddles[1];
  const data: PaddleMsg = { game: 'pong', type: 'paddle', y: r3(p.y), vy: r3(p.vy), c: ms(local), at: ms(net.t), turn: net.turn, pts: pts(m) };
  if (holder(net) === 1) {
    data.ball = toWire(m.ball);
    data.rally = m.rally;
  }
  return { data, fast: true, reliable: false };
}

/** A guest that isn't running this yet (its host is older, or its clock isn't set) still sends its paddle, and its clock to be echoed. */
export function legacyReport(p: Paddle, local: number): PaddleMsg {
  return { game: 'pong', type: 'paddle', y: r3(p.y), vy: r3(p.vy), c: ms(local) };
}

/** Takes a new report of the other paddle, keeping where it is drawn steady (the jump fades out). */
function hearThem(net: Net, at: number, y: number, vy: number) {
  const last = net.them[net.them.length - 1];
  // (word from well before the newest means the sender's clock was reset: start over)
  if (last && at < last.at - 0.5) net.them.length = 0;
  else if (last && at <= last.at) return false;
  const before = markAt(net.them, net.t);
  net.them.push({ at, y, vy });
  if (net.them.length > 16) net.them.shift();
  const after = markAt(net.them, net.t);
  if (before && after) {
    const jump = clamp(before.y, HALF, COURT.h - HALF) - clamp(after.y, HALF, COURT.h - HALF) + net.themErr;
    net.themErr = Math.abs(jump) < PADDLE.h ? jump : 0;
  }
  return true;
}

/** Host: a guest's report. Returns what to sound and pass on (a return the guest made, heard in its rally count). */
export function hostHears(net: Net, m: Match, msg: PaddleMsg, local: number, rng: Rng = Math.random): PongEvent[] {
  const events: PongEvent[] = [];
  if (!finite(msg.y)) return events;
  if (finite(msg.c)) net.echo = { c: msg.c, at: local };
  if (!finite(msg.at)) {
    net.target = msg.y;
    return events;
  }
  net.peer = true;
  const at = msg.at / 1000;
  // (word from far off the host's own clock can't be placed: a guest still setting its clock)
  if (at > net.t + BACKLOG || at < net.t - KEEP) return events;
  if (!hearThem(net, at, msg.y, finite(msg.vy) ? msg.vy : 0)) return events;
  net.heardAt = net.t;
  // (the ball is where our word on it from the guest put it, carried on since)
  if (overdue(net, at, msg.turn, msg.pts === pts(m))) net.turn = msg.turn!;
  if (isWire(msg.ball) && msg.turn === net.turn && holder(net) === 1 && msg.pts === pts(m) && at > net.heard) {
    net.heard = at;
    const rally = finite(msg.rally) ? msg.rally : m.rally;
    const ball = msg.ball;
    events.push(...replay(net, m, at, () => {
      setBall(m.ball, ball);
      m.serveIn = 0;
      m.rally = rally;
      m.longest = Math.max(m.longest, rally);
    }, rng));
    returned(net, ball, rally, events);
  }
  return events;
}

/** Host: the guest's rally went up, so it returned the ball: the hit, where it left the guest's paddle. */
function returned(net: Net, ball: Wire, rally: number, events: PongEvent[]) {
  if (rally <= net.rallyHeard) return;
  net.rallyHeard = rally;
  const [x, y, vx, vy] = ball;
  const face = paddleX(1) - PADDLE.w / 2 - BALL_R;
  const back = vx < 0 ? clamp((x - face) / vx, 0, 2) : 0;
  events.push({ kind: 'paddle', side: 1, x: face, y: clamp(y - vy * back, BALL_R, COURT.h - BALL_R), speed: Math.hypot(vx, vy) });
}

/** Either side: the ball crossed into our half. Returns what to sound (on the host: a point the guest gave away with it). */
export function hearPass(net: Net, m: Match, msg: PassMsg, rng: Rng = Math.random): PongEvent[] {
  const events: PongEvent[] = [];
  if (!net.live || !finite(msg.at) || !finite(msg.turn) || !finite(msg.pts) || !isWire(msg.ball)) return events;
  if (msg.turn <= net.turn || (msg.turn - net.turn) % 2 !== 1 || (msg.turn % 2 === 0 ? 0 : 1) !== net.me) return events;
  const at = msg.at / 1000;
  const ball = msg.ball;
  const rally = finite(msg.rally) ? msg.rally : 0;
  if (net.me === 0 && msg.pts === pts(m) + 1) {
    // the guest let the ball by: the point is ours, and the ball comes back to serve
    net.turn = msg.turn;
    net.heard = at;
    const y = m.ball.y;
    events.push(...replay(net, m, at, () => {
      point(m, 0, y, events);
      net.rallyHeard = 0;
    }, rng));
    return events;
  }
  if (msg.pts !== pts(m)) {
    // (a guest that hasn't heard the point this follows yet: it takes the pass once it has)
    if (net.me === 1 && msg.pts > pts(m)) net.pending = msg;
    return events;
  }
  net.turn = msg.turn;
  net.heard = at;
  events.push(...replay(net, m, at, () => {
    setBall(m.ball, ball);
    m.serveIn = 0;
    m.rally = rally;
    m.longest = Math.max(m.longest, rally);
  }, rng));
  if (net.me === 0) returned(net, ball, rally, events);
  return events;
}

/**
 * Guest: a host snapshot. Returns null while the guest isn't running this (an older host, or no clock yet: index.tsx
 * follows the snapshot as before), otherwise what to sound (a point the host gave away, heard here first).
 */
export function guestHears(net: Net, m: Match, msg: SnapshotMsg, local: number, rng: Rng = Math.random): PongEvent[] | null {
  if (!finite(msg.at) || !finite(msg.turn) || !isMatch(msg.match)) return null;
  const at = msg.at / 1000;
  if (msg.echo && msg.echo.length === 2 && msg.echo.every(finite)) net.clock.observe(msg.echo[0] / 1000, msg.echo[1] / 1000, at, local);
  if (!net.clock.synced) return null;
  const h = msg.match;
  const events: PongEvent[] = [];
  if (!net.live) {
    // take over from following snapshots: this one is where the match is
    net.live = true;
    net.t = clockOf(net, local);
    net.turn = msg.turn;
    take(net, m, h, at, msg.turn, events, rng);
    return events;
  }
  hearThem(net, at, h.paddles[0].y, h.paddles[0].vy);
  const owned = msg.turn === net.turn && holder(net) === 0 && at > net.heard;
  if (pts(h) > pts(m)) take(net, m, h, at, msg.turn, events, rng);
  else if (pts(h) === pts(m) && (owned || overdue(net, at, msg.turn, true))) {
    // the host's word on its ball (or, a pass that never came, on the ball since it handed it over)
    net.turn = msg.turn;
    net.heard = at;
    events.push(...replay(net, m, at, () => {
      setBall(m.ball, toWire(h.ball));
      m.serveIn = h.serveIn;
      m.serveTo = h.serveTo;
      m.rally = h.rally;
    }, rng));
  }
  m.longest = Math.max(m.longest, h.longest ?? 0);
  return events;
}

/** Guest: the host's events. Returns which to sound here: the host's hits and serves (walls, our own hits and every point are ours already). */
export function guestEvents(net: Net, m: Match, msg: EventsMsg, local: number, rng: Rng = Math.random): PongEvent[] {
  const events: PongEvent[] = (Array.isArray(msg.events) ? msg.events : []).filter((e) => e && ((e.kind === 'paddle' && e.side === 0) || e.kind === 'serve'));
  if (net.live && finite(msg.at) && isMatch(msg.match) && pts(msg.match) > pts(m)) take(net, m, msg.match, msg.at / 1000, finite(msg.turn) ? msg.turn : null, events, rng);
  return events;
}

/** Guest: the host has a point this screen hasn't: take the host's match as it was at `at` and play it on to now. */
function take(net: Net, m: Match, h: Match, at: number, turn: number | null, events: PongEvent[], rng: Rng) {
  for (const side of [0, 1] as Side[]) {
    if (h.score[side] > m.score[side]) events.push({ kind: 'score', side, x: side === 1 ? 0 : COURT.w, y: m.ball.y });
  }
  if (h.winner !== null && m.winner === null) events.push({ kind: 'win', side: h.winner });
  // (a point means the host holds the ball: its own, or the guest's handed back with it)
  if (turn !== null) net.turn = turn;
  else if (holder(net) !== 0) net.turn++;
  net.heard = at;
  events.push(...replay(net, m, at, () => {
    m.score = [h.score[0], h.score[1]];
    m.serveTo = h.serveTo;
    m.serveIn = h.serveIn;
    m.winner = h.winner;
    m.rally = h.rally;
    m.longest = Math.max(m.longest, h.longest ?? 0);
    setBall(m.ball, toWire(h.ball));
  }, rng).filter((e) => e.kind !== 'score' && e.kind !== 'win'));
  const waiting = net.pending;
  net.pending = null;
  if (waiting && waiting.pts === pts(m)) events.push(...hearPass(net, m, waiting, rng));
}

/** Where to draw the ball and the other paddle on this screen. */
export const shownBall = (net: Net, b: Ball) => ({ x: b.x + net.err.x, y: b.y + net.err.y });
export const shownThem = (net: Net, m: Match) => clamp(m.paddles[other(net.me)].y + net.themErr, HALF, COURT.h - HALF);
