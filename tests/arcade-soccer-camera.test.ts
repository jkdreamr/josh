import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_LIMITS, broadcastGoal, cameraGoal, createCameraRig, stepCameraBasis, stepCameraRig, type CameraMode, type Vec3 } from '../src/os/arcade/games/soccer/camera.ts';
import { IDENTITY_BASIS, screenToWorld } from '../src/os/arcade/games/soccer/input.ts';
import { createWorld, STEP, stepWorld, switchPlayer, transferControl } from '../src/os/arcade/games/soccer/logic.ts';

const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

test('manual, automatic, co-op and pass-receive switches translate broadcast framing without rotating it', () => {
  const world = createWorld(); world.phase = 'live'; world.restart = null;
  const rig = createCameraRig();
  stepCameraRig(rig, broadcastGoal(world, 0, 16 / 9), 0);
  const offset = subtract(rig.position, rig.target.value);
  for (let frame = 0; frame < 600; frame++) {
    if (frame === 60) switchPlayer(world, 0);
    if (frame === 120) transferControl(world, 0, 8);
    if (frame === 180) {
      world.players[4]!.human = true;
      transferControl(world, 0, 7, 4);
    }
    if (frame === 240) {
      const player = world.players[world.controlled[0]]!;
      world.ball.x = player.x; world.ball.z = player.z;
      stepWorld(world, STEP, new Map([[player.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.8, aim: { x: 1, z: 0 } }]]));
      assert.ok(world.ball.vx !== 0 || world.ball.vz !== 0, 'a real pass must be kicked');
    } else if (frame > 240) stepWorld(world, STEP);
    const previous = { ...rig.position }, target = { ...rig.target.value };
    stepCameraRig(rig, broadcastGoal(world, 0, 16 / 9), STEP);
    assert.ok(gap(previous, rig.position) <= CAMERA_LIMITS.speed * STEP + 1e-9);
    assert.ok(gap(target, rig.target.value) <= CAMERA_LIMITS.speed * STEP + 1e-9);
    assert.ok(gap(offset, subtract(rig.position, rig.target.value)) < 1e-9, 'broadcast pitch and yaw stay fixed');
  }
});

test('restarts, set pieces, intro/replay exit, resize and FX share speed, acceleration and zoom limits', () => {
  for (const dt of [1 / 30, STEP, 1 / 120]) {
    const world = createWorld(), rig = createCameraRig();
    stepCameraRig(rig, cameraGoal(world, 0, 16 / 9, 'broadcast'), 0);
    let velocity = { x: 0, y: 0, z: 0 }, zoomVelocity = 0;
    const modes: CameraMode[] = ['intro', 'broadcast', 'setpiece', 'replay', 'end', 'broadcast'];
    for (let frame = 0; frame < 720; frame++) {
      if (frame % 120 === 0) {
        world.ball.x = -world.ball.x + 20;
        world.ball.z = -world.ball.z + 12;
        world.endsSwapped = !world.endsSwapped;
      }
      world.setPiece = { kind: 'penalty', takerId: 6, aim: { x: 52.5, y: 1, z: 2 }, option: 'shot', curl: 0, direct: true, wall: [], keeperDive: null, cpuDelay: 2.2 };
      const goal = cameraGoal(world, 0, frame % 240 < 120 ? 16 / 9 : 0.5, modes[Math.floor(frame / 120)]!, (frame % 120) / 120);
      goal.position.x += frame % 2 ? 0.3 : -0.3;
      goal.target.x += frame % 2 ? 0.3 : -0.3;
      goal.fov += frame % 2 ? 4 : -4;
      const previous = { ...rig.position }, target = { ...rig.target.value }, zoom = rig.zoom.value.x;
      stepCameraRig(rig, goal, dt);
      const nextVelocity = subtract(rig.position, previous);
      nextVelocity.x /= dt; nextVelocity.y /= dt; nextVelocity.z /= dt;
      const nextZoomVelocity = (rig.zoom.value.x - zoom) / dt;
      assert.ok(gap(previous, rig.position) <= CAMERA_LIMITS.speed * dt + 1e-8);
      assert.ok(gap(target, rig.target.value) <= CAMERA_LIMITS.speed * dt + 1e-8);
      assert.ok(gap(velocity, nextVelocity) <= CAMERA_LIMITS.acceleration * dt + 1e-8);
      assert.ok(Math.abs(nextZoomVelocity) <= CAMERA_LIMITS.zoomSpeed + 1e-8);
      assert.ok(Math.abs(nextZoomVelocity - zoomVelocity) <= CAMERA_LIMITS.zoomAcceleration * dt + 1e-8);
      velocity = nextVelocity; zoomVelocity = nextZoomVelocity;
    }
  }
});

test('camera-relative held input is invariant to switches and frozen during replay and set pieces', () => {
  const world = createWorld();
  let basis = stepCameraBasis(IDENTITY_BASIS, world, 0, 16 / 9, 'broadcast', 0);
  for (let i = 0; i < 180; i++) basis = stepCameraBasis(basis, world, 0, 16 / 9, 'broadcast', STEP);
  const move = screenToWorld({ x: 0.6, z: -0.8 }, basis);
  transferControl(world, 0, 8); world.ball.vx = 40;
  for (const mode of ['broadcast', 'intro', 'replay', 'setpiece'] as const) {
    const next = stepCameraBasis(basis, world, 0, 16 / 9, mode, STEP);
    assert.deepEqual(screenToWorld({ x: 0.6, z: -0.8 }, next), move);
  }
  world.endsSwapped = true;
  for (let frame = 0; frame < 150; frame++) {
    const next = stepCameraBasis(basis, world, 0, 0.5, 'broadcast', STEP);
    const angle = Math.acos(Math.min(1, basis.forward.x * next.forward.x + basis.forward.z * next.forward.z));
    assert.ok(angle <= Math.PI / 2 * STEP + 1e-9);
    assert.ok(Math.abs(Math.hypot(next.forward.x, next.forward.z) - 1) < 1e-9);
    assert.ok(Math.abs(next.forward.x * next.right.x + next.forward.z * next.right.z) < 1e-9);
    basis = next;
  }
  assert.ok(basis.forward.x < -0.999);
});

test('switching only has a small influence on the ball-centred broadcast goal', () => {
  const world = createWorld();
  world.players[6]!.x = -50; world.players[6]!.z = -30;
  world.players[8]!.x = 50; world.players[8]!.z = 30;
  const before = broadcastGoal(world, 0, 16 / 9);
  transferControl(world, 0, 8);
  assert.ok(gap(before.target, broadcastGoal(world, 0, 16 / 9).target) <= 3.6);
});
