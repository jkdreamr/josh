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
  gaitDutyFactor,
  SOCCER_TOE_LENGTH,
  solveSoccerLeg,
  soccerFootTarget,
  soccerTouchPhase,
  SOCCER_CLIP_CONTACT,
  kickClipStartTime,
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
  const clips: SoccerClip[] = ['pass', 'shot', 'lob', 'trap', 'tackle', 'slide', 'dive', 'catch', 'celebrate', 'skill', 'plant', 'touch'];
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

function legFixture() {
  const anim = createSoccerAnimator(THREE, 0, 'l');
  const body = new THREE.Group();
  const pelvis = new THREE.Bone(); pelvis.name = 'pelvis'; pelvis.position.y = 0.98;
  body.add(pelvis);
  const feet: THREE.Bone[] = [];
  for (const side of ['l', 'r']) {
    const thigh = new THREE.Bone(); thigh.name = `thigh_${side}`; thigh.position.set(side === 'l' ? 0.12 : -0.12, -0.05, 0);
    const calf = new THREE.Bone(); calf.name = `calf_${side}`; calf.position.y = -0.48;
    const foot = new THREE.Bone(); foot.name = `foot_${side}`; foot.position.y = -0.45;
    pelvis.add(thigh); thigh.add(calf); calf.add(foot); feet.push(foot);
  }
  bindSoccerRig(THREE, anim, body);
  return { anim, feet };
}

function makeHumanFixture(scale = 1.14) {
  const root = new THREE.Group(); root.scale.setScalar(scale);
  const body = new THREE.Group(), skeleton = new THREE.Bone(), pelvis = new THREE.Bone();
  skeleton.name = 'Root'; skeleton.position.set(0, 0.0005032122135162354, 6.100162863731384e-8);
  skeleton.quaternion.set(-0.7071067690849304, 0, 0, 0.7071067690849304);
  pelvis.name = 'pelvis'; pelvis.position.set(0, -0.007588079199194908, 1.0123034715652466);
  pelvis.quaternion.set(0.5726171135902405, 0, 0, 0.8198229670524597);
  body.add(skeleton); skeleton.add(pelvis);
  const feet: THREE.Bone[] = [];
  for (const [side, sign] of [['l', 1], ['r', -1]] as const) {
    const thigh = new THREE.Bone(), calf = new THREE.Bone(), foot = new THREE.Bone();
    thigh.name = `thigh_${side}`; calf.name = `calf_${side}`; foot.name = `foot_${side}`;
    thigh.position.set(sign * 0.11354927718639374, -0.001584816025570035, -0.011675759218633175);
    thigh.quaternion.set(-0.9632158875465393, sign * -0.07474144548177719, sign * 0.22766388952732086, 0.12164734303951263);
    calf.position.set(sign * -9.313225746154785e-9, 0.48210158944129944, -1.862645149230957e-9);
    calf.quaternion.set(0.058581236749887466, sign * 0.24581864476203918, sign * -0.022847367450594902, 0.9672743082046509);
    foot.position.set(sign * 6.8248482421040535e-9, 0.4546215236186981, 5.820766091346741e-10);
    foot.quaternion.set(-0.5431916117668152, sign * -0.03796147555112839, sign * 0.03293899819254875, 0.838103175163269);
    pelvis.add(thigh); thigh.add(calf); calf.add(foot); feet.push(foot);
  }
  const anim = createSoccerAnimator(THREE, 0.618, 'r'); root.add(anim.figure);
  bindSoccerRig(THREE, anim, body);
  root.updateMatrixWorld(true);
  const contacts = feet.map(foot => {
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    return [-0.06, SOCCER_TOE_LENGTH].map(z => foot.worldToLocal(new THREE.Vector3(ankle.x, 0, ankle.z + z * scale)));
  });
  const positions = () => feet.map((foot, i) => contacts[i]!.map(point => foot.localToWorld(point.clone())));
  return { anim, root, feet, positions };
}

