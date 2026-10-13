/** Live chat in the Messages app, shared by the site and the Worker: message shapes, validation and Telegram update routing. */

export const SITE_NAME = 'joshuakoo.xyz';
export const MAX_TEXT = 1000;
/** Messages one visitor's conversation can hold before the Worker stops taking more. */
export const MAX_THREAD = 400;
/** Messages one IP can send per RATE_WINDOW_MS. */
export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
/** A conversation is dropped this long after its last message. */
export const KEEP_DAYS = 90;
/** Rows per GET; the client asks again from `next` for more. */
export const PAGE = 200;
export const DEFAULT_OWNER = 'temporary_jk';

export type ChatFrom = 'visitor' | 'josh';
export type ChatMessage = { from: ChatFrom; text: string; t: number };

/**
 * What GET and POST /chat return: the conversation's messages from index `from` on, and the index after the last one.
 * `live` is false until the bot is set up and Josh has connected his Telegram.
 */
export type ChatPage = { live: boolean; from: number; messages: ChatMessage[]; next: number };

const SESSION = /^[A-Za-z0-9_-]{20,64}$/;

export function isSession(v: unknown): v is string {
  return typeof v === 'string' && SESSION.test(v);
}

/** Trims, drops control characters, squeezes long runs of blank lines. Null when nothing is left or it is too long. */
export function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text || text.length > MAX_TEXT) return null;
  return text;
}

/** A non-negative integer query value, or 0. */
export function readIndex(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

export function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (m.from === 'visitor' || m.from === 'josh') && typeof m.text === 'string' && typeof m.t === 'number' && Number.isFinite(m.t);
}

export function isChatPage(v: unknown): v is ChatPage {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.live === 'boolean' &&
    Number.isSafeInteger(p.from) &&
    Number.isSafeInteger(p.next) &&
    Array.isArray(p.messages) &&
    p.messages.every(isChatMessage) &&
    (p.next as number) === (p.from as number) + p.messages.length
  );
}

/** A short label for a visitor in Telegram, without giving away their whole session id. */
export function visitorTag(session: string): string {
  return `#${session.slice(0, 4).toLowerCase()}`;
}

/** What Josh sees in Telegram for a visitor's message. */
export function ownerNote(session: string, text: string, first: boolean): string {
  if (!first) return `${visitorTag(session)}\n${text}`;
  return `New chat ${visitorTag(session)} on ${SITE_NAME}\n\n${text}\n\nSwipe left on this to reply. Your answer shows up in their Messages window.`;
}

/** The webhook's secret_token, derived from the bot token so there is nothing extra to configure. */
export async function webhookSecret(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`josh-site-telegram:${token}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The parts of a Telegram Update the webhook reads. */
export type TgUpdate = {
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    reply_to_message?: { message_id: number };
  };
};

export type UpdateAction =
  | { kind: 'ignore' }
  /** Someone other than Josh wrote to the bot. `start` is true for their /start. */
  | { kind: 'stranger'; chat: number; start: boolean }
  /** Josh wrote /start, or wrote anything before the bot knew his chat: visitor messages go to this chat. */
  | { kind: 'claim'; chat: number }
  | { kind: 'not-text'; chat: number; message: number }
  /** Josh's answer. `replyTo` is the Telegram message he replied to, if any. */
  | { kind: 'answer'; chat: number; message: number; text: string; replyTo?: number };

/**
 * Decides what an update means. `owner` is Josh's chat id once known; until then,
 * the first private message from the `ownerName` username claims the bot.
 */
export function readUpdate(update: TgUpdate | null | undefined, owner: number | null, ownerName: string): UpdateAction {
  const msg = update?.message;
  if (!msg || !msg.chat || typeof msg.chat.id !== 'number') return { kind: 'ignore' };
  const chat = msg.chat.id;
  const start = typeof msg.text === 'string' && /^\/start(\s|@|$)/.test(msg.text);
  const username = msg.from?.username?.toLowerCase();
  const named = msg.chat.type === 'private' && !!username && username === ownerName.toLowerCase().replace(/^@/, '');
  if (owner === null) return named ? { kind: 'claim', chat } : { kind: 'stranger', chat, start };
  if (chat !== owner) return { kind: 'stranger', chat, start };
  if (start) return { kind: 'claim', chat };
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!text) return { kind: 'not-text', chat, message: msg.message_id };
  return { kind: 'answer', chat, message: msg.message_id, text, replyTo: msg.reply_to_message?.message_id };
}

/** How long the Messages app waits between checks for replies, by time since the conversation last moved. Null: stop. */
export function pollDelay(idleMs: number): number | null {
  if (idleMs < 2 * 60 * 1000) return 3000;
  if (idleMs < 15 * 60 * 1000) return 8000;
  if (idleMs < 2 * 60 * 60 * 1000) return 30_000;
  return null;
}

/** A bubble in the Messages app. Live ones carry their index in the conversation; typed ones are 'sending' until stored. */
export type ThreadItem = { from: 'me' | 'josh'; text: unknown; t: number; idx?: number; status?: 'sending' | 'failed' };

/**
 * Adds a page of the conversation to the bubbles on screen. `have` is how many of the conversation's messages are
 * already there; earlier ones in the page are skipped. A visitor message settles the oldest unconfirmed bubble with
 * the same text (one still sending first), and anything else becomes a new bubble from `make`: at the end, or at the start for `history`.
 */
export function mergePage<T extends ThreadItem>(items: T[], page: ChatPage, have: number, make: (m: ChatMessage, idx: number) => T, history = false): T[] {
  const list = [...items];
  const added: T[] = [];
  page.messages.forEach((m, i) => {
    const idx = page.from + i;
    if (idx < have) return;
    if (m.from === 'visitor') {
      const waiting = (status: ThreadItem['status']) => list.findIndex((b) => b.from === 'me' && b.status === status && b.idx === undefined && b.text === m.text);
      const sending = waiting('sending');
      // A 'failed' one can still have arrived if only the response was lost.
      const k = sending >= 0 ? sending : waiting('failed');
      if (k >= 0) {
        list[k] = { ...list[k], idx, status: undefined, t: m.t };
        return;
      }
    }
    added.push(make(m, idx));
  });
  return history ? [...added, ...list] : [...list, ...added];
}

/** iMessage-style day heading: Today, Yesterday, a weekday within the week, then a date. */
export function dayLabel(t: number, now = Date.now()): string {
  const midnight = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((midnight(now) - midnight(t)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const date = new Date(t);
  if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
