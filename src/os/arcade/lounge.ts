import { ARCADE_API } from './kit/leaderboard.ts';
import {
  addMessages,
  HISTORY,
  KEEPALIVE_MS,
  loungeUrl,
  readEvent,
  retryDelay,
  samePresence,
  TYPING_EVERY_MS,
  TYPING_SHOW_MS,
  type ChannelId,
  type LoungeError,
  type LoungeEvent,
  type LoungeInvite,
  type LoungeMe,
  type LoungeMember,
  type LoungeMessage,
  type LoungeSay,
  type LoungeTyping,
  type Presence,
} from './lounge-core.ts';

export {
  CHANNELS,
  cleanLine,
  DEFAULT_CHANNEL,
  INVITE_CHANNEL,
  isChannel,
  lineHash,
  memberList,
  mentions,
  NAME_MAX,
  newestIds,
  TEXT_MAX,
  typingLine,
  unreadCounts,
  validLine,
  type ChannelId,
  type LoungeError,
  type LoungeInvite,
  type LoungeMember,
  type LoungeMessage,
  type Presence,
  type ReadMarks,
} from './lounge-core.ts';

/** live: in the chat. connecting: before the first welcome. reconnecting: the socket dropped and is coming back. */
export type LoungeStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';
export type LoungeState = {
  status: LoungeStatus;
  /** Every channel's messages, oldest first. */
  messages: LoungeMessage[];
  /** Who's here, or null when the Worker is too old to say (then `online` is all there is). */
  members: LoungeMember[] | null;
  online: number | null;
  /** Your own member id, once a Worker that has them has said. */
  you: string | null;
  /** Members typing right now: where, and until when to show it. */
  typing: Record<string, { ch: ChannelId; until: number }>;
};
/** A message that wasn't posted, with its text (and room) so it can go back in the box. offline: the socket dropped before the Worker answered. */
export type LoungeReject = { text: string; invite?: LoungeInvite; error: LoungeError | 'offline' };

/** Attempts in a row that never got in before the chat says it's unavailable. A Worker without /lounge fails every one. */
const UNAVAILABLE_AFTER = 2;
/** How long a ping may go unanswered before the socket counts as dead, on the keepalive and when the page comes back. */
const PONG_MS = 10_000;
const WAKE_PONG_MS = 5000;
/** Messages kept on screen per channel: a joiner gets the newest HISTORY, and a long visit keeps some scrollback past that. */
const KEEP = 2 * HISTORY;

const without = <T>(record: Record<string, T>, id: string) => {
  const { [id]: _gone, ...rest } = record;
  return rest;
};

/**
 * The Lounge's connection: one WebSocket to the Worker while the Lounge is open. Says who's connecting and what they're
 * playing, reconnects with backoff when it drops, and pings every KEEPALIVE_MS (answered by the Worker without waking it)
 * to stay open and notice a dead socket.
 */
export class LoungeLink {
  state: LoungeState;
  private readonly api: string;
  private readonly ok: boolean;
  private socket: WebSocket | null = null;
  /** Whether the current socket got its welcome, and whether it was from a Worker with channels and members. */
  private welcomed = false;
  private current = false;
  private everLive = false;
  private failures = 0;
  private closed = false;
  private heardAt = 0;
  private seq = 0;
  /** What to show about ourselves, and what the Worker was last told. */
  private me: Presence;
  private told: Presence = {};
  private typedAt = 0;
  private typedIn: ChannelId | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private typingTimer: ReturnType<typeof setTimeout> | undefined;
  /** Each message sent but not answered yet, by its tag. */
  private readonly pending = new Map<string, { text: string; invite?: LoungeInvite }>();
  private readonly changeListeners = new Set<(state: LoungeState) => void>();
  private readonly rejectListeners = new Set<(reject: LoungeReject) => void>();

