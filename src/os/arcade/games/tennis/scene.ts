import type * as T from 'three';
import type { World } from './logic.ts';
import { BALL_RADIUS, COURT_LENGTH, DOUBLES_WIDTH, SERVICE_LINE, SINGLES_WIDTH, STEP, clamp, courtWidth, netHeight, pointLabel, predictLanding, serverOf } from './logic.ts';
import { createGL, damp, disposeTree } from './gl.ts';
import { makePlayer, updatePlayer, type PoseName } from './player.ts';
import { ballTexture, courtTextures, netTexture, windscreenTexture } from './textures.ts';

type Three = typeof import('three');
type Puff = { mesh: T.Mesh; age: number; life: number };

export type View = {
  canvas: HTMLCanvasElement;
  resize: (width: number, height: number) => void;
  update: (world: World, dt: number, humanSeats: ReadonlySet<number>, side: number) => void;
  render: () => void;
  hit: (speed: number, perfect?: boolean) => void;
  replayCamera: (active: boolean) => void;
  bounce: (x: number, z: number, line: boolean) => void;
  netHit: () => void;
  point: (winner: number, longRally?: boolean) => void;
  crowdOoh: (shots: number) => void;
  debugPose: (seat: number, name: PoseName, progress?: number) => void;
  debugCamera: (name: 'front' | 'side' | 'back' | 'game', seat?: number) => void;
  debugForceHighQuality?: () => void;
  debugCrowdExcitement?: () => void;
  dispose: () => void;
};

const lineColor = '#eee9d5';
const standard = (THREE: Three, color: string, roughness = 0.74, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function addBox(THREE: Three, parent: T.Object3D, size: [number, number, number], position: [number, number, number], material: T.Material, cast = false, receive = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function mergeStaticMeshes(THREE: Three, root: T.Scene) {
  type Batch = { material: T.Material; cast: boolean; receive: boolean; order: number; meshes: T.Mesh[] };
  const batches = new Map<string, Batch>();
  const materialKeys = new Map<string, string>();
  const materialKey = (material: T.Material) => {
    const cached = materialKeys.get(material.uuid);
    if (cached) return cached;
    const properties = material.toJSON() as unknown as { uuid?: string; name?: string; metadata?: unknown; userData?: unknown; [key: string]: unknown };
    delete properties.uuid;
    delete properties.name;
    delete properties.metadata;
    delete properties.userData;
    const key = JSON.stringify(properties);
    materialKeys.set(material.uuid, key);
    return key;
  };
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh || (mesh as T.InstancedMesh).isInstancedMesh || mesh.userData.keepSeparate
      || Array.isArray(mesh.material) || mesh.material.transparent || !mesh.geometry.getAttribute('position')) return;
    const key = `${materialKey(mesh.material)}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.renderOrder}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder, meshes: [] };
      batches.set(key, batch);
    }
    batch.meshes.push(mesh);
  });

  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) continue;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const mesh of batch.meshes) {
      const geometry = mesh.geometry as T.BufferGeometry;
      const position = geometry.getAttribute('position');
      const normalAttribute = geometry.getAttribute('normal');
      const uvAttribute = geometry.getAttribute('uv');
      const offset = positions.length / 3;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        positions.push(point.x, point.y, point.z);
        if (normalAttribute) {
          normal.fromBufferAttribute(normalAttribute, i).applyMatrix3(normalMatrix).normalize();
          normals.push(normal.x, normal.y, normal.z);
        } else normals.push(0, 1, 0);
        if (uvAttribute) uvs.push(uvAttribute.getX(i), uvAttribute.getY(i));
        else uvs.push(0, 0);
      }
      if (geometry.index) {
        for (let i = 0; i < geometry.index.count; i++) indices.push(offset + geometry.index.getX(i));
      } else {
        for (let i = 0; i < position.count; i++) indices.push(offset + i);
      }
      mesh.removeFromParent();
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, batch.material);
    merged.castShadow = batch.cast;
    merged.receiveShadow = batch.receive;
    merged.renderOrder = batch.order;
    root.add(merged);
  }
}

function addCourtLine(THREE: Three, parent: T.Object3D, x: number, z: number, width: number, length: number, height = 0.019) {
  return addBox(THREE, parent, [width, 0.012, length], [x, height, z], standard(THREE, lineColor, 0.4), false, true);
}

function buildCourt(THREE: Three, scene: T.Scene, lite: boolean, anisotropy: number) {
  const maps = courtTextures(THREE, lite, anisotropy);
  const surround = new THREE.MeshStandardMaterial({
    map: maps.surroundColor,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    roughness: 0.9,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 170), surround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  const court = new THREE.Group();
  const surf = new THREE.MeshStandardMaterial({
    map: maps.color,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    roughness: 0.78,
    metalness: 0.01,
  });
  const blue = new THREE.Mesh(new THREE.BoxGeometry(DOUBLES_WIDTH + 1.05, 0.12, COURT_LENGTH + 1.1), new THREE.MeshStandardMaterial({
    map: maps.color,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    roughness: 0.82,
  }));
  blue.position.y = -0.01;
  blue.receiveShadow = true;
  court.add(blue);
  const playSurface = new THREE.Mesh(new THREE.PlaneGeometry(DOUBLES_WIDTH, COURT_LENGTH), surf);
  playSurface.rotation.x = -Math.PI / 2;
  playSurface.position.y = 0.055;
  playSurface.receiveShadow = true;
  court.add(playSurface);

  const doublesHalf = DOUBLES_WIDTH / 2;
  const singlesHalf = SINGLES_WIDTH / 2;
  addCourtLine(THREE, court, 0, COURT_LENGTH / 2, DOUBLES_WIDTH, 0.1, 0.068);
  addCourtLine(THREE, court, 0, -COURT_LENGTH / 2, DOUBLES_WIDTH, 0.1, 0.068);
  addCourtLine(THREE, court, -doublesHalf, 0, 0.05, COURT_LENGTH, 0.068);
  addCourtLine(THREE, court, doublesHalf, 0, 0.05, COURT_LENGTH, 0.068);
  addCourtLine(THREE, court, -singlesHalf, 0, 0.05, COURT_LENGTH, 0.069);
  addCourtLine(THREE, court, singlesHalf, 0, 0.05, COURT_LENGTH, 0.069);
  for (const side of [-1, 1]) {
    addCourtLine(THREE, court, 0, side * (COURT_LENGTH / 2 - SERVICE_LINE), SINGLES_WIDTH, 0.05, 0.069);
  }
  addCourtLine(THREE, court, 0, 0, 0.05, COURT_LENGTH - SERVICE_LINE * 2, 0.069);
  for (const side of [-1, 1]) addCourtLine(THREE, court, 0, side * (COURT_LENGTH / 2 - 0.32), 0.13, 0.04, 0.069);

  for (const side of [-1, 1]) {
    addBox(THREE, court, [3.4, 0.12, COURT_LENGTH + 2.2], [side * (doublesHalf + 2.2), -0.02, 0], surround, false, true);
    addBox(THREE, court, [DOUBLES_WIDTH + 4.4, 0.12, 3], [0, -0.02, side * (COURT_LENGTH / 2 + 2.4)], surround, false, true);
  }
  const scuffTexture = courtScuffTexture(THREE);
  const scuffs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.9, 0.075),
    new THREE.MeshBasicMaterial({ map: scuffTexture, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    8,
  );
  const scuff = new THREE.Object3D();
  for (let index = 0; index < 8; index++) {
    scuff.position.set((index % 4 - 1.5) * 1.3, 0.061, (index < 4 ? -1 : 1) * 10.5);
    scuff.rotation.set(-Math.PI / 2, (index % 4 - 1.5) * 0.12, 0);
    scuff.scale.set(0.75 + index % 3 * 0.18, 0.85 + index % 2 * 0.12, 1);
    scuff.updateMatrix();
    scuffs.setMatrixAt(index, scuff.matrix);
  }
  scene.add(scuffs);
  scene.add(court);
  return { court, playSurface, singlesHalf, doublesHalf };
}

function radialShadowTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(10,16,18,0.42)');
  gradient.addColorStop(0.45, 'rgba(10,16,18,0.2)');
  gradient.addColorStop(1, 'rgba(10,16,18,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  return texture;
}

function courtScuffTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext('2d')!;
  const length = context.createLinearGradient(0, 0, canvas.width, 0);
  length.addColorStop(0, 'rgba(62,67,66,0)');
  length.addColorStop(0.18, 'rgba(62,67,66,0.5)');
  length.addColorStop(0.76, 'rgba(62,67,66,0.5)');
  length.addColorStop(1, 'rgba(62,67,66,0)');
  context.fillStyle = length;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  const width = context.createLinearGradient(0, 0, 0, canvas.height);
  width.addColorStop(0, 'rgba(0,0,0,0)');
  width.addColorStop(0.32, 'rgba(0,0,0,0.62)');
  width.addColorStop(0.68, 'rgba(0,0,0,0.62)');
  width.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = width;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  return texture;
}

function glareTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,248,210,0.9)');
  gradient.addColorStop(0.12, 'rgba(255,210,140,0.62)');
  gradient.addColorStop(0.45, 'rgba(255,175,100,0.16)');
  gradient.addColorStop(1, 'rgba(255,160,80,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildSky(THREE: Three, scene: T.Scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vPos;
        void main(){
          float h=normalize(vPos).y;
          vec3 horizon=vec3(0.93,0.70,0.45);
          vec3 zenith=vec3(0.22,0.39,0.55);
          float t=smoothstep(-0.12,0.72,h);
          vec3 c=mix(horizon,zenith,t);
          float sun=exp(-pow(length(normalize(vPos)-normalize(vec3(-0.58,0.34,0.74)))*23.0,2.0));
          float glow=exp(-pow(length(normalize(vPos)-normalize(vec3(-0.58,0.34,0.74)))*4.8,2.0));
          c+=vec3(1.0,0.53,0.21)*glow*0.52+vec3(1.0,0.84,0.55)*sun*1.25;
          float haze=smoothstep(-0.2,0.06,h)*(1.0-smoothstep(0.04,0.28,h));
          c=mix(c,vec3(0.92,0.68,0.47),haze*0.3);
          gl_FragColor=vec4(c,1.0);
        }`,
    }),
  );
  scene.add(sky);
  const haze = new THREE.Mesh(new THREE.SphereGeometry(105, 24, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.12), new THREE.MeshBasicMaterial({ color: '#d9b68f', transparent: true, opacity: 0.1, side: THREE.BackSide, depthWrite: false }));
  haze.scale.set(1, 0.65, 1);
  scene.add(haze);
  const environmentScene = new THREE.Scene();
  environmentScene.add(new THREE.Mesh(sky.geometry, sky.material.clone()));
  const environmentSun = new THREE.HemisphereLight('#fff2d7', '#546456', 1.1);
  environmentScene.add(environmentSun);
  return { sky, haze, environmentScene };
}

