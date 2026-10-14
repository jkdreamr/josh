// Online packets for Bed Wars, and a validating parser for every one. Pure, so it runs under node.
//
// The room is a star around the host. Each client moves its own player (no input lag) and reports where it is on
// the fast channel about 20 times a second; the host runs the rules and the bots, and everything that happens goes
// out as numbered events on the reliable channel. Guests place and break blocks on the spot and the host confirms or
// puts them back. The map comes from the mode alone, so a (re)sync only carries the changes, chunked under the
// room's 8KB message limit.
import { BLOCK_COUNT, SX, SY, SZ } from './blocks.ts';
import type { Knock } from './combat.ts';
import type { Action, Ev, Game, Player } from './game.ts';
import { ITEMS, MAX_TRAPS, RESOURCES, SLOTS, isItem, type Inventory, type Item, type TrapKind, type UpgradeKey } from './items.ts';
import { MODES, type Mode } from './map.ts';
import { wrapAngle } from './interp.ts';

export const NET_TAG = 'bw';
/** Room messages are capped at 8KB; stay well under once wrapped. */
export const CHUNK = 5600;

export type RosterEntry = { id: number; seat: number; name: string; team: number; bot: boolean; skin: number };

export type SyncState = {
  mode: Mode;
  pace: 'quick' | 'classic';
  level: 'easy' | 'normal' | 'hard';
  seed: number;
  tick: number;
  /** Event stream position this state includes. */
  seq: number;
  phase: number;
  roster: RosterEntry[];
  /** World changes since generation: [index, block, placed (0/1)] flattened. */
  edits: number[];
  teams: { bed: boolean; out: boolean; ups: number[]; traps: TrapKind[] }[];
  players: { alive: boolean; out: boolean; respawn: number; hp: number; absorb: number; stats: number[]; armor: number; epoch: number; x: number; y: number; z: number }[];
  drops: [number, number, number, number, number, number][];
  projs: [number, number, number, number, number, number, number, number, number][];
  gens: [number, number][];
  over: boolean;
  winner: number;
  /** The seat that reports the win online (-1: nobody, a bot won or it was a draw). */
  winSeat?: number;
};

export type Packet =
  | { k: 'sync'; round: number; id: number; i: number; n: number; d: string }
  | { k: 'ev'; round: number; s: number; e: Ev[] }
  | { k: 'pos'; round: number; tick: number; p: PosEntry[] }
  | { k: 'table'; round: number; tick: number; phase: number; gens: [number, number][]; stats: [number, number, number, number, number, number, number][] }
  | { k: 'inv'; round: number; v: number; a: number; inv: Inventory; sel: number }
  | { k: 'move'; round: number; ep: number; b: number[]; sel: number; sw: number; dr: number; tk: number }
  | { k: 'act'; round: number; s: number; a: Action }
  | { k: 'resync'; round: number }
  | { k: 'hello'; round: number; skin: number }
  | { k: 'end'; round: number; team: number; seats: number[] };

/** [id, x, y, z, yaw, pitch, flags, held item index (-1 none), tier, armor, hp, swings, drawing] */
export type PosEntry = [number, number, number, number, number, number, number, number, number, number, number, number, number];
export const F_SNEAK = 1;
export const F_SPRINT = 2;
export const F_INVIS = 4;
export const F_GROUND = 8;
export const F_ALIVE = 16;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const inWorld = (x: number, y: number, z: number) => x > -80 && x < SX + 80 && y > -200 && y < SY + 200 && z > -80 && z < SZ + 80;

// ---------------------------------------------------------------------------------------------------------------
// builders

const wrap = (round: number, k: string, rest: Record<string, unknown>) => ({ t: NET_TAG, r: round, k, ...rest });

export const evPacket = (round: number, s: number, e: Ev[]) => wrap(round, 'E', { s, e });
export const posPacket = (round: number, tick: number, p: PosEntry[]) => wrap(round, 'P', { tk: tick, p });
/** A guest's own body. tk counts the guest's ticks, so the host can space the samples the way they were sent. */
export const movePacket = (round: number, ep: number, b: number[], sel: number, sw: number, dr: number, tk = -1) => wrap(round, 'M', { ep, b, sel, sw, dr, tk });
export const actPacket = (round: number, s: number, a: Action) => wrap(round, 'A', { s, a });
export const resyncPacket = (round: number) => wrap(round, 'R', {});
export const helloPacket = (round: number, skin: number) => wrap(round, 'H', { skin });
export const endPacket = (round: number, team: number, seats: number[]) => wrap(round, 'X', { team, seats });

