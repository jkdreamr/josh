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
import { LEADERBOARD_SPECS, ONLINE_SPECS } from './specs.gen';
import { agreedWinner, beginRound, benchSeat, botSeats, canJoinRoom, canStartRoom, endRound, GATHER_MS, gatherFull, gathering, lowestFreeSeat, makeRoomCode, markRoundRecorded, nextAlarm, nextHost, parseRoomMessage, roomListing, roundPlayable, roundSeats, seatsFor, type RecordedRounds, type RoomPlayer, type RoomState, type RoundReports } from './room-core';

export { Chat, Lobby, Lounge };

interface Env extends ChatEnv, LoungeEnv {
  BOARDS: DurableObjectNamespace<Boards>;
  ROOMS: DurableObjectNamespace<Room>;
  STATS: DurableObjectNamespace<Stats>;
  CHAT: DurableObjectNamespace<Chat>;
  LOUNGE: DurableObjectNamespace<Lounge>;
  LOBBY: DurableObjectNamespace<Lobby>;
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

/** v: the room protocol the client speaks; 2 and up follow a host hand-off (older clients only know the room closing). */
type Attachment = { seat: number; name: string; v?: number };
/** Clients that follow a host hand-off: when one of these is left without a host, the next one takes over. */
const HANDOFF_VERSION = 2;
type RoomResults = { reports: RoundReports; recorded: RecordedRounds };

export class Room extends DurableObject<Env> {
  private operations: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * listed: a public room, shown in the arcade's Open Rooms once its host is in. quick: a quick-play room (public, with
   * bots in every seat nobody holds), which starts on its own GATHER_MS from now, or closes then if nobody came.
   */
  open(code: string, game: string, spec: OnlineSpec, listed = false, quick = false): Promise<boolean> {
    return this.exclusive(async () => {
      if (await this.ctx.storage.get<RoomState>('room')) return false;
      const seats = seatsFor(spec);
      const gather = quick ? { quick: true, startAt: Date.now() + GATHER_MS } : {};
      await this.ctx.storage.put<RoomState>('room', { code, game, seats, started: false, lateJoin: !!spec.lateJoin, ...(spec.bots ? { allowBots: true, bots: quick ? seats - 1 : 0 } : {}), ...(listed || quick ? { listed: true } : {}), ...gather });
      await this.ctx.storage.put<RoomResults>('results', { reports: {}, recorded: [] });
      if (quick) await this.ctx.storage.setAlarm(gather.startAt!);
      return true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(() => this.join(request));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return this.exclusive(() => this.handleMessage(ws, message));
  }

  /**
   * While the room is listed, its line in Open Rooms is refreshed every minute, so it never goes stale. A quick-play
   * room starts when its gathering time is up (or closes, if nobody came; one that can't start yet gathers longer).
   */
  async alarm() {
    await this.exclusive(async () => {
      const room = await this.ctx.storage.get<RoomState>('room');
      if (!room) return;
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
    this.broadcast({ t: 'start', ...lineup, round });
    await this.publish(room, lineup.players);
    return true;
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return;
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

    if (parsed.t === 'bots' || parsed.t === 'listed') {
      if (attachment.seat !== 0) return;
      if (parsed.t === 'bots') {
        if (!room.allowBots) return;
        room.bots = parsed.n;
      } else room.listed = parsed.on;
      await this.ctx.storage.put('room', room);
      const lineup = this.lineup(room, this.players());
      this.broadcast({ t: 'players', ...lineup });
      await this.publish(room, lineup.players);
      return;
    }

    if (parsed.t === 'msg' || parsed.t === 'signal') {
      const packet = { t: parsed.t, from: attachment.seat, d: parsed.d };
      if (parsed.to === undefined) this.broadcast(packet, ws);
      else this.sendTo(parsed.to, packet, ws);
      return;
    }

    const connected = this.players();
    const resultState = (await this.ctx.storage.get<RoomResults>('results')) ?? { reports: {}, recorded: [] };
    const roundKey = String(parsed.round);
    const roundReports = resultState.reports[roundKey] ?? {};
    roundReports[String(attachment.seat)] = parsed.winner;
    resultState.reports[roundKey] = roundReports;
    const winner = agreedWinner(resultState.reports, roundSeats(room, connected.map(({ seat }) => seat), parsed.round), parsed.round);
    if (winner !== null && connected.some(({ seat }) => seat === winner) && markRoundRecorded(resultState.recorded, parsed.round)) {
      await this.ctx.storage.put('results', resultState);
      const winnerName = connected.find(({ seat }) => seat === winner)?.name;
      if (winnerName) {
        try {
          await this.env.BOARDS.get(this.env.BOARDS.idFromName('global')).recordWin(room.game, winnerName);
        } catch {
          return;
        }
      }
      return;
    }
    await this.ctx.storage.put('results', resultState);
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    await this.exclusive(() => this.onSocketClose(ws, attachment));
  }

  async webSocketError(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    await this.exclusive(() => this.onSocketClose(ws, attachment));
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation);
    this.operations = next.then(() => undefined, () => undefined);
    return next;
  }

  private async join(request: Request): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'websocket upgrade required' }, 400);
    }
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return json({ error: 'room not found' }, 404);
    if (!canJoinRoom(room)) return json({ error: 'room already started' }, 409);
    // A socket on its way out keeps its seat until it has gone, so nobody is ever given a seat someone still holds.
    const sockets = this.ctx.getWebSockets();
    const seat = lowestFreeSeat(room.seats, sockets.map((socket) => (socket.deserializeAttachment() as Attachment | null)?.seat).filter((value): value is number => value !== undefined));
    if (seat === null) return json({ error: 'room is full' }, 409);
    const existingPlayers = this.players();

