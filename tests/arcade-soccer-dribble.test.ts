import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSIST_CONE, ASSIST_RANGE, CONTROL_RADIUS, CONTROL_SPEED, createWorld, distance,
  FIRST_TOUCH_PULL, FIRST_TOUCH_REACH, firstTouchCandidate, inFirstTouchReach,
  KNOCK_ON_REACH, nearestCarrier, SPRINT_TURN_LIMIT, STEP, stepWorld, TEAM_SIZE,
  type Command, type Player, type Team, type World,
} from '../src/os/arcade/games/soccer/logic.ts';

function fixture({ team = 0 as Team, cpu = false } = {}) {
  const world = createWorld();
  world.phase = 'live';
  world.restart = null;
  world.controlled = [1, TEAM_SIZE + 1];
  for (const p of world.players) {
    p.x = -45; p.z = -30; p.vx = p.vz = 0; p.human = true; p.controlled = false;
  }
  const player = world.players[team * TEAM_SIZE + 1]!;
  player.x = player.z = 0;
  player.human = !cpu;
  player.controlled = !cpu;
  player.facing = team === 0 ? Math.PI / 2 : -Math.PI / 2;
  world.controlled[team] = player.id;
  world.ball.x = 0.45; world.ball.z = 0;
  world.carrierId = world.lastToucherId = player.id;
  return {
    world, player,
    tick: (command: Command = { move: { x: 0, z: 0 } }) => stepWorld(world, STEP, new Map([[player.id, command]])),
  };
}

function localPoint(player: Player, forward: number, side: number) {
  return {
    x: player.x + Math.sin(player.facing) * forward + Math.cos(player.facing) * side,
    z: player.z + Math.cos(player.facing) * forward - Math.sin(player.facing) * side,
  };
}

function relativeBall(player: Player, ball: Point) {
  return { x: ball.x - player.x, z: ball.z - player.z };
}

function loose(world: World) {
  world.carrierId = null;
  world.lastToucherId = null;
  world.passTarget = null;
}

function sprintTurn(degrees: number, phase: number) {
  const { world, player, tick } = fixture();
  let delay = phase;
  let turning = false;
  let turnFrame = -1;
  let maxGap = 0;
  let regained = false;
  let escaped = false;
  let frames = 0;
  for (; frames < 60 * 8; frames++) {
    if (!turning && player.x >= 15) {
      if (delay <= 0) { turning = true; turnFrame = frames; }
      else delay--;
    }
    const angle = degrees * Math.PI / 180;
    tick({ move: turning ? { x: Math.cos(angle), z: Math.sin(angle) } : { x: 1, z: 0 }, sprint: true });
    const carrier = nearestCarrier(world);
    assert.ok(!carrier || carrier.team === player.team, 'no opponent may be involved in the turn outcome');
    maxGap = Math.max(maxGap, distance(player, world.ball));
    if (turning && frames - turnFrame < 60 && carrier?.id === player.id) regained = true;
    if (turning && distance(player, world.ball) > 2.5) { escaped = true; frames++; break; }
    if (turning && frames - turnFrame >= 119) { frames++; break; }
  }
  return { maxGap, regained, escaped, frames, turnFrame };
}

function pickup(framesLimit = 60, { team = 0 as Team, cpu = false, forward = 1.3, side = 0 } = {}) {
  const { world, player, tick } = fixture({ team, cpu });
  loose(world);
  Object.assign(world.ball, localPoint(player, forward, side), { y: 0.11, vx: 0, vy: 0, vz: 0, grounded: true });
  let maxJump = 0;
  let previous = relativeBall(player, world.ball);
  for (let frame = 1; frame <= framesLimit; frame++) {
    tick();
    const current = relativeBall(player, world.ball);
    maxJump = Math.max(maxJump, distance(previous, current));
    previous = current;
    if (nearestCarrier(world)?.id === player.id) {
      let retained = true;
      for (let hold = 0; hold < 10; hold++) {
        tick();
        const current = relativeBall(player, world.ball);
        maxJump = Math.max(maxJump, distance(previous, current));
        previous = current;
        retained &&= nearestCarrier(world)?.id === player.id;
      }
      return { frames: frame, maxJump, retained, world, player };
    }
  }
  return { frames: -1, maxJump, retained: false, world, player };
}

