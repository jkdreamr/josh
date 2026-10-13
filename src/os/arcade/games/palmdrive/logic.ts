// Pure race rules for Palm Drive: kart physics, drifting and mini-turbos, items, CPU drivers, laps and places.
// No DOM, no three.js. Distances are meters, times seconds; see track.ts for the axes and heading convention.
import { CURB, EDGE, ROAD_HALF, buildTrack, deltaS, gridSpot, headingOf, layout, locate, pointAt, wrapAngle, type Layout, type Track } from './track.ts';

export const LAPS = 5;
export const COUNTDOWN = 3;
export const KART_R = 1.05;
export const TURN = 2.1;
export const DRIFT_BASE = 1.2;
export const DRIFT_RANGE = 0.75;
export const HOP_V = 4.2;
export const GRAVITY = 28;
export const REVERSE = 7;
export const OFFROAD = 0.55;
export const MAX_COINS = 10;
/** Five coins buy a quick boost: a short one, well under a mushroom's. */
export const CASH_COST = 5;
export const CASH_T = 0.5;
/** Top speed from coins, a little for each. */
export const coinTop = (coins: number) => 0.12 * Math.min(coins, MAX_COINS);
export const BOOST_DV = 9;
export const STAR_DV = 5;
export const STAR_T = 7.5;
export const MUSHROOM_T = 1.3;
export const DASH_T = 1;
export const ROCKET_T = 1.2;
export const SHRINK_T = 5;
export const ROLL_T = 1.3;
export const BOX_RESPAWN = 2.5;
export const COIN_RESPAWN = 8;
/** Mini-turbo charge needed for blue, orange and purple sparks, and how long each boost lasts. */
export const TURBO_AT = [0, 0.75, 1.6, 2.6];
export const TURBO_T = [0, 0.5, 0.95, 1.5];
/** Slam: the sideways shove you give a kart beside you. */
export const SLAM_COOL = 1.1;
export const SLAM_T = 0.32;
export const SLAM_DASH = 7.5;
export const SLAM_KNOCK = 13;
export const WOBBLE_T = 0.6;
/**
 * Online, someone else's slam lands on your kart this much before the karts touch: their kart is drawn where it was
 * a moment ago, and on their screen it bounced off yours at arm's length.
 */
export const SLAM_PAD = 0.8;
/** Seconds tucked in behind another kart for a slipstream boost, and how long it lasts. */
export const DRAFT_T = 1.1;
export const DRAFT_BOOST = 1;
/** Boost for a trick off a ramp. */
export const TRICK_T = 0.9;
export const RAMP_LEN = 4;
export const RAMP_H = 0.7;
export const GREEN_V = 42;
export const RED_V = 40;
export const BLUE_V = 60;
export const BOOM_R = 7;

export type Cc = '50cc' | '100cc' | '150cc' | '200cc';
export const CCS: Cc[] = ['50cc', '100cc', '150cc', '200cc'];
export const CLASSES: Record<Cc, { top: number; accel: number; cpu: number }> = {
  '50cc': { top: 19, accel: 9, cpu: 0.92 },
  '100cc': { top: 23, accel: 11, cpu: 0.95 },
  '150cc': { top: 27.5, accel: 13, cpu: 0.97 },
  '200cc': { top: 33, accel: 16, cpu: 0.97 },
};
export const isCc = (v: unknown): v is Cc => CCS.includes(v as Cc);

export type Item = 'banana' | 'green' | 'red' | 'mushroom' | 'triple' | 'star' | 'bolt' | 'blue';
export const ITEMS: Item[] = ['banana', 'green', 'red', 'mushroom', 'triple', 'star', 'bolt', 'blue'];
export type ThingKind = 'banana' | 'green' | 'red' | 'blue';
export type HitHow = 'spin' | 'tumble' | 'squash' | 'boom';

/** hold: the item button is held (bananas and shells trail behind as a shield until it is let go). */
export type Input = { steer: number; brake: boolean; drift: boolean; hop: boolean; use: boolean; back: boolean; fwd: boolean; hold: boolean; slam: boolean; cash: boolean };
export type Hat = 'cap' | 'tree' | 'top' | 'bow' | 'tower' | 'axe' | 'dish' | 'claw';
export const HATS: Hat[] = ['cap', 'tree', 'top', 'bow', 'tower', 'axe', 'dish', 'claw'];
export type Ai = { pace: number; skill: number; band: number; lane: number; laneTo: number; laneT: number; itemT: number; held: number; driftT: number };
/** What the network last said about a remote kart. */
export type NetState = { x: number; z: number; h: number; v: number; prog: number; done: number | null; flags: number; at: number };

export type Kart = {
  idx: number;
  name: string;
  color: string;
  hat: Hat;
  kind: 'player' | 'cpu' | 'remote';
  seat: number;
  x: number;
  z: number;
  h: number;
  v: number;
  kx: number;
  kz: number;
  y: number;
  vy: number;
  steer: number;
  i: number;
  s: number;
  d: number;
  prog: number;
  lap: number;
  lapAt: number;
  laps: number[];
  done: number | null;
  place: number;
  drift: -1 | 0 | 1;
  charge: number;
  hopDir: number;
  boost: number;
  star: number;
  shrink: number;
  spin: number;
  tumble: number;
  squash: number;
  safe: number;
  dashCool: number;
  /** Slam: cooldown, the window it can still land in, and which side (1 right, -1 left). */
  slamCool: number;
  slamT: number;
  /** This slam already landed on someone. */
  slamHit: boolean;
  slamSide: number;
  /** Knocked off line by a slam: less grip and speed for a moment. */
  wobble: number;
  /** Slipstream charge, 0 to 1. */
  draft: number;
  /** A banana or shell held out behind as a shield. */
  trail: boolean;
  /** Off a ramp: airborne, the window to press for a trick, and whether one was pulled. */
  air: boolean;
  trickT: number;
  trick: boolean;
  rampCool: number;
  coins: number;
  /** Coins picked up (or stolen) this race, whatever happened to them after; they go in your bank. */
  earned: number;
  item: Item | null;
  uses: number;
  roll: number;
  offroad: boolean;
  wrong: number;
  stuck: number;
  gas: number | null;
  input: Input;
  ai: Ai | null;
  /** The finished player hands the wheel to the CPU driver. */
  auto: boolean;
  net: NetState | null;
};

export type Thing = {
  id: number;
  kind: ThingKind;
  owner: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  i: number;
  life: number;
  bounces: number;
  grace: number;
  target: number;
  /** Blue shells fly along the loop; this is how far along. */
  prog: number;
  /** Spawned by this client (online, other clients learn about it from us). */
  local: boolean;
};

export type Box = { x: number; z: number; s: number; t: number };
export type Coin = { x: number; z: number; t: number };
export type Dash = { x: number; z: number; s: number; d: number; h: number };
export type Ramp = { x: number; z: number; s: number; d: number; w: number; h: number };

