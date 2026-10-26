// The island, the bus route and the storm for one Scramble match, all built from a seed, plus the geometry the
// simulation uses to collide and shoot. Pure, so it can be tested.
//
// Every client builds the same island from the host's seed, so placement uses only the seeded generator, + - * /
// and sqrt (exact in every engine). Trig only ever sets how something looks, never where it is.
import { rng32, rollLoot, type LootDef, type LootTier, type Rng } from './items.ts';

/** Land spans -HALF..HALF on x and z; water lies beyond. */
export const HALF = 240;
/** The sandy band along the shore. */
export const BEACH = 8;
/** Fighters stop this far inside the shore. */
export const EDGE = HALF - 0.8;
/**
 * The underground: every cellar and bunker lies this far east of the ground over it, out past the sea where nothing up
 * top reaches (no gun shoots so far, and nobody sees so far), so a basement under (x, z) is at (x + DEEP, z). Anything
 * east of DEEP / 2 is underground.
 */
export const DEEP = 1000;
export const isDeep = (x: number) => x > DEEP / 2;
/** Where on the island a point is, underground or not: the ground over a basement. */
export const topX = (x: number) => (x > DEEP / 2 ? x - DEEP : x);
/** Keeps a point `pad` past the shore at most, on its own level. */
export const clampX = (x: number, pad = 0) => (x > DEEP / 2 ? Math.max(DEEP - EDGE - pad, Math.min(DEEP + EDGE + pad, x)) : Math.max(-EDGE - pad, Math.min(EDGE + pad, x)));
/**
 * A stairway's half width across (rails and all) and half its run along the way down. A basement's walls are this
 * tall, and its doorways this wide.
 */
export const STAIR = { half: 1, run: 1.7 };
export const DEEP_H = 2.8;
export const DEEP_DOOR = 2.2;
export const WALL_T = 0.5;
export const WALL_H = 3.2;
export const DOOR = 2.8;
export const TREE_R = 0.7;
export const BUSH_R = 1.6;
export const CRATE_HALF = 0.7;
export const CHEST_HW = 0.65;
export const CHEST_HD = 0.42;
export const BARREL_R = 0.55;
export const SUPPLY_HALF = 0.85;
/** Seconds a supply drop takes to float down before it lands. */
export const SUPPLY_FALL = 12;
/** Wading through a pond or the river slows an egg to this share of its pace. */
export const POND_SLOW = 0.62;
/** Half the river's width, and half a bridge's (rail to rail). */
export const RIVER_HALF = 3.5;
export const BRIDGE_HALF = 2;
/** A fallen log's half thickness, and a stump's. */
export const LOG_R = 0.35;
export const STUMP_R = 0.45;
/** A dirt road: half its width, and the spring it puts in your step. */
export const ROAD_HALF = 1.8;
export const ROAD_SPEED = 1.08;
/** A campfire heals anyone within `r` meters this much a second; `pit` is the fire itself, which nobody stands in. */
export const CAMP = { r: 3.2, hps: 2, pit: 0.6 };
/** A bounce pad: step within `r` of its middle and up you go, to `y` meters, gliding off the way its arrows point. */
export const PAD = { r: 1.2, y: 26 };
export const HAY_HW = 0.9;
export const HAY_HD = 0.6;
export const FRIDGE_HW = 0.5;
export const FRIDGE_HD = 0.45;
export const TOILET_R = 0.42;
export const LAMP_R = 0.18;
export const MAILBOX_R = 0.22;
export const TABLE_HW = 1.1;
export const TABLE_HD = 0.8;
/** A jail cell's door is narrower than the rest, and its bars this thick. */
export const CELL_DOOR = 1.6;
export const BARS_T = 0.14;
export const FENCE_T = 0.16;
/** The gap in the middle of each side of a farm's fence. */
export const GATE = 4;
/** How far a farm's fence stands out from the farmhouse and its field. */
export const YARD = 4;
/** Cars park nose-on, trucks too (sizes along and across). */
export const CAR = { along: 3.8, across: 1.8 };
export const TRUCK = { along: 5.4, across: 2.2 };
/** The eight ways a bounce pad can point (no trig in here: the diagonals are written out). */
export const DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.7071, 0.7071],
  [1, 0],
  [0.7071, -0.7071],
  [0, -1],
  [-0.7071, -0.7071],
  [-1, 0],
  [-0.7071, 0.7071],
];
/** Names for the towns, camps and sites of an island (shuffled per seed). */
export const PLACE_NAMES = [
  'Yolk Yard',
  'Shell Shack',
  'Omelette Outpost',
  'Benedict Bluff',
  'Sunny Side',
  'Poach Point',
  'Frittata Flats',
  'Whisk Way',
  'Hatch Hollow',
  'Crackton',
  'Scramble Square',
  'Souffle Springs',
  'Quiche Quarter',
  'Deviled Dell',
  'Custard Corner',
  'Meringue Meadow',
  'Albumen Alley',
  'Hardboil Harbor',
  'Overeasy Acres',
  'Coddle Cove',
  'Nog Knoll',
  'Eggbert End',
  'Shakshuka Shore',
  'Tamago Town',
  'Huevo Heights',
  'Florentine Fields',
  'Carton Crossing',
  'Dozen Docks',
  'Brunch Bay',
  'Griddle Gulch',
  'Skillet Springs',
  'Toast Town',
  'Waffle Wharf',
  'Pancake Pass',
  'Hollandaise Hill',
  'Bacon Bend',
  'Muffin Mesa',
  'Biscuit Bluffs',
  'Clucker Creek',
  'Henhouse Hamlet',
  'Rooster Ridge',
  'Nest Nook',
  'Feather Falls',
  'Pullet Plains',
  'Speckle Spit',
  'Bantam Bridge',
  'Crumpet Crest',
  'Jam Junction',
  'Butter Basin',
  'Shellfire Shoals',
  'Yolkshire',
  'Cracked Canyon',
];
/** The diner, the windmill, the police station and the bank go by their own names. */
export const DINER_NAMES = ['Greasy Spoon', 'Hash House', 'Sunny Side Diner', 'Waffle Stop', 'Short Stack Diner'];
export const MILL_NAMES = ['Old Mill', 'Windy Mill', 'Millstone Hill', 'Flour Power', 'Grindstone Mill'];
export const POLICE_NAMES = ['Poach Precinct', 'Yolk Patrol HQ', 'Shell Station', 'Cluckton Police'];
export const BANK_NAMES = ['Nest Egg Bank', 'Golden Yolk Savings', 'First Omelette Bank', 'Shell Trust'];
/** How far from its first site a town reaches for the rest. */
const TOWN = 36;
/** The kinds that go by a name of their own (and keep their distance from each other). */
const NAMED: BuildingKind[] = ['diner', 'mill', 'police', 'bank'];
const CELL = 8;
const COLS = Math.ceil((2 * HALF) / CELL);

export type Circle = { x: number; z: number; r: number };
/** Trees come in four looks; only how they're drawn differs. */
export type TreeKind = 'oak' | 'pine' | 'birch' | 'fruit';
export type Tree = Circle & { kind: TreeKind };
export type Box = { x: number; z: number; hw: number; hd: number };
export type Rock = Circle & { look: number };
/**
 * Houses, farmhouses, sheds, warehouses, shipping containers, ruins, the Golden Coop, a diner, a windmill (now and
 * then a second of one of those), a police station and a bank. Walls stop eggs and bullets; a roof hides what's inside
 * from anyone outside (ruins have none). `h` is how tall the walls are drawn. `bars` are a jail cell's (they stop
 * feet, not bullets or the eye). A building of more than one room lists them (`rooms`, inside the walls), with the
 * doorways between them in `inner`.
 *
 * Underground (see DEEP), a cellar (under a house) or a bunker (under the police station or the bank, or a hatch out
 * in the open) is a building too, with no way in but its stairway (see Stair) and no doors in its doorways.
 */
export type BuildingKind = 'house' | 'farm' | 'shed' | 'warehouse' | 'container' | 'ruin' | 'coop' | 'diner' | 'mill' | 'police' | 'bank' | 'cellar' | 'bunker';
export type Building = { kind: BuildingKind; x: number; z: number; w: number; d: number; walls: Box[]; doors: Door[]; inner: Door[]; windows: Pane[]; bars: Box[]; rooms: Box[]; look: number; roof: boolean; h: number };
/**
 * A window in an outer wall: the glass filling its opening (wall thick), `i` its place in the island's list, `b` its
 * building and (`ox`, `oz`) the way out. Eggs never get through, glass or no glass (there is wall below it); the glass
 * lets the view through but stops bullets and throws until something breaks it (see logic.ts).
 */
export type Pane = Box & { i: number; b: number; ox: number; oz: number };
/**
 * A way in through the outer walls: the middle of the opening, the way out (one step along x or z), and how wide it
 * is. A doorway between two rooms (`inner`) points across the wall it is in. `slab` is the door hanging in it (see
 * Slab), if there is one; `kind` marks a jail cell's barred door and a bank vault's.
 */
export type Door = { x: number; z: number; ox: number; oz: number; w: number; slab?: number; kind?: 'bars' | 'vault' };
/**
 * A door that opens and shuts (see logic.ts): the box it fills shut (the opening, wall thick), `i` its place in the
 * island's list, `b` its building, and (`ox`, `oz`) the way out of its doorway. A jail cell's door is bars (`bars`:
 * bullets and the eye go through, feet don't); a bank vault's (`vault`) is heavy steel, takes a while to open, and
 * never breaks.
 */
export type Slab = Box & { i: number; b: number; ox: number; oz: number; bars: boolean; vault: boolean };
/**
 * A stairway down to a basement: the box it fills on the ground (rails and all; the same box at x + DEEP below), the
 * way down (`dx`, `dz`: one step along x or z), the building it is in (`b`, -1 for a hatch out in the open) and the
 * basement it leads to (`u`, a building). On the ground an egg walks onto it from its top end and comes out below past
 * its foot; below it walks onto it from its foot and comes out up top, back off its top. `rails` stop feet along its
 * open sides and at its far end up top, `deepRails` the same below (the far end there is its top).
 */
export type Stair = Box & { i: number; b: number; u: number; dx: number; dz: number; rails: Box[]; deepRails: Box[] };
export type LootSpawn = { id: number; def: LootDef; x: number; z: number };
/**
 * Crates, toilets and hay bales break when shot or smacked, and barrels blow up; chests, fridges, supply drops and
 * the furniture that holds things (chests of drawers, bookshelves, lockers, bank safes and deposit boxes) open with
 * the interact key. Each faces `face` along z (along x when `ax`). A supply drop floats down from the sky and lands
 * at match time `at`. `gold` marks the Golden Coop's chest. `flare` marks a supply drop kept back for a flare gun to
 * call: it lands nowhere (`at` is Infinity) until one does.
 */
export type ContainerKind = 'crate' | 'chest' | 'barrel' | 'supply' | 'fridge' | 'toilet' | 'hay' | StashKind;
export type Container = { id: number; kind: ContainerKind; x: number; z: number; face: 1 | -1; ax: boolean; loot: LootSpawn[]; solid: number; gold: boolean; at: number; flare: boolean };
/** Furniture that opens for what's in it: half its length along the wall it stands against, and half its depth. */
export type StashKind = 'drawer' | 'books' | 'locker' | 'safe' | 'deposit';
export const STASH: Record<StashKind, { along: number; deep: number; tier: LootTier }> = {
  drawer: { along: 0.55, deep: 0.27, tier: 'drawer' },
  books: { along: 0.8, deep: 0.2, tier: 'books' },
  locker: { along: 0.3, deep: 0.28, tier: 'locker' },
  safe: { along: 0.48, deep: 0.42, tier: 'safe' },
  deposit: { along: 0.6, deep: 0.22, tier: 'deposit' },
};
export const isStash = (k: string): k is StashKind => k in STASH;
/** What opens with the interact key (the rest breaks). */
export const opens = (k: ContainerKind) => k === 'chest' || k === 'supply' || k === 'fridge' || isStash(k);
/** Half a container's size along x and along z. */
export function containerHalf(c: Container): [number, number] {
  if (isStash(c.kind)) {
    const s = STASH[c.kind];
    return c.ax ? [s.deep, s.along] : [s.along, s.deep];
  }
  return c.kind === 'chest' ? [CHEST_HW, CHEST_HD] : c.kind === 'fridge' ? [FRIDGE_HW, FRIDGE_HD] : c.kind === 'toilet' ? [TOILET_R, TOILET_R] : c.kind === 'hay' ? [HAY_HW, HAY_HD] : c.kind === 'supply' ? [SUPPLY_HALF, SUPPLY_HALF] : [CRATE_HALF, CRATE_HALF];
}
/**
 * Something that stops eggs. `ref` is the tree, rock, building, window, container, car, yard or prop it belongs to.
 * Toilets and hay bales are `crate` solids and fridges `chest` ones, since they break and open the same way.
 */
export type Solid =
  | { shape: 'circle'; x: number; z: number; r: number; what: 'tree' | 'rock' | 'barrel' | 'post' | 'fire' | 'log'; ref: number }
  | { shape: 'box'; x: number; z: number; hw: number; hd: number; what: 'wall' | 'window' | 'door' | 'bars' | 'crate' | 'chest' | 'car' | 'fence' | 'table' | 'log' | 'shelf' | 'seat'; ref: number };
/**
 * Low things (fences and bridge rails, picnic tables, fire pits, fallen logs and stumps, beds, tables, benches and
 * booths indoors) and a jail cell's bars stop eggs walking but not bullets, throws or the view. A door does what a
 * wall does while it's shut (see logic.ts), and nothing once it's open.
 */
export const low = (s: Solid) => s.what === 'fence' || s.what === 'table' || s.what === 'fire' || s.what === 'log' || s.what === 'seat' || s.what === 'bars';
/** A parked car or truck: solid cover that stops bullets. Axis aligned, nose along x when `alongX`. */
export type Car = { x: number; z: number; hw: number; hd: number; look: number; truck: boolean; alongX: boolean };
/** A farm's fenced yard, with a gate in the middle of each side (gates are doors: the way out is `ox`, `oz`). */
export type Yard = { x: number; z: number; hw: number; hd: number; fences: Box[]; gates: Door[] };
/** A dirt road between two places. */
export type Road = { x0: number; z0: number; x1: number; z1: number };
/** A bounce pad and the way it throws you. */
export type Pad = { x: number; z: number; dx: number; dz: number };
/** A named town, camp or site: everything within `r` of its middle. */
export type Place = { name: string; x: number; z: number; r: number };
/** Lamp posts and mailboxes. */
export type Prop = { x: number; z: number; look: number };
export type Table = { x: number; z: number; alongX: boolean };
/** The river's middle line, from the shore on one side of the island to the shore across. */
export type River = { x: number; z: number }[];
/** A wooden bridge: a deck from bank to bank, along x (or z), with a rail down each side. */
export type Bridge = Box & { alongX: boolean };
/** A fallen log, lying along x (or z). */
export type Log = Box & { alongX: boolean };
/**
 * Things indoors. Counters, shelves, sacks and millstones stop eggs and bullets (`shelf` solids); beds, tables,
 * booths and benches only stop feet (`seat` solids); rugs, chairs and stools are just there to look at. `face` is the
 * side a bed's head or a seat's back is against (sides as in shell()); `b` the building.
 */
export type FurnitureKind = 'rug' | 'chair' | 'stool' | 'table' | 'bed' | 'booth' | 'bench' | 'desk' | 'counter' | 'shelf' | 'sacks' | 'millstone';
export type Furniture = Box & { kind: FurnitureKind; face: number; b: number; look: number };
/** What furniture stops: everything, only feet, or nothing. */
export const furnitureSolid = (k: FurnitureKind): 'shelf' | 'seat' | null =>
  k === 'counter' || k === 'shelf' || k === 'sacks' || k === 'millstone' || k === 'desk' ? 'shelf' : k === 'table' || k === 'bed' || k === 'booth' || k === 'bench' ? 'seat' : null;

/** The bus's route; `on` and `off` are when it is over land, the only time anyone can jump. */
export type Bus = { x0: number; z0: number; x1: number; z1: number; len: number; dur: number; on: number; off: number };
export type StormCircle = { x: number; z: number; r: number };
export type Storm = { circles: StormCircle[]; starts: number[]; ends: number[] };

export type GameMap = {
  seed: number;
  trees: Tree[];
  rocks: Rock[];
  bushes: Circle[];
  /** Cornfields: walk in and nobody sees you from a distance, like a bush. */
  fields: Box[];
  /** Ponds slow anyone wading through. */
  ponds: Circle[];
  /** So does the river, but for its bridges. */
  river: River;
  bridges: Bridge[];
  logs: Log[];
  stumps: Circle[];
  furniture: Furniture[];
  buildings: Building[];
  /** Every building's windows, in one list (a window's `i` is its place in it), and its doors the same way. */
  windows: Pane[];
  slabs: Slab[];
  /** The stairways down to the basements. */
  stairs: Stair[];
  /** The Golden Coop's building index. */
  coop: number;
  containers: Container[];
  /** Supply drop container ids, in the order they land. */
  drops: number[];
  /** The supply drops flare guns can call, in the order they are called. */
  flares: number[];
  /** Campfires (their heal radius is CAMP.r; the circle is the pit). */
  fires: Circle[];
  pads: Pad[];
  roads: Road[];
  yards: Yard[];
  cars: Car[];
  lamps: Prop[];
  mailboxes: Prop[];
  tables: Table[];
  places: Place[];
  floor: LootSpawn[];
  solids: Solid[];
  /** Solid indices per grid cell, on the island and (`under`) underground. */
  grid: number[][];
  under: number[][];
  bus: Bus;
  storm: Storm;
  /** Scratch for de-duplicating grid queries. */
  stamp: Uint32Array;
  mark: number;
};

export const BUS_Y = 68;
export const BUS_SPEED = 30;
export const STORM_R0 = 350;
/** Each phase: the wait before the storm moves, how long it takes to close, the new radius, and its bite per second. */
export const STORM_PHASES = [
  { wait: 80, shrink: 45, r: 165, dps: 1 },
  { wait: 45, shrink: 35, r: 95, dps: 2 },
  { wait: 35, shrink: 30, r: 50, dps: 4 },
  { wait: 26, shrink: 22, r: 24, dps: 7 },
  { wait: 18, shrink: 16, r: 9, dps: 10 },
  { wait: 12, shrink: 16, r: 0, dps: 16 },
] as const;
/**
 * Seconds before each of the first four storm phases begins to move that its supply drops land inside the circle it
 * closes to, and how many land.
 */
const DROP_LEAD = [10, 8, 6, 5];
const DROP_COUNT = [2, 2, 2, 1];
/** How many supply drops flare guns can call in a match. */
export const FLARE_DROPS = 6;

/**
 * The buildings an island has, placed in this order (the biggest first, so they always fit); `special` is a diner and a
 * windmill, now and then with a second of one of them, then the police station and the bank.
 */
