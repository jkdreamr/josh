// Online: a room of up to ten people, bots in the empty places, in any of the three modes (the 5v5 breach, a
// deathmatch, or a royale of a hundred). The room is a star around the host, whose game runs the rules and the bots;
// each guest moves its own soldier on its own machine (so its controls never wait on the network) and keeps a mirror
// of the rest.
//
// What travels:
//   guest -> host   mv     its soldier, about 30 times a second (fast, newest wins); in a royale also its drop, the
//                          rounds in its guns and loaded from its pockets, and the vehicle it drives
//                   fire   each shot it fires (so everyone sees it), with the bullets' flight
//                   hit    a hit its own bullet made on what it saw; the host checks it (the weapon held, shots fired
//                          and not used up, where the shooter and the target were over the last second, a clear line)
//                          and only then does the damage
//                   buy, throw, hello (send me everything; again once its world is built, `ready`)
//                   royale: pick (an item), heal (a heal or boost, or none), ride (a vehicle, or out), crash (the
//                          vehicle it drives hit something hard), spec (who it watches once out), inv (what it carries,
//                          once, to a new host)
//   host -> guests  pos    where everyone is, 20 times a second (fast)
//                   tab    everything else that changes (health, guns, credits, scores, the round, the charge), 5
//                          times a second and at once when the round changes (fast; each one complete)
//                   ev     what happened (shots, kills, hits, the round's events), batched (reliable)
//                   sync   the whole match, on joining and when the roster changes
//   A royale's hundred would not fit, so there each guest is sent its own: pos holds those near the one it looks out
//   of 20 times a second, those further off less and less often, and nobody who is out, aboard the transport or in a
//   vehicle (the vehicle carries them); rt (its tab) the zone, the transport, the bombardment, the crates, the
//   vehicles' seats and health, and its own soldier's pockets; ev only what happened near it (and every knockout).
//   Everyone gets bd (who is still in, their drop, kills and places) once a second, and loot (what was taken or put
//   down, reliable, in order); a guest just in gets lall, the loot as it stands now.
// Everyone else on a guest is drawn a tenth of a second in the past from a short history of the host's positions, on
// a clock mapped to the host's, so late or bunched packets never turn into stop and go. Players who leave become bots;
// someone joining mid match takes over a bot (breach: on the team with fewer people); if the host leaves, the next
// host's game (a mirror until then) takes over the rules from where they stood.
// Pure (no DOM), so it runs under node.
import { newBrain } from './bots.ts';
import { CAR_REACH, crashHurt, enterCar, hullDist, leaveCar } from './cars.ts';
import { clearLine } from './physics.ts';
import {
  applyHit,
  buy,
  canUse,
  createMatch,
  currentGun,
  RESPAWN,
  gun,
  jumpOut,
  pickupFor,
  startHeal,
  throwFor,
  type Actor,
  type Cause,
  type Claim,
  type Ev,
  type Gun,
  type Level,
  type Match,
  type Mode,
  type NadeKind,
  type Phase,
  type RosterEntry,
  type ShopItem,
  type Why,
  type Zone,
} from './match.ts';
import { MAP_IDS, type MapId } from './maps.ts';
import { AMMO_KINDS, AMMO_OF, AMMO_PACK, magOf, spawnLoot, type ItemKind, type Mods, type UseKind } from './royale.ts';
import { WEAPONS, WEAPON_IDS, type WeaponId } from './weapons.ts';
import { ARENA, type World } from './world.ts';

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
/** Royale: the board's beat, and how far from the one a guest looks out of (metres) it hears of shots and the like. */
const BOARD_EVERY = 1;
const HEAR = 300;
/** A royale's places. */
const ROYALE_LIMIT = 100;

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

const MODES: Mode[] = ['breach', 'dm', 'royale'];
const PHASES: Phase[] = ['buy', 'live', 'end', 'over'];
const CHARGE_STATES = ['carried', 'dropped', 'planted', 'defused', 'blown'] as const;
const WHYS: Why[] = ['elim', 'time', 'blast', 'defuse'];
const ZONES: Zone[] = ['head', 'body', 'leg'];
const NADES: NadeKind[] = ['frag', 'smoke', 'flash'];
const SHOP_ITEMS: ShopItem[] = [...WEAPON_IDS, 'light', 'heavy', 'frag', 'smoke', 'flash'];
const USES: UseKind[] = ['bandage', 'kit', 'drink', 'pills'];
const ITEM_KINDS: ItemKind[] = ['gun', 'ammo', 'vest', 'helmet', 'heal', 'nade', 'pack', 'boost', 'att'];
const SIGHTS = [null, 'dot', 'x4'] as const;
const CAUSES: string[] = ['frag', 'zone', 'blast', 'shell', 'car', ...WEAPON_IDS];
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
/** A flat list of numbers in whole records of `each` (at most `max` records). */
const rows = (v: unknown, each: number, max: number): number[] | null => {
  if (!Array.isArray(v) || v.length % each !== 0 || v.length > each * max) return null;
  for (const x of v) if (num(x) === null) return null;
  return v as number[];
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Everyone's place: 9 numbers each. */
const POS_N = 9;
/** Everything else about each of them: 19 numbers each. */
const TAB_N = 19;

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
  /** Deathmatch: the match clock. */
  clock?: number;
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
      gunCode(o.guns[2]?.id),
    );
  const t: Tab = {
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
  if (m.mode === 'dm') t.clock = r2(m.clock);
  return t;
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
  const winner = int(o.winner, -1, n - 1);
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
  const t: Tab = { phase, phaseT, round, score: [score[0], score[1]], attack, aim, winner, last, charge, a };
  const clock = num(o.clock, 0, 1e5);
  if (clock !== null) t.clock = clock;
  return t;
}

/** The events a guest is told about (the rest it makes itself: its own footsteps, impacts, grenades in flight). */
const SHARED = new Set(['kill', 'hit', 'shot', 'throw', 'buy', 'phase', 'round', 'plant', 'defuse', 'carry', 'dropcharge', 'blast', 'sides', 'medal', 'spawn']);
/** Royale: told to everyone; told to the one it happened to; told to those near enough to hear it. */
const R_ALL = new Set(['kill', 'phase', 'zone', 'supply', 'redzone']);
const R_OWN = new Set(['pickup', 'heal']);
const R_NEAR = new Set(['hit', 'shot', 'throw', 'shell', 'crash', 'car']);
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
  spawn: ['a'],
  zone: ['i'],
  supply: ['x', 'z'],
  redzone: ['x', 'z', 'r'],
  shell: ['x', 'y', 'z'],
  crash: ['x', 'y', 'z', 'v'],
  car: ['a', 'car'],
  heal: ['a'],
  pickup: ['a'],
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
      if (!(typeof w === 'string' && CAUSES.includes(w))) return null;
      return { t: 'kill', k: { t: 0, killer: Number(k.killer), victim: Number(k.victim), w: w as Cause, head: k.head } };
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
    case 'spawn':
      if (!actor('a')) return null;
      break;
    case 'zone':
      return typeof e.shrinking === 'boolean' ? { t: 'zone', i: Number(e.i), shrinking: e.shrinking } : null;
    case 'supply':
      return typeof e.landed === 'boolean' ? { t: 'supply', x: Number(e.x), z: Number(e.z), landed: e.landed } : null;
    case 'redzone':
      return e.stage === 'warn' || e.stage === 'live' || e.stage === 'clear' ? { t: 'redzone', x: Number(e.x), z: Number(e.z), r: Number(e.r), stage: e.stage } : null;
    case 'car':
      if (!actor('a') || typeof e.on !== 'boolean') return null;
      break;
    case 'heal':
      if (!actor('a') || typeof e.done !== 'boolean') return null;
      break;
    case 'pickup': {
      const it = e.item as Record<string, unknown> | undefined;
      if (!actor('a') || !it || !ITEM_KINDS.includes(it.kind as ItemKind) || typeof it.what !== 'string' || it.what.length > 12 || num(it.n) === null) return null;
      return { t: 'pickup', a: Number(e.a), item: { id: -1, kind: it.kind as ItemKind, what: it.what, n: Number(it.n), x: 0, y: 0, z: 0, live: false, mods: parseMods(it.mods) } };
    }
  }
  return v as Ev;
}

function parseMods(v: unknown): Mods | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const sight = o.sight === 'dot' || o.sight === 'x4' ? o.sight : null;
  return { sight, ext: o.ext === true, comp: o.comp === true };
}

type Sync = { mode: Mode; map: MapId; level: Level; seed: number; roster: RosterEntry[]; tab: Tab | null; pos: number[] | null; time: number; n: number; sparse: [number, number, string, boolean][] | null };

function parseRoster(v: unknown, lo: number, hi: number): RosterEntry[] | null {
  if (!Array.isArray(v) || v.length < lo || v.length > hi) return null;
  const out: RosterEntry[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    const seat = int(o.seat, -1, 64);
    if (typeof o.name !== 'string' || seat === null || typeof o.bot !== 'boolean') return null;
    const e: RosterEntry = { name: o.name.slice(0, 24), seat, bot: o.bot };
    if ((WEAPON_IDS as unknown[]).includes(o.pick)) e.pick = o.pick as WeaponId;
    out.push(e);
  }
  return out;
}

