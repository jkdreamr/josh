import { competitionById, type CompetitionId, type Mode } from './modes.ts';
import { userFixture, type Cup } from './cup.ts';
import { clubById } from './teams.ts';

const QUICK_SETUP: readonly Mode[] = ['cpu', 'versus', 'coop', 'practice'];

export function lobbySetupOptions(competition: CompetitionId): readonly Mode[] {
  return competition === 'quick' ? QUICK_SETUP : competitionById(competition).arrangements;
}

export function requiredPhones(competition: CompetitionId, mode: Mode): number {
  if (competition === 'online') return 0;
  return mode === 'cpu' || mode === 'practice' ? 1 : 2;
}

export function sideForLobbyMember(
  competition: CompetitionId,
  mode: Mode,
  role: 'phone' | 'mac' | 'host',
  seat: number,
  fallback: 0 | 1,
): 0 | 1 {
  if (role !== 'phone') return fallback;
  if (competition === 'online' || mode !== 'versus') return 0;
  return seat === 2 ? 1 : 0;
}

export function hasLobbyPhoneMember(members: readonly { seat: number; role: 'phone' | 'mac' | 'host' }[], seat: number): boolean {
  return members.some((member) => member.seat === seat && member.role === 'phone');
}

export function phoneStatusLine(
  members: readonly { seat: number; role: 'phone' | 'mac' | 'host'; side?: number }[],
  ready?: readonly boolean[],
): string {
  return members
    .filter((member) => member.role === 'phone')
    .sort((a, b) => a.seat - b.seat)
    .map((member, index) => `Phone ${index + 1}${ready?.[member.side ?? 0] ? ' ready' : ' ✓'}`)
    .join(' · ');
}

export function phoneRoute(round: number, started: boolean, lobbyScreen?: 'lobby' | 'match'): 'picker' | 'controller' {
  if (lobbyScreen === 'lobby') return 'picker';
  if (round > 0 || started || lobbyScreen === 'match') return 'controller';
  return 'picker';
}

export function postMatchPrimaryLabel(competition: CompetitionId, cupContinues: boolean): string {
  return competition !== 'cup' ? 'Rematch' : cupContinues ? 'Next match' : 'New cup';
}

export function hostLobbyStatus({
  competition, mode, phoneCount, guestMac,
}: {
  competition: CompetitionId;
  mode: Mode;
  phoneCount: number;
  guestMac: boolean;
}): string {
  if (competition === 'online') {
    return guestMac ? 'Pick your club on your phone, then press A.' : 'Open the Mac invite link on the other Mac to play online.';
  }
  if (requiredPhones(competition, mode) === 2 && phoneCount === 1) {
    return 'Scan the QR with a second iPhone to play 2 player';
  }
  if (phoneCount === 0) return 'Your phone becomes the controller. No app needed.';
  return 'Pick your club on your phone, then press A.';
}

export function nextCupFixtureText(cup: Cup): string | null {
  const fixture = userFixture(cup);
  if (!fixture) return null;
  const opponentId = fixture.home === cup.user ? fixture.away : fixture.home;
  return `Next: ${fixture.stage} vs ${clubById(opponentId).name}.`;
}