const plan = (special: BuildingKind[]): BuildingKind[] => [
  'coop',
  ...Array<BuildingKind>(4).fill('warehouse'),
  ...Array<BuildingKind>(4).fill('farm'),
  ...special,
  'police',
  'bank',
  ...Array<BuildingKind>(4).fill('container'),
  ...Array<BuildingKind>(22).fill('house'),
  ...Array<BuildingKind>(16).fill('shed'),
  ...Array<BuildingKind>(9).fill('ruin'),
];
const COUNTS = { forests: 14, forestTrees: 16, trees: 340, rocks: 160, bushes: 250, crates: 115, chests: 18, spots: 160, barrels: 32, ponds: 7, camps: 7, pads: 12, logs: 28, stumps: 36 };
/** A bridge's deck runs this far onto each bank, and nothing else is built within `clear` of either end. */
const BRIDGE_STEP = 1.5;
const BRIDGE_CLEAR = 6;
const FLOOR_BASE = 10_000;
const CONTAINER_BASE = 100_000;
/** Loot ids for spawns and containers stay below this; fighters number their own drops above it. */
export const DROP_BASE = 1_000_000;
const SPREAD = [
  [0, 0],
  [0.9, 0.55],
  [-0.9, 0.55],
  [0, -1],
  [0.9, -1.4],
  [-0.9, -1.4],
] as const;

const r1 = (n: number) => Math.round(n * 10) / 10;
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

// -------------------------------------------------------------------------------------------------------------------
// Buildings.

/** A doorway or a gap: its center along the wall and its width. */
type Gap = [center: number, width: number];

/** A straight run of wall (or fence, `thick` across) with gaps in it, centered on (cx, cz) and running along x or along z. */
function wallLine(walls: Box[], alongX: boolean, cx: number, cz: number, len: number, gaps: Gap[], thick = WALL_T) {
  const t = thick / 2;
  const pieces: [number, number][] = [];
  let at = -len / 2;
  for (const [u, width] of [...gaps].sort((a, b) => a[0] - b[0])) {
    pieces.push([at, u - width / 2]);
    at = Math.max(at, u + width / 2);
  }
  pieces.push([at, len / 2]);
  for (const [a, b] of pieces) {
    if (b - a < 0.3) continue;
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    walls.push(alongX ? { x: cx + mid, z: cz, hw: half, hd: t } : { x: cx, z: cz + mid, hw: t, hd: half });
  }
}

/**
 * Four walls round a w by d floor, and the doorways through them. Sides: 0 north (-z), 1 south (+z), 2 west (-x),
 * 3 east (+x). A fence round a yard is the same thing, thinner. `glass` is the window openings (see glaze()), which
 * the walls leave room for but which are no way through.
 */
function shell(walls: Box[], x: number, z: number, w: number, d: number, gaps: Gap[][], thick = WALL_T, glass: Gap[][] = []) {
  const doors: Door[] = [];
  for (let side = 0; side < 4; side++) {
    const alongX = side < 2;
    const len = alongX ? w + thick : d - thick;
    const cx = alongX ? x : side === 2 ? x - w / 2 : x + w / 2;
    const cz = alongX ? (side === 0 ? z - d / 2 : z + d / 2) : z;
    wallLine(walls, alongX, cx, cz, len, [...(gaps[side] ?? []), ...(glass[side] ?? [])], thick);
    // an opening ends where the walls either side of it begin
    const room = ((alongX ? w : d) - thick) / 2;
    for (const [u, width] of gaps[side] ?? []) {
      const lo = Math.max(-room, u - width / 2);
      const hi = Math.min(room, u + width / 2);
      const mid = (lo + hi) / 2;
      doors.push({ x: alongX ? cx + mid : cx, z: alongX ? cz : cz + mid, ox: alongX ? 0 : side === 2 ? -1 : 1, oz: alongX ? (side === 0 ? -1 : 1) : 0, w: hi - lo });
    }
  }
  return doors;
}

/** Where along a wall `span` long a doorway `width` wide goes, at least a meter from either corner. */
function doorAt(rng: Rng, span: number, width: number) {
  const room = span / 2 - width / 2 - 1;
  return Math.round((rng() * 2 - 1) * room * 2) / 2;
}

const sides = (): Gap[][] => [[], [], [], []];

/** How wide each kind's windows are and how far apart they stand along a wall; the rest have none. */
const GLAZING: Partial<Record<BuildingKind, { w: number; gap: number }>> = {
  house: { w: 1.6, gap: 7 },
  farm: { w: 1.6, gap: 7 },
  shed: { w: 1.2, gap: 6 },
  diner: { w: 2.4, gap: 4.5 },
  warehouse: { w: 2.4, gap: 7 },
  police: { w: 1.6, gap: 5 },
  bank: { w: 2, gap: 4.5 },
};
/** The wall a window keeps either side of it, to a corner, a doorway or a wall inside that meets this one. */
const PIER = 0.9;

/**
 * Where a kind's windows go along sides `on` of a w by d building (sides as in shell()): spread evenly along each
 * stretch of wall clear of the corners, the doorways (`gaps`) and the walls inside that meet it (`posts`, along each
 * side). Only + - * / and floor, so every client lays them out alike.
 */
function glaze(kind: BuildingKind, w: number, d: number, gaps: Gap[][], on: number[], posts: number[][] = []): Gap[][] {
  const out = sides();
  const spec = GLAZING[kind];
  if (!spec) return out;
  for (const side of on) {
    const room = ((side < 2 ? w : d) - WALL_T) / 2;
    const cuts: [number, number][] = [
      ...(gaps[side] ?? []).map(([u, width]): [number, number] => [u - width / 2 - PIER, u + width / 2 + PIER]),
      ...(posts[side] ?? []).map((u): [number, number] => [u - WALL_T / 2 - PIER, u + WALL_T / 2 + PIER]),
    ].sort((a, b) => a[0] - b[0]);
    let at = -room + PIER;
    for (const [lo, hi] of [...cuts, [room - PIER, Infinity]]) {
      const span = lo - at;
      if (span >= spec.w + 1.6) {
        const n = Math.floor((span - spec.w) / spec.gap) + 1;
        for (let k = 0; k < n; k++) out[side].push([r1(at + (span * (k + 0.5)) / n), spec.w]);
      }
      at = Math.max(at, hi);
    }
  }
  return out;
}

/** Runs of wall end to end (a window between two counts as wall too) joined into one long box each. */
function joined(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const w of [...boxes].sort((p, q) => p.x - p.hw - (q.x - q.hw) || p.z - p.hd - (q.z - q.hd))) {
    const alongX = w.hw > w.hd;
    const o = out.find((o) => (alongX ? o.hw > o.hd && o.z === w.z && o.hd === w.hd && Math.abs(o.x + o.hw - (w.x - w.hw)) < 0.01 : o.hd > o.hw && o.x === w.x && o.hw === w.hw && Math.abs(o.z + o.hd - (w.z - w.hd)) < 0.01));
    if (!o) {
      out.push({ x: w.x, z: w.z, hw: w.hw, hd: w.hd });
      continue;
    }
    const lo = alongX ? o.x - o.hw : o.z - o.hd;
    const hi = alongX ? w.x + w.hw : w.z + w.hd;
    if (alongX) {
      o.x = (lo + hi) / 2;
      o.hw = (hi - lo) / 2;
    } else {
      o.z = (lo + hi) / 2;
      o.hd = (hi - lo) / 2;
    }
  }
  return out;
}

/** The glass filling a w by d building's window openings (as glaze() gives them), not yet numbered. */
function panesOf(x: number, z: number, w: number, d: number, glass: Gap[][]): Pane[] {
  const out: Pane[] = [];
  glass.forEach((list, side) => {
    for (const [u, width] of list) {
      if (side < 2) out.push({ x: x + u, z: side === 0 ? z - d / 2 : z + d / 2, hw: width / 2, hd: WALL_T / 2, i: -1, b: -1, ox: 0, oz: side === 0 ? -1 : 1 });
      else out.push({ x: side === 2 ? x - w / 2 : x + w / 2, z: z + u, hw: WALL_T / 2, hd: width / 2, i: -1, b: -1, ox: side === 2 ? -1 : 1, oz: 0 });
    }
  });
  return out;
}

// -------------------------------------------------------------------------------------------------------------------
// What is where. Each grid cell lists, in order, the things whose footprint reaches into it, so asking what stands at
// a point only looks at what is near it: the same answer as looking at everything, much sooner.

type Lists = 'bushes' | 'fields' | 'ponds' | 'fires' | 'pads' | 'yards' | 'rooms' | 'bridges' | 'roads' | 'river';
type Lookup = { of: unknown[]; cells: Record<Lists, number[][]> };
const lookups = new WeakMap<GameMap, Lookup>();
/** The lists a lookup was worked out from, and how long each was (so one swapped for another, or grown, is noticed). */
const sources = (map: GameMap) => [map.bushes, map.fields, map.ponds, map.fires, map.pads, map.yards, map.buildings, map.bridges, map.roads, map.river];

function lookup(map: GameMap): Lookup {
  const got = lookups.get(map);
  if (got) {
    const of = got.of;
    // checked one by one, since this is asked many times a frame
    if (
      of[0] === map.bushes && of[1] === map.bushes.length && of[2] === map.fields && of[3] === map.fields.length && of[4] === map.ponds && of[5] === map.ponds.length &&
      of[6] === map.fires && of[7] === map.fires.length && of[8] === map.pads && of[9] === map.pads.length && of[10] === map.yards && of[11] === map.yards.length &&
      of[12] === map.buildings && of[13] === map.buildings.length && of[14] === map.bridges && of[15] === map.bridges.length && of[16] === map.roads &&
      of[17] === map.roads.length && of[18] === map.river && of[19] === map.river.length
    )
      return got;
  }
  const cells = {} as Record<Lists, number[][]>;
  const put = (k: Lists, i: number, x0: number, z0: number, x1: number, z1: number) => {
    const list = (cells[k] ??= Array.from({ length: COLS * COLS }, () => []));
    for (let cz = cellOf(z0); cz <= cellOf(z1); cz++) for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) list[cx + cz * COLS].push(i);
  };
  const keys: Lists[] = ['bushes', 'fields', 'ponds', 'fires', 'pads', 'yards', 'rooms', 'bridges', 'roads', 'river'];
  for (const k of keys) cells[k] = Array.from({ length: COLS * COLS }, () => []);
  map.bushes.forEach((b, i) => put('bushes', i, b.x - b.r, b.z - b.r, b.x + b.r, b.z + b.r));
  map.fields.forEach((f, i) => put('fields', i, f.x - f.hw, f.z - f.hd, f.x + f.hw, f.z + f.hd));
  map.ponds.forEach((p, i) => put('ponds', i, p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r));
  map.fires.forEach((f, i) => put('fires', i, f.x - CAMP.r, f.z - CAMP.r, f.x + CAMP.r, f.z + CAMP.r));
  map.pads.forEach((p, i) => put('pads', i, p.x - PAD.r, p.z - PAD.r, p.x + PAD.r, p.z + PAD.r));
  map.yards.forEach((y, i) => put('yards', i, y.x - y.hw, y.z - y.hd, y.x + y.hw, y.z + y.hd));
  // roofed buildings out to the outside of their walls, a little more
  map.buildings.forEach((b, i) => b.roof && put('rooms', i, b.x - b.w / 2 - WALL_T, b.z - b.d / 2 - WALL_T, b.x + b.w / 2 + WALL_T, b.z + b.d / 2 + WALL_T));
  map.bridges.forEach((b, i) => put('bridges', i, b.x - b.hw, b.z - b.hd, b.x + b.hw, b.z + b.hd));
  map.roads.forEach((r, i) => put('roads', i, Math.min(r.x0, r.x1) - ROAD_HALF, Math.min(r.z0, r.z1) - ROAD_HALF, Math.max(r.x0, r.x1) + ROAD_HALF, Math.max(r.z0, r.z1) + ROAD_HALF));
  // a stretch of river by the segment that ends at each point
  for (let i = 1; i < map.river.length; i++) {
    const a = map.river[i - 1];
    const b = map.river[i];
    put('river', i, Math.min(a.x, b.x) - RIVER_HALF, Math.min(a.z, b.z) - RIVER_HALF, Math.max(a.x, b.x) + RIVER_HALF, Math.max(a.z, b.z) + RIVER_HALF);
  }
  const of: unknown[] = [];
  for (const list of sources(map)) of.push(list, list.length);
  const made = { of, cells };
  lookups.set(map, made);
  return made;
}

/** The things of one kind whose footprint reaches the grid cell a point is in, in order. */
const near = (map: GameMap, k: Lists, x: number, z: number) => lookup(map).cells[k][cellOf(x) + cellOf(z) * COLS];

/** The building whose floor (inside the walls, under a roof) holds a point, or -1. */
export function buildingAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'rooms', x, z)) {
    const b = map.buildings[i];
    if (b.roof && Math.abs(x - b.x) < b.w / 2 - WALL_T / 2 && Math.abs(z - b.z) < b.d / 2 - WALL_T / 2) return i;
  }
  return -1;
}

/** The roofed building whose outer walls stand round a point, or -1. */
export function roomAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'rooms', x, z)) {
    const b = map.buildings[i];
    if (b.roof && Math.abs(x - b.x) < (b.w + WALL_T) / 2 && Math.abs(z - b.z) < (b.d + WALL_T) / 2) return i;
  }
  return -1;
}

/** How far out from a doorway you can still peek in through it. */
export const PEEK = 8;

/** How far out from a window you can still look in through it (glass or no glass). */
export const PEEK_GLASS = 4;

/**
 * The roofed building a point outside it looks into through a doorway, or -1: standing at a door, or lined up with one
 * up to PEEK meters out, in a wedge that widens away from it. The nearest door wins, but not one that is shut (`shut`
 * says which are, by door). Failing a door, the nearest window up to PEEK_GLASS out does. The view thins that roof.
 */
export function peekAt(map: GameMap, x: number, z: number, shut?: (slab: number) => boolean) {
  let best = -1;
  let near = Infinity;
  let glass = -1;
  let nearGlass = Infinity;
  for (let i = 0; i < map.buildings.length; i++) {
    const b = map.buildings[i];
    if (!b.roof || Math.abs(x - b.x) > b.w / 2 + PEEK || Math.abs(z - b.z) > b.d / 2 + PEEK) continue;
    for (const d of b.doors) {
      if (shut && d.slab !== undefined && shut(d.slab)) continue;
      const out = (x - d.x) * d.ox + (z - d.z) * d.oz;
      const side = Math.abs((x - d.x) * d.oz - (z - d.z) * d.ox);
      if (out < -0.6 || out > PEEK || out >= near || side > d.w / 2 + 1.2 + Math.max(0, out) * 0.3) continue;
      best = i;
      near = out;
    }
    for (const p of b.windows) {
      const out = (x - p.x) * p.ox + (z - p.z) * p.oz;
      const side = Math.abs((x - p.x) * p.oz - (z - p.z) * p.ox);
      if (out < 0 || out > PEEK_GLASS || out >= nearGlass || side > Math.max(p.hw, p.hd) + 0.6 + out * 0.3) continue;
      glass = i;
      nearGlass = out;
    }
  }
  return best >= 0 ? best : glass;
}

/** The bush hiding a point, or -1. */
export function bushAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'bushes', x, z)) {
    const b = map.bushes[i];
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r * 0.72) return i;
  }
  return -1;
}

/** The cornfield a point stands in, or -1. */
export function fieldAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'fields', x, z)) {
    const f = map.fields[i];
    if (Math.abs(x - f.x) < f.hw - 0.3 && Math.abs(z - f.z) < f.hd - 0.3) return i;
  }
  return -1;
}

/** Cover that hides an egg standing in it: a bush (its index) or a cornfield (after the bushes), else -1. */
export function coverAt(map: GameMap, x: number, z: number) {
  const b = bushAt(map, x, z);
  if (b >= 0) return b;
  const f = fieldAt(map, x, z);
  return f >= 0 ? map.bushes.length + f : -1;
}

/** The pond a point is in, or -1. */
export function pondAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'ponds', x, z)) {
    const p = map.ponds[i];
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < p.r * p.r) return i;
  }
  return -1;
}

/** How far a point is from a segment, squared. */
function segDist2(x: number, z: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / len2)) : 0;
  const px = x0 + dx * u - x;
  const pz = z0 + dz * u - z;
  return px * px + pz * pz;
}

/** True on a dirt road. */
export function roadAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'roads', x, z)) {
    const r = map.roads[i];
    if (segDist2(x, z, r.x0, r.z0, r.x1, r.z1) < ROAD_HALF * ROAD_HALF) return true;
  }
  return false;
}

/** How far a point is from the river's middle line, squared (Infinity on an island with no river). */
export function riverDist2(map: GameMap, x: number, z: number) {
  let best = Infinity;
  const r = map.river;
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1];
    const b = r[i];
    // a cheap miss first: both ends far off on the same side
    if ((a.x - x > 40 && b.x - x > 40) || (x - a.x > 40 && x - b.x > 40) || (a.z - z > 40 && b.z - z > 40) || (z - a.z > 40 && z - b.z > 40)) continue;
    const d = segDist2(x, z, a.x, a.z, b.x, b.z);
    if (d < best) best = d;
  }
  return best;
}

/** The bridge whose deck a point is on, or -1. */
export function bridgeAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'bridges', x, z)) {
    const b = map.bridges[i];
    if (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) return i;
  }
  return -1;
}

/** In the river (and not up on a bridge over it). */
export function riverAt(map: GameMap, x: number, z: number) {
  // only the stretches of river near the point can reach it
  const r = map.river;
  let wet = false;
  for (const i of near(map, 'river', x, z)) {
    if (segDist2(x, z, r[i - 1].x, r[i - 1].z, r[i].x, r[i].z) < RIVER_HALF * RIVER_HALF) {
      wet = true;
      break;
    }
  }
  return wet && bridgeAt(map, x, z) < 0;
}

/** Wading: in a pond or the river. */
export const waterAt = (map: GameMap, x: number, z: number) => pondAt(map, x, z) >= 0 || riverAt(map, x, z);

/** Out on the grass (or in a bush or the corn): not indoors, on a road, a bridge or a bounce pad, nor in the water. */
export const grassAt = (map: GameMap, x: number, z: number) => roomAt(map, x, z) < 0 && !roadAt(map, x, z) && bridgeAt(map, x, z) < 0 && padAt(map, x, z) < 0 && !waterAt(map, x, z);

