// Pure race rules for Palm Drive: kart physics, drifting and mini-turbos, items, CPU drivers, laps and places.
// No DOM, no three.js. Distances are meters, times seconds; see track.ts for the axes and heading convention.
import { COURSES, tierOf, trackOf, type CourseId, type Tier } from './courses.ts';
import { BALL_WINDOW, CURB, KART_R, WET, awake, ballDue, ballNear, cycleAt, deltaS, dropAt, drives, edgeAt, gridSpot, headingOf, inTrench, lengthOf, locate, pointAt, shoreOf, solid, timed, wrapAngle, wrapS, type Hazard, type HazardKind, type Layout, type Past, type Shore, type Spot, type Track } from './track.ts';
export { WET };

export const LAPS = 5;
export const COUNTDOWN = 3;
export { KART_R };
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
/** Golden mushroom: boost as often as you like for this long. */
export const GOLD_T = 7;
/** Mega mushroom: grow big, a little faster, and flatten whoever you touch. */
export const MEGA_T = 7.5;
export const MEGA_DV = 2.5;
/** Bullet: the kart flies itself down the middle of the road, bowling everyone aside. */
export const BULLET_T = 4;
export const BULLET_DV = 15;
/** Ink splattered over everyone ahead. */
export const INK_T = 4.5;
/** The horn's shockwave. */
export const HORN_R = 9;
/** Bombs go off after this long, or as soon as a kart rolls up next to one. */
export const BOMB_LIFE = 3.4;
export const BOMB_NEAR = 3.2;
export const GREEN_V = 42;
export const RED_V = 40;
export const BLUE_V = 60;
export const BOOM_R = 7;
/**
 * Off the road where it drops away (into water or a pit; how long until you are fished out, and what it costs, go with
 * the course: see Tier), press drift this close either side of being set back down on the road for a drop start, a
 * boost as long as a dash panel's.
 */
export const DROP_WINDOW = 0.25;
/** An oil slick spins out a kart going faster than this. */
export const OIL_V = 5;
/** How a fall plays out, as shares of the time it takes: sinking out of sight, the crane carrying the kart back, set down. */
export const FALL_SINK = 0.26;
export const FALL_CARRY = 0.54;

export type Cc = '50cc' | '100cc' | '150cc' | '200cc';
export const CCS: Cc[] = ['50cc', '100cc', '150cc', '200cc'];
export const CLASSES: Record<Cc, { top: number; accel: number; cpu: number }> = {
  '50cc': { top: 19, accel: 9, cpu: 0.92 },
  '100cc': { top: 23, accel: 11, cpu: 0.95 },
  '150cc': { top: 27.5, accel: 13, cpu: 0.97 },
  '200cc': { top: 33, accel: 16, cpu: 0.97 },
};
export const isCc = (v: unknown): v is Cc => CCS.includes(v as Cc);

export type Item = 'banana' | 'bananas' | 'green' | 'greens' | 'red' | 'bomb' | 'mushroom' | 'triple' | 'golden' | 'coin' | 'star' | 'mega' | 'bullet' | 'ink' | 'horn' | 'bolt' | 'blue';
export const ITEMS: Item[] = ['banana', 'bananas', 'green', 'greens', 'red', 'bomb', 'mushroom', 'triple', 'golden', 'coin', 'star', 'mega', 'bullet', 'ink', 'horn', 'bolt', 'blue'];
export type ThingKind = 'banana' | 'green' | 'red' | 'blue' | 'bomb';
/** Bananas and shells can be held out behind as a shield. */
export const trailable = (item: Item | null) => item === 'banana' || item === 'bananas' || item === 'green' || item === 'greens' || item === 'red';
/** How many goes an item gives (the golden mushroom runs on a timer instead). */
const USES: Partial<Record<Item, number>> = { triple: 3, bananas: 3, greens: 3 };
export type HitHow = 'spin' | 'tumble' | 'squash' | 'boom';

/** hold: the item button is held (bananas and shells trail behind as a shield until it is let go). */
export type Input = { steer: number; brake: boolean; drift: boolean; hop: boolean; use: boolean; back: boolean; fwd: boolean; hold: boolean; slam: boolean; cash: boolean };
export type Hat = 'cap' | 'tree' | 'top' | 'bow' | 'tower' | 'axe' | 'dish' | 'claw';
export const HATS: Hat[] = ['cap', 'tree', 'top', 'bow', 'tower', 'axe', 'dish', 'claw'];
/**
 * care: seconds left keeping well away from the edge after a fall; dropGo: this time it times the drop start. reactS and
 * react: where it last decided whether it catches itself in time on the brink of a drop, and whether it does. err: how
 * early or late it judges the set pieces this lap (errLap), blunders: the set pieces it simply failed to see (by where
 * and which lap), waitT: how long it has sat waiting for one.
 */
export type Ai = { pace: number; skill: number; band: number; lane: number; laneTo: number; laneT: number; itemT: number; held: number; driftT: number; care: number; dropGo: boolean; reactS: number; react: boolean; err: number; errLap: number; blunders: Record<string, boolean>; waitT: number; backT: number; backs: number; backAt: number; heldT: number; goT: number };
/** A fall off the road: into what (and whether down a trench), how fast the kart was going, and where it is put back [s, d]. */
export type Fell = { past: Past; hole: boolean; v: number; to: [number, number] };
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
  /** Golden mushroom time left once it has been started. */
  goldT: number;
  mega: number;
  bullet: number;
  ink: number;
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
  /** In a mud puddle or a bunker: as slow as the grass (sand: it is a bunker). */
  mud: boolean;
  sand: boolean;
  /** On wet road: no grip (see the 'wet' hazard). */
  wet: boolean;
  /**
   * Fallen off the road (into a pond, a pit or a trench), waiting to be fished out; then how long is left to press for
   * a drop start, and whether it was pressed. fell: the fall itself (this client's karts only), falls: how many.
   */
  sunk: number;
  drop: number;
  dropHit: boolean;
  dropMiss: boolean;
  fell: Fell | null;
  falls: number;
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
  | { t: 'trick'; k: number }
  /** Ink and the horn as sent online, and the splats and shockwave they make (for the view and sounds). */
  | { t: 'ink'; k: number }
  | { t: 'inked'; k: number }
  | { t: 'horn'; k: number; x: number; z: number }
  | { t: 'blast'; x: number; z: number }
  /** Splashing into mud, running into a cow or a cyclist, and the horn of the bus you ran into. */
  | { t: 'mud'; k: number }
  | { t: 'moo'; k: number }
  | { t: 'ding'; k: number }
  | { t: 'honk'; k: number }
  /** Out on the golf course: into a bunker, into a pond, a golf cart's horn, a golfer's shout and a ball off your helmet. */
  | { t: 'sand'; k: number }
  | { t: 'splash'; k: number }
  /** Off the road into a pit (or out of bounds), set back down on it after a fall, and an item sinking over the edge. */
  | { t: 'fall'; k: number; kind: Past }
  | { t: 'set'; k: number }
  | { t: 'sank'; x: number; z: number; kind: Past }
  | { t: 'toot'; k: number }
  | { t: 'fore'; k: number }
  | { t: 'plink'; k: number }
  /** Caught by one of the set pieces: flattened by a pile driver, stopped by a bollard, spun by a jet, thrown by the ball. */
  | { t: 'haz'; k: number; kind: HazardKind };

export type Rng = () => number;

