import { ARCADE_API } from './leaderboard.ts';
import { channelUsable, fastSendBlocked, parseOpenRooms, relayPlan, sendLabels, type OpenRoom } from './online-core.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/**
 * The room protocol this client speaks: 2 follows a host hand-off when the host leaves (see the 'host' event), 3 knows
 * spectators and is told on the socket why a room turned it away (see the 'closed' event), 4 comes back to its own
 * seat when its connection drops (see reconnect).
 */
export const ROOM_PROTOCOL = 4;
/** How often the link checks on its socket, and pings the room when it has heard nothing for a while. */
const WATCH_MS = 1_000;
const PING_MS = 5_000;
/** A ping unanswered this long (and nothing else heard since) means the connection is dead, though the socket says open. */
const DEAD_MS = 5_000;
/** How long a dropped link keeps trying to get its seat back: a little under the room's hold on it (HOLD_MS, 20 s). */
const RESUME_MS = 18_000;
const RETRY_MS = [250, 600, 1200, 2000, 3000, 4000];
/** The most messages kept to send once a dropped link is back in. */
const HELD_MAX = 256;
/** A spectator gets the host's fast messages (snapshots that the next one replaces) at most this often, each kind. */
const WATCH_FAST_MS = 66;
const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];

export type RoomPlayer = { seat: number; name: string };
export type RoomTransport = 'direct' | 'relay';
type Peer = { pc: RTCPeerConnection; channels: Map<'r' | 'u', RTCDataChannel>; candidates: RTCIceCandidateInit[] };

type RoomEvents = {
  /**
   * started: a round is already under way (rooms that allow joining between rounds). round: the room's latest round.
   * bots: seats bots would take if the host started now, or null when the room has no bots (see the bots event).
   * quick: a quick-play room; startIn: while it gathers people, milliseconds until it starts on its own, else null.
   * watching: in as a spectator (seat -1), and roundBots then the seats bots play the round under way. watchable:
   * people can watch the room.
   */
  welcome: { seat: number; code: string; game: string; seats: number; players: RoomPlayer[]; started: boolean; round: number; bots: number[] | null; quick: boolean; startIn: number | null; watching: boolean; roundBots: number[]; watchable: boolean };
  players: RoomPlayer[];
  /** Whether a round is under way, when the room says it changed: a round ends, or one stops for want of players. */
  started: boolean;
  /** Who is watching (by name), and whether the host lets people watch; only rooms for games people can watch send them. */
  watchers: { names: string[]; on: boolean };
  /**
   * The host left and the person in seat `from` took over as host (seat 0; `seat` is this player's own seat now, -1
   * for a spectator).
   * Any round under way is over, since the host's game was running it.
   */
  /** started: the round under way goes on past the hand-off (a game that takes rounds over, see OnlineSpec migrate). */
  host: { from: number; seat: number; players: RoomPlayer[]; started: boolean };
  /** Seats bots would take if the host started now; only rooms for games that allow bots send them. */
  bots: number[];
  /** Whether the room is public (listed in the arcade's Open Rooms); servers from before public rooms never say. */
  listed: boolean;
  /** A quick-play room gathering people: milliseconds until it starts on its own, each time the room says. Null once it no longer gathers. */
  gather: number | null;
  /** round: the room's shared round number, or null from a server that does not send one. bots: the seats bots play this round. */
  start: { players: RoomPlayer[]; round: number | null; bots: number[] };
  msg: { from: number; d: unknown };
  /**
   * The room is gone for this player, or turned them away: reason says why (host-left, connection-lost, room-closed,
   * not-found, started, full, no-watching), and watch whether they could watch it instead.
   */
  closed: { reason: string; watch: boolean };
  transport: RoomTransport;
  /** The connection dropped and the link is getting its seat back ('reconnecting'), or is through to the room ('ok'). */
  link: LinkState;
};
export type LinkState = 'ok' | 'reconnecting';

