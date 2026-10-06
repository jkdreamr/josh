import type { APIRoute } from 'astro';
import type { RaceDistance } from '../../os/games/leaderboard';

declare const process: { env: Record<string, string | undefined> };

export const prerender = false;

type Submission = { distance: RaceDistance; name: string; timeMs: number };
type RedisEntry = { n: string; t: number; d: string; id: string };

export function validateSubmission(value: unknown): { value?: Submission; error?: string } {
  if (!value || typeof value !== 'object') return { error: 'invalid body' };
  const body = value as Record<string, unknown>;
  if (body.distance !== 500 && body.distance !== 1000 && body.distance !== 2000) return { error: 'invalid distance' };
  if (typeof body.name !== 'string') return { error: 'invalid name' };
  const name = body.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 16) return { error: 'invalid name' };
  const minTime = (body.distance / 500) * 79670 * 0.9;
  if (typeof body.timeMs !== 'number' || !Number.isFinite(body.timeMs) || body.timeMs < minTime || body.timeMs > 20 * 60 * 1000) {
    return { error: 'invalid time' };
  }
  return { value: { distance: body.distance, name, timeMs: body.timeMs } };
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(config: { url: string; token: string }, commands: string[][]): Promise<unknown[]> {
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error('redis request failed');
  const results = await response.json() as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(results) || results.some((result) => result.error)) throw new Error('redis pipeline failed');
  return results.map((result) => result.result);
}

function decodeEntries(raw: unknown): Array<{ name: string; timeMs: number; date: string }> {
  if (!Array.isArray(raw)) return [];
  const entries: Array<{ name: string; timeMs: number; date: string }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (typeof raw[i] !== 'string') continue;
    try {
      const member = JSON.parse(raw[i]) as RedisEntry;
      if (typeof member.n === 'string' && typeof member.t === 'number' && typeof member.d === 'string') {
        entries.push({ name: member.n, timeMs: member.t, date: member.d });
      }
    } catch {
      continue;
    }
  }
  return entries;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function parseDistance(raw: string | null): RaceDistance | null {
  const value = Number(raw);
  return value === 500 || value === 1000 || value === 2000 ? value : null;
}

export const GET: APIRoute = async ({ url }) => {
  const distance = parseDistance(url.searchParams.get('distance'));
  if (!distance) return json({ error: 'invalid distance' }, 400);
  const config = redisConfig();
  if (!config) return json({ error: 'unconfigured' }, 503);
  try {
    const [result] = await pipeline(config, [['ZRANGE', `coxbox:lb:${distance}`, '0', '9', 'WITHSCORES']]);
    return json({ entries: decodeEntries(result) });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const parsed = validateSubmission(body);
  if (!parsed.value) return json({ error: parsed.error }, 400);
  const config = redisConfig();
  if (!config) return json({ error: 'unconfigured' }, 503);
  const { distance, name, timeMs } = parsed.value;
  const date = new Date().toISOString();
  const member: RedisEntry = { n: name, t: timeMs, d: date, id: crypto.randomUUID() };
  const key = `coxbox:lb:${distance}`;
  try {
    const results = await pipeline(config, [
      ['ZADD', key, String(timeMs), JSON.stringify(member)],
      ['ZREMRANGEBYRANK', key, '100', '-1'],
      ['ZRANGE', key, '0', '9', 'WITHSCORES'],
    ]);
    return json({ entries: decodeEntries(results[2]) });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
};