export type Race = {
  course: CourseId;
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
  /** The course's mud, oil, hay bales, boulders, cows, buses and so on, with where each is right now. */
  hazards: LiveHazard[];
  /** How far it is to the water either side of the road, on a course with ponds. */
  shore: Shore | null;
  /** The trenches across the road. */
  holes: LiveHazard[];
  /** How hard the CPUs push and what mistakes cost on this course (from its difficulty). */
  tier: Tier;
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

/**
 * A hazard on the road and where it is now: how far along the lap and across the road, which way the road runs
 * there (a bus faces that way), and which way a cow or a bike is heading (+1 to the right of the road).
 */
export type LiveHazard = Hazard & { x: number; z: number; along: number; at: number; tx: number; tz: number; walk: number };

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

export function createRace(opts: { cc: Cc; racers: Racer[]; course?: CourseId; seed?: number; countdown?: number; laps?: number; idBase?: number; me?: number }): Race {
  const course = opts.course ?? 'palm';
  const track = trackOf(course);
  const lay = COURSES[course].layout(track);
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
      goldT: 0,
      mega: 0,
      bullet: 0,
      ink: 0,
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
      mud: false,
      sand: false,
      wet: false,
      sunk: 0,
      drop: 0,
      dropHit: false,
      dropMiss: false,
      fell: null,
      falls: 0,
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
  const hazards = lay.hazards.map((h): LiveHazard => {
    const p = pointAt(track, h.s, h.d);
    return { ...h, x: p.x, z: p.z, along: h.s, at: h.d, tx: p.tx, tz: p.tz, walk: 0 };
  });
  const race: Race = {
    course,
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
    hazards,
    shore: shoreOf(track, lay.hazards),
    holes: hazards.filter((h) => h.kind === 'trench'),
    tier: tierOf(course),
    rand,
    nextId: opts.idBase ?? 1,
    events: [],
    me: opts.me ?? karts.findIndex((k) => k.kind === 'player'),
    first: null,
    boltAt: -99,
  };
  moveHazards(race);
  rankKarts(race);
  return race;
}

/** Where across the road a hazard is at race time `time`: cows and bikes cross from side to side, the rest stay put. */
export const hazardD = (h: Hazard, time: number) => (h.swing ? h.d + h.swing * Math.sin(time * (h.speed ?? 0.5) + (h.phase ?? 0)) : h.d);
/** How fast a hazard is crossing the road at race time `time`, in meters a second to the right. */
export const hazardV = (h: Hazard, time: number) => (h.swing ? h.swing * (h.speed ?? 0.5) * Math.cos(time * (h.speed ?? 0.5) + (h.phase ?? 0)) : 0);

/** How far along the lap a hazard is at race time `time`: a bus waits at its stop for the green light, then drives on. */
export const hazardS = (t: Track, h: Hazard, time: number) => (h.drive ? wrapS(t, h.s + h.drive * Math.max(0, time)) : h.s);

/**
 * Cows and cyclists cross the road and back, and buses drive their laps, on the race clock, so every screen has them
 * in the same place.
 */
export function moveHazards(r: Race) {
  for (const h of r.hazards) {
    if (!h.swing && !h.drive) continue;
    h.at = hazardD(h, r.time);
    h.along = hazardS(r.track, h, r.time);
    if (h.swing) h.walk = Math.cos(r.time * (h.speed ?? 0.5) + (h.phase ?? 0)) >= 0 ? 1 : -1;
    const p = pointAt(r.track, h.along, h.at);
    h.x = p.x;
    h.z = p.z;
    h.tx = p.tx;
    h.tz = p.tz;
  }
}

/**
 * How far (x, z) is inside a bus (or a golf cart driving its laps) grown by `pad` all round, along its length and
 * across it, in its own frame (it faces the way the road runs where it is); null when clear of it.
 */
export function inBus(h: LiveHazard, x: number, z: number, pad: number) {
  const dx = x - h.x;
  const dz = z - h.z;
  const along = dx * h.tx + dz * h.tz;
  const across = -dx * h.tz + dz * h.tx;
  const inL = lengthOf(h) / 2 + pad - Math.abs(along);
  const inW = h.r + pad - Math.abs(across);
  return inL > 0 && inW > 0 ? { along, across, inL, inW } : null;
}

/**
 * Whether something solid stands at (x, z), give or take `pad`: a bus or a cart over its whole length, the rest round
 * about. Only what is out yet on lap `lap` (a shell goes by its thrower's lap).
 */
const blocks = (r: Race, h: LiveHazard, x: number, z: number, pad: number, lap: number, hint: number) => {
  if (timed(h.kind)) {
    // the set pieces by what they are doing now: a bank that is up, a hammer down or low, the ball, a sprinkler's hub
    if (h.kind === 'rotor') return Math.hypot(h.x - x, h.z - z) < h.r + pad;
    if (!hazState(r, h, r.time, lap).solid) return false;
    if (h.kind !== 'bollard') return Math.hypot(h.x - x, h.z - z) < h.r + pad;
    if (Math.hypot(h.x - x, h.z - z) > (h.w ?? 0) / 2 + pad + 1) return false;
    const at = locate(r.track, x, z, hint);
    return Math.abs(deltaS(r.track, h.s, at.s)) < BANK.thick + pad && Math.abs(at.d - h.d) < (h.w ?? 0) / 2 + pad;
  }
  return solid(h.kind) && awake(h, lap) && (drives(h) ? inBus(h, x, z, pad) !== null : Math.hypot(h.x - x, h.z - z) < h.r + pad);
};

function newAi(pace: number, skill: number, rand: Rng): Ai {
  return { pace, skill, band: 1, lane: (rand() - 0.5) * 0.8, laneTo: 0, laneT: rand() * 2, itemT: 1 + rand() * 2, held: 0, driftT: 0, care: 0, dropGo: false, reactS: -1e9, react: true, err: 0, errLap: 0, blunders: {}, waitT: 0, backT: 0, backs: 0, backAt: -99, heldT: 0, goT: 0 };
}

/** A solo Grand Prix: seven CPU rivals ahead of you on the grid, like the first race of a cup. */
export function soloRace(cc: Cc, seed?: number, look: { color: string; hat: Hat } = { color: PLAYER_COLOR, hat: 'cap' }, course: CourseId = 'palm') {
  return createRace({ cc, seed, course, racers: [...RIVALS, { name: 'you', color: look.color, kind: 'player', hat: look.hat }] });
}

export const racing = (r: Race) => r.time >= 0;
const scaleOf = (k: Kart) => (k.shrink > 0 ? 0.62 : k.mega > 0 ? 1.5 : 1);
export const hurt = (k: Kart) => k.spin > 0 || k.tumble > 0 || k.sunk > 0;
const local = (k: Kart) => k.kind !== 'remote';

export function step(r: Race, dt: number) {
  const before = r.time;
  r.time += dt;
  moveHazards(r);
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
      const early = k.ai ? (r.rand() < k.ai.skill * r.tier.rocket ? -0.4 : null) : k.gas;
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
  // just gone in the water (applyFlags marks it): sink, haul out and set down on our clock, held at the last moment
  // until its owner says it is out
  if (k.sunk === Infinity) k.sunk = r.tier.fallT;
  else if (k.sunk > 0) k.sunk = Math.max(0.01, k.sunk - dt);
}

/** How fast a kart can go right now, with everything it has going for it and against it. */
function topOf(r: Race, k: Kart) {
  const C = CLASSES[r.cc];
  // (the course's tier pace is for the CPUs, not for your kart bringing itself home after the flag; and on Expert the
  // class has its own say on top of it)
  const pace = k.kind === 'cpu' ? r.tier.pace * (r.tier.paceCc?.[r.cc] ?? 1) : 1;
  let top = C.top * (k.ai ? k.ai.pace * k.ai.band * C.cpu * pace : 1) + coinTop(k.coins);
  if (k.shrink > 0) top *= 0.72;
  if (k.star > 0) top += STAR_DV;
  if (k.mega > 0) top += MEGA_DV;
  if (k.boost > 0) top += BOOST_DV;
  else if ((k.offroad || k.mud) && k.star <= 0 && k.mega <= 0) top *= OFFROAD;
  if (k.drift) top *= 0.985;
  if (k.wobble > 0) top *= 0.85;
  // ink on a CPU's visor: it drives a touch slower
  if (k.ink > 0 && k.ai) top *= 0.93;
  return top;
}

function drive(r: Race, k: Kart, dt: number) {
  const C = CLASSES[r.cc];
  const inp = k.input;
  const flying = k.bullet > 0;
  for (const key of ['boost', 'star', 'shrink', 'spin', 'tumble', 'squash', 'safe', 'dashCool', 'slamCool', 'slamT', 'wobble', 'rampCool', 'trickT', 'mega', 'bullet', 'ink'] as const) k[key] = Math.max(0, k[key] - dt);
  // a bullet hands the kart back with a little boost
  if (flying && k.bullet === 0) k.boost = Math.max(k.boost, 0.6);
  if (k.goldT > 0) {
    k.goldT = Math.max(0, k.goldT - dt);
    if (k.goldT === 0 && k.item === 'golden') {
      k.item = null;
      k.uses = 0;
    }
  }
  if (k.roll > 0) {
    k.roll = Math.max(0, k.roll - dt);
    if (k.roll === 0 && k.item) r.events.push({ t: 'got', k: k.idx, item: k.item });
  }
  if (k.sunk > 0) {
    // off the road, going nowhere until you are fished out and set back on it; press drift just as you touch down
    // (just before or just after) for a drop start
    k.sunk = Math.max(0, k.sunk - dt);
    k.v = 0;
    k.steer = 0;
    k.trail = false;
    if (inp.hop && k.sunk <= DROP_WINDOW && !k.dropMiss) k.dropHit = true;
    else if (inp.hop && k.sunk <= DROP_WINDOW + 0.6) k.dropMiss = true;
    if (k.sunk === 0) {
      rescue(r, k, k.fell?.to);
      k.fell = null;
      k.drop = DROP_WINDOW;
      r.events.push({ t: 'set', k: k.idx });
    }
    return;
  }
  if (k.drop > 0) {
    k.drop = Math.max(0, k.drop - dt);
    if (inp.hop && !k.dropMiss) k.dropHit = true;
    if (k.dropHit) {
      k.drop = 0;
      k.boost = Math.max(k.boost, DASH_T);
      r.events.push({ t: 'turbo', k: k.idx, level: 2 });
    }
    if (k.drop === 0) {
      k.dropHit = false;
      k.dropMiss = false;
    }
  }
  const control = !hurt(k);
  if (!control) {
    k.drift = 0;
    k.charge = 0;
  }
  const want = control && k.bullet <= 0 ? clamp(inp.steer, -1, 1) * (k.wobble > 0 ? 0.3 : 1) : 0;
  k.steer = approach(k.steer, want, (want === 0 ? 9 : 6) * dt);
  k.trail = control && inp.hold && k.roll === 0 && trailable(k.item);
  if (k.bullet > 0) {
    k.drift = 0;
    k.charge = 0;
  }

  const top = topOf(r, k);
  if (k.bullet > 0) k.v = approach(k.v, C.top + BULLET_DV, 40 * dt);
  else if (!control) k.v = approach(k.v, 0, (k.tumble > 0 ? 30 : 14) * dt);
  else if (inp.brake) k.v = k.v > 0.5 ? Math.max(0, k.v - 26 * dt) : Math.max(-REVERSE, k.v - 9 * dt);
  else if (k.v < top) k.v = Math.min(top, k.v + (k.boost > 0 ? 34 : k.v < 0 ? 20 : C.accel) * dt);
  else k.v = Math.max(top, k.v - ((k.offroad || k.mud) && k.boost <= 0 ? 24 : 8) * dt);

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
      k.charge += dt * (0.7 + 0.8 * Math.max(0, k.steer * k.drift)) * (k.offroad || k.mud ? 0.4 : 1) * (k.wet ? 0.8 : 1);
    }
  }

  let rate: number;
  if (k.drift !== 0) rate = k.drift * (DRIFT_BASE + DRIFT_RANGE * k.steer * k.drift);
  else rate = k.steer * TURN * Math.min(1, sp / 5) * (1 - 0.3 * Math.min(1, sp / 30));
  // on wet road the kart turns less (a drift holds better than the front wheels do)
  if (k.wet) rate *= k.drift !== 0 ? 0.85 : 0.7;
  if (k.v < 0) rate = -rate;
  if (k.spin > 0) rate = 0;
  if (k.bullet > 0) {
    // on rails down the middle of the road, looking less far ahead round a tight bend with a drop beside it so it never
    // cuts across it (with walls both sides it rides as it always has)
    const ahead = 12 + k.v * 0.3;
    const bend = Math.abs(curveAhead(r.track, k.s, 0, 20).peak);
    const open = bend > 0.02 && edgeBand(r, k, 0).open;
    const p = pointAt(r.track, k.s + (open ? Math.min(ahead, Math.sqrt(12 / bend)) : ahead), 0);
    const diff = wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h);
    k.h = wrapAngle(k.h + clamp(diff, -5 * dt, 5 * dt));
  } else k.h = wrapAngle(k.h - rate * dt);

  k.x += (Math.sin(k.h) * k.v + k.kx) * dt;
  k.z += (Math.cos(k.h) * k.v + k.kz) * dt;
  const decay = Math.exp(-5 * dt);
  k.kx *= decay;
  k.kz *= decay;
  wall(r, k);
  if (k.sunk > 0) return;
  hazards(r, k);
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

/**
 * Keeps a kart on the road: it slides along a wall, losing speed for a head-on hit. Where the road drops away instead
 * nothing holds it, and once its middle is over the brink with its wheels on the ground it falls in (in the air it sails
 * on, and falls where it lands; a bullet rides its rails over anything). A trench across the road is the same. A CPU
 * fished out a moment ago is the exception: the lip holds it like a wall, its wheels on the brink, for a while, so it
 * never falls twice running.
 */
function wall(r: Race, k: Kart) {
  const t = r.track;
  const at = locate(t, k.x, k.z, k.i);
  k.i = at.i;
  // (a hop clears a trench or a drop, but not the water: the splash height is the old one, so the ponds play as before)
  const grounded = k.y <= 0.05 && k.bullet <= 0 && k.sunk === 0;
  const low = k.y <= 0.3 && k.bullet <= 0 && k.sunk === 0;
  if (grounded) {
    for (const h of r.holes) if (inTrench(t, h, at.s, at.d)) return fallIn(r, k, 'pit', at, h);
  }
  const edge = edgeAt(t, at.s, at.d >= 0 ? 1 : -1);
  // (the same for everyone: a CPU that fell a moment ago keeps clear of the edge in its planning, nothing holds it on)
  if (edge.past !== 'wall') {
    if ((edge.past === 'water' ? low : grounded) && Math.abs(at.d) > edge.lim) return fallIn(r, k, edge.past, at);
  } else {
    const lim = edge.lim - KART_R * scaleOf(k);
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
  }
  const now = locate(t, k.x, k.z, k.i);
  k.i = now.i;
  k.d = now.d;
  k.offroad = Math.abs(now.d) > t.half + CURB * 0.6;
}

/**
 * Mud, sand, oil, golf balls and the bales, boulders, planters, statues, cows, bikes, buses, carts, golfers and
 * flagsticks in the way, for a kart this client drives.
 */
function hazards(r: Race, k: Kart) {
  const was = k.mud;
  k.mud = false;
  k.sand = false;
  k.wet = false;
  // in the air you sail over all of it but a bus or a cart, and stars, megas and bullets plough straight through
  const flying = k.y > 0.3;
  const tough = k.star > 0 || k.mega > 0 || k.bullet > 0;
  for (const h of r.hazards) {
    const dx = k.x - h.x;
    const dz = k.z - h.z;
    // (ponds and trenches are edges of the road: see wall())
    if (h.kind === 'water' || h.kind === 'trench') continue;
    // (a bank of bollards reaches a long way either side of its middle, and so does a sprinkler's jet)
    const near = h.kind === 'bollard' || h.kind === 'rotor' ? 16 : 9;
    if (Math.abs(dx) > near || Math.abs(dz) > near) continue;
    // (a sprinkler's hub stands there whether or not its jet has come on yet)
    if (!awake(h, k.lap) && h.kind !== 'rotor') continue;
    if (timed(h.kind)) {
      pieceHit(r, k, h, dx, dz, tough, flying);
      continue;
    }
    if (h.kind === 'wet') {
      if (!flying && !tough && dx * dx + dz * dz < h.r * h.r) k.wet = true;
      continue;
    }
    if (drives(h)) {
      if (!tough) busHit(r, k, h);
      continue;
    }
    const dist = Math.hypot(dx, dz);
    if (h.kind === 'ball') {
      // a ball coming down on your head as it lands; high enough in the air and it lands underneath you
      if (!tough && k.y < 1 && dist < h.r + KART_R * scaleOf(k) && Math.abs(ballNear(h, r.time)) < BALL_WINDOW && hitKart(r, k, 'spin', -1)) r.events.push({ t: 'plink', k: k.idx });
      continue;
    }
    if (flying) continue;
    if (h.kind === 'mud' || h.kind === 'sand') {
      if (dist < h.r && !tough) {
        k.mud = true;
        k.sand = h.kind === 'sand';
      }
      continue;
    }
    if (h.kind === 'oil') {
      // (crawling through it, say getting going again after it spun you, it lets you go)
      if (dist < h.r && Math.abs(k.v) > OIL_V) hitKart(r, k, 'spin', -1);
      continue;
    }
    const reach = h.r + KART_R * scaleOf(k);
    if (tough || dist >= reach) continue;
    const into = shove(r, k, h, dx, dz, dist, reach);
    if (into <= 0) continue;
    // a cow does not take kindly to it, nor does a cyclist, a golfer or a golf cart crossing on its path
    if ((h.kind === 'cow' || h.kind === 'bike' || h.kind === 'golfer' || h.kind === 'cart') && into > 3) {
      if (hitKart(r, k, 'spin', -1)) r.events.push({ t: h.kind === 'cow' ? 'moo' : h.kind === 'bike' ? 'ding' : h.kind === 'golfer' ? 'fore' : 'toot', k: k.idx });
    } else if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
  }
  if (k.mud && !was) r.events.push({ t: k.sand ? 'sand' : 'mud', k: k.idx });
}