function sidePass({ team = 0 as Team, cpu = false, speed = 8, targeted = false } = {}) {
  const { world, player, tick } = fixture({ team, cpu });
  loose(world);
  player.facing = team === 0 ? -Math.PI / 2 : Math.PI / 2;
  const forward = { x: Math.sin(player.facing), z: Math.cos(player.facing) };
  const passer = world.players.find((p) => p.team === team && p.id !== player.id)!;
  passer.x = player.x + forward.x * 20;
  passer.z = player.z + forward.z * 20;
  world.lastToucherId = passer.id;
  world.lastTouch = team;
  world.ball.x = player.x + forward.x * 1.4;
  world.ball.z = player.z + forward.z * 1.4 + 1.2;
  world.ball.vx = -forward.x * speed;
  world.ball.vz = -forward.z * speed;
  world.ball.vy = 0; world.ball.y = 0.11; world.ball.grounded = true;
  world.passTarget = targeted ? player.id : null;
  world.passFrom = targeted ? passer.id : null;
  let previous = relativeBall(player, world.ball);
  let maxJump = 0;
  for (let frame = 1; frame <= 360; frame++) {
    tick();
    const current = relativeBall(player, world.ball);
    maxJump = Math.max(maxJump, distance(previous, current));
    previous = current;
    if (nearestCarrier(world)?.id === player.id) {
      let retained = true;
      for (let hold = 0; hold < 10; hold++) {
        tick();
        const current = relativeBall(player, world.ball);
        maxJump = Math.max(maxJump, distance(previous, current));
        previous = current;
        retained &&= nearestCarrier(world)?.id === player.id;
      }
      return { frames: frame, maxJump, retained, world, player };
    }
    if ((world.ball.x - player.x) * forward.x < -3) break;
  }
  return { frames: -1, maxJump, retained: false, world, player };
}

test('exports the control and first-touch reach geometry', () => {
  const { player } = fixture();
  assert.equal(CONTROL_RADIUS, 0.64);
  assert.deepEqual(FIRST_TOUCH_REACH, { ahead: 1.5, side: 1.3, behind: 0.9 });
  assert.equal(FIRST_TOUCH_PULL, 0.2);
  assert.equal(KNOCK_ON_REACH, 2.0);
  assert.equal(ASSIST_RANGE, 3.0);
  assert.equal(ASSIST_CONE, Math.PI / 3);
  assert.equal(SPRINT_TURN_LIMIT, 100 * Math.PI / 180);
  assert.ok(inFirstTouchReach(player, localPoint(player, 1.5, 0)) <= 1);
  assert.ok(inFirstTouchReach(player, localPoint(player, 0, 1.3)) <= 1);
  assert.ok(inFirstTouchReach(player, localPoint(player, -0.9, 0)) <= 1);
  assert.ok(inFirstTouchReach(player, localPoint(player, -0.91, 0)) > 1);
  const looseBall = fixture();
  loose(looseBall.world);
  Object.assign(looseBall.world.ball, localPoint(looseBall.player, 1.3, 0));
  assert.equal(nearestCarrier(looseBall.world), undefined);
  assert.equal(firstTouchCandidate(looseBall.world)?.id, looseBall.player.id);

  const knockOnBall = fixture();
  loose(knockOnBall.world);
  knockOnBall.player.knockOn = true;
  knockOnBall.world.lastToucherId = knockOnBall.player.id;
  Object.assign(knockOnBall.world.ball, localPoint(knockOnBall.player, 1.8, 0));
  assert.ok(inFirstTouchReach(knockOnBall.player, knockOnBall.world.ball) > 1);
  assert.ok(KNOCK_ON_REACH >= distance(knockOnBall.player, knockOnBall.world.ball));
  assert.equal(firstTouchCandidate(knockOnBall.world)?.id, knockOnBall.player.id);
});