test('MakeHuman bind calibration is independent of stale ancestor scale matrices', () => {
  for (const scale of [1, 1.14]) {
    const { anim } = makeHumanFixture(scale);
    closeTo(anim.thigh, 0.48210164, 1e-6); closeTo(anim.shin, 0.45462157, 1e-6);
    closeTo(anim.hip, 1.00729966, 1e-6); closeTo(anim.sole, 0.07700158, 1e-6);
  }
});

test('MakeHuman steady gait plants the sole, clears swing, and preserves a full running stride', () => {
  for (const scale of [1, 1.14]) for (const [vx, vz] of [[0, 2], [0, 5], [0, 7], [0, 9], [0, -3], [3, 0]]) {
    const { anim, root, positions } = makeHumanFixture(scale), input = createSoccerAnimationInput();
    input.scale = scale; input.vx = vx!; input.vz = vz!;
    const speed = Math.hypot(vx!, vz!), duty = gaitDutyFactor(speed, (anim.thigh + anim.shin) * scale, scale, anim.sole * scale);
    let previous = positions(), previousStance = [false, false], spread = 0, samples = 0;
    let rotations = anim.rig.map(rig => rig?.bone.quaternion.clone());
    for (let frame = 0; frame < 300; frame++) {
      root.position.x += vx! / 60; root.position.z += vz! / 60; input.time = frame / 60;
      updateSoccerAnimator(anim, input, 1 / 60); root.updateMatrixWorld(true);
      const current = positions(), stance = [0, 1].map(leg => ((anim.phase / (Math.PI * 2) + leg * 0.5) % 1) < duty);
      if (frame > 60) {
        spread = Math.max(spread, Math.abs(current[0]![1]!.z - current[1]![1]!.z));
        current.forEach((points, leg) => {
          const point = points[0]!.y < points[1]!.y ? 0 : 1, low = points[point]!;
          assert.ok(low.y >= -0.02, `${vx},${vz}: sole ${low.y}`);
          if (stance[leg]) closeTo(low.y, 0, 0.02);
          if (stance[leg] && previousStance[leg]) {
            const prev = previous[leg]![point]!;
            assert.ok(Math.hypot(low.x - prev.x, low.z - prev.z) * 60 < 0.4, `${vx},${vz}: stance slip`);
            samples++;
          }
        });
        anim.rig.forEach((rig, i) => {
          const limit = rig?.bone.name.startsWith('calf_') && speed >= 5 ? 0.45 : 0.3;
          if (rig && rotations[i]) assert.ok(rig.bone.quaternion.angleTo(rotations[i]!) <= limit, `${vx},${vz}: ${rig.bone.name} pop`);
        });
      }
      previous = current; previousStance = stance; rotations = anim.rig.map(rig => rig?.bone.quaternion.clone());
    }
    assert.ok(samples > 10);
    if (vz === 7) assert.ok(spread >= 1, `running spread ${spread}`);
  }
});

function kickRotationLimit(anim: ReturnType<typeof createSoccerAnimator>, bone: string) {
  if (anim.clip !== 'pass' && anim.clip !== 'shot' && anim.clip !== 'lob') return 0.3;
  const contact = SOCCER_CLIP_CONTACT[anim.clip], foot = anim.clipSide > 0 ? 'l' : 'r';
  // Exactly the last pre-contact frame and contact frame, on the striking leg only.
  return anim.clipTime > contact - 2 / 60 + 1e-8 && anim.clipTime <= contact + 1e-8 && ['thigh_', 'calf_', 'foot_'].some(name => bone === name + foot) ? 0.6 : 0.3;
}

test('MakeHuman action soles do not penetrate the ground', () => {
  const clips: SoccerClip[] = ['pass', 'shot', 'lob', 'trap', 'tackle', 'slide', 'dive', 'catch', 'celebrate', 'skill', 'plant', 'touch'];
  for (const clip of clips) {
    const { anim, root, positions } = makeHumanFixture(), input = createSoccerAnimationInput(); input.scale = 1.14;
    updateSoccerAnimator(anim, input, 0); playSoccerClip(anim, clip, -1, 0.9);
    let rotations = anim.rig.map(rig => rig?.bone.quaternion.clone());
    for (let frame = 0; frame < 210; frame++) {
      input.time = frame / 60; updateSoccerAnimator(anim, input, 1 / 60); root.updateMatrixWorld(true);
      for (const foot of positions()) assert.ok(Math.min(foot[0]!.y, foot[1]!.y) >= -0.03, `${clip}: foot penetration`);
      anim.rig.forEach((rig, i) => { if (rig && rotations[i]) assert.ok(rig.bone.quaternion.angleTo(rotations[i]!) <= kickRotationLimit(anim, rig.bone.name) + 1e-6, `${clip}: ${rig.bone.name} pop`); });
      rotations = anim.rig.map(rig => rig?.bone.quaternion.clone());
    }
  }
});

