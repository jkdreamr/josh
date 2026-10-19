// Weapons, ammo, consumables and loot tables for Scramble. Pure, so it can be tested.

export type Rng = () => number;

/** mulberry32: a small seeded generator. Every client builds the same island and loot from the same seed. */
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

/** Picks a key by weight. Weights must be non-negative and not all zero. */
export function weighted<K extends string>(rng: Rng, table: Partial<Record<K, number>>): K {
  const entries = Object.entries(table) as [K, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [k, w] of entries) {
    roll -= w;
    if (roll < 0) return k;
  }
  return entries[entries.length - 1][0];
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));

// ---------------------------------------------------------------------------------------------------------------------
// Guns.

export const WEAPON_IDS = ['pistol', 'revolver', 'flare', 'smg', 'micro', 'hsmg', 'rifle', 'burst', 'marksman', 'scout', 'lmg', 'minigun', 'shotgun', 'auto', 'double', 'sniper', 'crossbow', 'launcher'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export const isWeapon = (v: unknown): v is WeaponId => WEAPON_IDS.includes(v as WeaponId);

export const AMMO_TYPES = ['light', 'heavy', 'shells', 'rockets'] as const;
export type Ammo = (typeof AMMO_TYPES)[number];
export const isAmmo = (v: unknown): v is Ammo => AMMO_TYPES.includes(v as Ammo);

/** The family a gun belongs to: how far it likes to fight, and how it's sorted on the How to Play sheet. */
export type GunClass = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'heavy';

export type WeaponSpec = {
  name: string;
  cls: GunClass;
  /** Damage per bullet (per pellet for shotguns) at common rarity. */
  dmg: number;
  /** Shots per second while the trigger is held (bursts per second for burst guns). */
  rate: number;
  mag: number;
  /** Seconds to reload a full magazine at common rarity. */
  reload: number;
  /** Half-angle of the random spread in radians, standing still. */
  spread: number;
  /** Bullet speed in meters per second. */
  speed: number;
  /** Meters a bullet flies before it drops. */
  range: number;
  ammo: Ammo;
  pellets: number;
  /** Damage falls off past `near` meters, down to `min` of full at `far`. */
  falloff?: { near: number; far: number; min: number };
  /** Rockets burst on impact: full damage at the center, less toward the edge. */
  splash?: number;
  /** Each pull of the trigger fires `n` shots `gap` seconds apart. */
  burst?: { n: number; gap: number };
  /** Firing it doesn't give away an egg hiding in a bush. */
  silent?: boolean;
  /** Damage multiplier against built walls and crates. */
  wallMult: number;
  /** Walking speed multiplier while holding it. */
  move: number;
  /** Extra meters of view while holding it (a built-in scope). */
  zoom: number;
  /** Each shot adds `per` to the spread multiplier, up to `max` more, and it settles at `cool` a second. */
  kick?: { per: number; max: number; cool: number };
  /** Seconds the barrels take to spin up before the first shot, and how much slower you walk while they spin. */
  spin?: { up: number; slow: number };
  /** A flare gun: one flare straight up that calls a supply drop, then it's spent. No ammo, no reload. */
  call?: boolean;
};

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { name: 'pistol', cls: 'pistol', dmg: 16, rate: 4.5, mag: 14, reload: 1.3, spread: 0.035, speed: 120, range: 50, ammo: 'light', pellets: 1, wallMult: 1, move: 1, zoom: 0 },
  flare: { name: 'flare gun', cls: 'pistol', dmg: 0, rate: 1, mag: 1, reload: 0, spread: 0, speed: 0, range: 0, ammo: 'rockets', pellets: 0, wallMult: 0, move: 1, zoom: 0, call: true },
  revolver: { name: 'hand cannon', cls: 'pistol', dmg: 33, rate: 1.7, mag: 7, reload: 2, spread: 0.02, speed: 160, range: 62, ammo: 'heavy', pellets: 1, wallMult: 1.2, move: 1, zoom: 2 },
  smg: { name: 'SMG', cls: 'smg', dmg: 11, rate: 11, mag: 30, reload: 1.9, spread: 0.1, speed: 110, range: 38, ammo: 'light', pellets: 1, wallMult: 1, move: 1, zoom: 0 },
  micro: { name: 'micro SMG', cls: 'smg', dmg: 8, rate: 16, mag: 24, reload: 1.6, spread: 0.14, speed: 105, range: 30, ammo: 'light', pellets: 1, wallMult: 1, move: 1.04, zoom: 0 },
  hsmg: { name: 'heavy SMG', cls: 'smg', dmg: 13, rate: 11.5, mag: 28, reload: 2.1, spread: 0.07, speed: 120, range: 42, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.98, zoom: 0, kick: { per: 0.11, max: 1, cool: 2.4 } },
  rifle: { name: 'rifle', cls: 'rifle', dmg: 20, rate: 5.5, mag: 30, reload: 2.3, spread: 0.045, speed: 140, range: 70, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.96, zoom: 2 },
  burst: { name: 'burst rifle', cls: 'rifle', dmg: 19, rate: 1.9, mag: 30, reload: 2.4, spread: 0.03, speed: 150, range: 75, ammo: 'heavy', pellets: 1, burst: { n: 3, gap: 0.075 }, wallMult: 1, move: 0.96, zoom: 3 },
  marksman: { name: 'marksman rifle', cls: 'rifle', dmg: 27, rate: 2.8, mag: 12, reload: 2.4, spread: 0.016, speed: 175, range: 88, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.95, zoom: 5 },
  scout: { name: 'scout rifle', cls: 'sniper', dmg: 34, rate: 2.2, mag: 10, reload: 2.5, spread: 0.01, speed: 190, range: 100, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.94, zoom: 8 },
  lmg: { name: 'machine gun', cls: 'heavy', dmg: 16, rate: 9, mag: 80, reload: 4.6, spread: 0.09, speed: 135, range: 65, ammo: 'heavy', pellets: 1, wallMult: 1.3, move: 0.82, zoom: 2 },
  minigun: { name: 'minigun', cls: 'heavy', dmg: 9, rate: 18, mag: 120, reload: 5.2, spread: 0.12, speed: 125, range: 55, ammo: 'light', pellets: 1, wallMult: 1.3, move: 0.74, zoom: 2, spin: { up: 0.9, slow: 0.8 } },
  shotgun: { name: 'pump shotgun', cls: 'shotgun', dmg: 8, rate: 1.1, mag: 6, reload: 2.6, spread: 0.24, speed: 95, range: 22, ammo: 'shells', pellets: 9, falloff: { near: 7, far: 20, min: 0.35 }, wallMult: 1, move: 0.96, zoom: 0 },
  auto: { name: 'auto shotgun', cls: 'shotgun', dmg: 7, rate: 3, mag: 8, reload: 3, spread: 0.22, speed: 95, range: 20, ammo: 'shells', pellets: 6, falloff: { near: 6, far: 18, min: 0.35 }, wallMult: 1, move: 0.95, zoom: 0 },
  double: { name: 'double barrel', cls: 'shotgun', dmg: 7, rate: 4, mag: 2, reload: 2.3, spread: 0.3, speed: 90, range: 16, ammo: 'shells', pellets: 10, falloff: { near: 5, far: 14, min: 0.3 }, wallMult: 1, move: 0.98, zoom: 0 },
  sniper: { name: 'sniper', cls: 'sniper', dmg: 70, rate: 0.6, mag: 4, reload: 3, spread: 0.004, speed: 240, range: 130, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.9, zoom: 14 },
  crossbow: { name: 'crossbow', cls: 'sniper', dmg: 60, rate: 1, mag: 1, reload: 1.5, spread: 0.006, speed: 85, range: 90, ammo: 'heavy', pellets: 1, silent: true, wallMult: 1, move: 0.96, zoom: 6 },
  launcher: { name: 'egg launcher', cls: 'heavy', dmg: 60, rate: 0.6, mag: 1, reload: 2.8, spread: 0.015, speed: 48, range: 80, ammo: 'rockets', pellets: 1, splash: 4.5, wallMult: 4, move: 0.9, zoom: 4 },
};

