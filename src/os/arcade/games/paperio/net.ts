// Online packets for Paper.io. Pure, so it can be tested under node.
//
// Rooms are a star around the host (seat 0). Every client drives its own head and reports where it went; the host
// runs the bots, applies every rule (trails, cuts, captures, deaths) and tells everyone how the board changed:
//   I  init      host -> guest, reliable   the round: arena, clock, who plays (with colors and skins)
//   O  ops       host -> all,   reliable   numbered board changes: spawns, captures (row runs), deaths, looks
//   S  state     host -> all,   fast       every head (position, heading, flags), the clock, a board hash now and then
//   Z  snapshot  host -> guest, reliable   the whole board as row runs, in chunks, for joiners and anyone out of step
//   E  end       host -> all,   reliable   who won
//   H  hello     guest -> host, reliable   I am here (and my skin); answered with I and Z
//   M  move      guest -> host, fast       my last three positions, numbered, so a lost packet costs nothing
//   Q  resync    guest -> host, reliable   please send a snapshot
// Room messages are capped at 8 KB, so anything big is split well under that.
import type { Cause, Op } from './world.ts';

export const MAX_BYTES = 6000;
const CAUSES: readonly Cause[] = ['cut', 'self', 'head', 'wiped', 'left'];
export const F_ALIVE = 1;
export const F_OUT = 2;

export type RosterEntry = { id: number; seat: number; name: string; color: number; skin: number; bot: boolean };
export type HeadState = { id: number; x: number; y: number; h: number; f: number; kills: number; life: number };
/** A look change rides the op stream too: the host learns a guest's skin after the round starts. */
export type NetOp = Op | { k: 'look'; id: number; color: number; skin: number } | { k: 'cap'; id: number; runs: number[]; more: true };
/** Where everyone is in a snapshot, so a joiner knows who is alive (and its own life count). */
export type SnapPlayer = { id: number; alive: boolean; x: number; y: number; h: number; out: boolean; life: number };

export type Packet =
  | { k: 'I'; round: number; radius: number; duration: number; go: number; roster: RosterEntry[] }
  | { k: 'O'; round: number; seq: number; ops: NetOp[] }
  | { k: 'S'; round: number; tick: number; elapsed: number; go: number; seq: number; hash: number | null; heads: HeadState[] }
  | { k: 'Z'; round: number; snap: number; seq: number; part: number; parts: number; y0: number; rows: number[][]; players: SnapPlayer[] }
  | { k: 'E'; round: number; winner: number | null; order: number[]; pct: number[] }
  | { k: 'H'; round: number; skin: number }
  | { k: 'M'; round: number; life: number; seq: number; pts: number[]; h: number; dead: boolean }
  | { k: 'Q'; round: number };

