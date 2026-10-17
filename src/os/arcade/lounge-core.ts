/**
 * The Lounge, the arcade's global chat, shared by the site and the Worker's Lounge object: channels, message and member
 * shapes, cleaning and validation, the rate limiter, history trimming and the socket protocol.
 *
 * The site opens `/lounge?v=2` (with its name and what it's playing, see `loungeUrl`). It sends `{ t: 'say', ch, name,
 * text, c, invite? }`, `{ t: 'me', name?, game?, room? }` when what it shows about itself changes, `{ t: 'typing', ch }`
 * while someone types, and 'ping' (answered with 'pong' without waking the Worker). The Worker sends `welcome` (every
 * channel's recent messages, who's here and which of them you are) once on connect, then `msg`, `join`, `member`,
 * `leave`, `typing`, `cleared` and, to the sender only, `error`. `c` is the sender's own tag for a message; it comes back
 * on that message or its error, to the sender only.
 *
 * A socket without `v=2` (a tab from before channels) only gets #general, with `welcome`, `msg`, `online`, `cleared`
 * and `error` as it always did.
 */
import { cleanName, NAME_MAX } from './kit/leaderboard-core.ts';

export { NAME_MAX };

/** The channels, in the order they're listed. Each keeps its own newest HISTORY messages. */
export const CHANNELS = [
  { id: 'general', topic: 'Hang out and say hi.' },
  { id: 'find-a-game', topic: 'Rooms you can join are up top. Share yours, or ask around.' },
  { id: 'ideas', topic: 'Games you want next, and anything that broke.' },
] as const;
export type ChannelId = (typeof CHANNELS)[number]['id'];
/** Where a message without a channel goes, and the only channel a tab from before channels sees. */
export const DEFAULT_CHANNEL: ChannelId = 'general';
/** Where shared rooms are posted. */
export const INVITE_CHANNEL: ChannelId = 'find-a-game';
export const isChannel = (v: unknown): v is ChannelId => CHANNELS.some((channel) => channel.id === v);

/** The protocol the site asks for with `?v=2`. */
export const LOUNGE_VERSION = 2;
/** Messages the Worker keeps in each channel, and sends to everyone who joins. */
export const HISTORY = 100;
export const TEXT_MAX = 280;
/** The longest frame the Worker reads. A full message is well under 1 KB; anything bigger closes the socket. */
export const FRAME_MAX = 2048;
/** The site pings this often so its socket doesn't idle out, like the arcade rooms and the Stats panel. */
export const KEEPALIVE_MS = 25_000;
/** The same line twice in a row from one connection within this long is dropped. */
export const REPEAT_MS = 60_000;
/** While someone types, the site says so at most this often, and everyone else shows it for this long after the last time. */
export const TYPING_EVERY_MS = 3000;
export const TYPING_SHOW_MS = 6000;

export type RateRule = { limit: number; windowMs: number };
/** Messages one connection can send. */
export const SOCKET_RATE: readonly RateRule[] = [{ limit: 5, windowMs: 10_000 }];
/** Messages one IP can send across all its connections: room for a couple of people on one network, not for a flood. */
export const IP_RATE: readonly RateRule[] = [
  { limit: 10, windowMs: 10_000 },
  { limit: 30, windowMs: 60_000 },
];
/** Changes to what one connection shows about itself. Past this they're ignored, so nobody can keep the member list churning. */
export const ME_RATE: readonly RateRule[] = [{ limit: 5, windowMs: 10_000 }];
/** Typing notes one connection can send. The site sends one every TYPING_EVERY_MS at most; extras are ignored. */
export const TYPING_RATE: readonly RateRule[] = [{ limit: 1, windowMs: 2000 }];

