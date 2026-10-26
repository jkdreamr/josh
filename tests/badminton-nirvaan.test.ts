import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU_PROFILES, HALF_SMASH_POWER, PLAYER_MAX_ACCURACY, PLAYER_MAX_POWER, SMASH_DEFENSE, chooseShot, contactAccuracy, cpuReturn, createFlight, parseDifficulty, planShot, pressuredAccuracy, smashPressure, smashRecoveryMs, stepFlight, type Difficulty, type ShotType } from '../src/os/games/badminton.ts';
import { PLAYER_ACCELERATION, PLAYER_STEP, RACKET_REACH, olympicContactReady, racketPoint, simulateCpuRally, stepCpuBody, stepPlayerBody, type CpuBody, type CpuMind } from '../src/os/games/badminton-cpu.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('saved difficulty accepts Nirvaan after Impossible and rejects invalid values', () => {
  assert.equal(parseDifficulty(JSON.parse('{"difficulty":"nirvaan"}').difficulty), 'nirvaan');
  assert.deepEqual(Object.keys(CPU_PROFILES).slice(-2), ['impossible', 'nirvaan']);
  assert.equal(CPU_PROFILES.nirvaan.label, 'Nirvaan');
  for (const value of [undefined, null, '', 'Nirvaan', 'unknown', {}]) assert.equal(parseDifficulty(value), 'normal');
  assert.deepEqual(CPU_PROFILES.impossible, { label: 'Impossible', reactionMs: 15, speed: 6.2, accuracy: 1.15, dropChance: 0.7, tactics: true, ruthless: true, anticipates: 0.35, home: 2.4, unforcedMiss: 0.0015 });
  assert.deepEqual(SMASH_DEFENSE.impossible, { miss: 0.01, block: 0.05 });
});

