// Race sound, synthesized live with WebAudio (no audio files). The engine is a 1.6 litre turbo V6: a train of uneven
// exhaust pulses (engine.ts), three per crank turn so its note follows the simulated rpm exactly, ringing through a
// fixed exhaust pipe and body, brighter and harder on the throttle, with the turbo's whistle, crackle on the overrun
// and the limiter's stutter. The nearest rivals get their
// own voices, panned and Doppler shifted as they pass. Tyre squeal follows how hard the tyres slide, and wind, road
// roar, kerbs and gravel follow speed and surface. Everything is heard from the first view's car, with a touch of
// outdoor reverb.
import { SPEC, type Car } from './car.ts';
import type { Race } from './race.ts';
import { OFF_AIR, OFF_TONE, ON_AIR, ON_TONE, renderEngineLoop } from './engine.ts';
import { ENGINE_SAMPLES, layersFor } from './samples.ts';
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

/** The firing frequency of a four stroke V6 is three pulses per crank revolution. */
export const firingHz = (rpm: number) => (rpm / 60) * 3;

type Voice = {
  /** The exhaust pulse loop, played at rpm over its reference rpm. */
  src: AudioBufferSourceNode;
  /** The loop's four channels: tone and breath, on and off the throttle. */
  onTone: GainNode;
  onAir: GainNode;
  offTone: GainNode;
  offAir: GainNode;
  /** Brightness: opens with throttle, closes with distance. */
  filter: BiquadFilterNode;
  /** The hard edge of a loaded engine in the upper mids. */
  bite: BiquadFilterNode;
  amp: GainNode;
  /** Rev limiter: a square wave cutting the sound in time with the ignition cut, sample accurate. */
  cutLfo: OscillatorNode;
  cutDepth: GainNode;
  cut: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  whine: OscillatorNode;
  whineGain: GainNode;
  /** The synthesized engine's output, faded out once recorded loops have loaded. */
  synth: GainNode;
  /** Recorded loops (samples.ts), one looping source each, once loaded. */
  layers: { src: AudioBufferSourceNode; gain: GainNode }[] | null;
  /** Smoothed firing frequency and load, so frame-to-frame jitter in the simulation never reaches the ear. */
  f: number;
  load: number;
  drift: number;
  /** How muffled this voice is by distance (1 near, smaller far away). */
  near: number;
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

  // the exhaust pulses, rendered once for every voice
  const engine = renderEngineLoop(ctx.sampleRate);
  const engineBuf = ctx.createBuffer(4, engine.length, ctx.sampleRate);
  engine.channels.forEach((ch, k) => engineBuf.getChannelData(k).set(ch));

  const makeVoice = (out: AudioNode): Voice => {
    const src = ctx.createBufferSource();
    src.buffer = engineBuf;
    src.loop = true;
    src.playbackRate.value = 0.5;
    const split = ctx.createChannelSplitter(4);
    src.connect(split);
    const mix = ctx.createGain();
    const part = (ch: number) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      split.connect(g, ch).connect(mix);
      return g;
    };
    const onTone = part(ON_TONE);
    const onAir = part(ON_AIR);
    const offTone = part(OFF_TONE);
    const offAir = part(OFF_AIR);
    // the exhaust pipe: a fixed length of hot gas whose echoes reinforce some notes and cancel others, so the tone
    // changes as the revs sweep through them
    const pipe = ctx.createGain();
    const echo = ctx.createDelay(0.05);
    echo.delayTime.value = 0.0042;
    // (only the upper harmonics ring: the firing note itself passing a resonance would swell and fade with the revs)
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'bandpass';
    echoTone.frequency.value = 1500;
    echoTone.Q.value = 0.7;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0.3;
    mix.connect(pipe);
    pipe.connect(echo).connect(echoTone).connect(echoGain).connect(pipe);
    // the body: weight in the low end where the half orders growl, and the hard edge of a working engine
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 35;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 150;
    body.Q.value = 0.7;
    body.gain.value = 7;
    const bite = ctx.createBiquadFilter();
    bite.type = 'peaking';
    bite.frequency.value = 1300;
    bite.Q.value = 0.9;
    bite.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = 2000;
    const amp = ctx.createGain();
    amp.gain.value = 1.4;
    const cut = ctx.createGain();
    cut.gain.value = 1;
    const cutLfo = ctx.createOscillator();
    cutLfo.type = 'square';
    cutLfo.frequency.value = 17;
    const cutDepth = ctx.createGain();
    cutDepth.gain.value = 0;
    cutLfo.connect(cutDepth).connect(cut.gain);
    // the turbo's whistle, faint
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const synth = ctx.createGain();
    pipe.connect(low).connect(body).connect(bite).connect(filter).connect(synth).connect(amp);
    amp.connect(cut).connect(gain);
    whine.connect(whineGain).connect(gain);
    gain.connect(pan).connect(out);
    // each voice starts at its own place in the loop, so rivals never pulse in step with you
    src.start(0, Math.random() * engineBuf.duration);
    for (const o of [cutLfo, whine]) o.start();
    return { src, onTone, onAir, offTone, offAir, filter, bite, amp, cutLfo, cutDepth, cut, gain, pan, whine, whineGain, synth, layers: null, f: 0, load: 0, drift: 0, near: 1, target: -1, lastDist: 0 };
  };

  const engineBus = ctx.createGain();
  engineBus.connect(master);
  // a touch of outdoor space: the engines bouncing off the walls, stands and trees, a short soft tail
  const verb = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 0.9);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        // a few early reflections, then a diffuse tail that darkens as it fades
        const early = [0.011, 0.023, 0.037, 0.052].some((e) => Math.abs(t - e - ch * 0.003) < 0.0004) ? 0.5 : 0;
        d[i] = (early + (Math.random() * 2 - 1) * 0.35) * Math.exp(-t * 6.5);
      }
    }
    verb.buffer = ir;
  }
  const verbTone = ctx.createBiquadFilter();
  verbTone.type = 'lowpass';
  verbTone.frequency.value = 3200;
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.16;
  engineBus.connect(verb).connect(verbTone).connect(verbGain).connect(master);
  const me = makeVoice(engineBus);
  const others: Voice[] = Array.from({ length: OTHER_VOICES }, () => makeVoice(engineBus));

  // recorded engine loops: once they have all loaded, every voice switches over to them
  let disposed = false;
  if (ENGINE_SAMPLES.length && typeof fetch !== 'undefined') {
    Promise.all(ENGINE_SAMPLES.map((s) => fetch(s.url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(s.url)))).then((b) => ctx.decodeAudioData(b))))
      .then((bufs) => {
        if (disposed) return;
        for (const v of [me, ...others]) {
          v.layers = bufs.map((buf) => {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            src.connect(gain).connect(v.cut);
            src.start(0, Math.random() * buf.duration);
            return { src, gain };
          });
          v.synth.gain.value = 0;
        }
      })
      .catch(() => {
        /* the synthesized engine carries on */
      });
  }

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

  /** A short burst: overrun pops and impacts. */
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
    // a real engine never holds a perfectly steady note: a slow, tiny drift in pitch (a tenth of a percent)
    v.drift += (Math.random() - 0.5) * dt * 0.02 - v.drift * dt * 0.8;
    v.load += (load - v.load) * Math.min(1, dt / 0.12);
    const f = v.f * (1 + Math.max(-0.002, Math.min(0.002, v.drift)));
    const L = v.load;
    // the loop plays at the engine's speed over the speed it was rendered at
    glide(v.src.playbackRate, Math.max(0.2, Math.min(3, ((f / 3) * 60) / engine.refRpm)));
    glide(v.whine.frequency, 1700 + car.rpm * 0.22, 0.1);
    // on the throttle: hard, even pulses with a breath of exhaust; off it: the softer, uneven burble of the overrun
    const on = Math.sin((L * Math.PI) / 2);
    const off = Math.cos((L * Math.PI) / 2);
    glide(v.onTone.gain, on, 0.08);
    // (the cockpit sits by the airbox, so it hears more of the breath)
    glide(v.onAir.gain, on * (inside ? 0.42 : 0.32), 0.08);
    glide(v.offTone.gain, off * 0.6, 0.08);
    glide(v.offAir.gain, off * 0.4, 0.08);
    // brightness opens with the throttle and a little with the revs; distance takes the top off
    glide(v.filter.frequency, Math.min(9000, (1300 + 2500 * L + 0.1 * car.rpm) * v.near), 0.08);
    glide(v.bite.gain, 4 * L * Math.min(1, car.rpm / 10000), 0.1);
    // (recordings carry their own turbo)
    glide(v.whineGain.gain, v.layers ? 0 : Math.max(0, (car.rpm - 7000) / 5500) * 0.006 * (0.3 + L), 0.15);
    // the limiter cuts the sound to about half, seventeen times a second, while it holds the revs
    glide(v.cutDepth.gain, limiter ? 0.28 : 0, 0.03);
    glide(v.cut.gain, limiter ? 0.72 : 1, 0.03);
    const rpmLoud = 0.45 + 0.55 * Math.min(1, car.rpm / SPEC.limiter);
    if (v.layers) {
      // recordings: the two loops nearest the rpm, pitched to it (and Doppler shifted), blended on and off throttle
      const rpm = (f / pitch / 3) * 60;
      for (const layer of layersFor(ENGINE_SAMPLES, rpm, L)) {
        const l = v.layers[layer.index];
        glide(l.src.playbackRate, layer.rate * pitch);
        glide(l.gain.gain, layer.gain);
      }
      glide(v.gain.gain, (0.6 + 0.4 * L) * gain);
    } else glide(v.gain.gain, (0.4 + 0.6 * L) * (0.75 + 0.25 * rpmLoud) * gain, 0.12);
    glide(v.pan.pan, pan, 0.1);
  };

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
        // rivals sit well under your own engine, and the air takes the edge off them with distance
        const gain = 0.16 / (1 + (o.d / 12) ** 1.5);
        v.near = 1 / (1 + o.d / 30);
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
      disposed = true;
      if (watchdog) window.clearInterval(watchdog);
      try {
        void live?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