/** Splits a sync state into numbered chunks that each fit in a room message. */
export function syncPackets(round: number, id: number, state: SyncState): Record<string, unknown>[] {
  const json = JSON.stringify(state);
  const n = Math.max(1, Math.ceil(json.length / CHUNK));
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) out.push(wrap(round, 'S', { id, i, n, d: json.slice(i * CHUNK, (i + 1) * CHUNK) }));
  return out;
}

/** Splits a tick's events into packets under the size limit, numbering each. Returns the packets and the next seq. */
export function eventPackets(round: number, seq: number, evs: Ev[]): { packets: Record<string, unknown>[]; seq: number } {
  const packets: Record<string, unknown>[] = [];
  let batch: Ev[] = [];
  let size = 0;
  for (const e of evs) {
    const len = JSON.stringify(e).length + 1;
    if (batch.length && size + len > CHUNK) {
      packets.push(evPacket(round, seq++, batch));
      batch = [];
      size = 0;
    }
    batch.push(e);
    size += len;
  }
  if (batch.length) packets.push(evPacket(round, seq++, batch));
  return { packets, seq };
}

export function posEntry(p: Player): PosEntry {
  const b = p.body;
  const flags = (b.sneaking ? F_SNEAK : 0) | (b.sprinting ? F_SPRINT : 0) | (p.fx.invis > 0 ? F_INVIS : 0) | (b.onGround ? F_GROUND : 0) | (p.alive ? F_ALIVE : 0);
  return [p.id, r2(b.x), r2(b.y), r2(b.z), r3(b.yaw), r3(b.pitch), flags, p.show.item ? ITEMS.indexOf(p.show.item) : -1, p.show.tier, p.inv.armor, Math.round(p.hp * 10) / 10, p.swings & 0xffff, Math.min(99, p.drawing)];
}

export function tablePacket(round: number, g: Game) {
  return wrap(round, 'T', {
    tk: g.tick,
    ph: g.phase,
    gens: g.gens.map((x) => [x.tier, x.timer]),
    st: g.players.map((p) => [p.stats.kills, p.stats.finals, p.stats.beds, p.stats.deaths, p.alive ? 1 : 0, p.out ? 1 : 0, p.respawn]),
  });
}

export function invPacket(round: number, p: Player) {
  const inv = p.inv;
  return wrap(round, 'I', {
    v: p.invVersion,
    a: p.ack,
    sl: inv.slots.map((s) => (s ? [ITEMS.indexOf(s.item), s.n] : 0)),
    w: RESOURCES.map((r) => inv.wallet[r]),
    ar: inv.armor,
    pk: inv.pick,
    ax: inv.axe,
    sh: inv.shears ? 1 : 0,
    sel: p.sel,
  });
}

