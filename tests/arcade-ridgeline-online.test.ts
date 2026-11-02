import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newBrain } from '../src/os/arcade/games/ridgeline/bots.ts';
import { botInput } from '../src/os/arcade/games/ridgeline/bots.ts';
import { idleInput, step, type Match } from '../src/os/arcade/games/ridgeline/match.ts';
import { Clock, Session, Track, type OnlineApi } from '../src/os/arcade/games/ridgeline/online.ts';
import { worldFor } from '../src/os/arcade/games/ridgeline/world.ts';

const DT = 1 / 60;

/** A room on one machine: messages arrive late (and fast ones sometimes not at all), every machine on its own clock. */
class Net {
  time = 0;
  private q: { at: number; from: number; to: number; d: string }[] = [];
  private last = new Map<string, number>();
  handlers: { me: { seat: number }; fn: (from: number, d: unknown) => void }[] = [];
  players: { seat: number; name: string }[] = [];
  host = 0;
  rnd = 7;
  private r() {
    this.rnd = (this.rnd * 1103515245 + 12345) % 2147483648;
    return this.rnd / 2147483648;
  }
  sent = 0;
  bytes = 0;
  api(seat0: number, skew: number): OnlineApi & { skew: number; me: { seat: number } } {
    const net = this;
    const me = { seat: seat0 };
    return {
      skew,
      me,
      get seat() {
        return me.seat;
      },
      get isHost() {
        return me.seat === net.host;
      },
      round: 1,
      get players() {
        return net.players;
      },
      send(d, opts) {
        const seat = me.seat;
        const s = JSON.stringify(d);
        net.sent++;
        net.bytes += s.length;
        assert.ok(s.length < 8000, `a message over the room's limit (${s.length})`);
        const to = opts?.to !== undefined ? [opts.to] : seat === net.host ? net.players.map((p) => p.seat).filter((x) => x !== seat) : [net.host];
        for (const t of to) {
          if (opts?.fast && net.r() < 0.05) continue;
          const lat = 0.04 + net.r() * 0.05;
          const key = `${seat}>${t}`;
          // reliable ones keep their order
          const at = opts?.fast ? net.time + lat : Math.max(net.time + lat, net.last.get(key) ?? 0);
          if (!opts?.fast) net.last.set(key, at);
          net.q.push({ at, from: seat, to: t, d: s });
        }
      },
      onMessage(fn) {
        net.handlers.push({ me, fn });
        return () => (net.handlers = net.handlers.filter((h) => h.fn !== fn));
      },
    };
  }
  deliver() {
    const due = this.q.filter((x) => x.at <= this.time).sort((a, b) => a.at - b.at);
    this.q = this.q.filter((x) => x.at > this.time);
    for (const x of due) for (const h of this.handlers) if (h.me.seat === x.to) h.fn(x.from, JSON.parse(x.d));
  }
}

type Seat = { s: Session; api: ReturnType<Net['api']>; brainSet: boolean; round: number };

function frame(net: Net, seats: Seat[]) {
  net.time += DT;
  net.deliver();
  for (const p of seats) {
    const m = p.s.match ?? p.s.attach(worldFor('vale'));
    if (!m) continue;
    const me = m.actors[m.me];
    // everyone's own soldier is played by a bot brain on their own machine (a guest's sees only its mirror)
    // (as the host does for its bots, a fresh plan each round)
    if (!p.brainSet || p.round !== m.round) {
      me.brain = me.brain ?? newBrain('normal', 1000 + p.api.seat);
      me.brain.reset = true;
      p.brainSet = true;
      p.round = m.round;
    }
    p.s.before(m);
    const inp = me.alive && me.brain ? botInput(m, me, DT) : idleInput(me.yaw, me.pitch);
    p.s.using = inp.use;
    step(m, DT, inp);
    p.s.after(m);
  }
}

function room(n: number) {
  const net = new Net();
  net.players = Array.from({ length: n }, (_, i) => ({ seat: i, name: `P${i}` }));
  const seats: Seat[] = net.players.map((p) => {
    const api = net.api(p.seat, p.seat * 1000);
    const s = new Session(api, { map: 'vale', level: 'normal', now: () => net.time + api.skew });
    return { s, api, brainSet: false, round: -1 };
  });
  return { net, seats };
}

