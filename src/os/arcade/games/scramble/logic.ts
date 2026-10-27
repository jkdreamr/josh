// Scramble's simulation: eggs on the bus, gliding down, looting, shooting, throwing, building walls and outlasting
// the storm, plus the computer players. Pure, so it can be tested, and the same on every client.
//
// Online, each egg belongs to one client: yours to you, the computer players to the host. Only the owner moves an egg,
// heals it, and decides when it cracks. A bullet's damage is decided by whoever fired it, against the eggs where that
// client sees them, then sent to the egg's owner; grenades and launcher eggs work the same way. Things the whole
// island sees (a barrel going up, a puddle of hot sauce) are felt by each client on the eggs it owns. The host settles
// everything shared: who got a pickup, when a chest opens or a crate, barrel or wall breaks, and who won. `world` is
// true where those calls are made (solo and the host). Window glass is simpler: whoever's shot, swing or blast breaks
// it breaks it on their own screen and tells the host, who tells everyone (glass only ever breaks, so nobody can
// disagree about it). Doors are the host's to open and shut (a guest asks), and to knock off their hinges.
//
// Underground (see map.ts DEEP), each basement lies far off east of the ground over it, so nothing up top and nothing
// below can see, shoot, throw at or hurt each other: the stairs are the only way between, for eggs on foot and nothing
// else. The storm bites below as it does over the ground above.
//
// In duos and squads, eggs play in teams that can't hurt each other. An egg's owner knocks it down (rather than
// cracking it) while a teammate still stands, bleeds it out, and cracks it once nobody on its team is standing. A
// teammate reviving it says so as it goes, and the host stands it back up once the revive is done.
import {
  AMMO_BOX,
  BOOST,
  FLARE_WAIT,
  HP_MAX,
  MATS,
  MAT_MAX,
  MAT_SPECS,
  MELEE,
  MELEE_IDS,
  MAX_SCOPE,
  PAN_ARC,
  PIECE_COST,
  SCOPE_VIEW,
  SHIELD_MAX,
  SIP,
  THROW,
  THROWS,
  THROW_IDS,
  USES,
  USE_IDS,
  WEAPONS,
  WEAPON_IDS,
  ammoCap,
  armorMult,
  damageOf,
  isAmmo,
  isMat,
  isUse,
  isWeapon,
  reloadOf,
  rng32,
  throwCap,
  useCap,
  type Ammo,
  type LootDef,
  type Mat,
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
  HALF,
  HAY_HW,
  PAD,
  POND_SLOW,
  RIVER_HALF,
  ROAD_SPEED,
  SUPPLY_FALL,
  TOILET_R,
  WALL_T,
  DEEP,
  basementAt,
  bridgeAt,
  buildingAt,
  busAt,
  clampX,
  coverAt,
  dropFits,
  fireAt,
  furnitureSolid,
  generateMap,
  grassAt,
  isDeep,
  low,
  offStairs,
  opens,
  padAt,
  placeDrop,
  pushBox,
  pushCircle,
  pushObb,
  rayBox,
  rayCircle,
  rayObb,
  raySolid,
  riverCrossings,
  roadAt,
  roomAt,
  solidsAlong,
  solidsNear,
  stairAt,
  stairOf,
  stairOut,
  stormAt,
  topX,
  waterAt,
  yardAt,
  type Box,
  type Bridge,
  type Building,
  type Container,
  type Door,
  type GameMap,
  type Obb,
  type Solid,
  type Stair,
  type StormNow,
} from './map.ts';

export const COUNTDOWN = 3;
export const MAX_FIGHTERS = 50;
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
/** A wood wall's health once built. */
export const WALL_HP = MAT_SPECS.wood.hp;
export const BUILD_COOL = 0.3;
/** The wait between edits; a build key pressed while the last piece is still going up waits for its turn this long. */
export const EDIT_COOL = 0.15;
export const BUILD_WAIT = 0.5;
/** Two presses of the build key closer than this box you in. */
export const BOX_TAP = 0.35;
/**
 * Building: pieces stand on a grid of squares CELL_B meters across (a wall spans one side of one), one storey
 * (LEVEL_H meters) apart, from the ground (level 0) up to MAX_LEVEL. A piece starts at BUILD_START of its health
 * and builds up to all of it.
 */
export const CELL_B = WALL_HALF * 2;
export const LEVEL_H = 3;
export const MAX_LEVEL = 2;
export const BUILD_START = 0.1;
/** The most pieces standing in a match. */
export const MAX_PIECES = 1500;
/** Half the width of the gap a doorway or a window cuts in a wall. */
export const GAP = 0.9;
/** How far up a step an egg takes in its stride, and how fast it drops when there is nothing under it. */
export const STEP_UP = 0.6;
export const DROP_V = 11;
/** Extra meters of view an egg gets for each level it stands up high. */
export const HIGH_VIEW = 6;
export const STORM_TICK = 0.5;
export const CRATE_HP = 60;
export const TOILET_HP = 35;
export const HAY_HP = 50;
/** A barrel takes this much before it goes up, then hurts everything within `radius`. */
export const BARREL = { hp: 40, radius: 5, dmg: 75 };
/** What a door takes before it comes off its hinges, how near its doorway an egg reaches it, and a vault door's wait. */
export const DOOR_HP = 120;
export const DOOR_R = 1.3;
export const VAULT_TIME = 8;
/** A door's state: shut, open (swung out of its doorway, or in), knocked off its hinges, or (a vault door) opening. */
export const DOOR_SHUT = 0;
export const DOOR_OUT = 1;
export const DOOR_IN = -1;
export const DOOR_GONE = 2;
export const DOOR_OPENING = 3;
export const DOOR_STATES = [DOOR_SHUT, DOOR_OUT, DOOR_IN, DOOR_GONE, DOOR_OPENING] as const;
/** A ghillie suit hides an egg that has kept still this long on grass, from anyone farther off than `near`. */
export const GHILLIE = { still: 0.6, near: 4 };
/** Kills it takes to be the kill leader. */
export const LEADER_MIN = 3;
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
export const F_SPIN = 256;
export const F_SMOOTHIE = 512;
export const F_TART = 1024;
export const F_GHILLIE = 2048;
export const F_STUN = 4096;
export const F_DOWN = 8192;
export const F_REVIVE = 16384;
/** The highest flag bits there are. */
export const F_ALL = 32767;
/** `bush` for an egg hiding in a bush grown from a can. */
export const GROWN = 1_000_000;

export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];
export const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);
export type Role = 'solo' | 'host' | 'guest';
/** Every egg for itself, or teams of two (duos) or four (squads). */
export type Mode = 'solo' | 'duos' | 'squads';
export const MODES: readonly Mode[] = ['solo', 'duos', 'squads'];
export const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);
export const TEAM_SIZE: Record<Mode, number> = { solo: 1, duos: 2, squads: 4 };
export const MODE_NAMES: Record<Mode, string> = { solo: 'Solo', duos: 'Duos', squads: 'Squads' };
/** The most teams a match has: fifty eggs one each. */
export const MAX_TEAMS = 50;
/**
 * Knocked down (in duos and squads, while a teammate still stands): an egg crawls at CRAWL of its pace, can't shoot,
 * and bleeds DOWN_HP away over BLEED_T seconds (not while a teammate revives it). A teammate holding the interact key
 * within REVIVE_R for REVIVE_T seconds gets it back up with REVIVE_HP.
 */
export const DOWN_HP = 100;
export const BLEED_T = 30;
export const CRAWL = 0.32;
export const REVIVE_T = 5;
export const REVIVE_R = 2.2;
export const REVIVE_HP = 30;
/** How long a ping marks its spot for the team, and the wait between two of one egg's. */
export const PING_T = 8;
export const PING_COOL = 0.6;
/**
 * Emotes and quick chat: faces anyone nearby sees over the egg, and (in duos and squads) calls only its team sees: asks
 * for meds, a shield, ammo (the kind it's lowest on) or a gun, help, follow me, an enemy where it points (a ping there
 * too) and on my way. Each shows for EMOTE_T seconds; an egg emotes EMOTE_GAP apart at most, and EMOTE_BURST times in
 * EMOTE_SPAN seconds.
 */
export const EMOTE_IDS = ['happy', 'sad', 'thumbs', 'angry', 'gg', 'meds', 'shield', 'ammo', 'gun', 'help', 'follow', 'enemy', 'omw'] as const;
export type EmoteId = (typeof EMOTE_IDS)[number];
export const FACE_EMOTES: readonly EmoteId[] = ['happy', 'sad', 'thumbs', 'angry', 'gg'];
export const TEAM_EMOTES: readonly EmoteId[] = ['meds', 'shield', 'ammo', 'gun', 'help', 'follow', 'enemy', 'omw'];
export const isTeamEmote = (k: EmoteId) => TEAM_EMOTES.includes(k);
export const EMOTE_T = 3.5;
export const EMOTE_GAP = 0.8;
export const EMOTE_BURST = 3;
export const EMOTE_SPAN = 6;
/** How long a computer egg keeps at what a teammate asked of it: bringing something, following, looking somewhere. */
export const ASK_T = 25;
export const FOLLOW_T = 60;
export const LOOK_T = 6;
/**
 * Each egg's own color on its team (by its place there): its ring, outline, name tag, marker, pings, its number on the
 * team panel and its dot on the maps. None of them is red, which is the other teams' (their name tags) and a knocked
 * egg's.
 */
export const MATE_COLORS = ['#2ee6c9', '#ffb020', '#ff5ca8', '#9b8cff'];
export const FOE_COLOR = '#ff4d4d';
export type Phase = 'bus' | 'drop' | 'ground' | 'out';
export const PHASES: readonly Phase[] = ['bus', 'drop', 'ground', 'out'];
export type Kind = 'player' | 'bot' | 'remote';
/**
 * What dealt a hit: a gun, a melee weapon, a grenade (or a MIRV's), an impulse egg, hot sauce, a barrel, or the storm.
 * An egg out from bleeding while knocked down went out to 'bleed'.
 */
export type Cause = WeaponId | MeleeId | 'grenade' | 'mirv' | 'impulse' | 'sauce' | 'barrel' | 'storm' | 'left' | 'bleed';
export const CAUSES: readonly Cause[] = [...WEAPON_IDS, ...MELEE_IDS, 'grenade', 'mirv', 'impulse', 'sauce', 'barrel', 'storm', 'left', 'bleed'];
/**
 * What the drop key puts down: a slot's gun, melee weapon or one throwable, a consumable, a box of ammo or material, or
 * the scope in use.
 */
export type Drop = number | UseId | Ammo | Mat | 'scope';
/** How much of a material one drop puts down. */
export const MAT_DROP = 30;
/** What an egg can have in hand. */
export type Held = WeaponId | MeleeId | ThrowId;
export const HELD: readonly Held[] = [...WEAPON_IDS, ...MELEE_IDS, ...THROW_IDS];
export type Gun = { w: WeaponId; r: number; mag: number };

export type PieceKind = 'wall' | 'ramp' | 'floor' | 'roof';
export const PIECE_KINDS: readonly PieceKind[] = ['wall', 'ramp', 'floor', 'roof'];
/** What the build key makes: a piece, or a box of four walls. */
export type Plan = PieceKind | 'box';
export const PLANS: readonly Plan[] = ['wall', 'ramp', 'floor', 'roof', 'box'];

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
  /** Build the piece picked (twice quickly: box up). */
  build: boolean;
  /** Pick this and build it at once. */
  piece: Plan | null;
  /** 1 for the next material, or a material by number plus 10. */
  mat: number;
  /** Cut a doorway or a window into our wall in front, or put it back. */
  edit: boolean;
  /** A consumable to start on: one by name, or the right one for health or for shield. */
  use: UseId | 'bestHeal' | 'bestShield' | null;
  jump: boolean;
  /** How far ahead to throw, in meters (0 for the usual distance). */
  reach: number;
  /** Take out this kind of throwable. */
  pick: ThrowId | null;
  /** The interact key held down: reviving a knocked teammate. */
  hold: boolean;
  /** Mark this spot for the team. */
  ping: { x: number; z: number } | null;
  /** Put this down at our feet, for a teammate (see Drop). */
  drop: Drop | null;
  /** 1 for the next scope we carry, -1 for the one before, or a level plus 10 to look through that one. */
  scope: number;
  /** An emote or a call for the team, and (for an enemy) the spot it points at. */
  emote: { k: EmoteId; x: number; z: number } | null;
};
export const noInput = (): Input => ({ mx: 0, mz: 0, aim: 0, fire: false, reload: false, slot: -1, cycle: 0, interact: false, build: false, piece: null, mat: 0, edit: false, use: null, jump: false, reach: 0, pick: null, hold: false, ping: null, drop: null, scope: 0, emote: null });

/** One position report for an egg another client owns. `at` is our clock when it arrived. */
export type Snap = { at: number; x: number; z: number; y: number; aim: number; vx: number; vz: number };

export type Ai = {
  /**
   * Where we're off to: loot, a chest (or fridge, or locker) to open, a crate (or toilet, or hay bale) to smash, a
   * campfire to warm up at, a bank vault's door to open, a tree, rock or car to harvest, a stairway down to a basement
   * to loot (its index in `chest`); in teams, a knocked teammate to revive (its id in `item`) or the team to catch up
   * with.
   */
  goal: 'drop' | 'loot' | 'chest' | 'smash' | 'fire' | 'zone' | 'roam' | 'chase' | 'harvest' | 'vault' | 'revive' | 'mate' | 'stairs';
  gx: number;
  gz: number;
  item: number;
  /** The container (for chest and smash goals), the campfire (fire) or the vault door (vault) we're going to. */
  chest: number;
  /** A bounce pad on the way to somewhere far, or -1. */
  pad: number;
  /** The bridge we're crossing the river by, or -1. */
  bridge: number;
  /** When to give up on a crate, a campfire or something on the ground. */
  until: number;
  /** The last container we gave up smashing or opening. */
  tried: number;
  /** The last thing on the ground we gave up walking to (it lay somewhere we couldn't reach). */
  lost: number;
  target: number;
  react: number;
  strafe: number;
  strafeT: number;
  /** How long we've stood holding a line through a window (a while, then we move on). */
  sillT: number;
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
  /** What we've let fly lately: [clock, damage if it all lands] for each shot or swing (see LevelSpec `pour`). */
  poured: [number, number][];
  /** When the last of it went. */
  pouredAt: number;
  buildCool: number;
  swapCool: number;
  /** A throw in progress: what, how far, how long it may take, and how many there were before it. `tossA` is the way
   * to throw it, or NaN for at the target. */
  toss: ThrowId | null;
  tossD: number;
  tossA: number;
  tossT: number;
  tossHad: number;
  tossCool: number;
  /** Hiding in a bush we threw down at (hideX, hideZ), for this long. */
  hideT: number;
  hideX: number;
  hideZ: number;
  /** Boxed in on grid square (boxCx, boxCz) for this long, patching up (under a roof, once `roofed`); then out by side `outQ` for `outT`. */
  boxT: number;
  boxCx: number;
  boxCz: number;
  roofed: boolean;
  outT: number;
  outQ: number;
  /** Ramping up for the high ground: ramps still to build, the way they rise, how long we may take, how long to hold the top. */
  climb: number;
  climbQ: number;
  climbT: number;
  highT: number;
  rampCool: number;
  /** The last two eggs to hit us and when: both at once is a crossfire. */
  foe: number;
  foeAt: number;
  foe2: number;
  foe2At: number;
  /** A tree, rock, car or post to swing at for building material (`harvest` goal), and the wait before the next. */
  srcX: number;
  srcZ: number;
  srcR: number;
  harvestCool: number;
  /** An edit to make once we've stopped walking, aimed this way. */
  editA: number;
  /** In teams: the wait before we next ping a target for the team, and before we next put something down for one. */
  pingCool: number;
  shareCool: number;
  /**
   * In teams, what a teammate asked of us (see heard): to bring it what it called for (`askK`, `askA` the ammo, `askN`
   * how many to put down) until `askUntil`, to follow it until `followUntil` (both match time), and to look where it
   * saw an enemy until `lookUntil` (our clock).
   */
  askK: EmoteId | null;
  askA: Ammo | null;
  askN: number;
  askTo: number;
  askUntil: number;
  followTo: number;
  followUntil: number;
  lookX: number;
  lookZ: number;
  lookUntil: number;
  /** The knock we last called for help in (its downAt), and the kills we've had our say about. */
  cried: number;
  cheered: number;
  /** The basements we've been down to (or given up on), not to go back down. */
  below: number[];
  /** The stairway we're making for this step (see head), or -1: we keep off any other (see steer). */
  steps: number;
  /** When we last came through a stairway, and a few steps on from where it let us out (see decide). */
  stairAt: number;
  stairX: number;
  stairZ: number;
};

export type Fighter = {
  id: number;
  /** The room seat of a person, or -1 for a computer player. */
  seat: number;
  /** Its team (in solo, every egg's own). Teammates can't hurt each other. */
  team: number;
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
  /** The scope in use, level 0..4 (1x, 2x, 4x, 8x, 15x), and the ones it carries: a bit each from 2x up (see hasScope). */
  scope: number;
  scopes: number;
  /** Backpack level 0..3. */
  pack: number;
  /** Helmet and vest levels 0..3: each takes a cut of bullets, swings and blasts. */
  helmet: number;
  vest: number;
  /** Wearing a ghillie suit, and seconds stood still (see GHILLIE). */
  ghillie: boolean;
  stillT: number;
  /** Seconds left dazed by a stun grenade's flash. */
  stunT: number;
  /** Shield a smoothie still has to give, SIP a second. */
  sip: number;
  wood: number;
  stone: number;
  metal: number;
  /** The material to build with (an index into MATS), and the piece the build key makes. */
  mat: number;
  piece: Plan;
  /** Our clock when the build key was last pressed, for a double press. */
  buildAt: number;
  /** The piece we stand on, or -1 (the ground, or someone else's egg, whose owner knows). */
  on: number;
  /** How far a heavy SMG's spread has grown with the shots just fired, and how far a minigun has spun up (0..1). */
  heat: number;
  spin: number;
  /** A shove from an impulse egg, meters a second, wearing off. */
  kx: number;
  kz: number;
  fireT: number;
  /** Shots left in the burst being fired, and the wait before the next. */
  burst: number;
  burstT: number;
  reloadT: number;
  reloadSlot: number;
  using: UseId | null;
  useT: number;
  buildT: number;
  editT: number;
  /** A build key pressed during the wait between pieces, and when: it builds once the wait is over. */
  queued: Plan | null;
  queuedAt: number;
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
  /** The loot id last asked for with the key: only that puts on a worse helmet or vest. */
  keyAsk: number;
  wallSeq: number;
  dropSeq: number;
  /** Remote eggs whose owner says they are out, though the news of how hasn't arrived yet. */
  outSeen: number;
  /** What computer eggs have let fly at it lately, as in Ai `poured` (see FOCUS). */
  incoming: [number, number][];
  /** Knocked down (see DOWN_HP), by whom and with what, and the match time it went down. */
  down: boolean;
  knockBy: number;
  knockCause: Cause | null;
  downAt: number;
  /** Someone else's: our clock when the news came that it went down or stood up (a report from before may follow). */
  flipAt: number;
  /** The knocked teammate it's reviving (-1 for none), and our clock when it started. */
  reviving: number;
  reviveAt: number;
  /** Its last ping for the team, and when (match time). */
  pingX: number;
  pingZ: number;
  pingAt: number;
  /** Its emote showing (see EMOTE_T), the ammo it asks for, our clock when it went up, and when its last few did. */
  emote: EmoteId | null;
  emoteA: Ammo | null;
  emoteAt: number;
  emotes: number[];
};

/**
 * A bullet flies at level `lv` (see aimLevel), fired from level `from` at (ox, oz); `chip` is the last piece it chipped on
 * its way up.
 */
export type Bullet = { f: number; w: WeaponId; r: number; x: number; z: number; dx: number; dz: number; speed: number; left: number; traveled: number; dmg: number; local: boolean; lv: number; from: number; ox: number; oz: number; chip: number };
export type LootItem = { id: number; def: LootDef; x: number; z: number; by: number; at: number };
/**
 * A built piece: a wall, a ramp, a floor or a roof, of wood, stone or metal. `cx`, `cz` is its grid square (a wall
 * stands on its south side when `dir` is 2, its west side when 3), `lv` the level it stands on (a floor or a roof: the
 * level it lies at), and `dir` the way a ramp rises (0 north, 1 east, 2 south, 3 west). It builds up to `max` health
 * over the `left` seconds it has still to go. A wall's edit `e` is 0 for solid, 1 for a doorway, 2 for a window.
 * `parts` are the two sides left standing either side of the gap an edit cuts.
 */
export type Wall = Obb & { id: number; f: number; a: number; hp: number; k: PieceKind; mat: Mat; max: number; left: number; cx: number; cz: number; lv: number; dir: number; e: number; parts: Obb[] | null; mark: number };
/**
 * Something thrown, flying from (x, z) to (lx, lz) over `ft` seconds from match time `t0`. A grenade goes off at `fuse`.
 * `small` marks one of the bomblets a MIRV grenade splits into.
 */
export type Toss = { f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; t0: number; ft: number; fuse: number; local: boolean; landed: boolean; y0: number; ly: number; small?: boolean };
/**
 * Something a throw leaves until `until`: a flour cloud (hides whoever is in it), a puddle of hot sauce (burns
 * whoever stands in it) or jam (slows them), or a bush grown from a can (hides whoever stands in it, like any bush).
 */
export type Zone = { k: 'flour' | 'sauce' | 'jam' | 'bush'; x: number; z: number; y: number; r: number; from: number; until: number; by: number };

export type Thud = 'tree' | 'rock' | 'wall' | 'window' | 'door' | 'bars' | 'crate' | 'chest' | 'barrel' | 'car' | 'fence' | 'table' | 'post' | 'fire' | 'log' | 'shelf' | 'seat' | 'built' | 'egg' | 'pan' | 'ground';

/**
 * Things that happened this frame, for sounds, effects and the network. `net` marks news that came from it. `stairs` is
 * an egg going down a stairway (or up one), which nobody needs to hear of: its position says so. In teams:
 * `knock` an egg knocked down, `revive` one starting to revive a knocked teammate (`to` -1: it stopped), `ask` a guest
 * done reviving asking the host to stand the teammate up, `revived` the host's word that it stands, `ping` a spot marked
 * for the team, `emote` an emote or a call for the team (see EMOTE_IDS). An `out` that was `down` finished off a
 * knocked egg.
 */
export type Ev = (
  | { t: 'beep' }
  | { t: 'go' }
  | { t: 'storm'; phase: number; shrinking: boolean }
  | { t: 'supply'; c: number }
  | { t: 'jump'; f: number }
  | { t: 'bounce'; f: number }
  | { t: 'land'; f: number }
  | { t: 'stairs'; f: number; down: boolean }
  | { t: 'shot'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number; h: number }
  | { t: 'swing'; f: number }
  | { t: 'throw'; f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; ft: number; y0: number; ly: number }
  | { t: 'zone'; k: Zone['k']; x: number; z: number; y: number }
  | { t: 'hit'; f: number; to: number; d: number; took: number; w: Cause; x: number; z: number; shield: boolean; local: boolean }
  | { t: 'hurt'; f: number; d: number; by: number; storm: boolean; shield: boolean }
  | { t: 'thud'; x: number; z: number; what: Thud }
  | { t: 'smash'; f: number; kind: 'wall' | 'crate' | 'door'; id: number; d: number; x: number; z: number }
  | { t: 'glass'; f: number; i: number }
  | { t: 'latch'; f: number; i: number }
  | { t: 'door'; f: number; i: number; s: number }
  | { t: 'stun'; f: number; x: number; z: number }
  | { t: 'leader'; f: number; kills: number }
  | { t: 'boom'; f: number; x: number; z: number; y?: number; r?: number }
  | { t: 'pulse'; f: number; x: number; z: number }
  | { t: 'moved'; id: number; x: number; z: number }
  | { t: 'called'; f: number; c: number; x: number; z: number; at: number }
  | { t: 'harvest'; f: number; x: number; z: number; n: number; mat: Mat }
  | { t: 'reload'; f: number }
  | { t: 'reloaded'; f: number }
  | { t: 'empty'; f: number }
  | { t: 'use'; f: number; what: UseId }
  | { t: 'used'; f: number; what: UseId }
  | { t: 'out'; f: number; by: number; w: Cause; place: number; down?: boolean }
  | { t: 'knock'; f: number; by: number; w: Cause }
  | { t: 'revive'; f: number; to: number }
  | { t: 'ask'; f: number; to: number }
  | { t: 'revived'; f: number; by: number }
  | { t: 'ping'; f: number; x: number; z: number }
  | { t: 'emote'; f: number; k: EmoteId; a: Ammo | null; x: number; z: number }
  | { t: 'drop'; item: LootItem }
  | { t: 'take'; f: number; id: number }
  | { t: 'took'; f: number; id: number; def: LootDef }
  | { t: 'open'; f: number; c: number }
  | { t: 'opened'; c: number; f: number }
  | { t: 'wall'; wall: Wall }
  | { t: 'wallgone'; id: number }
  | { t: 'edit'; f: number; id: number; e: number }
  | { t: 'end'; winner: number }
) & { net?: boolean };

export type Match = {
  map: GameMap;
  seed: number;
  role: Role;
  /** Settles pickups, chests, crates, barrels, walls and the result (solo and the host). */
  world: boolean;
  level: Level;
  mode: Mode;
  /** Fighter ids by team. */
  teams: number[][];
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
  /** Everything built (walls, ramps, floors and roofs) by id, found by grid square too. */
  walls: PieceMap;
  /** Loot and walls already gone, so news that arrives late can't bring them back. */
  gone: Set<number>;
  goneWalls: Set<number>;
  opened: boolean[];
  /** What crates and barrels have left before they break. */
  crateHp: number[];
  /** Which windows have had their glass broken, by window. */
  broken: boolean[];
  /**
   * Each door's state (DOOR_SHUT and the rest), what it has left before it comes off its hinges, our clock when it last
   * changed, and (the host's) when a vault door that's opening is open. `vaults` lists the vault doors, and `locked`
   * the vault door each container is shut behind (-1 for none).
   */
  doors: number[];
  doorHp: number[];
  doorAt: number[];
  doorT: number[];
  vaults: number[];
  locked: number[];
  /** The kill leader (the most kills, LEADER_MIN at least, and still in), or -1. */
  leader: number;
  /** When each egg last called a supply drop with a flare (the host's record). */
  calls: Map<number, number>;
  storm: StormNow;
  events: Ev[];
  rng: Rng;
  ended: boolean;
  winner: number;
  /** Frames stepped, for what is worked out once a frame. */
  frame: number;
};

export type Entrant = { name: string; color: string; kind: Kind; seat: number; team?: number };

/** The loot on the ground by id, counting every change to it (so what is worked out from it knows to look again). */
export class LootMap extends Map<number, LootItem> {
  changes = 0;
  set(id: number, l: LootItem) {
    this.changes++;
    return super.set(id, l);
  }
  delete(id: number) {
    this.changes++;
    return super.delete(id);
  }
  clear() {
    this.changes++;
    super.clear();
  }
}

/** The grid square a coordinate lies in, and the key a square goes by. */
export const gridOf = (v: number) => Math.floor(v / CELL_B);
const cellKey = (cx: number, cz: number) => (cx + 512) * 1024 + cz + 512;

/**
 * Pieces by id, each also listed under every grid square it covers (a wall under both squares either side of it), so
 * a ray or an egg only looks at the pieces near it.
 */
export class PieceMap extends Map<number, Wall> {
  cells = new Map<number, Wall[]>();
  /** For visiting each piece once. */
  mark = 0;
  private each(w: Wall, visit: (key: number) => void) {
    const ext = obbExtent(w);
    for (let cz = gridOf(w.z - ext.z + 0.01); cz <= gridOf(w.z + ext.z - 0.01); cz++) for (let cx = gridOf(w.x - ext.x + 0.01); cx <= gridOf(w.x + ext.x - 0.01); cx++) visit(cellKey(cx, cz));
  }
  set(id: number, w: Wall) {
    if (this.has(id)) this.delete(id);
    super.set(id, w);
    this.each(w, (k) => {
      const list = this.cells.get(k);
      if (list) list.push(w);
      else this.cells.set(k, [w]);
    });
    return this;
  }
  delete(id: number) {
    const w = this.get(id);
    if (!w) return false;
    this.each(w, (k) => {
      const list = this.cells.get(k);
      const at = list ? list.indexOf(w) : -1;
      if (at >= 0) list!.splice(at, 1);
      if (list && !list.length) this.cells.delete(k);
    });
    return super.delete(id);
  }
  clear() {
    this.cells.clear();
    super.clear();
  }
  /** The pieces listed under one grid square. */
  at(cx: number, cz: number): readonly Wall[] {
    return this.cells.get(cellKey(cx, cz)) ?? NO_PIECES;
  }
  /** Each piece in the grid squares a box covers, once. */
  near(x0: number, z0: number, x1: number, z1: number, visit: (w: Wall) => void) {
    if (!this.size) return;
    const mark = ++this.mark;
    for (let cz = gridOf(z0); cz <= gridOf(z1); cz++)
      for (let cx = gridOf(x0); cx <= gridOf(x1); cx++)
        for (const w of this.at(cx, cz)) {
          if (w.mark === mark) continue;
          w.mark = mark;
          visit(w);
        }
  }
  /** Each piece in the grid squares a segment crosses, once, from its start on. */
  along(x0: number, z0: number, x1: number, z1: number, visit: (w: Wall) => void) {
    if (!this.size) return;
    const mark = ++this.mark;
    gridWalk(x0, z0, x1, z1, (cx, cz) => {
      for (const w of this.at(cx, cz)) {
        if (w.mark === mark) continue;
        w.mark = mark;
        visit(w);
      }
    });
  }
}
const NO_PIECES: readonly Wall[] = [];

