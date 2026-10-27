import { defineSetting } from '../../kit';
import { CLUB_IDS, DEFAULT_CLUBS } from './teams.ts';
import { COMPETITION_IDS, MODE_OPTIONS, type CompetitionId, type Mode } from './modes.ts';

export const MODE = defineSetting<Mode>('soccer:mode', MODE_OPTIONS, 'cpu');
export const COMPETITION = defineSetting<CompetitionId>('soccer:competition', COMPETITION_IDS, 'quick');
export const HOME_CLUB = defineSetting<string>('soccer:home-club', CLUB_IDS, DEFAULT_CLUBS[0]);
export const AWAY_CLUB = defineSetting<string>('soccer:away-club', CLUB_IDS, DEFAULT_CLUBS[1]);
