export const TRACKS = ['kick', 'snare', 'hat', 'open hat', 'clap', 'bass', 'keys', 'lead'] as const;
export const DRUM_TRACKS = ['kick', 'snare', 'hat', 'open hat', 'clap'] as const;
export const SYNTH_TRACKS = ['bass', 'keys', 'lead'] as const;
export type TrackId = (typeof TRACKS)[number];
export type DrumTrack = (typeof DRUM_TRACKS)[number];
export type SynthTrack = (typeof SYNTH_TRACKS)[number];

export const KITS = ['808', 'acoustic', 'lofi', 'house'] as const;
export type KitId = (typeof KITS)[number];
export const KIT_NAMES: Record<KitId, string> = { '808': '808', acoustic: 'Acoustic', lofi: 'Lo-Fi', house: 'House' };

export const SCALES = ['minor pentatonic', 'major pentatonic', 'minor', 'major', 'dorian', 'blues'] as const;
export type ScaleId = (typeof SCALES)[number];
export const SCALE_NAMES: Record<ScaleId, string> = {
  'minor pentatonic': 'Minor Pentatonic',
  'major pentatonic': 'Major Pentatonic',
  minor: 'Minor',
  major: 'Major',
  dorian: 'Dorian',
  blues: 'Blues',
};
const SCALE_STEPS: Record<ScaleId, number[]> = {
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export const ROOT_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
export const PATTERN_LENGTHS = [8, 16, 32] as const;
export type PatternLength = (typeof PATTERN_LENGTHS)[number];
export const MAX_STEPS = 32;
export const PATTERN_COUNT = 4;
export const PATTERN_NAMES = ['A', 'B', 'C', 'D'] as const;
export const MAX_SONG = 16;
/** Melodic steps hold a scale degree: two octaves plus the top root. */
export const MAX_DEGREE = 14;
export const BPM_MIN = 50;
export const BPM_MAX = 220;
export const SWING_MAX = 60;

export type PresetName = 'kelix lofi' | 'boom bap' | 'house' | 'trap';
export type Pitch = { name: string; frequency: number; midi: number };
/** 0 off, 1 soft, 2 normal, 3 accent */
export type Velocity = 0 | 1 | 2 | 3;

export type BeatPattern = {
  length: PatternLength;
  steps: Record<TrackId, number[]>;
  notes: Record<SynthTrack, number[]>;
};

export type TrackSettings = { volume: number; pitch: number; decay: number; muted: boolean };
export type Effects = { filter: number; reverb: number; delay: number };

export type BeatState = {
  bpm: number;
  swing: number;
  root: number;
  scale: ScaleId;
  kit: KitId;
  patterns: BeatPattern[];
  current: number;
  song: number[];
  songMode: boolean;
  tracks: Record<TrackId, TrackSettings>;
  fx: Effects;
};

export type Position = { pattern: number; step: number; songIndex: number };

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function pitchForMidi(midi: number): Pitch {
  const octave = Math.floor(midi / 12) - 1;
  return { name: `${NOTE_NAMES[midi % 12]}${octave}`, frequency: 440 * 2 ** ((midi - 69) / 12), midi };
}

/** Base octave per track, as MIDI for root C. */
const TRACK_OCTAVE: Record<SynthTrack, number> = { bass: 36, keys: 48, lead: 60 };

export function scaleSize(scale: ScaleId): number {
  return SCALE_STEPS[scale].length;
}

/** Degrees run over two octaves of the scale plus the top root. */
export function degreeCount(scale: ScaleId): number {
  return Math.min(MAX_DEGREE + 1, scaleSize(scale) * 2 + 1);
}

export function pitchForDegree(track: SynthTrack, root: number, scale: ScaleId, degree: number): Pitch {
  const steps = SCALE_STEPS[scale];
  const clamped = Math.max(0, Math.min(degreeCount(scale) - 1, degree));
  const octave = Math.floor(clamped / steps.length);
  const midi = TRACK_OCTAVE[track] + root + octave * 12 + steps[clamped % steps.length];
  return pitchForMidi(midi);
}

export function scaleNotes(track: SynthTrack, root: number, scale: ScaleId): Pitch[] {
  return Array.from({ length: degreeCount(scale) }, (_, degree) => pitchForDegree(track, root, scale, degree));
}

function emptySteps(): Record<TrackId, number[]> {
  return Object.fromEntries(TRACKS.map((track) => [track, new Array<number>(MAX_STEPS).fill(0)])) as Record<TrackId, number[]>;
}

function defaultNotes(): Record<SynthTrack, number[]> {
  return Object.fromEntries(SYNTH_TRACKS.map((track) => [track, Array.from({ length: MAX_STEPS }, (_, index) => index % 5)])) as Record<SynthTrack, number[]>;
}

export function emptyPattern(length: PatternLength = 16): BeatPattern {
  return { length, steps: emptySteps(), notes: defaultNotes() };
}

export function defaultTrackSettings(): Record<TrackId, TrackSettings> {
  return Object.fromEntries(TRACKS.map((track) => [track, { volume: 80, pitch: 0, decay: 50, muted: false }])) as Record<TrackId, TrackSettings>;
}

export function isPatternEmpty(pattern: BeatPattern): boolean {
  return TRACKS.every((track) => pattern.steps[track].every((velocity) => velocity === 0));
}

type PresetSpec = {
  bpm: number;
  swing: number;
  root: number;
  scale: ScaleId;
  kit: KitId;
  fx: Effects;
  steps: Record<TrackId, number[]>;
  accents?: Partial<Record<TrackId, number[]>>;
  ghosts?: Partial<Record<TrackId, number[]>>;
  notes?: Partial<Record<SynthTrack, Record<number, number>>>;
};

const PRESETS: Record<PresetName, PresetSpec> = {
  'kelix lofi': {
    bpm: 84,
    swing: 26,
    root: 9,
    scale: 'minor pentatonic',
    kit: 'lofi',
    fx: { filter: 44, reverb: 28, delay: 14 },
    steps: {
      kick: [0, 7, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14, 15],
      'open hat': [14],
      clap: [12],
      bass: [0, 7, 10],
      keys: [2, 6, 10, 14],
      lead: [3, 11],
    },
    accents: { kick: [0], hat: [0, 8] },
    ghosts: { hat: [15], snare: [] },
    notes: { bass: { 0: 0, 7: 3, 10: 2 }, keys: { 2: 2, 6: 4, 10: 3, 14: 5 }, lead: { 3: 7, 11: 5 } },
  },
  'boom bap': {
    bpm: 92,
    swing: 20,
    root: 0,
    scale: 'minor pentatonic',
    kit: 'acoustic',
    fx: { filter: 50, reverb: 18, delay: 0 },
    steps: {
      kick: [0, 6, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      'open hat': [14],
      clap: [4, 12],
      bass: [0, 6, 10, 14],
      keys: [2, 6, 10],
      lead: [7, 15],
    },
    accents: { kick: [0], snare: [4, 12] },
    ghosts: { hat: [2, 6, 10, 14], clap: [4, 12] },
    notes: { bass: { 0: 0, 6: 0, 10: 2, 14: 3 }, keys: { 2: 4, 6: 2, 10: 3 }, lead: { 7: 6, 15: 4 } },
  },
  house: {
    bpm: 124,
    swing: 6,
    root: 2,
    scale: 'minor',
    kit: 'house',
    fx: { filter: 50, reverb: 22, delay: 20 },
    steps: {
      kick: [0, 4, 8, 12],
      snare: [],
      hat: [2, 6, 10, 14],
      'open hat': [2, 6, 10, 14],
      clap: [4, 12],
      bass: [0, 3, 6, 8, 11, 14],
      keys: [2, 6, 10, 14],
      lead: [5, 13],
    },
    accents: { kick: [0, 4, 8, 12] },
    ghosts: { hat: [2, 6, 10, 14] },
    notes: { bass: { 0: 0, 3: 0, 6: 4, 8: 0, 11: 2, 14: 5 }, keys: { 2: 2, 6: 4, 10: 6, 14: 4 }, lead: { 5: 9, 13: 7 } },
  },
  trap: {
    bpm: 142,
    swing: 10,
    root: 4,
    scale: 'minor pentatonic',
    kit: '808',
    fx: { filter: 50, reverb: 16, delay: 24 },
    steps: {
      kick: [0, 7, 10, 14],
      snare: [4, 12],
      hat: [0, 2, 4, 5, 7, 8, 10, 12, 13, 14, 15],
      'open hat': [7, 15],
      clap: [12],
      bass: [0, 7, 10, 14],
      keys: [3, 11],
      lead: [2, 6, 10, 14],
    },
    accents: { kick: [0], snare: [4, 12] },
    ghosts: { hat: [5, 13, 15] },
    notes: { bass: { 0: 0, 7: 0, 10: 2, 14: 3 }, keys: { 3: 5, 11: 4 }, lead: { 2: 7, 6: 5, 10: 7, 14: 9 } },
  },
};

export const PRESET_NAMES: Record<PresetName, string> = { 'kelix lofi': 'Kelix Lo-Fi', 'boom bap': 'Boom Bap', house: 'House', trap: 'Trap' };

function patternFromSpec(spec: PresetSpec): BeatPattern {
  const pattern = emptyPattern(16);
  for (const track of TRACKS) {
    for (const step of spec.steps[track]) pattern.steps[track][step] = 2;
    for (const step of spec.accents?.[track] ?? []) if (pattern.steps[track][step]) pattern.steps[track][step] = 3;
    for (const step of spec.ghosts?.[track] ?? []) if (pattern.steps[track][step]) pattern.steps[track][step] = 1;
  }
  for (const track of SYNTH_TRACKS) {
    const notes = spec.notes?.[track];
    if (!notes) continue;
    for (const [step, degree] of Object.entries(notes)) pattern.notes[track][Number(step)] = degree;
  }
  return pattern;
}

/** A natural B section: the same groove with a fill in the last beat and a different top line. */
export function variation(pattern: BeatPattern): BeatPattern {
  const next = clonePattern(pattern);
  const last = next.length - 1;
  next.steps.kick[last - 2] = next.steps.kick[last - 2] || 1;
  next.steps['open hat'][last] = 2;
  next.steps.snare[last - 1] = next.steps.snare[last - 1] || 1;
  next.steps.lead = next.steps.lead.map((velocity, step) => (step % 4 === 2 && step < next.length ? (velocity ? 0 : 2) : velocity));
  next.notes.lead = next.notes.lead.map((degree, step) => (step % 8 === 2 && step < next.length ? Math.min(MAX_DEGREE, degree + 2) : degree));
  return next;
}

/** The link only carries steps inside the loop, so anything past the length resets to defaults. */
export function normalizePattern(pattern: BeatPattern): BeatPattern {
  const next = clonePattern(pattern);
  const blank = emptyPattern(pattern.length);
  for (const track of TRACKS) for (let step = pattern.length; step < MAX_STEPS; step += 1) next.steps[track][step] = 0;
  for (const track of SYNTH_TRACKS) for (let step = pattern.length; step < MAX_STEPS; step += 1) next.notes[track][step] = blank.notes[track][step];
  return next;
}

export function clonePattern(pattern: BeatPattern): BeatPattern {
  return {
    length: pattern.length,
    steps: Object.fromEntries(TRACKS.map((track) => [track, [...pattern.steps[track]]])) as Record<TrackId, number[]>,
    notes: Object.fromEntries(SYNTH_TRACKS.map((track) => [track, [...pattern.notes[track]]])) as Record<SynthTrack, number[]>,
  };
}

export function createBeatState(preset: PresetName = 'kelix lofi'): BeatState {
  const spec = PRESETS[preset];
  const a = patternFromSpec(spec);
  return {
    bpm: spec.bpm,
    swing: spec.swing,
    root: spec.root,
    scale: spec.scale,
    kit: spec.kit,
    patterns: [a, variation(a), emptyPattern(16), emptyPattern(16)],
    current: 0,
    song: [0, 0, 0, 1],
    songMode: false,
    tracks: defaultTrackSettings(),
    fx: { ...spec.fx },
  };
}

export function createEmptyState(): BeatState {
  return {
    ...createBeatState('kelix lofi'),
    patterns: [emptyPattern(16), emptyPattern(16), emptyPattern(16), emptyPattern(16)],
    song: [0],
    fx: { filter: 50, reverb: 20, delay: 0 },
  };
}

/* ----------------------------------- editing ----------------------------------- */

export function stepVelocity(pattern: BeatPattern, track: TrackId, step: number): Velocity {
  return (pattern.steps[track][step] ?? 0) as Velocity;
}

export function isStepOn(pattern: BeatPattern, track: TrackId, step: number): boolean {
  return stepVelocity(pattern, track, step) > 0;
}

export function setStep(pattern: BeatPattern, track: TrackId, step: number, velocity: Velocity): BeatPattern {
  if (step < 0 || step >= MAX_STEPS || pattern.steps[track][step] === velocity) return pattern;
  const steps = { ...pattern.steps, [track]: [...pattern.steps[track]] };
  steps[track][step] = velocity;
  return { ...pattern, steps };
}

export function toggleStep(pattern: BeatPattern, track: TrackId, step: number): BeatPattern {
  return setStep(pattern, track, step, isStepOn(pattern, track, step) ? 0 : 2);
}

/** Soft, normal, accent, then around again. Turns the step on if it was off. */
export function cycleVelocity(pattern: BeatPattern, track: TrackId, step: number): BeatPattern {
  const current = stepVelocity(pattern, track, step);
  const next = (current === 0 ? 2 : current === 3 ? 1 : current + 1) as Velocity;
  return setStep(pattern, track, step, next);
}

export function setStepDegree(pattern: BeatPattern, track: SynthTrack, step: number, degree: number): BeatPattern {
  const clamped = Math.max(0, Math.min(MAX_DEGREE, Math.round(degree)));
  if (pattern.notes[track][step] === clamped) return pattern;
  const notes = { ...pattern.notes, [track]: [...pattern.notes[track]] };
  notes[track][step] = clamped;
  return { ...pattern, notes };
}

export function changeStepDegree(pattern: BeatPattern, track: SynthTrack, step: number, amount: number, scale: ScaleId): BeatPattern {
  const max = degreeCount(scale) - 1;
  const next = Math.max(0, Math.min(max, pattern.notes[track][step] + amount));
  return setStepDegree(pattern, track, step, next);
}

export function setPatternLength(pattern: BeatPattern, length: PatternLength): BeatPattern {
  return pattern.length === length ? pattern : { ...pattern, length };
}

export function clearPattern(pattern: BeatPattern): BeatPattern {
  return { ...pattern, steps: emptySteps() };
}

export function clearTrack(pattern: BeatPattern, track: TrackId): BeatPattern {
  return { ...pattern, steps: { ...pattern.steps, [track]: new Array<number>(MAX_STEPS).fill(0) } };
}

export function replacePattern(state: BeatState, index: number, pattern: BeatPattern): BeatState {
  if (state.patterns[index] === pattern) return state;
  const patterns = state.patterns.slice();
  patterns[index] = pattern;
  return { ...state, patterns };
}

export function updateTrack(state: BeatState, track: TrackId, changes: Partial<TrackSettings>): BeatState {
  return { ...state, tracks: { ...state.tracks, [track]: { ...state.tracks[track], ...changes } } };
}

export function clampBpm(bpm: number): number {
  return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
}

/* ----------------------------------- timing ----------------------------------- */

export function sixteenthDuration(bpm: number): number {
  return 60 / Math.max(1, bpm) / 4;
}

/** Swing delays the offbeat sixteenths by up to half a step. */
export function swingOffset(step: number, bpm: number, swing: number): number {
  if (step % 2 === 0) return 0;
  return sixteenthDuration(bpm) * (Math.max(0, Math.min(SWING_MAX, swing)) / 100) * 0.5;
}

export function beatStepTime(step: number, bpm: number, swing: number): number {
  return step * sixteenthDuration(bpm) + swingOffset(step, bpm, swing);
}

export function velocityGain(velocity: number): number {
  if (velocity <= 0) return 0;
  if (velocity === 1) return 0.5;
  if (velocity === 2) return 0.82;
  return 1;
}

/** 0 to 100 maps to roughly 0.4x to 2.4x the kit's natural decay, with 50 as natural. */
export function decayMultiplier(decay: number): number {
  const d = Math.max(0, Math.min(100, decay));
  return d <= 50 ? 0.4 + (0.6 * d) / 50 : 1 + ((d - 50) / 50) * 1.4;
}

export function pitchRatio(semitones: number): number {
  return 2 ** (Math.max(-12, Math.min(12, semitones)) / 12);
}

/** The delay echoes a dotted eighth behind the beat. */
export function delayTime(bpm: number): number {
  return sixteenthDuration(bpm) * 3;
}

/** Master filter: 50 is open, lower sweeps a low-pass down, higher sweeps a high-pass up. */
export function filterSettings(amount: number): { type: 'lowpass' | 'highpass'; frequency: number } {
  const a = Math.max(0, Math.min(100, amount));
  if (a >= 50) {
    const t = (a - 50) / 50;
    return { type: 'highpass', frequency: 20 + t * t * 3200 };
  }
  const t = a / 50;
  return { type: 'lowpass', frequency: 150 + t * t * 19850 };
}

/** Which pattern the transport starts on. */
export function startPosition(state: BeatState): Position {
  if (state.songMode && state.song.length) return { pattern: state.song[0], step: 0, songIndex: 0 };
  return { pattern: state.current, step: 0, songIndex: 0 };
}

/** The next step, following the song chain when the pattern ends. Pattern changes land on the loop boundary. */
export function advancePosition(position: Position, state: BeatState): Position {
  const length = state.patterns[position.pattern]?.length ?? 16;
  if (position.step + 1 < length) return { ...position, step: position.step + 1 };
  if (state.songMode && state.song.length) {
    const songIndex = (position.songIndex + 1) % state.song.length;
    return { pattern: state.song[songIndex], step: 0, songIndex };
  }
  return { pattern: state.current, step: 0, songIndex: 0 };
}

/** Tap tempo from tap timestamps in milliseconds. Taps more than two seconds apart start over. */
export function tapTempo(taps: number[]): number | null {
  const recent: number[] = [];
  for (const tap of taps) {
    if (recent.length && tap - recent[recent.length - 1] > 2000) recent.length = 0;
    recent.push(tap);
  }
  const used = recent.slice(-6);
  if (used.length < 2) return null;
  const interval = (used[used.length - 1] - used[0]) / (used.length - 1);
  if (interval <= 0) return null;
  return clampBpm(60000 / interval);
}

/** Quantize a live hit to the nearest scheduled step. */
export function nearestStep(hitTime: number, scheduled: Array<{ time: number; step: number; pattern: number }>): { step: number; pattern: number } | null {
  let best: { time: number; step: number; pattern: number } | null = null;
  for (const entry of scheduled) {
    if (!best || Math.abs(entry.time - hitTime) < Math.abs(best.time - hitTime)) best = entry;
  }
  return best ? { step: best.step, pattern: best.pattern } : null;
}

/* ---------------------------------- randomize ---------------------------------- */

export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/**
 * A musical pattern in the kit's style: the kick always lands on the one, snares or claps sit on
 * the backbeat, hats carry the pulse, and the melodic tracks stay in the scale around chord tones.
 */
export function randomizePattern(state: BeatState, pattern: BeatPattern, rng: Rng): BeatPattern {
  const next = clearPattern(clonePattern(pattern));
  const length = next.length;
  const bars = Math.max(1, length / 16);
  const kit = state.kit;
  const on = (track: TrackId, step: number, velocity: Velocity = 2) => {
    if (step < length) next.steps[track][step] = velocity;
  };
  const degrees = degreeCount(state.scale);
  const chord = [0, 2, 4].filter((d) => d < degrees);
  const note = (track: SynthTrack, step: number, degree: number) => {
    next.notes[track][step] = Math.max(0, Math.min(degrees - 1, degree));
  };

  for (let bar = 0; bar < bars; bar += 1) {
    const base = bar * 16;
    const span = Math.min(16, length - base);
    const inBar = (step: number) => step < span;

    if (kit === 'house') {
      for (const step of [0, 4, 8, 12]) if (inBar(step)) on('kick', base + step, 3);
      for (const step of [4, 12]) if (inBar(step)) on('clap', base + step, 2);
      for (const step of [2, 6, 10, 14]) if (inBar(step)) on(chance(rng, 0.7) ? 'open hat' : 'hat', base + step, 1);
      for (let step = 0; step < span; step += 2) if (chance(rng, 0.55)) on('hat', base + step, step % 4 === 0 ? 2 : 1);
      if (chance(rng, 0.4) && inBar(14)) on('snare', base + 14, 1);
    } else {
      on('kick', base, 3);
      const kickPool = kit === '808' ? [6, 7, 10, 11, 14] : kit === 'acoustic' ? [6, 7, 8, 10, 11] : [7, 8, 10, 11, 13];
      const extraKicks = 1 + Math.floor(rng() * 2) + (kit === '808' && chance(rng, 0.5) ? 1 : 0);
      for (let index = 0; index < extraKicks; index += 1) {
        const step = pick(rng, kickPool);
        if (inBar(step)) on('kick', base + step, step % 4 === 0 ? 2 : chance(rng, 0.25) ? 1 : 2);
      }
      for (const step of [4, 12]) if (inBar(step)) on('snare', base + step, 3);
      if (chance(rng, 0.35) && inBar(15)) on('snare', base + (chance(rng, 0.5) ? 15 : 7), 1);
      if (kit === '808') {
        for (let step = 0; step < span; step += 1) on('hat', base + step, step % 4 === 0 ? 2 : chance(rng, 0.3) ? 1 : 2);
        for (let step = 1; step < span; step += 2) if (chance(rng, 0.35)) next.steps.hat[base + step] = 1;
        if (chance(rng, 0.7)) on('open hat', base + pick(rng, [7, 15]), 2);
        if (chance(rng, 0.6)) on('clap', base + 12, 2);
      } else {
        for (let step = 0; step < span; step += 2) if (chance(rng, 0.9)) on('hat', base + step, step % 4 === 0 ? 2 : 1);
        if (chance(rng, 0.5)) on('hat', base + pick(rng, [3, 7, 11, 15]), 1);
        if (chance(rng, 0.6)) on('open hat', base + pick(rng, [6, 14]), 2);
        if (chance(rng, 0.5)) for (const step of [4, 12]) if (inBar(step)) on('clap', base + step, 1);
      }
    }

    const kickSteps = Array.from({ length: span }, (_, step) => step).filter((step) => next.steps.kick[base + step] > 0);
    for (const step of kickSteps) {
      if (chance(rng, 0.85)) {
        on('bass', base + step, 2);
        note('bass', base + step, step === 0 ? 0 : pick(rng, [0, 0, 2, 4, 5]));
      }
    }
    if (chance(rng, 0.5)) {
      const step = pick(rng, [11, 14, 15]);
      if (inBar(step)) {
        on('bass', base + step, 1);
        note('bass', base + step, pick(rng, [2, 4, 6]));
      }
    }

    const keysSteps = kit === 'house' ? [2, 6, 10, 14] : pick(rng, [[2, 6, 10, 14], [0, 6, 10], [3, 11], [2, 10]]);
    let chordDegree = pick(rng, chord);
    for (const step of keysSteps) {
      if (!inBar(step) || !chance(rng, 0.85)) continue;
      on('keys', base + step, step % 8 === 2 ? 2 : 1);
      note('keys', base + step, chordDegree + pick(rng, [0, 2, 4]));
      if (chance(rng, 0.3)) chordDegree = pick(rng, chord);
    }

    const leadCount = 1 + Math.floor(rng() * 3);
    let last = pick(rng, [5, 7, 9]);
    for (let index = 0; index < leadCount; index += 1) {
      const step = pick(rng, [1, 3, 5, 6, 9, 11, 13, 14]);
      if (!inBar(step)) continue;
      on('lead', base + step, chance(rng, 0.3) ? 1 : 2);
      last = Math.max(2, Math.min(degrees - 1, last + pick(rng, [-2, -1, 1, 2])));
      note('lead', base + step, last);
    }
  }
  return next;
}

/* ----------------------------------- history ----------------------------------- */

export const HISTORY_LIMIT = 100;

export type History<T> = { past: T[]; present: T; future: T[]; coalesceKey: string | null };

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], coalesceKey: null };
}

