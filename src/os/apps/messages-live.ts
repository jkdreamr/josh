import { ARCADE_API } from '../arcade/kit/leaderboard';
import { isChatPage, isSession, type ChatPage } from '../chat-core';

export { cleanText, dayLabel, mergePage, MAX_TEXT, pollDelay, type ChatPage, type ThreadItem } from '../chat-core';

const SESSION_KEY = 'messages:chat';

/** This device's conversation, if the visitor has typed anything before. */
export function savedSession(): string | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    return isSession(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** A new random conversation id. Whoever holds it can read the conversation, so it never leaves this device except to the Worker. */
export function startSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* private mode: the conversation lasts as long as this page */
  }
  return id;
}

/** The conversation from index `after` on (or, without a session, just whether chat is live). Null when the Worker can't be reached. */
export async function readChat(session: string | null, after: number): Promise<ChatPage | null> {
  if (!ARCADE_API) return null;
  const query = new URLSearchParams({ after: String(after) });
  if (session) query.set('s', session);
  try {
    const res = await fetch(`${ARCADE_API}/chat?${query}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isChatPage(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * offline: the bot isn't set up (or this Worker predates chat), so the email fallback is the way.
 * slow / full: rate limit or conversation cap. error: anything else, the message may not have arrived.
 */
export type SendResult = { ok: true; page: ChatPage } | { ok: false; reason: 'offline' | 'slow' | 'full' | 'error' };

export async function sendChat(session: string, text: string, after: number): Promise<SendResult> {
  if (!ARCADE_API) return { ok: false, reason: 'offline' };
  try {
    // A plain text body keeps it a simple CORS request, so there is no preflight.
    const res = await fetch(`${ARCADE_API}/chat`, { method: 'POST', body: JSON.stringify({ s: session, text, after }) });
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.ok && isChatPage(body)) return { ok: true, page: body };
    const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    if (res.status === 404 || (res.status === 503 && error === 'offline')) return { ok: false, reason: 'offline' };
    if (res.status === 429) return { ok: false, reason: error === 'full' ? 'full' : 'slow' };
    return { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
