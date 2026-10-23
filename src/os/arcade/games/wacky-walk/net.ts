import type { Show } from './show.ts';
import type { Body, BodyState, Collider, Entrant, Phase, RaceId } from './types.ts';

export type PackedBody = [number, number, number, number, number, number, number, number, number];
export type Sample = { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; state: BodyState; squash: number };
type Base = { t: 'wacky-walk'; r: number };
type Move = Base & { k: 'm'; rd: number; b: PackedBody };
type Result = Base & { k: 'fin' | 'fall'; rd: number };
type TileEvent = Base & { k: 'tile'; rd: number; id: number; at: number };
type PlayerState = Base & { k: 'P'; rd: number; c: number; b: [number, ...PackedBody][] };
export type ShowPacket = Base & {
  k: 'S'; seed: number; race: RaceId; ent: [number, number, string, 0 | 1, number, number][];
  rd: number; ph: Phase; pt: number; c: number; inr: number[]; out: number[]; fin: number[];
  fal: number[]; q: number; w: number | null; tiles: [number, number | null][];
};
export type Packet = Move | Result | TileEvent | PlayerState | ShowPacket;

const stateCodes: BodyState[] = ['run', 'air', 'dive', 'flop', 'stun'];
const round2 = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const phaseOk = (value: unknown): value is Phase => value === 'intro' || value === 'count' || value === 'play' || value === 'outro' || value === 'done';
const raceOk = (value: unknown): value is RaceId => value === 'oval' || value === 'fountain' || value === 'palm';

export function packBody(body: Pick<Body, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'yaw' | 'state' | 'squash'>): PackedBody {
  return [
    round2(body.x), round2(body.y), round2(body.z), round2(body.vx), round2(body.vy), round2(body.vz),
    round2(body.yaw), stateCodes.indexOf(body.state), round2(body.squash),
  ];
}

export function unpackBody(packed: readonly number[]): Sample {
  const code = Number.isInteger(packed[7]) ? packed[7] : 0;
  return {
    x: packed[0], y: packed[1], z: packed[2], vx: packed[3], vy: packed[4], vz: packed[5],
    yaw: packed[6], state: stateCodes[code] ?? 'run', squash: packed[8],
  };
}

export const movePacket = (round: number, rd: number, body: Body): Move => ({ t: 'wacky-walk', k: 'm', r: round, rd, b: packBody(body) });
export const finishPacket = (round: number, rd: number): Result => ({ t: 'wacky-walk', k: 'fin', r: round, rd });
export const fallPacket = (round: number, rd: number): Result => ({ t: 'wacky-walk', k: 'fall', r: round, rd });
export const tilePacket = (round: number, rd: number, id: number, at: number): TileEvent => ({ t: 'wacky-walk', k: 'tile', r: round, rd, id, at: round2(at) });

export function playersPacket(round: number, rd: number, clock: number, bodies: readonly { id: number; body: Body }[]): PlayerState {
  return {
    t: 'wacky-walk', k: 'P', r: round, rd, c: round2(clock),
    b: bodies.slice(0, 20).map(({ id, body }) => [id, ...packBody(body)] as [number, ...PackedBody]),
  };
}

export function showPacket(
  round: number,
  show: Show,
  tileStates: readonly (Collider | { id: number; touchedAt: number | null } | readonly [number, number | null])[] = [],
): ShowPacket {
  const tiles: [number, number | null][] = [];
  for (const item of tileStates) {
    if (Array.isArray(item)) {
      const tuple = item as readonly [number, number | null];
      tiles.push([tuple[0], tuple[1]]);
    } else {
      const record = item as Collider | { id: number; touchedAt: number | null };
      if ('tile' in record) {
        if (record.tile) tiles.push([record.id, record.tile.touchedAt]);
      } else {
        const tile = record as { id: number; touchedAt: number | null };
        tiles.push([tile.id, tile.touchedAt]);
      }
    }
  }
  return {
    t: 'wacky-walk', k: 'S', r: round, seed: show.seed >>> 0, race: show.race,
    ent: show.entrants.map(({ id, seat, name, bot, color, skill }) => [id, seat, name, bot ? 1 : 0, color, skill]),
    rd: show.round, ph: show.phase, pt: round2(show.phaseT), c: round2(show.clock),
    inr: [...show.inRound], out: [...show.out], fin: [...show.finished], fal: [...show.fallen],
    q: show.quota, w: show.winner, tiles,
  };
}