/** How far a turned box reaches along x and along z from its middle. */
function obbExtent(o: Obb) {
  const ca = Math.abs(o.ca);
  const sa = Math.abs(o.sa);
  return { x: o.hw * ca + o.hd * sa, z: o.hw * sa + o.hd * ca };
}

/** Visits the build grid squares a segment crosses, in order. */
function gridWalk(x0: number, z0: number, x1: number, z1: number, visit: (cx: number, cz: number) => void) {
  const fx0 = x0 / CELL_B;
  const fz0 = z0 / CELL_B;
  let ix = Math.floor(fx0);
  let iz = Math.floor(fz0);
  const ex = Math.floor(x1 / CELL_B);
  const ez = Math.floor(z1 / CELL_B);
  const dx = x1 / CELL_B - fx0;
  const dz = z1 / CELL_B - fz0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx ? Math.abs(1 / dx) : Infinity;
  const tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (ix + 1 - fx0) * tdx : sx < 0 ? (fx0 - ix) * tdx : Infinity;
  let tmz = sz > 0 ? (iz + 1 - fz0) * tdz : sz < 0 ? (fz0 - iz) * tdz : Infinity;
  const steps = Math.abs(ex - ix) + Math.abs(ez - iz);
  for (let i = 0; i <= steps; i++) {
    visit(ix, iz);
    if (tmx < tmz) {
      tmx += tdx;
      ix += sx;
    } else {
      tmz += tdz;
      iz += sz;
    }
  }
}

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
  '#b71c1c',
  '#0d47a1',
  '#1b5e20',
  '#4fc3f7',
  '#81c784',
  '#ba68c8',
  '#ffd54f',
  '#4db6ac',
  '#e57373',
  '#9575cd',
  '#a1887f',
  '#90a4ae',
  '#f06292',
  '#7986cb',
  '#aed581',
  '#ff7043',
  '#26a69a',
  '#d4e157',
  '#880e4f',
  '#004d40',
  '#3e2723',
  '#bf360c',
  '#283593',
  '#827717',
  '#00695c',
  '#6a1b9a',
  '#ff4081',
  '#40c4ff',
  '#69f0ae',
  '#ffab40',
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
  'Brioche',
  'Waffles',
  'Pancake',
  'Hashbrown',
  'Toastie',
  'Muffin',
  'Croissant',
  'Biscuit',
  'Sriracha',
  'Paprika',
  'Chive',
  'Gruyere',
  'Cheddar',
  'Feta',
  'Dumpling',
  'Tortilla',
  'Kedgeree',
  'Carbonara',
  'Scotch',
  'Pickles',
  'Clucky',
  'Henrietta',
  'Rooster',
  'Nugget',
  'Pullet',
  'Bantam',
  'Speckles',
  'Tempura',
  'Mayo',
  'Aioli',
  'Flan',
  'Pavlova',
  'Brulee',
  'Eggroll',
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
 * How sharp the computer players are. `toss` is the seconds between throws (0: never); `build` between walls and boxes,
 * `ramp` between ramping up for the high ground (0: never). `far` is how much wider the aim gets for every 10 meters
 * past 20, and `settle` the seconds a scoped shot waits for a steady aim. `pour` is the most damage it lets fly in any
 * POUR_T seconds (every shot landing, and one shot bigger than that waits as much longer), under a full egg's health,
 * so none cracks an egg from full in about a second.
 */
type LevelSpec = { err: number; react: number; turn: number; sight: number; lead: number; burst: number; rest: number; build: number; ramp: number; heal: number; toss: number; far: number; settle: number; pour: number };
export const LEVEL_SPECS: Record<Level, LevelSpec> = {
  easy: { err: 0.2, react: 0.85, turn: 3.2, sight: 32, lead: 0, burst: 0.45, rest: 0.6, build: 24, ramp: 0, heal: 45, toss: 22, far: 0.9, settle: 1.1, pour: 60 },
  normal: { err: 0.11, react: 0.5, turn: 6, sight: 42, lead: 0.5, burst: 0.8, rest: 0.35, build: 12, ramp: 18, heal: 60, toss: 11, far: 0.9, settle: 0.7, pour: 75 },
  hard: { err: 0.055, react: 0.28, turn: 9, sight: 52, lead: 1, burst: 1.4, rest: 0.2, build: 5, ramp: 9, heal: 70, toss: 6, far: 0.25, settle: 0.4, pour: 90 },
};

/** The seconds a computer egg's `pour`, and a pack's FOCUS, are counted over. */
export const POUR_T = 1.2;
/**
 * The most every computer egg together lets fly at one egg in POUR_T seconds: a pack takes turns, and doesn't crack
 * it from full in about a second either.
 */
export const FOCUS = 95;

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
/** In and on its feet: not out, nor knocked down. */
export const upright = (f: Fighter) => f.phase !== 'out' && !f.down;
/** On the same team (in solo, an egg is on its own). */
export const mates = (a: Fighter, b: Fighter) => a.team === b.team;
/** The eggs on a team. */
export const teamOf = (m: Match, team: number): Fighter[] => (m.teams[team] ?? []).map((id) => m.fighters[id]);
/** Whether a team has anyone still on their feet, but `skip`. */
export const teamUp = (m: Match, team: number, skip?: Fighter) => (m.teams[team] ?? []).some((id) => m.fighters[id] !== skip && upright(m.fighters[id]));
/** Teams with anyone still in (knocked counts). */
export function teamsLeft(m: Match) {
  let n = 0;
  for (const ids of m.teams) if (ids.some((id) => alive(m.fighters[id]))) n++;
  return n;
}
/** How many teams there are. */
export const teamCount = (m: Match) => m.teams.reduce((n, ids) => n + (ids.length ? 1 : 0), 0);
/** An egg's place on its team (0 for the first), for its color there. */
export const mateIndex = (m: Match, f: Fighter) => Math.max(0, (m.teams[f.team] ?? []).indexOf(f.id));
export const mateColor = (m: Match, f: Fighter) => MATE_COLORS[mateIndex(m, f) % MATE_COLORS.length];
/** An egg's number on its team, from 1: on its marker, its name tag, the team panel and the big map. */
export const mateNumber = (m: Match, f: Fighter) => mateIndex(m, f) + 1;
const none = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

function newFighter(id: number, e: Entrant, x: number, z: number, team: number): Fighter {
  return {
    id,
    seat: e.seat,
    team,
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
    items: none(USE_IDS),
    boost: 0,
    scope: 0,
    scopes: 0,
    pack: 0,
    helmet: 0,
    vest: 0,
    ghillie: false,
    stillT: 0,
    stunT: 0,
    sip: 0,
    wood: 30,
    stone: 0,
    metal: 0,
    mat: 0,
    piece: 'wall',
    buildAt: -99,
    on: -1,
    heat: 0,
    spin: 0,
    kx: 0,
    kz: 0,
    fireT: 0,
    burst: 0,
    burstT: 0,
    reloadT: 0,
    reloadSlot: -1,
    using: null,
    useT: 0,
    buildT: 0,
    editT: 0,
    queued: null,
    queuedAt: 0,
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
    keyAsk: -1,
    wallSeq: 0,
    dropSeq: 0,
    outSeen: -1,
    incoming: [],
    down: false,
    knockBy: -1,
    knockCause: null,
    downAt: 0,
    flipAt: -99,
    reviving: -1,
    reviveAt: 0,
    pingX: 0,
    pingZ: 0,
    pingAt: -99,
    emote: null,
    emoteA: null,
    emoteAt: -99,
    emotes: [],
  };
}

function newAi(m: Match, f: Fighter): Ai {
  const rng = m.rng;
  const bus = m.map.bus;
  // aim for a building or loot spot near the bus route and jump about when the bus passes it
  const spots = [...m.map.buildings, ...m.map.floor].filter((p) => !isDeep(p.x)).map((p) => ({ x: p.x, z: p.z }));
  const dx = bus.x1 - bus.x0;
  const dz = bus.z1 - bus.z0;
  const along = (p: { x: number; z: number }) => clamp(((p.x - bus.x0) * dx + (p.z - bus.z0) * dz) / (bus.len * bus.len), 0.08, 0.92);
  const off = (p: { x: number; z: number }) => {
    const u = along(p);
    return Math.hypot(bus.x0 + dx * u - p.x, bus.z0 + dz * u - p.z);
  };
  const near = spots.filter((p) => off(p) < 110);
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
    lost: -1,
    target: -1,
    react: 0,
    strafe: rng() < 0.5 ? 1 : -1,
    strafeT: 0,
    sillT: 0,
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
    poured: [],
    pouredAt: -99,
    buildCool: 0,
    swapCool: 0,
    toss: null,
    tossD: 0,
    tossA: NaN,
    tossT: 0,
    tossHad: 0,
    tossCool: 4 + rng() * 6,
    hideT: 0,
    hideX: 0,
    hideZ: 0,
    boxT: 0,
    boxCx: 0,
    boxCz: 0,
    roofed: false,
    outT: 0,
    outQ: 0,
    climb: 0,
    climbQ: 0,
    climbT: 0,
    highT: 0,
    rampCool: 6 + (f.id % 7) * 1.5,
    foe: -1,
    foeAt: -99,
    foe2: -1,
    foe2At: -99,
    srcX: 0,
    srcZ: 0,
    srcR: 0,
    harvestCool: 10 + (f.id % 11) * 2,
    editA: NaN,
    pingCool: 0,
    shareCool: 8 + (f.id % 5) * 2,
    askK: null,
    askA: null,
    askN: 0,
    askTo: -1,
    askUntil: 0,
    followTo: -1,
    followUntil: 0,
    lookX: 0,
    lookZ: 0,
    lookUntil: -99,
    cried: -99,
    cheered: 0,
    below: [],
    steps: -1,
    stairAt: -99,
    stairX: 0,
    stairZ: 0,
  };
}

/**
 * A new match. Fighter ids are entrant indices. `me` is the egg this client plays (-1 to only watch). Remote eggs
 * are moved by the network; computer players by this client.
 */
export function createMatch(opts: { seed: number; role: Role; level: Level; entrants: Entrant[]; me: number; countdown?: number; map?: GameMap; mode?: Mode }): Match {
  const map = opts.map ?? generateMap(opts.seed);
  const start = busAt(map.bus, 0);
  const m: Match = {
    map,
    seed: opts.seed,
    role: opts.role,
    world: opts.role !== 'guest',
    level: opts.level,
    mode: opts.mode ?? 'solo',
    teams: [],
    time: -(opts.countdown ?? COUNTDOWN),
    clock: 0,
    fighters: [],
    me: opts.me,
    bullets: [],
    tosses: [],
    zones: [],
    loot: new LootMap(),
    walls: new PieceMap(),
    gone: new Set(),
    goneWalls: new Set(),
    opened: map.containers.map(() => false),
    crateHp: map.containers.map((c) => (c.kind === 'barrel' ? BARREL.hp : c.kind === 'toilet' ? TOILET_HP : c.kind === 'hay' ? HAY_HP : CRATE_HP)),
    broken: map.windows.map(() => false),
    doors: map.slabs.map(() => DOOR_SHUT),
    doorHp: map.slabs.map(() => DOOR_HP),
    doorAt: map.slabs.map(() => -99),
    doorT: map.slabs.map(() => Infinity),
    vaults: map.slabs.filter((s) => s.vault).map((s) => s.i),
    locked: lockedBy(map),
    leader: -1,
    calls: new Map(),
    storm: stormAt(map.storm, 0),
    events: [],
    rng: rng32((opts.seed * 31 + 7 + Math.max(0, opts.me)) >>> 0),
    ended: false,
    winner: -1,
    frame: 0,
  };
  for (const s of map.floor) m.loot.set(s.id, { id: s.id, def: s.def, x: s.x, z: s.z, by: -1, at: 0 });
  // in solo every egg is a team of its own; in teams, as the entrants say (else in fighter order)
  const size = TEAM_SIZE[m.mode];
  opts.entrants.slice(0, MAX_FIGHTERS).forEach((e, i) => {
    const team = size === 1 ? i : clamp(Math.floor(e.team ?? i / size), 0, MAX_TEAMS - 1);
    const f = newFighter(i, e, start.x, start.z, team);
    m.fighters.push(f);
    (m.teams[team] ??= []).push(i);
  });
  for (let t = 0; t < m.teams.length; t++) m.teams[t] ??= [];
  for (const f of m.fighters) if (f.kind === 'bot') f.ai = newAi(m, f);
  // computer eggs on a team drop together, where the first of them meant to, one after another
  if (size > 1)
    for (const ids of m.teams) {
      const lead = ids.map((id) => m.fighters[id].ai).find((ai) => !!ai);
      let k = 0;
      for (const id of ids) {
        const ai = m.fighters[id].ai;
        if (!ai || !lead || ai === lead) continue;
        k++;
        ai.gx = lead.gx + DIR_X[k % 4] * 2.5;
        ai.gz = lead.gz + DIR_Z[k % 4] * 2.5;
        ai.jumpAt = Math.min(m.map.bus.off - 0.05, lead.jumpAt + k * 0.15);
      }
    }
  return m;
}

/** The vault door each container is shut behind (one in a bank's vault), or -1. */
function lockedBy(map: GameMap) {
  const out = map.containers.map(() => -1);
  for (const s of map.slabs) {
    if (!s.vault) continue;
    const b = map.buildings[s.b];
    // the vault is the room on the inside of its door
    const vault = b.rooms.find((r) => Math.abs(s.x - s.ox * 1.2 - r.x) < r.hw && Math.abs(s.z - s.oz * 1.2 - r.z) < r.hd);
    if (!vault) continue;
    for (const c of map.containers) if (Math.abs(c.x - vault.x) < vault.hw && Math.abs(c.z - vault.z) < vault.hd) out[c.id] = s.i;
  }
  return out;
}

/** Lets the computer play an egg this client owns (tests use it to stand in for people). */
export function autopilot(m: Match, f: Fighter) {
  f.ai = newAi(m, f);
}

