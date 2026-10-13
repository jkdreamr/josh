// A little chiptune for the races, played through the arcade synth: sixteen bars on a loop that speeds up for the
// final lap, and a jingle at the flag. Pure data and a scheduler; the game hands it a function that plays a note.

export type Voice = 'lead' | 'bass' | 'kick' | 'hat';
export type Note = { step: number; midi: number; len: number; voice: Voice };

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** MIDI number for a name like 'E5' or 'F#4'. */
export function midi(name: string) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0);
}
export const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** The tune, one bar per line: [16th note step in the bar, note, length in 16ths]. */
const LEAD: [number, string, number][][] = [
  [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 2], [6, 'G5', 2], [8, 'A5', 2], [10, 'G5', 2], [12, 'E5', 4]],
  [[0, 'D5', 2], [2, 'G5', 2], [4, 'B5', 2], [6, 'G5', 2], [8, 'A5', 2], [10, 'B5', 2], [12, 'D6', 4]],
  [[0, 'C6', 2], [2, 'B5', 2], [4, 'A5', 2], [6, 'E5', 2], [8, 'A5', 2], [10, 'C6', 2], [12, 'E6', 4]],
  [[0, 'F5', 2], [2, 'A5', 2], [4, 'C6', 2], [6, 'A5', 2], [8, 'G5', 2], [10, 'F5', 2], [12, 'E5', 2], [14, 'D5', 2]],
  [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 2], [6, 'G5', 2], [8, 'A5', 2], [10, 'G5', 2], [12, 'E5', 4]],
  [[0, 'D5', 2], [2, 'G5', 2], [4, 'B5', 2], [6, 'G5', 2], [8, 'A5', 2], [10, 'B5', 2], [12, 'D6', 4]],
  [[0, 'A5', 2], [2, 'C6', 2], [4, 'F6', 2], [6, 'E6', 2], [8, 'D6', 2], [10, 'C6', 2], [12, 'A5', 4]],
  [[0, 'B5', 2], [2, 'D6', 2], [4, 'G6', 4], [8, 'F6', 2], [10, 'D6', 2], [12, 'B5', 2], [14, 'G5', 2]],
  [[0, 'A5', 2], [2, 'C6', 2], [4, 'E6', 2], [6, 'C6', 2], [8, 'B5', 2], [10, 'A5', 2], [12, 'E5', 4]],
  [[0, 'F5', 2], [2, 'A5', 2], [4, 'C6', 2], [6, 'F6', 2], [8, 'E6', 2], [10, 'C6', 2], [12, 'A5', 4]],
  [[0, 'G5', 2], [2, 'C6', 2], [4, 'E6', 2], [6, 'G6', 2], [8, 'E6', 2], [10, 'C6', 2], [12, 'G5', 4]],
  [[0, 'B5', 2], [2, 'D6', 2], [4, 'G6', 2], [6, 'D6', 2], [8, 'B5', 2], [10, 'G5', 2], [12, 'D5', 4]],
  [[0, 'C6', 4], [4, 'B5', 2], [6, 'A5', 2], [8, 'E6', 4], [12, 'C6', 4]],
  [[0, 'A5', 4], [4, 'G5', 2], [6, 'F5', 2], [8, 'C6', 4], [12, 'A5', 4]],
  [[0, 'B5', 2], [2, 'D6', 2], [4, 'G6', 2], [6, 'F6', 2], [8, 'E6', 2], [10, 'D6', 2], [12, 'C6', 2], [14, 'B5', 2]],
  [[0, 'D6', 8], [8, 'G5', 2], [10, 'A5', 2], [12, 'B5', 2], [14, 'D6', 2]],
];
/** Bass root and fifth for each bar. */
const CHORDS: [string, string][] = [
  ['C3', 'G3'], ['G2', 'D3'], ['A2', 'E3'], ['F2', 'C3'], ['C3', 'G3'], ['G2', 'D3'], ['F2', 'C3'], ['G2', 'D3'],
  ['A2', 'E3'], ['F2', 'C3'], ['C3', 'G3'], ['G2', 'D3'], ['A2', 'E3'], ['F2', 'C3'], ['G2', 'D3'], ['G2', 'D3'],
];

export const BPM = 150;
export const STEPS = LEAD.length * 16;
/** Tempo for the final lap. */
export const FAST = 1.15;

function build(): Note[][] {
  const at: Note[][] = Array.from({ length: STEPS }, () => []);
  LEAD.forEach((bar, b) => {
    for (const [st, name, len] of bar) at[b * 16 + st].push({ step: b * 16 + st, midi: midi(name), len, voice: 'lead' });
    const [root, fifth] = CHORDS[b];
    for (const [st, name] of [[0, root], [4, fifth], [8, root], [12, fifth]] as const) at[b * 16 + st].push({ step: b * 16 + st, midi: midi(name), len: 3, voice: 'bass' });
    for (const st of [0, 8]) at[b * 16 + st].push({ step: b * 16 + st, midi: 0, len: 1, voice: 'kick' });
    for (const st of [4, 12, 14]) at[b * 16 + st].push({ step: b * 16 + st, midi: 0, len: 1, voice: 'hat' });
  });
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
