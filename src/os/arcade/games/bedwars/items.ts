// Items, inventories and the item shop with Hypixel's prices. Pure, so it runs under node.
import { CLAY, END_STONE, LADDER, OBSIDIAN, PLANKS, SGLASS, TILE, WOOL, type TileName } from './blocks.ts';

export type Res = 'iron' | 'gold' | 'diamond' | 'emerald';
export const RESOURCES: readonly Res[] = ['iron', 'gold', 'diamond', 'emerald'];
export const RES_COLOR: Record<Res, string> = { iron: '#e6e6e6', gold: '#f5d23a', diamond: '#4fe0d6', emerald: '#3fd16a' };

export const ITEMS = [
  'wool',
  'clay',
  'glass',
  'wood',
  'endstone',
  'ladder',
  'obsidian',
  'sword_wood',
  'sword_stone',
  'sword_iron',
  'sword_diamond',
  'kb_stick',
  'pick',
  'axe',
  'shears',
  'bow',
  'bow_power',
  'bow_punch',
  'arrow',
  'fireball',
  'tnt',
  'gapple',
  'pearl',
  'egg',
  'speed',
  'jump',
  'invis',
  'iron',
  'gold',
  'diamond',
  'emerald',
] as const;
export type Item = (typeof ITEMS)[number];
export const itemIndex = (i: Item) => ITEMS.indexOf(i);
export const isItem = (v: unknown): v is Item => typeof v === 'string' && (ITEMS as readonly string[]).includes(v);

export type ItemKind = 'block' | 'sword' | 'tool' | 'bow' | 'ammo' | 'throw' | 'use' | 'res';
export type ItemDef = { name: string; kind: ItemKind; stack: number; tile: TileName };

export const ITEM_DEFS: Record<Item, ItemDef> = {
  wool: { name: 'Wool', kind: 'block', stack: 64, tile: 'wool_0' },
  clay: { name: 'Hardened Clay', kind: 'block', stack: 64, tile: 'clay_0' },
  glass: { name: 'Blast-Proof Glass', kind: 'block', stack: 64, tile: 'sglass_0' },
  wood: { name: 'Wood', kind: 'block', stack: 64, tile: 'planks' },
  endstone: { name: 'End Stone', kind: 'block', stack: 64, tile: 'end_stone' },
  ladder: { name: 'Ladder', kind: 'block', stack: 64, tile: 'ladder' },
  obsidian: { name: 'Obsidian', kind: 'block', stack: 64, tile: 'obsidian' },
  sword_wood: { name: 'Wooden Sword', kind: 'sword', stack: 1, tile: 'sword_wood' },
  sword_stone: { name: 'Stone Sword', kind: 'sword', stack: 1, tile: 'sword_stone' },
  sword_iron: { name: 'Iron Sword', kind: 'sword', stack: 1, tile: 'sword_iron' },
  sword_diamond: { name: 'Diamond Sword', kind: 'sword', stack: 1, tile: 'sword_diamond' },
  kb_stick: { name: 'Knockback Stick', kind: 'sword', stack: 1, tile: 'kb_stick' },
  pick: { name: 'Pickaxe', kind: 'tool', stack: 1, tile: 'pick_wood' },
  axe: { name: 'Axe', kind: 'tool', stack: 1, tile: 'axe_wood' },
  shears: { name: 'Shears', kind: 'tool', stack: 1, tile: 'shears' },
  bow: { name: 'Bow', kind: 'bow', stack: 1, tile: 'bow' },
  bow_power: { name: 'Bow (Power I)', kind: 'bow', stack: 1, tile: 'bow' },
  bow_punch: { name: 'Bow (Power I, Punch I)', kind: 'bow', stack: 1, tile: 'bow' },
  arrow: { name: 'Arrow', kind: 'ammo', stack: 64, tile: 'arrow' },
  fireball: { name: 'Fireball', kind: 'throw', stack: 64, tile: 'fireball' },
  tnt: { name: 'TNT', kind: 'throw', stack: 64, tile: 'tnt_side' },
  gapple: { name: 'Golden Apple', kind: 'use', stack: 64, tile: 'gapple' },
  pearl: { name: 'Ender Pearl', kind: 'throw', stack: 16, tile: 'pearl' },
  egg: { name: 'Bridge Egg', kind: 'throw', stack: 16, tile: 'egg' },
  speed: { name: 'Speed II Potion (45s)', kind: 'use', stack: 1, tile: 'potion_speed' },
  jump: { name: 'Jump V Potion (45s)', kind: 'use', stack: 1, tile: 'potion_jump' },
  invis: { name: 'Invisibility Potion (30s)', kind: 'use', stack: 1, tile: 'potion_invis' },
  iron: { name: 'Iron', kind: 'res', stack: 64, tile: 'iron' },
  gold: { name: 'Gold', kind: 'res', stack: 64, tile: 'gold' },
  diamond: { name: 'Diamond', kind: 'res', stack: 64, tile: 'diamond' },
  emerald: { name: 'Emerald', kind: 'res', stack: 64, tile: 'emerald' },
};

