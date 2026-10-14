import { PASSAGES } from './passages.ts';

export { PASSAGES };

/** Race length shown on the course. A passage maps onto it, so half the text typed is 1000 m rowed. */
export const COURSE_METERS = 2000;
/** An eight is about 18 m long, which is how the cox counts lengths and seats. */
export const BOAT_METERS = 18;
export const SEAT_METERS = BOAT_METERS / 8;
/** Sit ready, then attention, then go. */
export const ATTENTION_MS = 1500;
export const COUNTDOWN_MS = 3000;
/** A racer who types nothing for this long is treated as done, so one idle player cannot hold up the room. */
export const STALL_MS = 30_000;
export const MAX_RACE_MS = 240_000;
export const MAX_RACERS = 8;
export const BOTS = 4;

// ---------------------------------------------------------------------------------------------------------------
// Random

/** Small seeded generator (mulberry32) so bot races are reproducible in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A passage index, avoiding the ones raced most recently when possible. */
export function pickPassage(rand: () => number, recent: readonly number[] = []): number {
  const fresh = PASSAGES.map((_, i) => i).filter((i) => !recent.includes(i));
  const pool = fresh.length ? fresh : PASSAGES.map((_, i) => i);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

// ---------------------------------------------------------------------------------------------------------------
// Typing

export type Typing = {
  text: string;
  /** Index of the next character to type. */
  pos: number;
  errors: number;
  /** Words completed in a row without a mistake. */
  streak: number;
  /** True when a mistake happened inside the current word. */
  slipped: boolean;
};

export type KeyResult = 'hit' | 'miss' | 'done' | 'skip';

export function createTyping(text: string): Typing {
  return { text, pos: 0, errors: 0, streak: 0, slipped: false };
}

/** Phone keyboards send curly quotes and non-breaking spaces; the passages use plain ASCII. */
export function normalizeKey(key: string): string {
  if (key === '‘' || key === '’' || key === 'ʼ') return "'";
  if (key === '“' || key === '”') return '"';
  if (key === ' ') return ' ';
  return key;
}

/**
 * Applies one typed character. A correct key moves the cursor on; a wrong key counts an error and leaves the cursor
 * where it is, so the boat stalls until the right key is hit.
 */
export function typeKey(t: Typing, raw: string): KeyResult {
  if (t.pos >= t.text.length || raw.length !== 1) return 'skip';
  const key = normalizeKey(raw);
  if (key !== t.text[t.pos]) {
    t.errors++;
    t.streak = 0;
    t.slipped = true;
    return 'miss';
  }
  t.pos++;
  if (key === ' ' || t.pos === t.text.length) {
    if (t.slipped) t.slipped = false;
    else t.streak++;
  }
  return t.pos === t.text.length ? 'done' : 'hit';
}

/** The current word as [start, end), including a trailing space when the cursor sits on it. */
export function wordAt(text: string, pos: number): [number, number] {
  if (pos >= text.length) return [text.length, text.length];
  const start = text.lastIndexOf(' ', pos - 1) + 1;
  if (text[pos] === ' ') return [start, pos + 1];
  const end = text.indexOf(' ', pos);
  return [start, end < 0 ? text.length : end];
}

// ---------------------------------------------------------------------------------------------------------------
// Stats

/** Words per minute with the usual five characters per word. */
export function wpm(chars: number, ms: number): number {
  return ms <= 0 || chars <= 0 ? 0 : chars / 5 / (ms / 60_000);
}

export function accuracy(correct: number, errors: number): number {
  return correct + errors <= 0 ? 1 : correct / (correct + errors);
}

/** Strokes per minute for a typing speed, so faster typists row at a higher rate. */
export function strokeRate(speed: number): number {
  return Math.max(20, Math.min(46, 18 + speed * 0.26));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** How a cox calls a margin: a bow ball, seats, or lengths. */
export function marginText(meters: number): string {
  const m = Math.abs(meters);
  if (m >= BOAT_METERS * 0.75) {
    const lengths = Math.round((m / BOAT_METERS) * 2) / 2;
    return `${lengths} length${lengths === 1 ? '' : 's'}`;
  }
  const seats = Math.round(m / SEAT_METERS);
  if (seats < 1) return 'a bow ball';
  return seats === 1 ? 'a seat' : `${seats} seats`;
}

// ---------------------------------------------------------------------------------------------------------------
// Crews and bots

export type Crew = { name: string; hull: string; blade: string; tip: string };

export const YOU_CREW: Crew = { name: 'stanford', hull: '#8c1515', blade: '#b1040e', tip: '#ffffff' };

export const RIVALS: readonly Crew[] = [
  { name: 'cal', hull: '#003262', blade: '#003262', tip: '#fdb515' },
  { name: 'washington', hull: '#4b2e83', blade: '#4b2e83', tip: '#e8d3a2' },
  { name: 'princeton', hull: '#1d1d1f', blade: '#e77500', tip: '#1d1d1f' },
  { name: 'yale', hull: '#00356b', blade: '#ffffff', tip: '#00356b' },
  { name: 'navy', hull: '#12284b', blade: '#c5b783', tip: '#12284b' },
  { name: 'oxford', hull: '#002147', blade: '#5b8fd0', tip: '#ffffff' },
];

/** Colors for online crews, by seat. Your own boat is always cardinal. */
export const SEAT_CREWS: readonly Crew[] = [
  { name: '', hull: '#1f6feb', blade: '#58a6ff', tip: '#ffffff' },
  { name: '', hull: '#c69214', blade: '#ffd33d', tip: '#1d1d1f' },
  { name: '', hull: '#6e40c9', blade: '#bc8cff', tip: '#ffffff' },
  { name: '', hull: '#1a7f37', blade: '#56d364', tip: '#ffffff' },
  { name: '', hull: '#bc4c00', blade: '#ff8a3d', tip: '#ffffff' },
  { name: '', hull: '#0e7c86', blade: '#39d0d8', tip: '#ffffff' },
  { name: '', hull: '#bf3989', blade: '#ff7ab8', tip: '#ffffff' },
  { name: '', hull: '#57606a', blade: '#c9d1d9', tip: '#1d1d1f' },
];

export const RIVAL_LEVELS = ['novice', 'club', 'varsity', 'olympic'] as const;
export type RivalLevel = (typeof RIVAL_LEVELS)[number];
export const RIVAL_LABELS: Record<RivalLevel, string> = { novice: 'Novice', club: 'Club', varsity: 'Varsity', olympic: 'Olympic' };
/** Typing speed range (wpm) of the rival crews at each level. */
export const RIVAL_WPM: Record<RivalLevel, readonly [number, number]> = {
  novice: [30, 50],
  club: [50, 75],
  varsity: [75, 105],
  olympic: [105, 145],
};
/** Where the four crews sit in the level's range: a pack near the top, so the leader is always quick. */
const FIELD = [0.35, 0.6, 0.8, 0.97];

/** Four rival crews for a solo race, packed toward the top of the level's speed range, slowest first. */
export function rivalField(level: RivalLevel, rand: () => number, count = BOTS): { crew: Crew; wpm: number }[] {
  const [lo, hi] = RIVAL_WPM[level];
  const crews = [...RIVALS];
  for (let i = crews.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [crews[i], crews[j]] = [crews[j], crews[i]];
  }
  return Array.from({ length: count }, (_, i) => {
    const at = FIELD[Math.min(FIELD.length - 1, Math.round((i * (FIELD.length - 1)) / Math.max(1, count - 1)))];
    return { crew: crews[i % crews.length], wpm: Math.round(lo + (hi - lo) * Math.min(1, at + (rand() - 0.5) * 0.06)) };
  });
}

/** Crews for online bots, one per bot in seat order: the solo rivals and one more, enough to fill a room of eight. */
export const BOT_CREWS: readonly Crew[] = [...RIVALS, { name: 'dartmouth', hull: '#00693e', blade: '#00693e', tip: '#ffffff' }];

/** Speeds for a room's bots at a level: the rival field's spread, dealt out in random order. */
export function botSpeeds(level: RivalLevel, count: number, rand: () => number): number[] {
  const speeds = rivalField(level, rand, count).map((rival) => rival.wpm);
  for (let i = speeds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [speeds[i], speeds[j]] = [speeds[j], speeds[i]];
  }
  return speeds;
}

/** Most a rival can lift its pace when it is behind you. */
export const CATCH_UP_MAX = 0.08;

/**
 * Pace lift for a rival that is behind you, from how far back it is (a share of the course).
 * Rivals never slow down when they lead; they only push harder to stay in touch.
 */
export function catchUp(behind: number): number {
  return 1 + Math.max(0, Math.min(CATCH_UP_MAX, behind * 0.5));
}

/** Race plan: a quick start, a settle through the middle, and a sprint over the last stretch. */
export function racePace(progress: number): number {
  if (progress < 0.08) return 1.06;
  if (progress > 0.85) return 1.07;
  return 0.985;
}

export type Bot = { wpm: number; chars: number; doneMs: number | null; wait: number; rand: () => number };

const HESITATE = 0.08;
const HESITATE_S = [0.15, 0.45] as const;
const SLIP = 0.02;
const SLIP_S = [0.25, 0.5] as const;

/** Average extra time per character from hesitations and slips, taken out of the base pace so bots hit their wpm. */
function overhead(text: string): number {
  const spaces = (text.match(/ /g)?.length ?? 0) / Math.max(1, text.length);
  return spaces * HESITATE * ((HESITATE_S[0] + HESITATE_S[1]) / 2) + SLIP * ((SLIP_S[0] + SLIP_S[1]) / 2);
}

export function createBot(speed: number, rand: () => number): Bot {
  return { wpm: speed, chars: 0, doneMs: null, wait: 0.25 + rand() * 0.4, rand };
}

/**
 * Advances a bot by dt seconds. raceMs is the race clock at the end of the step, used to stamp the finish.
 * boost multiplies its pace on top of the race plan (see catchUp).
 */
export function stepBot(bot: Bot, text: string, dt: number, raceMs: number, boost = 1): void {
  if (bot.doneMs !== null) return;
  const base = Math.max(0.02, 60 / (bot.wpm * 5) - overhead(text)) / (racePace(bot.chars / Math.max(1, text.length)) * boost);
  bot.wait -= dt;
  while (bot.wait <= 0 && bot.doneMs === null) {
    bot.chars++;
    if (bot.chars >= text.length) {
      bot.chars = text.length;
      bot.doneMs = Math.max(0, raceMs + bot.wait * 1000);
      return;
    }
    let next = base * (0.75 + bot.rand() * 0.5);
    if (text[bot.chars] === ' ' && bot.rand() < HESITATE) next += HESITATE_S[0] + bot.rand() * (HESITATE_S[1] - HESITATE_S[0]);
    if (bot.rand() < SLIP) next += SLIP_S[0] + bot.rand() * (SLIP_S[1] - SLIP_S[0]);
    bot.wait += next;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Standings

export type Standing = { chars: number; doneMs: number | null; out?: boolean };

/** Finishers by time, then everyone still racing by distance, then anyone who left. Stable for ties. */
export function rank<T extends Standing>(list: readonly T[]): T[] {
  const group = (s: T) => (s.doneMs !== null ? 0 : s.out ? 2 : 1);
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ga = group(a.s);
      const gb = group(b.s);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return a.s.doneMs! - b.s.doneMs! || a.i - b.i;
      return b.s.chars - a.s.chars || a.i - b.i;
    })
    .map(({ s }) => s);
}

export type RaceEntry = Standing & { lastMoveMs: number };

/** The host ends a race once every boat has finished, left, or gone idle, or when the race runs too long. */
export function raceOver(entries: readonly RaceEntry[], raceMs: number): boolean {
  if (raceMs >= MAX_RACE_MS) return true;
  return entries.every((e) => e.doneMs !== null || e.out || raceMs - e.lastMoveMs >= STALL_MS);
}

// ---------------------------------------------------------------------------------------------------------------
// Online messages. The host owns the race and broadcasts it; everyone else sends their own progress to the host.

export type NetRacer = { seat: number; chars: number; errors: number; doneMs: number | null; out: boolean };
export type RaceMessage = {
  /** Room round, so packets from an earlier race are ignored. */
  r: number;
  /** Sequence number; the fast channel may reorder packets. */
  s: number;
  /** Passage index. */
  p: number;
  /** Milliseconds until go, from the host's clock when sent. */
  go: number;
  /** Milliseconds since go (negative before it). */
  el: number;
  end: boolean;
  rs: NetRacer[];
};
export type ProgressMessage = { r: number; c: number; e: number; d: number | null };

const KIND = 'coxbox';
const MAX_CHARS = 1000;
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function encodeRace(m: RaceMessage) {
  return {
    k: KIND,
    t: 'race',
    r: m.r,
    s: m.s,
    p: m.p,
    go: Math.round(m.go),
    el: Math.round(m.el),
    end: m.end ? 1 : 0,
    rs: m.rs.map((x) => [x.seat, x.chars, x.errors, x.doneMs === null ? -1 : Math.round(x.doneMs), x.out ? 1 : 0]),
  };
}

export function parseRace(d: unknown): RaceMessage | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  if (m.k !== KIND || m.t !== 'race') return null;
  if (!isInt(m.r, 0, Number.MAX_SAFE_INTEGER) || !isInt(m.s, 0, Number.MAX_SAFE_INTEGER) || !isInt(m.p, 0, PASSAGES.length - 1)) return null;
  if (!isNum(m.go, 0, 60_000) || !isNum(m.el, -60_000, MAX_RACE_MS * 2) || (m.end !== 0 && m.end !== 1)) return null;
  if (!Array.isArray(m.rs) || m.rs.length > MAX_RACERS) return null;
  const rs: NetRacer[] = [];
  for (const row of m.rs) {
    if (!Array.isArray(row) || row.length !== 5) return null;
    const [seat, chars, errors, done, out] = row;
    if (!isInt(seat, 0, MAX_RACERS - 1) || !isInt(chars, 0, MAX_CHARS) || !isInt(errors, 0, 1_000_000)) return null;
    if (!(done === -1 || isNum(done, 0, MAX_RACE_MS * 2)) || (out !== 0 && out !== 1)) return null;
    if (rs.some((x) => x.seat === seat)) return null;
    rs.push({ seat, chars, errors, doneMs: done === -1 ? null : done, out: out === 1 });
  }
  return { r: m.r, s: m.s, p: m.p, go: m.go, el: m.el, end: m.end === 1, rs };
}

export function encodeProgress(m: ProgressMessage) {
  return { k: KIND, t: 'prog', r: m.r, c: m.c, e: m.e, d: m.d === null ? -1 : Math.round(m.d) };
}

export function parseProgress(d: unknown): ProgressMessage | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  if (m.k !== KIND || m.t !== 'prog') return null;
  if (!isInt(m.r, 0, Number.MAX_SAFE_INTEGER) || !isInt(m.c, 0, MAX_CHARS) || !isInt(m.e, 0, 1_000_000)) return null;
  if (!(m.d === -1 || isNum(m.d, 0, MAX_RACE_MS * 2))) return null;
  return { r: m.r, c: m.c, e: m.e, d: m.d === -1 ? null : (m.d as number) };
}

