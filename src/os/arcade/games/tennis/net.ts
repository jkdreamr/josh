import { rng32, type Command, type Event, type Format, type Level, type MatchLength, type MoveInput, type Swing, type Vec3, type World } from './logic.ts';

export type ConfigPacket = { t?: 'tennis'; k: 'cfg'; r: number; format: Format; length: MatchLength; level: Level };
/**
 * A swing key. From newer guests (`c`) it only says one was pressed, at `at` on their reckoning of the host's clock: the
 * guest finds where it meets the ball itself and sends that as a HitPacket. Older hosts read it the old way, as a press.
 */
export type SwingPacket = { t?: 'tennis'; k: 'sw'; r: number; shot: number; delta: number; kind: Swing['kind']; aim: number; swipe: number; c?: 1; at?: number };
/**
 * A guest's stick, plus (newer guests) where its own player is (p, v) at `at` on its reckoning of the host's clock, as of
 * the warp `w` it was sent in: a guest moves itself, and the host takes its word unless the game put the players back
 * since. Older hosts read just the stick.
 */
export type MovePacket = { t?: 'tennis'; k: 'mv'; r: number; x: number; z: number; px?: number; pz?: number; vx?: number; vz?: number; w?: number; at?: number };
/**
 * A toss or a serve. From newer guests a toss says when it began (`at`), and a serve says when it met the ball, how far
 * off the ideal moment (`delta`), where the ball (b) and the server (p) were: the host plays it from then. Older hosts
 * time both themselves.
 */
export type ServePacket = {
  t?: 'tennis'; k: 'toss' | 'serve'; r: number; aim: number; kind?: 'topspin' | 'slice' | 'flat';
  at?: number; delta?: number; bx?: number; by?: number; bz?: number; px?: number; pz?: number;
};
/** A newer guest's return: its swing met ball `shot` at `at` (host clock, as it saw it), with the ball at b and itself at p. */
export type HitPacket = {
  t?: 'tennis'; k: 'hit'; r: number; shot: number; at: number; kind: Swing['kind']; aim: number; depth: number; delta: number;
  bx: number; by: number; bz: number; px: number; pz: number;
};
/** A newer guest's ping (its own time `q`, ms), and the host's answer with its clock `c` (seconds) when it got it. */
export type PingPacket = { t?: 'tennis'; k: 'png'; r: number; q: number; c?: number };
/** The host's world. Newer hosts say so (`v`): they take guests' own moves and returns (see netplay.ts). */
export type StatePacket = { t?: 'tennis'; k: 'S'; r: number; state: World; v?: number };
export type EventPacket = { t?: 'tennis'; k: 'ev'; r: number; event: Event };
export type Packet = ConfigPacket | SwingPacket | MovePacket | ServePacket | HitPacket | PingPacket | StatePacket | EventPacket;

/** The netplay a host's states carry in `v`. */
export const NET_VERSION = 2;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const roundOk = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const levelOk = (value: unknown): value is Level => value === 0 || value === 1 || value === 2;
const formatOk = (value: unknown): value is Format => value === 'singles' || value === 'doubles';
const lengthOk = (value: unknown): value is MatchLength => value === 'game' || value === 'three' || value === 'set';
const kindOk = (value: unknown): value is Swing['kind'] => value === 'topspin' || value === 'slice' || value === 'flat' || value === 'lob' || value === 'drop' || value === 'smash' || value === 'volley';
const aimOk = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1;
const pointCalls = ['fault', 'double fault', 'let', 'out', 'net', 'point', 'game', 'set', 'match'];
const phases = ['serve-ready', 'serve-toss', 'serve-flight', 'rally', 'point', 'done'];

