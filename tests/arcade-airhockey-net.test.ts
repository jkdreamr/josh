// Air Hockey online over a slow, jittery link, host and guest in one process: the netcode as the game runs it (net.ts),
// next to the old one (the guest drew the host's table eased toward its snapshots, and the host chased the guest's last
// reported mallet at 9 m/s and played every hit itself), measured the same way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { L, MALLET_R, PUCK_R, create, moveMalletTo, newAiMem, step, stepAI, type AiMem, type Event, type State } from '../src/os/arcade/games/airhockey/logic.ts';
import { HostClock, frame, guestEvents, guestHears, hearPass, holder, hostHears, legacyReport, newNet, shownPuck, type Net } from '../src/os/arcade/games/airhockey/net.ts';

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
  take(now: number): Record<string, unknown>[] {
    const due = this.q.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.n - b.n);
    this.q = this.q.filter((m) => m.at > now);
    return due.map((m) => JSON.parse(m.data));
  }
  clear() {
    this.q = [];
  }
}

const REACH = MALLET_R + PUCK_R;
/** The guest's clock reads this much more than the host's. */
const SKEW = 4.2;
const SOFT = 0.3;

type Stats = {
  /** Frames where anything but the guest's own controls moved its mallet (word from the host, a correction). */
  ownMoved: number;
  /** The host's copy of the guest's mallet against where the guest has it, and the puck on the two screens (table units). */
  malletErr: number;
  puckErr: number;
  puckErr95: number;
  /** Frames the puck drawn on a player's screen sat deep inside their own mallet (it went through). */
  through: number;
  hostThrough: number;
  /** Times the puck met the guest's mallet on the guest's screen, and how many of them the host never counted as a guest hit. */
  touches: number;
  lost: number;
  goals: number;
};

/**
 * Plays `seconds` of matches between two hard computer players, each moving its own mallet from what its own screen
 * shows, over the link, 60 frames a second each, the guest's a few milliseconds after the host's. `fresh`: the netcode
 * in net.ts; otherwise the old one.
 */
