// Race sound, synthesized live with WebAudio (no audio files). The engine is a 1.6 litre turbo V6: three firing
// pulses per crank turn, so its note follows the simulated rpm exactly, with a harmonic spectrum, rasp that grows
// with throttle, the turbo's whine, crackle on the overrun and the limiter's stutter. The nearest rivals get their
// own voices, panned and Doppler shifted as they pass. Tyre squeal follows how hard the tyres slide, and wind, road
// roar, kerbs and gravel follow speed and surface. Everything is heard from the first view's car.
import { SPEC, type Car } from './car.ts';
import type { Race } from './race.ts';
import type { CamMode } from './scene.ts';

export type RaceAudio = {
  /** Call every frame while racing. */
  update: (r: Race, listener: number, cam: CamMode, dt: number) => void;
  /** A hit (wall or car), strength in m/s. */
  impact: (speed: number) => void;
  /** Fades everything out (pause, game over); the next update brings it back. */
  silence: () => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

/**
 * Harmonic amplitudes of the engine note (the firing frequency is harmonic 1). They fall away steadily, like the
 * exhaust note of a real engine, rather than staying strong to the top (which sounds like a synth buzz).
 */
const ENGINE_HARMONICS = [0, 1, 0.55, 0.42, 0.3, 0.2, 0.16, 0.1, 0.08, 0.05, 0.04, 0.03, 0.02];
/** The firing frequency of a four stroke V6 is three pulses per crank revolution. */
export const firingHz = (rpm: number) => (rpm / 60) * 3;

type Voice = {
  /** The engine note, a slightly detuned second layer (the two banks' exhausts) and its half and one-and-a-half orders. */
  osc: OscillatorNode;
  osc2: OscillatorNode;
  half: OscillatorNode;
  half3: OscillatorNode;
  orders: GainNode;
  filter: BiquadFilterNode;
  presence: BiquadFilterNode;
  /** Cycle-to-cycle unevenness at crank speed: the growl of a real engine, without any noise. */
  rough: OscillatorNode;
  roughDepth: GainNode;
  amp: GainNode;
  /** Rev limiter: a square wave cutting the sound in time with the ignition cut, sample accurate. */
  cutLfo: OscillatorNode;
  cutDepth: GainNode;
  cut: GainNode;
  rasp: AudioBufferSourceNode;
  raspFilter: BiquadFilterNode;
  raspGain: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  whine: OscillatorNode;
  whineGain: GainNode;
  /** Smoothed firing frequency and load, so frame-to-frame jitter in the simulation never reaches the ear. */
  f: number;
  load: number;
  /** Which runner this voice follows (-1 for none). */
  target: number;
  lastDist: number;
};

const OTHER_VOICES = 3;

/** Builds the sound for a session. Pass `context` (an OfflineAudioContext) to render it instead of playing it. */
export function createRaceAudio(opts: { context?: BaseAudioContext } = {}): RaceAudio | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC && !opts.context) return null;
  let ctx: BaseAudioContext;
  try {
    ctx = opts.context ?? new AC();
  } catch {
    return null;
  }
  const live = ctx instanceof AudioContext ? ctx : null;
  const master = ctx.createGain();
  master.gain.value = 0;
  // a gentle compressor glues the layers together and keeps crashes from clipping
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  let muted = false;

  // shared noise: two seconds of white noise looped by every noisy layer
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const loop = () => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 1.9);
    return src;
  };

  const wave = ctx.createPeriodicWave(new Float32Array(ENGINE_HARMONICS.length), Float32Array.from(ENGINE_HARMONICS));

  const makeVoice = (out: AudioNode): Voice => {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    const osc2 = ctx.createOscillator();
    osc2.setPeriodicWave(wave);
    osc2.detune.value = 7;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.55;
    // the half and one-and-a-half orders (uneven firing between the banks) give the note its depth
    const half = ctx.createOscillator();
    half.type = 'sine';
    const half3 = ctx.createOscillator();
    half3.type = 'sine';
    const orders = ctx.createGain();
    orders.gain.value = 0.2;
    const half3Gain = ctx.createGain();
    half3Gain.gain.value = 0.35;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2800;
    presence.Q.value = 0.8;
    const amp = ctx.createGain();
    amp.gain.value = 1;
    const rough = ctx.createOscillator();
    rough.type = 'sine';
    const roughDepth = ctx.createGain();
    roughDepth.gain.value = 0.1;
    rough.connect(roughDepth).connect(amp.gain);
    const cut = ctx.createGain();
    cut.gain.value = 1;
    const cutLfo = ctx.createOscillator();
    cutLfo.type = 'square';
    cutLfo.frequency.value = 17;
    const cutDepth = ctx.createGain();
    cutDepth.gain.value = 0;
    cutLfo.connect(cutDepth).connect(cut.gain);
    // a whisper of intake and exhaust air, low passed so it never hisses
    const rasp = loop();
    const raspFilter = ctx.createBiquadFilter();
    raspFilter.type = 'lowpass';
    raspFilter.Q.value = 0.5;
    const raspGain = ctx.createGain();
    raspGain.gain.value = 0;
    // turbo whine
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    osc.connect(filter);
    osc2.connect(osc2Gain).connect(filter);
    half.connect(orders).connect(filter);
    half3.connect(half3Gain).connect(orders);
    filter.connect(presence).connect(amp);
    rasp.connect(raspFilter).connect(raspGain).connect(amp);
    amp.connect(cut).connect(gain);
    whine.connect(whineGain).connect(gain);
    gain.connect(pan).connect(out);
    for (const o of [osc, osc2, half, half3, rough, cutLfo, whine]) o.start();
    return { osc, osc2, half, half3, orders, filter, presence, rough, roughDepth, amp, cutLfo, cutDepth, cut, rasp, raspFilter, raspGain, gain, pan, whine, whineGain, f: 0, load: 0, target: -1, lastDist: 0 };
  };

  const engineBus = ctx.createGain();
  engineBus.connect(master);
  const me = makeVoice(engineBus);
  const others: Voice[] = Array.from({ length: OTHER_VOICES }, () => makeVoice(engineBus));

  // tyre squeal: resonant noise in the 1 kHz region
  const squealSrc = loop();
  const squealFilter = ctx.createBiquadFilter();
  squealFilter.type = 'bandpass';
  squealFilter.Q.value = 9;
  squealFilter.frequency.value = 1100;
  const squealFilter2 = ctx.createBiquadFilter();
  squealFilter2.type = 'bandpass';
  squealFilter2.Q.value = 12;
  squealFilter2.frequency.value = 1750;
  const squealGain = ctx.createGain();
  squealGain.gain.value = 0;
  squealSrc.connect(squealFilter).connect(squealGain);
  squealSrc.connect(squealFilter2).connect(squealGain);
  squealGain.connect(master);

  // wind over the car, rising with the square of speed
  const windSrc = loop();
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.Q.value = 0.5;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windFilter).connect(windGain).connect(master);

  // road roar from the tyres on asphalt
  const roadSrc = loop();
  const roadFilter = ctx.createBiquadFilter();
  roadFilter.type = 'lowpass';
  roadFilter.frequency.value = 220;
  const roadGain = ctx.createGain();
  roadGain.gain.value = 0;
  roadSrc.connect(roadFilter).connect(roadGain).connect(master);

  // kerbs: a buzzing rattle at the rate the ridges pass under the tyres
  const kerbOsc = ctx.createOscillator();
  kerbOsc.type = 'sawtooth';
  const kerbFilter = ctx.createBiquadFilter();
  kerbFilter.type = 'lowpass';
  kerbFilter.frequency.value = 260;
  const kerbGain = ctx.createGain();
  kerbGain.gain.value = 0;
  kerbOsc.connect(kerbFilter).connect(kerbGain).connect(master);
  kerbOsc.start();

  // gravel and grass: gritty noise
  const dirtSrc = loop();
  const dirtFilter = ctx.createBiquadFilter();
  dirtFilter.type = 'bandpass';
  dirtFilter.Q.value = 0.8;
  dirtFilter.frequency.value = 1800;
  const dirtGain = ctx.createGain();
  dirtGain.gain.value = 0;
  dirtSrc.connect(dirtFilter).connect(dirtGain).connect(master);

  const smooth = (p: AudioParam, v: number, tc = 0.03) => p.setTargetAtTime(v, ctx.currentTime, tc);
  /**
   * Moves a parameter to a new value along a straight ramp a little longer than a frame, starting from where it is
   * now. Values arrive once a frame; ramping (instead of stepping) keeps the frame rate itself out of the sound.
   */
  const glide = (p: AudioParam, v: number, time = 0.06) => {
    const t = ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + time);
  };

  /** A short burst: overrun pops, gear shift kicks, impacts. */
  const burst = (opts: { dur: number; vol: number; freq: number; q?: number; type?: BiquadFilterType; pan?: number; tone?: number }) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(f).connect(g).connect(p).connect(master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.dur + 0.05);
    if (opts.tone) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(opts.tone, t);
      o.frequency.exponentialRampToValueAtTime(opts.tone * 0.4, t + opts.dur);
      const og = ctx.createGain();
      og.gain.setValueAtTime(opts.vol * 1.4, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
      o.connect(og).connect(master);
      o.start(t);
      o.stop(t + opts.dur + 0.05);
    }
  };

  /** Drives one engine voice from a car: pitch from rpm, brightness and loudness from throttle. */
  const drive = (v: Voice, car: Car, gain: number, pitch: number, pan: number, inside: boolean, limiter: boolean, dt: number) => {
    const target = Math.max(30, firingHz(car.rpm) * pitch);
    const thr = car.throttle;
    const load = thr * (car.gear !== 0 && car.clutch > 0.5 ? 1 : 0.6);
    const k = v.f === 0 ? 1 : Math.min(1, dt / 0.035);
    v.f += (target - v.f) * k;
    v.load += (load - v.load) * Math.min(1, dt / 0.05);
    const f = v.f;
    const L = v.load;
    glide(v.osc.frequency, f);
    glide(v.osc2.frequency, f);
    glide(v.half.frequency, f * 0.5);
    glide(v.half3.frequency, f * 1.5);
    glide(v.rough.frequency, f / 3);
    glide(v.whine.frequency, 2600 + car.rpm * 0.42, 0.1);
    // open throttle: brighter, with a scream in the upper mids; closed: a darker, rounder burble
    glide(v.filter.frequency, Math.min(9000, 250 + f * (1.3 + 3.2 * L)));
    glide(v.presence.gain, 1 + 5 * L * Math.min(1, car.rpm / 11000), 0.1);
    glide(v.orders.gain, 0.14 + 0.16 * (1 - L), 0.1);
    glide(v.roughDepth.gain, 0.06 + 0.1 * (1 - L), 0.1);
    glide(v.raspFilter.frequency, Math.min(6000, f * 3), 0.1);
    glide(v.raspGain.gain, (0.015 + 0.05 * L) * (inside ? 0.7 : 1), 0.1);
    glide(v.whineGain.gain, Math.max(0, (car.rpm - 6500) / 6000) * 0.02 * (0.4 + L), 0.15);
    // the limiter cuts the sound to about half, seventeen times a second, while it holds the revs
    glide(v.cutDepth.gain, limiter ? 0.28 : 0, 0.03);
    glide(v.cut.gain, limiter ? 0.72 : 1, 0.03);
    const rpmLoud = 0.45 + 0.55 * Math.min(1, car.rpm / SPEC.limiter);
    glide(v.gain.gain, (0.35 + 0.65 * L) * rpmLoud * gain);
    glide(v.pan.pan, pan, 0.1);
  };

  let lastGear = 0;
  let popT = 0;
  let lastTick = performance.now();
  // the frame loop stops when the game is hidden or paused; this keeps the engines from droning on alone
  const watchdog = live
    ? window.setInterval(() => {
        if (performance.now() - lastTick > 250 && live.state === 'running') {
          smooth(master.gain, 0, 0.02);
          void live.suspend().catch(() => {});
        }
      }, 200)
    : 0;

  return {
    update(r, listener, cam, dt) {
      lastTick = performance.now();
      if (live && live.state === 'suspended') void live.resume().catch(() => {});
      smooth(master.gain, muted ? 0 : 0.55, 0.08);
      const rn = r.runners[listener];
      if (!rn) return;
      const car = rn.car;
      const inside = cam !== 'chase';
      const speed = Math.hypot(car.vx, car.vy);

      // your engine, and the limiter cutting the sparks at 12,500 rpm
      const limiter = car.rpm >= SPEC.limiter - 40 && car.throttle > 0.8;
      drive(me, car, inside ? 0.95 : 0.75, 1, 0, inside, limiter, dt);
      engineBus.gain.value = 1;

      // gear changes: a sharp kick through the drivetrain
      if (car.gear !== lastGear) {
        if (lastGear !== 0 && car.gear !== 0) burst({ dur: 0.09, vol: car.gear > lastGear ? 0.32 : 0.22, freq: 160, q: 0.7, type: 'lowpass', tone: 90 });
        lastGear = car.gear;
      }
      // overrun: crackles and pops when lifting at high revs
      popT -= dt;
      if (car.throttle < 0.08 && car.rpm > 7500 && car.vx > 15 && popT <= 0 && Math.random() < dt * 14) {
        popT = 0.04;
        burst({ dur: 0.05 + Math.random() * 0.05, vol: 0.12 + Math.random() * 0.18, freq: 500 + Math.random() * 900, q: 1.2, pan: (Math.random() - 0.5) * 0.3 });
      }

      // rivals: the three nearest cars get engine voices, panned around you and Doppler shifted
      const cos = Math.cos(car.yaw);
      const sin = Math.sin(car.yaw);
      const near = r.runners
        .filter((x) => x !== rn && !x.out)
        .map((x) => ({ x, d: Math.hypot(x.car.x - car.x, x.car.y - car.y) }))
        .filter((o) => o.d < 220)
        .sort((a, b) => a.d - b.d)
        .slice(0, OTHER_VOICES);
      others.forEach((v, k) => {
        const o = near[k];
        if (!o) {
          glide(v.gain.gain, 0, 0.15);
          v.target = -1;
          return;
        }
        const oc = o.x.car;
        if (v.target !== o.x.idx) {
          // a voice moving to another car starts from that car's note rather than sliding across to it
          v.target = o.x.idx;
          v.lastDist = o.d;
          v.f = 0;
        }
        // closing speed from the change in distance, for the Doppler shift
        const closing = (v.lastDist - o.d) / Math.max(1e-3, dt);
        v.lastDist = o.d;
        const pitch = 343 / (343 - Math.max(-80, Math.min(80, closing)));
        const dx = oc.x - car.x;
        const dy = oc.y - car.y;
        const right = dx * sin - dy * cos;
        const pan = Math.max(-0.9, Math.min(0.9, right / Math.max(4, o.d)));
        const gain = 0.55 / (1 + (o.d / 9) ** 1.5);
        drive(v, oc, gain, pitch, pan, false, false, dt);
      });

      // tyres: squeal from sliding on tarmac, louder and higher as the slide grows
      let slide = 0;
      let kerb = 0;
      let dirt = 0;
      let gravel = 0;
      for (const w of car.wheels) {
        const onRoad = w.surface === 'asphalt' || w.surface === 'kerb' || w.surface === 'runoff';
        if (onRoad && w.load > 300) slide = Math.max(slide, w.slide);
        if (w.surface === 'kerb') kerb += 0.25;
        if (w.surface === 'grass') dirt += 0.25;
        if (w.surface === 'gravel') gravel += 0.25;
      }
      const sq = Math.max(0, Math.min(1, (slide - 2.2) / 7));
      glide(squealGain.gain, sq * sq * 0.5, 0.08);
      glide(squealFilter.frequency, 950 + sq * 400 + Math.min(200, speed * 2), 0.08);
      glide(squealFilter2.frequency, 1600 + sq * 500, 0.08);

      // wind and road roar follow speed; the cockpit hears more wind, the chase camera more road
      const v = speed / 90;
      glide(windGain.gain, Math.min(0.5, v * v * (inside ? 0.42 : 0.24)), 0.08);
      glide(windFilter.frequency, 500 + speed * 18, 0.08);
      glide(roadGain.gain, Math.min(0.35, (speed / 60) * (inside ? 0.16 : 0.24)) * (dirt + gravel > 0.5 ? 0.4 : 1), 0.08);
      // kerb ridges about every half meter
      glide(kerbOsc.frequency, Math.max(18, Math.min(110, speed * 1.6)), 0.08);
      glide(kerbGain.gain, kerb * Math.min(1, speed / 20) * 0.32, 0.08);
      // gravel crunches (jittery), grass swishes
      const grit = gravel * Math.min(1, speed / 15) * 0.4 + dirt * Math.min(1, speed / 25) * 0.2;
      glide(dirtGain.gain, grit, 0.08);
      glide(dirtFilter.frequency, gravel > dirt ? 2200 : 700, 0.08);
    },
    impact(speed) {
      const vol = Math.min(0.9, 0.15 + speed * 0.04);
      burst({ dur: 0.35, vol, freq: 120, q: 0.6, type: 'lowpass', tone: 70 });
      burst({ dur: 0.18, vol: vol * 0.6, freq: 2400, q: 0.5 });
    },
    silence() {
      smooth(master.gain, 0, 0.05);
      lastTick = 0;
    },
    setMuted(m) {
      muted = m;
      if (m) smooth(master.gain, 0, 0.02);
    },
    dispose() {
      if (watchdog) window.clearInterval(watchdog);
      try {
        void live?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
