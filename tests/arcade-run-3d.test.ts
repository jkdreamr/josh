import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CRUMBLE_DELAY,
  LEVEL_COUNT,
  MAX_SPEED,
  MIN_SPEED,
  ROW_L,
  START_ROWS,
  ZONES,
  airTime,
  botInput,
  botMind,
  create,
  endlessTrack,
  finishOrder,
  fullOf,
  gapCap,
  hasBit,
  levelTrack,
  maskAt,
  maxGapRows,
  perimOf,
  raceDetail,
  raceTrack,
  speedAt,
  step,
  zoneAt,
  type Input,
  type State,
} from '../src/os/arcade/games/run-3d/logic.ts';

const idle: Input = { dir: 0, jump: false };
const DT = 1 / 60;

function run(s: State, seconds: number, input: (s: State) => Input = botInput) {
  for (let i = 0; i < seconds / DT && !s.dead && !s.finished; i++) step(s, DT, input(s));
}

test('every zone shape fits a 32 bit row and keeps the floor size sensible', () => {
  for (const z of ZONES) {
    assert.ok(perimOf(z) <= 30, z.name);
    assert.ok(airTime(z) > 0.5, z.name);
  }
  assert.equal(new Set(ZONES.map((z) => z.sides)).size >= 4, true, 'at least four tunnel shapes');
});

test('speed starts slow, rises with distance and caps', () => {
  const t = endlessTrack(1);
  assert.equal(speedAt(t, 0), MIN_SPEED);
  assert.ok(speedAt(t, 500) > speedAt(t, 100));
  assert.ok(speedAt(t, 1e7) <= MAX_SPEED);
});

test('gaps always fit inside one held jump', () => {
  for (const t of [endlessTrack(1), raceTrack(5), levelTrack(0), levelTrack(LEVEL_COUNT - 1)])
    for (let d = 0; d < 12000; d += 50) {
      const z = zoneAt(t, Math.floor(d / ROW_L));
      assert.ok(gapCap(t, d, z) <= maxGapRows(t, d, z));
      assert.ok(maxGapRows(t, d, z) * ROW_L + 1 <= speedAt(t, d) * airTime(z));
    }
});

test('the same seed builds the same tunnel and the start pad is solid', () => {
  const a = create(endlessTrack(42));
  const b = create(endlessTrack(42));
  assert.deepEqual(a.rows, b.rows);
  assert.notDeepEqual(a.rows, create(endlessTrack(43)).rows);
  for (let r = 0; r < START_ROWS; r++) assert.equal(maskAt(a, r), fullOf(ZONES[0]));
});

test('a careful runner clears 4 km of endless tunnel through every zone change', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const s = create(endlessTrack(seed));
    const seen = new Set<number>();
    for (let i = 0; i < 30000 && s.dist < 4000; i++) {
      step(s, DT, botInput(s));
      seen.add(s.zi);
      assert.ok(!s.falling, `seed ${seed} fell at ${Math.floor(s.dist)} m in ${ZONES[s.zi].name}`);
    }
    assert.ok(s.dist >= 4000);
    assert.ok(seen.size >= 6, 'reached every zone');
  }
});

test('every level can be finished and all three cells can be picked up somewhere', () => {
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const s = create(levelTrack(i));
    run(s, 120);
    assert.ok(s.finished, `level ${i + 1} not finished, fell at ${Math.floor(s.dist)} m`);
    assert.equal(s.cells.length, 3, `level ${i + 1} cells`);
  }
});

test('levels get longer, faster and meaner', () => {
  const a = levelTrack(0);
  const b = levelTrack(LEVEL_COUNT - 1);
  assert.ok(b.finish > a.finish);
  assert.ok(speedAt(b, 0) > speedAt(a, 0));
});

test('walking off a floor edge rolls you onto the next wall', () => {
  const s = create(endlessTrack(3));
  const side = s.side;
  let turned = false;
  for (let i = 0; i < 60; i++) turned = step(s, DT, { dir: 1, jump: false }).turned || turned;
  assert.ok(turned);
  assert.equal(s.side, side + 1);
  for (let i = 0; i < 120; i++) step(s, DT, { dir: -1, jump: false });
  assert.ok(s.side < side + 1);
});

test('a tap is a hop and a hold is a full jump', () => {
  const peak = (hold: boolean) => {
    const s = create(endlessTrack(9));
    step(s, DT, { dir: 0, jump: true, hold });
    let top = 0;
    for (let i = 0; i < 40; i++) {
      step(s, DT, { dir: 0, jump: false, hold });
      top = Math.max(top, s.h);
    }
    return top;
  };
  assert.ok(peak(false) < peak(true) * 0.8);
});

test('running into the void ends a solo run but respawns a racer', () => {
  const solo = create(endlessTrack(11));
  solo.rows.fill(0, START_ROWS - solo.base);
  run(solo, 6, () => idle);
  assert.ok(solo.dead);
  const racer = create(raceTrack(11), { respawn: true });
  racer.rows.fill(0, START_ROWS - racer.base + 2, START_ROWS - racer.base + 12);
  let back = false;
  for (let i = 0; i < 400; i++) back = step(racer, DT, idle).respawned || back;
  assert.ok(back);
  assert.ok(!racer.dead);
  assert.ok(racer.respawns >= 1);
});

test('crumbling tiles drop away a moment after you step on them', () => {
  const s = create(levelTrack(12));
  const z = ZONES[s.zi];
  const row = Math.floor(s.dist / ROW_L) + 3;
  const k = row - s.base;
  s.crumb[k] = fullOf(z);
  let dropped = 0;
  for (let i = 0; i < 60; i++) dropped += step(s, DT, idle).dropped.length;
  assert.ok(dropped > 0);
  assert.ok(CRUMBLE_DELAY > ROW_L / speedAt(s.track, 0));
  assert.notEqual(maskAt(s, row), s.rows[k]);
});

test('race courses mix three zones, are seeded and bots with less skill fall now and then', () => {
  const t = raceTrack(77);
  assert.equal(new Set(t.zones).size, 3);
  assert.deepEqual(raceTrack(77), t);
  const ace = create(t, { respawn: true });
  const mind = botMind(1, 1);
  run(ace, 200, (s) => botInput(s, mind));
  assert.ok(ace.finished);
  assert.equal(ace.respawns, 0);
  let falls = 0;
  for (let k = 0; k < 6; k++) {
    const s = create(t, { respawn: true });
    const m = botMind(0.4, k + 2);
    run(s, 200, (x) => botInput(x, m));
    assert.ok(s.finished);
    falls += s.respawns;
  }
  assert.ok(falls > 0);
});

test('the race order and Game Over line name the winner, you and the people here', () => {
  const order = finishOrder([
    { seat: 1, ms: 71200, dist: 840 },
    { seat: 2, ms: -1, dist: 600 },
    { seat: 0, ms: 69800, dist: 840 },
  ]);
  assert.deepEqual(order.map((f) => f.seat), [0, 1, 2]);
  const names = ['Ellie', 'Sam', 'Vega'];
  assert.equal(raceDetail(order, 1, (s) => names[s], ['You', 'Ellie']), 'Ellie won in 1:09.8. You took 1:11.2, 2nd. 2 people here: You and Ellie.');
  assert.equal(raceDetail(order, 0, (s) => names[s], ['You']), 'You won in 1:09.8. Just you here.');
  assert.equal(raceDetail(order, 2, (s) => names[s], ['You', 'Ellie', 'Sam']), 'Ellie won in 1:09.8. You made it 600 m, 3rd. 3 people here: You, Ellie and Sam.');
  assert.ok(hasBit(1, ZONES[0], 0));
});