  constructor(api = ARCADE_API, presence: Presence = {}) {
    this.api = api;
    this.me = presence;
    let ok = false;
    try {
      ok = !!api && !!loungeUrl(api);
    } catch {
      ok = false;
    }
    this.ok = ok;
    this.state = { status: ok ? 'connecting' : 'unavailable', messages: [], members: null, online: null, you: null, typing: {} };
    if (!ok) return;
    if (typeof window !== 'undefined') window.addEventListener('online', this.wake);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.wake);
    this.connect();
  }

  onChange(listener: (state: LoungeState) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onReject(listener: (reject: LoungeReject) => void): () => void {
    this.rejectListeners.add(listener);
    return () => this.rejectListeners.delete(listener);
  }

  /** Posts a line (already cleaned) to a channel. False when not connected; otherwise it arrives as a message, or comes back through onReject. */
  say(ch: ChannelId, name: string, text: string, invite?: LoungeInvite): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state.status !== 'live') return false;
    const c = (++this.seq).toString(36);
    this.pending.set(c, invite ? { text, invite } : { text });
    ws.send(JSON.stringify({ t: 'say', ch, name, text, c, ...(invite && { invite }) } satisfies LoungeSay));
    this.typedAt = 0;
    return true;
  }

  /** What to show about ourselves: a name, and what we're playing. Tells the Worker when it changes. */
  presence(next: Presence) {
    this.me = next;
    this.tell();
  }

  /** Someone is typing in `ch`. Tells the Worker every TYPING_EVERY_MS at most. */
  typing(ch: ChannelId) {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.current || !this.me.name) return;
    const now = Date.now();
    if (ch === this.typedIn && now - this.typedAt < TYPING_EVERY_MS) return;
    this.typedAt = now;
    this.typedIn = ch;
    ws.send(JSON.stringify({ t: 'typing', ch } satisfies LoungeTyping));
  }

  /** Tries again now, after the chat said it was unavailable. */
  retry() {
    if (this.closed || this.socket || !this.ok) return;
    this.set({ status: this.everLive ? 'reconnecting' : 'connecting' });
    this.connect();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.typingTimer);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.wake);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.wake);
    const ws = this.socket;
    this.socket = null;
    ws?.close();
    this.pending.clear();
    this.changeListeners.clear();
    this.rejectListeners.clear();
  }

  private readonly connect = () => {
    clearTimeout(this.retryTimer);
    if (this.closed || this.socket || !this.ok) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(loungeUrl(this.api, this.me));
    } catch {
      this.set({ status: 'unavailable' });
      return;
    }
    this.socket = ws;
    this.welcomed = false;
    this.current = false;
    this.told = this.me;
    ws.addEventListener('message', (e: MessageEvent) => this.receive(ws, e.data));
    ws.addEventListener('close', () => this.dropped(ws));
  };

  /** Sends what we show about ourselves if the Worker has heard something else. */
  private tell() {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.current || samePresence(this.told, this.me)) return;
    this.told = this.me;
    ws.send(JSON.stringify({ t: 'me', ...this.me } satisfies LoungeMe));
  }

  private receive(ws: WebSocket, data: unknown) {
    if (this.socket !== ws) return;
    this.heardAt = Date.now();
    const event = readEvent(data);
    if (!event) return;
    if (event.t === 'welcome') return this.welcome(ws, event);
    if (!this.welcomed) return;
    const { members, typing } = this.state;
    switch (event.t) {
      case 'msg': {
        if (event.c) this.pending.delete(event.c);
        this.set({ messages: addMessages(this.state.messages, [event.m], KEEP), ...(event.by && typing[event.by] && { typing: without(typing, event.by) }) });
        break;
      }
      case 'online':
        this.set({ online: event.n });
        break;
      case 'join':
      case 'member': {
        if (!members) break;
        const next = members.some((m) => m.id === event.m.id) ? members.map((m) => (m.id === event.m.id ? event.m : m)) : [...members, event.m];
        this.set({ members: next, online: next.length });
        break;
      }
      case 'leave': {
        if (!members) break;
        const next = members.filter((m) => m.id !== event.id);
        this.set({ members: next, online: next.length, typing: without(typing, event.id) });
        break;
      }
      case 'typing':
        if (event.id === this.state.you) break;
        this.set({ typing: { ...typing, [event.id]: { ch: event.ch, until: Date.now() + TYPING_SHOW_MS } } });
        this.expireTyping();
        break;
      case 'cleared':
        this.set({ messages: event.ch ? this.state.messages.filter((m) => m.ch !== event.ch) : [] });
        break;
      case 'error': {
        const sent = (event.c && this.pending.get(event.c)) || { text: '' };
        if (event.c) this.pending.delete(event.c);
        this.emitReject({ ...sent, error: event.error });
        break;
      }
    }
  }

  private welcome(ws: WebSocket, event: Extract<LoungeEvent, { t: 'welcome' }>) {
    this.welcomed = true;
    this.everLive = true;
    this.failures = 0;
    this.current = !!event.members;
    this.keepAlive(ws);
    this.set({
      status: 'live',
      messages: addMessages([], event.messages, KEEP),
      members: event.members ?? null,
      online: event.members?.length ?? event.online,
      you: event.you ?? null,
      typing: {},
    });
    // What we show may have changed while connecting.
    this.tell();
  }

  /** Drops typing notes once they're stale, checking again at the next one due. */
  private expireTyping() {
    clearTimeout(this.typingTimer);
    const now = Date.now();
    const typing = Object.fromEntries(Object.entries(this.state.typing).filter(([, note]) => note.until > now));
    if (Object.keys(typing).length !== Object.keys(this.state.typing).length) this.set({ typing });
    const next = Math.min(...Object.values(typing).map((note) => note.until));
    if (Number.isFinite(next)) this.typingTimer = setTimeout(() => this.expireTyping(), next - now);
  }

  /** The socket closed (or went quiet): hand back anything unanswered and try again after a pause. */
  private dropped(ws: WebSocket) {
    if (this.socket !== ws) return;
    this.socket = null;
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.typingTimer);
    for (const sent of this.pending.values()) this.emitReject({ ...sent, error: 'offline' });
    this.pending.clear();
    if (this.closed) return;
    if (!this.welcomed) this.failures++;
    this.set({ status: this.failures >= UNAVAILABLE_AFTER ? 'unavailable' : this.everLive ? 'reconnecting' : 'connecting', typing: {} });
    this.retryTimer = setTimeout(this.connect, retryDelay(this.failures));
  }

  private keepAlive(ws: WebSocket) {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.ping(ws, PONG_MS), KEEPALIVE_MS);
  }

  /** Pings, and gives up on the socket if nothing at all comes back within `wait`. */
  private ping(ws: WebSocket, wait: number) {
    if (this.socket !== ws || ws.readyState !== WebSocket.OPEN) return;
    const asked = Date.now();
    ws.send('ping');
    clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      if (this.socket !== ws || this.heardAt >= asked) return;
      this.dropped(ws);
      ws.close();
    }, wait);
  }

  /** Back online, or back on this tab: reconnect now if the socket is gone, or check it still answers (phones drop them quietly). */
  private readonly wake = () => {
    if (this.closed || (typeof document !== 'undefined' && document.hidden)) return;
    if (!this.socket) this.connect();
    else if (this.welcomed) this.ping(this.socket, WAKE_PONG_MS);
  };

  private set(patch: Partial<LoungeState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.changeListeners) listener(this.state);
  }

  private emitReject(reject: LoungeReject) {
    for (const listener of this.rejectListeners) listener(reject);
  }
}