/** A match on this device: you and forty-nine computer players (in duos and squads, your teammates among them). */
export function soloMatch(seed: number, level: Level, name = 'you', color = FIGHTER_COLORS[0], mode: Mode = 'solo'): Match {
  const bots = botNames(seed);
  const entrants: Entrant[] = [{ name, color, kind: 'player', seat: -1 }];
  for (let i = 1; i < MAX_FIGHTERS; i++) entrants.push({ name: bots[i - 1], color: FIGHTER_COLORS[i], kind: 'bot', seat: -1 });
  return createMatch({ seed, role: 'solo', level, entrants, me: 0, mode });
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

/** Underground, a scope sees no farther than this (the lamps only light so far). */
export const DEEP_VIEW = SCOPE_VIEW[1];

/**
 * Meters of view past the usual: the scope in use and nothing else (no gun, melee weapon or throwable in hand changes
 * it), less underground, and more up high.
 */
export function viewOf(f: Fighter) {
  const far = SCOPE_VIEW[clamp(f.scope, 0, MAX_SCOPE)] ?? 0;
  return (isDeep(f.x) ? Math.min(DEEP_VIEW, far) : far) + (f.phase === 'ground' ? levelOf(f.y) * HIGH_VIEW : 0);
}

/** How much of the island a screen shows round the egg it follows (half the screen's height, in meters): on foot, and gliding down. */
export const GROUND_VIEW = 14;
export const DROP_VIEW = 34;
/** What a screen following egg `f` shows of the island (half its height, in meters): more through a scope, up high, and from up in the air. */
export const viewAt = (f: Fighter) => (f.phase === 'drop' ? DROP_VIEW + (f.y / BUS_Y) * 20 : GROUND_VIEW + viewOf(f));

/** Does an egg carry the scope of this level? 1x (level 0) it always has. */
export const hasScope = (f: { scopes: number }, lv: number) => lv === 0 || (lv > 0 && lv <= MAX_SCOPE && (f.scopes & (1 << (lv - 1))) !== 0);

/** Every scope level, from 1x up. */
const SCOPE_LEVELS = SCOPE_VIEW.map((_, lv) => lv);

/** The scopes an egg carries, from 1x up. */
export const scopesOf = (f: { scopes: number }) => SCOPE_LEVELS.filter((lv) => hasScope(f, lv));

/** The best scope an egg carries (0 for none). */
export const bestScope = (f: { scopes: number }) => {
  const have = scopesOf(f);
  return have[have.length - 1];
};

/** Looks through another scope we carry: the next (1) or the one before (-1) round and round, or a level plus 10. */
function switchScope(f: Fighter, want: number) {
  const have = scopesOf(f);
  const at = Math.max(0, have.indexOf(f.scope));
  const lv = want >= 10 ? want - 10 : have[(at + (want > 0 ? 1 : -1) + have.length) % have.length];
  if (hasScope(f, lv)) f.scope = lv;
}

/** Is a crate, barrel, chest, supply drop or shut door there to bump into right now? */
export function standing(m: Match, s: Solid) {
  if (s.what === 'crate' || s.what === 'barrel') return !m.opened[s.ref];
  if (s.what === 'chest') return landed(m, m.map.containers[s.ref]);
  if (s.what === 'door') return shut(m, s.ref);
  return true;
}

/** A door that's in the way: shut, or a vault door still opening. */
export const shut = (m: Match, i: number) => m.doors[i] === DOOR_SHUT || m.doors[i] === DOOR_OPENING;
/** A supply drop is down once its time comes; everything else always is. */
export const landed = (m: Match, c: Container | undefined) => !!c && (c.kind !== 'supply' || m.time >= c.at);
/** Chests, fridges, landed supply drops and the furniture that holds things open with the interact key. */
export const openable = (m: Match, c: Container | undefined) => !!c && opens(c.kind) && landed(m, c) && !m.opened[c.id];
/** Shut in a bank vault whose door isn't open yet. */
export const lockedIn = (m: Match, c: Container) => (m.locked[c.id] ?? -1) >= 0 && shut(m, m.locked[c.id]);
/** Crates, toilets, hay bales and barrels break when hit. */
export const breakable = (c: Container | undefined) => !!c && (c.kind === 'crate' || c.kind === 'barrel' || c.kind === 'toilet' || c.kind === 'hay');

// -------------------------------------------------------------------------------------------------------------------
// The frame.

export function step(m: Match, dt: number) {
  const before = m.time;
  m.time += dt;
  m.clock += dt;
  m.frame++;
  if (before < 0) {
    // a beep as each number comes up, the first one too when the countdown starts right on it
    for (let k = COUNTDOWN; k >= 1; k--) if (before <= -k && m.time > -k) emit(m, { t: 'beep' });
    if (m.time >= 0) emit(m, { t: 'go' });
  }
  const prev = m.storm;
  m.storm = stormAt(m.map.storm, Math.max(0, m.time));
  if (m.storm.phase !== prev.phase || m.storm.shrinking !== prev.shrinking) emit(m, { t: 'storm', phase: m.storm.phase, shrinking: m.storm.shrinking });
  for (const c of m.map.drops) supplyDue(m, c, before);
  for (const c of m.map.flares) supplyDue(m, c, before);
  // a vault door that has ground open stays open (the host's call)
  if (m.world) for (const i of m.vaults) if (m.doors[i] === DOOR_OPENING && m.time >= m.doorT[i]) setDoor(m, i, DOOR_OUT, -1, true);

  for (const f of m.fighters) {
    if (f.kind === 'remote') {
      follow(m, f, dt);
      continue;
    }
    if (f.phase === 'out') {
      clearOneShots(f.input);
      continue;
    }
    if (f.ai) think(m, f, dt);
    act(m, f, dt);
  }
  if (m.walls.size) growPieces(m, dt);
  moveBullets(m, dt);
  moveTosses(m);
  if (m.zones.length && m.zones.some((z) => z.until <= m.time)) m.zones = m.zones.filter((z) => z.until > m.time);
  crown(m);
  if (m.world) settle(m);
}

/**
 * Who wears the kill leader's crown: the egg still in with the most kills, LEADER_MIN at least, keeping it until
 * someone has more. Every client works it out from the kills it has heard of, and says so when it changes.
 */
function crown(m: Match) {
  const was = m.fighters[m.leader];
  let best = was && alive(was) && was.kills >= LEADER_MIN ? was : null;
  for (const f of m.fighters) if (alive(f) && f.kills >= LEADER_MIN && f.kills > (best?.kills ?? 0)) best = f;
  const id = best?.id ?? -1;
  if (id === m.leader) return;
  m.leader = id;
  if (best) emit(m, { t: 'leader', f: id, kills: best.kills, net: true });
}

/** Everyone hears a supply drop coming as it starts down. */
function supplyDue(m: Match, c: number, before: number) {
  const at = (m.map.containers[c]?.at ?? Infinity) - SUPPLY_FALL;
  if (before < at && m.time >= at) emit(m, { t: 'supply', c });
}

function clearOneShots(inp: Input) {
  inp.reload = false;
  inp.slot = -1;
  inp.cycle = 0;
  inp.interact = false;
  inp.build = false;
  inp.piece = null;
  inp.mat = 0;
  inp.edit = false;
  inp.use = null;
  inp.jump = false;
  inp.pick = null;
  inp.ping = null;
  inp.drop = null;
  inp.scope = 0;
  inp.emote = null;
}

/**
 * Ends the match once one team (or none) is left with anyone on their feet (in solo, one egg): the whole team wins, and
 * a knocked egg of any other team still bleeding out is second (and out, the match being over).
 */
function settle(m: Match) {
  if (m.ended || m.time <= 0 || m.fighters.length < 2) return;
  let team = -1;
  let teams = 0;
  for (let t = 0; t < m.teams.length; t++)
    if (teamUp(m, t)) {
      team = t;
      if (++teams > 1) return;
    }
  m.ended = true;
  const won = team >= 0 ? teamOf(m, team) : [];
  m.winner = won.find(upright)?.id ?? -1;
  for (const f of won) f.place = 1;
  // and a computer egg that won says so
  for (const f of won) if (f.ai && upright(f)) emote(m, f, 'gg', f.x, f.z);
  for (let t = 0; t < m.teams.length; t++)
    if (t !== team && teamOf(m, t).some(alive))
      for (const f of teamOf(m, t)) {
        f.place = 2;
        // and it's over for those still bleeding, as it is in every guest's match on the host's word (see endMatch)
        if (f.phase !== 'out') {
          f.phase = 'out';
          f.outAt = m.time;
        }
      }
  emit(m, { t: 'end', winner: m.winner });
}

/** Ends an online match on the host's word. */
export function endMatch(m: Match, winner: number, places: [number, number, number][] = []) {
  for (const [fid, place, kills] of places) {
    const f = m.fighters[fid];
    if (!f) continue;
    f.place = place;
    f.kills = kills;
    // the host's word is final, even if the news of how an egg went out is still on its way (the winners stand)
    if (place !== 1 && f.phase !== 'out') {
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
    if (inp.ping) ping(m, f, inp.ping.x, inp.ping.z);
    if (inp.emote) emote(m, f, inp.emote.k, inp.emote.x, inp.emote.z);
    // down on the ground, or on a floor or a ramp someone built
    const under = m.walls.size ? surfaceAt(m, f.x, f.z, f.y + 0.2) : null;
    if (f.y <= (under?.y ?? 0)) {
      f.y = under?.y ?? 0;
      f.on = under?.id ?? -1;
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
  f.editT = Math.max(0, f.editT - dt);
  f.hitT = Math.max(0, f.hitT - dt);
  f.stunT = Math.max(0, f.stunT - dt);
  f.aim = inp.aim;
  if (!usable(f, f.slot)) f.slot = SLOT_MELEE;
  if (inp.ping) ping(m, f, inp.ping.x, inp.ping.z);
  if (inp.emote) emote(m, f, inp.emote.k, inp.emote.x, inp.emote.z);
  if (inp.scope) switchScope(f, inp.scope);
  if (m.mode !== 'solo') reviveStep(m, f);
  // knocked down (it crawls) or reviving a teammate (it stands still), it does nothing else
  if (f.down || f.reviving >= 0) {
    f.heat = Math.max(0, f.heat - 3 * dt);
    f.spin = Math.max(0, f.spin - dt / 1.2);
    f.burst = 0;
  } else handle(m, f, dt);
  const hg = f.slot < 2 ? f.guns[f.slot] : null;
  const hs = hg ? WEAPONS[hg.w] : null;

  // walking: slow through a pond or the river and much slower through jam, a little quicker on a road, slower
  // spinning a minigun or dazed by a stun grenade, a crawl knocked down. Up on something built, none of the ground's
  // matters.
  const afoot = f.y < 0.5;
  f.wet = afoot && waterAt(m.map, f.x, f.z);
  const jam = m.zones.length > 0 && zoneAt(m, 'jam', f.x, f.z, f.y) !== null;
  const spun = f.spin > 0 && hs?.spin ? hs.spin.slow : 1;
  const dazed = f.stunT > 0 ? (THROWS.stun.slow ?? 1) : 1;
  const crawl = f.reviving >= 0 ? 0 : f.down ? CRAWL : 1;
  const speed = SPEED * paceOf(f) * (f.using ? 0.5 : 1) * (f.boost > 0 ? BOOST.speed : 1) * (f.wet ? POND_SLOW : afoot && roadAt(m.map, f.x, f.z) ? ROAD_SPEED : 1) * (jam ? (THROWS.jam.slow ?? 1) : 1) * spun * dazed * crawl;
  const len = Math.hypot(inp.mx, inp.mz);
  const tx = len > 0 ? (inp.mx / Math.max(1, len)) * speed : 0;
  const tz = len > 0 ? (inp.mz / Math.max(1, len)) * speed : 0;
  const k = 1 - Math.exp(-14 * dt);
  f.vx += (tx - f.vx) * k;
  f.vz += (tz - f.vz) * k;
  const ox = f.x;
  const oz = f.z;
  const shoved = f.kx !== 0 || f.kz !== 0;
  f.x += (f.vx + f.kx) * dt;
  f.z += (f.vz + f.kz) * dt;
  resolve(m, f);
  climb(m, f, dt);
  // what we bumped into slows us, so we don't keep pushing at a wall (and stops a shove)
  if (dt > 0) {
    const mx = (f.x - ox) / dt;
    const mz = (f.z - oz) / dt;
    if (shoved) {
      const want = Math.hypot(f.vx + f.kx, f.vz + f.kz);
      if (Math.hypot(mx, mz) < want * 0.5) {
        f.kx *= 0.3;
        f.kz *= 0.3;
      }
      f.vx = mx - f.kx;
      f.vz = mz - f.kz;
      const fade = Math.exp(-5 * dt);
      f.kx *= fade;
      f.kz *= fade;
      if (Math.hypot(f.kx, f.kz) < 0.3) {
        f.kx = 0;
        f.kz = 0;
      }
    } else {
      f.vx = mx;
      f.vz = mz;
    }
  }

  // onto a stairway: down to its basement, or back up
  if (m.map.stairs.length && f.y < 0.5) {
    const st = stairAt(m.map, f.x, f.z);
    if (st >= 0) takeStairs(m, f, m.map.stairs[st]);
  }

  if (!f.down) autoPickup(m, f);
  f.stillT = Math.hypot(f.vx, f.vz) < 0.4 ? f.stillT + dt : 0;

  // a bounce pad throws us up for a glide, off the way its arrows point (crawling, an egg only goes over it)
  const pad = f.y < 0.5 && !f.down ? padAt(m.map, f.x, f.z) : -1;
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
    f.on = -1;
    f.stillT = 0;
    emit(m, { t: 'bounce', f: f.id });
    clearOneShots(inp);
    return;
  }

  if (f.boost > 0) {
    f.hp = Math.min(HP_MAX, f.hp + BOOST.heal * Math.min(dt, f.boost / BOOST.drain));
    f.boost = Math.max(0, f.boost - BOOST.drain * dt);
  }
  if (f.sip > 0) {
    f.shield = Math.min(SHIELD_MAX, f.shield + Math.min(f.sip, SIP * dt));
    f.sip = Math.max(0, f.sip - SIP * dt);
  }
  // a campfire warms you back up, slowly (not knocked down: that's bleeding out)
  f.warm = f.y < 0.5 && !f.down && fireAt(m.map, f.x, f.z) >= 0;
  if (f.warm && f.hp < HP_MAX) f.hp = Math.min(HP_MAX, f.hp + CAMP.hps * dt);
  if (f.down && bleed(m, f, dt)) {
    clearOneShots(inp);
    return;
  }

  // (underground, by the ground over us)
  const s = m.storm;
  const sx = topX(f.x) - s.x;
  const sz = f.z - s.z;
  if (s.dps > 0 && sx * sx + sz * sz > s.r * s.r) {
    f.stormT += dt;
    while (f.stormT >= STORM_TICK && f.phase === 'ground') {
      f.stormT -= STORM_TICK;
      hurt(m, f, s.dps * STORM_TICK, -1, 'storm', true);
    }
  } else f.stormT = 0;

  const burn = zoneAt(m, 'sauce', f.x, f.z, f.y);
  if (burn) {
    f.burnT += dt;
    while (f.burnT >= STORM_TICK && f.phase === 'ground') {
      f.burnT -= STORM_TICK;
      hurt(m, f, (THROWS.sauce.dps ?? 0) * STORM_TICK, burn.by, 'sauce', false);
    }
  } else f.burnT = 0;

  f.bush = f.y < 0.5 ? coverOf(m, f.x, f.z) : -1;
  f.inside = f.y < 1 ? buildingAt(m.map, f.x, f.z) : -1;
  clearOneShots(inp);
}

/**
 * What an egg on its feet does with its input: weapons, reloading, items, building, editing, the interact key, the
 * trigger and the drop key.
 */
function handle(m: Match, f: Fighter, dt: number) {
  const inp = f.input;
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
  // a heavy SMG's spread settles; a minigun spins up while the trigger is held, and down when it's let go
  const hg = f.slot < 2 ? f.guns[f.slot] : null;
  const hs = hg ? WEAPONS[hg.w] : null;
  if (!inp.fire || f.reloadT > 0 || !hs?.kick) f.heat = Math.max(0, f.heat - (hs?.kick?.cool ?? 3) * dt);
  if (hs?.spin && hg) f.spin = inp.fire && f.reloadT <= 0 && !f.using && (hg.mag > 0 || f.ammo[hs.ammo] > 0) ? Math.min(1, f.spin + dt / hs.spin.up) : Math.max(0, f.spin - dt / 1.2);
  else f.spin = 0;
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
  if (inp.mat) switchMat(f, inp.mat);
  if (f.queued && f.buildT <= 0) {
    const plan = f.queued;
    f.queued = null;
    if (m.clock - f.queuedAt < BUILD_WAIT) build(m, f, plan);
  }
  if (inp.piece) {
    // a piece by its own key: picked for the build key, and built at once
    f.piece = inp.piece;
    f.buildAt = m.clock;
    build(m, f, inp.piece);
  } else if (inp.build) {
    // the build key twice in quick succession boxes us in (the first press has built its piece already)
    const twice = m.clock - f.buildAt < BOX_TAP;
    f.buildAt = twice ? -99 : m.clock;
    build(m, f, twice ? 'box' : f.piece, twice);
  }
  if (inp.edit) edit(m, f);
  if (inp.interact) interact(m, f);
  if (inp.fire && f.fireT <= 0 && f.burst <= 0) trigger(m, f);
  if (inp.drop !== null) dropOut(m, f, inp.drop);
}

/**
 * A knocked egg this client owns bleeds out (not while a teammate revives it), and is cracked once it has, or once
 * nobody on its team is left standing. True when it's out. Once the match is over it lies there, its place settled.
 */
function bleed(m: Match, f: Fighter, dt: number) {
  if (m.ended) return false;
  if (teamUp(m, f.team, f)) {
    if (!beingRevived(m, f)) f.hp -= (DOWN_HP / BLEED_T) * dt;
    if (f.hp > 0) return false;
  }
  crack(m, f, f.knockBy, f.hp > 0 ? (f.knockCause ?? 'bleed') : 'bleed');
  return true;
}

/** Up a ramp or onto a floor in our stride, else down to whatever is under us (the ground, at worst). */
function climb(m: Match, f: Fighter, dt: number) {
  if (!m.walls.size && f.y <= 0) {
    f.on = -1;
    return;
  }
  const under = surfaceAt(m, f.x, f.z, f.y + STEP_UP);
  f.y = under.y >= f.y ? under.y : Math.max(under.y, f.y - DROP_V * dt);
  f.on = under.y >= f.y - 0.01 ? under.id : -1;
}

/**
 * Down a stairway, or up one: out past its other end, still walking the same way (whatever we were doing goes on, but a
 * revive: the teammate stays where it is).
 */
function takeStairs(m: Match, f: Fighter, s: Stair) {
  const down = !isDeep(f.x);
  const p = stairOut(s, down);
  f.x = p.x;
  f.z = p.z;
  f.on = -1;
  f.bush = -1;
  f.stillT = 0;
  if (f.reviving >= 0) stopReviving(m, f);
  if (f.ai && down && !f.ai.below.includes(s.u)) f.ai.below.push(s.u);
  if (f.ai) {
    // (on the way it walked: below on past the foot, up top back off the top end)
    const k = down ? STAIR_ON : -STAIR_ON;
    f.ai.stairAt = m.time;
    f.ai.stairX = p.x + s.dx * k;
    f.ai.stairZ = p.z + s.dz * k;
  }
  emit(m, { t: 'stairs', f: f.id, down });
}

/** Cover hiding a point: a bush or a cornfield on the island, or a bush grown from a can (GROWN), else -1. */
export function coverOf(m: Match, x: number, z: number) {
  const c = coverAt(m.map, x, z);
  if (c >= 0 || !m.zones.length) return c;
  return zoneAt(m, 'bush', x, z, 0) ? GROWN : -1;
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
  f.spin = 0;
  f.using = null;
  f.useT = 0;
  f.fireT = Math.max(f.fireT, 0.18);
}

/** Pushes an egg out of everything solid and keeps it on the island. */
function resolve(m: Match, f: Fighter) {
  // up on something built, only the tall things on the island and the walls built on our level stand in the way
  const lv = levelOf(f.y);
  for (let pass = 0; pass < 2; pass++) {
    const ox = f.x;
    const oz = f.z;
    solidsNear(m.map, f.x, f.z, FIGHTER_R + 2.5, (_i, s) => {
      if (!standing(m, s) || (lv > 0 && !tall(s, lv))) return;
      const p = s.shape === 'circle' ? pushCircle(f.x, f.z, FIGHTER_R, s.x, s.z, s.r) : pushBox(f.x, f.z, FIGHTER_R, s.x, s.z, s.hw, s.hd);
      if (p) {
        f.x += p.x;
        f.z += p.z;
      }
    });
    const r = FIGHTER_R + WALL_THICK + 0.05;
    m.walls.near(f.x - r, f.z - r, f.x + r, f.z + r, (w) => {
      if (w.k !== 'wall' || w.lv !== lv) return;
      // a doorway lets us through between its two sides
      for (const o of w.e === 1 && w.parts ? w.parts : [w]) {
        const p = pushObb(f.x, f.z, FIGHTER_R, o);
        if (p) {
          f.x += p.x;
          f.z += p.z;
        }
      }
    });
    for (const o of m.fighters) {
      if (o === f || Math.abs(o.x - f.x) >= 2 * FIGHTER_R || Math.abs(o.z - f.z) >= 2 * FIGHTER_R || !fighting(o) || Math.abs(o.y - f.y) > 1.5) continue;
      const p = pushCircle(f.x, f.z, FIGHTER_R, o.x, o.z, FIGHTER_R);
      if (p) {
        f.x += p.x * 0.5;
        f.z += p.z * 0.5;
      }
    }
    f.x = clampX(f.x);
    f.z = clamp(f.z, -EDGE, EDGE);
    // nothing in the way: a second look would find nothing either
    if (f.x === ox && f.z === oz) break;
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
    if (f.ammo[spec.ammo] > 0 && !spec.call) startReload(m, f);
    else {
      f.fireT = 0.35;
      emit(m, { t: 'empty', f: f.id });
    }
    return;
  }
  // a minigun fires once it has spun up
  if (spec.spin && f.spin < 1) return;
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
  if (f.ai) pour(m, f.ai, damageOf(g.w, g.r) * spec.pellets);
  const moving = clamp(Math.hypot(f.vx, f.vz) / SPEED, 0, 1);
  // a heavy SMG climbs: each shot wider than the last until you let it settle
  const k = r2(1 + moving * 0.6 + f.heat);
  if (spec.kick) f.heat = Math.min(spec.kick.max, f.heat + spec.kick.per);
  const s = Math.floor(m.rng() * 0x7fffffff);
  const a = r2(f.aim);
  const x = r2(f.x);
  const z = r2(f.z);
  const h = aimLevel(m, f, spec.range);
  fire(m, f.id, g.w, g.r, x, z, a, s, k, true, h, levelOf(f.y));
  emit(m, { t: 'shot', f: f.id, w: g.w, r: g.r, x, z, a, s, k, h });
  if (spec.call) {
    // the flare goes up and the gun is spent; the host sends a supply drop to land near here
    f.guns[f.slot] = null;
    f.burst = 0;
    switchTo(f, f.guns[0] ? 0 : f.guns[1] ? 1 : SLOT_MELEE);
    if (m.world) callDrop(m, f.id, f.x, f.z);
    return;
  }
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

/**
 * The level a shot flies at: our own, or higher when it's aimed up at an egg up high (or, with no egg in its way, at
 * something built up high), so it goes over what's lower than that (see castRay).
 */
function aimLevel(m: Match, f: Fighter, range: number) {
  const lv = levelOf(f.y);
  if (lv >= MAX_LEVEL || (!m.walls.size && f.y <= 0)) return lv;
  const dx = Math.sin(f.aim);
  const dz = Math.cos(f.aim);
  let best = Infinity;
  let at = lv;
  for (const o of m.fighters) {
    if (o === f || o.team === f.team || !fighting(o) || Math.abs(o.x - f.x) > range || Math.abs(o.z - f.z) > range) continue;
    const t = rayCircle(f.x, f.z, dx, dz, range, o.x, o.z, HIT_R + 0.5);
    if (t < best) {
      best = t;
      at = Math.max(lv, levelOf(o.y));
    }
  }
  if (best < Infinity) return at;
  const cx = gridOf(f.x);
  const cz = gridOf(f.z);
  m.walls.along(f.x, f.z, f.x + dx * range, f.z + dz * range, (w) => {
    if (w.k === 'wall' || (w.cx === cx && w.cz === cz) || (w.k === 'ramp' ? w.lv < lv : w.lv <= lv)) return;
    const t = rayObb(f.x, f.z, dx, dz, range, w);
    if (t < best) {
      best = t;
      at = Math.min(MAX_LEVEL, w.lv);
    }
  });
  return at;
}

/** Puts a shot's bullets in the air, at level `lv` (fired from level `from`). The same seed gives the same pellets on every client. */
export function fire(m: Match, fid: number, w: WeaponId, r: number, x: number, z: number, a: number, seed: number, k: number, local: boolean, lv = 0, from = lv) {
  const spec = WEAPONS[w];
  const rng = rng32(seed);
  const dmg = damageOf(w, r);
  for (let p = 0; p < spec.pellets; p++) {
    // pellets spread evenly across the cone, each jittered a little
    const u = spec.pellets > 1 ? ((p + rng()) / spec.pellets) * 2 - 1 : rng() * 2 - 1;
    const ang = a + u * spec.spread * k;
    m.bullets.push({ f: fid, w, r, x, z, dx: Math.sin(ang), dz: Math.cos(ang), speed: spec.speed * (spec.pellets > 1 ? 0.92 + rng() * 0.16 : 1), left: spec.range, traveled: 0, dmg, local, lv, from, ox: x, oz: z, chip: -1 });
  }
  if (m.bullets.length > 900) m.bullets.splice(0, m.bullets.length - 900);
}

function startReload(m: Match, f: Fighter) {
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (!g || f.reloadT > 0) return;
  const spec = WEAPONS[g.w];
  if (g.mag >= spec.mag || f.ammo[spec.ammo] <= 0 || spec.call) return;
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
  return (!!u.hp && f.hp < (u.hpCap ?? HP_MAX)) || (!!u.shield && f.shield < (u.shieldCap ?? SHIELD_MAX)) || (!!u.boost && f.boost < BOOST.max - 1) || (!!u.sip && f.shield + f.sip < SHIELD_MAX - 1);
}

/**
 * The consumable to reach for: for health a medkit when badly hurt (a golden egg tart when nearly cracked), else
 * bandages; for shield the minis first, then a smoothie, then a potion.
 */
export function bestUse(f: Fighter, kind: 'heal' | 'shield'): UseId | null {
  const order: UseId[] = kind === 'heal' ? (f.hp < 35 ? ['tart', 'medkit', 'bandage'] : f.hp < 60 ? ['medkit', 'tart', 'bandage'] : ['bandage', 'medkit', 'tart']) : ['mini', 'smoothie', 'shield'];
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
  if (u.sip) f.sip = Math.min(SHIELD_MAX, f.sip + u.sip);
  emit(m, { t: 'used', f: f.id, what });
}

function swing(m: Match, f: Fighter) {
  const spec = MELEE[f.melee];
  f.fireT = 1 / spec.rate;
  f.firedAt = m.clock;
  if (f.ai) pour(m, f.ai, spec.dmg);
  emit(m, { t: 'swing', f: f.id });
  // an egg in front of us first
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const o of m.fighters) {
    if (o === f || o.team === f.team || !fighting(o) || Math.abs(o.y - f.y) > 1.6) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d > spec.range + FIGHTER_R || d >= bestD) continue;
    if (Math.abs(angleDiff(Math.atan2(o.x - f.x, o.z - f.z), f.aim)) > spec.arc) continue;
    best = o;
    bestD = d;
  }
  if (best) return strike(m, f, best, spec.dmg, f.melee, best.x, best.z);
  // then a wall, ramp, crate, barrel, tree, rock, car or fallen log just ahead (a fence or a table too, for the bonk)
  const fx = Math.sin(f.aim);
  const fz = Math.cos(f.aim);
  const lv = levelOf(f.y);
  let hit = castRay(m, f.x, f.z, fx, fz, spec.range, -1, false, true, lv);
  const ramp = rampAhead(m, f, fx, fz, Math.min(spec.range, hit?.t ?? Infinity));
  if (ramp) hit = ramp;
  if (!hit) return;
  const x = f.x + fx * hit.t;
  const z = f.z + fz * hit.t;
  const mat = MAT_OF[hit.what];
  if (mat !== undefined) {
    // wood from a tree or a log, stone from a rock, metal from a car or a lamp post
    const n = Math.min(Math.max(1, Math.round(spec.wood * MAT_SPECS[mat].yield)), MAT_MAX - f[mat]);
    f[mat] += n;
    emit(m, { t: 'harvest', f: f.id, x, z, n, mat });
  } else if (hit.what === 'crate' || hit.what === 'barrel') smashCrate(m, f, hit.ref, spec.dmg * spec.wallMult, x, z);
  else if (hit.what === 'built') smashWall(m, f, hit.ref, spec.dmg * spec.wallMult, x, z);
  else if (hit.what === 'window' && !m.broken[hit.ref]) breakGlass(m, hit.ref, f.id, true);
  else if (hit.what === 'door') smashDoor(m, f, hit.ref, spec.dmg * spec.wallMult, x, z);
  else emit(m, { t: 'thud', x, z, what: hit.what });
}

/**
 * A hit on an egg from something this client fired: applied here if we own the egg, else sent to its owner. `d` is
 * the hit as fired, `took` what's left of it after the egg's armor (as its last report has it, for someone else's).
 * Never a teammate's.
 */
function strike(m: Match, from: Fighter, o: Fighter, dmg: number, w: Cause, x: number, z: number) {
  if (o.team === from.team) return;
  const d = Math.max(1, Math.round(dmg));
  const took = armored(d, w, false, o);
  const shield = o.kind === 'remote' ? (o.show.flags & F_SHIELDED) !== 0 : o.shield > 0;
  if (o.kind === 'remote') {
    from.dealt += took;
    emit(m, { t: 'hit', f: from.id, to: o.id, d, took, w, x: r2(x), z: r2(z), shield, local: false });
    return;
  }
  const landed = hurt(m, o, d, from.id, w, false);
  if (landed > 0) from.dealt += landed;
  emit(m, { t: 'hit', f: from.id, to: o.id, d, took, w, x: r2(x), z: r2(z), shield, local: true });
}

/** What's left of a hit after the armor an egg wears: bullets, swings and blasts are cut, the storm and hot sauce aren't. */
export function armored(d: number, w: Cause, storm: boolean, f: Fighter) {
  if (storm || w === 'sauce' || (f.helmet <= 0 && f.vest <= 0)) return d;
  return r1(d * armorMult(f.helmet, f.vest));
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
 * Damage to an egg this client owns. Armor takes its cut first, then shields soak it, except the storm's. Returns how
 * much landed. Only eggs on the ground can be hurt, never by a teammate, and nobody once the match is over. In teams,
 * an egg with a teammate still standing is knocked down rather than cracked; one already down is finished off (by
 * whoever knocked it, if it's the storm or itself that does it).
 */
export function hurt(m: Match, f: Fighter, d: number, by: number, w: Cause, storm: boolean) {
  if (m.ended || !owned(f) || f.phase !== 'ground' || !(d > 0)) return 0;
  if (by >= 0 && by !== f.id && m.fighters[by]?.team === f.team) return 0;
  let left = armored(d, w, storm, f);
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
  if (f.hp <= 0.001) {
    const foe = by >= 0 && by !== f.id;
    if (f.down) crack(m, f, foe ? by : f.knockBy, foe || f.knockBy < 0 ? w : 'bleed');
    else if (m.mode !== 'solo' && teamUp(m, f.team, f)) knock(m, f, by, w);
    else crack(m, f, by, w);
  }
  return fromShield + fromHp;
}

/** An egg this client owns is knocked down: its shield gone, whatever it was doing stopped, bleeding from DOWN_HP. */
function knock(m: Match, f: Fighter, by: number, w: Cause) {
  stopReviving(m, f);
  f.down = true;
  f.hp = DOWN_HP;
  f.shield = 0;
  f.boost = 0;
  f.sip = 0;
  f.knockBy = by >= 0 && by !== f.id ? by : -1;
  f.knockCause = w;
  f.downAt = m.time;
  f.using = null;
  f.useT = 0;
  f.reloadT = 0;
  f.burst = 0;
  f.spin = 0;
  f.queued = null;
  f.stunT = 0;
  emit(m, { t: 'knock', f: f.id, by: f.knockBy, w });
}

/** A knocked egg another client owns, on its owner's word (its state may have said it was down already). */
export function applyKnock(m: Match, fid: number, by: number, w: Cause) {
  const f = m.fighters[fid];
  if (!f || owned(f) || m.mode === 'solo' || f.phase === 'out' || m.ended || (f.down && f.knockCause !== null)) return false;
  f.down = true;
  f.knockBy = by;
  f.knockCause = w;
  f.downAt = m.time;
  f.flipAt = m.clock;
  f.reviving = -1;
  emit(m, { t: 'knock', f: fid, by, w, net: true });
  return true;
}

/** Back on its feet: with REVIVE_HP if it's ours (anyone else's says so in its state). */
function standUp(m: Match, f: Fighter) {
  f.down = false;
  f.knockBy = -1;
  f.knockCause = null;
  f.flipAt = m.clock;
  if (owned(f)) {
    f.hp = REVIVE_HP;
    f.shield = 0;
  }
  for (const o of m.fighters) if (o.reviving === f.id) o.reviving = -1;
}

/**
 * The nearest knocked teammate on the ground within reach of an egg (to revive), or null: on its level, or (`over`)
 * going by the ground over anyone underground.
 */
export function downMate(m: Match, f: Fighter, reach = REVIVE_R, over = false): Fighter | null {
  if (m.mode === 'solo') return null;
  let best: Fighter | null = null;
  let bestD = reach;
  for (const id of m.teams[f.team] ?? []) {
    const o = m.fighters[id];
    if (o === f || !o.down || !fighting(o) || Math.abs(o.y - f.y) > 1.2) continue;
    const d = over ? Math.hypot(topX(o.x) - topX(f.x), o.z - f.z) : Math.hypot(o.x - f.x, o.z - f.z);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/** The teammate reviving a knocked egg right now (it doesn't bleed meanwhile), if any. */
export const revivedBy = (m: Match, f: Fighter) => (f.down ? m.fighters.find((o) => o.reviving === f.id && o.team === f.team && upright(o)) : undefined);
export const beingRevived = (m: Match, f: Fighter) => !!revivedBy(m, f);

/** How far along an egg's revive is, 0..1 (by the clock of whoever we heard it from). */
export const reviveShare = (m: Match, f: Fighter) => (f.reviving >= 0 ? clamp((m.clock - f.reviveAt) / REVIVE_T, 0, 1) : 0);

/** What the markers pointing the way to a teammate show. */
export type MateMark = {
  id: number;
  n: number;
  color: string;
  /** How far off, from the ground above anyone underground. */
  dist: number;
  /** 1 up a stairway from us, -1 down one, 0 on our level. */
  level: number;
  down: boolean;
  /** Knocked down with nobody reviving it. */
  help: boolean;
};

/** The rest of the team of the egg we see (in solo, nobody), off the bus and still in. */
export function mateMarks(m: Match, eye: Fighter | undefined): MateMark[] {
  if (m.mode === 'solo' || !eye) return [];
  const out: MateMark[] = [];
  for (const o of teamOf(m, eye.team)) {
    if (o === eye || (o.phase !== 'ground' && o.phase !== 'drop')) continue;
    const down = o.down && o.phase === 'ground';
    out.push({
      id: o.id,
      n: mateNumber(m, o),
      color: mateColor(m, o),
      dist: Math.hypot(topX(o.x) - topX(eye.x), o.z - eye.z),
      level: (isDeep(eye.x) ? 1 : 0) - (isDeep(o.x) ? 1 : 0),
      down,
      help: down && !revivedBy(m, o),
    });
  }
  return out;
}

/**
 * Where on screen a marker for a point goes: the point itself while it's inside the box (left, top, right, bottom),
 * else where the line to it from (cx, cy) leaves the box, with `off` set and `a` the way it points (radians, 0 right).
 */
export function edgeOf(x: number, y: number, cx: number, cy: number, l: number, t: number, r: number, b: number) {
  if (x >= l && x <= r && y >= t && y <= b) return { x, y, a: 0, off: false };
  cx = clamp(cx, l, r);
  cy = clamp(cy, t, b);
  const dx = x - cx;
  const dy = y - cy;
  let k = 1;
  if (dx > 0) k = Math.min(k, (r - cx) / dx);
  else if (dx < 0) k = Math.min(k, (l - cx) / dx);
  if (dy > 0) k = Math.min(k, (b - cy) / dy);
  else if (dy < 0) k = Math.min(k, (t - cy) / dy);
  return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx), off: true };
}

/** The teammate who most needs help: the nearest knocked one nobody is reviving. */
export function mateInNeed(marks: MateMark[]) {
  let best: MateMark | null = null;
  for (const k of marks) if (k.help && (!best || k.dist < best.dist)) best = k;
  return best;
}

function startReviving(m: Match, f: Fighter, o: Fighter) {
  f.reviving = o.id;
  f.reviveAt = m.clock;
  f.using = null;
  f.useT = 0;
  f.reloadT = 0;
  f.burst = 0;
  emit(m, { t: 'revive', f: f.id, to: o.id });
}

function stopReviving(m: Match, f: Fighter) {
  if (f.reviving < 0) return;
  f.reviving = -1;
  emit(m, { t: 'revive', f: f.id, to: -1 });
}

/**
 * Reviving, for an egg this client owns: holding the interact key by a knocked teammate starts it, and it goes on
 * while the key stays down, we stay up and in reach, and it stays down. Once it has taken REVIVE_T the teammate stands
 * (solo and the host), or we ask the host to stand it up.
 */
function reviveStep(m: Match, f: Fighter) {
  const o = f.reviving >= 0 ? m.fighters[f.reviving] : undefined;
  if (!o) {
    f.reviving = -1;
    const mate = f.input.hold ? downMate(m, f) : null;
    if (mate) startReviving(m, f, mate);
    return;
  }
  if (!f.input.hold || f.down || !o.down || !fighting(o) || Math.hypot(o.x - f.x, o.z - f.z) > REVIVE_R + 0.8) return stopReviving(m, f);
  if (m.clock - f.reviveAt < REVIVE_T) return;
  if (m.world) reviveEgg(m, o.id, f.id, true);
  else {
    emit(m, { t: 'ask', f: f.id, to: o.id });
    stopReviving(m, f);
  }
}

/**
 * The host stands a knocked egg up for the teammate that revived it: both on the ground on one team, the reviver up
 * and near, and (a guest's egg) reviving it as long as a revive takes, give or take the trip. False when not.
 */
export function reviveEgg(m: Match, fid: number, by: number, announce: boolean) {
  const f = m.fighters[fid];
  const r = m.fighters[by];
  if (!m.world || m.ended || !f || !r || f === r || !f.down || !fighting(f) || !fighting(r) || r.down || r.team !== f.team) return false;
  if (Math.hypot(f.x - r.x, f.z - r.z) > REVIVE_R + 3) return false;
  if (!owned(r) && (r.reviving !== fid || m.clock - r.reviveAt < REVIVE_T - 1.5)) return false;
  standUp(m, f);
  emit(m, announce ? { t: 'revived', f: fid, by } : { t: 'revived', f: fid, by, net: true });
  return true;
}

/** A revive someone else's egg started (on `to`) or stopped (-1), on its owner's word. */
export function applyRevive(m: Match, fid: number, to: number) {
  const f = m.fighters[fid];
  const o = to >= 0 ? m.fighters[to] : undefined;
  if (!f || owned(f) || m.mode === 'solo' || f.phase === 'out' || f.reviving === to || (to >= 0 && (!o || o === f || o.team !== f.team))) return false;
  f.reviving = to;
  f.reviveAt = m.clock;
  emit(m, { t: 'revive', f: fid, to, net: true });
  return true;
}

/** A knocked egg stands, on the host's word: ours gets its health back, anyone else's says so in its state. */
export function applyRevived(m: Match, fid: number, by: number) {
  const f = m.fighters[fid];
  if (m.world || !f || !f.down || f.phase === 'out') return false;
  standUp(m, f);
  emit(m, { t: 'revived', f: fid, by, net: true });
  return true;
}

/** Marks a spot for the team, at most every PING_COOL seconds. */
function ping(m: Match, f: Fighter, x: number, z: number) {
  if (m.clock - f.pingAt < PING_COOL) return;
  setPing(m, f, x, z);
  emit(m, { t: 'ping', f: f.id, x: f.pingX, z: f.pingZ });
}

function setPing(m: Match, f: Fighter, x: number, z: number) {
  // a spot marked underground marks the ground over it
  f.pingX = r1(clamp(topX(x), -EDGE, EDGE));
  f.pingZ = r1(clamp(z, -EDGE, EDGE));
  f.pingAt = m.clock;
}

/** A spot someone else's egg marked for its team. */
export function applyPing(m: Match, fid: number, x: number, z: number) {
  const f = m.fighters[fid];
  if (!f || owned(f) || m.mode === 'solo') return false;
  setPing(m, f, x, z);
  emit(m, { t: 'ping', f: fid, x: f.pingX, z: f.pingZ, net: true });
  return true;
}

/** The spot an egg has marked for its team while it shows (PING_T seconds), and how long ago, or null. */
export const pingOf = (m: Match, f: Fighter) => (m.clock - f.pingAt < PING_T ? { x: f.pingX, z: f.pingZ, age: m.clock - f.pingAt } : null);

/**
 * Whether an egg may emote now: EMOTE_GAP since its last, and no more than EMOTE_BURST in EMOTE_SPAN seconds. The host
 * gives news of another client's a little `slack` (what the network bunches up).
 */
export function emoteReady(f: Fighter, clock: number, slack = 1) {
  const n = f.emotes.length;
  if (n && clock - f.emotes[n - 1] < EMOTE_GAP * slack) return false;
  return n < EMOTE_BURST || clock - f.emotes[n - EMOTE_BURST] >= EMOTE_SPAN * slack;
}

/** Whether an egg can say this at all: off the bus and still in (knocked down too), and calls only in teams. */
const canEmote = (m: Match, f: Fighter, k: EmoteId) => (f.phase === 'ground' || f.phase === 'drop') && (m.mode !== 'solo' || !isTeamEmote(k));

/** The ammo an egg asking for some wants: the kind its guns take that it has least of for what it carries, or null. */
export function ammoAsk(f: Fighter): Ammo | null {
  let best: Ammo | null = null;
  let bestK = Infinity;
  for (const g of f.guns) {
    if (!g || WEAPONS[g.w].call) continue;
    const a = WEAPONS[g.w].ammo;
    const k = f.ammo[a] / ammoCap(a, f.pack);
    if (k < bestK) {
      best = a;
      bestK = k;
    }
  }
  return best;
}

/** An emote or a call for the team, at most as often as emoteReady says. Computer eggs on the team answer a call. */
function emote(m: Match, f: Fighter, k: EmoteId, x: number, z: number) {
  if (!canEmote(m, f, k) || !emoteReady(f, m.clock)) return;
  setEmote(m, f, k, k === 'ammo' ? ammoAsk(f) : null, x, z);
  emit(m, { t: 'emote', f: f.id, k, a: f.emoteA, x: k === 'enemy' ? f.pingX : 0, z: k === 'enemy' ? f.pingZ : 0 });
  if (m.world) heard(m, f, k);
}

function setEmote(m: Match, f: Fighter, k: EmoteId, a: Ammo | null, x: number, z: number) {
  f.emote = k;
  f.emoteA = k === 'ammo' ? a : null;
  f.emoteAt = m.clock;
  f.emotes.push(m.clock);
  if (f.emotes.length > EMOTE_BURST) f.emotes.shift();
  // an enemy spotted is pinged there for the team too
  if (k === 'enemy') setPing(m, f, x, z);
}

/**
 * Someone else's egg emotes. The host turns away one too soon after its last (see emoteReady) and passes on no more of
 * it; its computer eggs answer a call.
 */
export function applyEmote(m: Match, fid: number, k: EmoteId, a: Ammo | null, x: number, z: number) {
  const f = m.fighters[fid];
  if (!f || owned(f) || !canEmote(m, f, k) || (m.world && !emoteReady(f, m.clock, 0.6))) return false;
  setEmote(m, f, k, a, x, z);
  emit(m, { t: 'emote', f: fid, k, a: f.emoteA, x: k === 'enemy' ? f.pingX : 0, z: k === 'enemy' ? f.pingZ : 0, net: true });
  if (m.world) heard(m, f, k);
  return true;
}

/** The emote an egg shows (for EMOTE_T seconds), the ammo it asks for and how long ago it went up, or null. */
export const emoteOf = (m: Match, f: Fighter) => (f.emote && m.clock - f.emoteAt < EMOTE_T ? { k: f.emote, a: f.emoteA, age: m.clock - f.emoteAt } : null);

/**
 * Puts something down at an egg's feet for a teammate to pick up (it never goes straight back up itself): a gun or the
 * melee weapon from its slot (not the spatula), one of the throwable in hand, one consumable, a box of ammo, MAT_DROP
 * of a material, or the scope in use (not 1x). False when there was nothing to put down.
 */
export function dropOut(m: Match, f: Fighter, what: Drop) {
  if (f.phase !== 'ground' || f.down || f.y > 1) return false;
  let def: LootDef | null = null;
  if (what === 0 || what === 1) {
    const g = f.guns[what];
    if (g) {
      def = { kind: 'gun', w: g.w, r: g.r, mag: g.mag };
      f.guns[what] = null;
      if (f.slot === what) switchTo(f, f.guns[1 - what] ? 1 - what : SLOT_MELEE);
    }
  } else if (what === SLOT_MELEE) {
    if (f.melee !== 'spatula') {
      def = { kind: 'melee', w: f.melee };
      f.melee = 'spatula';
    }
  } else if (what === SLOT_THROW) {
    if (f.throws[f.pick] > 0) {
      def = { kind: 'throw', w: f.pick, n: 1 };
      f.throws[f.pick]--;
    }
  } else if (typeof what === 'number') return false;
  else if (what === 'scope') {
    // the scope in use, and the next best we carry goes up to the eye
    if (f.scope > 0) {
      def = { kind: 'scope', lv: f.scope };
      f.scopes &= ~(1 << (f.scope - 1));
      f.scope = bestScope(f);
    }
  } else if (isUse(what)) {
    if (f.items[what] > 0) {
      def = { kind: 'use', w: what, n: 1 };
      f.items[what]--;
      if (f.using === what && f.items[what] <= 0) f.using = null;
    }
  } else if (isAmmo(what)) {
    const n = Math.min(f.ammo[what], AMMO_BOX[what]);
    if (n > 0) {
      def = { kind: 'ammo', a: what, n };
      f.ammo[what] -= n;
    }
  } else if (isMat(what)) {
    const n = Math.min(f[what], MAT_DROP);
    if (n > 0) {
      def = { kind: what, n };
      f[what] -= n;
    }
  }
  if (!def) return false;
  // a step ahead, short of anything solid
  const hit = castRay(m, f.x, f.z, Math.sin(f.aim), Math.cos(f.aim), 1.2, -1, false, true, levelOf(f.y));
  const r = hit ? Math.max(0, hit.t - 0.4) : 0.8;
  dropItem(m, f, def, clampX(f.x + Math.sin(f.aim) * r), clamp(f.z + Math.cos(f.aim) * r, -EDGE, EDGE));
  return true;
}

/**
 * The place an egg going out takes: in solo how many are still in, in teams its team's once its last egg goes (how
 * many teams are still in), given to every egg on the team; 0 while teammates are still in.
 */
function placeOut(m: Match, f: Fighter) {
  if (teamOf(m, f.team).some((o) => o !== f && alive(o))) return 0;
  const place = teamsLeft(m);
  for (const o of teamOf(m, f.team)) o.place = place;
  return place;
}

/** An egg this client owns is out: everything it carried spills on the ground. */
function crack(m: Match, f: Fighter, by: number, w: Cause) {
  const place = placeOut(m, f);
  const down = f.down;
  if (f.reviving >= 0) stopReviving(m, f);
  f.phase = 'out';
  f.down = false;
  f.hp = 0;
  f.shield = 0;
  f.boost = 0;
  f.sip = 0;
  f.kx = 0;
  f.kz = 0;
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
  for (let lv = 1; lv <= MAX_SCOPE; lv++) if (hasScope(f, lv) || f.scope === lv) spill.push({ kind: 'scope', lv });
  if (f.pack > 0) spill.push({ kind: 'pack', lv: f.pack });
  if (f.helmet > 0) spill.push({ kind: 'helmet', lv: f.helmet });
  if (f.vest > 0) spill.push({ kind: 'vest', lv: f.vest });
  for (const mat of MATS) if (f[mat] >= 10) spill.push({ kind: mat, n: Math.floor(f[mat] / 2) });
  if (f.ghillie) spill.push({ kind: 'ghillie' });
  f.guns = [null, null];
  f.melee = 'spatula';
  f.ammo = { light: 0, heavy: 0, shells: 0, rockets: 0 };
  f.items = none(USE_IDS);
  f.throws = none(THROW_IDS);
  f.scope = 0;
  f.scopes = 0;
  f.pack = 0;
  f.helmet = 0;
  f.vest = 0;
  f.ghillie = false;
  f.stunT = 0;
  f.wood = 0;
  f.stone = 0;
  f.metal = 0;
  const rad = spill.length > 1 ? 1 + spill.length * 0.07 : 0;
  spill.forEach((def, i) => {
    const a = (i / spill.length) * Math.PI * 2;
    // in a ring round the egg, short of anything solid (never through a wall, or under a bed out of reach)
    const hit = rad > 0 ? castRay(m, f.x, f.z, Math.sin(a), Math.cos(a), rad + 0.4, -1, false, true, levelOf(f.y)) : null;
    const r = hit ? Math.max(0, hit.t - 0.4) : rad;
    dropItem(m, f, def, clampX(f.x + Math.sin(a) * r), clamp(f.z + Math.cos(a) * r, -EDGE, EDGE));
  });
  emit(m, down ? { t: 'out', f: f.id, by, w, place, down } : { t: 'out', f: f.id, by, w, place });
}

/** An egg another client owns is out, on its owner's word (or ours, on the host's word that it took us out). */
export function applyOut(m: Match, fid: number, by: number, w: Cause) {
  const f = m.fighters[fid];
  if (!f || f.phase === 'out' || m.ended) return;
  const place = placeOut(m, f);
  const down = f.down;
  f.phase = 'out';
  f.down = false;
  f.reviving = -1;
  f.place = place;
  f.by = by;
  f.outCause = w;
  f.outAt = m.time;
  const killer = by >= 0 && by !== fid ? m.fighters[by] : undefined;
  if (killer) killer.kills++;
  emit(m, down ? { t: 'out', f: fid, by, w, place, down, net: true } : { t: 'out', f: fid, by, w, place, net: true });
}

/** A person left an online match: the host takes their egg out. */
export function forfeit(m: Match, fid: number) {
  const f = m.fighters[fid];
  if (!f || f.phase === 'out' || m.ended) return;
  const place = placeOut(m, f);
  // a knocked egg that leaves goes out to whoever knocked it
  const by = f.down && m.fighters[f.knockBy] ? f.knockBy : -1;
  if (by >= 0) m.fighters[by].kills++;
  f.phase = 'out';
  f.down = false;
  f.reviving = -1;
  f.place = place;
  f.by = by;
  f.outCause = 'left';
  f.outAt = m.time;
  emit(m, { t: 'out', f: fid, by, w: 'left', place });
}

type RayHit = { t: number; what: Thud; ref: number; fighter: Fighter | null };

/**
 * The first thing a ray meets within `len`: trees, rocks, building walls, shut doors, cars, posts, crates and barrels
 * still standing, chests, landed supply drops, built walls, and (when `eggs`) any egg in the fight but `skip` and its
 * teammates. Low things (fences, tables, fire pits, a jail cell's bars and its barred door) only count when `lows`:
 * bullets and eyes go over or through them, feet and swings don't. A window stops bullets and throws until its glass is
 * broken (`glass`), the eye never (`open`), and feet and swings always (`shut`, and whenever `lows`: there's wall below
 * it). Without `doors`, a shut door is no more in the way than an open one (one could open it).
 *
 * `lv` is the level the ray runs at. Up high it only meets the tall things on the island and the walls built on that
 * level (a window is wall up there, and a doorway open). A ray between two levels runs at the higher one: an egg up
 * high sees and shoots over everything lower than it, and anyone it can see can shoot back. So a ray from `lv` meets
 * an egg higher up past whatever is in the way at `lv`, if nothing is in the way at the egg's level. The gap a doorway
 * or a window cuts in a built wall lets rays through (only a doorway lets feet through: `lows` rays are feet).
 */
export function castRay(m: Match, x: number, z: number, dx: number, dz: number, len: number, skip: number, eggs: boolean, lows = false, lv = 0, windows: 'glass' | 'open' | 'shut' = 'glass', doors = true): RayHit | null {
  let best = null as RayHit | null;
  const glass = lows ? 'shut' : windows;
  solidsAlong(m.map, x, z, x + dx * len, z + dz * len, (_i, s) => {
    if (lv > 0) {
      if (s.what === 'door' || !tall(s, lv)) return;
    } else if (s.what === 'window') {
      if (glass === 'open' || (glass === 'glass' && m.broken[s.ref])) return;
    } else if (s.what === 'door') {
      if (!doors || !shut(m, s.ref) || (!lows && m.map.slabs[s.ref]?.bars)) return;
    } else if (!standing(m, s) || (!lows && low(s))) return;
    const t = raySolid(s, x, z, dx, dz, len);
    // up high a window is just wall
    if (t < (best?.t ?? Infinity)) best = { t, what: lv > 0 && s.what === 'window' ? 'wall' : s.what, ref: s.ref, fighter: null };
  });
  m.walls.along(x, z, x + dx * len, z + dz * len, (w) => {
    if (w.k !== 'wall' || w.lv !== lv) return;
    const t = rayWall(x, z, dx, dz, len, w, lows);
    if (t < (best?.t ?? Infinity)) best = { t, what: 'built', ref: w.id, fighter: null };
  });
  if (eggs) {
    // the box round the ray, for a cheap miss first
    const x0 = Math.min(x, x + dx * len) - HIT_R;
    const x1 = Math.max(x, x + dx * len) + HIT_R;
    const z0 = Math.min(z, z + dz * len) - HIT_R;
    const z1 = Math.max(z, z + dz * len) + HIT_R;
    const wall = best?.t ?? Infinity;
    // a shot goes straight past the shooter's teammates
    const team = m.fighters[skip]?.team ?? -1;
    let egg = null as RayHit | null;
    for (const o of m.fighters) {
      if (o.x < x0 || o.x > x1 || o.z < z0 || o.z > z1 || o.id === skip || o.team === team || !fighting(o)) continue;
      const t = rayCircle(x, z, dx, dz, len, o.x, o.z, HIT_R);
      if (t >= (egg?.t ?? Infinity)) continue;
      const ol = levelOf(o.y);
      if (ol <= lv ? t >= wall : castRay(m, x, z, dx, dz, t, skip, false, false, ol, windows, doors)) continue;
      egg = { t, what: 'egg', ref: o.id, fighter: o };
    }
    if (egg) return egg;
  }
  return best;
}

/** True when nothing solid stands between two points (at level `lv`, see castRay): the line of sight, which goes through windows. */
export function clearLine(m: Match, x0: number, z0: number, x1: number, z1: number, lv = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 1e-6) return true;
  return castRay(m, x0, z0, (x1 - x0) / len, (z1 - z0) / len, len, -1, false, false, lv, 'open') === null;
}

/** True when nothing stands between two eggs, at the higher one's level. */
export const clearBetween = (m: Match, a: Fighter, b: Fighter) => clearLine(m, a.x, a.z, b.x, b.z, Math.max(levelOf(a.y), levelOf(b.y)));

/** The things on the island that stand taller than a storey: trees and lamp posts always, buildings (windows too) below the top level. */
const tall = (s: Solid, lv: number) => s.what === 'tree' || s.what === 'post' || ((s.what === 'wall' || s.what === 'window') && lv < MAX_LEVEL);

/** The material a swing at a thing gathers. */
const MAT_OF: Partial<Record<Thud, Mat>> = { tree: 'wood', log: 'wood', rock: 'stone', car: 'metal', post: 'metal' };

/** Distance along a ray to a built wall: through the gap of a doorway, or of a window unless it's feet (`lows`). */
function rayWall(x: number, z: number, dx: number, dz: number, len: number, w: Wall, lows: boolean) {
  if (!w.parts || (lows && w.e === 2)) return rayObb(x, z, dx, dz, len, w);
  return Math.min(rayObb(x, z, dx, dz, len, w.parts[0]), rayObb(x, z, dx, dz, len, w.parts[1]));
}

/** The ramp on our level a swing from `f` meets within `len` (not one we stand on), as a ray hit. */
function rampAhead(m: Match, f: Fighter, dx: number, dz: number, len: number): RayHit | null {
  const lv = levelOf(f.y);
  let best = null as RayHit | null;
  m.walls.along(f.x, f.z, f.x + dx * len, f.z + dz * len, (w) => {
    if (w.k !== 'ramp' || w.lv !== lv || w.id === f.on || (w.cx === gridOf(f.x) && w.cz === gridOf(f.z))) return;
    const t = rayObb(f.x, f.z, dx, dz, len, w);
    if (t < (best?.t ?? Infinity)) best = { t, what: 'built', ref: w.id, fighter: null };
  });
  return best;
}

/** True when the line between two points is clear to the eye, but only through a window (broken or not). */
function inWindow(m: Match, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 1e-6 || !clearLine(m, x0, z0, x1, z1)) return false;
  return castRay(m, x0, z0, (x1 - x0) / len, (z1 - z0) / len, len, -1, false, false, 0, 'shut')?.what === 'window';
}

/**
 * True when nothing that stops bullets stands between two points, nor a window (a way you could walk, give or take a
 * fence, opening any door on the way).
 */
function openWay(m: Match, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 1e-6) return true;
  return castRay(m, x0, z0, (x1 - x0) / len, (z1 - z0) / len, len, -1, false, false, 0, 'shut', false) === null;
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
    const hit = castRay(m, b.x, b.z, b.dx, b.dz, reach, b.f, true, false, b.lv);
    // a bullet passing under a floor or a roof, or through a ramp, chips it on the way (not one the shooter stood in)
    if (b.local && m.walls.size) chipUnder(m, b, hit ? hit.t : reach);
    if (!hit) {
      b.x += b.dx * reach;
      b.z += b.dz * reach;
      b.left -= reach;
      b.traveled += reach;
      if (b.left > 1e-6) keep.push(b);
      else if (b.w === 'launcher' && b.local) blast(m, b.f, b.x, b.z, WEAPONS.launcher.splash ?? 4, b.dmg, WEAPONS.launcher.wallMult, 'launcher', b.lv * LEVEL_H);
      continue;
    }
    const x = b.x + b.dx * hit.t;
    const z = b.z + b.dz * hit.t;
    const pan = !!hit.fighter && b.w !== 'launcher' && panBlocks(hit.fighter, b.dx, b.dz);
    if (!b.local) {
      // someone else's bullet: their client decides what it did (glass too), we only draw where it stopped
      if (b.w !== 'launcher') emit(m, { t: 'thud', x, z, what: pan ? 'pan' : hit.what, net: true });
      continue;
    }
    if (b.w === 'launcher') {
      blast(m, b.f, x - b.dx * 0.3, z - b.dz * 0.3, WEAPONS.launcher.splash ?? 4, b.dmg, WEAPONS.launcher.wallMult, 'launcher', hit.fighter ? hit.fighter.y : b.lv * LEVEL_H);
      continue;
    }
    const shooter = m.fighters[b.f];
    const d = b.dmg * falloff(b.w, b.traveled + hit.t);
    if (pan) emit(m, { t: 'thud', x, z, what: 'pan' });
    else if (hit.fighter && shooter) strike(m, shooter, hit.fighter, d, b.w, x, z);
    else if ((hit.what === 'crate' || hit.what === 'barrel') && shooter) smashCrate(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    else if (hit.what === 'built' && shooter) smashWall(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    // the first bullet through a window breaks the glass and stops there; the next goes through
    else if (hit.what === 'window') breakGlass(m, hit.ref, b.f, true);
    else if (hit.what === 'door' && shooter) smashDoor(m, shooter, hit.ref, d * WEAPONS[b.w].wallMult, x, z);
    else emit(m, { t: 'thud', x, z, what: hit.what });
  }
  m.bullets = keep;
}

/**
 * Bullet damage to the floors, roofs and ramps a bullet aimed up from lower down passes under (or through) within
 * `len`, up to the level it flies at: shooting up at an egg on a tower chips the tower.
 */
function chipUnder(m: Match, b: Bullet, len: number) {
  const shooter = m.fighters[b.f];
  if (!shooter) return;
  m.walls.along(b.x, b.z, b.x + b.dx * len, b.z + b.dz * len, (w) => {
    if (w.id === b.chip || w.k === 'wall' || w.lv > b.lv || (w.k === 'ramp' ? w.lv < b.from : w.lv <= b.from)) return;
    if (gridOf(b.ox) === w.cx && gridOf(b.oz) === w.cz) return;
    if (rayObb(b.x, b.z, b.dx, b.dz, len, w) === Infinity) return;
    b.chip = w.id;
    smashWall(m, shooter, w.id, b.dmg * falloff(b.w, b.traveled) * WEAPONS[b.w].wallMult, b.x, b.z);
  });
}

/**
 * Something this client set off bursts (a launcher egg or a grenade): eggs, walls, crates and barrels nearby take less
 * the farther they are. Never the one who set it off, nor its teammates.
 */
function blast(m: Match, fid: number, x: number, z: number, R: number, dmg: number, wallMult: number, cause: Cause, y = 0) {
  const shooter = m.fighters[fid];
  // a small one (a MIRV's bomblet) says how small, for its bang
  emit(m, R < 4 ? { t: 'boom', f: fid, x: r2(x), z: r2(z), y: r1(y), r: r1(R) } : { t: 'boom', f: fid, x: r2(x), z: r2(z), y: r1(y) });
  if (!shooter) return;
  for (const o of m.fighters) {
    if (o.id === fid || !fighting(o) || Math.abs(o.y - y) > 2.5) continue;
    const d = Math.max(0, Math.hypot(o.x - x, o.z - z) - HIT_R);
    if (d < R) strike(m, shooter, o, dmg * (1 - (0.6 * d) / R), cause, o.x, o.z);
  }
  for (const w of piecesIn(m, x, z, y, R)) {
    const d = Math.max(0, Math.hypot(w.x - x, w.z - z) - WALL_HALF);
    if (d < R) smashWall(m, shooter, w.id, dmg * wallMult * (1 - (0.6 * d) / R), w.x, w.z);
  }
  for (const c of m.map.containers) {
    if (!breakable(c) || m.opened[c.id]) continue;
    const d = Math.max(0, Math.hypot(c.x - x, c.z - z) - 0.7);
    if (d < R) smashCrate(m, shooter, c.id, dmg * wallMult * (1 - (0.6 * d) / R), c.x, c.z);
  }
  for (const s of doorsNear(m, x, z, R)) smashDoor(m, shooter, s.i, dmg * wallMult * (1 - (0.6 * s.d) / R), s.x, s.z);
  shatter(m, fid, x, z, R);
}

/** The shut doors (not vault doors, which never break) within `R` of a point, and how far each is. */
function doorsNear(m: Match, x: number, z: number, R: number) {
  const out: { i: number; d: number; x: number; z: number }[] = [];
  for (const s of m.map.slabs) {
    if (s.vault || m.doors[s.i] !== DOOR_SHUT || Math.abs(s.x - x) > R + 2 || Math.abs(s.z - z) > R + 2) continue;
    const d = Math.hypot(Math.max(0, Math.abs(x - s.x) - s.hw), Math.max(0, Math.abs(z - s.z) - s.hd));
    if (d < R) out.push({ i: s.i, d, x: s.x, z: s.z });
  }
  return out;
}

/** Every window whose glass is within `R` of a blast breaks. */
function shatter(m: Match, by: number, x: number, z: number, R: number) {
  for (const p of m.map.windows) {
    if (m.broken[p.i] || Math.abs(p.x - x) > R + 2 || Math.abs(p.z - z) > R + 2) continue;
    const dx = Math.max(0, Math.abs(x - p.x) - p.hw);
    const dz = Math.max(0, Math.abs(z - p.z) - p.hd);
    if (dx * dx + dz * dz < R * R) breakGlass(m, p.i, by, true);
  }
}

/**
 * A window's glass breaks, on this client's word (`announce`: what it hit, for the network) or on the news. Glass only
 * ever breaks, so whoever breaks it first is right. False when it was already broken.
 */
export function breakGlass(m: Match, i: number, by: number, announce: boolean) {
  if (i < 0 || i >= m.broken.length || m.broken[i]) return false;
  m.broken[i] = true;
  emit(m, announce ? { t: 'glass', f: by, i } : { t: 'glass', f: by, i, net: true });
  return true;
}

/** Damage to a shut door from something this client did. A vault door only takes the dent. */
function smashDoor(m: Match, by: Fighter, i: number, dmg: number, x: number, z: number) {
  const s = m.map.slabs[i];
  if (!s || s.vault || m.doors[i] !== DOOR_SHUT) {
    emit(m, { t: 'thud', x, z, what: 'door' });
    return;
  }
  const d = Math.max(1, Math.round(dmg));
  emit(m, { t: 'smash', f: by.id, kind: 'door', id: i, d, x: r2(x), z: r2(z) });
  damageDoor(m, i, d, by.id, true);
}

/** Door damage from anyone. Only the host (or a solo game) knocks a door off its hinges. */
export function damageDoor(m: Match, i: number, d: number, by: number, announce: boolean) {
  const s = m.map.slabs[i];
  if (!s || s.vault || m.doors[i] !== DOOR_SHUT) return;
  m.doorHp[i] -= d;
  if (m.world && m.doorHp[i] <= 0) setDoor(m, i, DOOR_GONE, by, announce);
}

/**
 * The nearest door within reach of an egg (from where it stands to the doorway) that it can open or shut: not one
 * knocked off its hinges, nor a vault door that's opening or open. -1 for none.
 */
export function doorNear(m: Match, f: Fighter, reach = DOOR_R) {
  let best = -1;
  let bestD = reach;
  for (const s of m.map.slabs) {
    if (Math.abs(s.x - f.x) > reach + 2 || Math.abs(s.z - f.z) > reach + 2) continue;
    const st = m.doors[s.i];
    if (st === DOOR_GONE || st === DOOR_OPENING || (s.vault && st !== DOOR_SHUT)) continue;
    const d = slabGap(s, f.x, f.z);
    if (d <= bestD) {
      best = s.i;
      bestD = d;
    }
  }
  return best;
}

/** How far a point is from a doorway (0 in it). */
export const slabGap = (s: Box, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - s.x) - s.hw), Math.max(0, Math.abs(z - s.z) - s.hd));

