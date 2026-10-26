// Messages between the host and everyone else, and checks on everything that comes in.
import { isCurse, type Curse } from './rules.ts';
import type { GamePacket, ResultPacket, Standing } from './director.ts';

export type Packet =
  | ({ k: 'G' } & GamePacket)
  | ({ k: 'R' } & ResultPacket)
  | { k: 'P'; n: number; pass: boolean }
  | { k: 'V'; n: number; c: Curse }
  | { k: 'T'; n: number; done: [number, 0 | 1][]; votes: [number, number, number] }
  | { k: 'C'; c: number; h?: number };

const T = 'dw';
export const gameOf = (g: GamePacket) => ({ t: T, k: 'G', ...g });
export const resultOf = (r: ResultPacket) => ({ t: T, k: 'R', ...r });
export const reportOf = (n: number, pass: boolean) => ({ t: T, k: 'P', n, pass });
export const voteOf = (n: number, c: Curse) => ({ t: T, k: 'V', n, c });
export const tallyOf = (n: number, done: [number, 0 | 1][], votes: [number, number, number]) => ({ t: T, k: 'T', n, done, votes });
export const clockProbeOf = (c: number) => ({ t: T, k: 'C', c });
export const clockReplyOf = (c: number, h: number) => ({ t: T, k: 'C', c, h });

const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const seat = (v: unknown): v is number => int(v, 0, 31);
const seats = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 32 && v.every(seat);
const n = (v: unknown): v is number => int(v, 0, 100_000);

function standingsOf(v: unknown): Standing[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 32) return null;
  const out: Standing[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (!seat(o.s) || !int(o.l, 0, 9) || !int(o.p, -1, 32) || !(o.b === 0 || o.b === 1) || !(o.x === 0 || o.x === 1) || typeof o.nm !== 'string') return null;
    out.push({ s: o.s, l: o.l, p: o.p, b: o.b, nm: o.nm.slice(0, 24), x: o.x });
  }
  return new Set(out.map((s) => s.s)).size === out.length ? out : null;
}

const pairs = (v: unknown): v is [number, 0 | 1][] => Array.isArray(v) && v.length <= 32 && v.every((p) => Array.isArray(p) && p.length === 2 && seat(p[0]) && (p[1] === 0 || p[1] === 1));

export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== T) return null;
  if (p.k === 'C') {
    if (!Number.isFinite(p.c)) return null;
    if (Object.prototype.hasOwnProperty.call(p, 'h')) {
      return Number.isFinite(p.h) ? { k: 'C', c: p.c as number, h: p.h as number } : null;
    }
    return { k: 'C', c: p.c as number };
  }
  if (!n(p.n)) return null;
  if (p.k === 'P') return typeof p.pass === 'boolean' ? { k: 'P', n: p.n, pass: p.pass } : null;
  if (p.k === 'V') return isCurse(p.c) ? { k: 'V', n: p.n, c: p.c } : null;
  if (p.k === 'T') {
    const votes = p.votes;
    if (!pairs(p.done) || !Array.isArray(votes) || votes.length !== 3 || !votes.every((x) => int(x, 0, 32))) return null;
    return { k: 'T', n: p.n, done: p.done, votes: votes as [number, number, number] };
  }
  const st = standingsOf(p.st);
  if (!st || typeof p.sudden !== 'boolean') return null;
  if (p.k === 'G') {
    if (!int(p.seed, 0, 0xffffffff) || !Number.isFinite(p.at) || !(p.curse === null || isCurse(p.curse)) || !seats(p.cursed)) return null;
    return { k: 'G', n: p.n, seed: p.seed, at: p.at as number, curse: p.curse as Curse | null, cursed: p.cursed, sudden: p.sudden, st };
  }
  if (p.k === 'R') {
    if (!pairs(p.res) || typeof p.shared !== 'boolean' || !seats(p.lost) || !seats(p.elim) || typeof p.over !== 'boolean' || !(p.winner === null || seat(p.winner))) return null;
    return { k: 'R', n: p.n, res: p.res, shared: p.shared, lost: p.lost, elim: p.elim, st, sudden: p.sudden, over: p.over, winner: p.winner as number | null };
  }
  return null;
}