/** Pushes a new state. Consecutive edits with the same coalesce key fold into one undo step. */
export function pushHistory<T>(history: History<T>, next: T, coalesceKey: string | null = null): History<T> {
  if (next === history.present) return history;
  if (coalesceKey && coalesceKey === history.coalesceKey) return { ...history, present: next, future: [] };
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], coalesceKey };
}

/** Ends a run of coalesced edits so the next edit gets its own undo step. */
export function settleHistory<T>(history: History<T>): History<T> {
  return history.coalesceKey ? { ...history, coalesceKey: null } : history;
}

export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  const past = history.past.slice(0, -1);
  return { past, present: history.past[history.past.length - 1], future: [history.present, ...history.future], coalesceKey: null };
}

export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future, coalesceKey: null };
}

/* ------------------------------------ codec ------------------------------------ */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const bits = (first << 16) | ((hasSecond ? bytes[index + 1] : 0) << 8) | (hasThird ? bytes[index + 2] : 0);
    output += BASE64[(bits >> 18) & 63] + BASE64[(bits >> 12) & 63];
    if (hasSecond) output += BASE64[(bits >> 6) & 63];
    if (hasThird) output += BASE64[bits & 63];
  }
  return output;
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const normalized = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const output: number[] = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const chunk = normalized.slice(index, index + 4);
    if (chunk.length === 1) throw new Error('invalid base64');
    const values = chunk.split('').map((char) => {
      const value = BASE64.indexOf(char);
      if (value < 0) throw new Error('invalid base64');
      return value;
    });
    const bits = (values[0] << 18) | (values[1] << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0);
    output.push((bits >> 16) & 255);
    if (values.length > 2) output.push((bits >> 8) & 255);
    if (values.length > 3) output.push(bits & 255);
  }
  return Uint8Array.from(output);
}