function simulate(fresh: boolean, link: LinkCfg, seconds: number, seed: number): Stats {
  const up = new Pipe(link, rng(seed + 1));
  const down = new Pipe(link, rng(seed + 2));
  const hostAi = rng(seed + 3);
  const guestAi = rng(seed + 4);
  const fresh2 = () => {
    const s = create('2p', 'hard');
    return s;
  };
  let host = fresh2();
  let guest = fresh2();
  let hostMem: AiMem = newAiMem(0);
  let guestMem: AiMem = newAiMem(1);
  const clock = new HostClock();
  let hnet: Net = newNet(0);
  let gnet: Net = newNet(1, clock);
  let remoteTarget: { x: number; z: number } | null = null;
  let remoteState: State | null = null;
  let guestSend = 0;
  let snapAt = 0;
  const stats: Stats = { ownMoved: 0, malletErr: 0, puckErr: 0, puckErr95: 0, through: 0, hostThrough: 0, touches: 0, lost: 0, goals: 0 };
  const errs: number[] = [];
  const malletErrs: number[] = [];
  /** When the puck met the guest's mallet on the guest's screen, and when the host counted a guest hit. */
  const touched: number[] = [];
  const counted: number[] = [];
  /** The guest's screen last frame: the puck and its own mallet, where and how they moved. */
  let before: { px: number; pz: number; pvx: number; pvz: number; mx: number; mz: number; mvx: number; mvz: number } | null = null;
  let lastTouch = -Infinity;

  const flush = (net: Net, pipe: Pipe, now: number) => {
    for (const o of net.out.splice(0)) pipe.send(now, o.data, o.fast, o.reliable);
  };
  const hostSaw = (now: number, ev: Event) => {
    if (ev.hit === 1 && (ev.power ?? 0) > SOFT) counted.push(now);
    if (ev.goal !== undefined) stats.goals++;
    const loud = ev.goal !== undefined || (ev.hit !== undefined && (ev.power ?? 0) > SOFT) || (ev.wall && (ev.wallPower ?? 0) > 0.5);
    if (loud) down.send(now, { game: 'airhockey', type: 'events', event: ev, state: host, at: Math.round(hnet.t * 1000), turn: hnet.turn }, false, true);
  };
  const hostDrive = (s: State, side: 0 | 1, h: number) => stepAI(s, h, hostAi, side, hostMem);
  const guestDrive = (s: State, side: 0 | 1, h: number) => stepAI(s, h, guestAi, side, guestMem);

  const dt = 1 / 60;
  for (let real = dt; real < seconds; real += dt) {
    // ---- host frame
    for (const msg of up.take(real)) {
      if (fresh) {
        if (msg.type === 'mallet') hostSaw(real, hostHears(hnet, host, msg as never, real));
        else if (msg.type === 'pass') hostSaw(real, hearPass(hnet, host, msg as never));
      } else if (msg.type === 'mallet') remoteTarget = { x: msg.x as number, z: msg.z as number };
    }
    if (fresh) {
      hostSaw(real, frame(hnet, host, real, dt, hostDrive));
      flush(hnet, down, real);
    } else {
      snapAt += dt;
      const ev: Event = {};
      for (let i = 0; i < 2 && host.winner === null; i++) {
        hostDrive(host, 0, dt / 2);
        if (remoteTarget) moveMalletTo(host, 1, remoteTarget, dt / 2, 9);
        else host.mallets[1].vx = host.mallets[1].vz = 0;
        const e = step(host, dt / 2);
        if (e.hit !== undefined && (e.power ?? 0) >= (ev.power ?? 0)) {
          ev.hit = e.hit;
          ev.power = e.power;
        }
        if (e.goal !== undefined) ev.goal = e.goal;
      }
      hostSaw(real, ev);
      if (snapAt >= 0.05) {
        down.send(real, { game: 'airhockey', type: 'snapshot', state: host }, true, false);
        snapAt %= 0.05;
      }
    }

    // ---- guest frame, a few milliseconds later, on its own clock
    const greal = real + 0.004;
    const glocal = greal + SKEW;
    const own = { x: guest.mallets[1].x, z: guest.mallets[1].z };
    for (const msg of down.take(greal)) {
      if (msg.type === 'snapshot') {
        if (fresh && guestHears(gnet, guest, msg as never, glocal)) continue;
        if (!gnet.live) remoteState = msg.state as State;
      } else if (msg.type === 'pass' && fresh) hearPass(gnet, guest, msg as never);
      else if (msg.type === 'events' && fresh && gnet.live) guestEvents(gnet, guest, msg as never);
    }
    if (Math.hypot(guest.mallets[1].x - own.x, guest.mallets[1].z - own.z) > 1e-9) stats.ownMoved++;
    if (gnet.live) {
      frame(gnet, guest, glocal, dt, guestDrive);
      flush(gnet, up, greal);
    } else {
      if (remoteState) {
        const target = remoteState;
        const t = Math.min(1, dt * 18);
        guest.puck.x += (target.puck.x - guest.puck.x) * t;
        guest.puck.z += (target.puck.z - guest.puck.z) * t;
        guest.puck.vx = target.puck.vx;
        guest.puck.vz = target.puck.vz;
        const m = guest.mallets[0];
        m.x += (target.mallets[0].x - m.x) * t;
        m.z += (target.mallets[0].z - m.z) * t;
        guest.score = [...target.score];
        guest.freeze = target.freeze;
        guest.winner = target.winner;
      }
      guestDrive(guest, 1, dt);
      guestSend += dt;
      if (fresh && guestSend >= 1 / 30) {
        up.send(greal, legacyReport(guest, glocal), true, false);
        guestSend %= 1 / 30;
      } else if (!fresh && guestSend >= 0.05) {
        up.send(greal, { game: 'airhockey', type: 'mallet', x: guest.mallets[1].x, z: guest.mallets[1].z }, true, false);
        guestSend %= 0.05;
      }
    }

    // ---- what each screen shows
    const gPuck = gnet.live ? shownPuck(gnet, guest) : guest.puck;
    const hPuck = shownPuck(hnet, host);
    const playing = host.freeze <= 0 && guest.freeze <= 0 && host.winner === null && guest.winner === null;
    if (playing) errs.push(Math.hypot(gPuck.x - hPuck.x, gPuck.z - hPuck.z));
    malletErrs.push(Math.hypot(host.mallets[1].x - guest.mallets[1].x, host.mallets[1].z - guest.mallets[1].z));
    const gm = guest.mallets[1];
    const gap = Math.hypot(gPuck.x - gm.x, gPuck.z - gm.z);
    if (playing && gap < REACH * 0.6) stats.through++;
    const hm = host.mallets[0];
    if (playing && Math.hypot(hPuck.x - hm.x, hPuck.z - hm.z) < REACH * 0.6) stats.hostThrough++;
    // The puck meeting the guest's mallet on the guest's screen: some time this frame (both swept along their way) they
    // came within reach, the puck coming at the mallet at a metre a second or more (a real hit, not resting contact).
    if (playing && before && greal - lastTouch > 0.25) {
      let near = Infinity;
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        const px = before.px + (gPuck.x - before.px) * k;
        const pz = before.pz + (gPuck.z - before.pz) * k;
        const mx = before.mx + (gm.x - before.mx) * k;
        const mz = before.mz + (gm.z - before.mz) * k;
        near = Math.min(near, Math.hypot(px - mx, pz - mz));
      }
      const d = Math.hypot(before.px - before.mx, before.pz - before.mz) || 1;
      const closing = -((before.pvx - before.mvx) * (before.px - before.mx) + (before.pvz - before.mvz) * (before.pz - before.mz)) / d;
      if (near < REACH + 0.005 && closing > 1) {
        touched.push(greal);
        lastTouch = greal;
      }
    }
    before = playing ? { px: gPuck.x, pz: gPuck.z, pvx: guest.puck.vx, pvz: guest.puck.vz, mx: gm.x, mz: gm.z, mvx: gm.vx, mvz: gm.vz } : null;

    if (host.winner !== null && guest.winner !== null) {
      host = fresh2();
      guest = fresh2();
      hostMem = newAiMem(0);
      guestMem = newAiMem(1);
      hnet = newNet(0);
      gnet = newNet(1, clock);
      remoteTarget = null;
      remoteState = null;
      up.clear();
      down.clear();
    }
  }
  for (const at of touched) {
    stats.touches++;
    if (!counted.some((t) => t > at - 0.3 && t < at + 0.5)) stats.lost++;
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  stats.malletErr = mean(malletErrs);
  stats.puckErr = mean(errs);
  stats.puckErr95 = errs.sort((a, b) => a - b)[Math.floor(errs.length * 0.95)] ?? 0;
  return stats;
}

