import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerForSeat, seatForPlayer } from '../src/os/arcade/games/soccer/seats.ts';

test('phone seats control the intended Soccer team in every online mode', () => {
  assert.equal(playerForSeat(1, true, 'cpu'), 1);
  assert.equal(playerForSeat(1, true, 'versus'), 1);
  assert.equal(playerForSeat(2, true, 'versus'), 6);
  assert.equal(playerForSeat(1, true, 'coop'), 1);
  assert.equal(playerForSeat(2, true, 'coop'), 2);
  assert.equal(seatForPlayer(1, true, 'versus'), 1);
  assert.equal(seatForPlayer(6, true, 'versus'), 2);
  assert.equal(seatForPlayer(1, true, 'coop'), 1);
  assert.equal(seatForPlayer(2, true, 'coop'), 2);
  assert.equal(seatForPlayer(6, true, 'coop'), 99);
});
