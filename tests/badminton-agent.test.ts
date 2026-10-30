import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseShot, CPU_PROFILES, HALF_SMASH_POWER, parseDifficulty, PLAYER_MAX_ACCURACY, PLAYER_MAX_POWER, PLAYER_RUN_SPEED } from '../src/os/games/badminton.ts';
import { agentHome, agentInsights, agentStroke, chooseIntent, newAgentRally, newBrain, opponentModel, recordRallyEnd, recordReply } from '../src/os/games/badminton-agent.ts';
import { simulateCpuRally } from '../src/os/games/badminton-cpu.ts';

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