function checkNetTrap(sweetSpot: boolean, intent: 'soft' | 'power') {
  const random = seeded(230);
  const profile = CPU_PROFILES.nirvaan;
  const sample = 20000;
  let losses = 0, deepSmashes = 0, netReplies = 0, missedLosses = 0;
  for (let i = 0; i < sample; i++) {
    const human: CpuBody = { x: -1.15, vx: 0, jump: 1, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 };
    const cpu: CpuBody = { x: 3.1, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 };
    const mind: CpuMind = { reactAt: profile.reactionMs, target: null, predictAt: 0, home: 3.1 };
    const start = racketPoint(human.x, human.jump, 1);
    const clear = planShot(chooseShot('normal', start), 1, start, random, PLAYER_MAX_ACCURACY, { power: HALF_SMASH_POWER });
    assert.equal(clear.type, 'clear');
    assert.ok(clear.targetX > 5);
    let flight = createFlight(start, clear.velocity, 'a', 1);
    let incoming: ShotType = clear.type;
    let incomingPower = HALF_SMASH_POWER;
    let clock = 0, cpuShots = 0, humanReplied = false, cpuMissed = false;
    while (flight.status === 'flying' && clock < 10000) {
      clock += PLAYER_STEP * 1000;
      const previous = cpu.x;
      stepCpuBody(cpu, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile });
      assert.ok(Math.abs(cpu.x - previous) <= profile.speed * PLAYER_STEP + 1e-9);
      const shuttle = flight.shuttle;
      if (flight.hitter === 'b' && shuttle.y > 2 && shuttle.vy < 1.5 && Math.abs(shuttle.x - (human.x + 0.5)) < 1.4 && human.jump === 0) human.jumpRequested = true;
      stepPlayerBody(human, 0, 1, clock < human.recoverUntil);
      const cpuRacket = racketPoint(cpu.x, cpu.jump, -1);
      const cpuDistance = Math.hypot(shuttle.x - cpuRacket.x, shuttle.y - cpuRacket.y);
      if (flight.hitter === 'a' && shuttle.x >= -0.12 && clock >= mind.reactAt && !cpuMissed && cpuDistance <= RACKET_REACH) {
        const reply = cpuReturn(shuttle, incoming, flight.elapsed, Math.abs(human.x), 'nirvaan', random, incomingPower, cpuDistance);
        if (reply.kind === 'miss') cpuMissed = true;
        else {
          if (humanReplied) break;
          const plan = planShot(reply.type, -1, shuttle, random, reply.accuracy, reply.options);
          if (plan.type === 'smash' && shuttle.x > 3.5) deepSmashes++;
          cpuShots++;
          incoming = plan.type;
          incomingPower = reply.options.power ?? HALF_SMASH_POWER;
          if (plan.type === 'smash') cpu.recoverUntil = clock + smashRecoveryMs(incomingPower);
          flight = createFlight(shuttle, plan.velocity, 'b', -1);
        }
      } else if (flight.hitter === 'b' && !humanReplied && shuttle.x <= 0.12) {
        const racket = racketPoint(human.x, human.jump, 1);
        const distance = Math.hypot(shuttle.x - racket.x, shuttle.y - racket.y);
        if (distance <= RACKET_REACH && (!sweetSpot || olympicContactReady(human, flight, 1, clock))) {
          const accuracy = pressuredAccuracy(contactAccuracy(distance, RACKET_REACH), smashPressure(incoming, flight.elapsed));
          const plan = planShot(chooseShot(intent, shuttle), 1, shuttle, random, accuracy, { power: HALF_SMASH_POWER });
          flight = createFlight(shuttle, plan.velocity, 'a', 1);
          humanReplied = true;
          netReplies++;
          incoming = plan.type;
          incomingPower = HALF_SMASH_POWER;
          mind.reactAt = clock + profile.reactionMs;
          mind.target = null;
          if (plan.type === 'smash') human.recoverUntil = clock + smashRecoveryMs(HALF_SMASH_POWER);
        }
      }
      flight = stepFlight(flight, PLAYER_STEP);
    }
    if (flight.status === 'landed' && flight.hitter === 'a') {
      losses++;
      if (cpuMissed) missedLosses++;
    }
    assert.ok(cpuShots <= 1);
    assert.ok(clock < 10000);
  }
  console.log(`Net-trap losses (${sweetSpot ? 'sweet spot' : 'early'}, ${intent}): ${losses}/${sample} (${(100 * losses / sample).toFixed(3)}%); deep smashes: ${deepSmashes}; player net replies: ${netReplies}; missed returns: ${missedLosses}`);
  assert.ok(losses > 0);
  assert.ok(losses / sample <= 0.0005);
  assert.equal(deepSmashes, 0);
  assert.equal(netReplies, 0);
}

test('Nirvaan defends a player-legal clear then front-court net drop or kill', () => {
  for (const sweetSpot of [false, true]) for (const intent of ['soft', 'power'] as const) checkNetTrap(sweetSpot, intent);
});

test('only Nirvaan clears or lifts over net-rushers from the back court', () => {
  for (const direction of [-1, 1] as const) {
    for (const y of [1, 2.7]) {
      const contact = { x: -direction * 5, y };
      const reply = cpuReturn(contact, 'clear', 1, 1.15, 'nirvaan', () => 0.5);
      assert.equal(reply.kind, 'hit');
      if (reply.kind === 'hit') {
        assert.equal(reply.type, y < 1.5 ? 'lift' : 'clear');
        const shot = planShot(reply.type, direction, contact, () => 0.5, reply.accuracy, reply.options);
        assert.ok(direction * shot.targetX > 5.5);
      }
    }
    for (const difficulty of ['nirvaan', 'impossible'] as const) {
      for (const [fromNet, opponent] of [[3.5, 1.15], [5, 2.2], [5, 4], ...(difficulty === 'impossible' ? [[5, 1.15]] : [])]) {
        const reply = cpuReturn({ x: -direction * fromNet, y: 2.7 }, 'clear', 1, opponent, difficulty, () => 0.5);
        assert.equal(reply.kind, 'hit');
        if (reply.kind === 'hit') assert.equal(reply.type, 'smash');
      }
    }
  }
});

