import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, keeperTarget, simulateCpuMatch } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, stepWorld, TEAM_SIZE } from '../src/os/arcade/games/soccer/logic.ts';

test('human players never receive AI movement', () => {
  const g = createWorld();
  const commands = computeAI(g, 'normal', 1 / 60, 1);
  assert.equal(commands.has(g.players[6]!.id), false);
  assert.ok([...commands.keys()].every((id) => !g.players[id]!.human));
});

test('players respect the sprint speed cap', () => {
  simulateCpuMatch(1234, 'hard', 'easy', 8, (world) => {
    for (const p of world.players) assert.ok(Math.hypot(p.vx, p.vz) <= 9.01);
  });
});

test('seeded four-minute halves have plausible average scoring', () => {
  let total = 0;
  for (const seed of [2, 17, 31, 47, 59, 71, 89, 103]) {
    const g = simulateCpuMatch(seed, 'normal', 'normal', 480);
    assert.equal(g.phase, 'full-time');
    assert.ok(g.score[0] + g.score[1] <= 22, `seed ${seed}: ${g.score.join("-")}`);
    total += g.score[0] + g.score[1];
  }
  assert.ok(total / 8 >= 1 && total / 8 <= 15, `average goals: ${total / 8}`);
});

test('keeper shades toward the predicted ball crossing and steps out one-on-one', () => {
  const g = createWorld();
  const keeper = g.players[TEAM_SIZE]!;
  g.ball.x = FIELD.length / 2 - 20;
  g.ball.z = -1;
  g.ball.vx = 10;
  g.ball.vz = 2;
  const intercept = keeperTarget(g, keeper);
  assert.ok(intercept.z > 0);
  const normalX = intercept.x;
  g.ball.x = FIELD.length / 2 - 5;
  const oneOnOneX = keeperTarget(g, keeper).x;
  assert.ok(oneOnOneX > normalX);
});

test('hard CPU wins more than it loses across seeded four-minute halves', () => {
  let wins = 0;
  let losses = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const game = simulateCpuMatch(seed * 113, 'hard', 'easy', 480);
    if (game.score[0] > game.score[1]) wins++;
    if (game.score[0] < game.score[1]) losses++;
  }
  assert.ok(wins > losses + 2, `hard wins ${wins}, loses ${losses}`);
});

test('CPU teams hold shape without sustained teammate clumping', () => {
  let nearestDistanceTotal = 0;
  let playerSamples = 0;
  let clumpedSamples = 0;
  let samples = 0;
  for (const seed of [17, 47, 89]) {
    let tick = 0;
    simulateCpuMatch(seed, 'normal', 'normal', 120, (world) => {
      tick++;
      if (world.phase !== 'live' || tick % 30 !== 0) return;
      samples++;
      for (const team of [0, 1] as const) {
        const players = world.players.filter((player) => player.team === team && player.slot !== 'GK');
        for (const player of players) {
          const nearest = Math.min(...players.filter((mate) => mate.id !== player.id).map((mate) => distance(player, mate)));
          nearestDistanceTotal += nearest;
          playerSamples++;
        }
        let grouped = false;
        for (let a = 0; a < players.length && !grouped; a++) {
          for (let b = a + 1; b < players.length && !grouped; b++) {
            for (let c = b + 1; c < players.length; c++) {
              if (distance(players[a]!, players[b]!) < 4
                && distance(players[a]!, players[c]!) < 4
                && distance(players[b]!, players[c]!) < 4) {
                grouped = true;
                break;
              }
            }
          }
        }
        if (grouped) clumpedSamples++;
      }
    });
  }
  assert.ok(samples > 0, 'expected live-phase samples');
  const meanNearestDistance = nearestDistanceTotal / playerSamples;
  const clumpFraction = clumpedSamples / (samples * 2);
  assert.ok(meanNearestDistance >= 4, `mean nearest teammate distance: ${meanNearestDistance.toFixed(2)}m`);
  assert.ok(clumpFraction < 0.65, `three-player clump fraction: ${(clumpFraction * 100).toFixed(1)}%`);
});

test('CPU carrier completes a progressive pass to a teammate', () => {
  const g = createWorld(47);
  g.phase = 'live';
  g.restart = null;
  const carrier = g.players[1]!;
  const receiver = g.players[2]!;
  carrier.human = false;
  carrier.controlled = false;
  carrier.x = -5; carrier.z = 0;
  g.ball.x = -4.7; g.ball.z = 0;
  receiver.x = 0; receiver.z = 0; receiver.slot = 'CB';
  for (const p of g.players.filter((player) => player.team === 1)) {
    p.x = 14 + p.id * 0.2;
    p.z = 10;
  }
  const command = computeAI(g, 'hard', 1 / 60, 0, 0).get(carrier.id)!;
  assert.ok(command.action === 'pass' || command.action === 'through');
  stepWorld(g, 1 / 60, new Map([[carrier.id, command]]));
  assert.ok(g.kickEvent);
  let completed = false;
  for (let i = 0; i < 180; i++) {
    stepWorld(g, 1 / 60);
    if (g.players.some((p) => p.team === carrier.team && p.id !== carrier.id && distance(p, g.ball) < 0.64)) {
      completed = true;
      break;
    }
  }
  assert.ok(completed, 'expected a teammate to control the pass');
});
