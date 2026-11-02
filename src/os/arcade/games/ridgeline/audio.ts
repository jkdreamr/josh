// Ridgeline's sound, built on the arcade's audio graph with filters and stereo placement, so it sounds like a
// battlefield and not a chip synth: gunshots by class (a sharp crack, a body and a low thump close up; a dull report
// that arrives late from far away), footsteps by surface (soft, muffled, heel then toe), hits, headshots and kills,
// reloads, grenades and the charge. Every sound off to one side comes from that side, and distance muffles it.
// Nothing plays while the arcade is muted (graph() is null then).
import { sfx } from '../../kit';
import type { Ev, Match } from './match.ts';
import type { Surface } from './world.ts';
import { WEAPONS, type WeaponClass, type WeaponId } from './weapons.ts';

type Graph = NonNullable<ReturnType<typeof sfx.graph>>;

// ---------------------------------------------------------------------------------------------------------------
// building blocks

/** A couple of seconds of white noise, made once per audio context and shared by every sound. */
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

/** Where a sound sits: left/right (-1 to 1) and how loud for its distance (0 to 1). */
type Place = { pan: number; gain: number; delay: number; muffle: number };
const HERE: Place = { pan: 0, gain: 1, delay: 0, muffle: 1 };

/** The end of a sound's chain: its own level, then its place on the left and right, then out. */
function outlet(g: Graph, place: Place, bus: AudioNode = g.out): AudioNode {
  if (Math.abs(place.pan) < 0.02 || typeof g.ctx.createStereoPanner !== 'function') return bus;
  const p = g.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, place.pan));
  p.connect(bus);
  return p;
}

type Burst = {
  /** Filter shape and its corner (or center), in Hz; `to` sweeps it over the sound. */
  type: BiquadFilterType;
  freq: number;
  to?: number;
  q?: number;
  /** Seconds to rise and to fall away; `hold` stays at full level in between. */
  attack?: number;
  hold?: number;
  decay: number;
  vol: number;
  at?: number;
};

/** A burst of filtered noise. */
function burst(g: Graph, place: Place, b: Burst, bus?: AudioNode) {
  const t = g.ctx.currentTime + place.delay + (b.at ?? 0);
  const src = g.ctx.createBufferSource();
  src.buffer = noise(g);
  const f = g.ctx.createBiquadFilter();
  f.type = b.type;
  const corner = b.type === 'lowpass' ? b.freq * place.muffle : b.freq;
  f.frequency.setValueAtTime(Math.max(30, corner), t);
  if (b.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, b.to * (b.type === 'lowpass' ? place.muffle : 1)), t + (b.attack ?? 0.002) + (b.hold ?? 0) + b.decay);
  f.Q.value = b.q ?? 0.7;
  const env = g.ctx.createGain();
  const peak = b.vol * place.gain;
  const a = b.attack ?? 0.002;
  const h = b.hold ?? 0;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  if (h > 0) env.gain.setValueAtTime(Math.max(0.0002, peak), t + a + h);
  env.gain.exponentialRampToValueAtTime(0.0001, t + a + h + b.decay);
  src.connect(f).connect(env).connect(outlet(g, place, bus));
  // start somewhere different in the noise each time, so no two sounds are the same
  src.start(t, Math.random() * 1.5, a + h + b.decay + 0.05);
}

type Osc = { type?: OscillatorType; freq: number; to?: number; attack?: number; hold?: number; decay: number; vol: number; at?: number; lowpass?: number; detune?: number };

