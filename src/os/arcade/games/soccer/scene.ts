import type * as T from 'three';
import type { World, Player, Team } from './logic.ts';
import { FIELD, jerseyNumber, teamDir } from './logic.ts';
import { clubById, DEFAULT_CLUBS, matchKits, rosterName, type Kit } from './teams.ts';
import { disposeTree, damp } from './gl.ts';
import { loadSoccerModel, MODEL_URLS } from './load.ts';
import { ballNumberTexture, ballTexture } from './textures.ts';
import { buildStadium, type PitchPattern } from './stadium.ts';
import { IDENTITY_BASIS, type ViewBasis } from './input.ts';
import { createPracticeMarkers } from './practice-markers.ts';
import type { PracticeMarker } from './practice.ts';
import { approachAngle, bindSoccerRig, bodyFrameVelocity, createSoccerAnimationInput, createSoccerAnimator, kickingFoot, playSoccerClip, preferredFoot, soccerClipActive, soccerDribbleOffset, updateSoccerAnimator, type SoccerAnimator, type SoccerClip } from './player.ts';
import type { SoccerRenderStats } from './perf.ts';
import { createFxLayer, type FxDirector } from './fx.ts';

type Three = typeof import('three');
export type CameraMode = 'broadcast' | 'end' | 'replay' | 'intro' | 'setpiece';
export type TimeMode = 'day' | 'night' | 'golden' | 'overcast' | 'rain';
export type SoccerCameraNdc = {
  ball: { x: number; y: number };
  feet: { x: number; y: number };
  powerBar: { x: number; y: number };
  maxAbsX: number;
  maxAbsY: number;
};
type Actor = { root: T.Group; anim: SoccerAnimator; team: Team; keeper: boolean; contact: T.Mesh; fallback: T.Group; marker: T.Mesh; arrow: T.Mesh; carrierRing: T.Mesh; powerBar: T.Group; powerFill: T.Mesh; number: T.Mesh; kitMaterials: Record<'shirt' | 'shorts' | 'socks' | 'trim', T.Material>; prevCooldown: number; prevAction: string; lastKick: World['kickEvent']; keeperShot: boolean; celebrated: boolean; lodTick: number; lodDt: number; skeletons: T.Skeleton[] };
type Crowd = { mesh: T.InstancedMesh; count: number; phases: number[]; baseY: number[]; fixtures: T.MeshStandardMaterial[] };

export type SoccerView = {
  resize(width: number, height: number): void;
  viewBasis(): ViewBasis;
  getCameraNdc(): SoccerCameraNdc;
  perfStats(): SoccerRenderStats;
  update(world: World, dt: number, time: number, humanTeam: Team, cameraMode: CameraMode, targetId?: number | null, power?: number | null): void;
  setFx(director: FxDirector | null): void;
  render(): void;
  /** Resolves once the shaders are compiled; frames rendered meanwhile are skipped. */
  precompile(): Promise<void>;
  /** Moves the canvas into another element, so a remounted match keeps its compiled scene. */
  attach(host: HTMLElement): void;
  setTime(mode: TimeMode): void;
  setPattern(pattern: PitchPattern): void;
  setKits(clubs: [string, string]): void;
  goal(): void;
  setMarkers(markers: readonly PracticeMarker[]): void;
  dispose(): void;
};

const defaultKits = matchKits(clubById(DEFAULT_CLUBS[0]), clubById(DEFAULT_CLUBS[1]));
const skinTones = ['#b87550', '#f0c19a', '#8e5942', '#d79b70', '#b88768'];

function isKeeper(player: Player) {
  return player.slot === 'GK';
}

function kickClip(action: string): SoccerClip | null {
  if (action === 'pass' || action === 'through') return 'pass';
  if (action === 'shoot' || action === 'finesse') return 'shot';
  if (action === 'lob' || action === 'cross') return 'lob';
  return null;
}

function replayClip(action: string): SoccerClip | null {
  if (action === 'kick') return 'shot';
  if (action === 'pass') return 'pass';
  if (action === 'tackle') return 'tackle';
  if (action === 'slide') return 'slide';
  if (action === 'skill' || action === 'stepover' || action === 'step-over') return 'skill';
  return null;
}

function startClip(actor: Actor, clip: SoccerClip, side: number, power: number, force = false) {
  if (!force && soccerClipActive(actor.anim) && actor.anim.clip === clip) return;
  playSoccerClip(actor.anim, clip, side, power);
}

function standard(THREE: Three, color: string, roughness = 0.76, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(THREE: Three, parent: T.Object3D, size: [number, number, number], at: [number, number, number], material: T.Material, cast = false, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...at);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function cylinderBetween(THREE: Three, parent: T.Object3D, from: T.Vector3, to: T.Vector3, radius: number, material: T.Material) {
  const delta = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 7), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  parent.add(mesh);
  return mesh;
}

