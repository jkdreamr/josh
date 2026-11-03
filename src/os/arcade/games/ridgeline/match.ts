// The rules. Breach: two teams of five, one life a round, a buy phase and credits. The attack carries a charge to
// one of two sites and plants it; the defense stops the plant or defuses it before it blows. Sides swap at the half,
// first to 7 rounds wins. Royale: a hundred players drop from a transport, loot the land, and fight inside a shrinking
// zone until one is left. Deathmatch:
// everyone for themselves with quick respawns. Players and bots both act through the same Input, so the rules treat
// them alike. Pure TS: the renderer, the sound and the HUD read the state and the events after each step.
import { DM_HUBS, botInput, callout, newBrain, type Brain, type BotLevel } from './bots.ts';
import { blastCars, carHit, carNear, enterCar, hurtCar, leaveCar, rayCars, rideInput, spawnCars, stepCars, type Car } from './cars.ts';
import { fieldTo, navOf } from './nav.ts';
import { clamp, lerp, mulberry32, smoothstep, type Rng } from './noise.ts';
import { CROUCH_H, GRAVITY, STAND_H, blockedAt, clearLine, groundAt, newHit, raySphere, rayWorld, stepBody, type Body } from './physics.ts';
import { AMMO_KINDS, AMMO_OF, BOOST, BOOST_DRAIN, BOOST_FAST, BOOST_RUN, CHUTE_GLIDE, CHUTE_OPEN, CHUTE_VY, COMP_BLOOM, COMP_KICK, FALL_FAST, FALL_SLOW, FALL_VY, HEAL, HELMET, RED_EVERY, RED_FIRST, RED_GAP, RED_LIVE, RED_R, RED_WARN, ROYALE_PLAYERS, SHELL_DMG, SHELL_R, SUPPLY_FALL, SUPPLY_HIGH, SUPPLY_MAX, USE, VEST, ZONES, adsOf, adsTimeOf, ammoCap, attach, boostCap, boostHeal, fits, fitted, hasAtt, healCap, magOf, nadeCap, nextCircle, onLand, planeAt, planePath, spawnLoot, supplyContents, type AmmoKind, type AttKind, type BoostKind, type HealKind, type Item, type Mods, type Plane, type Red, type RoyaleNade, type Supply, type UseKind, type Zone as Circle, ROYALE_NADES } from './royale.ts';
import { floorAt, heightAt } from './terrain.ts';
import { ARMOR, KILL_REWARD, LOSS_REWARD, LOSS_STREAK_BONUS, MAX_CREDITS, NADES, PAVISE, START_CREDITS, WEAPONS, WIN_REWARD, applyDamage, interval, kickOf, rangeMul, type WeaponDef, type WeaponId } from './weapons.ts';
import { ARENA, SITE_R, SPAWN_R, yawTo, type Surface, type World } from './world.ts';

export type Mode = 'breach' | 'royale' | 'dm';
export type Level = BotLevel;
export type Zone = 'head' | 'body' | 'leg';
export type NadeKind = 'frag' | 'smoke' | 'flash' | 'fire' | 'impact' | 'decoy';
/** Breach also sells the ballistic shield (the Pavise). */
export type ShopItem = WeaponId | 'light' | 'heavy' | NadeKind | 'pavise';
export const NADE_KINDS: NadeKind[] = ['frag', 'smoke', 'flash', 'fire', 'impact', 'decoy'];

export const DEG = Math.PI / 180;
export const RUN = 5.8;
export const WALK = 3;
export const CROUCH_SPEED = 2.1;
export const JUMP = 6.2;
export const BULLET_G = 9.81;
export const ROUNDS_TO_WIN = 7;
/** Rounds in a half: the teams swap sides after this many. */
export const HALF = 6;
export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const END_TIME = 5;
/** Breach: seconds to plant, to defuse (half of it is kept once reached), the fuse once planted, the blast radius and
 * what the attack earns for a plant. */
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 7;
export const DEFUSE_HALF = 3.5;
export const FUSE = 40;
export const BLAST_R = 18;
export const PLANT_REWARD = 300;
/** How close a defender must be to the charge to work on it. */
export const DEFUSE_REACH = 1.8;
export const DM_KILLS = 25;
export const DM_TIME = 300;
export const RESPAWN = 3;

export type Input = {
  /** Strafe (+1 right) and forward (+1) axes, -1 to 1. */
  mx: number;
  mz: number;
  /** Where to look, radians. Positive pitch looks up. */
  yaw: number;
  pitch: number;
  fire: boolean;
  ads: boolean;
  crouch: boolean;
  walk: boolean;
  jump: boolean;
  reload: boolean;
  /** Switch to the primary (0), the sidearm (1) or the second primary (2), or -1. */
  slot: number;
  throw: NadeKind | null;
  buy: ShopItem | null;
  /** Held: plant or defuse (breach). Pressed: pick up what's at your feet (royale). */
  use: boolean;
  /** Patch yourself up (royale): a heal while one helps, else a boost. */
  heal: boolean;
  /** Pressed: get into the vehicle at hand, or out of the one you are in (royale). */
  ride: boolean;
  /** Take a boost (royale). */
  boost: boolean;
  /** Use this one thing from the kit (royale): a bandage, a med kit, a drink or the painkillers. */
  item: UseKind | null;
  /** Pressed: raise or lower the ballistic shield. */
  shield: boolean;
};
export const idleInput = (yaw = 0, pitch = 0): Input => ({ mx: 0, mz: 0, yaw, pitch, fire: false, ads: false, crouch: false, walk: false, jump: false, reload: false, slot: -1, throw: null, buy: null, use: false, heal: false, ride: false, boost: false, item: null, shield: false });

/** A gun carried: its id, rounds in the magazine, spare rounds (breach), whether bought this round (for a refund), and
 * (royale) what is fitted to it. */
export type Gun = { id: WeaponId; mag: number; reserve: number; fresh: boolean; mods?: Mods | null };

export type Actor = {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  brain: Brain | null;
  /** Picks the outfit and skin tone. */
  look: number;
  body: Body;
  yaw: number;
  pitch: number;
  crouch: number;
  alive: boolean;
  hp: number;
  armor: number;
  /** Primary, sidearm, and (royale) a second primary. */
  guns: [Gun | null, Gun | null, Gun | null];
  slot: 0 | 1 | 2;
  frags: number;
  smokes: number;
  /** Breach: flashbangs carried; how long it stays blinded, and how long that started at (for the fade). */
  flashes: number;
  /** Incendiaries, impact grenades and decoys carried. */
  fires: number;
  impacts: number;
  decoys: number;
  /** The ballistic shield: what it has left before it breaks (0: none carried), and whether it is raised (the sidearm
   * in the other hand). */
  pavise: number;
  paviseUp: boolean;
  /** Rounds still to come in a burst under way (a burst gun). */
  burstLeft: number;
  blindT: number;
  blind0: number;
  /** Breach, this round: knockouts and damage dealt. */
  roundKills: number;
  roundDmg: number;
  fireCd: number;
  fireHeld: boolean;
  reloadT: number;
  switchT: number;
  /** Aim down sights, 0 to 1. */
  ads: number;
  spray: number;
  lastShot: number;
  /** Breach: spare ammo coming back, part rounds not yet whole. */
  ammoBack: number;
  bloom: number;
  /** Recoil kick not yet recovered, degrees. */
  kickP: number;
  walking: boolean;
  credits: number;
  boughtArmor: number;
  /** Breach: the armor you bought, put back on at the start of every round. */
  armorKit: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  /** Combat score. */
  cs: number;
  dmgFrom: number[];
  hurtT: number;
  hurtFrom: number;
  deathT: number;
  killer: number;
  killedWith: Cause | null;
  killedHead: boolean;
  respawnT: number;
  shield: number;
  stepDist: number;
  /** Walk cycle phase for the animation. */
  phase: number;
  dmPick: WeaponId;
  /** Royale: rounds carried per ammo kind, vest, helmet and backpack levels, heals and boosts carried, the boost meter
   * (0 to 100), a heal or boost under way, the drop and the place. */
  ammo: Record<AmmoKind, number>;
  vest: number;
  helmet: number;
  pack: number;
  bandages: number;
  kits: number;
  drinks: number;
  pills: number;
  boost: number;
  healT: number;
  healKind: UseKind | null;
  /** 0 on the ground, 1 aboard the transport, 2 in freefall, 3 under the canopy. */
  drop: 0 | 1 | 2 | 3;
  /** Seconds in the air while dropping; once down, when it landed. */
  dropT: number;
  zoneT: number;
  /** Online: the room seat of the person playing it (-1 a bot), whether that person plays on another machine, and a
   * count of the times it was put somewhere new (a round start), so that machine knows to jump there. */
  seat: number;
  remote: boolean;
  epoch: number;
  net: RemoteIn | null;
  /** Where a body moved by the network last was (for its strides). */
  lastX: number;
  lastZ: number;
  /** Finishing place (royale), 0 while still in. */
  place: number;
  /** Royale: the vehicle it rides in (-1 on foot) and its seat there (0 drives), and when a vehicle last ran it down. */
  car: number;
  carSeat: number;
  runT: number;
};

/** `vis`: only seen, never hurts anyone (a shot this machine is shown but does not judge, online). */
export type Bullet = { x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number; owner: number; w: WeaponId; life: number; dist: number; live: boolean; vis?: boolean };
/** A grenade in the air or on the ground. A decoy also keeps the gun it plays, the time to its next fake shot and the
 * shots left in the burst under way. */
export type Nade = { kind: NadeKind; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; owner: number; rest: boolean; spin: number; w?: WeaponId; next?: number; left?: number };
/** A patch of burning ground from an incendiary: where, how big now, how long it has burned and will burn, whose it is,
 * and the time to its next bite. */
export type Fire = { x: number; y: number; z: number; r: number; age: number; life: number; owner: number; tick: number };
export type Smoke = { x: number; y: number; z: number; age: number; life: number; r: number };
/** `fake`: a decoy's gunfire (nobody is there). */
export type Sound = { x: number; z: number; t: number; team: number; range: number; who: number; fake?: boolean };
/** What took someone out: a gun, a frag, the zone, the breach charge, or (royale) a bombardment shell or a vehicle. */
export type Cause = WeaponId | 'frag' | 'fire' | 'impact' | 'zone' | 'blast' | 'shell' | 'car';
export type Kill = { t: number; killer: number; victim: number; w: Cause; head: boolean };
export type Why = 'elim' | 'time' | 'blast' | 'defuse';
/** Breach highlights: first blood, a headshot kill, two to five kills in a round (five is the whole team, an ace), and a
 * round won as the last one standing against two or more. */
export type Medal = 'first' | 'head' | 'double' | 'triple' | 'quad' | 'ace' | 'clutch';

/** Breach: where the charge is and what is being done to it. */
export type Charge = {
  state: 'carried' | 'dropped' | 'planted' | 'defused' | 'blown';
  /** Who carries it (carried), or -1. */
  holder: number;
  /** Where it lies (dropped or planted). */
  x: number;
  y: number;
  z: number;
  /** The site it is planted on, or -1. */
  site: number;
  /** Seconds left before it blows, once planted. */
  fuse: number;
  /** Who is planting it and how far along, or -1. */
  plantBy: number;
  plantT: number;
  /** Who is defusing it and how far along, and the progress kept from an earlier try (the half way mark). */
  defuseBy: number;
  defuseT: number;
  defuseKept: number;
};

export type Ev =
  | { t: 'shot'; a: number; w: WeaponId; x: number; y: number; z: number; dx: number; dy: number; dz: number; v?: number[] }
  | { t: 'impact'; x: number; y: number; z: number; nx: number; ny: number; nz: number; s: Surface }
  // (est: an online guest's own hit, shown at once with the damage it should do, before the host's word on it)
  | { t: 'hit'; a: number; v: number; dmg: number; zone: Zone; armor: boolean; x: number; y: number; z: number; kill: boolean; est?: number }
  | { t: 'kill'; k: Kill }
  | { t: 'boom'; x: number; y: number; z: number }
  | { t: 'smoke'; x: number; y: number; z: number }
  | { t: 'throw'; a: number; kind: NadeKind; n?: Nade }
  | { t: 'flash'; x: number; y: number; z: number }
  | { t: 'blind'; a: number; secs: number }
  | { t: 'medal'; a: number; kind: Medal; n: number }
  | { t: 'bounce'; x: number; y: number; z: number }
  | { t: 'reload'; a: number; w: WeaponId }
  | { t: 'empty'; a: number }
  | { t: 'step'; a: number; loud: boolean; s: Surface }
  | { t: 'jump'; a: number }
  | { t: 'land'; a: number }
  | { t: 'swap'; a: number }
  | { t: 'buy'; a: number; item: ShopItem }
  | { t: 'phase'; phase: Phase }
  | { t: 'round'; winner: number; why: Why }
  | { t: 'plant'; a: number; done: boolean; site: number }
  | { t: 'defuse'; a: number; done: boolean }
  | { t: 'carry'; a: number }
  | { t: 'dropcharge'; x: number; y: number; z: number }
  | { t: 'blast'; x: number; y: number; z: number }
  | { t: 'sides' }
  | { t: 'spawn'; a: number }
  | { t: 'pickup'; a: number; item: Item }
  | { t: 'heal'; a: number; done: boolean }
  | { t: 'jumpout'; a: number }
  | { t: 'chute'; a: number }
  | { t: 'zone'; i: number; shrinking: boolean }
  // royale only (never sent online): a supply crate on its way or landed, a bombardment marked, started or over,
  // and one of its shells going off
  | { t: 'supply'; x: number; z: number; landed: boolean }
  | { t: 'redzone'; x: number; z: number; r: number; stage: 'warn' | 'live' | 'clear' }
  | { t: 'shell'; x: number; y: number; z: number }
  | { t: 'car'; a: number; car: number; on: boolean }
  | { t: 'crash'; x: number; y: number; z: number; v: number }
  // (made on each machine, never sent online) an incendiary catching, a decoy's fake shot, and a bullet stopped by a
  // raised shield (`broke` when that was the end of it)
  | { t: 'fire'; x: number; y: number; z: number }
  | { t: 'decoy'; x: number; y: number; z: number; w: WeaponId }
  | { t: 'block'; a: number; v: number; x: number; y: number; z: number; broke: boolean };

export type Phase = 'buy' | 'live' | 'end' | 'over';

/** A hit an online guest says its own bullet made (the host checks it before anything happens). */
export type Claim = { v: number; zone: Zone; w: WeaponId; ox: number; oy: number; oz: number; x: number; y: number; z: number };
/** Online, on a guest: what its own player does that the host decides on. */
export type NetHooks = {
  fire(w: WeaponId, x: number, y: number, z: number, vel: number[]): void;
  hit(c: Claim): void;
  buy(item: ShopItem): void;
  throwNade(kind: NadeKind, yaw: number, pitch: number): void;
  /** Royale: pick up an item (by its id), start a heal or boost (null calls it off), get into a vehicle (its id: the
   * wheel of the one you sit in, if it is free) or out (-1), rounds loaded from the ammo carried, and a crash of the
   * vehicle you drive. The host decides each one. */
  pick?(item: number): void;
  heal?(kind: UseKind | null): void;
  ride?(car: number): void;
  spend?(kind: AmmoKind, n: number): void;
  crash?(car: number, hard: number): void;
};
/** Online, on the host: the latest of what a remote player's own machine says it is doing. */
export type RemoteIn = { use: boolean; ads: number; walking: boolean; crouch: number; reloading: boolean };

