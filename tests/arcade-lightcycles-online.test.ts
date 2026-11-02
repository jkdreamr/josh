// Light Cycles online: the pieces of net.ts, and a host and a guest riding against each other over a slow, jittery link
// (lightcycles-sim.ts), against the way it was before stamped turns. Run with MEASURE=1 to print the numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArena, step, steer } from '../src/os/arcade/games/lightcycles/cycles.ts';
import { dueTurn, heard, HostClock, inputDelay, landing, nextWay, ownPlan, planned, predict, prune, queueTurn, takeTurn, DELAY_FIRST, DELAY_MAX, DELAY_MIN, type Turn } from '../src/os/arcade/games/lightcycles/net.ts';
import { FRAME_S, LINKS, mean, ride, rng, summary } from './lightcycles-sim.ts';

test('a turn lands the input delay on, never before the next step or the turn before it', () => {
  assert.equal(landing(5, 0), 6, 'offline: the next step');
  assert.equal(landing(5.9, 0), 6);
  assert.equal(landing(5.3, 0.6), 6, 'still in time for the next step');
  assert.equal(landing(5.5, 0.6), 7);
  assert.equal(landing(5.5, 0.6, 7), 8, 'one turn a step');
  assert.equal(landing(5, 1), 6, 'exactly a step on is the next one');
});

test('the input delay covers the slowest guest, within bounds, and is none alone with bots', () => {
  assert.equal(inputDelay([]), 0);
  assert.equal(inputDelay([null]), DELAY_FIRST);
  assert.ok(Math.abs(inputDelay([100]) - 0.075) < 1e-9);
  assert.ok(Math.abs(inputDelay([60, 140]) - 0.095) < 1e-9, 'the slowest one');
  assert.equal(inputDelay([2]), DELAY_MIN);
  assert.equal(inputDelay([900]), DELAY_MAX);
  assert.equal(inputDelay([300, null]), Math.max(DELAY_FIRST, 0.175 > DELAY_MAX ? DELAY_MAX : 0.175));
});

test('queued turns are taken as offline: two at most, never the same way or straight back', () => {
  const q: Turn[] = [];
  assert.equal(queueTurn(q, 1, { dir: 1, at: 0 }), false, 'the way it is going');
  assert.equal(queueTurn(q, 1, { dir: 3, at: 0 }), false, 'straight back');
  assert.equal(queueTurn(q, 1, { dir: 0, at: 0 }), true);
  assert.equal(queueTurn(q, 1, { dir: 2, at: 0 }), false, 'straight back from the turn before');
  assert.equal(queueTurn(q, 1, { dir: 3, at: 0 }), true);
  assert.equal(queueTurn(q, 1, { dir: 0, at: 0 }), false, 'two waiting');
  assert.equal(dueTurn(q, 1, 1), 0);
  assert.equal(dueTurn(q, 0, 2), 3);
  assert.equal(dueTurn(q, 3, 3), null);
});

test('the host makes a stamped turn on its step, a late one on the next, and an old guest\'s on the next as before', () => {
  const q: Turn[] = [];
  assert.equal(takeTurn(q, 0, 12, 10), 12, 'in time');
  assert.equal(nextWay(q, 1, 11), 1, 'not yet');
  assert.equal(nextWay(q, 1, 12), 0);
  assert.equal(takeTurn(q, 1, 12, 10), 13, 'one a step, in order');
  assert.equal(dueTurn(q, 1, 11), null);
  assert.equal(dueTurn(q, 1, 12), 0);
  assert.equal(dueTurn(q, 0, 13), 1);
  assert.equal(takeTurn(q, 2, 8, 10), 11, 'late: the next step');
  const old: Turn[] = [];
  assert.equal(takeTurn(old, 0, undefined, 4), 5);
  assert.equal(takeTurn(old, 0, undefined, 4), null, 'the same way twice');
  assert.equal(takeTurn(old, 1, undefined, 4), 6);
  assert.equal(takeTurn(old, 2, undefined, 4), null, 'two waiting');
});

