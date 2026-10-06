export const COURT_HALF_LENGTH = 6.7;
export const NET_HEIGHT = 1.524;
export const SHORT_SERVICE_LINE = 1.98;
export const GRAVITY = 9.81;
export const TERMINAL_SPEED = 6.8;
export const FIXED_STEP = 1 / 240;
export const SERVE_MAX_HEIGHT = 1.15;

export type Side = 'player' | 'cpu';
export type Point2D = { x: number; y: number };
export type ShotType = 'clear' | 'drop' | 'drive' | 'smash' | 'net' | 'serve';
export type FlightStatus = 'flying' | 'landed' | 'fault';
export type FlightFault = 'net' | 'out' | 'own-side' | 'short-service';
export type MatchFormat = 'bwf' | 'casual';
export type ServiceCourt = 'right' | 'left';

export type Shuttle = Point2D & { vx: number; vy: number };

export type FlightState = {
  shuttle: Shuttle;
  hitter: Side;
  isServe: boolean;
  status: FlightStatus;
  fault: FlightFault | null;
  accumulator: number;
  elapsed: number;
  maxSpeed: number;
};

export type ShotPlan = {
  type: ShotType;
  targetX: number;
  velocity: { vx: number; vy: number };
  fault?: 'serve-height' | 'short-serve' | 'long-serve';
};

export type MatchState = {
  format: MatchFormat;
  target: 11 | 21;
  cap: 15 | 30;
  bestOf: 1 | 3;
  game: 1 | 2 | 3;
  points: { player: number; cpu: number };
  games: { player: number; cpu: number };
  server: Side;
  intervalAt11: boolean;
  endsSwitched: boolean;
  matchWinner: Side | null;
};

export function shuttleAcceleration(vx: number, vy: number): Point2D {
  const speed = Math.hypot(vx, vy);
  const drag = GRAVITY / (TERMINAL_SPEED * TERMINAL_SPEED) * speed;
  return { x: -drag * vx, y: -GRAVITY - drag * vy };
}

export function terminalSpeedAfter(seconds = 5, initial: Point2D = { x: 0, y: 0 }): number {
  let { x: vx, y: vy } = initial;
  const steps = Math.ceil(seconds / FIXED_STEP);
  for (let step = 0; step < steps; step += 1) {
    const acceleration = shuttleAcceleration(vx, vy);
    vx += acceleration.x * FIXED_STEP;
    vy += acceleration.y * FIXED_STEP;
  }
  return Math.hypot(vx, vy);
}

export function simulateLanding(start: Point2D, velocity: { vx: number; vy: number }, maxSeconds = 8): Point2D & { time: number } {
  let x = start.x;
  let y = start.y;
  let vx = velocity.vx;
  let vy = velocity.vy;
  let time = 0;
  const maxSteps = Math.ceil(maxSeconds / FIXED_STEP);
  for (let step = 0; step < maxSteps; step += 1) {
    const previousX = x;
    const previousY = y;
    const acceleration = shuttleAcceleration(vx, vy);
    vx += acceleration.x * FIXED_STEP;
    vy += acceleration.y * FIXED_STEP;
    x += vx * FIXED_STEP;
    y += vy * FIXED_STEP;
    time += FIXED_STEP;
    if (y <= 0) {
      const fraction = previousY > 0 ? previousY / (previousY - y) : 0;
      return { x: previousX + (x - previousX) * fraction, y: 0, time: time - FIXED_STEP + FIXED_STEP * fraction };
    }
  }
  return { x, y, time };
}

export function solveLaunchVelocity(start: Point2D, target: Point2D, angleDegrees = 42): { vx: number; vy: number } {
  const direction = Math.sign(target.x - start.x) || 1;
  const distance = Math.abs(target.x - start.x);
  const angle = angleDegrees * Math.PI / 180;
  let low = 0.1;
  let high = 80;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const speed = (low + high) / 2;
    const landing = simulateLanding(start, {
      vx: direction * speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    });
    const range = direction * (landing.x - start.x);
    if (range < distance) low = speed;
    else high = speed;
  }
  const speed = (low + high) / 2;
  return { vx: direction * speed * Math.cos(angle), vy: speed * Math.sin(angle) };
}

export function netCrossingHeight(from: Point2D, to: Point2D): number | null {
  const crosses = (from.x < 0 && to.x >= 0) || (from.x > 0 && to.x <= 0);
  if (!crosses || from.x === to.x) return null;
  const amount = -from.x / (to.x - from.x);
  return from.y + (to.y - from.y) * amount;
}

export function isNetFault(from: Point2D, to: Point2D): boolean {
  const height = netCrossingHeight(from, to);
  return height !== null && height < NET_HEIGHT;
}

export function landingFault(side: Side, landing: Point2D): FlightFault | null {
  if (Math.abs(landing.x) > COURT_HALF_LENGTH) return 'out';
  const ownSideSign = side === 'player' ? -1 : 1;
  if (landing.x * ownSideSign > 0) return 'own-side';
  return null;
}

export function serveFault(contactHeight: number, targetX: number, server: Side): ShotPlan['fault'] | undefined {
  if (contactHeight > SERVE_MAX_HEIGHT) return 'serve-height';
  const direction = server === 'player' ? 1 : -1;
  const distance = targetX * direction;
  if (distance < SHORT_SERVICE_LINE) return 'short-serve';
  if (distance > COURT_HALF_LENGTH) return 'long-serve';
  return undefined;
}

