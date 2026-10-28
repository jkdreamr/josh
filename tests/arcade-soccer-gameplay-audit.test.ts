import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, DEAD_BALL_UNSTICK, KEEPER_MAX_HOLD } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, nearestCarrier, resolveKeeperContact, setRestart, stepWorld, switchPlayer, TEAM_SIZE, teamDir, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';

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

test('a chaser stuck beside a dead ball by teammate spacing breaks free and collects it', () => {
  const world = liveWorld();
  world.ball.x = 20; world.ball.z = -12; world.ball.y = 0.11; world.ball.vx = world.ball.vy = world.ball.vz = 0; world.ball.grounded = true;
  world.players.filter((p) => p.slot !== 'GK').forEach((p, i) => { p.x = p.team === 0 ? -35 : -25; p.z = -30 + (i % 11) * 6; p.vx = p.vz = 0; });
  const chaser = world.players[TEAM_SIZE + 5]!, mate = world.players[TEAM_SIZE + 6]!;
  chaser.x = 19.27; chaser.z = -12; mate.x = 21.27; mate.z = -12;
  let tick = 0;
  while (!nearestCarrier(world) && tick < (DEAD_BALL_UNSTICK + 2) * 60) {
    const commands = commandsFor(world, tick);
    if (tick === (DEAD_BALL_UNSTICK + 0.1) * 60) {
      const move = commands.get(chaser.id)!.move;
      assert.ok(Math.hypot(move.x, move.z) >= 0.08 && move.x > 0, `chaser input ${JSON.stringify(move)} does not reach the ball`);
    }
    stepWorld(world, 1 / 60, commands); tick++;
  }
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

test('a pass that dies short is released so the nearest players contest the loose ball', () => {
  const world = liveWorld();
  world.ball.x = 10; world.ball.z = 15; world.ball.y = 0.11; world.ball.vx = world.ball.vy = world.ball.vz = 0; world.ball.grounded = true;
  world.players.filter((p) => p.slot !== 'GK').forEach((p, i) => { p.x = p.team === 0 ? -30 : -20; p.z = -30 + (i % 11) * 6; p.vx = p.vz = 0; });
  const near = world.players[TEAM_SIZE + 5]!, receiver = world.players[TEAM_SIZE + 8]!;
  near.x = 5; near.z = 15; receiver.x = 17; receiver.z = -23;
  world.lastTouch = 1; world.lastToucherId = TEAM_SIZE + 9; world.passTarget = receiver.id; world.passFrom = TEAM_SIZE + 9;
  let tick = 0;
  while (!nearestCarrier(world) && tick < 3 * 60) { stepWorld(world, 1 / 60, commandsFor(world, tick)); tick++; }
  assert.equal(world.passTarget, null);
  assert.equal(nearestCarrier(world)?.id, near.id, `dead pass still loose after ${tick} ticks`);
});

test('a throw-in that dies short ends the set-piece run so the loose ball is contested', () => {
  const world = liveWorld();
  world.ball.x = 40.9; world.ball.z = 28.2; world.ball.y = 0.11; world.ball.vx = world.ball.vy = world.ball.vz = 0; world.ball.grounded = true;
  world.players.filter((p) => p.slot !== 'GK').forEach((p, i) => { p.x = p.team === 0 ? -30 : -20; p.z = -30 + (i % 11) * 6; p.vx = p.vz = 0; });
  const near = world.players[6]!, receiver = world.players[5]!;
  near.x = 38; near.z = 27; receiver.x = 30; receiver.z = 12;
  world.lastTouch = 0; world.lastToucherId = 7; world.passTarget = receiver.id; world.passFrom = 7;
  world.setPieceRun = { t: 2.8, kind: 'throw-in', runs: { [receiver.id]: { x: 30, z: 12 } }, marks: {}, wall: [] };
  stepWorld(world, 1 / 60, commandsFor(world, 0));
  assert.equal(world.setPieceRun, null);
  assert.equal(world.passTarget, null);
  let tick = 1;
  while (!nearestCarrier(world) && tick < 3 * 60) { stepWorld(world, 1 / 60, commandsFor(world, tick)); tick++; }
  assert.ok(nearestCarrier(world), `dead throw-in still loose after ${tick} ticks`);
});

test('set pieces never stack the taker or anyone else on top of another player', () => {
  const restarts = [['kick-in', { x: 10, z: 33.85 }], ['free-kick', { x: -20, z: -10 }], ['free-kick', { x: 30, z: 8 }],
    ['corner', { x: 52.35, z: -33.85 }], ['goal-kick', { x: -46.5, z: 0 }]] as const;
  for (const [kind, at] of restarts) {
    const world = liveWorld();
    world.players.forEach((p, i) => { p.x = at.x - Math.sign(at.x || 1) * (0.2 + (i % 5) * 0.25); p.z = at.z - Math.sign(at.z || 1) * (0.1 + Math.floor(i / 5) * 0.2); });
    world.ball.x = at.x; world.ball.z = at.z;
    setRestart(world, 0, kind, at);
    const taker = world.players[world.setPiece!.takerId]!;
    assert.ok(distance(taker, world.ball) < 0.6, `${kind} taker left the ball`);
    const wall = world.setPiece!.wall;
    for (let a = 0; a < world.players.length; a++) for (let b = a + 1; b < world.players.length; b++) {
      const min = wall.includes(a) && wall.includes(b) ? 0.55 : 0.7;
      assert.ok(distance(world.players[a]!, world.players[b]!) >= min, `${kind} at ${JSON.stringify(at)}: ${a}:${b} overlap`);
    }
  }
});

test('a crowded free-kick wall keeps its spacing while everyone else is spaced out', () => {
  const world = liveWorld();
  world.players.forEach((p, i) => { p.x = 39.3 + (i % 4) * 0.2; p.z = -0.6 + Math.floor(i / 4) * 0.2; });
  world.ball.x = 30; world.ball.z = 0;
  setRestart(world, 0, 'free-kick', { x: 30, z: 0 });
  const wall = world.setPiece!.wall;
  assert.ok(wall.length >= 2);
  for (let a = 0; a < world.players.length; a++) for (let b = a + 1; b < world.players.length; b++) {
    const min = wall.includes(a) && wall.includes(b) ? 0.55 : 0.7;
    assert.ok(distance(world.players[a]!, world.players[b]!) >= min, `${a}:${b} overlap`);
  }
  assert.ok(world.players.filter((p) => p.team === 1).every((p) => distance(p, world.ball) >= 9.15));
});

test('a restart marker pushed back to 9.15 m marks from the side instead of standing on his man', () => {
  const world = liveWorld();
  const at = { x: 20, z: 0 };
  world.ball.x = at.x; world.ball.z = at.z;
  setRestart(world, 0, 'free-kick', at);
  const [markerId, markId] = Object.entries(world.setPiece!.marks ?? {}).map(([id, m]) => [Number(id), m] as const)
    .find(([id]) => !world.setPiece!.wall.includes(id))!;
  const marker = world.players[markerId]!, mark = world.players[markId]!;
  mark.x = at.x - teamDir(0, world.endsSwapped) * 8.9; mark.z = at.z + 1.5; mark.vx = mark.vz = 0;
  marker.x = mark.x - teamDir(0, world.endsSwapped) * 1.5; marker.z = mark.z + 1; marker.vx = marker.vz = 0;
  let frames = 0, closest = Infinity;
  while (world.phase === 'restart' && frames < 120) {
    stepWorld(world, 1 / 60, commandsFor(world, frames));
    if (++frames > 30 && world.phase === 'restart') closest = Math.min(closest, distance(marker, mark));
  }
  assert.ok(frames > 60, `restart only lasted ${frames} frames`);
  assert.ok(closest >= 0.6, `marker within ${closest.toFixed(2)} m of his man`);
  assert.ok(distance(marker, world.ball) >= 9.15 - 1e-6);
});

test('switching never hands the human the goalkeeper outside penalties', () => {
  const world = createWorld(4242);
  const keeper = world.players.find((p) => p.team === 0 && p.slot === 'GK')!;
  world.ball.x = keeper.x + 0.5; world.ball.z = keeper.z;
  for (let i = 0; i < 12; i++) {
    assert.notEqual(switchPlayer(world, 0), keeper.id);
    assert.notEqual(switchPlayer(world, 0, { x: keeper.x - world.players[world.controlled[0]]!.x, z: keeper.z - world.players[world.controlled[0]]!.z }), keeper.id);
  }
  setRestart(world, 1, 'penalty', { x: -41.5, z: 0 });
  assert.equal(world.controlled[0], keeper.id);
});
