// Block registry for Bed Wars: ids, shapes, textures, hardness and how each one breaks. Pure, so it runs under node.

/** World size in blocks. The map sits in the middle with the void all around. */
export const SX = 176;
export const SY = 64;
export const SZ = 176;
/** Chunks are 16 cubed; the mesher rebuilds one at a time. */
export const CS = 16;
export const CX = SX / CS;
export const CY = SY / CS;
export const CZ = SZ / CS;

export const TEAM_COUNT = 8;

/** Hypixel's eight team colors, in island order around the map. */
export const TEAMS = [
  { name: 'Red', letter: 'R', color: '#e8423f', dark: '#9b1f1d', wool: '#c9312e', island: 'Cardinal' },
  { name: 'Blue', letter: 'B', color: '#3f74e8', dark: '#22408c', wool: '#3552b8', island: 'Lagunita' },
  { name: 'Green', letter: 'G', color: '#4cbf3f', dark: '#2a6e22', wool: '#4a8f2a', island: 'Arboretum' },
  { name: 'Yellow', letter: 'Y', color: '#f3d23a', dark: '#a58a12', wool: '#e2c531', island: 'Sunken Diamond' },
  { name: 'Aqua', letter: 'A', color: '#3fd0d8', dark: '#1b7d83', wool: '#2a9aa6', island: 'Lake Lag' },
  { name: 'White', letter: 'W', color: '#f4f4f4', dark: '#9a9a9a', wool: '#e9ecec', island: 'The Dish' },
  { name: 'Pink', letter: 'P', color: '#f27fbd', dark: '#a8467c', wool: '#e58aad', island: 'Palm Drive' },
  { name: 'Gray', letter: 'S', color: '#9aa0a8', dark: '#4f545b', wool: '#5d6266', island: 'Gates' },
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Atlas tiles. 16x16 tiles of 16px; the painter in atlas.ts draws each name into its cell.

export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sandstone_top', 'sandstone_side', 'sandbrick', 'roof',
  'cream', 'cream_window', 'palm_side', 'palm_top', 'leaves', 'forge', 'iron_block', 'gold_block',
  'diamond_block', 'emerald_block', 'glass', 'poppy', 'tallgrass', 'planks', 'end_stone', 'obsidian',
  'ladder', 'bed_end', 'water', 'cobble',
  'bedh_0', 'bedh_1', 'bedh_2', 'bedh_3', 'bedh_4', 'bedh_5', 'bedh_6', 'bedh_7',
  'bedf_0', 'bedf_1', 'bedf_2', 'bedf_3', 'bedf_4', 'bedf_5', 'bedf_6', 'bedf_7',
  'beds_0', 'beds_1', 'beds_2', 'beds_3', 'beds_4', 'beds_5', 'beds_6', 'beds_7',
  'wool_0', 'wool_1', 'wool_2', 'wool_3', 'wool_4', 'wool_5', 'wool_6', 'wool_7',
  'clay_0', 'clay_1', 'clay_2', 'clay_3', 'clay_4', 'clay_5', 'clay_6', 'clay_7',
  'sglass_0', 'sglass_1', 'sglass_2', 'sglass_3', 'sglass_4', 'sglass_5', 'sglass_6', 'sglass_7',
  'crack_0', 'crack_1', 'crack_2', 'crack_3', 'crack_4', 'crack_5', 'crack_6', 'crack_7', 'crack_8', 'crack_9',
  'tnt_top', 'tnt_side', 'tnt_bottom', 'lamp', 'bench', 'tile_floor', 'skin', 'blank',
  // items
  'sword_wood', 'sword_stone', 'sword_iron', 'sword_diamond', 'kb_stick',
  'pick_wood', 'pick_iron', 'pick_gold', 'pick_diamond',
  'axe_wood', 'axe_stone', 'axe_iron', 'axe_diamond', 'shears',
  'bow', 'bow_pull_0', 'bow_pull_1', 'bow_pull_2', 'arrow',
  'iron', 'gold', 'diamond', 'emerald',
  'fireball', 'gapple', 'pearl', 'egg', 'potion_speed', 'potion_jump', 'potion_invis', 'snowball', 'golem_egg',
  'chest_leather', 'chest_chain', 'chest_iron', 'chest_diamond', 'boots_chain', 'boots_iron', 'boots_diamond',
  'furnace', 'beacon', 'tripwire', 'feather', 'heart', 'heart_half', 'heart_empty', 'heart_gold',
] as const;
export type TileName = (typeof TILE_NAMES)[number];
export const TILE: Record<TileName, number> = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i])) as Record<TileName, number>;
export const ATLAS_TILES = 16;

// ---------------------------------------------------------------------------------------------------------------
// Blocks

