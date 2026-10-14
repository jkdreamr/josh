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

export const WEAPON_IDS = ['pistol', 'revolver', 'smg', 'micro', 'rifle', 'burst', 'scout', 'lmg', 'shotgun', 'auto', 'double', 'sniper', 'crossbow', 'launcher'] as const;
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
};

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { name: 'pistol', cls: 'pistol', dmg: 22, rate: 4.5, mag: 14, reload: 1.3, spread: 0.035, speed: 120, range: 50, ammo: 'light', pellets: 1, wallMult: 1, move: 1, zoom: 0 },
  revolver: { name: 'hand cannon', cls: 'pistol', dmg: 46, rate: 1.7, mag: 7, reload: 2, spread: 0.02, speed: 160, range: 62, ammo: 'heavy', pellets: 1, wallMult: 1.2, move: 1, zoom: 2 },
  smg: { name: 'SMG', cls: 'smg', dmg: 13, rate: 11, mag: 30, reload: 1.9, spread: 0.1, speed: 110, range: 38, ammo: 'light', pellets: 1, wallMult: 1, move: 1, zoom: 0 },
  micro: { name: 'micro SMG', cls: 'smg', dmg: 10, rate: 16, mag: 24, reload: 1.6, spread: 0.14, speed: 105, range: 30, ammo: 'light', pellets: 1, wallMult: 1, move: 1.04, zoom: 0 },
  rifle: { name: 'rifle', cls: 'rifle', dmg: 27, rate: 5.5, mag: 30, reload: 2.3, spread: 0.045, speed: 140, range: 70, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.96, zoom: 2 },
  burst: { name: 'burst rifle', cls: 'rifle', dmg: 25, rate: 1.9, mag: 30, reload: 2.4, spread: 0.03, speed: 150, range: 75, ammo: 'heavy', pellets: 1, burst: { n: 3, gap: 0.075 }, wallMult: 1, move: 0.96, zoom: 3 },
  scout: { name: 'scout rifle', cls: 'sniper', dmg: 48, rate: 2.2, mag: 10, reload: 2.5, spread: 0.01, speed: 190, range: 100, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.94, zoom: 8 },
  lmg: { name: 'machine gun', cls: 'heavy', dmg: 21, rate: 9.5, mag: 80, reload: 4.6, spread: 0.09, speed: 135, range: 65, ammo: 'heavy', pellets: 1, wallMult: 1.3, move: 0.82, zoom: 2 },
  shotgun: { name: 'pump shotgun', cls: 'shotgun', dmg: 11, rate: 1.1, mag: 6, reload: 2.6, spread: 0.24, speed: 95, range: 22, ammo: 'shells', pellets: 9, falloff: { near: 7, far: 20, min: 0.35 }, wallMult: 1, move: 0.96, zoom: 0 },
  auto: { name: 'auto shotgun', cls: 'shotgun', dmg: 8.5, rate: 3.3, mag: 8, reload: 3, spread: 0.22, speed: 95, range: 20, ammo: 'shells', pellets: 6, falloff: { near: 6, far: 18, min: 0.35 }, wallMult: 1, move: 0.95, zoom: 0 },
  double: { name: 'double barrel', cls: 'shotgun', dmg: 12, rate: 5, mag: 2, reload: 2.3, spread: 0.3, speed: 90, range: 16, ammo: 'shells', pellets: 10, falloff: { near: 5, far: 14, min: 0.3 }, wallMult: 1, move: 0.98, zoom: 0 },
  sniper: { name: 'sniper', cls: 'sniper', dmg: 100, rate: 0.65, mag: 4, reload: 3, spread: 0.004, speed: 240, range: 130, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.9, zoom: 14 },
  crossbow: { name: 'crossbow', cls: 'sniper', dmg: 82, rate: 1, mag: 1, reload: 1.5, spread: 0.006, speed: 85, range: 90, ammo: 'heavy', pellets: 1, silent: true, wallMult: 1, move: 0.96, zoom: 6 },
  launcher: { name: 'egg launcher', cls: 'heavy', dmg: 80, rate: 0.6, mag: 1, reload: 2.8, spread: 0.015, speed: 48, range: 80, ammo: 'rockets', pellets: 1, splash: 4.5, wallMult: 3, move: 0.9, zoom: 4 },
};