/** True when two segments cross. */
function crosses(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = side(cx, cz, dx, dz, ax, az);
  const d2 = side(cx, cz, dx, dz, bx, bz);
  const d3 = side(ax, az, bx, bz, cx, cz);
  const d4 = side(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** How many times the way from one point to another crosses the river's middle line (odd: they're on opposite banks). */
export function riverCrossings(map: GameMap, x0: number, z0: number, x1: number, z1: number) {
  let n = 0;
  const r = map.river;
  for (let i = 1; i < r.length; i++) if (crosses(x0, z0, x1, z1, r[i - 1].x, r[i - 1].z, r[i].x, r[i].z)) n++;
  return n;
}

/** How near a segment comes to the river's middle line, squared. */
export function riverSegDist2(map: GameMap, x0: number, z0: number, x1: number, z1: number) {
  if (riverCrossings(map, x0, z0, x1, z1) > 0) return 0;
  let best = Math.min(riverDist2(map, x0, z0), riverDist2(map, x1, z1));
  for (const p of map.river) best = Math.min(best, segDist2(p.x, p.z, x0, z0, x1, z1));
  return best;
}

/** The campfire warming a point, or -1. */
export function fireAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'fires', x, z)) {
    const f = map.fires[i];
    const dx = x - f.x;
    const dz = z - f.z;
    if (dx * dx + dz * dz < CAMP.r * CAMP.r) return i;
  }
  return -1;
}

/** The bounce pad under a point, or -1. */
export function padAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'pads', x, z)) {
    const p = map.pads[i];
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < PAD.r * PAD.r) return i;
  }
  return -1;
}

/** The fenced yard a point is in (inside the fence line), or -1. */
export function yardAt(map: GameMap, x: number, z: number) {
  for (const i of near(map, 'yards', x, z)) {
    const y = map.yards[i];
    if (Math.abs(x - y.x) < y.hw - FENCE_T / 2 && Math.abs(z - y.z) < y.hd - FENCE_T / 2) return i;
  }
  return -1;
}

