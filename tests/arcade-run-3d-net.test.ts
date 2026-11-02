import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopSteps } from '../src/os/arcade/kit/loop-core.ts';
import { botInput, create, endlessTrack, step, type State } from '../src/os/arcade/games/run-3d/logic.ts';
import { INTERP_MS, SEND_EVERY, SenderClock, newField, newRemote, passOn, push, receive, sampleAt, type Field, type RacePacket, type Wire } from '../src/os/arcade/games/run-3d/net.ts';

test('a sender clock goes by the least delayed report, follows a slower link slowly and a stopped clock at once', () => {
  const c = new SenderClock();
  // sent at 1000 on its clock, here at 5040: a gap of 4040
  assert.equal(c.at(5040, 1000), 5040);
  // a later report delayed 30 ms more is placed by when it was sent, not when it came (give or take the slow drift)
  assert.ok(Math.abs(c.at(5153, 1083) - 5123) < 1);
  // one less delayed sets the gap lower
  assert.equal(c.at(5186, 1166), 5186);
  const gap = 5186 - 1166;
  // a link that got slower for good is followed a little each report, and never past when a report came
  let at = 0;
  for (let i = 1; i <= 200; i++) at = c.at(5186 + i * 83 + 60, 1166 + i * 83);
  assert.ok(at > 1166 + 200 * 83 + gap + 50 && at <= 5186 + 200 * 83 + 60);
  // the sender's page stopped for two seconds: its reports are taken as they come again
  assert.equal(c.at(30000, 30000 - gap - 2000), 30000);
});

test('late reports only count for their finish, and one at the same time replaces the last', () => {
  const r = newRemote();
  push(r, [1, 10, 0, 0, 0, -1], 1000);
  push(r, [1, 12, 0, 0, 0, -1], 1083);
  push(r, [1, 11, 0, 0, 2, 4567], 1040);
  assert.deepEqual(r.samples.map((s) => s.d), [10, 12]);
  assert.equal(r.ms, 4567);
  push(r, [1, 12.5, 0, 0, 0, -1], 1083);
  assert.deepEqual(r.samples.map((s) => s.d), [10, 12.5]);
});

test('racer packets: each speaks for itself, the host for its bots and guests, old packets go in as they come', () => {
  const f = newField();
  // an older client's packet (no times): as it arrives, as ever
  receive(f, 2, 1, { me: [1, 5, 0, 0, 0, -1] }, 100);
  assert.equal(f.remotes.get(1)!.samples[0].at, 100);
  // a guest cannot speak for anyone else, and our own seat is never drawn from afar
  receive(f, 2, 1, { me: [3, 5, 0, 0, 0, -1], b: [[4, 1, 0, 0, 0, -1]] }, 120);
  receive(f, 2, 0, { me: [2, 5, 0, 0, 0, -1] }, 120);
  assert.deepEqual([...f.remotes.keys()], [1]);
  // the host: its own racer, a bot and a guest it last heard 40 ms before it sent
  const p: RacePacket = { game: 'run-3d', k: 'p', me: [0, 9, 0, 0, 0, -1], b: [[5, 8, 0, 0, 0, -1], [1, 7, 0, 0, 0, -1]], at: 2000, ag: [0, 40] };
  receive(f, 2, 0, JSON.parse(JSON.stringify(p)), 300);
  assert.equal(f.remotes.get(0)!.samples[0].at, 300);
  assert.equal(f.remotes.get(5)!.samples[0].at, 300);
  assert.equal(f.remotes.get(1)!.samples.at(-1)!.at, 260);
  // and what a host passes on of a guest that just reported: that report, aged from when it was current
  const host = newField();
  assert.equal(receive(host, 0, 1, { me: [1, 3, 0, 0, 0, -1], at: 50 }, 1000), true);
  assert.equal(receive(host, 0, 1, { me: [1, 2, 0, 0, 0, -1], at: 40 }, 1010), false, 'a late one is not news');
  assert.deepEqual(passOn(host, 1, 1012), { game: 'run-3d', k: 'p', b: [[1, 3, 0, 0, 0, -1]], at: 1012, ag: [12] });
  assert.equal(passOn(host, 7, 1012), null);
});

