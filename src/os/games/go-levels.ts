/** Board sizes Baduk offers for Go. */
export const GO_SIZES = [9, 13, 19] as const;
export type GoSize = (typeof GO_SIZES)[number];
export const isGoSize = (value: unknown): value is GoSize => GO_SIZES.includes(value as GoSize);

/**
 * The computer opponents for Go, weakest first. Every one runs the same KataGo network. The lower
 * four play straight from its policy at a limited rank (./katago/pick.ts, `kyu` is the target,
 * null for no limit); the top two search. Ids double as leaderboard variants: `fast` and `strong`
 * keep the board ids of the original Fast and Strong opponents.
 */
export const GO_LEVELS = [
  { id: 'beginner', label: 'Beginner', blurb: 'Looks at a few moves and plays the best of them.', kyu: 18 },
  { id: 'novice', label: 'Novice', blurb: 'Looks wider, still misses plenty.', kyu: 12 },
  { id: 'intermediate', label: 'Intermediate', blurb: 'Good shape, no reading ahead.', kyu: 6 },
  { id: 'advanced', label: 'Advanced', blurb: 'Always plays its first instinct. Still no reading.', kyu: null },
  { id: 'fast', label: 'Expert', blurb: 'Reads a dozen variations every move.', search: 'fast' },
  { id: 'strong', label: 'Master', blurb: 'Reads hundreds of variations. Full strength.', search: 'strong' },
] as const satisfies readonly { id: string; label: string; blurb: string; kyu?: number | null; search?: 'fast' | 'strong' }[];

export type GoLevel = (typeof GO_LEVELS)[number];
export type GoLevelId = GoLevel['id'];
export const goLevel = (id: GoLevelId): GoLevel => GO_LEVELS.find((level) => level.id === id)!;
export const isGoLevel = (value: unknown): value is GoLevelId => GO_LEVELS.some((level) => level.id === value);