export const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export const RARITY_COLORS = ['#b8bec7', '#4cc261', '#3f8cff', '#b05cf7', '#f5a623'] as const;
const DMG_MULT = [1, 1.07, 1.14, 1.21, 1.3];
const RELOAD_MULT = [1, 0.95, 0.9, 0.85, 0.8];
export const MAX_RARITY = 4;
export const clampRarity = (r: number) => clampInt(r, 0, MAX_RARITY);
/** How long a flare takes from the shot to the supply drop it calls landing. */
export const FLARE_WAIT = 15;
export const damageOf = (w: WeaponId, rarity: number) => Math.round(WEAPONS[w].dmg * DMG_MULT[clampRarity(rarity)] * 10) / 10;
export const reloadOf = (w: WeaponId, rarity: number) => WEAPONS[w].reload * RELOAD_MULT[clampRarity(rarity)];

// ---------------------------------------------------------------------------------------------------------------------
// Melee: everyone starts with a spatula and can trade it for something from the kitchen drawer.

export const MELEE_IDS = ['spatula', 'whisk', 'knife', 'cleaver', 'pan', 'pin'] as const;
export type MeleeId = (typeof MELEE_IDS)[number];
export const isMelee = (v: unknown): v is MeleeId => MELEE_IDS.includes(v as MeleeId);

