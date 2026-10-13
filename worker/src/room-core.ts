export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_MESSAGE_MAX_BYTES = 8 * 1024;

export type RoomPlayer = { seat: number; name: string };
/** roster: seats that were in the room when the current round started. */
export type RoomState = { game: string; seats: number; started: boolean; lateJoin?: boolean; round?: number; roster?: number[] };
export type ClientRoomMessage =
  | { t: 'start' }
  | { t: 'msg'; to?: number; d: unknown }
  | { t: 'signal'; to: number; d: unknown }
  | { t: 'result'; round: number; winner: number | null };

export const makeRoomCode = (bytes: ArrayLike<number>): string => {
  if (bytes.length < ROOM_CODE_LENGTH) throw new RangeError('four random bytes are required');
  return Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length]).join('');
};

export function lowestFreeSeat(seats: number, occupied: Iterable<number>): number | null {
  const used = new Set(occupied);
  for (let seat = 0; seat < seats; seat++) if (!used.has(seat)) return seat;
  return null;
}

export const canStartRoom = (seat: number, playerCount: number) => seat === 0 && playerCount >= 2;

/** Rooms lock once they start, unless the game lets players join between rounds. */
export const canJoinRoom = (room: RoomState) => !room.started || !!room.lateJoin;

/** Starts the next round: bumps the shared round number and remembers who is playing it. */
export function beginRound(room: RoomState, seats: Iterable<number>): number {
  room.started = true;
  room.round = (room.round ?? 0) + 1;
  room.roster = [...new Set(seats)];
  return room.round;
}

/** Someone who takes a seat mid-round sits that round out. */
export function benchSeat(room: RoomState, seat: number) {
  if (room.roster) room.roster = room.roster.filter((value) => value !== seat);
}

/** Seats whose reports decide a round: everyone connected, minus anyone who joined after the round began. */
export function roundSeats(room: RoomState, connected: Iterable<number>, round: number): number[] {
  const seats = [...connected];
  const roster = room.roster;
  if (!roster || room.round !== round) return seats;
  return seats.filter((seat) => roster.includes(seat));
}

function validSeat(seat: unknown, seats: number): seat is number {
  return Number.isInteger(seat) && (seat as number) >= 0 && (seat as number) < seats;
}

export function parseRoomMessage(raw: string | ArrayBuffer, seats: number): ClientRoomMessage | null {
  const byteLength = typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
  if (byteLength > ROOM_MESSAGE_MAX_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.t === 'start') return { t: 'start' };
  if (message.t === 'msg') {
    if (!Object.hasOwn(message, 'd')) return null;
    if (message.to === undefined) return { t: 'msg', d: message.d };
    return validSeat(message.to, seats) ? { t: 'msg', to: message.to, d: message.d } : null;
  }
  if (message.t === 'signal') {
    return validSeat(message.to, seats) && Object.hasOwn(message, 'd') ? { t: 'signal', to: message.to, d: message.d } : null;
  }
  if (message.t === 'result') {
    return Number.isSafeInteger(message.round) && (message.round as number) >= 0 && (message.winner === null || validSeat(message.winner, seats))
      ? { t: 'result', round: message.round as number, winner: message.winner as number | null }
      : null;
  }
  return null;
}

export type RoundReports = Record<string, Record<string, number | null>>;
export type RecordedRounds = number[];

export function agreedWinner(
  reports: RoundReports,
  connectedSeats: Iterable<number>,
  round: number,
): number | null {
  const connected = [...new Set(connectedSeats)];
  if (connected.length < 2) return null;
  const roundReports = reports[String(round)];
  if (!roundReports) return null;
  const winners = connected.map((seat) => roundReports[String(seat)]);
  if (winners.some((winner) => winner === undefined || winner === null)) return null;
  return winners.every((winner) => winner === winners[0]) ? winners[0]! : null;
}

export function markRoundRecorded(recorded: RecordedRounds, round: number): boolean {
  if (recorded.includes(round)) return false;
  recorded.push(round);
  return true;
}
