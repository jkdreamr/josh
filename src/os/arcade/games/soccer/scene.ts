import type * as T from 'three';
import type { World, Player, Team } from './logic.ts';
import { FIELD, jerseyNumber, teamDir } from './logic.ts';
import { disposeTree, damp } from './gl.ts';
import { loadSoccerModel, MODEL_URLS } from './load.ts';
import { adTexture, ballNumberTexture, ballTexture, markingsTexture, pitchTextures } from './textures.ts';
import { IDENTITY_BASIS, type ViewBasis } from './input.ts';
import { approachAngle, bindSoccerRig, bodyFrameVelocity, createSoccerAnimationInput, createSoccerAnimator, kickingFoot, playSoccerClip, preferredFoot, soccerClipActive, soccerDribbleOffset, updateSoccerAnimator, type SoccerAnimator, type SoccerClip } from './player.ts';
import type { SoccerRenderStats } from './perf.ts';

type Three = typeof import('three');
export type CameraMode = 'broadcast' | 'end' | 'replay';
export type TimeMode = 'night' | 'golden';
export type SoccerCameraNdc = {
  ball: { x: number; y: number };
  feet: { x: number; y: number };
  powerBar: { x: number; y: number };
  maxAbsX: number;
  maxAbsY: number;
};
type Actor = { root: T.Group; anim: SoccerAnimator; contact: T.Mesh; fallback: T.Group; marker: T.Mesh; arrow: T.Mesh; carrierRing: T.Mesh; powerBar: T.Group; powerFill: T.Mesh; number: T.Mesh; prevCooldown: number; prevAction: string; lastKick: World['kickEvent']; keeperShot: boolean; celebrated: boolean; lodTick: number; lodDt: number };
type Crowd = { mesh: T.InstancedMesh; count: number; phases: number[]; baseY: number[]; fixtures: T.MeshStandardMaterial[] };

export type SoccerView = {
  resize(width: number, height: number): void;
  viewBasis(): ViewBasis;
  getCameraNdc(): SoccerCameraNdc;
  perfStats(): SoccerRenderStats;
  update(world: World, dt: number, time: number, humanTeam: Team, cameraMode: CameraMode, targetId?: number | null, power?: number | null): void;
  render(): void;
  /** Resolves once the shaders are compiled; frames rendered meanwhile are skipped. */
  precompile(): Promise<void>;
  /** Moves the canvas into another element, so a remounted match keeps its compiled scene. */
  attach(host: HTMLElement): void;
  setTime(mode: TimeMode): void;
  goal(): void;
  dispose(): void;
};

const teamKit = [
  { shirt: '#d52f43', shorts: '#faf6ed', trim: '#fff3e5', keeper: '#f6c945' },
  { shirt: '#112744', shorts: '#7bc9ee', trim: '#c7efff', keeper: '#f18548' },
] as const;
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

function createPlayer(THREE: Three, player: Player, lite: boolean): Actor {
  const root = new THREE.Group();
  root.scale.setScalar(1.14);
  const fallback = new THREE.Group();
  const anim = createSoccerAnimator(THREE, (player.id * 0.618) % 1, preferredFoot(player.id));
  anim.figure.add(fallback);
  const kit = teamKit[player.team]!;
  const shirt = standard(THREE, isKeeper(player) ? kit.keeper : kit.shirt, 0.52);
  const trim = standard(THREE, kit.trim, 0.62, 0.06);
  const shorts = standard(THREE, isKeeper(player) ? '#162536' : kit.shorts, 0.68);
  const socks = standard(THREE, player.team === 0 ? '#f7f4ec' : '#10243a', 0.73);
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
  const digit = new THREE.MeshBasicMaterial({ color: player.team === 0 ? '#fef3e6' : '#17293e', side: THREE.DoubleSide });
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
  return { root, anim, contact, fallback, marker, arrow, carrierRing, powerBar, powerFill, number, prevCooldown: 0, prevAction: 'idle', lastKick: null, keeperShot: false, celebrated: false, lodTick: 0, lodDt: 0 };
}

