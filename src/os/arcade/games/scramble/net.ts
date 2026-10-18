// Online packets for Scramble. Pure, so it can be tested.
//
// Rooms are a star around the host. Every client reports the egg it owns about 15 times a second; the host owns the
// computer players and sends everyone the whole match. Things that happen (shots, hits, drops, walls, pickups) travel
// as events: a guest sends its own to the host, and the host applies them and passes them on to everyone else, in the
// order it applied them, together with its own. Guests ask the host for pickups and chests (fridges and supply drops
// too) and hear back who got them. Broken windows travel as news too, and every reliable report from the host lists
// them all, so a guest who missed the news (or synced late) still has them. Bounce pads and campfires need no packets: a glide and a heal are an owner's own
// business, and show in its state.
import { MAX_ARMOR, MAX_RARITY, MELEE, THROWS, WEAPONS, damageOf, isMelee, isThrow, isWeapon, parseLoot, type LootDef, type ThrowId, type WeaponId } from './items.ts';
import { HALF } from './map.ts';
import { meta } from './meta.ts';
import {
  CAUSES,
  F_ALL,
  HELD,
  MAX_FIGHTERS,
  PHASES,
  addLoot,
  addWall,
  applyCalled,
  applyOut,
  applyTook,
  breakGlass,
  callDrop,
  damageCrate,
  damageWall,
  fire,
  flagsOf,
  grantTake,
  held,
  hurt,
  isLevel,
  launch,
  makeWall,
  moveLoot,
  openContainer,
  owned,
  removeWall,
  type Cause,
  type Ev,
  type Fighter,
  type Held,
  type Level,
  type Match,
  type Phase,
} from './logic.ts';

/** Whether the host fills empty places with computer players. */
export type Bots = 'fill' | 'none';
export const isBots = (v: unknown): v is Bots => v === 'fill' || v === 'none';

/** An egg as its owner reports it, down to the helmet and vest it wears. */
export type State = { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: Held | null; r: number; flags: number; helmet: number; vest: number };

export type NetEv =
  | { y: 's'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number }
  | { y: 'sw'; f: number }
  | { y: 'th'; f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; ft: number }
  | { y: 'd'; f: number; to: number; d: number; w: Cause; x: number; z: number }
  | { y: 'm'; f: number; k: 'wall' | 'crate'; id: number; d: number }
  | { y: 'gl'; f: number; i: number }
  | { y: 'b'; f: number; x: number; z: number }
  | { y: 'o'; f: number; by: number; w: Cause }
  | { y: 'dr'; id: number; x: number; z: number; by: number; it: LootDef }
  | { y: 'tk'; f: number; id: number }
  | { y: 'tko'; f: number; id: number; it: LootDef }
  | { y: 'op'; f: number; c: number }
  | { y: 'opd'; c: number; f: number }
  | { y: 'wl'; id: number; f: number; x: number; z: number; a: number; hp: number }
  | { y: 'wg'; id: number }
  | { y: 'lv'; id: number; x: number; z: number }
  | { y: 'fd'; f: number; c: number; x: number; z: number; at: number };

/** Events grouped by the seat they came from, in the order the host applied them. */
export type Group = [origin: number, events: NetEv[]];

export type Packet =
  | { k: 's'; round: number; state: State; watch: number }
  | { k: 'S'; round: number; seed: number; time: number; level: Level; roster: number[] | null; states: [number, State][]; glass: number[] | null }
  | { k: 'e'; round: number; groups: Group[] }
  | { k: 'end'; round: number; winner: number; places: [number, number, number][] }
  | { k: 'cfg'; round: number; bots: Bots; level: Level };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const fid = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < MAX_FIGHTERS;
/** Room seats: -1 for a computer egg. */
const SEATS = meta.online?.seats ?? 1;
const seat = (v: unknown): v is number => int(v) && (v as number) >= -1 && (v as number) < SEATS;
const isCause = (v: unknown): v is Cause => CAUSES.includes(v as Cause);
/**
 * The most one hit from another client can do: a legendary bullet or pellet, a swing, or a grenade right on top. The
 * rest (the storm, hot sauce, barrels, impulse eggs) each client works out for its own egg, so never arrives as a hit.
 */
