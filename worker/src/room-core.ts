import { MAX_SEATS, type OpenRoom } from '../../src/os/arcade/kit/online-core.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_MESSAGE_MAX_BYTES = 8 * 1024;

/** The seats a new room for a game gets: what its spec asks for, two at least and MAX_SEATS at most. */
export const seatsFor = (spec: { seats: number }) => Math.max(2, Math.min(MAX_SEATS, Math.floor(spec.seats) || 2));

/** A quick-play pool's name (a game's mode, say): quick play keeps a game's rooms of one pool apart from the rest. */
export const isPool = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,16}$/.test(v);

export type RoomPlayer = { seat: number; name: string };
/**
 * started: a round is under way (false again once it ends: see endRound).
 * roster: seats that were in the room when the current round started; roundBots: how many bots play it.
 * allowBots: the game can fill empty seats with bots; bots: how many the host asked for (see botSeats).
 * listed: a public room, which the arcade's Open Rooms lists while someone can join it (see roomListing).
 * inLobby: the room's line is in Open Rooms right now, so only rooms that were listed ever need to take it out.
 * quick: a quick-play room, which gathers people until startAt (epoch ms) and then starts its one round on its own;
 * pool: the quick-play pool it gathers for (see isPool), if any.
 * watch: the game can be watched (spectators see the host's game, take no seat and send nothing); watchable: the host
 * lets them (on unless the host turns it off).
 * migrate: the game's round goes on when its host leaves, the new host's game running the rest (see handOffRound).
 */
export type RoomState = { code?: string; game: string; seats: number; started: boolean; lateJoin?: boolean; round?: number; roster?: number[]; roundBots?: number; allowBots?: boolean; bots?: number; listed?: boolean; inLobby?: boolean; quick?: boolean; startAt?: number; pool?: string; watch?: boolean; watchable?: boolean; migrate?: boolean };
export type ClientRoomMessage =
  | { t: 'start' }
  | { t: 'over'; round: number }
  | { t: 'bots'; n: number }
  | { t: 'listed'; on: boolean }
  | { t: 'watchable'; on: boolean }
  | { t: 'watch'; d: unknown }
  /**
   * to: one seat, several (each gets it once), or everyone else when left out. fast: the next one replaces it (a
   * snapshot), so it isn't kept for someone away for a moment (see HOLD_MS).
   */
  | { t: 'msg'; to?: number | number[]; d: unknown; fast?: true }
  | { t: 'signal'; to: number; d: unknown }
  | { t: 'result'; round: number; winner: number | null; team?: number[] };

