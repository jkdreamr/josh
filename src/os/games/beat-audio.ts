import {
  advancePosition,
  chordForDegree,
  decayMultiplier,
  delayTime,
  filterSettings,
  nearestStep,
  pitchForDegree,
  pitchRatio,
  sixteenthDuration,
  startPosition,
  swingOffset,
  SYNTH_TRACKS,
  TRACKS,
  velocityGain,
  type BeatState,
  type KitId,
  type Position,
  type SynthTrack,
  type TrackId,
} from './beat';

type Scheduled = { time: number; step: number; pattern: number; songIndex: number };

export type EngineHooks = {
  getState: () => BeatState;
  getSolo: () => TrackId | null;
  onRecord: (pattern: number, step: number, track: TrackId) => void;
};

const LOOKAHEAD = 0.14;
const HIDDEN_LOOKAHEAD = 1.6;
const TICK_MS = 25;
const TAIL = 0.0005;

type Voice = {
  kit: KitId;
  time: number;
  gain: number;
  accent: boolean;
  pitch: number;
  decay: number;
  stepDuration: number;
  frequencies: number[];
  dest: AudioNode;
};

type Channel = { input: GainNode; low: BiquadFilterNode; high: BiquadFilterNode; pan: StereoPannerNode | null; reverb: GainNode; delay: GainNode };
type Held = { choke: GainNode; end: number; frequency: number };

/** How much of each track feeds the reverb and the delay. Kick and bass stay dry so the low end stays tight. */
const SENDS: Record<TrackId, [number, number]> = {
  kick: [0.08, 0],
  snare: [0.9, 0.25],
  hat: [0.35, 0.2],
  'open hat': [0.5, 0.3],
  clap: [1, 0.45],
  bass: [0, 0],
  keys: [1, 0.7],
  lead: [0.8, 1],
};

type KickPatch = { start: number; end: number; sweep: number; body: number; drive: number; click: number; clickFreq: number; sub?: number };
const KICKS: Record<KitId, KickPatch> = {
  '808': { start: 150, end: 47, sweep: 0.08, body: 0.62, drive: 1.8, click: 0.16, clickFreq: 3200, sub: 0.25 },
  acoustic: { start: 118, end: 58, sweep: 0.045, body: 0.3, drive: 1.5, click: 0.34, clickFreq: 2600 },
  lofi: { start: 135, end: 50, sweep: 0.06, body: 0.34, drive: 1.6, click: 0.12, clickFreq: 1100 },
  house: { start: 230, end: 50, sweep: 0.034, body: 0.38, drive: 2.6, click: 0.26, clickFreq: 4600 },
  techno: { start: 280, end: 47, sweep: 0.03, body: 0.44, drive: 3.6, click: 0.3, clickFreq: 5200, sub: 0.15 },
  breaks: { start: 160, end: 60, sweep: 0.03, body: 0.22, drive: 2, click: 0.36, clickFreq: 3600 },
};

type SnarePatch = { tones: number[]; tone: number; toneDecay: number; noise: number; noiseDecay: number; band: number; floor: number; snap: number };
const SNARES: Record<KitId, SnarePatch> = {
  '808': { tones: [180, 330], tone: 0.3, toneDecay: 0.11, noise: 0.5, noiseDecay: 0.18, band: 1900, floor: 600, snap: 0 },
  acoustic: { tones: [185, 290], tone: 0.34, toneDecay: 0.09, noise: 0.55, noiseDecay: 0.24, band: 4200, floor: 1500, snap: 0.32 },
  lofi: { tones: [172], tone: 0.3, toneDecay: 0.1, noise: 0.44, noiseDecay: 0.16, band: 1300, floor: 400, snap: 0.08 },
  house: { tones: [205, 300], tone: 0.3, toneDecay: 0.1, noise: 0.6, noiseDecay: 0.2, band: 5600, floor: 1900, snap: 0.12 },
  techno: { tones: [215], tone: 0.24, toneDecay: 0.08, noise: 0.52, noiseDecay: 0.15, band: 6000, floor: 2400, snap: 0.1 },
  breaks: { tones: [225, 340], tone: 0.36, toneDecay: 0.08, noise: 0.62, noiseDecay: 0.15, band: 5000, floor: 1700, snap: 0.42 },
};

type HatPatch = { metal: number; noise: number; floor: number; band: number; closed: number; open: number };
const HATS: Record<KitId, HatPatch> = {
  '808': { metal: 0.3, noise: 0.06, floor: 7000, band: 10000, closed: 0.05, open: 0.36 },
  acoustic: { metal: 0.05, noise: 0.32, floor: 8000, band: 10500, closed: 0.045, open: 0.34 },
  lofi: { metal: 0, noise: 0.3, floor: 5600, band: 8000, closed: 0.04, open: 0.26 },
  house: { metal: 0.18, noise: 0.22, floor: 8200, band: 11000, closed: 0.045, open: 0.3 },
  techno: { metal: 0.24, noise: 0.18, floor: 8600, band: 11500, closed: 0.035, open: 0.24 },
  breaks: { metal: 0.04, noise: 0.32, floor: 9000, band: 12000, closed: 0.035, open: 0.22 },
};

