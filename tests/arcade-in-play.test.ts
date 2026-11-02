import assert from 'node:assert/strict';
import test from 'node:test';
import { gameInPlay, reportInPlay } from '../src/os/arcade/playing.ts';

test('a game is in play while any window reports a round under way on screen', () => {
  assert.equal(gameInPlay(), false);
  const stopA = reportInPlay();
  const stopB = reportInPlay();
  assert.equal(gameInPlay(), true);
  stopA();
  assert.equal(gameInPlay(), true);
  stopB();
  assert.equal(gameInPlay(), false);
  // (stopping twice is harmless)
  stopB();
  assert.equal(gameInPlay(), false);
});
