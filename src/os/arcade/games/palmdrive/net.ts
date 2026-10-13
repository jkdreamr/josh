// Online packets for Palm Drive kart races. Pure, so it can be tested.
//
// Every client drives its own kart and reports it; the host relays everyone to everyone (rooms are a star around
// the host). Items travel as events: whoever throws something announces it, every client simulates it, and only
// the kart it hits decides that it was hit, then says the item is gone. The host picks the class, the GO time and
// the grid, and calls the result once everyone is home.
import { turboLevel, type Kart, type ThingKind } from './logic.ts';

export const F_SPIN = 1;
export const F_TUMBLE = 2;
export const F_STAR = 4;
export const F_SHRINK = 8;
export const F_BOOST = 16;
export const F_DRIFT_L = 32;
export const F_DRIFT_R = 64;
export const F_SQUASH = 128;
/** Bits 8-9 hold the drift spark level and bits 10-11 the item held out behind (none, banana, green, red). */
export const F_SLAM = 1 << 12;
export const F_TRICK = 1 << 13;
export const F_WOBBLE = 1 << 14;
export const F_DRAFT = 1 << 15;
const TRAILS = [null, 'banana', 'green', 'red'] as const;

/** A kart as the network sees it. fin: finish time, -1 still racing, -2 out of time. look: paint and hat (garage.ts). */
export type Car = { seat: number; x: number; z: number; y: number; h: number; v: number; p: number; f: number; fin: number; look: number };
export type NetEv =
  | { y: 'spawn'; id: number; kind: ThingKind; x: number; z: number; vx: number; vz: number; vy: number; yy: number; tg: number; pg: number; gr: number }
  | { y: 'gone'; id: number }
  | { y: 'bolt' }
  | { y: 'boom'; x: number; z: number }
  /** A slam from seat `to` landed on the sender's kart: that player pockets a coin. */
  | { y: 'stole'; to: number };

export type Packet =
  | { k: 'S'; round: number; go: number; cc: string; roster: number[]; cars: Car[] }
  | { k: 's'; round: number; car: Omit<Car, 'seat'> }
  | { k: 'e'; round: number; o: number; ev: NetEv[] }
  | { k: 'end'; round: number; w: number | null; order: [number, number][] }
  | { k: 'cfg'; round: number; cc: string };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const seatOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 16;
const KINDS: readonly ThingKind[] = ['banana', 'green', 'red', 'blue'];

export function flagsOf(k: Kart) {
  return (
    (k.spin > 0 ? F_SPIN : 0) |
    (k.tumble > 0 ? F_TUMBLE : 0) |
    (k.star > 0 ? F_STAR : 0) |
    (k.shrink > 0 ? F_SHRINK : 0) |
    (k.boost > 0 ? F_BOOST : 0) |
    (k.drift < 0 ? F_DRIFT_L : 0) |
    (k.drift > 0 ? F_DRIFT_R : 0) |
    (k.squash > 0 ? F_SQUASH : 0) |
    (turboLevel(k.charge) << 8) |
    ((k.trail && k.item ? Math.max(0, TRAILS.indexOf(k.item as (typeof TRAILS)[number])) : 0) << 10) |
    (k.slamT > 0 ? F_SLAM : 0) |
    (k.trick ? F_TRICK : 0) |
    (k.wobble > 0 ? F_WOBBLE : 0) |
    (k.draft > 0.3 ? F_DRAFT : 0)
  );
}

/** Shows a remote kart the way its owner reported it (the logic only moves remote karts, never times them). */
export function applyFlags(k: Kart, f: number) {
  k.spin = f & F_SPIN ? 0.5 : 0;
  k.tumble = f & F_TUMBLE ? 0.5 : 0;
  k.star = f & F_STAR ? 1 : 0;
  k.shrink = f & F_SHRINK ? 1 : 0;
  k.boost = f & F_BOOST ? 0.2 : 0;
  k.squash = f & F_SQUASH ? 0.5 : 0;
  k.drift = f & F_DRIFT_L ? -1 : f & F_DRIFT_R ? 1 : 0;
  k.charge = [0, 0.8, 1.7, 2.7][(f >> 8) & 3];
  const trail = TRAILS[(f >> 10) & 3];
  k.trail = trail !== null;
  if (trail) k.item = trail;
  // a remote slam is live while its owner says so, and lands on us at most once
  if (f & F_SLAM) {
    if (k.slamT <= 0) k.slamHit = false;
    k.slamT = Math.max(k.slamT, 0.15);
  } else {
    k.slamT = 0;
    k.slamHit = false;
  }
  k.trick = !!(f & F_TRICK);
  k.wobble = f & F_WOBBLE ? 0.3 : 0;
  k.draft = f & F_DRAFT ? 0.6 : 0;
}