export function hitCap(w: Cause) {
  if (isWeapon(w)) return Math.round(damageOf(w, MAX_RARITY));
  if (isMelee(w)) return MELEE[w].dmg;
  return w === 'grenade' ? (THROWS.grenade.dmg ?? 0) : 0;
}
/** Loot and wall ids: whole numbers well inside what JSON carries exactly. */
const id = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < 1e9;
/** A point on the island. */
const onLand = (x: unknown, z: unknown) => num(x) && num(z) && Math.abs(x) <= HALF && Math.abs(z) <= HALF;
/** The most a shot's spread can be widened: on the move, with a heavy SMG climbing as far as it goes. */
export const MAX_KICK = r2(1.6 + Math.max(...Object.values(WEAPONS).map((w) => w.kick?.max ?? 0)));

// -------------------------------------------------------------------------------------------------------------------
// States.

/** Positions travel in twentieths of a meter. */
const r20 = (n: number) => Math.round(n * 20) / 20;

export function stateOf(f: Fighter): State {
  const h = held(f);
  return { x: r20(f.x), z: r20(f.z), y: r1(f.y), aim: r2(f.aim), vx: r1(f.vx + f.kx), vz: r1(f.vz + f.kz), phase: f.phase, hp: r1(f.hp), shield: r1(f.shield), w: h.w, r: h.r, flags: flagsOf(f), helmet: f.helmet, vest: f.vest };
}

/** What an egg holds, as a number: 0 for nothing reported yet, then guns, melee weapons and throwables. */
const HELD_CODES: (Held | null)[] = [null, ...HELD];
/**
 * An egg's state as ten whole numbers, the fewest bytes for fifty eggs at a time: where it is (in twentieths of a
 * meter), how high and how fast (tenths), its aim (hundredths of a radian), what it is up to in one number (its
 * phase, what it holds and how rare, its helmet and vest, each in bits of its own), health and shield (tenths) and its
 * flags.
 */
const packState = (s: State) => [
  Math.round(s.x * 20),
  Math.round(s.z * 20),
  Math.round(s.y * 10),
  Math.round(s.aim * 100),
  Math.round(s.vx * 10),
  Math.round(s.vz * 10),
  codeOf(s),
  Math.round(s.hp * 10),
  Math.round(s.shield * 10),
  s.flags,
];

/** Phase, what's in hand and how rare, helmet and vest in one number; -1 (which no report gets past) for nonsense. */
function codeOf(s: State) {
  const fields = [s.r, s.helmet, s.vest];
  if (!fields.every((v) => Number.isInteger(v) && v >= 0) || s.r > MAX_RARITY || s.helmet > MAX_ARMOR || s.vest > MAX_ARMOR) return -1;
  return PHASES.indexOf(s.phase) + 4 * HELD_CODES.indexOf(s.w) + 256 * s.r + 2048 * s.helmet + 16384 * s.vest;
}

function unpackState(a: unknown): State | null {
  if (!Array.isArray(a) || a.length < 10 || !a.slice(0, 10).every(int)) return null;
  const [x, z, y, aim, vx, vz, code, hp, shield, flags] = a as number[];
  if (code < 0 || code >= 16384 * (MAX_ARMOR + 1) || flags < 0 || flags > F_ALL) return null;
  const phase = PHASES[code % 4];
  const w = Math.floor(code / 4) % 64;
  const r = Math.floor(code / 256) % 8;
  const helmet = Math.floor(code / 2048) % 8;
  const vest = Math.floor(code / 16384);
  if (w >= HELD_CODES.length || r > MAX_RARITY || helmet > MAX_ARMOR) return null;
  if (Math.abs(x) > 8000 || Math.abs(z) > 8000 || y < -10 || y > 1000 || Math.abs(aim) > 10_000 || hp < 0 || hp > 1000 || shield < 0 || shield > 1000) return null;
  const clampV = (v: number) => Math.max(-40, Math.min(40, v / 10));
  return { x: x / 20, z: z / 20, y: y / 10, aim: aim / 100, vx: clampV(vx), vz: clampV(vz), phase, hp: hp / 10, shield: shield / 10, w: HELD_CODES[w], r, flags, helmet, vest };
}