/** The named place a point is in (the nearest middle when two overlap), or -1. */
export function placeAt(map: GameMap, x: number, z: number) {
  let best = -1;
  let near = Infinity;
  for (let i = 0; i < map.places.length; i++) {
    const p = map.places[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const k = (dx * dx + dz * dz) / (p.r * p.r);
    if (k < 1 && k < near) {
      best = i;
      near = k;
    }
  }
  return best;
}

function planBus(rng: Rng): Bus {
  // across the island from one side to the opposite one, passing near the middle
  const u = (rng() * 2 - 1) * 160;
  const off = (rng() * 2 - 1) * 70;
  const far = HALF + 22;
  const side = Math.floor(rng() * 4);
  let x0: number, z0: number, x1: number, z1: number;
  if (side === 0) [x0, z0, x1, z1] = [u, -far, -u + off, far];
  else if (side === 1) [x0, z0, x1, z1] = [u, far, -u + off, -far];
  else if (side === 2) [x0, z0, x1, z1] = [-far, u, far, -u + off];
  else [x0, z0, x1, z1] = [far, u, -far, -u + off];
  const len = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
  const dx = (x1 - x0) / len;
  const dz = (z1 - z0) / len;
  // over land a couple of meters in from the shore, found from both ends of the route
  const land = EDGE - 2;
  const enter = rayBox(x0, z0, dx, dz, len, 0, 0, land, land);
  const leave = rayBox(x1, z1, -dx, -dz, len, 0, 0, land, land);
  return { x0, z0, x1, z1, len, dur: len / BUS_SPEED, on: enter / BUS_SPEED, off: (len - leave) / BUS_SPEED };
}

/**
 * A river from the shore on one side of the island to the shore across, wandering as it goes. The heading turns a
 * little each step (no trig: the turn is added side on, then the heading is scaled back to length one), is pulled
 * back when the river strays far from the middle, and never doubles back; then the corners are cut (twice when there
 * are few) so it bends smoothly.
 */
function planRiver(rng: Rng): River {
  const alongX = rng() < 0.5;
  const flip = rng() < 0.5 ? 1 : -1;
  let u = -HALF;
  let v = Math.round((rng() * 2 - 1) * 90);
  let hu = 1;
  let hv = (rng() * 2 - 1) * 0.4;
  let turn = 0;
  const far = HALF - 40;
  let pts: [number, number][] = [[u, v]];
  while (u < HALF) {
    turn = turn * 0.75 + (rng() * 2 - 1) * 0.3 - v / 1350;
    const nu = Math.max(0.5, hu - hv * turn);
    const nv = hv + hu * turn;
    const l = Math.sqrt(nu * nu + nv * nv);
    hu = nu / l;
    hv = nv / l;
    const pu = u;
    const pv = v;
    u += hu * 13;
    v = Math.max(-far, Math.min(far, v + hv * 13));
    // the last point on the shore line itself
    if (u >= HALF) {
      v = pv + ((v - pv) * (HALF - pu)) / (u - pu);
      u = HALF;
    }
    pts.push([u, v]);
  }
  for (let pass = 0; pass < 2; pass++) {
    if (pass && pts.length > 40) break;
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [au, av] = pts[i - 1];
      const [bu, bv] = pts[i];
      out.push([au * 0.75 + bu * 0.25, av * 0.75 + bv * 0.25], [au * 0.25 + bu * 0.75, av * 0.25 + bv * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const river: River = [];
  pts.forEach(([a, b], i) => {
    const p = alongX ? { x: r1(a * flip), z: r1(b) } : { x: r1(b), z: r1(a * flip) };
    const last = river[river.length - 1];
    // no two points on top of each other, and the one on the far shore always kept
    if (last && Math.abs(last.x - p.x) + Math.abs(last.z - p.z) <= 0.5) {
      if (i === pts.length - 1) river[river.length - 1] = p;
    } else river.push(p);
  });
  return river;
}

function planStorm(rng: Rng): Storm {
  const circles: StormCircle[] = [{ x: 0, z: 0, r: STORM_R0 }];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  for (const phase of STORM_PHASES) {
    const prev = circles[circles.length - 1];
    const room = Math.max(0, prev.r - phase.r);
    // the land a circle of this size may sit on, so the last circles are never out at sea
    const limit = HALF - BEACH - Math.max(phase.r * 0.6, 4);
    let next = { x: Math.max(-limit, Math.min(limit, prev.x)), z: Math.max(-limit, Math.min(limit, prev.z)), r: phase.r };
    for (let i = 0; i < 40; i++) {
      // rounded first, so the circle that's stored is the one that was checked
      const x = r1(prev.x + (rng() * 2 - 1) * room);
      const z = r1(prev.z + (rng() * 2 - 1) * room);
      if ((x - prev.x) * (x - prev.x) + (z - prev.z) * (z - prev.z) > room * room || Math.abs(x) > limit || Math.abs(z) > limit) continue;
      next = { x, z, r: phase.r };
      break;
    }
    circles.push(next);
    t += phase.wait;
    starts.push(t);
    t += phase.shrink;
    ends.push(t);
  }
  return { circles, starts, ends };
}

/** When the last circle has closed. */
export const stormEnd = (s: Storm) => s.ends[s.ends.length - 1];

export type StormNow = {
  x: number;
  z: number;
  r: number;
  /** Where the storm is headed next (the same circle once it has fully closed). */
  next: StormCircle;
  shrinking: boolean;
  /** Seconds until the storm starts moving, or until it stops when shrinking. */
  timer: number;
  /** Health per second outside the circle. */
  dps: number;
  /** 0 before the first shrink, then the phase being closed or waited out. */
  phase: number;
};

export function stormAt(s: Storm, time: number): StormNow {
  const n = s.starts.length;
  for (let i = 0; i < n; i++) {
    const a = s.circles[i];
    const b = s.circles[i + 1];
    const dps = STORM_PHASES[i].dps;
    if (time < s.starts[i]) return { x: a.x, z: a.z, r: a.r, next: b, shrinking: false, timer: s.starts[i] - time, dps: i === 0 ? 0 : STORM_PHASES[i - 1].dps, phase: i };
    if (time < s.ends[i]) {
      const f = (time - s.starts[i]) / (s.ends[i] - s.starts[i]);
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, r: a.r + (b.r - a.r) * f, next: b, shrinking: true, timer: s.ends[i] - time, dps, phase: i + 1 };
    }
  }
  const last = s.circles[n];
  return { x: last.x, z: last.z, r: last.r, next: last, shrinking: false, timer: 0, dps: STORM_PHASES[n - 1].dps, phase: n };
}

/** Where the bus is at a match time (it waits at the start during the countdown). */
export function busAt(bus: Bus, time: number) {
  const f = Math.max(0, Math.min(1, time / bus.dur));
  return { x: bus.x0 + (bus.x1 - bus.x0) * f, z: bus.z0 + (bus.z1 - bus.z0) * f };
}

const cellOf = (v: number) => Math.max(0, Math.min(COLS - 1, Math.floor((v + HALF) / CELL)));

/** Rebuilds the grids over the solids (after the island is made, or a test has changed it). */
export function reindex(map: GameMap) {
  map.grid = Array.from({ length: COLS * COLS }, () => []);
  map.under = Array.from({ length: COLS * COLS }, () => []);
  // a supply drop no flare has called yet is nowhere
  const waiting = new Set(map.flares.filter((id) => map.containers[id].at === Infinity).map((id) => map.containers[id].solid));
  map.solids.forEach((s, i) => {
    if (waiting.has(i)) return;
    // a little margin, so a ray grazing a cell corner still meets everything near it; what's underground goes in a
    // grid of its own, laid over the island it lies under
    const grid = isDeep(s.x) ? map.under : map.grid;
    const x = topX(s.x);
    const rx = (s.shape === 'circle' ? s.r : s.hw) + 0.5;
    const rz = (s.shape === 'circle' ? s.r : s.hd) + 0.5;
    for (let cz = cellOf(s.z - rz); cz <= cellOf(s.z + rz); cz++) for (let cx = cellOf(x - rx); cx <= cellOf(x + rx); cx++) grid[cx + cz * COLS].push(i);
  });
  map.stamp = new Uint32Array(map.solids.length);
  map.mark = 0;
}

export function generateMap(seed: number): GameMap {
  // (swapped for a generator of its own for the underground, at the end)
  let rng = rng32(seed);
  const map: GameMap = {
    seed,
    trees: [],
    rocks: [],
    bushes: [],
    fields: [],
    ponds: [],
    river: [],
    bridges: [],
    logs: [],
    stumps: [],
    furniture: [],
    buildings: [],
    windows: [],
    slabs: [],
    stairs: [],
    coop: -1,
    containers: [],
    drops: [],
    flares: [],
    fires: [],
    pads: [],
    roads: [],
    yards: [],
    cars: [],
    lamps: [],
    mailboxes: [],
    tables: [],
    places: [],
    floor: [],
    solids: [],
    grid: [],
    under: [],
    bus: planBus(rng),
    storm: planStorm(rng),
    stamp: new Uint32Array(0),
    mark: 0,
  };

  const dist = (ax: number, az: number, bx: number, bz: number) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
  const onLand = (x: number, z: number, margin: number) => Math.abs(x) <= HALF - BEACH - margin && Math.abs(z) <= HALF - BEACH - margin;

  // Footprints already taken by bridges, buildings, yards and fields; everything keeps its distance from them.
  const lots: Box[] = [];

  // the river, and three to five bridges spread along it, each square across it along x or z from dry bank to dry bank
  map.river = planRiver(rng);
  const reach = map.river.slice(1).map((b, i) => {
    const a = map.river[i];
    const len = dist(a.x, a.z, b.x, b.z);
    return { x: a.x, z: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, len };
  });
  const total = reach.reduce((n, r) => n + r.len, 0);
  const wet = (x: number, z: number) => riverDist2(map, x, z) < RIVER_HALF * RIVER_HALF;
  const bridgeLots: Box[] = [];
  const bridges = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < bridges; k++) {
    for (let tries = 0; tries < 12; tries++) {
      let s = total * ((k + 0.5) / bridges + (rng() * 2 - 1) * 0.12);
      const r = reach.find((q) => (s -= q.len) < 0) ?? reach[reach.length - 1];
      const px = r.x + r.ux * (r.len + s);
      const pz = r.z + r.uz * (r.len + s);
      if (!onLand(px, pz, 16)) continue;
      // across a river that runs more along z, the deck runs along x
      const alongX = Math.abs(r.uz) >= Math.abs(r.ux);
      const ax = alongX ? 1 : 0;
      const az = alongX ? 0 : 1;
      // how far the water reaches either way, along the deck's middle and both its edges
      let lo = 0;
      let hi = 0;
      for (const side of [-BRIDGE_HALF, 0, BRIDGE_HALF])
        for (const dir of [-1, 1])
          for (let o = 0.5; o < 24 && wet(px + ax * o * dir + az * side, pz + az * o * dir + ax * side); o += 0.5) {
            if (dir > 0) hi = Math.max(hi, o);
            else lo = Math.max(lo, o);
          }
      if (lo + hi > 18) continue;
      const half = r1((lo + hi) / 2 + 0.5 + BRIDGE_STEP);
      const x = r1(px + (ax * (hi - lo)) / 2);
      const z = r1(pz + (az * (hi - lo)) / 2);
      // dry at both ends, and well along the river from the last
      if ([-1, 1].some((e) => [-BRIDGE_HALF, 0, BRIDGE_HALF].some((side) => wet(x + ax * e * (half - 0.4) + az * side, z + az * e * (half - 0.4) + ax * side)))) continue;
      if (map.bridges.some((b) => dist(b.x, b.z, x, z) < 45)) continue;
      // and over the river just the once, not across a bend twice
      const e = [-1, 1].map((k) => ({ x: x + ax * k * half, z: z + az * k * half }));
      if (riverCrossings(map, e[0].x, e[0].z, e[1].x, e[1].z) !== 1) continue;
      map.bridges.push({ x, z, hw: alongX ? half : BRIDGE_HALF, hd: alongX ? BRIDGE_HALF : half, alongX });
      const lot = { x, z, hw: alongX ? half + BRIDGE_CLEAR : BRIDGE_HALF + 1.5, hd: alongX ? BRIDGE_HALF + 1.5 : half + BRIDGE_CLEAR };
      lots.push(lot);
      bridgeLots.push(lot);
      break;
    }
  }
  /** Clear of the river by `margin` past the water's edge, for a box (its corners squared off, so a little more). */
  const dryBox = (x: number, z: number, hw: number, hd: number, margin: number) =>
    reach.every((r) => rayBox(r.x, r.z, r.ux, r.uz, r.len, x, z, hw + RIVER_HALF + margin, hd + RIVER_HALF + margin) === Infinity);
  // buildings keep five meters from the water at most, so they still fit
  const clear = (x: number, z: number, hw: number, hd: number, margin: number) =>
    lots.every((l) => Math.abs(l.x - x) >= l.hw + hw + margin || Math.abs(l.z - z) >= l.hd + hd + margin) && dryBox(x, z, hw, hd, Math.min(margin, 5));
  const nearLot = (x: number, z: number, margin: number) => lots.some((l) => Math.abs(x - l.x) < l.hw + margin && Math.abs(z - l.z) < l.hd + margin);
  const roomFor = (hw: number, hd: number) => {
    const x = Math.round((rng() * 2 - 1) * (HALF - BEACH - hw - 5));
    const z = Math.round((rng() * 2 - 1) * (HALF - BEACH - hd - 5));
    return { x, z };
  };

  const floorItems = (x: number, z: number, defs: LootDef[], base: number): LootSpawn[] => defs.slice(0, SPREAD.length).map((def, j) => ({ id: base + j, def, x: r1(x + SPREAD[j][0]), z: r1(z + SPREAD[j][1]) }));
  // ids step eight per item already placed, so no two spots can share one however many items each holds
  const addSpot = (x: number, z: number, tier: LootTier = 'floor') => {
    const defs = rollLoot(rng, tier);
    map.floor.push(...floorItems(x, z, defs, FLOOR_BASE + map.floor.length * 8));
  };
  const addContainer = (kind: Container['kind'], x: number, z: number, face: 1 | -1, tier: LootTier | null, at = 0, ax = false) => {
    const id = map.containers.length;
    const defs = tier ? rollLoot(rng, tier) : [];
    const ahead = kind === 'supply' ? 1.7 : 1.3;
    // what breaks spills where it stood; what opens spills out in front (in a row along the wall it stands against)
    const spread = kind === 'crate' || kind === 'toilet' || kind === 'hay';
    const loot = defs.slice(0, SPREAD.length).map((def, j) => {
      const u = (j - (defs.length - 1) / 2) * 0.9;
      return spread
        ? { id: CONTAINER_BASE + id * 8 + j, def, x: r1(x + SPREAD[j][0]), z: r1(z + SPREAD[j][1]) }
        : { id: CONTAINER_BASE + id * 8 + j, def, x: r1(x + (ax ? face * ahead : u)), z: r1(z + (ax ? u : face * ahead)) };
    });
    map.containers.push({ id, kind, x: r1(x), z: r1(z), face, ax, loot, solid: -1, gold: tier === 'gold', at, flare: at === Infinity });
    return id;
  };
  const quads = (b: { x: number; z: number; w: number; d: number }) =>
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].map(([qx, qz]) => ({ x: b.x + (qx * b.w) / 4, z: b.z + (qz * b.d) / 4, qz }));
  /**
   * Loot in each quarter of a room, one of them a chest facing the middle. A kitchen gets a fridge in another quarter
   * and a toilet in a third.
   */
  const furnish = (b: { x: number; z: number; w: number; d: number }, chest: boolean, kitchen = false) => {
    const chestAt = chest ? Math.floor(rng() * 4) : -1;
    const fridgeAt = kitchen ? (chestAt + 1 + Math.floor(rng() * 3)) % 4 : -1;
    const toiletAt = kitchen ? [0, 1, 2, 3].filter((i) => i !== chestAt && i !== fridgeAt)[Math.floor(rng() * 2)] : -1;
    quads(b).forEach((q, i) => {
      if (i === chestAt) addContainer('chest', q.x, q.z, q.qz > 0 ? -1 : 1, 'chest');
      else if (i === fridgeAt) addContainer('fridge', q.x, q.z, q.qz > 0 ? -1 : 1, 'fridge');
      else if (i === toiletAt) addContainer('toilet', q.x, q.z, 1, 'crate');
      else addSpot(q.x, q.z);
    });
  };
  /** Where things outside a building go: `o` meters out from the middle of a side, `l` along it. Sides as in shell(). */
  const beside = (b: { x: number; z: number; w: number; d: number }, side: number, o: number, l: number) => ({
    x: side < 2 ? b.x + l : side === 2 ? b.x - b.w / 2 - o : b.x + b.w / 2 + o,
    z: side < 2 ? (side === 0 ? b.z - b.d / 2 - o : b.z + b.d / 2 + o) : b.z + l,
  });
  const doorOn = (b: Building, side: number) => b.doors.some((d) => (side === 0 ? d.oz < 0 : side === 1 ? d.oz > 0 : side === 2 ? d.ox < 0 : d.ox > 0));
  /** Clear of every doorway (and gate) by `r` past the opening's edge. */
  const offDoors = (x: number, z: number, r: number) => [...map.buildings.flatMap((b) => b.doors), ...map.yards.flatMap((y) => y.gates)].every((d) => Math.abs(d.x - x) >= d.w / 2 + r || Math.abs(d.z - z) >= d.w / 2 + r);

  /**
   * Would a new doorway face another building's across so small a gap that, standing out in front of one, you'd be
   * peeking into the other? Those places are tried again.
   */
  const facing = (doors: Door[]) =>
    doors.some((a) =>
      map.buildings.some(
        (b) =>
          b.roof &&
          b.doors.some((c) => {
            if (a.ox !== -c.ox || a.oz !== -c.oz) return false;
            const out = (c.x - a.x) * a.ox + (c.z - a.z) * a.oz;
            const side = Math.abs((c.x - a.x) * a.oz - (c.z - a.z) * a.ox);
            return out > 0 && out < 2 * PEEK + 2 && side < (a.w + c.w) / 2 + 6;
          }),
      ),
    );
  const build = (kind: BuildingKind, x: number, z: number, w: number, d: number, walls: Box[], doors: Door[], look: number, h: number, glass: Gap[][] = []) => {
    const b = map.buildings.length;
    const windows = panesOf(x, z, w, d, glass).map((p, k) => ({ ...p, i: map.windows.length + k, b }));
    map.windows.push(...windows);
    map.buildings.push({ kind, x, z, w, d, walls, doors, inner: [], windows, bars: [], rooms: [], look, roof: kind !== 'ruin', h });
    return map.buildings[b];
  };

  // Furniture. Anything that stops feet stands flush against a wall or something else, or leaves a way past it at
  // least 1.3 m wide, never in the way in through a doorway, and well clear of what's there to loot.
  /** The gap between two boxes along whichever axis they are farthest apart (below zero when they overlap). */
  const gap = (a: Box, b: Box) => Math.max(Math.abs(a.x - b.x) - a.hw - b.hw, Math.abs(a.z - b.z) - a.hd - b.hd);
  const roomy = (g: number) => g <= 0.05 || g >= 1.3;
  /** The places in a building nothing else may stand: a stairway down and the way onto it. */
  const keepOut = new Map<number, Box[]>();
  /**
   * Whether a box (`stops`: something that stops feet; `stash`: furniture that opens, against wall `face`) fits in
   * building `bi`: indoors, out of the way in through every doorway, against a wall or well clear of it, and clear of
   * what's there to loot, of the other furniture (unless `furniture` is false) and of the stairs (see keepOut).
   */
  const fits = (bi: number, box: Box, stops: boolean, stash: boolean, face: number, furniture = true) => {
    const b = map.buildings[bi];
    const { x, z, hw, hd } = box;
    if (Math.abs(box.x - b.x) + hw > b.w / 2 - WALL_T / 2 + 0.01 || Math.abs(box.z - b.z) + hd > b.d / 2 - WALL_T / 2 + 0.01) return false;
    // the way in through every doorway, from either side of a doorway between rooms
    const ways = [...b.doors.map((d) => ({ d, k: 1 })), ...b.inner.flatMap((d) => [{ d, k: 1 }, { d, k: -1 }])];
    for (const { d, k } of ways) {
      const ax = Math.abs(d.oz);
      const az = Math.abs(d.ox);
      const zone = { x: d.x - d.ox * k * 1.3, z: d.z - d.oz * k * 1.3, hw: ax * (d.w / 2 + 0.5) + az * 1.3, hd: az * (d.w / 2 + 0.5) + ax * 1.3 };
      if (gap(box, zone) < 0) return false;
    }
    for (const w of b.windows.length ? joined([...b.walls, ...b.windows]) : b.walls) if (gap(box, w) < -0.01 || (stops && !roomy(gap(box, w)))) return false;
    // a jail cell's bars only need keeping out of (they end at a wall, so nothing squeezes past them)
    for (const w of b.bars) if (gap(box, w) < -0.01) return false;
    for (const c of map.containers) {
      if (Math.abs(c.x - b.x) > b.w / 2 || Math.abs(c.z - b.z) > b.d / 2) continue;
      const [chw, chd] = containerHalf(c);
      const g = gap(box, { x: c.x, z: c.z, hw: chw, hd: chd });
      if (g < (stops ? 1.3 : 0.15)) return false;
    }
    if (stops) {
      for (const l of map.floor) if (Math.abs(l.x - box.x) < hw + 0.6 && Math.abs(l.z - box.z) < hd + 0.6) return false;
      // (and a piece of furniture never into another one)
      if (furniture) for (const f of map.furniture) if (f.b === bi && furnitureSolid(f.kind) && (!roomy(gap(box, f)) || (!stash && gap(box, f) < -0.01))) return false;
      // and what it holds spills somewhere an egg can stand, clear of the rest
      const spill = { x: x + (face === 2 ? 1.3 : face === 3 ? -1.3 : 0), z: z + (face === 0 ? 1.3 : face === 1 ? -1.3 : 0), hw: face >= 2 ? 0.4 : hw + 0.4, hd: face >= 2 ? hd + 0.4 : 0.4 };
      if (stash && map.furniture.some((f) => f.b === bi && furnitureSolid(f.kind) && gap(spill, f) < 0.2)) return false;
    }
    for (const k of keepOut.get(bi) ?? []) if (gap(box, k) < (stops ? 1.3 : 0.15)) return false;
    return true;
  };
  /**
   * Puts a piece of furniture (or, for a stash kind, a container that opens, or a row of `n` of them side by side
   * along the wall) at (x, z), `face` the side of the wall it stands against, if it fits.
   */
  const fit = (bi: number, kind: FurnitureKind | StashKind, x: number, z: number, hw: number, hd: number, face = 0, look = 0, n = 1) => {
    const b = map.buildings[bi];
    const box = { x, z, hw, hd };
    const stash = isStash(kind);
    if (!fits(bi, box, stash || furnitureSolid(kind as FurnitureKind) !== null, stash, face)) return false;
    if (stash) {
      // it faces away from the wall it stands against
      const ax = face >= 2;
      const step = (2 * (ax ? hd : hw)) / n;
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * step;
        const c = map.containers[addContainer(kind, ax ? x : x + u, ax ? z + u : z, face === 1 || face === 3 ? -1 : 1, STASH[kind].tier, 0, ax)];
        // what it holds stays indoors, even from one in a corner: the row of it slides along the wall
        const iw = b.w / 2 - WALL_T / 2 - 0.4;
        const id = b.d / 2 - WALL_T / 2 - 0.4;
        const slide = (vs: number[], lo: number, hi: number) => (vs.length && Math.min(...vs) < lo ? lo - Math.min(...vs) : vs.length && Math.max(...vs) > hi ? hi - Math.max(...vs) : 0);
        const sx = slide(c.loot.map((l) => l.x), b.x - iw, b.x + iw);
        const sz = slide(c.loot.map((l) => l.z), b.z - id, b.z + id);
        for (const l of c.loot) {
          l.x = r1(l.x + sx);
          l.z = r1(l.z + sz);
        }
      }
      return true;
    }
    map.furniture.push({ ...box, kind: kind as FurnitureKind, face, b: bi, look });
    return true;
  };
  /**
   * Up against the inside of wall `side` (sides as in shell()), `l` along it, `deep` out from it and `long` along it (a
   * row of `n` stash pieces in that length).
   */
  const against = (bi: number, kind: FurnitureKind | StashKind, side: number, l: number, deep: number, long: number, look = 0, n = 1) => {
    const b = map.buildings[bi];
    const o = (side < 2 ? b.d : b.w) / 2 - WALL_T / 2 - deep / 2;
    const x = side < 2 ? b.x + l : b.x + (side === 2 ? -o : o);
    const z = side < 2 ? b.z + (side === 0 ? -o : o) : b.z + l;
    return fit(bi, kind, x, z, side < 2 ? long / 2 : deep / 2, side < 2 ? deep / 2 : long / 2, side, look, n);
  };
  /** The first of a few spots along a wall that fits. */
  const along = (bi: number, kind: FurnitureKind | StashKind, side: number, spots: number[], deep: number, long: number, look = 0) => spots.some((l) => against(bi, kind, side, l, deep, long, look));
  /** The longest of a few lengths that fits somewhere along a wall: in the middle, a little off it, or in a corner. */
  const alongAny = (bi: number, kind: FurnitureKind | StashKind, side: number, deep: number, lengths: number[], look = 0) => {
    const b = map.buildings[bi];
    const span = (side < 2 ? b.w : b.d) / 2 - WALL_T / 2;
    return lengths.some((long) => along(bi, kind, side, [0, -1.5, 1.5, -(span - long / 2), span - long / 2], deep, long, look));
  };
  /** A table with a chair at each side of it, on a rug. */
  const dining = (bi: number, x: number, z: number, alongX: boolean, look: number) => {
    const [hw, hd] = alongX ? [0.85, 0.5] : [0.5, 0.85];
    if (!fit(bi, 'table', x, z, hw, hd, 0, look)) return;
    fit(bi, 'rug', x, z, hw + 1.1, hd + 1.1, 0, look);
    for (const s of [-1, 1])
      for (const t of [-0.45, 0.45]) {
        if (alongX) fit(bi, 'chair', x + t, z + s * 0.85, 0.22, 0.22, s < 0 ? 0 : 1, look);
        else fit(bi, 'chair', x + s * 0.85, z + t, 0.22, 0.22, s < 0 ? 2 : 3, look);
      }
  };
  /**
   * Furnishes a house, farmhouse, shed or warehouse once its loot is in: a table and chairs on a rug, a bed against the
   * middle of a long wall, a kitchen counter by the fridge, shelves; racks down a warehouse's long walls; a workbench in
   * a shed.
   */
  const decorate = (bi: number, room?: { x: number; w: number }) => {
    const b = map.buildings[bi];
    const look = Math.floor(rng() * 4);
    const order = (a: number, c: number) => (rng() < 0.5 ? [a, c] : [c, a]);
    if (b.kind === 'shed') {
      for (const side of order(0, 1).concat(order(2, 3))) if (against(bi, 'counter', side, 0, 0.6, 2, look)) break;
      // now and then a tool locker
      if (rng() < 0.4) for (const side of order(0, 1).concat(order(2, 3))) if (lockers(bi, side, [1.6, -1.6, 1.2, -1.2], 1)) break;
      return;
    }
    if (b.kind === 'warehouse') {
      const long = b.w > b.d ? [0, 1] : [2, 3];
      const span = (b.w > b.d ? b.w : b.d) / 2;
      for (const side of long) for (const l of [-span + 4, -span + 9.5, span - 9.5, span - 4]) against(bi, 'shelf', side, l, 1, 4.6, look);
      // the workers' lockers against an end wall
      const ends = b.w > b.d ? [2, 3] : [0, 1];
      const across = (b.w > b.d ? b.d : b.w) / 2;
      for (const side of order(ends[0], ends[1])) if (lockers(bi, side, [across - 2.2, -across + 1.6, across - 3.4], 2)) break;
      return;
    }
    // a house is one room; a farmhouse has a big room and a kitchen beside it
    const rx = room?.x ?? b.x;
    const rw = room?.w ?? b.w;
    dining(bi, rx, b.z, true, look);
    // a bed against a long wall, the north one first: the south wall would hide it from the camera
    for (const side of [0, 1]) if (along(bi, 'bed', side, [0, -1, 1, -2.5, 2.5].map((u) => rx - b.x + u), 2.1, 1.5, look)) break;
    // a kitchen counter along the end wall by the fridge (in a house, the other end will do when a door's in the way)
    const fridge = map.containers.find((c) => c.kind === 'fridge' && Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2);
    const by = fridge ? (fridge.x < b.x ? 2 : 3) : rng() < 0.5 ? 2 : 3;
    const kitchen = [by, ...(room ? [] : [5 - by])].find((side) => alongAny(bi, 'counter', side, 0.6, [4, 2.6, 1.8], look)) ?? by;
    // shelves at the other end of the big room
    const end = room ? (rx > b.x ? 3 : 2) : 5 - kitchen;
    along(bi, 'shelf', end, [0, -2, 2, -3, 3], 0.45, 1.8, look);
    if (rw >= 14) along(bi, 'shelf', end, [-3.5, 3.5], 0.45, 1.4, look);
    // a chest of drawers against a long wall, and a bookshelf wherever one goes
    const spots = [-3, 3, -1.5, 1.5, -4.5, 4.5, 0].map((u) => rx - b.x + u);
    for (const side of order(0, 1)) if (along(bi, 'drawer', side, spots, STASH.drawer.deep * 2, STASH.drawer.along * 2, look)) break;
    for (const side of order(0, 1).concat(room ? [end] : order(2, 3))) if (along(bi, 'books', side, side < 2 ? spots : [0, -1.5, 1.5, -2.5, 2.5], STASH.books.deep * 2, STASH.books.along * 2, look)) break;
  };
  /** A row of `n` lockers side by side against wall `side`, at the first of `spots` with room for all of them. */
  const lockers = (bi: number, side: number, spots: number[], n: number) =>
    spots.some((l) => {
      const [deep, long] = [STASH.locker.deep * 2, STASH.locker.along * 2];
      return against(bi, 'locker', side, l + ((n - 1) * long) / 2, deep, long * n, 0, n);
    });

  // everything outdoors keeps its distance from buildings and from each other
  const taken: Circle[] = [];
  const free = (x: number, z: number, r: number) => taken.every((c) => (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) >= (c.r + r) * (c.r + r)) && riverDist2(map, x, z) >= (RIVER_HALF + r) * (RIVER_HALF + r);

  /** The places roads link and names go to: every building but the shipping containers (their yard counts once), and camps. */
  const sites: { x: number; z: number; hw: number; hd: number; kind: 'building' | 'yard' | 'camp'; b?: number }[] = [];

  const barrelsAround = (x: number, z: number, hw: number, hd: number, n: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const side = Math.floor(rng() * 4);
      const along = (rng() * 2 - 1) * 0.8;
      const bx = r1(side < 2 ? x + along * hw : x + (side === 2 ? -1 : 1) * (hw + 1.7));
      const bz = r1(side < 2 ? z + (side === 0 ? -1 : 1) * (hd + 1.7) : z + along * hd);
      if (Math.abs(bx) > HALF - BEACH - 2 || Math.abs(bz) > HALF - BEACH - 2 || nearLot(bx, bz, 0.9) || !free(bx, bz, 1.2)) continue;
      taken.push({ x: bx, z: bz, r: 1.2 });
      addContainer('barrel', bx, bz, 1, null);
      k++;
    }
  };

  // a diner and a windmill, now and then a second of one of them, each going by its own name
  const special: BuildingKind[] = rng() < 0.5 ? ['diner', 'mill'] : ['mill', 'diner'];
  const ownName = new Map<number, string>();
  /** A name from the list that no other building has taken yet. */
  const nameFrom = (list: string[]) => {
    const left = list.filter((n) => ![...ownName.values()].includes(n));
    return left[Math.floor(rng() * left.length)];
  };
  // far enough apart that each makes a place of its own
  const apart = (x: number, z: number) => map.buildings.every((o) => !NAMED.includes(o.kind) || dist(o.x, o.z, x, z) >= 80);
  for (const kind of plan(rng() < 0.5 ? [...special, special[0]] : special)) {
    for (let tries = 0; tries < 200; tries++) {
      if (kind === 'diner') {
        // a long dining room: booths along the front, a counter with stools across the middle, and behind it the
        // kitchen with two fridges, a chest and a back door. `fz` points out the front.
        const w = 20;
        const d = 12;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, 10) || !apart(x, z)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const fz = rng() < 0.5 ? 1 : -1;
        const walls: Box[] = [];
        const gaps = sides();
        const front = fz > 0 ? 1 : 0;
        gaps[front].push([Math.round((rng() * 2 - 1) * 3) / 2, DOOR]);
        const back = (rng() < 0.5 ? -1 : 1) * (w / 2 - 3);
        gaps[1 - front].push([back, DOOR]);
        // big windows along the front and the ends, none behind the kitchen
        const glass = glaze('diner', w, d, gaps, [front, 2, 3]);
        const b = build('diner', x, z, w, d, walls, shell(walls, x, z, w, d, gaps, WALL_T, glass), Math.floor(rng() * 4), 3.6, glass);
        const bi = map.buildings.length - 1;
        ownName.set(bi, nameFrom(DINER_NAMES));
        // the kitchen's stash
        const s = back > 0 ? -1 : 1;
        for (const u of [3, 1.6]) addContainer('fridge', x + u * s, z - fz * (d / 2 - WALL_T / 2 - FRIDGE_HD - 0.05), fz as 1 | -1, 'fridge');
        addContainer('chest', x - 2.2 * s, z - fz * (d / 2 - 1.2), fz as 1 | -1, 'chest');
        addSpot(x + 8 * s, z - fz * 2.6, 'crate');
        addSpot(x - 5, z + fz * 1.2);
        addSpot(x + 5, z + fz * 1.2);
        // booths against the front wall, either side of the door; the counter and its stools
        for (const u of [-7.5, -4.5, 4.5, 7.5]) against(bi, 'booth', front, u, 2, 1.6, b.look);
        fit(bi, 'counter', x - 0.5, z - fz * 1.3, 5.5, 0.3, front, b.look);
        for (let u = -5; u <= 4; u += 1.5) fit(bi, 'stool', x + u, z - fz * 0.5, 0.22, 0.22, front, b.look);
        break;
      }
      if (kind === 'police') {
        // a police station: a lobby with a desk and a row of lockers, and behind it a jail cell (bars along its front,
        // a bench and a toilet) and the stash room (a chest of the good stuff, more lockers and an ammo crate). In by
        // the front door, or a side door into the lobby. `fz` points out the front, `sc` toward the cell's end.
        const w = 20;
        const d = 14;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, 10) || !apart(x, z)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const fz = rng() < 0.5 ? 1 : -1;
        const sc = rng() < 0.5 ? 1 : -1;
        const front = fz > 0 ? 1 : 0;
        const back = 1 - front;
        // the wall between the lobby and the back rooms, and the one between the cell and the stash
        const zi = z - fz * 1.5;
        const xd = x + sc * 4;
        const walls: Box[] = [];
        const gaps = sides();
        gaps[front].push([Math.round((rng() * 2 - 1) * 4) / 2, DOOR]);
        gaps[sc > 0 ? 2 : 3].push([fz * 2.5, DOOR]);
        // no windows where the lobby's lockers stand, at the cell's end (see below)
        const posts = [[], [], [zi - z], [zi - z]];
        posts[sc > 0 ? 3 : 2].push(fz * (fz > 0 ? 0.4 : 4.95));
        const glass = glaze('police', w, d, gaps, [front, 2, 3], posts);
        const doors = shell(walls, x, z, w, d, gaps, WALL_T, glass);
        if (facing(doors)) {
          lots.pop();
          continue;
        }
        const inner = w / 2 - WALL_T / 2;
        const xa = x - sc * inner;
        const xb = x + sc * inner;
        wallLine(walls, true, (xa + xd) / 2, zi, Math.abs(xd - xa), [[x - sc * 3 - (xa + xd) / 2, DOOR]]);
        wallLine(walls, false, xd, z - fz * 4.25, 5.5 - WALL_T, []);
        const bars: Box[] = [];
        wallLine(bars, true, (xd + xb) / 2, zi, Math.abs(xb - xd), [[x + sc * 7 - (xd + xb) / 2, CELL_DOOR]], BARS_T);
        const b = build('police', x, z, w, d, walls, doors, Math.floor(rng() * 4), 3.4, glass);
        const bi = map.buildings.length - 1;
        ownName.set(bi, nameFrom(POLICE_NAMES));
        b.bars = bars;
        b.inner.push({ x: x - sc * 3, z: zi, ox: 0, oz: fz, w: DOOR }, { x: x + sc * 7, z: zi, ox: 0, oz: fz, w: CELL_DOOR, kind: 'bars' });
        b.rooms = [
          { x, z: z + fz * 2.75, hw: inner, hd: 4 },
          { x: x + sc * 7, z: z - fz * 4.25, hw: 2.75, hd: 2.5 },
          { x: x - sc * 3, z: z - fz * 4.25, hw: 6.75, hd: 2.5 },
        ];
        // the stash: its chest against its north wall (the back wall or the lobby's, so it shows from the south), and an
        // ammo crate
        const chestZ = fz > 0 ? d / 2 - WALL_T / 2 - CHEST_HD - 0.08 : 1.5 + WALL_T / 2 + CHEST_HD + 0.08;
        addContainer('chest', x - sc * 7, z - fz * chestZ, 1, 'police');
        addContainer('crate', x + sc * 0.5, z - fz * 4.4, 1, 'crate');
        // the cell: a toilet, and whatever the last one in left behind
        addContainer('toilet', x + sc * 9.2, z - fz * 6.2, fz as 1 | -1, 'crate');
        addSpot(x + sc * 6.4, z - fz * 3.6, 'crate');
        // the lobby
        addSpot(x - sc * 1.5, z + fz * 4.6);
        addSpot(x + sc * 7.5, z + fz * 4.8);
        fit(bi, 'bench', x + sc * 6.6, z - fz * (d / 2 - WALL_T / 2 - 0.3), 0.85, 0.3, back, b.look);
        fit(bi, 'desk', x + sc * 3.5, z + fz * 2.4, 1.4, 0.45, 0, b.look);
        fit(bi, 'chair', x + sc * 3.5, z + fz * 1.45, 0.22, 0.22, front, b.look);
        // a row of lockers in the stash against the wall to the cell, and one in the lobby against its end by the cell,
        // each in the room's north corner (a wall to the north hides nothing behind it from the camera, in the south)
        const { along: la, deep: ld } = STASH.locker;
        const toward = sc > 0 ? 3 : 2;
        const stashRow = fz > 0 ? d / 2 - WALL_T / 2 - la * 3 : 1.5 + WALL_T / 2 + la * 3;
        const lobbyRow = fz > 0 ? 1.5 - BARS_T / 2 - 0.02 - la * 3 : -(d / 2 - WALL_T / 2 - la * 3);
        fit(bi, 'locker', xd - sc * (WALL_T / 2 + ld), z - fz * stashRow, ld, la * 3, toward, 0, 3);
        fit(bi, 'locker', xb - sc * ld, z - fz * lobbyRow, ld, la * 3, toward, 0, 3);
        break;
      }
      if (kind === 'bank') {
        // a bank: a lobby with the tellers' counter and somewhere to wait, and across the back the vault behind its
        // heavy door, with two safes and the deposit boxes. In by the front door, or a side door into the lobby.
        const w = 18;
        const d = 14;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, 10) || !apart(x, z)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const fz = rng() < 0.5 ? 1 : -1;
        const front = fz > 0 ? 1 : 0;
        const back = 1 - front;
        const end = rng() < 0.5 ? 2 : 3;
        // the vault's wall
        const zv = z - fz;
        const walls: Box[] = [];
        const gaps = sides();
        gaps[front].push([Math.round((rng() * 2 - 1) * 4) / 2, DOOR]);
        gaps[end].push([fz * 3, DOOR]);
        const glass = glaze('bank', w, d, gaps, [front, 2, 3], [[], [], [zv - z], [zv - z]]);
        const doors = shell(walls, x, z, w, d, gaps, WALL_T, glass);
        if (facing(doors)) {
          lots.pop();
          continue;
        }
        const vu = Math.round((rng() * 2 - 1) * 4) / 2;
        wallLine(walls, true, x, zv, w - WALL_T, [[vu, DOOR]]);
        const b = build('bank', x, z, w, d, walls, doors, Math.floor(rng() * 4), 3.8, glass);
        const bi = map.buildings.length - 1;
        ownName.set(bi, nameFrom(BANK_NAMES));
        b.inner.push({ x: x + vu, z: zv, ox: 0, oz: fz, w: DOOR, kind: 'vault' });
        const inner = w / 2 - WALL_T / 2;
        b.rooms = [
          { x, z: z + fz * 3, hw: inner, hd: 3.75 },
          { x, z: z - fz * 4, hw: inner, hd: 2.75 },
        ];
        addSpot(x - 5, z + fz * 4.4);
        addSpot(x + 5, z + fz * 4.4);
        // the vault: a safe at each end of the back wall, deposit boxes between them and on its end walls
        for (const u of [-6, 6]) against(bi, 'safe', back, u, STASH.safe.deep * 2, STASH.safe.along * 2, b.look);
        for (const u of [-2.6, 2.6]) against(bi, 'deposit', back, u, STASH.deposit.deep * 2, STASH.deposit.along * 2, b.look);
        for (const k of [-1, 1]) fit(bi, 'deposit', x + k * (inner - STASH.deposit.deep), z - fz * 4, STASH.deposit.deep, STASH.deposit.along, k < 0 ? 2 : 3, b.look);
        // the tellers' counter against the far end wall, and a table to wait at
        alongAny(bi, 'counter', 5 - end, 0.6, [4, 3, 2.4], b.look);
        dining(bi, x + (end === 2 ? 1 : -1) * 2.5, z + fz * 3.4, true, b.look);
        break;
      }
      if (kind === 'mill') {
        // a windmill: a tall square tower with one way in, sacks of flour in the corners, the millstone in the
        // middle and a chest of the good stuff against the wall across from the door
        const w = 9;
        const { x, z } = roomFor(w / 2, w / 2);
        if (!clear(x, z, w / 2, w / 2, 10) || !apart(x, z)) continue;
        lots.push({ x, z, hw: w / 2, hd: w / 2 });
        const walls: Box[] = [];
        const gaps = sides();
        const door = Math.floor(rng() * 4);
        gaps[door].push([0, DOOR]);
        const b = build('mill', x, z, w, w, walls, shell(walls, x, z, w, w, gaps), Math.floor(rng() * 4), 6);
        const bi = map.buildings.length - 1;
        ownName.set(bi, nameFrom(MILL_NAMES));
        // the chest faces along z, so it goes against the north or south wall, whichever has no door
        const cz = door === 0 ? 1 : -1;
        addContainer('chest', x, z + cz * (w / 2 - 1.1), (-cz) as 1 | -1, 'supply');
        addSpot(x - cz * 2.6, z - cz * 1.2, 'crate');
        addSpot(x + cz * 2.6, z - cz * 1.2, 'crate');
        fit(bi, 'millstone', x, z, 0.8, 0.8, 0, b.look);
        for (const [sx, sz] of CORNERS) fit(bi, 'sacks', x + sx * (w / 2 - WALL_T / 2 - 0.5), z + sz * (w / 2 - WALL_T / 2 - 0.5), 0.5, 0.5, 0, b.look);
        break;
      }
      if (kind === 'house' || kind === 'shed' || kind === 'ruin' || kind === 'coop') {
        const w = kind === 'house' ? 12 + 2 * Math.floor(rng() * 3) : kind === 'shed' ? 6 + Math.floor(rng() * 2) : kind === 'ruin' ? 10 + 2 * Math.floor(rng() * 3) : 16;
        const d = kind === 'house' ? 10 + 2 * Math.floor(rng() * 2) : kind === 'shed' ? 6 : kind === 'ruin' ? 8 + 2 * Math.floor(rng() * 2) : 12;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, kind === 'shed' ? 7 : 10)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const walls: Box[] = [];
        const gaps = sides();
        if (kind === 'house') {
          // two of the four sides get a door
          const first = Math.floor(rng() * 4);
          const second = (first + 1 + Math.floor(rng() * 3)) % 4;
          for (const s of [first, second]) gaps[s].push([doorAt(rng, s < 2 ? w : d, DOOR), DOOR]);
          const glass = glaze('house', w, d, gaps, [0, 1, 2, 3]);
          const doors = shell(walls, x, z, w, d, gaps, WALL_T, glass);
          if (facing(doors)) {
            lots.pop();
            continue;
          }
          build('house', x, z, w, d, walls, doors, Math.floor(rng() * 4), WALL_H, glass);
          furnish({ x, z, w, d }, true, true);
          decorate(map.buildings.length - 1);
        } else if (kind === 'shed') {
          const s = Math.floor(rng() * 4);
          gaps[s].push([Math.round((rng() * 2 - 1) * 2) / 2, DOOR]);
          // a little window in the wall across from the door
          const glass = glaze('shed', w, d, gaps, [s ^ 1]);
          const doors = shell(walls, x, z, w, d, gaps, WALL_T, glass);
          if (facing(doors)) {
            lots.pop();
            continue;
          }
          build('shed', x, z, w, d, walls, doors, Math.floor(rng() * 4), 2.8, glass);
          if (rng() < 0.5) addContainer('crate', x, z, 1, 'crate');
          else addSpot(x, z);
          decorate(map.buildings.length - 1);
        } else if (kind === 'ruin') {
          // broken walls: a gap or two in every side, and no roof
          for (let s = 0; s < 4; s++) {
            const span = s < 2 ? w : d;
            const n = 1 + Math.floor(rng() * 2);
            for (let k = 0; k < n; k++) {
              const width = r1(1.6 + rng() * 2);
              gaps[s].push([r1((rng() * 2 - 1) * (span / 2 - width / 2 - 0.5)), width]);
            }
          }
          build('ruin', x, z, w, d, walls, shell(walls, x, z, w, d, gaps), Math.floor(rng() * 4), 2.2);
          addSpot(x, z);
          if (rng() < 0.4) {
            const q = quads({ x, z, w, d })[Math.floor(rng() * 4)];
            addContainer('crate', q.x, q.z, 1, 'crate');
          }
        } else {
          // the Golden Coop: one way in (from the south, so nothing hides the chest behind a wall), a golden chest at
          // the back and good things either side
          gaps[1].push([Math.round((rng() * 2 - 1) * 2 * 2) / 2, DOOR]);
          build('coop', x, z, w, d, walls, shell(walls, x, z, w, d, gaps), 0, 3.6);
          map.coop = map.buildings.length - 1;
          addContainer('chest', x, z - (d / 2 - 1.7), 1, 'gold');
          addSpot(x - w / 4, z + 1.5, 'crate');
          addSpot(x + w / 4, z + 1.5, 'crate');
        }
        break;
      }
      if (kind === 'warehouse') {
        const rot = rng() < 0.5;
        const w = rot ? 18 : 28;
        const d = rot ? 28 : 18;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, 10)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const walls: Box[] = [];
        const gaps = sides();
        // wide loading doors at both ends, and a door on one long side
        const wide = 6;
        const [e0, e1] = rot ? [0, 1] : [2, 3];
        const endSpan = rot ? w : d;
        for (const s of [e0, e1]) gaps[s].push([Math.round((rng() * 2 - 1) * (endSpan / 2 - wide / 2 - 1.5) * 2) / 2, wide]);
        const long = rot ? (rng() < 0.5 ? 2 : 3) : rng() < 0.5 ? 0 : 1;
        gaps[long].push([doorAt(rng, rot ? d : w, DOOR), DOOR]);
        // a row of windows high along each long side
        const glass = glaze('warehouse', w, d, gaps, rot ? [2, 3] : [0, 1]);
        const doors = shell(walls, x, z, w, d, gaps, WALL_T, glass);
        if (facing(doors)) {
          lots.pop();
          continue;
        }
        build('warehouse', x, z, w, d, walls, doors, Math.floor(rng() * 4), 4.4, glass);
        // rows of crates with a lane down the middle, loot between, and a chest in one corner
        for (const a of [-7.5, 0, 7.5])
          for (const b of [-4.6, 4.6]) {
            const cx = rot ? x + b : x + a;
            const cz = rot ? z + a : z + b;
            if (rng() < 0.7) addContainer('crate', cx, cz, 1, 'crate');
            else addSpot(cx, cz);
          }
        addSpot(x, z, 'crate');
        // the chest in a north corner, where the tall south wall can't hide it, and not in front of a door in that wall
        let qx = rng() < 0.5 ? -1 : 1;
        if (doors.some((dr) => dr.oz < 0 && Math.abs(dr.x - (x + qx * (w / 2 - 2.2))) < dr.w / 2 + 1.6)) qx = -qx;
        addContainer('chest', x + qx * (w / 2 - 2.2), z - (d / 2 - 1.8), 1, 'chest');
        decorate(map.buildings.length - 1);
        barrelsAround(x, z, w / 2, d / 2, 2 + Math.floor(rng() * 2));
        break;
      }
      if (kind === 'farm') {
        // a farmhouse of two rooms with a cornfield beside it, the lot fenced round with a gate in every side
        const w = 22;
        const d = 16;
        const { x, z } = roomFor(w / 2 + 17 + YARD, d / 2 + YARD);
        const fs = rng() < 0.5 ? -1 : 1;
        const fx = x + fs * (w / 2 + 3 + 7);
        if (!clear(x, z, w / 2, d / 2, 10) || !clear(fx, z, 7, d / 2, 6)) continue;
        const yx = (x - fs * (w / 2) + fx + fs * 7) / 2;
        const yhw = (w + 3 + 14) / 2 + YARD;
        const yhd = d / 2 + YARD;
        const flip = rng() < 0.5 ? 1 : -1;
        const px = x + flip * (-w / 2 + 9);
        const smallC = x + flip * (-w / 2 + 4.5);
        const bigC = x + flip * 4.5;
        const bigW = 13;
        const walls: Box[] = [];
        const gaps = sides();
        gaps[flip > 0 ? 2 : 3].push([doorAt(rng, d, DOOR), DOOR]);
        gaps[flip > 0 ? 3 : 2].push([doorAt(rng, d, DOOR), DOOR]);
        const lo = bigC - x - bigW / 2 + DOOR / 2 + 1;
        const hi = bigC - x + bigW / 2 - DOOR / 2 - 1;
        gaps[rng() < 0.5 ? 0 : 1].push([Math.round((lo + rng() * (hi - lo)) * 2) / 2, DOOR]);
        // windows all round, clear of where the wall between the rooms meets the north and south walls
        const glass = glaze('farm', w, d, gaps, [0, 1, 2, 3], [[px - x], [px - x]]);
        const doors = shell(walls, x, z, w, d, gaps, WALL_T, glass);
        if (facing(doors)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 }, { x: fx, z, hw: 7, hd: d / 2 }, { x: yx, z, hw: yhw, hd: yhd });
        map.fields.push({ x: fx, z, hw: 7, hd: d / 2 });
        const fences: Box[] = [];
        const gates = shell(fences, yx, z, yhw * 2, yhd * 2, [[[0, GATE]], [[0, GATE]], [[0, GATE]], [[0, GATE]]], FENCE_T);
        map.yards.push({ x: yx, z, hw: yhw, hd: yhd, fences, gates });
        // hay bales along the far side of the field
        for (const hz of [-d / 2 + 1.5, 0, d / 2 - 1.5]) addContainer('hay', fx + fs * 5.4, z + hz, 1, 'hay');
        const iu = doorAt(rng, d, DOOR);
        wallLine(walls, false, px, z, d - WALL_T, [[iu, DOOR]]);
        build('farm', x, z, w, d, walls, doors, Math.floor(rng() * 4), 3.4, glass).inner.push({ x: px, z: z + iu, ox: 1, oz: 0, w: DOOR });
        // the small room is the kitchen: a fridge at one end and a toilet at the other
        const kz = rng() < 0.5 ? -1 : 1;
        addContainer('fridge', smallC, z + (kz * d) / 4, kz > 0 ? -1 : 1, 'fridge');
        addContainer('toilet', smallC, z - (kz * d) / 4, 1, 'crate');
        // and a bale out either side of the kitchen, unless it would stand in the way in through a gate or a door
        for (const side of [-1, 1]) if (offDoors(smallC, z + side * (d / 2 + 2), HAY_HW + 0.8)) addContainer('hay', smallC, z + side * (d / 2 + 2), 1, 'hay');
        furnish({ x: bigC, z, w: bigW, d }, true);
        decorate(map.buildings.length - 1, { x: bigC, w: bigW });
        addSpot(r1(fx + (rng() * 2 - 1) * 4), r1(z + (rng() * 2 - 1) * 5));
        break;
      }
      // a yard of shipping containers in two rows, each open at one end
      const along = rng() < 0.5;
      const hw = along ? 13 : 7;
      const hd = along ? 7 : 13;
      const { x, z } = roomFor(hw, hd);
      if (!clear(x, z, hw, hd, 9)) continue;
      lots.push({ x, z, hw, hd });
      sites.push({ x, z, hw, hd, kind: 'yard' });
      const keep: [number, number][] = [];
      for (const a of [-8.5, 0, 8.5]) for (const b of [-3.6, 3.6]) if (rng() >= 0.2) keep.push([a, b]);
      const spots = keep.length >= 3 ? keep : [-8.5, 0, 8.5].flatMap((a) => [-3.6, 3.6].map((b): [number, number] => [a, b]));
      for (const [a, b] of spots) {
        const cx = along ? x + a : x + b;
        const cz = along ? z + b : z + a;
        const w = along ? 6.4 : 2.8;
        const d = along ? 2.8 : 6.4;
        const walls: Box[] = [];
        const gaps = sides();
        const open = along ? (rng() < 0.5 ? 2 : 3) : rng() < 0.5 ? 0 : 1;
        gaps[open].push([0, 20]);
        build('container', cx, cz, w, d, walls, shell(walls, cx, cz, w, d, gaps), Math.floor(rng() * 5), 2.7);
        if (rng() < 0.55) addSpot(cx, cz);
      }
      barrelsAround(x, z, hw, hd, 2 + Math.floor(rng() * 2));
      break;
    }
  }

  map.buildings.forEach((b, i) => {
    if (b.kind === 'container') return;
    // a farm's site is its whole fenced yard
    const yard = map.yards.find((y) => Math.abs(b.x - y.x) < y.hw && Math.abs(b.z - y.z) < y.hd);
    sites.push(yard ? { x: yard.x, z: yard.z, hw: yard.hw, hd: yard.hd, kind: 'building', b: i } : { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, kind: 'building', b: i });
  });
  // camps: a fire out in the open with a picnic table, a crate and something on the ground round it
  for (let k = 0, tries = 0; k < COUNTS.camps && tries < 200; tries++) {
    const x = Math.round((rng() * 2 - 1) * (HALF - BEACH - 12));
    const z = Math.round((rng() * 2 - 1) * (HALF - BEACH - 12));
    if (nearLot(x, z, 9) || !free(x, z, 7)) continue;
    taken.push({ x, z, r: 7 });
    lots.push({ x, z, hw: 4.5, hd: 4.5 });
    sites.push({ x, z, hw: 5, hd: 5, kind: 'camp' });
    map.fires.push({ x, z, r: CAMP.pit });
    const q = Math.floor(rng() * 4);
    map.tables.push({ x: x + CORNERS[q][0] * 3.6, z: z + CORNERS[q][1] * 2.6, alongX: true });
    addContainer('crate', x + CORNERS[(q + 2) % 4][0] * 3.4, z + CORNERS[(q + 2) % 4][1] * 3.2, 1, 'crate');
    addSpot(x + CORNERS[(q + 1) % 4][0] * 3, z + CORNERS[(q + 1) % 4][1] * 3);
    k++;
  }

  // ponds, kept clear of buildings and of each other
  for (let k = 0, tries = 0; k < COUNTS.ponds && tries < 200; tries++) {
    const r = 7 + Math.floor(rng() * 6);
    const x = r1((rng() * 2 - 1) * (HALF - BEACH - r - 6));
    const z = r1((rng() * 2 - 1) * (HALF - BEACH - r - 6));
    if (nearLot(x, z, r + 4) || !free(x, z, r + 6)) continue;
    map.ponds.push({ x, z, r });
    taken.push({ x, z, r: r + 1 });
    k++;
  }

  // dirt roads: each site links to its nearest neighbor or two, from the edge of one lot to the edge of the other (a
  // farm's from its gate), when the way between runs clear of everything else and of the ponds
  const own = (s: { x: number; z: number; hw: number; hd: number }, l: Box) => Math.abs(l.x - s.x) <= s.hw + 0.01 && Math.abs(l.z - s.z) <= s.hd + 0.01;
  const edges: [number, number][] = [];
  const roadEnd = (s: (typeof sites)[number], ox: number, oz: number, ux: number, uz: number, len: number, far: { x: number; z: number }) => {
    const b = s.b !== undefined ? map.buildings[s.b] : undefined;
    const yard = b?.kind === 'farm' ? map.yards.find((y) => Math.abs(b.x - y.x) < y.hw && Math.abs(b.z - y.z) < y.hd) : undefined;
    if (yard) {
      // out through the gate nearest the far end, as long as the road then stays out of the yard
      let best: Door | null = null;
      let near = Infinity;
      for (const g of yard.gates) {
        const d = dist(g.x, g.z, far.x, far.z);
        if (d < near) {
          best = g;
          near = d;
        }
      }
      if (!best) return null;
      const x = best.x + best.ox * 0.8;
      const z = best.z + best.oz * 0.8;
      const dx = far.x - x;
      const dz = far.z - z;
      const l = Math.sqrt(dx * dx + dz * dz);
      return l > 1 && rayBox(x, z, dx / l, dz / l, l, yard.x, yard.z, yard.hw, yard.hd) === Infinity ? { x, z } : null;
    }
    // the far end's ray back to this lot finds where the road meets its edge
    const t = rayBox(ox, oz, -ux, -uz, len, s.x, s.z, s.hw + 0.6, s.hd + 0.6);
    return t === Infinity ? null : { x: ox - ux * t, z: oz - uz * t };
  };
  sites.forEach((a, i) => {
    const near = sites
      .map((b, j) => ({ j, d: dist(a.x, a.z, b.x, b.z) }))
      .filter(({ j, d }) => j !== i && d < 90)
      .sort((p, q) => p.d - q.d || p.j - q.j)
      .slice(0, 2);
    for (const { j } of near) {
      if (edges.some(([p, q]) => (p === i && q === j) || (p === j && q === i))) continue;
      const b = sites[j];
      const len = dist(a.x, a.z, b.x, b.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const p0 = roadEnd(a, b.x, b.z, ux, uz, len, b);
      const p1 = p0 && roadEnd(b, a.x, a.z, -ux, -uz, len, p0);
      if (!p0 || !p1) continue;
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const l = Math.sqrt(dx * dx + dz * dz);
      // 6 m at least, once its ends are rounded
      if (l < 6.2 || (p0.x - a.x) * ux + (p0.z - a.z) * uz > (p1.x - a.x) * ux + (p1.z - a.z) * uz) continue;
      const blocked = lots.some((lot) => !own(a, lot) && !own(b, lot) && rayBox(p0.x, p0.z, dx / l, dz / l, l, lot.x, lot.z, lot.hw + 1.5, lot.hd + 1.5) < Infinity);
      // and never along or through a fence, a farm's own included
      const fenced = map.yards.some((y) => y.fences.some((fc) => rayBox(p0.x, p0.z, dx / l, dz / l, l, fc.x, fc.z, fc.hw + 0.4, fc.hd + 0.4) < Infinity));
      if (blocked || fenced || map.ponds.some((p) => rayCircle(p0.x, p0.z, dx / l, dz / l, l, p.x, p.z, p.r + 1) < Infinity)) continue;
      // nor across the river: that's what the bridges are for
      if (riverSegDist2(map, p0.x, p0.z, p1.x, p1.z) < (RIVER_HALF + ROAD_HALF + 0.5) * (RIVER_HALF + ROAD_HALF + 0.5)) continue;
      edges.push([i, j]);
      map.roads.push({ x0: r1(p0.x), z0: r1(p0.z), x1: r1(p1.x), z1: r1(p1.z) });
    }
  });
  // a road off each end of a bridge to the nearest place it can reach without crossing anything
  map.bridges.forEach((br, bi) => {
    for (const e of [-1, 1]) {
      const ax = br.alongX ? e : 0;
      const az = br.alongX ? 0 : e;
      const ex = br.x + ax * (br.alongX ? br.hw : br.hd);
      const ez = br.z + az * (br.alongX ? br.hw : br.hd);
      const near = sites.map((s, j) => ({ j, d: dist(ex, ez, s.x, s.z) })).filter(({ j, d }) => d < 75 && (sites[j].x - ex) * ax + (sites[j].z - ez) * az > 0).sort((p, q) => p.d - q.d);
      for (const { j, d } of near) {
        const s = sites[j];
        const p1 = roadEnd(s, ex, ez, (ex - s.x) / d, (ez - s.z) / d, d, { x: ex, z: ez });
        if (!p1) continue;
        const dx = p1.x - ex;
        const dz = p1.z - ez;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l < 6.2) continue;
        // from a few steps off the deck on, the road keeps clear of the water
        const sx = ex + (dx / l) * 4;
        const sz = ez + (dz / l) * 4;
        if (riverSegDist2(map, sx, sz, p1.x, p1.z) < (RIVER_HALF + ROAD_HALF + 0.3) * (RIVER_HALF + ROAD_HALF + 0.3)) continue;
        if (lots.some((lot) => lot !== bridgeLots[bi] && !own(s, lot) && rayBox(ex, ez, dx / l, dz / l, l, lot.x, lot.z, lot.hw + 1.5, lot.hd + 1.5) < Infinity)) continue;
        if (map.yards.some((y) => y.fences.some((fc) => rayBox(ex, ez, dx / l, dz / l, l, fc.x, fc.z, fc.hw + 0.4, fc.hd + 0.4) < Infinity))) continue;
        if (map.ponds.some((p) => rayCircle(ex, ez, dx / l, dz / l, l, p.x, p.z, p.r + 1) < Infinity)) continue;
        map.roads.push({ x0: r1(ex), z0: r1(ez), x1: r1(p1.x), z1: r1(p1.z) });
        break;
      }
    }
  });
  const nearRoad = (x: number, z: number, margin: number) => map.roads.some((r) => segDist2(x, z, r.x0, r.z0, r.x1, r.z1) < (ROAD_HALF + margin) * (ROAD_HALF + margin));

  // lamp posts along the roads, every fourteen meters, swapping sides
  map.roads.forEach((r, i) => {
    const len = dist(r.x0, r.z0, r.x1, r.z1);
    const ux = (r.x1 - r.x0) / len;
    const uz = (r.z1 - r.z0) / len;
    for (let s = 7, k = i; s < len - 4; s += 14, k++) {
      const side = k % 2 ? 1 : -1;
      const x = r1(r.x0 + ux * s - uz * side * (ROAD_HALF + 1));
      const z = r1(r.z0 + uz * s + ux * side * (ROAD_HALF + 1));
      if (!onLand(x, z, 2) || nearLot(x, z, 0.8) || nearRoad(x, z, 0.5) || !free(x, z, 0.8) || !offDoors(x, z, 1.5)) continue;
      taken.push({ x, z, r: 0.8 });
      map.lamps.push({ x, z, look: i });
    }
  });

  // what stands round the buildings: a car in a driveway, a picnic table or a campfire in the yard (on sides with no
  // door), a mailbox by each front door, and trucks at the warehouses and the container yards
  const park = (x: number, z: number, alongX: boolean, truck: boolean) => {
    const size = truck ? TRUCK : CAR;
    const hw = alongX ? size.along / 2 : size.across / 2;
    const hd = alongX ? size.across / 2 : size.along / 2;
    const r = Math.max(hw, hd);
    if (!onLand(x, z, 3) || !clear(x, z, hw, hd, 1.3) || !free(x, z, r + 1.2) || !offDoors(x, z, r + 1.4) || nearRoad(x, z, r)) return false;
    taken.push({ x, z, r: r + 0.8 });
    map.cars.push({ x: r1(x), z: r1(z), hw, hd, look: Math.floor(rng() * 6), truck, alongX });
    return true;
  };
  const sidesFrom = (first: number) => [0, 1, 2, 3].map((k) => (first + k) % 4);
  map.buildings.forEach((b) => {
    if (b.kind === 'house') {
      const span = (side: number) => (side < 2 ? b.w : b.d) / 2 - 3;
      const open = sidesFrom(Math.floor(rng() * 4)).filter((s) => !doorOn(b, s));
      const wantCar = rng() < 0.6;
      const wantTable = rng() < 0.5;
      const wantFire = rng() < 0.45;
      for (const side of open) {
        if (wantCar && !map.cars.some((c) => dist(c.x, c.z, b.x, b.z) < 14)) {
          const p = beside(b, side, 4.2, Math.round((rng() * 2 - 1) * span(side)));
          if (park(p.x, p.z, side >= 2, false)) continue;
        }
        if (wantTable && !map.tables.some((t) => dist(t.x, t.z, b.x, b.z) < 14)) {
          const p = beside(b, side, 4.5, Math.round((rng() * 2 - 1) * span(side)));
          if (clear(p.x, p.z, TABLE_HW, TABLE_HD, 1.3) && free(p.x, p.z, 1.9) && offDoors(p.x, p.z, 2.2) && !nearRoad(p.x, p.z, 1.2)) {
            taken.push({ x: p.x, z: p.z, r: 1.9 });
            map.tables.push({ x: p.x, z: p.z, alongX: side < 2 });
            continue;
          }
        }
        if (wantFire && !map.fires.some((f) => dist(f.x, f.z, b.x, b.z) < 16)) {
          const p = beside(b, side, 5, Math.round((rng() * 2 - 1) * span(side)));
          if (clear(p.x, p.z, CAMP.pit, CAMP.pit, 1.3) && free(p.x, p.z, 2.6) && offDoors(p.x, p.z, 2.5) && !nearRoad(p.x, p.z, 1.5)) {
            taken.push({ x: p.x, z: p.z, r: 2.6 });
            map.fires.push({ x: p.x, z: p.z, r: CAMP.pit });
          }
        }
      }
      for (const d of b.doors) {
        const ax = Math.abs(d.oz);
        const az = Math.abs(d.ox);
        const toward = (b.x - d.x) * ax + (b.z - d.z) * az >= 0 ? 1 : -1;
        // to the corner side of the path, or the other side when a road or something else is there
        for (const s of [toward, -toward]) {
          const x = r1(d.x + d.ox * 3.4 - ax * s * (d.w / 2 + 1.4));
          const z = r1(d.z + d.oz * 3.4 - az * s * (d.w / 2 + 1.4));
          if (!onLand(x, z, 2) || !free(x, z, 0.5) || !offDoors(x, z, 1) || nearRoad(x, z, 0.3)) continue;
          taken.push({ x, z, r: 0.5 });
          map.mailboxes.push({ x, z, look: b.look });
          break;
        }
      }
    } else if (b.kind === 'warehouse') {
      // a truck beside one loading door, backed up toward it
      const wide = b.doors.filter((d) => d.w > 5);
      const d = wide[Math.floor(rng() * wide.length)];
      if (!d) return;
      const ax = Math.abs(d.oz);
      const az = Math.abs(d.ox);
      const side = rng() < 0.5 ? -1 : 1;
      park(r1(d.x + d.ox * 4.6 + ax * side * (d.w / 2 + 2.6)), r1(d.z + d.oz * 4.6 + az * side * (d.w / 2 + 2.6)), d.ox !== 0, true);
    }
  });
  for (const s of sites) {
    if (s.kind !== 'yard') continue;
    for (const side of sidesFrom(Math.floor(rng() * 4))) {
      const p = beside({ x: s.x, z: s.z, w: s.hw * 2, d: s.hd * 2 }, side, 4.4, Math.round((rng() * 2 - 1) * 3));
      if (park(p.x, p.z, side >= 2, true)) break;
    }
  }

  // bounce pads: out in the open, pointing more or less at the middle of the island
  for (let k = 0, tries = 0; k < COUNTS.pads && tries < 300; tries++) {
    const x = r1((rng() * 2 - 1) * (HALF - BEACH - 16));
    const z = r1((rng() * 2 - 1) * (HALF - BEACH - 16));
    if (nearLot(x, z, 6) || !free(x, z, 4) || nearRoad(x, z, 2) || map.pads.some((p) => dist(p.x, p.z, x, z) < 50)) continue;
    let best = 0;
    let score = -Infinity;
    DIRS.forEach(([dx, dz], i) => {
      const s = -(x * dx + z * dz);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    const dir = DIRS[(best + 7 + Math.floor(rng() * 3)) % 8];
    taken.push({ x, z, r: 4 });
    map.pads.push({ x, z, dx: dir[0], dz: dir[1] });
    k++;
  }

  const scatter = (count: number, r: number, margin: number, put: (x: number, z: number) => void, around?: { x: number; z: number; spread: number }, roadGap = 0.3) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = r1(around ? around.x + (rng() + rng() - 1) * around.spread : (rng() * 2 - 1) * (HALF - BEACH - 2));
      const z = r1(around ? around.z + (rng() + rng() - 1) * around.spread : (rng() * 2 - 1) * (HALF - BEACH - 2));
      if (Math.abs(x) > HALF - BEACH - 2 || Math.abs(z) > HALF - BEACH - 2) continue;
      if (nearLot(x, z, margin) || !free(x, z, r) || nearRoad(x, z, roadGap)) continue;
      taken.push({ x, z, r });
      put(x, z);
      placed++;
    }
  };

  const tree = (kind: TreeKind) => (x: number, z: number) => map.trees.push({ x, z, r: TREE_R, kind });
  // fallen logs lie along x or z, and keep their whole length off the roads and away from doorways
  const log = (x: number, z: number) => {
    const alongX = rng() < 0.5;
    const len = r1(1.4 + rng() * 0.8);
    map.logs.push({ x, z, hw: alongX ? len : LOG_R, hd: alongX ? LOG_R : len, alongX });
  };
  const stump = (x: number, z: number) => map.stumps.push({ x, z, r: STUMP_R });
  // woods of mostly one kind of tree, with a stump or two and a fallen log
  const KINDS: TreeKind[] = ['oak', 'pine', 'birch'];
  for (let k = 0; k < COUNTS.forests; k++) {
    const cx = r1((rng() * 2 - 1) * (HALF - BEACH - 20));
    const cz = r1((rng() * 2 - 1) * (HALF - BEACH - 20));
    const kind = KINDS[Math.floor(rng() * KINDS.length)];
    const wood = { x: cx, z: cz, spread: 16 };
    scatter(COUNTS.forestTrees, 2.3, 3, (x, z) => tree(rng() < 0.8 ? kind : 'oak')(x, z), wood);
    scatter(2, 1.2, 3, stump, wood);
    scatter(1, 2.6, 5, log, wood, 2.4);
  }
  // an orchard of fruit trees in two rows beside each farm, on the first side with room for most of them
  for (const y of map.yards) {
    for (const side of sidesFrom(Math.floor(rng() * 4))) {
      const l = (rng() < 0.5 ? -1 : 1) * ((side < 2 ? y.hw : y.hd) - 7);
      const spots = [5, 10].flatMap((o) => [-5, 0, 5].map((a) => beside({ x: y.x, z: y.z, w: y.hw * 2, d: y.hd * 2 }, side, o, l + a)));
      const ok = spots.filter((p) => onLand(p.x, p.z, 3) && !nearLot(p.x, p.z, 3) && free(p.x, p.z, 2.3) && !nearRoad(p.x, p.z, 0.3));
      if (ok.length < 4) continue;
      for (const p of ok) {
        taken.push({ x: p.x, z: p.z, r: 2.3 });
        tree('fruit')(p.x, p.z);
      }
      break;
    }
  }
  scatter(COUNTS.trees, 2.6, 3, (x, z) => {
    const k = rng();
    tree(k < 0.55 ? 'oak' : k < 0.85 ? 'pine' : 'birch')(x, z);
  });
  scatter(COUNTS.logs, 2.6, 5, log, undefined, 2.4);
  scatter(COUNTS.stumps, 1.2, 3, stump);
  // a boulder keeps its whole width (up to 2.2 m) clear of every doorway, not just its middle
  scatter(COUNTS.rocks, 2.6, 5.5, (x, z) => map.rocks.push({ x, z, r: r1(1 + rng() * 1.2), look: Math.floor(rng() * 1000) }));
  scatter(COUNTS.bushes, 2, 2, (x, z) => map.bushes.push({ x, z, r: BUSH_R }));
  scatter(COUNTS.crates, 2, 3, (x, z) => addContainer('crate', x, z, 1, 'crate'));
  scatter(COUNTS.chests, 2.2, 3, (x, z) => addContainer('chest', x, z, rng() < 0.5 ? 1 : -1, 'chest'));
  scatter(COUNTS.barrels, 1.4, 3, (x, z) => addContainer('barrel', x, z, 1, null));
  scatter(COUNTS.spots, 1.6, 2, (x, z) => addSpot(x, z));

  // supply drops: each lands inside the circle the storm is about to close to, a little before it moves
  const storm = map.storm;
  for (let k = 0; k < DROP_LEAD.length; k++)
    for (let n = 0; n < DROP_COUNT[k]; n++) {
      const c = storm.circles[k + 1];
      const at = storm.starts[k] - DROP_LEAD[k];
      let x = r1(Math.max(-(HALF - BEACH - 4), Math.min(HALF - BEACH - 4, c.x)));
      let z = r1(Math.max(-(HALF - BEACH - 4), Math.min(HALF - BEACH - 4, c.z)));
      for (let tries = 0; tries < 80; tries++) {
        const spread = c.r * (0.3 + (tries / 80) * 0.4);
        const tx = r1(c.x + (rng() * 2 - 1) * spread);
        const tz = r1(c.z + (rng() * 2 - 1) * spread);
        if (Math.abs(tx) > HALF - BEACH - 4 || Math.abs(tz) > HALF - BEACH - 4 || nearLot(tx, tz, 2) || !free(tx, tz, 2.4) || !offDoors(tx, tz, 2.5)) continue;
        x = tx;
        z = tz;
        break;
      }
      taken.push({ x, z, r: 2.4 });
      map.drops.push(addContainer('supply', x, z, 1, 'supply', at));
    }
  // and the ones a flare gun calls, packed and waiting: they get a place and a time when one is fired
  for (let k = 0; k < FLARE_DROPS; k++) map.flares.push(addContainer('supply', 0, 0, 1, 'supply', Infinity));

  // named places: each special site (the Golden Coop, a diner, a windmill, the police station, the bank, a farm, a
  // warehouse, a container yard, a camp), then each house or shed, gathers the sites not yet in a place within TOWN
  // meters of it; a lone house or shed gets no name. A place with a diner, a windmill, the police station or the bank
  // in it goes by that one's name.
  const plain = (s: (typeof sites)[number]) => s.kind === 'building' && s.b !== map.coop && !['warehouse', 'farm', ...NAMED].includes(map.buildings[s.b!].kind);
  const order = sites.map((_, i) => i).sort((a, b) => Number(plain(sites[a])) - Number(plain(sites[b])) || a - b);
  const claimed = sites.map(() => false);
  const towns: number[][] = [];
  for (const i of order) {
    if (claimed[i]) continue;
    const g = order.filter((j) => !claimed[j] && dist(sites[i].x, sites[i].z, sites[j].x, sites[j].z) < TOWN);
    if (g.length < 2 && plain(sites[i])) continue;
    for (const j of g) claimed[j] = true;
    towns.push(g);
  }
  const names = [...PLACE_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  let named = 0;
  for (const g of towns) {
    const cx = r1(g.reduce((s, i) => s + sites[i].x, 0) / g.length);
    const cz = r1(g.reduce((s, i) => s + sites[i].z, 0) / g.length);
    const r = g.reduce((s, i) => Math.max(s, dist(sites[i].x, sites[i].z, cx, cz) + Math.max(sites[i].hw, sites[i].hd)), 0) + 6;
    const site = g.find((i) => ownName.has(sites[i].b ?? -1));
    map.places.push({ name: site !== undefined ? ownName.get(sites[site].b!)! : names[named++ % names.length], x: cx, z: cz, r: r1(Math.max(18, r)) });
  }

  // a door in every doorway but a warehouse's loading doors (and none in the shipping containers or the ruins)
  map.buildings.forEach((b, bi) => {
    if (!b.roof || b.kind === 'container') return;
    for (const d of [...b.doors, ...b.inner]) {
      if (d.w > DOOR + 0.01) continue;
      d.slab = map.slabs.length;
      map.slabs.push({ x: d.x, z: d.z, hw: d.ox ? WALL_T / 2 : d.w / 2, hd: d.ox ? d.w / 2 : WALL_T / 2, i: map.slabs.length, b: bi, ox: d.ox, oz: d.oz, bars: d.kind === 'bars', vault: d.kind === 'vault' });
    }
  });
  // -----------------------------------------------------------------------------------------------------------------
  // The underground: a cellar under some of the houses, an armory under the police station and a strongroom under the
  // bank, and a couple of bunkers under hatches out in the open, each down a stairway (see Stair) and better stocked
  // than anything up top. It rolls from a generator of its own, so the island above is the same with it or without it.
  rng = rng32((seed ^ 0x5ca1ab1e) >>> 0);
  const shuffled = <T>(list: T[]) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  /**
   * A stairway's box (rails and all) at (x, z) running along x (`alongX`) or z, down the way `dir` (1 or -1 along that
   * axis), with a wall on side `wall` of it across (-1 the low side, 1 the high side, 0 none): its rails up top and
   * below, the way onto it up top (`top`) and the way off its foot below (`foot`, underground).
   */
  const stairway = (x: number, z: number, alongX: boolean, dir: number, wall: number) => {
    const { half, run } = STAIR;
    const t = FENCE_T / 2;
    const box: Box = { x, z, hw: alongX ? run : half, hd: alongX ? half : run };
    const side = (k: number, ox: number): Box => (alongX ? { x: x + ox, z: z + k * (half - t), hw: run, hd: t } : { x: x + ox + k * (half - t), z, hw: t, hd: run });
    const end = (k: number, ox: number): Box => (alongX ? { x: x + ox + k * (run - t), z, hw: t, hd: half } : { x: x + ox, z: z + k * (run - t), hw: half, hd: t });
    const open = [-1, 1].filter((k) => k !== wall);
    const ahead = (k: number, ox: number): Box => (alongX ? { x: x + ox + k * (run + 0.9), z, hw: 0.9, hd: half } : { x: x + ox, z: z + k * (run + 0.9), hw: half, hd: 0.9 });
    return {
      box,
      dx: alongX ? dir : 0,
      dz: alongX ? 0 : dir,
      rails: [...open.map((k) => side(k, 0)), end(dir, 0)],
      deepRails: [...open.map((k) => side(k, DEEP)), end(-dir, DEEP)],
      top: ahead(-dir, 0),
      foot: ahead(dir, DEEP),
    };
  };
  type Way = ReturnType<typeof stairway>;
  /** The furniture of building `bi` a stairway would be in the way of (which goes, to make room for it). */
  const inTheWay = (bi: number, st: Way) =>
    map.furniture.filter((f) => f.b === bi && (gap(st.box, f) < 0.05 || (furnitureSolid(f.kind) && (!roomy(gap(st.box, f)) || gap(st.top, f) < 1.6))));
  /**
   * What may make way for the stairs: a bed, a shelf, a chair, a stool or a bench, and in the police station and the
   * bank the table to wait at and its rug (but never a house's table, its rug or the kitchen counter).
   */
  const spared = (f: Furniture) => {
    const kind = map.buildings[f.b]?.kind;
    return f.kind === 'bed' || f.kind === 'shelf' || f.kind === 'chair' || f.kind === 'stool' || f.kind === 'bench' || ((kind === 'police' || kind === 'bank') && (f.kind === 'table' || f.kind === 'rug'));
  };
  /**
   * Whether a stairway, its rails and the way onto it fit in building `bi` as it stands, but for furniture (see
   * inTheWay): in one room, out of the doorways' way, flush against its wall or well clear of the rest, clear of
   * everything there is to loot (with room to walk round it onto them), and with room off their foot below.
   */
  const stairFits = (bi: number, st: Way) => {
    const b = map.buildings[bi];
    const { box, top } = st;
    const inside = (q: Box) => Math.abs(q.x - b.x) + q.hw <= b.w / 2 - WALL_T / 2 + 0.01 && Math.abs(q.z - b.z) + q.hd <= b.d / 2 - WALL_T / 2 + 0.01;
    if (!inside(box) || !inside(top) || !inside({ ...st.foot, x: st.foot.x - DEEP })) return false;
    // in the police station and the bank, in the lobby: not behind bars or a vault door
    const rooms = b.kind === 'police' || b.kind === 'bank' ? b.rooms.slice(0, 1) : b.rooms;
    if (b.rooms.length && !rooms.some((r) => [box, top].every((q) => Math.abs(q.x - r.x) + q.hw <= r.hw + 0.01 && Math.abs(q.z - r.z) + q.hd <= r.hd + 0.01))) return false;
    if (!fits(bi, box, true, false, -1, false)) return false;
    for (const w of [...b.walls, ...b.windows, ...b.bars]) if (gap(top, w) < 0) return false;
    for (const c of map.containers) {
      if (Math.abs(c.x - b.x) > b.w / 2 || Math.abs(c.z - b.z) > b.d / 2) continue;
      const [chw, chd] = containerHalf(c);
      const cb = { x: c.x, z: c.z, hw: chw, hd: chd };
      if (gap(top, cb) < 1.6 || !roomy(gap(box, cb))) return false;
      // nothing spills where stepping to pick it up takes you down the stairs
      if (c.loot.some((l) => Math.abs(l.x - box.x) < box.hw + 0.4 && Math.abs(l.z - box.z) < box.hd + 0.4)) return false;
    }
    return true;
  };
  /** A stairway against the inside of one of a building's walls, the first of its places (in a shuffled order) that fits, or null. */
  const stairIn = (bi: number): Way | null => {
    const b = map.buildings[bi];
    const { half, run } = STAIR;
    const tries: Way[] = [];
    for (let side = 0; side < 4; side++) {
      const alongX = side < 2;
      const span = (alongX ? b.w : b.d) / 2 - WALL_T / 2 - run;
      const o = (alongX ? b.d : b.w) / 2 - WALL_T / 2 - half - 0.02;
      for (let u = -Math.floor(span * 2) / 2; u <= span; u += 0.5)
        for (const dir of [-1, 1]) {
          const x = alongX ? b.x + u : b.x + (side === 2 ? -o : o);
          const z = alongX ? b.z + (side === 0 ? -o : o) : b.z + u;
          tries.push(stairway(x, z, alongX, dir, side === 0 || side === 2 ? -1 : 1));
        }
    }
    // the place that moves the least furniture out of the way (two pieces at most), against the south wall only when
    // nothing else will do (that wall hides what's beside it from the camera, which looks north)
    let best: Way | null = null;
    let cost = 3;
    const south = (st: Way) => st.dx !== 0 && st.box.z > b.z;
    for (const st of [...shuffled(tries.filter((t) => !south(t))), ...shuffled(tries.filter(south))]) {
      if (!stairFits(bi, st)) continue;
      const way = inTheWay(bi, st);
      if (!way.every(spared)) continue;
      const n = way.length + (south(st) ? 0.5 : 0);
      if (n < cost) {
        best = st;
        cost = n;
        if (!n) break;
      }
    }
    if (best) {
      const gone = new Set(inTheWay(bi, best));
      map.furniture = map.furniture.filter((f) => !gone.has(f));
    }
    return best;
  };
  /** The footprints of the basements so far (on the island's coordinates), so no two overlap underground. */
  const dug: Box[] = [];
  /**
   * Digs a basement of `kind` under the w by d footprint at (x, z) on the ground, the stairway `st` coming down into
   * it: four walls round it, `cuts` walls across it (one or two, each with a doorway, none across the stairs or the
   * way off their foot) and a room either side of each. Returns its building index, or -1 when the walls won't go.
   */
  const dig = (kind: 'cellar' | 'bunker', x: number, z: number, w: number, d: number, st: Way, cuts: number, above: number) => {
    const bx = x + DEEP;
    const alongX = w >= d;
    const long = (alongX ? w : d) - WALL_T;
    const across = (alongX ? d : w) - WALL_T;
    const keep = [{ ...st.box, x: st.box.x + DEEP }, st.foot];
    const walls: Box[] = [];
    const inner: Door[] = [];
    // where each wall across goes (along the long way, from the middle), first try first
    const plans = (n: number) => (n === 2 ? [[-1 / 6, 1 / 6], [-0.2, 0.15], [-0.15, 0.2], [-0.24, 0.1], [-0.1, 0.24]] : n === 1 ? [[0], [-0.15], [0.15], [-0.28], [0.28]] : [[]]);
    let at: number[] | null = null;
    // fewer walls across when that many won't go, down to one big room
    for (let n = cuts; n >= 0 && !at; n--) {
      for (const plan of shuffled(plans(n))) {
        const ps = plan.map((k) => r1(k * long));
        const bounds = [-long / 2, ...ps, long / 2];
        if (bounds.some((p, i) => i > 0 && p - bounds[i - 1] < 4.6)) continue;
        // clear of the stairs and the way off them, a doorway each with room either side of it
        const wallBox = (p: number): Box => (alongX ? { x: bx + p, z, hw: WALL_T / 2, hd: across / 2 } : { x: bx, z: z + p, hw: across / 2, hd: WALL_T / 2 });
        if (ps.some((p) => keep.some((k) => gap(wallBox(p), k) < 0.5))) continue;
        const doors: number[] = [];
        for (const p of ps) {
          const room = across / 2 - DEEP_DOOR / 2 - 0.8;
          const u = shuffled([0, r1(room), r1(-room)]).find((u) => {
            const zone: Box = alongX ? { x: bx + p, z: z + u, hw: 1.4, hd: DEEP_DOOR / 2 + 0.4 } : { x: bx + u, z: z + p, hw: DEEP_DOOR / 2 + 0.4, hd: 1.4 };
            return keep.every((k) => gap(zone, k) >= 0.2);
          });
          if (u === undefined) break;
          doors.push(u);
        }
        if (doors.length < ps.length) continue;
        at = ps;
        ps.forEach((p, i) => {
          wallLine(walls, !alongX, alongX ? bx + p : bx, alongX ? z : z + p, across, [[doors[i], DEEP_DOOR]]);
          inner.push(alongX ? { x: bx + p, z: z + doors[i], ox: 1, oz: 0, w: DEEP_DOOR } : { x: bx + doors[i], z: z + p, ox: 0, oz: 1, w: DEEP_DOOR });
        });
        break;
      }
    }
    if (!at) return -1;
    shell(walls, bx, z, w, d, sides());
    const bi = map.buildings.length;
    const b = build(kind, bx, z, w, d, walls, [], Math.floor(rng() * 4), DEEP_H);
    b.inner = inner;
    const bounds = [-long / 2, ...at, long / 2];
    b.rooms = bounds.slice(1).map((hi, i) => {
      const lo = bounds[i] + (i > 0 ? WALL_T / 2 : 0);
      const top = hi - (i < bounds.length - 2 ? WALL_T / 2 : 0);
      const mid = (lo + top) / 2;
      return alongX ? { x: bx + mid, z, hw: (top - lo) / 2, hd: across / 2 } : { x: bx, z: z + mid, hw: across / 2, hd: (top - lo) / 2 };
    });
    keepOut.set(bi, keep);
    dug.push({ x, z, hw: w / 2, hd: d / 2 });
    const s = map.stairs.length;
    map.stairs.push({ ...st.box, i: s, b: above, u: bi, dx: st.dx, dz: st.dz, rails: st.rails, deepRails: st.deepRails });
    return bi;
  };
  /** A chest or a fridge against the north or south wall of a basement (facing in), the first of a few places that fits. */
  const boxOn = (bi: number, kind: 'chest' | 'fridge', tier: LootTier, sides: number[], spots: number[]) => {
    const b = map.buildings[bi];
    const [hw, hd] = kind === 'chest' ? [CHEST_HW, CHEST_HD] : [FRIDGE_HW, FRIDGE_HD];
    for (const side of sides) {
      // flush against the wall's inside, on a tenth of a meter (where every container stands)
      const k = side === 0 ? -1 : 1;
      const face = b.z + k * (b.d / 2 - WALL_T / 2);
      const z = [Math.floor((face - k * hd) * 10) / 10, Math.ceil((face - k * hd) * 10) / 10].find((v) => k * (face - v) - hd >= 0 && k * (face - v) - hd <= 0.05);
      if (z === undefined) continue;
      for (const u of spots) {
        const box = { x: r1(b.x + u), z, hw, hd };
        // with room in front for what it holds
        const front = { x: box.x, z: box.z + (side === 0 ? 1 : -1) * (hd + 0.9), hw: hw + 0.5, hd: 0.8 };
        if (!fits(bi, box, true, false, -1) || !fits(bi, front, false, false, -1)) continue;
        addContainer(kind, box.x, box.z, side === 0 ? 1 : -1, tier);
        return true;
      }
    }
    return false;
  };
  /** A crate (or a spot of loot on the floor, `spot`) out in a basement's rooms, clear of everything, if one fits. */
  const looseIn = (bi: number, tier: LootTier, spot = false) => {
    const b = map.buildings[bi];
    const spots = shuffled(b.rooms.flatMap((r) => [-0.5, 0, 0.5].flatMap((a) => [-0.5, 0, 0.5].map((c) => ({ x: r1(r.x + a * r.hw), z: r1(r.z + c * r.hd) })))));
    for (const p of spots) {
      // what spills out lands in reach and indoors
      if (!fits(bi, { x: p.x, z: p.z, hw: 1.3, hd: 1.8 }, false, false, -1)) continue;
      if (!spot && !fits(bi, { x: p.x, z: p.z, hw: CRATE_HALF, hd: CRATE_HALF }, true, false, -1)) continue;
      if (spot && map.furniture.some((f) => f.b === bi && furnitureSolid(f.kind) && gap({ x: p.x, z: p.z, hw: 1.2, hd: 1.7 }, f) < 0.2)) continue;
      if (spot && map.floor.some((l) => Math.abs(l.x - p.x) < 2.4 && Math.abs(l.z - p.z) < 3)) continue;
      if (spot) addSpot(p.x, p.z, tier);
      else addContainer('crate', p.x, p.z, 1, tier);
      return true;
    }
    return false;
  };
  /** The sides of a basement in a shuffled order, and spots along its walls to try (middle first, then the corners). */
  const wallSpots = (bi: number, side: number) => {
    const b = map.buildings[bi];
    const span = (side < 2 ? b.w : b.d) / 2 - WALL_T / 2;
    return [0, -span / 2, span / 2, -span + 1.6, span - 1.6, -span / 4, span / 4].map(r1);
  };
  const anySide = () => shuffled([0, 1, 2, 3]);
  /** What a cellar keeps: racks of jars, the old fridge, a chest, a chest of drawers, a bookshelf, crates and odds and ends. */
  const stockCellar = (bi: number) => {
    const b = map.buildings[bi];
    const look = b.look;
    boxOn(bi, 'chest', 'chest', [0, 1], wallSpots(bi, 0));
    boxOn(bi, 'fridge', 'fridge', [0, 1], wallSpots(bi, 0));
    for (const side of anySide()) if (along(bi, 'drawer', side, wallSpots(bi, side), STASH.drawer.deep * 2, STASH.drawer.along * 2, look)) break;
    for (const side of anySide()) if (along(bi, 'books', side, wallSpots(bi, side), STASH.books.deep * 2, STASH.books.along * 2, look)) break;
    // (the racks after what opens, which keeps its distance from them)
    let racks = 0;
    for (const side of anySide()) if (racks < 2 && alongAny(bi, 'shelf', side, 0.45, [3, 2.4, 1.8], look)) racks++;
    looseIn(bi, 'crate');
    looseIn(bi, 'crate');
    looseIn(bi, 'floor', true);
  };
  /**
   * What a bunker keeps, by where it is: out in the open, a chest as good as a supply drop, lockers, bunks and a table;
   * under the police station, the armory (its stash, rows of lockers and a workbench); under the bank, the strongroom
   * (a safe and deposit boxes). Crates and something on the floor in all of them.
   */
  const stockBunker = (bi: number, under: 'wild' | 'police' | 'bank') => {
    const b = map.buildings[bi];
    const look = b.look;
    const chest = under === 'wild' ? 'supply' : under === 'police' ? 'police' : 'chest';
    // against the north wall if it fits (the south one hides it from the camera)
    if (!boxOn(bi, 'chest', chest, [0, 1], wallSpots(bi, 0))) looseIn(bi, chest, true);
    if (under === 'bank') {
      for (const side of anySide()) if (along(bi, 'safe', side, wallSpots(bi, side), STASH.safe.deep * 2, STASH.safe.along * 2, look)) break;
      let boxes = 0;
      for (const side of anySide()) for (const u of wallSpots(bi, side)) if (boxes < 3 && against(bi, 'deposit', side, u, STASH.deposit.deep * 2, STASH.deposit.along * 2, look)) boxes++;
    } else {
      let rows = 0;
      for (const side of anySide()) if (rows < 2 && lockers(bi, side, wallSpots(bi, side), under === 'police' ? 3 : 2)) rows++;
    }
    if (under === 'police') for (const side of anySide()) if (alongAny(bi, 'counter', side, 0.6, [2.6, 1.8], look)) break;
    if (under === 'wild') {
      let bunks = 0;
      for (const side of anySide()) if (bunks < 2 && along(bi, 'bed', side, wallSpots(bi, side), 2.1, 1.1, look)) bunks++;
      const r = b.rooms[Math.floor(rng() * b.rooms.length)];
      dining(bi, r.x, r.z, r.hw >= r.hd, look);
    }
    looseIn(bi, 'crate');
    looseIn(bi, 'crate');
    looseIn(bi, under === 'wild' ? 'crate' : 'floor', true);
  };
  // a cellar under a few of the houses (where the stairs fit), and the police station's and the bank's basements
  let cellars = 0;
  for (const bi of shuffled(map.buildings.map((_, i) => i))) {
    const b = map.buildings[bi];
    if (b.kind !== 'police' && b.kind !== 'bank' && (b.kind !== 'house' || cellars >= 4)) continue;
    const st = stairIn(bi);
    if (!st) continue;
    const u = b.kind === 'house' ? dig('cellar', b.x, b.z, b.w, b.d, st, 1, bi) : dig('bunker', b.x, b.z, b.w, b.d, st, b.w >= 18 ? 2 : 1, bi);
    if (u < 0) continue;
    if (b.kind === 'house') {
      cellars++;
      stockCellar(u);
    } else stockBunker(u, b.kind === 'police' ? 'police' : 'bank');
  }
  // and two hatches out in the open, each down to a bunker that reaches off past the foot of its stairs
  for (let k = 0, tries = 0; k < 2 && tries < 300; tries++) {
    const x = r1((rng() * 2 - 1) * (HALF - BEACH - 24));
    const z = r1((rng() * 2 - 1) * (HALF - BEACH - 24));
    const q = Math.floor(rng() * 4);
    const alongX = q % 2 === 1;
    const dir = q < 2 ? 1 : -1;
    // the bunker: 20 m along the way down, 12 across, its end wall just behind the top of the stairs
    const back = STAIR.run + 0.4 + WALL_T / 2;
    const cx = alongX ? r1(x + dir * (10 - back)) : x;
    const cz = alongX ? z : r1(z + dir * (10 - back));
    const [w, d] = alongX ? [20, 12] : [12, 20];
    if (nearLot(x, z, 12) || !free(x, z, 7) || nearRoad(x, z, 4) || !offDoors(x, z, 6)) continue;
    if (dug.some((o) => Math.abs(o.x - cx) < o.hw + w / 2 + 3 && Math.abs(o.z - cz) < o.hd + d / 2 + 3)) continue;
    const st = stairway(x, z, alongX, dir, 0);
    const u = dig('bunker', cx, cz, w, d, st, 2, -1);
    if (u < 0) continue;
    taken.push({ x, z, r: 6 });
    lots.push({ x, z, hw: STAIR.run + 1, hd: STAIR.run + 1 });
    stockBunker(u, 'wild');
    k++;
  }

  map.buildings.forEach((b, i) => {
    for (const w of b.walls) map.solids.push({ shape: 'box', ...w, what: 'wall', ref: i });
    for (const w of b.bars) map.solids.push({ shape: 'box', ...w, what: 'bars', ref: i });
  });
  for (const d of map.slabs) map.solids.push({ shape: 'box', x: d.x, z: d.z, hw: d.hw, hd: d.hd, what: 'door', ref: d.i });
  for (const p of map.windows) map.solids.push({ shape: 'box', x: p.x, z: p.z, hw: p.hw, hd: p.hd, what: 'window', ref: p.i });
  map.trees.forEach((t, i) => map.solids.push({ shape: 'circle', x: t.x, z: t.z, r: t.r, what: 'tree', ref: i }));
  map.rocks.forEach((r, i) => map.solids.push({ shape: 'circle', x: r.x, z: r.z, r: r.r, what: 'rock', ref: i }));
  for (const c of map.containers) {
    if (c.flare) continue;
    c.solid = map.solids.length;
    if (c.kind === 'crate') map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: CRATE_HALF, hd: CRATE_HALF, what: 'crate', ref: c.id });
    else if (c.kind === 'toilet') map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: TOILET_R, hd: TOILET_R, what: 'crate', ref: c.id });
    else if (c.kind === 'hay') map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: HAY_HW, hd: HAY_HD, what: 'crate', ref: c.id });
    else if (c.kind === 'barrel') map.solids.push({ shape: 'circle', x: c.x, z: c.z, r: BARREL_R, what: 'barrel', ref: c.id });
    else if (c.kind === 'supply') map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: SUPPLY_HALF, hd: SUPPLY_HALF, what: 'chest', ref: c.id });
    else {
      // a chest, a fridge, or furniture that opens
      const [hw, hd] = containerHalf(c);
      map.solids.push({ shape: 'box', x: c.x, z: c.z, hw, hd, what: 'chest', ref: c.id });
    }
  }
  map.yards.forEach((y, i) => {
    for (const f of y.fences) map.solids.push({ shape: 'box', ...f, what: 'fence', ref: i });
  });
  map.cars.forEach((c, i) => map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: c.hw, hd: c.hd, what: 'car', ref: i }));
  // a bridge's rails, down both sides of the deck
  map.bridges.forEach((b, i) => {
    for (const s of [-1, 1]) {
      if (b.alongX) map.solids.push({ shape: 'box', x: b.x, z: b.z + s * (b.hd - FENCE_T / 2), hw: b.hw, hd: FENCE_T / 2, what: 'fence', ref: i });
      else map.solids.push({ shape: 'box', x: b.x + s * (b.hw - FENCE_T / 2), z: b.z, hw: FENCE_T / 2, hd: b.hd, what: 'fence', ref: i });
    }
  });
  map.logs.forEach((l, i) => map.solids.push({ shape: 'box', x: l.x, z: l.z, hw: l.hw, hd: l.hd, what: 'log', ref: i }));
  map.stumps.forEach((t, i) => map.solids.push({ shape: 'circle', x: t.x, z: t.z, r: t.r, what: 'log', ref: i }));
  map.furniture.forEach((f, i) => {
    const what = furnitureSolid(f.kind);
    if (what) map.solids.push({ shape: 'box', x: f.x, z: f.z, hw: f.hw, hd: f.hd, what, ref: i });
  });
  // a stairway's rails, up top and below
  for (const s of map.stairs) for (const r of [...s.rails, ...s.deepRails]) map.solids.push({ shape: 'box', ...r, what: 'fence', ref: s.i });
  map.lamps.forEach((p, i) => map.solids.push({ shape: 'circle', x: p.x, z: p.z, r: LAMP_R, what: 'post', ref: i }));
  map.mailboxes.forEach((p, i) => map.solids.push({ shape: 'circle', x: p.x, z: p.z, r: MAILBOX_R, what: 'post', ref: i }));
  map.tables.forEach((t, i) => map.solids.push({ shape: 'box', x: t.x, z: t.z, hw: t.alongX ? TABLE_HW : TABLE_HD, hd: t.alongX ? TABLE_HD : TABLE_HW, what: 'table', ref: i }));
  map.fires.forEach((f, i) => map.solids.push({ shape: 'circle', x: f.x, z: f.z, r: f.r, what: 'fire', ref: i }));
  // a called drop's box stops eggs and bullets once it is placed (see placeDrop); until then it is in no grid cell
  for (const id of map.flares) {
    const c = map.containers[id];
    c.solid = map.solids.length;
    map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: SUPPLY_HALF, hd: SUPPLY_HALF, what: 'chest', ref: c.id });
  }
  reindex(map);
  return map;
}

