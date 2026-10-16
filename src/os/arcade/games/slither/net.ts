import { wrapAngle, type Pellet, type World } from './world.ts';

export const PACKET_LIMIT = 6000;
export type RosterEntry = { id: number; seat: number; name: string; color: number; skin: number; bot: boolean; eligible: boolean };
export type SnakeState = [number, number, number, number, number, boolean, number, boolean, number, number, number];
export type NetOp =
  | { k: 'add'; pellet: Pellet }
  | { k: 'remove'; id: number }
  | { k: 'death'; id: number; killer: number | null; mass: number; x: number; y: number }
  | { k: 'spawn'; id: number; x: number; y: number; angle: number };

export type Packet =
  | { t: 'sl'; r: number; k: 'I'; seed: number; radius: number; duration: number; level: 'easy' | 'normal' | 'hard'; seq: number; roster: RosterEntry[] }
  | { t: 'sl'; r: number; k: 'S'; tick: number; clock: number; snakes: SnakeState[] }
  | { t: 'sl'; r: number; k: 'O'; seq: number; ops: NetOp[] }
  | { t: 'sl'; r: number; k: 'Z'; snap: number; part: number; total: number; data: unknown[][] }
  | { t: 'sl'; r: number; k: 'M'; seq: number; target: number; boost: boolean }
  | { t: 'sl'; r: number; k: 'H' | 'Q' }
  | { t: 'sl'; r: number; k: 'P'; away: boolean }
  | { t: 'sl'; r: number; k: 'E'; winner: number | null; seat: number | null; clock: number; ranking: [number, number, number, number][] };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown, min = 0, max = 1_000_000) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const bounded = (v: unknown, min: number, max: number): v is number => finite(v) && v >= min && v <= max;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validName = (v: unknown): v is string => typeof v === 'string' && v.length <= 40;
const byteLength = (v: unknown) => {
  try { return new TextEncoder().encode(JSON.stringify(v)).byteLength; } catch { return Infinity; }
};
const packet = (r: number, k: Packet['k'], fields: Record<string, unknown> = {}) => ({ t: 'sl', r, k, ...fields });
const validRound = (r: unknown) => integer(r, 0, 1_000_000_000);
const validRoster = (v: unknown): v is RosterEntry[] =>
  Array.isArray(v) && v.length <= 16 && v.every((x) => isObj(x) && integer(x.id, 0, 15) && integer(x.seat, -1, 7) && validName(x.name)
    && integer(x.color, 0, 7) && integer(x.skin, 0, 7) && typeof x.bot === 'boolean' && typeof x.eligible === 'boolean');
const validPellet = (v: unknown): v is Pellet =>
  isObj(v) && integer(v.id, 1) && bounded(v.x, -5000, 5000) && bounded(v.y, -5000, 5000) && bounded(v.value, 0.01, 1_000_000)
  && integer(v.color, 0, 7) && bounded(v.born, 0, 100_000_000) && typeof v.natural === 'boolean';

function validOp(v: unknown): v is NetOp {
  if (!isObj(v) || typeof v.k !== 'string') return false;
  if (v.k === 'add') return validPellet(v.pellet);
  if (v.k === 'remove') return integer(v.id, 1);
  if (v.k === 'spawn') return integer(v.id, 0, 15) && bounded(v.x, -5000, 5000) && bounded(v.y, -5000, 5000) && bounded(v.angle, -10, 10);
  return v.k === 'death' && integer(v.id, 0, 15) && (v.killer === null || integer(v.killer, 0, 15))
    && bounded(v.mass, 0, 1_000_000) && bounded(v.x, -5000, 5000) && bounded(v.y, -5000, 5000);
}