export const configOf = (round: number, format: Format, length: MatchLength, level: Level): ConfigPacket => ({
  t: 'tennis', k: 'cfg', r: round, format, length, level,
});
/** Where a guest's own player is, at `at` on its reckoning of the host's clock, in warp `warp`. */
export type OwnMove = { x: number; z: number; vx: number; vz: number; warp: number; at: number };
/** A guest's return as it saw it (see HitPacket). */
export type Strike = { shot: number; at: number; kind: Swing['kind']; aim: number; depth: number; delta: number; ball: Vec3; x: number; z: number };
/** A guest's serve as it saw it (see ServePacket). */
export type ServeTiming = { at: number; delta?: number; ball?: Vec3; x?: number; z?: number };

const mm = (n: number) => Math.round(n * 1000) / 1000;

export const swingOf = (round: number, shot: number, swing: Swing, at?: number): SwingPacket => ({
  t: 'tennis', k: 'sw', r: round, shot, delta: swing.delta, kind: swing.kind, aim: swing.aim, swipe: swing.swipe ?? 0,
  ...(at === undefined ? {} : { c: 1 as const, at }),
});
export const moveOf = (round: number, move: MoveInput, own?: OwnMove): MovePacket => ({
  t: 'tennis', k: 'mv', r: round, x: Math.round(move.x * 100) / 100, z: Math.round(move.z * 100) / 100,
  ...(own ? { px: mm(own.x), pz: mm(own.z), vx: mm(own.vx), vz: mm(own.vz), w: own.warp, at: Math.max(0, own.at) } : {}),
});
export const serveOf = (round: number, k: 'toss' | 'serve', aim = 0, kind: 'topspin' | 'slice' | 'flat' = 'topspin', timing?: ServeTiming): ServePacket => ({
  t: 'tennis', k, r: round, aim, kind,
  ...(timing ? { at: Math.max(0, timing.at) } : {}),
  ...(timing?.delta !== undefined && timing.ball && timing.x !== undefined && timing.z !== undefined
    ? { delta: timing.delta, bx: timing.ball.x, by: timing.ball.y, bz: timing.ball.z, px: timing.x, pz: timing.z }
    : {}),
});
export const hitOf = (round: number, strike: Strike): HitPacket => ({
  t: 'tennis', k: 'hit', r: round, shot: strike.shot, at: Math.max(0, strike.at), kind: strike.kind, aim: strike.aim,
  depth: strike.depth, delta: strike.delta, bx: strike.ball.x, by: strike.ball.y, bz: strike.ball.z, px: strike.x, pz: strike.z,
});
export const pingOf = (round: number, q: number, c?: number): PingPacket => ({ t: 'tennis', k: 'png', r: round, q, ...(c === undefined ? {} : { c }) });
export const stateOf = (round: number, state: World): StatePacket => {
  const { random: _random, ...serializable } = state;
  return {
    t: 'tennis',
    k: 'S',
    r: round,
    state: { ...structuredClone(serializable), random: rng32(state.seed) } as World,
    v: NET_VERSION,
  };
};
/** A guest's return, as the host takes it. */
export const strikeOf = (packet: HitPacket): Strike => ({
  shot: packet.shot, at: packet.at, kind: packet.kind, aim: packet.aim, depth: packet.depth, delta: packet.delta,
  ball: { x: packet.bx, y: packet.by, z: packet.bz }, x: packet.px, z: packet.pz,
});
export const eventOf = (round: number, event: Event): EventPacket => ({ t: 'tennis', k: 'ev', r: round, event });

function bounded(value: unknown, limit: number): value is number {
  return finite(value) && Math.abs(value) <= limit;
}

