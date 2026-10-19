import type { FlightState, Intent, MatchState, MatchStats, Point2D, ShotType, Side } from '../games/badminton';
import type { Impact, LandingMark } from './badminton-draw';

/**
 * Online badminton. The host runs the only simulation: side a is the host, side b the guest.
 * The guest sends its controls and swings; the host streams snapshots of the court on the fast
 * channel and the score on the reliable one. Everything that arrives is checked before use.
 */
export type NetPhase = 'serve' | 'rally' | 'point' | 'interval' | 'game-end' | 'match-end';
export type NetControls = { left: boolean; right: boolean; jump: boolean; soft: boolean };
export type NetAthlete = { x: number; vx: number; jump: number; jumpVelocity: number; swingStart: number; intent: Intent };
export type NetSnapshot = {
  t: 's';
  clock: number;
  phase: NetPhase;
  a: NetAthlete;
  b: NetAthlete;
  flight: FlightState | null;
  marks: LandingMark[];
  impact: Impact | null;
  shake: number;
  rallyShots: number;
  lastShot: { type: ShotType; speed: number; power?: number } | null;
};
export type NetScore = { t: 'm'; match: MatchState; stats: MatchStats; phase: NetPhase; call: { key: number; title: string; detail: string } | null };
export type GuestMessage =
  | { t: 'in'; c: NetControls }
  | { t: 'jump' }
  | { t: 'hit'; intent?: Intent; power?: number }
  | { t: 'seek'; x: number | null }
  | { t: 'go' };

const PHASES: NetPhase[] = ['serve', 'rally', 'point', 'interval', 'game-end', 'match-end'];
const INTENTS: Intent[] = ['normal', 'power', 'soft'];
const SHOTS: ShotType[] = ['clear', 'drop', 'smash', 'drive', 'net', 'lift', 'serve', 'high-serve'];
const SIDES: Side[] = ['a', 'b'];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';

export function parseGuestMessage(value: unknown): GuestMessage | null {
  if (!isObject(value)) return null;
  if (value.t === 'in' && isObject(value.c)) {
    const c = value.c;
    return bool(c.left) && bool(c.right) && bool(c.jump) && bool(c.soft) ? { t: 'in', c: { left: c.left, right: c.right, jump: c.jump, soft: c.soft } } : null;
  }
  if (value.t === 'jump' || value.t === 'go') return { t: value.t };
  if (value.t === 'hit') {
    if (value.intent !== undefined && !INTENTS.includes(value.intent as Intent)) return null;
    if (value.power !== undefined && !(typeof value.power === 'number' && value.power >= 0 && value.power <= 1)) return null;
    const hit: { t: 'hit'; intent?: Intent; power?: number } = { t: 'hit' };
    if (value.intent !== undefined) hit.intent = value.intent as Intent;
    if (value.power !== undefined) hit.power = value.power;
    return hit;
  }
  if (value.t === 'seek') return value.x === null ? { t: 'seek', x: null } : num(value.x) && Math.abs(value.x) < 20 ? { t: 'seek', x: value.x } : null;
  return null;
}

function athlete(v: unknown): NetAthlete | null {
  if (!isObject(v)) return null;
  const { x, vx, jump, jumpVelocity, swingStart, intent } = v;
  if (!num(x) || !num(vx) || !num(jump) || !num(jumpVelocity) || !num(swingStart) || !INTENTS.includes(intent as Intent)) return null;
  return { x, vx, jump, jumpVelocity, swingStart, intent: intent as Intent };
}

function flight(v: unknown): FlightState | null | undefined {
  if (v === null) return null;
  if (!isObject(v) || !isObject(v.shuttle)) return undefined;
  const s = v.shuttle;
  if (!num(s.x) || !num(s.y) || !num(s.vx) || !num(s.vy)) return undefined;
  if (!SIDES.includes(v.hitter as Side) || (v.direction !== 1 && v.direction !== -1) || !bool(v.isServe)) return undefined;
  if (!['flying', 'landed', 'fault'].includes(v.status as string) || !num(v.accumulator) || !num(v.elapsed) || !num(v.maxSpeed) || !num(v.heading)) return undefined;
  const fault = v.fault === null || ['net', 'out', 'own-side', 'short-service'].includes(v.fault as string) ? (v.fault as FlightState['fault']) : undefined;
  if (fault === undefined) return undefined;
  return {
    shuttle: { x: s.x, y: s.y, vx: s.vx, vy: s.vy },
    hitter: v.hitter as Side,
    direction: v.direction,
    isServe: v.isServe,
    status: v.status as FlightState['status'],
    fault,
    accumulator: v.accumulator,
    elapsed: v.elapsed,
    maxSpeed: v.maxSpeed,
    heading: v.heading,
  };
}