/** Opens or shuts a door: here (solo and the host), or by asking the host. */
export function requestDoor(m: Match, f: Fighter, i: number) {
  if (m.world) return toggleDoor(m, i, f.id, f.x, f.z, true);
  const asked = f.pending.get(-1_000_000 - i);
  if (asked !== undefined && m.clock - asked < 1) return false;
  f.pending.set(-1_000_000 - i, m.clock);
  emit(m, { t: 'latch', f: f.id, i });
  return true;
}

/**
 * The host opens or shuts a door for an egg standing at (x, z): it swings open away from that egg, and shut again; a
 * vault door starts grinding open and stays open once it is (see step). One knocked off its hinges stays gone, and a
 * door just moved waits a moment. Returns false when nothing happened.
 */
export function toggleDoor(m: Match, i: number, fid: number, x: number, z: number, announce: boolean) {
  const s = m.map.slabs[i];
  const now = m.doors[i];
  if (!m.world || !s || now === DOOR_GONE || now === DOOR_OPENING || m.clock - m.doorAt[i] < 0.3) return false;
  if (s.vault) {
    if (now !== DOOR_SHUT) return false;
    m.doorT[i] = m.time + VAULT_TIME;
    setDoor(m, i, DOOR_OPENING, fid, announce);
    return true;
  }
  const side = (x - s.x) * s.ox + (z - s.z) * s.oz >= 0 ? 1 : -1;
  setDoor(m, i, now === DOOR_SHUT ? (side > 0 ? DOOR_IN : DOOR_OUT) : DOOR_SHUT, fid, announce);
  return true;
}

/** A door's new state, on this client's word (`announce`, the host) or on the host's. */
export function setDoor(m: Match, i: number, s: number, by: number, announce: boolean) {
  if (i < 0 || i >= m.doors.length || m.doors[i] === s) return;
  m.doors[i] = s;
  m.doorAt[i] = m.clock;
  if (s === DOOR_GONE) m.doorHp[i] = 0;
  for (const f of m.fighters) f.pending.delete(-1_000_000 - i);
  emit(m, announce ? { t: 'door', f: by, i, s } : { t: 'door', f: by, i, s, net: true });
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
  const w = m.walls.get(id);
  if (!w || !m.walls.delete(id)) return;
  emit(m, announce ? { t: 'wallgone', id } : { t: 'wallgone', id, net: true });
  if (!m.world) return;
  // the host also brings down whatever stood on it and now stands on nothing
  touching(m, w, (o) => {
    const fall = m.walls.has(o.id) ? adrift(m, o) : null;
    if (fall) for (const p of fall) removeWall(m, p.id, true);
  });
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
  for (const l of box.loot) if (!m.gone.has(l.id)) putLoot(m, { id: l.id, def: l.def, x: l.x, z: l.z, by: -1, at: m.time });
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
    if (!owned(o) || !fighting(o) || o.y > 2.5) continue;
    const d = Math.max(0, Math.hypot(o.x - box.x, o.z - box.z) - HIT_R);
    if (d < R) hurt(m, o, BARREL.dmg * (1 - (0.6 * d) / R), by, 'barrel', false);
  }
  if (!m.world) return;
  for (const w of piecesIn(m, box.x, box.z, 0, R)) {
    const d = Math.max(0, Math.hypot(w.x - box.x, w.z - box.z) - WALL_HALF);
    if (d < R) damageWall(m, w.id, Math.round(BARREL.dmg * 2 * (1 - (0.6 * d) / R)), true);
  }
  for (const c of m.map.containers) {
    if (c === box || !breakable(c) || m.opened[c.id]) continue;
    const d = Math.max(0, Math.hypot(c.x - box.x, c.z - box.z) - 0.7);
    if (d < R) damageCrate(m, c.id, Math.round(BARREL.dmg * (1 - (0.6 * d) / R)), by, true);
  }
  for (const s of doorsNear(m, box.x, box.z, R)) damageDoor(m, s.i, Math.round(BARREL.dmg * 2 * (1 - (0.6 * s.d) / R)), by, true);
  shatter(m, by, box.x, box.z, R);
}

/** Eight ways round a point, a step apart, for looking for room. */
const AROUND = [
  [1, 0],
  [0.71, 0.71],
  [0, 1],
  [-0.71, 0.71],
  [-1, 0],
  [-0.71, -0.71],
  [0, -1],
  [0.71, -0.71],
] as const;

