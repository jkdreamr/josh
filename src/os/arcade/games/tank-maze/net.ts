// Online packets for Tank Maze. Pure, so it can be tested under node.
//
// Rooms are a star around the host (seat 0). The host simulates everything and guests send inputs:
//   round  host -> all,   reliable   a new round: seed, size, seats, bots, scores, spawns, target
//   s      host -> all,   fast       snapshot ~25 Hz: tanks, shells, pickups, mines, beams, scores, events
//   end    host -> all,   reliable   the match is over: winner seat (or null), champ seat (null only on a draw), scores, rounds
//   in     guest -> host, fast       this guest's input, with a monotonic fireCount so dropped packets
//                                    don't drop shots (the host fires once per increment)
import type { Special } from './logic.ts';

const int = (v: unknown): v is number => Number.isInteger(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const seatOk = (v: unknown): v is number => int(v) && v >= 0 && v < 4;
const KINDS: readonly Special[] = ['laser', 'triple', 'mine'];
const kindIx = (k: Special | null) => (k === null ? -1 : KINDS.indexOf(k));

export type NetTank = { x: number; y: number; a: number; alive: boolean; special: Special | null; moving: boolean };
export type NetShell = { x: number; y: number; owner: number };
export type NetPickup = { kind: Special; x: number; y: number };
export type NetMine = { x: number; y: number; armed: boolean };
export type NetEvent = { id: number; k: 'fire' | 'kill' | 'pickup' | 'laser' | 'mine' | 'boom' | 'bounce'; a: number; b: number; x: number; y: number; pts?: number[] };

export type RoundPacket = {
  k: 'round';
  roomRound: number;
  round: number;
  seed: number;
  cols: number;
  rows: number;
  seats: number[];
  bots: number[];
  scores: number[];
  target: number;
  level: number;
  spawns: { x: number; y: number; a: number }[];
};

export type StatePacket = {
  k: 's';
  roomRound: number;
  tick: number;
  phase: 'ready' | 'play' | 'settle';
  phaseT: number;
  tanks: NetTank[];
  shells: NetShell[];
  pickups: NetPickup[];
  mines: NetMine[];
  beams: { owner: number; pts: number[] }[];
  scores: number[];
  events: NetEvent[];
};

export type EndPacket = { k: 'end'; roomRound: number; winner: number | null; champ: number | null; scores: number[]; rounds: number };
export type InputPacket = { k: 'in'; roomRound: number; turn: -1 | 0 | 1; move: -1 | 0 | 1; fireCount: number };

export type Packet = RoundPacket | StatePacket | EndPacket | InputPacket;

const q = (n: number) => Math.round(n * 100);

// -----------------------------------------------------------------------------------------------------------------
// Builders

export const roundPacket = (p: Omit<RoundPacket, 'k'>) => ({
  game: 'tank-maze',
  type: 'round',
  room: p.roomRound,
  round: p.round,
  seed: p.seed >>> 0,
  cols: p.cols,
  rows: p.rows,
  seats: p.seats,
  bots: p.bots,
  scores: p.scores,
  target: p.target,
  level: p.level,
  spawns: p.spawns.map((s) => [q(s.x), q(s.y), Math.round(s.a * 1000)]),
});

export const statePacket = (p: Omit<StatePacket, 'k'>) => ({
  game: 'tank-maze',
  type: 's',
  room: p.roomRound,
  tick: p.tick,
  phase: p.phase,
  pt: Math.max(0, q(p.phaseT)),
  tanks: p.tanks.map((t) => [q(t.x), q(t.y), Math.round(t.a * 1000), t.alive ? 1 : 0, kindIx(t.special), t.moving ? 1 : 0]),
  shells: p.shells.map((s) => [q(s.x), q(s.y), s.owner]),
  pickups: p.pickups.map((s) => [kindIx(s.kind), q(s.x), q(s.y)]),
  mines: p.mines.map((m) => [q(m.x), q(m.y), m.armed ? 1 : 0]),
  beams: p.beams.map((b) => [b.owner, b.pts.map(q)]),
  scores: p.scores,
  ev: p.events.map((e) => (e.pts ? [e.id, e.k, e.a, e.b, q(e.x), q(e.y), e.pts.map(q)] : [e.id, e.k, e.a, e.b, q(e.x), q(e.y)])),
});

export const endPacket = (p: EndPacket) => ({ game: 'tank-maze', type: 'end', room: p.roomRound, winner: p.winner, champ: p.champ, scores: p.scores, rounds: p.rounds });
export const inputPacket = (p: InputPacket) => ({ game: 'tank-maze', type: 'in', room: p.roomRound, turn: p.turn, move: p.move, fc: p.fireCount });

// -----------------------------------------------------------------------------------------------------------------
// Parser

const EVENT_KINDS = ['fire', 'kill', 'pickup', 'laser', 'mine', 'boom', 'bounce'] as const;
const PHASES = ['ready', 'play', 'settle'] as const;

const seatList = (v: unknown, max = 4): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const s of v.slice(0, 8)) {
    if (!seatOk(s) || s >= max || out.includes(s)) return null;
    out.push(s);
  }
  return out;
};

