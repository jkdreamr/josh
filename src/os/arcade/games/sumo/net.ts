import type { CarConfig, Input, Level, Phase } from './logic.ts';

export type PackedCar = { x: number; z: number; y: number; vx: number; vz: number; yaw: number; charge: number; flags: number };
/** Car flags in host state: 1 in, 2 falling, 4 out, 8 dashing, 16 a bot drives it, 32 its player left. */
export const CAR_IN = 1;
export const CAR_FALLING = 2;
export const CAR_OUT = 4;
export const CAR_DASH = 8;
export const CAR_BOT = 16;
export const CAR_LEFT = 32;
export type StatePacket = { k: 'S'; r: number; ph: Phase; tm: number; rad: number; rn: number; wins: number[]; roster: number[]; names?: string[]; lv: Level; cars: PackedCar[] };
export type Packet =
  | { k: 'i'; r: number; x: number; y: number; d: boolean }
  | StatePacket
  | { k: 'end'; r: number; w: number | null; wins: number[]; names?: string[] }
  | { k: 'cfg'; r: number; lv: Level };

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const roundOk = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const seatOk = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 15;
const levelOk = (value: unknown): value is Level => value === 0 || value === 1 || value === 2;
const phaseOk = (value: unknown): value is Phase => value === 'count' || value === 'fight' || value === 'over' || value === 'done';

export const inputOf = (round: number, input: Input) => {
  const magnitude = Math.hypot(input.x, input.y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return {
    t: 'sumo',
    r: round,
    k: 'i',
    x: round2(input.x * scale),
    y: round2(input.y * scale),
    d: input.dash,
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
  cars: cars.map((car) => [round2(car.x), round2(car.z), round2(car.y), round2(car.vx), round2(car.vz), round2(car.yaw), round2(car.charge), car.flags]),
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
    if (!finite(packet.x) || !finite(packet.y) || typeof packet.d !== 'boolean' || Math.abs(packet.x) > 1 || Math.abs(packet.y) > 1 || Math.hypot(packet.x, packet.y) > 1.01) return null;
    return { k: 'i', r, x: packet.x, y: packet.y, d: packet.d };
  }
  if (packet.k === 'S') {
    const wins = winsOf(packet.wins);
    const roster = rosterOf(packet.roster);
    if (!phaseOk(packet.ph) || !finite(packet.tm) || packet.tm < 0 || packet.tm > 120 || !finite(packet.rad) || packet.rad < 2.5 || packet.rad > 15 || !roundOk(packet.rn) || !wins || !roster || !levelOk(packet.lv) || !Array.isArray(packet.cars) || packet.cars.length > 8 || packet.cars.length !== roster.length || wins.length !== roster.length) return null;
    const cars = packet.cars.map(packedCar);
    const names = namesOf(packet.names, roster.length);
    if (cars.some((car) => car === null) || names === null) return null;
    return { k: 'S', r, ph: packet.ph, tm: packet.tm, rad: packet.rad, rn: packet.rn, wins, roster, ...(names ? { names } : {}), lv: packet.lv, cars: cars as PackedCar[] };
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