function createPlayer(THREE: Three, player: Player, lite: boolean, kits: [Kit, Kit], keepers: [string, string]): Actor {
  const root = new THREE.Group();
  root.scale.setScalar(1.14);
  const fallback = new THREE.Group();
  const anim = createSoccerAnimator(THREE, (player.id * 0.618) % 1, preferredFoot(player.id));
  anim.figure.add(fallback);
  const kit = kits[player.team]!;
  const shirt = standard(THREE, isKeeper(player) ? keepers[player.team]! : kit.shirt, 0.52);
  const trim = standard(THREE, kit.trim, 0.62, 0.06);
  const shorts = standard(THREE, isKeeper(player) ? '#162536' : kit.shorts, 0.68);
  const socks = standard(THREE, kit.socks, 0.73);
  const boot = standard(THREE, '#172027', 0.38, 0.18);
  const skin = standard(THREE, skinTones[player.id % skinTones.length]!, 0.83);
  const hair = standard(THREE, ['#2a201c', '#523727', '#1d2022', '#957650'][player.id % 4]!, 0.92);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.47, 4, 8), shirt);
  torso.position.y = 1.22;
  torso.castShadow = true;
  fallback.add(torso);
  const chestStripe = box(THREE, fallback, [0.035, 0.62, 0.12], [0.04, 1.22, 0.235], trim);
  chestStripe.castShadow = false;
  const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.31, 0.3, 12), shorts);
  shortsMesh.position.y = 0.83;
  shortsMesh.castShadow = true;
  fallback.add(shortsMesh);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10), skin);
  neck.position.y = 1.53; fallback.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, lite ? 10 : 16, lite ? 8 : 12), skin);
  head.position.set(0, 1.73, 0.025); head.castShadow = true; fallback.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairCap.position.set(0, 1.78, 0.01); fallback.add(hairCap);
  const legs: [T.Mesh, T.Mesh] = [
    new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 3, 7), socks),
    new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 3, 7), socks),
  ];
  const boots: T.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    legs[i]!.position.set(side * 0.14, 0.45, 0);
    legs[i]!.castShadow = true;
    fallback.add(legs[i]!);
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.17, 2, 6), boot);
    b.position.set(side * 0.14, 0.13, 0.08);
    b.rotation.x = Math.PI / 2;
    fallback.add(b); boots.push(b);
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 3, 7), skin);
    arm.position.set(side * 0.31, 1.19, 0.015);
    arm.rotation.z = side * -0.12;
    arm.castShadow = true;
    fallback.add(arm);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.21, 8), shirt);
    sleeve.position.set(side * 0.29, 1.37, 0);
    sleeve.rotation.z = side * -0.16;
    fallback.add(sleeve);
  }
  const digit = new THREE.MeshBasicMaterial({ color: kit.number, side: THREE.DoubleSide });
  const numberTexture = ballNumberTexture(THREE, jerseyNumber(player.id));
  const number = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.22), new THREE.MeshBasicMaterial({ map: numberTexture, transparent: true, side: THREE.DoubleSide }));
  number.position.set(0, 1.25, -0.255);
  number.rotation.y = Math.PI;
  fallback.add(number);
  const contact = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), new THREE.MeshBasicMaterial({ color: '#08140f', transparent: true, opacity: 0.28, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.02;
  root.add(contact);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.54, 28), new THREE.MeshBasicMaterial({ color: player.team === 0 ? '#ff5368' : '#73defa', side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.035;
  root.add(marker);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 3), new THREE.MeshBasicMaterial({ color: player.team === 0 ? '#ff5368' : '#73defa' }));
  arrow.position.set(0, 2.55, 0); arrow.rotation.x = Math.PI;
  root.add(arrow);
  const carrierRing = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.58, 24), new THREE.MeshBasicMaterial({ color: '#fff1a8', transparent: true, opacity: 0.68, side: THREE.DoubleSide }));
  carrierRing.rotation.x = -Math.PI / 2; carrierRing.position.y = 0.04; carrierRing.visible = false; root.add(carrierRing);
  const powerBar = new THREE.Group();
  const powerBack = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.055), new THREE.MeshBasicMaterial({ color: '#07131b', transparent: true, opacity: 0.86, side: THREE.DoubleSide }));
  const powerFill = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.032), new THREE.MeshBasicMaterial({ color: '#e6f36d', side: THREE.DoubleSide }));
  powerBar.position.set(0, 1.98, 0); powerBack.rotation.x = -Math.PI / 2; powerFill.rotation.x = -Math.PI / 2;
  powerFill.position.y = 0.002; powerBar.add(powerBack, powerFill); powerBar.visible = false; root.add(powerBar);
  root.add(anim.figure);
  void boots;
  void digit;
  return { root, anim, team: player.team, keeper: isKeeper(player), contact, fallback, marker, arrow, carrierRing, powerBar, powerFill, number, kitMaterials: { shirt, shorts, socks, trim }, prevCooldown: 0, prevAction: 'idle', lastKick: null, keeperShot: false, celebrated: false, lodTick: 0, lodDt: 0, skeletons: [] };
}

// Broadcast telecam framing (main-stand gantry, long lens). Only the framing lives here; follow/smoothing stays in update().
// aimZ/followZ bias the aim point to the far side so the far ad boards and a band of crowd stay in shot.
const BROADCAST = { height: 25, distance: 50, fov: 24, pan: 0.55, aimZ: 6, followZ: 0.3 } as const;

