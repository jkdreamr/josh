// The music: a slow, serious military score in D minor, played live on the arcade's music bus (so the shell's Music
// switch and pause silence it). Low strings hold the chords, war drums and a field snare carry the march, and a horn
// states the theme now and then. It follows the round: quiet strings and a distant drum while buying, the march once
// the round is live, a driving pulse when the charge is down or a side is down to its last.
import { sfx } from '../../kit';

type Graph = NonNullable<ReturnType<typeof sfx.graph>>;

export type Mood = 'off' | 'calm' | 'march' | 'urgent';

const BPM = 82;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/** The progression, a chord a bar: D minor, B flat, G minor, A (the dominant pulling back home). */
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 73.42, tones: [146.83, 174.61, 220] },
  { root: 58.27, tones: [116.54, 146.83, 174.61] },
  { root: 49, tones: [98, 116.54, 146.83] },
  { root: 55, tones: [110, 138.59, 164.81] },
];
/** The horn's theme over four bars: (frequency, start beat, length in beats). */
const THEME: [number, number, number][] = [
  [146.83, 0, 1.5],
  [174.61, 1.5, 0.5],
  [220, 2, 2],
  [233.08, 4, 1],
  [220, 5, 1],
  [196, 6, 2],
  [174.61, 8, 1.5],
  [164.81, 9.5, 0.5],
  [146.83, 10, 2],
  [138.59, 12, 1],
  [164.81, 13, 1],
  [146.83, 14, 2],
];
/** A field snare cadence in sixteenths (2 accent, 1 ghost, 0 rest), two bars long. */
const SNARE = [2, 0, 0, 1, 2, 0, 1, 1, 2, 0, 0, 1, 2, 1, 1, 1, 2, 0, 0, 1, 2, 0, 1, 0, 2, 0, 1, 1, 2, 2, 2, 2];

