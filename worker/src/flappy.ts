import { cleanName, nameLength, type BoardEntry } from '../../src/os/arcade/kit/leaderboard-core.ts';
import { RUN_TTL_MS, RUN_VERSION, verifyReplay } from '../../src/os/arcade/games/flappy/replay.ts';

const MAX_BODY = 64_000;
const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '60' } : {}) },
});
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unbase64 = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
type Ticket = { v: number; id: string; seed: number; issued: number; expires: number; ip: string };

/** Also bounds chunked bodies: Content-Length alone is not a security boundary. */
export async function readScoreBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Private SQLite only: no client key, public SQL endpoint or anonymous database writer. */
export class FlappyRuns {
  private readonly key: Promise<CryptoKey>;
  private readonly sql: SqlStorage;
  private readonly clock: () => number;

  constructor(sql: SqlStorage, clock = Date.now) {
    this.sql = sql;
    this.clock = clock;
    sql.exec('CREATE TABLE IF NOT EXISTS flappy_keys (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS flappy_runs_v1 (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS flappy_runs_expiry ON flappy_runs_v1 (expires)');
    sql.exec('CREATE TABLE IF NOT EXISTS flappy_limits (ip TEXT NOT NULL, action TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, action, bucket))');
    sql.exec('CREATE TABLE IF NOT EXISTS flappy_verified_v1 (name TEXT NOT NULL, score INTEGER NOT NULL, date TEXT NOT NULL)');
    let secret = sql.exec<{ secret: string }>('SELECT secret FROM flappy_keys WHERE id = 1').toArray()[0]?.secret;
    if (!secret) {
      secret = base64(crypto.getRandomValues(new Uint8Array(32)));
      sql.exec('INSERT INTO flappy_keys (id, secret) VALUES (1, ?)', secret);
    }
    this.key = crypto.subtle.importKey('raw', unbase64(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }

  entries(limit = 100): BoardEntry[] {
    return this.sql.exec<BoardEntry>('SELECT name, score, date FROM flappy_verified_v1 ORDER BY score DESC, date ASC LIMIT ?', limit).toArray();
  }

  private limited(ip: string, action: string, now: number): boolean {
    const bucket = Math.floor(now / 60_000);
    this.sql.exec('DELETE FROM flappy_limits WHERE bucket < ?', bucket - 1);
    this.sql.exec('DELETE FROM flappy_runs_v1 WHERE expires < ?', now);
    // Count both minute buckets so crossing a minute boundary cannot double the allowance.
    const n = this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(n), 0) AS n FROM flappy_limits WHERE ip = ? AND action = ?', ip, action).toArray()[0].n;
    if (n >= (action === 'start' ? 30 : 12)) return true;
    this.sql.exec('INSERT INTO flappy_limits (ip, action, bucket, n) VALUES (?, ?, ?, 1) ON CONFLICT(ip, action, bucket) DO UPDATE SET n = n + 1', ip, action, bucket);
    return false;
  }

  async fetch(request: Request, at?: number): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/flappy/status') return json({ version: RUN_VERSION, ranking: 'verified-replay' });
    if (request.method !== 'POST' || !['/flappy/run', '/flappy/submit'].includes(path)) return json({ error: 'not found' }, 404);
    const now = at ?? this.clock();
    const ip = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(request.headers.get('CF-Connecting-IP') || 'unknown'))));
    if (this.limited(ip, path === '/flappy/run' ? 'start' : 'submit', now)) return json({ error: 'rate limited' }, 429);
    if (path === '/flappy/run') {
      const payload: Ticket = { v: RUN_VERSION, id: crypto.randomUUID(), seed: crypto.getRandomValues(new Uint32Array(1))[0], issued: now, expires: now + RUN_TTL_MS, ip };
      const data = base64(encoder.encode(JSON.stringify(payload)));
      const signature = base64(new Uint8Array(await crypto.subtle.sign('HMAC', await this.key, encoder.encode(data))));
      this.sql.exec('INSERT INTO flappy_runs_v1 (id, expires) VALUES (?, ?)', payload.id, payload.expires);
      return json({ token: `${data}.${signature}`, seed: payload.seed, version: RUN_VERSION });
    }
    let body: any;
    try { body = await readScoreBody(request); } catch { return json({ error: 'invalid or oversized body' }, 400); }
    if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
    const proof = body.proof;
    if (!proof || typeof proof.token !== 'string' || proof.token.length > 1024) return json({ error: 'verified run required' }, 400);
    let ticket: Ticket;
    try {
      const parts = proof.token.split('.');
      if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await this.key, unbase64(parts[1]), encoder.encode(parts[0]))) throw new Error('signature');
      ticket = JSON.parse(new TextDecoder().decode(unbase64(parts[0])));
    } catch { return json({ error: 'invalid run token' }, 400); }
    const checkedAt = at ?? this.clock();
    if (ticket.v !== RUN_VERSION || ticket.ip !== ip || ticket.issued > checkedAt || ticket.expires < checkedAt) return json({ error: 'invalid run token' }, 400);

    // No await after consuming: concurrent submissions cannot both use a ticket, even across eviction/redeploy.
    const consumed = this.sql.exec('DELETE FROM flappy_runs_v1 WHERE id = ? AND expires >= ? RETURNING id', ticket.id, checkedAt).toArray();
    if (!consumed.length) return json({ error: 'run already used or expired' }, 409);
    const name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (nameLength(name) < 1 || nameLength(name) > 16 || typeof body.score !== 'number' || body.score <= 0 || body.score > 10_000) return json({ error: 'invalid name or score' }, 400);
    const result = verifyReplay(ticket.seed, proof, body.score, checkedAt - ticket.issued);
    if ('error' in result) return json(result, 400);
    const date = new Date(checkedAt).toISOString();
    this.sql.exec('INSERT INTO flappy_verified_v1 (name, score, date) VALUES (?, ?, ?)', name, result.score, date);
    this.sql.exec('DELETE FROM flappy_verified_v1 WHERE rowid NOT IN (SELECT rowid FROM flappy_verified_v1 ORDER BY score DESC, date ASC LIMIT 100)');
    return json({ entries: this.entries() });
  }
}
