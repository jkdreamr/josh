import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP } from '../src/os/arcade/games/wacky-walk/physics.ts';
import { ClockGap, Interp, followClock, movePacket, parsePacket, playersPacket, relayOf, takeMove, takePlayers, unpackBody, type Packet, type Sample } from '../src/os/arcade/games/wacky-walk/net.ts';
import type { Body } from '../src/os/arcade/games/wacky-walk/types.ts';

const body = (x: number, z: number, vx = 0, vz = 0): Body => ({ x, y: 0, z, vx, vy: 0, vz, yaw: 0, state: 'run', squash: 0 }) as unknown as Body;

test('moves say when they were sampled, players packets how old each body is; older packets still read', () => {
  const mv = parsePacket(JSON.parse(JSON.stringify(movePacket(4, 1, body(1, 2), 12.34567))));
  assert.ok(mv && mv.k === 'm' && mv.c === 12.346);
  const old = parsePacket(JSON.parse(JSON.stringify(movePacket(4, 1, body(1, 2)))));
  assert.ok(old && old.k === 'm' && old.c === undefined);
  const P = parsePacket(JSON.parse(JSON.stringify(playersPacket(4, 1, 20.5, [{ id: 0, body: body(1, 2) }, { id: 3, body: body(4, 5), age: 61.6 }]))));
  assert.ok(P && P.k === 'P');
  assert.deepEqual(P.a, [0, 62]);
  // with nobody passed on there is no list of ages, and a broken one is left out rather than spoiling the packet
  assert.equal((playersPacket(4, 1, 20.5, [{ id: 0, body: body(1, 2) }]) as { a?: number[] }).a, undefined);
  const bad = parsePacket({ ...playersPacket(4, 1, 20.5, [{ id: 0, body: body(1, 2) }]), a: [-4] });
  assert.ok(bad && bad.k === 'P' && bad.a === undefined);
});

test('a clock gap goes by the least delayed move, follows a slower link slowly and a new round at once', () => {
  const g = new ClockGap();
  assert.equal(g.at(10.05, 10), 10.05);
  assert.ok(Math.abs(g.at(10.163, 10.083) - 10.133) < 0.001);
  assert.equal(g.at(10.2, 10.166), 10.2);
  // a new round: the guest's course clock starts again
  assert.equal(g.at(10.3, 0.1), 10.3);
});

test('the host passes on a guest as it last said, with its age; guests place each body at when it was sampled', () => {
  const host = new Interp();
  const gap = new ClockGap();
  takeMove(host, gap, 5, { t: 'wacky-walk', k: 'm', r: 1, rd: 0, b: [1, 0, 0, 6, 0, 0, 0, 0, 0], c: 4.9 });
  takeMove(host, gap, 5.12, { t: 'wacky-walk', k: 'm', r: 1, rd: 0, b: [1.5, 0, 0, 6, 0, 0, 0, 0, 0], c: 4.983 });
  // the second came 37 ms later than the first would have it: placed by when it was sampled (give or take the slow drift)
  const relay = relayOf(host, 5.15)!;
  assert.equal(relay.body.x, 1.5);
  assert.ok(Math.abs(relay.age - 66.3) < 0.5, `${relay.age}`);
  const guest = new Map<number, Interp>();
  const track = (id: number) => guest.get(id) ?? guest.set(id, new Interp()).get(id)!;
  const P = parsePacket(JSON.parse(JSON.stringify(playersPacket(1, 0, 5.15, [{ id: 0, body: body(9, 9) }, { id: 2, body: relay.body, age: relay.age }, { id: 7, body: body(3, 3) }]))))!;
  assert.ok(P.k === 'P');
  takePlayers(P, 7, track);
  assert.equal(guest.has(7), false, 'our own body is never drawn from afar');
  assert.ok(Math.abs(track(2).latest()!.time - 5.084) < 1e-9);
  assert.equal(track(0).latest()!.time, 5.15);
});

// ---------------------------------------------------------------------------------------------------------------
// A host and two guests over a delayed, jittery link. Guest A walks a circle at 6 m/s; the host draws it 0.12 s back
// on its clock and passes it on 12 times a second; guest B draws it 0.12 s back on its copy of the host's clock.

