import { test } from 'node:test';
import assert from 'node:assert/strict';
import { think } from '../src/os/arcade/games/sumo/ai.ts';
import { CAR_RADIUS, STEP, TARGET, createWorld, matchWinner, roundBanner, step, takeoverDeparted, type Car, type Input, type Level, type World } from '../src/os/arcade/games/sumo/logic.ts';
import { configOf, endOf, hostState, inputOf, parsePacket } from '../src/os/arcade/games/sumo/net.ts';

const entries = (count: number, level: Level | null = null) =>
  Array.from({ length: count }, (_, seat) => ({ seat, color: seat, ai: level, name: `Car ${seat}` }));
const go = (world: World) => {
  world.phase = 'fight';
  world.timer = 0;
};
const idle = (world: World) => world.cars.map((): Input => ({ x: 0, y: 0, dash: false }));
const rng = (seed: number) => {
  let state = seed | 0;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
};
const onPlatform = (car: Car, world: World) => !car.out && !car.falling && Math.hypot(car.x, car.z) <= world.radius + 0.15;
const simulateEightBotMatch = (level: Level, seed: number) => {
  const world = createWorld(entries(8, level), seed);
  const random = rng(seed + 100);
  const roundDurations: number[] = [];
  let roundDraws = 0;
  const lastNear = world.cars.map(() => -Infinity);
  const maxSteps = 600 * 60;
  for (let t = 0; t < maxSteps && matchWinner(world) === null; t++) {
    const updateNearby = (time: number) => {
      for (let i = 0; i < world.cars.length; i++) {
        const a = world.cars[i];
        if (a.out) continue;
        for (let j = i + 1; j < world.cars.length; j++) {
          const b = world.cars[j];
          if (!b.out && Math.hypot(a.x - b.x, a.z - b.z) <= 3) {
            lastNear[i] = time;
            lastNear[j] = time;
          }
        }
      }
    };
    const wasFalling = world.cars.map((car) => car.falling);
    updateNearby(t * STEP);
    const events = step(world, world.cars.map((car) => think(world, car.id, level, random)), STEP);
    const elapsed = (t + 1) * STEP;
    updateNearby(elapsed);
    for (const car of world.cars) {
      if (!wasFalling[car.id] && car.falling) {
        assert.ok(elapsed - lastNear[car.id] <= 1, `level ${level}, seed ${seed}, car ${car.id} fell without a nearby car in the previous second`);
      }
    }
    for (const event of events) {
      if (event.type !== 'round') continue;
      roundDurations.push(world.fightTime);
      if (event.winner === null) roundDraws++;
    }
  }
  return { world, roundDurations, roundDraws };
};

test('cars spawn inside and apart, face the centre, and stay still during the countdown', () => {
  const world = createWorld(entries(8), 8);
  for (let i = 0; i < world.cars.length; i++) {
    const car = world.cars[i];
    assert.ok(Math.hypot(car.x, car.z) < world.radius);
    for (const other of world.cars.slice(i + 1)) assert.ok(Math.hypot(car.x - other.x, car.z - other.z) > CAR_RADIUS * 2);
    const facing = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    assert.ok(facing.x * -car.x + facing.z * -car.z > 0);
  }
  const before = world.cars.map(({ x, z }) => [x, z]);
  step(world, idle(world), 2.5);
  assert.equal(world.phase, 'count');
  assert.deepEqual(world.cars.map(({ x, z }) => [x, z]), before);
});

test('a car collision transfers momentum, resolves overlap, and a dash carries more impact', () => {
  const impact = (dashing: boolean) => {
    const world = createWorld(entries(2), 2);
    go(world);
    const [a, b] = world.cars;
    a.x = -1.1;
    a.z = 0;
    a.vx = 6;
    b.x = 0.8;
    b.z = 0;
    b.vx = 0;
    if (dashing) a.dashT = 0.25;
    step(world, idle(world), 0.08);
    return { a, b };
  };
  const normal = impact(false);
  assert.ok(normal.b.vx > 0, 'the target receives momentum along the impact normal');
  assert.ok(Math.hypot(normal.a.x - normal.b.x, normal.a.z - normal.b.z) >= CAR_RADIUS * 2 - 0.01);
  const dash = impact(true);
  assert.ok(dash.b.vx > normal.b.vx, `dash target ${dash.b.vx} should exceed normal target ${normal.b.vx}`);
});

