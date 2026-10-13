// Pure rules for Fishbowl: teams from the roster, who gives clues when, the bowl each round, skips, the leftover
// time a clue giver keeps when the bowl empties mid-turn, fixes from the review, and the final tally.
// No React or DOM, so the tests run it under plain node.
import { shuffle, type Rng } from '../../kit/party-core.ts';

/** Fewest players for two teams of two. */
export const MIN_PLAYERS = 4;
/** Longest slip a player can write. */
export const SLIP_MAX = 40;
/** Describe It, One Word, Act It Out. */
export const ROUNDS = 3;

export type TeamIndex = 0 | 1;
/** Seats (indexes into the roster) of each team, in seating order. */
export type Teams = [number[], number[]];

/** One slip pulled during a turn. `got` slips leave the bowl for the rest of that round; the rest go back in. */
export type Card = { slip: number; round: number; got: boolean; buzzer?: boolean };
export type Turn = { index: number; team: TeamIndex; giver: number; cards: Card[] };

export type Match = {
  /** How many slips are in the bowl; slips are numbered 0 to count - 1. */
  count: number;
  teams: Teams;
  /** The team that gives clues first. */
  first: TeamIndex;
  /** Finished turns. */
  turns: Turn[];
  /** The turn in progress. */
  cards: Card[];
  /** The slip in the clue giver's hand, if any. */
  slip: number | null;
  /** Seconds the clue giver kept when the bowl emptied mid-turn, until they play on. */
  carry: number | null;
};

export const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0);

/** Alternating seats: seat 0 joins the first team, seat 1 the second, seat 2 the first, and so on. */
export function buildTeams(players: number): Teams {
  const teams: Teams = [[], []];
  for (let seat = 0; seat < Math.max(0, Math.floor(players)); seat++) teams[(seat % 2) as TeamIndex].push(seat);
  return teams;
}

/** Teams alternate turns, starting with `first`. */
export const teamOf = (turn: number, first: TeamIndex): TeamIndex => ((first + turn) % 2) as TeamIndex;

/** Inside a team the clue giver moves through its members in seating order. */
export function giverOf(teams: Teams, turn: number, first: TeamIndex): number {
  const members = teams[teamOf(turn, first)];
  return members.length ? members[Math.floor(turn / 2) % members.length] : -1;
}

export const allCards = (turns: readonly Turn[], current: readonly Card[] = []): Card[] => [...turns.flatMap((t) => t.cards), ...current];

/** Slips guessed in a round. */
export function gotIn(cards: readonly Card[], round: number): Set<number> {
  const out = new Set<number>();
  for (const c of cards) if (c.got && c.round === round) out.add(c.slip);
  return out;
}

/** The round being played: the first one whose bowl still has slips. ROUNDS once the last bowl is empty. */
export function roundOf(count: number, cards: readonly Card[]): number {
  if (count <= 0) return ROUNDS;
  for (let r = 0; r < ROUNDS; r++) if (gotIn(cards, r).size < count) return r;
  return ROUNDS;
}

/** Slips still in the bowl in a round. */
export function bowlOf(count: number, cards: readonly Card[], round: number): number[] {
  const got = gotIn(cards, round);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!got.has(i)) out.push(i);
  return out;
}

/** Pulls a slip from the bowl. A skipped slip went back in, so it is avoided unless it is the only one left. */
export function draw(bowl: readonly number[], rng: Rng = Math.random, avoid?: number | null): number | undefined {
  const from = bowl.length > 1 && avoid != null ? bowl.filter((s) => s !== avoid) : bowl;
  return from.length ? from[Math.floor(rng() * from.length)] : undefined;
}

export function newMatch(count: number, teams: Teams, first: TeamIndex = 0): Match {
  return { count: Math.max(0, Math.floor(count)), teams, first, turns: [], cards: [], slip: null, carry: null };
}

export const cardsOf = (m: Match) => allCards(m.turns, m.cards);
export const roundNow = (m: Match) => roundOf(m.count, cardsOf(m));
export const bowlNow = (m: Match) => bowlOf(m.count, cardsOf(m), roundNow(m));
export const isOver = (m: Match) => roundNow(m) >= ROUNDS;
export const teamNow = (m: Match) => teamOf(m.turns.length, m.first);
export const giverNow = (m: Match) => giverOf(m.teams, m.turns.length, m.first);

/** Puts a slip from the current round's bowl in the clue giver's hand (and plays on with any carried time). */
export function deal(m: Match, rng: Rng = Math.random, avoid?: number | null): Match {
  if (isOver(m)) return { ...m, slip: null };
  const slip = draw(bowlNow(m), rng, avoid);
  return { ...m, slip: slip ?? null, carry: null };
}

export type Ended = 'none' | 'round' | 'game';

/**
 * The team guessed the slip in hand: it leaves the bowl and the next one comes out. When that empties the bowl the
 * round ends on the spot and the clue giver keeps `left` seconds for the next round (the classic rule).
 */
