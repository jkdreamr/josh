import type * as T from 'three';
import type { Ball, Player, World } from './logic.ts';
import { characterOf, type Accessory, type Character } from './roster.ts';

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
  ownedGeometries: Set<T.BufferGeometry>;
  ownedTextures: Set<T.Texture>;
  fabricNormalMap: T.Texture;
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
let warnedAboutPlayerLoadFailure = false;

function playerAssetUrl(seat: number, character = '') {
  if (character) return `/models/tennis/${characterOf(character).model}.glb`;
  return seat === 0 || seat === 3 ? '/models/tennis/female.glb' : '/models/tennis/male.glb';
}

/** Builds a hat or headphones around a head centred at the origin, facing +z. */
function makeAccessory(THREE: Three, kind: Accessory, color: string, radius = 0.145) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1b1f', roughness: 0.5 });
  const add = (mesh: T.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const r = radius;
  const dome = (scaleY = 1) => {
    const mesh = add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.07, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), material), 0, r * 0.22, 0);
    mesh.scale.y = scaleY;
  };
  const brim = () => {
    const mesh = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.02, 16, 1, false, -Math.PI / 2, Math.PI), material), 0, r * 0.24, r * 0.55);
    mesh.scale.z = 0.8;
  };
  const band = (y: number, size = 1.04, tube = 0.024) => {
    const mesh = add(new THREE.Mesh(new THREE.TorusGeometry(r * size, tube, 8, 24), material), 0, y, 0);
    mesh.rotation.x = Math.PI / 2;
  };
  if (kind === 'headband') band(r * 0.28);
  else if (kind === 'cap') { dome(); brim(); }
  else if (kind === 'visor') { band(r * 0.3, 1.05, 0.03); brim(); }
  else if (kind === 'beanie') {
    dome(1.25);
    band(r * 0.26, 1.08, 0.03);
    add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 10, 8), material), 0, r * 1.55, 0);
  } else if (kind === 'toque') {
    band(r * 0.3, 1.04, 0.035);
    add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.95, r * 1.1, 14, 1, true), material), 0, r * 0.85, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 14, 10), material), 0, r * 1.7, 0).scale.y = 0.7;
  } else {
    const arc = add(new THREE.Mesh(new THREE.TorusGeometry(r * 1.18, 0.018, 6, 20, Math.PI), dark), 0, 0, 0);
    arc.rotation.y = Math.PI / 2;
    for (const side of [-1, 1]) {
      const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.42, 0.06, 14), material), side * r * 1.12, 0, 0);
      cup.rotation.z = Math.PI / 2;
    }
  }
  return group;
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

function triangleIndices(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  if (!positions) return [];
  const index = geometry.index;
  const count = index?.count ?? positions.count;
  return Array.from({ length: count - (count % 3) }, (_, i) => index ? index.getX(i) : i);
}

function fabricNormalTexture(THREE: Three, lite: boolean) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      image.data[offset] = 128 + Math.round(Math.sin(y * Math.PI / 4) * 8);
      image.data[offset + 1] = 128 + Math.round(Math.sin(x * Math.PI / 4) * 8);
      image.data[offset + 2] = 254;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.anisotropy = lite ? 1 : 2;
  return texture;
}

function applyFabric(material: T.Material, texture: T.Texture) {
  const cloth = material as T.MeshStandardMaterial;
  cloth.normalMap = texture;
  cloth.normalScale.set(0.14, 0.14);
  cloth.roughness = Math.max(cloth.roughness, 0.84);
  cloth.needsUpdate = true;
}

type HemCut = { bone: T.Bone; length: number; limit: number };
type HemBounds = { shirtMin: number; shortsMin: number; shortsMax: number };

function materialGroups(geometry: T.BufferGeometry, indexCount: number): { start: number; count: number; materialIndex: number }[] {
  return geometry.groups.length
    ? geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex: materialIndex ?? 0 }))
    : [{ start: 0, count: indexCount, materialIndex: 0 }];
}

