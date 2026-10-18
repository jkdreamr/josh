// Plays a game's background music (music-core.ts) on the arcade synth while a round is under way. The shell runs it
// for every game whose meta names a `music` style; the Music button in the shell's control row turns it off.
import { useEffect, useMemo } from 'react';
import { Sequencer, writeSong, type MusicStyle, type Note, type StyleDef, STYLES } from './music-core';
import { sfx, useMusicOn } from './sfx';

const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

function playNote(s: StyleDef, note: Note, delay: number, stepLen: number) {
  const dur = note.len * stepLen;
  const { inst } = s;
  const d = inst.drums;
  const music = true;
  switch (note.voice) {
    case 'lead':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.92, type: inst.lead.type, vol: inst.lead.vol, delay, music });
      break;
    case 'bass':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.85, type: inst.bass.type, vol: inst.bass.vol, delay, music });
      break;
    case 'chord':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.9, type: inst.chord.type, vol: inst.chord.vol, delay, music });
      break;
    case 'arp':
      sfx.tone({ freq: hz(note.midi), dur: stepLen * 0.9, type: inst.arp.type, vol: inst.arp.vol, delay, music });
      break;
    case 'kick':
      sfx.tone({ freq: 150, to: 42, dur: 0.18, type: 'sine', vol: 0.22 * d, delay, music });
      break;
    case 'snare':
      sfx.noise(0.1, 0.08 * d, delay, music);
      sfx.tone({ freq: 190, to: 120, dur: 0.07, type: 'triangle', vol: 0.06 * d, delay, music });
      break;
    case 'hat':
      sfx.noise(0.025, 0.016 * d, delay, music);
      break;
    case 'open':
      sfx.noise(0.09, 0.03 * d, delay, music);
      break;
  }
}

/**
 * Plays `style` for game `id` while `playing`. Each round starts the song from the top; a pause holds its place and
 * fades out what was already scheduled.
 */
export function useBackgroundMusic(id: string, style: MusicStyle | undefined, round: number, playing: boolean) {
  const [on] = useMusicOn();
  // a new round starts the song again
  const seq = useMemo(() => {
    if (!style) return null;
    const s = STYLES[style];
    return new Sequencer(writeSong(style, id), (note, delay, stepLen) => playNote(s, note, delay, stepLen));
  }, [id, style, round]);

  useEffect(() => {
    if (!seq || !playing || !on) return;
    let live = false;
    const tick = () => {
      const now = sfx.clock();
      if (now === null) {
        // muted or suspended: start cleanly when sound comes back
        live = false;
        seq.hold();
        return;
      }
      if (!live) {
        sfx.fadeMusic(true);
        live = true;
      }
      seq.tick(now);
    };
    tick();
    const timer = window.setInterval(tick, 50);
    return () => {
      window.clearInterval(timer);
      seq.hold();
      sfx.fadeMusic(false);
    };
  }, [seq, playing, on]);
}
