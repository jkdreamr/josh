import type { FlightState, Intent, MatchState, MatchStats, Point2D, ShotType, Side } from '../games/badminton';
import type { Impact, LandingMark } from './badminton-draw';

/**
 * Online badminton. The host runs the match: side a is the host, side b the guest. The host streams snapshots of the
 * court on the fast channel and the score on the reliable one. Everything that arrives is checked before use.
 *
 * A newer host (snapshots with v) lets a newer guest move its own athlete (own) and play its own returns and serves
 * (hit and sv, with the moment they were played on the host's clock), and says how each flight was launched (l), so the
 * guest runs the shuttle on itself (badminton-netplay.ts). An older host never says v, and a guest then sends its
 * controls and swings (in, jump, seek, hit) for the host to play as they arrive, as before. Every new field is
 * optional, and older peers drop the fields, or the messages, they don't know.
 */
export type NetPhase = 'serve' | 'rally' | 'point' | 'interval' | 'game-end' | 'match-end';
export type NetControls = { left: boolean; right: boolean; jump: boolean; soft: boolean };
/** cs: the clock a smash has been wound up since, while it is held (newer hosts). */
export type NetAthlete = { x: number; vx: number; jump: number; jumpVelocity: number; swingStart: number; intent: Intent; cs?: number | null };
/**
 * A flight as it left the racket: shot n of the rally, played at host time `at` and held still until fz (the beat after
 * a smash), the stroke it was and how hard. With the shuttle's own physics this says where it is at any moment after.
 */
export type Launch = { n: number; at: number; fz: number; s: ShotType; p: number; f: FlightState };
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
  /** newer hosts: the netplay version, how many times the players have been put in place, ends switched, the server */
  v?: number;
  w?: number;
  e?: boolean;
  sv?: Side;
  /** the flight in play, as launched */
  l?: Launch | null;
};
export type NetScore = { t: 'm'; match: MatchState; stats: MatchStats; phase: NetPhase; call: { key: number; title: string; detail: string } | null };
/**
 * A newer guest's own athlete: where it is at host time `at` (x, vx, jump j and its speed jv), which way it is heading
 * (m), the smash it has wound up since cs, its last swing (ss, in), and the placing (w) it moves on from.
 */
export type OwnReport = { t: 'own'; x: number; vx: number; j: number; jv: number; m: -1 | 0 | 1; cs: number | null; ss: number; in: Intent; w: number; at: number };
/**
 * A swing. From a newer guest it is a return already played: shot n met at (sx, sy) at host time `at`, by the athlete at
 * x with jump j, el seconds into the shot's flight, with seed for its scatter.
 */
export type HitMessage = { t: 'hit'; intent?: Intent; power?: number; at?: number; n?: number; sx?: number; sy?: number; x?: number; j?: number; el?: number; seed?: number };
/** A newer guest's serve, from x at host time `at`, in the placing w. */
export type ServeMessage = { t: 'sv'; at: number; x: number; intent: Intent; seed: number; w: number };
/** A guest's ping (q, on its own clock) and the host's answer, with the host's clock (c). */
export type PingMessage = { t: 'png'; q: number; c?: number };
export type GuestMessage =
  | { t: 'in'; c: NetControls }
  | { t: 'jump' }
  | HitMessage
  | { t: 'seek'; x: number | null }
  | { t: 'go' }
  | OwnReport
  | ServeMessage
  | PingMessage;

