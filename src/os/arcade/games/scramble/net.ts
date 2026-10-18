// Online packets for Scramble. Pure, so it can be tested.
//
// Rooms are a star around the host. Every client reports the egg it owns about 15 times a second; the host owns the
// computer players and sends everyone the whole match. Things that happen (shots, hits, drops, built pieces and edits,
// pickups) travel as events: a guest sends its own to the host, and the host applies them and passes them on to
// everyone else, in the order it applied them, together with its own. Guests ask the host for pickups and chests
// (fridges and supply drops too) and hear back who got them. Bounce pads and campfires need no packets: a glide and a
// heal are an owner's own business, and show in its state, as does how high an egg stands on what's been built.
import { MATS, MAT_SPECS, MAX_ARMOR, MAX_RARITY, MELEE, THROWS, WEAPONS, damageOf, isMelee, isThrow, isWeapon, parseLoot, type LootDef, type ThrowId, type WeaponId } from './items.ts';
import { HALF } from './map.ts';
import { meta } from './meta.ts';
import {
  CAUSES,
  CELL_B,
  F_ALL,
  HELD,
  LEVEL_H,
  MAX_FIGHTERS,
  MAX_LEVEL,
  PHASES,
  PIECE_KINDS,
  addLoot,
  addWall,
  applyCalled,
  applyEdit,
  applyOut,
  applyTook,
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
  makePiece,
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
  type PieceKind,
  type Wall,
} from './logic.ts';

/** Whether the host fills empty places with computer players. */
export type Bots = 'fill' | 'none';
export const isBots = (v: unknown): v is Bots => v === 'fill' || v === 'none';

/** An egg as its owner reports it, down to the helmet and vest it wears. */
export type State = { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: Held | null; r: number; flags: number; helmet: number; vest: number };

/**
 * `h` is the level a shot was fired from, `y0` and `ly` how high a throw starts and comes down (left out when 0). A
 * built piece goes as its id, its builder, where and what it is in one number (`p`, see packPiece), its health and the
 * tenths of a second it has still to build up (`t`); an edit as the wall and its edit.
 */
export type NetEv =
  | { y: 's'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number; h?: number }
  | { y: 'sw'; f: number }
  | { y: 'th'; f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; ft: number; y0?: number; ly?: number }
  | { y: 'd'; f: number; to: number; d: number; w: Cause; x: number; z: number }
  | { y: 'm'; f: number; k: 'wall' | 'crate'; id: number; d: number }
  | { y: 'b'; f: number; x: number; z: number }
  | { y: 'o'; f: number; by: number; w: Cause }
  | { y: 'dr'; id: number; x: number; z: number; by: number; it: LootDef }
  | { y: 'tk'; f: number; id: number }
  | { y: 'tko'; f: number; id: number; it: LootDef }
  | { y: 'op'; f: number; c: number }
  | { y: 'opd'; c: number; f: number }
  | { y: 'wl'; id: number; f: number; p: number; hp: number; t: number }
  | { y: 'we'; f: number; id: number; e: number }
  | { y: 'wg'; id: number }
  | { y: 'lv'; id: number; x: number; z: number }
  | { y: 'fd'; f: number; c: number; x: number; z: number; at: number };

/** Events grouped by the seat they came from, in the order the host applied them. */
export type Group = [origin: number, events: NetEv[]];

export type Packet =
  | { k: 's'; round: number; state: State; watch: number }
  | { k: 'S'; round: number; seed: number; time: number; level: Level; roster: number[] | null; states: [number, State][] }
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
/** The highest anything thrown starts or comes down: the top level. */
const MAX_Y = MAX_LEVEL * LEVEL_H + 1;
const height = (v: unknown) => v === undefined || (num(v) && v >= 0 && v <= MAX_Y);
const tossH = (v: unknown) => (num(v) ? v : 0);

// -------------------------------------------------------------------------------------------------------------------
// Built pieces.

/** Grid squares are numbered from -GRID_OFF along each side, GRID_N of them: the whole island and a little more. */
const GRID_OFF = 80;
const GRID_N = 160;
const PIECE_CODES = 4 * 4 * 4 * MATS.length * 3 * GRID_N * GRID_N;

/** Where a piece is, what it is and its edit in one whole number: kind, way, level, material, edit and grid square. */
export function packPiece(w: Wall) {
  const cell = w.cx + GRID_OFF + GRID_N * (w.cz + GRID_OFF);
  return PIECE_KINDS.indexOf(w.k) + 4 * (w.dir + 4 * (w.lv + 4 * (MATS.indexOf(w.mat) + MATS.length * (w.e + 3 * cell))));
}

/** A packed piece back, or null for anything no piece could be: off the island, on no level, a way or edit it can't have. */
export function unpackPiece(p: unknown): { k: PieceKind; dir: number; lv: number; mat: (typeof MATS)[number]; e: number; cx: number; cz: number } | null {
  if (!int(p) || p < 0 || p >= PIECE_CODES) return null;
  let v = p;
  const take = (n: number) => {
    const out = v % n;
    v = Math.floor(v / n);
    return out;
  };
  const k = PIECE_KINDS[take(4)];
  const dir = take(4);
  const lv = take(4);
  const mat = MATS[take(MATS.length)];
  const e = take(3);
  const cx = take(GRID_N) - GRID_OFF;
  const cz = v - GRID_OFF;
  if (Math.abs((cx + 0.5) * CELL_B) > HALF || Math.abs((cz + 0.5) * CELL_B) > HALF) return null;
  if (k === 'wall') return dir >= 2 && lv <= MAX_LEVEL ? { k, dir, lv, mat, e, cx, cz } : null;
  if (e) return null;
  if (k === 'ramp') return lv < MAX_LEVEL ? { k, dir, lv, mat, e, cx, cz } : null;
  if (dir) return null;
  return lv >= 1 && lv <= (k === 'roof' ? MAX_LEVEL + 1 : MAX_LEVEL) ? { k, dir, lv, mat, e, cx, cz } : null;
}

