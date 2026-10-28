import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, possessionTeam, setRestart, STEP, stepWorld, type Team } from '../src/os/arcade/games/soccer/logic.ts';
import { phoneAttacking, phoneViewKey } from '../src/os/arcade/games/soccer/input.ts';
import { playerForSeat, seatForPlayer } from '../src/os/arcade/games/soccer/seats.ts';

function restartWorld(team: Team) {
  const world = createWorld();
  world.phase = 'restart';
  world.restart = 'kickoff';
  world.restartTeam = team;
  return world;
}

function liveWorldWithCarrier(team: Team) {
  const world = createWorld();
  const carrier = world.players.find((player) => player.team === team)!;
  world.phase = 'live';
  world.restart = null;
  world.setPiece = null;
  world.passTarget = null;
  world.lastToucherId = null;
  world.carrierId = carrier.id;
  for (const player of world.players) {
    player.x = 20 + player.id * 2;
    player.z = 20;
    player.vx = 0;
    player.vz = 0;
    player.action = 'idle';
    player.cooldown = 0;
    player.touchCd = 0;
    player.slide = false;
  }
  carrier.x = 0;
  carrier.z = 0;
  world.ball.x = 0;
  world.ball.y = 0;
  world.ball.z = 0;
  world.ball.vx = 0;
  world.ball.vz = 0;
  world.lastTouch = team;
  return world;
}

function liveWorldWithoutCarrier(lastTouch: Team) {
  const world = liveWorldWithCarrier(lastTouch);
  world.carrierId = null;
  world.passTarget = null;
  for (const player of world.players) {
    player.x = 20 + player.id * 2;
    player.z = 20;
  }
  world.ball.x = 0;
  world.ball.y = 0.11;
  world.ball.z = 0;
  return world;
}

test('phone seats control the intended Soccer team in every online mode', () => {
  assert.equal(playerForSeat(1, true, 'cpu'), 6);
  assert.equal(playerForSeat(1, true, 'versus'), 6);
  assert.equal(playerForSeat(2, true, 'versus'), 17);
  assert.equal(playerForSeat(3, true, 'versus'), 9);
  assert.equal(playerForSeat(4, true, 'versus'), 20);
  assert.equal(playerForSeat(1, true, 'coop'), 6);
  assert.equal(playerForSeat(2, true, 'coop'), 9);
  assert.equal(playerForSeat(0, false, 'versus'), 6);
  assert.equal(playerForSeat(1, false, 'versus'), 17);
  assert.equal(playerForSeat(2, false, 'versus'), 9);
  assert.equal(playerForSeat(3, false, 'versus'), 20);
  assert.equal(seatForPlayer(6, true, 'versus'), 1);
  assert.equal(seatForPlayer(17, true, 'versus'), 2);
  assert.equal(seatForPlayer(9, true, 'versus'), 3);
  assert.equal(seatForPlayer(20, true, 'versus'), 4);
  assert.equal(seatForPlayer(6, true, 'coop'), 1);
  assert.equal(seatForPlayer(9, true, 'coop'), 2);
  assert.equal(seatForPlayer(17, true, 'coop'), 99);
});

test('phone attacking state is true for its own kickoff', () => {
  assert.equal(phoneAttacking(restartWorld(0), 0), true);
});

test("phone attacking state is false for the opponent's kickoff", () => {
  assert.equal(phoneAttacking(restartWorld(1), 0), false);
});

test('phone attacking state follows its live carrier', () => {
  assert.equal(phoneAttacking(liveWorldWithCarrier(0), 0), true);
});

test('phone attacking state is false while the opponent carries the live ball', () => {
  assert.equal(phoneAttacking(liveWorldWithCarrier(1), 0), false);
});

test('phone possession follows its team during a dribble knock-on', () => {
  const world = liveWorldWithCarrier(0);
  const carrier = world.players.find((player) => player.id === world.carrierId)!;
  carrier.x = -1.2;
  assert.equal(phoneAttacking(world, 0), true);
  assert.equal(possessionTeam(world), 0);
});