export type Ev =
  | { t: 'beep'; n: number }
  | { t: 'go' }
  | { t: 'rocket'; k: number }
  | { t: 'box'; k: number }
  | { t: 'got'; k: number; item: Item }
  | { t: 'use'; k: number; item: Item }
  | { t: 'spawn'; thing: Thing }
  | { t: 'gone'; id: number; x: number; z: number; local: boolean }
  | { t: 'hit'; k: number; how: HitHow; by: number }
  | { t: 'bump'; k: number; power: number }
  | { t: 'wall'; k: number; power: number }
  | { t: 'coin'; k: number }
  | { t: 'cash'; k: number }
  | { t: 'turbo'; k: number; level: number }
  | { t: 'dash'; k: number }
  | { t: 'bolt'; k: number }
  | { t: 'boom'; x: number; z: number }
  | { t: 'lap'; k: number; lap: number }
  | { t: 'finish'; k: number }
  | { t: 'slam'; k: number }
  | { t: 'slammed'; k: number; by: number; x: number; z: number; coin: boolean }
  | { t: 'draft'; k: number }
  | { t: 'block'; k: number; x: number; z: number }
  | { t: 'ramp'; k: number }
  | { t: 'trick'; k: number };

export type Rng = () => number;

export type Race = {
  track: Track;
  lay: Layout;
  cc: Cc;
  laps: number;
  time: number;
  karts: Kart[];
  things: Thing[];
  boxes: Box[];
  coins: Coin[];
  dashes: Dash[];
  ramps: Ramp[];
  rand: Rng;
  nextId: number;
  events: Ev[];
  /** The kart this client drives. */
  me: number;
  /** Race time of the first finish, from any kart. */
  first: number | null;
  /** Race time the last lightning struck, so two never land back to back. */
  boltAt: number;
};

export type Racer = { name: string; color: string; kind: Kart['kind']; seat?: number; pace?: number; skill?: number; hat?: Hat };

/** The CPU field, quickest first. */
export const RIVALS: Racer[] = [
  { name: 'Tree', color: '#3fae4a', kind: 'cpu', pace: 1, skill: 0.95, hat: 'tree' },
  { name: 'Leland', color: '#1e88e5', kind: 'cpu', pace: 0.99, skill: 0.8, hat: 'top' },
  { name: 'Jane', color: '#ec407a', kind: 'cpu', pace: 0.98, skill: 0.7, hat: 'bow' },
  { name: 'Hoover', color: '#fb8c00', kind: 'cpu', pace: 0.97, skill: 0.6, hat: 'tower' },
  { name: 'Axe', color: '#fdd835', kind: 'cpu', pace: 0.96, skill: 0.5, hat: 'axe' },
  { name: 'Dish', color: '#00acc1', kind: 'cpu', pace: 0.95, skill: 0.4, hat: 'dish' },
  { name: 'Claw', color: '#8e24aa', kind: 'cpu', pace: 0.94, skill: 0.3, hat: 'claw' },
];
export const PLAYER_COLOR = '#e53935';

/** Small deterministic generator (mulberry32). */
export function rng32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const approach = (a: number, b: number, step: number) => (a < b ? Math.min(b, a + step) : Math.max(b, a - step));
const noInput = (): Input => ({ steer: 0, brake: false, drift: false, hop: false, use: false, back: false, fwd: false, hold: false, slam: false, cash: false });

let sharedTrack: Track | null = null;
/** The circuit is the same for every race; build it once. */
export const theTrack = () => (sharedTrack ??= buildTrack());

export function createRace(opts: { cc: Cc; racers: Racer[]; seed?: number; countdown?: number; laps?: number; idBase?: number; me?: number }): Race {
  const track = theTrack();
  const lay = layout(track);
  const seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const rand = rng32(seed);
  const karts = opts.racers.map((rc, idx): Kart => {
    const g = gridSpot(track, idx);
    const at = locate(track, g.x, g.z);
    const cpu = rc.kind === 'cpu';
    return {
      idx,
      name: rc.name,
      color: rc.color,
      hat: rc.hat ?? 'cap',
      kind: rc.kind,
      seat: rc.seat ?? -1,
      x: g.x,
      z: g.z,
      h: g.h,
      v: 0,
      kx: 0,
      kz: 0,
      y: 0,
      vy: 0,
      steer: 0,
      i: at.i,
      s: at.s,
      d: at.d,
      prog: deltaS(track, 0, at.s),
      lap: 1,
      lapAt: 0,
      laps: [],
      done: null,
      place: idx + 1,
      drift: 0,
      charge: 0,
      hopDir: 0,
      boost: 0,
      star: 0,
      shrink: 0,
      spin: 0,
      tumble: 0,
      squash: 0,
      safe: 0,
      dashCool: 0,
      slamCool: 0,
      slamT: 0,
      slamHit: false,
      slamSide: 0,
      wobble: 0,
      draft: 0,
      trail: false,
      air: false,
      trickT: 0,
      trick: false,
      rampCool: 0,
      coins: 0,
      earned: 0,
      item: null,
      uses: 0,
      roll: 0,
      offroad: false,
      wrong: 0,
      stuck: 0,
      gas: null,
      input: noInput(),
      ai: cpu ? newAi(rc.pace ?? 0.95, rc.skill ?? 0.5, rand) : null,
      auto: false,
      net: null,
    };
  });
  const boxes = lay.boxes.map((b) => {
    const p = pointAt(track, b.s, b.d);
    return { x: p.x, z: p.z, s: b.s, t: 0 };
  });
  const coins = lay.coins.map((c) => {
    const p = pointAt(track, c.s, c.d);
    return { x: p.x, z: p.z, t: 0 };
  });
  const dashes = lay.dashes.map((c) => {
    const p = pointAt(track, c.s, c.d);
    return { x: p.x, z: p.z, s: c.s, d: c.d, h: headingOf(p.tx, p.tz) };
  });
  const ramps = lay.ramps.map((c) => {
    const p = pointAt(track, c.s, c.d);
    return { x: p.x, z: p.z, s: c.s, d: c.d, w: c.w, h: headingOf(p.tx, p.tz) };
  });
  const race: Race = {
    track,
    lay,
    cc: opts.cc,
    laps: opts.laps ?? LAPS,
    time: -(opts.countdown ?? COUNTDOWN + 0.4),
    karts,
    things: [],
    boxes,
    coins,
    dashes,
    ramps,
    rand,
    nextId: opts.idBase ?? 1,
    events: [],
    me: opts.me ?? karts.findIndex((k) => k.kind === 'player'),
    first: null,
    boltAt: -99,
  };
  rankKarts(race);
  return race;
}

function newAi(pace: number, skill: number, rand: Rng): Ai {
  return { pace, skill, band: 1, lane: (rand() - 0.5) * 0.8, laneTo: 0, laneT: rand() * 2, itemT: 1 + rand() * 2, held: 0, driftT: 0 };
}

/** A solo Grand Prix: seven CPU rivals ahead of you on the grid, like the first race of a cup. */
export function soloRace(cc: Cc, seed?: number, look: { color: string; hat: Hat } = { color: PLAYER_COLOR, hat: 'cap' }) {
  return createRace({ cc, seed, racers: [...RIVALS, { name: 'you', color: look.color, kind: 'player', hat: look.hat }] });
}

