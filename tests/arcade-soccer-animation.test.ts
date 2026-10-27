import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  approachAngle,
  bindSoccerRig,
  bodyFrameVelocity,
  createSoccerAnimationInput,
  createSoccerAnimator,
  gaitCycleLength,
  gaitPhaseRate,
  kickingFoot,
  playSoccerClip,
  preferredFoot,
  strideAmplitude,
  updateSoccerAnimator,
  wrapAngle,
  type SoccerClip,
} from '../src/os/arcade/games/soccer/player.ts';

const closeTo = (actual: number, expected: number, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
};

test('wrapAngle normalizes finite angles and maps non-finite values to zero', () => {
  closeTo(wrapAngle(3 * Math.PI), -Math.PI);
  closeTo(wrapAngle(-3 * Math.PI / 2), Math.PI / 2);
  closeTo(wrapAngle(0.5), 0.5);
  assert.equal(wrapAngle(Number.NaN), 0);
});

test('approachAngle follows the shortest route and respects its speed cap', () => {
  const crossedPi = approachAngle(3, -3, 100, 1);
  assert.ok(wrapAngle(crossedPi - 3) > 0);
  assert.ok(3 + wrapAngle(-3 - 3) > Math.PI);
  const capped = approachAngle(0, Math.PI, 100, 0.1, 0.5);
  closeTo(Math.abs(wrapAngle(capped)), 0.05);
});

test('gait length is monotonic and phase rate completes one cycle per gait length', () => {
  const speeds = [0.5, 1, 2, 3, 4, 6];
  for (let i = 1; i < speeds.length; i++) {
    assert.ok(gaitCycleLength(speeds[i]!) > gaitCycleLength(speeds[i - 1]!));
  }
  assert.equal(gaitPhaseRate(0), 0);
  for (const speed of speeds) {
    closeTo(gaitPhaseRate(speed) * gaitCycleLength(speed) / speed, Math.PI * 2);
  }
  assert.ok(gaitPhaseRate(6) > gaitPhaseRate(1));
});

test('stride amplitude reproduces the gait cycle length at soccer speeds', () => {
  for (let speed = 1; speed <= 6; speed++) {
    closeTo(strideAmplitude(speed, 1.05) * Math.PI * 2 * 1.05, gaitCycleLength(speed));
  }
});

test('kickingFoot selects the preferred foot and mirrors lateral choices', () => {
  assert.equal(kickingFoot(0, 0, 1, 'r'), 'r');
  assert.equal(kickingFoot(0, 0, 1, 'l'), 'l');
  assert.equal(kickingFoot(0, -1, 0, 'r'), 'l');
  assert.equal(kickingFoot(0, 1, 0, 'r'), 'r');
  assert.equal(kickingFoot(0, 1, 0, 'l'), 'r');
  assert.equal(kickingFoot(0, -1, 0, 'l'), 'l');
  assert.equal(kickingFoot(2 * Math.PI, 0, 1, 'l'), 'l');
});

test('preferredFoot is deterministic and assigns both feet across player IDs', () => {
  const feet = new Set<string>();
  for (let id = 0; id <= 21; id++) {
    const foot = preferredFoot(id);
    assert.equal(preferredFoot(id), foot);
    feet.add(foot);
  }
  assert.deepEqual(feet, new Set(['l', 'r']));
});

test('bodyFrameVelocity maps forward and lateral movement with the expected signs', () => {
  const out = { forward: 0, side: 0 };
  bodyFrameVelocity(0, 1, 5, out);
  closeTo(out.forward, 5);
  closeTo(out.side, 1);
  bodyFrameVelocity(Math.PI / 2, 5, 0, out);
  closeTo(out.forward, 5);
  closeTo(out.side, 0);
  bodyFrameVelocity(Math.PI / 2, 0, 5, out);
  closeTo(out.forward, 0);
  closeTo(out.side, -5);
});

test('headless animator keeps bone rotations and figure position finite through every clip', () => {
  const clips: SoccerClip[] = ['pass', 'shot', 'lob', 'trap', 'tackle', 'slide', 'dive', 'catch', 'celebrate', 'skill'];
  const speeds = [0, 1, 4, 7];
  for (const clip of clips) {
    for (const speed of speeds) {
      const body = new THREE.Group();
      const skeletonRoot = new THREE.Bone();
      const pelvis = new THREE.Bone();
      pelvis.name = 'pelvis';
      skeletonRoot.add(pelvis);
      const spine1 = new THREE.Bone();
      spine1.name = 'spine_01';
      pelvis.add(spine1);
      const spine2 = new THREE.Bone();
      spine2.name = 'spine_02';
      spine1.add(spine2);
      const spine3 = new THREE.Bone();
      spine3.name = 'spine_03';
      spine2.add(spine3);
      const leftThigh = new THREE.Bone();
      leftThigh.name = 'thigh_l';
      leftThigh.position.set(-0.12, -0.05, 0);
      pelvis.add(leftThigh);
      const leftCalf = new THREE.Bone();
      leftCalf.name = 'calf_l';
      leftCalf.position.y = -0.48;
      leftThigh.add(leftCalf);
      const leftFoot = new THREE.Bone();
      leftFoot.name = 'foot_l';
      leftFoot.position.y = -0.45;
      leftCalf.add(leftFoot);
      const rightThigh = new THREE.Bone();
      rightThigh.name = 'thigh_r';
      rightThigh.position.set(0.12, -0.05, 0);
      pelvis.add(rightThigh);
      const rightCalf = new THREE.Bone();
      rightCalf.name = 'calf_r';
      rightCalf.position.y = -0.48;
      rightThigh.add(rightCalf);
      const rightFoot = new THREE.Bone();
      rightFoot.name = 'foot_r';
      rightFoot.position.y = -0.45;
      rightCalf.add(rightFoot);
      body.add(skeletonRoot);
      const anim = createSoccerAnimator(THREE, 0.618, 'r');
      bindSoccerRig(THREE, anim, body);
      playSoccerClip(anim, clip, -1, 0.8);
      const input = createSoccerAnimationInput();
      input.vx = speed;
      input.vz = 0;
      input.scale = 1.14;
      input.carrying = true;
      input.charge = 0.7;
      const bones = [pelvis, spine1, spine2, spine3, leftThigh, leftCalf, leftFoot, rightThigh, rightCalf, rightFoot];
      for (let frame = 0; frame < 600; frame++) {
        input.time = frame / 60;
        updateSoccerAnimator(anim, input, 1 / 60);
        assert.ok(Number.isFinite(anim.figure.position.x));
        assert.ok(Number.isFinite(anim.figure.position.y));
        assert.ok(Number.isFinite(anim.figure.position.z));
        for (const bone of bones) {
          const quaternion = bone.quaternion;
          assert.ok(Number.isFinite(quaternion.x));
          assert.ok(Number.isFinite(quaternion.y));
          assert.ok(Number.isFinite(quaternion.z));
          assert.ok(Number.isFinite(quaternion.w));
          closeTo(quaternion.length(), 1, 1e-5);
        }
      }
      assert.equal(anim.clip, null, `${clip} did not end at speed ${speed}`);
    }
  }
});
