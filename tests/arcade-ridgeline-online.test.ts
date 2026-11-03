import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newBrain } from '../src/os/arcade/games/ridgeline/bots.ts';
import { botInput } from '../src/os/arcade/games/ridgeline/bots.ts';
import { DM_KILLS, currentGun, idleInput, step, type Actor, type Input, type Match, type Mode } from '../src/os/arcade/games/ridgeline/match.ts';
import { clearLine, groundAt } from '../src/os/arcade/games/ridgeline/physics.ts';
import { floorAt } from '../src/os/arcade/games/ridgeline/terrain.ts';
import { CARS, hurtCar } from '../src/os/arcade/games/ridgeline/cars.ts';
import { PAVISE, WEAPON_IDS, type WeaponId } from '../src/os/arcade/games/ridgeline/weapons.ts';
import { Clock, NET_TAG, Session, Track, type OnlineApi } from '../src/os/arcade/games/ridgeline/online.ts';
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
  /** The biggest message sent. */
  maxMsg = 0;
  /** Hits guests claimed (each one judged by the host). */
  claims = 0;
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
        if ((d as { k?: string }).k === 'hit') net.claims++;
        net.bytes += s.length;
        net.maxMsg = Math.max(net.maxMsg, s.length);
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
  /** A machine leaving: what it already sent reaches the others before the room tells them it left. */
  flush(from: number) {
    const out = this.q.filter((x) => x.from === from).sort((a, b) => a.at - b.at);
    this.q = this.q.filter((x) => x.from !== from);
    for (const x of out) for (const h of this.handlers) if (h.me.seat === x.to) h.fn(x.from, JSON.parse(x.d));
  }
  deliver() {
    const due = this.q.filter((x) => x.at <= this.time).sort((a, b) => a.at - b.at);
    this.q = this.q.filter((x) => x.at > this.time);
    for (const x of due) for (const h of this.handlers) if (h.me.seat === x.to) h.fn(x.from, JSON.parse(x.d));
  }
}

type Seat = { s: Session; api: ReturnType<Net['api']>; brainSet: boolean; round: number; input?: (m: Match, me: Actor) => Input; asleep?: boolean };

function frame(net: Net, seats: Seat[], world = worldFor('vale'), dt = DT) {
  net.time += dt;
  net.deliver();
  for (const p of seats) {
    // (a machine that stops stepping: a tab in the background, say)
    if (p.asleep) continue;
    const m = p.s.match ?? p.s.attach(world);
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
    const inp = p.input ? p.input(m, me) : me.alive && me.brain ? botInput(m, me, dt) : idleInput(me.yaw, me.pitch);
    p.s.using = inp.use;
    step(m, dt, inp);
    p.s.after(m);
  }
}

/** The host's word so far reaches everyone (the guests take it in, nobody steps). */
function settle(net: Net, seats: Seat[]) {
  for (let i = 0; i < 12; i++) {
    net.time += 1 / 60;
    net.deliver();
    for (const p of seats) if (!p.s.isHost && p.s.match) p.s.after(p.s.match);
  }
}