export function parseSnapshot(value: unknown): NetSnapshot | null {
  if (!isObject(value) || value.t !== 's' || !num(value.clock) || !PHASES.includes(value.phase as NetPhase)) return null;
  const a = athlete(value.a);
  const b = athlete(value.b);
  const f = flight(value.flight);
  if (!a || !b || f === undefined || !num(value.shake) || !num(value.rallyShots)) return null;
  const marks = Array.isArray(value.marks)
    ? value.marks.filter((m): m is LandingMark => isObject(m) && num(m.x) && num(m.at) && ['in', 'out', 'net'].includes(m.kind as string)).slice(0, 8)
    : [];
  const imp = value.impact;
  const impact = isObject(imp) && num(imp.x) && num(imp.y) && num(imp.at) && bool(imp.strong) ? { x: imp.x, y: imp.y, at: imp.at, strong: imp.strong } : null;
  const ls = value.lastShot;
  const lastShot = isObject(ls) && SHOTS.includes(ls.type as ShotType) && num(ls.speed) ? { type: ls.type as ShotType, speed: ls.speed, ...(num(ls.power) && ls.power >= 0 && ls.power <= 1 ? { power: ls.power } : {}) }
      : null;
  return { t: 's', clock: value.clock, phase: value.phase as NetPhase, a, b, flight: f, marks, impact, shake: value.shake, rallyShots: value.rallyShots, lastShot };
}

const sideScores = (v: unknown): v is Record<Side, number> => isObject(v) && num(v.a) && num(v.b);

/** The score packet. Only the fields the guest reads are checked; the host built them with newMatch and newStats. */
export function parseScore(value: unknown): NetScore | null {
  if (!isObject(value) || value.t !== 'm' || !PHASES.includes(value.phase as NetPhase)) return null;
  const match = value.match;
  const stats = value.stats;
  if (!isObject(match) || !sideScores(match.points) || !sideScores(match.games) || !SIDES.includes(match.server as Side) || !bool(match.endsSwitched)) return null;
  if (!Array.isArray(match.history) || !match.history.every(sideScores) || ![1, 2, 3].includes(match.game as number) || ![1, 3].includes(match.bestOf as number)) return null;
  if (match.matchWinner !== null && !SIDES.includes(match.matchWinner as Side)) return null;
  if (match.gameWinner !== null && !SIDES.includes(match.gameWinner as Side)) return null;
  if (!['quick', 'game', 'match'].includes(match.length as string) || !num(match.target) || !num(match.cap) || !bool(match.intervalDue) || !bool(match.intervalTaken)) return null;
  const sideStats = (v: unknown) => isObject(v) && num(v.points) && num(v.winners) && num(v.errors) && num(v.smashes) && num(v.fastestSmash);
  if (!isObject(stats) || !sideStats(stats.a) || !sideStats(stats.b) || !num(stats.longestRally) || !num(stats.rallies) || !num(stats.longestRallySeconds)) return null;
  const c = value.call;
  const call = isObject(c) && num(c.key) && typeof c.title === 'string' && typeof c.detail === 'string' ? { key: c.key, title: c.title.slice(0, 80), detail: c.detail.slice(0, 120) } : null;
  return { t: 'm', match: match as unknown as MatchState, stats: stats as unknown as MatchStats, phase: value.phase as NetPhase, call };
}

/** Adds the shuttle's position to its trail when it has moved far enough, keeping the last few points. */
export function trailPoint(points: Point2D[], next: Point2D, max = 14): Point2D[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(last.x - next.x, last.y - next.y) <= 0.12) return points;
  const out = [...points, { x: next.x, y: next.y }];
  return out.length > max ? out.slice(out.length - max) : out;
}
