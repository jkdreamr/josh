import { cpuSwing, movementTarget } from './ai.ts';
import { REPLAY_POINT_CLOCK, shouldReplay } from './replay.ts';

export const STEP = 1 / 120;
export const STRIKE_RADIUS = 1.7;
export const COURT_LENGTH = 23.77;
export const SINGLES_WIDTH = 8.23;
export const DOUBLES_WIDTH = 10.97;
export const SERVICE_LINE = 6.4;
export const BALL_RADIUS = 0.0335;
export const BALL_MASS = 0.0577;
export const SWING_LEAD = 0.12;
export const SWING_WINDOW = 0.16;
export const SWING_BUFFER = 0.9;
export const IDEAL_SWING_LEAD = 0.3;
export const GRAVITY = 9.81;
export const TOSS_START = 1.35;

export type Format = 'singles' | 'doubles';
export type MatchLength = 'game' | 'three' | 'set';
export type Level = 0 | 1 | 2;
export type Phase = 'serve-ready' | 'serve-toss' | 'serve-flight' | 'rally' | 'point' | 'done';
export type ShotKind = 'topspin' | 'slice' | 'flat' | 'lob' | 'drop' | 'smash' | 'volley';
export type PointCall = 'fault' | 'double fault' | 'let' | 'out' | 'net' | 'point' | 'game' | 'set' | 'match';

export type Vec3 = { x: number; y: number; z: number };
export type MoveInput = { x: number; z: number };
export type Spin3 = { x: number; y: number; z: number };
export type Ball = {
  p: Vec3;
  prev: Vec3;
  v: Vec3;
  spin: Spin3;
  inPlay: boolean;
  hitByTeam: number;
  canHitTeam: number;
  bounces: number;
  lastBounceTeam: number;
  targetTeam: number;
  rallyShot: number;
  netCord: boolean;
  shotKind: ShotKind;
};
export type Player = {
  seat: number;
  team: number;
  name: string;
  ai: Level | null;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  input: MoveInput;
  pending: { kind: ShotKind; at: number; aim: number } | null;
  facing: number;
  swing: number;
  swingKind: ShotKind;
  swingLunge: number;
  lungeX: number;
  lungeZ: number;
  anim: number;
  serveToss: number;
  connected: boolean;
};
export type MatchState = {
  length: MatchLength;
  games: [number, number];
  sets: [number, number];
  points: [number, number];
  tiebreak: boolean;
  tbPoints: [number, number];
  completedSets: Array<[number, number]>;
  winner: number | null;
};
export type World = {
  format: Format;
  level: Level;
  phase: Phase;
  match: MatchState;
  players: Player[];
  ball: Ball;
  serverSeat: number;
  serverIndex: number;
  firstTiebreakServer: number;
  serveNumber: 1 | 2;
  serveBox: 0 | 1;
  receiverFlip: [0 | 1, 0 | 1];
  clock: number;
  serveClock: number;
  pointClock: number;
  pointWinner: number | null;
  lastCall: PointCall | '';
  callClock: number;
  serveSpeed: number;
  rallyShot: number;
  seed: number;
  random: () => number;
  acc: number;
};
export type Swing = { kind: ShotKind; aim: number; delta: number; depth?: number; swipe?: number };
export type Command = { seat: number; move?: MoveInput; swing?: Swing; toss?: boolean; serve?: boolean };
export type Event =
  | { type: 'hit'; seat: number; serve: boolean; speed: number; kind: ShotKind; shot: number; delta?: number }
  | { type: 'bounce'; x: number; z: number; in: boolean; line: boolean; serve: boolean }
  | { type: 'net'; x: number; z: number }
  | { type: 'call'; call: PointCall }
  | { type: 'point'; winner: number; games: [number, number]; points: [number, number] }
  | { type: 'game'; winner: number; games: [number, number] }
  | { type: 'set'; winner: number; sets: [number, number] }
  | { type: 'end'; winner: number };

export const shouldSmash = (ballY: number, inStrikeZone = true) => inStrikeZone && ballY >= 2.2;
export const classifyShot = (kind: ShotKind, ballY: number, playerZ: number) => kind === 'smash' || ((kind === 'topspin' || kind === 'flat') && shouldSmash(ballY))
  ? 'smash' as const
  : Math.abs(playerZ) < 6 && (kind === 'topspin' || kind === 'flat' || kind === 'slice' || kind === 'drop')
    ? kind === 'slice' || kind === 'drop' ? 'drop' as const : 'volley' as const
    : kind;
export const strikeRadius = (level: Level) => level === 0 ? 2.6 : level === 1 ? 2 : STRIKE_RADIUS;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const courtWidth = (format: Format) => format === 'doubles' ? DOUBLES_WIDTH : SINGLES_WIDTH;
export const matchTarget = (length: MatchLength) => length === 'game' ? 1 : length === 'three' ? 2 : 1;
export const pointLabel = (n: number) => ['0', '15', '30', '40'][Math.min(3, n)] ?? '40';
export const netHeight = (x: number) => 0.914 + 0.156 * Math.min(1, (Math.abs(x) / (DOUBLES_WIDTH / 2)) ** 2);

export function rng32(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function activeSeats(format: Format) {
  return format === 'doubles' ? [0, 1, 2, 3] : [0, 1];
}

export function createWorld(options: {
  format?: Format;
  length?: MatchLength;
  level?: Level;
  seed?: number;
  players?: Partial<Pick<Player, 'name' | 'ai' | 'connected'>>[];
} = {}): World {
  const format = options.format ?? 'singles';
  const level = options.level ?? 1;
  const seed = options.seed ?? 1;
  const random = rng32(seed);
  const seats = activeSeats(format);
  const players = seats.map((seat): Player => {
    const setup = options.players?.[seat] ?? {};
    const team = seat % 2;
    const x = team === 0 ? (seat === 2 ? 1.2 : -1.2) : (seat === 3 ? 1.2 : -1.2);
    const z = team === 0 ? COURT_LENGTH / 2 - 1.6 : -COURT_LENGTH / 2 + 1.6;
    return {
      seat,
      team,
      name: setup.name ?? (seat === 0 ? 'You' : ['Ace', 'Lobby', 'Volley'][seat - 1] ?? `Player ${seat + 1}`),
      ai: setup.ai === undefined ? (seat === 0 ? null : level) : setup.ai,
      x,
      z,
      prevX: x,
      prevZ: z,
      vx: 0,
      vz: 0,
      input: { x: 0, z: 0 },
      pending: null,
      facing: team === 0 ? Math.PI : 0,
      swing: 0,
      swingKind: 'topspin',
      swingLunge: 0,
      lungeX: 0,
      lungeZ: 0,
      anim: 0,
      serveToss: 0,
      connected: setup.connected ?? true,
    };
  });
  const world: World = {
    format,
    level,
    phase: 'serve-ready',
    match: {
      length: options.length ?? 'game',
      games: [0, 0],
      sets: [0, 0],
      points: [0, 0],
      tiebreak: false,
      tbPoints: [0, 0],
      completedSets: [],
      winner: null,
    },
    players,
    ball: {
      p: { x: 0, y: BALL_RADIUS, z: 0 },
      prev: { x: 0, y: BALL_RADIUS, z: 0 },
      v: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0, z: 0 },
      inPlay: false,
      hitByTeam: 0,
      canHitTeam: 0,
      bounces: 0,
      lastBounceTeam: -1,
      targetTeam: 1,
      rallyShot: 0,
      netCord: false,
      shotKind: 'topspin',
    },
    serverSeat: 0,
    serverIndex: 0,
    firstTiebreakServer: 0,
    serveNumber: 1,
    serveBox: 0,
    receiverFlip: [0, 1],
    clock: 0,
    serveClock: 0,
    pointClock: 0,
    pointWinner: null,
    lastCall: '',
    callClock: 0,
    serveSpeed: 0,
    rallyShot: 0,
    seed,
    random,
    acc: 0,
  };
  resetServe(world);
  return world;
}

