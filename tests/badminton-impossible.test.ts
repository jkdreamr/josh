import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU_PROFILES, cpuReturn, createFlight, parseDifficulty, planShot, SMASH_DEFENSE, stepFlight, type Difficulty } from '../src/os/games/badminton.ts';
import { PLAYER_STEP, RACKET_REACH, racketPoint, simulateCpuRally, stepCpuBody, type CpuBody, type CpuMind } from '../src/os/games/badminton-cpu.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('saved difficulty accepts Impossible, listed after Olympic', () => {
  assert.equal(parseDifficulty(JSON.parse('{"difficulty":"impossible"}').difficulty), 'impossible');
  assert.equal(parseDifficulty('Impossible'), 'normal');
  assert.deepEqual(Object.keys(CPU_PROFILES).slice(-2), ['olympic', 'impossible']);
  assert.equal(CPU_PROFILES.impossible.label, 'Impossible');
});

test('Impossible is at least as sharp as Olympic and Pro on every dial, yet still fallible', () => {
  const { pro, olympic, impossible } = CPU_PROFILES;
  for (const level of [pro, olympic]) {
    assert.ok(impossible.reactionMs > 0 && impossible.reactionMs <= level.reactionMs);
    assert.ok(impossible.speed >= level.speed);
    assert.ok(impossible.accuracy >= level.accuracy);
  }
  assert.ok(impossible.unforcedMiss !== undefined && impossible.unforcedMiss > 0);
  assert.ok(SMASH_DEFENSE.impossible.miss > 0 && SMASH_DEFENSE.impossible.miss < SMASH_DEFENSE.pro.miss);
  assert.ok(SMASH_DEFENSE.impossible.block > 0 && SMASH_DEFENSE.impossible.block < SMASH_DEFENSE.pro.block);
});

test('seeded ladder: easy < normal < hard < pro < olympic < impossible', () => {
  const levels: Difficulty[] = ['easy', 'normal', 'hard', 'pro', 'olympic', 'impossible'];
  for (let j = 1; j < levels.length; j++) {
    const a = levels[j];
    const b = levels[j - 1];
    const random = seeded(2026);
    let wins = 0;
    for (let i = 0; i < 1000; i++) wins += Number(simulateCpuRally({ a, b }, i % 2 ? 'a' : 'b', random).winner === 'a');
    console.log(`${a} vs ${b}: ${wins}/1000 (${wins / 10}%)`);
    assert.ok(wins >= (a === 'impossible' ? 750 : 520), `${a} vs ${b}: ${wins}/1000`);
    assert.ok(wins < 1000);
  }
});

test('Impossible very rarely makes an unforced error, but never none', () => {
  const random = seeded(17);
  let misses = 0;
  for (let i = 0; i < 20000; i++) misses += Number(cpuReturn({ x: -3, y: 1.8 }, 'clear', 1, 4, 'impossible', random).kind === 'miss');
  console.log(`Impossible unforced errors: ${misses}/20000 (${misses / 200}%)`);
  assert.ok(misses > 0 && misses < 60);
});

test('a perfectly aimed full smash can still win against Impossible, which moves continuously within its speed', () => {
  const profile = CPU_PROFILES.impossible;
  const random = seeded(91);
  let winners = 0;
  for (let i = 0; i < 1000; i++) {
    const start = { x: -2.2, y: 2.7 };
    const shot = planShot('smash', 1, start, random, 1.15, { power: 1, depth: 0 });
    let flight = createFlight(start, shot.velocity, 'a', 1);
    const body: CpuBody = { x: 3.1, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 };
    const mind: CpuMind = { reactAt: profile.reactionMs, target: null, predictAt: 0, home: 3.1 };
    let returned = false;
    let missed = false;
    let clock = 0;
    while (flight.status === 'flying') {
      clock += PLAYER_STEP * 1000;
      const previous = body.x;
      stepCpuBody(body, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile });
      assert.ok(Math.abs(body.x - previous) <= profile.speed * PLAYER_STEP + 1e-9);
      flight = stepFlight(flight, PLAYER_STEP);
      const racket = racketPoint(body.x, body.jump, -1);
      if (flight.status !== 'flying' || flight.shuttle.x < -0.12 || clock < mind.reactAt || missed) continue;
      if (Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y) > RACKET_REACH) continue;
      const result = cpuReturn(flight.shuttle, 'smash', flight.elapsed, 2.2, 'impossible', random, 1);
      if (result.kind === 'miss') missed = true;
      else { returned = true; break; }
    }
    if (!returned && flight.status === 'landed') winners++;
  }
  console.log(`Perfect full smash winners against Impossible: ${winners}/1000`);
  assert.ok(winners > 0 && winners < 100);
});
