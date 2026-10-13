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

export const WEAPON_IDS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'launcher'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export const isWeapon = (v: unknown): v is WeaponId => WEAPON_IDS.includes(v as WeaponId);

export const AMMO_TYPES = ['light', 'heavy', 'shells', 'rockets'] as const;
export type Ammo = (typeof AMMO_TYPES)[number];
export const isAmmo = (v: unknown): v is Ammo => AMMO_TYPES.includes(v as Ammo);

export type WeaponSpec = {
  name: string;
  /** Damage per bullet (per pellet for the shotgun) at common rarity. */
  dmg: number;
  /** Shots per second while the trigger is held. */
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
  /** Damage multiplier against built walls and crates. */
  wallMult: number;
  /** Walking speed multiplier while holding it. */
  move: number;
  /** Extra meters of view while holding it (the sniper scope). */
  zoom: number;
};

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { name: 'pistol', dmg: 22, rate: 4.5, mag: 14, reload: 1.3, spread: 0.035, speed: 120, range: 50, ammo: 'light', pellets: 1, wallMult: 1, move: 1, zoom: 0 },
  smg: { name: 'smg', dmg: 13, rate: 11, mag: 30, reload: 1.9, spread: 0.1, speed: 110, range: 38, ammo: 'light', pellets: 1, wallMult: 1, move: 1, zoom: 0 },
  rifle: { name: 'rifle', dmg: 27, rate: 5.5, mag: 30, reload: 2.3, spread: 0.045, speed: 140, range: 70, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.96, zoom: 2 },
  shotgun: { name: 'shotgun', dmg: 11, rate: 1.1, mag: 6, reload: 2.6, spread: 0.24, speed: 95, range: 22, ammo: 'shells', pellets: 9, falloff: { near: 7, far: 20, min: 0.35 }, wallMult: 1, move: 0.96, zoom: 0 },
  sniper: { name: 'sniper', dmg: 100, rate: 0.65, mag: 4, reload: 3, spread: 0.004, speed: 240, range: 130, ammo: 'heavy', pellets: 1, wallMult: 1, move: 0.9, zoom: 14 },
  launcher: { name: 'egg launcher', dmg: 80, rate: 0.6, mag: 1, reload: 2.8, spread: 0.015, speed: 48, range: 80, ammo: 'rockets', pellets: 1, splash: 4.5, wallMult: 3, move: 0.9, zoom: 4 },
};

/** The spatula everyone carries: a swing that hits eggs, breaks crates and walls, and chops wood from trees. */
export const SPATULA = { dmg: 30, rate: 2, range: 2.2, arc: 1, wood: 6, wallMult: 1.5 };

export const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export const RARITY_COLORS = ['#b8bec7', '#4cc261', '#3f8cff', '#b05cf7', '#f5a623'] as const;
const DMG_MULT = [1, 1.07, 1.14, 1.21, 1.3];
const RELOAD_MULT = [1, 0.95, 0.9, 0.85, 0.8];
export const MAX_RARITY = 4;
export const clampRarity = (r: number) => Math.max(0, Math.min(MAX_RARITY, Math.round(Number.isFinite(r) ? r : 0)));
export const damageOf = (w: WeaponId, rarity: number) => Math.round(WEAPONS[w].dmg * DMG_MULT[clampRarity(rarity)] * 10) / 10;
export const reloadOf = (w: WeaponId, rarity: number) => WEAPONS[w].reload * RELOAD_MULT[clampRarity(rarity)];

export const AMMO_MAX: Record<Ammo, number> = { light: 240, heavy: 120, shells: 48, rockets: 12 };
/** How much one ammo box holds. */
export const AMMO_BOX: Record<Ammo, number> = { light: 30, heavy: 20, shells: 10, rockets: 3 };

export const BANDAGE = { heal: 25, time: 2.2, max: 6 };
export const SHIELD = { gain: 50, time: 3, max: 3 };
export const HP_MAX = 100;
export const SHIELD_MAX = 100;
export const WOOD_MAX = 300;
export const WALL_COST = 10;

export type LootDef =
  | { kind: 'gun'; w: WeaponId; r: number; mag?: number }
  | { kind: 'ammo'; a: Ammo; n: number }
  | { kind: 'bandage'; n: number }
  | { kind: 'shield'; n: number }
  | { kind: 'wood'; n: number };

