import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BPM, FAST, JINGLE_DONE, JINGLE_WIN, SONG, STEPS, Sequencer, hz, midi, type Note } from '../src/os/arcade/games/palmdrive/music.ts';

const STEP = 60 / BPM / 4;

test('note names map to MIDI numbers and pitches', () => {
  assert.equal(midi('A4'), 69);
  assert.equal(midi('C4'), 60);
  assert.equal(midi('F#4'), 66);
  assert.equal(hz(69), 440);
  assert.ok(Math.abs(hz(81) - 880) < 1e-9);
  assert.throws(() => midi('H2'));
});

test('the song is sixteen bars of lead, bass and drums that fit their bars', () => {
  assert.equal(STEPS, 256);
  assert.equal(SONG.length, STEPS);
  const all = SONG.flat();
  for (const voice of ['lead', 'bass', 'kick', 'hat'] as const) assert.ok(all.some((n) => n.voice === voice), voice);
  for (let step = 0; step < STEPS; step++) {
    for (const n of SONG[step]) {
      assert.equal(n.step, step);
      assert.ok(n.len >= 1);
      if (n.voice === 'lead') {
        // melody notes stay in a singable range and never run past the end of their bar
        assert.ok(n.midi >= midi('C5') && n.midi <= midi('G6'), `lead ${n.midi} at ${step}`);
        assert.ok((step % 16) + n.len <= 16, `lead note at ${step} runs into the next bar`);
      }
      if (n.voice === 'bass') assert.ok(n.midi >= midi('C2') && n.midi <= midi('G3'));
    }
  }
  // one melody note at a time, and every bar starts on the downbeat with bass and kick
  for (let step = 0; step < STEPS; step++) assert.ok(SONG[step].filter((n) => n.voice === 'lead').length <= 1);
  for (let bar = 0; bar < 16; bar++) {
    const voices = SONG[bar * 16].map((n) => n.voice);
    assert.ok(voices.includes('bass') && voices.includes('kick'), `bar ${bar + 1}`);
  }
});

test('the melody never overlaps itself', () => {
  let freeAt = 0;
  for (let step = 0; step < STEPS; step++) {
    for (const n of SONG[step]) {
      if (n.voice !== 'lead') continue;
      assert.ok(step >= freeAt, `lead note at ${step} starts before the last one ends`);
      freeAt = step + n.len;
    }
  }
});

test('the finish jingles climb for a podium and settle home otherwise', () => {
  assert.ok(JINGLE_WIN.at(-1)!.midi > JINGLE_WIN[0].midi);
  assert.ok(JINGLE_WIN.every((n, i) => i === 0 || n.step > JINGLE_WIN[i - 1].step));
  assert.ok(JINGLE_DONE.every((n, i) => i === 0 || n.step > JINGLE_DONE[i - 1].step));
  assert.ok(JINGLE_DONE.length >= 3 && JINGLE_WIN.length >= 3);
});

function record() {
  const played: { note: Note; at: number; stepLen: number }[] = [];
  let now = 0;
  const seq = new Sequencer((note, delay, stepLen) => played.push({ note, at: now + delay, stepLen }));
  return {
    played,
    seq,
    run(from: number, to: number, fast = false, frame = 1 / 60) {
      for (now = from; now < to; now += frame) seq.tick(now, fast);
    },
  };
}

test('the sequencer schedules every note once, a little ahead, on the beat', () => {
  const rec = record();
  rec.run(0, STEPS * STEP + 0.01);
  // a whole loop went out: every note of the song exactly once (plus the start of the next loop, scheduled ahead)
  const firstLoop = rec.played.filter((p) => p.at < 0.05 + STEPS * STEP - 1e-6);
  assert.equal(firstLoop.length, SONG.flat().length);
  for (const p of firstLoop) assert.ok(Math.abs(p.at - (0.05 + p.note.step * STEP)) < 1e-6, `step ${p.note.step} at ${p.at}`);
  for (const p of rec.played) assert.ok(Math.abs(p.stepLen - STEP) < 1e-12);
  // and it keeps looping from the top
  const second = rec.played.filter((p) => p.at >= 0.05 + STEPS * STEP - 1e-6);
  assert.ok(second.length > 0 && second.every((p) => p.note.step < 8));
});

test('the final lap plays faster', () => {
  const rec = record();
  rec.run(0, 4, true);
  const fast = 60 / (BPM * FAST) / 4;
  assert.ok(rec.played.every((p) => Math.abs(p.stepLen - fast) < 1e-12));
  const kicks = rec.played.filter((p) => p.note.voice === 'kick').map((p) => p.at);
  assert.ok(Math.abs(kicks[1] - kicks[0] - 8 * fast) < 1e-6);
});

test('after a pause the music picks up where it left off instead of rushing to catch up', () => {
  const rec = record();
  rec.run(0, 2);
  const before = rec.played.length;
  const lastStep = rec.played.at(-1)!.note.step;
  // nothing ticks for ten seconds (paused, or the tab was hidden)
  rec.run(12, 12.5);
  const after = rec.played.slice(before);
  assert.ok(after.length > 0);
  assert.ok(after[0].at >= 12, 'nothing is scheduled in the past');
  // it carries on from the next step that has a note (odd steps are often rests)
  assert.ok(after[0].note.step > lastStep && after[0].note.step <= lastStep + 2, `resumed at step ${after[0].note.step} after ${lastStep}`);
  // only about half a second of music, not ten seconds' worth
  assert.ok(after.filter((p) => p.note.voice === 'kick').length <= 4);
  rec.seq.reset();
  assert.equal(rec.seq.step, 0);
  assert.equal(rec.seq.at, null);
});
