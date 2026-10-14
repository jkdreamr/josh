import { boardsOf, type BoardEntry } from './kit/leaderboard-core.ts';
import type { GameCategory, LeaderboardSpec, OnlineSpec } from './types.ts';

/** A game that owns boards: an arcade game's meta, or a desktop app game from apps.ts (no tile, so no accent, glyph or category). */
export type CardOwner = { id: string; title: string; leaderboard?: LeaderboardSpec; online?: OnlineSpec; accent?: string; glyph?: string; category?: GameCategory };

/** A board a card can show: a score board (one per variant), or the game's Online Wins, which has no spec. */
export type CardBoard = { id: string; label: string; spec?: LeaderboardSpec };

/** One card on the arcade Leaderboards page: a game, what it ranks, and its boards of one kind. */
export type BoardCard = {
  kind: 'score' | 'wins';
  /** The first owner's id, unique within a kind. */
  key: string;
  title: string;
  measure: string;
  accent: string;
  glyph: string;
  category: GameCategory;
  boards: CardBoard[];
};

type Look = Pick<BoardCard, 'accent' | 'glyph'>;

/** A circle as path data, for glyphs. */
const circle = (x: number, y: number, r: number) => `M${x} ${y}m-${r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0-${2 * r} 0`;

/** Desktop app games have no arcade tile, so their cards get a look here and sit with the other two player games. */
const appLooks: Record<string, Look> = {
  // Two stones on the grid.
  Go: { accent: '#b07d45', glyph: `M3 9h2.8M12.2 9H21M3 15h8.8M18.2 15H21M9 3v2.8M9 12.2V21M15 3v8.8M15 18.2V21${circle(9, 9, 3.2)}${circle(15, 15, 3.2)}` },
  // Five in a row.
  Omok: { accent: '#7d5733', glyph: [[3.8, 20.2], [7.9, 16.1], [12, 12], [16.1, 7.9], [20.2, 3.8]].map(([x, y]) => circle(x, y, 1.75)).join('') },
  // A shuttlecock.
  Badminton: { accent: '#2f7a6d', glyph: 'M9 16h6M9 16 5.5 4M15 16l3.5-12M12 16V4.5M5.5 4c4.3 1.4 8.7 1.4 13 0M9.5 16v1.5a2.5 2.5 0 0 0 5 0V16' },
};
const trophy: Look = { accent: '#636366', glyph: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4' };

function lookOf(owner: CardOwner): Look & { category: GameCategory } {
  if (owner.accent && owner.glyph && owner.category) return { accent: owner.accent, glyph: owner.glyph, category: owner.category };
  return { ...(Object.hasOwn(appLooks, owner.title) ? appLooks[owner.title] : trophy), category: 'multiplayer' };
}

/** What a score board ranks: its spec's measure, or else the best time or the top score. */
export const measureOf = (spec: LeaderboardSpec) => spec.measure ?? (spec.format === 'time' ? 'Best Time' : 'Top Score');

/**
 * Every card, score boards first: one per game, with each variant as one of its boards, then one
 * Online Wins card per online game. Owners with the same title share a card, so Go's three board
 * sizes are one card with eighteen boards.
 */
export function boardCards(owners: readonly CardOwner[]): BoardCard[] {
  const scores = new Map<string, BoardCard>();
  for (const owner of owners) {
    const boards = boardsOf(owner);
    if (!owner.leaderboard || !boards.length) continue;
    const card = scores.get(owner.title) ?? { kind: 'score', key: owner.id, title: owner.title, measure: measureOf(owner.leaderboard), ...lookOf(owner), boards: [] };
    card.boards.push(...boards.map((board) => ({ id: board.id, label: board.variant ?? owner.title, spec: board.spec })));
    scores.set(owner.title, card);
  }
  const wins = owners
    .filter((owner) => owner.online)
    .map((owner): BoardCard => ({ kind: 'wins', key: owner.id, title: owner.title, measure: 'Online Wins', ...lookOf(owner), boards: [{ id: owner.id, label: owner.title }] }));
  return [...scores.values(), ...wins];
}

/** The board a card shows until someone picks one: the one with the most entries so far (the first of those), else the first. */
export function defaultBoard(boards: readonly CardBoard[], tops?: Record<string, BoardEntry[]> | null): CardBoard {
  let best = boards[0];
  let most = 0;
  for (const board of boards) {
    const count = tops && Object.hasOwn(tops, board.id) ? tops[board.id].length : 0;
    if (count > most) {
      best = board;
      most = count;
    }
  }
  return best;
}
