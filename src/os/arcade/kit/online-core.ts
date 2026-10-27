export function advanceOnlineRound(round: number) {
  return round + 1;
}

export function roundLeftVerdict(o: {
  phoneFirst: boolean;
  watching: boolean;
  inRound: number;
  bots: number;
  players: number;
}): { title: string; detail: string } | null {
  if (o.phoneFirst || o.inRound + o.bots >= 2) return null;
  return o.watching
    ? { title: 'Round Over', detail: 'A Player Left, So Nobody Is Left to Play This Round.' }
    : { title: 'Opponent Left', detail: o.players > 1 ? 'Nobody Is Left in This Round.' : 'Your Opponent Left the Room.' };
}

/** The most seats a room has: a game's own room holds as many as its meta says, never more than this. */
export const MAX_SEATS = 20;

export type RelayPlan = { direct: number[]; relay: number[]; relayAll: boolean };

export function relayPlan(recipients: number[], open: (seat: number) => boolean, broadcast: boolean): RelayPlan {
  const direct: number[] = [];
  const relay: number[] = [];
  for (const seat of recipients) (open(seat) ? direct : relay).push(seat);
  return { direct, relay, relayAll: broadcast && recipients.length >= 2 && relay.length === recipients.length };
}

/**
 * A public room as the arcade's Open Rooms lists it (GET /rooms). players counts people; bots fill other seats. quick:
 * a quick-play room, gathering people until it starts on its own (at startAt, epoch ms on the Worker's clock), for the
 * quick-play pool `pool` (a game's mode, say) if it has one. watch: people can watch it; watchOnly: nobody can join it
 * right now (a round is under way, or it is full), only watch.
 */
export type OpenRoom = { code: string; game: string; host: string; players: number; bots: number; seats: number; started: boolean; lateJoin: boolean; quick?: true; startAt?: number; pool?: string; watch?: true; watchOnly?: true };

/** A quick-play pool's name as Open Rooms shows it: "duos" is Duos. */
const poolName = (pool: string) => pool.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
/** The most open rooms listed at once. */
export const OPEN_ROOMS_MAX = 40;

/** Reads a GET /rooms body: the rooms that look right, at most OPEN_ROOMS_MAX, in the order the Worker sent them. */
export function parseOpenRooms(body: unknown): OpenRoom[] {
  const list = body && typeof body === 'object' ? (body as { rooms?: unknown }).rooms : null;
  if (!Array.isArray(list)) return [];
  const count = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
  const rooms: OpenRoom[] = [];
  for (const raw of list) {
    if (rooms.length >= OPEN_ROOMS_MAX) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.code !== 'string' || !/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(r.code)) continue;
    if (typeof r.game !== 'string' || !/^[a-z0-9-]{1,40}$/.test(r.game) || typeof r.host !== 'string') continue;
    if (!count(r.seats, MAX_SEATS) || r.seats < 2 || !count(r.players, r.seats) || !count(r.bots, r.seats)) continue;
    const pool = r.quick === true && typeof r.pool === 'string' && /^[a-z0-9-]{1,16}$/.test(r.pool) ? { pool: r.pool } : {};
    rooms.push({ code: r.code, game: r.game, host: r.host.slice(0, 32), players: r.players, bots: r.bots, seats: r.seats, started: r.started === true, lateJoin: r.lateJoin === true, ...(r.quick === true ? { quick: true as const } : {}), ...pool, ...(r.watch === true ? { watch: true as const } : {}), ...(r.watch === true && r.watchOnly === true ? { watchOnly: true as const } : {}) });
  }
  return rooms;
}

const botCount = (room: OpenRoom) => (room.bots ? (room.bots === 1 ? '1 Bot' : `${room.bots} Bots`) : '');

/** A quick-play room's kind, with its pool: "Quick Play", or "Quick Play Duos". */
const quickKind = (room: OpenRoom) => (room.quick ? (room.pool ? `Quick Play ${poolName(room.pool)}` : 'Quick Play') : '');

/** How full an open room is, for its line in Open Rooms: "2/8 · 3 Bots · Playing", or "Quick Play · 2/20 · 18 Bots". */
export function openRoomLine(room: OpenRoom): string {
  return [quickKind(room), `${room.players}/${room.seats}`, botCount(room), room.started ? 'Playing' : ''].filter(Boolean).join(' · ');
}

/** What the button on an open room does: join it, or only watch the round under way. */
export const openRoomAction = (room: OpenRoom) => (room.watchOnly ? 'Watch' : 'Join');