function lengthCode(length: PatternLength): number {
  return PATTERN_LENGTHS.indexOf(length);
}

export function encodeBeatState(state: BeatState): string {
  const bytes: number[] = [];
  bytes.push(2, clampBpm(state.bpm), Math.max(0, Math.min(SWING_MAX, Math.round(state.swing))), state.root & 15, SCALES.indexOf(state.scale), KITS.indexOf(state.kit));
  bytes.push((state.current & 3) | (state.songMode ? 16 : 0));
  bytes.push(Math.round(state.fx.filter), Math.round(state.fx.reverb), Math.round(state.fx.delay));
  bytes.push(TRACKS.reduce((mask, track, index) => mask | (state.tracks[track].muted ? 1 << index : 0), 0));
  for (const track of TRACKS) {
    const settings = state.tracks[track];
    bytes.push(Math.round(settings.volume), Math.round(settings.pitch) + 12, Math.round(settings.decay));
  }
  const song = state.song.slice(0, MAX_SONG);
  bytes.push(song.length);
  for (let index = 0; index < song.length; index += 4) {
    let packed = 0;
    for (let offset = 0; offset < 4; offset += 1) packed |= ((song[index + offset] ?? 0) & 3) << (offset * 2);
    bytes.push(packed);
  }
  const present = state.patterns.map((pattern) => !isPatternEmpty(pattern) || pattern.length !== 16);
  bytes.push(present.reduce((mask, flag, index) => mask | (flag ? 1 << index : 0), 0));
  state.patterns.forEach((pattern, index) => {
    if (!present[index]) return;
    bytes.push(lengthCode(pattern.length));
    for (const track of TRACKS) {
      for (let step = 0; step < pattern.length; step += 4) {
        let packed = 0;
        for (let offset = 0; offset < 4; offset += 1) packed |= (pattern.steps[track][step + offset] & 3) << (offset * 2);
        bytes.push(packed);
      }
    }
    for (const track of SYNTH_TRACKS) {
      for (let step = 0; step < pattern.length; step += 2) {
        bytes.push((pattern.notes[track][step] & 15) | ((pattern.notes[track][step + 1] & 15) << 4));
      }
    }
  });
  return bytesToBase64Url(Uint8Array.from(bytes));
}

