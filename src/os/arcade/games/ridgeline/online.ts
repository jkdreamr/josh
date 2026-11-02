// Online breach: a room of up to ten people, bots in the empty places. The room is a star around the host, whose
// game runs the rules and the bots; each guest moves its own soldier on its own machine (so its controls never wait
// on the network) and keeps a mirror of the rest.
//
// What travels:
//   guest -> host   mv     its soldier, about 30 times a second (fast, newest wins)
//                   fire   each shot it fires (so everyone sees it), with the bullets' flight
//                   hit    a hit its own bullet made on what it saw; the host checks it (the weapon held, shots fired
//                          and not used up, where the shooter and the target were over the last second, a clear line)
//                          and only then does the damage
//                   buy, throw, hello (send me everything)
//   host -> guests  pos    where everyone is, 20 times a second (fast)
//                   tab    everything else that changes (health, guns, credits, scores, the round, the charge), 5
//                          times a second and at once when the round changes (fast; each one complete)
//                   ev     what happened (shots, kills, hits, the round's events), batched (reliable)
//                   sync   the whole match, on joining and when the roster changes
// Everyone else on a guest is drawn a tenth of a second in the past from a short history of the host's positions, on
// a clock mapped to the host's, so late or bunched packets never turn into stop and go. Players who leave become bots;
// someone joining mid match takes over a bot on the team with fewer people; if the host leaves, the next host's game
// (a mirror until then) takes over the rules from where they stood.
// Pure (no DOM), so it runs under node.
import { newBrain } from './bots.ts';
import { clearLine } from './physics.ts';
import {
  applyHit,
  buy,
  createMatch,
  currentGun,
  gun,
  throwFor,
  type Actor,
  type Claim,
  type Ev,
  type Level,
  type Match,
  type NadeKind,
  type Phase,
  type RosterEntry,
  type ShopItem,
  type Why,
  type Zone,
} from './match.ts';
import { MAP_IDS, type MapId } from './maps.ts';
import { WEAPONS, WEAPON_IDS, type WeaponId } from './weapons.ts';
import type { World } from './world.ts';

export const NET_TAG = 'rl';

/** The room as the session sees it (the shell's useOnline, wrapped). */
export type OnlineApi = {
  readonly seat: number;
  readonly isHost: boolean;
  readonly round: number;
  readonly players: readonly { seat: number; name: string }[];
  send(d: unknown, opts?: { to?: number; fast?: boolean }): void;
  onMessage(fn: (from: number, d: unknown) => void): () => void;
};

/** How far in the past others are drawn, seconds: enough to always have a position after the one shown. */
const DELAY = 0.11;
const POS_EVERY = 0.05;
const TAB_EVERY = 0.2;
const MOVE_EVERY = 1 / 30;
const EV_EVERY = 0.05;

// ---------------------------------------------------------------------------------------------------------------
// smooth motion

/** A remote machine's clock mapped onto this one's: the offset of the quickest packet seen, slowly let go of. */
export class Clock {
  private off: number | null = null;
  feed(remote: number, local: number) {
    const o = local - remote;
    if (this.off === null || o < this.off) this.off = o;
    // drift: let the offset creep up so a clock running slower is followed (a hundredth of the gap a packet)
    else this.off += (o - this.off) * 0.01;
  }
  map(remote: number) {
    return remote + (this.off ?? 0);
  }
  get ready() {
    return this.off !== null;
  }
}

type Pose = { t: number; x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vz: number };
const TAU = Math.PI * 2;
const wrap = (a: number) => (Number.isFinite(a) ? a - TAU * Math.floor((a + Math.PI) / TAU) : 0);