type ClapPatch = { bursts: number; spacing: number; tail: number; band: number; q: number; level: number };
const CLAPS: Record<KitId, ClapPatch> = {
  '808': { bursts: 4, spacing: 0.011, tail: 0.2, band: 1250, q: 1.3, level: 0.62 },
  acoustic: { bursts: 4, spacing: 0.012, tail: 0.24, band: 1500, q: 0.9, level: 0.56 },
  lofi: { bursts: 3, spacing: 0.014, tail: 0.15, band: 1000, q: 0.9, level: 0.52 },
  house: { bursts: 4, spacing: 0.01, tail: 0.22, band: 1600, q: 1.1, level: 0.64 },
  techno: { bursts: 3, spacing: 0.009, tail: 0.26, band: 1900, q: 1.4, level: 0.6 },
  breaks: { bursts: 3, spacing: 0.009, tail: 0.14, band: 1800, q: 1, level: 0.58 },
};

function makeNoise(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** Vinyl surface noise: a quiet hiss with sparse pops, looped under the Lo-Fi kit. */
function makeCrackle(context: BaseAudioContext): AudioBuffer {
  const length = context.sampleRate * 4;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let hiss = 0;
  for (let index = 0; index < length; index += 1) {
    hiss += ((Math.random() * 2 - 1) - hiss) * 0.08;
    data[index] = hiss * 0.18;
    if (Math.random() < 0.00035) {
      const size = 0.3 + Math.random() * 0.7;
      for (let k = 0; k < 40 && index + k < length; k += 1) data[index + k] += size * (Math.random() * 2 - 1) * (1 - k / 40);
    }
  }
  return buffer;
}

function makeImpulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let index = 0; index < length; index += 1) {
      const t = index / length;
      const predelay = Math.min(1, index / (context.sampleRate * 0.012));
      const white = Math.random() * 2 - 1;
      smooth += (white - smooth) * 0.35;
      data[index] = smooth * predelay * (1 - t) ** 2.6;
    }
  }
  return buffer;
}

function makeCrushCurve(levels: number, drive: number) {
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    const soft = Math.tanh(x * drive);
    curve[index] = Math.round(soft * levels) / levels;
  }
  return curve;
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 10);
  let curve = curves.get(key);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    curves.set(key, curve);
  }
  return curve;
}

export class BeatEngine {
  readonly context: AudioContext;
  /** The final mix, for meters and visualizers. */
  readonly tap: AudioNode;
  private readonly hooks: EngineHooks;
  private readonly noise: AudioBuffer;
  private readonly crackleBuffer: AudioBuffer;
  private readonly bus: GainNode;
  private readonly pumpBus: GainNode;
  private readonly dry: GainNode;
  private readonly lofi: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly reverbIn: GainNode;
  private readonly delayIn: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly crackleGain: GainNode;
  private readonly channels: Record<TrackId, Channel>;
  private crackle: AudioBufferSourceNode | null = null;
  private timer: number | null = null;
  private position: Position = { pattern: 0, step: 0, songIndex: 0 };
  private nextTime = 0;
  private scheduled: Scheduled[] = [];
  private lastBpm = 0;
  private unlocked = false;
  private live: { x: number; y: number } | null = null;
  private repeatSize: number | null = null;
  private repeat: { pattern: number; step: number; count: number } | null = null;
  private openHat: Held | null = null;
  private held: Partial<Record<SynthTrack, Held>> = {};
  playing = false;
  recording = false;

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    this.noise = makeNoise(context);
    this.crackleBuffer = makeCrackle(context);

    this.filter = context.createBiquadFilter();
    this.filter.Q.value = 0.8;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.16;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.09;
    const master = context.createGain();
    master.gain.value = 0.9;
    this.filter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(master);
    master.connect(context.destination);
    this.tap = master;

    // Everything meets on the bus, then goes clean or through the Lo-Fi tape stage into the playable filter.
    this.bus = context.createGain();
    this.bus.gain.value = 0.9;
    this.dry = context.createGain();
    this.lofi = context.createGain();
    this.lofi.gain.value = 0;
    this.bus.connect(this.dry);
    this.dry.connect(this.filter);
    this.bus.connect(this.lofi);
    const crush = context.createWaveShaper();
    crush.curve = makeCrushCurve(24, 1.4);
    const dust = context.createBiquadFilter();
    dust.type = 'lowpass';
    dust.frequency.value = 5600;
    dust.Q.value = 0.6;
    this.lofi.connect(crush);
    crush.connect(dust);
    dust.connect(this.filter);
    this.crackleGain = context.createGain();
    this.crackleGain.gain.value = 0;
    const crackleTone = context.createBiquadFilter();
    crackleTone.type = 'bandpass';
    crackleTone.frequency.value = 2400;
    crackleTone.Q.value = 0.5;
    this.crackleGain.connect(crackleTone);
    crackleTone.connect(this.filter);

    // Everything except the kick passes through the pump, which ducks on each kick.
    this.pumpBus = context.createGain();
    this.pumpBus.connect(this.bus);