export type Match = {
  mode: Mode;
  level: Level;
  world: World;
  rng: Rng;
  actors: Actor[];
  time: number;
  phase: Phase;
  phaseT: number;
  round: number;
  score: [number, number];
  /** Breach: the team attacking this round, the charge, and per team the site its players last saw enemies push
   * (and when), which the bots use to rotate. */
  attack: number;
  charge: Charge;
  call: [{ site: number; t: number }, { site: number; t: number }];
  /** Breach: the site this round's attack goes for (the bots' plan). */
  aim: number;
  lossStreak: [number, number];
  last: { winner: number; why: Why } | null;
  bullets: Bullet[];
  nades: Nade[];
  smokes: Smoke[];
  fires: Fire[];
  sounds: Sound[];
  events: Ev[];
  feed: Kill[];
  /** Last time each actor was seen by your team. */
  spotted: number[];
  spotT: number;
  winner: number;
  /** Deathmatch clock. */
  clock: number;
  /** Royale: what lies around (bumped `lootVer` whenever it changes), the zone, the transport and who's left. */
  loot: Item[];
  lootVer: number;
  zone: Circle | null;
  plane: Plane | null;
  alive: number;
  /** Royale: supply crates dropped so far (falling or landed), the bombardment under way (or null), and the seconds
   * until the next one is marked. */
  supplies: Supply[];
  red: Red | null;
  redT: number;
  /** Royale: the vehicles (none in the other modes). */
  cars: Car[];
  /** Which actor is played on this machine, whether this machine runs the rules (solo and the online host) or only
   * mirrors them (an online guest), and a guest's line to the host. */
  me: number;
  authority: boolean;
  net: NetHooks | null;
  /** Breach, this round: whether first blood was drawn, and per team its last one standing and how many they faced. */
  firstBlood: boolean;
  clutch: [{ a: number; vs: number } | null, { a: number; vs: number } | null];
};

const BOT_NAMES = ['Vega', 'Rook', 'Sable', 'Juno', 'Kite', 'Onyx', 'Mako', 'Pike', 'Wren', 'Ash', 'Bishop', 'Cobalt', 'Drift', 'Ember', 'Flint', 'Haze', 'Ivy', 'Jett', 'Lark', 'Moss', 'Nova', 'Quill', 'Reed', 'Slate'];
/** Royale needs a hundred: callsigns plus the names above. */
const MORE_NAMES = ['Atlas', 'Badger', 'Brick', 'Canyon', 'Cedar', 'Cinder', 'Comet', 'Coyote', 'Crane', 'Dagger', 'Delta', 'Dusk', 'Echo', 'Falcon', 'Fable', 'Fox', 'Frost', 'Gale', 'Garnet', 'Ghost', 'Granite', 'Grizzly', 'Harbor', 'Hawk', 'Hollow', 'Hunter', 'Iron', 'Jackal', 'Jasper', 'Keel', 'Kestrel', 'Lancer', 'Lynx', 'Maple', 'Marsh', 'Mesa', 'Mustang', 'Nomad', 'North', 'Oak', 'Orbit', 'Otter', 'Pilot', 'Prairie', 'Quarry', 'Raven', 'Ridge', 'Rider', 'Rogue', 'Rust', 'Saber', 'Sage', 'Scout', 'Shadow', 'Shale', 'Sierra', 'Spruce', 'Storm', 'Summit', 'Talon', 'Thorn', 'Tundra', 'Valor', 'Viper', 'Volt', 'Warden', 'Whisky', 'Willow', 'Wolf', 'Yukon', 'Zephyr', 'Birch', 'Basalt', 'Condor', 'Delmar', 'Granger'];

function newActor(id: number, name: string, team: number, bot: boolean, level: Level, look: number): Actor {
  return {
    id,
    name,
    team,
    bot,
    brain: bot ? newBrain(level, id) : null,
    look,
    body: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, height: STAND_H, swim: false },
    yaw: 0,
    pitch: 0,
    crouch: 0,
    alive: true,
    hp: 100,
    armor: 0,
    guns: [null, gun('wren'), null],
    slot: 1,
    frags: 0,
    smokes: 0,
    flashes: 0,
    fires: 0,
    impacts: 0,
    decoys: 0,
    pavise: 0,
    paviseUp: false,
    burstLeft: 0,
    blindT: 0,
    blind0: 0,
    roundKills: 0,
    roundDmg: 0,
    fireCd: 0,
    fireHeld: false,
    reloadT: 0,
    switchT: 0,
    ads: 0,
    spray: 0,
    lastShot: -9,
    ammoBack: 0,
    bloom: 0,
    kickP: 0,
    walking: false,
    credits: START_CREDITS,
    boughtArmor: 0,
    armorKit: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    cs: 0,
    dmgFrom: [],
    hurtT: -9,
    hurtFrom: -1,
    deathT: -9,
    killer: -1,
    killedWith: null,
    killedHead: false,
    respawnT: 0,
    shield: 0,
    stepDist: 0,
    phase: 0,
    dmPick: 'kestrel',
    ammo: { light: 0, rifle: 0, shells: 0, magnum: 0, sniper: 0, bolts: 0 },
    vest: 0,
    helmet: 0,
    pack: 0,
    bandages: 0,
    kits: 0,
    drinks: 0,
    pills: 0,
    boost: 0,
    healT: 0,
    healKind: null,
    drop: 0,
    dropT: 0,
    zoneT: 0,
    place: 0,
    seat: bot ? -1 : 0,
    remote: false,
    epoch: 0,
    net: null,
    lastX: 0,
    lastZ: 0,
    car: -1,
    carSeat: -1,
    runT: -9,
  };
}

export const gun = (id: WeaponId): Gun => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, fresh: false });
const newCharge = (): Charge => ({ state: 'carried', holder: -1, x: 0, y: 0, z: 0, site: -1, fuse: 0, plantBy: -1, plantT: 0, defuseBy: -1, defuseT: 0, defuseKept: 0 });

/** Breach: which spawn a team starts from this round (0 the attackers', 1 the defenders'). */
export const sideOf = (m: Match, team: number) => (team === m.attack ? 0 : 1);
export const spawnOf = (m: Match, team: number) => m.world.spawns[sideOf(m, team)];

/** Online: who plays each place, from the first (breach: actors 0 to 4 are one team, 5 to 9 the other; a deathmatch
 * has as many places as entries, at least eight; a royale's entries are its first places, bots after them), and a
 * person's deathmatch gun. */
export type RosterEntry = { name: string; seat: number; bot: boolean; pick?: WeaponId };

export function createMatch(world: World, mode: Mode, level: Level, opts: { name?: string; seed?: number; dmPick?: WeaponId; roster?: RosterEntry[]; mySeat?: number } = {}): Match {
  const rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
  const names = [...BOT_NAMES, ...(mode === 'royale' ? MORE_NAMES : [])].sort(() => rng() - 0.5);
  const roster = opts.roster;
  const count = mode === 'royale' ? ROYALE_PLAYERS : mode === 'breach' ? 10 : Math.max(8, Math.min(10, roster?.length ?? 0));
  const actors: Actor[] = [];
  let me = 0;
  for (let i = 0; i < count; i++) {
    const team = mode === 'breach' ? (i < 5 ? 0 : 1) : i;
    const r = roster?.[i];
    const human = r ? !r.bot : i === 0;
    const a = newActor(i, r ? r.name : i === 0 ? (opts.name ?? 'You') : names[i % names.length], team, !human, level, Math.floor(rng() * 1e6));
    a.dmgFrom = new Array(count).fill(0);
    if (r) {
      a.seat = r.bot ? -1 : r.seat;
      a.remote = human && r.seat !== opts.mySeat;
      if (human && r.seat === opts.mySeat) me = i;
      if (r.pick && WEAPONS[r.pick]) a.dmPick = r.pick;
    }
    actors.push(a);
  }
  if (opts.dmPick) actors[0].dmPick = opts.dmPick;
  // the bots' map knowledge, built now so no frame pays for it mid round
  navOf(world);
  if (mode === 'breach') world.sites.forEach((s, k) => fieldTo(world, `site${k}`, s.x, s.z));
  // (a breach world has two sites; an older royale world's three never meet this mode)
  else if (mode === 'dm') world.dmSpawns.slice(0, DM_HUBS).forEach((p, k) => fieldTo(world, `dm${k}`, p.x, p.z));
  const m: Match = {
    mode,
    level,
    world,
    rng,
    actors,
    time: 0,
    phase: 'buy',
    phaseT: BUY_TIME,
    round: 0,
    score: [0, 0],
    attack: 0,
    charge: newCharge(),
    call: [
      { site: -1, t: -99 },
      { site: -1, t: -99 },
    ],
    aim: 0,
    lossStreak: [0, 0],
    last: null,
    bullets: [],
    nades: [],
    smokes: [],
    fires: [],
    sounds: [],
    events: [],
    feed: [],
    spotted: new Array(count).fill(-9),
    spotT: 0,
    winner: -1,
    clock: 0,
    loot: [],
    lootVer: 0,
    zone: null,
    plane: null,
    alive: count,
    supplies: [],
    red: null,
    redT: 0,
    cars: [],
    me,
    authority: true,
    net: null,
    firstBlood: false,
    clutch: [null, null],
  };
  if (mode === 'royale') startRoyale(m, opts.seed ?? Math.floor(rng() * 1e9));
  else if (mode === 'breach') {
    // which side you start on is a coin toss
    m.attack = rng() < 0.5 ? 0 : 1;
    startRound(m);
  }
  else {
    m.phase = 'live';
    m.phaseT = DM_TIME;
    for (const a of actors) {
      if (a.bot) a.dmPick = (['kestrel', 'talon', 'hornet', 'lancer', 'mauler', 'rampart', 'longbow', 'wasp', 'thresher', 'arbalest'] as WeaponId[])[Math.floor(rng() * 10)];
      respawn(m, a);
    }
  }
  return m;
}

export const eyeY = (a: Actor) => a.body.y + a.body.height - 0.14;
export const currentGun = (a: Actor) => a.guns[a.slot] ?? a.guns[1] ?? a.guns[0] ?? a.guns[2];
const NADE_FIELD = { frag: 'frags', smoke: 'smokes', flash: 'flashes', fire: 'fires', impact: 'impacts', decoy: 'decoys' } as const;
/** Grenades of a kind carried, and adding (or taking away) some. */
export const nadesOf = (a: Actor, k: NadeKind) => a[NADE_FIELD[k]];
export const addNades = (a: Actor, k: NadeKind, n: number) => {
  a[NADE_FIELD[k]] = Math.max(0, a[NADE_FIELD[k]] + n);
};
/** How far off a shot is heard (and how far the bots hear it). */
export const shotRange = (w: WeaponDef) => (w.cls === 'sniper' ? 160 : w.cls === 'crossbow' ? 30 : 90);
/** Rounds left to reload a gun from: endless in deathmatch, the carried ammo in a royale, else the gun's own. */
export const spareOf = (m: Match, a: Actor, g: Gun) => (m.mode === 'dm' ? Infinity : m.mode === 'royale' ? a.ammo[AMMO_OF[g.id]] : g.reserve);
export const isEnemy = (a: Actor, b: Actor) => a.team !== b.team;
export const me = (m: Match) => m.actors[m.me];

export function viewDir(yaw: number, pitch: number) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Hitbox spheres: [height above the feet as a share of body height, radius, zone]. */
// a touch generous, so a shot that looks like it hit, did
const HITBOX: [number, number, Zone][] = [
  [0.72, 0.27, 'body'],
  [0.54, 0.25, 'body'],
  [0.34, 0.2, 'leg'],
  [0.13, 0.18, 'leg'],
];
export const HEAD_R = 0.15;

/**
 * Where a ray (from o, unit direction d, up to len) meets an actor's raised shield, or -1. Only from the front: the
 * shield is a flat face held a little in front of the body, square to where it looks, its bottom edge high enough
 * standing that the shins and feet show under it (crouched it covers nearly everything).
 */
export function shieldHit(a: Actor, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) {
  if (!a.paviseUp || a.pavise <= 0 || !a.alive) return -1;
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  const den = dx * fx + dz * fz;
  if (den > -0.2) return -1;
  const cx = a.body.x + fx * PAVISE.ahead;
  const cz = a.body.z + fz * PAVISE.ahead;
  const t = ((cx - ox) * fx + (cz - oz) * fz) / den;
  if (t < 0 || t > len) return -1;
  const px = ox + dx * t - cx;
  const pz = oz + dz * t - cz;
  if (Math.abs(px * Math.cos(a.yaw) - pz * Math.sin(a.yaw)) > PAVISE.half) return -1;
  const bottom = a.body.y + lerp(PAVISE.low[0], PAVISE.low[1], a.crouch);
  const py = oy + dy * t;
  return py < bottom || py > bottom + PAVISE.tall ? -1 : t;
}

/** A raised shield takes a hit: it breaks once it has taken enough. True when that was the end of it. */
export function hurtShield(a: Actor, dmg: number) {
  if (a.pavise <= 0) return false;
  a.pavise = Math.max(0, a.pavise - dmg);
  if (a.pavise > 0) return false;
  a.paviseUp = false;
  return true;
}

/** The first hitbox (or raised shield) a segment crosses on any live actor other than the shooter's team. */
function hitActors(m: Match, b: Bullet, dx: number, dy: number, dz: number, len: number): { a: Actor; t: number; zone: Zone; shield: boolean } | null {
  let best: { a: Actor; t: number; zone: Zone; shield: boolean } | null = null;
  const shooter = m.actors[b.owner];
  for (const a of m.actors) {
    if (!a.alive || a.drop === 1 || a.id === b.owner || (shooter && !isEnemy(shooter, a))) continue;
    const cx = a.body.x;
    const cz = a.body.z;
    const h = a.body.height;
    // broad phase: the segment must pass within two meters of the actor's middle
    const mx = cx - b.px;
    const my = a.body.y + h / 2 - b.py;
    const mz = cz - b.pz;
    const along = clamp(mx * dx + my * dy + mz * dz, 0, len);
    if ((mx - dx * along) ** 2 + (my - dy * along) ** 2 + (mz - dz * along) ** 2 > 4) continue;
    // a raised shield in front stops what would have hit behind it
    const st: number = a.paviseUp ? shieldHit(a, b.px, b.py, b.pz, dx, dy, dz, best ? best.t : len) : -1;
    if (st >= 0) best = { a, t: st, zone: 'body', shield: true };
    const limit = best ? best.t : len;
    // the head leans forward with the pitch a little
    const f = viewDir(a.yaw, 0);
    const ht = raySphere(b.px, b.py, b.pz, dx, dy, dz, cx + f.x * 0.04, a.body.y + h - 0.13, cz + f.z * 0.04, HEAD_R, limit);
    if (ht >= 0) best = { a, t: ht, zone: 'head', shield: false };
    for (const [k, r, zone] of HITBOX) {
      const tt = raySphere(b.px, b.py, b.pz, dx, dy, dz, cx, a.body.y + h * k, cz, r, best ? best.t : len);
      if (tt >= 0) best = { a, t: tt, zone, shield: false };
    }
  }
  return best;
}

const hit = newHit();

