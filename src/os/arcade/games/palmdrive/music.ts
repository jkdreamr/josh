// The race soundtrack: a little house tune played through the arcade synth. Kick on every beat, offbeat bass and
// hats, claps on two and four, chord stabs and a hook over A minor, F, C and G. Sixteen bars on a loop that speeds
// up for the final lap, and a jingle at the flag. Pure data and a scheduler; the game hands it a function that plays
// a note.

export type Voice = 'lead' | 'stab' | 'bass' | 'kick' | 'clap' | 'hat' | 'open';
export type Note = { step: number; midi: number; len: number; voice: Voice };

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** MIDI number for a name like 'E5' or 'F#4'. */
export function midi(name: string) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0);
}
export const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** One chord per bar, round and round: stab voicing and bass root and fifth. */
const CHORDS: { stab: string[]; root: string; fifth: string }[] = [
  { stab: ['A3', 'C4', 'E4', 'G4'], root: 'A2', fifth: 'E3' },
  { stab: ['A3', 'C4', 'F4'], root: 'F2', fifth: 'C3' },
  { stab: ['G3', 'C4', 'E4'], root: 'C3', fifth: 'G3' },
  { stab: ['G3', 'B3', 'D4'], root: 'G2', fifth: 'D3' },
];

type Bar = [number, string, number][];
/** The hook, one bar per chord: [16th step in the bar, note, length in 16ths]. */
const HOOK: Bar[] = [
  [[0, 'E6', 1], [2, 'E6', 1], [3, 'C6', 1], [6, 'A5', 2], [10, 'E6', 1], [11, 'D6', 1], [12, 'C6', 2], [14, 'A5', 2]],
  [[0, 'F6', 1], [2, 'F6', 1], [3, 'C6', 1], [6, 'A5', 2], [10, 'F6', 1], [11, 'E6', 1], [12, 'C6', 2], [14, 'A5', 2]],
  [[0, 'E6', 1], [2, 'E6', 1], [3, 'C6', 1], [6, 'G5', 2], [10, 'E6', 1], [11, 'D6', 1], [12, 'C6', 2], [14, 'G5', 2]],
  [[0, 'D6', 1], [2, 'D6', 1], [3, 'B5', 1], [6, 'G5', 2], [10, 'D6', 1], [11, 'C6', 1], [12, 'B5', 2], [14, 'D6', 2]],
];
/** The answer that closes the loop, climbing higher. */
const ANSWER: Bar[] = [
  [[0, 'A5', 2], [2, 'C6', 2], [4, 'E6', 2], [6, 'G6', 2], [8, 'E6', 2], [10, 'C6', 1], [11, 'D6', 1], [12, 'E6', 4]],
  [[0, 'F6', 2], [2, 'E6', 2], [4, 'C6', 2], [6, 'A5', 2], [8, 'C6', 2], [10, 'A5', 1], [11, 'C6', 1], [12, 'F6', 4]],
  [[0, 'E6', 2], [2, 'G6', 2], [4, 'E6', 2], [6, 'C6', 2], [8, 'G5', 2], [10, 'C6', 1], [11, 'D6', 1], [12, 'E6', 4]],
  [[0, 'D6', 2], [2, 'B5', 2], [4, 'G5', 2], [6, 'B5', 2], [8, 'D6', 4], [12, 'G6', 2], [14, 'F6', 2]],
];
/** Bars 1-4 are the groove on its own, 5-12 bring in the stabs and the hook, 13-16 answer it. */
const LEAD: (Bar | null)[] = [null, null, null, null, ...HOOK, ...HOOK, ...ANSWER];
const STABS = [2, 6, 10, 13];
const BARS = LEAD.length;

export const BPM = 124;
export const STEPS = BARS * 16;
/** Tempo for the final lap. */
export const FAST = 1.1;

function build(): Note[][] {
  const at: Note[][] = Array.from({ length: STEPS }, () => []);
  const add = (step: number, voice: Voice, name: string | null, len: number) => at[step].push({ step, midi: name ? midi(name) : 0, len, voice });
  for (let b = 0; b < BARS; b++) {
    const o = b * 16;
    const chord = CHORDS[b % CHORDS.length];
    for (const st of [0, 4, 8, 12]) add(o + st, 'kick', null, 1);
    for (const st of [4, 12]) add(o + st, 'clap', null, 1);
    // the last bar rolls into the top of the loop
    if (b === BARS - 1) for (const st of [13, 14, 15]) add(o + st, 'clap', null, 1);
    for (let st = 0; st < 16; st++) add(o + st, st % 4 === 2 ? 'open' : 'hat', null, 1);
    // offbeat bass, up to the fifth for the last hit of the bar
    for (const st of [2, 6, 10, 14]) add(o + st, 'bass', st === 14 ? chord.fifth : chord.root, 2);
    if (b >= 4) for (const st of STABS) for (const n of chord.stab) add(o + st, 'stab', n, 2);
    for (const [st, name, len] of LEAD[b] ?? []) add(o + st, 'lead', name, len);
  }
  return at;
}
/** Every note, grouped by the 16th step it starts on. */
export const SONG = build();

/** Fanfares for the flag: up the scale for a podium finish, a shrug for the rest. */
export const JINGLE_WIN: Note[] = ['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6'].map((n, i) => ({ step: i < 4 ? i * 2 : 8 + (i - 4) * 2, midi: midi(n), len: i === 6 ? 8 : 2, voice: 'lead' }));
export const JINGLE_DONE: Note[] = ['E5', 'D5', 'C5', 'G4', 'C5'].map((n, i) => ({ step: i * 2, midi: midi(n), len: i === 4 ? 6 : 2, voice: 'lead' }));

/**
 * Schedules the loop a little ahead of time. tick(now) is called every frame with a clock in seconds; it hands each
 * note to `play` with how far in the future it should sound and the current length of a 16th.
 */
export class Sequencer {
  step = 0;
  at: number | null = null;
  private readonly play: (note: Note, delay: number, stepLen: number) => void;
  constructor(play: (note: Note, delay: number, stepLen: number) => void) {
    this.play = play;
  }

  tick(now: number, fast = false, ahead = 0.25) {
    const stepLen = 60 / (BPM * (fast ? FAST : 1)) / 4;
    // start, or pick up again after the game was paused or the tab hidden
    if (this.at === null || this.at < now - 0.3) this.at = now + 0.05;
    while (this.at < now + ahead) {
      for (const note of SONG[this.step]) this.play(note, this.at - now, stepLen);
      this.step = (this.step + 1) % STEPS;
      this.at += stepLen;
    }
  }

  reset() {
    this.step = 0;
    this.at = null;
  }
}