/** A royale's roster: only the places that are not the bot the seed made (people, and people turned bots). */
function parseSparse(v: unknown, n: number): [number, number, string, boolean][] | null {
  if (!Array.isArray(v) || v.length > 64) return null;
  const out: [number, number, string, boolean][] = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 4) return null;
    const i = int(r[0], 0, n - 1);
    const seat = int(r[1], -1, 64);
    if (i === null || seat === null || typeof r[2] !== 'string' || typeof r[3] !== 'boolean') return null;
    out.push([i, seat, r[2].slice(0, 24), r[3]]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// royale packets

/** Someone in a royale pos: id, place, look, speed, crouch, flags, the gun in hand (code * 4 + slot), health. */
const RP_N = 12;
/** A vehicle in a royale pos: id, place, heading and tilt, velocity, speed and steering. */
const CP_N = 11;
/** How far from the one a guest looks out of someone is, and how often (in pos beats) they are sent that far off. */
const NEAR = 70;
const MID = 180;
const FAR = 450;
const beatsAt = (d: number) => (d < NEAR ? 1 : d < MID ? 2 : d < FAR ? 8 : 40);

/** The world in a royale tab: the phase, the clock, who is left and who won, the zone, the transport and the
 * bombardment's countdown. */
const RG_N = 19;
/** A guest's own soldier in its royale tab (see encodeMe). */
const ME_N = 54;
/** A vehicle's state in a royale tab: health, whole, flooded, and who sits in each of four seats. */
const RC_N = 7;

function encodeWorld(m: Match): number[] {
  const z = m.zone!;
  return [PHASES.indexOf(m.phase), r2(m.time), m.alive, m.winner, z.i, r2(z.t), z.shrinking ? 1 : 0, r2(z.x), r2(z.z), r2(z.r), r2(z.fx), r2(z.fz), r2(z.fr), r2(z.nx), r2(z.nz), r2(z.nr), z.dps, m.plane ? 1 : 0, r2(m.redT)];
}

function encodeCars(m: Match): number[] {
  const out: number[] = [];
  for (const c of m.cars) out.push(Math.round(c.hp), c.alive ? 1 : 0, c.flooded ? 1 : 0, c.seats[0] ?? -1, c.seats[1] ?? -1, c.seats[2] ?? -1, c.seats[3] ?? -1);
  return out;
}

/** What the guest needs of its own soldier: health and pockets, the drop, the place, the vehicle, where the host put
 * it (taken only when the epoch moves on), its scores, and its guns with what is fitted. `spent` is how many rounds the
 * host has taken from its pockets for what it loaded (so the guest counts the rest itself). */
function encodeMe(a: Actor, spent: number[]): number[] {
  const out = [
    Math.round(a.hp * 10) / 10,
    Math.round(a.armor),
    a.vest,
    a.helmet,
    a.pack,
    a.bandages,
    a.kits,
    a.drinks,
    a.pills,
    r2(a.boost),
    a.healKind ? USES.indexOf(a.healKind) : -1,
    r2(Math.max(0, a.healT)),
    a.frags,
    a.smokes,
  ];
  for (const k of AMMO_KINDS) out.push(a.ammo[k]);
  for (let k = 0; k < 5; k++) out.push(spent[k] ?? 0);
  out.push(a.drop, a.place, a.car, a.carSeat, a.epoch, r2(a.body.x), r2(a.body.y), r2(a.body.z), Math.round(wrap(a.yaw) * 1000) / 1000, a.kills, a.deaths, Math.round(a.damage), Math.round(a.cs), a.alive ? 1 : 0, a.slot);
  for (const g of a.guns) out.push(gunCode(g?.id), g?.mag ?? 0, g?.mods?.sight ? SIGHTS.indexOf(g.mods.sight) : 0, g?.mods?.ext ? 1 : 0, g?.mods?.comp ? 1 : 0);
  return out;
}

/** A gun from a royale tab's numbers (null for none or nonsense). */
function gunFrom(v: number[], o: number): Gun | null {
  const id = gunOf(v[o]);
  if (!id) return null;
  const sight = SIGHTS[v[o + 2]] ?? null;
  const mods: Mods | null = sight || v[o + 3] || v[o + 4] ? { sight, ext: !!v[o + 3], comp: !!v[o + 4] } : null;
  const g: Gun = { id, mag: 0, reserve: 0, fresh: false, mods };
  g.mag = Math.max(0, Math.min(magOf(g), Math.round(v[o + 1])));
  return g;
}
const sameMods = (a: Mods | null | undefined, b: Mods | null | undefined) => (a?.sight ?? null) === (b?.sight ?? null) && !!a?.ext === !!b?.ext && !!a?.comp === !!b?.comp;

type RTab = { t: number; g: number[]; me: number[]; red: number[] | null; s: number[]; c: number[] | null };
type Board = { al: string; kl: number[]; pl: number[] };

/** Loot changes: [id, count, still there] each, and new items [id, kind, what, count, x, y, z, still there, put down
 * by, sight, ext, comp]. */
type LootMsg = { u: number[]; a: unknown[][] };
const LA_N = 12;

function encodeItem(m: Match, i: number): unknown[] {
  const it = m.loot[i];
  return [i, ITEM_KINDS.indexOf(it.kind), it.what, it.n, r2(it.x), r2(it.y), r2(it.z), it.live ? 1 : 0, it.by ?? -1, it.mods?.sight ? SIGHTS.indexOf(it.mods.sight) : 0, it.mods?.ext ? 1 : 0, it.mods?.comp ? 1 : 0];
}

function parseLoot(pk: Record<string, unknown>): LootMsg | null {
  const u = rows(pk.u, 3, 4000);
  if (!u || !Array.isArray(pk.a) || pk.a.length > 400) return null;
  for (const r of pk.a) {
    if (!Array.isArray(r) || r.length !== LA_N || typeof r[2] !== 'string' || r[2].length > 12) return null;
    for (let k = 0; k < LA_N; k++) if (k !== 2 && num(r[k]) === null) return null;
    if (!ITEM_KINDS[r[1] as number] || (r[0] as number) < 0 || (r[0] as number) > 20000) return null;
  }
  return { u, a: pk.a as unknown[][] };
}

/** The loot a royale starts with (as createMatch lays it out), to tell a guest just in only what has changed since. */
function baseLoot(world: World, seed: number): { n: Int32Array; live: Uint8Array } {
  const loot = spawnLoot(world, seed);
  const n = new Int32Array(loot.length);
  const live = new Uint8Array(loot.length);
  loot.forEach((it, i) => {
    n[i] = it.kind === 'gun' ? WEAPONS[it.what as WeaponId].mag : it.n;
    live[i] = 1;
  });
  return { n, live };
}

// ---------------------------------------------------------------------------------------------------------------
// the session

export type SessionOpts = {
  /** The host's mode, map and bots (a guest learns them from the host). */
  mode?: Mode;
  map: MapId;
  level: Level;
  /** The deathmatch gun this player wants. */
  dmPick?: WeaponId;
  /** The clock, seconds (a test runs its own). */
  now?: () => number;
  botNames?: string[];
  /** The match's seed (a test fixes it; otherwise a fresh one). */
  seed?: number;
};

type Peer = {
  clock: Clock;
  track: Track;
  lastMove: number;
  budget: { t: number; n: number }[];
  epoch: number;
  /** Royale: who its player watches once out, the rounds taken from its pockets so far, the vehicle it was in, that
   * vehicle's track while it drives, its own events, and whether it has told a new host what it carries. */
  focus: number;
  spent: number[];
  car: number;
  carTrack: Track;
  out: Ev[];
  inv: boolean;
  /** Royale: the drop its machine last said it was in. */
  drop: number;
};

/** Hit history: where each actor was, 20 times a second over the last 1.2 seconds (t, x, y, z). */
const HIST = 24;

export class Session {
  match: Match | null = null;
  /** The mode and map to play (a guest learns them from the host's sync). */
  mode: Mode | null;
  map: MapId | null;
  level: Level;
  private readonly api: OnlineApi;
  private readonly now: () => number;
  private readonly off: () => void;
  private world: World | null = null;
  private botNames: string[];
  private dmPick: WeaponId | null;
  // both
  private sync: Sync | null = null;
  private pose = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0 };
  /** The names the seed gave each place (royale: the roster sent is only what differs). */
  private names0: string[] = [];
  // host
  private peers = new Map<number, Peer>();
  private hist: Float64Array | null = null;
  private histN = 0;
  private histAt = -1;
  private outEv: Ev[] = [];
  private posAt = 0;
  private tabAt = 0;
  private evAt = 0;
  private boardAt = 0;
  private tabNow = false;
  private boardNow = false;
  private beat = 0;
  private carsSig = '';
  private carsAt = -9;
  /** The people's deathmatch guns (from their hello). */
  private picks = new Map<number, WeaponId>();
  /** Royale loot: as it started, and as last sent. */
  private lootBase: { n: Int32Array; live: Uint8Array } | null = null;
  private lootSent = { n: new Int32Array(0), live: new Uint8Array(0), len: 0, ver: -1 };
  /** Guests' messages, handled after the frame's step (so what they cause is in the frame's events, sent on and shown). */
  private inbox: { from: number; k: string; pk: Record<string, unknown> }[] = [];
  private seed = (Math.random() * 2 ** 31) >>> 0;
  // guest
  private hostClock = new Clock();
  private tracks: Track[] = [];
  private carTracks: Track[] = [];
  private inEv: Ev[] = [];
  private tab: Tab | null = null;
  private tabT = 0;
  private mine: Pose | null = null;
  private mineT = -1;
  /** Per actor: the host's time it was last put somewhere new (older places that turn up late are not drawn). */
  private cut: number[] = [];
  private moveAt = 0;
  private kitAt = -9;
  private kitSig = '';
  private helloAt = -10;
  private myEpoch = -1;
  private rt: RTab | null = null;
  private bd: Board | null = null;
  private lootQ: LootMsg[] = [];
  private lootOn = false;
  /** Royale: rounds loaded from the pockets so far (the host takes them off its count), and requests not yet answered. */
  private spent = [0, 0, 0, 0, 0];
  private asked = new Map<number, number>();
  private rideAt = -9;
  private healAt = -9;
  private specAt = -9;
  private built = false;
  /** Listeners: the map and mode are known (a guest). */
  onMap: ((map: MapId, mode: Mode) => void) | null = null;
  /** The actor this machine's view watches (a royale guest out of it tells the host, which sends what is near them). */
  watch = -1;
  /** Whether the use key is held this frame (planting or defusing is judged by the host). */
  using = false;

  constructor(api: OnlineApi, opts: SessionOpts) {
    this.api = api;
    this.map = api.isHost ? opts.map : null;
    this.mode = api.isHost ? (opts.mode ?? 'breach') : null;
    this.level = opts.level;
    this.dmPick = opts.dmPick ?? null;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
    if (opts.seed !== undefined) this.seed = opts.seed >>> 0;
    this.botNames = opts.botNames ?? ['Vega', 'Rook', 'Sable', 'Juno', 'Kite', 'Onyx', 'Mako', 'Pike', 'Ash', 'Bishop'];
    this.off = api.onMessage((from, d) => this.receive(from, d));
    if (!api.isHost) this.hello();
  }

  get isHost() {
    return this.api.isHost;
  }

  /** A guest still waiting for the host's match asks again now and then (call it on a timer until there is one). */
  wait() {
    if (!this.api.isHost && !this.match) this.hello();
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

  private hello(force = false) {
    const t = this.now();
    if (!force && t - this.helloAt < 1.5) return;
    this.helloAt = t;
    this.send({ k: 'hello', pick: this.dmPick, ready: this.built });
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

  /** The places: breach ten, people in seat order alternating teams; a deathmatch the people and bots up to eight; a
   * royale the people first (the seed fills in the rest). */
  private roster(): RosterEntry[] {
    const humans = [...this.api.players].sort((a, b) => a.seat - b.seat).slice(0, 10);
    if (this.mode === 'breach') {
      const teams: RosterEntry[][] = [[], []];
      humans.forEach((h, i) => teams[i % 2].push({ name: h.name.slice(0, 20), seat: h.seat, bot: false }));
      let k = 0;
      for (const t of teams) while (t.length < 5) t.push({ name: this.botNames[k++ % this.botNames.length], seat: -1, bot: true });
      return [...teams[0], ...teams[1]];
    }
    const out: RosterEntry[] = humans.map((h) => {
      const e: RosterEntry = { name: h.name.slice(0, 20), seat: h.seat, bot: false };
      const pick = h.seat === this.api.seat ? this.dmPick : this.picks.get(h.seat);
      if (pick) e.pick = pick;
      return e;
    });
    let k = 0;
    if (this.mode === 'dm') while (out.length < 8) out.push({ name: this.botNames[k++ % this.botNames.length], seat: -1, bot: true });
    return out;
  }

  private hostStart(world: World) {
    const roster = this.roster();
    const m = createMatch(world, this.mode ?? 'breach', this.level, { seed: this.seed, roster, mySeat: this.api.seat });
    this.match = m;
    this.built = true;
    this.names0 = m.actors.map((a) => a.name);
    for (const a of m.actors) if (a.remote) this.addPeer(a);
    if (m.mode === 'royale') {
      this.lootBase = baseLoot(world, this.seed);
      this.markLootSent(m);
    }
    this.sendSync();
  }

  private addPeer(a: Actor) {
    a.net = { use: false, ads: 0, walking: false, crouch: 0, reloading: false };
    a.lastX = a.body.x;
    a.lastZ = a.body.z;
    this.peers.set(a.seat, { clock: new Clock(), track: new Track(), lastMove: this.now(), budget: [], epoch: a.epoch, focus: -1, spent: [0, 0, 0, 0, 0], car: a.car, carTrack: new Track(), out: [], inv: true, drop: a.drop });
  }

  private rosterOf(m: Match): RosterEntry[] {
    return m.actors.map((a) => ({ name: a.name, seat: a.bot ? -1 : a.seat, bot: a.bot }));
  }

  private sparseOf(m: Match): [number, number, string, boolean][] {
    const out: [number, number, string, boolean][] = [];
    for (const a of m.actors) if (!a.bot || a.name !== this.names0[a.id]) out.push([a.id, a.bot ? -1 : a.seat, a.name, a.bot]);
    return out;
  }

  private sendSync(to?: number) {
    const m = this.match;
    if (!m || !this.map) return;
    const opts = to === undefined ? {} : { to };
    if (m.mode === 'royale') {
      this.send({ k: 'sync', mode: m.mode, map: this.map, level: this.level, seed: this.seed, ros: this.sparseOf(m), time: this.now() }, opts);
      return;
    }
    this.send({ k: 'sync', mode: m.mode, map: this.map, level: this.level, seed: this.seed, roster: this.rosterOf(m), tab: encodeTab(m), pos: encodePos(m), time: this.now() }, opts);
  }

  /** A royale guest whose world is built: everything it needs to start from (after the sync). */
  private sendRoyaleStart(m: Match, seat: number) {
    const t = this.now();
    this.carsSig = '';
    const peer = this.peers.get(seat);
    const a = m.actors.find((o) => o.seat === seat && !o.bot);
    if (peer && a) this.send({ k: 'rt', ...this.encodeRT(m, a, peer, t, true) }, { to: seat });
    this.send({ k: 'bd', t, ...this.encodeBoard(m) }, { to: seat });
    // where everyone is, in pieces
    const all: number[] = [];
    for (const o of m.actors) if (o.alive && o.drop !== 1 && o.car < 0 && o !== a) this.pushPos(all, o);
    for (let i = 0; i < all.length; i += RP_N * 50) this.send({ k: 'pos', t, p: all.slice(i, i + RP_N * 50), c: [] }, { to: seat });
    const cars: number[] = [];
    for (const c of m.cars) this.pushCar(cars, c);
    this.send({ k: 'pos', t, p: [], c: cars }, { to: seat });
    this.sendLootAll(m, seat);
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

  /** A bot's brain (a royale's are slower and less sure, as createMatch makes them). */
  private brainFor(m: Match, a: Actor) {
    const br = newBrain(m.level, a.id);
    if (m.mode === 'royale') {
      br.react *= 1.45;
      br.skill *= 0.88;
    }
    br.reset = true;
    return br;
  }

  private toBot(m: Match, a: Actor) {
    a.remote = false;
    a.net = null;
    this.peers.delete(a.seat);
    a.seat = -1;
    a.bot = true;
    a.brain = this.brainFor(m, a);
    a.name = `${a.name} (bot)`;
  }

  /** Someone new in the room mid match: they take over a bot (breach: on the side with fewer people; a royale: one
   * still in, aboard the transport if there is one). */
  private join(from: number) {
    const m = this.match;
    if (!m) return;
    if (m.actors.some((a) => a.seat === from && !a.bot)) return;
    const p = this.api.players.find((x) => x.seat === from);
    if (!p) return;
    let a: Actor | undefined;
    if (m.mode === 'breach') {
      const people = [0, 1].map((t) => m.actors.filter((o) => o.team === t && !o.bot).length);
      const order = people[0] <= people[1] ? [0, 1] : [1, 0];
      for (const t of order) {
        a = m.actors.find((o) => o.team === t && o.bot && !o.alive) ?? m.actors.find((o) => o.team === t && o.bot);
        if (a) break;
      }
    } else if (m.mode === 'dm') a = m.actors.find((o) => o.bot && o.id !== m.me);
    else a = m.actors.find((o) => o.bot && o.alive && o.drop === 1 && o.id !== m.me) ?? m.actors.find((o) => o.bot && o.alive && !o.drop && o.car < 0 && o.id !== m.me);
    if (!a) return;
    a.bot = false;
    a.brain = null;
    a.remote = true;
    a.seat = from;
    a.name = p.name.slice(0, 20);
    const pick = this.picks.get(from);
    if (pick) a.dmPick = pick;
    // a new place for the new player's machine to start from
    a.epoch++;
    this.addPeer(a);
    this.sendSync();
  }

  private hostReceive(from: number, k: string, pk: Record<string, unknown>) {
    const m = this.match;
    if (k === 'hello') {
      const pick = WEAPON_IDS.find((w) => w === pk.pick);
      if (pick) this.picks.set(from, pick);
      if (!m) return;
      if (!m.actors.some((a) => a.seat === from && !a.bot)) this.join(from);
      else this.sendSync(from);
      // (a deathmatch gun asked for just as the match began: handed over now)
      const me = m.actors.find((a) => a.seat === from && !a.bot);
      if (me && pick && m.mode === 'dm' && me.dmPick !== pick) {
        me.dmPick = pick;
        if (me.alive && m.time < 5) {
          me.guns[0] = gun(pick);
          me.slot = 0;
          this.tabNow = true;
        }
      }
      if (m.mode === 'royale' && pk.ready === true && me) this.sendRoyaleStart(m, from);
      return;
    }
    if (!m) return;
    const a = m.actors.find((o) => o.seat === from && o.remote);
    const peer = this.peers.get(from);
    if (!a || !peer) return;
    const t = this.now();
    const royale = m.mode === 'royale';
    if (k === 'mv') {
      const ep = int(pk.ep, 0, 1e6);
      const st = num(pk.t);
      const p = nums(pk.p, 14);
      if (ep === null || st === null || !p || ep !== a.epoch || !a.alive) return;
      const [x, y, z, vx, vy, vz, yaw, pitch, crouch, flags, ads, slot] = p;
      const n = a.net!;
      if (royale) {
        const r = nums(pk.rr, 9, -1, 1e6);
        if (r) this.royaleMove(m, a, peer, r);
        const c = nums(pk.c, 11);
        if (c && a.car >= 0 && a.carSeat === 0 && c[0] === a.car) this.carMove(m, peer, c, st, t);
        // aboard the transport or riding: carried there, only the look and the hands are theirs (and still aboard on
        // its machine when the host has jumped it out: where it is comes once that machine has caught up)
        if (a.drop === 1 || a.car >= 0 || peer.drop === 1) {
          a.yaw = wrap(yaw);
          a.pitch = Math.max(-1.5, Math.min(1.5, pitch));
          peer.clock.feed(st, t);
          peer.lastMove = t;
          n.ads = Math.min(1, Math.max(0, ads));
          n.reloading = !!(flags & 16);
          if ((slot === 0 || slot === 1 || slot === 2) && a.guns[slot]) a.slot = slot;
          return;
        }
      }
      // nothing moves faster than a run, a fall or a lag spike allows (a royale: a dive or a vehicle)
      const last = a.body;
      const gap = Math.max(0.05, t - peer.lastMove);
      const lim = royale ? 50 : 12;
      const edge = royale ? 600 : 600;
      if (Math.hypot(x - last.x, z - last.z) > lim * gap + 4 || Math.abs(x) > edge || Math.abs(z) > edge || Math.abs(y) > 900) return;
      peer.lastMove = t;
      peer.clock.feed(st, t);
      peer.track.push({ t: peer.clock.map(st), x, y, z, yaw, pitch, vx, vz });
      last.vy = vy;
      last.onGround = !!(flags & 4);
      last.swim = !!(flags & 8);
      n.walking = !!(flags & 1);
      n.use = !!(flags & 2);
      n.reloading = !!(flags & 16);
      n.crouch = Math.min(1, Math.max(0, crouch));
      n.ads = Math.min(1, Math.max(0, ads));
      if ((slot === 0 || slot === 1 || slot === 2) && a.guns[slot]) a.slot = slot;
      return;
    }
    if (k === 'fire') {
      const w = int(pk.w, 1, WEAPON_IDS.length);
      const o = nums(pk.o, 3);
      const v = pk.v;
      if (w === null || !o || !Array.isArray(v) || v.length % 3 !== 0 || v.length === 0 || v.length > 36 || !v.every((x) => num(x, -5000, 5000) !== null)) return;
      const id = gunOf(w)!;
      if (!a.alive || m.phase === 'buy' || a.drop || currentGun(a)?.id !== id) return;
      if (Math.hypot(o[0] - a.body.x, o[2] - a.body.z) > (a.car >= 0 ? 9 : 5)) return;
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
      if (!kind || yaw === null || pitch === null || !a.alive || m.phase !== 'live' || a.drop) return;
      a.yaw = yaw;
      a.pitch = pitch;
      throwFor(m, a, kind);
      return;
    }
    if (!royale) return;
    if (k === 'pick') {
      const i = int(pk.i, 0, m.loot.length - 1);
      if (i !== null) pickupFor(m, a, m.loot[i]);
      return;
    }
    if (k === 'heal') {
      if (pk.kind === null) {
        a.healT = 0;
        a.healKind = null;
        return;
      }
      const kind = USES.find((u) => u === pk.kind);
      if (kind && a.alive && !a.drop && a.healT <= 0 && canUse(a, kind)) startHeal(m, a, kind);
      return;
    }
    if (k === 'ride') {
      const ci = int(pk.c, -1, m.cars.length - 1);
      if (ci === null || !a.alive || a.drop) return;
      if (ci < 0) {
        if (a.car >= 0) leaveCar(m, a);
        return;
      }
      const c = m.cars[ci];
      if (a.car === ci && a.carSeat > 0 && c.seats[0] < 0) {
        // a passenger takes the free wheel
        c.seats[a.carSeat] = -1;
        c.seats[0] = a.id;
        a.carSeat = 0;
        c.lastDriver = a.id;
        a.healT = 0;
        a.healKind = null;
        peer.carTrack.clear();
      } else if (a.car < 0 && c.alive && c.seats.includes(-1) && Math.abs(a.body.y - c.y) < 3 && hullDist(c, a.body.x, a.body.z) < CAR_REACH + 1.5) {
        if (enterCar(m, a, c)) peer.carTrack.clear();
      }
      return;
    }
    if (k === 'crash') {
      const ci = int(pk.c, 0, m.cars.length - 1);
      const v = num(pk.v, 0, 60);
      if (ci !== null && v !== null && a.car === ci && a.carSeat === 0) crashHurt(m, m.cars[ci], v);
      return;
    }
    if (k === 'spec') {
      const f = int(pk.a, -1, m.actors.length - 1);
      if (f !== null) peer.focus = f;
      return;
    }
    if (k === 'inv' && !peer.inv) {
      const v = nums(pk.p, ME_N, -1e6, 1e6);
      if (!v) return;
      peer.inv = true;
      this.takeKit(a, v);
      for (let i = 0; i < 5; i++) peer.spent[i] = Math.max(0, Math.round(v[19 + i]));
    }
  }

  /** A royale guest's own: its drop (it jumps when it likes), the rounds in its guns, and what it loaded. */
  private royaleMove(m: Match, a: Actor, peer: Peer, r: number[]) {
    const d = Math.round(r[0]);
    peer.drop = d;
    if (a.drop === 1 && d >= 2 && m.plane) {
      jumpOut(m, a);
      peer.track.clear();
    }
    if (a.drop >= 2 && d === 3) a.drop = 3;
    if (a.drop >= 2 && d === 0) {
      a.drop = 0;
      a.dropT = m.time;
    }
    for (let k = 0; k < 3; k++) {
      const g = a.guns[k];
      if (g && r[1 + k] >= 0) g.mag = Math.min(magOf(g), Math.round(r[1 + k]));
    }
    for (let i = 0; i < 5; i++) {
      const s = Math.round(r[4 + i]);
      const more = s - peer.spent[i];
      if (more > 0 && more < 2000) {
        const k = AMMO_KINDS[i];
        a.ammo[k] = Math.max(0, a.ammo[k] - more);
        peer.spent[i] = s;
      }
    }
  }

  /** The vehicle a guest drives, where its machine has it. */
  private carMove(m: Match, peer: Peer, c: number[], st: number, t: number) {
    const car = m.cars[c[0]];
    if (!car || !car.alive) return;
    const [, x, y, z, yaw, pitch, roll, vx, vz, speed, steer] = c;
    const gap = Math.max(0.05, t - peer.lastMove);
    if (Math.hypot(x - car.x, z - car.z) > 45 * gap + 10 || Math.abs(x) > 600 || Math.abs(z) > 600) return;
    peer.carTrack.push({ t: peer.clock.map(st), x, y, z, yaw, pitch, vx, vz });
    car.roll = roll;
    car.speed = Math.max(-40, Math.min(40, speed));
    car.steer = Math.max(-1, Math.min(1, steer));
    car.sleep = false;
  }

  /** A guest's pockets, as it says they are (once, to a new host). */
  private takeKit(a: Actor, v: number[]) {
    const n = (i: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v[i])));
    a.vest = n(2, 3);
    a.helmet = n(3, 3);
    a.pack = n(4, 3);
    a.bandages = n(5, 30);
    a.kits = n(6, 10);
    a.drinks = n(7, 12);
    a.pills = n(8, 10);
    a.boost = n(9, 100);
    a.frags = n(12, 9);
    a.smokes = n(13, 9);
    a.armor = Math.max(a.armor, n(1, 100));
    AMMO_KINDS.forEach((k, i) => (a.ammo[k] = n(14 + i, 600)));
    for (let k = 0; k < 3; k++) {
      const g = gunFrom(v, 39 + k * 5);
      if (g) a.guns[k] = g;
    }
  }

  /** A guest's hit, checked: alive, an enemy, the gun in hand, a shot fired for it, the shooter where they were, the
   * target near where it was in the last second, and nothing solid between. */
  private judge(m: Match, a: Actor, peer: Peer, v: Actor, zone: Zone, w: WeaponId, o: number[], p: number[], t: number) {
    if (!a.alive || !v.alive || v.team === a.team || v.drop === 1 || m.phase !== 'live') return;
    if (currentGun(a)?.id !== w) return;
    peer.budget = peer.budget.filter((b) => t - b.t < 1.2 && b.n > 0);
    const spend = peer.budget[0];
    if (!spend) return;
    spend.n--;
    if (Math.hypot(o[0] - a.body.x, o[2] - a.body.z) > (a.car >= 0 ? 9 : 5)) return;
    let near = Math.hypot(p[0] - v.body.x, p[2] - v.body.z);
    const h = this.hist;
    if (h)
      for (let k = 0; k < HIST; k++) {
        const q = (v.id * HIST + k) * 4;
        if (t - h[q] < 1) near = Math.min(near, Math.hypot(p[0] - h[q + 1], p[2] - h[q + 3]));
      }
    // (a vehicle moves its riders fast: a little more room)
    if (near > (v.car >= 0 ? 3 : 1.6)) return;
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

  /** Where everyone was, a few times a second (for judging hits). */
  private record(m: Match, t: number) {
    if (t - this.histAt < 0.045) return;
    this.histAt = t;
    const n = m.actors.length;
    if (!this.hist || this.hist.length !== n * HIST * 4) {
      this.hist = new Float64Array(n * HIST * 4);
      for (let i = 0; i < this.hist.length; i += 4) this.hist[i] = -99;
    }
    const k = this.histN++ % HIST;
    for (const a of m.actors) {
      const q = (a.id * HIST + k) * 4;
      this.hist[q] = t;
      this.hist[q + 1] = a.body.x;
      this.hist[q + 2] = a.body.y;
      this.hist[q + 3] = a.body.z;
    }
  }

  // (royale, the host) ----------------------------------------------------------------------------------------------

  private pushPos(out: number[], a: Actor) {
    const b = a.body;
    const flags = (a.alive ? 1 : 0) | (b.onGround ? 2 : 0) | (a.walking ? 4 : 0) | (a.ads > 0.5 ? 8 : 0) | (a.reloadT > 0 ? 16 : 0) | (b.swim ? 32 : 0) | (a.drop << 6) | (a.healT > 0 ? 256 : 0);
    const g = a.guns[a.slot];
    out.push(a.id, Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(wrap(a.yaw) * 1000), Math.round(a.pitch * 1000), Math.round(b.vx * 10), Math.round(b.vz * 10), Math.round(a.crouch * 100), flags, gunCode(g?.id) * 4 + a.slot, Math.round(a.hp));
  }

  private pushCar(out: number[], c: Match['cars'][number]) {
    out.push(c.id, Math.round(c.x * 100), Math.round(c.y * 100), Math.round(c.z * 100), Math.round(wrap(c.yaw) * 1000), Math.round(c.pitch * 1000), Math.round(c.roll * 1000), Math.round(c.vx * 10), Math.round(c.vz * 10), Math.round(c.speed * 10), Math.round(c.steer * 100));
  }

  /** Where a guest's view is: its soldier, or (out of it) whoever it watches. */
  private focusOf(m: Match, a: Actor, peer: Peer) {
    if (a.alive || peer.focus < 0) return a;
    const f = m.actors[peer.focus];
    return f && f.alive ? f : a;
  }

  /** A royale guest's pos: who is near its view every beat, further off less often, and the vehicles the same way. */
  private royalePos(m: Match, me: Actor, peer: Peer) {
    const f = this.focusOf(m, me, peer).body;
    const p: number[] = [];
    const c: number[] = [];
    const beat = this.beat;
    for (const a of m.actors) {
      if (a === me || !a.alive || a.drop === 1 || a.car >= 0) continue;
      const n = beatsAt(Math.hypot(a.body.x - f.x, a.body.z - f.z));
      if ((beat + a.id) % n === 0) this.pushPos(p, a);
    }
    for (const car of m.cars) {
      const n = car.sleep || !car.alive ? 40 : beatsAt(Math.hypot(car.x - f.x, car.z - f.z));
      if ((beat + car.id) % n === 0) this.pushCar(c, car);
    }
    return { p, c };
  }

  private encodeRT(m: Match, a: Actor, peer: Peer, t: number, cars: boolean): RTab {
    const s: number[] = [];
    for (const x of m.supplies) s.push(x.id, r2(x.x), r2(x.y), r2(x.z), r2(x.ground), r2(x.landed), x.items.length, ...x.items);
    const red = m.red ? [r2(m.red.x), r2(m.red.z), r2(m.red.r), r2(m.red.warn), r2(m.red.left)] : null;
    return { t, g: encodeWorld(m), me: encodeMe(a, peer.spent), red, s, c: cars ? encodeCars(m) : null };
  }

  private encodeBoard(m: Match): Board {
    let al = '';
    const kl: number[] = [];
    const pl: number[] = [];
    for (const a of m.actors) {
      al += a.alive ? String(1 + a.drop) : '0';
      kl.push(a.kills);
      pl.push(a.place);
    }
    return { al, kl, pl };
  }

  /** The loot as it was last sent, so the next changes can be found. */
  private markLootSent(m: Match) {
    const s = this.lootSent;
    if (s.n.length < m.loot.length) {
      const cap = Math.max(m.loot.length + 256, s.n.length * 2);
      const n = new Int32Array(cap);
      const live = new Uint8Array(cap);
      n.set(s.n);
      live.set(s.live);
      s.n = n;
      s.live = live;
    }
    for (let i = 0; i < m.loot.length; i++) {
      s.n[i] = m.loot[i].n;
      s.live[i] = m.loot[i].live ? 1 : 0;
    }
    s.len = m.loot.length;
    s.ver = m.lootVer;
  }

  /** Loot changes since the last look, in pieces under the room's limit. */
  private lootDiff(m: Match, base: { n: ArrayLike<number>; live: ArrayLike<number>; len: number }): LootMsg[] {
    const out: LootMsg[] = [];
    let cur: LootMsg = { u: [], a: [] };
    let size = 0;
    const flush = () => {
      if (cur.u.length || cur.a.length) out.push(cur);
      cur = { u: [], a: [] };
      size = 0;
    };
    for (let i = 0; i < m.loot.length; i++) {
      const it = m.loot[i];
      if (i < base.len) {
        if (base.n[i] === it.n && base.live[i] === (it.live ? 1 : 0)) continue;
        cur.u.push(i, it.n, it.live ? 1 : 0);
        size += 14;
      } else {
        cur.a.push(encodeItem(m, i));
        size += 70;
      }
      if (size > 5500) flush();
    }
    flush();
    return out;
  }

  /** The loot as it stands now, to a guest just in (or everyone, after a host change). */
  private sendLootAll(m: Match, to?: number) {
    const base = this.lootBase;
    if (!base) return;
    const parts = this.lootDiff(m, { n: base.n, live: base.live, len: base.n.length });
    if (!parts.length) parts.push({ u: [], a: [] });
    parts.forEach((p, i) => this.send({ k: 'lall', i, of: parts.length, u: p.u, a: p.a }, to === undefined ? {} : { to }));
  }

  /** Each frame (the host, a royale): what changed of the loot goes to everyone. */
  private sendLoot(m: Match) {
    const s = this.lootSent;
    if (s.ver === m.lootVer) return;
    const parts = this.lootDiff(m, s);
    for (const p of parts) this.send({ k: 'loot', u: p.u, a: p.a });
    this.markLootSent(m);
  }

  /** The host's royale traffic each frame: events to those they concern, the loot, each guest's pos and tab, the board. */
  private hostRoyale(m: Match, t: number) {
    for (const e of m.events) {
      const all = R_ALL.has(e.t);
      if (!all && !R_OWN.has(e.t) && !R_NEAR.has(e.t)) continue;
      if (e.t === 'heal' && !e.done) continue;
      if (e.t === 'kill' || e.t === 'phase' || e.t === 'zone') {
        this.tabNow = true;
        this.boardNow = true;
      }
      if (e.t === 'car') this.tabNow = true;
      let ex = 0;
      let ez = 0;
      if (e.t === 'hit' || e.t === 'shot' || e.t === 'shell' || e.t === 'crash') {
        ex = e.x;
        ez = e.z;
      } else if (e.t === 'throw' || e.t === 'car') {
        ex = m.actors[e.a].body.x;
        ez = m.actors[e.a].body.z;
      }
      for (const [seat, peer] of this.peers) {
        const a = m.actors.find((o) => o.seat === seat && o.remote);
        if (!a) continue;
        if (all) peer.out.push(e);
        else if (R_OWN.has(e.t)) {
          if ((e as { a: number }).a === a.id) peer.out.push(e);
        } else {
          const f = this.focusOf(m, a, peer).body;
          if ((e.t === 'hit' && (e.v === a.id || e.a === a.id)) || Math.hypot(ex - f.x, ez - f.z) < HEAR) peer.out.push(e);
        }
      }
    }
    if (t - this.evAt >= EV_EVERY) {
      this.evAt = t;
      for (const [seat, peer] of this.peers) {
        for (let i = 0; i < peer.out.length; i += 12) this.send({ k: 'ev', e: peer.out.slice(i, i + 12) }, { to: seat });
        peer.out.length = 0;
      }
    }
    this.sendLoot(m);
    const posDue = t - this.posAt >= POS_EVERY;
    const tabDue = this.tabNow || t - this.tabAt >= TAB_EVERY;
    if (posDue) {
      this.posAt = t;
      this.beat++;
    }
    let cars = false;
    if (tabDue) {
      this.tabNow = false;
      this.tabAt = t;
      // the vehicles' seats and health when they change (and now and then anyway)
      const sig = encodeCars(m).join(',');
      cars = sig !== this.carsSig || t - this.carsAt > 1;
      if (cars) {
        this.carsSig = sig;
        this.carsAt = t;
      }
    }
    if (posDue || tabDue)
      for (const [seat, peer] of this.peers) {
        const a = m.actors.find((o) => o.seat === seat && o.remote);
        if (!a) continue;
        if (posDue) this.send({ k: 'pos', t, ...this.royalePos(m, a, peer) }, { to: seat, fast: true });
        if (tabDue) this.send({ k: 'rt', ...this.encodeRT(m, a, peer, t, cars) }, { to: seat, fast: true });
      }
    if (t - this.boardAt >= BOARD_EVERY || (this.boardNow && t - this.boardAt > 0.25)) {
      this.boardAt = t;
      this.boardNow = false;
      this.send({ k: 'bd', t, ...this.encodeBoard(m) }, { fast: true });
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // guest

  /** Is this machine's seat in the roster the host sent (a latecomer waits until it is)? */
  private seated(s: Sync) {
    if (s.sparse) return s.sparse.some(([, seat, , bot]) => !bot && seat === this.api.seat);
    return s.roster.some((r) => !r.bot && r.seat === this.api.seat);
  }

  private build(world: World, s: Sync) {
    if (world.id !== s.map || world.arena > ARENA !== (s.mode === 'royale') || !this.seated(s)) return;
    const m = createMatch(world, s.mode, s.level, { seed: s.seed, roster: s.mode === 'royale' ? undefined : s.roster, mySeat: this.api.seat });
    m.authority = false;
    m.net = {
      fire: (w, x, y, z, vel) => this.send({ k: 'fire', w: gunCode(w), o: [r2(x), r2(y), r2(z)], v: vel.map(r2) }),
      hit: (c: Claim) => this.send({ k: 'hit', v: c.v, z: ZONES.indexOf(c.zone), w: gunCode(c.w), o: [r2(c.ox), r2(c.oy), r2(c.oz)], p: [r2(c.x), r2(c.y), r2(c.z)] }),
      buy: (item) => this.send({ k: 'buy', item }),
      throwNade: (kind, yaw, pitch) => this.send({ k: 'throw', kind, yaw: r2(yaw * 10) / 10, pitch: r2(pitch * 10) / 10 }),
      pick: (i) => {
        const t = this.now();
        if (t - (this.asked.get(i) ?? -9) < 0.6) return;
        if (this.asked.size > 64) this.asked.clear();
        this.asked.set(i, t);
        this.send({ k: 'pick', i });
      },
      heal: (kind) => {
        if (kind) this.healAt = this.now();
        this.send({ k: 'heal', kind });
      },
      ride: (c) => {
        const t = this.now();
        if (t - this.rideAt < 0.35) return;
        this.rideAt = t;
        this.send({ k: 'ride', c });
      },
      spend: (kind, n) => (this.spent[AMMO_KINDS.indexOf(kind)] += n),
      crash: (c, v) => this.send({ k: 'crash', c, v: r2(v) }),
    };
    this.match = m;
    this.names0 = m.actors.map((a) => a.name);
    this.tracks = m.actors.map(() => new Track());
    this.carTracks = m.cars.map(() => new Track());
    this.myEpoch = -1;
    this.applySync(m, s);
    if (m.mode === 'royale') {
      // everything else (the pockets, where everyone is, the loot) comes once the host hears the world is built
      this.built = true;
      this.hello(true);
      if (this.rt) this.applyRT(m, this.rt);
      if (this.bd) this.applyBoard(m, this.bd);
    }
  }

  /** The host's whole match laid over the mirror (on joining, and when someone joined or left). */
  private applySync(m: Match, s: Sync) {
    // (whatever plays this machine's own soldier, the dev autopilot say, stays on it)
    const me0 = m.me;
    const brain = m.actors[me0].brain;
    this.syncRoster(m, s);
    if (m.me === me0) m.actors[me0].brain = brain;
    this.hostClock.feed(s.time, this.now());
    if (s.sparse) {
      // (a new place: start from wherever the host has it)
      if (m.me !== me0) this.myEpoch = -1;
      return;
    }
    if (s.pos) this.applyPos(m, s.pos, s.time);
    this.tab = s.tab;
    this.tabT = s.time;
    this.applyTab(m, true);
  }

  private syncRoster(m: Match, s: Sync) {
    if (s.sparse) {
      for (const a of m.actors) {
        a.name = this.names0[a.id] ?? a.name;
        a.seat = -1;
        a.bot = true;
        a.brain = null;
        a.remote = false;
      }
      for (const [i, seat, name, bot] of s.sparse) {
        const a = m.actors[i];
        a.name = name;
        a.bot = bot;
        a.seat = bot ? -1 : seat;
        a.remote = !bot && seat !== this.api.seat;
        if (!bot && seat === this.api.seat) m.me = i;
      }
      return;
    }
    s.roster.forEach((r, i) => {
      const a = m.actors[i];
      if (!a) return;
      a.name = r.name;
      a.seat = r.bot ? -1 : r.seat;
      a.bot = r.bot;
      a.brain = null;
      a.remote = !r.bot && r.seat !== this.api.seat;
      if (!r.bot && r.seat === this.api.seat) m.me = i;
    });
  }

  private applyPos(m: Match, p: number[], t: number) {
    const ht = this.hostClock.map(t);
    for (let i = 0; i < m.actors.length; i++) {
      const o = i * POS_N;
      const pose = { t: ht, x: p[o] / 100, y: p[o + 1] / 100, z: p[o + 2] / 100, yaw: p[o + 3] / 1000, pitch: p[o + 4] / 1000, vx: p[o + 5] / 10, vz: p[o + 6] / 10 };
      const a = m.actors[i];
      if (i === m.me) {
        // where the host put me (taken when the host moves me, see applyTab)
        this.mine = pose;
        this.mineT = t;
        continue;
      }
      if (t < (this.cut[i] ?? -1e9)) continue;
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

  /** A royale pos: those it holds, onto their tracks, and the vehicles onto theirs. */
  private applyRoyalePos(m: Match, p: number[], c: number[], t: number) {
    const ht = this.hostClock.map(t);
    for (let o = 0; o < p.length; o += RP_N) {
      const i = p[o];
      const a = m.actors[i];
      if (!a || i === m.me) continue;
      const f = p[o + 9];
      if (!(f & 1)) continue;
      this.tracks[i].push({ t: ht, x: p[o + 1] / 100, y: p[o + 2] / 100, z: p[o + 3] / 100, yaw: p[o + 4] / 1000, pitch: p[o + 5] / 1000, vx: p[o + 6] / 10, vz: p[o + 7] / 10 });
      a.crouch = p[o + 8] / 100;
      a.walking = !!(f & 4);
      a.ads = f & 8 ? 1 : 0;
      a.reloadT = f & 16 ? Math.max(a.reloadT, 0.3) : 0;
      a.body.onGround = !!(f & 2);
      a.body.swim = !!(f & 32);
      a.healT = f & 256 ? 1 : 0;
      const drop = (f >> 6) & 3;
      if (a.drop !== drop) {
        if (a.drop === 1) this.tracks[i].clear();
        a.drop = drop as Actor['drop'];
        if (drop === 1) this.tracks[i].clear();
      }
      // (sent on foot: out of whatever vehicle this machine still had it in)
      if (a.car >= 0) {
        const car = m.cars[a.car];
        if (car && car.seats[a.carSeat] === a.id) car.seats[a.carSeat] = -1;
        a.car = -1;
        a.carSeat = -1;
      }
      const held = p[o + 10];
      const slot = held & 3;
      const id = gunOf(held >> 2);
      if (slot <= 2) {
        a.slot = slot as 0 | 1 | 2;
        if ((a.guns[slot]?.id ?? null) !== id) a.guns[slot] = id ? gun(id) : null;
      }
      a.hp = p[o + 11];
    }
    for (let o = 0; o < c.length; o += CP_N) {
      const car = m.cars[c[o]];
      if (!car) continue;
      this.carTracks[c[o]].push({ t: ht, x: c[o + 1] / 100, y: c[o + 2] / 100, z: c[o + 3] / 100, yaw: c[o + 4] / 1000, pitch: c[o + 5] / 1000, vx: c[o + 7] / 10, vz: c[o + 8] / 10 });
      if (car.seats[0] === m.me) continue;
      car.roll = c[o + 6] / 1000;
      car.speed = c[o + 9] / 10;
      car.steer = c[o + 10] / 100;
    }
  }

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
      if (o + TAB_N > v.length) break;
      const alive = v[o + 16] === 1;
      const g0 = gunOf(v[o + 3]);
      const g1 = gunOf(v[o + 4]);
      const g2 = gunOf(v[o + 18]);
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
        if (epoch !== this.myEpoch) {
          // put somewhere new by the host (a round start, a respawn, joining): go there, guns refilled, once the host's
          // word on where has come in too (the place and the tab travel apart)
          if (!this.mine || this.mineT < this.tabT - 1e-6) continue;
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
          a.hp = v[o];
          a.armor = v[o + 1];
          a.guns = [g0 ? gun(g0) : null, g1 ? gun(g1) : null, g2 ? gun(g2) : null];
          a.slot = a.guns[0] ? 0 : a.guns[2] ? 2 : 1;
          a.reloadT = a.switchT = a.blindT = 0;
          a.lastX = b.x;
          a.lastZ = b.z;
          continue;
        }
        if (a.alive && !alive) {
          a.alive = false;
          a.deathT = m.time;
        }
        a.hp = v[o];
        a.armor = v[o + 1];
        // bought, or lost a gun: take the host's loadout, keeping the rounds left in a gun still held
        for (const [k, id] of [
          [0, g0],
          [1, g1],
          [2, g2],
        ] as const) {
          if ((a.guns[k]?.id ?? null) !== id) a.guns[k] = id ? gun(id) : null;
        }
        if (alive && !a.alive) a.alive = true;
      } else {
        if (a.alive && !alive) {
          a.alive = false;
          a.deathT = m.time;
        }
        a.hp = v[o];
        a.armor = v[o + 1];
        a.slot = (v[o + 2] === 0 || v[o + 2] === 1 || v[o + 2] === 2 ? v[o + 2] : 1) as 0 | 1 | 2;
        if ((a.guns[0]?.id ?? null) !== g0) a.guns[0] = g0 ? gun(g0) : null;
        if ((a.guns[1]?.id ?? null) !== g1) a.guns[1] = g1 ? gun(g1) : null;
        if ((a.guns[2]?.id ?? null) !== g2) a.guns[2] = g2 ? gun(g2) : null;
        a.blindT = v[o + 17] / 10;
        if ((alive && !a.alive) || epoch !== a.epoch) {
          // back in, or moved somewhere new: no sliding across the map from the old place
          a.alive = alive || a.alive;
          a.epoch = epoch;
          this.tracks[i].clear();
          this.cut[i] = this.tabT;
        }
      }
    }
    // the round
    if (full || m.phase !== tb.phase) m.phase = tb.phase;
    if (full || Math.abs(m.phaseT - tb.phaseT) > 0.3 || m.round !== tb.round) m.phaseT = tb.phaseT;
    if (tb.clock !== undefined && (full || Math.abs(m.clock - tb.clock) > 0.3)) m.clock = tb.clock;
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

  /** A royale tab: the world's state, the vehicles', and this machine's own soldier. */
  private applyRT(m: Match, r: RTab) {
    const g = r.g;
    const phase = PHASES[g[0]];
    if (phase && m.phase !== phase) m.phase = phase;
    if (Math.abs(m.time - g[1]) > 0.3) m.time = g[1];
    m.alive = g[2];
    m.winner = g[3];
    const z = m.zone;
    if (z) {
      z.i = g[4];
      z.t = g[5];
      z.shrinking = g[6] === 1;
      z.x = g[7];
      z.z = g[8];
      z.r = g[9];
      z.fx = g[10];
      z.fz = g[11];
      z.fr = g[12];
      z.nx = g[13];
      z.nz = g[14];
      z.nr = g[15];
      z.dps = g[16];
    }
    if (!g[17]) m.plane = null;
    m.redT = g[18];
    const red = r.red;
    if (!red) m.red = null;
    else if (!m.red) m.red = { x: red[0], z: red[1], r: red[2], warn: red[3], left: red[4], next: 0 };
    else Object.assign(m.red, { x: red[0], z: red[1], r: red[2], warn: red[3], left: red[4] });
    // supply crates
    for (let o = 0; o + 7 <= r.s.length; ) {
      const id = r.s[o];
      const n = r.s[o + 6];
      const items = r.s.slice(o + 7, o + 7 + n);
      let s = m.supplies.find((x) => x.id === id);
      if (!s) {
        s = { id, x: r.s[o + 1], y: r.s[o + 2], z: r.s[o + 3], ground: r.s[o + 4], landed: r.s[o + 5], items };
        m.supplies.push(s);
      }
      s.x = r.s[o + 1];
      s.z = r.s[o + 3];
      s.ground = r.s[o + 4];
      s.landed = r.s[o + 5];
      if (s.landed >= 0 || Math.abs(s.y - r.s[o + 2]) > 3) s.y = r.s[o + 2];
      s.items = items;
      o += 7 + n;
    }
    // the vehicles: health, wrecks, and who sits where
    const cs = r.c;
    if (cs && cs.length === m.cars.length * RC_N) {
      for (const a of m.actors) {
        a.car = -1;
        a.carSeat = -1;
      }
      m.cars.forEach((c, i) => {
        const o = i * RC_N;
        c.hp = cs[o];
        if (c.alive && !cs[o + 1]) {
          c.alive = false;
          c.wreckT = m.time;
          c.speed = 0;
          m.events.push({ t: 'boom', x: c.x, y: c.y + 1, z: c.z });
        }
        c.flooded = !!cs[o + 2];
        for (let k = 0; k < c.seats.length; k++) {
          const id = cs[o + 3 + k];
          const a = id >= 0 ? m.actors[id] : undefined;
          c.seats[k] = a && a.alive ? id : -1;
          if (a && a.alive) {
            a.car = c.id;
            a.carSeat = k;
          }
        }
        if (c.seats[0] === m.me) c.sleep = false;
      });
    }
    this.applyMe(m, m.actors[m.me], r.me);
  }

  /** This machine's own soldier as the host has it: health and pockets (the rounds it loaded itself taken off), the
   * guns (the rounds left in one still held kept), and where the host put it when that moved on. */
  private applyMe(m: Match, a: Actor, v: number[]) {
    a.hp = v[0];
    a.armor = v[1];
    a.vest = v[2];
    a.helmet = v[3];
    a.pack = v[4];
    a.bandages = v[5];
    a.kits = v[6];
    a.drinks = v[7];
    a.pills = v[8];
    a.boost = v[9];
    // a heal the host never started (or called off): called off here too, once it has had time to hear of it
    if (v[10] < 0 && a.healT > 0 && this.now() - this.healAt > 0.6) {
      a.healT = 0;
      a.healKind = null;
    }
    a.frags = v[12];
    a.smokes = v[13];
    AMMO_KINDS.forEach((k, i) => (a.ammo[k] = Math.max(0, v[14 + i] - (this.spent[i] - v[19 + i]))));
    a.place = v[25];
    a.car = v[26];
    a.carSeat = v[27];
    const epoch = v[28];
    if (epoch !== this.myEpoch) {
      this.myEpoch = epoch;
      a.epoch = epoch;
      const b = a.body;
      b.x = v[29];
      b.y = v[30];
      b.z = v[31];
      b.vx = b.vy = b.vz = 0;
      a.yaw = v[32];
      a.drop = v[24] as Actor['drop'];
      a.lastX = b.x;
      a.lastZ = b.z;
      a.healT = 0;
      a.healKind = null;
    }
    // still aboard here, out on the host (it jumped this machine's soldier out at the far edge while this machine was
    // not stepping, a tab in the background say): out here too, where the host has it
    if (a.drop === 1 && v[24] !== 1 && a.alive) {
      const b = a.body;
      b.x = v[29];
      b.y = v[30];
      b.z = v[31];
      b.vx = b.vy = b.vz = 0;
      a.drop = (v[24] === 3 ? 3 : v[24] === 0 ? 0 : 2) as Actor['drop'];
      a.dropT = a.drop ? 0 : m.time;
    }
    a.kills = v[33];
    a.deaths = v[34];
    a.damage = v[35];
    a.cs = v[36];
    if (a.alive && !v[37]) {
      a.alive = false;
      a.deathT = m.time;
    }
    for (let k = 0; k < 3; k++) {
      const g = gunFrom(v, 39 + k * 5);
      const have = a.guns[k];
      if (!g) {
        if (have) a.guns[k] = null;
        continue;
      }
      if (have && have.id === g.id && sameMods(have.mods, g.mods)) continue;
      // a gun new to that place (picked up, swapped): the host's, and in hand if the host put it there
      a.guns[k] = g;
      if (v[38] === k) {
        a.slot = k as 0 | 1 | 2;
        a.switchT = WEAPONS[g.id].equip;
        a.reloadT = 0;
      }
    }
    if (!a.guns[a.slot]) a.slot = a.guns[0] ? 0 : a.guns[2] ? 2 : 1;
  }

  /** Who is in, their drop, kills and places (once a second). */
  private applyBoard(m: Match, b: Board) {
    for (let i = 0; i < m.actors.length; i++) {
      const a = m.actors[i];
      a.kills = b.kl[i];
      a.place = b.pl[i];
      const s = b.al.charCodeAt(i) - 48;
      if (i === m.me) continue;
      if (s === 0 && a.alive) {
        a.alive = false;
        a.deathT = m.time;
      }
      if (s >= 1 && s <= 4 && a.alive) {
        const drop = (s - 1) as Actor['drop'];
        // (aboard is the transport's to show; jumping out shows once the first place comes in)
        if (drop === 1 && a.drop !== 1) {
          a.drop = 1;
          this.tracks[i].clear();
        }
      }
    }
  }

  /** The loot changes, in order. */
  private applyLoot(m: Match, msg: LootMsg) {
    const u = msg.u;
    for (let o = 0; o < u.length; o += 3) {
      const it = m.loot[u[o]];
      if (!it) continue;
      it.n = u[o + 1];
      it.live = u[o + 2] === 1;
    }
    for (const r of msg.a) {
      const i = r[0] as number;
      if (i > m.loot.length + 2000) continue;
      const sight = SIGHTS[r[9] as number] ?? null;
      const mods: Mods | null = sight || r[10] || r[11] ? { sight, ext: !!r[10], comp: !!r[11] } : null;
      const it = { id: i, kind: ITEM_KINDS[r[1] as number], what: r[2] as string, n: r[3] as number, x: r[4] as number, y: r[5] as number, z: r[6] as number, live: r[7] === 1, mods, by: r[8] as number };
      // (never a hole: anything missing before it is filled in by the lall that is on its way)
      while (m.loot.length < i) m.loot.push({ id: m.loot.length, kind: 'ammo', what: 'light', n: 0, x: 0, y: -999, z: 0, live: false });
      m.loot[i] = it;
    }
    m.lootVer++;
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
          if (m.mode === 'dm') v.respawnT = RESPAWN;
          if (m.mode === 'royale') {
            v.place = m.alive;
            if (v.car >= 0) {
              const c = m.cars[v.car];
              if (c && c.seats[v.carSeat] === v.id) c.seats[v.carSeat] = -1;
              v.car = -1;
              v.carSeat = -1;
            }
          }
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
      case 'car':
        // (who sits where comes with the next tab: this is the sound of the door)
        break;
    }
    m.events.push(e);
  }

  /** Each frame, before the rules step: where everyone shown on this machine is. */
  before(m: Match) {
    // only ever the session's own match (a stale one from before is left alone)
    if (m !== this.match) return;
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
        // (aboard the transport or in a vehicle: carried there)
        if (a.drop === 1) continue;
        if (a.car >= 0) {
          if (a.carSeat === 0 && peer.carTrack.sample(t - DELAY, this.pose)) {
            const c = m.cars[a.car];
            c.x = this.pose.x;
            c.y = this.pose.y;
            c.z = this.pose.z;
            c.yaw = this.pose.yaw;
            c.pitch = this.pose.pitch;
            c.vx = this.pose.vx;
            c.vz = this.pose.vz;
          }
          continue;
        }
        if (!peer.track.sample(t - DELAY, this.pose)) continue;
        this.placeBody(a, this.pose);
      }
      return;
    }
    if (!this.hostClock.ready) return;
    const royale = m.mode === 'royale';
    if (!royale && this.tab) this.applyTab(m);
    for (let i = 0; i < m.actors.length; i++) {
      if (i === m.me) continue;
      const a = m.actors[i];
      if (royale && (!a.alive || a.drop === 1 || a.car >= 0)) continue;
      if (!this.tracks[i]?.sample(t - DELAY, this.pose)) continue;
      this.placeBody(a, this.pose);
    }
    if (royale)
      for (const c of m.cars) {
        if (c.seats[0] === m.me) continue;
        if (!this.carTracks[c.id]?.sample(t - DELAY, this.pose)) continue;
        c.x = this.pose.x;
        c.y = this.pose.y;
        c.z = this.pose.z;
        c.yaw = this.pose.yaw;
        c.pitch = this.pose.pitch;
        c.vx = this.pose.vx;
        c.vz = this.pose.vz;
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
      if (m !== this.match) return;
      const box = this.inbox;
      this.inbox = [];
      for (const x of box) this.hostReceive(x.from, x.k, x.pk);
      this.record(m, t);
      // a remote player out of a vehicle (by asking, a knockout, a wreck): put beside it, so their machine jumps there
      for (const [seat, peer] of this.peers) {
        const a = m.actors.find((o) => o.seat === seat && o.remote);
        if (!a) continue;
        if (peer.car >= 0 && a.car < 0) {
          a.epoch++;
          this.tabNow = true;
        }
        peer.car = a.car;
      }
      if (m.mode === 'royale') {
        this.hostRoyale(m, t);
        return;
      }
      for (const e of m.events) {
        if (!SHARED.has(e.t)) continue;
        this.outEv.push(e);
        if (e.t === 'phase' || e.t === 'round' || e.t === 'kill' || e.t === 'plant' || e.t === 'defuse' || e.t === 'carry' || e.t === 'dropcharge' || e.t === 'spawn') this.tabNow = true;
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
    if (m !== this.match) return;
    if (m.mode === 'royale') {
      if (this.lootQ.length && this.lootOn) {
        for (const q of this.lootQ) this.applyLoot(m, q);
        this.lootQ.length = 0;
      }
    }
    for (const e of this.inEv) this.applyEvent(m, e);
    this.inEv = [];
    const me = m.actors[m.me];
    if (me.alive && t - this.moveAt >= MOVE_EVERY) {
      this.moveAt = t;
      const b = me.body;
      const flags = (me.walking ? 1 : 0) | (this.using ? 2 : 0) | (b.onGround ? 4 : 0) | (b.swim ? 8 : 0) | (me.reloadT > 0 ? 16 : 0);
      const mv: Record<string, unknown> = { k: 'mv', t, ep: this.myEpoch < 0 ? me.epoch : this.myEpoch, p: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), Math.round(wrap(me.yaw) * 1000) / 1000, Math.round(me.pitch * 1000) / 1000, r2(me.crouch), flags, r2(me.ads), me.slot, 0, 0] };
      if (m.mode === 'royale') {
        // the drop, the guns' rounds and what was loaded: when it changes, and now and then anyway
        const kit = [me.drop, me.guns[0]?.mag ?? -1, me.guns[1]?.mag ?? -1, me.guns[2]?.mag ?? -1, ...this.spent];
        const sig = kit.join(',');
        if (sig !== this.kitSig || t - this.kitAt > 0.5) {
          this.kitSig = sig;
          this.kitAt = t;
          mv.rr = kit;
        }
        const c = me.car >= 0 && me.carSeat === 0 ? m.cars[me.car] : null;
        if (c) mv.c = [c.id, r2(c.x), r2(c.y), r2(c.z), Math.round(wrap(c.yaw) * 1000) / 1000, Math.round(c.pitch * 1000) / 1000, Math.round(c.roll * 1000) / 1000, r2(c.vx), r2(c.vz), r2(c.speed), r2(c.steer)];
      }
      this.send(mv, { fast: true });
    }
    // out of a royale: the host sends what is near whoever this machine watches
    if (m.mode === 'royale' && !me.alive && t - this.specAt > 0.5) {
      this.specAt = t;
      this.send({ k: 'spec', a: this.watch });
    }
  }

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
    const n = this.match?.actors.length ?? this.sync?.n ?? 10;
    const m = this.match;
    switch (pk.k) {
      case 'sync': {
        const s = this.parseSync(pk);
        if (!s) return;
        this.sync = s;
        this.seed = s.seed;
        if (!this.map) {
          this.map = s.map;
          this.mode = s.mode;
          this.level = s.level;
          this.onMap?.(s.map, s.mode);
        }
        if (m) {
          if (m.mode === s.mode) this.applySync(m, s);
        } else if (this.world) this.build(this.world, s);
        break;
      }
      case 'pos': {
        const t = num(pk.t);
        if (t === null) return;
        if (this.sync?.mode === 'royale') {
          const p = rows(pk.p, RP_N, ROYALE_LIMIT);
          const c = rows(pk.c, CP_N, 64);
          if (!p || !c) return;
          this.hostClock.feed(t, this.now());
          if (m) this.applyRoyalePos(m, p, c, t);
          break;
        }
        const p = nums(pk.p, n * POS_N);
        if (!p) return;
        this.hostClock.feed(t, this.now());
        if (m) this.applyPos(m, p, t);
        break;
      }
      case 'tab': {
        const s = parseTab(pk.s, n);
        const t = num(pk.t);
        if (s && t !== null) {
          this.tab = s;
          this.tabT = t;
        }
        break;
      }
      case 'rt': {
        const t = num(pk.t);
        const g = nums(pk.g, RG_N);
        const me = nums(pk.me, ME_N);
        const red = pk.red === null ? null : nums(pk.red, 5);
        const s = rows(pk.s, 1, 200);
        const c = pk.c === null ? null : rows(pk.c, RC_N, 64);
        if (t === null || !g || !me || (pk.red !== null && !red) || !s || (pk.c !== null && !c)) return;
        if (this.rt && t < this.rt.t) return;
        this.rt = { t, g, me, red, s, c };
        if (m) this.applyRT(m, this.rt);
        break;
      }
      case 'bd': {
        const kl = rows(pk.kl, 1, ROYALE_LIMIT);
        const pl = rows(pk.pl, 1, ROYALE_LIMIT);
        if (typeof pk.al !== 'string' || !kl || !pl || pk.al.length !== kl.length || pl.length !== kl.length) return;
        this.bd = { al: pk.al, kl, pl };
        if (m && kl.length === m.actors.length) this.applyBoard(m, this.bd);
        break;
      }
      case 'lall': {
        const msg = parseLoot(pk);
        const i = int(pk.i, 0, 999);
        if (!msg || i === null) return;
        // the loot as it stands: anything said before it is in it, everything after it follows in order
        if (i === 0) {
          this.lootQ.length = 0;
          this.lootOn = true;
        }
        if (this.lootOn) this.lootQ.push(msg);
        break;
      }
      case 'loot': {
        const msg = parseLoot(pk);
        if (msg && this.lootOn && this.lootQ.length < 4096) this.lootQ.push(msg);
        break;
      }
      case 'ev': {
        if (!Array.isArray(pk.e) || !m) return;
        for (const v of pk.e.slice(0, 64)) {
          const e = parseEv(v, n);
          if (e) this.inEv.push(e);
        }
        if (this.inEv.length > 512) this.inEv.splice(0, this.inEv.length - 512);
        break;
      }
      case 'inv?': {
        // a new host asks what this machine's soldier carries
        const me = m?.actors[m.me];
        if (me && m?.mode === 'royale') this.send({ k: 'inv', p: encodeMe(me, this.spent) });
        break;
      }
    }
  }

  private parseSync(pk: Record<string, unknown>): Sync | null {
    const mode = MODES.find((x) => x === (pk.mode ?? 'breach'));
    const map = MAP_IDS.find((x) => x === pk.map);
    const level = (['easy', 'normal', 'hard'] as Level[]).find((x) => x === pk.level);
    const seed = int(pk.seed, 0, 2 ** 32);
    const time = num(pk.time);
    if (!mode || !map || !level || seed === null || time === null) return null;
    if (mode === 'royale') {
      const sparse = parseSparse(pk.ros, ROYALE_LIMIT);
      if (!sparse) return null;
      return { mode, map, level, seed, roster: [], tab: null, pos: null, time, n: ROYALE_LIMIT, sparse };
    }
    const roster = parseRoster(pk.roster, mode === 'breach' ? 10 : 8, 10);
    if (!roster) return null;
    const n = roster.length;
    const tab = parseTab(pk.tab, n);
    const pos = nums(pk.pos, n * POS_N);
    if (!tab || !pos) return null;
    return { mode, map, level, seed, roster, tab, pos, time, n, sparse: null };
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
      for (const t of this.carTracks) t.clear();
      this.lootOn = false;
      this.lootQ.length = 0;
      this.rt = null;
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
        a.brain = this.brainFor(m, a);
      }
    }
    if (m.mode === 'royale') {
      // a mirror only knew the gun in each bot's hand: they get some rounds for it; the people say what they carry
      for (const a of m.actors) {
        if (!a.bot || !a.alive) continue;
        for (const g of a.guns) if (g) a.ammo[AMMO_OF[g.id]] = Math.max(a.ammo[AMMO_OF[g.id]], AMMO_PACK[AMMO_OF[g.id]] * 3);
      }
      for (const peer of this.peers.values()) peer.inv = false;
      this.lootBase = this.world ? baseLoot(this.world, this.seed) : null;
      this.markLootSent(m);
      this.sendSync();
      this.send({ k: 'inv?' });
      for (const seat of this.peers.keys()) this.sendRoyaleStart(m, seat);
      return;
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

  /** Online result: breach, the people on the winning team (the lowest seat stands for them); otherwise the winner if
   * a person won; or nobody. */
  result(): { winner: number | null; team: number[] } {
    const m = this.match;
    if (!m || m.winner < 0) return { winner: null, team: [] };
    if (m.mode !== 'breach') {
      const w = m.actors[m.winner];
      return w && !w.bot && w.seat >= 0 ? { winner: w.seat, team: [w.seat] } : { winner: null, team: [] };
    }
    const team = m.actors.filter((a) => a.team === m.winner && !a.bot && a.seat >= 0).map((a) => a.seat);
    team.sort((a, b) => a - b);
    return { winner: team[0] ?? null, team };
  }
}