export function parsePacket(input: unknown): Packet | null {
  if (!isObj(input) || input.t !== 'sl' || !validRound(input.r) || byteLength(input) > PACKET_LIMIT) return null;
  const r = input.r as number;
  switch (input.k) {
    case 'I':
      if (!finite(input.seed) || !bounded(input.radius, 100, 5000) || !bounded(input.duration, 30, 600) || !integer(input.seq)
        || !['easy', 'normal', 'hard'].includes(input.level as string) || !validRoster(input.roster)) return null;
      return { t: 'sl', r, k: 'I', seed: input.seed, radius: input.radius, duration: input.duration, level: input.level as 'easy' | 'normal' | 'hard', seq: input.seq as number, roster: input.roster as RosterEntry[] };
    case 'S':
      if (!integer(input.tick) || !bounded(input.clock, 0, 100_000) || !Array.isArray(input.snakes) || input.snakes.length > 16) return null;
      if (!input.snakes.every((s) => Array.isArray(s) && s.length === 11 && integer(s[0], 0, 15) && bounded(s[1], -5000, 5000) && bounded(s[2], -5000, 5000)
        && bounded(s[3], -10, 10) && bounded(s[4], 0, 1_000_000) && typeof s[5] === 'boolean' && integer(s[6], 0, 1_000_000)
        && typeof s[7] === 'boolean' && bounded(s[8], -1000, 1000) && bounded(s[9], -1000, 1000) && bounded(s[10], 0, 1_000_000))) return null;
      return { t: 'sl', r, k: 'S', tick: input.tick as number, clock: input.clock as number, snakes: input.snakes as SnakeState[] };
    case 'O':
      if (!integer(input.seq) || !Array.isArray(input.ops) || input.ops.length > 500 || !input.ops.every(validOp)) return null;
      return { t: 'sl', r, k: 'O', seq: input.seq as number, ops: input.ops as NetOp[] };
    case 'Z':
      if (!integer(input.snap) || !integer(input.part) || !integer(input.total, 1, 1000) || (input.part as number) >= (input.total as number)
        || !Array.isArray(input.data) || input.data.length > 500 || !input.data.every(validSnapshotEntry)) return null;
      return { t: 'sl', r, k: 'Z', snap: input.snap as number, part: input.part as number, total: input.total as number, data: input.data as unknown[][] };
    case 'M':
      if (!integer(input.seq) || !bounded(input.target, -10, 10) || typeof input.boost !== 'boolean') return null;
      return { t: 'sl', r, k: 'M', seq: input.seq as number, target: input.target, boost: input.boost };
    case 'H':
    case 'Q':
      return { t: 'sl', r, k: input.k };
    case 'P':
      if (typeof input.away !== 'boolean') return null;
      return { t: 'sl', r, k: 'P', away: input.away };
    case 'E':
      if (!(input.winner === null || integer(input.winner, 0, 15)) || !(input.seat === null || integer(input.seat, -1, 7))
        || !bounded(input.clock, 0, 100_000) || !Array.isArray(input.ranking) || input.ranking.length > 16
        || !input.ranking.every((x) => Array.isArray(x) && x.length === 4 && integer(x[0], 0, 15) && integer(x[1], -1, 7)
          && bounded(x[2], 0, 1_000_000) && integer(x[3], 0, 1_000_000))) return null;
      return { t: 'sl', r, k: 'E', winner: input.winner as number | null, seat: input.seat as number | null, clock: input.clock as number, ranking: input.ranking as [number, number, number, number][] };
    default:
      return null;
  }
}

export const initPacket = (r: number, seed: number, radius: number, duration: number, level: 'easy' | 'normal' | 'hard', seq: number, roster: RosterEntry[]) =>
  packet(r, 'I', { seed, radius, duration, level, seq, roster }) as Packet;
export function statePacket(r: number, world: World): Packet {
  const snakes = world.snakes.map((s) => [s.id, s.x, s.y, wrapAngle(s.angle), s.mass, s.alive, s.kills, s.boosting, s.vx, s.vy, s.peak] as SnakeState);
  return packet(r, 'S', { tick: world.tick, clock: world.clock, snakes }) as Packet;
}
export const movePacket = (r: number, seq: number, target: number, boost: boolean): Packet => packet(r, 'M', { seq, target: wrapAngle(target), boost }) as Packet;
export const helloPacket = (r: number): Packet => packet(r, 'H') as Packet;
export const resyncPacket = (r: number): Packet => packet(r, 'Q') as Packet;
export const pausePacket = (r: number, away: boolean): Packet => packet(r, 'P', { away }) as Packet;
export const endPacket = (r: number, winner: number | null, seat: number | null, clock: number, ranking: [number, number, number, number][]): Packet =>
  packet(r, 'E', { winner, seat, clock, ranking }) as Packet;

