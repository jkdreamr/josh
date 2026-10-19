// The engine's raw sound, built the way a real one makes it: a train of exhaust pressure pulses, one per cylinder
// firing, each a little different from the last (no two combustions are alike, and each cylinder has its own
// character). That unevenness is what turns a buzz into an engine: it spreads energy into the half orders below the
// firing note, giving the growl and the hoarse edge of a real exhaust. The train is rendered once at a reference rpm
// as a seamless loop and played faster or slower to follow the revs; the pipe resonances it then rings through stay
// fixed (audio.ts), so the tone changes as the revs sweep past them, as it does on a real car. Pure module.

/** Cylinders, and firings per engine cycle (two crank turns) for a four stroke. */
export const CYLINDERS = 6;
/** The rpm the loop is rendered at; played at rpm / REF_RPM. */
export const REF_RPM = 9000;

/**
 * Channels of the loop: the tone and the breath (pulse-synchronous noise) on the throttle, then the same two lifted
 * off it (softer, rounder, less even pulses: the burble of the overrun). All four share pulse timing, so they blend
 * without any phasing.
 */
export const ON_TONE = 0;
export const ON_AIR = 1;
export const OFF_TONE = 2;
export const OFF_AIR = 3;

/** A small, seeded random generator, so every session sounds the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One exhaust pulse at x firing intervals after its spark: a quick rise, a decay, then a small suck back. */
function pulse(x: number, rise: number, decay: number) {
  if (x < 0 || x > 2.2) return 0;
  const up = x < rise ? 0.5 - 0.5 * Math.cos((Math.PI * x) / rise) : Math.exp(-(x - rise) / decay);
  const back = 0.12 * Math.exp(-(((x - 0.55) / 0.16) ** 2));
  return up - back;
}

export type EngineLoop = { rate: number; length: number; channels: Float32Array[]; refRpm: number };

/**
 * Renders the loop at `sampleRate`: a whole number of engine cycles (so it loops without a seam) lasting about
 * `seconds`. `refRpm` is adjusted a hair so a cycle is a whole number of samples.
 */
export function renderEngineLoop(sampleRate: number, seconds = 3, seed = 7): EngineLoop {
  const cycle = Math.round((sampleRate * 120) / REF_RPM);
  const refRpm = (sampleRate * 120) / cycle;
  const cycles = Math.max(8, Math.round((seconds * sampleRate) / cycle));
  const length = cycle * cycles;
  const step = cycle / CYLINDERS;
  const rand = rng(seed);
  const gauss = () => (rand() + rand() + rand() - 1.5) * 1.15;
  // each cylinder's own character: a little stronger or weaker, firing a touch early or late
  const bias = Array.from({ length: CYLINDERS }, () => (rand() - 0.5) * 0.4);
  const lean = Array.from({ length: CYLINDERS }, () => (rand() - 0.5) * 0.08);
  const channels = Array.from({ length: 4 }, () => new Float32Array(length));
  const firings = cycles * CYLINDERS;
  // the noise for the breath, one sample per output sample, smoothed so it is breathy rather than hissy
  const noise = new Float32Array(length);
  let lp = 0;
  for (let i = 0; i < length; i++) {
    lp += (gauss() - lp) * 0.45;
    noise[i] = lp;
  }
  for (let k = 0; k < firings; k++) {
    const c = k % CYLINDERS;
    const at = (k + lean[c] + gauss() * 0.004) * step;
    const on = 1 + bias[c] + gauss() * 0.07;
    // off the throttle each firing is much weaker and far less even, and now and then one barely fires
    const off = rand() < 0.07 ? 0.15 : 0.45 * (1 + bias[c] * 1.6 + gauss() * 0.22);
    const from = Math.floor(at);
    const to = Math.ceil(at + 2.2 * step);
    for (let i = from; i <= to; i++) {
      const j = ((i % length) + length) % length;
      const x = (i - at) / step;
      const tone = pulse(x, 0.07, 0.16);
      const soft = pulse(x, 0.16, 0.24);
      const env = x >= 0 && x < 1.2 ? Math.exp(-x / 0.3) : 0;
      channels[ON_TONE][j] += on * tone;
      channels[OFF_TONE][j] += off * soft;
      channels[ON_AIR][j] += on * env * noise[j];
      channels[OFF_AIR][j] += off * env * noise[j];
    }
  }
  for (const ch of channels) {
    // take out the average (the pulses push one way) and a little of the harshest top, around the loop so it
    // stays seamless, then scale to a peak of one
    let mean = 0;
    for (let i = 0; i < length; i++) mean += ch[i];
    mean /= length;
    let y = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < length; i++) {
        y += (ch[i] - mean - y) * 0.6;
        if (pass === 1) ch[i] = y;
      }
    }
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    if (peak > 0) for (let i = 0; i < length; i++) ch[i] /= peak;
  }
  return { rate: sampleRate, length, channels, refRpm };
}