/** A short history of someone's poses on this machine's clock, sampled between two of them (or a little past the last). */
export class Track {
  private buf: Pose[] = [];
  push(p: Pose) {
    const last = this.buf[this.buf.length - 1];
    if (last && p.t <= last.t) return;
    this.buf.push(p);
    if (this.buf.length > 24) this.buf.shift();
  }
  clear() {
    this.buf.length = 0;
  }
  get size() {
    return this.buf.length;
  }
  sample(t: number, out: Pose): boolean {
    const b = this.buf;
    if (!b.length) return false;
    if (t <= b[0].t) return Object.assign(out, b[0]), true;
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= t) {
        const p = b[i];
        const q = b[i + 1];
        if (!q) {
          // late: carry on along the last velocity a little (never far)
          const k = Math.min(t - p.t, 0.12);
          Object.assign(out, p);
          out.x += p.vx * k;
          out.z += p.vz * k;
          return true;
        }
        const k = (t - p.t) / (q.t - p.t || 1);
        out.x = p.x + (q.x - p.x) * k;
        out.y = p.y + (q.y - p.y) * k;
        out.z = p.z + (q.z - p.z) * k;
        out.yaw = p.yaw + wrap(q.yaw - p.yaw) * k;
        out.pitch = p.pitch + (q.pitch - p.pitch) * k;
        out.vx = q.vx;
        out.vz = q.vz;
        out.t = t;
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// packets: encoding, and a parser that trusts nothing

const PHASES: Phase[] = ['buy', 'live', 'end', 'over'];
const CHARGE_STATES = ['carried', 'dropped', 'planted', 'defused', 'blown'] as const;
const WHYS: Why[] = ['elim', 'time', 'blast', 'defuse'];
const ZONES: Zone[] = ['head', 'body', 'leg'];
const NADES: NadeKind[] = ['frag', 'smoke', 'flash'];
const SHOP_ITEMS: ShopItem[] = [...WEAPON_IDS, 'light', 'heavy', 'frag', 'smoke', 'flash'];
const gunCode = (id: WeaponId | null | undefined) => (id ? WEAPON_IDS.indexOf(id) + 1 : 0);
const gunOf = (n: number): WeaponId | null => WEAPON_IDS[n - 1] ?? null;

const num = (v: unknown, lo = -1e6, hi = 1e6): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v, lo, hi);
  return n === null ? null : Math.round(n);
};
const nums = (v: unknown, len: number, lo = -1e6, hi = 1e6): number[] | null => {
  if (!Array.isArray(v) || v.length !== len) return null;
  for (const x of v) if (num(x, lo, hi) === null) return null;
  return v as number[];
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Everyone's place: 9 numbers each. */
const POS_N = 9;
/** Everything else about each of them: 18 numbers each. */
const TAB_N = 18;

function encodePos(m: Match): number[] {
  const out: number[] = [];
  for (const a of m.actors) {
    const b = a.body;
    const flags = (a.alive ? 1 : 0) | (b.onGround ? 2 : 0) | (a.walking ? 4 : 0) | (a.ads > 0.5 ? 8 : 0) | (a.reloadT > 0 ? 16 : 0) | (b.swim ? 32 : 0);
    out.push(Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(wrap(a.yaw) * 1000), Math.round(a.pitch * 1000), Math.round(b.vx * 10), Math.round(b.vz * 10), Math.round(a.crouch * 100), flags);
  }
  return out;
}

type Tab = {
  phase: Phase;
  phaseT: number;
  round: number;
  score: [number, number];
  attack: number;
  aim: number;
  winner: number;
  last: { winner: number; why: Why } | null;
  charge: number[];
  a: number[];
};

function encodeTab(m: Match): Tab {
  const c = m.charge;
  const a: number[] = [];
  for (const o of m.actors)
    a.push(
      Math.round(o.hp),
      Math.round(o.armor),
      o.slot,
      gunCode(o.guns[0]?.id),
      gunCode(o.guns[1]?.id),
      o.epoch,
      Math.round(o.credits),
      o.kills,
      o.deaths,
      o.assists,
      Math.round(o.cs),
      o.frags,
      o.smokes,
      o.flashes,
      o.roundKills,
      Math.round(o.roundDmg),
      o.alive ? 1 : 0,
      Math.round(o.blindT * 10),
    );
  return {
    phase: m.phase,
    phaseT: r2(m.phaseT),
    round: m.round,
    score: [m.score[0], m.score[1]],
    attack: m.attack,
    aim: m.aim,
    winner: m.winner,
    last: m.last ? { ...m.last } : null,
    charge: [CHARGE_STATES.indexOf(c.state), c.holder, r2(c.x), r2(c.y), r2(c.z), c.site, r2(c.fuse), c.plantBy, r2(c.plantT), c.defuseBy, r2(c.defuseT), r2(c.defuseKept)],
    a,
  };
}

function parseTab(v: unknown, n: number): Tab | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const phase = PHASES.find((p) => p === o.phase);
  const phaseT = num(o.phaseT, 0, 1e4);
  const round = int(o.round, 0, 99);
  const score = nums(o.score, 2, 0, 99);
  const attack = int(o.attack, 0, 1);
  const aim = int(o.aim, 0, 2);
  const winner = int(o.winner, -1, 1);
  const charge = nums(o.charge, 12);
  const a = nums(o.a, n * TAB_N, -1e6, 1e6);
  if (!phase || phaseT === null || round === null || !score || attack === null || aim === null || winner === null || !charge || !a) return null;
  let last: Tab['last'] = null;
  if (o.last && typeof o.last === 'object') {
    const l = o.last as Record<string, unknown>;
    const w = int(l.winner, -1, 1);
    const why = WHYS.find((x) => x === l.why);
    if (w !== null && why) last = { winner: w, why };
  }
  return { phase, phaseT, round, score: [score[0], score[1]], attack, aim, winner, last, charge, a };
}

/** The events a guest is told about (the rest it makes itself: its own footsteps, impacts, grenades in flight). */
const SHARED = new Set(['kill', 'hit', 'shot', 'throw', 'buy', 'phase', 'round', 'plant', 'defuse', 'carry', 'dropcharge', 'blast', 'sides', 'medal']);
const EV_NUMS: Record<string, string[]> = {
  kill: [],
  hit: ['a', 'v', 'dmg', 'x', 'y', 'z'],
  shot: ['a', 'x', 'y', 'z', 'dx', 'dy', 'dz'],
  throw: ['a'],
  buy: ['a'],
  phase: [],
  round: ['winner'],
  plant: ['a', 'site'],
  defuse: ['a'],
  carry: ['a'],
  dropcharge: ['x', 'y', 'z'],
  blast: ['x', 'y', 'z'],
  sides: [],
  medal: ['a', 'n'],
};

