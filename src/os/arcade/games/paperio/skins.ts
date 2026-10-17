// Colors, skins and the milestones that unlock them. Pure rules plus a tiny store kept in localStorage; works without
// storage (unlocks then last for the visit).

/** Campus palette: cardinal, palm green, Lagunita teal, sky, poppy, sun, plum and friends. */
export const PALETTE = [
  '#b1161c', // cardinal
  '#2f8f5b', // palm
  '#0f8fa3', // lagunita
  '#4a9fd8', // sky
  '#ec7a12', // poppy
  '#e3a51b', // sun
  '#8a3a9c', // plum
  '#e85a4a', // spirited
  '#8e9a3a', // olive
  '#5fae8a', // bay
  '#8c2d4b', // brick
  '#2c4f8f', // navy
  '#9a4a24', // redwood
  '#9a7fd0', // jacaranda
  '#e86a9e', // rose
  '#5a6b7a', // slate
] as const;

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Mixes a color toward white (t > 0) or black (t < 0). */
export function shade(c: string, t: number) {
  const rgb = hex(c);
  return toHex(rgb.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t))));
}
export const sideOf = (i: number) => shade(PALETTE[i % PALETTE.length], -0.38);
export const trailOf = (i: number) => shade(PALETTE[i % PALETTE.length], 0.42);
export const colorOf = (i: number) => PALETTE[i % PALETTE.length];

export type Pattern = 'face' | 'palm' | 'wave' | 'tree' | 'oar' | 'cox' | 'tower' | 'dish' | 'axe' | 'pi' | 'sun' | 'poppy' | 'crown';

/** What it takes to unlock a skin. */
export type Unlock =
  | { kind: 'free' }
  | { kind: 'pct'; n: number }
  | { kind: 'kills'; n: number }
  | { kind: 'streak'; n: number }
  | { kind: 'games'; n: number }
  | { kind: 'first' };

export type Skin = { id: number; key: string; name: string; color: number; pattern: Pattern; unlock: Unlock };

export const SKINS: readonly Skin[] = [
  { id: 0, key: 'cardinal', name: 'cardinal', color: 0, pattern: 'face', unlock: { kind: 'free' } },
  { id: 1, key: 'palm', name: 'palm drive', color: 1, pattern: 'palm', unlock: { kind: 'free' } },
  { id: 2, key: 'lag', name: 'lake lag', color: 2, pattern: 'wave', unlock: { kind: 'free' } },
  { id: 3, key: 'tree', name: 'redwood', color: 12, pattern: 'tree', unlock: { kind: 'pct', n: 10 } },
  { id: 4, key: 'oar', name: 'stroke seat', color: 11, pattern: 'oar', unlock: { kind: 'kills', n: 10 } },
  { id: 5, key: 'sun', name: 'golden hour', color: 5, pattern: 'sun', unlock: { kind: 'games', n: 10 } },
  { id: 6, key: 'cox', name: 'coxswain', color: 4, pattern: 'cox', unlock: { kind: 'pct', n: 25 } },
  { id: 7, key: 'pi', name: 'math corner', color: 6, pattern: 'pi', unlock: { kind: 'streak', n: 3 } },
  { id: 8, key: 'dish', name: 'the dish', color: 15, pattern: 'dish', unlock: { kind: 'first' } },
  { id: 9, key: 'poppy', name: 'poppy', color: 7, pattern: 'poppy', unlock: { kind: 'kills', n: 40 } },
  { id: 10, key: 'hoover', name: 'hoover', color: 13, pattern: 'tower', unlock: { kind: 'pct', n: 50 } },
  { id: 11, key: 'axe', name: 'the axe', color: 10, pattern: 'axe', unlock: { kind: 'pct', n: 75 } },
  { id: 12, key: 'farm', name: 'the farm', color: 9, pattern: 'crown', unlock: { kind: 'pct', n: 100 } },
];

export const skinOf = (id: number) => SKINS[id] ?? SKINS[0];

