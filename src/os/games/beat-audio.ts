import {
  advancePosition,
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

type Voice = { kit: KitId; time: number; gain: number; pitch: number; decay: number; stepDuration: number; frequency: number; dest: AudioNode };

function makeNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function makeImpulse(context: AudioContext, seconds: number): AudioBuffer {
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

function makeSaturationCurve(drive: number) {
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

export class BeatEngine {
  readonly context: AudioContext;
  private readonly hooks: EngineHooks;
  private readonly noise: AudioBuffer;
  private readonly bus: GainNode;
  private readonly lofiBus: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly saturate: WaveShaperNode;
  private readonly hardSaturate: WaveShaperNode;
  private timer: number | null = null;
  private position: Position = { pattern: 0, step: 0, songIndex: 0 };
  private nextTime = 0;
  private scheduled: Scheduled[] = [];
  private lastBpm = 0;
  private unlocked = false;
  playing = false;
  recording = false;

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    this.noise = makeNoise(context);

    this.bus = context.createGain();
    this.bus.gain.value = 0.9;
    this.filter = context.createBiquadFilter();
    this.filter.Q.value = 0.8;
    this.bus.connect(this.filter);

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
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

    this.reverbSend = context.createGain();
    this.reverbSend.gain.value = 0;
    const reverb = context.createConvolver();
    reverb.buffer = makeImpulse(context, 1.9);
    const reverbTone = context.createBiquadFilter();
    reverbTone.type = 'lowpass';
    reverbTone.frequency.value = 5200;
    this.filter.connect(this.reverbSend);
    this.reverbSend.connect(reverb);
    reverb.connect(reverbTone);
    reverbTone.connect(compressor);

    this.delaySend = context.createGain();
    this.delaySend.gain.value = 0;
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.feedback.gain.value = 0.3;
    const delayTone = context.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 3000;
    this.filter.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(delayTone);
    delayTone.connect(this.feedback);
    this.feedback.connect(this.delay);
    delayTone.connect(compressor);

    this.lofiBus = context.createGain();
    const crush = context.createWaveShaper();
    crush.curve = makeCrushCurve(24, 1.4);
    const dust = context.createBiquadFilter();
    dust.type = 'lowpass';
    dust.frequency.value = 5200;
    dust.Q.value = 0.6;
    this.lofiBus.connect(crush);
    crush.connect(dust);
    dust.connect(this.bus);

    this.saturate = context.createWaveShaper();
    this.saturate.curve = makeSaturationCurve(1.8);
    this.saturate.connect(this.bus);
    this.hardSaturate = context.createWaveShaper();
    this.hardSaturate.curve = makeSaturationCurve(3.2);
    this.hardSaturate.connect(this.bus);

    this.applyState(hooks.getState(), true);
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
    const filter = filterSettings(state.fx.filter);
    this.filter.type = filter.type;
    this.filter.frequency.setTargetAtTime(filter.frequency, now, ramp);
    this.reverbSend.gain.setTargetAtTime((state.fx.reverb / 100) ** 1.4 * 0.85, now, ramp);
    this.delaySend.gain.setTargetAtTime((state.fx.delay / 100) ** 1.2 * 0.7, now, ramp);
    this.feedback.gain.setTargetAtTime(0.25 + (state.fx.delay / 100) * 0.3, now, ramp);
    if (state.bpm !== this.lastBpm) {
      this.lastBpm = state.bpm;
      if (immediate) this.delay.delayTime.value = delayTime(state.bpm);
      else this.delay.delayTime.setTargetAtTime(delayTime(state.bpm), now, 0.08);
    }
  }

  start(): void {
    if (this.playing) return;
    this.unlock();
    const state = this.hooks.getState();
    this.position = startPosition(state);
    this.nextTime = this.context.currentTime + 0.06;
    this.scheduled = [];
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.scheduled = [];
  }

  dispose(): void {
    this.stop();
    void this.context.close().catch(() => undefined);
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
      const pattern = state.patterns[patternIndex];
      const time = this.nextTime + swingOffset(step, state.bpm, state.swing);
      if (pattern) {
        for (const track of TRACKS) {
          const velocity = pattern.steps[track][step];
          if (!velocity) continue;
          if (solo ? track !== solo : state.tracks[track].muted) continue;
          const degree = (SYNTH_TRACKS as readonly string[]).includes(track) ? pattern.notes[track as SynthTrack][step] : undefined;
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
    const isSynth = (SYNTH_TRACKS as readonly string[]).includes(track);
    const frequency = isSynth ? pitchForDegree(track as SynthTrack, state.root, state.scale, degree ?? 0).frequency * pitchRatio(settings.pitch) : 0;
    const voice: Voice = {
      kit: state.kit,
      time,
      gain,
      pitch: pitchRatio(settings.pitch),
      decay: decayMultiplier(settings.decay),
      stepDuration: sixteenthDuration(state.bpm),
      frequency,
      dest: state.kit === 'lofi' ? this.lofiBus : this.bus,
    };
    switch (track) {
      case 'kick': return this.kick(voice);
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

  /* ------------------------------------ drums ------------------------------------ */

  private kick(v: Voice): void {
    const { time, pitch, decay } = v;
    if (v.kit === '808') {
      const { node, end } = this.envelope(this.saturate, time, 0.95 * v.gain, 0.003, 0.5 * decay);
      const osc = this.oscillator('sine', 175 * pitch, time, end, node);
      osc.frequency.exponentialRampToValueAtTime(46 * pitch, time + 0.085);
      const click = this.envelope(v.dest, time, 0.22 * v.gain, 0.001, 0.012);
      this.noiseSource(time, click.end, this.biquad('highpass', 2200, 0.7, click.node));
    } else if (v.kit === 'acoustic') {
      const body = this.envelope(v.dest, time, 0.9 * v.gain, 0.002, 0.3 * decay);
      const osc = this.oscillator('sine', 125 * pitch, time, body.end, body.node);
      osc.frequency.exponentialRampToValueAtTime(54 * pitch, time + 0.05);
      const shell = this.envelope(v.dest, time, 0.28 * v.gain, 0.003, 0.14 * decay);
      this.oscillator('triangle', 86 * pitch, time, shell.end, shell.node);
      const beater = this.envelope(v.dest, time, 0.32 * v.gain, 0.001, 0.02);
      this.noiseSource(time, beater.end, this.biquad('lowpass', 2600, 0.6, beater.node));
    } else if (v.kit === 'lofi') {
      const body = this.envelope(v.dest, time, 1 * v.gain, 0.004, 0.3 * decay);
      const osc = this.oscillator('sine', 150 * pitch, time, body.end, body.node);
      osc.frequency.exponentialRampToValueAtTime(50 * pitch, time + 0.07);
      const thud = this.envelope(v.dest, time, 0.14 * v.gain, 0.001, 0.025);
      this.noiseSource(time, thud.end, this.biquad('lowpass', 900, 0.8, thud.node));
    } else {
      const body = this.envelope(this.hardSaturate, time, 1 * v.gain, 0.0015, 0.3 * decay);
      const osc = this.oscillator('sine', 220 * pitch, time, body.end, body.node);
      osc.frequency.exponentialRampToValueAtTime(52 * pitch, time + 0.045);
      const click = this.envelope(v.dest, time, 0.36 * v.gain, 0.0005, 0.008);
      this.noiseSource(time, click.end, this.biquad('bandpass', 4200, 1.2, click.node));
    }
  }

  private snare(v: Voice): void {
    const { time, pitch, decay } = v;
    if (v.kit === '808') {
      const tone = this.envelope(v.dest, time, 0.3 * v.gain, 0.002, 0.12 * decay);
      this.oscillator('triangle', 185 * pitch, time, tone.end, tone.node);
      this.oscillator('triangle', 330 * pitch, time, tone.end, tone.node);
      const hiss = this.envelope(v.dest, time, 0.5 * v.gain, 0.002, 0.2 * decay);
      this.noiseSource(time, hiss.end, this.biquad('highpass', 500 * pitch, 0.7, this.biquad('bandpass', 1700 * pitch, 0.8, hiss.node)), pitch);
    } else if (v.kit === 'acoustic') {
      const tone = this.envelope(v.dest, time, 0.34 * v.gain, 0.002, 0.1 * decay);
      for (const frequency of [190, 285]) {
        const osc = this.oscillator('triangle', frequency * pitch, time, tone.end, tone.node);
        osc.frequency.exponentialRampToValueAtTime(frequency * pitch * 0.85, time + 0.03);
      }
      const wires = this.envelope(v.dest, time, 0.55 * v.gain, 0.002, 0.22 * decay);
      this.noiseSource(time, wires.end, this.biquad('highpass', 1400 * pitch, 0.6, wires.node), pitch);
      const snap = this.envelope(v.dest, time, 0.38 * v.gain, 0.001, 0.03);
      this.noiseSource(time, snap.end, this.biquad('bandpass', 3000 * pitch, 1.1, snap.node), pitch);
    } else if (v.kit === 'lofi') {
      const tone = this.envelope(v.dest, time, 0.32 * v.gain, 0.003, 0.1 * decay);
      const osc = this.oscillator('triangle', 172 * pitch, time, tone.end, tone.node);
      osc.frequency.exponentialRampToValueAtTime(120 * pitch, time + 0.06);
      const hiss = this.envelope(v.dest, time, 0.5 * v.gain, 0.003, 0.16 * decay);
      this.noiseSource(time, hiss.end, this.biquad('bandpass', 1100 * pitch, 0.7, hiss.node), pitch * 0.8);
    } else {
      const tone = this.envelope(v.dest, time, 0.36 * v.gain, 0.001, 0.11 * decay);
      for (const frequency of [240, 180]) {
        const osc = this.oscillator('triangle', frequency * pitch, time, tone.end, tone.node);
        osc.frequency.exponentialRampToValueAtTime(frequency * pitch * 0.8, time + 0.04);
      }
      const hiss = this.envelope(v.dest, time, 0.6 * v.gain, 0.001, 0.22 * decay);
      this.noiseSource(time, hiss.end, this.biquad('highpass', 1800 * pitch, 0.7, hiss.node), pitch);
    }
  }

  private hat(v: Voice, open: boolean): void {
    const { time, pitch, decay } = v;
    const length = (open ? 0.34 : 0.055) * decay;
    if (v.kit === '808') {
      const { node, end } = this.envelope(v.dest, time, (open ? 0.26 : 0.3) * v.gain, 0.001, length);
      const shape = this.biquad('highpass', 7000, 0.7, this.biquad('bandpass', 10000, 1, node));
      for (const frequency of [205.3, 304.4, 369.6, 522.7, 540, 800]) this.oscillator('square', frequency * pitch * 1.25, time, end, shape);
    } else if (v.kit === 'acoustic') {
      const { node, end } = this.envelope(v.dest, time, (open ? 0.3 : 0.32) * v.gain, 0.001, length);
      this.noiseSource(time, end, this.biquad('bandpass', 10500 * pitch, 0.6, this.biquad('highpass', 8500 * pitch, 0.7, node)), pitch);
      const stick = this.envelope(v.dest, time, 0.1 * v.gain, 0.0005, 0.018);
      this.oscillator('square', 6700 * pitch, time, stick.end, stick.node);
      if (open) {
        const shimmer = this.envelope(v.dest, time, 0.07 * v.gain, 0.002, 0.3 * decay);
        this.oscillator('square', 5100 * pitch, time, shimmer.end, shimmer.node);
        this.oscillator('square', 7350 * pitch, time, shimmer.end, shimmer.node);
      }
    } else if (v.kit === 'lofi') {
      const { node, end } = this.envelope(v.dest, time, (open ? 0.26 : 0.3) * v.gain, 0.002, (open ? 0.28 : 0.045) * decay);
      this.noiseSource(time, end, this.biquad('highpass', 6000 * pitch, 0.7, node), pitch);
    } else {
      const { node, end } = this.envelope(v.dest, time, (open ? 0.26 : 0.3) * v.gain, 0.0008, length);
      this.noiseSource(time, end, this.biquad('highpass', 9000 * pitch, 0.8, node), pitch);
      const ring = this.envelope(v.dest, time, 0.08 * v.gain, 0.0005, 0.03);
      this.oscillator('square', 8000 * pitch, time, ring.end, ring.node);
      this.oscillator('square', 11000 * pitch, time, ring.end, ring.node);
    }
  }

  private clap(v: Voice): void {
    const { time, pitch, decay } = v;
    const [bursts, spacing, tail, frequency, q, level] = v.kit === '808' ? [3, 0.012, 0.18, 1300, 1.2, 0.62]
      : v.kit === 'acoustic' ? [4, 0.011, 0.25, 1500, 0.8, 0.56]
        : v.kit === 'lofi' ? [3, 0.014, 0.15, 1000, 0.9, 0.52]
          : [4, 0.01, 0.2, 1700, 1, 0.66];
    const node = this.context.createGain();
    node.gain.setValueAtTime(0, time);
    for (let index = 0; index < bursts; index += 1) {
      const at = time + index * spacing;
      node.gain.linearRampToValueAtTime(level * v.gain, at + 0.0015);
      node.gain.exponentialRampToValueAtTime(level * v.gain * 0.25, at + spacing - 0.001);
    }
    const last = time + (bursts - 1) * spacing + 0.002;
    node.gain.linearRampToValueAtTime(level * v.gain, last);
    node.gain.exponentialRampToValueAtTime(TAIL, last + tail * decay);
    node.gain.setValueAtTime(0, last + tail * decay + 0.002);
    node.connect(v.dest);
    this.noiseSource(time, last + tail * decay + 0.01, this.biquad('bandpass', frequency * pitch, q, node), pitch);
  }

  /* ------------------------------------ synths ------------------------------------ */

  private bass(v: Voice): void {
    const { time, frequency, decay, stepDuration } = v;
    if (v.kit === '808') {
      const { node, end } = this.envelope(this.saturate, time, 0.55 * v.gain, 0.004, Math.max(0.3, stepDuration * 1.6) * decay);
      const tone = this.biquad('lowpass', 420, 0.7, node);
      const osc = this.oscillator('sine', frequency * 1.5, time, end, tone);
      osc.frequency.exponentialRampToValueAtTime(frequency, time + 0.03);
      this.oscillator('triangle', frequency, time, end, tone).detune.value = 4;
    } else if (v.kit === 'acoustic') {
      const { node, end } = this.envelope(v.dest, time, 0.42 * v.gain, 0.003, Math.max(0.18, stepDuration * 1.2) * decay);
      const tone = this.biquad('lowpass', 720, 0.9, node);
      this.oscillator('triangle', frequency, time, end, tone);
      const saw = this.context.createGain();
      saw.gain.value = 0.3;
      saw.connect(tone);
      this.oscillator('sawtooth', frequency, time, end, saw);
      const pluck = this.envelope(v.dest, time, 0.1 * v.gain, 0.001, 0.012);
      this.noiseSource(time, pluck.end, this.biquad('bandpass', 2000, 1, pluck.node));
    } else if (v.kit === 'lofi') {
      const { node, end } = this.envelope(v.dest, time, 0.4 * v.gain, 0.005, Math.max(0.1, stepDuration * 0.9) * decay);
      const tone = this.biquad('lowpass', 320, 0.8, node);
      tone.frequency.setValueAtTime(320, time);
      tone.frequency.exponentialRampToValueAtTime(120, time + 0.12);
      this.oscillator('sawtooth', frequency, time, end, tone);
    } else {
      const { node, end } = this.envelope(v.dest, time, 0.34 * v.gain, 0.002, Math.max(0.12, stepDuration * 0.8) * decay);
      const tone = this.biquad('lowpass', 900, 1.1, node);
      tone.frequency.setValueAtTime(900, time);
      tone.frequency.exponentialRampToValueAtTime(260, time + 0.12);
      this.oscillator('sawtooth', frequency, time, end, tone);
      this.oscillator('square', frequency, time, end, tone, -12);
    }
  }

  private keys(v: Voice): void {
    const { time, frequency, decay, stepDuration } = v;
    if (v.kit === '808') {
      const { node, end } = this.envelope(v.dest, time, 0.3 * v.gain, 0.002, 0.6 * decay);
      const carrier = this.oscillator('sine', frequency, time, end, node);
      const modulator = this.context.createOscillator();
      const index = this.context.createGain();
      modulator.frequency.value = frequency;
      index.gain.setValueAtTime(frequency * 1.6, time);
      index.gain.exponentialRampToValueAtTime(frequency * 0.08, time + 0.3);
      modulator.connect(index);
      index.connect(carrier.frequency);
      modulator.start(time);
      modulator.stop(end);
      const tine = this.envelope(v.dest, time, 0.06 * v.gain, 0.001, 0.08);
      this.oscillator('sine', frequency * 4, time, tine.end, tine.node);
    } else if (v.kit === 'acoustic') {
      const tone = this.biquad('lowpass', 4200, 0.5, v.dest);
      const partials: Array<[number, number, number]> = [[1, 0.3, 0.75], [2, 0.12, 0.42], [3, 0.06, 0.25]];
      for (const [ratio, level, length] of partials) {
        const { node, end } = this.envelope(tone, time, level * v.gain, 0.002, length * decay);
        this.oscillator('sine', frequency * ratio, time, end, node, ratio === 1 ? 0 : 3);
      }
      const hammer = this.envelope(tone, time, 0.08 * v.gain, 0.001, 0.01);
      this.noiseSource(time, hammer.end, this.biquad('bandpass', 2600, 1.4, hammer.node));
    } else if (v.kit === 'lofi') {
      const { node, end } = this.envelope(v.dest, time, 0.3 * v.gain, 0.006, Math.max(0.3, stepDuration * 2) * decay);
      const tone = this.biquad('lowpass', 1900, 0.7, node);
      const carrier = this.oscillator('triangle', frequency, time, end, tone);
      const modulator = this.context.createOscillator();
      const index = this.context.createGain();
      modulator.frequency.value = frequency * 2;
      index.gain.value = frequency * 0.12;
      modulator.connect(index);
      index.connect(carrier.frequency);
      modulator.start(time);
      modulator.stop(end);
      const vibrato = this.context.createOscillator();
      const depth = this.context.createGain();
      vibrato.frequency.value = 5.2;
      depth.gain.value = 7;
      vibrato.connect(depth);
      depth.connect(carrier.detune);
      vibrato.start(time);
      vibrato.stop(end);
    } else {
      const { node, end } = this.envelope(v.dest, time, 0.26 * v.gain, 0.003, Math.max(0.12, stepDuration * 0.9) * decay);
      const tone = this.biquad('lowpass', 2400, 1, node);
      tone.frequency.setValueAtTime(2400, time);
      tone.frequency.exponentialRampToValueAtTime(700, time + Math.max(0.1, stepDuration));
      this.oscillator('sawtooth', frequency, time, end, tone, -8);
      this.oscillator('sawtooth', frequency, time, end, tone, 8);
      const sub = this.context.createGain();
      sub.gain.value = 0.35;
      sub.connect(tone);
      this.oscillator('square', frequency / 2, time, end, sub);
    }
  }

  private lead(v: Voice): void {
    const { time, frequency, decay, stepDuration } = v;
    if (v.kit === '808') {
      const { node, end } = this.envelope(v.dest, time, 0.2 * v.gain, 0.004, Math.max(0.1, stepDuration * 0.9) * decay);
      const tone = this.biquad('lowpass', 3100, 0.8, node);
      this.oscillator('square', frequency, time, end, tone, -7);
      this.oscillator('square', frequency, time, end, tone, 7);
      const sub = this.context.createGain();
      sub.gain.value = 0.5;
      sub.connect(tone);
      this.oscillator('sine', frequency / 2, time, end, sub);
    } else if (v.kit === 'acoustic') {
      const { node, end } = this.envelope(v.dest, time, 0.24 * v.gain, 0.006, Math.max(0.14, stepDuration * 1.1) * decay);
      const tone = this.biquad('lowpass', 2600, 0.6, node);
      this.oscillator('triangle', frequency, time, end, tone);
      const breath = this.context.createGain();
      breath.gain.value = 0.35;
      breath.connect(tone);
      this.oscillator('sine', frequency * 2, time, end, breath);
    } else if (v.kit === 'lofi') {
      const { node, end } = this.envelope(v.dest, time, 0.22 * v.gain, 0.008, Math.max(0.12, stepDuration) * decay);
      const tone = this.biquad('lowpass', 2400, 0.7, node);
      const main = this.oscillator('triangle', frequency, time, end, tone);
      const edge = this.context.createGain();
      edge.gain.value = 0.35;
      edge.connect(tone);
      this.oscillator('square', frequency, time, end, edge, 5);
      const vibrato = this.context.createOscillator();
      const depth = this.context.createGain();
      vibrato.frequency.value = 5.6;
      depth.gain.value = 9;
      vibrato.connect(depth);
      depth.connect(main.detune);
      vibrato.start(time);
      vibrato.stop(end);
    } else {
      const { node, end } = this.envelope(v.dest, time, 0.16 * v.gain, 0.003, Math.max(0.1, stepDuration * 0.9) * decay);
      const tone = this.biquad('lowpass', 3600, 0.7, node);
      for (const detune of [-12, 0, 12]) this.oscillator('sawtooth', frequency, time, end, tone, detune);
    }
  }
}
