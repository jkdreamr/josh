import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, resolveBoundary, stepWorld, type World } from '../src/os/arcade/games/soccer/logic.ts';

const world = () => {
  const g = createWorld(12, 120);
  g.phase = 'live'; g.restart = null;
  return g;
};

test('touchline awards a kick-in to the team that did not touch last', () => {
  const g = world();
  g.ball.z = 13.2; g.lastTouch = 0;
  assert.equal(resolveBoundary(g), 'kick-in');
  assert.equal(g.restartTeam, 1);
});

test('goal line awards a corner or goal kick based on the last touch', () => {
  const g = world();
  g.ball.x = 21.2; g.lastTouch = 1;
  assert.equal(resolveBoundary(g), 'corner');
  assert.equal(g.restartTeam, 0);
  g.phase = 'live'; g.ball.x = -21.2; g.lastTouch = 1;
  assert.equal(resolveBoundary(g), 'goal-kick');
});

test('kickoff starts centered and opponents are kept at distance', () => {
  const g = createWorld(2, 120);
  const opponent = g.players[6]!;
  opponent.x = 0.4;
  stepWorld(g, 1 / 60);
  assert.ok(Math.hypot(opponent.x, opponent.z) >= 3.99);
});

test('a goal kick is always taken by the goalkeeper', () => {
  const g = createWorld(12, 120);
  g.restart = 'goal-kick';
  g.restartTeam = 0;
  g.restartAt = { x: -18.4, z: 0 };
  const keeper = g.players[0]!;
  keeper.x = -10;
  g.players[1]!.x = -18.4;
  const command = new Map([[keeper.id, { move: { x: 0, z: 0 }, action: 'pass' as const, pressed: true, aim: { x: 1, z: 0 } }]]);
  stepWorld(g, 1 / 60, command);
  assert.equal(g.kickEvent?.playerId, keeper.id);
});

test('halftime swaps ends and full time ends the match clock', () => {
  const g = world();
  g.clock = 0.005;
  stepWorld(g, 1 / 60);
  assert.equal(g.phase, 'half-time');
  g.eventTime = 0.01;
  stepWorld(g, 1 / 60);
  assert.equal(g.endsSwapped, true);
  assert.equal(g.half, 2);
  g.phase = 'live'; g.clock = 0.005;
  stepWorld(g, 1 / 60);
  assert.equal(g.phase, 'full-time');
});

test('whole-ball crossing scores only inside the goal and under the bar', () => {
  const g: World = world();
  g.ball.x = 20.88; g.ball.y = 0.5; g.ball.z = 0;
  g.ball.vx = 30;
  stepWorld(g, 1 / 60);
  assert.equal(g.score[0], 1);
  const noGoal = world();
  noGoal.ball.x = 20.88; noGoal.ball.y = 2.1; noGoal.ball.z = 0;
  noGoal.ball.vx = 30;
  stepWorld(noGoal, 1 / 60);
  assert.equal(noGoal.score[0], 0);
});