test('charged and AI kicks swing from behind to the ball with only a two-frame striking-leg exception', () => {
  for (const clip of ['pass', 'shot', 'lob'] as const) for (const charged of [false, true]) for (const side of [-1, 1]) for (const scale of [1, 1.14]) {
    const { anim, root, positions } = makeHumanFixture(scale), input = createSoccerAnimationInput();
    const leg = side > 0 ? 0 : 1; anim.foot = side > 0 ? 'l' : 'r';
    input.scale = scale; input.carrying = charged; input.charge = charged ? 1 : null; input.chargeClip = clip;
    for (let frame = 0; frame < 60; frame++) updateSoccerAnimator(anim, input, 1 / 60);
    root.updateMatrixWorld(true);
    if (charged) {
      assert.ok(positions()[leg]![1]!.z < -0.1, `${clip}: missing windup`);
      if (clip !== 'pass') assert.ok(anim.last[(16 + leg) * 3]! >= Math.PI / 2 && anim.last[(16 + leg) * 3]! <= 110 * Math.PI / 180);
    }
    let rotations = anim.rig.map(rig => rig?.bone.quaternion.clone());
    const start = kickClipStartTime(clip, charged), frames = Math.round((SOCCER_CLIP_CONTACT[clip] - start) * 60);
    playSoccerClip(anim, clip, side, 1, start);
    input.charge = null;
    for (let frame = 0; frame < 75; frame++) {
      updateSoccerAnimator(anim, input, frame === 0 ? 0 : 1 / 60); root.updateMatrixWorld(true);
      anim.rig.forEach((rig, i) => {
        if (rig && rotations[i]) assert.ok(rig.bone.quaternion.angleTo(rotations[i]!) <= kickRotationLimit(anim, rig.bone.name) + 1e-6, `${clip}/${charged}: ${rig.bone.name} at ${anim.clipTime}`);
      });
      rotations = anim.rig.map(rig => rig?.bone.quaternion.clone());
      if (!charged && frame === 1) assert.ok(positions()[leg]![1]!.z < 0.1, `${clip}: missing AI backswing`);
      if (frame === frames) {
        const point = positions()[leg]![1]!, ball = new THREE.Vector3(0, 0.11, 0.45);
        closeTo(anim.clipTime, SOCCER_CLIP_CONTACT[clip]);
        assert.ok(point.distanceTo(ball) <= 0.15, `${clip}/${charged}/${side}/${scale}: contact ${point.distanceTo(ball)}`);
        if (clip === 'pass') assert.ok(Math.abs(anim.last[(18 + leg) * 3 + 1]!) >= 0.85, 'pass must turn the foot out at contact');
      }
    }
  }
});

test('slide settles at hip height and keeper recoveries last at least 0.4 seconds', () => {
  for (const clip of ['slide', 'dive'] as const) {
    const { anim, root } = makeHumanFixture(), input = createSoccerAnimationInput(); input.scale = 1.14;
    updateSoccerAnimator(anim, input, 0); playSoccerClip(anim, clip, -1, 1);
    for (let frame = 0; frame < 40; frame++) updateSoccerAnimator(anim, input, 1 / 60);
    root.updateMatrixWorld(true);
    if (clip === 'slide') {
      const pelvis = anim.rig[0]!.bone.getWorldPosition(new THREE.Vector3());
      assert.ok(pelvis.y >= 0.12 && pelvis.y <= 0.21, `slide hip ${pelvis.y}`);
    }
    assert.ok(anim.clipDuration >= (clip === 'dive' ? 1.55 : 1.35));
  }
});

