// Ridgeline's recorded sounds: real gunshots (close and from far off, by gun), bullet cracks, footsteps by surface,
// reload foley, bullet impacts, grenade and shell blasts and the transport's propeller, packed by kind into a few
// small mono Opus files in ./sounds (sources and licenses in ./sounds/LICENSES.md). They are fetched and decoded
// one file after another only once a match is playing, once per audio context, so the menu never waits on them.
// Until a file has decoded (or if the browser cannot decode it) every sound that would use it stays synthesized in
// audio.ts. Played voices go through one shared pool with a cap: past it the quietest voice gives way (or the new
// one is dropped, if it is the quietest), so a hundred players fighting never pile up hundreds of buffer sources.
import booms from './sounds/booms.webm?url';
import foley from './sounds/foley.webm?url';
import guns from './sounds/guns.webm?url';
import prop from './sounds/prop.webm?url';
import steps from './sounds/steps.webm?url';

export type Sprite = 'guns' | 'steps' | 'foley' | 'booms' | 'prop';

/** Where each clip sits in its sprite: [start, length] in seconds, a few takes of each to pick from. */
type Table = Record<string, readonly (readonly [number, number])[]>;
// (made by the sound build from the cut takes: see sounds/LICENSES.md)
export const CLIPS: Record<Exclude<Sprite, 'prop'>, Table> = {
  guns: {
    rifle: [[0.05, 0.8727], [1.0227, 0.8737]],
    'rifle.far': [[1.9964, 1.7993], [3.8957, 1.7979]],
    smg: [[5.7936, 0.8816], [6.7752, 0.8984]],
    'smg.far': [[7.7736, 1.7978], [9.6714, 1.7868]],
    pistol: [[11.5582, 0.8], [12.4582, 0.7866]],
    'pistol.far': [[13.3448, 1.7578]],
    shotgun: [[15.2026, 1.0992], [16.4018, 1.0952]],
    'shotgun.far': [[17.5971, 1.9985]],
    dmr: [[19.6956, 0.9995], [20.7951, 0.9901]],
    'dmr.far': [[21.8852, 1.9971]],
    sniper: [[23.9823, 1.2926], [25.3749, 1.2821]],
    'sniper.far': [[26.757, 2.1989], [29.0559, 2.1995]],
    lmg: [[31.3554, 0.8977], [32.3531, 0.8916], [33.3447, 0.895]],
    'lmg.far': [[34.3397, 1.798], [36.2377, 1.7979]],
    bulwark: [[38.1355, 0.8986], [39.1342, 0.8993]],
    'bulwark.far': [[40.1335, 1.7993]],
    marshal: [[42.0328, 0.7996], [42.9324, 0.7996]],
    'marshal.far': [[43.8319, 1.7977]],
    wasp: [[45.7296, 0.7905], [46.6201, 0.7939]],
    mauler: [[47.514, 1.0856], [48.6996, 1.0579]],
    'mauler.far': [[49.8575, 1.9949]],
    crack: [[51.9524, 0.02], [52.0724, 0.02], [52.1923, 0.02], [52.3123, 0.02]],
  },
  steps: {
    leaf: [[0.05, 0.2433], [0.3933, 0.2434], [0.7367, 0.2434], [1.0801, 0.2434], [1.4234, 0.2434]],
    dirt: [[1.7668, 0.1855], [2.0523, 0.2447], [2.3971, 0.241], [2.738, 0.1881], [3.0262, 0.1925]],
    stone: [[3.3187, 0.318], [3.7367, 0.3194], [4.1561, 0.3148], [4.5709, 0.3089], [4.9798, 0.3171]],
    sand: [[5.3969, 0.3181], [5.815, 0.3061], [6.2211, 0.3119], [6.633, 0.3155], [7.0485, 0.2956]],
    snow: [[7.4442, 0.4075], [7.9517, 0.4118], [8.4635, 0.4187], [8.9822, 0.4101], [9.4923, 0.4128]],
    wood: [[10.0051, 0.2842], [10.3893, 0.2842], [10.7735, 0.2842], [11.1576, 0.2842], [11.5418, 0.2842]],
    metal: [[11.926, 0.2977], [12.3236, 0.3229], [12.7466, 0.1376], [12.9842, 0.2478]],
    water: [[13.332, 0.2679], [13.6999, 0.2679], [14.0678, 0.2617], [14.4295, 0.2306], [14.76, 0.2403]],
  },
  foley: {
    magout: [[0.05, 0.4009]],
    magin: [[0.5509, 0.5058]],
    pmagout: [[1.1567, 0.4027]],
    pmagin: [[1.6594, 0.4666]],
    slide: [[2.2259, 0.3087]],
    shell: [[2.6347, 0.6609]],
    rack: [[3.3955, 0.5069]],
    bolt: [[4.0024, 1.3305]],
    charge: [[5.433, 0.2119]],
    empty: [[5.7448, 0.2153]],
    draw: [[6.0601, 0.1515]],
    'imp.metal': [[6.3117, 0.4247], [6.8364, 0.269], [7.2053, 0.2416], [7.5469, 0.2859]],
    'imp.stone': [[7.9328, 0.4002], [8.433, 0.2708]],
    'imp.wood': [[8.8037, 0.4272], [9.3309, 0.4276]],
    'imp.flesh': [[9.8586, 0.4375], [10.3961, 0.4512]],
  },
  booms: {
    nade: [[0.05, 1.5002]],
    big: [[1.6502, 1.6014]],
    far: [[3.3516, 2.8842]],
  },
};

