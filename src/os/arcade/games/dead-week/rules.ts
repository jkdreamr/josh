// The royale: lives, knockouts, the shared-fail rule and sudden death, who leads, and the ghosts' curse vote.
// Pure, so the host, the offline game and the tests all run the same rules.
import { mulberry32, mix } from './rng.ts';

export const LIVES = 4;
export const CURSES = ['quiz', 'flip', 'decoy'] as const;
export type Curse = (typeof CURSES)[number];
export const CURSE_NAMES: Record<Curse, string> = { quiz: 'pop quiz', flip: 'flipped', decoy: 'decoy' };
export const CURSE_NOTES: Record<Curse, string> = { quiz: 'screen shake', flip: 'mirrored', decoy: 'fake command first' };

export type Entry = { seat: number; name: string; bot: boolean };
export type Entrant = Entry & {
  lives: number;
  out: boolean;
  /** Finishing place once out (1 is the winner), shared by everyone knocked out by the same game. */
  place: number | null;
  /** Left the room mid-round. */
  left: boolean;
  /** Games this entrant passed. */
  passed: number;
};
export type Royale = {
  entrants: Entrant[];
  /** Games played so far; the next game is number n (from 0). */
  n: number;
  sudden: boolean;
  /** Winner's seat once the round is over (null for a solo run, or when the last players all left). */
  winner: number | null;
  over: boolean;
};
export type GameResult = {
  n: number;
  /** seat -> passed */
  passed: Map<number, boolean>;
  /** Every alive player failed: nobody lost a life and sudden death began (or went on). */
  shared: boolean;
  lost: number[];
  eliminated: number[];
};

export function createRoyale(entries: readonly Entry[]): Royale {
  return {
    entrants: entries.map((e) => ({ ...e, lives: LIVES, out: false, place: null, left: false, passed: 0 })),
    n: 0,
    sudden: false,
    winner: null,
    over: false,
  };
}

export const alive = (r: Royale) => r.entrants.filter((e) => !e.out);
export const entrant = (r: Royale, seat: number) => r.entrants.find((e) => e.seat === seat);

/** Seats with the most lives among those still in; ties are all of them. Nobody when one or none are left. */
export function leaders(r: Royale): number[] {
  const live = alive(r);
  if (live.length < 2) return [];
  const top = Math.max(...live.map((e) => e.lives));
  return live.filter((e) => e.lives === top).map((e) => e.seat);
}

function knockOut(r: Royale, seats: number[]) {
  if (!seats.length) return;
  const place = alive(r).length - seats.length + 1;
  for (const seat of seats) {
    const e = entrant(r, seat);
    if (!e || e.out) continue;
    e.out = true;
    e.lives = 0;
    e.place = place;
  }
}

function settle(r: Royale) {
  const live = alive(r);
  const solo = r.entrants.length === 1;
  if (solo ? live.length === 0 : live.length <= 1) {
    r.over = true;
    r.winner = !solo && live.length === 1 ? live[0].seat : null;
    if (r.winner !== null) live[0].place = 1;
  }
}

/**
 * Applies one game's results. A seat missing from `results` failed. With two or more still in, if every one of them
 * failed nobody loses a life and the round goes to sudden death: then the next failure that isn't shared by all
 * knocks the player out outright, and sudden death ends.
 */
export function resolveGame(r: Royale, results: ReadonlyMap<number, boolean>): GameResult {
  const n = r.n;
  const live = alive(r);
  const passed = new Map<number, boolean>();
  for (const e of live) passed.set(e.seat, results.get(e.seat) === true);
  const failers = live.filter((e) => !passed.get(e.seat));
  for (const e of live) if (passed.get(e.seat)) e.passed++;
  const out: GameResult = { n, passed, shared: false, lost: [], eliminated: [] };
  r.n++;
  if (r.over) return out;
  if (live.length >= 2 && failers.length === live.length) {
    r.sudden = true;
    out.shared = true;
    return out;
  }
  const gone: number[] = [];
  for (const e of failers) {
    e.lives = r.sudden ? 0 : e.lives - 1;
    out.lost.push(e.seat);
    if (e.lives <= 0) gone.push(e.seat);
  }
  if (r.sudden && failers.length) r.sudden = false;
  knockOut(r, gone);
  out.eliminated = gone;
  settle(r);
  return out;
}

/** Someone left the room mid-round: out where they stand. */
export function leave(r: Royale, seat: number) {
  const e = entrant(r, seat);
  if (!e || e.out || r.over) return false;
  knockOut(r, [seat]);
  e.left = true;
  settle(r);
  return true;
}

/**
 * The ghosts' pick for the next game's curse: the most voted one. Bots' votes only count when no person voted, so
 * people decide. Ties are broken by the seed; no votes at all means no curse.
 */
export function tallyCurse(votes: ReadonlyMap<number, Curse>, bots: ReadonlySet<number>, seed: number): Curse | null {
  const count = (human: boolean) => {
    const c: Record<Curse, number> = { quiz: 0, flip: 0, decoy: 0 };
    let any = 0;
    for (const [seat, curse] of votes) {
      if (bots.has(seat) === human) continue;
      c[curse]++;
      any++;
    }
    return any ? c : null;
  };
  const c = count(true) ?? count(false);
  if (!c) return null;
  const top = Math.max(...CURSES.map((k) => c[k]));
  const tied = CURSES.filter((k) => c[k] === top);
  return tied[Math.floor(mulberry32(seed)() * tied.length)];
}

export const isCurse = (v: unknown): v is Curse => typeof v === 'string' && (CURSES as readonly string[]).includes(v);

/** A ghost bot's vote for game n: about half the time it votes, at random. */
export function botVote(seed: number, n: number, seat: number): Curse | null {
  const rng = mulberry32(mix(seed, n, seat, 77));
  if (rng() < 0.5) return null;
  return CURSES[Math.floor(rng() * CURSES.length)];
}
