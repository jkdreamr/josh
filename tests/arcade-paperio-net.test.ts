import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopSteps } from '../src/os/arcade/kit/loop-core.ts';
import { makeMind, botTick } from '../src/os/arcade/games/paperio/bots.ts';
import type { Ctl, Net, Pose } from '../src/os/arcade/games/paperio/ctl.ts';
import { GO, guestCtl, hostCtl } from '../src/os/arcade/games/paperio/session.ts';
import { TICK, mulberry32 } from '../src/os/arcade/games/paperio/world.ts';
import { ClockGap, F_ALIVE, movePacket, parsePacket, statePacket } from '../src/os/arcade/games/paperio/net.ts';

// ---------------------------------------------------------------------------------------------------------------
// A host and two guests over a delayed, jittery link, each on its own frame rate, run the way the page runs them:
// the kit's loop steps (one step of at most 1/20 s a frame, or with `realtime` as many as cover the frame), each fed
// to the round's fixed 60 Hz ticks.

type Opts = { fps: [number, number, number]; realtime: boolean; latency: number; jitter: number; loss: number; seconds: number };
type Seen = { t: number; x: number; y: number; alive: boolean };
type Client = { seat: number; fps: number; c: Ctl; acc: number; last: number; next: number; truth: Seen[]; shown: Map<number, Seen[]> };

function room(o: Opts) {
  const rng = mulberry32(11);
  const players = [
    { seat: 0, name: 'host' },
    { seat: 1, name: 'ana' },
    { seat: 2, name: 'ben' },
  ];
  let wall = 0;
  const queue: { at: number; from: number; to: number; d: unknown; n: number }[] = [];
  const lastReliable = new Map<string, number>();
  const listeners = new Map<number, (from: number, d: unknown) => void>();
  let n = 0;
  const net = (seat: number): Net => ({
    seat,
    round: 1,
    isHost: seat === 0,
    players: () => players,
    send: (d, opts) => {
      const to = seat === 0 ? (opts?.to !== undefined ? [opts.to] : [1, 2]) : [0];
      const text = JSON.stringify(d);
      for (const r of to) {
        if (opts?.fast) {
          if (rng() < o.loss) continue;
          queue.push({ at: wall + o.latency + rng() * o.jitter, from: seat, to: r, d: JSON.parse(text), n: n++ });
        } else {
          // reliable and in order: a message waits for the ones before it
          const key = `${seat}>${r}`;
          const at = Math.max(lastReliable.get(key) ?? 0, wall + o.latency + rng() * o.jitter);
          lastReliable.set(key, at);
          queue.push({ at, from: seat, to: r, d: JSON.parse(text), n: n++ });
        }
      }
    },
    onMessage: (fn) => {
      listeners.set(seat, fn);
      return () => listeners.delete(seat);
    },
    report: () => {},
  });
  const opts = { skin: 0, fill: 4, level: 1 as const, length: 3, seed: 21 };
  const ctls = [hostCtl(net(0), opts), guestCtl(net(1), { ...opts, skin: 4 }), guestCtl(net(2), { ...opts, skin: 6 })];
  const clients: Client[] = ctls.map((c, seat) => ({ seat, fps: o.fps[seat], c, acc: 0, last: -1, next: 0, truth: [], shown: new Map() }));
  const pose: Pose = { x: 0, y: 0, h: 0, alive: false, out: false };
  for (; wall <= o.seconds; wall += 0.001) {
    for (const cl of clients) {
      if (wall < cl.next) continue;
      cl.next += 1 / cl.fps;
      // messages are handled between frames
      queue.sort((a, b) => a.at - b.at || a.n - b.n);
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        if (m.to !== cl.seat || m.at > wall) continue;
        queue.splice(i--, 1);
        listeners.get(cl.seat)?.(m.from, m.d);
      }
      const c = cl.c;
      const steps = loopSteps(cl.last < 0 ? 0 : wall - cl.last, o.realtime);
      cl.last = wall;
      let left = steps.reduce((a, b) => a + b, 0);
      for (const dt of steps) {
        left -= dt;
        // as the page does it: the round's frame, then its 60 Hz ticks
        c.frame?.(dt);
        cl.acc += dt;
        let k = 0;
        while (cl.acc >= TICK && k < 5) {
          for (const id of c.locals) {
            const p = c.w.players[id];
            if (p?.alive) {
              p.mind ??= makeMind('defender', 1, mulberry32(id * 7 + 1));
              botTick(c.w, p, TICK);
            }
          }
          c.tick();
          c.w.events.length = 0;
          cl.acc -= TICK;
          k++;
          const me = c.w.players[c.locals[0]];
          if (me) cl.truth.push({ t: wall - left - cl.acc, x: me.x, y: me.y, alive: me.alive });
        }
        if (k === 5) cl.acc = Math.min(cl.acc, TICK);
      }
      for (const p of c.w.players) {
        if (!p || p.id === c.locals[0] || p.seat < 0) continue;
        c.pose(p, cl.acc / TICK, pose);
        let list = cl.shown.get(p.seat);
        if (!list) cl.shown.set(p.seat, (list = []));
        list.push({ t: wall, x: pose.x, y: pose.y, alive: pose.alive });
      }
    }
  }
  for (const c of ctls) c.dispose();
  return clients;
}