type Seen = { t: number; x: number; z: number };
const R = 10;
const W = 6 / R;
const truth = (t: number) => ({ x: R * Math.cos(W * t), z: R * Math.sin(W * t) });

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `old`: what the game did before: the host placed a move when it arrived, and passed on where it drew the guest. */
function room(o: { old: boolean; fpsA: number; latency: number; jitter: number; loss: number; seconds: number }) {
  const rng = mulberry32(9);
  const queue: { at: number; to: 'host' | 'a' | 'b'; d: unknown }[] = [];
  let wall = 0;
  const send = (to: 'host' | 'a' | 'b', d: unknown) => {
    if (rng() >= o.loss) queue.push({ at: wall + o.latency + rng() * o.jitter, to, d: JSON.parse(JSON.stringify(d)) });
  };
  const take = (to: 'host' | 'a' | 'b') => {
    const out: Packet[] = [];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].to !== to || queue[i].at > wall) continue;
      const p = parsePacket(queue.splice(i--, 1)[0].d);
      if (p) out.push(p);
    }
    return out;
  };
  // the host's course clock is the wall clock; each guest keeps its own copy of it
  const host = { track: new Interp(), gap: new ClockGap(), net: 0, shown: [] as Seen[], next: 0 };
  const a = { clock: 0, remote: 0, acc: 0, net: 0, last: -1, next: 0 };
  const b = { clock: 0, remote: 0, acc: 0, last: -1, next: 0, tracks: new Map<number, Interp>(), shown: [] as Seen[] };
  const bTrack = (id: number) => b.tracks.get(id) ?? b.tracks.set(id, new Interp()).get(id)!;
  const out: Sample = unpackBody([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (; wall <= o.seconds; wall += 0.001) {
    // guest A: walks, keeps its copy of the host's clock, and says where it is 12 times a second
    if (wall >= a.next) {
      a.next += 1 / o.fpsA;
      for (const p of take('a')) if (p.k === 'P') a.remote = p.c;
      const dt = a.last < 0 ? 0 : Math.min(0.25, wall - a.last);
      a.last = wall;
      a.acc += dt;
      for (let k = 0; a.acc >= STEP && k < 15; k++, a.acc -= STEP) a.clock = followClock(a.clock, a.remote, STEP);
      a.net += dt;
      if (a.net >= 1 / 12) {
        a.net %= 1 / 12;
        const p = truth(wall);
        send('host', movePacket(1, 0, body(p.x, p.z, -R * W * Math.sin(W * wall), R * W * Math.cos(W * wall)), o.old ? undefined : a.clock));
      }
    }
    // the host, at 60 fps
    if (wall >= host.next) {
      host.next += 1 / 60;
      for (const p of take('host')) {
        if (p.k !== 'm') continue;
        if (o.old) host.track.push(wall, unpackBody(p.b));
        else takeMove(host.track, host.gap, wall, p);
      }
      if (host.track.sample(wall - 0.12, out)) host.shown.push({ t: wall, x: out.x, z: out.z });
      host.net += 1 / 60;
      if (host.net >= 1 / 12) {
        host.net %= 1 / 12;
        let packet;
        if (o.old) {
          const drawn = unpackBody([0, 0, 0, 0, 0, 0, 0, 0, 0]);
          if (host.track.sample(wall - 0.12, drawn)) packet = playersPacket(1, 0, wall, [{ id: 1, body: drawn }]);
        } else {
          const relay = relayOf(host.track, wall);
          if (relay) packet = playersPacket(1, 0, wall, [{ id: 1, body: relay.body, age: relay.age }]);
        }
        if (packet) {
          send('a', packet);
          send('b', packet);
        }
      }
    }
    // guest B, at 60 fps: draws A
    if (wall >= b.next) {
      b.next += 1 / 60;
      for (const p of take('b')) {
        if (p.k !== 'P') continue;
        b.remote = p.c;
        if (o.old) for (const row of p.b) bTrack(row[0]).push(p.c, unpackBody(row.slice(1)));
        else takePlayers(p, 2, bTrack);
      }
      const dt = b.last < 0 ? 0 : Math.min(0.25, wall - b.last);
      b.last = wall;
      b.acc += dt;
      for (let k = 0; b.acc >= STEP && k < 15; k++, b.acc -= STEP) b.clock = followClock(b.clock, b.remote, STEP);
      if (bTrack(1).sample(b.clock - 0.12, out)) b.shown.push({ t: wall, x: out.x, z: out.z });
    }
  }
  return { host: host.shown, b: b.shown };
}

/** Steps back against the way A really walked, and how far off it is drawn from where it was, at the steady delay that fits best (m). */
function seen(list: Seen[], from = 3) {
  const xs = list.filter((s) => s.t >= from);
  let best = { lag: 0, mean: Infinity, max: 0 };
  for (let lag = 0; lag <= 0.6; lag += 0.005) {
    let sum = 0;
    let max = 0;
    for (const s of xs) {
      const r = truth(s.t - lag);
      const e = Math.hypot(s.x - r.x, s.z - r.z);
      sum += e;
      max = Math.max(max, e);
    }
    if (sum / xs.length < best.mean) best = { lag, mean: sum / xs.length, max };
  }
  let back = 0;
  for (let i = 1; i < xs.length; i++) {
    const p = truth(xs[i - 1].t - best.lag);
    const q = truth(xs[i].t - best.lag);
    const along = (xs[i].x - xs[i - 1].x) * (q.x - p.x) + (xs[i].z - xs[i - 1].z) * (q.z - p.z);
    if (along < -0.05 * Math.hypot(q.x - p.x, q.z - p.z) ** 2) back++;
  }
  return { frames: xs.length, back, ...best };
}
const fmt = (x: ReturnType<typeof seen>) => `${x.back} back steps in ${x.frames} frames; drawn ${(x.lag * 1000).toFixed(0)} ms behind, ${x.mean.toFixed(2)} m off that on average (${x.max.toFixed(2)} at most)`;

test('online: over a jittery link (60-150 ms round trips) a walking guest glides on every screen', (t) => {
  const link = { fpsA: 60, latency: 0.03, jitter: 0.045, loss: 0.02, seconds: 30 };
  const before = room({ ...link, old: true });
  const after = room({ ...link, old: false });
  const views = { hostSeesGuest: [seen(before.host), seen(after.host)], guestSeesGuest: [seen(before.b), seen(after.b)] };
  for (const [k, [was, now]] of Object.entries(views)) t.diagnostic(`${k}: before ${fmt(was)}; after ${fmt(now)}`);
  for (const [was, now] of Object.values(views)) {
    assert.equal(now.back, 0);
    assert.ok(now.mean < was.mean && now.max < was.max);
  }
  // (a guest draws others on its course clock, which moves in whole steps: a step at 6 m/s is 0.1 m)
  assert.ok(views.hostSeesGuest[1].mean < 0.05 && views.guestSeesGuest[1].mean < 0.12);
  // guests see each other a step closer to now: no second 0.12 s on the host
  assert.ok(views.guestSeesGuest[1].lag < views.guestSeesGuest[0].lag - 0.08);
});
