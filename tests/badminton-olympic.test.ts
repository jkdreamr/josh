import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU_PROFILES, cpuReturn, createFlight, parseDifficulty, planShot, stepFlight, type Difficulty } from '../src/os/games/badminton.ts';
import { PLAYER_STEP, RACKET_REACH, racketPoint, simulateCpuRally, stepCpuBody, type CpuBody, type CpuMind } from '../src/os/games/badminton-cpu.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('saved difficulty accepts Olympic and safely defaults missing or invalid settings', () => {
  assert.equal(parseDifficulty(JSON.parse('{"difficulty":"olympic"}').difficulty), 'olympic');
  for (const value of [undefined, null, '', 'impossible', 'toString', {}, 1]) assert.equal(parseDifficulty(value), 'normal');
  for (const level of Object.keys(CPU_PROFILES)) assert.equal(parseDifficulty(level), level);
});

test('Olympic tops the seeded ladder without changing Pro parameters', () => {
  assert.deepEqual(CPU_PROFILES.pro, { label: 'Pro', reactionMs: 80, speed: 5.6, accuracy: 1.12, dropChance: 0.5, tactics: true });
  assert.ok(CPU_PROFILES.olympic.speed <= 6);
  assert.ok(CPU_PROFILES.olympic.reactionMs > 0);
  const levels: Difficulty[] = ['easy', 'normal', 'hard', 'pro', 'olympic'];
  for (let j = 1; j < levels.length; j++) {
    const a = levels[j];
    const b = levels[j - 1];
    const random = seeded(2026);
    let wins = 0;
    for (let i = 0; i < 1000; i++) wins += Number(simulateCpuRally({ a, b }, i % 2 ? 'a' : 'b', random).winner === 'a');
    console.log(`${a} vs ${b}: ${wins}/1000 (${wins / 10}%)`);
    assert.ok(wins >= (a === 'olympic' ? 750 : 550));
    assert.ok(wins < 1000);
  }
});

test('Olympic rarely makes an unforced error, but never becomes infallible', () => {
  const random = seeded(17);
  let misses = 0;
  for (let i = 0; i < 20000; i++) misses += Number(cpuReturn({ x: -3, y: 1.8 }, 'clear', 1, 4, 'olympic', random).kind === 'miss');
  console.log(`Olympic unforced errors: ${misses}/20000 (${misses / 200}%)`);
  assert.ok(misses > 0 && misses < 100);
});

test('Olympic punishes short lifts and alternates between open front and back court', () => {
  const reply = (x: number, y: number, opponent: number, roll = 0.5) => cpuReturn({ x, y }, null, 1, opponent, 'olympic', () => roll);
  const smash = reply(-2, 2.7, 3);
  assert.equal(smash.kind, 'hit');
  if (smash.kind === 'hit') {
    assert.equal(smash.type, 'smash');
    assert.equal(smash.options.power, 1);
  }
  for (const [x, y, opponent, type] of [[-4, 2, 5, 'drop'], [-4, 2, 1, 'clear'], [-1, 1, 5, 'net'], [-1, 0.8, 1, 'lift']] as const) {
    const result = reply(x, y, opponent);
    assert.equal(result.kind === 'hit' && result.type, type);
  }
});

test('a perfectly aimed full smash can still win against Olympic using shared footwork and flight physics', () => {
  const random = seeded(91);
  let winners = 0;
  for (let i = 0; i < 300; i++) {
    const start = { x: -2.2, y: 2.7 };
    const shot = planShot('smash', 1, start, random, 1.15, { power: 1, depth: 0 });
    let flight = createFlight(start, shot.velocity, 'a', 1);
    const body: CpuBody = { x: 3.1, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 };
    const mind: CpuMind = { reactAt: CPU_PROFILES.olympic.reactionMs, target: null, predictAt: 0, home: 3.1 };
    let returned = false;
    let missed = false;
    let clock = 0;
    while (flight.status === 'flying') {
      clock += PLAYER_STEP * 1000;
      const previous = body.x;
      stepCpuBody(body, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile: CPU_PROFILES.olympic });
      assert.ok(Math.abs(body.x - previous) <= 6 * PLAYER_STEP + 1e-9);
      flight = stepFlight(flight, PLAYER_STEP);
      const racket = racketPoint(body.x, body.jump, -1);
      if (flight.status !== 'flying' || flight.shuttle.x < -0.12 || clock < mind.reactAt || missed) continue;
      if (Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y) > RACKET_REACH) continue;
      const result = cpuReturn(flight.shuttle, 'smash', flight.elapsed, 2.2, 'olympic', random, 1);
      if (result.kind === 'miss') missed = true;
      else { returned = true; break; }
    }
    if (!returned && flight.status === 'landed') winners++;
  }
  console.log(`Perfect full smash winners against Olympic: ${winners}/300`);
  assert.ok(winners > 0 && winners < 300);
});
