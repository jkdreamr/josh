// Pure race rules for Palm Drive: kart physics, drifting and mini-turbos, items, CPU drivers, laps and places.
// No DOM, no three.js. Distances are meters, times seconds; see track.ts for the axes and heading convention.
import { COURSES, tierOf, trackOf, type CourseId, type Flow, type Gust, type Swell, type Tier } from './courses.ts';
import { BALL_WINDOW, CURB, KART_R, PASTS, WET, awake, ballDue, ballNear, cycleAt, deltaS, dropAt, drives, edgeAt, gripAt, gridSpot, headingOf, inTrench, lengthOf, locate, pointAt, shoreOf, solid, timed, traffic, wrapAngle, wrapS, type Hazard, type HazardKind, type Layout, type Past, type Shore, type Spot, type Track } from './track.ts';
import type { Gear, Look } from './garage.ts';
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
/**
 * Mini-turbo charge needed for blue, orange and purple sparks, and how long each boost lasts. A mini-turbo is a gentler
 * boost than the rest (TURBO_DV on top speed, not BOOST_DV), worth about half the time a boost that long would be, so
 * a drift pays without being the whole race. Any other boost on top of one still runs at full strength.
 */
export const TURBO_AT = [0, 0.75, 1.6, 2.6];
export const TURBO_T = [0, 0.5, 0.95, 1.5];
export const TURBO_DV = 4.75;
/** While a mini-turbo runs, Kart.boost is held at no more than this (see drive), less than any other boost lasts. */
const TURBO_HOLD = 0.05;
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
/** Up in the air this high, a blue shell's blast passes underneath you (a feather jump, timed right). */
export const BLAST_CLEAR = 1.8;
/**
 * Boomerang: thrown this much faster than you are going, it slows at BOOMERANG_PULL, so it gets about 40 m ahead, turns
 * round and flies back past you, sweeping the road behind you too before it is gone.
 */
export const BOOMERANG_V = 50;
export const BOOMERANG_PULL = 31;
export const BOOMERANG_LIFE = 4.4;
/** Fire flower: bouncing fireballs for this long once lit, one every FIRE_GAP seconds at most. */
export const FIRE_T = 4;
export const FIRE_GAP = 0.3;
export const FIRE_V = 36;
export const FIRE_LIFE = 2.2;
/** Ice flower: two ice balls; a kart one hits is frozen solid this long, sliding on with no say in where it goes. */
export const ICE_V = 34;
export const ICE_LIFE = 3;
export const FREEZE_T = 1.3;
/** Piranha plant: how long it rides on your kart, how far ahead it snaps, how often, its lunge and the boost each bite gives. */
export const PIRANHA_T = 7;
export const PIRANHA_R = 6.5;
export const PIRANHA_GAP = 0.9;
export const PIRANHA_LUNGE = 0.3;
export const PIRANHA_BOOST = 0.5;
/** Boo: see-through, and nothing anyone throws or drives can touch you, for this long. */
export const BOO_T = 5;
/** Feather: the jump's launch speed (about 2.8 m up, most of a second in the air). */
export const FEATHER_V = 12.5;
/** Thunder cloud: the time before it zaps you, its extra speed, and how long a kart that just got it must keep it. */
export const CLOUD_T = 8;
export const CLOUD_DV = 3;
export const CLOUD_HOLD = 1;
/** How long a thunder cloud's zap leaves you small (lightning's is longer). */
export const ZAP_SHRINK = 3;
/** POW block: a warning thump every POW_GAP seconds, three of them, and it goes off on the fourth beat (POW_T). */
export const POW_GAP = 0.4;
export const POW_T = 1.6;
/** No lightning or POW block within this long of the last one. */
const BIG_GAP = 12;
/**
 * Off the road where it drops away (into water or a pit; how long until you are fished out, and what it costs, go with
 * the course: see Tier), press drift this close either side of being set back down on the road for a drop start, a
 * boost as long as a dash panel's.
 */
export const DROP_WINDOW = 0.25;
/** An oil slick spins out a kart going faster than this. */
export const OIL_V = 6;
/** How a fall plays out, as shares of the time it takes: sinking out of sight, the crane carrying the kart back, set down. */
export const FALL_SINK = 0.26;
export const FALL_CARRY = 0.54;

/**
 * On the water (Race.boat), in a single scull. Its long hull turns this much less than a kart does off a drift (a carve
 * turns as ever). The crew rows to a beat on the race clock, one stroke every STROKE_T seconds with the catch on the beat,
 * the same for every boat on every screen, and the boat surges a little through each stroke (SURGE, which averages out).
 * A straight hop within CATCH_WIN of a beat is a clean catch: CATCH_DV more top speed for CATCH_T, and POWER_TEN of them in
 * a row is a Power Ten, a boost of POWER_T.
 */
export const HULL_TURN = 0.85;
export const STROKE_T = 1.6;
export const SURGE = 0.04;
export const CATCH_WIN = 0.12;
export const CATCH_T = 0.5;
export const CATCH_DV = 2;
export const POWER_TEN = 10;
export const POWER_T = 1.3;
/** The tide turns on this lap of a kart's own (see Flow.tide). */
export const TIDE_LAP = 5;
/** A whirlpool spins up and dies away over this long at either end of its `on` (see the 'whirl' hazard). */
export const WHIRL_RAMP = 0.6;
/** How far behind a vessel its wake reaches, and how it spreads (tan of the Kelvin angle, 19.5 degrees). */
export const WAKE_LEN = 45;
export const WAKE_SPREAD = 0.354;

export type Cc = '50cc' | '100cc' | '150cc' | '200cc';
export const CCS: Cc[] = ['50cc', '100cc', '150cc', '200cc'];
export const CLASSES: Record<Cc, { top: number; accel: number; cpu: number }> = {
  '50cc': { top: 19, accel: 9, cpu: 0.92 },
  '100cc': { top: 23, accel: 11, cpu: 0.95 },
  '150cc': { top: 27.5, accel: 13, cpu: 0.97 },
  '200cc': { top: 33, accel: 16, cpu: 0.97 },
};
export const isCc = (v: unknown): v is Cc => CCS.includes(v as Cc);

export type Item =
  | 'banana' | 'bananas' | 'green' | 'greens' | 'red' | 'bomb' | 'mushroom' | 'triple' | 'golden' | 'coin' | 'star' | 'mega' | 'bullet' | 'ink' | 'horn' | 'bolt' | 'blue'
  | 'boomerang' | 'fire' | 'ice' | 'piranha' | 'boo' | 'feather' | 'cloud' | 'pow';
export const ITEMS: Item[] = [
  'banana', 'bananas', 'green', 'greens', 'red', 'bomb', 'mushroom', 'triple', 'golden', 'coin', 'star', 'mega', 'bullet', 'ink', 'horn', 'bolt', 'blue',
  'boomerang', 'fire', 'ice', 'piranha', 'boo', 'feather', 'cloud', 'pow',
];
export type ThingKind = 'banana' | 'green' | 'red' | 'blue' | 'bomb' | 'boomerang' | 'fire' | 'ice';
/** Bananas and shells can be held out behind as a shield. */
export const trailable = (item: Item | null) => item === 'banana' || item === 'bananas' || item === 'green' || item === 'greens' || item === 'red';
/** How many goes an item gives (the golden mushroom and the fire flower run on a timer instead). */
const USES: Partial<Record<Item, number>> = { triple: 3, bananas: 3, greens: 3, boomerang: 3, ice: 2 };
/** Things that never hurt whoever threw them, even coming back their way. */
const ownSafe = (kind: ThingKind) => kind === 'boomerang' || kind === 'fire' || kind === 'ice';
export type HitHow = 'spin' | 'tumble' | 'squash' | 'boom' | 'freeze';

/** hold: the item button is held (bananas and shells trail behind as a shield until it is let go). */
export type Input = { steer: number; brake: boolean; drift: boolean; hop: boolean; use: boolean; back: boolean; fwd: boolean; hold: boolean; slam: boolean; cash: boolean };
export type Hat = 'cap' | 'tree' | 'top' | 'bow' | 'tower' | 'axe' | 'dish' | 'claw' | 'grad' | 'palm' | 'bike' | 'band' | 'boater' | 'golf' | 'prop' | 'laurel';
/** Every hat, in Garage order (a look sends the place in this list in 4 bits: at most 16, new ones on the end). */
export const HATS: Hat[] = ['cap', 'tree', 'top', 'bow', 'tower', 'axe', 'dish', 'claw', 'grad', 'palm', 'bike', 'band', 'boater', 'golf', 'prop', 'laurel'];
/**
 * care: seconds left keeping well away from the edge after a fall; dropGo: this time it times the drop start. reactS and
 * react: where it last decided whether it catches itself in time on the brink of a drop, and whether it does. err: how
 * early or late it judges the set pieces this lap (errLap), blunders: the set pieces it simply failed to see (by where
 * and which lap), waitT: how long it has sat waiting for one.
 */
/**
 * shaken: seconds left driving very carefully after falling twice in quick succession (fellAt: when it last fell), on
 * the courses where the road itself is the danger (see Race.slick). blink: through the Blink, the side of its rows of
 * panes it has picked and keeps to (-1 left, 1 right; -2 or 2 holding short of them on that side, 0 not there: see
 * blinkPlan), and blinkT how long it has held there.
 */
/** On the water: catchBeat and catchAt, the next beat it means to catch and when it presses for it (NaN: it lets it go); hopKey and hopGo: the last crest of swell it decided about, and whether it hops it. */
export type Ai = { pace: number; skill: number; band: number; lane: number; laneTo: number; laneT: number; itemT: number; held: number; driftT: number; care: number; dropGo: boolean; reactS: number; react: boolean; err: number; errLap: number; blunders: Record<string, boolean>; waitT: number; backT: number; backs: number; backAt: number; heldT: number; goT: number; goD: number; shaken: number; fellAt: number; catchBeat: number; catchAt: number; hopKey: string; hopGo: boolean; blink: number; blinkT: number; whirlHold: number };
/** A fall off the road: into what (and whether down a trench), how fast the kart was going, and where it is put back [s, d]. */
export type Fell = { past: Past; hole: boolean; v: number; to: [number, number] };
/** What the network last said about a remote kart. */
/**
 * A remote kart's last report: where it was at race time `at` (on our clock), how fast it was turning (w, radians a
 * second, from the report before), and (ox, oz) how far from that the kart was showing when the report came in, a
 * correction that fades out (see glide). Older reports had neither.
 */
export type NetState = { x: number; z: number; h: number; v: number; prog: number; done: number | null; flags: number; at: number; ox?: number; oz?: number; w?: number };

export type Kart = {
  idx: number;
  name: string;
  color: string;
  hat: Hat;
  /** The rest of its look from the garage (paint finish, wheels, boost trail): just for show. */
  gear?: Gear;
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
  /** What is left of a mini-turbo (gentler than a boost: see TURBO_DV). */
  turbo: number;
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
  /** Golden mushroom time left once it has been started, and the same for a fire flower. */
  goldT: number;
  fireT: number;
  mega: number;
  bullet: number;
  ink: number;
  /** A piranha plant riding up front: time left, and the countdown to its next bite (it lunges for a moment). */
  piranha: number;
  bite: number;
  /** See-through under a Boo: nothing anyone throws or drives touches you. */
  boo: number;
  /** A thunder cloud overhead: time until it zaps you, and how long until you can bump it onto someone else. */
  cloud: number;
  cloudHold: number;
  /** Frozen in a block of ice by an ice ball: sliding on along the road with no say in it. */
  frozen: number;
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
  /** Just set back down after a fall or a rescue: the drone holds it steady against the wind this much longer. */
  calm: number;
  /**
   * On the water: the clean catch's extra speed left (catchT), the catches in a row toward a Power Ten (streak), beats in a
   * row let go by (missed), the last beat caught and the last beat whose window has closed; which vessels' wakes it is
   * inside (a bit each) and how long before the next wake can throw it again.
   */
  catchT: number;
  streak: number;
  missed: number;
  beat: number;
  beatSeen: number;
  wakeIn: number;
  wakeCool: number;
  swellCool: number;
  wrong: number;
  stuck: number;
  gas: number | null;
  input: Input;
  ai: Ai | null;
  /** The finished player hands the wheel to the CPU driver. */
  auto: boolean;
  net: NetState | null;
  /** Online: whoever drove it left the room, so it is parked out of sight and out of everyone's way. */
  left?: boolean;
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
export type Dash = { x: number; z: number; s: number; d: number; h: number; kick?: number };
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
  /** (and a kicker's shove across the road: see Layout.dashes) */
  | { t: 'dash'; k: number; kick?: number }
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
  | { t: 'haz'; k: number; kind: HazardKind }
  /** On the water: a clean catch, a Power Ten, a wake or a crest of swell under you, and a buoy off your bow. */
  | { t: 'catch'; k: number }
  | { t: 'power'; k: number }
  | { t: 'wake'; k: number; amp: number }
  | { t: 'swell'; k: number }
  | { t: 'bonk'; k: number }
  /** A piranha plant snapping at whatever is at (x, z). */
  | { t: 'chomp'; k: number; x: number; z: number }
  /** A Boo taking kart k's item for kart `by` (sent online when k is someone else's), and the item it got. */
  | { t: 'boo'; k: number; by: number; item: Item }
  /** The thunder cloud moving from kart `by` to kart `k` with `left` seconds to go, and a cloud zapping its kart. */
  | { t: 'cloud'; k: number; by: number; left: number }
  | { t: 'zap'; k: number }
  /** A POW block used at race time `at` (sent online), its warning thumps and the moment it goes off. */
  | { t: 'pow'; k: number; at: number }
  | { t: 'thump'; by: number; n: number }
  | { t: 'quake'; by: number };

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
  /** What lies under them: a pit, or on the Cardinal Skyway the sky. */
  holePast: Past;
  /** The panes of glass road that blink out on the clock (see the 'panel' hazard). */
  panels: LiveHazard[];
  /** The course's gusts of wind (see Course.gusts). */
  gusts: Gust[];
  /**
   * A course where the road itself is the danger (slick surfaces or wind): the karts slide on it and the wind shoves
   * them, and the CPUs drive for it. Nothing about it runs anywhere else.
   */
  slick: boolean;
  /**
   * Racing shells on the water (Course.vehicle): the long-hull turn, the stroke and the catch. And the water's currents,
   * whirlpools, vessels and swell. Nothing about any of it runs anywhere else.
   */
  boat: boolean;
  flows: Flow[];
  whirls: LiveHazard[];
  vessels: LiveHazard[];
  swells: Swell[];
  /** How hard the CPUs push and what mistakes cost on this course (from its difficulty). */
  tier: Tier;
  rand: Rng;
  nextId: number;
  events: Ev[];
  /** The kart this client drives. */
  me: number;
  /** Race time of the first finish, from any kart. */
  first: number | null;
  /** Race time the last lightning struck (or POW block went off), so two never land back to back. */
  boltAt: number;
  /** POW blocks counting down: who used one, when, and how many warning thumps so far. */
  pows: Pow[];
};

export type Pow = { by: number; at: number; n: number };

/**
 * A hazard on the road and where it is now: how far along the lap and across the road, which way the road runs
 * there (a bus faces that way), and which way a cow or a bike is heading (+1 to the right of the road).
 */
export type LiveHazard = Hazard & { x: number; z: number; along: number; at: number; tx: number; tz: number; walk: number; gone?: boolean };

export type Racer = { name: string; color: string; kind: Kart['kind']; seat?: number; pace?: number; skill?: number; hat?: Hat; gear?: Gear };

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
  const tier = tierOf(course);
  // (on Insane every CPU drives a good deal more cleanly than its own skill: lifted that share of the way to perfect)
  const lift = tier.skillLiftCc?.[opts.cc] ?? tier.skillLift ?? 0;
  const karts = opts.racers.map((rc, idx): Kart => {
    const g = gridSpot(track, idx);
    const at = locate(track, g.x, g.z);
    const cpu = rc.kind === 'cpu';
    return {
      idx,
      name: rc.name,
      color: rc.color,
      hat: rc.hat ?? 'cap',
      gear: rc.gear,
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
      turbo: 0,
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
      fireT: 0,
      mega: 0,
      bullet: 0,
      ink: 0,
      piranha: 0,
      bite: 0,
      boo: 0,
      cloud: 0,
      cloudHold: 0,
      frozen: 0,
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
      calm: 0,
      catchT: 0,
      streak: 0,
      missed: 0,
      beat: -1e9,
      beatSeen: -1e9,
      wakeIn: 0,
      wakeCool: 0,
      swellCool: 0,
      wrong: 0,
      stuck: 0,
      gas: null,
      input: noInput(),
      ai: cpu ? newAi(rc.pace ?? 0.95, lift ? lift + (1 - lift) * (rc.skill ?? 0.5) : (rc.skill ?? 0.5), rand) : null,
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
    return { x: p.x, z: p.z, s: c.s, d: c.d, h: headingOf(p.tx, p.tz), ...(c.kick ? { kick: c.kick } : {}) };
  });
  const ramps = lay.ramps.map((c) => {
    const p = pointAt(track, c.s, c.d);
    return { x: p.x, z: p.z, s: c.s, d: c.d, w: c.w, h: headingOf(p.tx, p.tz) };
  });
  // (traffic that keeps time with the class runs on traffic time, race time times the class's top speed over 150cc's:
  // the cars and the crossing Marguerite drive that much faster at 200cc, and come as often for the laps the karts do)
  const tk = CLASSES[opts.cc].top / CLASSES['150cc'].top;
  const hazards = lay.hazards.map((h0): LiveHazard => {
    const h = h0.tau ? { ...h0, ...(h0.drive ? { drive: h0.drive * tk } : {}), ...(h0.speed ? { speed: h0.speed * tk } : {}), every: (h0.every ?? 60) / tk, phase: (h0.phase ?? 0) / tk } : h0;
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
    holePast: COURSES[course].holePast ?? (COURSES[course].edges?.some((e) => e[3] === 'void') ? 'void' : 'pit'),
    panels: hazards.filter((h) => h.kind === 'panel'),
    gusts: COURSES[course].gusts ?? [],
    slick: !!(COURSES[course].surfaces || COURSES[course].gusts),
    boat: COURSES[course].vehicle === 'shell',
    flows: COURSES[course].flows ?? [],
    whirls: hazards.filter((h) => h.kind === 'whirl'),
    vessels: hazards.filter((h) => drives(h) && (h.kind === 'launch' || h.kind === 'barge' || h.kind === 'log')),
    swells: COURSES[course].swells ?? [],
    tier,
    rand,
    nextId: opts.idBase ?? 1,
    events: [],
    me: opts.me ?? karts.findIndex((k) => k.kind === 'player'),
    first: null,
    boltAt: -99,
    pows: [],
  };
  moveHazards(race);
  rankKarts(race);
  return race;
}

/** Where across the road a hazard is at race time `time`: cows and bikes cross from side to side, the rest stay put. */
export const hazardD = (h: Hazard, time: number) => (h.swing ? h.d + h.swing * Math.sin(time * (h.speed ?? 0.5) + (h.phase ?? 0)) : h.d);
/** How fast a hazard is crossing the road at race time `time`, in meters a second to the right. */
export const hazardV = (h: Hazard, time: number) => (h.swing ? h.swing * (h.speed ?? 0.5) * Math.cos(time * (h.speed ?? 0.5) + (h.phase ?? 0)) : 0);

/**
 * How far a vessel that drives only a stretch of the course (Hazard.span) has come along it on this transit at race time
 * `time`: one every `every` seconds from race time `phase`, and -1 before the first.
 */
export function spanRun(h: Hazard, time: number) {
  const c = time - (h.phase ?? 0);
  if (c < 0) return -1;
  const every = h.every ?? 60;
  return Math.abs(h.drive ?? 0) * (c % every);
}
/** Whether such a vessel is off its stretch at race time `time` (not there at all: not drawn, hit or planned for). */
export const spanGone = (h: Hazard, time: number) => {
  const run = spanRun(h, time);
  return run < 0 || run > h.span![1] - h.span![0];
};
/**
 * How far along the lap a hazard is at race time `time`: a bus waits at its stop for the green light, then drives on (a
 * vessel on a stretch of the course comes in at one end of it and goes out at the other).
 */
export const hazardS = (t: Track, h: Hazard, time: number) => {
  if (h.span) {
    const run = Math.max(0, spanRun(h, time));
    return wrapS(t, (h.drive ?? 0) >= 0 ? h.span[0] + run : h.span[1] - run);
  }
  return h.drive ? wrapS(t, h.s + h.drive * Math.max(0, time)) : h.s;
};

/** How far a car takes to pull out of its side street into its lane (and to turn off into the other at the far end). */
export const BAY_RUN = 12;
/**
 * Where across the road a car or a van on its stretch is at race time `time`: in its lane, easing out of the side street
 * (at d = h.bay) over the first BAY_RUN meters and back into the other over the last. Pure in time, like spanRun.
 */
export function trafficD(h: Hazard, time: number) {
  if (h.bay === undefined || !h.span) return h.d;
  const run = Math.max(0, spanRun(h, time));
  const u = clamp(Math.min(run, h.span[1] - h.span[0] - run) / BAY_RUN, 0, 1);
  return h.bay + (h.d - h.bay) * u * u * (3 - 2 * u);
}

/**
 * Cows and cyclists cross the road and back, and buses drive their laps, on the race clock, so every screen has them
 * in the same place.
 */
export function moveHazards(r: Race) {
  for (const h of r.hazards) {
    if (h.kind === 'boulder') {
      // (a boulder rolls across at its own s, on the clock: see boulderAt)
      h.at = boulderAt(r, h, r.time).d;
      const p = pointAt(r.track, h.s, h.at);
      h.x = p.x;
      h.z = p.z;
      continue;
    }
    if (!h.swing && !h.drive) continue;
    h.at = h.bay !== undefined ? trafficD(h, r.time) : hazardD(h, r.time);
    h.along = hazardS(r.track, h, r.time);
    if (h.span) h.gone = spanGone(h, r.time);
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
    if (h.kind === 'shuttle' || h.kind === 'mower' || h.kind === 'tether') {
      // (the Marguerite or the mower across the road, and the Tree or a goose where it is now)
      const st = hazState(r, h, r.time, lap);
      if (!st.solid) return false;
      const c = pointAt(r.track, h.s, st.d);
      if (h.kind === 'tether') return Math.hypot(c.x - x, c.z - z) < h.r + pad;
      const ox = x - c.x;
      const oz = z - c.z;
      return Math.abs(ox * c.tx + oz * c.tz) < h.r + pad && Math.abs(-ox * c.tz + oz * c.tx) < lengthOf(h) / 2 + pad;
    }
    if (!hazState(r, h, r.time, lap).solid) return false;
    if (h.kind !== 'bollard') return Math.hypot(h.x - x, h.z - z) < h.r + pad;
    if (Math.hypot(h.x - x, h.z - z) > (h.w ?? 0) / 2 + pad + 1) return false;
    const at = locate(r.track, x, z, hint);
    return Math.abs(deltaS(r.track, h.s, at.s)) < BANK.thick + pad && Math.abs(at.d - h.d) < (h.w ?? 0) / 2 + pad;
  }
  return solid(h.kind) && awake(h, lap) && !h.gone && (drives(h) ? inBus(h, x, z, pad) !== null : Math.hypot(h.x - x, h.z - z) < h.r + pad);
};

function newAi(pace: number, skill: number, rand: Rng): Ai {
  return { pace, skill, band: 1, lane: (rand() - 0.5) * 0.8, laneTo: 0, laneT: rand() * 2, itemT: 1 + rand() * 2, held: 0, driftT: 0, care: 0, dropGo: false, reactS: -1e9, react: true, err: 0, errLap: 0, blunders: {}, waitT: 0, backT: 0, backs: 0, backAt: -99, heldT: 0, goT: 0, goD: 0, shaken: 0, fellAt: -99, catchBeat: -1e9, catchAt: NaN, hopKey: '', hopGo: false, blink: 0, blinkT: 0, whirlHold: 0 };
}

/** A solo Grand Prix: seven CPU rivals ahead of you on the grid, like the first race of a cup. */
export function soloRace(cc: Cc, seed?: number, look: Pick<Look, 'color' | 'hat'> & Partial<Look> = { color: PLAYER_COLOR, hat: 'cap' }, course: CourseId = 'palm') {
  return createRace({ cc, seed, course, racers: [...RIVALS, { name: 'you', color: look.color, kind: 'player', hat: look.hat, gear: look.gear }] });
}

export const racing = (r: Race) => r.time >= 0;
const scaleOf = (k: Kart) => (k.shrink > 0 ? 0.62 : k.mega > 0 ? 1.5 : 1);
export const hurt = (k: Kart) => k.spin > 0 || k.tumble > 0 || k.sunk > 0 || k.frozen > 0;
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
    // (a thunder cloud can't be held: it settles over your head as soon as the roulette stops)
    if (k.input.use || (k.item === 'cloud' && k.roll === 0)) useItem(r, k);
    k.input.use = false;
    k.input.hop = false;
    k.input.slam = false;
    k.input.cash = false;
  }
  bumpKarts(r);
  moveThings(r, dt);
  hitThings(r);
  // piranha plants snap on every screen (each client only bites what it drives), and POW blocks count down
  for (const k of r.karts) if (k.piranha > 0) chomp(r, k, dt);
  if (r.pows.length) movePows(r);
  pickups(r, dt);
  for (const k of r.karts) if (local(k)) progress(r, k, dt);
  rankKarts(r);
}

