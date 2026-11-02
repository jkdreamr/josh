import type { CarConfig, Input, Level, Phase } from './logic.ts';

export type PackedCar = { x: number; z: number; y: number; vx: number; vz: number; yaw: number; charge: number; flags: number };
/** Car flags in host state: 1 in, 2 falling, 4 out, 8 dashing, 16 a bot drives it, 32 its player left. */
export const CAR_IN = 1;
export const CAR_FALLING = 2;
export const CAR_OUT = 4;
export const CAR_DASH = 8;
export const CAR_BOT = 16;
export const CAR_LEFT = 32;
/** A stick change: from this guest step on, the stick reads x, y with dash held (1) or not (0). */
export type StickChange = [number, number, number, 0 | 1];
/**
 * A guest's stick. Newer guests number their steps: q is the step this stick is for, and h the latest changes before
 * it (so a lost packet's change still arrives, at the step it happened), which lets the host apply each change at the
 * same step of the guest's own game (see netsync).
 */
export type InputPacket = { k: 'i'; r: number; x: number; y: number; d: boolean; q?: number; h?: StickChange[] };
/**
 * What newer hosts add to a state, for guests that forecast it (see netsync): the host's step n, and for each car the
 * guest step its stick was at in that step (ak, -1 for a car no guest numbers), the stick it drove with (ci: x, y,
 * dash 0 or 1) and the rest of its dash (cx: dash time left, cooldown, dash held 0 or 1).
 */
export type StateNet = { n: number; ak: number[]; ci: [number, number, 0 | 1][]; cx: [number, number, 0 | 1][] };
export type StatePacket = { k: 'S'; r: number; ph: Phase; tm: number; rad: number; rn: number; wins: number[]; roster: number[]; names?: string[]; lv: Level; cars: PackedCar[] } & Partial<StateNet>;
export type Packet =
  | InputPacket
  | StatePacket
  | { k: 'end'; r: number; w: number | null; wins: number[]; names?: string[] }
  | { k: 'cfg'; r: number; lv: Level };

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const stepOk = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000;
const stickOk = (x: unknown, y: unknown) => finite(x) && finite(y) && Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.hypot(x, y) <= 1.01;
const bit = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const roundOk = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const seatOk = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 15;
const levelOk = (value: unknown): value is Level => value === 0 || value === 1 || value === 2;
const phaseOk = (value: unknown): value is Phase => value === 'count' || value === 'fight' || value === 'over' || value === 'done';

/** A stick as the wire carries it (hundredths, inside the unit disc): a guest drives its own car with exactly this, as the host will. */
export function wireInput(input: Input): Input {
  const magnitude = Math.hypot(input.x, input.y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const x = Number.isFinite(input.x) ? round2(input.x * scale) : 0;
  const y = Number.isFinite(input.y) ? round2(input.y * scale) : 0;
  return { x: x || 0, y: y || 0, dash: input.dash === true };
}

export const inputOf = (round: number, input: Input, steps?: { q: number; h: StickChange[] }) => {
  const { x, y, dash } = wireInput(input);
  return {
    t: 'sumo',
    r: round,
    k: 'i',
    x,
    y,
    d: dash,
    ...(steps ? { q: steps.q, h: steps.h } : {}),
  };
};

export const hostState = (
  round: number,
  ph: Phase,
  tm: number,
  rad: number,
  rn: number,
  wins: number[],
  roster: number[],
  lv: Level,
  cars: PackedCar[],
  names: string[],
  net?: StateNet,
) => ({
  t: 'sumo',
  r: round,
  k: 'S',
  ph,
  tm: round2(tm),
  rad: round2(rad),
  rn,
  wins,
  roster,
  names,
  lv,
  // (held inside what parsePacket takes: a car that has spun round a few times, or been knocked very fast, would
  // otherwise get the whole state thrown away)
  cars: cars.map((car) => [
    round2(clamp(car.x, -30, 30)), round2(clamp(car.z, -30, 30)), round2(clamp(car.y, -10, 1)),
    round2(clamp(car.vx, -50, 50)), round2(clamp(car.vz, -50, 50)), round2(wrap(car.yaw)), round2(clamp(car.charge, 0, 1)), car.flags,
  ]),
  ...(net ? {
    n: net.n,
    ak: net.ak,
    ci: net.ci.map(([x, y, d]) => [round2(x), round2(y), d]),
    cx: net.cx.map(([dashT, cool, held]) => [round2(clamp(dashT, 0, 1)), round2(clamp(cool, 0, 2)), held]),
  } : {}),
});

export const endOf = (round: number, winner: number | null, wins: number[], names: string[]) => ({ t: 'sumo', r: round, k: 'end', w: winner, wins, names });
export const configOf = (round: number, level: Level) => ({ t: 'sumo', r: round, k: 'cfg', lv: level });

function packedCar(value: unknown): PackedCar | null {
  if (!Array.isArray(value) || value.length !== 8 || !value.slice(0, 7).every(finite) || !Number.isInteger(value[7])) return null;
  const [x, z, y, vx, vz, yaw, charge, flags] = value as number[];
  if (Math.abs(x) > 30 || Math.abs(z) > 30 || y < -10 || y > 1 || Math.abs(vx) > 50 || Math.abs(vz) > 50 || Math.abs(yaw) > Math.PI * 2 || charge < 0 || charge > 1 || flags < 0 || flags > 63) return null;
  return { x, z, y, vx, vz, yaw, charge, flags };
}

function winsOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 8 || !value.every((wins) => Number.isInteger(wins) && wins >= 0 && wins <= 3)) return null;
  return [...value] as number[];
}

function rosterOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 8 || !value.every(seatOk)) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value] as number[];
}

function changesOf(value: unknown, q: number): StickChange[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) return null;
  let last = -1;
  for (const change of value) {
    if (!Array.isArray(change) || change.length !== 4 || !stepOk(change[0]) || change[0] <= last || change[0] > q || !stickOk(change[1], change[2]) || !bit(change[3])) return null;
    last = change[0];
  }
  return value.map((change) => [...change] as StickChange);
}

/** A newer host's additions to a state (all of them, or none), or null when they are there but wrong. */
function stateNetOf(packet: Record<string, unknown>, cars: number): StateNet | null | undefined {
  const { n, ak, ci, cx } = packet;
  if (n === undefined && ak === undefined && ci === undefined && cx === undefined) return undefined;
  if (!stepOk(n) || !Array.isArray(ak) || !Array.isArray(ci) || !Array.isArray(cx) || ak.length !== cars || ci.length !== cars || cx.length !== cars) return null;
  if (!ak.every((step) => step === -1 || stepOk(step))) return null;
  if (!ci.every((stick) => Array.isArray(stick) && stick.length === 3 && stickOk(stick[0], stick[1]) && bit(stick[2]))) return null;
  if (!cx.every((dash) => Array.isArray(dash) && dash.length === 3 && finite(dash[0]) && dash[0] >= 0 && dash[0] <= 1 && finite(dash[1]) && dash[1] >= 0 && dash[1] <= 2 && bit(dash[2]))) return null;
  return { n, ak: [...ak], ci: ci.map((stick) => [...stick] as [number, number, 0 | 1]), cx: cx.map((dash) => [...dash] as [number, number, 0 | 1]) };
}

const NAME_MAX = 24;
function namesOf(value: unknown, length: number): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== length) return null;
  if (!value.every((name) => typeof name === 'string' && name.trim().length > 0 && Array.from(name).length <= NAME_MAX)) return null;
  return [...value] as string[];
}

/**
 * The host's round roster as a guest or spectator should show it: every car keeps the name the host gave it, even
 * after its player left and a bot took over, so names and winners never depend on who happens to be in the room now.
 */
export function rosterFromState(packet: StatePacket, fallback: (seat: number) => string): (CarConfig & { left: boolean })[] {
  return packet.roster.map((seat, color) => {
    const flags = packet.cars[color]?.flags ?? 0;
    return {
      seat,
      color,
      ai: flags & CAR_BOT ? packet.lv : null,
      name: packet.names?.[color] ?? fallback(seat),
      left: !!(flags & CAR_LEFT),
    };
  });
}

/** Whether the host's round has a car this seat still drives (not one whose player left and someone new now sits in). */
export const drivesIn = (packet: StatePacket, seat: number) => packet.roster.some((candidate, index) => candidate === seat && !((packet.cars[index]?.flags ?? 0) & CAR_LEFT));

export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (packet.t !== 'sumo' || !roundOk(packet.r)) return null;
  const r = packet.r;
  if (packet.k === 'i') {
    if (!stickOk(packet.x, packet.y) || typeof packet.d !== 'boolean') return null;
    const x = packet.x as number;
    const y = packet.y as number;
    if (packet.q === undefined) return { k: 'i', r, x, y, d: packet.d };
    if (!stepOk(packet.q)) return null;
    const h = changesOf(packet.h, packet.q);
    return h ? { k: 'i', r, x, y, d: packet.d, q: packet.q, h } : null;
  }
  if (packet.k === 'S') {
    const wins = winsOf(packet.wins);
    const roster = rosterOf(packet.roster);
    if (!phaseOk(packet.ph) || !finite(packet.tm) || packet.tm < 0 || packet.tm > 120 || !finite(packet.rad) || packet.rad < 2.5 || packet.rad > 15 || !roundOk(packet.rn) || !wins || !roster || !levelOk(packet.lv) || !Array.isArray(packet.cars) || packet.cars.length > 8 || packet.cars.length !== roster.length || wins.length !== roster.length) return null;
    const cars = packet.cars.map(packedCar);
    const names = namesOf(packet.names, roster.length);
    const net = stateNetOf(packet, roster.length);
    if (cars.some((car) => car === null) || names === null || net === null) return null;
    return { k: 'S', r, ph: packet.ph, tm: packet.tm, rad: packet.rad, rn: packet.rn, wins, roster, ...(names ? { names } : {}), lv: packet.lv, cars: cars as PackedCar[], ...(net ?? {}) };
  }
  if (packet.k === 'end') {
    const wins = winsOf(packet.wins);
    if (!(packet.w === null || seatOk(packet.w)) || !wins) return null;
    const names = namesOf(packet.names, wins.length);
    if (names === null) return null;
    return { k: 'end', r, w: packet.w as number | null, wins, ...(names ? { names } : {}) };
  }
  if (packet.k === 'cfg') {
    return levelOk(packet.lv) ? { k: 'cfg', r, lv: packet.lv } : null;
  }
  return null;
}