export function teamSeats(world: World, team: number) {
  return world.players.filter((player) => player.team === team).map((player) => player.seat);
}

export function serverOf(world: World) {
  return world.players.find((player) => player.seat === world.serverSeat) ?? world.players[0];
}

export function serveSide(world: World) {
  const points = world.match.tiebreak
    ? world.match.tbPoints[0] + world.match.tbPoints[1]
    : world.match.points[0] + world.match.points[1];
  return (points % 2) as 0 | 1;
}

export function receiverOf(world: World) {
  const team = 1 - (serverOf(world)?.team ?? 0);
  const seats = teamSeats(world, team);
  if (seats.length < 2) return seats[0] ?? -1;
  return seats[world.receiverFlip[team] === world.serveBox ? 0 : 1] ?? seats[0];
}

export function scoreText(world: World) {
  const { match } = world;
  const games = `${match.games[0]}-${match.games[1]}`;
  const sets = match.length === 'set' ? `${match.sets[0]}-${match.sets[1]} sets · ` : '';
  if (match.tiebreak) return `${sets}${games} · ${match.tbPoints[0]}-${match.tbPoints[1]}`;
  if (match.points[0] >= 3 && match.points[1] >= 3) {
    if (match.points[0] === match.points[1]) return `${sets}${games} · deuce`;
    return `${sets}${games} · advantage ${match.points[0] > match.points[1] ? 'A' : 'B'}`;
  }
  return `${sets}${games} · ${pointLabel(match.points[0])}-${pointLabel(match.points[1])}`;
}

function serveHandPosition(world: World, server: Player): Vec3 {
  const localX = -0.36;
  const localZ = 0.035;
  const cos = Math.cos(server.facing);
  const sin = Math.sin(server.facing);
  return {
    x: server.x + cos * localX + sin * localZ,
    y: 1.05,
    z: server.z - sin * localX + cos * localZ,
  };
}

function resetBall(world: World) {
  const server = serverOf(world);
  const team = server?.team ?? 0;
  world.ball.p = server ? serveHandPosition(world, server) : { x: 0, y: 1.05, z: 0 };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: 0, z: 0 };
  world.ball.spin = { x: 0, y: 0, z: 0 };
  world.ball.inPlay = false;
  world.ball.hitByTeam = team;
  world.ball.canHitTeam = team;
  world.ball.bounces = 0;
  world.ball.lastBounceTeam = -1;
  world.ball.targetTeam = 1 - team;
  world.ball.rallyShot = world.rallyShot;
  world.ball.netCord = false;
}

function resetServe(world: World) {
  world.phase = 'serve-ready';
  world.serveNumber = 1;
  world.serveClock = 0;
  world.pointClock = 0;
  world.pointWinner = null;
  world.serveBox = serveSide(world);
  world.callClock = Math.max(0, world.callClock);
  for (const player of world.players) {
    player.vx = 0;
    player.vz = 0;
    player.swing = 0;
    player.pending = null;
    player.input.x = 0;
    player.input.z = 0;
    player.serveToss = 0;
    const half = player.team === 0 ? 1 : -1;
    const partner = world.format === 'doubles' && player.seat % 2 === 0 ? (player.seat === 0 ? 2 : 0) : (player.seat === 1 ? 3 : 1);
    if (player.seat === world.serverSeat) {
      player.x = (world.serveBox === 0 ? -1 : 1) * 1.7;
      player.z = half * (COURT_LENGTH / 2 - 0.65);
    } else if (player.team === serverOf(world)?.team) {
      player.x = world.format === 'doubles' ? (player.seat === partner ? 2.8 : -2.8) : 0;
      player.z = half * 4.5;
    } else if (player.seat === receiverOf(world)) {
      player.x = (world.serveBox === 0 ? 1 : -1) * 2.05;
      player.z = half * (COURT_LENGTH / 2 + 0.8);
    } else {
      player.x = world.format === 'doubles' ? (player.seat === partner ? -2.9 : 2.9) : 0;
      player.z = half * 4.7;
    }
    player.facing = player.team === 0 ? Math.PI : 0;
    player.prevX = player.x;
    player.prevZ = player.z;
  }
  resetBall(world);
}

export function isInCourt(x: number, z: number, format: Format, radius = BALL_RADIUS) {
  return Math.abs(x) <= courtWidth(format) / 2 + radius
    && Math.abs(z) <= COURT_LENGTH / 2 + radius;
}

export function isInServiceBox(x: number, z: number, receiverTeam: number, box: 0 | 1, format: Format) {
  const half = receiverTeam === 0 ? 1 : -1;
  const width = courtWidth(format) / 2;
  const xMin = box === 0 ? 0 : -width;
  const xMax = box === 0 ? width : 0;
  return z * half >= 0
    && Math.abs(z) >= COURT_LENGTH / 2 - SERVICE_LINE - BALL_RADIUS
    && Math.abs(z) <= COURT_LENGTH / 2 + BALL_RADIUS
    && x >= xMin - BALL_RADIUS
    && x <= xMax + BALL_RADIUS;
}

export function timingQuality(delta: number) {
  const distance = Math.abs(delta);
  if (!Number.isFinite(delta)) return { hit: false, quality: 0, direction: 1 };
  const quality = clamp(1 - distance / 0.62, 0.18, 1);
  return { hit: true, quality, direction: delta < 0 ? -1 : delta > 0 ? 1 : 0 };
}

