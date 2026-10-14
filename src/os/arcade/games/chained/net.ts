// Online packets for Chained. Pure, so it can be tested.
//
// Every client moves its own souls and reports them; the host relays everyone to everyone, keeps the clock, decides
// respawns and calls the result. Souls travel by index: every client builds the same soul list from the roster and
// the mode (seatSouls in logic.ts), so a seat that climbs two souls in a race, or the shades the host climbs for an
// empty team, need no seat of their own. Crumbling ledges travel as events from whoever stepped on them. Rooms are a
// star around the host, so guests send to the host and the host sends to all.
import { MAX_SOULS, MAX_TEAMS, flagsOf, isMode, type Mode, type Soul } from './logic.ts';
import { isShadeLevel, type ShadeLevel } from './shade.ts';

/** A soul as the network sees it. */
export type Report = { x: number; y: number; z: number; vx: number; vy: number; vz: number; flags: number };
export type SoulReport = Report & { i: number };

export type NetEv =
  /** A ledge started crumbling at host time `at`. */
  | { y: 'crumble'; id: number; at: number }
  /** The sender's soul i burned. */
  | { y: 'burn'; i: number }
  /** The sender's team fell too far below the beacon (Beginner) and asks for a respawn. */
  | { y: 'fell'; team: number }
  /** Host: a team to beacon cp at host time `at`. */
  | { y: 'respawn'; cp: number; at: number; team: number }
  /** The sender's soul i lit beacon cp. */
  | { y: 'cp'; cp: number; i: number };

export type Packet =
  | { k: 'S'; round: number; time: number; cp: number; mode: Mode; shades: ShadeLevel; roster: number[]; souls: SoulReport[] }
  | { k: 's'; round: number; souls: SoulReport[] }
  | { k: 'e'; round: number; o: number; ev: NetEv[] }
  /** The result: won by team `winner` at `time`, or lost to the lava at `height` (winner -1). */
  | { k: 'end'; round: number; won: boolean; time: number; height: number; winner: number }
  | { k: 'cfg'; round: number; mode: Mode; shades: ShadeLevel };

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const seatOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 16;
const soulOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_SOULS;
const teamOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_TEAMS;

export const reportOf = (s: Soul): SoulReport => ({ i: s.idx, x: r2(s.x), y: r2(s.y), z: r2(s.z), vx: r2(s.vx), vy: r2(s.vy), vz: r2(s.vz), flags: flagsOf(s) });

const pack = (r: SoulReport) => [r.i, r.x, r.y, r.z, r.vx, r.vy, r.vz, r.flags];
function unpack(a: unknown): SoulReport | null {
  if (!Array.isArray(a) || a.length < 8 || !soulOk(a[0]) || !a.slice(1, 8).every(num)) return null;
  const [i, x, y, z, vx, vy, vz, flags] = a as number[];
  return { i, x, y, z, vx, vy, vz, flags: flags | 0 };
}
function unpackAll(a: unknown): SoulReport[] {
  if (!Array.isArray(a)) return [];
  const out: SoulReport[] = [];
  for (const raw of a.slice(0, MAX_SOULS)) {
    const soul = unpack(raw);
    if (soul && !out.some((s) => s.i === soul.i)) out.push(soul);
  }
  return out;
}

export const hostState = (round: number, time: number, cp: number, mode: Mode, shades: ShadeLevel, roster: number[], souls: SoulReport[]) => ({
  t: 'ch',
  r: round,
  k: 'S',
  tm: r2(time),
  cp,
  m: mode,
  sh: shades,
  ro: roster,
  so: souls.map(pack),
});
export const guestState = (round: number, souls: SoulReport[]) => ({ t: 'ch', r: round, k: 's', so: souls.map(pack) });
export const events = (round: number, origin: number, ev: NetEv[]) => ({ t: 'ch', r: round, k: 'e', o: origin, ev });
export const endOf = (round: number, won: boolean, time: number, height: number, winner = 0) => ({ t: 'ch', r: round, k: 'end', w: won, tm: r2(time), h: r2(height), wn: winner });
/** The host's pick for the next climb, sent while the room waits so guests can see it. */
export const configOf = (round: number, mode: Mode, shades: ShadeLevel) => ({ t: 'ch', r: round, k: 'cfg', m: mode, sh: shades });

function parseEv(v: unknown): NetEv | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (e.y === 'crumble') return num(e.id) && num(e.at) ? { y: 'crumble', id: e.id | 0, at: e.at } : null;
  if (e.y === 'burn') return soulOk(e.i) ? { y: 'burn', i: e.i } : null;
  if (e.y === 'fell') return teamOk(e.team) ? { y: 'fell', team: e.team } : null;
  if (e.y === 'respawn') return Number.isInteger(e.cp) && (e.cp as number) >= 0 && num(e.at) && teamOk(e.team) ? { y: 'respawn', cp: e.cp as number, at: e.at, team: e.team } : null;
  if (e.y === 'cp') return Number.isInteger(e.cp) && (e.cp as number) >= 0 && soulOk(e.i) ? { y: 'cp', cp: e.cp as number, i: e.i } : null;
  return null;
}

/** Reads a Chained packet from the room, or null for anything else. */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'ch' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (p.k === 's') {
    const souls = unpackAll(p.so);
    return souls.length ? { k: 's', round, souls } : null;
  }
  if (p.k === 'S') {
    if (!num(p.tm) || !Number.isInteger(p.cp) || !isMode(p.m) || !isShadeLevel(p.sh) || !Array.isArray(p.ro)) return null;
    const roster = p.ro.filter(seatOk).slice(0, 16);
    return { k: 'S', round, time: p.tm, cp: p.cp as number, mode: p.m, shades: p.sh, roster, souls: unpackAll(p.so) };
  }
  if (p.k === 'e') {
    if (!seatOk(p.o) || !Array.isArray(p.ev)) return null;
    return { k: 'e', round, o: p.o, ev: p.ev.slice(0, 32).map(parseEv).filter((e): e is NetEv => e !== null) };
  }
  if (p.k === 'end') {
    if (typeof p.w !== 'boolean' || !num(p.tm) || !num(p.h)) return null;
    const winner = Number.isInteger(p.wn) ? Math.max(-1, Math.min(MAX_TEAMS - 1, p.wn as number)) : 0;
    return { k: 'end', round, won: p.w, time: p.tm, height: p.h, winner };
  }
  if (p.k === 'cfg') return isMode(p.m) && isShadeLevel(p.sh) ? { k: 'cfg', round, mode: p.m, shades: p.sh } : null;
  return null;
}

/** Nudges a guest's clock toward the host's: a snap when far off, a tenth of the way when close. */
export function syncClock(local: number, host: number) {
  const diff = host - local;
  if (Math.abs(diff) > 0.25) return host;
  return local + diff * 0.1;
}