let noiseBuf: AudioBuffer | null = null;
function noise(g: Graph) {
  if (!noiseBuf || noiseBuf.sampleRate !== g.ctx.sampleRate) {
    const len = Math.floor(g.ctx.sampleRate * 2);
    noiseBuf = g.ctx.createBuffer(1, len, g.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function voice(g: Graph, t: number, o: { type: OscillatorType; freq: number; detune?: number; attack: number; hold: number; release: number; vol: number; lowpass: number; q?: number }) {
  const v = g.ctx.createOscillator();
  v.type = o.type;
  v.frequency.value = o.freq;
  if (o.detune) v.detune.value = o.detune;
  const f = g.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = o.lowpass;
  f.Q.value = o.q ?? 0.6;
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.vol, t + o.attack);
  env.gain.setValueAtTime(o.vol, t + o.attack + o.hold);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.hold + o.release);
  v.connect(f).connect(env).connect(g.music);
  v.start(t);
  v.stop(t + o.attack + o.hold + o.release + 0.05);
}

function hit(g: Graph, t: number, o: { type: BiquadFilterType; freq: number; q?: number; decay: number; vol: number }) {
  const src = g.ctx.createBufferSource();
  src.buffer = noise(g);
  const f = g.ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 0.8;
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(o.vol, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
  src.connect(f).connect(env).connect(g.music);
  src.start(t, Math.random() * 1.5, o.decay + 0.05);
}

function drum(g: Graph, t: number, vol: number) {
  // a war drum: a falling low tone and a dull skin
  const v = g.ctx.createOscillator();
  v.type = 'sine';
  v.frequency.setValueAtTime(82, t);
  v.frequency.exponentialRampToValueAtTime(38, t + 0.45);
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(vol, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  v.connect(env).connect(g.music);
  v.start(t);
  v.stop(t + 0.65);
  hit(g, t, { type: 'lowpass', freq: 260, decay: 0.3, vol: vol * 0.6 });
}

function snare(g: Graph, t: number, vol: number) {
  hit(g, t, { type: 'bandpass', freq: 1900, q: 0.7, decay: 0.11, vol });
  hit(g, t, { type: 'highpass', freq: 5000, decay: 0.05, vol: vol * 0.4 });
  const v = g.ctx.createOscillator();
  v.type = 'triangle';
  v.frequency.setValueAtTime(220, t);
  v.frequency.exponentialRampToValueAtTime(170, t + 0.06);
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(vol * 0.5, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  v.connect(env).connect(g.music);
  v.start(t);
  v.stop(t + 0.1);
}

/** Schedules the score a little ahead of the audio clock; call it every frame (or so) while a round plays. */
export class Score {
  private nextBar = -1;
  private bar = 0;
  private live = false;

  /** Moves the score along: `mood` is what the round calls for now (it takes effect from the next bar). */
  tick(mood: Mood) {
    const g = sfx.graph();
    const now = sfx.clock();
    if (!g || now === null || mood === 'off' || !sfx.isMusicOn()) {
      this.stop();
      return;
    }
    if (!this.live) {
      sfx.fadeMusic(true);
      this.live = true;
      this.nextBar = now + 0.1;
    }
    // a clock that jumped (a hidden tab) starts again from the next bar rather than catching up
    if (this.nextBar < now - 0.5) this.nextBar = now + 0.1;
    while (this.nextBar < now + 0.6) {
      this.playBar(g, this.nextBar, mood);
      this.nextBar += BAR;
      this.bar++;
    }
  }

  /** Fades out what is scheduled and starts over from the top next time. */
  stop() {
    if (!this.live) return;
    this.live = false;
    this.bar = 0;
    sfx.fadeMusic(false);
  }

  private playBar(g: Graph, t: number, mood: Mood) {
    const chord = CHORDS[this.bar % CHORDS.length];
    const loud = mood === 'calm' ? 0.6 : 1;
    // low strings: each chord tone a pair of slightly detuned saws, dark and slow to swell
    for (const f of chord.tones)
      for (const d of [-7, 6]) voice(g, t, { type: 'sawtooth', freq: f, detune: d, attack: 0.7, hold: BAR - 1.1, release: 1.2, vol: 0.016 * loud, lowpass: mood === 'urgent' ? 900 : 650 });
    // the bass under them
    voice(g, t, { type: 'sawtooth', freq: chord.root, attack: 0.3, hold: BAR - 0.6, release: 0.8, vol: 0.05 * loud, lowpass: 240 });
    if (mood === 'calm') {
      // far off: one drum a bar, and a swell every four
      drum(g, t, 0.12);
      if (this.bar % 4 === 3) hit(g, t + BEAT * 2, { type: 'highpass', freq: 3500, decay: BEAT * 2, vol: 0.02 });
      return;
    }
    // the march: war drums on one and three (and a pickup into the next bar), the field snare in sixteenths
    drum(g, t, 0.22);
    drum(g, t + BEAT * 2, 0.18);
    if (mood === 'urgent' || this.bar % 2 === 1) drum(g, t + BEAT * 3.5, 0.14);
    const half = (this.bar % 2) * 16;
    for (let i = 0; i < 16; i++) {
      const k = SNARE[half + i];
      if (k) snare(g, t + (i * BEAT) / 4, k === 2 ? 0.08 : 0.03);
    }
    if (mood === 'urgent') {
      // a driving pulse of low strings in eighths
      for (let i = 0; i < 8; i++) voice(g, t + (i * BEAT) / 2, { type: 'sawtooth', freq: chord.root * 2, attack: 0.01, hold: 0.05, release: 0.18, vol: 0.035, lowpass: 900 });
    } else if (this.bar % 8 < 4) {
      // the horn states the theme in the first half of every eight bars
      const at = (this.bar % 4) * 4;
      for (const [f, start, len] of THEME)
        if (start >= at && start < at + 4) {
          const st = t + (start - at) * BEAT;
          voice(g, st, { type: 'sawtooth', freq: f, attack: 0.08, hold: len * BEAT - 0.15, release: 0.4, vol: 0.03, lowpass: 1100, q: 1 });
          voice(g, st, { type: 'sawtooth', freq: f, detune: 8, attack: 0.08, hold: len * BEAT - 0.15, release: 0.4, vol: 0.02, lowpass: 1100, q: 1 });
        }
    }
  }
}
