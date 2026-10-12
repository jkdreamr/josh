import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBeatState,
  degreeCount,
  DRUM_TRACKS,
  GROOVES,
  remixPattern,
  seededRng,
  setPatternLength,
  SYNTH_TRACKS,
  TRACKS,
} from '../src/os/games/beat.ts';

test('the same seed gives the same remix and seeds make distinct variations', () => {
  const state = createBeatState('boom bap');
  const pattern = state.patterns[0];
  assert.deepEqual(remixPattern(state, pattern, seededRng(42)), remixPattern(state, pattern, seededRng(42)));
  const outputs = new Set(
    Array.from({ length: 10 }, (_, index) => JSON.stringify(remixPattern(state, pattern, seededRng(index + 1)))),
  );
  assert.ok(outputs.size >= 3, `expected at least 3 distinct remixes, got ${outputs.size}`);
});

test('groove remixes preserve anchors, loop tails, input data, and musical ranges', () => {
  for (const groove of GROOVES) {
    const state = createBeatState(groove);
    for (const seed of [1, 2, 3, 42, 999]) {
      for (const length of [8, 16, 32] as const) {
        const input = setPatternLength(state.patterns[0], length);
        const original = structuredClone(input);
        const output = remixPattern(state, input, seededRng(seed));
        const fillStart = length - 4;
        const anchors: Array<[typeof TRACKS[number], number]> = [];
        for (let bar = 0; bar < length; bar += 16) {
          anchors.push(['kick', bar]);
          for (const step of [bar + 4, bar + 12]) {
            if (step < length) {
              anchors.push(['snare', step], ['clap', step]);
            }
          }
        }
        for (const [track, step] of anchors) {
          assert.equal(output.steps[track][step], original.steps[track][step], `${groove} seed ${seed} length ${length} ${track} anchor ${step}`);
        }
        assert.notDeepEqual(output, input, `${groove} seed ${seed} length ${length} should vary`);
        for (const track of TRACKS) {
          for (let step = length; step < output.length; step += 1) {
            assert.equal(output.steps[track][step], original.steps[track][step], `${groove} seed ${seed} length ${length} ${track} tail ${step}`);
          }
          assert.ok(output.steps[track].every((velocity) => velocity >= 0 && velocity <= 3));
        }
        for (const track of SYNTH_TRACKS) {
          for (let step = length; step < output.length; step += 1) {
            assert.equal(output.notes[track][step], original.notes[track][step], `${groove} seed ${seed} length ${length} ${track} note tail ${step}`);
          }
          for (let step = 0; step < length; step += 1) {
            if (output.steps[track][step]) {
              assert.ok(output.notes[track][step] >= 0 && output.notes[track][step] < degreeCount(state.scale), `${groove} seed ${seed} length ${length} ${track} degree ${step}`);
            }
          }
        }
        assert.deepEqual(input, original, `${groove} seed ${seed} length ${length} input was mutated`);

        const inputDrums = DRUM_TRACKS.reduce((count, track) => count + original.steps[track].slice(0, fillStart).filter(Boolean).length, 0);
        const retainedDrums = DRUM_TRACKS.reduce(
          (count, track) => count + original.steps[track].slice(0, fillStart).filter((velocity, step) => velocity > 0 && output.steps[track][step] > 0).length,
          0,
        );
        assert.ok(retainedDrums >= inputDrums * 0.6, `${groove} seed ${seed} length ${length} retained ${retainedDrums}/${inputDrums} pre-fill drum cells`);
      }
    }
  }
});