/** A pitched sound (a thump, a ping, a note), optionally through a lowpass. */
function osc(g: Graph, place: Place, o: Osc, bus?: AudioNode) {
  const t = g.ctx.currentTime + place.delay + (o.at ?? 0);
  const v = g.ctx.createOscillator();
  v.type = o.type ?? 'sine';
  v.frequency.setValueAtTime(o.freq, t);
  if (o.detune) v.detune.value = o.detune;
  const a = o.attack ?? 0.003;
  const h = o.hold ?? 0;
  if (o.to) v.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + a + h + o.decay);
  const env = g.ctx.createGain();
  const peak = o.vol * place.gain;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  if (h > 0) env.gain.setValueAtTime(Math.max(0.0002, peak), t + a + h);
  env.gain.exponentialRampToValueAtTime(0.0001, t + a + h + o.decay);
  let head: AudioNode = env;
  if (o.lowpass) {
    const f = g.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass * place.muffle;
    env.connect(f);
    head = f;
  }
  v.connect(env);
  head.connect(outlet(g, place, bus));
  v.start(t);
  v.stop(t + a + h + o.decay + 0.05);
}

// ---------------------------------------------------------------------------------------------------------------
// where things are

/** The listener: where the camera is and which way it faces. */
export type Ear = { x: number; z: number; yaw: number };

/** A sound at (x, z) heard from the ear: placed left or right, quieter and duller with distance, late when far. */
function placeAt(ear: Ear, x: number, z: number, range: number, late = true): Place | null {
  const dx = x - ear.x;
  const dz = z - ear.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return null;
  // the ear's right is (cos yaw, -sin yaw) for a view looking down -z at yaw 0
  const right = d > 0.5 ? (dx * Math.cos(ear.yaw) - dz * Math.sin(ear.yaw)) / d : 0;
  const k = 1 - d / range;
  return { pan: right * 0.85, gain: k * k * 0.9 + 0.1 * k, delay: late ? Math.min(1, d / 343) : 0, muffle: 0.18 + 0.82 * Math.pow(k, 1.5) };
}

// ---------------------------------------------------------------------------------------------------------------
// the sounds

type ShotLook = { crack: number; body: number; bodyQ: number; thump: number; tail: number; vol: number; range: number };
const SHOTS: Record<WeaponClass, ShotLook> = {
  pistol: { crack: 4200, body: 1300, bodyQ: 0.9, thump: 140, tail: 0.25, vol: 0.55, range: 140 },
  smg: { crack: 4600, body: 1500, bodyQ: 0.9, thump: 150, tail: 0.22, vol: 0.5, range: 150 },
  shotgun: { crack: 2600, body: 700, bodyQ: 0.7, thump: 85, tail: 0.5, vol: 0.85, range: 200 },
  rifle: { crack: 5200, body: 1100, bodyQ: 0.8, thump: 110, tail: 0.45, vol: 0.7, range: 260 },
  dmr: { crack: 5600, body: 950, bodyQ: 0.8, thump: 95, tail: 0.6, vol: 0.8, range: 300 },
  sniper: { crack: 6000, body: 800, bodyQ: 0.7, thump: 75, tail: 0.9, vol: 0.95, range: 420 },
};

/** A gunshot: your own up close and punchy, others by distance (a whip crack when it is fired your way). */
function shot(g: Graph, cls: WeaponClass, place: Place, mine: boolean) {
  const s = SHOTS[cls];
  const v = s.vol * (mine ? 0.75 : 1);
  const near = place.muffle > 0.7;
  if (near) burst(g, place, { type: 'highpass', freq: s.crack, decay: 0.03, vol: v * 0.55 });
  burst(g, place, { type: 'bandpass', freq: s.body, to: s.body * 0.5, q: s.bodyQ, decay: 0.09 + (1 - place.muffle) * 0.1, vol: v * 0.9 });
  osc(g, place, { freq: s.thump * 1.6, to: s.thump * 0.45, decay: 0.12, vol: v * (near ? 0.8 : 0.35) });
  // the echo off the land, longer and duller the further off it was
  burst(g, place, { type: 'lowpass', freq: 900, to: 220, attack: 0.02, decay: s.tail * (1.4 - place.muffle * 0.5), vol: v * 0.22, at: 0.03 });
}