function triangleLimb(THREE: Three, mesh: T.Mesh, triangle: number[], prefixes: string[]) {
  const skinned = mesh as T.SkinnedMesh;
  const geometry = mesh.geometry as T.BufferGeometry;
  const skinIndices = geometry.getAttribute('skinIndex');
  const skinWeights = geometry.getAttribute('skinWeight');
  const positions = geometry.getAttribute('position');
  if (!skinned.isSkinnedMesh || !skinIndices || !skinWeights || !positions) return null;
  const boneWeights = new Map<T.Bone, number>();
  for (const vertex of triangle) {
    for (let component = 0; component < 4; component++) {
      const weight = skinWeights.getComponent(vertex, component);
      const bone = skinned.skeleton.bones[skinIndices.getComponent(vertex, component)];
      if (weight > 0 && prefixes.some((prefix) => bone.name.startsWith(prefix))) {
        boneWeights.set(bone, (boneWeights.get(bone) ?? 0) + weight);
      }
    }
  }
  const [bone, weight] = [...boneWeights].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!bone || weight < 0.6) return null;
  const center = new THREE.Vector3();
  for (const vertex of triangle) {
    const point = new THREE.Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    mesh.localToWorld(point);
    bone.worldToLocal(point);
    center.add(point);
  }
  return { bone, weight, y: center.y / triangle.length };
}

function collectHemCuts(THREE: Three, body: T.Object3D, bones: Map<string, T.Bone>) {
  const distalEdges = new Map<T.Bone, number>();
  body.updateMatrixWorld(true);
  body.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh || !(mesh as T.SkinnedMesh).isSkinnedMesh) return;
    const geometry = mesh.geometry as T.BufferGeometry;
    const indices = triangleIndices(geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const group of materialGroups(geometry, indices.length)) {
      const name = materials[group.materialIndex]?.name;
      const prefix = name === 'shirt' ? 'upperarm_' : name === 'shorts' ? 'thigh_' : '';
      if (!prefix) continue;
      for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
        const limb = triangleLimb(THREE, mesh, indices.slice(i, i + 3), [prefix]);
        if (limb) distalEdges.set(limb.bone, Math.max(distalEdges.get(limb.bone) ?? -Infinity, limb.y));
      }
    }
  });
  const cuts = new Map<string, HemCut>();
  for (const [bone, distalEdge] of distalEdges) {
    const side = bone.name.slice(-1);
    const childName = bone.name.startsWith('upperarm_') ? `lowerarm_${side}` : `calf_${side}`;
    const length = Math.abs(bones.get(childName)?.position.y ?? 0);
    if (length > 0) cuts.set(bone.name, { bone, length, limit: distalEdge - length * 0.1 });
  }
  return cuts;
}

function collectHemBounds(THREE: Three, body: T.Object3D, root: T.Group): HemBounds {
  const bounds = { shirtMin: Infinity, shortsMin: Infinity, shortsMax: -Infinity };
  body.updateMatrixWorld(true);
  body.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as T.BufferGeometry;
    const indices = triangleIndices(geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const group of materialGroups(geometry, indices.length)) {
      const name = materials[group.materialIndex]?.name;
      if (name !== 'shirt' && name !== 'shorts') continue;
      const positions = geometry.getAttribute('position');
      if (!positions) continue;
      for (let i = group.start; i < group.start + group.count; i++) {
        const vertex = indices[i]!;
        const point = new THREE.Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
        mesh.localToWorld(point);
        root.worldToLocal(point);
        if (name === 'shirt') bounds.shirtMin = Math.min(bounds.shirtMin, point.y);
        else {
          bounds.shortsMin = Math.min(bounds.shortsMin, point.y);
          bounds.shortsMax = Math.max(bounds.shortsMax, point.y);
        }
      }
    }
  });
  return bounds;
}

