import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, distance, FIELD, TEAM_SIZE, findReceiver, groundPassSpeed, kick, STEP, stepWorld, type Action, type Command } from '../src/os/arcade/games/soccer/logic.ts';
import { stepBall, type BallState } from '../src/os/arcade/games/soccer/physics.ts';
import { acceptMovePacket, cloneSnapshot, consumeCommand, movePacket, parsePacket, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';

function setup(seed = 47) {
  const world = createWorld(seed);
  world.phase = 'live'; world.restart = null; world.controlled = [1, TEAM_SIZE + 1];
  for (const p of world.players) { p.x = -18; p.z = -11; p.human = true; p.controlled = false; }
  const player = world.players[1]!;
  player.x = -10; player.z = 5; player.facing = Math.PI / 2; player.controlled = true;
  world.ball.x = player.x + 0.4; world.ball.z = player.z;
  const fire = (action: Action, power = 0.45, aim = { x: 1, z: 0 }, move = { x: 0, z: 0 }) => {
    stepWorld(world, STEP, new Map([[player.id, { move, action, power, aim, pressed: true }]]));
  };
  return { world, player, fire };
}

function freeStep(ball: BallState) {
  const x = ball.x, z = ball.z;
  ball.x = ball.z = 0;
  stepBall(ball, STEP);
  ball.x += x; ball.z += z;
}

test('assisted pass respects the cone, angle preference, and blocked lanes', () => {
  const { world, player, fire } = setup();
  const straight = world.players[2]!, outside = world.players[3]!, angled = world.players[4]!;
  straight.x = 3; straight.z = 5;
  outside.x = -9; outside.z = 9;
  angled.x = -1; angled.z = 8;
  assert.equal(findReceiver(world, player, { x: 1, z: 0 }, false)?.id, straight.id);
  fire('pass'); assert.equal(world.passTarget, straight.id);
  const blocker = world.players.find((p) => p.team !== player.team)!;
  blocker.x = -3; blocker.z = 5;
  assert.equal(findReceiver(world, player, { x: 1, z: 0 }, false)?.id, angled.id);
});

test('human pass prefers the aimed centre-back over a similarly aligned goalkeeper', () => {
  const world = createWorld();
  const carrier = world.players[4]!;
  const centerBack = world.players[3]!;
  const keeper = world.players[0]!;
  for (const player of world.players) player.sentOff = true;
  carrier.sentOff = false; carrier.x = 0; carrier.z = 0;
  centerBack.sentOff = false; centerBack.x = -11.5; centerBack.z = 14.7;
  keeper.sentOff = false; keeper.x = -19; keeper.z = 25.3;
  const angle = 127.5 * Math.PI / 180;

  assert.equal(findReceiver(world, carrier, { x: Math.cos(angle), z: Math.sin(angle) }, false, false, false, 0.75)?.id, centerBack.id);
});

test('human pass can choose an aimed goalkeeper when no outfielder is within 25 degrees', () => {
  const world = createWorld();
  const carrier = world.players[4]!;
  const centerBack = world.players[3]!;
  const keeper = world.players[0]!;
  for (const player of world.players) player.sentOff = true;
  carrier.sentOff = false; carrier.x = 0; carrier.z = 0;
  keeper.sentOff = false; keeper.x = 20; keeper.z = 0;
  const angle = 27 * Math.PI / 180;
  centerBack.sentOff = false; centerBack.x = 18 * Math.cos(angle); centerBack.z = 18 * Math.sin(angle);

  assert.equal(findReceiver(world, carrier, { x: 1, z: 0 }, false, false, false, 0.75)?.id, keeper.id);
});

test('receiver selection covers eight stick directions in a teammate ring and values tap versus held range', () => {
  const { world, player } = setup();
  player.x = 0; player.z = 0;
  const teammates = world.players.filter((p) => p.team === player.team && p.id !== player.id);
  for (const mate of teammates) mate.sentOff = true;
  for (let i = 0; i < 8; i++) {
    const mate = teammates[i]!;
    mate.sentOff = false;
    const angle = i * Math.PI / 4;
    mate.x = Math.cos(angle) * 15;
    mate.z = Math.sin(angle) * 15;
  }
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    assert.equal(findReceiver(world, player, { x: Math.cos(angle), z: Math.sin(angle) }, false)?.id, teammates[i]!.id);
  }

  for (const mate of teammates) mate.sentOff = true;
  const near = teammates[1]!, far = teammates[2]!;
  near.sentOff = far.sentOff = false;
  near.x = 10; near.z = 0;
  far.x = 25; far.z = 0;
  assert.equal(findReceiver(world, player, { x: 1, z: 0 }, false, false, false, 0.1)?.id, near.id);
  assert.equal(findReceiver(world, player, { x: 1, z: 0 }, false, false, false, 1)?.id, far.id);

  const straight = teammates[2]!, eightDegrees = teammates[3]!;
  for (const mate of teammates) mate.sentOff = true;
  straight.sentOff = eightDegrees.sentOff = false;
  const angle = Math.PI / 4;
  straight.x = Math.cos(angle) * 15; straight.z = Math.sin(angle) * 15;
  eightDegrees.x = Math.cos(angle + 8 * Math.PI / 180) * 15;
  eightDegrees.z = Math.sin(angle + 8 * Math.PI / 180) * 15;
  assert.equal(findReceiver(world, player, { x: Math.cos(angle), z: Math.sin(angle) }, false)?.id, straight.id);

  const kickoff = createWorld(123);
  const midfieldCarrier = kickoff.players[1]!;
  midfieldCarrier.x = midfieldCarrier.z = 0;
  for (let i = 0; i < 8; i++) {
    const direction = { x: Math.cos(i * Math.PI / 4), z: Math.sin(i * Math.PI / 4) };
    const receiver = findReceiver(kickoff, midfieldCarrier, direction, false);
    if (receiver) assert.equal(receiver.team, midfieldCarrier.team);
  }
});

