// The Garage: coins you pick up in races go in a bank you spend on kart paint and hats.
// Pure rules plus a tiny store kept in localStorage; works without storage (the bank just resets).
import { HATS, type Hat } from './logic.ts';

export const PAINTS = [
  { id: 'red', color: '#e53935', price: 0 },
  { id: 'cardinal', color: '#8c1515', price: 25 },
  { id: 'orange', color: '#fb8c00', price: 25 },
  { id: 'gold', color: '#d4a017', price: 25 },
  { id: 'green', color: '#3fae4a', price: 25 },
  { id: 'teal', color: '#00acc1', price: 25 },
  { id: 'blue', color: '#1e88e5', price: 25 },
  { id: 'purple', color: '#8e24aa', price: 25 },
  { id: 'pink', color: '#ec407a', price: 25 },
  { id: 'white', color: '#eceff1', price: 40 },
  { id: 'black', color: '#2b2b33', price: 40 },
  { id: 'chrome', color: '#9aa7b4', price: 60 },
] as const;
export type PaintId = (typeof PAINTS)[number]['id'];
export const HAT_PRICES: Record<Hat, number> = { cap: 0, tree: 50, top: 50, bow: 50, tower: 60, axe: 60, dish: 60, claw: 60 };
export const HAT_NAMES: Record<Hat, string> = { cap: 'Cap', tree: 'Tree', top: 'Top Hat', bow: 'Bow', tower: 'Tower', axe: 'Axe', dish: 'Dish', claw: 'Claws' };
/** Bonus coins for a podium finish. */
export const PODIUM = [10, 6, 4];
export const BANK_MAX = 99_999;

export type Garage = { bank: number; paints: PaintId[]; hats: Hat[]; paint: PaintId; hat: Hat };

export const freshGarage = (): Garage => ({ bank: 0, paints: ['red'], hats: ['cap'], paint: 'red', hat: 'cap' });

const isPaint = (v: unknown): v is PaintId => PAINTS.some((p) => p.id === v);
const isHat = (v: unknown): v is Hat => HATS.includes(v as Hat);

/** Reads a saved garage, dropping anything unknown; a missing or broken save is a fresh garage. */
export function parseGarage(raw: string | null): Garage {
  const g = freshGarage();
  if (!raw) return g;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof Garage, unknown>>;
    if (typeof v.bank === 'number' && Number.isFinite(v.bank)) g.bank = Math.max(0, Math.min(BANK_MAX, Math.floor(v.bank)));
    if (Array.isArray(v.paints)) g.paints = [...new Set(['red' as PaintId, ...v.paints.filter(isPaint)])];
    if (Array.isArray(v.hats)) g.hats = [...new Set(['cap' as Hat, ...v.hats.filter(isHat)])];
    if (isPaint(v.paint) && g.paints.includes(v.paint)) g.paint = v.paint;
    if (isHat(v.hat) && g.hats.includes(v.hat)) g.hat = v.hat;
  } catch {
    return freshGarage();
  }
  return g;
}

export const paintColor = (id: PaintId) => PAINTS.find((p) => p.id === id)!.color;
export const paintPrice = (id: PaintId) => PAINTS.find((p) => p.id === id)!.price;

/** Buys (if needed) and wears a paint. Returns the new garage, or null when you cannot afford it. */
export function choosePaint(g: Garage, id: PaintId): Garage | null {
  if (g.paints.includes(id)) return { ...g, paint: id };
  const price = paintPrice(id);
  if (g.bank < price) return null;
  return { ...g, bank: g.bank - price, paints: [...g.paints, id], paint: id };
}

/** Buys (if needed) and wears a hat. Returns the new garage, or null when you cannot afford it. */
export function chooseHat(g: Garage, hat: Hat): Garage | null {
  if (g.hats.includes(hat)) return { ...g, hat };
  if (g.bank < HAT_PRICES[hat]) return null;
  return { ...g, bank: g.bank - HAT_PRICES[hat], hats: [...g.hats, hat], hat };
}

/** Coins earned in a race plus the podium bonus, into the bank. */
export function payout(earned: number, place: number) {
  return Math.max(0, Math.floor(earned)) + (PODIUM[place - 1] ?? 0);
}
export const deposit = (g: Garage, coins: number): Garage => ({ ...g, bank: Math.min(BANK_MAX, g.bank + Math.max(0, Math.floor(coins))) });

/** Paint and hat packed into one small number for the network. */
export const lookOf = (g: Pick<Garage, 'paint' | 'hat'>) => PAINTS.findIndex((p) => p.id === g.paint) * 16 + HATS.indexOf(g.hat);
export function fromLook(look: number): { color: string; hat: Hat } | null {
  const paint = PAINTS[Math.floor(look / 16)];
  const hat = HATS[look % 16];
  return Number.isInteger(look) && look >= 0 && paint && hat ? { color: paint.color, hat } : null;
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