class Reader {
  index = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  byte(): number {
    if (this.index >= this.bytes.length) throw new Error('truncated');
    return this.bytes[this.index++];
  }
  range(min: number, max: number): number {
    const value = this.byte();
    if (value < min || value > max) throw new Error('out of range');
    return value;
  }
  done(): boolean {
    return this.index === this.bytes.length;
  }
}

function decodeV2(bytes: Uint8Array): BeatState | null {
  try {
    const reader = new Reader(bytes);
    if (reader.byte() !== 2) return null;
    const bpm = reader.range(BPM_MIN, BPM_MAX);
    const swing = reader.range(0, SWING_MAX);
    const root = reader.range(0, 11);
    const scale = SCALES[reader.range(0, SCALES.length - 1)];
    const kit = KITS[reader.range(0, KITS.length - 1)];
    const flags = reader.range(0, 31);
    const fx = { filter: reader.range(0, 100), reverb: reader.range(0, 100), delay: reader.range(0, 100) };
    const mutes = reader.byte();
    const tracks = defaultTrackSettings();
    TRACKS.forEach((track, index) => {
      tracks[track] = { volume: reader.range(0, 100), pitch: reader.range(0, 24) - 12, decay: reader.range(0, 100), muted: (mutes & (1 << index)) !== 0 };
    });
    const songLength = reader.range(0, MAX_SONG);
    const song: number[] = [];
    for (let index = 0; index < songLength; index += 4) {
      const packed = reader.byte();
      for (let offset = 0; offset < 4 && index + offset < songLength; offset += 1) song.push((packed >> (offset * 2)) & 3);
    }
    const present = reader.range(0, 15);
    const patterns = Array.from({ length: PATTERN_COUNT }, () => emptyPattern(16));
    for (let index = 0; index < PATTERN_COUNT; index += 1) {
      if (!(present & (1 << index))) continue;
      const length = PATTERN_LENGTHS[reader.range(0, PATTERN_LENGTHS.length - 1)];
      const pattern = emptyPattern(length);
      for (const track of TRACKS) {
        for (let step = 0; step < length; step += 4) {
          const packed = reader.byte();
          for (let offset = 0; offset < 4; offset += 1) pattern.steps[track][step + offset] = (packed >> (offset * 2)) & 3;
        }
      }
      for (const track of SYNTH_TRACKS) {
        for (let step = 0; step < length; step += 2) {
          const packed = reader.byte();
          pattern.notes[track][step] = Math.min(MAX_DEGREE, packed & 15);
          pattern.notes[track][step + 1] = Math.min(MAX_DEGREE, packed >> 4);
        }
      }
      patterns[index] = pattern;
    }
    if (!reader.done()) return null;
    return { bpm, swing, root, scale, kit, patterns, current: flags & 3, song: song.length ? song : [0], songMode: (flags & 16) !== 0, tracks, fx };
  } catch {
    return null;
  }
}