export const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export const RARITY_COLORS = ['#b8bec7', '#4cc261', '#3f8cff', '#b05cf7', '#f5a623'] as const;
const DMG_MULT = [1, 1.07, 1.14, 1.21, 1.3];
const RELOAD_MULT = [1, 0.95, 0.9, 0.85, 0.8];
export const MAX_RARITY = 4;
export const clampRarity = (r: number) => clampInt(r, 0, MAX_RARITY);
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

export const THROW_IDS = ['grenade', 'flour', 'sauce'] as const;
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
  /** Flour and hot sauce: seconds the cloud or the puddle lasts, and the puddle's burn per second. */
  time?: number;
  dps?: number;
};

export const THROWS: Record<ThrowId, ThrowSpec> = {
  grenade: { name: 'grenade', plural: 'grenades', carry: 3, radius: 5.5, fuse: 2.2, dmg: 90 },
  flour: { name: 'flour bomb', plural: 'flour bombs', carry: 2, radius: 6.5, time: 11 },
  sauce: { name: 'hot sauce', plural: 'hot sauces', carry: 2, radius: 3.8, time: 6, dps: 12 },
};
/** How far a throw lands (meters), how fast it flies, and the wait before the next one. */
export const THROW = { min: 3, max: 20, speed: 17, cool: 0.7 };

// ---------------------------------------------------------------------------------------------------------------------
// Consumables.

export const USE_IDS = ['bandage', 'medkit', 'mini', 'shield', 'coffee'] as const;
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
};

export const USES: Record<UseId, UseSpec> = {
  bandage: { name: 'bandage', plural: 'bandages', time: 2.4, carry: 10, hp: 15, hpCap: 75 },
  medkit: { name: 'medkit', plural: 'medkits', time: 6, carry: 2, hp: 100, hpCap: 100 },
  mini: { name: 'mini shield', plural: 'mini shields', time: 2, carry: 4, shield: 25, shieldCap: 50 },
  shield: { name: 'shield potion', plural: 'shield potions', time: 4, carry: 2, shield: 50, shieldCap: 100 },
  coffee: { name: 'coffee', plural: 'coffees', time: 2.5, carry: 2, boost: 50 },
};
/** Boost drains this much a second, healing `heal` health a second and putting a spring in your step while it lasts. */
export const BOOST = { max: 100, drain: 2.5, heal: 1.2, speed: 1.08 };

export const HP_MAX = 100;
export const SHIELD_MAX = 100;
export const WOOD_MAX = 300;
export const WALL_COST = 10;

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
// Loot.

export type LootDef =
  | { kind: 'gun'; w: WeaponId; r: number; mag?: number }
  | { kind: 'melee'; w: MeleeId }
  | { kind: 'throw'; w: ThrowId; n: number }
  | { kind: 'ammo'; a: Ammo; n: number }
  | { kind: 'use'; w: UseId; n: number }
  | { kind: 'scope'; lv: number }
  | { kind: 'pack'; lv: number }
  | { kind: 'wood'; n: number };

/** Where loot is found: on the floor, in a crate, a chest, the Golden Coop's chest, or a supply drop. */
export type LootTier = 'floor' | 'crate' | 'chest' | 'gold' | 'supply';

