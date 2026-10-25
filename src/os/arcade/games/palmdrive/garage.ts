// The Garage: coins you pick up in races go in a bank you spend on paint, hats, wheels and boost trails.
// Pure rules plus a tiny store kept in localStorage; works without storage (the bank just resets).
import { HATS, type Hat } from './logic.ts';

/**
 * How a paint is finished: flat, metallic, pearl (shifting toward its trim as the kart turns), two-tone (the nose, side
 * pods and helmet stripe in the trim), a racing stripe in the trim down the middle, or flames down the sides.
 */
export type Finish = 'flat' | 'metal' | 'pearl' | 'duo' | 'stripe' | 'flames';
export const FINISH_NAMES: Record<Finish, string> = { flat: 'flat', metal: 'metallic', pearl: 'pearl', duo: 'two-tone', stripe: 'racing stripe', flames: 'flames' };
type Paint = { id: string; name: string; color: string; price: number; finish?: Finish; trim?: string };
// (a look sends a paint's place in this list, so new ones only ever go on the end: at most 32)
export const PAINTS = [
  { id: 'red', name: 'Red', color: '#e53935', price: 0 },
  { id: 'cardinal', name: 'Cardinal', color: '#8c1515', price: 25 },
  { id: 'orange', name: 'Orange', color: '#fb8c00', price: 25 },
  { id: 'gold', name: 'Gold', color: '#d4a017', price: 25 },
  { id: 'green', name: 'Green', color: '#3fae4a', price: 25 },
  { id: 'teal', name: 'Teal', color: '#00acc1', price: 25 },
  { id: 'blue', name: 'Blue', color: '#1e88e5', price: 25 },
  { id: 'purple', name: 'Purple', color: '#8e24aa', price: 25 },
  { id: 'pink', name: 'Pink', color: '#ec407a', price: 25 },
  { id: 'white', name: 'White', color: '#eceff1', price: 40 },
  { id: 'black', name: 'Black', color: '#2b2b33', price: 40 },
  { id: 'chrome', name: 'Chrome', color: '#9aa7b4', price: 60, finish: 'metal' },
  { id: 'sandstone', name: 'Sandstone', color: '#d9b382', price: 40 },
  { id: 'candy', name: 'Candy Apple', color: '#c8101c', price: 80, finish: 'metal' },
  { id: 'gunmetal', name: 'Gunmetal', color: '#56606b', price: 80, finish: 'metal' },
  { id: 'memchu', name: 'MemChu Gold', color: '#e0ad2c', price: 90, finish: 'metal' },
  { id: 'pearl', name: 'Pearl', color: '#f4efe6', price: 100, finish: 'pearl', trim: '#a9c4f5' },
  { id: 'stanford', name: 'Cardinal Stripe', color: '#8c1515', price: 90, finish: 'stripe', trim: '#f6f6f8' },
  { id: 'tree', name: 'The Tree', color: '#2f8a3c', price: 90, finish: 'duo', trim: '#8c1515' },
  { id: 'hotrod', name: 'Hot Rod', color: '#25252c', price: 120, finish: 'flames' },
] as const satisfies readonly Paint[];
export type PaintId = (typeof PAINTS)[number]['id'];
export const HAT_PRICES: Record<Hat, number> = {
  cap: 0,
  tree: 50,
  top: 50,
  bow: 50,
  tower: 60,
  axe: 60,
  dish: 60,
  claw: 60,
  grad: 60,
  palm: 60,
  bike: 60,
  band: 70,
  boater: 70,
  golf: 70,
  prop: 80,
  laurel: 120,
};
export const HAT_NAMES: Record<Hat, string> = {
  cap: 'Cap',
  tree: 'Tree',
  top: 'Top Hat',
  bow: 'Bow',
  tower: 'Tower',
  axe: 'Axe',
  dish: 'Dish',
  claw: 'Claws',
  grad: 'Mortarboard',
  palm: 'Palm',
  bike: 'Bike Helmet',
  band: 'Band Hat',
  boater: 'Boater',
  golf: 'Tee Time',
  prop: 'Propeller',
  laurel: 'Laurels',
};

