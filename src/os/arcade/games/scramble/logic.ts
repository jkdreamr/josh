// Scramble's simulation: eggs on the bus, gliding down, looting, shooting, building walls and outlasting the storm,
// plus the computer players. Pure, so it can be tested, and the same on every client.
//
// Online, each egg belongs to one client: yours to you, the computer players to the host. Only the owner moves an egg,
// heals it, and decides when it cracks. A bullet's damage is decided by whoever fired it, against the eggs where that
// client sees them, then sent to the egg's owner. The host settles everything shared: who got a pickup, when a chest
// opens or a crate or wall breaks, and who won. `world` is true where those calls are made (solo and the host).
import {
  AMMO_MAX,
  BANDAGE,
  HP_MAX,
  SHIELD,
  SHIELD_MAX,
  SPATULA,
  WALL_COST,
  WEAPONS,
  WEAPON_IDS,
  WOOD_MAX,
  damageOf,
  reloadOf,
  rng32,
  type Ammo,
  type LootDef,
  type Rng,
  type WeaponId,
} from './items.ts';
import {
  BUS_Y,
  EDGE,
  DROP_BASE,
  buildingAt,
  busAt,
  bushAt,
  generateMap,
  pushBox,
  pushCircle,
  pushObb,
  rayCircle,
  rayObb,
  raySolid,
  solidsAlong,
  solidsNear,
  stormAt,
  type GameMap,
  type Obb,
  type StormNow,
} from './map.ts';

export const COUNTDOWN = 3;
export const MAX_FIGHTERS = 8;
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
/** Remote eggs are drawn this far in the past, between the last two updates. */
export const INTERP = 0.1;
/** Where an egg's own drops start numbering, so no two clients ever pick the same loot id. */
export const dropId = (fid: number, n: number) => DROP_BASE + fid * 100_000 + (n % 100_000);
export const wallId = (fid: number, n: number) => fid * 100_000 + (n % 100_000);

/** Flag bits an owner reports with an egg's position. */
export const F_RELOAD = 1;
export const F_BANDAGE = 2;
export const F_SHIELDING = 4;
export const F_SHIELDED = 8;
export const F_HIT = 16;

export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];
export const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);
export type Role = 'solo' | 'host' | 'guest';
export type Phase = 'bus' | 'drop' | 'ground' | 'out';
export const PHASES: readonly Phase[] = ['bus', 'drop', 'ground', 'out'];
export type Kind = 'player' | 'bot' | 'remote';
/** What dealt a hit: a gun, the spatula, or the storm. */
export type Cause = WeaponId | 'spatula' | 'storm' | 'left';
export const CAUSES: readonly Cause[] = [...WEAPON_IDS, 'spatula', 'storm', 'left'];
export type Gun = { w: WeaponId; r: number; mag: number };
export type Use = 'bandage' | 'shield';

/** What a player or the computer wants this frame. The one-shot fields are cleared once read. */
export type Input = {
  mx: number;
  mz: number;
  aim: number;
  fire: boolean;
  reload: boolean;
  /** 0 and 1 are the gun slots, 2 the spatula; -1 for no change. */
  slot: number;
  cycle: number;
  interact: boolean;
  build: boolean;
  heal: boolean;
  shield: boolean;
  jump: boolean;
};
export const noInput = (): Input => ({ mx: 0, mz: 0, aim: 0, fire: false, reload: false, slot: -1, cycle: 0, interact: false, build: false, heal: false, shield: false, jump: false });

/** One position report for an egg another client owns. `at` is our clock when it arrived. */
export type Snap = { at: number; x: number; z: number; y: number; aim: number; vx: number; vz: number };