const RARITY_ODDS: Record<LootTier, number[]> = {
  floor: [46, 30, 16, 6, 2],
  crate: [30, 34, 22, 10, 4],
  chest: [0, 28, 40, 22, 10],
  supply: [0, 0, 25, 45, 30],
  gold: [0, 0, 0, 45, 55],
};
const GUN_ODDS: Record<WeaponId, number> = { pistol: 14, revolver: 7, smg: 13, micro: 8, rifle: 14, burst: 9, scout: 6, lmg: 5, shotgun: 12, auto: 6, double: 7, sniper: 5, crossbow: 4, launcher: 4 };
const MELEE_ODDS: Partial<Record<MeleeId, number>> = { whisk: 22, knife: 20, cleaver: 18, pan: 22, pin: 18 };
const THROW_ODDS: Record<ThrowId, number> = { grenade: 45, flour: 25, sauce: 30 };
const USE_ODDS: Record<UseId, number> = { bandage: 36, medkit: 10, mini: 26, shield: 14, coffee: 14 };

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
  const w = weighted(rng, GUN_ODDS);
  // launchers are never common, so one is always worth the walk
  const r = w === 'launcher' ? Math.max(2, rollRarity(rng, tier)) : rollRarity(rng, tier);
  const a = WEAPONS[w].ammo;
  const boxes = tier === 'gold' || tier === 'supply' ? 3 : tier === 'chest' ? 2 : 1;
  return [
    { kind: 'gun', w, r },
    { kind: 'ammo', a, n: AMMO_BOX[a] * boxes },
  ];
}

function useDrop(rng: Rng): LootDef {
  const w = weighted(rng, USE_ODDS);
  const n = w === 'bandage' ? 2 + Math.floor(rng() * 2) : w === 'mini' && rng() < 0.4 ? 2 : 1;
  return { kind: 'use', w, n };
}

function throwDrop(rng: Rng): LootDef {
  const w = weighted(rng, THROW_ODDS);
  return { kind: 'throw', w, n: w === 'grenade' && rng() < 0.4 ? 2 : 1 };
}

const levelDrop = (rng: Rng, kind: 'scope' | 'pack', better: boolean): LootDef => {
  const roll = rng();
  const lv = better ? (roll < 0.45 ? 3 : 2) : roll < 0.55 ? 1 : roll < 0.88 ? 2 : 3;
  return { kind, lv };
};

/** What a loot spot, crate or chest holds. Deterministic for a given generator state. At most five things. */
export function rollLoot(rng: Rng, tier: LootTier): LootDef[] {
  if (tier === 'gold' || tier === 'supply') {
    // a top gun with plenty of ammo, the good potions, something to throw and a scope or backpack
    const out = gunDrop(rng, tier);
    out.push(rng() < 0.55 ? { kind: 'use', w: 'shield', n: 2 } : { kind: 'use', w: 'medkit', n: 2 });
    out.push({ kind: 'throw', w: rng() < 0.6 ? 'grenade' : 'sauce', n: 2 });
    out.push(levelDrop(rng, rng() < 0.5 ? 'scope' : 'pack', true));
    return out;
  }
  if (tier === 'chest') {
    const out = gunDrop(rng, 'chest');
    const extra = rng();
    out.push(extra < 0.55 ? useDrop(rng) : extra < 0.8 ? throwDrop(rng) : levelDrop(rng, rng() < 0.5 ? 'scope' : 'pack', false));
    out.push({ kind: 'wood', n: 30 });
    return out;
  }
  const pick = weighted(rng, tier === 'crate' ? { gun: 40, ammo: 12, use: 20, throw: 10, melee: 5, scope: 5, pack: 4, wood: 4 } : { gun: 46, ammo: 13, use: 18, throw: 8, melee: 5, scope: 3, pack: 3, wood: 4 });
  switch (pick) {
    case 'gun':
      return gunDrop(rng, tier);
    case 'ammo': {
      const a = weighted(rng, { light: 36, heavy: 36, shells: 20, rockets: 8 });
      return [{ kind: 'ammo', a, n: AMMO_BOX[a] }];
    }
    case 'use':
      return [useDrop(rng)];
    case 'throw':
      return [throwDrop(rng)];
    case 'melee':
      return [{ kind: 'melee', w: weighted(rng, MELEE_ODDS) }];
    case 'scope':
    case 'pack':
      return [levelDrop(rng, pick, false)];
    default:
      return [{ kind: 'wood', n: 20 }];
  }
}

const count = (n: number, one: string, many: string) => (n > 1 ? `${n} ${many}` : `a ${one}`);

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
    case 'wood':
      return `${def.n} wood`;
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
    case 'wood': {
      const k = n(d.n, WOOD_MAX);
      return k === null ? null : { kind: 'wood', n: k };
    }
    default:
      return null;
  }
}
