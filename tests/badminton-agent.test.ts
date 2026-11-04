import assert from 'node:assert/strict';
import test from 'node:test';
import { chargePower, chooseShot, CPU_PROFILES, createFlight, HALF_SMASH_POWER, parseDifficulty, PLAYER_MAX_ACCURACY, PLAYER_MAX_POWER, PLAYER_RUN_SPEED } from '../src/os/games/badminton.ts';
import { agentHome, agentInsights, agentStroke, chooseIntent, newAgentRally, newBrain, opponentModel, recordRallyEnd, recordReply, type AgentBrain } from '../src/os/games/badminton-agent.ts';
import { olympicContactReady, PLAYER_STEP, PLAYER_SWING_COOLDOWN_MS, simulateCpuRally, stepCpuBody, stepPlayerBody } from '../src/os/games/badminton-cpu.ts';
import { humanRally } from './badminton-agent-sim.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('the agent has no edge over a human body', () => {
  const agent = CPU_PROFILES.agent;
  assert.equal(parseDifficulty('agent'), 'agent');
  assert.ok(agent.humanBody && agent.learns);
  assert.ok(agent.speed <= PLAYER_RUN_SPEED);
  assert.ok(agent.accuracy <= PLAYER_MAX_ACCURACY);
  assert.ok(agent.reactionMs >= CPU_PROFILES.olympic.reactionMs, 'reacts no faster than Olympic');
  assert.equal(agent.acceleration, undefined);
  assert.equal(agent.smashPower, undefined);
});

test('agent smash power comes only from how long it held, and strokes follow the player rules', () => {
  const random = seeded(3);
  for (let i = 0; i < 300; i++) {
    const contact = { x: -1.5 - random() * 5, y: 0.4 + random() * 2.4 };
    const held = random() < 0.5 ? null : random() * 1200;
    const stroke = agentStroke(newBrain(), newAgentRally(), contact, 1 + random() * 5, random() * 0.9, 0, held, random);
    assert.equal(stroke.type, chooseShot(stroke.intent, contact));
    assert.ok(stroke.power <= PLAYER_MAX_POWER);
    assert.ok(stroke.accuracy <= PLAYER_MAX_ACCURACY);
    if (held === null || stroke.type !== 'smash') assert.equal(stroke.power, HALF_SMASH_POWER);
  }
  const full = agentStroke(newBrain(), newAgentRally(), { x: -2, y: 2.6 }, 3, 0, 0, 700, () => 0.5);
  if (full.type === 'smash') assert.equal(full.power, PLAYER_MAX_POWER);
});

test('a stroke that keeps winning in one spot becomes the agent\'s choice there', () => {
  const brain = newBrain();
  const random = seeded(9);
  const contact = { x: -4, y: 1.3 };
  for (let i = 0; i < 40; i++) {
    const rally = newAgentRally();
    const stroke = agentStroke(brain, rally, contact, 5, 0, 0, null, random);
    recordRallyEnd(brain, rally, stroke.intent === 'soft');
  }
  let soft = 0;
  for (let i = 0; i < 200; i++) soft += Number(chooseIntent(brain, contact, 5, random) === 'soft');
  assert.ok(soft > 170, `${soft}`);
});

test('the agent waits closer to the net for a player who answers short', () => {
  const brain = newBrain();
  const rally = newAgentRally();
  rally.lastAgentShot = 'clear';
  const before = agentHome(brain, 'clear');
  for (let i = 0; i < 12; i++) recordReply(brain, rally, 'drop', 1.2);
  assert.ok(agentHome(brain, 'clear') < before - 0.6);
  assert.ok(agentInsights(brain).some((note) => note.includes('clears') && note.includes('short')));
});

test('within seven points it has measured how quickly the opponent reacts', () => {
  const slow = newBrain();
  const quick = newBrain();
  const random = seeded(4);
  for (let i = 0; i < 7; i++) {
    simulateCpuRally({ a: 'agent', b: 'easy' }, i % 2 ? 'a' : 'b', random, { a: slow });
    simulateCpuRally({ a: 'agent', b: 'olympic' }, i % 2 ? 'a' : 'b', random, { a: quick });
  }
  assert.ok(opponentModel(slow).reads >= 3 && opponentModel(quick).reads >= 3);
  assert.ok(opponentModel(slow).reactionMs > opponentModel(quick).reactionMs + 60, `${opponentModel(slow).reactionMs} vs ${opponentModel(quick).reactionMs}`);
  assert.ok(opponentModel(slow).speed < opponentModel(quick).speed, 'Easy runs slower than Olympic');
});

test('a fresh agent beats Pro and Olympic over a match', () => {
  for (const level of ['pro', 'olympic'] as const) {
    const random = seeded(level === 'pro' ? 31 : 37);
    let wins = 0;
    for (let match = 0; match < 2; match++) {
      const brain = newBrain();
      for (let i = 0; i < 21; i++) wins += Number(simulateCpuRally({ a: 'agent', b: level }, i % 2 ? 'a' : 'b', random, { a: brain }).winner === 'a');
    }
    // Well clear of an even match on both; over longer samples it wins about 87% against Pro and 80% against Olympic.
    assert.ok(wins >= (level === 'pro' ? 32 : 24), `${level}: ${wins} of 42`);
  }
});