/** The host's whole picture of a game, for a guest starting or catching up. */
export function syncState(g: Game, seq: number): SyncState {
  const edits: number[] = [];
  for (const [i, id] of g.world.edits) edits.push(i, id, g.world.placed.has(i) ? 1 : 0);
  const UP: UpgradeKey[] = ['sharp', 'prot', 'haste', 'forge', 'heal'];
  return {
    mode: g.mode,
    pace: g.pace,
    level: g.level,
    seed: g.seed,
    tick: g.tick,
    seq,
    phase: g.phase,
    roster: g.players.map((p) => ({ id: p.id, seat: p.seat, name: p.name, team: p.team, bot: p.ctrl === 'bot' || p.seat < 0, skin: p.skin })),
    edits,
    teams: g.teams.map((t) => ({ bed: t.bed, out: t.out, ups: UP.map((k) => t.ups[k]), traps: [...t.traps] })),
    players: g.players.map((p) => ({ alive: p.alive, out: p.out, respawn: p.respawn, hp: p.hp, absorb: p.absorb, stats: [p.stats.kills, p.stats.finals, p.stats.beds, p.stats.deaths], armor: p.inv.armor, epoch: p.epoch, x: r2(p.body.x), y: r2(p.body.y), z: r2(p.body.z) })),
    drops: g.drops.map((d) => [d.id, ITEMS.indexOf(d.item), d.n, r2(d.x), r2(d.y), r2(d.z)]),
    projs: g.projs.map((pr) => [pr.id, ['arrow', 'fireball', 'pearl', 'egg', 'tnt'].indexOf(pr.kind), pr.owner, r2(pr.x), r2(pr.y), r2(pr.z), r3(pr.vx), r3(pr.vy), r3(pr.vz)]),
    gens: g.gens.map((x) => [x.tier, x.timer]),
    over: g.over,
    winner: g.winner,
    winSeat: g.winSeat,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// parsing

/** Reads a Bed Wars packet from the room, or null for anything else (or anything malformed). */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== NET_TAG || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  switch (p.k) {
    case 'S':
      return int(p.id) && int(p.i) && int(p.n) && (p.n as number) > 0 && (p.n as number) < 400 && (p.i as number) >= 0 && (p.i as number) < (p.n as number) && str(p.d, CHUNK)
        ? { k: 'sync', round, id: p.id as number, i: p.i as number, n: p.n as number, d: p.d as string }
        : null;
    case 'E': {
      if (!int(p.s) || !Array.isArray(p.e) || p.e.length > 400) return null;
      const e = p.e.map(parseEvent).filter((x): x is Ev => x !== null);
      return { k: 'ev', round, s: p.s as number, e };
    }
    case 'P': {
      if (!int(p.tk) || !Array.isArray(p.p)) return null;
      const list: PosEntry[] = [];
      for (const raw of p.p.slice(0, 16)) {
        if (!Array.isArray(raw) || raw.length < 13 || !raw.slice(0, 13).every(num) || !int(raw[0])) continue;
        if (!inWorld(raw[1], raw[2], raw[3])) continue;
        const e = raw.slice(0, 13) as PosEntry;
        // angles folded and clamped, and the small numbers kept small, whatever the sender says
        e[4] = wrapAngle(e[4]);
        e[5] = clampNum(e[5], -1.6, 1.6);
        e[7] = Math.round(e[7]);
        e[8] = clampInt(e[8], 0, 4);
        e[9] = clampInt(e[9], 0, 3);
        e[10] = clampNum(e[10], 0, 40);
        e[12] = clampInt(e[12], 0, 99);
        list.push(e);
      }
      return { k: 'pos', round, tick: p.tk as number, p: list };
    }
    case 'T': {
      if (!int(p.tk) || !int(p.ph) || !Array.isArray(p.gens) || !Array.isArray(p.st)) return null;
      const gens = p.gens.filter((x): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(int)).slice(0, 16);
      const stats = p.st.filter((x): x is [number, number, number, number, number, number, number] => Array.isArray(x) && x.length === 7 && x.every(int)).slice(0, 16);
      return { k: 'table', round, tick: p.tk as number, phase: p.ph as number, gens, stats };
    }
    case 'I': {
      if (!int(p.v) || !int(p.a) || !Array.isArray(p.sl) || p.sl.length !== SLOTS || !Array.isArray(p.w) || p.w.length !== 4 || !p.w.every(int)) return null;
      if (!int(p.ar) || !int(p.pk) || !int(p.ax) || !int(p.sel)) return null;
      const slots = p.sl.map((s) => {
        if (!Array.isArray(s) || !int(s[0]) || !int(s[1]) || s[1] <= 0 || s[1] > 64) return null;
        const item = ITEMS[s[0]];
        return item ? { item, n: s[1] } : null;
      });
      const w = p.w as number[];
      return {
        k: 'inv',
        round,
        v: p.v as number,
        a: p.a as number,
        sel: Math.max(0, Math.min(8, p.sel as number)),
        inv: { slots, wallet: { iron: w[0], gold: w[1], diamond: w[2], emerald: w[3] }, armor: clampInt(p.ar, 0, 3), pick: clampInt(p.pk, 0, 4), axe: clampInt(p.ax, 0, 4), shears: p.sh === 1 },
      };
    }
    case 'M': {
      if (!int(p.ep) || !Array.isArray(p.b) || p.b.length !== 9 || !p.b.every(num) || !int(p.sel) || !int(p.sw) || !int(p.dr)) return null;
      const b = (p.b as number[]).slice();
      if (!inWorld(b[0], b[1], b[2])) return null;
      // nothing moves ten blocks a tick, and pitch stops at straight up or down
      if (Math.abs(b[3]) > 10 || Math.abs(b[4]) > 10 || Math.abs(b[5]) > 10 || Math.abs(b[7]) > 1.6) return null;
      b[6] = wrapAngle(b[6]);
      return { k: 'move', round, ep: p.ep as number, b, sel: clampInt(p.sel, 0, 8), sw: p.sw as number, dr: clampInt(p.dr, 0, 99), tk: Number.isSafeInteger(p.tk) && (p.tk as number) >= 0 ? (p.tk as number) : -1 };
    }
    case 'A': {
      const a = parseAction(p.a);
      return int(p.s) && a ? { k: 'act', round, s: p.s as number, a } : null;
    }
    case 'R':
      return { k: 'resync', round };
    case 'H':
      return int(p.skin) ? { k: 'hello', round, skin: clampInt(p.skin, 0, 15) } : null;
    case 'X':
      return int(p.team) && Array.isArray(p.seats) && p.seats.every(int) ? { k: 'end', round, team: p.team as number, seats: (p.seats as number[]).slice(0, 8) } : null;
  }
  return null;
}

const clampInt = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v as number)));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const UPGRADE_KEYS: UpgradeKey[] = ['sharp', 'prot', 'haste', 'forge', 'heal'];
const TRAP_KINDS: TrapKind[] = ['trap', 'counter', 'alarm', 'fatigue'];