// ---------------------------------------------------------------------------------------------------------------
// A room over a delayed, jittery link: a host and two guests, each running on its own frame rate.

type Opts = { fps: number[]; latency: number; jitter: number; loss: number; old: boolean; seconds: number };
type Client = { seat: number; fps: number; s: State; field: Field; last: number; next: number; sendT: number; shown: Map<number, { t: number; d: number }[]>; truth: { t: number; d: number }[]; respawnAt: number[] };

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `old`: what the game did before: reports go in when they arrive, the host passes on nobody, and every frame is
 * one step of at most 1/20 s. Otherwise: stamped reports, the host passes guests on, and slow frames are caught up.
 * Each client's clock starts at a different moment (as performance.now() does on different pages).
 */
function room(o: Opts) {
  const rng = mulberry32(7);
  const clients: Client[] = o.fps.map((fps, seat) => ({ seat, fps, s: create(endlessTrack(5), { respawn: true }), field: newField(), last: -1, next: 0, sendT: 0, shown: new Map(), truth: [], respawnAt: [] }));
  const base = [0, 7_000, 31_000];
  const queue: { at: number; from: number; to: number; d: unknown }[] = [];
  const send = (from: number, d: unknown) => {
    const to = from === 0 ? clients.slice(1).map((c) => c.seat) : [0];
    for (const seat of to) if (rng() >= o.loss) queue.push({ at: wall + o.latency + rng() * o.jitter, from, to: seat, d: JSON.parse(JSON.stringify(d)) });
  };
  const wire = (seat: number, s: State): Wire => [seat, Math.round(s.dist * 100) / 100, Math.round(s.x * 100) / 100, Math.round(s.h * 100) / 100, s.falling ? 1 : 0, -1];
  let wall = 0;
  for (; wall <= o.seconds * 1000; wall++) {
    for (const c of clients) {
      if (wall < c.next) continue;
      const local = wall + base[c.seat];
      // messages are handled between frames, so a slow page takes them in late, all at once
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        if (m.to !== c.seat || m.at > wall) continue;
        queue.splice(i--, 1);
        if (receive(c.field, c.seat, m.from, m.d as RacePacket, local) && c.seat === 0 && !o.old) {
          const out = passOn(c.field, m.from, local);
          if (out) send(0, out);
        }
      }
      const steps = loopSteps(c.last < 0 ? 0 : (local - c.last) / 1000, !o.old);
      c.last = local;
      let left = steps.reduce((a, b) => a + b, 0);
      for (const dt of steps) {
        left -= dt;
        const now = local - left * 1000;
        const before = c.s.respawns;
        step(c.s, dt, botInput(c.s));
        if (c.s.respawns !== before) c.respawnAt.push(wall);
        c.truth.push({ t: wall - left * 1000, d: c.s.dist });
        c.sendT += dt;
        if (c.sendT >= SEND_EVERY) {
          c.sendT = 0;
          const p: RacePacket = { game: 'run-3d', k: 'p', me: wire(c.seat, c.s) };
          if (!o.old) p.at = Math.round(now);
          send(c.seat, p);
        }
      }
      for (const [who, r] of c.field.remotes) {
        const smp = sampleAt(r, local);
        if (!smp) continue;
        let list = c.shown.get(who);
        if (!list) c.shown.set(who, (list = []));
        list.push({ t: wall, d: smp.d });
      }
      c.next += 1000 / c.fps;
    }
  }
  return clients;
}

/** Where a client really was at wall time t. */
function truthAt(c: Client, t: number) {
  const list = c.truth;
  let lo = 0;
  let hi = list.length - 1;
  if (t <= list[0].t) return list[0].d;
  if (t >= list[hi].t) return list[hi].d;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  return a.d + ((b.d - a.d) * (t - a.t)) / Math.max(1e-9, b.t - a.t);
}