function buildStadium(THREE: Three, scene: T.Scene, lite: boolean) {
  const bowl = standard(THREE, '#453b3b', 0.9);
  const upper = standard(THREE, '#574546', 0.92);
  for (let row = 0; row < 10; row++) {
    const h = 0.34 + row * 0.48;
    const depth = 0.9;
    for (const side of [-1, 1]) {
      addBox(THREE, scene, [depth, 0.42, 35 + row * 0.35], [side * (7.7 + row * 0.93), h, 0], row < 4 ? bowl : upper);
    }
  }
  const seatMaterial = standard(THREE, '#96243b', 0.53, 0.08);
  const seatBackMaterial = standard(THREE, '#a52a42', 0.5, 0.08);
  const rows: Array<[number, number, number, number]> = [];
  for (let side of [-1, 1]) {
    for (let row = 0; row < 8; row++) {
      const x = side * (8.1 + row * 0.82);
      for (let i = 0; i < 42; i++) rows.push([x, 0.72 + row * 0.48, -16.8 + i * 0.82, side]);
    }
  }
  const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.11, 0.34), seatMaterial, rows.length);
  const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.3, 0.055), seatBackMaterial, rows.length);
  const seatDummy = new THREE.Object3D();
  rows.forEach(([x, y, z, side], index) => {
    seatDummy.position.set(x, y, z);
    seatDummy.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    seatDummy.updateMatrix();
    seats.setMatrixAt(index, seatDummy.matrix);
    seatDummy.position.set(x, y + 0.17, z - Math.sign(z) * 0.12);
    seatDummy.updateMatrix();
    backs.setMatrixAt(index, seatDummy.matrix);
  });
  seats.castShadow = false;
  seats.receiveShadow = false;
  backs.castShadow = false;
  backs.receiveShadow = false;
  scene.add(seats, backs);

  const count = rows.length;
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.07, 0.19, 2, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 }), count);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.067, 8, 6), standard(THREE, '#c69a78', 0.88), count);
  const arms = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.025, 0.13, 1, 4), standard(THREE, '#ffffff', 0.91), count * 2);
  const hats = new THREE.InstancedMesh(new THREE.SphereGeometry(0.073, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), standard(THREE, '#ffffff', 0.72), count);
  const crowd: { x: number; y: number; z: number; phase: number; hue: number }[] = [];
  const palette = ['#ece4d4', '#bd293e', '#314c68', '#caa35d', '#406453', '#e4ddd1', '#7e5969', '#b7b8ad'];
  const skinTones = ['#d4a27f', '#b67b5b', '#edc6a3', '#81583f', '#c48d69'];
  const dummy = new THREE.Object3D();
  rows.forEach(([x, seatY, z], i) => {
    const y = seatY + 0.32;
    const hue = Math.random();
    const phase = Math.random() * Math.PI * 2;
    crowd.push({ x, y, z, phase, hue });
    const shirtColor = palette[Math.floor(Math.random() * palette.length)]!;
    bodies.setColorAt(i, new THREE.Color(shirtColor));
    heads.setColorAt(i, new THREE.Color(skinTones[Math.floor(Math.random() * skinTones.length)]));
    arms.setColorAt(i * 2, new THREE.Color(shirtColor));
    arms.setColorAt(i * 2 + 1, new THREE.Color(shirtColor));
    dummy.position.set(x, y + 0.32, z);
    dummy.scale.setScalar(hue > 0.82 ? 1 : 0.001);
    dummy.updateMatrix();
    hats.setMatrixAt(i, dummy.matrix);
    hats.setColorAt(i, new THREE.Color(palette[Math.floor(Math.random() * palette.length)]));
    dummy.scale.setScalar(1);
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 0.23, z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    for (const side of [-1, 1]) {
      dummy.position.set(x + side * 0.105, y - 0.055, z);
      dummy.rotation.z = side * 0.35;
      dummy.updateMatrix();
      arms.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), dummy.matrix);
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
  });
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  arms.instanceMatrix.needsUpdate = true;
  hats.instanceMatrix.needsUpdate = true;
  bodies.castShadow = false;
  heads.castShadow = false;
  arms.castShadow = false;
  hats.castShadow = false;
  bodies.receiveShadow = false;
  heads.receiveShadow = false;
  arms.receiveShadow = false;
  hats.receiveShadow = false;
  scene.add(bodies, heads, arms, hats);
  const crowdJump = { value: 0 };

  const screenTexture = windscreenTexture(THREE);
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTexture, roughness: 0.85 });
  for (const side of [-1, 1]) {
    const front = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.45), screenMat);
    front.position.set(0, 0.82, side * 13.9 + 0.004);
    scene.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.45), screenMat);
    back.position.set(0, 0.82, side * 13.9 - 0.004);
    back.rotation.y = Math.PI;
    scene.add(back);
    const rail = standard(THREE, '#e8e2d3', 0.55, 0.3);
    addBox(THREE, scene, [14, 0.06, 0.08], [0, 1.57, side * 13.9], rail);
  }
  const pressBox = addBox(THREE, scene, [5.5, 2.2, 0.24], [0, 5.4, -17.2], standard(THREE, '#172c27', 0.44, 0.08));
  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = 768;
  scoreCanvas.height = 320;
  const scoreCtx = scoreCanvas.getContext('2d')!;
  scoreCtx.fillStyle = '#152a25';
  scoreCtx.fillRect(0, 0, scoreCanvas.width, scoreCanvas.height);
  scoreCtx.fillStyle = '#f1eee2';
  scoreCtx.font = 'bold 42px Georgia';
  scoreCtx.fillText('TAUBE STADIUM', 24, 60);
  const scoreTexture = new THREE.CanvasTexture(scoreCanvas);
  scoreTexture.colorSpace = THREE.SRGBColorSpace;
  scoreTexture.anisotropy = 8;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2), new THREE.MeshBasicMaterial({ map: scoreTexture }));
  board.position.set(0, 5.4, -17.05);
  scene.add(board);
  const boardBack = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2), new THREE.MeshBasicMaterial({ map: scoreTexture }));
  boardBack.position.set(0, 5.4, -17.055);
  boardBack.rotation.y = Math.PI;
  scene.add(boardBack);
  const boardLights = standard(THREE, '#b7b8ad', 0.45, 0.35);
  for (const x of [-2.7, 2.7]) addBox(THREE, scene, [0.12, 2.4, 0.12], [x, 5.2, -17.15], boardLights);

  const treeMaterials = [standard(THREE, '#567348', 1), standard(THREE, '#6f8354', 1), standard(THREE, '#9a7b56', 0.95)];
  const treeTrunk = standard(THREE, '#564437', 0.98);
  for (let i = 0; i < (lite ? 8 : 20); i++) {
    const x = (i % 2 ? 1 : -1) * (16 + Math.random() * 16);
    const z = -30 + Math.floor(i / 2) * 7 + Math.random() * 4;
    const height = 2.5 + Math.random() * 3;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, height, 7), treeTrunk);
    trunk.position.set(x, height / 2, z);
    scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 + Math.random(), 1), treeMaterials[i % treeMaterials.length]);
    crown.scale.set(1.2, 0.95, 1.1);
    crown.position.set(x, height + 0.75, z);
    crown.castShadow = false;
    scene.add(crown);
  }
  const palmBark = standard(THREE, '#786044', 0.96);
  const frondMaterial = standard(THREE, '#527044', 0.9);
  const leaflets = new THREE.InstancedMesh(new THREE.ConeGeometry(0.075, 0.72, 5), frondMaterial, 216);
  const leafletDummy = new THREE.Object3D();
  let leafletIndex = 0;
  leaflets.castShadow = false;
  leaflets.receiveShadow = false;
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (18 + (i % 3) * 3);
    const z = -27 - Math.floor(i / 2) * 10;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 7.2, 12), palmBark);
    trunk.position.set(x, 3.6, z);
    trunk.rotation.z = side * 0.035;
    trunk.castShadow = false;
    scene.add(trunk);
    for (let frond = 0; frond < 9; frond++) {
      const angle = frond / 9 * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, 7.1, z),
        new THREE.Vector3(x + dx * 0.8, 7.75, z + dz * 0.8),
        new THREE.Vector3(x + dx * 2.5, 7.15, z + dz * 2.5),
      ]);
      const leaf = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.045, 3, false), frondMaterial);
      leaf.castShadow = false;
      scene.add(leaf);
      for (const t of [0.35, 0.53, 0.71, 0.88]) {
        const point = curve.getPoint(t);
        leafletDummy.position.copy(point).add(new THREE.Vector3(-dz * 0.28, -0.12, dx * 0.28));
        leafletDummy.rotation.set(-0.3, 0, Math.PI / 2 - angle);
        leafletDummy.updateMatrix();
        leaflets.setMatrixAt(leafletIndex++, leafletDummy.matrix);
      }
    }
  }
  leaflets.count = leafletIndex;
  leaflets.instanceMatrix.needsUpdate = true;
  scene.add(leaflets);
  const towerMetal = standard(THREE, '#505a54', 0.48, 0.6);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: '#fff1cf' });
  for (const x of [-15, 15]) {
    for (const z of [-24, 24]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.18, 9.2, 10), towerMetal);
      pole.position.set(x, 4.6, z);
      pole.castShadow = false;
      scene.add(pole);
      addBox(THREE, scene, [1.8, 0.14, 0.18], [x, 9.15, z], towerMetal);
      for (let lamp = 0; lamp < 4; lamp++) {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.08), lampMaterial);
        fixture.position.set(x - 0.64 + lamp * 0.42, 9.05, z - 0.04);
        scene.add(fixture);
      }
    }
  }
  for (let layer = 0; layer < 3; layer++) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= 8; row++) {
      const z = -48 - layer * 12 - row * 2.5;
      for (let column = 0; column <= 48; column++) {
        const x = -96 + column * 4;
        const ridge = 10 + Math.sin(x * 0.045 + layer * 1.7) * 3.5 + Math.sin(x * 0.13 + layer) * 1.2;
        positions.push(x, ridge - row * 0.08, z);
        if (row < 8 && column < 48) {
          const a = row * 49 + column;
          indices.push(a, a + 49, a + 1, a + 1, a + 49, a + 50);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const ridge = new THREE.Mesh(geometry, standard(THREE, ['#52654d', '#657353', '#798066'][layer], 1));
    ridge.material.side = THREE.DoubleSide;
    scene.add(ridge);
  }

  return {
    bodies,
    heads,
    arms,
    hats,
    crowd,
    crowdJump,
    dummy,
    scoreCanvas,
    scoreCtx,
    scoreTexture,
    screenTexture,
    pressBox,
  };
}

function buildNet(THREE: Three, scene: T.Scene) {
  const group = new THREE.Group();
  const width = DOUBLES_WIDTH + 1.828;
  const cols = 94;
  const rows = 17;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const yRatio = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = (u - 0.5) * width;
      const top = netHeight(x);
      positions.push(x, Math.max(0.04, top * (1 - yRatio)), 0);
      uvs.push(u * 9, yRatio * 2.4);
      if (i < cols && j < rows) {
        const a = j * (cols + 1) + i;
        const b = a + cols + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: netTexture(THREE), color: '#d8ddd3', transparent: true, alphaTest: 0.27, side: THREE.DoubleSide, roughness: 0.84 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.keepSeparate = true;
  group.add(mesh);
  const tapeCurve = new THREE.CatmullRomCurve3(Array.from({ length: 15 }, (_, i) => {
    const x = -width / 2 + width * i / 14;
    return new THREE.Vector3(x, netHeight(x) + 0.005, 0);
  }));
  const tape = new THREE.Mesh(new THREE.TubeGeometry(tapeCurve, 40, 0.046, 5, false), standard(THREE, '#eee9dc', 0.62));
  tape.castShadow = true;
  group.add(tape);
  const cord = new THREE.Mesh(new THREE.TubeGeometry(tapeCurve, 40, 0.012, 4, false), standard(THREE, '#f9f5e8', 0.48, 0.1));
  cord.position.y -= 0.07;
  group.add(cord);
  addBox(THREE, group, [0.075, 0.9, 0.048], [0, 0.47, 0.02], standard(THREE, '#ece8da', 0.85));
  const postMaterial = standard(THREE, '#48564e', 0.5, 0.45);
  for (const x of [-width / 2, width / 2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.14, 1.08, 12), postMaterial);
    post.position.set(x, 0.54, 0);
    post.castShadow = true;
    group.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), standard(THREE, '#d3d0c3', 0.36, 0.4));
    cap.position.set(x, 1.1, 0);
    group.add(cap);
    const crank = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), postMaterial);
    crank.position.set(x * 0.96, 0.28, 0.13);
    crank.rotation.x = Math.PI / 2;
    group.add(crank);
  }
  const sticks: T.Mesh[] = [];
  const stickMaterial = standard(THREE, '#e8e5d9', 0.52);
  for (const x of [-SINGLES_WIDTH / 2, SINGLES_WIDTH / 2]) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.07, 8), stickMaterial);
    stick.position.set(x, 0.535, 0);
    stick.castShadow = true;
    stick.userData.keepSeparate = true;
    group.add(stick);
    sticks.push(stick);
  }
  scene.add(group);
  return { group, geometry, positions, sticks, width, mesh };
}

