import { TEAM_SIZE, teamOf } from './logic.ts';

export type Mode = 'cpu' | 'versus' | 'coop';

const homeSeatOrder = [6, 9, 5, 7, 3, 8, 10, 1, 2, 4] as const;
const playerForSideSeat = (side: 0 | 1, index: number) => side * TEAM_SIZE + homeSeatOrder[index % homeSeatOrder.length]!;

export const playerForSeat = (seat: number, displayOnly = false, mode: Mode = 'cpu') => {
  if (displayOnly && seat === 0) return playerForSideSeat(0, 0);
  if (displayOnly && mode === 'coop') return playerForSideSeat(0, Math.max(0, seat - 1));
  const position = displayOnly ? seat - 1 : seat;
  const side = position % 2 === 0 ? 0 : 1;
  return playerForSideSeat(side, Math.floor(position / 2));
};

export const seatForPlayer = (id: number, displayOnly: boolean, mode: Mode = 'cpu') => {
  const side = teamOf(id);
  const position = homeSeatOrder.indexOf((id % TEAM_SIZE) as (typeof homeSeatOrder)[number]);
  if (position < 0 || (mode === 'coop' && side === 1)) return 99;
  if (displayOnly && mode === 'coop') return position + 1;
  return displayOnly ? position * 2 + side + 1 : position * 2 + side;
};