const LINKS: [string, LinkCfg][] = [
  ['60 ms', { latency: 0.022, jitter: 0.016, loss: 0.01 }],
  ['100 ms', { latency: 0.04, jitter: 0.02, loss: 0.02 }],
  ['150 ms', { latency: 0.063, jitter: 0.024, loss: 0.02 }],
  ['150 ms rough', { latency: 0.05, jitter: 0.05, loss: 0.06 }],
];

test('Air Hockey online: the guest\'s hits count as it sees them, and the puck agrees on both screens', { timeout: 120_000 }, () => {
  const runs = LINKS.map(([name, link]) => ({ name, old: simulate(false, link, 240, 7), now: simulate(true, link, 240, 7) }));
  const fmt = (s: Stats) => `own mallet moved by word ${s.ownMoved}, host copy off ${s.malletErr.toFixed(3)}, puck apart ${s.puckErr.toFixed(3)} (95% ${s.puckErr95.toFixed(3)}), puck through guest mallet ${s.through} frames (host's own ${s.hostThrough}), guest touches the host missed ${s.lost}/${s.touches}, goals ${s.goals}`;
  console.log(runs.map(({ name, old, now }) => `RTT ${name}\n  before: ${fmt(old)}\n  after:  ${fmt(now)}`).join('\n'));
  for (const { old, now } of runs) {
    assert.equal(now.ownMoved, 0);
    assert.ok(now.touches > 100, `enough touches to judge (${now.touches})`);
    assert.ok(now.lost <= now.touches * 0.05, `the host counts the guest's hits as the guest saw them (${now.lost}/${now.touches})`);
    assert.ok(now.lost < old.lost);
    assert.ok(now.through < old.through, 'the puck goes through the guest\'s mallet less');
    assert.ok(now.puckErr < old.puckErr, 'the puck is closer on the two screens');
    assert.ok(now.malletErr < old.malletErr, 'the host has the guest mallet closer to where it is');
  }
});