type StepLook = { lp: number; q: number; decay: number; vol: number; grit?: number };
const STEPS: Partial<Record<Surface, StepLook>> = {
  dirt: { lp: 700, q: 0.8, decay: 0.07, vol: 0.32 },
  leaf: { lp: 1500, q: 0.6, decay: 0.09, vol: 0.26, grit: 3200 },
  sand: { lp: 1100, q: 0.5, decay: 0.1, vol: 0.26, grit: 2400 },
  snow: { lp: 1400, q: 0.5, decay: 0.14, vol: 0.3, grit: 2800 },
  stone: { lp: 2200, q: 1.2, decay: 0.05, vol: 0.3 },
  wood: { lp: 900, q: 2.4, decay: 0.08, vol: 0.36 },
  metal: { lp: 2600, q: 4, decay: 0.12, vol: 0.24 },
  water: { lp: 1300, q: 0.6, decay: 0.22, vol: 0.34 },
};

/** A footstep: a soft muffled heel, then the toe, by what is underfoot (never a sharp crack). */
function step(g: Graph, surface: Surface, place: Place, mine: boolean) {
  const s = STEPS[surface] ?? STEPS.dirt!;
  const v = s.vol * (mine ? 0.45 : 1) * (0.85 + Math.random() * 0.3);
  const lp = s.lp * (0.9 + Math.random() * 0.2);
  burst(g, place, { type: surface === 'wood' || surface === 'metal' ? 'bandpass' : 'lowpass', freq: lp, q: s.q, attack: 0.006, decay: s.decay, vol: v });
  burst(g, place, { type: 'lowpass', freq: lp * 0.8, q: s.q, attack: 0.008, decay: s.decay * 0.8, vol: v * 0.55, at: 0.055 + Math.random() * 0.02 });
  if (s.grit) burst(g, place, { type: 'bandpass', freq: s.grit, q: 1.5, attack: 0.01, decay: s.decay * 1.2, vol: v * 0.25 });
  if (surface === 'wood') osc(g, place, { freq: 140 + Math.random() * 30, to: 90, decay: 0.07, vol: v * 0.35 });
}

function boom(g: Graph, place: Place, big: boolean) {
  const v = big ? 1.2 : 0.9;
  osc(g, place, { freq: 70, to: 26, decay: big ? 1.4 : 0.8, vol: v * 0.9 });
  burst(g, place, { type: 'lowpass', freq: 2400, to: 160, attack: 0.004, decay: big ? 1.8 : 1.1, vol: v * 0.8 });
  burst(g, place, { type: 'highpass', freq: 3000, attack: 0.002, decay: 0.08, vol: v * 0.3 * place.muffle });
  // debris pattering down
  for (let i = 0; i < (big ? 7 : 4); i++) burst(g, place, { type: 'bandpass', freq: 1800 + Math.random() * 2500, q: 2, decay: 0.03, vol: v * 0.05, at: 0.25 + Math.random() * 0.9 });
}

function reload(g: Graph, w: WeaponId) {
  const t = WEAPONS[w].reload;
  const click = (at: number, f: number, v: number) => {
    burst(g, HERE, { type: 'bandpass', freq: f, q: 3, decay: 0.035, vol: v, at });
    osc(g, HERE, { type: 'triangle', freq: f * 0.25, decay: 0.03, vol: v * 0.3, at });
  };
  click(0.12, 2200, 0.18); // mag out
  burst(g, HERE, { type: 'lowpass', freq: 600, attack: 0.03, decay: 0.15, vol: 0.12, at: t * 0.35 }); // cloth and hands
  click(t * 0.62, 1700, 0.24); // mag in
  click(t * 0.86, 2600, 0.2); // charging handle
  click(t * 0.9, 1400, 0.16);
}

// ---------------------------------------------------------------------------------------------------------------
// what this frame sounds like