test('dash charges, launches on release, then observes its cooldown', () => {
  const world = createWorld(entries(2), 3);
  go(world);
  let controls = idle(world);
  controls[0] = { x: 1, y: 0, dash: true };
  step(world, controls, 0.35);
  assert.ok(world.cars[0].charge > 0.45 && world.cars[0].charge < 0.55);
  controls[0] = { x: 1, y: 0, dash: false };
  step(world, controls, STEP);
  assert.ok(Math.hypot(world.cars[0].vx, world.cars[0].vz) >= 9 && Math.hypot(world.cars[0].vx, world.cars[0].vz) <= 20);
  assert.ok(world.cars[0].dashT > 0);
  assert.ok(world.cars[0].cool > 1.29);
  controls[0] = { x: 0, y: 0, dash: true };
  step(world, controls, 0.5);
  assert.equal(world.cars[0].charge, 0);
  assert.ok(world.cars[0].cool > 0.7);
});

test('the float shrinks, stops at sudden death, and falling cars splash out', () => {
  const world = createWorld(entries(2), 4);
  go(world);
  world.cars[0].x = -1.4;
  world.cars[0].z = 0;
  world.cars[1].x = 1.4;
  world.cars[1].z = 0;
  const start = world.radius;
  step(world, idle(world), 3.99);
  assert.equal(world.radius, start);
  step(world, idle(world), 30.02);
  assert.ok(Math.abs(world.radius - 4.5) < 0.01);
  step(world, idle(world), 5);
  assert.equal(world.radius, 4.5);
  step(world, idle(world), 9.3);
  assert.equal(world.radius, 2.2);
  const fallWorld = createWorld(entries(2), 44);
  go(fallWorld);
  fallWorld.fightTime = 80;
  step(fallWorld, idle(fallWorld), STEP);
  const car = fallWorld.cars[0];
  car.x = fallWorld.radius + 0.3;
  car.z = 0;
  const splashes = step(fallWorld, idle(fallWorld), 0.5);
  assert.equal(car.falling, false);
  assert.equal(car.out, true);
  assert.ok(splashes.some((event) => event.type === 'splash' && event.car === car.id));
});

test('a real splash ends the round and awards the survivor promptly', () => {
  const world = createWorld(entries(2), 44);
  go(world);
  const eliminated = world.cars[0];
  const survivor = world.cars[1];
  eliminated.x = world.radius + 0.3;
  eliminated.z = 0;
  eliminated.vx = 0;
  eliminated.vz = 0;
  survivor.x = 0;
  survivor.z = 0;
  survivor.vx = 0;
  survivor.vz = 0;
  let elapsed = 0;
  let splashed = false;
  while (world.phase === 'fight' && elapsed < 3) {
    const events = step(world, idle(world), STEP);
    splashed ||= events.some((event) => event.type === 'splash' && event.car === eliminated.id);
    elapsed += STEP;
  }
  assert.ok(splashed);
  assert.equal(eliminated.out, true);
  assert.equal(eliminated.falling, false);
  assert.equal(world.phase, 'over');
  assert.equal(world.roundWinner, survivor.id);
  assert.equal(world.wins[survivor.id], 1);
  assert.ok(elapsed < 3);
});

test('physics-only stepping moves cars without changing host-owned outcomes', () => {
  const world = createWorld(entries(2), 43);
  go(world);
  const car = world.cars[0];
  car.x = world.radius + 4;
  const radius = world.radius;
  const wins = [...world.wins];
  step(world, idle(world), STEP, { authoritative: false });
  assert.equal(world.phase, 'fight');
  assert.equal(world.radius, radius);
  assert.deepEqual(world.wins, wins);
  assert.equal(car.out, false);
  assert.equal(car.falling, false);
});