/** Wheels (on the water, the tips of the oar blades: see WHEEL_TIPS). A look sends the place in this list, at most 16. */
export type Wheel = 'classic' | 'gold' | 'whitewall' | 'chunky' | 'spoke' | 'cardinal' | 'neon';
export const WHEELS: Wheel[] = ['classic', 'gold', 'whitewall', 'chunky', 'spoke', 'cardinal', 'neon'];
export const WHEEL_PRICES: Record<Wheel, number> = { classic: 0, gold: 40, whitewall: 50, chunky: 60, spoke: 70, cardinal: 70, neon: 80 };
export const WHEEL_NAMES: Record<Wheel, string> = { classic: 'Classic', gold: 'Gold Rims', whitewall: 'Whitewalls', chunky: 'Off-Road', spoke: 'Bike Spokes', cardinal: 'Block S', neon: 'Neon' };
/** The colour each set of wheels puts on the tips of a shell's oar blades. */
export const WHEEL_TIPS: Record<Wheel, string> = { classic: '#f6f6f8', gold: '#f7c948', whitewall: '#c9d1d8', chunky: '#3a3b44', spoke: '#d7dde2', cardinal: '#8c1515', neon: '#3cf2ff' };

/**
 * The boost trail: the colour of the flames out the back on a boost (on the water, the white water off the stern).
 * Gold throws sparks, Cardinal & White flickers between the two and Rainbow runs through them all. At most 16.
 */
export type Flame = 'orange' | 'blue' | 'cardinal' | 'green' | 'purple' | 'gold' | 'stanford' | 'rainbow';
export const FLAMES: Flame[] = ['orange', 'blue', 'cardinal', 'green', 'purple', 'gold', 'stanford', 'rainbow'];
export const FLAME_PRICES: Record<Flame, number> = { orange: 0, blue: 40, cardinal: 40, green: 40, purple: 40, gold: 60, stanford: 80, rainbow: 100 };
export const FLAME_NAMES: Record<Flame, string> = { orange: 'Classic', blue: 'Blue', cardinal: 'Cardinal', green: 'Green', purple: 'Purple', gold: 'Gold Sparks', stanford: 'Cardinal & White', rainbow: 'Rainbow' };
/** Each trail's colour (and the second one it flickers to, if any). Rainbow's is where it starts. */
export const FLAME_COLORS: Record<Flame, [string, string?]> = {
  orange: ['#ffa31a'],
  blue: ['#3fb6ff'],
  cardinal: ['#e8303a'],
  green: ['#4cff74'],
  purple: ['#c46bff'],
  gold: ['#ffd23f', '#fff6c8'],
  stanford: ['#d0202a', '#ffffff'],
  rainbow: ['#ff5a5a'],
};

/** A kart's garage extras beyond its colour and hat: the paint's finish (trim is its second colour), wheels and boost trail. */
export type Gear = { finish: Finish; trim: string; wheels: Wheel; flame: Flame };
export const PLAIN_GEAR: Gear = { finish: 'flat', trim: '#ffffff', wheels: 'classic', flame: 'orange' };
/** Everything about how a kart looks. */
export type Look = { color: string; hat: Hat; gear: Gear };

/** Bonus coins for a podium finish. */
export const PODIUM = [10, 6, 4];
export const BANK_MAX = 99_999;

/** What you own on each shelf, and what you have on. */
export type Garage = { bank: number; paints: PaintId[]; hats: Hat[]; wheels: Wheel[]; flames: Flame[]; paint: PaintId; hat: Hat; wheel: Wheel; flame: Flame };

export const freshGarage = (): Garage => ({ bank: 0, paints: ['red'], hats: ['cap'], wheels: ['classic'], flames: ['orange'], paint: 'red', hat: 'cap', wheel: 'classic', flame: 'orange' });

const isPaint = (v: unknown): v is PaintId => PAINTS.some((p) => p.id === v);
const isHat = (v: unknown): v is Hat => HATS.includes(v as Hat);
const isWheel = (v: unknown): v is Wheel => WHEELS.includes(v as Wheel);
const isFlame = (v: unknown): v is Flame => FLAMES.includes(v as Flame);

/**
 * Reads a saved garage, dropping anything unknown; a missing or broken save is a fresh garage. A save from before
 * wheels and boost trails just has the starter ones.
 */
export function parseGarage(raw: string | null): Garage {
  const g = freshGarage();
  if (!raw) return g;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof Garage, unknown>>;
    if (typeof v.bank === 'number' && Number.isFinite(v.bank)) g.bank = Math.max(0, Math.min(BANK_MAX, Math.floor(v.bank)));
    if (Array.isArray(v.paints)) g.paints = [...new Set(['red' as PaintId, ...v.paints.filter(isPaint)])];
    if (Array.isArray(v.hats)) g.hats = [...new Set(['cap' as Hat, ...v.hats.filter(isHat)])];
    if (Array.isArray(v.wheels)) g.wheels = [...new Set(['classic' as Wheel, ...v.wheels.filter(isWheel)])];
    if (Array.isArray(v.flames)) g.flames = [...new Set(['orange' as Flame, ...v.flames.filter(isFlame)])];
    if (isPaint(v.paint) && g.paints.includes(v.paint)) g.paint = v.paint;
    if (isHat(v.hat) && g.hats.includes(v.hat)) g.hat = v.hat;
    if (isWheel(v.wheel) && g.wheels.includes(v.wheel)) g.wheel = v.wheel;
    if (isFlame(v.flame) && g.flames.includes(v.flame)) g.flame = v.flame;
  } catch {
    return freshGarage();
  }
  return g;
}

