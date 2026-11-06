// Ridgeline's sound, built on the arcade's audio graph with filters and stereo placement, so it sounds like a
// battlefield and not a chip synth: gunshots by class (a sharp crack, a body and a low thump close up; a dull report
// that arrives late from far away), footsteps by surface (soft, muffled, heel then toe), hits, headshots and kills,
// reloads, grenades and the charge, and in a royale the bombardment's shells (heard from far off), supply drops and
// the vehicles (engines that rise with the speed, doors, crashes). Every sound off to one side comes from that side,
// and distance muffles it. Nothing plays while the arcade is muted (graph() is null then).
// Most of it is real recordings once they have loaded (samples.ts): the gunshots close up and from far off, the crack
// of a bullet going past you, footsteps, reloads, bullet impacts, the blasts and the transport's propeller. The
// synthesized sounds here are what plays until then, if a browser cannot decode them, and for everything else.
import { sfx } from '../../kit';
import { CARS } from './cars.ts';
import { echoOfMine, type Ev, type Match } from './match.ts';
import { planeAt } from './royale.ts';
import { PROP_LEN, hasClip, playClip, spriteOf } from './samples.ts';
import type { Surface } from './world.ts';
import { WEAPONS, type WeaponClass, type WeaponDef, type WeaponId } from './weapons.ts';

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

/** The listener: where the camera is and which way it faces (and how high the ears are, for bullets going past). */
export type Ear = { x: number; z: number; yaw: number; y?: number };

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
  lmg: { crack: 5000, body: 1000, bodyQ: 0.8, thump: 100, tail: 0.55, vol: 0.75, range: 280 },
  // (a crossbow has a sound of its own: see twang)
  crossbow: { crack: 0, body: 600, bodyQ: 2, thump: 160, tail: 0.1, vol: 0.4, range: 40 },
};

/** A crossbow loosing its bolt: the limbs' thunk and the string's twang, then the hiss of the bolt. */
function twang(g: Graph, place: Place, mine: boolean) {
  const v = mine ? 0.8 : 1;
  osc(g, place, { type: 'triangle', freq: 190, to: 95, decay: 0.16, vol: v * 0.35 });
  osc(g, place, { type: 'sawtooth', freq: 330, to: 300, decay: 0.12, vol: v * 0.07, lowpass: 1800 });
  burst(g, place, { type: 'bandpass', freq: 600, q: 2, decay: 0.05, vol: v * 0.3 });
  burst(g, place, { type: 'highpass', freq: 3500, attack: 0.02, decay: 0.25, vol: v * 0.05, at: 0.03 });
}

/** Fire catching: a whoosh, then a crackle on and off for as long as it burns. */
function burning(g: Graph, place: Place) {
  burst(g, place, { type: 'lowpass', freq: 900, to: 300, attack: 0.05, decay: 0.6, vol: 0.45 });
  burst(g, place, { type: 'bandpass', freq: 1400, q: 0.8, attack: 0.1, hold: 0.3, decay: 0.5, vol: 0.18 });
  for (let i = 0; i < 26; i++) burst(g, place, { type: 'bandpass', freq: 1800 + Math.random() * 3000, q: 4, decay: 0.02, vol: 0.06 + Math.random() * 0.05, at: 0.3 + Math.random() * 6.2 });
  burst(g, place, { type: 'lowpass', freq: 500, attack: 0.5, hold: 5.5, decay: 1, vol: 0.08, at: 0.2 });
}

/** A recorded clip at a place (false while the recordings load: the caller synthesizes it then). */
function sample(g: Graph, sprite: 'guns' | 'steps' | 'foley' | 'booms', key: string, place: Place, vol: number, more?: { rate?: number; at?: number; lowpass?: number }) {
  return playClip(g.ctx, g.out, sprite, key, { ...place, vol, ...more });
}

/** Guns with a recording of their own; the rest sound like their class. */
const GUN_SOUND: Partial<Record<WeaponId, string>> = { bulwark: 'bulwark', marshal: 'marshal', wasp: 'wasp', mauler: 'mauler' };
/** How loud each class's recording plays, close and far, next to the synthesized levels in SHOTS. */
const SHOT_GAIN = { near: 1.05, far: 1.25 };

/**
 * A recorded gunshot: the close take near by, the far take (recorded down range, so it already sounds distant)
 * further off, the two crossfading in between; distance then dulls, delays and quietens either one like any sound.
 */