test('human pass transfers control to its receiver on the strike frame', () => {
  const { world, player, fire } = setup();
  const receiver = world.players[2]!;
  receiver.human = false;
  receiver.x = player.x + 12; receiver.z = player.z;
  fire('pass', 0.6);
  assert.equal(world.kickEvent?.playerId, player.id);
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.controlled[player.team], receiver.id);
  assert.equal(receiver.human, true);
  assert.equal(player.human, false);
});

test('a repeated phone pass edge kicks once across 250 ms, starting on the release step', () => {
  const { world, player } = setup();
  const receiver = world.players[2]!;
  receiver.human = false;
  receiver.x = player.x + 12; receiver.z = player.z;
  const seat: RemoteSeat = { seq: -1, edge: -1, held: null, pressUsed: false };
  const held = acceptMovePacket(seat, undefined, movePacket(1, 1, 1, {
    move: { x: 0, z: 0 }, heldAction: 'pass', aim: { x: 1, z: 0 },
  }), false);
  stepWorld(world, STEP, new Map([[player.id, held.command!]]));
  assert.notEqual(world.kickEvent?.action, 'pass');

  let accepted = acceptMovePacket(held.seat, consumeCommand(held.command!), movePacket(1, 2, 1, {
    move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.7, aim: { x: 1, z: 0 },
  }, 1), false);
  stepWorld(world, STEP, new Map([[player.id, accepted.command!]]));
  assert.equal(world.kickEvent?.playerId, player.id, 'release kicks on the first subsequent world step');
  let kickEvents = Number(world.kickEvent?.action === 'pass');
  let previous = consumeCommand(accepted.command!);
  for (let seq = 3; seq <= 17; seq++) {
    accepted = acceptMovePacket(accepted.seat, previous, movePacket(1, seq, 1, {
      move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.7, aim: { x: 1, z: 0 },
    }, 1), false);
    assert.equal(accepted.command?.action, null);
    previous = consumeCommand(accepted.command!);
    stepWorld(world, STEP, new Map([[world.controlled[player.team], accepted.command!]]));
    kickEvents += Number(world.kickEvent?.action === 'pass');
  }
  assert.equal(kickEvents, 1);
});