/** The propeller loop's exact length (the encoder pads the end, so the loop is told where it really ends). */
export const PROP_LEN = 4.957;

/** In the order they load: what is heard most first. */
const FILES: [Sprite, string][] = [
  ['guns', guns],
  ['steps', steps],
  ['foley', foley],
  ['booms', booms],
  ['prop', prop],
];

/** What has happened, for checking from a dev console or a test page that the samples load and get played. */
export const sampleStats = { decoded: 0, failed: 0, played: 0, dropped: 0, culled: 0, live: 0, synth: 0 };
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __ridgelineSounds?: typeof sampleStats }).__ridgelineSounds = sampleStats;

type Bank = { ctx: BaseAudioContext; bufs: Partial<Record<Sprite, AudioBuffer>>; dead: boolean };
let bank: Bank | null = null;
let wanted = false;

/** A match is playing: the samples may load (on the next sound, once there is an audio context to decode for). */
export function wantSamples() {
  wanted = true;
}

function bankFor(ctx: BaseAudioContext): Bank | null {
  if (!wanted || typeof fetch === 'undefined') return null;
  if (bank && bank.ctx === ctx) return bank;
  if (bank) bank.dead = true;
  const b: Bank = { ctx, bufs: {}, dead: false };
  bank = b;
  void (async () => {
    for (const [name, url] of FILES) {
      if (b.dead) return;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(url);
        const data = await r.arrayBuffer();
        if (b.dead) return;
        b.bufs[name] = await ctx.decodeAudioData(data);
        sampleStats.decoded++;
      } catch {
        // (a browser that cannot decode one cannot decode the rest either: they stay synthesized)
        sampleStats.failed++;
        return;
      }
    }
  })();
  return b;
}

/** The decoded sprite for this context, or null while it loads (or if it never will). */
export function spriteOf(ctx: BaseAudioContext, s: Sprite): AudioBuffer | null {
  return bankFor(ctx)?.bufs[s] ?? null;
}

/** Whether a sprite has this clip (so callers can fall back to a class's clip when a gun has none of its own). */
export function hasClip(s: Exclude<Sprite, 'prop'>, key: string) {
  return !!CLIPS[s][key];
}

// ---------------------------------------------------------------------------------------------------------------
// the voice pool

