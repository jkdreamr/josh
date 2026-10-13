// Pure helpers shared by the group and drinking games. No React or DOM, so tests run them under plain node.

/** Most players a group game seats, and the longest name it keeps. */
export const PLAYERS_MAX = 20;
export const PLAYER_NAME_MAX = 16;

export type Rng = () => number;

/** A small seeded generator for tests and repeatable deals. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates). */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One random item. */
export const pick = <T>(items: readonly T[], rng: Rng = Math.random): T => items[Math.floor(rng() * items.length)];

/** Trims, folds whitespace, drops control characters and caps the length of a typed player name. */
export function tidyName(raw: string): string {
  const clean = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, PLAYER_NAME_MAX).join('').trim();
}

/** Keeps a saved roster usable: strings only, tidy, no blanks or case-insensitive duplicates, at most PLAYERS_MAX. */
export function tidyRoster(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = tidyName(item);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === PLAYERS_MAX) break;
  }
  return out;
}

export type AddResult = { ok: true; players: string[] } | { ok: false; reason: string };

/** Adds a typed name to the roster, or says why it can't. */
export function addPlayer(players: readonly string[], raw: string): AddResult {
  const name = tidyName(raw);
  if (!name) return { ok: false, reason: 'Type a name first.' };
  if (players.some((p) => p.toLocaleLowerCase() === name.toLocaleLowerCase())) return { ok: false, reason: `${name} is already in.` };
  if (players.length >= PLAYERS_MAX) return { ok: false, reason: `Up to ${PLAYERS_MAX} players.` };
  return { ok: true, players: [...players, name] };
}

/** '1 sip', '3 sips'. */
export const sips = (n: number) => `${n} ${n === 1 ? 'sip' : 'sips'}`;

/** 'Sam', 'Sam and Jo', 'Sam, Jo and Max'. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** 1:05, 0:09. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A shuffled draw pile that deals every item once before reshuffling, never repeating across the seam. */
export class Pile<T> {
  private order: T[] = [];
  private items: readonly T[];
  private rng: Rng;
  constructor(items: readonly T[], rng: Rng = Math.random) {
    this.items = items;
    this.rng = rng;
  }
  get left() {
    return this.order.length;
  }
  draw(last?: T): T | undefined {
    if (!this.items.length) return undefined;
    if (!this.order.length) {
      this.order = shuffle(this.items, this.rng);
      // Never deal the card just shown again as the first card of a new pass.
      if (this.order.length > 1 && this.order[this.order.length - 1] === last) {
        const i = Math.floor(this.rng() * (this.order.length - 1));
        [this.order[i], this.order[this.order.length - 1]] = [this.order[this.order.length - 1], this.order[i]];
      }
    }
    return this.order.pop();
  }
}
