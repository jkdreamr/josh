import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advancePosition,
  beatStepTime,
  changeStepDegree,
  clearPattern,
  createBeatState,
  createEmptyState,
  createHistory,
  cycleVelocity,
  decayMultiplier,
  decodeBeatState,
  degreeCount,
  delayTime,
  emptyPattern,
  encodeBeatState,
  filterSettings,
  isPatternEmpty,
  nearestStep,
  pitchForDegree,
  pushHistory,
  randomizePattern,
  redoHistory,
  scaleNotes,
  seededRng,
  setPatternLength,
  setStep,
  settleHistory,
  startPosition,
  swingOffset,
  SYNTH_TRACKS,
  tapTempo,
  toggleStep,
  TRACKS,
  undoHistory,
  updateTrack,
  variation,
  normalizePattern,
  type BeatState,
} from '../src/os/games/beat.ts';

function normalize(state: BeatState): BeatState {
  return { ...state, patterns: state.patterns.map(normalizePattern) };
}

const V1_HOUSE_LINK = 'eyJ2IjoxLCJiIjoxMjQsInMiOjgsImsiOiJEIG1pbm9yIiwicCI6WzQzNjksNDExMiwxNzQ3NiwxNzQ3Niw0MTEyLDE4NzYxLDE3NDc2LDgyMjRdLCJuIjpbIjAxMjM0MDEyMzQwMTIzNDAiLCIwMTIzNDAxMjM0MDEyMzQwIiwiMDEyMzQwMTIzNDAxMjM0MCJdfQ';

function busyState(): BeatState {
  let state = createBeatState('trap');
  state = { ...state, bpm: 173, swing: 33, root: 7, scale: 'dorian', kit: 'acoustic', current: 2, song: [0, 1, 1, 2, 3, 0, 2], songMode: true, fx: { filter: 12, reverb: 77, delay: 100 } };
  state = updateTrack(state, 'kick', { volume: 100, pitch: -12, decay: 0, muted: true });
  state = updateTrack(state, 'lead', { volume: 0, pitch: 12, decay: 100 });
  const patterns = state.patterns.slice();
  patterns[2] = setPatternLength(emptyPattern(), 32);
  patterns[2] = setStep(patterns[2], 'clap', 31, 3);
  patterns[2] = setStep(patterns[2], 'bass', 17, 1);
  patterns[2] = changeStepDegree(patterns[2], 'bass', 17, 9, 'dorian');
  patterns[3] = setPatternLength(emptyPattern(), 8);
  return { ...state, patterns };
}

test('every preset survives the link codec exactly', () => {
  for (const preset of ['kelix lofi', 'boom bap', 'house', 'trap'] as const) {
    const state = createBeatState(preset);
    assert.deepEqual(decodeBeatState(encodeBeatState(state)), normalize(state));
  }
});

test('patterns, lengths, velocities, notes, mixer and song all round-trip in the link', () => {
  const state = busyState();
  const encoded = encodeBeatState(state);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.ok(encoded.length < 700, `link payload is ${encoded.length} chars`);
  assert.deepEqual(decodeBeatState(encoded), normalize(state));
  assert.notDeepEqual(decodeBeatState(encoded), createBeatState('trap'));
});

test('empty patterns are skipped so a one-pattern beat makes a short link', () => {
  const state = createEmptyState();
  const encoded = encodeBeatState(state);
  assert.ok(encoded.length < 80, `empty beat is ${encoded.length} chars`);
  assert.deepEqual(decodeBeatState(encoded), state);
});

