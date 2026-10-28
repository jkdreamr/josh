import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFxDirector } from '../src/os/arcade/games/soccer/fx.ts';
import { carryEdge } from '../src/os/arcade/games/soccer/input.ts';
import { createWorld, STEP, stepWorld, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';

function setupPassWorld(humans: 1 | 2, passerId: number, receiverId: number) {
  const world = createWorld(113, 120, humans);
  world.phase = 'live';
  world.restart = null;
  world.eventTime = 0;
  for (const player of world.players) {
    const index = player.id % 11;
    player.x = player.team === 0 ? -32 - index : 32 + index;
    player.z = -18 + index * 3.6;
    player.vx = 0;
    player.vz = 0;
    player.cooldown = 0;
    player.touchCd = 0;
    player.action = 'idle';
  }
  const passer = world.players[passerId]!;
  const receiver = world.players[receiverId]!;
  passer.x = -10;
  passer.z = 0;
  receiver.x = 0;
  receiver.z = 0;
  world.ball.x = passer.x;
  world.ball.y = 0.11;
  world.ball.z = passer.z;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.ball.vz = 0;
  world.ball.grounded = true;
  return { world, passer, receiver };
}

function command(action: Command['action'], overrides: Partial<Command> = {}): Command {
  return {
    move: { x: 1, z: 0 },
    aim: { x: 1, z: 0 },
    action,
    pressed: true,
    power: 0.45,
    ...overrides,
  };
}

function assertSingleControl(world: World, team: 0 | 1, expectedHumans: number) {
  const players = world.players.filter((player) => player.team === team);
  assert.equal(players.filter((player) => player.human).length, expectedHumans);
  assert.ok(players.every((player) => !player.human || player.controlled));
  assert.ok(world.players.every((player) => !player.controlled || player.human));
  assert.equal(world.players[world.controlled[team]]?.human, true);
}

function stepUntilPassArrives(world: World, receiverId: number, expectedHumans: number) {
  let steps = 0;
  while (world.passTarget === receiverId && steps < 240) {
    stepWorld(world, STEP);
    steps++;
    assertSingleControl(world, 0, expectedHumans);
  }
  assert.ok(steps < 240, 'the pass should reach its receiver within 240 steps');
  assert.equal(world.passTarget, null);
  assert.equal(world.carrierId, receiverId);
}

function freshFxWorld(): World {
  const world = createWorld(9142, 120, 2);
  world.phase = 'live';
  world.restart = null;
  world.eventTime = 0;
  for (const player of world.players) {
    player.human = false;
    player.controlled = false;
  }
  world.controlled = [-1, -1];
  return world;
}

test('a pressed pass or shot moves the ball and emits its kick event in one step', () => {
  for (const action of ['pass', 'shoot'] as const) {
    const { world, passer } = setupPassWorld(1, 6, 7);
    const before = { x: world.ball.x, z: world.ball.z };

    stepWorld(world, STEP, new Map([[passer.id, command(action)]]));

    assert.ok(Math.hypot(world.ball.x - before.x, world.ball.z - before.z) > 0.05, action);
    assert.ok(Math.hypot(world.ball.vx, world.ball.vz) > 0, action);
    assert.equal(world.kickEvent?.action, action);
    assert.equal(world.kickEvent?.playerId, passer.id);
  }
});

test('pass control transfers on the strike while preserving single-player and co-op seats', () => {
  const single = setupPassWorld(1, 6, 7);
  stepWorld(single.world, STEP, new Map([[single.passer.id, command('pass')]]));
  assert.equal(single.world.controlled[0], single.receiver.id);
  assert.equal(single.receiver.human, true);
  assert.equal(single.passer.human, false);

  const coopCpuPass = setupPassWorld(2, 9, 7);
  stepWorld(coopCpuPass.world, STEP, new Map([[coopCpuPass.passer.id, command('pass')]]));
  assert.equal(coopCpuPass.world.controlled[0], 6);
  assert.equal(coopCpuPass.receiver.human, true);
  assert.equal(coopCpuPass.passer.human, false);
  assert.equal(coopCpuPass.world.players[6]!.human, true);

  const coopHumanPass = setupPassWorld(2, 9, 6);
  stepWorld(coopHumanPass.world, STEP, new Map([[coopHumanPass.passer.id, command('pass')]]));
  assert.equal(coopHumanPass.world.controlled[0], 6);
  assert.equal(coopHumanPass.world.controlled[1], 17);
  assert.equal(coopHumanPass.receiver.human, true);
  assert.equal(coopHumanPass.passer.human, true);
});

test('a single-player switchNearest during a pass flight remains in control at arrival', () => {
  const { world, passer, receiver } = setupPassWorld(1, 6, 7);
  stepWorld(world, STEP, new Map([[passer.id, command('pass')]]));
  assertSingleControl(world, 0, 1);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);

  stepWorld(world, STEP, new Map([[receiver.id, command(null, { pressed: false, switchNearest: true })]]));
  assertSingleControl(world, 0, 1);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);
  const switchedTo = world.controlled[0];
  assert.notEqual(switchedTo, receiver.id);

  stepUntilPassArrives(world, receiver.id, 1);

  assert.equal(world.controlled[0], switchedTo);
  assert.equal(world.players[switchedTo]!.human, true);
  assert.equal(receiver.human, false);
});

