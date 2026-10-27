import type * as T from 'three';

export type BoneBind = {
  bone: T.Bone;
  bindWorld: T.Quaternion;
  parentBindWorld: T.Quaternion;
};

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

export function animateSoccerSkeleton(
  root: T.Object3D,
  phase: number,
  speed: number,
  action: string | null,
) {
  const run = Math.min(1, speed / 6);
  const stride = Math.sin(phase) * run;
  root.traverse((object) => {
    const bone = object as T.Bone;
    if (!bone.isBone) return;
    if (/thigh_l|upperleg_l/i.test(bone.name)) bone.rotation.x = stride * 0.65;
    else if (/thigh_r|upperleg_r/i.test(bone.name)) bone.rotation.x = -stride * 0.65;
    else if (/upperarm_l|arm_l/i.test(bone.name)) bone.rotation.z = -stride * 0.28;
    else if (/upperarm_r|arm_r/i.test(bone.name)) bone.rotation.z = stride * 0.28;
    else if (/spine|chest/i.test(bone.name)) bone.rotation.x = action === 'slide' ? 0.9 : -run * 0.12;
  });
}