function stepBullets(m: Match, dt: number) {
  const w = m.world;
  for (const b of m.bullets) {
    if (!b.live) continue;
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.vy -= BULLET_G * dt;
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;
    const nz = b.z + b.vz * dt;
    let dx = nx - b.x;
    let dy = ny - b.y;
    let dz = nz - b.z;
    const len = Math.hypot(dx, dy, dz);
    b.life -= dt;
    if (len < 1e-6) continue;
    dx /= len;
    dy /= len;
    dz /= len;
    rayWorld(w, b.x, b.y, b.z, dx, dy, dz, len, hit);
    let wallT = hit.kind === 'none' ? len : hit.t;
    // a vehicle in the way (never the shooter's own): the hull stops it, short of whoever sits behind it
    const car = m.cars.length && rayCars(m, b.x, b.y, b.z, dx, dy, dz, wallT, m.actors[b.owner]?.car ?? -1) ? carHit.car : -1;
    if (car >= 0) wallT = carHit.t;
    const who = hitActors(m, b, dx, dy, dz, wallT);
    if (who) {
      const def = WEAPONS[b.w];
      const travelled = b.dist + who.t;
      const mul = who.zone === 'head' ? def.head : who.zone === 'leg' ? def.leg : 1;
      const hx = b.x + dx * who.t;
      const hy = b.y + dy * who.t;
      const hz = b.z + dz * who.t;
      if (who.shield) {
        // stopped by a raised shield: it takes the hit (the host judges a remote player's shots at it too)
        const v = who.a;
        const broke = m.authority && (!b.vis || !!m.actors[b.owner]?.remote) && hurtShield(v, def.dmg * rangeMul(def, travelled));
        m.events.push({ t: 'impact', x: hx, y: hy, z: hz, nx: -Math.sin(v.yaw), ny: 0, nz: -Math.cos(v.yaw), s: 'metal' });
        m.events.push({ t: 'block', a: b.owner, v: v.id, x: hx, y: hy, z: hz, broke });
      } else if (b.vis) {
        // only a picture of someone else's shot: it stops where it seems to hit, and the host says what it did
      } else if (m.authority) damage(m, who.a, def.dmg * mul * rangeMul(def, travelled), b.owner, b.w, who.zone, hx, hy, hz);
      else if (b.owner === m.me && m.net) {
        // a guest's own shot: tell the host (who checks it), and show the hit marker now
        m.net.hit({ v: who.a.id, zone: who.zone, w: b.w, ox: b.x - (b.vx / Math.hypot(b.vx, b.vy, b.vz)) * b.dist, oy: b.y - (b.vy / Math.hypot(b.vx, b.vy, b.vz)) * b.dist, oz: b.z - (b.vz / Math.hypot(b.vx, b.vy, b.vz)) * b.dist, x: hx, y: hy, z: hz });
        m.events.push({ t: 'hit', a: m.me, v: who.a.id, dmg: 0, zone: who.zone, armor: who.a.armor > 0, x: hx, y: hy, z: hz, kill: false, est: Math.round(def.dmg * mul * rangeMul(def, travelled)) });
      }
      b.x = hx;
      b.y = hy;
      b.z = hz;
      b.live = false;
      continue;
    }
    if (car >= 0) {
      b.x += dx * wallT;
      b.y += dy * wallT;
      b.z += dz * wallT;
      b.live = false;
      const def = WEAPONS[b.w];
      if (!b.vis && m.authority) hurtCar(m, m.cars[car], def.dmg * 0.75 * rangeMul(def, b.dist + wallT), b.owner);
      m.events.push({ t: 'impact', x: b.x, y: b.y, z: b.z, nx: carHit.nx, ny: carHit.ny, nz: carHit.nz, s: 'metal' });
      continue;
    }
    if (hit.kind !== 'none') {
      b.x += dx * hit.t;
      b.y += dy * hit.t;
      b.z += dz * hit.t;
      b.live = false;
      m.events.push({ t: 'impact', x: b.x, y: b.y, z: b.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, s: hit.s });
      continue;
    }
    b.x = nx;
    b.y = ny;
    b.z = nz;
    b.dist += len;
    if (b.life <= 0 || b.dist > 900 || Math.abs(b.x) > 520 || Math.abs(b.z) > 520) b.live = false;
  }
  // keep the list short: the renderer still sees a bullet on the frame it stops
  if (m.bullets.length > 64) m.bullets = m.bullets.filter((b) => b.live);
}

/** Online, on the host: a guest's hit, once checked (see online.ts), hurts like any other. */
export function applyHit(m: Match, from: number, v: Actor, w: WeaponId, zone: Zone, dist: number, x: number, y: number, z: number) {
  const def = WEAPONS[w];
  const mul = zone === 'head' ? def.head : zone === 'leg' ? def.leg : 1;
  damage(m, v, def.dmg * mul * rangeMul(def, dist), from, w, zone, x, y, z);
}

/** Online, on the host: a guest's grenade, thrown here from where its player is. */
export function throwFor(m: Match, a: Actor, kind: NadeKind) {
  throwNade(m, a, kind);
}

/** How much more health a person has than a bot (the health bar is the same, every hit takes less of it). */
export const PERSON_HEALTH = 1.5;

/** How hard a bot's shots and grenades hit a person, by level (bots hit each other at full strength), so a person
 * survives long enough to react, turn and fight back. */
export const BOT_HITS_PEOPLE: Record<Level, number> = { easy: 0.45, normal: 0.6, hard: 0.8 };

export function damage(m: Match, v: Actor, raw: number, from: number, w: Exclude<Cause, 'zone'>, zone: Zone, x: number, y: number, z: number) {
  // (an online guest's crashes and run overs are pictures: the host does the damage)
  if (!v.alive || raw <= 0 || !m.authority) return;
  if (v.shield > 0) return;
  if (zone === 'head') raw *= HELMET[v.helmet];
  if (!v.bot && w !== 'blast' && m.actors[from]?.bot) raw *= BOT_HITS_PEOPLE[m.level];
  if (!v.bot) raw /= PERSON_HEALTH;
  v.healT = 0;
  v.healKind = null;
  const before = v.hp + v.armor;
  // (armor does nothing against fire)
  const res = applyDamage(v.hp, v.armor, raw, w === 'fire' ? 0 : w === 'frag' || w === 'impact' || w === 'blast' || w === 'shell' || w === 'car' ? 1 : WEAPONS[w].armorPen);
  const hadArmor = v.armor > 0;
  v.hp = res.hp;
  v.armor = Math.max(0, res.armor);
  if (v.armor <= 0) v.vest = 0;
  const dealt = Math.min(before, raw);
  const att = m.actors[from];
  if (att && att !== v) {
    if (isEnemy(att, v)) att.roundDmg += dealt;
    att.damage += dealt;
    att.cs += Math.round(dealt);
    v.dmgFrom[from] = (v.dmgFrom[from] ?? 0) + dealt;
  }
  v.hurtT = m.time;
  v.hurtFrom = from;
  const kill = v.hp <= 0;
  m.events.push({ t: 'hit', a: from, v: v.id, dmg: Math.round(dealt), zone, armor: hadArmor, x, y, z, kill });
  if (kill) die(m, v, from, w, zone === 'head');
}