/** Sends a called supply drop to land at (x, z) at match time `at`: its box, its loot and its place in the grid. */
export function placeDrop(map: GameMap, c: Container, x: number, z: number, at: number) {
  if (!c.flare || c.at !== Infinity) return;
  const dx = r1(x) - c.x;
  const dz = r1(z) - c.z;
  c.x = r1(x);
  c.z = r1(z);
  c.at = at;
  for (const l of c.loot) {
    l.x = r1(l.x + dx);
    l.z = r1(l.z + dz);
  }
  const s = map.solids[c.solid];
  if (!s) return;
  s.x = c.x;
  s.z = c.z;
  const r = SUPPLY_HALF + 0.5;
  for (let cz = cellOf(c.z - r); cz <= cellOf(c.z + r); cz++) for (let cx = cellOf(c.x - r); cx <= cellOf(c.x + r); cx++) map.grid[cx + cz * COLS].push(c.solid);
}

/**
 * Is (x, z) a fair place for a supply drop to come down: on the grass, out of the ponds, the river, the bushes and the
 * cornfields, off the bounce pads, clear of every building (with room to walk round it) and of anything solid?
 */
export function dropFits(map: GameMap, x: number, z: number) {
  if (Math.abs(x) > HALF - BEACH - 4 || Math.abs(z) > HALF - BEACH - 4) return false;
  if (map.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 3)) return false;
  if (map.fields.some((f) => Math.abs(x - f.x) < f.hw + 1 && Math.abs(z - f.z) < f.hd + 1)) return false;
  if (map.ponds.some((p) => (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < (p.r + 2.5) * (p.r + 2.5))) return false;
  if (riverDist2(map, x, z) < (RIVER_HALF + 2.5) * (RIVER_HALF + 2.5)) return false;
  if (map.pads.some((p) => (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < (PAD.r + 3) * (PAD.r + 3))) return false;
  if (map.bushes.some((b) => (x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < (b.r + 1.5) * (b.r + 1.5))) return false;
  let hit = false;
  solidsNear(map, x, z, 3, (_i, s) => {
    if (hit) return;
    const near = s.shape === 'circle' ? pushCircle(x, z, SUPPLY_HALF + 1.4, s.x, s.z, s.r) : pushBox(x, z, SUPPLY_HALF + 1.4, s.x, s.z, s.hw, s.hd);
    if (near) hit = true;
  });
  return !hit;
}

// -------------------------------------------------------------------------------------------------------------------
// Geometry. Rays take a unit direction and a length and return the distance to the first contact (0 when the start
// is already inside), or Infinity for a miss.

export function rayCircle(ox: number, oz: number, dx: number, dz: number, len: number, cx: number, cz: number, r: number) {
  const fx = ox - cx;
  const fz = oz - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const b = fx * dx + fz * dz;
  if (b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t <= len ? t : Infinity;
}

export function rayBox(ox: number, oz: number, dx: number, dz: number, len: number, bx: number, bz: number, hw: number, hd: number) {
  let lo = 0;
  let hi = len;
  if (Math.abs(dx) < 1e-12) {
    if (ox < bx - hw || ox > bx + hw) return Infinity;
  } else {
    let a = (bx - hw - ox) / dx;
    let b = (bx + hw - ox) / dx;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return Infinity;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < bz - hd || oz > bz + hd) return Infinity;
  } else {
    let a = (bz - hd - oz) / dz;
    let b = (bz + hd - oz) / dz;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return Infinity;
  }
  return lo;
}

/** A box turned so its depth axis points along (sin a, cos a): built walls face the way their builder aimed. */
export type Obb = { x: number; z: number; sa: number; ca: number; hw: number; hd: number };

export function rayObb(ox: number, oz: number, dx: number, dz: number, len: number, o: Obb) {
  // local axes: u along the wall (cos a, -sin a), v through it (sin a, cos a)
  const px = ox - o.x;
  const pz = oz - o.z;
  const u = px * o.ca - pz * o.sa;
  const v = px * o.sa + pz * o.ca;
  const du = dx * o.ca - dz * o.sa;
  const dv = dx * o.sa + dz * o.ca;
  return rayBox(u, v, du, dv, len, 0, 0, o.hw, o.hd);
}

export type Push = { x: number; z: number };

/** How far to move a circle so it no longer overlaps a circle, or null when it doesn't. */
export function pushCircle(x: number, z: number, r: number, cx: number, cz: number, cr: number): Push | null {
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  const min = r + cr;
  if (d2 >= min * min) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return { x: min, z: 0 };
  const k = (min - d) / d;
  return { x: dx * k, z: dz * k };
}

export function pushBox(x: number, z: number, r: number, bx: number, bz: number, hw: number, hd: number): Push | null {
  const qx = Math.max(bx - hw, Math.min(bx + hw, x));
  const qz = Math.max(bz - hd, Math.min(bz + hd, z));
  const dx = x - qx;
  const dz = z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return { x: dx * k, z: dz * k };
  }
  // the center is inside: out through the nearest face
  const left = x - (bx - hw);
  const right = bx + hw - x;
  const top = z - (bz - hd);
  const bottom = bz + hd - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: -(left + r), z: 0 };
  if (m === right) return { x: right + r, z: 0 };
  if (m === top) return { x: 0, z: -(top + r) };
  return { x: 0, z: bottom + r };
}

