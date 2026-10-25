import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU_PROFILES, HALF_SMASH_POWER, PLAYER_MAX_ACCURACY, PLAYER_MAX_POWER, PLAYER_RUN_SPEED, chooseShot, contactAccuracy, cpuReturn, createFlight, parseDifficulty, planShot, pressuredAccuracy, smashPressure, stepFlight, type Difficulty } from '../src/os/games/badminton.ts';
import { PLAYER_ACCELERATION, PLAYER_BRAKING, PLAYER_JUMP_VELOCITY, PLAYER_STEP, PLAYER_SWING_COOLDOWN_MS, RACKET_REACH, olympicContactReady, racketPoint, simulateCpuRally, stepCpuBody, stepPlayerBody, type CpuBody, type CpuMind } from '../src/os/games/badminton-cpu.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('saved difficulty accepts Olympic and safely defaults missing or invalid settings', () => {
  assert.equal(parseDifficulty(JSON.parse('{"difficulty":"olympic"}').difficulty), 'olympic');
  for (const value of [undefined, null, '', 'Impossible', 'toString', {}, 1]) assert.equal(parseDifficulty(value), 'normal');
  for (const level of Object.keys(CPU_PROFILES)) assert.equal(parseDifficulty(level), level);
});

test('Olympic tops the seeded ladder without changing Pro parameters', () => {
  assert.deepEqual(CPU_PROFILES.pro, { label: 'Pro', reactionMs: 80, speed: 5.6, accuracy: 1.12, dropChance: 0.5, tactics: true });
  assert.ok(CPU_PROFILES.olympic.speed <= PLAYER_RUN_SPEED);
  assert.ok(CPU_PROFILES.olympic.accuracy <= PLAYER_MAX_ACCURACY);
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
    assert.equal(smash.options.power, HALF_SMASH_POWER);
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
    const shot = planShot('smash', 1, start, random, PLAYER_MAX_ACCURACY, { power: PLAYER_MAX_POWER });
    let flight = createFlight(start, shot.velocity, 'a', 1);
    const body: CpuBody = { x: 2.4 + random() * 3.4, vx: (random() - 0.5) * 2 * PLAYER_RUN_SPEED, jump: 0, jumpVelocity: 0, jumpRequested: false, recoverUntil: 0 };
    const mind: CpuMind = { reactAt: CPU_PROFILES.olympic.reactionMs, target: null, predictAt: 0, home: 3.1 };
    let returned = false;
    let missed = false;
    let clock = 0;
    while (flight.status === 'flying') {
      clock += PLAYER_STEP * 1000;
      const previous = body.x;
      stepCpuBody(body, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile: CPU_PROFILES.olympic });
      assert.ok(Math.abs(body.x - previous) <= PLAYER_RUN_SPEED * PLAYER_STEP + 1e-9);
      flight = stepFlight(flight, PLAYER_STEP);
      const racket = racketPoint(body.x, body.jump, -1);
      if (flight.status !== 'flying' || flight.shuttle.x < -0.12 || clock < mind.reactAt || missed) continue;
      if (Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y) > RACKET_REACH) continue;
      if (!olympicContactReady(body, flight, -1, clock)) continue;
      const distance = Math.hypot(flight.shuttle.x - racket.x, flight.shuttle.y - racket.y);
      const result = cpuReturn(flight.shuttle, 'smash', flight.elapsed, 2.2, 'olympic', random, PLAYER_MAX_POWER, distance);
      if (result.kind === 'miss') missed = true;
      else { returned = true; break; }
    }
    if (!returned && flight.status === 'landed') winners++;
  }
  console.log(`Perfect full smash winners against Olympic: ${winners}/300`);
  assert.ok(winners > 0 && winners < 300);
});

test('Olympic uses only player intents, uncharged power, and actual contact accuracy under smash pressure', () => {
  assert.equal(cpuReturn({ x: -3, y: 1.2 }, 'smash', 0.3, 4, 'olympic', () => 0.005, PLAYER_MAX_POWER, 0).kind, 'hit');
  for (const x of [-1, -3, -6]) for (const y of [0.5, 1.2, 1.8, 2.7]) for (const opponent of [1, 5]) {
    for (const distance of [0, 0.4, RACKET_REACH]) {
      const contact = { x, y };
      const result = cpuReturn(contact, 'smash', 0.3, opponent, 'olympic', () => 0.5, PLAYER_MAX_POWER, distance);
      assert.equal(result.kind, 'hit');
      if (result.kind !== 'hit') continue;
      assert.ok(['normal', 'soft', 'power'].some(intent => chooseShot(intent as 'normal' | 'soft' | 'power', contact) === result.type));
      assert.equal(result.options.depth, undefined);
      assert.equal(result.options.power, HALF_SMASH_POWER);
      assert.ok(result.options.power! <= PLAYER_MAX_POWER);
      assert.equal(result.accuracy, pressuredAccuracy(contactAccuracy(distance, RACKET_REACH), smashPressure('smash', 0.3)));
    }
  }
});

test('Olympic movement has identical acceleration, braking, recovery, bounds and jump to the player', () => {
  const makeBody = (): CpuBody => ({ x: 5, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: true, recoverUntil: 300 });
  const cpu = makeBody();
  const player = makeBody();
  const flight = createFlight({ x: 1, y: 2 }, { vx: -5, vy: 2 }, 'b', -1);
  const mind: CpuMind = { reactAt: 0, target: null, predictAt: 0, home: 3.1 };
  for (let i = 0; i < 200; i++) {
    const clock = i * PLAYER_STEP * 1000;
    const oldVx = cpu.vx;
    const move = Math.abs(2.4 - player.x) > 0.08 ? Math.sign(2.4 - player.x) : 0;
    stepCpuBody(cpu, mind, { clock, rallying: true, flight, side: 'b', direction: -1, profile: CPU_PROFILES.olympic });
    stepPlayerBody(player, move, -1, clock < player.recoverUntil);
    assert.deepEqual(cpu, player);
    assert.ok(Math.abs(cpu.vx) <= PLAYER_RUN_SPEED);
    assert.ok(Math.abs(cpu.vx - oldVx) <= Math.max(PLAYER_ACCELERATION, PLAYER_BRAKING) * PLAYER_STEP + 1e-9);
    assert.ok(cpu.jumpVelocity <= PLAYER_JUMP_VELOCITY);
  }
  cpu.swingStart = 100;
  assert.equal(olympicContactReady(cpu, flight, -1, 100 + PLAYER_SWING_COOLDOWN_MS - 1), false);
});
