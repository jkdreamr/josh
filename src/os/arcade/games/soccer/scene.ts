import type * as T from 'three';
import type { World, Player, Team } from './logic.ts';
import { FIELD, teamDir } from './logic.ts';
import { disposeTree, damp } from './gl.ts';
import { adTexture, ballNumberTexture, ballTexture, markingsTexture, pitchTextures } from './textures.ts';
import { animateSoccerSkeleton } from './player.ts';

type Three = typeof import('three');
export type CameraMode = 'broadcast' | 'end' | 'replay';
export type TimeMode = 'night' | 'golden';
type Actor = { root: T.Group; body: T.Group; legs: [T.Mesh, T.Mesh]; fallback: T.Group; marker: T.Mesh; number: T.Mesh; phase: number; loaded: boolean; skinned: T.Object3D | null };
type Crowd = { mesh: T.InstancedMesh; phases: number[]; baseY: number[] };

export type SoccerView = {
  resize(width: number, height: number): void;
  update(world: World, dt: number, time: number, humanTeam: Team, cameraMode: CameraMode, targetId?: number | null): void;
  render(): void;
  setTime(mode: TimeMode): void;
  goal(): void;
  dispose(): void;
};

const teamKit = [
  { shirt: '#d52f43', shorts: '#faf6ed', trim: '#fff3e5', keeper: '#f6c945' },
  { shirt: '#112744', shorts: '#7bc9ee', trim: '#c7efff', keeper: '#f18548' },
] as const;
const skinTones = ['#b87550', '#f0c19a', '#8e5942', '#d79b70', '#b88768'];

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
  const fallback = new THREE.Group();
  const model = new THREE.Group();
  root.add(fallback);
  const kit = teamKit[player.team]!;
  const shirt = standard(THREE, player.slot === 'GK' ? kit.keeper : kit.shirt, 0.52);
  const trim = standard(THREE, kit.trim, 0.62, 0.06);
  const shorts = standard(THREE, player.slot === 'GK' ? '#162536' : kit.shorts, 0.68);
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
  const numberTexture = ballNumberTexture(THREE, player.slot === 'GK' ? 1 : player.id % 4 + 2);
  const number = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.22), new THREE.MeshBasicMaterial({ map: numberTexture, transparent: true, side: THREE.DoubleSide }));
  number.position.set(0, 1.25, -0.255);
  number.rotation.y = Math.PI;
  fallback.add(number);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.54, 28), new THREE.MeshBasicMaterial({ color: player.team === 0 ? '#ffe782' : '#73defa', side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.035;
  root.add(marker);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.23, 3), new THREE.MeshBasicMaterial({ color: player.team === 0 ? '#ffe782' : '#73defa' }));
  arrow.position.set(0, 2.12, 0); arrow.rotation.x = Math.PI;
  root.add(arrow);
  root.add(model);
  void boots;
  void digit;
  return { root, body: fallback, legs, fallback, marker, number, phase: player.id * 0.83, loaded: false, skinned: null };
}