export const carOf = (k: Kart, look = -1): Omit<Car, 'seat'> => ({ x: r2(k.x), z: r2(k.z), y: r2(k.y), h: r3(k.h), v: r1(k.v), p: r1(k.prog), f: flagsOf(k), fin: k.done === null ? -1 : r3(k.done), look });

const packCar = (c: Omit<Car, 'seat'>) => [c.x, c.z, c.y, c.h, c.v, c.p, c.f, c.fin, c.look];
function unpackCar(a: unknown): Omit<Car, 'seat'> | null {
  if (!Array.isArray(a) || a.length < 8 || !a.slice(0, 8).every(num)) return null;
  const [x, z, y, h, v, p, f, fin] = a as number[];
  const look = num(a[8]) ? (a[8] as number) | 0 : -1;
  return { x, z, y, h, v, p, f: f | 0, fin, look };
}

export const hostState = (round: number, go: number, cc: string, roster: number[], cars: Car[]) => ({
  t: 'pk',
  r: round,
  k: 'S',
  go: r2(go),
  cc,
  ro: roster,
  cars: cars.map((c) => [c.seat, ...packCar(c)]),
});
export const guestState = (round: number, car: Omit<Car, 'seat'>) => ({ t: 'pk', r: round, k: 's', c: packCar(car) });
export const events = (round: number, origin: number, ev: NetEv[]) => ({ t: 'pk', r: round, k: 'e', o: origin, ev });
export const endOf = (round: number, winner: number | null, order: [number, number][]) => ({ t: 'pk', r: round, k: 'end', w: winner, order });
/** The host's pick for the next race, sent while the room waits so guests can see it. */
export const configOf = (round: number, cc: string) => ({ t: 'pk', r: round, k: 'cfg', cc });

function parseEv(v: unknown): NetEv | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (e.y === 'gone') return num(e.id) ? { y: 'gone', id: e.id } : null;
  if (e.y === 'bolt') return { y: 'bolt' };
  if (e.y === 'boom') return num(e.x) && num(e.z) ? { y: 'boom', x: e.x, z: e.z } : null;
  if (e.y === 'stole') return seatOk(e.to) ? { y: 'stole', to: e.to } : null;
  if (e.y !== 'spawn' || !KINDS.includes(e.kind as ThingKind)) return null;
  const keys = ['id', 'x', 'z', 'vx', 'vz', 'vy', 'yy', 'tg', 'pg', 'gr'] as const;
  if (!keys.every((key) => num(e[key]))) return null;
  const n = (key: (typeof keys)[number]) => e[key] as number;
  return { y: 'spawn', id: n('id'), kind: e.kind as ThingKind, x: n('x'), z: n('z'), vx: n('vx'), vz: n('vz'), vy: n('vy'), yy: n('yy'), tg: n('tg'), pg: n('pg'), gr: n('gr') };
}

/** Reads a Palm Drive packet from the room, or null for anything else. */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'pk' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (p.k === 's') {
    const car = unpackCar(p.c);
    return car ? { k: 's', round, car } : null;
  }
  if (p.k === 'S') {
    if (!num(p.go) || typeof p.cc !== 'string' || !Array.isArray(p.ro) || !Array.isArray(p.cars)) return null;
    const roster = p.ro.filter(seatOk).slice(0, 16);
    const cars: Car[] = [];
    for (const raw of p.cars.slice(0, 16)) {
      if (!Array.isArray(raw) || !seatOk(raw[0])) continue;
      const car = unpackCar(raw.slice(1));
      if (car) cars.push({ seat: raw[0], ...car });
    }
    return { k: 'S', round, go: p.go, cc: p.cc, roster, cars };
  }
  if (p.k === 'e') {
    if (!seatOk(p.o) || !Array.isArray(p.ev)) return null;
    const ev = p.ev.slice(0, 32).map(parseEv).filter((e): e is NetEv => e !== null);
    return { k: 'e', round, o: p.o, ev };
  }
  if (p.k === 'cfg') return typeof p.cc === 'string' ? { k: 'cfg', round, cc: p.cc } : null;
  if (p.k === 'end') {
    if (!(p.w === null || seatOk(p.w)) || !Array.isArray(p.order)) return null;
    const order = p.order.filter((o): o is [number, number] => Array.isArray(o) && seatOk(o[0]) && num(o[1])).slice(0, 16);
    return { k: 'end', round, w: p.w as number | null, order };
  }
  return null;
}

/** Finishing order from everyone's finish times: finishers first by time, then those out of time. */
export function finishOrder(fins: [number, number][]): [number, number][] {
  return [...fins].sort((a, b) => {
    const fa = a[1] >= 0 ? a[1] : Infinity;
    const fb = b[1] >= 0 ? b[1] : Infinity;
    return fa - fb || a[0] - b[0];
  });
}

/** The host's call once nobody is still racing: the fastest finisher, or nobody when no one made it. */
export function winnerOf(fins: [number, number][]): number | null {
  const first = finishOrder(fins)[0];
  return first && first[1] >= 0 ? first[0] : null;
}
