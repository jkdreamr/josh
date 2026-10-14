import type { OpenRoom } from '../../src/os/arcade/kit/online-core.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_MESSAGE_MAX_BYTES = 8 * 1024;

export type RoomPlayer = { seat: number; name: string };
/**
 * roster: seats that were in the room when the current round started.
 * allowBots: the game can fill empty seats with bots; bots: how many the host asked for (see botSeats).
 * listed: a public room, which the arcade's Open Rooms lists while someone can join it (see roomListing).
 */
export type RoomState = { code?: string; game: string; seats: number; started: boolean; lateJoin?: boolean; round?: number; roster?: number[]; allowBots?: boolean; bots?: number; listed?: boolean };
export type ClientRoomMessage =
  | { t: 'start' }
  | { t: 'bots'; n: number }
  | { t: 'listed'; on: boolean }
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

/**
 * Seats the bots take: the lowest seats no person holds, as many as the host asked for and as fit. Someone who joins
 * takes the lowest free seat as usual, so a bot steps aside for them (into another free seat, or out of a full room).
 */
export function botSeats(seats: number, people: Iterable<number>, bots: number): number[] {
  const taken = new Set(people);
  const free: number[] = [];
  for (let seat = 0; seat < seats && free.length < bots; seat++) if (!taken.has(seat)) free.push(seat);
  return free;
}

/** A public room refreshes its line in Open Rooms this often; a line nobody refreshes for LISTING_TTL_MS is dropped. */
export const LISTING_REFRESH_MS = 60_000;
export const LISTING_TTL_MS = 3 * 60_000;

/**
 * The room's line in the arcade's Open Rooms, or null when it doesn't belong there: private, without its host, full of
 * people (bots step aside, so they never fill it), or under way in a game nobody can join mid-game.
 */
export function roomListing(room: RoomState, players: RoomPlayer[], bots: number): OpenRoom | null {
  const host = players.find((player) => player.seat === 0);
  if (!room.listed || !room.code || !host || players.length >= room.seats || (room.started && !room.lateJoin)) return null;
  return { code: room.code, game: room.game, host: host.name, players: players.length, bots, seats: room.seats, started: room.started, lateJoin: !!room.lateJoin };
}

/** Open Rooms order: rooms still gathering first, then the busiest, then the newest code for a stable order. */
export function sortListings(rooms: OpenRoom[]): OpenRoom[] {
  return [...rooms].sort((a, b) => Number(a.started) - Number(b.started) || b.players - a.players || a.code.localeCompare(b.code));
}

/** Only the host starts, and only with someone to play: another person or a bot. */
export const canStartRoom = (seat: number, playerCount: number, botCount = 0) => seat === 0 && playerCount + botCount >= 2;

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
  // Up to every seat but the host's.
  if (message.t === 'bots') return Number.isInteger(message.n) && (message.n as number) >= 0 && (message.n as number) < seats ? { t: 'bots', n: message.n as number } : null;
  if (message.t === 'listed') return typeof message.on === 'boolean' ? { t: 'listed', on: message.on } : null;
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