function makeCrowd(THREE: Three, parent: T.Object3D, lite: boolean): Crowd {
  const count = lite ? 1500 : 4000;
  const geometry = new THREE.CapsuleGeometry(0.11, 0.22, 2, 5);
  const material = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.9, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = false; mesh.receiveShadow = false;
  const phases: number[] = [];
  const baseY: number[] = [];
  const temp = new THREE.Object3D();
  let seed = 94831;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const palette = ['#d8484d', '#f1f1e7', '#18283b', '#66b9dc', '#d7b66c', '#414a55', '#8a5b80', '#5c866e'];
  for (let i = 0; i < count; i++) {
    const endStand = random() > 0.62;
    const side = random() > 0.5 ? 1 : -1;
    const x = endStand ? side * (24 + random() * 3.7) : (random() - 0.5) * 48;
    const z = endStand ? (random() - 0.5) * 29 : side * (16.4 + random() * 5.6);
    const row = side < 0 ? Math.floor(random() * 5) : Math.floor(random() * 15);
    const y = side < 0 ? 1.35 + row * 0.38 + random() * 0.1 : 2.2 + row * 0.48 + random() * 0.15;
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
  parent.add(mesh);
  return { mesh, phases, baseY };
}

function createStands(THREE: Three, scene: T.Scene, lite: boolean) {
  const concrete = standard(THREE, '#253242', 0.85);
  const seat = standard(THREE, '#455567', 0.72);
  const roof = standard(THREE, '#101c29', 0.55, 0.18);
  for (const side of [-1, 1]) {
    const near = side < 0;
    if (near) continue;
    for (let tier = 0; tier < (near ? 1 : 2); tier++) {
      const centerY = near ? 2.1 : tier ? 8.5 : 4.4;
      const height = near ? 3.2 : tier ? 7.2 : 6.5;
      const depth = near ? 3.8 : tier ? 6.3 : 5.6;
      const z = side * (near ? 16.2 : 15 + tier * 6);
      const block = box(THREE, scene, [51, height, depth], [0, centerY, z], concrete, false, true);
      block.rotation.x = -side * 0.1;
      for (let row = 0; row < (near ? 5 : 10); row++) {
        const y = near ? 1.25 + row * 0.4 : 2.3 + row * 0.54 + tier * 6.6;
        const rowDepth = near ? 15.1 + row * 0.08 : 14.9 + tier * 6 + row * 0.09;
        box(THREE, scene, [50 - row * 0.12, 0.12, 0.15], [0, y, side * rowDepth], seat, false, false);
      }
    }
    for (let tier = 0; tier < 2; tier++) {
      const x = side * (24 + tier * 4);
      box(THREE, scene, [6, 13 + tier * 2, 31], [x, 7 + tier * 4, 0], concrete);
      for (let row = 0; row < 10; row++) {
        box(THREE, scene, [0.18, 0.1, 29], [side * (21 + tier * 6 + row * 0.2), 2.4 + row * 0.56 + tier * 6.6, 0], seat, false, false);
      }
    }
  }
  box(THREE, scene, [54, 0.55, 1.3], [0, 16.2, 21.7], roof);
  box(THREE, scene, [54, 0.55, 1.3], [0, 12.2, -19.2], roof);
  box(THREE, scene, [1.3, 0.55, 35], [28, 16.2, 0], roof);
  box(THREE, scene, [1.3, 0.55, 35], [-28, 16.2, 0], roof);
  const crowd = makeCrowd(THREE, scene, lite);

  const tower = standard(THREE, '#9eabb5', 0.46, 0.58);
  const fixture = new THREE.MeshStandardMaterial({ color: '#ecf7ff', emissive: '#bde6ff', emissiveIntensity: 4, roughness: 0.25 });
  for (const x of [-27, 27]) for (const z of [-24, 24]) {
    const base = new THREE.Vector3(x, 0, z);
    const top = new THREE.Vector3(x * 1.06, 23, z * 1.05);
    cylinderBetween(THREE, scene, base, top, 0.16, tower);
    box(THREE, scene, [2.2, 0.5, 0.8], [top.x, 22.5, top.z], fixture, false, false);
  }
  return crowd;
}

function buildGoal(THREE: Three, scene: T.Scene, sign: number, white: T.Material) {
  const group = new THREE.Group();
  const x = sign * (FIELD.length / 2 + 0.05);
  const back = sign * 23.4;
  const postX = x;
  const netMat = standard(THREE, '#c9d8d5', 0.72);
  for (const z of [-2.5, 2.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, FIELD.goalHeight, 14), white);
    post.position.set(postX, FIELD.goalHeight / 2, z);
    post.castShadow = true; group.add(post);
    const rearPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, FIELD.goalHeight, 8), netMat);
    rearPost.position.set(back, FIELD.goalHeight / 2, z); group.add(rearPost);
  }
  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, FIELD.goalWidth, 14), white);
  crossbar.rotation.x = Math.PI / 2; crossbar.position.set(postX, FIELD.goalHeight, 0); crossbar.castShadow = true; group.add(crossbar);
  const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, FIELD.goalWidth, 8), netMat);
  backBar.rotation.x = Math.PI / 2; backBar.position.set(back, FIELD.goalHeight, 0); group.add(backBar);
  for (let i = 0; i <= 10; i++) {
    const z = -2.5 + i * 0.5;
    const net = cylinderBetween(THREE, group, new THREE.Vector3(postX, 0, z), new THREE.Vector3(back, 0, z), 0.012, netMat);
    net.userData.flex = i;
  }
  for (let i = 0; i <= 8; i++) {
    const y = i * FIELD.goalHeight / 8;
    cylinderBetween(THREE, group, new THREE.Vector3(postX, y, -2.5), new THREE.Vector3(back, y, -2.5), 0.01, netMat);
    cylinderBetween(THREE, group, new THREE.Vector3(postX, y, 2.5), new THREE.Vector3(back, y, 2.5), 0.01, netMat);
  }
  group.position.x = 0;
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const night = timeMode === 'night';
  scene.background = new THREE.Color(night ? '#071322' : '#f1a36e');
  scene.fog = new THREE.Fog(night ? '#142438' : '#d99a71', 65, 130);
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 180);
  const hemi = new THREE.HemisphereLight(night ? '#93b8e5' : '#fff0d4', '#162b22', night ? 1.0 : 1.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(night ? '#bbd9ff' : '#ffc27d', night ? 3.2 : 2.7);
  key.position.set(-20, night ? 34 : 14, night ? 13 : -24);
  key.castShadow = true;
  key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 25; key.shadow.camera.bottom = -25;
  key.shadow.camera.near = 1; key.shadow.camera.far = 90;
  key.shadow.bias = -0.00035; key.shadow.normalBias = 0.028;
  scene.add(key);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(82, 62), standard(THREE, '#142a24', 0.96));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2; ground.receiveShadow = true; scene.add(ground);
  const textures = pitchTextures(THREE, lite);
  const turf = new THREE.MeshStandardMaterial({ map: textures.color, normalMap: textures.normal, roughnessMap: textures.roughness, roughness: 0.88 });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length, FIELD.width), turf);
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.005; pitch.receiveShadow = true; scene.add(pitch);
  const mark = markingsTexture(THREE);
  const lines = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length, FIELD.width), new THREE.MeshBasicMaterial({ map: mark, transparent: true, opacity: 0.91, depthWrite: false }));
  lines.rotation.x = -Math.PI / 2; lines.position.y = 0.018; scene.add(lines);
  const apron = box(THREE, scene, [45, 0.06, 28], [0, -0.02, 0], standard(THREE, '#304638', 0.94));
  apron.receiveShadow = true;
  const boardMaterial = standard(THREE, '#071a25', 0.38, 0.2);
  box(THREE, scene, [44, 1.1, 0.42], [0, 0.6, 13.7], boardMaterial);
  box(THREE, scene, [44, 1.1, 0.42], [0, 0.6, -13.7], boardMaterial);
  box(THREE, scene, [0.42, 1.1, 26], [21.6, 0.6, 0], boardMaterial);
  box(THREE, scene, [0.42, 1.1, 26], [-21.6, 0.6, 0], boardMaterial);
  const ads = adTexture(THREE);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.8), new THREE.MeshBasicMaterial({ map: ads.texture, toneMapped: false }));
    panel.position.set(0, 0.65, side * 13.47); panel.rotation.y = side < 0 ? Math.PI : 0; scene.add(panel);
  }
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#f5f5eb', roughness: 0.28, metalness: 0.12 });
  const goals = [buildGoal(THREE, scene, -1, postMaterial), buildGoal(THREE, scene, 1, postMaterial)];
  const cornerFlags: T.Group[] = [];
  for (const x of [-20.9, 20.9]) for (const z of [-12.8, 12.8]) {
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.3, 8), postMaterial);
    pole.position.y = 0.65; flag.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.28), standard(THREE, x * z > 0 ? '#d73143' : '#f7f5e8', 0.7));
    cloth.position.set(0.22, 1.13, 0); cloth.rotation.y = Math.PI / 2; flag.add(cloth);
    flag.position.set(x, 0, z); scene.add(flag); cornerFlags.push(flag);
  }
  const crowd = createStands(THREE, scene, lite);
  for (const x of [-10, 10]) {
    const dugout = standard(THREE, '#152739', 0.44, 0.2);
    box(THREE, scene, [4.2, 1.6, 1.5], [x, 1, 18], dugout);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#a9c4ce', transparent: true, opacity: 0.26, roughness: 0.08, metalness: 0.2 });
    box(THREE, scene, [4, 1.2, 0.04], [x, 1.8, 17.25], glass, false, false);
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
  const ballMaterial = new THREE.MeshStandardMaterial({ map: ballMap, roughness: 0.3, metalness: 0.02 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, lite ? 16 : 28, lite ? 12 : 20), ballMaterial);
  ball.castShadow = true; scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: '#06150e', transparent: true, opacity: 0.32, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.025; scene.add(ballShadow);
  const actors: Actor[] = [];
  const worldPlayers = Array.from({ length: 10 }, (_, id) => ({ id, team: (id < 5 ? 0 : 1) as Team, slot: (['GK', 'DEF', 'LM', 'RM', 'FWD'][id % 5]) as Player['slot'], x: 0, z: 0, vx: 0, vz: 0, facing: 0, stamina: 1, human: false, controlled: false, cooldown: 0, action: 'idle' }));
  for (const p of worldPlayers) {
    const actor = createPlayer(THREE, p, lite);
    actors.push(actor);
    scene.add(actor.root);
  }
  const loadedAssets = new Map<string, Promise<{ scene: T.Object3D; clone: (source: T.Object3D) => T.Object3D }>>();
  const loadPlayer = (player: Player, actor: Actor) => {
    const url = `/models/soccer/${player.id % 2 ? 'male' : 'female'}.glb`;
    let pending = loadedAssets.get(url);
    if (!pending) {
      pending = Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/utils/SkeletonUtils.js'),
      ]).then(async ([loader, skeleton]) => {
        const gltf = await new loader.GLTFLoader().loadAsync(url);
        return { scene: gltf.scene, clone: skeleton.clone };
      });
      loadedAssets.set(url, pending);
    }
    void pending.then((asset) => {
      if (disposed) return;
      const body = asset.clone(asset.scene);
      body.traverse((object) => {
        const mesh = object as T.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = !lite;
        mesh.frustumCulled = false;
        const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const materials = source.map((material) => {
          const cloned = material.clone() as T.MeshStandardMaterial;
          if (material.name === 'shirt') cloned.color.set(player.slot === 'GK' ? teamKit[player.team]!.keeper : teamKit[player.team]!.shirt);
          if (material.name === 'shorts') cloned.color.set(teamKit[player.team]!.shorts);
          return cloned;
        });
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
      });
      actor.fallback.visible = false;
      actor.root.add(body);
      actor.skinned = body;
      actor.loaded = true;
    }).catch(() => {
      if (import.meta.env.DEV) console.warn(`Soccer player model unavailable: ${url}; using procedural player`);
    });
  };
  actors.forEach((actor, index) => loadPlayer(worldPlayers[index]!, actor));

  const matrix = new THREE.Object3D();
  let crowdTimer = 0;
  let crowdRoar = 0;
  let elapsed = 0;
  let adTimer = 0;
  let disposed = false;
  const glowMaterial = new THREE.MeshBasicMaterial({ color: '#e6f4ff', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 6), glowMaterial);
  glow.position.set(0, 26, 0); scene.add(glow);
  let target = new THREE.Vector3(0, 0, 0);
  let cameraReady = false;
  let width = 1, height = 1;
  const onLost = (event: Event) => event.preventDefault();
  canvas.addEventListener('webglcontextlost', onLost);

  function resize(w: number, h: number) {
    width = Math.max(1, w); height = Math.max(1, h);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = height > width ? 41 : 31;
    camera.updateProjectionMatrix();
  }

  function update(world: World, dt: number, time: number, humanTeam: Team, cameraMode: CameraMode, targetId: number | null = null) {
    elapsed += Math.min(0.05, dt);
    crowdTimer += dt; adTimer += dt;
    if (adTimer > 0.08) { ads.draw(elapsed); adTimer = 0; }
    const currentCarrier = world.players.find((p) => Math.hypot(world.ball.x - p.x, world.ball.z - p.z) < 0.8);
    for (const player of world.players) {
      const actor = actors[player.id]!;
      actor.root.position.set(player.x, 0, player.z);
      const speed = Math.hypot(player.vx, player.vz);
      const face = speed > 0.1 ? Math.atan2(player.vx, player.vz) : teamDir(player.team, world.endsSwapped) * Math.PI / 2;
      actor.root.rotation.y = damp(actor.root.rotation.y, face, 12, dt);
      actor.phase += dt * (5 + speed * 0.9);
      const run = Math.min(1, speed / 6);
      actor.legs[0].rotation.x = Math.sin(actor.phase) * run * 0.65;
      actor.legs[1].rotation.x = Math.sin(actor.phase + Math.PI) * run * 0.65;
      actor.body.rotation.z = player.action === 'slide' ? Math.PI / 2 : Math.sin(actor.phase * 0.5) * run * 0.035;
      actor.body.rotation.x = -run * 0.07;
      actor.marker.visible = player.controlled || player.id === targetId;
      (actor.marker.material as T.MeshBasicMaterial).color.set(player.id === targetId && !player.controlled ? '#fff28a' : player.team === 0 ? '#ffe782' : '#73defa');
      if (player.controlled || player.id === targetId) (actor.marker.material as T.MeshBasicMaterial).opacity = 0.72 + Math.sin(elapsed * 5) * 0.18;
      const arrow = actor.root.children.find((child) => child instanceof THREE.Mesh && child !== actor.marker && child.position.y > 2);
      if (arrow) arrow.visible = player.controlled;
      actor.root.scale.y = currentCarrier?.id === player.id && player.action === 'kick' ? 1.05 + Math.sin(elapsed * 24) * 0.03 : 1;
      if (actor.skinned) animateSoccerSkeleton(actor.skinned, actor.phase, speed, player.action);
    }
    ball.position.set(world.ball.x, world.ball.y, world.ball.z);
    ball.rotation.z += world.ball.vx * dt / 0.11;
    ball.rotation.x += world.ball.vz * dt / 0.11;
    ballShadow.position.set(world.ball.x, 0.028, world.ball.z);
    const shadowScale = Math.max(0.25, 1.1 - world.ball.y * 0.2);
    ballShadow.scale.set(shadowScale, shadowScale, 1);
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
    if (world.ball.inNet) for (const goal of goals) goal.rotation.z = Math.sin(elapsed * 8) * 0.035;
    else goals.forEach((goal) => { goal.rotation.z *= Math.exp(-dt * 4); });

    target.set(world.ball.x * (cameraMode === 'broadcast' ? 0.52 : 0.35), 0.55, world.ball.z * 0.3);
    const attackDir = teamDir(humanTeam, world.endsSwapped);
    const desired = cameraMode === 'replay'
      ? new THREE.Vector3(world.ball.x - attackDir * 8, 5.2, world.ball.z + 13)
      : cameraMode === 'broadcast'
        ? new THREE.Vector3(target.x, 18.5 + Math.abs(world.ball.z) * 0.12, target.z - 29)
        : new THREE.Vector3(target.x - attackDir * 23, 14.5, target.z);
    if (!cameraReady) {
      camera.position.copy(desired);
      camera.lookAt(target);
      cameraReady = true;
    } else {
      camera.position.x = damp(camera.position.x, desired.x, 2.8, dt);
      camera.position.y = damp(camera.position.y, desired.y, 2.8, dt);
      camera.position.z = damp(camera.position.z, desired.z, 2.8, dt);
      const lookAt = new THREE.Vector3(target.x, target.y, target.z);
      camera.lookAt(lookAt);
    }
    void time;
  }

  function setTime(mode: TimeMode) {
    const dark = mode === 'night';
    scene.background = new THREE.Color(dark ? '#071322' : '#f1a36e');
    scene.fog = new THREE.Fog(dark ? '#142438' : '#d99a71', 65, 130);
    hemi.intensity = dark ? 1 : 1.75;
    key.color.set(dark ? '#bbd9ff' : '#ffd1a0');
    key.intensity = dark ? 3.2 : 3.6;
    renderer.toneMappingExposure = dark ? 1.25 : 1.1;
  }

  return {
    resize,
    update,
    render() { renderer.render(scene, camera); },
    setTime,
    goal() { crowdRoar = 1.3; },
    dispose() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      disposeTree(scene);
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
