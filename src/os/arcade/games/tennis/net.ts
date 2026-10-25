import { rng32, type Command, type Event, type Format, type Level, type MatchLength, type Swing, type World } from './logic.ts';

export type ConfigPacket = { t?: 'tennis'; k: 'cfg'; r: number; format: Format; length: MatchLength; level: Level };
export type SwingPacket = { t?: 'tennis'; k: 'sw'; r: number; shot: number; delta: number; kind: Swing['kind']; aim: -1 | 0 | 1; swipe: number };
export type ServePacket = { t?: 'tennis'; k: 'toss' | 'serve'; r: number; aim: -1 | 0 | 1 };
export type StatePacket = { t?: 'tennis'; k: 'S'; r: number; state: World };
export type EventPacket = { t?: 'tennis'; k: 'ev'; r: number; event: Event };
export type Packet = ConfigPacket | SwingPacket | ServePacket | StatePacket | EventPacket;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const roundOk = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const levelOk = (value: unknown): value is Level => value === 0 || value === 1 || value === 2;
const formatOk = (value: unknown): value is Format => value === 'singles' || value === 'doubles';
const lengthOk = (value: unknown): value is MatchLength => value === 'game' || value === 'three' || value === 'set';
const kindOk = (value: unknown): value is Swing['kind'] => value === 'drive' || value === 'slice' || value === 'lob';
const aimOk = (value: unknown): value is -1 | 0 | 1 => value === -1 || value === 0 || value === 1;
const pointCalls = ['fault', 'double fault', 'let', 'out', 'net', 'point', 'game', 'set', 'match'];
const phases = ['serve-ready', 'serve-toss', 'serve-flight', 'rally', 'point', 'done'];

export const configOf = (round: number, format: Format, length: MatchLength, level: Level): ConfigPacket => ({
  t: 'tennis', k: 'cfg', r: round, format, length, level,
});
export const swingOf = (round: number, shot: number, swing: Swing): SwingPacket => ({
  t: 'tennis', k: 'sw', r: round, shot, delta: swing.delta, kind: swing.kind, aim: swing.aim, swipe: swing.swipe ?? 0,
});
export const serveOf = (round: number, k: 'toss' | 'serve', aim: -1 | 0 | 1 = 0): ServePacket => ({ t: 'tennis', k, r: round, aim });
export const stateOf = (round: number, state: World): StatePacket => {
  const { random: _random, ...serializable } = state;
  return {
    t: 'tennis',
    k: 'S',
    r: round,
    state: { ...structuredClone(serializable), random: rng32(state.seed) } as World,
  };
};
export const eventOf = (round: number, event: Event): EventPacket => ({ t: 'tennis', k: 'ev', r: round, event });

function bounded(value: unknown, limit: number): value is number {
  return finite(value) && Math.abs(value) <= limit;
}

function validState(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<World>;
  if (!formatOk(state.format) || !lengthOk(state.match?.length) || !phases.includes(state.phase ?? '')) return false;
  if (!Array.isArray(state.players) || state.players.length !== (state.format === 'doubles' ? 4 : 2)) return false;
  if (!state.players.every((player) => player && Number.isInteger(player.seat) && player.seat >= 0 && player.seat <= 3
    && (player.team === 0 || player.team === 1)
    && bounded(player.x, 20) && bounded(player.z, 30) && bounded(player.vx, 20) && bounded(player.vz, 20)
    && bounded(player.facing, Math.PI * 2) && bounded(player.swing, 2) && bounded(player.anim, 1e9)
    && typeof player.name === 'string' && player.name.length <= 32
    && (player.ai === null || levelOk(player.ai)) && typeof player.connected === 'boolean')) return false;
  const ball = state.ball;
  if (!ball || !ball.p || !ball.v || !ball.spin
    || !bounded(ball.p.x, 40) || !bounded(ball.p.y, 40) || !bounded(ball.p.z, 40)
    || !bounded(ball.v.x, 100) || !bounded(ball.v.y, 100) || !bounded(ball.v.z, 100)
    || !bounded(ball.spin.x, 1000) || !bounded(ball.spin.y, 1000) || !bounded(ball.spin.z, 1000)
    || !Number.isInteger(ball.hitByTeam) || ball.hitByTeam < 0 || ball.hitByTeam > 1
    || !Number.isInteger(ball.canHitTeam) || ball.canHitTeam < 0 || ball.canHitTeam > 1
    || !Number.isInteger(ball.bounces) || ball.bounces < 0 || ball.bounces > 2
    || !Number.isInteger(ball.targetTeam) || ball.targetTeam < 0 || ball.targetTeam > 1
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
  return true;
}

function validEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'call') return typeof event.call === 'string' && pointCalls.includes(event.call);
  if (event.type === 'hit') return Number.isInteger(event.seat) && (event.seat as number) >= 0 && (event.seat as number) <= 3
    && typeof event.serve === 'boolean' && bounded(event.speed, 500) && kindOk(event.kind)
    && Number.isSafeInteger(event.shot) && (event.shot as number) >= 0;
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
    return { k: 'sw', r, shot: packet.shot, delta: packet.delta, kind: packet.kind, aim: packet.aim, swipe: packet.swipe };
  }
  if (packet.k === 'toss' || packet.k === 'serve') {
    if (!aimOk(packet.aim)) return null;
    return { k: packet.k, r, aim: packet.aim };
  }
  if (packet.k === 'S' && validState(packet.state)) {
    const { random: _random, ...serializable } = packet.state as World;
    return { k: 'S', r, state: { ...serializable, random: rng32(serializable.seed) } as World };
  }
  if (packet.k === 'ev' && validEvent(packet.event)) return { k: 'ev', r, event: packet.event };
  return null;
}

export function commandOf(packet: SwingPacket | ServePacket, seat: number): Command | null {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) return null;
  if (packet.k === 'sw') return {
    seat,
    swing: { kind: packet.kind, aim: packet.aim, delta: packet.delta, swipe: packet.swipe },
  };
  if (packet.k === 'toss') return { seat, toss: true };
  return { seat, serve: true, swing: { kind: 'drive', aim: packet.aim, delta: 0 } };
}