type Listener<T> = (value: T) => void;

export function makeRoomCode(bytes: ArrayLike<number>): string {
  if (bytes.length < 4) throw new RangeError('four random bytes are required');
  return Array.from({ length: 4 }, (_, i) => ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length]).join('');
}

/** A new room's code. A public room shows up in the arcade's Open Rooms for anyone to join. */
export async function createRoom(game: string, { listed = false }: { listed?: boolean } = {}, api = ARCADE_API): Promise<string> {
  if (!api) throw new Error('Online Play Is Unavailable');
  const response = await fetch(`${api.replace(/\/+$/, '')}/rooms?game=${encodeURIComponent(game)}${listed ? '&public=1' : ''}`, { method: 'POST' });
  if (!response.ok) throw new Error('Could Not Create A Room');
  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== 'string' || !/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(body.code)) throw new Error('Invalid Room Code');
  return body.code;
}

/**
 * Quick play: the code of a room of this game (in `pool`, if given: a game's mode, say, kept apart from its others)
 * that is gathering people for a match that starts on its own, a new one when there is none. Throws when the Worker
 * can't find one (or is from before quick play).
 */
export async function quickRoom(game: string, api = ARCADE_API, pool?: string): Promise<string> {
  if (!api) throw new Error('Online Play Is Unavailable');
  const response = await fetch(`${api.replace(/\/+$/, '')}/rooms/quick?game=${encodeURIComponent(game)}${pool ? `&pool=${encodeURIComponent(pool)}` : ''}`, { method: 'POST' });
  if (!response.ok) throw new Error('Could Not Find A Match');
  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== 'string' || !/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(body.code)) throw new Error('Invalid Room Code');
  return body.code;
}

/** Public rooms someone can join now, for one game or every game. Throws when Open Rooms can't be reached. */
export async function listRooms(game?: string, api = ARCADE_API): Promise<OpenRoom[]> {
  if (!api) throw new Error('Online Play Is Unavailable');
  const response = await fetch(`${api.replace(/\/+$/, '')}/rooms${game ? `?game=${encodeURIComponent(game)}` : ''}`);
  if (!response.ok) throw new Error('Open Rooms Are Unavailable');
  return parseOpenRooms(await response.json());
}

export class RoomLink {
  readonly code: string;
  readonly name: string;
  seat: number | null = null;
  game = '';
  seats = 0;
  players: RoomPlayer[] = [];
  /** Seats bots would take if the host started now, or null when the room has no bots. */
  bots: number[] | null = null;
  /** Whether the room is public, or null from a server that does not say. */
  listed: boolean | null = null;
  /** A quick-play room, which starts on its own, and the quick-play pool it gathered for ('' for none). */
  quick = false;
  pool = '';
  /** In as a spectator: no seat, and nothing is sent. */
  readonly watching: boolean;
  /** Spectators by name, and whether the host lets people watch (null: a game nobody can watch, or an older server). */
  watchers: string[] = [];
  watchable: boolean | null = null;
  private readonly watchSent = new Map<string, number>();
  private socket: WebSocket;
  private readonly api: string;
  /** The seat's key from a room that lets people come back to their seat (protocol 4), and that relays to several seats at once. */
  private key: string | null = null;
  private multi = false;
  /** The room's round as this link last heard it. */
  private round = 0;
  private linkValue: LinkState = 'ok';
  /** When anything last came in, and when the last ping went out (Date.now()). */
  private heardAt = 0;
  private pingAt = 0;
  private resumeFrom = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private tries = 0;
  /** What waits to go to the room once the link is back in (see sendSocket). */
  private held: string[] = [];
  private readonly listeners = new Map<keyof RoomEvents, Set<Listener<never>>>();
  private readonly peers = new Map<number, Peer>();
  private readonly retryCounts = new Map<number, number>();
  private readonly retryTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private transportValue: RoomTransport = 'relay';
  private closed = false;

