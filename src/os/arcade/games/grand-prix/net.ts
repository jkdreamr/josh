// Online packets. Every client drives its own car and reports it; the host relays everyone to everyone (rooms are a
// star around the host), drives the bots, picks the laps and the start time, and calls the result. Pure and testable.
import type { NetCar } from './race.ts';

export type Packet =
  /** Host state: seconds to lights out (negative once racing), laps, the grid by seat, and every car. */
  | { k: 'S'; round: number; go: number; laps: number; roster: number[]; teams: number[]; cars: [number, NetCar][] }
  /** A guest's own car. */
  | { k: 's'; round: number; car: NetCar }
  /** The host's lap count, shown in the lobby. */
  | { k: 'cfg'; round: number; laps: number }
  /** The result: winner seat and finishing order as [seat, ms] (ms -1 for still running when called). */
  | { k: 'end'; round: number; w: number | null; order: [number, number][] };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const seatOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 32;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const LAP_CHOICES = [3, 5, 10] as const;

/** A car packed into a short array. */
export function packCar(c: NetCar): number[] {
  return [r2(c.x), r2(c.y), r3(c.yaw), r2(c.vx), r2(c.vy), r3(c.r), r3(c.steer), Math.round(c.rpm), c.gear, r2(c.brake), c.drs ? 1 : 0, c.lap, r1(c.dist), Math.round(c.fin), Math.round(c.best)];
}

export function unpackCar(a: unknown): NetCar | null {
  if (!Array.isArray(a) || a.length < 15 || !a.every(num)) return null;
  const [x, y, yaw, vx, vy, r, steer, rpm, gear, brake, drs, lap, dist, fin, best] = a as number[];
  if (Math.abs(x) > 1e5 || Math.abs(y) > 1e5 || Math.abs(vx) > 150 || Math.abs(vy) > 150) return null;
  return { x, y, yaw, vx, vy, r, steer, rpm, gear: Math.max(-1, Math.min(8, Math.round(gear))), brake, drs: drs === 1, lap: Math.max(0, Math.round(lap)), dist, fin, best };
}

export const hostState = (round: number, go: number, laps: number, roster: number[], teams: number[], cars: [number, NetCar][]) => ({
  t: 'gp',
  r: round,
  k: 'S',
  go: r2(go),
  laps,
  ro: roster,
  tm: teams,
  cars: cars.map(([seat, c]) => [seat, ...packCar(c)]),
});
export const guestState = (round: number, car: NetCar) => ({ t: 'gp', r: round, k: 's', c: packCar(car) });
export const configOf = (round: number, laps: number) => ({ t: 'gp', r: round, k: 'cfg', laps });
export const endOf = (round: number, w: number | null, order: [number, number][]) => ({ t: 'gp', r: round, k: 'end', w, order });

export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'gp' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (p.k === 's') {
    const car = unpackCar(p.c);
    return car ? { k: 's', round, car } : null;
  }
  if (p.k === 'S') {
    if (!num(p.go) || !num(p.laps) || !Array.isArray(p.ro) || !Array.isArray(p.cars)) return null;
    const roster = p.ro.filter(seatOk).slice(0, 24);
    const teams = Array.isArray(p.tm) ? p.tm.slice(0, 24).map((t) => (Number.isInteger(t) && t >= 0 && t < 10 ? (t as number) : 0)) : roster.map(() => 0);
    const cars: [number, NetCar][] = [];
    for (const raw of p.cars.slice(0, 24)) {
      if (!Array.isArray(raw) || !seatOk(raw[0])) continue;
      const car = unpackCar(raw.slice(1));
      if (car) cars.push([raw[0], car]);
    }
    return { k: 'S', round, go: p.go, laps: lapsOk(p.laps), roster, teams, cars };
  }
  if (p.k === 'cfg') return num(p.laps) ? { k: 'cfg', round, laps: lapsOk(p.laps) } : null;
  if (p.k === 'end') {
    if (!(p.w === null || seatOk(p.w)) || !Array.isArray(p.order)) return null;
    const order = p.order.filter((o): o is [number, number] => Array.isArray(o) && seatOk(o[0]) && num(o[1])).slice(0, 24);
    return { k: 'end', round, w: p.w as number | null, order };
  }
  return null;
}

const lapsOk = (n: number) => ((LAP_CHOICES as readonly number[]).includes(n) ? n : 3);

/** Finishing order: finishers by time, then the rest by how far they got. */
export function finishOrder(rows: { seat: number; fin: number; dist: number }[]): [number, number][] {
  return [...rows]
    .sort((a, b) => {
      const fa = a.fin >= 0 ? a.fin : Infinity;
      const fb = b.fin >= 0 ? b.fin : Infinity;
      if (fa !== fb) return fa - fb;
      return b.dist - a.dist || a.seat - b.seat;
    })
    .map((r) => [r.seat, r.fin]);
}

/** The winner seat, or null when nobody finished. */
export const winnerOf = (order: [number, number][]) => (order.length && order[0][1] >= 0 ? order[0][0] : null);
