import type { ShotType } from '../games/badminton';

/** Small synthesized sound kit for the badminton game. Everything is created on demand and closed on dispose. */
export class BadmintonAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.context) {
      try {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.context.destination);
        const length = Math.floor(this.context.sampleRate * 0.5);
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
      } catch {
        this.context = null;
        return null;
      }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    return this.context;
  }

  /** Call from a user gesture so browsers allow playback. */
  unlock() {
    this.ensure();
  }

  private burst(frequency: number, q: number, duration: number, gainValue: number, sweepTo?: number) {
    const context = this.ensure();
    if (!context || !this.master || !this.noise) return;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, context.currentTime);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, context.currentTime + duration);
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    source.stop(context.currentTime + duration + 0.02);
  }

  private tone(frequency: number, duration: number, gainValue: number, type: OscillatorType = 'sine', delay = 0, slideTo?: number) {
    const context = this.ensure();
    if (!context || !this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  hit(type: ShotType, speed: number) {
    switch (type) {
      case 'smash':
        this.burst(520, 0.7, 0.16, 0.9, 180);
        this.tone(170, 0.09, 0.5, 'triangle', 0, 70);
        this.burst(2400, 0.4, 0.22, 0.25, 600);
        break;
      case 'drive':
        this.burst(1400, 1.1, 0.07, 0.6);
        this.tone(420, 0.05, 0.25, 'triangle');
        break;
      case 'clear':
      case 'lift':
      case 'high-serve':
        this.burst(1100, 1.4, 0.09, 0.5);
        this.tone(640, 0.06, 0.22);
        break;
      case 'drop':
      case 'net':
      case 'serve':
      default:
        this.burst(2600, 2.2, 0.05, 0.28);
        this.tone(900, 0.04, 0.12);
        break;
    }
    if (speed > 30) this.burst(300, 0.5, 0.12, Math.min(0.5, (speed - 30) / 50));
  }

  land() {
    this.burst(240, 0.9, 0.08, 0.3);
  }

  netCord() {
    this.burst(900, 3, 0.12, 0.3);
    this.tone(260, 0.1, 0.12, 'triangle');
  }

  point(forHuman: boolean) {
    if (forHuman) {
      this.tone(660, 0.12, 0.16);
      this.tone(880, 0.16, 0.16, 'sine', 0.08);
    } else {
      this.tone(330, 0.16, 0.14, 'triangle');
    }
  }

  gameOver(forHuman: boolean) {
    const notes = forHuman ? [523, 659, 784, 1047] : [392, 349, 311];
    notes.forEach((frequency, index) => this.tone(frequency, 0.22, 0.16, 'sine', index * 0.11));
  }

  serveReady() {
    this.tone(990, 0.05, 0.08);
  }

  dispose() {
    this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.noise = null;
  }
}
