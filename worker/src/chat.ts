import { DurableObject } from 'cloudflare:workers';
import {
  AUTO_REPLY_DAILY,
  AUTO_REPLY_HOURS,
  DEFAULT_OWNER,
  KEEP_DAYS,
  MAX_THREAD,
  PAGE,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SITE_NAME,
  autoReplyPrompt,
  ownerNote,
  readAutoReply,
  readUpdate,
  readUsage,
  visitorTag,
  type ChatFrom,
  type ChatPage,
  type TgUpdate,
} from '../../src/os/chat-core.ts';
import { personaFacts } from '../../src/os/chat-persona.ts';

export interface ChatEnv {
  /** From @BotFather. Set with `npx wrangler secret put TELEGRAM_BOT_TOKEN`. */
  TELEGRAM_BOT_TOKEN?: string;
  /** The Telegram username allowed to claim the bot. Defaults to DEFAULT_OWNER. */
  TELEGRAM_OWNER?: string;
  /** Pins the chat visitor messages go to, instead of the one that claimed the bot. */
  TELEGRAM_CHAT_ID?: string;
  /** Replaces https://api.telegram.org, for local testing. */
  TELEGRAM_API?: string;
  /** Workers AI, for auto-replies. */
  AI?: Ai;
  /** Overrides AUTO_REPLY_HOURS, for local testing. */
  AUTO_REPLY_HOURS?: string;
}

export type ChatResult = { status: number; body: ChatPage | { error: string } };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Auto-reply models, tried in order (a retired model fails without running). Each has its Workers AI price
 * in Neurons per million input and output tokens, from Cloudflare's $ per token list at $0.011 per 1,000 Neurons.
 */
const MODELS: { id: string; perM: [number, number]; input?: Record<string, unknown> }[] = [
  { id: '@cf/google/gemma-4-26b-a4b-it', perM: [9091, 27273], input: { chat_template_kwargs: { enable_thinking: false } } },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', perM: [26637, 204546] },
];
const MAX_OUTPUT_TOKENS = 300;
/**
 * Neurons one attempt can cost at most: the prompt stays under 3,000 tokens (system prompt plus
 * AUTO_REPLY_CONTEXT_CHARS of chat) and the answer under MAX_OUTPUT_TOKENS, on the dearest model above.
 */
const WORST_NEURONS = 150;
/**
 * Workers AI gives 10,000 free Neurons a day (reset at 00:00 UTC). Auto-replies stop for the day at half of that,
 * or at AUTO_REPLY_DAILY attempts, whichever comes first, so they never cost anything.
 */