export const isRes = (i: Item): i is Res => i === 'iron' || i === 'gold' || i === 'diamond' || i === 'emerald';
export const isBlockItem = (i: Item) => ITEM_DEFS[i].kind === 'block';
export const isSword = (i: Item) => ITEM_DEFS[i].kind === 'sword';
export const isBow = (i: Item) => ITEM_DEFS[i].kind === 'bow';

/** The block a block item places for a team (wool, clay and glass come in the team's color). */
export function blockFor(item: Item, team: number): number {
  switch (item) {
    case 'wool':
      return WOOL + team;
    case 'clay':
      return CLAY + team;
    case 'glass':
      return SGLASS + team;
    case 'wood':
      return PLANKS;
    case 'endstone':
      return END_STONE;
    case 'obsidian':
      return OBSIDIAN;
    case 'ladder':
      return LADDER;
    default:
      return 0;
  }
}

export const PICK_NAMES = ['', 'Wooden Pickaxe', 'Iron Pickaxe', 'Golden Pickaxe', 'Diamond Pickaxe'];
export const AXE_NAMES = ['', 'Wooden Axe', 'Stone Axe', 'Iron Axe', 'Diamond Axe'];
export const PICK_TILES: TileName[] = ['pick_wood', 'pick_wood', 'pick_iron', 'pick_gold', 'pick_diamond'];
export const AXE_TILES: TileName[] = ['axe_wood', 'axe_wood', 'axe_stone', 'axe_iron', 'axe_diamond'];
export const ARMOR_NAMES = ['Leather', 'Chainmail', 'Iron', 'Diamond'];

/** The tile that shows an item, accounting for tool tiers and team colors. */
export function itemTile(item: Item, team = 0, tier = 1): number {
  if (item === 'pick') return TILE[PICK_TILES[Math.max(1, tier)]];
  if (item === 'axe') return TILE[AXE_TILES[Math.max(1, tier)]];
  if (item === 'wool') return TILE[`wool_${team}` as TileName];
  if (item === 'clay') return TILE[`clay_${team}` as TileName];
  if (item === 'glass') return TILE[`sglass_${team}` as TileName];
  return TILE[ITEM_DEFS[item].tile];
}

// ---------------------------------------------------------------------------------------------------------------
// Inventory: 9 hotbar slots and 9 more behind them. Resources live in a wallet.

export type Stack = { item: Item; n: number };
export const SLOTS = 18;
export const HOTBAR = 9;
export type Wallet = Record<Res, number>;
export const emptyWallet = (): Wallet => ({ iron: 0, gold: 0, diamond: 0, emerald: 0 });

export type Inventory = {
  slots: (Stack | null)[];
  wallet: Wallet;
  /** Armor tier: 0 leather, 1 chainmail, 2 iron, 3 diamond (permanent). */
  armor: number;
  /** Tool tiers 0 none, 1..4 (lose one on death, never below 1). */
  pick: number;
  axe: number;
  shears: boolean;
};

export function freshInventory(): Inventory {
  const slots: (Stack | null)[] = Array(SLOTS).fill(null);
  slots[0] = { item: 'sword_wood', n: 1 };
  return { slots, wallet: emptyWallet(), armor: 0, pick: 0, axe: 0, shears: false };
}

