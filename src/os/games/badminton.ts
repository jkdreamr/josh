export const COURT_HALF_LENGTH = 6.7;
export const NET_HEIGHT = 1.524;
export const SHORT_SERVICE_LINE = 1.98;
export const GRAVITY = 9.81;
export const TERMINAL_SPEED = 6.8;
export const FIXED_STEP = 1 / 240;
export const SERVE_MAX_HEIGHT = 1.15;
export const SMASH_MIN_HEIGHT = 2;
export const OVERHEAD_HEIGHT = 1.75;
export const LOW_HEIGHT = 1;

/** The two competitors. Side a starts on the left end and is always the first human. */
export type Side = 'a' | 'b';
export type End = 'left' | 'right';
export type Direction = 1 | -1;
export type Point2D = { x: number; y: number };
export type ShotType = 'clear' | 'drop' | 'smash' | 'drive' | 'net' | 'lift' | 'serve' | 'high-serve';
export type Intent = 'normal' | 'power' | 'soft';
export type FlightStatus = 'flying' | 'landed' | 'fault';
export type FlightFault = 'net' | 'out' | 'own-side' | 'short-service';
export type MatchLength = 'quick' | 'game' | 'match';
export type ServiceCourt = 'right' | 'left';
export type Difficulty = 'easy' | 'normal' | 'hard';

export type Shuttle = Point2D & { vx: number; vy: number };

export type FlightState = {
  shuttle: Shuttle;
  hitter: Side;
  direction: Direction;
  isServe: boolean;
  status: FlightStatus;
  fault: FlightFault | null;
  accumulator: number;
  elapsed: number;
  maxSpeed: number;
  /** nose direction in radians; lags the velocity so the shuttle tumbles after every hit */
  heading: number;
};

export type ShotPlan = {
  type: ShotType;
  targetX: number;
  velocity: { vx: number; vy: number };
  fault?: 'serve-height' | 'short-serve' | 'long-serve';
};

export type MatchState = {
  length: MatchLength;
  target: 11 | 21;
  cap: 15 | 30;
  bestOf: 1 | 3;
  game: 1 | 2 | 3;
  points: Record<Side, number>;
  games: Record<Side, number>;
  server: Side;
  /** set when the leading score reaches 11 in a game to 21, cleared by takeInterval */
  intervalDue: boolean;
  intervalTaken: boolean;
  endsSwitched: boolean;
  /** winner of the game that just finished, waiting for startNextGame */
  gameWinner: Side | null;
  matchWinner: Side | null;
  history: Array<Record<Side, number>>;
};

export type PointSituation = { side: Side; kind: 'game' | 'match' };

export type SideStats = { points: number; winners: number; errors: number; smashes: number; fastestSmash: number };
export type MatchStats = { a: SideStats; b: SideStats; longestRally: number; rallies: number; longestRallySeconds: number };
export type RallyCause = 'in' | FlightFault | 'serve-fault';
export type RallyOutcome = { winner: Side; cause: RallyCause; shots: number; seconds: number };

export type CpuProfile = { label: string; reactionMs: number; speed: number; accuracy: number; dropChance: number };

export const CPU_PROFILES: Record<Difficulty, CpuProfile> = {
  easy: { label: 'Easy', reactionMs: 260, speed: 3, accuracy: 0.72, dropChance: 0.15 },
  normal: { label: 'Normal', reactionMs: 170, speed: 4.1, accuracy: 0.88, dropChance: 0.3 },
  hard: { label: 'Hard', reactionMs: 110, speed: 5, accuracy: 1, dropChance: 0.42 },
};

