import { ARCADE_API } from './kit/leaderboard.ts';
import { addMessages, HISTORY, KEEPALIVE_MS, loungeUrl, readEvent, retryDelay, type LoungeError, type LoungeMessage, type LoungeSay } from './lounge-core.ts';

export { cleanLine, lineHash, NAME_MAX, TEXT_MAX, validLine, type LoungeError, type LoungeMessage } from './lounge-core.ts';

/** live: in the chat. connecting: before the first welcome. reconnecting: the socket dropped and is coming back. */
export type LoungeStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';
export type LoungeState = { status: LoungeStatus; messages: LoungeMessage[]; online: number | null };
/** A message that wasn't posted, with its text so it can go back in the box. offline: the socket dropped before the Worker answered. */
export type LoungeReject = { text: string; error: LoungeError | 'offline' };

/** Attempts in a row that never got in before the chat says it's unavailable. A Worker without /lounge fails every one. */
const UNAVAILABLE_AFTER = 2;
/** How long a ping may go unanswered before the socket counts as dead, on the keepalive and when the page comes back. */
const PONG_MS = 10_000;
const WAKE_PONG_MS = 5000;
/** Messages kept on screen: a joiner gets the newest HISTORY, and a long visit keeps some scrollback past that. */
const KEEP = 2 * HISTORY;

/**
 * The arcade chat's connection: one WebSocket to the Worker's Lounge while the chat is open. Reconnects with backoff
 * when it drops, and pings every KEEPALIVE_MS (answered by the Worker without waking it) to stay open and notice a dead socket.
 */
export class LoungeLink {
  state: LoungeState;
  private readonly url: URL | null;
  private socket: WebSocket | null = null;
  /** Whether the current socket got its welcome. */
  private welcomed = false;
  private everLive = false;
  private failures = 0;
  private closed = false;
  private heardAt = 0;
  private seq = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  /** Text of each message sent but not answered yet, by its tag. */
  private readonly pending = new Map<string, string>();
  private readonly changeListeners = new Set<(state: LoungeState) => void>();
  private readonly rejectListeners = new Set<(reject: LoungeReject) => void>();

  constructor(api = ARCADE_API) {
    let url: URL | null = null;
    try {
      url = api ? loungeUrl(api) : null;
    } catch {
      url = null;
    }
    this.url = url;
    this.state = { status: url ? 'connecting' : 'unavailable', messages: [], online: null };
    if (!url) return;
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

  /** Posts a line, already cleaned. False when not connected; otherwise it arrives as a message, or comes back through onReject. */
  say(name: string, text: string): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state.status !== 'live') return false;
    const c = (++this.seq).toString(36);
    this.pending.set(c, text);
    ws.send(JSON.stringify({ t: 'say', name, text, c } satisfies LoungeSay));
    return true;
  }

  /** Tries again now, after the chat said it was unavailable. */
  retry() {
    if (this.closed || this.socket || !this.url) return;
    this.set({ status: this.everLive ? 'reconnecting' : 'connecting' });
    this.connect();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
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
    if (this.closed || this.socket || !this.url) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.set({ status: 'unavailable' });
      return;
    }
    this.socket = ws;
    this.welcomed = false;
    ws.addEventListener('message', (e: MessageEvent) => this.receive(ws, e.data));
    ws.addEventListener('close', () => this.dropped(ws));
  };

  private receive(ws: WebSocket, data: unknown) {
    if (this.socket !== ws) return;
    this.heardAt = Date.now();
    const event = readEvent(data);
    if (!event) return;
    if (event.t === 'welcome') {
      this.welcomed = true;
      this.everLive = true;
      this.failures = 0;
      this.keepAlive(ws);
      this.set({ status: 'live', messages: addMessages([], event.messages, KEEP), online: event.online });
      return;
    }
    if (!this.welcomed) return;
    if (event.t === 'msg') {
      if (event.c) this.pending.delete(event.c);
      this.set({ messages: addMessages(this.state.messages, [event.m], KEEP) });
    } else if (event.t === 'online') {
      this.set({ online: event.n });
    } else if (event.t === 'cleared') {
      this.set({ messages: [] });
    } else if (event.t === 'error') {
      const text = (event.c && this.pending.get(event.c)) || '';
      if (event.c) this.pending.delete(event.c);
      this.emitReject({ text, error: event.error });
    }
  }

  /** The socket closed (or went quiet): hand back anything unanswered and try again after a pause. */
  private dropped(ws: WebSocket) {
    if (this.socket !== ws) return;
    this.socket = null;
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    for (const text of this.pending.values()) this.emitReject({ text, error: 'offline' });
    this.pending.clear();
    if (this.closed) return;
    if (!this.welcomed) this.failures++;
    this.set({ status: this.failures >= UNAVAILABLE_AFTER ? 'unavailable' : this.everLive ? 'reconnecting' : 'connecting' });
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
