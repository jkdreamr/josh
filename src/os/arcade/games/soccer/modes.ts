export type CompetitionId = 'quick' | 'cup' | 'online';
export type Mode = 'cpu' | 'versus' | 'coop';
export type CompetitionDef = {
  id: CompetitionId;
  label: string;
  hint: string;
  arrangements: readonly Mode[];
  opponentPick: boolean;
  online?: boolean;
};

// Add a competition here, then handle it in the lobby and match setup switch.
export const COMPETITIONS: readonly CompetitionDef[] = [
  { id: 'quick', label: 'quick match', hint: 'play a short match', arrangements: ['cpu', 'versus', 'coop'], opponentPick: true },
  { id: 'cup', label: 'cup', hint: 'play through a bracket', arrangements: ['cpu', 'coop'], opponentPick: false },
  { id: 'online', label: 'online vs mac', hint: 'play against a friend on another mac', arrangements: ['cpu'], opponentPick: true, online: true },
];

export const COMPETITION_IDS = COMPETITIONS.map(({ id }) => id) as CompetitionId[];
export const MODE_OPTIONS = [...new Set(COMPETITIONS.flatMap(({ arrangements }) => arrangements))] as Mode[];
export const competitionById = (id: string | undefined): CompetitionDef =>
  COMPETITIONS.find((competition) => competition.id === id) ?? COMPETITIONS[0]!;