/** Where a supply drop called from (x, z) comes down: there if it fits, else the nearest place that does. */
export function dropSpot(m: Match, x: number, z: number) {
  const cx = clamp(x, -EDGE, EDGE);
  const cz = clamp(z, -EDGE, EDGE);
  if (dropFits(m.map, cx, cz)) return { x: r1(cx), z: r1(cz) };
  for (let ring = 1; ring <= 16; ring++)
    for (const [ax, az] of AROUND) {
      const tx = r1(cx + ax * ring * 2.5);
      const tz = r1(cz + az * ring * 2.5);
      if (dropFits(m.map, tx, tz)) return { x: tx, z: tz };
    }
  return null;
}

/**
 * The host sends a supply drop to answer a flare fired from (x, z): the next one waiting, to land FLARE_WAIT seconds
 * from now. One flare an egg every ten seconds, and only so many drops a match. Returns the drop, or -1.
 */
export function callDrop(m: Match, fid: number, x: number, z: number) {
  const f = m.fighters[fid];
  if (!m.world || m.ended || !f || f.phase !== 'ground') return -1;
  const last = m.calls.get(fid);
  if (last !== undefined && m.time - last < 10) return -1;
  const id = m.map.flares.find((c) => m.map.containers[c].at === Infinity);
  // fired underground, the drop comes down on the ground over it
  const spot = id === undefined ? null : dropSpot(m, topX(x), z);
  if (id === undefined || !spot) return -1;
  m.calls.set(fid, m.time);
  const at = r1(m.time + FLARE_WAIT);
  const c = m.map.containers[id];
  placeDrop(m.map, c, spot.x, spot.z, at);
  emit(m, { t: 'called', f: fid, c: id, x: c.x, z: c.z, at });
  return id;
}

/** A supply drop the host has called, on its word. */
export function applyCalled(m: Match, fid: number, id: number, x: number, z: number, at: number) {
  const c = m.map.containers[id];
  if (m.world || !c || !c.flare || c.at !== Infinity) return;
  placeDrop(m.map, c, x, z, at);
  emit(m, { t: 'called', f: fid, c: id, x: c.x, z: c.z, at, net: true });
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
  const hit = castRay(m, x, z, dx, dz, dist, f.id, false, false, levelOf(f.y));
  let reach = hit ? Math.max(0, hit.t - 0.6) : dist;
  // a roof we aren't under turns it away: it lands short, off the roof's edge
  if (m.walls.size) reach = offRoofs(m, f, x, z, dx, dz, reach);
  const lx = r2(clampX(x + dx * reach));
  const lz = r2(clamp(z + dz * reach, -EDGE, EDGE));
  const ft = r2(Math.max(0.25, reach / THROW.speed));
  // it comes down on a floor or a ramp no higher than us, else the ground
  const y0 = r1(f.y);
  const ly = m.walls.size ? r1(surfaceAt(m, lx, lz, f.y + 0.5).y) : 0;
  f.throws[k]--;
  f.fireT = THROW.cool;
  f.firedAt = m.clock;
  launch(m, f.id, k, x, z, lx, lz, ft, true, y0, ly);
  emit(m, { t: 'throw', f: f.id, k, x, z, lx, lz, ft, y0, ly });
  if (f.throws[k] <= 0) {
    const next = THROW_IDS.find((t) => f.throws[t] > 0);
    if (next) f.pick = next;
    else switchTo(f, f.guns[0] ? 0 : f.guns[1] ? 1 : SLOT_MELEE);
  }
}

/** Puts something thrown in the air. Every client flies it the same way from the same numbers. */
export function launch(m: Match, fid: number, k: ThrowId, x: number, z: number, lx: number, lz: number, ft: number, local: boolean, y0 = 0, ly = 0) {
  m.tosses.push({ f: fid, k, x, z, lx, lz, t0: m.time, ft, fuse: m.time + Math.max(ft, THROWS[k].fuse ?? 0), local, landed: false, y0, ly });
}

/** Where something thrown is right now, and how high. */
export function tossAt(t: Toss, time: number) {
  const u = clamp((time - t.t0) / t.ft, 0, 1);
  const peak = 1.5 + Math.hypot(t.lx - t.x, t.lz - t.z) * 0.12;
  return { x: t.x + (t.lx - t.x) * u, z: t.z + (t.lz - t.z) * u, y: t.y0 + 1 + (t.ly + 0.25 - t.y0 - 1) * u + 4 * peak * u * (1 - u) };
}

/**
 * How far a throw from (x, z) along (dx, dz) goes before a roof turns it away: one over a square we aren't under,
 * higher than where the throw would come down. It drops off the edge, short of the square.
 */
function offRoofs(m: Match, f: Fighter, x: number, z: number, dx: number, dz: number, reach: number) {
  const mine = roofOver(m, f.x, f.z, f.y);
  for (let tries = 0; tries < 4; tries++) {
    const lx = x + dx * reach;
    const lz = z + dz * reach;
    const roof = roofOver(m, lx, lz, surfaceAt(m, lx, lz, f.y + 0.5).y);
    if (roof < 0 || roof === mine) break;
    const w = m.walls.get(roof)!;
    const t = rayBox(x, z, dx, dz, reach, w.x, w.z, CELL_B / 2, CELL_B / 2);
    reach = Math.max(0, (t === Infinity ? reach : t) - 0.5);
  }
  return reach;
}

function moveTosses(m: Match) {
  if (!m.tosses.length) return;
  const keep: Toss[] = [];
  // bomblets a MIRV splits into this frame fly from the next
  const split: Toss[] = [];
  for (const t of m.tosses) {
    if (!t.landed && m.time >= t.t0 + t.ft) {
      t.landed = true;
      if (t.k === 'flour' || t.k === 'sauce' || t.k === 'jam' || t.k === 'bush') {
        const spec = THROWS[t.k];
        m.zones.push({ k: t.k, x: t.lx, z: t.lz, y: t.ly, r: spec.radius, from: m.time, until: m.time + (spec.time ?? 0), by: t.f });
        emit(m, { t: 'zone', k: t.k, x: t.lx, z: t.lz, y: t.ly });
        continue;
      }
    }
    if (t.k === 'grenade' && m.time >= t.fuse) {
      // the thrower's client decides what it did, like any shot; everyone else hears the bang from it
      const spec = THROWS.grenade;
      if (t.local) blast(m, t.f, t.lx, t.lz, spec.radius, spec.dmg ?? 0, 2.5, 'grenade', t.ly);
      continue;
    }
    if (t.k === 'mirv' && m.time >= t.fuse) {
      // a small bang, then (the grenade itself) a scatter of bomblets that each go off a moment later
      const spec = THROWS.mirv;
      const s = spec.split!;
      if (t.local) blast(m, t.f, t.lx, t.lz, t.small ? s.radius : spec.radius, t.small ? s.dmg : (spec.dmg ?? 0), 1.5, 'mirv');
      if (!t.small) split.push(...bomblets(m, t));
      continue;
    }
    if (t.k === 'stun' && m.time >= t.fuse) {
      flashBang(m, t.f, t.lx, t.lz, t.ly);
      continue;
    }
    if (t.k === 'impulse' && m.time >= t.fuse) {
      pulse(m, t.f, t.lx, t.lz, t.ly);
      continue;
    }
    keep.push(t);
  }
  m.tosses = split.length ? [...keep, ...split] : keep;
}

/**
 * The bomblets a MIRV grenade that went off at (lx, lz) scatters: the same ones on every client, from where it burst
 * and who threw it, each short of anything solid in its way.
 */
function bomblets(m: Match, t: Toss): Toss[] {
  const s = THROWS.mirv.split!;
  const rng = rng32((Math.round(t.lx * 100) * 73856093) ^ (Math.round(t.lz * 100) * 19349663) ^ (t.f * 83492791));
  const out: Toss[] = [];
  for (let k = 0; k < s.n; k++) {
    const a = ((k + rng() * 0.6) / s.n) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const want = s.reach * (0.45 + rng() * 0.55);
    const hit = castRay(m, t.lx, t.lz, dx, dz, want, -1, false, false, levelOf(t.ly));
    const go = hit ? Math.max(0, hit.t - 0.4) : want;
    const ft = r2(0.35 + rng() * 0.3);
    out.push({ f: t.f, k: 'mirv', x: t.lx, z: t.lz, lx: r2(clampX(t.lx + dx * go)), lz: r2(clamp(t.lz + dz * go, -EDGE, EDGE)), t0: m.time, ft, fuse: m.time + ft + 0.15 + rng() * 0.45, local: t.local, landed: false, y0: t.ly, ly: t.ly, small: true });
  }
  return out;
}

/**
 * A stun grenade goes off on every client at once. Each client dazes the eggs it owns (not the thrower's team) that
 * could see the flash: within its radius with nothing solid between, longest up close.
 */
function flashBang(m: Match, fid: number, x: number, z: number, y = 0) {
  const spec = THROWS.stun;
  emit(m, { t: 'stun', f: fid, x, z, net: true });
  for (const o of m.fighters) {
    if (o.id === fid || o.team === m.fighters[fid]?.team || !owned(o) || !fighting(o)) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d >= spec.radius || !clearLine(m, o.x, o.z, x, z, Math.max(levelOf(o.y), levelOf(y)))) continue;
    o.stunT = Math.max(o.stunT, (spec.time ?? 0) * (1 - (0.6 * d) / spec.radius));
    if (o.ai) o.ai.react = Math.max(o.ai.react, o.stunT * 0.5);
  }
}

/**
 * An impulse egg goes off on every client at once. Each client shoves (and nicks) the eggs it owns, all but the
 * thrower's team; the host also shoves the loot nearby and tells everyone where it ended up.
 */
function pulse(m: Match, fid: number, x: number, z: number, y = 0) {
  const spec = THROWS.impulse;
  const R = spec.radius;
  emit(m, { t: 'pulse', f: fid, x, z, net: true });
  for (const o of m.fighters) {
    if (o.id === fid || o.team === m.fighters[fid]?.team || !owned(o) || !fighting(o) || Math.abs(o.y - y) > 2.5) continue;
    const dx = o.x - x;
    const dz = o.z - z;
    const d = Math.hypot(dx, dz);
    if (d >= R + HIT_R) continue;
    const k = 1 - (0.5 * Math.max(0, d - HIT_R)) / R;
    const ux = d > 0.05 ? dx / d : 0;
    const uz = d > 0.05 ? dz / d : 1;
    o.kx += ux * (spec.push ?? 0) * k;
    o.kz += uz * (spec.push ?? 0) * k;
    hurt(m, o, (spec.dmg ?? 0) * k, fid, 'impulse', false);
  }
  if (!m.world || y > 0.5) return;
  for (const l of [...m.loot.values()]) {
    const dx = l.x - x;
    const dz = l.z - z;
    const d = Math.hypot(dx, dz);
    if (d >= R) continue;
    const ux = d > 0.05 ? dx / d : 0;
    const uz = d > 0.05 ? dz / d : 1;
    // out from the middle, short of anything solid
    const want = 1 + 3 * (1 - d / R);
    const hit = castRay(m, l.x, l.z, ux, uz, want + 0.4, -1, false, true);
    const go = hit ? Math.max(0, hit.t - 0.4) : want;
    if (go < 0.2) continue;
    moveLoot(m, l.id, clampX(l.x + ux * go), clamp(l.z + uz * go, -EDGE, EDGE), true);
  }
}

/** Loot moves along the ground: shoved by an impulse egg here (the host), or on the host's word. */
export function moveLoot(m: Match, id: number, x: number, z: number, announce: boolean) {
  const l = m.loot.get(id);
  if (!l) return;
  takeLoot(m, id);
  const p = m.map.stairs.length ? offStairs(m.map, x, z) : { x, z };
  l.x = r1(p.x);
  l.z = r1(p.z);
  putLoot(m, l);
  emit(m, announce ? { t: 'moved', id, x: l.x, z: l.z } : { t: 'moved', id, x: l.x, z: l.z, net: true });
}

