import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatchStatsObserver, simulateCpuMatch, simulateCpuMatchStats } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, TEAM_SIZE } from '../src/os/arcade/games/soccer/logic.ts';

test('statistics do not alter the seeded simulation', () => {
  const measured = simulateCpuMatchStats(47, 'hard', 'easy', 30);
  assert.deepEqual(measured.world, simulateCpuMatch(47, 'hard', 'easy', 30));
  assert.deepEqual(measured.teams.map((team) => team.goals), measured.world.score);
  assert.ok(measured.liveTicks > 0);
  assert.ok(measured.teams.every((team) => team.passesCompleted <= team.passesAttempted && team.shotsOnTarget <= team.shots));
});

test('empty matches have zero statistics and invalid durations are rejected', () => {
  const empty = simulateCpuMatchStats(1, 'normal', 'normal', 0);
  assert.equal(empty.liveTicks, 0);
  assert.ok(empty.teams.every((team) => Object.values(team).every((value) => value === 0)));
  for (const seconds of [-1, NaN, Infinity]) assert.throws(() => simulateCpuMatchStats(1, 'normal', 'normal', seconds), RangeError);
});

test('observer excludes restarts and counts teammate receptions, interceptions, saves and goals', () => {
  const { stats, observe } = createMatchStatsObserver();
  const world = createWorld();
  for (const p of world.players) { p.x = -15; p.z = 10; }
  const kick = (action: 'pass' | 'shoot') => { world.kickEvent = { playerId: 1, action, power: 0.7, time: 10 }; observe(world); world.kickEvent = null; };
  world.phase = 'live';
  kick('pass');
  assert.equal(stats.teams[0].passesAttempted, 0);
  kick('pass');
  world.players[2]!.x = world.ball.x; world.players[2]!.z = world.ball.z;
  observe(world);
  assert.equal(stats.teams[0].passesCompleted, 1);
  world.players[2]!.x = -15;
  kick('pass');
  world.players[TEAM_SIZE + 6]!.x = world.ball.x; world.players[TEAM_SIZE + 6]!.z = world.ball.z;
  observe(world);
  assert.equal(stats.teams[0].passesCompleted, 1);
  world.players[TEAM_SIZE + 6]!.x = -15;
  kick('shoot');
  world.lastTouch = 1; world.event = 'keeper parries'; world.eventTime = 1.1;
  observe(world); observe(world);
  assert.equal(stats.teams[0].shotsOnTarget, 1);
  world.eventTime = 0;
  kick('shoot');
  world.score[0]++; world.phase = 'goal'; observe(world);
  assert.equal(stats.teams[0].shots, 2);
  assert.equal(stats.teams[0].shotsOnTarget, 2);
  assert.equal(stats.teams[0].goals, 1);
  assert.equal(stats.teams[0].passesAttempted, 2);
});

test('observer counts possession per live tick and infers a new successful tackle only once', () => {
  const { stats, observe } = createMatchStatsObserver();
  const world = createWorld();
  world.phase = 'live';
  const player = world.players[TEAM_SIZE + 6]!;
  player.x = world.ball.x; player.z = world.ball.z;
  player.action = 'tackle'; player.cooldown = 0.35; world.lastTouch = 1;
  observe(world); observe(world);
  assert.equal(stats.teams[1].tacklesWon, 1);
  assert.equal(stats.teams[1].possessionShare, 1);
  player.x = 10; observe(world);
  assert.equal(stats.teams[1].possessionShare, 2 / 3);
});