/** Actions a guest may ask for, checked field by field. */
export function parseAction(v: unknown): Action | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  switch (a.a) {
    case 'place':
      return int(a.x) && int(a.y) && int(a.z) && int(a.slot) && int(a.face) && int(a.seq) && (a.slot as number) >= 0 && (a.slot as number) < SLOTS
        ? { a: 'place', x: a.x as number, y: a.y as number, z: a.z as number, slot: a.slot as number, face: a.face as number, seq: a.seq as number }
        : null;
    case 'break':
      return int(a.x) && int(a.y) && int(a.z) && int(a.seq) ? { a: 'break', x: a.x as number, y: a.y as number, z: a.z as number, seq: a.seq as number } : null;
    case 'hit':
      return int(a.target) && bool(a.crit) ? { a: 'hit', target: a.target as number, crit: a.crit as boolean } : null;
    case 'shoot':
      return num(a.charge) && num(a.yaw) && num(a.pitch) ? { a: 'shoot', charge: Math.min(40, Math.max(0, a.charge as number)), yaw: a.yaw as number, pitch: a.pitch as number } : null;
    case 'use':
      return int(a.slot) && num(a.yaw) && num(a.pitch) && (a.slot as number) >= 0 && (a.slot as number) < SLOTS ? { a: 'use', slot: a.slot as number, yaw: a.yaw as number, pitch: a.pitch as number } : null;
    case 'buy':
      return str(a.id, 32) ? { a: 'buy', id: a.id as string } : null;
    case 'upg':
      return UPGRADE_KEYS.includes(a.key as UpgradeKey) ? { a: 'upg', key: a.key as UpgradeKey } : null;
    case 'trap':
      return TRAP_KINDS.includes(a.kind as TrapKind) ? { a: 'trap', kind: a.kind as TrapKind } : null;
    case 'drop':
      return int(a.slot) && bool(a.all) && (a.slot as number) >= 0 && (a.slot as number) < SLOTS ? { a: 'drop', slot: a.slot as number, all: a.all as boolean } : null;
    case 'sel':
      return int(a.slot) && (a.slot as number) >= 0 && (a.slot as number) < 9 ? { a: 'sel', slot: a.slot as number } : null;
    case 'swap':
      return int(a.from) && int(a.to) && (a.from as number) >= 0 && (a.from as number) < SLOTS && (a.to as number) >= 0 && (a.to as number) < SLOTS && a.from !== a.to
        ? { a: 'swap', from: a.from as number, to: a.to as number }
        : null;
    case 'fall':
      return num(a.d) && (a.d as number) >= 0 && (a.d as number) < 300 ? { a: 'fall', d: a.d as number } : null;
  }
  return null;
}