/** The newest cloud or puddle of a kind over a point (at height `y`: one on a floor up high, or on the ground), or null. */
export function zoneAt(m: Match, k: Zone['k'], x: number, z: number, y?: number) {
  for (let i = m.zones.length - 1; i >= 0; i--) {
    const zn = m.zones[i];
    if (zn.k === k && zn.until > m.time && (zn.x - x) * (zn.x - x) + (zn.z - z) * (zn.z - z) < zn.r * zn.r && (y === undefined || Math.abs(zn.y - y) < (k === 'flour' ? 3 : 1.5))) return zn;
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

/** One step north, east, south and west (`dir` 0 to 3). */
export const DIR_X = [0, 1, 0, -1] as const;
export const DIR_Z = [1, 0, -1, 0] as const;

/** The way (0 to 3) nearest an aim. */
export const dirOf = (aim: number) => (((Math.round(aim / (Math.PI / 2)) % 4) + 4) % 4);

/** The level an egg stands on, from how high it is (partway up a ramp, the one it's nearer). */
export const levelOf = (y: number) => clamp(Math.floor((y + 0.8) / LEVEL_H), 0, MAX_LEVEL);

/** A piece to build: what, on which grid square, on what level and which way (see Wall). */
export type Slot = { k: PieceKind; cx: number; cz: number; lv: number; dir: number };

/** The wall on side `dir` of a square, as walls are kept: on the south (2) or the west (3) side of a square. */
export function wallSlot(cx: number, cz: number, dir: number, lv: number): Slot {
  if (dir === 0) return { k: 'wall', cx, cz: cz + 1, lv, dir: 2 };
  if (dir === 1) return { k: 'wall', cx: cx + 1, cz, lv, dir: 3 };
  return { k: 'wall', cx, cz, lv, dir };
}

/** What can't share a place: two walls on one side of a square, two ramps on one square and level, or a floor and a roof. */
const slotKey = (s: Slot) => (cellKey(s.cx, s.cz) * 4 + (s.k === 'wall' ? s.dir - 2 : s.k === 'ramp' ? 2 : 3)) * 4 + s.lv;

/** The piece in a slot, if there is one. */
export function pieceIn(m: Match, s: Slot) {
  const key = slotKey(s);
  return m.walls.at(s.cx, s.cz).find((w) => w.dir >= 0 && slotKey(w) === key);
}

/** A piece on the grid, building up from a tenth of its health unless told otherwise. */
export function makePiece(id: number, f: number, k: PieceKind, mat: Mat, cx: number, cz: number, lv: number, dir: number, hp?: number, left?: number, e = 0): Wall {
  const max = MAT_SPECS[mat].hp;
  const start = { hp: hp ?? Math.round(max * BUILD_START), left: left ?? MAT_SPECS[mat].time };
  if (k === 'wall') {
    const south = dir === 2;
    const w: Wall = { id, f, x: (cx + (south ? 0.5 : 0)) * CELL_B, z: (cz + (south ? 0 : 0.5)) * CELL_B, a: south ? 0 : Math.PI / 2, sa: south ? 0 : 1, ca: south ? 1 : 0, hw: WALL_HALF, hd: WALL_THICK, ...start, k, mat, max, cx, cz, lv, dir, e: 0, parts: null, mark: 0 };
    if (e) setEdit(w, e);
    return w;
  }
  return { id, f, x: (cx + 0.5) * CELL_B, z: (cz + 0.5) * CELL_B, a: (dir * Math.PI) / 2, sa: DIR_X[dir], ca: DIR_Z[dir], hw: CELL_B / 2, hd: CELL_B / 2, ...start, k, mat, max, cx, cz, lv, dir, e: 0, parts: null, mark: 0 };
}

/** A wood wall anywhere, at any angle, already built (tests put them where walls came up in matches). */
export function makeWall(id: number, f: number, x: number, z: number, a: number, hp: number): Wall {
  return { id, f, x, z, a, sa: Math.sin(a), ca: Math.cos(a), hw: WALL_HALF, hd: WALL_THICK, hp, k: 'wall', mat: 'wood', max: Math.max(hp, WALL_HP), left: 0, cx: gridOf(x), cz: gridOf(z), lv: 0, dir: -1, e: 0, parts: null, mark: 0 };
}

/**
 * Where the build key puts what it makes for an egg, by the way it faces and how high it stands: a wall on the side of
 * its square it faces, a box on all four, a roof over its square a storey up, and a ramp or a floor on the square in
 * front. A ramp starts from how high our side of that square is (the top of the ramp we're on, the floor we stand
 * on), a floor lies there too but never lower than the first level. Empty where there's no room up there.
 */
export function planPiece(m: Match, f: Fighter, k: Plan, aim = f.aim): Slot[] {
  // nothing is built underground: the grid doesn't reach down there
  if (isDeep(f.x)) return [];
  const q = dirOf(aim);
  const cx = gridOf(f.x);
  const cz = gridOf(f.z);
  const lv = levelOf(f.y);
  if (k === 'box') return [0, 1, 2, 3].map((i) => wallSlot(cx, cz, (q + i) % 4, lv));
  if (k === 'wall') return [wallSlot(cx, cz, q, lv)];
  if (k === 'roof') return [{ k, cx, cz, lv: lv + 1, dir: 0 }];
  const on = f.on >= 0 ? m.walls.get(f.on) : undefined;
  const edge = on && on.k === 'ramp' && on.cx === cx && on.cz === cz ? levelOf(rampY(on, (cx + 0.5 + DIR_X[q] * 0.49) * CELL_B, (cz + 0.5 + DIR_Z[q] * 0.49) * CELL_B)) : lv;
  const fx = cx + DIR_X[q];
  const fz = cz + DIR_Z[q];
  if (k === 'ramp') return edge < MAX_LEVEL ? [{ k, cx: fx, cz: fz, lv: edge, dir: q }] : [];
  return [{ k, cx: fx, cz: fz, lv: Math.max(1, edge), dir: 0 }];
}

/** The box a piece fills, across the island and up from the ground. */
function boxOf(w: Wall) {
  const ext = obbExtent(w);
  const y = w.lv * LEVEL_H;
  return { x0: w.x - ext.x, x1: w.x + ext.x, z0: w.z - ext.z, z1: w.z + ext.z, y0: w.k === 'floor' ? y - 0.2 : y, y1: w.k === 'floor' ? y : w.k === 'roof' ? y + 1.4 : y + LEVEL_H };
}
type Bounds = ReturnType<typeof boxOf>;
const touches = (a: Bounds, b: Bounds) => a.x0 <= b.x1 + 0.06 && b.x0 <= a.x1 + 0.06 && a.z0 <= b.z1 + 0.06 && b.z0 <= a.z1 + 0.06 && a.y0 <= b.y1 + 0.06 && b.y0 <= a.y1 + 0.06;

/** Stands on the ground: a wall or a ramp on the bottom level, or a floor, which stands on posts of its own. */
const grounded = (w: Wall) => w.k === 'floor' || ((w.k === 'wall' || w.k === 'ramp') && w.lv === 0);

/** Each piece touching `w`. */
function touching(m: Match, w: Wall, visit: (o: Wall) => void) {
  const b = boxOf(w);
  const found: Wall[] = [];
  m.walls.near(b.x0 - 0.1, b.z0 - 0.1, b.x1 + 0.1, b.z1 + 0.1, (o) => {
    if (o !== w && touches(b, boxOf(o))) found.push(o);
  });
  for (const o of found) visit(o);
}

/** Can a piece go up: on the island, where nothing else is, and on the ground or against something that is. */
function canBuild(m: Match, w: Wall) {
  if (Math.abs(w.x) > EDGE || Math.abs(w.z) > EDGE || m.walls.size >= MAX_PIECES || pieceIn(m, w)) return false;
  if (grounded(w)) return true;
  let held = false;
  touching(m, w, () => (held = true));
  return held;
}

/** The material to build with: the one picked, or the next with enough left for a piece (which becomes the one picked). */
function matFor(f: Fighter): Mat | null {
  for (let i = 0; i < MATS.length; i++) {
    const at = (f.mat + i) % MATS.length;
    if (f[MATS[at]] >= PIECE_COST) {
      f.mat = at;
      return MATS[at];
    }
  }
  return null;
}

/** The next material, or one by number (plus 10). */
function switchMat(f: Fighter, v: number) {
  f.mat = v >= 10 ? clamp(v - 10, 0, MATS.length - 1) : (f.mat + 1) % MATS.length;
}

/** Builds what the build key makes for an egg (`force` for a box, which needn't wait for the last piece). */
function build(m: Match, f: Fighter, plan: Plan, force = false) {
  const built: Wall[] = [];
  if (f.phase !== 'ground') return built;
  if (f.buildT > 0 && !force) {
    f.queued = plan;
    f.queuedAt = m.clock;
    return built;
  }
  for (const s of planPiece(m, f, plan)) {
    const mat = matFor(f);
    if (!mat) break;
    const w = makePiece(wallId(f.id, f.wallSeq), f.id, s.k, mat, s.cx, s.cz, s.lv, s.dir);
    if (!canBuild(m, w)) continue;
    f.wallSeq++;
    f[mat] -= PIECE_COST;
    m.walls.set(w.id, w);
    built.push(w);
    // a copy, so the news goes out with the piece as built, whatever hits it later this frame
    emit(m, { t: 'wall', wall: { ...w } });
  }
  if (built.length) f.buildT = BUILD_COOL;
  return built;
}

/** Pieces going up build toward their full health (less whatever hit them meanwhile). */
function growPieces(m: Match, dt: number) {
  for (const w of m.walls.values()) {
    if (w.left <= 0) continue;
    const d = Math.min(dt, w.left);
    w.left = Math.max(0, w.left - dt);
    w.hp = Math.min(w.max, w.hp + (d * w.max * (1 - BUILD_START)) / MAT_SPECS[w.mat].time);
    if (w.left <= 0) w.hp = Math.round(w.hp * 100) / 100;
  }
}

/** How high a ramp is at a point over its square. */
export function rampY(w: Wall, x: number, z: number) {
  const u = w.dir === 0 ? z / CELL_B - w.cz : w.dir === 1 ? x / CELL_B - w.cx : w.dir === 2 ? w.cz + 1 - z / CELL_B : w.cx + 1 - x / CELL_B;
  return (w.lv + clamp(u, 0, 1)) * LEVEL_H;
}

/** The highest floor or ramp under a point no higher than `top`, and which piece (else the ground, -1). */
export function surfaceAt(m: Match, x: number, z: number, top: number) {
  let y = 0;
  let id = -1;
  for (const w of m.walls.at(gridOf(x), gridOf(z))) {
    if (w.k !== 'floor' && w.k !== 'ramp') continue;
    const h = w.k === 'floor' ? w.lv * LEVEL_H : rampY(w, x, z);
    if (h <= top && h > y) {
      y = h;
      id = w.id;
    }
  }
  return { y, id };
}

/** The roof over a point at height `y` (no more than a storey above it), or -1. */
export function roofOver(m: Match, x: number, z: number, y: number) {
  let best = -1;
  let low = Infinity;
  for (const w of m.walls.at(gridOf(x), gridOf(z))) {
    if (w.k !== 'roof') continue;
    const h = w.lv * LEVEL_H;
    if (h > y + 0.5 && h <= y + LEVEL_H + 0.5 && h < low) {
      best = w.id;
      low = h;
    }
  }
  return best;
}

/** The pieces a blast at (x, y, z) of radius R might reach. */
function piecesIn(m: Match, x: number, z: number, y: number, R: number) {
  const out: Wall[] = [];
  const r = R + CELL_B;
  m.walls.near(x - r, z - r, x + r, z + r, (w) => {
    const b = boxOf(w);
    if (b.y0 <= y + R * 0.6 && b.y1 >= y - R * 0.6) out.push(w);
  });
  return out;
}

/** Cuts the gap for an edit (or fills it back in): the wall's two sides either side of it. */
function setEdit(w: Wall, e: number) {
  w.e = e;
  if (!e) {
    w.parts = null;
    return;
  }
  const half = (w.hw - GAP) / 2;
  const off = GAP + half;
  // along the wall is (ca, -sa)
  w.parts = [-1, 1].map((k) => ({ x: w.x + w.ca * off * k, z: w.z - w.sa * off * k, sa: w.sa, ca: w.ca, hw: half, hd: w.hd }));
}

/** The wall of ours the edit key works on: the side of our square we face, else one of ours just ahead. */
export function editable(m: Match, f: Fighter) {
  const lv = levelOf(f.y);
  const side = pieceIn(m, wallSlot(gridOf(f.x), gridOf(f.z), dirOf(f.aim), lv));
  if (side && side.f === f.id) return side;
  const dx = Math.sin(f.aim);
  const dz = Math.cos(f.aim);
  let best: Wall | undefined;
  let near = 2.6;
  m.walls.along(f.x, f.z, f.x + dx * near, f.z + dz * near, (w) => {
    if (w.k !== 'wall' || w.lv !== lv || w.f !== f.id) return;
    const t = rayObb(f.x, f.z, dx, dz, 2.6, w);
    if (t < near) {
      best = w;
      near = t;
    }
  });
  return best;
}

/** Cuts a doorway into the wall of ours in front of us, then a window in place of it, then fills it back in. */
function edit(m: Match, f: Fighter) {
  if (f.editT > 0 || f.phase !== 'ground') return;
  const w = editable(m, f);
  if (!w) return;
  const e = (w.e + 1) % 3;
  setEdit(w, e);
  f.editT = EDIT_COOL;
  emit(m, { t: 'edit', f: f.id, id: w.id, e });
}

/** An edit someone else made to a wall of theirs. Returns false for one that isn't theirs (or isn't here). */
export function applyEdit(m: Match, fid: number, id: number, e: number) {
  const w = m.walls.get(id);
  if (!w || w.k !== 'wall' || w.f !== fid) return false;
  if (w.e !== e) setEdit(w, e);
  emit(m, { t: 'edit', f: fid, id, e, net: true });
  return true;
}

/**
 * A piece someone else built. The host turns one down where another already stands (two eggs built in one place at
 * once): it is gone for everyone, as if it broke. Returns false for one turned down, or already here (or gone).
 */
export function addWall(m: Match, wall: Wall) {
  if (m.walls.has(wall.id) || m.goneWalls.has(wall.id)) return false;
  if (m.world && wall.dir >= 0 && pieceIn(m, wall)) {
    m.goneWalls.add(wall.id);
    emit(m, { t: 'wallgone', id: wall.id });
    return false;
  }
  m.walls.set(wall.id, wall);
  emit(m, { t: 'wall', wall, net: true });
  return true;
}

/**
 * The pieces joined to `w` when none of them reaches the ground (they would fall), else null. Gives up (and says they
 * stand) past a few hundred, which no tower reaches.
 */
function adrift(m: Match, w: Wall): Wall[] | null {
  const seen = new Set<Wall>([w]);
  const queue = [w];
  while (queue.length) {
    const p = queue.pop()!;
    if (grounded(p) || seen.size > 300) return null;
    touching(m, p, (o) => {
      if (seen.has(o)) return;
      seen.add(o);
      queue.push(o);
    });
  }
  return [...seen];
}

// -------------------------------------------------------------------------------------------------------------------
// Loot.

/**
 * Would an egg take this? Guns need an empty slot, and a melee weapon in place of anything but the spatula, unless
 * it's a swap the player asked for. A scope we don't carry yet (we keep every one); a backpack only if it's better
 * than the one we have, and a helmet or vest too, unless the player asks for a worse one.
 */
export function wants(f: Fighter, def: LootDef, manual: boolean) {
  switch (def.kind) {
    case 'gun':
      return manual || f.guns[0] === null || f.guns[1] === null;
    case 'melee':
      return def.w !== f.melee && (manual || f.melee === 'spatula');
    case 'helmet':
      return def.lv > f.helmet || (manual && def.lv !== f.helmet);
    case 'vest':
      return def.lv > f.vest || (manual && def.lv !== f.vest);
    case 'throw':
      return f.throws[def.w] < throwCap(def.w, f.pack);
    case 'ammo':
      return f.ammo[def.a] < ammoCap(def.a, f.pack);
    case 'use':
      return f.items[def.w] < useCap(def.w, f.pack);
    case 'scope':
      return !hasScope(f, def.lv);
    case 'pack':
      return def.lv > f.pack;
    case 'ghillie':
      return !f.ghillie;
    case 'wood':
    case 'stone':
    case 'metal':
      return f[def.kind] < MAT_MAX;
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
    if (d <= r * r && d < bestD && inReach(m, f, c)) {
      best = c.id;
      bestD = d;
    }
  }
  return best;
}

/** Nothing solid between an egg and a container but the container itself: no reaching through a wall or a shut door. */
function inReach(m: Match, f: Fighter, c: Container) {
  const d = Math.hypot(c.x - f.x, c.z - f.z);
  if (d < 0.05) return true;
  const hit = castRay(m, f.x, f.z, (c.x - f.x) / d, (c.z - f.z) / d, d, f.id, false, false, 0, 'shut');
  return !hit || (hit.what === 'chest' && hit.ref === c.id);
}

/** Loot and containers are looked up by where they lie, in cells this many meters square. */
const SPOT = 16;
const SPOTS = Math.ceil((2 * HALF) / SPOT);
const spotOf = (v: number) => Math.max(0, Math.min(SPOTS - 1, Math.floor((v + HALF) / SPOT)));
/** The cell along x a point lies in: underground, the ground over it's (the distance tells the two apart). */
const spotX = (x: number) => spotOf(topX(x));
const lootCells = new WeakMap<Match, { seen: number; cells: LootItem[][] }>();

/**
 * Loot by the cell it lies in: kept up as loot comes and goes here (see putLoot and takeLoot), and worked out afresh
 * after any other change (a test that changes the loot itself).
 */
function lootGrid(m: Match) {
  let got = lootCells.get(m);
  const changes = m.loot instanceof LootMap ? m.loot.changes : -1;
  if (!got || changes < 0 || got.seen !== changes) {
    got = { seen: changes, cells: Array.from({ length: SPOTS * SPOTS }, () => []) };
    for (const l of m.loot.values()) got.cells[spotX(l.x) + spotOf(l.z) * SPOTS].push(l);
    lootCells.set(m, got);
  }
  return got;
}

/** Whether the grid saw every change to the loot until the one about to be made (so it can follow it). */
const inStep = (m: Match, got: { seen: number } | undefined): got is { seen: number; cells: LootItem[][] } => !!got && m.loot instanceof LootMap && got.seen === m.loot.changes;

/** Puts loot on the ground. */
function putLoot(m: Match, l: LootItem) {
  if (m.loot.has(l.id)) takeLoot(m, l.id);
  const got = lootCells.get(m);
  const follow = inStep(m, got);
  m.loot.set(l.id, l);
  if (!follow) return;
  got.cells[spotX(l.x) + spotOf(l.z) * SPOTS].push(l);
  got.seen++;
}

/** Takes loot off the ground. */
function takeLoot(m: Match, id: number) {
  const l = m.loot.get(id);
  if (!l) return;
  const got = lootCells.get(m);
  const follow = inStep(m, got);
  m.loot.delete(id);
  if (!follow) return;
  const cell = got.cells[spotX(l.x) + spotOf(l.z) * SPOTS];
  const at = cell.indexOf(l);
  if (at >= 0) cell.splice(at, 1);
  got.seen++;
}

/** Each piece of loot in the cells within `r` of a point: what an egg walks over, and what a computer egg looks for. */
function lootNear(m: Match, x: number, z: number, r: number, visit: (l: LootItem) => void) {
  const { cells } = lootGrid(m);
  const tx = topX(x);
  for (let cz = spotOf(z - r); cz <= spotOf(z + r); cz++)
    for (let cx = spotOf(tx - r); cx <= spotOf(tx + r); cx++) {
      const cell = cells[cx + cz * SPOTS];
      // backwards, so a pickup taken along the way doesn't skip the next
      for (let i = cell.length - 1; i >= 0; i--) if (i < cell.length) visit(cell[i]);
    }
}

const boxCells = new WeakMap<GameMap, { of: Container[]; n: number; cells: number[][] }>();
/** The containers (but supply drops, which come down later) in the cells within `r` of a point. */
function containersNear(map: GameMap, x: number, z: number, r: number, visit: (c: Container) => void) {
  let got = boxCells.get(map);
  if (!got || got.of !== map.containers || got.n !== map.containers.length) {
    const cells: number[][] = Array.from({ length: SPOTS * SPOTS }, () => []);
    for (const c of map.containers) if (c.kind !== 'supply') cells[spotX(c.x) + spotOf(c.z) * SPOTS].push(c.id);
    got = { of: map.containers, n: map.containers.length, cells };
    boxCells.set(map, got);
  }
  const tx = topX(x);
  for (let cz = spotOf(z - r); cz <= spotOf(z + r); cz++) for (let cx = spotOf(tx - r); cx <= spotOf(tx + r); cx++) for (const id of got.cells[cx + cz * SPOTS]) visit(map.containers[id]);
}

/**
 * What the interact key would do right now: open a chest (or a fridge, a locker and the like), pick something up (a
 * gun or melee weapon swaps), or open or shut a door, whichever is nearest (a door only when it is clearly nearer). By
 * a knocked teammate, holding it down revives them, before anything else. Knocked down, nothing.
 */
export function prompt(m: Match, f: Fighter): { chest: number } | { item: LootItem; swap: boolean } | { door: number } | { revive: number } | null {
  if (f.phase !== 'ground' || f.down) return null;
  const mate = f.reviving >= 0 ? m.fighters[f.reviving] : downMate(m, f);
  if (mate) return { revive: mate.id };
  if (f.y > 1) return null;
  // not something we just asked the host for (an ask it turned down expires), nor what we just put down
  const item = nearestLoot(m, f, PICK_R, (l) => wants(f, l.def, true) && !asking(m, f, l.id) && !(l.by === f.id && m.time - l.at < 3));
  const chest = nearestChest(m, f);
  const door = doorNear(m, f);
  const itemD = item ? Math.hypot(item.x - f.x, item.z - f.z) : Infinity;
  const chestD = chest >= 0 ? Math.hypot(m.map.containers[chest].x - f.x, m.map.containers[chest].z - f.z) : Infinity;
  if (door >= 0 && !asking(m, f, -1_000_000 - door) && slabGap(m.map.slabs[door], f.x, f.z) + 1 < Math.min(itemD, chestD)) return { door };
  if (chest >= 0 && chestD < itemD) return { chest };
  if (!item) return null;
  const def = item.def;
  return { item, swap: (def.kind === 'gun' && f.guns[0] !== null && f.guns[1] !== null) || (def.kind === 'melee' && f.melee !== 'spatula') || (def.kind === 'helmet' && f.helmet > 0) || (def.kind === 'vest' && f.vest > 0) };
}

/** True while a pickup request is waiting for the host's answer (it gives up after a second). */
const asking = (m: Match, f: Fighter, id: number) => {
  const at = f.pending.get(id);
  return at !== undefined && m.clock - at < 1;
};

function interact(m: Match, f: Fighter) {
  const p = prompt(m, f);
  // a revive is the key held down (see reviveStep)
  if (!p || 'revive' in p) return;
  if ('chest' in p) requestOpen(m, f, p.chest);
  else if ('door' in p) requestDoor(m, f, p.door);
  else requestTake(m, f, p.item, true);
}

function autoPickup(m: Match, f: Fighter) {
  if (f.y > 1) return;
  lootNear(m, f.x, f.z, AUTO_R, (l) => {
    if (Math.abs(l.x - f.x) > AUTO_R || Math.abs(l.z - f.z) > AUTO_R) return;
    if ((l.x - f.x) * (l.x - f.x) + (l.z - f.z) * (l.z - f.z) > AUTO_R * AUTO_R) return;
    // never back up what we put down ourselves, swapped or left for a teammate (the key still takes it, a moment on)
    if (l.by === f.id) return;
    if (wants(f, l.def, false)) requestTake(m, f, l);
  });
}

function requestTake(m: Match, f: Fighter, l: LootItem, key = false) {
  const asked = f.pending.get(l.id);
  if (asked !== undefined && m.clock - asked < 1) return;
  if (key) f.keyAsk = l.id;
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
  takeLoot(m, id);
  m.gone.add(id);
  if (owned(f)) give(m, f, l.def, f.keyAsk === id);
  emit(m, announce ? { t: 'took', f: fid, id, def: l.def } : { t: 'took', f: fid, id, def: l.def, net: true });
  return true;
}

/** The host says someone got a pickup. If it's ours, it goes in our pockets. */
export function applyTook(m: Match, fid: number, id: number, def: LootDef) {
  takeLoot(m, id);
  m.gone.add(id);
  const f = m.fighters[fid];
  if (!f) return;
  f.pending.delete(id);
  if (owned(f)) {
    if (f.phase === 'ground') give(m, f, def, f.keyAsk === id);
    // cracked while the host was saying yes: it goes back down where we fell, for anyone to pick up
    else dropItem(m, f, def, f.x, f.z);
  }
  emit(m, { t: 'took', f: fid, id, def, net: true });
}

/** Puts a pickup in an egg's pockets. Whatever doesn't fit goes back on the ground at its feet. */
function give(m: Match, f: Fighter, def: LootDef, key: boolean) {
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
    case 'scope': {
      // kept with the rest, and looked through at once when it's the best yet
      if (hasScope(f, def.lv)) {
        dropItem(m, f, def, f.x, f.z);
        break;
      }
      const best = bestScope(f);
      f.scopes |= 1 << (def.lv - 1);
      if (def.lv > best) f.scope = def.lv;
      break;
    }
    case 'pack':
      if (def.lv > f.pack) {
        if (f.pack > 0) dropItem(m, f, { kind: 'pack', lv: f.pack }, f.x, f.z);
        f.pack = def.lv;
      } else dropItem(m, f, def, f.x, f.z);
      break;
    case 'helmet':
    case 'vest': {
      // a better level goes on, a worse one only when asked for with the key, and the old one comes off
      const old = f[def.kind];
      if (def.lv === old || (def.lv < old && !key)) dropItem(m, f, def, f.x, f.z);
      else {
        f[def.kind] = def.lv;
        if (old > 0) dropItem(m, f, { kind: def.kind, lv: old }, f.x, f.z);
      }
      break;
    }
    case 'ghillie':
      if (f.ghillie) dropItem(m, f, def, f.x, f.z);
      f.ghillie = true;
      break;
    case 'wood':
    case 'stone':
    case 'metal': {
      const mat = def.kind;
      f[mat] = fill(f[mat], MAT_MAX, def.n, (n) => ({ kind: mat, n }));
      break;
    }
  }
}

/** Puts something an egg owned here dropped on the ground, numbered from that egg's own range. */
function dropItem(m: Match, f: Fighter, def: LootDef, x: number, z: number) {
  // never down a stairway, where stepping in to pick it up would take us to the other level
  const p = m.map.stairs.length ? offStairs(m.map, x, z) : { x, z };
  const item: LootItem = { id: dropId(f.id, f.dropSeq++), def, x: r1(p.x), z: r1(p.z), by: f.id, at: m.time };
  putLoot(m, item);
  emit(m, { t: 'drop', item });
}

/** Something another client dropped. */
export function addLoot(m: Match, item: LootItem) {
  if (m.loot.has(item.id) || m.gone.has(item.id)) return;
  putLoot(m, item);
  emit(m, { t: 'drop', item, net: true });
}

// -------------------------------------------------------------------------------------------------------------------
// Remote eggs.

export function flagsOf(f: Fighter) {
  const healing = f.using === 'bandage' || f.using === 'medkit';
  const shielding = f.using === 'mini' || f.using === 'shield';
  return (
    (f.spin > 0 ? F_SPIN : 0) |
    (f.using === 'smoothie' ? F_SMOOTHIE : 0) |
    (f.using === 'tart' ? F_TART : 0) |
    (f.reloadT > 0 ? F_RELOAD : 0) |
    (healing ? F_HEALING : 0) |
    (shielding ? F_SHIELDING : 0) |
    (f.shield > 0 ? F_SHIELDED : 0) |
    (f.hitT > 0 ? F_HIT : 0) |
    (MELEE[f.melee].blocks ? F_PAN : 0) |
    (f.boost > 0 ? F_BOOST : 0) |
    (f.using === 'coffee' ? F_DRINKING : 0) |
    (f.ghillie ? F_GHILLIE : 0) |
    (f.stunT > 0 ? F_STUN : 0) |
    (f.down ? F_DOWN : 0) |
    (f.reviving >= 0 ? F_REVIVE : 0)
  );
}

/** A position report for an egg another client owns. */
export function applyState(m: Match, f: Fighter, s: { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: Held | null; r: number; flags: number; helmet: number; vest: number; scope?: number; scopes?: number }) {
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
  // down a stairway or up one: from here on, not on the way from there
  const last = snaps[snaps.length - 1];
  if (last && isDeep(last.x) !== isDeep(s.x) && f.phase === s.phase) {
    snaps.length = 0;
    emit(m, { t: 'stairs', f: f.id, down: isDeep(s.x), net: true });
  }
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
  f.helmet = s.helmet;
  f.vest = s.vest;
  // the scopes it carries and the one it looks through, so whoever watches it sees what it sees
  f.scopes = s.scopes ?? 0;
  f.scope = hasScope(f, s.scope ?? 0) ? (s.scope ?? 0) : 0;
  f.ghillie = (s.flags & F_GHILLIE) !== 0;
  // knocked down, or back up (the news of how may still be on its way, or have just come ahead of this report), and
  // reviving or done (a report from before the news it started may still come in; one with no news of it, for someone
  // who came in late, has it start now on the knocked teammate nearest)
  const down = (s.flags & F_DOWN) !== 0;
  if (down !== f.down && m.clock - f.flipAt > 1) {
    f.down = down;
    if (!down) {
      f.knockBy = -1;
      f.knockCause = null;
    }
  }
  if (!(s.flags & F_REVIVE)) {
    if (m.clock - f.reviveAt > 0.5) f.reviving = -1;
  } else if (f.reviving < 0 && !m.world && m.clock - f.reviveAt > 1) {
    const o = downMate(m, f, REVIVE_R + 1);
    if (o) {
      f.reviving = o.id;
      f.reviveAt = m.clock;
    }
  }
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
function follow(m: Match, f: Fighter, dt: number) {
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
  if (f.phase === 'ground' && f.y < 0.5) {
    f.bush = coverOf(m, f.x, f.z);
    f.inside = buildingAt(m.map, f.x, f.z);
    f.wet = waterAt(m.map, f.x, f.z);
    f.warm = fireAt(m.map, f.x, f.z) >= 0;
    f.stillT = Math.hypot(f.vx, f.vz) < 0.4 ? f.stillT + dt : 0;
  } else {
    f.bush = -1;
    f.inside = -1;
    f.wet = false;
    f.warm = false;
  }
}

function place(f: Fighter, speed: Snap, x: number, z: number, y: number, aim: number) {
  f.x = clampX(x, 30);
  f.z = clamp(z, -EDGE - 30, EDGE + 30);
  f.y = y;
  f.aim = aim;
  f.vx = speed.vx;
  f.vz = speed.vz;
}

// -------------------------------------------------------------------------------------------------------------------
// Computer players.

/** The distance each gun likes to fight at. */
const PREFER: Record<WeaponId, number> = { pistol: 14, revolver: 18, flare: 0, smg: 10, micro: 7, hsmg: 9, rifle: 20, burst: 22, marksman: 26, scout: 30, lmg: 18, minigun: 14, shotgun: 5, auto: 6, double: 4, sniper: 34, crossbow: 28, launcher: 18 };
const MELEE_PREFER = 1.2;
const GUN_VALUE: Record<WeaponId, number> = { pistol: 10, revolver: 18, flare: 5, smg: 20, micro: 18, hsmg: 22, rifle: 30, burst: 29, marksman: 27, scout: 26, lmg: 27, minigun: 27, shotgun: 26, auto: 25, double: 22, sniper: 22, crossbow: 18, launcher: 18 };
/** What a gun is worth to a computer egg. A flare gun is kept until it's fired (then the hand is free again). */
const gunValue = (g: Gun | null) => (g ? (WEAPONS[g.w].call ? 60 : GUN_VALUE[g.w] + g.r * 7) : -1);

/**
 * Hidden from a viewer more than a few steps away: in a bush or cornfield until it fires, in a ghillie suit keeping
 * still and quiet out on the grass, or in a flour cloud the viewer is outside of.
 */
export function concealed(m: Match, f: Fighter, viewer: Fighter | undefined) {
  if (!viewer || f === viewer) return false;
  if (Math.hypot(f.x - viewer.x, f.z - viewer.z) <= GHILLIE.near) return false;
  if (f.bush >= 0 && m.clock - f.firedAt > 1.2) return true;
  if (camouflaged(m, f)) return true;
  // under a roof someone built, from anyone not under the same one, until it fires
  if (m.walls.size && m.clock - f.firedAt > 1.2) {
    const roof = roofOver(m, f.x, f.z, f.y);
    if (roof >= 0 && roof !== roofOver(m, viewer.x, viewer.z, viewer.y)) return true;
  }
  if (!m.zones.length) return false;
  const cloud = zoneAt(m, 'flour', f.x, f.z);
  return !!cloud && cloud !== zoneAt(m, 'flour', viewer.x, viewer.z);
}

/**
 * How long a screen keeps showing an egg once something says to hide it (a bush, a cornfield, flour, a roof, a
 * ghillie suit, the wall beside the doorway we peek through), and keeps it hidden once that says to show it, in
 * seconds: an egg on the edge of one, or a step either side of where it starts to show, never blinks out or in. One
 * that has just fired shows at once.
 */
export const SEEN_HOLD = { hide: 0.4, show: 0.15 };

/** What a screen shows of an egg: `on` while it's drawn, and how long whatever hides it has said otherwise (`t`). */
export type Seen = { on: boolean; t: number };

/**
 * One frame (`dt` seconds) of what a screen shows of an egg that whatever hides it says to `hide` or not (see
 * SEEN_HOLD); `now` makes the change at once (an egg that has just fired, or one that has only now come into view).
 * Whether it's drawn.
 */
export function seenStep(s: Seen, hide: boolean, dt: number, now = false) {
  if (s.on !== hide) s.t = 0;
  else if (now || (s.t += dt) >= (hide ? SEEN_HOLD.hide : SEEN_HOLD.show)) {
    s.on = !hide;
    s.t = 0;
  }
  return s.on;
}

/** In a ghillie suit, still and quiet on the grass: hard to make out from more than a few steps away. */
export const camouflaged = (m: Match, f: Fighter) => f.ghillie && f.phase === 'ground' && f.y < 0.5 && f.stillT >= GHILLIE.still && m.clock - f.firedAt > 1.2 && grassAt(m.map, f.x, f.z);

/**
 * Can `a` see `b`? Cover hides an egg that keeps still and quiet until you're close; walls and flour hide everyone,
 * and an egg up high sees over what's lower than it (see castRay).
 */
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
  return clearBetween(m, a, b);
}

function hasAmmo(f: Fighter, g: Gun | null) {
  return !!g && (g.mag > 0 || (f.ammo[WEAPONS[g.w].ammo] > 0 && !WEAPONS[g.w].call));
}

/** A gun to fight with: loaded, and not a flare gun. */
const fightGun = (f: Fighter, g: Gun | null) => hasAmmo(f, g) && !WEAPONS[g!.w].call;

const scopedGun = (g: Gun | null) => !!g && WEAPONS[g.w].cls === 'sniper';

/** What one pull of the trigger lets fly if it all lands: every pellet of every shot of a burst, or a swing. */
function pullOf(f: Fighter, g: Gun | null) {
  if (!g) return MELEE[f.melee].dmg;
  const spec = WEAPONS[g.w];
  return damageOf(g.w, g.r) * spec.pellets * (spec.burst?.n ?? 1);
}

/** What a list of [clock, damage] let fly in the last POUR_T seconds (dropping what's older). */
function lately(m: Match, p: [number, number][]) {
  while (p.length && m.clock - p[0][0] >= POUR_T) p.shift();
  let sum = 0;
  for (const [, d] of p) sum += d;
  return sum;
}

/** A shot or swing a computer egg let fly, on its own tally and its target's. */
function pour(m: Match, ai: Ai, d: number) {
  lately(m, ai.poured);
  ai.poured.push([m.clock, d]);
  ai.pouredAt = m.clock;
  const t = m.fighters[ai.target];
  if (!t) return;
  lately(m, t.incoming);
  t.incoming.push([m.clock, d]);
}

/**
 * Room for another pull of the trigger: what we let fly in the last POUR_T seconds and this pull stay within the
 * level's `pour`, and what every computer egg let fly at the target within FOCUS. A pull bigger than the pour on its
 * own (a pump shotgun on easy, a sniper) needs a quiet as much longer than POUR_T before it.
 */
function room(m: Match, f: Fighter, ai: Ai, L: LevelSpec, g: Gun | null, tgt: Fighter) {
  const pull = pullOf(f, g);
  if (pull > L.pour && m.clock - ai.pouredAt < (POUR_T * pull) / L.pour) return false;
  const mine = lately(m, ai.poured);
  const all = lately(m, tgt.incoming);
  return (!mine || mine + pull <= L.pour) && (!all || all + pull <= FOCUS);
}

/** A loaded gun other than `g` for closer in than a scope, or null. */
const closerGun = (f: Fighter, g: Gun | null) => f.guns.find((x) => x && x !== g && !scopedGun(x) && fightGun(f, x)) ?? null;

/** The slot to fight with at a distance: the gun that likes it best, or the melee weapon. */
function bestSlot(f: Fighter, d: number) {
  let best = SLOT_MELEE;
  // melee only when no gun has a shot left, or a weak one at point blank
  let score = d < 2.4 ? -0.9 + (f.melee === 'spatula' ? 0 : 0.4) : -Infinity;
  f.guns.forEach((g, i) => {
    if (!fightGun(f, g)) return;
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
  inp.hold = false;
  // in teams, someone on ours who isn't a computer egg leads: off the bus when they jump, and down to where they glide
  const lead = m.mode === 'solo' ? null : leadOf(m, f);
  if (f.phase === 'bus') {
    if (lead ? lead.phase !== 'bus' : m.time >= ai.jumpAt) inp.jump = true;
    return;
  }
  if (f.phase === 'drop') {
    // gliding (from the bus, or a bounce pad on the way somewhere): steer for where we meant to go
    ai.pad = -1;
    if (lead && lead.phase !== 'out' && m.time - f.dropAt < 30) {
      const k = mateIndex(m, f);
      ai.gx = lead.x + DIR_X[k % 4] * 3;
      ai.gz = lead.z + DIR_Z[k % 4] * 3;
    }
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
  ai.hideT = Math.max(0, ai.hideT - dt);
  ai.boxT = Math.max(0, ai.boxT - dt);
  ai.outT = Math.max(0, ai.outT - dt);
  ai.rampCool -= dt;
  ai.harvestCool -= dt;
  ai.pingCool -= dt;
  ai.shareCool -= dt;
  ai.steps = -1;
  // a fight on the way doesn't make it forget what a teammate asked it for
  if (ai.askK && ai.target >= 0) ai.askUntil = Math.max(ai.askUntil, m.time + 10);
  // knocked down: call for help (once a knock), crawl to the team, never shoot
  if (f.down) {
    if (ai.cried !== f.downAt) {
      ai.cried = f.downAt;
      inp.emote = { k: 'help', x: f.x, z: f.z };
    }
    return crawlTo(m, f, ai, dt);
  }
  // pleased with the first kill, and every other one after
  if (f.kills > ai.cheered) {
    if (f.kills % 2) inp.emote = { k: 'happy', x: f.x, z: f.z };
    ai.cheered = f.kills;
  }
  // who has been hitting us: two eggs at once is a crossfire
  if (f.lastBy >= 0 && f.lastByAt > ai.foeAt) {
    if (f.lastBy !== ai.foe) {
      ai.foe2 = ai.foe;
      ai.foe2At = ai.foeAt;
      ai.foe = f.lastBy;
    }
    ai.foeAt = f.lastByAt;
  }
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = 0.2 + m.rng() * 0.12;
    decide(m, f, ai, L);
  }
  // reviving a teammate: keep at it, unless an egg comes close or it gets too hot
  if (f.reviving >= 0) {
    const t = ai.target >= 0 ? m.fighters[ai.target] : undefined;
    const close = !!t && upright(t) && Math.hypot(t.x - f.x, t.z - f.z) < 14;
    if (!close && !(f.hitT > 0 && f.hp + f.shield < 60)) {
      inp.hold = true;
      inp.aim = f.aim;
      return;
    }
  }

  const s = m.storm;
  const outside = Math.hypot(topX(f.x) - s.x, f.z - s.z) > s.r - 1;
  if (outside) ai.hideT = 0;
  // hot sauce or jam underfoot: out of it the shortest way
  const burn = m.zones.length ? (zoneAt(m, 'sauce', f.x, f.z) ?? zoneAt(m, 'jam', f.x, f.z)) : null;
  // hiding in a bush we threw down: still there, and still standing (or on our way to it)
  const hiding = ai.hideT > 0 && !!zoneAt(m, 'bush', ai.hideX, ai.hideZ);
  const away = (zn: Zone) => {
    // right in the middle of it, out the way we were going
    const mid = Math.hypot(f.x - zn.x, f.z - zn.z) < 0.05;
    const dx = mid ? ai.gx - f.x : f.x - zn.x;
    const dz = mid ? ai.gz - f.z + 0.01 : f.z - zn.z;
    const d = Math.hypot(dx, dz) || 1;
    steer(m, f, ai, zn.x + (dx / d) * (zn.r + 2.5), zn.z + (dz / d) * (zn.r + 2.5), dt, 0);
  };
  // in the box we built (we may shoot out of it, but stay put), or on our way out of it
  const boxed = ai.boxT > 0 && gridOf(f.x) === ai.boxCx && gridOf(f.z) === ai.boxCz;
  const leaving = ai.outT > 0 && goOut(f, ai);
  // a roof on the box too (but on easy), so nothing thrown gets in and nobody sees in
  if (boxed && !ai.roofed && f.buildT <= 0 && m.level !== 'easy') {
    inp.piece = 'roof';
    ai.roofed = true;
  }
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
      ai.err = clamp((m.rng() * 2 - 1) * L.err * (0.6 + moving * 0.8) * (1 + (Math.max(0, d - 20) / 10) * L.far), -MISS, MISS);
    }
    // a throw away from the target (a bush to hide in) turns that way instead
    const aside = !!ai.toss && !Number.isNaN(ai.tossA);
    // dazed by a stun grenade, it aims wide and turns slowly
    const daze = f.stunT > 0 ? 3 : 1;
    const turn = angleDiff(aside ? ai.tossA : ideal + ai.err * daze, f.aim);
    const maxTurn = (L.turn * dt) / daze;
    inp.aim = f.aim + clamp(turn, -maxTurn, maxTurn);
    ai.steady = scoped && f.fireT <= 0 && f.hitT <= 0 && Math.abs(angleDiff(inp.aim, ideal + ai.err)) < 0.03 ? ai.steady + dt : 0;
    // on the aim it means to take, miss and all (so a wide aim far off really does miss, and doesn't just wait)
    const aligned = Math.abs(angleDiff(inp.aim, ideal + ai.err)) < 0.12 + (g ? WEAPONS[g.w].spread : 0.4) && (!scoped || ai.steady >= L.settle);
    // a minigun keeps up its fire rather than bursts, or it would never spin up
    const spinner = !!g && !!WEAPONS[g.w].spin;
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
      if (f.slot === SLOT_THROW && f.pick === ai.toss && Math.abs(angleDiff(inp.aim, aside ? ai.tossA : ideal)) < 0.25 && ai.react <= 0) inp.fire = true;
      if (ai.toss === 'bush' && f.throws.bush < ai.tossHad) {
        // it's away: hide where it comes down
        const t = lastToss(m, f.id, 'bush');
        if (t) {
          ai.hideT = 9;
          ai.hideX = t.lx;
          ai.hideZ = t.lz;
        }
      }
      if (f.throws[ai.toss] < ai.tossHad || f.throws[ai.toss] <= 0 || ai.tossT <= 0) ai.toss = null;
    } else {
      if (L.toss > 0 && ai.tossCool <= 0 && ai.react <= 0) {
        // something to throw and a target in reach: an impulse egg to shove off one too close, a stun grenade to daze
        // one in the open before pushing in, or a bomb to lob (always at one behind cover); hurt, a bush to back off
        // into or flour to vanish in. Then wait a while, or if nothing fits, look again in a moment.
        const bomb: ThrowId | null = f.throws.grenade > 0 ? 'grenade' : f.throws.mirv > 0 ? 'mirv' : f.throws.sauce > 0 ? 'sauce' : f.throws.jam > 0 ? 'jam' : null;
        const cool = () => (ai.tossCool = L.toss * (0.7 + m.rng() * 0.6));
        if (f.throws.impulse > 0 && d >= THROW.min && d < 6.5) {
          startToss(ai, f, 'impulse', d);
          cool();
        } else if (f.throws.stun > 0 && d >= 10 && d <= 18 && tgt.stunT <= 0 && clearBetween(m, f, tgt) && m.rng() < 0.5) {
          startToss(ai, f, 'stun', d);
          cool();
        } else if (bomb && d >= 5 && d <= THROW.max + 1 && (!clearBetween(m, f, tgt) || m.rng() < 0.6)) {
          startToss(ai, f, bomb, d);
          cool();
        } else if (f.throws.bush > 0 && f.hp + f.shield < 50 && d > 8 && d < 35 && f.inside < 0 && f.bush < 0 && !hiding) {
          startToss(ai, f, 'bush', THROW.min, Math.atan2(-dx, -dz));
          cool();
        } else if (f.throws.flour > 0 && f.hp + f.shield < 45 && d < 25) {
          startToss(ai, f, 'flour', THROW.min);
          cool();
        } else ai.tossCool = 1 + m.rng();
      }
      const want = bestSlot(f, d);
      if (want !== f.slot && f.reloadT <= 0 && (ai.swapCool <= 0 || f.slot === SLOT_THROW)) {
        inp.slot = want;
        ai.swapCool = 0.8;
      }
      const reach = g ? WEAPONS[g.w].range * 0.95 : MELEE[f.melee].range + 0.4;
      // hiding, it holds its fire unless the target is right on top of it
      const hold = hiding && d > 6;
      if (f.slot !== SLOT_THROW && !hold && ai.react <= 0 && aligned && d < reach && (ai.burst > 0 || scoped || spinner) && clearBetween(m, f, tgt)) {
        if (room(m, f, ai, L, g, tgt)) {
          inp.fire = true;
          // after a scoped shot, aim afresh and settle again
          if (scoped && f.fireT <= 0) {
            ai.steady = 0;
            ai.errT = 0;
          }
        } else if (spinner && f.spin < 0.9) inp.fire = true; // waiting our turn, the barrels keep turning (short of firing)
      }
    }
    if (L.build && !ai.toss && ai.buildCool <= 0 && f.y < 0.5 && !boxed && !leaving && ai.climbT <= 0 && ai.highT <= 0 && !outside) buildInFight(m, f, ai, L, d, ideal);
    if (outside) {
      head(m, f, ai, s.x, s.z, dt, 1);
    } else if (burn) {
      away(burn);
    } else if (leaving || boxed) {
      // out of our box (see goOut), or in it, shooting out of any opening it has
    } else if (ai.climbT > 0 || ai.highT > 0) {
      climbUp(m, f, ai, dt);
    } else if (hiding) {
      // into the bush, then still, patching up while nobody can see us
      head(m, f, ai, ai.hideX, ai.hideZ, dt, 0.5);
      if (!f.using && f.bush >= 0) {
        if (f.hp < 90 && bestUse(f, 'heal')) inp.use = 'bestHeal';
        else if (bestUse(f, 'shield')) inp.use = 'bestShield';
      }
    } else if (ai.sillT < SILL && d < fightRange(f, g) + 4 && inWindow(m, f.x, f.z, tgt.x, tgt.z)) {
      // seen through a window in reach: stand and hold the line (a step aside loses it), shooting out the glass if
      // need be, for a while (farther off, close in rather than trade misses all day)
      ai.sillT += dt;
    } else if (f.ghillie && f.y < 0.5 && d > 16 && g && WEAPONS[g.w].range > d && grassAt(m.map, f.x, f.z) && m.clock - f.lastByAt > 2) {
      // in a ghillie suit out on the grass, far off: keep still (and so hard to see) and shoot from there, until hit
    } else {
      const pref = fightRange(f, g);
      let mx = 0;
      let mz = 0;
      if (d > pref + 4 || !clearBetween(m, f, tgt)) {
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
  ai.climbT = 0;
  ai.highT = 0;

  // nobody in sight: patch up, reload, then go where we mean to (boxed in, patch up all the way first)
  const g = f.slot < 2 ? f.guns[f.slot] : null;
  if (!f.using) {
    if (boxed && f.hp < 95 && bestUse(f, 'heal')) inp.use = 'bestHeal';
    else if (boxed && f.shield < 95 && bestUse(f, 'shield')) inp.use = 'bestShield';
    else if (f.hp < L.heal && bestUse(f, 'heal')) inp.use = 'bestHeal';
    else if (f.shield < 50 && bestUse(f, 'shield')) inp.use = 'bestShield';
    else if (f.items.coffee > 0 && f.boost < 20 && f.hp < 90) inp.use = 'coffee';
    else if (f.shield < 100 && f.items.shield > 0) inp.use = 'shield';
    else if (f.shield + f.sip < 90 && f.items.smoothie > 0) inp.use = 'smoothie';
    else if (g && g.mag < WEAPONS[g.w].mag * 0.6) inp.reload = true;
  }
  // a flare gun goes straight up the moment there's nobody about, to call a supply drop
  const flare = f.guns.findIndex((x) => !!x && !!WEAPONS[x.w].call && x.mag > 0);
  if (flare >= 0 && !outside && !f.using) {
    if (f.slot !== flare) inp.slot = flare;
    else inp.fire = true;
  } else if (f.slot >= SLOT_MELEE || !fightGun(f, g)) {
    const pick = f.guns.findIndex((x) => fightGun(f, x));
    if (pick >= 0 && pick !== f.slot) inp.slot = pick;
    else if (pick < 0 && f.slot === SLOT_THROW) inp.slot = SLOT_MELEE;
  }
  const via = ai.pad >= 0 ? m.map.pads[ai.pad] : null;
  // patched up (or the storm is coming): out of the box by the side toward where we're going
  if (boxed && (outside || (!f.using && !inp.use))) leaveBox(m, f, ai, outside ? s.x : ai.gx, outside ? s.z : ai.gz);
  if (burn) away(burn);
  else if (leaving || (f.using && !outside) || (boxed && ai.boxT > 0)) {
    // stand still behind cover while it takes (or out of our box, see goOut)
  } else if (hiding) head(m, f, ai, ai.hideX, ai.hideZ, dt, 0.5);
  else if (via) head(m, f, ai, via.x, via.z, dt, 0);
  else if (m.time - ai.stairAt < STAIR_STAY && levelAt(m, ai.gx, ai.gz) !== levelAt(m, f.x, f.z) && ai.goal !== 'zone' && ai.goal !== 'chase' && ai.goal !== 'revive') head(m, f, ai, ai.stairX, ai.stairZ, dt, 0.5);
  else head(m, f, ai, ai.gx, ai.gz, dt, ai.goal === 'roam' ? 2 : ai.goal === 'smash' ? 1.4 : ai.goal === 'vault' ? 0.6 : ai.goal === 'revive' ? REVIVE_R - 0.8 : ai.goal === 'mate' ? (ai.askK ? 1.8 : m.time < ai.followUntil ? 3 : 6) : 0.4);
  // facing the way we go, or where a teammate saw an enemy
  inp.aim = m.clock < ai.lookUntil ? Math.atan2(ai.lookX - topX(f.x), ai.lookZ - f.z) : Math.hypot(f.vx, f.vz) > 0.5 ? Math.atan2(f.vx, f.vz) : f.aim;
  if (!Number.isNaN(ai.editA)) {
    // a doorway in our own wall that stood in the way (see steer)
    inp.aim = ai.editA;
    inp.edit = true;
    ai.editA = NaN;
  } else if (ai.smashT > 0) {
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
  } else if (ai.goal === 'harvest') {
    if (m.time > ai.until) {
      ai.harvestCool = 25 + m.rng() * 25;
      ai.think = 0;
    } else if (Math.hypot(ai.srcX - f.x, ai.srcZ - f.z) < ai.srcR + MELEE[f.melee].range - 0.3) {
      ai.smashT = 0.3;
      ai.smashA = Math.atan2(ai.srcX - f.x, ai.srcZ - f.z);
    }
  } else if (ai.goal === 'vault') {
    // at the vault door: set it grinding open, then wait for it
    if (m.doors[ai.chest] !== DOOR_SHUT && m.doors[ai.chest] !== DOOR_OPENING) ai.think = 0;
    else if (Math.hypot(ai.gx - f.x, ai.gz - f.z) < 1.4 && m.doors[ai.chest] === DOOR_SHUT) requestDoor(m, f, ai.chest);
  } else if (ai.goal === 'chest') {
    const c = m.map.containers[ai.chest];
    if (!openable(m, c)) ai.think = 0;
    else if (m.time > ai.until) {
      // taking too long (it's somewhere we can't get at): leave it be
      ai.tried = c.id;
      ai.think = 0;
    } else if (Math.hypot(c.x - f.x, c.z - f.z) < CHEST_R - 0.3 && inReach(m, f, c)) {
      // straight for it (the key might take a door that happens to be nearer)
      requestOpen(m, f, c.id);
      ai.think = 0;
    }
  } else if (ai.goal === 'revive') {
    // by the knocked teammate: hold the key (see reviveStep)
    const o = m.fighters[ai.item];
    if (!o || !o.down || !fighting(o)) ai.think = 0;
    else {
      ai.gx = o.x;
      ai.gz = o.z;
      if (Math.hypot(o.x - f.x, o.z - f.z) < REVIVE_R - 0.4) inp.hold = true;
    }
  }
  if (m.mode !== 'solo' && !inp.hold && !f.using && !bring(m, f, ai)) share(m, f, ai);
}

/** In teams, the egg on ours a computer egg follows: the first one on the team a person plays, still in, or null. */
function leadOf(m: Match, f: Fighter): Fighter | null {
  for (const id of m.teams[f.team] ?? []) {
    const o = m.fighters[id];
    if (o !== f && o.kind !== 'bot' && alive(o)) return o;
  }
  return null;
}

/**
 * The nearest egg on our team that's in and on its feet (on the ground), and how far, or null: on our level, or
 * (`over`) going by the ground over anyone underground.
 */
function nearestMate(m: Match, f: Fighter, over = false) {
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const id of m.teams[f.team] ?? []) {
    const o = m.fighters[id];
    if (o === f || !upright(o) || o.phase !== 'ground') continue;
    const d = over ? Math.hypot(topX(o.x) - topX(f.x), o.z - f.z) : Math.hypot(o.x - f.x, o.z - f.z);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best ? { o: best, d: bestD } : null;
}

/**
 * A knocked computer egg crawls to the nearest teammate on its feet (out of the storm first), or away from whoever
 * last hit it, and holds still once it's there, or while a teammate revives it.
 */
function crawlTo(m: Match, f: Fighter, ai: Ai, dt: number) {
  const inp = f.input;
  if (beingRevived(m, f)) return;
  const s = m.storm;
  const pal = nearestMate(m, f);
  const foe = f.lastBy >= 0 ? m.fighters[f.lastBy] : undefined;
  if (Math.hypot(topX(f.x) - s.x, f.z - s.z) > s.r - 1) head(m, f, ai, s.x, s.z, dt, 1);
  else if (pal && pal.d < 80) head(m, f, ai, pal.o.x, pal.o.z, dt, 1.4);
  else if (foe && fighting(foe) && m.clock - f.lastByAt < 6) {
    const d = Math.max(0.1, Math.hypot(f.x - foe.x, f.z - foe.z));
    head(m, f, ai, f.x + ((f.x - foe.x) / d) * 6, f.z + ((f.z - foe.z) / d) * 6, dt, 0);
  }
  inp.aim = Math.hypot(f.vx, f.vz) > 0.2 ? Math.atan2(f.vx, f.vz) : f.aim;
}

/**
 * Now and then, with nobody about, a computer egg puts down something a teammate standing by it is short of: a
 * bandage or medkit for one that's hurt, a mini shield for one without a shield, a box of ammo for a gun with none
 * left (when it can tell what the teammate carries, a computer egg's).
 */
function share(m: Match, f: Fighter, ai: Ai) {
  if (ai.shareCool > 0 || ai.target >= 0) return;
  ai.shareCool = 2;
  for (const id of m.teams[f.team] ?? []) {
    const o = m.fighters[id];
    if (o === f || !upright(o) || o.phase !== 'ground' || Math.hypot(o.x - f.x, o.z - f.z) > 4) continue;
    const bare = owned(o) ? null : o;
    let what: Drop | null = null;
    if (o.hp < 50 && (bare || bestUse(o, 'heal') === null)) what = f.items.medkit >= 2 ? 'medkit' : f.items.bandage >= 3 ? 'bandage' : null;
    if (!what && o.shield < 25 && (bare || bestUse(o, 'shield') === null)) what = f.items.mini >= 3 ? 'mini' : f.items.shield >= 2 ? 'shield' : null;
    if (!what && !bare)
      for (const g of o.guns) {
        const a = g && !WEAPONS[g.w].call ? WEAPONS[g.w].ammo : null;
        if (a && g!.mag === 0 && o.ammo[a] === 0 && f.ammo[a] >= AMMO_BOX[a] * 2 && !f.guns.some((x) => x && WEAPONS[x.w].ammo === a && f.ammo[a] < AMMO_BOX[a] * 3)) what = a;
      }
    if (!what) continue;
    f.input.aim = Math.atan2(o.x - f.x, o.z - f.z);
    f.input.drop = what;
    ai.shareCool = 20 + m.rng() * 15;
    return;
  }
}

/**
 * Computer eggs on a team hear a teammate's call: the nearest with one to spare brings what it asked for and says it's
 * on its way (or the nearest says it has none), all of them follow it a while (or come to it when it needs help), and
 * they look where it saw an enemy.
 */
function heard(m: Match, from: Fighter, k: EmoteId) {
  if (m.mode === 'solo' || !isTeamEmote(k)) return;
  const bots = (m.teams[from.team] ?? []).map((id) => m.fighters[id]).filter((o) => o !== from && !!o.ai && upright(o) && o.phase !== 'bus');
  if (!bots.length) return;
  const dist = (o: Fighter) => Math.hypot(topX(o.x) - topX(from.x), o.z - from.z);
  bots.sort((a, b) => dist(a) - dist(b));
  const say = (o: Fighter, e: EmoteId) => (o.input.emote = { k: e, x: o.x, z: o.z });
  // a knocked egg asking for anything needs picking up first (it can't take a thing), so they come to it
  const ask = from.down && (k === 'meds' || k === 'shield' || k === 'ammo' || k === 'gun') ? 'help' : k;
  switch (ask) {
    case 'meds':
    case 'shield':
    case 'ammo':
    case 'gun': {
      const a = k === 'ammo' ? from.emoteA : null;
      const giver = bots.find((o) => spare(o, k, a) !== null);
      if (!giver) return void say(bots[0], 'sad');
      const ai = giver.ai!;
      ai.askK = k;
      ai.askA = a;
      ai.askN = k === 'gun' ? 1 : 2;
      ai.askTo = from.id;
      ai.askUntil = m.time + ASK_T;
      say(giver, 'omw');
      return;
    }
    case 'follow':
    case 'help':
      for (const o of bots) {
        o.ai!.followTo = from.id;
        o.ai!.followUntil = m.time + (ask === 'help' ? ASK_T : FOLLOW_T);
      }
      say(bots[0], ask === 'help' ? 'omw' : 'thumbs');
      return;
    case 'enemy':
      for (const o of bots) {
        o.ai!.lookX = from.pingX;
        o.ai!.lookZ = from.pingZ;
        o.ai!.lookUntil = m.clock + LOOK_T;
      }
      return;
  }
}

/** What a computer egg can spare a teammate who asks for it (see heard), or null: it keeps enough to patch itself up. */
function spare(f: Fighter, k: EmoteId, a: Ammo | null): Drop | null {
  const it = f.items;
  switch (k) {
    case 'meds':
      return it.medkit >= 2 ? 'medkit' : it.bandage >= 3 ? 'bandage' : it.medkit && it.bandage ? 'medkit' : null;
    case 'shield':
      return it.shield >= 2 ? 'shield' : it.mini >= 2 ? 'mini' : it.shield && it.mini ? 'shield' : null;
    case 'ammo': {
      // keeping a box for a gun of ours that takes it
      if (!a) return null;
      const ours = f.guns.some((g) => g && !WEAPONS[g.w].call && WEAPONS[g.w].ammo === a);
      return f.ammo[a] >= AMMO_BOX[a] * (ours ? 2 : 1) ? a : null;
    }
    case 'gun':
      // the weaker of two, and never with a flare gun for one (the other is all we'd have left)
      if (!f.guns[0] || !f.guns[1] || f.guns.some((g) => g && WEAPONS[g.w].call)) return null;
      return gunValue(f.guns[0]) <= gunValue(f.guns[1]) ? 0 : 1;
    default:
      return null;
  }
}

/**
 * A computer egg asked for something puts it down once it's by the teammate who asked (with nobody to fight), facing
 * them, one a frame until it has put down what it meant to or has no more to spare. True while it does.
 */
function bring(m: Match, f: Fighter, ai: Ai) {
  if (!ai.askK) return false;
  const o = m.fighters[ai.askTo];
  if (m.time > ai.askUntil || !o || !upright(o)) {
    ai.askK = null;
    return false;
  }
  if (ai.target >= 0 || f.y > 1 || Math.hypot(o.x - f.x, o.z - f.z) > 3.5) return false;
  const what = spare(f, ai.askK, ai.askA);
  if (what === null) {
    ai.askK = null;
    return false;
  }
  f.input.aim = Math.atan2(o.x - f.x, o.z - f.z);
  f.input.drop = what;
  if (--ai.askN <= 0) ai.askK = null;
  // and nothing else put down for a while after
  ai.shareCool = Math.max(ai.shareCool, 5);
  return true;
}

/** The newest throw of a kind by an egg still in the air (or on the ground, ticking). */
function lastToss(m: Match, fid: number, k: ThrowId) {
  for (let i = m.tosses.length - 1; i >= 0; i--) if (m.tosses[i].f === fid && m.tosses[i].k === k) return m.tosses[i];
  return null;
}

function startToss(ai: Ai, f: Fighter, k: ThrowId, d: number, a = NaN) {
  ai.toss = k;
  ai.tossD = d;
  ai.tossA = a;
  ai.tossT = 1.5;
  ai.tossHad = f.throws[k];
}

/** Melee weapons worth trading the spatula for, best first. */
const MELEE_VALUE: Record<MeleeId, number> = { spatula: 0, whisk: 2, knife: 4, cleaver: 4, pan: 5, pin: 3 };

/** Picks what to do, then whether a bounce pad on the way would get us somewhere far quicker. */
function decide(m: Match, f: Fighter, ai: Ai, L: LevelSpec) {
  pickGoal(m, f, ai, L);
  const lv = scopeFor(m, f, ai);
  if (lv !== f.scope) f.input.scope = 10 + lv;
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

/** About how far a scope lets an egg see (the view's half height), by level. */
const SCOPE_SEES = SCOPE_VIEW.map((v) => 14 + v);

/**
 * The scope a computer egg looks through: in a fight the least that still takes in the target with room to spare (a
 * close fight wants the wide view of none), indoors no more than 2x, out in the open the best it carries.
 */
function scopeFor(m: Match, f: Fighter, ai: Ai) {
  const best = bestScope(f);
  const t = ai.target >= 0 ? m.fighters[ai.target] : undefined;
  if (t) {
    const d = Math.hypot(t.x - f.x, t.z - f.z);
    for (let lv = 0; lv < best; lv++) if (hasScope(f, lv) && SCOPE_SEES[lv] >= d + 5) return lv;
    return best;
  }
  for (let lv = f.inside >= 0 ? Math.min(best, 1) : best; lv > 0; lv--) if (hasScope(f, lv)) return lv;
  return 0;
}

/**
 * Seconds a computer egg keeps on from a stairway it has just come through before it may turn back (unless there's
 * something to fight, the storm, a fight to chase or a teammate to revive), and how far on it walks meanwhile: never
 * down and straight back up, gone from sight for a blink.
 */
const STAIR_STAY = 2;
const STAIR_ON = 3;
/** Which side of the stairs a point is on: up top (-2), or the basement it's in. */
const levelAt = (m: Match, x: number, z: number) => (isDeep(x) ? basementAt(m.map, x, z) : -2);

/** The widest a computer egg's aim strays (radians), however far off and quick the target. */
const MISS = 0.35;
/** The longest a computer egg holds still at a window on one target (seconds). */
const SILL = 8;

/** Meters farther off a target seems for every other computer egg already fighting it. */
const CROWD = 12;
const hunters = new WeakMap<Match, { frame: number; n: number[] }>();
/** How many computer eggs have each egg for their target, counted once a step. */
function huntersOf(m: Match) {
  let got = hunters.get(m);
  if (!got) hunters.set(m, (got = { frame: -1, n: [] }));
  if (got.frame !== m.frame) {
    got.frame = m.frame;
    got.n.length = m.fighters.length;
    got.n.fill(0);
    for (const f of m.fighters) if (f.ai && f.ai.target >= 0 && fighting(f)) got.n[f.ai.target]++;
  }
  return got.n;
}

function pickGoal(m: Match, f: Fighter, ai: Ai, L: LevelSpec) {
  // a target: the nearest egg we can see, sticking with the one we have, and turning on whoever just shot us
  // as far as the scope in use lets it see (no gun sees farther on its own, a sniper neither), more up high
  const sight = L.sight + (isDeep(f.x) ? 0 : SCOPE_VIEW[f.scope]) + levelOf(f.y) * HIGH_VIEW;
  let best: Fighter | null = null;
  let bestScore = Infinity;
  const hunted = huntersOf(m);
  for (const o of m.fighters) {
    if (o === f || o.team === f.team || !fighting(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    const hitMe = o.id === f.lastBy && m.clock - f.lastByAt < 3;
    // (or one by where a teammate saw an enemy)
    const told = m.clock < ai.lookUntil && Math.hypot(topX(o.x) - ai.lookX, o.z - ai.lookZ) < 15;
    if (d > sight + 15 || !canSee(m, f, o, hitMe || told ? sight + 15 : sight)) continue;
    // rather one nobody else is on than piling onto one already in a fight; the kill leader is worth going after; a
    // knocked egg can't shoot back, so it waits for the ones that can (unless it's right there)
    const others = hunted[o.id] - (o.id === ai.target ? 1 : 0);
    const score = d - (o.id === ai.target ? 8 : 0) - (hitMe ? 12 : 0) + (hitMe ? 0 : others * CROWD) - (o.id === m.leader ? 5 : 0) + (o.down && d > 6 ? 25 : 0);
    if (score < bestScore) {
      best = o;
      bestScore = score;
    }
  }
  const armed = f.guns.some((x) => fightGun(f, x));
  // unarmed eggs only fight what is right in front of them (not through a window)
  if (best && !armed && (Math.hypot(best.x - f.x, best.z - f.z) > 6 || inWindow(m, f.x, f.z, best.x, best.z))) best = null;
  // a knocked teammate close by matters more than an egg far off (one in the basement under us, or over us, we go
  // down, or up, the stairs to)
  const downed = m.mode === 'solo' ? null : downMate(m, f, 45, true);
  if (best && downed && Math.hypot(downed.x - f.x, downed.z - f.z) < 12 && Math.hypot(best.x - f.x, best.z - f.z) > 25 && best.id !== f.lastBy) best = null;
  if ((best?.id ?? -1) !== ai.target) {
    ai.react = best ? L.react * (0.7 + m.rng() * 0.6) : 0;
    ai.sillT = 0;
    // a new egg in sight: marked for a person on our team
    if (best && ai.pingCool <= 0 && m.mode !== 'solo' && leadOf(m, f)) {
      f.input.ping = { x: best.x, z: best.z };
      ai.pingCool = 15;
    }
  }
  // the count stays right for the others still to pick this step
  if (ai.target >= 0 && hunted[ai.target] > 0) hunted[ai.target]--;
  ai.target = best?.id ?? -1;
  if (best) {
    hunted[best.id]++;
    return;
  }

  // a knocked teammate to get back up
  if (downed) {
    ai.goal = 'revive';
    ai.item = downed.id;
    ai.gx = downed.x;
    ai.gz = downed.z;
    return;
  }
  // somebody shot us from out of sight: go and look
  const s = m.storm;
  const safe = s.shrinking || s.timer < 20 ? s.next : { x: s.x, z: s.z, r: s.r };
  // (underground, by the ground over us, and in good time: it's a way up to the stairs)
  const deep = isDeep(f.x);
  const fromSafe = Math.hypot(topX(f.x) - safe.x, f.z - safe.z);
  if (fromSafe > safe.r - (deep ? 14 : 4)) {
    const k = safe.r > 6 ? (safe.r * 0.45) / Math.max(1, fromSafe) : 0;
    ai.goal = 'zone';
    ai.gx = safe.x + (topX(f.x) - safe.x) * k;
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
  // a teammate who asked us for something, or to follow or come and help: to them (see bring), and while we follow,
  // nothing far off
  const asked = ai.askK && m.time < ai.askUntil ? m.fighters[ai.askTo] : undefined;
  const followed = m.time < ai.followUntil ? m.fighters[ai.followTo] : undefined;
  const to = asked ?? followed;
  const tethered = !!to && upright(to) && to.phase === 'ground';
  if (to && !tethered && !asked) ai.followUntil = 0;
  if (to && tethered && Math.hypot(to.x - f.x, to.z - f.z) > (asked ? 2.5 : ai.goal === 'mate' ? 4 : 8)) {
    ai.goal = 'mate';
    ai.gx = to.x;
    ai.gz = to.z;
    return;
  }
  // too far from the team: catch up (with a person who leads it, sooner, and down the stairs after them; a computer
  // egg in the basement under us, or over us, is near enough)
  if (m.mode !== 'solo') {
    const lead = leadOf(m, f);
    const pal = lead && upright(lead) && lead.phase === 'ground' ? { o: lead, d: Math.hypot(lead.x - f.x, lead.z - f.z) } : nearestMate(m, f, true);
    if (pal && pal.d > (ai.goal === 'mate' ? 10 : pal.o === lead ? 28 : 50)) {
      ai.goal = 'mate';
      ai.gx = pal.o.x;
      ai.gz = pal.o.z;
      return;
    }
  }

  const inSafe = (x: number, z: number) => Math.hypot(topX(x) - safe.x, z - safe.z) < safe.r - 2;
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
  let item = null as LootItem | null;
  let itemD = tethered ? 15 : 70;
  if (ai.goal === 'loot' && m.time > ai.until) ai.lost = ai.item;
  // a sniper sees no farther than the scope it's looked through, so with one and no 4x yet a scope is worth the walk
  const scopeless = bestScope(f) < 2 && f.guns.some((x) => scopedGun(x) && hasAmmo(f, x));
  lootNear(m, f.x, f.z, itemD, (l) => {
    const d = Math.hypot(l.x - f.x, l.z - f.z) - (scopeless && l.def.kind === 'scope' ? 20 : 0);
    if (d >= itemD || l.id === ai.lost || !inSafe(l.x, l.z)) return;
    const def = l.def;
    let useful: boolean;
    switch (def.kind) {
      case 'gun':
        // never a second scope in place of the gun for closer in; a flare gun for a free hand or a weak gun, one at a time
        if (WEAPONS[def.w].call) useful = worst < 20 && !f.guns.some((x) => x && WEAPONS[x.w].call);
        else useful = gunValue({ w: def.w, r: def.r, mag: 0 }) > worst + 3 && !(WEAPONS[def.w].cls === 'sniper' && weakest && !scopedGun(weakest) && f.guns.some(scopedGun));
        break;
      case 'ammo':
        useful = f.guns.some((x) => x && !WEAPONS[x.w].call && WEAPONS[x.w].ammo === def.a) && f.ammo[def.a] < ammoCap(def.a, f.pack) * 0.5;
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
      case 'helmet':
      case 'vest':
      case 'ghillie':
        useful = wants(f, def, false);
        break;
      default:
        useful = false;
    }
    if (!useful || l.by === f.id) return;
    item = l;
    itemD = d;
  });
  let chest = -1;
  let chestD = tethered ? 15 : armed ? 30 : 45;
  const tryChest = (c: Container) => {
    if (!openable(m, c) || !inSafe(c.x, c.z) || lockedIn(m, c) || c.id === ai.tried) return;
    // a supply drop is worth the walk from farther off
    const d = Math.hypot(c.x - f.x, c.z - f.z) - (c.kind === 'supply' ? 40 : 0);
    if (d < chestD) {
      chest = c.id;
      chestD = d;
    }
  };
  containersNear(m.map, f.x, f.z, chestD, tryChest);
  for (const list of [m.map.drops, m.map.flares]) for (const id of list) tryChest(m.map.containers[id]);
  // a bank vault's door, shut on safes nobody has opened: worth the wait for it to open (and while it opens, stay by it)
  let vault = -1;
  for (const i of m.vaults) {
    const s = m.map.slabs[i];
    const st = m.doors[i];
    if ((st !== DOOR_SHUT && !(st === DOOR_OPENING && ai.goal === 'vault' && ai.chest === i)) || !inSafe(s.x, s.z)) continue;
    if (!m.locked.some((v, c) => v === i && !m.opened[c])) continue;
    const d = Math.hypot(s.x - f.x, s.z - f.z) - (st === DOOR_OPENING ? 40 : 10);
    if (d < chestD) {
      vault = i;
      chestD = d;
      chest = -1;
    }
  }
  // a stairway down to a basement nobody has emptied yet (and we haven't been down), with the storm a good way off (not
  // while a person we follow stays up top: they'd only call us straight back up)
  let down = -1;
  let downD = Infinity;
  const led = m.mode === 'solo' ? null : leadOf(m, f);
  if (!deep && !tethered && m.map.stairs.length && !(led && upright(led) && led.phase === 'ground' && !isDeep(led.x))) {
    if (ai.goal === 'stairs' && m.time > ai.until && m.map.stairs[ai.chest]) ai.below.push(m.map.stairs[ai.chest].u);
    const quiet = !s.shrinking && s.timer > 25;
    for (const st of m.map.stairs) {
      if (ai.below.includes(st.u) || !quiet || Math.hypot(st.x - safe.x, st.z - safe.z) > safe.r - 18 || !stocked(m, st.u)) continue;
      // worth the walk from farther off than a chest, a bunker out in the open most of all
      const d = Math.hypot(st.x - f.x, st.z - f.z) - (st.b < 0 ? 25 : 12);
      if (d < downD && d < (armed ? 30 : 40)) {
        down = st.i;
        downD = d;
      }
    }
  }
  if (down >= 0 && (!item || itemD > downD + 6) && (chest < 0 || chestD > downD) && vault < 0) {
    const st = m.map.stairs[down];
    const u = m.map.buildings[st.u];
    if (ai.goal !== 'stairs' || ai.chest !== down) ai.until = m.time + 30;
    // into its first room, by the stairs (see head)
    ai.goal = 'stairs';
    ai.chest = down;
    ai.gx = u.rooms[0]?.x ?? u.x;
    ai.gz = u.rooms[0]?.z ?? u.z;
    return;
  }
  if (item && (chest < 0 || itemD < chestD + 6)) {
    if (ai.goal !== 'loot' || ai.item !== item.id) ai.until = m.time + 20;
    ai.goal = 'loot';
    ai.item = item.id;
    ai.gx = item.x;
    ai.gz = item.z;
    return;
  }
  if (vault >= 0 && !item) {
    // in front of it, on the lobby side (which its way out points to)
    const s = m.map.slabs[vault];
    ai.goal = 'vault';
    ai.chest = vault;
    ai.gx = s.x + s.ox * 1.2;
    ai.gz = s.z + s.oz * 1.2;
    return;
  }
  if (chest >= 0) {
    const c = m.map.containers[chest];
    const ahead = c.kind === 'supply' ? 1.5 : 1.1;
    if (ai.goal !== 'chest' || ai.chest !== chest) ai.until = m.time + 25;
    ai.goal = 'chest';
    ai.chest = chest;
    ai.gx = c.x + (c.ax ? c.face * ahead : 0);
    ai.gz = c.z + (c.ax ? 0 : c.face * ahead);
    return;
  }
  // a crate, toilet or hay bale nearby to break open for whatever's in it (from farther off when we're unarmed)
  let smash = -1;
  let smashD = armed ? 14 : 26;
  containersNear(m.map, f.x, f.z, smashD, (c) => {
    if (!breakable(c) || c.kind === 'barrel' || m.opened[c.id] || c.id === ai.tried || !inSafe(c.x, c.z)) return;
    const d = Math.hypot(c.x - f.x, c.z - f.z);
    if (d < smashD) {
      smash = c.id;
      smashD = d;
    }
  });
  if (smash >= 0) {
    const c = m.map.containers[smash];
    if (ai.goal !== 'smash' || ai.chest !== smash) ai.until = m.time + 15;
    ai.goal = 'smash';
    ai.chest = smash;
    ai.gx = c.x;
    ai.gz = c.z;
    return;
  }
  // following: nothing else to do but stay by them
  if (to && tethered) {
    ai.goal = 'mate';
    ai.gx = to.x;
    ai.gz = to.z;
    return;
  }
  // low on building material, with nothing better to do: a few swings at a tree, a rock or a car for some
  if (ai.goal === 'harvest' && m.time < ai.until) return;
  if (L.build && ai.harvestCool <= 0 && f.wood + f.stone + f.metal < 160 && harvestSpot(m, f, ai, inSafe)) return;
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

/** Whether a basement still has something in it: a container nobody has opened or broken, or loot on its floor. */
function stocked(m: Match, u: number) {
  const b = m.map.buildings[u];
  if (!b) return false;
  const inside = (x: number, z: number) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2;
  for (const c of m.map.containers) if (!m.opened[c.id] && c.kind !== 'supply' && inside(c.x, c.z)) return true;
  let any = false;
  lootNear(m, b.x, b.z, Math.max(b.w, b.d) / 2, (l) => {
    if (inside(l.x, l.z)) any = true;
  });
  return any;
}

/** Where a wall in a slot stands. */
const wallXZ = (s: Slot) => (s.dir === 2 ? { x: (s.cx + 0.5) * CELL_B, z: s.cz * CELL_B } : { x: s.cx * CELL_B, z: (s.cz + 0.5) * CELL_B });

/** Would a wall at (x, z) shut us in or block a way in? Never indoors, on a building, by a doorway or a gate, or on a bridge. */
function blocksWay(m: Match, f: Fighter, x: number, z: number) {
  return (
    bridgeAt(m.map, x, z) >= 0 ||
    m.map.yards.some((y) => y.gates.some((g) => Math.hypot(x - g.x, z - g.z) < WALL_HALF + g.w / 2 + 1)) ||
    m.map.buildings.some(
      (b) =>
        (Math.abs(f.x - b.x) < b.w / 2 && Math.abs(f.z - b.z) < b.d / 2) ||
        (Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) ||
        b.doors.some((dr) => Math.hypot(x - dr.x, z - dr.z) < WALL_HALF + dr.w / 2 + 1.2),
    )
  );
}

/** Would a wall built aiming this way shut us in or block a way in? */
function shutsIn(m: Match, f: Fighter, aim: number) {
  const w = wallXZ(wallSlot(gridOf(f.x), gridOf(f.z), dirOf(aim), levelOf(f.y)));
  return blocksWay(m, f, w.x, w.z);
}

/** Would boxing in here block a way in, or make no sense (indoors, or in the water)? */
const boxBlocked = (m: Match, f: Fighter) =>
  f.wet ||
  f.inside >= 0 ||
  planPiece(m, f, 'box').some((s) => {
    const w = wallXZ(s);
    return blocksWay(m, f, w.x, w.z);
  });

/** The material to box up in: the toughest we have four pieces of (else the one we have picked). */
function toughest(f: Fighter) {
  for (let i = MATS.length - 1; i >= 0; i--) if (f[MATS[i]] >= 4 * PIECE_COST) return i;
  return f.mat;
}

/** Is there room ahead (the way `q`) for two ramps: nothing in the way of our feet, no building, yard or water? */
function rampRoom(m: Match, f: Fighter, q: number) {
  const ex = DIR_X[q];
  const ez = DIR_Z[q];
  for (const side of [-SIDE, 0, SIDE]) if (castRay(m, f.x + ez * side, f.z - ex * side, ex, ez, CELL_B * 2.6, f.id, false, true) !== null) return false;
  for (let k = 1; k <= 2; k++) {
    const x = f.x + ex * CELL_B * k;
    const z = f.z + ez * CELL_B * k;
    if (roomAt(m.map, x, z) >= 0 || yardAt(m.map, x, z) >= 0 || waterAt(m.map, x, z) || blocksWay(m, f, x, z)) return false;
  }
  return true;
}

/**
 * A computer egg builds in a fight: a box round it to patch up in when it's hurt or shot at from two sides at once, a
 * wall between us when it gets hot out in the open, and now and then a ramp up toward the target for the high ground.
 */
function buildInFight(m: Match, f: Fighter, ai: Ai, L: LevelSpec, d: number, ideal: number) {
  const inp = f.input;
  const mats = f.wood + f.stone + f.metal;
  const cross = ai.foe2 >= 0 && ai.foe2 !== ai.foe && m.clock - ai.foe2At < 3 && m.clock - ai.foeAt < 3;
  const cool = () => (ai.buildCool = L.build * (0.7 + m.rng() * 0.6));
  if ((cross || (f.hitT > 0 && f.hp + f.shield < 70)) && mats >= 4 * PIECE_COST && !boxBlocked(m, f)) {
    inp.mat = 10 + toughest(f);
    inp.piece = 'box';
    ai.boxT = 7 + m.rng() * 3;
    ai.boxCx = gridOf(f.x);
    ai.boxCz = gridOf(f.z);
    ai.roofed = false;
    cool();
  } else if (f.hitT > 0 && f.hp + f.shield < 130 && d > 7 && mats >= PIECE_COST && !shutsIn(m, f, ideal)) {
    // a wall goes up quickest in wood
    if (f.wood >= PIECE_COST) inp.mat = 10;
    inp.piece = 'wall';
    inp.aim = ideal;
    cool();
  } else if (L.ramp && ai.rampCool <= 0 && d > 10 && d < 34 && mats >= 3 * PIECE_COST && f.inside < 0 && !f.wet && f.hp + f.shield > 60) {
    const q = dirOf(ideal);
    if (m.rng() < 0.5 && rampRoom(m, f, q)) {
      ai.climb = m.level === 'hard' ? 2 : 1;
      ai.climbQ = q;
      ai.climbT = 7;
      ai.highT = 0;
      ai.rampCool = L.ramp * (0.7 + m.rng() * 0.6);
    } else ai.rampCool = 2;
  }
}

/**
 * Ramping up for the high ground: a ramp the way of the target, up it, another from near its top (on hard), a floor
 * at the top to stand on, then hold it a while and fight from up there. Gives up when it takes too long, when a ramp
 * won't go up, or when what we're on goes and we drop; once the while is up, it's back to fighting as usual, which
 * walks it off and down.
 */
function climbUp(m: Match, f: Fighter, ai: Ai, dt: number) {
  const inp = f.input;
  const q = ai.climbQ;
  const on = f.on >= 0 ? m.walls.get(f.on) : undefined;
  const ramp = on?.k === 'ramp' && on.dir === q ? on : undefined;
  const aim = (q * Math.PI) / 2;
  ai.climbT -= dt;
  if (ai.highT > 0) {
    ai.highT = f.y > 0.5 ? ai.highT - dt : 0;
    // off the top of the ramp onto the floor there, if one went up, then stand
    const floor = ramp ? planPiece(m, f, 'floor', aim)[0] : undefined;
    if (floor && pieceIn(m, floor)) {
      inp.mx = DIR_X[q];
      inp.mz = DIR_Z[q];
    }
    return;
  }
  const front = planPiece(m, f, 'ramp', aim)[0];
  const ahead = front ? pieceIn(m, front) : undefined;
  const up = ramp ? rampY(ramp, f.x, f.z) - ramp.lv * LEVEL_H : 0;
  if (ai.climbT <= 0 || (!ramp && (f.y > 0.5 || (!ahead && ai.climb <= 0)))) {
    ai.climbT = 0;
    return;
  }
  if ((!ramp || up > 2) && !ahead && ai.climb > 0) {
    // the next ramp: from the ground, or from near the top of this one
    if (f.buildT > 0) return;
    inp.piece = 'ramp';
    inp.aim = aim;
    inp.fire = false;
    ai.climb--;
    return;
  }
  if (ramp && up > 2.5 && !ahead) {
    // the top: a floor ahead to stand on, and hold it
    ai.highT = 5 + m.rng() * 4;
    ai.climbT = 0;
    if (f.buildT <= 0) {
      inp.piece = 'floor';
      inp.aim = aim;
      inp.fire = false;
    }
    return;
  }
  inp.mx = DIR_X[q];
  inp.mz = DIR_Z[q];
}

/** Patched up: out of our box by the side toward (tx, tz), through a doorway cut in it when the wall there is ours. */
function leaveBox(m: Match, f: Fighter, ai: Ai, tx: number, tz: number) {
  const q = dirOf(Math.atan2(tx - f.x, tz - f.z));
  const w = pieceIn(m, wallSlot(ai.boxCx, ai.boxCz, q, levelOf(f.y)));
  ai.boxT = 0;
  ai.outT = 3;
  ai.outQ = q;
  if (w && w.f === f.id && w.e === 0) ai.editA = (q * Math.PI) / 2;
}

/** On the way out of our box: lined up with the middle of the side we leave by, then straight on out. */
function goOut(f: Fighter, ai: Ai) {
  const nx = DIR_X[ai.outQ];
  const nz = DIR_Z[ai.outQ];
  const cx = (ai.boxCx + 0.5 + nx * 0.5) * CELL_B;
  const cz = (ai.boxCz + 0.5 + nz * 0.5) * CELL_B;
  const out = (f.x - cx) * nx + (f.z - cz) * nz;
  if (out > 1.3) {
    ai.outT = 0;
    return false;
  }
  const side = (f.x - cx) * nz - (f.z - cz) * nx;
  const k = Math.abs(side) > 0.15 && out < -0.2 ? -Math.sign(side) : 0;
  f.input.mx = nx * 0.6 + nz * k;
  f.input.mz = nz * 0.6 - nx * k;
  return true;
}

/**
 * A tree, rock, car or lamp post nearby in the circle to swing at for building material: stone or metal now and then
 * when we're short of both, else wood. Sets the `harvest` goal and returns true, or waits a while and returns false.
 */
function harvestSpot(m: Match, f: Fighter, ai: Ai, inSafe: (x: number, z: number) => boolean) {
  const want: Mat = f.stone + f.metal < 40 && m.rng() < 0.6 ? (m.rng() < 0.5 ? 'stone' : 'metal') : 'wood';
  let best: Solid | null = null;
  let bestD = 16;
  solidsNear(m.map, f.x, f.z, 16, (_i, s) => {
    if (MAT_OF[s.what] !== want) return;
    const d = Math.hypot(s.x - f.x, s.z - f.z);
    if (d < bestD && inSafe(s.x, s.z) && roomAt(m.map, s.x, s.z) < 0 && yardAt(m.map, s.x, s.z) < 0) {
      best = s;
      bestD = d;
    }
  });
  const s = best as Solid | null;
  if (!s) {
    ai.harvestCool = 6 + m.rng() * 6;
    return false;
  }
  // stand off it on our side, a swing away
  const d = Math.max(0.1, bestD);
  const ux = (f.x - s.x) / d;
  const uz = (f.z - s.z) / d;
  const reach = s.shape === 'circle' ? s.r : Math.abs(ux) * s.hw + Math.abs(uz) * s.hd;
  ai.goal = 'harvest';
  ai.srcX = s.x;
  ai.srcZ = s.z;
  ai.srcR = reach;
  ai.gx = s.x + ux * (reach + 1.1);
  ai.gz = s.z + uz * (reach + 1.1);
  ai.until = m.time + 6;
  return true;
}

/**
 * Steers toward a goal. From inside a building the goal isn't in, that's out through a doorway first; from inside a
 * fenced yard it isn't in, out through a gate. Going the other way, it's in through a gate, then a doorway. With the
 * river in the way, it's over a bridge first, unless wading across is quicker.
 */
function head(m: Match, f: Fighter, ai: Ai, tx: number, tz: number, dt: number, stop: number) {
  // somewhere on another level (or down another basement): by the stairs between, up ours from underground, else
  // down the one to there
  const here = m.map.stairs.length && isDeep(f.x) ? basementAt(m.map, f.x, f.z) : -1;
  const there = m.map.stairs.length && isDeep(tx) ? basementAt(m.map, tx, tz) : -1;
  if (here !== there) {
    const st = m.map.stairs[stairOf(m.map, here >= 0 ? here : there)];
    if (st) {
      const p = onto(st, f);
      tx = p.x;
      tz = p.z;
      stop = 0;
      ai.steps = st.i;
    }
  }
  const b = f.inside >= 0 ? m.map.buildings[f.inside] : undefined;
  const yard = b ? -1 : yardAt(m.map, f.x, f.z);
  const ways = b ? b.doors : yard >= 0 ? m.map.yards[yard].gates : null;
  // the way through that makes the shortest way there, one in sight if there is one
  const pick = (list: Door[], inward: boolean) => {
    let best = Infinity;
    for (const dr of list) {
      const d = Math.hypot(dr.x - f.x, dr.z - f.z) + Math.hypot(tx - dr.x, tz - dr.z) + (openWay(m, f.x, f.z, dr.x + dr.ox * (inward ? 1 : -1), dr.z + dr.oz * (inward ? 1 : -1)) ? 0 : 20);
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
  // inside, with where we're going in another room: through the doorway to the next room on the way first
  let wx = px;
  let wz = pz;
  let via = false;
  const next = b && b.rooms.length ? roomWay(b, f.x, f.z, px, pz, door && !ai.inward ? door : null) : null;
  if (next) {
    const dr = next.door;
    const k = Math.abs((f.x - dr.x) * dr.oz - (f.z - dr.z) * dr.ox) < Math.max(0.3, dr.w / 2 - FIGHTER_R - 0.1) ? 1.5 : -1.2;
    wx = dr.x + dr.ox * next.s * k;
    wz = dr.z + dr.oz * next.s * k;
    via = true;
  } else if (b && !b.rooms.length)
    for (const dr of b.inner) {
      const there = (px - dr.x) * dr.ox + (pz - dr.z) * dr.oz;
      const here = (f.x - dr.x) * dr.ox + (f.z - dr.z) * dr.oz;
      if (there * here >= 0) continue;
      const s = there > 0 ? 1 : -1;
      const k = Math.abs((f.x - dr.x) * dr.oz - (f.z - dr.z) * dr.ox) < Math.max(0.3, dr.w / 2 - FIGHTER_R - 0.1) ? 1.5 : -1.2;
      wx = dr.x + dr.ox * s * k;
      wz = dr.z + dr.oz * s * k;
      via = true;
      break;
    }
  // and round a counter, a bed or a table in the way
  const r = b && (via || door || Math.hypot(px - f.x, pz - f.z) > stop) ? roundFurniture(m, f.inside, f.x, f.z, wx, wz) : null;
  if (r) return steer(m, f, ai, r.x, r.z, dt, 0);
  steer(m, f, ai, wx, wz, dt, via || door || over ? 0 : stop);
}

/**
 * Where to make for to take a stairway from an egg's level: lined up with it (up top, by its top end; below, by its
 * foot), then on along it, between the rails.
 */
function onto(st: Stair, f: Fighter) {
  const deep = isDeep(f.x);
  const sx = deep ? st.x + DEEP : st.x;
  const run = st.dx ? st.hw : st.hd;
  const half = st.dx ? st.hd : st.hw;
  const k = deep ? 1 : -1;
  const along = ((f.x - sx) * st.dx + (f.z - st.z) * st.dz) * k;
  const across = Math.abs((f.x - sx) * st.dz - (f.z - st.z) * st.dx);
  if (across < half - 0.45 && along < run + 1.2) return { x: sx, z: st.z };
  const out = stairOut(st, deep);
  return { x: out.x - st.dx * k * 0.4, z: out.z - st.dz * k * 0.4 };
}

/** The room of a building a point is in (a little past its walls, so a doorway counts), or -1. */
const roomOf = (b: Building, x: number, z: number) => b.rooms.findIndex((r) => Math.abs(x - r.x) < r.hw + 0.3 && Math.abs(z - r.z) < r.hd + 0.3);

/**
 * In a building of rooms, the doorway to go through first on the way from (x, z) to (tx, tz) in another room (or, for
 * somewhere outside, to the room of the way out `exit`), and which way through it (1 along its way out): found
 * breadth first over the rooms, each doorway joining the two either side of it. Null in the same room.
 */
function roomWay(b: Building, x: number, z: number, tx: number, tz: number, exit: Door | null) {
  const here = roomOf(b, x, z);
  let goal = roomOf(b, tx, tz);
  if (goal < 0 && exit) goal = roomOf(b, exit.x - exit.ox * 0.9, exit.z - exit.oz * 0.9);
  if (here < 0 || goal < 0 || here === goal) return null;
  const links = b.inner.map((d) => [roomOf(b, d.x - d.ox * 0.9, d.z - d.oz * 0.9), roomOf(b, d.x + d.ox * 0.9, d.z + d.oz * 0.9)]);
  // the doorway each room was first reached through
  const from = b.rooms.map(() => -1);
  const seen = b.rooms.map((_, i) => i === here);
  const queue = [here];
  while (queue.length) {
    const r = queue.shift()!;
    links.forEach(([p, q], k) => {
      const o = p === r ? q : q === r ? p : -1;
      if (o < 0 || seen[o]) return;
      seen[o] = true;
      from[o] = k;
      queue.push(o);
    });
  }
  if (!seen[goal]) return null;
  // back from the goal to the first step
  let at = goal;
  let k = from[at];
  for (;;) {
    const [p, q] = links[k];
    const prev = p === at ? q : p;
    if (prev === here) break;
    at = prev;
    k = from[at];
  }
  const [, out] = links[k];
  return { door: b.inner[k], s: out === at ? 1 : -1 };
}

/** The furniture that stops feet in each building, worked out once (and again should the list be swapped). */
const furnished = new WeakMap<GameMap, { of: unknown; by: Box[][] }>();
function furnitureIn(map: GameMap, bi: number) {
  let got = furnished.get(map);
  if (!got || got.of !== map.furniture) {
    const by: Box[][] = map.buildings.map(() => []);
    for (const p of map.furniture) if (furnitureSolid(p.kind)) by[p.b]?.push(p);
    got = { of: map.furniture, by };
    furnished.set(map, got);
  }
  return got.by[bi] ?? [];
}

/**
 * Inside building `bi`, when the way from (x, z) to (px, pz) runs into furniture that stops feet, the corner to walk
 * round the nearest piece by: one indoors and in sight that makes the shortest way, and not the one we're at.
 */
function roundFurniture(m: Match, bi: number, x: number, z: number, px: number, pz: number) {
  const list = furnitureIn(m.map, bi);
  const len = Math.hypot(px - x, pz - z);
  if (!list.length || len < 0.5) return null;
  // the room an egg's middle needs round a piece (a touch less, so one already against it isn't taken to be in it)
  const pad = FIGHTER_R - 0.08;
  let near = Infinity;
  let o: Box | null = null;
  for (const p of list) {
    const t = rayBox(x, z, (px - x) / len, (pz - z) / len, len, p.x, p.z, p.hw + pad, p.hd + pad);
    if (t < near) {
      near = t;
      o = p;
    }
  }
  if (!o) return null;
  const box = o;
  const b = m.map.buildings[bi];
  const g = FIGHTER_R + 0.4;
  const inside = (c: { x: number; z: number }) => Math.abs(c.x - b.x) < b.w / 2 - WALL_T / 2 - FIGHTER_R && Math.abs(c.z - b.z) < b.d / 2 - WALL_T / 2 - FIGHTER_R;
  const corners = CORNERS.map(([sx, sz]) => ({ x: box.x + sx * (box.hw + g), z: box.z + sz * (box.hd + g) }));
  const sees = (ax: number, az: number, bx: number, bz: number) => {
    const l = Math.hypot(bx - ax, bz - az);
    return l < 1e-6 || rayBox(ax, az, (bx - ax) / l, (bz - az) / l, l, box.x, box.z, box.hw + pad, box.hd + pad) === Infinity;
  };
  const rest = (i: number) => {
    const c = corners[i];
    if (sees(c.x, c.z, px, pz)) return Math.hypot(px - c.x, pz - c.z);
    return Math.min(...[corners[(i + 1) % 4], corners[(i + 3) % 4]].map((n) => (inside(n) ? Math.hypot(n.x - c.x, n.z - c.z) + Math.hypot(px - n.x, pz - n.z) : Infinity)));
  };
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const l = Math.hypot(c.x - x, c.z - z);
    if (l < 0.5 || !inside(c) || !sees(x, z, c.x, c.z)) continue;
    const d = l + rest(i);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
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
  const x0 = Math.min(x, px);
  const x1 = Math.max(x, px);
  const z0 = Math.min(z, pz);
  const z1 = Math.max(z, pz);
  for (const b of blockersOf(m.map)) {
    // nowhere near the way (a cheap miss first), one we're standing in (a doorway) or one the point is in
    if (b.x + b.hw < x0 || b.x - b.hw > x1 || b.z + b.hd < z0 || b.z - b.hd > z1 || b.yard === yard || (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) || (Math.abs(px - b.x) < b.hw && Math.abs(pz - b.z) < b.hd)) continue;
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


/** The ways to try, straight on first, and how far either side of the middle a way must be clear. */
const TURNS = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2];
const SIDE = 0.45;

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
  // a shut door just ahead: open it (it swings away from us)
  const ahead = castRay(m, f.x, f.z, dx / d, dz / d, Math.min(d, 2), f.id, false, true, levelOf(f.y));
  if (ahead?.what === 'door' && m.doors[ahead.ref] === DOOR_SHUT) requestDoor(m, f, ahead.ref);
  let a = Math.atan2(dx, dz);
  // nor down (or up) a stairway we aren't making for: it would take us to the other level
  const look = Math.min(2.4, d);
  const offStairs = (b: number) => !m.map.stairs.length || !ontoStairs(m, f, Math.sin(b), Math.cos(b), look, ai.steps);
  if (ai.detourT > 0 && !offStairs(ai.detourA)) ai.detourT = 0;
  if (ai.detourT > 0) {
    ai.detourT -= dt;
    a = ai.detourA;
  } else {
    // try straight on, then ever wider either side, and never into a building (doorways too) or a fenced yard the
    // point isn't in, nor over a bounce pad we aren't making for
    const into = roomAt(m.map, tx, tz);
    const intoYard = yardAt(m.map, tx, tz);
    const fromYard = yardAt(m.map, f.x, f.z);
    const onPad = padAt(m.map, tx, tz);
    const lv = levelOf(f.y);
    for (const turn of TURNS) {
      const b = a + turn;
      const ex = Math.sin(b);
      const ez = Math.cos(b);
      const room = roomAt(m.map, f.x + ex * look, f.z + ez * look);
      const yard = yardAt(m.map, f.x + ex * look, f.z + ez * look);
      const blocked =
        !offStairs(b) ||
        (room >= 0 && room !== f.inside && room !== into) ||
        (yard >= 0 && yard !== fromYard && yard !== intoYard) ||
        m.map.pads.some((p, i) => i !== onPad && rayCircle(f.x, f.z, ex, ez, look, p.x, p.z, PAD.r + FIGHTER_R * 0.5) < Infinity) ||
        castRay(m, f.x, f.z, ex, ez, look, f.id, false, true, lv) !== null ||
        castRay(m, f.x + ez * SIDE, f.z - ex * SIDE, ex, ez, look, f.id, false, true, lv) !== null ||
        castRay(m, f.x - ez * SIDE, f.z + ex * SIDE, ex, ez, look, f.id, false, true, lv) !== null;
      if (!blocked) {
        a = b;
        break;
      }
    }
  }
  // no way but onto the stairs: wait for one to open up
  const wait = !offStairs(a);
  inp.mx = wait ? 0 : Math.sin(a);
  inp.mz = wait ? 0 : Math.cos(a);
  // stuck on something: wander off a different way for a moment
  ai.stuckT += dt;
  if (ai.stuckT > 0.8) {
    const moved = Math.hypot(f.x - ai.lastX, f.z - ai.lastZ);
    ai.stuckT = 0;
    ai.lastX = f.x;
    ai.lastZ = f.z;
    if (moved < 0.8 && ai.detourT <= 0) {
      // a wall someone built or a crate, this way or straight on: break through it (a wall of ours, cut a doorway in
      // it); anything else, go round
      const ahead = Math.atan2(dx, dz);
      const lv = levelOf(f.y);
      const breaks = (h: ReturnType<typeof castRay>) => !!h && (h.what === 'built' || h.what === 'crate');
      const hit = castRay(m, f.x, f.z, Math.sin(a), Math.cos(a), 1.8, f.id, false, true, lv);
      const front = breaks(hit) ? null : castRay(m, f.x, f.z, Math.sin(ahead), Math.cos(ahead), Math.min(1.8, d), f.id, false, true, lv);
      const wall = breaks(hit) ? hit : breaks(front) ? front : null;
      const ours = wall?.what === 'built' ? m.walls.get(wall.ref) : undefined;
      // wedged against a built wall some other way (say a tree in our own box), now and then break out through it
      let side = wall ? -1 : builtBeside(m, f, lv);
      if (side >= 0 && m.rng() < 0.5) side = -1;
      if (ours && ours.f === f.id && ours.e === 0 && f.editT <= 0) ai.editA = wall === hit ? a : ahead;
      else if (wall || side >= 0) {
        ai.smashT = 1;
        ai.smashA = wall ? (wall === hit ? a : ahead) : side;
      } else {
        ai.detourT = 0.7 + m.rng() * 0.6;
        ai.detourA = a + (m.rng() < 0.5 ? 1 : -1) * (1.2 + m.rng() * 1.4);
      }
    }
  }
}

/**
 * Whether the way `len` along (ex, ez) from an egg takes it onto a stairway on its level (other than `but`): into its
 * box from outside it, or on in from the end it was stepped onto (up top its top, below its foot).
 */
function ontoStairs(m: Match, f: Fighter, ex: number, ez: number, len: number, but: number) {
  const deep = isDeep(f.x);
  const ox = deep ? DEEP : 0;
  for (const s of m.map.stairs) {
    const sx = s.x + ox;
    if (s.i === but || Math.abs(f.x - sx) > s.hw + len + 1 || Math.abs(f.z - s.z) > s.hd + len + 1) continue;
    const t = rayBox(f.x, f.z, ex, ez, len, sx, s.z, s.hw - 0.1, s.hd - 0.1);
    if (t === Infinity) continue;
    if (t > 0 || (ex * s.dx + ez * s.dz) * (deep ? -1 : 1) > 0) return true;
  }
  return false;
}

/** The way to the nearest built wall within a swing round an egg, on its level, or -1. */
function builtBeside(m: Match, f: Fighter, lv: number) {
  let best = -1;
  let bestT = 1.4;
  for (let k = 0; k < 8; k++) {
    const b = (k / 8) * Math.PI * 2;
    const hit = castRay(m, f.x, f.z, Math.sin(b), Math.cos(b), bestT, f.id, false, true, lv);
    if (hit?.what === 'built' && hit.t < bestT) {
      best = b;
      bestT = hit.t;
    }
  }
  return best;
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
