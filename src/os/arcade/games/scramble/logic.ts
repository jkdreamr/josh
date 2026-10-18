// Scramble's simulation: eggs on the bus, gliding down, looting, shooting, throwing, building walls and outlasting
// the storm, plus the computer players. Pure, so it can be tested, and the same on every client.
//
// Online, each egg belongs to one client: yours to you, the computer players to the host. Only the owner moves an egg,
// heals it, and decides when it cracks. A bullet's damage is decided by whoever fired it, against the eggs where that
// client sees them, then sent to the egg's owner; grenades and launcher eggs work the same way. Things the whole
// island sees (a barrel going up, a puddle of hot sauce) are felt by each client on the eggs it owns. The host settles
// everything shared: who got a pickup, when a chest opens or a crate, barrel or wall breaks, and who won. `world` is
// true where those calls are made (solo and the host).
import {
  BOOST,
  HP_MAX,
  MELEE,
  MELEE_IDS,
  PAN_ARC,
  SCOPE_VIEW,
  SHIELD_MAX,
  THROW,
  THROWS,
  THROW_IDS,
  USES,
  WALL_COST,
  WEAPONS,
  WEAPON_IDS,
  WOOD_MAX,
  ammoCap,
  damageOf,
  isWeapon,
  reloadOf,
  rng32,
  throwCap,
  useCap,
  type Ammo,
  type LootDef,
  type MeleeId,
  type Rng,
  type ThrowId,
  type UseId,
  type WeaponId,
} from './items.ts';
import {
  BUS_Y,
  CAMP,
  CRATE_HALF,
  EDGE,
  DROP_BASE,
  HAY_HW,
  PAD,
  POND_SLOW,
  RIVER_HALF,
  ROAD_SPEED,
  SUPPLY_FALL,
  TOILET_R,
  WALL_T,
  bridgeAt,
  buildingAt,
  busAt,
  coverAt,
  fireAt,
  generateMap,
  low,
  padAt,
  pushBox,
  pushCircle,
  pushObb,
  rayBox,
  rayCircle,
  rayObb,
  raySolid,
  riverCrossings,
  roadAt,
  solidsAlong,
  solidsNear,
  stormAt,
  waterAt,
  yardAt,
  type Box,
  type Bridge,
  type Container,
  type Door,
  type GameMap,
  type Obb,
  type Solid,
  type StormNow,
} from './map.ts';

export const COUNTDOWN = 3;
export const MAX_FIGHTERS = 20;
export const FIGHTER_R = 0.6;
/** Bullets hit an egg a little wider than it pushes. */
export const HIT_R = 0.75;
export const SPEED = 6.2;
export const GLIDE = 13;
export const FALL = 7.5;
export const PICK_R = 1.8;
export const AUTO_R = 1.25;
export const CHEST_R = 2.3;
export const WALL_HALF = 1.7;
export const WALL_THICK = 0.2;
export const WALL_HP = 150;
export const WALL_DIST = 2.1;
export const BUILD_COOL = 0.3;
export const STORM_TICK = 0.5;
export const CRATE_HP = 60;
export const TOILET_HP = 35;
export const HAY_HP = 50;
/** A barrel takes this much before it goes up, then hurts everything within `radius`. */
export const BARREL = { hp: 40, radius: 5, dmg: 75 };
/** About how far a bounce pad carries an egg that glides straight on. */
export const PAD_FLY = Math.round((PAD.y / FALL) * GLIDE);
/** Remote eggs are drawn this far in the past, between the last two updates. */
export const INTERP = 0.1;
/** The slot numbers: two guns, the melee weapon, and whatever there is to throw. */
export const SLOT_MELEE = 2;
export const SLOT_THROW = 3;
/** Where an egg's own drops start numbering, so no two clients ever pick the same loot id. */
export const dropId = (fid: number, n: number) => DROP_BASE + fid * 100_000 + (n % 100_000);
export const wallId = (fid: number, n: number) => fid * 100_000 + (n % 100_000);

/** Flag bits an owner reports with an egg's position. */
export const F_RELOAD = 1;
export const F_HEALING = 2;
export const F_SHIELDING = 4;
export const F_SHIELDED = 8;
export const F_HIT = 16;
export const F_PAN = 32;
export const F_BOOST = 64;
export const F_DRINKING = 128;

export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];
export const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);
export type Role = 'solo' | 'host' | 'guest';
export type Phase = 'bus' | 'drop' | 'ground' | 'out';
export const PHASES: readonly Phase[] = ['bus', 'drop', 'ground', 'out'];
export type Kind = 'player' | 'bot' | 'remote';
/** What dealt a hit: a gun, a melee weapon, a grenade, hot sauce, a barrel, or the storm. */
export type Cause = WeaponId | MeleeId | 'grenade' | 'sauce' | 'barrel' | 'storm' | 'left';
export const CAUSES: readonly Cause[] = [...WEAPON_IDS, ...MELEE_IDS, 'grenade', 'sauce', 'barrel', 'storm', 'left'];
/** What an egg can have in hand. */
export type Held = WeaponId | MeleeId | ThrowId;
export const HELD: readonly Held[] = [...WEAPON_IDS, ...MELEE_IDS, ...THROW_IDS];
export type Gun = { w: WeaponId; r: number; mag: number };

/** What a player or the computer wants this frame. The one-shot fields are cleared once read. */
export type Input = {
  mx: number;
  mz: number;
  aim: number;
  fire: boolean;
  reload: boolean;
  /** 0 and 1 are the gun slots, 2 the melee weapon, 3 the throwables (again to pick the next kind); -1 for no change. */
  slot: number;
  cycle: number;
  interact: boolean;
  build: boolean;
  /** A consumable to start on: one by name, or the right one for health or for shield. */
  use: UseId | 'bestHeal' | 'bestShield' | null;
  jump: boolean;
  /** How far ahead to throw, in meters (0 for the usual distance). */
  reach: number;
  /** Take out this kind of throwable. */
  pick: ThrowId | null;
};
export const noInput = (): Input => ({ mx: 0, mz: 0, aim: 0, fire: false, reload: false, slot: -1, cycle: 0, interact: false, build: false, use: null, jump: false, reach: 0, pick: null });

/** One position report for an egg another client owns. `at` is our clock when it arrived. */
export type Snap = { at: number; x: number; z: number; y: number; aim: number; vx: number; vz: number };

export type Ai = {
  /** Where we're off to: loot, a chest (or fridge) to open, a crate (or toilet, or hay bale) to smash, a campfire to warm up at. */
  goal: 'drop' | 'loot' | 'chest' | 'smash' | 'fire' | 'zone' | 'roam' | 'chase';
  gx: number;
  gz: number;
  item: number;
  /** The container (for chest and smash goals) or the campfire (fire) we're going to. */
  chest: number;
  /** A bounce pad on the way to somewhere far, or -1. */
  pad: number;
  /** The bridge we're crossing the river by, or -1. */
  bridge: number;
  /** When to give up on a crate or a campfire. */
  until: number;
  /** The last container we gave up smashing. */
  tried: number;
  target: number;
  react: number;
  strafe: number;
  strafeT: number;
  think: number;
  jumpAt: number;
  stuckT: number;
  lastX: number;
  lastZ: number;
  detourT: number;
  detourA: number;
  /** Knocking down the wall or crate in our way, for this long, swinging this way. */
  smashT: number;
  smashA: number;
  /** The doorway we're on our way out through (or the gate we're on our way in through, when `inward`). */
  exit: Door | null;
  inward: boolean;
  err: number;
  errT: number;
  /** Seconds the aim has held steady on the target, for a scoped shot. */
  steady: number;
  burst: number;
  rest: number;
  buildCool: number;
  swapCool: number;
  /** A throw in progress: what, how far, how long it may take, and how many there were before it. */
  toss: ThrowId | null;
  tossD: number;
  tossT: number;
  tossHad: number;
  tossCool: number;
};

export type Fighter = {
  id: number;
  /** The room seat of a person, or -1 for a computer player. */
  seat: number;
  name: string;
  color: string;
  kind: Kind;
  phase: Phase;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  aim: number;
  hp: number;
  shield: number;
  guns: [Gun | null, Gun | null];
  melee: MeleeId;
  throws: Record<ThrowId, number>;
  /** The kind of throwable in hand on the throw slot. */
  pick: ThrowId;
  slot: number;
  ammo: Record<Ammo, number>;
  items: Record<UseId, number>;
  /** 0..100: health over time and a quicker step while it lasts. */
  boost: number;
  /** Scope level 0..3 (1x, 2x, 4x, 8x). */
  scope: number;
  /** Backpack level 0..3. */
  pack: number;
  wood: number;
  fireT: number;
  /** Shots left in the burst being fired, and the wait before the next. */
  burst: number;
  burstT: number;
  reloadT: number;
  reloadSlot: number;
  using: UseId | null;
  useT: number;
  buildT: number;
  stormT: number;
  burnT: number;
  /** Seconds left on the hit flash. */
  hitT: number;
  lastBy: number;
  lastByAt: number;
  /** Our clock when it last fired; shooting gives away an egg hiding in a bush. */
  firedAt: number;
  kills: number;
  dealt: number;
  place: number;
  by: number;
  outCause: Cause | null;
  outAt: number;
  /** Cover hiding it (a bush or a cornfield, see coverAt), or -1. */
  bush: number;
  inside: number;
  /** Wading through a pond. */
  wet: boolean;
  /** Warming up at a campfire. */
  warm: boolean;
  /** Match time the current glide began (from the bus or a bounce pad). */
  dropAt: number;
  /** The way a bounce pad threw us: unsteered, the glide carries on that way (still, off the bus). */
  flingX: number;
  flingZ: number;
  input: Input;
  ai: Ai | null;
  /** Remote eggs: recent reports, newest last, and what they hold. */
  snaps: Snap[];
  show: { w: Held | null; r: number; flags: number };
  /** Loot ids asked of the host, and when. */
  pending: Map<number, number>;
  wallSeq: number;
  dropSeq: number;
  /** Remote eggs whose owner says they are out, though the news of how hasn't arrived yet. */
  outSeen: number;
};

export type Bullet = { f: number; w: WeaponId; r: number; x: number; z: number; dx: number; dz: number; speed: number; left: number; traveled: number; dmg: number; local: boolean };
export type LootItem = { id: number; def: LootDef; x: number; z: number; by: number; at: number };
export type Wall = Obb & { id: number; f: number; a: number; hp: number };
/** Something thrown, flying from (x, z) to (lx, lz) over `ft` seconds from match time `t0`. A grenade goes off at `fuse`. */
export type Toss = { f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; t0: number; ft: number; fuse: number; local: boolean; landed: boolean };
/** A flour cloud (hides whoever is in it) or a puddle of hot sauce (burns whoever stands in it), until `until`. */
export type Zone = { k: 'flour' | 'sauce'; x: number; z: number; r: number; from: number; until: number; by: number };

export type Thud = 'tree' | 'rock' | 'wall' | 'crate' | 'chest' | 'barrel' | 'car' | 'fence' | 'table' | 'post' | 'fire' | 'log' | 'shelf' | 'seat' | 'built' | 'egg' | 'pan' | 'ground';

/** Things that happened this frame, for sounds, effects and the network. `net` marks news that came from it. */
export type Ev = (
  | { t: 'beep' }
  | { t: 'go' }
  | { t: 'storm'; phase: number; shrinking: boolean }
  | { t: 'supply'; c: number }
  | { t: 'jump'; f: number }
  | { t: 'bounce'; f: number }
  | { t: 'land'; f: number }
  | { t: 'shot'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number }
  | { t: 'swing'; f: number }
  | { t: 'throw'; f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; ft: number }
  | { t: 'zone'; k: Zone['k']; x: number; z: number }
  | { t: 'hit'; f: number; to: number; d: number; w: Cause; x: number; z: number; shield: boolean; local: boolean }
  | { t: 'hurt'; f: number; d: number; by: number; storm: boolean; shield: boolean }
  | { t: 'thud'; x: number; z: number; what: Thud }
  | { t: 'smash'; f: number; kind: 'wall' | 'crate'; id: number; d: number; x: number; z: number }
  | { t: 'boom'; f: number; x: number; z: number }
  | { t: 'harvest'; f: number; x: number; z: number; n: number }
  | { t: 'reload'; f: number }
  | { t: 'reloaded'; f: number }
  | { t: 'empty'; f: number }
  | { t: 'use'; f: number; what: UseId }
  | { t: 'used'; f: number; what: UseId }
  | { t: 'out'; f: number; by: number; w: Cause; place: number }
  | { t: 'drop'; item: LootItem }
  | { t: 'take'; f: number; id: number }
  | { t: 'took'; f: number; id: number; def: LootDef }
  | { t: 'open'; f: number; c: number }
  | { t: 'opened'; c: number; f: number }
  | { t: 'wall'; wall: Wall }
  | { t: 'wallgone'; id: number }
  | { t: 'end'; winner: number }
) & { net?: boolean };

export type Match = {
  map: GameMap;
  seed: number;
  role: Role;
  /** Settles pickups, chests, crates, barrels, walls and the result (solo and the host). */
  world: boolean;
  level: Level;
  /** Match time in seconds; negative during the countdown. */
  time: number;
  /** This client's own running clock, for timing what arrives over the network. */
  clock: number;
  fighters: Fighter[];
  /** The egg this client plays, or -1. */
  me: number;
  bullets: Bullet[];
  tosses: Toss[];
  zones: Zone[];
  loot: Map<number, LootItem>;
  walls: Map<number, Wall>;
  /** Loot and walls already gone, so news that arrives late can't bring them back. */
  gone: Set<number>;
  goneWalls: Set<number>;
  opened: boolean[];
  /** What crates and barrels have left before they break. */
  crateHp: number[];
  storm: StormNow;
  events: Ev[];
  rng: Rng;
  ended: boolean;
  winner: number;
};

export type Entrant = { name: string; color: string; kind: Kind; seat: number };

export const FIGHTER_COLORS = [
  '#e53935',
  '#1e88e5',
  '#3fae4a',
  '#fdd835',
  '#8e24aa',
  '#fb8c00',
  '#ec407a',
  '#00acc1',
  '#6d4c41',
  '#c0ca33',
  '#3949ab',
  '#00897b',
  '#f4511e',
  '#5e35b1',
  '#ffb300',
  '#546e7a',
  '#ad1457',
  '#7cb342',
  '#37474f',
  '#ff8a65',
];
export const BOT_NAMES = [
  'Benedict',
  'Sunny',
  'Omelette',
  'Frittata',
  'Shelly',
  'Quiche',
  'Poach',
  'Eggbert',
  'Yolko',
  'Deviled',
  'Huevo',
  'Florentine',
  'Shakshuka',
  'Tamago',
  'Scrambles',
  'Hardboil',
  'Overeasy',
  'Coddle',
  'Souffle',
  'Custard',
  'Meringue',
  'Nog',
  'Albumen',
  'Crepe',
  'Hollandaise',
  'Bennie',
];