/** An open room's line in the Lounge's list, saying what joining it means: "1/4 · 2 Bots · Waiting for players". */
export function openRoomDetail(room: OpenRoom): string {
  const what = room.watchOnly ? 'Playing, watch it live' : room.quick ? 'Starting soon' : room.started ? 'Playing, join for the next round' : 'Waiting for players';
  return [quickKind(room), `${room.players}/${room.seats}`, botCount(room), what].filter(Boolean).join(' · ');
}

/** Bots in seat order, named from the game's list or Bot 1, Bot 2 and so on, so every player sees the same names. */
export function botPlayers(seats: readonly number[], names: readonly string[] = []): { seat: number; name: string }[] {
  return seats.map((seat, i) => ({ seat, name: names[i] ?? `Bot ${i + 1}` }));
}

/** The round a start message begins: the server's shared number when it sends one, else the next local one. */
export function nextOnlineRound(round: number, server: number | null) {
  return server ?? advanceOnlineRound(round);
}

/**
 * Whether the host's Play Again starts the next round now: someone to play, the round over for everyone (`waiting`: the
 * host is out early and its game still runs the round for the others), and in a race nobody still playing unless
 * `force`d (starting then ends their round).
 */
export function canStartNext(next: { ready: boolean; waiting: boolean; racing: boolean }, force = false) {
  return next.ready && !next.waiting && (!next.racing || force);
}

/**
 * The room after a host hand-off: whoever sat in `from` is the host now (seat 0) and the old host is gone. Moves
 * seat-keyed race state to the new numbering, so a finished player's score stays theirs.
 */
export function handOffSeat(seat: number, from: number) {
  return seat === from ? 0 : seat === 0 ? from : seat;
}
export function handOffScores<T>(scores: Record<number, T>, from: number): Record<number, T> {
  return Object.fromEntries(Object.entries(scores).map(([seat, value]) => [handOffSeat(Number(seat), from), value]));
}

/** Final scores of a score race by seat. null means the player finished without a score. */
export type RaceScores = Record<number, number | null>;
export type RaceStanding = { seat: number; score: number | null; place: number | null };

/**
 * Standings of a score race among the seats still in the room. The best score places first;
 * players without a score place last, and tied seats keep the order of `seats`. `done` once every seat has finished,
 * and `winner` is the single best seat (null for a tie or when nobody scored). `minSeats` is how many seats a finished
 * race needs; 1 lets the last racer still here settle a race that the others left before finishing.
 */
export function raceStandings(scores: RaceScores, seats: number[], lowerIsBetter = false, minSeats = 2): { done: boolean; winner: number | null; standings: RaceStanding[] } {
  const finished = seats.filter((seat) => Object.hasOwn(scores, seat));
  const better = (a: number, b: number) => (lowerIsBetter ? a - b : b - a);
  const ranked = finished
    .map((seat) => ({ seat, score: scores[seat] }))
    .sort((a, b) => (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0) || (a.score !== null && b.score !== null ? better(a.score, b.score) : 0) || seats.indexOf(a.seat) - seats.indexOf(b.seat));
  const standings: RaceStanding[] = ranked.map(({ seat, score }) => ({
    seat,
    score,
    place: score === null ? null : 1 + ranked.filter((other) => other.score !== null && better(other.score, score) < 0).length,
  }));
  for (const seat of seats) if (!Object.hasOwn(scores, seat)) standings.push({ seat, score: null, place: null });
  const done = seats.length >= Math.max(1, minSeats) && finished.length === seats.length;
  const leaders = standings.filter((entry) => entry.place === 1);
  return { done, winner: done && leaders.length === 1 ? leaders[0].seat : null, standings };
}

/** A race once everyone in it has finished: its seats and their names, so leaving afterwards keeps the result. */
export type SettledRace = { round: number; seats: number[]; names: Record<number, string> };

/** A settled race in the room's numbering after a host hand-off (see handOffSeat): everyone keeps their own result. */
export function handOffSettled(settled: SettledRace, from: number): SettledRace {
  return { round: settled.round, seats: settled.seats.map((seat) => handOffSeat(seat, from)), names: handOffScores(settled.names, from) };
}

/** The seats this round's race is between: the settled lineup once it is decided, else the people still here. */
export function raceSeats(present: number[], settled: SettledRace | null, round: number) {
  return settled && settled.round === round ? settled.seats : present;
}

