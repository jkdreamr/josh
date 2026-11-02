import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopSteps } from '../src/os/arcade/kit/loop-core.ts';
import type { Assists } from '../src/os/arcade/games/grand-prix/car.ts';
import { CarClock, guestState, hostState, netCar, packCar, parsePacket, takeCar, unpackCar } from '../src/os/arcade/games/grand-prix/net.ts';
import { createRace, stepRace, type Entry, type NetCar, type Race, type Runner } from '../src/os/arcade/games/grand-prix/race.ts';
import { deltaS } from '../src/os/arcade/games/grand-prix/track.ts';

const AUTO: Assists = { tc: true, abs: true, autoGears: true };
const CAR: NetCar = { x: 101.234, y: -55.5, yaw: 1.2345, vx: 80.12, vy: -0.5, r: 0.12, steer: -0.2, rpm: 11234, gear: 7, brake: 0.5, drs: true, lap: 2, dist: 12345.6, fin: -1, best: 82345 };

test('cars carry their sample time as a sixteenth number, which older packets lack and older clients skip', () => {
  const back = unpackCar(JSON.parse(JSON.stringify(packCar({ ...CAR, t: 61.2345 }))))!;
  assert.equal(back.t, 61.235);
  assert.equal(unpackCar(packCar(CAR))!.t, undefined);
  // an old client's car (fifteen numbers) and a new one both make it through either packet
  const S = parsePacket(JSON.parse(JSON.stringify(hostState(3, -12, 5, [0, 1], [0, 1], [[0, { ...CAR, t: 12 }], [1, CAR]]))));
  assert.ok(S && S.k === 'S' && S.cars[0][1].t === 12 && S.cars[1][1].t === undefined);
  const s = parsePacket(JSON.parse(JSON.stringify(guestState(3, { ...CAR, t: 9.5 }))));
  assert.ok(s && s.k === 's' && s.car.t === 9.5);
  // what an older client does with a new car: the first fifteen numbers, the same car
  const old = packCar({ ...CAR, t: 9.5 }).slice(0, 15);
  assert.deepEqual({ ...unpackCar(packCar({ ...CAR, t: 9.5 }))!, t: undefined }, { ...unpackCar(old)!, t: undefined });
});

test('a car clock goes by the least delayed report, drops late ones, and starts over when a clock jumps', () => {
  const c = new CarClock();
  assert.equal(c.at(10.05, 10), 10.05);
  // 30 ms more delay: placed by when it was sampled (give or take the slow drift), not when it came
  assert.ok(Math.abs(c.at(10.146, 10.066)! - 10.116) < 0.001);
  // an older report than one taken: late, dropped
  assert.equal(c.at(10.15, 10.03), null);
  assert.equal(c.at(10.15, 10.066), null);
  // the owner's clock went back a second (its countdown re-read): taken as it comes
  assert.equal(c.at(10.2, 9.1), 10.2);
  // ours jumped on (a page in the background): the same
  assert.equal(c.at(15, 9.2), 15);
});

// ---------------------------------------------------------------------------------------------------------------
// A host and two guests over a delayed, jittery link. The host and guest A each drive their own car (the computer
// driver stands in for the player); guest B only watches, seeing A through the host's relay.

type Opts = { fps: [number, number, number]; latency: number; jitter: number; loss: number; seconds: number; old: boolean };
type Track = { t: number; x: number; y: number; s: number; v: number }[];
type Client = { seat: number; fps: number; r: Race; clocks: Map<number, CarClock>; last: number; next: number; sendAt: number; ticks: number; truth: Track; shown: Map<number, Track> };

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grid slots: the host's car on pole, A's three rows back; B and the empty slots sit out. */
const SEATS = [0, -1, -1, -1, -1, -1, 1, 2];
function raceFor(seat: number): Race {
  const entries: Entry[] = SEATS.map((s, k) => ({ name: `car ${k}`, team: k % 10, kind: s === seat && s !== 2 ? 'ai' : 'remote', seat: s < 0 ? 10 + k : s, pad: -1, pace: 0.96 }));
  const r = createRace({ mode: 'race', laps: 20, entries, assists: entries.map(() => AUTO), lead: 0, hold: 0.2 });
  r.time = 0;
  r.lights = 0;
  for (const rn of r.runners) if (rn.entry.seat !== 0 && rn.entry.seat !== 1) rn.out = true;
  return r;
}