export const countOf = (inv: Inventory, item: Item) => inv.slots.reduce((n, s) => n + (s && s.item === item ? s.n : 0), 0);
export const hasItem = (inv: Inventory, item: Item) => inv.slots.some((s) => s?.item === item);

/** Adds items, stacking first, then into the first free hotbar slot, then the back row. Returns how many did not fit. */
export function addItem(inv: Inventory, item: Item, n: number, prefer = -1): number {
  const max = ITEM_DEFS[item].stack;
  for (const s of inv.slots) {
    if (n <= 0) break;
    if (s && s.item === item && s.n < max) {
      const k = Math.min(n, max - s.n);
      s.n += k;
      n -= k;
    }
  }
  if (n > 0 && prefer >= 0 && prefer < SLOTS && !inv.slots[prefer]) {
    const k = Math.min(n, max);
    inv.slots[prefer] = { item, n: k };
    n -= k;
  }
  for (let i = 0; i < SLOTS && n > 0; i++) {
    if (inv.slots[i]) continue;
    const k = Math.min(n, max);
    inv.slots[i] = { item, n: k };
    n -= k;
  }
  return n;
}

/** Takes n of an item from a slot (or anywhere when slot is -1). Returns how many were taken. */
export function takeItem(inv: Inventory, item: Item, n: number, slot = -1): number {
  let got = 0;
  const order = slot >= 0 ? [slot, ...inv.slots.keys()] : [...inv.slots.keys()];
  for (const i of order) {
    const s = inv.slots[i];
    if (!s || s.item !== item || got >= n) continue;
    const k = Math.min(s.n, n - got);
    s.n -= k;
    got += k;
    if (s.n === 0) inv.slots[i] = null;
  }
  return got;
}