function trimGarmentHem(THREE: Three, mesh: T.Mesh, cuts: Map<string, HemCut>) {
  const geometry = mesh.geometry as T.BufferGeometry;
  const indices = triangleIndices(geometry);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const kept: number[] = [];
  const keptGroups: { start: number; count: number; materialIndex: number }[] = [];
  let removed = false;
  for (const group of materialGroups(geometry, indices.length)) {
    const start = kept.length;
    const material = materials[group.materialIndex];
    const prefix = material?.name === 'shirt' ? 'upperarm_' : material?.name === 'shorts' ? 'thigh_' : '';
    for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
      const triangle = indices.slice(i, i + 3);
      const limb = prefix ? triangleLimb(THREE, mesh, triangle, [prefix]) : null;
      const cut = limb ? cuts.get(limb.bone.name) : null;
      if (limb && cut && limb.y > cut.limit) {
        removed = true;
        continue;
      }
      kept.push(...triangle);
    }
    keptGroups.push({ start, count: kept.length - start, materialIndex: group.materialIndex });
  }
  if (!removed) return null;
  const trimmed = geometry.clone();
  trimmed.setIndex(kept);
  trimmed.clearGroups();
  for (const group of keptGroups) {
    if (group.count) trimmed.addGroup(group.start, group.count, group.materialIndex);
  }
  return trimmed;
}

function groupSkinHem(THREE: Three, mesh: T.Mesh, root: T.Group, cuts: Map<string, HemCut>, bounds: HemBounds) {
  const geometry = mesh.geometry as T.BufferGeometry;
  const positions = geometry.getAttribute('position');
  const indices = triangleIndices(geometry);
  if (!positions || !indices.length) return false;
  const skinIndices: number[] = [];
  const coveredIndices: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3);
    const center = new THREE.Vector3();
    for (const vertex of triangle) {
      center.add(new THREE.Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)));
    }
    center.multiplyScalar(1 / triangle.length);
    mesh.localToWorld(center);
    root.worldToLocal(center);
    const underTorsoHem = Math.abs(center.x) < 0.26 && (
      (center.y >= bounds.shirtMin && center.y <= bounds.shirtMin + 0.04)
      || (center.y >= bounds.shortsMin && center.y <= bounds.shortsMin + 0.04)
      || (center.y >= bounds.shortsMax - 0.04 && center.y <= bounds.shortsMax)
    );
    const limb = triangleLimb(THREE, mesh, triangle, ['upperarm_', 'thigh_']);
    const cut = limb ? cuts.get(limb.bone.name) : null;
    const underLimbHem = limb && cut && limb.y >= cut.limit - cut.length * 0.1 && limb.y <= cut.limit;
    if (underTorsoHem || underLimbHem) coveredIndices.push(...triangle);
    else skinIndices.push(...triangle);
  }
  if (!coveredIndices.length) return false;
  const hidden = geometry.clone();
  hidden.setIndex([...skinIndices, ...coveredIndices]);
  hidden.clearGroups();
  if (skinIndices.length) hidden.addGroup(0, skinIndices.length, 0);
  hidden.addGroup(skinIndices.length, coveredIndices.length, 1);
  mesh.geometry = hidden;
  return true;
}