test('released phone action is accepted and kicked on the next world step', () => {
  const { world, player } = setup();
  const receiver = world.players[2]!;
  receiver.x = player.x + 12; receiver.z = player.z;
  const seat: RemoteSeat = { seq: -1, edge: -1, held: null, pressUsed: false };
  const held = acceptMovePacket(seat, undefined, movePacket(1, 1, 1, {
    move: { x: 0, z: 0 }, heldAction: 'pass', aim: { x: 1, z: 0 },
  }, 1), false);
  stepWorld(world, STEP, new Map([[player.id, held.command!]]));
  assert.notEqual(world.kickEvent?.action, 'pass');
  const released = acceptMovePacket(held.seat, consumeCommand(held.command!), movePacket(1, 2, 1, {
    move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.6, aim: { x: 1, z: 0 },
  }, 2), false);
  stepWorld(world, STEP, new Map([[player.id, released.command!]]));
  assert.equal(world.kickEvent?.playerId, player.id);
  assert.equal(world.kickEvent?.action, 'pass');
});

test('ground passes use the rolling model and charge controls arrival speed', () => {
  const arrivals: number[] = [];
  for (const power of [0.1, 0.45, 1]) {
    const { world, player, fire } = setup();
    player.x = -8; world.ball.x = -7.6;
    const receiver = world.players[2]!; receiver.x = 7; receiver.z = 5;
    fire('pass', power);
    const ball = { ...world.ball };
    for (let i = 0; i < 900 && ball.x < receiver.x && ball.vx > 0.01; i++) freeStep(ball);
    const arrival = ball.x >= receiver.x ? Math.hypot(ball.vx, ball.vz) : 0;
    arrivals.push(arrival);
  }
  assert.ok(arrivals[0]! > 0 && arrivals[0]! < arrivals[1]!);
  console.log(`15 m pass arrivals (0.1 / 0.45 / 1): ${arrivals.map((s) => s.toFixed(2)).join(' / ')} m/s (0 = fell short)`);
  assert.ok(arrivals[0]! >= 6);
  assert.ok(arrivals[1]! > arrivals[0]!);
  assert.ok(arrivals[2]! > arrivals[1]!);
  const speeds = [5, 15, 25, 35].map((range) => groundPassSpeed(range));
  console.log(`ground launch speeds at 5 / 15 / 25 / 35 m: ${speeds.map((s) => s.toFixed(2)).join(' / ')} m/s`);
  for (const speed of speeds) assert.ok(speed >= 8 && speed <= 25);
  for (const range of [5, 15, 25, 35]) {
    for (const charge of [0.1, 0.45, 1]) {
      const { world, player } = setup();
      player.x = -range / 2; world.ball.x = player.x + 0.4;
      const receiver = world.players[2]!; receiver.x = range / 2; receiver.z = 5;
      kick(world, player, 'pass', { move: { x: 1, z: 0 }, aim: { x: 1, z: 0 }, action: 'pass', pressed: true, power: charge });
      const speed = Math.hypot(world.ball.vx, world.ball.vz);
      assert.ok(speed >= 12 && speed <= 28, `${range} m at charge ${charge} launched at ${speed.toFixed(2)} m/s`);
    }
  }
});