test('a guest keeps its own turns until the host says where it took them, and late ones land next', () => {
  const own: Turn[] = [{ dir: 0, at: 5, n: 1 }, { dir: 3, at: 6, n: 2 }];
  const queue = [own, [{ dir: 2, at: 6 }] as Turn[]];
  prune(queue, 5, 0);
  assert.equal(own.length, 2, 'not heard yet');
  assert.equal(queue[1].length, 1);
  assert.deepEqual(ownPlan(own, 5), [{ dir: 0, at: 6 }, { dir: 3, at: 7 }], 'the late one lands on the next step, the other after it');
  heard(own, 1, 6);
  heard(own, 2, 7);
  assert.deepEqual(ownPlan(own, 5), [{ dir: 0, at: 6 }, { dir: 3, at: 7 }]);
  prune(queue, 6, 0);
  assert.deepEqual(own.map((t) => t.n), [2]);
  assert.equal(queue[1].length, 0);
  heard(own, 2, -1);
  assert.equal(own.length, 0, 'one the host turned down is dropped');
  const other: Turn[] = [];
  planned(other, 1, 9);
  planned(other, 2, 8);
  planned(other, 2, 8);
  assert.deepEqual(other.map((t) => t.at), [8, 9]);
});

test('prediction carries riders on with their planned turns and stops short of a wall', () => {
  const a = createArena(20, 10, 2, 2);
  const [p, q] = a.riders;
  const ahead = predict(a, [[{ dir: 0, at: 2 }], []], -1, 3);
  assert.deepEqual([ahead.x[0], ahead.y[0]], [p.x + 1, p.y - 2]);
  assert.deepEqual(ahead.cells[0].length, 3);
  assert.deepEqual([ahead.x[1], ahead.y[1]], [q.x - 3, q.y]);
  assert.equal(a.cells.filter((c) => c).length, 2, 'the arena is left as it was');
  // A bot's next move as the host sent it, then straight on.
  q.next = 2;
  const bot = predict(a, [[], []], -1, 2);
  assert.deepEqual([bot.x[1], bot.y[1]], [q.x, q.y + 2]);
  // Up against the edge: it holds there, heading into it.
  const b = createArena(6, 4, 1, 1);
  const edge = predict(b, [[]], -1, 10);
  assert.equal(edge.x[0], 5);
  assert.equal(edge.blocked[0], true);
  assert.equal(edge.next[0], 1);
  // Head on: neither takes the cell.
  const c = createArena(9, 3, 2, 2);
  c.riders[0].x = 3;
  c.riders[1].x = 5;
  c.riders[0].y = c.riders[1].y = 1;
  const meet = predict(c, [[], []], -1, 1);
  assert.equal(meet.blocked[0] && meet.blocked[1], true);
  assert.deepEqual(meet.cells, [[], []]);
});

test('the host\'s clock, read over a jittery link, settles on the host\'s and never goes back', () => {
  const rand = rng(7);
  const clock = new HostClock();
  const period = 1 / 11;
  clock.reset(period);
  // The host is at phase (t - 3) / period; our clock reads 100 s more than the host's.
  const hostAt = (t: number) => (t - 3) / period;
  const late = () => 0.04 + rand() * 0.03;
  let last = -Infinity;
  let worst = 0;
  for (let t = 3; t < 8; t += 1 / 60) {
    if (Math.round(t * 60) % 24 === 0) {
      const out = late();
      const back = late();
      clock.pong(t + 100, hostAt(t + out), t + out + back + 100);
    }
    if (Math.round(t * 60) % 5 === 0) clock.tick(hostAt(t), t + late() + 100);
    const shown = clock.phase(t + 100);
    if (shown === null) continue;
    assert.ok(shown >= last, 'never back');
    last = shown;
    if (t > 4) worst = Math.max(worst, Math.abs(shown - hostAt(t)));
  }
  assert.ok(worst * period < 0.03, `within 30 ms of the host (${Math.round(worst * period * 1000)} ms)`);
  assert.ok(clock.trip! > 80 && clock.trip! < 150);
});

