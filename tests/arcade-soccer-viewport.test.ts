import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROADCAST, CAMERA_LIMITS, NEAR_SIDE, broadcastFov, broadcastGoal, broadcastGroundZ, createCameraRig, stepCameraRig, type CameraGoal, type Vec3 } from '../src/os/arcade/games/soccer/camera.ts';
import { FIELD } from '../src/os/arcade/games/soccer/field.ts';
import { createWorld, STEP, type World } from '../src/os/arcade/games/soccer/logic.ts';

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const liveWorld = () => { const world = createWorld(); world.phase = 'live'; world.restart = null; return world; };
const ballAt = (world: World, x: number, z: number) => {
  world.ball.x = x; world.ball.z = z; world.ball.vx = 0; world.ball.vz = 0;
  const player = world.players.find((p) => p.id === world.controlled[0])!;
  player.x = x; player.z = z;
};
// Ground z at the top edge of the bottom HUD band for a goal.
const bandZ = (goal: CameraGoal, safeBottom: number) => broadcastGroundZ(goal.target.z, goal.fov, -1 + 2 * safeBottom);

test('broadcast keeps #268 framing in the open play of landscape windows and fullscreen', () => {
  for (const aspect of [16 / 10, 1512 / 982, 16 / 9, 1440 / 712, 1920 / 1080, 2.4]) {
    const fov = broadcastFov(aspect);
    assert.ok(fov >= BROADCAST.fov && fov <= BROADCAST.fov * 1.05, `aspect ${aspect.toFixed(2)} keeps the telecam lens`);
    const world = liveWorld(); ballAt(world, 0, 0);
    const plain = broadcastGoal(world, 0, aspect), guarded = broadcastGoal(world, 0, aspect, 0.16);
    assert.deepEqual(guarded.target, plain.target, 'centre-circle play is already above the HUD');
    assert.deepEqual(guarded.position, plain.position);
  }
});

test('the near touchline stays above the bottom HUD band at every desktop viewport', () => {
  for (const [w, h, safeBottom] of [[920, 602, 0.17], [1440, 900, 0.13], [1440, 712, 0.16], [1512, 982, 0.13], [1920, 1080, 0.14], [1200, 1000, 0.15]] as const) {
    const aspect = w / h;
    for (const x of [-40, 0, 40]) {
      const world = liveWorld(); ballAt(world, x, -FIELD.width / 2 + 0.5);
      const plain = broadcastGoal(world, 0, aspect), goal = broadcastGoal(world, 0, aspect, safeBottom);
      assert.ok(bandZ(goal, safeBottom) <= -FIELD.width / 2 - 0.5, `${w}x${h}: touchline clears the HUD (${bandZ(goal, safeBottom).toFixed(2)})`);
      assert.ok(bandZ(plain, safeBottom) > -FIELD.width / 2, `${w}x${h}: unguarded framing hid it under the HUD`);
      assert.ok(gap(subtract(goal.position, goal.target), subtract(plain.position, plain.target)) < 1e-9, 'the guard only translates the shot');
    }
  }
});

test('the near-side guard never pans the frame bottom onto the near boards and stand', () => {
  for (const safeBottom of [0, 0.13, 0.2, 0.3, 0.45, 0.9]) {
    for (const aspect of [1.2, 16 / 10, 16 / 9, 2.47]) {
      const world = liveWorld(); ballAt(world, 0, -FIELD.width / 2 + 0.5);
      const goal = broadcastGoal(world, 0, aspect, safeBottom);
      assert.ok(broadcastGroundZ(goal.target.z, goal.fov, -1) >= -FIELD.width / 2 - NEAR_SIDE.floor - 1e-9);
    }
  }
});

test('narrow landscape windows widen the lens instead of cropping the pitch width', () => {
  const wide = broadcastFov(16 / 10), narrow = broadcastFov(1.2);
  const horizontal = (fov: number, aspect: number) => Math.atan(Math.tan(fov * Math.PI / 360) * aspect);
  assert.equal(wide, BROADCAST.fov);
  assert.ok(Math.abs(horizontal(narrow, 1.2) - horizontal(wide, 16 / 10)) < 1e-9);
});

test('resizing into fullscreen moves the broadcast within the camera spring limits', () => {
  const world = liveWorld(); ballAt(world, 10, -FIELD.width / 2 + 1);
  const rig = createCameraRig();
  stepCameraRig(rig, broadcastGoal(world, 0, 920 / 602, 0.17), 0);
  for (let i = 0; i < 120; i++) stepCameraRig(rig, broadcastGoal(world, 0, 920 / 602, 0.17), STEP);
  const offset = subtract(rig.position, rig.target.value);
  for (let frame = 0; frame < 240; frame++) {
    const [aspect, safeBottom] = frame < 120 ? [1440 / 712, 0.16] : [1440 / 900, 0.13];
    const previous = { ...rig.position }, target = { ...rig.target.value };
    stepCameraRig(rig, broadcastGoal(world, 0, aspect, safeBottom), STEP);
    assert.ok(gap(previous, rig.position) <= CAMERA_LIMITS.speed * STEP + 1e-9);
    assert.ok(gap(target, rig.target.value) <= CAMERA_LIMITS.speed * STEP + 1e-9);
    assert.ok(gap(offset, subtract(rig.position, rig.target.value)) < 1e-9, 'pitch and yaw stay fixed across the resize');
  }
});
