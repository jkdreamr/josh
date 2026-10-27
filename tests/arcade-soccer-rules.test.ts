import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, distance, FIELD, matchClock, PLAYER_COUNT, resolveBoundary, stepWorld, TEAM_SIZE, teamOf, type World } from '../src/os/arcade/games/soccer/logic.ts';

const world = () => {
  const g = createWorld(12, 120);
  g.phase = 'live'; g.restart = null;
  return g;
};

test('world has a legal 11v11 kickoff formation with one goalkeeper per team', () => {
  const g = createWorld();
  assert.equal(g.players.length, PLAYER_COUNT);
  for (const team of [0, 1] as const) {
    const players = g.players.filter((player) => player.team === team);
    assert.equal(players.length, TEAM_SIZE);
    assert.equal(players.filter((player) => player.slot === 'GK').length, 1);
  }
  for (const player of g.players) {
    assert.equal(player.team, teamOf(player.id));
    assert.ok(player.team === 0 ? player.x < 0 : player.x > 0, `player ${player.id} must be in their own half`);
    if (player.id !== 9) assert.ok(distance(player, { x: 0, z: 0 }) >= FIELD.centerRadius, `player ${player.id} must be outside the center circle`);
  }
});

test('touchline awards a kick-in to the team that did not touch last', () => {
  const g = world();
  g.ball.z = FIELD.width / 2 + 0.2; g.lastTouch = 0;
  assert.equal(resolveBoundary(g), 'kick-in');
  assert.equal(g.restartTeam, 1);
});

test('goal line awards a corner or goal kick based on the last touch', () => {
  const g = world();
  g.ball.x = FIELD.length / 2 + 0.2; g.lastTouch = 1;
  assert.equal(resolveBoundary(g), 'corner');
  assert.equal(g.restartTeam, 0);
  g.phase = 'live'; g.ball.x = -FIELD.length / 2 - 0.2; g.lastTouch = 1;
  assert.equal(resolveBoundary(g), 'goal-kick');
});

test('kickoff starts centered and opponents are kept at distance', () => {
  const g = createWorld(2, 120);
  const opponent = g.players[TEAM_SIZE + 6]!;
  opponent.x = 0.4;
  stepWorld(g, 1 / 60);
  assert.ok(Math.hypot(opponent.x, opponent.z) >= 3.99);
});

test('kickoff movement starts play immediately and moves the selected player', () => {
  const g = createWorld(22, 120);
  const player = g.players[6]!;
  const startX = player.x;
  stepWorld(g, 1 / 60, new Map([[player.id, { move: { x: 1, z: 0 }, sprint: true }]]));
  assert.equal(g.phase, 'live');
  assert.ok(player.x > startX);
});

test('sprint accelerates quickly and a released player stops promptly', () => {
  const g = createWorld(24, 120);
  g.phase = 'live';
  g.restart = null;
  const player = g.players[6]!;
  for (let i = 0; i < 18; i++) stepWorld(g, 1 / 60, new Map([[player.id, { move: { x: 1, z: 0 }, sprint: true }]]));
  assert.ok(Math.hypot(player.vx, player.vz) >= 7.2);
  for (let i = 0; i < 20; i++) stepWorld(g, 1 / 60, new Map([[player.id, { move: { x: 0, z: 0 } }]]));
  assert.ok(Math.hypot(player.vx, player.vz) < 0.35);
});

test('a facing standing tackle wins the ball inside reach', () => {
  const g = world();
  const tackler = g.players[1]!;
  const carrier = g.players[TEAM_SIZE + 6]!;
  tackler.x = -1; tackler.z = 0; tackler.facing = Math.PI / 2;
  carrier.x = 0.25; carrier.z = 0; carrier.human = false; carrier.controlled = false;
  g.ball.x = 0.25; g.ball.z = 0; g.ball.y = 0.11;
  stepWorld(g, 1 / 60, new Map([[tackler.id, { move: { x: 0, z: 0 }, action: 'tackle', pressed: true }]]));
  assert.equal(g.lastTouch, tackler.team);
  assert.ok(distance(tackler, g.ball) < 0.64);
});

test('a tap pass is assisted to an open receiver and transfers control', () => {
  let completed = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const g = createWorld(seed, 120);
    g.phase = 'live';
    g.restart = null;
    const carrier = g.players[6]!;
    const receiver = g.players[7]!;
    carrier.x = -7; carrier.z = 0; carrier.human = true; carrier.controlled = true;
    receiver.x = -3; receiver.z = seed % 2 ? 0.2 : -0.2;
    for (const teammate of g.players.filter((player) => player.team === carrier.team && player.id !== carrier.id && player.id !== receiver.id)) {
      teammate.x = -30; teammate.z = 28;
    }
    g.players[0]!.x = -16; g.players[0]!.z = 8;
    g.players[3]!.x = -14; g.players[3]!.z = -8;
    g.players[4]!.x = -11; g.players[4]!.z = 10;
    for (const opponent of g.players.filter((p) => p.team === 1)) { opponent.x = 17; opponent.z = 10; }
    g.ball.x = -6.6; g.ball.z = 0; g.ball.y = 0.11;
    stepWorld(g, 1 / 60, new Map([[carrier.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.1, aim: { x: 1, z: 0 } }]]));
    for (let i = 0; i < 150; i++) {
      stepWorld(g, 1 / 60);
      if (g.controlled[0] === receiver.id && g.passTarget === null) { completed++; break; }
    }
  }
  assert.ok(completed >= 45, `completed assisted tap passes: ${completed}/50`);
});

test('match clock advances and maps each half to 45 minutes', () => {
  const g = createWorld(23, 240);
  assert.equal(matchClock(g), 0);
  for (let i = 0; i < 360; i++) stepWorld(g, 1 / 60);
  assert.equal(matchClock(g), 1);
  g.clock = 0;
  assert.equal(matchClock(g), 45);
  g.half = 2;
  g.clock = g.halfLength;
  assert.equal(matchClock(g), 45);
  g.clock = 0;
  assert.equal(matchClock(g), 90);
});

test('debug clock scale accelerates the match clock', () => {
  const g = world();
  const before = g.clock;
  stepWorld(g, 1 / 60, new Map(), 4);
  assert.ok(Math.abs(g.clock - (before - 4 / 60)) < 1e-9);
});

test('a goal kick is always taken by the goalkeeper', () => {
  const g = createWorld(12, 120);
  g.restart = 'goal-kick';
  g.restartTeam = 0;
    g.restartAt = { x: -FIELD.length / 2 + FIELD.goalAreaDepth, z: 0 };
  const keeper = g.players[0]!;
  keeper.x = -10;
    g.players[1]!.x = -FIELD.length / 2 + FIELD.goalAreaDepth;
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
  g.ball.x = FIELD.length / 2 - 0.12; g.ball.y = 0.5; g.ball.z = 0;
  g.ball.vx = 30;
  stepWorld(g, 1 / 60);
  assert.equal(g.score[0], 1);
  const noGoal = world();
  noGoal.ball.x = FIELD.length / 2 - 0.12; noGoal.ball.y = FIELD.goalHeight - 0.05; noGoal.ball.z = 0;
  noGoal.ball.vx = 30;
  stepWorld(noGoal, 1 / 60);
  assert.equal(noGoal.score[0], 0);
});