/** Host and guest over a fixed one-way delay, 60 frames a second; each mallet goes where its function says (on that screen's own table). */
function pair(delay: number) {
  const host = create('2p');
  const guest = create('2p');
  const hnet = newNet(0);
  const gnet = newNet(1);
  const up: [number, unknown][] = [];
  const down: [number, unknown][] = [];
  const hostSeen: Event[] = [];
  const guestSeen: Event[] = [];
  let real = 0;
  const send = (q: [number, unknown][], net: Net) => {
    for (const o of net.out.splice(0)) q.push([real + delay, JSON.parse(JSON.stringify(o.data))]);
  };
  type Aim = (s: State) => { x: number; z: number };
  const run = (seconds: number, guestAt: Aim, hostAt: Aim = () => ({ x: 0, z: L / 2 - 0.3 })) => {
    const end = real + seconds;
    while (real < end - 1e-9) {
      real += 1 / 60;
      while (up.length && up[0][0] <= real) {
        const msg = up.shift()![1] as Record<string, unknown>;
        if (msg.type === 'mallet') hostSeen.push(hostHears(hnet, host, msg as never, real));
        if (msg.type === 'pass') hostSeen.push(hearPass(hnet, host, msg as never));
      }
      hostSeen.push(frame(hnet, host, real, 1 / 60, (s, side, h) => moveMalletTo(s, side, hostAt(s), h, 30)));
      send(down, hnet);
      while (down.length && down[0][0] <= real) {
        const msg = down.shift()![1] as Record<string, unknown>;
        if (msg.type === 'snapshot') guestHears(gnet, guest, msg as never, real + SKEW);
        if (msg.type === 'pass') guestSeen.push(hearPass(gnet, guest, msg as never));
      }
      // (a match over on the guest's screen stops its frames, as the game's loop stops with the Game Over card, and a hidden tab runs none)
      if (gnet.live && guest.winner === null && !state.hidden) {
        guestSeen.push(frame(gnet, guest, real + SKEW, 1 / 60, (s, side, h) => moveMalletTo(s, side, guestAt(s), h, 30)));
        send(up, gnet);
      } else if (!gnet.live) up.push([real + delay, legacyReport(guest, real + SKEW)]);
    }
  };
  const state = { host, guest, hnet, gnet, hostSeen, guestSeen, run, hidden: false };
  return state;
}

test('a save the guest makes at the last moment on its screen holds on the host', () => {
  const s = pair(0.09);
  const wait = () => ({ x: 0.6, z: -(L / 2 - 0.3) });
  s.run(0.6, wait);
  assert.ok(s.gnet.live && s.hnet.peer, 'the guest reads the host clock and takes over its half');
  // the host fires the puck straight at the guest's goal; the guest steps across only once it is close on its own screen
  Object.assign(s.host.puck, { x: 0, z: 0.4, vx: 0, vz: -5 });
  s.host.freeze = 0;
  s.run(1.2, (g) => (g.puck.z < -0.9 && g.puck.vz < 0 ? { x: 0, z: -(L / 2 - 0.3) } : wait()));
  assert.ok(s.guestSeen.some((e) => e.hit === 1), 'the guest blocked it on its own screen');
  assert.deepEqual(s.host.score, [0, 0], 'no goal on the host');
  assert.deepEqual(s.guest.score, [0, 0]);
  assert.ok(s.hostSeen.some((e) => e.hit === 1), 'the host heard the save');
  assert.ok(s.host.puck.vz > 0 || s.host.puck.z > 0, 'and the puck comes back on the host');
});

