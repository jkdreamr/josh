import type * as T from 'three';

type Three = typeof import('three');

export type BoneBind = {
  bone: T.Bone;
  parentName: string | null;
  bindWorld: T.Quaternion;
  parentBindWorld: T.Quaternion;
};

export type SoccerPose = 'run' | 'dribble' | 'pass' | 'shoot' | 'tackle' | 'slide' | 'header' | 'ready' | 'dive' | 'catch' | 'celebrate';

export function captureSoccerBoneBinds(THREE: Three, root: T.Object3D, body: T.Object3D): BoneBind[] {
  root.updateMatrixWorld(true);
  const rootInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bones: T.Bone[] = [];
  body.traverse((object) => {
    const bone = object as T.Bone;
    if (bone.isBone) bones.push(bone);
  });
  const bindWorld = new Map<string, T.Quaternion>();
  for (const bone of bones) bindWorld.set(bone.name, rootInverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  return bones.map((bone) => {
    const parent = bone.parent as T.Bone | null;
    const parentName = parent?.isBone ? parent.name : null;
    const parentBindWorld = parentName
      ? bindWorld.get(parentName)!.clone()
      : parent ? rootInverse.clone().multiply(parent.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Quaternion();
    return { bone, parentName, bindWorld: bindWorld.get(bone.name)!.clone(), parentBindWorld };
  });
}

export function characterSpaceBoneTarget(
  bindWorld: T.Quaternion,
  parentBindWorld: T.Quaternion,
  parentTargetWorld: T.Quaternion | null,
  rotation: T.Quaternion,
) {
  if (!parentTargetWorld) return rotation.clone().multiply(bindWorld);
  return parentTargetWorld.clone()
    .multiply(parentBindWorld.clone().invert())
    .multiply(rotation)
    .multiply(bindWorld);
}

function poseValue(pose: Map<string, [number, number, number]>, name: string, x: number, y = 0, z = 0) {
  pose.set(name, [x, y, z]);
}

export function animateSoccerSkeleton(
  THREE: Three,
  root: T.Object3D,
  binds: BoneBind[],
  phase: number,
  speed: number,
  poseName: SoccerPose | null,
  actionProgress = 0,
  carrying = false,
) {
  const run = Math.min(1, speed / 7);
  const stride = Math.sin(phase) * run;
  const pose = new Map<string, [number, number, number]>();
  const putSide = (key: string, side: 'l' | 'r', x: number, y = 0, z = 0) => poseValue(pose, `${key}_${side}`, x, y, z);
  const lean = Math.min(0.24, speed * 0.027);
  poseValue(pose, 'pelvis', 0, 0, 0);
  poseValue(pose, 'spine_01', -lean, 0, 0);
  poseValue(pose, 'spine_02', -lean * 0.55, 0, 0);
  putSide('thigh', 'l', stride * 0.62);
  putSide('thigh', 'r', -stride * 0.62);
  putSide('calf', 'l', Math.max(0, -stride) * 0.45);
  putSide('calf', 'r', Math.max(0, stride) * 0.45);
  putSide('upperarm', 'l', -stride * 0.34, 0, 0.14);
  putSide('upperarm', 'r', stride * 0.34, 0, -0.14);
  putSide('lowerarm', 'l', -Math.max(0, stride) * 0.22);
  putSide('lowerarm', 'r', -Math.max(0, -stride) * 0.22);

  const p = Math.max(0, Math.min(1, actionProgress));
  switch (poseName) {
    case 'dribble':
      putSide('thigh', 'r', Math.sin(phase * 0.7) * 0.22);
      putSide('upperarm', 'l', -0.12, 0, 0.18);
      poseValue(pose, 'spine_01', 0.08, 0, 0);
      break;
    case 'pass':
    case 'shoot': {
      const wind = p < 0.35 ? p / 0.35 : 1 - Math.max(0, p - 0.35) / 0.65;
      putSide('thigh', 'r', -0.68 * wind);
      putSide('calf', 'r', 0.2 + wind * 0.32);
      putSide('upperarm', 'l', -0.55, 0, 0.25);
      putSide('upperarm', 'r', 0.2, 0, -0.3);
      poseValue(pose, 'spine_01', 0.16 * wind, 0.04, 0);
      break;
    }
    case 'tackle':
      putSide('thigh', 'l', -0.55);
      putSide('thigh', 'r', 0.24);
      putSide('calf', 'l', 0.4);
      poseValue(pose, 'spine_01', 0.32, 0, 0);
      break;
    case 'slide':
      putSide('thigh', 'l', -1.35);
      putSide('thigh', 'r', 0.42);
      putSide('calf', 'l', 0.5);
      putSide('upperarm', 'l', -0.6, 0, 0.7);
      putSide('upperarm', 'r', -0.6, 0, -0.7);
      poseValue(pose, 'spine_01', 1.05, 0, 0);
      poseValue(pose, 'pelvis', 0, 0, 0.6);
      break;
    case 'header':
      putSide('thigh', 'l', -0.3);
      putSide('thigh', 'r', -0.3);
      putSide('calf', 'l', 0.55);
      putSide('calf', 'r', 0.55);
      poseValue(pose, 'spine_01', -0.22, 0, 0);
      putSide('upperarm', 'l', -1.2, 0, 0.35);
      putSide('upperarm', 'r', -1.2, 0, -0.35);
      break;
    case 'ready':
      putSide('thigh', 'l', -0.2);
      putSide('thigh', 'r', -0.2);
      putSide('calf', 'l', 0.42);
      putSide('calf', 'r', 0.42);
      putSide('upperarm', 'l', -0.5, 0, 0.65);
      putSide('upperarm', 'r', -0.5, 0, -0.65);
      poseValue(pose, 'spine_01', 0.12, 0, 0);
      break;
    case 'dive':
      putSide('thigh', 'l', -0.25);
      putSide('thigh', 'r', -0.25);
      putSide('upperarm', 'l', -1.35, 0, 1);
      putSide('upperarm', 'r', -1.35, 0, -1);
      poseValue(pose, 'spine_01', 0.7, 0, 0.2);
      break;
    case 'catch':
      putSide('upperarm', 'l', -1, 0, 0.3);
      putSide('upperarm', 'r', -1, 0, -0.3);
      putSide('lowerarm', 'l', -0.8);
      putSide('lowerarm', 'r', -0.8);
      break;
    case 'celebrate':
      putSide('upperarm', 'l', 2.6, 0, 0.2);
      putSide('upperarm', 'r', 2.6, 0, -0.2);
      putSide('lowerarm', 'l', -0.5);
      putSide('lowerarm', 'r', -0.5);
      break;
    default:
      if (carrying) poseValue(pose, 'spine_01', 0.06, 0, 0);
  }

  root.updateMatrixWorld(true);
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const targets = new Map<string, T.Quaternion>();
  const targetRotation = new THREE.Quaternion();
  const targetWorld = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  for (const bind of binds) {
    const angles = pose.get(bind.bone.name) ?? [0, 0, 0];
    targetRotation.setFromEuler(new THREE.Euler(...angles, 'XYZ'));
    const parentTarget = bind.parentName ? targets.get(bind.parentName) ?? bind.parentBindWorld : null;
    targetWorld.copy(characterSpaceBoneTarget(bind.bindWorld, bind.parentBindWorld, parentTarget, targetRotation));
    targets.set(bind.bone.name, targetWorld.clone());
    if (bind.bone.parent) bind.bone.parent.getWorldQuaternion(parentWorld);
    else parentWorld.copy(rootWorld);
    bind.bone.quaternion.copy(parentWorld.invert().multiply(rootWorld.clone().multiply(targetWorld)));
    bind.bone.updateMatrixWorld(true);
  }
}