/** A piece as news: how it is now, for someone who hasn't seen it (just built, or for a guest that joins late). */
export const pieceEv = (w: Wall): NetEv => ({ y: 'wl', id: w.id, f: w.f, p: packPiece(w), hp: Math.max(1, Math.round(w.hp)), t: Math.round(w.left * 10) });

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

/** The host's report of the eggs: the roster goes with every reliable one (null for the rest), which a guest needs to join. */
export const hostState = (round: number, seed: number, time: number, level: Level, roster: number[] | null, states: [number, State][]) => ({
  t: 'pk',
  r: round,
  k: 'S',
  sd: seed,
  tm: r2(time),
  lv: level,
  ...(roster ? { ro: roster } : {}),
  c: states.map(([f, s]) => [f, ...packState(s)]),
});

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
      return { y: 's', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, ...(e.h ? { h: e.h } : {}) };
    case 'swing':
      return { y: 'sw', f: e.f };
    case 'throw':
      return { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, ...(e.y0 ? { y0: e.y0 } : {}), ...(e.ly ? { ly: e.ly } : {}) };
    case 'hit':
      return e.local ? null : { y: 'd', f: e.f, to: e.to, d: e.d, w: e.w, x: e.x, z: e.z };
    case 'smash':
      return { y: 'm', f: e.f, k: e.kind, id: e.id, d: e.d };
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
      // a wall put down by hand (in a test) is nowhere on the grid, so nobody else hears of it
      return e.wall.dir >= 0 ? pieceEv(e.wall) : null;
    case 'edit':
      return { y: 'we', f: e.f, id: e.id, e: e.e };
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
    case 's': {
      const h = e.h === undefined ? 0 : e.h;
      return fid(e.f) && isWeapon(e.w) && int(e.r) && num(e.x) && num(e.z) && num(e.a) && int(e.s) && num(e.k) && e.k >= 1 && e.k <= MAX_KICK && int(h) && h >= 0 && h <= MAX_LEVEL
        ? { y: 's', f: e.f, w: e.w, r: Math.max(0, Math.min(4, e.r)), x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, ...(h ? { h } : {}) }
        : null;
    }
    case 'sw':
      return fid(e.f) ? { y: 'sw', f: e.f } : null;
    case 'th':
      return fid(e.f) && isThrow(e.k) && num(e.x) && num(e.z) && num(e.lx) && num(e.lz) && num(e.ft) && e.ft > 0 && e.ft <= 3 && Math.hypot(e.lx - e.x, e.lz - e.z) <= 25 && height(e.y0) && height(e.ly)
        ? { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, ...(tossH(e.y0) ? { y0: tossH(e.y0) } : {}), ...(tossH(e.ly) ? { ly: tossH(e.ly) } : {}) }
        : null;
    case 'd':
      return fid(e.f) && fid(e.to) && num(e.d) && isCause(e.w) && e.d > 0 && e.d <= hitCap(e.w) && num(e.x) && num(e.z) ? { y: 'd', f: e.f, to: e.to, d: e.d, w: e.w, x: e.x, z: e.z } : null;
    case 'm':
      return fid(e.f) && (e.k === 'wall' || e.k === 'crate') && id(e.id) && num(e.d) && e.d > 0 && e.d <= 1000 ? { y: 'm', f: e.f, k: e.k, id: e.id, d: e.d } : null;
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
    case 'wl': {
      const at = unpackPiece(e.p);
      return at && id(e.id) && fid(e.f) && int(e.hp) && e.hp > 0 && e.hp <= MAT_SPECS[at.mat].hp && int(e.t) && e.t >= 0 && e.t <= MAT_SPECS[at.mat].time * 10 + 1 ? { y: 'wl', id: e.id, f: e.f, p: e.p as number, hp: e.hp, t: e.t } : null;
    }
    case 'we':
      return fid(e.f) && id(e.id) && int(e.e) && e.e >= 0 && e.e <= 2 ? { y: 'we', f: e.f, id: e.id, e: e.e } : null;
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
      fire(m, e.f, e.w, e.r, e.x, e.z, e.a, e.s, e.k, false, e.h ?? 0);
      m.events.push({ t: 'shot', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, h: e.h ?? 0, net: true });
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
      launch(m, e.f, e.k, e.x, e.z, e.lx, e.lz, e.ft, false, e.y0 ?? 0, e.ly ?? 0);
      m.events.push({ t: 'throw', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, y0: e.y0 ?? 0, ly: e.ly ?? 0, net: true });
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
    case 'wl': {
      // a piece already here (a packet heard twice) isn't news, nor one the host turns down for standing where another does
      const at = unpackPiece(e.p);
      return !!at && addWall(m, makePiece(e.id, e.f, at.k, at.mat, at.cx, at.cz, at.lv, at.dir, e.hp, e.t / 10, at.e));
    }
    case 'we':
      return applyEdit(m, e.f, e.id, e.e);
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
    return { k: 'S', round, seed: p.sd, time: p.tm, level: p.lv, roster, states };
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