export function markGot(m: Match, left: number, rng: Rng = Math.random): { match: Match; ended: Ended } {
  if (m.slip === null) return { match: m, ended: 'none' };
  const round = roundNow(m);
  const next: Match = { ...m, cards: [...m.cards, { slip: m.slip, round, got: true }], slip: null };
  const now = roundNow(next);
  if (now === round) return { match: deal(next, rng), ended: 'none' };
  // The clock stops with `left` on it either way: a fix at the last break can reopen the round, and play goes on from there.
  return { match: { ...next, carry: Math.max(0, left) }, ended: now >= ROUNDS ? 'game' : 'round' };
}

/** Skipped: the slip goes back in the bowl and a different one comes out when there is one. */
export function markSkip(m: Match, rng: Rng = Math.random): Match {
  if (m.slip === null) return m;
  const round = roundNow(m);
  const skipped = m.slip;
  return deal({ ...m, cards: [...m.cards, { slip: skipped, round, got: false }], slip: null }, rng, skipped);
}

/** Time ran out with a slip in hand: it goes back in the bowl, marked so the review can credit a buzzer beater. */
export function buzz(m: Match): Match {
  if (m.slip === null) return m;
  return { ...m, cards: [...m.cards, { slip: m.slip, round: roundNow(m), got: false, buzzer: true }], slip: null };
}

/** Closes the turn in progress; the next team's next clue giver is up. */
export function endTurn(m: Match): Match {
  const turn: Turn = { index: m.turns.length, team: teamNow(m), giver: giverNow(m), cards: m.cards };
  return { ...m, turns: [...m.turns, turn], cards: [], slip: null, carry: null };
}

/** The same slips, a fresh game. The other team goes first this time. */
export const replay = (m: Match): Match => newMatch(m.count, m.teams, other(m.first));

export type Row = { slip: number; round: number; got: boolean; buzzer: boolean; skips: number };

/** One review row per slip pulled in a round of the current turn, in the order they first came out. */
export function reviewRows(cards: readonly Card[], round: number): Row[] {
  const rows = new Map<number, Row>();
  for (const c of cards) {
    if (c.round !== round) continue;
    const row = rows.get(c.slip) ?? { slip: c.slip, round, got: false, buzzer: false, skips: 0 };
    if (c.got) row.got = true;
    else if (c.buzzer) row.buzzer = true;
    else row.skips++;
    rows.set(c.slip, row);
  }
  return [...rows.values()];
}

/**
 * Flips a slip between guessed and back in the bowl (the review fixes mistakes with this). `taken` lists slips already
 * guessed in that round by earlier turns; those can't be guessed twice.
 */
export function toggleSlip(cards: readonly Card[], slip: number, round: number, taken: ReadonlySet<number> = new Set()): Card[] {
  const mine = cards.some((c) => c.slip === slip && c.round === round);
  if (!mine) return cards.slice();
  if (cards.some((c) => c.slip === slip && c.round === round && c.got)) return cards.map((c) => (c.slip === slip && c.round === round ? { ...c, got: false } : c));
  if (taken.has(slip)) return cards.slice();
  let last = -1;
  cards.forEach((c, i) => {
    if (c.slip === slip && c.round === round) last = i;
  });
  return cards.map((c, i) => (i === last ? { ...c, got: true } : c));
}

/** Applies a review fix to the turn in progress. */
export function fix(m: Match, slip: number, round: number): Match {
  return { ...m, cards: toggleSlip(m.cards, slip, round, gotIn(allCards(m.turns), round)) };
}

export const points = (cards: readonly Card[]) => cards.reduce((n, c) => n + (c.got ? 1 : 0), 0);

/** Points in each round a turn reached, in order. More than one entry when the bowl emptied mid-turn. */
export function pointsByRound(cards: readonly Card[]): { round: number; points: number }[] {
  const out = new Map<number, number>();
  for (const c of cards) out.set(c.round, (out.get(c.round) ?? 0) + (c.got ? 1 : 0));
  return [...out].sort((a, b) => a[0] - b[0]).map(([round, n]) => ({ round, points: n }));
}

/** Points by round, then by team: table[round][team]. Includes the turn in progress when `current` is given. */
export function scoreTable(turns: readonly Turn[], current?: { team: TeamIndex; cards: readonly Card[] }): [number, number][] {
  const table: [number, number][] = Array.from({ length: ROUNDS }, () => [0, 0] as [number, number]);
  const add = (team: TeamIndex, cards: readonly Card[]) => {
    for (const c of cards) if (c.got && c.round >= 0 && c.round < ROUNDS) table[c.round][team]++;
  };
  for (const t of turns) add(t.team, t.cards);
  if (current) add(current.team, current.cards);
  return table;
}

export function totals(table: readonly (readonly [number, number])[]): [number, number] {
  return table.reduce<[number, number]>((s, [a, b]) => [s[0] + a, s[1] + b], [0, 0]);
}

/** The team ahead, or null on a tie. */
export const leader = ([a, b]: readonly [number, number]): TeamIndex | null => (a === b ? null : a > b ? 0 : 1);

