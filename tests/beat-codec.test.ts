import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeStepDegree,
  createBeatState,
  createEmptyState,
  decodeBeatState,
  encodeBeatState,
  emptyPattern,
  GROOVES,
  MAX_DEGREE,
  normalizePattern,
  recordHit,
  setPatternLength,
  setStep,
  updateTrack,
  type BeatState,
} from '../src/os/games/beat.ts';

function normalize(state: BeatState): BeatState {
  return { ...state, patterns: state.patterns.map(normalizePattern) };
}

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

function decodeBytes(encoded: string): Uint8Array {
  return Uint8Array.from(Buffer.from(encoded, 'base64url'));
}

function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

const HOUSE_V2 = 'AnwGAgIDADIWFABQDDJQDDJQDDJQDDJQDDJQDDJQDDJQDDIEQAMBAwMDAwAAAAAQEBAQICAgIAACAAKCIIIgICAgIAAIAAgQAgQkQCAyBRAyBCRDFjIEEDKUIUMQcgQBAwMDBwAAABAQEBAQICAgoAACAAKCIIIgICAgICAoICgQAgQkQCAyBRAyBCRDFjIEEDSUIUMScgQ';
const EMPTY_V2 = 'AlQaCQACADIUAABQDDJQDDJQDDJQDDJQDDJQDDJQDDJQDDIBAAA';
const BUSY_V2 = 'Aq0hBwQBEgxNZAFkAABQDDJQDDJQDDJQDDJQDDJQDDJQDDIHlCMPAQOAICAAAwADIoYiZgCAAIAAAAACAoAgIIAAgAAgICAgEDIEAUMSMgMQUgQhQ0AyBBA3BCVDFzIJAQOAICQAAwATIoYiZgCAAIAAAAACAoAgIIAAgAAAAAAAEDIEAUMSMgMQUgQhQ0AyBBA5BCVDGTIJAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAQMgQhQxAyBLFDEDIEIUMQEDIEIUMQMgQhQxAyBCFDEBAyBCFDEDIEIUMQMgQhQxAAAAAAAAAAAAAAAAAAAAAAABAyBCEQMgQhEDIEIQ';
const V1_HOUSE_LINK = 'eyJ2IjoxLCJiIjoxMjQsInMiOjgsImsiOiJEIG1pbm9yIiwicCI6WzQzNjksNDExMiwxNzQ3NiwxNzQ3Niw0MTEyLDE4NzYxLDE3NDc2LDgyMjRdLCJuIjpbIjAxMjM0MDEyMzQwMTIzNDAiLCIwMTIzNDAxMjM0MDEyMzQwIiwiMDEyMzQwMTIzNDAxMjM0MCJdfQ';

test('main-branch v2 links decode and null-groove output stays byte-identical', () => {
  const busy = busyState();
  const busyFixtureState = { ...busy, tracks: { ...busy.tracks, lead: createBeatState('trap').tracks.lead } };
  const fixtures = [
    [HOUSE_V2, createBeatState('house')],
    [EMPTY_V2, createEmptyState()],
    [BUSY_V2, busyFixtureState],
  ] as const;
  for (const [fixture, state] of fixtures) {
    assert.deepEqual(decodeBeatState(fixture), { ...normalize(state), groove: null });
    assert.equal(encodeBeatState({ ...state, groove: null }), fixture);
  }
});

test('all starter grooves round-trip with their groove metadata in v3', () => {
  for (const groove of GROOVES) {
    const state = createBeatState(groove);
    const encoded = encodeBeatState(state);
    assert.equal(decodeBytes(encoded)[0], 3, groove);
    assert.deepEqual(decodeBeatState(encoded), normalize(state), groove);
  }
});

test('Reggaeton has the specified starter rhythm and sound', () => {
  const state = createBeatState('reggaeton');
  const pattern = state.patterns[0];
  assert.equal(state.bpm, 94);
  assert.equal(state.kit, '808');
  assert.deepEqual(pattern.steps.kick.slice(0, 16).flatMap((velocity, step) => velocity ? [step] : []), [0, 4, 8, 12]);
  assert.deepEqual(pattern.steps.snare.slice(0, 16).flatMap((velocity, step) => velocity ? [step] : []), [3, 6, 11, 14]);
});

test('codec rejects missing, invalid, or extra groove trailers', () => {
  const v3 = decodeBytes(encodeBeatState(createBeatState('house')));
  for (const trailer of [0, 200]) {
    const damaged = v3.slice();
    damaged[damaged.length - 1] = trailer;
    assert.equal(decodeBeatState(encodeBytes(damaged)), null);
  }
  assert.equal(decodeBeatState(encodeBytes(v3.slice(0, -1))), null);

  const v2 = decodeBytes(EMPTY_V2);
  assert.equal(decodeBeatState(encodeBytes(Uint8Array.from([...v2, 1]))), null);
});

test('v1 links decode without groove metadata', () => {
  assert.equal(decodeBeatState(V1_HOUSE_LINK)?.groove, null);
});

test('recordHit records velocity and clamped synth degrees without unnecessary copies', () => {
  const blank = emptyPattern();
  const recorded = recordHit(blank, 'kick', 2);
  assert.equal(recorded.steps.kick[2], 2);
  const accented = setStep(blank, 'snare', 3, 3);
  assert.equal(recordHit(accented, 'snare', 3).steps.snare[3], 3);

  const synthHit = recordHit(blank, 'lead', 4, MAX_DEGREE + 10);
  assert.equal(synthHit.steps.lead[4], 2);
  assert.equal(synthHit.notes.lead[4], MAX_DEGREE);
  assert.equal(recordHit(synthHit, 'lead', 4, MAX_DEGREE), synthHit);
  assert.equal(recordHit(blank, 'kick', 40), blank);
});