function cpuTimingQuality(delta: number) {
  const distance = Math.abs(delta);
  if (!Number.isFinite(delta) || distance > SWING_WINDOW) {
    return { hit: false, quality: 0, direction: delta < 0 ? -1 : 1 };
  }
  return { hit: true, quality: 1 - distance / SWING_WINDOW, direction: delta < 0 ? -1 : delta > 0 ? 1 : 0 };
}

export function timingLabel(delta: number): 'early' | 'late' | 'perfect' {
  return delta < -0.06 ? 'early' : delta > 0.06 ? 'late' : 'perfect';
}

function acceleration(ball: Ball): Vec3 {
  const speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
  const drag = speed > 0 ? 0.5 * 1.21 * 0.55 * Math.PI * BALL_RADIUS ** 2 / BALL_MASS * speed : 0;
  const w = Math.hypot(ball.spin.x, ball.spin.y, ball.spin.z);
  const lift = w > 0 ? clamp(1 / (2 + speed / (BALL_RADIUS * w)), 0, 0.42) * 0.5 * 1.21 * Math.PI * BALL_RADIUS ** 2 / BALL_MASS * speed * speed : 0;
  const cross = {
    x: ball.spin.y * ball.v.z - ball.spin.z * ball.v.y,
    y: ball.spin.z * ball.v.x - ball.spin.x * ball.v.z,
    z: ball.spin.x * ball.v.y - ball.spin.y * ball.v.x,
  };
  const crossLength = Math.hypot(cross.x, cross.y, cross.z) || 1;
  return {
    x: -ball.v.x * drag + cross.x / crossLength * lift,
    y: -GRAVITY - ball.v.y * drag + cross.y / crossLength * lift,
    z: -ball.v.z * drag + cross.z / crossLength * lift,
  };
}

function integrate(ball: Ball, dt: number) {
  const a = acceleration(ball);
  ball.v.x += a.x * dt;
  ball.v.y += a.y * dt;
  ball.v.z += a.z * dt;
  ball.p.x += ball.v.x * dt;
  ball.p.y += ball.v.y * dt;
  ball.p.z += ball.v.z * dt;
  const spinDecay = Math.exp(-0.12 * dt);
  ball.spin.x *= spinDecay;
  ball.spin.y *= spinDecay;
  ball.spin.z *= spinDecay;
}

const bounceResponse: Record<ShotKind, { restitution: number; friction: number; forwardKick: number; sideKick: number; spinRetention: number }> = {
  topspin: { restitution: 0.9, friction: 0.84, forwardKick: 0.0034, sideKick: 0.0015, spinRetention: 0.64 },
  slice: { restitution: 0.43, friction: 0.66, forwardKick: 0.0012, sideKick: 0.003, spinRetention: 0.55 },
  flat: { restitution: 0.58, friction: 0.75, forwardKick: 0.001, sideKick: 0.0008, spinRetention: 0.58 },
  lob: { restitution: 0.76, friction: 0.82, forwardKick: 0.0022, sideKick: 0.001, spinRetention: 0.65 },
  drop: { restitution: 0.24, friction: 0.48, forwardKick: 0.0008, sideKick: 0.001, spinRetention: 0.42 },
  smash: { restitution: 0.66, friction: 0.76, forwardKick: 0.0017, sideKick: 0.001, spinRetention: 0.58 },
  volley: { restitution: 0.5, friction: 0.64, forwardKick: 0.0011, sideKick: 0.0015, spinRetention: 0.5 },
};

export function bounceBall(ball: Ball) {
  const response = bounceResponse[ball.shotKind];
  const alongSpin = ball.spin.z * Math.sign(ball.v.z || 1);
  const sideSpin = ball.spin.y * Math.sign(ball.v.z || 1);
  const speed = Math.hypot(ball.v.x, ball.v.z);
  ball.v.y = -ball.v.y * response.restitution + Math.max(0, alongSpin) * 0.003;
  ball.v.x = ball.v.x * response.friction + sideSpin * response.sideKick;
  ball.v.z = ball.v.z * response.friction + alongSpin * response.forwardKick;
  ball.spin.x *= response.spinRetention;
  ball.spin.y *= response.spinRetention;
  ball.spin.z *= response.spinRetention;
  if (ball.shotKind === 'drop') {
    ball.v.x *= 0.78;
    ball.v.z *= 0.78;
  }
  return speed;
}

function bounceAtGround(ball: Ball) {
  if (ball.p.y > BALL_RADIUS || ball.v.y >= 0) return null;
  ball.p.y = BALL_RADIUS;
  const impact = { x: ball.p.x, y: ball.p.y, z: ball.p.z };
  bounceBall(ball);
  return impact;
}

function landingPoint(from: Vec3, velocity: Vec3, spin: Spin3, durationLimit = 6, shotKind: ShotKind = 'topspin') {
  const test: Ball = {
    p: { ...from }, prev: { ...from }, v: { ...velocity }, spin: { ...spin }, inPlay: true,
    hitByTeam: 0, canHitTeam: 0, bounces: 0, lastBounceTeam: -1, targetTeam: 1, rallyShot: 0, netCord: false, shotKind,
  };
  let crossedNet = false;
  for (let t = 0; t < durationLimit; t += STEP) {
    const oldZ = test.p.z;
    integrate(test, STEP);
    if (!crossedNet && oldZ * test.p.z <= 0 && Math.abs(oldZ - test.p.z) > 1e-6) {
      crossedNet = true;
      if (test.p.y < netHeight(test.p.x) + 0.07) return { x: test.p.x, z: test.p.z, time: t, clearsNet: false };
    }
    const bounce = bounceAtGround(test);
    if (bounce) return { x: bounce.x, z: bounce.z, time: t, clearsNet: true };
  }
  return { x: test.p.x, z: test.p.z, time: durationLimit, clearsNet: false };
}

export function predictLanding(from: Vec3, velocity: Vec3, spin: Spin3, durationLimit = 6, shotKind: ShotKind = 'topspin') {
  return landingPoint(from, velocity, spin, durationLimit, shotKind);
}

export function predictContactPoint(ball: Ball, player: Pick<Player, 'team' | 'x' | 'z'>, durationLimit = 2.5) {
  const test: Ball = {
    ...ball,
    p: { ...ball.p },
    prev: { ...ball.prev },
    v: { ...ball.v },
    spin: { ...ball.spin },
  };
  let best = { x: ball.p.x, z: ball.p.z };
  let bestDistance = Infinity;
  const isPlayerSide = (z: number) => player.team === 0 ? z >= 0 : z < 0;
  for (let elapsed = 0; elapsed < durationLimit; elapsed += STEP) {
    integrate(test, STEP);
    if (bounceAtGround(test)) {
      if (test.bounces > 0) break;
      test.bounces = 1;
    }
    if (test.p.y < 0.15 || test.p.y > 2.9 || !isPlayerSide(test.p.z)) continue;
    const distance = Math.hypot(test.p.x - player.x, test.p.z - player.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: test.p.x, z: test.p.z };
    }
  }
  return best;
}