export type MeleeSpec = {
  name: string;
  dmg: number;
  /** Swings per second. */
  rate: number;
  range: number;
  /** Half-angle in front that a swing reaches, in radians. */
  arc: number;
  /** Wood a swing chops from a tree. */
  wood: number;
  /** Damage multiplier against built walls and crates. */
  wallMult: number;
  /** Walking speed multiplier while holding it. */
  move: number;
  /** A frying pan stops bullets: from the front while you hold it, from behind while it hangs on your back. */
  blocks?: boolean;
};

export const MELEE: Record<MeleeId, MeleeSpec> = {
  spatula: { name: 'spatula', dmg: 30, rate: 2, range: 2.2, arc: 1, wood: 6, wallMult: 1.5, move: 1.06 },
  whisk: { name: 'whisk', dmg: 17, rate: 4, range: 2, arc: 1.15, wood: 4, wallMult: 1, move: 1.08 },
  knife: { name: "chef's knife", dmg: 34, rate: 2.3, range: 2.7, arc: 0.75, wood: 5, wallMult: 1, move: 1.13 },
  cleaver: { name: 'cleaver', dmg: 52, rate: 1.2, range: 2.1, arc: 0.85, wood: 8, wallMult: 2, move: 1.04 },
  pan: { name: 'frying pan', dmg: 36, rate: 1.6, range: 2.2, arc: 1, wood: 6, wallMult: 1.5, move: 1.03, blocks: true },
  pin: { name: 'rolling pin', dmg: 40, rate: 1.5, range: 2.4, arc: 1.1, wood: 14, wallMult: 3.5, move: 1.04 },
};
/** Half-angle (radians) either side of straight on that a frying pan covers. */
export const PAN_ARC = 1;

// ---------------------------------------------------------------------------------------------------------------------
// Throwables.

export const THROW_IDS = ['grenade', 'impulse', 'flour', 'sauce', 'jam', 'bush', 'mirv', 'stun'] as const;
export type ThrowId = (typeof THROW_IDS)[number];
export const isThrow = (v: unknown): v is ThrowId => THROW_IDS.includes(v as ThrowId);

export type ThrowSpec = {
  name: string;
  plural: string;
  /** How many fit in an empty-handed egg's pockets (a backpack holds more). */
  carry: number;
  radius: number;
  /** Grenades: seconds from the throw to the bang, and the damage at the center. */
  fuse?: number;
  dmg?: number;
  /** Flour, hot sauce, jam and the bush: seconds the cloud, puddle or bush lasts, and the hot sauce's burn per second. */
  time?: number;
  dps?: number;
  /** An impulse egg's shove (meters a second at the middle). */
  push?: number;
  /** Jam, and a stun grenade's daze: the share of its pace an egg keeps. */
  slow?: number;
  /** A MIRV grenade: how many bomblets it splits into, how far they scatter, and each one's blast. */
  split?: { n: number; reach: number; radius: number; dmg: number };
};

export const THROWS: Record<ThrowId, ThrowSpec> = {
  grenade: { name: 'grenade', plural: 'grenades', carry: 3, radius: 5.5, fuse: 2.2, dmg: 90 },
  flour: { name: 'flour bomb', plural: 'flour bombs', carry: 2, radius: 6.5, time: 11 },
  sauce: { name: 'hot sauce', plural: 'hot sauces', carry: 2, radius: 3.8, time: 6, dps: 12 },
  impulse: { name: 'impulse egg', plural: 'impulse eggs', carry: 3, radius: 5.5, fuse: 1.2, dmg: 8, push: 22 },
  jam: { name: 'jam jar', plural: 'jam jars', carry: 2, radius: 3.6, time: 8, slow: 0.35 },
  bush: { name: 'bush in a can', plural: 'bushes in a can', carry: 2, radius: 1.9, time: 30 },
  mirv: { name: 'MIRV grenade', plural: 'MIRV grenades', carry: 2, radius: 3.5, fuse: 1.8, dmg: 40, split: { n: 6, reach: 5.5, radius: 2.8, dmg: 38 } },
  // a stun grenade's flash dazes every egg that sees it within `radius`, for up to `time` seconds (less the farther off)
  stun: { name: 'stun grenade', plural: 'stun grenades', carry: 3, radius: 9, fuse: 1.6, time: 3.5, slow: 0.55 },
};
/** How far a throw lands (meters), how fast it flies, and the wait before the next one. */
export const THROW = { min: 3, max: 20, speed: 17, cool: 0.7 };