export const racing = (r: Race) => r.time >= 0;
const scaleOf = (k: Kart) => (k.shrink > 0 ? 0.62 : 1);
export const hurt = (k: Kart) => k.spin > 0 || k.tumble > 0;
const local = (k: Kart) => k.kind !== 'remote';

export function step(r: Race, dt: number) {
  const before = r.time;
  r.time += dt;
  if (r.time < 0) {
    const n = Math.ceil(-r.time);
    if (n !== Math.ceil(-before) && n <= COUNTDOWN) r.events.push({ t: 'beep', n });
    for (const k of r.karts) {
      if (k.kind === 'remote') glide(r, k, dt);
      // presses during the lights do nothing (gas goes through pressGas)
      k.input.use = false;
      k.input.hop = false;
      k.input.slam = false;
      k.input.cash = false;
    }
    return;
  }
  if (before < 0) {
    r.events.push({ t: 'go' });
    for (const k of r.karts) {
      if (!local(k)) continue;
      const early = k.ai ? (r.rand() < k.ai.skill * 0.6 ? -0.4 : null) : k.gas;
      if (early !== null && early >= -0.8 && early <= -0.15) {
        k.boost = ROCKET_T;
        k.v = 9;
        r.events.push({ t: 'rocket', k: k.idx });
      }
    }
  }

  for (const k of r.karts) {
    if (k.kind === 'remote') {
      glide(r, k, dt);
      continue;
    }
    if (k.ai || k.auto) think(r, k, dt);
    drive(r, k, dt);
    if (k.input.use) useItem(r, k);
    k.input.use = false;
    k.input.hop = false;
    k.input.slam = false;
    k.input.cash = false;
  }
  bumpKarts(r);
  moveThings(r, dt);
  hitThings(r);
  pickups(r, dt);
  for (const k of r.karts) if (local(k)) progress(r, k, dt);
  rankKarts(r);
}

/** Where a remote kart probably is now: its last report carried forward, eased so corrections never jump. */
function glide(r: Race, k: Kart, dt: number) {
  const n = k.net;
  if (!n) return;
  const age = clamp(r.time - n.at, 0, 0.35);
  const px = n.x + Math.sin(n.h) * n.v * age;
  const pz = n.z + Math.cos(n.h) * n.v * age;
  if (Math.hypot(px - k.x, pz - k.z) > 8) {
    k.x = px;
    k.z = pz;
  } else {
    const w = 1 - Math.exp(-14 * dt);
    k.x += (px - k.x) * w;
    k.z += (pz - k.z) * w;
  }
  const turn = wrapAngle(n.h - k.h) * (1 - Math.exp(-14 * dt));
  k.h = wrapAngle(k.h + turn);
  // lean and turn the front wheels the way the kart is turning
  if (dt > 0) k.steer = approach(k.steer, clamp(-turn / dt / 1.6, -1, 1), 6 * dt);
  k.v = n.v;
  k.prog = n.prog + n.v * age;
  k.done = n.done;
  const at = locate(r.track, k.x, k.z, k.i);
  k.i = at.i;
  k.s = at.s;
  k.d = at.d;
  k.lap = clamp(Math.floor(k.prog / r.track.length) + 1, 1, r.laps);
}

function drive(r: Race, k: Kart, dt: number) {
  const C = CLASSES[r.cc];
  const inp = k.input;
  for (const key of ['boost', 'star', 'shrink', 'spin', 'tumble', 'squash', 'safe', 'dashCool', 'slamCool', 'slamT', 'wobble', 'rampCool', 'trickT'] as const) k[key] = Math.max(0, k[key] - dt);
  if (k.roll > 0) {
    k.roll = Math.max(0, k.roll - dt);
    if (k.roll === 0 && k.item) r.events.push({ t: 'got', k: k.idx, item: k.item });
  }
  const control = !hurt(k);
  if (!control) {
    k.drift = 0;
    k.charge = 0;
  }
  const want = control ? clamp(inp.steer, -1, 1) * (k.wobble > 0 ? 0.3 : 1) : 0;
  k.steer = approach(k.steer, want, (want === 0 ? 9 : 6) * dt);
  k.trail = control && inp.hold && k.roll === 0 && (k.item === 'banana' || k.item === 'green' || k.item === 'red');

  let top = C.top * (k.ai ? k.ai.pace * k.ai.band * C.cpu : 1) + coinTop(k.coins);
  if (k.shrink > 0) top *= 0.72;
  if (k.star > 0) top += STAR_DV;
  if (k.boost > 0) top += BOOST_DV;
  else if (k.offroad && k.star <= 0) top *= OFFROAD;
  if (k.drift) top *= 0.985;
  if (k.wobble > 0) top *= 0.85;
  if (!control) k.v = approach(k.v, 0, (k.tumble > 0 ? 30 : 14) * dt);
  else if (inp.brake) k.v = k.v > 0.5 ? Math.max(0, k.v - 26 * dt) : Math.max(-REVERSE, k.v - 9 * dt);
  else if (k.v < top) k.v = Math.min(top, k.v + (k.boost > 0 ? 34 : k.v < 0 ? 20 : C.accel) * dt);
  else k.v = Math.max(top, k.v - (k.offroad && k.boost <= 0 ? 24 : 8) * dt);

  if (inp.slam && control && k.y === 0 && k.slamCool === 0 && k.v > 3) slamStart(r, k);
  if (inp.cash && control && k.coins >= CASH_COST) {
    k.coins -= CASH_COST;
    k.boost = Math.max(k.boost, CASH_T);
    r.events.push({ t: 'cash', k: k.idx });
  }

  // hop, then drift in the direction you were steering (or, off a ramp, a trick)
  const sp = Math.abs(k.v);
  if (inp.hop && k.air && k.trickT > 0 && !k.trick) {
    k.trick = true;
    r.events.push({ t: 'trick', k: k.idx });
  }
  if (inp.hop && control && k.y === 0 && k.v > 8) {
    k.vy = HOP_V;
    k.hopDir = Math.abs(k.steer) > 0.3 || Math.abs(inp.steer) > 0.3 ? Math.sign(inp.steer || k.steer) : 0;
  }
  if (k.y > 0 || k.vy > 0) {
    k.y += k.vy * dt;
    k.vy -= GRAVITY * dt;
    if (k.hopDir === 0 && Math.abs(inp.steer) > 0.3) k.hopDir = Math.sign(inp.steer);
    if (k.y <= 0) {
      k.y = 0;
      k.vy = 0;
      if (k.air) {
        k.air = false;
        if (k.trick && control) {
          k.boost = Math.max(k.boost, TRICK_T);
          r.events.push({ t: 'turbo', k: k.idx, level: 1 });
        }
        k.trick = false;
      }
      if (control && inp.drift && k.hopDir !== 0 && k.v > 8 && k.drift === 0) {
        k.drift = k.hopDir as -1 | 1;
        k.charge = 0;
      }
      k.hopDir = 0;
    }
  }
  if (k.drift !== 0) {
    if (!inp.drift || !control || k.v < 7) {
      const level = turboLevel(k.charge);
      if (inp.drift === false && control && level > 0) {
        k.boost = Math.max(k.boost, TURBO_T[level]);
        r.events.push({ t: 'turbo', k: k.idx, level });
      }
      k.drift = 0;
      k.charge = 0;
    } else {
      k.charge += dt * (0.7 + 0.8 * Math.max(0, k.steer * k.drift)) * (k.offroad ? 0.4 : 1);
    }
  }

  let rate: number;
  if (k.drift !== 0) rate = k.drift * (DRIFT_BASE + DRIFT_RANGE * k.steer * k.drift);
  else rate = k.steer * TURN * Math.min(1, sp / 5) * (1 - 0.3 * Math.min(1, sp / 30));
  if (k.v < 0) rate = -rate;
  if (k.spin > 0) rate = 0;
  k.h = wrapAngle(k.h - rate * dt);

  k.x += (Math.sin(k.h) * k.v + k.kx) * dt;
  k.z += (Math.cos(k.h) * k.v + k.kz) * dt;
  const decay = Math.exp(-5 * dt);
  k.kx *= decay;
  k.kz *= decay;
  wall(r, k);
  rideRamps(r, k);
  slipstream(r, k, dt, control);
  k.stuck = control && r.time > 1 && Math.abs(k.v) < 1.5 && !inp.brake && k.done === null ? k.stuck + dt : 0;
  if (k.stuck > 2.5) rescue(r, k);
}