test('rounds award the last car, draws award nobody, and the cap and match target resolve', () => {
  const world = createWorld(entries(2), 5);
  go(world);
  world.cars[1].out = true;
  const events = step(world, idle(world), STEP);
  assert.equal(world.roundWinner, 0);
  assert.equal(world.wins[0], 1);
  assert.ok(events.some((event) => event.type === 'round' && event.winner === 0));

  const draw = createWorld(entries(2), 6);
  go(draw);
  draw.cars.forEach((car) => {
    car.out = true;
  });
  step(draw, idle(draw), STEP);
  assert.equal(draw.roundWinner, null);
  assert.deepEqual(draw.wins, [0, 0]);

  const capped = createWorld(entries(2), 7);
  go(capped);
  capped.fightTime = 99.99;
  capped.cars[0].x = 1;
  capped.cars[0].z = 0;
  capped.cars[1].x = 4;
  capped.cars[1].z = 0;
  step(capped, idle(capped), STEP);
  assert.equal(capped.roundWinner, 0);

  capped.wins[0] = TARGET;
  assert.equal(matchWinner(capped), 0);
});

test('seeded bots stay on the float alone and the normal bot match finishes cleanly', () => {
  for (let level: Level = 0; level <= 2; level = (level + 1) as Level) {
    for (let seed = 1; seed <= 30; seed++) {
      const lone = createWorld(entries(1, level), seed);
      go(lone);
      const random = rng(seed);
      for (let t = 0; t < 60 * 60; t++) {
        step(lone, [think(lone, 0, level, random)], STEP);
        lone.phase = 'fight';
      }
      assert.ok(onPlatform(lone.cars[0], lone), `level ${level}, seed ${seed} fell alone`);
      assert.equal(lone.radius, 2.2, `level ${level}, seed ${seed} did not reach the floor`);
    }
  }

  const world = createWorld(entries(2, 1), 201);
  const random = rng(301);
  const lastHit = new Map<number, number>();
  const maxTime = 600;
  for (let t = 0; t < maxTime * 60 && matchWinner(world) === null; t++) {
    const events = step(world, world.cars.map((car) => think(world, car.id, 1, random)), STEP);
    for (const event of events) {
      if (event.type === 'hit') {
        lastHit.set(event.a, t * STEP);
        lastHit.set(event.b, t * STEP);
      }
      if (event.type === 'splash') {
        assert.ok(t * STEP - (lastHit.get(event.car) ?? -Infinity) <= 1.5, `car ${event.car} fell without a recent hit`);
      }
    }
  }
  assert.ok(matchWinner(world) !== null, `bot match did not finish within ${maxTime}s`);
});

test('natural eight-bot matches finish quickly across levels and seeds', () => {
  for (let level: Level = 0; level <= 2; level = (level + 1) as Level) {
    const durations: number[] = [];
    let draws = 0;
    for (const seed of Array.from({ length: 10 }, (_, index) => 201 + index)) {
      const { world, roundDurations, roundDraws } = simulateEightBotMatch(level, seed);
      assert.ok(matchWinner(world) !== null, `level ${level}, seed ${seed} did not finish`);
      assert.ok(roundDurations.length >= 3, `level ${level}, seed ${seed} resolved fewer than three rounds`);
      durations.push(...roundDurations);
      draws += roundDraws;
    }
    const capped = durations.filter((duration) => duration >= 100).length;
    const mean = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    const drawRate = draws / durations.length;
    assert.ok(mean < 45, `level ${level} mean round length was ${mean.toFixed(1)}s`);
    assert.ok(mean > 10, `level ${level} mean fight time was only ${mean.toFixed(1)}s`);
    assert.ok(drawRate < 0.15, `level ${level} draw rate was ${draws}/${durations.length}`);
    assert.ok(capped / durations.length < 0.1, `level ${level} cap rate was ${capped}/${durations.length}`);
  }
});

