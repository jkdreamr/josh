// The host's side of a round: schedules each game, gathers everyone's pass or fail, rolls the bots, applies the
// rules and the ghosts' curse, and says what to send. Pure and clock driven: online the clock is wall time (so a
// hidden host tab still runs the round), offline it's play time (so pausing stops it).
import { botPasses, skillOf } from './bots.ts';
import { microById } from './micro/index.ts';
import { commandTime, playTime, planGame, resultsTime, type Plan } from './plan.ts';
import { mix } from './rng.ts';
import { alive, botVote, createRoyale, leaders, leave, resolveGame, tallyCurse, type Curse, type Entry, type GameResult, type Royale } from './rules.ts';

export const INTRO = 2.2;
/** How long the host waits past the end of play for a slow report before counting it as a fail. */
export const GRACE = 2.5;

export type Standing = { s: number; l: number; p: number; b: 0 | 1; nm: string; x: 0 | 1 };
export type GamePacket = { n: number; seed: number; at: number; curse: Curse | null; cursed: number[]; sudden: boolean; st: Standing[] };
export type ResultPacket = { n: number; res: [number, 0 | 1][]; shared: boolean; lost: number[]; elim: number[]; st: Standing[]; sudden: boolean; over: boolean; winner: number | null };
export type Out = { k: 'G'; g: GamePacket } | { k: 'R'; r: ResultPacket };

export type Director = {
  seed: number;
  royale: Royale;
  phase: 'intro' | 'game' | 'results' | 'over';
  at: number;
  plan: Plan | null;
  deadline: number;
  reports: Map<number, boolean>;
  votes: Map<number, Curse>;
  curse: Curse | null;
  cursed: number[];
  last: GameResult | null;
};

export const durationOf = (id: string, tier: number) => microById.get(id)?.duration(tier) ?? 4;

export function createDirector(seed: number, entries: readonly Entry[], now: number): Director {
  return { seed, royale: createRoyale(entries), phase: 'intro', at: now, plan: null, deadline: 0, reports: new Map(), votes: new Map(), curse: null, cursed: [], last: null };
}

export function standings(r: Royale): Standing[] {
  return r.entrants.map((e) => ({ s: e.seat, l: e.lives, p: e.place ?? -1, b: e.bot ? 1 : 0, nm: e.name, x: e.left ? 1 : 0 }));
}

/** When play of the current game ends, on the director's clock. */
export function playEnd(d: Director) {
  if (!d.plan) return d.at;
  return d.at + commandTime(d.plan.tier, d.curse === 'decoy') + playTime(d.plan, durationOf);
}

const humansIn = (d: Director) => alive(d.royale).filter((e) => !e.bot);

function startGame(d: Director, now: number): Out {
  const r = d.royale;
  const bots = new Set(r.entrants.filter((e) => e.bot).map((e) => e.seat));
  // ghost bots cast their votes now; they only count if no person voted
  for (const e of r.entrants) {
    if (!e.out || !e.bot || e.left) continue;
    const v = botVote(d.seed, r.n, e.seat);
    if (v && !d.votes.has(e.seat)) d.votes.set(e.seat, v);
  }
  d.curse = tallyCurse(d.votes, bots, mix(d.seed, r.n, 11));
  d.cursed = d.curse ? leaders(r) : [];
  if (!d.cursed.length) d.curse = null;
  d.votes = new Map();
  d.reports = new Map();
  d.plan = planGame(d.seed, r.n);
  d.phase = 'game';
  d.at = now;
  d.deadline = playEnd(d) + GRACE;
  return { k: 'G', g: { n: r.n, seed: d.seed, at: d.at, curse: d.curse, cursed: d.cursed, sudden: r.sudden, st: standings(r) } };
}

function finishGame(d: Director, now: number): Out {
  const r = d.royale;
  const plan = d.plan!;
  const results = new Map<number, boolean>();
  for (const e of alive(r)) {
    if (e.bot) results.set(e.seat, botPasses(d.seed, plan.n, e.seat, skillOf(e.name, e.seat), plan.tier, plan.boss));
    else results.set(e.seat, d.reports.get(e.seat) === true);
  }
  const res = resolveGame(r, results);
  d.last = res;
  d.phase = 'results';
  d.at = now;
  return {
    k: 'R',
    r: {
      n: res.n,
      res: [...res.passed].map(([s, p]) => [s, p ? 1 : 0]),
      shared: res.shared,
      lost: res.lost,
      elim: res.eliminated,
      st: standings(r),
      sudden: r.sudden,
      over: r.over,
      winner: r.winner,
    },
  };
}

/** Advance to `now`. `present` is every person's seat still in the room (null offline: nobody leaves). */
export function tick(d: Director, now: number, present: ReadonlySet<number> | null): Out[] {
  const out: Out[] = [];
  if (present) for (const e of d.royale.entrants) if (!e.bot && !e.out && !present.has(e.seat)) leave(d.royale, e.seat);
  if (d.phase === 'intro' && now >= d.at + INTRO) out.push(startGame(d, now));
  else if (d.phase === 'game') {
    const everyone = humansIn(d).every((e) => d.reports.has(e.seat));
    if (d.royale.over || now >= d.deadline || (everyone && now >= playEnd(d) - 0.05) || (everyone && humansIn(d).length > 0 && allEarly(d))) out.push(finishGame(d, now));
  } else if (d.phase === 'results' && now >= d.at + resultsTime(d.plan?.tier ?? 0)) {
    if (d.royale.over) d.phase = 'over';
    else out.push(startGame(d, now));
  }
  return out;
}

/** Every person has reported a fail: no need to wait out the clock (bots' results are rolled, not played). */
function allEarly(d: Director) {
  const humans = humansIn(d);
  return humans.every((e) => d.reports.get(e.seat) === false) && alive(d.royale).every((e) => !e.bot);
}

export function report(d: Director, seat: number, n: number, passed: boolean) {
  if (d.phase !== 'game' || n !== d.royale.n || d.reports.has(seat)) return false;
  const e = alive(d.royale).find((x) => x.seat === seat && !x.bot);
  if (!e) return false;
  d.reports.set(seat, passed);
  return true;
}

/** A ghost's vote for the next game's curse, during the results beat (or the game before it). */
export function vote(d: Director, seat: number, curse: Curse) {
  const e = d.royale.entrants.find((x) => x.seat === seat);
  if (!e || !e.out || e.left || d.royale.over) return false;
  d.votes.set(seat, curse);
  return true;
}

export function voteCounts(d: Director): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  for (const v of d.votes.values()) c[v === 'quiz' ? 0 : v === 'flip' ? 1 : 2]++;
  return c;
}
