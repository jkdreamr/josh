import { shuffle, type Rng } from '../../kit/party-core.ts';
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from './words.ts';

/** What the imposter gets: the category, nothing, or a close word (and no idea they're the imposter). */
export type Mode = 'category' | 'none' | 'similar';

/** A secret to deal. `decoy` is the imposter's word in Close Word mode. */
export type Secret = { word: string; category: CategoryId; decoy?: string };
export type Round = Secret & {
  /** Seats (indexes into the player list) of the imposters, ascending. */
  imposters: number[];
  /** Who says the first clue. */
  first: number;
};

/** Imposters must stay a minority: 3 or 4 players get one, 5 or 6 up to two, 7 and up up to three. */
export const maxImposters = (players: number) => Math.min(3, Math.max(1, Math.floor((players - 1) / 2)));
export const imposterCount = (want: number, players: number) => Math.min(Math.max(1, Math.floor(want)), maxImposters(players));
/** Fewest players that seat this many imposters. */
export const playersFor = (imposters: number) => Math.max(1, Math.floor(imposters)) * 2 + 1;

const pickDecks = (decks: readonly CategoryId[]) => {
  const ids = decks.filter((d) => CATEGORY_IDS.includes(d));
  return ids.length ? ids : CATEGORY_IDS;
};

/** Every word in the chosen categories (all of them when none are chosen). */
export function secretsFor(decks: readonly CategoryId[]): Secret[] {
  return pickDecks(decks).flatMap((category) => CATEGORIES[category].words.map((word) => ({ word, category })));
}

/** Every Close Word pair in the chosen categories. Which side the crew gets is decided when the round is dealt. */
export function pairsFor(decks: readonly CategoryId[]): Secret[] {
  return pickDecks(decks).flatMap((category) => CATEGORIES[category].pairs.map(([word, decoy]) => ({ word, decoy, category })));
}

export function deal(players: number, want: number, secret: Secret, rng: Rng = Math.random): Round {
  const seats = Array.from({ length: players }, (_, i) => i);
  const imposters = shuffle(seats, rng)
    .slice(0, imposterCount(want, players))
    .sort((a, b) => a - b);
  // Either word of a pair can be the crew's, so hearing "Pool" never tells you which side you're on.
  const flip = secret.decoy !== undefined && rng() < 0.5;
  const dealt = flip ? { ...secret, word: secret.decoy as string, decoy: secret.word } : secret;
  return { ...dealt, imposters, first: Math.floor(rng() * players) };
}

export type Card = { kind: 'word'; word: string } | { kind: 'imposter' };

/** What one seat sees on their card. In Close Word mode an imposter's card looks exactly like everyone else's. */
export function cardFor(round: Round, seat: number): Card {
  if (!round.imposters.includes(seat)) return { kind: 'word', word: round.word };
  return round.decoy !== undefined ? { kind: 'word', word: round.decoy } : { kind: 'imposter' };
}

/** Clues go around the circle from the first speaker, skipping anyone voted out. */
export function clueOrder(round: Round, players: number, out: readonly number[]): number[] {
  return Array.from({ length: players }, (_, k) => (round.first + k) % players).filter((i) => !out.includes(i));
}

export type VoteResult = 'innocent' | 'caught' | 'caught-all';

/** What a vote does: an innocent out means the imposters win; catching the last imposter ends it. */
export function vote(round: Round, out: readonly number[], seat: number): VoteResult {
  if (!round.imposters.includes(seat)) return 'innocent';
  const left = round.imposters.filter((i) => i !== seat && !out.includes(i));
  return left.length ? 'caught' : 'caught-all';
}

/** A caught imposter gets one guess at the word, unless they had a close word and never knew they were faking. */
export const canSteal = (round: Round) => round.decoy === undefined;

/** Points per seat for one round: each crew member 1 when the crew wins, each imposter 2 when they get away with it. */
export function roundPoints(round: Round, players: number, crewWon: boolean): number[] {
  return Array.from({ length: players }, (_, i) => {
    const imposter = round.imposters.includes(i);
    if (crewWon) return imposter ? 0 : 1;
    return imposter ? 2 : 0;
  });
}
