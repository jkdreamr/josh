import type { Input, Level, Phase } from './logic.ts';

export type PackedCar = { x: number; z: number; y: number; vx: number; vz: number; yaw: number; charge: number; flags: number };
export type Packet =
  | { k: 'i'; r: number; x: number; y: number; d: boolean }
  | { k: 'S'; r: number; ph: Phase; tm: number; rad: number; rn: number; wins: number[]; roster: number[]; lv: Level; cars: PackedCar[] }
  | { k: 'end'; r: number; w: number | null; wins: number[] }
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
  lv,
  cars: cars.map((car) => [round2(car.x), round2(car.z), round2(car.y), round2(car.vx), round2(car.vz), round2(car.yaw), round2(car.charge), car.flags]),
});

export const endOf = (round: number, winner: number | null, wins: number[]) => ({ t: 'sumo', r: round, k: 'end', w: winner, wins });
export const configOf = (round: number, level: Level) => ({ t: 'sumo', r: round, k: 'cfg', lv: level });

function packedCar(value: unknown): PackedCar | null {
  if (!Array.isArray(value) || value.length !== 8 || !value.slice(0, 7).every(finite) || !Number.isInteger(value[7])) return null;
  const [x, z, y, vx, vz, yaw, charge, flags] = value as number[];
  if (Math.abs(x) > 30 || Math.abs(z) > 30 || y < -10 || y > 1 || Math.abs(vx) > 50 || Math.abs(vz) > 50 || Math.abs(yaw) > Math.PI * 2 || charge < 0 || charge > 1 || flags < 0 || flags > 31) return null;
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
    if (cars.some((car) => car === null)) return null;
    return { k: 'S', r, ph: packet.ph, tm: packet.tm, rad: packet.rad, rn: packet.rn, wins, roster, lv: packet.lv, cars: cars as PackedCar[] };
  }
  if (packet.k === 'end') {
    const wins = winsOf(packet.wins);
    if (!(packet.w === null || seatOk(packet.w)) || !wins) return null;
    return { k: 'end', r, w: packet.w as number | null, wins };
  }
  if (packet.k === 'cfg') {
    return levelOk(packet.lv) ? { k: 'cfg', r, lv: packet.lv } : null;
  }
  return null;
}