export const turboLevel = (charge: number) => (charge >= TURBO_AT[3] ? 3 : charge >= TURBO_AT[2] ? 2 : charge >= TURBO_AT[1] ? 1 : 0);

const rightOf = (k: Kart) => ({ rx: -Math.cos(k.h), rz: Math.sin(k.h) });

/** Starts a slam: a sideways hop toward the kart beside you (or the way you are steering). */
function slamStart(r: Race, k: Kart) {
  const { rx, rz } = rightOf(k);
  const fx = Math.sin(k.h);
  const fz = Math.cos(k.h);
  let side = Math.sign(k.input.steer);
  let nearest = 5;
  for (const o of r.karts) {
    if (o === k || o.done !== null) continue;
    const dx = o.x - k.x;
    const dz = o.z - k.z;
    const across = dx * rx + dz * rz;
    if (Math.abs(dx * fx + dz * fz) < 3.2 && Math.abs(across) < nearest) {
      nearest = Math.abs(across);
      side = Math.sign(across) || 1;
    }
  }
  if (side === 0) side = k.d > 0 ? -1 : 1;
  k.kx += rx * side * SLAM_DASH;
  k.kz += rz * side * SLAM_DASH;
  k.vy = Math.max(k.vy, 3.4);
  k.y = Math.max(k.y, 0.01);
  k.hopDir = 0;
  k.slamT = SLAM_T;
  k.slamHit = false;
  k.slamSide = side;
  k.slamCool = SLAM_COOL;
  r.events.push({ t: 'slam', k: k.idx });
}

/**
 * A slam lands: the kart beside you is shoved away, wobbles and drops a coin, which you pocket. Each client only
 * knocks the karts it drives; when the victim is someone else's kart online, its own client decides and says so
 * (net 'stole'), and the coin comes then through stolen().
 */
function slamLand(r: Race, S: Kart, V: Kart, nx: number, nz: number) {
  S.slamHit = true;
  if (local(S)) {
    S.kx *= 0.3;
    S.kz *= 0.3;
  }
  if (V.star > 0 || V.wobble > 0 || V.done !== null) return;
  let coin = false;
  if (local(V)) {
    V.kx += nx * SLAM_KNOCK;
    V.kz += nz * SLAM_KNOCK;
    V.wobble = WOBBLE_T;
    V.v *= 0.78;
    V.drift = 0;
    V.charge = 0;
    coin = V.coins > 0;
    if (coin) V.coins--;
    if (coin && local(S)) {
      S.coins = Math.min(MAX_COINS, S.coins + 1);
      S.earned++;
    }
  }
  r.events.push({ t: 'slammed', k: V.idx, by: S.idx, x: (S.x + V.x) / 2, z: (S.z + V.z) / 2, coin });
}

/** The coin from a slam on someone else's kart, once its owner says it landed. */
export function stolen(r: Race, k: Kart) {
  if (k.done !== null) return;
  k.coins = Math.min(MAX_COINS, k.coins + 1);
  k.earned++;
  r.events.push({ t: 'coin', k: k.idx });
}

/** Tuck in behind another kart for a moment and its slipstream slings you past. */
function slipstream(r: Race, k: Kart, dt: number, control: boolean) {
  let tucked = false;
  if (control && k.v > 14 && k.boost <= 0 && k.y === 0) {
    const fx = Math.sin(k.h);
    const fz = Math.cos(k.h);
    const { rx, rz } = rightOf(k);
    for (const o of r.karts) {
      if (o === k || o.v < 10) continue;
      const dx = o.x - k.x;
      const dz = o.z - k.z;
      const along = dx * fx + dz * fz;
      if (along > 3 && along < 16 && Math.abs(dx * rx + dz * rz) < 1.7) {
        tucked = true;
        break;
      }
    }
  }
  k.draft = tucked ? k.draft + dt / DRAFT_T : Math.max(0, k.draft - dt * 1.5);
  if (k.draft >= 1) {
    k.draft = 0;
    k.boost = Math.max(k.boost, DRAFT_BOOST);
    r.events.push({ t: 'draft', k: k.idx });
  }
}

/** Where a kart is on a ramp: how far before the lip (negative) and the height there, or null. */
export function onRamp(r: Race, k: { s: number; d: number }) {
  for (const ramp of r.ramps) {
    const ds = deltaS(r.track, ramp.s, k.s);
    if (ds < -RAMP_LEN || ds > 0.6 || Math.abs(k.d - ramp.d) > ramp.w / 2) continue;
    return { ramp, ds, height: RAMP_H * Math.min(1, (ds + RAMP_LEN) / RAMP_LEN) };
  }
  return null;
}

/** Drive up a ramp's wedge and fly off the lip; press drift in the air for a trick. */
function rideRamps(r: Race, k: Kart) {
  const at = locate(r.track, k.x, k.z, k.i);
  const on = onRamp(r, { s: at.s, d: at.d });
  if (!on || k.v < 2) return;
  if (on.ds > -0.35 && k.rampCool <= 0 && k.v > 8 && k.vy <= 0) {
    k.vy = 5.5 + k.v * 0.13;
    k.y = Math.max(k.y, on.height);
    k.air = true;
    k.trickT = 0.5;
    k.trick = false;
    k.rampCool = 1.2;
    k.hopDir = 0;
    r.events.push({ t: 'ramp', k: k.idx });
  } else if (k.vy <= 0 && k.y <= on.height + 0.05) {
    k.y = on.height;
    k.vy = 0;
  }
}

