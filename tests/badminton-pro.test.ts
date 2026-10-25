import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chargePower, cpuChooseShot, cpuReturn, CPU_PROFILES, createFlight, HALF_SMASH_POWER, planShot, simulateNetClearance, SMASH_DEFENSE, smashLabel,
  smashPressure, smashRecoveryMs, stepFlight, type Difficulty,
} from '../src/os/games/badminton.ts';
import { simulateCpuRally } from '../src/os/games/badminton-cpu.ts';
import { parseGuestMessage } from '../src/os/apps/badminton-net.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('easy, normal and hard keep their exact parameters', () => {
  assert.deepEqual(CPU_PROFILES.easy, { label: 'Easy', reactionMs: 260, speed: 3, accuracy: 0.72, dropChance: 0.15 });
  assert.deepEqual(CPU_PROFILES.normal, { label: 'Normal', reactionMs: 170, speed: 4.1, accuracy: 0.88, dropChance: 0.3 });
  assert.deepEqual(CPU_PROFILES.hard, { label: 'Hard', reactionMs: 110, speed: 5, accuracy: 1, dropChance: 0.42 });
});

test('easy, normal and hard still pick the same shots off anything but a smash', () => {
  for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
    for (let i = 0; i < 400; i++) {
      const pick = seeded(i + 1);
      const contact = { x: -(0.3 + pick() * 6.2), y: 0.3 + pick() * 2.6 };
      const opponent = pick() * 6.5;
      const reply = cpuReturn(contact, 'clear', 1.4, opponent, level, seeded(i + 99));
      assert.equal(reply.kind, 'hit');
      if (reply.kind !== 'hit') continue;
      assert.equal(reply.type, cpuChooseShot(contact, opponent, CPU_PROFILES[level], seeded(i + 99)));
      assert.equal(reply.accuracy, CPU_PROFILES[level].accuracy);
    }
  }
});

test('pro reacts and moves faster with tighter aim, but within human limits', () => {
  const { pro, hard } = CPU_PROFILES;
  assert.ok(pro.reactionMs < hard.reactionMs && pro.reactionMs >= 70);
  assert.ok(pro.speed > hard.speed && pro.speed <= 6);
  assert.ok(pro.accuracy > hard.accuracy);
});

test('pro beats hard in most simulated rallies, and the ladder holds', () => {
  const rate = (a: Difficulty, b: Difficulty, rallies = 300) => {
    const random = seeded(2026);
    let wins = 0;
    for (let i = 0; i < rallies; i++) if (simulateCpuRally({ a, b }, i % 2 ? 'a' : 'b', random).winner === 'a') wins++;
    return wins / rallies;
  };
  const proVsHard = rate('pro', 'hard');
  assert.ok(proVsHard > 0.55, `pro won ${proVsHard}`);
  assert.ok(proVsHard < 0.85, `pro should stay beatable, won ${proVsHard}`);
  assert.ok(rate('hard', 'easy') > 0.6);
});

test('holding longer charges a harder smash that costs more recovery', () => {
  assert.equal(chargePower(0), HALF_SMASH_POWER);
  assert.equal(chargePower(2000), 1);
  assert.ok(chargePower(300) > chargePower(150));
  assert.ok(smashRecoveryMs(1) > smashRecoveryMs(HALF_SMASH_POWER) + 200);
  assert.equal(smashLabel(1), 'Full Smash');
  assert.equal(smashLabel(HALF_SMASH_POWER), 'Half Smash');
});

test('every smash from anywhere in the back court clears the net at any power', () => {
  for (const power of [0, HALF_SMASH_POWER, 0.5, 0.75, 1]) {
    for (let i = 0; i < 300; i++) {
      const pick = seeded(i * 7 + Math.round(power * 100));
      const start = { x: -(1 + pick() * 5.7), y: 2 + pick() * 1.1 };
      const plan = planShot('smash', 1, start, pick, 0.6 + pick() * 0.4, { power });
      // Low contact from the very back has no room for a smash and becomes a drive, as before.
      if (start.y < 2.4 && plan.type === 'drive') continue;
      assert.equal(plan.type, 'smash', `power ${power} from ${start.x.toFixed(2)},${start.y.toFixed(2)} fell back to ${plan.type}`);
      const clearance = simulateNetClearance(start, plan.velocity);
      assert.ok(clearance !== null && clearance > 0, `power ${power} from ${start.x.toFixed(2)},${start.y.toFixed(2)} hit the net`);
    }
  }
});