export function unlockText(u: Unlock): string {
  switch (u.kind) {
    case 'free':
      return 'yours';
    case 'pct':
      return u.n >= 100 ? 'own the whole map' : `claim ${u.n}% in one life`;
    case 'kills':
      return `${u.n} cuts in total`;
    case 'streak':
      return `${u.n} cuts in one life`;
    case 'games':
      return `play ${u.n} rounds`;
    case 'first':
      return 'take first place';
  }
}

/** Lifetime numbers the unlocks are measured against. */
export type Stats = { games: number; kills: number; best: number; streak: number; first: boolean };
export type Locker = { have: number[]; pick: number; stats: Stats };

export const freshLocker = (): Locker => ({ have: SKINS.filter((s) => s.unlock.kind === 'free').map((s) => s.id), pick: 0, stats: { games: 0, kills: 0, best: 0, streak: 0, first: false } });

export function earned(u: Unlock, s: Stats): boolean {
  switch (u.kind) {
    case 'free':
      return true;
    case 'pct':
      return s.best >= u.n - 1e-9;
    case 'kills':
      return s.kills >= u.n;
    case 'streak':
      return s.streak >= u.n;
    case 'games':
      return s.games >= u.n;
    case 'first':
      return s.first;
  }
}

/** Folds a life's numbers into the locker. Returns the new locker and the skins it just unlocked. */
export function record(l: Locker, life: { pct?: number; kills?: number; streak?: number; first?: boolean; game?: boolean }): { locker: Locker; fresh: Skin[] } {
  const stats: Stats = {
    games: l.stats.games + (life.game ? 1 : 0),
    kills: l.stats.kills + Math.max(0, Math.floor(life.kills ?? 0)),
    best: Math.max(l.stats.best, life.pct ?? 0),
    streak: Math.max(l.stats.streak, life.streak ?? 0),
    first: l.stats.first || !!life.first,
  };
  const fresh = SKINS.filter((s) => !l.have.includes(s.id) && earned(s.unlock, stats));
  return { locker: { have: [...l.have, ...fresh.map((s) => s.id)].sort((a, b) => a - b), pick: l.pick, stats }, fresh };
}

export function parseLocker(raw: string | null): Locker {
  const l = freshLocker();
  if (!raw) return l;
  try {
    const v = JSON.parse(raw) as { have?: unknown; pick?: unknown; stats?: Record<string, unknown> };
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
    if (v.stats && typeof v.stats === 'object')
      l.stats = { games: Math.floor(num(v.stats.games)), kills: Math.floor(num(v.stats.kills)), best: Math.min(100, num(v.stats.best)), streak: Math.floor(num(v.stats.streak)), first: v.stats.first === true };
    if (Array.isArray(v.have)) l.have = [...new Set([...l.have, ...v.have.filter((id): id is number => Number.isInteger(id) && !!SKINS[id as number])])].sort((a, b) => a - b);
    // anything the stats have earned is unlocked even if the list was lost
    l.have = [...new Set([...l.have, ...SKINS.filter((s) => earned(s.unlock, l.stats)).map((s) => s.id)])].sort((a, b) => a - b);
    if (Number.isInteger(v.pick) && l.have.includes(v.pick as number)) l.pick = v.pick as number;
  } catch {
    return freshLocker();
  }
  return l;
}

// ---------------------------------------------------------------------------------------------------------------
// The saved locker, shared by the Start card and the game.

const KEY = 'arcade:paperio-skins';
let current: Locker | null = null;
const subs = new Set<() => void>();

export function loadLocker(): Locker {
  if (current) return current;
  let raw: string | null = null;
  try {
    raw = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  current = parseLocker(raw);
  return current;
}

export function saveLocker(l: Locker) {
  current = l;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* storage blocked: kept for this visit */
  }
  subs.forEach((f) => f());
}

export function subscribeLocker(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Personal bests per difficulty (percent, two decimals), next to the shell's overall best.

const BEST_KEY = 'arcade:paperio-bests';
export function loadBests(): Record<string, number> {
  try {
    const v = JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch {
    return {};
  }
}
/** Records a best for a board; true when it beat the old one. */
export function submitBest(board: string, pct: number): boolean {
  const all = loadBests();
  if ((all[board] ?? 0) >= pct) return false;
  all[board] = pct;
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked */
  }
  return true;
}
