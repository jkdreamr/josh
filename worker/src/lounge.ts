import { DurableObject } from 'cloudflare:workers';
import {
  FRAME_MAX,
  HISTORY,
  IP_RATE,
  SOCKET_RATE,
  isRepeat,
  lineHash,
  rateCheck,
  readSay,
  type LoungeEvent,
  type LoungeMessage,
  type RateRule,
} from '../../src/os/arcade/lounge-core.ts';

export interface LoungeEnv {
  /** Lets `POST /lounge/clear` wipe the chat. Set with `npx wrangler secret put LOUNGE_ADMIN_TOKEN`; without it, clearing is off. */
  LOUNGE_ADMIN_TOKEN?: string;
}

/** Open chat sockets allowed per IP and in total, so a script can't fake a crowd or crowd everyone else out. */
const PER_IP = 20;
const MAX_SOCKETS = 1000;
/** Joins per IP, so reconnecting in a loop can't keep everyone's count (and history downloads) churning. */
const JOIN_RATE: readonly RateRule[] = [{ limit: 40, windowMs: 60_000 }];
/** Frames one socket may send before it's closed. The site sends a few at most; pings are answered without reaching this object. */
const FRAME_RATE: readonly RateRule[] = [{ limit: 20, windowMs: 10_000 }];

/** Kept on each socket, so it survives hibernation: its IP for the limits, when it last sent frames and messages, and its last line. */
type Seat = { ip: string; sent: number[]; frames: number[]; last?: { hash: number; at: number } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * The arcade's global chat. Everyone with it open holds a hibernating WebSocket here (`GET /lounge`): they get the
 * newest messages and how many people are here on connect, then every message after that. Only the newest HISTORY
 * messages are stored, and no IPs.
 */
export class Lounge extends DurableObject<LoungeEnv> {
  /** Recent send and join times per IP. Lost when the object hibernates, which only happens once everyone has been quiet a while. */
  private readonly ips = new Map<string, number[]>();
  private readonly joins = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: LoungeEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL, t INTEGER NOT NULL)');
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
    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment({ ip, sent: [], frames: [] } satisfies Seat);
    this.ctx.acceptWebSocket(server);
    const online = seats.length + 1;
    this.send(server, { t: 'welcome', messages: this.history(), online });
    this.broadcast({ t: 'online', n: online }, server);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return ws.close(1003, 'text only');
    if (message.length > FRAME_MAX) return ws.close(1009, 'too big');
    const seat = ws.deserializeAttachment() as Seat | null;
    if (!seat) return;
    const now = Date.now();
    const frames = rateCheck(seat.frames, now, FRAME_RATE);
    if (!frames) return ws.close(1008, 'too many frames');
    ws.serializeAttachment({ ...seat, frames } satisfies Seat);
    const say = readSay(message);
    if (!say) return;
    if ('error' in say) return this.send(ws, { t: 'error', error: say.error, c: say.c });

    if (isRepeat(seat.last, say.text, now)) return this.send(ws, { t: 'error', error: 'repeat', c: say.c });
    const sent = rateCheck(seat.sent, now, SOCKET_RATE);
    const fromIp = rateCheck(this.ips.get(seat.ip) ?? [], now, IP_RATE);
    if (!sent || !fromIp) return this.send(ws, { t: 'error', error: 'slow', c: say.c });
    if (this.ips.size > 10_000) this.ips.clear();
    this.ips.set(seat.ip, fromIp);
    ws.serializeAttachment({ ip: seat.ip, sent, frames, last: { hash: lineHash(say.text), at: now } } satisfies Seat);

    const sql = this.ctx.storage.sql;
    const m = sql.exec<LoungeMessage>('INSERT INTO messages (name, text, t) VALUES (?, ?, ?) RETURNING id, name, text, t', say.name, say.text, now).one();
    sql.exec('DELETE FROM messages WHERE id <= (SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET ?)', HISTORY);
    this.broadcast({ t: 'msg', m }, ws);
    this.send(ws, { t: 'msg', m, c: say.c });
  }

  async webSocketClose(ws: WebSocket) {
    this.broadcast({ t: 'online', n: this.seats(ws).length }, ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcast({ t: 'online', n: this.seats(ws).length }, ws);
  }

  /** Wipes every message and empties the chat on every open screen. Returns how many messages there were. */
  clear(): number {
    const sql = this.ctx.storage.sql;
    const removed = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages').one().n;
    sql.exec('DELETE FROM messages');
    this.broadcast({ t: 'cleared' });
    return removed;
  }

  private history(): LoungeMessage[] {
    return this.ctx.storage.sql.exec<LoungeMessage>('SELECT id, name, text, t FROM messages ORDER BY id DESC LIMIT ?', HISTORY).toArray().reverse();
  }

  private seats(except?: WebSocket): Seat[] {
    return this.ctx.getWebSockets()
      .filter((socket) => socket !== except && socket.readyState === WebSocket.OPEN)
      .map((socket) => socket.deserializeAttachment() as Seat | null)
      .filter((seat): seat is Seat => !!seat);
  }

  private send(ws: WebSocket, event: LoungeEvent) {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      ws.close(1011, 'send failed');
    }
  }

  private broadcast(event: LoungeEvent, except?: WebSocket) {
    const data = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(data);
      } catch {
        socket.close(1011, 'send failed');
      }
    }
  }
}
