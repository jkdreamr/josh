import {
  COURT_HALF_LENGTH,
  CPU_PROFILES,
  cpuReturn,
  createFlight,
  HALF_SMASH_POWER,
  PLAYER_RUN_SPEED,
  RACKET_REACH,
  opposite,
  planShot,
  simulateLanding,
  smashRecoveryMs,
  stepFlight,
  type CpuProfile,
  type Difficulty,
  type Direction,
  type FlightState,
  type ShotType,
  type Side,
} from './badminton.ts';

/** Player physics shared by the app and the CPU-vs-CPU tests. */
export const PLAYER_STEP = 1 / 240;
export const PLAYER_JUMP_VELOCITY = 5.2;
export const PLAYER_GRAVITY = 12.4;
export { RACKET_REACH } from './badminton.ts';
export const PLAYER_ACCELERATION = 28;
export const PLAYER_BRAKING = 34;
export const PLAYER_SWING_COOLDOWN_MS = 110;

export function stepPlayerBody(body: CpuBody, move: number, direction: Direction, recovering: boolean, charging = false) {
  const targetVx = move * PLAYER_RUN_SPEED * (recovering ? 0.5 : charging ? 0.75 : 1);
  const rate = Math.abs(targetVx) > Math.abs(body.vx) ? PLAYER_ACCELERATION : PLAYER_BRAKING;
  body.vx += Math.max(-rate * PLAYER_STEP, Math.min(rate * PLAYER_STEP, targetVx - body.vx));
  if (Math.abs(body.vx) < 0.02 && move === 0) body.vx = 0;
  body.x = clampToHalf(body.x + body.vx * PLAYER_STEP, direction);
  if (body.jumpRequested) {
    body.jumpRequested = false;
    if (body.jump <= 0.001 && body.jumpVelocity <= 0) body.jumpVelocity = PLAYER_JUMP_VELOCITY;
  }
  if (body.jumpVelocity !== 0 || body.jump > 0) {
    body.jumpVelocity -= PLAYER_GRAVITY * PLAYER_STEP;
    body.jump = Math.max(0, body.jump + body.jumpVelocity * PLAYER_STEP);
    if (body.jump === 0 && body.jumpVelocity < 0) body.jumpVelocity = 0;
  }
}

export function olympicContactReady(body: CpuBody, flight: FlightState, direction: Direction, clock = Infinity) {
  if (clock < (body.swingStart ?? -Infinity) + PLAYER_SWING_COOLDOWN_MS) return false;
  const racket = racketPoint(body.x, body.jump, direction);
  const distance = Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y);
  const next = stepFlight(flight, PLAYER_STEP);
  const nextDistance = Math.hypot(next.shuttle.x - racket.x - body.vx * PLAYER_STEP, next.shuttle.y - racket.y - body.jumpVelocity * PLAYER_STEP);
  return distance <= 0.18 || nextDistance >= distance || next.status !== 'flying';
}

export type CpuBody = { x: number; vx: number; jump: number; jumpVelocity: number; jumpRequested: boolean; recoverUntil: number; swingStart?: number };
export type CpuMind = { reactAt: number; target: number | null; predictAt: number; home: number };

export function clampToHalf(x: number, direction: Direction) {
  return direction > 0 ? Math.max(-COURT_HALF_LENGTH - 0.3, Math.min(-0.55, x)) : Math.max(0.55, Math.min(COURT_HALF_LENGTH + 0.3, x));
}

/** Where the racket head meets the shuttle for a player standing at x and jumping this high. */
export function racketPoint(x: number, jump: number, direction: Direction) {
  return { x: x + direction * 0.5, y: 1.2 + jump };
}