export type RelayRoomMessage = Extract<ClientRoomMessage, { t: 'msg' | 'signal' | 'watch' }>;
export const isRelayMessage = (message: ClientRoomMessage | null): message is RelayRoomMessage =>
  message?.t === 'msg' || message?.t === 'signal' || message?.t === 'watch';

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
export function nextAlarm(room: RoomState, listed: boolean, current: number | null, now: number, holdUntil: number | null = null): number | null {
  const refresh = listed ? (current !== null && current > now ? current : now + LISTING_REFRESH_MS) : null;
  const start = gathering(room) ? room.startAt! : null;
  const times = [refresh, start, holdUntil].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/**
 * Clients that come back to their own seat when their connection drops (protocol 4): the room gives each one a key
 * when it takes a seat, and keeps the seat of anyone whose socket goes without a goodbye for HOLD_MS, mid-round
 * included, so a dropped connection, a laptop waking up or the Worker being redeployed costs a moment, not the race.
 */
export const RESUME_VERSION = 4;
export const HOLD_MS = 20_000;
/** A seat's key and the name it was taken under, kept in storage so they outlive the object being reset. */
export type SeatKey = { key: string; name: string };
/** A seat waiting for its player to come back: until when, and the round under way when they dropped. */
export type Hold = { until: number; round: number };
export const isSeatKey = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

/** Seats whose hold ran out by `now`, in seat order. */
export function holdsDue(held: Record<string, Hold>, now: number): number[] {
  return Object.entries(held).filter(([, h]) => h.until <= now).map(([seat]) => Number(seat)).sort((a, b) => a - b);
}

/** The soonest a hold runs out, or null for none. */
export const holdUntil = (held: Record<string, Hold>) => Object.values(held).reduce<number | null>((t, h) => (t === null || h.until < t ? h.until : t), null);

/**
 * Whether someone can have seat `seat` back with `key`: it is still theirs (a hold that hasn't run out, or a seat the
 * room never saw them leave, which is how every seat looks after the object restarts).
 */
export function canResume(keys: Record<string, SeatKey>, seat: number, key: unknown): boolean {
  const entry = Number.isInteger(seat) ? keys[String(seat)] : undefined;
  return !!entry && isSeatKey(key) && entry.key === key;
}

/** The seats a room that has just woken up should hold: seats with a key whose socket is gone and isn't held yet. */
export function orphanSeats(keys: Record<string, SeatKey>, held: Record<string, Hold>, open: Iterable<number>): number[] {
  const live = new Set(open);
  return Object.keys(keys).map(Number).filter((seat) => !live.has(seat) && !Object.hasOwn(held, String(seat))).sort((a, b) => a - b);
}

/** What the room keeps for a seat held for someone coming back, at most: their messages, oldest dropped first. */
export const BACKLOG_MAX = 256;
export const BACKLOG_BYTES = 128 * 1024;

/** Keeps a message for a held seat, dropping the oldest past the limits. */
export function keepFor(backlog: { data: string[]; bytes: number }, data: string) {
  backlog.data.push(data);
  backlog.bytes += data.length;
  while (backlog.data.length > BACKLOG_MAX || (backlog.bytes > BACKLOG_BYTES && backlog.data.length > 1)) backlog.bytes -= backlog.data.shift()!.length;
}

/** Who a relayed message goes to: one seat, several, or (undefined) everyone else. */
export const relayTargets = (to: number | number[] | undefined): Set<number> | null => (to === undefined ? null : new Set(Array.isArray(to) ? to : [to]));

/** A rough byte count that never undercounts (UTF-8 is at most three bytes a UTF-16 unit), so most messages skip the encoder. */
function byteLength(raw: string | ArrayBuffer): number {
  if (typeof raw !== 'string') return raw.byteLength;
  if (raw.length * 3 <= ROOM_MESSAGE_MAX_BYTES || raw.length > ROOM_MESSAGE_MAX_BYTES) return raw.length;
  return new TextEncoder().encode(raw).byteLength;
}

/** The most spectators a room takes at once. */
export const WATCHERS_MAX = 16;

/** Spectators can come in: the game can be watched, the host lets them, and there is room for one more. */
export const canWatchRoom = (room: RoomState, watchers: number) => !!room.watch && room.watchable !== false && watchers < WATCHERS_MAX;

/** Someone can take a seat now: there is one free, and the room takes people at this point of its round. */
export function joinable(room: RoomState, people: number): boolean {
  if (people >= room.seats || (room.started && !room.lateJoin)) return false;
  return !room.quick || gathering(room);
}

/**
 * The room's line in the arcade's Open Rooms, or null when it doesn't belong there: private, without its host, or
 * nobody can join it (full of people, since bots step aside and never fill it; under way in a game nobody can join
 * mid-game; a quick-play room past gathering, which plays one round for the people who were in it). A room nobody can
 * join that is playing a round people can watch stays on, to watch (`watchOnly`).
 */
export function roomListing(room: RoomState, players: RoomPlayer[], bots: number, watchers = 0): OpenRoom | null {
  const host = players.find((player) => player.seat === 0);
  if (!room.listed || !room.code || !host) return null;
  const open = joinable(room, players.length);
  const watching = !open && room.started && canWatchRoom(room, watchers);
  if (!open && !watching) return null;
  const quick = room.quick ? { quick: true as const, ...(gathering(room) ? { startAt: room.startAt } : {}), ...(room.pool ? { pool: room.pool } : {}) } : {};
  const watch = room.watch && room.watchable !== false ? { watch: true as const } : {};
  return { code: room.code, game: room.game, host: host.name, players: players.length, bots, seats: room.seats, started: room.started, lateJoin: !!room.lateJoin, ...quick, ...watch, ...(watching ? { watchOnly: true as const } : {}) };
}

/** A line in the Lobby, and when its room last refreshed it. A quick room the Lobby handed out before anyone came in has no host yet. */
export type LobbyRow = { listing: OpenRoom; updated: number };

/**
 * The quick-play room to send someone to: of the ones in the same pool (none, or `pool`) still gathering with a seat to
 * spare and time left to get there, the fullest (so rooms fill up rather than split), then the one starting soonest.
 */
export function pickQuick(rows: LobbyRow[], now: number, pool?: string): OpenRoom | null {
  const open = rows.map((row) => row.listing).filter((r, i) =>
    r.quick && !r.started && !r.watchOnly && r.players < r.seats && (r.pool ?? '') === (pool ?? '') && (r.host !== '' || rows[i].updated > now - QUICK_PENDING_MS) && (r.startAt ?? Infinity) > now + QUICK_LATE_MS,
  );
  open.sort((a, b) => b.players - a.players || (a.startAt ?? 0) - (b.startAt ?? 0) || a.code.localeCompare(b.code));
  return open[0] ?? null;
}

/** Open Rooms order: rooms still gathering first, then the busiest, then the ones only to watch, then by code for a stable order. */
export function sortListings(rooms: OpenRoom[]): OpenRoom[] {
  return [...rooms].sort((a, b) => Number(!!a.watchOnly) - Number(!!b.watchOnly) || Number(a.started) - Number(b.started) || b.players - a.players || a.code.localeCompare(b.code));
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
 * someone left and a newcomer took their seat. With `prefer` (the seats playing a round that goes on), the lowest of
 * those still here first, so the new host has the round to run. Null when nobody is left.
 */
export function nextHost(players: RoomPlayer[], prefer?: readonly number[]): RoomPlayer | null {
  const lowest = (list: RoomPlayer[]) => list.reduce<RoomPlayer | null>((best, player) => (best === null || player.seat < best.seat ? player : best), null);
  return (prefer && lowest(players.filter((player) => prefer.includes(player.seat)))) || lowest(players);
}

/**
 * A round that goes on past a host hand-off (rooms with `migrate`): the person in seat `from` is the host now (seat 0)
 * and the old host is gone, so the round's lineup and what each seat has said won it so far move to the new numbering.
 * A word from the old host, and any naming it the winner, no longer counts.
 */
export function handOffRound(room: RoomState, reports: RoundReports, from: number) {
  const seat = (s: number) => (s === from ? 0 : s);
  if (room.roster) room.roster = room.roster.filter((s) => s !== 0).map(seat);
  const said = reports[String(room.round ?? 0)];
  if (!said) return;
  const next: Record<string, number | number[] | null> = {};
  for (const [key, winner] of Object.entries(said)) {
    if (key === '0') continue;
    const team = Array.isArray(winner) ? winner.filter((s) => s !== 0).map(seat) : null;
    next[String(seat(Number(key)))] = team ? (team.length ? team : null) : winner === null || winner === 0 ? null : seat(winner);
  }
  reports[String(room.round ?? 0)] = next;
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
  if (byteLength(raw) > ROOM_MESSAGE_MAX_BYTES) return null;

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
  if (message.t === 'watchable') return typeof message.on === 'boolean' ? { t: 'watchable', on: message.on } : null;
  if (message.t === 'watch') return Object.hasOwn(message, 'd') ? { t: 'watch', d: message.d } : null;
  if (message.t === 'msg') {
    if (!Object.hasOwn(message, 'd')) return null;
    const fast = message.f === 1 ? { fast: true as const } : {};
    if (message.to === undefined) return { t: 'msg', d: message.d, ...fast };
    if (Array.isArray(message.to)) {
      const to = message.to;
      return to.length && to.length <= seats && to.every((s) => validSeat(s, seats)) && new Set(to).size === to.length ? { t: 'msg', to: [...(to as number[])], d: message.d, ...fast } : null;
    }
    return validSeat(message.to, seats) ? { t: 'msg', to: message.to, d: message.d, ...fast } : null;
  }
  if (message.t === 'signal') {
    return validSeat(message.to, seats) && Object.hasOwn(message, 'd') ? { t: 'signal', to: message.to, d: message.d } : null;
  }
  if (message.t === 'result') {
    if (!Number.isSafeInteger(message.round) || (message.round as number) < 0 || !(message.winner === null || validSeat(message.winner, seats))) return null;
    // a winning team: every seat on it, the winner's among them, each once
    if (message.team === undefined) return { t: 'result', round: message.round as number, winner: message.winner as number | null };
    const team = message.team;
    if (message.winner === null || !Array.isArray(team) || !team.length || team.length > seats || !team.every((s) => validSeat(s, seats)) || new Set(team).size !== team.length || !team.includes(message.winner)) return null;
    return { t: 'result', round: message.round as number, winner: message.winner as number, team: [...(team as number[])].sort((a, b) => a - b) };
  }
  return null;
}

/** What each seat said won each round: a seat, a winning team's seats, or null for nobody. */
export type RoundReports = Record<string, Record<string, number | number[] | null>>;
export type RecordedRounds = number[];

export function agreedWinner(
  reports: RoundReports,
  connectedSeats: Iterable<number>,
  round: number,
): number | null {
  return agreedWinners(reports, connectedSeats, round)?.[0] ?? null;
}

/** The seats every connected seat agrees won a round (one, or a whole team), or null when they don't all agree. */
export function agreedWinners(reports: RoundReports, connectedSeats: Iterable<number>, round: number): number[] | null {
  const connected = [...new Set(connectedSeats)];
  if (connected.length < 2) return null;
  const roundReports = reports[String(round)];
  if (!roundReports) return null;
  const winners = connected.map((seat) => roundReports[String(seat)]);
  if (winners.some((winner) => winner === undefined || winner === null)) return null;
  const key = (w: number | number[]) => (Array.isArray(w) ? w : [w]).join();
  const first = winners[0]!;
  return winners.every((winner) => key(winner!) === key(first)) ? (Array.isArray(first) ? first : [first]) : null;
}

export function markRoundRecorded(recorded: RecordedRounds, round: number): boolean {
  if (recorded.includes(round)) return false;
  recorded.push(round);
  return true;
}