export function createScene(THREE: Three, host: HTMLElement, lite: boolean, timeMode: TimeMode, pattern: PitchPattern): SoccerView | null {
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Soccer WebGL context creation failed', error);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  host.appendChild(canvas);
  const indicator = document.createElement('div');
  indicator.className = 'g-soccer-world-indicator';
  const indicatorArrow = document.createElement('i');
  const indicatorName = document.createElement('span');
  const indicatorPower = document.createElement('b');
  indicator.append(indicatorArrow, indicatorName, indicatorPower);
  host.appendChild(indicator);
  const projected = new THREE.Vector3();

  const scene = new THREE.Scene();
  const practiceMarkers = createPracticeMarkers(THREE, scene);
  const fxLayer = createFxLayer(THREE, scene);
  let fxDirector: FxDirector | null = null;
  const night = timeMode === 'night';
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 16; skyCanvas.height = 256;
  const skyContext = skyCanvas.getContext('2d')!;
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const skyMaterial = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 18), skyMaterial);
  sky.frustumCulled = false;
  scene.add(sky);
  const drawSky = (isNight: boolean) => {
    const gradient = skyContext.createLinearGradient(0, 0, 0, skyCanvas.height);
    if (isNight) {
      gradient.addColorStop(0, '#06101f');
      gradient.addColorStop(0.62, '#172b46');
      gradient.addColorStop(1, '#53647a');
    } else {
      gradient.addColorStop(0, '#7195b3');
      gradient.addColorStop(0.48, '#f1bd91');
      gradient.addColorStop(0.82, '#f6a66f');
      gradient.addColorStop(1, '#dc8058');
    }
    skyContext.fillStyle = gradient;
    skyContext.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
    skyTexture.needsUpdate = true;
  };
  drawSky(night);
  scene.background = null;
  scene.fog = new THREE.Fog(night ? '#142438' : '#d99a71', 150, 270);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 180);
  const cameraDirection = new THREE.Vector3();
  let lastViewBasis: ViewBasis = IDENTITY_BASIS;
  const hemi = new THREE.HemisphereLight('#d0e0e8', '#162b22', 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#f0f6ff', 3.2);
  key.position.set(-FIELD.length * 0.18, 34, FIELD.width * 0.19);
  key.castShadow = true;
  key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  key.shadow.camera.left = -FIELD.length / 2 - 14; key.shadow.camera.right = FIELD.length / 2 + 14;
  key.shadow.camera.top = FIELD.width / 2 + 12; key.shadow.camera.bottom = -FIELD.width / 2 - 12;
  key.shadow.camera.near = 1; key.shadow.camera.far = 110;
  key.shadow.bias = -0.00035; key.shadow.normalBias = 0.028;
  scene.add(key);

  const stadium = buildStadium(THREE, { renderer, scene, hemi, key }, {
    lite,
    kits: [
      { shirt: defaultKits.home.shirt, trim: defaultKits.home.trim, shorts: defaultKits.home.shorts },
      { shirt: defaultKits.away.shirt, trim: defaultKits.away.trim, shorts: defaultKits.away.shorts },
    ],
    conditions: timeMode,
    pattern,
  });

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#496783');
  const envLight = new THREE.HemisphereLight('#d6e8ff', '#2c3729', 1.8);
  envScene.add(envLight);
  for (let i = 0; i < 5; i++) {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(2.6 - i * 0.2, 8, 6), new THREE.MeshBasicMaterial({ color: ['#f5d6ac', '#7190ad', '#d8e0d5', '#586c86', '#e0b76e'][i]! }));
    orb.position.set(-12 + i * 6, 7 + i % 2 * 4, -5);
    envScene.add(orb);
  }
  let envTarget: T.WebGLRenderTarget | null = null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    pmrem.compileEquirectangularShader();
    envTarget = pmrem.fromScene(envScene);
    scene.environment = envTarget.texture;
  } catch {
    scene.environment = null;
  } finally {
    pmrem.dispose();
    disposeTree(envScene);
  }

  const ballMap = ballTexture(THREE);
  const ballMaterial = new THREE.MeshStandardMaterial({ map: ballMap, roughness: 0.3, metalness: 0.02, emissive: '#c8d8c9', emissiveIntensity: 0.22 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, lite ? 16 : 28, lite ? 12 : 20), ballMaterial);
  ball.castShadow = true; scene.add(ball);
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.48, 32), new THREE.MeshBasicMaterial({ color: '#ffe887', side: THREE.DoubleSide, depthTest: false, toneMapped: false, transparent: true, opacity: 0.9 }));
  reticle.visible = false;
  reticle.renderOrder = 10;
  scene.add(reticle);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: '#06150e', transparent: true, opacity: 0.32, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.025; scene.add(ballShadow);
  const actors = new Map<number, Actor>();
  const materialCache = new Map<string, Map<T.Material, T.Material>>();
  const attachments: Promise<void>[] = [];
  const modelMaterialRoles = new Map<T.Material, { team: Team; keeper: boolean; part: 'shirt' | 'shorts' | 'socks' | 'trim' }>();
  let activeKits: [Kit, Kit] = [defaultKits.home, defaultKits.away];
  let activeKeepers: [string, string] = defaultKits.keepers;
  let kitClubs: [string, string] = [...DEFAULT_CLUBS];
  const kitColor = (team: Team, keeper: boolean, part: 'shirt' | 'shorts' | 'socks' | 'trim' | 'number') => {
    if (part === 'shirt' && keeper) return activeKeepers[team];
    if (part === 'shorts' && keeper) return '#162536';
    return activeKits[team][part];
  };
  const recolor = (material: T.Material, color: string) => {
    (material as T.MeshStandardMaterial).color?.set(color);
  };
  const setKits = (clubs: [string, string]) => {
    if (kitClubs[0] === clubs[0] && kitClubs[1] === clubs[1]) return;
    kitClubs = [...clubs];
    const result = matchKits(clubById(clubs[0]), clubById(clubs[1]));
    activeKits = [result.home, result.away];
    activeKeepers = result.keepers;
    for (const actor of actors.values()) {
      for (const part of ['shirt', 'shorts', 'socks', 'trim'] as const) {
        recolor(actor.kitMaterials[part], kitColor(actor.team, actor.keeper, part));
      }
    }
    for (const [material, role] of modelMaterialRoles) recolor(material, kitColor(role.team, role.keeper, role.part));
  };
  const loadedAssets = new Map<string, Promise<{ scene: T.Object3D; clone: (source: T.Object3D) => T.Object3D }>>();
  const loadPlayer = (player: Player, actor: Actor) => {
    const url = player.id % 2 ? MODEL_URLS.male : MODEL_URLS.female;
    const pending = loadSoccerModel(url);
    attachments.push(pending.then((asset) => {
      if (disposed) return;
      const body = asset.clone(asset.scene);
      body.traverse((object) => {
        const mesh = object as T.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = !lite;
        const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const variant = `${player.team}:${isKeeper(player) ? 'keeper' : 'field'}`;
        let variants = materialCache.get(variant);
        if (!variants) { variants = new Map(); materialCache.set(variant, variants); }
        const materials = source.map((material) => {
          let cloned = variants!.get(material);
          if (!cloned) {
            cloned = material.clone() as T.MeshStandardMaterial;
            const name = material.name.trim().toLowerCase();
            const shirt = name === 'shirt' || name.includes('jersey');
            const shorts = name === 'shorts' || name.includes('short');
            const socks = name.includes('sock');
            const trim = name.includes('trim') || name.includes('stripe');
            const part: 'shirt' | 'shorts' | 'socks' | 'trim' | undefined = shirt ? 'shirt' : shorts ? 'shorts' : socks ? 'socks' : trim ? 'trim' : undefined;
            if (part) {
              const role = { team: player.team, keeper: isKeeper(player), part };
              modelMaterialRoles.set(cloned, role);
              recolor(cloned, kitColor(role.team, role.keeper, role.part));
            }
            variants!.set(material, cloned);
          }
          return cloned;
        });
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
      });
      actor.fallback.visible = false;
      bindSoccerRig(THREE, actor.anim, body);
      // Skinned bounds come from the posed rig; pad them so animated limbs and their shadows never pop.
      body.updateMatrixWorld(true);
      body.traverse((object) => {
        const skinned = object as T.SkinnedMesh;
        if (!skinned.isSkinnedMesh) return;
        if (!actor.skeletons.includes(skinned.skeleton)) {
          actor.skeletons.push(skinned.skeleton);
          skinned.skeleton.update();
        }
        skinned.computeBoundingSphere();
        skinned.boundingSphere!.radius *= 1.6;
      });
      attachBackNumber(actor, body, url);
    }).catch(() => {
      if (import.meta.env.DEV) console.warn(`Soccer player model unavailable: ${url}; using procedural player`);
    }));
  };
  // Shirt numbers ride the upper spine bone, placed on the back of each model's chest.
  const chestBack = new Map<string, { y: number; z: number }>();
  const attachBackNumber = (actor: Actor, body: T.Object3D, url: string) => {
    const spine = body.getObjectByName('spine_03') ?? body.getObjectByName('spine_02');
    if (!spine) return;
    const figure = actor.anim.figure;
    figure.updateMatrixWorld(true);
    let chest = chestBack.get(url);
    if (!chest) {
      const toFigure = figure.matrixWorld.clone().invert();
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      const meshes: { position: T.BufferAttribute; matrix: T.Matrix4 }[] = [];
      body.traverse((object) => {
        const mesh = object as T.Mesh;
        const position = mesh.isMesh ? mesh.geometry.getAttribute('position') as T.BufferAttribute | undefined : undefined;
        if (position) meshes.push({ position, matrix: m.clone().multiplyMatrices(toFigure, mesh.matrixWorld) });
      });
      let top = 0;
      for (const { position, matrix } of meshes) for (let i = 0; i < position.count; i++) top = Math.max(top, v.fromBufferAttribute(position, i).applyMatrix4(matrix).y);
      let back = 0;
      for (const { position, matrix } of meshes) for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix);
        if (v.y > top * 0.66 && v.y < top * 0.76 && Math.abs(v.x) < top * 0.06) back = Math.min(back, v.z);
      }
      chest = { y: top * 0.705, z: back };
      chestBack.set(url, chest);
    }
    if (chest.z >= 0) return;
    const number = actor.number;
    figure.add(number);
    number.position.set(0, chest.y, chest.z - 0.015);
    number.rotation.set(0, Math.PI, 0);
    number.scale.setScalar(1.2);
    number.updateMatrixWorld(true);
    spine.attach(number);
  };
  const ensureActor = (player: Player) => {
    let actor = actors.get(player.id);
    if (actor) return actor;
    actor = createPlayer(THREE, player, lite, activeKits, activeKeepers);
    actors.set(player.id, actor);
    scene.add(actor.root);
    loadPlayer(player, actor);
    return actor;
  };

  const animationInput = createSoccerAnimationInput();
  const frustum = new THREE.Frustum();
  const frustumMatrix = new THREE.Matrix4();
  const playerSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  let elapsed = 0;
  let previousScore: [number, number] = [0, 0];
  let lastScoreChange = -Infinity;
  const roar: [number, number] = [0, 0];
  let introStartedAt: number | null = null;
  let disposed = false;
  const target = new THREE.Vector3(0, 0, 0);
  const desired = new THREE.Vector3(0, 0, 0);
  const introCameraStart = new THREE.Vector3(-FIELD.length * 0.62, 30, -FIELD.width * 0.9);
  const lookAt = new THREE.Vector3(0, 0, 0);
  const cameraSafeOffset = new THREE.Vector3();
  const cameraPanShift = new THREE.Vector3();
  const cameraSample = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cameraNdc: SoccerCameraNdc = {
    ball: { x: 0, y: 0 },
    feet: { x: 0, y: 0 },
    powerBar: { x: 0, y: 0 },
    maxAbsX: 0,
    maxAbsY: 0,
  };
  const cameraDepth = { ball: 1, feet: 1, powerBar: 1 };
  const cameraBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, centerX: 0, centerY: 0, depth: 1 };
  let cameraPanned = false;
  let cameraReady = false;
  let width = 1, height = 1;
  function updateCameraNdc(world: World, controlledPlayer: Player | null) {
    camera.getWorldDirection(cameraDirection);
    const playerActor = controlledPlayer ? actors.get(controlledPlayer.id) : null;
    const scale = playerActor?.root.scale.y ?? 1.14;
    const feetY = Math.max(0, playerActor?.anim.figure.position.y ?? 0);
    const playerX = controlledPlayer?.x ?? world.ball.x;
    const playerZ = controlledPlayer?.z ?? world.ball.z;
    const direction = cameraDirection;
    const cameraX = camera.position.x, cameraY = camera.position.y, cameraZ = camera.position.z;
    cameraDepth.ball = Math.max(1, (world.ball.x - cameraX) * direction.x + (world.ball.y - cameraY) * direction.y + (world.ball.z - cameraZ) * direction.z);
    cameraSample.set(world.ball.x, world.ball.y, world.ball.z).project(camera);
    cameraNdc.ball.x = cameraSample.x;
    cameraNdc.ball.y = cameraSample.y;
    cameraDepth.feet = Math.max(1, (playerX - cameraX) * direction.x + (feetY - cameraY) * direction.y + (playerZ - cameraZ) * direction.z);
    cameraSample.set(playerX, feetY, playerZ).project(camera);
    cameraNdc.feet.x = cameraSample.x;
    cameraNdc.feet.y = cameraSample.y;
    const barY = feetY + 2.2 * scale;
    cameraDepth.powerBar = Math.max(1, (playerX - cameraX) * direction.x + (barY - cameraY) * direction.y + (playerZ - cameraZ) * direction.z);
    cameraSample.set(playerX, barY, playerZ).project(camera);
    cameraNdc.powerBar.x = cameraSample.x;
    cameraNdc.powerBar.y = cameraSample.y;
    cameraNdc.maxAbsX = Math.max(Math.abs(cameraNdc.ball.x), Math.abs(cameraNdc.feet.x), Math.abs(cameraNdc.powerBar.x));
    cameraNdc.maxAbsY = Math.max(Math.abs(cameraNdc.ball.y), Math.abs(cameraNdc.feet.y), Math.abs(cameraNdc.powerBar.y));
    cameraBounds.minX = Math.min(cameraNdc.ball.x, cameraNdc.feet.x, cameraNdc.powerBar.x);
    cameraBounds.maxX = Math.max(cameraNdc.ball.x, cameraNdc.feet.x, cameraNdc.powerBar.x);
    cameraBounds.minY = Math.min(cameraNdc.ball.y, cameraNdc.feet.y, cameraNdc.powerBar.y);
    cameraBounds.maxY = Math.max(cameraNdc.ball.y, cameraNdc.feet.y, cameraNdc.powerBar.y);
    cameraBounds.centerX = (cameraBounds.minX + cameraBounds.maxX) * 0.5;
    cameraBounds.centerY = (cameraBounds.minY + cameraBounds.maxY) * 0.5;
    cameraBounds.depth = (cameraDepth.ball + cameraDepth.feet + cameraDepth.powerBar) / 3;
  }
  function panCameraToSafeArea(world: World, controlledPlayer: Player) {
    updateCameraNdc(world, controlledPlayer);
    if (cameraNdc.maxAbsX <= 0.8 && cameraNdc.maxAbsY <= 0.75) return;
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const halfHeight = cameraBounds.depth * Math.tan(camera.fov * Math.PI / 360);
    const shiftX = cameraBounds.centerX * halfHeight * camera.aspect;
    const shiftY = cameraBounds.centerY * halfHeight;
    cameraPanned = true;
    cameraPanShift.copy(cameraRight).multiplyScalar(shiftX).addScaledVector(cameraUp, shiftY);
    camera.position.add(cameraPanShift);
    cameraSafeOffset.add(cameraPanShift);
    target.add(cameraPanShift);
    desired.add(cameraPanShift);
    lookAt.copy(target);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld(true);
    updateCameraNdc(world, controlledPlayer);
  }
  function keepCameraSubjectsInFrame(world: World, controlledPlayer: Player, baseFov: number, dt: number) {
    cameraPanned = false;
    updateCameraNdc(world, controlledPlayer);
    for (let i = 0; i < 3 && (cameraNdc.maxAbsX > 0.8 || cameraNdc.maxAbsY > 0.75); i++) {
      panCameraToSafeArea(world, controlledPlayer);
    }
    if (cameraNdc.maxAbsX > 0.8 || cameraNdc.maxAbsY > 0.75) {
      const fitScale = Math.max(
        (cameraBounds.maxX - cameraBounds.minX) / 1.6,
        (cameraBounds.maxY - cameraBounds.minY) / 1.5,
      );
      if (fitScale > 1) {
        const requiredFov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * fitScale) * 180 / Math.PI;
        const safeFov = Math.min(baseFov + 8, Math.max(camera.fov, requiredFov));
        if (safeFov > camera.fov) {
          camera.fov = Math.max(damp(camera.fov, safeFov, 2.4, dt), Math.min(baseFov + 8, requiredFov));
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          updateCameraNdc(world, controlledPlayer);
          for (let i = 0; i < 3 && (cameraNdc.maxAbsX > 0.8 || cameraNdc.maxAbsY > 0.75); i++) {
            panCameraToSafeArea(world, controlledPlayer);
          }
        }
      }
    }
    updateCameraNdc(world, controlledPlayer);
    if (!cameraPanned && dt > 0) {
      cameraSafeOffset.x = damp(cameraSafeOffset.x, 0, 0.7, dt);
      cameraSafeOffset.y = damp(cameraSafeOffset.y, 0, 0.7, dt);
      cameraSafeOffset.z = damp(cameraSafeOffset.z, 0, 0.7, dt);
    }
  }
  const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('soccerdebug');
  const quality = {
    dpr: Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2),
    slow: 0,
    stable: 0,
    lastRender: 0,
    avgMs: 16.7,
    shadows: true,
    crowdHalf: false,
    nextLog: 0,
  };
  renderer.setPixelRatio(quality.dpr);
  const onLost = (event: Event) => event.preventDefault();
  canvas.addEventListener('webglcontextlost', onLost);

  function resize(w: number, h: number) {
    width = Math.max(1, w); height = Math.max(1, h);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = height > width ? 84 : BROADCAST.fov;
    camera.updateProjectionMatrix();
  }

  function update(world: World, dt: number, time: number, humanTeam: Team, cameraMode: CameraMode, targetId: number | null = null, power: number | null = null) {
    const clubs = world.clubs ?? DEFAULT_CLUBS;
    setKits([clubs[0], clubs[1]]);
    elapsed += Math.min(0.05, dt);
    let scoreChanged = false;
    for (const team of [0, 1] as const) {
      if (world.score[team] > previousScore[team]) {
        roar[team] = 1;
        roar[1 - team] = -0.7;
      }
      if (world.score[team] !== previousScore[team]) scoreChanged = true;
    }
    if (scoreChanged) lastScoreChange = elapsed;
    previousScore = [...world.score];
    roar[0] = damp(roar[0], 0, 1 / 6, dt);
    roar[1] = damp(roar[1], 0, 1 / 6, dt);
    if (cameraMode === 'intro') introStartedAt ??= time;
    else introStartedAt = null;
    let currentCarrier: World['players'][number] | null = null;
    let controlledPlayer: World['players'][number] | null = null;
    let controlled: World['players'][number] | null = null;
    for (const player of world.players) {
      if (currentCarrier === null && Math.hypot(world.ball.x - player.x, world.ball.z - player.z) < 0.8) currentCarrier = player;
      if (controlledPlayer === null && player.id === world.controlled[humanTeam]) controlledPlayer = player;
      if (controlled === null && player.controlled) controlled = player;
    }
    let dribbleOffsetX = 0;
    let dribbleOffsetZ = 0;

    const portrait = camera.aspect < 0.72;
    const attackDir = teamDir(humanTeam, world.endsSwapped);
    const focusDx = (controlledPlayer?.x ?? world.ball.x) - world.ball.x;
    const focusDz = (controlledPlayer?.z ?? world.ball.z) - world.ball.z;
    const focusDistance = Math.hypot(focusDx, focusDz);
    const playerFocusWeight = controlledPlayer ? Math.min(0.32, 8 / Math.max(0.001, focusDistance)) : 0;
    const focusX = world.ball.x + focusDx * playerFocusWeight;
    const focusZ = world.ball.z + focusDz * playerFocusWeight;
    const broadcast = cameraMode === 'broadcast' || cameraMode === 'intro';
    const trackedX = broadcast
      ? focusX + attackDir * FIELD.goalWidth * 0.3
      : world.ball.x * 0.35;
    target.set(
      trackedX + (portrait && broadcast ? attackDir * FIELD.goalWidth * 0.28 : attackDir * FIELD.goalWidth * 0.2),
      0.55,
      broadcast ? portrait ? focusZ * 0.55 : BROADCAST.aimZ + (focusZ - BROADCAST.aimZ) * BROADCAST.followZ : world.ball.z * 0.22,
    );
    if (cameraMode === 'replay') desired.set(world.ball.x - attackDir * FIELD.goalWidth * 1.1, 5.2, world.ball.z + FIELD.width * 0.2);
    else if (broadcast && portrait) desired.set(target.x - attackDir * FIELD.width * 0.42, FIELD.width * 0.24, target.z);
    else if (broadcast) desired.set(target.x * BROADCAST.pan, BROADCAST.height, -BROADCAST.distance);
    else desired.set(target.x - attackDir * FIELD.length * 0.26, FIELD.width * 0.2, target.z);
    const setPiece = world.setPiece;
    reticle.visible = world.phase === 'restart' && !!setPiece;
    if (setPiece) {
      const mouth = setPiece.kind === 'penalty' || setPiece.kind === 'free-kick' && setPiece.option === 'direct';
      reticle.rotation.set(mouth ? 0 : -Math.PI / 2, mouth ? Math.PI / 2 : 0, 0);
      reticle.scale.setScalar(mouth ? 1 : 4);
      reticle.position.set(setPiece.aim.x, mouth ? setPiece.aim.y : 0.12, setPiece.aim.z);
      if (cameraMode === 'setpiece') {
        const dx = setPiece.aim.x - world.ball.x, dz = setPiece.aim.z - world.ball.z;
        const gap = Math.max(0.01, Math.hypot(dx, dz)), behind = setPiece.kind === 'penalty' ? 6 : 9;
        target.set(setPiece.aim.x, setPiece.aim.y, setPiece.aim.z);
        desired.set(world.ball.x - dx / gap * behind, setPiece.kind === 'penalty' ? 1.9 : 3.5, world.ball.z - dz / gap * behind + (setPiece.kind === 'penalty' ? 2.4 : 0));
        if (setPiece.kind === 'corner') {
          desired.x = Math.max(-FIELD.length / 2 + 3, Math.min(FIELD.length / 2 - 3, desired.x));
          desired.z = Math.max(-FIELD.width / 2 + 5, Math.min(FIELD.width / 2 - 5, desired.z));
          desired.y = 8;
        }
      }
    }
    if (broadcast) {
      target.add(cameraSafeOffset);
      desired.add(cameraSafeOffset);
    } else {
      cameraSafeOffset.set(0, 0, 0);
    }
    const broadcastZoom = portrait ? 68 : BROADCAST.fov;
    const zoom = cameraMode === 'setpiece' ? portrait ? 62 : 42 : cameraMode === 'replay' ? 36 : cameraMode === 'broadcast' || cameraMode === 'intro' ? broadcastZoom : 28;
    if (cameraMode === 'intro') {
      const p = Math.max(0, Math.min(1, (time - (introStartedAt ?? time)) / 5.5));
      const t = p * p * (3 - 2 * p);
      camera.position.lerpVectors(introCameraStart, desired, t);
      target.multiplyScalar(t);
      camera.fov = 50 + (broadcastZoom - 50) * t;
    } else {
      camera.fov = damp(camera.fov, zoom, 2.4, dt);
    }
    camera.updateProjectionMatrix();
    if (cameraMode === 'intro') {
      camera.lookAt(target);
      cameraReady = true;
    } else if (!cameraReady) {
      camera.position.copy(desired);
      camera.lookAt(target);
      cameraReady = true;
    } else {
      camera.position.x = damp(camera.position.x, desired.x, 2.8, dt);
      camera.position.y = damp(camera.position.y, desired.y, 2.8, dt);
      camera.position.z = damp(camera.position.z, desired.z, 2.8, dt);
      lookAt.set(target.x, target.y, target.z);
      camera.lookAt(lookAt);
    }
    camera.updateMatrixWorld(true);
    if (cameraMode === 'broadcast' && controlledPlayer) {
      keepCameraSubjectsInFrame(world, controlledPlayer, zoom, dt);
    } else {
      updateCameraNdc(world, controlledPlayer);
    }
    if (cameraMode !== 'replay' && cameraMode !== 'intro') {
      camera.getWorldDirection(cameraDirection);
      const forwardLength = Math.hypot(cameraDirection.x, cameraDirection.z);
      if (forwardLength >= 1e-3) {
        const forward = { x: cameraDirection.x / forwardLength, z: cameraDirection.z / forwardLength };
        lastViewBasis = { forward, right: { x: -forward.z, z: forward.x } };
      }
    }
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);
    const homeCall = clubById(world.clubs?.[0] ?? DEFAULT_CLUBS[0]).call.toLowerCase();
    const scoringTeam = world.event.toLowerCase().startsWith(homeCall) ? 0 : 1;
    for (const player of world.players) {
      const actor = ensureActor(player);
      actor.root.position.set(player.x, 0, player.z);
      const speed = Math.hypot(player.vx, player.vz);
      const kickEvent = world.kickEvent;
      const eventForPlayer = kickEvent?.playerId === player.id;
      if (eventForPlayer && kickEvent && kickEvent !== actor.lastKick) {
        const clip = kickClip(kickEvent.action);
        if (clip) {
          const foot = kickingFoot(actor.root.rotation.y, world.ball.vx, world.ball.vz, actor.anim.foot);
          startClip(actor, clip, foot === 'l' ? 1 : -1, kickEvent.power, true);
        }
      } else if (!eventForPlayer && player.cooldown > actor.prevCooldown + 0.05) {
        const clip = replayClip(player.action);
        if (clip) {
          const side = player.action === 'slide'
            ? bodyFrameVelocity(actor.root.rotation.y, player.vx, player.vz, actor.anim.frame).side >= 0 ? 1 : -1
            : kickingFoot(actor.root.rotation.y, world.ball.x - player.x, world.ball.z - player.z, actor.anim.foot) === 'l' ? 1 : -1;
          startClip(actor, clip, side, 0.5);
        }
      }
      actor.lastKick = kickEvent;
      if (world.phase !== 'goal') actor.celebrated = false;
      const celebrating = world.phase === 'goal' && cameraMode !== 'replay' && player.team === scoringTeam && !isKeeper(player);
      if (celebrating && !actor.celebrated) {
        startClip(actor, 'celebrate', 1, 0.5);
        actor.celebrated = true;
      }
      const ownGoalX = -teamDir(player.team, world.endsSwapped) * FIELD.length / 2;
      const ballSpeed = Math.hypot(world.ball.vx, world.ball.vz);
      const towardOwnGoal = world.ball.vx * -teamDir(player.team, world.endsSwapped) > 0;
      if (isKeeper(player)) {
        const keeperPlaneX = ownGoalX + teamDir(player.team, world.endsSwapped) * 1.5;
        if (player.action !== actor.prevAction && (player.action === 'dive' || player.action === 'catch' || player.action === 'parry')) {
          const timeToPlane = (keeperPlaneX - world.ball.x) / world.ball.vx;
          const crossingZ = timeToPlane > 0 ? world.ball.z + world.ball.vz * timeToPlane : world.ball.z;
          const side = bodyFrameVelocity(actor.root.rotation.y, keeperPlaneX - player.x, crossingZ - player.z, actor.anim.frame).side >= 0 ? 1 : -1;
          startClip(actor, player.action === 'dive' ? 'dive' : 'catch', side, 0.5);
          actor.keeperShot = true;
        }
        if (ballSpeed < 6 || !towardOwnGoal) actor.keeperShot = false;
        const hasKeeperAction = player.action === 'ready' || player.action === 'dive' || player.action === 'catch' || player.action === 'parry';
        if (!hasKeeperAction && !actor.keeperShot && ballSpeed > 10 && towardOwnGoal) {
          const timeToPlane = (keeperPlaneX - world.ball.x) / world.ball.vx;
          if (timeToPlane > 0 && timeToPlane < 0.42) {
            const keeperZ = player.z + player.vz * timeToPlane;
            const lateral = world.ball.z + world.ball.vz * timeToPlane - keeperZ;
            const side = bodyFrameVelocity(
              actor.root.rotation.y,
              world.ball.x + world.ball.vx * timeToPlane - player.x,
              lateral,
              actor.anim.frame,
            ).side >= 0 ? 1 : -1;
            startClip(actor, Math.abs(lateral) > 0.7 ? 'dive' : 'catch', side, 0.5);
            actor.keeperShot = true;
          }
        }
      } else {
        actor.keeperShot = false;
      }
      const carrying = currentCarrier?.id === player.id;
      const carrierDx = currentCarrier ? currentCarrier.x - player.x : 0;
      const carrierDz = currentCarrier ? currentCarrier.z - player.z : 0;
      const jockey = !isKeeper(player) && speed < 6.5 && currentCarrier !== null
        && currentCarrier.team !== player.team && Math.hypot(carrierDx, carrierDz) < 4.5;
      if (!soccerClipActive(actor.anim) || (actor.anim.clip !== 'slide' && actor.anim.clip !== 'dive')) {
        let facing = actor.root.rotation.y;
        if (celebrating) facing = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
        else if (jockey && currentCarrier) facing = Math.atan2(carrierDx, carrierDz);
        else if (speed > 0.4) facing = Math.atan2(player.vx, player.vz);
        else if (player.controlled) facing = player.facing;
        else facing = Math.atan2(world.ball.x - player.x, world.ball.z - player.z);
        actor.root.rotation.y = approachAngle(actor.root.rotation.y, facing, 10, dt, 9);
      }
      actor.marker.visible = player.controlled || player.id === targetId;
      (actor.marker.material as T.MeshBasicMaterial).color.set(player.id === targetId && !player.controlled ? '#fff28a' : player.team === 0 ? '#ff5368' : '#73defa');
      if (player.controlled || player.id === targetId) (actor.marker.material as T.MeshBasicMaterial).opacity = 0.72 + Math.sin(elapsed * 5) * 0.18;
      actor.arrow.visible = player.controlled;
      actor.carrierRing.visible = carrying;
      actor.powerBar.visible = false;
      const input = animationInput;
      input.vx = player.vx;
      input.vz = player.vz;
      input.yaw = actor.root.rotation.y;
      input.scale = actor.root.scale.x;
      input.time = time;
      input.carrying = carrying;
      input.jockey = jockey;
      input.keeperSet = isKeeper(player) && Math.abs(world.ball.x - ownGoalX) < 25;
      input.lookX = world.ball.x - player.x;
      input.lookY = world.ball.y;
      input.lookZ = world.ball.z - player.z;
      input.charge = carrying && player.controlled ? power : null;
      playerSphere.center.set(player.x, 1, player.z);
      const offscreen = !frustum.intersectsSphere(playerSphere);
      const cameraDx = player.x - camera.position.x;
      const cameraDy = 1 - camera.position.y;
      const cameraDz = player.z - camera.position.z;
      const interval = offscreen ? 4 : cameraDx * cameraDx + cameraDy * cameraDy + cameraDz * cameraDz > 35 * 35 ? 2 : 1;
      actor.lodDt += dt;
      actor.lodTick = (actor.lodTick + 1) % interval;
      if (interval === 1 || actor.lodTick === player.id % interval) {
        updateSoccerAnimator(actor.anim, input, actor.lodDt);
        actor.lodDt = 0;
        // The renderer only refreshes bones for camera-visible skins; off-shot players still cast shadows into it.
        if (offscreen) for (const skeleton of actor.skeletons) skeleton.update();
      }
      const lift = Math.max(0, actor.anim.figure.position.y);
      actor.contact.position.x = actor.anim.figure.position.x;
      actor.contact.position.z = actor.anim.figure.position.z;
      const contactMaterial = actor.contact.material as T.MeshBasicMaterial;
      contactMaterial.opacity = 0.28 * (1 - Math.min(1, Math.max(0, (lift - 0.2) / 1.3)));
      const contactScale = 1 - Math.min(0.6, lift * 0.35);
      actor.contact.scale.set(contactScale, contactScale, 1);
      if (carrying && speed > 0.8 && !soccerClipActive(actor.anim) && world.ball.y < 0.3) {
        const offset = soccerDribbleOffset(actor.anim, speed) / speed;
        dribbleOffsetX = player.vx * offset;
        dribbleOffsetZ = player.vz * offset;
      }
      actor.prevCooldown = player.cooldown;
      actor.prevAction = player.action;
    }
    ball.position.set(world.ball.x + dribbleOffsetX, world.ball.y, world.ball.z + dribbleOffsetZ);
    ball.rotation.z += world.ball.vx * dt / 0.11;
    ball.rotation.x += world.ball.vz * dt / 0.11;
    ballShadow.position.set(ball.position.x, 0.028, ball.position.z);
    if (fxDirector) fxLayer.update(fxDirector, ball.position, world.ball, camera, dt);
    const shadowScale = Math.max(0.25, 1.1 - world.ball.y * 0.2);
    ballShadow.scale.set(shadowScale, shadowScale, 1);
    if (controlled && cameraMode !== 'setpiece') {
      projected.set(controlled.x, 2.75, controlled.z).project(camera);
      const visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
      indicator.style.display = visible ? 'grid' : 'none';
      if (visible) {
        indicator.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        indicator.style.top = `${(0.5 - projected.y * 0.5) * height}px`;
        indicator.style.setProperty('--player-color', activeKits[controlled.team].shirt);
        const name = rosterName(clubById(world.clubs?.[controlled.team]), controlled.id % 11).toUpperCase();
        indicatorName.textContent = `NO. ${jerseyNumber(controlled.id)}  ${name}`;
        indicatorPower.style.width = power === null ? '0%' : `${Math.round(Math.max(0.04, power) * 100)}%`;
        indicatorPower.style.visibility = power === null ? 'hidden' : 'visible';
        indicatorPower.style.backgroundColor = (power ?? 0) > 0.85 ? '#ff755f' : '#e6f36d';
      }
    } else indicator.style.display = 'none';
    const sunLow = stadium.sunLow();
    key.position.set(target.x - FIELD.length * 0.17, sunLow ? 18 : 30, target.z + (sunLow ? FIELD.width * 0.3 : -FIELD.width * 0.28));
    key.target.position.set(target.x, 0, target.z);
    key.target.updateMatrixWorld();
    key.shadow.camera.updateProjectionMatrix();
    stadium.update({
      ball: { x: ball.position.x, y: ball.position.y, z: ball.position.z },
      ballInNet: world.ball.inNet,
      roar,
      camera,
      dt,
      time: elapsed,
    });
    void time;
  }

  function setTime(mode: TimeMode) {
    stadium.setConditions(mode);
  }

  function reduceQuality() {
    if (quality.dpr > 1.01) {
      quality.dpr = quality.dpr > 1.75 ? 1.5 : quality.dpr > 1.35 ? 1.25 : 1;
      renderer.setPixelRatio(quality.dpr);
      return;
    }
    if (quality.shadows) {
      quality.shadows = false;
      key.castShadow = false;
      renderer.shadowMap.enabled = false;
      return;
    }
    if (!quality.crowdHalf) {
      quality.crowdHalf = true;
      stadium.reduceCrowd();
    }
  }

  let warming = false;
  /** Compiles every shader the match needs (players included) without blocking, before the first frame draws. */
  async function precompile() {
    warming = true;
    try {
      await Promise.allSettled(attachments);
      if (!disposed) await renderer.compileAsync(scene, camera);
    } catch {
      // The first frame compiles whatever is left.
    } finally {
      warming = false;
    }
  }

  function render() {
    if (warming) return;
    const now = performance.now();
    if (quality.lastRender > 0) {
      const frameMs = now - quality.lastRender;
      quality.avgMs = quality.avgMs * 0.92 + frameMs * 0.08;
      if (quality.avgMs > 20) {
        quality.slow++;
        quality.stable = 0;
        if (quality.slow >= 45) {
          reduceQuality();
          quality.slow = 0;
        }
      } else {
        quality.slow = 0;
        quality.stable++;
      }
    }
    quality.lastRender = now;
    fxLayer.applyCamera(camera);
    try {
      renderer.render(scene, camera);
    } finally {
      fxLayer.restoreCamera(camera);
    }
    if (debug && now >= quality.nextLog) {
      quality.nextLog = now + 3000;
      console.info('[soccerdebug]', {
        dpr: quality.dpr,
        frameMs: Number(quality.avgMs.toFixed(1)),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        shadows: quality.shadows,
        crowd: stadium.crowdCount(),
      });
    }
  }

  return {
    resize,
    viewBasis() {
      return {
        right: { ...lastViewBasis.right },
        forward: { ...lastViewBasis.forward },
      };
    },
    getCameraNdc() {
      return cameraNdc;
    },
    perfStats() {
      return {
        rendererCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        shadowsEnabled: renderer.shadowMap.enabled,
        shadowType: renderer.shadowMap.type,
        shadowWidth: key.shadow.mapSize.width,
        shadowHeight: key.shadow.mapSize.height,
        crowdMeshCount: stadium.crowdCount(),
      };
    },
    update,
    setFx(director) { fxDirector = director; },
    render,
    precompile,
    attach(next) {
      next.appendChild(canvas);
      next.appendChild(indicator);
    },
    setTime,
    setPattern(pattern) { stadium.setPattern(pattern); },
    setKits,
    goal() {
      if (elapsed - lastScoreChange > 0.5) {
        roar[0] = Math.max(roar[0], 0.8);
        roar[1] = Math.max(roar[1], 0.8);
      }
    },
    setMarkers(markers) { practiceMarkers.set(markers, performance.now() / 1000); },
    dispose() {
      disposed = true;
      practiceMarkers.dispose();
      canvas.removeEventListener('webglcontextlost', onLost);
      stadium.dispose();
      fxLayer.dispose();
      disposeTree(scene);
      indicator.remove();
      ballMap.dispose();
      envTarget?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