function makeCrowd(THREE: Three, parent: T.Object3D, lite: boolean): Crowd {
  const count = lite ? 450 : 1000;
  const geometry = new THREE.CapsuleGeometry(0.12, 0.34, 2, 6);
  const material = new THREE.MeshBasicMaterial({ color: '#ef6672' });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = false; mesh.receiveShadow = false;
  const phases: number[] = [];
  const baseY: number[] = [];
  const temp = new THREE.Object3D();
  let seed = 94831;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const palette = ['#f14b55', '#fff8dc', '#1d3150', '#64c8f4', '#e7c264', '#a8b6c4', '#db80a1', '#69ba82'];
  for (let i = 0; i < count; i++) {
    const endStand = random() > 0.62;
    const side = random() > 0.5 ? 1 : -1;
    const x = endStand
      ? side * (FIELD.length / 2 + 3 + random() * 8)
      : (random() - 0.5) * (FIELD.length + 16);
    const z = endStand
      ? (random() - 0.5) * (FIELD.width + 16)
      : side * (FIELD.width / 2 + 3 + random() * 8);
    const row = Math.floor(random() * 2);
    const y = 1.35 + row * 0.32 + random() * 0.08;
    temp.position.set(x, y, z);
    temp.rotation.set((random() - 0.5) * 0.09, (random() - 0.5) * 0.45, 0);
    temp.scale.set(0.83 + random() * 0.38, 0.82 + random() * 0.45, 0.83 + random() * 0.38);
    temp.updateMatrix();
    mesh.setMatrixAt(i, temp.matrix);
    mesh.setColorAt(i, new THREE.Color(palette[Math.floor(random() * palette.length)]!));
    phases.push(random() * Math.PI * 2);
    baseY.push(y);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
  return { mesh, count, phases, baseY, fixtures: [] };
}

function createStands(THREE: Three, scene: T.Scene, lite: boolean) {
  const stands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), standard(THREE, '#ffffff', 0.78), 8);
  const row = new THREE.Object3D();
  const concrete = new THREE.Color('#27384b');
  const seat = new THREE.Color('#aab7c3');
  let instance = 0;
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 2; tier++) {
      row.position.set(0, 1.2 + tier * 0.75, side * (FIELD.width / 2 + 2.6 + tier * 3.4));
      row.scale.set(FIELD.length + 18, 0.38, 2.5);
      row.updateMatrix();
      stands.setMatrixAt(instance, row.matrix);
      stands.setColorAt(instance++, tier ? seat : concrete);
    }
  }
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 2; tier++) {
      row.position.set(side * (FIELD.length / 2 + 2.6 + tier * 3.4), 1.2 + tier * 0.75, 0);
      row.scale.set(2.5, 0.38, FIELD.width + 18);
      row.updateMatrix();
      stands.setMatrixAt(instance, row.matrix);
      stands.setColorAt(instance++, tier ? seat : concrete);
    }
  }
  stands.instanceMatrix.needsUpdate = true;
  if (stands.instanceColor) stands.instanceColor.needsUpdate = true;
  scene.add(stands);
  const roof = standard(THREE, '#101c29', 0.55, 0.18);
  box(THREE, scene, [FIELD.length + 34, 0.45, 1], [0, 11.5, FIELD.width / 2 + 13], roof);
  box(THREE, scene, [FIELD.length + 34, 0.45, 1], [0, 11.5, -FIELD.width / 2 - 13], roof);
  box(THREE, scene, [1, 0.45, FIELD.width + 34], [FIELD.length / 2 + 13, 11.5, 0], roof);
  box(THREE, scene, [1, 0.45, FIELD.width + 34], [-FIELD.length / 2 - 13, 11.5, 0], roof);
  const crowd = makeCrowd(THREE, scene, lite);
  const tower = standard(THREE, '#9eabb5', 0.46, 0.58);
  const fixture = new THREE.MeshStandardMaterial({ color: '#fffbed', emissive: '#c6e9ff', emissiveIntensity: 5, roughness: 0.2 });
  crowd.fixtures.push(fixture);
  for (const x of [-FIELD.length / 2 - 16, FIELD.length / 2 + 16]) for (const z of [-FIELD.width / 2 - 14, FIELD.width / 2 + 14]) {
    const base = new THREE.Vector3(x, 0, z);
    const top = new THREE.Vector3(x * 1.02, 22, z * 1.02);
    cylinderBetween(THREE, scene, base, top, 0.16, tower);
    for (let lamp = -1; lamp <= 1; lamp++) {
      box(THREE, scene, [0.5, 0.28, 0.38], [top.x + lamp * 0.52, 21.5, top.z], fixture, false, false);
    }
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#d9f3ff', transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.position.set(top.x, 21.5, top.z);
    scene.add(halo);
  }
  return crowd;
}

