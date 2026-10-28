import { DurableObject } from 'cloudflare:workers';
import {
  MAX_BODY_BYTES, RETENTION_DAYS, SlidingLimiter, parseBatch, summarizeTelemetry, topFrame,
  type ErrorRow, type PerfRow, type TelemetryBatch,
} from '../../src/os/arcade/games/soccer/telemetry-core.ts';
import { sameSecret } from '../../src/os/arcade/lounge-core.ts';

export interface TelemetryEnv {
  TELEMETRY_TOKEN?: string;
}

const RATE_WINDOW_MS = 60_000;
const EVENT_RATE = 120;
const BATCH_RATE = 30;
const MAX_ROWS = 100_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export class Telemetry extends DurableObject<TelemetryEnv> {
  private readonly salt = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  private readonly events = new SlidingLimiter(EVENT_RATE, RATE_WINDOW_MS);
  private readonly batches = new SlidingLimiter(BATCH_RATE, RATE_WINDOW_MS);
  constructor(ctx: DurableObjectState, env: TelemetryEnv) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      client TEXT NOT NULL,
      role TEXT NOT NULL,
      device TEXT NOT NULL,
      build TEXT NOT NULL,
      ua TEXT NOT NULL,
      phase TEXT NOT NULL,
      src TEXT,
      msg TEXT,
      frame TEXT,
      stack TEXT,
      n INTEGER,
      win REAL,
      frames INTEGER,
      fps50 REAL,
      fps5 REAL,
      long_ms REAL,
      tier INTEGER,
      dpr REAL,
      in50 REAL,
      in95 REAL,
      in_n INTEGER,
      loss REAL,
      rx INTEGER,
      tr TEXT,
      drops INTEGER,
      reconnects INTEGER,
      dropped INTEGER
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS events_at ON events (at)');
    sql.exec('CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at)');
    sql.exec('CREATE INDEX IF NOT EXISTS events_build_at ON events (build, at)');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/telemetry' && request.method === 'POST') return this.ingest(request);
    if (url.pathname === '/telemetry/summary' && request.method === 'GET') return this.readSummary(request, url);
    return json({ error: 'not found' }, 404);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    await this.prune(now);
    if (this.rowCount()) await this.ctx.storage.setAlarm(now + DAY_MS);
    else await this.ctx.storage.deleteAlarm();
  }

  private async ingest(request: Request): Promise<Response> {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json({ error: 'too large' }, 413);
    let text: string;
    try {
      text = await request.text();
    } catch {
      return json({ error: 'invalid body' }, 400);
    }
    const parsed = parseBatch(text);
    if ('error' in parsed) return json({ error: parsed.error }, parsed.error === 'too large' ? 413 : 400);
    const batch = parsed.value;
    const now = Date.now();
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const key = await this.ipKey(ip);
      if (!this.batches.take(key, 1, now) || !this.events.take(key, batch.ev.length, now)) {
        return json({ error: 'rate limited' }, 429, { 'retry-after': '60' });
      }
      this.store(batch, now);
      const lastPruned = await this.ctx.storage.get<number>('telemetry:prunedAt') ?? 0;
      if (now - lastPruned >= HOUR_MS) await this.prune(now);
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(now + DAY_MS);
      return json({ ok: true, stored: batch.ev.length });
    } catch {
      return json({ error: 'unavailable' }, 503);
    }
  }

  private async readSummary(request: Request, url: URL): Promise<Response> {
    const token = this.env.TELEMETRY_TOKEN;
    if (!token) return json({ error: 'disabled' }, 403);
    const given = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
    if (!(await sameSecret(given, token))) return json({ error: 'forbidden' }, 401);

    const hoursParam = url.searchParams.get('hours');
    const hours = hoursParam === null ? 336 : /^\d+$/.test(hoursParam) ? Number(hoursParam) : NaN;
    const requestedBuild = url.searchParams.get('build') ?? '';
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > 336
      || (requestedBuild !== '' && !/^[0-9a-f]{1,40}$/i.test(requestedBuild))) {
      return json({ error: 'invalid query' }, 400);
    }
    const build = requestedBuild.toLowerCase();

    try {
      const to = Date.now();
      const from = to - hours * HOUR_MS;
      const buildClause = build ? ' AND build LIKE ?' : '';
      const args = build ? [from, `${build}%`] : [from];
      const errors = this.ctx.storage.sql.exec<ErrorRow>(
        `SELECT at, client, role, device, build, ua, phase, src, msg, frame, stack, n
         FROM events WHERE kind = 'err' AND at >= ?${buildClause} ORDER BY at DESC LIMIT 20000`,
        ...args,
      ).toArray();
      const perf = this.ctx.storage.sql.exec<PerfRow>(
        `SELECT at, client, role, device, build, phase, frames, fps50, fps5, long_ms, tier, dpr,
          in50, in95, loss, drops, reconnects, tr
         FROM events WHERE kind = 'perf' AND at >= ?${buildClause} ORDER BY at DESC LIMIT 20000`,
        ...args,
      ).toArray();
      return json(summarizeTelemetry(errors, perf, { from, to, hours }));
    } catch {
      return json({ error: 'unavailable' }, 503);
    }
  }

  private store(batch: TelemetryBatch, at: number): void {
    const sql = this.ctx.storage.sql;
    const statement = `INSERT INTO events (
      at, kind, client, role, device, build, ua, phase, src, msg, frame, stack, n,
      win, frames, fps50, fps5, long_ms, tier, dpr, in50, in95, in_n, loss, rx, tr, drops, reconnects, dropped
    ) VALUES (${new Array(29).fill('?').join(', ')})`;
    batch.ev.forEach((event, index) => {
      const common = [at, event.k, batch.c, batch.role, batch.dev, batch.b, batch.ua, event.ph];
      if (event.k === 'err') {
        sql.exec(
          statement,
          ...common, event.src, event.msg, topFrame(event.stack), event.stack, event.n,
          null, null, null, null, null, null, null, null, null, null, null, null, null, 0, 0,
          index === 0 ? batch.drop ?? null : null,
        );
      } else {
        sql.exec(
          statement,
          ...common, null, null, null, null, 1,
          event.win, event.frames, event.fps50 ?? null, event.fps5 ?? null, event.longMs ?? null,
          event.tier ?? null, event.dpr ?? null, event.in50 ?? null, event.in95 ?? null, event.inN ?? null,
          event.loss ?? null, event.rx ?? null, event.tr, event.drops, event.reconnects,
          index === 0 ? batch.drop ?? null : null,
        );
      }
    });
    const excess = this.rowCount() - MAX_ROWS;
    if (excess > 0) {
      sql.exec('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)', excess);
    }
  }

  private async ipKey(ip: string): Promise<string> {
    const input = new TextEncoder().encode(`${this.salt}${ip}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }

  private async prune(now: number): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM events WHERE at < ?', now - RETENTION_DAYS * DAY_MS);
    await this.ctx.storage.put('telemetry:prunedAt', now);
  }

  private rowCount(): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM events').one().n;
  }
}