/** What you keep when you die: tools one tier down, shears, and a wooden sword. */
export function inventoryAfterDeath(inv: Inventory): Inventory {
  const next = freshInventory();
  next.armor = inv.armor;
  next.pick = inv.pick > 1 ? inv.pick - 1 : inv.pick;
  next.axe = inv.axe > 1 ? inv.axe - 1 : inv.axe;
  next.shears = inv.shears;
  // tools go back where they were if that slot is free
  const where = (item: Item) => inv.slots.findIndex((s) => s?.item === item);
  for (const item of ['pick', 'axe', 'shears'] as const) {
    const have = item === 'pick' ? next.pick > 0 : item === 'axe' ? next.axe > 0 : next.shears;
    if (!have) continue;
    const at = where(item);
    addItem(next, item, 1, at > 0 ? at : -1);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// The item shop

export type ShopCat = 'quick' | 'blocks' | 'melee' | 'armor' | 'tools' | 'ranged' | 'potions' | 'utility';
export const SHOP_CATS: { id: ShopCat; name: string }[] = [
  { id: 'quick', name: 'Quick Buy' },
  { id: 'blocks', name: 'Blocks' },
  { id: 'melee', name: 'Melee' },
  { id: 'armor', name: 'Armor' },
  { id: 'tools', name: 'Tools' },
  { id: 'ranged', name: 'Ranged' },
  { id: 'potions', name: 'Potions' },
  { id: 'utility', name: 'Utility' },
];

export type Offer = {
  id: string;
  name: string;
  cat: Exclude<ShopCat, 'quick'>;
  res: Res;
  cost: number;
  /** Items handed over, or a permanent upgrade. */
  give: { item: Item; n: number } | { armor: number } | { tool: 'pick' | 'axe' } | { shears: true };
  desc: string;
};

export const OFFERS: Offer[] = [
  { id: 'wool', name: 'Wool', cat: 'blocks', res: 'iron', cost: 4, give: { item: 'wool', n: 16 }, desc: 'great for bridging across islands. takes on your team color.' },
  { id: 'clay', name: 'Hardened Clay', cat: 'blocks', res: 'iron', cost: 12, give: { item: 'clay', n: 16 }, desc: 'basic block to defend your bed.' },
  { id: 'glass', name: 'Blast-Proof Glass', cat: 'blocks', res: 'iron', cost: 12, give: { item: 'glass', n: 4 }, desc: 'immune to explosions.' },
  { id: 'endstone', name: 'End Stone', cat: 'blocks', res: 'iron', cost: 24, give: { item: 'endstone', n: 12 }, desc: 'solid block to defend your bed.' },
  { id: 'ladder', name: 'Ladder', cat: 'blocks', res: 'iron', cost: 4, give: { item: 'ladder', n: 8 }, desc: 'useful to save cats stuck in trees.' },
  { id: 'wood', name: 'Wood', cat: 'blocks', res: 'gold', cost: 4, give: { item: 'wood', n: 16 }, desc: 'good block to defend your bed. strong against pickaxes.' },
  { id: 'obsidian', name: 'Obsidian', cat: 'blocks', res: 'emerald', cost: 4, give: { item: 'obsidian', n: 4 }, desc: 'extreme protection for your bed.' },
  { id: 'sword_stone', name: 'Stone Sword', cat: 'melee', res: 'iron', cost: 10, give: { item: 'sword_stone', n: 1 }, desc: '6 damage. replaces your wooden sword.' },
  { id: 'sword_iron', name: 'Iron Sword', cat: 'melee', res: 'gold', cost: 7, give: { item: 'sword_iron', n: 1 }, desc: '7 damage.' },
  { id: 'sword_diamond', name: 'Diamond Sword', cat: 'melee', res: 'emerald', cost: 4, give: { item: 'sword_diamond', n: 1 }, desc: '8 damage.' },
  { id: 'kb_stick', name: 'Knockback Stick', cat: 'melee', res: 'gold', cost: 5, give: { item: 'kb_stick', n: 1 }, desc: 'knockback I. send them flying.' },
  { id: 'armor_chain', name: 'Permanent Chainmail Armor', cat: 'armor', res: 'iron', cost: 24, give: { armor: 1 }, desc: 'chainmail leggings and boots you keep forever.' },
  { id: 'armor_iron', name: 'Permanent Iron Armor', cat: 'armor', res: 'gold', cost: 12, give: { armor: 2 }, desc: 'iron leggings and boots you keep forever.' },
  { id: 'armor_diamond', name: 'Permanent Diamond Armor', cat: 'armor', res: 'emerald', cost: 6, give: { armor: 3 }, desc: 'you will be practically unkillable.' },
  { id: 'shears', name: 'Permanent Shears', cat: 'tools', res: 'iron', cost: 20, give: { shears: true }, desc: 'great to get rid of wool. you keep them forever.' },
  { id: 'pick', name: 'Pickaxe', cat: 'tools', res: 'iron', cost: 10, give: { tool: 'pick' }, desc: 'upgradable. drops a tier when you die.' },
  { id: 'axe', name: 'Axe', cat: 'tools', res: 'iron', cost: 10, give: { tool: 'axe' }, desc: 'upgradable. drops a tier when you die.' },
  { id: 'arrow', name: 'Arrow', cat: 'ranged', res: 'gold', cost: 2, give: { item: 'arrow', n: 8 }, desc: '8 arrows.' },
  { id: 'bow', name: 'Bow', cat: 'ranged', res: 'gold', cost: 12, give: { item: 'bow', n: 1 }, desc: 'hold to draw, let go to shoot.' },
  { id: 'bow_power', name: 'Bow (Power I)', cat: 'ranged', res: 'gold', cost: 20, give: { item: 'bow_power', n: 1 }, desc: 'hits harder.' },
  { id: 'bow_punch', name: 'Bow (Power I, Punch I)', cat: 'ranged', res: 'emerald', cost: 6, give: { item: 'bow_punch', n: 1 }, desc: 'hits harder and knocks back.' },
  { id: 'speed', name: 'Speed II Potion (45s)', cat: 'potions', res: 'emerald', cost: 1, give: { item: 'speed', n: 1 }, desc: 'run faster for 45 seconds.' },
  { id: 'jump', name: 'Jump V Potion (45s)', cat: 'potions', res: 'emerald', cost: 1, give: { item: 'jump', n: 1 }, desc: 'jump much higher for 45 seconds.' },
  { id: 'invis', name: 'Invisibility Potion (30s)', cat: 'potions', res: 'emerald', cost: 2, give: { item: 'invis', n: 1 }, desc: 'complete invisibility for 30 seconds.' },
  { id: 'gapple', name: 'Golden Apple', cat: 'utility', res: 'gold', cost: 3, give: { item: 'gapple', n: 1 }, desc: 'well-rounded healing.' },
  { id: 'fireball', name: 'Fireball', cat: 'utility', res: 'iron', cost: 40, give: { item: 'fireball', n: 1 }, desc: 'right click to launch. great to knock people off bridges.' },
  { id: 'tnt', name: 'TNT', cat: 'utility', res: 'gold', cost: 8, give: { item: 'tnt', n: 1 }, desc: 'lights instantly. made for blowing up bed defenses.' },
  { id: 'pearl', name: 'Ender Pearl', cat: 'utility', res: 'emerald', cost: 4, give: { item: 'pearl', n: 1 }, desc: 'the quickest way into an enemy base.' },
  { id: 'egg', name: 'Bridge Egg', cat: 'utility', res: 'emerald', cost: 1, give: { item: 'egg', n: 1 }, desc: 'lays a bridge of wool behind it as it flies.' },
];
export const offerById = (id: string) => OFFERS.find((o) => o.id === id);
export const QUICK_BUY = ['wool', 'sword_stone', 'armor_chain', 'pick', 'bow', 'speed', 'tnt', 'wood', 'sword_iron', 'armor_iron', 'shears', 'arrow', 'jump', 'endstone', 'gapple', 'fireball', 'axe', 'pearl', 'egg', 'armor_diamond', 'obsidian'];

export const PICK_COST: [Res, number][] = [
  ['iron', 0],
  ['iron', 10],
  ['iron', 10],
  ['gold', 3],
  ['gold', 6],
];
export const AXE_COST: [Res, number][] = [
  ['iron', 0],
  ['iron', 10],
  ['iron', 10],
  ['gold', 3],
  ['gold', 6],
];

/** What an offer costs this player right now (tools price their next tier), or null when it is maxed or owned. */
export function priceOf(inv: Inventory, offer: Offer): { res: Res; cost: number; name: string } | null {
  const give = offer.give;
  if ('tool' in give) {
    const tier = give.tool === 'pick' ? inv.pick : inv.axe;
    if (tier >= 4) return null;
    const [res, cost] = (give.tool === 'pick' ? PICK_COST : AXE_COST)[tier + 1];
    return { res, cost, name: (give.tool === 'pick' ? PICK_NAMES : AXE_NAMES)[tier + 1] };
  }
  if ('armor' in give) return inv.armor >= give.armor ? null : { res: offer.res, cost: offer.cost, name: offer.name };
  if ('shears' in give) return inv.shears ? null : { res: offer.res, cost: offer.cost, name: offer.name };
  return { res: offer.res, cost: offer.cost, name: offer.name };
}

export type BuyResult = { ok: true; name: string } | { ok: false; why: 'unknown' | 'owned' | 'poor' | 'full' };

/** Buys an offer if the player can afford it, handing over the goods. */
export function buy(inv: Inventory, offerId: string): BuyResult {
  const offer = offerById(offerId);
  if (!offer) return { ok: false, why: 'unknown' };
  const price = priceOf(inv, offer);
  if (!price) return { ok: false, why: 'owned' };
  if (inv.wallet[price.res] < price.cost) return { ok: false, why: 'poor' };
  const give = offer.give;
  if ('item' in give) {
    const swordUpgrade = isSword(give.item) && give.item !== 'kb_stick';
    const woodAt = swordUpgrade ? inv.slots.findIndex((s) => s?.item === 'sword_wood') : -1;
    if (woodAt < 0) {
      // make sure it fits before paying
      const room = inv.slots.reduce((n, s) => n + (!s ? ITEM_DEFS[give.item].stack : s.item === give.item ? ITEM_DEFS[give.item].stack - s.n : 0), 0);
      if (room < give.n) return { ok: false, why: 'full' };
      addItem(inv, give.item, give.n);
    } else inv.slots[woodAt] = { item: give.item, n: 1 };
  } else if ('armor' in give) inv.armor = give.armor;
  else if ('tool' in give) {
    const had = give.tool === 'pick' ? inv.pick : inv.axe;
    if (had === 0 && !inv.slots.some((s) => !s)) return { ok: false, why: 'full' };
    if (give.tool === 'pick') inv.pick++;
    else inv.axe++;
    if (had === 0) addItem(inv, give.tool, 1);
  } else {
    if (!inv.slots.some((s) => !s)) return { ok: false, why: 'full' };
    inv.shears = true;
    addItem(inv, 'shears', 1);
  }
  inv.wallet[price.res] -= price.cost;
  return { ok: true, name: price.name };
}

// ---------------------------------------------------------------------------------------------------------------
// Team upgrades (diamonds, solo and doubles prices)

export type UpgradeKey = 'sharp' | 'prot' | 'haste' | 'forge' | 'heal';
export type TrapKind = 'trap' | 'counter' | 'alarm' | 'fatigue';
export type Upgrades = Record<UpgradeKey, number>;
export const freshUpgrades = (): Upgrades => ({ sharp: 0, prot: 0, haste: 0, forge: 0, heal: 0 });

export const UPGRADES: { key: UpgradeKey; name: string; tiers: number[]; levels: string[]; desc: string; tile: TileName }[] = [
  { key: 'sharp', name: 'Sharpened Swords', tiers: [4], levels: ['Sharpness I'], desc: 'your team gets sharpness I on all swords and axes.', tile: 'sword_iron' },
  { key: 'prot', name: 'Reinforced Armor', tiers: [2, 4, 8, 16], levels: ['Protection I', 'Protection II', 'Protection III', 'Protection IV'], desc: 'your team gets protection on all armor pieces.', tile: 'chest_iron' },
  { key: 'haste', name: 'Maniac Miner', tiers: [2, 4], levels: ['Haste I', 'Haste II'], desc: 'all players on your team get permanent haste.', tile: 'pick_gold' },
  { key: 'forge', name: 'Forge', tiers: [2, 4, 6, 8], levels: ['Iron Forge, +50% resources', 'Golden Forge, +100% resources', 'Emerald Forge, emeralds at your forge', 'Molten Forge, +200% resources'], desc: 'upgrade resource spawning on your island.', tile: 'furnace' },
  { key: 'heal', name: 'Heal Pool', tiers: [1], levels: ['Regeneration on your island'], desc: 'creates a regeneration field around your base.', tile: 'beacon' },
];
export const TRAPS: { kind: TrapKind; name: string; desc: string; tile: TileName }[] = [
  { kind: 'trap', name: "It's a Trap!", desc: 'blindness and slowness on the next enemy to come in.', tile: 'tripwire' },
  { kind: 'counter', name: 'Counter-Offensive Trap', desc: 'speed and jump boost for your team when someone comes in.', tile: 'feather' },
  { kind: 'alarm', name: 'Alarm Trap', desc: 'reveals invisible players and warns your team.', tile: 'tripwire' },
  { kind: 'fatigue', name: 'Miner Fatigue Trap', desc: 'mining fatigue on the next enemy to come in.', tile: 'pick_iron' },
];
export const MAX_TRAPS = 3;
/** The first trap costs 1 diamond, then 2, then 4. */
export const trapCost = (queued: number) => [1, 2, 4][Math.min(2, queued)];

export function upgradeCost(ups: Upgrades, key: UpgradeKey): number | null {
  const u = UPGRADES.find((x) => x.key === key)!;
  const lvl = ups[key];
  return lvl >= u.tiers.length ? null : u.tiers[lvl];
}

/** Ticks between resources at a team forge (20 ticks a second), sped up by the Forge upgrade. */
export function forgeInterval(res: 'iron' | 'gold' | 'emerald', forge: number): number {
  const mult = [1, 1.5, 2, 2, 3][forge];
  if (res === 'iron') return Math.round(25 / mult);
  if (res === 'gold') return Math.round(120 / mult);
  return forge >= 3 ? 1200 / (forge >= 4 ? 1.25 : 1) : Infinity;
}
/** Most of a resource a forge piles up before it stops. */
export const FORGE_CAP: Record<'iron' | 'gold' | 'emerald', number> = { iron: 48, gold: 12, emerald: 2 };
/** Diamond and emerald generator intervals by tier (ticks), and caps. */
export const GEN_INTERVAL = { diamond: [600, 460, 240], emerald: [1300, 1000, 700] };
export const GEN_CAP = { diamond: 4, emerald: 2 };
