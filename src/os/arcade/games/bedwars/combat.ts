// Combat math, Minecraft 1.8 and Hypixel flavored: weapon damage, critical hits, armor and protection, the half
// second of hurt immunity, and knockback with the sprint bonus. Pure, so it runs under node.
import type { Body } from './physics.ts';
import type { Item } from './items.ts';

/** Melee damage of a held item (half hearts), with Sharpness I from the team upgrade. */
export function weaponDamage(item: Item | null, pickTier: number, axeTier: number, sharp: number): number {
  let d = 1;
  switch (item) {
    case 'sword_wood':
      d = 5;
      break;
    case 'sword_stone':
      d = 6;
      break;
    case 'sword_iron':
      d = 7;
      break;
    case 'sword_diamond':
      d = 8;
      break;
    case 'axe':
      d = [1, 4, 5, 6, 7][axeTier] ?? 1;
      break;
    case 'pick':
      d = [1, 3, 4, 3, 5][pickTier] ?? 1;
      break;
    default:
      d = 1;
  }
  const sword = item === 'sword_wood' || item === 'sword_stone' || item === 'sword_iron' || item === 'sword_diamond' || item === 'axe';
  // the golden pickaxe comes with sharpness II in Bed Wars
  if (item === 'pick' && pickTier === 3) d += 2.5;
  if (sword && sharp > 0) d += 1.25 * sharp;
  return d;
}

/** Knockback enchant level of a held item. */
export const knockbackLevel = (item: Item | null) => (item === 'kb_stick' ? 1 : 0);

/**
 * Armor points: Bed Wars players always wear a leather helmet and chestplate (1 + 3); the leggings and boots are
 * leather (2 + 1), chainmail (4 + 1), iron (5 + 2) or diamond (6 + 3).
 */
export function armorPoints(tier: number): number {
  return 4 + [3, 5, 7, 9][Math.max(0, Math.min(3, tier))];
}

/** Protection from Reinforced Armor: Minecraft's EPF on four pieces, averaged over its random roll. */
export function protectionFactor(prot: number): number {
  if (prot <= 0) return 1;
  const perPiece = Math.floor(((6 + prot * prot) * 0.75) / 3);
  const epf = Math.min(25, perPiece * 4);
  const avg = Math.min(20, epf * 0.75);
  return 1 - avg * 0.04;
}

export type DamageCause = 'melee' | 'arrow' | 'explosion' | 'fall' | 'void' | 'pearl' | 'magic';

/** Damage after armor (which does not stop falls) and protection. */
export function reduceDamage(amount: number, cause: DamageCause, armorTier: number, prot: number): number {
  if (cause === 'void' || cause === 'magic') return amount;
  let d = amount;
  if (cause !== 'fall' && cause !== 'pearl') d *= (25 - armorPoints(armorTier)) / 25;
  d *= protectionFactor(prot);
  return d;
}

/** Hurt immunity: 20 ticks after a hit, of which the first 10 block anything that is not harder than the last hit. */
export const HURT_TICKS = 20;

export type HurtState = { hurtTicks: number; lastDamage: number };

/**
 * Applies Minecraft's hurt immunity. Returns the damage that actually lands (0 when blocked) and whether knockback
 * should be applied (only for a fresh hit, not for a harder hit inside the window).
 */
export function hurtFilter(s: HurtState, amount: number): { dealt: number; knock: boolean } {
  if (s.hurtTicks > HURT_TICKS / 2) {
    if (amount <= s.lastDamage) return { dealt: 0, knock: false };
    const dealt = amount - s.lastDamage;
    s.lastDamage = amount;
    return { dealt, knock: false };
  }
  s.lastDamage = amount;
  s.hurtTicks = HURT_TICKS;
  return { dealt: amount, knock: true };
}

/** Is the attacker falling (a critical hit)? */
export const isCrit = (b: Body) => b.vy < 0 && !b.onGround && !b.onLadder && b.fallDistance > 0;

/** The knockback a hit sends, as data the victim's owner applies to its own body. */
export type Knock = {
  /** Unit direction from the victim toward the attacker (x, z). */
  dx: number;
  dz: number;
  /** Extra velocity added afterwards (sprint or knockback enchant, punch, explosions). */
  ex: number;
  ey: number;
  ez: number;
  /** false: only add the extra (explosions), true: the classic halve-and-push first. */
  base: boolean;
};

/** Knockback from a melee hit: 0.4 away from the attacker, plus 0.5 along the attacker's look per sprint or enchant level. */
export function meleeKnock(victim: Body, attacker: Body, level: number): Knock {
  let dx = attacker.x - victim.x;
  let dz = attacker.z - victim.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  if (Math.hypot(attacker.x - victim.x, attacker.z - victim.z) < 1e-4) {
    dx = Math.sin(attacker.yaw);
    dz = Math.cos(attacker.yaw);
  }
  const ex = level > 0 ? -Math.sin(attacker.yaw) * level * 0.5 : 0;
  const ez = level > 0 ? -Math.cos(attacker.yaw) * level * 0.5 : 0;
  return { dx, dz, ex, ey: level > 0 ? 0.1 : 0, ez, base: true };
}

/** Minecraft's knockBack(): halve the velocity, push 0.4 away and 0.4 up (capped), then add the extras. */
export function applyKnock(b: Body, k: Knock) {
  if (k.base) {
    b.vx /= 2;
    b.vy /= 2;
    b.vz /= 2;
    b.vx -= k.dx * 0.4;
    b.vz -= k.dz * 0.4;
    b.vy += 0.4;
    if (b.vy > 0.4) b.vy = 0.4;
  }
  b.vx += k.ex;
  b.vy += k.ey;
  b.vz += k.ez;
  b.onGround = false;
}

/** Arrow damage from its speed (blocks per tick): Minecraft's ceil(speed * 2) with Power adding half a heart per level and more. */
export function arrowDamage(speed: number, power: number, full: boolean): number {
  const base = 2 + (power > 0 ? power * 0.5 + 0.5 : 0);
  let d = Math.ceil(speed * base);
  if (full) d += Math.round(d * 0.25);
  return d;
}

/** Fall damage on landing: the first three blocks are free, Jump Boost forgives a block a level. */
export const fallDamage = (distance: number, jump: number) => Math.max(0, Math.ceil(distance - 3 - jump));