function attachPlayerAsset(THREE: Three, seat: number, model: PlayerModel, asset: LoadedPlayerAsset, character = '') {
  if (model.disposed) return;
  const body = asset.clone(asset.scene);
  const materials = new Set<T.Material>();
  const kit: Character | null = character ? characterOf(character) : null;
  const tint = kit ?? teamOutfits[seat % 2]!;
  const tones: Record<string, string> = {
    shirt: tint.shirt,
    shorts: tint.shorts,
    shoes: kit?.shoeColor ?? '#e9e7dd',
  };
  const outfitMaterials = new Map<string, T.Material>();
  const hiddenHemMaterial = new THREE.MeshBasicMaterial({ visible: false });
  materials.add(hiddenHemMaterial);
  asset.scene.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of source) {
      const tone = tones[material.name];
      if (!tone || outfitMaterials.has(material.name)) continue;
      const instance = material.clone() as T.MeshStandardMaterial;
      instance.color.set(tone);
      if (material.name === 'shirt') instance.side = THREE.DoubleSide;
      instance.needsUpdate = true;
      outfitMaterials.set(material.name, instance);
      materials.add(instance);
    }
  });
  model.root.add(body);
  const bones = captureBoneBinds(THREE, model.root, body);
  const byName = new Map(bones.map((entry) => [entry.bone.name, entry.bone]));
  const hemCuts = collectHemCuts(THREE, body, byName);
  const hemBounds = collectHemBounds(THREE, body, model.root);
  body.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if ((mesh as T.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (source.some((material) => material.name === 'skin')) {
      const skin = outfitMaterials.get('skin') ?? source.find((material) => material.name === 'skin')!;
      const grouped = groupSkinHem(THREE, mesh, model.root, hemCuts, hemBounds);
      if (grouped) model.ownedGeometries.add(mesh.geometry as T.BufferGeometry);
      mesh.material = grouped ? [skin, hiddenHemMaterial] : skin;
    } else {
      const trimmed = trimGarmentHem(THREE, mesh, hemCuts);
      if (trimmed) {
        mesh.geometry = trimmed;
        model.ownedGeometries.add(trimmed);
      }
      const cloned = source.map((material) => outfitMaterials.get(material.name) ?? material);
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    }
    for (const material of source) {
      const cloth = outfitMaterials.get(material.name);
      if (cloth && (material.name === 'shirt' || material.name === 'shorts')) applyFabric(cloth, model.fabricNormalMap);
    }
  });
  model.root.updateMatrixWorld(true);
  const headBone = byName.get('head');
  if (kit && headBone) {
    model.root.updateMatrixWorld(true);
    const head = model.root.worldToLocal(headBone.getWorldPosition(new THREE.Vector3()));
    const accessory = makeAccessory(THREE, kit.acc, kit.accColor, 0.1);
    accessory.position.set(head.x, head.y + 0.055, head.z + 0.01);
    accessory.traverse((object) => {
      const mesh = object as T.Mesh;
      if (mesh.isMesh) materials.add(mesh.material as T.Material);
    });
    model.root.add(accessory);
    headBone.attach(accessory);
  }
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
  const wristbandGeometry = new THREE.CylinderGeometry(0.038, 0.038, 0.045, 16);
  model.ownedGeometries.add(wristbandGeometry);
  const wristbandMaterial = new THREE.MeshStandardMaterial({ color: kit?.accColor ?? '#f5f1e6', roughness: 0.55 });
  materials.add(wristbandMaterial);
  const wristLocal = forearmRight.worldToLocal(handRight.getWorldPosition(new THREE.Vector3()));
  const bandAxis = wristLocal.clone().normalize();
  const band = new THREE.Mesh(wristbandGeometry, wristbandMaterial);
  band.position.copy(wristLocal).addScaledVector(bandAxis, -0.026);
  band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bandAxis);
  forearmRight.add(band);
  model.skinnedRoot = body;
  model.handLeft = handLeft;
  model.handRight = handRight;
  model.boneBinds = bones;
  materials.forEach((material) => model.ownedMaterials.add(material));
  model.torso.visible = false;
}