/** A room shared in a message, to join from the chat. */
export type LoungeInvite = { game: string; code: string };
export type LoungeMessage = { id: number; ch: ChannelId; name: string; text: string; t: number; invite?: LoungeInvite };
/** Someone with the Lounge open: their name once they've picked one, and what they're playing, with the room if it's public. */
export type LoungeMember = { id: string; name?: string; game?: string; room?: string };
export type Presence = Omit<LoungeMember, 'id'>;
/** Why a message wasn't posted: a bad name, text, channel or room, too many too fast, or the same line again. */
export type LoungeError = 'name' | 'text' | 'channel' | 'invite' | 'slow' | 'repeat';
export type LoungeSay = { t: 'say'; ch: ChannelId; name: string; text: string; c?: string; invite?: LoungeInvite };
export type LoungeMe = { t: 'me' } & Presence;
export type LoungeTyping = { t: 'typing'; ch: ChannelId };
export type LoungeEvent =
  | { t: 'welcome'; messages: LoungeMessage[]; online: number; v?: number; you?: string; members?: LoungeMember[] }
  | { t: 'msg'; m: LoungeMessage; c?: string; by?: string }
  | { t: 'online'; n: number }
  | { t: 'join' | 'member'; m: LoungeMember }
  | { t: 'leave'; id: string }
  | { t: 'typing'; ch: ChannelId; id: string }
  | { t: 'cleared'; ch?: ChannelId }
  | { t: 'error'; error: LoungeError; c?: string };

const ERRORS: readonly LoungeError[] = ['name', 'text', 'channel', 'invite', 'slow', 'repeat'];
const TAG = /^[A-Za-z0-9_-]{1,16}$/;
const MEMBER_ID = /^[a-z0-9]{4,16}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/**
 * Cleans a name or a line of chat: control, zero width and bidi characters out and whitespace squeezed, like a leaderboard name,
 * then blank lookalike characters out and stacks of combining marks cut to three, so a line can't spill over its neighbors.
 */
export function cleanLine(raw: string): string {
  return cleanName(raw)
    .replace(/[­ᅟᅠ᠎⠀ㅤﾠ]/g, '')
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

/** A JSON object, or null for anything else. */
function readObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A name cleaned to 1 to NAME_MAX characters, or undefined. */
function readName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = cleanLine(v);
  return lineLength(name) >= 1 && lineLength(name) <= NAME_MAX ? name : undefined;
}

export function readInvite(v: unknown): LoungeInvite | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { game, code } = v as Record<string, unknown>;
  return typeof game === 'string' && GAME_ID.test(game) && typeof code === 'string' && ROOM_CODE.test(code) ? { game, code } : undefined;
}

/** What someone shows about themselves, from a frame or the socket URL. Anything malformed is left out, and a room only comes with its game. */
export function readPresence(body: Record<string, unknown>): Presence {
  const name = readName(body.name);
  const game = typeof body.game === 'string' && GAME_ID.test(body.game) ? body.game : undefined;
  const room = game && typeof body.room === 'string' && ROOM_CODE.test(body.room) ? body.room : undefined;
  return { ...(name && { name }), ...(game && { game }), ...(room && { room }) };
}

export const samePresence = (a: Presence, b: Presence) => a.name === b.name && a.game === b.game && a.room === b.room;

export type Said = { ch: ChannelId; name: string; text: string; c?: string; invite?: LoungeInvite };
export type SayError = { error: 'name' | 'text' | 'channel' | 'invite'; c?: string };

function sayFrom(body: Record<string, unknown>): Said | SayError {
  const c = typeof body.c === 'string' && TAG.test(body.c) ? { c: body.c } : {};
  // A tab from before channels doesn't say one.
  const ch = body.ch === undefined ? DEFAULT_CHANNEL : body.ch;
  if (!isChannel(ch)) return { error: 'channel', ...c };
  const name = readName(body.name);
  if (!name) return { error: 'name', ...c };
  const text = typeof body.text === 'string' ? cleanLine(body.text) : '';
  if (lineLength(text) < 1 || lineLength(text) > TEXT_MAX) return { error: 'text', ...c };
  if (body.invite === undefined) return { ch, name, text, ...c };
  const invite = readInvite(body.invite);
  return invite ? { ch, name, text, ...c, invite } : { error: 'invite', ...c };
}

/**
 * Reads a say frame from the site: the message with its name and text cleaned, the reason it can't be posted, or null
 * for anything else (ignored).
 */