// ---------------------------------------------------------------------------------------------------------------------
// Consumables.

export const USE_IDS = ['bandage', 'medkit', 'mini', 'shield', 'coffee', 'smoothie', 'tart'] as const;
export type UseId = (typeof USE_IDS)[number];
export const isUse = (v: unknown): v is UseId => USE_IDS.includes(v as UseId);

export type UseSpec = {
  name: string;
  plural: string;
  /** Seconds it takes. */
  time: number;
  /** How many fit in an empty-handed egg's pockets (a backpack holds more). */
  carry: number;
  /** Health it gives, up to `hpCap`. */
  hp?: number;
  hpCap?: number;
  /** Shield it gives, up to `shieldCap`. */
  shield?: number;
  shieldCap?: number;
  /** Boost it gives: health over time and a quicker step while it lasts. */
  boost?: number;
  /** Shield it gives a little at a time afterwards (SIP a second), up to SHIELD_MAX. */
  sip?: number;
};

export const USES: Record<UseId, UseSpec> = {
  bandage: { name: 'bandage', plural: 'bandages', time: 2.4, carry: 10, hp: 15, hpCap: 75 },
  medkit: { name: 'medkit', plural: 'medkits', time: 6, carry: 2, hp: 100, hpCap: 100 },
  mini: { name: 'mini shield', plural: 'mini shields', time: 2, carry: 4, shield: 25, shieldCap: 50 },
  shield: { name: 'shield potion', plural: 'shield potions', time: 4, carry: 2, shield: 50, shieldCap: 100 },
  coffee: { name: 'coffee', plural: 'coffees', time: 2.5, carry: 2, boost: 50 },
  smoothie: { name: 'smoothie', plural: 'smoothies', time: 2.5, carry: 2, sip: 60 },
  tart: { name: 'golden egg tart', plural: 'golden egg tarts', time: 5, carry: 2, hp: 100, hpCap: 100, boost: 100 },
};
/** Shield a second while a smoothie works. */
export const SIP = 6;
/** Boost drains this much a second, healing `heal` health a second and putting a spring in your step while it lasts. */
export const BOOST = { max: 100, drain: 2.5, heal: 1.2, speed: 1.08 };

export const HP_MAX = 100;
export const SHIELD_MAX = 100;

// ---------------------------------------------------------------------------------------------------------------------
// Building materials.

/** Wood from trees and logs, stone from rocks, metal from cars and lamp posts: a swing at one gathers some. */
export const MATS = ['wood', 'stone', 'metal'] as const;
export type Mat = (typeof MATS)[number];
export const isMat = (v: unknown): v is Mat => MATS.includes(v as Mat);
/**
 * What a piece of each material holds once built, the seconds it takes to build up to that (from a tenth of it), and
 * the share of a swing's wood it gathers of it. Wood goes up quickest and breaks soonest; metal is slow but tough.
 */
export const MAT_SPECS: Record<Mat, { name: string; hp: number; time: number; yield: number }> = {
  wood: { name: 'wood', hp: 150, time: 0.8, yield: 1 },
  stone: { name: 'stone', hp: 300, time: 1.6, yield: 0.8 },
  metal: { name: 'metal', hp: 450, time: 2.6, yield: 0.6 },
};
/** The most of each material an egg carries, and what one piece takes. */
export const MAT_MAX = 300;
export const PIECE_COST = 10;
export const WOOD_MAX = MAT_MAX;
export const WALL_COST = PIECE_COST;

// ---------------------------------------------------------------------------------------------------------------------
// Scopes and backpacks.

/** Scope levels 0..3 are 1x (none), 2x, 4x and 8x; each lets you see farther. */
export const SCOPES = ['1x', '2x', '4x', '8x'] as const;
export const SCOPE_VIEW = [0, 5, 11, 18] as const;
export const MAX_SCOPE = 3;
/**
 * Backpack levels 0..3: each adds 40% to the ammo, consumables and throwables an egg can carry, rounded up so every
 * level adds some (worked in whole numbers, which keeps it exact).
 */
export const MAX_PACK = 3;
export const capOf = (base: number, pack: number) => base + Math.ceil((base * 4 * clampInt(pack, 0, MAX_PACK)) / 10);

