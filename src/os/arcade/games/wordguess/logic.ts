// Pure word guess rules: scoring with duplicate letters, keyboard states, the Pacific daily word. No DOM.

export type Mark = 'correct' | 'present' | 'absent';
export const WORD = 5;
export const TRIES = 6;

/** Splits a packed string of five-letter words. */
export function unpack(packed: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + WORD <= packed.length; i += WORD) out.push(packed.slice(i, i + WORD));
  return out;
}

/**
 * Colors a guess. Exact matches first, then each remaining letter is "present" only while the answer
 * still has an unmatched copy of it, so duplicates are never over-counted.
 */
export function score(guess: string, answer: string): Mark[] {
  const out: Mark[] = new Array(WORD).fill('absent');
  const left = new Map<string, number>();
  for (let i = 0; i < WORD; i++) {
    if (guess[i] === answer[i]) out[i] = 'correct';
    else left.set(answer[i], (left.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < WORD; i++) {
    if (out[i] === 'correct') continue;
    const n = left.get(guess[i]) ?? 0;
    if (n > 0) {
      out[i] = 'present';
      left.set(guess[i], n - 1);
    }
  }
  return out;
}

const rank: Record<Mark, number> = { absent: 1, present: 2, correct: 3 };

/** Best known state of every guessed letter, for the on-screen keyboard. */
export function letterStates(guesses: string[], answer: string): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const g of guesses) {
    const marks = score(g, answer);
    for (let i = 0; i < WORD; i++) {
      const prev = out[g[i]];
      if (!prev || rank[marks[i]] > rank[prev]) out[g[i]] = marks[i];
    }
  }
  return out;
}

function pacificParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute'), s: get('second') };
}

/** Today's date in California as YYYY-MM-DD. */
export function pacificDate(now: Date = new Date()): string {
  const { y, m, d } = pacificParts(now);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whole days since 2026-01-01 for a YYYY-MM-DD date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000);
}

/** Milliseconds until the next Pacific midnight. */
export function msUntilNextDay(now: Date = new Date()): number {
  const { h, min, s } = pacificParts(now);
  return (86400 - (h * 3600 + min * 60 + s)) * 1000 - now.getMilliseconds();
}

export function formatWait(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orders = new Map<number, number[]>();

/** Index of the daily answer: a fixed shuffle of the list, so consecutive days never repeat within a cycle. */
export function dailyIndex(day: number, count: number): number {
  let order = orders.get(count);
  if (!order) {
    const rand = mulberry32(0x6a6f7368);
    order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    orders.set(count, order);
  }
  return order[((day % count) + count) % count];
}

/** A random answer index for practice that is never today's daily word. */
export function practiceIndex(day: number, count: number, rand: () => number = Math.random): number {
  const skip = dailyIndex(day, count);
  const i = Math.floor(rand() * (count - 1));
  return i >= skip ? i + 1 : i;
}

export type Stats = { played: number; wins: number; streak: number; max: number; lastWin: number; dist: number[] };
export const emptyStats = (): Stats => ({ played: 0, wins: 0, streak: 0, max: 0, lastWin: -9999, dist: [0, 0, 0, 0, 0, 0] });

/** Daily stats after finishing `day` (won in `tries`, or lost when tries is 0). */
export function recordDaily(prev: Stats, day: number, tries: number): Stats {
  const s: Stats = { ...prev, dist: prev.dist.slice() };
  s.played++;
  if (tries > 0) {
    s.wins++;
    s.dist[tries - 1]++;
    s.streak = s.lastWin === day - 1 ? s.streak + 1 : 1;
    s.lastWin = day;
    s.max = Math.max(s.max, s.streak);
  } else s.streak = 0;
  return s;
}