test('links from the first Beat Pad still open with their groove, key and tempo', () => {
  const state = decodeBeatState(V1_HOUSE_LINK);
  assert.ok(state);
  assert.equal(state.bpm, 124);
  assert.equal(state.swing, 8);
  assert.equal(state.root, 2);
  assert.equal(state.scale, 'minor pentatonic');
  assert.equal(state.kit, 'lofi');
  const pattern = state.patterns[0];
  assert.equal(pattern.length, 16);
  assert.deepEqual(pattern.steps.kick.slice(0, 16), [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]);
  assert.deepEqual(pattern.steps.bass.slice(0, 16).map((v) => (v ? 1 : 0)), [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  assert.deepEqual(pattern.notes.lead.slice(0, 16), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]);
  assert.ok(state.patterns.slice(1).every(isPatternEmpty));
  assert.deepEqual(decodeBeatState(encodeBeatState(state)), state);
});

test('damaged or foreign links are rejected instead of throwing', () => {
  const good = encodeBeatState(createBeatState('house'));
  assert.equal(decodeBeatState(''), null);
  assert.equal(decodeBeatState(`${good}!`), null);
  assert.equal(decodeBeatState(good.slice(0, -6)), null);
  assert.equal(decodeBeatState(`${good}AAAA`), null);
  assert.equal(decodeBeatState('eyJ2IjoxfQ'), null);
  assert.equal(decodeBeatState('AwAA'), null);
  assert.equal(decodeBeatState('x'.repeat(5000)), null);
});

test('swing delays offbeat steps by swing times half of a sixteenth', () => {
  const straight = beatStepTime(1, 120, 0);
  const delayed = beatStepTime(1, 120, 40);
  assert.ok(Math.abs(swingOffset(1, 120, 40) - 0.025) < 1e-12);
  assert.ok(Math.abs(delayed - straight - 0.025) < 1e-12);
  assert.equal(swingOffset(2, 120, 40), 0);
  assert.equal(swingOffset(3, 120, 200), swingOffset(3, 120, 60));
});

test('delay follows the tempo as a dotted eighth and the filter opens at the middle', () => {
  assert.ok(Math.abs(delayTime(120) - 0.375) < 1e-12);
  assert.equal(filterSettings(50).type, 'highpass');
  assert.ok(filterSettings(50).frequency <= 20);
  assert.equal(filterSettings(0).type, 'lowpass');
  assert.ok(filterSettings(0).frequency < 200);
  assert.ok(filterSettings(49).frequency > 19000);
  assert.ok(filterSettings(100).frequency > 3000);
  assert.equal(decayMultiplier(50), 1);
  assert.ok(decayMultiplier(0) < 0.5 && decayMultiplier(100) > 2);
});

test('the transport loops the pattern, queues the selected pattern at the loop point, and follows the song', () => {
  const state = busyState();
  const loop = { ...state, songMode: false, current: 3 };
  assert.deepEqual(startPosition(loop), { pattern: 3, step: 0, songIndex: 0 });
  let position = startPosition(loop);
  for (let index = 0; index < 7; index += 1) position = advancePosition(position, loop);
  assert.equal(position.step, 7);
  assert.deepEqual(advancePosition(position, { ...loop, current: 0 }), { pattern: 0, step: 0, songIndex: 0 });
  assert.deepEqual(advancePosition({ pattern: 2, step: 31, songIndex: 0 }, loop), { pattern: 3, step: 0, songIndex: 0 });

  assert.deepEqual(startPosition(state), { pattern: 0, step: 0, songIndex: 0 });
  assert.deepEqual(advancePosition({ pattern: 0, step: 15, songIndex: 0 }, state), { pattern: 1, step: 0, songIndex: 1 });
  assert.deepEqual(advancePosition({ pattern: 2, step: 6, songIndex: 6 }, state), { pattern: 2, step: 7, songIndex: 6 });
  assert.deepEqual(advancePosition({ pattern: 2, step: 31, songIndex: 6 }, state), { pattern: 0, step: 0, songIndex: 0 });
});

test('tap tempo averages recent taps and starts over after a long pause', () => {
  assert.equal(tapTempo([0]), null);
  assert.equal(tapTempo([0, 500, 1000, 1500]), 120);
  assert.equal(tapTempo([0, 600, 1300, 1900]), 95);
  assert.equal(tapTempo([0, 500, 1000, 9000, 9400]), 150);
  assert.equal(tapTempo([0, 100]), 220);
});

test('live hits quantize to the nearest scheduled step', () => {
  const scheduled = [{ time: 1.0, step: 0, pattern: 0 }, { time: 1.125, step: 1, pattern: 0 }, { time: 1.25, step: 2, pattern: 0 }];
  assert.deepEqual(nearestStep(1.07, scheduled), { step: 1, pattern: 0 });
  assert.deepEqual(nearestStep(1.2, scheduled), { step: 2, pattern: 0 });
  assert.equal(nearestStep(1, []), null);
});

test('scale lock keeps every degree inside the chosen scale and octave range', () => {
  assert.equal(degreeCount('minor pentatonic'), 11);
  assert.equal(degreeCount('major'), 15);
  const notes = scaleNotes('bass', 2, 'minor pentatonic');
  assert.deepEqual(notes.slice(0, 6).map((n) => n.name), ['D2', 'F2', 'G2', 'A2', 'C3', 'D3']);
  assert.equal(pitchForDegree('keys', 9, 'minor pentatonic', 0).frequency, 220);
  assert.equal(pitchForDegree('keys', 9, 'minor pentatonic', 5).frequency, 440);
  const pattern = changeStepDegree(emptyPattern(), 'lead', 0, 40, 'blues');
  assert.equal(pattern.notes.lead[0], degreeCount('blues') - 1);
  assert.equal(changeStepDegree(pattern, 'lead', 0, -40, 'blues').notes.lead[0], 0);
});

test('steps toggle on at normal velocity and cycle soft, normal, accent', () => {
  let pattern = emptyPattern();
  pattern = toggleStep(pattern, 'snare', 4);
  assert.equal(pattern.steps.snare[4], 2);
  pattern = cycleVelocity(pattern, 'snare', 4);
  assert.equal(pattern.steps.snare[4], 3);
  pattern = cycleVelocity(pattern, 'snare', 4);
  assert.equal(pattern.steps.snare[4], 1);
  pattern = toggleStep(pattern, 'snare', 4);
  assert.equal(pattern.steps.snare[4], 0);
  assert.equal(cycleVelocity(pattern, 'snare', 4).steps.snare[4], 2);
  assert.ok(isPatternEmpty(clearPattern(toggleStep(pattern, 'kick', 0))));
});

test('randomize stays musical in every kit: kick on the one, a backbeat, pulse hats, notes in range', () => {
  for (const kit of ['808', 'acoustic', 'lofi', 'house'] as const) {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const state = { ...createBeatState(), kit, scale: 'minor pentatonic' as const };
      const pattern = randomizePattern(state, setPatternLength(emptyPattern(), 32), seededRng(seed));
      assert.equal(pattern.steps.kick[0], 3, `${kit} ${seed} kick on the one`);
      assert.equal(pattern.steps.kick[16], 3, `${kit} ${seed} kick on bar two`);
      const backbeat = (pattern.steps.snare[4] || pattern.steps.clap[4]) && (pattern.steps.snare[12] || pattern.steps.clap[12]);
      assert.ok(backbeat, `${kit} ${seed} backbeat`);
      const hats = pattern.steps.hat.filter(Boolean).length + pattern.steps['open hat'].filter(Boolean).length;
      assert.ok(hats >= 8, `${kit} ${seed} hats carry the pulse (${hats})`);
      const kicks = pattern.steps.kick.filter(Boolean).length;
      assert.ok(kicks >= 2 && kicks <= 12, `${kit} ${seed} kick density ${kicks}`);
      for (const track of SYNTH_TRACKS) {
        for (let step = 0; step < 32; step += 1) {
          const degree = pattern.notes[track][step];
          assert.ok(degree >= 0 && degree < degreeCount('minor pentatonic'), `${kit} ${seed} ${track} degree ${degree}`);
        }
      }
      assert.ok(pattern.steps.bass.filter(Boolean).length >= 1, `${kit} ${seed} has a bass line`);
      assert.ok(pattern.steps.lead.filter(Boolean).length >= 1, `${kit} ${seed} has a lead`);
      for (const track of TRACKS) assert.ok(pattern.steps[track].every((velocity) => velocity >= 0 && velocity <= 3));
    }
  }
  const a = randomizePattern(createBeatState(), emptyPattern(), seededRng(5));
  const b = randomizePattern(createBeatState(), emptyPattern(), seededRng(5));
  assert.deepEqual(a, b);
});