export const AMMO_BASE: Record<Ammo, number> = { light: 150, heavy: 90, shells: 30, rockets: 6 };
export const ammoCap = (a: Ammo, pack: number) => capOf(AMMO_BASE[a], pack);
export const useCap = (w: UseId, pack: number) => capOf(USES[w].carry, pack);
export const throwCap = (w: ThrowId, pack: number) => capOf(THROWS[w].carry, pack);
/** How much one ammo box holds. */
export const AMMO_BOX: Record<Ammo, number> = { light: 30, heavy: 20, shells: 10, rockets: 3 };

// ---------------------------------------------------------------------------------------------------------------------
// Armor: a helmet and a vest from the kitchen, three levels each.

export const ARMOR_KINDS = ['helmet', 'vest'] as const;
export type ArmorKind = (typeof ARMOR_KINDS)[number];
export const isArmor = (v: unknown): v is ArmorKind => ARMOR_KINDS.includes(v as ArmorKind);
export const MAX_ARMOR = 3;
/** What each level is called, by kind, level 0 being none. */
export const ARMOR_NAMES: Record<ArmorKind, readonly string[]> = {
  helmet: ['', 'colander', 'saucepan', 'stockpot'],
  vest: ['', 'apron', 'quilted apron', 'steel apron'],
};
/** The share of a hit each level stops. The two multiply, so the best of both stops about 45%. */
export const ARMOR_CUT: Record<ArmorKind, readonly number[]> = { helmet: [0, 0.08, 0.12, 0.16], vest: [0, 0.15, 0.25, 0.35] };
export const clampArmor = (lv: number) => clampInt(lv, 0, MAX_ARMOR);
/** What's left of a bullet, swing or blast after the armor an egg wears. The storm and hot sauce go straight through. */
export const armorMult = (helmet: number, vest: number) => (1 - ARMOR_CUT.helmet[clampArmor(helmet)]) * (1 - ARMOR_CUT.vest[clampArmor(vest)]);

// ---------------------------------------------------------------------------------------------------------------------
// Loot.

export type LootDef =
  | { kind: 'gun'; w: WeaponId; r: number; mag?: number }
  | { kind: 'melee'; w: MeleeId }
  | { kind: 'throw'; w: ThrowId; n: number }
  | { kind: 'ammo'; a: Ammo; n: number }
  | { kind: 'use'; w: UseId; n: number }
  | { kind: 'scope'; lv: number }
  | { kind: 'pack'; lv: number }
  | { kind: 'helmet'; lv: number }
  | { kind: 'vest'; lv: number }
  | { kind: 'ghillie' }
  | { kind: 'wood'; n: number }
  | { kind: 'stone'; n: number }
  | { kind: 'metal'; n: number };

/**
 * Where loot is found: on the floor, in a crate, a chest, the Golden Coop's chest, a supply drop, a fridge (healing
 * and food), a hay bale (often nothing), a chest of drawers or a bookshelf (small things, a bookshelf often nothing),
 * a police locker (a gun, armor or ammo), the police station's stash, a bank's deposit box or a bank safe (legendary).
 */
export type LootTier = 'floor' | 'crate' | 'chest' | 'gold' | 'supply' | 'fridge' | 'hay' | 'drawer' | 'books' | 'locker' | 'police' | 'deposit' | 'safe';

const RARITY_ODDS: Record<LootTier, number[]> = {
  floor: [46, 30, 16, 6, 2],
  crate: [30, 34, 22, 10, 4],
  chest: [0, 28, 40, 22, 10],
  supply: [0, 0, 25, 45, 30],
  gold: [0, 0, 0, 45, 55],
  fridge: [46, 30, 16, 6, 2],
  hay: [46, 30, 16, 6, 2],
  drawer: [56, 30, 11, 3, 0],
  books: [46, 30, 16, 6, 2],
  locker: [10, 34, 34, 16, 6],
  police: [0, 20, 40, 28, 12],
  deposit: [0, 28, 40, 22, 10],
  safe: [0, 0, 0, 25, 75],
};
const GUN_ODDS: Record<WeaponId, number> = { pistol: 13, revolver: 7, flare: 1.5, smg: 12, micro: 7, hsmg: 7, rifle: 13, burst: 8, marksman: 6, scout: 5, lmg: 4, minigun: 3, shotgun: 11, auto: 6, double: 6, sniper: 5, crossbow: 4, launcher: 4 };
/** Supply drops, the golden chest and bank safes never hold a flare gun: they are what it calls. */
const TOP_GUN_ODDS: Partial<Record<WeaponId, number>> = { ...GUN_ODDS, flare: 0 };
/** What a fridge holds: mostly things to eat and drink and patch up with. */
const FRIDGE_ODDS: Record<UseId, number> = { bandage: 28, medkit: 13, mini: 20, shield: 11, coffee: 20, smoothie: 14, tart: 1 };
const MELEE_ODDS: Partial<Record<MeleeId, number>> = { whisk: 22, knife: 20, cleaver: 18, pan: 22, pin: 18 };
const THROW_ODDS: Record<ThrowId, number> = { grenade: 36, impulse: 16, flour: 18, sauce: 20, jam: 14, bush: 12, mirv: 9, stun: 14 };
/** What the police keep to throw: mostly stun grenades. */
const POLICE_THROWS: Partial<Record<ThrowId, number>> = { stun: 60, grenade: 25, mirv: 15 };
const USE_ODDS: Record<UseId, number> = { bandage: 34, medkit: 10, mini: 24, shield: 13, coffee: 12, smoothie: 10, tart: 1 };
/** A chest's extra consumable is more often a good one, and a golden egg tart now and then. */
const CHEST_USE_ODDS: Record<UseId, number> = { ...USE_ODDS, medkit: 14, shield: 16, smoothie: 13, tart: 5 };

