import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BIOME_ROWS, BIOMES, CAR_HALF_Y, CHICKEN_HALF, COLUMNS, FLOAT_SLACK, FOLLOW, HOP_TIME, IDLE_GRACE,
  IDLE_PUSH, REPEAT_TIME, STEP, TRAFFIC_SPAN, TRAIN_HALF_Y, WARN_TIME,
  biomeAt, createState, extendCourse, floatUnder, laneAt, speedAt, startHop, step, sweptHit,
  type Direction, type Input, type Lane, type State,
} from '../src/os/arcade/games/chicken-crossing/logic.ts';

const idle: Input = { held: null, press: null };

function run(s: State, seconds: number, input = idle) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    step(s, STEP, { ...input, press: i === 0 ? input.press : null });
  }
}

function hop(s: State, direction: Direction) {
  assert.ok(startHop(s, direction));
  run(s, HOP_TIME + STEP);
}

function quiet(s: State) {
  s.lanes.forEach((lane) => {
    lane.kind = 'grass';
    lane.trees = [];
    lane.cars = [];
    lane.floats = [];
    lane.train = null;
    lane.coin = null;
    lane.collected = false;
    lane.speed = 0;
  });
  s.ride = null;
}

function road(s: State, row: number, x: number, speed = 0, width = 1.25): Lane {
  const lane = laneAt(s, row)!;
  lane.kind = 'road';
  lane.speed = speed;
  lane.direction = 1;
  lane.coin = null;
  lane.cars = [{ x, width, color: 0, kind: width > 1.5 ? 'truck' : 'car' }];
  return lane;
}

function openColumns(lane: Lane): number[] {
  return Array.from({ length: COLUMNS }, (_, column) => column).filter((column) => !lane.trees.includes(column));
}

function openSegments(lane: Lane): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let column = 0; column < COLUMNS; column++) {
    if (lane.trees.includes(column)) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(column);
  }
  if (current.length) segments.push(current);
  return segments;
}

type BotAction = Direction | 'wait';

function act(s: State, action: BotAction): void {
  const steps = action === 'wait' ? Math.round(0.1 / STEP) : Math.ceil(HOP_TIME / STEP) + 2;
  for (let i = 0; i < steps && !s.dead; i++) {
    step(s, STEP, { held: null, press: i === 0 && action !== 'wait' ? action : null });
    if (action !== 'wait' && i > 0 && !s.hop) break;
  }
}

function botActions(s: State): BotAction[] {
  const up = laneAt(s, Math.round(s.y) + 1);
  const open = up?.kind === 'grass' ? openColumns(up) : [];
  const toward = open.length && !open.includes(Math.round(s.x))
    ? open.reduce((best, column) => Math.abs(column - s.x) < Math.abs(best - s.x) ? column : best, open[0])
    : s.x < COLUMNS / 2 ? COLUMNS : -1;
  const lateral: Direction[] = toward < s.x ? ['left', 'right'] : ['right', 'left'];
  return ['up', 'wait', ...lateral, 'down'];
}

