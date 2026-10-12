import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AIR_TIME,
  COLS,
  FULL,
  MAX_SPEED,
  MIN_SPEED,
  PERIM,
  ROW_L,
  START_ROWS,
  create,
  gapCap,
  hasTile,
  maskAt,
  maxGapRows,
  mod,
  rowOf,
  score,
  sideOf,
  speedAt,
  step,
  type Input,
  type State,
} from '../src/os/arcade/games/run-3d/logic.ts';

const idle: Input = { dir: 0, jump: false };
const DT = 1 / 60;

/** A careful player: follows the safe path one row ahead and jumps at the last moment before a gap. */
function bot(s: State): Input {
  const row = rowOf(s.dist);
  const ahead = rowOf(s.dist + ROW_L * 0.9);
  const path = s.paths[ahead - s.base];
  const here = mod(s.u, PERIM);
  let diff = path + 0.5 - here;
  diff = mod(diff + PERIM / 2, PERIM) - PERIM / 2;
  const dir = Math.abs(diff) > 0.2 ? (Math.sign(diff) as -1 | 1) : 0;
  const tile = Math.floor(s.u);
  const edge = rowOf(s.dist + 0.75);
  const jump = s.grounded && edge !== row && !hasTile(maskAt(s, edge), tile);
  return { dir, jump };
}

test('speed starts slow, rises with distance and caps', () => {
  assert.equal(speedAt(0), MIN_SPEED);
  assert.ok(speedAt(500) > speedAt(100));
  assert.ok(speedAt(1e7) <= MAX_SPEED);
  assert.ok(speedAt(1e7) > MAX_SPEED - 0.01);
});

test('gaps widen with speed but always fit inside one jump', () => {
  assert.equal(gapCap(0), 1);
  assert.ok(gapCap(4000) > gapCap(0));
  for (let d = 0; d < 20000; d += 50) {
    assert.ok(gapCap(d) <= maxGapRows(d));
    assert.ok(maxGapRows(d) * ROW_L + 1 <= speedAt(d) * AIR_TIME);
  }
});

test('the same seed builds the same tunnel', () => {
  const a = create(42);
  const b = create(42);
  assert.deepEqual(a.rows, b.rows);
  assert.deepEqual(a.paths, b.paths);
  const c = create(43);
  assert.notDeepEqual(a.rows, c.rows);
});

test('the start pad is solid and every row keeps its safe path unless it is a full gap', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = create(seed);
    for (let r = 0; r < START_ROWS; r++) assert.equal(maskAt(s, r), FULL);
    for (let i = 0; i < 4000; i++) step(s, DT, bot(s));
    s.rows.forEach((m, i) => {
      if (m === 0) return;
      const p = s.paths[i];
      for (const t of [p - 1, p, p + 1]) assert.ok(hasTile(m, t), `seed ${seed} row ${s.base + i} misses path tile ${t}`);
    });
  }
});

test('full gaps never exceed what a jump can clear at that speed', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = create(seed);
    let run = 0;
    for (let i = 0; i < 9000 && !s.dead; i++) {
      step(s, DT, bot(s));
    }
    for (let i = 0; i < s.rows.length; i++) {
      if (s.rows[i] === 0) run++;
      else if (run) {
        assert.ok(run <= maxGapRows((s.base + i) * ROW_L), `seed ${seed}: gap of ${run} rows`);
        run = 0;
      }
    }
  }
});

test('the path only moves one tile at a time, never two rows in a row', () => {
  const s = create(7);
  for (let i = 0; i < 6000; i++) step(s, DT, bot(s));
  for (let i = 2; i < s.paths.length; i++) {
    const a = mod(s.paths[i] - s.paths[i - 1] + PERIM / 2, PERIM) - PERIM / 2;
    const b = mod(s.paths[i - 1] - s.paths[i - 2] + PERIM / 2, PERIM) - PERIM / 2;
    assert.ok(Math.abs(a) <= 1);
    assert.ok(!(a !== 0 && b !== 0), 'two shifts back to back');
  }
});

test('a careful player can run every seed for 3 km', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const s = create(seed);
    let turns = 0;
    let jumps = 0;
    while (s.dist < 3000) {
      const ev = step(s, DT, bot(s));
      if (ev.turned) turns++;
      if (ev.jumped) jumps++;
      assert.ok(!s.falling, `seed ${seed} fell at ${Math.floor(s.dist)} m`);
    }
    assert.ok(jumps > 5, 'the tunnel asks for jumps');
    assert.ok(turns > 0, 'the tunnel asks you onto the walls');
  }
});

test('standing still eventually drops you into the void and freezes the score', () => {
  const s = create(3);
  let fellAt = -1;
  for (let i = 0; i < 60 * 120 && !s.dead; i++) {
    const ev = step(s, DT, idle);
    if (ev.fell) fellAt = s.final;
  }
  assert.ok(s.dead);
  assert.ok(fellAt > 0);
  assert.equal(score(s), fellAt);
  const after = s.dist;
  step(s, DT, idle);
  assert.equal(s.dist, after, 'nothing moves after the run ends');
});

test('jumping lifts you off the floor and lands you back', () => {
  const s = create(5);
  const ev = step(s, DT, { dir: 0, jump: true });
  assert.ok(ev.jumped);
  assert.ok(s.h > 0 && !s.grounded);
  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) landed = step(s, DT, idle).landed;
  assert.ok(landed && s.grounded && s.h === 0);
  assert.ok(s.dist > 0);
});

test('a buffered jump fires on landing and you cannot jump twice in the air', () => {
  const s = create(5);
  step(s, DT, { dir: 0, jump: true });
  for (let i = 0; i < 10; i++) assert.ok(!step(s, DT, { dir: 0, jump: true }).jumped, 'no double jump');
  let jumpedAgain = false;
  for (let i = 0; i < 40; i++) {
    const ev = step(s, DT, { dir: 0, jump: i > 20 && i < 24 });
    if (ev.jumped) jumpedAgain = true;
  }
  assert.ok(jumpedAgain);
});

test('walking off a side rotates you onto the next wall', () => {
  const s = create(9);
  const side = sideOf(s.u);
  let turned = false;
  for (let i = 0; i < 40; i++) turned = step(s, DT, { dir: 1, jump: false }).turned || turned;
  assert.ok(turned);
  assert.equal(sideOf(s.u), side + 1);
  assert.ok(s.u > COLS);
  assert.ok(!s.falling);
});
