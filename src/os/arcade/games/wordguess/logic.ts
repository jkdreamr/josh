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

/** The streak as of `day`: a win today or yesterday keeps it alive, anything older has lapsed. */
export const currentStreak = (s: Stats, day: number): number => (s.lastWin >= day - 1 ? s.streak : 0);

/**
 * Hard Mode: every hint so far has to be used. Greens stay in their spot and golds appear somewhere.
 * Returns what the guess is missing, or null when it's allowed.
 */
export function hardModeMiss(guess: string, rows: string[], marks: Mark[][]): string | null {
  const need = new Map<string, number>();
  for (let r = 0; r < rows.length; r++) {
    const have = new Map<string, number>();
    for (let i = 0; i < WORD; i++) {
      const l = rows[r][i];
      if (marks[r][i] === 'correct' && guess[i] !== l) return `Spot ${i + 1} Must Be ${l.toUpperCase()}`;
      if (marks[r][i] !== 'absent') have.set(l, (have.get(l) ?? 0) + 1);
    }
    for (const [l, n] of have) need.set(l, Math.max(need.get(l) ?? 0, n));
  }
  for (const [l, n] of need) {
    let count = 0;
    for (const ch of guess) if (ch === l) count++;
    if (count < n) return `Guess Must Use ${l.toUpperCase()}`;
  }
  return null;
}

const SQUARE: Record<Mark, string> = { correct: '\u{1F7E9}', present: '\u{1F7E8}', absent: '\u2B1B' };

/** The spoiler-free result grid people paste into a chat. */
export function shareText(day: number, rows: string[], answer: string, hard = false): string {
  const solved = rows.includes(answer);
  const head = `Word Guess ${day + 1} ${solved ? rows.length : 'X'}/${TRIES}${hard ? '*' : ''}`;
  return [head, '', ...rows.map((g) => score(g, answer).map((m) => SQUARE[m]).join(''))].join('\n');
}

/** Board tile size that fits a w by h box, with room for the gaps and a little air. */
export const tileFit = (w: number, h: number, cap: number) => Math.max(0, Math.floor(Math.min((w - 8) / (WORD + 0.48), (h - 8) / (TRIES + 0.6), cap)));

export type Layout = { side: boolean; modesRow: boolean; boardW: number; tile: number };

/**
 * Stacked (board over keyboard) or side by side (board left, keyboard right) for a w by h game area.
 * Side by side wins on short, wide areas like the framed laptop window, where stacking leaves a sliver of a board.
 * `top` is the height of the top band (mode switch and shell controls), `keysH` the stacked keyboard's height.
 */
export function pickLayout(w: number, h: number, o: { modesW: number; ctrlW: number; top: number; keysH: number; cap: number; minKeys?: number }): Layout {
  const modesRow = w - 20 < o.modesW + o.ctrlW + 12;
  const stackTop = o.top + (modesRow ? o.top - 8 : 0);
  const stackTile = tileFit(w - 16, h - stackTop - o.keysH - 22, o.cap);
  // Beside the keyboard the board takes the full height, but leaves the panel room for the keys and the top row.
  const need = Math.max(o.modesW + o.ctrlW + 12, o.minKeys ?? 270);
  const sideTile = Math.min(tileFit(Infinity, h - 12, o.cap), tileFit(w - 30 - need, Infinity, o.cap));
  const boardW = Math.ceil(sideTile * (WORD + 0.48) + 8);
  if (sideTile >= 14 && sideTile > stackTile * 1.2) return { side: true, modesRow: false, boardW, tile: sideTile };
  return { side: false, modesRow, boardW: w, tile: stackTile };
}
