import { DurableObject } from 'cloudflare:workers';
import { previewSize, validateSubmission, TOP, type BoardEntry, type BoardTops } from '../../src/os/arcade/kit/leaderboard-core.ts';
import type { LeaderboardSpec } from '../../src/os/arcade/types.ts';
import { cleanName, nameLength } from '../../src/os/arcade/kit/leaderboard-core.ts';
import { dayKey, isVisitorId, KEEP_DAYS, MAX_GAMES, parseHit, periodStarts, shiftDay, TOP_GAMES, type StatsHit, type StatsSummary, type TopGame } from '../../src/os/stats-core.ts';
import { cleanText, isSession, readIndex, webhookSecret, type TgUpdate } from '../../src/os/chat-core.ts';
import type { OnlineSpec } from '../../src/os/arcade/types.ts';
import { isChannel, sameSecret } from '../../src/os/arcade/lounge-core.ts';
import { Chat, type ChatEnv } from './chat';
import { Lobby } from './lobby';
import { Lounge, type LoungeEnv } from './lounge';
import { Telemetry, type TelemetryEnv } from './telemetry';
import { LEADERBOARD_SPECS, ONLINE_SPECS } from './specs.gen';
import { agreedWinners, beginRound, benchSeat, botSeats, canJoinRoom, canResume, keepFor, canStartRoom, canWatchRoom, endRound, GATHER_MS, gatherFull, gathering, handOffRound, HOLD_MS, holdsDue, holdUntil, isPool, isRelayMessage, lowestFreeSeat, makeRoomCode, markRoundRecorded, nextAlarm, nextHost, orphanSeats, parseRoomMessage, relayTargets, RESUME_VERSION, roomListing, roundPlayable, roundSeats, seatsFor, type Hold, type RecordedRounds, type RelayRoomMessage, type RoomPlayer, type RoomState, type RoundReports, type SeatKey } from './room-core';
import { MAX_BODY_BYTES } from '../../src/os/arcade/games/soccer/telemetry-core.ts';

export { Chat, Lobby, Lounge, Telemetry };

interface Env extends ChatEnv, LoungeEnv, TelemetryEnv {
  BOARDS: DurableObjectNamespace<Boards>;
  ROOMS: DurableObjectNamespace<Room>;
  STATS: DurableObjectNamespace<Stats>;
  CHAT: DurableObjectNamespace<Chat>;
  LOUNGE: DurableObjectNamespace<Lounge>;
  LOBBY: DurableObjectNamespace<Lobby>;
  TELEMETRY: DurableObjectNamespace<Telemetry>;
}

const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;
/** Generous on purpose: a whole classroom behind one IP refreshing and replaying should all count. */
const STATS_RATE_LIMIT = 240;
/** Open tabs allowed per IP and in total, so a script can't fake a crowd or exhaust the object. */
const LIVE_PER_IP = 200;
const LIVE_MAX = 20_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function boardEntries(sql: SqlStorage, game: string, spec: LeaderboardSpec, limit = TOP): BoardEntry[] {
  const direction = spec.order === 'desc' ? 'DESC' : 'ASC';
  return sql.exec<BoardEntry>(
    `SELECT name, score, date FROM scores WHERE game = ? ORDER BY score ${direction}, date ASC LIMIT ?`,
    game,
    limit,
  ).toArray();
}

function winEntries(sql: SqlStorage, game: string, limit = TOP): BoardEntry[] {
  return sql.exec<BoardEntry>('SELECT name, wins AS score, date FROM wins WHERE game = ? ORDER BY wins DESC, date ASC LIMIT ?', game, limit).toArray();
}