/** Computer player names for a match, the same on every client for a seed. */
export function botNames(seed: number): string[] {
  const rng = rng32(seed ^ 0x5eed);
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names;
}

/**
 * How sharp the computer players are. `toss` is the seconds between throws (0: never); `build` between walls. `far` is
 * how much wider the aim gets for every 10 meters past 20, and `settle` the seconds a scoped shot waits for a steady aim.
 */
type LevelSpec = { err: number; react: number; turn: number; sight: number; lead: number; burst: number; rest: number; build: number; heal: number; toss: number; far: number; settle: number };
export const LEVEL_SPECS: Record<Level, LevelSpec> = {
  easy: { err: 0.2, react: 0.85, turn: 3.2, sight: 32, lead: 0, burst: 0.45, rest: 0.6, build: 0, heal: 45, toss: 22, far: 0.5, settle: 1.1 },
  normal: { err: 0.11, react: 0.5, turn: 6, sight: 42, lead: 0.5, burst: 0.8, rest: 0.35, build: 12, heal: 60, toss: 11, far: 0.35, settle: 0.7 },
  hard: { err: 0.055, react: 0.28, turn: 9, sight: 52, lead: 1, burst: 1.4, rest: 0.2, build: 5, heal: 70, toss: 6, far: 0.15, settle: 0.4 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** The signed difference between two angles, in -PI..PI. */
export const angleDiff = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const alive = (f: Fighter) => f.phase !== 'out';
/** On the ground and in the fight: the only eggs that can be hit. */
export const fighting = (f: Fighter) => f.phase === 'ground';
export const owned = (f: Fighter) => f.kind !== 'remote';
export const aliveCount = (m: Match) => m.fighters.reduce((n, f) => n + (alive(f) ? 1 : 0), 0);
const none = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

function newFighter(id: number, e: Entrant, x: number, z: number): Fighter {
  return {
    id,
    seat: e.seat,
    name: e.name,
    color: e.color,
    kind: e.kind,
    phase: 'bus',
    x,
    z,
    y: BUS_Y,
    vx: 0,
    vz: 0,
    aim: 0,
    hp: HP_MAX,
    shield: 0,
    guns: [null, null],
    melee: 'spatula',
    throws: none(THROW_IDS),
    pick: 'grenade',
    slot: SLOT_MELEE,
    ammo: { light: 0, heavy: 0, shells: 0, rockets: 0 },
    items: { bandage: 0, medkit: 0, mini: 0, shield: 0, coffee: 0 },
    boost: 0,
    scope: 0,
    pack: 0,
    wood: 30,
    fireT: 0,
    burst: 0,
    burstT: 0,
    reloadT: 0,
    reloadSlot: -1,
    using: null,
    useT: 0,
    buildT: 0,
    stormT: 0,
    burnT: 0,
    hitT: 0,
    lastBy: -1,
    lastByAt: -99,
    firedAt: -99,
    kills: 0,
    dealt: 0,
    place: 0,
    by: -1,
    outCause: null,
    outAt: 0,
    bush: -1,
    inside: -1,
    wet: false,
    warm: false,
    dropAt: 0,
    flingX: 0,
    flingZ: 0,
    input: noInput(),
    ai: null,
    snaps: [],
    show: { w: null, r: 0, flags: 0 },
    pending: new Map(),
    wallSeq: 0,
    dropSeq: 0,
    outSeen: -1,
  };
}

function newAi(m: Match, f: Fighter): Ai {
  const rng = m.rng;
  const bus = m.map.bus;
  // aim for a building or loot spot near the bus route and jump about when the bus passes it
  const spots = [...m.map.buildings.map((b) => ({ x: b.x, z: b.z })), ...m.map.floor.map((s) => ({ x: s.x, z: s.z }))];
  const dx = bus.x1 - bus.x0;
  const dz = bus.z1 - bus.z0;
  const along = (p: { x: number; z: number }) => clamp(((p.x - bus.x0) * dx + (p.z - bus.z0) * dz) / (bus.len * bus.len), 0.08, 0.92);
  const off = (p: { x: number; z: number }) => {
    const u = along(p);
    return Math.hypot(bus.x0 + dx * u - p.x, bus.z0 + dz * u - p.z);
  };
  const near = spots.filter((p) => off(p) < 80);
  const pick = (near.length ? near : spots)[Math.floor(rng() * (near.length || spots.length))] ?? { x: 0, z: 0 };
  const jumpAt = clamp(along(pick) * bus.dur - off(pick) / GLIDE - 0.5 + rng() * 1.5, bus.on + rng() * 0.6, bus.off - 0.05);
  return {
    goal: 'drop',
    gx: pick.x + (rng() * 2 - 1) * 3,
    gz: pick.z + (rng() * 2 - 1) * 3,
    item: -1,
    chest: -1,
    pad: -1,
    bridge: -1,
    until: 0,
    tried: -1,
    target: -1,
    react: 0,
    strafe: rng() < 0.5 ? 1 : -1,
    strafeT: 0,
    think: 0,
    jumpAt,
    stuckT: 0,
    lastX: f.x,
    lastZ: f.z,
    detourT: 0,
    detourA: 0,
    smashT: 0,
    smashA: 0,
    exit: null,
    inward: false,
    err: 0,
    errT: 0,
    steady: 0,
    burst: 0,
    rest: 0,
    buildCool: 0,
    swapCool: 0,
    toss: null,
    tossD: 0,
    tossT: 0,
    tossHad: 0,
    tossCool: 4 + rng() * 6,
  };
}

/**
 * A new match. Fighter ids are entrant indices. `me` is the egg this client plays (-1 to only watch). Remote eggs
 * are moved by the network; computer players by this client.
 */
export function createMatch(opts: { seed: number; role: Role; level: Level; entrants: Entrant[]; me: number; countdown?: number; map?: GameMap }): Match {
  const map = opts.map ?? generateMap(opts.seed);
  const start = busAt(map.bus, 0);
  const m: Match = {
    map,
    seed: opts.seed,
    role: opts.role,
    world: opts.role !== 'guest',
    level: opts.level,
    time: -(opts.countdown ?? COUNTDOWN),
    clock: 0,
    fighters: [],
    me: opts.me,
    bullets: [],
    tosses: [],
    zones: [],
    loot: new Map(map.floor.map((s) => [s.id, { id: s.id, def: s.def, x: s.x, z: s.z, by: -1, at: 0 }])),
    walls: new Map(),
    gone: new Set(),
    goneWalls: new Set(),
    opened: map.containers.map(() => false),
    crateHp: map.containers.map((c) => (c.kind === 'barrel' ? BARREL.hp : c.kind === 'toilet' ? TOILET_HP : c.kind === 'hay' ? HAY_HP : CRATE_HP)),
    storm: stormAt(map.storm, 0),
    events: [],
    rng: rng32((opts.seed * 31 + 7 + Math.max(0, opts.me)) >>> 0),
    ended: false,
    winner: -1,
  };
  opts.entrants.slice(0, MAX_FIGHTERS).forEach((e, i) => {
    const f = newFighter(i, e, start.x, start.z);
    m.fighters.push(f);
    if (e.kind === 'bot') f.ai = newAi(m, f);
  });
  return m;
}

/** Lets the computer play an egg this client owns (tests use it to stand in for people). */
export function autopilot(m: Match, f: Fighter) {
  f.ai = newAi(m, f);
}

/** A solo match: you and nineteen computer players. */
export function soloMatch(seed: number, level: Level, name = 'you', color = FIGHTER_COLORS[0]): Match {
  const bots = botNames(seed);
  const entrants: Entrant[] = [{ name, color, kind: 'player', seat: -1 }];
  for (let i = 1; i < MAX_FIGHTERS; i++) entrants.push({ name: bots[i - 1], color: FIGHTER_COLORS[i], kind: 'bot', seat: -1 });
  return createMatch({ seed, role: 'solo', level, entrants, me: 0 });
}

const emit = (m: Match, e: Ev) => {
  m.events.push(e);
};

/** What an egg holds: a gun, a throwable, or its melee weapon. Remote eggs show what their owner reported. */
export function held(f: Fighter): { w: Held; r: number } {
  if (f.kind === 'remote') return { w: f.show.w ?? 'spatula', r: f.show.r };
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (g) return { w: g.w, r: g.r };
  if (f.slot === SLOT_THROW && f.throws[f.pick] > 0) return { w: f.pick, r: 0 };
  return { w: f.melee, r: 0 };
}

/** The gun an egg holds, if it holds one. */
export function heldGun(f: Fighter): WeaponId | null {
  const w = held(f).w;
  return isWeapon(w) ? w : null;
}

/** Meters of view past the usual: the better of the scope and the gun in hand. */
export function viewOf(f: Fighter) {
  const g = heldGun(f);
  return Math.max(SCOPE_VIEW[clamp(f.scope, 0, 3)] ?? 0, g ? WEAPONS[g].zoom : 0);
}

/** Is a crate, barrel, chest or supply drop there to bump into right now? */
export function standing(m: Match, s: Solid) {
  if (s.what === 'crate' || s.what === 'barrel') return !m.opened[s.ref];
  if (s.what === 'chest') return landed(m, m.map.containers[s.ref]);
  return true;
}

/** A supply drop is down once its time comes; everything else always is. */
export const landed = (m: Match, c: Container | undefined) => !!c && (c.kind !== 'supply' || m.time >= c.at);
/** Chests, fridges and landed supply drops open with the interact key. */
export const openable = (m: Match, c: Container | undefined) => !!c && (c.kind === 'chest' || c.kind === 'supply' || c.kind === 'fridge') && landed(m, c) && !m.opened[c.id];
/** Crates, toilets, hay bales and barrels break when hit. */
export const breakable = (c: Container | undefined) => !!c && (c.kind === 'crate' || c.kind === 'barrel' || c.kind === 'toilet' || c.kind === 'hay');

// -------------------------------------------------------------------------------------------------------------------
// The frame.

export function step(m: Match, dt: number) {
  const before = m.time;
  m.time += dt;
  m.clock += dt;
  if (before < 0) {
    // a beep as each number comes up, the first one too when the countdown starts right on it
    for (let k = COUNTDOWN; k >= 1; k--) if (before <= -k && m.time > -k) emit(m, { t: 'beep' });
    if (m.time >= 0) emit(m, { t: 'go' });
  }
  const prev = m.storm;
  m.storm = stormAt(m.map.storm, Math.max(0, m.time));
  if (m.storm.phase !== prev.phase || m.storm.shrinking !== prev.shrinking) emit(m, { t: 'storm', phase: m.storm.phase, shrinking: m.storm.shrinking });
  for (const c of m.map.drops) {
    const at = m.map.containers[c].at - SUPPLY_FALL;
    if (before < at && m.time >= at) emit(m, { t: 'supply', c });
  }

  for (const f of m.fighters) {
    if (f.kind === 'remote') {
      follow(m, f);
      continue;
    }
    if (f.phase === 'out') {
      clearOneShots(f.input);
      continue;
    }
    if (f.ai) think(m, f, dt);
    act(m, f, dt);
  }
  moveBullets(m, dt);
  moveTosses(m);
  if (m.zones.length && m.zones.some((z) => z.until <= m.time)) m.zones = m.zones.filter((z) => z.until > m.time);
  if (m.world) settle(m);
}

function clearOneShots(inp: Input) {
  inp.reload = false;
  inp.slot = -1;
  inp.cycle = 0;
  inp.interact = false;
  inp.build = false;
  inp.use = null;
  inp.jump = false;
  inp.pick = null;
}

/** Ends the match once one egg (or none) is left. */
function settle(m: Match) {
  if (m.ended || m.time <= 0 || m.fighters.length < 2) return;
  const left = m.fighters.filter(alive);
  if (left.length > 1) return;
  m.ended = true;
  m.winner = left[0]?.id ?? -1;
  if (left[0]) left[0].place = 1;
  emit(m, { t: 'end', winner: m.winner });
}

/** Ends an online match on the host's word. */
export function endMatch(m: Match, winner: number, places: [number, number, number][] = []) {
  for (const [fid, place, kills] of places) {
    const f = m.fighters[fid];
    if (!f) continue;
    f.place = place;
    f.kills = kills;
    // the host's word is final, even if the news of how an egg went out is still on its way
    if (fid !== winner && f.phase !== 'out') {
      f.phase = 'out';
      f.outAt = m.time;
    }
  }
  // and the winner stands, even if a last hit that came too late for the host cracked it here (a trade at the end)
  const w = m.fighters[winner];
  if (w && w.phase === 'out') {
    w.phase = 'ground';
    w.hp = Math.max(1, w.hp);
    w.place = 1;
    w.by = -1;
    w.outCause = null;
  }
  m.ended = true;
  m.winner = winner;
  m.events.push({ t: 'end', winner, net: true });
}

/** Which slots an egg can hold right now. */
const usable = (f: Fighter, slot: number) => (slot < 2 ? !!f.guns[slot] : slot === SLOT_MELEE ? true : slot === SLOT_THROW ? THROW_IDS.some((k) => f.throws[k] > 0) : false);

function act(m: Match, f: Fighter, dt: number) {
  const inp = f.input;
  if (f.phase === 'bus') {
    const p = busAt(m.map.bus, m.time);
    f.x = p.x;
    f.z = p.z;
    f.y = BUS_Y;
    // the door opens over land, and anyone still aboard is put off before the bus leaves it
    if ((inp.jump && m.time >= m.map.bus.on) || m.time >= m.map.bus.off) {
      f.phase = 'drop';
      f.y = BUS_Y - 1.5;
      f.vx = 0;
      f.vz = 0;
      f.flingX = 0;
      f.flingZ = 0;
      f.dropAt = m.time;
      emit(m, { t: 'jump', f: f.id });
    }
    clearOneShots(inp);
    return;
  }
  if (f.phase === 'drop') {
    const len = Math.hypot(inp.mx, inp.mz);
    const k = 1 - Math.exp(-5 * dt);
    f.vx += ((len > 0 ? (inp.mx / Math.max(1, len)) * GLIDE : f.flingX * GLIDE) - f.vx) * k;
    f.vz += ((len > 0 ? (inp.mz / Math.max(1, len)) * GLIDE : f.flingZ * GLIDE) - f.vz) * k;
    f.x = clamp(f.x + f.vx * dt, -EDGE, EDGE);
    f.z = clamp(f.z + f.vz * dt, -EDGE, EDGE);
    f.y -= FALL * dt;
    if (len > 0.1) f.aim = Math.atan2(inp.mx, inp.mz);
    if (f.y <= 0) {
      f.y = 0;
      f.phase = 'ground';
      f.vx *= 0.3;
      f.vz *= 0.3;
      resolve(m, f);
      emit(m, { t: 'land', f: f.id });
    }
    clearOneShots(inp);
    return;
  }

  // on the ground
  f.fireT = Math.max(0, f.fireT - dt);
  f.buildT = Math.max(0, f.buildT - dt);
  f.hitT = Math.max(0, f.hitT - dt);
  f.aim = inp.aim;
  if (!usable(f, f.slot)) f.slot = SLOT_MELEE;

  if (inp.pick && f.throws[inp.pick] > 0) {
    f.pick = inp.pick;
    switchTo(f, SLOT_THROW);
  } else if (inp.slot === SLOT_THROW && f.slot === SLOT_THROW) {
    // the throw key again: the next kind we carry
    const at = THROW_IDS.indexOf(f.pick);
    for (let i = 1; i < THROW_IDS.length; i++) {
      const k = THROW_IDS[(at + i) % THROW_IDS.length];
      if (f.throws[k] > 0) {
        f.pick = k;
        f.fireT = Math.max(f.fireT, 0.18);
        break;
      }
    }
  } else if (inp.slot >= 0 && inp.slot <= SLOT_THROW && inp.slot !== f.slot && usable(f, inp.slot)) switchTo(f, inp.slot);
  if (inp.cycle) {
    const order = [0, 1, SLOT_MELEE, SLOT_THROW].filter((s) => usable(f, s));
    const at = order.indexOf(f.slot);
    switchTo(f, order[(at + (inp.cycle > 0 ? 1 : -1) + order.length) % order.length]);
  }
  if (f.slot === SLOT_THROW && f.throws[f.pick] <= 0) {
    const next = THROW_IDS.find((k) => f.throws[k] > 0);
    if (next) f.pick = next;
  }
  if (f.burst > 0) continueBurst(m, f, dt);
  if (f.reloadT > 0) {
    f.reloadT -= dt;
    if (f.reloadSlot !== f.slot) f.reloadT = 0;
    else if (f.reloadT <= 0) finishReload(m, f);
  }
  if (f.using) {
    f.useT -= dt;
    if (f.useT <= 0) finishUse(m, f);
  }
  if (inp.reload) startReload(m, f);
  if (inp.use) {
    const what = inp.use === 'bestHeal' ? bestUse(f, 'heal') : inp.use === 'bestShield' ? bestUse(f, 'shield') : inp.use;
    if (what) startUse(m, f, what);
  }
  if (inp.build) build(m, f);
  if (inp.interact) interact(m, f);
  if (inp.fire && f.fireT <= 0 && f.burst <= 0) trigger(m, f);

  // walking: slow through a pond or the river, a little quicker on a road
  f.wet = waterAt(m.map, f.x, f.z);
  const speed = SPEED * paceOf(f) * (f.using ? 0.5 : 1) * (f.boost > 0 ? BOOST.speed : 1) * (f.wet ? POND_SLOW : roadAt(m.map, f.x, f.z) ? ROAD_SPEED : 1);
  const len = Math.hypot(inp.mx, inp.mz);
  const tx = len > 0 ? (inp.mx / Math.max(1, len)) * speed : 0;
  const tz = len > 0 ? (inp.mz / Math.max(1, len)) * speed : 0;
  const k = 1 - Math.exp(-14 * dt);
  f.vx += (tx - f.vx) * k;
  f.vz += (tz - f.vz) * k;
  const ox = f.x;
  const oz = f.z;
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  resolve(m, f);
  // what we bumped into slows us, so we don't keep pushing at a wall
  if (dt > 0) {
    f.vx = (f.x - ox) / dt;
    f.vz = (f.z - oz) / dt;
  }

  autoPickup(m, f);

  // a bounce pad throws us up for a glide, off the way its arrows point
  const pad = padAt(m.map, f.x, f.z);
  if (pad >= 0) {
    const p = m.map.pads[pad];
    f.phase = 'drop';
    f.y = PAD.y;
    f.dropAt = m.time;
    f.flingX = p.dx;
    f.flingZ = p.dz;
    f.vx = p.dx * GLIDE;
    f.vz = p.dz * GLIDE;
    f.using = null;
    f.useT = 0;
    f.reloadT = 0;
    f.burst = 0;
    f.stormT = 0;
    f.burnT = 0;
    f.bush = -1;
    f.inside = -1;
    f.wet = false;
    f.warm = false;
    emit(m, { t: 'bounce', f: f.id });
    clearOneShots(inp);
    return;
  }

  if (f.boost > 0) {
    f.hp = Math.min(HP_MAX, f.hp + BOOST.heal * Math.min(dt, f.boost / BOOST.drain));
    f.boost = Math.max(0, f.boost - BOOST.drain * dt);
  }
  // a campfire warms you back up, slowly
  f.warm = fireAt(m.map, f.x, f.z) >= 0;
  if (f.warm && f.hp < HP_MAX) f.hp = Math.min(HP_MAX, f.hp + CAMP.hps * dt);

  const s = m.storm;
  const sx = f.x - s.x;
  const sz = f.z - s.z;
  if (s.dps > 0 && sx * sx + sz * sz > s.r * s.r) {
    f.stormT += dt;
    while (f.stormT >= STORM_TICK && f.phase === 'ground') {
      f.stormT -= STORM_TICK;
      hurt(m, f, s.dps * STORM_TICK, -1, 'storm', true);
    }
  } else f.stormT = 0;

  const burn = zoneAt(m, 'sauce', f.x, f.z);
  if (burn) {
    f.burnT += dt;
    while (f.burnT >= STORM_TICK && f.phase === 'ground') {
      f.burnT -= STORM_TICK;
      hurt(m, f, (THROWS.sauce.dps ?? 0) * STORM_TICK, burn.by, 'sauce', false);
    }
  } else f.burnT = 0;

  f.bush = coverAt(m.map, f.x, f.z);
  f.inside = buildingAt(m.map, f.x, f.z);
  clearOneShots(inp);
}

/** How quick an egg is on its feet with what it holds. */
function paceOf(f: Fighter) {
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (g) return WEAPONS[g.w].move;
  if (f.slot === SLOT_MELEE) return MELEE[f.melee].move;
  return 1.04;
}

function switchTo(f: Fighter, slot: number) {
  if (slot === f.slot) return;
  f.slot = slot;
  f.reloadT = 0;
  f.burst = 0;
  f.using = null;
  f.useT = 0;
  f.fireT = Math.max(f.fireT, 0.18);
}

/** Pushes an egg out of everything solid and keeps it on the island. */
function resolve(m: Match, f: Fighter) {
  for (let pass = 0; pass < 2; pass++) {
    solidsNear(m.map, f.x, f.z, FIGHTER_R + 2.5, (_i, s) => {
      if (!standing(m, s)) return;
      const p = s.shape === 'circle' ? pushCircle(f.x, f.z, FIGHTER_R, s.x, s.z, s.r) : pushBox(f.x, f.z, FIGHTER_R, s.x, s.z, s.hw, s.hd);
      if (p) {
        f.x += p.x;
        f.z += p.z;
      }
    });
    for (const w of m.walls.values()) {
      if (Math.abs(w.x - f.x) > 3 || Math.abs(w.z - f.z) > 3) continue;
      const p = pushObb(f.x, f.z, FIGHTER_R, w);
      if (p) {
        f.x += p.x;
        f.z += p.z;
      }
    }
    for (const o of m.fighters) {
      if (o === f || !fighting(o)) continue;
      const p = pushCircle(f.x, f.z, FIGHTER_R, o.x, o.z, FIGHTER_R);
      if (p) {
        f.x += p.x * 0.5;
        f.z += p.z * 0.5;
      }
    }
    f.x = clamp(f.x, -EDGE, EDGE);
    f.z = clamp(f.z, -EDGE, EDGE);
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Weapons.

function trigger(m: Match, f: Fighter) {
  if (f.using) {
    f.using = null;
    f.useT = 0;
  }
  if (f.slot === SLOT_MELEE) return swing(m, f);
  if (f.slot === SLOT_THROW) return toss(m, f);
  const g = f.guns[f.slot];
  if (!g || f.reloadT > 0) return;
  const spec = WEAPONS[g.w];
  if (g.mag <= 0) {
    if (f.ammo[spec.ammo] > 0) startReload(m, f);
    else {
      f.fireT = 0.35;
      emit(m, { t: 'empty', f: f.id });
    }
    return;
  }
  f.fireT = 1 / spec.rate;
  if (spec.burst) {
    f.burst = spec.burst.n - 1;
    f.burstT = spec.burst.gap;
  }
  shoot(m, f, g);
}

/** The rest of a burst, a shot every gap, until it's done or the magazine is. */
function continueBurst(m: Match, f: Fighter, dt: number) {
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  const gap = g ? WEAPONS[g.w].burst?.gap : undefined;
  if (!g || !gap || f.reloadT > 0 || g.mag <= 0) {
    f.burst = 0;
    return;
  }
  f.burstT -= dt;
  while (f.burst > 0 && f.burstT <= 0 && g.mag > 0) {
    f.burst--;
    f.burstT += gap;
    shoot(m, f, g);
  }
}

/** One shot from the gun in hand. */
function shoot(m: Match, f: Fighter, g: Gun) {
  const spec = WEAPONS[g.w];
  g.mag--;
  if (!spec.silent) f.firedAt = m.clock;
  const moving = clamp(Math.hypot(f.vx, f.vz) / SPEED, 0, 1);
  const k = r2(1 + moving * 0.6);
  const s = Math.floor(m.rng() * 0x7fffffff);
  const a = r2(f.aim);
  const x = r2(f.x);
  const z = r2(f.z);
  fire(m, f.id, g.w, g.r, x, z, a, s, k, true);
  emit(m, { t: 'shot', f: f.id, w: g.w, r: g.r, x, z, a, s, k });
  if (g.mag <= 0) {
    f.burst = 0;
    if (f.ammo[spec.ammo] > 0) {
      // reload as soon as the last shot is away
      f.reloadT = reloadOf(g.w, g.r) + f.fireT * 0.5;
      f.reloadSlot = f.slot;
      emit(m, { t: 'reload', f: f.id });
    }
  }
}

/** Puts a shot's bullets in the air. The same seed gives the same pellets on every client. */
export function fire(m: Match, fid: number, w: WeaponId, r: number, x: number, z: number, a: number, seed: number, k: number, local: boolean) {
  const spec = WEAPONS[w];
  const rng = rng32(seed);
  const dmg = damageOf(w, r);
  for (let p = 0; p < spec.pellets; p++) {
    // pellets spread evenly across the cone, each jittered a little
    const u = spec.pellets > 1 ? ((p + rng()) / spec.pellets) * 2 - 1 : rng() * 2 - 1;
    const ang = a + u * spec.spread * k;
    m.bullets.push({ f: fid, w, r, x, z, dx: Math.sin(ang), dz: Math.cos(ang), speed: spec.speed * (spec.pellets > 1 ? 0.92 + rng() * 0.16 : 1), left: spec.range, traveled: 0, dmg, local });
  }
  if (m.bullets.length > 900) m.bullets.splice(0, m.bullets.length - 900);
}

function startReload(m: Match, f: Fighter) {
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (!g || f.reloadT > 0) return;
  const spec = WEAPONS[g.w];
  if (g.mag >= spec.mag || f.ammo[spec.ammo] <= 0) return;
  f.using = null;
  f.useT = 0;
  f.burst = 0;
  f.reloadT = reloadOf(g.w, g.r);
  f.reloadSlot = f.slot;
  emit(m, { t: 'reload', f: f.id });
}

function finishReload(m: Match, f: Fighter) {
  f.reloadT = 0;
  const g = f.guns[f.reloadSlot];
  if (!g) return;
  const spec = WEAPONS[g.w];
  const n = Math.min(spec.mag - g.mag, f.ammo[spec.ammo]);
  g.mag += n;
  f.ammo[spec.ammo] -= n;
  emit(m, { t: 'reloaded', f: f.id });
}

/** Would this consumable do anything right now? */
export function canUse(f: Fighter, w: UseId) {
  const u = USES[w];
  if (u.hp) return f.hp < (u.hpCap ?? HP_MAX);
  if (u.shield) return f.shield < (u.shieldCap ?? SHIELD_MAX);
  return f.boost < BOOST.max - 1;
}

/** The consumable to reach for: for health a medkit when badly hurt, else bandages; for shield the minis first. */
export function bestUse(f: Fighter, kind: 'heal' | 'shield'): UseId | null {
  const order: UseId[] = kind === 'heal' ? (f.hp < 60 ? ['medkit', 'bandage'] : ['bandage', 'medkit']) : ['mini', 'shield'];
  return order.find((w) => f.items[w] > 0 && canUse(f, w)) ?? null;
}

function startUse(m: Match, f: Fighter, what: UseId) {
  if (f.using === what || f.items[what] <= 0 || !canUse(f, what)) return;
  f.using = what;
  f.useT = USES[what].time;
  f.reloadT = 0;
  f.burst = 0;
  emit(m, { t: 'use', f: f.id, what });
}

function finishUse(m: Match, f: Fighter) {
  const what = f.using;
  f.using = null;
  f.useT = 0;
  if (!what || f.items[what] <= 0) return;
  const u = USES[what];
  f.items[what]--;
  if (u.hp) f.hp = Math.max(f.hp, Math.min(u.hpCap ?? HP_MAX, f.hp + u.hp));
  if (u.shield) f.shield = Math.max(f.shield, Math.min(u.shieldCap ?? SHIELD_MAX, f.shield + u.shield));
  if (u.boost) f.boost = Math.min(BOOST.max, f.boost + u.boost);
  emit(m, { t: 'used', f: f.id, what });
}

function swing(m: Match, f: Fighter) {
  const spec = MELEE[f.melee];
  f.fireT = 1 / spec.rate;
  f.firedAt = m.clock;
  emit(m, { t: 'swing', f: f.id });
  // an egg in front of us first
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const o of m.fighters) {
    if (o === f || !fighting(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d > spec.range + FIGHTER_R || d >= bestD) continue;
    if (Math.abs(angleDiff(Math.atan2(o.x - f.x, o.z - f.z), f.aim)) > spec.arc) continue;
    best = o;
    bestD = d;
  }
  if (best) return strike(m, f, best, spec.dmg, f.melee, best.x, best.z);
  // then a wall, crate, barrel, tree or fallen log just ahead (a fence or a table too, for the bonk)
  const fx = Math.sin(f.aim);
  const fz = Math.cos(f.aim);
  const hit = castRay(m, f.x, f.z, fx, fz, spec.range, -1, false, true);
  if (!hit) return;
  const x = f.x + fx * hit.t;
  const z = f.z + fz * hit.t;
  if (hit.what === 'tree' || hit.what === 'log') {
    const n = Math.min(spec.wood, WOOD_MAX - f.wood);
    f.wood += n;
    emit(m, { t: 'harvest', f: f.id, x, z, n });
  } else if (hit.what === 'crate' || hit.what === 'barrel') smashCrate(m, f, hit.ref, spec.dmg * spec.wallMult, x, z);
  else if (hit.what === 'built') smashWall(m, f, hit.ref, spec.dmg * spec.wallMult, x, z);
  else emit(m, { t: 'thud', x, z, what: hit.what });
}

/** A hit on an egg from something this client fired: applied here if we own the egg, else sent to its owner. */
function strike(m: Match, from: Fighter, o: Fighter, dmg: number, w: Cause, x: number, z: number) {
  const d = Math.max(1, Math.round(dmg));
  const shield = o.kind === 'remote' ? (o.show.flags & F_SHIELDED) !== 0 : o.shield > 0;
  if (o.kind === 'remote') {
    from.dealt += d;
    emit(m, { t: 'hit', f: from.id, to: o.id, d, w, x: r2(x), z: r2(z), shield, local: false });
    return;
  }
  const took = hurt(m, o, d, from.id, w, false);
  if (took > 0) from.dealt += took;
  emit(m, { t: 'hit', f: from.id, to: o.id, d, w, x: r2(x), z: r2(z), shield, local: true });
}

/**
 * Does a frying pan stop a bullet flying along (dx, dz) into this egg? It covers the front while held and the back
 * while it hangs there.
 */
export function panBlocks(f: Fighter, dx: number, dz: number) {
  const carries = f.kind === 'remote' ? (f.show.flags & F_PAN) !== 0 : MELEE[f.melee].blocks === true;
  if (!carries) return false;
  const inHand = f.kind === 'remote' ? f.show.w === 'pan' : f.slot === SLOT_MELEE;
  // positive when the bullet flies against the way the egg faces, into its front
  const front = -(dx * Math.sin(f.aim) + dz * Math.cos(f.aim));
  return (inHand ? front : -front) > Math.cos(PAN_ARC);
}

/**
 * Damage to an egg this client owns. Shields soak it first, except the storm's. Returns how much landed. Only eggs on
 * the ground can be hurt, and nobody once the match is over.
 */
export function hurt(m: Match, f: Fighter, d: number, by: number, w: Cause, storm: boolean) {
  if (m.ended || !owned(f) || f.phase !== 'ground' || !(d > 0)) return 0;
  let left = d;
  const fromShield = storm ? 0 : Math.min(f.shield, left);
  f.shield -= fromShield;
  left -= fromShield;
  const fromHp = Math.min(f.hp, left);
  f.hp -= fromHp;
  f.hitT = 0.25;
  if (by >= 0 && by !== f.id) {
    f.lastBy = by;
    f.lastByAt = m.clock;
  }
  emit(m, { t: 'hurt', f: f.id, d: fromShield + fromHp, by, storm, shield: fromShield > 0 });
  if (f.hp <= 0.001) crack(m, f, by, w);
  return fromShield + fromHp;
}

/** An egg this client owns is out: everything it carried spills on the ground. */
function crack(m: Match, f: Fighter, by: number, w: Cause) {
  const place = aliveCount(m);
  f.phase = 'out';
  f.hp = 0;
  f.shield = 0;
  f.boost = 0;
  f.place = place;
  f.by = by;
  f.outCause = w;
  f.outAt = m.time;
  f.using = null;
  f.reloadT = 0;
  f.burst = 0;
  const killer = by >= 0 && by !== f.id ? m.fighters[by] : undefined;
  if (killer) killer.kills++;
  const spill: LootDef[] = [];
  for (const g of f.guns) if (g) spill.push({ kind: 'gun', w: g.w, r: g.r, mag: g.mag });
  if (f.melee !== 'spatula') spill.push({ kind: 'melee', w: f.melee });
  for (const a of Object.keys(f.ammo) as Ammo[]) if (f.ammo[a] > 0) spill.push({ kind: 'ammo', a, n: f.ammo[a] });
  for (const u of Object.keys(f.items) as UseId[]) if (f.items[u] > 0) spill.push({ kind: 'use', w: u, n: f.items[u] });
  for (const k of THROW_IDS) if (f.throws[k] > 0) spill.push({ kind: 'throw', w: k, n: f.throws[k] });
  if (f.scope > 0) spill.push({ kind: 'scope', lv: f.scope });
  if (f.pack > 0) spill.push({ kind: 'pack', lv: f.pack });
  if (f.wood >= 10) spill.push({ kind: 'wood', n: Math.floor(f.wood / 2) });
  f.guns = [null, null];
  f.melee = 'spatula';
  f.ammo = { light: 0, heavy: 0, shells: 0, rockets: 0 };
  f.items = { bandage: 0, medkit: 0, mini: 0, shield: 0, coffee: 0 };
  f.throws = none(THROW_IDS);
  f.scope = 0;
  f.pack = 0;
  f.wood = 0;
  const rad = spill.length > 1 ? 1 + spill.length * 0.07 : 0;
  spill.forEach((def, i) => {
    const a = (i / spill.length) * Math.PI * 2;
    dropItem(m, f, def, clamp(f.x + Math.sin(a) * rad, -EDGE, EDGE), clamp(f.z + Math.cos(a) * rad, -EDGE, EDGE));
  });
  emit(m, { t: 'out', f: f.id, by, w, place });
}

/** An egg another client owns is out, on its owner's word (or ours, on the host's word that it took us out). */
export function applyOut(m: Match, fid: number, by: number, w: Cause) {
  const f = m.fighters[fid];
  if (!f || f.phase === 'out' || m.ended) return;
  const place = aliveCount(m);
  f.phase = 'out';
  f.place = place;
  f.by = by;
  f.outCause = w;
  f.outAt = m.time;
  const killer = by >= 0 && by !== fid ? m.fighters[by] : undefined;
  if (killer) killer.kills++;
  emit(m, { t: 'out', f: fid, by, w, place, net: true });
}

/** A person left an online match: the host takes their egg out. */
export function forfeit(m: Match, fid: number) {
  const f = m.fighters[fid];
  if (!f || f.phase === 'out' || m.ended) return;
  const place = aliveCount(m);
  f.phase = 'out';
  f.place = place;
  f.by = -1;
  f.outCause = 'left';
  f.outAt = m.time;
  emit(m, { t: 'out', f: fid, by: -1, w: 'left', place });
}

type RayHit = { t: number; what: Thud; ref: number; fighter: Fighter | null };

/**
 * The first thing a ray meets within `len`: trees, rocks, building walls, cars, posts, crates and barrels still
 * standing, chests, landed supply drops, built walls, and (when `eggs`) any egg in the fight except `skip`. Low
 * things (fences, tables, fire pits) only count when `lows`: bullets and eyes go over them, feet and swings don't.
 */
export function castRay(m: Match, x: number, z: number, dx: number, dz: number, len: number, skip: number, eggs: boolean, lows = false): RayHit | null {
  let best = null as RayHit | null;
  solidsAlong(m.map, x, z, x + dx * len, z + dz * len, (_i, s) => {
    if (!standing(m, s) || (!lows && low(s))) return;
    const t = raySolid(s, x, z, dx, dz, len);
    if (t < (best?.t ?? Infinity)) best = { t, what: s.what, ref: s.ref, fighter: null };
  });
  for (const w of m.walls.values()) {
    // a cheap reach test before the exact one
    const ex = w.x - x;
    const ez = w.z - z;
    const along = ex * dx + ez * dz;
    if (along < -WALL_HALF - 1 || along > len + WALL_HALF + 1) continue;
    if (Math.abs(ex * dz - ez * dx) > WALL_HALF + 1) continue;
    const t = rayObb(x, z, dx, dz, len, w);
    if (t < (best?.t ?? Infinity)) best = { t, what: 'built', ref: w.id, fighter: null };
  }
  if (eggs) {
    for (const o of m.fighters) {
      if (o.id === skip || !fighting(o)) continue;
      const t = rayCircle(x, z, dx, dz, len, o.x, o.z, HIT_R);
      if (t < (best?.t ?? Infinity)) best = { t, what: 'egg', ref: o.id, fighter: o };
    }
  }
  return best;
}

/** True when nothing solid stands between two points. */
export function clearLine(m: Match, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 1e-6) return true;
  return castRay(m, x0, z0, (x1 - x0) / len, (z1 - z0) / len, len, -1, false) === null;
}

const falloff = (w: WeaponId, dist: number) => {
  const f = WEAPONS[w].falloff;
  if (!f || dist <= f.near) return 1;
  return Math.max(f.min, 1 - ((dist - f.near) / (f.far - f.near)) * (1 - f.min));
};

function moveBullets(m: Match, dt: number) {
  const keep: Bullet[] = [];
  for (const b of m.bullets) {
    const reach = Math.min(b.speed * dt, b.left);
    const hit = castRay(m, b.x, b.z, b.dx, b.dz, reach, b.f, true);
    if (!hit) {
      b.x += b.dx * reach;
      b.z += b.dz * reach;
      b.left -= reach;
      b.traveled += reach;
      if (b.left > 1e-6) keep.push(b);
      else if (b.w === 'launcher' && b.local) blast(m, b.f, b.x, b.z, WEAPONS.launcher.splash ?? 4, b.dmg, WEAPONS.launcher.wallMult, 'launcher');
      continue;
    }
    const x = b.x + b.dx * hit.t;
    const z = b.z + b.dz * hit.t;
    const pan = !!hit.fighter && b.w !== 'launcher' && panBlocks(hit.fighter, b.dx, b.dz);
    if (!b.local) {
      // someone else's bullet: their client decides what it did, we only draw where it stopped
      if (b.w !== 'launcher') emit(m, { t: 'thud', x, z, what: pan ? 'pan' : hit.what, net: true });
      continue;
    }
    if (b.w === 'launcher') {
      blast(m, b.f, x - b.dx * 0.3, z - b.dz * 0.3, WEAPONS.launcher.splash ?? 4, b.dmg, WEAPONS.launcher.wallMult, 'launcher');
      continue;
    }
    const shooter = m.fighters[b.f];
    const d = b.dmg * falloff(b.w, b.traveled + hit.t);
    if (pan) emit(m, { t: 'thud', x, z, what: 'pan' });
    else if (hit.fighter && shooter) strike(m, shooter, hit.fighter, d, b.w, x, z);
    else if ((hit.what === 'crate' || hit.what === 'barrel') && shooter) smashCrate(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    else if (hit.what === 'built' && shooter) smashWall(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    else emit(m, { t: 'thud', x, z, what: hit.what });
  }
  m.bullets = keep;
}

/**
 * Something this client set off bursts (a launcher egg or a grenade): eggs, walls, crates and barrels nearby take less
 * the farther they are. Never the one who set it off.
 */
function blast(m: Match, fid: number, x: number, z: number, R: number, dmg: number, wallMult: number, cause: Cause) {
  const shooter = m.fighters[fid];
  emit(m, { t: 'boom', f: fid, x: r2(x), z: r2(z) });
  if (!shooter) return;
  for (const o of m.fighters) {
    if (o.id === fid || !fighting(o)) continue;
    const d = Math.max(0, Math.hypot(o.x - x, o.z - z) - HIT_R);
    if (d < R) strike(m, shooter, o, dmg * (1 - (0.6 * d) / R), cause, o.x, o.z);
  }
  for (const w of [...m.walls.values()]) {
    const d = Math.max(0, Math.hypot(w.x - x, w.z - z) - WALL_HALF);
    if (d < R) smashWall(m, shooter, w.id, dmg * wallMult * (1 - (0.6 * d) / R), w.x, w.z);
  }
  for (const c of m.map.containers) {
    if (!breakable(c) || m.opened[c.id]) continue;
    const d = Math.max(0, Math.hypot(c.x - x, c.z - z) - 0.7);
    if (d < R) smashCrate(m, shooter, c.id, dmg * wallMult * (1 - (0.6 * d) / R), c.x, c.z);
  }
}

function smashWall(m: Match, by: Fighter, id: number, dmg: number, x: number, z: number) {
  const w = m.walls.get(id);
  if (!w) return;
  const d = Math.max(1, Math.round(dmg));
  emit(m, { t: 'smash', f: by.id, kind: 'wall', id, d, x: r2(x), z: r2(z) });
  damageWall(m, id, d, true);
}

/** Damage to a crate or barrel from something this client did. */
function smashCrate(m: Match, by: Fighter, c: number, dmg: number, x: number, z: number) {
  if (m.opened[c] || !breakable(m.map.containers[c])) return;
  const d = Math.max(1, Math.round(dmg));
  emit(m, { t: 'smash', f: by.id, kind: 'crate', id: c, d, x: r2(x), z: r2(z) });
  damageCrate(m, c, d, by.id, true);
}

/** Wall damage from anyone. Only the host (or a solo game) knocks a wall down; guests wait to hear it fell. */
export function damageWall(m: Match, id: number, d: number, announce: boolean) {
  const w = m.walls.get(id);
  if (!w) return;
  w.hp -= d;
  if (m.world && w.hp <= 0) removeWall(m, id, announce);
}

export function removeWall(m: Match, id: number, announce: boolean) {
  m.goneWalls.add(id);
  if (!m.walls.delete(id)) return;
  emit(m, announce ? { t: 'wallgone', id } : { t: 'wallgone', id, net: true });
}

/** Crate or barrel damage from anyone. Only the host (or a solo game) breaks one. */
export function damageCrate(m: Match, c: number, d: number, by: number, announce: boolean) {
  if (m.opened[c] || !breakable(m.map.containers[c])) return;
  m.crateHp[c] -= d;
  if (m.world && m.crateHp[c] <= 0) openContainer(m, c, by, announce);
}

/**
 * A crate breaks, a chest or supply drop opens, or a barrel goes up, and any loot spills out. Every client spills the
 * same items with the same ids.
 */
export function openContainer(m: Match, c: number, by: number, announce: boolean) {
  const box = m.map.containers[c];
  if (!box || m.opened[c]) return;
  m.opened[c] = true;
  for (const l of box.loot) if (!m.gone.has(l.id)) m.loot.set(l.id, { id: l.id, def: l.def, x: l.x, z: l.z, by: -1, at: m.time });
  emit(m, announce ? { t: 'opened', c, f: by } : { t: 'opened', c, f: by, net: true });
  if (box.kind === 'barrel') explode(m, box, by);
}

/**
 * A barrel goes up. Every client hurts the eggs it owns; the host also knocks down walls and breaks crates and barrels
 * nearby (which may go up in turn).
 */
function explode(m: Match, box: Container, by: number) {
  const R = BARREL.radius;
  // every client draws its own bang, so it isn't news for the network
  emit(m, { t: 'boom', f: by, x: box.x, z: box.z, net: true });
  for (const o of m.fighters) {
    if (!owned(o) || !fighting(o)) continue;
    const d = Math.max(0, Math.hypot(o.x - box.x, o.z - box.z) - HIT_R);
    if (d < R) hurt(m, o, BARREL.dmg * (1 - (0.6 * d) / R), by, 'barrel', false);
  }
  if (!m.world) return;
  for (const w of [...m.walls.values()]) {
    const d = Math.max(0, Math.hypot(w.x - box.x, w.z - box.z) - WALL_HALF);
    if (d < R) damageWall(m, w.id, Math.round(BARREL.dmg * 2 * (1 - (0.6 * d) / R)), true);
  }
  for (const c of m.map.containers) {
    if (c === box || !breakable(c) || m.opened[c.id]) continue;
    const d = Math.max(0, Math.hypot(c.x - box.x, c.z - box.z) - 0.7);
    if (d < R) damageCrate(m, c.id, Math.round(BARREL.dmg * (1 - (0.6 * d) / R)), by, true);
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Throwing.

/** Throws what's in hand toward where the egg aims, as far as it asked (or the usual distance), short of anything in the way. */
function toss(m: Match, f: Fighter) {
  const k = f.pick;
  if (f.throws[k] <= 0) return;
  const want = f.input.reach > 0 ? f.input.reach : 14;
  const dist = clamp(want, THROW.min, THROW.max);
  const a = r2(f.aim);
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  const x = r2(f.x);
  const z = r2(f.z);
  const hit = castRay(m, x, z, dx, dz, dist, f.id, false);
  const reach = hit ? Math.max(0, hit.t - 0.6) : dist;
  const lx = r2(clamp(x + dx * reach, -EDGE, EDGE));
  const lz = r2(clamp(z + dz * reach, -EDGE, EDGE));
  const ft = r2(Math.max(0.25, reach / THROW.speed));
  f.throws[k]--;
  f.fireT = THROW.cool;
  f.firedAt = m.clock;
  launch(m, f.id, k, x, z, lx, lz, ft, true);
  emit(m, { t: 'throw', f: f.id, k, x, z, lx, lz, ft });
  if (f.throws[k] <= 0) {
    const next = THROW_IDS.find((t) => f.throws[t] > 0);
    if (next) f.pick = next;
    else switchTo(f, f.guns[0] ? 0 : f.guns[1] ? 1 : SLOT_MELEE);
  }
}

/** Puts something thrown in the air. Every client flies it the same way from the same numbers. */
export function launch(m: Match, fid: number, k: ThrowId, x: number, z: number, lx: number, lz: number, ft: number, local: boolean) {
  m.tosses.push({ f: fid, k, x, z, lx, lz, t0: m.time, ft, fuse: m.time + Math.max(ft, THROWS[k].fuse ?? 0), local, landed: false });
}

/** Where something thrown is right now, and how high. */
export function tossAt(t: Toss, time: number) {
  const u = clamp((time - t.t0) / t.ft, 0, 1);
  const peak = 1.5 + Math.hypot(t.lx - t.x, t.lz - t.z) * 0.12;
  return { x: t.x + (t.lx - t.x) * u, z: t.z + (t.lz - t.z) * u, y: 1 + (0.25 - 1) * u + 4 * peak * u * (1 - u) };
}

function moveTosses(m: Match) {
  if (!m.tosses.length) return;
  const keep: Toss[] = [];
  for (const t of m.tosses) {
    if (!t.landed && m.time >= t.t0 + t.ft) {
      t.landed = true;
      if (t.k !== 'grenade') {
        const spec = THROWS[t.k];
        m.zones.push({ k: t.k, x: t.lx, z: t.lz, r: spec.radius, from: m.time, until: m.time + (spec.time ?? 0), by: t.f });
        emit(m, { t: 'zone', k: t.k, x: t.lx, z: t.lz });
        continue;
      }
    }
    if (t.k === 'grenade' && m.time >= t.fuse) {
      // the thrower's client decides what it did, like any shot; everyone else hears the bang from it
      const spec = THROWS.grenade;
      if (t.local) blast(m, t.f, t.lx, t.lz, spec.radius, spec.dmg ?? 0, 2.5, 'grenade');
      continue;
    }
    keep.push(t);
  }
  m.tosses = keep;
}

/** The newest cloud or puddle of a kind over a point, or null. */
export function zoneAt(m: Match, k: Zone['k'], x: number, z: number) {
  for (let i = m.zones.length - 1; i >= 0; i--) {
    const zn = m.zones[i];
    if (zn.k === k && zn.until > m.time && (zn.x - x) * (zn.x - x) + (zn.z - z) * (zn.z - z) < zn.r * zn.r) return zn;
  }
  return null;
}

/** True when a flour cloud hangs anywhere along the line between two points. */
function flourBetween(m: Match, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 1e-6) return false;
  const dx = (x1 - x0) / len;
  const dz = (z1 - z0) / len;
  return m.zones.some((zn) => zn.k === 'flour' && zn.until > m.time && rayCircle(x0, z0, dx, dz, len, zn.x, zn.z, zn.r) <= len);
}

// -------------------------------------------------------------------------------------------------------------------
// Building.

/** Where a wall built from (x, z) stands: WALL_DIST ahead, square to the aim (snapped to eighths of a turn). */
function wallSpot(x: number, z: number, aim: number) {
  const a = r2(Math.round(aim / (Math.PI / 4)) * (Math.PI / 4));
  return { a, x: r2(x + Math.sin(a) * WALL_DIST), z: r2(z + Math.cos(a) * WALL_DIST) };
}

/** Builds a wall in front of an egg. */
function build(m: Match, f: Fighter) {
  if (f.wood < WALL_COST || f.buildT > 0) return null;
  const { a, x, z } = wallSpot(f.x, f.z, f.aim);
  if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return null;
  f.wood -= WALL_COST;
  f.buildT = BUILD_COOL;
  const wall = makeWall(wallId(f.id, f.wallSeq++), f.id, x, z, a, WALL_HP);
  m.walls.set(wall.id, wall);
  // a copy, so the news goes out with the wall as built, whatever hits it later this frame
  emit(m, { t: 'wall', wall: { ...wall } });
  return wall;
}

export function makeWall(id: number, f: number, x: number, z: number, a: number, hp: number): Wall {
  return { id, f, x, z, a, sa: Math.sin(a), ca: Math.cos(a), hw: WALL_HALF, hd: WALL_THICK, hp };
}

/** A wall someone else built. */
export function addWall(m: Match, wall: Wall) {
  if (m.walls.has(wall.id) || m.goneWalls.has(wall.id)) return;
  m.walls.set(wall.id, wall);
  emit(m, { t: 'wall', wall, net: true });
}

// -------------------------------------------------------------------------------------------------------------------
// Loot.

/**
 * Would an egg take this? Guns need an empty slot, and a melee weapon in place of anything but the spatula, unless
 * it's a swap the player asked for. A scope or backpack only if it's better than the one we have.
 */
export function wants(f: Fighter, def: LootDef, manual: boolean) {
  switch (def.kind) {
    case 'gun':
      return manual || f.guns[0] === null || f.guns[1] === null;
    case 'melee':
      return def.w !== f.melee && (manual || f.melee === 'spatula');
    case 'throw':
      return f.throws[def.w] < throwCap(def.w, f.pack);
    case 'ammo':
      return f.ammo[def.a] < ammoCap(def.a, f.pack);
    case 'use':
      return f.items[def.w] < useCap(def.w, f.pack);
    case 'scope':
      return def.lv > f.scope;
    case 'pack':
      return def.lv > f.pack;
    case 'wood':
      return f.wood < WOOD_MAX;
  }
}

/** The nearest pickup within reach. */
export function nearestLoot(m: Match, f: Fighter, reach = PICK_R, test?: (l: LootItem) => boolean) {
  let best: LootItem | null = null;
  let bestD = reach * reach;
  for (const l of m.loot.values()) {
    const d = (l.x - f.x) * (l.x - f.x) + (l.z - f.z) * (l.z - f.z);
    if (d <= bestD && (!test || test(l))) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

/** The nearest closed chest or landed supply drop within reach, or -1. */
export function nearestChest(m: Match, f: Fighter, reach = CHEST_R) {
  let best = -1;
  let bestD = Infinity;
  for (const c of m.map.containers) {
    if (!openable(m, c)) continue;
    // a supply drop is a bigger box, so it can be opened from a little farther off
    const r = c.kind === 'supply' ? reach + 0.4 : reach;
    const d = (c.x - f.x) * (c.x - f.x) + (c.z - f.z) * (c.z - f.z);
    if (d <= r * r && d < bestD) {
      best = c.id;
      bestD = d;
    }
  }
  return best;
}

/** What the interact key would do right now: open a chest, or pick something up (a gun or melee weapon swaps). */
export function prompt(m: Match, f: Fighter): { chest: number } | { item: LootItem; swap: boolean } | null {
  if (f.phase !== 'ground') return null;
  // not something we just asked the host for (an ask it turned down expires), nor what we just put down
  const item = nearestLoot(m, f, PICK_R, (l) => wants(f, l.def, true) && !asking(m, f, l.id) && !(l.by === f.id && m.time - l.at < 3));
  const chest = nearestChest(m, f);
  if (chest >= 0) {
    const c = m.map.containers[chest];
    if (!item || Math.hypot(c.x - f.x, c.z - f.z) < Math.hypot(item.x - f.x, item.z - f.z)) return { chest };
  }
  if (!item) return null;
  const def = item.def;
  return { item, swap: (def.kind === 'gun' && f.guns[0] !== null && f.guns[1] !== null) || (def.kind === 'melee' && f.melee !== 'spatula') };
}

/** True while a pickup request is waiting for the host's answer (it gives up after a second). */
const asking = (m: Match, f: Fighter, id: number) => {
  const at = f.pending.get(id);
  return at !== undefined && m.clock - at < 1;
};

function interact(m: Match, f: Fighter) {
  const p = prompt(m, f);
  if (!p) return;
  if ('chest' in p) requestOpen(m, f, p.chest);
  else requestTake(m, f, p.item);
}

function autoPickup(m: Match, f: Fighter) {
  for (const l of m.loot.values()) {
    if (Math.abs(l.x - f.x) > AUTO_R || Math.abs(l.z - f.z) > AUTO_R) continue;
    if ((l.x - f.x) * (l.x - f.x) + (l.z - f.z) * (l.z - f.z) > AUTO_R * AUTO_R) continue;
    // never straight back up what we just put down
    if (l.by === f.id && m.time - l.at < 3) continue;
    if (wants(f, l.def, false)) requestTake(m, f, l);
  }
}

function requestTake(m: Match, f: Fighter, l: LootItem) {
  const asked = f.pending.get(l.id);
  if (asked !== undefined && m.clock - asked < 1) return;
  if (m.world) grantTake(m, f.id, l.id, true);
  else {
    f.pending.set(l.id, m.clock);
    emit(m, { t: 'take', f: f.id, id: l.id });
  }
}

function requestOpen(m: Match, f: Fighter, c: number) {
  if (m.world) openContainer(m, c, f.id, true);
  else {
    const asked = f.pending.get(-1 - c);
    if (asked !== undefined && m.clock - asked < 1) return;
    f.pending.set(-1 - c, m.clock);
    emit(m, { t: 'open', f: f.id, c });
  }
}

/** The host hands a pickup to whoever asked first. Returns false when it's already gone. */
export function grantTake(m: Match, fid: number, id: number, announce: boolean) {
  const l = m.loot.get(id);
  const f = m.fighters[fid];
  if (!l || !f || f.phase !== 'ground') return false;
  m.loot.delete(id);
  m.gone.add(id);
  if (owned(f)) give(m, f, l.def);
  emit(m, announce ? { t: 'took', f: fid, id, def: l.def } : { t: 'took', f: fid, id, def: l.def, net: true });
  return true;
}

/** The host says someone got a pickup. If it's ours, it goes in our pockets. */
export function applyTook(m: Match, fid: number, id: number, def: LootDef) {
  m.loot.delete(id);
  m.gone.add(id);
  const f = m.fighters[fid];
  if (!f) return;
  f.pending.delete(id);
  if (owned(f)) {
    if (f.phase === 'ground') give(m, f, def);
    // cracked while the host was saying yes: it goes back down where we fell, for anyone to pick up
    else dropItem(m, f, def, f.x, f.z);
  }
  emit(m, { t: 'took', f: fid, id, def, net: true });
}

/** Puts a pickup in an egg's pockets. Whatever doesn't fit goes back on the ground at its feet. */
function give(m: Match, f: Fighter, def: LootDef) {
  const fill = (have: number, cap: number, n: number, rest: (left: number) => LootDef) => {
    const take = Math.max(0, Math.min(n, cap - have));
    if (n - take > 0) dropItem(m, f, rest(n - take), f.x, f.z);
    return have + take;
  };
  switch (def.kind) {
    case 'gun': {
      const gun: Gun = { w: def.w, r: def.r, mag: def.mag ?? WEAPONS[def.w].mag };
      const slot = f.guns[0] === null ? 0 : f.guns[1] === null ? 1 : f.slot < 2 ? f.slot : 0;
      const old = f.guns[slot];
      f.guns[slot] = gun;
      if (old) dropItem(m, f, { kind: 'gun', w: old.w, r: old.r, mag: old.mag }, f.x, f.z);
      if (f.slot >= SLOT_MELEE || f.slot === slot) {
        f.slot = slot;
        f.reloadT = 0;
        f.burst = 0;
        f.fireT = Math.max(f.fireT, 0.2);
      }
      break;
    }
    case 'melee': {
      const old = f.melee;
      f.melee = def.w;
      if (old !== 'spatula') dropItem(m, f, { kind: 'melee', w: old }, f.x, f.z);
      if (f.slot === SLOT_MELEE) f.fireT = Math.max(f.fireT, 0.2);
      break;
    }
    case 'throw': {
      const had = THROW_IDS.some((k) => f.throws[k] > 0);
      f.throws[def.w] = fill(f.throws[def.w], throwCap(def.w, f.pack), def.n, (n) => ({ kind: 'throw', w: def.w, n }));
      if (!had || f.throws[f.pick] <= 0) f.pick = def.w;
      break;
    }
    case 'ammo':
      f.ammo[def.a] = fill(f.ammo[def.a], ammoCap(def.a, f.pack), def.n, (n) => ({ kind: 'ammo', a: def.a, n }));
      break;
    case 'use':
      f.items[def.w] = fill(f.items[def.w], useCap(def.w, f.pack), def.n, (n) => ({ kind: 'use', w: def.w, n }));
      break;
    case 'scope':
      if (def.lv > f.scope) {
        if (f.scope > 0) dropItem(m, f, { kind: 'scope', lv: f.scope }, f.x, f.z);
        f.scope = def.lv;
      } else dropItem(m, f, def, f.x, f.z);
      break;
    case 'pack':
      if (def.lv > f.pack) {
        if (f.pack > 0) dropItem(m, f, { kind: 'pack', lv: f.pack }, f.x, f.z);
        f.pack = def.lv;
      } else dropItem(m, f, def, f.x, f.z);
      break;
    case 'wood':
      f.wood = fill(f.wood, WOOD_MAX, def.n, (n) => ({ kind: 'wood', n }));
      break;
  }
}

/** Puts something an egg owned here dropped on the ground, numbered from that egg's own range. */
function dropItem(m: Match, f: Fighter, def: LootDef, x: number, z: number) {
  const item: LootItem = { id: dropId(f.id, f.dropSeq++), def, x: r1(x), z: r1(z), by: f.id, at: m.time };
  m.loot.set(item.id, item);
  emit(m, { t: 'drop', item });
}

/** Something another client dropped. */
export function addLoot(m: Match, item: LootItem) {
  if (m.loot.has(item.id) || m.gone.has(item.id)) return;
  m.loot.set(item.id, item);
  emit(m, { t: 'drop', item, net: true });
}

// -------------------------------------------------------------------------------------------------------------------
// Remote eggs.

export function flagsOf(f: Fighter) {
  const healing = f.using === 'bandage' || f.using === 'medkit';
  const shielding = f.using === 'mini' || f.using === 'shield';
  return (
    (f.reloadT > 0 ? F_RELOAD : 0) |
    (healing ? F_HEALING : 0) |
    (shielding ? F_SHIELDING : 0) |
    (f.shield > 0 ? F_SHIELDED : 0) |
    (f.hitT > 0 ? F_HIT : 0) |
    (MELEE[f.melee].blocks ? F_PAN : 0) |
    (f.boost > 0 ? F_BOOST : 0) |
    (f.using === 'coffee' ? F_DRINKING : 0)
  );
}

/** A position report for an egg another client owns. */
export function applyState(m: Match, f: Fighter, s: { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: Held | null; r: number; flags: number }) {
  if (f.kind !== 'remote') return;
  if (f.phase === 'out') return;
  if (s.phase === 'out') {
    // the news of how it cracked is on its way; if it never comes, it cracked on its own
    if (f.outSeen < 0) f.outSeen = m.clock;
    else if (m.clock - f.outSeen > 1.5) applyOut(m, f.id, -1, 'storm');
    return;
  }
  f.outSeen = -1;
  const snaps = f.snaps;
  if (f.phase !== s.phase) {
    snaps.length = 0;
    if (s.phase === 'drop') {
      f.dropAt = m.time;
      // up off the ground again: a bounce pad (its owner's word is the glide itself, so no news travels for it)
      if (f.phase === 'ground') emit(m, { t: 'bounce', f: f.id, net: true });
    }
  }
  f.phase = s.phase;
  f.hp = s.hp;
  f.shield = s.shield;
  f.show = { w: s.w, r: s.r, flags: s.flags };
  f.hitT = s.flags & F_HIT ? 0.2 : 0;
  snaps.push({ at: m.clock, x: s.x, z: s.z, y: s.y, aim: s.aim, vx: s.vx, vz: s.vz });
  if (snaps.length > 8) snaps.splice(0, snaps.length - 8);
  if (snaps.length === 1) {
    f.x = s.x;
    f.z = s.z;
    f.y = s.y;
    f.aim = s.aim;
  }
}

/** Moves a remote egg to where it was INTERP seconds ago, between the reports either side of then. */
function follow(m: Match, f: Fighter) {
  const snaps = f.snaps;
  if (!snaps.length || f.phase === 'out') return;
  const t = m.clock - INTERP;
  const last = snaps[snaps.length - 1];
  if (t >= last.at) {
    // nothing newer yet: carry on a moment at the last speed
    const ahead = Math.min(0.25, t - last.at);
    place(f, last, last.x + last.vx * ahead, last.z + last.vz * ahead, last.y, last.aim);
  } else if (t <= snaps[0].at) {
    place(f, snaps[0], snaps[0].x, snaps[0].z, snaps[0].y, snaps[0].aim);
  } else {
    let i = 0;
    while (i < snaps.length - 2 && snaps[i + 1].at <= t) i++;
    const a = snaps[i];
    const b = snaps[i + 1];
    const u = clamp((t - a.at) / Math.max(1e-6, b.at - a.at), 0, 1);
    place(f, b, a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, a.y + (b.y - a.y) * u, a.aim + angleDiff(b.aim, a.aim) * u);
  }
  if (f.phase === 'ground') {
    f.bush = coverAt(m.map, f.x, f.z);
    f.inside = buildingAt(m.map, f.x, f.z);
    f.wet = waterAt(m.map, f.x, f.z);
    f.warm = fireAt(m.map, f.x, f.z) >= 0;
  } else {
    f.bush = -1;
    f.inside = -1;
    f.wet = false;
    f.warm = false;
  }
}

function place(f: Fighter, speed: Snap, x: number, z: number, y: number, aim: number) {
  f.x = clamp(x, -EDGE - 30, EDGE + 30);
  f.z = clamp(z, -EDGE - 30, EDGE + 30);
  f.y = y;
  f.aim = aim;
  f.vx = speed.vx;
  f.vz = speed.vz;
}

// -------------------------------------------------------------------------------------------------------------------
// Computer players.

/** The distance each gun likes to fight at. */
const PREFER: Record<WeaponId, number> = { pistol: 14, revolver: 18, smg: 10, micro: 7, rifle: 20, burst: 22, scout: 30, lmg: 18, shotgun: 5, auto: 6, double: 4, sniper: 34, crossbow: 28, launcher: 18 };
const MELEE_PREFER = 1.2;
const GUN_VALUE: Record<WeaponId, number> = { pistol: 10, revolver: 18, smg: 20, micro: 18, rifle: 30, burst: 29, scout: 26, lmg: 27, shotgun: 26, auto: 25, double: 22, sniper: 22, crossbow: 18, launcher: 18 };
const gunValue = (g: Gun | null) => (g ? GUN_VALUE[g.w] + g.r * 7 : -1);

/**
 * Hidden from a viewer more than a few steps away: in a bush or cornfield until it fires, or in a flour cloud the
 * viewer is outside of.
 */
export function concealed(m: Match, f: Fighter, viewer: Fighter | undefined) {
  if (!viewer || f === viewer) return false;
  if (Math.hypot(f.x - viewer.x, f.z - viewer.z) <= 4) return false;
  if (f.bush >= 0 && m.clock - f.firedAt > 1.2) return true;
  if (!m.zones.length) return false;
  const cloud = zoneAt(m, 'flour', f.x, f.z);
  return !!cloud && cloud !== zoneAt(m, 'flour', viewer.x, viewer.z);
}

/** Can `a` see `b`? Cover hides an egg that keeps still and quiet until you're close; walls and flour hide everyone. */
export function canSee(m: Match, a: Fighter, b: Fighter, sight: number) {
  if (!fighting(b) || b === a) return false;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (d > sight) return false;
  if (concealed(m, b, a)) return false;
  if (d > 4 && m.zones.length) {
    // flour blocks the view through it, except between two eggs in the same cloud
    const cloud = zoneAt(m, 'flour', a.x, a.z);
    if (!(cloud && cloud === zoneAt(m, 'flour', b.x, b.z)) && flourBetween(m, a.x, a.z, b.x, b.z)) return false;
  }
  return clearLine(m, a.x, a.z, b.x, b.z);
}

function hasAmmo(f: Fighter, g: Gun | null) {
  return !!g && (g.mag > 0 || f.ammo[WEAPONS[g.w].ammo] > 0);
}

const scopedGun = (g: Gun | null) => !!g && WEAPONS[g.w].cls === 'sniper';

/** A loaded gun other than `g` for closer in than a scope, or null. */
const closerGun = (f: Fighter, g: Gun | null) => f.guns.find((x) => x && x !== g && !scopedGun(x) && hasAmmo(f, x)) ?? null;

/** The slot to fight with at a distance: the gun that likes it best, or the melee weapon. */
function bestSlot(f: Fighter, d: number) {
  let best = SLOT_MELEE;
  // melee only when no gun has a shot left, or a weak one at point blank
  let score = d < 2.4 ? -0.9 + (f.melee === 'spatula' ? 0 : 0.4) : -Infinity;
  f.guns.forEach((g, i) => {
    if (!hasAmmo(f, g)) return;
    const s = -Math.abs(PREFER[g!.w] - d) / Math.max(4, PREFER[g!.w]) + g!.r * 0.05 + (WEAPONS[g!.w].range < d ? -2 : 0);
    // a scope only when the other gun can't reach
    const other = scopedGun(g) ? closerGun(f, g) : null;
    const t = s - (other && WEAPONS[other.w].range * 0.8 >= d ? 0.35 : 0);
    if (t > score) {
      score = t;
      best = i;
    }
  });
  return best;
}

/** How far off to fight: what the gun in hand likes, or closer when we carry a gun for that next to a scoped one. */
function fightRange(f: Fighter, g: Gun | null) {
  if (!g) return MELEE_PREFER;
  const other = scopedGun(g) ? closerGun(f, g) : null;
  return other ? PREFER[other.w] + 4 : PREFER[g.w];
}

function think(m: Match, f: Fighter, dt: number) {
  const ai = f.ai!;
  const inp = f.input;
  const L = LEVEL_SPECS[m.level];
  inp.mx = 0;
  inp.mz = 0;
  inp.fire = false;
  inp.reach = 0;
  if (f.phase === 'bus') {
    if (m.time >= ai.jumpAt) inp.jump = true;
    return;
  }
  if (f.phase === 'drop') {
    // gliding (from the bus, or a bounce pad on the way somewhere): steer for where we meant to go
    ai.pad = -1;
    const dx = ai.gx - f.x;
    const dz = ai.gz - f.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.8) {
      inp.mx = dx / d;
      inp.mz = dz / d;
    }
    inp.aim = f.aim;
    return;
  }
  ai.react = Math.max(0, ai.react - dt);
  ai.strafeT -= dt;
  ai.buildCool = Math.max(0, ai.buildCool - dt);
  ai.swapCool = Math.max(0, ai.swapCool - dt);
  ai.smashT = Math.max(0, ai.smashT - dt);
  ai.tossCool -= dt;
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = 0.2 + m.rng() * 0.12;
    decide(m, f, ai, L);
  }

  const s = m.storm;
  const outside = Math.hypot(f.x - s.x, f.z - s.z) > s.r - 1;
  // hot sauce underfoot: out of it the shortest way
  const burn = zoneAt(m, 'sauce', f.x, f.z);
  const away = (zn: Zone) => {
    const dx = f.x - zn.x;
    const dz = f.z - zn.z;
    const d = Math.hypot(dx, dz) || 1;
    steer(m, f, ai, zn.x + (dx / d) * (zn.r + 2.5), zn.z + (dz / d) * (zn.r + 2.5), dt, 0);
  };
  const tgt = ai.target >= 0 ? m.fighters[ai.target] : null;
  if (tgt && fighting(tgt)) {
    const dx = tgt.x - f.x;
    const dz = tgt.z - f.z;
    const d = Math.hypot(dx, dz);
    const g = f.slot < 2 ? f.guns[f.slot] : null;
    const speed = g ? WEAPONS[g.w].speed : 1e9;
    const lead = (d / speed) * L.lead;
    const ideal = Math.atan2(dx + tgt.vx * lead, dz + tgt.vz * lead);
    // a scoped shot waits until the gun is ready and the aim has held still a moment (getting hit spoils it)
    const scoped = scopedGun(g);
    ai.errT -= dt;
    if (ai.errT <= 0 && !(scoped && ai.steady > 0 && ai.steady < L.settle)) {
      ai.errT = 0.3 + m.rng() * 0.4;
      // the farther off and the quicker it moves, the wider the miss
      const moving = Math.min(1, Math.hypot(tgt.vx, tgt.vz) / SPEED);
      ai.err = (m.rng() * 2 - 1) * L.err * (0.6 + moving * 0.8) * (1 + (Math.max(0, d - 20) / 10) * L.far);
    }
    const turn = angleDiff(ideal + ai.err, f.aim);
    const maxTurn = L.turn * dt;
    inp.aim = f.aim + clamp(turn, -maxTurn, maxTurn);
    ai.steady = scoped && f.fireT <= 0 && f.hitT <= 0 && Math.abs(angleDiff(inp.aim, ideal + ai.err)) < 0.03 ? ai.steady + dt : 0;
    const aligned = Math.abs(angleDiff(inp.aim, ideal)) < 0.22 + (g ? WEAPONS[g.w].spread : 0.4) && (!scoped || ai.steady >= L.settle);
    // bursts: shoot a while, rest a beat (a scoped gun keeps its own beat, the settle)
    if (ai.burst > 0) ai.burst -= dt;
    else if (ai.rest > 0) ai.rest -= dt;
    else {
      ai.burst = L.burst * (0.6 + m.rng() * 0.8);
      ai.rest = L.rest * (0.6 + m.rng() * 0.8);
    }
    if (ai.toss) {
      // a throw under way: take it out, aim, let go
      ai.tossT -= dt;
      inp.pick = ai.toss;
      inp.reach = ai.tossD;
      if (f.slot === SLOT_THROW && f.pick === ai.toss && Math.abs(angleDiff(inp.aim, ideal)) < 0.25 && ai.react <= 0) inp.fire = true;
      if (f.throws[ai.toss] < ai.tossHad || f.throws[ai.toss] <= 0 || ai.tossT <= 0) ai.toss = null;
    } else {
      if (L.toss > 0 && ai.tossCool <= 0 && ai.react <= 0) {
        // something to throw and a target in reach: lob it (always at one behind cover), then wait a while; if not,
        // look again in a moment
        const bomb: ThrowId | null = f.throws.grenade > 0 ? 'grenade' : f.throws.sauce > 0 ? 'sauce' : null;
        if (bomb && d >= 5 && d <= THROW.max + 1 && (!clearLine(m, f.x, f.z, tgt.x, tgt.z) || m.rng() < 0.6)) {
          startToss(ai, f, bomb, d);
          ai.tossCool = L.toss * (0.7 + m.rng() * 0.6);
        } else if (f.throws.flour > 0 && f.hp + f.shield < 45 && d < 25) {
          startToss(ai, f, 'flour', THROW.min);
          ai.tossCool = L.toss * (0.7 + m.rng() * 0.6);
        } else ai.tossCool = 1 + m.rng();
      }
      const want = bestSlot(f, d);
      if (want !== f.slot && f.reloadT <= 0 && (ai.swapCool <= 0 || f.slot === SLOT_THROW)) {
        inp.slot = want;
        ai.swapCool = 0.8;
      }
      const reach = g ? WEAPONS[g.w].range * 0.95 : MELEE[f.melee].range + 0.4;
      if (f.slot !== SLOT_THROW && ai.react <= 0 && aligned && d < reach && (ai.burst > 0 || scoped) && clearLine(m, f.x, f.z, tgt.x, tgt.z)) {
        inp.fire = true;
        // after a scoped shot, aim afresh and settle again
        if (scoped && f.fireT <= 0) {
          ai.steady = 0;
          ai.errT = 0;
        }
      }
    }
    // a wall between us when it gets hot
    if (L.build && !ai.toss && ai.buildCool <= 0 && f.wood >= WALL_COST && f.hitT > 0 && f.hp + f.shield < 130 && d > 7 && !shutsIn(m, f, ideal)) {
      inp.build = true;
      inp.aim = ideal;
      ai.buildCool = L.build * (0.7 + m.rng() * 0.6);
    }
    if (outside) {
      head(m, f, ai, s.x, s.z, dt, 1);
    } else if (burn) {
      away(burn);
    } else {
      const pref = fightRange(f, g);
      let mx = 0;
      let mz = 0;
      if (d > pref + 4 || !clearLine(m, f.x, f.z, tgt.x, tgt.z)) {
        mx += dx / d;
        mz += dz / d;
      } else if (d < pref - 3) {
        mx -= dx / d;
        mz -= dz / d;
      }
      if (ai.strafeT <= 0) {
        ai.strafeT = 0.5 + m.rng() * 1.1;
        ai.strafe = m.rng() < 0.5 ? -1 : 1;
      }
      // a sniper settling its aim stops dodging about
      if (!(scoped && ai.steady > 0)) {
        mx += (dz / d) * ai.strafe * 0.8;
        mz += (-dx / d) * ai.strafe * 0.8;
      }
      const len = Math.hypot(mx, mz);
      if (len > 0.01) steer(m, f, ai, f.x + (mx / len) * 4, f.z + (mz / len) * 4, dt, 0);
    }
    return;
  }
  ai.toss = null;

  // nobody in sight: patch up, reload, then go where we mean to
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (!f.using) {
    if (f.hp < L.heal && bestUse(f, 'heal')) inp.use = 'bestHeal';
    else if (f.shield < 50 && bestUse(f, 'shield')) inp.use = 'bestShield';
    else if (f.items.coffee > 0 && f.boost < 20 && f.hp < 90) inp.use = 'coffee';
    else if (f.shield < 100 && f.items.shield > 0) inp.use = 'shield';
    else if (g && g.mag < WEAPONS[g.w].mag * 0.6) inp.reload = true;
  }
  if (f.slot >= SLOT_MELEE || !hasAmmo(f, g)) {
    const pick = f.guns.findIndex((x) => hasAmmo(f, x));
    if (pick >= 0 && pick !== f.slot) inp.slot = pick;
    else if (pick < 0 && f.slot === SLOT_THROW) inp.slot = SLOT_MELEE;
  }
  const via = ai.pad >= 0 ? m.map.pads[ai.pad] : null;
  if (burn) away(burn);
  else if (f.using && !outside) {
    // stand still behind cover while it takes
  } else if (via) head(m, f, ai, via.x, via.z, dt, 0);
  else head(m, f, ai, ai.gx, ai.gz, dt, ai.goal === 'roam' ? 2 : ai.goal === 'smash' ? 1.4 : 0.4);
  inp.aim = Math.hypot(f.vx, f.vz) > 0.5 ? Math.atan2(f.vx, f.vz) : f.aim;
  if (ai.smashT > 0) {
    // knock down what's in the way (or what we came to break)
    inp.slot = SLOT_MELEE;
    inp.aim = ai.smashA;
    inp.fire = true;
  }

  if (ai.goal === 'smash') {
    const c = m.map.containers[ai.chest];
    if (!c || m.opened[c.id] || m.time > ai.until) {
      // broken, or taking too long: leave it be
      if (c && !m.opened[c.id]) ai.tried = c.id;
      ai.think = 0;
    } else {
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      const half = c.kind === 'hay' ? HAY_HW : c.kind === 'toilet' ? TOILET_R : CRATE_HALF;
      if (d < MELEE[f.melee].range + half - 0.2) {
        ai.smashT = 0.3;
        ai.smashA = Math.atan2(c.x - f.x, c.z - f.z);
      }
    }
  } else if (ai.goal === 'loot') {
    const l = m.loot.get(ai.item);
    if (!l) ai.think = 0;
    else if (Math.hypot(l.x - f.x, l.z - f.z) < PICK_R - 0.2 && (l.def.kind === 'gun' || l.def.kind === 'melee')) {
      // take just what we came for, swapping our weaker gun for it once that's in hand
      const weaker = gunValue(f.guns[0]) <= gunValue(f.guns[1]) ? 0 : 1;
      if (l.def.kind === 'gun' && f.guns[0] && f.guns[1] && f.slot !== weaker) inp.slot = weaker;
      else {
        requestTake(m, f, l);
        ai.think = 0;
      }
    }
  } else if (ai.goal === 'chest') {
    const c = m.map.containers[ai.chest];
    if (!openable(m, c)) ai.think = 0;
    else if (Math.hypot(c.x - f.x, c.z - f.z) < CHEST_R - 0.3) {
      inp.interact = true;
      ai.think = 0;
    }
  }
}

function startToss(ai: Ai, f: Fighter, k: ThrowId, d: number) {
  ai.toss = k;
  ai.tossD = d;
  ai.tossT = 1.5;
  ai.tossHad = f.throws[k];
}

/** Melee weapons worth trading the spatula for, best first. */
const MELEE_VALUE: Record<MeleeId, number> = { spatula: 0, whisk: 2, knife: 4, cleaver: 4, pan: 5, pin: 3 };

/** Picks what to do, then whether a bounce pad on the way would get us somewhere far quicker. */
function decide(m: Match, f: Fighter, ai: Ai, L: LevelSpec) {
  pickGoal(m, f, ai, L);
  ai.pad = -1;
  if (ai.target >= 0 || ai.goal === 'fire' || ai.goal === 'smash' || ai.goal === 'chase') return;
  const far = Math.hypot(ai.gx - f.x, ai.gz - f.z);
  if (far < 35) return;
  const s = m.storm;
  const safe = s.shrinking || s.timer < 20 ? s.next : { x: s.x, z: s.z, r: s.r };
  let best = far - 8;
  m.map.pads.forEach((p, i) => {
    const d = Math.hypot(p.x - f.x, p.z - f.z);
    if (d > 26) return;
    // a pad pointing our way, that lands us inside the circle and leaves less of the way to walk
    const lx = p.x + p.dx * PAD_FLY;
    const lz = p.z + p.dz * PAD_FLY;
    const walk = d + Math.hypot(ai.gx - lx, ai.gz - lz);
    if ((ai.gx - f.x) * p.dx + (ai.gz - f.z) * p.dz < far * 0.6 || Math.hypot(lx - safe.x, lz - safe.z) > safe.r - 2 || walk >= best) return;
    ai.pad = i;
    best = walk;
  });
}

function pickGoal(m: Match, f: Fighter, ai: Ai, L: LevelSpec) {
  // a target: the nearest egg we can see, sticking with the one we have, and turning on whoever just shot us
  const far = f.guns.some((x) => x && WEAPONS[x.w].cls === 'sniper' && hasAmmo(f, x));
  const sight = L.sight + (far ? 20 : 0) + SCOPE_VIEW[f.scope];
  let best: Fighter | null = null;
  let bestScore = Infinity;
  for (const o of m.fighters) {
    if (o === f || !fighting(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    const hitMe = o.id === f.lastBy && m.clock - f.lastByAt < 3;
    if (d > sight + 15 || !canSee(m, f, o, hitMe ? sight + 15 : sight)) continue;
    const score = d - (o.id === ai.target ? 8 : 0) - (hitMe ? 12 : 0);
    if (score < bestScore) {
      best = o;
      bestScore = score;
    }
  }
  const armed = f.guns.some((x) => hasAmmo(f, x));
  // unarmed eggs only fight what is right in front of them
  if (best && !armed && Math.hypot(best.x - f.x, best.z - f.z) > 6) best = null;
  if ((best?.id ?? -1) !== ai.target) ai.react = best ? L.react * (0.7 + m.rng() * 0.6) : 0;
  ai.target = best?.id ?? -1;
  if (best) return;

  // somebody shot us from out of sight: go and look
  const s = m.storm;
  const safe = s.shrinking || s.timer < 20 ? s.next : { x: s.x, z: s.z, r: s.r };
  const fromSafe = Math.hypot(f.x - safe.x, f.z - safe.z);
  if (fromSafe > safe.r - 4) {
    const k = safe.r > 6 ? (safe.r * 0.45) / Math.max(1, fromSafe) : 0;
    ai.goal = 'zone';
    ai.gx = safe.x + (f.x - safe.x) * k;
    ai.gz = safe.z + (f.z - safe.z) * k;
    return;
  }
  const attacker = f.lastBy >= 0 && m.clock - f.lastByAt < 4 ? m.fighters[f.lastBy] : null;
  if (attacker && fighting(attacker) && armed) {
    ai.goal = 'chase';
    ai.gx = attacker.x;
    ai.gz = attacker.z;
    return;
  }

  const inSafe = (x: number, z: number) => Math.hypot(x - safe.x, z - safe.z) < safe.r - 2;
  // hurt, with nobody about: warm up at a campfire nearby, when we have nothing to patch up with or it's right there
  if (ai.goal === 'fire') {
    const c = m.map.fires[ai.chest];
    if (c && f.hp < HP_MAX - 2 && m.time < ai.until && inSafe(c.x, c.z)) return;
  }
  if (f.hp < L.heal + 15) {
    let fire = -1;
    let fireD = bestUse(f, 'heal') ? 12 : 45;
    m.map.fires.forEach((c, i) => {
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      if (d < fireD && inSafe(c.x, c.z)) {
        fire = i;
        fireD = d;
      }
    });
    if (fire >= 0) {
      // stand beside it, on our side of it
      const c = m.map.fires[fire];
      const d = Math.max(0.1, Math.hypot(f.x - c.x, f.z - c.z));
      ai.goal = 'fire';
      ai.chest = fire;
      ai.until = m.time + 45;
      ai.gx = c.x + ((f.x - c.x) / d) * 1.8;
      ai.gz = c.z + ((f.z - c.z) / d) * 1.8;
      return;
    }
  }
  const worst = Math.min(gunValue(f.guns[0]), gunValue(f.guns[1]));
  // the gun a find would take the place of, when both hands are full
  const weakest = f.guns[0] && f.guns[1] ? f.guns[gunValue(f.guns[0]) <= gunValue(f.guns[1]) ? 0 : 1] : null;
  let item: LootItem | null = null;
  let itemD = 70;
  for (const l of m.loot.values()) {
    const d = Math.hypot(l.x - f.x, l.z - f.z);
    if (d >= itemD || !inSafe(l.x, l.z)) continue;
    const def = l.def;
    let useful: boolean;
    switch (def.kind) {
      case 'gun':
        // never a second scope in place of the gun for closer in
        useful = gunValue({ w: def.w, r: def.r, mag: 0 }) > worst + 3 && !(WEAPONS[def.w].cls === 'sniper' && weakest && !scopedGun(weakest) && f.guns.some(scopedGun));
        break;
      case 'ammo':
        useful = f.guns.some((x) => x && WEAPONS[x.w].ammo === def.a) && f.ammo[def.a] < ammoCap(def.a, f.pack) * 0.5;
        break;
      case 'melee':
        useful = MELEE_VALUE[def.w] > MELEE_VALUE[f.melee] && f.melee === 'spatula';
        break;
      case 'use':
        useful = wants(f, def, false) && f.items[def.w] < (def.w === 'bandage' ? 5 : 2);
        break;
      case 'throw':
        useful = wants(f, def, false) && f.throws[def.w] < 2;
        break;
      case 'scope':
      case 'pack':
        useful = wants(f, def, false);
        break;
      default:
        useful = false;
    }
    if (!useful || (l.by === f.id && m.time - l.at < 3)) continue;
    item = l;
    itemD = d;
  }
  let chest = -1;
  let chestD = armed ? 30 : 45;
  for (const c of m.map.containers) {
    if (!openable(m, c) || !inSafe(c.x, c.z)) continue;
    // a supply drop is worth the walk from farther off
    const d = Math.hypot(c.x - f.x, c.z - f.z) - (c.kind === 'supply' ? 40 : 0);
    if (d < chestD) {
      chest = c.id;
      chestD = d;
    }
  }
  if (item && (chest < 0 || itemD < chestD + 6)) {
    ai.goal = 'loot';
    ai.item = item.id;
    ai.gx = item.x;
    ai.gz = item.z;
    return;
  }
  if (chest >= 0) {
    const c = m.map.containers[chest];
    ai.goal = 'chest';
    ai.chest = chest;
    ai.gx = c.x;
    ai.gz = c.z + c.face * (c.kind === 'supply' ? 1.5 : 1.1);
    return;
  }
  // a crate, toilet or hay bale nearby to break open for whatever's in it (from farther off when we're unarmed)
  let smash = -1;
  let smashD = armed ? 14 : 26;
  for (const c of m.map.containers) {
    if (!breakable(c) || c.kind === 'barrel' || m.opened[c.id] || c.id === ai.tried || !inSafe(c.x, c.z)) continue;
    const d = Math.hypot(c.x - f.x, c.z - f.z);
    if (d < smashD) {
      smash = c.id;
      smashD = d;
    }
  }
  if (smash >= 0) {
    const c = m.map.containers[smash];
    if (ai.goal !== 'smash' || ai.chest !== smash) ai.until = m.time + 15;
    ai.goal = 'smash';
    ai.chest = smash;
    ai.gx = c.x;
    ai.gz = c.z;
    return;
  }
  if (ai.goal !== 'roam' || Math.hypot(ai.gx - f.x, ai.gz - f.z) < 3 || !inSafe(ai.gx, ai.gz)) {
    ai.goal = 'roam';
    const r = Math.max(2, safe.r * 0.7);
    for (let i = 0; i < 8; i++) {
      const x = safe.x + (m.rng() * 2 - 1) * r;
      const z = safe.z + (m.rng() * 2 - 1) * r;
      if (Math.abs(x) > EDGE - 4 || Math.abs(z) > EDGE - 4 || !inSafe(x, z) || waterAt(m.map, x, z)) continue;
      ai.gx = x;
      ai.gz = z;
      break;
    }
  }
}

/** Would a wall built aiming this way shut us in or block a way in? Never indoors, on a building, or by a doorway. */
function shutsIn(m: Match, f: Fighter, aim: number) {
  const w = wallSpot(f.x, f.z, aim);
  return m.map.buildings.some(
    (b) =>
      (Math.abs(f.x - b.x) < b.w / 2 && Math.abs(f.z - b.z) < b.d / 2) ||
      (Math.abs(w.x - b.x) < b.w / 2 + 1 && Math.abs(w.z - b.z) < b.d / 2 + 1) ||
      b.doors.some((dr) => Math.hypot(w.x - dr.x, w.z - dr.z) < WALL_HALF + dr.w / 2 + 1.2),
  );
}

/**
 * Steers toward a goal. From inside a building the goal isn't in, that's out through a doorway first; from inside a
 * fenced yard it isn't in, out through a gate. Going the other way, it's in through a gate, then a doorway. With the
 * river in the way, it's over a bridge first, unless wading across is quicker.
 */
function head(m: Match, f: Fighter, ai: Ai, tx: number, tz: number, dt: number, stop: number) {
  const b = f.inside >= 0 ? m.map.buildings[f.inside] : undefined;
  const yard = b ? -1 : yardAt(m.map, f.x, f.z);
  const ways = b ? b.doors : yard >= 0 ? m.map.yards[yard].gates : null;
  // the way through that makes the shortest way there, one in sight if there is one
  const pick = (list: Door[], inward: boolean) => {
    let best = Infinity;
    for (const dr of list) {
      const d = Math.hypot(dr.x - f.x, dr.z - f.z) + Math.hypot(tx - dr.x, tz - dr.z) + (clearLine(m, f.x, f.z, dr.x + dr.ox * (inward ? 1 : -1), dr.z + dr.oz * (inward ? 1 : -1)) ? 0 : 20);
      if (d < best) {
        ai.exit = dr;
        best = d;
      }
    }
    ai.inward = inward;
  };
  const yardIn = !b && yard < 0 ? yardAt(m.map, tx, tz) : -1;
  const roomIn = !b && yardIn < 0 ? buildingAt(m.map, tx, tz) : -1;
  if (b && buildingAt(m.map, tx, tz) !== f.inside) pick(b.doors, false);
  else if (yard >= 0 && yardAt(m.map, tx, tz) !== yard) pick(m.map.yards[yard].gates, false);
  else if (yardIn >= 0) pick(m.map.yards[yardIn].gates, true);
  else if (roomIn >= 0) pick(m.map.buildings[roomIn].doors, true);
  else if (ways || (ai.exit && (ai.inward || Math.hypot(f.x - ai.exit.x, f.z - ai.exit.z) >= 1.5))) ai.exit = null;
  const door = ai.exit;
  let px = tx;
  let pz = tz;
  if (door) {
    // square in front of it (or in it), straight on through; off to one side or behind, line up in front of it first
    const lined = Math.abs((f.x - door.x) * door.oz - (f.z - door.z) * door.ox) < Math.max(0.3, door.w / 2 - FIGHTER_R - 0.1);
    const k = ai.inward ? (lined && (f.x - door.x) * door.ox + (f.z - door.z) * door.oz > -0.3 ? -1.5 : 1.6) : !ways || lined ? 1.5 : -1.2;
    px = door.x + door.ox * k;
    pz = door.z + door.oz * k;
  }
  const over = b ? null : bridgeWay(m, f, ai, px, pz);
  if (over) {
    px = over.x;
    pz = over.z;
  }
  // outdoors, with a building or a fenced yard across the way: round it by a corner
  const c = b ? null : around(m, f.x, f.z, px, pz, yard);
  if (c) return steer(m, f, ai, c.x, c.z, dt, 0);
  // inside, with where we're going on the far side of the wall between two rooms: through the doorway in it first
  if (b)
    for (const dr of b.inner) {
      const there = (px - dr.x) * dr.ox + (pz - dr.z) * dr.oz;
      const here = (f.x - dr.x) * dr.ox + (f.z - dr.z) * dr.oz;
      if (there * here >= 0) continue;
      const s = there > 0 ? 1 : -1;
      const k = Math.abs((f.x - dr.x) * dr.oz - (f.z - dr.z) * dr.ox) < Math.max(0.3, dr.w / 2 - FIGHTER_R - 0.1) ? 1.5 : -1.2;
      return steer(m, f, ai, dr.x + dr.ox * s * k, dr.z + dr.oz * s * k, dt, 0);
    }
  steer(m, f, ai, px, pz, dt, door || over ? 0 : stop);
}

/** A meter waded counts as this many walked: it's slow, and out in the open. */
const WADE = 2.4;

/** Where to step on and off a bridge: just past each end of its deck. */
function bridgeEnds(b: Bridge) {
  const ax = b.alongX ? 1 : 0;
  const az = 1 - ax;
  const h = (b.alongX ? b.hw : b.hd) + 1.2;
  return [
    { x: b.x - ax * h, z: b.z - az * h },
    { x: b.x + ax * h, z: b.z + az * h },
  ];
}

/**
 * With the river between us and (tx, tz), the point to make for on the way over the bridge that makes the quickest
 * way there: its near end, then (lined up there, or once on the deck) its far end. Null to go straight on: no river in
 * the way, wading is quicker, or we're already in the water.
 */
function bridgeWay(m: Match, f: Fighter, ai: Ai, tx: number, tz: number) {
  const map = m.map;
  const on = bridgeAt(map, f.x, f.z);
  if (on >= 0) {
    ai.bridge = on;
    if (bridgeAt(map, tx, tz) === on) return null;
    const [a, c] = bridgeEnds(map.bridges[on]);
    // off the end on the same bank as where we're going
    return riverCrossings(map, a.x, a.z, tx, tz) % 2 === 0 ? a : c;
  }
  const n = map.bridges.length && !f.wet ? riverCrossings(map, f.x, f.z, tx, tz) : 0;
  if (n % 2 === 0) {
    ai.bridge = -1;
    return null;
  }
  // which end is which from here, for each bridge, and the way round by it (the one we chose counts a little shorter)
  let best = -1;
  let bestD = Math.hypot(tx - f.x, tz - f.z) + n * RIVER_HALF * 2 * (WADE - 1);
  let near = { x: 0, z: 0 };
  let far = near;
  map.bridges.forEach((br, i) => {
    const [a, c] = bridgeEnds(br);
    const [p, q] = riverCrossings(map, f.x, f.z, a.x, a.z) % 2 === 0 ? [a, c] : [c, a];
    const d = Math.hypot(p.x - f.x, p.z - f.z) + Math.hypot(q.x - p.x, q.z - p.z) + Math.hypot(tx - q.x, tz - q.z) - (i === ai.bridge ? 4 : 0);
    if (d < bestD) {
      best = i;
      bestD = d;
      near = p;
      far = q;
    }
  });
  ai.bridge = best;
  if (best < 0) return null;
  // lined up with the deck at its near end, or past that already: on over it
  const len = Math.hypot(far.x - near.x, far.z - near.z);
  const ux = (far.x - near.x) / len;
  const uz = (far.z - near.z) / len;
  const t = (f.x - near.x) * ux + (f.z - near.z) * uz;
  return t > -1.2 && Math.abs((f.x - near.x) * uz - (f.z - near.z) * ux) < 1.2 ? far : near;
}

/**
 * When the way from (x, z) to (px, pz) cuts across a roofed building or a fenced yard (but the one we're in), the
 * corner to walk round the nearest one by: the one in sight that makes the shortest way, and not the one we're at.
 */
function around(m: Match, x: number, z: number, px: number, pz: number, yard: number) {
  const len = Math.hypot(px - x, pz - z);
  if (len < 1) return null;
  const dx = (px - x) / len;
  const dz = (pz - z) / len;
  let near = Infinity;
  let o: Box | null = null;
  for (const b of blockersOf(m.map)) {
    // never one we're standing in (a doorway) or one the point is in
    if (b.yard === yard || (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) || (Math.abs(px - b.x) < b.hw && Math.abs(pz - b.z) < b.hd)) continue;
    const t = rayBox(x, z, dx, dz, len, b.x, b.z, b.hw, b.hd);
    if (t < near) {
      near = t;
      o = b;
    }
  }
  if (!o) return null;
  const box = o;
  const corners = CORNERS.map(([sx, sz]) => ({ x: box.x + sx * (box.hw + 1.4), z: box.z + sz * (box.hd + 1.4) }));
  const sees = (ax: number, az: number, bx: number, bz: number) => {
    const l = Math.hypot(bx - ax, bz - az);
    return l < 1e-6 || rayBox(ax, az, (bx - ax) / l, (bz - az) / l, l, box.x, box.z, box.hw, box.hd) === Infinity;
  };
  // the rest of the way from a corner: straight on when the point is in sight, else by the next corner round
  const rest = (i: number) => {
    const c = corners[i];
    if (sees(c.x, c.z, px, pz)) return Math.hypot(px - c.x, pz - c.z);
    return Math.min(...[corners[(i + 1) % 4], corners[(i + 3) % 4]].map((n) => Math.hypot(n.x - c.x, n.z - c.z) + Math.hypot(px - n.x, pz - n.z)));
  };
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const l = Math.hypot(c.x - x, c.z - z);
    if (l < 1 || !sees(x, z, c.x, c.z)) continue;
    const d = l + rest(i);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
/**
 * The roofed buildings and fenced yards of an island (`yard` is the yard's index, or -2 for a building), worked out
 * once (and again should the lists be swapped for others, as tests do).
 */
const blockers = new WeakMap<GameMap, { of: [unknown, unknown]; list: (Box & { yard: number })[] }>();
function blockersOf(map: GameMap) {
  let got = blockers.get(map);
  if (!got || got.of[0] !== map.buildings || got.of[1] !== map.yards) {
    const list = [...map.buildings.filter((b) => b.roof).map((b) => ({ x: b.x, z: b.z, hw: (b.w + WALL_T) / 2, hd: (b.d + WALL_T) / 2, yard: -2 })), ...map.yards.map((y, i) => ({ x: y.x, z: y.z, hw: y.hw, hd: y.hd, yard: i }))];
    got = { of: [map.buildings, map.yards], list };
    blockers.set(map, got);
  }
  return got.list;
}
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/** The roofed building whose outer walls stand round a point, or -1. */
const roomAt = (m: Match, x: number, z: number) => m.map.buildings.findIndex((b) => b.roof && Math.abs(x - b.x) < (b.w + WALL_T) / 2 && Math.abs(z - b.z) < (b.d + WALL_T) / 2);

/** Walks a computer player toward a point, feeling its way around whatever is in the way. */
function steer(m: Match, f: Fighter, ai: Ai, tx: number, tz: number, dt: number, stop: number) {
  const inp = f.input;
  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop) {
    ai.stuckT = 0;
    return;
  }
  let a = Math.atan2(dx, dz);
  if (ai.detourT > 0) {
    ai.detourT -= dt;
    a = ai.detourA;
  } else {
    // try straight on, then ever wider either side, and never into a building (doorways too) or a fenced yard the
    // point isn't in, nor over a bounce pad we aren't making for
    const look = Math.min(2.4, d);
    const into = roomAt(m, tx, tz);
    const intoYard = yardAt(m.map, tx, tz);
    const fromYard = yardAt(m.map, f.x, f.z);
    const onPad = padAt(m.map, tx, tz);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
      const b = a + turn;
      const ex = Math.sin(b);
      const ez = Math.cos(b);
      const side = 0.45;
      const room = roomAt(m, f.x + ex * look, f.z + ez * look);
      const yard = yardAt(m.map, f.x + ex * look, f.z + ez * look);
      const blocked =
        (room >= 0 && room !== f.inside && room !== into) ||
        (yard >= 0 && yard !== fromYard && yard !== intoYard) ||
        m.map.pads.some((p, i) => i !== onPad && rayCircle(f.x, f.z, ex, ez, look, p.x, p.z, PAD.r + FIGHTER_R * 0.5) < Infinity) ||
        [-side, 0, side].some((o) => castRay(m, f.x + ez * o, f.z - ex * o, ex, ez, look, f.id, false, true) !== null);
      if (!blocked) {
        a = b;
        break;
      }
    }
  }
  inp.mx = Math.sin(a);
  inp.mz = Math.cos(a);
  // stuck on something: wander off a different way for a moment
  ai.stuckT += dt;
  if (ai.stuckT > 0.8) {
    const moved = Math.hypot(f.x - ai.lastX, f.z - ai.lastZ);
    ai.stuckT = 0;
    ai.lastX = f.x;
    ai.lastZ = f.z;
    if (moved < 0.8 && ai.detourT <= 0) {
      // a wall someone built or a crate: break through it; anything else, go round
      const hit = castRay(m, f.x, f.z, inp.mx, inp.mz, 1.8, f.id, false, true);
      if (hit && (hit.what === 'built' || hit.what === 'crate')) {
        ai.smashT = 1;
        ai.smashA = a;
      } else {
        ai.detourT = 0.7 + m.rng() * 0.6;
        ai.detourA = a + (m.rng() < 0.5 ? 1 : -1) * (1.2 + m.rng() * 1.4);
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Reading the match.

/** Points for the solo leaderboard: damage dealt, 100 an elimination, 500 for the win. */
export const scoreOf = (f: Fighter, won: boolean) => Math.round(f.dealt) + f.kills * 100 + (won ? 500 : 0);

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function fmtClock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