/** The turn with the most slips guessed (the earliest on a tie), or null when nobody scored. */
export function bestTurn(turns: readonly Turn[]): { turn: Turn; points: number } | null {
  let best: { turn: Turn; points: number } | null = null;
  for (const turn of turns) {
    const p = points(turn.cards);
    if (p > 0 && (!best || p > best.points)) best = { turn, points: p };
  }
  return best;
}

/** The slip skipped most often across the game (buzzers don't count), when one was skipped at least twice. */
export function toughest(turns: readonly Turn[]): { slip: number; skips: number } | null {
  const skips = new Map<number, number>();
  for (const c of allCards(turns)) if (!c.got && !c.buzzer) skips.set(c.slip, (skips.get(c.slip) ?? 0) + 1);
  let best: { slip: number; skips: number } | null = null;
  for (const [slip, n] of skips) if (n >= 2 && (!best || n > best.skips || (n === best.skips && slip < best.slip))) best = { slip, skips: n };
  return best;
}

/** How many built-in slips go in the bowl: four a player, between 20 and 40. */
export const bowlSize = (players: number) => Math.min(40, Math.max(20, Math.floor(players) * 4));

/** A random handful of the built-in list, no repeats. */
export function builtInSlips(list: readonly string[], count: number, rng: Rng = Math.random): string[] {
  const unique = [...new Map(list.map((s) => [s.toLocaleLowerCase(), s])).values()];
  return shuffle(unique, rng).slice(0, Math.max(0, Math.min(count, unique.length)));
}

/** How much of a built-in bowl comes from the 18+ list when After Dark is on. */
export const AFTER_DARK_SHARE = 0.5;

/**
 * The built-in bowl. With no `spicy` list it is exactly builtInSlips(classic). With After Dark on, half the slips
 * (rounded up) come from the 18+ list and the rest from the classic one, shuffled together.
 */
export function builtInBowl(classic: readonly string[], count: number, spicy: readonly string[] = [], rng: Rng = Math.random): string[] {
  if (!spicy.length) return builtInSlips(classic, count, rng);
  const hot = builtInSlips(spicy, Math.ceil(Math.max(0, count) * AFTER_DARK_SHARE), rng);
  const taken = new Set(hot.map((s) => s.toLocaleLowerCase()));
  const mild = builtInSlips(
    classic.filter((s) => !taken.has(s.toLocaleLowerCase())),
    count - hot.length,
    rng,
  );
  return shuffle([...hot, ...mild], rng);
}

/** Trims, folds whitespace, drops control characters and caps the length of a typed slip. */
export function tidySlip(raw: string): string {
  const clean = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, SLIP_MAX).join('').trim();
}

export type AddSlip = { ok: true; slips: string[] } | { ok: false; reason: string };

/** Adds a typed slip to one player's list, or says why it can't. */
export function addSlip(own: readonly string[], raw: string, max: number): AddSlip {
  if (own.length >= max) return { ok: false, reason: `That's ${max}. Pass it on.` };
  const slip = tidySlip(raw);
  if (!slip) return { ok: false, reason: 'Type a name first.' };
  if (own.some((s) => s.toLocaleLowerCase() === slip.toLocaleLowerCase())) return { ok: false, reason: 'You already wrote that one.' };
  return { ok: true, slips: [...own, slip] };
}

/** A bowl the group wrote, kept on this device so a reload or a Restart doesn't throw it away. */
export type SavedBowl = { slips: string[]; by: string[] };

/** Fewest slips worth keeping as a bowl. */
export const SAVED_MIN = 4;

/** Reads a stored bowl back, tidying every slip. Anything unusable comes back as null. */
export function parseBowl(raw: unknown): SavedBowl | null {
  if (!raw || typeof raw !== 'object') return null;
  const { slips, by } = raw as { slips?: unknown; by?: unknown };
  if (!Array.isArray(slips)) return null;
  const clean = slips.filter((s): s is string => typeof s === 'string').map(tidySlip).filter(Boolean).slice(0, 200);
  const names = Array.isArray(by) ? by.filter((s): s is string => typeof s === 'string' && s.trim() !== '').slice(0, 20) : [];
  return clean.length >= SAVED_MIN ? { slips: clean, by: names } : null;
}

/** Presses closer together than this (ms) are one burst. */
export const BURST_GAP = 600;
/** After a step has been up this long (ms), any press counts again: a safety valve, since people do pause. */
export const BURST_CAP = 8000;

/**
 * Taps and key presses come in bursts. A burst that began before a step appeared was meant for the step before (a
 * frantic Got It after the buzzer), so on the steps between turns it doesn't count until it stops for a moment.
 */
export class Bursts {
  private start = -Infinity;
  private last = -Infinity;
  /** A press at time `t` (ms). */
  note(t: number) {
    if (t - this.last > BURST_GAP) this.start = t;
    this.last = t;
  }
  /** Whether the latest press counts on a step that appeared at `since`, at time `now`. */
  fresh(since: number, now: number) {
    return this.start > since || now - since >= BURST_CAP;
  }
}