function rollRarity(rng: Rng, tier: LootTier) {
  const odds = RARITY_ODDS[tier];
  const total = odds.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < odds.length; i++) {
    roll -= odds[i];
    if (roll < 0) return i;
  }
  return 0;
}

/** A gun with ammo for it. */
function gunDrop(rng: Rng, tier: LootTier): LootDef[] {
  const top = tier === 'gold' || tier === 'supply' || tier === 'safe';
  const w = weighted(rng, top ? TOP_GUN_ODDS : GUN_ODDS);
  // a flare gun is always legendary and needs no ammo; launchers are never common, so one is always worth the walk
  if (w === 'flare') return [{ kind: 'gun', w, r: MAX_RARITY }];
  const r = w === 'launcher' ? Math.max(2, rollRarity(rng, tier)) : rollRarity(rng, tier);
  const a = WEAPONS[w].ammo;
  // a minigun empties a box in no time, so it comes with a second
  const boxes = (top ? 3 : tier === 'chest' || tier === 'police' ? 2 : 1) + (w === 'minigun' ? 1 : 0);
  return [
    { kind: 'gun', w, r },
    { kind: 'ammo', a, n: AMMO_BOX[a] * boxes },
  ];
}

/** A box of ammo of any kind. */
const ammoDrop = (rng: Rng): LootDef => {
  const a = weighted(rng, { light: 36, heavy: 36, shells: 20, rockets: 8 });
  return { kind: 'ammo', a, n: AMMO_BOX[a] };
};

function useDrop(rng: Rng, odds: Record<UseId, number> = USE_ODDS): LootDef {
  const w = weighted(rng, odds);
  const n = w === 'bandage' ? 2 + Math.floor(rng() * 2) : w === 'mini' && rng() < 0.4 ? 2 : 1;
  return { kind: 'use', w, n };
}

function throwDrop(rng: Rng, odds: Partial<Record<ThrowId, number>> = THROW_ODDS): LootDef {
  const w = weighted(rng, odds);
  return { kind: 'throw', w, n: (w === 'grenade' || w === 'stun') && rng() < 0.4 ? 2 : 1 };
}

const levelDrop = (rng: Rng, kind: 'scope' | 'pack', better: boolean): LootDef => {
  const roll = rng();
  const lv = better ? (roll < 0.45 ? 3 : 2) : roll < 0.55 ? 1 : roll < 0.88 ? 2 : 3;
  return { kind, lv };
};

/** Odds of each armor level by where it's found: the floor mostly level 1, the golden chest only level 3. */
const ARMOR_ODDS: Record<LootTier, number[]> = {
  floor: [0, 62, 32, 6],
  crate: [0, 45, 42, 13],
  chest: [0, 12, 56, 32],
  supply: [0, 0, 30, 70],
  gold: [0, 0, 0, 100],
  fridge: [0, 62, 32, 6],
  hay: [0, 62, 32, 6],
  drawer: [0, 62, 32, 6],
  books: [0, 62, 32, 6],
  locker: [0, 30, 50, 20],
  police: [0, 10, 50, 40],
  deposit: [0, 12, 56, 32],
  safe: [0, 0, 0, 100],
};

/** A helmet or a vest, as good as the place it's found. */
const armorDrop = (rng: Rng, tier: LootTier): LootDef => {
  const kind = rng() < 0.5 ? 'helmet' : 'vest';
  const odds = ARMOR_ODDS[tier];
  let roll = rng() * odds.reduce((a, b) => a + b, 0);
  let lv = 1;
  for (let i = 1; i < odds.length; i++) {
    roll -= odds[i];
    if (roll < 0) {
      lv = i;
      break;
    }
  }
  return { kind, lv };
};