function die(m: Match, v: Actor, from: number, w: Cause, head: boolean) {
  // knocked out in a vehicle: the body (and what it carried) falls beside it
  if (v.car >= 0) leaveCar(m, v);
  v.alive = false;
  v.hp = 0;
  v.deathT = m.time;
  v.killer = from;
  v.killedWith = w;
  v.killedHead = head;
  v.deaths++;
  v.reloadT = 0;
  v.ads = 0;
  v.paviseUp = false;
  const att = m.actors[from];
  if (att && att !== v && isEnemy(att, v)) {
    att.kills++;
    att.cs += 150 + (head ? 30 : 0);
    if (m.mode === 'breach') {
      att.credits = Math.min(MAX_CREDITS, att.credits + KILL_REWARD);
      // the highlights: first blood, then a multi kill (or a headshot, the smaller one)
      att.roundKills++;
      const n = att.roundKills;
      const multi = n >= 5 ? 'ace' : n === 4 ? 'quad' : n === 3 ? 'triple' : n === 2 ? 'double' : null;
      if (multi) m.events.push({ t: 'medal', a: att.id, kind: multi, n });
      else if (!m.firstBlood) m.events.push({ t: 'medal', a: att.id, kind: 'first', n: 1 });
      else if (head) m.events.push({ t: 'medal', a: att.id, kind: 'head', n: 1 });
      m.firstBlood = true;
    }
  }
  for (const o of m.actors)
    if (o !== att && o !== v && isEnemy(o, v) && (v.dmgFrom[o.id] ?? 0) >= 40) {
      o.assists++;
      o.cs += 50;
    }
  v.dmgFrom.fill(0);
  const k: Kill = { t: m.time, killer: from, victim: v.id, w, head };
  m.feed.push(k);
  if (m.feed.length > 8) m.feed.shift();
  m.events.push({ t: 'kill', k });
  if (m.mode === 'breach') {
    // a teammate down near a site tells the rest where the fight is
    callout(m, v.team, v.body.x, v.body.z);
    // down to one: a clutch if that one wins it against two or more
    if (m.phase === 'live' && !m.clutch[v.team]) {
      const mates = m.actors.filter((o) => o.alive && o.team === v.team);
      const foes = m.actors.filter((o) => o.alive && o.team !== v.team).length;
      if (mates.length === 1 && foes >= 2) m.clutch[v.team] = { a: mates[0].id, vs: foes };
    }
    // (your guns, armor and grenades are yours for the match: a knockout takes nothing, the next round you have it all)
    const c = m.charge;
    if (c.plantBy === v.id) {
      c.plantBy = -1;
      c.plantT = 0;
    }
    if (c.defuseBy === v.id) {
      c.defuseBy = -1;
      c.defuseT = 0;
    }
    // the charge falls where its carrier fell
    if (c.state === 'carried' && c.holder === v.id) {
      c.state = 'dropped';
      c.holder = -1;
      c.x = v.body.x;
      c.z = v.body.z;
      c.y = groundAt(m.world, v.body.x, v.body.z, v.body.y + 0.5);
      m.events.push({ t: 'dropcharge', x: c.x, y: c.y, z: c.z });
    }
  } else if (m.mode === 'dm') v.respawnT = RESPAWN;
  else {
    v.place = m.alive;
    m.alive--;
    dropAll(m, v);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// rounds

function place(m: Match, a: Actor, x: number, z: number, yaw: number) {
  a.epoch++;
  const y = floorAt(m.world.terrain, x, z) + 0.05;
  a.body.x = x;
  a.body.z = z;
  a.body.y = y;
  a.body.vx = a.body.vy = a.body.vz = 0;
  a.body.onGround = true;
  a.body.height = STAND_H;
  a.crouch = 0;
  a.yaw = yaw;
  a.pitch = 0;
}

function resetCombat(a: Actor) {
  a.fireCd = 0;
  a.reloadT = 0;
  a.switchT = 0;
  a.ads = 0;
  a.spray = 0;
  a.bloom = 0;
  a.kickP = 0;
  a.fireHeld = false;
  a.blindT = 0;
  a.blind0 = 0;
  a.burstLeft = 0;
  a.paviseUp = false;
}

export function startRound(m: Match) {
  m.round++;
  // the half: the sides swap (everyone keeps what they have)
  const swap = m.round === HALF + 1;
  if (swap) {
    m.attack = 1 - m.attack;
    m.lossStreak = [0, 0];
    m.events.push({ t: 'sides' });
  }
  const pistol = m.round === 1;
  m.phase = 'buy';
  m.phaseT = BUY_TIME + (pistol ? 5 : 0);
  m.aim = Math.floor(m.rng() * m.world.sites.length);
  m.call = [
    { site: -1, t: -99 },
    { site: -1, t: -99 },
  ];
  m.bullets = [];
  m.nades = [];
  m.smokes = [];
  m.fires = [];
  m.sounds = [];
  m.last = null;
  m.firstBlood = false;
  m.clutch = [null, null];
  const seen = [0, 0];
  for (const a of m.actors) {
    const s = spawnOf(m, a.team);
    const slot = s.slots[seen[a.team]++ % s.slots.length];
    // your loadout carries over (alive or not): guns refilled, armor put back on
    if (!a.guns[1]) a.guns[1] = gun('wren');
    a.armor = Math.max(a.armor, a.armorKit);
    // a shield still in one piece is good as new again
    if (a.pavise > 0) a.pavise = PAVISE.hp;
    for (const g of a.guns) if (g) {
      g.mag = WEAPONS[g.id].mag;
      g.reserve = WEAPONS[g.id].reserve;
      g.fresh = false;
    }
    a.boughtArmor = 0;
    a.alive = true;
    a.hp = 100;
    a.slot = a.guns[0] ? 0 : a.guns[2] ? 2 : 1;
    a.dmgFrom.fill(0);
    a.roundKills = 0;
    a.roundDmg = 0;
    resetCombat(a);
    place(m, a, slot.x, slot.z, slot.yaw);
    if (a.brain) a.brain.reset = true;
  }
  // the charge starts with one of the attackers
  const attackers = m.actors.filter((a) => a.team === m.attack);
  m.charge = newCharge();
  m.charge.holder = attackers[Math.floor(m.rng() * attackers.length)].id;
  m.events.push({ t: 'phase', phase: 'buy' });
}

function endRound(m: Match, winner: number, why: Why) {
  m.phase = 'end';
  m.phaseT = END_TIME;
  m.last = { winner, why };
  m.charge.plantBy = -1;
  m.charge.defuseBy = -1;
  if (winner >= 0) {
    m.score[winner]++;
    m.lossStreak[winner] = 0;
    m.lossStreak[1 - winner]++;
  }
  for (const a of m.actors) {
    const won = winner === a.team;
    const pay = won ? WIN_REWARD : LOSS_REWARD + (winner >= 0 ? LOSS_STREAK_BONUS * Math.min(2, m.lossStreak[a.team] - 1) : 0);
    a.credits = Math.min(MAX_CREDITS, a.credits + pay);
    if (won) a.cs += 60;
  }
  m.events.push({ t: 'round', winner, why });
  const cl = winner >= 0 ? m.clutch[winner] : null;
  if (cl && m.actors[cl.a].alive) m.events.push({ t: 'medal', a: cl.a, kind: 'clutch', n: cl.vs });
}

function respawn(m: Match, a: Actor) {
  const pts = m.world.dmSpawns;
  let best = pts[0];
  let bestD = -1;
  for (const p of pts) {
    let near = Infinity;
    for (const o of m.actors) if (o !== a && o.alive) near = Math.min(near, Math.hypot(o.body.x - p.x, o.body.z - p.z));
    const d = near + m.rng() * 25;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  a.alive = true;
  a.hp = 100;
  a.armor = 25;
  a.guns = [gun(a.dmPick), gun('wren'), null];
  a.slot = 0;
  a.frags = 1;
  a.smokes = 0;
  a.shield = 1.5;
  a.dmgFrom.fill(0);
  resetCombat(a);
  place(m, a, best.x, best.z, best.yaw);
  m.events.push({ t: 'spawn', a: a.id });
}

// ---------------------------------------------------------------------------------------------------------------
// royale

function startRoyale(m: Match, seed: number) {
  const w = m.world;
  m.phase = 'live';
  m.loot = spawnLoot(w, seed);
  for (const it of m.loot) if (it.kind === 'gun') it.n = WEAPONS[it.what as WeaponId].mag;
  m.lootVer++;
  m.cars = spawnCars(w, seed);
  m.plane = planePath(w, m.rng);
  const z0 = ZONES[0];
  const r0 = w.arena * 1.45;
  const [nx, nz] = nextCircle(w, m.rng, 0, 0, r0 * 0.75, z0.r);
  m.zone = { i: 0, t: z0.wait, shrinking: false, x: 0, z: 0, r: r0, fx: 0, fz: 0, fr: r0, nx, nz, nr: z0.r, dps: z0.dps };
  m.redT = RED_FIRST[0] + m.rng() * (RED_FIRST[1] - RED_FIRST[0]);
  const p = planeAt(m.plane, 0);
  const yaw = yawTo(m.plane.bx - m.plane.ax, m.plane.bz - m.plane.az);
  for (const a of m.actors) {
    a.guns = [null, null, null];
    a.slot = 0;
    a.armor = 0;
    a.frags = 0;
    a.smokes = 0;
    a.drop = 1;
    a.body.x = p.x;
    a.body.z = p.z;
    a.body.y = m.plane.y;
    a.body.vx = a.body.vy = a.body.vz = 0;
    a.body.onGround = false;
    a.yaw = yaw;
    a.pitch = -0.4;
    // a hundred bots at breach sharpness would end it in a minute: slower to react, a little less sure of aim
    if (a.brain) {
      a.brain.react *= 1.45;
      a.brain.skill *= 0.88;
    }
  }
}

/** Puts something on the ground (a gun with what is fitted to it; `by` whoever put it there, if anyone). */
function dropItem(m: Match, kind: Item['kind'], what: string, n: number, x: number, z: number, y: number, mods: Mods | null = null, by = -1) {
  m.loot.push({ id: m.loot.length, kind, what, n, x, y, z, live: true, mods: mods && (mods.sight || mods.ext || mods.comp) ? mods : null, by });
}

/** Everything a fallen player carried, spread on the ground around them. */
function dropAll(m: Match, v: Actor) {
  const b = v.body;
  const y = floorAt(m.world.terrain, b.x, b.z) > b.y + 0.6 ? floorAt(m.world.terrain, b.x, b.z) : Math.max(b.y, floorAt(m.world.terrain, b.x, b.z)) + 0.02;
  const things: [Item['kind'], string, number, Mods | null][] = [];
  for (const g of v.guns) if (g) things.push(['gun', g.id, g.mag, g.mods ?? null]);
  for (const k of AMMO_KINDS) if (v.ammo[k] > 0) things.push(['ammo', k, v.ammo[k], null]);
  if (v.vest > 0 && v.armor > 0) things.push(['vest', String(v.vest), 1, null]);
  if (v.helmet > 0) things.push(['helmet', String(v.helmet), 1, null]);
  if (v.pack > 0) things.push(['pack', String(v.pack), 1, null]);
  if (v.kits > 0) things.push(['heal', 'kit', v.kits, null]);
  if (v.bandages > 0) things.push(['heal', 'bandage', v.bandages, null]);
  if (v.drinks > 0) things.push(['boost', 'drink', v.drinks, null]);
  if (v.pills > 0) things.push(['boost', 'pills', v.pills, null]);
  for (const k of ROYALE_NADES) if (nadesOf(v, k) > 0) things.push(['nade', k, nadesOf(v, k), null]);
  if (v.pavise > 0) things.push(['shield', '1', Math.ceil(v.pavise), null]);
  things.forEach(([kind, what, n, mods], i) => {
    const a = (i / Math.max(1, things.length)) * Math.PI * 2 + v.id;
    const r = 0.5 + (i % 2) * 0.4;
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    dropItem(m, kind, what, n, x, z, Math.max(y, floorAt(m.world.terrain, x, z) + 0.02), mods);
  });
  v.guns = [null, null, null];
  for (const k of AMMO_KINDS) v.ammo[k] = 0;
  v.vest = v.helmet = v.pack = v.kits = v.bandages = v.drinks = v.pills = 0;
  for (const k of ROYALE_NADES) addNades(v, k, -nadesOf(v, k));
  v.pavise = 0;
  v.paviseUp = false;
  v.boost = 0;
  v.armor = 0;
  m.lootVer++;
}

/** The item an actor would pick up now: close, the one most in front, and (for bots) one it actually wants. */
export function lootNear(m: Match, a: Actor, reach = 2.1, wantedOnly = false): Item | null {
  if (m.mode !== 'royale' || !a.alive || a.drop || a.car >= 0) return null;
  const b = a.body;
  const f = viewDir(a.yaw, 0);
  let best: Item | null = null;
  let bestS = Infinity;
  for (const it of m.loot) {
    if (!it.live) continue;
    const dx = it.x - b.x;
    const dz = it.z - b.z;
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
    const d = Math.hypot(dx, dz);
    if (d > reach || it.y < b.y - 1.2 || it.y > b.y + 1.4) continue;
    const useful = wants(a, it);
    if (wantedOnly && !useful) continue;
    // something you can use beats something you can't, then the closest and most in front
    const s = d - (d > 0.01 ? ((dx * f.x + dz * f.z) / d) * 0.9 : 0.9) - (useful ? 3 : 0);
    if (s < bestS) {
      bestS = s;
      best = it;
    }
  }
  return best;
}

/** What a person walking by picks up on their own: anything that helps without giving something up. */
function autoLoot(m: Match, a: Actor): Item | null {
  if (!a.alive || a.drop || a.healT > 0 || a.car >= 0) return null;
  const b = a.body;
  for (const it of m.loot) {
    if (!it.live) continue;
    const dx = it.x - b.x;
    const dz = it.z - b.z;
    if (Math.abs(dx) > 1.6 || Math.abs(dz) > 1.6 || dx * dx + dz * dz > 1.6 * 1.6 || it.y < b.y - 1.2 || it.y > b.y + 1.4) continue;
    // (never what you put down yourself: a backpack you swapped out, the overflow it left)
    if (it.by === a.id || !wants(a, it)) continue;
    // a gun only into an empty slot: swapping the one you carry is your call (F)
    if (it.kind === 'gun' && (WEAPONS[it.what as WeaponId].slot === 'secondary' ? !!a.guns[1] : !!a.guns[0] && !!a.guns[2])) continue;
    return it;
  }
  return null;
}

/** Would picking this up help (a better vest, ammo with room for it, a gun, ...)? */
export function wants(a: Actor, it: Item) {
  switch (it.kind) {
    case 'gun': {
      const id = it.what as WeaponId;
      if (a.guns.some((g) => g?.id === id)) return false;
      if (WEAPONS[id].slot === 'secondary') return !a.guns[1];
      return !a.guns[0] || !a.guns[2] || (a.guns[0].id !== id && WEAPONS[id].price > Math.min(WEAPONS[a.guns[0].id].price, WEAPONS[a.guns[2].id].price) + 400);
    }
    case 'ammo':
      return a.ammo[it.what as AmmoKind] < ammoCap(a.pack, it.what as AmmoKind);
    case 'vest':
      return Number(it.what) > a.vest || (Number(it.what) === a.vest && a.armor < VEST[a.vest] * 0.6);
    case 'helmet':
      return Number(it.what) > a.helmet;
    case 'heal':
      return it.what === 'kit' ? a.kits < healCap(a.pack, 'kit') : a.bandages < healCap(a.pack, 'bandage');
    case 'boost':
      return it.what === 'drink' ? a.drinks < boostCap(a.pack, 'drink') : a.pills < boostCap(a.pack, 'pills');
    case 'pack':
      return Number(it.what) > a.pack;
    case 'att':
      return !!attTarget(a, it.what as AttKind);
    case 'shield':
      return a.pavise <= 0;
    default:
      return nadesOf(a, it.what as RoyaleNade) < nadeCap(a.pack, it.what as RoyaleNade);
  }
}

/** The long gun an attachment would go on: the one in hand first, else the other, as long as it fits and that place
 * on it is free. */
export function attTarget(a: Actor, k: AttKind): Gun | null {
  const h = a.slot !== 1 ? a.guns[a.slot] : null;
  if (h && fits(h.id, k) && !fitted(h, k)) return h;
  const g0 = a.guns[0];
  if (g0 && fits(g0.id, k) && !fitted(g0, k)) return g0;
  const g2 = a.guns[2];
  if (g2 && fits(g2.id, k) && !fitted(g2, k)) return g2;
  return null;
}

/** The gun in hand, if F would swap its sight for this one (a red dot for a 4x or the other way). */
export function sightSwap(a: Actor, k: AttKind): Gun | null {
  const h = a.slot !== 1 ? a.guns[a.slot] : null;
  return h && (k === 'dot' || k === 'x4') && fits(h.id, k) && !hasAtt(h, k) ? h : null;
}

/** With a smaller backpack: whatever no longer fits goes on the ground at your feet. */
function shed(m: Match, a: Actor, y: number) {
  const b = a.body;
  let i = 0;
  const put = (kind: Item['kind'], what: string, n: number) => {
    if (n <= 0) return;
    const ang = i++ * 2.1 + a.id;
    dropItem(m, kind, what, n, b.x + Math.cos(ang) * 0.6, b.z + Math.sin(ang) * 0.6, y, null, a.id);
  };
  for (const k of AMMO_KINDS) {
    const extra = a.ammo[k] - ammoCap(a.pack, k);
    if (extra > 0) {
      a.ammo[k] -= extra;
      put('ammo', k, extra);
    }
  }
  const over = (have: number, cap: number) => Math.max(0, have - cap);
  let n = over(a.bandages, healCap(a.pack, 'bandage'));
  a.bandages -= n;
  put('heal', 'bandage', n);
  n = over(a.kits, healCap(a.pack, 'kit'));
  a.kits -= n;
  put('heal', 'kit', n);
  n = over(a.drinks, boostCap(a.pack, 'drink'));
  a.drinks -= n;
  put('boost', 'drink', n);
  n = over(a.pills, boostCap(a.pack, 'pills'));
  a.pills -= n;
  put('boost', 'pills', n);
  for (const k of ROYALE_NADES) {
    n = over(nadesOf(a, k), nadeCap(a.pack, k));
    addNades(a, k, -n);
    put('nade', k, n);
  }
}

function pickup(m: Match, a: Actor, it: Item) {
  if (!it.live) return;
  const b = a.body;
  switch (it.kind) {
    case 'gun': {
      const id = it.what as WeaponId;
      const mods = it.mods ? { ...it.mods } : null;
      const g: Gun = { id, mag: Math.min(it.n, magOf({ id, mods })), reserve: 0, fresh: false, mods };
      // a long gun takes a free slot; with both full a player swaps the one in hand, a bot the cheaper one
      const cheaper = WEAPONS[a.guns[0]?.id ?? 'wren'].price <= WEAPONS[a.guns[2]?.id ?? 'wren'].price ? 0 : 2;
      const k: 0 | 1 | 2 = WEAPONS[id].slot === 'secondary' ? 1 : !a.guns[0] ? 0 : !a.guns[2] ? 2 : a.bot ? cheaper : a.slot === 2 ? 2 : 0;
      const old = a.guns[k];
      if (old) dropItem(m, 'gun', old.id, old.mag, b.x, b.z, it.y, old.mods ?? null, a.id);
      a.guns[k] = g;
      if (k !== 1 || !a.guns[a.slot] || a.slot === 1) {
        if (k !== 1) a.paviseUp = false;
        a.slot = k;
        a.switchT = WEAPONS[id].equip;
        a.reloadT = 0;
        a.ads = 0;
      }
      it.live = false;
      break;
    }
    case 'ammo': {
      const k = it.what as AmmoKind;
      const take = Math.min(it.n, ammoCap(a.pack, k) - a.ammo[k]);
      if (take <= 0) return;
      a.ammo[k] += take;
      it.n -= take;
      if (it.n <= 0) it.live = false;
      break;
    }
    case 'vest': {
      const lv = Number(it.what);
      if (a.vest > 0 && a.armor > 0) dropItem(m, 'vest', String(a.vest), 1, b.x, b.z, it.y);
      a.vest = lv;
      a.armor = VEST[lv];
      it.live = false;
      break;
    }
    case 'helmet': {
      if (a.helmet > 0) dropItem(m, 'helmet', String(a.helmet), 1, b.x, b.z, it.y);
      a.helmet = Number(it.what);
      it.live = false;
      break;
    }
    case 'heal': {
      const kit = it.what === 'kit';
      const room = kit ? healCap(a.pack, 'kit') - a.kits : healCap(a.pack, 'bandage') - a.bandages;
      const take = Math.min(room, it.n);
      if (take <= 0) return;
      if (kit) a.kits += take;
      else a.bandages += take;
      it.n -= take;
      if (it.n <= 0) it.live = false;
      break;
    }
    case 'boost': {
      const drink = it.what === 'drink';
      const take = Math.min(drink ? boostCap(a.pack, 'drink') - a.drinks : boostCap(a.pack, 'pills') - a.pills, it.n);
      if (take <= 0) return;
      if (drink) a.drinks += take;
      else a.pills += take;
      it.n -= take;
      if (it.n <= 0) it.live = false;
      break;
    }
    case 'pack': {
      // a better one replaces yours; a worse one (taken with F) leaves what no longer fits on the ground
      const lv = Number(it.what);
      if (lv === a.pack) return;
      if (a.pack > 0) dropItem(m, 'pack', String(a.pack), 1, b.x, b.z, it.y, null, a.id);
      a.pack = lv;
      it.live = false;
      shed(m, a, it.y);
      break;
    }
    case 'att': {
      // onto a long gun with that place free; with none, F swaps the sight on the gun in hand (the old one dropped)
      const k = it.what as AttKind;
      const g = attTarget(a, k) ?? (a.bot ? null : sightSwap(a, k));
      if (!g) return;
      const off = attach(g, k);
      if (off) dropItem(m, 'att', off, 1, b.x, b.z, it.y, null, a.id);
      it.live = false;
      break;
    }
    case 'shield': {
      // one at a time: this one for yours (what each has left goes with it)
      if (a.pavise > 0) dropItem(m, 'shield', '1', Math.ceil(a.pavise), b.x, b.z, it.y, null, a.id);
      a.pavise = it.n;
      a.paviseUp = false;
      it.live = false;
      break;
    }
    default: {
      const k = it.what as RoyaleNade;
      const take = Math.min(nadeCap(a.pack, k) - nadesOf(a, k), it.n);
      if (take <= 0) return;
      addNades(a, k, take);
      it.n -= take;
      if (it.n <= 0) it.live = false;
    }
  }
  m.lootVer++;
  m.events.push({ t: 'pickup', a: a.id, item: it });
}

/** Picks something up (an online guest asks the host instead, see online.ts). */
function takeLoot(m: Match, a: Actor, it: Item) {
  if (m.authority) pickup(m, a, it);
  else m.net?.pick?.(it.id);
}

/** Online, on the host: a guest's pickup, if it is still there and within reach of where the guest is. */
export function pickupFor(m: Match, a: Actor, it: Item) {
  if (!it.live || !a.alive || a.drop || a.car >= 0) return false;
  const b = a.body;
  if (Math.hypot(it.x - b.x, it.z - b.z) > 3.2 || it.y < b.y - 1.8 || it.y > b.y + 2) return false;
  pickup(m, a, it);
  return true;
}

/** Starts a heal or boost. An online guest's own runs on its machine for the look of it (slowed, gun down); the host's
 * copy is the one that counts. */
export function startHeal(m: Match, a: Actor, kind: UseKind) {
  a.healKind = kind;
  a.healT = USE[kind].time;
  a.reloadT = 0;
  a.ads = 0;
  m.events.push({ t: 'heal', a: a.id, done: false });
  if (!m.authority && a.id === m.me) m.net?.heal?.(kind);
}

/** A heal or boost under way, done once its time is up (only where the rules run: a guest waits for the host). */
export function tickHeal(m: Match, a: Actor, dt: number) {
  a.healT -= dt;
  if (a.healT > 0 || !a.healKind) return;
  const k = a.healKind;
  a.healT = 0;
  a.healKind = null;
  if (!m.authority) return;
  if (k === 'kit' || k === 'bandage') {
    const h = HEAL[k];
    a.hp = Math.min(100, Math.max(a.hp, Math.min(h.to, a.hp + h.add)));
    if (k === 'kit') a.kits--;
    else a.bandages--;
  } else {
    a.boost = Math.min(100, a.boost + BOOST[k].add);
    if (k === 'drink') a.drinks--;
    else a.pills--;
  }
  m.events.push({ t: 'heal', a: a.id, done: true });
}

/** Which heal a press uses: a kit when badly hurt, a bandage while it still helps, else a kit. */
export function healPick(a: Actor): HealKind | null {
  if (a.hp >= 100) return null;
  if (a.kits > 0 && (a.hp < 55 || (a.hp >= HEAL.bandage.to && a.bandages >= 0))) return 'kit';
  if (a.bandages > 0 && a.hp < HEAL.bandage.to) return 'bandage';
  return a.kits > 0 ? 'kit' : null;
}

/** How many of a kit item you carry. */
export function carried(a: Actor, k: UseKind) {
  return k === 'bandage' ? a.bandages : k === 'kit' ? a.kits : k === 'drink' ? a.drinks : a.pills;
}

/** Would using this help now (you have one, and a heal is below what it heals to, a boost below full)? */
export function canUse(a: Actor, k: UseKind) {
  if (carried(a, k) <= 0) return false;
  if (k === 'bandage') return a.hp < HEAL.bandage.to;
  if (k === 'kit') return a.hp < 100;
  return a.boost < 95;
}

/** Which boost a press uses: painkillers while the meter is low, else a drink; none once it is nearly full. */
export function boostPick(a: Actor): BoostKind | null {
  if (a.boost >= 95) return null;
  if (a.pills > 0 && (a.boost < 40 || a.drinks <= 0)) return 'pills';
  return a.drinks > 0 ? 'drink' : null;
}

/** The zone's own damage: straight to health, armor doesn't help. */
function hurtZone(m: Match, a: Actor, dmg: number) {
  if (!a.alive) return;
  a.hp -= dmg;
  a.hurtT = m.time;
  a.healT = 0;
  a.healKind = null;
  m.events.push({ t: 'hit', a: -1, v: a.id, dmg, zone: 'body', armor: false, x: a.body.x, y: a.body.y + 1, z: a.body.z, kill: a.hp <= 0 });
  if (a.hp <= 0) die(m, a, -1, 'zone', false);
}

function stepRoyale(m: Match, dt: number) {
  const z = m.zone!;
  const w = m.world;
  // the zone: hold, then close toward the next circle
  if (z.i < ZONES.length) {
    z.t -= dt;
    if (!z.shrinking && z.t <= 0) {
      z.shrinking = true;
      z.t = ZONES[z.i].shrink;
      z.fx = z.x;
      z.fz = z.z;
      z.fr = z.r;
      z.dps = ZONES[z.i].dps;
      m.events.push({ t: 'zone', i: z.i, shrinking: true });
    } else if (z.shrinking) {
      const k = 1 - Math.max(0, z.t) / ZONES[z.i].shrink;
      z.x = lerp(z.fx, z.nx, k);
      z.z = lerp(z.fz, z.nz, k);
      z.r = lerp(z.fr, z.nr, k);
      if (z.t <= 0) {
        z.i++;
        z.shrinking = false;
        if (z.i < ZONES.length) {
          const ph = ZONES[z.i];
          z.t = ph.wait;
          const [nx, nz] = nextCircle(w, m.rng, z.x, z.z, z.r, ph.r);
          z.nx = nx;
          z.nz = nz;
          z.nr = ph.r;
          z.dps = ph.dps;
        }
        m.events.push({ t: 'zone', i: z.i, shrinking: false });
        // each of the first few closes sends a supply crate down somewhere inside the next circle
        if (z.i <= SUPPLY_MAX && z.i < ZONES.length) dropSupply(m, z.nx, z.nz, z.nr);
      }
    }
  }
  stepSupplies(m, dt);
  stepRed(m, dt);
  // outside it hurts, once a second; a boost mends a little all the time while it drains
  for (const a of m.actors) {
    if (!a.alive || a.drop) continue;
    if (a.boost > 0) {
      if (a.hp < 100) a.hp = Math.min(100, a.hp + boostHeal(a.boost) * dt);
      a.boost = Math.max(0, a.boost - BOOST_DRAIN * dt);
    }
    if (Math.hypot(a.body.x - z.x, a.body.z - z.z) > z.r) {
      a.zoneT += dt;
      if (a.zoneT >= 1) {
        a.zoneT -= 1;
        hurtZone(m, a, z.dps);
      }
    } else a.zoneT = 0;
  }
  // the transport flies on; whoever is still aboard at the far edge jumps
  if (m.plane) {
    const p = planeAt(m.plane, m.time);
    for (const a of m.actors) {
      if (a.drop !== 1) continue;
      a.body.x = p.x;
      a.body.z = p.z;
      a.body.y = m.plane.y;
      if (p.k >= 0.93) jumpOut(m, a);
    }
    if (p.k >= 1) m.plane = null;
  }
  // the end: the people are all out (alone, that is you; online, everyone in the room), or one is left
  let people = 0;
  for (const a of m.actors) if (a.alive && isPerson(m, a)) people++;
  if (!people || m.alive <= 1) {
    m.phase = 'over';
    let last: Actor | null = null;
    for (const a of m.actors) if (a.alive) last = a;
    m.winner = last ? last.id : -1;
    if (last) last.place = 1;
    for (const a of m.actors) if (isPerson(m, a)) a.cs += Math.round((ROYALE_PLAYERS - a.place + 1) * 12) + (a.place === 1 ? 600 : 0);
    m.events.push({ t: 'phase', phase: 'over' });
  }
}

/** Someone a person plays (here, or online on another machine), as opposed to a bot. Your own seat counts even when
 * the dev autopilot plays it. */
export const isPerson = (m: Match, a: Actor) => a.id === m.me || !a.bot;

/** Online, on a guest: what of a royale's world runs on between the host's updates (which set it right): the zone
 * closing, the transport flying on (with whoever is still aboard), crates falling and the bombardment's clocks. */
function mirrorRoyale(m: Match, dt: number) {
  const z = m.zone;
  if (z && z.i < ZONES.length) {
    z.t = Math.max(0, z.t - dt);
    if (z.shrinking) {
      const k = 1 - z.t / ZONES[z.i].shrink;
      z.x = lerp(z.fx, z.nx, k);
      z.z = lerp(z.fz, z.nz, k);
      z.r = lerp(z.fr, z.nr, k);
    }
  }
  if (m.plane) {
    const p = planeAt(m.plane, m.time);
    for (const a of m.actors) {
      if (a.drop !== 1 || !a.alive) continue;
      a.body.x = p.x;
      a.body.z = p.z;
      a.body.y = m.plane.y;
      // (you jump at the far edge by yourself, as the host would make you)
      if (a.id === m.me && p.k >= 0.93) jumpOut(m, a);
    }
    if (p.k >= 1) m.plane = null;
  }
  for (const s of m.supplies) if (s.landed < 0) s.y = Math.max(s.ground, s.y - SUPPLY_FALL * dt);
  const red = m.red;
  if (red) {
    if (red.warn > 0) red.warn = Math.max(0, red.warn - dt);
    else red.left = Math.max(0, red.left - dt);
  } else m.redT = Math.max(0, m.redT - dt);
}

// ---------------------------------------------------------------------------------------------------------------
// royale: supply drops and the bombardment

const roofHit = newHit();
/** Is there a roof (a floor above, a ceiling, any solid box) over this point? Trees and rocks don't count. */
export function underRoof(w: World, x: number, y: number, z: number) {
  rayWorld(w, x, y, z, 0, 1, 0, 40, roofHit);
  return roofHit.kind === 'box';
}

/** Sends a supply crate down somewhere inside the circle (x, z, r): on open land, clear of buildings and roofs. */
export function dropSupply(m: Match, cx: number, cz: number, cr: number) {
  if (m.supplies.length >= SUPPLY_MAX) return null;
  const w = m.world;
  const t = w.terrain;
  let x = cx;
  let z = cz;
  for (let k = 0; k < 40; k++) {
    const a = m.rng() * Math.PI * 2;
    const d = Math.sqrt(m.rng()) * Math.max(0, cr * 0.7);
    const tx = cx + Math.cos(a) * d;
    const tz = cz + Math.sin(a) * d;
    if (!onLand(w, tx, tz) || (t.hasWater && !t.ice && heightAt(t, tx, tz) < t.water + 0.3)) continue;
    const g = floorAt(t, tx, tz);
    if (blockedAt(w, tx, tz, g, 2.2) || underRoof(w, tx, g + 0.5, tz)) continue;
    x = tx;
    z = tz;
    break;
  }
  const ground = floorAt(t, x, z);
  const s: Supply = { id: m.supplies.length, x, y: ground + SUPPLY_HIGH, z, ground, landed: -1, items: [] };
  m.supplies.push(s);
  m.events.push({ t: 'supply', x, z, landed: false });
  return s;
}

/** Crates fall under their canopies; one that lands puts its loot out in a ring around it. */
function stepSupplies(m: Match, dt: number) {
  for (const s of m.supplies) {
    if (s.landed >= 0) continue;
    s.y -= SUPPLY_FALL * dt;
    if (s.y > s.ground) continue;
    s.y = s.ground;
    s.landed = m.time;
    const things = supplyContents(m.rng);
    things.forEach(([kind, what, n], i) => {
      const a = (i / things.length) * Math.PI * 2 + s.id;
      const x = s.x + Math.cos(a) * 1.15;
      const z = s.z + Math.sin(a) * 1.15;
      s.items.push(m.loot.length);
      dropItem(m, kind, what, kind === 'gun' ? WEAPONS[what as WeaponId].mag : n, x, z, floorAt(m.world.terrain, x, z) + 0.02);
    });
    m.lootVer++;
    m.events.push({ t: 'supply', x: s.x, z: s.z, landed: true });
  }
}

/** Is anything left in a crate (or is it still on its way down)? */
export const supplyLeft = (m: Match, s: Supply) => s.landed < 0 || s.items.some((i) => m.loot[i]?.live);

/** Marks a bombardment: a circle inside the zone, where the most players are of a few spots tried, but never over
 * the player on this machine. Null when none fits (the zone has got too small for one). */
export function markRed(m: Match) {
  const z = m.zone;
  if (!z) return null;
  const w = m.world;
  const you = m.actors[m.me];
  const r = RED_R[0] + m.rng() * (RED_R[1] - RED_R[0]);
  const room = z.r * 0.95 - r;
  if (room < 8) return null;
  let best: Red | null = null;
  let bestN = -1;
  for (let k = 0; k < 24; k++) {
    const a = m.rng() * Math.PI * 2;
    const d = Math.sqrt(m.rng()) * room;
    const x = z.x + Math.cos(a) * d;
    const rz = z.z + Math.sin(a) * d;
    if (Math.abs(x) > w.arena || Math.abs(rz) > w.arena || !onLand(w, x, rz)) continue;
    if (you.alive && Math.hypot(you.body.x - x, you.body.z - rz) < r + 6) continue;
    let n = 0;
    for (const o of m.actors) if (o.alive && !o.drop && Math.hypot(o.body.x - x, o.body.z - rz) < r) n++;
    if (n > bestN) {
      bestN = n;
      best = { x, z: rz, r, warn: RED_WARN, left: RED_LIVE, next: 0 };
    }
  }
  if (!best) return null;
  m.red = best;
  m.events.push({ t: 'redzone', x: best.x, z: best.z, r: best.r, stage: 'warn' });
  return best;
}

/** The bombardment: wait for the next one, warn, then shell the circle until it is over. */
function stepRed(m: Match, dt: number) {
  const red = m.red;
  if (!red) {
    m.redT -= dt;
    if (m.redT > 0) return;
    m.redT = RED_GAP[0] + m.rng() * (RED_GAP[1] - RED_GAP[0]);
    // (none in the last circles: there is no room for one)
    if (m.zone && m.zone.i < ZONES.length - 1) markRed(m);
    return;
  }
  if (red.warn > 0) {
    red.warn -= dt;
    if (red.warn <= 0) m.events.push({ t: 'redzone', x: red.x, z: red.z, r: red.r, stage: 'live' });
    return;
  }
  red.left -= dt;
  red.next -= dt;
  while (red.next <= 0 && red.left > 0) {
    red.next += RED_EVERY[0] + m.rng() * (RED_EVERY[1] - RED_EVERY[0]);
    const a = m.rng() * Math.PI * 2;
    const d = Math.sqrt(m.rng()) * red.r;
    shell(m, red.x + Math.cos(a) * d, red.z + Math.sin(a) * d);
  }
  if (red.left <= 0) {
    m.red = null;
    m.events.push({ t: 'redzone', x: red.x, z: red.z, r: red.r, stage: 'clear' });
  }
}

/** One shell lands at (x, z), on whatever is there (a roof takes it): it hurts everyone near it who has no roof over
 * their head, less through a wall. */
function shell(m: Match, x: number, z: number) {
  const w = m.world;
  const y = groundAt(w, x, z, floorAt(w.terrain, x, z) + 60);
  m.events.push({ t: 'shell', x, y, z });
  for (const a of m.actors) {
    if (!a.alive || a.drop === 1) continue;
    const dx = a.body.x - x;
    const dz = a.body.z - z;
    if (Math.abs(dx) > SHELL_R || Math.abs(dz) > SHELL_R) continue;
    const cy = a.body.y + a.body.height * 0.55;
    const dy = cy - (y + 0.3);
    const d = Math.hypot(dx, dy, dz);
    if (d > SHELL_R || underRoof(w, a.body.x, eyeY(a), a.body.z)) continue;
    const l = d || 1;
    rayWorld(w, x, y + 0.3, z, dx / l, dy / l, dz / l, l, nadeHit);
    const cover = nadeHit.kind === 'none' ? 1 : 0.3;
    damage(m, a, SHELL_DMG * Math.pow(1 - d / SHELL_R, 1.2) * cover, -1, 'shell', 'body', a.body.x, cy, a.body.z);
  }
}

export function jumpOut(m: Match, a: Actor) {
  if (a.drop !== 1 || !m.plane) return;
  const p = m.plane;
  a.drop = 2;
  a.dropT = 0;
  const l = p.len || 1;
  a.body.vx = ((p.bx - p.ax) / l) * p.speed * 0.5;
  a.body.vz = ((p.bz - p.az) / l) * p.speed * 0.5;
  a.body.vy = -2;
  m.events.push({ t: 'jumpout', a: a.id });
}

/** Freefall and parachute: steered by the move keys, landing ends it. */
function stepDrop(m: Match, a: Actor, inp: Input, dt: number) {
  const b = a.body;
  a.dropT += dt;
  const ground = floorAt(m.world.terrain, b.x, b.z);
  const above = b.y - ground;
  if (a.drop === 2 && (above < CHUTE_OPEN || (inp.jump && a.dropT > 0.8 && above < CHUTE_OPEN * 2.6))) {
    a.drop = 3;
    m.events.push({ t: 'chute', a: a.id });
  }
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  const mx = clamp(inp.mx, -1, 1);
  const mz = clamp(inp.mz, -1, 1);
  const chute = a.drop === 3;
  // diving forward (looking down, pushing ahead) falls faster and covers more ground; under the canopy you glide
  const fwd = chute ? CHUTE_GLIDE * (0.45 + 0.55 * Math.max(0, mz)) : mz > 0 ? FALL_FAST * mz : FALL_SLOW * mz;
  const side = (chute ? 5 : FALL_SLOW) * mx;
  const tx = -sy * fwd + cy * side;
  const tz = -cy * fwd - sy * side;
  const k = 1 - Math.exp(-(chute ? 1.6 : 1.1) * dt);
  b.vx += (tx - b.vx) * k;
  b.vz += (tz - b.vz) * k;
  const vy = chute ? CHUTE_VY - Math.max(0, mz) * 1.2 : FALL_VY * (0.75 + 0.25 * Math.max(0, mz)) * (0.6 + 0.4 * clamp(-a.pitch * 1.6, 0, 1));
  b.vy += (vy - b.vy) * (1 - Math.exp(-(chute ? 2.5 : 0.9) * dt));
  // the body steps with gravity: hand it back so the set fall speed holds
  b.vy += GRAVITY * dt;
  stepBody(m.world, b, dt, m.world.arena);
  if (b.onGround || b.swim) {
    a.drop = 0;
    // from here on dropT holds the landing time
    a.dropT = m.time;
    b.vy = 0;
    m.events.push({ t: 'land', a: a.id });
  }
}

const teamAlive = (m: Match, team: number) => m.actors.reduce((n, a) => n + (a.alive && a.team === team ? 1 : 0), 0);
export const aliveOf = teamAlive;

function stepRules(m: Match, dt: number) {
  if (m.mode === 'royale') {
    stepRoyale(m, dt);
    return;
  }
  if (m.mode === 'dm') {
    m.clock += dt;
    m.phaseT = Math.max(0, DM_TIME - m.clock);
    if (m.phase !== 'live') return;
    for (const a of m.actors) {
      if (!a.alive) {
        a.respawnT -= dt;
        if (a.respawnT <= 0) respawn(m, a);
      } else if (m.time - a.hurtT > 5 && a.hp < 100) a.hp = Math.min(100, a.hp + 25 * dt);
    }
    let top = m.actors[0];
    for (const a of m.actors) if (a.kills > top.kills) top = a;
    if (top.kills >= DM_KILLS || m.clock >= DM_TIME) {
      m.phase = 'over';
      m.winner = top.id;
      top.cs += 300;
      m.events.push({ t: 'phase', phase: 'over' });
    }
    return;
  }
  m.phaseT -= dt;
  if (m.phase === 'buy') {
    if (m.phaseT <= 0) {
      m.phase = 'live';
      m.phaseT = ROUND_TIME;
      m.events.push({ t: 'phase', phase: 'live' });
    }
    return;
  }
  if (m.phase === 'end') {
    // a planted charge still goes off after the round is decided, for the show (it hurts nobody by then)
    const c = m.charge;
    if (c.state === 'planted') {
      c.fuse -= dt;
      if (c.fuse <= 0) blow(m, false);
    }
    if (m.phaseT <= 0) {
      if (m.score[0] >= ROUNDS_TO_WIN || m.score[1] >= ROUNDS_TO_WIN || m.round >= HALF * 2 + 1) {
        m.phase = 'over';
        m.winner = m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
        if (m.winner >= 0) for (const a of m.actors) if (a.team === m.winner) a.cs += 400;
        m.events.push({ t: 'phase', phase: 'over' });
      } else startRound(m);
    }
    return;
  }
  if (m.phase !== 'live') return;
  const c = m.charge;
  const atk = m.attack;
  const def = 1 - atk;
  // a dropped charge goes to the first attacker to walk over it
  if (c.state === 'dropped')
    for (const a of m.actors)
      if (a.alive && a.team === atk && Math.hypot(a.body.x - c.x, a.body.z - c.z) < 1.4 && Math.abs(a.body.y - c.y) < 1.6) {
        c.state = 'carried';
        c.holder = a.id;
        m.events.push({ t: 'carry', a: a.id });
        break;
      }
  const aAtk = teamAlive(m, atk);
  const aDef = teamAlive(m, def);
  if (c.state === 'planted') {
    // the round clock is done with: the fuse decides, unless the defense defuses or nobody is left to defend
    c.fuse -= dt;
    m.phaseT = Math.max(0, c.fuse);
    if (aDef === 0) endRound(m, atk, 'elim');
    else if (c.fuse <= 0) {
      blow(m, true);
      endRound(m, atk, 'blast');
    }
    return;
  }
  if (aAtk === 0) endRound(m, def, 'elim');
  else if (aDef === 0) endRound(m, atk, 'elim');
  else if (m.phaseT <= 0) endRound(m, def, 'time');
}

/** The charge goes off: everyone near enough is hurt or killed (only while the round is live). */
function blow(m: Match, live: boolean) {
  const c = m.charge;
  c.state = 'blown';
  c.fuse = 0;
  c.defuseBy = -1;
  m.events.push({ t: 'blast', x: c.x, y: c.y + 0.4, z: c.z });
  m.events.push({ t: 'boom', x: c.x, y: c.y + 0.4, z: c.z });
  if (!live) return;
  for (const a of m.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.body.x - c.x, a.body.y + 1 - c.y, a.body.z - c.z);
    if (d > BLAST_R) continue;
    // deadly well inside the radius, fading out to its edge, through anything
    const dmg = d < BLAST_R * 0.55 ? 999 : 160 * (1 - (d - BLAST_R * 0.55) / (BLAST_R * 0.45));
    if (dmg <= 0) continue;
    a.shield = 0;
    damage(m, a, dmg, a.id, 'blast', 'body', a.body.x, a.body.y + 1, a.body.z);
  }
}

/** Is an actor where it can plant (carrying the charge, on a site, standing on something)? Returns the site or -1. */
export function plantSite(m: Match, a: Actor) {
  if (m.mode !== 'breach' || m.phase !== 'live' || !a.alive || m.charge.state !== 'carried' || m.charge.holder !== a.id || !a.body.onGround || a.body.swim) return -1;
  for (const s of m.world.sites) if (Math.hypot(a.body.x - s.x, a.body.z - s.z) < SITE_R && Math.abs(a.body.y - s.y) < 4) return s.id;
  return -1;
}

/** Can an actor work on the planted charge from where it stands? */
export function canDefuse(m: Match, a: Actor) {
  const c = m.charge;
  if (m.mode !== 'breach' || m.phase !== 'live' || !a.alive || a.team === m.attack || c.state !== 'planted' || !a.body.onGround) return false;
  if (c.defuseBy >= 0 && c.defuseBy !== a.id) return false;
  return Math.hypot(a.body.x - c.x, a.body.z - c.z) < DEFUSE_REACH && Math.abs(a.body.y - c.y) < 1.6;
}

/** Breach, each frame for each actor: holding use plants or defuses. True while it is busy doing so (it stands still,
 * gun down). */
function stepCharge(m: Match, a: Actor, inp: Input, dt: number) {
  const c = m.charge;
  if (c.plantBy === a.id && (!inp.use || plantSite(m, a) < 0)) {
    c.plantBy = -1;
    c.plantT = 0;
  }
  if (c.defuseBy === a.id && (!inp.use || !canDefuse(m, a))) {
    c.defuseBy = -1;
    c.defuseT = 0;
  }
  if (!inp.use) return false;
  const site = plantSite(m, a);
  if (site >= 0) {
    if (c.plantBy !== a.id) {
      c.plantBy = a.id;
      c.plantT = 0;
      m.events.push({ t: 'plant', a: a.id, done: false, site });
    }
    c.plantT += dt;
    if (c.plantT >= PLANT_TIME) {
      c.state = 'planted';
      c.holder = -1;
      c.plantBy = -1;
      c.plantT = 0;
      c.site = site;
      c.x = a.body.x;
      c.y = a.body.y;
      c.z = a.body.z;
      c.fuse = FUSE;
      m.phaseT = FUSE;
      a.cs += 50;
      for (const o of m.actors) if (o.team === a.team) o.credits = Math.min(MAX_CREDITS, o.credits + PLANT_REWARD);
      m.events.push({ t: 'plant', a: a.id, done: true, site });
      return false;
    }
    return true;
  }
  if (canDefuse(m, a)) {
    if (c.defuseBy !== a.id) {
      c.defuseBy = a.id;
      c.defuseT = c.defuseKept;
      m.events.push({ t: 'defuse', a: a.id, done: false });
    }
    c.defuseT += dt;
    if (c.defuseT >= DEFUSE_HALF) c.defuseKept = DEFUSE_HALF;
    if (c.defuseT >= DEFUSE_TIME) {
      c.state = 'defused';
      c.defuseBy = -1;
      a.cs += 100;
      m.events.push({ t: 'defuse', a: a.id, done: true });
      endRound(m, a.team, 'defuse');
      return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// buying

/** Whether an actor can buy right now (buy phase, inside its spawn). */
export function canShop(m: Match, a: Actor) {
  if (m.mode !== 'breach' || m.phase !== 'buy' || !a.alive) return false;
  const s = spawnOf(m, a.team);
  return Math.hypot(a.body.x - s.x, a.body.z - s.z) < SPAWN_R + 2;
}

const isNade = (item: ShopItem): item is NadeKind => item in NADES;

export function priceOf(item: ShopItem) {
  if (item === 'light' || item === 'heavy') return ARMOR[item].price;
  if (item === 'pavise') return PAVISE.price;
  if (isNade(item)) return NADES[item].price;
  return WEAPONS[item].price;
}

/** Owned already (nothing to buy)? */
export function owns(a: Actor, item: ShopItem) {
  if (item === 'light') return a.armor >= ARMOR.light.amount;
  if (item === 'heavy') return a.armor >= ARMOR.heavy.amount;
  if (item === 'pavise') return a.pavise > 0;
  if (isNade(item)) return nadesOf(a, item) >= NADES[item].max;
  return a.guns[0]?.id === item || a.guns[1]?.id === item || a.guns[2]?.id === item;
}

/** Buys one thing; a gun or armor bought this round is refunded when swapped for another. */
export function buy(m: Match, a: Actor, item: ShopItem) {
  if (!canShop(m, a) || owns(a, item)) return false;
  let refund = 0;
  if (item === 'light' || item === 'heavy') {
    refund = a.boughtArmor;
    const cost = ARMOR[item].price - refund;
    if (a.credits < cost) return false;
    a.credits -= cost;
    a.armor = ARMOR[item].amount;
    a.armorKit = Math.max(a.armorKit, ARMOR[item].amount);
    a.boughtArmor = ARMOR[item].price;
  } else if (item === 'pavise') {
    if (a.credits < PAVISE.price) return false;
    a.credits -= PAVISE.price;
    a.pavise = PAVISE.hp;
  } else if (isNade(item)) {
    if (a.credits < NADES[item].price) return false;
    a.credits -= NADES[item].price;
    addNades(a, item, 1);
  } else {
    const def = WEAPONS[item];
    // two long guns and a sidearm: a long gun goes into a free long slot, else it replaces the long gun in hand (the
    // first if the sidearm is out)
    const k: 0 | 1 | 2 = def.slot !== 'primary' ? 1 : !a.guns[0] ? 0 : !a.guns[2] ? 2 : a.slot === 2 ? 2 : 0;
    const old = a.guns[k];
    if (old?.fresh) refund = WEAPONS[old.id].price;
    const cost = def.price - refund;
    if (a.credits < cost) return false;
    a.credits -= cost;
    a.guns[k] = { ...gun(item), fresh: true };
    if (k !== 1) a.paviseUp = false;
    a.slot = k;
    a.switchT = def.equip;
    a.reloadT = 0;
  }
  m.events.push({ t: 'buy', a: a.id, item });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// actions

/**
 * An online guest's own hit as the host tells it back, a moment after the guest already showed it (est): only its
 * kill is news. Feedback skips these so a hit is never shown or heard twice.
 */
export function echoOfMine(m: Match, e: Ev) {
  return e.t === 'hit' && !m.authority && e.a === m.me && e.est === undefined && !e.kill;
}

/** Current cone half angle in degrees for an actor's next shot. */
export function spreadOf(a: Actor) {
  const g = currentGun(a);
  if (!g) return 0;
  const w = WEAPONS[g.id];
  const sp = Math.hypot(a.body.vx, a.body.vz) / RUN;
  // (a person's spray and running open up half as much as a bot's: shots go where the crosshair is)
  const ease = a.bot ? 1 : 0.5;
  const ads = g.mods ? adsOf(g) : w.ads;
  let s = (w.base + a.bloom * ease) * lerp(1, ads, a.ads);
  // walking (Shift) and crouch walking stay nearly true; running throws shots wide
  s += w.move * ease * smoothstep(0.45, 1, sp) * lerp(1, Math.max(ads, 0.6), a.ads);
  if (!a.body.onGround && !a.body.swim) s += w.air;
  if (a.crouch > 0.5 && a.body.onGround) s *= 0.8;
  // one handed round a raised shield
  if (a.paviseUp) s += PAVISE.spread;
  return s;
}

/** A unit vector within a cone of `deg` half angle around (dx, dy, dz), denser toward the middle. */
function inCone(r: Rng, dx: number, dy: number, dz: number, deg: number) {
  if (deg <= 0) return { x: dx, y: dy, z: dz };
  const ang = deg * DEG * Math.sqrt(r()) * (0.35 + 0.65 * r());
  const rot = r() * Math.PI * 2;
  // a basis around the direction
  let ux = -dz;
  let uy = 0;
  let uz = dx;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-5) {
    ux = 1;
    uy = 0;
    uz = 0;
    ul = 1;
  }
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  return { x: dx * c + (ux * cr + vx * sr) * s, y: dy * c + (uy * cr + vy * sr) * s, z: dz * c + (uz * cr + vz * sr) * s };
}

function fire(m: Match, a: Actor) {
  const g = currentGun(a);
  if (!g) return;
  const w = WEAPONS[g.id];
  if (g.mag <= 0) {
    if (!a.fireHeld) m.events.push({ t: 'empty', a: a.id });
    startReload(m, a);
    return;
  }
  if (m.time - a.lastShot > Math.max(0.3, interval(w) * 1.6)) a.spray = 0;
  g.mag--;
  a.fireCd += interval(w);
  a.shield = 0;
  const spread = spreadOf(a);
  const ex = a.body.x;
  const ey = eyeY(a);
  const ez = a.body.z;
  // a person's shot is drawn a little toward someone just off the crosshair (bots aim on their own)
  const d = a.bot ? viewDir(a.yaw, a.pitch) : assisted(m, a, viewDir(a.yaw, a.pitch), ex, ey, ez);
  const zero = w.cls === 'crossbow' ? 30 : w.cls === 'pistol' || w.cls === 'smg' || w.cls === 'shotgun' ? 40 : 100;
  const lift = (BULLET_G * (zero / w.speed)) / 2;
  const vel: number[] = [];
  for (let p = 0; p < w.pellets; p++) {
    let dir = inCone(m.rng, d.x, d.y, d.z, spread);
    if (w.pellets > 1) dir = inCone(m.rng, dir.x, dir.y, dir.z, w.pelletSpread);
    const b: Bullet = { x: ex, y: ey, z: ez, px: ex, py: ey, pz: ez, vx: dir.x * w.speed, vy: dir.y * w.speed + lift, vz: dir.z * w.speed, owner: a.id, w: g.id, life: w.cls === 'crossbow' ? 3.2 : 1.6, dist: 0, live: true };
    m.bullets.push(b);
    vel.push(b.vx, b.vy, b.vz);
  }
  // online: the others are shown this shot (the host from a guest, everyone from the host)
  if (!m.authority && a.id === m.me) m.net?.fire(g.id, ex, ey, ez, vel);
  const [up, side] = kickOf(w, a.spray);
  const comp = !!g.mods?.comp;
  const k = (a.crouch > 0.5 ? 0.85 : 1) * (1 - a.ads * 0.15) * (comp ? COMP_KICK : 1);
  // the view climbs for bots only (their aim works against it); a person's crosshair stays where they put it, the
  // kick shows in the gun in hand instead
  if (a.bot) {
    a.pitch = clamp(a.pitch + up * k * DEG, -1.5, 1.5);
    a.yaw += side * k * DEG;
  }
  a.kickP += up * k;
  a.bloom = Math.min(w.bloomMax, a.bloom + w.bloom * (comp ? COMP_BLOOM : 1));
  a.spray++;
  a.lastShot = m.time;
  m.events.push({ t: 'shot', a: a.id, w: g.id, x: ex, y: ey, z: ez, dx: d.x, dy: d.y, dz: d.z, v: vel });
  m.sounds.push({ x: ex, z: ez, t: m.time, team: a.team, range: shotRange(w), who: a.id });
}


/**
 * Aim assist: a shot that would pass just beside someone (within about half a metre of their chest or head, a few
 * degrees at most) is turned part of the way toward them. It never turns a shot toward someone behind a wall or a
 * smoke, and a clean miss by more than that stays a miss: it helps, it doesn't aim for you.
 */
const ASSIST_PULL = 0.65;
function assisted(m: Match, a: Actor, d: { x: number; y: number; z: number }, ex: number, ey: number, ez: number) {
  let best = 0;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (const o of m.actors) {
    if (o === a || !o.alive || o.drop || !isEnemy(a, o)) continue;
    const dx = o.body.x - ex;
    const dz = o.body.z - ez;
    const flat = Math.hypot(dx, dz);
    if (flat < 0.5 || flat > 140) continue;
    // ahead of the crosshair at all?
    if ((dx * d.x + dz * d.z) / flat < 0.9) continue;
    const reach = clamp(Math.atan2(0.55, flat), 0.9 * DEG, 4 * DEG);
    for (const h of [o.body.height * 0.66, o.body.height - 0.13]) {
      const ty = o.body.y + h - ey;
      const len = Math.hypot(dx, ty, dz);
      const cos = (dx * d.x + ty * d.y + dz * d.z) / len;
      const off = Math.acos(Math.min(1, cos));
      if (off > reach) continue;
      // the nearer to the crosshair, the better (and a head counts as a little nearer)
      const score = (reach - off) / reach + (h > o.body.height * 0.8 ? 0.05 : 0);
      if (score <= best) continue;
      if (!clearLine(m.world, ex, ey, ez, o.body.x, o.body.y + h, o.body.z) || smokeBlocks(m, ex, ey, ez, o.body.x, o.body.y + h, o.body.z)) continue;
      best = score;
      bx = dx / len;
      by = ty / len;
      bz = dz / len;
    }
  }
  if (best <= 0) return d;
  const k = ASSIST_PULL * (0.85 + a.ads * 0.15);
  const x = d.x + (bx - d.x) * k;
  const y = d.y + (by - d.y) * k;
  const z = d.z + (bz - d.z) * k;
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
}

function startReload(m: Match, a: Actor) {
  const g = currentGun(a);
  if (!g || a.reloadT > 0 || a.switchT > 0) return;
  const w = WEAPONS[g.id];
  const spare = spareOf(m, a, g);
  if (g.mag >= magOf(g) || spare <= 0) return;
  a.reloadT = w.reload;
  a.ads = Math.min(a.ads, 0.3);
  m.events.push({ t: 'reload', a: a.id, w: g.id });
}

/** Seconds from the throw until each kind goes off (an incendiary or an impact grenade sooner, when it lands; a decoy
 * arms and then plays for DECOY_LIFE). */
const FUSE_OF: Record<NadeKind, number> = { frag: 2.3, smoke: 1.5, flash: 1.2, fire: 2, impact: 4, decoy: 11.2 };
/** Incendiary: the burning patch's radius, how long it burns and its damage a second (armor does nothing against it). */
export const FIRE_R = 3.1;
export const FIRE_LIFE = 7;
export const FIRE_DPS = 34;
/** Impact grenade: a smaller, weaker blast than a frag, but right where it lands. */
export const IMPACT_R = 5.5;
export const IMPACT_DMG = 105;
/** Decoy: how long it plays gunfire once it has landed. */
export const DECOY_LIFE = 10;

function throwNade(m: Match, a: Actor, kind: NadeKind) {
  if (nadesOf(a, kind) <= 0) return;
  if (a.switchT > 0.2) return;
  addNades(a, kind, -1);
  const d = viewDir(a.yaw, a.pitch + 0.12);
  const sp = 17;
  const n: Nade = { kind, x: a.body.x + d.x * 0.5, y: eyeY(a) - 0.1, z: a.body.z + d.z * 0.5, vx: d.x * sp + a.body.vx * 0.5, vy: d.y * sp + 1.5, vz: d.z * sp + a.body.vz * 0.5, fuse: FUSE_OF[kind], owner: a.id, rest: false, spin: 0 };
  // a decoy plays the thrower's own long gun
  if (kind === 'decoy') n.w = (a.guns[0] ?? a.guns[2] ?? a.guns[1])?.id ?? 'kestrel';
  m.nades.push(n);
  a.switchT = Math.max(a.switchT, 0.4);
  a.reloadT = 0;
  a.ads = 0;
  // online: a guest throws its own at once and the host throws the real one; everyone else is sent how it flies
  if (!m.authority && a.id === m.me) m.net?.throwNade(kind, a.yaw, a.pitch);
  m.events.push({ t: 'throw', a: a.id, kind, n: { ...n } });
}

const nadeHit = newHit();
function stepNades(m: Match, dt: number) {
  const w = m.world;
  for (const n of m.nades) {
    n.fuse -= dt;
    // an impact grenade armed (a moment out of the hand) goes off on whatever it meets; an incendiary on the ground
    const armed = n.kind === 'impact' && n.fuse < FUSE_OF.impact - 0.06;
    if (!n.rest) {
      n.vy -= GRAVITY * 0.7 * dt;
      const dx = n.vx * dt;
      const dy = n.vy * dt;
      const dz = n.vz * dt;
      const len = Math.hypot(dx, dy, dz);
      n.spin += len * 4;
      if (len > 1e-6) {
        rayWorld(w, n.x, n.y, n.z, dx / len, dy / len, dz / len, len + 0.08, nadeHit);
        if (nadeHit.kind !== 'none') {
          const t = Math.max(0, nadeHit.t - 0.08);
          n.x += (dx / len) * t;
          n.y += (dy / len) * t;
          n.z += (dz / len) * t;
          const vn = n.vx * nadeHit.nx + n.vy * nadeHit.ny + n.vz * nadeHit.nz;
          n.vx = (n.vx - 1.45 * vn * nadeHit.nx) * 0.6;
          n.vy = (n.vy - 1.45 * vn * nadeHit.ny) * 0.6;
          n.vz = (n.vz - 1.45 * vn * nadeHit.nz) * 0.6;
          if (Math.abs(vn) > 2) m.events.push({ t: 'bounce', x: n.x, y: n.y, z: n.z });
          if (nadeHit.ny > 0.6 && Math.hypot(n.vx, n.vy, n.vz) < 1.2) n.rest = true;
          if (nadeHit.kind === 'water' && !w.terrain.ice) n.rest = true;
          if (armed || (n.kind === 'fire' && nadeHit.ny > 0.6)) n.fuse = 0;
        } else {
          n.x += dx;
          n.y += dy;
          n.z += dz;
        }
      }
      const fl = floorAt(w.terrain, n.x, n.z);
      if (n.y < fl + 0.06) {
        n.y = fl + 0.06;
        if (n.vy < 0) n.vy = -n.vy * 0.35;
        n.vx *= 0.7;
        n.vz *= 0.7;
        if (Math.hypot(n.vx, n.vy, n.vz) < 1.2) n.rest = true;
        if (armed || n.kind === 'fire') n.fuse = 0;
      }
      // an impact grenade also goes off on someone it flies into (not its thrower)
      if (armed && n.fuse > 0)
        for (const a of m.actors) {
          if (!a.alive || a.drop || a.id === n.owner) continue;
          if (Math.abs(a.body.x - n.x) < 0.45 && Math.abs(a.body.z - n.z) < 0.45 && n.y > a.body.y - 0.1 && n.y < a.body.y + a.body.height + 0.1) {
            n.fuse = 0;
            break;
          }
        }
    }
    if (n.kind === 'decoy' && n.fuse > 0 && n.fuse < DECOY_LIFE) decoy(m, n, dt);
    if (n.fuse <= 0) {
      if (n.kind === 'frag') explode(m, n, 7.5, 125, 'frag');
      else if (n.kind === 'impact') explode(m, n, IMPACT_R, IMPACT_DMG, 'impact');
      else if (n.kind === 'flash') flashbang(m, n);
      else if (n.kind === 'fire') ignite(m, n);
      else if (n.kind === 'smoke') {
        m.smokes.push({ x: n.x, y: n.y, z: n.z, age: 0, life: 15, r: 0 });
        m.events.push({ t: 'smoke', x: n.x, y: n.y, z: n.z });
        // a smoke on a fire puts it out
        m.fires = m.fires.filter((f) => Math.hypot(f.x - n.x, f.z - n.z) > 5.2 || Math.abs(f.y - n.y) > 3);
      }
    }
  }
  m.nades = m.nades.filter((n) => n.fuse > 0);
  for (const s of m.smokes) {
    s.age += dt;
    s.r = 5.6 * smoothstep(0, 1.6, s.age) * (1 - smoothstep(s.life - 1.5, s.life, s.age) * 0.6);
  }
  m.smokes = m.smokes.filter((s) => s.age < s.life);
  if (m.fires.length) stepFires(m, dt);
}

/** An incendiary catches where it lies: a patch of burning ground (unless it came down in water). */
function ignite(m: Match, n: Nade) {
  const t = m.world.terrain;
  const y = groundAt(m.world, n.x, n.z, n.y + 0.3);
  if (t.hasWater && !t.ice && heightAt(t, n.x, n.z) > y - 0.05 && heightAt(t, n.x, n.z) < t.water) {
    m.events.push({ t: 'smoke', x: n.x, y: t.water, z: n.z });
    return;
  }
  m.fires.push({ x: n.x, y, z: n.z, r: 0, age: 0, life: FIRE_LIFE, owner: n.owner, tick: 0.1 });
  m.events.push({ t: 'fire', x: n.x, y, z: n.z });
  m.sounds.push({ x: n.x, z: n.z, t: m.time, team: m.actors[n.owner]?.team ?? -1, range: 40, who: n.owner });
}

/** Is a point on burning ground? */
export function inFire(m: Match, x: number, y: number, z: number, pad = 0) {
  for (const f of m.fires) if (Math.abs(f.x - x) < f.r + pad && Math.abs(f.z - z) < f.r + pad && Math.hypot(f.x - x, f.z - z) < f.r + pad && y > f.y - 0.8 && y < f.y + 1.4) return f;
  return null;
}

/** The fires burn: they spread out to full size, bite whoever stands in them four times a second (the thrower too,
 * never a teammate, like a frag), and die down. */
function stepFires(m: Match, dt: number) {
  for (const f of m.fires) {
    f.age += dt;
    f.r = FIRE_R * smoothstep(0, 0.45, f.age) * (1 - smoothstep(f.life - 0.8, f.life, f.age) * 0.5);
    f.tick -= dt;
    if (f.tick > 0) continue;
    f.tick += 0.25;
    // (an online guest's fires are pictures of the host's: the host does the damage)
    if (!m.authority) continue;
    const owner = m.actors[f.owner];
    for (const a of m.actors) {
      if (!a.alive || a.drop) continue;
      if (owner && a !== owner && !isEnemy(owner, a)) continue;
      if (Math.hypot(a.body.x - f.x, a.body.z - f.z) > f.r + 0.25 || a.body.y < f.y - 0.8 || a.body.y > f.y + 1.4) continue;
      damage(m, a, FIRE_DPS * 0.25, f.owner, 'fire', 'leg', a.body.x, a.body.y + 0.3, a.body.z);
    }
  }
  m.fires = m.fires.filter((f) => f.age < f.life);
}

/** A decoy on the ground plays bursts of its thrower's gun: heard as a fight by everyone, and taken for an enemy by
 * the other side's bots. */
function decoy(m: Match, n: Nade, dt: number) {
  n.next = (n.next ?? 0) - dt;
  if (n.next > 0) return;
  const def = WEAPONS[n.w ?? 'kestrel'];
  if ((n.left ?? 0) <= 0) {
    // the next burst, after a pause
    n.left = def.auto ? 3 + Math.floor(m.rng() * 5) : 1 + Math.floor(m.rng() * 3);
    n.next = 0.5 + m.rng() * 1.2;
    return;
  }
  n.left = (n.left ?? 1) - 1;
  n.next = interval(def) * (def.auto ? 1 + m.rng() * 0.2 : 1.6 + m.rng() * 1.5);
  m.events.push({ t: 'decoy', x: n.x, y: n.y + 0.1, z: n.z, w: def.id });
  m.sounds.push({ x: n.x, z: n.z, t: m.time, team: m.actors[n.owner]?.team ?? -1, range: shotRange(def), who: n.owner, fake: true });
}

/** A flashbang goes off: everyone with a clear line to it is blinded, for longer the nearer they are and the more
 * they were looking at it (looking away saves most of it, so throw it and turn). */
const FLASH_R = 34;
function flashbang(m: Match, n: Nade) {
  m.events.push({ t: 'flash', x: n.x, y: n.y, z: n.z });
  m.sounds.push({ x: n.x, z: n.z, t: m.time, team: m.actors[n.owner]?.team ?? -1, range: 90, who: n.owner });
  for (const a of m.actors) {
    if (!a.alive || a.drop) continue;
    // (an online guest judges only its own eyes; the host does everyone's)
    if (!m.authority && a.id !== m.me) continue;
    const ey = eyeY(a);
    const dx = n.x - a.body.x;
    const dy = n.y + 0.1 - ey;
    const dz = n.z - a.body.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > FLASH_R) continue;
    if (d > 0.5) {
      rayWorld(m.world, a.body.x, ey, a.body.z, dx / d, dy / d, dz / d, d - 0.2, nadeHit);
      if (nadeHit.kind !== 'none') continue;
      if (smokeBlocks(m, a.body.x, ey, a.body.z, n.x, n.y + 0.1, n.z)) continue;
    }
    const v = viewDir(a.yaw, a.pitch);
    const facing = d > 0.5 ? (v.x * dx + v.y * dy + v.z * dz) / d : 1;
    const look = clamp((facing + 0.35) / 0.85, 0.1, 1);
    const secs = (0.3 + 3.6 * Math.pow(1 - d / FLASH_R, 0.7)) * look;
    if (secs < 0.5 || secs <= a.blindT) continue;
    a.blindT = secs;
    a.blind0 = secs;
    m.events.push({ t: 'blind', a: a.id, secs });
  }
}

/** A frag (or an impact grenade) goes off: hurts everyone within R, less behind cover or a raised shield facing it. */
function explode(m: Match, n: Nade, R: number, dmg: number, cause: 'frag' | 'impact') {
  m.events.push({ t: 'boom', x: n.x, y: n.y, z: n.z });
  m.sounds.push({ x: n.x, z: n.z, t: m.time, team: m.actors[n.owner]?.team ?? -1, range: 120, who: n.owner });
  // (an online guest's grenades are pictures of the host's: the host does the damage)
  if (!m.authority) return;
  for (const a of m.actors) {
    if (!a.alive) continue;
    const owner = m.actors[n.owner];
    if (owner && a !== owner && !isEnemy(owner, a)) continue;
    const cy = a.body.y + a.body.height * 0.55;
    const d = Math.hypot(a.body.x - n.x, cy - n.y, a.body.z - n.z);
    if (d > R) continue;
    const dx = a.body.x - n.x;
    const dy = cy - (n.y + 0.3);
    const dz = a.body.z - n.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    rayWorld(m.world, n.x, n.y + 0.3, n.z, dx / l, dy / l, dz / l, l, nadeHit);
    let cover = nadeHit.kind === 'none' ? 1 : 0.2;
    if (a.paviseUp && d > 0.8 && (-dx * -Math.sin(a.yaw) + -dz * -Math.cos(a.yaw)) / l > 0.4) {
      hurtShield(a, dmg * 0.5);
      cover *= 0.4;
    }
    damage(m, a, dmg * Math.pow(1 - d / R, 1.25) * cover, n.owner, cause, 'body', a.body.x, cy, a.body.z);
  }
  if (m.cars.length) blastCars(m, n.x, n.y, n.z, R, cause === 'frag' ? 260 : 200, n.owner);

}

/** Does any smoke cloud cut the line between two points? */
export function smokeBlocks(m: Match, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  for (const s of m.smokes) {
    if (s.r < 1) continue;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    const k = clamp(((s.x - ax) * dx + (s.y + 1.2 - ay) * dy + (s.z - az) * dz) / l2, 0, 1);
    const d = Math.hypot(ax + dx * k - s.x, ay + dy * k - s.y - 1.2, az + dz * k - s.z);
    if (d < s.r * 0.88) return true;
  }
  return false;
}

/** Applies one actor's input for a frame. */
function act(m: Match, a: Actor, input: Input, dt: number) {
  let inp = input;
  const b = a.body;
  a.yaw = inp.yaw;
  a.pitch = clamp(inp.pitch, -1.45, 1.45);
  if (!a.alive) return;
  // royale: aboard the transport, falling or under the canopy
  if (a.drop) {
    if (a.drop === 1) {
      if (inp.jump) jumpOut(m, a);
      return;
    }
    stepDrop(m, a, inp, dt);
    return;
  }
  // buying (an online guest asks the host, who keeps the credits)
  if (inp.buy) {
    if (m.authority) buy(m, a, inp.buy);
    else if (canShop(m, a) && !owns(a, inp.buy)) m.net?.buy(inp.buy);
  }
  // in a vehicle (F gets out; the driver's keys drive it), or F at a vehicle's door gets in
  // (an online guest asks the host, who seats it and says so)
  if (m.cars.length) {
    if (a.car >= 0 && inp.ride) {
      if (m.authority) leaveCar(m, a);
      else m.net?.ride?.(-1);
      inp = { ...inp, use: false, ride: false };
    } else if (a.car < 0 && inp.ride) {
      const c = carNear(m, a);
      if (c && (m.authority ? enterCar(m, a, c) : (m.net?.ride?.(c.id), true))) inp = { ...inp, use: false, ride: false };
    }
    if (a.car >= 0) inp = rideInput(m, a, inp);
  }
  // picking up and healing
  if (m.mode === 'royale') {
    // (an online guest asks the host for it, which puts it in its pockets and says so)
    if (inp.use) {
      const it = lootNear(m, a, 2.1, a.bot);
      if (it) takeLoot(m, a, it);
    } else if (!a.bot && Math.floor(m.time * 8) !== Math.floor((m.time - dt) * 8)) {
      // walk over it to take it: ammo, heals, grenades, better armor, and a gun for an empty slot (F swaps a gun)
      const it = autoLoot(m, a);
      if (it) takeLoot(m, a, it);
    }
    if ((inp.heal || inp.boost || inp.item) && a.healT <= 0) {
      // a chosen item (the item bar, its keys or the kit panel), when you have one and it would help; else H: a heal
      // while one helps, else a boost; the boost key only a boost (an online guest asks the host, see startHeal)
      const kind = inp.item ? (canUse(a, inp.item) ? inp.item : null) : ((inp.heal ? healPick(a) : null) ?? boostPick(a));
      if (kind) startHeal(m, a, kind);
    }
    if (a.healT > 0) {
      if (inp.fire || inp.slot >= 0 || inp.jump || inp.throw) {
        a.healT = 0;
        a.healKind = null;
        if (!m.authority) m.net?.heal?.(null);
      } else tickHeal(m, a, dt);
    }
  }
  // planting or defusing: stand still with the gun down until done or let go
  // (a guest only holds still where it could; the host does the planting and defusing and says how far along it is)
  if (m.mode === 'breach' && m.phase === 'live' && (m.authority ? stepCharge(m, a, inp, dt) : inp.use && (plantSite(m, a) >= 0 || canDefuse(m, a)))) {
    inp = { ...inp, mx: 0, mz: 0, jump: false, fire: false, ads: false, reload: false, slot: -1, throw: null, walk: true };
    a.reloadT = 0;
  }
  // weapon switch (a long gun takes both hands: the shield goes down)
  if ((inp.slot === 0 || inp.slot === 1 || inp.slot === 2) && inp.slot !== a.slot && a.guns[inp.slot]) {
    a.slot = inp.slot;
    const nw = WEAPONS[a.guns[inp.slot]!.id];
    a.switchT = nw.equip;
    a.reloadT = 0;
    a.ads = 0;
    a.spray = 0;
    a.burstLeft = 0;
    if (a.slot !== 1) a.paviseUp = false;
    m.events.push({ t: 'swap', a: a.id });
  }
  // the shield: raised, the sidearm comes out in the other hand; lowered, it hangs on your back
  if (a.car >= 0 || a.pavise <= 0) a.paviseUp = false;
  else if (inp.shield) {
    a.paviseUp = !a.paviseUp;
    if (a.paviseUp && a.slot !== 1 && a.guns[1]) {
      a.slot = 1;
      a.switchT = WEAPONS[a.guns[1].id].equip;
      a.reloadT = 0;
      a.spray = 0;
      a.burstLeft = 0;
    }
    a.ads = 0;
    m.events.push({ t: 'swap', a: a.id });
  }
  const g = currentGun(a);
  const w = g ? WEAPONS[g.id] : WEAPONS.wren;
  // timers
  a.fireCd = Math.max(-dt, a.fireCd - dt);
  a.shield = Math.max(0, a.shield - dt);
  a.blindT = Math.max(0, a.blindT - dt);
  if (a.switchT > 0) a.switchT = Math.max(0, a.switchT - dt);
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) {
      a.reloadT = 0;
      const cg = currentGun(a);
      if (cg) {
        const need = magOf(cg) - cg.mag;
        const take = Math.min(need, spareOf(m, a, cg));
        cg.mag += take;
        if (m.mode === 'royale') {
          a.ammo[AMMO_OF[cg.id]] -= take;
          // (online, a guest's pockets are the host's: it is told what went into the gun)
          if (!m.authority && a.id === m.me && take > 0) m.net?.spend?.(AMMO_OF[cg.id], take);
        }
        else if (m.mode !== 'dm') cg.reserve -= take;
      }
    }
  }
  if (m.time - a.lastShot > interval(w) * 1.2) a.bloom = Math.max(0, a.bloom - dt * (w.bloomMax * 2.5 + 2));
  // breach: spare ammo comes back by itself a couple of seconds after you stop firing (about a magazine every 6 s,
  // for the gun in hand first), so a long fight never leaves you dry
  if (m.mode === 'breach' && m.time - a.lastShot > 2) {
    const g = a.guns[a.slot] && a.guns[a.slot]!.reserve < WEAPONS[a.guns[a.slot]!.id].reserve ? a.guns[a.slot] : a.guns.find((o) => o && o.reserve < WEAPONS[o.id].reserve);
    if (g) {
      const full = WEAPONS[g.id];
      a.ammoBack += (full.mag / 6) * dt;
      const n = Math.floor(a.ammoBack);
      if (n > 0) {
        a.ammoBack -= n;
        g.reserve = Math.min(full.reserve, g.reserve + n);
      }
    } else a.ammoBack = 0;
  }
  // recoil comes back down once you stop firing
  if (a.kickP > 0 && m.time - a.lastShot > Math.min(0.2, interval(w) * 1.5)) {
    const back = Math.min(a.kickP, dt * (8 + a.kickP * 6)) * 0.75;
    if (a.bot) a.pitch -= back * DEG;
    a.kickP = Math.max(0, a.kickP - back / 0.75);
  }
  // aiming
  const canAds = a.reloadT <= 0 && a.switchT <= 0 && !b.swim && !a.paviseUp;
  const adsTarget = inp.ads && canAds ? 1 : 0;
  a.ads = clamp(a.ads + (adsTarget ? 1 : -1.6) * (dt / (g?.mods ? adsTimeOf(g) : w.adsTime)), 0, 1);
  // crouch
  const wantCrouch = inp.crouch && !b.swim;
  a.crouch = clamp(a.crouch + (wantCrouch ? 1 : -1) * dt * 7, 0, 1);
  b.height = lerp(STAND_H, CROUCH_H, a.crouch);
  // movement (a rider is carried: the car puts it in its seat)
  if (a.car >= 0) a.walking = false;
  else {
    a.walking = inp.walk;
    let mx = inp.mx;
    let mz = inp.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    let speed = b.swim ? 2.4 : a.crouch > 0.5 ? CROUCH_SPEED : inp.walk || a.healT > 0 ? WALK : RUN;
    // (a boost high up puts a little more in a run)
    if (speed === RUN && a.boost >= BOOST_FAST) speed *= BOOST_RUN;
    speed *= w.weight * (a.ads > 0.5 ? 0.78 : 1) * (a.paviseUp ? PAVISE.slow : 1);
    const sy = Math.sin(a.yaw);
    const cy = Math.cos(a.yaw);
    // forward (-sin, -cos), right (cos, -sin)
    const tx = (cy * mx - sy * mz) * speed;
    const tz = (-sy * mx - cy * mz) * speed;
    if (b.onGround) {
      const k = 1 - Math.exp(-(ml > 0.05 ? 13 : 17) * dt);
      b.vx += (tx - b.vx) * k;
      b.vz += (tz - b.vz) * k;
      if (inp.jump && !b.swim && a.crouch < 0.5) {
        b.vy = JUMP;
        b.onGround = false;
        m.events.push({ t: 'jump', a: a.id });
      }
    } else {
      const k = 1 - Math.exp(-2.2 * dt);
      b.vx += (tx - b.vx) * k;
      b.vz += (tz - b.vz) * k;
    }
    const airborne = !b.onGround;
    const ox = b.x;
    const oz = b.z;
    stepBody(m.world, b, dt);
    // the buy phase keeps everyone in their spawn
    if (m.mode === 'breach' && m.phase === 'buy') {
      const s = spawnOf(m, a.team);
      const dx = b.x - s.x;
      const dz = b.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > SPAWN_R) {
        b.x = s.x + (dx / d) * SPAWN_R;
        b.z = s.z + (dz / d) * SPAWN_R;
      }
    }
    if (airborne && b.onGround) m.events.push({ t: 'land', a: a.id });
    footsteps(m, a, ox, oz, inp.walk);
  }
  // fighting is off until the round goes live
  const armed = m.mode !== 'breach' || m.phase === 'live';
  if (!armed) {
    a.fireHeld = inp.fire;
    return;
  }
  if (inp.throw) throwNade(m, a, inp.throw);
  if (inp.reload) startReload(m, a);
  if (a.healT > 0) {
    a.fireHeld = inp.fire;
    return;
  }
  // (a raised shield leaves only the sidearm's hand free)
  const ready = !!g && a.switchT <= 0 && a.reloadT <= 0 && !(a.paviseUp && a.slot !== 1);
  if (g && w.burst > 0) {
    // a burst gun: one pull fires the burst on its own, then a pause before the next
    if (inp.fire && !a.fireHeld && a.burstLeft <= 0 && ready && a.fireCd <= 0 && g.mag > 0) a.burstLeft = w.burst;
    if (a.burstLeft > 0) {
      if (!ready || g.mag <= 0) a.burstLeft = 0;
      else if (a.fireCd <= 0) {
        fire(m, a);
        a.burstLeft--;
        if (a.burstLeft <= 0) a.fireCd += w.burstGap;
      }
    } else if (inp.fire && g.mag <= 0 && a.reloadT <= 0 && !a.fireHeld) fire(m, a);
  } else if (inp.fire && ready && a.fireCd <= 0 && (w.auto || !a.fireHeld)) fire(m, a);
  else if (inp.fire && g && g.mag <= 0 && a.reloadT <= 0 && !a.fireHeld) fire(m, a);
  // a crossbow spans the next bolt by itself
  if (g && w.cls === 'crossbow' && g.mag <= 0 && a.fireCd <= 0) startReload(m, a);
  if (a.fireCd < 0) a.fireCd = 0;
  a.fireHeld = inp.fire;

}

/** The walk cycle and footsteps for a stretch walked: running is loud (heard by bots too), walking and crouching quiet. */
function footsteps(m: Match, a: Actor, ox: number, oz: number, walk: boolean) {
  const b = a.body;
  const moved = Math.hypot(b.x - ox, b.z - oz);
  // (a jump to a new place, a round start, is no stride)
  if (moved > 3) return;
  a.phase += moved * 1.15;
  if (!b.onGround) return;
  a.stepDist += moved;
  if (a.stepDist <= 2.1) return;
  a.stepDist = 0;
  const loud = !walk && a.crouch < 0.5 && Math.hypot(b.vx, b.vz) > WALK + 0.4;
  m.events.push({ t: 'step', a: a.id, loud, s: surfaceUnder(m, a) });
  if (loud) m.sounds.push({ x: b.x, z: b.z, t: m.time, team: a.team, range: 24, who: a.id });
}

/** Online, on the host: a player on another machine. Their body was put where their machine says (see online.ts);
 * here only the rules: footsteps for the bots to hear, timers, the buy phase fence, planting and defusing. */
const useIn = idleInput();
function remoteStep(m: Match, a: Actor, dt: number) {
  const b = a.body;
  const n = a.net;
  a.shield = Math.max(0, a.shield - dt);
  a.blindT = Math.max(0, a.blindT - dt);
  if (!a.alive || !n) return;
  a.walking = n.walking;
  a.crouch = n.crouch;
  a.ads = n.ads;
  a.reloadT = n.reloading ? Math.max(a.reloadT, 0.1) : 0;
  b.height = lerp(STAND_H, CROUCH_H, a.crouch);
  footsteps(m, a, a.lastX, a.lastZ, n.walking);
  a.lastX = b.x;
  a.lastZ = b.z;
  if (m.mode === 'breach' && m.phase === 'buy') {
    const s = spawnOf(m, a.team);
    const dx = b.x - s.x;
    const dz = b.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > SPAWN_R + 1) {
      b.x = s.x + (dx / d) * SPAWN_R;
      b.z = s.z + (dz / d) * SPAWN_R;
    }
  }
  if (m.mode === 'breach' && m.phase === 'live') {
    useIn.use = n.use;
    stepCharge(m, a, useIn, dt);
  }
  // royale: a heal or boost the guest asked for (see online.ts) is done here
  if (a.healT > 0) tickHeal(m, a, dt);
}