function validState(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<World>;
  if (!formatOk(state.format) || !levelOk(state.level) || !lengthOk(state.match?.length) || !phases.includes(state.phase ?? '')) return false;
  if (!Array.isArray(state.players) || state.players.length !== (state.format === 'doubles' ? 4 : 2)) return false;
  if (!state.players.every((player) => player && Number.isInteger(player.seat) && player.seat >= 0 && player.seat <= 3
    && (player.team === 0 || player.team === 1)
    && bounded(player.x, 20) && bounded(player.z, 30) && bounded(player.vx, 20) && bounded(player.vz, 20)
    && bounded(player.prevX, 20) && bounded(player.prevZ, 30)
    && player.input && bounded(player.input.x, 1) && bounded(player.input.z, 1)
    && (player.pending === null || (player.pending && kindOk(player.pending.kind) && bounded(player.pending.at, 1e9) && aimOk(player.pending.aim)))
    && kindOk(player.swingKind) && bounded(player.swingLunge, 1) && bounded(player.lungeX, 1) && bounded(player.lungeZ, 1)
    && bounded(player.facing, Math.PI * 2) && bounded(player.swing, 2) && bounded(player.anim, 1e9)
    && typeof player.name === 'string' && player.name.length <= 32
    && (player.ai === null || levelOk(player.ai)) && typeof player.connected === 'boolean')) return false;
  const ball = state.ball;
  if (!ball || !ball.p || !ball.prev || !ball.v || !ball.spin
    || !bounded(ball.p.x, 40) || !bounded(ball.p.y, 40) || !bounded(ball.p.z, 40)
    || !bounded(ball.prev.x, 40) || !bounded(ball.prev.y, 40) || !bounded(ball.prev.z, 40)
    || !bounded(ball.v.x, 100) || !bounded(ball.v.y, 100) || !bounded(ball.v.z, 100)
    || !bounded(ball.spin.x, 1000) || !bounded(ball.spin.y, 1000) || !bounded(ball.spin.z, 1000)
    || !Number.isInteger(ball.hitByTeam) || ball.hitByTeam < 0 || ball.hitByTeam > 1
    || !Number.isInteger(ball.canHitTeam) || ball.canHitTeam < 0 || ball.canHitTeam > 1
    || !Number.isInteger(ball.bounces) || ball.bounces < 0 || ball.bounces > 2
    || !Number.isInteger(ball.targetTeam) || ball.targetTeam < 0 || ball.targetTeam > 1
    || !kindOk(ball.shotKind)
    || !Number.isSafeInteger(ball.rallyShot) || ball.rallyShot < 0
    || typeof ball.inPlay !== 'boolean' || typeof ball.netCord !== 'boolean') return false;
  const match = state.match;
  if (!match || !Array.isArray(match.games) || match.games.length !== 2 || !match.games.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)
    || !Array.isArray(match.sets) || match.sets.length !== 2 || !match.sets.every((n) => Number.isInteger(n) && n >= 0 && n <= 9)
    || !Array.isArray(match.points) || match.points.length !== 2 || !match.points.every((n) => Number.isInteger(n) && n >= 0 && n <= 8)
    || !Array.isArray(match.tbPoints) || match.tbPoints.length !== 2 || !match.tbPoints.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)
    || !Array.isArray(match.completedSets) || match.completedSets.length > 20
    || !match.completedSets.every((set) => Array.isArray(set) && set.length === 2 && set.every((n) => Number.isInteger(n) && n >= 0 && n <= 99))
    || typeof match.tiebreak !== 'boolean'
    || !(match.winner === null || match.winner === 0 || match.winner === 1)) return false;
  if (!bounded(state.serverSeat, 3) || !Number.isInteger(state.serverSeat) || state.serverSeat < 0
    || !bounded(state.serverIndex, 3) || !Number.isInteger(state.serverIndex) || state.serverIndex < -1
    || !bounded(state.firstTiebreakServer, 3) || !Number.isInteger(state.firstTiebreakServer) || state.firstTiebreakServer < 0
    || (state.serveNumber !== 1 && state.serveNumber !== 2)
    || (state.serveBox !== 0 && state.serveBox !== 1)
    || !bounded(state.clock, 1e9) || !bounded(state.serveClock, 30) || !bounded(state.pointClock, 30)
    || !bounded(state.callClock, 30) || !bounded(state.serveSpeed, 500)
    || !bounded(state.rallyShot, Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(state.rallyShot) || state.rallyShot < 0
    || !bounded(state.seed, Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(state.seed) || !bounded(state.acc, 1)) return false;
  if (!Array.isArray(state.receiverFlip) || state.receiverFlip.length !== 2
    || !state.receiverFlip.every((n) => n === 0 || n === 1)
    || !(state.pointWinner === null || state.pointWinner === 0 || state.pointWinner === 1)
    || !(typeof state.lastCall === 'string' && (state.lastCall === '' || pointCalls.includes(state.lastCall)))
    || state.players.some((player, index) => player.seat !== index || player.team !== index % 2)) return false;
  // (newer hosts' netplay fields, each optional)
  if (state.warp !== undefined && !(Number.isSafeInteger(state.warp) && state.warp >= 0)) return false;
  if (state.grace !== undefined && !(Array.isArray(state.grace) && state.grace.length === 2
    && state.grace.every((n) => finite(n) && n >= 0 && n <= 1))) return false;
  if (state.held !== undefined && state.held !== null && !(typeof state.held === 'object'
    && (state.held.winner === 0 || state.held.winner === 1) && pointCalls.includes(state.held.call) && bounded(state.held.at, 1e9))) return false;
  return true;
}

/** Each of `keys` on `packet` is a number within `limit`. */
const all = (packet: Record<string, unknown>, keys: string[], limit: number) => keys.every((key) => bounded(packet[key], limit));
const timeOk = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1e9;

function validEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'call') return typeof event.call === 'string' && pointCalls.includes(event.call);
  if (event.type === 'hit') return Number.isInteger(event.seat) && (event.seat as number) >= 0 && (event.seat as number) <= 3
    && typeof event.serve === 'boolean' && bounded(event.speed, 500) && kindOk(event.kind)
    && Number.isSafeInteger(event.shot) && (event.shot as number) >= 0
    && (event.delta === undefined || bounded(event.delta, 1));
  if (event.type === 'bounce') return bounded(event.x, 40) && bounded(event.z, 40) && typeof event.in === 'boolean'
    && typeof event.line === 'boolean' && typeof event.serve === 'boolean';
  if (event.type === 'net') return bounded(event.x, 40) && bounded(event.z, 40);
  if (event.type === 'point') return (event.winner === 0 || event.winner === 1)
    && Array.isArray(event.games) && event.games.length === 2 && event.games.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)
    && Array.isArray(event.points) && event.points.length === 2 && event.points.every((n) => Number.isInteger(n) && n >= 0 && n <= 99);
  if (event.type === 'game') return (event.winner === 0 || event.winner === 1)
    && Array.isArray(event.games) && event.games.length === 2 && event.games.every((n) => Number.isInteger(n) && n >= 0 && n <= 99);
  if (event.type === 'set') return (event.winner === 0 || event.winner === 1)
    && Array.isArray(event.sets) && event.sets.length === 2 && event.sets.every((n) => Number.isInteger(n) && n >= 0 && n <= 9);
  if (event.type === 'end') return event.winner === 0 || event.winner === 1;
  return false;
}

