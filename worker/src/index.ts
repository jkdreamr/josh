import { DurableObject } from 'cloudflare:workers';
import { validateSubmission, TOP, type BoardEntry } from '../../src/os/arcade/kit/leaderboard-core.ts';
import type { LeaderboardSpec } from '../../src/os/arcade/types.ts';
import { LEADERBOARD_SPECS } from './specs.gen';

interface Env {
  BOARDS: DurableObjectNamespace<Boards>;
  ROOMS: DurableObjectNamespace<Room>;
}

const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;

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
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
}

export class Room extends DurableObject<Env> {}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'content-type');
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
    if (url.pathname === '/rooms' || url.pathname.startsWith('/rooms/')) {
      return withCors(json({ error: 'not implemented' }, 501));
    }
    return withCors(json({ error: 'not found' }, 404));
  },
};