/** Online, on a guest: someone this machine only shows (moved by the host's stream): the walk cycle and footsteps. */
function puppet(m: Match, a: Actor, dt: number) {
  a.blindT = Math.max(0, a.blindT - dt);
  if (a.reloadT > 0) a.reloadT = Math.max(0.05, a.reloadT - dt);
  if (!a.alive) return;
  footsteps(m, a, a.lastX, a.lastZ, a.walking);
  a.lastX = a.body.x;
  a.lastZ = a.body.z;
}

/** What a body stands on, for its footsteps: a floor or a crate's top, water, or the map's own ground. */
function surfaceUnder(m: Match, a: Actor): Surface {
  const b = a.body;
  if (b.swim) return 'water';
  const t = m.world.terrain;
  const g = floorAt(t, b.x, b.z);
  if (b.y > g + 0.08)
    for (const q of m.world.boxes) if (b.x > q.x0 && b.x < q.x1 && b.z > q.z0 && b.z < q.z1 && Math.abs(b.y - q.y1) < 0.3) return q.s;
  if (t.ice && heightAt(t, b.x, b.z) < t.water) return 'stone';
  const id = m.world.id;
  return id === 'frost' ? 'snow' : id === 'mesa' ? 'sand' : id === 'isles' && g < t.water + 2.5 ? 'sand' : 'leaf';
}