/** What a loot spot, crate or chest holds. Deterministic for a given generator state. At most six things. */
export function rollLoot(rng: Rng, tier: LootTier): LootDef[] {
  if (tier === 'gold' || tier === 'supply') {
    // a top gun with plenty of ammo, the good potions (or a golden egg tart), something to throw, a scope or backpack,
    // and a piece of armor
    const out = gunDrop(rng, tier);
    const treat = rng();
    out.push(treat < 0.45 ? { kind: 'use', w: 'shield', n: 2 } : treat < 0.75 ? { kind: 'use', w: 'medkit', n: 2 } : { kind: 'use', w: 'tart', n: 1 });
    out.push({ kind: 'throw', w: rng() < 0.6 ? 'grenade' : 'sauce', n: 2 });
    out.push(levelDrop(rng, rng() < 0.5 ? 'scope' : 'pack', true));
    out.push(armorDrop(rng, tier));
    return out;
  }
  if (tier === 'fridge') {
    // two things from the shelves, the second one different from the first
    const a = weighted(rng, FRIDGE_ODDS);
    const b = weighted(rng, { ...FRIDGE_ODDS, [a]: 0 });
    return [a, b].map((w): LootDef => ({ kind: 'use', w, n: w === 'bandage' ? 3 : w === 'mini' ? 2 : 1 }));
  }
  if (tier === 'hay') return rng() < 0.45 ? [] : rollLoot(rng, 'floor');
  if (tier === 'safe') {
    // a legendary gun more often than not, ammo to spare, the best healing and the best armor now and then
    const out = gunDrop(rng, 'safe');
    const treat = rng();
    out.push(treat < 0.4 ? { kind: 'use', w: 'tart', n: 1 } : treat < 0.7 ? { kind: 'use', w: 'shield', n: 2 } : { kind: 'use', w: 'medkit', n: 2 });
    if (rng() < 0.4) out.push(armorDrop(rng, 'safe'));
    return out;
  }
  if (tier === 'police') {
    // the stash: a good gun with plenty of ammo, armor, and something to throw (mostly stun grenades)
    const out = gunDrop(rng, 'police');
    out.push(armorDrop(rng, 'police'));
    out.push(rng() < 0.7 ? throwDrop(rng, POLICE_THROWS) : ammoDrop(rng));
    if (rng() < 0.12) out.push({ kind: 'ghillie' });
    return out;
  }
  if (tier === 'locker') {
    // a gun with its ammo, a piece of armor, or ammo; often a stun grenade on the shelf besides
    const pick = weighted(rng, { gun: 45, armor: 35, ammo: 20 });
    const out = pickDrop(rng, 'locker', pick);
    if (rng() < 0.3) out.push(throwDrop(rng, POLICE_THROWS));
    return out;
  }
  if (tier === 'drawer') {
    // odds and ends: ammo, a bandage or a mini, now and then a pistol or a scope
    const pick = weighted(rng, { ammo: 30, use: 34, throw: 14, scope: 5, gun: 8, wood: 6, none: 3 });
    return pick === 'none' ? [] : pickDrop(rng, 'drawer', pick);
  }
  if (tier === 'books') {
    // mostly just books, but now and then something tucked behind them
    if (rng() < 0.4) return [];
    return pickDrop(rng, 'books', weighted(rng, { use: 38, throw: 26, scope: 14, pack: 12, ghillie: 4, gun: 6 }));
  }
  if (tier === 'deposit') return pickDrop(rng, 'deposit', weighted(rng, { use: 28, throw: 18, scope: 16, pack: 16, armor: 12, gun: 10 }));
  if (tier === 'chest') {
    const out = gunDrop(rng, 'chest');
    const extra = rng();
    out.push(extra < 0.4 ? useDrop(rng, CHEST_USE_ODDS) : extra < 0.6 ? throwDrop(rng) : extra < 0.83 ? armorDrop(rng, 'chest') : extra < 0.96 ? levelDrop(rng, rng() < 0.5 ? 'scope' : 'pack', false) : { kind: 'ghillie' });
    out.push({ kind: 'wood', n: 30 });
    return out;
  }
  const pick = weighted(rng, tier === 'crate' ? { gun: 37, ammo: 10, use: 19, throw: 11, melee: 5, scope: 4, pack: 4, armor: 9, wood: 4, ghillie: 1.2 } : { gun: 42, ammo: 12, use: 17, throw: 10, melee: 5, scope: 3, pack: 3, armor: 8, wood: 4, ghillie: 0.6 });
  const out = pickDrop(rng, tier, pick);
  // most crates hold a box of ammo besides
  if (tier === 'crate' && pick !== 'ammo' && rng() < 0.65) out.push(ammoDrop(rng));
  return out;
}