export function solveShot(from: Vec3, target: { x: number; z: number }, spin: Spin3, apexHint = 3, horizontalScale = 1, shotKind: ShotKind = 'topspin'): Vec3 {
  const apex = apexHint <= from.y + 0.4 ? Math.max(BALL_RADIUS, apexHint) : Math.max(from.y + 1.05, apexHint);
  const vy = Math.sqrt(2 * GRAVITY * (apex - from.y));
  const flight = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0.01, from.y - BALL_RADIUS))) / GRAVITY;
  let vx = (target.x - from.x) / (flight * horizontalScale);
  let vz = (target.z - from.z) / (flight * horizontalScale);
  const targetVec = { ...target };
  const trial = (x: number, z: number) => landingPoint(from, { x: x * horizontalScale, y: vy, z: z * horizontalScale }, spin, Math.min(5.2, flight * 1.6), shotKind);
  for (let iteration = 0; iteration < 14; iteration++) {
    const p = trial(vx, vz);
    const ex = targetVec.x - p.x;
    const ez = targetVec.z - p.z;
    if (Math.hypot(ex, ez) < 0.015 && p.clearsNet) break;
    const eps = 0.035;
    const px = trial(vx + eps, vz);
    const pz = trial(vx, vz + eps);
    const jxx = (px.x - p.x) / eps;
    const jzx = (px.z - p.z) / eps;
    const jxz = (pz.x - p.x) / eps;
    const jzz = (pz.z - p.z) / eps;
    const determinant = jxx * jzz - jxz * jzx;
    if (Math.abs(determinant) < 1e-5) break;
    const dx = (ex * jzz - ez * jxz) / determinant;
    const dz = (ez * jxx - ex * jzx) / determinant;
    vx += clamp(dx, -5, 5);
    vz += clamp(dz, -5, 5);
  }
  return { x: vx, y: vy, z: vz };
}

function solveServe(from: Vec3, target: { x: number; z: number }, spin: Spin3, pace: number, shotKind: ShotKind): Vec3 {
  const distance = Math.hypot(target.x - from.x, target.z - from.z);
  const flight = distance / pace;
  let velocity: Vec3 = {
    x: (target.x - from.x) / flight,
    y: (BALL_RADIUS - from.y + 0.5 * GRAVITY * flight * flight) / flight,
    z: (target.z - from.z) / flight,
  };
  const epsilon = 0.04;
  for (let iteration = 0; iteration < 14; iteration++) {
    const p = landingPoint(from, velocity, spin, Math.min(5.2, flight * 2), shotKind);
    const ex = target.x - p.x;
    const ez = target.z - p.z;
    if (Math.hypot(ex, ez) < 0.015 && p.clearsNet) break;
    const px = landingPoint(from, { ...velocity, x: velocity.x + epsilon }, spin, Math.min(5.2, flight * 2), shotKind);
    const pz = landingPoint(from, { ...velocity, z: velocity.z + epsilon }, spin, Math.min(5.2, flight * 2), shotKind);
    const jxx = (px.x - p.x) / epsilon;
    const jzx = (px.z - p.z) / epsilon;
    const jxz = (pz.x - p.x) / epsilon;
    const jzz = (pz.z - p.z) / epsilon;
    const determinant = jxx * jzz - jxz * jzx;
    if (Math.abs(determinant) < 1e-5) break;
    velocity.x += clamp((ex * jzz - ez * jxz) / determinant, -8, 8);
    velocity.z += clamp((ez * jxx - ex * jzx) / determinant, -8, 8);
  }
  return velocity;
}

type CourtTarget = { x: number; z: number; opposite: number };

function humanTarget(world: World, player: Player, kind: ShotKind, aimX: number, depthInput: number, delta: number): CourtTarget {
  const width = courtWidth(world.format) / 2;
  const direction = player.team === 0 ? -1 : 1;
  const opposite = 1 - player.team;
  const margin = world.level === 0 ? 0.9 : world.level === 1 ? 0.6 : 0.3;
  if (world.phase === 'serve-toss' || world.phase === 'serve-ready') {
    const boxX = (world.serveBox === 0 ? 1 : -1) * Math.min(width * 0.52, 1.75);
    const screenAim = player.team === 0 ? aimX : -aimX;
    const wide = screenAim < -0.25 ? 1 : screenAim > 0.25 ? -1 : 0;
    const x = boxX + Math.sign(boxX) * wide * 1.1;
    return { x, z: direction * (COURT_LENGTH / 2 - SERVICE_LINE / 2), opposite };
  }
  const aim = clamp(aimX, -1, 1);
  const timing = timingQuality(delta);
  const timingShift = world.level === 0 ? 0
    : timing.direction * (world.level === 1 ? 0.8 : 1.6) * (1 - timing.quality);
  let x = clamp(aim * (width - margin), -width + margin, width - margin) + timingShift;
  if (world.level === 1) x = clamp(x, -width + margin, width - margin);
  const forward = depthInput * direction;
  const netDistance = kind === 'drop' ? 3
    : kind === 'lob' ? COURT_LENGTH / 2 - 2.5
      : kind === 'smash' ? 5
        : kind === 'volley' ? 4
          : forward > 0.15 ? 5.5 : forward < -0.15 ? COURT_LENGTH / 2 - 1.2 : COURT_LENGTH / 2 - 2.5;
  return { x, z: direction * netDistance, opposite };
}

