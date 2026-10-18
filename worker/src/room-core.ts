import { MAX_SEATS, type OpenRoom } from '../../src/os/arcade/kit/online-core.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_MESSAGE_MAX_BYTES = 8 * 1024;

/** The seats a new room for a game gets: what its spec asks for, two at least and MAX_SEATS at most. */
export const seatsFor = (spec: { seats: number }) => Math.max(2, Math.min(MAX_SEATS, Math.floor(spec.seats) || 2));

export type RoomPlayer = { seat: number; name: string };
/**
 * started: a round is under way (false again once it ends: see endRound).
 * roster: seats that were in the room when the current round started; roundBots: how many bots play it.
 * allowBots: the game can fill empty seats with bots; bots: how many the host asked for (see botSeats).
 * listed: a public room, which the arcade's Open Rooms lists while someone can join it (see roomListing).
 * inLobby: the room's line is in Open Rooms right now, so only rooms that were listed ever need to take it out.
 * quick: a quick-play room, which gathers people until startAt (epoch ms) and then starts its one round on its own.
 */
export type RoomState = { code?: string; game: string; seats: number; started: boolean; lateJoin?: boolean; round?: number; roster?: number[]; roundBots?: number; allowBots?: boolean; bots?: number; listed?: boolean; inLobby?: boolean; quick?: boolean; startAt?: number };
export type ClientRoomMessage =
  | { t: 'start' }
  | { t: 'over'; round: number }
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

/** A quick-play room gathers people for this long after it opens, then starts with bots in every other seat. */
export const GATHER_MS = 20_000;
/** It starts this soon once people hold every seat. */
export const GATHER_FULL_MS = 3_000;
/** A quick room the Lobby has handed out keeps its place this long before anyone is in it. */
export const QUICK_PENDING_MS = 15_000;
/** The Lobby sends nobody to a quick room starting sooner than this: they could get there after the start. */
export const QUICK_LATE_MS = 2_500;

/** A quick-play room still waiting for its round: it starts at startAt. */
export const gathering = (room: RoomState) => !!room.quick && !room.started && !room.round && room.startAt !== undefined;

/** Someone came in: once people hold every seat, a gathering room starts in a moment. True when that moved the start. */
export function gatherFull(room: RoomState, people: number, now: number): boolean {
  if (!gathering(room) || people < room.seats || room.startAt! <= now + GATHER_FULL_MS) return false;
  room.startAt = now + GATHER_FULL_MS;
  return true;
}

/**
 * When the room's alarm should next go off, or null for none: a gathering room's start, and every LISTING_REFRESH_MS
 * while it is `listed` (an alarm already set for sooner is kept, so changes never put the refresh off).
 */
export function nextAlarm(room: RoomState, listed: boolean, current: number | null, now: number): number | null {
  const refresh = listed ? (current !== null && current > now ? current : now + LISTING_REFRESH_MS) : null;
  const start = gathering(room) ? room.startAt! : null;
  if (refresh === null) return start;
  return start === null ? refresh : Math.min(refresh, start);
}

/**
 * The room's line in the arcade's Open Rooms, or null when it doesn't belong there: private, without its host, full of
 * people (bots step aside, so they never fill it), under way in a game nobody can join mid-game, or a quick-play room
 * past gathering (it plays one round, for the people who were in it).
 */
export function roomListing(room: RoomState, players: RoomPlayer[], bots: number): OpenRoom | null {
  const host = players.find((player) => player.seat === 0);
  if (!room.listed || !room.code || !host || players.length >= room.seats || (room.started && !room.lateJoin)) return null;
  if (room.quick && !gathering(room)) return null;
  const quick = room.quick ? { quick: true as const, startAt: room.startAt } : {};
  return { code: room.code, game: room.game, host: host.name, players: players.length, bots, seats: room.seats, started: room.started, lateJoin: !!room.lateJoin, ...quick };
}

/** A line in the Lobby, and when its room last refreshed it. A quick room the Lobby handed out before anyone came in has no host yet. */
export type LobbyRow = { listing: OpenRoom; updated: number };

/**
 * The quick-play room to send someone to: of the ones still gathering with a seat to spare and time left to get
 * there, the fullest (so rooms fill up rather than split), then the one starting soonest.
 */
export function pickQuick(rows: LobbyRow[], now: number): OpenRoom | null {
  const open = rows.map((row) => row.listing).filter((r, i) =>
    r.quick && !r.started && r.players < r.seats && (r.host !== '' || rows[i].updated > now - QUICK_PENDING_MS) && (r.startAt ?? Infinity) > now + QUICK_LATE_MS,
  );
  open.sort((a, b) => b.players - a.players || (a.startAt ?? 0) - (b.startAt ?? 0) || a.code.localeCompare(b.code));
  return open[0] ?? null;
}

/** Open Rooms order: rooms still gathering first, then the busiest, then the newest code for a stable order. */
export function sortListings(rooms: OpenRoom[]): OpenRoom[] {
  return [...rooms].sort((a, b) => Number(a.started) - Number(b.started) || b.players - a.players || a.code.localeCompare(b.code));
}

/** Only the host starts, and only with someone to play: another person or a bot. */
export const canStartRoom = (seat: number, playerCount: number, botCount = 0) => seat === 0 && playerCount + botCount >= 2;

/** Anyone can join between rounds; while one is under way, only games that let people join mid-round take them. */
export const canJoinRoom = (room: RoomState) => !room.started || !!room.lateJoin;

/** Starts the next round: bumps the shared round number and remembers who is playing it, bots included. */
export function beginRound(room: RoomState, seats: Iterable<number>, bots = 0): number {
  room.started = true;
  room.round = (room.round ?? 0) + 1;
  room.roster = [...new Set(seats)];
  room.roundBots = bots;
  return room.round;
}

/**
 * Ends the round under way (only that one: a late word about an older round changes nothing), so the room takes
 * people again and a public room goes back on Open Rooms. True when it ended one.
 */
export function endRound(room: RoomState, round = room.round): boolean {
  if (!room.started || round !== room.round) return false;
  room.started = false;
  return true;
}

/** A round goes on while it has someone to play against: two people, or one and a bot. */
export const roundPlayable = (room: RoomState, people: number) => people + (room.roundBots ?? 0) >= 2;

/**
 * Who takes over when the host leaves: the person in the lowest seat, the one who has been in the room longest unless
 * someone left and a newcomer took their seat. Null when nobody is left.
 */
export function nextHost(players: RoomPlayer[]): RoomPlayer | null {
  return players.reduce<RoomPlayer | null>((best, player) => (best === null || player.seat < best.seat ? player : best), null);
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
  if (message.t === 'over') return Number.isSafeInteger(message.round) && (message.round as number) >= 0 ? { t: 'over', round: message.round as number } : null;
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