const knock = (v: unknown): Knock | null => {
  if (!v || typeof v !== 'object') return null;
  const k = v as Record<string, unknown>;
  return num(k.dx) && num(k.dz) && num(k.ex) && num(k.ey) && num(k.ez) && bool(k.base) && Math.abs(k.ex as number) < 5 && Math.abs(k.ey as number) < 5 && Math.abs(k.ez as number) < 5
    ? { dx: k.dx as number, dz: k.dz as number, ex: k.ex as number, ey: k.ey as number, ez: k.ez as number, base: k.base as boolean }
    : null;
};
const MSG_KINDS = ['kill', 'final', 'bed', 'elim', 'tier', 'phase', 'info', 'trap', 'buy', 'deny', 'res', 'join'];
const CAUSES = ['melee', 'arrow', 'explosion', 'fall', 'void', 'pearl', 'magic'];
const PROJ_KINDS = ['arrow', 'fireball', 'pearl', 'egg', 'tnt'];
const PHASES = ['diamond2', 'emerald2', 'diamond3', 'emerald3', 'bedgone', 'sudden', 'end'];

/** One event from the host, every field checked; anything off is dropped. */
export function parseEvent(v: unknown): Ev | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  const has = (...keys: string[]) => keys.every((k) => num(e[k]));
  switch (e.t) {
    case 'block':
      return has('x', 'y', 'z', 'id', 'by', 'was') && bool(e.placed) && int(e.id) && (e.id as number) >= 0 && (e.id as number) < BLOCK_COUNT ? (e as unknown as Ev) : null;
    case 'hurt':
      return has('p', 'hp', 'abs', 'by') && bool(e.crit) && CAUSES.includes(e.cause as string) ? (e as unknown as Ev) : null;
    case 'kb': {
      const k = knock(e.k);
      return int(e.p) && k ? { t: 'kb', p: e.p as number, k } : null;
    }
    case 'die':
      return has('p', 'by') && bool(e.final) && CAUSES.includes(e.cause as string) ? (e as unknown as Ev) : null;
    case 'spawn':
      return has('p', 'x', 'y', 'z', 'yaw', 'ep') ? (e as unknown as Ev) : null;
    case 'tp':
      return has('p', 'x', 'y', 'z', 'ep') ? (e as unknown as Ev) : null;
    case 'bed':
      return has('team', 'by') ? (e as unknown as Ev) : null;
    case 'elim':
      return has('team') ? (e as unknown as Ev) : null;
    case 'drop':
      return has('id', 'n', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'gen') && isItem(e.item) ? (e as unknown as Ev) : null;
    case 'dropn':
      return has('id', 'n') ? (e as unknown as Ev) : null;
    case 'pick':
      return has('id', 'p', 'n') && isItem(e.item) ? (e as unknown as Ev) : null;
    case 'proj':
      return has('id', 'owner', 'x', 'y', 'z', 'vx', 'vy', 'vz') && PROJ_KINDS.includes(e.kind as string) ? (e as unknown as Ev) : null;
    case 'pgone':
      return has('id', 'x', 'y', 'z', 'hit') ? (e as unknown as Ev) : null;
    case 'boom':
      return has('x', 'y', 'z', 'power') ? (e as unknown as Ev) : null;
    case 'upg':
      return has('team', 'level', 'by') && UPGRADE_KEYS.includes(e.key as UpgradeKey) ? (e as unknown as Ev) : null;
    case 'traps':
      return has('team') && Array.isArray(e.traps) && e.traps.length <= MAX_TRAPS && e.traps.every((k) => TRAP_KINDS.includes(k as TrapKind)) ? (e as unknown as Ev) : null;
    case 'trap':
      return has('team', 'p') && TRAP_KINDS.includes(e.kind as TrapKind) ? (e as unknown as Ev) : null;
    case 'tier':
      return has('tier') && (e.kind === 'diamond' || e.kind === 'emerald') ? (e as unknown as Ev) : null;
    case 'phase':
      return PHASES.includes(e.kind as string) ? (e as unknown as Ev) : null;
    case 'msg':
      return MSG_KINDS.includes(e.k as string) && str(e.text, 240) && (e.team === undefined || int(e.team)) && (e.to === undefined || int(e.to)) ? (e as unknown as Ev) : null;
    case 'win':
      if (!has('team') || (e.seat !== undefined && !int(e.seat))) return null;
      return { t: 'win', team: e.team as number, seat: e.seat === undefined ? -1 : (e.seat as number) };
    case 'skin':
      return int(e.p) && int(e.skin) && (e.skin as number) >= 0 && (e.skin as number) < 16 ? { t: 'skin', p: e.p as number, skin: e.skin as number } : null;
    case 'fx': {
      const f = e.fx as Record<string, unknown> | undefined;
      const keys = ['speed', 'speedLvl', 'jump', 'jumpLvl', 'invis', 'regen', 'regenLvl', 'absorb', 'blind', 'slow', 'fatigue'];
      return int(e.p) && num(e.absorb) && f && typeof f === 'object' && keys.every((k) => int(f[k])) ? (e as unknown as Ev) : null;
    }
    case 'use':
      return int(e.p) && isItem(e.item) ? (e as unknown as Ev) : null;
    case 'swing':
    case 'inv':
      return int(e.p) ? (e as unknown as Ev) : null;
    case 'ack':
      return has('p', 'seq') && bool(e.ok) ? (e as unknown as Ev) : null;
  }
  return null;
}