export function pushObb(x: number, z: number, r: number, o: Obb): Push | null {
  const px = x - o.x;
  const pz = z - o.z;
  const u = px * o.ca - pz * o.sa;
  const v = px * o.sa + pz * o.ca;
  const p = pushBox(u, v, r, 0, 0, o.hw, o.hd);
  if (!p) return null;
  // back to world axes
  return { x: p.x * o.ca + p.z * o.sa, z: -p.x * o.sa + p.z * o.ca };
}

/** Visits the grid cells a segment crosses, in order, until `visit` returns true. */
export function walkCells(x0: number, z0: number, x1: number, z1: number, visit: (cell: number) => boolean | void) {
  const fx0 = (x0 + HALF) / CELL;
  const fz0 = (z0 + HALF) / CELL;
  const fx1 = (x1 + HALF) / CELL;
  const fz1 = (z1 + HALF) / CELL;
  let ix = Math.floor(fx0);
  let iz = Math.floor(fz0);
  const ex = Math.floor(fx1);
  const ez = Math.floor(fz1);
  const dx = fx1 - fx0;
  const dz = fz1 - fz0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx ? Math.abs(1 / dx) : Infinity;
  const tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (ix + 1 - fx0) * tdx : sx < 0 ? (fx0 - ix) * tdx : Infinity;
  let tmz = sz > 0 ? (iz + 1 - fz0) * tdz : sz < 0 ? (fz0 - iz) * tdz : Infinity;
  const steps = Math.abs(ex - ix) + Math.abs(ez - iz);
  for (let i = 0; i <= steps; i++) {
    if (ix >= 0 && iz >= 0 && ix < COLS && iz < COLS && visit(ix + iz * COLS)) return;
    if (tmx < tmz) {
      tmx += tdx;
      ix += sx;
    } else {
      tmz += tdz;
      iz += sz;
    }
  }
}