test('a single-player direct switch during a pass flight remains in control at arrival', () => {
  const { world, passer, receiver } = setupPassWorld(1, 6, 7);
  stepWorld(world, STEP, new Map([[passer.id, command('pass')]]));
  assertSingleControl(world, 0, 1);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);

  stepWorld(world, STEP, new Map([[receiver.id, command(null, {
    pressed: false,
    switchDir: { x: -1, z: 0 },
  })]]));
  assertSingleControl(world, 0, 1);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);
  const switchedTo = world.controlled[0];
  assert.notEqual(switchedTo, receiver.id);

  stepUntilPassArrives(world, receiver.id, 1);

  assert.equal(world.controlled[0], switchedTo);
  assert.equal(world.players[switchedTo]!.human, true);
  assert.equal(receiver.human, false);
});

test('a co-op first-player switch during the second player pass flight preserves both humans', () => {
  const { world, passer, receiver } = setupPassWorld(2, 9, 7);
  const firstHuman = world.players[world.controlled[0]]!;
  assert.notEqual(passer.id, firstHuman.id);
  assertSingleControl(world, 0, 2);

  stepWorld(world, STEP, new Map([[passer.id, command('pass')]]));
  assertSingleControl(world, 0, 2);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);

  stepWorld(world, STEP, new Map([[firstHuman.id, command(null, { pressed: false, switchNearest: true })]]));
  assertSingleControl(world, 0, 2);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);
  const switchedTo = world.controlled[0];
  assert.notEqual(switchedTo, firstHuman.id);
  assert.notEqual(switchedTo, receiver.id);

  stepUntilPassArrives(world, receiver.id, 2);

  assert.equal(world.controlled[0], switchedTo);
  assert.equal(world.players[switchedTo]!.human, true);
});

test('without a switch, the pass receiver remains the single controlled human at arrival', () => {
  const { world, passer, receiver } = setupPassWorld(1, 6, 7);
  stepWorld(world, STEP, new Map([[passer.id, command('pass')]]));
  assertSingleControl(world, 0, 1);
  assert.equal(world.controlled[0], receiver.id);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.carrierId, null);

  stepUntilPassArrives(world, receiver.id, 1);

  assert.equal(world.controlled[0], receiver.id);
  assert.equal(receiver.human, true);
});

test('a receiver tap-pass buffers a first-time pass without switching away', () => {
  const { world, passer, receiver } = setupPassWorld(1, 6, 7);
  stepWorld(world, STEP, new Map([[passer.id, command('pass')]]));
  assert.equal(world.controlled[0], receiver.id);
  world.ball.x = -1.15;
  world.ball.z = receiver.z;
  world.ball.vx = 20;
  world.ball.vz = 0;
  world.ball.grounded = true;
  world.passTarget = receiver.id;
  world.passFrom = passer.id;
  world.passControl = true;
  world.passPoint = { x: receiver.x, z: receiver.z };

  stepWorld(world, STEP, new Map([[receiver.id, command('pass', { power: 0.2 })]]));

  assert.equal(world.controlled[0], receiver.id);
  assert.equal(receiver.buffer?.action, 'pass');
  assert.ok(world.ball.x > -1.15);

  let firstTimeKick = false;
  for (let i = 0; i < 5 && !firstTimeKick; i++) {
    stepWorld(world, STEP);
    firstTimeKick = world.kickEvent?.playerId === receiver.id && world.kickEvent.action === 'pass';
  }
  assert.equal(firstTimeKick, true);
  assert.ok(world.ball.vx > 0);
});

test('FX following renders the current world directly without a one-frame delay', () => {
  const world = freshFxWorld();
  const fx = createFxDirector();
  fx.observe(world, 0);
  fx.tick(STEP);
  world.ball.x += 1;
  fx.observe(world, STEP);

  assert.equal(fx.renderWorld(world), world);
});