export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (packet.t !== 'tennis' || !roundOk(packet.r)) return null;
  const r = packet.r;
  if (packet.k === 'cfg') {
    if (!formatOk(packet.format) || !lengthOk(packet.length) || !levelOk(packet.level)) return null;
    return { k: 'cfg', r, format: packet.format, length: packet.length, level: packet.level };
  }
  if (packet.k === 'sw') {
    if (!roundOk(packet.shot) || !bounded(packet.delta, 1) || !kindOk(packet.kind) || !aimOk(packet.aim) || !bounded(packet.swipe, 2500)) return null;
    if ((packet.c !== undefined || packet.at !== undefined) && (packet.c !== 1 || !timeOk(packet.at))) return null;
    return {
      k: 'sw', r, shot: packet.shot, delta: packet.delta, kind: packet.kind, aim: packet.aim, swipe: packet.swipe,
      ...(packet.c === 1 ? { c: 1 as const, at: packet.at as number } : {}),
    };
  }
  if (packet.k === 'mv') {
    const quantized = (value: unknown) => bounded(value, 1) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
    if (!quantized(packet.x) || !quantized(packet.z)) return null;
    const own = ['px', 'pz', 'vx', 'vz', 'w', 'at'];
    if (own.some((key) => packet[key] !== undefined)) {
      if (!bounded(packet.px, 20) || !bounded(packet.pz, 30) || !all(packet, ['vx', 'vz'], 20)
        || !(Number.isSafeInteger(packet.w) && (packet.w as number) >= 0) || !timeOk(packet.at)) return null;
      return {
        k: 'mv', r, x: packet.x as number, z: packet.z as number,
        px: packet.px, pz: packet.pz, vx: packet.vx as number, vz: packet.vz as number, w: packet.w as number, at: packet.at,
      };
    }
    return { k: 'mv', r, x: packet.x as number, z: packet.z as number };
  }
  if (packet.k === 'toss' || packet.k === 'serve') {
    if (!aimOk(packet.aim) || (packet.k === 'serve' && packet.kind !== 'topspin' && packet.kind !== 'slice' && packet.kind !== 'flat')) return null;
    if (packet.at !== undefined && !timeOk(packet.at)) return null;
    const contact = packet.k === 'serve' && packet.delta !== undefined;
    if (contact && (!bounded(packet.delta, 1) || !all(packet, ['bx', 'by', 'bz'], 40) || !bounded(packet.px, 20) || !bounded(packet.pz, 30))) return null;
    return {
      k: packet.k, r, aim: packet.aim,
      ...(packet.k === 'serve' ? { kind: packet.kind as 'topspin' | 'slice' | 'flat' } : {}),
      ...(packet.at !== undefined ? { at: packet.at } : {}),
      ...(contact ? {
        delta: packet.delta as number, bx: packet.bx as number, by: packet.by as number, bz: packet.bz as number,
        px: packet.px as number, pz: packet.pz as number,
      } : {}),
    };
  }
  if (packet.k === 'hit') {
    if (!roundOk(packet.shot) || !timeOk(packet.at) || !kindOk(packet.kind) || !aimOk(packet.aim) || !bounded(packet.depth, 1)
      || !bounded(packet.delta, 1) || !all(packet, ['bx', 'by', 'bz'], 40) || !bounded(packet.px, 20) || !bounded(packet.pz, 30)) return null;
    return {
      k: 'hit', r, shot: packet.shot, at: packet.at, kind: packet.kind, aim: packet.aim, depth: packet.depth, delta: packet.delta,
      bx: packet.bx as number, by: packet.by as number, bz: packet.bz as number, px: packet.px, pz: packet.pz,
    };
  }
  if (packet.k === 'png') {
    if (!finite(packet.q) || packet.q < 0 || packet.q > 1e13 || (packet.c !== undefined && !timeOk(packet.c))) return null;
    return { k: 'png', r, q: packet.q, ...(packet.c !== undefined ? { c: packet.c as number } : {}) };
  }
  if (packet.k === 'S' && validState(packet.state)) {
    const { random: _random, ...serializable } = packet.state as World;
    const v = Number.isSafeInteger(packet.v) && (packet.v as number) > 0 ? { v: packet.v as number } : {};
    return { k: 'S', r, state: { ...serializable, random: rng32(serializable.seed) } as World, ...v };
  }
  if (packet.k === 'ev' && validEvent(packet.event)) return { k: 'ev', r, event: packet.event };
  return null;
}

export function commandOf(packet: SwingPacket | MovePacket | ServePacket, seat: number): Command | null {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) return null;
  if (packet.k === 'mv') return { seat, move: { x: packet.x, z: packet.z } };
  if (packet.k === 'sw') return {
    seat,
    swing: { kind: packet.kind, aim: packet.aim, delta: packet.delta, swipe: packet.swipe },
  };
  if (packet.k === 'toss') return { seat, toss: true };
  return { seat, serve: true, swing: { kind: packet.kind ?? 'topspin', aim: packet.aim, delta: 0 } };
}
