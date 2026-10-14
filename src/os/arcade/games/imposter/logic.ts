import { shuffle, type Rng } from '../../kit/party-core.ts';
import { CATEGORIES, CATEGORY_IDS, DEFAULT_IDS, type CategoryId } from './words.ts';

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
  return ids.length ? ids : DEFAULT_IDS;
};

/** The categories remembered on this device, or the default set (never the 18+ one) when nothing valid is stored. */
export function parseDecks(raw: unknown): CategoryId[] {
  const ids = Array.isArray(raw) ? CATEGORY_IDS.filter((id) => raw.includes(id)) : [];
  return ids.length ? ids : DEFAULT_IDS;
}

/** Every word in the chosen categories (the default set when none are chosen). */
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

/**
 * Rough width of a line of the card's display face (Big Shoulders, extra bold), in em: thin letters and spaces,
 * half-width letters, wide letters and everything else. Close enough to match two words by eye.
 */
export function inkEm(text: string): number {
  let em = 0;
  for (const ch of text) em += /[\s'.,iIjl]/.test(ch) ? 0.22 : /[frtFT1]/.test(ch) ? 0.33 : /[mwMW]/.test(ch) ? 0.71 : 0.44;
  return Math.round(em * 100) / 100;
}

/**
 * What an imposter reads in the word slot, shortest to longest. Every one says "you're the imposter" at a glance,
 * and none is a word anyone could be dealt.
 */
export const COVERS = [
  'Sus', 'Fake', 'Fraud', 'Fake It', "It's You", 'No Word', 'Imposter', 'Just Bluff', 'Total Fraud', 'The Imposter',
  'Total Imposter', 'No Word for You', 'Imposter This Time', 'You Are the Imposter', "Yes, You're the Imposter",
] as const;

/** The cover that fills about as much of the card as the crew's word, so from across the table the two cards look the same. */
export function coverFor(word: string): string {
  const want = inkEm(word);
  let best: string = COVERS[0];
  for (const c of COVERS) if (Math.abs(inkEm(c) - want) < Math.abs(inkEm(best) - want)) best = c;
  return best;
}

export type Card = { kind: 'word'; word: string } | { kind: 'imposter'; cover: string };

/**
 * What one seat sees on their card. An imposter's card carries a cover the size of the crew's word, so it looks like
 * everyone else's until you read it. In Close Word mode it holds the other word and the imposter never knows.
 */
export function cardFor(round: Round, seat: number): Card {
  if (!round.imposters.includes(seat)) return { kind: 'word', word: round.word };
  return round.decoy !== undefined ? { kind: 'word', word: round.decoy } : { kind: 'imposter', cover: coverFor(round.word) };
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