function shotTarget(world: World, player: Player, swing: Swing, quality: number): CourtTarget {
  if (player.ai === null) return humanTarget(world, player, swing.kind, swing.aim, swing.depth ?? player.input.z, swing.delta);
  const width = courtWidth(world.format) / 2;
  const rallyCpu = player.ai < 2;
  const opposite = 1 - player.team;
  const direction = player.team === 0 ? -1 : 1;
  if (world.phase === 'serve-toss' || world.phase === 'serve-ready') {
    const easyCpuAgainstHuman = player.ai === 0 && world.players.some((other) => other.team !== player.team && other.ai === null);
    const x = easyCpuAgainstHuman
      ? (world.serveBox === 0 ? 1 : -1) * width / 4
      : (world.serveBox === 0 ? 1 : -1) * Math.min(width * 0.52, 1.75);
    return { x, z: direction * (COURT_LENGTH / 2 - SERVICE_LINE / 2), opposite };
  }
  const margin = 0.3;
  let x = clamp(swing.aim, -1, 1) * (width - margin);
  const receiver = rallyCpu ? world.players.find((other) => other.team !== player.team && other.ai === null) : undefined;
  const netDistance = player.ai === 0 && receiver ? COURT_LENGTH / 2 - (2.5 + world.random() * 1.5)
    : swing.kind === 'drop' ? 3
      : swing.kind === 'lob' ? COURT_LENGTH / 2 - 2.1
        : swing.kind === 'smash' ? 5
          : swing.kind === 'volley' ? 4
            : swing.kind === 'slice' ? COURT_LENGTH / 2 - 3.4
              : COURT_LENGTH / 2 - (1.5 + world.random() * 1.5);
  let easyReceiverX: number | null = null;
  if (rallyCpu) {
    if (receiver) {
      const reach = player.ai === 0 ? 0.8 : 4;
      x = clamp(receiver.x + (world.random() - 0.5) * reach * 1.8, -width + margin, width - margin);
      if (player.ai === 0) easyReceiverX = receiver.x;
    }
  }
  if (world.format === 'doubles' && world.random() < 0.18) x *= 0.45;
  const timingSpread = player.ai === 0 ? 0.6 : player.ai === 1 ? 0.65 : 0.4;
  x += timingQuality(swing.delta).direction * timingSpread * (1 - quality);
  if (easyReceiverX !== null) x = clamp(x, easyReceiverX - 1.6, easyReceiverX + 1.6);
  x = clamp(x, -width - 0.8, width + 0.8);
  let z = direction * netDistance;
  if (player.ai === 0 && receiver && world.random() < 0.12) {
    const missDistance = 0.5 + world.random();
    if (world.random() < 0.5) x = (world.random() < 0.5 ? -1 : 1) * (width + missDistance);
    else z = direction * (COURT_LENGTH / 2 + missDistance);
  }
  return { x, z, opposite };
}

export function previewTarget(world: World, player: Player, kind: ShotKind): CourtTarget {
  const classifiedKind = classifyShot(kind, 1, player.z);
  return humanTarget(world, player, classifiedKind, player.input.x, player.input.z, 0);
}

const shotProfiles: Record<ShotKind, { spinX: number; sideSpin: number; topSpin: number; apex: number; pace: number }> = {
  topspin: { spinX: 0, sideSpin: 5, topSpin: 72, apex: 4.6, pace: 0.98 },
  slice: { spinX: 0, sideSpin: 22, topSpin: -42, apex: 2.65, pace: 0.84 },
  flat: { spinX: 0, sideSpin: 2, topSpin: 6, apex: 2.35, pace: 1.18 },
  lob: { spinX: 0, sideSpin: 2, topSpin: 30, apex: 7.2, pace: 0.72 },
  drop: { spinX: 0, sideSpin: 4, topSpin: -12, apex: 2.45, pace: 0.57 },
  smash: { spinX: 0, sideSpin: 6, topSpin: 22, apex: 0, pace: 1.42 },
  volley: { spinX: 0, sideSpin: 6, topSpin: 18, apex: 2.8, pace: 1.1 },
};

export const shotProfile = (kind: ShotKind) => shotProfiles[kind];

function applyShot(world: World, player: Player, swing: Swing, serve = false, events?: Event[]) {
  const timing = serve
    ? { hit: Number.isFinite(swing.delta) && Math.abs(swing.delta) <= 0.58, quality: Math.max(0, 1 - Math.abs(swing.delta) / 0.58), direction: 0 }
    : player.ai === null ? timingQuality(swing.delta) : cpuTimingQuality(swing.delta);
  if (!timing.hit) {
    player.swing = 0.42;
    player.swingKind = swing.kind;
    return false;
  }
  player.swing = 0.56;
  player.swingKind = swing.kind === 'drop' && Math.abs(player.z) < 6 ? 'volley' : swing.kind;
  const quality = timing.quality;
  const target = shotTarget(world, player, swing, quality);
  const easyCpuAgainstHuman = player.ai === 0 && world.players.some((other) => other.team !== player.team && other.ai === null);
  if (!serve && player.ai === null) {
    const dx = world.ball.p.x - player.x;
    const dz = world.ball.p.z - player.z;
    const distance = Math.hypot(dx, dz);
    const radius = strikeRadius(world.level);
    player.swingLunge = clamp((distance - 1.1) / Math.max(0.1, radius - 1.1), 0, 1);
    player.lungeX = distance > 0 ? dx / distance : 0;
    player.lungeZ = distance > 0 ? dz / distance : 0;
  } else player.swingLunge = 0;
  const easyCpu = player.ai === 0;
  const side = player.team === 0 ? -1 : 1;
  const from = {
    x: player.x + clamp(world.ball.p.x - player.x, -0.68, 0.68) + swing.aim * 0.08,
    y: serve ? clamp(world.ball.p.y, 2.05, 3.7) : swing.kind === 'smash' ? clamp(world.ball.p.y, 2.05, 3.1) : clamp(world.ball.p.y, 0.55, 1.42),
    z: player.z + side * 0.35,
  };
  const profile = shotProfiles[swing.kind];
  const spin: Spin3 = {
    x: profile.spinX,
    y: profile.sideSpin * (swing.aim || 0.25),
    z: profile.topSpin,
  };
  const apex = swing.kind === 'smash' ? from.y + 0.12
    : player.ai === null && swing.kind === 'topspin' && world.level === 0 ? profile.apex + 0.25
      : easyCpuAgainstHuman && swing.kind === 'topspin' ? profile.apex + 0.7
      : profile.apex;
  const serveCap = player.ai === 0 ? (easyCpuAgainstHuman ? 85 : 100) / 3.6 : player.ai === 1 ? 120 / 3.6 : player.ai === 2 ? 170 / 3.6 : 175 / 3.6;
  const swipePace = clamp((swing.swipe ?? 0) / 2000, 0, 1) * 0.13;
  const pace = serve ? 1 : clamp(0.75 + quality * 0.34 + swipePace, 0.68, 1.18) * profile.pace * (easyCpuAgainstHuman ? 0.55 : easyCpu ? 0.82 : 1);
  const hardHumanSolvePace = profile.pace * clamp(0.75 + 0.34, 0.68, 1.18);
  const servePace = swing.kind === 'flat' ? 28 + quality * 20
    : swing.kind === 'slice' ? 24 + quality * 15 : 22 + quality * 16;
  const velocity = serve
    ? solveServe(from, target, spin, Math.min(servePace, serveCap), swing.kind)
    : solveShot(from, target, spin, apex, player.ai === null && world.level === 2 ? hardHumanSolvePace : pace, swing.kind);
  if (serve) {
    const horizontal = Math.hypot(velocity.x, velocity.z);
    if (horizontal > serveCap) {
      velocity.x *= serveCap / horizontal;
      velocity.z *= serveCap / horizontal;
    }
  }
  world.ball.p = from;
  world.ball.prev = { ...from };
  world.ball.v = { x: velocity.x * pace, y: velocity.y, z: velocity.z * pace };
  world.ball.spin = spin;
  world.ball.shotKind = swing.kind;
  world.ball.inPlay = true;
  world.ball.hitByTeam = player.team;
  world.ball.canHitTeam = 1 - player.team;
  world.ball.targetTeam = target.opposite;
  world.ball.bounces = 0;
  world.ball.lastBounceTeam = -1;
  world.ball.rallyShot = ++world.rallyShot;
  world.ball.netCord = false;
  world.phase = serve ? 'serve-flight' : 'rally';
  world.serveClock = 0;
  world.serveSpeed = serve ? Math.round(Math.hypot(world.ball.v.x, world.ball.v.z) * 3.6) : 0;
  events?.push({
    type: 'hit',
    seat: player.seat,
    serve,
    speed: serve ? world.serveSpeed : Math.round(Math.hypot(world.ball.v.x, world.ball.v.z) * 3.6),
    kind: swing.kind,
    shot: world.rallyShot,
    ...(player.ai === null && !serve ? { delta: swing.delta } : {}),
  });
  return true;
}