export function operationPackets(r: number, firstSeq: number, ops: NetOp[]): Packet[] {
  const result: Packet[] = [];
  let batch: NetOp[] = [];
  let seq = firstSeq;
  for (const value of ops) {
    const op: NetOp = value.k === 'spawn' ? { ...value, angle: wrapAngle(value.angle) } : value;
    const trial = packet(r, 'O', { seq, ops: [...batch, op] });
    if (byteLength(trial) > PACKET_LIMIT && batch.length) {
      result.push(packet(r, 'O', { seq, ops: batch }) as Packet);
      seq++;
      batch = [op];
    } else batch.push(op);
  }
  if (batch.length) result.push(packet(r, 'O', { seq, ops: batch }) as Packet);
  return result;
}

export function snapshotPackets(world: World, r: number, snap: number): Packet[] {
  const entries: unknown[][] = [];
  for (const snake of world.snakes) {
    entries.push(['s', snake.id, snake.seat, snake.name, snake.color, snake.skin, snake.bot, snake.eligible, snake.alive,
      snake.x, snake.y, wrapAngle(snake.angle), snake.mass, snake.peak, snake.kills, snake.boosting, snake.vx, snake.vy, snake.respawnAt]);
    for (let start = 0; start < snake.body.length; start += 60) {
      const values: number[] = [];
      for (const p of snake.body.slice(start, start + 60)) values.push(Math.round(p.x * 10), Math.round(p.y * 10));
      entries.push(['b', snake.id, start, ...values]);
    }
  }
  for (const p of world.pellets) entries.push(['p', p.id, p.x, p.y, p.value, p.color, p.born, p.natural]);
  const chunks: unknown[][][] = [];
  let current: unknown[][] = [];
  for (const entry of entries) {
    const test = packet(r, 'Z', { snap, part: 0, total: 1, data: [...current, entry] });
    if (byteLength(test) > PACKET_LIMIT - 300 && current.length) {
      chunks.push(current);
      current = [entry];
    } else current.push(entry);
  }
  if (current.length || !chunks.length) chunks.push(current);
  return chunks.map((data, part) => packet(r, 'Z', { snap, part, total: chunks.length, data }) as Packet);
}

function validSnapshotEntry(row: unknown): row is unknown[] {
  if (!Array.isArray(row) || typeof row[0] !== 'string') return false;
  if (row[0] === 's') return row.length === 19 && integer(row[1], 0, 15) && integer(row[2], -1, 7) && validName(row[3])
    && integer(row[4], 0, 7) && integer(row[5], 0, 7) && typeof row[6] === 'boolean' && typeof row[7] === 'boolean'
    && typeof row[8] === 'boolean' && bounded(row[9], -5000, 5000) && bounded(row[10], -5000, 5000)
    && bounded(row[11], -10, 10) && bounded(row[12], 0, 1_000_000) && bounded(row[13], 0, 1_000_000)
    && integer(row[14], 0, 1_000_000) && typeof row[15] === 'boolean' && bounded(row[16], -1000, 1000) && bounded(row[17], -1000, 1000)
    && (row[18] === null || bounded(row[18], 0, 100_000));
  if (row[0] === 'b') return row.length >= 4 && row.length <= 123 && integer(row[1], 0, 15) && integer(row[2], 0, 1800)
    && row.slice(3).every((n) => integer(n, -50_000, 50_000)) && (row.length - 3) % 2 === 0;
  if (row[0] === 'p') return row.length === 8 && integer(row[1], 1) && bounded(row[2], -5000, 5000)
    && bounded(row[3], -5000, 5000) && bounded(row[4], 0.01, 1_000_000) && integer(row[5], 0, 7)
    && bounded(row[6], 0, 100_000) && typeof row[7] === 'boolean';
  return false;
}

export const packetBytes = (value: unknown) => byteLength(value);
export const pelletFrom = (p: Pellet): NetOp => ({ k: 'add', pellet: p });
