// Background music for arcade games: a few styles, and a song written for each game from its id. A style fixes the
// tempo, the scale, the chord progressions, the drums and the instruments; the game's id seeds the key and the
// melody, so two games in the same style still have their own tune. Pure data and a scheduler, so it runs under node;
// music.ts plays the notes on the arcade synth.
import { mulberry32 } from './party-core.ts';

export type MusicStyle = 'chip' | 'bouncy' | 'synth' | 'house' | 'drive' | 'tension' | 'lofi' | 'ambient';
export const MUSIC_STYLES: readonly MusicStyle[] = ['chip', 'bouncy', 'synth', 'house', 'drive', 'tension', 'lofi', 'ambient'];

export type Voice = 'lead' | 'bass' | 'chord' | 'arp' | 'kick' | 'snare' | 'hat' | 'open';
/** `len` in 16th steps. Drums carry midi 0. */
export type Note = { voice: Voice; midi: number; len: number };

type Wave = OscillatorType;
export type Instrument = { type: Wave; vol: number };
/** A pattern over one bar of 16 steps: the steps something plays on. */
type Steps = readonly number[];

export type StyleDef = {
  bpm: number;
  /** Delay on every other 16th, as a share of a step (0 straight, 0.3 lazy). */
  swing: number;
  scale: 'major' | 'minor';
  /** Chords as scale degrees (0 is the tonic), one per bar. Each song uses two of these. */
  progressions: readonly (readonly number[])[];
  sevenths: boolean;
  /** Lowest and highest tonic, as midi numbers, for the bass octave (the lead sits two octaves up). */
  key: [number, number];
  drums: { kick: Steps; snare: Steps; hat: Steps; open?: Steps; fill?: boolean };
  /** Bass steps, with 'r' root, 'f' fifth or 'o' octave, and its length in steps. */
  bass: { at: readonly [number, 'r' | 'f' | 'o'][]; len: number };
  /** 'pad' holds the chord across the bar, 'stab' hits it on these steps. */
  chord: { mode: 'pad' | 'stab'; at: Steps; len: number } | null;
  /** Arpeggio steps (chord tones climbing), or null. */
  arp: Steps | null;
  /** Notes in a bar of melody (roughly), and the longest note in steps. */
  density: number;
  longest: number;
  inst: { lead: Instrument; bass: Instrument; chord: Instrument; arp: Instrument; drums: number };
};

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
const SIXTEENTHS = Array.from({ length: 16 }, (_, i) => i);
const OFFBEATS = [2, 6, 10, 14];