function buildOfficial(THREE: Three, scene: T.Scene, x: number, z: number, color: string, scale = 1) {
  const group = new THREE.Group();
  const wood = standard(THREE, '#75583f', 0.83);
  const metal = standard(THREE, '#393d3b', 0.48, 0.55);
  addBox(THREE, group, [0.56, 0.1, 0.56], [0, 0.62, 0], wood, true);
  addBox(THREE, group, [0.52, 0.68, 0.52], [0, 1, 0], wood, true);
  for (const side of [-1, 1]) {
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), metal);
    support.position.set(side * 0.28, 0.52, 0);
    support.castShadow = true;
    group.add(support);
  }
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), standard(THREE, color, 0.75));
  body.position.y = 1.65;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), standard(THREE, '#c99472', 0.83));
  head.position.y = 1.98;
  group.add(head);
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  scene.add(group);
  return group;
}

function formatScore(world: World) {
  const points = world.match.tiebreak ? world.match.tbPoints.map((n) => String(n)) : world.match.points.map((n) => pointLabel(n));
  const sets = world.match.length === 'set' ? `SETS ${world.match.sets[0]} - ${world.match.sets[1]}   ` : '';
  const game = `${world.match.games[0]} - ${world.match.games[1]}`;
  const point = world.match.tiebreak ? `TB ${points[0]} - ${points[1]}` : world.match.points[0] >= 3 && world.match.points[1] >= 3 && world.match.points[0] === world.match.points[1]
    ? 'DEUCE'
    : `${points[0]} - ${points[1]}`;
  return [`${sets}${game}   ${point}`, `SERVER  ${serverOf(world)?.name ?? 'PLAYER'}`, `TAUBE STADIUM   ${world.format.toUpperCase()}`];
}

