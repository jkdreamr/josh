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
  smashPressure,
  smashRecoveryMs,
  stepFlight,
  type CpuProfile,
  type CpuReturn,
  type Difficulty,
  type Direction,
  type FlightState,
  type ShotType,
  type Side,
} from './badminton.ts';
import { agentDecide, agentHome, lastChanceToHit, newAgentRally, newBrain, observeOpponent, planForIncoming, recordRallyEnd, recordReply, startWatch, type AgentBrain, type AgentRally } from './badminton-agent.ts';

/** Player physics shared by the app and the CPU-vs-CPU tests. */
export const PLAYER_STEP = 1 / 240;
export const PLAYER_JUMP_VELOCITY = 5.2;
export const PLAYER_GRAVITY = 12.4;
export { RACKET_REACH } from './badminton.ts';
export const PLAYER_ACCELERATION = 28;
export const PLAYER_BRAKING = 34;
export const PLAYER_SWING_COOLDOWN_MS = 110;
/** A hold shorter than this is a tap, for the player and the Agent alike. */
export const CHARGE_MIN_MS = 150;

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
  context: { clock: number; rallying: boolean; flight: FlightState | null; side: Side; direction: Direction; profile: CpuProfile; charging?: boolean },
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
          if (profile.humanBody || profile.anticipates !== undefined) {
            let preview = flight;
            for (let time = PLAYER_STEP; time < 2; time += PLAYER_STEP) {
              preview = stepFlight(preview, PLAYER_STEP);
              if (preview.status !== 'flying') break;
              const { x, y } = preview.shuttle;
              const intercept = clampToHalf(x - direction * 0.5, direction);
              if (x * direction < 0 && y < (profile.interceptHeight ?? 2) && Math.abs(intercept - body.x) < profile.speed * Math.max(0, time - 0.12) + (profile.anticipates ?? 0.15)) {
                mind.target = intercept;
                break;
              }
            }
          }
          mind.predictAt = clock + (profile.predictionMs ?? 120);
        }
        target = mind.target;
        const racketX = body.x + direction * 0.5;
        const { y: shuttleY, vy } = flight.shuttle;
        // A jump peaks about 0.35 s after take-off, so meeting the shuttle high means leaving the floor that long before it arrives.
        const timedJump = profile.interceptHeight !== undefined
          && vy < 0 && shuttleY > 2.2 && shuttleY - profile.interceptHeight <= -vy * 0.35 && Math.abs(flight.shuttle.x - racketX) < 1;
        if (profile.interceptHeight !== undefined ? timedJump && body.jump <= 0.001 && body.jumpVelocity <= 0 : (
          flight.shuttle.y > 2.25 &&
          flight.shuttle.vy < 1.5 &&
          Math.abs(flight.shuttle.x - racketX) < 1.4 &&
          body.jump <= 0.001 &&
          body.jumpVelocity <= 0
        )) {
          body.jumpRequested = true;
        }
      }
    } else {
      mind.target = null;
      target = -direction * (profile.home ?? mind.home);
    }
  }
  if (profile.humanBody) {
    const gap = target === null ? 0 : target - body.x;
    stepPlayerBody(body, Math.abs(gap) > 0.08 ? Math.sign(gap) : 0, direction, clock < body.recoverUntil, context.charging);
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

/**
 * Plays one rally between two computers with the app's physics and returns the winner. Used to rank the levels.
 * An Agent side learns into its brain from brains, or into a fresh one that is thrown away after the rally.
 */
export function simulateCpuRally(
  levels: Record<Side, Difficulty>,
  server: Side,
  random: () => number = Math.random,
  brains: Partial<Record<Side, AgentBrain>> = {},
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
  const agents: Partial<Record<Side, { brain: AgentBrain; rally: AgentRally; chargeStart: number | null }>> = {};
  for (const side of ['a', 'b'] as Side[]) {
    if (CPU_PROFILES[levels[side]].learns) agents[side] = { brain: brains[side] ?? newBrain(), rally: newAgentRally(), chargeStart: null };
  }
  const finish = (winner: Side, shots: number) => {
    for (const side of ['a', 'b'] as Side[]) {
      const agent = agents[side];
      if (agent) recordRallyEnd(agent.brain, agent.rally, winner === side);
    }
    return { winner, shots };
  };
  /** The other side just played this shot: an Agent remembers the reply and decides whether to wind up a smash. */
  const answered = (hitter: Side, type: ShotType, landingX: number, flight: FlightState, clock: number) => {
    const agent = agents[opposite(hitter)];
    if (!agent) return;
    recordReply(agent.brain, agent.rally, type, Math.abs(landingX));
    planForIncoming(agent.brain, agent.rally, flight, type, clock, clock + CPU_PROFILES[levels[opposite(hitter)]].reactionMs, random);
  };
  const serveStart = { x: bodies[server].x + directions[server] * 0.45, y: 1.05 };
  const serve = planShot(random() < 0.5 ? 'serve' : 'high-serve', directions[server], serveStart, random, CPU_PROFILES[levels[server]].accuracy);
  let incoming: ShotType | null = serve.type;
  if (serve.fault) return finish(opposite(server), 0);
  let flight = createFlight(serveStart, serve.velocity, server, directions[server], true);
  if (agents[server]) agents[server]!.rally.lastAgentShot = serve.type;
  answered(server, serve.type, serve.targetX, flight, 0);
  let incomingPower = HALF_SMASH_POWER;
  let missed = false;
  let shots = 1;
  let clock = 0;
  minds[opposite(server)].reactAt = CPU_PROFILES[levels[opposite(server)]].reactionMs;
  while (clock < 120_000) {
    clock += PLAYER_STEP * 1000;
    for (const side of ['a', 'b'] as Side[]) {
      const agent = agents[side];
      if (agent && agent.rally.plan && !agent.rally.plan.used && agent.chargeStart === null && flight.hitter !== side && clock >= agent.rally.plan.chargeAt) agent.chargeStart = clock;
      const charging = agent !== undefined && agent.chargeStart !== null && clock - agent.chargeStart > CHARGE_MIN_MS;
      if (agent && flight.hitter === side) observeOpponent(agent.brain, agent.rally, clock, bodies[opposite(side)].vx);
      stepCpuBody(bodies[side], minds[side], { clock, rallying: true, flight, side, direction: directions[side], profile: CPU_PROFILES[levels[side]], charging });
    }
    flight = stepFlight(flight, PLAYER_STEP);
    if (flight.status !== 'flying') return finish(flight.status === 'landed' ? flight.hitter : opposite(flight.hitter), shots);
    const side = opposite(flight.hitter);
    const direction = directions[side];
    const shuttle = flight.shuttle;
    if (shuttle.x * direction > 0.12 || clock < minds[side].reactAt || missed) continue;
    const racket = racketPoint(bodies[side].x, bodies[side].jump, direction);
    const distance = Math.hypot(shuttle.x - racket.x, shuttle.y - racket.y);
    if (distance > RACKET_REACH) continue;
    const contact = { x: shuttle.x, y: shuttle.y };
    const agent = agents[side];
    if (CPU_PROFILES[levels[side]].humanBody && !agent && !olympicContactReady(bodies[side], flight, direction, clock)) continue;
    let reply: CpuReturn;
    if (agent) {
      if (clock < (bodies[side].swingStart ?? -Infinity) + PLAYER_SWING_COOLDOWN_MS) continue;
      const held = agent.chargeStart === null ? null : clock - agent.chargeStart;
      const stroke = agentDecide(agent.brain, agent.rally, {
        clock,
        contact,
        direction,
        contactDistance: distance,
        pressure: smashPressure(incoming, flight.elapsed),
        heldMs: held,
        opponent: { x: bodies[flight.hitter].x, vx: bodies[flight.hitter].vx },
        lastChance: lastChanceToHit(bodies[side], flight, direction),
        ready: olympicContactReady(bodies[side], flight, direction, clock),
      }, random);
      if (!stroke) continue;
      agent.chargeStart = null;
      reply = random() < 0.002 ? { kind: 'miss' } : { kind: 'hit', type: stroke.type, accuracy: stroke.accuracy, options: { power: stroke.power } };
    } else {
      reply = cpuReturn(contact, incoming, flight.elapsed, Math.abs(bodies[flight.hitter].x), levels[side], random, incomingPower, distance);
    }
    if (reply.kind === 'miss') {
      missed = true;
      continue;
    }
    const plan = planShot(reply.type, direction, contact, random, reply.accuracy, reply.options);
    if (CPU_PROFILES[levels[side]].humanBody) bodies[side].swingStart = clock;
    if (plan.type === 'smash') bodies[side].recoverUntil = clock + smashRecoveryMs(reply.options.power ?? HALF_SMASH_POWER);
    flight = createFlight(contact, plan.velocity, side, direction);
    if (agent) {
      agent.rally.lastAgentShot = plan.type;
      minds[side].home = agentHome(agent.brain, plan.type);
      startWatch(agent.brain, agent.rally, clock, bodies[opposite(side)].vx);
    }
    answered(side, plan.type, plan.targetX, flight, clock);
    incoming = plan.type;
    incomingPower = reply.options.power ?? HALF_SMASH_POWER;
    missed = false;
    shots += 1;
    minds[opposite(side)].reactAt = clock + CPU_PROFILES[levels[opposite(side)]].reactionMs;
  }
  return finish(server, shots);
}
