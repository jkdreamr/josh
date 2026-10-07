import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_W, LANES, LANE_W, MAX_SPEED, MIN_SPEED, SPAWN_Z, create, gapFor, hits, kmh, laneX, score, spawnWave, steer, step } from '../src/os/arcade/games/palmdrive/logic.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('lanes are centered on the road', () => {
  assert.equal(laneX(1), 0);
  assert.equal(laneX(0), -LANE_W);
  assert.equal(laneX(LANES - 1), LANE_W);
});

test('steering clamps to the outer lanes', () => {
  const s = create();
  steer(s, -1);
  steer(s, -1);
  assert.equal(s.lane, 0);
  for (let i = 0; i < 5; i++) steer(s, 1);
  assert.equal(s.lane, LANES - 1);
});

test('the car eases toward its lane and the world scrolls', () => {
  const s = create();
  steer(s, 1);
  const rng = seeded(1);
  for (let i = 0; i < 60; i++) step(s, 1 / 60, rng);
  assert.ok(Math.abs(s.x - laneX(2)) < 0.05);
  assert.ok(s.dist > MIN_SPEED * 0.9);
  assert.ok(s.speed > MIN_SPEED);
  assert.equal(score(s), Math.floor(s.dist));
  assert.equal(kmh(s), Math.round(s.speed * 3.6));
});

test('speed caps at MAX_SPEED and waves tighten', () => {
  const s = create();
  s.speed = MAX_SPEED - 0.01;
  const rng = seeded(2);
  for (let i = 0; i < 120; i++) step(s, 1 / 20, rng);
  assert.equal(s.speed, MAX_SPEED);
  assert.ok(gapFor(0) > gapFor(5000));
  assert.equal(gapFor(1e9), 22);
});

test('every wave leaves at least one lane open and spawns ahead', () => {
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const s = create();
    s.dist = i * 10;
    const wave = spawnWave(s, rng);
    assert.ok(wave.length >= 1 && wave.length < LANES);
    assert.equal(new Set(wave.map((o) => o.lane)).size, wave.length, 'no two obstacles in one lane');
    for (const o of wave) {
      assert.ok(o.z >= SPAWN_Z);
      if (o.kind === 'cone') assert.equal(o.speed, 0);
      else assert.ok(o.speed > 0);
    }
  }
});

test('oncoming cars close faster than cones', () => {
  const s = create();
  s.obstacles = [
    { id: 1, kind: 'car', lane: 0, z: 100, speed: 10, hue: 0 },
    { id: 2, kind: 'cone', lane: 2, z: 100, speed: 0, hue: 0 },
  ];
  s.nextSpawn = 1e9;
  step(s, 1, () => 0.5);
  assert.ok(s.obstacles[0].z < s.obstacles[1].z);
});

test('hitting an obstacle in your lane crashes, a free lane does not', () => {
  const car = { id: 1, kind: 'car' as const, lane: 1, z: 0.5, speed: 10, hue: 0 };
  assert.ok(hits(0, car));
  assert.ok(!hits(laneX(0), car));
  assert.ok(!hits(0, { ...car, z: 50 }));
  const cone = { id: 2, kind: 'cone' as const, lane: 1, z: 1, speed: 0, hue: 0 };
  assert.ok(hits(0, cone));
  assert.ok(!hits(CAR_W / 2 + 0.5, cone));
});

test('a crash freezes the run and records what you hit', () => {
  const s = create();
  s.obstacles = [{ id: 9, kind: 'car', lane: 1, z: 6, speed: 10, hue: 0 }];
  s.nextSpawn = 1e9;
  for (let i = 0; i < 40 && !s.crashed; i++) step(s, 1 / 30, () => 0.5);
  assert.ok(s.crashed);
  assert.equal(s.crashedWith?.id, 9);
  const d = s.dist;
  step(s, 1, () => 0.5);
  steer(s, 1);
  assert.equal(s.dist, d);
  assert.equal(s.lane, 1);
});

test('passed obstacles are dropped', () => {
  const s = create();
  s.obstacles = [{ id: 1, kind: 'cone', lane: 0, z: -11.9, speed: 0, hue: 0 }];
  s.nextSpawn = 1e9;
  step(s, 0.1, () => 0.5);
  assert.equal(s.obstacles.length, 0);
});