export type Tool = 'pick' | 'axe' | 'shears' | 'none';
export type BlockSound = 'stone' | 'wood' | 'wool' | 'glass' | 'grass' | 'bed' | 'ladder';
export type Shape = 'cube' | 'cross' | 'bed' | 'ladder' | 'liquid';
export type Pass = 'opaque' | 'cutout' | 'glass';

export type BlockDef = {
  name: string;
  solid: boolean;
  /** Hides the faces of neighbors and darkens their corners (ambient occlusion). */
  opaque: boolean;
  shape: Shape;
  pass: Pass;
  /** top, bottom, side tiles */
  tex: [number, number, number];
  /** Seconds-ish Minecraft hardness; -1 can never be broken. */
  hardness: number;
  tool: Tool;
  /** Breaking by hand (or with the wrong tool) is 100 times slower instead of 30. */
  needsTool: boolean;
  /** Lowest pickaxe that counts as the right tool (obsidian needs diamond). */
  harvest: number;
  /** 0: fireballs and TNT break it, 1: only TNT, 2: neither. */
  blast: number;
  sound: BlockSound;
  /** Particle colors when it breaks. */
  colors: string[];
  team: number;
  /** Multiplies the vertex color of the top (grass) or every face (leaves). */
  tint?: 'grass' | 'leaves';
  /** Hit by the crosshair (flowers and grass are not). */
  pickable: boolean;
};

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SANDSTONE = 4;
export const SANDBRICK = 5;
export const ROOF = 6;
export const CREAM = 7;
export const CREAM_WINDOW = 8;
export const PALM_LOG = 9;
export const LEAVES = 10;
export const FORGE = 11;
export const IRON_BLOCK = 12;
export const GOLD_BLOCK = 13;
export const DIAMOND_BLOCK = 14;
export const EMERALD_BLOCK = 15;
export const GLASS = 16;
export const POPPY = 17;
export const TALLGRASS = 18;
export const PLANKS = 19;
export const END_STONE = 20;
export const OBSIDIAN = 21;
export const COBBLE = 22;
export const WATER = 23;
export const LAMP = 24;
export const TILE_FLOOR = 25;
export const WOOL = 32;
export const CLAY = 40;
export const SGLASS = 48;
export const BED_FOOT = 56;
export const BED_HEAD = 64;
/** Ladders hang on the wall in direction 0..3 (+x, -x, +z, -z). */
export const LADDER = 72;
export const BLOCK_COUNT = 76;

const base = (name: string, over: Partial<BlockDef> = {}): BlockDef => ({
  name,
  solid: true,
  opaque: true,
  shape: 'cube',
  pass: 'opaque',
  tex: [TILE.stone, TILE.stone, TILE.stone],
  hardness: -1,
  tool: 'pick',
  needsTool: true,
  harvest: 0,
  blast: 2,
  sound: 'stone',
  colors: ['#888'],
  team: -1,
  pickable: true,
  ...over,
});
const one = (t: number): [number, number, number] => [t, t, t];