export function tossServe(world: World, seat: number) {
  if (world.phase !== 'serve-ready' || world.serverSeat !== seat) return false;
  world.phase = 'serve-toss';
  world.serveClock = 0;
  world.ball.p.y = TOSS_START;
  world.ball.prev.y = TOSS_START;
  serverOf(world)!.serveToss = 1;
  return true;
}

export function hitServe(world: World, seat: number, delta = 0, aim = 0, kind: ShotKind = 'topspin') {
  if (world.phase !== 'serve-toss' || world.serverSeat !== seat) return false;
  if (!Number.isFinite(delta) || Math.abs(delta) > 0.58) {
    serverOf(world)!.serveToss = 0;
    return false;
  }
  const player = serverOf(world);
  if (!player) return false;
  const serveKind = kind === 'slice' || kind === 'flat' ? kind : 'topspin';
  const result = applyShot(world, player, { kind: serveKind, aim: clamp(aim, -1, 1), delta: clamp(delta, -0.85, 0.85) }, true);
  if (result) {
    world.serveSpeed = Math.round(Math.hypot(world.ball.v.x, world.ball.v.z) * 3.6);
  }
  player.serveToss = 0;
  return result;
}

function awardPoint(world: World, winner: number, call: PointCall, events: Event[]) {
  const match = world.match;
  world.phase = 'point';
  world.pointWinner = winner;
  world.pointClock = shouldReplay({
    call,
    rallyShots: world.rallyShot,
    pointWinner: winner,
    lastHitter: world.ball.hitByTeam,
  }) ? REPLAY_POINT_CLOCK : 1.35;
  world.rallyShot = 0;
  world.ball.inPlay = false;
  world.lastCall = call;
  world.callClock = 1.5;
  events.push({ type: 'call', call });
  events.push({ type: 'point', winner, games: [...match.games], points: [...match.points] });
  if (match.tiebreak) {
    match.tbPoints[winner]++;
    const high = Math.max(...match.tbPoints);
    const low = Math.min(...match.tbPoints);
    if (high >= 7 && high - low >= 2) {
      finishSet(world, winner, events, true);
    }
  } else {
    match.points[winner]++;
    const own = match.points[winner];
    const other = match.points[1 - winner];
    if (own >= 4 && own - other >= 2) finishGame(world, winner, events);
  }
}

export function scorePoint(world: World, winner: number, call: PointCall = 'point') {
  const events: Event[] = [];
  awardPoint(world, winner, call, events);
  return events;
}

function finishGame(world: World, winner: number, events: Event[]) {
  const match = world.match;
  match.games[winner]++;
  match.points = [0, 0];
  events.push({ type: 'game', winner, games: [...match.games] });
  const target = match.length === 'set' ? 6 : matchTarget(match.length);
  const gameDiff = Math.abs(match.games[0] - match.games[1]);
  if (match.length !== 'set' && match.games[winner] >= target) {
    match.winner = winner;
    world.phase = 'done';
    world.lastCall = 'match';
    events.push({ type: 'end', winner });
    return;
  }
  if (match.length === 'set' && match.games[winner] >= 6 && gameDiff >= 2) {
    finishSet(world, winner, events, false);
    if (match.winner !== null) return;
  } else if (match.length === 'set' && match.games[0] === 6 && match.games[1] === 6) {
    match.tiebreak = true;
    match.tbPoints = [0, 0];
    world.firstTiebreakServer = nextServer(world.serverSeat, world.format);
    world.serverSeat = world.firstTiebreakServer;
  }
  if (!match.tiebreak) world.serverSeat = nextServer(world.serverSeat, world.format);
  world.serverIndex = world.players.findIndex((p) => p.seat === world.serverSeat);
  if (world.format === 'doubles') {
    world.receiverFlip[0] = world.receiverFlip[0] ? 0 : 1;
    world.receiverFlip[1] = world.receiverFlip[1] ? 0 : 1;
  }
}

function finishSet(world: World, winner: number, events: Event[], fromTiebreak: boolean) {
  const match = world.match;
  if (fromTiebreak) match.games[winner]++;
  match.completedSets.push([...match.games]);
  match.sets[winner]++;
  events.push({ type: 'set', winner, sets: [...match.sets] });
  match.tiebreak = false;
  match.tbPoints = [0, 0];
  match.points = [0, 0];
  match.games = [0, 0];
  if (match.sets[winner] >= 1) {
    match.winner = winner;
    world.phase = 'done';
    world.lastCall = 'match';
    events.push({ type: 'end', winner });
  } else {
    world.serverSeat = nextServer(world.serverSeat, world.format);
  }
}

function nextServer(seat: number, format: Format) {
  const order = format === 'doubles' ? [0, 1, 2, 3] : [0, 1];
  return order[(Math.max(0, order.indexOf(seat)) + 1) % order.length];
}

function advanceTiebreakServer(world: World) {
  if (!world.match.tiebreak) return;
  const points = world.match.tbPoints[0] + world.match.tbPoints[1];
  if (points === 1 || (points > 1 && points % 2 === 1)) {
    world.serverSeat = nextServer(world.serverSeat, world.format);
  }
}