/** A guest's report of its egg, and the egg it watches once its own is out (so the host knows what it needs to see). */
export const guestState = (round: number, s: State, watch = -1) => ({ t: 'pk', r: round, k: 's', c: packState(s), ...(watch >= 0 ? { v: watch } : {}) });

/** A state as a string, to tell whether it has changed since it was last sent. */
export const stateKey = (s: State) => packState(s).join();

/**
 * The host's report of the eggs: the roster goes with every reliable one (null for the rest), which a guest needs to
 * join, and so do the broken windows (`broken`, by window) once there are any.
 */
export const hostState = (round: number, seed: number, time: number, level: Level, roster: number[] | null, states: [number, State][], broken: boolean[] = []) => {
  const gl = roster ? packGlass(broken) : '';
  return {
    t: 'pk',
    r: round,
    k: 'S',
    sd: seed,
    tm: r2(time),
    lv: level,
    ...(roster ? { ro: roster } : {}),
    ...(gl ? { gl } : {}),
    c: states.map(([f, s]) => [f, ...packState(s)]),
  };
};

/** The most windows a report can list (an island has a couple of hundred). */
const MAX_GLASS = 4000;

/** Broken windows as hex digits, four windows a digit (the first in the lowest bit), trailing zeros left off. */
export function packGlass(broken: boolean[]) {
  let out = '';
  for (let k = 0; k * 4 < broken.length; k++) out += ((broken[k * 4] ? 1 : 0) | (broken[k * 4 + 1] ? 2 : 0) | (broken[k * 4 + 2] ? 4 : 0) | (broken[k * 4 + 3] ? 8 : 0)).toString(16);
  return out.replace(/0+$/, '');
}

/** The windows a hex list says are broken, or null when it isn't one. */
export function unpackGlass(v: unknown): number[] | null {
  if (typeof v !== 'string' || v.length > MAX_GLASS / 4 || !/^[0-9a-f]*$/.test(v)) return null;
  const out: number[] = [];
  for (let k = 0; k < v.length; k++) {
    const n = parseInt(v[k], 16);
    for (let j = 0; j < 4; j++) if (n & (1 << j)) out.push(k * 4 + j);
  }
  return out;
}

export const endOf = (round: number, winner: number, places: [number, number, number][]) => ({ t: 'pk', r: round, k: 'end', w: winner, pl: places });

/** The host's picks for the next match, sent while the room waits so guests can see them. */
export const configOf = (round: number, bots: Bots, level: Level) => ({ t: 'pk', r: round, k: 'cfg', b: bots, lv: level });

// -------------------------------------------------------------------------------------------------------------------
// Events.

/** The network form of something that happened here, or null when nobody else needs to hear it. */
export function toNet(e: Ev): NetEv | null {
  if (e.net) return null;
  switch (e.t) {
    case 'shot':
      return { y: 's', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k };
    case 'swing':
      return { y: 'sw', f: e.f };
    case 'throw':
      return { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft };
    case 'hit':
      return e.local ? null : { y: 'd', f: e.f, to: e.to, d: e.d, w: e.w, x: e.x, z: e.z };
    case 'smash':
      return { y: 'm', f: e.f, k: e.kind, id: e.id, d: e.d };
    case 'glass':
      return { y: 'gl', f: e.f, i: e.i };
    case 'boom':
      return { y: 'b', f: e.f, x: e.x, z: e.z };
    case 'out':
      return { y: 'o', f: e.f, by: e.by, w: e.w };
    case 'drop':
      return { y: 'dr', id: e.item.id, x: e.item.x, z: e.item.z, by: e.item.by, it: e.item.def };
    case 'take':
      return { y: 'tk', f: e.f, id: e.id };
    case 'took':
      return { y: 'tko', f: e.f, id: e.id, it: e.def };
    case 'open':
      return { y: 'op', f: e.f, c: e.c };
    case 'opened':
      return { y: 'opd', c: e.c, f: e.f };
    case 'wall':
      return { y: 'wl', id: e.wall.id, f: e.wall.f, x: e.wall.x, z: e.wall.z, a: e.wall.a, hp: Math.round(e.wall.hp) };
    case 'wallgone':
      return { y: 'wg', id: e.id };
    case 'moved':
      return { y: 'lv', id: e.id, x: e.x, z: e.z };
    case 'called':
      return { y: 'fd', f: e.f, c: e.c, x: e.x, z: e.z, at: e.at };
    default:
      return null;
  }
}