function room(n: number, seed = Number(process.env.RL_SEED ?? 12345), opts: { mode?: Mode; picks?: (WeaponId | undefined)[] } = {}) {
  const net = new Net();
  net.players = Array.from({ length: n }, (_, i) => ({ seat: i, name: `P${i}` }));
  const seats: Seat[] = net.players.map((p) => {
    const api = net.api(p.seat, p.seat * 1000);
    const s = new Session(api, { mode: opts.mode, map: 'vale', level: 'normal', now: () => net.time + api.skew, seed, dmPick: opts.picks?.[p.seat] });
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
  // (how many fights a guest gets into depends on the match; what matters is that the host takes their honest hits)
  assert.ok(net.claims >= 2 && guestHits >= net.claims * 0.6, `guests' shots landed (${guestHits} of ${net.claims} claimed hits)`);
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

test('online deathmatch: a room plays to the end and agrees on the scores, guests hit what they shoot, respawns snap', () => {
  const { net, seats } = room(3, 777, { mode: 'dm', picks: [undefined, 'longbow', 'mauler'] });
  const [host, g1, g2] = seats;
  let guestHits = 0;
  // a guest's picture of everyone else, frame to frame: a respawn is one jump, never a slide over a few frames
  const last = new Map<number, { x: number; z: number; big: boolean }>();
  let slides = 0;
  let snaps = 0;
  let myRespawns = 0;
  let myOff = 0;
  let wasAlive = true;
  for (let i = 0; i < 60 * 320 && host.s.match?.phase !== 'over'; i++) {
    frame(net, seats);
    const h = host.s.match;
    const gm = g1.s.match;
    if (!h || !gm) continue;
    for (const e of h.events) if (e.t === 'hit' && (e.a === g1.s.match?.me || e.a === g2.s.match?.me) && e.dmg > 0) guestHits++;
    for (const a of gm.actors) {
      if (a.id === gm.me) continue;
      const p = last.get(a.id);
      if (a.alive && p) {
        const d = Math.hypot(a.body.x - p.x, a.body.z - p.z);
        const big = d > 1.5;
        if (big && p.big) slides++;
        if (d > 8) snaps++;
        last.set(a.id, { x: a.body.x, z: a.body.z, big });
      } else last.set(a.id, { x: a.body.x, z: a.body.z, big: false });
    }
    // the guest's own respawn: it stands where the host put it
    const me = gm.actors[gm.me];
    if (me.alive && !wasAlive) {
      myRespawns++;
      const hm = h.actors[gm.me];
      myOff = Math.max(myOff, Math.hypot(hm.body.x - me.body.x, hm.body.z - me.body.z));
    }
    wasAlive = me.alive;
  }
  for (let i = 0; i < 60; i++) frame(net, seats);
  const h = host.s.match!;
  assert.equal(h.phase, 'over');
  assert.equal(h.actors.length, 8, 'bots fill the room to eight');
  assert.equal(h.actors[g1.s.match!.me].dmPick, 'longbow', "the guest's gun is the one it picked");
  for (const g of [g1, g2]) {
    const m = g.s.match!;
    assert.equal(m.mode, 'dm');
    assert.equal(m.phase, 'over', 'the guest sees the end');
    assert.equal(m.winner, h.winner, 'same winner');
    assert.deepEqual(
      m.actors.map((a) => [a.name, a.kills, a.deaths]),
      h.actors.map((a) => [a.name, a.kills, a.deaths]),
      'same scores everywhere',
    );
  }
  const top = Math.max(...h.actors.map((a) => a.kills));
  assert.ok(top >= DM_KILLS || h.clock >= 299, `played to the end (${top} kills, ${h.clock.toFixed(0)} s)`);
  assert.ok(net.claims >= 2 && guestHits >= net.claims * 0.5, `guests' shots landed (${guestHits} of ${net.claims} claimed hits)`);
  assert.ok(snaps > 5, `others respawned and were seen to (${snaps})`);
  assert.equal(slides, 0, 'a respawn is a snap, never a slide');
  assert.ok(myRespawns >= 1 && myOff < 1.5, `the guest respawns where the host puts it (${myRespawns}, off by ${myOff.toFixed(2)} m)`);
  const perSec = net.bytes / net.time / 1024;
  assert.ok(perSec < 120, `traffic ${perSec.toFixed(0)} KB/s for the whole room`);
});

test('online deathmatch: a leaver becomes a bot, a latecomer takes one over, and the match survives the host leaving', () => {
  const { net, seats } = room(3, 4242, { mode: 'dm' });
  for (let i = 0; i < 60 * 8; i++) frame(net, seats);
  const h = seats[0].s.match!;
  const g2me = seats[2].s.match!.me;
  net.players = net.players.filter((p) => p.seat !== 2);
  seats[0].s.playersChanged(net.players);
  seats.pop()!.s.dispose();
  assert.equal(h.actors[g2me].bot, true, 'the leaver is a bot now');
  net.players = [...net.players, { seat: 3, name: 'Late' }];
  const api = net.api(3, 3000);
  const late: Seat = { s: new Session(api, { map: 'vale', level: 'normal', now: () => net.time + api.skew, dmPick: 'hornet' }), api, brainSet: false, round: -1 };
  seats.push(late);
  for (let i = 0; i < 60 * 4; i++) frame(net, seats);
  const lm = late.s.match!;
  assert.ok(lm, 'the latecomer has a mirror');
  assert.equal(lm.mode, 'dm');
  assert.equal(lm.actors[lm.me].name, 'Late');
  assert.equal(h.actors[lm.me].remote, true);
  assert.equal(h.actors[lm.me].dmPick, 'hornet');
  // the host leaves
  const kills = h.actors.reduce((s, a) => s + a.kills, 0);
  seats[0].s.dispose();
  seats.shift();
  net.host = 0;
  net.players = net.players.filter((p) => p.seat !== 0).map((p) => (p.seat === 1 ? { ...p, seat: 0 } : p));
  seats[0].api.me.seat = 0;
  for (const p of seats) p.s.handOff(1);
  const nh = seats[0].s.match!;
  assert.equal(nh.authority, true);
  const t0 = nh.time;
  for (let i = 0; i < 60 * 40 && nh.phase !== 'over'; i++) frame(net, seats);
  for (let i = 0; i < 30; i++) frame(net, seats);
  assert.ok(nh.time - t0 > 30, 'the new host steps the match');
  assert.ok(nh.actors.reduce((s, a) => s + a.kills, 0) > kills, 'the fighting went on');
  assert.deepEqual(
    late.s.match!.actors.map((a) => a.kills),
    nh.actors.map((a) => a.kills),
    'the latecomer follows the new host',
  );
  assert.equal(nh.actors.filter((a) => !a.bot).length, 2, 'two people left in it');
});

/** A royale room's people are hard to knock out until `until` (the host's say), so a test sees them play. */
function shieldPeople(h: Match, until: number) {
  if (h.time < until) for (const a of h.actors) if (!a.bot && a.alive) a.shield = 1;
}

test('online royale: three machines and 97 bots play it out, agreeing on who is in, the places, the zone and the loot', () => {
  const world = worldFor('vale', true);
  const { net, seats } = room(3, 31337, { mode: 'royale' });
  const [host, g1, g2] = seats;
  const DT2 = 1 / 30;
  let guestPicks = 0;
  let guestShots = 0;
  let checked = 0;
  const pending: { id: number; at: number }[] = [];
  let gapN = 0;
  let gapSum = 0;
  for (let i = 0; i < 30 * 900 && host.s.match?.phase !== 'over'; i++) {
    frame(net, seats, world, DT2);
    const h = host.s.match;
    if (!h) continue;
    shieldPeople(h, 300);
    const gm1 = g1.s.match;
    const gm2 = g2.s.match;
    if (!gm1 || !gm2) continue;
    for (const e of h.events) {
      if (e.t === 'pickup' && (e.a === gm1.me || e.a === gm2.me)) {
        guestPicks++;
        if (!e.item.live) pending.push({ id: e.item.id, at: net.time });
      }
      if (e.t === 'shot' && (e.a === gm1.me || e.a === gm2.me)) guestShots++;
    }
    // what a guest took is gone everywhere a moment later
    while (pending.length && net.time - pending[0].at > 1) {
      const { id } = pending.shift()!;
      for (const m of [h, gm1, gm2]) assert.equal(m.loot[id]?.live, false, `item ${id} taken by a guest is gone everywhere`);
      checked++;
    }
    // a guest's picture of those near it: where the host had them a moment before
    if (i % 15 === 0) {
      const me = gm1.actors[gm1.me];
      for (const a of h.actors) {
        const b = gm1.actors[a.id];
        if (a.id === gm1.me || !a.alive || !b.alive || a.drop || a.car >= 0 || b.car >= 0) continue;
        if (Math.hypot(a.body.x - me.body.x, a.body.z - me.body.z) > 60) continue;
        gapSum += Math.hypot(b.body.x - a.body.x, b.body.z - a.body.z);
        gapN++;
      }
    }
  }
  for (let i = 0; i < 60; i++) frame(net, seats, world, DT2);
  const h = host.s.match!;
  assert.equal(h.phase, 'over', `the match ended (${h.time.toFixed(0)} s, ${h.alive} left)`);
  for (const g of [g1, g2]) {
    const m = g.s.match!;
    assert.equal(m.mode, 'royale');
    assert.equal(m.actors.length, 100);
    assert.equal(m.phase, 'over', 'the guest sees the end');
    assert.equal(m.alive, h.alive, 'the same number left');
    assert.equal(m.winner, h.winner, 'the same winner');
    assert.deepEqual(
      m.actors.map((a) => a.alive),
      h.actors.map((a) => a.alive),
      'the same ones still in',
    );
    assert.deepEqual(
      m.actors.map((a) => a.place),
      h.actors.map((a) => a.place),
      'the same places',
    );
    assert.ok(m.actors[m.me].place > 0, 'the guest finished somewhere');
    const z = m.zone!;
    const hz = h.zone!;
    assert.equal(z.i, hz.i, 'the zone is at the same stage');
    assert.ok(Math.hypot(z.x - hz.x, z.z - hz.z) < 1 && Math.abs(z.r - hz.r) < 1, 'the zone is in the same place');
    assert.equal(m.loot.length, h.loot.length, 'as much loot');
    for (let i = 0; i < h.loot.length; i++) {
      const a = m.loot[i];
      const b = h.loot[i];
      assert.ok(a.live === b.live && a.n === b.n && a.kind === b.kind && a.what === b.what, `loot ${i} agrees`);
    }
  }
  assert.ok(guestPicks > 3 && checked > 0, `guests picked things up (${guestPicks}, ${checked} checked)`);
  assert.ok(guestShots > 0, `guests fought (${guestShots} shots)`);
  assert.ok(gapN > 20 && gapSum / gapN < 1.5, `a guest's view of those near it tracks the host's (mean ${(gapSum / gapN).toFixed(2)} m over ${gapN})`);
  const perSec = net.bytes / net.time / 1024;
  assert.ok(perSec < 120, `traffic ${perSec.toFixed(0)} KB/s for the whole room`);
  assert.ok(net.maxMsg < 8000, `every message under the room's limit (the biggest ${net.maxMsg} bytes)`);
});

test('online royale: a guest drives a car, everyone sees it, and getting out puts it beside the car everywhere', () => {
  const world = worldFor('vale', true);
  const { net, seats } = room(3, 999, { mode: 'royale' });
  const [host, g1, g2] = seats;
  const DT2 = 1 / 30;
  const run = (sec: number) => {
    for (let i = 0; i < sec * 30; i++) {
      frame(net, seats, world, DT2);
      if (host.s.match) shieldPeople(host.s.match, 1e9);
    }
  };
  // down from the transport first (the guest's brain picks where)
  for (let i = 0; i < 30 * 200 && !(g1.s.match && !g1.s.match.actors[g1.s.match.me].drop && g1.s.match.time > 5); i++) run(1 / 30);
  const h = host.s.match!;
  const m1 = g1.s.match!;
  const me = m1.me;
  assert.equal(m1.actors[me].drop, 0, 'the guest landed');
  // the guest's own hands from here on
  let press = false;
  let drive = 0;
  let brake = false;
  g1.input = (_m, a) => {
    const inp = idleInput(a.yaw, a.pitch);
    inp.ride = inp.use = press;
    press = false;
    inp.mz = drive;
    // (at the wheel, Space is the handbrake)
    inp.jump = brake;
    return inp;
  };
  run(1);
  // a pickup: the host puts the guest by an item on open ground, the guest presses F, and the item is gone everywhere
  // and in its pockets
  const it = h.loot.find((x) => x.live && x.kind === 'gun' && !h.actors[me].guns.some((g) => g?.id === x.what) && Math.abs(x.y - groundAt(h.world, x.x, x.z, x.y + 0.5)) < 0.3 && Math.abs(x.y - floorAt(h.world.terrain, x.x, x.z)) < 0.3)!;
  assert.ok(it, 'a gun lies on open ground');
  const ha = h.actors[me];
  ha.body.x = it.x + 0.4;
  ha.body.z = it.z;
  ha.body.y = groundAt(h.world, ha.body.x, ha.body.z, it.y + 1);
  ha.epoch++;
  run(1);
  assert.ok(Math.hypot(m1.actors[me].body.x - ha.body.x, m1.actors[me].body.z - ha.body.z) < 1, 'the guest stands where the host put it');
  m1.actors[me].yaw = Math.atan2(-(it.x - ha.body.x), -(it.z - ha.body.z));
  press = true;
  run(1);
  for (const m of [h, m1, g2.s.match!]) assert.equal(m.loot[it.id].live, false, 'the item the guest took is gone everywhere');
  assert.ok(m1.actors[me].guns.some((g) => g?.id === it.what), 'and the guest carries it');
  // the host moves the guest beside a car (as a rule would: a new epoch), and the guest's machine follows (the car
  // furthest from any bot, so none shoots it up while the test drives)
  const clear = (c: (typeof h.cars)[number]) => Math.min(...h.actors.filter((a) => a.bot && a.alive).map((a) => Math.hypot(a.body.x - c.x, a.body.z - c.z)));
  const car = h.cars.filter((c) => c.alive).sort((x, y) => clear(y) - clear(x))[0];
  const S = CARS[car.kind];
  const cy = Math.cos(car.yaw);
  const sy = Math.sin(car.yaw);
  ha.body.x = car.x + cy * (S.hw + 0.8);
  ha.body.z = car.z - sy * (S.hw + 0.8);
  ha.body.y = groundAt(h.world, ha.body.x, ha.body.z, car.y + 1);
  ha.epoch++;
  run(1);
  assert.ok(Math.hypot(m1.actors[me].body.x - ha.body.x, m1.actors[me].body.z - ha.body.z) < 1, 'the guest stands beside the car');
  press = true;
  run(1);
  assert.equal(ha.car, car.id, 'the host seats the guest');
  assert.equal(ha.carSeat, 0, 'at the wheel');
  assert.equal(m1.actors[me].car, car.id, 'the guest knows it is in');
  // forward, then back the way it came (whatever it runs into), counting the way it goes on the host
  let moved = 0;
  let px = car.x;
  let pz = car.z;
  const drove = (sec: number) => {
    for (let k = 0; k < sec * 10; k++) {
      run(0.1);
      moved += Math.hypot(car.x - px, car.z - pz);
      px = car.x;
      pz = car.z;
    }
  };
  drive = 1;
  drove(3);
  drive = -1;
  drove(3);
  drive = 0;
  brake = true;
  drove(3);
  assert.ok(moved > 10, `the guest drove the car on the host (${moved.toFixed(1)} m)`);
  const c1 = m1.cars[car.id];
  const c2 = g2.s.match!.cars[car.id];
  assert.ok(Math.hypot(c1.x - car.x, c1.z - car.z) < 1, `the host has it where the driver does (${Math.hypot(c1.x - car.x, c1.z - car.z).toFixed(2)} m off, at ${c1.speed.toFixed(1)} m/s, ${car.alive} ${car.seats} ${m1.actors[me].car})`);
  assert.ok(Math.hypot(c2.x - car.x, c2.z - car.z) < 1.5, `the other guest sees it there too (${Math.hypot(c2.x - car.x, c2.z - car.z).toFixed(2)} m)`);
  assert.equal(g2.s.match!.actors[me].car, car.id, 'and sees who drives it');
  // out again: beside the car, the same everywhere
  brake = false;
  press = true;
  run(1.5);
  assert.equal(ha.car, -1, 'out on the host');
  assert.equal(m1.actors[me].car, -1, 'out on the guest');
  const a1 = m1.actors[me];
  assert.ok(Math.hypot(a1.body.x - ha.body.x, a1.body.z - ha.body.z) < 1, 'standing where the host put it');
  assert.ok(Math.hypot(a1.body.x - car.x, a1.body.z - car.z) < 8, 'beside the car');
  // a blast wears it down on the host, and the guest sees it (bots may be shooting at it too: the guest's health for
  // it is what the host's was a moment before)
  hurtCar(h, car, 100, -1);
  const hps: number[] = [];
  for (let i = 0; i < 30; i++) {
    run(1 / 30);
    hps.push(Math.round(car.hp));
  }
  assert.equal(c1.alive, car.alive, 'whole or wrecked, the same');
  assert.ok(c1.hp < CARS[car.kind].hp - 90 && hps.slice(-15).some((hp) => Math.abs(hp - c1.hp) <= 1), `the car's damage is seen (${hps.slice(-15).join(' ')} on the host, ${c1.hp} on the guest)`);
});

test('online royale: a leaver becomes a bot, a latecomer takes one over, and the match survives the host leaving', () => {
  const world = worldFor('vale', true);
  const { net, seats } = room(3, 2024, { mode: 'royale' });
  const DT2 = 1 / 30;
  const run = (sec: number) => {
    for (let i = 0; i < sec * 30; i++) {
      frame(net, seats, world, DT2);
      if (seats[0].s.match?.authority) shieldPeople(seats[0].s.match, 1e9);
    }
  };
  run(70);
  const h = seats[0].s.match!;
  const g2me = seats[2].s.match!.me;
  net.players = net.players.filter((p) => p.seat !== 2);
  seats[0].s.playersChanged(net.players);
  seats.pop()!.s.dispose();
  assert.equal(h.actors[g2me].bot, true, 'the leaver is a bot now');
  net.players = [...net.players, { seat: 3, name: 'Late' }];
  const api = net.api(3, 3000);
  const late: Seat = { s: new Session(api, { map: 'vale', level: 'normal', now: () => net.time + api.skew }), api, brainSet: false, round: -1 };
  seats.push(late);
  run(6);
  settle(net, seats);
  const lm = late.s.match!;
  assert.ok(lm, 'the latecomer has a mirror');
  assert.equal(lm.mode, 'royale');
  assert.equal(lm.actors[lm.me].name, 'Late');
  assert.equal(h.actors[lm.me].remote, true, 'the host plays the latecomer as a person');
  const la = lm.actors[lm.me];
  const ha = h.actors[lm.me];
  assert.ok(Math.hypot(la.body.x - ha.body.x, la.body.z - ha.body.z) < 3, 'the latecomer starts where the bot it took over was');
  assert.equal(lm.loot.length, h.loot.length, "the latecomer has the loot as it is now");
  assert.ok(
    h.loot.every((it, i) => lm.loot[i].live === it.live),
    `item by item (${h.loot.map((it, i) => (lm.loot[i].live === it.live ? '' : `${i}:${it.live}/${lm.loot[i].live}`)).filter(Boolean).join(' ')})`,
  );
  // the host leaves: seat 1 becomes the host
  const g1 = seats[1];
  const kit = g1.s.match!.actors[g1.s.match!.me].guns.map((g) => g?.id ?? null);
  net.flush(0);
  seats[0].s.dispose();
  seats.shift();
  net.host = 0;
  net.players = net.players.filter((p) => p.seat !== 0).map((p) => (p.seat === 1 ? { ...p, seat: 0 } : p));
  seats[0].api.me.seat = 0;
  for (const p of seats) p.s.handOff(1);
  const nh = seats[0].s.match!;
  assert.equal(nh.authority, true, 'the new host runs the rules');
  const t0 = nh.time;
  const alive0 = nh.alive;
  run(30);
  settle(net, seats);
  assert.ok(nh.time - t0 > 25, 'the new host steps the match');
  assert.ok(nh.alive < alive0 || nh.phase === 'over', `the match went on (${alive0} to ${nh.alive} left)`);
  assert.deepEqual(
    nh.actors[nh.me].guns.map((g) => g?.id ?? null).filter(Boolean).length >= kit.filter(Boolean).length,
    true,
    'the new host kept its own gear',
  );
  const lm2 = late.s.match!;
  assert.deepEqual(
    lm2.actors.map((a) => a.alive),
    nh.actors.map((a) => a.alive),
    'the latecomer follows the new host',
  );
  assert.equal(lm2.loot.length, nh.loot.length, 'and its loot');
  assert.ok(
    nh.loot.every((it, i) => lm2.loot[i].live === it.live && lm2.loot[i].n === it.n),
    `item by item after the host change (${nh.loot.map((it, i) => (lm2.loot[i].live === it.live && lm2.loot[i].n === it.n ? '' : `${i}:${it.live}/${lm2.loot[i].live}`)).filter(Boolean).join(' ')})`,
  );
  assert.equal(nh.actors.filter((a) => !a.bot).length, 2, 'two people left in it');
});

test('online royale: a guest asleep while the transport flies on is jumped out by the host, and catches up where it is', () => {
  const world = worldFor('vale', true);
  const { net, seats } = room(3, 5150, { mode: 'royale' });
  const [host, g1] = seats;
  const DT2 = 1 / 30;
  const run = (sec: number) => {
    for (let i = 0; i < sec * 30; i++) frame(net, seats, world, DT2);
  };
  // the guest's soldier stays aboard (its own hands, which press nothing)
  g1.input = (_m, a) => idleInput(a.yaw, a.pitch);
  run(5);
  g1.asleep = true;
  const h0 = host.s.match!;
  const ha = h0.actors[g1.s.match!.me];
  let jx = 0;
  let jz = 0;
  for (let i = 0; i < 30 * 200 && h0.plane; i++) {
    frame(net, seats, world, DT2);
    if (ha.drop === 1) {
      jx = ha.body.x;
      jz = ha.body.z;
    }
  }
  run(3);
  assert.ok(Math.hypot(ha.body.x - jx, ha.body.z - jz) < 40, `the host keeps it where it jumped it out, not where its sleeping machine says (${Math.hypot(ha.body.x - jx, ha.body.z - jz).toFixed(0)} m off)`);
  g1.asleep = false;
  run(3);
  const h = host.s.match!;
  const m1 = g1.s.match!;
  const mine = m1.actors[m1.me];
  const there = h.actors[m1.me];
  assert.notEqual(mine.drop, 1, 'out of the transport on its own machine too');
  assert.notEqual(there.drop, 1, 'and on the host');
  assert.ok(Math.hypot(mine.body.x - there.body.x, mine.body.z - there.body.z) < 4, `in the same place (${Math.hypot(mine.body.x - there.body.x, mine.body.z - there.body.z).toFixed(1)} m apart)`);
  assert.equal(m1.plane, null, 'the transport is gone there too');
});

test('online: the host turns down a guest hit that a raised shield stopped, and takes it once the shield is down', () => {
  const { net, seats } = room(2);
  const [host, guest] = seats;
  for (let i = 0; i < 60 * 40 && host.s.match?.phase !== 'live'; i++) frame(net, seats);
  const h = host.s.match!;
  const gm = guest.s.match!;
  assert.equal(h.phase, 'live');
  // everyone holds still: the host's bots and the guest's own soldier
  gm.actors[gm.me].brain = null;
  const g = h.actors[gm.me];
  for (const a of h.actors)
    if (a !== g) {
      a.bot = false;
      a.brain = null;
    }
  for (let i = 0; i < 30; i++) frame(net, seats);
  // an enemy a few meters off in the open, its shield up and facing the guest
  const v = h.actors.find((a) => a.alive && a.team !== g.team)!;
  const eye = g.body.y + g.body.height - 0.14;
  let placed = false;
  for (let k = 0; k < 64 && !placed; k++) {
    const ang = (k / 64) * Math.PI * 2;
    const x = g.body.x + Math.sin(ang) * 7;
    const z = g.body.z + Math.cos(ang) * 7;
    const y = groundAt(h.world, x, z, g.body.y + 2);
    if (Math.abs(y - g.body.y) > 1 || !clearLine(h.world, g.body.x, eye, g.body.z, x, y + 1.2, z)) continue;
    v.body.x = x;
    v.body.y = y;
    v.body.z = z;
    placed = true;
  }
  assert.ok(placed, 'found an open spot');
  v.yaw = Math.atan2(v.body.x - g.body.x, v.body.z - g.body.z);
  v.pavise = PAVISE.hp;
  v.paviseUp = true;
  const claim = () => {
    const w = WEAPON_IDS.indexOf(currentGun(g)!.id) + 1;
    const o = [g.body.x, eye, g.body.z];
    const p = [v.body.x, v.body.y + 1.2, v.body.z];
    const l = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
    guest.api.send({ tag: NET_TAG, r: guest.api.round, k: 'fire', w, o, v: [((p[0] - o[0]) / l) * 900, ((p[1] - o[1]) / l) * 900, ((p[2] - o[2]) / l) * 900] });
    guest.api.send({ tag: NET_TAG, r: guest.api.round, k: 'hit', v: v.id, z: 1, w, o, p });
    for (let i = 0; i < 12; i++) frame(net, seats);
  };
  const hp = v.hp;
  claim();
  assert.equal(v.hp, hp, 'the shield stopped it: no damage');
  v.paviseUp = false;
  claim();
  assert.ok(v.hp < hp, `with the shield down the hit counts (${v.hp.toFixed(0)})`);
  // the guests see the shield and what is left of it
  v.paviseUp = true;
  for (let i = 0; i < 30; i++) frame(net, seats);
  assert.ok(gm.actors[v.id].pavise > 0 && gm.actors[v.id].paviseUp, 'a guest mirrors the shield');
});

for (const mode of ['dm', 'royale'] as const) {
  test(`online ${mode}: the shield and the new grenades reach the guest, and its shield and throws reach the host`, () => {
    const world = worldFor('vale', mode === 'royale');
    const { net, seats } = room(2, 4242, { mode });
    const [host, guest] = seats;
    const run = (sec: number) => {
      for (let i = 0; i < sec * 30; i++) {
        frame(net, seats, world, 1 / 30);
        if (host.s.match) shieldPeople(host.s.match, 1e9);
      }
    };
    // (a royale: down from the transport first)
    for (let i = 0; i < 30 * 220 && !(guest.s.match && !guest.s.match.actors[guest.s.match.me].drop && guest.s.match.time > 8); i++) run(1 / 30);
    const h = host.s.match!;
    const gm = guest.s.match!;
    const me = gm.me;
    assert.equal(gm.actors[me].drop, 0, 'the guest is on the ground');
    // the guest's own hands from here on
    let shieldKey = false;
    let throwKey: 'fire' | null = null;
    guest.input = (_m, a) => {
      const inp = idleInput(a.yaw, a.pitch);
      inp.shield = shieldKey;
      inp.throw = throwKey;
      shieldKey = false;
      throwKey = null;
      return inp;
    };
    // the host hands the guest a shield and the new grenades: its machine has them
    const ha = h.actors[me];
    ha.pavise = PAVISE.hp;
    ha.fires = 2;
    ha.impacts = 1;
    ha.decoys = 1;
    run(1.5);
    const ga = gm.actors[me];
    assert.equal(ga.pavise, PAVISE.hp, 'the guest carries the shield');
    assert.deepEqual([ga.fires, ga.impacts, ga.decoys], [2, 1, 1], 'and the grenades');
    // raised on the guest's machine: raised on the host's
    shieldKey = true;
    run(1);
    assert.ok(ga.paviseUp, 'raised on its own machine');
    assert.ok(ha.paviseUp, 'and on the host');
    // someone else's raised shield shows on the guest
    const other = h.actors.find((a) => a.alive && a.id !== me && !a.drop && Math.hypot(a.body.x - ha.body.x, a.body.z - ha.body.z) < 60) ?? h.actors.find((a) => a.alive && a.id !== me)!;
    other.pavise = PAVISE.hp;
    other.paviseUp = true;
    other.body.x = ha.body.x + 6;
    other.body.z = ha.body.z;
    other.body.y = groundAt(h.world, other.body.x, other.body.z, ha.body.y + 2);
    other.epoch++;
    other.bot = false;
    other.brain = null;
    run(1.5);
    assert.ok(gm.actors[other.id].pavise > 0 && gm.actors[other.id].paviseUp, "the guest sees the other's shield up");
    // an incendiary thrown by the guest: the host throws the real one, and counts it off
    throwKey = 'fire';
    let thrown = false;
    for (let i = 0; i < 30 && !thrown; i++) {
      run(1 / 30);
      thrown = h.nades.some((n) => n.kind === 'fire' && n.owner === me) || h.fires.some((f) => f.owner === me);
    }
    assert.ok(thrown, 'the host threw it');
    assert.equal(ha.fires, 1, 'one fewer on the host');
    run(1);
    assert.equal(ga.fires, 1, 'and on the guest');
  });
}