/** Plays what this frame's events sound like from where you are (`you` is your actor). */
export function playEvents(m: Match, evs: Ev[], ear: Ear, you: number) {
  const g = sfx.graph();
  if (!g) return;
  // a hundred players can fire a lot at once: a few distant shots and steps a frame are enough to hear a fight
  let far = 0;
  let steps = 0;
  for (const e of evs) {
    switch (e.t) {
      case 'shot': {
        const mine = e.a === you;
        const cls = WEAPONS[e.w].cls;
        const p = mine ? HERE : placeAt(ear, e.x, e.z, SHOTS[cls].range);
        if (!p) break;
        if (!mine && p.muffle < 0.75 && ++far > 4) break;
        shot(g, cls, p, mine);
        break;
      }
      case 'step': {
        const a = m.actors[e.a];
        if (!a) break;
        const mine = e.a === you;
        // running is loud, walking and crouching quiet (only you hear your own soft steps)
        if (!mine && !e.loud) break;
        const p = mine ? HERE : placeAt(ear, a.body.x, a.body.z, 30, false);
        if (!p || (!mine && ++steps > 4)) break;
        step(g, e.s, p, mine);
        break;
      }
      case 'impact': {
        const p = placeAt(ear, e.x, e.z, 22, false);
        if (!p) break;
        const f = e.s === 'metal' ? 3800 : e.s === 'wood' ? 1200 : e.s === 'stone' ? 2600 : e.s === 'water' ? 900 : 1600;
        burst(g, p, { type: 'bandpass', freq: f, q: e.s === 'metal' ? 6 : 1.5, decay: e.s === 'metal' ? 0.12 : 0.05, vol: 0.12 });
        break;
      }
      case 'hit':
        if (e.a === you && e.v !== you) {
          // the hit you landed: a dry tick, a bright ring for the head, a deeper knock for the kill
          if (e.kill) {
            osc(g, HERE, { type: 'triangle', freq: 520, to: 420, decay: 0.14, vol: 0.22 });
            osc(g, HERE, { freq: 1560, decay: 0.2, vol: 0.12, at: 0.05 });
          } else if (e.zone === 'head') {
            osc(g, HERE, { freq: 2900, decay: 0.16, vol: 0.14 });
            osc(g, HERE, { freq: 4350, decay: 0.12, vol: 0.07 });
          } else burst(g, HERE, { type: 'bandpass', freq: e.armor ? 2400 : 1500, q: 4, decay: 0.03, vol: 0.2 });
        }
        if (e.v === you) {
          osc(g, HERE, { freq: 120, to: 55, decay: 0.16, vol: 0.4 });
          burst(g, HERE, { type: 'lowpass', freq: 500, decay: 0.12, vol: 0.3 });
          if (e.zone === 'head') osc(g, HERE, { freq: 3400, to: 3100, decay: 0.5, vol: 0.03 });
        }
        break;
      case 'reload':
        if (e.a === you) reload(g, e.w);
        break;
      case 'empty':
        if (e.a === you) burst(g, HERE, { type: 'bandpass', freq: 3000, q: 5, decay: 0.025, vol: 0.18 });
        break;
      case 'swap':
        if (e.a === you) {
          burst(g, HERE, { type: 'lowpass', freq: 700, attack: 0.02, decay: 0.12, vol: 0.12 });
          burst(g, HERE, { type: 'bandpass', freq: 2000, q: 3, decay: 0.03, vol: 0.12, at: 0.15 });
        }
        break;
      case 'throw':
        if (e.a === you) burst(g, HERE, { type: 'lowpass', freq: 1200, attack: 0.04, decay: 0.15, vol: 0.18 });
        break;
      case 'bounce': {
        const p = placeAt(ear, e.x, e.z, 30, false);
        if (p) burst(g, p, { type: 'bandpass', freq: 2600 + Math.random() * 800, q: 8, decay: 0.08, vol: 0.12 });
        break;
      }
      case 'boom': {
        const p = placeAt(ear, e.x, e.z, 260);
        if (p) boom(g, p, false);
        break;
      }
      case 'blast': {
        const p = placeAt(ear, e.x, e.z, 400) ?? { pan: 0, gain: 0.15, delay: 0.5, muffle: 0.2 };
        boom(g, p, true);
        break;
      }
      case 'flash': {
        // a flashbang: a sharp, bright bang
        const p = placeAt(ear, e.x, e.z, 160);
        if (!p) break;
        burst(g, p, { type: 'highpass', freq: 1800, attack: 0.002, decay: 0.25, vol: 0.7 });
        burst(g, p, { type: 'bandpass', freq: 900, q: 0.8, attack: 0.002, decay: 0.4, vol: 0.5 });
        osc(g, p, { freq: 140, to: 50, decay: 0.3, vol: 0.4 });
        break;
      }
      case 'blind':
        // it got you: a ringing in the ears that fades with the white
        if (e.a === you) {
          osc(g, HERE, { freq: 3700, attack: 0.02, hold: e.secs * 0.4, decay: e.secs * 0.8, vol: 0.06 });
          osc(g, HERE, { freq: 3710, attack: 0.02, hold: e.secs * 0.4, decay: e.secs * 0.8, vol: 0.04 });
        }
        break;
      case 'medal':
        if (e.a === you) {
          // a short rising horn, longer for the bigger ones
          const big = e.kind === 'ace' || e.kind === 'clutch' ? 3 : e.kind === 'triple' || e.kind === 'quad' ? 2 : 1;
          const notes = [293.7, 370, 440, 587.3].slice(0, big + 1);
          notes.forEach((f, i) => osc(g, HERE, { type: 'sawtooth', freq: f, attack: 0.02, hold: 0.05, decay: 0.25, vol: 0.06, lowpass: 1800, at: i * 0.09 }));
        }
        break;
      case 'smoke': {
        const p = placeAt(ear, e.x, e.z, 70, false);
        if (p) burst(g, p, { type: 'highpass', freq: 2500, attack: 0.3, hold: 0.6, decay: 1.2, vol: 0.12 });
        break;
      }
      case 'jump':
        if (e.a === you) burst(g, HERE, { type: 'lowpass', freq: 600, attack: 0.01, decay: 0.08, vol: 0.12 });
        break;
      case 'land':
        if (e.a === you) {
          osc(g, HERE, { freq: 90, to: 50, decay: 0.08, vol: 0.25 });
          burst(g, HERE, { type: 'lowpass', freq: 800, decay: 0.1, vol: 0.22 });
        }
        break;
      case 'buy':
        if (e.a === you) {
          burst(g, HERE, { type: 'bandpass', freq: 2400, q: 4, decay: 0.03, vol: 0.16 });
          burst(g, HERE, { type: 'bandpass', freq: 1700, q: 4, decay: 0.04, vol: 0.14, at: 0.07 });
        }
        break;
      case 'phase':
        if (e.phase === 'live') {
          // go: a low horn
          osc(g, HERE, { type: 'sawtooth', freq: 146.8, attack: 0.05, hold: 0.3, decay: 0.4, vol: 0.12, lowpass: 900 });
          osc(g, HERE, { type: 'sawtooth', freq: 220, attack: 0.05, hold: 0.3, decay: 0.4, vol: 0.08, lowpass: 900, detune: 6 });
        }
        break;
      case 'round': {
        const me = m.actors[you];
        const won = !!me && e.winner === me.team;
        // a brass chord: major and rising for a win, low and minor for a loss
        const notes = won ? [146.8, 185, 220, 293.7] : [110, 130.8, 164.8];
        notes.forEach((f, i) => {
          osc(g, HERE, { type: 'sawtooth', freq: f, attack: 0.06, hold: 0.5, decay: 0.8, vol: 0.07, lowpass: won ? 1400 : 800, at: i * 0.04 });
          osc(g, HERE, { type: 'sawtooth', freq: f, attack: 0.06, hold: 0.5, decay: 0.8, vol: 0.05, lowpass: won ? 1400 : 800, detune: 9, at: i * 0.04 });
        });
        break;
      }
      case 'plant': {
        const a = m.actors[e.a];
        const p = a ? placeAt(ear, a.body.x, a.body.z, 45, false) : null;
        if (e.done) {
          // armed: three rising tones everyone hears
          [880, 1320, 1760].forEach((f, i) => osc(g, HERE, { type: 'triangle', freq: f, decay: 0.16, vol: 0.12, at: i * 0.13 }));
        } else if (e.a === you || p) for (let i = 0; i < 4; i++) burst(g, e.a === you ? HERE : p!, { type: 'bandpass', freq: 2400 + i * 120, q: 6, decay: 0.03, vol: 0.12, at: i * 0.5 });
        break;
      }
      case 'defuse': {
        const a = m.actors[e.a];
        const p = a ? placeAt(ear, a.body.x, a.body.z, 45, false) : null;
        if (e.done) {
          osc(g, HERE, { type: 'triangle', freq: 1320, to: 440, decay: 0.4, vol: 0.12 });
          osc(g, HERE, { freq: 660, decay: 0.3, vol: 0.08, at: 0.4 });
        } else if (e.a === you || p) burst(g, e.a === you ? HERE : p!, { type: 'highpass', freq: 1800, attack: 0.05, decay: 0.3, vol: 0.08 });
        break;
      }
      case 'carry':
        if (e.a === you) osc(g, HERE, { type: 'triangle', freq: 520, to: 780, decay: 0.12, vol: 0.1 });
        break;
      case 'sides':
        osc(g, HERE, { type: 'sawtooth', freq: 196, attack: 0.05, hold: 0.25, decay: 0.4, vol: 0.08, lowpass: 900 });
        break;
      case 'spawn':
        if (e.a === you) osc(g, HERE, { type: 'triangle', freq: 600, to: 900, decay: 0.12, vol: 0.08 });
        break;
      case 'pickup':
        if (e.a === you) burst(g, HERE, { type: 'bandpass', freq: e.item.kind === 'gun' ? 1400 : 2600, q: 3, decay: 0.05, vol: 0.16 });
        break;
      case 'heal':
        if (e.a === you) burst(g, HERE, { type: 'lowpass', freq: e.done ? 1600 : 900, attack: 0.03, decay: e.done ? 0.25 : 0.12, vol: 0.12 });
        break;
      case 'jumpout':
        if (e.a === you) burst(g, HERE, { type: 'lowpass', freq: 1200, attack: 0.2, hold: 0.4, decay: 0.8, vol: 0.2 });
        break;
      case 'chute':
        if (e.a === you) {
          burst(g, HERE, { type: 'lowpass', freq: 900, attack: 0.01, decay: 0.3, vol: 0.3 });
          osc(g, HERE, { freq: 140, to: 70, decay: 0.25, vol: 0.15 });
        }
        break;
      case 'zone':
        if (e.shrinking) {
          osc(g, HERE, { type: 'sawtooth', freq: 300, decay: 0.18, vol: 0.06, lowpass: 1200 });
          osc(g, HERE, { type: 'sawtooth', freq: 240, decay: 0.3, vol: 0.06, lowpass: 1200, at: 0.22 });
        }
        break;
      default:
        break;
    }
  }
}

/** The planted charge's beep, faster as its fuse runs down: call once a frame. Heard across the map, louder near. */
const beepAt = new WeakMap<Match, number>();
export function chargeBeeps(m: Match, ear: Ear) {
  const c = m.charge;
  if (m.mode !== 'breach' || c.state !== 'planted') {
    beepAt.delete(m);
    return;
  }
  const next = beepAt.get(m) ?? m.time;
  if (m.time < next) return;
  const gap = c.fuse > 20 ? 1 : c.fuse > 10 ? 0.5 : c.fuse > 5 ? 0.25 : 0.12;
  beepAt.set(m, m.time + gap);
  const g = sfx.graph();
  if (!g) return;
  const p = placeAt(ear, c.x, c.z, 90, false) ?? { pan: 0, gain: 0.08, delay: 0, muffle: 0.4 };
  osc(g, { ...p, gain: Math.max(0.12, p.gain) }, { freq: 1760, decay: 0.07, vol: 0.14 });
}