const NEURON_BUDGET = 5000;

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

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
    sql.exec('CREATE TABLE IF NOT EXISTS ai_days (day TEXT PRIMARY KEY, calls INTEGER NOT NULL, neurons REAL NOT NULL)');
    // Conversations stored before an alarm existed (or while it was lost) still get their auto-reply.
    void this.ctx.blockConcurrencyWhile(async () => {
      const oldest = this.waiting()[0];
      if (oldest) await this.arm(oldest.since + this.waitMs());
    });
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
    await this.arm(Date.now() + this.waitMs());
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
            'To answer, swipe left on their message and reply. A message that is not a reply goes to whoever you talked with last.\n\n' +
            `If you haven't answered in ${AUTO_REPLY_HOURS} hours, a free AI auto-reply answers for you (marked as one), and you'll see what it said. ` +
            "Reply /ai to a visitor's message to have it answer right away.",
        );
        return;
      case 'not-text':
        await this.tell(action.chat, 'Only text reaches the site for now.', action.message);
        return;
      case 'answer': {
        const target = this.target(action.replyTo);
        if (!target) {
          await this.tell(
            action.chat,
            action.replyTo ? "That message isn't from a visitor, or their chat has expired." : "Swipe left on a visitor's message and reply to it, so I know who it's for.",
            action.message,
          );
          return;
        }
        this.store(target, 'josh', action.text, action.message);
        await this.react(action.chat, action.message);
        return;
      }
      case 'ai': {
        const target = this.target(action.replyTo);
        if (!target) {
          await this.tell(action.chat, 'Reply /ai to a visitor\'s message to have the auto-reply answer them now.', action.message);
          return;
        }
        const result = await this.autoReply(target, true);
        if (result === 'sent') await this.react(action.chat, action.message);
        else if (result === 'limit') await this.tell(action.chat, `That's all ${AUTO_REPLY_DAILY} auto-replies for today. They reset at midnight UTC.`, action.message);
        else await this.tell(action.chat, "The auto-reply couldn't answer right now. Try again later.", action.message);
      }
    }
  }

  /** Runs when the oldest unanswered conversation has waited AUTO_REPLY_HOURS: auto-replies to every one that has. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const wait = this.waitMs();
    let stopped = false;
    for (const { session, since } of this.waiting()) {
      if (since > now - wait) continue;
      const result = await this.autoReply(session);
      if (result === 'limit') {
        stopped = true;
        break;
      }
    }
    // Next: the next conversation to come due. Ones still due (a failed or skipped reply) try again in an hour,
    // or after midnight UTC once today's auto-replies are used up.
    const pending = this.waiting();
    if (!pending.length) return;
    const tomorrow = Date.parse(`${utcDay(now)}T00:00:00Z`) + DAY_MS + 60_000;
    const next = Math.min(...pending.map((p) => p.since + wait));
    await this.ctx.storage.setAlarm(next > now ? next : stopped ? tomorrow : now + HOUR_MS);
  }

  /**
   * Has Workers AI answer one conversation for Josh (`asked`: he asked with /ai), then tells him on Telegram. Each attempt first reserves
   * WORST_NEURONS against today's budget, so a day's attempts can never add up to more than the free allowance.
   */
  private async autoReply(session: string, asked = false): Promise<'sent' | 'limit' | 'failed'> {
    const ai = this.env.AI;
    if (!ai) return 'failed';
    const thread = this.ctx.storage.sql
      .exec<{ sender: ChatFrom; text: string; t: number }>('SELECT sender, text, t FROM messages WHERE session = ? ORDER BY idx DESC LIMIT 40', session)
      .toArray()
      .reverse()
      .map(({ sender, text, t }) => ({ from: sender, text, t }));
    const messages = autoReplyPrompt(personaFacts(), thread);
    if (messages.length < 2) return 'failed';
    for (const model of MODELS) {
      const day = utcDay(Date.now());
      if (!this.reserve(day)) return 'limit';
      let raw: unknown;
      try {
        raw = await (ai as unknown as { run(model: string, input: unknown): Promise<unknown> }).run(model.id, {
          messages,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.5,
          ...model.input,
        });
      } catch (err) {
        console.error(`auto-reply ${model.id}:`, err);
        continue;
      }
      const usage = readUsage(raw);
      if (usage) this.settle(day, (usage.input * model.perM[0] + usage.output * model.perM[1]) / 1e6);
      const text = readAutoReply(raw);
      if (!text) continue;
      // Josh may have answered while the model was writing; then his answer stands alone.
      if (!asked && !this.waiting().some((w) => w.session === session)) return 'failed';
      this.store(session, 'auto', text);
      const owner = this.owner();
      if (owner !== null) {
        const note = await this.tell(owner, `🤖 Auto-replied to ${visitorTag(session)}:\n\n${text}\n\nReply to this to follow up yourself.`);
        if (note) this.link(note, session);
      }
      return 'sent';
    }
    return 'failed';
  }

  /** Counts one auto-reply attempt against today's budget at its worst-case cost. False when the day is used up. */
  private reserve(day: string): boolean {
    const sql = this.ctx.storage.sql;
    const used = sql.exec<{ calls: number; neurons: number }>('SELECT calls, neurons FROM ai_days WHERE day = ?', day).toArray()[0] ?? { calls: 0, neurons: 0 };
    if (used.calls >= AUTO_REPLY_DAILY || used.neurons + WORST_NEURONS > NEURON_BUDGET) return false;
    sql.exec(
      'INSERT INTO ai_days (day, calls, neurons) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET calls = calls + 1, neurons = neurons + excluded.neurons',
      day,
      WORST_NEURONS,
    );
    return true;
  }

  /** Swaps an attempt's worst-case reservation for what the model says it used, when that is more. */
  private settle(day: string, neurons: number) {
    if (neurons > WORST_NEURONS) this.ctx.storage.sql.exec('UPDATE ai_days SET neurons = neurons + ? WHERE day = ?', neurons - WORST_NEURONS, day);
  }

  /** Conversations whose newest messages are the visitor's with no answer after them, and since when. */
  private waiting(): { session: string; since: number }[] {
    return this.ctx.storage.sql
      .exec<{ session: string; since: number }>(
        `SELECT m.session AS session, MIN(m.t) AS since FROM messages m
         WHERE m.sender = 'visitor' AND m.idx > COALESCE((SELECT MAX(o.idx) FROM messages o WHERE o.session = m.session AND o.sender != 'visitor'), -1)
         GROUP BY m.session ORDER BY since`,
      )
      .toArray();
  }

  private waitMs(): number {
    const hours = Number(this.env.AUTO_REPLY_HOURS);
    return (Number.isFinite(hours) && hours > 0 ? hours : AUTO_REPLY_HOURS) * HOUR_MS;
  }

  /** Makes sure the alarm fires by `at`. */
  private async arm(at: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  /** The conversation a Telegram reply is about: the one its quoted message belongs to, or the last one Josh touched. */
  private target(replyTo?: number): string | null {
    if (!replyTo) return this.setting('last');
    return this.ctx.storage.sql.exec<{ session: string }>('SELECT session FROM telegram WHERE message = ?', replyTo).toArray()[0]?.session ?? null;
  }

  private async react(chat: number, message: number) {
    try {
      await this.telegram('setMessageReaction', { chat_id: chat, message_id: message, reaction: [{ type: 'emoji', emoji: '👍' }] });
    } catch (err) {
      console.error(err);
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

  /**
   * Appends a message. For Josh's and visitors' messages, also remembers which Telegram message carries it,
   * so a reply to that one finds this conversation, and makes this the conversation plain messages go to.
   */
  private store(session: string, sender: ChatFrom, text: string, telegramMessage?: number) {
    const now = Date.now();
    this.ctx.storage.sql.exec('INSERT INTO messages (session, idx, sender, text, t) VALUES (?, ?, ?, ?, ?)', session, this.length(session), sender, text, now);
    if (telegramMessage !== undefined) {
      this.link(telegramMessage, session);
      this.setSetting('last', session);
    }
    this.prune(now);
  }

  private link(telegramMessage: number, session: string) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO telegram (message, session, t) VALUES (?, ?, ?)', telegramMessage, session, Date.now());
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
    sql.exec('DELETE FROM ai_days WHERE day < ?', utcDay(now - 30 * DAY_MS));
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

  /** Best effort: a notice to Josh that fails should not fail the update it answers. Returns the message id when sent. */
  private async tell(chat: number, text: string, replyTo?: number): Promise<number | null> {
    try {
      const sent = await this.telegram<{ message_id: number }>('sendMessage', {
        chat_id: chat,
        text,
        link_preview_options: { is_disabled: true },
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
      return sent.message_id;
    } catch (err) {
      console.error(err);
      return null;
    }
  }
}