function truthAt(c: Client, t: number): Seen {
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
  return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, alive: a.alive && b.alive };
}

/**
 * How viewer draws target's head while it runs on alive: steps back against the way it really went, and how far off
 * it is from where it really was, at the steady delay that fits best (cells; heads run 46 cells a second).
 */
function seen(viewer: Client, target: Client, from = GO + 2) {
  const all = (viewer.shown.get(target.seat) ?? []).filter((x) => x.t >= from);
  // only while alive, well clear of a death or a respawn
  const calm = (t: number) => {
    for (let d = -1.5; d <= 1.5; d += 0.1) if (!truthAt(target, t + d).alive) return false;
    return true;
  };
  const list = all.filter((x) => x.alive && calm(x.t));
  let best = { lag: 0, mean: Infinity, max: 0 };
  for (let lag = -0.3; lag <= 0.4; lag += 0.005) {
    let sum = 0;
    let max = 0;
    for (const s of list) {
      const r = truthAt(target, s.t - lag);
      const e = Math.hypot(s.x - r.x, s.y - r.y);
      sum += e;
      max = Math.max(max, e);
    }
    if (list.length && sum / list.length < best.mean) best = { lag, mean: sum / list.length, max };
  }
  let back = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].t - list[i - 1].t > 0.2) continue;
    const a = truthAt(target, list[i - 1].t - best.lag);
    const b = truthAt(target, list[i].t - best.lag);
    const along = (list[i].x - list[i - 1].x) * (b.x - a.x) + (list[i].y - list[i - 1].y) * (b.y - a.y);
    if (along < -0.05 * Math.hypot(b.x - a.x, b.y - a.y)) back++;
  }
  return { frames: list.length, back, lag: best.lag, mean: best.mean, max: best.max };
}
const fmt = (x: ReturnType<typeof seen>) => `${x.back} back steps in ${x.frames} frames; drawn ${(x.lag * 1000).toFixed(0)} ms behind, ${x.mean.toFixed(2)} cells off that on average (${x.max.toFixed(2)} at most)`;

const LINK = { latency: 0.03, jitter: 0.045, loss: 0.02, seconds: GO + 25 };

