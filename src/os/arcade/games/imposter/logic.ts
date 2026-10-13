import { shuffle, type Rng } from '../../kit/party-core.ts';
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from './words.ts';

export type Secret = { word: string; category: CategoryId };
export type Round = Secret & {
  /** Seats (indexes into the player list) of the imposters, ascending. */
  imposters: number[];
  /** Who says the first clue. */
  first: number;
};

/** Imposters must stay a minority: 3 or 4 players get one, 5 or 6 up to two, 7 and up up to three. */
export const maxImposters = (players: number) => Math.min(3, Math.max(1, Math.floor((players - 1) / 2)));
export const imposterCount = (want: number, players: number) => Math.min(Math.max(1, Math.floor(want)), maxImposters(players));

/** Every word in the chosen categories (all of them when none are chosen). */
export function secretsFor(decks: readonly CategoryId[]): Secret[] {
  const ids = decks.filter((d) => CATEGORY_IDS.includes(d));
  return (ids.length ? ids : CATEGORY_IDS).flatMap((category) => CATEGORIES[category].words.map((word) => ({ word, category })));
}

export function deal(players: number, want: number, secret: Secret, rng: Rng = Math.random): Round {
  const seats = Array.from({ length: players }, (_, i) => i);
  const imposters = shuffle(seats, rng)
    .slice(0, imposterCount(want, players))
    .sort((a, b) => a - b);
  return { ...secret, imposters, first: Math.floor(rng() * players) };
}

export type VoteResult = 'innocent' | 'caught' | 'caught-all';

/** What a vote does: an innocent out means the imposters win; catching the last imposter ends it. */
export function vote(round: Round, out: readonly number[], seat: number): VoteResult {
  if (!round.imposters.includes(seat)) return 'innocent';
  const left = round.imposters.filter((i) => i !== seat && !out.includes(i));
  return left.length ? 'caught' : 'caught-all';
}
