// Background music: every style writes a full song for any game, the same one each time, inside a sane range.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MUSIC_STYLES, STYLES, Sequencer, writeSong, type Note } from '../src/os/arcade/kit/music-core.ts';

for (const style of MUSIC_STYLES) {
  test(`${style} writes a sixteen bar song`, () => {
    const song = writeSong(style, 'snake');
    assert.equal(song.bars, 16);
    assert.equal(song.steps.length, 16 * 16);
    assert.equal(song.bpm, STYLES[style].bpm);
    const notes = song.steps.flat();
    const lead = notes.filter((n) => n.voice === 'lead');
    assert.ok(lead.length >= 16, 'the melody plays');
    for (const n of notes) {
      assert.ok(n.len >= 1 && Number.isInteger(n.len), `note length ${n.len}`);
      if (n.voice === 'kick' || n.voice === 'snare' || n.voice === 'hat' || n.voice === 'open') continue;
      assert.ok(n.midi >= 28 && n.midi <= 96, `${n.voice} midi ${n.midi} out of range`);
    }
    // no melody note runs past the end of its bar
    song.steps.forEach((at, i) => at.filter((n) => n.voice === 'lead').forEach((n) => assert.ok((i % 16) + n.len <= 16)));
  });
}

test('songs are stable per game and differ between games', () => {
  assert.deepEqual(writeSong('chip', 'snake'), writeSong('chip', 'snake'));
  const tune = (id: string) => JSON.stringify(writeSong('chip', id).steps.map((at) => at.filter((n) => n.voice === 'lead')));
  assert.notEqual(tune('snake'), tune('dino'));
});

test('the sequencer schedules ahead without bunching up after a gap', () => {
  const song = writeSong('house', 'slither');
  const played: { note: Note; delay: number }[] = [];
  const seq = new Sequencer(song, (note, delay) => played.push({ note, delay }));
  seq.tick(10);
  const first = played.length;
  assert.ok(first > 0);
  for (const p of played) assert.ok(p.delay >= 0 && p.delay < 0.5);
  // a long gap (a pause) picks up from now instead of replaying everything it missed
  played.length = 0;
  seq.tick(100);
  assert.ok(played.length <= first + 8);
  for (const p of played) assert.ok(p.delay >= 0 && p.delay < 0.5);
});