/**
 * Applies a racer's own report on the host. Progress only moves forward, and a finish only counts with the whole
 * passage typed. Returns true when anything changed.
 */
export function applyProgress(racer: NetRacer & { lastMoveMs: number }, m: ProgressMessage, length: number, raceMs: number): boolean {
  if (racer.out || racer.doneMs !== null) return false;
  const chars = Math.min(length, m.c);
  let changed = false;
  if (chars > racer.chars) {
    racer.chars = chars;
    racer.lastMoveMs = raceMs;
    changed = true;
  }
  if (m.e > racer.errors) {
    racer.errors = m.e;
    changed = true;
  }
  if (m.d !== null && racer.chars >= length) {
    racer.doneMs = m.d;
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------------------------
// Cox calls

export const CALLS = {
  sit: 'sit ready',
  attention: 'attention',
  go: 'go! high five, send it',
  settle: 'settle in two. long and strong',
  half: 'halfway. races are won right here',
  build: 'last 500. start the build',
  sprint: 'sprint! up two, empty the tank',
  power: ['power ten, go!', "that's ten clean, keep it coming", 'ten for the crew. push!'],
  crab: ['caught a crab? shake it off', 'clean catches. stay together', 'reset. next stroke'],
  idle: "don't stop rowing!",
  lead: "we've got the lead. keep walking",
  wait: 'waiting on the host…',
} as const;

export function walkCall(name: string, meters: number) {
  return `up ${marginText(meters)} on ${name}. again!`;
}

export function chaseCall(name: string, meters: number) {
  return `${name} has ${marginText(meters)}. go get them`;
}

export function finishCall(place: number) {
  return place === 1 ? 'weigh enough. we won it!' : `weigh enough. ${ordinal(place)}, nice row`;
}
