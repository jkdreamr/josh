// Palm Drive online, end to end: a host and seven guests race through the Worker's real Room object and the arcade's
// real RoomLink, over simulated connections with latency, jitter and retransmits (see netroom-sim.ts), on a mock clock.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NET_OK, percentile, rng, runFor, SimClient, SimRoom, viewErrors } from './netroom-sim.ts';
import { AGE_MAX, HostClock, Pacer, SampleClock } from '../src/os/arcade/games/palmdrive/netsync.ts';
import { carried } from '../src/os/arcade/games/palmdrive/logic.ts';
import { carOf, guestState, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { canResume, holdsDue, holdUntil, nextAlarm, orphanSeats, parseRoomMessage, type RoomState } from '../worker/src/room-core.ts';

const NAMES = ['Host', 'Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay', 'Gus'];

type Room = { sim: SimRoom; clients: SimClient[]; t0: number; restore: () => void };

/** Eight people in a room, each a little further from the Worker than the last, and the host's Start pressed. */
async function room(opts: { legacy?: boolean; hostFrameMs?: number; laps?: number } = {}): Promise<Room> {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const random = Math.random;
  Math.random = rng(11);
  const sim = new SimRoom('PALM', 5);
  await sim.start();
  const clients = NAMES.map((name, i) => new SimClient(sim, name, { ...NET_OK, latency: 20 + i * 8 }, { laps: opts.laps ?? 1, legacy: opts.legacy, frameMs: i === 0 ? opts.hostFrameMs : undefined }));
  for (const c of clients) {
    c.join();
    await runFor(mock.timers, sim, 250);
  }
  await runFor(mock.timers, sim, 1000);
  clients[0].link.start();
  return {
    sim,
    clients,
    t0: Date.now(),
    restore: () => {
      for (const c of clients) c.link.close();
      sim.stop();
      Math.random = random;
      mock.timers.reset();
    },
  };
}

/** The most items out on any one client's course, and kart states held, at any moment (nothing should pile up). */
let piled = { things: 0, held: 0 };

/** Runs the race to its end (or `ms`), calling `at` hooks at their seconds since Start, and samples the view error. */
async function race(r: Room, ms: number, hooks: [number, () => void][] = []) {
  const errs: number[] = [];
  let frame = 0;
  piled = { things: 0, held: 0 };
  await runFor(mock.timers, r.sim, ms, (now) => {
    for (const hook of hooks) {
      if (hook[0] >= 0 && now - r.t0 >= hook[0] * 1000) {
        hook[1]();
        hook[0] = -1;
      }
    }
    for (const c of r.clients) {
      piled.things = Math.max(piled.things, c.race?.things.length ?? 0);
      piled.held = Math.max(piled.held, c.n.cars.size + c.n.clocks.size + c.n.outbox.length);
    }
    // (only karts somebody is looking at, from players whose connection is up)
    if (++frame % 6 === 0) errs.push(...viewErrors(r.clients.filter((c) => !c.hidden && c.link.link === 'ok' && !c.sockets.at(-1)?.dead)));
  });
  return errs;
}

const everyoneAgrees = (clients: SimClient[]) => {
  const host = clients[0].end;
  assert.ok(host, 'the host called the race');
  for (const c of clients) assert.deepEqual(c.end?.order, host.order, `${c.name} has the host's result`);
  assert.equal(host.order.filter(([, fin]) => fin >= 0).length, 8, 'everyone finished');
};

test('eight players race through the real room: bounded bandwidth, nobody dropped, remote karts where their owners have them', async () => {
  const before = await room({ legacy: true });
  const legacy = await race(before, 70_000);
  before.restore();

  const r = await room();
  const { sim, clients } = r;
  const counts = () => ({ in: sim.in, out: sim.out, up: clients.map((c) => c.up), down: clients.map((c) => c.down) });
  const c0 = counts();
  let progHidden = 0;
  // Bo's tab goes to the background for twenty seconds mid-race: no frames, and its timers held to once a second
  const errs = await race(r, 70_000, [
    [15, () => (clients[2].hidden = true)],
    [16, () => (progHidden = clients[2].me!.prog)],
    [34, () => assert.ok(clients[2].me!.prog > progHidden + 100, 'a kart in a background tab keeps racing')],
    [35, () => (clients[2].hidden = false)],
    [36, () => assert.ok(Math.abs(clients[2].race!.time - clients[0].race!.time) < 0.3, 'and its clock is the host’s')],
  ]);
  const c1 = counts();
  const secs = (Date.now() - r.t0) / 1000;
  try {
    for (const c of clients) assert.deepEqual(c.closed, [], `${c.name} stayed connected`);
    everyoneAgrees(clients);
    assert.ok(piled.things < 40 && piled.held <= 16, `nothing piles up over a race (${piled.things} items out, ${piled.held} states kept at most)`);
    // what an eight-player race costs: 15 states a second from everyone, the host's to everyone
    const rate = (a: number, b: number) => (b - a) / secs;
    assert.ok(rate(c0.in, c1.in) < 140, `the room takes ${rate(c0.in, c1.in).toFixed(0)} messages a second`);
    assert.ok(rate(c0.out, c1.out) < 250, `and sends ${rate(c0.out, c1.out).toFixed(0)}`);
    assert.ok(rate(c0.up[0], c1.up[0]) < 10_000, `the host sends ${rate(c0.up[0], c1.up[0]).toFixed(0)} B/s`);
    assert.ok(rate(c0.down[0], c1.down[0]) < 16_000, `the host gets ${rate(c0.down[0], c1.down[0]).toFixed(0)} B/s`);
    for (let i = 1; i < 8; i++) {
      assert.ok(rate(c0.up[i], c1.up[i]) < 2_500, `${clients[i].name} sends ${rate(c0.up[i], c1.up[i]).toFixed(0)} B/s`);
      assert.ok(rate(c0.down[i], c1.down[i]) < 10_000, `${clients[i].name} gets ${rate(c0.down[i], c1.down[i]).toFixed(0)} B/s`);
    }
    // every kart on every screen within a few metres of where its owner has it (a kart covers 8 m in a quarter second)
    const [p50, p95] = [percentile(errs, 0.5), percentile(errs, 0.95)];
    assert.ok(p50 < 2.5 && p95 < 8, `view error p50 ${p50.toFixed(2)} m, p95 ${p95.toFixed(2)} m`);
    assert.ok(p50 < percentile(legacy, 0.5) / 3 && p95 < percentile(legacy, 0.95) * 0.75, `well under before: p50 ${percentile(legacy, 0.5).toFixed(2)} m, p95 ${percentile(legacy, 0.95).toFixed(2)} m`);
  } finally {
    r.restore();
  }
});

test('a host on slow frames keeps its race on the wall clock, rather than everyone’s bots in slow motion', async () => {
  const before = await room({ legacy: true, hostFrameMs: 1000 / 12 });
  await race(before, 40_000);
  const lag = before.clients[1].race!.time - before.clients[0].race!.time;
  before.restore();
  assert.ok(lag > 10, `before, the host fell ${lag.toFixed(1)} s behind`);

  const r = await room({ hostFrameMs: 1000 / 12 });
  try {
    await race(r, 40_000);
    for (const c of r.clients) assert.ok(Math.abs(c.race!.time - r.clients[0].race!.time) < 0.2, `${c.name}'s clock is the host's`);
  } finally {
    r.restore();
  }
});

test('a dropped connection gets its seat back mid-race, and nobody else ever sees them go', async () => {
  const r = await room();
  const { clients } = r;
  let least = 8;
  try {
    // Cy's Wi-Fi drops (both ends hear of it); Ed's connection just goes dead (nobody hears, RoomLink's watch notices)
    await race(r, 70_000, [
      [20, () => clients[3].sockets.at(-1)!.cut(true)],
      [25, () => clients[5].sockets.at(-1)!.cut(false)],
      [21, () => (least = Math.min(least, clients[0].players.length))],
      [32, () => (least = Math.min(least, clients[0].players.length))],
    ]);
    for (const i of [3, 5]) {
      assert.deepEqual(clients[i].links, ['reconnecting', 'ok'], `${clients[i].name} got back in`);
      assert.equal(clients[i].seat, i, 'to the same seat');
      assert.equal(clients[i].sockets.length, 2);
    }
    assert.equal(least, 8, 'the host never saw anyone leave');
    for (const c of clients) assert.deepEqual(c.closed, []);
    everyoneAgrees(clients);
  } finally {
    r.restore();
  }
});

test('the Worker redeployed mid-race costs everyone a moment, not the race', async () => {
  const r = await room();
  try {
    await race(r, 70_000, [[30, () => r.sim.redeploy()]]);
    for (const c of r.clients) {
      assert.deepEqual(c.closed, [], `${c.name} was never shown Connection Lost`);
      assert.deepEqual(c.links, ['reconnecting', 'ok']);
      assert.equal(c.seat, r.clients.indexOf(c));
    }
    everyoneAgrees(r.clients);
  } finally {
    r.restore();
  }
});

test('the host dropping for a moment keeps the room and the race; a guest who never comes back is let go after the hold', async () => {
  const r = await room();
  const { clients } = r;
  let heldAfter15s = false;
  try {
    await race(r, 70_000, [
      [15, () => clients[0].sockets.at(-1)!.cut(true)],
      // Gus closes the laptop for good: his connection drops and he never tries again
      [20, () => {
        clients[7].sockets.at(-1)!.cut(true);
        clients[7].link.close();
        clients[7].race = null;
      }],
      [35, () => (heldAfter15s = clients[0].players.some((p) => p.seat === 7))],
    ]);
    assert.deepEqual(clients[0].links, ['reconnecting', 'ok'], 'the host got back in');
    assert.equal(clients[0].seat, 0, 'still the host');
    assert.ok(heldAfter15s, 'Gus kept his seat for a while');
    assert.ok(!clients[0].players.some((p) => p.seat === 7), 'and was let go after');
    for (const c of clients.slice(0, 7)) assert.deepEqual(c.closed, []);
    const end = clients[0].end;
    assert.ok(end, 'the host called the race without him');
    for (const c of clients.slice(1, 7)) assert.deepEqual(c.end?.order, end.order);
    assert.equal(end.order.filter(([, fin]) => fin >= 0).length, 7);
  } finally {
    r.restore();
  }
});

test('kart states carry their sample time and the host’s hold, and older packets still read', () => {
  const k = { x: 1.234, z: -5.678, y: 0, h: 0.5, v: 20, prog: 100, done: null } as Parameters<typeof carOf>[0];
  const car = carOf({ ...k, spin: 0, tumble: 0, star: 0, shrink: 0, boost: 0, drift: 0, squash: 0, charge: 0, trail: false, item: null, slamT: 0, trick: false, wobble: 0, draft: 0, mega: 0, bullet: 0, ink: 0, sunk: 0, boo: 0, cloud: 0, frozen: 0, piranha: 0, roll: 0 } as never, 7, -2.5);
  assert.equal(car.t, -2.5, 'a time in the countdown is negative');
  const s = parsePacket(JSON.parse(JSON.stringify(guestState(3, car))));
  assert.equal(s?.k === 's' && s.car.t, -2.5);
  const S = parsePacket(JSON.parse(JSON.stringify(hostState(3, -12.3456, '150cc', [0, 1], [{ seat: 1, ...car, hold: 41.6 }]))));
  assert.ok(S?.k === 'S');
  assert.equal(S.go, -12.346, 'the host’s clock to the millisecond');
  assert.equal(S.cars[0].hold, 42);
  // from a client before sample times: no t, no hold
  const old = parsePacket({ t: 'pk', r: 3, k: 's', c: [1, 2, 0, 0.5, 20, 100, 0, -1, 7] });
  assert.ok(old?.k === 's' && old.car.t === null && old.car.hold === undefined);
});

test('reports are placed by when they were sampled, newest only; the host’s clock is read from round trips', () => {
  const c = new SampleClock();
  assert.equal(c.at(10, 9.8), 9.8);
  assert.equal(c.at(10.1, 9.7), null, 'an older report that overtook a newer one');
  assert.equal(c.at(10.1, 9.8), null, 'the same one twice');
  assert.equal(c.at(12, 10), 12 - AGE_MAX, 'carried on no further than AGE_MAX');
  assert.equal(c.at(12, 12.5), 12, 'never from the future');

  const h = new HostClock();
  assert.equal(h.ahead, 0);
  // host 0.3 s ahead of us, 40 ms each way, held 20 or 60 ms at the host
  h.observe(10, 0.06, 10.3 + 0.04 + 0.06, 10 + 0.08 + 0.06);
  h.observe(11, 0.02, 11.3 + 0.04 + 0.02, 11 + 0.08 + 0.02);
  assert.ok(Math.abs(h.ahead - 0.3) < 1e-9);
  h.moved(0.1);
  assert.ok(Math.abs(h.ahead - 0.2) < 1e-9);

  const p = new Pacer();
  assert.equal(p.take(1000, 0.25), 0);
  assert.ok(Math.abs(p.take(1600, 0.25) - 0.25) < 1e-9, 'a long stall is caught up a slice at a time');
  assert.ok(Math.abs(p.behind - 0.35) < 1e-9);
  assert.ok(Math.abs(p.take(1600, 2) - 0.35) < 1e-9);

  // carried round a bend at the rate it was turning
  const straight = carried({ x: 0, z: 0, h: 0, v: 10 }, 0.5);
  assert.deepEqual([straight.x, straight.z], [0, 5]);
  const bend = carried({ x: 0, z: 0, h: 0, v: 10, w: 1 }, Math.PI / 2);
  assert.ok(Math.abs(bend.x - 10) < 1e-9 && Math.abs(bend.z - 10) < 1e-9 && Math.abs(bend.h - Math.PI / 2) < 1e-9);
});

test('the room keeps a dropped seat for its key, relays to several seats at once, and wakes for a hold running out', () => {
  const keys = { '1': { key: 'a'.repeat(32), name: 'Ann' }, '2': { key: 'b'.repeat(32), name: 'Bo' } };
  assert.ok(canResume(keys, 1, 'a'.repeat(32)));
  assert.ok(!canResume(keys, 1, 'b'.repeat(32)), 'another seat’s key');
  assert.ok(!canResume(keys, 3, 'a'.repeat(32)), 'a seat with no key');
  assert.ok(!canResume(keys, 1, 'A'.repeat(32)), 'not a key');
  assert.deepEqual(orphanSeats(keys, {}, [1]), [2], 'a seat with a key and no socket, as after a restart');
  assert.deepEqual(orphanSeats(keys, { '2': { until: 5, round: 1 } }, [1]), []);
  const held = { '1': { until: 3000, round: 2 }, '4': { until: 2000, round: 2 } };
  assert.deepEqual(holdsDue(held, 2500), [4]);
  assert.equal(holdUntil(held), 2000);
  assert.equal(holdUntil({}), null);
  const room: RoomState = { game: 'palmdrive', seats: 8, started: true };
  assert.equal(nextAlarm(room, false, null, 1000, 2000), 2000);
  assert.equal(nextAlarm(room, true, null, 1000, 2000), 2000);
  assert.equal(nextAlarm(room, false, null, 1000), null);
  assert.deepEqual(parseRoomMessage('{"t":"msg","to":[1,3],"d":1}', 4), { t: 'msg', to: [1, 3], d: 1 });
  assert.equal(parseRoomMessage('{"t":"msg","to":[1,1],"d":1}', 4), null, 'each seat once');
  assert.equal(parseRoomMessage('{"t":"msg","to":[4],"d":1}', 4), null);
  assert.equal(parseRoomMessage('{"t":"msg","to":[],"d":1}', 4), null);
  assert.equal(parseRoomMessage(`{"t":"msg","d":"${'é'.repeat(4200)}"}`, 4), null, 'too big, counted in bytes');
  assert.deepEqual(parseRoomMessage(`{"t":"msg","d":"${'é'.repeat(2000)}"}`, 4), { t: 'msg', d: 'é'.repeat(2000) });
});