function spot(m: Match) {
  for (const e of m.actors) {
    const mine = m.actors[m.me].team;
    if (!e.alive || e.team === mine) continue;
    for (const f of m.actors) {
      if (!f.alive || f.team !== mine) continue;
      const dx = e.body.x - f.body.x;
      const dz = e.body.z - f.body.z;
      const d = Math.hypot(dx, dz);
      if (d > 170) continue;
      const fw = viewDir(f.yaw, 0);
      if ((dx * fw.x + dz * fw.z) / (d || 1) < 0.5 && d > 6) continue;
      const ey = eyeY(f);
      const ty = e.body.y + e.body.height * 0.7;
      if (smokeBlocks(m, f.body.x, ey, f.body.z, e.body.x, ty, e.body.z)) continue;
      const l = Math.hypot(dx, ty - ey, dz) || 1;
      rayWorld(m.world, f.body.x, ey, f.body.z, dx / l, (ty - ey) / l, dz / l, l, hit);
      if (hit.kind === 'none') {
        m.spotted[e.id] = m.time;
        callout(m, mine, e.body.x, e.body.z);
        break;
      }
    }
  }
}

/** Advances the match by dt seconds. `you` is the local player's input (ignored once you are out). */
export function step(m: Match, dt: number, you: Input) {
  m.events = [];
  if (m.phase === 'over') return;
  m.time += dt;
  for (const a of m.actors) {
    // (your seat handed to a bot, as the dev autopilot does, plays as one)
    if (a.id === m.me) act(m, a, a.bot && a.brain && m.authority ? botInput(m, a, dt) : you, dt);
    // an online guest mirrors everyone else: they are where the host's stream puts them
    else if (!m.authority) puppet(m, a, dt);
    // the host: a remote player is where their own machine says, and the rules here judge what they do
    else if (a.remote) remoteStep(m, a, dt);
    else act(m, a, a.bot ? botInput(m, a, dt) : idleInput(a.yaw, a.pitch), dt);
  }
  if (m.cars.length) stepCars(m, dt);
  stepBullets(m, dt);
  stepNades(m, dt);
  m.sounds = m.sounds.filter((s) => m.time - s.t < 1.5);
  m.spotT -= dt;
  if (m.spotT <= 0 && m.mode === 'breach') {
    m.spotT = 0.25;
    spot(m);
  }
  if (m.authority) stepRules(m, dt);
  else {
    // a guest's clocks run on between the host's updates (which set them right)
    m.phaseT = Math.max(0, m.phaseT - dt);
    if (m.charge.state === 'planted') m.charge.fuse = Math.max(0, m.charge.fuse - dt);
    if (m.mode === 'royale') mirrorRoyale(m, dt);
    else if (m.mode === 'dm') {
      m.clock += dt;
      for (const a of m.actors) if (!a.alive) a.respawnT = Math.max(0, a.respawnT - dt);
    }
  }
}

/** The final score for the local player: combat score, with the match bonus already in. */
export const finalScore = (m: Match) => Math.max(1, Math.round(me(m).cs));

/** Places in a deathmatch, best first. */
export const standings = (m: Match) => [...m.actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.cs - a.cs);

export { ARENA, yawTo };