function buildGoal(THREE: Three, scene: T.Scene, sign: number, white: T.Material) {
  const group = new THREE.Group();
  const x = sign * (FIELD.length / 2 + 0.05);
  const back = sign * (FIELD.length / 2 + 2.4);
  const halfGoal = FIELD.goalWidth / 2;
  const frame = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 12), white, 6);
  const bar = new THREE.Object3D();
  const frameParts: [number, number, number, number, number][] = [
    [x, FIELD.goalHeight / 2, -halfGoal, FIELD.goalHeight, 0],
    [x, FIELD.goalHeight / 2, halfGoal, FIELD.goalHeight, 0],
    [back, FIELD.goalHeight / 2, -halfGoal, FIELD.goalHeight, 0],
    [back, FIELD.goalHeight / 2, halfGoal, FIELD.goalHeight, 0],
    [x, FIELD.goalHeight, 0, FIELD.goalWidth, Math.PI / 2],
    [back, FIELD.goalHeight, 0, FIELD.goalWidth, Math.PI / 2],
  ];
  for (let i = 0; i < frameParts.length; i++) {
    const [px, py, pz, length, rotation] = frameParts[i]!;
    bar.position.set(px, py, pz);
    bar.rotation.set(rotation, 0, 0);
    bar.scale.set(1, length, 1);
    bar.updateMatrix();
    frame.setMatrixAt(i, bar.matrix);
  }
  frame.instanceMatrix.needsUpdate = true;
  frame.castShadow = true;
  group.add(frame);

  const vertices: number[] = [];
  const segment = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    vertices.push(ax, ay, az, bx, by, bz);
  };
  for (let i = 0; i <= 12; i++) {
    const z = -halfGoal + i * FIELD.goalWidth / 12;
    segment(x, 0, z, back, 0, z);
  }
  for (let i = 0; i <= 8; i++) {
    const y = i * FIELD.goalHeight / 8;
    segment(x, y, -halfGoal, back, y, -halfGoal);
    segment(x, y, halfGoal, back, y, halfGoal);
  }
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const net = new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({ color: '#d2e0dc', transparent: true, opacity: 0.7, depthWrite: false }));
  group.add(net);
  group.userData.netGeometry = netGeometry;
  group.userData.netBase = new Float32Array(vertices);
  scene.add(group);
  return group;
}