function callFault(world: World, events: Event[]) {
  if (world.ball.netCord && world.ball.lastBounceTeam === 1 - serverOf(world)!.team) {
    world.lastCall = 'let';
    world.callClock = 1.1;
    events.push({ type: 'call', call: 'let' });
    resetServe(world);
    return;
  }
  if (world.serveNumber === 1) {
    world.serveNumber = 2;
    world.phase = 'serve-ready';
    world.lastCall = 'fault';
    world.callClock = 1.2;
    events.push({ type: 'call', call: 'fault' });
    resetBall(world);
  } else {
    world.lastCall = 'double fault';
    awardPoint(world, 1 - serverOf(world)!.team, 'double fault', events);
  }
}

function ballTeam(z: number) {
  return z >= 0 ? 0 : 1;
}

export function updateBall(world: World, events: Event[]) {
  if (!world.ball.inPlay) return;
  const ball = world.ball;
  const oldZ = ball.p.z;
  integrate(ball, STEP);
  if (oldZ * ball.p.z <= 0 && Math.abs(oldZ - ball.p.z) > 1e-5 && ball.p.y < netHeight(ball.p.x) + 0.055) {
    ball.p.z = oldZ;
    ball.v.z *= -0.32;
    ball.v.y = Math.max(0.2, ball.v.y * 0.28);
    ball.netCord = true;
    events.push({ type: 'net', x: ball.p.x, z: 0 });
    if (world.phase === 'rally') {
      awardPoint(world, 1 - ball.hitByTeam, 'net', events);
      return;
    }
  }
  const impact = bounceAtGround(ball);
  if (impact) {
    const side = ballTeam(impact.z);
    const inCourt = isInCourt(impact.x, impact.z, world.format);
    const line = inCourt && (
      Math.abs(Math.abs(impact.z) - COURT_LENGTH / 2) <= BALL_RADIUS + 0.06
      || Math.abs(Math.abs(impact.x) - courtWidth(world.format) / 2) <= BALL_RADIUS + 0.04
      || (world.phase === 'serve-flight' && Math.abs(Math.abs(impact.z) - (COURT_LENGTH / 2 - SERVICE_LINE)) <= BALL_RADIUS + 0.06)
    );
    events.push({ type: 'bounce', x: impact.x, z: impact.z, in: inCourt, line, serve: world.phase === 'serve-flight' });
    if (world.phase === 'serve-flight') {
      const valid = inCourt && isInServiceBox(impact.x, impact.z, 1 - ball.hitByTeam, world.serveBox, world.format);
      if (!valid) {
        callFault(world, events);
        return;
      }
      if (ball.netCord) {
        world.lastCall = 'let';
        world.callClock = 1.1;
        events.push({ type: 'call', call: 'let' });
        resetServe(world);
        return;
      }
      ball.inPlay = true;
      ball.bounces = 1;
      ball.lastBounceTeam = side;
      ball.canHitTeam = side;
      world.phase = 'rally';
      return;
    }
    if (ball.bounces > 0) {
      awardPoint(world, ball.hitByTeam, 'point', events);
      return;
    }
    if (!inCourt || side !== ball.targetTeam) {
      awardPoint(world, 1 - ball.hitByTeam, 'out', events);
      return;
    }
    ball.bounces = 1;
    ball.lastBounceTeam = side;
    ball.canHitTeam = side;
  }
}

function playerBounds(world: World, player: Player) {
  const half = courtWidth(world.format) / 2;
  const near = player.team === 0;
  return {
    xMin: -half - 1.5,
    xMax: half + 1.5,
    zMin: near ? 0.4 : -COURT_LENGTH / 2 - 3,
    zMax: near ? COURT_LENGTH / 2 + 3 : -0.4,
  };
}

export function movePlayer(world: World, player: Player, dt = STEP) {
  player.swingLunge = Math.max(0, player.swingLunge - dt * 5);
  player.facing = player.team === 0 ? Math.PI : 0;
  const serving = player.seat === world.serverSeat && world.phase === 'serve-ready';
  if (player.seat === world.serverSeat && world.phase === 'serve-toss') {
    player.serveToss = clamp(player.serveToss + dt * 0.2, 0, 1);
    player.vx = 0;
    player.vz = 0;
    return;
  }
  const bounds = playerBounds(world, player);
  let desiredX = 0;
  let desiredZ = 0;
  if (serving) {
    const box = world.serveBox === 0 ? -1 : 1;
    const limit = courtWidth(world.format) / 2 - 0.55;
    bounds.xMin = box < 0 ? -limit : 0.4;
    bounds.xMax = box < 0 ? -0.4 : limit;
    desiredX = clamp(player.input.x, -1, 1) * 6.5;
  } else if (player.ai === null) {
    desiredX = clamp(player.input.x, -1, 1) * 6.5;
    desiredZ = clamp(player.input.z, -1, 1) * 6.5;
  } else {
    const target = movementTarget(world, player);
    const dx = clamp(target.x, bounds.xMin, bounds.xMax) - player.x;
    const dz = clamp(target.z, bounds.zMin, bounds.zMax) - player.z;
    const distance = Math.hypot(dx, dz);
    const maxSpeed = player.ai === 0 ? 4.6 : player.ai === 1 ? 6.2 : 6.6;
    const speed = Math.min(maxSpeed, distance * 2.2);
    if (distance > 0.01) {
      desiredX = dx / distance * speed;
      desiredZ = dz / distance * speed;
    }
  }
  const desiredSpeed = Math.hypot(desiredX, desiredZ);
  const speedLimit = player.ai === 2 ? 6.6 : 6.5;
  if (desiredSpeed > speedLimit) {
    desiredX *= speedLimit / desiredSpeed;
    desiredZ *= speedLimit / desiredSpeed;
  }
  const dvx = desiredX - player.vx;
  const dvz = desiredZ - player.vz;
  const change = Math.hypot(dvx, dvz);
  const decelerating = desiredSpeed < Math.hypot(player.vx, player.vz);
  const maxChange = (decelerating ? 60 : 45) * dt;
  const scale = change > maxChange && change > 0 ? maxChange / change : 1;
  player.vx += dvx * scale;
  player.vz += dvz * scale;
  player.x = clamp(player.x + player.vx * dt, bounds.xMin, bounds.xMax);
  player.z = clamp(player.z + player.vz * dt, bounds.zMin, bounds.zMax);
  player.swing = Math.max(0, player.swing - dt);
  player.anim += dt * (1.8 + Math.hypot(player.vx, player.vz) * 1.2);
}

function movePlayers(world: World) {
  for (const player of world.players) movePlayer(world, player);
}

function closestApproachAt(world: World, player: Player) {
  const dx = world.ball.p.x - player.x;
  const dz = world.ball.p.z - player.z;
  const vx = world.ball.v.x - player.vx;
  const vz = world.ball.v.z - player.vz;
  const speedSq = vx * vx + vz * vz;
  return speedSq > 1e-6 ? world.clock - (dx * vx + dz * vz) / speedSq : world.clock;
}