/** Keeps a kart inside the walls: slides it along them and takes speed for a head-on hit. */
function wall(r: Race, k: Kart) {
  const at = locate(r.track, k.x, k.z, k.i);
  k.i = at.i;
  const lim = EDGE - KART_R * scaleOf(k);
  if (Math.abs(at.d) > lim) {
    const sg = Math.sign(at.d);
    const nx = -at.tz * sg;
    const nz = at.tx * sg;
    const over = Math.abs(at.d) - lim;
    k.x -= nx * over;
    k.z -= nz * over;
    const vx = Math.sin(k.h) * k.v + k.kx;
    const vz = Math.cos(k.h) * k.v + k.kz;
    const into = vx * nx + vz * nz;
    if (into > 0) {
      k.kx -= nx * into * 1.35;
      k.kz -= nz * into * 1.35;
      const hit = into / (Math.hypot(vx, vz) || 1);
      k.v *= 1 - 0.55 * hit;
      const along = Math.sign(Math.sin(k.h) * at.tx + Math.cos(k.h) * at.tz) || 1;
      k.h = wrapAngle(k.h + wrapAngle(headingOf(at.tx * along, at.tz * along) - k.h) * Math.min(1, hit * 0.7));
      if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
    }
  }
  const now = locate(r.track, k.x, k.z, k.i);
  k.i = now.i;
  k.d = now.d;
  k.offroad = Math.abs(now.d) > ROAD_HALF + CURB * 0.6;
}

/** Puts a kart that is stuck (or lost) back on the road, facing the right way. */
export function rescue(r: Race, k: Kart) {
  const p = pointAt(r.track, k.s, clamp(k.d, -4, 4));
  k.x = p.x;
  k.z = p.z;
  k.h = headingOf(p.tx, p.tz);
  k.v = 0;
  k.kx = 0;
  k.kz = 0;
  k.drift = 0;
  k.charge = 0;
  k.stuck = 0;
  k.safe = Math.max(k.safe, 1.5);
}

function progress(r: Race, k: Kart, dt: number) {
  const t = r.track;
  const at = locate(t, k.x, k.z, k.i);
  k.i = at.i;
  k.prog += deltaS(t, k.s, at.s);
  k.s = at.s;
  k.d = at.d;
  const fwd = Math.sin(k.h) * at.tx + Math.cos(k.h) * at.tz;
  k.wrong = fwd < -0.2 && k.v > 2 && k.done === null ? k.wrong + dt : 0;
  if (k.done !== null) return;
  const lapNow = Math.floor(k.prog / t.length) + 1;
  if (lapNow > k.lap && lapNow <= r.laps) {
    k.laps.push(r.time - k.lapAt);
    k.lapAt = r.time;
    k.lap = lapNow;
    r.events.push({ t: 'lap', k: k.idx, lap: lapNow });
  }
  if (k.prog >= r.laps * t.length) {
    const over = (k.prog - r.laps * t.length) / Math.max(1, Math.abs(k.v));
    k.done = Math.max(0, r.time - over);
    k.laps.push(k.done - k.lapAt);
    r.first = r.first === null ? k.done : Math.min(r.first, k.done);
    r.events.push({ t: 'finish', k: k.idx });
    if (k.kind === 'player') k.auto = true;
  }
}

/** Places: finishers by time, then everyone else by distance covered. */
export function rankKarts(r: Race) {
  const order = [...r.karts].sort((a, b) => {
    if (a.done !== null && b.done !== null) return a.done - b.done;
    if (a.done !== null) return -1;
    if (b.done !== null) return 1;
    return b.prog - a.prog;
  });
  order.forEach((k, i) => (k.place = i + 1));
  if (r.first === null) for (const k of r.karts) if (k.done !== null) r.first = r.first === null ? k.done : Math.min(r.first, k.done);
  return order;
}