test('Agent learns a repeated short reply after two observations, but keeps each shot and match separate', () => {
  const brain = newBrain();
  const rally = newAgentRally();
  rally.lastAgentShot = 'clear';
  recordReply(brain, rally, 'drop', 1.2);
  assert.equal(agentHome(brain, 'clear'), 2.6);
  recordReply(brain, rally, 'drop', 1.2);
  assert.ok(Math.abs(agentHome(brain, 'clear') - 2.072) < 1e-12);
  assert.equal(agentHome(brain, 'smash'), 2.6);
  assert.equal(agentHome(newBrain(), 'clear'), 2.6);
  assert.deepEqual(newBrain(), { rallies: 0, shots: {}, smash: {}, replies: {} });
  for (let i = 0; i < 80; i++) recordReply(brain, rally, 'clear', 6.5);
  assert.ok(agentHome(brain, 'clear') > 4, 'it can unlearn a short-reply habit');
});

test('Agent footwork, jumping, recovery, charging and cooldown are exactly the player mechanics', () => {
  for (const recovering of [false, true]) for (const charging of [false, true]) {
    const body = { x: 4, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: true, recoverUntil: recovering ? Infinity : 0 };
    const player = { ...body };
    const flight = createFlight({ x: 1, y: 3 }, { vx: -2, vy: 2 }, 'b', -1);
    const mind = { reactAt: 0, target: null, predictAt: 0, home: 2.6 };
    for (let i = 0; i < 240; i++) {
      const gap = mind.home - player.x;
      stepPlayerBody(player, Math.abs(gap) > 0.08 ? Math.sign(gap) : 0, -1, recovering, charging);
      stepCpuBody(body, mind, { clock: i * PLAYER_STEP * 1000, rallying: true, flight, side: 'b', direction: -1, profile: CPU_PROFILES.agent, charging });
      assert.deepEqual(body, player);
      assert.ok(Math.abs(body.vx) <= PLAYER_RUN_SPEED);
    }
    const now = 1000;
    const swing = { ...body, swingStart: now };
    assert.equal(olympicContactReady(swing, flight, -1, now + PLAYER_SWING_COOLDOWN_MS - 1), false);
  }
  for (const held of [0, 149, 300, 600, 1200]) {
    const stroke = agentStroke(newBrain(), newAgentRally(), { x: 2, y: 2.7 }, 3, 0, 0, held, () => 0.5, 'power');
    assert.equal(stroke.power, chargePower(held));
    assert.ok(stroke.accuracy <= PLAYER_MAX_ACCURACY);
  }
});

test('seeded Agent matches and learning are deterministic', () => {
  const play = () => {
    const brain = newBrain();
    const random = seeded(123);
    const outcomes = Array.from({ length: 8 }, (_, i) => simulateCpuRally({ a: 'agent', b: 'pro' }, i % 2 ? 'a' : 'b', random, { a: brain }));
    return { outcomes, brain };
  };
  assert.deepEqual(play(), play());
});

test('Agent retains baseline confidence and home bounds for sparse, mixed and established habits', () => {
  for (const n of [0, 1, 2, 3, 20, 400]) for (const depth of [0, 1.2, 3.6, 6.5, 7]) {
    const brain = newBrain();
    brain.replies.clear = { n, depth, short: n / 2, fast: 0, deep: n / 2 };
    const expected = n < 2 ? 2.6 : Math.max(1.7, Math.min(4.3, 2.6 + (depth - 3.6) * 0.55 * (n / (n + 3))));
    assert.equal(agentHome(brain, 'clear'), expected);
    assert.equal(agentHome(brain, 'drop'), 2.6);
  }
});

test('restored Agent preserves seeded baseline results and learning against the repetitive net trap', () => {
  const baselineHome = (brain: AgentBrain, played: Parameters<typeof agentHome>[1]) => {
    const habit = brain.replies[played];
    if (!habit || habit.n < 2) return 2.6;
    return Math.max(1.7, Math.min(4.3, 2.6 + (habit.depth - 3.6) * 0.55 * habit.n / (habit.n + 3)));
  };
  const play = (home: typeof agentHome) => {
    const random = seeded(1701);
    let wins = 0, early = 0, late = 0, resolved = 0;
    for (let match = 0; match < 20; match++) {
      const brain = newBrain();
      for (let point = 0; point < 20; point++) {
        const outcome = humanRally('net trap', random, brain, undefined, home);
        if (outcome.won === null) { point--; continue; }
        resolved++;
        wins += Number(outcome.won);
        if (point < 5) early += Number(outcome.won);
        if (point >= 15) late += Number(outcome.won);
      }
    }
    return { wins, early, late, resolved };
  };
  const before = play(baselineHome), after = play(agentHome);
  console.log('Agent net-trap human wins, baseline/restored:', before, after);
  assert.deepEqual(after, before);
  assert.ok(after.late < after.early);
});