export function createScene(THREE: Three, host: HTMLElement, lite: boolean): View | null {
  const gl = createGL(THREE, host, lite);
  if (!gl) return null;
  const glContext = gl;
  const renderer = glContext.renderer;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c9aa87', 42, 98);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 190);

  const sky = buildSky(THREE, scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTarget = pmrem.fromScene(sky.environmentScene);
  scene.environment = envTarget.texture;
  renderer.toneMappingExposure = 1.08;
  const hemi = new THREE.HemisphereLight('#ffe7c6', '#53695f', lite ? 1.3 : 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd2a0', 2.7);
  sun.position.set(-25, 12, 27);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 512 : 1024, lite ? 512 : 1024);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.00034;
  sun.shadow.normalBias = 0.026;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight('#ffad70', 1.25);
  rim.position.set(12, 8, -22);
  scene.add(rim);
  const sunDirection = new THREE.Vector3(-0.58, 0.34, 0.74).normalize();
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(2.1, 18, 12), new THREE.MeshBasicMaterial({ color: '#fff1c7', toneMapped: false }));
  sunDisc.position.copy(sunDirection).multiplyScalar(108);
  scene.add(sunDisc);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTexture(THREE), color: '#ffe0ac', transparent: true, opacity: 0.52, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  flare.position.copy(sunDisc.position);
  flare.scale.set(16, 16, 1);
  scene.add(flare);
  const fill = new THREE.DirectionalLight('#d7e9f2', 0.66);
  fill.position.set(15, 11, -19);
  scene.add(fill);

  buildCourt(THREE, scene, lite, renderer.capabilities.getMaxAnisotropy());
  const stadium = buildStadium(THREE, scene, lite);
  const net = buildNet(THREE, scene);
  buildOfficial(THREE, scene, -7.3, 0.7, '#f2f0e6', 1.12);
  buildOfficial(THREE, scene, -5.9, -2.1, '#b5273f', 0.86);
  buildOfficial(THREE, scene, 5.9, 1.1, '#f1eee4', 0.88);
  const benches = standard(THREE, '#694d3b', 0.86);
  const towel = standard(THREE, '#f0ede2', 0.94);
  for (const z of [-8.5, 8.5]) {
    addBox(THREE, scene, [2.7, 0.14, 0.58], [7.5, 0.45, z], benches);
    addBox(THREE, scene, [2.7, 0.56, 0.1], [7.5, 0.77, z - Math.sign(z) * 0.2], benches);
    addBox(THREE, scene, [0.56, 0.035, 0.48], [7.3, 0.55, z], towel);
    for (let i = 0; i < 2; i++) buildOfficial(THREE, scene, 6.8 + i * 0.75, z, i === 0 ? '#c8e5dc' : '#d1b269', 0.68);
  }

  mergeStaticMeshes(THREE, scene);
  const players = [0, 1, 2, 3].map((seat) => makePlayer(THREE, seat, lite));
  players.forEach((model) => {
    model.root.traverse((object) => {
      const mesh = object as T.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    scene.add(model.root);
  });

  const ballMap = ballTexture(THREE, lite);
  const ballMaterial = new THREE.MeshPhysicalMaterial({ map: ballMap, color: '#f6f2ca', roughness: 0.82, sheen: 0.38, clearcoat: 0.12 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 16, 12), ballMaterial);
  ball.castShadow = true;
  scene.add(ball);
  const shadowTexture = radialShadowTexture(THREE);
  const ballShadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ballShadowMaterial);
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.074;
  scene.add(ballShadow);
  const landingMarkerMaterial = new THREE.MeshBasicMaterial({
    color: '#e5ed8c',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const landingMarker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 48), landingMarkerMaterial);
  landingMarker.rotation.x = -Math.PI / 2;
  landingMarker.position.y = 0.079;
  landingMarker.visible = false;
  landingMarker.renderOrder = 2;
  scene.add(landingMarker);
  const playerShadows = players.map(() => {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.068;
    shadow.scale.set(0.95, 0.62, 1);
    scene.add(shadow);
    return shadow;
  });
  const trailSamples = 12;
  const trailMaterial = new THREE.MeshBasicMaterial({ color: '#fff2ad', transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false });
  const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_RADIUS, 12, 8), trailMaterial, trailSamples);
  trail.count = lite ? 0 : trailSamples;
  trail.visible = !lite;
  trail.frustumCulled = false;
  trail.renderOrder = 4;
  const trailDummy = new THREE.Object3D();
  const trailAxis = new THREE.Vector3(0, 0, 1);
  const trailDirection = new THREE.Vector3();
  const trailColor = new THREE.Color();
  scene.add(trail);
  const ballTrail = Array.from({ length: trailSamples + 1 }, () => ({ x: 0, y: 0, z: 0 }));
  let ballTrailCount = 0;
  const puffs: Puff[] = [];
  const puffMaterial = new THREE.MeshBasicMaterial({ color: '#e8d9bd', transparent: true, opacity: 0.28, depthWrite: false });
  let hitPulse = 0;
  let ballFlash = 0;
  let cameraKick = 0;
  let netRipple = 0;
  let pointsWon = -1;
  let time = 0;
  let viewWidth = 1;
  let viewHeight = 1;
  let currentSide = 0;
  let playerZ = 0;
  let previousPhase: World['phase'] | null = null;
  let cameraTransition = 0;
  let cameraInitialized = false;
  const cameraTarget = new THREE.Vector3();
  const cameraFrom = new THREE.Vector3();
  const cameraLookFrom = new THREE.Vector3();
  let crowdRefresh = 0;
  const scoreboard = stadium.scoreCtx;
  let scoreRefresh = 0;
  let playerX = 0;
  let debugCameraMode: 'front' | 'side' | 'back' | 'game-close' | null = null;
  let replayCameraActive = false;
  let debugCameraSeat = 0;
  let lastRenderAt = 0;
  let frameEma = 0;
  let qualityTier = 0;
  let forceHighQuality = false;
  let overBudgetSince = 0;
  let lastQualityStep = 0;
  const qualityWarmupAt = performance.now();
  let currentDpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5);

  function updateScoreboard(world: World) {
    const ctx = scoreboard;
    const canvas = stadium.scoreCanvas;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1a3931');
    gradient.addColorStop(1, '#101d1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d7d2c0';
    ctx.lineWidth = 6;
    ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    ctx.fillStyle = '#d2e2ce';
    ctx.font = 'bold 34px Georgia,serif';
    ctx.fillText('TAUBE STADIUM  ·  STANFORD', 28, 54);
    ctx.fillStyle = '#d9dfd0';
    ctx.font = '24px Arial,sans-serif';
    const lines = formatScore(world);
    lines.forEach((line, index) => ctx.fillText(line, 28, 116 + index * 52));
    stadium.scoreTexture.needsUpdate = true;
  }

  function resize(width: number, height: number) {
    viewWidth = Math.max(1, width);
    viewHeight = Math.max(1, height);
    camera.aspect = viewWidth / viewHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewWidth, viewHeight, false);
    positionCamera(0);
  }

  function positionCamera(dt: number) {
    if (replayCameraActive) {
      camera.position.set(27, 14, 0);
      camera.lookAt(0, 1.1, 0);
      cameraInitialized = true;
      return;
    }
    if (debugCameraMode) {
      const player = players[debugCameraSeat];
      const target = player?.root.position ?? new THREE.Vector3();
      const closeGameCamera = debugCameraMode === 'game-close';
      const look = target.clone().add(new THREE.Vector3(0, closeGameCamera ? 1.2 : 1.05, 0));
      const facing = player?.root.rotation.y ?? 0;
      const forward = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
      const right = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
      const offset = closeGameCamera
        ? forward.multiplyScalar(-3.8).addScaledVector(right, 0.55)
        : debugCameraMode === 'side'
          ? right.multiplyScalar(2.6)
          : forward.multiplyScalar(debugCameraMode === 'front' ? 2.6 : -2.6);
      offset.y = closeGameCamera ? 1.45 : 0.18;
      camera.position.copy(look).add(offset);
      camera.lookAt(look);
      cameraInitialized = true;
      return;
    }
    const portrait = camera.aspect < 0.78;
    const zoom = portrait ? COURT_LENGTH / 2 + 10.5 : COURT_LENGTH / 2 + 7;
    const height = portrait ? 6.4 : 4.5;
    const side = currentSide === 0 ? 1 : -1;
    const desiredX = clamp(playerX, -3.2, 3.2);
    const baseline = side * (COURT_LENGTH / 2 - 0.65);
    const desiredZ = side * zoom + (playerZ - baseline) * 0.1;
    const targetZ = -side * 1.2 + (playerZ - baseline) * 0.12;
    cameraTarget.set(desiredX * 0.22, portrait ? 0.8 : 0.5, targetZ);
    if (!cameraInitialized) {
      camera.position.set(desiredX, height, desiredZ);
      camera.lookAt(cameraTarget);
      cameraInitialized = true;
      return;
    }
    if (cameraTransition > 0) {
      cameraTransition = Math.max(0, cameraTransition - dt);
      const t = 1 - cameraTransition / 0.4;
      const ease = t * t * (3 - 2 * t);
      camera.position.set(
        cameraFrom.x + (desiredX - cameraFrom.x) * ease,
        cameraFrom.y + (height - cameraFrom.y) * ease,
        cameraFrom.z + (desiredZ - cameraFrom.z) * ease,
      );
      camera.lookAt(
        cameraLookFrom.x + (cameraTarget.x - cameraLookFrom.x) * ease,
        cameraLookFrom.y + (cameraTarget.y - cameraLookFrom.y) * ease,
        cameraLookFrom.z + (cameraTarget.z - cameraLookFrom.z) * ease,
      );
      return;
    }
    camera.position.x = damp(camera.position.x, desiredX, 4.2, dt);
    camera.position.y = damp(camera.position.y, height, 4.2, dt);
    camera.position.z = damp(camera.position.z, desiredZ, 4.2, dt);
    camera.lookAt(cameraTarget);
  }

  function update(world: World, dt: number, humanSeats: ReadonlySet<number>, side: number) {
    time += dt;
    currentSide = side;
    if (previousPhase === 'point' && world.phase === 'serve-ready') {
      cameraTransition = 0.4;
      cameraFrom.copy(camera.position);
      cameraLookFrom.copy(cameraTarget);
    }
    previousPhase = world.phase;
    const alpha = clamp(world.acc / STEP, 0, 1);
    const ballX = world.ball.prev.x + (world.ball.p.x - world.ball.prev.x) * alpha;
    const ballY = world.ball.prev.y + (world.ball.p.y - world.ball.prev.y) * alpha;
    const ballZ = world.ball.prev.z + (world.ball.p.z - world.ball.prev.z) * alpha;
    const half = courtWidth(world.format) / 2;
    for (const stick of net.sticks) stick.visible = world.format === 'singles';
    for (let index = 0; index < 4; index++) {
      const player = world.players[index];
      const model = players[index];
      if (!player || !model) {
        model?.root.visible && (model.root.visible = false);
        if (playerShadows[index]) playerShadows[index]!.visible = false;
        continue;
      }
      model.root.visible = true;
      const x = player.prevX + (player.x - player.prevX) * alpha;
      const z = player.prevZ + (player.z - player.prevZ) * alpha;
      updatePlayer(model, player, world.ball, dt, humanSeats.has(player.seat), clamp(x, -half - 1, half + 1), z, ballX, ballY, world.phase, player.seat === world.serverSeat);
      const shadow = playerShadows[index]!;
      shadow.visible = true;
      shadow.position.set(x, 0.068, z);
      if (humanSeats.has(player.seat) && player.team === side) {
        playerX = x;
        playerZ = z;
      }
    }
    const serverModel = players[world.serverSeat];
    const palm = serverModel?.leftPalmWorldPosition();
    let visualBallX = ballX;
    let visualBallY = ballY;
    let visualBallZ = ballZ;
    if (world.phase === 'serve-ready' && palm) {
      visualBallX = palm.x;
      visualBallY = palm.y;
      visualBallZ = palm.z;
    } else if (world.phase === 'serve-toss' && palm) {
      const blend = clamp(world.serveClock / 0.12, 0, 1);
      visualBallX = palm.x + (ballX - palm.x) * blend;
      visualBallY = palm.y + (ballY - palm.y) * blend;
      visualBallZ = palm.z + (ballZ - palm.z) * blend;
    }
    ball.visible = world.ball.inPlay || world.phase === 'serve-ready' || world.phase === 'serve-toss';
    ball.position.set(visualBallX, visualBallY, visualBallZ);
    const velocity = world.ball.v;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    ball.rotation.x += velocity.z * dt * 2.2 + world.ball.spin.x * dt * 0.018;
    ball.rotation.z -= velocity.x * dt * 2.2 + world.ball.spin.z * dt * 0.018;
    if (world.ball.inPlay && speed > 0.6) {
      for (let index = ballTrail.length - 1; index > 0; index--) {
        ballTrail[index]!.x = ballTrail[index - 1]!.x;
        ballTrail[index]!.y = ballTrail[index - 1]!.y;
        ballTrail[index]!.z = ballTrail[index - 1]!.z;
      }
      ballTrail[0]!.x = ballX;
      ballTrail[0]!.y = ballY;
      ballTrail[0]!.z = ballZ;
      ballTrailCount = Math.min(ballTrailCount + 1, ballTrail.length);
    } else ballTrailCount = 0;
    const visibleTrailSamples = lite ? 0 : Math.min(trailSamples, ballTrailCount - 1);
    trail.count = visibleTrailSamples;
    trail.visible = !lite && qualityTier < 3 && visibleTrailSamples > 0 && world.ball.inPlay;
    trailMaterial.opacity = 0.78 * Math.min(1.4, 0.72 + speed / 36 + hitPulse * 0.4);
    trailDirection.set(velocity.x, velocity.y, velocity.z).normalize();
    for (let index = 0; index < visibleTrailSamples; index++) {
      const point = ballTrail[index + 1];
      if (point) {
        trailDummy.position.set(point.x, point.y, point.z);
        const taper = 1.1 - index * 0.055;
        trailDummy.quaternion.setFromUnitVectors(trailAxis, trailDirection);
        trailDummy.scale.set(taper, taper, taper * (4 + Math.min(3, speed * 0.1)));
        trailDummy.updateMatrix();
        trail.setMatrixAt(index, trailDummy.matrix);
        const fade = 1 - index / trailSamples * 0.78;
        trailColor.setRGB(fade, fade * 0.96, fade * 0.78);
        trail.setColorAt(index, trailColor);
      }
    }
    trail.instanceMatrix.needsUpdate = true;
    if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
    const drop = Math.max(0, visualBallY - BALL_RADIUS);
    ballShadow.position.set(visualBallX, 0.074, visualBallZ);
    ballShadow.scale.setScalar(0.22 + Math.min(0.9, drop * 0.13));
    ballShadowMaterial.opacity = Math.max(0.035, 0.4 / (1 + drop * 0.9));
    ballShadow.visible = ball.visible;
    const humanIncoming = world.ball.inPlay && world.ball.bounces === 0 && world.ball.targetTeam === side;
    const humanServeTarget = world.phase === 'serve-flight' && world.ball.inPlay
      && world.ball.bounces === 0 && humanSeats.has(world.serverSeat);
    if (humanIncoming || humanServeTarget) {
      const landing = predictLanding(world.ball.p, world.ball.v, world.ball.spin);
      if (landing.clearsNet) {
        const progress = clamp(1 - landing.time / 6, 0, 1);
        landingMarker.visible = true;
        landingMarker.position.set(landing.x, 0.079, landing.z);
        landingMarker.scale.setScalar(0.65 + (1 - progress) * 0.75);
        landingMarkerMaterial.opacity = 0.18 + progress * 0.42;
      } else landingMarker.visible = false;
    } else landingMarker.visible = false;
    if (hitPulse > 0) {
      hitPulse = Math.max(0, hitPulse - dt * 6);
      ball.scale.set(1 + hitPulse * 0.35, 1 - hitPulse * 0.24, 1 + hitPulse * 0.35);
    } else ball.scale.setScalar(1);
    ballFlash = Math.max(0, ballFlash - dt * 8);
    ballMaterial.emissive.setRGB(ballFlash, ballFlash, ballFlash);
    if (netRipple > 0) {
      netRipple = Math.max(0, netRipple - dt * 1.5);
      const attribute = net.geometry.getAttribute('position') as T.BufferAttribute;
      for (let i = 0; i < net.positions.length / 3; i++) {
        const x = net.positions[i * 3];
        const y = net.positions[i * 3 + 1];
        attribute.setY(i, y + Math.sin(time * 14 - Math.abs(x) * 1.4) * netRipple * (1 - y / 1.1) * 0.035);
      }
      attribute.needsUpdate = true;
      net.geometry.computeVertexNormals();
    }
    for (const puff of puffs) {
      puff.age += dt;
      const t = puff.age / puff.life;
      puff.mesh.scale.setScalar(0.2 + t * 2.2);
      (puff.mesh.material as T.MeshBasicMaterial).opacity = 0.3 * (1 - t);
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i]!;
      if (puff.age >= puff.life) {
        puff.mesh.removeFromParent();
        puff.mesh.geometry.dispose();
        puffs.splice(i, 1);
      }
    }
    if (qualityTier < 3) stadium.crowdJump.value = Math.max(0, stadium.crowdJump.value - dt * 0.65);
    crowdRefresh += dt;
    if (qualityTier < 3 && crowdRefresh >= 0.1) {
      crowdRefresh %= 0.1;
      const dummy = stadium.dummy;
      for (let i = 0; i < stadium.crowd.length; i++) {
        const person = stadium.crowd[i]!;
        const jump = Math.max(0, Math.sin(time * 3.5 + person.phase)) * stadium.crowdJump.value * (person.hue > 0.75 ? 0.55 : 0.13);
        dummy.position.set(person.x, person.y + jump, person.z);
        dummy.rotation.z = Math.sin(time * 1.1 + person.phase) * 0.035;
        dummy.updateMatrix();
        stadium.bodies.setMatrixAt(i, dummy.matrix);
        dummy.position.set(person.x, person.y + 0.23 + jump, person.z);
        dummy.rotation.set(0, Math.atan2(ballX - person.x, ballZ - person.z), 0);
        dummy.updateMatrix();
        stadium.heads.setMatrixAt(i, dummy.matrix);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(person.x, person.y + 0.32 + jump, person.z);
        dummy.scale.setScalar(person.hue > 0.82 ? 1 : 0.001);
        dummy.updateMatrix();
        stadium.hats.setMatrixAt(i, dummy.matrix);
        dummy.scale.setScalar(1);
        for (const side of [-1, 1]) {
          dummy.position.set(person.x + side * 0.105, person.y - 0.055 + jump, person.z);
          const clap = stadium.crowdJump.value > 0.45;
          dummy.rotation.z = side * (clap ? 1.05 + Math.sin(time * 14 + person.phase) * 0.22 : 0.35 + Math.sin(time * 1.4 + person.phase) * 0.08);
          dummy.updateMatrix();
          stadium.arms.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), dummy.matrix);
        }
      }
      stadium.bodies.instanceMatrix.needsUpdate = true;
      stadium.heads.instanceMatrix.needsUpdate = true;
      stadium.arms.instanceMatrix.needsUpdate = true;
      stadium.hats.instanceMatrix.needsUpdate = true;
    }
    if (world.match.points[0] + world.match.points[1] !== pointsWon) {
      pointsWon = world.match.points[0] + world.match.points[1];
      stadium.crowdJump.value = 1;
    }
    scoreRefresh += dt;
    if (scoreRefresh > 0.3) {
      scoreRefresh = 0;
      updateScoreboard(world);
    }
    positionCamera(dt);
    if (cameraKick > 0) {
      cameraKick = Math.max(0, cameraKick - dt * 2.8);
      camera.position.x += Math.sin(time * 82) * cameraKick * 0.12;
      camera.position.y += Math.cos(time * 64) * cameraKick * 0.08;
    }
  }

  function burst(x: number, z: number, line: boolean) {
    const count = line ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.08, 7, 5), puffMaterial.clone());
      mesh.position.set(x + (Math.random() - 0.5) * 0.16, 0.11 + i * 0.02, z + (Math.random() - 0.5) * 0.16);
      scene.add(mesh);
      puffs.push({ mesh, age: 0, life: 0.6 + Math.random() * 0.4 });
    }
  }

  function dispose() {
    players.forEach((model) => model.dispose());
    disposeTree(scene);
    envTarget.dispose();
    pmrem.dispose();
    glContext.dispose();
    if (import.meta.env.DEV) delete (window as Window & { __tennisRenderStats?: unknown }).__tennisRenderStats;
  }

  return {
    canvas: glContext.canvas,
    resize,
    update,
    debugPose(seat, name, progress = 0) {
      const model = players[seat];
      if (model) model.debugPose = { name, progress, position: model.root.position.clone(), rotation: model.root.rotation.y };
    },
    debugCamera(name, seat) {
      debugCameraMode = name === 'game' ? seat === undefined ? null : 'game-close' : name;
      debugCameraSeat = Math.max(0, Math.min(players.length - 1, seat ?? 0));
      cameraInitialized = false;
    },
    ...(import.meta.env.DEV ? {
      debugForceHighQuality() {
        lite = false;
        forceHighQuality = true;
        qualityTier = 0;
        currentDpr = Math.min(window.devicePixelRatio || 1, 1.5);
        renderer.setPixelRatio(currentDpr);
        renderer.shadowMap.enabled = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.needsUpdate = true;
        stadium.arms.visible = true;
        stadium.hats.visible = true;
        trail.visible = false;
        flare.visible = true;
        frameEma = 0;
        lastRenderAt = 0;
        overBudgetSince = 0;
      },
      debugCrowdExcitement() {
        stadium.crowdJump.value = 1.45;
        crowdRefresh = 1;
      },
    } : {}),
    replayCamera(active) {
      replayCameraActive = active;
      cameraInitialized = false;
      cameraTransition = 0;
    },
    render() {
      if (!glContext.lost()) {
        const now = performance.now();
        if (lastRenderAt > 0) {
          const interval = Math.min(now - lastRenderAt, 100);
          frameEma = frameEma ? frameEma * 0.9 + interval * 0.1 : interval;
          if ((!import.meta.env.DEV || !forceHighQuality) && now - qualityWarmupAt >= 1500 && frameEma > 26) {
            if (!overBudgetSince) overBudgetSince = now;
            if (now - overBudgetSince >= 1000 && now - lastQualityStep >= 1000 && qualityTier < 3) {
              qualityTier++;
              lastQualityStep = now;
              if (qualityTier === 1) {
                currentDpr = 1;
                renderer.setPixelRatio(currentDpr);
              } else if (qualityTier === 2) {
                renderer.shadowMap.enabled = false;
                scene.traverse((object) => {
                  const mesh = object as T.Mesh;
                  if (!mesh.isMesh) return;
                  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                  materials.forEach((material) => { material.needsUpdate = true; });
                });
              } else {
                currentDpr = 0.75;
                renderer.setPixelRatio(currentDpr);
                stadium.arms.visible = false;
                stadium.hats.visible = false;
                trail.visible = false;
                flare.visible = false;
              }
              overBudgetSince = now;
            }
          }
          else overBudgetSince = 0;
        }
        lastRenderAt = now;
        renderer.render(scene, camera);
        if (import.meta.env.DEV) {
          (window as Window & { __tennisRenderStats?: () => object }).__tennisRenderStats = () => ({
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            qualityTier,
            lite,
            trailSamples: ballTrailCount,
            trailCount: trail.count,
            trailVisible: trail.visible,
            trailEndpoints: [ballTrail[0], ballTrail[Math.max(0, ballTrailCount - 1)]],
            replayCameraActive,
            debugCameraMode,
            cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            averageFrameMs: frameEma,
          });
        }
      }
    },
    hit(speed: number, perfect = false) {
      hitPulse = Math.min(1, 0.55 + speed / 210);
      if (perfect) hitPulse = 1;
      if (perfect) {
        ballFlash = 0.9;
        cameraKick = 0.16;
      }
      sfxCrowd(stadium.crowdJump, 0.12);
    },
    bounce(x: number, z: number, line: boolean) {
      burst(x, z, line);
      if (line) stadium.crowdJump.value = Math.max(stadium.crowdJump.value, 0.2);
    },
    netHit() {
      netRipple = 1;
    },
    point(winner: number, longRally = false) {
      stadium.crowdJump.value = Math.max(stadium.crowdJump.value, longRally ? 1.45 : winner === currentSide ? 1 : 0.55);
    },
    crowdOoh(shots: number) {
      if (qualityTier < 3 && shots >= 8) stadium.crowdJump.value = Math.max(stadium.crowdJump.value, Math.min(0.7, 0.18 + (shots - 8) * 0.035));
    },
    dispose,
  };
}

function sfxCrowd(crowd: { value: number }, amount: number) {
  crowd.value = Math.max(crowd.value, amount);
}