export function readSay(raw: unknown): Said | SayError | null {
  if (typeof raw !== 'string' || raw.length > FRAME_MAX) return null;
  const body = readObject(raw);
  return body?.t === 'say' ? sayFrom(body) : null;
}

export type LoungeFrame = { t: 'say'; said: Said | SayError } | { t: 'me'; presence: Presence } | { t: 'typing'; ch: ChannelId };

/** Reads any frame from the site. Null for anything else, which the Worker ignores. */
export function readFrame(raw: unknown): LoungeFrame | null {
  if (typeof raw !== 'string' || raw.length > FRAME_MAX) return null;
  const body = readObject(raw);
  if (body?.t === 'say') return { t: 'say', said: sayFrom(body) };
  if (body?.t === 'me') return { t: 'me', presence: readPresence(body) };
  if (body?.t === 'typing' && isChannel(body.ch)) return { t: 'typing', ch: body.ch };
  return null;
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

/** A message from the Worker, in #general if it predates channels, without its room if that's malformed. Null when anything else is off. */
export function readMessage(v: unknown): LoungeMessage | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  const ch = m.ch === undefined ? DEFAULT_CHANNEL : m.ch;
  const ok =
    Number.isSafeInteger(m.id) &&
    (m.id as number) > 0 &&
    isChannel(ch) &&
    typeof m.name === 'string' &&
    lineLength(m.name) >= 1 &&
    lineLength(m.name) <= NAME_MAX &&
    typeof m.text === 'string' &&
    lineLength(m.text) >= 1 &&
    lineLength(m.text) <= TEXT_MAX &&
    typeof m.t === 'number' &&
    Number.isFinite(m.t);
  if (!ok) return null;
  const invite = readInvite(m.invite);
  return { id: m.id as number, ch: ch as ChannelId, name: m.name as string, text: m.text as string, t: m.t as number, ...(invite && { invite }) };
}

export function readMember(v: unknown): LoungeMember | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && MEMBER_ID.test(m.id) ? { id: m.id, ...readPresence(m) } : null;
}

/** A member id for a new connection, from random bytes. */
export const memberId = (bytes: Uint8Array) => Array.from(bytes, (b) => (b % 36).toString(36)).join('');

/** Adds messages by id, oldest first and without duplicates, keeping the newest `max` in each channel. */
export function addMessages(list: readonly LoungeMessage[], incoming: readonly LoungeMessage[], max = HISTORY): LoungeMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  const sorted = [...byId.values()].sort((a, b) => a.id - b.id);
  const left = new Map<ChannelId, number>();
  const kept: LoungeMessage[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const n = left.get(sorted[i].ch) ?? 0;
    if (n >= max) continue;
    left.set(sorted[i].ch, n + 1);
    kept.push(sorted[i]);
  }
  return kept.reverse();
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isMemberId = (v: unknown): v is string => typeof v === 'string' && MEMBER_ID.test(v);
const present = <T>(v: T | null): v is T => v !== null;

/** Reads a frame from the Worker. Null for anything else, including the 'pong' that answers a keepalive. */
export function readEvent(raw: unknown): LoungeEvent | null {
  const e = readObject(raw);
  if (!e) return null;
  const c = typeof e.c === 'string' && TAG.test(e.c) ? { c: e.c } : {};
  switch (e.t) {
    case 'welcome': {
      if (!Array.isArray(e.messages) || !isCount(e.online)) return null;
      const messages = e.messages.map(readMessage).filter(present);
      // An older Worker says nothing about who's here, and has #general only.
      if (e.v !== LOUNGE_VERSION) return { t: 'welcome', messages, online: e.online };
      if (!isMemberId(e.you) || !Array.isArray(e.members)) return null;
      return { t: 'welcome', messages, online: e.online, v: LOUNGE_VERSION, you: e.you, members: e.members.map(readMember).filter(present) };
    }
    case 'msg': {
      const m = readMessage(e.m);
      return m ? { t: 'msg', m, ...c, ...(isMemberId(e.by) && { by: e.by }) } : null;
    }
    case 'online':
      return isCount(e.n) ? { t: 'online', n: e.n } : null;
    case 'join':
    case 'member': {
      const m = readMember(e.m);
      return m ? { t: e.t, m } : null;
    }
    case 'leave':
      return isMemberId(e.id) ? { t: 'leave', id: e.id } : null;
    case 'typing':
      return isChannel(e.ch) && isMemberId(e.id) ? { t: 'typing', ch: e.ch, id: e.id } : null;
    case 'cleared':
      return isChannel(e.ch) ? { t: 'cleared', ch: e.ch } : { t: 'cleared' };
    case 'error':
      return ERRORS.includes(e.error as LoungeError) ? { t: 'error', error: e.error as LoungeError, ...c } : null;
    default:
      return null;
  }
}