test('a guest over a slow link: its turns land where it made them, it never goes back or stands still, and it is where the host has it', () => {
  for (const [name, link] of LINKS) {
    for (const seed of [1, 2, 3]) {
      const old = ride('old', link, seed);
      const now = ride('new', link, seed);
      if (process.env.MEASURE) console.log(name, seed, '\n  before', summary(old), '\n  after ', summary(now));
      const late = (r: typeof now) => r.late.filter((n) => n > 0).length;
      // Before: turns landed a step or two after the guest made them, and its cycle stood waiting for ticks.
      assert.ok(late(old) > old.late.length / 2, `${name}: the old guest's turns landed late (${late(old)} of ${old.late.length})`);
      assert.ok(old.stalls > 5, `${name}: the old guest stood still (${old.stalls} frames)`);
      // After.
      assert.ok(now.frames > 200 && now.late.length >= 10, `${name}: rode long enough (${now.frames} frames, ${now.late.length} turns)`);
      assert.equal(late(now), 0, `${name}: every turn landed where the guest made it`);
      assert.equal(now.backward, 0, `${name}: never back`);
      assert.ok(now.stalls <= 1, `${name}: stood still ${now.stalls} frames`);
      assert.ok(mean(now.response) < mean(old.response) / 2, `${name}: turns show sooner (${mean(now.response)} vs ${mean(old.response)} frames)`);
      assert.ok((Math.max(...now.response) - 2) * FRAME_S <= now.delay, `${name}: a turn shows within the input delay (and the frame it was pressed in)`);
      assert.ok(mean(now.error) < 0.2 && mean(now.error) < mean(old.error) / 4, `${name}: where the host has it (${mean(now.error)} vs ${mean(old.error)} cells)`);
      assert.ok(Math.abs(mean(now.clock)) < 0.15, `${name}: on the host's clock (${mean(now.clock)} steps)`);
      assert.equal(now.jumps, 0, `${name}: the host's cycle never jumps`);
      assert.ok(now.delay >= DELAY_MIN && now.delay <= DELAY_MAX);
    }
  }
});

test('a guest sees a bot ride smoothly', () => {
  for (const [name, link] of LINKS.slice(0, 2)) {
    const old = ride('old', link, 5, { bot: true });
    const now = ride('new', link, 5, { bot: true });
    if (process.env.MEASURE) console.log(name, 'with a bot\n  before', summary(old), '\n  after ', summary(now));
    assert.ok(old.jumps > 0);
    assert.equal(now.jumps, 0, `${name}: ${now.jumps} jumps`);
    assert.equal(now.backward, 0);
  }
});

test('a lag spike longer than the input delay lands a turn late, and the guest is put right', () => {
  let lateOld = 0;
  let lateNew = 0;
  for (const seed of [1, 2, 3, 4]) {
    const link = { latency: 60, jitter: 30, loss: 0.1, rto: 200 };
    const old = ride('old', link, seed, { seconds: 6 });
    const now = ride('new', link, seed, { seconds: 6 });
    if (process.env.MEASURE) console.log('10% held 200 ms', seed, '\n  before', summary(old), '\n  after ', summary(now));
    lateOld += old.late.filter((n) => n > 0).length;
    lateNew += now.late.filter((n) => n > 0).length;
    // (each late turn puts the guest's own wall right once or twice: when the host's tick shows it, and when it says where it took it)
    assert.ok(now.backward <= now.late.filter((n) => n > 0).length * 2, `seed ${seed}: ${now.backward} corrections`);
    assert.ok(mean(now.error) < mean(old.error), `seed ${seed}: ${mean(now.error)} vs ${mean(old.error)} cells off`);
  }
  assert.ok(lateNew > 0, 'some turns were held up past the delay');
  assert.ok(lateNew * 4 < lateOld, `late turns ${lateNew} vs ${lateOld}`);
});

test('offline the queue works as it always did: the next step, one turn a step', () => {
  const a = createArena(30, 20, 1, 1);
  const r = a.riders[0];
  const q: Turn[] = [];
  queueTurn(q, r.next, { dir: 0, at: 0 });
  queueTurn(q, 0, { dir: 3, at: 0 });
  const k = a.tick + 1;
  const d = dueTurn(q, r.dir, k);
  if (d !== null) steer(r, d);
  step(a);
  assert.equal(r.dir, 0);
  const e = dueTurn(q, r.dir, a.tick + 1);
  if (e !== null) steer(r, e);
  step(a);
  assert.equal(r.dir, 3);
  assert.equal(q.length, 0);
});