export const STYLES: Record<MusicStyle, StyleDef> = {
  // 8-bit: square lead, bouncing octave bass and a fast triangle arpeggio
  chip: {
    bpm: 150, swing: 0, scale: 'minor', sevenths: false, key: [43, 50],
    progressions: [[0, 5, 2, 6], [0, 3, 6, 2], [5, 6, 0, 0], [0, 6, 5, 4]],
    drums: { kick: [0, 8, 10], snare: [4, 12], hat: EIGHTHS, fill: true },
    bass: { at: EIGHTHS.map((s, i) => [s, i % 2 ? 'o' : 'r'] as [number, 'r' | 'o']), len: 2 },
    chord: null, arp: SIXTEENTHS, density: 6, longest: 4,
    inst: { lead: { type: 'square', vol: 0.032 }, bass: { type: 'triangle', vol: 0.16 }, chord: { type: 'square', vol: 0.012 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0.8 },
  },
  // playful and major: triangle lead, root and fifth bass, offbeat stabs
  bouncy: {
    bpm: 128, swing: 0.12, scale: 'major', sevenths: false, key: [48, 55],
    progressions: [[0, 3, 4, 0], [0, 5, 3, 4], [3, 4, 2, 5], [0, 4, 5, 3]],
    drums: { kick: [0, 8], snare: [4, 12], hat: OFFBEATS, fill: true },
    bass: { at: [[0, 'r'], [6, 'f'], [8, 'r'], [14, 'f']], len: 2 },
    chord: { mode: 'stab', at: OFFBEATS, len: 1 }, arp: null, density: 5, longest: 4,
    inst: { lead: { type: 'triangle', vol: 0.07 }, bass: { type: 'triangle', vol: 0.16 }, chord: { type: 'square', vol: 0.014 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0.75 },
  },
  // synthwave: saw pads, pulsing eighth bass, a slow lead
  synth: {
    bpm: 104, swing: 0, scale: 'minor', sevenths: false, key: [45, 50],
    progressions: [[0, 5, 2, 6], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 5, 4]],
    drums: { kick: [0, 8], snare: [4, 12], hat: EIGHTHS, fill: true },
    bass: { at: EIGHTHS.map((s) => [s, 'r'] as [number, 'r']), len: 2 },
    chord: { mode: 'pad', at: [0], len: 16 }, arp: [0, 3, 6, 8, 11, 14], density: 3, longest: 8,
    inst: { lead: { type: 'sawtooth', vol: 0.03 }, bass: { type: 'sawtooth', vol: 0.05 }, chord: { type: 'sawtooth', vol: 0.012 }, arp: { type: 'square', vol: 0.012 }, drums: 0.85 },
  },
  // four on the floor, offbeat bass and claps
  house: {
    bpm: 122, swing: 0, scale: 'minor', sevenths: true, key: [45, 52],
    progressions: [[0, 5, 2, 6], [0, 3, 0, 4], [5, 3, 0, 6], [0, 2, 5, 6]],
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: SIXTEENTHS.filter((s) => s % 4 !== 2), open: OFFBEATS, fill: true },
    bass: { at: [[2, 'r'], [6, 'r'], [10, 'r'], [14, 'f']], len: 2 },
    chord: { mode: 'stab', at: [2, 6, 10, 13], len: 2 }, arp: null, density: 4, longest: 4,
    inst: { lead: { type: 'sawtooth', vol: 0.03 }, bass: { type: 'triangle', vol: 0.17 }, chord: { type: 'square', vol: 0.014 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0.9 },
  },
  // rock: driving eighth bass, power chord stabs, a saw lead
  drive: {
    bpm: 140, swing: 0, scale: 'minor', sevenths: false, key: [40, 47],
    progressions: [[0, 5, 6, 0], [0, 6, 5, 6], [0, 3, 5, 4], [5, 6, 0, 0]],
    drums: { kick: [0, 6, 8], snare: [4, 12], hat: EIGHTHS, fill: true },
    bass: { at: EIGHTHS.map((s) => [s, 'r'] as [number, 'r']), len: 2 },
    chord: { mode: 'stab', at: [0, 6, 8], len: 2 }, arp: null, density: 5, longest: 4,
    inst: { lead: { type: 'sawtooth', vol: 0.034 }, bass: { type: 'square', vol: 0.045 }, chord: { type: 'sawtooth', vol: 0.014 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0.9 },
  },
  // suspense: a sixteenth pulse in the bass, sparse lead, low chords
  tension: {
    bpm: 118, swing: 0, scale: 'minor', sevenths: false, key: [40, 46],
    progressions: [[0, 0, 5, 6], [0, 5, 0, 4], [0, 3, 0, 6], [5, 4, 0, 0]],
    drums: { kick: [0, 8, 10], snare: [12], hat: SIXTEENTHS, fill: true },
    bass: { at: SIXTEENTHS.map((s) => [s, s === 14 ? 'f' : 'r'] as [number, 'r' | 'f']), len: 1 },
    chord: { mode: 'pad', at: [0], len: 16 }, arp: null, density: 3, longest: 6,
    inst: { lead: { type: 'square', vol: 0.026 }, bass: { type: 'triangle', vol: 0.12 }, chord: { type: 'triangle', vol: 0.03 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0.7 },
  },
  // lo-fi: slow and swung, seventh chords on a soft keys, a light beat
  lofi: {
    bpm: 80, swing: 0.3, scale: 'major', sevenths: true, key: [45, 52],
    progressions: [[1, 4, 0, 5], [3, 2, 5, 1], [0, 5, 1, 4], [3, 4, 2, 5]],
    drums: { kick: [0, 7, 10], snare: [4, 12], hat: EIGHTHS },
    bass: { at: [[0, 'r'], [10, 'r'], [14, 'f']], len: 3 },
    chord: { mode: 'pad', at: [0], len: 14 }, arp: null, density: 3, longest: 6,
    inst: { lead: { type: 'triangle', vol: 0.06 }, bass: { type: 'triangle', vol: 0.15 }, chord: { type: 'triangle', vol: 0.028 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0.45 },
  },
  // calm: no drums, long chords, a slow arpeggio and a few notes on top
  ambient: {
    bpm: 72, swing: 0, scale: 'major', sevenths: true, key: [45, 52],
    progressions: [[0, 3, 5, 4], [0, 5, 3, 3], [3, 0, 4, 5], [0, 2, 3, 4]],
    drums: { kick: [], snare: [], hat: [] },
    bass: { at: [[0, 'r']], len: 16 },
    chord: { mode: 'pad', at: [0], len: 16 }, arp: [0, 4, 8, 12], density: 2, longest: 8,
    inst: { lead: { type: 'sine', vol: 0.06 }, bass: { type: 'sine', vol: 0.12 }, chord: { type: 'triangle', vol: 0.024 }, arp: { type: 'triangle', vol: 0.03 }, drums: 0 },
  },
};

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/** Semitones above the tonic for a scale degree (any integer, octaves wrap). */
function semis(scale: readonly number[], degree: number) {
  const o = Math.floor(degree / 7);
  return o * 12 + scale[((degree % 7) + 7) % 7];
}

/** A small stable hash of a string, for seeding. */
export function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One bar of melody: when each note starts and how long it is, and how far above the chord's root it sits (in degrees). */
type Motif = { step: number; len: number; deg: number }[];

function motif(rnd: () => number, s: StyleDef, ending = false): Motif {
  const out: Motif = [];
  let step = rnd() < 0.5 ? 0 : 2;
  let deg = [0, 2, 4][Math.floor(rnd() * 3)];
  while (step < 16) {
    const room = 16 - step;
    const avg = 16 / s.density;
    let len = Math.max(1, Math.min(s.longest, room, Math.round(avg * (0.5 + rnd()))));
    if (ending && step + len >= 12) len = room;
    // notes on the beat land on chord tones, the rest walk the scale
    if (step % 4 === 0) deg = [0, 2, 4, 7][Math.floor(rnd() * 4)];
    else deg = Math.max(-1, Math.min(9, deg + Math.floor(rnd() * 5) - 2));
    if (!(rnd() < 0.18 && out.length)) out.push({ step, len, deg });
    step += len + (rnd() < 0.2 ? 1 : 0);
  }
  return out;
}

export type Song = { style: MusicStyle; bpm: number; swing: number; bars: number; steps: Note[][] };

/** Builds the song for a game: sixteen bars over two progressions, with a melody in four phrases. */
export function writeSong(style: MusicStyle, seed: string): Song {
  const s = STYLES[style];
  const rnd = mulberry32(hashId(`${style}:${seed}`));
  const scale = SCALES[s.scale];
  const tonic = s.key[0] + Math.floor(rnd() * (s.key[1] - s.key[0] + 1));
  const first = s.progressions[Math.floor(rnd() * s.progressions.length)];
  let second = s.progressions[Math.floor(rnd() * s.progressions.length)];
  if (second === first) second = s.progressions[(s.progressions.indexOf(first) + 1) % s.progressions.length];
  const [A, B, C, D, E] = [motif(rnd, s), motif(rnd, s), motif(rnd, s, true), motif(rnd, s), motif(rnd, s)];
  // phrases of four bars: A A A C, B B A C, D D E C, A A B C
  const phrases: [readonly number[], Motif[]][] = [
    [first, [A, A, A, C]],
    [first, [B, B, A, C]],
    [second, [D, D, E, C]],
    [first, [A, A, B, C]],
  ];
  const bars = phrases.length * 4;
  const steps: Note[][] = Array.from({ length: bars * 16 }, () => []);
  const add = (at: number, voice: Voice, midi: number, len: number) => steps[at].push({ voice, midi, len });
  phrases.forEach(([prog, mels], p) => {
    for (let b = 0; b < 4; b++) {
      const bar = p * 4 + b;
      const o = bar * 16;
      const root = prog[b];
      const tone = (deg: number, octave: number) => tonic + octave * 12 + semis(scale, root + deg);
      const chordDegs = s.sevenths ? [0, 2, 4, 6] : [0, 2, 4];
      // up the chord to the octave and back down
      const arpDegs = [...chordDegs, 7, ...chordDegs.slice(1).reverse()];
      for (const st of s.drums.kick) add(o + st, 'kick', 0, 1);
      for (const st of s.drums.snare) add(o + st, 'snare', 0, 1);
      for (const st of s.drums.hat) add(o + st, 'hat', 0, 1);
      for (const st of s.drums.open ?? []) add(o + st, 'open', 0, 1);
      // the last bar of each phrase rolls into the next
      if (s.drums.fill && b === 3) for (const st of [13, 14, 15]) add(o + st, 'snare', 0, 1);
      for (const [st, which] of s.bass.at) add(o + st, 'bass', tone(which === 'f' ? 4 : which === 'o' ? 7 : 0, 0), s.bass.len);
      if (s.chord) for (const st of s.chord.at) for (const d of chordDegs) add(o + st, 'chord', tone(d, 1), s.chord.len);
      if (s.arp) s.arp.forEach((st, i) => add(o + st, 'arp', tone(arpDegs[i % arpDegs.length], 1), 1));
      // the melody follows the chord, folded down an octave when it climbs out of a comfortable range
      for (const n of mels[b]) add(o + n.step, 'lead', tonic + 24 + semis(scale, root + n.deg > 11 ? root + n.deg - 7 : root + n.deg), n.len);
    }
  });
  return { style, bpm: s.bpm, swing: s.swing, bars, steps };
}

/**
 * Schedules a song a little ahead of time. tick(now) is called often with the audio clock in seconds; it hands each
 * note to `play` with how far in the future it should sound and the length of a 16th.
 */
export class Sequencer {
  step = 0;
  at: number | null = null;
  readonly song: Song;
  private readonly play: (note: Note, delay: number, stepLen: number) => void;
  constructor(song: Song, play: (note: Note, delay: number, stepLen: number) => void) {
    this.song = song;
    this.play = play;
  }

  tick(now: number, ahead = 0.3) {
    const stepLen = 60 / this.song.bpm / 4;
    // start, or pick up again after a pause or a hidden tab, without bunching up the notes it missed
    if (this.at === null || this.at < now - 0.3) this.at = now + 0.06;
    while (this.at < now + ahead) {
      const swing = this.step % 2 ? this.song.swing * stepLen : 0;
      for (const note of this.song.steps[this.step]) this.play(note, this.at - now + swing, stepLen);
      this.step = (this.step + 1) % this.song.steps.length;
      this.at += stepLen;
    }
  }

  /** Forget the clock (the next tick starts right away), keeping the place in the song. */
  hold() {
    this.at = null;
  }
}
