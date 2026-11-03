import { agentDecide, agentHome, lastChanceToHit, newAgentRally, newBrain, observeOpponent, planForIncoming, recordRallyEnd, recordReply, startWatch, type AgentBrain } from '../src/os/games/badminton-agent.ts';
import { CHARGE_MIN_MS, clampToHalf, olympicContactReady, PLAYER_STEP, PLAYER_SWING_COOLDOWN_MS, racketPoint, stepCpuBody, stepPlayerBody, type CpuBody, type CpuMind } from '../src/os/games/badminton-cpu.ts';
import { chargePower, chooseShot, contactAccuracy, CPU_PROFILES, createFlight, HALF_SMASH_POWER, planShot, PLAYER_MAX_ACCURACY, pressuredAccuracy, RACKET_REACH, simulateLanding, smashPressure, smashRecoveryMs, stepFlight, type Intent, type ShotType } from '../src/os/games/badminton.ts';

export const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

export const strategies = ['net drops', 'normal clears', 'body smashes', 'clear/drop', 'flat drives', 'short serve', 'long serve', 'serve receive', 'mid-court', 'net trap'] as const;
export type Strategy = typeof strategies[number];

/** A perfect reader, but with the real player's feet, reach, charge, accuracy and swing cooldown. No depth overrides. */
export function humanRally(strategy: Strategy, random: () => number, brain: AgentBrain = newBrain(), decide = agentDecide, home = agentHome) {
  const body = (): CpuBody => ({ x: 2.4, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 });
  const human = { ...body(), x: -2.4 };
  const agent = body();
  const mind: CpuMind = { reactAt: 20, target: null, predictAt: 0, home: 2.6 };
  const rally = newAgentRally();
  const server = strategy === 'serve receive' ? 'b' : 'a';
  const serveType = strategy === 'long serve' || strategy === 'net trap' ? 'high-serve' : 'serve';
  const start = { x: server === 'a' ? human.x + 0.45 : agent.x - 0.45, y: 1.05 };
  const serve = planShot(serveType, server === 'a' ? 1 : -1, start, random, PLAYER_MAX_ACCURACY);
  let flight = createFlight(start, serve.velocity, server, server === 'a' ? 1 : -1, true);
  let incoming: ShotType = serveType;
  let clock = 0, shots = 1, humanShots = 0;
  let charge: number | null = null, humanCharge: number | null = null;
  let missed = false, unforced = false;
  let humanTarget = clampToHalf(simulateLanding(start, serve.velocity).x - 0.5, 1);
  const finish = (won: boolean) => {
    recordRallyEnd(brain, rally, !won);
    return { won, unforced, shots };
  };
  if (serve.fault) return finish(server === 'b');
  if (server === 'b') {
    rally.lastAgentShot = serveType;
    startWatch(brain, rally, clock, human.vx);
  } else planForIncoming(brain, rally, flight, incoming, 0, 20, random);
  while (clock < 120_000) {
    clock += PLAYER_STEP * 1000;
    if (rally.plan && !rally.plan.used && charge === null && flight.hitter === 'a' && clock >= rally.plan.chargeAt) charge = clock;
    if (flight.hitter === 'b') observeOpponent(brain, rally, clock, human.vx);
    stepCpuBody(agent, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile: CPU_PROFILES.agent, charging: charge !== null && clock - charge > CHARGE_MIN_MS });
    let target = strategy === 'net trap' ? -1.15 : -2.6;
    if (flight.hitter === 'b') {
      target = humanTarget;
      // The same predictive footwork and jump timing available to Olympic, but applied through the player's body.
      if (strategy === 'mid-court') target = -3.1;
      if (strategy === 'net trap' && incoming === 'smash') target = -1.15;
      if (flight.shuttle.y > 2.25 && flight.shuttle.vy < 1.5 && Math.abs(flight.shuttle.x - human.x - 0.5) < 1.4) human.jumpRequested = true;
    }
    stepPlayerBody(human, Math.abs(target - human.x) > 0.08 ? Math.sign(target - human.x) : 0, 1, clock < human.recoverUntil, humanCharge !== null && clock - humanCharge > CHARGE_MIN_MS);
    flight = stepFlight(flight, PLAYER_STEP);
    if (flight.status !== 'flying') return finish(flight.status === 'landed' ? flight.hitter === 'a' : flight.hitter === 'b');
    const isHuman = flight.hitter === 'b';
    const athlete = isHuman ? human : agent;
    const direction = isHuman ? 1 : -1;
    if (flight.shuttle.x * direction > 0.12 || (!isHuman && (clock < mind.reactAt || missed))) continue;
    const racket = racketPoint(athlete.x, athlete.jump, direction);
    const distance = Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y);
    if (distance > RACKET_REACH || clock < (athlete.swingStart ?? -Infinity) + PLAYER_SWING_COOLDOWN_MS) continue;
    const contact = { x: flight.shuttle.x, y: flight.shuttle.y };
    let type: ShotType, accuracy: number, power: number;
    if (isHuman) {
      if (!olympicContactReady(human, flight, 1, clock)) continue;
      let intent: Intent = 'normal';
      if (strategy === 'net drops') intent = 'soft';
      if (strategy === 'body smashes' || strategy === 'flat drives') intent = 'power';
      if (strategy === 'clear/drop') intent = humanShots % 2 ? 'soft' : 'normal';
      if (strategy === 'net trap') intent = incoming === 'smash' ? 'power' : 'normal';
      type = chooseShot(intent, contact);
      accuracy = pressuredAccuracy(contactAccuracy(distance, RACKET_REACH), smashPressure(incoming, flight.elapsed));
      power = type === 'smash' && humanCharge !== null ? chargePower(clock - humanCharge) : HALF_SMASH_POWER;
      humanCharge = null;
      humanShots++;
    } else {
      const stroke = decide(brain, rally, { clock, contact, direction: -1, contactDistance: distance, pressure: smashPressure(incoming, flight.elapsed), heldMs: charge === null ? null : clock - charge, opponent: human, lastChance: lastChanceToHit(agent, flight, -1), ready: olympicContactReady(agent, flight, -1, clock) }, random);
      if (!stroke) continue;
      charge = null;
      if (random() < 0.002) { missed = true; unforced = true; continue; }
      ({ type, accuracy, power } = stroke);
    }
    athlete.swingStart = clock;
    if (type === 'smash') athlete.recoverUntil = clock + smashRecoveryMs(power);
    const plan = planShot(type, direction, contact, random, accuracy, { power });
    flight = createFlight(contact, plan.velocity, isHuman ? 'a' : 'b', direction);
    incoming = type;
    shots++;
    if (isHuman) {
      recordReply(brain, rally, type, Math.abs(plan.targetX));
      planForIncoming(brain, rally, flight, type, clock, clock + CPU_PROFILES.agent.reactionMs, random);
      mind.reactAt = clock + CPU_PROFILES.agent.reactionMs;
    } else {
      rally.lastAgentShot = type;
      mind.home = home(brain, type);
      startWatch(brain, rally, clock, human.vx);
      humanTarget = clampToHalf(simulateLanding(contact, plan.velocity).x - 0.5, 1);
      if (strategy === 'body smashes' && (type === 'clear' || type === 'lift')) humanCharge = clock;
    }
  }
  return { won: null, unforced, shots };
}