export type LootTier = 'floor' | 'crate' | 'chest';

const RARITY_ODDS: Record<LootTier, number[]> = {
  floor: [46, 30, 16, 6, 2],
  crate: [30, 34, 22, 10, 4],
  chest: [0, 28, 40, 22, 10],
};
const GUN_ODDS: Record<WeaponId, number> = { pistol: 22, smg: 20, rifle: 22, shotgun: 18, sniper: 9, launcher: 6 };

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

/** A gun with an ammo box for it. */
function gunDrop(rng: Rng, tier: LootTier): LootDef[] {
  const w = weighted(rng, GUN_ODDS);
  // launchers are never common, so one is always worth the walk
  const r = w === 'launcher' ? Math.max(2, rollRarity(rng, tier)) : rollRarity(rng, tier);
  const a = WEAPONS[w].ammo;
  return [
    { kind: 'gun', w, r },
    { kind: 'ammo', a, n: AMMO_BOX[a] * (tier === 'chest' ? 2 : 1) },
  ];
}

/** What a loot spot, crate or chest holds. Deterministic for a given generator state. */
export function rollLoot(rng: Rng, tier: LootTier): LootDef[] {
  if (tier === 'chest') {
    const out = gunDrop(rng, 'chest');
    out.push(rng() < 0.5 ? { kind: 'shield', n: 1 } : { kind: 'bandage', n: 2 });
    out.push({ kind: 'wood', n: 30 });
    return out;
  }
  const pick = weighted(rng, tier === 'crate' ? { gun: 45, ammo: 15, bandage: 18, shield: 12, wood: 10 } : { gun: 58, ammo: 16, bandage: 14, shield: 8, wood: 4 });
  if (pick === 'gun') return gunDrop(rng, tier);
  if (pick === 'ammo') {
    const a = weighted(rng, { light: 40, heavy: 30, shells: 22, rockets: 8 });
    return [{ kind: 'ammo', a, n: AMMO_BOX[a] }];
  }
  if (pick === 'bandage') return [{ kind: 'bandage', n: rng() < 0.4 ? 2 : 1 }];
  if (pick === 'shield') return [{ kind: 'shield', n: 1 }];
  return [{ kind: 'wood', n: 20 }];
}

/** One line naming a pickup, for the interact prompt and the How to Play sheet. */
export function lootName(def: LootDef) {
  switch (def.kind) {
    case 'gun':
      return `${RARITY_NAMES[clampRarity(def.r)]} ${WEAPONS[def.w].name}`;
    case 'ammo':
      return `${def.n} ${def.a === 'rockets' ? 'eggs' : def.a === 'shells' ? 'shells' : `${def.a} ammo`}`;
    case 'bandage':
      return def.n > 1 ? `${def.n} bandages` : 'a bandage';
    case 'shield':
      return def.n > 1 ? `${def.n} shield potions` : 'a shield potion';
    case 'wood':
      return `${def.n} wood`;
  }
}

/** Validates a loot definition from the network. */
export function parseLoot(v: unknown): LootDef | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const count = (n: unknown, max: number) => (Number.isInteger(n) && (n as number) > 0 && (n as number) <= max ? (n as number) : null);
  if (d.kind === 'gun') {
    if (!isWeapon(d.w) || !Number.isInteger(d.r)) return null;
    const out: LootDef = { kind: 'gun', w: d.w, r: clampRarity(d.r as number) };
    if (d.mag !== undefined) {
      if (!Number.isInteger(d.mag) || (d.mag as number) < 0 || (d.mag as number) > WEAPONS[d.w].mag) return null;
      out.mag = d.mag as number;
    }
    return out;
  }
  if (d.kind === 'ammo') {
    const n = count(d.n, 999);
    return isAmmo(d.a) && n !== null ? { kind: 'ammo', a: d.a, n } : null;
  }
  if (d.kind === 'bandage' || d.kind === 'shield' || d.kind === 'wood') {
    const n = count(d.n, d.kind === 'wood' ? WOOD_MAX : 20);
    return n === null ? null : { kind: d.kind, n };
  }
  return null;
}