export function opposite(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

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

/** Height of the shuttle when it passes over the net, or null if the flight never crosses it. */
export function simulateNetClearance(start: Point2D, velocity: { vx: number; vy: number }, maxSeconds = 8): number | null {
  let x = start.x;
  let y = start.y;
  let vx = velocity.vx;
  let vy = velocity.vy;
  const maxSteps = Math.ceil(maxSeconds / FIXED_STEP);
  for (let step = 0; step < maxSteps; step += 1) {
    const previous = { x, y };
    const acceleration = shuttleAcceleration(vx, vy);
    vx += acceleration.x * FIXED_STEP;
    vy += acceleration.y * FIXED_STEP;
    x += vx * FIXED_STEP;
    y += vy * FIXED_STEP;
    const crossing = netCrossingHeight(previous, { x, y });
    if (crossing !== null) return crossing;
    if (y <= 0) return null;
  }
  return null;
}

export function solveLaunchVelocity(start: Point2D, target: Point2D, angleDegrees = 42): { vx: number; vy: number } {
  const direction = Math.sign(target.x - start.x) || 1;
  const distance = Math.abs(target.x - start.x);
  const angle = angleDegrees * Math.PI / 180;
  let low = 0.1;
  let high = 90;
  for (let iteration = 0; iteration < 30; iteration += 1) {
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

/**
 * Solves an arc to the target and, if it would clip the net, lifts the launch angle
 * until the shuttle clears the tape by a small margin.
 */
export function solveClearingArc(start: Point2D, targetX: number, angleDegrees: number, margin = 0.08): { vx: number; vy: number } {
  let angle = angleDegrees;
  let velocity = solveLaunchVelocity(start, { x: targetX, y: 0 }, angle);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const clearance = simulateNetClearance(start, velocity);
    if (clearance === null || clearance >= NET_HEIGHT + margin) break;
    angle = Math.min(78, angle + 4);
    velocity = solveLaunchVelocity(start, { x: targetX, y: 0 }, angle);
  }
  return velocity;
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

export function landingFault(direction: Direction, landing: Point2D): FlightFault | null {
  if (Math.abs(landing.x) > COURT_HALF_LENGTH) return 'out';
  if (landing.x * direction < 0) return 'own-side';
  return null;
}

export function serveFault(contactHeight: number, targetX: number, direction: Direction): ShotPlan['fault'] | undefined {
  if (contactHeight > SERVE_MAX_HEIGHT) return 'serve-height';
  const distance = targetX * direction;
  if (distance < SHORT_SERVICE_LINE) return 'short-serve';
  if (distance > COURT_HALF_LENGTH) return 'long-serve';
  return undefined;
}

/** Picks the stroke a player would naturally play from this contact point with this intent. */
export function chooseShot(intent: Intent, contact: Point2D): ShotType {
  const fromNet = Math.abs(contact.x);
  if (contact.y >= OVERHEAD_HEIGHT) {
    if (intent === 'power') return contact.y >= SMASH_MIN_HEIGHT ? 'smash' : 'drive';
    if (intent === 'soft') return 'drop';
    return 'clear';
  }
  if (contact.y >= LOW_HEIGHT) {
    if (intent === 'power') return 'drive';
    if (intent === 'soft') return fromNet > 2.2 ? 'drop' : 'net';
    return fromNet > 2.4 ? 'drive' : 'net';
  }
  if (intent === 'power') return 'lift';
  if (intent === 'soft') return 'net';
  return fromNet > 2.2 ? 'lift' : 'net';
}

/**
 * Plans a stroke from the contact point. accuracy (0..1) widens the landing scatter,
 * so late or stretched contacts drift long or into the net.
 */
export function planShot(type: ShotType, direction: Direction, start: Point2D, random: () => number = Math.random, accuracy = 1): ShotPlan {
  const spread = 1 + (1 - Math.max(0, Math.min(1, accuracy))) * 3.2;
  const scatter = (amount: number) => (random() - 0.5) * 2 * amount * spread;
  let actualType = type;
  if (type === 'smash' && start.y < SMASH_MIN_HEIGHT) actualType = 'drive';
  if (type === 'drop' && start.y < LOW_HEIGHT) actualType = 'net';

  if (actualType === 'smash') {
    // Pros exceed 100 m/s; 42 to 58 m/s keeps this playable.
    const speed = 42 + random() * 16;
    let targetX = direction * (2.4 + random() * 2.4 + scatter(0.4));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const dx = targetX - start.x;
      const dy = -start.y;
      const length = Math.hypot(dx, dy) || 1;
      const velocity = { vx: dx / length * speed, vy: dy / length * speed };
      const clearance = simulateNetClearance(start, velocity);
      if (clearance === null || clearance >= NET_HEIGHT + 0.06 || Math.abs(targetX) >= COURT_HALF_LENGTH + 0.3) {
        return { type: 'smash', targetX, velocity };
      }
      targetX += direction * 0.7;
    }
    actualType = 'drive';
  }

  let targetX: number;
  let angle: number;
  switch (actualType) {
    case 'drop':
      targetX = direction * (0.9 + random() * 0.8 + scatter(0.25));
      angle = Math.abs(start.x) > 3.5 ? 22 : 12;
      break;
    case 'net':
      targetX = direction * (0.4 + random() * 0.5 + scatter(0.2));
      angle = 50;
      break;
    case 'drive':
      targetX = direction * (3.6 + random() * 1.9 + scatter(0.35));
      angle = 7;
      break;
    case 'lift':
      targetX = direction * (COURT_HALF_LENGTH - (0.5 + random() * 0.7) + scatter(0.3));
      angle = 58;
      break;
    case 'serve':
      targetX = direction * (SHORT_SERVICE_LINE + 0.25 + random() * 0.55 + scatter(0.12));
      angle = 20;
      break;
    case 'high-serve':
      targetX = direction * (COURT_HALF_LENGTH - (0.45 + random() * 0.6) + scatter(0.25));
      angle = 62;
      break;
    case 'clear':
    default:
      actualType = 'clear';
      targetX = direction * (COURT_HALF_LENGTH - (0.4 + random() * 0.6) + scatter(0.28));
      angle = Math.abs(start.x) > 4.5 ? 46 : 40;
      break;
  }

  const velocity = solveClearingArc(start, targetX, angle);
  const isServe = actualType === 'serve' || actualType === 'high-serve';
  const fault = isServe ? serveFault(start.y, targetX, direction) : undefined;
  return { type: actualType, targetX, velocity, ...(fault ? { fault } : {}) };
}

/** Eases the shuttle nose toward its velocity: fast shots snap round, slow ones tumble visibly. */
export function tumbleHeading(heading: number, vx: number, vy: number, dt: number): number {
  const target = Math.atan2(vy, vx);
  let delta = target - heading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const rate = 7 + Math.hypot(vx, vy) * 0.45;
  const maxStep = rate * dt;
  return heading + Math.max(-maxStep, Math.min(maxStep, delta));
}

export function createFlight(start: Point2D, velocity: { vx: number; vy: number }, hitter: Side, direction: Direction, isServe = false, heading?: number): FlightState {
  return {
    shuttle: { ...start, ...velocity },
    hitter,
    direction,
    isServe,
    status: 'flying',
    fault: null,
    accumulator: 0,
    elapsed: 0,
    maxSpeed: Math.hypot(velocity.vx, velocity.vy),
    heading: heading ?? Math.atan2(velocity.vy, velocity.vx),
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
      heading: tumbleHeading(current.heading, vx, vy, FIXED_STEP),
    };
    if (isNetFault(previous, next)) {
      return { ...current, shuttle: { ...next, x: previous.x < 0 ? -0.02 : 0.02, vx: 0, vy: Math.min(0, vy) }, status: 'fault', fault: 'net' };
    }
    if (next.y <= 0) {
      const fraction = previous.y > 0 ? previous.y / (previous.y - next.y) : 0;
      const landing = {
        x: previous.x + (next.x - previous.x) * fraction,
        y: 0,
      };
      const fault = landingFault(current.direction, landing)
        ?? (current.isServe && Math.abs(landing.x) < SHORT_SERVICE_LINE ? 'short-service' : null);
      return { ...current, shuttle: { ...next, ...landing }, status: fault ? 'fault' : 'landed', fault };
    }
  }
  return current;
}

export function newMatch(length: MatchLength = 'game'): MatchState {
  return {
    length,
    target: length === 'quick' ? 11 : 21,
    cap: length === 'quick' ? 15 : 30,
    bestOf: length === 'match' ? 3 : 1,
    game: 1,
    points: { a: 0, b: 0 },
    games: { a: 0, b: 0 },
    server: 'a',
    intervalDue: false,
    intervalTaken: false,
    endsSwitched: false,
    gameWinner: null,
    matchWinner: null,
    history: [],
  };
}

export function endOf(side: Side, state: Pick<MatchState, 'endsSwitched'>): End {
  const left = side === 'a' ? !state.endsSwitched : state.endsSwitched;
  return left ? 'left' : 'right';
}

export function directionOf(side: Side, state: Pick<MatchState, 'endsSwitched'>): Direction {
  return endOf(side, state) === 'left' ? 1 : -1;
}

export function sideAt(end: End, state: Pick<MatchState, 'endsSwitched'>): Side {
  return endOf('a', state) === end ? 'a' : 'b';
}

export function serviceCourt(state: MatchState): ServiceCourt {
  return state.points[state.server] % 2 === 0 ? 'right' : 'left';
}

export function gamesToWin(state: Pick<MatchState, 'bestOf'>): number {
  return Math.ceil(state.bestOf / 2);
}

export function isDecidingGame(state: MatchState): boolean {
  return state.bestOf > 1 && state.game === state.bestOf;
}

/** Who is one point from taking the game or the match. Both sides can be listed at 29-all. */
export function pointSituation(state: MatchState): PointSituation[] {
  if (state.matchWinner || state.gameWinner) return [];
  const result: PointSituation[] = [];
  for (const side of ['a', 'b'] as const) {
    const mine = state.points[side];
    const theirs = state.points[opposite(side)];
    const wins = (mine >= state.target - 1 && mine - theirs >= 1) || mine === state.cap - 1;
    if (!wins) continue;
    result.push({ side, kind: state.games[side] + 1 >= gamesToWin(state) ? 'match' : 'game' });
  }
  return result;
}

export function awardPoint(state: MatchState, winner: Side): MatchState {
  if (state.matchWinner || state.gameWinner) return state;
  const points = { ...state.points, [winner]: state.points[winner] + 1 };
  const high = Math.max(points.a, points.b);
  const low = Math.min(points.a, points.b);
  const intervalDue = !state.intervalTaken && state.target === 21 && high === 11;
  const wonGame = (high >= state.target && high - low >= 2) || high >= state.cap;
  if (!wonGame) return { ...state, points, server: winner, intervalDue };

  const games = { ...state.games, [winner]: state.games[winner] + 1 };
  const history = [...state.history, points];
  if (games[winner] >= gamesToWin(state)) {
    return { ...state, points, games, history, server: winner, intervalDue: false, gameWinner: winner, matchWinner: winner };
  }
  return { ...state, points, games, history, server: winner, intervalDue: false, gameWinner: winner };
}

/** The mid-game interval at 11. In a deciding game the players also change ends here. */
export function takeInterval(state: MatchState): MatchState {
  if (!state.intervalDue) return state;
  return {
    ...state,
    intervalDue: false,
    intervalTaken: true,
    endsSwitched: isDecidingGame(state) ? !state.endsSwitched : state.endsSwitched,
  };
}

export function startNextGame(state: MatchState): MatchState {
  if (!state.gameWinner || state.matchWinner) return state;
  return {
    ...state,
    game: Math.min(3, state.game + 1) as MatchState['game'],
    points: { a: 0, b: 0 },
    server: state.gameWinner,
    intervalDue: false,
    intervalTaken: false,
    endsSwitched: !state.endsSwitched,
    gameWinner: null,
  };
}

export function newStats(): MatchStats {
  const side = (): SideStats => ({ points: 0, winners: 0, errors: 0, smashes: 0, fastestSmash: 0 });
  return { a: side(), b: side(), longestRally: 0, rallies: 0, longestRallySeconds: 0 };
}

export function recordSmash(stats: MatchStats, side: Side, speedMetersPerSecond: number): MatchStats {
  const current = stats[side];
  return { ...stats, [side]: { ...current, smashes: current.smashes + 1, fastestSmash: Math.max(current.fastestSmash, speedMetersPerSecond) } };
}

export function recordRally(stats: MatchStats, outcome: RallyOutcome): MatchStats {
  const loser = opposite(outcome.winner);
  const winnerStats = { ...stats[outcome.winner], points: stats[outcome.winner].points + 1 };
  const loserStats = { ...stats[loser] };
  if (outcome.cause === 'in') winnerStats.winners += 1;
  else loserStats.errors += 1;
  return {
    ...stats,
    [outcome.winner]: winnerStats,
    [loser]: loserStats,
    rallies: stats.rallies + 1,
    longestRally: Math.max(stats.longestRally, outcome.shots),
    longestRallySeconds: Math.max(stats.longestRallySeconds, outcome.seconds),
  };
}

export function faultLabel(cause: RallyCause): string {
  switch (cause) {
    case 'in': return 'In';
    case 'net': return 'Net';
    case 'out': return 'Out';
    case 'own-side': return 'Fell Short';
    case 'short-service': return 'Short Serve';
    case 'serve-fault': return 'Service Fault';
    default: return 'Fault';
  }
}

export function shotLabel(type: ShotType): string {
  switch (type) {
    case 'high-serve': return 'High Serve';
    case 'net': return 'Net Shot';
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

/** The computer's stroke choice. Mirrors a sensible club player: smash anything high, play the net when low and close. */
export function cpuChooseShot(contact: Point2D, opponentDistanceFromNet: number, profile: CpuProfile, random: () => number = Math.random): ShotType {
  const fromNet = Math.abs(contact.x);
  if (contact.y >= 2.4) return 'smash';
  if (contact.y >= OVERHEAD_HEIGHT) {
    if (opponentDistanceFromNet > 4.2 && random() < profile.dropChance) return 'drop';
    return 'clear';
  }
  if (contact.y < 0.95) return fromNet < 2.2 ? 'net' : 'lift';
  if (fromNet > 4.8) return 'clear';
  if (fromNet < 1.6) return 'net';
  return 'drive';
}

/** How precisely a stroke lands, from how far the shuttle was from the racket's sweet spot. */
export function contactAccuracy(distance: number, reach: number): number {
  const ratio = Math.max(0, Math.min(1, distance / reach));
  return 1 - ratio * ratio * 0.9;
}