test('human ground passes keep tap, full-charge and driven launch speeds in their FIFA ranges', () => {
  const launchSpeed = (power: number, finesse = false) => {
    const { world, player } = setup();
    player.x = -7.5; world.ball.x = -7.1;
    const receiver = world.players[2]!;
    receiver.human = false;
    receiver.x = 7.5; receiver.z = 5;
    kick(world, player, 'pass', {
      move: { x: 0, z: 0 }, aim: { x: 1, z: 0 }, action: 'pass', pressed: true, power, finesse,
    });
    return Math.hypot(world.ball.vx, world.ball.vz);
  };
  const tap = launchSpeed(0.1);
  const full = launchSpeed(1);
  const driven = launchSpeed(0.1, true);
  assert.ok(tap >= 12 && tap <= 28, `tap speed ${tap}`);
  assert.ok(full > tap, `full speed ${full}, tap speed ${tap}`);
  assert.ok(driven >= 20, `driven speed ${driven}`);
});

test('unassisted pass uses space range and moving receiver is led', () => {
  const { world, player, fire } = setup();
  assert.equal(findReceiver(world, player, { x: 1, z: 0 }, false), undefined);
  fire('pass', 0.45);
  assert.equal(world.passTarget, null);
  assert.ok(world.ball.grounded);
  const other = setup();
  const receiver = other.world.players[2]!; receiver.x = 2; receiver.z = 5; receiver.vz = 3;
  other.fire('pass');
  assert.ok(other.world.ball.vz > 1);
});

test('40 metre lob lands near its target with range-calibrated drag', () => {
  const { world, player, fire } = setup();
  player.x = -20; world.ball.x = -19.6;
  const receiver = world.players[2]!; receiver.x = 20; receiver.z = 5;
  fire('lob', 0.5);
  assert.ok(Math.hypot(world.ball.vx, world.ball.vy, world.ball.vz) <= 24);
  const ball = { ...world.ball };
  for (let i = 0; i < 600; i++) {
    const falling = ball.vy < 0;
    freeStep(ball);
    if (falling && ball.vy >= 0) break;
  }
  console.log(`40 m lob landing error: ${distance(ball, receiver).toFixed(2)} m`);
  assert.ok(distance(ball, receiver) <= 5);
});

test('through ball leads the runner and neutral receiver beats distant defender to its point', () => {
  const { world, player, fire } = setup();
  const runner = world.players[2]!; runner.x = 0; runner.z = 5; runner.vx = 6; runner.human = false;
  const defender = world.players.find((p) => p.team !== player.team)!;
  defender.x = -10; defender.z = -8; defender.controlled = true;
  fire('through', 0.45);
  const point = { ...world.passPoint! };
  console.log(`through-ball forward lead: ${(point.x - 0).toFixed(2)} m`);
  assert.ok(point.x >= 3 && Math.abs(point.z - 5) < 0.01);
  let reached = false;
  for (let i = 0; i < 180; i++) {
    const command: Command = { move: { x: point.x - defender.x, z: point.z - defender.z }, sprint: true };
    stepWorld(world, STEP, new Map([[defender.id, command]]));
    if (distance(runner, point) < 0.8) { reached = true; assert.ok(distance(defender, point) > 1); break; }
  }
  assert.ok(reached, `runner ended ${distance(runner, point)} m from point`);
});

test('human receiver stick overrides both through-point and ordinary receiving auto-run', () => {
  for (const withPoint of [true, false]) {
    const { world, player } = setup();
    world.passTarget = player.id; world.passPoint = withPoint ? { x: -3, z: 5 } : null;
    world.ball.x = -3;
    stepWorld(world, STEP, new Map([[player.id, { move: { x: -1, z: 0 } }]]));
    assert.ok(player.vx < 0);
    player.vx = player.vz = 0;
    stepWorld(world, STEP, new Map([[player.id, { move: { x: 0, z: 0 } }]]));
    assert.ok(player.vx > 0);
  }
});