/** How far ahead a remote kart's last report is carried, at most. */
export const GLIDE_MAX = 0.35;

/** Where a report puts its kart `age` seconds on: along its heading, round the bend it was turning through. */
export function carried(n: Pick<NetState, 'x' | 'z' | 'h' | 'v' | 'w'>, age: number) {
  const w = n.w ?? 0;
  if (Math.abs(w) < 1e-3) return { x: n.x + Math.sin(n.h) * n.v * age, z: n.z + Math.cos(n.h) * n.v * age, h: n.h };
  const h = n.h + w * age;
  return { x: n.x + (n.v * (Math.cos(n.h) - Math.cos(h))) / w, z: n.z + (n.v * (Math.sin(h) - Math.sin(n.h))) / w, h };
}
/**
 * Where a remote kart probably is now: its last report carried forward. A report that disagrees with where the kart
 * was showing leaves a correction (ox, oz) that fades out, so the kart never jumps and never trails behind the report
 * either; one without (from an older client) is eased towards instead.
 */
function glide(r: Race, k: Kart, dt: number) {
  const n = k.net;
  if (!n) return;
  const age = clamp(r.time - n.at, 0, GLIDE_MAX);
  const { x: px, z: pz, h: ph } = carried(n, age);
  if (n.ox !== undefined && n.oz !== undefined) {
    const fade = Math.exp(-10 * dt);
    n.ox *= fade;
    n.oz *= fade;
    k.x = px + n.ox;
    k.z = pz + n.oz;
  } else if (Math.hypot(px - k.x, pz - k.z) > 8) {
    k.x = px;
    k.z = pz;
  } else {
    const w = 1 - Math.exp(-14 * dt);
    k.x += (px - k.x) * w;
    k.z += (pz - k.z) * w;
  }
  const turn = wrapAngle(ph - k.h) * (1 - Math.exp(-14 * dt));
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
  // (a thunder cloud overhead pushes you along, through the rough too)
  if (k.cloud > 0) top += CLOUD_DV;
  if (k.boost > 0) top += k.turbo > 0 && k.boost <= TURBO_HOLD ? TURBO_DV : BOOST_DV;
  else if ((k.offroad || k.mud) && k.star <= 0 && k.mega <= 0 && k.cloud <= 0) top *= OFFROAD;
  if (k.drift) top *= 0.985;
  // (on the water, the clean catch's surge of speed)
  if (r.boat && k.catchT > 0) top += CATCH_DV;
  if (k.wobble > 0) top *= 0.85;
  // ink on a CPU's visor: it drives a touch slower
  if (k.ink > 0 && k.ai) top *= 0.93;
  return top;
}

