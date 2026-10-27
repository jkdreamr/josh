import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerForSeat, seatForPlayer } from '../src/os/arcade/games/soccer/seats.ts';

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