test('each bot level pushes a naturally spawned idle human off on time', () => {
  for (let level: Level = 0; level <= 2; level = (level + 1) as Level) {
    const seed = 701 + level;
    const world = createWorld([
      { seat: 0, color: 0, ai: null, name: 'Human' },
      { seat: 1, color: 1, ai: level, name: 'Bot' },
    ], seed);
    const random = rng(seed + 100);
    go(world);
    const deadline = level === 0 ? 60 : 30;
    let elapsed = 0;
    let humanSplashed = false;
    while (elapsed < deadline && !world.cars[0].out && world.phase === 'fight') {
      const inputs = idle(world);
      inputs[1] = think(world, 1, level, random);
      const events = step(world, inputs, STEP);
      humanSplashed ||= events.some((event) => event.type === 'splash' && event.car === 0);
      elapsed += STEP;
    }
    assert.ok(humanSplashed, `level ${level} bot did not splash the idle human within ${deadline}s`);
    assert.ok(elapsed <= deadline, `level ${level} bot took ${elapsed.toFixed(1)}s`);
  }
});

test('bot inputs stay inside the unit disc and dash is boolean', () => {
  const world = createWorld(entries(8, 2), 9);
  for (const car of world.cars) {
    const input = think(world, car.id, 2, () => 0.5);
    assert.ok(Math.hypot(input.x, input.y) <= 1 + 1e-8);
    assert.equal(typeof input.dash, 'boolean');
  }
});

test('sumo packets round-trip and reject malformed numbers, types, seats, and oversized states', () => {
  const input = inputOf(2, { x: 0.126, y: -0.2, dash: true });
  assert.deepEqual(parsePacket(input), { k: 'i', r: 2, x: 0.13, y: -0.2, d: true });
  const state = hostState(2, 'fight', 5, 10, 1, [0, 1], [0, 3], 1, [
    { x: 1, z: 2, y: 0, vx: 3, vz: 4, yaw: 0.4, charge: 0.5, flags: 1 },
    { x: -1, z: 0, y: 0, vx: 0, vz: 1, yaw: -0.5, charge: 0, flags: 4 },
  ]);
  const parsedState = parsePacket(state);
  assert.equal(parsedState?.k, 'S');
  if (parsedState?.k === 'S') {
    assert.equal(Boolean(parsedState.cars[1].flags & 4), true);
    assert.equal(Boolean(parsedState.cars[1].flags & 2), false);
  }
  assert.deepEqual(parsePacket(endOf(2, 3, [1, 2]))?.k, 'end');
  assert.deepEqual(parsePacket(configOf(2, 2)), { k: 'cfg', r: 2, lv: 2 });
  assert.equal(parsePacket({ t: 'sumo', r: 1, k: 'i', x: NaN, y: 0, d: false }), null);
  assert.equal(parsePacket({ t: 'sumo', r: 1, k: 'i', x: '0', y: 0, d: false }), null);
  assert.equal(parsePacket({ t: 'sumo', r: 1, k: 'end', w: 16, wins: [] }), null);
  assert.equal(parsePacket({ ...state, roster: [0, 16] }), null);
  assert.equal(parsePacket({ ...state, cars: Array.from({ length: 9 }, () => [0, 0, 0, 0, 0, 0, 0, 0]) }), null);
});

test('departed human seats are taken over by bots without changing active players', () => {
  const world = createWorld([
    { seat: 0, color: 0, ai: null, name: 'Host' },
    { seat: 1, color: 1, ai: null, name: 'Guest' },
    { seat: 2, color: 2, ai: 0, name: 'Bot' },
  ], 10);
  assert.deepEqual(takeoverDeparted(world, [0, 2], 1), [1]);
  assert.equal(world.cars[1].ai, 1);
  assert.equal(world.cars[1].left, true);
  assert.equal(world.cars[0].ai, null);
  assert.deepEqual(takeoverDeparted(world, [0, 1, 2], 2), []);
});

test('round banner agrees with the winner name', () => {
  assert.equal(roundBanner('You'), 'You Take the Round');
  assert.equal(roundBanner('Pebble'), 'Pebble Takes the Round');
  assert.equal(roundBanner('P2'), 'P2 Takes the Round');
  assert.equal(roundBanner(null), 'Draw, Go Again');
});
