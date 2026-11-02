// Pong online over a slow, jittery link, host and guest in one process: the netcode as the game runs it (net.ts), next to
// the old one (the guest followed the host's snapshots, the host steered toward the guest's last reported paddle and
// called every return), measured the same way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_R, COURT, KEY_SPEED, PADDLE, createMatch, extrapolateBall, mergeGuestSnapshot, movePaddle, paddleX, predictY, step, steerPaddle, type Match, type Paddle, type PongEvent, type Side } from '../src/os/arcade/games/pong/pong.ts';
import { HostClock, frame, guestEvents, guestHears, hearPass, hostHears, legacyReport, newNet, shownBall, type Net, type Out } from '../src/os/arcade/games/pong/net.ts';

/** A seeded random number generator, so a run is the same every time. */
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

type LinkCfg = { latency: number; jitter: number; loss: number };

/**
 * One way of a connection. Fast messages each take latency plus up to `jitter` (so they can overtake each other) and a
 * `loss` share never arrive; reliable ones arrive in order, a lost one held up by a retransmit (and everything behind it).
 */
class Pipe {
  private q: { at: number; n: number; data: string }[] = [];
  private lastReliable = 0;
  private n = 0;
  private readonly cfg: LinkCfg;
  private readonly rand: () => number;
  constructor(cfg: LinkCfg, rand: () => number) {
    this.cfg = cfg;
    this.rand = rand;
  }
  send(now: number, data: unknown, fast: boolean, reliable: boolean) {
    const json = JSON.stringify(data);
    const delay = () => this.cfg.latency + this.rand() * this.cfg.jitter;
    if (fast && this.rand() >= this.cfg.loss) this.q.push({ at: now + delay(), n: this.n++, data: json });
    if (reliable || !fast) {
      const at = Math.max(this.lastReliable, now + delay() + (this.rand() < this.cfg.loss ? 0.2 : 0));
      this.lastReliable = at;
      this.q.push({ at, n: this.n++, data: json });
    }
  }
  take(now: number): unknown[] {
    const due = this.q.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.n - b.n);
    this.q = this.q.filter((m) => m.at > now);
    return due.map((m) => JSON.parse(m.data));
  }
  clear() {
    this.q = [];
  }
}

const HALF_HIT = PADDLE.h / 2 + BALL_R;
const FACE = [paddleX(0) + PADDLE.w / 2 + BALL_R, paddleX(1) - PADDLE.w / 2 - BALL_R];
/** The guest's clock reads this much more than the host's. */
const SKEW = 7.3;

/**
 * A player, as people play: waits near the middle, starts for where the ball will cross its paddle only once it is
 * close (a reaction it picks for each ball, so the paddle is often still moving when they meet), and aims to take it
 * somewhere on the paddle, now and then too far out (a miss).
 */
function player(side: Side, rand: () => number) {
  let heading = 0;
  let aim = 0;
  let react = 0;
  return (ball: { x: number; y: number; vx: number; vy: number; spin: number }) => {
    const toward = side === 0 ? ball.vx < 0 : ball.vx > 0;
    const sign = Math.sign(ball.vx);
    if (sign !== heading) {
      heading = sign;
      aim = (rand() * 2 - 1) * (HALF_HIT + 2);
      react = 0.18 + rand() * 0.3;
    }
    const eta = toward ? (FACE[side] - ball.x) / ball.vx : Infinity;
    return toward && eta < react ? predictY(ball, FACE[side]) + aim : COURT.h / 2;
  };
}

type Stats = {
  /** Frames where the guest's own paddle should have moved and didn't, or moved against where it was steered. */
  respond: number;
  ownBack: number;
  /** The host's copy of the guest's paddle against where the guest has it, and the ball on the two screens (court units). */
  paddleErr: number;
  ballErr: number;
  ballErr95: number;
  /** Frames the ball drawn on the guest's screen stepped back against its own motion. */
  ballBack: number;
  /** Times the ball reached the guest's paddle on the guest's screen, clearly in reach or clearly not, and how many the host called the other way; the same for the host's own paddle. */
  calls: number;
  wrong: number;
  hostCalls: number;
  hostWrong: number;
  points: number;
};

type Seen = { x: number; y: number; vx: number; vy: number; live: boolean };

/**
 * Plays `seconds` of matches between two of `player` over the link, 60 frames a second each, the guest's a few
 * milliseconds after the host's. `fresh`: the netcode in net.ts; otherwise the old one.
 */
