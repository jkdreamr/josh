import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alive, createArena, departedSeats, fitGrid, frameUnit, lookahead, reachable, riderSeats, roundOver, steer, step, swipeDir, tapDir, territory, think, type Dir, type Level } from '../src/os/arcade/games/lightcycles/cycles.ts';

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
  // Wall straight ahead, with a five cell pocket above and open space below.
  for (let y = 0; y < 11; y++) a.cells[y * a.w + 11] = 9;
  for (let y = 0; y < 5; y++) a.cells[y * a.w + 9] = 9;
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

test('online riders follow the seats in the room, people and bots alike', () => {
  assert.deepEqual(riderSeats([0, 2], [1, 3]), [0, 1, 2, 3]);
  assert.deepEqual(riderSeats([0, 3], [1]), [0, 1, 3], 'a seat someone left stays empty');
  assert.deepEqual(riderSeats([0, 1], [1, 2]), [0, 1, 2], 'each seat rides once');
  assert.deepEqual(riderSeats([0, 1, 2, 3, 4], []), [0, 1, 2, 3], 'four riders at most');
});

/** Rides a whole round between computer riders; returns the winner's id, or -1 for a draw. */
function duel(levels: Level[], w: number, h: number, seed: number) {
  let s = seed;
  const rng = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const a = createArena(w, h, levels.length, 0);
  for (let t = 0; alive(a).length > 1 && t < 4000; t++) {
    for (const r of a.riders) if (r.alive) steer(r, think(a, r, levels[r.id], rng));
    step(a);
  }
  const left = alive(a);
  return left.length === 1 ? left[0].id : -1;
}

test('the levels are ordered: hard beats normal, normal beats easy', () => {
  const score = (levels: Level[]) => {
    let won = 0;
    let lost = 0;
    for (const [w, h] of [[44, 26], [30, 38]] as const) {
      for (let i = 1; i <= 12; i++) {
        // Both seats, so the start side does not decide it.
        const p = duel(levels, w, h, i * 7919);
        const q = duel([levels[1], levels[0]], w, h, i * 7919);
        won += (p === 0 ? 1 : 0) + (q === 1 ? 1 : 0);
        lost += (p === 1 ? 1 : 0) + (q === 0 ? 1 : 0);
      }
    }
    return { won, lost };
  };
  const hard = score([2, 1]);
  assert.ok(hard.won > hard.lost * 1.5, `hard ${hard.won} to ${hard.lost} against normal`);
  const normal = score([1, 0]);
  assert.ok(normal.won > normal.lost * 1.5, `normal ${normal.won} to ${normal.lost} against easy`);
});

test('a hard rider thinks fast enough for four riders on a big arena', () => {
  const a = createArena(84, 14, 4, 0);
  const t0 = performance.now();
  let calls = 0;
  for (let t = 0; t < 40 && alive(a).length > 1; t++) {
    for (const r of a.riders) if (r.alive) (steer(r, think(a, r, 2, () => 0.5)), calls++);
    step(a);
  }
  assert.ok((performance.now() - t0) / calls < 8, 'under 8 ms a move');
});

test('territory counts the cells a rider reaches first', () => {
  const a = createArena(20, 9, 2, 0);
  const [p] = a.riders;
  const t = territory(a, p, p.x + 1, p.y);
  assert.equal(t.shared, true);
  assert.ok(t.myRoom > 100);
  assert.ok(Math.abs(t.value) < 40, 'a mirrored start splits about evenly');
  assert.equal(a.cells[p.y * a.w + p.x], 1, 'the board is left as it was');
});

test('the grid fills the box with square cells, from a thin strip to a tall phone', () => {
  for (const [w, h] of [[448, 93], [990, 490], [374, 640], [600, 600]] as const) {
    const g = fitGrid(w, h);
    const cell = Math.min(w / g.cols, h / g.rows);
    assert.ok((cell * g.cols * cell * g.rows) / (w * h) > 0.8, `${w}x${h} arena fills most of the box`);
    assert.ok(g.cols * g.rows > 700 && g.cols * g.rows < 1500, `${w}x${h} has a sensible cell count`);
  }
});

test('a tap turns toward it, across the heading only', () => {
  assert.equal(tapDir(1, 50, -40), 0);
  assert.equal(tapDir(1, -50, 30), 2);
  assert.equal(tapDir(3, 0, 2), null, 'in line with the heading');
  assert.equal(tapDir(0, -30, 80), 3);
  assert.equal(tapDir(2, 30, -80), 1);
});

test('frame unit undoes a phone or iPad frame scale and rounds up', () => {
  assert.equal(frameUnit(820, 820), 1);
  assert.equal(frameUnit(0, 820), 1);
  assert.ok(frameUnit(670.35, 820) * (670.35 / 820) >= 1);
  assert.equal(frameUnit(400, 1000), 2);
});

test('online: a rider whose player left is announced once, never bots, yourself or the host', () => {
  const known = new Map([[0, 'Host'], [1, 'Ana'], [2, 'Ben']]);
  assert.deepEqual(departedSeats([0, 1, 2, 3], 0, known, new Set(), [0, 1, 2], [3]), [], 'everyone still here');
  assert.deepEqual(departedSeats([0, 1, 2, 3], 0, known, new Set(), [0, 2], [3]), [1]);
  assert.deepEqual(departedSeats([0, 1, 2, 3], 0, known, new Set([1]), [0, 2], [3]), [], 'already announced');
  assert.deepEqual(departedSeats([0, 1, 2, 3], 0, known, new Set(), [0], []), [1, 2], 'bots never seen as people are not announced');
  assert.deepEqual(departedSeats([0, 1, 2], 2, known, new Set(), [2], []), [1], 'a guest sees others leave, not the host');
});