/** The egg an event speaks for, which must belong to the seat that sent it. -1 for events that speak for none. */
export function actorOf(e: NetEv) {
  switch (e.y) {
    case 'dr':
      return e.by;
    case 'opd':
    case 'wg':
    case 'lv':
    case 'fd':
      return -1;
    default:
      return e.f;
  }
}

function parseEv(v: unknown): NetEv | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  switch (e.y) {
    case 's':
      return fid(e.f) && isWeapon(e.w) && int(e.r) && num(e.x) && num(e.z) && num(e.a) && int(e.s) && num(e.k) && e.k >= 1 && e.k <= MAX_KICK
        ? { y: 's', f: e.f, w: e.w, r: Math.max(0, Math.min(4, e.r)), x: e.x, z: e.z, a: e.a, s: e.s, k: e.k }
        : null;
    case 'sw':
      return fid(e.f) ? { y: 'sw', f: e.f } : null;
    case 'th':
      return fid(e.f) && isThrow(e.k) && num(e.x) && num(e.z) && num(e.lx) && num(e.lz) && num(e.ft) && e.ft > 0 && e.ft <= 3 && Math.hypot(e.lx - e.x, e.lz - e.z) <= 25
        ? { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft }
        : null;
    case 'd':
      return fid(e.f) && fid(e.to) && num(e.d) && isCause(e.w) && e.d > 0 && e.d <= hitCap(e.w) && num(e.x) && num(e.z) ? { y: 'd', f: e.f, to: e.to, d: e.d, w: e.w, x: e.x, z: e.z } : null;
    case 'm':
      return fid(e.f) && (e.k === 'wall' || e.k === 'crate') && id(e.id) && num(e.d) && e.d > 0 && e.d <= 1000 ? { y: 'm', f: e.f, k: e.k, id: e.id, d: e.d } : null;
    case 'gl':
      return int(e.f) && e.f >= -1 && e.f < MAX_FIGHTERS && int(e.i) && e.i >= 0 && e.i < MAX_GLASS ? { y: 'gl', f: e.f, i: e.i } : null;
    case 'b':
      return fid(e.f) && num(e.x) && num(e.z) ? { y: 'b', f: e.f, x: e.x, z: e.z } : null;
    case 'o':
      return fid(e.f) && int(e.by) && (e.by === -1 || fid(e.by)) && isCause(e.w) ? { y: 'o', f: e.f, by: e.by, w: e.w } : null;
    case 'dr': {
      const it = parseLoot(e.it);
      return it && id(e.id) && num(e.x) && num(e.z) && fid(e.by) ? { y: 'dr', id: e.id, x: e.x, z: e.z, by: e.by, it } : null;
    }
    case 'tk':
      return fid(e.f) && id(e.id) ? { y: 'tk', f: e.f, id: e.id } : null;
    case 'tko': {
      const it = parseLoot(e.it);
      return it && fid(e.f) && id(e.id) ? { y: 'tko', f: e.f, id: e.id, it } : null;
    }
    case 'op':
      return fid(e.f) && int(e.c) && e.c >= 0 ? { y: 'op', f: e.f, c: e.c } : null;
    case 'opd':
      return int(e.c) && e.c >= 0 && int(e.f) && e.f >= -1 && e.f < MAX_FIGHTERS ? { y: 'opd', c: e.c, f: e.f } : null;
    case 'wl':
      return id(e.id) && fid(e.f) && num(e.x) && num(e.z) && num(e.a) && num(e.hp) && e.hp > 0 && e.hp <= 1000 ? { y: 'wl', id: e.id, f: e.f, x: e.x, z: e.z, a: e.a, hp: e.hp } : null;
    case 'wg':
      return id(e.id) ? { y: 'wg', id: e.id } : null;
    case 'lv':
      return id(e.id) && onLand(e.x, e.z) ? { y: 'lv', id: e.id, x: e.x as number, z: e.z as number } : null;
    case 'fd':
      return fid(e.f) && int(e.c) && e.c >= 0 && e.c < 10_000 && onLand(e.x, e.z) && num(e.at) && e.at >= 0 && e.at <= 3600 ? { y: 'fd', f: e.f, c: e.c, x: e.x as number, z: e.z as number, at: e.at } : null;
    default:
      return null;
  }
}