/** Each solid whose grid cells touch the square around a point, once (on the point's own level). */
export function solidsNear(map: GameMap, x: number, z: number, r: number, visit: (i: number, s: Solid) => void) {
  const mark = nextMark(map);
  const grid = isDeep(x) ? map.under : map.grid;
  const tx = topX(x);
  for (let cz = cellOf(z - r); cz <= cellOf(z + r); cz++)
    for (let cx = cellOf(tx - r); cx <= cellOf(tx + r); cx++)
      for (const i of grid[cx + cz * COLS]) {
        if (map.stamp[i] === mark) continue;
        map.stamp[i] = mark;
        visit(i, map.solids[i]);
      }
}

/** Each solid in the cells along a segment, once, in roughly near-to-far order (on the level it starts on). */
export function solidsAlong(map: GameMap, x0: number, z0: number, x1: number, z1: number, visit: (i: number, s: Solid) => void) {
  const mark = nextMark(map);
  const deep = isDeep(x0);
  const grid = deep ? map.under : map.grid;
  const ox = deep ? DEEP : 0;
  walkCells(x0 - ox, z0, x1 - ox, z1, (cell) => {
    for (const i of grid[cell]) {
      if (map.stamp[i] === mark) continue;
      map.stamp[i] = mark;
      visit(i, map.solids[i]);
    }
  });
}

