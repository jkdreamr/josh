// Palm Drive online, end to end: a host and seven guests race through the Worker's real Room object and the arcade's
// real RoomLink, over simulated connections with latency, jitter and retransmits (see netroom-sim.ts), on a mock clock.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NET_OK, percentile, rng, runFor, Screens, SimClient, SimRoom, viewErrors, type Link } from './netroom-sim.ts';
import { AGE_MAX, applyEvent, HostClock, onHostClock, newNet, onlineRace, Pacer, receive, SampleClock, tick, type Seats } from '../src/os/arcade/games/palmdrive/netsync.ts';
import { freshGarage, lookFor } from '../src/os/arcade/games/palmdrive/garage.ts';
import { carried, GLIDE_FULL, GLIDE_MAX } from '../src/os/arcade/games/palmdrive/logic.ts';
import { carOf, events, guestState, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { canResume, holdsDue, holdUntil, nextAlarm, orphanSeats, parseRoomMessage, type RoomState } from '../worker/src/room-core.ts';

const NAMES = ['Host', 'Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay', 'Gus'];

type Room = { sim: SimRoom; clients: SimClient[]; t0: number; restore: () => void };

/**
 * Eight people in a room, each a little further from the Worker than the last, and the host's Start pressed. net: each
 * person's connection (by seat), frames: how long each of their frames takes, when it wanders.
 */
async function room(opts: { legacy?: boolean; hostFrameMs?: number; laps?: number; net?: (i: number) => Link; frames?: (i: number) => (() => number) | undefined } = {}): Promise<Room> {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const random = Math.random;
  Math.random = rng(11);
  const sim = new SimRoom('PALM', 5);
  await sim.start();
  const clients = NAMES.map((name, i) => new SimClient(sim, name, opts.net?.(i) ?? { ...NET_OK, latency: 20 + i * 8 }, { laps: opts.laps ?? 1, legacy: opts.legacy, frameMs: i === 0 ? opts.hostFrameMs : undefined, frames: opts.frames?.(i) }));
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
async function race(r: Room, ms: number, hooks: [number, () => void][] = [], stepMs?: number) {
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
    if (++frame % Math.round(100 / (stepMs ?? 1000 / 60)) === 0) errs.push(...viewErrors(r.clients.filter((c) => !c.hidden && c.link.link === 'ok' && !c.sockets.at(-1)?.dead)));
  }, stepMs);
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
    // (a guest's own kart goes to everyone at once through the room, see RoomLink.send: seven copies of each)
    assert.ok(rate(c0.out, c1.out) < 900, `and sends ${rate(c0.out, c1.out).toFixed(0)}`);
    assert.ok(rate(c0.up[0], c1.up[0]) < 10_000, `the host sends ${rate(c0.up[0], c1.up[0]).toFixed(0)} B/s`);
    assert.ok(rate(c0.down[0], c1.down[0]) < 16_000, `the host gets ${rate(c0.down[0], c1.down[0]).toFixed(0)} B/s`);
    for (let i = 1; i < 8; i++) {
      assert.ok(rate(c0.up[i], c1.up[i]) < 2_500, `${clients[i].name} sends ${rate(c0.up[i], c1.up[i]).toFixed(0)} B/s`);
      assert.ok(rate(c0.down[i], c1.down[i]) < 17_000, `${clients[i].name} gets ${rate(c0.down[i], c1.down[i]).toFixed(0)} B/s`);
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

/**
 * A rough evening: everyone 120-250 ms from each other through the room, with jitter, 1-3 % of messages held up by a
 * retransmit (TCP keeps everything behind it waiting) and now and then a Wi-Fi stall of up to 300 ms; the host's
 * laptop at 30 to 60 frames a second with a 100 ms hitch every few seconds, the guests' with a shorter one now and then.
 */
const rough = {
  net: (i: number): Link => ({ latency: 60 + i * 9, jitter: 30, loss: 0.01 + (i % 3) * 0.01, rto: 250, spike: 0.004, spikeMs: 300 }),
  frames: (i: number) => {
    const rand = rng(100 + i);
    let t = 0;
    let fps = 45;
    let hitch = (i ? 3000 : 1000) + rand() * 2000;
    return () => {
      fps = i ? 60 : Math.max(30, Math.min(60, fps + (rand() - 0.5) * 6));
      let gap = 1000 / fps;
      t += gap;
      if (t > hitch) {
        hitch = t + (i ? 4000 + rand() * 4000 : 2000 + rand() * 1500);
        gap = i ? 40 + rand() * 40 : 100;
      }
      return gap;
    };
  },
};

test('on rough connections and a hitching host, other karts move smoothly, clocks agree and nobody’s kart is jerked about', async () => {
  const r = await room(rough);
  const screens = new Screens(r.clients);
  try {
    // (in 4 ms slices, so frames and messages land when they should: what each screen shows is timed to the moment)
    const errs = await race(r, 75_000, [], 4);
    for (const c of r.clients) assert.deepEqual(c.closed, [], `${c.name} stayed connected`);
    everyoneAgrees(r.clients);
    const { jumps, truth, ageGuests, clockStep, clockOff } = screens;
    const big = jumps.filter((j) => j > 1).length;
    // (a kart's own frame-to-frame step, against the one before, is up to a metre or so: a bump, a hit, frames that don't keep time)
    assert.ok(percentile(jumps, 0.999) < 1 && Math.max(...jumps) < Math.max(...truth) + 1, `remote karts never jump: p99.9 ${percentile(jumps, 0.999).toFixed(2)} m, most ${Math.max(...jumps).toFixed(2)} m (their owners' ${Math.max(...truth).toFixed(2)} m)`);
    assert.ok(big < jumps.length / 2000, `${big} frames of ${jumps.length} with a step off by a metre`);
    assert.ok(percentile(ageGuests, 0.5) < 0.4, `word of another guest is ${percentile(ageGuests, 0.5).toFixed(2)} s old (p50)`);
    assert.ok(Math.max(...clockStep) < 0.008, `the race clock never jumps: ${(Math.max(...clockStep) * 1000).toFixed(1)} ms at most in a frame`);
    assert.ok(percentile(clockOff, 0.5) < 0.008 && percentile(clockOff, 0.99) < 0.025, `guests' clocks ${(percentile(clockOff, 0.5) * 1000).toFixed(1)} ms off the host's (p50), ${(percentile(clockOff, 0.99) * 1000).toFixed(1)} ms (p99)`);
    const [p50, p95] = [percentile(errs, 0.5), percentile(errs, 0.95)];
    assert.ok(p50 < 1.5 && p95 < 6, `view error p50 ${p50.toFixed(2)} m, p95 ${p95.toFixed(2)} m`);
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

  // carried round a bend at the rate it was turning, speeding up as it was, the way it was really going
  const straight = carried({ x: 0, z: 0, h: 0, v: 10 }, 0.4);
  assert.deepEqual([straight.x, straight.z], [0, 4]);
  const bend = carried({ x: 0, z: 0, h: 0, v: 25, w: 1 }, 0.4);
  const r = 25;
  assert.ok(Math.abs(bend.x - r * (1 - Math.cos(0.4))) < 1e-9 && Math.abs(bend.z - r * Math.sin(0.4)) < 1e-9 && Math.abs(bend.h - 0.4) < 1e-9);
  const faster = carried({ x: 0, z: 0, h: 0, v: 10, a: 8 }, 0.2);
  assert.ok(Math.abs(faster.z - (2 + 0.5 * 8 * 0.04)) < 1e-9);
  const braking = carried({ x: 0, z: 0, h: 0, v: 4, a: -20 }, 0.4);
  assert.ok(Math.abs(braking.z - 0.4) < 1e-9, 'never backing up past a stop');
  const wall = carried({ x: 0, z: 0, h: 0, v: 30, dir: Math.PI / 2, u: 20 }, 0.1);
  assert.ok(Math.abs(wall.x - 2) < 1e-9 && Math.abs(wall.z) < 1e-9 && wall.h === 0, 'sliding along a wall, facing into it');
  // and eased to a stop when word of it stops coming, rather than stopping dead
  const far = (age: number) => carried({ x: 0, z: 0, h: 0, v: 10 }, age).z;
  assert.ok(Math.abs(far(GLIDE_FULL) - 10 * GLIDE_FULL) < 1e-9);
  assert.ok(far(GLIDE_FULL + 0.1) > far(GLIDE_FULL) + 0.9 && far(GLIDE_MAX) === far(GLIDE_MAX + 1));
  assert.ok(Math.abs(far(GLIDE_MAX) - 10 * (GLIDE_FULL + (GLIDE_MAX - GLIDE_FULL) / 2)) < 1e-9);
  const air = carried({ x: 0, z: 0, h: 0, v: 0, y: 1, vy: 2 }, 0.1);
  assert.ok(Math.abs(air.y! - (1 + 0.2 - 0.5 * 28 * 0.01)) < 1e-9, 'up in the air, on the arc it was flying');

  // a guest's clock comes over to the host's a few percent faster or slower, never in a jump
  const n = newNet(null);
  n.host.observe(10, 0, 10.05 + 0.04, 10.08);
  assert.ok(Math.abs(n.host.ahead - 0.05) < 1e-9);
  const steps = Array.from({ length: 60 }, () => onHostClock(n, false, 1 / 60));
  assert.ok(steps.every((d) => d <= (1 / 60) * 1.07 && d >= 1 / 60), 'at most 6 % fast');
  assert.ok(Math.abs(n.host.ahead) < 0.05, 'and closing');
  assert.equal(onHostClock(n, true, 0.1), 0.1, 'the host keeps its own');
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

test('a guest’s kart goes to the other guests straight through the room; the host passes it on only at keyframes and sends its time back', () => {
  const players = [0, 1, 2].map((seat) => ({ seat, name: NAMES[seat] }));
  const seats = (seat: number): Seats => ({ seat, isHost: seat === 0, round: 1, players, bots: [] });
  const look = lookFor(freshGarage());
  const host = { o: seats(0), n: newNet(seats(0)) };
  const race = (seat: number) => onlineRace(seats(seat), '150cc', 'palm', [0, 1, 2], 3, look);
  const rh = race(0);
  const [r1, r2] = [race(1), race(2)];
  const n1 = newNet(seats(1));
  const n2 = newNet(seats(2));
  const wire = (d: unknown) => JSON.parse(JSON.stringify(d));
  // the host's first state sets everyone's race up
  const first = tick(host.n, rh, host.o, -1).out[0].d;
  const g1 = receive(n1, r1, seats(1), 0, wire(first), () => look)!.race!;
  const g2 = receive(n2, r2, seats(2), 0, wire(first), () => look)!.race!;
  // Ann's kart, to everyone through the room
  g1.time = rh.time;
  const out = tick(n1, g1, seats(1), -1, 0, true).out[0];
  assert.equal(out.everyone, true);
  assert.equal((out.d as { a?: number }).a, 1, 'and says so');
  receive(n2, g2, seats(2), 1, wire(out.d), () => look);
  assert.equal(g2.karts.find((k) => k.seat === 1)!.net?.at, g1.time, 'Bo has it straight from her');
  receive(host.n, rh, host.o, 1, wire(out.d), () => look);
  rh.time += 0.05;
  // the host's next state leaves her kart out (Bo has it already) but sends her its time back
  const S = parsePacket(wire(tick(host.n, rh, host.o, -1).out[0].d));
  assert.ok(S?.k === 'S');
  assert.ok(!S.cars.some((c) => c.seat === 1));
  assert.equal(S.echoes.length, 1);
  assert.deepEqual(S.echoes[0].slice(0, 2), [1, Math.round(g1.time * 1000) / 1000]);
  assert.ok(Math.abs(S.echoes[0][2] - 50) <= 1, 'held 50 ms');
  // and every keyframe carries every kart, for anyone who missed it (or a guest from before)
  let keyframe = false;
  for (let i = 0; i < 5; i++) {
    const p = parsePacket(wire(tick(host.n, rh, host.o, -1).out[0].d));
    if (p?.k === 'S' && p.cars.some((c) => c.seat === 1)) keyframe = true;
  }
  assert.ok(keyframe);
});

test('a shell someone else threw starts out where it has got to by now, not where it was when they threw it', () => {
  const o: Seats = { seat: 1, isHost: false, round: 1, players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Ann' }], bots: [] };
  const r = onlineRace(o, '150cc', 'palm', [0, 1], 0, lookFor(freshGarage()));
  r.time = 5;
  const k = r.karts.find((x) => x.seat === 0)!;
  const shell = { y: 'spawn' as const, id: 7, kind: 'green' as const, x: k.x, z: k.z, vx: 0, vz: 40, vy: 0, yy: 0.35, tg: -1, pg: 0, gr: 0.6 };
  applyEvent(r, 0, shell, 0.2);
  const th = r.things.find((t) => t.id === 7)!;
  assert.ok(Math.abs(th.z - (k.z + 8)) < 0.5, `carried on 8 m (${(th.z - k.z).toFixed(2)})`);
  applyEvent(r, 0, { ...shell, id: 8 });
  assert.equal(r.things.find((t) => t.id === 8)!.z, k.z, 'from an older client, where it was');
  // the packet says when
  const e = parsePacket(JSON.parse(JSON.stringify(events(1, 0, [shell], 4.8))));
  assert.ok(e?.k === 'e' && e.at === 4.8);
  const old = parsePacket({ t: 'pk', r: 1, k: 'e', o: 0, ev: [shell] });
  assert.ok(old?.k === 'e' && old.at === null);
});