export type Ai = {
  goal: 'drop' | 'loot' | 'chest' | 'zone' | 'roam' | 'chase';
  gx: number;
  gz: number;
  item: number;
  chest: number;
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
  err: number;
  errT: number;
  burst: number;
  rest: number;
  buildCool: number;
  swapCool: number;
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
  slot: number;
  ammo: Record<Ammo, number>;
  bandages: number;
  shields: number;
  wood: number;
  fireT: number;
  reloadT: number;
  reloadSlot: number;
  using: Use | null;
  useT: number;
  buildT: number;
  stormT: number;
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
  bush: number;
  inside: number;
  input: Input;
  ai: Ai | null;
  /** Remote eggs: recent reports, newest last, and what they hold. */
  snaps: Snap[];
  show: { w: WeaponId | null; r: number; flags: number };
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

export type Thud = 'tree' | 'rock' | 'wall' | 'crate' | 'chest' | 'built' | 'egg' | 'ground';

/** Things that happened this frame, for sounds, effects and the network. `net` marks news that came from it. */
export type Ev = (
  | { t: 'beep' }
  | { t: 'go' }
  | { t: 'storm'; phase: number; shrinking: boolean }
  | { t: 'jump'; f: number }
  | { t: 'land'; f: number }
  | { t: 'shot'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number }
  | { t: 'swing'; f: number }
  | { t: 'hit'; f: number; to: number; d: number; w: Cause; x: number; z: number; shield: boolean; local: boolean }
  | { t: 'hurt'; f: number; d: number; by: number; storm: boolean; shield: boolean }
  | { t: 'thud'; x: number; z: number; what: Thud }
  | { t: 'smash'; f: number; kind: 'wall' | 'crate'; id: number; d: number; x: number; z: number }
  | { t: 'boom'; f: number; x: number; z: number }
  | { t: 'harvest'; f: number; x: number; z: number; n: number }
  | { t: 'reload'; f: number }
  | { t: 'reloaded'; f: number }
  | { t: 'empty'; f: number }
  | { t: 'use'; f: number; what: Use }
  | { t: 'used'; f: number; what: Use }
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
  /** Settles pickups, chests, crates, walls and the result (solo and the host). */
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
  loot: Map<number, LootItem>;
  walls: Map<number, Wall>;
  /** Loot and walls already gone, so news that arrives late can't bring them back. */
  gone: Set<number>;
  goneWalls: Set<number>;
  opened: boolean[];
  crateHp: number[];
  storm: StormNow;
  events: Ev[];
  rng: Rng;
  ended: boolean;
  winner: number;
};

export type Entrant = { name: string; color: string; kind: Kind; seat: number };

export const FIGHTER_COLORS = ['#e53935', '#1e88e5', '#3fae4a', '#fdd835', '#8e24aa', '#fb8c00', '#ec407a', '#00acc1'];
export const BOT_NAMES = ['Benedict', 'Sunny', 'Omelette', 'Frittata', 'Shelly', 'Quiche', 'Poach', 'Eggbert', 'Yolko', 'Deviled', 'Huevo', 'Florentine', 'Shakshuka', 'Tamago'];

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

type LevelSpec = { err: number; react: number; turn: number; sight: number; lead: number; burst: number; rest: number; build: number; heal: number };
export const LEVEL_SPECS: Record<Level, LevelSpec> = {
  easy: { err: 0.2, react: 0.85, turn: 3.2, sight: 32, lead: 0, burst: 0.45, rest: 0.6, build: 0, heal: 45 },
  normal: { err: 0.11, react: 0.5, turn: 6, sight: 42, lead: 0.5, burst: 0.8, rest: 0.35, build: 12, heal: 60 },
  hard: { err: 0.055, react: 0.28, turn: 9, sight: 52, lead: 1, burst: 1.4, rest: 0.2, build: 5, heal: 70 },
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
    slot: 2,
    ammo: { light: 0, heavy: 0, shells: 0, rockets: 0 },
    bandages: 0,
    shields: 0,
    wood: 30,
    fireT: 0,
    reloadT: 0,
    reloadSlot: -1,
    using: null,
    useT: 0,
    buildT: 0,
    stormT: 0,
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
  const near = spots.filter((p) => off(p) < 55);
  const pick = (near.length ? near : spots)[Math.floor(rng() * (near.length || spots.length))] ?? { x: 0, z: 0 };
  const jumpAt = clamp(along(pick) * bus.dur - off(pick) / GLIDE - 0.5 + rng() * 1.5, bus.on + rng() * 0.6, bus.off - 0.05);
  return { goal: 'drop', gx: pick.x + (rng() * 2 - 1) * 3, gz: pick.z + (rng() * 2 - 1) * 3, item: -1, chest: -1, target: -1, react: 0, strafe: rng() < 0.5 ? 1 : -1, strafeT: 0, think: 0, jumpAt, stuckT: 0, lastX: f.x, lastZ: f.z, detourT: 0, detourA: 0, err: 0, errT: 0, burst: 0, rest: 0, buildCool: 0, swapCool: 0 };
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
    loot: new Map(map.floor.map((s) => [s.id, { id: s.id, def: s.def, x: s.x, z: s.z, by: -1, at: 0 }])),
    walls: new Map(),
    gone: new Set(),
    goneWalls: new Set(),
    opened: map.containers.map(() => false),
    crateHp: map.containers.map(() => CRATE_HP),
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

/** A solo match: you and seven computer players. */
export function soloMatch(seed: number, level: Level, name = 'you', color = FIGHTER_COLORS[0]): Match {
  const bots = botNames(seed);
  const entrants: Entrant[] = [{ name, color, kind: 'player', seat: -1 }];
  for (let i = 1; i < MAX_FIGHTERS; i++) entrants.push({ name: bots[i - 1], color: FIGHTER_COLORS[i], kind: 'bot', seat: -1 });
  return createMatch({ seed, role: 'solo', level, entrants, me: 0 });
}

const emit = (m: Match, e: Ev) => {
  m.events.push(e);
};

/** What an egg holds: its gun, or null for the spatula. Remote eggs show what their owner reported. */
export function held(f: Fighter): { w: WeaponId | null; r: number } {
  if (f.kind === 'remote') return { w: f.show.w, r: f.show.r };
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  return g ? { w: g.w, r: g.r } : { w: null, r: 0 };
}

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
  if (m.world) settle(m);
}

function clearOneShots(inp: Input) {
  inp.reload = false;
  inp.slot = -1;
  inp.cycle = 0;
  inp.interact = false;
  inp.build = false;
  inp.heal = false;
  inp.shield = false;
  inp.jump = false;
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
  m.ended = true;
  m.winner = winner;
  m.events.push({ t: 'end', winner, net: true });
}

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
      emit(m, { t: 'jump', f: f.id });
    }
    clearOneShots(inp);
    return;
  }
  if (f.phase === 'drop') {
    const len = Math.hypot(inp.mx, inp.mz);
    const k = 1 - Math.exp(-5 * dt);
    f.vx += ((len > 0 ? (inp.mx / Math.max(1, len)) * GLIDE : 0) - f.vx) * k;
    f.vz += ((len > 0 ? (inp.mz / Math.max(1, len)) * GLIDE : 0) - f.vz) * k;
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
  if (f.slot < 2 && !f.guns[f.slot]) f.slot = 2;

  if (inp.slot >= 0 && inp.slot <= 2 && inp.slot !== f.slot && (inp.slot === 2 || f.guns[inp.slot])) switchTo(f, inp.slot);
  if (inp.cycle) {
    const order = [0, 1, 2].filter((s) => s === 2 || f.guns[s]);
    const at = order.indexOf(f.slot);
    switchTo(f, order[(at + (inp.cycle > 0 ? 1 : -1) + order.length) % order.length]);
  }
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
  if (inp.heal) startUse(m, f, 'bandage');
  if (inp.shield) startUse(m, f, 'shield');
  if (inp.build) build(m, f);
  if (inp.interact) interact(m, f);
  if (inp.fire && f.fireT <= 0) trigger(m, f);

  // walking
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  const speed = SPEED * (g ? WEAPONS[g.w].move : 1.06) * (f.using ? 0.5 : 1);
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

  f.bush = bushAt(m.map, f.x, f.z);
  f.inside = buildingAt(m.map, f.x, f.z);
  clearOneShots(inp);
}