export class Boards extends DurableObject<Env> {
  private readonly submissions = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS scores (game TEXT NOT NULL, name TEXT NOT NULL, score REAL NOT NULL, date TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS scores_game ON scores (game, score)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS wins (game TEXT NOT NULL, name TEXT NOT NULL, wins INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (game, name))');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/wins' && request.method === 'GET') {
      const game = url.searchParams.get('game') ?? '';
      if (!Object.hasOwn(ONLINE_SPECS, game)) return json({ error: 'unknown game' }, 404);
      try {
        return json({ entries: winEntries(this.ctx.storage.sql, game) });
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }

    // The arcade's Leaderboards cards: the best few of every board in one request (`?n=`, 3 by default, at most 10).
    if (url.pathname === '/leaderboard/top' && request.method === 'GET') {
      const n = previewSize(url.searchParams.get('n'));
      const sql = this.ctx.storage.sql;
      try {
        const tops: BoardTops = {
          boards: Object.fromEntries(Object.entries(LEADERBOARD_SPECS).map(([game, spec]) => [game, boardEntries(sql, game, spec, n)])),
          wins: Object.fromEntries(Object.keys(ONLINE_SPECS).map((game) => [game, winEntries(sql, game, n)])),
        };
        return json(tops);
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }

    if (url.pathname !== '/leaderboard') return json({ error: 'not found' }, 404);

    if (request.method === 'GET') {
      const game = url.searchParams.get('game') ?? '';
      const spec = Object.hasOwn(LEADERBOARD_SPECS, game) ? LEADERBOARD_SPECS[game] : undefined;
      if (!spec) return json({ error: 'unknown game' }, 404);
      try {
        return json({ entries: boardEntries(this.ctx.storage.sql, game, spec) });
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }

    if (request.method !== 'POST') return json({ error: 'not found' }, 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid body' }, 400);
    }

    const parsed = validateSubmission(body, LEADERBOARD_SPECS);
    if (!parsed.value) return json({ error: parsed.error }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const recent = (this.submissions.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      this.submissions.set(ip, recent);
      return json({ error: 'rate limited' }, 429, { 'retry-after': '60' });
    }
    recent.push(now);
    this.submissions.set(ip, recent);

    const { game, name, score } = parsed.value;
    const spec = LEADERBOARD_SPECS[game];
    const direction = spec.order === 'desc' ? 'DESC' : 'ASC';
    const date = new Date().toISOString();
    try {
      this.ctx.storage.sql.exec('INSERT INTO scores (game, name, score, date) VALUES (?, ?, ?, ?)', game, name, score, date);
      this.ctx.storage.sql.exec(
        `DELETE FROM scores WHERE game = ? AND rowid NOT IN (SELECT rowid FROM scores WHERE game = ? ORDER BY score ${direction}, date ASC LIMIT ${TOP})`,
        game,
        game,
      );
      return json({ entries: boardEntries(this.ctx.storage.sql, game, spec) });
    } catch {
      return json({ error: 'unavailable' }, 503);
    }
  }

  recordWin(game: string, rawName: string): void {
    if (!Object.hasOwn(ONLINE_SPECS, game) || typeof rawName !== 'string') return;
    const name = cleanName(rawName);
    if (nameLength(name) < 1 || nameLength(name) > 16) return;
    this.ctx.storage.sql.exec(
      'INSERT INTO wins (game, name, wins, date) VALUES (?, ?, 1, ?) ON CONFLICT(game, name) DO UPDATE SET wins = wins + 1, date = excluded.date',
      game,
      name,
      new Date().toISOString(),
    );
  }
}

/**
 * v: the room protocol the client speaks; 2 and up follow a host hand-off (older clients only know the room closing).
 * watch: a spectator, with no seat (seat -1): it gets what the room says and the host's game shares, and sends nothing.
 * key: the seat's key, for coming back to it (protocol 4, see RESUME_VERSION). gone: a socket its player has come back
 * past (a connection that died without the room noticing), on its way out.
 */
type Attachment = { seat: number; name: string; v?: number; watch?: true; key?: string; gone?: true };
/** Clients that follow a host hand-off: when one of these is left without a host, the next one takes over. */
const HANDOFF_VERSION = 2;
/** Clients that know spectators, and are told why a room can't take them on the socket rather than by a refused request. */
const WATCH_VERSION = 3;

/**
 * Turns someone away with a reason they can show (not-found, started, full, no-watching), and whether they could watch
 * the room instead: the socket opens just long enough to say so.
 */
function refuse(reason: string, watch = false): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify({ t: 'closed', reason, ...(watch ? { watch: true } : {}) }));
  // The client closes it once it has read why (closing at once can lose the message on its way); this is the backstop.
  setTimeout(() => {
    try {
      server.close(1000, reason);
    } catch {
      /* already closed */
    }
  }, 5000);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
type RoomResults = { reports: RoundReports; recorded: RecordedRounds };
/** Seat keys and the seats waiting for their players to come back (see RESUME_VERSION), as kept in storage. */
type RoomSeats = { keys: Record<string, SeatKey>; held: Record<string, Hold> };

const newSeatKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class Room extends DurableObject<Env> {
  private operations: Promise<unknown> = Promise.resolve();
  private seatsCache: number | null = null;
  /**
   * What each socket's attachment says, read once: deserializing it for every socket on every relayed message was most
   * of what a relay cost. Kept in step with every serializeAttachment (see attach).
   */
  private readonly attachments = new WeakMap<WebSocket, Attachment | null>();
  /** Seat keys and holds, loaded from storage once per wake-up (see seatState). */
  private seatsState: RoomSeats | null = null;
  /** Game messages for seats held for someone coming back, delivered when they do (in memory: a restart loses them). */
  private readonly backlogs = new Map<number, { data: string[]; bytes: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * listed: a public room, shown in the arcade's Open Rooms once its host is in. quick: a quick-play room (public, with
   * bots in every seat nobody holds), which starts on its own GATHER_MS from now, or closes then if nobody came; pool:
   * the quick-play pool it gathers for.
   */
  open(code: string, game: string, spec: OnlineSpec, listed = false, quick = false, pool?: string): Promise<boolean> {
    return this.exclusive(async () => {
      const existing = await this.ctx.storage.get<RoomState>('room');
      if (existing) {
        this.seatsCache = existing.seats;
        return false;
      }
      const seats = seatsFor(spec);
      this.seatsCache = seats;
      const gather = quick ? { quick: true, startAt: Date.now() + GATHER_MS, ...(pool ? { pool } : {}) } : {};
      await this.ctx.storage.put<RoomState>('room', { code, game, seats, started: false, lateJoin: !!spec.lateJoin, ...(spec.bots ? { allowBots: true, bots: quick ? seats - 1 : 0 } : {}), ...(listed || quick ? { listed: true } : {}), ...(spec.watch ? { watch: true, watchable: true } : {}), ...(spec.migrate ? { migrate: true } : {}), ...gather });
      await this.ctx.storage.put<RoomResults>('results', { reports: {}, recorded: [] });
      this.seatsState = { keys: {}, held: {} };
      await this.ctx.storage.put<RoomSeats>('seats', this.seatsState);
      if (quick) await this.ctx.storage.setAlarm(gather.startAt!);
      return true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(() => this.join(request));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (this.seatsCache !== null) {
      const parsed = parseRoomMessage(message, this.seatsCache);
      if (isRelayMessage(parsed)) {
        this.handleRelayMessage(ws, parsed);
        return;
      }
    }
    return this.exclusive(() => this.handleMessage(ws, message));
  }

  /**
   * While the room is listed, its line in Open Rooms is refreshed every minute, so it never goes stale. A quick-play
   * room starts when its gathering time is up (or closes, if nobody came; one that can't start yet gathers longer).
   * A seat held for someone whose connection dropped is let go once they have had HOLD_MS to come back.
   */
  async alarm() {
    await this.exclusive(async () => {
      const room = await this.ctx.storage.get<RoomState>('room');
      if (!room) return;
      this.seatsCache = room.seats;
      const state = await this.seatState(room);
      for (const seat of holdsDue(state.held, Date.now())) {
        delete state.held[String(seat)];
        delete state.keys[String(seat)];
        this.backlogs.delete(seat);
        await this.saveSeats();
        if (await this.leaveSeat(room, seat, null)) return;
      }
      if (gathering(room) && room.startAt! <= Date.now()) {
        const players = this.players();
        if (!players.length) return this.close();
        if (await this.begin(room, players)) return;
        room.startAt = Date.now() + GATHER_MS;
        await this.ctx.storage.put('room', room);
      }
      await this.publish(room, this.players());
    });
  }

  /** Starts the next round, when there is someone to play: everyone in the room, and the bots. */
  private async begin(room: RoomState, players: RoomPlayer[]): Promise<boolean> {
    const lineup = this.lineup(room, players);
    if (!canStartRoom(0, lineup.players.length, lineup.bots?.length)) return false;
    const round = beginRound(room, lineup.players.map(({ seat }) => seat), lineup.bots?.length ?? 0);
    await this.ctx.storage.put('room', room);
    this.broadcast({ t: 'start', ...this.lineup(room, lineup.players), round });
    await this.publish(room, lineup.players);
    return true;
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.attachment(ws);
    // spectators only watch
    if (!attachment || attachment.watch) return;
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return;
    this.seatsCache = room.seats;
    await this.seatState(room);
    const parsed = parseRoomMessage(message, room.seats);
    if (!parsed) return;

    // A quick-play room starts on its own.
    if (parsed.t === 'start') {
      if (attachment.seat === 0 && !room.quick) await this.begin(room, this.players());
      return;
    }

    // The host's game says the round is over: the room takes people again (and goes back on Open Rooms) until the next.
    if (parsed.t === 'over') {
      if (attachment.seat !== 0 || !endRound(room, parsed.round)) return;
      await this.ctx.storage.put('room', room);
      const players = this.players();
      this.broadcast({ t: 'players', ...this.lineup(room, players), started: false });
      await this.publish(room, players);
      return;
    }

    if (isRelayMessage(parsed)) {
      this.handleRelayMessage(ws, parsed);
      return;
    }

    if (parsed.t === 'bots' || parsed.t === 'listed' || parsed.t === 'watchable') {
      if (attachment.seat !== 0) return;
      if (parsed.t === 'bots') {
        if (!room.allowBots) return;
        room.bots = parsed.n;
      } else if (parsed.t === 'watchable') {
        if (!room.watch) return;
        room.watchable = parsed.on;
        // turned off: whoever is watching has to go
        if (!parsed.on) {
          for (const socket of this.watchers()) {
            this.trySend(socket, JSON.stringify({ t: 'closed', reason: 'no-watching' }));
            socket.close(1000, 'no-watching');
          }
        }
      } else room.listed = parsed.on;
      await this.ctx.storage.put('room', room);
      const lineup = this.lineup(room, this.players());
      this.broadcast({ t: 'players', ...lineup });
      await this.publish(room, lineup.players);
      return;
    }

    // a result needs the word of everyone connected right now (someone away for a moment can't give theirs)
    const connected = this.connected();
    const resultState = (await this.ctx.storage.get<RoomResults>('results')) ?? { reports: {}, recorded: [] };
    const roundKey = String(parsed.round);
    const roundReports = resultState.reports[roundKey] ?? {};
    roundReports[String(attachment.seat)] = parsed.team ?? parsed.winner;
    resultState.reports[roundKey] = roundReports;
    const winners = agreedWinners(resultState.reports, roundSeats(room, connected.map(({ seat }) => seat), parsed.round), parsed.round);
    // a winning team: a win for each person on it who is still here
    const names = (winners ?? []).map((seat) => connected.find((player) => player.seat === seat)?.name).filter((name): name is string => !!name);
    if (names.length && markRoundRecorded(resultState.recorded, parsed.round)) {
      await this.ctx.storage.put('results', resultState);
      try {
        for (const name of names) await this.env.BOARDS.get(this.env.BOARDS.idFromName('global')).recordWin(room.game, name);
      } catch {
        return;
      }
      return;
    }
    await this.ctx.storage.put('results', resultState);
  }

  private handleRelayMessage(ws: WebSocket, parsed: RelayRoomMessage) {
    const attachment = this.attachment(ws);
    if (!attachment || attachment.watch) return;
    if (parsed.t === 'watch') {
      if (attachment.seat !== 0) return;
      const data = JSON.stringify({ t: 'msg', from: 0, d: parsed.d });
      for (const socket of this.watchers()) this.trySend(socket, data);
      return;
    }
    const packet = { t: parsed.t, from: attachment.seat, d: parsed.d };
    const targets = relayTargets(parsed.to);
    if (!targets) this.broadcast(packet, ws, true);
    else this.sendTo(targets, packet, ws);
    // someone away for a moment gets it when they're back (not a snapshot the next one replaces, nor a link signal)
    const held = this.seatsState?.held;
    if (parsed.t !== 'msg' || parsed.fast || !held) return;
    let data: string | null = null;
    for (const key of Object.keys(held)) {
      const seat = Number(key);
      if (seat === attachment.seat || (targets && !targets.has(seat))) continue;
      let backlog = this.backlogs.get(seat);
      if (!backlog) this.backlogs.set(seat, (backlog = { data: [], bytes: 0 }));
      keepFor(backlog, (data ??= JSON.stringify(packet)));
    }
  }

  async webSocketClose(ws: WebSocket, code?: number, reason?: string) {
    const attachment = this.attachment(ws);
    await this.exclusive(() => this.onSocketClose(ws, attachment, code === 1000 && reason === 'leave'));
  }

  async webSocketError(ws: WebSocket) {
    const attachment = this.attachment(ws);
    await this.exclusive(() => this.onSocketClose(ws, attachment, false));
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation);
    this.operations = next.then(() => undefined, () => undefined);
    return next;
  }

  /** A socket's attachment, read from the socket the first time and from memory after that. */
  private attachment(ws: WebSocket): Attachment | null {
    if (this.attachments.has(ws)) return this.attachments.get(ws)!;
    const value = (ws.deserializeAttachment() as Attachment | null) ?? null;
    this.attachments.set(ws, value);
    return value;
  }

  private attach(ws: WebSocket, value: Attachment) {
    ws.serializeAttachment(value);
    this.attachments.set(ws, value);
  }

  /**
   * Seat keys and holds. The first time an object loads them (a fresh start, after the Worker was redeployed say, when
   * every socket is gone without a word) it holds every seat with a key and no socket, so everyone can come back.
   */
  private async seatState(room: RoomState): Promise<RoomSeats> {
    if (this.seatsState) return this.seatsState;
    const state = (await this.ctx.storage.get<RoomSeats>('seats')) ?? { keys: {}, held: {} };
    this.seatsState = state;
    const orphans = orphanSeats(state.keys, state.held, this.openSeated().map(({ seat }) => seat));
    if (orphans.length) {
      for (const seat of orphans) state.held[String(seat)] = { until: Date.now() + HOLD_MS, round: room.round ?? 0 };
      await this.saveSeats();
      await this.schedule(room, !!room.inLobby);
    }
    return state;
  }

  private async saveSeats() {
    if (this.seatsState) await this.ctx.storage.put<RoomSeats>('seats', this.seatsState);
  }

  private async join(request: Request): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'websocket upgrade required' }, 400);
    }
    const url = new URL(request.url);
    const version = Number(url.searchParams.get('v'));
    // Clients from before spectators only understand a refused HTTP request; newer ones are told why on the socket.
    const explains = Number.isSafeInteger(version) && version >= WATCH_VERSION;
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return explains ? refuse('not-found') : json({ error: 'room not found' }, 404);
    this.seatsCache = room.seats;
    const state = await this.seatState(room);
    const watchers = this.watchers().length;
    if (url.searchParams.get('watch') === '1') {
      if (!canWatchRoom(room, watchers)) return explains ? refuse(room.watch && room.watchable !== false ? 'full' : 'no-watching') : json({ error: 'not watchable' }, 409);
      return this.watch(room, url, version);
    }
    const code = /\/rooms\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4})\/ws$/.exec(url.pathname)?.[1] ?? '';
    // someone coming back to their own seat, round under way or not
    if (url.searchParams.has('key')) return this.resume(room, state, Number(url.searchParams.get('seat')), url.searchParams.get('key'), code, version);
    // a spectator, or anyone who reaches a room they can't take a seat in, is told whether they could watch instead
    const watch = canWatchRoom(room, watchers);
    if (!canJoinRoom(room)) return explains ? refuse('started', watch) : json({ error: 'room already started' }, 409);
    // A socket on its way out keeps its seat until it has gone, and a seat held for someone coming back stays theirs,
    // so nobody is ever given a seat someone still holds.
    const taken = [
      ...this.ctx.getWebSockets().map((socket) => this.attachment(socket)).filter((value): value is Attachment => !!value && !value.watch && !value.gone).map((value) => value.seat),
      ...Object.keys(state.held).map(Number),
    ];
    const seat = lowestFreeSeat(room.seats, taken);
    if (seat === null) return explains ? refuse('full', watch) : json({ error: 'room is full' }, 409);
    const existingPlayers = this.players();

    const cleaned = cleanName(url.searchParams.get('name') ?? '');
    const name = nameLength(cleaned) >= 1 && nameLength(cleaned) <= 16 ? cleaned : `Player ${seat + 1}`;
    const resumes = Number.isSafeInteger(version) && version >= RESUME_VERSION;
    const key = resumes ? newSeatKey() : undefined;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.attach(server, { seat, name, ...(Number.isSafeInteger(version) && version > 1 ? { v: version } : {}), ...(key ? { key } : {}) });
    this.ctx.acceptWebSocket(server);
    if (key) state.keys[String(seat)] = { key, name };
    else delete state.keys[String(seat)];
    await this.saveSeats();
    if (room.started) benchSeat(room, seat);
    if (room.started || gatherFull(room, existingPlayers.length + 1, Date.now())) await this.ctx.storage.put('room', room);
    const lineup = this.lineup(room, [...existingPlayers, { seat, name }].sort((a, b) => a.seat - b.seat));
    server.send(JSON.stringify({ t: 'welcome', seat, code, game: room.game, seats: room.seats, ...lineup, started: room.started, round: room.round ?? 0, ...(room.pool ? { pool: room.pool } : {}), multi: true, ...(key ? { key } : {}) }));
    this.broadcast({ t: 'players', ...lineup, started: room.started });
    await this.publish(room, lineup.players);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Someone whose connection dropped comes back to their seat with its key: in the round under way too (unless a new
   * one started without them, which they sit out), and nobody else saw them go. A socket the room still thinks is
   * theirs (a connection that died without closing) is let go quietly.
   */
  private async resume(room: RoomState, state: RoomSeats, seat: number, key: string | null, code: string, version: number): Promise<Response> {
    if (!canResume(state.keys, seat, key)) return refuse('expired');
    const name = state.keys[String(seat)].name;
    for (const socket of this.ctx.getWebSockets()) {
      const value = this.attachment(socket);
      if (!value || value.watch || value.seat !== seat || value.gone) continue;
      this.attach(socket, { ...value, gone: true });
      try {
        socket.close(1000, 'replaced');
      } catch {
        /* already closing */
      }
    }
    const hold = state.held[String(seat)];
    delete state.held[String(seat)];
    await this.saveSeats();
    if (room.started && hold && hold.round !== (room.round ?? 0)) {
      benchSeat(room, seat);
      await this.ctx.storage.put('room', room);
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.attach(server, { seat, name, v: Math.max(RESUME_VERSION, Number.isSafeInteger(version) ? version : 0), key: key! });
    this.ctx.acceptWebSocket(server);
    const players = this.players();
    const lineup = this.lineup(room, players);
    server.send(JSON.stringify({ t: 'welcome', seat, code, game: room.game, seats: room.seats, ...lineup, started: room.started, round: room.round ?? 0, ...(room.pool ? { pool: room.pool } : {}), multi: true, key, resumed: true }));
    // what was said to them while they were away, then (the host links up with them directly again)
    for (const data of this.backlogs.get(seat)?.data ?? []) this.trySend(server, data);
    this.backlogs.delete(seat);
    this.broadcast({ t: 'back', seat }, server);
    await this.schedule(room, !!room.inLobby);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** A spectator comes in: no seat, the room as it is (a round under way included), and everyone hears they're here. */
  private async watch(room: RoomState, url: URL, version: number): Promise<Response> {
    const cleaned = cleanName(url.searchParams.get('name') ?? '');
    const name = nameLength(cleaned) >= 1 && nameLength(cleaned) <= 16 ? cleaned : 'Spectator';
    const code = /\/rooms\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4})\/ws$/.exec(url.pathname)?.[1] ?? '';
    const pair = new WebSocketPair();
    const server = pair[1];
    this.attach(server, { seat: -1, name, watch: true, ...(Number.isSafeInteger(version) && version > 1 ? { v: version } : {}) });
    this.ctx.acceptWebSocket(server);
    const players = this.players();
    const lineup = this.lineup(room, players);
    server.send(JSON.stringify({ t: 'welcome', seat: -1, watch: true, code, game: room.game, seats: room.seats, ...lineup, started: room.started, round: room.round ?? 0, ...(room.pool ? { pool: room.pool } : {}), ...(room.started ? { roundBots: botSeats(room.seats, players.map(({ seat }) => seat), room.roundBots ?? 0) } : {}) }));
    this.broadcast({ t: 'players', ...lineup, started: room.started }, server);
    await this.publish(room, players);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Spectators in the room: open sockets without a seat. */
  private watchers(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN && this.attachment(socket)?.watch);
  }

  /**
   * Who is in the room, the seats bots would take if the host started now (rooms that allow bots), whether the room is
   * public, and for a quick-play room that it is one and, while it gathers, how many milliseconds until it starts.
   */
  private lineup(room: RoomState, players: RoomPlayer[]): { players: RoomPlayer[]; bots?: number[]; listed: boolean; quick?: true; startIn?: number; watchers?: string[]; watchable?: boolean } {
    const listed = !!room.listed;
    const quick = room.quick ? { quick: true as const, ...(gathering(room) ? { startIn: Math.max(0, room.startAt! - Date.now()) } : {}) } : {};
    // games people can watch say who is watching, and whether the host lets them
    const watch = room.watch ? { watchers: this.watchers().map((socket) => this.attachment(socket)!.name), watchable: room.watchable !== false } : {};
    return room.allowBots ? { players, bots: botSeats(room.seats, players.map(({ seat }) => seat), room.bots ?? 0), listed, ...quick, ...watch } : { players, listed, ...quick, ...watch };
  }

  /**
   * Keeps the room's line in the arcade's Open Rooms right: there, with an alarm to refresh it, while the room is
   * public and someone can join; gone otherwise. Rooms that aren't listed never call Open Rooms, so the one Lobby only
   * hears from public rooms. Open Rooms is a convenience, so a room carries on if it fails.
   */
  private async publish(room: RoomState, players: RoomPlayer[]) {
    if (!room.code) return;
    const listing = roomListing(room, players, this.lineup(room, players).bots?.length ?? 0, this.watchers().length);
    if (!listing && !room.inLobby && !gathering(room)) return this.schedule(room, false);
    try {
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('global'));
      if (listing) await lobby.put(listing);
      else if (room.inLobby) await lobby.drop(room.code);
    } catch {
      /* listed again on the next change or refresh, or dropped once nobody refreshes it */
    }
    if (!!listing !== !!room.inLobby) {
      room.inLobby = !!listing;
      await this.ctx.storage.put('room', room);
    }
    await this.schedule(room, !!listing);
  }

  /** Sets the room's alarm for whatever comes next: a listing refresh, a quick room's start, or a hold running out. */
  private async schedule(room: RoomState, listed: boolean) {
    const current = await this.ctx.storage.getAlarm();
    const next = nextAlarm(room, listed, current, Date.now(), this.seatsState ? holdUntil(this.seatsState.held) : null);
    if (next === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
    } else if (next !== current) await this.ctx.storage.setAlarm(next);
  }

  /** Open sockets with a seat (not one replaced by its player coming back), but `except`. */
  private openSeated(except?: WebSocket): Attachment[] {
    return this.ctx.getWebSockets()
      .filter((socket) => socket !== except && socket.readyState === WebSocket.OPEN)
      .map((socket) => this.attachment(socket))
      .filter((value): value is Attachment => !!value && !value.watch && !value.gone);
  }

  /** People connected right now, in seat order. */
  private connected(except?: WebSocket): RoomPlayer[] {
    return this.openSeated(except).map(({ seat, name }) => ({ seat, name })).sort((a, b) => a.seat - b.seat);
  }

  /** People in the room: everyone connected, and anyone whose seat is held for them to come back to, in seat order. */
  private players(except?: WebSocket): RoomPlayer[] {
    const players = this.connected(except);
    for (const seat of Object.keys(this.seatsState?.held ?? {}).map(Number)) {
      const key = this.seatsState!.keys[String(seat)];
      if (key && !players.some((player) => player.seat === seat)) players.push({ seat, name: key.name });
    }
    return players.sort((a, b) => a.seat - b.seat);
  }

  /** To everyone in the room, spectators included unless `seated` (game messages: the host shares its own with them). */
  private broadcast(message: unknown, except?: WebSocket, seated = false) {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      const value = this.attachment(socket);
      if (value?.gone || (seated && value?.watch)) continue;
      this.trySend(socket, data);
    }
  }

  private trySend(socket: WebSocket, data: string) {
    try {
      socket.send(data);
    } catch {
      socket.close(1011, 'send failed');
    }
  }

  /** To the people in `seats` (each once), but `except`. */
  private sendTo(seats: Set<number>, message: unknown, except?: WebSocket) {
    let data: string | null = null;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      const value = this.attachment(socket);
      if (!value || value.watch || value.gone || !seats.has(value.seat)) continue;
      this.trySend(socket, (data ??= JSON.stringify(message)));
    }
  }

  /**
   * A socket closed. A seated player of protocol 4 or later who didn't say goodbye (code 1000, 'leave') keeps their
   * seat for HOLD_MS to come back to, and nobody hears they went unless they don't. Everyone else is gone (see
   * leaveSeat), and so is the room once nobody is left in it.
   */
  private async onSocketClose(ws: WebSocket, attachment: Attachment | null, goodbye: boolean) {
    // a socket its player has already come back past
    if (attachment?.gone) return;
    const room = await this.ctx.storage.get<RoomState>('room');
    if (room) this.seatsCache = room.seats;
    const state = room ? await this.seatState(room) : null;
    if (room && state && attachment && !attachment.watch && !goodbye && (attachment.v ?? 1) >= RESUME_VERSION && canResume(state.keys, attachment.seat, attachment.key)) {
      state.held[String(attachment.seat)] = { until: Date.now() + HOLD_MS, round: room.round ?? 0 };
      await this.saveSeats();
      await this.schedule(room, !!room.inLobby);
      return;
    }
    if (state && attachment && !attachment.watch) {
      delete state.keys[String(attachment.seat)];
      delete state.held[String(attachment.seat)];
      this.backlogs.delete(attachment.seat);
      await this.saveSeats();
    }
    if (!room) {
      for (const socket of this.ctx.getWebSockets()) if (socket !== ws) socket.close(1000, 'room-closed');
      await this.close();
      return;
    }
    // a spectator left: everyone just hears who is still watching
    if (attachment?.watch) {
      if (!this.players(ws).length) return this.closeRoom(ws);
      const players = this.players(ws);
      this.broadcast({ t: 'players', ...this.lineup(room, players), started: room.started }, ws);
      await this.publish(room, players);
      return;
    }
    await this.leaveSeat(room, attachment?.seat ?? null, ws);
  }

  /** The last player is gone, so there is nothing left to watch. */
  private async closeRoom(except?: WebSocket) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      this.trySend(socket, JSON.stringify({ t: 'closed', reason: 'room-closed' }));
      socket.close(1000, 'room-closed');
    }
    await this.close();
  }

  /**
   * Someone is gone for good (their socket `ws`, if they still had one). The room carries on while anyone is in it:
   * when the host goes, the person in the lowest seat still connected takes over as host (seat 0) and any round under
   * way ends, since the host's game ran it, unless the game takes it over (`migrate`): then someone playing the round
   * takes over, and it goes on while there is someone to play against, as it does when a guest goes. Clients from before
   * hand-offs can't follow one, so a room with any of them still closes when its host leaves. True when the room closed.
   */
  private async leaveSeat(room: RoomState, seat: number | null, ws: WebSocket | null): Promise<boolean> {
    const except = ws ?? undefined;
    const remaining = this.ctx.getWebSockets().filter((socket) => socket !== ws && socket.readyState === WebSocket.OPEN);
    const seated = remaining
      .map((socket) => ({ socket, seat: this.attachment(socket) }))
      .filter((entry): entry is { socket: WebSocket; seat: Attachment } => !!entry.seat && !entry.seat.watch && !entry.seat.gone);
    const held = Object.keys(this.seatsState?.held ?? {}).map(Number).filter((s) => s !== seat);
    if (!seated.length && !held.length) {
      await this.closeRoom(except);
      return true;
    }
    if (seat === 0 && remaining.some((socket) => (this.attachment(socket)?.v ?? 1) < HANDOFF_VERSION)) {
      this.broadcast({ t: 'closed', reason: 'host-left' }, except);
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'host-left');
      await this.close();
      return true;
    }
    let from: number | null = null;
    // a round the new host's game goes on running
    const goesOn = seat === 0 && !!room.migrate && room.started;
    if (seat === 0) {
      // nobody here to take over (everyone left is away for a moment): the room is done
      if (!seated.length) {
        await this.closeRoom(except);
        return true;
      }
      const next = nextHost(seated.map(({ seat: value }) => value), goesOn ? room.roster : undefined)!;
      const entry = seated.find(({ seat: value }) => value.seat === next.seat)!;
      from = next.seat;
      entry.seat = { ...entry.seat, seat: 0 };
      this.attach(entry.socket, entry.seat);
      const state = this.seatsState;
      if (state) {
        const key = state.keys[String(from)];
        delete state.keys[String(from)];
        if (key) state.keys['0'] = key;
        await this.saveSeats();
      }
      if (room.migrate) {
        const results = (await this.ctx.storage.get<RoomResults>('results')) ?? { reports: {}, recorded: [] };
        handOffRound(room, results.reports, from);
        await this.ctx.storage.put('results', results);
      }
      if (!goesOn) endRound(room);
    }
    const players = this.players(except);
    // Benched latecomers aren't in the round, so they don't keep it going.
    const inRound = room.roster ? players.filter(({ seat: s }) => room.roster!.includes(s)).length : players.length;
    if ((from === null || goesOn) && room.started && !roundPlayable(room, inRound)) endRound(room);
    await this.ctx.storage.put('room', room);
    const lineup = { ...this.lineup(room, players), started: room.started };
    this.broadcast(from === null ? { t: 'players', ...lineup } : { t: 'host', from, ...lineup }, except);
    await this.publish(room, players);
    return false;
  }

  /** The room is over: off Open Rooms, and everything it kept is gone. */
  private async close() {
    const room = await this.ctx.storage.get<RoomState>('room');
    if (room) this.seatsCache = room.seats;
    if (room?.code && room.inLobby) {
      try {
        await this.env.LOBBY.get(this.env.LOBBY.idFromName('global')).drop(room.code);
      } catch {
        /* the line expires on its own */
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.seatsCache = null;
    this.seatsState = null;
    this.backlogs.clear();
  }
}

type LiveAttachment = { visitor: string; ip: string };

/**
 * Site-wide counters. `daily` holds per-day counts for the rolling windows (key '' is the total, otherwise a game id),
 * `totals` holds all time counts, and visitors are anonymous ids the browser keeps in localStorage.
 * Every open tab also holds a hibernating WebSocket here, so "online now" is the number of distinct visitors connected.
 */
export class Stats extends DurableObject<Env> {
  private readonly hits = new Map<string, number[]>();
  private prunedDay = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind, key))');
    sql.exec('CREATE TABLE IF NOT EXISTS totals (kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (kind, key))');
    sql.exec('CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, first TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS visitor_days (day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (day, id))');
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** `GET /stats/live?visitor=…`: a socket the site keeps open while it is on screen or in a background tab. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket upgrade required' }, 400);
    const visitor = new URL(request.url).searchParams.get('visitor');
    if (!isVisitorId(visitor)) return json({ error: 'invalid visitor' }, 400);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const live = this.liveAttachments();
    if (live.length >= LIVE_MAX || live.filter((a) => a.ip === ip).length >= LIVE_PER_IP) return json({ error: 'too many connections' }, 429);
    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment({ visitor, ip } satisfies LiveAttachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** The site only sends 'ping', which the auto-response answers without waking this object. */
  async webSocketMessage() {}

  private liveAttachments(): LiveAttachment[] {
    return this.ctx.getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map((socket) => socket.deserializeAttachment() as LiveAttachment | null)
      .filter((value): value is LiveAttachment => !!value);
  }

  /** Counts one visit or one game. False when the IP is over the rate limit. */
  record(hit: StatsHit, ip: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= STATS_RATE_LIMIT) {
      this.hits.set(ip, recent);
      return false;
    }
    if (this.hits.size > 10_000) this.hits.clear();
    recent.push(now);
    this.hits.set(ip, recent);

    const sql = this.ctx.storage.sql;
    const today = dayKey(new Date(now));
    this.prune(today);
    this.bump(today, hit.kind, '');
    if (hit.kind === 'play') {
      const known = sql.exec('SELECT 1 FROM totals WHERE kind = ? AND key = ?', 'play', hit.game).toArray().length > 0;
      if (known || sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM totals WHERE kind = 'play' AND key != ''").one().n < MAX_GAMES) {
        this.bump(today, 'play', hit.game);
      }
    }
    sql.exec('INSERT OR IGNORE INTO visitors (id, first) VALUES (?, ?)', hit.visitor, today);
    sql.exec('INSERT OR IGNORE INTO visitor_days (day, id) VALUES (?, ?)', today, hit.visitor);
    return true;
  }

  summary(): StatsSummary {
    const sql = this.ctx.storage.sql;
    const starts = periodStarts(dayKey(new Date()));
    const windowed = (kind: string, from: string) =>
      sql.exec<{ n: number }>("SELECT COALESCE(SUM(n), 0) AS n FROM daily WHERE kind = ? AND key = '' AND day >= ?", kind, from).one().n;
    const total = (kind: string) => sql.exec<{ n: number }>("SELECT COALESCE(SUM(n), 0) AS n FROM totals WHERE kind = ? AND key = ''", kind).one().n;
    const counts = (kind: string) => ({ today: windowed(kind, starts.today), week: windowed(kind, starts.week), month: windowed(kind, starts.month), all: total(kind) });
    const visitors = (from: string) => sql.exec<{ n: number }>('SELECT COUNT(DISTINCT id) AS n FROM visitor_days WHERE day >= ?', from).one().n;
    const top = (from: string) =>
      sql.exec<TopGame>(
        "SELECT key AS game, SUM(n) AS plays FROM daily WHERE kind = 'play' AND key != '' AND day >= ? GROUP BY key ORDER BY plays DESC, key ASC LIMIT ?",
        from,
        TOP_GAMES,
      ).toArray();
    return {
      online: new Set(this.liveAttachments().map((a) => a.visitor)).size,
      views: counts('view'),
      plays: counts('play'),
      visitors: {
        today: visitors(starts.today),
        week: visitors(starts.week),
        month: visitors(starts.month),
        all: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM visitors').one().n,
      },
      top: {
        today: top(starts.today),
        week: top(starts.week),
        month: top(starts.month),
        all: sql.exec<TopGame>("SELECT key AS game, n AS plays FROM totals WHERE kind = 'play' AND key != '' ORDER BY n DESC, key ASC LIMIT ?", TOP_GAMES).toArray(),
      },
      since: sql.exec<{ since: string | null }>('SELECT MIN(first) AS since FROM visitors').one().since,
    };
  }

  private bump(day: string, kind: string, key: string) {
    const sql = this.ctx.storage.sql;
    sql.exec('INSERT INTO daily (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1', day, kind, key);
    sql.exec('INSERT INTO totals (kind, key, n) VALUES (?, ?, 1) ON CONFLICT(kind, key) DO UPDATE SET n = n + 1', kind, key);
  }

  /** Once a day, drops the daily rows no window reaches any more. */
  private prune(today: string) {
    if (this.prunedDay === today) return;
    this.prunedDay = today;
    const cutoff = shiftDay(today, -KEEP_DAYS);
    this.ctx.storage.sql.exec('DELETE FROM daily WHERE day < ?', cutoff);
    this.ctx.storage.sql.exec('DELETE FROM visitor_days WHERE day < ?', cutoff);
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'content-type');
  const webSocket = (response as Response & { webSocket?: WebSocket }).webSocket;
  if (webSocket) return new Response(null, { status: 101, statusText: response.statusText, headers, webSocket });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (url.pathname === '/telemetry' && request.method === 'POST') {
      const contentLength = Number(request.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return withCors(json({ error: 'too large' }, 413));
      try {
        return withCors(await env.TELEMETRY.get(env.TELEMETRY.idFromName('global')).fetch(request));
      } catch {
        return withCors(json({ error: 'unavailable' }, 503));
      }
    }
    if (url.pathname === '/telemetry/summary' && request.method === 'GET') {
      try {
        return await env.TELEMETRY.get(env.TELEMETRY.idFromName('global')).fetch(request);
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }
    if (url.pathname === '/leaderboard' && (request.method === 'GET' || request.method === 'POST')) {
      const id = env.BOARDS.idFromName('global');
      return withCors(await env.BOARDS.get(id).fetch(request));
    }
    if (url.pathname === '/wins' && request.method === 'GET') {
      const id = env.BOARDS.idFromName('global');
      return withCors(await env.BOARDS.get(id).fetch(request));
    }
    if (url.pathname === '/leaderboard/top' && request.method === 'GET') {
      const id = env.BOARDS.idFromName('global');
      return withCors(await env.BOARDS.get(id).fetch(request));
    }
    if (url.pathname === '/stats' && request.method === 'GET') {
      try {
        return withCors(json(await env.STATS.get(env.STATS.idFromName('global')).summary()));
      } catch {
        return withCors(json({ error: 'unavailable' }, 503));
      }
    }
    if (url.pathname === '/stats/live' && request.method === 'GET') {
      return withCors(await env.STATS.get(env.STATS.idFromName('global')).fetch(request));
    }
    const statsPath = /^\/stats\/(view|play)$/.exec(url.pathname);
    if (statsPath && request.method === 'POST') {
      const hit = parseHit(statsPath[1], await request.text());
      if (!hit) return withCors(json({ error: 'invalid body' }, 400));
      try {
        const counted = await env.STATS.get(env.STATS.idFromName('global')).record(hit, request.headers.get('CF-Connecting-IP') || 'unknown');
        return withCors(counted ? json({ ok: true }) : json({ error: 'rate limited' }, 429, { 'retry-after': '60' }));
      } catch {
        return withCors(json({ error: 'unavailable' }, 503));
      }
    }
    if (url.pathname === '/chat' && (request.method === 'GET' || request.method === 'POST')) {
      const chat = env.CHAT.get(env.CHAT.idFromName('global'));
      try {
        if (request.method === 'GET') {
          const session = url.searchParams.get('s');
          return withCors(json(await chat.read(isSession(session) ? session : null, readIndex(url.searchParams.get('after')))));
        }
        let body: Record<string, unknown> | null = null;
        try {
          body = JSON.parse(await request.text());
        } catch {
          /* checked below */
        }
        const text = cleanText(body?.text);
        if (!isSession(body?.s) || !text) return withCors(json({ error: 'invalid body' }, 400));
        const sent = await chat.send(body.s, text, readIndex(body.after), request.headers.get('CF-Connecting-IP') || 'unknown');
        return withCors(json(sent.body, sent.status));
      } catch {
        return withCors(json({ error: 'unavailable' }, 503));
      }
    }
    if (url.pathname === '/telegram') {
      const chat = env.CHAT.get(env.CHAT.idFromName('global'));
      const token = env.TELEGRAM_BOT_TOKEN;
      // Open in a browser to connect the bot to this Worker and see what is left to set up.
      if (request.method === 'GET') {
        const report = await chat.setup(`${url.origin}/telegram`, token ? await webhookSecret(token) : '');
        return new Response(report, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (request.method === 'POST') {
        if (!token || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(token))) return json({ error: 'forbidden' }, 401);
        try {
          await chat.update((await request.json().catch(() => null)) as TgUpdate | null);
        } catch (err) {
          // Still 200: Telegram would otherwise retry the same update for hours.
          console.error(err);
        }
        return new Response('ok');
      }
    }
    if (url.pathname === '/lounge' && request.method === 'GET') {
      return withCors(await env.LOUNGE.get(env.LOUNGE.idFromName('global')).fetch(request));
    }
    // For Josh: wipes the arcade chat, or one channel of it (?ch=). Off unless the LOUNGE_ADMIN_TOKEN secret is set.
    if (url.pathname === '/lounge/clear' && request.method === 'POST') {
      if (!env.LOUNGE_ADMIN_TOKEN) return json({ error: 'disabled' }, 403);
      const given = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
      if (!(await sameSecret(given, env.LOUNGE_ADMIN_TOKEN))) return json({ error: 'forbidden' }, 401);
      const ch = url.searchParams.get('ch');
      if (ch !== null && !isChannel(ch)) return json({ error: 'unknown channel' }, 404);
      try {
        return json({ ok: true, removed: await env.LOUNGE.get(env.LOUNGE.idFromName('global')).clear(ch ?? undefined) });
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }
    // Open Rooms: public rooms someone can join now, for one game (?game=) or all of them.
    if (url.pathname === '/rooms' && request.method === 'GET') {
      const game = url.searchParams.get('game');
      if (game !== null && !Object.hasOwn(ONLINE_SPECS, game)) return withCors(json({ error: 'unknown game' }, 404));
      try {
        return withCors(json({ rooms: await env.LOBBY.get(env.LOBBY.idFromName('global')).list(game) }));
      } catch {
        return withCors(json({ error: 'unavailable' }, 503));
      }
    }
    // Quick play: a quick-play room of the game (and the pool asked for, a game's mode say) that is still gathering
    // people, or a new one.
    if (url.pathname === '/rooms/quick' && request.method === 'POST') {
      const game = url.searchParams.get('game') ?? '';
      const spec = Object.hasOwn(ONLINE_SPECS, game) ? ONLINE_SPECS[game] : undefined;
      if (!spec?.quick) return withCors(json({ error: 'unknown game' }, 404));
      const pool = url.searchParams.get('pool') ?? undefined;
      if (pool !== undefined && !isPool(pool)) return withCors(json({ error: 'unknown pool' }, 400));
      try {
        const lobby = env.LOBBY.get(env.LOBBY.idFromName('global'));
        for (let attempt = 0; attempt < 5; attempt++) {
          const fresh = makeRoomCode(crypto.getRandomValues(new Uint8Array(4)));
          const code = await lobby.quick(game, fresh, seatsFor(spec), !!spec.lateJoin, pool);
          if (code !== fresh || (await env.ROOMS.get(env.ROOMS.idFromName(fresh)).open(fresh, game, spec, true, true, pool))) return withCors(json({ code }));
          await lobby.drop(fresh);
        }
      } catch {
        /* answered below */
      }
      return withCors(json({ error: 'could not find a room' }, 503));
    }
    if (url.pathname === '/rooms' && request.method === 'POST') {
      const game = url.searchParams.get('game') ?? '';
      const spec = Object.hasOwn(ONLINE_SPECS, game) ? ONLINE_SPECS[game] : undefined;
      if (!spec) return withCors(json({ error: 'unknown game' }, 404));
      const listed = url.searchParams.get('public') === '1';
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeRoomCode(crypto.getRandomValues(new Uint8Array(4)));
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await room.open(code, game, spec, listed)) return withCors(json({ code }));
      }
      return withCors(json({ error: 'could not create room' }, 503));
    }
    const wsPath = /^\/rooms\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4})\/ws$/.exec(url.pathname);
    if (wsPath && request.method === 'GET') {
      const room = env.ROOMS.get(env.ROOMS.idFromName(wsPath[1]));
      return withCors(await room.fetch(request));
    }
    return withCors(json({ error: 'not found' }, 404));
  },
};
