// An online round: the host builds the game (humans by seat, bots in the empty slots), runs the rules and streams
// events, positions, a score table and each guest's inventory; guests build a replica from the host's sync and
// send their movement and actions. Lost or reordered packets are handled here: positions are newest-wins, events
// are numbered and held until the gap fills, and a gap that lasts asks the host for a fresh sync.
import { applyAction, createGame, type Action, type Entrant, type Ev, type Game, type Level, type Pace } from './game.ts';
import { perTeam, teamsFor, type Mode } from './map.ts';
import {
  EventQueue,
  SyncAssembler,
  actPacket,
  eventPackets,
  helloPacket,
  invPacket,
  movePacket,
  parsePacket,
  posEntry,
  posPacket,
  resyncPacket,
  syncPackets,
  syncState,
  tablePacket,
  F_GROUND,
  F_SNEAK,
  F_SPRINT,
  type SyncState,
} from './net.ts';
import { applyEvent, applyInventory, applyPositions, applySync, applyTable, buildReplica } from './replica.ts';
import type { Client } from './client.ts';

export type OnlineApi = {
  seat: number;
  isHost: boolean;
  round: number;
  players: { seat: number; name: string }[];
  transport: 'direct' | 'relay';
  send: (d: unknown, options?: { to?: number; fast?: boolean }) => void;
  onMessage: (listener: (from: number, d: unknown) => void) => () => void;
};

export type SessionOpts = {
  mode: Mode;
  level: Level;
  pace: Pace;
  bots: boolean;
  skin: number;
  botNames: string[];
  /** The game is ready to play: me is my player id. */
  onReady: (game: Game, me: number) => void;
};

/** Team for the i-th human in seat order: one per island in solo, two to an island in doubles. */
export const teamForHuman = (mode: Mode, i: number) => (mode === 'solo' ? i : Math.floor(i / 2)) % teamsFor(mode);

/**
 * The host's entrants: humans by seat, then bots on the open slots (or none). Without bots, humans who would all
 * share one island get one each instead, and a lone human gets a bot to fight, so a round always has two sides.
 */
export function hostEntrants(mode: Mode, humans: { seat: number; name: string; skin: number }[], mySeat: number, bots: boolean, botNames: string[]): Entrant[] {
  const per = perTeam(mode);
  const n = teamsFor(mode);
  const out: Entrant[] = [];
  const used = new Array(n).fill(0);
  const list = humans
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .slice(0, n * per);
  const spread = !bots && list.length <= per;
  list.forEach((h, i) => {
    const team = spread ? i % n : teamForHuman(mode, i);
    used[team]++;
    out.push({ name: h.name, seat: h.seat, ctrl: h.seat === mySeat ? 'local' : 'remote', skin: h.skin, team });
  });
  let k = 0;
  const bot = (t: number) => {
    used[t]++;
    out.push({ name: botNames[k % botNames.length] ?? 'Bot', seat: -1, ctrl: 'bot', skin: (k * 3 + 1) % 6, team: t });
    k++;
  };
  if (bots) {
    for (let t = 0; t < n; t++) while (used[t] < per) bot(t);
  } else if (used.filter((c) => c > 0).length < 2) {
    // nobody to play against: a bot takes the next island
    const empty = used.findIndex((c) => c === 0);
    if (empty >= 0) bot(empty);
  }
  return out;
}

export class Session {
  game: Game | null = null;
  me = -1;
  client: Client | null = null;
  private readonly online: OnlineApi;
  private readonly opts: SessionOpts;
  private off: (() => void) | null = null;
  // host
  private seq = 0;
  private syncId = 1;
  private invDirty = new Set<number>();
  private ticks = 0;
  private skins = new Map<number, number>();
  // guest
  private assembler = new SyncAssembler();
  private queue = new EventQueue();
  private lastPos = -1;
  private lastInv = -1;
  private pending: { seq: number; slot: number }[] = [];
  private askedAt = -10;
  private early: { s: number; e: Ev[] }[] = [];
  private clock = 0;

  constructor(online: OnlineApi, opts: SessionOpts) {
    this.online = online;
    this.opts = opts;
    this.off = online.onMessage((from, d) => this.receive(from, d));
    if (online.isHost) this.hostStart();
    else {
      online.send(helloPacket(online.round, opts.skin));
      online.send(resyncPacket(online.round));
    }
  }