test('online: over a jittery link (60-150 ms round trips) heads glide where they really went', { timeout: 120_000 }, (t) => {
  const cs = room({ ...LINK, fps: [60, 60, 60], realtime: true });
  const views = { hostSeesGuest: seen(cs[0], cs[1]), guestSeesHost: seen(cs[1], cs[0]), guestSeesGuest: seen(cs[2], cs[1]) };
  for (const [k, v] of Object.entries(views)) t.diagnostic(`${k}: ${fmt(v)}`);
  for (const [k, v] of Object.entries(views)) {
    assert.ok(v.frames > 300);
    assert.equal(v.back, 0, `${k}: never steps back`);
    // drawn a steady moment behind (the 100 ms of DELAY and the link), and close to where it was then (heads run 46 cells a second)
    assert.ok(v.lag >= 0.08 && v.lag <= 0.25, `${k}: ${v.lag}`);
    assert.ok(v.mean < 0.6 && v.max < 3, `${k}: ${v.mean} ${v.max}`);
  }
});

test('online: a guest on a slow device keeps up with the room instead of running in slow motion', { timeout: 120_000 }, (t) => {
  const before = room({ ...LINK, fps: [60, 12, 60], realtime: false });
  const after = room({ ...LINK, fps: [60, 12, 60], realtime: true });
  // (how many ticks of the round each page ran: the round's own clock follows the host's)
  const pace = (cs: Client[]) => cs[1].c.w.tick / cs[0].c.w.tick;
  t.diagnostic(`a guest at 12 fps gets through ${(pace(before) * 100).toFixed(0)}% of the round's ticks before, ${(pace(after) * 100).toFixed(0)}% after`);
  const views = { hostSeesSlowGuest: seen(after[0], after[1]), slowGuestSeesHost: seen(after[1], after[0]) };
  for (const [k, v] of Object.entries(views)) t.diagnostic(`${k}: ${fmt(v)}`);
  assert.ok(pace(before) < 0.75);
  assert.ok(pace(after) > 0.97, `keeps pace (${pace(after).toFixed(3)})`);
  for (const v of Object.values(views)) {
    assert.equal(v.back, 0);
    assert.ok(v.mean < 1 && v.max < 3);
  }
});

test('moves say which tick their newest point was taken at, states how old a passed-on head is; older packets still read', () => {
  const mv = parsePacket(JSON.parse(JSON.stringify(movePacket(3, 2, 99, [10, 20, 11, 21], 0.5, false, 1234))));
  assert.ok(mv && mv.k === 'M' && mv.tick === 1234);
  const old = parsePacket(JSON.parse(JSON.stringify(movePacket(3, 2, 99, [10, 20, 11, 21], 0.5, false))));
  assert.ok(old && old.k === 'M' && old.tick === undefined);
  const st = parsePacket(JSON.parse(JSON.stringify(statePacket(3, 600, 10, 0, 4, null, [{ id: 1, x: 1, y: 2, h: 0, f: F_ALIVE, kills: 0, life: 1, age: 37.4 }, { id: 2, x: 1, y: 2, h: 0, f: F_ALIVE, kills: 0, life: 1, age: 0 }]))));
  assert.ok(st && st.k === 'S');
  assert.equal(st.heads[0].age, 37);
  assert.equal(st.heads[1].age, undefined);
  // what an older guest reads of a head with an age: the same head (it looks at the first seven numbers)
  const raw = statePacket(3, 600, 10, 0, 4, null, [{ id: 1, x: 1, y: 2, h: 0, f: F_ALIVE, kills: 0, life: 1, age: 37 }]) as { p: number[][] };
  assert.equal(raw.p[0].length, 8);
});

test('a clock gap goes by the least delayed report, follows a slower link slowly and a stopped clock at once', () => {
  const g = new ClockGap();
  assert.equal(g.value, null);
  assert.equal(g.at(5.04, 1), 5.04);
  assert.ok(Math.abs(g.at(5.153, 1.083) - 5.123) < 0.001);
  assert.equal(g.at(5.186, 1.166), 5.186);
  assert.ok(Math.abs(g.value! - 4.02) < 1e-9);
  assert.equal(g.at(30, 10), 30);
  assert.equal(g.value, 20);
});
