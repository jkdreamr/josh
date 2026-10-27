import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { crowdMood, cueMemory, detectCues, Commentary, SoccerSound, type Cue } from '../src/os/arcade/games/soccer/audio.ts';
import { createWorld, FIELD, STEP, stepWorld, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';

function aiWorld(seed: number) {
  const world = createWorld(seed, 60);
  for (const player of world.players) {
    player.human = false;
    player.controlled = false;
  }
  return world;
}

function aiCommands(world: World, tick: number) {
  const commands = new Map<number, Command>();
  for (const team of [0, 1] as const) {
    for (const [id, command] of computeAI(world, 'normal', STEP, tick, team)) commands.set(id, command);
  }
  return commands;
}

function liveWorld(seed = 47) {
  const world = createWorld(seed, 60);
  world.phase = 'live';
  world.restart = null;
  return world;
}

test('AI match audio catches both kickoffs, half time, full time and kicks', () => {
  const world = aiWorld(47);
  const sound = new SoccerSound();
  sound.reset(world);
  const counts: Record<string, number> = {};
  let firstKickoff = false;
  let secondKickoff = false;

  for (let tick = 1; tick <= 12000 && world.phase !== 'full-time'; tick++) {
    stepWorld(world, STEP, aiCommands(world, tick));
    const cues = sound.observe(world, tick * STEP);
    sound.frame(world, tick * STEP);
    const shortWhistle = cues.some((cue) => cue.kind === 'whistle' && cue.pattern === 'short');
    for (const cue of cues) {
      counts[cue.kind] = (counts[cue.kind] ?? 0) + 1;
      if (cue.kind === 'whistle' && cue.pattern === 'short') counts['whistle:short'] = (counts['whistle:short'] ?? 0) + 1;
      if (cue.kind === 'whistle' && cue.pattern === 'double') counts['whistle:double'] = (counts['whistle:double'] ?? 0) + 1;
      if (cue.kind === 'whistle' && cue.pattern === 'final') counts['whistle:final'] = (counts['whistle:final'] ?? 0) + 1;
      if (cue.kind === 'kickoff') {
        firstKickoff ||= cue.first && shortWhistle;
        secondKickoff ||= cue.second && shortWhistle;
      }
    }
  }

  sound.dispose();
  assert.equal(world.phase, 'full-time');
  assert.ok(firstKickoff, 'first kickoff cue');
  assert.ok(secondKickoff, 'second-half kickoff cue');
  assert.ok((counts['whistle:short'] ?? 0) >= 2, `short whistles: ${counts['whistle:short'] ?? 0}`);
  assert.ok((counts['whistle:double'] ?? 0) >= 1, 'half-time double whistle');
  assert.ok((counts['whistle:final'] ?? 0) >= 1, 'full-time final whistle');
  assert.ok((counts.kick ?? 0) > 0, 'kick cues');
  console.log(`soccer audio match cues: ${JSON.stringify(counts)}`);
});

test('audio observation and crowd frames leave the deterministic world unchanged', () => {
  const observed = aiWorld(103);
  const untouched = aiWorld(103);
  const sound = new SoccerSound();
  sound.reset(observed);
  for (let tick = 1; tick <= 360; tick++) {
    const commands = aiCommands(observed, tick);
    stepWorld(observed, STEP, commands);
    stepWorld(untouched, STEP, aiCommands(untouched, tick));
    sound.observe(observed, tick * STEP);
    sound.frame(observed, tick * STEP);
  }
  sound.dispose();
  assert.equal(JSON.stringify(observed), JSON.stringify(untouched));
});

test('detects goals, fouls, both kinds of woodwork and fast wide misses', () => {
  const beforeGoal = liveWorld();
  const goal = structuredClone(beforeGoal);
  goal.phase = 'goal';
  goal.score[0] = 1;
  const goalCues = detectCues(cueMemory(beforeGoal), goal, 1).cues;
  assert.ok(goalCues.some((cue) => cue.kind === 'goal' && cue.team === 0));
  assert.ok(goalCues.some((cue) => cue.kind === 'net'));

  const beforeFoul = liveWorld();
  const foul = structuredClone(beforeFoul);
  foul.phase = 'restart';
  foul.restart = 'free-kick';
  foul.restartTeam = 1;
  foul.event = 'foul';
  const foulCues = detectCues(cueMemory(beforeFoul), foul, 1).cues;
  assert.ok(foulCues.some((cue) => cue.kind === 'foul' && cue.team === 1 && !cue.penalty));
  assert.ok(foulCues.some((cue) => cue.kind === 'whistle' && cue.pattern === 'long'));

  const woodwork = (z: number) => {
    const before = liveWorld();
    before.ball.x = FIELD.length / 2 - 0.8;
    before.ball.z = z;
    before.ball.y = 1;
    before.ball.vx = 16;
    const after = structuredClone(before);
    after.ball.x = FIELD.length / 2 - 0.2;
    after.ball.vx = -11;
    return detectCues(cueMemory(before), after, 1).cues;
  };
  assert.ok(woodwork(0).some((cue) => cue.kind === 'bar'));
  assert.ok(woodwork(FIELD.goalWidth / 2).some((cue) => cue.kind === 'post'));

  const wideShot = liveWorld();
  wideShot.ball.x = FIELD.length / 2 - 0.2;
  wideShot.ball.z = FIELD.goalWidth / 2 + 2;
  wideShot.ball.vx = 15;
  const wideOut = structuredClone(wideShot);
  wideOut.phase = 'restart';
  wideOut.restart = 'goal-kick';
  wideOut.restartTeam = 1;
  assert.ok(detectCues(cueMemory(wideShot), wideOut, 1).cues.some((cue) => cue.kind === 'near-miss'));
});

test('commentary throttles small moments but lets goals cut in', () => {
  const commentary = new Commentary(3.5);
  const corner: Cue = { kind: 'corner', team: 0 };
  assert.ok(commentary.next(corner, 0));
  assert.equal(commentary.next(corner, 1), null);
  assert.ok(commentary.next({ kind: 'goal', team: 0, score: [1, 0] }, 1.2));
  assert.ok(commentary.next(corner, 11));
});

test('crowd favors the home attack and is quiet outside live play', () => {
  const homeAttack = liveWorld();
  homeAttack.ball.x = FIELD.length / 2 - 4;
  homeAttack.carrierId = 6;
  homeAttack.lastTouch = 0;
  const awayAttack = liveWorld();
  awayAttack.ball.x = -FIELD.length / 2 + 4;
  awayAttack.carrierId = 17;
  awayAttack.lastTouch = 1;
  assert.ok(crowdMood(homeAttack).level > crowdMood(awayAttack).level);
  homeAttack.phase = 'restart';
  assert.equal(crowdMood(homeAttack).level, 0);
});

test('SoccerSound constructs, observes, frames, unlocks and disposes under Node', () => {
  const sound = new SoccerSound();
  const world = liveWorld();
  sound.reset(world);
  assert.doesNotThrow(() => {
    sound.unlock();
    sound.observe(world, 0);
    sound.frame(world, 0);
    sound.dispose();
  });
});