export function createScene(THREE: Three, host: HTMLElement, lite: boolean, timeMode: TimeMode): SoccerView | null {
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
  renderer.toneMappingExposure = timeMode === 'golden' ? 1.1 : 1.25;
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
  const hemi = new THREE.HemisphereLight(night ? '#d0e0e8' : '#fff0d4', '#162b22', night ? 0.85 : 1.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(night ? '#f0f6ff' : '#ffc27d', night ? 3.2 : 2.7);
  key.position.set(-FIELD.length * 0.18, night ? 34 : 12, night ? FIELD.width * 0.19 : -FIELD.width * 0.35);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -FIELD.length / 2 - 14; key.shadow.camera.right = FIELD.length / 2 + 14;
  key.shadow.camera.top = FIELD.width / 2 + 12; key.shadow.camera.bottom = -FIELD.width / 2 - 12;
  key.shadow.camera.near = 1; key.shadow.camera.far = 110;
  key.shadow.bias = -0.00035; key.shadow.normalBias = 0.028;
  scene.add(key);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length + 52, FIELD.width + 48), standard(THREE, '#163b28', 0.96));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2; ground.receiveShadow = true; scene.add(ground);
  const textures = pitchTextures(THREE, lite);
  const turf = new THREE.MeshStandardMaterial({ map: textures.color, normalMap: textures.normal, roughnessMap: textures.roughness, color: '#ffffff', emissive: '#10431c', emissiveIntensity: 0.24, roughness: 0.72, metalness: 0.025 });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length, FIELD.width), turf);
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.005; pitch.receiveShadow = true; scene.add(pitch);
  const stripeGeometry = new THREE.PlaneGeometry(FIELD.length / 12, FIELD.width);
  stripeGeometry.rotateX(-Math.PI / 2);
  const stripeMeshes = [
    new THREE.InstancedMesh(stripeGeometry, new THREE.MeshBasicMaterial({ color: '#b8efb2', transparent: true, opacity: 0.1, depthWrite: false }), 6),
    new THREE.InstancedMesh(stripeGeometry, new THREE.MeshBasicMaterial({ color: '#071a0b', transparent: true, opacity: 0.08, depthWrite: false }), 6),
  ];
  const stripeTransform = new THREE.Object3D();
  for (let index = 0; index < 12; index++) {
    stripeTransform.position.set(-FIELD.length / 2 + (index + 0.5) * FIELD.length / 12, 0.012, 0);
    stripeTransform.updateMatrix();
    stripeMeshes[index % 2]!.setMatrixAt(Math.floor(index / 2), stripeTransform.matrix);
  }
  for (const stripes of stripeMeshes) {
    stripes.instanceMatrix.needsUpdate = true;
    scene.add(stripes);
  }
  const mark = markingsTexture(THREE);
  const lines = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length, FIELD.width), new THREE.MeshBasicMaterial({ map: mark, transparent: true, opacity: 0.91, depthWrite: false }));
  lines.rotation.x = -Math.PI / 2; lines.position.y = 0.018; scene.add(lines);
  const apron = box(THREE, scene, [FIELD.length + 14, 0.06, FIELD.width + 14], [0, -0.02, 0], standard(THREE, '#304638', 0.94));
  apron.receiveShadow = true;
  const boardMaterial = standard(THREE, '#071a25', 0.38, 0.2);
  box(THREE, scene, [FIELD.length + 2, 1.1, 0.42], [0, 0.6, FIELD.width / 2 + 1], boardMaterial);
  box(THREE, scene, [FIELD.length + 2, 1.1, 0.42], [0, 0.6, -FIELD.width / 2 - 1], boardMaterial);
  box(THREE, scene, [0.42, 1.1, FIELD.width + 2], [FIELD.length / 2 + 1, 0.6, 0], boardMaterial);
  box(THREE, scene, [0.42, 1.1, FIELD.width + 2], [-FIELD.length / 2 - 1, 0.6, 0], boardMaterial);
  const ads = adTexture(THREE);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length, 0.8), new THREE.MeshBasicMaterial({ map: ads.texture, toneMapped: false }));
    panel.position.set(0, 0.65, side * (FIELD.width / 2 + 0.78)); panel.rotation.y = side < 0 ? Math.PI : 0; scene.add(panel);
  }
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#f5f5eb', roughness: 0.28, metalness: 0.12 });
  const goals = [buildGoal(THREE, scene, -1, postMaterial), buildGoal(THREE, scene, 1, postMaterial)];
  const cornerFlags: T.Group[] = [];
  for (const x of [-FIELD.length / 2 + 0.15, FIELD.length / 2 - 0.15]) for (const z of [-FIELD.width / 2 + 0.15, FIELD.width / 2 - 0.15]) {
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.3, 8), postMaterial);
    pole.position.y = 0.65; flag.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.28), standard(THREE, x * z > 0 ? '#d73143' : '#f7f5e8', 0.7));
    cloth.position.set(0.22, 1.13, 0); cloth.rotation.y = Math.PI / 2; flag.add(cloth);
    flag.position.set(x, 0, z); scene.add(flag); cornerFlags.push(flag);
  }
  const crowd = createStands(THREE, scene, lite);
  for (const x of [-FIELD.length * 0.22, FIELD.length * 0.22]) {
    const dugout = standard(THREE, '#152739', 0.44, 0.2);
    box(THREE, scene, [4.2, 1.6, 1.5], [x, 1, -FIELD.width / 2 - 3], dugout);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#a9c4ce', transparent: true, opacity: 0.26, roughness: 0.08, metalness: 0.2 });
    box(THREE, scene, [4, 1.2, 0.04], [x, 1.8, -FIELD.width / 2 - 2.25], glass, false, false);
  }

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
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: '#06150e', transparent: true, opacity: 0.32, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.025; scene.add(ballShadow);
  const actors = new Map<number, Actor>();
  const materialCache = new Map<string, Map<T.Material, T.Material>>();
  const attachments: Promise<void>[] = [];
  const loadPlayer = (player: Player, actor: Actor) => {
    const url = player.id % 2 ? MODEL_URLS.male : MODEL_URLS.female;
    const pending = loadSoccerModel(url);
    attachments.push(pending.then((asset) => {
      if (disposed) return;
      const body = asset.clone(asset.scene);
      body.traverse((object) => {
        const mesh = object as T.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
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
            if (shirt || shorts) {
              const color = shirt
                ? isKeeper(player) ? teamKit[player.team]!.keeper : teamKit[player.team]!.shirt
                : isKeeper(player) ? '#162536' : teamKit[player.team]!.shorts;
              const materialColor = (cloned as T.MeshStandardMaterial).color;
              materialColor?.set(color);
            }
            variants!.set(material, cloned);
          }
          return cloned;
        });
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
      });
      actor.fallback.visible = false;
      bindSoccerRig(THREE, actor.anim, body);
    }).catch(() => {
      if (import.meta.env.DEV) console.warn(`Soccer player model unavailable: ${url}; using procedural player`);
    }));
  };
  const ensureActor = (player: Player) => {
    let actor = actors.get(player.id);
    if (actor) return actor;
    actor = createPlayer(THREE, player, lite);
    actors.set(player.id, actor);
    scene.add(actor.root);
    loadPlayer(player, actor);
    return actor;
  };

  const matrix = new THREE.Object3D();
  const animationInput = createSoccerAnimationInput();
  const frustum = new THREE.Frustum();
  const frustumMatrix = new THREE.Matrix4();
  const playerSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  let crowdTimer = 0;
  let crowdRoar = 0;
  let elapsed = 0;
  let adTimer = 0;
  let disposed = false;
  const glowMaterial = new THREE.MeshBasicMaterial({ color: '#f58a49', transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 16), glowMaterial);
  glow.position.set(15, 9, 24); scene.add(glow);
  const target = new THREE.Vector3(0, 0, 0);
  const desired = new THREE.Vector3(0, 0, 0);
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
    camera.fov = height > width ? 84 : 34;
    camera.updateProjectionMatrix();
  }

  function update(world: World, dt: number, time: number, humanTeam: Team, cameraMode: CameraMode, targetId: number | null = null, power: number | null = null) {
    elapsed += Math.min(0.05, dt);
    crowdTimer += dt; adTimer += dt;
    if (adTimer > 0.08) { ads.draw(elapsed); adTimer = 0; }
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
    const crowdSignal = world.phase === 'goal' ? 1 : world.ball.x * teamDir(humanTeam, world.endsSwapped) > 11 ? 0.2 : 0;
    crowdRoar = damp(crowdRoar, Math.max(crowdSignal, 0.05), world.phase === 'goal' ? 2 : 0.35, dt);
    if (crowdTimer > 0.1) {
      for (let i = 0; i < crowd.mesh.count; i++) {
        const jump = Math.sin(elapsed * 3 + crowd.phases[i]!) * 0.035 + Math.max(0, Math.sin(elapsed * 4 + crowd.phases[i]!)) * crowdRoar * 0.35;
        matrix.position.set(0, crowd.baseY[i]! + jump, 0);
        matrix.scale.set(1, 1, 1);
        matrix.updateMatrix();
        crowd.mesh.getMatrixAt(i, matrix.matrix);
        const x = matrix.matrix.elements[12]!;
        const z = matrix.matrix.elements[14]!;
        matrix.position.set(x, crowd.baseY[i]! + jump, z);
        matrix.updateMatrix();
        crowd.mesh.setMatrixAt(i, matrix.matrix);
      }
      crowd.mesh.instanceMatrix.needsUpdate = true;
      crowdTimer = 0;
    }
    for (let i = 0; i < cornerFlags.length; i++) cornerFlags[i]!.rotation.z = Math.sin(elapsed * 2.5 + i) * 0.045;
    for (const goal of goals) {
      const geometry = goal.userData.netGeometry as T.BufferGeometry;
      const attribute = geometry.getAttribute('position') as T.BufferAttribute;
      const positions = attribute.array as Float32Array;
      const base = goal.userData.netBase as Float32Array;
      const pulse = world.ball.inNet ? Math.max(0, Math.min(1, world.eventTime / 1.6)) : 0;
      for (let i = 0; i < positions.length; i += 3) {
        const x = base[i]!, y = base[i + 1]!, z = base[i + 2]!;
        const distance = Math.hypot(world.ball.x - x, world.ball.y - y, world.ball.z - z);
        const wave = Math.sin(elapsed * 16 - distance * 2.4) * Math.max(0, 1 - distance / 6) * pulse * 0.12;
        positions[i + 1] = y + wave * 0.35;
        positions[i + 2] = z + wave;
      }
      attribute.needsUpdate = true;
    }

    const portrait = camera.aspect < 0.72;
    const attackDir = teamDir(humanTeam, world.endsSwapped);
    const focusDx = (controlledPlayer?.x ?? world.ball.x) - world.ball.x;
    const focusDz = (controlledPlayer?.z ?? world.ball.z) - world.ball.z;
    const focusDistance = Math.hypot(focusDx, focusDz);
    const playerFocusWeight = controlledPlayer ? Math.min(0.32, 8 / Math.max(0.001, focusDistance)) : 0;
    const focusX = world.ball.x + focusDx * playerFocusWeight;
    const focusZ = world.ball.z + focusDz * playerFocusWeight;
    const trackedX = cameraMode === 'broadcast'
      ? focusX + attackDir * FIELD.goalWidth * 0.3
      : world.ball.x * 0.35;
    target.set(
      trackedX + (portrait && cameraMode === 'broadcast' ? attackDir * FIELD.goalWidth * 0.28 : attackDir * FIELD.goalWidth * 0.2),
      0.55,
      cameraMode === 'broadcast' ? focusZ * 0.55 : world.ball.z * 0.22,
    );
    if (cameraMode === 'replay') desired.set(world.ball.x - attackDir * FIELD.goalWidth * 1.1, 5.2, world.ball.z + FIELD.width * 0.2);
    else if (cameraMode === 'broadcast' && portrait) desired.set(target.x - attackDir * FIELD.width * 0.42, FIELD.width * 0.24, target.z);
    else if (cameraMode === 'broadcast') desired.set(target.x, FIELD.width * 0.25, -FIELD.width * 0.56);
    else desired.set(target.x - attackDir * FIELD.length * 0.26, FIELD.width * 0.2, target.z);
    if (cameraMode === 'broadcast') {
      target.add(cameraSafeOffset);
      desired.add(cameraSafeOffset);
    } else {
      cameraSafeOffset.set(0, 0, 0);
    }
    const zoom = cameraMode === 'replay' ? 36 : cameraMode === 'broadcast' ? portrait ? 68 : 31 : 28;
    camera.fov = damp(camera.fov, zoom, 2.4, dt);
    camera.updateProjectionMatrix();
    if (!cameraReady) {
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
    if (cameraMode !== 'replay') {
      camera.getWorldDirection(cameraDirection);
      const forwardLength = Math.hypot(cameraDirection.x, cameraDirection.z);
      if (forwardLength >= 1e-3) {
        const forward = { x: cameraDirection.x / forwardLength, z: cameraDirection.z / forwardLength };
        lastViewBasis = { forward, right: { x: -forward.z, z: forward.x } };
      }
    }
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);
    const scoringTeam = world.event.startsWith('bay city') ? 0 : 1;
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
    const shadowScale = Math.max(0.25, 1.1 - world.ball.y * 0.2);
    ballShadow.scale.set(shadowScale, shadowScale, 1);
    if (controlled) {
      projected.set(controlled.x, 2.75, controlled.z).project(camera);
      const visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
      indicator.style.display = visible ? 'grid' : 'none';
      if (visible) {
        indicator.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        indicator.style.top = `${(0.5 - projected.y * 0.5) * height}px`;
        indicator.style.setProperty('--player-color', controlled.team === 0 ? '#ff5368' : '#73defa');
        const name = controlled.slot === 'GK' ? 'A. MORGAN' : controlled.slot === 'ST' ? 'M. RIVERA' : controlled.slot === 'CM' ? 'J. KIM' : 'D. PARK';
        indicatorName.textContent = `NO. ${jerseyNumber(controlled.id)}  ${name}`;
        indicatorPower.style.width = power === null ? '0%' : `${Math.round(Math.max(0.04, power) * 100)}%`;
        indicatorPower.style.visibility = power === null ? 'hidden' : 'visible';
        indicatorPower.style.backgroundColor = (power ?? 0) > 0.85 ? '#ff755f' : '#e6f36d';
      }
    } else indicator.style.display = 'none';
    key.position.set(target.x - FIELD.length * 0.17, night ? 30 : 18, target.z + (night ? -FIELD.width * 0.28 : FIELD.width * 0.3));
    key.target.position.set(target.x, 0, target.z);
    key.target.updateMatrixWorld();
    key.shadow.camera.updateProjectionMatrix();
    void time;
  }

  function setTime(mode: TimeMode) {
    const dark = mode === 'night';
    drawSky(dark);
    scene.fog = new THREE.Fog(dark ? '#142438' : '#d99a71', 65, 130);
    hemi.intensity = dark ? 0.95 : 1.85;
    key.color.set(dark ? '#f0f6ff' : '#ffc27d');
    key.intensity = dark ? 4.0 : 3.5;
    for (const fixture of crowd.fixtures) fixture.emissiveIntensity = dark ? 4 : 0.16;
    glowMaterial.opacity = dark ? 0.02 : 0.42;
    glowMaterial.color.set(dark ? '#d4e6ff' : '#f58a49');
    glow.position.set(dark ? 0 : -FIELD.length * 0.12, dark ? 30 : 5.5, dark ? 0 : FIELD.width * 0.35);
    turf.color.set(dark ? '#ffffff' : '#fff0d0');
    turf.emissive.set(dark ? '#10431c' : '#3b200b');
    turf.emissiveIntensity = dark ? 0.24 : 0.12;
    renderer.toneMappingExposure = dark ? 1.25 : 1.1;
  }

  setTime(timeMode);

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
      crowd.mesh.count = Math.ceil(crowd.count / 2);
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
    renderer.render(scene, camera);
    if (debug && now >= quality.nextLog) {
      quality.nextLog = now + 3000;
      console.info('[soccerdebug]', {
        dpr: quality.dpr,
        frameMs: Number(quality.avgMs.toFixed(1)),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        shadows: quality.shadows,
        crowd: crowd.mesh.count,
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
        crowdMeshCount: crowd.mesh.count,
      };
    },
    update,
    render,
    precompile,
    attach(next) {
      next.appendChild(canvas);
      next.appendChild(indicator);
    },
    setTime,
    goal() { crowdRoar = 1.3; },
    dispose() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      disposeTree(scene);
      indicator.remove();
      mark.dispose();
      ballMap.dispose();
      textures.color.dispose(); textures.normal.dispose(); textures.roughness.dispose();
      ads.texture.dispose();
      envTarget?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
