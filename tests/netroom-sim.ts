// A Palm Drive room end to end, in one process: the Worker's real Room Durable Object (on stand-ins for the Workers
// runtime), the arcade's real RoomLink on every client (over simulated sockets with latency, jitter, retransmits,
// dropped connections and a Worker redeploy), and each client's race run the way the game runs it (netsync). Time is
// node:test's mock clock, so a race takes seconds. Used by arcade-palmdrive-netroom.test.ts, and by hand to measure.
import { register } from 'node:module';
import type { MockTimers } from 'node:test';
import { botPlayers, nextOnlineRound, RoundRouter, tagRound } from '../src/os/arcade/kit/online-core.ts';
import { RoomLink, type RoomPlayer } from '../src/os/arcade/kit/room.ts';
import { COUNTDOWN, RIVALS, step, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { lookFor, freshGarage } from '../src/os/arcade/games/palmdrive/garage.ts';
import { advance, flushEvents, newNet, onHostClock, onlineRace, outgoing, Pacer, receive, SEND_MS, tick, type Net, type Seats } from '../src/os/arcade/games/palmdrive/netsync.ts';
import { ONLINE_SPECS } from '../worker/src/specs.gen.ts';

// The Worker's modules import 'cloudflare:workers' and each other without extensions, as wrangler's bundler allows.
const hooks = `
const STUB = 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: STUB, shortCircuit: true };
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL && context.parentURL.includes('/worker/src/')) return next(specifier + '.ts', context);
  return next(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

/**
 * One way's network: base latency, extra up to `jitter`, and a `loss` share of messages held up by a retransmit (`rto`).
 * TCP keeps them in order. `spike`: the share of messages caught in a Wi-Fi stall of up to `spikeMs` more (everything
 * behind them waits too, then arrives in a burst).
 */
export type Link = { latency: number; jitter: number; loss: number; rto: number; spike?: number; spikeMs?: number };
export const NET_OK: Link = { latency: 40, jitter: 25, loss: 0.01, rto: 220 };

/** A seeded random number generator, so a run is the same every time. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One direction of a connection: in order, each message no sooner than the one before it. */
class Pipe {
  private last = 0;
  private readonly link: () => Link;
  private readonly rand: () => number;
  constructor(link: () => Link, rand: () => number) {
    this.link = link;
    this.rand = rand;
  }
  send(fn: () => void) {
    const l = this.link();
    const now = Date.now();
    const stall = l.spike && this.rand() < l.spike ? this.rand() * (l.spikeMs ?? 0) : 0;
    const at = Math.max(this.last, now + l.latency + this.rand() * l.jitter + (this.rand() < l.loss ? l.rto : 0) + stall);
    this.last = at;
    setTimeout(fn, at - now);
  }
}

type Listener = (event: unknown) => void;

/** The Durable Object's end of a socket (what ctx.acceptWebSocket takes and getWebSockets gives back). */
class ServerSocket {
  readyState = 1;
  attachment: unknown = null;
  /** Taken on by the object (ctx.acceptWebSocket), so the runtime tells it when the socket closes. */
  hibernated = false;
  /** Set once the client side is wired up (see ClientSocket). */
  peer: ClientSocket | null = null;
  pending: string[] = [];
  readonly sim: SimRoom;
  constructor(sim: SimRoom) {
    this.sim = sim;
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  accept() {}
  send(data: string) {
    if (this.readyState !== 1) throw new Error('socket closed');
    this.sim.out++;
    this.sim.outBytes += data.length;
    if (this.peer) this.peer.fromServer(data);
    else this.pending.push(data);
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.peer?.serverClosed(code, reason, this);
  }
}

/** What `new WebSocketPair()` gives the Worker: [the client's end, the server's end]. */
class SimPair {
  0: { server: ServerSocket };
  1: ServerSocket;
  constructor() {
    const server = new ServerSocket(SimRoom.current!);
    this[1] = server;
    this[0] = { server };
  }
}

class SimResponse {
  status: number;
  webSocket: { server: ServerSocket } | null;
  constructor(_body: unknown, init: { status?: number; webSocket?: { server: ServerSocket } } = {}) {
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket ?? null;
  }
}

class MemStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.data.delete(key);
  }
  async deleteAll() {
    this.data.clear();
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}

/**
 * The browser's end of a socket, standing in for the global WebSocket that RoomLink opens. It reaches the room after a
 * moment's latency; `cut` drops it (with the close event, or silently, as a dead connection on a phone or laptop does).
 */
export class ClientSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  readonly url: URL;
  server: ServerSocket | null = null;
  readonly client: SimClient | null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly up: Pipe;
  private readonly down: Pipe;
  /** A dead connection: nothing gets through either way, and nobody is told. */
  dead = false;
  constructor(url: string | URL) {
    this.url = new URL(String(url));
    const sim = SimRoom.current!;
    this.client = sim.clients.find((c) => c.name === this.url.searchParams.get('name')) ?? null;
    const link = () => this.client?.net ?? NET_OK;
    this.up = new Pipe(link, sim.rand);
    this.down = new Pipe(link, sim.rand);
    this.client?.sockets.push(this);
    this.up.send(() => void this.connect(sim));
  }
  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  private emit(type: string, event: unknown) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  private async connect(sim: SimRoom) {
    if (this.dead || this.readyState >= 2) return;
    const url = new URL(this.url);
    url.protocol = 'https:';
    let response: SimResponse;
    try {
      SimRoom.current = sim;
      response = (await sim.room.fetch(new Request(url, { headers: { Upgrade: 'websocket' } }))) as unknown as SimResponse;
    } catch (err) {
      sim.errors.push(err);
      this.down.send(() => this.closeHere(1006, 'refused'));
      return;
    }
    if (response.status !== 101 || !response.webSocket) {
      this.down.send(() => this.closeHere(1006, 'refused'));
      return;
    }
    const server = response.webSocket.server;
    this.server = server;
    this.roomAt = sim.room;
    server.peer = this;
    const pending = server.pending.splice(0);
    this.down.send(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.emit('open', {});
    });
    for (const data of pending) this.fromServer(data);
  }
  /** From the room: arrives after the latency, unless the connection is dead. */
  fromServer(data: string) {
    if (this.dead) return;
    this.down.send(() => this.deliver(data));
  }
  /** What has come in while the page was busy (a long frame): it is read once the page is free, in order. */
  private queued: string[] = [];
  private deliver(data: string) {
    if (this.dead || this.readyState !== 1) return;
    const client = this.client;
    if (client && (Date.now() < client.busyUntil || this.queued.length)) {
      if (this.queued.push(data) === 1) setTimeout(() => this.flushQueued(), Math.max(0, client.busyUntil - Date.now()));
      return;
    }
    if (client) {
      client.down += data.length;
      client.downMsgs++;
    }
    this.emit('message', { data });
  }
  private flushQueued() {
    const client = this.client!;
    if (Date.now() < client.busyUntil) {
      setTimeout(() => this.flushQueued(), client.busyUntil - Date.now());
      return;
    }
    for (const data of this.queued.splice(0)) this.deliver(data);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open');
    if (this.client) {
      this.client.up += data.length;
      this.client.upMsgs++;
    }
    if (this.dead) return;
    const server = this.server!;
    const sim = SimRoom.current!;
    this.up.send(() => {
      if (this.dead || server.readyState !== 1 || sim.room !== this.roomAt) return;
      // what the runtime answers itself, without waking the object
      if (data === 'ping') {
        server.send('pong');
        return;
      }
      sim.in++;
      void sim.room.webSocketMessage(server as unknown as WebSocket, data);
    });
  }
  /** The room instance this socket belongs to (a redeploy starts a new one, and old sockets reach nothing). */
  roomAt = SimRoom.current?.room;
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const server = this.server;
    const room = this.roomAt;
    if (!this.dead && server) {
      this.up.send(() => {
        if (server.readyState >= 3) return;
        server.readyState = 3;
        const sim = SimRoom.current!;
        if (!server.hibernated || sim.room !== room) return;
        void sim.room.webSocketClose(server as unknown as WebSocket, code, reason, true);
      });
    }
    this.down.send(() => this.closeHere(code, reason));
  }
  /** The room closed this socket: the browser hears it, answers, and the runtime tells the object it has closed. */
  serverClosed(code: number, reason: string, server: ServerSocket) {
    if (this.dead) return;
    const room = this.roomAt;
    this.down.send(() => {
      this.closeHere(code, reason);
      this.up.send(() => {
        if (server.readyState >= 3) return;
        server.readyState = 3;
        const sim = SimRoom.current!;
        if (server.hibernated && sim.room === room) void sim.room.webSocketClose(server as unknown as WebSocket, code, reason, true);
      });
    });
  }
  private closeHere(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
  /**
   * The connection drops. `notice`: both ends hear of it a moment later (code 1006), as when Wi-Fi drops; otherwise
   * it just goes quiet both ways (a dead NAT mapping, a laptop lid), and only RoomLink's own watch notices.
   */
  cut(notice: boolean) {
    this.dead = true;
    const server = this.server;
    const room = this.roomAt;
    if (!notice) return;
    setTimeout(() => this.closeHere(1006, ''), 300);
    if (server)
      setTimeout(() => {
        if (server.readyState >= 3) return;
        server.readyState = 3;
        const sim = SimRoom.current!;
        if (sim.room === room) void sim.room.webSocketClose(server as unknown as WebSocket, 1006, '', false);
      }, 300);
  }
}

/** The room: the Worker's Room object on a stand-in runtime, and everyone connected to it. */
export class SimRoom {
  static current: SimRoom | null = null;
  readonly storage = new MemStorage();
  readonly sockets: ServerSocket[] = [];
  readonly clients: SimClient[] = [];
  room!: { fetch(r: Request): Promise<Response>; webSocketMessage(ws: WebSocket, m: string): Promise<void>; webSocketClose(ws: WebSocket, code: number, reason: string, clean: boolean): Promise<void>; alarm(): Promise<void>; open(...args: unknown[]): Promise<boolean> };
  readonly rand: () => number;
  /** Messages into the room and out of it (runtime pongs included), and what went out in bytes. */
  in = 0;
  out = 0;
  outBytes = 0;
  errors: unknown[] = [];
  private Room!: new (ctx: unknown, env: unknown) => SimRoom['room'];
  private readonly saved = new Map<string, unknown>();
  readonly code: string;

  /** worker: the Worker's module to load (another build of it, say the one in production). */
  readonly worker: string;
  constructor(code: string, seed = 1, worker = '../worker/src/index.ts') {
    this.code = code;
    this.rand = rng(seed);
    this.worker = worker;
  }

  /** Puts the stand-ins in place (globals the Worker and RoomLink use), loads the Worker and opens the room. */
  async start() {
    SimRoom.current = this;
    for (const [key, value] of Object.entries({ WebSocketPair: SimPair, WebSocketRequestResponsePair: class {}, Response: SimResponse, WebSocket: ClientSocket })) {
      this.saved.set(key, (globalThis as Record<string, unknown>)[key]);
      (globalThis as Record<string, unknown>)[key] = value;
    }
    const worker = (await import(this.worker)) as unknown as { Room: SimRoom['Room'] };
    this.Room = worker.Room;
    this.boot();
    await this.room.open(this.code, 'palmdrive', ONLINE_SPECS.palmdrive, false);
  }

  /** Takes the stand-ins away again. */
  stop() {
    for (const [key, value] of this.saved) (globalThis as Record<string, unknown>)[key] = value;
    SimRoom.current = null;
  }

  private boot() {
    const sockets = this.sockets;
    const ctx = {
      storage: this.storage,
      acceptWebSocket: (ws: ServerSocket) => {
        ws.hibernated = true;
        sockets.push(ws);
      },
      getWebSockets: () => sockets.filter((s) => s.readyState < 3),
      setWebSocketAutoResponse: () => {},
    };
    const lobby = { put: async () => {}, drop: async () => {}, quick: async (_g: string, code: string) => code, list: async () => [] };
    const boards = { recordWin: async () => {} };
    const env = { LOBBY: { idFromName: () => 'global', get: () => lobby }, BOARDS: { idFromName: () => 'global', get: () => boards } };
    this.room = new this.Room(ctx, env);
    // (the closing side of a socket the room closes itself is the runtime's business: it calls webSocketClose)
    const room = this.room;
    for (const s of sockets) s.readyState = 3;
    sockets.length = 0;
    void room;
  }

  /**
   * The Worker is redeployed: the object restarts with its storage, and every socket to it drops at once (the
   * clients hear 1012, service restart; the new object never hears of the old sockets).
   */
  redeploy() {
    const old = [...this.sockets];
    this.boot();
    for (const c of this.clients) for (const sock of c.sockets) sock.roomAt = undefined;
    for (const s of old) s.peer?.serverClosed(1012, 'restart', s);
  }

  /** Runs the room's alarm when it is due. */
  async alarms() {
    if (this.storage.alarm !== null && this.storage.alarm <= Date.now()) {
      this.storage.alarm = null;
      await this.room.alarm();
    }
  }
}

/** Lets every timer callback's async work (the room's storage awaits, mostly) finish. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const LOOK = lookFor(freshGarage());

/**
 * One player: a RoomLink to the room, and their race run as the game runs it: frames while the page is visible (each
 * catching the race up to the wall clock, see Pacer), and the network tick every SEND_MS, which also runs the race
 * while no frames come. `legacy` plays it the way it was before: frames in slow motion when they are slow, and kart
 * states without their sample time (so receivers place them as of when they arrive, and the host passes them all on).
 */
export class SimClient {
  link!: RoomLink;
  readonly router = new RoundRouter();
  readonly sockets: ClientSocket[] = [];
  seat: number | null = null;
  round = 0;
  players: RoomPlayer[] = [];
  roundBots: number[] = [];
  race: Race | null = null;
  n: Net = newNet(null);
  readonly pacer = new Pacer();
  /** Bytes and messages sent and received. */
  up = 0;
  down = 0;
  upMsgs = 0;
  downMsgs = 0;
  closed: string[] = [];
  links: string[] = [];
  /** The page is busy until then (a long frame): nothing else runs, and what comes in waits. */
  busyUntil = 0;
  /** Frames stop while the page is hidden; its own timers are held to once a second (a hidden page without a worker). */
  hidden = false;
  frameMs: number;
  /** When given, how long until the next frame (a page whose frame rate wanders and hitches), instead of frameMs. */
  frames: (() => number) | null;
  /** Called after each frame, to measure what the screen would show. */
  onFrame: ((c: SimClient, now: number) => void) | null = null;
  laps: number | undefined;
  end: { w: number | null; order: [number, number][] } | null = null;
  private nextFrame = 0;
  private nextTick = 0;
  private lastFrame = 0;
  private frameAt = 0;
  readonly sim: SimRoom;
  readonly name: string;
  net: Link;
  constructor(sim: SimRoom, name: string, net: Link, opts: { frameMs?: number; frames?: () => number; laps?: number; legacy?: boolean } = {}) {
    this.sim = sim;
    this.name = name;
    this.net = net;
    this.frameMs = opts.frameMs ?? 1000 / 30;
    this.frames = opts.frames ?? null;
    this.laps = opts.laps;
    this.legacy = !!opts.legacy;
    sim.clients.push(this);
  }
  readonly legacy: boolean;

  get isHost() {
    return this.seat === 0;
  }

  get seats(): Seats {
    return { seat: this.seat ?? -1, isHost: this.isHost, round: this.round, players: this.players, bots: botPlayers(this.roundBots, RIVALS.map((r) => r.name)) };
  }

  join() {
    const link = new RoomLink(this.sim.code, this.name, 'https://arcade.test');
    this.link = link;
    link.on('welcome', (w) => {
      this.seat = w.seat;
      this.players = w.players;
      this.router.join(w.round);
    });
    link.on('players', (p) => (this.players = p));
    link.on('host', ({ seat, players }) => {
      this.seat = seat;
      this.players = players;
    });
    link.on('closed', ({ reason }) => this.closed.push(reason));
    link.on('link', (state) => this.links.push(state));
    link.on('msg', ({ from, d }) => this.router.receive(from, d, true));
    link.on('start', ({ players, round, bots }) => {
      this.players = players;
      this.roundBots = bots;
      this.round = nextOnlineRound(this.round, round);
      this.router.begin(this.round);
      this.n = { ...newNet(this.seats), laps: this.laps };
      this.race = onlineRace(this.seats, '150cc', 'palm', [...new Set([...players.map((p) => p.seat), ...bots])].sort((a, b) => a - b), this.isHost ? COUNTDOWN + 1.2 : 60, LOOK, this.laps);
      if (this.race) for (const k of this.race.karts) if (k.kind === 'player') k.auto = true;
      this.pacer.reset(Date.now());
      this.end = null;
      this.router.release();
    });
    this.router.listen((from, d) => this.hear(from, d));
  }

  send(d: unknown, fast?: boolean, everyone?: boolean) {
    this.link.send(tagRound(this.router.round, this.legacy ? stripTimes(d) : d), fast || (everyone && !this.legacy && !this.toHost) ? { fast, everyone: everyone && !this.legacy && !this.toHost } : undefined);
  }
  /** A guest's kart goes only to the host, who passes it on (as it did before it went to everyone at once). */
  toHost = !!process.env.SIM_TOHOST;

  private hear(from: number, d: unknown) {
    if (!this.race) return;
    const heard = receive(this.n, this.race, this.seats, from, d, () => LOOK, this.legacy ? 0 : this.pacer.lag(Date.now()));
    if (!heard) return;
    if (heard.race) {
      this.race = heard.race;
      for (const k of this.race.karts) if (k.kind === 'player') k.auto = true;
      this.pacer.reset(Date.now());
    } else if (heard.end) this.end = heard.end;
    else if (heard.relay !== undefined) this.send(heard.relay);
  }

  /** Runs the race on (`background`: from the network tick, with no frames coming). */
  private run(background: boolean) {
    const r = this.race!;
    if (this.legacy) {
      const dt = Math.min((Date.now() - this.lastFrame) / 1000, 1 / 20);
      this.lastFrame = Date.now();
      if (background) return;
      step(r, dt);
      for (const e of r.events.splice(0)) outgoing(this.n, r, e);
    } else {
      advance(r, onHostClock(this.n, this.isHost, this.pacer.take(Date.now(), background ? 2 : 0.25)), (evs) => {
        for (const e of evs) outgoing(this.n, r, e);
      });
    }
    for (const d of flushEvents(this.n, this.round, this.legacy ? null : r.time)) this.send(d);
  }

  /** What happens at this moment on this player's machine: a frame when one is due, and the network tick. */
  update(now: number) {
    if (!this.race || this.seat === null || now < this.busyUntil) return;
    if (!this.hidden && now >= this.nextFrame) {
      const gap = this.frames ? this.frames() : this.frameMs;
      this.nextFrame = now + gap;
      // (a long frame keeps the page busy: the frame's own work, a shader compile, a collection)
      if (gap > 50) this.busyUntil = now + gap - 8;
      if (this.n.synced) {
        this.frameAt = now;
        this.run(false);
        this.onFrame?.(this, now);
      }
    }
    if (now >= this.nextTick) {
      this.nextTick = now + (this.hidden ? 1000 : SEND_MS);
      if (!this.n.synced) return;
      if (!this.legacy && now - this.frameAt > 250) this.run(true);
      const { out, end } = tick(this.n, this.race, this.seats, 0, this.legacy ? 0 : this.pacer.lag(now), !this.legacy && !this.toHost);
      for (const { d, fast, everyone } of out) this.send(d, fast, everyone);
      if (end) this.end = end;
    }
  }

  /** This player's own kart. */
  get me() {
    return this.race?.karts[this.race.me] ?? null;
  }
}

/** A kart state packet as an older client sent it: no sample times. */
function stripTimes(d: unknown): unknown {
  if (!d || typeof d !== 'object') return d;
  const p = d as Record<string, unknown>;
  if (p.k === 's' && Array.isArray(p.c)) return { ...p, c: p.c.slice(0, 9) };
  if (p.k === 'S' && typeof p.go === 'number') return { ...p, go: Math.round(p.go * 100) / 100, cars: (p.cars as unknown[][]).map((c) => c.slice(0, 10)) };
  if (p.k === 'S' && Array.isArray(p.cars)) return { ...p, cars: (p.cars as unknown[][]).map((c) => c.slice(0, 10)) };
  return d;
}

/** How far each viewer's picture of everyone else's kart is from where its owner has it, right now (metres). */
export function viewErrors(clients: SimClient[]): number[] {
  const errs: number[] = [];
  const host = clients.find((c) => c.isHost);
  for (const viewer of clients) {
    const r = viewer.race;
    if (!r || !viewer.n.synced || r.time < 2) continue;
    for (const k of r.karts) {
      if (k.kind !== 'remote' || k.left || k.done !== null) continue;
      const owner = clients.find((c) => c.seat === k.seat && c.race);
      // a bot: the host drives it
      const truth = owner ? owner.me : host?.race?.karts.find((x) => x.seat === k.seat && x.kind === 'cpu');
      if (!truth || truth.done !== null || truth.sunk > 0 || k.sunk > 0) continue;
      if (owner && (owner.hidden || owner.sockets.some((s) => s.dead))) continue;
      errs.push(Math.hypot(truth.x - k.x, truth.z - k.z));
    }
  }
  return errs;
}

/**
 * What everyone's screen shows, frame by frame: how smoothly other people's karts move (each frame's step against the
 * one before, carried on: a kart that jumps or jerks shows here, one going round a bend or braking hardly at all), how
 * old the word of them is, how far each frame moves the race clock against the wall clock (which every kart, this
 * player's own included, and every set piece runs on), and how far each guest's clock is from the host's.
 */
export class Screens {
  /** The step of each remote kart each frame, against the one before carried on (metres), and the same of its owner's kart at those moments. */
  readonly jumps: number[] = [];
  readonly truth: number[] = [];
  /** How old the word of each remote kart is, each frame (seconds): guests' karts seen by other guests, and everyone else's. */
  readonly ageGuests: number[] = [];
  readonly ageOthers: number[] = [];
  /** Each frame: the race clock's move against the wall clock's (seconds), and on a guest how far it is off the host's. */
  readonly clockStep: number[] = [];
  readonly clockOff: number[] = [];
  private readonly seen = new Map<string, { p: [number, number][]; t: number[] }>();
  private readonly held = new Map<string, number>();
  private readonly frames = new Map<SimClient, { now: number; time: number; race: Race }>();
  readonly clients: SimClient[];
  /** Karts are watched from this race time on (the start is a scrum on the grid). */
  readonly from: number;
  constructor(clients: SimClient[], from = 8) {
    this.clients = clients;
    this.from = from;
    for (const c of clients) c.onFrame = (client, now) => this.frame(client, now);
  }
  private step(key: string, x: number, z: number, now: number): number | null {
    let h = this.seen.get(key);
    if (!h) this.seen.set(key, (h = { p: [], t: [] }));
    h.p.push([x, z]);
    h.t.push(now);
    if (h.p.length > 3) {
      h.p.shift();
      h.t.shift();
    }
    if (h.p.length < 3) return null;
    const [a, b, c] = h.p;
    const s = (h.t[2] - h.t[1]) / (h.t[1] - h.t[0]);
    return Math.hypot(c[0] - (b[0] + (b[0] - a[0]) * s), c[1] - (b[1] + (b[1] - a[1]) * s));
  }
  private frame(c: SimClient, now: number) {
    const r = c.race!;
    const host = this.clients.find((x) => x.isHost);
    const last = this.frames.get(c);
    this.frames.set(c, { now, time: r.time, race: r });
    if (last && last.race === r && r.time > 0.5) {
      this.clockStep.push(Math.abs(r.time - last.time - (now - last.now) / 1000));
      const h = host && this.frames.get(host);
      if (!c.isHost && h && h.race === host!.race) {
        const off = Math.abs(r.time - (h.time + (now - h.now) / 1000));
        this.clockOff.push(off);
      }
    }
    if (!c.n.synced || r.time < this.from) return;
    for (const k of r.karts) {
      if (k.kind !== 'remote' || k.left || k.done !== null) continue;
      const owner = this.clients.find((x) => x.seat === k.seat && x.race);
      const truth = owner ? owner.me : host?.race?.karts.find((x) => x.seat === k.seat && x.kind === 'cpu');
      if (!truth || truth.done !== null || (owner && (owner.hidden || owner.sockets.some((s) => s.dead)))) continue;
      const key = `${c.name}:${k.seat}`;
      // (a kart in the water, and for a moment after it is set back on the road, jumps for real)
      if (truth.sunk > 0 || k.sunk > 0) this.held.set(key, now);
      const j = this.step(key, k.x, k.z, now);
      const tj = this.step(`${key}:truth`, truth.x, truth.z, now);
      if (j === null || tj === null || now - (this.held.get(key) ?? -1e9) < 1500) continue;
      this.jumps.push(j);
      this.truth.push(tj);
      if (k.net) (owner && !c.isHost && !owner.isHost ? this.ageGuests : this.ageOthers).push(r.time - k.net.at);
    }
  }
}

export const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** Runs everything `ms` on, in `stepMs` slices of the mock clock. */
export async function runFor(timers: MockTimers, sim: SimRoom, ms: number, each?: (now: number) => void, stepMs = 1000 / 60) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    timers.tick(stepMs);
    await settle();
    await sim.alarms();
    await settle();
    const now = Date.now();
    for (const c of sim.clients) c.update(now);
    each?.(now);
  }
}