/** The line under a race's standings, as seen from seat `mine`. `alone`: everyone else left before finishing. */
export function raceVerdict(race: { done: boolean; winner: number | null }, alone: boolean, mine: number | null, name: (seat: number) => string | undefined) {
  if (!race.done) return 'Waiting For Everyone to Finish';
  if (alone) return 'Everyone Else Left Before Finishing';
  if (race.winner === null) return 'A Tie';
  return race.winner === mine ? 'You Win the Race' : `${name(race.winner) ?? 'Someone'} Wins the Race`;
}

/** Parses a race packet from the room. Guests send their own score; the host sends everyone's. */
export function parseRacePacket(value: unknown): { t: 'race'; round: number; score: number | null } | { t: 'race-all'; round: number; scores: RaceScores } | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (!Number.isSafeInteger(packet.round)) return null;
  const round = packet.round as number;
  const validScore = (score: unknown): score is number | null => score === null || (typeof score === 'number' && Number.isFinite(score));
  if (packet.t === 'race') return validScore(packet.score) ? { t: 'race', round, score: packet.score } : null;
  if (packet.t !== 'race-all' || !packet.scores || typeof packet.scores !== 'object') return null;
  const scores: RaceScores = {};
  for (const [key, score] of Object.entries(packet.scores as Record<string, unknown>)) {
    const seat = Number(key);
    if (Number.isInteger(seat) && seat >= 0 && seat < MAX_SEATS && validScore(score)) scores[seat] = score;
  }
  return { t: 'race-all', round, scores };
}

/** Game messages travel as { '~r': round, d } so each lands in the round it was sent for. */
const ROUND_TAG = '~r';
/** The most messages held for a round that hasn't started here yet. */
const HELD_MAX = 512;
type Held = { from: number; round: number; d: unknown };

export function tagRound(round: number, d: unknown) {
  return { [ROUND_TAG]: round, d };
}

/**
 * Hands game messages to the round they belong to. The host's first messages of a round can arrive (over a direct link)
 * before this player's own start does (over the room's socket), or before the round's fresh game has subscribed; those
 * wait until it has. Messages from a finished round are dropped. A player between rounds or sitting one out (not
 * `live`) gets everything as it comes, and so does anything untagged or sent from round 0 (before any round), so
 * clients that don't tag still work.
 */
export class RoundRouter {
  round = 0;
  /** A round is starting here and its game hasn't subscribed yet. */
  holding = false;
  private held: Held[] = [];
  private readonly listeners = new Set<(from: number, d: unknown) => void>();

  listen(listener: (from: number, d: unknown) => void): () => void {
    this.listeners.add(listener);
    // A game that subscribes late still gets what waited for it, once every listener that's subscribing now is in.
    if (!this.holding && this.held.some((m) => m.round === this.round)) queueMicrotask(() => this.flush());
    return () => this.listeners.delete(listener);
  }

  /** Where this player is joining: the room's latest round, for a latecomer. */
  join(round: number) {
    this.round = round;
    this.holding = false;
    this.held = [];
  }

  /** A round starts here: its messages wait until release(), and older rounds' are gone. */
  begin(round: number) {
    this.round = round;
    this.holding = true;
    this.held = this.held.filter((m) => m.round >= round);
  }

  /** The round's game is subscribed: hand it what arrived early. */
  release() {
    this.holding = false;
    this.flush();
  }

  receive(from: number, raw: unknown, live: boolean) {
    const tagged = !!raw && typeof raw === 'object' && Object.hasOwn(raw, ROUND_TAG) && Object.hasOwn(raw, 'd');
    if (!tagged) return this.deliver(from, raw);
    const round = (raw as Record<string, unknown>)[ROUND_TAG];
    const d = (raw as { d: unknown }).d;
    if (!Number.isSafeInteger(round) || !live || round === 0) return this.deliver(from, d);
    const r = round as number;
    if (r < this.round) return;
    if (r > this.round || this.holding || !this.listeners.size) {
      if (this.held.length >= HELD_MAX) this.held.shift();
      this.held.push({ from, round: r, d });
      return;
    }
    this.deliver(from, d);
  }

  private flush() {
    if (this.holding || !this.listeners.size) return;
    const now = this.held.filter((m) => m.round === this.round);
    this.held = this.held.filter((m) => m.round > this.round);
    for (const m of now) this.deliver(m.from, m.d);
  }

  private deliver(from: number, d: unknown) {
    for (const listener of [...this.listeners]) listener(from, d);
  }
}
