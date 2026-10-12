import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHICKEN_HALF, COLUMNS, HOP_TIME, REPEAT_TIME, TRAFFIC_SPAN,
  createState, extendCourse, roadsInGroup, speedAt, startHop, step, sweptHit,
  type Direction, type Input, type Lane, type State,
} from '../src/os/arcade/games/chicken-crossing/logic.ts';

const idle: Input = { held: null, press: null };
function run(s: State, seconds: number, input = idle) {
  for (let i = 0; i < Math.round(seconds * 120); i++) step(s, 1 / 120, { ...input, press: i === 0 ? input.press : null });
}
function hop(s: State, direction: Direction) {
  assert.ok(startHop(s, direction));
  run(s, HOP_TIME + 1 / 120);
}
function quiet(s: State) {
  s.lanes.forEach((l) => { l.cars = []; });
}
function road(s: State, row: number, x: number, speed = 0, width = 1.25): Lane {
  const lane = s.lanes.find((l) => l.row === row)!;
  lane.kind = 'road';
  lane.speed = speed;
  lane.direction = 1;
  lane.corn = null;
  lane.cars = [{ x, width, color: 0, truck: width > 1.5 }];
  return lane;
}

test('the course is deterministic per seed and different seeds vary traffic', () => {
  assert.deepEqual(createState(42), createState(42));
  assert.notDeepEqual(createState(42).lanes, createState(7).lanes);
});

test('the chicken starts centered in two safe rows, with no time pressure or free score', () => {
  const s = createState(2);
  assert.equal(s.x, Math.floor(COLUMNS / 2));
  assert.equal(s.y, 0);
  assert.ok(s.lanes.slice(0, 2).every((l) => l.kind === 'grass' && !l.cars.length && l.corn === null));
  run(s, 90);
  assert.equal(s.dead, false);
  assert.equal(s.score, 0);
  assert.ok(s.lanes.some((l) => l.cars.length && l.cars[0].x !== createState(2).lanes[l.row]?.cars[0]?.x));
});

test('four-way hops land on whole cells and cannot leave the board or go behind the start', () => {
  const s = createState(2);
  quiet(s);
  assert.equal(startHop(s, 'down'), false);
  hop(s, 'up');
  hop(s, 'left');
  hop(s, 'right');
  hop(s, 'down');
  assert.deepEqual([s.x, s.y, s.score], [4, 0, 1]);
  s.x = 0;
  assert.equal(startHop(s, 'left'), false);
  s.x = COLUMNS - 1;
  assert.equal(startHop(s, 'right'), false);
});

test('a tap during a hop queues one move without skipping lanes', () => {
  const s = createState(1);
  quiet(s);
  step(s, 0.05, { held: null, press: 'up' });
  step(s, 0.05, { held: null, press: 'left' });
  assert.ok(s.y > 0 && s.y < 1);
  assert.equal(s.x, 4);
  run(s, 0.3);
  assert.deepEqual([s.x, s.y], [3, 1]);
  assert.equal(s.hop, null);
});

test('held direction repeats at a deliberate cadence and releasing stops repeat', () => {
  const s = createState(1);
  quiet(s);
  run(s, REPEAT_TIME * 2 + HOP_TIME + 0.03, { held: 'up', press: 'up' });
  assert.equal(s.y, 3);
  run(s, 0.3);
  assert.equal(s.y, 3);
});

test('score is furthest row plus corn bonuses, never farmable by backtracking', () => {
  const s = createState(1);
  quiet(s);
  s.lanes[1].corn = 4;
  hop(s, 'up');
  assert.equal(s.score, 4);
  assert.equal(s.corn, 1);
  hop(s, 'down');
  hop(s, 'up');
  hop(s, 'left');
  hop(s, 'right');
  assert.equal(s.score, 4);
  assert.equal(s.corn, 1);
  assert.equal(s.lanes[1].collected, true);
});

test('traffic ramps in speed and lane count, stays capped, and always leaves medians', () => {
  assert.ok(speedAt(12) > speedAt(2));
  assert.equal(speedAt(10_000), 4.1);
  assert.equal(roadsInGroup(0, 1), 1);
  const counts = new Set<number>();
  for (const seed of [1, 2, 7, 42, 180]) {
    const s = createState(seed);
    extendCourse(s, 1000);
    let consecutive = 0;
    for (const l of s.lanes) {
      consecutive = l.kind === 'road' ? consecutive + 1 : 0;
      assert.ok(consecutive <= 4, `row ${l.row} has too many consecutive roads`);
      assert.ok(l.speed <= 4.1);
      assert.equal(l.kind === 'grass' ? l.cars.length : 0, 0);
      if (l.cars.length) {
        const sorted = [...l.cars].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sorted.length; i++) {
          const a = sorted[i];
          const b = sorted[(i + 1) % sorted.length];
          const gap = ((b.x - a.x + TRAFFIC_SPAN) % TRAFFIC_SPAN) - (a.width + b.width) / 2;
          assert.ok(gap > l.speed * HOP_TIME + CHICKEN_HALF * 2 + 0.5, `row ${l.row} gap ${gap}`);
        }
      }
      counts.add(consecutive);
    }
    assert.ok(s.lanes.some((l) => l.cars.some((c) => c.truck)));
    assert.ok(s.lanes.some((l) => l.direction === -1) && s.lanes.some((l) => l.direction === 1));
  }
  assert.deepEqual([...counts].sort(), [0, 1, 2, 3, 4]);
});