/**
 * Applies an event from another client. The host also settles requests (pickups, chests) here; what it decides comes
 * out as new events of its own. Returns false for an event the receiver should not pass on.
 */
export function applyNet(m: Match, e: NetEv): boolean {
  const f = 'f' in e && e.f >= 0 ? m.fighters[e.f] : undefined;
  switch (e.y) {
    case 's':
      if (!f || owned(f)) return false;
      // a silent shot keeps the shooter hidden here too, as it does on the shooter's own screen
      if (!WEAPONS[e.w].silent) f.firedAt = m.clock;
      fire(m, e.f, e.w, e.r, e.x, e.z, e.a, e.s, e.k, false);
      m.events.push({ t: 'shot', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, net: true });
      // a flare: the host sends a supply drop to where it sees that egg, whatever the shot says
      if (WEAPONS[e.w].call && m.world) callDrop(m, e.f, f.x, f.z);
      return true;
    case 'sw':
      if (!f || owned(f)) return false;
      f.firedAt = m.clock;
      m.events.push({ t: 'swing', f: e.f, net: true });
      return true;
    case 'th':
      if (!f || owned(f)) return false;
      f.firedAt = m.clock;
      launch(m, e.f, e.k, e.x, e.z, e.lx, e.lz, e.ft, false);
      m.events.push({ t: 'throw', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, net: true });
      return true;
    case 'd': {
      const to = m.fighters[e.to];
      if (to && owned(to)) hurt(m, to, e.d, e.f, e.w, false);
      return true;
    }
    case 'm':
      if (e.k === 'wall') damageWall(m, e.id, e.d, true);
      else damageCrate(m, e.id, e.d, e.f, true);
      return true;
    case 'gl':
      // passed on only the first time: glass that is already broken is old news
      return breakGlass(m, e.i, e.f, false);
    case 'b':
      m.events.push({ t: 'boom', f: e.f, x: e.x, z: e.z, net: true });
      return true;
    case 'o':
      if (!f || owned(f)) return false;
      applyOut(m, e.f, e.by, e.w);
      return true;
    case 'dr':
      addLoot(m, { id: e.id, def: e.it, x: e.x, z: e.z, by: e.by, at: m.time });
      return true;
    case 'tk':
      // only the host hands out pickups; what it decides goes out as its own 'took'
      if (m.world) grantTake(m, e.f, e.id, true);
      return false;
    case 'tko':
      if (!m.world) applyTook(m, e.f, e.id, e.it);
      return true;
    case 'op': {
      // a chest or a fridge, or a supply drop that has landed (give or take the second a guest's clock may be ahead)
      const c = m.map.containers[e.c];
      if (m.world && c && (c.kind === 'chest' || c.kind === 'fridge' || (c.kind === 'supply' && m.time >= c.at - 1))) openContainer(m, e.c, e.f, true);
      return false;
    }
    case 'opd':
      if (!m.world && m.map.containers[e.c]) openContainer(m, e.c, e.f, false);
      return true;
    case 'wl':
      addWall(m, makeWall(e.id, e.f, e.x, e.z, e.a, e.hp));
      return true;
    case 'wg':
      if (!m.world) removeWall(m, e.id, false);
      return true;
    case 'lv':
      if (!m.world) moveLoot(m, e.id, e.x, e.z, false);
      return true;
    case 'fd':
      if (!m.world) applyCalled(m, e.f, e.c, e.x, e.z, e.at);
      return true;
  }
}