function simulate(fresh: boolean, link: LinkCfg, seconds: number, seed: number): Stats {
  const rand = rng(seed);
  const up = new Pipe(link, rng(seed + 1));
  const down = new Pipe(link, rng(seed + 2));
  const hostBot = player(0, rng(seed + 3));
  const guestBot = player(1, rng(seed + 4));
  const serveRng = rng(seed + 5);
  let host = createMatch(rand() < 0.5 ? 0 : 1);
  let guest = createMatch(0);
  const clock = new HostClock();
  let hnet: Net = newNet(0);
  let gnet: Net = newNet(1, clock);
  let ballErr = { x: 0, y: 0 };
  let remoteTarget: number | null = null;
  let guestSend = 0;
  let snapAt = 0;
  const stats: Stats = { respond: 0, ownBack: 0, paddleErr: 0, ballErr: 0, ballErr95: 0, ballBack: 0, calls: 0, wrong: 0, hostCalls: 0, hostWrong: 0, points: 0 };
  const errs: number[] = [];
  const paddleErrs: number[] = [];
  /** What each player saw at its own paddle (time, in reach), and what the host decided there (time, returned). */
  const seen: [number, boolean][][] = [[], []];
  const called: [number, boolean][][] = [[], []];
  let prevGuest: Seen | null = null;
  let prevHost: Seen | null = null;

  const decide = (now: number, evs: PongEvent[]) => {
    for (const e of evs) {
      if (e.kind === 'paddle') called[e.side].push([now, true]);
      if (e.kind === 'score') {
        called[e.side === 0 ? 1 : 0].push([now, false]);
        stats.points++;
      }
    }
  };
  const flush = (net: Net, pipe: Pipe, now: number) => {
    for (const o of net.out.splice(0)) pipe.send(now, o.data, o.fast, o.reliable);
  };
  const hostEvents = (now: number, evs: PongEvent[]) => {
    decide(now, evs);
    if (evs.length) down.send(now, { game: 'pong', type: 'events', events: evs, match: host, at: Math.round(hnet.t * 1000), turn: hnet.turn }, false, true);
  };
  /** The old guest's way with a snapshot (index.tsx before): keep its paddle, fade out the jump unless the ball turned. */
  const follow = (snap: Match) => {
    const before = guest.ball;
    const next = mergeGuestSnapshot(guest, snap);
    const dx = before.x + ballErr.x - next.ball.x;
    const dy = before.y + ballErr.y - next.ball.y;
    const smooth = Math.sign(before.vx) === Math.sign(next.ball.vx) && next.serveIn <= 0 && Math.hypot(dx, dy) < 12;
    ballErr = smooth ? { x: dx, y: dy } : { x: 0, y: 0 };
    next.paddles = [next.paddles[0], guest.paddles[1]];
    guest = next;
  };
  /**
   * The ball reaching a paddle on that player's own screen (it passed the paddle's line, or turned back at it): where
   * it met the line, against where the paddle was. Only clear cases count, a court unit or more in reach or out of it.
   */
  const reached = (side: Side, prev: Seen | null, now: Seen, p: Paddle, at: number) => {
    if (!prev || !prev.live || !now.live) return;
    const face = FACE[side];
    const toward = side === 1 ? prev.vx > 0 && prev.x < face : prev.vx < 0 && prev.x > face;
    if (!toward) return;
    const passed = side === 1 ? now.x >= face : now.x <= face;
    if (!passed && Math.sign(now.vx) === Math.sign(prev.vx)) return;
    const y = prev.y + (prev.vy * (face - prev.x)) / prev.vx;
    const off = Math.abs(y - p.y);
    if (Math.abs(off - HALF_HIT) > 1) seen[side].push([at, off < HALF_HIT]);
  };

  const dt = 1 / 60;
  for (let real = dt; real < seconds; real += dt) {
    // ---- host frame
    for (const msg of up.take(real) as Record<string, unknown>[]) {
      if (fresh) {
        if (msg.type === 'paddle') hostEvents(real, hostHears(hnet, host, msg as never, real));
        else if (msg.type === 'pass') hostEvents(real, hearPass(hnet, host, msg as never));
      } else if (msg.type === 'paddle') remoteTarget = msg.y as number;
    }
    const hostTarget = hostBot({ ...host.ball, ...shownBall(hnet, host.ball) });
    const hostDrive = (p: Paddle, h: number) => steerPaddle(p, hostTarget, h, KEY_SPEED);
    if (fresh) {
      hostEvents(real, frame(hnet, host, real, dt, hostDrive, serveRng));
      flush(hnet, down, real);
    } else {
      snapAt += dt;
      hostDrive(host.paddles[0], dt);
      if (remoteTarget !== null) steerPaddle(host.paddles[1], remoteTarget, dt, 420);
      else host.paddles[1].vy *= Math.max(0, 1 - dt * 14);
      hostEvents(real, step(host, dt, [], serveRng));
      if (snapAt >= 0.05) {
        down.send(real, { game: 'pong', type: 'snapshot', match: host }, true, false);
        snapAt %= 0.05;
      }
    }

    // ---- guest frame, a few milliseconds later, on its own clock
    const greal = real + 0.004;
    const glocal = greal + SKEW;
    const own = guest.paddles[1].y;
    for (const msg of down.take(greal) as Record<string, unknown>[]) {
      if (msg.type === 'snapshot') {
        if (fresh && guestHears(gnet, guest, msg as never, glocal)) continue;
        if (!gnet.live) follow(msg.match as Match);
      } else if (msg.type === 'pass' && fresh) hearPass(gnet, guest, msg as never);
      else if (msg.type === 'events' && fresh && gnet.live) guestEvents(gnet, guest, msg as never, glocal);
    }
    const shownBefore = gnet.live ? shownBall(gnet, guest.ball) : { x: guest.ball.x + ballErr.x, y: guest.ball.y + ballErr.y };
    const guestTarget = guestBot({ ...guest.ball, ...shownBefore });
    const guestDrive = (p: Paddle, h: number) => steerPaddle(p, guestTarget, h, KEY_SPEED);
    if (gnet.live) {
      frame(gnet, guest, glocal, dt, guestDrive);
      flush(gnet, up, greal);
    } else {
      guestDrive(guest.paddles[1], dt);
      extrapolateBall(guest, dt);
      if (guest.serveIn <= 0 && guest.winner === null) movePaddle(guest.paddles[0], guest.paddles[0].vy * dt, dt);
      const decay = Math.exp(-dt * 12);
      ballErr.x *= decay;
      ballErr.y *= decay;
      guestSend += dt;
      if (fresh && guestSend >= 1 / 30) {
        up.send(greal, legacyReport(guest.paddles[1], glocal), true, false);
        guestSend %= 1 / 30;
      } else if (!fresh && guestSend >= 0.05) {
        up.send(greal, { game: 'pong', type: 'paddle', y: guest.paddles[1].y }, true, false);
        guestSend %= 0.05;
      }
    }
    // the guest's own paddle answers in the frame it is steered, and never goes against where it is steered
    const moved = guest.paddles[1].y - own;
    const free = own > PADDLE.h / 2 + 0.01 && own < COURT.h - PADDLE.h / 2 - 0.01;
    if (Math.abs(guestTarget - own) > 0.5 && moved === 0 && free) stats.respond++;
    if (moved * (guestTarget - own) < -1e-9) stats.ownBack++;

    // ---- what each screen shows
    const gShown = gnet.live ? shownBall(gnet, guest.ball) : { x: guest.ball.x + ballErr.x, y: guest.ball.y + ballErr.y };
    const hShown = shownBall(hnet, host.ball);
    const gNow: Seen = { ...gShown, vx: guest.ball.vx, vy: guest.ball.vy, live: guest.serveIn <= 0 && guest.winner === null && guest.ball.vx !== 0 };
    const hNow: Seen = { ...hShown, vx: host.ball.vx, vy: host.ball.vy, live: host.serveIn <= 0 && host.winner === null && host.ball.vx !== 0 };
    if (gNow.live && hNow.live) errs.push(Math.hypot(gShown.x - hShown.x, gShown.y - hShown.y));
    paddleErrs.push(Math.abs(host.paddles[1].y - guest.paddles[1].y));
    if (prevGuest && prevGuest.live && gNow.live && Math.sign(prevGuest.vx) === Math.sign(gNow.vx)) {
      const dx = gShown.x - prevGuest.x;
      if (Math.sign(dx) === -Math.sign(gNow.vx) && Math.abs(dx) > 0.3) stats.ballBack++;
    }
    reached(1, prevGuest, gNow, guest.paddles[1], greal);
    reached(0, prevHost, hNow, host.paddles[0], real);
    prevGuest = gNow;
    prevHost = hNow;

    // a match over on both screens: the next one (the room drops the old round's messages)
    if (host.winner !== null && guest.winner !== null) {
      host = createMatch(rand() < 0.5 ? 0 : 1);
      guest = createMatch(0);
      hnet = newNet(0);
      gnet = newNet(1, clock);
      remoteTarget = null;
      ballErr = { x: 0, y: 0 };
      up.clear();
      down.clear();
      prevGuest = prevHost = null;
    }
  }
  // each time a player saw the ball reach their paddle, what the host made of that ball there (its nearest call)
  for (const side of [0, 1] as Side[]) {
    for (const [at, reach] of seen[side]) {
      const near = called[side].filter(([t]) => Math.abs(t - at) < 0.5).sort((a, b) => Math.abs(a[0] - at) - Math.abs(b[0] - at))[0];
      if (!near) continue;
      if (side === 1) {
        stats.calls++;
        if (near[1] !== reach) stats.wrong++;
      } else {
        stats.hostCalls++;
        if (near[1] !== reach) stats.hostWrong++;
      }
    }
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  stats.paddleErr = mean(paddleErrs);
  stats.ballErr = mean(errs);
  stats.ballErr95 = errs.sort((a, b) => a - b)[Math.floor(errs.length * 0.95)] ?? 0;
  return stats;
}

const LINKS: [string, LinkCfg][] = [
  ['60 ms', { latency: 0.022, jitter: 0.016, loss: 0.01 }],
  ['100 ms', { latency: 0.04, jitter: 0.02, loss: 0.02 }],
  ['150 ms', { latency: 0.063, jitter: 0.024, loss: 0.02 }],
  ['150 ms rough', { latency: 0.05, jitter: 0.05, loss: 0.06 }],
];

test('Pong online: the guest\'s returns count as it sees them, and the ball agrees on both screens', { timeout: 120_000 }, () => {
  const runs = LINKS.map(([name, link]) => ({ name, old: simulate(false, link, 480, 11), now: simulate(true, link, 480, 11) }));
  const fmt = (s: Stats) => `respond ${s.respond} frames, own paddle back ${s.ownBack}, host copy off ${s.paddleErr.toFixed(1)}, ball apart ${s.ballErr.toFixed(1)} (95% ${s.ballErr95.toFixed(1)}), ball back ${s.ballBack}, guest calls wrong ${s.wrong}/${s.calls}, host calls wrong ${s.hostWrong}/${s.hostCalls}, points ${s.points}`;
  console.log(runs.map(({ name, old, now }) => `RTT ${name}\n  before: ${fmt(old)}\n  after:  ${fmt(now)}`).join('\n'));
  for (const { old, now } of runs) {
    assert.equal(now.respond, 0);
    assert.equal(now.ownBack, 0);
    assert.ok(now.calls > 30, `enough returns to judge (${now.calls})`);
    assert.ok(now.wrong <= now.calls * 0.02, `the host calls the guest's end as the guest saw it (${now.wrong}/${now.calls})`);
    assert.ok(now.hostWrong <= now.hostCalls * 0.02, `and the host's own end as the host saw it (${now.hostWrong}/${now.hostCalls})`);
    assert.ok(now.wrong < old.wrong || old.wrong === 0);
    assert.ok(now.ballErr < old.ballErr, 'the ball is closer on the two screens');
    assert.ok(now.paddleErr < old.paddleErr, 'the host has the guest paddle closer to where it is');
  }
});

/** Host and guest over a fixed one-way delay, stepping 60 frames a second, serves going straight; the guest's paddle goes where `guestY` says. */
function pair(delay: number) {
  const host = createMatch(1);
  const guest = createMatch(0);
  const hnet = newNet(0);
  const gnet = newNet(1);
  const up: [number, unknown][] = [];
  const down: [number, unknown][] = [];
  const hostEvents: PongEvent[] = [];
  const guestSeen: PongEvent[] = [];
  let real = 0;
  const send = (q: [number, unknown][], net: Net) => {
    for (const o of net.out.splice(0) as Out[]) q.push([real + delay, JSON.parse(JSON.stringify(o.data))]);
  };
  const run = (seconds: number, guestY: (m: Match) => number, hostY: (m: Match) => number = () => COURT.h / 2) => {
    const end = real + seconds;
    while (real < end) {
      real += 1 / 60;
      while (up.length && up[0][0] <= real) {
        const msg = up.shift()![1] as Record<string, unknown>;
        if (msg.type === 'paddle') hostEvents.push(...hostHears(hnet, host, msg as never, real));
        if (msg.type === 'pass') hostEvents.push(...hearPass(hnet, host, msg as never));
      }
      hostEvents.push(...frame(hnet, host, real, 1 / 60, (p, h) => steerPaddle(p, hostY(host), h, 1000), () => 0.5));
      send(down, hnet);
      while (down.length && down[0][0] <= real) {
        const msg = down.shift()![1] as Record<string, unknown>;
        if (msg.type === 'snapshot') {
          if (!guestHears(gnet, guest, msg as never, real + SKEW)) guest.score = [...(msg.match as Match).score];
        }
        if (msg.type === 'pass') guestSeen.push(...hearPass(gnet, guest, msg as never));
      }
      // (a hidden tab runs no frames, and so says nothing)
      if (gnet.live && !state.hidden) {
        guestSeen.push(...frame(gnet, guest, real + SKEW, 1 / 60, (p, h) => steerPaddle(p, guestY(guest), h, 1000)));
        send(up, gnet);
      } else if (!gnet.live) up.push([real + delay, legacyReport(guest.paddles[1], real + SKEW)]);
    }
  };
  const state = { host, guest, hnet, gnet, hostEvents, guestSeen, run, hidden: false };
  return state;
}

test('a return the guest makes at the last moment on its screen counts on the host', () => {
  const s = pair(0.09);
  s.run(0.5, () => COURT.h / 2);
  assert.ok(s.gnet.live, 'the guest reads the host clock and takes over its end');
  assert.ok(s.hnet.peer);
  // a ball for the guest, low; the guest waits high and dashes down only as it arrives on its own screen
  s.host.serveIn = 0.01;
  s.run(0.05, () => 10);
  let hitHost = false;
  s.run(3, (m) => {
    const b = m.ball;
    if (b.vx > 0 && b.x > FACE[1] - 6) return predictY(b, FACE[1]);
    return 10;
  });
  hitHost = s.guestSeen.some((e) => e.kind === 'paddle' && e.side === 1);
  assert.ok(hitHost, 'the guest hit it on its own screen');
  assert.ok(s.hostEvents.some((e) => e.kind === 'paddle' && e.side === 1), 'and the host heard the return');
  assert.equal(s.host.score[0], 0, 'no point for the host');
});

test('a guest that lets the ball by gives the host the point, and the host serves again', () => {
  const s = pair(0.06);
  s.run(0.5, () => COURT.h / 2);
  s.host.serveTo = 1;
  s.host.serveIn = 0.01;
  s.run(2.5, (m) => (m.ball.y > COURT.h / 2 ? 10 : COURT.h - 10));
  assert.equal(s.host.score[0], 1);
  assert.equal(s.guest.score[0], 1);
  assert.ok(s.hostEvents.some((e) => e.kind === 'score' && e.side === 0));
  assert.ok(s.guestSeen.some((e) => e.kind === 'score' && e.side === 0), 'the guest sees its own miss at once');
});

test('a guest gone quiet (a hidden tab) leaves its end to the host instead of holding up the point', () => {
  const s = pair(0.06);
  // (the guest's paddle last heard of up top, well away from a straight serve)
  s.run(0.5, () => 10);
  s.host.serveTo = 1;
  s.host.serveIn = 0.01;
  s.hidden = true;
  s.run(3.5, () => 10, () => COURT.h / 2);
  assert.ok(s.host.score[0] + s.host.score[1] >= 1, 'the point was played out on the host');
});

test('old and new packets work both ways', () => {
  // an older guest sends only y: the host steers toward it and calls the guest's end itself
  const host = createMatch(1);
  const net = newNet(0);
  hostHears(net, host, { game: 'pong', type: 'paddle', y: 20 }, 1);
  assert.equal(net.peer, false);
  assert.equal(net.target, 20);
  frame(net, host, 1, 1 / 60, () => {});
  frame(net, host, 1.1, 0.1, () => {});
  assert.ok(host.paddles[1].y < COURT.h / 2, 'steered toward the report');
  const snap = net.out.find((o) => (o.data as { type: string }).type === 'snapshot')!.data as Record<string, unknown>;
  assert.ok(snap.match, 'an older guest still gets the whole match');
  // the room reads a top level t or k as a message's kind: none here
  for (const o of net.out) assert.ok(!('t' in (o.data as object)) && !('k' in (o.data as object)));
  // an older host's snapshot (no clock): the guest keeps following snapshots
  const guest = newNet(1);
  assert.equal(guestHears(guest, createMatch(), { game: 'pong', type: 'snapshot', match: createMatch() }, 1), null);
  assert.equal(guest.live, false);
});

test('the guest reads the host clock within a few milliseconds over a jittery link', () => {
  const clock = new HostClock();
  const rand = rng(5);
  const offset = 123.456;
  for (let i = 0; i < 60; i++) {
    const c = i * 0.033;
    const up = 0.04 + rand() * 0.03;
    const hold = rand() * 0.02;
    const hostT = c + offset + up + hold;
    const now = c + up + hold + 0.04 + rand() * 0.03;
    clock.observe(c, hold, hostT, now);
  }
  assert.ok(Math.abs(clock.ahead - offset) < 0.012, `${clock.ahead}`);
});