/** True when some line of real inputs keeps the chicken alive for the next `seconds` (depth-first, memoized). */
function survives(s: State, seconds: number, budget = 400): boolean {
  const until = s.time + seconds;
  const seen = new Set<string>();
  let expanded = 0;
  const visit = (state: State): boolean => {
    if (state.time >= until) return true;
    if (expanded++ > budget) return false;
    for (const action of botActions(state)) {
      const trial = structuredClone(state);
      act(trial, action);
      if (trial.dead) continue;
      const key = `${Math.round(trial.x * 4)},${trial.y},${Math.round(trial.time * 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (visit(trial)) return true;
    }
    return false;
  };
  return visit(s);
}

/** Breadth-first search over real inputs in space and time: the first action of a surviving line that gains a row. */
function plan(s: State, goal: number, budget = 2500): BotAction | null {
  const seen = new Set<string>();
  let checks = 0;
  const queue: { state: State; first: BotAction | null }[] = [{ state: s, first: null }];
  for (let head = 0; head < queue.length && head < budget; head++) {
    const { state, first } = queue[head];
    for (const action of botActions(state)) {
      const trial = structuredClone(state);
      act(trial, action);
      if (trial.dead) continue;
      const key = `${Math.round(trial.x * 4)},${trial.y},${Math.round(trial.time * 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (trial.maxRow >= goal) {
        if (checks++ < 12 && survives(trial, 1.2)) return first ?? action;
        continue;
      }
      queue.push({ state: trial, first: first ?? action });
    }
  }
  return null;
}

function autoplay(seed: number): State {
  const s = createState(seed);
  let decisions = 0;
  while (s.maxRow < 200 && !s.dead && decisions < 6000) {
    const chosen = plan(s, s.maxRow + 1) ?? botActions(s).find((action) => {
      const trial = structuredClone(s);
      act(trial, action);
      return !trial.dead && survives(trial, 1.2);
    }) ?? null;
    assert.notEqual(chosen, null, `seed ${seed}: no surviving line at row ${s.y} (max ${s.maxRow})`);
    act(s, chosen!);
    decisions++;
  }
  assert.equal(s.dead, false, `seed ${seed} died at row ${s.y} (max ${s.maxRow}, scroll ${s.scroll})`);
  assert.ok(s.maxRow >= 200, `seed ${seed} only reached ${s.maxRow}`);
  assert.ok(s.scroll >= s.y - FOLLOW - 1e-8);
  return s;
}

test('the course is deterministic per seed and different seeds vary the generated world', () => {
  assert.deepEqual(createState(42), createState(42));
  assert.notDeepEqual(createState(42).lanes, createState(7).lanes);
});

test('the start is fair and the kill line remains idle before the first hop', () => {
  const s = createState(2);
  assert.deepEqual(s.lanes.slice(0, 3).map((lane) => lane.kind), ['grass', 'grass', 'grass']);
  assert.equal(s.x, Math.floor(COLUMNS / 2));
  assert.equal(s.y, 0);
  for (const lane of s.lanes.slice(0, 3)) {
    assert.equal(lane.coin, null);
    assert.ok(lane.trees.every((column) => [0, 1, 7, 8].includes(column)));
    assert.ok([3, 4, 5].every((column) => !lane.trees.includes(column)));
  }
  assert.equal(s.lanes[3].kind, 'road');
  assert.equal(s.lanes[3].row, 3);
  assert.ok(s.lanes.filter((lane) => lane.row < 8).every((lane) => lane.kind !== 'river'));
  assert.ok(s.lanes.filter((lane) => lane.row < 12).every((lane) => lane.kind !== 'rail'));
  run(s, 90);
  assert.equal(s.dead, false);
  assert.equal(s.started, false);
  assert.equal(s.scroll, -2);
  assert.equal(s.idle, 0);
  assert.equal(s.score, 0);
});

test('four-way hops land on cells and cannot leave the board or go behind the retreat limit', () => {
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

test('a tap during a hop queues exactly one move', () => {
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

test('held direction repeats at the configured cadence and releasing stops repeats', () => {
  const s = createState(1);
  quiet(s);
  run(s, REPEAT_TIME * 2 + HOP_TIME + 0.03, { held: 'up', press: 'up' });
  assert.equal(s.y, 3);
  run(s, 0.3);
  assert.equal(s.y, 3);
});

test('score is max row plus coin bonuses and coins cannot be farmed by backtracking', () => {
  const s = createState(1);
  quiet(s);
  laneAt(s, 1)!.coin = 4;
  hop(s, 'up');
  assert.equal(s.score, 4);
  assert.equal(s.coins, 1);
  hop(s, 'down');
  hop(s, 'up');
  hop(s, 'left');
  hop(s, 'right');
  assert.equal(s.score, 4);
  assert.equal(s.coins, 1);
  assert.equal(laneAt(s, 1)!.collected, true);
});

test('the generator preserves band lengths, passable grass, safe road gaps, and biome content', () => {
  const biomeSeen = new Set<string>();
  const kindsSeen = new Set<string>();
  const carKindsSeen = new Set<string>();
  for (const seed of [1, 2, 3, 7, 42, 99]) {
    const s = createState(seed);
    extendCourse(s, 1500);
    const grass = s.lanes.filter((lane) => lane.kind === 'grass');
    for (let i = 0; i < grass.length; i++) {
      const lane = grass[i];
      const open = openColumns(lane);
      assert.ok(open.length >= 4, `seed ${seed}, row ${lane.row} has only ${open.length} open columns`);
      if (laneAt(s, lane.row - 1)?.kind === 'river') assert.ok(open.length >= 6);
      if (i + 1 < grass.length) {
        const nextOpen = new Set(openColumns(grass[i + 1]));
        for (const segment of openSegments(lane)) {
          assert.ok(segment.some((column) => nextOpen.has(column)), `seed ${seed}: grass rows ${lane.row}/${grass[i + 1].row} block segment ${segment}`);
        }
      }
    }
    let currentKind: string | null = null;
    let bandLength = 0;
    for (const lane of s.lanes) {
      biomeSeen.add(lane.biome);
      kindsSeen.add(lane.kind);
      if (lane.kind === currentKind && lane.kind !== 'grass') bandLength++;
      else {
        currentKind = lane.kind;
        bandLength = lane.kind === 'grass' ? 0 : 1;
      }
      if (lane.kind === 'road') assert.ok(bandLength <= 5);
      if (lane.kind === 'river') assert.ok(bandLength <= 4);
      if (lane.kind === 'rail') assert.ok(bandLength <= 2);
      if (lane.kind === 'grass') {
        assert.equal(lane.cars.length, 0);
        assert.equal(lane.floats.length, 0);
        assert.equal(lane.train, null);
        if (lane.coin !== null) assert.ok(!lane.trees.includes(lane.coin), `coin is under a tree at ${lane.row}`);
      } else if (lane.kind === 'road') {
        assert.equal(lane.floats.length, 0);
        assert.equal(lane.train, null);
        if (lane.coin !== null) assert.ok(lane.coin >= 0 && lane.coin < COLUMNS);
        if (lane.cars.length) {
          const sorted = [...lane.cars].sort((a, b) => a.x - b.x);
          for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            const b = sorted[(i + 1) % sorted.length];
            const centerGap = sorted.length === 1 ? TRAFFIC_SPAN : (b.x - a.x + TRAFFIC_SPAN) % TRAFFIC_SPAN;
            const gap = centerGap - (a.width + b.width) / 2;
            assert.ok(gap > lane.speed * HOP_TIME + 2 * CHICKEN_HALF + 0.5, `seed ${seed}, row ${lane.row}: road gap ${gap}`);
          }
          for (const car of lane.cars) {
            assert.ok(car.x >= -4 && car.x < COLUMNS + 4);
            assert.ok(car.color >= 0 && car.color <= 4);
            carKindsSeen.add(car.kind);
          }
        }
      } else if (lane.kind === 'river') {
        assert.equal(lane.cars.length, 0);
        assert.equal(lane.train, null);
        assert.equal(lane.coin, null);
        assert.ok(lane.speed > 0);
        const sorted = [...lane.floats].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sorted.length; i++) {
          const a = sorted[i];
          const b = sorted[(i + 1) % sorted.length];
          const centerGap = (b.x - a.x + TRAFFIC_SPAN) % TRAFFIC_SPAN;
          const gap = centerGap - (a.width + b.width) / 2;
          const min = a.kind === 'log' ? 1 : 0.6;
          const max = a.kind === 'log' ? 2.2 : 1.6;
          assert.ok(gap >= min - 1e-8 && gap <= max + 1e-8, `seed ${seed}, row ${lane.row}: float gap ${gap}`);
          assert.ok(gap > 0, `seed ${seed}, row ${lane.row}: floats overlap`);
          assert.equal(a.kind, b.kind);
          assert.ok(a.x >= -4 && a.x < COLUMNS + 4);
        }
        const previousRiver = laneAt(s, lane.row - 1);
        if (previousRiver?.kind === 'river') assert.notEqual(lane.direction, previousRiver.direction);
      } else {
        assert.equal(lane.cars.length, 0);
        assert.equal(lane.floats.length, 0);
        assert.equal(lane.coin, null);
        assert.ok(lane.train);
        assert.ok(lane.train!.speed >= 18 && lane.train!.speed < 24);
        assert.ok(lane.train!.length >= 6 && lane.train!.length <= 10);
      }
    }
    assert.ok(s.lanes.filter((lane) => lane.kind === 'road').every((lane) => lane.coin === null || lane.coin >= 0 && lane.coin < COLUMNS));
  }
  assert.deepEqual([...biomeSeen], BIOMES);
  assert.deepEqual([...kindsSeen].sort(), ['grass', 'rail', 'river', 'road']);
  assert.deepEqual([...carKindsSeen].sort(), ['car', 'racer', 'truck']);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => biomeAt(index * BIOME_ROWS)), BIOMES);
});

test('traffic speed ramps and stays within the base and racer caps', () => {
  assert.ok(speedAt(12) > speedAt(2));
  assert.equal(speedAt(10_000), 4.1);
  const s = createState(22);
  extendCourse(s, 1000);
  const roads = s.lanes.filter((lane) => lane.kind === 'road');
  assert.ok(roads.every((lane) => lane.speed <= 4.1));
  assert.ok(roads.some((lane) => lane.direction === -1) && roads.some((lane) => lane.direction === 1));
  assert.ok(roads.some((lane) => lane.cars.some((car) => car.kind === 'truck')));
});

test('mixed traffic maintains safe gaps while vehicles move at different speeds', () => {
  const s = createState(22);
  extendCourse(s, 200);
  run(s, 20);
  const roads = s.lanes.filter((lane) => lane.kind === 'road');
  assert.ok(roads.some((lane) => new Set(lane.cars.map((car) => car.kind)).size > 1));
  for (const lane of roads) {
    const sorted = [...lane.cars].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      const centerGap = sorted.length === 1 ? TRAFFIC_SPAN : (b.x - a.x + TRAFFIC_SPAN) % TRAFFIC_SPAN;
      const gap = centerGap - (a.width + b.width) / 2;
      const fastest = Math.max(
        lane.speed,
        ...lane.cars.map((car) => lane.speed * (car.kind === 'truck' ? 0.65 : car.kind === 'racer' ? Math.min(1.5, 5.5 / lane.speed) : 1)),
      );
      assert.ok(gap > fastest * HOP_TIME + 2 * CHICKEN_HALF + 0.5, `row ${lane.row}: traffic gap ${gap}`);
    }
  }
});

test('collision uses the forgiving car body and ignores wingtip and vertical near misses', () => {
  const half = 1.25 / 2 - 0.08 + CHICKEN_HALF;
  assert.equal(sweptHit(half + 0.01, 0, half + 0.01, 0, half, CAR_HALF_Y + CHICKEN_HALF), false);
  assert.equal(sweptHit(half - 0.01, 0, half - 0.01, 0, half, CAR_HALF_Y + CHICKEN_HALF), true);
  assert.equal(sweptHit(-half + 0.01, 0, -half + 0.01, 0, half, CAR_HALF_Y + CHICKEN_HALF), true);
  assert.equal(sweptHit(0, 0.45, 0, 0.45, half, CAR_HALF_Y + CHICKEN_HALF), false);
  assert.equal(sweptHit(0, 0.43, 0, 0.43, half, CAR_HALF_Y + CHICKEN_HALF), true);
});

test('swept collision detects fast traffic and a road hit is attributed to a car', () => {
  assert.equal(sweptHit(-3, 0, 3, 0, 0.7, 0.44), true);
  assert.equal(sweptHit(-3, 0.45, 3, 0.45, 0.7, 0.44), false);
  const s = createState(1);
  quiet(s);
  s.y = 2;
  road(s, 2, 2, 40);
  const ev = step(s, 0.1);
  assert.equal(ev.crashed, true);
  assert.equal(s.dead, true);
  assert.equal(s.death, 'car');
});

test('entering an occupied road collides during the hop, not only on landing', () => {
  const s = createState(1);
  quiet(s);
  road(s, 2, 4);
  hop(s, 'up');
  assert.equal(startHop(s, 'up'), true);
  run(s, 0.1);
  assert.equal(s.dead, true);
  assert.ok(s.y > 1 && s.y < 2);
  assert.equal(s.score, 1);
});

test('traffic on neighboring lanes cannot hit grass and wrapping stays local', () => {
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
  s.y = 2;
  road(s, 2, COLUMNS + 4 - 0.01, 4);
  run(s, 0.1);
  assert.equal(s.dead, false);
  assert.ok(laneAt(s, 2)!.cars[0].x < -3);
});

test('crashes freeze state and zero elapsed time cannot consume queued input', () => {
  const s = createState(1);
  quiet(s);
  s.y = 2;
  road(s, 2, 4);
  assert.equal(step(s, 0.05).crashed, true);
  const snapshot = structuredClone(s);
  assert.equal(step(s, 0.05, { held: 'up', press: 'up' }).crashed, false);
  assert.deepEqual(s, snapshot);
  assert.equal(startHop(s, 'up'), false);
  const fresh = createState(7);
  const original = structuredClone(fresh);
  step(fresh, 0, { held: 'up', press: 'up' });
  assert.deepEqual(fresh, original);
});

test('restart creates a clean round with no carried score, death, or queued input', () => {
  const s = createState(42);
  quiet(s);
  hop(s, 'up');
  s.dead = true;
  s.queued = 'right';
  s.coins = 3;
  const restarted = createState(42);
  assert.deepEqual([restarted.score, restarted.coins, restarted.maxRow], [0, 0, 0]);
  assert.equal(restarted.dead, false);
  assert.equal(restarted.queued, null);
  assert.equal(restarted.hop, null);
  assert.deepEqual(restarted, createState(42));
});

test('long runs extend the world while keeping memory bounded and the retreat area visible', () => {
  const s = createState(11);
  for (let i = 0; i < 300; i++) {
    quiet(s);
    hop(s, 'up');
    assert.equal(s.dead, false);
    assert.ok(s.lanes.length <= 45);
    assert.ok(s.lanes.at(-1)!.row >= s.maxRow + 20);
  }
  assert.equal(s.maxRow, 300);
  hop(s, 'down');
  hop(s, 'down');
  hop(s, 'down');
  assert.equal(startHop(s, 'down'), false);
  assert.equal(s.y, 297);
  assert.ok(s.lanes.some((lane) => lane.row === 297));
});

test('fixed steps match movement and traffic at 30, 60, and 120 fps', () => {
  const samples = [30, 60, 120].map((fps) => {
    const s = createState(9);
    quiet(s);
    const roadLane = road(s, 15, 4, 1);
    const firstCar = roadLane.cars[0];
    for (let i = 0; i < fps * 2; i++) step(s, 1 / fps, { held: 'left', press: i === 0 ? 'left' : null });
    return { s, x: firstCar.x };
  });
  for (const { s } of samples) assert.equal(s.x, 0);
  for (const { s, x } of samples) {
    assert.ok(Math.abs(s.time - 2) < 0.01);
    assert.ok(Math.abs(x - samples[0].x) < 0.04);
  }
});

test('long frame stalls are clamped rather than teleporting the chicken or traffic', () => {
  const s = createState(1);
  step(s, 10, { held: 'up', press: 'up' });
  assert.ok(s.y < 1);
  assert.ok(s.time <= 0.1 + 1e-9);
  assert.equal(s.score, 0);
});

test('river landings attach to logs, move with them, and snap to a slot', () => {
  const s = createState(4);
  quiet(s);
  const river = laneAt(s, 1)!;
  river.kind = 'river';
  river.direction = 1;
  river.speed = 1;
  river.floats = [{ x: 4, width: 3, kind: 'log' }];
  assert.equal(startHop(s, 'up'), true);
  let landed = false;
  for (let i = 0; i < 30 && !landed; i++) landed = step(s, STEP).landed;
  assert.equal(landed, true);
  assert.equal(s.ride, 0);
  assert.ok(Math.abs(s.x - river.floats[0].x) <= 0.01);
  const before = s.x;
  run(s, 0.2);
  assert.ok(s.x > before);
  assert.ok(Math.abs(s.x - river.floats[0].x) <= 1);
  assert.equal(floatUnder(river, s.x), 0);
});

test('landing in a river gap splashes and drifting off a float is fatal', () => {
  const s = createState(4);
  quiet(s);
  const river = laneAt(s, 1)!;
  river.kind = 'river';
  river.floats = [{ x: 0, width: 2, kind: 'log' }];
  assert.equal(floatUnder(river, 4), -1);
  assert.equal(startHop(s, 'up'), true);
  let events = { splash: false, crashed: false };
  for (let i = 0; i < 30 && !s.dead; i++) {
    const next = step(s, STEP);
    events = { splash: events.splash || next.splash, crashed: events.crashed || next.crashed };
  }
  assert.equal(s.dead, true);
  assert.equal(s.death, 'water');
  assert.equal(events.splash, true);
  assert.equal(events.crashed, true);

  const drifting = createState(8);
  quiet(drifting);
  const rideLane = laneAt(drifting, 1)!;
  rideLane.kind = 'river';
  rideLane.direction = 1;
  rideLane.speed = 10;
  rideLane.floats = [{ x: 4, width: 3, kind: 'log' }];
  drifting.y = 1;
  drifting.ride = 0;
  let driftCrashed = false;
  for (let i = 0; i < 60 && !drifting.dead; i++) driftCrashed ||= step(drifting, STEP).crashed;
  assert.equal(drifting.dead, true);
  assert.equal(drifting.death, 'drift');
  assert.equal(driftCrashed, true);
});

test('hopping from a log to grass snaps to a column and a tree press is blocked', () => {
  const s = createState(4);
  quiet(s);
  const river = laneAt(s, 1)!;
  river.kind = 'river';
  river.direction = 1;
  river.speed = 1;
  river.floats = [{ x: 4, width: 3, kind: 'log' }];
  s.y = 1;
  s.x = 4.4;
  s.ride = 0;
  hop(s, 'up');
  assert.equal(Number.isInteger(s.x), true);
  assert.equal(s.y, 2);

  const blocked = createState(5);
  quiet(blocked);
  laneAt(blocked, 1)!.trees = [4];
  const ev = step(blocked, 0.02, { held: null, press: 'up' });
  assert.equal(ev.blocked, true);
  assert.equal(blocked.hop, null);
  assert.equal(blocked.facing, 'up');
  assert.equal(startHop(blocked, 'up'), false);
});

test('trains warn before entering, ring once per cycle when nearby, and hit only rail rows', () => {
  const s = createState(10);
  quiet(s);
  const rail = laneAt(s, 1)!;
  rail.kind = 'rail';
  rail.direction = 1;
  rail.train = { x: -5, length: 6, speed: 20, wait: WARN_TIME + 0.01, warning: false, running: false, cycle: 0 };
  s.y = 1;
  const warning = step(s, 0.02);
  assert.equal(warning.bell, true);
  assert.equal(rail.train.warning, true);
  assert.equal(rail.train.running, false);
  run(s, 1);
  assert.equal(rail.train.running, false);
  assert.equal(s.dead, false);
  run(s, 0.7);
  assert.equal(rail.train.running, true);
  run(s, 1);
  assert.equal(s.dead, true);
  assert.equal(s.death, 'train');

  const grass = createState(11);
  quiet(grass);
  const passing = laneAt(grass, 1)!;
  passing.kind = 'rail';
  passing.direction = 1;
  passing.train = { x: -3, length: 6, speed: 20, wait: 0, warning: false, running: true, cycle: 0 };
  run(grass, 1);
  assert.equal(grass.dead, false);
  assert.ok(TRAIN_HALF_Y > CAR_HALF_Y);
});

test('the kill line idles, accelerates after grace, resets on progress, and enforces follow distance', () => {
  const s = createState(6);
  quiet(s);
  run(s, 4);
  assert.equal(s.scroll, -2);
  hop(s, 'up');
  assert.ok(s.started);
  run(s, IDLE_GRACE - 0.5);
  const beforePush = s.scroll;
  const idleBefore = s.idle;
  run(s, 1);
  assert.ok(s.idle > IDLE_GRACE);
  assert.ok(s.scroll - beforePush > 0.3);
  hop(s, 'up');
  assert.ok(s.idle < 0.02);
  assert.ok(s.scroll >= s.y - FOLLOW - 1e-8);
  let hawkCrashed = false;
  for (let i = 0; i < 30 / STEP && !s.dead; i++) hawkCrashed ||= step(s, STEP).crashed;
  assert.equal(s.dead, true);
  assert.equal(s.death, 'hawk');
  assert.equal(hawkCrashed, true);
  assert.ok(idleBefore > 0);
});

test('coins collect once, award three points, and emit their event only once', () => {
  const s = createState(1);
  quiet(s);
  laneAt(s, 1)!.coin = 4;
  assert.equal(step(s, STEP, { held: null, press: 'up' }).hopped, true);
  let collected = false;
  for (let i = 0; i < 30 && !collected; i++) collected ||= step(s, STEP, idle).collected;
  assert.equal(collected, true);
  assert.equal(s.coins, 1);
  assert.equal(s.score, 4);
  hop(s, 'down');
  hop(s, 'up');
  assert.equal(s.coins, 1);
  assert.equal(s.score, 4);
  assert.equal(laneAt(s, 1)!.collected, true);
});

test('biome and milestone events fire when a landing raises the best row', () => {
  const s = createState(21);
  quiet(s);
  extendCourse(s, BIOME_ROWS + 10);
  s.y = BIOME_ROWS - 1;
  s.maxRow = BIOME_ROWS - 1;
  const target = laneAt(s, BIOME_ROWS)!;
  target.kind = 'grass';
  target.trees = [];
  step(s, STEP, { held: null, press: 'up' });
  let landedBiome = false;
  for (let i = 0; i < 30 && !landedBiome; i++) landedBiome ||= step(s, STEP).biome;
  assert.ok(s.maxRow >= BIOME_ROWS);
  assert.equal(biomeAt(s.maxRow), 'orchard');
  assert.equal(landedBiome, true);
});

test('autoplay reaches row 200 on six seeds using real inputs against the live kill line', () => {
  for (const seed of [1, 2, 3, 7, 42, 99]) autoplay(seed);
});

test('two simulations with identical inputs remain identical, including train cycles', () => {
  const a = createState(123);
  const b = createState(123);
  extendCourse(a, 100);
  extendCourse(b, 100);
  for (let i = 0; i < 40 * 120; i++) {
    const input: Input = idle;
    step(a, STEP, input);
    step(b, STEP, input);
  }
  assert.deepEqual(a, b);
  assert.ok(a.lanes.some((lane) => lane.train && lane.train.cycle > 0));
});
