import { DurableObject } from 'cloudflare:workers';
import {
  CHANNELS,
  DEFAULT_CHANNEL,
  FRAME_MAX,
  HISTORY,
  IP_RATE,
  LOUNGE_VERSION,
  ME_RATE,
  SOCKET_RATE,
  TYPING_RATE,
  isRepeat,
  lineHash,
  memberId,
  rateCheck,
  readFrame,
  readInvite,
  readPresence,
  samePresence,
  type ChannelId,
  type LoungeEvent,
  type LoungeMember,
  type LoungeMessage,
  type Presence,
  type RateRule,
  type Said,
  type SayError,
} from '../../src/os/arcade/lounge-core.ts';
import { ONLINE_SPECS } from './specs.gen';

export interface LoungeEnv {
  /** Lets `POST /lounge/clear` wipe the chat. Set with `npx wrangler secret put LOUNGE_ADMIN_TOKEN`; without it, clearing is off. */
  LOUNGE_ADMIN_TOKEN?: string;
}

/** Open chat sockets allowed per IP and in total, so a script can't fake a crowd or crowd everyone else out. */
const PER_IP = 20;
const MAX_SOCKETS = 1000;
/** Joins per IP, so reconnecting in a loop can't keep everyone's member list (and history downloads) churning. */
const JOIN_RATE: readonly RateRule[] = [{ limit: 40, windowMs: 60_000 }];
/** Frames one socket may send before it's closed. The site sends a few at most; pings are answered without reaching this object. */
const FRAME_RATE: readonly RateRule[] = [{ limit: 20, windowMs: 10_000 }];

/**
 * Kept on each socket, so it survives hibernation: its IP for the limits; when it last sent frames, messages, changes to
 * itself and typing notes; its last line; the protocol it speaks; and its member id with what it shows about itself.
 */
type Seat = Presence & {
  ip: string;
  sent: number[];
  frames: number[];
  me: number[];
  typed: number[];
  last?: { hash: number; at: number };
  v: number;
  id: string;
};