export const BLOCKS: BlockDef[] = [];
BLOCKS[AIR] = base('air', { solid: false, opaque: false, pickable: false, colors: [] });
BLOCKS[GRASS] = base('grass', { tex: [TILE.grass_top, TILE.dirt, TILE.grass_side], sound: 'grass', tint: 'grass', colors: ['#6aa84f', '#7a5a3a', '#5e9a44'] });
BLOCKS[DIRT] = base('dirt', { tex: one(TILE.dirt), sound: 'grass', colors: ['#7a5a3a', '#6b4d31'] });
BLOCKS[STONE] = base('stone', { tex: one(TILE.stone), colors: ['#8a8a8a', '#777'] });
BLOCKS[SANDSTONE] = base('sandstone', { tex: [TILE.sandstone_top, TILE.sandstone_top, TILE.sandstone_side], colors: ['#e3c99a', '#d4b583'] });
BLOCKS[SANDBRICK] = base('quad stone', { tex: one(TILE.sandbrick), colors: ['#d9bd8c', '#c7a774'] });
BLOCKS[ROOF] = base('roof tile', { tex: one(TILE.roof), colors: ['#b5492f', '#9c3b25'] });
BLOCKS[CREAM] = base('tower stone', { tex: one(TILE.cream), colors: ['#efe3c8', '#e2d2b0'] });
BLOCKS[CREAM_WINDOW] = base('tower window', { tex: [TILE.cream, TILE.cream, TILE.cream_window], colors: ['#efe3c8', '#4a5a6a'] });
BLOCKS[PALM_LOG] = base('palm', { tex: [TILE.palm_top, TILE.palm_top, TILE.palm_side], sound: 'wood', colors: ['#8a6a43', '#73562f'] });
BLOCKS[LEAVES] = base('palm fronds', { opaque: false, pass: 'cutout', tex: one(TILE.leaves), sound: 'grass', tint: 'leaves', colors: ['#3f8f3a', '#2f7a2c'] });
BLOCKS[FORGE] = base('forge', { tex: one(TILE.forge), colors: ['#5b5b5f', '#444'] });
BLOCKS[IRON_BLOCK] = base('iron block', { tex: one(TILE.iron_block), colors: ['#d8d8d8', '#bbb'] });
BLOCKS[GOLD_BLOCK] = base('gold block', { tex: one(TILE.gold_block), colors: ['#f5d64a', '#d9a520'] });
BLOCKS[DIAMOND_BLOCK] = base('diamond block', { tex: one(TILE.diamond_block), colors: ['#6fe3df', '#3fbab5'] });
BLOCKS[EMERALD_BLOCK] = base('emerald block', { tex: one(TILE.emerald_block), colors: ['#47d36b', '#239146'] });
BLOCKS[GLASS] = base('glass', { opaque: false, pass: 'cutout', tex: one(TILE.glass), sound: 'glass', colors: ['#cfe8f0', '#a9cbd6'] });
BLOCKS[POPPY] = base('poppy', { solid: false, opaque: false, shape: 'cross', pass: 'cutout', tex: one(TILE.poppy), sound: 'grass', pickable: false, colors: ['#f29b1d'] });
BLOCKS[TALLGRASS] = base('grass tuft', { solid: false, opaque: false, shape: 'cross', pass: 'cutout', tex: one(TILE.tallgrass), sound: 'grass', tint: 'leaves', pickable: false, colors: ['#5e9a44'] });
BLOCKS[COBBLE] = base('cobblestone', { tex: one(TILE.cobble), colors: ['#7d7d7d', '#666'] });
BLOCKS[WATER] = base('water', { solid: false, opaque: false, shape: 'liquid', pass: 'glass', tex: one(TILE.water), pickable: false, colors: ['#3a6fd8'] });
BLOCKS[LAMP] = base('lamp', { tex: [TILE.lamp, TILE.forge, TILE.lamp], colors: ['#fff2b0', '#5b5b5f'] });
BLOCKS[TILE_FLOOR] = base('quad tile', { tex: [TILE.tile_floor, TILE.sandbrick, TILE.sandbrick], colors: ['#d9bd8c', '#b5492f'] });
// Player blocks: these are the only ones that can be broken.
BLOCKS[PLANKS] = base('wood', { tex: one(TILE.planks), hardness: 2, tool: 'axe', needsTool: false, blast: 0, sound: 'wood', colors: ['#b48a52', '#9c7442'] });
BLOCKS[END_STONE] = base('end stone', { tex: one(TILE.end_stone), hardness: 3, tool: 'pick', needsTool: true, blast: 1, colors: ['#e8e6b0', '#d4d18f'] });
BLOCKS[OBSIDIAN] = base('obsidian', { tex: one(TILE.obsidian), hardness: 50, tool: 'pick', needsTool: true, harvest: 4, blast: 2, colors: ['#1e1530', '#33204f'] });
for (let t = 0; t < TEAM_COUNT; t++) {
  const team = TEAMS[t];
  BLOCKS[WOOL + t] = base(`${team.name.toLowerCase()} wool`, { tex: one(TILE[`wool_${t}` as TileName]), hardness: 0.8, tool: 'shears', needsTool: false, blast: 0, sound: 'wool', colors: [team.wool, team.color], team: t });
  BLOCKS[CLAY + t] = base(`${team.name.toLowerCase()} clay`, { tex: one(TILE[`clay_${t}` as TileName]), hardness: 1.25, tool: 'pick', needsTool: true, blast: 0, colors: [team.dark, team.wool], team: t });
  BLOCKS[SGLASS + t] = base(`blast-proof glass`, { opaque: false, pass: 'glass', tex: one(TILE[`sglass_${t}` as TileName]), hardness: 0.3, tool: 'none', needsTool: false, blast: 2, sound: 'glass', colors: [team.color, '#ffffff'], team: t });
  BLOCKS[BED_FOOT + t] = base(`${team.name.toLowerCase()} bed`, { opaque: false, shape: 'bed', pass: 'opaque', tex: [TILE[`bedf_${t}` as TileName], TILE.planks, TILE[`beds_${t}` as TileName]], hardness: 0.2, tool: 'none', needsTool: false, blast: 2, sound: 'bed', colors: [team.wool, '#ffffff', '#b48a52'], team: t });
  BLOCKS[BED_HEAD + t] = base(`${team.name.toLowerCase()} bed`, { opaque: false, shape: 'bed', pass: 'opaque', tex: [TILE[`bedh_${t}` as TileName], TILE.planks, TILE[`beds_${t}` as TileName]], hardness: 0.2, tool: 'none', needsTool: false, blast: 2, sound: 'bed', colors: [team.wool, '#ffffff', '#b48a52'], team: t });
}
for (let d = 0; d < 4; d++) {
  BLOCKS[LADDER + d] = base('ladder', { solid: true, opaque: false, shape: 'ladder', pass: 'cutout', tex: one(TILE.ladder), hardness: 0.4, tool: 'axe', needsTool: false, blast: 0, sound: 'ladder', colors: ['#a07a46', '#7d5c31'] });
}
for (let i = 0; i < BLOCK_COUNT; i++) if (!BLOCKS[i]) BLOCKS[i] = base('unused', { solid: false, opaque: false, pickable: false });