const scoreList = (v: unknown, n: number): number[] | null => {
  if (!Array.isArray(v) || v.length !== n) return null;
  if (!v.every((s) => int(s) && s >= 0 && s < 100)) return null;
  return v.slice() as number[];
};

/** Reads a Tank Maze packet, or null for anything else / anything malformed. */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.game !== 'tank-maze' || !int(p.room)) return null;
  const roomRound = p.room as number;
  switch (p.type) {
    case 'round': {
      if (!int(p.round) || !int(p.seed) || !int(p.cols) || !int(p.rows) || !int(p.target) || !int(p.level)) return null;
      const cols = p.cols as number;
      const rows = p.rows as number;
      const target = p.target as number;
      if (cols < 3 || cols > 24 || rows < 3 || rows > 24 || target < 1 || target > 50 || p.level < 0 || p.level > 2) return null;
      const seats = seatList(p.seats);
      const bots = seatList(p.bots);
      if (!seats || !bots || seats.length < 1 || !seats.includes(0)) return null;
      const scores = scoreList(p.scores, seats.length);
      if (!scores || !Array.isArray(p.spawns) || p.spawns.length !== seats.length) return null;
      const spawns: { x: number; y: number; a: number }[] = [];
      for (const s of p.spawns) {
        if (!Array.isArray(s) || !int(s[0]) || !int(s[1]) || !int(s[2])) return null;
        spawns.push({ x: (s[0] as number) / 100, y: (s[1] as number) / 100, a: (s[2] as number) / 1000 });
      }
      return { k: 'round', roomRound, round: p.round as number, seed: p.seed as number, cols, rows, seats, bots, scores, target, level: p.level as number, spawns };
    }
    case 's': {
      if (!int(p.tick) || !int(p.pt) || !Array.isArray(p.tanks) || !Array.isArray(p.shells) || !Array.isArray(p.scores)) return null;
      const phase = (PHASES as readonly string[]).includes(p.phase as string) ? (p.phase as StatePacket['phase']) : null;
      if (!phase) return null;
      const tanks: NetTank[] = [];
      for (const a of (p.tanks as unknown[]).slice(0, 4)) {
        if (!Array.isArray(a) || a.length < 6 || !a.slice(0, 6).every(int)) return null;
        tanks.push({ x: (a[0] as number) / 100, y: (a[1] as number) / 100, a: (a[2] as number) / 1000, alive: a[3] === 1, special: KINDS[a[4] as number] ?? null, moving: a[5] === 1 });
      }
      const shells: NetShell[] = [];
      for (const a of (p.shells as unknown[]).slice(0, 40)) {
        if (!Array.isArray(a) || !int(a[0]) || !int(a[1]) || !int(a[2])) return null;
        shells.push({ x: (a[0] as number) / 100, y: (a[1] as number) / 100, owner: a[2] as number });
      }
      const pickups: NetPickup[] = [];
      if (Array.isArray(p.pickups))
        for (const a of (p.pickups as unknown[]).slice(0, 4)) {
          if (!Array.isArray(a) || !int(a[0]) || !int(a[1]) || !int(a[2]) || !KINDS[a[0] as number]) return null;
          pickups.push({ kind: KINDS[a[0] as number], x: (a[1] as number) / 100, y: (a[2] as number) / 100 });
        }
      const mines: NetMine[] = [];
      if (Array.isArray(p.mines))
        for (const a of (p.mines as unknown[]).slice(0, 16)) {
          if (!Array.isArray(a) || !int(a[0]) || !int(a[1]) || !int(a[2])) return null;
          mines.push({ x: (a[0] as number) / 100, y: (a[1] as number) / 100, armed: a[2] === 1 });
        }
      const beams: { owner: number; pts: number[] }[] = [];
      if (Array.isArray(p.beams))
        for (const a of (p.beams as unknown[]).slice(0, 8)) {
          if (!Array.isArray(a) || !int(a[0]) || !Array.isArray(a[1]) || !(a[1] as unknown[]).every(int)) return null;
          beams.push({ owner: a[0] as number, pts: (a[1] as number[]).map((v) => v / 100) });
        }
      const events: NetEvent[] = [];
      if (Array.isArray(p.ev))
        for (const a of (p.ev as unknown[]).slice(0, 40)) {
          if (!Array.isArray(a) || !int(a[0]) || typeof a[1] !== 'string' || !(EVENT_KINDS as readonly string[]).includes(a[1])) return null;
          if (!num(a[2]) || !num(a[3]) || !int(a[4]) || !int(a[5])) return null;
          const e: NetEvent = { id: a[0] as number, k: a[1] as NetEvent['k'], a: a[2] as number, b: a[3] as number, x: (a[4] as number) / 100, y: (a[5] as number) / 100 };
          if (a[6] !== undefined) {
            if (!Array.isArray(a[6]) || !(a[6] as unknown[]).every(int)) return null;
            e.pts = (a[6] as number[]).map((v) => v / 100);
          }
          events.push(e);
        }
      const scores = Array.isArray(p.scores) && (p.scores as unknown[]).every((s) => int(s) && s >= 0 && s < 100) ? (p.scores as number[]).slice(0, 4) : null;
      if (!scores) return null;
      return { k: 's', roomRound, tick: p.tick as number, phase, phaseT: (p.pt as number) / 100, tanks, shells, pickups, mines, beams, scores, events };
    }
    case 'end': {
      if (!(p.winner === null || seatOk(p.winner)) || !Array.isArray(p.scores) || !int(p.rounds)) return null;
      if (!(p.scores as unknown[]).every((s) => int(s) && s >= 0 && s < 100)) return null;
      if (p.champ !== undefined && !(p.champ === null || seatOk(p.champ))) return null;
      const champ = (p.champ ?? null) as number | null;
      return { k: 'end', roomRound, winner: p.winner as number | null, champ, scores: (p.scores as number[]).slice(0, 4), rounds: p.rounds as number };
    }
    case 'in': {
      if (!int(p.turn) || !int(p.move) || !int(p.fc)) return null;
      const turn = p.turn as number;
      const move = p.move as number;
      const fc = p.fc as number;
      if (turn < -1 || turn > 1 || move < -1 || move > 1 || fc < 0 || fc > 1e9) return null;
      return { k: 'in', roomRound, turn: turn as -1 | 0 | 1, move: move as -1 | 0 | 1, fireCount: fc };
    }
  }
  return null;
}
