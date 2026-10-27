import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateCpuMatch } from '../src/os/arcade/games/soccer/ai.ts';
import { broadcastClock, CLUBS, createMatchStats, createStatsObserver, passAccuracy, playerName, possessionShare, REGULAR, xgFor } from '../src/os/arcade/games/soccer/broadcast.ts';
import { createWorld, FIELD, STEP, teamDir, type Team } from '../src/os/arcade/games/soccer/logic.ts';

function observeMatch(seed: number, seconds: number) {
  const observer = createStatsObserver();
  const world = simulateCpuMatch(seed, 'normal', 'normal', seconds, (state) => observer.observe(state, STEP));
  return { world, stats: observer.stats };
}

test('broadcast statistics do not alter seeded simulations', () => {
  for (const seed of [47, 89]) {
    const measured = observeMatch(seed, 30);
    assert.deepEqual(measured.world, simulateCpuMatch(seed, 'normal', 'normal', 30));
  }
});

test('broadcast statistics preserve match invariants over several seeds', () => {
  for (const seed of [17, 47, 89]) {
    const { world, stats } = observeMatch(seed, 30);
    assert.ok(stats.teams.every((team) => team.onTarget <= team.shots), `seed ${seed}: on target exceeds shots`);
    assert.ok(stats.teams.every((team) => team.completed <= team.passes));
    assert.deepEqual(stats.teams.map((team) => team.goals), world.score);
    assert.equal(stats.goals.length, world.score[0] + world.score[1]);
    assert.ok(stats.goals.every((goal) => goal.scorer !== undefined && goal.scorer >= 0 && goal.scorer < 22));
    const livePossession = stats.teams[0].possession + stats.teams[1].possession;
    assert.ok(livePossession <= 30 + STEP);
    assert.ok(livePossession > 0);
    assert.ok(stats.teams.every((team) => team.xg >= 0.01 * team.shots));
    assert.ok(stats.ticker.length <= 24);
  }
});

test('expected goals reward central close shots and reject impossible values', () => {
  const world = createWorld();
  const team: Team = 0;
  const goalX = teamDir(team, world.endsSwapped) * FIELD.length / 2;
  const penaltySpot = { x: goalX - teamDir(team, world.endsSwapped) * 11, z: 0 };
  const central25 = { x: goalX - teamDir(team, world.endsSwapped) * 25, z: 0 };
  const tightAngle = { x: goalX - teamDir(team, world.endsSwapped) * 2, z: FIELD.width / 2 - 1 };
  const penaltyXg = xgFor(world, penaltySpot, team);
  assert.ok(penaltyXg > xgFor(world, central25, team));
  assert.ok(xgFor(world, central25, team) > xgFor(world, tightAngle, team));
  for (const value of [penaltyXg, xgFor(world, central25, team), xgFor(world, tightAngle, team)]) {
    assert.ok(value >= 0.01 && value <= 0.95);
  }
  const swapped = { ...world, endsSwapped: true };
  const swappedGoalX = teamDir(team, swapped.endsSwapped) * FIELD.length / 2;
  assert.equal(xgFor(swapped, { x: swappedGoalX - teamDir(team, true) * 11, z: 0 }, team), penaltyXg);
});

test('broadcast clock formats regular time, added time, and the second-half start', () => {
  const world = createWorld(1, 90);
  const stats = createMatchStats();
  assert.equal(broadcastClock(world, stats).label, '00:00');
  assert.equal(broadcastClock(world, stats).minute, "1'");
  world.clock = world.halfLength * (1 - (REGULAR - 0.001));
  assert.equal(broadcastClock(world, stats).minute, "45'");
  world.clock = 0;
  stats.added[0] = 3;
  assert.equal(broadcastClock(world, stats).label, '48:00');
  assert.equal(broadcastClock(world, stats).minute, "45+3'");
  world.half = 2;
  world.clock = world.halfLength;
  assert.equal(broadcastClock(world, stats).label, '45:00');
});

test('broadcast clock advances monotonically through a regular half', () => {
  const world = createWorld(1, 90);
  const stats = createMatchStats();
  let previous = 0;
  for (let step = 0; step <= 60; step++) {
    world.clock = world.halfLength - step * 1.2;
    const label = broadcastClock(world, stats).label;
    const [minutes, seconds] = label.split(':').map(Number);
    const current = minutes! * 60 + seconds!;
    assert.ok(current >= previous, `${label} followed ${previous}`);
    previous = current;
  }
});

test('player names are unique and follow formation order', () => {
  const names = Array.from({ length: 22 }, (_, id) => playerName(id));
  assert.equal(new Set(names).size, 22);
  assert.equal(playerName(0), 'A. MORGAN');
  assert.equal(playerName(6), 'J. KIM');
  assert.equal(playerName(9), 'M. RIVERA');
  assert.equal(CLUBS[0].roster.length, 11);
  assert.equal(CLUBS[1].roster.length, 11);
});

test('possession and pass accuracy are presented as integer percentages', () => {
  const stats = createMatchStats();
  assert.deepEqual(possessionShare(stats), [50, 50]);
  stats.teams[0].possession = 3;
  stats.teams[1].possession = 1;
  assert.deepEqual(possessionShare(stats), [75, 25]);
  stats.teams[0].passes = 3;
  stats.teams[0].completed = 2;
  assert.equal(passAccuracy(stats.teams[0]), 67);
  assert.equal(passAccuracy(stats.teams[1]), 0);
});

test('stats observer reads rather than mutates the world', () => {
  const world = createWorld(3, 20);
  for (const player of world.players) { player.human = false; player.controlled = false; }
  const observer = createStatsObserver();
  const state = structuredClone(world);
  observer.observe(world, STEP);
  assert.deepEqual(world, state);
});