test('passes, lobs, through balls, switches, tackles, and keeper claims do not arm hitstop', () => {
  const actions = [
    ['pass', 0.3],
    ['pass', 0.9],
    ['lob', 0.9],
    ['through', 0.9],
  ] as const;
  for (const [action, power] of actions) {
    const world = freshFxWorld();
    const fx = createFxDirector();
    fx.observe(world, 0);
    world.kickEvent = { playerId: 7, action, power, time: STEP };
    fx.observe(world, STEP);
    fx.tick(STEP);
    assert.equal(fx.timeScale, 1, action);
    assert.equal(fx.animScale, 1, action);
  }

  const switched = freshFxWorld();
  const switchFx = createFxDirector();
  switchFx.observe(switched, 0);
  switched.controlled[0] = 7;
  switchFx.observe(switched, STEP);
  switchFx.tick(STEP);
  assert.equal(switchFx.timeScale, 1);
  assert.equal(switchFx.animScale, 1);

  const tackle = freshFxWorld();
  const tackleFx = createFxDirector();
  tackleFx.observe(tackle, 0);
  tackle.players[7]!.action = 'tackle';
  tackleFx.observe(tackle, STEP);
  tackleFx.tick(STEP);
  assert.equal(tackleFx.timeScale, 1);
  assert.equal(tackleFx.animScale, 1);

  const claim = freshFxWorld();
  const claimFx = createFxDirector();
  claim.ball.vx = 13;
  claimFx.observe(claim, 0);
  claim.event = 'keeper claims it';
  claimFx.observe(claim, STEP);
  claimFx.tick(STEP);
  assert.equal(claimFx.timeScale, 1);
  assert.equal(claimFx.animScale, 1);
});

test('power shots still arm hitstop', () => {
  const world = freshFxWorld();
  const fx = createFxDirector();
  fx.observe(world, 0);
  world.kickEvent = { playerId: 7, action: 'shoot', power: 0.9, time: STEP };
  fx.observe(world, STEP);
  fx.tick(STEP);

  assert.ok(fx.timeScale < 1);
  assert.ok(fx.animScale < 1);
});

test('carryEdge preserves unapplied edges unless the next command has its own', () => {
  const next = command(null, { action: null, pressed: false, switchNearest: false, switchDir: null });
  const passEdge = command('pass', { power: 0.7, aim: { x: 0, z: -1 }, switchNearest: false, switchDir: null });
  const carriedPass = carryEdge(passEdge, next);
  assert.equal(carriedPass.action, 'pass');
  assert.equal(carriedPass.pressed, true);
  assert.equal(carriedPass.power, 0.7);
  assert.deepEqual(carriedPass.aim, { x: 0, z: -1 });

  const switchEdge = command(null, { action: null, pressed: false, switchNearest: true, switchDir: { x: -1, z: 0 } });
  const carriedSwitch = carryEdge(switchEdge, next);
  assert.equal(carriedSwitch.switchNearest, true);
  assert.deepEqual(carriedSwitch.switchDir, { x: -1, z: 0 });

  const ownEdge = command('shoot', { power: 0.4 });
  assert.equal(carryEdge(passEdge, ownEdge), ownEdge);
  assert.deepEqual(carryEdge(switchEdge, command(null, { switchDir: { x: 1, z: 0 } })).switchDir, { x: 1, z: 0 });
});

test('goal impact, volleys, strong parries, and posts retain hitstop', () => {
  const goal = freshFxWorld();
  const goalFx = createFxDirector();
  goalFx.observe(goal, 0);
  goal.score[0] = 1;
  goalFx.observe(goal, STEP);
  goalFx.goalImpact();
  goalFx.tick(STEP);
  assert.ok(goalFx.timeScale < 1);

  const volley = freshFxWorld();
  volley.ball.y = 1;
  const volleyFx = createFxDirector();
  volleyFx.observe(volley, 0);
  volley.kickEvent = { playerId: 7, action: 'shoot', power: 0.6, time: STEP };
  volleyFx.observe(volley, STEP);
  volleyFx.tick(STEP);
  assert.ok(volleyFx.timeScale < 1);

  const parry = freshFxWorld();
  const parryFx = createFxDirector();
  parryFx.observe(parry, 0);
  parry.event = 'keeper parries';
  parryFx.observe(parry, STEP);
  parryFx.tick(STEP);
  assert.ok(parryFx.timeScale < 1);

  const post = freshFxWorld();
  post.ball.x = 52;
  post.ball.z = 3.4;
  post.ball.vx = 8;
  const postFx = createFxDirector();
  postFx.observe(post, 0);
  post.ball.x += 0.1;
  post.ball.vx = -7;
  postFx.observe(post, STEP);
  postFx.tick(STEP);
  assert.ok(postFx.timeScale < 1);
});
