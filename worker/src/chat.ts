import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_OWNER,
  KEEP_DAYS,
  MAX_THREAD,
  PAGE,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SITE_NAME,
  ownerNote,
  readUpdate,
  type ChatFrom,
  type ChatPage,
  type TgUpdate,
} from '../../src/os/chat-core.ts';

export interface ChatEnv {
  /** From @BotFather. Set with `npx wrangler secret put TELEGRAM_BOT_TOKEN`. */
  TELEGRAM_BOT_TOKEN?: string;
  /** The Telegram username allowed to claim the bot. Defaults to DEFAULT_OWNER. */
  TELEGRAM_OWNER?: string;
  /** Pins the chat visitor messages go to, instead of the one that claimed the bot. */
  TELEGRAM_CHAT_ID?: string;
  /** Replaces https://api.telegram.org, for local testing. */
  TELEGRAM_API?: string;
}

export type ChatResult = { status: number; body: ChatPage | { error: string } };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Live chat for the Messages app. A visitor's message goes to Josh through a Telegram bot;
 * his replies to the bot come back through its webhook and wait here until the visitor's app asks for them.
 */
export class Chat extends DurableObject<ChatEnv> {
  private readonly sends = new Map<string, number[]>();
  private prunedAt = 0;

  constructor(ctx: DurableObjectState, env: ChatEnv) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS messages (session TEXT NOT NULL, idx INTEGER NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (session, idx))');
    sql.exec('CREATE TABLE IF NOT EXISTS telegram (message INTEGER PRIMARY KEY, session TEXT NOT NULL, t INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  /** The conversation from index `after` on. Without a session, just whether chat is live. */
  read(session: string | null, after: number): ChatPage {
    const live = this.live();
    if (!session) return { live, from: 0, messages: [], next: 0 };
    const from = Math.min(after, this.length(session));
    const messages = this.ctx.storage.sql
      .exec<{ sender: ChatFrom; text: string; t: number }>('SELECT sender, text, t FROM messages WHERE session = ? AND idx >= ? ORDER BY idx LIMIT ?', session, from, PAGE)
      .toArray()
      .map(({ sender, text, t }) => ({ from: sender, text, t }));
    return { live, from, messages, next: from + messages.length };
  }

  /** Sends a visitor's message to Josh's Telegram and stores it. */
  async send(session: string, text: string, after: number, ip: string): Promise<ChatResult> {
    const owner = this.owner();
    if (!this.env.TELEGRAM_BOT_TOKEN || owner === null) return { status: 503, body: { error: 'offline' } };

    const now = Date.now();
    const recent = (this.sends.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      this.sends.set(ip, recent);
      return { status: 429, body: { error: 'slow' } };
    }
    if (this.sends.size > 10_000) this.sends.clear();
    recent.push(now);
    this.sends.set(ip, recent);

    const length = this.length(session);
    if (length >= MAX_THREAD) return { status: 429, body: { error: 'full' } };

    let note: { message_id: number };
    try {
      note = await this.telegram('sendMessage', { chat_id: owner, text: ownerNote(session, text, length === 0), link_preview_options: { is_disabled: true } });
    } catch (err) {
      console.error(err);
      return { status: 502, body: { error: 'unavailable' } };
    }
    this.store(session, 'visitor', text, note.message_id);
    return { status: 200, body: this.read(session, after) };
  }

  /** Handles one webhook update from Telegram. */
  async update(update: TgUpdate | null): Promise<void> {
    const owner = this.owner();
    const action = readUpdate(update, owner, this.env.TELEGRAM_OWNER || DEFAULT_OWNER);
    switch (action.kind) {
      case 'ignore':
        return;
      case 'stranger':
        if (action.start) await this.tell(action.chat, `Hi! This bot passes along messages from ${SITE_NAME} to Josh. To reach him, open Messages on the site.`);
        return;
      case 'claim':
        if (owner === null) this.setSetting('owner', String(action.chat));
        await this.tell(
          action.chat,
          `You're connected. Anything a visitor types in Messages on ${SITE_NAME} shows up here.\n\n` +
            'To answer, swipe left on their message and reply. A message that is not a reply goes to whoever you talked with last.',
        );
        return;
      case 'not-text':
        await this.tell(action.chat, 'Only text reaches the site for now.', action.message);
        return;
      case 'answer': {
        const target = action.replyTo
          ? this.ctx.storage.sql.exec<{ session: string }>('SELECT session FROM telegram WHERE message = ?', action.replyTo).toArray()[0]?.session
          : this.setting('last');
        if (!target) {
          await this.tell(
            action.chat,
            action.replyTo ? "That message isn't from a visitor, or their chat has expired." : "Swipe left on a visitor's message and reply to it, so I know who it's for.",
            action.message,
          );
          return;
        }
        this.store(target, 'josh', action.text, action.message);
        try {
          await this.telegram('setMessageReaction', { chat_id: action.chat, message_id: action.message, reaction: [{ type: 'emoji', emoji: '👍' }] });
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  /** Points the bot's webhook at `hook` and reports what is left to set up. Safe to run any number of times. */
  async setup(hook: string, secret: string): Promise<string> {
    const owner = `@${(this.env.TELEGRAM_OWNER || DEFAULT_OWNER).replace(/^@/, '')}`;
    if (!this.env.TELEGRAM_BOT_TOKEN) {
      return 'Not set up yet: add the bot token from @BotFather as a Worker secret named TELEGRAM_BOT_TOKEN (npx wrangler secret put TELEGRAM_BOT_TOKEN), then open this page again.';
    }
    try {
      const me = await this.telegram<{ username: string }>('getMe', {});
      await this.telegram('setWebhook', { url: hook, secret_token: secret, allowed_updates: ['message'] });
      const lines = [`✓ Bot @${me.username} is connected to ${hook}`];
      if (this.owner() !== null) lines.push('✓ Visitor messages go to your Telegram.', '', 'All set.');
      else lines.push('', `Last step: from your ${owner} Telegram account, open https://t.me/${me.username} and tap Start.`, 'Then reload this page.');
      return lines.join('\n');
    } catch (err) {
      return `Setup failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private live(): boolean {
    return !!this.env.TELEGRAM_BOT_TOKEN && this.owner() !== null;
  }

  private owner(): number | null {
    const raw = this.env.TELEGRAM_CHAT_ID || this.setting('owner');
    const id = Number(raw);
    return raw && Number.isSafeInteger(id) ? id : null;
  }

  private length(session: string): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE session = ?', session).one().n;
  }

  /** Appends a message and remembers which Telegram message carries it, so a reply to that one finds this conversation. */
  private store(session: string, sender: ChatFrom, text: string, telegramMessage: number) {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec('INSERT INTO messages (session, idx, sender, text, t) VALUES (?, ?, ?, ?, ?)', session, this.length(session), sender, text, now);
    sql.exec('INSERT OR REPLACE INTO telegram (message, session, t) VALUES (?, ?, ?)', telegramMessage, session, now);
    this.setSetting('last', session);
    this.prune(now);
  }

  private setting(key: string): string | null {
    return this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM settings WHERE key = ?', key).toArray()[0]?.value ?? null;
  }

  private setSetting(key: string, value: string) {
    this.ctx.storage.sql.exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  /** At most daily: drops conversations quiet for KEEP_DAYS, with their Telegram links. */
  private prune(now: number) {
    if (now - this.prunedAt < DAY_MS) return;
    this.prunedAt = now;
    const cutoff = now - KEEP_DAYS * DAY_MS;
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM messages WHERE session IN (SELECT session FROM messages GROUP BY session HAVING MAX(t) < ?)', cutoff);
    sql.exec('DELETE FROM telegram WHERE t < ?', cutoff);
  }

  private async telegram<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const base = (this.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
    const res = await fetch(`${base}/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!out?.ok) throw new Error(`Telegram ${method}: ${out?.description ?? `HTTP ${res.status}`}`);
    return out.result as T;
  }

  /** Best effort: a notice to Josh that fails should not fail the update it answers. */
  private async tell(chat: number, text: string, replyTo?: number) {
    try {
      await this.telegram('sendMessage', {
        chat_id: chat,
        text,
        link_preview_options: { is_disabled: true },
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
    } catch (err) {
      console.error(err);
    }
  }
}