function pickDrop(rng: Rng, tier: LootTier, pick: string): LootDef[] {
  switch (pick) {
    case 'gun':
      return gunDrop(rng, tier);
    case 'ammo':
      return [ammoDrop(rng)];
    case 'use':
      return [useDrop(rng)];
    case 'throw':
      return [throwDrop(rng)];
    case 'melee':
      return [{ kind: 'melee', w: weighted(rng, MELEE_ODDS) }];
    case 'scope':
    case 'pack':
      return [levelDrop(rng, pick as 'scope' | 'pack', false)];
    case 'armor':
      return [armorDrop(rng, tier)];
    case 'ghillie':
      return [{ kind: 'ghillie' }];
    default:
      return [{ kind: 'wood', n: 20 }];
  }
}

const count = (n: number, one: string, many: string) => (n > 1 ? `${n} ${many}` : `a ${one}`);

/** The best of the best: a legendary gun (every flare gun is one) or a golden egg tart. It glows gold on the ground. */
export const legendary = (def: LootDef) => (def.kind === 'gun' && def.r >= MAX_RARITY) || (def.kind === 'use' && def.w === 'tart');

/** One line naming a pickup, for the interact prompt. */
export function lootName(def: LootDef) {
  switch (def.kind) {
    case 'gun':
      return `${RARITY_NAMES[clampRarity(def.r)]} ${WEAPONS[def.w].name}`;
    case 'melee':
      return MELEE[def.w].name;
    case 'throw':
      return count(def.n, THROWS[def.w].name, THROWS[def.w].plural);
    case 'ammo':
      return `${def.n} ${def.a === 'rockets' ? 'eggs' : def.a === 'shells' ? 'shells' : `${def.a} ammo`}`;
    case 'use':
      return count(def.n, USES[def.w].name, USES[def.w].plural);
    case 'scope':
      return `${SCOPES[clampInt(def.lv, 0, MAX_SCOPE)]} scope`;
    case 'pack':
      return `level ${clampInt(def.lv, 1, MAX_PACK)} backpack`;
    case 'helmet':
    case 'vest':
      return `${ARMOR_NAMES[def.kind][clampInt(def.lv, 1, MAX_ARMOR)]} (level ${clampInt(def.lv, 1, MAX_ARMOR)} ${def.kind})`;
    case 'ghillie':
      return 'ghillie suit';
    case 'wood':
    case 'stone':
    case 'metal':
      return `${def.n} ${def.kind}`;
  }
}

/** Validates a loot definition from the network. */
export function parseLoot(v: unknown): LootDef | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const n = (x: unknown, max: number) => (Number.isInteger(x) && (x as number) > 0 && (x as number) <= max ? (x as number) : null);
  switch (d.kind) {
    case 'gun': {
      if (!isWeapon(d.w) || !Number.isInteger(d.r)) return null;
      const out: LootDef = { kind: 'gun', w: d.w, r: clampRarity(d.r as number) };
      if (d.mag !== undefined) {
        if (!Number.isInteger(d.mag) || (d.mag as number) < 0 || (d.mag as number) > WEAPONS[d.w].mag) return null;
        out.mag = d.mag as number;
      }
      return out;
    }
    case 'melee':
      return isMelee(d.w) ? { kind: 'melee', w: d.w } : null;
    case 'throw': {
      const k = n(d.n, 99);
      return isThrow(d.w) && k !== null ? { kind: 'throw', w: d.w, n: k } : null;
    }
    case 'ammo': {
      const k = n(d.n, 999);
      return isAmmo(d.a) && k !== null ? { kind: 'ammo', a: d.a, n: k } : null;
    }
    case 'use': {
      const k = n(d.n, 99);
      return isUse(d.w) && k !== null ? { kind: 'use', w: d.w, n: k } : null;
    }
    case 'scope':
    case 'pack': {
      const lv = n(d.lv, d.kind === 'scope' ? MAX_SCOPE : MAX_PACK);
      return lv === null ? null : { kind: d.kind, lv };
    }
    case 'helmet':
    case 'vest': {
      const lv = n(d.lv, MAX_ARMOR);
      return lv === null ? null : { kind: d.kind, lv };
    }
    case 'wood':
    case 'stone':
    case 'metal': {
      const k = n(d.n, MAT_MAX);
      return k === null ? null : { kind: d.kind, n: k };
    }
    case 'ghillie':
      return { kind: 'ghillie' };
    default:
      return null;
  }
}