/**
 * A kart against something solid at (h.x, h.z), `dist` from its middle and inside its `reach`: pushed back out,
 * bouncing off and losing speed for a head-on hit. How hard they met comes back (nothing, if they were parting): a
 * bike riding into the side of you counts as much as you driving into it.
 */
function shove(r: Race, k: Kart, h: LiveHazard, dx: number, dz: number, dist: number, reach: number) {
  const nx = dist > 1e-6 ? dx / dist : -Math.sin(k.h);
  const nz = dist > 1e-6 ? dz / dist : -Math.cos(k.h);
  k.x = h.x + nx * reach;
  k.z = h.z + nz * reach;
  const vx = Math.sin(k.h) * k.v + k.kx;
  const vz = Math.cos(k.h) * k.v + k.kz;
  let into = -(vx * nx + vz * nz);
  if (h.swing) {
    const p = pointAt(r.track, h.s);
    const across = hazardV(h, r.time);
    into += -p.tz * across * nx + p.tx * across * nz;
  }
  if (into <= 0) return into;
  k.kx += nx * into * 1.3;
  k.kz += nz * into * 1.3;
  k.v *= 1 - Math.min(0.9, (0.6 * into) / (Math.hypot(vx, vz) || 1));
  return into;
}

// ---------------------------------------------------------------------------------------------------------------
// The set pieces: pile drivers, bollard banks, sprinklers and wrecking balls, all on the race clock

/** A pile driver's cycle: the head drops (slam), sits on the ground (`on`), lifts (solid for the first `low` of it) and hovers, shaking for the last `warn`. */
export const HAMMER = { every: 3.6, slam: 0.18, on: 0.7, low: 0.3, lift: 1.2, warn: 0.8, drop: 5 };
/** A bank of bollards: it pops up in `rise`, stands `on`, drops in `fall`; amber for `warn` before; `thick` either way along the road. */
export const BANK = { every: 3.2, on: 1.6, warn: 0.9, rise: 0.2, fall: 0.2, thick: 0.35 };
/** A sprinkler's jet: this wide either side of the arm, and this high (a hop does not clear it). */
export const JET = { w: 0.4, high: 1.4 };
/** The wrecking ball throws you clear at this much plus its own sideways speed, up to the most. */
export const WRECK_KNOCK = 6;
export const WRECK_MAX = 12;

/**
 * The Marguerite has right of way: while a bus (or a cart on its rounds) is this near a set piece along the road, the
 * piece stands aside (the hammer and the ball hauled up, the bollards down, the jet off), so a bus never leaves a kart
 * nowhere to go beside one. Pure in time, like the buses themselves.
 */
export function rightOfWay(r: Race, h: Hazard, time: number) {
  const t = r.track;
  for (const v of r.hazards) {
    if (!drives(v)) continue;
    const reach = lengthOf(v) / 2 + (h.kind === 'bollard' ? (h.w ?? 0) : h.r) + 6;
    if (Math.abs(deltaS(t, hazardS(t, v, time), h.s)) < reach) return true;
  }
  return false;
}

/**
 * What a set piece is doing at race time `time` for a kart on lap `lap` (see HazardKind): off (not out yet for that
 * kart), idle (out of the way: the hammer hovering, the bank flush, the jet off, the ball hauled up for a bus), or in
 * play. live: it hits you now; solid: you bounce off it and shells break on it. lift: 0 down to 1 up for a hammer, 0
 * flush to 1 up for a bank, 1 while a jet runs or a ball is hauled up. warn: 0 to 1 through the telegraph before it
 * comes. d: where across the road it is (the ball swings); ang: a rotor's arm angle. A pure function of (hazard, time,
 * lap) and the buses, which are functions of time themselves, so every screen agrees about it.
 */
export type HazPhase = 'off' | 'idle' | 'slam' | 'down' | 'rise' | 'pop' | 'up' | 'fall' | 'on';
export type HazState = { live: boolean; solid: boolean; lift: number; warn: number; d: number; ang: number; phase: HazPhase };
export function hazState(r: Race, h: Hazard, time: number, lap: number): HazState {
  const st: HazState = { live: false, solid: false, lift: 0, warn: 0, d: h.kind === 'wrecker' ? hazardD(h, time) : h.d, ang: 0, phase: 'off' };
  if (h.kind === 'wet') {
    st.live = awake(h, lap);
    st.phase = st.live ? 'on' : 'off';
    return st;
  }
  const out = awake(h, lap);
  const yielding = out && rightOfWay(r, h, time);
  if (h.kind === 'rotor') {
    st.ang = (h.a0 ?? 0) + (h.spin ?? 0) * time;
    // the hub stands there from the first lap; the jet comes on with its lap
    st.solid = true;
    st.live = out && !yielding;
    st.lift = st.live ? 1 : 0;
    st.phase = st.live ? 'on' : out ? 'idle' : 'off';
    return st;
  }
  if (h.kind === 'wrecker') {
    st.live = st.solid = out && !yielding;
    st.lift = yielding ? 1 : 0;
    st.phase = !out ? 'off' : yielding ? 'idle' : 'on';
    return st;
  }
  if (h.kind === 'hammer') {
    st.lift = 1;
    if (!out) return st;
    st.phase = 'idle';
    if (yielding) return st;
    const every = h.every ?? HAMMER.every;
    const on = h.on ?? HAMMER.on;
    const c = cycleAt(h, time, every);
    if (c < HAMMER.slam) {
      st.phase = 'slam';
      st.live = true;
      st.lift = 1 - c / HAMMER.slam;
    } else if (c < HAMMER.slam + on) {
      st.phase = 'down';
      st.live = st.solid = true;
      st.lift = 0;
    } else if (c < HAMMER.slam + on + HAMMER.lift) {
      const up = c - HAMMER.slam - on;
      st.phase = 'rise';
      st.lift = up / HAMMER.lift;
      st.live = st.solid = up < HAMMER.low;
    } else {
      const warn = h.warn ?? HAMMER.warn;
      st.warn = Math.max(0, (c - (every - warn)) / warn);
    }
    return st;
  }
  // a bank of bollards
  if (!out) return st;
  st.phase = 'idle';
  if (yielding) return st;
  const every = h.every ?? BANK.every;
  const on = h.on ?? BANK.on;
  const c = cycleAt(h, time, every);
  if (c < BANK.rise) {
    st.phase = 'pop';
    st.live = st.solid = true;
    st.lift = c / BANK.rise;
  } else if (c < BANK.rise + on) {
    st.phase = 'up';
    st.live = st.solid = true;
    st.lift = 1;
  } else if (c < BANK.rise + on + BANK.fall) {
    st.phase = 'fall';
    st.lift = 1 - (c - BANK.rise - on) / BANK.fall;
    st.live = st.solid = st.lift > 0.5;
  } else {
    const warn = h.warn ?? BANK.warn;
    st.warn = Math.max(0, (c - (every - warn)) / warn);
  }
  return st;
}

/**
 * The stretches across the road (lateral offsets [from, to]) a set piece blocks at race time `time` for a kart on lap
 * `lap`, on the line across the road `ds` meters past its s: the chord of a hammer's head or the ball where it is, the
 * whole bank while it is up, a sprinkler's hub and wherever its jet crosses that line. Empty when it is out of the way.
 * The CPUs plan with this and the collision agrees with it.
 */
export function hazSpans(r: Race, h: Hazard, time: number, lap: number, ds = 0, st = hazState(r, h, time, lap)): [number, number][] {
  const out: [number, number][] = [];
  if (h.kind === 'wet') return out;
  if (h.kind === 'bollard') {
    if (st.solid && Math.abs(ds) <= BANK.thick) out.push([h.d - (h.w ?? 0) / 2, h.d + (h.w ?? 0) / 2]);
    return out;
  }
  if (h.kind === 'rotor') {
    if (Math.abs(ds) < h.r) {
      const hc = Math.sqrt(h.r * h.r - ds * ds);
      out.push([h.d - hc, h.d + hc]);
    }
    if (st.live) {
      // the arm runs from the hub `arm` out at angle ang (0 along the road, +pi/2 to the right): the stretch of it
      // within the jet's width of this line
      const arm = h.arm ?? 5;
      const ca = Math.cos(st.ang);
      const sa = Math.sin(st.ang);
      let u0: number;
      let u1: number;
      if (Math.abs(ca) < 1e-6) {
        if (Math.abs(ds) > JET.w) return out;
        u0 = 0;
        u1 = arm;
      } else {
        const a = (ds - JET.w) / ca;
        const b = (ds + JET.w) / ca;
        u0 = Math.max(0, Math.min(a, b));
        u1 = Math.min(arm, Math.max(a, b));
      }
      if (u1 >= u0 && u1 > h.r * 0.6) {
        const x0 = h.d + u0 * sa;
        const x1 = h.d + u1 * sa;
        out.push([Math.min(x0, x1) - JET.w, Math.max(x0, x1) + JET.w]);
      }
    }
    return out;
  }
  // the head of a hammer coming down or on the ground, or the ball
  if ((st.live || st.solid) && Math.abs(ds) < h.r) {
    const hc = Math.sqrt(h.r * h.r - ds * ds);
    out.push([st.d - hc, st.d + hc]);
  }
  return out;
}

