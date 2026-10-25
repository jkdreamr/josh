import type * as T from 'three';
import type { Ball, Player, World } from './logic.ts';

type Three = typeof import('three');

export type PlayerModel = {
  THREE: Three;
  root: T.Group;
  torso: T.Group;
  racketArm: T.Group;
  racketForearm: T.Group;
  leadArm: T.Group;
  legs: [T.Group, T.Group];
  racket: T.Group;
  markers: T.Mesh[];
  trim: T.Mesh[];
  phase: number;
  skinnedRoot: T.Object3D | null;
  handLeft: T.Bone | null;
  handRight: T.Bone | null;
  boneBinds: BoneBind[];
  poseAngles: Map<string, [number, number, number]>;
  ownedMaterials: Set<T.Material>;
  racketCorrection: T.Quaternion;
  debugPose: { name: PoseName; progress: number; position: T.Vector3; rotation: number } | null;
  disposed: boolean;
  wasServingToss: boolean;
  leftPalmWorldPosition: (out?: T.Vector3) => T.Vector3;
  racketHeadWorldPosition: (out?: T.Vector3) => T.Vector3;
  dispose: () => void;
};

export type PoseName = 'idle' | 'ready' | 'run' | 'shuffle' | 'forehand' | 'backhand' | 'slice' | 'lob' | 'smash' | 'volley' | 'serve-ready' | 'toss' | 'serve-contact' | 'serve-follow';

type BoneBind = {
  bone: T.Bone;
  parentName: string | null;
  bindWorld: T.Quaternion;
  parentBindWorld: T.Quaternion;
};

type LoadedPlayerAsset = {
  scene: T.Object3D;
  clone: (source: T.Object3D) => T.Object3D;
};

const teamColors = ['#f3f0e6', '#26364b'];
const accents = ['#b5223a', '#c9e632', '#f1b858', '#48a38c'];
const teamOutfits = [
  { shirt: '#f4f2ea', shorts: '#1f2d44' },
  { shirt: '#20324d', shorts: '#f1efe6' },
] as const;
const loadedAssets = new Map<string, Promise<LoadedPlayerAsset>>();
const hemGeometries = new WeakSet<T.BufferGeometry>();
let warnedAboutPlayerLoadFailure = false;

function playerAssetUrl(seat: number) {
  return seat === 0 || seat === 3 ? '/models/tennis/female.glb' : '/models/tennis/male.glb';
}

function loadPlayerAsset(url: string) {
  let promise = loadedAssets.get(url);
  if (!promise) {
    promise = Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/utils/SkeletonUtils.js'),
    ]).then(async ([loaderModule, skeletonModule]) => {
      const loader = new loaderModule.GLTFLoader();
      const gltf = await loader.loadAsync(url);
      return { scene: gltf.scene, clone: skeletonModule.clone };
    });
    loadedAssets.set(url, promise);
  }
  return promise;
}