/** Final order with a time for everyone; karts still racing get an estimate from their pace so far. */
export function standings(r: Race) {
  const total = r.laps * r.track.length;
  return rankKarts(r)
    .map((k) => {
      if (k.done !== null) return { k, time: k.done, estimated: false };
      const pace = Math.max(6, k.prog / Math.max(1, r.time));
      return { k, time: r.time + Math.max(0, total - k.prog) / pace, estimated: true };
    })
    .sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------------------------------------------
// Karts touching karts

const massOf = (k: Kart) => (k.star > 0 ? 4 : k.shrink > 0 ? 0.4 : 1);

const slamPad = (S: Kart, V: Kart) => (!local(S) && local(V) ? SLAM_PAD : 0);

function bumpKarts(r: Race) {
  const ks = r.karts;
  for (let a = 0; a < ks.length; a++) {
    for (let b = a + 1; b < ks.length; b++) {
      const A = ks[a];
      const B = ks[b];
      if (!local(A) && !local(B)) continue;
      if (A.done !== null && B.done !== null) continue;
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const reach = KART_R * (scaleOf(A) + scaleOf(B));
      const dist = Math.hypot(dx, dz);
      if (dist >= reach + SLAM_PAD || dist < 1e-6) continue;
      if (Math.abs(A.y - B.y) > 1.2) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      if (A.slamT > 0 && !A.slamHit && B.slamT <= 0 && dist < reach + slamPad(A, B)) slamLand(r, A, B, nx, nz);
      else if (B.slamT > 0 && !B.slamHit && A.slamT <= 0 && dist < reach + slamPad(B, A)) slamLand(r, B, A, -nx, -nz);
      if (dist >= reach) continue;
      // stars flatten whoever they touch; a full-size kart squashes a shrunken one
      if (A.star > 0 && B.star <= 0 && local(B)) hitKart(r, B, 'tumble', A.idx);
      else if (B.star > 0 && A.star <= 0 && local(A)) hitKart(r, A, 'tumble', B.idx);
      else if (A.shrink > 0 && B.shrink <= 0 && local(A)) hitKart(r, A, 'squash', B.idx);
      else if (B.shrink > 0 && A.shrink <= 0 && local(B)) hitKart(r, B, 'squash', A.idx);
      const ma = massOf(A);
      const mb = massOf(B);
      const shareA = !local(A) ? 0 : !local(B) ? 1 : mb / (ma + mb);
      const shareB = 1 - shareA;
      const over = reach - dist;
      A.x -= nx * over * shareA;
      A.z -= nz * over * shareA;
      B.x += nx * over * shareB;
      B.z += nz * over * shareB;
      const rel = (Math.sin(A.h) * A.v + A.kx - Math.sin(B.h) * B.v - B.kx) * nx + (Math.cos(A.h) * A.v + A.kz - Math.cos(B.h) * B.v - B.kz) * nz;
      if (rel > 0) {
        const j = rel * 0.9 + 2;
        A.kx -= nx * j * shareA * 1.6;
        A.kz -= nz * j * shareA * 1.6;
        B.kx += nx * j * shareB * 1.6;
        B.kz += nz * j * shareB * 1.6;
        if (rel > 3) {
          if (local(A)) r.events.push({ t: 'bump', k: A.idx, power: rel });
          if (local(B)) r.events.push({ t: 'bump', k: B.idx, power: rel });
        }
      }
    }
  }
}

/** Hits a kart this client simulates. Stars shrug everything off; a kart already reeling is not hit twice. */
export function hitKart(r: Race, k: Kart, how: HitHow, by: number) {
  if (!local(k) || k.star > 0 || k.done !== null) return false;
  if (how !== 'boom' && (hurt(k) || k.safe > 0)) return false;
  k.drift = 0;
  k.charge = 0;
  k.boost = 0;
  k.wobble = 0;
  if (k.trail) {
    // a banana or shell held out behind is lost in the crash
    k.trail = false;
    k.item = null;
    k.uses = 0;
  }
  if (how === 'spin' || how === 'squash') {
    k.spin = how === 'squash' ? 0.8 : 1.05;
    k.v *= how === 'squash' ? 0.5 : 0.4;
    k.coins = Math.max(0, k.coins - 1);
    if (how === 'squash') k.squash = 1.6;
  } else {
    k.tumble = how === 'boom' ? 1.8 : 1.3;
    k.vy = how === 'boom' ? 9 : 6.5;
    k.y = Math.max(k.y, 0.01);
    k.v *= 0.15;
    k.coins = Math.max(0, k.coins - 3);
  }
  k.safe = (how === 'spin' ? 1.05 : how === 'squash' ? 0.8 : how === 'boom' ? 1.8 : 1.3) + 0.7;
  r.events.push({ t: 'hit', k: k.idx, how, by });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Items

/** Item odds by how far back you are: leaders get defense, the back of the pack gets the big guns. */
const ODDS: [number, Partial<Record<Item, number>>][] = [
  [0.15, { banana: 40, green: 40, red: 12, mushroom: 8 }],
  [0.45, { banana: 15, green: 25, red: 30, mushroom: 22, triple: 8 }],
  [0.75, { green: 10, red: 30, mushroom: 22, triple: 22, star: 8, bolt: 3, blue: 5 }],
  [1.01, { red: 18, mushroom: 10, triple: 26, star: 26, bolt: 12, blue: 8 }],
];

export function rollItem(r: Race, k: Kart): Item {
  const frac = r.karts.length > 1 ? (k.place - 1) / (r.karts.length - 1) : 0;
  const table = { ...ODDS.find(([upTo]) => frac < upTo)![1] };
  // only one blue shell at a time and no lightning twice in a row
  if (r.things.some((t) => t.kind === 'blue')) delete table.blue;
  if (r.time - r.boltAt < 12) delete table.bolt;
  const entries = Object.entries(table) as [Item, number][];
  let pick = r.rand() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [item, w] of entries) {
    pick -= w;
    if (pick < 0) return item;
  }
  return entries[0][0];
}

export function giveItem(r: Race, k: Kart, item: Item, roll = ROLL_T) {
  k.item = item;
  k.uses = item === 'triple' ? 3 : 1;
  k.roll = roll;
  if (roll === 0) r.events.push({ t: 'got', k: k.idx, item });
}

const fwdOf = (k: Kart) => ({ fx: Math.sin(k.h), fz: Math.cos(k.h) });

export function spawn(r: Race, thing: Omit<Thing, 'id' | 'i' | 'life' | 'bounces' | 'local'> & { id?: number; life?: number }, isLocal = true): Thing {
  const t: Thing = {
    i: locate(r.track, thing.x, thing.z).i,
    bounces: 0,
    local: isLocal,
    ...thing,
    id: thing.id ?? r.nextId++,
    life: thing.life ?? (thing.kind === 'banana' ? Infinity : thing.kind === 'green' ? 7 : thing.kind === 'red' ? 10 : 25),
  };
  r.things.push(t);
  if (r.things.length > 40) {
    const old = r.things.findIndex((x) => x.kind !== 'blue');
    if (old >= 0) removeThing(r, r.things[old].id, false);
  }
  r.events.push({ t: 'spawn', thing: t });
  return t;
}

/** Uses the held item. Bananas drop behind unless thrown forward; shells fly ahead unless thrown back. */
export function useItem(r: Race, k: Kart): Item | null {
  const item = k.item;
  if (!item || k.roll > 0 || hurt(k) || r.time < 0) return null;
  const { fx, fz } = fwdOf(k);
  const back = k.input.back;
  const base = { owner: k.idx, y: 0, vy: 0, grace: 0.6, target: -1, prog: 0 };
  if (item === 'banana') {
    if (k.input.fwd && !back) spawn(r, { ...base, kind: 'banana', grace: 1.2, x: k.x + fx * 2.6, z: k.z + fz * 2.6, y: 0.8, vx: fx * 20 + Math.sin(k.h) * k.v * 0.5, vz: fz * 20 + Math.cos(k.h) * k.v * 0.5, vy: 7 });
    else spawn(r, { ...base, kind: 'banana', x: k.x - fx * 2.5, z: k.z - fz * 2.5, vx: 0, vz: 0 });
  } else if (item === 'green' || (item === 'red' && back)) {
    const dir = back ? -1 : 1;
    spawn(r, { ...base, kind: 'green', x: k.x + fx * 2.6 * dir, z: k.z + fz * 2.6 * dir, y: 0.35, vx: fx * GREEN_V * dir, vz: fz * GREEN_V * dir });
  } else if (item === 'red') {
    const ahead = r.karts.find((o) => o.place === k.place - 1 && o.done === null);
    spawn(r, { ...base, kind: 'red', x: k.x + fx * 2.6, z: k.z + fz * 2.6, y: 0.35, vx: fx * RED_V, vz: fz * RED_V, target: ahead ? ahead.idx : -1 });
  } else if (item === 'mushroom' || item === 'triple') {
    k.boost = Math.max(k.boost, MUSHROOM_T);
    k.v = Math.max(k.v, CLASSES[r.cc].top * 0.9);
  } else if (item === 'star') {
    k.star = STAR_T;
  } else if (item === 'bolt') {
    r.boltAt = r.time;
    strike(r, k.idx);
  } else if (item === 'blue') {
    // fired from the front it has to come all the way around
    const lap = leaderFor(r) === k ? r.track.length : 0;
    spawn(r, { ...base, kind: 'blue', x: k.x, z: k.z, y: 3, vx: 0, vz: 0, prog: k.prog + 3 - lap });
  }
  k.uses--;
  if (k.uses <= 0) {
    k.item = null;
    k.uses = 0;
  }
  r.events.push({ t: 'use', k: k.idx, item });
  if (item === 'bolt') r.events.push({ t: 'bolt', k: k.idx });
  return item;
}

/** Lightning: everyone but the user (and anyone under a star) spins, shrinks and drops their item. */
export function strike(r: Race, from: number) {
  for (const o of r.karts) {
    if (o.idx === from || !local(o) || o.star > 0 || o.done !== null) continue;
    o.shrink = SHRINK_T * (o.place <= 3 ? 1.2 : 0.8);
    o.spin = Math.max(o.spin, 0.6);
    o.v *= 0.5;
    o.drift = 0;
    o.charge = 0;
    o.item = null;
    o.uses = 0;
    o.roll = 0;
    r.events.push({ t: 'hit', k: o.idx, how: 'spin', by: from });
  }
}

export function removeThing(r: Race, id: number, announce = true) {
  const i = r.things.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = r.things.splice(i, 1);
  r.events.push({ t: 'gone', id, x: t.x, z: t.z, local: announce });
}

/** A blue shell explodes: everyone this client drives within reach is blown up. */
export function boom(r: Race, x: number, z: number, by: number) {
  for (const k of r.karts) if (Math.hypot(k.x - x, k.z - z) < BOOM_R) hitKart(r, k, 'boom', by);
  for (const t of [...r.things]) if (t.kind !== 'blue' && Math.hypot(t.x - x, t.z - z) < BOOM_R) removeThing(r, t.id, false);
}

function leaderFor(r: Race) {
  let best: Kart | null = null;
  for (const k of r.karts) if (k.done === null && (!best || k.prog > best.prog)) best = k;
  return best;
}

function moveThings(r: Race, dt: number) {
  const t = r.track;
  for (const th of [...r.things]) {
    th.life -= dt;
    th.grace -= dt;
    if (th.life <= 0) {
      removeThing(r, th.id, th.local);
      continue;
    }
    if (th.kind === 'banana') {
      if (th.y > 0 || th.vy !== 0) {
        th.x += th.vx * dt;
        th.z += th.vz * dt;
        th.vy -= GRAVITY * dt;
        th.y += th.vy * dt;
        if (th.y <= 0) {
          th.y = 0;
          th.vy = 0;
          th.vx = 0;
          th.vz = 0;
        }
      }
      const at = locate(t, th.x, th.z, th.i);
      th.i = at.i;
      if (Math.abs(at.d) > EDGE - 0.6) {
        const sg = Math.sign(at.d);
        th.x -= -at.tz * sg * (Math.abs(at.d) - EDGE + 0.6);
        th.z -= at.tx * sg * (Math.abs(at.d) - EDGE + 0.6);
      }
      continue;
    }
    if (th.kind === 'blue') {
      const lead = leaderFor(r);
      if (!lead) {
        removeThing(r, th.id, th.local);
        continue;
      }
      th.target = lead.idx;
      const gap = lead.prog - th.prog;
      if (gap > 24) {
        th.prog += BLUE_V * dt;
        const p = pointAt(t, th.prog);
        th.x = p.x;
        th.z = p.z;
        th.y = 3;
        th.i = p.i;
      } else {
        const dx = lead.x - th.x;
        const dz = lead.z - th.z;
        const dist = Math.hypot(dx, dz);
        const stepLen = Math.min(dist, BLUE_V * 0.75 * dt);
        th.x += (dx / (dist || 1)) * stepLen;
        th.z += (dz / (dist || 1)) * stepLen;
        th.prog = lead.prog - Math.min(gap, dist);
        th.y = Math.max(0.6, Math.min(3, dist / 6));
        if (dist < 2.5 && local(lead)) {
          removeThing(r, th.id, true);
          r.events.push({ t: 'boom', x: lead.x, z: lead.z });
          boom(r, lead.x, lead.z, th.owner);
        }
      }
      continue;
    }
    if (th.kind === 'red') {
      const at = locate(t, th.x, th.z, th.i);
      const target = r.karts[th.target];
      let ax: number;
      let az: number;
      if (target && target.done === null && Math.hypot(target.x - th.x, target.z - th.z) < 28 && deltaS(t, at.s, target.s) > -4) {
        ax = target.x;
        az = target.z;
      } else {
        const p = pointAt(t, at.s + 14, target ? clamp(target.d, -5, 5) : 0);
        ax = p.x;
        az = p.z;
      }
      const want = headingOf(ax - th.x, az - th.z);
      const now = headingOf(th.vx, th.vz);
      const turn = clamp(wrapAngle(want - now), -7 * dt, 7 * dt);
      th.vx = Math.sin(now + turn) * RED_V;
      th.vz = Math.cos(now + turn) * RED_V;
    }
    th.x += th.vx * dt;
    th.z += th.vz * dt;
    const at = locate(t, th.x, th.z, th.i);
    th.i = at.i;
    if (Math.abs(at.d) > EDGE - 0.5) {
      if (th.kind === 'red' || th.bounces >= 5) {
        removeThing(r, th.id, th.local);
        continue;
      }
      // green shells bounce off the walls
      const sg = Math.sign(at.d);
      const nx = -at.tz * sg;
      const nz = at.tx * sg;
      const into = th.vx * nx + th.vz * nz;
      if (into > 0) {
        th.vx -= 2 * into * nx;
        th.vz -= 2 * into * nz;
        th.bounces++;
      }
      th.x -= nx * (Math.abs(at.d) - EDGE + 0.5);
      th.z -= nz * (Math.abs(at.d) - EDGE + 0.5);
    }
  }
}

function hitThings(r: Race) {
  // shells break on bananas and other shells
  for (let a = 0; a < r.things.length; a++) {
    for (let b = a + 1; b < r.things.length; b++) {
      const A = r.things[a];
      const B = r.things[b];
      if (A.kind === 'blue' || B.kind === 'blue' || (A.kind === 'banana' && B.kind === 'banana')) continue;
      if (A.y > 1.2 || B.y > 1.2) continue;
      if (Math.hypot(A.x - B.x, A.z - B.z) < 1.3) {
        removeThing(r, A.id, true);
        removeThing(r, B.id, true);
        return hitThings(r);
      }
    }
  }
  for (const k of r.karts) {
    if (!local(k) || k.done !== null) continue;
    const reach = KART_R * scaleOf(k) + 0.6;
    for (const th of [...r.things]) {
      if (th.kind === 'blue' || th.y > 1.2 + k.y) continue;
      if (th.owner === k.idx && th.grace > 0) continue;
      if (Math.hypot(th.x - k.x, th.z - k.z) > reach) continue;
      removeThing(r, th.id, true);
      // a banana or shell held out behind soaks one hit from behind
      if (k.trail && (th.x - k.x) * Math.sin(k.h) + (th.z - k.z) * Math.cos(k.h) < -0.3) {
        k.trail = false;
        k.uses--;
        if (k.uses <= 0) {
          k.item = null;
          k.uses = 0;
        }
        r.events.push({ t: 'block', k: k.idx, x: th.x, z: th.z });
        continue;
      }
      hitKart(r, k, th.kind === 'banana' ? 'spin' : 'tumble', th.owner);
    }
  }
}

function pickups(r: Race, dt: number) {
  for (const b of r.boxes) {
    if (b.t > 0) {
      b.t = Math.max(0, b.t - dt);
      continue;
    }
    for (const k of r.karts) {
      if (!local(k) || (k.x - b.x) ** 2 + (k.z - b.z) ** 2 > (1.7 + KART_R) ** 2) continue;
      b.t = BOX_RESPAWN;
      r.events.push({ t: 'box', k: k.idx });
      if (!k.item && k.roll === 0 && k.done === null) giveItem(r, k, rollItem(r, k));
      break;
    }
  }
  for (const c of r.coins) {
    if (c.t > 0) {
      c.t = Math.max(0, c.t - dt);
      continue;
    }
    for (const k of r.karts) {
      if (!local(k) || (k.x - c.x) ** 2 + (k.z - c.z) ** 2 > (0.7 + KART_R) ** 2) continue;
      c.t = COIN_RESPAWN;
      k.coins = Math.min(MAX_COINS, k.coins + 1);
      k.earned++;
      r.events.push({ t: 'coin', k: k.idx });
      break;
    }
  }
  for (const d of r.dashes) {
    for (const k of r.karts) {
      if (!local(k) || k.dashCool > 0) continue;
      const ds = Math.abs(deltaS(r.track, d.s, k.s));
      if (ds < 2.4 && Math.abs(k.d - d.d) < 1.6) {
        k.boost = Math.max(k.boost, DASH_T);
        k.dashCool = 0.6;
        r.events.push({ t: 'dash', k: k.idx });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CPU drivers (and the autopilot that brings you home after the flag)

const AUTO: Ai = { pace: 1, skill: 0.6, band: 1, lane: 0, laneTo: 0, laneT: 0, itemT: 1, held: 0, driftT: 0 };

function curveAhead(t: Track, s: number, from: number, to: number) {
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let a = from; a <= to; a += t.step * 2) {
    const c = t.curv[Math.floor(((s + a) % t.length + t.length) % t.length / t.step) % t.n];
    sum += c;
    if (Math.abs(c) > Math.abs(peak)) peak = c;
    n++;
  }
  return { mean: sum / Math.max(1, n), peak };
}

function think(r: Race, k: Kart, dt: number) {
  const t = r.track;
  const ai = (k.ai ??= { ...AUTO });
  const inp = k.input;
  ai.laneT -= dt;
  if (ai.laneT <= 0) {
    ai.laneTo = (r.rand() - 0.5) * 0.9;
    ai.laneT = 2 + r.rand() * 3;
  }
  // step around bananas and shells sitting on the road ahead
  for (const th of r.things) {
    if (th.kind === 'blue' || th.owner === k.idx) continue;
    const at = locate(t, th.x, th.z, th.i);
    const ds = deltaS(t, k.s, at.s);
    if (ds < 3 || ds > 26) continue;
    if (Math.abs(at.d - ai.lane * ROAD_HALF) < 2.6) ai.laneTo = at.d > 0 ? -0.55 : 0.55;
  }
  ai.lane = approach(ai.lane, ai.laneTo, 0.9 * dt);

  const curve = curveAhead(t, k.s, 8, 40);
  const lane = clamp(ai.lane + clamp(curve.mean * 40, -0.55, 0.55) * ai.skill, -0.82, 0.82);
  const look = 7 + Math.abs(k.v) * 0.5;
  const p = pointAt(t, k.s + look, lane * ROAD_HALF);
  const diff = wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h);
  const need = -diff * 2.6;
  if (k.drift !== 0) {
    // a drift always turns its way; steering only tightens or widens it
    inp.steer = clamp((need - k.drift * DRIFT_BASE) / DRIFT_RANGE, -1, 1);
    ai.driftT += dt;
    const goal = ai.skill > 0.7 ? 2 : 1;
    const ending = Math.abs(curve.mean) < 0.01 || Math.sign(curve.mean) !== k.drift;
    if ((turboLevel(k.charge) >= goal && ending) || k.drift * need < -0.35 || ai.driftT > 3) inp.drift = false;
  } else if (k.y === 0) {
    inp.steer = clamp(need, -1, 1);
    const bend = curveAhead(t, k.s, 4, 30).mean;
    inp.drift = Math.abs(bend) > 0.02 && k.v > 14 && Math.sign(bend) === Math.sign(need) && r.rand() < ai.skill;
    inp.hop = inp.drift;
    ai.driftT = 0;
    if (inp.hop) inp.steer = Math.sign(bend);
  } else {
    inp.steer = clamp(need, -1, 1);
  }
  const peak = Math.abs(curveAhead(t, k.s, 0, 20 + k.v * 0.8).peak);
  inp.brake = peak > 0 && k.v > 1.55 / peak && k.boost <= 0;
  if (Math.abs(diff) > 2.2 && k.v < 4) inp.brake = false;

  // cash in a full purse for a boost on a straight
  if (k.coins >= MAX_COINS && k.boost <= 0 && Math.abs(curveAhead(t, k.s, 0, 30).peak) < 0.012 && r.rand() < dt * 0.3) inp.cash = true;

  // tricks off ramps, and a shove for anyone driving alongside
  if (k.air && k.trickT > 0 && !k.trick && r.rand() < ai.skill * 0.25) inp.hop = true;
  if (k.slamCool === 0 && k.drift === 0 && r.rand() < dt * (0.5 + ai.skill)) {
    const { rx, rz } = rightOf(k);
    const beside = r.karts.some((o) => {
      if (o === k || o.done !== null) return false;
      const dx = o.x - k.x;
      const dz = o.z - k.z;
      const across = Math.abs(dx * rx + dz * rz);
      return Math.abs(dx * Math.sin(k.h) + dz * Math.cos(k.h)) < 2.4 && across > 1 && across < 3.4;
    });
    if (beside) inp.slam = true;
  }

  // keep the pack close: CPUs ease off well ahead of you and push when far behind
  const me = r.karts[r.me];
  if (k.ai && me && me !== k) ai.band = clamp(1 + (me.prog - k.prog) / 600, 0.9, 1.08);

  // items
  ai.itemT -= dt;
  if (k.item && k.roll === 0) ai.held += dt;
  else ai.held = 0;
  const behind = r.karts.some((o) => o !== k && o.done === null && deltaS(t, o.s, k.s) > 2 && deltaS(t, o.s, k.s) < 20);
  // hold a banana or shell out behind while someone is on your tail
  inp.hold = !!k.item && k.roll === 0 && (k.item === 'banana' || k.item === 'green' || k.item === 'red') && behind && ai.skill > 0.45;
  if (!k.item || k.roll > 0 || ai.itemT > 0) return;
  ai.itemT = 0.3 + r.rand() * 0.6;
  const aheadNear = r.karts.find((o) => o !== k && o.done === null && deltaS(t, k.s, o.s) > 3 && deltaS(t, k.s, o.s) < 32 && Math.abs(o.d - k.d) < 3);
  const straight = Math.abs(curveAhead(t, k.s, 0, 30).peak) < 0.012;
  inp.back = false;
  inp.fwd = false;
  let go = false;
  switch (k.item) {
    case 'banana':
      go = (behind && !inp.hold) || ai.held > 9;
      inp.back = true;
      break;
    case 'green':
      if (aheadNear) go = true;
      else if (behind) go = inp.back = true;
      else go = ai.held > 6;
      break;
    case 'red':
      if (k.place > 1) go = true;
      else if (behind) go = inp.back = true;
      break;
    case 'mushroom':
    case 'triple':
      go = straight || k.offroad;
      break;
    case 'star':
      go = ai.held > 0.4;
      break;
    case 'bolt':
      go = ai.held > 1 + ai.skill * 2;
      break;
    case 'blue':
      go = k.place > 1 && ai.held > 0.8;
      break;
  }
  inp.use = go;
}

/** Gas pressed during the countdown; the last press decides the rocket start. */
export function pressGas(r: Race, k: Kart) {
  if (r.time < 0) k.gas = r.time;
}

/** Points the local kart's input at whatever the player is pressing (the logic never reads the keyboard). */
export function setInput(k: Kart, input: Partial<Input>) {
  Object.assign(k.input, input);
}

/** Lap number to show: 1 on the grid, never past the last lap. */
export const lapOf = (r: Race, k: Kart) => clamp(k.lap, 1, r.laps);

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** 1:23.45 */
export function fmtTime(sec: number) {
  const cs = Math.max(0, Math.round(sec * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