/** Caught by a set piece: what each one does to a kart that is in its way right now (see HazardKind). */
function pieceHit(r: Race, k: Kart, h: LiveHazard, dx: number, dz: number, tough: boolean, flying: boolean) {
  const st = hazState(r, h, r.time, k.lap);
  const R = KART_R * scaleOf(k);
  const caught = (how: HitHow) => {
    if (hitKart(r, k, how, -1)) r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
  };
  if (h.kind === 'bollard') {
    // a slab across the road, `thick` either way along it and half its width either side of d: flush, it is nothing
    if (!st.solid || tough) return;
    const t = r.track;
    const at = locate(t, k.x, k.z, k.i);
    const along = deltaS(t, h.s, at.s);
    const across = at.d - h.d;
    const inL = BANK.thick + R - Math.abs(along);
    const inW = (h.w ?? 0) / 2 + R - Math.abs(across);
    if (inL <= 0 || inW <= 0) return;
    // (a hop does not clear a bank standing a meter high)
    if (st.phase === 'pop') return caught('tumble');
    // up: squashed against it and put back behind the line, squarely in front of this bank (or out of its end), nearly
    // stopped
    const w = h.w ?? 0;
    const p = inL <= inW ? pointAt(t, h.s + (along < 0 ? -1 : 1) * (BANK.thick + R), Math.min(h.d + w / 2 - R - 0.1, Math.max(h.d - w / 2 + R + 0.1, at.d))) : pointAt(t, at.s, h.d + (across < 0 ? -1 : 1) * (w / 2 + R));
    k.x = p.x;
    k.z = p.z;
    k.kx *= 0.2;
    k.kz *= 0.2;
    k.v = Math.min(k.v, 3);
    if (hitKart(r, k, 'squash', -1)) {
      k.safe += 0.6;
      r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
    }
    return;
  }
  const dist = Math.hypot(dx, dz);
  if (h.kind === 'rotor') {
    // the hub is a planter: solid from the first lap, in the air or not (but a small one: it does not fling a kart
    // that hits it aside toward the water)
    if (!tough && !flying && dist < h.r + R) {
      const kx = k.kx;
      const kz = k.kz;
      const into = shove(r, k, h, dx, dz, dist, h.r + R);
      k.kx = kx + (k.kx - kx) * 0.35;
      k.kz = kz + (k.kz - kz) * 0.35;
      if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
    }
    if (!st.live || tough) return;
    // the jet: a line from the hub `arm` out at the arm's angle, a hand's width wide and higher than a hop
    const ax = h.tx * Math.cos(st.ang) - h.tz * Math.sin(st.ang);
    const az = h.tz * Math.cos(st.ang) + h.tx * Math.sin(st.ang);
    const u = Math.max(0, Math.min(h.arm ?? 5, dx * ax + dz * az));
    const px = h.x + ax * u;
    const pz = h.z + az * u;
    // (and then a while to get clear of it before it comes round again)
    if (u > h.r * 0.6 && Math.hypot(k.x - px, k.z - pz) < JET.w + R && hitKart(r, k, 'spin', -1)) {
      k.safe = Math.max(k.safe, 4);
      // (and carried on down the road a little, so it is not left spinning against the hub; never sideways, as the
      // water is right there on the sweeper)
      k.kx += h.tx * 6;
      k.kz += h.tz * 6;
      r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
    }
    return;
  }
  if (h.kind === 'wrecker') {
    if (!st.live || tough) return;
    const reach = h.r + R;
    if (dist >= reach) return;
    // a kart still reeling from the last blow is not carried along with the ball: it is set beside its path, along the
    // road, for the ball to swing on past
    if (hurt(k) || k.safe > 0) {
      const ahead = dx * h.tx + dz * h.tz >= 0 ? 1 : -1;
      k.x = h.x + h.tx * ahead * (reach + 0.6);
      k.z = h.z + h.tz * ahead * (reach + 0.6);
      return;
    }
    // thrown clear of the ball, the harder the faster it is swinging
    const nx = dist > 1e-6 ? dx / dist : -h.tz;
    const nz = dist > 1e-6 ? dz / dist : h.tx;
    k.x = h.x + nx * reach;
    k.z = h.z + nz * reach;
    if (hitKart(r, k, 'tumble', -1)) {
      const knock = Math.min(WRECK_KNOCK + Math.abs(hazardV(h, r.time)), WRECK_MAX);
      k.kx += nx * knock;
      k.kz += nz * knock;
      k.safe += 0.6;
      r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
    }
    return;
  }
  // a hammer: nothing while it hovers; under it as it comes down you are flattened; on the ground (or still low) it is
  // solid, and squashes you against it if you hit it hard. A hop does not help: the head comes from above.
  if (!st.live && !st.solid) return;
  const reach = h.r + R;
  if (tough || dist >= reach) return;
  if (st.phase === 'slam') return caught('squash');
  const kx = k.kx;
  const kz = k.kz;
  const into = shove(r, k, h, dx, dz, dist, reach);
  if (into > 5) {
    // (a glancing blow off the head does not fling the kart aside: on the causeway that is straight into the Dig)
    k.kx = kx + (k.kx - kx) * 0.35;
    k.kz = kz + (k.kz - kz) * 0.35;
    if (!hitKart(r, k, 'squash', -1)) r.events.push({ t: 'wall', k: k.idx, power: into });
    else r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
  }
}

/** Seconds after a fall a CPU keeps well clear of the edge (and the edge holds it like a wall). */
const CARE_T = 12;

/**
 * Off the road: a splash into the water (or a drop into a pit or a trench), and you sit there until the crane fishes you
 * out and sets you back on the road (where it goes is decided now, for the moment you touch down). It costs coins, and a
 * banana or shell held out behind is lost, but the item in your hand stays dry. Off the side over a trench's plates, or
 * on the run-up to one, you are put back far enough before it for a run at the jump. A CPU keeps well clear of the edge
 * for a while after (and the better ones time a drop start).
 */
function fallIn(r: Race, k: Kart, past: Past, at: Spot, hole: Hazard | null = null) {
  if (k.sunk > 0) return;
  const t = r.track;
  // (only from the run-up, past where the crane puts you back: never carried forward)
  const trench = hole ?? r.holes.find((h) => deltaS(t, h.back ?? h.s, at.s) > 0 && deltaS(t, h.s, at.s) <= (h.len ?? 0)) ?? null;
  const from = trench ? (trench.back ?? at.s) : at.s;
  k.fell = { past, hole: hole !== null, v: Math.abs(k.v), to: spotFor(r, k, from, at.d, r.time + r.tier.fallT) };
  k.sunk = r.tier.fallT;
  k.falls++;
  // a kart on its lap of honour after the flag gets fished out all the same, but keeps its coins
  if (k.done === null) k.coins = Math.max(0, k.coins - r.tier.fallCoins);
  if (k.trail) {
    k.trail = false;
    k.item = null;
    k.uses = 0;
  }
  k.drop = 0;
  k.dropHit = false;
  k.dropMiss = false;
  if (k.ai && k.kind === 'cpu') {
    k.ai.care = CARE_T;
    k.ai.dropGo = r.rand() < k.ai.skill;
  }
  k.v = 0;
  k.kx = 0;
  k.kz = 0;
  k.vy = 0;
  k.y = 0;
  k.drift = 0;
  k.charge = 0;
  k.boost = 0;
  k.mud = false;
  k.sand = false;
  k.stuck = 0;
  r.events.push(past === 'water' ? { t: 'splash', k: k.idx } : { t: 'fall', k: k.idx, kind: past });
}

/**
 * A kart touching a bus (or a golf cart driving its laps) is pushed back out the nearer way (off its nose or tail, or
 * out of its side) and knocked away as hard as the two closed on each other: a bus coming up behind shoves you along.
 * Run into one (or get run down) and you spin out to the sound of its horn.
 */
function busHit(r: Race, k: Kart, h: LiveHazard) {
  const at = inBus(h, k.x, k.z, KART_R * scaleOf(k));
  if (!at) return;
  let nx: number;
  let nz: number;
  if (at.inL < at.inW) {
    const sg = Math.sign(at.along) || -1;
    nx = h.tx * sg;
    nz = h.tz * sg;
  } else {
    const sg = Math.sign(at.across) || 1;
    nx = -h.tz * sg;
    nz = h.tx * sg;
  }
  const over = Math.min(at.inL, at.inW);
  k.x += nx * over;
  k.z += nz * over;
  const vx = Math.sin(k.h) * k.v + k.kx;
  const vz = Math.cos(k.h) * k.v + k.kz;
  // the kart's own speed into the bus, and how fast the two close once the bus's own speed is counted
  const own = -(vx * nx + vz * nz);
  const into = own + (h.drive ?? 0) * (h.tx * nx + h.tz * nz);
  if (into <= 0) return;
  k.kx += nx * into * 1.3;
  k.kz += nz * into * 1.3;
  if (own > 0) k.v *= 1 - (0.6 * own) / (Math.hypot(vx, vz) || 1);
  // the bus's two-tone horn, or a golf cart's beep-beep
  if (into > 3 && hitKart(r, k, 'spin', -1)) r.events.push({ t: h.kind === 'bus' ? 'honk' : 'toot', k: k.idx });
  else if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
}

/** Seconds a kart set back on the road takes to get going: nothing should come through its spot before then. */
const SET_T = 1.5;

/** How far across the road (left, right) a kart can be set down at s: well inside the road, and well clear of a drop. */
function setDown(r: Race, s: number): [number, number] {
  const t = r.track;
  const i = Math.floor(wrapS(t, s) / t.step) % t.n;
  let lo = -(t.half - 1.5);
  let hi = t.half - 1.5;
  if (t.pastLo[i]) lo = Math.max(lo, t.lo[i] + 3);
  if (t.pastHi[i]) hi = Math.min(hi, t.hi[i] - 3);
  return [lo, hi];
}

/**
 * Whether (s, d) is a safe spot to set kart k down at race time `at`: no bus or cart driving its rounds alongside or just
 * behind in that lane, nothing solid or slippery just ahead, nobody crossing there, no ball coming down there while it
 * gets going and no trench just ahead in that lane (it needs a run at the jump).
 */
function clearFor(r: Race, k: Kart, s: number, d: number, at = r.time) {
  const t = r.track;
  for (const h of r.hazards) {
    if (timed(h.kind)) {
      // nothing a set piece will block in that lane while the kart gets going (they run on the clock, so this is known)
      const ds = deltaS(t, s, h.s);
      if (ds < -2 || ds > 12) continue;
      for (let u = 0; u <= SET_T + 1; u += 0.25) for (const [lo, hi] of hazSpans(r, h, at + u, k.lap)) if (d > lo - KART_R - 1 && d < hi + KART_R + 1) return false;
      continue;
    }
    if (!awake(h, k.lap) || h.kind === 'water' || h.kind === 'mud' || h.kind === 'sand' || h.kind === 'wet') continue;
    const room = h.r + KART_R + 1;
    if (h.kind === 'trench') {
      const ds = deltaS(t, s, h.s);
      // (on the run-up to it or over it; once past its far end the road is clear)
      if (ds > -(h.len ?? 0) && ds < 14 && Math.abs(h.d - d) < room) return false;
      continue;
    }
    if (drives(h)) {
      const ds = deltaS(t, hazardS(t, h, at), s);
      if (ds > -(lengthOf(h) / 2 + 6) && ds < lengthOf(h) / 2 + 12 && Math.abs(h.d - d) < room + 0.5) return false;
      continue;
    }
    const ds = deltaS(t, s, h.along);
    if (ds < -2 || ds > 12) continue;
    if (h.kind === 'ball') {
      if (Math.abs(h.d - d) < room && ballDue(h, at, at + SET_T)) return false;
      continue;
    }
    for (let u = 0; u <= SET_T; u += 0.25) if (Math.abs(hazardD(h, at + u) - d) < room) return false;
  }
  return true;
}

/**
 * Where to set kart k back down on the road, from (s, d) where it went off, for race time `at`: there, or as near as is
 * safe. In its own lane, the middle or the other side, and if none of those is clear (a cart coming, golfers crossing, a
 * ball about to land) a few meters further back.
 */
function spotFor(r: Race, k: Kart, s0: number, d0: number, at = r.time): [number, number] {
  const t = r.track;
  for (let back = 0; back <= 40; back += 4) {
    const s = wrapS(t, s0 - back);
    const [lo, hi] = setDown(r, s);
    const d = clamp(d0, lo, hi);
    for (const lane of [d, 0, clamp(-d, lo, hi)]) if (clearFor(r, k, s, lane, at)) return [s, lane];
  }
  const [lo, hi] = setDown(r, s0);
  return [wrapS(t, s0), clamp(d0, lo, hi)];
}

/**
 * Puts a kart that is stuck, lost or fished out of a fall back on the road, facing the right way, with a moment's
 * grace: at `spot` ([s, d]), or where it is if that is safe and as near as is safe if not (see spotFor).
 */