  constructor(code: string, name: string, api = ARCADE_API, { watch = false }: { watch?: boolean } = {}) {
    if (!api) throw new Error('Online Play Is Unavailable');
    this.code = code.toUpperCase();
    this.name = name;
    this.watching = watch;
    this.api = api;
    this.socket = this.connect();
    globalThis.addEventListener?.('pagehide', this.onPageHide);
  }

  /**
   * The page is going away for good (closed, reloaded, navigated off): a goodbye, so the room doesn't hold the seat for
   * us. One kept to come back to (the back-forward cache) gets its seat back like any dropped connection.
   */
  private readonly onPageHide = (event: Event) => {
    if (!(event as Event & { persisted?: boolean }).persisted) this.close();
  };

  get transport(): RoomTransport {
    return this.transportValue;
  }

  /** Whether the link is through to the room, or getting its seat back after its connection dropped. */
  get link(): LinkState {
    return this.linkValue;
  }

  /** A socket to the room: as a newcomer, or (`resume`) back to this link's own seat with its key. */
  private connect(resume = false): WebSocket {
    const base = new URL(this.api);
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/rooms/${encodeURIComponent(this.code)}/ws`;
    const query: Record<string, string> = { name: this.name, v: String(ROOM_PROTOCOL), ...(this.watching ? { watch: '1' } : {}) };
    if (resume && this.key && this.seat !== null) Object.assign(query, { seat: String(this.seat), key: this.key });
    base.search = new URLSearchParams(query).toString();
    const socket = new WebSocket(base);
    // (a socket this link has moved on from says nothing more)
    const mine = <E,>(handler: (event: E) => void) => (event: E) => {
      if (socket === this.socket) handler(event);
    };
    socket.addEventListener('open', mine(this.onOpen));
    socket.addEventListener('message', mine(this.onSocketMessage));
    socket.addEventListener('close', mine(this.onSocketClose));
    socket.addEventListener('error', mine(this.onSocketError));
    return socket;
  }

  on<K extends keyof RoomEvents>(event: K, listener: Listener<RoomEvents[K]>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as Listener<never>);
    return () => listeners?.delete(listener as Listener<never>);
  }

  start() {
    this.sendSocket({ t: 'start' });
  }

  /** Host only: how many bots should fill the empty seats. */
  setBots(n: number) {
    this.sendSocket({ t: 'bots', n });
  }

  /** Host only: list the room in the arcade's Open Rooms, or take it off. */
  setListed(on: boolean) {
    this.sendSocket({ t: 'listed', on });
  }

  /** Host only: let people watch the room's rounds, or send everyone watching away. */
  setWatchable(on: boolean) {
    this.sendSocket({ t: 'watchable', on });
  }

  /** Who won the round: a seat (and, for a winning team, every seat on it), or null for nobody. */
  reportResult(round: number, winner: number | null, team?: number[]) {
    this.sendSocket(team && winner !== null ? { t: 'result', round, winner, team } : { t: 'result', round, winner });
  }

  /** Host only: the round is over, so the room takes people again (and a public one goes back on Open Rooms). */
  endRound(round: number) {
    this.sendSocket({ t: 'over', round });
  }

  /**
   * To the host (from a guest) or to everyone (from the host), or `to` one seat. `everyone`, from a guest: what all the
   * others should see as soon as they can (its own state in a race, say). Over a direct link it goes to the host, who
   * passes it on as ever; through the room it goes to everyone at once, rather than to the host and back out again
   * (two more trips through the room, on top of the host's own connection). Either way the host gets it too.
   */
  send(d: unknown, options: { to?: number; fast?: boolean; reliable?: boolean; everyone?: boolean } = {}) {
    const labels = sendLabels(options.fast, options.reliable);
    const primary = labels[0]!;
    const payload = JSON.stringify(d);
    const recipients = this.seat === 0
      ? options.to === undefined ? this.players.map(({ seat }) => seat).filter((seat) => seat !== 0) : [options.to]
      : this.seat === null ? [] : [0];
    const channels = new Map<number, Map<'r' | 'u', RTCDataChannel>>();
    const plan = relayPlan(recipients, (seat) => {
      const peer = this.peers.get(seat);
      if (!peer || !channelUsable(peer.channels.get(primary)?.readyState ?? 'closed', peer.pc.connectionState)) return false;
      const usable = new Map<'r' | 'u', RTCDataChannel>();
      for (const label of labels) {
        const channel = peer.channels.get(label);
        if (channel && channelUsable(channel.readyState, peer.pc.connectionState)) usable.set(label, channel);
      }
      channels.set(seat, usable);
      return true;
    }, this.seat === 0 && options.to === undefined);
    for (const seat of plan.direct) {
      for (const label of labels) {
        const channel = channels.get(seat)?.get(label);
        if (!channel || label === 'u' && fastSendBlocked(channel.bufferedAmount)) continue;
        channel.send(payload);
      }
    }
    // (a fast message says so: the next one replaces it, so the room never keeps it for someone away for a moment)
    const fast = options.fast && !options.reliable ? { f: 1 } : {};
    if (plan.relayAll || (options.everyone && this.seat !== 0 && options.to === undefined && plan.relay.length)) this.sendSocket({ t: 'msg', d, ...fast });
    // (several seats the room relays to: one message for all of them, where the room takes a list)
    else if (this.multi && this.seat === 0 && plan.relay.length > 1) this.sendSocket({ t: 'msg', to: plan.relay, d, ...fast });
    else for (const seat of plan.relay) this.sendSocket({ t: 'msg', to: this.seat === 0 ? seat : 0, d, ...fast });
    if (!recipients.length && options.to !== undefined) this.sendSocket({ t: 'msg', to: options.to, d, ...fast });
    if (plan.relay.length || (!recipients.length && options.to !== undefined)) this.setTransport('relay');
    // What the host's game says to everyone, spectators see too, through the room (fast snapshots a few times a second).
    if (this.seat === 0 && options.to === undefined && this.watchers.length) {
      const inner = d && typeof d === 'object' ? ((d as { d?: unknown }).d ?? d) : d;
      const kind = inner && typeof inner === 'object' ? String((inner as { t?: unknown; k?: unknown; type?: unknown }).t ?? (inner as { k?: unknown }).k ?? (inner as { type?: unknown }).type ?? '') : '';
      const now = globalThis.performance?.now() ?? Date.now();
      if (options.fast && now - (this.watchSent.get(kind) ?? -Infinity) < WATCH_FAST_MS) return;
      if (options.fast) this.watchSent.set(kind, now);
      this.sendSocket({ t: 'watch', d });
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    if (this.pingTimer !== null) globalThis.clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.resumeTimer !== null) globalThis.clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    const socket = this.socket;
    // (whatever it says from here on is for nobody)
    this.socket = { readyState: 3 } as WebSocket;
    try {
      // a goodbye: the room lets the seat go now rather than holding it for us to come back to
      socket.close(1000, 'leave');
    } catch {
      /* never opened */
    }
    for (const timer of this.retryTimers.values()) globalThis.clearTimeout(timer);
    this.retryTimers.clear();
    this.dropPeers();
  }

  private readonly onOpen = () => {
    this.heardAt = Date.now();
    this.pingAt = 0;
    if (this.pingTimer === null) {
      this.pingTimer = globalThis.setInterval(this.check, WATCH_MS);
      // (a watch never keeps a process alive on its own, where timers can say so)
      (this.pingTimer as { unref?: () => void }).unref?.();
    }
  };

  /**
   * Every few seconds: a ping when the room has been quiet (answered by the room without waking it), and a connection
   * that stopped answering is treated as dropped, though the browser may take minutes to say so.
   */
  private readonly check = () => {
    if (this.closed || this.linkValue !== 'ok' || this.socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    // a ping still unanswered: the connection is dead once it has been too long
    if (this.pingAt > this.heardAt) {
      if (now - this.pingAt >= DEAD_MS) this.drop();
      return;
    }
    if (now - this.heardAt >= PING_MS) {
      this.pingAt = now;
      try {
        this.socket.send('ping');
      } catch {
        this.drop();
      }
    }
  };

  /** The connection is gone: get the seat back when the room lets us, else say so. */
  private drop() {
    if (this.closed) return;
    const socket = this.socket;
    this.socket = { readyState: 3 } as WebSocket;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    if (!this.key || this.seat === null || this.watching) {
      this.stopWatch();
      this.emit('closed', { reason: 'connection-lost', watch: false });
      return;
    }
    this.resumeFrom = Date.now();
    this.tries = 0;
    this.setLink('reconnecting');
    this.setTransport('relay');
    this.retry();
  }

  /** The next try at getting the seat back, or giving up once the room will have let it go. */
  private retry() {
    if (this.closed) return;
    const wait = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)];
    if (Date.now() + wait - this.resumeFrom > RESUME_MS) {
      this.held = [];
      this.stopWatch();
      this.setLink('ok');
      this.emit('closed', { reason: 'connection-lost', watch: false });
      return;
    }
    this.tries++;
    this.resumeTimer = globalThis.setTimeout(() => {
      this.resumeTimer = null;
      if (!this.closed) this.socket = this.connect(true);
    }, wait);
  }

  private stopWatch() {
    if (this.pingTimer !== null) globalThis.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setLink(value: LinkState) {
    if (this.linkValue === value) return;
    this.linkValue = value;
    this.emit('link', value);
  }

  private readonly onSocketMessage = (event: MessageEvent<string>) => {
    this.heardAt = Date.now();
    if (typeof event.data !== 'string') return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.t === 'welcome' && message.resumed === true && this.linkValue === 'reconnecting' && message.seat === this.seat) {
      // back in our own seat: the room carries on as if we never left, and what we said meanwhile goes now
      this.setLink('ok');
      for (const data of this.held.splice(0)) this.socket.send(data);
      this.players = this.asPlayers(message.players);
      // a direct link that went down with the connection is set up afresh by the host (see 'back'); one still up stays
      for (const [seat, peer] of this.peers) if (peer.pc.connectionState !== 'connected') this.dropPeer(seat);
      this.emit('players', this.players);
      if (Array.isArray(message.bots)) {
        this.bots = this.asSeats(message.bots);
        this.emit('bots', this.bots);
      }
      this.takeListed(message.listed);
      this.takeWatchers(message);
      if (typeof message.started === 'boolean') this.emit('started', message.started);
      if (Number.isSafeInteger(message.round)) this.round = message.round as number;
    } else if (message.t === 'welcome' && Number.isInteger(message.seat) && typeof message.game === 'string' && Number.isInteger(message.seats)) {
      // a spectator has no seat: it sends nothing, and the host never links to it
      const watching = this.watching && message.watch === true;
      this.seat = watching ? null : message.seat as number;
      this.game = message.game;
      this.seats = message.seats as number;
      this.players = this.asPlayers(message.players);
      this.bots = Array.isArray(message.bots) ? this.asSeats(message.bots) : null;
      const round = Number.isSafeInteger(message.round) && (message.round as number) > 0 ? message.round as number : 0;
      this.round = round;
      this.key = !watching && typeof message.key === 'string' && /^[0-9a-f]{32}$/.test(message.key) ? message.key : null;
      this.multi = message.multi === true;
      this.quick = message.quick === true;
      this.pool = this.quick && typeof message.pool === 'string' && /^[a-z0-9-]{1,16}$/.test(message.pool) ? message.pool : '';
      const startIn = this.startIn(message);
      const roundBots = watching && Array.isArray(message.roundBots) ? this.asSeats(message.roundBots) : [];
      this.emit('welcome', { seat: watching ? -1 : this.seat!, code: this.code, game: this.game, seats: this.seats, players: this.players, started: message.started === true, round, bots: this.bots, quick: this.quick, startIn, watching, roundBots, watchable: message.watchable === true });
      this.emit('players', this.players);
      if (this.bots) this.emit('bots', this.bots);
      this.takeListed(message.listed);
      this.takeWatchers(message);
      if (this.quick) this.emit('gather', startIn);
    } else if (message.t === 'players' || (message.t === 'host' && Number.isInteger(message.from))) {
      this.players = this.asPlayers(message.players);
      if (message.t === 'host') {
        const from = message.from as number;
        if (this.seat === from) this.seat = 0;
        // Every direct link ran through the old host; the next round connects everyone to the new one.
        this.dropPeers();
        if (this.seat !== null || this.watching) this.emit('host', { from, seat: this.seat ?? -1, players: this.players, started: message.started === true });
      } else this.dropPeers(this.players);
      this.emit('players', this.players);
      if (Array.isArray(message.bots)) {
        this.bots = this.asSeats(message.bots);
        this.emit('bots', this.bots);
      }
      this.takeListed(message.listed);
      this.takeWatchers(message);
      if (this.quick) this.emit('gather', this.startIn(message));
      if (typeof message.started === 'boolean') this.emit('started', message.started);
      this.updateTransport();
    } else if (message.t === 'back' && Number.isInteger(message.seat)) {
      // someone came back after their connection dropped: the host links up with them directly again
      const seat = message.seat as number;
      if (this.seat === 0 && seat !== 0 && this.peers.get(seat)?.pc.connectionState !== 'connected') {
        this.dropPeer(seat);
        if (typeof RTCPeerConnection !== 'undefined') void this.offerTo(seat);
      }
    } else if (message.t === 'start') {
      this.players = this.asPlayers(message.players);
      if (Number.isSafeInteger(message.round)) this.round = message.round as number;
      const bots = this.asSeats(message.bots);
      this.emit('start', { players: this.players, round: Number.isSafeInteger(message.round) && (message.round as number) > 0 ? message.round as number : null, bots });
      void this.beginPeers();
    } else if (message.t === 'msg' && Number.isInteger(message.from)) {
      this.emit('msg', { from: message.from as number, d: message.d });
    } else if (message.t === 'signal' && Number.isInteger(message.from)) {
      void this.receiveSignal(message.from as number, message.d);
    } else if (message.t === 'closed' && typeof message.reason === 'string') {
      // (the room let our seat go before we got back to it: to us, the connection was lost)
      const reason = message.reason === 'expired' ? 'connection-lost' : message.reason;
      this.held = [];
      this.setLink('ok');
      this.emit('closed', { reason, watch: message.watch === true });
      // said once: the socket closing after it is the same news
      this.close();
    }
  };

  private readonly onSocketClose = () => {
    if (this.closed) return;
    // a try at getting the seat back that didn't get through: the next one
    if (this.linkValue === 'reconnecting') this.retry();
    else this.drop();
  };

  private readonly onSocketError = () => {
    if (!this.closed) this.setTransport('relay');
  };

  /** The host connects directly to everyone it has no link with yet: the first round, newcomers, a new host's guests. */
  private async beginPeers() {
    if (typeof RTCPeerConnection === 'undefined' || this.seat === null) {
      this.setTransport('relay');
      return;
    }
    if (this.seat === 0) {
      this.retryCounts.clear();
      for (const timer of this.retryTimers.values()) globalThis.clearTimeout(timer);
      this.retryTimers.clear();
      for (const player of this.players) {
        if (player.seat === 0) continue;
        const peer = this.peers.get(player.seat);
        // A link that failed gets a fresh try each round; one that's up or still connecting is left alone.
        if (peer && (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'closed')) {
          peer.pc.close();
          this.peers.delete(player.seat);
          this.clearPeerRetry(player.seat);
        } else if (peer) continue;
        await this.offerTo(player.seat);
      }
    }
  }

  private dropPeer(seat: number) {
    const peer = this.peers.get(seat);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(seat);
    this.clearPeerRetry(seat);
    this.retryCounts.delete(seat);
  }

  /** Closes the direct links: all of them, or those to anyone no longer among `keep` (a newcomer may take their seat). */
  private dropPeers(keep?: RoomPlayer[]) {
    for (const [seat, peer] of this.peers) {
      if (keep?.some((player) => player.seat === seat)) continue;
      peer.pc.close();
      this.peers.delete(seat);
      this.clearPeerRetry(seat);
      this.retryCounts.delete(seat);
    }
  }

  private clearPeerRetry(seat: number) {
    const timer = this.retryTimers.get(seat);
    if (timer !== undefined) globalThis.clearTimeout(timer);
    this.retryTimers.delete(seat);
  }

  private retryPeer(seat: number, peer: Peer) {
    if (this.closed || this.retryTimers.has(seat) || (this.retryCounts.get(seat) ?? 0) >= 3) return;
    const timer = globalThis.setTimeout(() => {
      this.retryTimers.delete(seat);
      if (this.closed || this.peers.get(seat) !== peer || !this.players.some((player) => player.seat === seat)) return;
      this.retryCounts.set(seat, (this.retryCounts.get(seat) ?? 0) + 1);
      peer.pc.close();
      this.peers.delete(seat);
      void this.offerTo(seat);
    }, 1000);
    this.retryTimers.set(seat, timer);
  }

  private resetPeerRetries(seat: number) {
    this.retryCounts.delete(seat);
    this.clearPeerRetry(seat);
  }

  private async offerTo(seat: number) {
    const peer = this.createPeer(seat);
    if (!peer) return;
    peer.channels.set('r', peer.pc.createDataChannel('r', { ordered: true }));
    peer.channels.set('u', peer.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
    this.bindChannels(seat, peer);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal(seat, peer.pc.localDescription);
    } catch {
      this.setTransport('relay');
    }
  }

  private async receiveSignal(from: number, value: unknown) {
    if (!value || typeof value !== 'object') return;
    const signal = value as Record<string, unknown>;
    // A new offer for a link that's already set up means the host started over (a new host, or a retry): so do we.
    const stale = this.peers.get(from);
    if (signal.type === 'offer' && stale?.pc.remoteDescription) {
      stale.pc.close();
      this.peers.delete(from);
      this.clearPeerRetry(from);
    }
    const peer = this.createPeer(from);
    if (!peer) return;
    try {
      if (typeof signal.candidate === 'string') {
        const candidate = signal as unknown as RTCIceCandidateInit;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
        else peer.candidates.push(candidate);
        return;
      }
      if (typeof signal.type !== 'string' || !['offer', 'answer', 'pranswer', 'rollback'].includes(signal.type)) return;
      await peer.pc.setRemoteDescription(signal as unknown as RTCSessionDescriptionInit);
      for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
      if (signal.type === 'offer') {
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal(from, peer.pc.localDescription);
      }
    } catch {
      this.setTransport('relay');
    }
  }

  private createPeer(seat: number): Peer | null {
    const existing = this.peers.get(seat);
    if (existing) return existing;
    if (typeof RTCPeerConnection === 'undefined') return null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, channels: new Map(), candidates: [] };
    this.peers.set(seat, peer);
    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(seat, event.candidate.toJSON());
    };
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label !== 'r' && channel.label !== 'u') return channel.close();
      peer.channels.set(channel.label, channel);
      this.bindChannels(seat, peer);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(seat) !== peer) return;
      if (pc.connectionState === 'connected') {
        this.updateTransport();
        if (this.seat === 0) this.resetPeerRetries(seat);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        this.setTransport('relay');
        if (pc.connectionState === 'failed' && this.seat === 0) this.retryPeer(seat, peer);
      }
    };
    return peer;
  }

  private bindChannels(seat: number, peer: Peer) {
    for (const channel of peer.channels.values()) {
      channel.onopen = () => this.updateTransport();
      channel.onclose = () => this.setTransport('relay');
      channel.onmessage = (event) => {
        try {
          this.emit('msg', { from: seat, d: JSON.parse(String(event.data)) });
        } catch {
          return;
        }
      };
    }
  }

  private sendSignal(seat: number, d: unknown) {
    if (d) this.sendSocket({ t: 'signal', to: seat, d });
  }

  /**
   * To the room. While the link is getting its seat back, what can't be replaced by the next message waits (a move, a
   * result) and goes once it is back in; fast messages, signals for links that are gone, and spectators' words don't.
   */
  private sendSocket(message: { t: string; f?: number; [key: string]: unknown }) {
    if (this.watching) return;
    if (this.linkValue === 'reconnecting') {
      if (message.t !== 'signal' && message.t !== 'watch' && !message.f && this.held.length < HELD_MAX) this.held.push(JSON.stringify(message));
      return;
    }
    if (this.socket.readyState !== WebSocket.OPEN) return;
    // (a connection that can't keep up: a snapshot the next one replaces would only queue up behind the rest)
    if (message.f && fastSendBlocked(this.socket.bufferedAmount ?? 0)) return;
    this.socket.send(JSON.stringify(message));
  }

  private updateTransport() {
    const peers = this.seat === 0
      ? this.players.filter(({ seat }) => seat !== 0)
      : this.seat === null ? [] : this.players.filter(({ seat }) => seat === 0);
    const direct = peers.length > 0 && peers.every((player) =>
      (['r', 'u'] as const).every((label) => {
        const peer = this.peers.get(player.seat);
        return !!peer && channelUsable(peer.channels.get(label)?.readyState ?? 'closed', peer.pc.connectionState);
      }),
    );
    this.setTransport(direct ? 'direct' : 'relay');
  }

  private setTransport(value: RoomTransport) {
    if (this.transportValue === value) return;
    this.transportValue = value;
    this.emit('transport', value);
  }

  private asPlayers(value: unknown): RoomPlayer[] {
    if (!Array.isArray(value)) return [];
    return value.filter((player): player is RoomPlayer =>
      !!player && typeof player === 'object' && Number.isInteger((player as RoomPlayer).seat) && typeof (player as RoomPlayer).name === 'string',
    ).map(({ seat, name }) => ({ seat, name }));
  }

  /** A gathering quick-play room's time to its start, in milliseconds (a minute at most), or null. */
  private startIn(message: Record<string, unknown>): number | null {
    const ms = message.startIn;
    return this.quick && typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.min(60_000, ms)) : null;
  }

  private takeWatchers(message: Record<string, unknown>) {
    if (!Array.isArray(message.watchers) || typeof message.watchable !== 'boolean') return;
    const names = message.watchers.filter((name): name is string => typeof name === 'string').slice(0, 32).map((name) => name.slice(0, 32));
    if (names.join('\n') === this.watchers.join('\n') && message.watchable === this.watchable) return;
    this.watchers = names;
    this.watchable = message.watchable;
    this.emit('watchers', { names, on: message.watchable });
  }

  private takeListed(value: unknown) {
    if (typeof value !== 'boolean' || value === this.listed) return;
    this.listed = value;
    this.emit('listed', value);
  }

  /** Bot seats from the server: whole numbers inside the room, each once, in order. */
  private asSeats(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const seats = value.filter((seat): seat is number => Number.isInteger(seat) && seat >= 0 && seat < Math.max(this.seats, 1) && !this.players.some((player) => player.seat === seat));
    return [...new Set(seats)].sort((a, b) => a - b);
  }

  private emit<K extends keyof RoomEvents>(event: K, value: RoomEvents[K]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as Listener<RoomEvents[K]>)(value);
  }
}