function switchTo(f: Fighter, slot: number) {
  if (slot === f.slot) return;
  f.slot = slot;
  f.reloadT = 0;
  f.using = null;
  f.useT = 0;
  f.fireT = Math.max(f.fireT, 0.18);
}

/** Pushes an egg out of everything solid and keeps it on the island. */
function resolve(m: Match, f: Fighter) {
  for (let pass = 0; pass < 2; pass++) {
    solidsNear(m.map, f.x, f.z, FIGHTER_R + 2.5, (_i, s) => {
      if (s.what === 'crate' && m.opened[s.ref]) return;
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
  if (f.slot === 2) return swing(m, f);
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
  g.mag--;
  f.fireT = 1 / spec.rate;
  f.firedAt = m.clock;
  const moving = clamp(Math.hypot(f.vx, f.vz) / SPEED, 0, 1);
  const k = r2(1 + moving * 0.6);
  const s = Math.floor(m.rng() * 0x7fffffff);
  const a = r2(f.aim);
  const x = r2(f.x);
  const z = r2(f.z);
  fire(m, f.id, g.w, g.r, x, z, a, s, k, true);
  emit(m, { t: 'shot', f: f.id, w: g.w, r: g.r, x, z, a, s, k });
  if (g.mag <= 0 && f.ammo[spec.ammo] > 0) {
    // reload as soon as the last shot is away
    f.reloadT = reloadOf(g.w, g.r) + f.fireT * 0.5;
    f.reloadSlot = f.slot;
    emit(m, { t: 'reload', f: f.id });
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
  if (m.bullets.length > 600) m.bullets.splice(0, m.bullets.length - 600);
}

function startReload(m: Match, f: Fighter) {
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (!g || f.reloadT > 0) return;
  const spec = WEAPONS[g.w];
  if (g.mag >= spec.mag || f.ammo[spec.ammo] <= 0) return;
  f.using = null;
  f.useT = 0;
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

function startUse(m: Match, f: Fighter, what: Use) {
  if (f.using === what) return;
  if (what === 'bandage' ? f.bandages <= 0 || f.hp >= HP_MAX : f.shields <= 0 || f.shield >= SHIELD_MAX) return;
  f.using = what;
  f.useT = what === 'bandage' ? BANDAGE.time : SHIELD.time;
  f.reloadT = 0;
  emit(m, { t: 'use', f: f.id, what });
}

function finishUse(m: Match, f: Fighter) {
  const what = f.using;
  f.using = null;
  f.useT = 0;
  if (what === 'bandage' && f.bandages > 0) {
    f.bandages--;
    f.hp = Math.min(HP_MAX, f.hp + BANDAGE.heal);
  } else if (what === 'shield' && f.shields > 0) {
    f.shields--;
    f.shield = Math.min(SHIELD_MAX, f.shield + SHIELD.gain);
  } else return;
  emit(m, { t: 'used', f: f.id, what });
}

function swing(m: Match, f: Fighter) {
  f.fireT = 1 / SPATULA.rate;
  f.firedAt = m.clock;
  emit(m, { t: 'swing', f: f.id });
  // an egg in front of us first
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const o of m.fighters) {
    if (o === f || !fighting(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d > SPATULA.range + FIGHTER_R || d >= bestD) continue;
    if (Math.abs(angleDiff(Math.atan2(o.x - f.x, o.z - f.z), f.aim)) > SPATULA.arc) continue;
    best = o;
    bestD = d;
  }
  if (best) return strike(m, f, best, SPATULA.dmg, 'spatula', best.x, best.z);
  // then a wall, crate or tree just ahead
  const fx = Math.sin(f.aim);
  const fz = Math.cos(f.aim);
  const hit = castRay(m, f.x, f.z, fx, fz, SPATULA.range, -1, false);
  if (!hit) return;
  const x = f.x + fx * hit.t;
  const z = f.z + fz * hit.t;
  if (hit.what === 'tree') {
    const n = Math.min(SPATULA.wood, WOOD_MAX - f.wood);
    f.wood += n;
    emit(m, { t: 'harvest', f: f.id, x, z, n });
  } else if (hit.what === 'crate') smashCrate(m, f, hit.ref, SPATULA.dmg * SPATULA.wallMult, x, z);
  else if (hit.what === 'built') smashWall(m, f, hit.ref, SPATULA.dmg * SPATULA.wallMult, x, z);
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
 * Damage to an egg this client owns. Shields soak it first, except the storm's. Returns how much landed. Only eggs on
 * the ground can be hurt.
 */
export function hurt(m: Match, f: Fighter, d: number, by: number, w: Cause, storm: boolean) {
  if (!owned(f) || f.phase !== 'ground' || !(d > 0)) return 0;
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
  f.place = place;
  f.by = by;
  f.outCause = w;
  f.outAt = m.time;
  f.using = null;
  f.reloadT = 0;
  const killer = by >= 0 && by !== f.id ? m.fighters[by] : undefined;
  if (killer) killer.kills++;
  const spill: LootDef[] = [];
  for (const g of f.guns) if (g) spill.push({ kind: 'gun', w: g.w, r: g.r, mag: g.mag });
  for (const a of Object.keys(f.ammo) as Ammo[]) if (f.ammo[a] > 0) spill.push({ kind: 'ammo', a, n: f.ammo[a] });
  if (f.bandages > 0) spill.push({ kind: 'bandage', n: f.bandages });
  if (f.shields > 0) spill.push({ kind: 'shield', n: f.shields });
  if (f.wood >= 10) spill.push({ kind: 'wood', n: Math.floor(f.wood / 2) });
  f.guns = [null, null];
  f.ammo = { light: 0, heavy: 0, shells: 0, rockets: 0 };
  f.bandages = 0;
  f.shields = 0;
  f.wood = 0;
  spill.forEach((def, i) => {
    const a = (i / spill.length) * Math.PI * 2;
    const rad = spill.length > 1 ? 1.1 : 0;
    dropItem(m, f, def, clamp(f.x + Math.sin(a) * rad, -EDGE, EDGE), clamp(f.z + Math.cos(a) * rad, -EDGE, EDGE));
  });
  emit(m, { t: 'out', f: f.id, by, w, place });
}

/** An egg another client owns is out, on its owner's word. */
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
 * The first thing a ray meets within `len`: trees, rocks, building walls, closed crates, chests, built walls, and
 * (when `eggs`) any egg in the fight except `skip`.
 */
export function castRay(m: Match, x: number, z: number, dx: number, dz: number, len: number, skip: number, eggs: boolean): RayHit | null {
  let best = null as RayHit | null;
  solidsAlong(m.map, x, z, x + dx * len, z + dz * len, (_i, s) => {
    if (s.what === 'crate' && m.opened[s.ref]) return;
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
      else if (b.w === 'launcher' && b.local) blast(m, b, b.x, b.z);
      continue;
    }
    const x = b.x + b.dx * hit.t;
    const z = b.z + b.dz * hit.t;
    if (!b.local) {
      // someone else's bullet: their client decides what it did, we only draw where it stopped
      if (b.w !== 'launcher') emit(m, { t: 'thud', x, z, what: hit.what, net: true });
      continue;
    }
    if (b.w === 'launcher') {
      blast(m, b, x - b.dx * 0.3, z - b.dz * 0.3);
      continue;
    }
    const shooter = m.fighters[b.f];
    const d = b.dmg * falloff(b.w, b.traveled + hit.t);
    if (hit.fighter && shooter) strike(m, shooter, hit.fighter, d, b.w, x, z);
    else if (hit.what === 'crate' && shooter) smashCrate(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    else if (hit.what === 'built' && shooter) smashWall(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    else emit(m, { t: 'thud', x, z, what: hit.what });
  }
  m.bullets = keep;
}

/** A launcher egg bursts: eggs, walls and crates nearby take less the farther they are. */
function blast(m: Match, b: Bullet, x: number, z: number) {
  const shooter = m.fighters[b.f];
  const R = WEAPONS.launcher.splash ?? 4;
  emit(m, { t: 'boom', f: b.f, x: r2(x), z: r2(z) });
  if (!shooter) return;
  for (const o of m.fighters) {
    if (o.id === b.f || !fighting(o)) continue;
    const d = Math.max(0, Math.hypot(o.x - x, o.z - z) - HIT_R);
    if (d < R) strike(m, shooter, o, b.dmg * (1 - (0.6 * d) / R), 'launcher', o.x, o.z);
  }
  for (const w of [...m.walls.values()]) {
    const d = Math.max(0, Math.hypot(w.x - x, w.z - z) - WALL_HALF);
    if (d < R) smashWall(m, shooter, w.id, b.dmg * WEAPONS.launcher.wallMult * (1 - (0.6 * d) / R), w.x, w.z);
  }
  for (const c of m.map.containers) {
    if (c.kind !== 'crate' || m.opened[c.id]) continue;
    const d = Math.max(0, Math.hypot(c.x - x, c.z - z) - 0.7);
    if (d < R) smashCrate(m, shooter, c.id, b.dmg * WEAPONS.launcher.wallMult * (1 - (0.6 * d) / R), c.x, c.z);
  }
}

function smashWall(m: Match, by: Fighter, id: number, dmg: number, x: number, z: number) {
  const w = m.walls.get(id);
  if (!w) return;
  const d = Math.max(1, Math.round(dmg));
  emit(m, { t: 'smash', f: by.id, kind: 'wall', id, d, x: r2(x), z: r2(z) });
  damageWall(m, id, d, true);
}

function smashCrate(m: Match, by: Fighter, c: number, dmg: number, x: number, z: number) {
  if (m.opened[c] || m.map.containers[c]?.kind !== 'crate') return;
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

/** Crate damage from anyone. Only the host (or a solo game) breaks it open. */
export function damageCrate(m: Match, c: number, d: number, by: number, announce: boolean) {
  if (m.opened[c] || m.map.containers[c]?.kind !== 'crate') return;
  m.crateHp[c] -= d;
  if (m.world && m.crateHp[c] <= 0) openContainer(m, c, by, announce);
}

/** A crate breaks or a chest opens, and its loot spills out. Every client spills the same items with the same ids. */
export function openContainer(m: Match, c: number, by: number, announce: boolean) {
  const box = m.map.containers[c];
  if (!box || m.opened[c]) return;
  m.opened[c] = true;
  for (const l of box.loot) if (!m.gone.has(l.id)) m.loot.set(l.id, { id: l.id, def: l.def, x: l.x, z: l.z, by: -1, at: m.time });
  emit(m, announce ? { t: 'opened', c, f: by } : { t: 'opened', c, f: by, net: true });
}

// -------------------------------------------------------------------------------------------------------------------
// Building.

/** Builds a wall in front of an egg, square to where it aims (snapped to eighths of a turn). */
function build(m: Match, f: Fighter) {
  if (f.wood < WALL_COST || f.buildT > 0) return null;
  const a = r2(Math.round(f.aim / (Math.PI / 4)) * (Math.PI / 4));
  const x = r2(f.x + Math.sin(a) * WALL_DIST);
  const z = r2(f.z + Math.cos(a) * WALL_DIST);
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

/** Would an egg take this? Guns need an empty slot unless it's a swap the player asked for. */
export function wants(f: Fighter, def: LootDef, manual: boolean) {
  switch (def.kind) {
    case 'gun':
      return manual || f.guns[0] === null || f.guns[1] === null;
    case 'ammo':
      return f.ammo[def.a] < AMMO_MAX[def.a];
    case 'bandage':
      return f.bandages < BANDAGE.max;
    case 'shield':
      return f.shields < SHIELD.max;
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

/** The nearest closed chest within reach, or -1. */
export function nearestChest(m: Match, f: Fighter, reach = CHEST_R) {
  let best = -1;
  let bestD = reach * reach;
  for (const c of m.map.containers) {
    if (c.kind !== 'chest' || m.opened[c.id]) continue;
    const d = (c.x - f.x) * (c.x - f.x) + (c.z - f.z) * (c.z - f.z);
    if (d <= bestD) {
      best = c.id;
      bestD = d;
    }
  }
  return best;
}

/** What the interact key would do right now: open a chest, or pick something up (a gun swaps for the one in hand). */
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
  return { item, swap: item.def.kind === 'gun' && f.guns[0] !== null && f.guns[1] !== null };
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
  if (owned(f) && f.phase === 'ground') give(m, f, def);
  emit(m, { t: 'took', f: fid, id, def, net: true });
}

function give(m: Match, f: Fighter, def: LootDef) {
  switch (def.kind) {
    case 'gun': {
      const gun: Gun = { w: def.w, r: def.r, mag: def.mag ?? WEAPONS[def.w].mag };
      const slot = f.guns[0] === null ? 0 : f.guns[1] === null ? 1 : f.slot < 2 ? f.slot : 0;
      const old = f.guns[slot];
      f.guns[slot] = gun;
      if (old) dropItem(m, f, { kind: 'gun', w: old.w, r: old.r, mag: old.mag }, f.x, f.z);
      if (f.slot === 2 || f.slot === slot) {
        f.slot = slot;
        f.reloadT = 0;
        f.fireT = Math.max(f.fireT, 0.2);
      }
      break;
    }
    case 'ammo':
      f.ammo[def.a] = Math.min(AMMO_MAX[def.a], f.ammo[def.a] + def.n);
      break;
    case 'bandage':
      f.bandages = Math.min(BANDAGE.max, f.bandages + def.n);
      break;
    case 'shield':
      f.shields = Math.min(SHIELD.max, f.shields + def.n);
      break;
    case 'wood':
      f.wood = Math.min(WOOD_MAX, f.wood + def.n);
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
  return (f.reloadT > 0 ? F_RELOAD : 0) | (f.using === 'bandage' ? F_BANDAGE : 0) | (f.using === 'shield' ? F_SHIELDING : 0) | (f.shield > 0 ? F_SHIELDED : 0) | (f.hitT > 0 ? F_HIT : 0);
}

/** A position report for an egg another client owns. */
export function applyState(m: Match, f: Fighter, s: { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: WeaponId | null; r: number; flags: number }) {
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
  if (f.phase !== s.phase) snaps.length = 0;
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
    f.bush = bushAt(m.map, f.x, f.z);
    f.inside = buildingAt(m.map, f.x, f.z);
  } else {
    f.bush = -1;
    f.inside = -1;
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

const PREFER: Record<WeaponId | 'spatula', number> = { spatula: 1.2, shotgun: 5, smg: 10, pistol: 14, rifle: 20, launcher: 18, sniper: 34 };
const GUN_VALUE: Record<WeaponId, number> = { pistol: 10, smg: 20, rifle: 30, shotgun: 26, sniper: 22, launcher: 18 };
const gunValue = (g: Gun | null) => (g ? GUN_VALUE[g.w] + g.r * 7 : -1);

/** Hidden in a bush from someone more than a few steps away, until it fires. */
export function concealed(m: Match, f: Fighter, viewer: Fighter | undefined) {
  return !!viewer && f !== viewer && f.bush >= 0 && Math.hypot(f.x - viewer.x, f.z - viewer.z) > 4 && m.clock - f.firedAt > 1.2;
}

/** Can `a` see `b`? A bush hides an egg that keeps still and quiet until you're close, and walls hide everyone. */
export function canSee(m: Match, a: Fighter, b: Fighter, sight: number) {
  if (!fighting(b) || b === a) return false;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (d > sight) return false;
  if (concealed(m, b, a)) return false;
  return clearLine(m, a.x, a.z, b.x, b.z);
}

function hasAmmo(f: Fighter, g: Gun | null) {
  return !!g && (g.mag > 0 || f.ammo[WEAPONS[g.w].ammo] > 0);
}

/** The slot to fight with at a distance: the gun that likes it best, or the spatula. */
function bestSlot(f: Fighter, d: number) {
  let best = 2;
  // the spatula only when no gun has a shot left, or a weak one at point blank
  let score = d < 2.4 ? -0.9 : -Infinity;
  f.guns.forEach((g, i) => {
    if (!hasAmmo(f, g)) return;
    const s = -Math.abs(PREFER[g!.w] - d) / Math.max(4, PREFER[g!.w]) + g!.r * 0.05 + (WEAPONS[g!.w].range < d ? -2 : 0);
    if (s > score) {
      score = s;
      best = i;
    }
  });
  return best;
}

function think(m: Match, f: Fighter, dt: number) {
  const ai = f.ai!;
  const inp = f.input;
  const L = LEVEL_SPECS[m.level];
  inp.mx = 0;
  inp.mz = 0;
  inp.fire = false;
  if (f.phase === 'bus') {
    if (m.time >= ai.jumpAt) inp.jump = true;
    return;
  }
  if (f.phase === 'drop') {
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
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = 0.2 + m.rng() * 0.12;
    decide(m, f, ai, L);
  }

  const s = m.storm;
  const outside = Math.hypot(f.x - s.x, f.z - s.z) > s.r - 1;
  const tgt = ai.target >= 0 ? m.fighters[ai.target] : null;
  if (tgt && fighting(tgt)) {
    const dx = tgt.x - f.x;
    const dz = tgt.z - f.z;
    const d = Math.hypot(dx, dz);
    const want = bestSlot(f, d);
    if (want !== f.slot && ai.swapCool <= 0 && f.reloadT <= 0) {
      inp.slot = want;
      ai.swapCool = 0.8;
    }
    const g = f.slot < 2 ? f.guns[f.slot] : null;
    const speed = g ? WEAPONS[g.w].speed : 1e9;
    const lead = (d / speed) * L.lead;
    const ideal = Math.atan2(dx + tgt.vx * lead, dz + tgt.vz * lead);
    ai.errT -= dt;
    if (ai.errT <= 0) {
      ai.errT = 0.3 + m.rng() * 0.4;
      const moving = Math.min(1, Math.hypot(tgt.vx, tgt.vz) / SPEED);
      ai.err = (m.rng() * 2 - 1) * L.err * (0.6 + moving * 0.8) * (d > 25 ? 0.7 : 1);
    }
    const turn = angleDiff(ideal + ai.err, f.aim);
    const maxTurn = L.turn * dt;
    inp.aim = f.aim + clamp(turn, -maxTurn, maxTurn);
    const reach = g ? WEAPONS[g.w].range * 0.95 : SPATULA.range + 0.4;
    const aligned = Math.abs(angleDiff(inp.aim, ideal)) < 0.22 + (g ? WEAPONS[g.w].spread : 0.4);
    // bursts: shoot a while, rest a beat
    if (ai.burst > 0) ai.burst -= dt;
    else if (ai.rest > 0) ai.rest -= dt;
    else {
      ai.burst = L.burst * (0.6 + m.rng() * 0.8);
      ai.rest = L.rest * (0.6 + m.rng() * 0.8);
    }
    if (ai.react <= 0 && aligned && d < reach && ai.burst > 0 && clearLine(m, f.x, f.z, tgt.x, tgt.z)) inp.fire = true;
    // a wall between us when it gets hot
    if (L.build && ai.buildCool <= 0 && f.wood >= WALL_COST && f.hitT > 0 && f.hp + f.shield < 130 && d > 7) {
      inp.build = true;
      inp.aim = ideal;
      ai.buildCool = L.build * (0.7 + m.rng() * 0.6);
    }
    if (outside) {
      steer(m, f, ai, s.x, s.z, dt, 1);
    } else {
      const pref = g ? PREFER[g.w] : PREFER.spatula;
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
      mx += (dz / d) * ai.strafe * 0.8;
      mz += (-dx / d) * ai.strafe * 0.8;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) steer(m, f, ai, f.x + (mx / len) * 4, f.z + (mz / len) * 4, dt, 0);
    }
    return;
  }

  // nobody in sight: patch up, reload, then go where we mean to
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (!f.using) {
    if (f.hp < L.heal && f.bandages > 0) inp.heal = true;
    else if (f.shield < 50 && f.shields > 0) inp.shield = true;
    else if (g && g.mag < WEAPONS[g.w].mag * 0.6) inp.reload = true;
  }
  if (f.slot === 2 || !hasAmmo(f, g)) {
    const pick = f.guns.findIndex((x) => hasAmmo(f, x));
    if (pick >= 0 && pick !== f.slot) inp.slot = pick;
  }
  if (f.using && !outside) {
    // stand still behind cover while it takes
  } else steer(m, f, ai, ai.gx, ai.gz, dt, ai.goal === 'roam' ? 2 : 0.4);
  inp.aim = Math.hypot(f.vx, f.vz) > 0.5 ? Math.atan2(f.vx, f.vz) : f.aim;

  if (ai.goal === 'loot') {
    const l = m.loot.get(ai.item);
    if (!l) ai.think = 0;
    else if (Math.hypot(l.x - f.x, l.z - f.z) < PICK_R - 0.2 && l.def.kind === 'gun') {
      // swap our weaker gun for it
      const worst = f.guns[0] === null ? 0 : f.guns[1] === null ? 1 : gunValue(f.guns[0]) <= gunValue(f.guns[1]) ? 0 : 1;
      inp.slot = worst;
      inp.interact = true;
      ai.think = 0;
    }
  } else if (ai.goal === 'chest') {
    const c = m.map.containers[ai.chest];
    if (!c || m.opened[ai.chest]) ai.think = 0;
    else if (Math.hypot(c.x - f.x, c.z - f.z) < CHEST_R - 0.3) {
      inp.interact = true;
      ai.think = 0;
    }
  }
}

function decide(m: Match, f: Fighter, ai: Ai, L: LevelSpec) {
  // a target: the nearest egg we can see, sticking with the one we have, and turning on whoever just shot us
  const g = f.guns.some((x) => x && x.w === 'sniper' && hasAmmo(f, x));
  const sight = L.sight + (g ? 20 : 0);
  let best: Fighter | null = null;
  let bestScore = Infinity;
  for (const o of m.fighters) {
    if (o === f || !fighting(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    const hitMe = o.id === f.lastBy && m.clock - f.lastByAt < 3;
    if (!canSee(m, f, o, hitMe ? sight + 15 : sight)) continue;
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
  const worst = Math.min(gunValue(f.guns[0]), gunValue(f.guns[1]));
  let item: LootItem | null = null;
  let itemD = 55;
  for (const l of m.loot.values()) {
    if (!inSafe(l.x, l.z)) continue;
    const d = Math.hypot(l.x - f.x, l.z - f.z);
    if (d >= itemD) continue;
    const def = l.def;
    const useful =
      def.kind === 'gun'
        ? gunValue({ w: def.w, r: def.r, mag: 0 }) > worst + 3
        : def.kind === 'ammo'
          ? f.guns.some((x) => x && WEAPONS[x.w].ammo === def.a) && f.ammo[def.a] < AMMO_MAX[def.a] * 0.5
          : def.kind === 'wood'
            ? false
            : wants(f, def, false) && (def.kind === 'bandage' ? f.bandages < 3 : f.shields < 2);
    if (!useful || (l.by === f.id && m.time - l.at < 3)) continue;
    item = l;
    itemD = d;
  }
  let chest = -1;
  let chestD = armed ? 30 : 45;
  for (const c of m.map.containers) {
    if (c.kind !== 'chest' || m.opened[c.id] || !inSafe(c.x, c.z)) continue;
    const d = Math.hypot(c.x - f.x, c.z - f.z);
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
    ai.gz = c.z + c.face * 1.1;
    return;
  }
  if (ai.goal !== 'roam' || Math.hypot(ai.gx - f.x, ai.gz - f.z) < 3 || !inSafe(ai.gx, ai.gz)) {
    ai.goal = 'roam';
    const r = Math.max(2, safe.r * 0.7);
    for (let i = 0; i < 8; i++) {
      const x = safe.x + (m.rng() * 2 - 1) * r;
      const z = safe.z + (m.rng() * 2 - 1) * r;
      if (Math.abs(x) > EDGE - 4 || Math.abs(z) > EDGE - 4 || !inSafe(x, z)) continue;
      ai.gx = x;
      ai.gz = z;
      break;
    }
  }
}

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
    // try straight on, then ever wider either side
    const look = Math.min(2.4, d);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
      const b = a + turn;
      const ex = Math.sin(b);
      const ez = Math.cos(b);
      const side = 0.45;
      const blocked = [-side, 0, side].some((o) => castRay(m, f.x + ez * o, f.z - ex * o, ex, ez, look, f.id, false) !== null);
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
      ai.detourT = 0.7 + m.rng() * 0.6;
      ai.detourA = a + (m.rng() < 0.5 ? 1 : -1) * (1.2 + m.rng() * 1.4);
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