export function rescue(r: Race, k: Kart, spot = spotFor(r, k, k.s, k.d)) {
  const t = r.track;
  const p = pointAt(t, spot[0], spot[1]);
  k.x = p.x;
  k.z = p.z;
  k.i = p.i;
  k.h = headingOf(p.tx, p.tz);
  k.v = 0;
  k.kx = 0;
  k.kz = 0;
  k.drift = 0;
  k.charge = 0;
  k.stuck = 0;
  // back on the ground and the right way up, whatever happened on the way in
  k.y = 0;
  k.vy = 0;
  k.tumble = 0;
  k.safe = Math.max(k.safe, 1.2);
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

const massOf = (k: Kart) => (k.star > 0 || k.bullet > 0 || k.mega > 0 ? 4 : k.shrink > 0 ? 0.4 : 1);
/** Stars and bullets send anyone they touch flying. */
const crushes = (k: Kart) => k.star > 0 || k.bullet > 0;

const slamPad = (S: Kart, V: Kart) => (!local(S) && local(V) ? SLAM_PAD : 0);

function bumpKarts(r: Race) {
  const ks = r.karts;
  for (let a = 0; a < ks.length; a++) {
    for (let b = a + 1; b < ks.length; b++) {
      const A = ks[a];
      const B = ks[b];
      if (!local(A) && !local(B)) continue;
      if (A.done !== null && B.done !== null) continue;
      // a kart in the water is out of everyone's way until it is fished out
      if (A.sunk > 0 || B.sunk > 0) continue;
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
      // stars and bullets send whoever they touch flying, a mega kart flattens them, and a full-size kart squashes
      // a shrunken one
      if (crushes(A) && !crushes(B) && local(B)) hitKart(r, B, 'tumble', A.idx);
      else if (crushes(B) && !crushes(A) && local(A)) hitKart(r, A, 'tumble', B.idx);
      else if (A.mega > 0 && B.mega <= 0 && local(B)) hitKart(r, B, 'squash', A.idx);
      else if (B.mega > 0 && A.mega <= 0 && local(A)) hitKart(r, A, 'squash', B.idx);
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

/**
 * Hits a kart this client simulates. Stars shrug everything off; a kart already reeling is not hit twice, and one that
 * has fallen off the road is out of it until it is set back down.
 */
export function hitKart(r: Race, k: Kart, how: HitHow, by: number) {
  if (!local(k) || k.sunk > 0 || k.star > 0 || k.bullet > 0 || k.done !== null) return false;
  // a mega kart only notices explosions, and they shrink it back down
  if (k.mega > 0 && how !== 'boom') return false;
  if (how !== 'boom' && (hurt(k) || k.safe > 0)) return false;
  k.mega = 0;
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
  // on the harder courses a hit keeps you down for longer
  const harsh = r.tier.harsh;
  const down = (how === 'spin' ? 1.05 : how === 'squash' ? 0.8 : how === 'boom' ? 1.8 : 1.3) * harsh;
  if (how === 'spin' || how === 'squash') {
    k.spin = down;
    k.v *= how === 'squash' ? 0.5 : 0.4;
    k.coins = Math.max(0, k.coins - 1);
    if (how === 'squash') k.squash = 1.6 * harsh;
  } else {
    k.tumble = down;
    k.vy = how === 'boom' ? 9 : 6.5;
    k.y = Math.max(k.y, 0.01);
    k.v *= 0.15;
    k.coins = Math.max(0, k.coins - 3);
  }
  k.safe = down + 0.7;
  r.events.push({ t: 'hit', k: k.idx, how, by });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Items

/** Item odds by how far back you are: leaders get defense, the back of the pack gets the big guns. */
const ODDS: [number, Partial<Record<Item, number>>][] = [
  [0.15, { banana: 28, bananas: 8, green: 28, greens: 6, red: 10, mushroom: 6, coin: 10, horn: 4 }],
  [0.45, { banana: 10, bananas: 8, green: 14, greens: 10, red: 22, bomb: 8, mushroom: 14, triple: 6, coin: 4, ink: 4 }],
  [0.75, { greens: 6, red: 20, bomb: 8, mushroom: 12, triple: 16, golden: 6, star: 8, mega: 5, ink: 8, bolt: 3, blue: 5, horn: 3 }],
  [1.01, { red: 10, triple: 16, golden: 12, star: 16, mega: 10, bullet: 14, bolt: 10, blue: 8, ink: 4 }],
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
  k.uses = USES[item] ?? 1;
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
    life: thing.life ?? (thing.kind === 'banana' ? Infinity : thing.kind === 'green' ? 7 : thing.kind === 'red' ? 10 : thing.kind === 'bomb' ? BOMB_LIFE : 25),
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
  if (item === 'banana' || item === 'bananas') {
    if (k.input.fwd && !back) spawn(r, { ...base, kind: 'banana', grace: 1.2, x: k.x + fx * 2.6, z: k.z + fz * 2.6, y: 0.8, vx: fx * 20 + Math.sin(k.h) * k.v * 0.5, vz: fz * 20 + Math.cos(k.h) * k.v * 0.5, vy: 7 });
    else spawn(r, { ...base, kind: 'banana', x: k.x - fx * 2.5, z: k.z - fz * 2.5, vx: 0, vz: 0 });
  } else if (item === 'bomb') {
    // lobbed well ahead, or dropped behind
    if (back) spawn(r, { ...base, kind: 'bomb', grace: 1.2, x: k.x - fx * 2.6, z: k.z - fz * 2.6, vx: 0, vz: 0 });
    else spawn(r, { ...base, kind: 'bomb', grace: 0.8, x: k.x + fx * 2.6, z: k.z + fz * 2.6, y: 1, vx: fx * 24 + fx * k.v * 0.5, vz: fz * 24 + fz * k.v * 0.5, vy: 8 });
  } else if (item === 'green' || item === 'greens' || (item === 'red' && back)) {
    const dir = back ? -1 : 1;
    spawn(r, { ...base, kind: 'green', x: k.x + fx * 2.6 * dir, z: k.z + fz * 2.6 * dir, y: 0.35, vx: fx * GREEN_V * dir, vz: fz * GREEN_V * dir });
  } else if (item === 'red') {
    const ahead = r.karts.find((o) => o.place === k.place - 1 && o.done === null);
    spawn(r, { ...base, kind: 'red', x: k.x + fx * 2.6, z: k.z + fz * 2.6, y: 0.35, vx: fx * RED_V, vz: fz * RED_V, target: ahead ? ahead.idx : -1 });
  } else if (item === 'mushroom' || item === 'triple' || item === 'golden') {
    k.boost = Math.max(k.boost, MUSHROOM_T);
    k.v = Math.max(k.v, CLASSES[r.cc].top * 0.9);
    if (item === 'golden') {
      // as many boosts as you like until the timer runs out, then it is gone
      if (k.goldT === 0) k.goldT = GOLD_T;
      r.events.push({ t: 'use', k: k.idx, item });
      return item;
    }
  } else if (item === 'coin') {
    k.coins = Math.min(MAX_COINS, k.coins + 2);
    k.earned += 2;
    r.events.push({ t: 'coin', k: k.idx });
  } else if (item === 'star') {
    k.star = STAR_T;
  } else if (item === 'mega') {
    k.mega = MEGA_T;
  } else if (item === 'bullet') {
    k.bullet = BULLET_T;
    k.drift = 0;
    k.charge = 0;
  } else if (item === 'ink') {
    inkFrom(r, k.idx);
  } else if (item === 'horn') {
    hornAt(r, k.idx, k.x, k.z);
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
  if (item === 'ink') r.events.push({ t: 'ink', k: k.idx });
  if (item === 'horn') r.events.push({ t: 'horn', k: k.idx, x: k.x, z: k.z });
  return item;
}

/** Ink over every kart ahead of the user that this client drives (stars and bullets stay clean). */
export function inkFrom(r: Race, from: number) {
  const user = r.karts[from];
  if (!user) return;
  for (const o of r.karts) {
    if (o.idx === from || !local(o) || o.done !== null || o.star > 0 || o.bullet > 0 || o.place >= user.place) continue;
    o.ink = INK_T;
    r.events.push({ t: 'inked', k: o.idx });
  }
}

/** The horn: a shockwave that tumbles nearby karts this client drives and clears away every item, blue shells too. */
export function hornAt(r: Race, from: number, x: number, z: number) {
  for (const o of r.karts) if (o.idx !== from && Math.hypot(o.x - x, o.z - z) < HORN_R) hitKart(r, o, 'tumble', from);
  for (const t of [...r.things]) if (Math.hypot(t.x - x, t.z - z) < HORN_R) removeThing(r, t.id, false);
  r.events.push({ t: 'blast', x, z });
}

/** Lightning: everyone but the user (and anyone under a star) spins, shrinks and drops their item. */
export function strike(r: Race, from: number) {
  for (const o of r.karts) {
    if (o.idx === from || !local(o) || o.sunk > 0 || o.star > 0 || o.bullet > 0 || o.done !== null) continue;
    o.mega = 0;
    o.goldT = 0;
    o.shrink = SHRINK_T * (o.place <= 3 ? 1.2 : 0.8);
    o.spin = Math.max(o.spin, 0.6 * r.tier.harsh);
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
    if (th.life <= 0 && th.kind !== 'bomb') {
      removeThing(r, th.id, th.local);
      continue;
    }
    if (th.kind === 'banana' || th.kind === 'bomb') {
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
      // a wall stops it; past the brink of a drop, or down a trench, it is gone once it lands
      const edge = edgeAt(t, at.s, at.d >= 0 ? 1 : -1);
      if (edge.past === 'wall') {
        if (Math.abs(at.d) > edge.lim - 0.6) {
          const sg = Math.sign(at.d);
          th.x -= -at.tz * sg * (Math.abs(at.d) - edge.lim + 0.6);
          th.z -= at.tx * sg * (Math.abs(at.d) - edge.lim + 0.6);
        }
      } else if (th.y === 0 && Math.abs(at.d) > edge.lim) {
        sink(r, th, edge.past);
        continue;
      }
      if (th.y === 0 && r.holes.some((h) => inTrench(t, h, at.s, at.d))) {
        sink(r, th, 'pit');
        continue;
      }
      if (th.kind === 'bomb') {
        const near = th.grace <= 0 && th.y === 0 && r.karts.some((k) => k.done === null && Math.hypot(k.x - th.x, k.z - th.z) < BOMB_NEAR);
        // the thrower's client sets it off; everyone else hears about it ('boom' and 'gone')
        if (th.local && (th.life <= 0 || near)) {
          removeThing(r, th.id, true);
          r.events.push({ t: 'boom', x: th.x, z: th.z });
          boom(r, th.x, th.z, th.owner);
        } else if (!th.local && th.life < -2) removeThing(r, th.id, false);
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
    // shells break on anything solid: bales, boulders, planters, cows, bikes and buses
    const lap = r.karts[th.owner]?.lap ?? 1;
    if (r.hazards.some((h) => blocks(r, h, th.x, th.z, 0.45, lap, th.i))) {
      removeThing(r, th.id, th.local);
      continue;
    }
    const at = locate(t, th.x, th.z, th.i);
    th.i = at.i;
    // over the brink of a drop, or into a trench, a shell is gone
    const edge = edgeAt(t, at.s, at.d >= 0 ? 1 : -1);
    if ((edge.past !== 'wall' && Math.abs(at.d) > edge.lim) || r.holes.some((h) => inTrench(t, h, at.s, at.d))) {
      sink(r, th, edge.past === 'wall' ? 'pit' : edge.past);
      continue;
    }
    if (edge.past === 'wall' && Math.abs(at.d) > edge.lim - 0.5) {
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
      th.x -= nx * (Math.abs(at.d) - edge.lim + 0.5);
      th.z -= nz * (Math.abs(at.d) - edge.lim + 0.5);
    }
  }
}

/** A banana, a bomb or a shell over the edge where the road drops away: it sinks out of sight (a splash or a puff). */
function sink(r: Race, th: Thing, kind: Past) {
  removeThing(r, th.id, th.local);
  r.events.push({ t: 'sank', x: th.x, z: th.z, kind });
}

function hitThings(r: Race) {
  // shells break on bananas and other shells
  for (let a = 0; a < r.things.length; a++) {
    for (let b = a + 1; b < r.things.length; b++) {
      const A = r.things[a];
      const B = r.things[b];
      if (A.kind === 'blue' || B.kind === 'blue' || A.kind === 'bomb' || B.kind === 'bomb' || (A.kind === 'banana' && B.kind === 'banana')) continue;
      if (A.y > 1.2 || B.y > 1.2) continue;
      if (Math.hypot(A.x - B.x, A.z - B.z) < 1.3) {
        removeThing(r, A.id, true);
        removeThing(r, B.id, true);
        return hitThings(r);
      }
    }
  }
  for (const k of r.karts) {
    if (!local(k) || k.done !== null || k.sunk > 0) continue;
    const reach = KART_R * scaleOf(k) + 0.6;
    for (const th of [...r.things]) {
      if (th.kind === 'blue' || th.kind === 'bomb' || th.y > 1.2 + k.y) continue;
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
      if (!local(k) || k.sunk > 0 || (k.x - b.x) ** 2 + (k.z - b.z) ** 2 > (1.7 + KART_R) ** 2) continue;
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
      if (!local(k) || k.sunk > 0 || (k.x - c.x) ** 2 + (k.z - c.z) ** 2 > (0.7 + KART_R) ** 2) continue;
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

const AUTO: Ai = { pace: 1, skill: 0.6, band: 1, lane: 0, laneTo: 0, laneT: 0, itemT: 1, held: 0, driftT: 0, care: 0, dropGo: false, reactS: -1e9, react: true, err: 0, errLap: 0, blunders: {}, waitT: 0, backT: 0, backs: 0, backAt: -99, heldT: 0, goT: 0 };

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

/** How far across the road (to its right) a kart heads for every meter it goes along it. */
function acrossRoad(t: Track, k: Kart) {
  const tx = t.tx[k.i];
  const tz = t.tz[k.i];
  const along = Math.sin(k.h) * tx + Math.cos(k.h) * tz;
  return (Math.cos(k.h) * tx - Math.sin(k.h) * tz) / Math.max(0.3, along);
}

/**
 * A lane (as a fraction of the road's half width) clear of the bales, boulders, planters, cows, bikes, buses, carts,
 * golfers, flagsticks and oil slicks coming up, and of the puddles and bunkers too when there is room, as close as it
 * can be to the lane the kart wanted; null when nothing is in the way. Anything on the move is dodged where it will be
 * by the time the kart gets there, with a little to spare for getting the timing wrong, and close up the kart keeps to
 * its side of things rather than cut across in front of them. A bus or a cart drives on down the road, so the kart
 * closes on it only as fast as it outruns it, and it stays in the way from its tail to its nose: the kart pulls out
 * and passes on the free side. A golf ball's landing spot is in the way only if a ball comes down on it about when the
 * kart gets there, and a pond beside the road keeps the kart over toward the other side. Also says how far the kart
 * goes before it reaches the nearest thing in the way, and whether the lane misses everything solid.
 */
type Dodge = { lane: number; ds: number; clear: boolean; wet?: boolean; wait?: boolean };
/** A stretch across the road something covers, how far from it the kart keeps, and how far on it is. */
type Span = { lo: number; hi: number; room: number; far: number };
function dodgeHazard(r: Race, k: Kart, lane: number, band: Band = FREE): Dodge | null {
  const t = r.track;
  const ai = k.ai!;
  const v = Math.max(8, Math.abs(k.v));
  const reach = 3 + v * 1.2;
  // what is coming up, as the stretch across the road it covers while the kart goes by
  const ahead: { lo: number; hi: number; room: number; solid: boolean; close?: boolean; soft?: boolean; wet?: boolean }[] = [];
  // and the set pieces, as what they block when the kart gets there, and when it gets there having eased off
  const pieces: Span[] = [];
  const later: Span[] = [];
  let piece = false;
  const gap = (at: number, a: { lo: number; hi: number }) => Math.max(0, a.lo - at, at - a.hi);
  let near = Infinity;
  // the set pieces coming up, planned for below: one lane past all of them within 30 m if there is one, else past the
  // nearest and whatever is right behind it, weaving for the rest once it is through
  const coming: { h: LiveHazard; far: number; when: (speed: number) => number }[] = [];
  for (const h of r.hazards) {
    // (the edges, ponds and trenches included, are edgeBand's; a wet patch is driven through)
    if (h.kind === 'water' || h.kind === 'trench' || h.kind === 'wet') continue;
    // (a sprinkler's hub stands there before its jet comes on)
    if (!awake(h, k.lap) && h.kind !== 'rotor') continue;
    // a bus or a cart is in the way from its tail to its nose, so still while the kart is alongside it
    const long = drives(h) ? lengthOf(h) / 2 + KART_R : 0;
    const ds = deltaS(t, k.s, h.along);
    if (ds + long < -1) continue;
    const until = Math.max(0, ds - long);
    // how long the kart takes to get there at a speed: a bus drives on ahead, so the kart only closes on it as fast as
    // it outruns it
    const when = (speed: number) => until / Math.max(2, speed - (h.drive ?? 0));
    // and so how far the kart goes before it gets there (for anything standing still, just how far ahead it is)
    const far = until * (v / Math.max(2, v - (h.drive ?? 0)));
    if (far > reach) continue;
    if (timed(h.kind)) {
      coming.push({ h, far, when });
      continue;
    }
    if ((h.kind === 'mud' || h.kind === 'sand') && ai.skill < 0.4) continue;
    // a ball's landing spot only matters if one lands about when the kart gets there
    if (h.kind === 'ball' && !ballDue(h, r.time + when(v + 8) - 0.35, r.time + when(Math.max(6, v - 6)) + 0.3)) continue;
    // how far to keep from it: a bus or a cart is passed with a wider berth, as it is long and its corners stick out
    // on a bend. Something solid standing still just ahead is not to be cut across in front of, whatever is further
    // on, so long as there is room to get by it on this side; and a puddle or a bunker only slows you, so better to
    // clip one than to hit something
    const room = h.r + KART_R + (h.kind === 'bus' ? 2 : drives(h) ? 1.5 : 1);
    const side = k.d > h.d ? 0.85 * t.half - h.d : h.d + 0.85 * t.half;
    const close = solid(h.kind) && !h.swing && !h.drive && far < 6 + v * 0.5 && side >= room;
    const soft = h.kind === 'mud' || h.kind === 'sand';
    // from the soonest the kart could get there (a boost) to the latest (braking); a lane through an oil slick is no
    // way past (it spins you out as surely as anything solid)
    const a = { lo: Infinity, hi: -Infinity, room, solid: solid(h.kind) || h.kind === 'ball' || h.kind === 'oil', close, soft };
    for (const time of [when(v + 8) - 0.1, when(v), when(Math.max(6, v - 6)) + 0.1]) {
      const d = hazardD(h, r.time + time);
      a.lo = Math.min(a.lo, d);
      a.hi = Math.max(a.hi, d);
    }
    // a puddle with no way round it is driven through
    if ((h.kind === 'mud' || h.kind === 'sand') && Math.max(t.half - (a.hi + h.r), a.lo - h.r + t.half) < 2 * KART_R + 1) continue;
    ahead.push(a);
    if (gap(lane * t.half, a) < a.room || (far < reach * 0.6 && gap(k.d, a) < a.room)) near = Math.min(near, far);
  }
  if (coming.length) {
    const first = Math.min(...coming.map((c) => c.far));
    // a set piece is judged by what it will be doing when the kart gets there (they all run on the clock), a touch
    // early or late by this lap's misjudgement, with a little slack either side for the less able. Now and then one
    // is simply not seen coming (decided once for each, each lap)
    if (ai.errLap !== k.lap) {
      ai.errLap = k.lap;
      ai.err = (r.rand() * 2 - 1) * 0.25 * (1 - ai.skill);
    }
    for (const { h, far, when } of coming) {
      if (far > first + 30) continue;
      const key = `${Math.round(h.s)}:${k.lap}`;
      if (!(key in ai.blunders)) ai.blunders[key] = r.rand() < 0.08 * (1 - ai.skill);
      if (ai.blunders[key]) continue;
      piece = true;
      const slop = 0.1 + 0.25 * (1 - ai.skill);
      const room = KART_R + 0.7;
      // (a sprinkler's jet is met along a stretch of road, not on one line: every so far along it)
      const arm = h.arm ?? 5;
      const offs = h.kind === 'rotor' ? [-0.9 * arm, -0.6 * arm, -0.3 * arm, 0, 0.3 * arm, 0.6 * arm, 0.9 * arm] : [0];
      const spansAt = (t0: number, out: Span[]) => {
        for (const o of offs) for (const dt of [-slop, 0, slop]) for (const [lo, hi] of hazSpans(r, h, t0 + dt + o / v, k.lap, o)) out.push({ lo, hi, room, far });
      };
      const n0 = pieces.length;
      spansAt(r.time + when(v) + ai.err, pieces);
      // (never slow for the ball or a jet: a slow kart in their sweep is hit for sure, a fast one is through in a blink)
      spansAt(h.kind === 'wrecker' || h.kind === 'rotor' ? r.time + when(v) + ai.err : r.time + when(Math.max(6, v - 7)) + ai.err, later);
      for (let n = n0; n < pieces.length; n++) if (gap(lane * t.half, pieces[n]) < room || (far < reach * 0.6 && gap(k.d, pieces[n]) < room)) near = Math.min(near, far);
    }
  }
  // where the road drops away (water, a pit): keep well over from that side all the way past it, and further still for a
  // while after going in
  {
    const keep = EDGE_KEEP + (ai.care > 0 ? 1.2 : 0);
    const i0 = Math.floor(k.s / t.step);
    const n = Math.ceil(reach / t.step);
    for (const side of [-1, 1]) {
      let first = -1;
      let edge = Infinity;
      for (let j = 0; j <= n; j++) {
        if (!dropAt(t, i0 + j, side)) continue;
        if (first < 0) first = j;
        const i = (i0 + j) % t.n;
        edge = Math.min(edge, side < 0 ? -t.lo[i] : t.hi[i]);
      }
      if (first < 0) continue;
      const a = side < 0 ? { lo: -99, hi: -edge, room: keep, solid: false, wet: true } : { lo: edge, hi: 99, room: keep, solid: false, wet: true };
      ahead.push(a);
      if (gap(lane * t.half, a) < a.room) near = Math.min(near, Math.max(1, first * t.step));
    }
  }
  if (near === Infinity) return null;
  // the closer it is, the dearer a lane on the far side of it
  const stay = 0.05 + 1.5 / Math.max(4, near);
  // (only lanes inside the edges' safe band)
  const [cLo, cHi] = [Math.max(-0.85, band.lo / t.half), Math.min(0.85, band.hi / t.half)];
  const lanes: number[] = [];
  // (c is summed in floating point, so the last is a hair over 0.85: compare with a little slack or the right-hand
  // lane is lost on every course, walls or not)
  for (let c = -0.85; c <= 0.851; c += 0.05) if (c >= cLo - 1e-6 && c <= cHi + 1e-6) lanes.push(c);
  // (round the set pieces the curb will do too: the gap a row of bollards leaves can be the one against the wall)
  if (piece) for (const c of [-0.95, -0.9, 0.9, 0.95]) if (c >= band.lo / t.half - 1e-6 && c <= band.hi / t.half + 1e-6) lanes.push(c);
  if (!lanes.length) lanes.push(clamp((cLo + cHi) / 2, -0.85, 0.85));
  // (and, round the set pieces, how far across the road the kart can get before the nearest of them, further for its
  // distance the slower it goes: a clear lane it cannot reach in time is no better than a blocked one)
  const across = piece ? 1 + coming.reduce((m, c) => Math.min(m, c.far), Infinity) * clamp(7 / v, 0.2, 0.6) : Infinity;
  /** The best lane with the set pieces as `spans` has them. */
  const judge = (spans: Span[]) => {
    let best: Dodge = { lane, ds: near, clear: false };
    let bestCost = Infinity;
    for (const c of lanes) {
      const at = c * t.half;
      // how far inside anything's clearance this lane goes, then how far it strays from the lane wanted
      let into = ahead.reduce((sum, a) => sum + Math.max(0, a.room - gap(at, a)) * (a.soft ? 0.3 : 1) + (a.close && (at - a.lo) * (k.d - a.lo) < 0 ? a.room : 0), 0);
      for (const a of spans) into += Math.max(0, a.room - gap(at, a));
      if (piece) into += 3 * Math.max(0, Math.abs(at - k.d) - across);
      const cost = into * 10 + Math.abs(c - lane) + Math.abs(at - k.d) * stay;
      if (cost < bestCost) {
        bestCost = cost;
        best = { lane: c, ds: near, clear: ahead.every((a) => !a.solid || gap(at, a) >= a.room - 1) && spans.every((a) => gap(at, a) >= a.room - 0.6), wet: ahead.some((a) => a.wet && gap(k.d, a) < a.room) };
      }
    }
    return best;
  };
  const best = judge(pieces);
  if (!piece || best.clear) return best;
  // no one lane past everything coming: past the nearest of it, then, and weave for the rest after
  const first = pieces.reduce((m, a) => Math.min(m, a.far), Infinity);
  const soon = (a: Span) => a.far <= first + 14;
  if (pieces.some((a) => !soon(a))) {
    const nearest = judge(pieces.filter(soon));
    if (nearest.clear) return nearest;
  }
  // nothing gets through the set pieces at this speed: if easing off opens a way (the hammer up by then, the bank
  // down), take that lane and slow for it; if not, the cheapest lane now and no slowing, as stopping dead in front of
  // one only causes pile-ups
  const eased = judge(later.filter(soon));
  if (eased.clear) return { ...eased, clear: false, wait: true };
  return { ...best, clear: judge([]).clear };
}

/** Whether the road drops away (no wall) on the outside of a bend (turning `turn`: 1 right) within `ahead` m. */
function dropOutside(r: Race, s: number, ahead: number, turn: number) {
  const t = r.track;
  const i0 = Math.floor(wrapS(t, s) / t.step);
  for (let j = 0; j * t.step <= ahead; j++) if (dropAt(t, i0 + j, -turn)) return true;
  return false;
}

/**
 * Where the road drops away (water, a pit), a CPU keeps this far (and more the faster and the less able it is) from the
 * brink; from a wall, just clear of it. dodgeHazard keeps EDGE_KEEP from it where it can.
 */
const EDGE_KEEP = 2.6;
type Band = { lo: number; hi: number; open: boolean; hole: boolean };
const FREE: Band = { lo: -Infinity, hi: Infinity, open: false, hole: false };
const edgeRoom = (k: Kart, ai: Ai) => KART_R + 0.9 + 0.025 * Math.abs(k.v) + 0.8 * (1 - ai.skill) + (ai.care > 0 ? 1.2 : 0);

/**
 * The stretch across the road (lateral offsets lo to hi) a CPU keeps to over the road ahead: clear of the brink wherever
 * it drops away, by `room`, and of the walls. Coming up to a trench it lines up with the ramp over it (or, the best of
 * them, or one going too slowly to make the jump, with a steel plate beside the hole). open: a drop somewhere in it.
 */
function edgeBand(r: Race, k: Kart, room: number): Band {
  const t = r.track;
  const v = Math.max(8, Math.abs(k.v));
  let lo = -Infinity;
  let hi = Infinity;
  let open = false;
  for (let a = 0; a <= 10 + v * 0.7; a += 3) {
    const i = Math.floor(wrapS(t, k.s + a) / t.step) % t.n;
    lo = Math.max(lo, t.lo[i] + (t.pastLo[i] ? room : KART_R + 0.4));
    hi = Math.min(hi, t.hi[i] - (t.pastHi[i] ? room : KART_R + 0.4));
    open ||= t.pastLo[i] !== 0 || t.pastHi[i] !== 0;
  }
  let hole = false;
  for (const h of r.holes) {
    const ds = deltaS(t, k.s, h.s);
    if (ds < -(h.len ?? 0) || ds > 14 + v * 1.2) continue;
    // (not while a set piece still stands between here and the hole: the way past that comes first, and the ramp after)
    if (r.hazards.some((p) => timed(p.kind) && deltaS(t, k.s, p.s) > -p.r && deltaS(t, k.s, p.s) < ds - 2)) continue;
    hole = true;
    const ramp = r.ramps.find((p) => Math.abs(deltaS(t, p.s, h.s)) < 3);
    const w = h.w ?? h.r;
    const plate = edgeAt(t, h.s + (h.len ?? 0) / 2, 1).lim;
    // (how fast it will be going at the lip with its foot down all the way, as it takes 13.5 m/s to clear the hole, and
    // whether it can get across to the ramp before it)
    // (no faster than it can go right now: shrunk, in the mud or struck by lightning it never gets there)
    const lip = Math.min(topOf(r, k), Math.sqrt(Math.max(0, k.v * Math.abs(k.v) + 2 * CLASSES[r.cc].accel * Math.max(0, ds - 0.5))));
    const slow = (k.v < 13.5 && ds < 10) || (hurt(k) && ds < 20);
    const off = ramp ? Math.abs(k.d - ramp.d) : Infinity;
    const reach = off < w || off < 0.25 * Math.max(0, ds - 3);
    if (ramp && reach && lip > 15 && !slow && !((k.ai?.skill ?? 0) >= 0.8 && Math.abs(k.d - h.d) > w + 0.5)) {
      lo = ramp.d - 0.9;
      hi = ramp.d + 0.9;
    } else {
      const sg = k.d >= h.d ? 1 : -1;
      const a = h.d + sg * (w + KART_R + 0.3);
      const b = sg * (plate - KART_R - 0.3);
      lo = Math.min(a, b);
      hi = Math.max(a, b);
    }
  }
  if (lo > hi) lo = hi = (lo + hi) / 2;
  return { lo, hi, open, hole };
}

/** How far kart k is from the brink of a drop on either side here (Infinity with walls both sides). */
function fromBrink(r: Race, k: Kart) {
  let near = Infinity;
  for (const side of [-1, 1]) {
    const e = edgeAt(r.track, k.s, side);
    if (e.past !== 'wall') near = Math.min(near, e.lim - k.d * side);
  }
  return near;
}

/**
 * A bend tighter than this (in meters) is a hairpin, and a CPU works out how late it can brake for one counting on this
 * much braking (a kart brakes at 26 m/s^2).
 */
const HAIRPIN = 18;
const BRAKE_PLAN = 18;

/** An Expert course. */
const expert = (r: Race) => COURSES[r.course].difficulty === 4;

/** Who the CPUs keep pace with: the furthest kart a person drives (you, solo; whoever leads them online). */
export function pacer(r: Race): Kart | null {
  let best: Kart | null = null;
  for (const k of r.karts) if (k.kind !== 'cpu' && (!best || k.prog > best.prog)) best = k;
  return best;
}

function think(r: Race, k: Kart, dt: number) {
  const t = r.track;
  const ai = (k.ai ??= { ...AUTO, blunders: {} });
  const inp = k.input;
  ai.care = Math.max(0, ai.care - dt);
  if (k.sunk > 0) {
    // in the water: nothing to do but be ready to time a drop start for the moment it is set back down
    inp.steer = 0;
    inp.brake = false;
    inp.drift = false;
    inp.use = false;
    inp.hop = ai.dropGo && k.sunk <= DROP_WINDOW * 0.6;
    return;
  }
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
    if (Math.abs(at.d - ai.lane * t.half) < 2.6) ai.laneTo = at.d > 0 ? -0.55 : 0.55;
  }
  ai.lane = approach(ai.lane, ai.laneTo, 0.9 * dt);

  const curve = curveAhead(t, k.s, 8, 40);
  // keep clear of the brink where the road drops away, and line up for a trench
  const band = edgeBand(r, k, edgeRoom(k, ai));
  let lane = clamp(clamp(ai.lane + clamp(curve.mean * 40, -0.55, 0.55) * ai.skill, -0.82, 0.82), band.lo / t.half, band.hi / t.half);
  let dodge = dodgeHazard(r, k, lane, band);
  if (dodge !== null) lane = dodge.lane;
  // aim closer in while dodging, beside whatever is in the way, to get across in time
  let look = dodge === null ? 7 + Math.abs(k.v) * 0.5 : clamp(dodge.ds, 4, 5 + Math.abs(k.v) * 0.25);
  let aim = lane * t.half;
  if (band.open) {
    // aiming at a point that far ahead cuts the inside of a tight bend by look^2/8R: with a drop beside it, look less far
    // ahead and aim that much wide of the line
    const pk = curveAhead(t, k.s, 0, look).peak;
    if (Math.abs(pk) > 0.02) {
      const R = 1 / Math.abs(pk);
      look = Math.min(look, Math.max(4, Math.sqrt(6.4 * R)));
      aim -= (Math.sign(pk) * look * look) / (8 * R);
    }
  }
  const p = pointAt(t, k.s + look, aim);
  const diff = wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h);
  // beside a drop it steers for the turn that takes it through the point it aims at, rather than just turning toward
  // it: a kart that only turns toward its aim lags round a tight bend and runs wide, and out there is no wall
  const sp = Math.abs(k.v);
  const rate = band.open ? (-2 * sp * Math.sin(diff)) / look : -diff * 2.6;
  const need = band.open ? rate / Math.max(0.3, TURN * Math.min(1, sp / 5) * (1 - 0.3 * Math.min(1, sp / 30))) : rate;
  if (k.drift !== 0) {
    // a drift always turns its way; steering only tightens or widens it
    inp.steer = clamp((rate - k.drift * DRIFT_BASE) / DRIFT_RANGE, -1, 1);
    ai.driftT += dt;
    const goal = ai.skill > 0.7 ? 2 : 1;
    const ending = Math.abs(curve.mean) < 0.01 || Math.sign(curve.mean) !== k.drift;
    // and a drift can't swerve, so it lets go of one to get across to its line round something in the way
    const swerve = dodge !== null && (!dodge.clear || !!dodge.wet) && dodge.ds < 8 + 0.9 * k.v && Math.abs(dodge.lane * t.half - k.d) > 1;
    // with a drop beside the road it holds the drift until it points down the road (letting go early fires the boost
    // off toward the outside); with the drop on the outside of the drift getting close it tightens the drift all the
    // way, and lets go only on the very brink
    const aligned = !band.open || Math.abs(diff) < 0.12;
    const out = edgeAt(t, k.s + sp * 0.2, -k.drift);
    const room = out.past === 'wall' ? Infinity : out.lim + k.d * k.drift;
    if (room < 2.4) inp.steer = k.drift;
    if ((turboLevel(k.charge) >= goal && ending && aligned) || k.drift * rate < -0.35 || ai.driftT > 3 || swerve || room < 1.1) inp.drift = false;
  } else if (k.y === 0) {
    inp.steer = clamp(need, -1, 1);
    const bend = curveAhead(t, k.s, 4, 30).mean;
    // no drifting into a corner with something in the way just ahead (a drift can't swerve), unless the kart is already
    // on a clean line past it
    // (and the less able don't drift at all where the road drops away)
    const open = (dodge === null || (dodge.clear && Math.abs(dodge.lane * t.half - k.d) < 1) || dodge.ds > 6 + k.v * 0.6) && !(band.open && ai.skill < 0.6);
    inp.drift = Math.abs(bend) > 0.02 && k.v > 14 && Math.sign(bend) === Math.sign(need) && r.rand() < ai.skill && open;
    inp.hop = inp.drift;
    ai.driftT = 0;
    if (inp.hop) inp.steer = Math.sign(bend);
  } else {
    inp.steer = clamp(need, -1, 1);
  }
  // slow for a bend too tight to take flat out: a kart turns about 1.55 rad/s at speed, and up to 1.85 in a drift; with
  // a drop (water, a pit) on the outside of it, a little slower still, and then even on a boost. For a real hairpin it
  // brakes as late as it can and still be down to that speed where the bend tightens
  const bendAhead = curveAhead(t, k.s, 0, 20 + k.v * 0.8).peak;
  const peak = Math.abs(bendAhead);
  const wet = peak > 0.02 && dropOutside(r, k.s, 20 + k.v * 0.8, Math.sign(bendAhead));
  // (and on wet road the wheels turn it less: see drive())
  const damp = r.hazards.some((h) => h.kind === 'wet' && awake(h, k.lap) && deltaS(t, k.s, h.s) > -h.r && deltaS(t, k.s, h.s) < 30);
  const cap = (k.drift !== 0 || inp.drift ? 1.85 : 1.55) * (wet ? 0.92 : 1) * (damp ? 0.7 : 1);
  let tooFast = peak > 0 && k.v > cap / peak;
  if (tooFast && peak > 1 / HAIRPIN) {
    tooFast = false;
    for (let a = 0; a <= 20 + k.v * 0.8 && !tooFast; a += t.step) {
      const c = Math.abs(t.curv[Math.floor(wrapS(t, k.s + a) / t.step) % t.n]);
      tooFast = c > 0 && k.v * k.v > (cap / c) ** 2 + 2 * BRAKE_PLAN * Math.max(0, a - 2);
    }
  }
  inp.brake = tooFast && (k.boost <= 0 || wet);
  // (waiting for a set piece to get out of the way, but never for long: the road is clear again by then)
  ai.waitT = dodge?.wait ? ai.waitT + dt : 0;
  if (dodge?.wait && ai.waitT > 3) dodge = { ...dodge, wait: false, clear: true };
  // crawling up to a bank of bollards standing in this lane (knocked back by it, say): hold short of it until it drops
  // rather than nose into it again and again, and go only when it will stay down for as long as getting across it takes
  // from here (but once on it, get off it). Held for long (stopped between two banks, say) it backs off for room to
  // steer into one bank's lane
  let held = false;
  // (and standing on the slab itself with the bank up, as it is after a tumble: straight back off it first)
  let backOut = false;
  const facing = Math.sin(k.h) * t.tx[k.i] + Math.cos(k.h) * t.tz[k.i] > 0.5;
  ai.goT = Math.max(0, ai.goT - dt);
  if (k.v < 8 && facing && ai.goT === 0) {
    for (const h of r.hazards) {
      if (h.kind !== 'bollard') continue;
      const ds = deltaS(t, k.s, h.s);
      // (any bank the kart's body touches, not just the one its middle is in)
      if (ds < -1 || ds > 6 || Math.abs(k.d - h.d) > (h.w ?? 0) / 2 + KART_R + 0.2) continue;
      const on = Math.abs(ds) < BANK.thick + KART_R + 0.3;
      const solid = hazState(r, h, r.time, k.lap).solid;
      if (on) {
        if (solid && ds > -0.2) backOut = true;
        continue;
      }
      if (solid) {
        held = true;
        continue;
      }
      const gap = ds + BANK.thick + KART_R + 0.3;
      const a = CLASSES[r.cc].accel;
      const need = (-Math.max(0, k.v) + Math.sqrt(k.v * k.v + 2 * a * gap)) / a;
      if (hazSpans(r, h, r.time + need, k.lap).length > 0 || hazSpans(r, h, r.time + need * 0.6, k.lap).length > 0) held = true;
    }
  }
  ai.heldT = held ? ai.heldT + dt : 0;
  if (ai.heldT > 1.5 && ai.backT === 0) {
    // (back, edging toward the lane it wants, far enough to come at that bank's lane with some room; then it goes)
    ai.heldT = 0;
    ai.backT = 0.6;
    ai.laneTo = lane * t.half > k.d ? 0.25 : -0.25;
  }
  // nosing a set piece that is solid right now at a crawl (spun into a sprinkler's hub, say, or knocked back by a
  // bank): back off it for a moment with the nose swinging away, or it never gets going again
  ai.backT = Math.max(0, ai.backT - dt);
  if (ai.backT === 0 && k.v < 6 && k.v > -1 && !hurt(k)) {
    const fx = Math.sin(k.h);
    const fz = Math.cos(k.h);
    for (const h of r.hazards) {
      if (!timed(h.kind)) continue;
      const dx = h.x - k.x;
      const dz = h.z - k.z;
      if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
      if (!hazState(r, h, r.time, k.lap).solid) continue;
      const along = dx * fx + dz * fz;
      const aside = -dx * fz + dz * fx;
      const bank = h.kind === 'bollard' ? pointAt(t, h.s, k.d) : null;
      const nose = bank ? (bank.x - k.x) * fx + (bank.z - k.z) * fz : along;
      const off = bank ? Math.abs(k.d - h.d) < (h.w ?? 0) / 2 + KART_R : Math.abs(aside) < h.r + KART_R + 0.3;
      if (nose > (bank ? BANK.thick + KART_R + 0.3 : 0) && nose < (bank ? BANK.thick : h.r) + KART_R + 1.2 && off) {
        ai.backT = bank ? 0.6 : 0.7;
        // (the nose swung away from a hub or a ball; from a bank, which runs right across the road, only edging toward
        // the lane it wants)
        ai.laneTo = bank ? (lane * t.half > k.d ? 0.25 : -0.25) : aside >= 0 ? -0.5 : 0.5;
        // backing off the same thing over and over: wedged against it, so the night crew sets it down clear
        if (r.time - ai.backAt > 6) {
          ai.backAt = r.time;
          ai.backs = 0;
        }
        if (++ai.backs >= 3) {
          ai.backs = 0;
          ai.backT = 0;
          rescue(r, k);
        }
        break;
      }
    }
  }
  if (dodge) {
    // a swerve round something in the way turns the kart as much as a bend does. With a clean line past it the kart
    // keeps its foot down (it brakes for neither the hazard nor the bend it is on), unless the swerve itself is too
    // sharp to make at its speed; with no clean way past yet it eases off for the two together, and waits for one. On
    // a boost it doesn't brake for bends, any more than it does anywhere else, unless the thing in the way sits on one
    // and it has to make the bend on its line round it. And on a boost it judges the swerve by the way it is heading:
    // out of a drift it is still angled across the road, and at a boost's speed that carries it a long way on toward
    // whatever it is getting round
    const ds = Math.max(4, dodge.ds);
    let bend = dodge.clear ? 0 : peak;
    let slope = 0;
    if (k.boost > 0) {
      if (!dodge.clear) bend = Math.abs(curveAhead(t, k.s, dodge.ds - 4, dodge.ds + 4).peak) > 0.02 ? Math.abs(curveAhead(t, k.s, 0, dodge.ds + 4).peak) : 0;
      slope = acrossRoad(t, k);
    }
    const swerve = (2 * Math.abs(lane * t.half - k.d - slope * ds)) / ds ** 2;
    if ((bend + swerve > 0 && k.v > 1.55 / (bend + swerve)) || (!dodge.clear && dodge.ds < 4 + k.v * 0.5 && k.v > 9)) inp.brake = true;
  }
  if (Math.abs(diff) > 2.2 && k.v < 4) inp.brake = false;
  // lined up for a trench: foot down for the jump, and a mushroom if it is going too slowly to make it
  if (band.hole) {
    inp.brake = false;
    if (k.v < 15 && k.roll === 0 && (k.item === 'mushroom' || k.item === 'triple' || k.item === 'golden') && r.holes.some((h) => deltaS(t, k.s, h.s) > 0 && deltaS(t, k.s, h.s) < 30)) inp.use = true;
  }
  if (held && ai.backT === 0) inp.brake = k.v > 0.3;
  if (backOut && ai.backT === 0) {
    inp.brake = true;
    inp.steer = 0;
    inp.drift = false;
    inp.hop = false;
  }
  if (ai.backT > 0) {
    inp.brake = true;
    inp.drift = false;
    inp.hop = false;
    inp.steer = -Math.sign(ai.laneTo) * (Math.abs(ai.laneTo) < 0.3 ? 0.5 : 1);
    // (once it has backed off it commits to its run at the gap)
    if (ai.backT - dt <= 0) ai.goT = 1.2;
  }
  // on the brink of a drop, or about to be, and heading for it (not in a drift, nor lined up on a trench's plate): steer
  // back hard, off the drift and off the gas at speed. Whether it catches itself in time is decided once for each
  // stretch of road, more often the better the driver
  if (k.drift === 0 && !band.hole) {
    const side = k.d >= 0 ? 1 : -1;
    const now = edgeAt(t, k.s, side);
    const soon = edgeAt(t, k.s + sp * 0.3, side);
    const e = now.past !== 'wall' ? now : soon;
    if (e.past !== 'wall' && Math.abs(k.d) > e.lim - KART_R - 0.9 && side * acrossRoad(t, k) > -0.05) {
      if (Math.abs(deltaS(t, ai.reactS, k.s)) > 30) {
        ai.reactS = k.s;
        ai.react = r.rand() < 0.55 + 0.45 * ai.skill;
      }
      if (ai.react) {
        inp.steer = -side;
        inp.drift = false;
        inp.hop = false;
        if (k.v > 15) inp.brake = true;
      }
    }
  }

  // cash in a full purse for a boost on a straight with nothing in the way
  if (k.coins >= MAX_COINS && k.boost <= 0 && !dodge && Math.abs(curveAhead(t, k.s, 0, 30).peak) < 0.012 && r.rand() < dt * 0.3) inp.cash = true;

  // tricks off ramps, and a shove for anyone driving alongside
  if (k.air && k.trickT > 0 && !k.trick && r.rand() < ai.skill * 0.25) inp.hop = true;
  // (never from near the brink of a drop itself; on Expert the best of them go for anyone beside a drop)
  const hunt = expert(r) && ai.skill >= 0.8;
  if (k.slamCool === 0 && k.drift === 0 && r.rand() < dt * (0.5 + ai.skill) * (hunt ? 2 : 1) && fromBrink(r, k) > 3) {
    const { rx, rz } = rightOf(k);
    const beside = r.karts.find((o) => {
      if (o === k || o.done !== null) return false;
      const dx = o.x - k.x;
      const dz = o.z - k.z;
      const across = Math.abs(dx * rx + dz * rz);
      return Math.abs(dx * Math.sin(k.h) + dz * Math.cos(k.h)) < 2.4 && across > 1 && across < 3.4;
    });
    if (beside && (!hunt || fromBrink(r, beside) < 3 || r.rand() < 0.5)) inp.slam = true;
  }

  // keep the pack close: CPUs ease off well ahead of the leading driver who isn't one (you, solo) and push when far behind
  const lead = pacer(r);
  // (on the harder courses they ease off less, and push harder from further back)
  const [slow, fast, span] = r.tier.band;
  if (k.ai && lead && lead !== k) ai.band = clamp(1 + (lead.prog - k.prog) / span, slow, fast);

  // items
  ai.itemT -= dt;
  if (k.item && k.roll === 0) ai.held += dt;
  else ai.held = 0;
  const behind = r.karts.some((o) => o !== k && o.done === null && deltaS(t, o.s, k.s) > 2 && deltaS(t, o.s, k.s) < 20);
  // hold a banana or shell out behind while someone is on your tail
  inp.hold = k.roll === 0 && trailable(k.item) && behind && ai.skill > 0.45;
  if (!k.item || k.roll > 0 || ai.itemT > 0) return;
  ai.itemT = 0.3 + r.rand() * 0.6;
  const aheadNear = r.karts.find((o) => o !== k && o.done === null && deltaS(t, k.s, o.s) > 3 && deltaS(t, k.s, o.s) < 32 && Math.abs(o.d - k.d) < 3);
  const straight = Math.abs(curveAhead(t, k.s, 0, 30).peak) < 0.012;
  inp.back = false;
  inp.fwd = false;
  let go = false;
  switch (k.item) {
    case 'banana':
    case 'bananas':
      // (on Expert, dropped on the apex of a bend beside a drop for whoever is following)
      go = (behind && !inp.hold) || ai.held > 9 || (expert(r) && band.open && Math.abs(curveAhead(t, k.s, -10, 10).peak) > 0.04 && r.karts.some((o) => o !== k && o.done === null && deltaS(t, o.s, k.s) > 2 && deltaS(t, o.s, k.s) < 40));
      inp.back = true;
      break;
    case 'bomb':
      // lob it at someone up the road, or leave it for whoever is following
      if (r.karts.some((o) => o !== k && o.done === null && deltaS(t, k.s, o.s) > 12 && deltaS(t, k.s, o.s) < 40)) go = true;
      else if (behind) go = inp.back = true;
      else go = ai.held > 6;
      break;
    case 'green':
    case 'greens':
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
    case 'golden': {
      // on a straight with nothing in the way; but an item in hand means no new one from the boxes, so after a few
      // seconds' wait a shorter straight will do (some courses are all short straights), and something up the road
      // with a clean way past it, or a way off yet, is no reason to wait
      const soon = ai.held > 3 && (straight || Math.abs(curveAhead(t, k.s, 0, 15).peak) < 0.012) && (!dodge || dodge.clear || dodge.ds > 30);
      go = (straight && !dodge) || soon || k.offroad || k.mud;
      break;
    }
    case 'coin':
      go = k.coins < MAX_COINS;
      break;
    case 'star':
    case 'mega':
    case 'bullet':
      go = ai.held > 0.4;
      break;
    case 'ink':
      go = k.place > 1 && ai.held > 0.6;
      break;
    case 'horn': {
      // save it for a blue shell, or for a crowd
      const blue = leaderFor(r) === k && r.things.some((th) => th.kind === 'blue' && Math.hypot(th.x - k.x, th.z - k.z) < 30);
      const crowd = r.karts.filter((o) => o !== k && o.done === null && Math.hypot(o.x - k.x, o.z - k.z) < HORN_R).length;
      go = blue || crowd >= 2 || ai.held > 12;
      break;
    }
    case 'bolt':
      go = ai.held > 1 + ai.skill * 2;
      break;
    case 'blue':
      go = k.place > 1 && ai.held > 0.8;
      break;
  }
  inp.use = go;
}

/** The lane the CPU driver would pick for kart k right now, as dodgeHazard sees it (for the tests). */
export function cpuLane(r: Race, k: Kart) {
  const ai = (k.ai ??= { ...AUTO, blunders: {} });
  return dodgeHazard(r, k, clamp(ai.lane, -0.82, 0.82), edgeBand(r, k, edgeRoom(k, ai)));
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