/** How viewer shows target: backward steps while it runs on, and how far off it is from where it was INTERP_MS ago (m). */
function seen(viewer: Client, target: Client, from = 3000) {
  const list = (viewer.shown.get(target.seat) ?? []).filter((x) => x.t >= from);
  const calm = (t: number) => !target.respawnAt.some((at) => t - 1500 < at && at < t + 500);
  let back = 0;
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (!calm(list[i].t)) continue;
    if (i && list[i].d < list[i - 1].d - 0.01) back++;
    const err = Math.abs(list[i].d - truthAt(target, list[i].t - INTERP_MS));
    sum += err;
    max = Math.max(max, err);
    n++;
  }
  return { frames: n, back, mean: n ? sum / n : Infinity, max };
}

const fmt = (x: { frames: number; back: number; mean: number; max: number }) => (x.frames ? `${x.back} back steps in ${x.frames} frames, off ${x.mean.toFixed(2)} m on average (${x.max.toFixed(2)} at most)` : 'never seen');

test('online: over a jittery link (60-150 ms round trips) racers glide without stepping back, and guests see each other', (t) => {
  const link = { latency: 30, jitter: 45, loss: 0.02, seconds: 20 };
  const before = room({ ...link, fps: [60, 60, 60], old: true });
  const after = room({ ...link, fps: [60, 60, 60], old: false });
  const report = (cs: Client[]) => ({ hostSeesGuest: seen(cs[0], cs[1]), guestSeesHost: seen(cs[1], cs[0]), guestSeesGuest: seen(cs[2], cs[1]) });
  const b = report(before);
  const a = report(after);
  for (const k of Object.keys(a) as (keyof typeof a)[]) t.diagnostic(`${k}: before ${fmt(b[k])}; after ${fmt(a[k])}`);
  assert.equal(b.guestSeesGuest.frames, 0, 'before, a guest never saw the other guest');
  assert.ok(a.guestSeesGuest.frames > 1000, 'now the host passes guests on');
  for (const k of ['hostSeesGuest', 'guestSeesHost'] as const) {
    assert.ok(a[k].back === 0, `${k}: no backward steps (${a[k].back})`);
    assert.ok(a[k].back < b[k].back || b[k].back === 0);
    assert.ok(a[k].max < b[k].max, `${k}: closer to where it was`);
  }
  assert.equal(a.guestSeesGuest.back, 0);
});

test('online: a guest on a slow device keeps up with the room instead of running in slow motion', (t) => {
  const link = { latency: 30, jitter: 45, loss: 0.02, seconds: 15 };
  const before = room({ ...link, fps: [60, 12, 60], old: true });
  const after = room({ ...link, fps: [60, 12, 60], old: false });
  const pace = (cs: Client[]) => cs[1].s.dist / cs[0].s.dist;
  t.diagnostic(`slow guest at 12 fps covers ${(pace(before) * 100).toFixed(0)}% of the host's distance before, ${(pace(after) * 100).toFixed(0)}% after`);
  t.diagnostic(`host sees the slow guest: before ${fmt(seen(before[0], before[1]))}; after ${fmt(seen(after[0], after[1]))}`);
  t.diagnostic(`slow guest sees the host: before ${fmt(seen(before[1], before[0]))}; after ${fmt(seen(after[1], after[0]))}`);
  assert.ok(pace(before) < 0.75);
  assert.ok(Math.abs(pace(after) - 1) < 0.03, `keeps pace (${pace(after).toFixed(3)})`);
  assert.equal(seen(after[0], after[1]).back, 0);
  assert.ok(seen(after[1], after[0]).max < seen(before[1], before[0]).max);
});

test('own racer: input shows on the very next step, with nothing from the host to pull it back', () => {
  const s = create(endlessTrack(5), { respawn: true });
  step(s, 1 / 60, { dir: 0, jump: false });
  const x = s.x;
  step(s, 1 / 60, { dir: 1, jump: false });
  assert.ok(s.x > x);
});
