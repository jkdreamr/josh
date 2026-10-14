// The soundtrack: one piece per circle, played through the arcade synth. Slow, in minor keys that lighten as you
// climb, and the stars at the top finally in a major key. Pure data and a scheduler; the game hands it a function
// that plays a note.

export type Voice = 'drone' | 'bass' | 'arp' | 'bell' | 'pad' | 'anvil' | 'crackle' | 'choir' | 'shimmer' | 'heart';
export type Note = { step: number; midi: number; len: number; voice: Voice };

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** MIDI number for a name like 'E5', 'F#4' or 'Bb3'. */
export function midi(name: string) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

export const BPM = 76;
export const BARS = 4;
export const STEPS = BARS * 16;

/** One bar per chord: the bass note, the notes an arpeggio walks, and the long pad voicing. */
type Chord = { bass: string; arp: string[]; pad: string[] };
type Piece = { chords: Chord[]; arp: number[]; bells: [number, number][]; drums: Voice | null; texture: Voice; bellVoice: Voice };

/** [16th step, index into the chord's arp notes] */
const SLOW_ARP = [0, 4, 8, 12];
const WALK_ARP = [0, 2, 4, 6, 8, 10, 12, 14];
const RIPPLE = [0, 1, 2, 3, 8, 9, 10, 11];