test('online: a room plays a match together, every machine agreeing on the rounds, with guests hitting what they shoot', () => {
  const { net, seats } = room(3);
  const [host, g1, g2] = seats;
  let guestHits = 0;
  let maxGap = 0;
  let gapN = 0;
  let gapSum = 0;
  for (let i = 0; i < 60 * 330 && (host.s.match?.round ?? 0) < 4 && host.s.match?.phase !== 'over'; i++) {
    frame(net, seats);
    const h = host.s.match;
    if (!h) continue;
    for (const e of h.events) if (e.t === 'hit' && (e.a === g1.s.match?.me || e.a === g2.s.match?.me) && e.dmg > 0) guestHits++;
    // a guest's picture of a bot: where the host had it a little before
    const gm = g1.s.match;
    if (gm && i % 30 === 0 && h.phase === 'live') {
      for (const a of h.actors) {
        if (!a.bot || !a.alive || !gm.actors[a.id].alive) continue;
        const b = gm.actors[a.id].body;
        const d = Math.hypot(b.x - a.body.x, b.z - a.body.z);
        maxGap = Math.max(maxGap, d);
        gapSum += d;
        gapN++;
      }
    }
  }
  // a moment for the last of the host's word to arrive
  for (let i = 0; i < 60; i++) frame(net, seats);
  const h = host.s.match!;
  for (const g of [g1, g2]) {
    const m = g.s.match!;
    assert.ok(m, 'the guest has its mirror');
    assert.equal(m.authority, false);
    assert.equal(m.actors[m.me].seat, g.api.seat, 'the guest plays its own seat');
    assert.equal(h.actors[m.me].remote, true, 'the host plays it as a remote player');
    assert.deepEqual(m.score, h.score, 'same score everywhere');
    assert.equal(m.round, h.round, 'same round');
    assert.deepEqual(
      m.actors.map((a) => a.name),
      h.actors.map((a) => a.name),
    );
  }
  assert.ok(h.round >= 3, `rounds were played (${h.round})`);
  assert.ok(guestHits > 3, `guests' shots landed (${guestHits} hits)`);
  // others are drawn about a tenth of a second behind, never far off
  assert.ok(gapN > 20 && gapSum / gapN < 1.2, `a guest's view tracks the host's (mean ${(gapSum / gapN).toFixed(2)} m)`);
  assert.ok(maxGap < 6, `no jumps in a guest's view (max ${maxGap.toFixed(2)} m)`);
  // the traffic stays light: well under what a home connection carries
  const perSec = net.bytes / net.time / 1024;
  assert.ok(perSec < 120, `traffic ${perSec.toFixed(0)} KB/s for the whole room`);
});

test('online: a leaver becomes a bot, a latecomer takes one over, and the match survives the host leaving', () => {
  const { net, seats } = room(3);
  for (let i = 0; i < 60 * 8; i++) frame(net, seats);
  const h = seats[0].s.match!;
  const g2me = seats[2].s.match!.me;
  // seat 2 leaves
  net.players = net.players.filter((p) => p.seat !== 2);
  seats[0].s.playersChanged(net.players);
  const gone = seats.pop()!;
  gone.s.dispose();
  assert.equal(h.actors[g2me].bot, true, 'the leaver is a bot now');
  assert.equal(h.actors[g2me].remote, false);
  // seat 3 joins mid match
  net.players = [...net.players, { seat: 3, name: 'Late' }];
  const api = net.api(3, 3000);
  const late: Seat = { s: new Session(api, { map: 'vale', level: 'normal', now: () => net.time + api.skew }), api, brainSet: false, round: -1 };
  seats.push(late);
  for (let i = 0; i < 60 * 4; i++) frame(net, seats);
  const lm = late.s.match!;
  assert.ok(lm, 'the latecomer has a mirror');
  assert.equal(lm.actors[lm.me].name, 'Late');
  assert.equal(h.actors[lm.me].remote, true, 'the host plays the latecomer as a person');
  assert.equal(h.actors[lm.me].bot, false);
  // the host leaves: the room renumbers seat 1 to seat 0, and its game takes over the rules
  const score = [...h.score];
  const round = h.round;
  seats[0].s.dispose();
  seats.shift();
  net.host = 0;
  net.players = net.players.filter((p) => p.seat !== 0).map((p) => (p.seat === 1 ? { ...p, seat: 0 } : p));
  seats[0].api.me.seat = 0;
  for (const p of seats) p.s.handOff(1);
  const nh = seats[0].s.match!;
  assert.equal(nh.authority, true, 'the new host runs the rules');
  const t0 = nh.time;
  for (let i = 0; i < 60 * 150 && nh.round === round && nh.phase !== 'over'; i++) frame(net, seats);
  assert.ok(nh.time - t0 > 1, 'the new host steps the match');
  assert.ok(nh.round > round || nh.score[0] + nh.score[1] > score[0] + score[1] || nh.phase === 'over', `the match went on (round ${round} to ${nh.round})`);
  assert.deepEqual(late.s.match!.score, nh.score, 'the latecomer follows the new host');
  assert.ok(nh.actors.filter((a) => !a.bot).length === 2, 'two people left in it');
});

test('online: clocks and tracks: a remote clock maps onto this one, and a track interpolates and holds on', () => {
  const c = new Clock();
  c.feed(100, 5.06);
  c.feed(100.05, 5.12);
  c.feed(100.1, 5.15);
  assert.ok(Math.abs(c.map(100.1) - 5.15) < 0.02);
  const t = new Track();
  t.push({ t: 1, x: 0, y: 0, z: 0, yaw: 3.1, pitch: 0, vx: 10, vz: 0 });
  t.push({ t: 1.1, x: 1, y: 0, z: 0, yaw: -3.1, pitch: 0, vx: 10, vz: 0 });
  const p = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0 };
  assert.ok(t.sample(1.05, p));
  assert.ok(Math.abs(p.x - 0.5) < 1e-6);
  // the short way round the angle
  assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 0.1);
  // past the last sample: on along its velocity, but never far
  t.sample(5, p);
  assert.ok(p.x > 1 && p.x < 2.3);
});
