import { DurableObject } from 'cloudflare:workers';
import { validateSubmission, TOP, type BoardEntry } from '../../src/os/arcade/kit/leaderboard-core.ts';
import type { LeaderboardSpec } from '../../src/os/arcade/types.ts';
import { cleanName, nameLength } from '../../src/os/arcade/kit/leaderboard-core.ts';
import { dayKey, KEEP_DAYS, MAX_GAMES, parseHit, periodStarts, shiftDay, TOP_GAMES, type StatsHit, type StatsSummary, type TopGame } from '../../src/os/stats-core.ts';
import { LEADERBOARD_SPECS, ONLINE_SPECS } from './specs.gen';
import { agreedWinner, canStartRoom, lowestFreeSeat, makeRoomCode, markRoundRecorded, parseRoomMessage, type RecordedRounds, type RoomPlayer, type RoomState, type RoundReports } from './room-core';

interface Env {
  BOARDS: DurableObjectNamespace<Boards>;
  ROOMS: DurableObjectNamespace<Room>;
  STATS: DurableObjectNamespace<Stats>;
}

const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;
/** Generous on purpose: a whole classroom behind one IP refreshing and replaying should all count. */
const STATS_RATE_LIMIT = 240;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function boardEntries(sql: SqlStorage, game: string, spec: LeaderboardSpec): BoardEntry[] {
  const direction = spec.order === 'desc' ? 'DESC' : 'ASC';
  return sql.exec<BoardEntry>(
    `SELECT name, score, date FROM scores WHERE game = ? ORDER BY score ${direction}, date ASC LIMIT ${TOP}`,
    game,
  ).toArray();
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
        const entries = this.ctx.storage.sql.exec<{ name: string; score: number; date: string }>(
          'SELECT name, wins AS score, date FROM wins WHERE game = ? ORDER BY wins DESC, date ASC LIMIT ?',
          game,
          TOP,
        ).toArray();
        return json({ entries });
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

type Attachment = { seat: number; name: string };
type RoomResults = { reports: RoundReports; recorded: RecordedRounds };

export class Room extends DurableObject<Env> {
  private operations: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  open(game: string, seats: number): Promise<boolean> {
    return this.exclusive(async () => {
      if (await this.ctx.storage.get<RoomState>('room')) return false;
      await this.ctx.storage.put<RoomState>('room', { game, seats, started: false });
      await this.ctx.storage.put<RoomResults>('results', { reports: {}, recorded: [] });
      return true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(() => this.join(request));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return this.exclusive(() => this.handleMessage(ws, message));
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return;
    const parsed = parseRoomMessage(message, room.seats);
    if (!parsed) return;

    if (parsed.t === 'start') {
      const players = this.players();
      if (!canStartRoom(attachment.seat, players.length)) return;
      room.started = true;
      await this.ctx.storage.put('room', room);
      this.broadcast({ t: 'start', players });
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
    const winner = agreedWinner(resultState.reports, connected.map(({ seat }) => seat), parsed.round);
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
    if (room.started) return json({ error: 'room already started' }, 409);
    const sockets = this.ctx.getWebSockets();
    const seat = lowestFreeSeat(room.seats, sockets.map((socket) => (socket.deserializeAttachment() as Attachment | null)?.seat).filter((value): value is number => value !== undefined));
    if (seat === null) return json({ error: 'room is full' }, 409);
    const existingPlayers = sockets
      .map((socket) => socket.deserializeAttachment() as Attachment | null)
      .filter((value): value is Attachment => !!value)
      .map(({ seat: playerSeat, name: playerName }) => ({ seat: playerSeat, name: playerName }));

    const url = new URL(request.url);
    const cleaned = cleanName(url.searchParams.get('name') ?? '');
    const name = nameLength(cleaned) >= 1 && nameLength(cleaned) <= 16 ? cleaned : `Player ${seat + 1}`;
    const code = /\/rooms\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4})\/ws$/.exec(url.pathname)?.[1] ?? '';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ seat, name } satisfies Attachment);
    this.ctx.acceptWebSocket(server);
    const players = [...existingPlayers, { seat, name }].sort((a, b) => a.seat - b.seat);
    server.send(JSON.stringify({ t: 'welcome', seat, code, game: room.game, seats: room.seats, players }));
    this.broadcast({ t: 'players', players });
    return new Response(null, { status: 101, webSocket: client });
  }

  private players(): RoomPlayer[] {
    return this.ctx.getWebSockets()
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

  private async onSocketClose(ws: WebSocket, attachment: Attachment | null) {
    if (attachment?.seat === 0) {
      this.broadcast({ t: 'closed', reason: 'host-left' }, ws);
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'host-left');
      await this.ctx.storage.deleteAll();
      return;
    }
    const remaining = this.ctx.getWebSockets().filter((socket) => socket !== ws && socket.readyState === WebSocket.OPEN);
    if (!remaining.length) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const players = remaining
      .map((socket) => socket.deserializeAttachment() as Attachment | null)
      .filter((value): value is Attachment => !!value)
      .map(({ seat, name }) => ({ seat, name }));
    this.broadcast({ t: 'players', players });
  }
}

/**
 * Site-wide counters. `daily` holds per-day counts for the rolling windows (key '' is the total, otherwise a game id),
 * `totals` holds all time counts, and visitors are anonymous ids the browser keeps in localStorage.
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
    if (url.pathname === '/stats' && request.method === 'GET') {
      try {
        return withCors(json(await env.STATS.get(env.STATS.idFromName('global')).summary()));
      } catch {
        return withCors(json({ error: 'unavailable' }, 503));
      }
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
    if (url.pathname === '/rooms' && request.method === 'POST') {
      const game = url.searchParams.get('game') ?? '';
      const spec = Object.hasOwn(ONLINE_SPECS, game) ? ONLINE_SPECS[game] : undefined;
      if (!spec) return withCors(json({ error: 'unknown game' }, 404));
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeRoomCode(crypto.getRandomValues(new Uint8Array(4)));
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await room.open(game, spec.seats)) return withCors(json({ code }));
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