/** One event from the host, checked field by field (anything off is dropped). */
function parseEv(v: unknown, n: number): Ev | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  const t = typeof e.t === 'string' ? e.t : '';
  const keys = EV_NUMS[t];
  if (!keys) return null;
  for (const k of keys) if (num(e[k]) === null) return null;
  const actor = (k: string) => int(e[k], -1, n - 1) !== null;
  switch (t) {
    case 'kill': {
      const k = e.k as Record<string, unknown> | undefined;
      if (!k || int(k.killer, -1, n - 1) === null || int(k.victim, 0, n - 1) === null || typeof k.head !== 'boolean') return null;
      const w = k.w;
      if (!(typeof w === 'string' && (w === 'frag' || w === 'zone' || w === 'blast' || (WEAPON_IDS as string[]).includes(w)))) return null;
      return { t: 'kill', k: { t: 0, killer: Number(k.killer), victim: Number(k.victim), w: w as WeaponId, head: k.head } };
    }
    case 'hit':
      if (!actor('a') || !actor('v') || !ZONES.includes(e.zone as Zone) || typeof e.kill !== 'boolean' || typeof e.armor !== 'boolean') return null;
      break;
    case 'shot': {
      if (!actor('a') || !(WEAPON_IDS as string[]).includes(e.w as string)) return null;
      if (e.v !== undefined && !(Array.isArray(e.v) && e.v.length % 3 === 0 && e.v.length <= 36 && e.v.every((x) => num(x) !== null))) return null;
      break;
    }
    case 'throw': {
      if (!actor('a') || !NADES.includes(e.kind as NadeKind)) return null;
      const g = e.n as Record<string, unknown> | undefined;
      if (g && !(['x', 'y', 'z', 'vx', 'vy', 'vz', 'fuse'].every((k) => num(g[k]) !== null) && NADES.includes(g.kind as NadeKind))) return null;
      break;
    }
    case 'buy':
      if (!actor('a') || !SHOP_ITEMS.includes(e.item as ShopItem)) return null;
      break;
    case 'phase':
      if (!PHASES.includes(e.phase as Phase)) return null;
      break;
    case 'round':
      if (!WHYS.includes(e.why as Why)) return null;
      break;
    case 'plant':
    case 'defuse':
      if (!actor('a') || typeof e.done !== 'boolean') return null;
      break;
    case 'medal':
      if (!actor('a') || !['first', 'head', 'double', 'triple', 'quad', 'ace', 'clutch'].includes(e.kind as string)) return null;
      break;
  }
  return v as Ev;
}

type Sync = { map: MapId; level: Level; seed: number; roster: RosterEntry[]; tab: Tab; pos: number[]; time: number };