test('sprinting 30 metres in a straight line retains close possession', () => {
  const { world, player, tick } = fixture();
  let maxGap = 0;
  let carrierFrames = 0;
  let frames = 0;
  while (player.x < 30 && frames < 60 * 8) {
    tick({ move: { x: 1, z: 0 }, sprint: true });
    const carrier = nearestCarrier(world);
    assert.ok(!carrier || carrier.id === player.id, `unexpected carrier ${carrier?.id}`);
    assert.equal(world.controlled[0], player.id);
    maxGap = Math.max(maxGap, distance(player, world.ball));
    assert.ok(distance(player, world.ball) <= 2.5, `ball escaped to ${distance(player, world.ball).toFixed(2)}m`);
    if (carrier?.id === player.id) carrierFrames++;
    frames++;
  }
  const carrierShare = carrierFrames / frames;
  console.log(`sprint dribble: ${frames} frames; carrier ${Math.round(carrierShare * 100)}%; max gap ${maxGap.toFixed(2)}m`);
  assert.ok(player.x >= 30);
});

test('a 90 degree sprint turn retains possession across all 40 phase offsets', () => {
  let worstGap = 0;
  let lowestCarrierFrames = Infinity;
  for (let phase = 0; phase < 40; phase++) {
    const result = sprintTurn(90, phase);
    worstGap = Math.max(worstGap, result.maxGap);
    assert.equal(result.escaped, false, `phase ${phase} escaped after ${result.turnFrame} frames`);
    assert.equal(result.regained, true, `phase ${phase} did not recover within one second`);
    assert.ok(result.maxGap <= 2.5, `phase ${phase} max gap ${result.maxGap.toFixed(2)}m`);
    lowestCarrierFrames = Math.min(lowestCarrierFrames, result.frames);
  }
  console.log(`90 degree turn: 40/40 retained; worst gap ${worstGap.toFixed(2)}m; shortest run ${lowestCarrierFrames} frames`);
});

test('a 120 degree sprint turn can lose the ball from turning alone', () => {
  const escapes: number[] = [];
  let worstGap = 0;
  for (let phase = 0; phase < 40; phase++) {
    const result = sprintTurn(120, phase);
    worstGap = Math.max(worstGap, result.maxGap);
    if (result.escaped) escapes.push(phase);
  }
  console.log(`120 degree turn: ${escapes.length}/40 escaped; worst gap ${worstGap.toFixed(2)}m; phases ${escapes.join(',')}`);
  assert.ok(escapes.length > 0, `no turn phase escaped; worst gap ${worstGap.toFixed(2)}m`);
});

test('a neutral first touch collects ahead and to the side without snapping, but not behind', () => {
  for (const [name, forward, side] of [['ahead', 1.3, 0], ['side', 0, 1.3]] as const) {
    const result = pickup(20, { forward, side });
    assert.ok(result.frames > 0 && result.frames <= 20, `${name} collection took ${result.frames} frames`);
    assert.equal(result.retained, true, `${name} first touch was not retained`);
    assert.ok(result.maxJump <= 0.3 + 1e-9, `${name} first touch jumped ${result.maxJump.toFixed(3)}m`);
  }
  const behind = pickup(60, { forward: -1.3 });
  assert.equal(behind.frames, -1);
});

test('a side pass at 1.2 metres is controlled at 8 and 12 m/s, targeted or not', () => {
  for (const speed of [8, 12]) {
    for (const targeted of [false, true]) {
      const result = sidePass({ speed, targeted });
      assert.ok(result.frames > 0 && result.frames <= 20, `speed=${speed}, targeted=${targeted} was missed after ${result.frames} frames`);
      assert.equal(result.retained, true, `speed=${speed}, targeted=${targeted} was not retained`);
      assert.ok(result.maxJump <= 0.3 + 1e-9, `speed=${speed}, targeted=${targeted} jumped ${result.maxJump.toFixed(3)}m`);
      assert.equal(nearestCarrier(result.world)?.id, result.player.id);
    }
  }
});