const PIECES: Piece[] = [
  // I The Pit: a drone and a slow heartbeat of bass
  {
    chords: [
      { bass: 'A1', arp: ['A2', 'E3', 'A3', 'C4'], pad: ['A2', 'E3'] },
      { bass: 'F1', arp: ['F2', 'C3', 'F3', 'A3'], pad: ['F2', 'C3'] },
      { bass: 'D1', arp: ['D2', 'A2', 'D3', 'F3'], pad: ['D2', 'A2'] },
      { bass: 'E1', arp: ['E2', 'B2', 'E3', 'G#3'], pad: ['E2', 'B2'] },
    ],
    arp: SLOW_ARP,
    bells: [],
    drums: 'crackle',
    texture: 'drone',
    bellVoice: 'bell',
  },
  // II The Catacombs: hollow bells falling down a minor scale
  {
    chords: [
      { bass: 'D2', arp: ['D4', 'A3', 'F3', 'D3'], pad: ['D3', 'A3'] },
      { bass: 'Bb1', arp: ['D4', 'Bb3', 'F3', 'D3'], pad: ['Bb2', 'F3'] },
      { bass: 'G1', arp: ['D4', 'Bb3', 'G3', 'D3'], pad: ['G2', 'D3'] },
      { bass: 'A1', arp: ['E4', 'C#4', 'A3', 'E3'], pad: ['A2', 'E3'] },
    ],
    arp: SLOW_ARP,
    bells: [
      [6, 0],
      [14, 1],
    ],
    drums: null,
    texture: 'pad',
    bellVoice: 'bell',
  },
  // III The Forge: anvils on the backbeat and a walking bass
  {
    chords: [
      { bass: 'E2', arp: ['E3', 'G3', 'B3', 'E4'], pad: ['E3', 'B3'] },
      { bass: 'C2', arp: ['C3', 'G3', 'C4', 'E4'], pad: ['C3', 'G3'] },
      { bass: 'A1', arp: ['A2', 'E3', 'A3', 'C4'], pad: ['A2', 'E3'] },
      { bass: 'B1', arp: ['B2', 'F#3', 'B3', 'D#4'], pad: ['B2', 'F#3'] },
    ],
    arp: WALK_ARP,
    bells: [],
    drums: 'anvil',
    texture: 'drone',
    bellVoice: 'bell',
  },
  // IV The Frozen Lake: high glassy bells, lots of air
  {
    chords: [
      { bass: 'B2', arp: ['B4', 'F#5', 'D5', 'B5'], pad: ['B3', 'F#4'] },
      { bass: 'G2', arp: ['B4', 'G5', 'D5', 'G5'], pad: ['G3', 'D4'] },
      { bass: 'E2', arp: ['B4', 'E5', 'G5', 'E5'], pad: ['E3', 'B3'] },
      { bass: 'F#2', arp: ['A#4', 'F#5', 'C#5', 'F#5'], pad: ['F#3', 'C#4'] },
    ],
    arp: RIPPLE,
    bells: [[12, 2]],
    drums: null,
    texture: 'pad',
    bellVoice: 'shimmer',
  },
  // V The Cathedral: organ chords and a choir
  {
    chords: [
      { bass: 'C2', arp: ['C4', 'Eb4', 'G4', 'C5'], pad: ['C3', 'G3', 'Eb4'] },
      { bass: 'Ab1', arp: ['C4', 'Eb4', 'Ab4', 'C5'], pad: ['Ab2', 'Eb3', 'C4'] },
      { bass: 'F1', arp: ['C4', 'F4', 'Ab4', 'C5'], pad: ['F2', 'C3', 'Ab3'] },
      { bass: 'G1', arp: ['B3', 'D4', 'G4', 'B4'], pad: ['G2', 'D3', 'B3'] },
    ],
    arp: SLOW_ARP,
    bells: [[8, 3]],
    drums: null,
    texture: 'choir',
    bellVoice: 'bell',
  },
  // VI The Stars: finally a major key, shimmering
  {
    chords: [
      { bass: 'C2', arp: ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'G5'], pad: ['C3', 'G3', 'E4'] },
      { bass: 'G1', arp: ['B3', 'D4', 'G4', 'B4', 'D5', 'G5', 'B5', 'G5'], pad: ['G2', 'D3', 'B3'] },
      { bass: 'A1', arp: ['A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'E5'], pad: ['A2', 'E3', 'C4'] },
      { bass: 'F1', arp: ['A3', 'C4', 'F4', 'A4', 'C5', 'F5', 'A5', 'F5'], pad: ['F2', 'C3', 'A3'] },
    ],
    arp: WALK_ARP,
    bells: [
      [4, 6],
      [12, 7],
    ],
    drums: null,
    texture: 'pad',
    bellVoice: 'shimmer',
  },
];

function build(piece: Piece): Note[][] {
  const at: Note[][] = Array.from({ length: STEPS }, () => []);
  const add = (step: number, voice: Voice, name: string | null, len: number) => at[step].push({ step, midi: name ? midi(name) : 0, len, voice });
  piece.chords.forEach((chord, b) => {
    const o = b * 16;
    add(o, 'bass', chord.bass, 12);
    for (const n of chord.pad) add(o, piece.texture, n, 16);
    piece.arp.forEach((st, i) => add(o + st, 'arp', chord.arp[i % chord.arp.length], 2));
    for (const [st, i] of piece.bells) add(o + st, piece.bellVoice, chord.arp[i % chord.arp.length], 6);
    if (piece.drums === 'anvil') for (const st of [4, 12]) add(o + st, 'anvil', null, 1);
    if (piece.drums === 'crackle') for (const st of [0, 7, 10]) add(o + st, 'crackle', null, 1);
  });
  return at;
}
/** Every note of every circle, grouped by the 16th step it starts on. */
export const SONGS: Note[][][] = PIECES.map(build);

/** A rising figure for a lit beacon, and the bells at the top. */
export const JINGLE_BEACON: Note[] = ['E5', 'G5', 'B5', 'E6'].map((n, i) => ({ step: i, midi: midi(n), len: i === 3 ? 6 : 2, voice: 'bell' }));
export const JINGLE_OUT: Note[] = ['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'].map((n, i) => ({ step: i * 2, midi: midi(n), len: i === 6 ? 12 : 3, voice: 'shimmer' }));
export const JINGLE_BURN: Note[] = ['E3', 'Eb3', 'D3', 'Db3'].map((n, i) => ({ step: i * 3, midi: midi(n), len: 3, voice: 'bass' }));

/**
 * Schedules the loop a little ahead of time. tick(now, zone, danger) is called every frame with a clock in seconds;
 * it hands each note to `play` with how far in the future it should sound and the length of a 16th. Changing zone
 * swaps the piece at the next bar; danger (lava close behind) adds a heartbeat and pushes the tempo.
 */
export class Sequencer {
  step = 0;
  at: number | null = null;
  zone = 0;
  private next = 0;
  private readonly play: (note: Note, delay: number, stepLen: number) => void;
  constructor(play: (note: Note, delay: number, stepLen: number) => void) {
    this.play = play;
  }

  tick(now: number, zone: number, danger = 0, ahead = 0.3) {
    const stepLen = 60 / (BPM * (1 + danger * 0.25)) / 4;
    this.next = Math.max(0, Math.min(SONGS.length - 1, zone));
    if (this.at === null || this.at < now - 0.4) {
      this.at = now + 0.05;
      this.zone = this.next;
    }
    while (this.at < now + ahead) {
      if (this.step % 16 === 0 && this.next !== this.zone) this.zone = this.next;
      for (const note of SONGS[this.zone][this.step]) this.play(note, this.at - now, stepLen);
      if (danger > 0 && this.step % 8 === 0) this.play({ step: this.step, midi: 0, len: 1, voice: 'heart' }, this.at - now, stepLen);
      if (danger > 0.5 && this.step % 8 === 3) this.play({ step: this.step, midi: 0, len: 1, voice: 'heart' }, this.at - now, stepLen);
      this.step = (this.step + 1) % STEPS;
      this.at += stepLen;
    }
  }

  reset() {
    this.step = 0;
    this.at = null;
  }
}