function shotSample(g: Graph, w: WeaponId, cls: WeaponClass, place: Place, mine: boolean) {
  const s = SHOTS[cls];
  const v = s.vol * (mine ? 0.75 : 1);
  const own = GUN_SOUND[w];
  const key = own && hasClip('guns', own) ? own : cls;
  const farKey = hasClip('guns', `${key}.far`) ? `${key}.far` : `${cls}.far`;
  const near = mine ? 1 : Math.max(0, Math.min(1, (place.muffle - 0.5) / 0.35));
  const rate = 0.96 + Math.random() * 0.08;
  // (close by, the recording stays bright: the muffle only starts to bite once it is a little way off)
  const nearPlace = mine ? place : { ...place, muffle: Math.min(1, place.muffle * 1.15) };
  let ok = true;
  if (near > 0) ok = sample(g, 'guns', key, nearPlace, v * SHOT_GAIN.near * near, { rate });
  if (ok && near < 1) ok = sample(g, 'guns', farKey, place, v * SHOT_GAIN.far * (1 - near), { rate });
  if (!ok) return false;
  // your own gun: a little weight in the chest under the recording
  if (mine) osc(g, place, { freq: s.thump * 1.6, to: s.thump * 0.45, decay: 0.1, vol: v * 0.35 });
  return true;
}

/** A gunshot: your own up close and punchy, others by distance (a whip crack when it is fired your way). */
function shot(g: Graph, w: WeaponId, place: Place, mine: boolean) {
  const cls = WEAPONS[w].cls;
  if (cls === 'crossbow') {
    twang(g, place, mine);
    return;
  }
  if (shotSample(g, w, cls, place, mine)) return;
  const s = SHOTS[cls];
  const v = s.vol * (mine ? 0.75 : 1);
  const near = place.muffle > 0.7;
  if (near) burst(g, place, { type: 'highpass', freq: s.crack, decay: 0.03, vol: v * 0.55 });
  burst(g, place, { type: 'bandpass', freq: s.body, to: s.body * 0.5, q: s.bodyQ, decay: 0.09 + (1 - place.muffle) * 0.1, vol: v * 0.9 });
  osc(g, place, { freq: s.thump * 1.6, to: s.thump * 0.45, decay: 0.12, vol: v * (near ? 0.8 : 0.35) });
  // the echo off the land, longer and duller the further off it was
  burst(g, place, { type: 'lowpass', freq: 900, to: 220, attack: 0.02, decay: s.tail * (1.4 - place.muffle * 0.5), vol: v * 0.22, at: 0.03 });
}

/** How close a bullet has to pass to be heard going by, meters. */
const PASS_R = 4;

/**
 * A bullet going past your head: where its line comes closest to the ear, and how soon it gets there. A fast round
 * cracks (its shock wave: a recorded snap, then a short tearing hiss), a slow one (a pistol, a bolt) only whips past.
 * The crack comes before the shot is heard, as it does for real, since the bullet outruns its own report.
 */
