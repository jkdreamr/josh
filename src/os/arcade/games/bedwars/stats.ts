// Your Bed Wars record on this device, and the cosmetics it unlocks: skins, kill effects and bed-break effects.
// Pure apart from the storage it is handed, so it runs under node.

export type Record = { games: number; wins: number; kills: number; finals: number; beds: number; deaths: number; streak: number; best: number };
export const freshRecord = (): Record => ({ games: 0, wins: 0, kills: 0, finals: 0, beds: 0, deaths: 0, streak: 0, best: 0 });

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'arcade:bedwars-record';

const store = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function loadRecord(s: Store | null = store()): Record {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return freshRecord();
    const v = JSON.parse(raw) as Partial<Record>;
    const r = freshRecord();
    for (const k of Object.keys(r) as (keyof Record)[]) if (Number.isInteger(v[k]) && (v[k] as number) >= 0) r[k] = v[k] as number;
    return r;
  } catch {
    return freshRecord();
  }
}

export function saveRecord(r: Record, s: Store | null = store()) {
  try {
    s?.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage full or blocked */
  }
  listeners.forEach((f) => f());
}

const listeners = new Set<() => void>();
export function subscribeRecord(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Folds one finished game into the record. */
export function addGame(r: Record, game: { won: boolean; kills: number; finals: number; beds: number; deaths: number }): Record {
  const streak = game.won ? r.streak + 1 : 0;
  return {
    games: r.games + 1,
    wins: r.wins + (game.won ? 1 : 0),
    kills: r.kills + game.kills,
    finals: r.finals + game.finals,
    beds: r.beds + game.beds,
    deaths: r.deaths + game.deaths,
    streak,
    best: Math.max(r.best, streak),
  };
}

export type CosmeticKind = 'skin' | 'kill' | 'bed';
export type Cosmetic = { kind: CosmeticKind; id: string; name: string; need: string; unlocked: (r: Record) => boolean };

/** Everything you can wear or set off, and what earns it. */
export const COSMETICS: Cosmetic[] = [
  { kind: 'skin', id: '0', name: 'Hoodie', need: 'yours from the start', unlocked: () => true },
  { kind: 'skin', id: '1', name: 'Coxswain', need: 'win a game', unlocked: (r) => r.wins >= 1 },
  { kind: 'skin', id: '2', name: 'Lab Coat', need: '10 final kills', unlocked: (r) => r.finals >= 10 },
  { kind: 'skin', id: '4', name: 'Marching Band', need: 'break 10 beds', unlocked: (r) => r.beds >= 10 },
  { kind: 'skin', id: '3', name: 'The Tree', need: 'win 5 games', unlocked: (r) => r.wins >= 5 },
  { kind: 'skin', id: '5', name: 'Founder', need: 'a 3 game win streak', unlocked: (r) => r.best >= 3 },
  { kind: 'kill', id: 'cardinal', name: 'Cardinal Burst', need: 'yours from the start', unlocked: () => true },
  { kind: 'kill', id: 'firework', name: 'Firework', need: '25 kills', unlocked: (r) => r.kills >= 25 },
  { kind: 'kill', id: 'lightning', name: 'Lightning', need: '25 final kills', unlocked: (r) => r.finals >= 25 },
  { kind: 'kill', id: 'tree', name: 'Tree Sprout', need: 'win 10 games', unlocked: (r) => r.wins >= 10 },
  { kind: 'bed', id: 'confetti', name: 'Confetti', need: 'yours from the start', unlocked: () => true },
  { kind: 'bed', id: 'blast', name: 'Big Blast', need: 'break 5 beds', unlocked: (r) => r.beds >= 5 },
  { kind: 'bed', id: 'axe', name: 'The Axe', need: 'break 25 beds', unlocked: (r) => r.beds >= 25 },
];

export const isUnlocked = (r: Record, kind: CosmeticKind, id: string) => !!COSMETICS.find((c) => c.kind === kind && c.id === id)?.unlocked(r);

/** Cosmetics this game unlocked (in the record after but not before). */
export function newUnlocks(before: Record, after: Record): Cosmetic[] {
  return COSMETICS.filter((c) => !c.unlocked(before) && c.unlocked(after));
}

/** Level shown on the start card: a Bed Wars "star" for every 5 games won plus kills. */
export const starOf = (r: Record) => 1 + Math.floor((r.wins * 10 + r.finals * 2 + r.beds * 3 + r.kills) / 40);