export function showOf(packet: ShowPacket): Show {
  const entrants: Entrant[] = packet.ent.map(([id, seat, name, bot, color, skill]) => ({
    id, seat, name, bot: bot === 1, color, skill,
  }));
  return {
    seed: packet.seed, race: packet.race, entrants, round: packet.rd, phase: packet.ph, phaseT: packet.pt,
    clock: packet.c, inRound: [...packet.inr], out: [...packet.out], finished: [...packet.fin],
    fallen: [...packet.fal], qualified: packet.ph === 'outro' || packet.ph === 'done' ? [...packet.inr].filter((id) => !packet.out.includes(id)) : [],
    quota: packet.q, winner: packet.w,
  };
}

function packedOk(value: unknown): value is PackedBody {
  if (!Array.isArray(value) || value.length !== 9 || !value.every(finite)) return false;
  const [x, y, z, vx, vy, vz, yaw, state, squash] = value;
  return Math.abs(x) <= 500 && y >= -100 && y <= 200 && Math.abs(z) <= 500 &&
    Math.abs(vx) <= 50 && Math.abs(vy) <= 50 && Math.abs(vz) <= 50 &&
    Math.abs(yaw) <= Math.PI * 2 + 0.05 && integer(state, 0, stateCodes.length - 1) && squash >= -1 && squash <= 1;
}

function idsOk(value: unknown, known: Set<number>, maxLength = 20): value is number[] {
  if (!Array.isArray(value) || value.length > maxLength || !value.every((id) => integer(id, 0, 19) && known.has(id))) return false;
  return new Set(value).size === value.length;
}

function entrantsOk(value: unknown): value is ShowPacket['ent'] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  const ids = new Set<number>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 6) return false;
    const [id, seat, name, bot, color, skill] = entry;
    if (!integer(id, 0, 19) || ids.has(id) || !integer(seat, -1, 15) ||
        typeof name !== 'string' || name.length < 1 || name.length > 24 || /[\u0000-\u001f]/.test(name) ||
        (bot !== 0 && bot !== 1) || !integer(color, 0, 0xffffff) || !finite(skill) || skill < 0.3 || skill > 1) return false;
    ids.add(id);
  }
  return true;
}

function tileListOk(value: unknown): value is [number, number | null][] {
  if (!Array.isArray(value) || value.length > 300) return false;
  const ids = new Set<number>();
  for (const tile of value) {
    if (!Array.isArray(tile) || tile.length !== 2 || !integer(tile[0], 0, 500) || ids.has(tile[0]) ||
        !(tile[1] === null || (finite(tile[1]) && tile[1] >= 0 && tile[1] <= 10000))) return false;
    ids.add(tile[0]);
  }
  return true;
}

function parsedShow(packet: Record<string, unknown>, r: number): ShowPacket | null {
  if (!integer(packet.seed, 0, 0xffffffff) || !raceOk(packet.race) || !entrantsOk(packet.ent) ||
      !integer(packet.rd, 0, 2) || !phaseOk(packet.ph) || !finite(packet.pt) || packet.pt < 0 || packet.pt > 151 ||
      !finite(packet.c) || packet.c < 0 || packet.c > 1000 || !integer(packet.q, 0, 20) ||
      !(packet.w === null || integer(packet.w, 0, 19)) || !tileListOk(packet.tiles)) return null;
  const known = new Set(packet.ent.map((entry) => entry[0]));
  if (packet.w !== null && !known.has(packet.w as number)) return null;
  if (![packet.inr, packet.out, packet.fin, packet.fal].every((ids) => idsOk(ids, known))) return null;
  const entrants = packet.ent as ShowPacket['ent'];
  const occupiedSeats = entrants.map((entry) => entry[1]).filter((seat) => seat >= 0);
  if (new Set(occupiedSeats).size !== occupiedSeats.length) return null;
  return {
    t: 'wacky-walk', k: 'S', r, seed: packet.seed, race: packet.race, ent: entrants,
    rd: packet.rd, ph: packet.ph, pt: packet.pt, c: packet.c, inr: packet.inr as number[],
    out: packet.out as number[], fin: packet.fin as number[], fal: packet.fal as number[],
    q: packet.q, w: packet.w as number | null, tiles: packet.tiles,
  };
}