export const paintOf = (id: PaintId): Paint => PAINTS.find((p) => p.id === id)!;
export const paintColor = (id: PaintId) => paintOf(id).color;
export const paintPrice = (id: PaintId) => paintOf(id).price;

/** Each shelf of the garage and the slot what you wear from it goes in. */
type Shelves = { paints: PaintId; hats: Hat; wheels: Wheel; flames: Flame };
const WORN = { paints: 'paint', hats: 'hat', wheels: 'wheel', flames: 'flame' } as const;

/** Buys (if needed) and wears something off a shelf. Returns the new garage, or null when you cannot afford it. */
function choose<S extends keyof Shelves>(g: Garage, shelf: S, id: Shelves[S], price: number): Garage | null {
  const owned = g[shelf] as Shelves[S][];
  if (owned.includes(id)) return { ...g, [WORN[shelf]]: id };
  if (g.bank < price) return null;
  return { ...g, bank: g.bank - price, [shelf]: [...owned, id], [WORN[shelf]]: id };
}
export const choosePaint = (g: Garage, id: PaintId) => choose(g, 'paints', id, paintPrice(id));
export const chooseHat = (g: Garage, hat: Hat) => choose(g, 'hats', hat, HAT_PRICES[hat]);
export const chooseWheel = (g: Garage, wheel: Wheel) => choose(g, 'wheels', wheel, WHEEL_PRICES[wheel]);
export const chooseFlame = (g: Garage, flame: Flame) => choose(g, 'flames', flame, FLAME_PRICES[flame]);

/** Coins earned in a race plus the podium bonus, into the bank. */
export function payout(earned: number, place: number) {
  return Math.max(0, Math.floor(earned)) + (PODIUM[place - 1] ?? 0);
}
export const deposit = (g: Garage, coins: number): Garage => ({ ...g, bank: Math.min(BANK_MAX, g.bank + Math.max(0, Math.floor(coins))) });

/** How your kart looks in a race. */
export function lookFor(g: Pick<Garage, 'paint' | 'hat' | 'wheel' | 'flame'>): Look {
  const p = paintOf(g.paint);
  return { color: p.color, hat: g.hat, gear: { finish: p.finish ?? 'flat', trim: p.trim ?? p.color, wheels: g.wheel, flame: g.flame } };
}

/**
 * Your look packed into one small number for the network: the hat in bits 0-3, the paint in bits 4-8, the wheels in
 * 9-12 and the boost trail in 13-16. Classic wheels and the classic trail leave the top bits empty, so a look from
 * before wheels and trails (paint * 16 + hat) reads the same as ever, and an older client just ignores one with them
 * (or with a paint or hat it has never heard of) and leaves that kart in its seat's colour.
 */
export const LOOK_MAX = 1 << 17;
export const lookOf = (g: Pick<Garage, 'paint' | 'hat' | 'wheel' | 'flame'>) =>
  HATS.indexOf(g.hat) + PAINTS.findIndex((p) => p.id === g.paint) * 16 + WHEELS.indexOf(g.wheel) * 512 + FLAMES.indexOf(g.flame) * 8192;
export function fromLook(look: number): Look | null {
  if (!Number.isInteger(look) || look < 0 || look >= LOOK_MAX) return null;
  const hat = HATS[look % 16];
  const paint = PAINTS[Math.floor(look / 16) % 32];
  const wheel = WHEELS[Math.floor(look / 512) % 16];
  const flame = FLAMES[Math.floor(look / 8192)];
  return hat && paint && wheel && flame ? lookFor({ paint: paint.id, hat, wheel, flame }) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The saved garage, shared by the Start card and the race.

const KEY = 'arcade:palmdrive-garage';
let current: Garage | null = null;
const subs = new Set<() => void>();

export function loadGarage(): Garage {
  if (current) return current;
  let raw: string | null = null;
  try {
    raw = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  current = parseGarage(raw);
  return current;
}

export function saveGarage(g: Garage) {
  current = g;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* storage blocked: kept for this visit */
  }
  subs.forEach((f) => f());
}

export function subscribeGarage(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