test('seeded ladder reaches Nirvaan, which wins at least 99 percent against Impossible', () => {
  const levels: Difficulty[] = ['easy', 'normal', 'hard', 'pro', 'olympic', 'impossible', 'nirvaan'];
  for (let j = 1; j < levels.length; j++) {
    const a = levels[j], b = levels[j - 1];
    const random = seeded(2026);
    const sample = a === 'nirvaan' ? 2000 : 1000;
    let wins = 0;
    for (let i = 0; i < sample; i++) wins += Number(simulateCpuRally({ a, b }, i % 2 ? 'a' : 'b', random).winner === 'a');
    console.log(`${a} vs ${b}: ${wins}/${sample} (${(100 * wins / sample).toFixed(2)}%)`);
    assert.ok(wins / sample >= (a === 'nirvaan' ? 0.99 : 0.52), `${a} vs ${b}: ${wins}/${sample}`);
    assert.ok(wins < sample);
  }
});

test('Nirvaan has tiny nonzero unforced errors and pressure-resistant full-power attacks', () => {
  const profile = CPU_PROFILES.nirvaan;
  const random = seeded(17);
  let misses = 0;
  const sample = 100000;
  for (let i = 0; i < sample; i++) misses += Number(cpuReturn({ x: -3, y: 1.8 }, 'clear', 1, 4, 'nirvaan', random).kind === 'miss');
  console.log(`Nirvaan unforced errors: ${misses}/${sample} (${(100 * misses / sample).toFixed(3)}%)`);
  assert.ok(misses > 0 && misses / sample < 0.001);
  assert.equal(cpuReturn({ x: -3, y: 2.7 }, 'clear', 1, 4, 'nirvaan', () => 0).kind, 'miss');
  const reply = cpuReturn({ x: -5, y: 2.7 }, 'smash', 0.3, 4, 'nirvaan', () => 0.5, PLAYER_MAX_POWER);
  assert.equal(reply.kind, 'hit');
  if (reply.kind === 'hit') {
    assert.equal(reply.accuracy, profile.accuracy);
    assert.equal(reply.type, 'smash');
    assert.equal(reply.options.power, PLAYER_MAX_POWER);
  }
  assert.ok(profile.speed > CPU_PROFILES.impossible.speed);
  assert.ok(profile.acceleration! > PLAYER_ACCELERATION);
});

test('a player-legal perfect full smash wins about 0.05 percent against continuously moving Nirvaan', () => {
  const profile = CPU_PROFILES.nirvaan;
  const random = seeded(91);
  const sample = 40000;
  let winners = 0;
  for (let i = 0; i < sample; i++) {
    const start = { x: -2.2, y: 2.7 };
    const shot = planShot('smash', 1, start, random, PLAYER_MAX_ACCURACY, { power: PLAYER_MAX_POWER });
    let flight = createFlight(start, shot.velocity, 'a', 1);
    const body: CpuBody = { x: 3.1, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 };
    const mind: CpuMind = { reactAt: profile.reactionMs, target: null, predictAt: 0, home: 3.1 };
    let returned = false, missed = false, clock = 0;
    while (flight.status === 'flying') {
      clock += PLAYER_STEP * 1000;
      const previous = body.x;
      stepCpuBody(body, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile });
      assert.ok(Math.abs(body.x - previous) <= profile.speed * PLAYER_STEP + 1e-9);
      assert.ok(Math.abs(body.vx) <= profile.speed + 1e-9);
      flight = stepFlight(flight, PLAYER_STEP);
      const racket = racketPoint(body.x, body.jump, -1);
      if (flight.status !== 'flying' || flight.shuttle.x < -0.12 || clock < mind.reactAt || missed) continue;
      if (Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y) > RACKET_REACH) continue;
      const result = cpuReturn(flight.shuttle, 'smash', flight.elapsed, 2.2, 'nirvaan', random, PLAYER_MAX_POWER);
      if (result.kind === 'miss') missed = true;
      else { returned = true; break; }
    }
    if (!returned && flight.status === 'landed') winners++;
  }
  console.log(`Perfect player full smash winners against Nirvaan: ${winners}/${sample} (${(100 * winners / sample).toFixed(3)}%)`);
  assert.ok(winners / sample >= 0.0002 && winners / sample <= 0.0008);
});
