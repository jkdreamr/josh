import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, distance, kick, nearestCarrier, receiverAssistActive, STEP, TEAM_SIZE, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';
import { stepBall, type BallState } from '../src/os/arcade/games/soccer/physics.ts';
import { parsePacket, trimSnapshot } from '../src/os/arcade/games/soccer/net.ts';

function preparePass(range: number, charge: number, angle: number, receiverId = 2) {
  const world = createWorld(451);
  world.phase = 'live';
  world.restart = null;
  world.rules!.offside = false;
  for (const player of world.players) {
    player.sentOff = true;
    player.human = false;
    player.controlled = false;
  }

  const passer = world.players[1]!;
  const receiver = world.players[receiverId]!;
  const defender = world.players[TEAM_SIZE + 2]!;
  const aim = { x: Math.cos(angle), z: Math.sin(angle) };
  const start = { x: 0.4, z: 0 };

  passer.sentOff = false;
  passer.human = true;
  passer.controlled = true;
  passer.x = 0;
  passer.z = 0;
  receiver.sentOff = false;
  receiver.x = start.x + aim.x * range;
  receiver.z = start.z + aim.z * range;
  defender.sentOff = false;
  defender.x = start.x + aim.x * range / 2 - aim.z * 2.5;
  defender.z = start.z + aim.z * range / 2 + aim.x * 2.5;
  world.controlled = [passer.id, defender.id];
  world.ball.x = start.x;
  world.ball.z = start.z;
  world.ball.y = 0.11;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.ball.vz = 0;

  kick(world, passer, 'pass', {
    move: aim, aim, action: 'pass', pressed: true, power: charge,
  });
  return { world, passer, receiver, defender, aim };
}

function freeStep(ball: BallState) {
  const x = ball.x;
  const z = ball.z;
  ball.x = 0;
  ball.z = 0;
  stepBall(ball, STEP);
  ball.x += x;
  ball.z += z;
}

function flightTo(world: ReturnType<typeof createWorld>, target: { x: number; z: number }) {
  const ball = { ...world.ball };
  const start = { x: ball.x, z: ball.z };
  const speed = Math.hypot(ball.vx, ball.vz);
  const direction = { x: ball.vx / speed, z: ball.vz / speed };
  const range = (target.x - start.x) * direction.x + (target.z - start.z) * direction.z;
  let travelled = 0;
  let time = 0;
  let closest = distance(ball, target);

  while (travelled < range && time < 12 && Math.hypot(ball.vx, ball.vz) > 0.01) {
    freeStep(ball);
    travelled = (ball.x - start.x) * direction.x + (ball.z - start.z) * direction.z;
    closest = Math.min(closest, distance(ball, target));
    time += STEP;
  }
  return {
    reached: travelled >= range,
    time,
    arrivalSpeed: Math.hypot(ball.vx, ball.vz),
    closest,
  };
}

function receivePass(world: ReturnType<typeof createWorld>, receiverId: number, aim: { x: number; z: number }) {
  const commands = new Map([[receiverId, { move: aim, sprint: true }]]);
  for (let frame = 1; frame <= 600; frame++) {
    stepWorld(world, STEP, commands);
    if (nearestCarrier(world)?.id === receiverId) return frame * STEP;
  }
  return null;
}

test('human ground-pass flight times and arrival pace meet the requested ranges', () => {
  const tap18 = preparePass(18, 0.1, 0);
  const tap18Flight = flightTo(tap18.world, tap18.receiver);
  assert.ok(tap18Flight.reached);
  assert.ok(tap18Flight.time <= 1.4, `18 m tap took ${tap18Flight.time.toFixed(2)} s`);
  assert.ok(tap18Flight.arrivalSpeed >= 6, `18 m tap arrived at ${tap18Flight.arrivalSpeed.toFixed(2)} m/s`);
  assert.ok(Math.abs(tap18Flight.arrivalSpeed - 9.4) < 0.3, `18 m tap target arrival was ${tap18Flight.arrivalSpeed.toFixed(2)} m/s`);

  const full18 = preparePass(18, 0.9, 0);
  const full18Flight = flightTo(full18.world, full18.receiver);
  assert.ok(full18Flight.reached);
  assert.ok(full18Flight.time <= 1.1, `18 m full-charge pass took ${full18Flight.time.toFixed(2)} s`);

  const tap30 = preparePass(30, 0.1, 0);
  const tap30Flight = flightTo(tap30.world, tap30.receiver);
  assert.ok(tap30Flight.reached);
  assert.ok(tap30Flight.time <= 2.2, `30 m tap took ${tap30Flight.time.toFixed(2)} s`);

  const distances = [8, 12, 18, 25, 35];
  const charges = [0.1, 0.4, 0.8];
  const rows = distances.map((range) => {
    const times = charges.map((charge) => {
      const pass = preparePass(range, charge, 0);
      const flight = flightTo(pass.world, pass.receiver);
      return flight.reached ? flight.time.toFixed(2) : `>${flight.time.toFixed(0)}`;
    });
    return `${range} m: ${times.join(' / ')} s`;
  });
  console.log(`Human pass flight times (charges 0.1 / 0.4 / 0.8):\n${rows.join('\n')}`);
});