const int = (v: unknown): v is number => Number.isInteger(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const idOk = (v: unknown): v is number => int(v) && v >= 0 && v < 16;
const q10 = (n: number) => Math.round(n * 10);
const q100 = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------------------------------------------------------
// Builders

export const initPacket = (round: number, radius: number, duration: number, go: number, roster: RosterEntry[]) => ({
  t: 'po',
  r: round,
  k: 'I',
  rad: radius,
  dur: Number.isFinite(duration) ? duration : -1,
  go: Math.round(go * 100) / 100,
  ro: roster.map((p) => [p.id, p.seat, p.name.slice(0, 16), p.color, p.skin, p.bot ? 1 : 0]),
});

function encodeOp(op: NetOp): unknown[] {
  switch (op.k) {
    case 'spawn':
      return ['s', op.id, op.cx, op.cy, Math.round(op.h * 1000)];
    case 'die':
      return ['d', op.id, op.by, CAUSES.indexOf(op.cause)];
    case 'look':
      return ['l', op.id, op.color, op.skin];
    case 'cap': {
      // rows go up by small steps: send each row as a delta from the one before ('C' continues a split capture)
      const out: unknown[] = ['more' in op ? 'C' : 'c', op.id];
      let py = 0;
      for (let i = 0; i + 2 < op.runs.length; i += 3) {
        out.push(op.runs[i] - py, op.runs[i + 1], op.runs[i + 2]);
        py = op.runs[i];
      }
      return out;
    }
  }
}

/** Splits big captures so no single op can blow the message cap (each piece is still "set these cells"). */
export function splitOp(op: NetOp, maxRuns = 450): NetOp[] {
  if (op.k !== 'cap' || op.runs.length <= maxRuns * 3) return [op];
  const out: NetOp[] = [];
  for (let i = 0; i < op.runs.length; i += maxRuns * 3) {
    const runs = op.runs.slice(i, i + maxRuns * 3);
    out.push(i === 0 ? { k: 'cap', id: op.id, runs } : { k: 'cap', id: op.id, runs, more: true });
  }
  return out;
}

/**
 * Packs numbered ops into as few messages as fit under MAX_BYTES. `first` is the number of ops[0]; every op is
 * expected to be split already (splitOp) so each one fits on its own.
 */
export function opPackets(round: number, first: number, ops: NetOp[]): { t: string; r: number; k: 'O'; s: number; o: unknown[][] }[] {
  const out: { t: string; r: number; k: 'O'; s: number; o: unknown[][] }[] = [];
  let cur: unknown[][] = [];
  let bytes = 40;
  let seq = first;
  let start = first;
  for (const op of ops) {
    const enc = encodeOp(op);
    const size = JSON.stringify(enc).length + 1;
    if (cur.length && bytes + size > MAX_BYTES) {
      out.push({ t: 'po', r: round, k: 'O', s: start, o: cur });
      cur = [];
      bytes = 40;
      start = seq;
    }
    cur.push(enc);
    bytes += size;
    seq++;
  }
  if (cur.length) out.push({ t: 'po', r: round, k: 'O', s: start, o: cur });
  return out;
}

export const statePacket = (round: number, tick: number, elapsed: number, go: number, seq: number, hash: number | null, heads: HeadState[]) => {
  const p: Record<string, unknown> = {
    t: 'po',
    r: round,
    k: 'S',
    n: tick,
    e: Math.round(elapsed * 10),
    g: Math.max(0, Math.round(go * 10)),
    q: seq,
    p: heads.map((s) => [s.id, q10(s.x), q10(s.y), q100(s.h), s.f, s.kills, s.life]),
  };
  if (hash !== null) p.h = hash;
  return p;
};

/** Row runs of the whole owner grid: each row is [value, length, value, length, ...]. */
export function encodeRows(owner: Uint8Array, n: number, y0: number, y1: number): number[][] {
  const rows: number[][] = [];
  for (let y = y0; y <= y1; y++) {
    const row: number[] = [];
    let v = owner[y * n];
    let len = 0;
    for (let x = 0; x < n; x++) {
      const o = owner[y * n + x];
      if (o === v) len++;
      else {
        row.push(v, len);
        v = o;
        len = 1;
      }
    }
    row.push(v, len);
    rows.push(row);
  }
  return rows;
}

/** The whole board as snapshot chunks under the message cap. */
export function snapshotPackets(round: number, snap: number, seq: number, owner: Uint8Array, n: number, players: SnapPlayer[] = []) {
  const chunks: { y0: number; rows: number[][] }[] = [];
  let rows: number[][] = [];
  let y0 = 0;
  let bytes = 60;
  for (let y = 0; y < n; y++) {
    const row = encodeRows(owner, n, y, y)[0];
    const size = JSON.stringify(row).length + 1;
    if (rows.length && bytes + size > MAX_BYTES) {
      chunks.push({ y0, rows });
      rows = [];
      bytes = 60;
      y0 = y;
    }
    rows.push(row);
    bytes += size;
  }
  if (rows.length) chunks.push({ y0, rows });
  const pl = players.map((p) => [p.id, p.alive ? 1 : 0, q10(p.x), q10(p.y), q100(p.h), p.out ? 1 : 0, p.life]);
  return chunks.map((c, i) => ({ t: 'po', r: round, k: 'Z', z: snap, s: seq, i, of: chunks.length, y0: c.y0, rows: c.rows, ...(i === 0 ? { pl } : {}) }));
}

/** Writes snapshot rows back into an owner grid. Returns false when a row does not add up to the grid width. */
export function decodeRows(into: Uint8Array, n: number, y0: number, rows: number[][]): boolean {
  for (let j = 0; j < rows.length; j++) {
    const y = y0 + j;
    if (y < 0 || y >= n) return false;
    const row = rows[j];
    let x = 0;
    for (let i = 0; i + 1 < row.length; i += 2) {
      const v = row[i];
      const len = row[i + 1];
      if (x + len > n) return false;
      into.fill(v, y * n + x, y * n + x + len);
      x += len;
    }
    if (x !== n) return false;
  }
  return true;
}

export const endPacket = (round: number, winner: number | null, order: number[], pct: number[]) => ({ t: 'po', r: round, k: 'E', w: winner, o: order, c: pct.map((p) => Math.round(p * 100)) });
export const helloPacket = (round: number, skin: number) => ({ t: 'po', r: round, k: 'H', sk: skin });
/** pts: the last few positions, oldest first, as [x, y] pairs; `seq` numbers the newest. */
export const movePacket = (round: number, life: number, seq: number, pts: number[], h: number, dead: boolean) => ({ t: 'po', r: round, k: 'M', l: life, s: seq, p: pts.map(q100), h: Math.round(h * 1000), ...(dead ? { d: 1 } : {}) });
export const resyncPacket = (round: number) => ({ t: 'po', r: round, k: 'Q' });

/** Positions travel as hundredths of a cell; both sides round the same way so they walk the same cells. */
export const quant = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------
// Parser

function decodeOp(a: unknown): NetOp | null {
  if (!Array.isArray(a) || typeof a[0] !== 'string' || !idOk(a[1])) return null;
  const id = a[1];
  switch (a[0]) {
    case 's':
      return int(a[2]) && int(a[3]) && int(a[4]) && a[2] >= 0 && a[3] >= 0 && a[2] < 4096 && a[3] < 4096 ? { k: 'spawn', id, cx: a[2], cy: a[3], h: a[4] / 1000 } : null;
    case 'd':
      return int(a[2]) && a[2] >= -1 && a[2] < 16 && int(a[3]) && CAUSES[a[3]] ? { k: 'die', id, by: a[2], cause: CAUSES[a[3]] } : null;
    case 'l':
      return int(a[2]) && a[2] >= 0 && a[2] < 64 && int(a[3]) && a[3] >= 0 && a[3] < 64 ? { k: 'look', id, color: a[2], skin: a[3] } : null;
    case 'c':
    case 'C': {
      if ((a.length - 2) % 3 !== 0) return null;
      const runs: number[] = [];
      let y = 0;
      for (let i = 2; i < a.length; i += 3) {
        const dy = a[i];
        const x = a[i + 1];
        const len = a[i + 2];
        if (!int(dy) || !int(x) || !int(len) || len <= 0 || x < 0 || x + len > 4096) return null;
        y += dy;
        if (y < 0 || y >= 4096) return null;
        runs.push(y, x, len);
      }
      return a[0] === 'C' ? { k: 'cap', id, runs, more: true } : { k: 'cap', id, runs };
    }
  }
  return null;
}

/** Reads a Paper.io packet from the room, or null for anything else (other games, junk, bad numbers). */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'po' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  switch (p.k) {
    case 'I': {
      if (!int(p.rad) || (p.rad as number) < 40 || (p.rad as number) > 1000 || !num(p.dur) || !num(p.go) || !Array.isArray(p.ro)) return null;
      const roster: RosterEntry[] = [];
      for (const r of p.ro.slice(0, 16)) {
        if (!Array.isArray(r) || !idOk(r[0]) || !int(r[1]) || typeof r[2] !== 'string' || !int(r[3]) || !int(r[4])) continue;
        roster.push({ id: r[0], seat: r[1], name: r[2].slice(0, 16), color: Math.max(0, r[3]), skin: Math.max(0, r[4]), bot: r[5] === 1 });
      }
      return { k: 'I', round, radius: p.rad as number, duration: (p.dur as number) < 0 ? Infinity : (p.dur as number), go: Math.max(0, p.go as number), roster };
    }
    case 'O': {
      if (!int(p.s) || (p.s as number) < 1 || !Array.isArray(p.o)) return null;
      const ops: NetOp[] = [];
      for (const a of p.o.slice(0, 2000)) {
        const op = decodeOp(a);
        if (!op) return null; // a bad op would shift every number after it: drop the message, the guest will resync
        ops.push(op);
      }
      return { k: 'O', round, seq: p.s as number, ops };
    }
    case 'S': {
      if (!int(p.n) || !num(p.e) || !num(p.g) || !int(p.q) || !Array.isArray(p.p)) return null;
      const heads: HeadState[] = [];
      for (const a of p.p.slice(0, 16)) {
        if (!Array.isArray(a) || !idOk(a[0]) || !a.slice(1, 7).every(int)) continue;
        heads.push({ id: a[0], x: a[1] / 10, y: a[2] / 10, h: a[3] / 100, f: a[4], kills: Math.max(0, a[5]), life: a[6] });
      }
      return { k: 'S', round, tick: p.n as number, elapsed: (p.e as number) / 10, go: (p.g as number) / 10, seq: p.q as number, hash: int(p.h) ? (p.h as number) >>> 0 : null, heads };
    }
    case 'Z': {
      if (!int(p.z) || !int(p.s) || !int(p.i) || !int(p.of) || !int(p.y0) || !Array.isArray(p.rows)) return null;
      if ((p.i as number) < 0 || (p.i as number) >= (p.of as number) || (p.of as number) > 400) return null;
      const rows: number[][] = [];
      for (const r of p.rows) {
        if (!Array.isArray(r) || r.length % 2 !== 0 || !r.every((v) => int(v) && v >= 0 && v < 4096)) return null;
        rows.push(r as number[]);
      }
      const players: SnapPlayer[] = [];
      if (Array.isArray(p.pl))
        for (const a of p.pl.slice(0, 16)) {
          if (!Array.isArray(a) || !idOk(a[0]) || !a.slice(1, 7).every(int)) continue;
          players.push({ id: a[0], alive: a[1] === 1, x: a[2] / 10, y: a[3] / 10, h: a[4] / 100, out: a[5] === 1, life: a[6] });
        }
      return { k: 'Z', round, snap: p.z as number, seq: p.s as number, part: p.i as number, parts: p.of as number, y0: p.y0 as number, rows, players };
    }
    case 'E': {
      if (!(p.w === null || idOk(p.w)) || !Array.isArray(p.o) || !Array.isArray(p.c)) return null;
      const order = p.o.filter(idOk).slice(0, 16);
      const pct = p.c.filter(int).slice(0, 16).map((v) => v / 100);
      return { k: 'E', round, winner: p.w as number | null, order, pct };
    }
    case 'H':
      return int(p.sk) && (p.sk as number) >= 0 && (p.sk as number) < 64 ? { k: 'H', round, skin: p.sk as number } : null;
    case 'M': {
      if (!int(p.l) || !int(p.s) || !Array.isArray(p.p) || p.p.length % 2 !== 0 || p.p.length > 16 || !p.p.every(int) || !int(p.h)) return null;
      return { k: 'M', round, life: p.l as number, seq: p.s as number, pts: (p.p as number[]).map((v) => v / 100), h: (p.h as number) / 1000, dead: p.d === 1 };
    }
    case 'Q':
      return { k: 'Q', round };
  }
  return null;
}