function drive(r: Race, k: Kart, dt: number) {
  const C = CLASSES[r.cc];
  const inp = k.input;
  const flying = k.bullet > 0;
  const clouded = k.cloud > 0;
  for (const key of ['boost', 'turbo', 'star', 'shrink', 'spin', 'tumble', 'squash', 'safe', 'dashCool', 'slamCool', 'slamT', 'wobble', 'rampCool', 'trickT', 'mega', 'bullet', 'ink', 'calm', 'piranha', 'boo', 'cloud', 'cloudHold', 'frozen'] as const) k[key] = Math.max(0, k[key] - dt);
  // a thunder cloud nobody took goes off
  if (clouded && k.cloud === 0) zap(r, k);
  // (on the glass a bullet never hands the kart back in a bend over the sky, far too fast to make it, nor on the
  // run-up to the Blink: it carries it on to where the road straightens, or past the panes)
  if (flying && k.bullet === 0 && glass(r) && bulletBend(r, k)) k.bullet = dt;
  // a bullet hands the kart back with a little boost
  if (flying && k.bullet === 0) k.boost = Math.max(k.boost, 0.6);
  if (k.goldT > 0) {
    k.goldT = Math.max(0, k.goldT - dt);
    if (k.goldT === 0 && k.item === 'golden') {
      k.item = null;
      k.uses = 0;
    }
  }
  if (k.fireT > 0) {
    k.fireT = Math.max(0, k.fireT - dt);
    if (k.fireT === 0 && k.item === 'fire') {
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
    k.turbo = 0;
  } else if (k.turbo > 0) {
    // a mini-turbo keeps the kart on a boost (for everything that asks), but only just, so that any other boost takes
    // over at full strength for as long as it lasts
    k.boost = Math.max(k.boost, Math.min(k.turbo, TURBO_HOLD));
  }
  const want = control && k.bullet <= 0 ? clamp(inp.steer, -1, 1) * (k.wobble > 0 ? 0.3 : 1) : 0;
  k.steer = approach(k.steer, want, (want === 0 ? 9 : 6) * dt);
  k.trail = control && inp.hold && k.roll === 0 && trailable(k.item);
  if (k.bullet > 0) {
    k.drift = 0;
    k.charge = 0;
  }

  const top = topOf(r, k);
  // on slick glass or frost the wheels bite less: slower to get going and to stop (see gripAt; the road is 1 elsewhere)
  const g0 = r.slick && k.y <= 0.05 ? gripAt(r.track, k.s, k.lap) : 1;
  if (k.bullet > 0) k.v = approach(k.v, C.top + BULLET_DV, 40 * dt);
  // (frozen solid, a kart slides on and only slowly loses its speed)
  else if (!control) k.v = approach(k.v, 0, (k.tumble > 0 ? 30 : k.frozen > 0 ? 8 : 14) * dt);
  else if (inp.brake) k.v = k.v > 0.5 ? Math.max(0, k.v - 26 * (g0 < 1 ? 0.5 + 0.5 * g0 : 1) * dt) : Math.max(-REVERSE, k.v - 9 * dt);
  else if (k.v < top) k.v = Math.min(top, k.v + (k.boost > 0 ? 34 : k.v < 0 ? 20 : C.accel) * (g0 < 1 ? 0.6 + 0.4 * g0 : 1) * dt);
  else k.v = Math.max(top, k.v - ((k.offroad || k.mud) && k.boost <= 0 ? 24 : 8) * dt);

  if (inp.slam && control && k.y === 0 && k.slamCool === 0 && k.v > 3) slamStart(r, k);
  if (inp.cash && control && k.coins >= CASH_COST) {
    k.coins -= CASH_COST;
    k.boost = Math.max(k.boost, CASH_T);
    r.events.push({ t: 'cash', k: k.idx });
  }

  // (on the water, a straight hop on the beat is a clean catch)
  if (r.boat) stroke(r, k, inp, control, dt);
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
        k.turbo = Math.max(k.turbo, TURBO_T[level]);
        k.boost = Math.max(k.boost, Math.min(k.turbo, TURBO_HOLD));
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
  // (a racing shell's long hull turns wider on its rudder than a kart does; carved, in a drift, it turns as ever)
  if (r.boat && k.drift === 0) rate *= HULL_TURN;
  // on wet road the kart turns less (a drift holds better than the front wheels do)
  if (k.wet) rate *= k.drift !== 0 ? 0.85 : 0.7;
  // and on glass and frost less again, on the ground (in the air it steers as ever); a drift holds best on ice
  const grip = r.slick && k.y <= 0.05 ? gripAt(r.track, k.s, k.lap) : 1;
  if (grip < 1) rate *= k.drift !== 0 ? 0.8 + 0.2 * grip : 0.55 + 0.45 * grip;
  if (k.v < 0) rate = -rate;
  if (k.spin > 0) rate = 0;
  if (k.frozen > 0) {
    // a block of ice slides on along the road like a sled in a run, turning with it only gently
    const along = Math.sign(Math.sin(k.h) * r.track.tx[k.i] + Math.cos(k.h) * r.track.tz[k.i]) || 1;
    rate = clamp(wrapAngle(k.h - headingOf(r.track.tx[k.i] * along, r.track.tz[k.i] * along)) * 3, -1.2, 1.2);
  }
  if (k.bullet > 0) {
    // on rails down the middle of the road, looking less far ahead round a tight bend with a drop beside it so it never
    // cuts across it (with walls both sides it rides as it always has)
    const ahead = 12 + k.v * 0.3;
    const bend = Math.abs(curveAhead(r.track, k.s, 0, 20).peak);
    const open = bend > 0.02 && edgeBand(r, k, 0).open;
    const p = pointAt(r.track, k.s + (open ? Math.min(ahead, Math.sqrt(12 / bend)) : ahead), 0);
    const diff = wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h);
    k.h = wrapAngle(k.h + clamp(diff, -5 * dt, 5 * dt));
  } else {
    const h0 = k.h;
    k.h = wrapAngle(k.h - rate * dt);
    if (grip < 1) {
      // the slide: the kart turns, but its momentum carries on the way it was going, the more the slicker the road
      // (half as much in a drift, which is how to take a corner on ice)
      const carry = (1 - grip) * (k.drift !== 0 ? 0.5 : 1);
      k.kx += (Math.sin(h0) - Math.sin(k.h)) * k.v * carry;
      k.kz += (Math.cos(h0) - Math.cos(k.h)) * k.v * carry;
    }
  }
  // the wind shoves you sideways across the road, in the air too (a light kart further, a mega one less; not a kart just
  // set back down, until it is under way)
  if (r.gusts.length && k.bullet <= 0 && k.calm <= 0) {
    const wa = windAt(r, k.s, r.time, k.lap) * (k.mega > 0 ? 0.5 : k.shrink > 0 ? 1.6 : 1);
    if (wa !== 0) {
      k.kx += -r.track.tz[k.i] * wa * dt;
      k.kz += r.track.tx[k.i] * wa * dt;
    }
  }
  // on the water: the current carries you (not in the air), whirlpools pull you in, and swell and wakes shove you aside
  // (none of it a shell just set back down, until it is under way)
  if (r.flows.length && k.bullet <= 0 && k.calm <= 0 && k.y <= 0.3) {
    const f = flowAt(r, k.s, k.d, k.lap);
    k.x += (r.track.tx[k.i] * f.along - r.track.tz[k.i] * f.across) * dt;
    k.z += (r.track.tz[k.i] * f.along + r.track.tx[k.i] * f.across) * dt;
  }
  if (r.whirls.length && k.bullet <= 0 && k.calm <= 0) whirlPull(r, k, dt);
  if (r.swells.length && k.bullet <= 0 && k.calm <= 0) swellHit(r, k, dt);
  if (r.vessels.length && k.bullet <= 0) wakes(r, k, dt);

  // (a shell surges a little through each stroke, the same for everyone on the race clock)
  const fv = r.boat ? k.v * (1 + SURGE * Math.sin((2 * Math.PI * r.time) / STROKE_T)) : k.v;
  k.x += (Math.sin(k.h) * fv + k.kx) * dt;
  k.z += (Math.cos(k.h) * fv + k.kz) * dt;
  // (and a slide or a shove carries further on ice)
  const decay = Math.exp(-5 * (grip < 1 ? 0.3 + 0.7 * grip : 1) * dt);
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

/**
 * Whether a bend with the sky beside it comes up too soon for a kart going at k.v to slow for, or the Blink (see
 * drive()).
 */
function bulletBend(r: Race, k: Kart) {
  const t = r.track;
  const ahead = 20 + 0.8 * k.v;
  if (r.panels.some((h) => awake(h, k.lap) && deltaS(t, k.s, h.s) > -(h.len ?? 0) && deltaS(t, k.s, h.s) < ahead)) return true;
  if (Math.abs(curveAhead(t, k.s, 0, ahead).peak) <= 0.02) return false;
  const i0 = Math.floor(wrapS(t, k.s) / t.step);
  for (let j = 0; j * t.step <= ahead; j++) if (dropAt(t, i0 + j, -1) || dropAt(t, i0 + j, 1)) return true;
  return false;
}

export const turboLevel = (charge: number) => (charge >= TURBO_AT[3] ? 3 : charge >= TURBO_AT[2] ? 2 : charge >= TURBO_AT[1] ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------
// On the water (Redwood Slough): the stroke, the current, whirlpools, swell and wakes. All of it pure in race time (or a
// kart's own physics), so every screen agrees with nothing sent; none of it runs on a course without them.

/** How far race time `time` is from the nearest beat of the stroke (seconds, either way), and which beat that is. */
export function beatAt(time: number) {
  const beat = Math.round(time / STROKE_T);
  return { beat, off: time - beat * STROKE_T };
}
/** The stroke's phase at race time `time`: 0 at the catch, rising to 1 by the next. */
export const strokeAt = (time: number) => (((time / STROKE_T) % 1) + 1) % 1;

/**
 * The stroke: a straight hop (no steering, starting no drift) within CATCH_WIN of a beat, under way and on the water, is a
 * clean catch; ten in a row a Power Ten. A straight hop off the beat breaks the run, as do two beats let go by in a row
 * where one could have been caught (rowing straight on, under way); a bend, a carve or a hit do not.
 */
function stroke(r: Race, k: Kart, inp: Input, control: boolean, dt: number) {
  k.catchT = Math.max(0, k.catchT - dt);
  const closed = Math.floor((r.time - CATCH_WIN) / STROKE_T);
  if (closed !== k.beatSeen) {
    k.beatSeen = closed;
    const could = control && k.y === 0 && k.drift === 0 && k.v > 8 && Math.abs(k.steer) <= 0.3;
    if (could && k.beat !== closed && ++k.missed >= 2) {
      k.streak = 0;
      k.missed = 0;
    }
  }
  if (!inp.hop || !control || k.y !== 0 || k.v <= 8 || k.drift !== 0) return;
  if (Math.abs(inp.steer) > 0.3 || Math.abs(k.steer) > 0.3) return;
  const { beat, off } = beatAt(r.time);
  if (k.beat === beat) return;
  if (Math.abs(off) > CATCH_WIN) {
    k.streak = 0;
    k.missed = 0;
    return;
  }
  k.beat = beat;
  k.missed = 0;
  k.catchT = CATCH_T;
  if (++k.streak >= POWER_TEN) {
    k.streak = 0;
    k.boost = Math.max(k.boost, POWER_T);
    r.events.push({ t: 'power', k: k.idx });
  } else r.events.push({ t: 'catch', k: k.idx });
}

/**
 * The current at s, d for a kart on lap `lap` (see Flow): along the channel (meters a second with you) and across it (to
 * the right). Pure in where and which lap.
 */
export function flowAt(r: Race, s: number, d: number, lap: number) {
  const t = r.track;
  let along = 0;
  let across = 0;
  for (const f of r.flows) {
    if (lap < (f.lap ?? 1)) continue;
    const a0 = deltaS(t, f.s0, s);
    const a1 = deltaS(t, s, f.s1);
    if (a0 < 0 || a1 < 0) continue;
    const taper = Math.min(1, a0 / 10, a1 / 10);
    let v = f.along;
    // (the slack water within 2.5 m of a bank or the brink of the marsh, blended in over a meter)
    if (f.bank !== undefined) {
      const near = Math.min(edgeAt(t, s, 1).lim - d, edgeAt(t, s, -1).lim + d);
      v += (f.bank - f.along) * clamp(3 - near, 0, 1);
    }
    if (f.tongue) {
      const [d0, d1, tv] = f.tongue;
      v += (tv - v) * clamp(Math.min(d - d0, d1 - d) + 0.5, 0, 1);
    }
    if (f.tide && lap >= TIDE_LAP) v = -v;
    along += v * taper;
    if (f.outward) {
      const c = t.curv[Math.floor(wrapS(t, s) / t.step) % t.n];
      across += -Math.sign(c) * f.outward * Math.min(1, 20 * Math.abs(c)) * taper;
    }
  }
  return { along, across };
}

/** Where across the channel a whirlpool is at race time `time` for a kart on lap `lap` (it wanders from its lap on). */
export const whirlD = (h: Hazard, time: number, lap: number) => (h.wander && lap >= h.wander[2] ? h.d + h.wander[0] * Math.sin(time * h.wander[1] + (h.phase ?? 0)) : h.d);

/** The whirlpools spinning near kart k pull it in toward their middles and round them, and turn its bow. */
function whirlPull(r: Race, k: Kart, dt: number) {
  for (const h of r.whirls) {
    const st = hazState(r, h, r.time, k.lap);
    if (st.lift <= 0 || !st.live) continue;
    const c = pointAt(r.track, h.s, st.d);
    const dx = c.x - k.x;
    const dz = c.z - k.z;
    const dist = Math.hypot(dx, dz);
    const pull = h.pull ?? 7;
    if (dist >= pull || dist < 1e-3) continue;
    const f = 1 - dist / pull;
    // (a CPU the launch has only just set down rows clear of the worst of it: see settling)
    const a = (h.power ?? 12) * f * st.lift * (k.mega > 0 ? 0.5 : k.shrink > 0 ? 1.6 : 1) * (settling(r, k) ? SETTLED_PULL : 1);
    const spin = h.spin ?? 1;
    k.kx += ((dx - dz * 0.6 * spin) / dist) * a * dt;
    k.kz += ((dz + dx * 0.6 * spin) / dist) * a * dt;
    if (k.y <= 0.05) k.h = wrapAngle(k.h - spin * f * f * st.lift * dt);
  }
}
/** How much of a whirlpool's pull a CPU just set down feels (see settling). */
const SETTLED_PULL = 0.35;
/** Whether (x, z) is over a whirlpool's core while it is strong enough to suck you under (for a kart, or an item, on lap `lap`). */
export function inCore(r: Race, x: number, z: number, lap: number) {
  for (const h of r.whirls) {
    const st = hazState(r, h, r.time, lap);
    if (!st.live || st.lift < 0.5) continue;
    const c = pointAt(r.track, h.s, st.d);
    if (Math.hypot(c.x - x, c.z - z) < (h.core ?? 1.3)) return h;
  }
  return null;
}

/** How long a crest of swell takes to roll right across, from 20 m out past one edge of the road to 20 m past the other. */
const swellLife = (r: Race, sw: Swell) => (2 * (r.track.half + 20)) / sw.c;
/** Whether a swell rolls in at s for a kart on lap `lap`, and how much of it reaches s (eased in at the ends). */
function swellTaper(r: Race, sw: Swell, s: number, lap: number) {
  if (lap < (sw.lap ?? 1) || lap > (sw.until ?? Infinity)) return 0;
  const a0 = deltaS(r.track, sw.s0, s);
  const a1 = deltaS(r.track, s, sw.s1);
  if (a0 < 0 || a1 < 0) return 0;
  return Math.min(1, a0 / 10, a1 / 10);
}
/**
 * Where across the channel each crest of a swell is at race time `time` (lateral offsets; see Swell): crest j of the set
 * that starts at t0 = phase + m * every is at -dir (half + 20) + dir c (time - t0 - j gap) while it rolls. Pure.
 */
export function crestsAt(r: Race, sw: Swell, time: number) {
  const out: number[] = [];
  const far = r.track.half + 20;
  const life = swellLife(r, sw);
  const m1 = Math.floor((time - sw.phase) / sw.every);
  const back = Math.ceil((life + (sw.n - 1) * sw.gap) / sw.every);
  for (let m = m1; m >= m1 - back; m--) {
    const t0 = sw.phase + m * sw.every;
    for (let j = 0; j < sw.n; j++) {
      const u = time - t0 - j * sw.gap;
      if (u >= 0 && u <= life) out.push(-sw.dir * far + sw.dir * sw.c * u);
    }
  }
  return out;
}
/**
 * The swell warning at s (for the HUD, the sound and the CPUs): which way the strongest set rolls (dir), how hard it
 * kicks, and k: 0 to 1 through the `warn` seconds before its first crest reaches the channel, 1 while its crests are in
 * the channel. Null when the water is flat.
 */
export function swellWarn(r: Race, s: number, time: number, lap: number): { dir: number; kick: number; k: number } | null {
  let best: { dir: number; kick: number; k: number } | null = null;
  const t = r.track;
  for (const sw of r.swells) {
    const taper = swellTaper(r, sw, s, lap);
    if (taper <= 0) continue;
    // (from the first crest reaching the channel's edge to the last leaving the far one)
    const edge = (20 - 0.5) / sw.c;
    const over = (sw.n - 1) * sw.gap + (2 * (t.half + 0.5)) / sw.c;
    const u = ((((time - sw.phase) % sw.every) + sw.every) % sw.every);
    let k = 0;
    if (u >= edge - sw.warn && u < edge) k = (u - (edge - sw.warn)) / sw.warn;
    else if (u >= edge && u <= edge + over) k = 1;
    // (and a set rolling across from the last cycle)
    else if (u + sw.every <= edge + over) k = 1;
    if (k > 0 && (!best || k * sw.kick * taper > best.k * best.kick)) best = { dir: sw.dir, kick: sw.kick * taper, k };
  }
  return best;
}
/** A crest of swell rolling under a kart on the water shoves it its way and bobs it up; a hop clears it. */
function swellHit(r: Race, k: Kart, dt: number) {
  k.swellCool = Math.max(0, k.swellCool - dt);
  // (a crest throws a shell once: one thrown along faster than the crest rolls is not thrown by it again)
  if (k.swellCool > 0) return;
  for (const sw of r.swells) {
    const taper = swellTaper(r, sw, k.s, k.lap);
    if (taper <= 0) continue;
    for (const d of crestsAt(r, sw, r.time)) {
      // (did it pass the kart's line this frame? Edge-triggered, so each crest throws it once)
      const was = d - sw.dir * sw.c * dt;
      if (sw.dir * (d - k.d) < 0 || sw.dir * (was - k.d) >= 0) continue;
      if (k.y > 0.12 || k.vy > 0) continue;
      k.kx += -r.track.tz[k.i] * sw.dir * sw.kick * taper;
      k.kz += r.track.tx[k.i] * sw.dir * sw.kick * taper;
      k.vy = Math.max(k.vy, 1.8);
      k.swellCool = 0.5;
      r.events.push({ t: 'swell', k: k.idx });
      return;
    }
  }
}

/**
 * A vessel's wake: a V spreading back from its stern, the arms WAKE_SPREAD out for every meter behind it, fading out
 * WAKE_LEN behind. Crossing an arm on the water (it sweeping past you, or you over it) bobs you up and throws you away
 * from its lane, once (with a moment before the next can); hopped, it passes under you. Hit one hard enough and it is a
 * jump: a trick in the air is a boost, as off a ramp.
 */
function wakes(r: Race, k: Kart, dt: number) {
  k.wakeCool = Math.max(0, k.wakeCool - dt);
  // (a shell just set back down is held steady, and starts afresh)
  if (k.calm > 0) {
    k.wakeIn = 0;
    return;
  }
  const t = r.track;
  r.vessels.forEach((V, j) => {
    const bit = 1 << j;
    const w = V.wake ?? 0;
    const a = deltaS(t, k.s, V.along) - lengthOf(V) / 2;
    const there = w > 0 && !V.gone && a > 0 && a <= WAKE_LEN;
    const inside = there && Math.abs(k.d - V.at) < V.r + WAKE_SPREAD * a;
    const was = (k.wakeIn & bit) !== 0;
    k.wakeIn = inside ? k.wakeIn | bit : k.wakeIn & ~bit;
    // (out of an arm only counts where the wake is: a vessel gone by, or its wake behind you, is not a crossing)
    // (hopped: it passes under you)
    if (inside === was || !there || k.wakeCool > 0 || k.y > 0.12 || k.vy > 0) return;
    const amp = w * (1 - a / WAKE_LEN);
    const sg = Math.sign(k.d - V.at) || 1;
    k.vy = Math.max(k.vy, 3 * amp);
    k.kx += -t.tz[k.i] * sg * 3.5 * amp;
    k.kz += t.tx[k.i] * sg * 3.5 * amp;
    k.v *= 1 - 0.04 * amp;
    k.wakeCool = 0.4;
    if (amp * k.v >= 14) {
      k.air = true;
      k.trickT = 0.4;
      k.trick = false;
    }
    r.events.push({ t: 'wake', k: k.idx, amp });
  });
}

/** A gust's ramp up and down: it blows full for `on` seconds less this much either end. */
export const GUST_RAMP = 0.25;
/**
 * Where a gust is in its cycle at race time `time` for a kart at s on lap `lap`: how hard it blows there (live, 0 to 1:
 * up over GUST_RAMP, held, down), how far through its warning it is (warn, 0 to 1, in the `warn` seconds before it
 * blows) and how much of it reaches s (taper: in over the first 10 m and out over the last). Null where or when it
 * does not blow.
 */
export function gustState(r: Race, g: Gust, s: number, time: number, lap: number) {
  if (lap < (g.lap ?? 1)) return null;
  const a0 = deltaS(r.track, g.s0, s);
  const a1 = deltaS(r.track, s, g.s1);
  if (a0 < 0 || a1 < 0) return null;
  const taper = Math.min(1, a0 / 10, a1 / 10);
  const c = (((time - g.phase) % g.every) + g.every) % g.every;
  const live = c < GUST_RAMP ? c / GUST_RAMP : c < g.on - GUST_RAMP ? 1 : c < g.on ? (g.on - c) / GUST_RAMP : 0;
  const warn = c >= g.every - g.warn ? (c - (g.every - g.warn)) / g.warn : 0;
  return { live, warn, taper };
}
/**
 * The wind at s at race time `time` for a kart on lap `lap`: meters a second squared across the road, to the right if
 * positive. A pure function of where, when and which lap, so every screen agrees about it without a word sent.
 */
export function windAt(r: Race, s: number, time: number, lap: number) {
  let a = 0;
  for (const g of r.gusts) {
    const st = gustState(r, g, s, time, lap);
    if (st && st.live > 0) a += g.a * st.live * st.taper;
  }
  return a;
}
/**
 * The gust warning at s: the strongest gust blowing or about to blow there (dir: which way, +1 to the right; a: how
 * hard it blows at its height; k: 0 to 1 through its warning, 1 once it blows). Null when the air is still.
 */
export function gustWarn(r: Race, s: number, time: number, lap: number): { dir: number; a: number; k: number } | null {
  let best: { dir: number; a: number; k: number } | null = null;
  for (const g of r.gusts) {
    const st = gustState(r, g, s, time, lap);
    if (!st || (st.live <= 0 && st.warn <= 0)) continue;
    const k = st.live > 0 ? 1 : st.warn;
    const a = Math.abs(g.a) * st.taper;
    if (!best || a * k > best.a * best.k) best = { dir: Math.sign(g.a), a, k };
  }
  return best;
}

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
  // (coming down from high above it, say off a feather, the kart lands rather than being thrown up off the lip again)
  if (on.ds > -0.35 && k.rampCool <= 0 && k.v > 8 && k.vy <= 0 && k.y <= on.height + 0.3) {
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
 * on, and falls where it lands; a bullet rides its rails over anything). A trench across the road is the same. On the
 * Skyway's glass a CPU the drone set down a moment ago is the exception (see lipHolds).
 */
function wall(r: Race, k: Kart) {
  const t = r.track;
  const at = locate(t, k.x, k.z, k.i);
  k.i = at.i;
  // (a hop clears a trench or a drop, but not the water: the splash height is the old one, so the ponds play as before)
  const grounded = k.y <= 0.05 && k.bullet <= 0 && k.sunk === 0;
  const low = k.y <= 0.3 && k.bullet <= 0 && k.sunk === 0;
  if (grounded) {
    for (const h of r.holes) if (inTrench(t, h, at.s, at.d)) return fallIn(r, k, r.holePast, at, h);
    // (a pane of the glass road that has blinked out, under the kart's middle, on the kart's own lap)
    for (const h of r.panels) if (inTrench(t, h, at.s, at.d) && hazState(r, h, r.time, k.lap).live) return fallIn(r, k, 'void', at, h);
    // (and on the water a whirlpool's core, strong enough to suck you under; but, like the lip, not a CPU the launch set
    // down a moment ago: see settling and whirlPull)
    if (r.whirls.length && !settling(r, k)) {
      const h = inCore(r, k.x, k.z, k.lap);
      if (h) return fallIn(r, k, 'water', at, h);
    }
  }
  const edge = edgeAt(t, at.s, at.d >= 0 ? 1 : -1);
  // (the same for everyone: a CPU that fell a moment ago keeps clear of the edge in its planning, nothing holds it on;
  // but on the glass and the water see lipHolds)
  const held = (edge.past === 'void' || (r.boat && edge.past === 'marsh')) && lipHolds(r, k);
  if (edge.past !== 'wall' && !held) {
    if ((edge.past === 'water' ? low : grounded) && Math.abs(at.d) > edge.lim) return fallIn(r, k, edge.past, at);
  } else {
    const lim = held ? edge.lim - LIP_HOLD : edge.lim - KART_R * scaleOf(k);
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
  // (on the water there is no grass: the channel runs right out to the wall's foot)
  k.offroad = !r.boat && Math.abs(now.d) > t.half + CURB * 0.6;
}

/**
 * On the Skyway's glass, where a shove or a slide carries a long way and the drone has only just set it down, a CPU still
 * finding its feet after a fall (see Ai.care) is held by the lip like a rail, its wheels on the brink: a fallback for
 * whatever its planning did not see coming (it keeps well clear of the brink then anyway), so it never goes straight
 * back over. Only the lip: a pane or the Gap drops it like anyone. On the slough the same at the brink of the marsh,
 * where a shell slides on as far (and a whirlpool's core lets it go: see settling), and the brink holds a CPU spinning
 * from a hit as well, so an item is not a free tow into the marsh; the weir takes it like anyone. You get no such help.
 */
const lipHolds = (r: Race, k: Kart) => settling(r, k) || (r.boat && k.kind === 'cpu' && k.spin > 0 && k.sunk === 0);
/**
 * A CPU still finding its feet after a fall, on the courses where it gets help for that (see lipHolds). (On the water a
 * CPU is careful a moment after a spin by the brink too, but that is not a fall.)
 */
const settling = (r: Race, k: Kart) => cpuHelp(r) && k.kind === 'cpu' && k.ai !== null && k.ai.care > 0 && k.sunk === 0 && (!r.boat || r.time - k.ai.fellAt < CARE_T);
/** The courses where a CPU gets the help after a fall that you do not (see lipHolds): the Skyway's glass and the water. */
const cpuHelp = (r: Race) => glass(r) || r.boat;
/** How far short of the lip itself (its middle over the brink) it holds a kart (see lipHolds). */
const LIP_HOLD = 0.1;

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
    // (and a vessel along its length: a barge is 34 m long)
    const near = h.kind === 'bollard' || h.kind === 'rotor' ? 16 : h.kind === 'shuttle' || h.kind === 'mower' ? (h.cross ?? 16) + lengthOf(h) : drives(h) ? Math.max(9, lengthOf(h) / 2 + 3) : 9;
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
    if (traffic(h.kind)) {
      // (off its stretch it is not there at all; in the air it still gets you)
      if (!tough && !h.gone) trafficHit(r, k, h);
      continue;
    }
    if (drives(h)) {
      // (a vessel off its stretch is not there at all, and a hop clears a log)
      if (!tough && !h.gone && !(h.kind === 'log' && k.y > 0.12)) busHit(r, k, h);
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
      // (crawling through it, say getting going again after it spun you, it lets you go; and once it has spun you, you
      // have the time to get off it before it can again)
      if (dist < h.r && Math.abs(k.v) > OIL_V && hitKart(r, k, 'spin', -1)) k.safe = Math.max(k.safe, 3);
      continue;
    }
    const reach = h.r + KART_R * scaleOf(k);
    if (tough || dist >= reach) continue;
    // (a buoy bobs off your bow: it slows you, the more the squarer you hit it, and never spins you)
    if (h.kind === 'buoy') {
      buoyHit(r, k, h, dx, dz, dist, reach);
      continue;
    }
    const into = shove(r, k, h, dx, dz, dist, reach);
    if (into <= 0) continue;
    // a cow does not take kindly to it, nor does a cyclist, a golfer or a golf cart crossing on its path (nor the chain
    // ferry crossing the slough)
    // (a ferry on its chain only spins you if you hit it hard: it is slow, and its side shoves you off it)
    if ((h.kind === 'cow' || h.kind === 'bike' || h.kind === 'golfer' || h.kind === 'cart' || h.kind === 'ferry') && into > (h.kind === 'ferry' ? 6 : 3)) {
      if (hitKart(r, k, 'spin', -1)) r.events.push(h.kind === 'ferry' ? { t: 'haz', k: k.idx, kind: 'ferry' } : { t: h.kind === 'cow' ? 'moo' : h.kind === 'bike' ? 'ding' : h.kind === 'golfer' ? 'fore' : 'toot', k: k.idx });
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

/** A buoy: pushed back out of it, bounced gently off it and slowed, the more the more squarely it was hit. */
function buoyHit(r: Race, k: Kart, h: LiveHazard, dx: number, dz: number, dist: number, reach: number) {
  const nx = dist > 1e-6 ? dx / dist : -Math.sin(k.h);
  const nz = dist > 1e-6 ? dz / dist : -Math.cos(k.h);
  k.x = h.x + nx * reach;
  k.z = h.z + nz * reach;
  const vx = Math.sin(k.h) * k.v + k.kx;
  const vz = Math.cos(k.h) * k.v + k.kz;
  const into = -(vx * nx + vz * nz);
  if (into <= 0) return;
  k.kx += nx * into * 0.8;
  k.kz += nz * into * 0.8;
  const hit = into / (Math.hypot(vx, vz) || 1);
  k.v *= (1 - Math.min(0.45, 0.5 * hit)) * (into > 1 ? 0.92 : 1);
  // (and the bow swung off it, round whichever side of it it was heading for, so a shell nosed into one slides past)
  const side = Math.sign(Math.sin(k.h) * -nz + Math.cos(k.h) * nx) || 1;
  k.h = wrapAngle(k.h + wrapAngle(headingOf(-nz * side, nx * side) - k.h) * Math.min(1, hit * 0.7));
  if (into > 1) r.events.push({ t: 'bonk', k: k.idx });
}

// ---------------------------------------------------------------------------------------------------------------
// The set pieces: pile drivers, bollard banks, sprinklers and wrecking balls, all on the race clock

/** A pile driver's cycle: the head drops (slam), sits on the ground (`on`), lifts (solid for the first `low` of it) and hovers, shaking for the last `warn`. */
export const HAMMER = { every: 3.6, slam: 0.18, on: 0.7, low: 0.3, lift: 1.2, warn: 0.8, drop: 5 };
/**
 * A bank of bollards: it pops up in `rise`, stands `on`, drops in `fall`; amber for `warn` before; `thick` either way
 * along the road. A kart caught by one is put back `back` behind its line, within `lane` of the middle of the bank's
 * lane (well clear of the next bank's).
 */
export const BANK = { every: 3.2, on: 1.6, warn: 0.9, rise: 0.2, fall: 0.2, thick: 0.35, back: 5, lane: 0.6 };
/** A sprinkler's jet: this wide either side of the arm, and this high (a hop does not clear it). */
export const JET = { w: 0.4, high: 1.4 };
/** The wrecking ball throws you clear at this much plus its own sideways speed, up to the most. */
export const WRECK_KNOCK = 6;
export const WRECK_MAX = 12;
/**
 * The Marguerite crossing: bells and flashing lights `warn` seconds before its nose reaches the road, the gate arms down
 * `gate` seconds before (they lower over `drop`), and it sits out any crossing a bus doing its rounds comes within
 * `clear` meters of (its own length aside) from the first bell to its tail clearing the road.
 */
export const SHUTTLE = { warn: 3, gate: 1, drop: 0.6, clear: 22 };
/**
 * Something on a leash's cycle (the Stanford Tree, or a goose guarding its bank), in seconds before the end of each: it
 * crouches (its eyes going red) from `crouch`, lunges out from `out`, holds from `hold` and springs back from `back`; it
 * sits `rest` in from its post the rest of the time.
 */
export const TREE = { crouch: 1.85, out: 1.25, hold: 0.95, back: 0.6, rest: 1.2 };
/**
 * The gang mower crossing the fairway: the beeper and its beacon `warn` seconds before its nose reaches the road, and it
 * sits out any crossing a cart on its rounds comes within `clear` meters of (its own length aside), from the first beep
 * to its tail clearing the road.
 */
export const MOWER = { warn: 2.5, clear: 22 };
/** A vehicle hits you this hard and you only bump off it; harder spins you; harder still (head on, say) tumbles you. */
export const CAR_BUMP = 3;
export const CAR_TUMBLE = 9;
export const CAR_KNOCK = 12;

/**
 * Whether a bus (or a cart on its rounds) has been within right-of-way reach of h at any time in the last `span`
 * seconds up to `time`. The vehicles run at a steady speed, so the piece's offset from one slides by drive·span over
 * the window: pure in time, like rightOfWay itself.
 */
export function yieldedWithin(r: Race, h: Hazard, time: number, span: number) {
  const t = r.track;
  const t0 = Math.max(0, time - span);
  const dt = Math.max(0, time - t0);
  for (const v of r.hazards) {
    if (!yields(v)) continue;
    const reach = lengthOf(v) / 2 + (h.kind === 'bollard' ? (h.w ?? 0) : h.r) + 6;
    const d0 = deltaS(t, hazardS(t, v, t0), h.s);
    const d1 = d0 - (v.drive ?? 0) * dt;
    if (Math.min(d0, d1) < reach && Math.max(d0, d1) > -reach) return true;
  }
  return false;
}
/** Who has right of way: the buses and carts on their rounds, and on the water the coach's launches (Hazard.priority). */
const yields = (v: Hazard) => (v.kind === 'bus' || v.kind === 'cart' || !!v.priority) && drives(v) && !v.span;
/**
 * Whether a bus (or a cart on its rounds) comes within `reach` of h (its own length aside) along the road at any time
 * from t0 to t1. They run at a steady speed, so this is exact and pure in time.
 */
function nearWithin(r: Race, h: Hazard, t0: number, t1: number, reach: number) {
  const t = r.track;
  for (const v of r.hazards) {
    if (!yields(v)) continue;
    const far = reach + lengthOf(v) / 2;
    const d0 = deltaS(t, hazardS(t, v, Math.max(0, t0)), h.s);
    const d1 = d0 - (v.drive ?? 0) * Math.max(0, t1 - Math.max(0, t0));
    if (Math.min(d0, d1) < far && Math.max(d0, d1) > -far) return true;
  }
  return false;
}
/**
 * The gang mower crossing the road (see HazardKind) on its crossing n (from 0, at race time `phase`): it goes from left to
 * right on the first, back on the next and so on, so it waits where the last one left it. Where its middle is across the
 * road `c` seconds into a crossing, how long a crossing takes, and when in it its nose reaches the wall line and its tail
 * leaves the far one.
 */
export function mowerRun(r: Race, h: Hazard, n: number) {
  const v = Math.abs(h.speed ?? 5);
  const dir = ((n % 2) + 2) % 2 === 0 ? 1 : -1;
  const half = lengthOf(h) / 2;
  const from = (h.cross ?? 16) + half;
  const edge = r.track.edge;
  return { v: dir * v, dir, half, from, pass: (2 * from) / v, enter: (from - half - edge) / v, leave: (from + half + edge) / v, at: (c: number) => -dir * from + dir * v * c };
}
/** Whether the mower sits out the crossing that starts at race time c0: before its first, or with a cart on its rounds near. */
export function mowerSkips(r: Race, h: Hazard, c0: number, run = mowerRun(r, h, 0)) {
  if (c0 < (h.phase ?? 0) - 1e-6) return true;
  return nearWithin(r, h, c0 + run.enter - MOWER.warn, c0 + run.leave, MOWER.clear);
}
/** (and remembered for each crossing, as the CPUs ask about the same few again and again: it never changes) */
const skipped = new WeakMap<Hazard, Map<number, boolean>>();
function mowerSkipsAt(r: Race, h: Hazard, n: number) {
  let seen = skipped.get(h);
  if (!seen) skipped.set(h, (seen = new Map()));
  let skip = seen.get(n);
  if (skip === undefined) {
    skip = mowerSkips(r, h, (h.phase ?? 0) + n * (h.every ?? 28), mowerRun(r, h, n));
    seen.set(n, skip);
  }
  return skip;
}
/**
 * The Marguerite crossing the road (see HazardKind): where its middle is across the road `c` seconds into a crossing, how
 * long a crossing takes, and when in it its nose reaches the road and its tail leaves it.
 */
export function shuttleRun(r: Race, h: Hazard) {
  const v = h.speed ?? 7;
  const dir = Math.sign(v) || 1;
  const half = lengthOf(h) / 2;
  const from = (h.cross ?? 16) + half;
  const edge = r.track.edge;
  return { v, dir, half, from, pass: (2 * from) / Math.abs(v), enter: (from - half - edge) / Math.abs(v), leave: (from + half + edge) / Math.abs(v), at: (c: number) => -dir * from + v * c };
}
/**
 * Whether the crossing that starts at race time c0 is sat out: a bus on its rounds near the crossing then, or before its
 * first (at race time `phase`).
 */
export function shuttleSkips(r: Race, h: Hazard, c0: number) {
  if (c0 < (h.phase ?? 0) - 1e-6) return true;
  const run = shuttleRun(r, h);
  return nearWithin(r, h, c0 + run.enter - SHUTTLE.warn, c0 + run.leave, SHUTTLE.clear);
}
/** The ball stays hauled up this long after a bus has gone by, while it visibly comes back down. */
export const WRECK_GRACE = 0.5;

/**
 * The Marguerite has right of way: while a bus (or a cart on its rounds) is this near a set piece along the road, the
 * piece stands aside (the hammer and the ball hauled up, the bollards down, the jet off), so a bus never leaves a kart
 * nowhere to go beside one. Pure in time, like the buses themselves.
 */
export function rightOfWay(r: Race, h: Hazard, time: number) {
  const t = r.track;
  for (const v of r.hazards) {
    if (!yields(v)) continue;
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
export type HazPhase = 'off' | 'idle' | 'slam' | 'down' | 'rise' | 'pop' | 'up' | 'fall' | 'on' | 'open';
export type HazState = { live: boolean; solid: boolean; lift: number; warn: number; d: number; ang: number; phase: HazPhase };
export function hazState(r: Race, h: Hazard, time: number, lap: number): HazState {
  const st: HazState = { live: false, solid: false, lift: 0, warn: 0, d: h.kind === 'wrecker' ? hazardD(h, time) : h.d, ang: 0, phase: 'off' };
  if (h.kind === 'wet') {
    st.live = awake(h, lap);
    st.phase = st.live ? 'on' : 'off';
    return st;
  }
  const out = awake(h, lap);
  if (h.kind === 'boulder') {
    // a boulder: in play while it is rolling across the road (and a little past its edges, as wide as it is)
    if (!out) return st;
    const b = boulderAt(r, h, time);
    st.d = b.d;
    st.warn = b.warn;
    st.lift = b.u;
    st.phase = b.rolling ? 'on' : 'idle';
    st.live = st.solid = b.rolling && Math.abs(b.d) < r.track.edge + h.r;
    return st;
  }
  if (h.kind === 'whirl') {
    // a whirlpool: its foam turning for `warn` seconds, then spinning up, `on` seconds strong (lift is how strong), and
    // dying away; broken up by a launch going through, and a cycle only kept if its whole warning was shown
    if (!out) return st;
    st.phase = 'idle';
    st.d = whirlD(h, time, lap);
    if (rightOfWay(r, h, time)) return st;
    const every = h.every ?? 7;
    const on = h.on ?? 4.5;
    const warn = h.warn ?? 1.5;
    const c = cycleAt(h, time, every);
    if (c < on && yieldedWithin(r, h, time, c + warn)) return st;
    if (c >= every - warn && yieldedWithin(r, h, time, c - (every - warn))) return st;
    const strength = c < WHIRL_RAMP ? c / WHIRL_RAMP : c < on - WHIRL_RAMP ? 1 : c < on ? (on - c) / WHIRL_RAMP : 0;
    if (strength > 0) {
      st.live = true;
      st.lift = strength;
      st.phase = 'on';
    } else if (c >= every - warn) st.warn = (c - (every - warn)) / warn;
    return st;
  }
  if (h.kind === 'panel' || h.kind === 'geyser') {
    // a pane of glass that blinks out (open: a hole), or a grate that blows flame (on): `on` seconds from the start of
    // each cycle, with `warn` seconds of telegraph before it (no bus ever comes this way)
    if (!out) return st;
    st.phase = 'idle';
    const every = h.every ?? 3;
    const c = cycleAt(h, time, every);
    // (a fountain jet beside the bus lane stands aside for a bus like any set piece, keeping only beats it warned of)
    if (h.kind === 'geyser' && (rightOfWay(r, h, time) || (c < (h.on ?? 1) && yieldedWithin(r, h, time, c + (h.warn ?? 0.8))) || (c >= every - (h.warn ?? 0.8) && yieldedWithin(r, h, time, c - (every - (h.warn ?? 0.8)))))) return st;
    if (c < (h.on ?? 1)) {
      st.phase = h.kind === 'panel' ? 'open' : 'on';
      st.live = true;
      st.lift = 1;
    } else if (c >= every - (h.warn ?? 0.8)) st.warn = (c - (every - (h.warn ?? 0.8))) / (h.warn ?? 0.8);
    return st;
  }
  if (h.kind === 'mower') {
    // the gang mower across the fairway: its beeper and beacon first, then across it goes, tractor first, and waits on the
    // far side for the next, back the other way; or it waits this time round, a cart on its rounds being near
    const every = h.every ?? 28;
    const c = cycleAt(h, time, every);
    const c0 = time - c;
    const n = Math.round((c0 - (h.phase ?? 0)) / every);
    const run = mowerRun(r, h, n);
    st.phase = 'idle';
    st.d = run.at(0);
    const skip = mowerSkipsAt(r, h, n);
    if (!skip && c < run.pass) {
      st.d = run.at(c);
      if (c > run.enter && c < run.leave) {
        st.live = st.solid = true;
        st.phase = 'on';
        st.warn = 1;
        st.lift = 1;
        return st;
      }
    } else if (!skip) st.d = run.at(run.pass);
    // (and the next crossing's beeping, if it is not sat out)
    const ahead = c < run.enter && !skip;
    const next = ahead ? c0 : c0 + every;
    const nrun = ahead ? run : mowerRun(r, h, n + 1);
    const due = next + nrun.enter - time;
    if (due > 0 && due <= MOWER.warn && !(ahead ? skip : mowerSkipsAt(r, h, n + 1))) st.warn = 1 - due / MOWER.warn;
    return st;
  }
  if (h.kind === 'shuttle') {
    // the Marguerite across the road: bells and lights first, the gates down, then across it goes, nose to tail; or it
    // waits in its side street this time round, a bus doing its rounds being near
    const run = shuttleRun(r, h);
    const every = h.every ?? 17;
    const c = cycleAt(h, time, every);
    const c0 = time - c;
    st.phase = 'idle';
    st.d = run.at(0);
    // (this crossing, or the next one's warning)
    const skip = shuttleSkips(r, h, c0);
    if (!skip && c < run.pass) {
      st.d = run.at(c);
      if (c > run.enter && c < run.leave) {
        st.live = st.solid = true;
        st.phase = 'on';
        st.warn = 1;
        st.lift = 1;
        return st;
      }
    }
    const next = c < run.enter && !skip ? c0 : c0 + every;
    const due = next + run.enter - time;
    if (due > 0 && due <= SHUTTLE.warn && !(next === c0 ? skip : shuttleSkips(r, h, next))) {
      st.warn = 1 - due / SHUTTLE.warn;
      st.lift = clamp((SHUTTLE.gate - due) / SHUTTLE.drop, 0, 1);
      if (next !== c0) st.d = run.at(0);
    }
    // (and the gates lift as its tail clears the road)
    else if (!skip && c >= run.leave && c < run.leave + SHUTTLE.drop) st.lift = 1 - (c - run.leave) / SHUTTLE.drop;
    return st;
  }
  const yielding = out && rightOfWay(r, h, time);
  if (h.kind === 'tether') {
    // on its leash (the Tree, or a goose): sat by its post (solid there, like a planter), it crouches, lunges out to its
    // mark, holds a moment and springs back; while it lunges it tumbles whoever it catches. It sits tight while a bus or a
    // cart goes by, and a lunge is only made if its whole crouch was shown. From its `rush` lap, if it has one, it goes
    // for you more often
    const rest = h.d - TREE.rest * Math.sign(h.d || 1);
    const aim = h.aim ?? 0;
    st.d = rest;
    st.solid = out;
    if (!out) return st;
    st.phase = 'idle';
    if (yielding) return st;
    const every = h.rush && lap >= h.rush[0] ? h.rush[1] : (h.every ?? 3.2);
    const left = every - cycleAt(h, time, every);
    if (left > TREE.crouch || yieldedWithin(r, h, time, TREE.crouch - left)) return st;
    const ease = (u: number) => u * u * (3 - 2 * u);
    if (left > TREE.out) {
      st.warn = (TREE.crouch - left) / (TREE.crouch - TREE.out);
      return st;
    }
    st.live = true;
    st.phase = 'on';
    st.warn = 1;
    st.lift = left > TREE.hold ? ease((TREE.out - left) / (TREE.out - TREE.hold)) : left > TREE.back ? 1 : ease(left / TREE.back);
    st.d = rest + (aim - rest) * st.lift;
    return st;
  }
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
    // (and it stays up a moment after the bus has gone, while it visibly comes down)
    const up = yielding || (out && yieldedWithin(r, h, time, WRECK_GRACE));
    st.live = st.solid = out && !up;
    st.lift = up ? 1 : 0;
    st.phase = !out ? 'off' : up ? 'idle' : 'on';
    return st;
  }
  if (h.kind === 'hammer') {
    st.lift = 1;
    if (!out) return st;
    st.phase = 'idle';
    if (yielding) return st;
    const every = h.every ?? HAMMER.every;
    const on = h.on ?? HAMMER.on;
    const warn = h.warn ?? HAMMER.warn;
    const c = cycleAt(h, time, every);
    // a beat is only kept if its whole warning was shown: a bus through during the warn (or since) skips that slam,
    // and the head stays up until the next one it can telegraph in full
    if (c < HAMMER.slam + on + HAMMER.lift && yieldedWithin(r, h, time, c + warn)) return st;
    if (c >= every - warn && yieldedWithin(r, h, time, c - (every - warn))) return st;
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
  const warn = h.warn ?? BANK.warn;
  const c = cycleAt(h, time, every);
  // (as for the hammer: no rising without its whole amber shown first)
  if (c < BANK.rise + on + BANK.fall && yieldedWithin(r, h, time, c + warn)) return st;
  if (c >= every - warn && yieldedWithin(r, h, time, c - (every - warn))) return st;
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
  if (h.kind === 'whirl') {
    // (where it would catch you while it spins, and in the last of its warning: never into one about to form)
    if ((st.live || st.warn > 0.6) && Math.abs(ds) < h.r) {
      const hc = Math.sqrt(h.r * h.r - ds * ds);
      out.push([st.d - hc, st.d + hc]);
    }
    return out;
  }
  if (h.kind === 'panel') {
    // (a pane is `len` long from s, so it is on the lines from 0 to len past it)
    if (st.live && ds >= 0 && ds <= (h.len ?? 0)) out.push([h.d - (h.w ?? h.r), h.d + (h.w ?? h.r)]);
    return out;
  }
  if (h.kind === 'bollard') {
    if (st.solid && Math.abs(ds) <= BANK.thick) out.push([h.d - (h.w ?? 0) / 2, h.d + (h.w ?? 0) / 2]);
    return out;
  }
  if (h.kind === 'shuttle' || h.kind === 'mower') {
    // (the Marguerite or the mower is a box across the road, its length across it and its width along it)
    if (st.live && Math.abs(ds) <= h.r) out.push([st.d - lengthOf(h) / 2, st.d + lengthOf(h) / 2]);
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

/**
 * A boulder off the hillside (see HazardKind): every `every` seconds, `warn` of dust and rumble, then it rolls across at
 * `speed` from `out` past the wall on its uphill side (unless the course says where, Hazard.cross) to as far past the
 * other.
 */
export const BOULDER = { every: 7, warn: 1.2, speed: 7, out: 4 };

/**
 * Where a boulder is across the road at race time `time` (d), whether it is rolling (and u, how far across it has got,
 * 0 to 1), the way it rolls (dir: +1 toward the right) and how far into its warning it is (0 to 1). Up the chute on its
 * uphill side until it goes, gone down the hill on the far side after. Pure in time, like the other set pieces.
 */
export function boulderAt(r: Race, h: Hazard, time: number) {
  const every = h.every ?? BOULDER.every;
  const warn = h.warn ?? BOULDER.warn;
  const from = h.cross ?? -(r.track.edge + BOULDER.out);
  const dir = from < 0 ? 1 : -1;
  const span = 2 * Math.abs(from);
  const c = cycleAt(h, time, every);
  if (c < warn) return { d: from, rolling: false, u: 0, dir, warn: c / warn };
  const run = (c - warn) * (h.speed ?? BOULDER.speed);
  if (run > span) return { d: -from, rolling: false, u: 1, dir, warn: 0 };
  return { d: from + dir * run, rolling: true, u: run / span, dir, warn: 0 };
}

/** Caught by a set piece: what each one does to a kart that is in its way right now (see HazardKind). */
function pieceHit(r: Race, k: Kart, h: LiveHazard, dx: number, dz: number, tough: boolean, flying: boolean) {
  const st = hazState(r, h, r.time, k.lap);
  const R = KART_R * scaleOf(k);
  const caught = (how: HitHow) => {
    if (hitKart(r, k, how, -1)) r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
  };
  // (a pane that blinks out drops you through it, and a whirlpool sucks you under: see wall())
  if (h.kind === 'panel' || h.kind === 'whirl') return;
  if (h.kind === 'geyser') {
    // a column of flame: it spins you, in the air or not (it reaches higher than a hop)
    if (!st.live || tough) return;
    if (Math.hypot(dx, dz) < h.r + R) caught('spin');
    return;
  }
  if (h.kind === 'shuttle' || h.kind === 'mower') {
    if (!st.live || tough) return;
    if (h.kind === 'shuttle') shuttleHit(r, k, h, st.d);
    else mowerHit(r, k, h, st.d);
    return;
  }
  if (h.kind === 'tether') {
    if (!st.solid || tough) return;
    // where it is now: on the end of its leash (the Tree's bungee), or sat by its post (on its own stretch of road)
    if (Math.abs(deltaS(r.track, h.s, k.s)) > h.r + R + 2) return;
    const p = pointAt(r.track, h.s, st.d);
    const ox = k.x - p.x;
    const oz = k.z - p.z;
    const dist = Math.hypot(ox, oz);
    const reach = h.r + R;
    if (dist >= reach) return;
    const nx = dist > 1e-6 ? ox / dist : -Math.sin(k.h);
    const nz = dist > 1e-6 ? oz / dist : -Math.cos(k.h);
    k.x = p.x + nx * reach;
    k.z = p.z + nz * reach;
    const vx = Math.sin(k.h) * k.v + k.kx;
    const vz = Math.cos(k.h) * k.v + k.kz;
    const into = -(vx * nx + vz * nz);
    if (st.live) {
      // lunging: bowled over and thrown clear, in the air or not (it is taller than a hop, and a goose flies up at you);
      // and a goose never throws you back toward its post (it drives you off its bank, never into its pond)
      if (hitKart(r, k, 'tumble', -1)) {
        const rx = -p.tz;
        const rz = p.tx;
        const out = nx * rx + nz * rz;
        const back = h.look === 'goose' && out * Math.sign(h.d) > 0 ? 2 * out : 0;
        k.kx += (nx - back * rx) * WRECK_KNOCK;
        k.kz += (nz - back * rz) * WRECK_KNOCK;
        k.safe += 0.6;
        r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
      }
      return;
    }
    // sat by its post it is a planter you bounce off
    if (flying || into <= 0) return;
    k.kx += nx * into * 1.3;
    k.kz += nz * into * 1.3;
    k.v *= 1 - Math.min(0.9, (0.6 * into) / (Math.hypot(vx, vz) || 1));
    if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
    return;
  }
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
    const w = h.w ?? 0;
    // squarely in front of this bank: the kart is put back BANK.back behind the line (or, more than halfway over it, just
    // off its far side), with room to get going again and the time to see the next gap coming. Left right up against
    // the slab, it crept at it and was caught as it rose, again and again
    // (and square in a bank's lane: this one's, or the next one's if the kart's middle was over that)
    const lane = Math.abs(across) <= w / 2 ? clamp(at.d, h.d - BANK.lane, h.d + BANK.lane) : h.d + Math.sign(across) * (w - BANK.lane);
    const off = (gone: number) => pointAt(t, along < 0 ? h.s - BANK.back : h.s + gone, lane);
    // (a hop does not clear a bank standing a meter high: popping up under a kart it throws it off)
    if (st.phase === 'pop') {
      const p = off(BANK.thick + R + 0.3);
      k.x = p.x;
      k.z = p.z;
      k.kx = k.kz = 0;
      k.v = Math.min(k.v, 3);
      if (hitKart(r, k, 'tumble', -1)) r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
      return;
    }
    // up: squashed against it and put back behind the line (or out of its end), nearly stopped
    // (the row runs wall to wall, so out of a bank's end is only into the next one's: always back)
    const p = off(BANK.thick + R);
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
      // water is right there on the sweeper, and not on into the hub from right behind it)
      const behind = dx * h.tx + dz * h.tz < 0 && Math.abs(dz * h.tx - dx * h.tz) < h.r + R + 0.3;
      if (!behind) {
        k.kx += h.tx * 6;
        k.kz += h.tz * 6;
      }
      r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
    }
    return;
  }
  if (h.kind === 'wrecker' || h.kind === 'boulder') {
    // (a boulder rolling across hits like the ball: it is as heavy and moves as fast)
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
      const knock = Math.min(WRECK_KNOCK + (h.kind === 'boulder' ? (h.speed ?? BOULDER.speed) : Math.abs(hazardV(h, r.time))), WRECK_MAX);
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

/** The code the track stores the open sky by (see PASTS). */
const VOID = PASTS.indexOf('void');

/** Seconds after a fall a CPU keeps well clear of the edge (and the edge holds it like a wall). */
const CARE_T = 12;
/** A CPU that falls again within this long of its last fall drives very carefully for SHAKEN_T (see Ai.shaken). */
const SHAKEN_WITHIN = 20;
const SHAKEN_T = 20;

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
  // (only from the run-up, past where the crane puts you back: never carried forward; the same before the glass panes
  // that blink out)
  const trench = hole ?? (r.panels.length ? [...r.holes, ...r.panels] : r.holes).find((h) => deltaS(t, h.back ?? h.s, at.s) > 0 && deltaS(t, h.s, at.s) <= (h.len ?? 0)) ?? null;
  // (out of a whirlpool the launch tows you out the far side of it, across the river, past where its pull reaches: put
  // back short of it, a shell only just under way meets it spinning up again)
  const whirl = hole?.kind === 'whirl';
  const from = whirl ? wrapS(t, hole.s + (hole.pull ?? 7) + 3) : trench ? (trench.back ?? at.s) : at.s;
  // (and on the water, from the marsh, in the middle of the channel: well clear of the brink it went over; out of a
  // whirlpool on the side of the channel away from the next one down the river, if one is near, so a shell only just
  // under way is not set down in the lane it is about to be drawn out of)
  const next = whirl ? r.whirls.find((w) => w !== hole && awake(w, k.lap) && deltaS(t, from, w.s) > 0 && deltaS(t, from, w.s) < 70) : undefined;
  const d0 = whirl ? -Math.sign((next ? next.d : -hole.d) || 1) * 2.5 : r.boat ? 0 : at.d;
  k.fell = { past, hole: hole !== null, v: Math.abs(k.v), to: spotFor(r, k, from, d0, r.time + r.tier.fallT) };
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
    // (on the water, a whirlpool it failed to see and was sucked under by it sees the next time round)
    if (r.boat) k.ai.blunders = {};
    // (and where the road itself is the danger, a second fall soon after the first shakes it: very careful for a while)
    if (r.slick) {
      if (r.time - k.ai.fellAt < SHAKEN_WITHIN) k.ai.shaken = SHAKEN_T;
      k.ai.fellAt = r.time;
      // (and whatever it failed to see coming this lap it sees now: a pane it never saw blink would otherwise drop it
      // again every time the drone puts it back in front of it)
      for (const key in k.ai.blunders) k.ai.blunders[key] = false;
      k.ai.blink = k.ai.blinkT = 0;
    }
  }
  k.v = 0;
  k.kx = 0;
  k.kz = 0;
  k.vy = 0;
  k.y = 0;
  k.drift = 0;
  k.charge = 0;
  k.boost = 0;
  k.turbo = 0;
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
  // the bus's two-tone horn, or a golf cart's beep-beep (and on the water a launch's or a tug's horn: a log only spins
  // you if you run into it hard)
  if (into > (h.kind === 'log' ? 6 : 3) && hitKart(r, k, 'spin', -1)) r.events.push(h.kind === 'bus' || h.kind === 'cart' ? { t: h.kind === 'bus' ? 'honk' : 'toot', k: k.idx } : { t: 'haz', k: k.idx, kind: h.kind });
  else if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
}

/**
 * Run into by a vehicle (traffic, or the golf course's mower), or running into one: how hard the two closed on each
 * other decides it. Hardly at all and you bump off it; harder and you spin out; harder still (on Expert: head on into an
 * oncoming car, say) you tumble, and the item in your hand goes flying. A shrunken kart is squashed flat. You are thrown
 * clear by up to CAR_KNOCK.
 */
function crash(r: Race, k: Kart, h: Hazard, into: number, nx: number, nz: number) {
  const knock = Math.min(1.3 * into, CAR_KNOCK);
  k.kx += nx * knock;
  k.kz += nz * knock;
  if (into <= CAR_BUMP) {
    k.v *= 0.85;
    return;
  }
  const how: HitHow = k.shrink > 0 ? 'squash' : into > CAR_TUMBLE && expert(r) ? 'tumble' : 'spin';
  const held = k.item;
  if (!hitKart(r, k, how, -1)) {
    if (into > 5) r.events.push({ t: 'wall', k: k.idx, power: into });
    return;
  }
  if (how === 'tumble' && held && k.roll === 0 && !k.trail) {
    k.item = null;
    k.uses = 0;
  }
  r.events.push({ t: 'haz', k: k.idx, kind: h.kind });
}

/**
 * A kart touching the gang mower crossing the road (its middle at d): put out along the road, the side of it the kart is
 * on (never carried across with it), with a crash as hard as it ran into the mower's side, or the tractor's nose into it.
 */
function mowerHit(r: Race, k: Kart, h: LiveHazard, d: number) {
  const R = KART_R * scaleOf(k);
  // (only on its own stretch of road)
  if (Math.abs(deltaS(r.track, h.s, k.s)) > h.r + R + 2) return;
  const c = pointAt(r.track, h.s, d);
  const ox = k.x - c.x;
  const oz = k.z - c.z;
  const along = ox * c.tx + oz * c.tz;
  const across = -ox * c.tz + oz * c.tx;
  const inL = h.r + R - Math.abs(along);
  const inW = lengthOf(h) / 2 + R - Math.abs(across);
  if (inL <= 0 || inW <= 0) return;
  const sg = Math.sign(along) || -1;
  k.x += c.tx * sg * inL;
  k.z += c.tz * sg * inL;
  const vx = Math.sin(k.h) * k.v + k.kx;
  const vz = Math.cos(k.h) * k.v + k.kz;
  const own = -(vx * c.tx + vz * c.tz) * sg;
  // (and at its ends, how fast it came across into the kart)
  const every = h.every ?? 28;
  const v = mowerRun(r, h, Math.round((r.time - cycleAt(h, r.time, every) - (h.phase ?? 0)) / every)).v;
  const nose = inW < inL ? (v - (-vx * c.tz + vz * c.tx)) * Math.sign(across) : 0;
  const into = Math.max(own, nose);
  if (into <= 0) return;
  if (own > 0) k.v *= 1 - Math.min(0.9, (0.6 * own) / (Math.hypot(vx, vz) || 1));
  crash(r, k, h, into, c.tx * sg, c.tz * sg);
}

/**
 * A kart touching a car or a van: it is never carried along by it (an oncoming car would drive you back down the
 * road), but put out the side of it, the side its middle is on (into the road rather than the wall unless it is well over
 * that way), with a crash as hard as the two closed on each other face on.
 */
function trafficHit(r: Race, k: Kart, h: LiveHazard) {
  const R = KART_R * scaleOf(k);
  const at = inBus(h, k.x, k.z, R);
  if (!at) return;
  // (the face it met: its nose, its tail, or a side)
  let fx: number;
  let fz: number;
  if (at.inL < at.inW) {
    const sg = Math.sign(at.along) || -1;
    fx = h.tx * sg;
    fz = h.tz * sg;
  } else {
    const sg = Math.sign(at.across) || 1;
    fx = -h.tz * sg;
    fz = h.tx * sg;
  }
  const vx = Math.sin(k.h) * k.v + k.kx;
  const vz = Math.cos(k.h) * k.v + k.kz;
  const drive = h.drive ?? 0;
  const into = (drive * h.tx - vx) * fx + (drive * h.tz - vz) * fz;
  // out the side: toward the middle of the road unless well over on the wall's side of it
  const inward = -Math.sign(h.at) || 1;
  const side = at.across * inward > -h.r * 0.5 ? inward : -inward;
  const over = side * (h.r + R + 0.05) - at.across;
  k.x += -h.tz * over;
  k.z += h.tx * over;
  if (into <= 0) return;
  const own = -(vx * fx + vz * fz);
  if (own > 0) k.v *= 1 - Math.min(0.9, (0.6 * own) / (Math.hypot(vx, vz) || 1));
  // (thrown clear mostly sideways, out of its lane, and back the way it was going)
  const ox = -h.tz * side * 0.8 + fx * 0.6;
  const oz = h.tx * side * 0.8 + fz * 0.6;
  crash(r, k, h, into, ox, oz);
}

/**
 * A kart touching the Marguerite crossing the road (its middle at st.d): put out along the road, the side of it the kart
 * is on (never carried across with it), with a crash as hard as it ran into the bus's side, or the bus's nose into it.
 */
function shuttleHit(r: Race, k: Kart, h: LiveHazard, d: number) {
  const R = KART_R * scaleOf(k);
  // (only on its own stretch of road: never another one that passes near its side streets)
  if (Math.abs(deltaS(r.track, h.s, k.s)) > h.r + R + 2) return;
  const c = pointAt(r.track, h.s, d);
  const ox = k.x - c.x;
  const oz = k.z - c.z;
  const along = ox * c.tx + oz * c.tz;
  const across = -ox * c.tz + oz * c.tx;
  const inL = h.r + R - Math.abs(along);
  const inW = lengthOf(h) / 2 + R - Math.abs(across);
  if (inL <= 0 || inW <= 0) return;
  const sg = Math.sign(along) || -1;
  k.x += c.tx * sg * inL;
  k.z += c.tz * sg * inL;
  const vx = Math.sin(k.h) * k.v + k.kx;
  const vz = Math.cos(k.h) * k.v + k.kz;
  const own = -(vx * c.tx + vz * c.tz) * sg;
  // (and at its nose or tail, how fast it came across into the kart)
  const v = h.speed ?? 0;
  const nose = inW < inL ? (v - (-vx * c.tz + vz * c.tx)) * Math.sign(across) : 0;
  const into = Math.max(own, nose);
  if (into <= 0) return;
  if (own > 0) k.v *= 1 - Math.min(0.9, (0.6 * own) / (Math.hypot(vx, vz) || 1));
  crash(r, k, h, into, c.tx * sg, c.tz * sg);
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
  const C = CLASSES[r.cc];
  for (const h of r.hazards) {
    if (h.kind === 'panel') {
      // never where a pane will open under the kart as it gets going, foot down from a standstill: nor on its way over
      const ds = deltaS(t, s, h.s);
      const len = h.len ?? 0;
      if (ds < -len - KART_R || ds > 0.5 * C.accel * (SET_T + 1) ** 2 + 2) continue;
      if (Math.abs(d - h.d) > (h.w ?? h.r) + 0.3) continue;
      for (let u = 0; u <= SET_T + 1; u += 0.05) {
        // (with its foot down, or off on a drop start's boost)
        const lo = Math.min(0.5 * C.accel * u * u, C.top * u) - ds;
        const hi = Math.min(0.5 * 34 * u * u, (C.top + BOOST_DV) * u) - ds;
        if (hi > -KART_R - 0.5 && lo < len + KART_R + 0.5 && hazState(r, h, at + u, k.lap).live) return false;
      }
      continue;
    }
    if (h.kind === 'whirl') {
      // never in a whirlpool's pull, nor up to 25 m short of one that spins (or is about to) while it gets going: the
      // launch sets it down further back
      const ds = deltaS(t, s, h.s);
      const pull = h.pull ?? 7;
      if (ds < -(pull + 2) || ds > 25 + pull) continue;
      for (let u = 0; u <= SET_T + 1; u += 0.1) {
        const st = hazState(r, h, at + u, k.lap);
        if (st.live || st.warn > 0) return false;
      }
      continue;
    }
    if (h.kind === 'shuttle' || h.kind === 'mower') {
      // never on the crossing or just short of it while the bells ring or the mower beeps, or the bus or the mower is
      // across, whichever lane
      const ds = deltaS(t, s, h.s);
      if (ds < -(h.r + KART_R + 1) || ds > 14) continue;
      for (let u = 0; u <= SET_T + 1; u += 0.1) {
        const st = hazState(r, h, at + u, k.lap);
        if (st.live || st.warn > 0) return false;
      }
      continue;
    }
    if (timed(h.kind)) {
      // nothing a set piece will block in that lane while the kart gets going, nor where it has got to by then with its
      // foot down from a standstill (they run on the clock, so this is known): a spot just short of one is as bad as one
      // on it
      const ds = deltaS(t, s, h.s);
      const ext = h.kind === 'rotor' ? (h.arm ?? 5) : h.kind === 'bollard' ? BANK.thick : h.r;
      if (ds < -(ext + 2) || ds > 0.5 * C.accel * (SET_T + 1) ** 2 + ext + 2) continue;
      // (never astride the join between two banks of a row: square in one bank's lane, see think())
      const seam = h.kind === 'bollard' ? h.d + (h.w ?? 0) / 2 : NaN;
      if (Math.abs(seam) < t.edge - 0.5 && Math.abs(d - seam) < KART_R + 0.3) return false;
      for (let u = 0; u <= SET_T + 1; u += 0.1) {
        const go = Math.min(0.5 * C.accel * u * u, C.top * u);
        // (where it is by then, with a little to spare; and where it sits, with more, in case it is slow to go)
        for (const [o, pad] of Math.abs(ds) <= ext + KART_R + 1 ? [[go - ds, 0.3], [-ds, 1]] : [[go - ds, 0.3]]) {
          if (Math.abs(o) > ext + KART_R + 0.5) continue;
          for (const [lo, hi] of hazSpans(r, h, at + u, k.lap, clamp(o, -ext, ext))) if (d > lo - KART_R - pad && d < hi + KART_R + pad) return false;
        }
      }
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
    if (traffic(h.kind) && h.span) {
      // a car or a van: nowhere it will be (give or take) while the kart gets going, oncoming as it may be
      for (let u = 0; u <= SET_T + 1; u += 0.25) {
        if (spanGone(h, at + u)) continue;
        if (Math.abs(deltaS(t, hazardS(t, h, at + u), s)) < lengthOf(h) / 2 + KART_R + 3 && Math.abs(trafficD(h, at + u) - d) < room + 0.5) return false;
      }
      continue;
    }
    if (drives(h)) {
      // (a vessel off its stretch then is not there)
      if (h.span && spanGone(h, at)) continue;
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
  // (where the set pieces are, a lane further over, as one sweeping or rippling across the road can leave only those)
  const pieces = r.hazards.some((h) => timed(h.kind));
  // (on the water, with whirlpools all down a stretch, the launch may have to tow you further back to find a quiet spot)
  for (let back = 0; back <= (r.boat ? 64 : 40); back += 4) {
    const s = wrapS(t, s0 - back);
    const [lo, hi] = setDown(r, s);
    const d = clamp(d0, lo, hi);
    for (const lane of pieces ? [d, 0, clamp(-d, lo, hi), lo, hi, (lo + d) / 2, (hi + d) / 2] : [d, 0, clamp(-d, lo, hi)]) if (clearFor(r, k, s, lane, at)) return [s, lane];
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
  // (on the Skyway's glass the drone stays with a CPU a while longer, until it is under way: a CPU set down at a standstill
  // in front of the Blink or on the Wire is a sitting duck for the pack coming through, and a hit there is as good as
  // another fall; the launch likewise on the narrow slough; you get the usual moment, as you can see it coming)
  k.safe = Math.max(k.safe, cpuHelp(r) && k.kind === 'cpu' ? DRONE_GRACE : 1.2);
  // (on the water the launch holds the shell a little longer, until it is under way)
  k.calm = r.boat ? CALM_T + 1 : CALM_T;
}
/** How long a CPU the drone has just set down on the glass is safe from a hit (see rescue). */
const DRONE_GRACE = 3.5;
/** How long the drone holds a kart it has just set down steady against the wind (see Kart.calm). */
export const CALM_T = 1.5;

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
/** Kart S can bump its thunder cloud onto V (the client that drives S decides). */
const canPass = (S: Kart, V: Kart) => S.cloud > 0 && S.cloudHold <= 0 && local(S) && V.cloud <= 0 && V.done === null && V.sunk === 0;

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
      // and one under a Boo drives straight through the others
      if (A.boo > 0 || B.boo > 0) continue;
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
      // a thunder cloud jumps to whoever its kart touches, once it has been overhead a moment
      if (canPass(A, B)) passCloud(r, A, B);
      else if (canPass(B, A)) passCloud(r, B, A);
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
        // (on glass a shove carries a long way, so a kart reeling from a hit, which can do nothing about it, is only
        // nudged out of the way, not knocked over the brink; on the water likewise, but a CPU only)
        const ja = hurt(A) && (glass(r) || (r.boat && A.kind === 'cpu')) ? REELING : 1;
        const jb = hurt(B) && (glass(r) || (r.boat && B.kind === 'cpu')) ? REELING : 1;
        A.kx -= nx * j * shareA * 1.6 * ja;
        A.kz -= nz * j * shareA * 1.6 * ja;
        B.kx += nx * j * shareB * 1.6 * jb;
        B.kz += nz * j * shareB * 1.6 * jb;
        if (rel > 3) {
          if (local(A)) r.events.push({ t: 'bump', k: A.idx, power: rel });
          if (local(B)) r.events.push({ t: 'bump', k: B.idx, power: rel });
        }
      }
    }
  }
}

/** How much of a shove a kart reeling from a hit takes on the glass (and a CPU on the water: see bumpKarts). */
const REELING = 0.25;

/**
 * Hits a kart this client simulates. Stars shrug everything off, and under a Boo whatever other karts throw or do; a kart
 * already reeling is not hit twice, and one that has fallen off the road is out of it until it is set back down.
 */
export function hitKart(r: Race, k: Kart, how: HitHow, by: number) {
  if (!local(k) || k.sunk > 0 || k.star > 0 || k.bullet > 0 || k.done !== null) return false;
  if (k.boo > 0 && by >= 0) return false;
  // a mega kart only notices explosions, and they shrink it back down
  if (k.mega > 0 && how !== 'boom') return false;
  if (how !== 'boom' && (hurt(k) || k.safe > 0)) return false;
  k.mega = 0;
  k.drift = 0;
  k.charge = 0;
  k.boost = 0;
  k.turbo = 0;
  k.wobble = 0;
  if (k.trail) {
    // a banana or shell held out behind is lost in the crash
    k.trail = false;
    k.item = null;
    k.uses = 0;
  }
  // on the harder courses a hit keeps you down for longer
  const harsh = r.tier.harsh;
  const down = (how === 'spin' ? 1.05 : how === 'squash' ? 0.8 : how === 'boom' ? 1.8 : how === 'freeze' ? FREEZE_T : 1.3) * harsh;
  if (how === 'freeze') {
    // iced over: it keeps most of its speed and slides on, steering nowhere
    k.frozen = down;
    k.v *= 0.85;
    k.coins = Math.max(0, k.coins - 1);
  } else if (how === 'spin' || how === 'squash') {
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

/**
 * Item odds by how far back you are: leaders get defense, the back of the pack gets the big guns. (The batch with the
 * boomerang in it takes its share further back from the shells and ink, so the back keeps its boosts.)
 */
export const ODDS: [number, Partial<Record<Item, number>>][] = [
  [0.15, { banana: 28, bananas: 8, green: 28, greens: 6, red: 10, mushroom: 6, coin: 10, horn: 4, feather: 5, boomerang: 3, cloud: 3 }],
  [0.45, { banana: 10, bananas: 8, green: 14, greens: 10, red: 22, bomb: 8, mushroom: 14, triple: 6, coin: 4, ink: 4, boomerang: 6, ice: 4, fire: 3, feather: 3, cloud: 2, boo: 2 }],
  [0.75, { greens: 4, red: 16, bomb: 7, mushroom: 12, triple: 16, golden: 6, star: 8, mega: 5, ink: 6, bolt: 3, blue: 5, horn: 3, piranha: 5, fire: 4, ice: 3, boo: 3, boomerang: 2, pow: 2 }],
  [1.01, { red: 7, triple: 16, golden: 12, star: 16, mega: 10, bullet: 14, bolt: 9, blue: 8, ink: 2, piranha: 6, boo: 3, fire: 2, pow: 2 }],
];

export function rollItem(r: Race, k: Kart): Item {
  const frac = r.karts.length > 1 ? (k.place - 1) / (r.karts.length - 1) : 0;
  const table = { ...ODDS.find(([upTo]) => frac < upTo)![1] };
  // only one blue shell, POW block and thunder cloud out at a time, and no lightning or POW block straight after another
  if (r.things.some((t) => t.kind === 'blue')) delete table.blue;
  if (r.time - r.boltAt < BIG_GAP) {
    delete table.bolt;
    delete table.pow;
  }
  if (r.pows.length) delete table.pow;
  if (r.karts.some((o) => o.cloud > 0 || o.item === 'cloud')) delete table.cloud;
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
/** How long each kind of thing lasts once it is out (bananas sit there until someone runs into them). */
const LIFE: Record<ThingKind, number> = { banana: Infinity, green: 7, red: 10, blue: 25, bomb: BOMB_LIFE, boomerang: BOOMERANG_LIFE, fire: FIRE_LIFE, ice: ICE_LIFE };

export function spawn(r: Race, thing: Omit<Thing, 'id' | 'i' | 'life' | 'bounces' | 'local'> & { id?: number; life?: number }, isLocal = true): Thing {
  const t: Thing = {
    i: locate(r.track, thing.x, thing.z).i,
    bounces: 0,
    local: isLocal,
    ...thing,
    id: thing.id ?? r.nextId++,
    life: thing.life ?? LIFE[thing.kind],
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
  } else if (item === 'fire') {
    // a fireball per press until the flower wilts (not too many at once), each a hair off the last so they fan out
    if (r.things.some((th) => th.kind === 'fire' && th.owner === k.idx && th.life > FIRE_LIFE - FIRE_GAP)) return null;
    if (k.fireT === 0) k.fireT = FIRE_T;
    const dir = back ? -1 : 1;
    const h = k.h + ((r.nextId % 3) - 1) * 0.06;
    const speed = FIRE_V + (back ? 0 : Math.max(0, k.v) * 0.5);
    spawn(r, { ...base, kind: 'fire', x: k.x + fx * 2.4 * dir, z: k.z + fz * 2.4 * dir, y: 0.6, vx: Math.sin(h) * speed * dir, vz: Math.cos(h) * speed * dir, vy: 3 });
    r.events.push({ t: 'use', k: k.idx, item });
    return item;
  } else if (item === 'ice') {
    const dir = back ? -1 : 1;
    const speed = ICE_V + (back ? 0 : Math.max(0, k.v) * 0.5);
    spawn(r, { ...base, kind: 'ice', x: k.x + fx * 2.4 * dir, z: k.z + fz * 2.4 * dir, y: 0.6, vx: fx * speed * dir, vz: fz * speed * dir, vy: 2 });
  } else if (item === 'boomerang') {
    // one at a time: the next throw waits until this one has come back past you
    if (r.things.some((th) => th.kind === 'boomerang' && th.owner === k.idx && deltaS(r.track, k.s, locate(r.track, th.x, th.z, th.i).s) > 0)) return null;
    const speed = Math.max(0, k.v) + BOOMERANG_V;
    spawn(r, { ...base, kind: 'boomerang', x: k.x + fx * 2.4, z: k.z + fz * 2.4, y: 0.9, vx: fx * speed, vz: fz * speed });
  } else if (item === 'piranha') {
    k.piranha = PIRANHA_T;
    k.bite = PIRANHA_GAP / 2;
  } else if (item === 'boo') {
    // see-through for a while, and it makes off with the item of someone ahead
    k.item = null;
    k.uses = 0;
    k.trail = false;
    k.boo = BOO_T;
    r.events.push({ t: 'use', k: k.idx, item });
    steal(r, k);
    return item;
  } else if (item === 'feather') {
    // a big jump, from the ground; trick in the air like off a ramp
    if (k.y > 0.05 || k.vy > 0) return null;
    k.vy = FEATHER_V;
    k.y = 0.01;
    k.air = true;
    k.trickT = 0.6;
    k.trick = false;
    k.hopDir = 0;
    k.drift = 0;
    k.charge = 0;
    k.turbo = 0;
  } else if (item === 'cloud') {
    k.cloud = CLOUD_T;
    k.cloudHold = 0;
  } else if (item === 'pow') {
    r.boltAt = r.time;
    r.pows.push({ by: k.idx, at: r.time, n: 0 });
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
  if (item === 'pow') r.events.push({ t: 'pow', k: k.idx, at: r.time });
  return item;
}

/** Ink over every kart ahead of the user that this client drives (stars, bullets and Boos stay clean). */
export function inkFrom(r: Race, from: number) {
  const user = r.karts[from];
  if (!user) return;
  for (const o of r.karts) {
    if (o.idx === from || !local(o) || o.done !== null || o.star > 0 || o.bullet > 0 || o.boo > 0 || o.place >= user.place) continue;
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

/** Lightning: everyone but the user (and anyone under a star or a Boo) spins, shrinks and drops their item. */
export function strike(r: Race, from: number) {
  for (const o of r.karts) {
    if (o.idx === from || !local(o) || o.sunk > 0 || o.star > 0 || o.bullet > 0 || o.boo > 0 || o.done !== null) continue;
    shock(r, o, from, SHRINK_T * (o.place <= 3 ? 1.2 : 0.8));
  }
}

/** A bolt of lightning on one kart: it shrinks for `time`, spins and drops its item. */
function shock(r: Race, o: Kart, by: number, time: number) {
  o.mega = 0;
  o.goldT = 0;
  o.fireT = 0;
  o.shrink = time;
  o.spin = Math.max(o.spin, 0.6 * r.tier.harsh);
  o.v *= 0.5;
  o.drift = 0;
  o.charge = 0;
  o.item = null;
  o.uses = 0;
  o.roll = 0;
  r.events.push({ t: 'hit', k: o.idx, how: 'spin', by });
}

/**
 * A Boo makes off with the item of the nearest kart ahead holding one (out in front, the nearest behind), unless it is
 * already being used. When that kart is someone else's online, its own client lets go of it on hearing of the 'boo'
 * (see robbed); the thief has it straight away either way.
 */
function steal(r: Race, k: Kart) {
  const gap = (o: Kart) => (o.place < k.place ? k.place - o.place : 100 + o.place - k.place);
  let mark: Kart | null = null;
  for (const o of r.karts) {
    if (o === k || o.done !== null || !o.item || o.roll > 0 || o.goldT > 0 || o.fireT > 0 || o.boo > 0 || o.sunk > 0) continue;
    if (!mark || gap(o) < gap(mark)) mark = o;
  }
  if (!mark?.item) return;
  const item = mark.item;
  const uses = local(mark) ? mark.uses : (USES[item] ?? 1);
  r.events.push({ t: 'boo', k: mark.idx, by: k.idx, item });
  if (local(mark)) robbed(r, mark);
  giveItem(r, k, item, ROLL_T / 2);
  k.uses = uses;
}

/** A Boo took kart k's item. */
export function robbed(r: Race, k: Kart) {
  k.item = null;
  k.uses = 0;
  k.roll = 0;
  k.trail = false;
  k.goldT = 0;
  k.fireT = 0;
}

/** A thunder cloud nobody took goes off over its own kart (unless it has a star, a bullet or a Boo, or is out of it). */
function zap(r: Race, k: Kart) {
  r.events.push({ t: 'zap', k: k.idx });
  if (k.star > 0 || k.bullet > 0 || k.boo > 0 || k.sunk > 0 || k.done !== null) return;
  shock(r, k, -1, ZAP_SHRINK);
}

/**
 * A thunder cloud jumps from kart S to kart V when they touch, decided by the client that drives S. When V is someone
 * else's kart online, its own client takes it on through catchCloud() (net 'cloud').
 */
function passCloud(r: Race, S: Kart, V: Kart) {
  const left = S.cloud;
  S.cloud = 0;
  S.cloudHold = 0;
  if (local(V)) catchCloud(r, V, left, S.idx);
  else {
    V.cloud = left;
    V.cloudHold = CLOUD_HOLD;
    r.events.push({ t: 'cloud', k: V.idx, by: S.idx, left });
  }
}

/** Kart k takes on a thunder cloud with `left` seconds to go (always long enough to try passing it on). */
export function catchCloud(r: Race, k: Kart, left: number, by: number) {
  if (k.done !== null) return;
  k.cloud = clamp(left, CLOUD_HOLD + 1.5, CLOUD_T);
  k.cloudHold = CLOUD_HOLD;
  r.events.push({ t: 'cloud', k: k.idx, by, left: k.cloud });
}

/** What a piranha plant on kart k can reach: the nearest kart or item just ahead of it, if any. */
function preyOf(r: Race, k: Kart): { kart: Kart | null; thing: Thing | null; x: number; z: number } | null {
  const { fx, fz } = fwdOf(k);
  const { rx, rz } = rightOf(k);
  let best: { kart: Kart | null; thing: Thing | null; x: number; z: number } | null = null;
  let near = PIRANHA_R;
  const reach = (x: number, z: number, y: number) => {
    const dx = x - k.x;
    const dz = z - k.z;
    const along = dx * fx + dz * fz;
    if (along < 0.5 || along > near || Math.abs(dx * rx + dz * rz) > 2.4 || Math.abs(y - k.y) > 1.6) return false;
    near = along;
    return true;
  };
  for (const o of r.karts) if (o !== k && o.done === null && o.boo <= 0 && o.sunk === 0 && reach(o.x, o.z, o.y)) best = { kart: o, thing: null, x: o.x, z: o.z };
  for (const th of r.things) {
    if (th.kind === 'blue' || th.kind === 'boomerang' || (th.owner === k.idx && (th.grace > 0 || ownSafe(th.kind)))) continue;
    if (reach(th.x, th.z, th.y)) best = { kart: null, thing: th, x: th.x, z: th.z };
  }
  return best;
}

/**
 * A piranha plant riding on kart k lunges at whatever comes just ahead: it eats items and spins karts out, and every
 * lunge gives k a little boost. With nothing in reach it still snaps at the air now and then. Every client runs it for
 * every plant; each one only spins the karts it drives and eats items only for its own karts' plants (the item's 'gone'
 * goes online).
 */
function chomp(r: Race, k: Kart, dt: number) {
  k.bite -= dt;
  if (k.bite > 0 || hurt(k) || k.done !== null) return;
  const prey = preyOf(r, k);
  if (!prey && k.bite > -PIRANHA_GAP) return;
  k.bite = PIRANHA_GAP;
  const { fx, fz } = fwdOf(k);
  r.events.push({ t: 'chomp', k: k.idx, x: prey ? prey.x : k.x + fx * 3, z: prey ? prey.z : k.z + fz * 3 });
  if (local(k)) k.boost = Math.max(k.boost, PIRANHA_BOOST);
  if (prey?.kart && local(prey.kart)) hitKart(r, prey.kart, 'spin', k.idx);
  if (prey?.thing && local(k)) removeThing(r, prey.thing.id, true);
}

/** Someone's POW block, used at race time `at` (online it arrives a moment late, so it never starts in the past). */
export function powFrom(r: Race, by: number, at: number) {
  if (!r.karts[by] || r.pows.some((p) => p.by === by)) return;
  r.boltAt = r.time;
  r.pows.push({ by, at: clamp(at, r.time - POW_GAP, r.time), n: 0 });
}

/** POW blocks thump three times as a warning, then go off. */
function movePows(r: Race) {
  for (const p of [...r.pows]) {
    const age = r.time - p.at;
    while (p.n < 3 && age >= (p.n + 1) * POW_GAP) {
      p.n++;
      r.events.push({ t: 'thump', by: p.by, n: p.n });
    }
    if (age < POW_T) continue;
    r.pows.splice(r.pows.indexOf(p), 1);
    quake(r, p.by);
  }
}

/**
 * A POW block goes off: every kart ahead of its user on the ground (and that this client drives) spins and drops its
 * item. One in the air just then, off a hop say, rides it out.
 */
function quake(r: Race, by: number) {
  const user = r.karts[by];
  r.events.push({ t: 'quake', by });
  if (!user) return;
  for (const o of r.karts) {
    if (o.idx === by || !local(o) || o.place >= user.place || o.y > 0.05) continue;
    if (!hitKart(r, o, 'spin', by)) continue;
    o.item = null;
    o.uses = 0;
    o.roll = 0;
    o.goldT = 0;
    o.fireT = 0;
  }
}

export function removeThing(r: Race, id: number, announce = true) {
  const i = r.things.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = r.things.splice(i, 1);
  r.events.push({ t: 'gone', id, x: t.x, z: t.z, local: announce });
}

/** A blue shell explodes: everyone this client drives within reach is blown up, unless high enough in the air. */
export function boom(r: Race, x: number, z: number, by: number) {
  for (const k of r.karts) if (Math.hypot(k.x - x, k.z - z) < BOOM_R && k.y < BLAST_CLEAR) hitKart(r, k, 'boom', by);
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
      if (th.y === 0 && (r.holes.some((h) => inTrench(t, h, at.s, at.d)) || overPanel(r, th, at))) {
        sink(r, th, r.holePast);
        continue;
      }
      // (and a whirlpool sucks it under)
      if (th.y === 0 && r.whirls.length && inCore(r, th.x, th.z, r.karts[th.owner]?.lap ?? 1)) {
        sink(r, th, 'water');
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
    if (th.kind === 'boomerang') {
      // it flies along the road, slowing all the while, until it turns round and comes back down it; up in the air it
      // sails over trenches and the water, and never leaves the road
      const at = locate(t, th.x, th.z, th.i);
      th.i = at.i;
      const along = th.vx * at.tx + th.vz * at.tz - BOOMERANG_PULL * dt;
      th.vx = at.tx * along;
      th.vz = at.tz * along;
      th.x += th.vx * dt;
      th.z += th.vz * dt;
      const now = locate(t, th.x, th.z, th.i);
      const lim = edgeAt(t, now.s, now.d >= 0 ? 1 : -1).lim - 0.8;
      if (Math.abs(now.d) > lim) {
        const sg = Math.sign(now.d);
        th.x -= -now.tz * sg * (Math.abs(now.d) - lim);
        th.z -= now.tx * sg * (Math.abs(now.d) - lim);
      }
      continue;
    }
    if (th.kind === 'fire' || th.kind === 'ice') {
      // fireballs bounce along the road, ice balls skip low over it
      th.vy -= GRAVITY * dt;
      th.y += th.vy * dt;
      if (th.y <= 0.3) {
        th.y = 0.3;
        th.vy = th.kind === 'fire' ? 6.5 : 3.5;
      }
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
    if ((edge.past !== 'wall' && Math.abs(at.d) > edge.lim) || r.holes.some((h) => inTrench(t, h, at.s, at.d)) || overPanel(r, th, at)) {
      sink(r, th, edge.past === 'wall' ? r.holePast : edge.past);
      continue;
    }
    if (r.whirls.length && inCore(r, th.x, th.z, lap)) {
      sink(r, th, 'water');
      continue;
    }
    if (edge.past === 'wall' && Math.abs(at.d) > edge.lim - 0.5) {
      if (th.kind === 'red' || th.bounces >= 5) {
        removeThing(r, th.id, th.local);
        continue;
      }
      // green shells, fireballs and ice balls bounce off the walls
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

/** Whether an item at `at` is over a pane of the glass road that has blinked out (on its thrower's lap). */
const overPanel = (r: Race, th: Thing, at: Spot) => r.panels.length > 0 && r.panels.some((h) => inTrench(r.track, h, at.s, at.d) && hazState(r, h, r.time, r.karts[th.owner]?.lap ?? 1).live);

/** A banana, a bomb or a shell over the edge where the road drops away: it sinks out of sight (a splash or a puff). */
function sink(r: Race, th: Thing, kind: Past) {
  removeThing(r, th.id, th.local);
  r.events.push({ t: 'sank', x: th.x, z: th.z, kind });
}

/** How a kart that runs into each kind of thing is hit. */
const HIT_BY: Record<ThingKind, HitHow> = { banana: 'spin', green: 'tumble', red: 'tumble', blue: 'boom', bomb: 'boom', boomerang: 'spin', fire: 'spin', ice: 'freeze' };

function hitThings(r: Race) {
  // shells break on bananas and other shells, and a boomerang knocks them aside and flies on
  for (let a = 0; a < r.things.length; a++) {
    for (let b = a + 1; b < r.things.length; b++) {
      const A = r.things[a];
      const B = r.things[b];
      if (A.kind === 'blue' || B.kind === 'blue' || A.kind === 'bomb' || B.kind === 'bomb' || (A.kind === 'banana' && B.kind === 'banana')) continue;
      // (a stream of fireballs never trips over itself)
      if ((A.owner === B.owner && ownSafe(A.kind) && ownSafe(B.kind)) || (A.kind === 'boomerang' && B.kind === 'boomerang')) continue;
      if (A.y > 1.2 || B.y > 1.2) continue;
      if (Math.hypot(A.x - B.x, A.z - B.z) < 1.3) {
        if (A.kind !== 'boomerang') removeThing(r, A.id, true);
        if (B.kind !== 'boomerang') removeThing(r, B.id, true);
        return hitThings(r);
      }
    }
  }
  for (const k of r.karts) {
    // (everything passes through a kart under a Boo, and well under one up in the air)
    if (!local(k) || k.done !== null || k.sunk > 0 || k.boo > 0) continue;
    const reach = KART_R * scaleOf(k) + 0.6;
    for (const th of [...r.things]) {
      if (th.kind === 'blue' || th.kind === 'bomb' || th.y > 1.2 + k.y || k.y > th.y + 1.2) continue;
      if (th.owner === k.idx && (th.grace > 0 || ownSafe(th.kind))) continue;
      if (Math.hypot(th.x - k.x, th.z - k.z) > reach) continue;
      // (a boomerang flies on through whoever it hits)
      const flies = th.kind === 'boomerang';
      if (!flies) removeThing(r, th.id, true);
      // a banana or shell held out behind soaks one hit from behind
      if (k.trail && (th.x - k.x) * Math.sin(k.h) + (th.z - k.z) * Math.cos(k.h) < -0.3) {
        if (flies) removeThing(r, th.id, true);
        k.trail = false;
        k.uses--;
        if (k.uses <= 0) {
          k.item = null;
          k.uses = 0;
        }
        r.events.push({ t: 'block', k: k.idx, x: th.x, z: th.z });
        continue;
      }
      hitKart(r, k, HIT_BY[th.kind], th.owner);
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
        if (d.kick) {
          // a kicker: and a shove across the road toward its own side
          k.kx += -r.track.tz[k.i] * d.kick;
          k.kz += r.track.tx[k.i] * d.kick;
          r.events.push({ t: 'dash', k: k.idx, kick: d.kick });
        } else r.events.push({ t: 'dash', k: k.idx });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CPU drivers (and the autopilot that brings you home after the flag)

const AUTO: Ai = { pace: 1, skill: 0.6, band: 1, lane: 0, laneTo: 0, laneT: 0, itemT: 1, held: 0, driftT: 0, care: 0, dropGo: false, reactS: -1e9, react: true, err: 0, errLap: 0, blunders: {}, waitT: 0, backT: 0, backs: 0, backAt: -99, heldT: 0, goT: 0, goD: 0, shaken: 0, fellAt: -99, catchBeat: -1e9, catchAt: NaN, hopKey: '', hopGo: false, blink: 0, blinkT: 0, whirlHold: 0 };

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
type Dodge = { lane: number; ds: number; clear: boolean; wet?: boolean; wait?: boolean; hold?: number };
/** A stretch across the road something covers, how far from it the kart keeps, and how far on it is. */
type Span = { lo: number; hi: number; room: number; far: number };
function dodgeHazard(r: Race, k: Kart, lane: number, band: Band = FREE): Dodge | null {
  const t = r.track;
  const ai = k.ai!;
  const v = Math.max(8, Math.abs(k.v));
  const reach = 3 + v * 1.2;
  // what is coming up, as the stretch across the road it covers while the kart goes by
  const ahead: { lo: number; hi: number; room: number; solid: boolean; close?: boolean; soft?: boolean; wet?: boolean; hard?: number }[] = [];
  // and the set pieces, as what they block when the kart gets there, and when it gets there having eased off
  const pieces: Span[] = [];
  const later: Span[] = [];
  let piece = false;
  const gap = (at: number, a: { lo: number; hi: number }) => Math.max(0, a.lo - at, at - a.hi);
  let near = Infinity;
  // the set pieces coming up, planned for below: one lane past all of them within 30 m if there is one, else past the
  // nearest and whatever is right behind it, weaving for the rest once it is through
  const coming: { h: LiveHazard; far: number; when: (speed: number) => number; at: (speed: number, dist: number) => number; until: number }[] = [];
  for (const h of r.hazards) {
    // (the edges, ponds and trenches included, are edgeBand's; a wet patch is driven through)
    if (h.kind === 'water' || h.kind === 'trench' || h.kind === 'wet') continue;
    // (a vessel off its stretch is not there)
    if (h.gone) continue;
    // (a sprinkler's hub stands there before its jet comes on)
    if (!awake(h, k.lap) && h.kind !== 'rotor') continue;
    // (through the Blink the panes are blinkPlan's: see think)
    if (h.kind === 'panel' && ai.blink !== 0) continue;
    // a bus or a cart is in the way from its tail to its nose, so still while the kart is alongside it
    const long = drives(h) ? lengthOf(h) / 2 + KART_R : 0;
    const ds = deltaS(t, k.s, h.along);
    // (and a pane of glass all the way along it)
    if (ds + long + (h.kind === 'panel' ? (h.len ?? 0) : 0) < -1) continue;
    const until = Math.max(0, ds - long);
    // how long the kart takes to get there at a speed: a bus drives on ahead, so the kart only closes on it as fast as
    // it outruns it
    const when = (speed: number) => until / Math.max(2, speed - (h.drive ?? 0));
    // and so how far the kart goes before it gets there (for anything standing still, just how far ahead it is)
    const far = until * (v / Math.max(2, v - (h.drive ?? 0)));
    // (oncoming traffic is seen further off once on its stretch: headlights are, and it closes fast)
    const oncoming = traffic(h.kind) && (h.drive ?? 0) < 0 && !!h.span && deltaS(t, h.span[0], k.s) > 0;
    if (far > (oncoming ? Math.max(reach, v * 2.2) : reach)) continue;
    if (timed(h.kind)) {
      const v0 = Math.max(0, k.v);
      // (on a slick course it counts on a boost too: off a drop start, say, it gets there a good deal sooner)
      const acc = r.slick && k.boost > 0 ? 34 : CLASSES[r.cc].accel;
      // (how long to go `dist` from here getting up to `speed`)
      const reachAt = (speed: number, dist = until) => {
        if (dist <= 0) return 0;
        if (v0 >= speed - 0.5) return dist / Math.max(2, speed);
        const tr = (speed - v0) / acc;
        const dr = ((v0 + speed) / 2) * tr;
        return dist <= dr ? (-v0 + Math.sqrt(v0 * v0 + 2 * acc * dist)) / acc : tr + (dist - dr) / speed;
      };
      coming.push({ h, far, when: reachAt, at: reachAt, until });
      // (a sprinkler's hub is solid and always there, so it outweighs any number of the jet's sweeps; and like a planter
      // it is not cut across in front of close up: the kart keeps to the side of it it is on, or it dithers there as the
      // jet swings from one side to the other)
      if (h.kind === 'rotor') {
        const hub = { lo: h.d, hi: h.d, room: h.r + KART_R + 0.4, solid: true, close: far < 6 + v * 0.5, hard: 20 };
        ahead.push(hub);
        // (and it is in the way even of a kart that has not seen the jet coming)
        if (gap(lane * t.half, hub) < hub.room || (far < reach * 0.6 && gap(k.d, hub) < hub.room)) near = Math.min(near, far);
      }
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
      const d = h.bay !== undefined ? trafficD(h, r.time + time) : hazardD(h, r.time + time);
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
      ai.err = (r.rand() * 2 - 1) * 0.35 * (1 - ai.skill);
    }
    // (a kart at a crawl, put back behind a bank or thrown by the ball, gets up to speed from where it is, and is a long
    // while on its way over a piece: judged over the whole of that, nose to tail)
    const crawl = Math.abs(k.v) < 8;
    const fast = crawl ? topOf(r, k) : v;
    for (const { h, far, when, at, until } of coming) {
      if (far > first + 30) continue;
      const key = `${Math.round(h.s)}:${k.lap}`;
      if (!(key in ai.blunders)) ai.blunders[key] = r.rand() < 0.15 * (1 - ai.skill);
      if (ai.blunders[key]) continue;
      piece = true;
      const slop = 0.1 + 0.25 * (1 - ai.skill);
      // (a jet is thin and its tip sweeps fast: sampled closer in time, and given more room; over a pane of glass the
      // kart keeps to the middle of the half that holds, as a bump or a slide off the seam drops it through; and a
      // flare is only as wide as its column)
      // (and a whirlpool with a wide berth, wider still for a while after a fall, and the slower it is going the wider:
      // its pull draws a slow shell in from well outside where it would catch a fast one)
      // (the Marguerite or the mower crossing, and the Tree's or a goose's lunge, with room to spare: they move fast across
      // the road)
      const room = KART_R + (h.kind === 'rotor' ? 1.0 : h.kind === 'panel' ? 1.4 : h.kind === 'geyser' ? (h.look === 'fountain' ? 0.8 : 0.3) : h.kind === 'whirl' ? (ai.care > 0 ? 1.9 : 0.9) + 2.2 * clamp((16 - k.v) / 10, 0, 1) : h.kind === 'boulder' ? 0.9 : h.kind === 'shuttle' ? 1.1 : h.kind === 'mower' ? 1.0 : h.kind === 'tether' ? 0.9 : 0.7);
      // (a sprinkler's jet is met along a stretch of road, not on one line: every so far along it; and a pane of glass
      // from its near end to its far end)
      const arm = h.arm ?? 5;
      // (and a boulder or traffic, crossing as the kart goes by, from its near side to its far side and closer in time)
      const offs = h.kind === 'rotor' ? [-0.9 * arm, -0.6 * arm, -0.3 * arm, 0, 0.3 * arm, 0.6 * arm, 0.9 * arm] : h.kind === 'panel' ? [0, (h.len ?? 0) / 2, h.len ?? 0] : h.kind === 'boulder' || h.kind === 'shuttle' || h.kind === 'mower' || h.kind === 'tether' ? [-0.7 * h.r, 0, 0.7 * h.r] : [0];
      const fine = h.kind === 'rotor' || h.kind === 'boulder' || h.kind === 'shuttle' || h.kind === 'mower' || h.kind === 'tether';
      const spansAt = (t0: number, out: Span[]) => {
        for (const o of offs) for (const dt of fine ? [-slop, -slop / 2, 0, slop / 2, slop] : [-slop, 0, slop]) for (const [lo, hi] of hazSpans(r, h, t0 + dt + o / v, k.lap, o)) out.push({ lo, hi, room, far });
      };
      const ext = h.kind === 'bollard' ? BANK.thick : h.kind === 'rotor' ? JET.w : h.kind === 'panel' ? 0 : h.r;
      const crossing = (speed: number, out: Span[]) => {
        for (const o of offs) {
          const t0 = r.time + ai.err + at(speed, until + o - ext - KART_R) - slop;
          const t1 = r.time + ai.err + at(speed, until + o + ext + KART_R) + slop;
          for (let u = t0; u <= t1 + 1e-6; u += 0.1) for (const [lo, hi] of hazSpans(r, h, u, k.lap, o)) out.push({ lo, hi, room, far });
        }
      };
      const n0 = pieces.length;
      // (never slow for the ball or a jet: a slow kart in their sweep is hit for sure, a fast one is through in a blink)
      // (nor for a whirlpool: it is no wall, and a slow shell is the one it draws in)
      const keepOn = h.kind === 'wrecker' || h.kind === 'rotor' || h.kind === 'whirl';
      if (crawl) {
        crossing(fast, pieces);
        crossing(keepOn ? fast : 6, later);
        // and from a crawl, better well wide of where the ball swings at all
        if (h.kind === 'wrecker') pieces.push({ lo: h.d - (h.swing ?? 0) - h.r, hi: h.d + (h.swing ?? 0) + h.r, room: 0.5, far });
      } else if (h.kind === 'panel' || h.kind === 'shuttle' || h.kind === 'mower' || h.look === 'fountain') {
        // (a pane is judged over the whole time the kart is on it, at its speed or eased off; a fountain jet in a hairpin
        // over the whole time it is beside it, braking for the bend as it may be; and the Marguerite and the mower
        // likewise, nose to tail across their path)
        crossing(v, pieces);
        if (h.kind !== 'panel') crossing(Math.max(6, v * 0.7), pieces);
        crossing(Math.max(6, v - 7), later);
      } else {
        spansAt(r.time + when(v) + ai.err, pieces);
        spansAt(keepOn ? r.time + when(v) + ai.err : r.time + when(Math.max(6, v - 7)) + ai.err, later);
      }
      for (let n = n0; n < pieces.length; n++) if (gap(lane * t.half, pieces[n]) < room || (far < reach * 0.6 && gap(k.d, pieces[n]) < room)) near = Math.min(near, far);
      // (and through a row of banks, square in one bank's lane: straddling the join between two it needs both down at
      // once, which at a crawl they never are for long enough)
      if (h.kind === 'bollard' && Math.abs(h.d + (h.w ?? 0) / 2) < t.edge - 0.5) {
        const seam = { lo: h.d + (h.w ?? 0) / 2, hi: h.d + (h.w ?? 0) / 2, room: KART_R + 0.85, far };
        pieces.push(seam);
        later.push(seam);
      }
    }
  }
  // a kart ahead at a crawl or reeling from a hit (stopped by a shell, say): steered round like anything else in the way,
  // as ramming it shoves it off the glass
  if (r.slick) {
    for (const o of r.karts) {
      if (o === k || o.sunk > 0 || o.done !== null || (Math.abs(o.v) > 12 && !hurt(o))) continue;
      const far = deltaS(t, k.s, o.s);
      if (far < 1 || far > reach || k.v - o.v < 4) continue;
      const a = { lo: o.d, hi: o.d, room: 2 * KART_R + 0.5, solid: true, close: far < 6 + v * 0.5 };
      ahead.push(a);
      if (gap(lane * t.half, a) < a.room || (far < reach * 0.6 && gap(k.d, a) < a.room)) near = Math.min(near, far);
    }
  }
  // a kicker coming up: kept off its outer part, the side that throws you toward the edge (the whole of it for the less
  // able, and for a kart that has just fallen twice), as one more thing it would rather not run over
  if (r.slick) {
    for (const p of r.dashes) {
      if (!p.kick) continue;
      const far = deltaS(t, k.s, p.s);
      if (far < -2 || far > reach) continue;
      const sg = Math.sign(p.kick);
      const whole = ai.skill < 0.8 || wary(r, ai);
      const a = whole ? { lo: p.d - 1.6, hi: p.d + 1.6 } : { lo: Math.min(p.d - sg * 0.55, p.d + sg * 1.6), hi: Math.max(p.d - sg * 0.55, p.d + sg * 1.6) };
      const pad = { ...a, room: 0.6, solid: false, soft: true };
      ahead.push(pad);
      if (gap(lane * t.half, pad) < pad.room) near = Math.min(near, Math.max(1, far));
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
  // (on the water's narrow channel, where the wharves and the bridge abutments stand well back, out as far as them)
  const cMax = r.boat ? BOAT_LANES : 0.85;
  const [cLo, cHi] = [Math.max(-cMax, band.lo / t.half), Math.min(cMax, band.hi / t.half)];
  const lanes: number[] = [];
  // (c is summed in floating point, so the last is a hair over 0.85: compare with a little slack or the right-hand
  // lane is lost on every course, walls or not)
  for (let c = -cMax; c <= cMax + 0.001; c += 0.05) if (c >= cLo - 1e-6 && c <= cHi + 1e-6) lanes.push(c);
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
      let into = ahead.reduce((sum, a) => sum + Math.max(0, a.room - gap(at, a)) * (a.soft ? 0.3 : (a.hard ?? 1)) + (a.close && (at - a.lo) * (k.d - a.lo) < 0 ? a.room : 0), 0);
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
  // the Marguerite across the road with no way past it: stop short of the crossing and wait for it to go by (easing off
  // to get there later is no plan for a bus: a kart that only eases arrives as it comes across)
  const xing = coming.find((c) => c.h.kind === 'shuttle' && c.far <= first + 14 && c.until > 3);
  if (xing) return { ...best, clear: false, wait: true, hold: Math.max(0, xing.until - 8) };
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
type Band = { lo: number; hi: number; open: boolean; hole: boolean; wide?: boolean };
const FREE: Band = { lo: -Infinity, hi: Infinity, open: false, hole: false };
/** The Skyway's glass: a slick course on land (the water is slick too, but a shell is another matter). */
const glass = (r: Race) => r.slick && !r.boat;
/** A CPU driving very carefully: shaken by two falls in quick succession, or on the glass just back from one. */
const wary = (r: Race, ai: Ai) => ai.shaken > 0 || (glass(r) && ai.care > 0);
const edgeRoom = (r: Race, k: Kart, ai: Ai) => {
  const room = KART_R + 0.9 + 0.025 * Math.abs(k.v) + 0.8 * (1 - ai.skill) + (ai.care > 0 ? 1.2 : 0) + (r.slick ? 0.25 * Math.hypot(k.kx, k.kz) + (wary(r, ai) ? 2 : 0) : 0);
  // (on the water's narrow channel never so far that it leaves no room to steer round a whirlpool: there the middle of
  // the channel is no safer than its edge)
  return r.boat ? Math.min(room, BOAT_ROOM) : room;
};
/** How far out (a share of half the channel) a CPU's lanes go on the water, where the walls stand back (see dodgeHazard). */
const BOAT_LANES = 1.2;
/** The most a CPU keeps from the brink of the marsh (see edgeRoom). */
const BOAT_ROOM = 3.3;

/**
 * The stretch across the road (lateral offsets lo to hi) a CPU keeps to over the road ahead: clear of the brink wherever
 * it drops away, by `room`, and of the walls. Coming up to a trench it lines up with the ramp over it (or, the best of
 * them, or one going too slowly to make the jump, with a steel plate beside the hole). open: a drop somewhere in it.
 */
function edgeBand(r: Race, k: Kart, room: number, roomLo = room, roomHi = room): Band {
  const t = r.track;
  const v = Math.max(8, Math.abs(k.v));
  let lo = -Infinity;
  let hi = Infinity;
  let open = false;
  // (and the narrowest the road gets over the sky, where it narrows: see below)
  let narrow = Infinity;
  for (let a = 0; a <= 10 + v * 0.7; a += 3) {
    const i = Math.floor(wrapS(t, k.s + a) / t.step) % t.n;
    lo = Math.max(lo, t.lo[i] + (t.pastLo[i] ? roomLo : KART_R + 0.4));
    hi = Math.min(hi, t.hi[i] - (t.pastHi[i] ? roomHi : KART_R + 0.4));
    open ||= t.pastLo[i] !== 0 || t.pastHi[i] !== 0;
    if (t.pastLo[i] === VOID && -t.lo[i] < t.half) narrow = Math.min(narrow, -t.lo[i]);
    if (t.pastHi[i] === VOID && t.hi[i] < t.half) narrow = Math.min(narrow, t.hi[i]);
  }
  // where the road narrows over the sky, however wide of the brink it means to keep, it may go to within a kart and a
  // meter and a half of it: any further in and the narrows leave it no room to get round anything at all
  // (less on the side the wind is blowing toward)
  if (narrow < Infinity && narrow - KART_R - 1.5 > 0) {
    lo = Math.min(lo, -(narrow - KART_R - 1.5 - (roomLo - room)));
    hi = Math.max(hi, narrow - KART_R - 1.5 - (roomHi - room));
  }
  // through the Blink a kart has to be squarely over one half of each row or the other (the halves meet in the middle):
  // so however wide of the brink it means to keep, it may go as far out as the middle of a half
  for (const h of r.panels) {
    const ds = deltaS(t, k.s, h.s);
    if (ds < -(h.len ?? 0) - 1 || ds > 14 + v * 1.2 || !awake(h, k.lap)) continue;
    const mid = Math.abs(h.d) + 0.2;
    lo = Math.min(lo, -mid);
    hi = Math.max(hi, mid);
  }
  let hole = false;
  let wide = false;
  for (const h of r.holes) {
    const ds = deltaS(t, k.s, h.s);
    if (ds < -(h.len ?? 0) || ds > 14 + v * 1.2) continue;
    // (not while a set piece still stands between here and the hole: the way past that comes first, and the ramp after)
    if (r.hazards.some((p) => timed(p.kind) && deltaS(t, k.s, p.s) > -p.r && deltaS(t, k.s, p.s) < ds - 2)) continue;
    hole = true;
    const ramp = r.ramps.find((p) => Math.abs(deltaS(t, p.s, h.s)) < 3);
    // a gap right across the road with a ramp just as wide: anywhere on the road will do, foot down (no plates to fall
    // back on)
    if (ramp && ramp.w >= 2 * t.half - 1) {
      wide = true;
      continue;
    }
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
  return wide ? { lo, hi, open, hole, wide } : { lo, hi, open, hole };
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

/** On the water a CPU dodging with a clean line looks at least this many seconds ahead (see think()). */
const BOAT_LOOK = 0.4;
/** On the water a CPU takes a bend this much slower than it would on a slick road: the shell slides on wide out of a carve. */
const BOAT_CAP = 0.88;
/** And slower again on rough water (grip under BOAT_CHOP): the shell slides out of the bend on it far more than it turns. */
const BOAT_CHOP = 0.65;
const BOAT_CHOP_CAP = 0.85;
/** How much less than a kart's the CPU counts on turning off a drift (a racing shell's long hull: see HULL_TURN). */
const turnK = (r: Race) => (r.boat ? HULL_TURN : 1);
/** An Expert course, or harder. */
const expert = (r: Race) => COURSES[r.course].difficulty >= 4;

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
  ai.shaken = Math.max(0, ai.shaken - dt);
  // (a crab beside the marsh: it straightens up well clear of the brink before getting going again)
  if (r.boat && k.spin > 0 && fromBrink(r, k) < 4) ai.care = Math.max(ai.care, 3);
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
  // keep clear of the brink where the road drops away, and line up for a trench; with the wind about to blow (or
  // blowing) where it is going, lean into it and keep more room on the side it blows toward
  const wind = r.gusts.length ? windAhead(r, k) : 0;
  const room = edgeRoom(r, k, ai);
  // (on the water likewise against the current setting across the channel and the swell about to roll in: see waterAhead)
  const water = r.boat ? waterAhead(r, k) : null;
  let band = water ? edgeBand(r, k, room, room + (wind < 0 ? 0.1 * -wind : 0) + water.lo, room + (wind > 0 ? 0.1 * wind : 0) + water.hi) : wind ? edgeBand(r, k, room, room + (wind < 0 ? 0.1 * -wind : 0), room + (wind > 0 ? 0.1 * wind : 0)) : edgeBand(r, k, room);
  let want = ai.lane + clamp(curve.mean * 40, -0.55, 0.55) * ai.skill;
  if (wind) want -= (Math.sign(wind) * Math.min(1.2, 0.12 * Math.abs(wind))) / t.half;
  if (water) want = (want * t.half - water.lean) / t.half + water.lane(want);
  // with a thunder cloud overhead, go and bump into whoever is just ahead to pass it on (not where a shove carries a long
  // way, nor anyone near the brink of a drop)
  if (k.cloud > 0 && k.cloudHold <= 0 && !r.slick) {
    const mark = r.karts.find((o) => o !== k && o.done === null && o.cloud <= 0 && o.boo <= 0 && o.sunk === 0 && deltaS(t, k.s, o.s) > 0 && deltaS(t, k.s, o.s) < 14 && fromBrink(r, o) > 4);
    if (mark) want = mark.d / t.half;
  }
  // through the Blink, square in the middle of the half of the rows it has picked (or holds short of them on), all the
  // way (see blinkPlan)
  const blinkGo = r.panels.length ? blinkPlan(r, k, ai, dt) : null;
  if (ai.blink !== 0 && blinkGo?.across) {
    // (inside the edges' own band, coming round Tower Turn as it may still be)
    const side = Math.sign(ai.blink);
    const [lo, hi] = [Math.max(band.lo, side > 0 ? BLINK_IN : -BLINK_OUT), Math.min(band.hi, side > 0 ? BLINK_OUT : -BLINK_IN)];
    band = lo <= hi ? { ...band, lo, hi } : { ...band, lo: side > 0 ? band.hi : band.lo, hi: side > 0 ? band.hi : band.lo };
    want = (side * BLINK_MID) / t.half;
  }
  let lane = clamp(clamp(want, -0.82, 0.82), band.lo / t.half, band.hi / t.half);
  let dodge = dodgeHazard(r, k, lane, band);
  if (dodge !== null) lane = dodge.lane;
  // aim closer in while dodging, beside whatever is in the way, to get across in time
  let look = dodge === null ? 7 + Math.abs(k.v) * 0.5 : clamp(dodge.ds, 4, 5 + Math.abs(k.v) * 0.25);
  // (on the water, with a clean line past it, not so close in: the shell slides on through every turn, and a short look
  // at speed has it weave across its line and into the buoys)
  // (but a ferry crossing is met on a short look, as anything that moves across)
  const ferry = r.boat && ferryAhead(r, k);
  // (though never further than the thing it is getting round: it has to be over in its lane by then)
  if (r.boat && dodge?.clear && !ferry) look = Math.max(look, Math.min(7 + Math.abs(k.v) * 0.5, BOAT_LOOK * Math.abs(k.v), Math.max(8, dodge.ds)));
  // (and through the Blink, on its half by the first row it comes to)
  if (blinkGo?.across && ai.blink !== 0) look = Math.min(look, Math.max(6, blinkGo.ahead));
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
  // (on a slick road it steers by the way it is actually going over the ground, slide and all, not the way its nose
  // points)
  const course = r.slick && Math.abs(k.v) > 5 ? headingOf(Math.sin(k.h) * k.v + k.kx, Math.cos(k.h) * k.v + k.kz) : k.h;
  const diff = wrapAngle(headingOf(p.x - k.x, p.z - k.z) - course);
  // beside a drop it steers for the turn that takes it through the point it aims at, rather than just turning toward
  // it: a kart that only turns toward its aim lags round a tight bend and runs wide, and out there is no wall
  const sp = Math.abs(k.v);
  const rate = band.open ? (-2 * sp * Math.sin(diff)) / look : -diff * 2.6;
  const need = band.open ? rate / Math.max(0.3, TURN * turnK(r) * Math.min(1, sp / 5) * (1 - 0.3 * Math.min(1, sp / 30))) : rate;
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
    // (and on the water it lets go well before a ferry crossing: the shell slides on a long way out of a carve)
    if ((turboLevel(k.charge) >= goal && ending && aligned) || k.drift * rate < -0.35 || ai.driftT > 3 || swerve || room < 1.1 || wary(r, ai) || ferry) inp.drift = false;
  } else if (k.y === 0) {
    inp.steer = clamp(need, -1, 1);
    const bend = curveAhead(t, k.s, 4, 30).mean;
    // no drifting into a corner with something in the way just ahead (a drift can't swerve), unless the kart is already
    // on a clean line past it
    // (and the less able don't drift at all where the road drops away)
    // (nor in the wind unless it is very good, as a drift cannot correct for it; nor at all shaken by a fall)
    const open = (dodge === null || (dodge.clear && Math.abs(dodge.lane * t.half - k.d) < 1) || dodge.ds > 6 + k.v * 0.6) && !(band.open && ai.skill < 0.6) && !(wind !== 0 && ai.skill < 0.8) && !wary(r, ai) && !(r.panels.length > 0 && r.panels.some((h) => deltaS(t, k.s, h.s) > 0 && deltaS(t, k.s, h.s) < 60 && awake(h, k.lap))) && !(r.whirls.length > 0 && ai.skill < 0.9 && whirlAhead(r, k)) && !ferry;
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
  // (on the run-up to the Blink and over it: see the panes)
  const blink = r.panels.length > 0 && r.panels.some((h) => deltaS(t, k.s, h.s) > -(h.len ?? 0) && deltaS(t, k.s, h.s) < 30 && awake(h, k.lap));
  // (and on wet road the wheels turn it less: see drive(); on glass or frost less again, by the slickest of the next 30 m)
  const damp = r.hazards.some((h) => h.kind === 'wet' && awake(h, k.lap) && deltaS(t, k.s, h.s) > -h.r && deltaS(t, k.s, h.s) < 30);
  const slick = r.slick ? Math.min(gripAt(t, k.s, k.lap), gripAt(t, k.s + 15, k.lap), gripAt(t, k.s + 30, k.lap)) : 1;
  // (and on the water a current setting it toward the outside of the bend has it take the bend slower)
  const outward = r.flows.length && peak > 0.02 ? Math.max(0, -Math.sign(bendAhead) * flowAt(r, k.s + 15, k.d, k.lap).across) : 0;
  const cap = ((k.drift !== 0 || inp.drift ? 1.85 : 1.55 * turnK(r)) * (wet ? 0.92 : 1) * (damp ? 0.7 : 1) * (slick < 1 ? 0.55 + 0.45 * slick : 1) * (r.boat ? BOAT_CAP * (slick < BOAT_CHOP ? BOAT_CHOP_CAP : 1) : 1)) / (1 + 0.12 * outward);
  // (on the water by its speed over the ground, the current and all: that is what takes it round the bend)
  const gv = r.flows.length ? k.v + flowAt(r, k.s, k.d, k.lap).along : k.v;
  let tooFast = peak > 0 && gv > cap / peak;
  if (tooFast && peak > 1 / HAIRPIN) {
    tooFast = false;
    for (let a = 0; a <= 20 + k.v * 0.8 && !tooFast; a += t.step) {
      const c = Math.abs(t.curv[Math.floor(wrapS(t, k.s + a) / t.step) % t.n]);
      tooFast = c > 0 && gv * gv > (cap / c) ** 2 + 2 * BRAKE_PLAN * (slick < 1 ? 0.5 + 0.5 * slick : 1) * Math.max(0, a - 2);
    }
  }
  inp.brake = tooFast && (k.boost <= 0 || wet);
  const bendBrake = inp.brake;
  // (waiting for a set piece to get out of the way, but never for long: the road is clear again by then)
  ai.waitT = dodge?.wait ? ai.waitT + dt : 0;
  if (dodge?.wait && ai.waitT > 3) dodge = { ...dodge, wait: false, clear: true, hold: undefined };
  // crawling up to a bank of bollards standing in this lane (knocked back by it, say): hold short of it until it drops
  // rather than nose into it again and again, and go only when it will stay down for as long as getting across it takes
  // from here (but once on it, get off it). Held for long (stopped between two banks, say) it backs off for room to
  // steer into one bank's lane
  let held = false;
  // (and standing on the slab itself with the bank up, as it is after a tumble: straight back off it first)
  let backOut = false;
  let goRun = 0;
  let creep = false;
  let bankHeld = false;
  let lineD = NaN;
  /** Held short of the Marguerite crossing: a lane the bus has already left to edge over to, and how far ahead to aim. */
  let xLane = NaN;
  let xAt = 0;
  const facing = Math.sin(k.h) * t.tx[k.i] + Math.cos(k.h) * t.tz[k.i] > 0.5;
  ai.goT = Math.max(0, ai.goT - dt);
  if (k.v < 8 && facing && ai.goT === 0 && !hurt(k)) {
    // (on a boost it gets there a good deal sooner)
    const a = k.boost > 0 ? 34 : CLASSES[r.cc].accel;
    const v0 = Math.max(0, k.v);
    /** Seconds to go `far` meters from here with the foot down. */
    const reach = (far: number) => (far <= 0 ? 0 : (-v0 + Math.sqrt(v0 * v0 + 2 * a * far)) / a);
    let short = Infinity;
    // (the bank whose lane it is squarely in, if any, and the nearest lane that is square in one: the nearest to where
    // it is, so it does not swing from one to the other as the lane it wants changes)
    let square = false;
    let line = k.d;
    let best = Infinity;
    for (const h of r.hazards) {
      if (h.kind !== 'bollard') continue;
      const ds = deltaS(t, k.s, h.s);
      if (ds < -1 || ds > BANK.back + 3) continue;
      const w = h.w ?? 0;
      const mid = clamp(k.d, h.d - BANK.lane + 0.1, h.d + BANK.lane - 0.1);
      if (Math.abs(mid - k.d) + Math.abs(mid - lane * t.half) * 0.1 < best) {
        best = Math.abs(mid - k.d) + Math.abs(mid - lane * t.half) * 0.1;
        line = mid;
      }
      // (any bank the kart's body touches, not just the one its middle is in; from as far back as a kart is put back)
      // (with a little to spare, as it may wander that much on its way across)
      if (Math.abs(k.d - h.d) > w / 2 + KART_R + 0.25) continue;
      if (Math.abs(k.d - h.d) <= w / 2 - KART_R - 0.25) square = true;
      short = Math.min(short, ds);
      const on = Math.abs(ds) < BANK.thick + KART_R - 0.15;
      const st = hazState(r, h, r.time, k.lap);
      if (on) {
        if (st.solid && ds > -0.2) backOut = true;
        continue;
      }
      // the bank must be down for the whole time the kart is on it, from its nose reaching the slab to its tail leaving
      // it (with a little to spare): then the kart commits to its run, as going and braking by turns is how it arrives
      // slow and straddles the slab as it pops. Otherwise it holds short (it can stand there now, still up)
      const tIn = reach(ds - BANK.thick - KART_R);
      const tOut = reach(ds + BANK.thick + KART_R + 0.3);
      let blocked = false;
      for (let u = Math.max(0, tIn - 0.15); u <= tOut + 0.15 && !blocked; u += 0.05) if (hazState(r, h, r.time + u, k.lap).solid) blocked = true;
      if (blocked) held = bankHeld = true;
      else goRun = Math.max(goRun, tOut);
    }
    // a wrecking ball, likewise, from a crawl (thrown back by it, say): it goes across the ball's path only when the
    // ball will be clear of its lane the whole way, and otherwise backs off for a run-up (from a standstill right in
    // front of it, getting across takes longer than the ball ever leaves a lane clear) and waits there (and a boulder's)
    for (const h of r.hazards) {
      if ((h.kind !== 'wrecker' && h.kind !== 'boulder') || !awake(h, k.lap)) continue;
      const ds = deltaS(t, k.s, h.s);
      const zone = h.r + KART_R + 0.15;
      if (ds < 0 || ds > zone + 8) continue;
      const tIn = reach(ds - zone);
      const tOut = reach(ds + zone);
      let blocked = false;
      for (let u = Math.max(0, tIn - 0.1); u <= tOut + 0.1 && !blocked; u += 0.05) {
        const st = hazState(r, h, r.time + u, k.lap);
        if (st.live && Math.abs(st.d - k.d) < zone) blocked = true;
      }
      if (!blocked) goRun = Math.max(goRun, tOut);
      else if (ds > zone + 6) held = true;
      else backOut = true;
    }
    // and the gang mower crossing, from a crawl (stopped short of it, say): over only when it will be clear of the kart's
    // lane the whole way across, otherwise held short of it; on its line with the mower coming, it backs off
    for (const h of r.hazards) {
      if (h.kind !== 'mower') continue;
      const ds = deltaS(t, k.s, h.s);
      const zone = h.r + KART_R + 0.3;
      if (ds < -zone || ds > zone + 8) continue;
      const tIn = reach(Math.max(0, ds - zone));
      const tOut = reach(ds + zone);
      let blocked = false;
      for (let u = Math.max(0, tIn - 0.2); u <= tOut + 0.3 && !blocked; u += 0.05) {
        const st = hazState(r, h, r.time + u, k.lap);
        if (st.live && Math.abs(st.d - k.d) < lengthOf(h) / 2 + KART_R + 0.6) blocked = true;
      }
      if (!blocked) goRun = Math.max(goRun, tOut);
      else if (ds <= zone + 0.5) backOut = true;
      else held = true;
    }
    // and the Marguerite crossing, from a crawl (stopped short of it, say): it goes over only when the bus will be clear of
    // its lane the whole way across, and otherwise holds short of it, edging over toward a lane the bus has already
    // left if there is one near; on it with the bus coming, it backs off
    for (const h of r.hazards) {
      if (h.kind !== 'shuttle') continue;
      const ds = deltaS(t, k.s, h.s);
      const zone = h.r + KART_R + 0.3;
      if (ds < -zone || ds > zone + 8) continue;
      const tIn = reach(Math.max(0, ds - zone));
      const tOut = reach(ds + zone);
      const free = (d: number) => {
        for (let u = Math.max(0, tIn - 0.2); u <= tOut + 0.3; u += 0.05) {
          const st = hazState(r, h, r.time + u, k.lap);
          if (st.live && Math.abs(st.d - d) < lengthOf(h) / 2 + KART_R + 0.6) return false;
        }
        return true;
      };
      if (free(k.d)) {
        goRun = Math.max(goRun, tOut);
        continue;
      }
      if (ds <= zone + 0.5) {
        backOut = true;
        continue;
      }
      held = true;
      for (const off of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
        if (Math.abs(k.d + off) > t.half - 1.3 || !free(k.d + off)) continue;
        xLane = k.d + off;
        xAt = Math.max(2, ds - zone);
        break;
      }
    }
    if (!held && !backOut && goRun > 0) {
      ai.goT = goRun;
      ai.goD = k.d;
    }
    // (held astride the join between two banks with room still in hand: it edges on into one bank's lane, slowly,
    // rather than stop there, as two side by side are never down together for long enough to cross at a crawl)
    if (held && !square && short < Infinity) {
      lineD = line;
      if (short > BANK.thick + KART_R + 0.4) creep = true;
    }
    // (and held at a row, it keeps to that lane, whatever lane it would like past the row)
    if (creep || bankHeld) {
      // (steering hard for it: at a crawl a kart turns only so far for each meter it goes)
      const p = pointAt(t, k.s + Math.max(1.5, short - BANK.thick - KART_R), line);
      inp.steer = clamp(-wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h) * 6, -1, 1);
      inp.drift = false;
      inp.hop = false;
    }
  }
  // (on its run across it keeps to the lane it judged, rather than drift into the next bank's)
  if (ai.goT > 0 && !hurt(k)) {
    const p = pointAt(t, k.s + 6, ai.goD);
    inp.steer = clamp(-wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h) * 2.6, -1, 1);
    inp.drift = false;
    inp.hop = false;
  }
  ai.heldT = held ? ai.heldT + dt : 0;
  /** Backing off the same thing over and over: wedged against it, so the night crew sets it down well back from it. */
  const backed = (h: Hazard, within: number) => {
    if (r.time - ai.backAt > within) {
      ai.backAt = r.time;
      ai.backs = 0;
    }
    if (++ai.backs < 3) return;
    ai.backs = 0;
    ai.backT = 0;
    // (wherever is clear back there: see spotFor)
    rescue(r, k, spotFor(r, k, h.s - (h.kind === 'bollard' ? BANK.thick + BANK.back : h.r + KART_R + 4), k.d));
  };
  // (held for longer than a bank's whole cycle, or right up against the row astride two banks: it backs off for room)
  const bank = bankHeld ? r.hazards.find((h) => h.kind === 'bollard' && deltaS(t, k.s, h.s) > -1 && deltaS(t, k.s, h.s) < BANK.back + 3) : undefined;
  if (bank && !Number.isNaN(lineD) && !creep && ai.heldT > 0.5) {
    // right up against the row and still astride two banks: backing off only undoes what it has made across, so the
    // night crew sets it down square in a bank's lane, back where a kart the bank catches is put
    ai.heldT = 0;
    rescue(r, k, spotFor(r, k, bank.s - BANK.thick - BANK.back, lineD));
  } else if (bank && ai.heldT > BANK.every + 0.3 && ai.backT === 0) {
    // (held for longer than a bank's whole cycle: straight back, for room, then it goes)
    ai.heldT = 0;
    ai.backT = 1;
    ai.laneTo = 0;
    backed(bank, 3 * (BANK.every + 1));
  }
  // nosing a set piece that is solid right now at a crawl (spun into a sprinkler's hub, say): back off it for a moment
  // with the nose swinging away, or it never gets going again (a bank, which runs right across the road, and the ball,
  // which swings on by, are held short of instead: above)
  ai.backT = Math.max(0, ai.backT - dt);
  if (ai.backT === 0 && ai.goT === 0 && k.v < 6 && k.v > -1 && !hurt(k)) {
    const fx = Math.sin(k.h);
    const fz = Math.cos(k.h);
    for (const h of r.hazards) {
      // (and on the water a buoy, or one of Hwy 101's piers, it has nosed into: it backs off and swings round it, as
      // the current would only hold it there)
      // (but never backing toward the marsh: beside it, it slides on off the buoy instead)
      const buoy = h.kind === 'buoy' || (r.boat && h.kind === 'statue');
      // (the mower is held short of instead, above)
      if ((!timed(h.kind) && !buoy) || h.kind === 'bollard' || h.kind === 'wrecker' || h.kind === 'boulder' || h.kind === 'mower') continue;
      if (buoy && fromBrink(r, k) < 3.5) continue;
      // (a goose on its leash is where it is now, not at its post; and lunging it is gone again in a moment, so it is
      // only backed off from sat by its post)
      const lunge = h.kind === 'tether' && h.look === 'goose' ? hazState(r, h, r.time, k.lap) : null;
      if (lunge?.live) continue;
      const c = lunge ? pointAt(t, h.s, lunge.d) : h;
      const dx = c.x - k.x;
      const dz = c.z - k.z;
      if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
      if (!buoy && !hazState(r, h, r.time, k.lap).solid) continue;
      const along = dx * fx + dz * fz;
      const aside = -dx * fz + dz * fx;
      if (along > 0 && along < h.r + KART_R + 1.2 && Math.abs(aside) < h.r + KART_R + 0.3) {
        ai.backT = 0.7;
        // (the nose swung toward the side of it the kart means to pass, so it comes away already lined up for that)
        ai.laneTo = lane * t.half > (buoy ? h.d : hazState(r, h, r.time, k.lap).d) ? 0.5 : -0.5;
        backed(h, 8);
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
    // (except through the Blink, where its timing over the panes is its speed: it steers for its lane and keeps going)
    if (((bend + swerve > 0 && k.v > 1.55 / (bend + swerve)) || (!dodge.clear && dodge.ds < 4 + k.v * 0.5 && k.v > 9)) && !(blink && dodge.clear)) inp.brake = true;
  }
  // (and stopping short of the Marguerite crossing, braking as late as it can)
  if (dodge?.hold !== undefined && ai.goT === 0 && !hurt(k)) inp.brake = k.v > Math.max(0.3, Math.sqrt(2 * 20 * dodge.hold));
  if (Math.abs(diff) > 2.2 && k.v < 4) inp.brake = false;
  // lined up for a trench: foot down for the jump, and a mushroom if it is going too slowly to make it
  if (band.hole) {
    inp.brake = false;
    // (a gap right across the road wants more speed, from further out)
    const [slow, within] = band.wide ? [20, 40] : [15, 30];
    if (k.v < slow && k.roll === 0 && (k.item === 'mushroom' || k.item === 'triple' || k.item === 'golden') && r.holes.some((h) => deltaS(t, k.s, h.s) > 0 && deltaS(t, k.s, h.s) < within)) inp.use = true;
  }
  // (through the Blink it goes for it on the side it has picked, or holds short of the first row until one will hold)
  // (and on its way it lifts for nothing but a bend, as arriving later than it planned is how a pane goes under it)
  if (blinkGo !== null && Math.abs(ai.blink) === 2 && k.v > Math.max(Math.sqrt(2 * 14 * Math.max(0, blinkGo.stop)), blinkGo.creep ? 3 : 0)) inp.brake = true;
  else if (blinkGo !== null && Math.abs(ai.blink) === 1) inp.brake = bendBrake;
  // (committed to a run across a bank, it does not lift halfway over)
  if (ai.goT > 0 && !hurt(k)) inp.brake = false;
  if (held && ai.backT === 0) inp.brake = k.v > (creep ? 2.5 : 0.3);
  if (held && ai.backT === 0 && !Number.isNaN(xLane)) {
    // (edging over at a crawl toward the lane the bus has left, steering hard for it)
    const p = pointAt(t, k.s + xAt, xLane);
    inp.steer = clamp(-wrapAngle(headingOf(p.x - k.x, p.z - k.z) - k.h) * 6, -1, 1);
    inp.brake = k.v > 3;
    inp.drift = false;
    inp.hop = false;
  }
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
        // (shaken by a fall, it always does)
        ai.react = wary(r, ai) || r.rand() < 0.55 + 0.45 * ai.skill;
      }
      if (ai.react) {
        inp.steer = -side;
        inp.drift = false;
        inp.hop = false;
        if (k.v > 15 && !blink) inp.brake = true;
      }
    }
  }
  // on the water: never sitting on the brakes beside a whirlpool that spins (or is about to), as a slow shell is the one
  // it draws in; and stopped short of the weir, too slow to clear the stopper from there, back off for a run at it
  // (and a shell just set back down, still slow, eases up short of the next whirlpool's pull until it can be through it
  // before it spins, rather than be drawn in a second time; never for long)
  // (and on the Skyway the same short of the Gap, knocked about on the run-up, say, with no mushroom to clear it on)
  if (r.boat) {
    ai.whirlHold = ai.care > 0 && k.v < 22 && !held && !backOut && whirlDue(r, k) ? ai.whirlHold + dt : 0;
    if (ai.whirlHold > 0 && ai.whirlHold < WHIRL_HOLD) {
      inp.brake = k.v > 4;
      inp.drift = false;
    }
  }
  if (r.boat && inp.brake && ai.backT === 0 && !held && !backOut && k.v < 15 && whirlNear(r, k, 2)) inp.brake = false;
  const shroom = k.item === 'mushroom' || k.item === 'triple' || k.item === 'golden';
  if ((r.boat || (glass(r) && !shroom)) && band.wide && k.y === 0 && !hurt(k)) {
    for (const h of r.holes) {
      const ds = deltaS(t, k.s, h.s);
      if (ds < 0 || ds > 16) continue;
      // (straight back, square to the weir, not swinging off toward the marsh)
      if (ai.backT > 0) {
        inp.steer = clamp(wrapAngle(headingOf(t.tx[k.i], t.tz[k.i]) - k.h) * 2, -1, 1);
        continue;
      }
      const lip = Math.sqrt(Math.max(0, k.v * Math.abs(k.v) + 2 * 0.85 * CLASSES[r.cc].accel * Math.max(0, ds - 1)));
      if (facing && ds < 14 && lip < 14.5 && k.boost <= 0) ai.backT = 2;
    }
  }
  // on the water: catches on the beat, hopping the swell and (the best of them) a log in the way
  if (r.boat && !inp.hop && !inp.drift && k.drift === 0 && k.y === 0 && !hurt(k) && !band.hole && !held && !backOut && ai.goT === 0 && ai.backT === 0) waterHop(r, k, ai, dodge);

  // cash in a full purse for a boost on a straight with nothing in the way
  if (k.coins >= MAX_COINS && k.boost <= 0 && !dodge && Math.abs(curveAhead(t, k.s, 0, 30).peak) < 0.012 && r.rand() < dt * 0.3) inp.cash = true;

  // tricks off ramps, a hop just as a POW block goes off, and a shove for anyone driving alongside
  if (k.air && k.trickT > 0 && !k.trick && r.rand() < ai.skill * 0.25) inp.hop = true;
  for (const p of r.pows) {
    const left = POW_T - (r.time - p.at);
    if (p.by !== k.idx && left > 0.04 && left < 0.24 && k.y === 0 && r.rand() < ai.skill * 0.08) inp.hop = true;
  }
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
    // (on the Skyway it never shoves another CPU anywhere near the brink, as a shove carries a long way on glass, nor
    // through the Blink, where the panes are the drop: its tricks there are for the people it races)
    // (on the water, where a shove carries a long way too, nowhere near it either)
    if (beside && !(r.slick && beside.kind === 'cpu' && (fromBrink(r, beside) < (r.boat ? 5.5 : 6.5) || ai.blink !== 0)) && (!hunt || fromBrink(r, beside) < 3 || r.rand() < 0.5)) inp.slam = true;
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
      go = (behind && !inp.hold) || ai.held > 9 || (expert(r) && band.open && Math.abs(curveAhead(t, k.s, -10, 10).peak) > 0.04 && r.karts.some((o) => o !== k && o.done === null && deltaS(t, o.s, k.s) > 2 && deltaS(t, o.s, k.s) < 40 && !(r.slick && o.kind === 'cpu')));
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
      // (never while waiting its moment at a set piece, nor on its timed run past one, nor through the Blink: a boost
      // throws the timing out)
      if (held || backOut || ai.goT > 0 || ai.blink !== 0) go = false;
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
    case 'boomerang':
      go = r.karts.some((o) => o !== k && o.done === null && deltaS(t, k.s, o.s) > 6 && deltaS(t, k.s, o.s) < 38 && Math.abs(o.d - k.d) < 4) || ai.held > 6;
      break;
    case 'fire':
    case 'ice':
      // (once the fire flower is lit, keep throwing)
      if (aheadNear) go = true;
      else if (behind) go = inp.back = true;
      else go = k.fireT > 0 || ai.held > 6;
      break;
    case 'piranha':
      go = ai.held > 0.5 && !held && !backOut && ai.goT === 0 && ai.blink === 0;
      break;
    case 'boo': {
      // vanish when a shell is coming for you, or as soon as someone ahead has something worth taking
      const chased = r.things.some((th) => th.owner !== k.idx && ((th.kind === 'red' && th.target === k.idx) || (th.kind === 'blue' && leaderFor(r) === k)) && Math.hypot(th.x - k.x, th.z - k.z) < 25);
      go = chased || (ai.held > 1.5 && r.karts.some((o) => o.place < k.place && o.item !== null && o.roll === 0)) || ai.held > 8;
      break;
    }
    case 'feather': {
      // jump whatever is lying in the way, or a blue shell about to land; never toward a trench, a pane or the brink
      const safe = !band.hole && fromBrink(r, k) > 5 && !r.holes.some((h) => deltaS(t, k.s, h.s) > -5 && deltaS(t, k.s, h.s) < 40) && !r.panels.length && !held && !backOut && ai.goT === 0;
      const inWay = r.things.some((th) => {
        if (th.owner === k.idx || th.kind === 'blue') return false;
        const at = locate(t, th.x, th.z, th.i);
        const ds = deltaS(t, k.s, at.s);
        return ds > 3 && ds < 4 + k.v * 0.4 && Math.abs(at.d - k.d) < 2.4;
      });
      const blue = leaderFor(r) === k && r.things.some((th) => th.kind === 'blue' && Math.hypot(th.x - k.x, th.z - k.z) < 9);
      go = safe && (inWay || blue || (ai.held > 8 && straight && !dodge));
      break;
    }
    case 'cloud':
      go = true;
      break;
    case 'pow':
      go = k.place > 1 && ai.held > 1;
      break;
  }
  inp.use = go;
}

/**
 * On the water, what the current and the swell ahead mean for a CPU's line: how far to lean against them (meters, to
 * the right), how much more room to keep from the edge each side (lo, hi), and the lane it prefers for the water itself
 * (a fraction of the half width added to the one it wants): the best hug the bank going upstream and ride the tongue of the
 * tide race down (and keep out of it once the tide has turned).
 */
function waterAhead(r: Race, k: Kart) {
  const t = r.track;
  const v = Math.max(8, Math.abs(k.v));
  const ai = k.ai!;
  let lean = 0;
  let lo = 0;
  let hi = 0;
  if (r.flows.length) {
    const f = flowAt(r, k.s + 10 + 0.3 * v, k.d, k.lap);
    if (f.across !== 0) {
      lean += Math.sign(f.across) * Math.min(1, 0.6 * Math.abs(f.across));
      if (f.across > 0) hi += 0.4 * f.across;
      else lo -= 0.4 * f.across;
    }
  }
  if (r.swells.length) {
    let best: ReturnType<typeof swellWarn> = null;
    for (let a = 0; a <= 10 + 0.7 * v; a += 5) {
      const w = swellWarn(r, k.s + a, r.time + a / v, k.lap);
      if (w && (!best || w.kick * w.k > best.kick * best.k)) best = w;
    }
    if (best) {
      lean += best.dir * Math.min(1.2, 0.25 * best.kick);
      if (best.dir > 0) hi += 0.3 * best.kick;
      else lo += 0.3 * best.kick;
    }
  }
  // (the lane buoys coming up: into the middle lane, clear of the logs down the left, well before the first; once among
  // them, a shell thrown into an outside lane stays in it rather than force its way back through a line of them)
  let first = Infinity;
  for (const h of r.hazards) if (h.kind === 'buoy') first = Math.min(first, deltaS(t, k.s, h.s));
  const buoys = first > -2 ? first < 15 + 1.6 * v : r.hazards.some((h) => h.kind === 'buoy' && deltaS(t, k.s, h.s) > 0 && deltaS(t, k.s, h.s) < 15) && Math.abs(k.d) < 2.2;
  const lane = (want: number) => {
    if (buoys) return -want;
    if (ai.skill < 0.7 || !r.flows.length) return 0;
    const s = k.s + 10;
    for (const f of r.flows) {
      if (deltaS(t, f.s0, s) < 0 || deltaS(t, s, f.s1) < 0) continue;
      const turned = f.tide && k.lap >= TIDE_LAP;
      if (f.tongue) return turned ? Math.sign(want || k.d || 1) * 0.6 - want : -0.7 * want;
      const up = (turned ? -f.along : f.along) < 0;
      if (f.bank !== undefined && up) return Math.sign(k.d || want || 1) * 0.82 - want;
    }
    return 0;
  };
  return { lean, lo, hi, lane };
}

/** Whether a ferry is crossing the channel within a couple of seconds' run ahead of kart k. */
function ferryAhead(r: Race, k: Kart) {
  for (const h of r.hazards) {
    if (h.kind !== 'ferry') continue;
    const ds = deltaS(r.track, k.s, h.s);
    if (ds > -3 && ds < 12 + 1.5 * Math.abs(k.v)) return true;
  }
  return false;
}

/** Whether kart k is within `pad` meters of the pull of a whirlpool that spins, or is about to. */
function whirlNear(r: Race, k: Kart, pad: number) {
  for (const h of r.whirls) {
    const st = hazState(r, h, r.time, k.lap);
    if (!st.live && st.warn <= 0) continue;
    const c = pointAt(r.track, h.s, st.d);
    if (Math.hypot(c.x - k.x, c.z - k.z) < (h.pull ?? 7) + pad) return true;
  }
  return false;
}

/** The longest a CPU holds short of a whirlpool (see think()). */
const WHIRL_HOLD = 4;
/**
 * Whether kart k, not yet in the pull of the whirlpool just ahead, would still be in it while it spins if it went on now
 * (at the speed it is getting up to): the time to wait for it to die away.
 */
function whirlDue(r: Race, k: Kart) {
  const t = r.track;
  for (const h of r.whirls) {
    if (!awake(h, k.lap)) continue;
    const pull = h.pull ?? 7;
    const ds = deltaS(t, k.s, h.s);
    if (ds < pull + 3 || ds > pull + 35) continue;
    const v = Math.max(10, k.v + 4);
    for (let u = (ds - pull) / v; u <= (ds + pull) / v; u += 0.1) if (hazState(r, h, r.time + u, k.lap).live) return true;
  }
  return false;
}
/** Whether a whirlpool spinning (or about to) lies just ahead of kart k, near enough to pull it in. */
function whirlAhead(r: Race, k: Kart) {
  const v = Math.max(8, Math.abs(k.v));
  for (const h of r.whirls) {
    const ds = deltaS(r.track, k.s, h.s);
    const pull = h.pull ?? 7;
    if (ds < -pull || ds > pull + 10 + v * 0.8) continue;
    const st = hazState(r, h, r.time + Math.max(0, ds) / v, k.lap);
    if (st.live || st.warn > 0) return true;
  }
  return false;
}

/**
 * A CPU's hops on the water: a catch on the beat on a straight with nothing in the way (each beat it means to catch or
 * not, more often the better it is, and a little early or late the less able), the swell's crests (the best of them, as
 * one reaches them) and a log in the way it cannot steer round (likewise).
 */
function waterHop(r: Race, k: Kart, ai: Ai, dodge: Dodge | null) {
  const t = r.track;
  const inp = k.input;
  const straight = Math.abs(inp.steer) <= 0.3 && Math.abs(k.steer) <= 0.3;
  // the swell
  if (ai.skill >= 0.8 && r.swells.length) {
    for (const sw of r.swells) {
      if (swellTaper(r, sw, k.s, k.lap) <= 0) continue;
      for (const d of crestsAt(r, sw, r.time)) {
        const tt = (k.d - d) / (sw.dir * sw.c);
        if (tt <= 0 || tt > 0.5) continue;
        const key = `${Math.round((r.time + tt) * 5)}`;
        if (ai.hopKey !== key) {
          ai.hopKey = key;
          ai.hopGo = r.rand() < ai.skill;
        }
        if (ai.hopGo && tt <= 0.08 + 1 / 60) {
          inp.hop = true;
          if (straight) inp.steer = clamp(inp.steer, -0.3, 0.3);
          return;
        }
      }
    }
  }
  // a log it cannot get round
  if (ai.skill >= 0.8 && dodge && !dodge.clear && k.v > 8) {
    for (const h of r.vessels) {
      if (h.kind !== 'log' || h.gone) continue;
      const near = deltaS(t, k.s, h.along) - lengthOf(h) / 2 - KART_R;
      if (near > 0 && near < 0.06 * k.v + 0.4 && Math.abs(h.at - k.d) < h.r + KART_R + 0.3) {
        inp.hop = true;
        return;
      }
    }
  }
  // the catch: each beat decided once, as it comes
  const next = Math.round(r.time / STROKE_T) + (r.time - Math.round(r.time / STROKE_T) * STROKE_T > 0.05 ? 1 : 0);
  if (ai.catchBeat !== next) {
    ai.catchBeat = next;
    if (r.rand() < 0.3 + 0.65 * ai.skill) {
      // (a little early or late: normally distributed, the less able the wider)
      const g = Math.sqrt(-2 * Math.log(Math.max(1e-9, r.rand()))) * Math.cos(2 * Math.PI * r.rand());
      ai.catchAt = next * STROKE_T + g * 0.1 * (1 - ai.skill);
    } else ai.catchAt = NaN;
  }
  if (!(r.time >= ai.catchAt) || !straight || k.v <= 8) return;
  ai.catchAt = NaN;
  // (only on the open water: nothing to steer round soon, well clear of the marsh, no ramp coming)
  if ((dodge && dodge.ds < 20) || fromBrink(r, k) < 2.5 || r.ramps.some((p) => deltaS(t, k.s, p.s) > -1 && deltaS(t, k.s, p.s) < 15)) return;
  inp.hop = true;
}

/** The lane the CPU driver would pick for kart k right now, as dodgeHazard sees it (for the tests). */
export function cpuLane(r: Race, k: Kart) {
  const ai = (k.ai ??= { ...AUTO, blunders: {} });
  return dodgeHazard(r, k, clamp(ai.lane, -0.82, 0.82), edgeBand(r, k, edgeRoom(r, k, ai)));
}

/** How far before the Blink's first row a CPU starts planning its way through, and where it keeps to across a half of it. */
const BLINK_AHEAD = 40;
const BLINK_MID = 2.75;
const BLINK_IN = 1.4;
const BLINK_OUT = 4.1;
/** The longest it holds short of a row (two of a pane's cycles, near enough) before it goes for it whatever. */
const BLINK_WAIT = 6;
/**
 * Through the Blink, the rows of panes that blink out on the clock: a CPU picks the side of the road whose panes coming
 * up hold the whole time it is going over each, foot down from here (as far as a gap between rows it could stop in
 * again, and on a side it can get across to in time), and keeps to it, as swapping halves between rows is how a kart
 * ends up on the seam over the one that has gone. If neither side will hold it holds short of the next row until one
 * will: the Blink has rails, and the panes run on the clock, so that is never long. Sets ai.blink (the side, -1 or 1;
 * twice that holding; 0 away from the Blink) and returns how far the kart may still go before it has to stop (Infinity
 * once it goes), whether it may move across to its half yet, and how far the next row is; null away from the Blink.
 */
function blinkPlan(r: Race, k: Kart, ai: Ai, dt: number): { stop: number; across: boolean; ahead: number; creep?: boolean } | null {
  const t = r.track;
  const ds = (h: Hazard) => deltaS(t, k.s, h.s);
  // (the panes out on its lap still ahead of the kart's middle, or under it)
  const rows = r.panels.filter((h) => awake(h, k.lap) && ds(h) > -(h.len ?? 0) && ds(h) < BLINK_AHEAD);
  if (!rows.length || hurt(k)) {
    if (!rows.length) ai.blink = ai.blinkT = 0;
    return null;
  }
  const first = Math.min(...rows.map(ds));
  // where it would stop to hold, and whether it still can before its middle is over the next pane (braking a little
  // less hard than glass allows)
  const stop = first - KART_R - 4;
  const canStop = k.v <= 0.5 || (k.v * k.v) / 40 <= first - 0.3;
  // where it gets to, and how fast it is going, foot down from here, every 0.05 s for 4 s (on a boost, then off it), but
  // no faster than it takes the bend it is coming out of (see think)
  const C = CLASSES[r.cc];
  const grip = 0.6 + 0.4 * gripAt(t, k.s, k.lap);
  const top = topOf(r, k) - (k.boost > 0 ? BOOST_DV : 0);
  const bendCap = 1.55 * (0.55 + 0.45 * gripAt(t, k.s, k.lap));
  const path = [0];
  const speed = [Math.max(0, k.v)];
  for (let u = 0, v = Math.max(0, k.v), x = 0, boost = k.boost; u < 4; u += 0.05) {
    const c = Math.abs(t.curv[Math.floor(wrapS(t, k.s + x) / t.step) % t.n]);
    const cap = Math.min(top + (boost > 0 ? BOOST_DV : 0), c > 0.02 ? bendCap / c : Infinity);
    v = v < cap ? Math.min(cap, v + (boost > 0 ? 34 : C.accel) * grip * 0.05) : Math.max(cap, v - 20 * 0.05);
    x += v * 0.05;
    boost -= 0.05;
    path.push(x);
    speed.push(v);
  }
  const at = (dist: number) => {
    const i = path.findIndex((x) => x >= dist);
    return i < 0 ? -1 : i;
  };
  // (it moves across to its half on the way round Tower Turn, or once out of it, but not on the straight before it, where
  // swinging out to the right is how it runs wide off the turn: see think)
  let bend = 0;
  for (let a = 0; a < first; a += t.step) if (Math.abs(t.curv[Math.floor(wrapS(t, k.s + a) / t.step) % t.n]) >= 0.03) bend = a + t.step;
  /**
   * Whether the panes on that side hold while the kart goes over each (with `spare` seconds either side), as far as the
   * first gap between rows it could stop in again and think again; and whether it can get across to that side.
   */
  const holds = (side: number, spare: number) => {
    const mine = rows.filter((h) => Math.sign(h.d) === side).sort((a, b) => ds(a) - ds(b));
    if (!mine.length) return true;
    // (a kart already well over that half need not move across; one that has to cross the seam needs room to)
    if (side * k.d < 0.3 && Math.abs(side * BLINK_MID - k.d) > 0.4 + 0.25 * Math.max(0, ds(mine[0]) - KART_R)) return false;
    for (let j = 0; j < mine.length; j++) {
      const h = mine[j];
      const len = h.len ?? 0;
      const i0 = at(ds(h) - KART_R - 0.3);
      const i1 = at(ds(h) + len + KART_R + 0.3);
      if (i0 < 0 || i1 < 0) return false;
      for (let u = Math.max(0, i0 * 0.05 - spare); u <= i1 * 0.05 + spare; u += 0.05) if (hazState(r, h, r.time + u, k.lap).live) return false;
      const next = mine[j + 1];
      const out = at(ds(h) + len + 0.3);
      if (next && out >= 0 && (speed[out] * speed[out]) / 40 <= ds(next) - ds(h) - len - 0.6) break;
    }
    return true;
  };
  const go = { stop: Infinity, across: bend === 0 || Math.abs(t.curv[k.i]) >= 0.03, ahead: first };
  const side = k.d >= 0 ? 1 : -1;
  // (already on a pane, knocked onto it, say: it never sits there, but gets off it)
  if (rows.some((h) => Math.sign(h.d) === side && ds(h) <= 0.3)) {
    ai.blink = side;
    ai.blinkT = 0;
    return go;
  }
  // (nor does it wait on for ever: then it goes, and keeps going, blinkT -1)
  if (ai.blinkT >= 0) ai.blinkT = Math.abs(ai.blink) === 2 ? ai.blinkT + dt : 0;
  if (ai.blinkT > BLINK_WAIT) {
    ai.blink = side;
    ai.blinkT = -1;
  }
  // (once it has picked a side it keeps to it, unless that side will not hold after all and it can still stop short)
  if ((ai.blink === 1 || ai.blink === -1) && (ai.blinkT < 0 || !canStop || holds(ai.blink, 0))) return go;
  const sides = [-1, 1].filter((sg) => holds(sg, 0.15));
  if (sides.length) {
    ai.blink = sides.length > 1 ? (Math.abs(ai.blink) === 2 ? Math.sign(ai.blink) : side) : sides[0];
    return go;
  }
  // (too late to stop short of it: the side it is on)
  if (!canStop) {
    ai.blink = side;
    return go;
  }
  // (holding on the half it is on, or on the seam the one it meant to take, and staying on it rather than drifting back
  // onto the seam as it slows; and until it is over it, creeping on, as a kart at a standstill cannot steer across)
  if (Math.abs(ai.blink) !== 2) ai.blink = 2 * (Math.abs(k.d) > 0.5 ? side : Math.sign(ai.blink) || side);
  return { ...go, stop, creep: Math.sign(ai.blink) * k.d < 0.3 && first > KART_R + 1.5 };
}

/**
 * The wind a CPU is driving into: the strongest gust blowing, or about to, over the road it covers in the next moment
 * (by the time it gets to each point of it), in meters a second squared to the right. 0 in still air.
 */
function windAhead(r: Race, k: Kart) {
  const v = Math.max(8, Math.abs(k.v));
  let best = 0;
  for (let a = 0; a <= 10 + v * 0.7; a += 4) {
    const when = r.time + a / v;
    let sum = 0;
    for (const g of r.gusts) {
      const st = gustState(r, g, k.s + a, when, k.lap);
      if (st && (st.live > 0 || st.warn > 0)) sum += g.a * st.taper;
    }
    if (Math.abs(sum) > Math.abs(best)) best = sum;
  }
  return best;
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