function requestPlayerAsset(THREE: Three, seat: number, model: PlayerModel, character = '') {
  const url = playerAssetUrl(seat, character);
  void loadPlayerAsset(url)
    .then((asset) => attachPlayerAsset(THREE, seat, model, asset, character))
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

export function makePlayer(THREE: Three, seat: number, lite: boolean, character = ''): PlayerModel {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const kit = character ? characterOf(character) : null;
  const ownedMaterials = new Set<T.Material>();
  const ownedGeometries = new Set<T.BufferGeometry>();
  const ownedTextures = new Set<T.Texture>();
  const fabricNormalMap = fabricNormalTexture(THREE, lite);
  ownedTextures.add(fabricNormalMap);
  const skin = new THREE.MeshStandardMaterial({ color: kit?.skin ?? ['#b77b55', '#e4b58d', '#86563e', '#d89e76'][seat % 4], roughness: 0.83 });
  const shirt = new THREE.MeshStandardMaterial({ color: kit?.shirt ?? teamColors[seat % 2], roughness: 0.72, metalness: 0.02 });
  const shorts = new THREE.MeshStandardMaterial({ color: kit?.shorts ?? ['#142d49', '#a1a39a', '#384344', '#ece8db'][seat % 4], roughness: 0.84 });
  const shoe = new THREE.MeshStandardMaterial({ color: kit?.shoeColor ?? '#e9e7dd', roughness: 0.55 });
  const sole = new THREE.MeshStandardMaterial({ color: '#3a4040', roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: accents[seat % accents.length], roughness: 0.53 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: kit?.hair ?? ['#30261f', '#72513c', '#211e20', '#b0a18d'][seat % 4], roughness: 0.91 });
  const dark = new THREE.MeshStandardMaterial({ color: '#172127', roughness: 0.66 });
  const eyes = new THREE.MeshStandardMaterial({ color: '#f2eee2', roughness: 0.55 });
  const racketFrame = new THREE.MeshStandardMaterial({ color: kit?.racketColor ?? '#242a2a', metalness: 0.65, roughness: 0.29 });
  const grip = new THREE.MeshStandardMaterial({ color: '#242b31', roughness: 0.88 });
  applyFabric(shirt, fabricNormalMap);
  applyFabric(shorts, fabricNormalMap);

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
  if (kit) {
    const accessory = makeAccessory(THREE, kit.acc, kit.accColor);
    accessory.position.set(0, 1.79, 0.02);
    torso.add(accessory);
  } else {
    const headband = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.027, 8, 24), accent);
    headband.position.set(0, 1.82, 0.015);
    headband.rotation.x = Math.PI / 2;
    torso.add(headband);
  }
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.144, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMaterial);
  hair.position.set(0, 1.83, 0.02);
  torso.add(hair);
  if (!kit && seat % 2 === 1) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), accent);
    cap.position.set(0, 1.86, 0.02);
    torso.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 16, 1, false, 0, Math.PI), accent);
    brim.position.set(0, 1.83, 0.11);
    brim.rotation.x = Math.PI / 2;
    torso.add(brim);
  } else if (kit ? kit.model === 'female' : true) {
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

  const fallbackWristbandGeometry = new THREE.CylinderGeometry(0.041, 0.041, 0.05, 16);
  ownedGeometries.add(fallbackWristbandGeometry);
  const fallbackWristbandMaterial = new THREE.MeshStandardMaterial({ color: kit?.accColor ?? accents[seat % accents.length], roughness: 0.55 });
  ownedMaterials.add(fallbackWristbandMaterial);
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
  const racketWristband = new THREE.Mesh(fallbackWristbandGeometry, fallbackWristbandMaterial);
  racketWristband.position.y = -0.37;
  racketForearm.add(racketWristband);
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
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    fabricNormalMap,
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
      model.ownedGeometries.forEach((geometry) => geometry.dispose());
      model.ownedGeometries.clear();
      model.ownedTextures.forEach((texture) => texture.dispose());
      model.ownedTextures.clear();
    },
  };
  requestPlayerAsset(THREE, seat, model, character);
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
  const lunge = player.swingLunge;
  model.root.position.set(
    (model.debugPose?.position.x ?? x) + (model.debugPose ? 0 : player.lungeX * 0.38 * lunge),
    0,
    (model.debugPose?.position.z ?? z) + (model.debugPose ? 0 : player.lungeZ * 0.38 * lunge),
  );
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
  model.torso.scale.set(1, 1 + lunge * 0.06, 1);
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
