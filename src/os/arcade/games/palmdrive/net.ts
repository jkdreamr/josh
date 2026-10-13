// Online packets for Palm Drive races. Everyone drives the same seeded course: the host picks the seed and the
// GO time and shares every racer's position; guests send only their own. Pure, so it can be tested.

export const F_OUT = 1;
export const F_SPIN = 2;
export const F_STAR = 4;
export const F_BOOST = 8;

/** One racer as seen over the network: distance, lateral position, speed and flags. */
export type Racer = { seat: number; d: number; x: number; v: number; f: number };
/** Host to everyone: the course seed, seconds until GO (negative once racing) and every racer. */
export type HostPacket = { t: 'pd'; r: number; seed: number; go: number; cars: [number, number, number, number, number][] };
/** Guest to host: its own position. */
export type GuestPacket = { t: 'pd'; r: number; d: number; x: number; v: number; f: number };

const MAX_SEATS = 16;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function hostPacket(round: number, seed: number, go: number, racers: Racer[]): HostPacket {
  return { t: 'pd', r: round, seed, go: round2(go), cars: racers.slice(0, MAX_SEATS).map((c) => [c.seat, round1(c.d), round2(c.x), round1(c.v), c.f]) };
}

export function guestPacket(round: number, me: Omit<Racer, 'seat'>): GuestPacket {
  return { t: 'pd', r: round, d: round1(me.d), x: round2(me.x), v: round1(me.v), f: me.f };
}

export type Parsed = { kind: 'host'; round: number; seed: number; go: number; racers: Racer[] } | { kind: 'guest'; round: number; racer: Omit<Racer, 'seat'> };

/** Reads a Palm Drive packet from the room, or null for anything else (the shell's own race packets included). */
export function parseNet(value: unknown): Parsed | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'pd' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (Array.isArray(p.cars)) {
    if (!Number.isInteger(p.seed) || (p.seed as number) < 0 || (p.seed as number) >= 2 ** 32 || !num(p.go)) return null;
    const racers: Racer[] = [];
    for (const c of p.cars.slice(0, MAX_SEATS)) {
      if (!Array.isArray(c) || c.length < 5 || !c.every(num)) continue;
      const [seat, d, x, v, f] = c as number[];
      if (Number.isInteger(seat) && seat >= 0 && seat < MAX_SEATS) racers.push({ seat, d, x, v, f: f | 0 });
    }
    return { kind: 'host', round, seed: p.seed as number, go: p.go, racers };
  }
  if (!num(p.d) || !num(p.x) || !num(p.v) || !num(p.f)) return null;
  return { kind: 'guest', round, racer: { d: p.d, x: p.x, v: p.v, f: p.f | 0 } };
}

/** Where a racer probably is now, carrying them forward at their last speed for up to half a second. */
export function predict(r: Racer, ageMs: number) {
  if (r.f & F_OUT) return r.d;
  return r.d + r.v * Math.min(Math.max(0, ageMs), 500) / 1000;
}

/** A course seed every guest can agree on when the host never sends one. */
export function fallbackSeed(round: number) {
  let h = 2166136261 ^ round;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