/**
 * `old`: what the game did before: a packet is current when it arrives, every frame is one step of at most 1/20 s
 * (and remote cars eased toward their packets, which the old code under test does on its own).
 */
function room(o: Opts) {
  const rng = mulberry32(3);
  const clients: Client[] = o.fps.map((fps, seat) => ({ seat, fps, r: raceFor(seat), clocks: new Map(), last: -1, next: 0, sendAt: 0, ticks: 0, truth: [], shown: new Map() }));
  const base = [0, 4.2, 17.9];
  const queue: { at: number; to: number; from: number; d: unknown }[] = [];
  let wall = 0;
  const send = (from: number, d: unknown, to: number[]) => {
    const text = JSON.stringify(d);
    for (const seat of to) if (rng() >= o.loss) queue.push({ at: wall + o.latency + rng() * o.jitter, to: seat, from, d: JSON.parse(text) });
  };
  const take = (c: Client, rn: Runner, car: NetCar) => {
    if (o.old) {
      rn.net = car;
      rn.netAt = c.r.time;
    } else takeCar(c.r, rn, car, c.clocks);
  };
  for (; wall <= o.seconds; wall += 0.001) {
    for (const c of clients) {
      if (wall < c.next) continue;
      const r = c.r;
      // messages are handled between frames
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        if (m.to !== c.seat || m.at > wall) continue;
        queue.splice(i--, 1);
        const p = parsePacket(m.d);
        if (!p) continue;
        if (p.k === 's' && c.seat === 0) {
          const rn = r.runners.find((x) => x.entry.seat === m.from);
          if (rn) take(c, rn, p.car);
        } else if (p.k === 'S' && c.seat !== 0) {
          for (const [seat, car] of p.cars) {
            const rn = r.runners.find((x) => x.entry.seat === seat);
            if (seat !== c.seat && rn?.entry.kind === 'remote') take(c, rn, car);
          }
        }
      }
      const local = wall + base[c.seat];
      const steps = loopSteps(c.last < 0 ? 0 : local - c.last, !o.old);
      c.last = local;
      let left = steps.reduce((a, b) => a + b, 0);
      for (const dt of steps) {
        left -= dt;
        stepRace(r, dt, new Map());
        r.events.length = 0;
        const me = r.runners.find((x) => x.entry.seat === c.seat);
        if (me && !me.out) c.truth.push({ t: wall - left, x: me.car.x, y: me.car.y, s: me.dist, v: me.car.vx });
      }
      for (const rn of r.runners) {
        if (rn.entry.kind !== 'remote' || rn.out || !rn.net) continue;
        let list = c.shown.get(rn.entry.seat);
        if (!list) c.shown.set(rn.entry.seat, (list = []));
        list.push({ t: wall, x: rn.car.x, y: rn.car.y, s: rn.car.s, v: rn.car.vx });
      }
      // the 66 ms send timer, which also waits for the frame to end
      if (wall >= c.sendAt) {
        c.sendAt = Math.max(c.sendAt + 0.066, wall - 0.066);
        c.ticks++;
        const fast = c.ticks % 5 !== 0;
        if (c.seat === 1) {
          const me = r.runners.find((x) => x.entry.seat === 1)!;
          send(1, guestState(1, o.old ? { ...netCar(me, 0), t: undefined } : netCar(me, r.time)), [0]);
        } else if (c.seat === 0) {
          const cars: [number, NetCar][] = r.runners.filter((x) => !x.out && (x.entry.kind !== 'remote' || x.net)).map((x) => [x.entry.seat, x.entry.kind === 'remote' ? x.net! : o.old ? { ...netCar(x, 0), t: undefined } : netCar(x, r.time)]);
          send(0, hostState(1, -r.time, r.laps, [0, 1, 2], [0, 1, 2], cars), [1, 2]);
          void fast;
        }
      }
      c.next += 1 / c.fps;
    }
  }
  return clients;
}

