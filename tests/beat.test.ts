import assert from 'node:assert/strict';
import test from 'node:test';
import { beatStepTime, createBeatState, decodeBeatState, encodeBeatState, PENTATONIC_NOTES, swingOffset } from '../src/os/games/beat.ts';

test('pattern, tempo, swing, and key encode and decode as a compact link payload', () => {
  const state = createBeatState('house');
  const encoded = encodeBeatState(state);
  assert.deepEqual(decodeBeatState(encoded), state);
  assert.equal(decodeBeatState(`${encoded}!`), null);
});

test('swing delays offbeat steps by swing times half of a sixteenth', () => {
  const straight = beatStepTime(1, 120, 0);
  const delayed = beatStepTime(1, 120, 40);
  assert.ok(Math.abs(swingOffset(1, 120, 40) - 0.025) < 1e-12);
  assert.ok(Math.abs(delayed - straight - 0.025) < 1e-12);
  assert.equal(swingOffset(2, 120, 40), 0);
});

test('pentatonic note table includes A4 at concert pitch', () => {
  assert.equal(PENTATONIC_NOTES['D minor'].find((note) => note.name === 'A4')?.frequency, 440);
});