/** Splits events into packets that each stay well under the room's 8 KB message limit. */
export function packEvents(round: number, queue: [number, NetEv][], max = 6000): object[] {
  const packets: object[] = [];
  let groups: Group[] = [];
  let size = 40;
  const flush = () => {
    if (groups.length) packets.push({ t: 'pk', r: round, k: 'e', g: groups });
    groups = [];
    size = 40;
  };
  for (const [origin, ev] of queue) {
    const bytes = JSON.stringify(ev).length + 1;
    const last = groups[groups.length - 1];
    const extra = last && last[0] === origin ? bytes : bytes + 12;
    if (size + extra > max && groups.length) flush();
    const tail = groups[groups.length - 1];
    if (tail && tail[0] === origin) tail[1].push(ev);
    else groups.push([origin, [ev]]);
    size += tail && tail[0] === origin ? bytes : bytes + 12;
  }
  flush();
  return packets;
}

// -------------------------------------------------------------------------------------------------------------------
// Reading packets.

/** Reads a Scramble packet from the room, or null for anything else. */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'pk' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (p.k === 's') {
    const state = unpackState(p.c);
    return state && (p.v === undefined || fid(p.v)) ? { k: 's', round, state, watch: p.v === undefined ? -1 : (p.v as number) } : null;
  }
  if (p.k === 'S') {
    if (!int(p.sd) || !num(p.tm) || !isLevel(p.lv) || !Array.isArray(p.c) || (p.ro !== undefined && !Array.isArray(p.ro))) return null;
    const glass = p.gl === undefined ? null : unpackGlass(p.gl);
    if (p.gl !== undefined && !glass) return null;
    let roster: number[] | null = null;
    if (Array.isArray(p.ro)) {
      if (p.ro.length < 1 || p.ro.length > MAX_FIGHTERS || !p.ro.every(seat)) return null;
      roster = p.ro as number[];
      const humans = roster.filter((s) => s >= 0);
      if (new Set(humans).size !== humans.length) return null;
    }
    const states: [number, State][] = [];
    for (const raw of p.c.slice(0, MAX_FIGHTERS)) {
      if (!Array.isArray(raw) || !fid(raw[0]) || (roster && raw[0] >= roster.length)) continue;
      const s = unpackState(raw.slice(1));
      if (s) states.push([raw[0], s]);
    }
    return { k: 'S', round, seed: p.sd, time: p.tm, level: p.lv, roster, states, glass };
  }
  if (p.k === 'e') {
    if (!Array.isArray(p.g)) return null;
    const groups: Group[] = [];
    let count = 0;
    for (const raw of p.g) {
      if (!Array.isArray(raw) || !int(raw[0]) || raw[0] < 0 || raw[0] >= SEATS || !Array.isArray(raw[1])) continue;
      const evs: NetEv[] = [];
      for (const ev of raw[1]) {
        if (++count > 400) break;
        const parsed = parseEv(ev);
        if (parsed) evs.push(parsed);
      }
      if (evs.length) groups.push([raw[0], evs]);
    }
    return { k: 'e', round, groups };
  }
  if (p.k === 'end') {
    if (!int(p.w) || p.w < -1 || p.w >= MAX_FIGHTERS || !Array.isArray(p.pl)) return null;
    const places = p.pl.filter((o): o is [number, number, number] => Array.isArray(o) && fid(o[0]) && int(o[1]) && o[1] >= 1 && o[1] <= MAX_FIGHTERS && int(o[2]) && o[2] >= 0).slice(0, MAX_FIGHTERS);
    return { k: 'end', round, winner: p.w, places };
  }
  if (p.k === 'cfg') return isBots(p.b) && isLevel(p.lv) ? { k: 'cfg', round, bots: p.b, level: p.lv } : null;
  return null;
}

/** Final places by fighter: the winner first, then everyone else by when they went out. */
export function placesOf(m: Match): [number, number, number][] {
  return m.fighters
    .map((f): [number, number, number] => [f.id, f.phase === 'out' ? f.place : 1, f.kills])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
