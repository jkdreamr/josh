export const TRACKS = ['kick', 'snare', 'hat', 'open hat', 'clap', 'bass', 'keys', 'lead'] as const;
export const SYNTH_TRACKS = ['bass', 'keys', 'lead'] as const;
export type TrackId = (typeof TRACKS)[number];
export type SynthTrack = (typeof SYNTH_TRACKS)[number];
export type PentatonicKey = 'A minor' | 'C minor' | 'D minor' | 'E minor' | 'G minor';
export type PresetName = 'kelix lofi' | 'boom bap' | 'house' | 'trap';
export type Pitch = { name: string; frequency: number; midi: number };

export type BeatPattern = {
  tracks: Record<TrackId, number>;
  notes: Record<SynthTrack, number[]>;
};

export type BeatState = {
  pattern: BeatPattern;
  bpm: number;
  swing: number;
  key: PentatonicKey;
};

const KEY_ROOTS: Record<PentatonicKey, number> = {
  'A minor': 69,
  'C minor': 60,
  'D minor': 62,
  'E minor': 64,
  'G minor': 67,
};
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function pitchForMidi(midi: number): Pitch {
  const octave = Math.floor(midi / 12) - 1;
  return {
    name: `${NOTE_NAMES[midi % 12]}${octave}`,
    frequency: 440 * 2 ** ((midi - 69) / 12),
    midi,
  };
}

export const PENTATONIC_NOTES: Record<PentatonicKey, Pitch[]> = Object.fromEntries(
  Object.entries(KEY_ROOTS).map(([key, root]) => [
    key,
    MINOR_PENTATONIC.map((offset) => pitchForMidi(root + offset)),
  ]),
) as Record<PentatonicKey, Pitch[]>;

export const PENTATONIC_KEYS = Object.keys(KEY_ROOTS) as PentatonicKey[];

function mask(steps: number[]): number {
  return steps.reduce((value, step) => value | (1 << step), 0);
}