test('a goal the guest lets in is the host\'s, and the guest serves', () => {
  const s = pair(0.06);
  const away = () => ({ x: 0.7, z: -0.3 });
  s.run(0.6, away);
  Object.assign(s.host.puck, { x: 0, z: 0.4, vx: 0, vz: -5 });
  s.host.freeze = 0;
  s.run(1.5, away);
  assert.deepEqual(s.guest.score, [1, 0], 'the guest sees its own goal at once');
  assert.deepEqual(s.host.score, [1, 0]);
  assert.ok(s.hostSeen.some((e) => e.goal === 0));
  assert.equal(holder(s.gnet), 1, 'the puck is the guest\'s to serve');
  assert.ok(s.guest.puck.z < 0 && s.host.puck.z < 0);
});

test('a guest gone quiet (a hidden tab) leaves its half to the host instead of holding up the puck', () => {
  const s = pair(0.06);
  s.run(0.6, () => ({ x: 0.7, z: -0.3 }));
  Object.assign(s.host.puck, { x: 0, z: 0.4, vx: 0, vz: -5 });
  s.host.freeze = 0;
  s.hidden = true;
  s.run(2.5, () => ({ x: 0.7, z: -0.3 }));
  assert.deepEqual(s.host.score, [1, 0], 'the host plays the goal out itself');
});

test('the last goal the guest lets in reaches the host though the guest\'s match stops with it', () => {
  const s = pair(0.06);
  s.host.score = [6, 2];
  s.guest.score = [6, 2];
  const away = () => ({ x: 0.7, z: -0.3 });
  s.run(0.6, away);
  Object.assign(s.host.puck, { x: 0, z: 0.4, vx: 0, vz: -5 });
  s.host.freeze = 0;
  s.run(1.5, away);
  assert.equal(s.guest.winner, 0);
  assert.equal(s.host.winner, 0, 'the host has the winning goal too');
  assert.ok(s.hostSeen.some((e) => e.win === 0));
});

test('old and new packets work both ways', () => {
  // an older guest sends only x and z: the host chases them as before and plays the whole table
  const host = create('2p');
  const net = newNet(0);
  hostHears(net, host, { game: 'airhockey', type: 'mallet', x: 0.5, z: -1 }, 1);
  assert.equal(net.peer, false);
  frame(net, host, 1, 1 / 60, () => {});
  frame(net, host, 1.2, 0.2, () => {});
  assert.ok(host.mallets[1].x > 0.3, 'moved toward the report');
  const snap = net.out.find((o) => (o.data as { type: string }).type === 'snapshot')!.data as Record<string, unknown>;
  assert.ok(snap.state, 'an older guest still gets the whole table');
  for (const o of net.out) assert.ok(!('t' in (o.data as object)) && !('k' in (o.data as object)), 'the room reads a top level t or k as a kind');
  // an older host's snapshot (no clock): the guest keeps following snapshots
  const guest = newNet(1);
  assert.equal(guestHears(guest, create('2p'), { game: 'airhockey', type: 'snapshot', state: create('2p') }, 1), null);
  assert.equal(guest.live, false);
});

test('a puck in a goal this screen does not call waits in the mouth, and counts once it does', () => {
  const s = create('2p');
  s.freeze = 0;
  Object.assign(s.puck, { x: 0, z: -L / 2 - 0.05, vx: 0.4, vz: -3 });
  for (let i = 0; i < 30; i++) assert.equal(step(s, 1 / 60, { hold: [false, true] }).goal, undefined);
  assert.deepEqual(s.score, [0, 0]);
  assert.equal(s.puck.vx, 0, 'it stays in the mouth');
  assert.ok(s.puck.z < -L / 2 && s.puck.vz < 0);
  assert.equal(step(s, 1 / 60).goal, 0);
  assert.deepEqual(s.score, [1, 0]);
});
