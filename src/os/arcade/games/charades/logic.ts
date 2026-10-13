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

/** Teams take turns; inside a team the actor moves through its members in seating order. */
export function turnAt(index: number, teams: Teams, style: Style): Turn {
  const team = (index % 2) as TeamIndex;
  const own = Math.floor(index / 2);
  const members = teams[team];
  return { index, team, round: own + 1, actor: members.length ? members[own % members.length] : -1, style: styleFor(style, index) };
}

export const totalTurns = (rounds: number) => Math.max(1, Math.floor(rounds)) * 2;
export const isOver = (played: number, rounds: number) => played >= totalTurns(rounds);
export const isLastTurn = (index: number, rounds: number) => index >= totalTurns(rounds) - 1;

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

/** Every word in the chosen decks, each once (all decks when none are chosen). */
export function wordsFor(decks: readonly DeckId[]): Entry[] {
  const ids = DECK_IDS.filter((d) => decks.includes(d));
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const deck of ids.length ? ids : DECK_IDS)
    for (const word of DECKS[deck].words) {
      const key = word.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ word, deck });
    }
  return out;
}

/** The longest single word in a phrase, which decides how big it can be drawn. */
export const longestToken = (phrase: string) => phrase.split(/\s+/).reduce((n, w) => Math.max(n, Array.from(w).length), 0);