const speedAt = (start: { x: number; y: number }, power: number, seed: number) => {
  let flight = createFlight(start, planShot('smash', 1, start, seeded(seed), 1, { power, depth: 0.5 }).velocity, 'a', 1);
  while (flight.status === 'flying' && flight.shuttle.x < 1.5) flight = stepFlight(flight, 1 / 240);
  return { speed: Math.hypot(flight.shuttle.vx, flight.shuttle.vy), time: flight.elapsed };
};

test('a full smash is faster than a half smash, and a deep one arrives slower than a kill from the front', () => {
  let fullBeatsHalf = 0;
  let kills = 0;
  for (let seed = 1; seed <= 40; seed++) {
    if (speedAt({ x: -5.8, y: 2.7 }, 1, seed).speed > speedAt({ x: -5.8, y: 2.7 }, HALF_SMASH_POWER, seed).speed) fullBeatsHalf++;
    if (speedAt({ x: -2.2, y: 2.7 }, 1, seed).speed > speedAt({ x: -5.8, y: 2.7 }, 1, seed).speed) kills++;
  }
  assert.ok(fullBeatsHalf >= 36, `${fullBeatsHalf}`);
  assert.ok(kills >= 36, `${kills}`);
  const offRacket = Math.hypot(...Object.values(planShot('smash', 1, { x: -5.8, y: 2.7 }, () => 0.5, 1, { power: 1 }).velocity) as [number, number]);
  assert.ok(offRacket > 88 && offRacket < 96, `${offRacket}`);
  const halfOffRacket = Math.hypot(...Object.values(planShot('smash', 1, { x: -2.2, y: 2.7 }, () => 0.5, 1, { power: HALF_SMASH_POWER }).velocity) as [number, number]);
  assert.ok(halfOffRacket < 42, `${halfOffRacket}`);
});

test('a fast smash forces more misses and short blocks, more so on easier levels', () => {
  assert.equal(smashPressure('clear', 0.3), 0);
  assert.equal(smashPressure('smash', 1.2), 0);
  assert.ok(smashPressure('smash', 0.4) > smashPressure('smash', 0.6));
  const outcomes = (level: Difficulty) => {
    const random = seeded(5);
    let miss = 0;
    let block = 0;
    for (let i = 0; i < 2000; i++) {
      const reply = cpuReturn({ x: -4, y: 1.1 }, 'smash', 0.4, 3, level, random);
      if (reply.kind === 'miss') miss++;
      else if (reply.type === 'net') block++;
    }
    return { miss, block };
  };
  const results = (['easy', 'normal', 'hard', 'pro'] as Difficulty[]).map(outcomes);
  for (let i = 1; i < results.length; i++) assert.ok(results[i].miss < results[i - 1].miss);
  assert.ok(results[3].miss > 0 && results[3].block > 0, 'even pro gets caught out sometimes');
  assert.ok(SMASH_DEFENSE.easy.miss > SMASH_DEFENSE.pro.miss);
});

test('a full smash beats the computer far more often than a half smash', () => {
  for (const level of ['easy', 'normal', 'hard', 'pro'] as Difficulty[]) {
    const beaten = (power: number) => {
      const random = seeded(11);
      let count = 0;
      for (let i = 0; i < 4000; i++) if (cpuReturn({ x: -4, y: 1.1 }, 'smash', 0.3, 3, level, random, power).kind === 'miss') count++;
      return count;
    };
    const half = beaten(HALF_SMASH_POWER);
    const full = beaten(1);
    assert.ok(full > half * 2.5, `${level}: full ${full} vs half ${half}`);
  }
});

test('the guest can send a smash power with a hit', () => {
  assert.deepEqual(parseGuestMessage({ t: 'hit', intent: 'power', power: 0.8 }), { t: 'hit', intent: 'power', power: 0.8 });
  assert.deepEqual(parseGuestMessage({ t: 'hit' }), { t: 'hit' });
  assert.equal(parseGuestMessage({ t: 'hit', power: 4 }), null);
  assert.equal(parseGuestMessage({ t: 'hit', power: 'max' }), null);
});
