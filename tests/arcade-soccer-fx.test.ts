import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { FIELD, STEP, createWorld, stepWorld, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { createFxDirector, phoneFx, type FxKind } from '../src/os/arcade/games/soccer/fx.ts';

const freshWorld = () => {
  const world = createWorld(9142, 120, 2);
  world.phase = 'live';
  world.restart = null;
  world.eventTime = 0;
  world.players.forEach((player) => {
    player.human = false;
    player.controlled = false;
  });
  world.controlled = [-1, -1];
  return world;
};

const observeKick = (action: 'shoot' | 'finesse' | 'through', power = 0.9, playerId = 7) => {
  const world = freshWorld();
  const fx = createFxDirector();
  fx.observe(world, 0);
  world.kickEvent = { playerId, action, power, time: STEP };
  fx.observe(world, STEP);
  return { fx, world };
};

const drainKinds = (fx: ReturnType<typeof createFxDirector>) => {
  const kinds: FxKind[] = [];
  fx.drain((event) => kinds.push(event.kind));
  return kinds;
};

test('seeded CPU matches stay identical with the FX director observing and rendering', () => {
  const simulate = (withFx: boolean) => {
    const world = freshWorld();
    const fx = withFx ? createFxDirector() : null;
    const perTeam = [new Map<number, Command>(), new Map<number, Command>()];
    const commands = new Map<number, Command>();
    for (let tick = 0; tick < 3600; tick++) {
      commands.clear();
      for (const team of [0, 1] as const) {
        for (const [id, command] of computeAI(world, 'normal', STEP, tick, team, perTeam[team])) commands.set(id, command);
      }
      stepWorld(world, STEP, commands);
      if (fx) {
        const simTime = (tick + 1) * STEP;
        fx.observe(world, simTime);
        fx.tick(STEP);
        fx.renderWorld(world);
      }
    }
    return JSON.parse(JSON.stringify(world));
  };
  assert.deepStrictEqual(simulate(true), simulate(false));
});

test('power shots arm hit-stop, shake and FOV punch while low-power shots do not', () => {
  const high = observeKick('shoot', 0.92);
  high.fx.tick(0.01);
  assert.equal(high.fx.timeScale, 0.12);
  assert.ok(high.fx.shake > 0);
  assert.ok(high.fx.punch < 0);
  assert.ok(drainKinds(high.fx).includes('shot'));
  high.fx.tick(0.6);
  assert.equal(high.fx.timeScale, 1);
  assert.ok(high.fx.shake < 1e-3);
  assert.equal(high.fx.punch, 0);

  const low = observeKick('shoot', 0.6);
  low.fx.tick(0.01);
  assert.equal(low.fx.timeScale, 1);
  assert.equal(low.fx.shake, 0);
  assert.equal(low.fx.punch, 0);
});

test('finesse captures spin, volleys are recognized, and through balls nudge attack-ward', () => {
  const finesseWorld = freshWorld();
  const finesseFx = createFxDirector();
  finesseWorld.ball.spin = 1.2;
  finesseFx.observe(finesseWorld, 0);
  finesseWorld.kickEvent = { playerId: 7, action: 'finesse', power: 0.84, time: STEP };
  finesseFx.observe(finesseWorld, STEP);
  let spin = 0;
  finesseFx.drain((event) => { if (event.kind === 'finesse') spin = event.spin; });
  assert.equal(spin, 1.2);

  const volleyWorld = freshWorld();
  const volleyFx = createFxDirector();
  volleyWorld.ball.y = 1;
  volleyFx.observe(volleyWorld, 0);
  volleyWorld.kickEvent = { playerId: 7, action: 'shoot', power: 0.8, time: STEP };
  volleyFx.observe(volleyWorld, STEP);
  assert.ok(drainKinds(volleyFx).includes('volley'));

  const through = observeKick('through');
  through.fx.tick(0.3);
  assert.ok(through.fx.nudgeX > 0);

  const reversed = freshWorld();
  reversed.endsSwapped = true;
  const reversedFx = createFxDirector();
  reversedFx.observe(reversed, 0);
  reversed.kickEvent = { playerId: 7, action: 'through', power: 0.9, time: STEP };
  reversedFx.observe(reversed, STEP);
  reversedFx.tick(0.3);
  assert.ok(reversedFx.nudgeX < 0);

  const pass = freshWorld();
  const passFx = createFxDirector();
  passFx.observe(pass, 0);
  pass.kickEvent = { playerId: 7, action: 'lob', power: 0.82, time: STEP };
  passFx.observe(pass, STEP);
  assert.ok(drainKinds(passFx).includes('touch'));
});

test('slides, slide dust, tackles, keeper saves, post bounces, and heavy touches are detected', () => {
  const world = freshWorld();
  const fx = createFxDirector();
  const player = world.players[0]!;
  fx.observe(world, 0);
  player.action = 'slide';
  player.slide = { x: 1, z: 0, t: 0, won: false };
  fx.observe(world, 0.01);
  assert.ok(drainKinds(fx).includes('slide'));
  fx.observe(world, 0.08);
  assert.ok(drainKinds(fx).includes('slide-dust'));
  player.slide.won = true;
  fx.observe(world, 0.09);
  assert.ok(drainKinds(fx).includes('tackle'));
  player.action = 'tackle';
  fx.observe(world, 0.1);
  assert.ok(drainKinds(fx).includes('tackle'));

  world.event = 'keeper parries';
  fx.observe(world, 0.12);
  assert.ok(drainKinds(fx).includes('save'));

  const claimWorld = freshWorld();
  const claimFx = createFxDirector();
  claimWorld.ball.vx = 13;
  claimFx.observe(claimWorld, 0);
  claimWorld.event = 'keeper claims it';
  claimFx.observe(claimWorld, STEP);
  let weakSavePower = 0;
  claimFx.drain((event) => { if (event.kind === 'save') weakSavePower = event.power; });
  assert.equal(weakSavePower, 0.5);

  const postWorld = freshWorld();
  const postFx = createFxDirector();
  postWorld.ball.x = FIELD.length / 2 - 0.2;
  postWorld.ball.z = FIELD.goalWidth / 2;
  postWorld.ball.vx = 8;
  postFx.observe(postWorld, 0);
  postWorld.ball.x += 0.1;
  postWorld.ball.vx = -7;
  postFx.observe(postWorld, STEP);
  assert.ok(drainKinds(postFx).includes('post'));

  const touchWorld = freshWorld();
  const touchFx = createFxDirector();
  touchWorld.players[0]!.x = 0;
  touchWorld.players[0]!.z = 0;
  touchFx.observe(touchWorld, 0);
  touchWorld.ball.vx = 6;
  touchFx.observe(touchWorld, 0.1);
  assert.ok(drainKinds(touchFx).includes('touch'));
  touchWorld.ball.vx = 0;
  touchFx.observe(touchWorld, 0.2);
  assert.deepEqual(drainKinds(touchFx), []);
  touchWorld.ball.vx = 6;
  touchFx.observe(touchWorld, 0.4);
  assert.ok(drainKinds(touchFx).includes('touch'));
});

test('goals arm a single impact and replay progress is monotonic', () => {
  const world = freshWorld();
  const fx = createFxDirector();
  fx.observe(world, 0);
  world.score[0] = 1;
  world.ball.x = FIELD.length / 2;
  fx.observe(world, STEP);
  assert.equal(fx.goalPending, true);
  assert.equal(fx.replayProgress(0), 0);
  assert.ok(fx.replayProgress(0.3) < fx.replayProgress(0.7));
  let prior = 0;
  for (let i = 0; i <= 200; i++) {
    const progress = fx.replayProgress(i / 200);
    assert.ok(progress >= prior);
    prior = progress;
  }
  assert.equal(fx.replayProgress(0.88), 1);
  assert.equal(fx.replayProgress(1), 1);
  assert.equal(fx.goalPending, false);
  assert.ok(drainKinds(fx).includes('goal-impact'));
});

test('reduced motion removes gameplay envelopes and bypasses render interpolation', () => {
  const { fx, world } = observeKick('shoot', 1);
  fx.setReducedMotion(true);
  fx.tick(0.02);
  assert.equal(fx.timeScale, 1);
  assert.equal(fx.shake, 0);
  assert.equal(fx.punch, 0);
  assert.equal(fx.animScale, 1);
  assert.equal(fx.renderWorld(world), world);
  assert.equal(fx.replayProgress(0.44), 0.5);

  const throughWorld = freshWorld();
  const throughFx = createFxDirector();
  throughFx.observe(throughWorld, 0);
  throughWorld.kickEvent = { playerId: 7, action: 'through', power: 0.9, time: STEP };
  throughFx.observe(throughWorld, STEP);
  throughFx.tick(0.1);
  assert.ok(throughFx.nudgeX > 0);
  throughFx.setReducedMotion(true);
  throughFx.tick(0.3);
  assert.equal(throughFx.nudgeX, 0);
  throughFx.setReducedMotion(false);
  throughFx.tick(0.01);
  assert.equal(throughFx.nudgeX, 0);

  const reducedGoal = createFxDirector({ reducedMotion: true });
  const goalWorld = freshWorld();
  reducedGoal.observe(goalWorld, 0);
  goalWorld.score[1] = 1;
  reducedGoal.observe(goalWorld, STEP);
  reducedGoal.replayProgress(1);
  assert.equal(reducedGoal.timeScale, 1);
  assert.equal(reducedGoal.shake, 0);
});

test('render-world interpolation reuses one pooled World and its entity containers', () => {
  const fx = createFxDirector();
  const world = freshWorld();
  assert.equal(fx.renderWorld(world), world);
  fx.observe(world, 0);
  world.ball.x = 1;
  fx.observe(world, STEP);
  fx.trigger('power-shot', world, STEP);
  fx.tick(STEP);
  world.ball.x = 2;
  fx.observe(world, 2 * STEP);
  const rendered = fx.renderWorld(world);
  assert.notEqual(rendered, world);
  assert.notEqual(rendered.ball, world.ball);
  assert.notEqual(rendered.players, world.players);
  assert.ok(rendered.ball.x >= 0 && rendered.ball.x <= 1 && rendered.ball.x < world.ball.x);
  assert.equal(rendered.phase, world.phase);
  assert.equal(rendered.score, world.score);
  fx.tick(STEP);
  world.ball.x = 3;
  fx.observe(world, 3 * STEP);
  assert.equal(fx.renderWorld(world), rendered);
});

test('phone feedback reports score changes and deduplicates shot kick events', () => {
  const world = freshWorld();
  assert.equal(phoneFx([0, 0], null, world, 0), null);
  world.kickEvent = { playerId: 7, action: 'shoot', power: 0.8, time: STEP };
  const key = `${world.kickEvent.playerId}:${world.kickEvent.time}:${world.kickEvent.action}`;
  assert.equal(phoneFx([0, 0], null, world, 0), 'shot');
  assert.equal(phoneFx([0, 0], key, world, 0), null);
  world.score[0] = 1;
  assert.equal(phoneFx([0, 0], key, world, 0), 'goal-for');
  world.score[0] = 0;
  world.score[1] = 1;
  assert.equal(phoneFx([0, 0], key, world, 0), 'goal-against');
});

test('phone feedback reports a shot delivered in a later snapshot only once', () => {
  const initialSnapshot = freshWorld();
  const laterSnapshot = freshWorld();
  laterSnapshot.kickEvent = { playerId: 7, action: 'shoot', power: 0.8, time: STEP };
  const key = `${laterSnapshot.kickEvent.playerId}:${laterSnapshot.kickEvent.time}:${laterSnapshot.kickEvent.action}`;

  assert.equal(phoneFx([0, 0], null, initialSnapshot, 0), null);
  assert.equal(phoneFx([0, 0], null, laterSnapshot, 0), 'shot');
  assert.equal(phoneFx([0, 0], key, laterSnapshot, 0), null);
});

test('FX observation never mutates world snapshots', () => {
  const world: World = freshWorld();
  const before = JSON.parse(JSON.stringify(world));
  const fx = createFxDirector();
  fx.observe(world, 0);
  fx.tick(STEP);
  fx.renderWorld(world);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(world)), before);
});