    this.reverbIn = context.createGain();
    this.reverbIn.gain.value = 0;
    const reverb = context.createConvolver();
    reverb.buffer = makeImpulse(context, 2.2);
    const reverbLow = context.createBiquadFilter();
    reverbLow.type = 'highpass';
    reverbLow.frequency.value = 260;
    const reverbTone = context.createBiquadFilter();
    reverbTone.type = 'lowpass';
    reverbTone.frequency.value = 5600;
    this.reverbIn.connect(reverbLow);
    reverbLow.connect(reverb);
    reverb.connect(reverbTone);
    reverbTone.connect(this.pumpBus);

    this.delayIn = context.createGain();
    this.delayIn.gain.value = 0;
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.feedback.gain.value = 0.3;
    const delayTone = context.createBiquadFilter();
    delayTone.type = 'bandpass';
    delayTone.frequency.value = 1600;
    delayTone.Q.value = 0.45;
    this.delayIn.connect(this.delay);
    this.delay.connect(delayTone);
    delayTone.connect(this.feedback);
    this.feedback.connect(this.delay);
    delayTone.connect(this.pumpBus);

    this.channels = Object.fromEntries(TRACKS.map((track) => [track, this.makeChannel(track)])) as Record<TrackId, Channel>;
    this.applyState(hooks.getState(), true);
  }

  private makeChannel(track: TrackId): Channel {
    const context = this.context;
    const input = context.createGain();
    const low = context.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 20000;
    low.Q.value = 0.5;
    const high = context.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 3200;
    high.gain.value = 0;
    input.connect(low);
    low.connect(high);
    // Older Safari has no StereoPannerNode; those listeners just get a centered mix.
    const pan = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
    const out: AudioNode = pan ?? high;
    if (pan) high.connect(pan);
    out.connect(track === 'kick' ? this.bus : this.pumpBus);
    const reverb = context.createGain();
    reverb.gain.value = SENDS[track][0];
    const delay = context.createGain();
    delay.gain.value = SENDS[track][1];
    out.connect(reverb);
    out.connect(delay);
    reverb.connect(this.reverbIn);
    delay.connect(this.delayIn);
    return { input, low, high, pan, reverb, delay };
  }

  /** iOS and Chrome keep the context suspended until a gesture; call this from pointerdown or keydown. */
  unlock(): void {
    if (this.context.state !== 'running') void this.context.resume().catch(() => undefined);
    if (this.unlocked) return;
    this.unlocked = true;
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    source.connect(this.context.destination);
    source.start();
  }

  applyState(state: BeatState, immediate = false): void {
    const now = this.context.currentTime;
    const ramp = immediate ? 0 : 0.03;
    const live = this.live;
    const filter = filterSettings(live ? live.x * 100 : state.fx.filter);
    this.filter.type = filter.type;
    this.filter.frequency.setTargetAtTime(filter.frequency, now, live ? 0.012 : ramp);
    this.filter.Q.setTargetAtTime(live ? 0.8 + live.y * 13 : 0.8, now, live ? 0.012 : ramp);
    this.reverbIn.gain.setTargetAtTime((state.fx.reverb / 100) ** 1.4 * 0.85, now, ramp);
    this.delayIn.gain.setTargetAtTime((state.fx.delay / 100) ** 1.2 * 0.7, now, ramp);
    this.feedback.gain.setTargetAtTime(0.25 + (state.fx.delay / 100) * 0.3, now, ramp);
    const lofi = state.kit === 'lofi';
    this.lofi.gain.setTargetAtTime(lofi ? 1 : 0, now, ramp);
    this.dry.gain.setTargetAtTime(lofi ? 0 : 1, now, ramp);
    this.crackleGain.gain.setTargetAtTime(lofi && this.playing ? 0.05 : 0, now, ramp || 0.01);
    for (const track of TRACKS) {
      const settings = state.tracks[track];
      const channel = this.channels[track];
      const tone = Math.max(0, Math.min(100, settings.tone ?? 50));
      channel.low.frequency.setTargetAtTime(tone < 50 ? 350 * (20000 / 350) ** (tone / 50) : 20000, now, ramp);
      channel.high.gain.setTargetAtTime(tone > 50 ? ((tone - 50) / 50) * 9 : 0, now, ramp);
      channel.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, (settings.pan ?? 0) / 50)), now, ramp);
    }
    if (state.bpm !== this.lastBpm) {
      this.lastBpm = state.bpm;
      if (immediate) this.delay.delayTime.value = delayTime(state.bpm);
      else this.delay.delayTime.setTargetAtTime(delayTime(state.bpm), now, 0.08);
    }
  }

  /** The performance pad: x sweeps the filter like the Filter knob, y adds resonance. Pass null to let go. */
  setLive(x: number | null, y = 0): void {
    this.live = x === null ? null : { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    this.applyState(this.hooks.getState());
  }

  /** Hold to repeat the current slice of the loop, in sixteenths. The transport keeps its place underneath. */
  setRepeat(steps: number | null): void {
    this.repeatSize = steps;
    if (steps === null) this.repeat = null;
  }

  start(): void {
    if (this.playing) return;
    this.unlock();
    const state = this.hooks.getState();
    this.position = startPosition(state);
    this.nextTime = this.context.currentTime + 0.06;
    this.scheduled = [];
    this.repeat = null;
    this.held = {};
    this.openHat = null;
    this.playing = true;
    this.startCrackle();
    this.applyState(state);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.scheduled = [];
    this.repeat = null;
    const now = this.context.currentTime;
    this.pumpBus.gain.cancelScheduledValues(now);
    this.pumpBus.gain.setValueAtTime(1, now);
    this.crackleGain.gain.setTargetAtTime(0, now, 0.02);
    if (this.crackle) {
      try {
        this.crackle.stop(now + 0.1);
      } catch {
        // already stopped
      }
      this.crackle = null;
    }
  }

  dispose(): void {
    this.stop();
    void this.context.close().catch(() => undefined);
  }

  private startCrackle(): void {
    if (this.crackle) return;
    const source = this.context.createBufferSource();
    source.buffer = this.crackleBuffer;
    source.loop = true;
    source.connect(this.crackleGain);
    source.start();
    this.crackle = source;
  }

  /** The step the listener hears right now, or null when stopped. */
  playhead(): { pattern: number; step: number; songIndex: number } | null {
    if (!this.playing) return null;
    const now = this.context.currentTime + 0.012;
    let current: Scheduled | null = null;
    for (const entry of this.scheduled) {
      if (entry.time <= now) current = entry;
      else break;
    }
    return current ? { pattern: current.pattern, step: current.step, songIndex: current.songIndex } : null;
  }

  /** Finger drumming: plays right away and, when recording during playback, lands on the nearest step. */
  hit(track: TrackId, degree?: number): void {
    this.unlock();
    const state = this.hooks.getState();
    const time = this.context.currentTime + 0.002;
    this.play(state, track, time, 2, degree);
    if (this.recording && this.playing) {
      const target = nearestStep(time, this.scheduled.filter((entry) => Math.abs(entry.time - time) < 1));
      if (target) this.hooks.onRecord(target.pattern, target.step, track);
    }
  }

  private tick(): void {
    if (!this.playing) return;
    const state = this.hooks.getState();
    this.applyState(state);
    const context = this.context;
    const ahead = typeof document !== 'undefined' && document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD;
    const solo = this.hooks.getSolo();
    // If the page stalled long enough to fall behind, skip the missed steps instead of firing them all at once.
    while (this.nextTime < context.currentTime - 0.05) {
      this.position = advancePosition(this.position, state);
      this.nextTime += sixteenthDuration(state.bpm);
    }
    while (this.nextTime < context.currentTime + ahead) {
      const { pattern: patternIndex, step, songIndex } = this.position;
      let source = { pattern: patternIndex, step };
      if (this.repeatSize) {
        const size = this.repeatSize;
        if (!this.repeat) this.repeat = { pattern: patternIndex, step: step - (step % size), count: step % size };
        source = { pattern: this.repeat.pattern, step: this.repeat.step + (this.repeat.count % size) };
        this.repeat.count += 1;
      }
      const pattern = state.patterns[source.pattern];
      const time = this.nextTime + swingOffset(step, state.bpm, state.swing);
      if (pattern && source.step < pattern.length) {
        for (const track of TRACKS) {
          const velocity = pattern.steps[track][source.step];
          if (!velocity) continue;
          if (solo ? track !== solo : state.tracks[track].muted) continue;
          const degree = (SYNTH_TRACKS as readonly string[]).includes(track) ? pattern.notes[track as SynthTrack][source.step] : undefined;
          this.play(state, track, time, velocity, degree);
        }
      }
      this.scheduled.push({ time, step, pattern: patternIndex, songIndex });
      this.position = advancePosition(this.position, state);
      this.nextTime += sixteenthDuration(state.bpm);
    }
    const horizon = context.currentTime - 2;
    while (this.scheduled.length && this.scheduled[0].time < horizon) this.scheduled.shift();
  }

  private play(state: BeatState, track: TrackId, time: number, velocity: number, degree?: number): void {
    const settings = state.tracks[track];
    const gain = velocityGain(velocity) * (settings.volume / 80) ** 1.5;
    if (gain <= 0) return;
    const ratio = pitchRatio(settings.pitch);
    let frequencies: number[] = [];
    if (track === 'keys' && state.chords) {
      frequencies = chordForDegree(state.root, state.scale, degree ?? 0).map((pitch) => pitch.frequency * ratio);
    } else if ((SYNTH_TRACKS as readonly string[]).includes(track)) {
      frequencies = [pitchForDegree(track as SynthTrack, state.root, state.scale, degree ?? 0).frequency * ratio];
    }
    const voice: Voice = {
      kit: state.kit,
      time,
      gain,
      accent: velocity >= 3,
      pitch: ratio,
      decay: decayMultiplier(settings.decay),
      stepDuration: sixteenthDuration(state.bpm),
      frequencies,
      dest: this.channels[track].input,
    };
    switch (track) {
      case 'kick':
        this.pump(state, time);
        return this.kick(voice);
      case 'snare': return this.snare(voice);
      case 'hat': return this.hat(voice, false);
      case 'open hat': return this.hat(voice, true);
      case 'clap': return this.clap(voice);
      case 'bass': return this.bass(voice);
      case 'keys': return this.keys(voice);
      case 'lead': return this.lead(voice);
      default: return undefined;
    }
  }

  private pump(state: BeatState, time: number): void {
    const depth = (state.fx.pump ?? 0) / 100;
    if (depth <= 0) return;
    const gain = this.pumpBus.gain;
    gain.setTargetAtTime(1 - depth * 0.8, time, 0.004);
    gain.setTargetAtTime(1, time + 0.03, (60 / state.bpm) * 0.22);
  }

  /* ------------------------------- building blocks ------------------------------- */

  private envelope(dest: AudioNode, time: number, peak: number, attack: number, decay: number): { node: GainNode; end: number } {
    const node = this.context.createGain();
    const hold = Math.max(0.004, decay);
    node.gain.setValueAtTime(0, time);
    node.gain.linearRampToValueAtTime(peak, time + attack);
    node.gain.exponentialRampToValueAtTime(TAIL, time + attack + hold);
    node.gain.setValueAtTime(0, time + attack + hold + 0.002);
    node.connect(dest);
    return { node, end: time + attack + hold + 0.01 };
  }

  /** Attack, a held level, then a release, for pads and basses that should ring for their whole length. */
  private sustain(dest: AudioNode, time: number, peak: number, attack: number, length: number, release: number): { node: GainNode; end: number } {
    const node = this.context.createGain();
    const hold = Math.max(attack + 0.01, length);
    node.gain.setValueAtTime(0, time);
    node.gain.linearRampToValueAtTime(peak, time + attack);
    node.gain.setTargetAtTime(peak * 0.7, time + attack, hold * 0.5);
    node.gain.setTargetAtTime(0, time + hold, release / 4);
    node.connect(dest);
    return { node, end: time + hold + release + 0.02 };
  }

  private oscillator(type: OscillatorType, frequency: number, time: number, end: number, dest: AudioNode, detune = 0): OscillatorNode {
    const osc = this.context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), time);
    if (detune) osc.detune.setValueAtTime(detune, time);
    osc.connect(dest);
    osc.start(time);
    osc.stop(end);
    return osc;
  }

  private noiseSource(time: number, end: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.playbackRate.setValueAtTime(rate, time);
    source.loopStart = Math.random() * 1.5;
    source.connect(dest);
    source.start(time, source.loopStart);
    source.stop(end);
    return source;
  }

  private biquad(type: BiquadFilterType, frequency: number, q: number, dest: AudioNode): BiquadFilterNode {
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.min(20000, Math.max(20, frequency));
    filter.Q.value = q;
    filter.connect(dest);
    return filter;
  }

  private drive(amount: number, dest: AudioNode): WaveShaperNode {
    const shaper = this.context.createWaveShaper();
    shaper.curve = saturationCurve(amount);
    shaper.connect(dest);
    return shaper;
  }

  private level(value: number, dest: AudioNode): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    node.connect(dest);
    return node;
  }

  private lfo(rate: number, depth: number, target: AudioParam, time: number, end: number): void {
    const osc = this.context.createOscillator();
    osc.frequency.value = rate;
    const amount = this.context.createGain();
    amount.gain.value = depth;
    amount.connect(target);
    osc.connect(amount);
    osc.start(time);
    osc.stop(end);
  }

  /** A gain stage another note can cut off: open hats choked by closed hats, mono basses and leads. */
  private choke(dest: AudioNode): GainNode {
    return this.level(1, dest);
  }

  private cut(held: Held | null | undefined, time: number): void {
    if (held && held.end > time) held.choke.gain.setTargetAtTime(0, time, 0.008);
  }

  /* ------------------------------------ drums ------------------------------------ */

  private kick(v: Voice): void {
    const { time, pitch, decay } = v;
    const patch = KICKS[v.kit];
    const body = this.envelope(this.drive(patch.drive, v.dest), time, 0.95 * v.gain, 0.002, patch.body * decay);
    const osc = this.oscillator('sine', patch.start * pitch, time, body.end, body.node);
    osc.frequency.exponentialRampToValueAtTime(patch.end * pitch * 1.25, time + patch.sweep);
    osc.frequency.exponentialRampToValueAtTime(patch.end * pitch, time + patch.sweep * 3);
    if (patch.sub) {
      const sub = this.envelope(v.dest, time, patch.sub * v.gain, 0.008, patch.body * 1.2 * decay);
      this.oscillator('sine', patch.end * pitch, time, sub.end, sub.node);
    }
    const click = this.envelope(v.dest, time, patch.click * v.gain, 0.0006, 0.009);
    this.noiseSource(time, click.end, this.biquad('bandpass', patch.clickFreq, 0.9, click.node));
  }

  private snare(v: Voice): void {
    const { time, pitch, decay } = v;
    const patch = SNARES[v.kit];
    const tone = this.envelope(v.dest, time, patch.tone * v.gain, 0.0015, patch.toneDecay * decay);
    for (const frequency of patch.tones) {
      const osc = this.oscillator('triangle', frequency * pitch * 1.18, time, tone.end, tone.node);
      osc.frequency.exponentialRampToValueAtTime(frequency * pitch, time + 0.025);
    }
    const wires = this.envelope(v.dest, time, patch.noise * v.gain, 0.0015, patch.noiseDecay * decay);
    this.noiseSource(time, wires.end, this.biquad('highpass', patch.floor * pitch, 0.6, this.biquad('peaking', patch.band * pitch, 0.8, wires.node)), pitch);
    if (patch.snap) {
      const snap = this.envelope(v.dest, time, patch.snap * v.gain, 0.0006, 0.022);
      this.noiseSource(time, snap.end, this.biquad('bandpass', 3200 * pitch, 1.2, snap.node), pitch);
    }
  }

  private hat(v: Voice, open: boolean): void {
    const { time, pitch, decay } = v;
    const patch = HATS[v.kit];
    if (!open) this.cut(this.openHat, time);
    const length = (open ? patch.open : patch.closed) * decay * (v.accent ? 1.25 : 1);
    const choke = this.choke(v.dest);
    const { node, end } = this.envelope(choke, time, v.gain, 0.0008, length);
    const shape = this.biquad('highpass', patch.floor * pitch, 0.7, node);
    if (patch.metal) {
      // The 808 hat: six detuned square waves, band-passed until only the shimmer is left.
      const metal = this.biquad('bandpass', patch.band * pitch, 1.1, this.level(patch.metal, shape));
      for (const frequency of [205.3, 304.4, 369.6, 522.7, 540, 800]) this.oscillator('square', frequency * pitch * 1.7, time, end, metal);
    }
    if (patch.noise) this.noiseSource(time, end, this.biquad('peaking', patch.band * pitch, 1, this.level(patch.noise, shape)), pitch);
    if (open) this.openHat = { choke, end, frequency: 0 };
  }

  private clap(v: Voice): void {
    const { time, pitch, decay } = v;
    const { bursts, spacing, tail, band, q, level } = CLAPS[v.kit];
    const node = this.context.createGain();
    node.gain.setValueAtTime(0, time);
    for (let index = 0; index < bursts; index += 1) {
      const at = time + index * spacing * (1 + (index % 2) * 0.15);
      node.gain.linearRampToValueAtTime(level * v.gain, at + 0.0012);
      node.gain.exponentialRampToValueAtTime(level * v.gain * 0.2, at + spacing - 0.001);
    }
    const last = time + bursts * spacing + 0.002;
    node.gain.linearRampToValueAtTime(level * v.gain * 0.9, last);
    node.gain.exponentialRampToValueAtTime(TAIL, last + tail * decay);
    node.gain.setValueAtTime(0, last + tail * decay + 0.002);
    node.connect(v.dest);
    this.noiseSource(time, last + tail * decay + 0.01, this.biquad('highpass', 700, 0.5, this.biquad('bandpass', band * pitch, q, node)), pitch);
  }

  /* ------------------------------------ synths ------------------------------------ */

  /** Bass is mono: a new note cuts the last one, and the 808 glides into it when they overlap. */
  private bass(v: Voice): void {
    const { time, decay, stepDuration } = v;
    const frequency = v.frequencies[0];
    const previous = this.held.bass;
    const glideFrom = v.kit === '808' && previous && previous.end > time ? previous.frequency : 0;
    this.cut(previous, time);
    const choke = this.choke(v.dest);
    let end = time;
    if (v.kit === '808') {
      const amp = this.sustain(this.drive(2.4, choke), time, 0.62 * v.gain, 0.004, Math.max(0.35, stepDuration * 5) * decay, 0.12);
      end = amp.end;
      const tone = this.biquad('lowpass', 900, 0.5, amp.node);
      const body = this.oscillator('sine', glideFrom || frequency * 1.06, time, end, tone);
      body.frequency.exponentialRampToValueAtTime(frequency, time + (glideFrom ? 0.07 : 0.025));
      const click = this.envelope(choke, time, 0.12 * v.gain, 0.001, 0.02);
      this.oscillator('sine', frequency * 4, time, click.end, click.node);
    } else if (v.kit === 'acoustic') {
      const amp = this.envelope(choke, time, 0.48 * v.gain, 0.004, Math.max(0.3, stepDuration * 2.6) * decay);
      end = amp.end;
      const tone = this.biquad('lowpass', 900, 0.8, amp.node);
      tone.frequency.setValueAtTime(1400, time);
      tone.frequency.exponentialRampToValueAtTime(420, time + 0.18);
      this.oscillator('triangle', frequency, time, end, tone);
      this.oscillator('sawtooth', frequency, time, end, this.level(0.22, tone), 3);
      const pluck = this.envelope(choke, time, 0.08 * v.gain, 0.001, 0.014);
      this.noiseSource(time, pluck.end, this.biquad('bandpass', 1800, 1.2, pluck.node));
    } else if (v.kit === 'lofi') {
      const amp = this.sustain(choke, time, 0.5 * v.gain, 0.01, Math.max(0.24, stepDuration * 3) * decay, 0.14);
      end = amp.end;
      const tone = this.biquad('lowpass', 420, 0.7, amp.node);
      this.oscillator('sine', frequency, time, end, tone);
      this.oscillator('triangle', frequency, time, end, this.level(0.45, tone), -4);
    } else if (v.kit === 'house') {
      const amp = this.envelope(choke, time, 0.46 * v.gain, 0.003, Math.max(0.16, stepDuration * 1.8) * decay);
      end = amp.end;
      const tone = this.biquad('lowpass', 1600, 2.2, amp.node);
      tone.frequency.setValueAtTime(v.accent ? 2400 : 1600, time);
      tone.frequency.exponentialRampToValueAtTime(260, time + 0.16);
      this.oscillator('sawtooth', frequency, time, end, tone);
      this.oscillator('sine', frequency, time, end, this.level(0.8, amp.node));
    } else if (v.kit === 'techno') {
      const amp = this.envelope(this.drive(1.8, choke), time, 0.48 * v.gain, 0.002, Math.max(0.1, stepDuration * 0.95) * decay);
      end = amp.end;
      const tone = this.biquad('lowpass', 1200, 4, amp.node);
      tone.frequency.setValueAtTime(v.accent ? 1800 : 1100, time);
      tone.frequency.exponentialRampToValueAtTime(170, time + 0.09);
      this.oscillator('sawtooth', frequency, time, end, tone);
      this.oscillator('sine', frequency, time, end, this.level(0.7, amp.node));
    } else {
      // A Reese: two saws a little out of tune, so the low end slowly phases against itself.
      const amp = this.sustain(this.drive(1.6, choke), time, 0.42 * v.gain, 0.012, Math.max(0.6, stepDuration * 9) * decay, 0.18);
      end = amp.end;
      const tone = this.biquad('lowpass', 650, 1.2, amp.node);
      this.lfo(0.35, 260, tone.frequency, time, end);
      this.oscillator('sawtooth', frequency, time, end, tone, -16);
      this.oscillator('sawtooth', frequency, time, end, tone, 16);
      this.oscillator('sine', frequency, time, end, this.level(0.9, amp.node));
    }
    this.held.bass = { choke, end, frequency };
  }

  private keys(v: Voice): void {
    const { time, decay, stepDuration } = v;
    const voices = v.frequencies.length;
    const gain = v.gain / Math.sqrt(voices);
    for (const [index, frequency] of v.frequencies.entries()) {
      const spread = voices > 1 ? (index - (voices - 1) / 2) * 4 : 0;
      if (v.kit === '808' || v.kit === 'breaks') {
        // A soft pad: detuned saws behind a slow filter swell.
        const bright = v.kit === 'breaks' ? 2200 : 1300;
        const amp = this.sustain(v.dest, time, 0.13 * gain, 0.09, Math.max(0.7, stepDuration * 7) * decay, 0.5);
        const tone = this.biquad('lowpass', bright * 0.5, 0.6, amp.node);
        tone.frequency.linearRampToValueAtTime(bright, time + 0.35);
        this.oscillator('sawtooth', frequency, time, amp.end, tone, spread - 7);
        this.oscillator('sawtooth', frequency, time, amp.end, tone, spread + 7);
        this.oscillator('triangle', frequency / 2, time, amp.end, this.level(0.6, tone));
      } else if (v.kit === 'acoustic') {
        // Piano: a few partials that die away at different speeds, plus the hammer.
        const tone = this.biquad('lowpass', 3800, 0.5, v.dest);
        for (const [ratio, level, length] of [[1, 0.32, 1.1], [2, 0.13, 0.6], [3, 0.06, 0.32], [4, 0.025, 0.2]] as const) {
          const { node, end } = this.envelope(tone, time, level * gain, 0.002, length * decay);
          this.oscillator('sine', frequency * ratio, time, end, node, ratio === 1 ? spread : spread + 2);
        }
        const hammer = this.envelope(tone, time, 0.05 * gain, 0.001, 0.01);
        this.noiseSource(time, hammer.end, this.biquad('bandpass', 2400, 1.4, hammer.node));
      } else if (v.kit === 'lofi') {
        // An electric piano: a sine carrier struck by a decaying modulator, with a slow tremolo.
        const amp = this.envelope(v.dest, time, 0.3 * gain, 0.004, Math.max(0.9, stepDuration * 8) * decay);
        const tremolo = this.level(1, amp.node);
        this.lfo(4.6, 0.18, tremolo.gain, time, amp.end);
        const carrier = this.oscillator('sine', frequency, time, amp.end, this.biquad('lowpass', 2600, 0.5, tremolo), spread);
        const modulator = this.context.createOscillator();
        const index = this.context.createGain();
        modulator.frequency.value = frequency;
        index.gain.setValueAtTime(frequency * (v.accent ? 2.2 : 1.5), time);
        index.gain.exponentialRampToValueAtTime(frequency * 0.06, time + 0.5);
        modulator.connect(index);
        index.connect(carrier.frequency);
        modulator.start(time);
        modulator.stop(amp.end);
        this.lfo(0.6, 6, carrier.detune, time, amp.end);
      } else if (v.kit === 'house') {
        // Organ-ish piano stab.
        const amp = this.envelope(v.dest, time, 0.22 * gain, 0.003, Math.max(0.18, stepDuration * 2.2) * decay);
        const tone = this.biquad('lowpass', 3400, 0.9, amp.node);
        tone.frequency.setValueAtTime(3400, time);
        tone.frequency.exponentialRampToValueAtTime(900, time + 0.25);
        this.oscillator('sawtooth', frequency, time, amp.end, tone, spread - 5);
        this.oscillator('square', frequency, time, amp.end, this.level(0.5, tone), spread + 5);
        this.oscillator('sine', frequency * 2, time, amp.end, this.level(0.4, tone));
      } else {
        // Dub techno chord: short, resonant, and meant to be thrown into the delay.
        const amp = this.envelope(v.dest, time, 0.2 * gain, 0.002, Math.max(0.12, stepDuration * 1.4) * decay);
        const tone = this.biquad('lowpass', 1500, 3.5, amp.node);
        tone.frequency.setValueAtTime(2200, time);
        tone.frequency.exponentialRampToValueAtTime(600, time + 0.15);
        this.oscillator('sawtooth', frequency, time, amp.end, tone, spread - 6);
        this.oscillator('sawtooth', frequency, time, amp.end, tone, spread + 6);
      }
    }
  }

  private lead(v: Voice): void {
    const { time, decay, stepDuration } = v;
    const frequency = v.frequencies[0];
    if (v.kit === '808') {
      // A bell: inharmonic FM that rings out.
      const amp = this.envelope(v.dest, time, 0.22 * v.gain, 0.002, 0.7 * decay);
      const carrier = this.oscillator('sine', frequency, time, amp.end, amp.node);
      const modulator = this.context.createOscillator();
      const index = this.context.createGain();
      modulator.frequency.value = frequency * 3.5;
      index.gain.setValueAtTime(frequency * 2.4, time);
      index.gain.exponentialRampToValueAtTime(frequency * 0.1, time + 0.4);
      modulator.connect(index);
      index.connect(carrier.frequency);
      modulator.start(time);
      modulator.stop(amp.end);
    } else if (v.kit === 'acoustic') {
      // A breathy flute.
      const amp = this.sustain(v.dest, time, 0.2 * v.gain, 0.03, Math.max(0.16, stepDuration * 1.6) * decay, 0.12);
      const tone = this.biquad('lowpass', 2800, 0.6, amp.node);
      const main = this.oscillator('triangle', frequency, time, amp.end, tone);
      this.oscillator('sine', frequency * 2, time, amp.end, this.level(0.25, tone));
      this.lfo(5.2, 9, main.detune, time + 0.08, amp.end);
      const breath = this.envelope(tone, time, 0.035 * v.gain, 0.02, 0.12);
      this.noiseSource(time, breath.end, this.biquad('bandpass', frequency * 2, 2, breath.node));
    } else if (v.kit === 'lofi') {
      const amp = this.sustain(v.dest, time, 0.2 * v.gain, 0.012, Math.max(0.14, stepDuration * 1.4) * decay, 0.16);
      const tone = this.biquad('lowpass', 2200, 0.7, amp.node);
      const main = this.oscillator('triangle', frequency, time, amp.end, tone);
      this.oscillator('square', frequency, time, amp.end, this.level(0.18, tone), 5);
      this.lfo(5.6, 10, main.detune, time, amp.end);
    } else if (v.kit === 'house') {
      // A pluck.
      const amp = this.envelope(v.dest, time, 0.2 * v.gain, 0.002, Math.max(0.16, stepDuration * 1.6) * decay);
      const tone = this.biquad('lowpass', 4200, 1.4, amp.node);
      tone.frequency.setValueAtTime(5200, time);
      tone.frequency.exponentialRampToValueAtTime(800, time + 0.14);
      this.oscillator('sawtooth', frequency, time, amp.end, tone, -9);
      this.oscillator('sawtooth', frequency, time, amp.end, tone, 9);
    } else if (v.kit === 'techno') {
      // Acid: one saw an octave down into a squelchy resonant filter. Accents open it up.
      const previous = this.held.lead;
      this.cut(previous, time);
      const choke = this.choke(this.drive(2.2, v.dest));
      const amp = this.envelope(choke, time, 0.26 * v.gain, 0.002, Math.max(0.12, stepDuration * 1.1) * decay);
      const tone = this.biquad('lowpass', 400, v.accent ? 16 : 11, amp.node);
      tone.frequency.setValueAtTime(v.accent ? 3200 : 1800, time);
      tone.frequency.exponentialRampToValueAtTime(260, time + (v.accent ? 0.18 : 0.12));
      this.oscillator('sawtooth', frequency / 2, time, amp.end, tone);
      this.held.lead = { choke, end: amp.end, frequency };
    } else {
      // A soft sine lead that sits in the delay.
      const amp = this.sustain(v.dest, time, 0.2 * v.gain, 0.02, Math.max(0.2, stepDuration * 2) * decay, 0.25);
      const main = this.oscillator('sine', frequency, time, amp.end, amp.node);
      this.oscillator('triangle', frequency * 2, time, amp.end, this.level(0.12, amp.node));
      this.lfo(5, 8, main.detune, time + 0.1, amp.end);
    }
  }
}