    const url = new URL(request.url);
    const cleaned = cleanName(url.searchParams.get('name') ?? '');
    const name = nameLength(cleaned) >= 1 && nameLength(cleaned) <= 16 ? cleaned : `Player ${seat + 1}`;
    const version = Number(url.searchParams.get('v'));
    const code = /\/rooms\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4})\/ws$/.exec(url.pathname)?.[1] ?? '';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ seat, name, ...(Number.isSafeInteger(version) && version > 1 ? { v: version } : {}) } satisfies Attachment);
    this.ctx.acceptWebSocket(server);
    if (room.started) benchSeat(room, seat);
    if (room.started || gatherFull(room, existingPlayers.length + 1, Date.now())) await this.ctx.storage.put('room', room);
    const lineup = this.lineup(room, [...existingPlayers, { seat, name }].sort((a, b) => a.seat - b.seat));
    server.send(JSON.stringify({ t: 'welcome', seat, code, game: room.game, seats: room.seats, ...lineup, started: room.started, round: room.round ?? 0 }));
    this.broadcast({ t: 'players', ...lineup, started: room.started });
    await this.publish(room, lineup.players);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Who is in the room, the seats bots would take if the host started now (rooms that allow bots), whether the room is
   * public, and for a quick-play room that it is one and, while it gathers, how many milliseconds until it starts.
   */
  private lineup(room: RoomState, players: RoomPlayer[]): { players: RoomPlayer[]; bots?: number[]; listed: boolean; quick?: true; startIn?: number } {
    const listed = !!room.listed;
    const quick = room.quick ? { quick: true as const, ...(gathering(room) ? { startIn: Math.max(0, room.startAt! - Date.now()) } : {}) } : {};
    return room.allowBots ? { players, bots: botSeats(room.seats, players.map(({ seat }) => seat), room.bots ?? 0), listed, ...quick } : { players, listed, ...quick };
  }

  /**
   * Keeps the room's line in the arcade's Open Rooms right: there, with an alarm to refresh it, while the room is
   * public and someone can join; gone otherwise. Rooms that aren't listed never call Open Rooms, so the one Lobby only
   * hears from public rooms. Open Rooms is a convenience, so a room carries on if it fails.
   */
  private async publish(room: RoomState, players: RoomPlayer[]) {
    if (!room.code) return;
    const listing = roomListing(room, players, this.lineup(room, players).bots?.length ?? 0);
    if (!listing && !room.inLobby && !gathering(room)) return;
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
    const current = await this.ctx.storage.getAlarm();
    const next = nextAlarm(room, !!listing, current, Date.now());
    if (next === null) await this.ctx.storage.deleteAlarm();
    else if (next !== current) await this.ctx.storage.setAlarm(next);
  }

  /** People in the room: open sockets, in seat order. */
  private players(): RoomPlayer[] {
    return this.ctx.getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map((socket) => socket.deserializeAttachment() as Attachment | null)
      .filter((value): value is Attachment => !!value)
      .map(({ seat, name }) => ({ seat, name }))
      .sort((a, b) => a.seat - b.seat);
  }

  private broadcast(message: unknown, except?: WebSocket) {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(data);
      } catch {
        socket.close(1011, 'send failed');
      }
    }
  }

  private sendTo(seat: number, message: unknown, except?: WebSocket) {
    const socket = this.ctx.getWebSockets().find((candidate) => candidate !== except && candidate.readyState === WebSocket.OPEN && (candidate.deserializeAttachment() as Attachment | null)?.seat === seat);
    if (!socket) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, 'send failed');
    }
  }

  /**
   * Someone left. The room carries on while anyone is in it: when the host goes, the person in the lowest seat takes
   * over as host (seat 0) and any round under way ends, since the host's game ran it; when a guest goes, the round
   * ends only if nobody is left to play against. Clients from before hand-offs can't follow one, so a room with any of
   * them still closes when its host leaves.
   */
  private async onSocketClose(ws: WebSocket, attachment: Attachment | null) {
    const remaining = this.ctx.getWebSockets().filter((socket) => socket !== ws && socket.readyState === WebSocket.OPEN);
    const seated = remaining
      .map((socket) => ({ socket, seat: socket.deserializeAttachment() as Attachment | null }))
      .filter((entry): entry is { socket: WebSocket; seat: Attachment } => !!entry.seat);
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!seated.length || !room) {
      await this.close();
      return;
    }
    if (attachment?.seat === 0 && seated.some(({ seat }) => (seat.v ?? 1) < HANDOFF_VERSION)) {
      this.broadcast({ t: 'closed', reason: 'host-left' }, ws);
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'host-left');
      await this.close();
      return;
    }
    let from: number | null = null;
    if (attachment?.seat === 0) {
      const next = nextHost(seated.map(({ seat }) => seat))!;
      const entry = seated.find(({ seat }) => seat.seat === next.seat)!;
      from = next.seat;
      entry.seat = { ...entry.seat, seat: 0 };
      entry.socket.serializeAttachment(entry.seat);
      endRound(room);
    }
    const players = seated.map(({ seat: { seat, name } }) => ({ seat, name })).sort((a, b) => a.seat - b.seat);
    // Benched latecomers aren't in the round, so they don't keep it going.
    const inRound = room.roster ? players.filter(({ seat }) => room.roster!.includes(seat)).length : players.length;
    if (from === null && room.started && !roundPlayable(room, inRound)) endRound(room);
    await this.ctx.storage.put('room', room);
    const lineup = { ...this.lineup(room, players), started: room.started };
    this.broadcast(from === null ? { t: 'players', ...lineup } : { t: 'host', from, ...lineup }, ws);
    await this.publish(room, players);
  }

  /** The room is over: off Open Rooms, and everything it kept is gone. */
  private async close() {
    const room = await this.ctx.storage.get<RoomState>('room');
    if (room?.code && room.inLobby) {
      try {
        await this.env.LOBBY.get(this.env.LOBBY.idFromName('global')).drop(room.code);
      } catch {
        /* the line expires on its own */
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
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
    // Quick play: a quick-play room of the game that is still gathering people, or a new one.
    if (url.pathname === '/rooms/quick' && request.method === 'POST') {
      const game = url.searchParams.get('game') ?? '';
      const spec = Object.hasOwn(ONLINE_SPECS, game) ? ONLINE_SPECS[game] : undefined;
      if (!spec?.quick) return withCors(json({ error: 'unknown game' }, 404));
      try {
        const lobby = env.LOBBY.get(env.LOBBY.idFromName('global'));
        for (let attempt = 0; attempt < 5; attempt++) {
          const fresh = makeRoomCode(crypto.getRandomValues(new Uint8Array(4)));
          const code = await lobby.quick(game, fresh, seatsFor(spec), !!spec.lateJoin);
          if (code !== fresh || (await env.ROOMS.get(env.ROOMS.idFromName(fresh)).open(fresh, game, spec, true, true))) return withCors(json({ code }));
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