export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (packet.t !== 'wacky-walk' || !integer(packet.r, 0, Number.MAX_SAFE_INTEGER)) return null;
  const r = packet.r;
  if (packet.k === 'm') {
    if (!integer(packet.rd, 0, 2) || !packedOk(packet.b)) return null;
    return { t: 'wacky-walk', k: 'm', r, rd: packet.rd, b: packet.b };
  }
  if (packet.k === 'fin' || packet.k === 'fall') {
    if (!integer(packet.rd, 0, 2)) return null;
    return { t: 'wacky-walk', k: packet.k, r, rd: packet.rd };
  }
  if (packet.k === 'tile') {
    if (!integer(packet.rd, 0, 2) || !integer(packet.id, 0, 500) || !finite(packet.at) || packet.at < 0 || packet.at > 10000) return null;
    return { t: 'wacky-walk', k: 'tile', r, rd: packet.rd, id: packet.id, at: packet.at };
  }
  if (packet.k === 'P') {
    if (!integer(packet.rd, 0, 2) || !finite(packet.c) || packet.c < 0 || packet.c > 1000 ||
        !Array.isArray(packet.b) || packet.b.length > 20) return null;
    const ids = new Set<number>();
    const bodies: [number, ...PackedBody][] = [];
    for (const row of packet.b) {
      if (!Array.isArray(row) || row.length !== 10 || !integer(row[0], 0, 19) || ids.has(row[0]) || !packedOk(row.slice(1))) return null;
      ids.add(row[0]);
      bodies.push([row[0], ...row.slice(1)] as [number, ...PackedBody]);
    }
    return { t: 'wacky-walk', k: 'P', r, rd: packet.rd, c: packet.c, b: bodies };
  }
  if (packet.k === 'S') return parsedShow(packet, r);
  return null;
}

export class Interp {
  private samples: { time: number; value: Sample }[] = [];

  push(time: number, sample: Sample): void {
    if (!Number.isFinite(time)) return;
    const value = { ...sample };
    const last = this.samples[this.samples.length - 1];
    if (last && time < last.time) return;
    if (last && time === last.time) last.value = value;
    else this.samples.push({ time, value });
    while (this.samples.length > 2 && this.samples[1].time < time - 1) this.samples.shift();
  }

  sample(time: number, out: Sample): boolean {
    if (!this.samples.length || !Number.isFinite(time)) return false;
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    if (time <= first.time) {
      Object.assign(out, first.value);
      return true;
    }
    for (let i = 1; i < this.samples.length; i++) {
      const b = this.samples[i], a = this.samples[i - 1];
      if (time > b.time) continue;
      const amount = b.time === a.time ? 1 : (time - a.time) / (b.time - a.time);
      out.x = a.value.x + (b.value.x - a.value.x) * amount;
      out.y = a.value.y + (b.value.y - a.value.y) * amount;
      out.z = a.value.z + (b.value.z - a.value.z) * amount;
      out.vx = a.value.vx + (b.value.vx - a.value.vx) * amount;
      out.vy = a.value.vy + (b.value.vy - a.value.vy) * amount;
      out.vz = a.value.vz + (b.value.vz - a.value.vz) * amount;
      let yawDelta = ((b.value.yaw - a.value.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      out.yaw = a.value.yaw + yawDelta * amount;
      out.state = amount < 0.5 ? a.value.state : b.value.state;
      out.squash = a.value.squash + (b.value.squash - a.value.squash) * amount;
      return true;
    }
    const extrapolation = Math.min(0.25, Math.max(0, time - last.time));
    out.x = last.value.x + last.value.vx * extrapolation;
    out.y = last.value.y + last.value.vy * extrapolation;
    out.z = last.value.z + last.value.vz * extrapolation;
    out.vx = last.value.vx; out.vy = last.value.vy; out.vz = last.value.vz;
    out.yaw = last.value.yaw; out.state = last.value.state; out.squash = last.value.squash;
    return true;
  }
}