/** The chat's WebSocket URL on an arcade API base, asking for the current protocol and saying who's connecting. */
export function loungeUrl(api: string, presence: Presence = {}): URL {
  const url = new URL(api);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/lounge`;
  url.search = '';
  url.searchParams.set('v', String(LOUNGE_VERSION));
  for (const key of ['name', 'game', 'room'] as const) {
    const value = presence[key];
    if (value) url.searchParams.set(key, value);
  }
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

/** The newest message id in each channel a reader has seen. */
export type ReadMarks = Partial<Record<ChannelId, number>>;

/** Messages in each channel newer than what was read there. */
export function unreadCounts(messages: readonly LoungeMessage[], read: ReadMarks): Record<ChannelId, number> {
  const counts = Object.fromEntries(CHANNELS.map((channel) => [channel.id, 0])) as Record<ChannelId, number>;
  for (const m of messages) if (m.id > (read[m.ch] ?? 0)) counts[m.ch]++;
  return counts;
}

/** The newest message in each channel, as read marks: what a first visit counts as already read. */
export function newestIds(messages: readonly LoungeMessage[]): ReadMarks {
  const marks: ReadMarks = {};
  for (const m of messages) marks[m.ch] = Math.max(marks[m.ch] ?? 0, m.id);
  return marks;
}

/** "Mina is typing…", up to three names, then "Several people are typing…". Empty when nobody is. */
export function typingLine(names: readonly string[]): string {
  const who = [...new Set(names)];
  if (who.length === 0) return '';
  if (who.length === 1) return `${who[0]} is typing…`;
  if (who.length === 2) return `${who[0]} and ${who[1]} are typing…`;
  if (who.length === 3) return `${who[0]}, ${who[1]} and ${who[2]} are typing…`;
  return 'Several people are typing…';
}

const WORD = /[\p{L}\p{N}_]/u;

/** True when `text` mentions `name` as @name, in any case, and not as part of a longer word or an email address. */
export function mentions(text: string, name: string): boolean {
  if (!name) return false;
  const hay = text.toLowerCase();
  const tag = `@${name.toLowerCase()}`;
  for (let i = hay.indexOf(tag); i >= 0; i = hay.indexOf(tag, i + 1)) {
    const before = Array.from(hay.slice(0, i)).at(-1) ?? '';
    const after = Array.from(hay.slice(i + tag.length))[0] ?? '';
    if (!WORD.test(before) && !WORD.test(after)) return true;
  }
  return false;
}

/**
 * Who to list by name, and how many are here without one. Someone in two tabs is listed once. Members in a public room
 * come first (you can join them), then everyone playing something, then the rest, by name within each.
 */
export function memberList(members: readonly LoungeMember[], you: string | null): { named: (LoungeMember & { you: boolean })[]; guests: number } {
  const byKey = new Map<string, LoungeMember & { you: boolean }>();
  let guests = 0;
  for (const m of members) {
    if (!m.name) {
      guests++;
      continue;
    }
    const key = `${m.name.toLowerCase()}|${m.game ?? ''}|${m.room ?? ''}`;
    const held = byKey.get(key);
    if (!held || m.id === you) byKey.set(key, { ...m, you: m.id === you || !!held?.you });
  }
  const rank = (m: LoungeMember) => (m.room ? 0 : m.game ? 1 : 2);
  const named = [...byKey.values()].sort((a, b) => rank(a) - rank(b) || a.name!.localeCompare(b.name!, undefined, { sensitivity: 'base' }));
  return { named, guests };
}