function captureBoneBinds(THREE: Three, root: T.Group, body: T.Object3D) {
  root.updateMatrixWorld(true);
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bones: T.Bone[] = [];
  body.traverse((object) => {
    const bone = object as T.Bone;
    if (bone.isBone) bones.push(bone);
  });
  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  const bindWorld = new Map<string, T.Quaternion>();
  for (const bone of bones) {
    bindWorld.set(bone.name, rootWorld.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  }
  return bones.map((bone): BoneBind => {
    const parent = bone.parent as T.Bone | null;
    const parentName = parent?.isBone ? parent.name : null;
    const parentBind = parentName
      ? bindWorld.get(parentName)!.clone()
      : parent
        ? rootWorld.clone().multiply(parent.getWorldQuaternion(new THREE.Quaternion()))
        : new THREE.Quaternion();
    return {
      bone,
      parentName: parentName && byName.has(parentName) ? parentName : null,
      bindWorld: bindWorld.get(bone.name)!.clone(),
      parentBindWorld: parentBind,
    };
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

function groupShortsHem(geometry: T.BufferGeometry) {
  if (hemGeometries.has(geometry) || !geometry.index) return;
  const positions = geometry.getAttribute('position');
  if (!positions) return;
  const shirtGroup = geometry.groups.find((group) => group.materialIndex === 0);
  const shortsGroup = geometry.groups.find((group) => group.materialIndex === 1);
  if (!shirtGroup || !shortsGroup) return;
  const index = geometry.index;
  let shortsTop = -Infinity;
  for (let i = shortsGroup.start; i < shortsGroup.start + shortsGroup.count; i++) {
    shortsTop = Math.max(shortsTop, positions.getY(index.getX(i)));
  }
  const hemHeight = shortsTop - 0.12;
  const shirtIndices: number[] = [];
  const shortsIndices: number[] = [];
  for (let i = shirtGroup.start; i < shirtGroup.start + shirtGroup.count; i += 3) {
    shirtIndices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  for (let i = shortsGroup.start; i < shortsGroup.start + shortsGroup.count; i += 3) {
    const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const centerY = indices.reduce((sum, index) => sum + positions.getY(index), 0) / 3;
    (centerY >= hemHeight ? shirtIndices : shortsIndices).push(...indices);
  }
  if (!shirtIndices.length) return;
  geometry.setIndex([...shirtIndices, ...shortsIndices]);
  geometry.clearGroups();
  geometry.addGroup(0, shirtIndices.length, 0);
  geometry.addGroup(shirtIndices.length, shortsIndices.length, 1);
  hemGeometries.add(geometry);
}

function groupSkinHem(geometry: T.BufferGeometry) {
  if (hemGeometries.has(geometry) || !geometry.index) return;
  const positions = geometry.getAttribute('position');
  if (!positions) return;
  const skinIndices: number[] = [];
  const shirtIndices: number[] = [];
  for (let i = 0; i < geometry.index.count; i += 3) {
    const indices = [geometry.index.getX(i), geometry.index.getX(i + 1), geometry.index.getX(i + 2)];
    const centerX = indices.reduce((sum, index) => sum + positions.getX(index), 0) / 3;
    const centerY = indices.reduce((sum, index) => sum + positions.getY(index), 0) / 3;
    const centerZ = indices.reduce((sum, index) => sum + positions.getZ(index), 0) / 3;
    const underHem = centerY >= 0.79 && centerY <= 0.91
      && Math.abs(centerX) < 0.2 && centerZ > -0.1 && centerZ < 0.22;
    (underHem ? shirtIndices : skinIndices).push(...indices);
  }
  if (!shirtIndices.length) return;
  geometry.setIndex([...skinIndices, ...shirtIndices]);
  geometry.clearGroups();
  geometry.addGroup(0, skinIndices.length, 0);
  geometry.addGroup(skinIndices.length, shirtIndices.length, 1);
  hemGeometries.add(geometry);
}

function attachPlayerAsset(THREE: Three, seat: number, model: PlayerModel, asset: LoadedPlayerAsset) {
  if (model.disposed) return;
  const body = asset.clone(asset.scene);
  const materials = new Set<T.Material>();
  const tint = teamOutfits[seat % 2]!;
  const outfitMaterials = new Map<string, T.Material>();
  asset.scene.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of source) {
      if ((material.name !== 'shirt' && material.name !== 'shorts') || outfitMaterials.has(material.name)) continue;
      const instance = material.clone() as T.MeshStandardMaterial;
      instance.color.set(material.name === 'shirt' ? tint.shirt : tint.shorts);
      if (material.name === 'shirt') instance.side = THREE.DoubleSide;
      instance.needsUpdate = true;
      outfitMaterials.set(material.name, instance);
      materials.add(instance);
    }
  });
  body.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if ((mesh as T.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (playerAssetUrl(seat) === '/models/tennis/male.glb' && source.some((material) => material.name === 'skin')) {
      groupSkinHem(mesh.geometry as T.BufferGeometry);
      mesh.material = [source.find((material) => material.name === 'skin')!, outfitMaterials.get('shirt')!];
    } else if (playerAssetUrl(seat) === '/models/tennis/male.glb' && source.some((material) => material.name === 'shorts')) {
      groupShortsHem(mesh.geometry as T.BufferGeometry);
      mesh.material = [outfitMaterials.get('shirt')!, outfitMaterials.get('shorts')!];
    } else {
      const cloned = source.map((material) => outfitMaterials.get(material.name) ?? material);
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    }
  });
  model.root.add(body);
  const bones = captureBoneBinds(THREE, model.root, body);
  const byName = new Map(bones.map((entry) => [entry.bone.name, entry.bone]));
  const handLeft = byName.get('hand_l');
  const handRight = byName.get('hand_r');
  const forearmRight = byName.get('lowerarm_r');
  if (!handLeft || !handRight || !forearmRight) {
    body.removeFromParent();
    materials.forEach((material) => material.dispose());
    throw new Error('Tennis player model is missing hand bones');
  }
  const rightBind = bones.find((entry) => entry.bone === handRight);
  if (!rightBind) {
    body.removeFromParent();
    materials.forEach((material) => material.dispose());
    throw new Error('Tennis player model has no right-hand bind pose');
  }
  model.racket.removeFromParent();
  handRight.add(model.racket);
  model.racket.position.set(0, 0.035, 0);
  const wrist = handRight.getWorldPosition(new THREE.Vector3());
  const elbow = forearmRight.getWorldPosition(new THREE.Vector3());
  const forearmAxis = wrist.sub(elbow).normalize();
  const handBindWorld = handRight.getWorldQuaternion(new THREE.Quaternion());
  const thumbSide = new THREE.Vector3(1, 0, 0).applyQuaternion(handBindWorld);
  const shaft = forearmAxis.addScaledVector(thumbSide, Math.tan(Math.PI / 6)).normalize();
  const stringsNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(handBindWorld);
  const racketX = shaft.clone().cross(stringsNormal).normalize();
  stringsNormal.crossVectors(racketX, shaft).normalize();
  const racketWorld = new THREE.Matrix4().makeBasis(racketX, shaft, stringsNormal);
  model.racketCorrection.copy(handBindWorld.invert().multiply(new THREE.Quaternion().setFromRotationMatrix(racketWorld)));
  model.skinnedRoot = body;
  model.handLeft = handLeft;
  model.handRight = handRight;
  model.boneBinds = bones;
  model.ownedMaterials = materials;
  model.torso.visible = false;
}

function requestPlayerAsset(THREE: Three, seat: number, model: PlayerModel) {
  const url = playerAssetUrl(seat);
  void loadPlayerAsset(url)
    .then((asset) => attachPlayerAsset(THREE, seat, model, asset))
    .catch((error: unknown) => {
      if (!warnedAboutPlayerLoadFailure) {
        warnedAboutPlayerLoadFailure = true;
        console.warn(`Unable to load Tennis player model at ${url}; using procedural fallback.`, error);
      }
    });
}

function capsule(THREE: Three, radius: number, length: number, material: T.Material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
}

function rod(THREE: Three, a: T.Vector3, b: T.Vector3, radius: number, material: T.Material) {
  const delta = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

export function makePlayer(THREE: Three, seat: number, lite: boolean): PlayerModel {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const skin = new THREE.MeshStandardMaterial({ color: ['#b77b55', '#e4b58d', '#86563e', '#d89e76'][seat % 4], roughness: 0.83 });
  const shirt = new THREE.MeshStandardMaterial({ color: teamColors[seat % 2], roughness: 0.72, metalness: 0.02 });
  const shorts = new THREE.MeshStandardMaterial({ color: ['#142d49', '#a1a39a', '#384344', '#ece8db'][seat % 4], roughness: 0.84 });
  const shoe = new THREE.MeshStandardMaterial({ color: '#e9e7dd', roughness: 0.55 });
  const sole = new THREE.MeshStandardMaterial({ color: '#3a4040', roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: accents[seat % accents.length], roughness: 0.53 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: ['#30261f', '#72513c', '#211e20', '#b0a18d'][seat % 4], roughness: 0.91 });
  const dark = new THREE.MeshStandardMaterial({ color: '#172127', roughness: 0.66 });
  const eyes = new THREE.MeshStandardMaterial({ color: '#f2eee2', roughness: 0.55 });
  const racketFrame = new THREE.MeshStandardMaterial({ color: '#242a2a', metalness: 0.65, roughness: 0.29 });
  const grip = new THREE.MeshStandardMaterial({ color: '#242b31', roughness: 0.88 });

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), shorts);
  pelvis.scale.set(1.18, 0.72, 0.82);
  pelvis.position.y = 0.86;
  torso.add(pelvis);
  const trunkProfile = [
    new THREE.Vector2(0.16, 0),
    new THREE.Vector2(0.2, 0.16),
    new THREE.Vector2(0.25, 0.32),
    new THREE.Vector2(0.31, 0.54),
    new THREE.Vector2(0.24, 0.72),
    new THREE.Vector2(0.12, 0.76),
    new THREE.Vector2(0, 0.76),
  ];
  const trunk = new THREE.Mesh(new THREE.LatheGeometry(trunkProfile, 16), shirt);
  trunk.position.y = 0.86;
  torso.add(trunk);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.026, 6, 14), accent);
  collar.position.y = 1.57;
  collar.rotation.x = Math.PI / 2;
  torso.add(collar);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.088, 0.19, 10), skin);
  neck.position.y = 1.62;
  torso.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 14), skin);
  head.scale.set(0.88, 1.12, 0.93);
  head.position.set(0, 1.79, 0.035);
  torso.add(head);
  const headband = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.027, 8, 24), accent);
  headband.position.set(0, 1.82, 0.015);
  headband.rotation.x = Math.PI / 2;
  torso.add(headband);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.144, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMaterial);
  hair.position.set(0, 1.83, 0.02);
  torso.add(hair);
  if (seat % 2 === 1) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), accent);
    cap.position.set(0, 1.86, 0.02);
    torso.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 16, 1, false, 0, Math.PI), accent);
    brim.position.set(0, 1.83, 0.11);
    brim.rotation.x = Math.PI / 2;
    torso.add(brim);
  } else {
    const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 3, 7), hairMaterial);
    pony.position.set(0.02, 1.67, -0.14);
    pony.rotation.x = -0.35;
    torso.add(pony);
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 8), eyes);
    eye.position.set(side * 0.049, 1.79, 0.155);
    torso.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), dark);
    pupil.position.set(side * 0.049, 1.79, 0.171);
    torso.add(pupil);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), skin);
    ear.scale.set(0.55, 0.9, 0.55);
    ear.position.set(side * 0.13, 1.78, 0.01);
    torso.add(ear);
  }

  const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.24, 12), shorts);
  shortsMesh.position.y = 0.83;
  torso.add(shortsMesh);
  const trim: T.Mesh[] = [];
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.58, 0.014), accent);
  stripe.position.set(-0.17, 1.27, 0.243);
  torso.add(stripe);
  trim.push(stripe);

  const legs: [T.Group, T.Group] = [new THREE.Group(), new THREE.Group()];
  for (let index = 0; index < 2; index++) {
    const side = index === 0 ? -1 : 1;
    const upper = new THREE.Group();
    upper.position.set(side * 0.12, 0.76, 0);
    torso.add(upper);
    const upperLeg = capsule(THREE, 0.095, 0.37, shorts);
    upperLeg.position.y = -0.24;
    upper.add(upperLeg);
    const knee = new THREE.Group();
    knee.position.y = -0.48;
    upper.add(knee);
    const lowerLeg = capsule(THREE, 0.067, 0.39, skin);
    lowerLeg.position.y = -0.22;
    knee.add(lowerLeg);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.069, 0.067, 0.13, 9), shoe);
    sock.position.y = -0.44;
    knee.add(sock);
    const foot = capsule(THREE, 0.08, 0.22, shoe);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.49, 0.09);
    knee.add(foot);
    const outsole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.31), sole);
    outsole.position.set(0, -0.59, 0.09);
    knee.add(outsole);
    legs[index] = upper;
  }

  const racketArm = new THREE.Group();
  racketArm.position.set(0.34, 1.43, 0);
  torso.add(racketArm);
  const racketSleeve = capsule(THREE, 0.085, 0.18, shirt);
  racketSleeve.position.set(-0.025, -0.09, 0);
  racketSleeve.rotation.z = -0.2;
  racketArm.add(racketSleeve);
  const upperArm = capsule(THREE, 0.072, 0.32, skin);
  upperArm.position.y = -0.21;
  racketArm.add(upperArm);
  const racketForearm = new THREE.Group();
  racketForearm.position.set(0, -0.4, 0.01);
  racketArm.add(racketForearm);
  const forearm = capsule(THREE, 0.058, 0.31, skin);
  forearm.position.y = -0.2;
  racketForearm.add(forearm);
  const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.062, 9, 8), skin);
  wrist.position.y = -0.4;
  racketForearm.add(wrist);
  const leadArm = new THREE.Group();
  leadArm.position.set(-0.34, 1.43, 0);
  torso.add(leadArm);
  const leadSleeve = capsule(THREE, 0.085, 0.18, shirt);
  leadSleeve.position.set(0.02, -0.09, 0);
  leadSleeve.rotation.z = 0.2;
  leadArm.add(leadSleeve);
  const leadUpper = capsule(THREE, 0.07, 0.32, skin);
  leadUpper.position.set(0, -0.23, 0);
  leadArm.add(leadUpper);
  const leadForearm = capsule(THREE, 0.056, 0.3, skin);
  leadForearm.position.set(0, -0.48, 0.01);
  leadArm.add(leadForearm);
  const racket = new THREE.Group();
  racket.position.set(0.04, -0.48, 0.12);
  racketForearm.add(racket);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.23, 8), grip);
  handle.position.y = 0.115;
  racket.add(handle);
  const throatLeft = new THREE.Vector3(-0.05, 0.28, 0);
  const throatRight = new THREE.Vector3(0.05, 0.28, 0);
  const headLow = new THREE.Vector3(0, 0.39, 0);
  racket.add(rod(THREE, throatLeft, headLow, 0.017, racketFrame));
  racket.add(rod(THREE, throatRight, headLow, 0.017, racketFrame));
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 8, 40), racketFrame);
  frame.scale.y = 1.28;
  frame.position.y = 0.64;
  racket.add(frame);
  const stringCanvas = document.createElement('canvas');
  stringCanvas.width = stringCanvas.height = 256;
  const stringContext = stringCanvas.getContext('2d')!;
  stringContext.beginPath();
  stringContext.ellipse(128, 128, 124, 124, 0, 0, Math.PI * 2);
  stringContext.clip();
  stringContext.strokeStyle = 'rgba(239,239,223,.78)';
  stringContext.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    const p = i * 256 / 8;
    const offset = p - 128;
    const end = Math.sqrt(124 * 124 - offset * offset);
    stringContext.beginPath();
    stringContext.moveTo(p, 128 - end);
    stringContext.lineTo(p, 128 + end);
    stringContext.moveTo(128 - end, p);
    stringContext.lineTo(128 + end, p);
    stringContext.stroke();
  }
  const stringTexture = new THREE.CanvasTexture(stringCanvas);
  stringTexture.colorSpace = THREE.SRGBColorSpace;
  const stringPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.39, 0.49),
    new THREE.MeshBasicMaterial({ map: stringTexture, transparent: true, opacity: 0.74, alphaTest: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  stringPlane.position.set(0, 0.64, 0.021);
  racket.add(stringPlane);

  const markers: T.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const inner = 0.29 + i * 0.16;
    const markerMaterial = new THREE.MeshBasicMaterial({ color: '#15241f', transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
    const marker = new THREE.Mesh(new THREE.RingGeometry(inner, inner + 0.026, 48), markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.027 + i * 0.002;
    marker.visible = false;
    root.add(marker);
    markers.push(marker);
  }
  const model: PlayerModel = {
    THREE,
    root,
    torso,
    racketArm,
    racketForearm,
    leadArm,
    legs,
    racket,
    markers,
    trim,
    phase: seat * 1.7,
    skinnedRoot: null,
    handLeft: null,
    handRight: null,
    boneBinds: [],
    poseAngles: new Map(),
    ownedMaterials: new Set(),
    racketCorrection: new THREE.Quaternion(),
    debugPose: null,
    disposed: false,
    wasServingToss: false,
    leftPalmWorldPosition(out = new THREE.Vector3()) {
      model.root.updateMatrixWorld(true);
      if (model.handLeft) {
        model.handLeft.getWorldPosition(out);
      } else {
        model.leadArm.localToWorld(out.set(0, -0.55, 0.055));
      }
      const rootPosition = model.root.getWorldPosition(new THREE.Vector3());
      const outward = out.clone().sub(rootPosition);
      outward.y = 0;
      if (outward.lengthSq() > 1e-6) outward.normalize().multiplyScalar(0.07);
      const towardCamera = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(model.root.getWorldQuaternion(new THREE.Quaternion()));
      return out.add(outward).addScaledVector(towardCamera, 0.055).add(new THREE.Vector3(0, 0.02, 0));
    },
    racketHeadWorldPosition(out = new THREE.Vector3()) {
      model.root.updateMatrixWorld(true);
      return model.racket.localToWorld(out.set(0, 0.64, 0));
    },
    dispose() {
      model.disposed = true;
      if (model.skinnedRoot) {
        model.racket.removeFromParent();
        model.root.add(model.racket);
        model.skinnedRoot.traverse((object) => {
          const mesh = object as T.SkinnedMesh;
          if (mesh.isSkinnedMesh) mesh.skeleton.boneTexture?.dispose();
        });
        model.skinnedRoot.removeFromParent();
        model.skinnedRoot = null;
      }
      model.ownedMaterials.forEach((material) => material.dispose());
      model.ownedMaterials.clear();
    },
  };
  requestPlayerAsset(THREE, seat, model);
  return model;
}

function applyCharacterPose(model: PlayerModel, target: Map<string, [number, number, number]>, dt: number) {
  const THREE = model.THREE;
  const rootWorld = model.root.getWorldQuaternion(new THREE.Quaternion());
  const targetWorld = new Map<string, T.Quaternion>();
  const parentWorld = new THREE.Quaternion();
  const targetRotation = new THREE.Quaternion();
  const targetLocal = new THREE.Quaternion();
  for (const bind of model.boneBinds) {
    const goal = target.get(bind.bone.name) ?? [0, 0, 0];
    const current = model.poseAngles.get(bind.bone.name) ?? [0, 0, 0];
    const amount = 1 - Math.exp(-12 * Math.max(0, dt));
    current[0] += (goal[0] - current[0]) * amount;
    current[1] += (goal[1] - current[1]) * amount;
    current[2] += (goal[2] - current[2]) * amount;
    model.poseAngles.set(bind.bone.name, current);
    targetRotation.setFromEuler(new THREE.Euler(current[0], current[1], current[2], 'XYZ'));
    const parentTarget = bind.parentName ? targetWorld.get(bind.parentName) ?? bind.parentBindWorld : null;
    targetLocal.copy(characterSpaceBoneTarget(bind.bindWorld, bind.parentBindWorld, parentTarget, targetRotation));
    targetWorld.set(bind.bone.name, targetLocal.clone());
    const targetSceneWorld = rootWorld.clone().multiply(targetLocal);
    if (bind.bone.parent) bind.bone.parent.getWorldQuaternion(parentWorld);
    else parentWorld.copy(rootWorld);
    bind.bone.quaternion.copy(parentWorld.invert().multiply(targetSceneWorld));
    bind.bone.updateMatrixWorld(true);
  }
  model.racket.quaternion.copy(model.racketCorrection);
}

function poseValue(pose: Map<string, [number, number, number]>, name: string, x: number, y: number, z: number) {
  pose.set(name, [x, y, z]);
}

export function debugPoseAngles(name: PoseName, progress = 0) {
  const p = Math.max(0, Math.min(1, progress));
  const pose = new Map<string, [number, number, number]>();
  const put = (key: string, value: [number, number, number]) => pose.set(key, value);
  const between = (stages: [number, number, number][]): [number, number, number] => {
    const segment = Math.min(1, Math.floor(p * 2));
    const amount = p * 2 - segment;
    return [0, 1, 2].map((axis) => stages[segment]![axis]! + (stages[segment + 1]![axis]! - stages[segment]![axis]!) * amount) as [number, number, number];
  };
  const arms = (right: [number, number, number], left: [number, number, number], rightElbow: [number, number, number] = [0, 0, 0], leftElbow: [number, number, number] = [0, 0, 0]) => {
    put('upperarm_r', right); put('upperarm_l', left);
    put('lowerarm_r', rightElbow); put('lowerarm_l', leftElbow);
  };
  switch (name) {
    case 'idle': arms([0, 0, 1.1], [0, 0, -1.1], [0, 0, 0.15], [0, 0, -0.15]); break;
    case 'ready': put('thigh_l', [-0.18, 0, 0]); put('thigh_r', [-0.18, 0, 0]); put('calf_l', [0.44, 0, 0]); put('calf_r', [0.44, 0, 0]); put('spine_01', [0.08, 0, 0]); arms([0.4, 0.8, 0.4], [-0.4, 0.8, -1.2], [-0.8, 0, 0.8], [1.2, 0, 0.4]); break;
    case 'run': put('thigh_l', [-0.35, 0, 0]); put('thigh_r', [0.35, 0, 0]); put('calf_l', [0.2, 0, 0]); put('calf_r', [0.5, 0, 0]); arms([0.2, 0, 0.7], [-0.2, 0, -0.7], [0.3, 0, 0], [-0.3, 0, 0]); break;
    case 'shuffle': put('pelvis', [0, 0.15, 0]); put('thigh_l', [-0.1, 0, -0.15]); put('thigh_r', [-0.1, 0, 0.15]); arms([0, 0.3, 0.85], [0, -0.3, -0.85], [0.25, 0, 0.1], [-0.25, 0, -0.1]); break;
    case 'forehand': {
      const right: [number, number, number][] = [[0, -0.4, -0.8], [0.05, 1.15, -0.2], [-0.4, 1.1, -0.75]];
      const elbow: [number, number, number][] = [[0.35, 0, 0.15], [0.1, 0, -0.1], [-0.3, 0, -0.5]];
      arms(between(right), [0.05, -0.45, -0.7], between(elbow), [-0.3, 0, -0.25]);
      put('spine_02', [0.08, -0.25 + p * 0.6, 0]); break;
    }
    case 'backhand': {
      const right: [number, number, number][] = [[0, -1.2, -0.8], [0.05, 0.4, 0], [-0.4, -1.1, -0.75]];
      const left: [number, number, number][] = [[0.05, -0.7, -0.45], [-0.475, 0.3, -1.6], [-0.4, -1.1, -0.75]];
      const rightElbow: [number, number, number][] = [[0.35, 0, 0.15], [0.1, 0, -0.1], [-0.3, 0, -0.5]];
      const leftElbow: [number, number, number][] = [[0.3, 0, -0.4], [1.275, 0, 0.4], [-0.2, 0, -0.45]];
      arms(between(right), between(left), between(rightElbow), between(leftElbow));
      put('spine_02', [0.08, 0.25 - p * 0.6, 0]); break;
    }
    case 'slice': {
      const right: [number, number, number][] = [[-0.35, -0.4, -0.4], [0.15, 0.3, 0], [-0.3, 0.6, 0.2]];
      const elbow: [number, number, number][] = [[-0.2, 0, -0.2], [0.1, 0, 0], [0.4, 0, 0.35]];
      arms(between(right), [-0.2, -0.4, -0.5], between(elbow), [-0.2, 0, -0.2]);
      break;
    }
    case 'lob': {
      const right: [number, number, number][] = [[0.5, 0.7, 0.4], [0, 0.65, -0.1], [-0.8, 0.8, -0.7]];
      const elbow: [number, number, number][] = [[0.35, 0, 0.35], [0.05, 0, 0], [-0.35, 0, -0.5]];
      arms(between(right), [0, -0.4, -0.4], between(elbow), [-0.2, 0, -0.2]);
      break;
    }
    case 'smash':
      arms([-0.35, -0.45, -1.8], [-0.2, 0.2, 0.85], [-0.7, 0, -0.5], [0.2, 0, 0.25]);
      put('spine_02', [0.1, -0.28, 0]);
      break;
    case 'volley':
      arms([0.2, 0.45, 0.5], [-0.1, -0.35, -0.45], [-0.1, 0, 0.3], [0.2, 0, -0.1]);
      put('spine_02', [0.08, -0.12, 0]);
      break;
    case 'serve-ready': arms([0, 0, 1.1], [0, 0.18, -0.8], [0, 0, 0.15], [0, 0, -0.2]); break;
    case 'toss': arms([-0.35, -0.45, -0.9], [0, 0, 1.8], [-0.7, 0, -0.8], [0, 0, 0.15]); put('spine_02', [0.12, 0, 0]); break;
    case 'serve-contact': arms([-0.4, -0.3, -1.8], [0.1, 0, 0.5], [-0.6, 0, -0.2], [0, 0, 0.2]); break;
    case 'serve-follow': arms([0.15, 1.1, 0.4], [0, 0.2, -0.4], [0.8, 0, 0.5], [0, 0, -0.2]); put('spine_02', [0.1, 0.5, 0]); break;
  }
  return pose;
}

export function updatePlayer(
  model: PlayerModel,
  player: Player,
  ball: Ball,
  dt: number,
  human: boolean,
  x = player.x,
  z = player.z,
  ballX = ball.p.x,
  ballY = ball.p.y,
  phase: World['phase'] = 'rally',
  isServer = false,
) {
  model.root.position.set(model.debugPose?.position.x ?? x, 0, model.debugPose?.position.z ?? z);
  model.root.rotation.y = model.debugPose?.rotation ?? player.facing;
  model.phase += dt * (4.5 + Math.hypot(player.vx, player.vz) * 1.2);
  const speed = Math.hypot(player.vx, player.vz);
  const running = Math.min(1, speed / 4.2);
  const cos = Math.cos(player.facing);
  const sin = Math.sin(player.facing);
  const localVx = player.vx * cos - player.vz * sin;
  const localVz = player.vx * sin + player.vz * cos;
  const lateral = Math.abs(localVx) > Math.abs(localVz) * 1.25;
  const bob = model.debugPose ? 0 : Math.sin(model.phase * 2) * 0.025 * running;
  model.torso.position.y = bob;
  model.torso.rotation.z = Math.max(-0.14, Math.min(0.14, player.vx * -0.025));
  model.torso.rotation.y = -Math.min(0.22, Math.abs(player.vx) * 0.035);
  model.legs[0].rotation.x = Math.sin(model.phase) * 0.58 * running;
  model.legs[1].rotation.x = Math.sin(model.phase + Math.PI) * 0.58 * running;

  const dx = ballX - x;
  const dz = ball.p.z - z;
  const localBallX = cos * dx - sin * dz;
  const localBallY = ballY - 1.25;
  const incoming = ball.inPlay && ball.canHitTeam === player.team;
  const ready = incoming;
  const serverReady = isServer && phase === 'serve-ready';
  const tossing = isServer && (phase === 'serve-toss' || player.serveToss > 0);
  const serveFollow = isServer && phase === 'serve-flight' && player.swing > 0 && model.wasServingToss;
  if (tossing || (isServer && phase === 'serve-ready' && player.serveToss > 0)) model.wasServingToss = true;
  if (serverReady) model.wasServingToss = false;
  if (phase === 'serve-flight' && player.swing <= 0) model.wasServingToss = false;

  if (model.skinnedRoot) {
    model.skinnedRoot.position.y = bob;
    const pose = new Map<string, [number, number, number]>();
    const crouch = ready ? 0.34 : 0;
    const lean = ready ? 0.11 : 0.025 * running;
    const step = Math.sin(model.phase) * running;
    const turn = lateral ? Math.sign(localVx) * 0.12 * running : 0;
    poseValue(pose, 'pelvis', 0, turn * 0.45, 0);
    poseValue(pose, 'spine_01', lean, turn, 0);
    poseValue(pose, 'spine_02', lean * 0.55, turn * 0.7, 0);
    poseValue(pose, 'spine_03', lean * 0.2, turn * 0.35, 0);
    poseValue(pose, 'thigh_l', -crouch * 0.35 + step * 0.42, 0, 0);
    poseValue(pose, 'thigh_r', -crouch * 0.35 - step * 0.42, 0, 0);
    poseValue(pose, 'calf_l', crouch + Math.max(0, -step) * 0.32, 0, 0);
    poseValue(pose, 'calf_r', crouch + Math.max(0, step) * 0.32, 0, 0);

    const readyPose = ready ? debugPoseAngles('ready') : null;
    let rightUpper: [number, number, number] = readyPose?.get('upperarm_r') ?? [0.03 * step, 0, 1.1];
    let rightLower: [number, number, number] = readyPose?.get('lowerarm_r') ?? [0, 0, 0.15];
    let leftUpper: [number, number, number] = readyPose?.get('upperarm_l') ?? [0.03 * -step, 0, -1.1];
    let leftLower: [number, number, number] = readyPose?.get('lowerarm_l') ?? [0, 0, -0.15];
    poseValue(pose, 'hand_r', 0, 0, 0);
    poseValue(pose, 'hand_l', 0, 0, 0);

    const forehand = localBallX >= 0;
    const swingProgress = player.swing > 0 ? 1 - Math.min(1, player.swing / 0.56) : 0;
    if (player.pending && !serveFollow) {
      rightUpper = [0.05, forehand ? -0.85 : -0.15, -0.75];
      rightLower = [0.05, 0, -0.95];
      poseValue(pose, 'spine_02', lean, forehand ? -0.3 : 0.3, 0);
    } else if (player.swing > 0 && !serveFollow) {
      const sign = forehand ? 1 : -1;
      const lob = player.swingKind === 'lob';
      const slice = player.swingKind === 'slice';
      const stroke = debugPoseAngles(player.swingKind === 'smash' ? 'smash' : player.swingKind === 'volley' ? 'volley' : lob ? 'lob' : slice ? 'slice' : forehand ? 'forehand' : 'backhand', swingProgress);
      rightUpper = stroke.get('upperarm_r') ?? rightUpper;
      rightLower = stroke.get('lowerarm_r') ?? rightLower;
      leftUpper = stroke.get('upperarm_l') ?? leftUpper;
      leftLower = stroke.get('lowerarm_l') ?? leftLower;
      poseValue(pose, 'pelvis', 0, -sign * (0.18 + swingProgress * 0.12), 0);
      poseValue(pose, 'spine_01', lean, -sign * 0.25, 0);
      poseValue(pose, 'spine_02', lean, sign * (0.42 - swingProgress * 0.72), 0);
      poseValue(pose, 'spine_03', lean * 0.4, sign * (0.26 - swingProgress * 0.46), 0);
    }

    if (serverReady) {
      leftUpper = [0.06, 0.18, -0.8];
      leftLower = [0, 0, -0.2];
    }
    if (tossing) {
      leftUpper = [0, 0.08, 1.8];
      leftLower = [0, 0, 0.15];
      rightUpper = [-0.35, -0.45, -0.9];
      rightLower = [-0.7, 0, -0.8];
      poseValue(pose, 'spine_02', 0.12, -0.08, 0);
    } else if (serveFollow) {
      const progress = swingProgress;
      leftUpper = [0.08 - progress * 0.28, 0.18, -1.05 + progress * 1.25];
      leftLower = [0, 0, -0.12 + progress * 0.38];
      rightUpper = [-0.25 + progress * 0.15, -0.22 - progress * 0.28, 1.32 - progress * 1.65];
      rightLower = [-0.55 + progress * 0.9, 0, -0.38 - progress * 0.62];
      poseValue(pose, 'spine_02', 0.12, -0.3 + progress * 0.42, 0);
      poseValue(pose, 'spine_03', 0.04, -0.18 + progress * 0.26, 0);
    }
    poseValue(pose, 'upperarm_r', ...rightUpper);
    poseValue(pose, 'lowerarm_r', ...rightLower);
    poseValue(pose, 'upperarm_l', ...leftUpper);
    poseValue(pose, 'lowerarm_l', ...leftLower);
    if (model.debugPose) {
      pose.clear();
      for (const [bone, angle] of debugPoseAngles(model.debugPose.name, model.debugPose.progress)) pose.set(bone, angle);
    }
    applyCharacterPose(model, pose, dt);
  } else {
    const swing = player.swing > 0 ? Math.sin(Math.min(1, player.swing / 0.48) * Math.PI) : 0;
    const localX = Math.max(-1.25, Math.min(1.25, localBallX));
    const serve = player.serveToss > 0 || serverReady || tossing;
    model.racketArm.rotation.x = -0.12 - localBallY * 0.22 - swing * 0.78 + (serve ? 0.64 : 0);
    model.racketArm.rotation.y = -0.1 + localX * 0.22 + swing * 0.48;
    model.racketArm.rotation.z = -0.38 - localX * 0.38 + swing * (localX >= 0 ? 1.2 : 0.42);
    model.racketForearm.rotation.x = -0.2 - swing * 1.05 + (serve ? -0.18 : 0);
    model.racketForearm.rotation.z = -0.18 + swing * 0.65;
    model.leadArm.rotation.x = serve ? -1.05 : Math.sin(model.phase + Math.PI) * 0.35 * running;
    model.leadArm.rotation.y = serve ? -0.15 : 0;
    model.leadArm.rotation.z = serve ? 0.38 : Math.sin(model.phase + Math.PI) * 0.22 * running;
  }
  for (let i = 0; i < model.markers.length; i++) {
    model.markers[i].visible = human;
    const material = model.markers[i].material as T.MeshBasicMaterial;
    material.opacity = 0.1 + 0.035 * Math.sin(model.phase * 0.7 + i * 0.55);
    model.markers[i].scale.setScalar(1 + Math.sin(model.phase + i) * 0.018);
  }
}
