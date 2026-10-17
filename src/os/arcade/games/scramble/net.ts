// Online packets for Scramble. Pure, so it can be tested.
//
// Rooms are a star around the host. Every client reports the egg it owns about 15 times a second; the host owns the
// computer players and sends everyone the whole match. Things that happen (shots, hits, drops, walls, pickups) travel
// as events: a guest sends its own to the host, and the host applies them and passes them on to everyone else, in the
// order it applied them, together with its own. Guests ask the host for pickups and chests and hear back who got them.
import { MAX_RARITY, MELEE, THROWS, WEAPONS, damageOf, isMelee, isThrow, isWeapon, parseLoot, type LootDef, type ThrowId, type WeaponId } from './items.ts';
import {
  CAUSES,
  HELD,
  MAX_FIGHTERS,
  PHASES,
  addLoot,
  addWall,
  applyOut,
  applyTook,
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

/** An egg as its owner reports it. */
export type State = { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: Held | null; r: number; flags: number };

export type NetEv =
  | { y: 's'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number }
  | { y: 'sw'; f: number }
  | { y: 'th'; f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; ft: number }
  | { y: 'd'; f: number; to: number; d: number; w: Cause; x: number; z: number }
  | { y: 'm'; f: number; k: 'wall' | 'crate'; id: number; d: number }
  | { y: 'b'; f: number; x: number; z: number }
  | { y: 'o'; f: number; by: number; w: Cause }
  | { y: 'dr'; id: number; x: number; z: number; by: number; it: LootDef }
  | { y: 'tk'; f: number; id: number }
  | { y: 'tko'; f: number; id: number; it: LootDef }
  | { y: 'op'; f: number; c: number }
  | { y: 'opd'; c: number; f: number }
  | { y: 'wl'; id: number; f: number; x: number; z: number; a: number; hp: number }
  | { y: 'wg'; id: number };

/** Events grouped by the seat they came from, in the order the host applied them. */
export type Group = [origin: number, events: NetEv[]];

export type Packet =
  | { k: 's'; round: number; state: State }
  | { k: 'S'; round: number; seed: number; time: number; level: Level; roster: number[]; states: [number, State][] }
  | { k: 'e'; round: number; groups: Group[] }
  | { k: 'end'; round: number; winner: number; places: [number, number, number][] }
  | { k: 'cfg'; round: number; bots: Bots; level: Level };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const fid = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < MAX_FIGHTERS;
const seat = (v: unknown): v is number => int(v) && (v as number) >= -1 && (v as number) < 16;
const isCause = (v: unknown): v is Cause => CAUSES.includes(v as Cause);
/**
 * The most one hit from another client can do: a legendary bullet or pellet, a swing, or a grenade right on top. The
 * rest (the storm, hot sauce, barrels) each client works out for its own egg, so never arrives as a hit.
 */
export function hitCap(w: Cause) {
  if (isWeapon(w)) return Math.round(damageOf(w, MAX_RARITY));
  if (isMelee(w)) return MELEE[w].dmg;
  return w === 'grenade' ? (THROWS.grenade.dmg ?? 0) : 0;
}
/** Loot and wall ids: whole numbers well inside what JSON carries exactly. */
const id = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < 1e9;

// -------------------------------------------------------------------------------------------------------------------
// States.

export function stateOf(f: Fighter): State {
  const h = held(f);
  return { x: r2(f.x), z: r2(f.z), y: r1(f.y), aim: r2(f.aim), vx: r1(f.vx), vz: r1(f.vz), phase: f.phase, hp: r1(f.hp), shield: r1(f.shield), w: h.w, r: h.r, flags: flagsOf(f) };
}

/** What an egg holds, as a number: 0 for nothing reported yet, then guns, melee weapons and throwables. */
const HELD_CODES: (Held | null)[] = [null, ...HELD];
const packState = (s: State) => [s.x, s.z, s.y, s.aim, s.vx, s.vz, PHASES.indexOf(s.phase), s.hp, s.shield, HELD_CODES.indexOf(s.w), s.r, s.flags];

function unpackState(a: unknown): State | null {
  if (!Array.isArray(a) || a.length < 12 || !a.slice(0, 12).every(num)) return null;
  const [x, z, y, aim, vx, vz, ph, hp, shield, w, r, flags] = a as number[];
  const phase = PHASES[ph];
  if (!phase || !int(w) || w < 0 || w >= HELD_CODES.length || !int(r) || r < 0 || r > 4 || !int(flags) || flags < 0 || flags > 255) return null;
  if (Math.abs(x) > 400 || Math.abs(z) > 400 || y < -1 || y > 100 || hp < 0 || hp > 100 || shield < 0 || shield > 100) return null;
  return { x, z, y, aim, vx: Math.max(-40, Math.min(40, vx)), vz: Math.max(-40, Math.min(40, vz)), phase, hp, shield, w: HELD_CODES[w], r, flags };
}

export const guestState = (round: number, s: State) => ({ t: 'pk', r: round, k: 's', c: packState(s) });

export const hostState = (round: number, seed: number, time: number, level: Level, roster: number[], states: [number, State][]) => ({
  t: 'pk',
  r: round,
  k: 'S',
  sd: seed,
  tm: r2(time),
  lv: level,
  ro: roster,
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
      return { y: 's', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k };
    case 'swing':
      return { y: 'sw', f: e.f };
    case 'throw':
      return { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft };
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
      return { y: 'wl', id: e.wall.id, f: e.wall.f, x: e.wall.x, z: e.wall.z, a: e.wall.a, hp: Math.round(e.wall.hp) };
    case 'wallgone':
      return { y: 'wg', id: e.id };
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
      return fid(e.f) && isWeapon(e.w) && int(e.r) && num(e.x) && num(e.z) && num(e.a) && int(e.s) && num(e.k) && e.k >= 1 && e.k <= 2
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
      // a chest, or a supply drop that has landed (give or take the second a guest's clock may be ahead)
      const c = m.map.containers[e.c];
      if (m.world && c && (c.kind === 'chest' || (c.kind === 'supply' && m.time >= c.at - 1))) openContainer(m, e.c, e.f, true);
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
    return state ? { k: 's', round, state } : null;
  }
  if (p.k === 'S') {
    if (!int(p.sd) || !num(p.tm) || !isLevel(p.lv) || !Array.isArray(p.ro) || !Array.isArray(p.c)) return null;
    if (p.ro.length < 1 || p.ro.length > MAX_FIGHTERS || !p.ro.every(seat)) return null;
    const roster = p.ro as number[];
    const humans = roster.filter((s) => s >= 0);
    if (new Set(humans).size !== humans.length) return null;
    const states: [number, State][] = [];
    for (const raw of p.c.slice(0, MAX_FIGHTERS)) {
      if (!Array.isArray(raw) || !fid(raw[0]) || raw[0] >= roster.length) continue;
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
      if (!Array.isArray(raw) || !int(raw[0]) || raw[0] < 0 || raw[0] >= 16 || !Array.isArray(raw[1])) continue;
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