function nextMark(map: GameMap) {
  map.mark = (map.mark + 1) >>> 0;
  if (map.mark === 0) {
    map.stamp.fill(0);
    map.mark = 1;
  }
  return map.mark;
}

/**
 * The stairway an egg standing at (x, z) has stepped onto, or -1: up top, a little way in from its top end; below, a
 * little way in from its foot.
 */
export function stairAt(map: GameMap, x: number, z: number) {
  const deep = isDeep(x);
  const tx = topX(x);
  for (const s of map.stairs) {
    if (Math.abs(tx - s.x) > 3 || Math.abs(z - s.z) > 3) continue;
    const run = s.dx ? s.hw : s.hd;
    const half = s.dx ? s.hd : s.hw;
    // along the way down from the middle, and how far off to the side
    const along = (tx - s.x) * s.dx + (z - s.z) * s.dz;
    const across = Math.abs((tx - s.x) * s.dz - (z - s.z) * s.dx);
    if (across > half - 0.2 || Math.abs(along) > run) continue;
    if (deep ? along < run - 0.5 : along > -run + 0.5) return s.i;
  }
  return -1;
}

/** Where an egg comes out at the other end of a stairway: below, past its foot; up top, back off its top end. */
export function stairOut(s: Stair, down: boolean) {
  const run = (s.dx ? s.hw : s.hd) + 0.95;
  return down ? { x: s.x + DEEP + s.dx * run, z: s.z + s.dz * run } : { x: s.x - s.dx * run, z: s.z - s.dz * run };
}

/** The basement (a building) a point underground is in, or -1. */
export function basementAt(map: GameMap, x: number, z: number) {
  if (!isDeep(x)) return -1;
  for (const s of map.stairs) {
    const b = map.buildings[s.u];
    if (b && Math.abs(x - b.x) < b.w / 2 + 0.5 && Math.abs(z - b.z) < b.d / 2 + 0.5) return s.u;
  }
  return -1;
}

/** The stairway down to a basement, or -1. */
export const stairOf = (map: GameMap, u: number) => map.stairs.findIndex((s) => s.u === u);

/** Distance along a ray to a solid. */
export function raySolid(s: Solid, ox: number, oz: number, dx: number, dz: number, len: number) {
  return s.shape === 'circle' ? rayCircle(ox, oz, dx, dz, len, s.x, s.z, s.r) : rayBox(ox, oz, dx, dz, len, s.x, s.z, s.hw, s.hd);
}