/** Parses an assembled sync state, checking the parts the replica relies on. */
export function parseSync(json: string): SyncState | null {
  let s: SyncState;
  try {
    s = JSON.parse(json) as SyncState;
  } catch {
    return null;
  }
  if (!s || typeof s !== 'object' || !MODES.includes(s.mode) || !['quick', 'classic'].includes(s.pace) || !['easy', 'normal', 'hard'].includes(s.level)) return null;
  if (!int(s.seed) || !int(s.tick) || !int(s.seq) || !int(s.phase) || !Array.isArray(s.roster) || s.roster.length > 16 || !Array.isArray(s.edits) || s.edits.length % 3 !== 0) return null;
  if (!s.edits.every(int) || !Array.isArray(s.teams) || !Array.isArray(s.players) || s.players.length !== s.roster.length) return null;
  for (const r of s.roster) if (!r || !int(r.id) || !int(r.seat) || !str(r.name, 40) || !int(r.team) || r.team < 0 || r.team > 7 || !bool(r.bot) || !int(r.skin)) return null;
  for (const p of s.players) if (!p || !bool(p.alive) || !num(p.hp) || !num(p.x) || !num(p.y) || !num(p.z) || !Array.isArray(p.stats) || !int(p.epoch)) return null;
  for (const t of s.teams) if (!t || !bool(t.bed) || !bool(t.out) || !Array.isArray(t.ups) || t.ups.length !== 5 || !Array.isArray(t.traps)) return null;
  if (!Array.isArray(s.drops) || !Array.isArray(s.projs) || !Array.isArray(s.gens)) return null;
  if (!int(s.winSeat)) s.winSeat = -1;
  return s;
}

/** Collects sync chunks until a whole state is in. */
export class SyncAssembler {
  private id = -1;
  private parts: string[] = [];
  private got = 0;
  /** Adds a chunk; returns the parsed state once every chunk of one sync has arrived. */
  add(p: { id: number; i: number; n: number; d: string }): SyncState | null {
    if (p.id !== this.id) {
      this.id = p.id;
      this.parts = new Array(p.n).fill(undefined);
      this.got = 0;
    }
    if (p.n !== this.parts.length || this.parts[p.i] !== undefined) return null;
    this.parts[p.i] = p.d;
    this.got++;
    if (this.got < p.n) return null;
    return parseSync(this.parts.join(''));
  }
}

/**
 * Orders the host's numbered event packets: applies them in sequence, holds ones that arrive early, and says when a
 * gap has lasted too long (time to ask for a resync).
 */
export class EventQueue {
  next = 0;
  private held = new Map<number, Ev[]>();
  private gapSince = -1;
  /** Starts (or restarts) the stream after a sync that included everything up to seq. */
  reset(seq: number) {
    this.next = seq;
    for (const k of [...this.held.keys()]) if (k < seq) this.held.delete(k);
  }
  /** Adds a packet; returns the events now ready to apply, in order. */
  push(s: number, e: Ev[], now: number): Ev[] {
    if (s < this.next) return [];
    this.held.set(s, e);
    const out: Ev[] = [];
    while (this.held.has(this.next)) {
      out.push(...this.held.get(this.next)!);
      this.held.delete(this.next);
      this.next++;
    }
    this.gapSince = this.held.size ? (this.gapSince < 0 ? now : this.gapSince) : -1;
    if (this.held.size > 300) this.held.clear();
    return out;
  }
  /** True when packets after a missing one have been waiting longer than `limit` seconds. */
  stalled(now: number, limit = 1.5) {
    return this.gapSince >= 0 && now - this.gapSince > limit;
  }
  clearGap() {
    this.gapSince = -1;
    this.held.clear();
  }
}

export const itemAt = (i: number): Item | null => ITEMS[i] ?? null;
