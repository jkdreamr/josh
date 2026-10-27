import { TEAM_SIZE, teamOf } from './logic.ts';
import type { Mode } from './modes.ts';
export type { Mode } from './modes.ts';

const homeOnly = (mode: Mode) => mode === 'coop' || mode === 'practice';

const homeSeatOrder = [6, 9, 5, 7, 3, 8, 10, 1, 2, 4] as const;
const playerForSideSeat = (side: 0 | 1, index: number) => side * TEAM_SIZE + homeSeatOrder[index % homeSeatOrder.length]!;

export function missingPhoneSeats(matchSeats: readonly number[], present: readonly number[]) {
  const presentSeats = new Set(present);
  return matchSeats.filter((seat) => !presentSeats.has(seat));
}

export const playerForSeat = (seat: number, displayOnly = false, mode: Mode = 'cpu') => {
  if (displayOnly && seat === 0) return playerForSideSeat(0, 0);
  if (displayOnly && homeOnly(mode)) return playerForSideSeat(0, Math.max(0, seat - 1));
  const position = displayOnly ? seat - 1 : seat;
  const side = position % 2 === 0 ? 0 : 1;
  return playerForSideSeat(side, Math.floor(position / 2));
};

export const seatForPlayer = (id: number, displayOnly: boolean, mode: Mode = 'cpu') => {
  const side = teamOf(id);
  const position = homeSeatOrder.indexOf((id % TEAM_SIZE) as (typeof homeSeatOrder)[number]);
  if (position < 0 || (homeOnly(mode) && side === 1)) return 99;
  if (displayOnly && homeOnly(mode)) return position + 1;
  return displayOnly ? position * 2 + side + 1 : position * 2 + side;
};

export type ControllerMember = { seat: number; role: 'host' | 'phone' | 'mac'; side: 0 | 1 };

export function assignControllers(members: ControllerMember[], mode: Mode, comp: 'quick' | 'cup' | 'online') {
  const assignments = new Map<number, number>();
  if (comp !== 'online') {
    for (const member of members) {
      if (member.role === 'phone') assignments.set(member.seat, playerForSeat(member.seat, true, mode));
    }
    return assignments;
  }
  for (const side of [0, 1] as const) {
    const phones = members.filter((member) => member.role === 'phone' && member.side === side).sort((a, b) => a.seat - b.seat);
    phones.forEach((member, index) => assignments.set(member.seat, playerForSideSeat(side, index)));
    if (!phones.length) {
      const mac = members.find((member) => (member.role === 'host' || member.role === 'mac') && member.side === side);
      if (mac) assignments.set(mac.seat, playerForSideSeat(side, 0));
    }
  }
  return assignments;
}