function passBy(g: Graph, e: Extract<Ev, { t: 'shot' }>, ear: Ear) {
  const def = WEAPONS[e.w];
  let dx = e.dx;
  let dy = e.dy;
  let dz = e.dz;
  if (e.v && e.v.length >= 3) {
    const l = Math.hypot(e.v[0], e.v[1], e.v[2]) || 1;
    dx = e.v[0] / l;
    dy = e.v[1] / l;
    dz = e.v[2] / l;
  }
  const ey = ear.y ?? e.y;
  const rx = ear.x - e.x;
  const ry = ey - e.y;
  const rz = ear.z - e.z;
  const along = rx * dx + ry * dy + rz * dz;
  if (along < 4 || along > 600) return false;
  const px = e.x + dx * along - ear.x;
  const py = e.y + dy * along - ey;
  const pz = e.z + dz * along - ear.z;
  const miss = Math.hypot(px, py, pz);
  if (miss > PASS_R) return false;
  const k = 1 - miss / PASS_R;
  const h = Math.hypot(px, pz);
  const side = h > 0.05 ? (px * Math.cos(ear.yaw) - pz * Math.sin(ear.yaw)) / h : 0;
  const place: Place = { pan: side * 0.9 * Math.min(1, miss), gain: 0.35 + 0.65 * k, delay: Math.min(1.5, along / def.speed), muffle: 1 };
  const fast = def.speed > 400 && def.cls !== 'crossbow';
  if (fast && !sample(g, 'guns', 'crack', place, 0.55 + 0.35 * k, { rate: 0.9 + Math.random() * 0.2 })) {
    // (synthesized until the recordings load: a sharp bright snap)
    burst(g, place, { type: 'highpass', freq: 3500, attack: 0.0005, decay: 0.012, vol: 0.5 + 0.3 * k });
    burst(g, place, { type: 'bandpass', freq: 1800, q: 1.2, attack: 0.0005, decay: 0.03, vol: 0.25 * k });
  }
  // the air it tears through, sweeping down as it goes by (louder and longer for a slow one)
  burst(g, place, { type: 'bandpass', freq: fast ? 4200 : 2600, to: fast ? 1600 : 900, q: 1.6, attack: fast ? 0.004 : 0.03, decay: fast ? 0.09 : 0.18, vol: (fast ? 0.12 : 0.2) * (0.4 + k), at: fast ? 0.004 : 0 });
  return true;
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

/** How loud each surface's recorded steps play (the takes are all normalized to the same peak). */
const STEP_GAIN: Record<Surface, number> = { leaf: 0.5, dirt: 0.55, sand: 0.6, snow: 0.6, stone: 0.55, wood: 0.5, metal: 0.45, water: 0.55 };

/** A footstep: a soft muffled heel, then the toe, by what is underfoot (never a sharp crack). */
function step(g: Graph, surface: Surface, place: Place, mine: boolean) {
  // recorded: a random take, a touch higher or lower each time, a little duller than the recording
  const k = (mine ? 0.45 : 1) * (0.85 + Math.random() * 0.3);
  if (sample(g, 'steps', surface, place, STEP_GAIN[surface] * k, { rate: 0.9 + Math.random() * 0.2, lowpass: 9000 })) return;
  const s = STEPS[surface] ?? STEPS.dirt!;
  const v = s.vol * (mine ? 0.45 : 1) * (0.85 + Math.random() * 0.3);
  const lp = s.lp * (0.9 + Math.random() * 0.2);
  burst(g, place, { type: surface === 'wood' || surface === 'metal' ? 'bandpass' : 'lowpass', freq: lp, q: s.q, attack: 0.006, decay: s.decay, vol: v });
  burst(g, place, { type: 'lowpass', freq: lp * 0.8, q: s.q, attack: 0.008, decay: s.decay * 0.8, vol: v * 0.55, at: 0.055 + Math.random() * 0.02 });
  if (s.grit) burst(g, place, { type: 'bandpass', freq: s.grit, q: 1.5, attack: 0.01, decay: s.decay * 1.2, vol: v * 0.25 });
  if (surface === 'wood') osc(g, place, { freq: 140 + Math.random() * 30, to: 90, decay: 0.07, vol: v * 0.35 });
}

/** A blast: the recorded one close by (a grenade, or the big one), the far rumble from a distance, crossfading. */
function boomSample(g: Graph, place: Place, big: boolean) {
  const v = big ? 1.2 : 0.9;
  const near = Math.max(0, Math.min(1, (place.muffle - 0.45) / 0.35));
  let ok = true;
  if (near > 0) ok = sample(g, 'booms', big ? 'big' : 'nade', { ...place, muffle: Math.min(1, place.muffle * 1.1) }, v * 0.9 * near, { rate: 0.94 + Math.random() * 0.1 });
  if (ok && near < 1) ok = sample(g, 'booms', 'far', place, v * 1.1 * (1 - near), { rate: 0.9 + Math.random() * 0.15 });
  if (!ok) return false;
  // the shove of air under the recording, felt more than heard
  osc(g, place, { freq: 60, to: 24, decay: big ? 1.1 : 0.6, vol: v * 0.45 });
  return true;
}

function boom(g: Graph, place: Place, big: boolean) {
  if (boomSample(g, place, big)) return;
  const v = big ? 1.2 : 0.9;
  osc(g, place, { freq: 70, to: 26, decay: big ? 1.4 : 0.8, vol: v * 0.9 });
  burst(g, place, { type: 'lowpass', freq: 2400, to: 160, attack: 0.004, decay: big ? 1.8 : 1.1, vol: v * 0.8 });
  burst(g, place, { type: 'highpass', freq: 3000, attack: 0.002, decay: 0.08, vol: v * 0.3 * place.muffle });
  // debris pattering down
  for (let i = 0; i < (big ? 7 : 4); i++) burst(g, place, { type: 'bandpass', freq: 1800 + Math.random() * 2500, q: 2, decay: 0.03, vol: v * 0.05, at: 0.25 + Math.random() * 0.9 });
}

/** A reload in recorded foley, its steps spread over the reload time by the kind of gun (false while it loads). */
function reloadSample(g: Graph, def: WeaponDef) {
  const t = def.reload;
  const f = (key: string, at: number, vol: number) => sample(g, 'foley', key, HERE, vol, { at, rate: 0.97 + Math.random() * 0.06 });
  switch (def.cls) {
    case 'crossbow':
      return false;
    case 'pistol':
      return f('pmagout', 0.08, 0.32) && f('pmagin', t * 0.5, 0.36) && f('slide', t * 0.8, 0.3);
    case 'shotgun': {
      // a shell at a time, then the pump
      const n = Math.max(2, Math.min(5, Math.round(t / 0.55)));
      if (!f('shell', 0.1, 0.3)) return false;
      for (let i = 1; i < n; i++) f('shell', 0.1 + (i * (t * 0.72 - 0.1)) / n, 0.3);
      return f('rack', t * 0.82, 0.32);
    }
    case 'sniper':
      return f('magout', 0.1, 0.3) && f('magin', t * 0.45, 0.34) && f('bolt', t * 0.66, 0.3);
    default:
      return f('magout', 0.1, 0.3) && f('magin', t * 0.55, 0.34) && f('charge', t * 0.84, 0.32);
  }
}

function reload(g: Graph, w: WeaponId) {
  if (reloadSample(g, WEAPONS[w])) return;
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
  let shells = 0;
  let passes = 0;
  let impacts = 0;
  for (const e of evs) {
    switch (e.t) {
      case 'shot': {
        const mine = e.a === you;
        const cls = WEAPONS[e.w].cls;
        // fired your way: the bullet going past (a few a frame at most)
        if (!mine && passes < 3 && passBy(g, e, ear)) passes++;
        const p = mine ? HERE : placeAt(ear, e.x, e.z, SHOTS[cls].range);
        if (!p) break;
        if (!mine && p.muffle < 0.75 && ++far > 4) break;
        shot(g, e.w, p, mine);
        break;
      }
      case 'decoy': {
        // a decoy plays a gunshot like the real thing
        const cls = WEAPONS[e.w].cls;
        const p = placeAt(ear, e.x, e.z, SHOTS[cls].range);
        if (!p || (p.muffle < 0.75 && ++far > 4)) break;
        shot(g, e.w, p, false);
        break;
      }
      case 'fire': {
        const p = placeAt(ear, e.x, e.z, 60, false);
        if (p) burning(g, p);
        break;
      }
      case 'block': {
        // a shot rings off a raised shield; one that breaks it, a crash and a clatter
        const p = e.v === you ? HERE : placeAt(ear, e.x, e.z, 40, false);
        if (!p) break;
        if (e.broke) {
          burst(g, p, { type: 'bandpass', freq: 2200, q: 1.2, decay: 0.35, vol: 0.4 });
          osc(g, p, { freq: 180, to: 70, decay: 0.3, vol: 0.3 });
          for (let i = 0; i < 5; i++) burst(g, p, { type: 'bandpass', freq: 3000 + Math.random() * 2000, q: 6, decay: 0.05, vol: 0.08, at: 0.1 + Math.random() * 0.5 });
        } else {
          osc(g, p, { type: 'triangle', freq: 1700 + Math.random() * 400, to: 1300, decay: 0.12, vol: e.v === you ? 0.12 : 0.08 });
          if (e.a === you) osc(g, HERE, { type: 'triangle', freq: 900, decay: 0.05, vol: 0.12 });
        }
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
        if (!p || ++impacts > 4) break;
        // recorded for the hard surfaces (metal rings, wood knocks, stone chips); soft ground and water stay a
        // filtered thud, which is what a bullet into earth sounds like anyway
        const hard = e.s === 'metal' ? 'imp.metal' : e.s === 'wood' ? 'imp.wood' : e.s === 'stone' ? 'imp.stone' : null;
        if (hard && sample(g, 'foley', hard, p, e.s === 'metal' ? 0.22 : 0.26, { rate: 0.9 + Math.random() * 0.25 })) break;
        const f = e.s === 'metal' ? 3800 : e.s === 'wood' ? 1200 : e.s === 'stone' ? 2600 : e.s === 'water' ? 900 : 1600;
        burst(g, p, { type: 'bandpass', freq: f, q: e.s === 'metal' ? 6 : 1.5, decay: e.s === 'metal' ? 0.12 : 0.05, vol: 0.12 });
        if (!hard && e.s !== 'water') burst(g, p, { type: 'lowpass', freq: 500, attack: 0.002, decay: 0.07, vol: 0.1 });
        break;
      }
      case 'hit':
        if (e.a === you && e.v !== you && !echoOfMine(m, e)) {
          // the hit you landed, loud and clear over the gunfire: a crisp tick for the body (a harder clack on armor), a
          // bright ring for the head, and for the kill a deep knock with a rising chime
          if (e.kill) {
            osc(g, HERE, { freq: 160, to: 70, decay: 0.18, vol: 0.32 });
            osc(g, HERE, { type: 'triangle', freq: 660, to: 520, decay: 0.16, vol: 0.26 });
            osc(g, HERE, { freq: 1320, decay: 0.24, vol: 0.16, at: 0.06 });
            osc(g, HERE, { freq: 1980, decay: 0.3, vol: 0.1, at: 0.12 });
          } else if (e.zone === 'head') {
            osc(g, HERE, { freq: 2900, decay: 0.2, vol: 0.22 });
            osc(g, HERE, { freq: 4350, decay: 0.16, vol: 0.11 });
            burst(g, HERE, { type: 'bandpass', freq: 3200, q: 3, decay: 0.03, vol: 0.18 });
          } else {
            burst(g, HERE, { type: 'bandpass', freq: e.armor ? 2600 : 1700, q: 3, decay: 0.035, vol: 0.32 });
            osc(g, HERE, { type: 'triangle', freq: e.armor ? 1250 : 880, to: e.armor ? 900 : 620, decay: 0.05, vol: 0.2 });
          }
        }
        if (e.v !== you && e.a !== you && e.est === undefined) {
          // someone else hit near you: the dull smack of it
          const p = placeAt(ear, e.x, e.z, 18, false);
          if (p && ++impacts <= 4) sample(g, 'foley', 'imp.flesh', p, 0.18, { rate: 0.9 + Math.random() * 0.2, lowpass: 5000 });
        }
        if (e.v === you) {
          sample(g, 'foley', 'imp.flesh', HERE, 0.3, { rate: 0.85 + Math.random() * 0.2, lowpass: 4000 });
          osc(g, HERE, { freq: 120, to: 55, decay: 0.16, vol: 0.4 });
          burst(g, HERE, { type: 'lowpass', freq: 500, decay: 0.12, vol: 0.3 });
          if (e.zone === 'head') osc(g, HERE, { freq: 3400, to: 3100, decay: 0.5, vol: 0.03 });
        }
        break;
      case 'reload':
        if (e.a === you) reload(g, e.w);
        break;
      case 'empty':
        if (e.a === you && !sample(g, 'foley', 'empty', HERE, 0.35)) burst(g, HERE, { type: 'bandpass', freq: 3000, q: 5, decay: 0.025, vol: 0.18 });
        break;
      case 'swap':
        if (e.a === you) {
          // cloth and hands, then the gun coming up and clicking home
          burst(g, HERE, { type: 'lowpass', freq: 700, attack: 0.02, decay: 0.12, vol: 0.12 });
          if (!sample(g, 'foley', 'draw', HERE, 0.26, { at: 0.13, rate: 0.95 + Math.random() * 0.1 })) burst(g, HERE, { type: 'bandpass', freq: 2000, q: 3, decay: 0.03, vol: 0.12, at: 0.15 });
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
      case 'shell': {
        // a bombardment shell: a full blast close by, a low rumble from across the map (two a frame at most)
        if (shells >= 2) break;
        const p = placeAt(ear, e.x, e.z, 900);
        if (!p) break;
        shells++;
        boom(g, p, p.muffle > 0.75);
        break;
      }
      case 'redzone':
        if (e.stage === 'warn') {
          // a bombardment marked: a siren, rising twice
          for (let i = 0; i < 2; i++) osc(g, HERE, { type: 'sawtooth', freq: 330, to: 620, attack: 0.15, hold: 0.6, decay: 0.5, vol: 0.05, lowpass: 1400, at: i * 1.35 });
        }
        break;
      case 'supply':
        if (!e.landed) {
          // the drop plane passing high over: a low drone
          osc(g, HERE, { type: 'sawtooth', freq: 82, attack: 1.2, hold: 1.4, decay: 2.2, vol: 0.05, lowpass: 360 });
          osc(g, HERE, { type: 'sawtooth', freq: 83.5, attack: 1.2, hold: 1.4, decay: 2.2, vol: 0.04, lowpass: 360 });
        } else {
          // the crate hits the ground
          const p = placeAt(ear, e.x, e.z, 160);
          if (p) {
            osc(g, p, { freq: 80, to: 40, decay: 0.25, vol: 0.4 });
            burst(g, p, { type: 'lowpass', freq: 900, decay: 0.2, vol: 0.3 });
          }
        }
        break;
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
          const a = m.actors[you];
          if (a && m.mode === 'royale' && a.dropT === m.time) {
            // down from the sky: boots hit hard, a roll through the dirt, the canopy spilling its air behind
            osc(g, HERE, { freq: 75, to: 38, decay: 0.22, vol: 0.42 });
            burst(g, HERE, { type: 'lowpass', freq: 650, decay: 0.18, vol: 0.38 });
            burst(g, HERE, { type: 'lowpass', freq: 1300, attack: 0.05, hold: 0.25, decay: 0.3, vol: 0.12, at: 0.1 });
            burst(g, HERE, { type: 'bandpass', freq: 500, q: 0.7, attack: 0.15, decay: 0.8, vol: 0.1, at: 0.15 });
          } else {
            osc(g, HERE, { freq: 90, to: 50, decay: 0.08, vol: 0.25 });
            burst(g, HERE, { type: 'lowpass', freq: 800, decay: 0.1, vol: 0.22 });
          }
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
        if (e.a === you) burst(g, HERE, { type: 'bandpass', freq: e.item.kind === 'gun' || e.item.kind === 'att' ? 1400 : 2600, q: 3, decay: 0.05, vol: 0.16 });
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
      case 'car': {
        // a door: a dull clunk, and the seat taking the weight
        const a = m.actors[e.a];
        const p = e.a === you ? HERE : a ? placeAt(ear, a.body.x, a.body.z, 35, false) : null;
        if (!p) break;
        burst(g, p, { type: 'lowpass', freq: 520, attack: 0.004, decay: 0.12, vol: 0.3 });
        osc(g, p, { freq: 95, to: 60, decay: 0.1, vol: 0.2 });
        burst(g, p, { type: 'bandpass', freq: 1900, q: 4, decay: 0.03, vol: 0.08, at: e.on ? 0.02 : 0 });
        break;
      }
      case 'crash': {
        // a crunch of metal, bigger the harder it hit
        const p = placeAt(ear, e.x, e.z, 120);
        if (!p) break;
        const k = Math.min(1, e.v / 20);
        burst(g, p, { type: 'bandpass', freq: 1100, to: 500, q: 1.1, attack: 0.003, decay: 0.2 + k * 0.25, vol: 0.25 + k * 0.4 });
        burst(g, p, { type: 'highpass', freq: 3200, attack: 0.002, decay: 0.08 + k * 0.1, vol: 0.12 + k * 0.15 });
        osc(g, p, { freq: 85, to: 40, decay: 0.2, vol: 0.3 + k * 0.3 });
        for (let i = 0; i < 3 + k * 4; i++) burst(g, p, { type: 'bandpass', freq: 2200 + Math.random() * 2400, q: 6, decay: 0.05, vol: 0.05 + k * 0.05, at: 0.05 + Math.random() * 0.3 });
        break;
      }
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

// ---------------------------------------------------------------------------------------------------------------
// engines

/** One running engine: a sawtooth and a square an octave down, through a lowpass that opens with the revs. */
type Voice = { ctx: AudioContext; a: OscillatorNode; b: OscillatorNode; f: BiquadFilterNode; g: GainNode; p: StereoPannerNode | null; seen: boolean };
const voices = new Map<number, Voice>();
const nearest: number[] = [];

function startVoice(g: Graph): Voice {
  const ctx = g.ctx;
  const a = ctx.createOscillator();
  a.type = 'sawtooth';
  const b = ctx.createOscillator();
  b.type = 'square';
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 2.2;
  f.frequency.value = 400;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  const bg = ctx.createGain();
  bg.gain.value = 0.5;
  const p = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
  a.connect(f);
  b.connect(bg).connect(f);
  f.connect(gain);
  if (p) gain.connect(p).connect(g.out);
  else gain.connect(g.out);
  a.start();
  b.start();
  return { ctx, a, b, f, g: gain, p, seen: true };
}

function stopVoice(v: Voice) {
  const t = v.ctx.currentTime;
  try {
    v.g.gain.setTargetAtTime(0.0001, t, 0.04);
    v.a.stop(t + 0.25);
    v.b.stop(t + 0.25);
    v.a.onended = () => {
      v.a.disconnect();
      v.b.disconnect();
      v.f.disconnect();
      v.g.disconnect();
      v.p?.disconnect();
    };
  } catch {
    /* already stopped */
  }
}

/** Silences every engine (paused, muted, the match over, the game closed), and the wind and the transport too. */
export function stopEngines() {
  for (const v of voices.values()) stopVoice(v);
  voices.clear();
  stopAir();
}

/**
 * The engines of the few nearest vehicles with someone at the wheel, yours first: call once a frame. The pitch climbs
 * through the gears with the speed and the throttle opens the sound up; distance and direction place it like the rest.
 */
export function engineSounds(m: Match, ear: Ear, you: number) {
  const g = sfx.graph();
  if (!g || !m.cars.length || m.phase === 'over') {
    stopEngines();
    return;
  }
  // the three nearest running ones (no allocation: a short insertion list of car ids)
  nearest.length = 0;
  const mine = m.actors[you]?.car ?? -1;
  const dist = (id: number) => (id === mine ? -1 : Math.hypot(m.cars[id].x - ear.x, m.cars[id].z - ear.z));
  for (const c of m.cars) {
    if (!c.alive || c.seats[0] < 0) continue;
    const d = dist(c.id);
    if (d > 90) continue;
    let k = nearest.length;
    while (k > 0 && dist(nearest[k - 1]) > d) k--;
    nearest.splice(k, 0, c.id);
    if (nearest.length > 3) nearest.length = 3;
  }
  for (const v of voices.values()) v.seen = false;
  const t = g.ctx.currentTime;
  for (const id of nearest) {
    const c = m.cars[id];
    const S = CARS[c.kind];
    let v = voices.get(id);
    if (v && v.ctx !== g.ctx) {
      stopVoice(v);
      v = undefined;
    }
    if (!v) {
      v = startVoice(g);
      voices.set(id, v);
    }
    v.seen = true;
    const sp = Math.abs(c.speed);
    const thr = Math.abs(c.throttle);
    // gears: the revs climb through each fifth of the top speed, then drop back for the next
    const span = S.vmax / 5;
    const gear = Math.min(4, Math.floor(sp / span));
    const rev = (sp - gear * span) / span;
    const base = c.kind === 'bike' ? 1.55 : 1;
    const f = (30 + rev * 34 + gear * 7 + thr * 9) * base;
    const place = id === mine ? HERE : placeAt(ear, c.x, c.z, 90, false);
    const vol = (0.035 + thr * 0.03 + (sp / S.vmax) * 0.035) * (id === mine ? 1 : 1.4) * (place?.gain ?? 0);
    v.a.frequency.setTargetAtTime(f, t, 0.06);
    v.b.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    v.f.frequency.setTargetAtTime((300 + sp * 32 + thr * 500) * (place?.muffle ?? 1), t, 0.08);
    v.g.gain.setTargetAtTime(Math.max(0.0001, vol), t, 0.08);
    if (v.p) v.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, place?.pan ?? 0)), t, 0.08);
  }
  for (const [id, v] of voices)
    if (!v.seen) {
      stopVoice(v);
      voices.delete(id);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// the air

/** The wind (looped noise through a band that rises with the speed) and the transport's drone (the recorded
 * propeller loop once it has loaded, else two low saws a little apart, through a lowpass), each with its own level. */
type Air = { ctx: AudioContext; src: AudioBufferSourceNode; wf: BiquadFilterNode; wg: GainNode; drone: AudioScheduledSourceNode[]; prop: boolean; df: BiquadFilterNode; dg: GainNode };
let air: Air | null = null;

function startAir(g: Graph): Air {
  const ctx = g.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noise(g);
  src.loop = true;
  const wf = ctx.createBiquadFilter();
  wf.type = 'bandpass';
  wf.frequency.value = 500;
  wf.Q.value = 0.6;
  const wg = ctx.createGain();
  wg.gain.value = 0.0001;
  src.connect(wf).connect(wg).connect(g.out);
  const df = ctx.createBiquadFilter();
  df.type = 'lowpass';
  df.frequency.value = 240;
  df.Q.value = 1.1;
  const dg = ctx.createGain();
  dg.gain.value = 0.0001;
  df.connect(dg).connect(g.out);
  const drone: AudioScheduledSourceNode[] = [];
  const pb = spriteOf(ctx, 'prop');
  if (pb) {
    const p = ctx.createBufferSource();
    p.buffer = pb;
    p.loop = true;
    p.loopStart = 0;
    p.loopEnd = Math.min(PROP_LEN, pb.duration);
    p.connect(df);
    p.start(0, Math.random() * p.loopEnd);
    drone.push(p);
  } else
    for (const f of [57, 57.8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(df);
      o.start();
      drone.push(o);
    }
  src.start();
  return { ctx, src, wf, wg, drone, prop: !!pb, df, dg };
}

function stopAir() {
  const v = air;
  air = null;
  if (!v) return;
  const t = v.ctx.currentTime;
  try {
    v.wg.gain.setTargetAtTime(0.0001, t, 0.08);
    v.dg.gain.setTargetAtTime(0.0001, t, 0.08);
    v.src.stop(t + 0.5);
    for (const d of v.drone) d.stop(t + 0.5);
    v.src.onended = () => {
      for (const n of [v.src, v.wf, v.wg, ...v.drone, v.df, v.dg]) n.disconnect();
    };
  } catch {
    /* already stopped */
  }
}

/**
 * A royale's air, once a frame for the one the camera follows: aboard, the transport's drone all round (muffled by
 * the hull); in freefall a rushing wind that climbs with the speed; under the canopy a softer wind with the cloth
 * fluttering in it. On the ground the transport is still heard going over while it is near.
 */
export function airSounds(m: Match, you: number) {
  const g = sfx.graph();
  const a = m.actors[you];
  if (!g || m.mode !== 'royale' || m.phase === 'over' || !a) {
    stopAir();
    return;
  }
  let wind = 0;
  let windF = 400;
  let drone = 0;
  let droneF = 240;
  if (a.alive && a.drop === 2) {
    const v = Math.hypot(a.body.vx, a.body.vy, a.body.vz);
    wind = 0.05 + Math.min(1, v / 60) * 0.11;
    windF = 450 + v * 16;
  } else if (a.alive && a.drop === 3) {
    wind = 0.035 * (1 + 0.3 * Math.sin(m.time * 6.3) * Math.sin(m.time * 2.1));
    windF = 360 + Math.hypot(a.body.vx, a.body.vz) * 20;
  }
  if (a.alive && a.drop === 1) {
    drone = 0.06;
    droneF = 210;
  } else if (m.plane) {
    const p = planeAt(m.plane, m.time);
    const d = Math.hypot(p.x - a.body.x, m.plane.y - a.body.y, p.z - a.body.z);
    if (d < 750) {
      drone = 0.05 * (1 - d / 750) ** 2;
      droneF = 160 + (1 - d / 750) * 220;
    }
  }
  if (wind <= 0 && drone <= 0) {
    if (air) stopAir();
    return;
  }
  if (air && air.ctx !== g.ctx) stopAir();
  // (the propeller recording loaded after the drone started: swap it in)
  if (air && !air.prop && spriteOf(g.ctx, 'prop')) stopAir();
  if (!air) air = startAir(g);
  const t = g.ctx.currentTime;
  air.wg.gain.setTargetAtTime(Math.max(0.0001, wind), t, 0.12);
  air.wf.frequency.setTargetAtTime(windF, t, 0.15);
  // the recording is brighter than the saws: a higher corner and a little more level, so it reads through the hull
  air.dg.gain.setTargetAtTime(Math.max(0.0001, drone * (air.prop ? 1.6 : 1)), t, 0.3);
  air.df.frequency.setTargetAtTime(air.prop ? droneF * 4 : droneF, t, 0.3);
}
