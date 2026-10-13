// Pure rules for Charades: teams from the shared roster, who acts when, the style of each turn, scoring and the end.
import { DECKS, DECK_IDS, type DeckId } from './words.ts';

/** Fewest players for two teams of two. */
export const MIN_PLAYERS = 4;

export type Style = 'act' | 'describe' | 'mix';
export type TurnStyle = 'act' | 'describe';
export type TeamIndex = 0 | 1;
/** Seats (indexes into the roster) of each team, in seating order. */
export type Teams = [number[], number[]];

export type Entry = { word: string; deck: DeckId };
/** One word dealt during a turn. `buzzer` marks the word still on screen when time ran out. */
export type Card = { word: string; got: boolean; buzzer?: boolean };

export type Turn = {
  /** 0-based turn number across the whole game. */
  index: number;
  team: TeamIndex;
  /** 1-based round; a round is one turn for each team. */
  round: number;
  /** Seat of the player acting or describing. */
  actor: number;
  style: TurnStyle;
};
export type Played = Turn & { cards: Card[]; points: number };

export const canStart = (players: number) => players >= MIN_PLAYERS;

/** Alternating seats: seat 0 joins Team 1, seat 1 Team 2, seat 2 Team 1, and so on. */
export function buildTeams(players: number): Teams {
  const teams: Teams = [[], []];
  for (let seat = 0; seat < Math.max(0, Math.floor(players)); seat++) teams[(seat % 2) as TeamIndex].push(seat);
  return teams;
}

/** Mix plays the same style for both teams in a round and switches every round, so each team alternates. */
export function styleFor(style: Style, turn: number): TurnStyle {
  if (style !== 'mix') return style;
  return Math.floor(turn / 2) % 2 === 0 ? 'act' : 'describe';
}

/**
 * Who starts a game and how far each team's actor rotation has already moved. Play Again hands the first turn to the
 * other team and carries the rotation on, so the same person doesn't open every game.
 */
export type Order = { first: TeamIndex; skip: readonly [number, number] };
export const FIRST_GAME: Order = { first: 0, skip: [0, 0] };

/** Teams take turns; inside a team the actor moves through its members in seating order. */
export function turnAt(index: number, teams: Teams, style: Style, order: Order = FIRST_GAME): Turn {
  const team = ((index + order.first) % 2) as TeamIndex;
  const own = Math.floor(index / 2);
  const members = teams[team];
  const at = own + Math.max(0, Math.floor(order.skip[team]));
  return { index, team, round: own + 1, actor: members.length ? members[at % members.length] : -1, style: styleFor(style, index) };
}

/** The order for the next game: the other team opens, and each team's next actor is whoever was due. */
export function nextOrder(order: Order, history: readonly Played[]): Order {
  const skip: [number, number] = [order.skip[0], order.skip[1]];
  for (const t of history) skip[t.team]++;
  return { first: other(order.first), skip };
}

export const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0);

/** The Rounds choice: a fixed count, Everyone Once, or Auto (the default, shown as 5 or Everyone Once). */
export type RoundsSetting = 'auto' | '3' | '5' | '8' | 'all';
export const DEFAULT_ROUNDS = 5;

/** Rounds for everyone to act once: one per member of the bigger team. */
export const everyoneOnce = (players: number) => Math.max(1, buildTeams(players)[0].length);

/**
 * Rounds in a game. Everyone Once gives each member of the bigger team a turn, so nobody sits out; Auto plays five
 * rounds, stretched to Everyone Once when a team has more than five people (eleven players or more).
 */
export function roundsFor(setting: string, players: number): number {
  if (setting === 'all') return everyoneOnce(players);
  if (setting === 'auto') return Math.max(DEFAULT_ROUNDS, everyoneOnce(players));
  const n = Math.floor(Number(setting));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_ROUNDS;
}

/** The choice the Rounds control shows as picked: Auto reads as 5, or as Everyone Once once that is longer. */
export function shownRounds(setting: RoundsSetting, players: number): Exclude<RoundsSetting, 'auto'> {
  if (setting !== 'auto') return setting;
  return everyoneOnce(players) > DEFAULT_ROUNDS ? 'all' : '5';
}

/** How many players never act in one game of `rounds` rounds (each team has that many turns). */
export function sittingOut(players: number, rounds: number): number {
  const turns = Math.max(0, Math.floor(rounds));
  return buildTeams(players).reduce((n, team) => n + Math.max(0, team.length - turns), 0);
}

export const totalTurns = (rounds: number) => Math.max(1, Math.floor(rounds)) * 2;
export const isOver = (played: number, rounds: number) => played >= totalTurns(rounds);
export const isLastTurn = (index: number, rounds: number) => index >= totalTurns(rounds) - 1;

/** "Round 2 of 5", "Last round", or "Tiebreaker" (then "Tiebreaker 2") once a tied game plays past its rounds. */
export function roundLabel(round: number, rounds: number): string {
  if (round > rounds) return tiebreakerName(round - rounds);
  if (round === rounds && rounds > 1) return 'Last round';
  return `Round ${round} of ${rounds}`;
}

/** The k-th tiebreaker of a game: "Tiebreaker", "Tiebreaker 2", and so on. */
export const tiebreakerName = (k: number) => (k > 1 ? `Tiebreaker ${Math.floor(k)}` : 'Tiebreaker');

/** A point per word guessed. Skips cost nothing. */
export const points = (cards: readonly Card[]) => cards.reduce((n, c) => n + (c.got ? 1 : 0), 0);

/** Flips one word between Got It and Skipped (the review step fixes mistakes with this). */
export function toggleCard(cards: readonly Card[], i: number): Card[] {
  return cards.map((c, k) => (k === i ? { ...c, got: !c.got } : c));
}

export const finishTurn = (turn: Turn, cards: readonly Card[]): Played => ({ ...turn, cards: cards.slice(), points: points(cards) });

export function scores(history: readonly Played[]): [number, number] {
  const out: [number, number] = [0, 0];
  for (const t of history) out[t.team] += t.points;
  return out;
}

/** The team ahead, or null on a tie. */
export const leader = ([a, b]: readonly [number, number]): TeamIndex | null => (a === b ? null : a > b ? 0 : 1);

/** The highest scoring turn (the earliest one on a tie), or null when nobody scored. */
export function bestTurn(history: readonly Played[]): Played | null {
  let best: Played | null = null;
  for (const t of history) if (t.points > 0 && (!best || t.points > best.points)) best = t;
  return best;
}

/** The 18+ deck: off until someone turns it on. */
export const SPICY_DECKS: readonly DeckId[] = ['dark'];
/** Decks a new table starts with: everything but Hard Mode and the 18+ deck. */
export const DEFAULT_DECKS: DeckId[] = DECK_IDS.filter((id) => id !== 'hard' && !SPICY_DECKS.includes(id));

/** Every word in the chosen decks, each once (the default decks when none are chosen, never the 18+ one). */
export function wordsFor(decks: readonly DeckId[]): Entry[] {
  const ids = DECK_IDS.filter((d) => decks.includes(d));
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const deck of ids.length ? ids : DEFAULT_DECKS)
    for (const word of DECKS[deck].words) {
      const key = word.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ word, deck });
    }
  return out;
}