function shotSample(seed: number, power: number, difficult = false, action: Action = 'shoot') {
  const { world, player, fire } = setup(Math.imul(seed, 2654435761) >>> 0);
  player.x = FIELD.length / 2 - 16; player.z = 0;
  world.ball.x = player.x + 0.4; world.ball.z = 0;
  if (difficult) {
    player.vz = 7.5; player.facing = -Math.PI / 2; player.stamina = 0.5;
    const opponent = world.players.find((p) => p.team !== player.team)!;
    opponent.x = player.x; opponent.z = 1.2;
  }
  fire(action, power, { x: 1, z: 0 }, difficult ? { x: 0, z: 1 } : { x: 0, z: 0 });
  const ball = { ...world.ball };
  for (let i = 0; i < 300 && ball.x < FIELD.length / 2; i++) freeStep(ball);
  return { on: Math.abs(ball.z) <= FIELD.goalWidth / 2 - 0.11 && ball.y <= FIELD.goalHeight - 0.11 && ball.x >= FIELD.length / 2, over: ball.y > FIELD.goalHeight, ball };
}

test('shot power overcharges and pressure, sprint, body angle reduce accuracy', () => {
  let normal = 0, over = 0, difficult = 0;
  for (let i = 1; i <= 200; i++) {
    if (shotSample(i, 0.7).on) normal++;
    if (shotSample(i, 1).over) over++;
    if (shotSample(i, 0.7, true).on) difficult++;
  }
  console.log(`shots over 200 seeds: 0.7 on-target ${normal}; 1.0 over-bar ${over}; difficult on-target ${difficult}`);
  assert.ok(normal >= 140); assert.ok(over >= 120); assert.ok(difficult < normal - 10);
});

test('finesse is slower and its spin curls toward goal centre in either direction', () => {
  for (const team of [0, 1] as const) {
    const normal = setup(), finesse = setup();
    for (const f of [normal, finesse]) { f.player.team = team; f.player.z = 4; f.world.ball.z = 4; f.player.facing = (team === 0 ? 1 : -1) * Math.PI / 2; }
    normal.fire('shoot', 0.7); finesse.fire('finesse', 0.7);
    assert.ok(Math.hypot(finesse.world.ball.vx, finesse.world.ball.vy, finesse.world.ball.vz) < Math.hypot(normal.world.ball.vx, normal.world.ball.vy, normal.world.ball.vz));
    assert.ok(finesse.world.ball.spin * finesse.world.ball.vx < 0);
    const spun = { ...finesse.world.ball }, straight = { ...spun, spin: 0 };
    for (let i = 0; i < 30; i++) { freeStep(spun); freeStep(straight); }
    assert.ok(spun.z < straight.z);
  }
});

test('first-time shot fires on arrival, expires after 0.5 s, and does not buffer against a carrier', () => {
  for (const arrives of [true, false]) {
    const { world, player, fire } = setup();
    world.ball.x = player.x + 2; world.ball.vx = arrives ? -8 : 0;
    fire('shoot', 0.7);
    assert.ok(player.buffer);
    let fired = false;
    for (let i = 0; i < 30; i++) {
      stepWorld(world, STEP);
      if (world.kickEvent?.action === 'shoot') { fired = true; assert.ok(i * STEP <= 0.5); break; }
    }
    assert.equal(fired, arrives); assert.equal(player.buffer, null);
  }
  const { world, player, fire } = setup();
  const opponent = world.players.find((p) => p.team !== player.team)!;
  opponent.x = world.ball.x = player.x + 2; opponent.z = world.ball.z;
  fire('shoot'); assert.equal(player.buffer, null);
});

test('passing targets and first-time buffers survive snapshots and reject invalid state', () => {
  const { world, player } = setup();
  const packet = () => ({ t: 'soccer', k: 's', r: 1, seq: 1, state: cloneSnapshot(world) });
  world.passPoint = { x: 40, z: 10 };
  player.buffer = { action: 'shoot', power: 0.7, aim: { x: 1, z: 0 }, t: 0.3 };
  assert.ok(parsePacket(packet()));
  player.buffer.t = -1; assert.equal(parsePacket(packet()), null);
  player.buffer = null; world.passPoint.x = Infinity; assert.equal(parsePacket(packet()), null);
  world.passPoint = null; assert.ok(parsePacket(packet()));
});
