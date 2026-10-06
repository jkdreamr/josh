import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alive, createArena, lookahead, reachable, roundOver, steer, step, swipeDir, think, type Dir } from '../src/os/arcade/games/lightcycles/cycles.ts';

test('riders start apart, facing the centre, with their start cells claimed', () => {
  const a = createArena(40, 30, 2, 1);
  assert.equal(a.riders.length, 2);
  assert.equal(a.riders[0].dir, 1);
  assert.equal(a.riders[1].dir, 3);
  assert.equal(a.riders[0].cpu, false);
  assert.equal(a.riders[1].cpu, true);
  assert.equal(a.cells[a.riders[0].y * a.w + a.riders[0].x], 1);
});

test('riders move each tick and leave a trail behind', () => {
  const a = createArena(40, 30, 1, 1);
  const r = a.riders[0];
  const x0 = r.x;
  step(a);
  step(a);
  assert.equal(r.x, x0 + 2);
  assert.equal(r.trail.length, 3);
  assert.equal(a.cells[r.y * a.w + x0], 1);
});

test('steering cannot reverse into the trail, but can turn', () => {
  const a = createArena(40, 30, 1, 1);
  const r = a.riders[0];
  steer(r, 3);
  assert.equal(r.next, 1);
  steer(r, 0);
  assert.equal(r.next, 0);
  step(a);
  assert.equal(r.dir, 0);
});

test('hitting a wall kills the rider and reports the crash cell', () => {
  const a = createArena(10, 10, 1, 1);
  const r = a.riders[0];
  let crashes = step(a);
  while (crashes.length === 0) crashes = step(a);
  assert.equal(r.alive, false);
  assert.deepEqual(crashes[0], { id: 0, x: 10, y: r.y });
  assert.ok(roundOver(a));
});

test('hitting a trail kills, head-on collisions kill both', () => {
  const a = createArena(20, 10, 2, 2);
  const [p, q] = a.riders;
  // p at x=4 heading right, q at x=16 heading left: they meet in the middle.
  let crashes: ReturnType<typeof step> = [];
  for (let i = 0; i < 20 && crashes.length === 0; i++) crashes = step(a);
  assert.equal(crashes.length, 2, 'both riders crash together');
  assert.equal(alive(a).length, 0);
  assert.equal(p.alive, false);
  assert.equal(q.alive, false);

  const b = createArena(20, 10, 2, 2);
  // Rider 1 turns up, runs along, then dives back down into rider 0's trail.
  steer(b.riders[1], 0);
  step(b);
  steer(b.riders[1], 3);
  for (let i = 0; i < 6; i++) step(b);
  steer(b.riders[1], 2);
  const hit = step(b);
  assert.deepEqual(hit.map((k) => k.id), [1]);
  assert.equal(b.riders[0].alive, true);
});

test('reachable and lookahead measure open space', () => {
  const a = createArena(10, 10, 1, 1);
  const r = a.riders[0];
  assert.equal(reachable(a, r.x + 1, r.y, 1000), 99);
  assert.equal(lookahead(a, r.x, r.y, 1), 10 - 1 - r.x);
  assert.equal(lookahead(a, r.x, r.y, 3), r.x);
});

test('computer riders never drive into a wall when a free cell exists', () => {
  const a = createArena(12, 12, 1, 0);
  const r = a.riders[0];
  let seed = 3;
  const rng = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let ticks = 0;
  while (r.alive && ticks < 300) {
    const d = think(a, r, 2, rng);
    steer(r, d);
    step(a);
    ticks++;
  }
  // 144 cells, so a perfect rider lasts up to 143 ticks; a sane one well past 60.
  assert.ok(ticks > 60, `survived only ${ticks} ticks`);
});

test('a hard computer rider prefers the roomier side of a split arena', () => {
  const a = createArena(21, 11, 1, 0);
  const r = a.riders[0];
  r.x = 10;
  r.y = 5;
  r.dir = 1;
  // Wall straight ahead, with a tiny pocket above and open space below.
  for (let y = 0; y < 11; y++) a.cells[y * a.w + 11] = 9;
  for (let x = 0; x < 11; x++) a.cells[3 * a.w + x] = 9;
  const d: Dir = think(a, r, 2, () => 0.5);
  assert.equal(d, 2);
});

test('swipe direction needs a minimum length and follows the dominant axis', () => {
  assert.equal(swipeDir(3, 2), null);
  assert.equal(swipeDir(40, 5), 1);
  assert.equal(swipeDir(-40, 5), 3);
  assert.equal(swipeDir(4, 30), 2);
  assert.equal(swipeDir(4, -30), 0);
});
