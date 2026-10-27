export type Mode = 'cpu' | 'versus' | 'coop';

export const playerForSeat = (seat: number, displayOnly = false, mode: Mode = 'cpu') => displayOnly
  ? seat === 0 ? 1 : mode === 'coop' ? Math.min(4, seat) : (seat - 1) % 2 === 0 ? 1 + Math.floor((seat - 1) / 2) : 6 + Math.floor((seat - 2) / 2)
  : seat % 2 === 0 ? 1 + Math.floor(seat / 2) : 6 + Math.floor(seat / 2);

export const seatForPlayer = (id: number, displayOnly: boolean, mode: Mode = 'cpu') => displayOnly
  ? mode === 'coop' ? id === 0 ? 0 : id < 5 ? id : 99 : id < 5 ? 2 * (id - 1) + 1 : 2 * (id - 6) + 2
  : id < 5 ? 2 * (id - 1) : 2 * (id - 6) + 1;