/** The netplay a host speaks (NetSnapshot.v): a guest that sees it moves itself and plays its own shots. */
export const NET_VERSION = 1;

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
    const hit: HitMessage = { t: 'hit' };
    if (value.intent !== undefined) hit.intent = value.intent as Intent;
    if (value.power !== undefined) hit.power = value.power;
    // (a return already played: all of it, or it is only a swing)
    if (value.at !== undefined) {
      const { at, n, sx, sy, x, j, el, seed } = value;
      if (!num(at) || !Number.isSafeInteger(n) || !num(sx) || !num(sy) || !num(x) || !num(j) || !num(el) || !Number.isSafeInteger(seed)) return null;
      if (Math.abs(sx) > 20 || sy < -1 || sy > 20 || Math.abs(x) > 20 || j < 0 || j > 5 || el < 0 || (seed as number) < 0) return null;
      Object.assign(hit, { at, n, sx, sy, x, j, el, seed });
    }
    return hit;
  }
  if (value.t === 'seek') return value.x === null ? { t: 'seek', x: null } : num(value.x) && Math.abs(value.x) < 20 ? { t: 'seek', x: value.x } : null;
  if (value.t === 'own') {
    const { x, vx, j, jv, m, cs, ss, at, w } = value;
    if (!num(x) || !num(vx) || !num(j) || !num(jv) || !num(ss) || !num(at) || !Number.isSafeInteger(w) || (cs !== null && !num(cs))) return null;
    if (m !== -1 && m !== 0 && m !== 1) return null;
    if (!INTENTS.includes(value.in as Intent) || Math.abs(x) > 20 || Math.abs(vx) > 50 || j < 0 || j > 5 || Math.abs(jv) > 50) return null;
    return { t: 'own', x, vx, j, jv, m, cs: cs as number | null, ss, in: value.in as Intent, w: w as number, at };
  }
  if (value.t === 'sv') {
    const { at, x, seed, w } = value;
    if (!num(at) || !num(x) || Math.abs(x) > 20 || !Number.isSafeInteger(seed) || (seed as number) < 0 || !Number.isSafeInteger(w) || !INTENTS.includes(value.intent as Intent)) return null;
    return { t: 'sv', at, x, intent: value.intent as Intent, seed: seed as number, w: w as number };
  }
  if (value.t === 'png') return num(value.q) && value.c === undefined ? { t: 'png', q: value.q } : null;
  return null;
}

/** The host's answer to this guest's ping. */
export function parsePong(value: unknown): { q: number; c: number } | null {
  return isObject(value) && value.t === 'png' && num(value.q) && num(value.c) ? { q: value.q, c: value.c } : null;
}

function athlete(v: unknown): NetAthlete | null {
  if (!isObject(v)) return null;
  const { x, vx, jump, jumpVelocity, swingStart, intent } = v;
  if (!num(x) || !num(vx) || !num(jump) || !num(jumpVelocity) || !num(swingStart) || !INTENTS.includes(intent as Intent)) return null;
  return { x, vx, jump, jumpVelocity, swingStart, intent: intent as Intent, ...(num(v.cs) ? { cs: v.cs } : {}) };
}

function launch(v: unknown): Launch | null | undefined {
  if (v === undefined || v === null) return null;
  if (!isObject(v) || !Number.isSafeInteger(v.n) || !num(v.at) || !num(v.fz) || !SHOTS.includes(v.s as ShotType) || !num(v.p)) return undefined;
  const f = flight(v.f);
  if (!f) return undefined;
  return { n: v.n as number, at: v.at, fz: v.fz, s: v.s as ShotType, p: Math.max(0, Math.min(1, v.p)), f };
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
  const impact = isObject(imp) && num(imp.x) && num(imp.y) && num(imp.at) && bool(imp.strong) ? { x: imp.x, y: imp.y, at: imp.at, strong: imp.strong, ...(num(imp.charge) ? { charge: Math.max(0, Math.min(1, imp.charge)) } : {}) } : null;
  const ls = value.lastShot;
  const lastShot = isObject(ls) && SHOTS.includes(ls.type as ShotType) && num(ls.speed) ? { type: ls.type as ShotType, speed: ls.speed, ...(num(ls.power) && ls.power >= 0 && ls.power <= 1 ? { power: ls.power } : {}) }
      : null;
  const snap: NetSnapshot = { t: 's', clock: value.clock, phase: value.phase as NetPhase, a, b, flight: f, marks, impact, shake: value.shake, rallyShots: value.rallyShots, lastShot };
  // (a newer host's: all of it, or none of it)
  if (value.v !== undefined) {
    const l = launch(value.l);
    if (!Number.isSafeInteger(value.v) || !Number.isSafeInteger(value.w) || !bool(value.e) || !SIDES.includes(value.sv as Side) || l === undefined) return null;
    Object.assign(snap, { v: value.v, w: value.w, e: value.e, sv: value.sv, l });
  }
  return snap;
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