test('collision uses a forgiving body, not wing tips, and detects either side of cars', () => {
  const half = 1.25 / 2 - 0.08 + CHICKEN_HALF;
  assert.equal(sweptHit(half + 0.01, 0, half + 0.01, 0, half, 0.44), false);
  assert.equal(sweptHit(half - 0.01, 0, half - 0.01, 0, half, 0.44), true);
  assert.equal(sweptHit(-half + 0.01, 0, -half + 0.01, 0, half, 0.44), true);
  assert.equal(sweptHit(0, 0.45, 0, 0.45, half, 0.44), false);
  assert.equal(sweptHit(0, 0.43, 0, 0.43, half, 0.44), true);
});

test('swept collision detects fast crossing traffic and does not hit a near miss', () => {
  assert.equal(sweptHit(-3, 0, 3, 0, 0.7, 0.44), true);
  assert.equal(sweptHit(-3, 0.45, 3, 0.45, 0.7, 0.44), false);
  const s = createState(1);
  quiet(s);
  s.y = 2;
  road(s, 2, 2, 40);
  const ev = step(s, 0.1);
  assert.equal(ev.crashed, true);
  assert.equal(s.dead, true);
});

test('entering an occupied road collides during the hop, not only when it lands', () => {
  const s = createState(1);
  quiet(s);
  road(s, 2, 4);
  hop(s, 'up');
  assert.equal(startHop(s, 'up'), true);
  run(s, 0.1);
  assert.equal(s.dead, true);
  assert.ok(s.y > 1 && s.y < 2);
  assert.equal(s.score, 1, 'a crash cannot award an unfinished row');
});

test('a gap really is crossable, and traffic on neighboring lanes cannot hit grass', () => {
  const s = createState(1);
  quiet(s);
  road(s, 2, 0, 1.2);
  hop(s, 'up');
  run(s, 1);
  assert.equal(s.dead, false);
  hop(s, 'up');
  hop(s, 'up');
  assert.equal(s.dead, false);
  assert.equal(s.maxRow, 3);
});

test('wrapping traffic never sweeps invisibly across the whole board', () => {
  const s = createState(1);
  quiet(s);
  s.y = 2;
  road(s, 2, COLUMNS + 4 - 0.01, 4);
  run(s, 0.1);
  assert.equal(s.dead, false);
  assert.ok(s.lanes[2].cars[0].x < -3);
});

test('a crash freezes state and emits game over only once', () => {
  const s = createState(1);
  quiet(s);
  s.y = 2;
  road(s, 2, 4);
  assert.equal(step(s, 0.05).crashed, true);
  const snapshot = structuredClone(s);
  assert.equal(step(s, 0.05, { held: 'up', press: 'up' }).crashed, false);
  assert.deepEqual(s, snapshot);
  assert.equal(startHop(s, 'up'), false);
});

test('zero elapsed time cannot move traffic, hop, score, or consume a move', () => {
  const s = createState(7);
  const snapshot = structuredClone(s);
  step(s, 0, { held: 'up', press: 'up' });
  assert.deepEqual(s, snapshot);
});

test('restart creates a clean round with no carried score, death, or queued input', () => {
  const s = createState(42);
  quiet(s);
  hop(s, 'up');
  s.dead = true;
  s.queued = 'right';
  s.corn = 3;
  const restarted = createState(42);
  assert.deepEqual([restarted.score, restarted.corn, restarted.maxRow], [0, 0, 0]);
  assert.equal(restarted.dead, false);
  assert.equal(restarted.queued, null);
  assert.equal(restarted.hop, null);
  assert.deepEqual(restarted, createState(42));
});

test('long runs extend the varied world while keeping memory bounded and the retreat area visible', () => {
  const s = createState(11);
  for (let i = 0; i < 300; i++) {
    quiet(s);
    hop(s, 'up');
    assert.equal(s.dead, false);
    assert.ok(s.lanes.length <= 31);
    assert.ok(s.lanes.at(-1)!.row >= s.maxRow + 20);
  }
  assert.equal(s.maxRow, 300);
  hop(s, 'down');
  hop(s, 'down');
  hop(s, 'down');
  assert.equal(startHop(s, 'down'), false);
  assert.equal(s.y, 297);
  assert.ok(s.lanes.some((l) => l.row === 297));
});

test('fixed steps give matching movement and traffic at 30, 60 and 120 fps', () => {
  const samples = [30, 60, 120].map((fps) => {
    const s = createState(9);
    for (let i = 0; i < fps * 2; i++) step(s, 1 / fps, { held: 'left', press: i === 0 ? 'left' : null });
    return s;
  });
  for (const s of samples) {
    assert.equal(s.x, 0);
    assert.ok(Math.abs(s.time - 2) < 0.01);
    assert.ok(Math.abs(s.lanes[2].cars[0].x - samples[0].lanes[2].cars[0].x) < 0.04);
  }
});

test('one-second stalls are bounded rather than teleporting the chicken or traffic', () => {
  const s = createState(1);
  step(s, 10, { held: 'up', press: 'up' });
  assert.ok(s.y < 1);
  assert.ok(s.time <= 0.1 + 1e-9);
  assert.equal(s.score, 0);
});