  get isHost() {
    return this.online.isHost;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // host

  private hostStart() {
    const o = this.online;
    const humans = o.players.map((p) => ({ seat: p.seat, name: p.name, skin: p.seat === o.seat ? this.opts.skin : (this.skins.get(p.seat) ?? 0) }));
    const entrants = hostEntrants(this.opts.mode, humans, o.seat, this.opts.bots, this.opts.botNames);
    const game = createGame({ mode: this.opts.mode, pace: this.opts.pace, level: this.opts.level, entrants, seed: (Math.random() * 2 ** 31) >>> 0 });
    this.game = game;
    this.me = game.players.findIndex((p) => p.seat === o.seat);
    this.opts.onReady(game, this.me);
    this.sendSync();
  }

  private sendSync(to?: number) {
    const g = this.game;
    if (!g) return;
    const id = this.syncId++;
    for (const pk of syncPackets(this.online.round, id, syncState(g, this.seq))) this.online.send(pk, to === undefined ? {} : { to });
    // a fresh copy of their inventory too
    for (const p of g.players) if (p.ctrl === 'remote' && (to === undefined || p.seat === to)) this.online.send(invPacket(this.online.round, p), { to: p.seat });
  }

  /** The host's events for this tick go out numbered; inventories that changed go to their owners. */
  broadcast(evs: Ev[]) {
    const g = this.game;
    if (!g || !this.online.isHost) return;
    const out = evs.filter((e) => e.t !== 'inv');
    for (const e of evs) if (e.t === 'inv') this.invDirty.add(e.p);
    if (out.length) {
      const { packets, seq } = eventPackets(this.online.round, this.seq, out);
      this.seq = seq;
      for (const pk of packets) this.online.send(pk);
    }
  }

  /** Somebody left: their player keeps going as a bot so the teams stay whole. */
  playersChanged(players: { seat: number }[]) {
    const g = this.game;
    if (!g || !this.online.isHost) return;
    for (const p of g.players) {
      if (p.ctrl !== 'remote' || players.some((x) => x.seat === p.seat)) continue;
      p.ctrl = 'bot';
      p.gone = true;
      g.events.push({ t: 'msg', k: 'join', text: `${p.name} left. a bot takes over.` });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // every tick

  tick() {
    const g = this.game;
    const c = this.client;
    if (!g || !c) {
      if (!this.online.isHost) this.maybeResync();
      return;
    }
    this.clock = c.time;
    this.ticks++;
    const o = this.online;
    if (o.isHost) {
      // positions 20 times a second when direct, 10 over the relay
      if (o.transport === 'direct' || this.ticks % 2 === 0) o.send(posPacket(o.round, g.tick, g.players.map(posEntry)), { fast: true });
      if (this.ticks % 20 === 0) o.send(tablePacket(o.round, g));
      for (const id of this.invDirty) {
        const p = g.players[id];
        if (p && p.ctrl === 'remote') o.send(invPacket(o.round, p), { to: p.seat });
      }
      this.invDirty.clear();
      return;
    }
    const me = g.players[this.me];
    if (me) {
      const b = me.body;
      const flags = (b.sneaking ? F_SNEAK : 0) | (b.sprinting ? F_SPRINT : 0) | (b.onGround ? F_GROUND : 0);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      if (me.alive) o.send(movePacket(o.round, me.epoch, [r2(b.x), r2(b.y), r2(b.z), r3(b.vx), r3(b.vy), r3(b.vz), r3(b.yaw), r3(b.pitch), flags], me.sel, me.swings & 0xffff, Math.min(99, me.drawing)), { fast: true });
    }
    if (this.queue.stalled(this.clock)) {
      this.queue.clearGap();
      this.maybeResync(true);
    }
  }

  private maybeResync(force = false) {
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    if (!force && this.game) return;
    if (now - this.askedAt < 1.5) return;
    this.askedAt = now;
    this.online.send(resyncPacket(this.online.round));
  }

  /** Guests send actions; place actions are remembered until the host's inventory says it has seen them. */
  send(act: Action, seq: number) {
    const o = this.online;
    if (act.a === 'place') {
      const g = this.game;
      const s = g?.players[this.me]?.inv.slots[act.slot];
      if (s && s.item !== 'tnt') this.pending.push({ seq, slot: act.slot });
    }
    o.send(actPacket(o.round, seq, act));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // receiving

  private receive(from: number, d: unknown) {
    const pk = parsePacket(d);
    const o = this.online;
    if (!pk || pk.round !== o.round) return;
    if (o.isHost) {
      if (from === o.seat) return;
      const g = this.game;
      if (pk.k === 'hello') {
        this.skins.set(from, pk.skin);
        const p = g?.players.find((x) => x.seat === from && x.ctrl === 'remote');
        if (p && p.skin !== pk.skin) p.skin = pk.skin;
        return;
      }
      if (!g) return;
      const p = g.players.find((x) => x.seat === from && x.ctrl === 'remote');
      if (pk.k === 'resync') {
        this.sendSync(from);
        return;
      }
      if (!p) return;
      if (pk.k === 'move') {
        if (pk.ep !== p.epoch || !p.alive) return;
        const b = p.body;
        const [x, y, z, vx, vy, vz, yaw, pitch, flags] = pk.b;
        b.x = x;
        b.y = y;
        b.z = z;
        b.vx = vx;
        b.vy = vy;
        b.vz = vz;
        b.yaw = yaw;
        b.pitch = pitch;
        b.sneaking = !!(flags & F_SNEAK);
        b.sprinting = !!(flags & F_SPRINT);
        b.onGround = !!(flags & F_GROUND);
        p.sel = pk.sel;
        p.drawing = pk.dr;
        p.swings = pk.sw;
        const held = p.inv.slots[p.sel]?.item ?? null;
        p.show.item = held;
        p.show.tier = held === 'pick' ? p.inv.pick : held === 'axe' ? p.inv.axe : 0;
      } else if (pk.k === 'act') {
        const ok = applyAction(g, p, pk.a, true);
        p.ack = Math.max(p.ack, pk.s);
        // a refused placement still needs a fresh inventory to undo the guest's guess
        if (!ok || pk.a.a === 'place') this.invDirty.add(p.id);
      }
      return;
    }
    // guest
    if (from !== 0) return;
    switch (pk.k) {
      case 'sync': {
        const state = this.assembler.add(pk);
        if (state) this.onSync(state);
        break;
      }
      case 'ev': {
        if (!this.game) {
          this.early.push({ s: pk.s, e: pk.e });
          if (this.early.length > 200) this.early.shift();
          break;
        }
        this.applyEvents(this.queue.push(pk.s, pk.e, this.clock));
        break;
      }
      case 'pos':
        if (!this.game || pk.tick < this.lastPos) break;
        this.lastPos = pk.tick;
        applyPositions(this.game, pk.p, this.me);
        break;
      case 'table':
        if (this.game) applyTable(this.game, pk.tick, pk.phase, pk.gens, pk.stats);
        break;
      case 'inv': {
        const g = this.game;
        if (!g || pk.v <= this.lastInv) break;
        this.lastInv = pk.v;
        const me = g.players[this.me];
        if (me) {
          applyInventory(me, pk.inv, pk.sel, this.pending, pk.a);
          this.client?.hooks.ping?.();
        }
        break;
      }
    }
  }

  private onSync(state: SyncState) {
    if (!this.game) {
      const { game, me } = buildReplica(state, this.online.seat);
      if (me < 0) return;
      this.game = game;
      this.me = me;
      this.queue.reset(state.seq);
      this.opts.onReady(game, me);
      // events that came in before the sync
      const early = this.early.splice(0).sort((a, b) => a.s - b.s);
      for (const x of early) this.applyEvents(this.queue.push(x.s, x.e, this.clock));
      return;
    }
    applySync(this.game, state);
    this.queue.reset(state.seq);
    this.client?.hooks.ping?.();
  }

  private applyEvents(evs: Ev[]) {
    const g = this.game;
    if (!g) return;
    for (const e of evs) {
      applyEvent(g, e, this.me);
      this.client?.onEvent(e);
    }
  }

  dispose() {
    this.off?.();
    this.off = null;
  }
}
