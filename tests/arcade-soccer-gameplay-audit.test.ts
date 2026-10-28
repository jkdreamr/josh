import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, KEEPER_MAX_HOLD } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, FIELD, nearestCarrier, resolveKeeperContact, stepWorld, TEAM_SIZE, teamDir, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';

function liveWorld() {
  const world = createWorld(4242);
  for (const p of world.players) { p.human = false; p.controlled = false; }
  world.phase = 'live'; world.restart = null; world.event = ''; world.eventTime = 0;
  world.carrierId = null; world.passTarget = null; world.lastToucherId = null;
  return world;
}

function commandsFor(world: World, tick: number) {
  const commands = new Map<number, Command>();
  for (const team of [0, 1] as const) for (const [id, c] of computeAI(world, 'normal', 1 / 60, tick, team)) commands.set(id, c);
  return commands;
}

test('a loose-ball chaser is not pushed off the ball by teammate spacing', () => {
  const world = liveWorld();
  world.ball.x = 20; world.ball.z = -12; world.ball.y = 0.11; world.ball.vx = world.ball.vy = world.ball.vz = 0; world.ball.grounded = true;
  world.players.filter((p) => p.slot !== 'GK').forEach((p, i) => { p.x = p.team === 0 ? -35 : -25; p.z = -30 + (i % 11) * 6; p.vx = p.vz = 0; });
  const chaser = world.players[TEAM_SIZE + 5]!, mate = world.players[TEAM_SIZE + 6]!;
  chaser.x = 19.27; chaser.z = -12; mate.x = 21.27; mate.z = -12;
  const move = commandsFor(world, 0).get(chaser.id)!.move;
  assert.ok(Math.hypot(move.x, move.z) >= 0.08, `chase input ${JSON.stringify(move)} is inside the deadzone`);
  assert.ok(move.x > 0, `chaser should move toward the ball, got ${JSON.stringify(move)}`);
  let tick = 0;
  while (!nearestCarrier(world) && tick < 120) { stepWorld(world, 1 / 60, commandsFor(world, tick)); tick++; }
  assert.equal(nearestCarrier(world)?.team, 1, `ball still loose after ${tick} ticks`);
});

test('a keeper with no short option holds briefly, then launches a long clearance instead of holding forever', () => {
  const world = liveWorld();
  const dir = teamDir(0, world.endsSwapped);
  const keeper = world.players[0]!;
  keeper.x = -dir * (FIELD.length / 2 - 3); keeper.z = 0;
  world.players.filter((p) => p.team === 0 && p.slot !== 'GK').forEach((p, i) => { p.x = -dir * 2; p.z = -30 + i * 6; });
  world.ball.x = keeper.x + dir * 0.3; world.ball.z = 0; world.ball.y = 0.11; world.ball.vx = world.ball.vy = world.ball.vz = 0;
  world.carrierId = keeper.id; world.lastTouch = 0; world.lastToucherId = keeper.id;
  let tick = 0, command: Command | undefined;
  for (; tick < 6 * 60; tick++) {
    command = computeAI(world, 'normal', 1 / 60, tick, 0).get(keeper.id)!;
    if (command.action) break;
    stepWorld(world, 1 / 60, new Map([[keeper.id, command]]));
    assert.equal(nearestCarrier(world)?.id, keeper.id, 'keeper keeps the ball while waiting');
  }
  assert.ok(tick >= KEEPER_MAX_HOLD * 60 - 1 && tick < 6 * 60, `keeper released after ${tick} ticks`);
  assert.equal(command!.action, 'lob');
  assert.ok(command!.aim!.x * dir > 0, 'clearance goes upfield');
  stepWorld(world, 1 / 60, new Map([[keeper.id, command!]]));
  assert.ok(world.ball.vx * dir > 5 && world.ball.vy > 0, `ball was not cleared: ${JSON.stringify(world.ball)}`);
});

test('a firm parry is pushed wide to the side of the ball, not back to the shooter', () => {
  for (const sign of [1, -1]) {
    const g = createWorld();
    const keeper = g.players[TEAM_SIZE]!;
    keeper.z = 0;
    g.ball.x = FIELD.length / 2 - 0.9; g.ball.y = 0.8; g.ball.z = 0.5 * sign; g.ball.vx = 25; g.ball.vy = 0;
    assert.equal(resolveKeeperContact(g, FIELD.length / 2 - 1.6), true);
    assert.equal(keeper.action, 'parry');
    assert.ok(g.ball.vx < 0, 'parry leaves the goal');
    assert.equal(Math.sign(g.ball.vz), sign);
    assert.ok(Math.abs(g.ball.vz) > Math.abs(g.ball.vx), `parry not wide: vx=${g.ball.vx} vz=${g.ball.vz}`);
  }
});

test('a diving keeper parries a firm shot at full stretch but still holds soft ones and shots at the body', () => {
  const shot = (z: number, vx: number, dive: boolean) => {
    const g = createWorld();
    const keeper = g.players[TEAM_SIZE]!;
    keeper.z = 0; if (dive) keeper.action = 'dive';
    g.ball.x = FIELD.length / 2 - 0.9; g.ball.y = 0.6; g.ball.z = z; g.ball.vx = vx;
    assert.equal(resolveKeeperContact(g, FIELD.length / 2 - 1.6), true);
    return g.event;
  };
  assert.equal(shot(1.8, 14, true), 'keeper parries');
  assert.equal(shot(1.8, 12, true), 'keeper claims it');
  assert.equal(shot(0.5, 14, false), 'keeper claims it');
});
