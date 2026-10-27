import { CLUBS, clubById, clubOverall } from './teams.ts';
import { simulateShootout } from './shootout.ts';
import type { World } from './logic.ts';

export type CupMatch = { home: string; away: string; score?: [number, number]; pens?: [number, number] };
export type Cup = {
  v: 1;
  seed: number;
  user: string;
  rounds: CupMatch[][];
  round: 0 | 1 | 2 | 3;
  out: boolean;
  champion?: string;
};
export type CupSummary = { user: string; round: Cup['round']; out: boolean; champion?: string; rounds: CupMatch[][] };

export function matchOutcome(world: World): { score: [number, number]; pens?: [number, number] } | null {
  const shootout = world.shootout;
  if (shootout && !shootout.done) return null;
  const score: [number, number] = [...world.score];
  if (!shootout?.done) return { score };
  // Mirrors setpieces.ts shootoutScore/shootoutWinner from #256.
  const pens: [number, number] = [
    shootout.kicks[0].filter(Boolean).length,
    shootout.kicks[1].filter(Boolean).length,
  ];
  return { score, pens };
}

function randomFor(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function poisson(lambda: number, random: () => number) {
  const limit = Math.exp(-lambda);
  let product = 1, goals = 0;
  do {
    goals++;
    product *= random();
  } while (product > limit);
  return goals - 1;
}

function winner(match: CupMatch) {
  if (!match.score) return null;
  if (match.score[0] !== match.score[1]) return match.score[0] > match.score[1] ? match.home : match.away;
  if (!match.pens || match.pens[0] === match.pens[1]) return null;
  return match.pens[0] > match.pens[1] ? match.home : match.away;
}

function simulateResult(homeId: string, awayId: string, random: () => number): CupMatch {
  const home = clubById(homeId), away = clubById(awayId);
  const difference = clubOverall(home) - clubOverall(away);
  const score: [number, number] = [
    poisson(1.25 * 1.025 ** difference, random),
    poisson(1.25 * 1.025 ** -difference, random),
  ];
  const result: CupMatch = { home: homeId, away: awayId, score };
  if (score[0] === score[1]) {
    const { score: pens } = simulateShootout(Math.floor(random() * 0x1_0000_0000), home, away);
    result.pens = pens;
  }
  return result;
}

export function createCup(user: string, seed: number): Cup {
  const userId = clubById(user).id;
  const random = randomFor(seed);
  const others = shuffled(CLUBS.filter((club) => club.id !== userId).map((club) => club.id), random).slice(0, 7);
  const rounds: CupMatch[][] = [
    [
      { home: userId, away: others[0]! },
      { home: others[1]!, away: others[2]! },
      { home: others[3]!, away: others[4]! },
      { home: others[5]!, away: others[6]! },
    ],
    [],
    [],
  ];
  return { v: 1, seed: seed >>> 0, user: userId, rounds, round: 0, out: false };
}

export function userFixture(cup: Cup) {
  if (cup.out || cup.round === 3) return null;
  const matches = cup.rounds[cup.round] ?? [];
  const match = matches.find((fixture) => fixture.home === cup.user || fixture.away === cup.user);
  if (!match) return null;
  const stage = cup.round === 0 ? 'quarter-final' : cup.round === 1 ? 'semi-final' : 'final';
  return { ...match, stage } as { home: string; away: string; stage: 'quarter-final' | 'semi-final' | 'final' };
}

export function recordUserResult(cup: Cup, score: [number, number], pens?: [number, number]): Cup {
  const fixture = userFixture(cup);
  if (!fixture) return structuredClone(cup);
  const next: Cup = structuredClone(cup);
  const matches = next.rounds[next.round]!;
  const index = matches.findIndex((match) => match.home === cup.user || match.away === cup.user);
  const userMatch: CupMatch = { home: fixture.home, away: fixture.away, score: [...score] };
  if (score[0] === score[1]) {
    const shootout = pens ?? simulateShootout(cup.seed + cup.round * 7919, clubById(fixture.home), clubById(fixture.away)).score;
    userMatch.pens = [...shootout];
  }
  matches[index] = userMatch;
  const random = randomFor(cup.seed ^ (cup.round + 1) * 0x9e3779b9);
  for (let i = 0; i < matches.length; i++) {
    if (i !== index && !matches[i]!.score) matches[i] = simulateResult(matches[i]!.home, matches[i]!.away, random);
  }
  if (winner(userMatch) !== cup.user) {
    next.out = true;
    next.round = 3;
    return next;
  }
  if (cup.round === 0) {
    const winners = matches.map(winner) as string[];
    next.rounds[1] = [
      { home: winners[0]!, away: winners[1]! },
      { home: winners[2]!, away: winners[3]! },
    ];
    next.round = 1;
  } else if (cup.round === 1) {
    const winners = matches.map(winner) as string[];
    next.rounds[2] = [{ home: winners[0]!, away: winners[1]! }];
    next.round = 2;
  } else {
    next.round = 3;
    next.champion = cup.user;
  }
  return next;
}

function validScore(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((score) => Number.isInteger(score) && score >= 0 && score <= 99);
}

function validCup(value: unknown): value is Cup {
  if (!value || typeof value !== 'object') return false;
  const cup = value as Partial<Cup>;
  if (cup.v !== 1 || !Number.isSafeInteger(cup.seed) || typeof cup.user !== 'string' || !CLUBS.some((club) => club.id === cup.user)
    || !Array.isArray(cup.rounds) || cup.rounds.length !== 3 || ![0, 1, 2, 3].includes(cup.round as number) || typeof cup.out !== 'boolean'
    || (cup.champion !== undefined && !CLUBS.some((club) => club.id === cup.champion))) return false;
  const lengths = cup.rounds.map((round) => Array.isArray(round) ? round.length : -1);
  const round = cup.round as Cup['round'];
  if (lengths[0] !== 4 || lengths[1] !== (round >= 1 && (round < 3 || lengths[1] === 2) ? 2 : 0)
    || lengths[2] !== (round >= 2 && (round < 3 || lengths[2] === 1) ? 1 : 0)) return false;
  const allMatches = cup.rounds.flat();
  if (!allMatches.every((match) => match && CLUBS.some((club) => club.id === match.home) && CLUBS.some((club) => club.id === match.away)
    && match.home !== match.away && (match.score === undefined || validScore(match.score))
    && (match.pens === undefined || validScore(match.pens)))) return false;
  const quarterfinalClubs = cup.rounds[0]!.flatMap((match) => [match.home, match.away]);
  return quarterfinalClubs.length === 8 && new Set(quarterfinalClubs).size === 8
    && cup.rounds[0]![0]!.home === cup.user
    && (!cup.out || cup.round === 3)
    && (cup.champion === undefined || cup.round === 3 && !cup.out);
}

export function loadCup(): Cup | null {
  try {
    const raw = globalThis.localStorage?.getItem('soccer:cup');
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validCup(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveCup(cup: Cup) {
  try {
    if (validCup(cup)) globalThis.localStorage?.setItem('soccer:cup', JSON.stringify(cup));
  } catch {}
}

export function clearCup() {
  try {
    globalThis.localStorage?.removeItem('soccer:cup');
  } catch {}
}

export function cupSummary(cup: Cup): CupSummary {
  return { user: cup.user, round: cup.round, out: cup.out, ...(cup.champion ? { champion: cup.champion } : {}), rounds: structuredClone(cup.rounds) };
}