const PRESETS: Record<PresetName, Omit<BeatState, 'pattern'> & { steps: Record<TrackId, number[]> }> = {
  'kelix lofi': {
    bpm: 88,
    swing: 24,
    key: 'A minor',
    steps: {
      kick: [0, 7, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      'open hat': [14],
      clap: [12],
      bass: [0, 7, 10],
      keys: [2, 6, 10, 14],
      lead: [3, 11],
    },
  },
  'boom bap': {
    bpm: 92,
    swing: 18,
    key: 'C minor',
    steps: {
      kick: [0, 6, 10],
      snare: [4, 12],
      hat: [0, 2, 3, 6, 8, 10, 11, 14],
      'open hat': [14],
      clap: [4, 12],
      bass: [0, 6, 10, 14],
      keys: [2, 6, 10],
      lead: [7, 15],
    },
  },
  house: {
    bpm: 124,
    swing: 8,
    key: 'D minor',
    steps: {
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      hat: [2, 6, 10, 14],
      'open hat': [2, 6, 10, 14],
      clap: [4, 12],
      bass: [0, 3, 6, 8, 11, 14],
      keys: [2, 6, 10, 14],
      lead: [5, 13],
    },
  },
  trap: {
    bpm: 142,
    swing: 12,
    key: 'E minor',
    steps: {
      kick: [0, 7, 10, 14],
      snare: [4, 12],
      hat: [0, 2, 4, 5, 7, 8, 10, 12, 13, 15],
      'open hat': [7, 15],
      clap: [12],
      bass: [0, 7, 10, 14],
      keys: [3, 11],
      lead: [2, 6, 10, 14],
    },
  },
};

function emptyPattern(): BeatPattern {
  return {
    tracks: Object.fromEntries(TRACKS.map((track) => [track, 0])) as Record<TrackId, number>,
    notes: Object.fromEntries(SYNTH_TRACKS.map((track) => [track, Array.from({ length: 16 }, (_, index) => index % 5)])) as Record<SynthTrack, number[]>,
  };
}

export function createBeatState(preset: PresetName = 'kelix lofi'): BeatState {
  const selected = PRESETS[preset];
  const pattern = emptyPattern();
  for (const track of TRACKS) pattern.tracks[track] = mask(selected.steps[track]);
  return { pattern, bpm: selected.bpm, swing: selected.swing, key: selected.key };
}

export function isStepOn(pattern: BeatPattern, track: TrackId, step: number): boolean {
  return (pattern.tracks[track] & (1 << step)) !== 0;
}

export function toggleStep(pattern: BeatPattern, track: TrackId, step: number): BeatPattern {
  const tracks = { ...pattern.tracks, [track]: pattern.tracks[track] ^ (1 << step) };
  return { ...pattern, tracks };
}

export function setStepPitch(pattern: BeatPattern, track: SynthTrack, step: number, pitch: number): BeatPattern {
  const notes = { ...pattern.notes, [track]: [...pattern.notes[track]] };
  notes[track][step] = ((pitch % 5) + 5) % 5;
  return { ...pattern, notes };
}

export function changeStepPitch(pattern: BeatPattern, track: SynthTrack, step: number, amount: number): BeatPattern {
  return setStepPitch(pattern, track, step, pattern.notes[track][step] + amount);
}

export function clearPattern(pattern: BeatPattern): BeatPattern {
  return {
    tracks: Object.fromEntries(TRACKS.map((track) => [track, 0])) as Record<TrackId, number>,
    notes: Object.fromEntries(SYNTH_TRACKS.map((track) => [track, [...pattern.notes[track]]])) as Record<SynthTrack, number[]>,
  };
}

export function sixteenthDuration(bpm: number): number {
  return 60 / Math.max(1, bpm) / 4;
}

export function swingOffset(step: number, bpm: number, swing: number): number {
  if (step % 2 === 0) return 0;
  return sixteenthDuration(bpm) * (Math.max(0, Math.min(60, swing)) / 100) * 0.5;
}

export function beatStepTime(step: number, bpm: number, swing: number): number {
  return step * sixteenthDuration(bpm) + swingOffset(step, bpm, swing);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64Url(text: string): string {
  let output = '';
  for (let index = 0; index < text.length; index += 3) {
    const first = text.charCodeAt(index);
    const hasSecond = index + 1 < text.length;
    const hasThird = index + 2 < text.length;
    const second = hasSecond ? text.charCodeAt(index + 1) : 0;
    const third = hasThird ? text.charCodeAt(index + 2) : 0;
    const bits = (first << 16) | (second << 8) | third;
    output += BASE64[(bits >> 18) & 63] + BASE64[(bits >> 12) & 63];
    if (hasSecond) output += BASE64[(bits >> 6) & 63];
    if (hasThird) output += BASE64[bits & 63];
  }
  return output;
}

function decodeBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let output = '';
  for (let index = 0; index < normalized.length; index += 4) {
    const values = normalized.slice(index, index + 4).split('').map((char) => {
      const value = BASE64.replace(/-/g, '+').replace(/_/g, '/').indexOf(char);
      if (value < 0) throw new Error('invalid base64');
      return value;
    });
    const bits = (values[0] << 18) | ((values[1] ?? 0) << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0);
    output += String.fromCharCode((bits >> 16) & 255);
    if (values.length > 2) output += String.fromCharCode((bits >> 8) & 255);
    if (values.length > 3) output += String.fromCharCode(bits & 255);
  }
  return output;
}

export function encodeBeatState(state: BeatState): string {
  const packed = {
    v: 1,
    b: state.bpm,
    s: state.swing,
    k: state.key,
    p: TRACKS.map((track) => state.pattern.tracks[track]),
    n: SYNTH_TRACKS.map((track) => state.pattern.notes[track].join('')),
  };
  return encodeBase64Url(JSON.stringify(packed));
}

export function decodeBeatState(encoded: string): BeatState | null {
  if (!encoded || encoded.length > 1200) return null;
  try {
    const packed = JSON.parse(decodeBase64Url(encoded)) as {
      v?: number;
      b?: number;
      s?: number;
      k?: string;
      p?: number[];
      n?: string[];
    };
    if (
      packed.v !== 1
      || !Number.isInteger(packed.b) || packed.b! < 60 || packed.b! > 160
      || !Number.isInteger(packed.s) || packed.s! < 0 || packed.s! > 60
      || !PENTATONIC_KEYS.includes(packed.k as PentatonicKey)
      || !Array.isArray(packed.p) || packed.p.length !== TRACKS.length
      || !packed.p.every((value) => Number.isInteger(value) && value >= 0 && value <= 65535)
      || !Array.isArray(packed.n) || packed.n.length !== SYNTH_TRACKS.length
      || !packed.n.every((notes) => /^[0-4]{16}$/.test(notes))
    ) return null;
    const pattern: BeatPattern = {
      tracks: Object.fromEntries(TRACKS.map((track, index) => [track, packed.p![index]])) as Record<TrackId, number>,
      notes: Object.fromEntries(SYNTH_TRACKS.map((track, index) => [track, packed.n![index].split('').map(Number)])) as Record<SynthTrack, number[]>,
    };
    return { pattern, bpm: packed.b!, swing: packed.s!, key: packed.k as PentatonicKey };
  } catch {
    return null;
  }
}