test('first-touch collection outcomes are player- and team-agnostic', () => {
  for (const side of [0, 1.3]) {
    const results = [
      pickup(20, { forward: side ? 0 : 1.3, side, team: 0, cpu: false }),
      pickup(20, { forward: side ? 0 : 1.3, side, team: 0, cpu: true }),
      pickup(20, { forward: side ? 0 : 1.3, side: side ? -1.3 : 0, team: 1, cpu: false }),
    ];
    const frames = results.map((result) => result.frames);
    assert.ok(results.every((result) => result.frames > 0 && result.frames <= 20 && result.retained
      && result.maxJump <= 0.3 + 1e-9), `pickup outcomes ${frames}`);
    assert.ok(Math.max(...frames) - Math.min(...frames) <= 1, `pickup timing differs by over one frame: ${frames}`);
  }
  for (const speed of [8, 12]) {
    for (const targeted of [false, true]) {
      const results = [
        sidePass({ speed, targeted, team: 0, cpu: false }),
        sidePass({ speed, targeted, team: 0, cpu: true }),
        sidePass({ speed, targeted, team: 1, cpu: false }),
      ];
      const frames = results.map((result) => result.frames);
      assert.ok(results.every((result) => result.frames > 0 && result.frames <= 20 && result.retained
        && result.maxJump <= 0.3 + 1e-9), `pass outcomes ${frames}`);
      assert.ok(Math.max(...frames) - Math.min(...frames) <= 1, `pass timing differs by over one frame: ${frames}`);
    }
  }
});

test('first-touch candidates respect dispossession, passing, opponent possession, and shot speed', () => {
  const dispossessed = fixture();
  loose(dispossessed.world);
  dispossessed.player.touchCd = 1.2;
  Object.assign(dispossessed.world.ball, localPoint(dispossessed.player, 1, 0));
  assert.equal(firstTouchCandidate(dispossessed.world), undefined);

  const ownPass = fixture();
  loose(ownPass.world);
  const target = ownPass.world.players.find((p) => p.team === ownPass.player.team && p.id !== ownPass.player.id)!;
  target.x = -20; target.z = -20;
  ownPass.world.passTarget = target.id;
  Object.assign(ownPass.world.ball, localPoint(ownPass.player, 1, 0));
  assert.equal(firstTouchCandidate(ownPass.world), undefined);

  const uncontrolled = fixture();
  loose(uncontrolled.world);
  const teammate = uncontrolled.world.players.find((p) => p.team === uncontrolled.player.team
    && p.id !== uncontrolled.player.id)!;
  uncontrolled.player.x = -20; uncontrolled.player.z = -20;
  teammate.x = 0; teammate.z = 0; teammate.facing = Math.PI / 2;
  uncontrolled.world.ball.x = 1.3; uncontrolled.world.ball.z = 0;
  assert.equal(uncontrolled.world.controlled[teammate.team], uncontrolled.player.id);
  assert.notEqual(uncontrolled.world.controlled[teammate.team], teammate.id);
  assert.equal(firstTouchCandidate(uncontrolled.world), undefined);

  const opponentTouched = fixture();
  loose(opponentTouched.world);
  opponentTouched.player.facing = Math.PI / 2;
  const opponent = opponentTouched.world.players.find((p) => p.team !== opponentTouched.player.team && p.slot !== 'GK')!;
  opponentTouched.world.lastToucherId = opponent.id;
  opponentTouched.world.lastTouch = opponent.team;
  opponentTouched.world.ball.x = 1;
  opponentTouched.world.ball.z = 0;
  opponentTouched.world.ball.vx = -2;
  assert.equal(firstTouchCandidate(opponentTouched.world), undefined);
  opponentTouched.world.ball.x = 0.5;
  assert.equal(nearestCarrier(opponentTouched.world)?.id, opponentTouched.player.id);

  const shot = fixture();
  loose(shot.world);
  shot.world.ball.x = 1; shot.world.ball.z = 0;
  shot.world.ball.vx = CONTROL_SPEED + 1;
  assert.equal(firstTouchCandidate(shot.world), undefined);

  const passerTest = fixture();
  loose(passerTest.world);
  passerTest.player.x = 0; passerTest.player.z = 0;
  passerTest.world.lastToucherId = passerTest.player.id;
  passerTest.world.ball.x = 1.2; passerTest.world.ball.z = 0;
  passerTest.world.ball.vx = 4;
  assert.equal(firstTouchCandidate(passerTest.world), undefined);

  const knockOn = fixture();
  loose(knockOn.world);
  knockOn.player.knockOn = true;
  knockOn.world.lastToucherId = knockOn.player.id;
  Object.assign(knockOn.world.ball, localPoint(knockOn.player, KNOCK_ON_REACH + 0.01, 0));
  assert.equal(firstTouchCandidate(knockOn.world), undefined);
  knockOn.player.touchCd = 0.1;
  Object.assign(knockOn.world.ball, localPoint(knockOn.player, 1.8, 0));
  assert.equal(firstTouchCandidate(knockOn.world), undefined);

  const keeperTest = fixture();
  loose(keeperTest.world);
  keeperTest.player.x = -20; keeperTest.player.z = -20;
  const keeper = keeperTest.world.players.find((p) => p.team === keeperTest.player.team && p.slot === 'GK')!;
  keeper.x = keeper.z = 0; keeper.facing = Math.PI / 2;
  keeperTest.world.ball.x = 1; keeperTest.world.ball.z = 0;
  assert.equal(nearestCarrier(keeperTest.world), undefined);
  assert.equal(firstTouchCandidate(keeperTest.world), undefined);
});

