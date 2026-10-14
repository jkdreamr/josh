// Online packets for Chained. Pure, so it can be tested.
//
// Every client moves its own soul and reports it; the host relays everyone to everyone, keeps the clock, decides
// respawns and calls the result. Crumbling ledges travel as events from whoever stepped on them. Rooms are a star
// around the host, so guests send to the host and the host sends to all.
import { flagsOf, isMode, type Mode, type Soul } from './logic.ts';

/** A soul as the network sees it. */
export type Report = { x: number; y: number; z: number; vx: number; vy: number; vz: number; flags: number };
export type SeatReport = Report & { seat: number };

export type NetEv =
  /** A ledge started crumbling at host time `at`. */
  | { y: 'crumble'; id: number; at: number }
  /** The sender burned. */
  | { y: 'burn' }
  /** The sender fell too far below the beacon (Beginner) and asks for a respawn. */
  | { y: 'fell' }
  /** Host: everyone to beacon cp at host time `at`. */
  | { y: 'respawn'; cp: number; at: number }
  /** The sender lit beacon cp. */
  | { y: 'cp'; cp: number };

export type Packet =
  | { k: 'S'; round: number; time: number; cp: number; mode: Mode; roster: number[]; souls: SeatReport[] }
  | { k: 's'; round: number; soul: Report }
  | { k: 'e'; round: number; o: number; ev: NetEv[] }
  | { k: 'end'; round: number; won: boolean; time: number; height: number }
  | { k: 'cfg'; round: number; mode: Mode };

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const seatOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 16;

export const reportOf = (s: Soul): Report => ({ x: r2(s.x), y: r2(s.y), z: r2(s.z), vx: r2(s.vx), vy: r2(s.vy), vz: r2(s.vz), flags: flagsOf(s) });

const pack = (r: Report) => [r.x, r.y, r.z, r.vx, r.vy, r.vz, r.flags];
function unpack(a: unknown): Report | null {
  if (!Array.isArray(a) || a.length < 7 || !a.slice(0, 7).every(num)) return null;
  const [x, y, z, vx, vy, vz, flags] = a as number[];
  return { x, y, z, vx, vy, vz, flags: flags | 0 };
}

export const hostState = (round: number, time: number, cp: number, mode: Mode, roster: number[], souls: SeatReport[]) => ({
  t: 'ch',
  r: round,
  k: 'S',
  tm: r2(time),
  cp,
  m: mode,
  ro: roster,
  so: souls.map((s) => [s.seat, ...pack(s)]),
});
export const guestState = (round: number, soul: Report) => ({ t: 'ch', r: round, k: 's', so: pack(soul) });
export const events = (round: number, origin: number, ev: NetEv[]) => ({ t: 'ch', r: round, k: 'e', o: origin, ev });
export const endOf = (round: number, won: boolean, time: number, height: number) => ({ t: 'ch', r: round, k: 'end', w: won, tm: r2(time), h: r2(height) });
/** The host's pick for the next climb, sent while the room waits so guests can see it. */
export const configOf = (round: number, mode: Mode) => ({ t: 'ch', r: round, k: 'cfg', m: mode });

function parseEv(v: unknown): NetEv | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (e.y === 'crumble') return num(e.id) && num(e.at) ? { y: 'crumble', id: e.id | 0, at: e.at } : null;
  if (e.y === 'burn') return { y: 'burn' };
  if (e.y === 'fell') return { y: 'fell' };
  if (e.y === 'respawn') return Number.isInteger(e.cp) && (e.cp as number) >= 0 && num(e.at) ? { y: 'respawn', cp: e.cp as number, at: e.at } : null;
  if (e.y === 'cp') return Number.isInteger(e.cp) && (e.cp as number) >= 0 ? { y: 'cp', cp: e.cp as number } : null;
  return null;
}

/** Reads a Chained packet from the room, or null for anything else. */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'ch' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (p.k === 's') {
    const soul = unpack(p.so);
    return soul ? { k: 's', round, soul } : null;
  }
  if (p.k === 'S') {
    if (!num(p.tm) || !Number.isInteger(p.cp) || !isMode(p.m) || !Array.isArray(p.ro) || !Array.isArray(p.so)) return null;
    const roster = p.ro.filter(seatOk).slice(0, 16);
    const souls: SeatReport[] = [];
    for (const raw of p.so.slice(0, 16)) {
      if (!Array.isArray(raw) || !seatOk(raw[0])) continue;
      const soul = unpack(raw.slice(1));
      if (soul) souls.push({ seat: raw[0], ...soul });
    }
    return { k: 'S', round, time: p.tm, cp: p.cp as number, mode: p.m, roster, souls };
  }
  if (p.k === 'e') {
    if (!seatOk(p.o) || !Array.isArray(p.ev)) return null;
    return { k: 'e', round, o: p.o, ev: p.ev.slice(0, 32).map(parseEv).filter((e): e is NetEv => e !== null) };
  }
  if (p.k === 'end') return typeof p.w === 'boolean' && num(p.tm) && num(p.h) ? { k: 'end', round, won: p.w, time: p.tm, height: p.h } : null;
  if (p.k === 'cfg') return isMode(p.m) ? { k: 'cfg', round, mode: p.m } : null;
  return null;
}

/** Nudges a guest's clock toward the host's: a snap when far off, a tenth of the way when close. */
export function syncClock(local: number, host: number) {
  const diff = host - local;
  if (Math.abs(diff) > 0.25) return host;
  return local + diff * 0.1;
}