const V1_KEYS: Record<string, number> = { 'A minor': 9, 'C minor': 0, 'D minor': 2, 'E minor': 4, 'G minor': 7 };

/** Links made by the first Beat Pad: one 16-step pattern as bitmasks with pentatonic note indexes. */
function decodeV1(json: string): BeatState | null {
  try {
    const packed = JSON.parse(json) as { v?: number; b?: number; s?: number; k?: string; p?: number[]; n?: string[] };
    if (
      packed.v !== 1
      || !Number.isInteger(packed.b) || packed.b! < 60 || packed.b! > 160
      || !Number.isInteger(packed.s) || packed.s! < 0 || packed.s! > 60
      || typeof packed.k !== 'string' || !(packed.k in V1_KEYS)
      || !Array.isArray(packed.p) || packed.p.length !== TRACKS.length
      || !packed.p.every((value) => Number.isInteger(value) && value >= 0 && value <= 65535)
      || !Array.isArray(packed.n) || packed.n.length !== SYNTH_TRACKS.length
      || !packed.n.every((notes) => /^[0-4]{16}$/.test(notes))
    ) return null;
    const pattern = emptyPattern(16);
    TRACKS.forEach((track, index) => {
      for (let step = 0; step < 16; step += 1) pattern.steps[track][step] = packed.p![index] & (1 << step) ? 2 : 0;
    });
    SYNTH_TRACKS.forEach((track, index) => {
      packed.n![index].split('').forEach((digit, step) => { pattern.notes[track][step] = Number(digit); });
    });
    return {
      ...createEmptyState(),
      bpm: packed.b!,
      swing: packed.s!,
      root: V1_KEYS[packed.k],
      scale: 'minor pentatonic',
      kit: 'lofi',
      patterns: [pattern, emptyPattern(16), emptyPattern(16), emptyPattern(16)],
      song: [0],
    };
  } catch {
    return null;
  }
}

export function decodeBeatState(encoded: string): BeatState | null {
  if (!encoded || encoded.length > 4000) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(encoded);
  } catch {
    return null;
  }
  if (!bytes.length) return null;
  if (bytes[0] === 0x7b) return decodeV1(String.fromCharCode(...bytes));
  return decodeV2(bytes);
}