test('analytic leg IK round-trips sagittal and lateral targets through FK', () => {
  const out = new Float32Array(3);
  for (const x of [-0.3, 0, 0.3]) for (const z of [-0.4, 0, 0.4]) {
    solveSoccerLeg(x, -0.65, z, 0.48, 0.45, out);
    const thigh = new THREE.Object3D(), calf = new THREE.Object3D(), foot = new THREE.Object3D();
    thigh.rotation.set(out[0]!, 0, out[2]!, 'ZYX'); calf.rotation.x = out[1]!;
    calf.position.y = -0.48; foot.position.y = -0.45; thigh.add(calf); calf.add(foot);
    const point = foot.getWorldPosition(new THREE.Vector3());
    closeTo(point.x, x); closeTo(point.y, -0.65); closeTo(point.z, z);
    assert.ok(out[1]! > 0);
  }
});

test('cadence progresses continuously and duty respects stance reach', () => {
  let lastCadence = 0;
  for (let speed = 0.1; speed <= 9; speed += 0.1) {
    const cadence = gaitPhaseRate(speed) / Math.PI, duty = gaitDutyFactor(speed);
    assert.ok(cadence >= lastCadence && duty > 0 && duty <= 0.62);
    closeTo(duty, gaitDutyFactor(speed - 0.001), 0.002);
    lastCadence = cadence;
  }
  assert.ok(gaitPhaseRate(1) / Math.PI >= 1.8 && gaitPhaseRate(1) / Math.PI <= 2);
  closeTo(gaitPhaseRate(7) / Math.PI, 3.4);
  closeTo(gaitPhaseRate(9) / Math.PI, 4.2);
  closeTo(gaitDutyFactor(1), 0.62); closeTo(gaitDutyFactor(9), 0.2);
  assert.ok(gaitCycleLength(9) * gaitDutyFactor(9) <= 1.15);
});

test('stance targets and bound-rig feet have zero world slip and grounded FK', () => {
  const a = new Float32Array(3), b = new Float32Array(3);
  for (const speed of [1, 3, 5, 7, 9]) for (const direction of [[0, 1], [0, -1], [1, 0]]) {
    const { anim, feet } = legFixture();
    const input = createSoccerAnimationInput();
    input.vx = direction[0]! * speed; input.vz = direction[1]! * speed;
    const dt = 1 / 600;
    for (let fraction = 0.05; fraction < 0.95; fraction += 0.05) {
      const phase = fraction * gaitDutyFactor(speed) * Math.PI * 2;
      soccerFootTarget(phase, speed, input.vz, input.vx, a);
      soccerFootTarget(phase + gaitPhaseRate(speed) * dt, speed, input.vz, input.vx, b);
      closeTo((b[0]! - a[0]!) / dt, -input.vx, 0.005);
      closeTo((b[2]! - a[2]!) / dt, -input.vz, 0.005);
      anim.phase = phase; updateSoccerAnimator(anim, input, 0);
      const before = feet[0]!.localToWorld(new THREE.Vector3(0, 0, SOCCER_TOE_LENGTH));
      closeTo(before.y, 0, 0.02);
      anim.phase = phase + gaitPhaseRate(speed) * dt; updateSoccerAnimator(anim, input, 0);
      const after = feet[0]!.localToWorld(new THREE.Vector3(0, 0, SOCCER_TOE_LENGTH));
      closeTo((after.x - before.x) / dt, -input.vx, Math.max(0.01, speed * 0.05));
      closeTo((after.z - before.z) / dt, -input.vz, Math.max(0.01, speed * 0.05));
    }
  }
});