type Live = { src: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; level: number; end: number };
const live: Live[] = [];
/** The most sample voices at once. A busy royale fight sits well under it; past it, the quietest give way. */
const MAX_VOICES = 40;
/** Quieter than this (distance and level together) is not worth a voice. */
const INAUDIBLE = 0.004;

function retire(v: Live) {
  const i = live.indexOf(v);
  if (i >= 0) live.splice(i, 1);
  for (const n of v.nodes) n.disconnect();
  sampleStats.live = live.length;
}

export type Play = {
  /** Left/right (-1 to 1), level for the distance (0 to 1), seconds late, and how dull (1 clear, toward 0 dull). */
  pan: number;
  gain: number;
  delay: number;
  muffle: number;
  /** The clip's own level, and its playback rate (pitch). */
  vol: number;
  rate?: number;
  /** Extra seconds before it starts (a step in a sequence). */
  at?: number;
  /** Which take: by default one at random. */
  take?: number;
  /** A lowpass of its own, Hz (multiplied by the muffle), for sounds that should be duller than the recording. */
  lowpass?: number;
};

/**
 * Plays one clip. Returns false when the sprite is not decoded yet (the caller synthesizes instead); true when it
 * played, or when it was dropped on purpose (too quiet, or the pool full of louder voices).
 */
export function playClip(ctx: BaseAudioContext, out: AudioNode, s: Exclude<Sprite, 'prop'>, key: string, p: Play): boolean {
  const buf = spriteOf(ctx, s);
  const takes = CLIPS[s][key];
  if (!buf || !takes) {
    sampleStats.synth++;
    return false;
  }
  const level = p.vol * p.gain;
  if (level < INAUDIBLE) {
    sampleStats.dropped++;
    return true;
  }
  const now = ctx.currentTime;
  for (let i = live.length - 1; i >= 0; i--) if (live[i].end < now) retire(live[i]);
  if (live.length >= MAX_VOICES) {
    let q = 0;
    for (let i = 1; i < live.length; i++) if (live[i].level < live[q].level) q = i;
    if (live[q].level >= level) {
      sampleStats.dropped++;
      return true;
    }
    // the quietest gives way, with a quick fade so it does not click
    const v = live[q];
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.01);
    try {
      v.src.stop(now + 0.05);
    } catch {
      /* not started yet */
    }
    v.level = 0;
    v.end = now + 0.05;
    sampleStats.culled++;
  }
  const [start, len] = takes[p.take !== undefined ? p.take % takes.length : Math.floor(Math.random() * takes.length)];
  const rate = p.rate ?? 1;
  const t = now + p.delay + (p.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const nodes: AudioNode[] = [src];
  let head: AudioNode = src;
  // distance dulls it: from the full recording close by down to a few hundred Hz across the map
  const corner = Math.min(p.lowpass ?? 20000, 20000) * Math.pow(Math.max(0.05, p.muffle), 2.2);
  if (corner < 16000) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(120, corner);
    f.Q.value = 0.5;
    head.connect(f);
    head = f;
    nodes.push(f);
  }
  const gain = ctx.createGain();
  gain.gain.value = level;
  head.connect(gain);
  head = gain;
  nodes.push(gain);
  if (Math.abs(p.pan) >= 0.02 && typeof (ctx as AudioContext).createStereoPanner === 'function') {
    const pan = (ctx as AudioContext).createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, p.pan));
    head.connect(pan);
    head = pan;
    nodes.push(pan);
  }
  head.connect(out);
  const dur = len / rate;
  src.start(t, start, len);
  const v: Live = { src, gain, nodes, level, end: t + dur + 0.05 };
  src.onended = () => retire(v);
  live.push(v);
  sampleStats.played++;
  sampleStats.live = live.length;
  return true;
}

/** Stops every sample voice now (the game closed). */
export function stopSamples() {
  for (const v of live.slice()) {
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
    retire(v);
  }
}

/** The game closed: stops what plays and lets the decoded sounds go (the next match fetches them from the cache). */
export function releaseSamples() {
  stopSamples();
  wanted = false;
  if (bank) bank.dead = true;
  bank = null;
}
