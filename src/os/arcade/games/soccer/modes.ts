import { PRACTICE_MODE_OPTION } from './practice-mode.tsx';

export type Mode = 'cpu' | 'versus' | 'coop' | 'practice';
export type CompetitionDef<Id extends string = string> = {
  id: Id;
  label: string;
  hint: string;
  arrangements: readonly Mode[];
  opponentPick: boolean;
  online?: boolean;
};

export const COMPETITIONS = [
  { id: 'quick', label: 'quick match', hint: 'play a short match', arrangements: ['cpu', 'versus', 'coop'], opponentPick: true },
  { id: 'cup', label: 'cup', hint: 'play through a bracket', arrangements: ['cpu', 'coop'], opponentPick: false },
  { id: 'online', label: 'online vs mac', hint: 'play against a friend on another mac', arrangements: ['cpu'], opponentPick: true, online: true },
] as const satisfies readonly CompetitionDef[];

export type CompetitionId = (typeof COMPETITIONS)[number]['id'];
export const COMPETITION_IDS = COMPETITIONS.map(({ id }) => id) as CompetitionId[];
export const MODE_OPTIONS = [...new Set([...COMPETITIONS.flatMap(({ arrangements }) => arrangements), PRACTICE_MODE_OPTION[0]])] as Mode[];
export const competitionById = (id: string | undefined): CompetitionDef =>
  COMPETITIONS.find((competition) => competition.id === id) ?? COMPETITIONS[0]!;