test('tap passes reach the aimed teammate on distinct lanes with nearby off-line defenders', () => {
  const scenarios = [
    { receiverId: 2, range: 8, angle: 0 },
    { receiverId: 3, range: 16, angle: Math.PI / 2 },
    { receiverId: 4, range: 25, angle: -Math.PI / 4 },
  ];
  const reachedIds: number[] = [];

  for (const scenario of scenarios) {
    const { world, receiver, defender, aim } = preparePass(scenario.range, 0.1, scenario.angle, scenario.receiverId);
    assert.equal(world.passTarget, receiver.id, `wrong receiver selected at ${scenario.range} m`);
    assert.equal(world.controlled[0], receiver.id, `pass control did not transfer at ${scenario.range} m`);
    const segmentMidpoint = {
      x: (world.ball.x + receiver.x) / 2,
      z: (world.ball.z + receiver.z) / 2,
    };
    const defenderOffset = Math.abs((defender.x - segmentMidpoint.x) * -aim.z + (defender.z - segmentMidpoint.z) * aim.x);
    assert.ok(defenderOffset >= 2.4 && defenderOffset <= 2.6, 'defender should be nearby but off the pass line');

    const flight = flightTo(world, receiver);
    assert.ok(flight.reached, `tap pass fell short at ${scenario.range} m`);
    assert.ok(flight.closest < 0.8, `tap pass missed receiver ${receiver.id} by ${flight.closest.toFixed(2)} m`);
    assert.ok(receivePass(world, receiver.id, aim) !== null, `tap pass was not received by player ${receiver.id}`);
    reachedIds.push(receiver.id);
  }

  assert.equal(new Set(reachedIds).size, scenarios.length);
});

test('pass-aim-aligned receiver moves toward the incoming ball and controls the pass', () => {
  const { world, receiver } = preparePass(8, 0.1, 0);
  assert.equal(world.controlled[0], receiver.id);
  assert.equal(receiver.human, true);

  receiver.x = 3;
  receiver.z = 0.5;
  receiver.vx = 0;
  receiver.vz = 0;
  world.ball = { ...world.ball, x: 0, y: 0.11, z: 0, vx: 2.1, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  let previousGap = distance(receiver, world.ball);
  const startX = receiver.x;

  for (let interval = 0; interval < 4; interval++) {
    for (let frame = 0; frame < 6; frame++) {
      stepWorld(world, STEP, new Map([[receiver.id, { move: { x: 1, z: 0 }, sprint: true }]]));
    }
    const gap = distance(receiver, world.ball);
    assert.ok(gap < previousGap, `receiver gap grew from ${previousGap.toFixed(2)} to ${gap.toFixed(2)} m at ${(interval + 1) / 10} s`);
    previousGap = gap;
  }
  assert.ok(receiver.x < startX, 'receiver did not move toward the incoming ball');
});

test('an aligned receiver close to the pass line steps toward the ball', () => {
  const { world, receiver, aim } = preparePass(8, 0.1, 0);
  receiver.human = true;
  receiver.controlled = true;
  receiver.x = 3;
  receiver.z = 1;
  receiver.vx = 0;
  receiver.vz = 0;
  world.controlled[0] = receiver.id;
  world.passPoint = null;
  world.ball = { ...world.ball, x: 0, y: 0.11, z: 0, vx: 8, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };

  assert.deepEqual(receiverAssistActive(world, receiver, aim), { x: 0, z: 0 });

  for (let frame = 0; frame < 6; frame++) {
    stepWorld(world, STEP, new Map([[receiver.id, { move: aim, sprint: true }]]));
  }

  assert.ok(receiver.x < 3, 'receiver did not step toward the ball');
  assert.ok(receiver.z < 1, 'receiver did not cut toward the ball');
});

test('a receiver immediately overrides pass assist with a perpendicular stick', () => {
  const { world, receiver } = preparePass(8, 0.1, 0);
  receiver.x = 15;
  receiver.z = 0;
  world.ball = { ...world.ball, x: -10, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  const startZ = receiver.z;

  stepWorld(world, STEP, new Map([[receiver.id, { move: { x: 0, z: 1 } }]]));

  assert.ok(receiver.z > startZ, `receiver ignored perpendicular stick: z ${receiver.z}`);
});

test('pass-strike steering fields remain host-only and snapshots without them parse', () => {
  const world = createWorld();
  world.passStrikeAt = 12.5;
  world.passAim = { x: 1, z: 0 };
  const snapshot = trimSnapshot(world);

  assert.equal('passStrikeAt' in snapshot, false);
  assert.equal('passAim' in snapshot, false);
  assert.ok(parsePacket({ t: 'soccer', k: 's', r: 1, seq: 1, state: snapshot }));
});

test('a non-pass kick clears pass-strike steering state', () => {
  const { world, passer, aim } = preparePass(8, 0.1, 0);
  assert.equal(world.passTarget !== null, true);
  assert.equal(world.passAim?.x, aim.x);
  assert.notEqual(world.passStrikeAt, null);

  kick(world, passer, 'shoot', {
    move: aim, aim, action: 'shoot', pressed: true, power: 0.6,
  });

  assert.equal(world.passTarget, null);
  assert.equal(world.passStrikeAt, null);
  assert.equal(world.passAim, null);
});