function parseRoster(v: unknown): RosterEntry[] | null {
  if (!Array.isArray(v) || v.length !== 10) return null;
  const out: RosterEntry[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    const seat = int(o.seat, -1, 64);
    if (typeof o.name !== 'string' || seat === null || typeof o.bot !== 'boolean') return null;
    out.push({ name: o.name.slice(0, 20), seat, bot: o.bot });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the session

export type SessionOpts = {
  /** The host's map and bots (a guest learns them from the host). */
  map: MapId;
  level: Level;
  /** The clock, seconds (a test runs its own). */
  now?: () => number;
  botNames?: string[];
};

type Peer = { clock: Clock; track: Track; lastMove: number; budget: { t: number; n: number }[]; epoch: number };
type Hist = { t: number; x: number; y: number; z: number }[];

export class Session {
  match: Match | null = null;
  /** The map to play (a guest learns it from the host's sync). */
  map: MapId | null;
  level: Level;
  private readonly api: OnlineApi;
  private readonly now: () => number;
  private readonly off: () => void;
  private world: World | null = null;
  private botNames: string[];
  // both
  private sync: Sync | null = null;
  private pose = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0 };
  // host
  private peers = new Map<number, Peer>();
  private hist = new Map<number, Hist>();
  private outEv: Ev[] = [];
  private posAt = 0;
  private tabAt = 0;
  private evAt = 0;
  private tabNow = false;
  /** Guests' messages, handled after the frame's step (so what they cause is in the frame's events, sent on and shown). */
  private inbox: { from: number; k: string; pk: Record<string, unknown> }[] = [];
  private seed = (Math.random() * 2 ** 31) >>> 0;
  // guest
  private hostClock = new Clock();
  private tracks: Track[] = [];
  private inEv: Ev[] = [];
  private tab: Tab | null = null;
  private moveAt = 0;
  private helloAt = -10;
  private myEpoch = -1;
  /** Listeners: the map is known (a guest), the session changed who runs the rules. */
  onMap: ((map: MapId) => void) | null = null;

  constructor(api: OnlineApi, opts: SessionOpts) {
    this.api = api;
    this.map = api.isHost ? opts.map : null;
    this.level = opts.level;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
    this.botNames = opts.botNames ?? ['Vega', 'Rook', 'Sable', 'Juno', 'Kite', 'Onyx', 'Mako', 'Pike', 'Ash', 'Bishop'];
    this.off = api.onMessage((from, d) => this.receive(from, d));
    if (!api.isHost) this.hello();
  }

  get isHost() {
    return this.api.isHost;
  }

  dispose() {
    this.off();
  }

  private send(d: Record<string, unknown>, opts?: { to?: number; fast?: boolean }) {
    try {
      this.api.send({ tag: NET_TAG, r: this.api.round, ...d }, opts);
    } catch {
      /* a full or closed channel: the next one tries again */
    }
  }

  private hello() {
    const t = this.now();
    if (t - this.helloAt < 1.5) return;
    this.helloAt = t;
    this.send({ k: 'hello' });
  }

  /** The world is built: the host makes the match, a guest its mirror (once the host's sync is in). */
  attach(world: World): Match | null {
    this.world = world;
    if (this.match) return this.match;
    if (this.api.isHost) this.hostStart(world);
    else if (this.sync) this.build(world, this.sync);
    return this.match;
  }

  // -------------------------------------------------------------------------------------------------------------
  // host

  /** The ten places: people in seat order, alternating teams, bots in the rest. */
  private roster(): RosterEntry[] {
    const humans = [...this.api.players].sort((a, b) => a.seat - b.seat).slice(0, 10);
    const teams: RosterEntry[][] = [[], []];
    humans.forEach((h, i) => teams[i % 2].push({ name: h.name.slice(0, 20), seat: h.seat, bot: false }));
    let k = 0;
    for (const t of teams) while (t.length < 5) t.push({ name: this.botNames[k++ % this.botNames.length], seat: -1, bot: true });
    return [...teams[0], ...teams[1]];
  }

  private hostStart(world: World) {
    const roster = this.roster();
    const m = createMatch(world, 'breach', this.level, { seed: this.seed, roster, mySeat: this.api.seat });
    this.match = m;
    for (const a of m.actors) if (a.remote) this.addPeer(a);
    this.sendSync();
  }

  private addPeer(a: Actor) {
    a.net = { use: false, ads: 0, walking: false, crouch: 0, reloading: false };
    a.lastX = a.body.x;
    a.lastZ = a.body.z;
    this.peers.set(a.seat, { clock: new Clock(), track: new Track(), lastMove: this.now(), budget: [], epoch: a.epoch });
  }

  private rosterOf(m: Match): RosterEntry[] {
    return m.actors.map((a) => ({ name: a.name, seat: a.bot ? -1 : a.seat, bot: a.bot }));
  }

  private sendSync(to?: number) {
    const m = this.match;
    if (!m || !this.map) return;
    const s = { k: 'sync', map: this.map, level: this.level, seed: this.seed, roster: this.rosterOf(m), tab: encodeTab(m), pos: encodePos(m), time: this.now() };
    this.send(s, to === undefined ? {} : { to });
  }

  /** People left or joined the room (the host): a leaver's soldier is a bot from now on. */
  playersChanged(players: readonly { seat: number; name: string }[]) {
    const m = this.match;
    if (!m || !this.api.isHost) return;
    let changed = false;
    for (const a of m.actors) {
      if (!a.remote || players.some((p) => p.seat === a.seat)) continue;
      this.toBot(m, a);
      changed = true;
    }
    if (changed) this.sendSync();
  }

  private toBot(m: Match, a: Actor) {
    a.remote = false;
    a.net = null;
    this.peers.delete(a.seat);
    a.seat = -1;
    a.bot = true;
    a.brain = newBrain(m.level, a.id);
    a.brain.reset = true;
    a.name = `${a.name} (bot)`;
  }

  /** Someone new in the room mid match: they take over a bot on the side with fewer people. */
  private join(from: number) {
    const m = this.match;
    if (!m) return;
    if (m.actors.some((a) => a.seat === from && !a.bot)) return;
    const p = this.api.players.find((x) => x.seat === from);
    if (!p) return;
    const people = [0, 1].map((t) => m.actors.filter((a) => a.team === t && !a.bot).length);
    const order = people[0] <= people[1] ? [0, 1] : [1, 0];
    let a: Actor | undefined;
    for (const t of order) {
      a = m.actors.find((o) => o.team === t && o.bot && !o.alive) ?? m.actors.find((o) => o.team === t && o.bot);
      if (a) break;
    }
    if (!a) return;
    a.bot = false;
    a.brain = null;
    a.remote = true;
    a.seat = from;
    a.name = p.name.slice(0, 20);
    // a new place for the new player's machine to start from
    a.epoch++;
    this.addPeer(a);
    this.sendSync();
  }

  private hostReceive(from: number, k: string, pk: Record<string, unknown>) {
    const m = this.match;
    if (k === 'hello') {
      if (!m) return;
      if (!m.actors.some((a) => a.seat === from)) this.join(from);
      else this.sendSync(from);
      return;
    }
    if (!m) return;
    const a = m.actors.find((o) => o.seat === from && o.remote);
    const peer = this.peers.get(from);
    if (!a || !peer) return;
    const t = this.now();
    if (k === 'mv') {
      const ep = int(pk.ep, 0, 1e6);
      const st = num(pk.t);
      const p = nums(pk.p, 14);
      if (ep === null || st === null || !p || ep !== a.epoch || !a.alive) return;
      const [x, y, z, vx, vy, vz, yaw, pitch, crouch, flags, ads, slot] = p;
      // nothing moves faster than a run, a fall or a lag spike allows
      const last = a.body;
      const gap = Math.max(0.05, t - peer.lastMove);
      if (Math.hypot(x - last.x, z - last.z) > 12 * gap + 4 || Math.abs(x) > 600 || Math.abs(z) > 600 || Math.abs(y) > 400) return;
      peer.lastMove = t;
      peer.clock.feed(st, t);
      peer.track.push({ t: peer.clock.map(st), x, y, z, yaw, pitch, vx, vz });
      last.vy = vy;
      last.onGround = !!(flags & 4);
      last.swim = !!(flags & 8);
      const n = a.net!;
      n.walking = !!(flags & 1);
      n.use = !!(flags & 2);
      n.reloading = !!(flags & 16);
      n.crouch = Math.min(1, Math.max(0, crouch));
      n.ads = Math.min(1, Math.max(0, ads));
      if ((slot === 0 || slot === 1) && a.guns[slot]) a.slot = slot;
      return;
    }
    if (k === 'fire') {
      const w = int(pk.w, 1, WEAPON_IDS.length);
      const o = nums(pk.o, 3);
      const v = pk.v;
      if (w === null || !o || !Array.isArray(v) || v.length % 3 !== 0 || v.length === 0 || v.length > 36 || !v.every((x) => num(x, -5000, 5000) !== null)) return;
      const id = gunOf(w)!;
      if (!a.alive || m.phase === 'buy' || currentGun(a)?.id !== id) return;
      if (Math.hypot(o[0] - a.body.x, o[2] - a.body.z) > 5) return;
      // every shot fired buys its pellets' worth of hits, for a little while
      peer.budget.push({ t, n: v.length / 3 });
      const vel = v as number[];
      for (let i = 0; i < vel.length; i += 3) m.bullets.push({ x: o[0], y: o[1], z: o[2], px: o[0], py: o[1], pz: o[2], vx: vel[i], vy: vel[i + 1], vz: vel[i + 2], owner: a.id, w: id, life: 1.6, dist: 0, live: true, vis: true });
      const l = Math.hypot(vel[0], vel[1], vel[2]) || 1;
      m.events.push({ t: 'shot', a: a.id, w: id, x: o[0], y: o[1], z: o[2], dx: vel[0] / l, dy: vel[1] / l, dz: vel[2] / l, v: vel });
      m.sounds.push({ x: o[0], z: o[2], t: m.time, team: a.team, range: WEAPONS[id].cls === 'sniper' ? 160 : 90, who: a.id });
      a.lastShot = m.time;
      a.shield = 0;
      return;
    }
    if (k === 'hit') {
      const vi = int(pk.v, 0, m.actors.length - 1);
      const zi = int(pk.z, 0, 2);
      const w = int(pk.w, 1, WEAPON_IDS.length);
      const o = nums(pk.o, 3);
      const p = nums(pk.p, 3);
      if (vi === null || zi === null || w === null || !o || !p) return;
      this.judge(m, a, peer, m.actors[vi], ZONES[zi], gunOf(w)!, o, p, t);
      return;
    }
    if (k === 'buy') {
      const item = SHOP_ITEMS.find((s) => s === pk.item);
      if (item) buy(m, a, item);
      return;
    }
    if (k === 'throw') {
      const kind = NADES.find((s) => s === pk.kind);
      const yaw = num(pk.yaw, -10, 10);
      const pitch = num(pk.pitch, -2, 2);
      if (!kind || yaw === null || pitch === null || !a.alive || m.phase !== 'live') return;
      a.yaw = yaw;
      a.pitch = pitch;
      throwFor(m, a, kind);
    }
  }

  /** A guest's hit, checked: alive, an enemy, the gun in hand, a shot fired for it, the shooter where they were, the
   * target near where it was in the last second, and nothing solid between. */
  private judge(m: Match, a: Actor, peer: Peer, v: Actor, zone: Zone, w: WeaponId, o: number[], p: number[], t: number) {
    if (!a.alive || !v.alive || v.team === a.team || m.phase !== 'live') return;
    if (currentGun(a)?.id !== w) return;
    peer.budget = peer.budget.filter((b) => t - b.t < 1.2 && b.n > 0);
    const spend = peer.budget[0];
    if (!spend) return;
    spend.n--;
    if (Math.hypot(o[0] - a.body.x, o[2] - a.body.z) > 5) return;
    const hist = this.hist.get(v.id) ?? [];
    let near = Math.hypot(p[0] - v.body.x, p[2] - v.body.z);
    for (const h of hist) if (t - h.t < 1) near = Math.min(near, Math.hypot(p[0] - h.x, p[2] - h.z));
    if (near > 1.6) return;
    const top = v.body.y + v.body.height + 0.4;
    if (p[1] < v.body.y - 1.2 || p[1] > top + 1.2) return;
    // the line from the muzzle to the hit, stopped just short of it
    const d = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
    if (d > 0.6) {
      const k = (d - 0.4) / d;
      if (!clearLine(m.world, o[0], o[1], o[2], o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k, o[2] + (p[2] - o[2]) * k)) return;
    }
    applyHit(m, a.id, v, w, zone, d, p[0], p[1], p[2]);
  }

  // -------------------------------------------------------------------------------------------------------------
  // guest

  private build(world: World, s: Sync) {
    const m = createMatch(world, 'breach', s.level, { seed: s.seed, roster: s.roster, mySeat: this.api.seat });
    m.authority = false;
    m.net = {
      fire: (w, x, y, z, vel) => this.send({ k: 'fire', w: gunCode(w), o: [r2(x), r2(y), r2(z)], v: vel.map(r2) }),
      hit: (c: Claim) => this.send({ k: 'hit', v: c.v, z: ZONES.indexOf(c.zone), w: gunCode(c.w), o: [r2(c.ox), r2(c.oy), r2(c.oz)], p: [r2(c.x), r2(c.y), r2(c.z)] }),
      buy: (item) => this.send({ k: 'buy', item }),
      throwNade: (kind, yaw, pitch) => this.send({ k: 'throw', kind, yaw: r2(yaw * 10) / 10, pitch: r2(pitch * 10) / 10 }),
    };
    this.match = m;
    this.tracks = m.actors.map(() => new Track());
    this.myEpoch = -1;
    this.applySync(m, s);
  }

  /** The host's whole match laid over the mirror (on joining, and when someone joined or left). */
  private applySync(m: Match, s: Sync) {
    s.roster.forEach((r, i) => {
      const a = m.actors[i];
      a.name = r.name;
      a.seat = r.bot ? -1 : r.seat;
      a.bot = r.bot;
      a.brain = null;
      a.remote = !r.bot && r.seat !== this.api.seat;
      if (!r.bot && r.seat === this.api.seat) m.me = i;
    });
    this.hostClock.feed(s.time, this.now());
    this.applyPos(m, s.pos, s.time);
    this.tab = s.tab;
    this.applyTab(m, true);
  }

  private applyPos(m: Match, p: number[], t: number) {
    const ht = this.hostClock.map(t);
    for (let i = 0; i < m.actors.length; i++) {
      const o = i * POS_N;
      const pose = { t: ht, x: p[o] / 100, y: p[o + 1] / 100, z: p[o + 2] / 100, yaw: p[o + 3] / 1000, pitch: p[o + 4] / 1000, vx: p[o + 5] / 10, vz: p[o + 6] / 10 };
      const a = m.actors[i];
      if (i === m.me) {
        // where the host put me (used when the host moves me, see applyTab)
        this.mine = pose;
        continue;
      }
      this.tracks[i].push(pose);
      const f = p[o + 8];
      a.crouch = p[o + 7] / 100;
      a.walking = !!(f & 4);
      a.ads = f & 8 ? 1 : 0;
      a.reloadT = f & 16 ? Math.max(a.reloadT, 0.3) : 0;
      a.body.onGround = !!(f & 2);
      a.body.swim = !!(f & 32);
    }
  }
  private mine: Pose | null = null;

  /** Health, guns, credits, scores and the round from the latest tab; `full` also takes the charge and the clocks
   * whatever they say (a sync). */
  private applyTab(m: Match, full = false) {
    const tb = this.tab;
    if (!tb) return;
    const me = m.actors[m.me];
    for (let i = 0; i < m.actors.length; i++) {
      const a = m.actors[i];
      const o = i * TAB_N;
      const v = tb.a;
      const alive = v[o + 16] === 1;
      if (a.alive && !alive) {
        a.alive = false;
        a.deathT = m.time;
      }
      a.hp = v[o];
      a.armor = v[o + 1];
      const g0 = gunOf(v[o + 3]);
      const g1 = gunOf(v[o + 4]);
      const epoch = v[o + 5];
      a.credits = v[o + 6];
      a.kills = v[o + 7];
      a.deaths = v[o + 8];
      a.assists = v[o + 9];
      a.cs = v[o + 10];
      a.frags = v[o + 11];
      a.smokes = v[o + 12];
      a.flashes = v[o + 13];
      a.roundKills = v[o + 14];
      a.roundDmg = v[o + 15];
      if (a === me) {
        // put somewhere new by the host (a round start, joining): go there, guns refilled
        if (epoch !== this.myEpoch && this.mine) {
          this.myEpoch = epoch;
          a.epoch = epoch;
          const b = a.body;
          b.x = this.mine.x;
          b.y = this.mine.y;
          b.z = this.mine.z;
          b.vx = b.vy = b.vz = 0;
          a.yaw = this.mine.yaw;
          a.pitch = 0;
          a.alive = alive;
          a.guns = [g0 ? gun(g0) : null, g1 ? gun(g1) : null, null];
          a.slot = a.guns[0] ? 0 : 1;
          a.reloadT = a.switchT = a.blindT = 0;
          a.lastX = b.x;
          a.lastZ = b.z;
        } else {
          // bought, or lost a gun: take the host's loadout, keeping the rounds left in a gun still held
          for (const [k, id] of [
            [0, g0],
            [1, g1],
          ] as const) {
            if ((a.guns[k]?.id ?? null) !== id) a.guns[k] = id ? gun(id) : null;
          }
          if (alive && !a.alive) a.alive = true;
        }
      } else {
        a.slot = (v[o + 2] === 0 || v[o + 2] === 1 ? v[o + 2] : 1) as 0 | 1;
        if ((a.guns[0]?.id ?? null) !== g0) a.guns[0] = g0 ? gun(g0) : null;
        if ((a.guns[1]?.id ?? null) !== g1) a.guns[1] = g1 ? gun(g1) : null;
        a.blindT = v[o + 17] / 10;
        if (alive && !a.alive) {
          a.alive = true;
          a.epoch = epoch;
          this.tracks[i].clear();
        }
        if (epoch !== a.epoch) {
          // moved somewhere new: no sliding across the map from the old place
          a.epoch = epoch;
          this.tracks[i].clear();
        }
      }
    }
    // the round
    if (full || m.phase !== tb.phase) m.phase = tb.phase;
    if (full || Math.abs(m.phaseT - tb.phaseT) > 0.3 || m.round !== tb.round) m.phaseT = tb.phaseT;
    m.round = tb.round;
    m.score = [tb.score[0], tb.score[1]];
    m.attack = tb.attack;
    m.aim = tb.aim;
    m.winner = tb.winner;
    m.last = tb.last;
    const c = m.charge;
    const ch = tb.charge;
    c.state = CHARGE_STATES[ch[0]] ?? 'carried';
    c.holder = ch[1];
    c.x = ch[2];
    c.y = ch[3];
    c.z = ch[4];
    c.site = ch[5];
    if (full || Math.abs(c.fuse - ch[6]) > 0.3) c.fuse = ch[6];
    c.plantBy = ch[7];
    c.plantT = ch[8];
    c.defuseBy = ch[9];
    c.defuseT = ch[10];
    c.defuseKept = ch[11];
  }

  /** A host's events on a guest: what they change here (deaths, others' shots and grenades), then into the frame's
   * events for the screen and the sound. */
  private applyEvent(m: Match, e: Ev) {
    switch (e.t) {
      case 'kill': {
        const v = m.actors[e.k.victim];
        if (v) {
          if (v.alive) v.deathT = m.time;
          v.alive = false;
          v.hp = 0;
          v.killer = e.k.killer;
          v.killedWith = e.k.w;
          v.killedHead = e.k.head;
        }
        e.k.t = m.time;
        m.feed.push(e.k);
        if (m.feed.length > 8) m.feed.shift();
        break;
      }
      case 'shot': {
        if (e.a === m.me) return;
        const a = m.actors[e.a];
        if (a) a.lastShot = m.time;
        const v = e.v ?? [e.dx * 900, e.dy * 900, e.dz * 900];
        for (let i = 0; i + 2 < v.length; i += 3) m.bullets.push({ x: e.x, y: e.y, z: e.z, px: e.x, py: e.y, pz: e.z, vx: v[i], vy: v[i + 1], vz: v[i + 2], owner: e.a, w: e.w, life: 1.6, dist: 0, live: true, vis: true });
        break;
      }
      case 'throw':
        if (e.a === m.me) return;
        if (e.n) m.nades.push({ ...e.n, owner: e.a, rest: false, spin: 0 });
        break;
      case 'hit':
        // my own hits were marked when I made them; the host's word only adds the kill
        if (e.a === m.me && !e.kill) return;
        break;
      case 'blast':
        m.events.push({ t: 'boom', x: e.x, y: e.y, z: e.z });
        break;
      case 'phase':
        m.phase = e.phase;
        break;
    }
    m.events.push(e);
  }

  /** Each frame, before the rules step: where everyone shown on this machine is. */
  before(m: Match) {
    const t = this.now();
    if (this.api.isHost) {
      // remote players: drawn (and judged) a little in the past, smoothly
      for (const a of m.actors) {
        if (!a.remote || !a.alive) continue;
        const peer = this.peers.get(a.seat);
        if (!peer) continue;
        // put somewhere new by the rules (a round start): forget where they were before
        if (peer.epoch !== a.epoch) {
          peer.epoch = a.epoch;
          peer.track.clear();
          a.lastX = a.body.x;
          a.lastZ = a.body.z;
        }
        if (!peer.track.sample(t - DELAY, this.pose)) continue;
        this.placeBody(a, this.pose);
      }
      return;
    }
    if (!this.hostClock.ready) return;
    if (this.tab) this.applyTab(m);
    for (let i = 0; i < m.actors.length; i++) {
      if (i === m.me) continue;
      const a = m.actors[i];
      if (!this.tracks[i]?.sample(t - DELAY, this.pose)) continue;
      this.placeBody(a, this.pose);
    }
  }

  private placeBody(a: Actor, p: Pose) {
    const b = a.body;
    b.x = p.x;
    b.y = p.y;
    b.z = p.z;
    b.vx = p.vx;
    b.vz = p.vz;
    a.yaw = p.yaw;
    a.pitch = p.pitch;
  }

  /** Each frame, after the rules step: send what is due, and (a guest) take in what the host said. */
  after(m: Match) {
    const t = this.now();
    if (this.api.isHost) {
      const box = this.inbox;
      this.inbox = [];
      for (const x of box) this.hostReceive(x.from, x.k, x.pk);
      for (const a of m.actors) {
        const h = this.hist.get(a.id) ?? [];
        h.push({ t, x: a.body.x, y: a.body.y, z: a.body.z });
        while (h.length && t - h[0].t > 1.1) h.shift();
        this.hist.set(a.id, h);
      }
      for (const e of m.events) {
        if (!SHARED.has(e.t)) continue;
        this.outEv.push(e);
        if (e.t === 'phase' || e.t === 'round' || e.t === 'kill' || e.t === 'plant' || e.t === 'defuse' || e.t === 'carry' || e.t === 'dropcharge') this.tabNow = true;
      }
      if (this.outEv.length && t - this.evAt >= EV_EVERY) {
        this.evAt = t;
        // in pieces well under the room's message limit
        for (let i = 0; i < this.outEv.length; i += 12) this.send({ k: 'ev', e: this.outEv.slice(i, i + 12) });
        this.outEv = [];
      }
      if (t - this.posAt >= POS_EVERY) {
        this.posAt = t;
        this.send({ k: 'pos', t, p: encodePos(m) }, { fast: true });
      }
      if (this.tabNow || t - this.tabAt >= TAB_EVERY) {
        this.tabNow = false;
        this.tabAt = t;
        this.send({ k: 'tab', t, s: encodeTab(m) }, { fast: true });
      }
      return;
    }
    if (!this.match) {
      this.hello();
      return;
    }
    for (const e of this.inEv) this.applyEvent(m, e);
    this.inEv = [];
    const me = m.actors[m.me];
    if (me.alive && t - this.moveAt >= MOVE_EVERY) {
      this.moveAt = t;
      const b = me.body;
      const flags = (me.walking ? 1 : 0) | (this.using ? 2 : 0) | (b.onGround ? 4 : 0) | (b.swim ? 8 : 0) | (me.reloadT > 0 ? 16 : 0);
      this.send({ k: 'mv', t, ep: this.myEpoch < 0 ? me.epoch : this.myEpoch, p: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), Math.round(wrap(me.yaw) * 1000) / 1000, Math.round(me.pitch * 1000) / 1000, r2(me.crouch), flags, r2(me.ads), me.slot, 0, 0] }, { fast: true });
    }
  }
  /** Whether the use key is held this frame (planting or defusing is judged by the host). */
  using = false;

  // -------------------------------------------------------------------------------------------------------------
  // receiving

  private receive(from: number, d: unknown) {
    if (!d || typeof d !== 'object') return;
    const pk = d as Record<string, unknown>;
    if (pk.tag !== NET_TAG || pk.r !== this.api.round || typeof pk.k !== 'string') return;
    if (this.api.isHost) {
      if (from === this.api.seat) return;
      // a new player is answered at once; the rest waits for the frame
      if (pk.k === 'hello') this.hostReceive(from, pk.k, pk);
      else if (this.inbox.length < 2048) this.inbox.push({ from, k: pk.k, pk });
      return;
    }
    if (from !== 0) return;
    const n = 10;
    switch (pk.k) {
      case 'sync': {
        const map = MAP_IDS.find((x) => x === pk.map);
        const level = (['easy', 'normal', 'hard'] as Level[]).find((x) => x === pk.level);
        const seed = int(pk.seed, 0, 2 ** 32);
        const roster = parseRoster(pk.roster);
        const tab = parseTab(pk.tab, n);
        const pos = nums(pk.pos, n * POS_N);
        const time = num(pk.time);
        if (!map || !level || seed === null || !roster || !tab || !pos || time === null) return;
        const s: Sync = { map, level, seed, roster, tab, pos, time };
        this.sync = s;
        this.seed = seed;
        if (!this.map) {
          this.map = map;
          this.level = level;
          this.onMap?.(map);
        }
        if (this.match) this.applySync(this.match, s);
        else if (this.world && this.world.id === map) this.build(this.world, s);
        break;
      }
      case 'pos': {
        const t = num(pk.t);
        const p = nums(pk.p, n * POS_N);
        if (t === null || !p) return;
        this.hostClock.feed(t, this.now());
        if (this.match) this.applyPos(this.match, p, t);
        break;
      }
      case 'tab': {
        const s = parseTab(pk.s, n);
        if (s) this.tab = s;
        break;
      }
      case 'ev': {
        if (!Array.isArray(pk.e) || !this.match) return;
        for (const v of pk.e.slice(0, 64)) {
          const e = parseEv(v, n);
          if (e) this.inEv.push(e);
        }
        if (this.inEv.length > 512) this.inEv.splice(0, this.inEv.length - 512);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // the host leaving

  /** The host left and the room renumbered two seats (`from` is now 0, the old 0 is `from`). If this machine is the
   * host now, its mirror takes over the rules: people still here stay people, everyone else becomes a bot. */
  handOff(from: number) {
    const m = this.match;
    if (!m) return;
    const seat = (s: number) => (s === from ? 0 : s === 0 ? from : s);
    for (const a of m.actors) if (a.seat >= 0) a.seat = seat(a.seat);
    if (!this.api.isHost) {
      // the new host will send everything again
      this.hostClock = new Clock();
      for (const t of this.tracks) t.clear();
      return;
    }
    m.authority = true;
    m.net = null;
    for (const a of m.actors) {
      a.lastX = a.body.x;
      a.lastZ = a.body.z;
      if (a.id === m.me) {
        a.remote = false;
        a.bot = false;
        a.seat = this.api.seat;
        continue;
      }
      const here = a.seat >= 0 && this.api.players.some((p) => p.seat === a.seat);
      if (here) {
        a.remote = true;
        a.bot = false;
        a.brain = null;
        this.addPeer(a);
      } else if (!a.bot || !a.brain) {
        a.remote = false;
        a.net = null;
        if (!a.bot) a.name = `${a.name} (bot)`;
        a.bot = true;
        a.seat = -1;
        a.brain = newBrain(m.level, a.id);
        a.brain.reset = true;
      }
    }
    this.sendSync();
  }

  /** Everyone else left (the host): play on against the bots, offline. */
  detach() {
    const m = this.match;
    if (!m) return;
    m.authority = true;
    m.net = null;
    for (const a of m.actors) if (a.remote) this.toBot(m, a);
  }

  /** Online result: the people on the winning team (the lowest seat stands for them), or nobody. */
  result(): { winner: number | null; team: number[] } {
    const m = this.match;
    if (!m || m.winner < 0) return { winner: null, team: [] };
    const team = m.actors.filter((a) => a.team === m.winner && !a.bot && a.seat >= 0).map((a) => a.seat);
    team.sort((a, b) => a - b);
    return { winner: team[0] ?? null, team };
  }
}