test('human assisted trapping steers within the cone but not at 90 degrees, and never steers CPU players', () => {
  const approaching = fixture();
  loose(approaching.world);
  const angle = 40 * Math.PI / 180;
  approaching.world.ball.x = Math.cos(angle) * 2.5;
  approaching.world.ball.z = Math.sin(angle) * 2.5;
  let collectedFrame = -1;
  let maxJump = 0;
  let previous = relativeBall(approaching.player, approaching.world.ball);
  for (let frame = 0; frame < 60; frame++) {
    approaching.tick({ move: { x: 1, z: 0 } });
    const current = relativeBall(approaching.player, approaching.world.ball);
    maxJump = Math.max(maxJump, distance(previous, current));
    previous = current;
    if (nearestCarrier(approaching.world)?.id === approaching.player.id) { collectedFrame = frame + 1; break; }
  }
  assert.ok(collectedFrame > 0 && collectedFrame <= 60);
  assert.ok(maxJump <= 0.3 + 1e-9, `assisted first touch jumped ${maxJump.toFixed(3)}m`);

  const sideways = fixture();
  loose(sideways.world);
  sideways.world.ball.x = 0;
  sideways.world.ball.z = 2.5;
  const noBall = fixture();
  loose(noBall.world);
  noBall.world.ball.x = -30;
  noBall.world.ball.z = -20;
  for (let frame = 0; frame < 45; frame++) {
    sideways.tick({ move: { x: 1, z: 0 } });
    noBall.tick({ move: { x: 1, z: 0 } });
  }
  assert.deepEqual(
    [sideways.player.x, sideways.player.z, sideways.player.vx, sideways.player.vz],
    [noBall.player.x, noBall.player.z, noBall.player.vx, noBall.player.vz],
  );

  const cpu = fixture({ cpu: true });
  loose(cpu.world);
  cpu.world.ball.x = Math.cos(angle) * 2.5;
  cpu.world.ball.z = Math.sin(angle) * 2.5;
  const cpuNoBall = fixture({ cpu: true });
  loose(cpuNoBall.world);
  cpuNoBall.world.ball.x = -30;
  cpuNoBall.world.ball.z = -20;
  for (let frame = 0; frame < 45; frame++) {
    cpu.tick({ move: { x: 1, z: 0 } });
    cpuNoBall.tick({ move: { x: 1, z: 0 } });
  }
  assert.deepEqual(
    [cpu.player.x, cpu.player.z, cpu.player.vx, cpu.player.vz],
    [cpuNoBall.player.x, cpuNoBall.player.z, cpuNoBall.player.vx, cpuNoBall.player.vz],
  );
});