test('gait limits pelvis drop and keeps heel/toe contacts above ground including flight', () => {
  for (const scale of [1, 1.14]) {
    const { anim, feet } = legFixture(); const input = createSoccerAnimationInput();
    input.scale = scale; anim.figure.scale.setScalar(scale);
    updateSoccerAnimator(anim, input, 0);
    const idleHeight = anim.figure.position.y * scale;
    for (const speed of [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9]) for (const direction of [[0, 1], [0, -1], [1, 0]]) {
      input.vx = direction[0]! * speed; input.vz = direction[1]! * speed;
      let minHeight = Infinity, maxHeight = -Infinity;
      for (let frame = 0; frame < 240; frame++) {
        anim.phase = frame / 240 * Math.PI * 2;
        updateSoccerAnimator(anim, input, 0);
        const height = anim.figure.position.y * scale;
        minHeight = Math.min(minHeight, height); maxHeight = Math.max(maxHeight, height);
        assert.ok(idleHeight - height <= (speed <= 7 ? 0.06 : 0.10) + 1e-6);
        for (let leg = 0; leg < 2; leg++) {
          const heel = feet[leg]!.localToWorld(new THREE.Vector3(0, 0, -0.06));
          const toe = feet[leg]!.localToWorld(new THREE.Vector3(0, 0, SOCCER_TOE_LENGTH));
          const contact = Math.min(heel.y, toe.y);
          assert.ok(contact >= -0.02, `speed ${speed}, phase ${anim.phase}, contact ${contact}`);
          const u = ((anim.phase / (Math.PI * 2) + leg * 0.5) % 1);
          if (u < gaitDutyFactor(speed, 0.93 * scale, scale)) closeTo(contact, 0, 0.02);
        }
      }
      if (speed >= 5) assert.ok(maxHeight - minHeight > 0.01, 'flight raises the pelvis');
    }
  }
});

test('kick start times retain a two-frame charged strike and three-frame AI backswing', () => {
  for (const clip of Object.keys(SOCCER_CLIP_CONTACT) as (keyof typeof SOCCER_CLIP_CONTACT)[]) {
    const kicking = clip === 'pass' || clip === 'shot' || clip === 'lob';
    closeTo(SOCCER_CLIP_CONTACT[clip] - kickClipStartTime(clip, true), kicking ? 2 / 60 : 0);
    closeTo(SOCCER_CLIP_CONTACT[clip] - kickClipStartTime(clip, false), (kicking ? 3 : 2) / 60);
    const { anim } = legFixture(); playSoccerClip(anim, clip, 1, 1, kickClipStartTime(clip, true));
    closeTo(anim.clipTime, kickClipStartTime(clip, true));
  }
});

test('interrupting clips crossfades the last applied bone output', () => {
  const { anim } = legFixture(); const input = createSoccerAnimationInput();
  updateSoccerAnimator(anim, input, 1 / 60);
  for (const clip of ['shot', 'dive', 'slide', 'plant', 'touch', 'catch'] as SoccerClip[]) {
    playSoccerClip(anim, clip, -1, 1, 0.1);
    const before = anim.rig.map(rig => rig?.bone.quaternion.clone());
    updateSoccerAnimator(anim, input, 1 / 60);
    anim.rig.forEach((rig, i) => { if (rig && before[i]) assert.ok(rig.bone.quaternion.angleTo(before[i]!) < 0.25); });
  }
});

test('empty rigs and non-finite inputs never emit non-finite output', () => {
  const anim = createSoccerAnimator(THREE, 0, 'r');
  const input = createSoccerAnimationInput();
  updateSoccerAnimator(anim, input, 0);
  input.vx = NaN; input.yaw = NaN; input.time = Infinity;
  updateSoccerAnimator(anim, input, NaN);
  assert.ok(anim.last.every(Number.isFinite));
  assert.ok(anim.figure.position.toArray().every(Number.isFinite));
});

test('dribble contact phase is the preferred foot forward-most swing endpoint', () => {
  const target = new Float32Array(3);
  for (const foot of ['l', 'r'] as const) for (const speed of [1, 5, 9]) {
    const phase = soccerTouchPhase(foot) + (foot === 'r' ? Math.PI : 0);
    soccerFootTarget(phase, speed, speed, 0, target);
    closeTo(target[2]!, gaitCycleLength(speed) * gaitDutyFactor(speed) / 2);
    const endpoint = target[2]!;
    soccerFootTarget(phase - 0.01, speed, speed, 0, target); assert.ok(target[2]! < endpoint);
    soccerFootTarget(phase + 0.01, speed, speed, 0, target); assert.ok(target[2]! < endpoint);
  }
});