export const isBed = (id: number) => id >= BED_FOOT && id < BED_HEAD + TEAM_COUNT;
export const bedTeam = (id: number) => (id >= BED_HEAD ? id - BED_HEAD : id - BED_FOOT);
export const isLadder = (id: number) => id >= LADDER && id < LADDER + 4;
/** Placed blocks that teams buy. Everything else belongs to the map. */
export const isPlayerBlock = (id: number) => id === PLANKS || id === END_STONE || id === OBSIDIAN || (id >= WOOL && id < SGLASS + TEAM_COUNT) || isLadder(id);

/** Faces: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z */
export const FACE_DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** Ladder wall directions 0..3 as x/z steps. */
export const LADDER_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Collision box of a block in cell space, or null for none. */
export function blockBox(id: number): [number, number, number, number, number, number] | null {
  const b = BLOCKS[id];
  if (!b.solid) return null;
  if (b.shape === 'bed') return [0, 0, 0, 1, 0.5625, 1];
  if (b.shape === 'ladder') {
    const [dx, dz] = LADDER_DIRS[id - LADDER];
    const t = 0.125;
    if (dx === 1) return [1 - t, 0, 0, 1, 1, 1];
    if (dx === -1) return [0, 0, 0, t, 1, 1];
    if (dz === 1) return [0, 0, 1 - t, 1, 1, 1];
    return [0, 0, 0, 1, 1, t];
  }
  return [0, 0, 0, 1, 1, 1];
}

// ---------------------------------------------------------------------------------------------------------------
// Breaking (Minecraft 1.8 rules)

/** Tool tiers: pickaxes are 1 wood, 2 iron, 3 gold, 4 diamond; axes are 1 wood, 2 stone, 3 iron, 4 diamond. */
export const PICK_SPEED = [1, 2, 6, 12, 8];
export const PICK_EFF = [0, 1, 2, 3, 3];
export const AXE_SPEED = [1, 2, 4, 6, 8];
export const AXE_EFF = [0, 1, 1, 2, 3];
/** Pickaxe harvest levels in Minecraft terms: gold mines like wood. */
const PICK_HARVEST = [0, 1, 3, 1, 4];

export type Kit = { pick: number; axe: number; shears: boolean };

/** Which of the player's tools Minecraft would use on this block, and its speed. */
export function toolSpeed(id: number, held: 'pick' | 'axe' | 'shears' | 'sword' | 'none', kit: Kit): { speed: number; harvest: boolean } {
  const b = BLOCKS[id];
  if (b.tool === 'pick' && held === 'pick' && kit.pick > 0) {
    const eff = PICK_EFF[kit.pick];
    return { speed: PICK_SPEED[kit.pick] + eff * eff + 1, harvest: PICK_HARVEST[kit.pick] >= Math.max(1, b.harvest) };
  }
  if (b.tool === 'axe' && held === 'axe' && kit.axe > 0) {
    const eff = AXE_EFF[kit.axe];
    return { speed: AXE_SPEED[kit.axe] + eff * eff + 1, harvest: true };
  }
  if (b.tool === 'shears' && held === 'shears' && kit.shears) return { speed: 5, harvest: true };
  return { speed: 1, harvest: !b.needsTool };
}

/**
 * Ticks (1/20 s) to break a block, Minecraft style: speed / hardness / 30 per tick with the right tool, / 100
 * without it. Haste (Maniac Miner) is +20% a level and breaking in the air is five times slower. 0 is instant;
 * Infinity is never (map blocks).
 */
export function breakTicks(id: number, held: 'pick' | 'axe' | 'shears' | 'sword' | 'none', kit: Kit, haste = 0, onGround = true): number {
  const b = BLOCKS[id];
  if (b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0;
  const { speed, harvest } = toolSpeed(id, held, kit);
  let s = speed * (1 + 0.2 * haste);
  if (!onGround) s /= 5;
  const perTick = s / b.hardness / (harvest ? 30 : 100);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick);
}