function truthAt(c: Client, t: number) {
  const list = c.truth;
  let lo = 0;
  let hi = list.length - 1;
  if (t <= list[0].t) return list[0];
  if (t >= list[hi].t) return list[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  const k = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: a.s + (b.s - a.s) * k, v: a.v };
}

/** How viewer shows target's car once it is up to speed: steps back along the track, and how far it is from where the car really is (m). */
function seen(viewer: Client, target: Client, from = 8) {
  const list = (viewer.shown.get(target.seat) ?? []).filter((x) => x.t >= from);
  const c = viewer.r.c;
  let back = 0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < list.length; i++) {
    if (i && deltaS(c, list[i - 1].s, list[i].s) < -0.02) back++;
    const real = truthAt(target, list[i].t);
    const err = Math.hypot(list[i].x - real.x, list[i].y - real.y);
    sum += err;
    max = Math.max(max, err);
  }
  return { frames: list.length, back, mean: list.length ? sum / list.length : Infinity, max };
}
const fmt = (x: ReturnType<typeof seen>) => `${x.back} back steps in ${x.frames} frames, ${x.mean.toFixed(1)} m from the real car on average (${x.max.toFixed(1)} at most)`;

test('online: over a jittery link (60-150 ms round trips) remote cars run smoothly, close to where they really are', { timeout: 120_000 }, (t) => {
  const link = { latency: 0.03, jitter: 0.045, loss: 0.02, seconds: 30, fps: [60, 60, 60] as [number, number, number] };
  const after = room({ ...link, old: false });
  const [h, a, b] = after;
  const views = { hostSeesGuest: seen(h, a), guestSeesHost: seen(a, h), guestSeesGuestThroughHost: seen(b, a) };
  for (const [k, v] of Object.entries(views)) t.diagnostic(`${k}: ${fmt(v)}`);
  for (const v of Object.values(views)) {
    assert.ok(v.frames > 1000);
    assert.equal(v.back, 0, 'never steps back');
    // at 80 m/s a car covers 8 m in 100 ms: shown within the link's least delay of where it is
    assert.ok(v.mean < 6, `mean ${v.mean}`);
  }
});

test('online: a guest on a slow device keeps to the clock instead of driving in slow motion', { timeout: 120_000 }, (t) => {
  const link = { latency: 0.03, jitter: 0.045, loss: 0.02, seconds: 20 };
  const smooth = room({ ...link, fps: [60, 60, 60], old: false });
  const after = room({ ...link, fps: [60, 12, 60], old: false });
  const before = room({ ...link, fps: [60, 12, 60], old: true });
  // how far guest A got at 12 fps, against the same guest at 60 fps
  const pace = (cs: Client[]) => cs[1].truth.at(-1)!.s / smooth[1].truth.at(-1)!.s;
  t.diagnostic(`a guest at 12 fps covers ${(pace(before) * 100).toFixed(0)}% of the distance it would at 60 fps before, ${(pace(after) * 100).toFixed(0)}% after`);
  t.diagnostic(`host sees the slow guest: ${fmt(seen(after[0], after[1]))}`);
  t.diagnostic(`slow guest sees the host: ${fmt(seen(after[1], after[0]))}`);
  assert.ok(pace(before) < 0.75);
  assert.ok(pace(after) > 0.97, `keeps pace (${pace(after).toFixed(3)})`);
  assert.equal(seen(after[0], after[1]).back, 0);
  assert.equal(seen(after[1], after[0]).back, 0);
});
