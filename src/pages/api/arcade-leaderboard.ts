import type { APIRoute } from 'astro';
import type { GameMeta, LeaderboardSpec } from '../../os/arcade/types';
import { TOP, isEntry, rankEntries, redisScore, validateSubmission, type BoardEntry } from '../../os/arcade/kit/leaderboard';

declare const process: { env: Record<string, string | undefined> };

export const prerender = false;

const KEEP = 100;
const RATE_LIMIT = 6;
const RATE_WINDOW_S = 60;

const metas = import.meta.glob<{ meta: GameMeta }>(['../../os/arcade/games/*/meta.ts', '!../../os/arcade/games/_*/meta.ts'], { eager: true });
const specs: Record<string, LeaderboardSpec | undefined> = Object.fromEntries(
  Object.values(metas)
    .map((m) => m.meta)
    .filter((m) => m?.leaderboard)
    .map((m) => [m.id, m.leaderboard]),
);

type Member = { d: string; n: string; s: number; id: string };
type Redis = { url: string; token: string };

function redisConfig(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(config: Redis, commands: string[][]): Promise<unknown[]> {
  const res = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('redis request failed');
  const results = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(results) || results.some((r) => r.error)) throw new Error('redis pipeline failed');
  return results.map((r) => r.result);
}

function decode(raw: unknown, spec: LeaderboardSpec): BoardEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    try {
      const m = JSON.parse(item) as Member;
      const e = { name: m.n, score: m.s, date: m.d };
      if (isEntry(e)) out.push(e);
    } catch {
      continue;
    }
  }
  return rankEntries(out, spec.order);
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const boardKey = (game: string) => `arcade:lb:${game}`;

function clientIp(request: Request, fallback: () => string): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (fwd) return fwd;
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  try {
    return fallback();
  } catch {
    return 'unknown';
  }
}

export const GET: APIRoute = async ({ url }) => {
  const game = url.searchParams.get('game') ?? '';
  const spec = Object.hasOwn(specs, game) ? specs[game] : undefined;
  if (!spec) return json({ error: 'unknown game' }, 404);
  const config = redisConfig();
  if (!config) return json({ error: 'unconfigured' }, 503);
  try {
    const [raw] = await pipeline(config, [['ZRANGE', boardKey(game), '0', String(TOP - 1)]]);
    return json({ entries: decode(raw, spec) });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const parsed = validateSubmission(body, specs);
  if (!parsed.value) return json({ error: parsed.error }, 400);
  const config = redisConfig();
  if (!config) return json({ error: 'unconfigured' }, 503);
  const { game, name, score } = parsed.value;
  const spec = specs[game]!;
  const key = boardKey(game);
  const rl = `arcade:rl:${clientIp(request, () => clientAddress)}`;
  const member: Member = { d: new Date().toISOString(), n: name, s: score, id: crypto.randomUUID() };
  try {
    const [, count] = await pipeline(config, [
      ['SET', rl, '0', 'EX', String(RATE_WINDOW_S), 'NX'],
      ['INCR', rl],
    ]);
    if (Number(count) > RATE_LIMIT) return json({ error: 'rate limited' }, 429, { 'retry-after': String(RATE_WINDOW_S) });
    const results = await pipeline(config, [
      ['ZADD', key, String(redisScore(score, spec.order)), JSON.stringify(member)],
      ['ZREMRANGEBYRANK', key, String(KEEP), '-1'],
      ['ZRANGE', key, '0', String(TOP - 1)],
    ]);
    return json({ entries: decode(results[2], spec) });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
};
