// Pure rules for Spectrum: the dial runs from 0 (left extreme) to 180 degrees (right extreme).
// No React or DOM here, so tests run it under plain node.
import type { Rng } from '../../kit/party-core.ts';

export type Mode = 'teams' | 'together';
export type Side = 'left' | 'right';
export type Team = 0 | 1;
export type Points = 0 | 2 | 3 | 4;

/** The dial's full sweep in degrees. */
export const DIAL = 180;
/** Width of one scoring band in degrees. */
export const BAND = 7;
/** Half the width of all five bands together (2, 3, 4, 3, 2), so the target sits at least this far from either end. */
export const SPAN = BAND * 2.5;
/** Where the needle rests before the group moves it. */
export const NEEDLE_START = DIAL / 2;

/** Together mode deals this many cards, for a score out of TOGETHER_MAX. */
export const TOGETHER_CARDS = 7;
export const TOGETHER_MAX = TOGETHER_CARDS * 4;

export const GOALS = [10, 15] as const;
export const MIN_PLAYERS: Record<Mode, number> = { teams: 4, together: 2 };

export const clampDial = (v: number) => Math.min(DIAL, Math.max(0, Number.isFinite(v) ? v : NEEDLE_START));

/** A random target whose bands all fit on the dial, rounded to half a degree. */
export function randomTarget(rng: Rng = Math.random): number {
  return Math.round((SPAN + rng() * (DIAL - 2 * SPAN)) * 2) / 2;
}

/** Points for a needle against a target: 4 in the middle band, 3 next to it, 2 on the outside, 0 beyond. */
export function scoreGuess(target: number, needle: number): Points {
  const d = Math.abs(target - needle);
  if (d <= BAND / 2) return 4;
  if (d <= BAND * 1.5) return 3;
  if (d <= BAND * 2.5) return 2;
  return 0;
}

export type Band = { from: number; to: number; points: Exclude<Points, 0> };

/** The five scoring bands around a target, left to right, for drawing. */
export function bandsAround(target: number): Band[] {
  const pts: Band['points'][] = [2, 3, 4, 3, 2];
  const start = target - SPAN;
  return pts.map((points, i) => ({ from: start + i * BAND, to: start + (i + 1) * BAND, points }));
}

/** Which side of the needle the target is on, or null when the needle sits exactly on it. */
export function sideOf(target: number, needle: number): Side | null {
  if (target === needle) return null;
  return target < needle ? 'left' : 'right';
}

/**
 * The other team's left or right call is worth 1 point when it's correct, except when the guessing team
 * hit the bullseye: then there was nothing to call.
 */
export function callPoints(target: number, needle: number, call: Side): 0 | 1 {
  if (scoreGuess(target, needle) === 4) return 0;
  return sideOf(target, needle) === call ? 1 : 0;
}

/** Teams from the seating order: alternate seats, so neighbors play against each other. */
export function makeTeams(players: number): [number[], number[]] {
  const teams: [number[], number[]] = [[], []];
  for (let i = 0; i < players; i++) teams[i % 2].push(i);
  return teams;
}

export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);

/**
 * Who reads the card on a given turn (0 based). Together: everyone in seating order from `first`.
 * Teams: the teams alternate, starting with team `first`, and each rotates through its own players.
 */
export function psychicFor(mode: Mode, players: number, turn: number, first = 0): { seat: number; team: Team } {
  if (players <= 0) return { seat: 0, team: 0 };
  if (mode === 'together') return { seat: (((first + turn) % players) + players) % players, team: 0 };
  const teams = makeTeams(players);
  const team = ((first + turn) % 2) as Team;
  const members = teams[team].length ? teams[team] : teams[otherTeam(team)];
  return { seat: members[Math.floor(turn / 2) % members.length], team };
}

/** The team that goes second starts a point up, to make up for going second. */
export function startScores(first: Team): [number, number] {
  return first === 0 ? [0, 1] : [1, 0];
}

/** The team that reached the goal with more points, or null while nobody has (or both did and they're tied). */
export function winner(scores: readonly [number, number], goal: number): Team | null {
  const [a, b] = scores;
  if (Math.max(a, b) < goal || a === b) return null;
  return a > b ? 0 : 1;
}

/** Adds a turn's points to the scores without changing the old array. */
export function addPoints(scores: readonly [number, number], team: Team, points: number, callTeamPoints = 0): [number, number] {
  const next: [number, number] = [scores[0], scores[1]];
  next[team] += points;
  next[otherTeam(team)] += callTeamPoints;
  return next;
}

/** Together mode is over after TOGETHER_CARDS turns. */
export const togetherDone = (turnsPlayed: number) => turnsPlayed >= TOGETHER_CARDS;

/** A playful line for a Together total out of 28. */
export function rating(total: number): string {
  if (total >= 26) return 'Mind meld. Are you sharing one brain?';
  if (total >= 21) return 'Spooky good. You finish each other\'s sentences.';
  if (total >= 16) return 'Solid. You mostly see the world the same way.';
  if (total >= 11) return 'Not bad. Some of you are on the same page.';
  if (total >= 6) return 'Hmm. Did you all read different books?';
  return 'Total chaos. Strangers at a bus stop would do better.';
}

/** A title for the reveal, by points scored. */
export function verdict(points: Points): string {
  if (points === 4) return 'Bullseye!';
  if (points === 3) return 'So Close';
  if (points === 2) return 'On the Board';
  return 'Missed It';
}