export function planShot(type: ShotType, side: Side, start: Point2D, random: () => number = Math.random): ShotPlan {
  const direction = side === 'player' ? 1 : -1;
  const error = (random() - 0.5) * 0.1;
  let targetX = direction * (COURT_HALF_LENGTH - 0.55);
  let angle = 42;
  let actualType = type;
  if (type === 'smash' && start.y < 2.4) actualType = 'clear';
  if (actualType === 'drop') {
    targetX = direction * (0.2 + random() * 0.2);
    angle = 24;
  } else if (actualType === 'net') {
    targetX = direction * (0.2 + random() * 0.2);
    angle = 38;
  } else if (actualType === 'drive') {
    targetX = direction * (3.1 + random() * 0.8);
    angle = 10;
  } else if (actualType === 'serve') {
    targetX = direction * (SHORT_SERVICE_LINE + 2.5 + random() * 1.2);
    angle = 29;
  } else if (actualType === 'clear') {
    targetX = direction * (COURT_HALF_LENGTH - (0.35 + random() * 0.4));
    angle = 42;
  }
  targetX += direction * error;

  if (actualType === 'smash') {
    // Pros exceed 100 m/s; 45–60 m/s keeps this playable.
    const speed = 45 + random() * 15;
    const angleDown = 25 * Math.PI / 180;
    return {
      type: actualType,
      targetX,
      velocity: { vx: direction * speed * Math.cos(angleDown), vy: -speed * Math.sin(angleDown) },
    };
  }

  const velocity = solveLaunchVelocity(start, { x: targetX, y: 0 }, angle);
  const fault = actualType === 'serve' ? serveFault(start.y, targetX, side) : undefined;
  return { type: actualType, targetX, velocity, ...(fault ? { fault } : {}) };
}

export function createFlight(start: Point2D, velocity: { vx: number; vy: number }, hitter: Side, isServe = false): FlightState {
  return {
    shuttle: { ...start, ...velocity },
    hitter,
    isServe,
    status: 'flying',
    fault: null,
    accumulator: 0,
    elapsed: 0,
    maxSpeed: Math.hypot(velocity.vx, velocity.vy),
  };
}

export function stepFlight(state: FlightState, deltaSeconds: number): FlightState {
  if (state.status !== 'flying') return state;
  let current: FlightState = { ...state, accumulator: state.accumulator + Math.max(0, Math.min(deltaSeconds, 0.25)) };
  while (current.accumulator >= FIXED_STEP && current.status === 'flying') {
    const previous = current.shuttle;
    const acceleration = shuttleAcceleration(previous.vx, previous.vy);
    const vx = previous.vx + acceleration.x * FIXED_STEP;
    const vy = previous.vy + acceleration.y * FIXED_STEP;
    const next: Shuttle = {
      x: previous.x + vx * FIXED_STEP,
      y: previous.y + vy * FIXED_STEP,
      vx,
      vy,
    };
    current = {
      ...current,
      shuttle: next,
      accumulator: current.accumulator - FIXED_STEP,
      elapsed: current.elapsed + FIXED_STEP,
      maxSpeed: Math.max(current.maxSpeed, Math.hypot(vx, vy)),
    };
    if (isNetFault(previous, next)) return { ...current, status: 'fault', fault: 'net' };
    if (next.y <= 0) {
      const fraction = previous.y > 0 ? previous.y / (previous.y - next.y) : 0;
      const landing = {
        x: previous.x + (next.x - previous.x) * fraction,
        y: 0,
      };
      const fault = landingFault(current.hitter, landing)
        ?? (current.isServe && Math.abs(landing.x) < SHORT_SERVICE_LINE ? 'short-service' : null);
      return { ...current, shuttle: { ...next, ...landing }, status: fault ? 'fault' : 'landed', fault };
    }
  }
  return current;
}

export function newMatch(format: MatchFormat = 'casual'): MatchState {
  return {
    format,
    target: format === 'bwf' ? 21 : 11,
    cap: format === 'bwf' ? 30 : 15,
    bestOf: format === 'bwf' ? 3 : 1,
    game: 1,
    points: { player: 0, cpu: 0 },
    games: { player: 0, cpu: 0 },
    server: 'player',
    intervalAt11: false,
    endsSwitched: false,
    matchWinner: null,
  };
}

export function serviceCourt(state: MatchState): ServiceCourt {
  return state.points[state.server] % 2 === 0 ? 'right' : 'left';
}

export function awardPoint(state: MatchState, winner: Side): MatchState {
  if (state.matchWinner) return state;
  const points = { ...state.points, [winner]: state.points[winner] + 1 };
  const high = Math.max(points.player, points.cpu);
  const low = Math.min(points.player, points.cpu);
  const intervalAt11 = state.intervalAt11 || (state.format === 'bwf' && high === 11);
  const wonGame = (high >= state.target && high - low >= 2) || high >= state.cap;
  if (!wonGame) return { ...state, points, server: winner, intervalAt11 };

  const games = { ...state.games, [winner]: state.games[winner] + 1 };
  if (games[winner] >= Math.ceil(state.bestOf / 2)) {
    return { ...state, points, games, server: winner, intervalAt11, matchWinner: winner };
  }
  return {
    ...state,
    game: Math.min(3, state.game + 1) as MatchState['game'],
    points: { player: 0, cpu: 0 },
    games,
    server: winner,
    intervalAt11: false,
    endsSwitched: !state.endsSwitched,
  };
}