/** One 1/240 s step of the computer's footwork: read the flight, run to the predicted landing, jump for high shuttles. */
export function stepCpuBody(
  body: CpuBody,
  mind: CpuMind,
  context: { clock: number; rallying: boolean; flight: FlightState | null; side: Side; direction: Direction; profile: CpuProfile },
) {
  const { clock, flight, side, direction, profile } = context;
  const step = PLAYER_STEP;
  let target: number | null = null;
  if (context.rallying && flight && flight.status === 'flying') {
    if (flight.hitter !== side) {
      if (clock >= mind.reactAt) {
        if (mind.target === null || clock >= mind.predictAt) {
          const prediction = simulateLanding({ x: flight.shuttle.x, y: flight.shuttle.y }, { vx: flight.shuttle.vx, vy: flight.shuttle.vy });
          mind.target = clampToHalf(prediction.x - direction * 0.4, direction);
          if (profile === CPU_PROFILES.olympic || profile.anticipates !== undefined) {
            let preview = flight;
            for (let time = PLAYER_STEP; time < 2; time += PLAYER_STEP) {
              preview = stepFlight(preview, PLAYER_STEP);
              if (preview.status !== 'flying') break;
              const { x, y } = preview.shuttle;
              const intercept = clampToHalf(x - direction * 0.5, direction);
              if (x * direction < 0 && y < 2 && Math.abs(intercept - body.x) < profile.speed * Math.max(0, time - 0.12) + (profile.anticipates ?? 0.15)) {
                mind.target = intercept;
                break;
              }
            }
          }
          mind.predictAt = clock + (profile.predictionMs ?? 120);
        }
        target = mind.target;
        const racketX = body.x + direction * 0.5;
        if (
          flight.shuttle.y > 2.25 &&
          flight.shuttle.vy < 1.5 &&
          Math.abs(flight.shuttle.x - racketX) < 1.4 &&
          body.jump <= 0.001 &&
          body.jumpVelocity <= 0
        ) {
          body.jumpRequested = true;
        }
      }
    } else {
      mind.target = null;
      target = -direction * (profile === CPU_PROFILES.olympic ? 2.4 : profile.home ?? mind.home);
    }
  }
  if (profile === CPU_PROFILES.olympic) {
    const gap = target === null ? 0 : target - body.x;
    stepPlayerBody(body, Math.abs(gap) > 0.08 ? Math.sign(gap) : 0, direction, clock < body.recoverUntil);
    return;
  }
  if (target === null) {
    body.vx *= 0.8;
    if (Math.abs(body.vx) < 0.05) body.vx = 0;
  } else {
    const speed = clock < body.recoverUntil ? profile.speed * 0.5 : profile.speed;
    const gap = target - body.x;
    const desired = Math.abs(gap) > 0.08 ? Math.sign(gap) * Math.min(speed, Math.abs(gap) * 7) : 0;
    const acceleration = profile.acceleration ?? 28;
    body.vx += Math.max(-acceleration * step, Math.min(acceleration * step, desired - body.vx));
  }
  body.x = clampToHalf(body.x + body.vx * step, direction);
  if (body.jumpRequested) {
    body.jumpRequested = false;
    body.jumpVelocity = PLAYER_JUMP_VELOCITY * 0.92;
  }
  if (body.jumpVelocity !== 0 || body.jump > 0) {
    body.jumpVelocity -= PLAYER_GRAVITY * step;
    body.jump = Math.max(0, body.jump + body.jumpVelocity * step);
    if (body.jump === 0 && body.jumpVelocity < 0) body.jumpVelocity = 0;
  }
}

/** Plays one rally between two computers with the app's physics and returns the winner. Used to rank the levels. */
export function simulateCpuRally(
  levels: Record<Side, Difficulty>,
  server: Side,
  random: () => number = Math.random,
): { winner: Side; shots: number } {
  const directions: Record<Side, Direction> = { a: 1, b: -1 };
  const bodies: Record<Side, CpuBody> = {
    a: { x: -2.4, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 },
    b: { x: 2.4, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 },
  };
  const minds: Record<Side, CpuMind> = {
    a: { reactAt: 0, target: null, predictAt: 0, home: 3.1 },
    b: { reactAt: 0, target: null, predictAt: 0, home: 3.1 },
  };
  const serveStart = { x: bodies[server].x + directions[server] * 0.45, y: 1.05 };
  const serve = planShot(random() < 0.5 ? 'serve' : 'high-serve', directions[server], serveStart, random, CPU_PROFILES[levels[server]].accuracy);
  if (serve.fault) return { winner: opposite(server), shots: 0 };
  let flight = createFlight(serveStart, serve.velocity, server, directions[server], true);
  let incoming: ShotType | null = serve.type;
  let incomingPower = HALF_SMASH_POWER;
  let missed = false;
  let shots = 1;
  let clock = 0;
  minds[opposite(server)].reactAt = CPU_PROFILES[levels[opposite(server)]].reactionMs;
  while (clock < 120_000) {
    clock += PLAYER_STEP * 1000;
    for (const side of ['a', 'b'] as Side[]) {
      stepCpuBody(bodies[side], minds[side], { clock, rallying: true, flight, side, direction: directions[side], profile: CPU_PROFILES[levels[side]] });
    }
    flight = stepFlight(flight, PLAYER_STEP);
    if (flight.status !== 'flying') return { winner: flight.status === 'landed' ? flight.hitter : opposite(flight.hitter), shots };
    const side = opposite(flight.hitter);
    const direction = directions[side];
    const shuttle = flight.shuttle;
    if (shuttle.x * direction > 0.12 || clock < minds[side].reactAt || missed) continue;
    const racket = racketPoint(bodies[side].x, bodies[side].jump, direction);
    if (Math.hypot(shuttle.x - racket.x, shuttle.y - racket.y) > RACKET_REACH) continue;
    const contact = { x: shuttle.x, y: shuttle.y };
    if (levels[side] === 'olympic' && !olympicContactReady(bodies[side], flight, direction, clock)) continue;
    const reply = cpuReturn(contact, incoming, flight.elapsed, Math.abs(bodies[flight.hitter].x), levels[side], random, incomingPower, Math.hypot(shuttle.x - racket.x, shuttle.y - racket.y));
    if (reply.kind === 'miss') {
      missed = true;
      continue;
    }
    const plan = planShot(reply.type, direction, contact, random, reply.accuracy, reply.options);
    if (levels[side] === 'olympic') bodies[side].swingStart = clock;
    if (plan.type === 'smash') bodies[side].recoverUntil = clock + smashRecoveryMs(reply.options.power ?? HALF_SMASH_POWER);
    flight = createFlight(contact, plan.velocity, side, direction);
    incoming = plan.type;
    incomingPower = reply.options.power ?? HALF_SMASH_POWER;
    missed = false;
    shots += 1;
    minds[opposite(side)].reactAt = clock + CPU_PROFILES[levels[opposite(side)]].reactionMs;
  }
  return { winner: server, shots };
}