type Row = { id: number; ch: ChannelId; name: string; text: string; t: number; invite: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const newId = () => memberId(crypto.getRandomValues(new Uint8Array(8)));

const member = (seat: Seat): LoungeMember => ({
  id: seat.id,
  ...(seat.name && { name: seat.name }),
  ...(seat.game && { game: seat.game }),
  ...(seat.room && { room: seat.room }),
});

function toMessage(row: Row): LoungeMessage {
  let invite;
  try {
    invite = row.invite ? readInvite(JSON.parse(row.invite)) : undefined;
  } catch {
    invite = undefined;
  }
  return { id: row.id, ch: row.ch, name: row.name, text: row.text, t: row.t, ...(invite && { invite }) };
}

/** Presence from the socket URL: `?name=&game=&room=`. */
const presenceParams = (params: URLSearchParams): Presence =>
  readPresence({ name: params.get('name') ?? undefined, game: params.get('game') ?? undefined, room: params.get('room') ?? undefined });

/** A room only shows on a member when it's a game with online rooms. */
function known(presence: Presence): Presence {
  const { room, ...rest } = presence;
  return room && presence.game && Object.hasOwn(ONLINE_SPECS, presence.game) ? presence : rest;
}

/**
 * The Lounge, the arcade's global chat. Everyone with it open holds a hibernating WebSocket here (`GET /lounge`): they
 * get every channel's newest messages and who's here on connect, then every message, arrival, departure and change
 * after that. Each channel stores only its newest HISTORY messages, and no IPs.
 */
export class Lounge extends DurableObject<LoungeEnv> {
  /** Recent send and join times per IP. Lost when the object hibernates, which only happens once everyone has been quiet a while. */
  private readonly ips = new Map<string, number[]>();
  private readonly joins = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: LoungeEnv) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL, t INTEGER NOT NULL)');
      sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
      const schema = sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'schema'").toArray()[0]?.value ?? 1;
      if (schema < 2) {
        // Channels and shared rooms. Everything said before channels was in #general.
        sql.exec(`ALTER TABLE messages ADD COLUMN ch TEXT NOT NULL DEFAULT '${DEFAULT_CHANNEL}'`);
        sql.exec('ALTER TABLE messages ADD COLUMN invite TEXT');
        sql.exec('CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (ch, id)');
        sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', 2)");
      }
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket upgrade required' }, 400);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const seats = this.seats();
    const joins = rateCheck(this.joins.get(ip) ?? [], Date.now(), JOIN_RATE);
    if (!joins || seats.length >= MAX_SOCKETS || seats.filter((seat) => seat.ip === ip).length >= PER_IP) return json({ error: 'too many connections' }, 429);
    if (this.joins.size > 10_000) this.joins.clear();
    this.joins.set(ip, joins);

    const params = new URL(request.url).searchParams;
    const v = params.get('v') === String(LOUNGE_VERSION) ? LOUNGE_VERSION : 1;
    const presence = v === LOUNGE_VERSION ? known(presenceParams(params)) : {};
    const seat: Seat = { ip, sent: [], frames: [], me: [], typed: [], v, id: newId(), ...presence };
    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment(seat);
    this.ctx.acceptWebSocket(server);
    const online = seats.length + 1;
    if (v === LOUNGE_VERSION) this.send(server, { t: 'welcome', v, you: seat.id, messages: this.history(), members: [...seats, seat].map(member), online });
    else this.send(server, { t: 'welcome', messages: this.history(DEFAULT_CHANNEL), online });
    const join: LoungeEvent = { t: 'join', m: member(seat) };
    const count: LoungeEvent = { t: 'online', n: online };
    this.broadcast((other) => (other.v === LOUNGE_VERSION ? join : count), server);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return ws.close(1003, 'text only');
    if (message.length > FRAME_MAX) return ws.close(1009, 'too big');
    const seat = this.seat(ws);
    if (!seat) return;
    const now = Date.now();
    const frames = rateCheck(seat.frames, now, FRAME_RATE);
    if (!frames) return ws.close(1008, 'too many frames');
    seat.frames = frames;
    ws.serializeAttachment(seat);
    const frame = readFrame(message);
    if (frame?.t === 'say') this.say(ws, seat, frame.said, now);
    else if (frame?.t === 'me' && seat.v === LOUNGE_VERSION) this.me(ws, seat, frame.presence, now);
    else if (frame?.t === 'typing' && seat.v === LOUNGE_VERSION) this.typing(ws, seat, frame.ch, now);
  }

  async webSocketClose(ws: WebSocket) {
    this.left(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.left(ws);
  }

  /** Wipes one channel, or every message, and empties it on every open screen. Returns how many messages there were. */
  clear(ch?: ChannelId): number {
    const sql = this.ctx.storage.sql;
    const where = ch ? ' WHERE ch = ?' : '';
    const args = ch ? [ch] : [];
    const removed = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM messages${where}`, ...args).one().n;
    sql.exec(`DELETE FROM messages${where}`, ...args);
    const current: LoungeEvent = ch ? { t: 'cleared', ch } : { t: 'cleared' };
    const legacy: LoungeEvent | null = !ch || ch === DEFAULT_CHANNEL ? { t: 'cleared' } : null;
    this.broadcast((other) => (other.v === LOUNGE_VERSION ? current : legacy));
    return removed;
  }

  private say(ws: WebSocket, seat: Seat, said: Said | SayError, now: number) {
    if ('error' in said) return this.send(ws, { t: 'error', error: said.error, c: said.c });
    // A tab from before channels only sees #general, so that's the only place it can post.
    if (seat.v !== LOUNGE_VERSION && said.ch !== DEFAULT_CHANNEL) return this.send(ws, { t: 'error', error: 'channel', c: said.c });
    if (said.invite && !Object.hasOwn(ONLINE_SPECS, said.invite.game)) return this.send(ws, { t: 'error', error: 'invite', c: said.c });
    if (isRepeat(seat.last, said.text, now)) return this.send(ws, { t: 'error', error: 'repeat', c: said.c });
    const sent = rateCheck(seat.sent, now, SOCKET_RATE);
    const fromIp = rateCheck(this.ips.get(seat.ip) ?? [], now, IP_RATE);
    if (!sent || !fromIp) return this.send(ws, { t: 'error', error: 'slow', c: said.c });
    if (this.ips.size > 10_000) this.ips.clear();
    this.ips.set(seat.ip, fromIp);
    ws.serializeAttachment({ ...seat, sent, last: { hash: lineHash(said.text), at: now } } satisfies Seat);

    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<Row>(
        'INSERT INTO messages (ch, name, text, t, invite) VALUES (?, ?, ?, ?, ?) RETURNING id, ch, name, text, t, invite',
        said.ch,
        said.name,
        said.text,
        now,
        said.invite ? JSON.stringify(said.invite) : null,
      )
      .one();
    sql.exec('DELETE FROM messages WHERE ch = ? AND id <= (SELECT id FROM messages WHERE ch = ? ORDER BY id DESC LIMIT 1 OFFSET ?)', said.ch, said.ch, HISTORY);
    const m = toMessage(row);
    const current: LoungeEvent = { t: 'msg', m, by: seat.id };
    const legacy: LoungeEvent | null = m.ch === DEFAULT_CHANNEL ? { t: 'msg', m } : null;
    this.broadcast((other) => (other.v === LOUNGE_VERSION ? current : legacy), ws);
    this.send(ws, seat.v === LOUNGE_VERSION ? { ...current, c: said.c } : { t: 'msg', m, c: said.c });
  }

  /** Someone picked a name, or started or stopped playing something. */
  private me(ws: WebSocket, seat: Seat, presence: Presence, now: number) {
    const next = known(presence);
    if (samePresence(seat, next)) return;
    const me = rateCheck(seat.me, now, ME_RATE);
    if (!me) return;
    const updated: Seat = { ...seat, me, name: next.name, game: next.game, room: next.room };
    ws.serializeAttachment(updated);
    const event: LoungeEvent = { t: 'member', m: member(updated) };
    this.broadcast((other) => (other.v === LOUNGE_VERSION ? event : null));
  }

  private typing(ws: WebSocket, seat: Seat, ch: ChannelId, now: number) {
    // Only someone with a name can post, so only they show as typing.
    if (!seat.name) return;
    const typed = rateCheck(seat.typed, now, TYPING_RATE);
    if (!typed) return;
    ws.serializeAttachment({ ...seat, typed } satisfies Seat);
    const event: LoungeEvent = { t: 'typing', ch, id: seat.id };
    this.broadcast((other) => (other.v === LOUNGE_VERSION ? event : null), ws);
  }

  private left(ws: WebSocket) {
    const seat = this.seat(ws);
    const leave: LoungeEvent | null = seat ? { t: 'leave', id: seat.id } : null;
    const count: LoungeEvent = { t: 'online', n: this.seats(ws).length };
    this.broadcast((other) => (other.v === LOUNGE_VERSION ? leave : count), ws);
  }

  private history(only?: ChannelId): LoungeMessage[] {
    const sql = this.ctx.storage.sql;
    const rows = (only ? [only] : CHANNELS.map((channel) => channel.id)).flatMap((ch) =>
      sql.exec<Row>('SELECT id, ch, name, text, t, invite FROM messages WHERE ch = ? ORDER BY id DESC LIMIT ?', ch, HISTORY).toArray(),
    );
    return rows.sort((a, b) => a.id - b.id).map(toMessage);
  }

  /** A socket's seat, filled in for one opened before seats said which protocol they speak. */
  private seat(ws: WebSocket): Seat | null {
    const raw = ws.deserializeAttachment() as Partial<Seat> | null;
    if (!raw?.ip) return null;
    if (raw.id && raw.v && raw.me && raw.typed) return raw as Seat;
    const seat: Seat = { sent: [], frames: [], me: [], typed: [], v: 1, ...raw, ip: raw.ip, id: raw.id ?? newId() };
    ws.serializeAttachment(seat);
    return seat;
  }

  private seats(except?: WebSocket): Seat[] {
    return this.ctx.getWebSockets()
      .filter((socket) => socket !== except && socket.readyState === WebSocket.OPEN)
      .map((socket) => this.seat(socket))
      .filter((seat): seat is Seat => !!seat);
  }

  private send(ws: WebSocket, event: LoungeEvent) {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      ws.close(1011, 'send failed');
    }
  }

  /** Sends each open socket what `pick` says suits it (by the protocol it speaks), or nothing. Each event is encoded once. */
  private broadcast(pick: (seat: Seat) => LoungeEvent | null, except?: WebSocket) {
    const encoded = new Map<LoungeEvent, string>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      const seat = this.seat(socket);
      const event = seat && pick(seat);
      if (!event) continue;
      let data = encoded.get(event);
      if (data === undefined) {
        data = JSON.stringify(event);
        encoded.set(event, data);
      }
      try {
        socket.send(data);
      } catch {
        socket.close(1011, 'send failed');
      }
    }
  }
}
