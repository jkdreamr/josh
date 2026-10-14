/**
 * The arcade's global chat, shared by the site and the Worker's Lounge object: message shapes, cleaning and validation,
 * the rate limiter, history trimming and the socket protocol.
 *
 * The site sends `{ t: 'say', name, text, c }` (and 'ping', answered with 'pong' without waking the Worker). The Worker sends
 * `welcome` (recent history and how many are here) once on connect, then `msg`, `online`, `cleared` and, to the sender only, `error`.
 * `c` is the sender's own tag for a message; it comes back on that message or its error, to the sender only.
 */
import { cleanName, NAME_MAX } from './kit/leaderboard-core.ts';

export { NAME_MAX };

/** Messages the Worker keeps, and sends to everyone who joins. */
export const HISTORY = 100;
export const TEXT_MAX = 280;
/** The longest frame the Worker reads. A full message is well under 1 KB; anything bigger closes the socket. */
export const FRAME_MAX = 2048;
/** The site pings this often so its socket doesn't idle out, like the arcade rooms and the Stats panel. */
export const KEEPALIVE_MS = 25_000;
/** The same line twice in a row from one connection within this long is dropped. */
export const REPEAT_MS = 60_000;

export type RateRule = { limit: number; windowMs: number };
/** Messages one connection can send. */
export const SOCKET_RATE: readonly RateRule[] = [{ limit: 5, windowMs: 10_000 }];
/** Messages one IP can send across all its connections: room for a couple of people on one network, not for a flood. */
export const IP_RATE: readonly RateRule[] = [
  { limit: 10, windowMs: 10_000 },
  { limit: 30, windowMs: 60_000 },
];

export type LoungeMessage = { id: number; name: string; text: string; t: number };
/** Why a message wasn't posted: a bad name or text, too many too fast, or the same line again. */
export type LoungeError = 'name' | 'text' | 'slow' | 'repeat';
export type LoungeSay = { t: 'say'; name: string; text: string; c?: string };
export type LoungeEvent =
  | { t: 'welcome'; messages: LoungeMessage[]; online: number }
  | { t: 'msg'; m: LoungeMessage; c?: string }
  | { t: 'online'; n: number }
  | { t: 'cleared' }
  | { t: 'error'; error: LoungeError; c?: string };

const ERRORS: readonly LoungeError[] = ['name', 'text', 'slow', 'repeat'];
const TAG = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * Cleans a name or a line of chat: control, zero width and bidi characters out and whitespace squeezed, like a leaderboard name,
 * then blank lookalike characters out and stacks of combining marks cut to three, so a line can't spill over its neighbors.
 */
export function cleanLine(raw: string): string {
  return cleanName(raw)
    .replace(/[\u00ad\u115f\u1160\u180e\u2800\u3164\uffa0]/g, '')
    .replace(/(\p{M}{3})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export const lineLength = (line: string) => Array.from(line).length;

/** True when `raw` is 1 to `max` characters once cleaned. */
export function validLine(raw: string, max: number): boolean {
  const n = lineLength(cleanLine(raw));
  return n >= 1 && n <= max;
}

/**
 * Reads a frame from the site: a say with its name and text cleaned, the reason it can't be posted, or null for
 * anything else (ignored).
 */
export function readSay(raw: unknown): { name: string; text: string; c?: string } | { error: 'name' | 'text'; c?: string } | null {
  if (typeof raw !== 'string' || raw.length > FRAME_MAX) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.t !== 'say') return null;
  const c = typeof body.c === 'string' && TAG.test(body.c) ? { c: body.c } : {};
  const name = typeof body.name === 'string' ? cleanLine(body.name) : '';
  if (lineLength(name) < 1 || lineLength(name) > NAME_MAX) return { error: 'name', ...c };
  const text = typeof body.text === 'string' ? cleanLine(body.text) : '';
  if (lineLength(text) < 1 || lineLength(text) > TEXT_MAX) return { error: 'text', ...c };
  return { name, text, ...c };
}

/**
 * A sliding window limiter over the times something was allowed. Returns the times worth keeping with `now` added,
 * or null when any rule is already full (nothing is recorded then).
 */
export function rateCheck(times: readonly number[], now: number, rules: readonly RateRule[]): number[] | null {
  const longest = Math.max(0, ...rules.map((rule) => rule.windowMs));
  const recent = times.filter((time) => time <= now && now - time < longest);
  for (const rule of rules) {
    if (recent.filter((time) => now - time < rule.windowMs).length >= rule.limit) return null;
  }
  return [...recent, now];
}

/** FNV-1a: a small stable hash, to spot repeats without keeping the text, and to give each name a color. */
export function lineHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** True when `text` is the same as a connection's last line, sent within REPEAT_MS. */
export function isRepeat(last: { hash: number; at: number } | null | undefined, text: string, now: number): boolean {
  return !!last && last.hash === lineHash(text) && now - last.at < REPEAT_MS;
}

export function isLoungeMessage(v: unknown): v is LoungeMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(m.id) &&
    (m.id as number) > 0 &&
    typeof m.name === 'string' &&
    lineLength(m.name) >= 1 &&
    lineLength(m.name) <= NAME_MAX &&
    typeof m.text === 'string' &&
    lineLength(m.text) >= 1 &&
    lineLength(m.text) <= TEXT_MAX &&
    typeof m.t === 'number' &&
    Number.isFinite(m.t)
  );
}

/** Adds messages by id, oldest first and without duplicates, keeping the newest `max`. */
export function addMessages(list: readonly LoungeMessage[], incoming: readonly LoungeMessage[], max = HISTORY): LoungeMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-max);
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Reads a frame from the Worker. Null for anything else, including the 'pong' that answers a keepalive. */
export function readEvent(raw: unknown): LoungeEvent | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  const c = typeof e.c === 'string' && TAG.test(e.c) ? { c: e.c } : {};
  switch (e.t) {
    case 'welcome':
      if (!Array.isArray(e.messages) || !isCount(e.online)) return null;
      return { t: 'welcome', messages: e.messages.filter(isLoungeMessage), online: e.online };
    case 'msg':
      return isLoungeMessage(e.m) ? { t: 'msg', m: e.m, ...c } : null;
    case 'online':
      return isCount(e.n) ? { t: 'online', n: e.n } : null;
    case 'cleared':
      return { t: 'cleared' };
    case 'error':
      return ERRORS.includes(e.error as LoungeError) ? { t: 'error', error: e.error as LoungeError, ...c } : null;
    default:
      return null;
  }
}

/** The chat's WebSocket URL on an arcade API base. */
export function loungeUrl(api: string): URL {
  const url = new URL(api);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/lounge`;
  url.search = '';
  return url;
}

const RETRY_MAX_MS = 30_000;

/**
 * How long to wait before connecting again after `failures` attempts in a row that never got in (0 after a drop):
 * a second, doubling up to 30 seconds, give or take a quarter so a crowd doesn't come back all at once.
 */
export function retryDelay(failures: number, random = Math.random()): number {
  const base = Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.75 + random * 0.5));
}

/** Compares a secret with what was given, in time that doesn't depend on where they differ. False when no secret is set. */
export async function sameSecret(given: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