test('phone possession follows an own-team pass target while the ball is airborne', () => {
  const world = liveWorldWithCarrier(0);
  world.ball.y = 1.5;
  world.passTarget = world.players.find((player) => player.team === 0 && player.id !== world.carrierId)!.id;
  assert.equal(phoneAttacking(world, 0), true);
});

test('phone possession follows an opponent pass target while the ball is airborne', () => {
  const world = liveWorldWithCarrier(0);
  world.ball.y = 1.5;
  world.passTarget = world.players.find((player) => player.team === 1)!.id;
  assert.equal(phoneAttacking(world, 0), false);
});

test('phone possession follows the opponent last touch on a loose ball', () => {
  const world = liveWorldWithoutCarrier(1);
  assert.equal(phoneAttacking(world, 0), false);
});

test('phone view key changes when possession flips without a score change', () => {
  const attacking = liveWorldWithCarrier(0);
  const defending = liveWorldWithCarrier(1);
  assert.deepEqual(attacking.score, defending.score);
  assert.notEqual(phoneViewKey(attacking, 0, 6), phoneViewKey(defending, 0, 6));
});

test('phone view key changes when the displayed clock minute changes', () => {
  const earlier = liveWorldWithCarrier(0);
  const later = liveWorldWithCarrier(0);
  earlier.clock = earlier.halfLength;
  later.clock = 0;
  assert.notEqual(phoneViewKey(earlier, 0, 6), phoneViewKey(later, 0, 6));
});

test('phone view key changes when the restart taker changes', () => {
  const world = createWorld();
  setRestart(world, 0, 'goal-kick', { x: -47, z: 0 });
  const phonePlayer = world.setPiece!.takerId;
  const before = phoneViewKey(world, 0, phonePlayer);
  world.setPiece!.takerId = world.players.find((player) => player.team === 0 && player.id !== phonePlayer && player.slot !== 'GK')!.id;
  assert.notEqual(before, phoneViewKey(world, 0, phonePlayer));
});

test('phone view key ignores ball-position changes within the same possession', () => {
  const world = liveWorldWithCarrier(0);
  const moved = structuredClone(world);
  moved.ball.x += 0.2;
  assert.equal(possessionTeam(world), possessionTeam(moved));
  assert.equal(phoneViewKey(world, 0, 6), phoneViewKey(moved, 0, 6));
});

test('Mac A-pass during an own pass does not defend, but contains against an opponent carrier', () => {
  const ownPass = liveWorldWithoutCarrier(0);
  const human = ownPass.players.find((player) => player.id === ownPass.controlled[0])!;
  const receiver = ownPass.players.find((player) => player.team === 0 && player.id !== human.id)!;
  const enemy = ownPass.players.find((player) => player.team === 1)!;
  human.x = 0; human.z = 0;
  receiver.x = 12; receiver.z = 0;
  enemy.x = 2; enemy.z = 0;
  ownPass.ball.y = 1.5;
  ownPass.passTarget = receiver.id;
  const beforeX = human.x;
  stepWorld(ownPass, STEP, new Map([[human.id, { move: { x: 0, z: 0 }, heldAction: 'pass' }]]));
  assert.equal(possessionTeam(ownPass), 0);
  assert.equal(human.x, beforeX);
  assert.notEqual(human.action, 'jockey');

  const defending = liveWorldWithCarrier(1);
  const defender = defending.players.find((player) => player.id === defending.controlled[0])!;
  const carrier = defending.players.find((player) => player.id === defending.carrierId)!;
  defender.x = -2; defender.z = 0;
  carrier.x = 0; carrier.z = 0;
  defending.ball.x = carrier.x; defending.ball.z = carrier.z;
  const beforeDefendingX = defender.x;
  stepWorld(defending, STEP, new Map([[defender.id, { move: { x: 0, z: 0 }, heldAction: 'pass' }]]));
  assert.equal(defending.players.find((player) => player.id === defending.controlled[0])?.team, 0);
  assert.ok(defender.x > beforeDefendingX);
  assert.equal(defender.action, 'jockey');
});
