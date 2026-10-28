import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, type Team } from '../src/os/arcade/games/soccer/logic.ts';
import { phoneAttacking } from '../src/os/arcade/games/soccer/input.ts';
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
