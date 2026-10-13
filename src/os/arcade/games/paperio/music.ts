// The soundtrack: a light, bouncy loop for the arcade synth. C, A minor, F and G with a plucky hook, a soft four on
// the floor and a walking bass. While you are out with a trail a tension layer comes in (offbeat hats and a ticking
// arpeggio), and it drops away the moment you are home. Pure data and a scheduler; the game hands it a player.

export type Voice = 'lead' | 'pluck' | 'bass' | 'kick' | 'snap' | 'hat' | 'tick';
export type Note = { midi: number; len: number; voice: Voice; tense: boolean };

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name: string) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0);
}
export const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

const CHORDS = [
  { tones: ['C4', 'E4', 'G4'], bass: ['C2', 'G2', 'C3', 'G2'] },
  { tones: ['A3', 'C4', 'E4'], bass: ['A1', 'E2', 'A2', 'E2'] },
  { tones: ['A3', 'C4', 'F4'], bass: ['F1', 'C2', 'F2', 'C2'] },
  { tones: ['B3', 'D4', 'G4'], bass: ['G1', 'D2', 'G2', 'B1'] },
];

type Bar = [number, string, number][];
/** The hook: four bars, then an answer that climbs. [16th step, note, length in 16ths] */
const HOOK: Bar[] = [
  [[0, 'E5', 2], [3, 'G5', 1], [4, 'C6', 2], [7, 'G5', 1], [8, 'E5', 2], [12, 'D5', 2], [14, 'E5', 2]],
  [[0, 'C5', 2], [3, 'E5', 1], [4, 'A5', 3], [8, 'G5', 2], [10, 'E5', 2], [12, 'C5', 4]],
  [[0, 'F5', 2], [3, 'A5', 1], [4, 'C6', 2], [7, 'A5', 1], [8, 'G5', 2], [12, 'F5', 2], [14, 'E5', 2]],
  [[0, 'D5', 2], [3, 'G5', 1], [4, 'B5', 3], [8, 'A5', 2], [10, 'G5', 2], [12, 'D5', 4]],
];
const ANSWER: Bar[] = [
  [[0, 'G5', 2], [2, 'C6', 2], [4, 'E6', 4], [10, 'D6', 2], [12, 'C6', 4]],
  [[0, 'E6', 2], [2, 'C6', 2], [4, 'A5', 4], [10, 'B5', 2], [12, 'C6', 4]],
  [[0, 'A5', 2], [2, 'C6', 2], [4, 'F6', 4], [10, 'E6', 2], [12, 'C6', 4]],
  [[0, 'D6', 2], [2, 'B5', 2], [4, 'G5', 4], [8, 'A5', 2], [10, 'B5', 2], [12, 'D6', 4]],
];
const LEAD: (Bar | null)[] = [null, null, null, null, ...HOOK, ...HOOK, ...ANSWER];
const BARS = LEAD.length;

export const BPM = 112;
export const STEPS = BARS * 16;

function build(): Note[][] {
  const at: Note[][] = Array.from({ length: STEPS }, () => []);
  const add = (step: number, voice: Voice, name: string | null, len: number, tense = false) => at[step].push({ midi: name ? midi(name) : 0, len, voice, tense });
  for (let b = 0; b < BARS; b++) {
    const o = b * 16;
    const chord = CHORDS[b % CHORDS.length];
    for (const st of [0, 4, 8, 12]) add(o + st, 'kick', null, 1);
    for (const st of [4, 12]) add(o + st, 'snap', null, 1);
    for (let st = 0; st < 16; st += 2) add(o + st, 'hat', null, 1);
    chord.bass.forEach((n, i) => add(o + i * 4 + (i % 2 ? 2 : 0), 'bass', n, 2));
    // plucked chord tones on the offbeats
    for (const st of [2, 6, 10, 14]) add(o + st, 'pluck', chord.tones[(st / 4) % 3 | 0], 1);
    for (const [st, name, len] of LEAD[b] ?? []) add(o + st, 'lead', name, len);
    // tension: offbeat hats and a ticking arpeggio, only while you are exposed
    for (let st = 1; st < 16; st += 2) add(o + st, 'hat', null, 1, true);
    for (let st = 0; st < 16; st++) add(o + st, 'tick', chord.tones[st % 3].replace(/\d/, (d) => String(Number(d) + 1)), 1, true);
  }
  return at;
}
export const SONG = build();

/** Little fanfares: up for a good result, a shrug for a crash. */
export const JINGLE_WIN: string[] = ['C5', 'E5', 'G5', 'C6', 'E6'];
export const JINGLE_CRASH: string[] = ['G4', 'E4', 'C4'];

/**
 * Schedules the loop a little ahead of the audio clock. tick(now, tense) is called every frame; each note goes to
 * `play` with how far in the future it should sound and the length of a 16th.
 */
export class Sequencer {
  step = 0;
  at: number | null = null;
  private readonly play: (note: Note, delay: number, stepLen: number) => void;
  constructor(play: (note: Note, delay: number, stepLen: number) => void) {
    this.play = play;
  }

  tick(now: number, tense = false, ahead = 0.2) {
    const stepLen = 60 / BPM / 4;
    if (this.at === null || this.at < now - 0.3) this.at = now + 0.05;
    while (this.at < now + ahead) {
      for (const note of SONG[this.step]) if (!note.tense || tense) this.play(note, this.at - now, stepLen);
      this.step = (this.step + 1) % STEPS;
      this.at += stepLen;
    }
  }

  reset() {
    this.step = 0;
    this.at = null;
  }
}
