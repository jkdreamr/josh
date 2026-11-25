// How good a piece of royale loot is, for the rings and light shafts that mark it on the ground and for the pickup
// toasts: 0 common (white), 1 good (blue), 2 the best (gold). Pure TS with no three.js, so the tests can import it.
import type { Item } from './royale.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';

export type LootTier = 0 | 1 | 2;

/** Each tier's color (sRGB): a warm white, a soft blue and a gold. */
export const TIER_COLOR: readonly [number, number, number] = [0xf1eee6, 0x6fb0ff, 0xffc443];
/** The same as CSS colors, for the HUD. */
export const TIER_CSS: readonly [string, string, string] = ['#f1eee6', '#6fb0ff', '#ffc443'];

/**
 * The tier of an item on the ground. Gold: level 3 vests, helmets and backpacks, the 4x scope, the long range guns
 * (the Longbow sniper, the Lancer marksman rifle and the Rampart machine gun), med kits and painkillers. Blue: level 2
 * gear, the other attachments, the assault rifles (Kestrel, Talon) and the ballistic shield. White: everything else
 * (level 1 gear, pistols, SMGs, shotguns, the crossbow, ammo, bandages, drinks and grenades).
 */
export function lootTier(it: Pick<Item, 'kind' | 'what'>): LootTier {
  switch (it.kind) {
    case 'vest':
    case 'helmet':
    case 'pack':
      return it.what === '3' ? 2 : it.what === '2' ? 1 : 0;
    case 'att':
      return it.what === 'x4' ? 2 : 1;
    case 'gun': {
      const w = WEAPONS[it.what as WeaponId];
      if (!w) return 0;
      return w.cls === 'sniper' || w.cls === 'dmr' || w.cls === 'lmg' ? 2 : w.cls === 'rifle' ? 1 : 0;
    }
    case 'heal':
      return it.what === 'kit' ? 2 : 0;
    case 'boost':
      return it.what === 'pills' ? 2 : 0;
    case 'shield':
      return 1;
    default:
      return 0;
  }
}