test('a variation keeps the groove and adds a fill', () => {
  const base = createBeatState('boom bap').patterns[0];
  const fill = variation(base);
  assert.deepEqual(fill.steps.kick.slice(0, 12), base.steps.kick.slice(0, 12));
  assert.equal(fill.steps['open hat'][15], 2);
  assert.notDeepEqual(fill.steps.lead, base.steps.lead);
});

test('history undoes and redoes, folding a slider drag into one step', () => {
  let history = createHistory(1);
  history = pushHistory(history, 2);
  history = pushHistory(history, 3, 'tempo');
  history = pushHistory(history, 4, 'tempo');
  history = pushHistory(history, 5, 'tempo');
  assert.equal(history.present, 5);
  assert.deepEqual(history.past, [1, 2]);
  history = settleHistory(history);
  history = pushHistory(history, 6, 'tempo');
  assert.deepEqual(history.past, [1, 2, 5]);
  history = undoHistory(history);
  assert.equal(history.present, 5);
  history = undoHistory(history);
  assert.equal(history.present, 2);
  history = redoHistory(history);
  assert.equal(history.present, 5);
  history = pushHistory(history, 9);
  assert.deepEqual(history.future, []);
  assert.equal(undoHistory(createHistory(0)).present, 0);
  let long = createHistory(0);
  for (let index = 1; index <= 150; index += 1) long = pushHistory(long, index);
  assert.equal(long.past.length, 100);
});
