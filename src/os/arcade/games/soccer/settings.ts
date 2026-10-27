import { defineSetting } from '../../kit';
import type { LevelName } from '../../kit/controls';
import type { TimeMode } from './scene.ts';
import { CLUB_IDS, DEFAULT_CLUBS } from './teams.ts';
import { COMPETITION_IDS, MODE_OPTIONS, type CompetitionId, type Mode } from './modes.ts';

export const MODE = defineSetting<Mode>('soccer:mode', MODE_OPTIONS, 'cpu');
export const COMPETITION = defineSetting<CompetitionId>('soccer:competition', COMPETITION_IDS, 'quick');
export const HOME_CLUB = defineSetting<string>('soccer:home-club', CLUB_IDS, DEFAULT_CLUBS[0]);
export const AWAY_CLUB = defineSetting<string>('soccer:away-club', CLUB_IDS, DEFAULT_CLUBS[1]);
export const HALF = defineSetting<'2' | '4' | '6'>('soccer:half', ['2', '4', '6'], '4');
export const LEVEL = defineSetting<LevelName>('soccer:level', ['easy', 'normal', 'hard'], 'normal');
export const CAMERA = defineSetting<'broadcast' | 'end'>('soccer:camera', ['broadcast', 'end'], 'broadcast', { live: true });
export const TIME = defineSetting<TimeMode>('soccer:time', ['night', 'golden', 'overcast', 'rain'], 'night', { live: true });