function resolvePending(world: World, events: Event[]) {
  for (const player of world.players) {
    const pending = player.pending;
    if (!pending) continue;
    const receiving = world.ball.inPlay && world.ball.bounces < 2 && world.ball.canHitTeam === player.team
      && (world.phase === 'rally' || (world.phase === 'serve-flight' && world.ball.bounces > 0));
    if (receiving) {
      const dx = world.ball.p.x - player.x;
      const dz = world.ball.p.z - player.z;
      const distance = Math.hypot(dx, dz);
      const reach = player.ai === null ? strikeRadius(world.level)
        : player.ai === 1 ? STRIKE_RADIUS + 0.25
          : STRIKE_RADIUS;
      if (distance <= reach && world.ball.p.y >= 0.15 && world.ball.p.y <= 2.9) {
        const kind = classifyShot(pending.kind, world.ball.p.y, player.z);
        const swing: Swing = {
          kind,
          aim: clamp(player.input.x, -1, 1),
          delta: IDEAL_SWING_LEAD - (closestApproachAt(world, player) - pending.at),
          depth: clamp(player.input.z, -1, 1),
        };
        player.swingLunge = clamp((distance - 1.1) / Math.max(0.1, reach - 1.1), 0, 1);
        player.lungeX = distance > 0 ? dx / distance : 0;
        player.lungeZ = distance > 0 ? dz / distance : 0;
        player.pending = null;
        if (applyShot(world, player, swing, false, events)) world.serveNumber = 1;
        continue;
      }
    }
    if (world.clock - pending.at + 1e-9 >= SWING_BUFFER) {
      player.pending = null;
      player.swing = 0.42;
      player.swingKind = pending.kind;
    }
  }
}

function processCommand(world: World, command: Command, events: Event[]) {
  const player = world.players.find((p) => p.seat === command.seat);
  if (!player || !player.connected) return;
  if (command.move) {
    player.input.x = clamp(command.move.x, -1, 1);
    player.input.z = clamp(command.move.z, -1, 1);
  }
  if (world.phase === 'serve-ready' && command.toss) {
    tossServe(world, player.seat);
    return;
  }
  if (world.phase === 'serve-toss' && command.serve) {
    const delta = world.serveClock - 0.56;
    if (!hitServe(world, player.seat, delta, command.swing?.aim ?? 0, command.swing?.kind ?? 'topspin')) callFault(world, events);
    else events.push({ type: 'hit', seat: player.seat, serve: true, speed: world.serveSpeed, kind: world.ball.shotKind, shot: world.rallyShot });
    return;
  }
  if ((world.phase !== 'rally' && world.phase !== 'serve-flight') || !world.ball.inPlay || !command.swing || player.team !== world.ball.canHitTeam) return;
  if (player.pending) {
    player.pending.kind = command.swing.kind;
    player.pending.aim = command.swing.aim;
  } else {
    player.pending = { kind: command.swing.kind, at: world.clock, aim: command.swing.aim };
  }
}

function updateAutomatic(world: World, events: Event[]) {
  const server = serverOf(world);
  if (world.phase === 'serve-ready' && server?.ai !== null && server?.ai !== undefined) {
    world.serveClock += STEP;
    if (world.serveClock >= 0.82) tossServe(world, server.seat);
    return;
  }
  if (world.phase === 'serve-toss' && server?.ai !== null && server?.ai !== undefined) {
    if (world.serveClock >= 0.56) {
      hitServe(world, server.seat, world.serveClock - 0.56, 0, 'topspin');
      events.push({ type: 'hit', seat: server.seat, serve: true, speed: world.serveSpeed, kind: world.ball.shotKind, shot: world.rallyShot });
    }
    return;
  }
  for (const player of world.players) {
    const command = cpuSwing(world, player);
    if (command?.swing) {
      const hit = applyShot(world, player, command.swing, false, events);
      if (hit) world.serveNumber = 1;
      break;
    }
  }
}

function simulateStep(world: World, commands: readonly Command[], events: Event[]) {
  if (world.phase === 'done') return;
  world.clock += STEP;
  world.callClock = Math.max(0, world.callClock - STEP);
  if (world.phase === 'point') {
    world.pointClock -= STEP;
    if (world.pointClock <= 0 && world.match.winner === null) {
      if (world.match.tiebreak) advanceTiebreakServer(world);
      resetServe(world);
    }
    return;
  }
  if (world.phase === 'serve-toss') world.serveClock += STEP;
  if (world.phase === 'serve-toss') {
    world.ball.p.y = Math.max(BALL_RADIUS, TOSS_START + 5.5 * world.serveClock - 0.5 * GRAVITY * world.serveClock ** 2);
  }
  for (const command of commands) processCommand(world, command, events);
  movePlayers(world);
  if (world.phase === 'serve-ready') {
    const server = serverOf(world);
    if (server) {
      world.ball.p = serveHandPosition(world, server);
      world.ball.prev = { ...world.ball.p };
    }
  }
  if (world.phase === 'serve-flight' || world.phase === 'rally') {
    updateBall(world, events);
    if (world.phase === 'serve-flight' && world.ball.p.z * (serverOf(world)?.team === 0 ? -1 : 1) < 0 && world.ball.p.y < BALL_RADIUS + 0.02) {
      callFault(world, events);
      return;
    }
    if (world.phase === 'rally' && world.ball.bounces === 0
      && world.ball.p.z * (world.ball.canHitTeam === 0 ? -1 : 1) < -COURT_LENGTH / 2 - 0.5) {
      awardPoint(world, 1 - world.ball.hitByTeam, 'out', events);
      return;
    }
  }
  resolvePending(world, events);
  updateAutomatic(world, events);
  if (world.phase === 'serve-toss' && world.serveClock > 1.25 && serverOf(world)?.ai === null) {
    callFault(world, events);
  }
}

export function stepWorld(world: World, commands: readonly Command[] = [], dt = STEP) {
  const events: Event[] = [];
  world.acc += clamp(dt, 0, 0.1);
  let steps = 0;
  while (world.acc + 1e-9 >= STEP && steps < 20) {
    world.ball.prev.x = world.ball.p.x;
    world.ball.prev.y = world.ball.p.y;
    world.ball.prev.z = world.ball.p.z;
    for (const player of world.players) {
      player.prevX = player.x;
      player.prevZ = player.z;
    }
    simulateStep(world, commands, events);
    world.acc -= STEP;
    steps++;
  }
  return events;
}

export function matchIsDone(world: World) {
  return world.match.winner !== null || world.phase === 'done';
}
