import type * as T from 'three';
import type { Vec3, World } from './logic.ts';
import { BALL_RADIUS, COURT_LENGTH, DOUBLES_WIDTH, SERVICE_LINE, SINGLES_WIDTH, courtWidth, netHeight, pointLabel, serverOf } from './logic.ts';
import { createGL, damp, disposeTree } from './gl.ts';
import { makePlayer, updatePlayer } from './player.ts';
import { ballTexture, courtTextures, netTexture, windscreenTexture } from './textures.ts';

type Three = typeof import('three');
type Puff = { mesh: T.Mesh; age: number; life: number };

export type View = {
  canvas: HTMLCanvasElement;
  resize: (width: number, height: number) => void;
  update: (world: World, dt: number, humanSeats: ReadonlySet<number>, side: number) => void;
  render: () => void;
  hit: (speed: number) => void;
  bounce: (x: number, z: number, line: boolean) => void;
  netHit: () => void;
  point: (winner: number) => void;
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

function addCourtLine(THREE: Three, parent: T.Object3D, x: number, z: number, width: number, length: number, height = 0.019) {
  return addBox(THREE, parent, [width, 0.012, length], [x, height, z], standard(THREE, lineColor, 0.56), false, true);
}

function buildCourt(THREE: Three, scene: T.Scene, lite: boolean) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 170), standard(THREE, '#8b9561', 0.98));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  const court = new THREE.Group();
  const maps = courtTextures(THREE, lite);
  const surf = new THREE.MeshStandardMaterial({
    map: maps.color,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    roughness: 0.78,
    metalness: 0.01,
  });
  const blue = new THREE.Mesh(new THREE.BoxGeometry(DOUBLES_WIDTH + 1.05, 0.12, COURT_LENGTH + 1.1), standard(THREE, '#173b55', 0.84));
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

  const apronMaterial = standard(THREE, '#365a58', 0.92);
  for (const side of [-1, 1]) {
    addBox(THREE, court, [3.4, 0.12, COURT_LENGTH + 2.2], [side * (doublesHalf + 2.2), -0.02, 0], apronMaterial, false, true);
    addBox(THREE, court, [DOUBLES_WIDTH + 4.4, 0.12, 3], [0, -0.02, side * (COURT_LENGTH / 2 + 2.4)], apronMaterial, false, true);
  }
  scene.add(court);
  return { court, playSurface, singlesHalf, doublesHalf };
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
  environmentScene.background = new THREE.Color('#95aeba');
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
    for (const side of [-1, 1]) {
      addBox(THREE, scene, [21 + row * 0.4, 0.42, depth], [0, h, side * (13.5 + row * 0.87)], row < 4 ? bowl : upper);
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
    for (let row = 0; row < 6; row++) {
      const z = side * (13.8 + row * 0.82);
      for (let i = 0; i < 24; i++) rows.push([-9.1 + i * 0.79, 0.72 + row * 0.48, z, side]);
    }
  }
  const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.11, 0.34), seatMaterial, rows.length);
  const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.3, 0.055), seatBackMaterial, rows.length);
  const dummy = new THREE.Object3D();
  rows.forEach(([x, y, z, side], index) => {
    dummy.position.set(x, y, z);
    dummy.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    dummy.updateMatrix();
    seats.setMatrixAt(index, dummy.matrix);
    dummy.position.set(x, y + 0.17, z - Math.sign(z) * 0.12);
    dummy.updateMatrix();
    backs.setMatrixAt(index, dummy.matrix);
  });
  seats.castShadow = !lite;
  seats.receiveShadow = true;
  backs.castShadow = !lite;
  scene.add(seats, backs);

  const count = lite ? 420 : 1050;
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.07, 0.18, 3, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 }), count);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.067, 7, 6), standard(THREE, '#c69a78', 0.88), count);
  const crowd: { x: number; y: number; z: number; phase: number; hue: number }[] = [];
  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const isEnd = Math.random() < 0.28;
    const row = Math.floor(Math.random() * 7);
    const x = isEnd ? (Math.random() - 0.5) * 22 : side * (8.2 + row * 0.82 + Math.random() * 0.6);
    const z = isEnd ? side * (13.5 + row * 0.8) : (Math.random() - 0.5) * 34;
    const y = 0.94 + row * 0.46;
    crowd.push({ x, y, z, phase: Math.random() * Math.PI * 2, hue: Math.random() });
    bodies.setColorAt(i, new THREE.Color(['#ece4d4', '#bd293e', '#314c68', '#caa35d', '#406453', '#e4ddd1'][Math.floor(Math.random() * 6)]));
  }
  bodies.castShadow = !lite;
  heads.castShadow = !lite;
  scene.add(bodies, heads);
  const crowdJump = { value: 0 };

  const screenTexture = windscreenTexture(THREE);
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTexture, roughness: 0.85, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), screenMat);
    screen.position.set(0, 1.42, side * 13.9);
    screen.rotation.y = side === -1 ? Math.PI : 0;
    scene.add(screen);
    const rail = standard(THREE, '#e8e2d3', 0.55, 0.3);
    addBox(THREE, scene, [14, 0.08, 0.08], [0, 2.82, side * 13.9], rail);
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
    crown.castShadow = !lite;
    scene.add(crown);
  }
  for (let i = -3; i <= 3; i++) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(18 + Math.abs(i) * 2, 12 + Math.random() * 5, 6), standard(THREE, i % 2 ? '#68795f' : '#7f8260', 1));
    hill.position.set(i * 24, 3, -58 - Math.abs(i) * 2);
    hill.scale.z = 0.48;
    scene.add(hill);
  }

  return {
    bodies,
    heads,
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
  group.add(mesh);
  const tapeCurve = new THREE.CatmullRomCurve3(Array.from({ length: 15 }, (_, i) => {
    const x = -width / 2 + width * i / 14;
    return new THREE.Vector3(x, netHeight(x) + 0.005, 0);
  }));
  const tape = new THREE.Mesh(new THREE.TubeGeometry(tapeCurve, 80, 0.046, 6, false), standard(THREE, '#eee9dc', 0.62));
  tape.castShadow = true;
  group.add(tape);
  const cord = new THREE.Mesh(new THREE.TubeGeometry(tapeCurve, 80, 0.012, 5, false), standard(THREE, '#f9f5e8', 0.48, 0.1));
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
  group.traverse((object) => {
    const mesh = object as T.Mesh;
    mesh.castShadow = true;
  });
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
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 190);

  const sky = buildSky(THREE, scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTarget = pmrem.fromScene(sky.environmentScene);
  scene.environment = envTarget.texture;
  const hemi = new THREE.HemisphereLight('#ffe7c6', '#53695f', lite ? 1.3 : 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe0b1', 3.15);
  sun.position.set(-25, 17, 27);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  sun.shadow.camera.left = -19;
  sun.shadow.camera.right = 19;
  sun.shadow.camera.top = 29;
  sun.shadow.camera.bottom = -29;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 100;
  sun.shadow.bias = -0.00034;
  sun.shadow.normalBias = 0.026;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#d7e9f2', 0.72);
  fill.position.set(15, 11, -19);
  scene.add(fill);

  buildCourt(THREE, scene, lite);
  const stadium = buildStadium(THREE, scene, lite);
  const net = buildNet(THREE, scene);
  buildOfficial(THREE, scene, -7.3, 0.7, '#f2f0e6', 1.12);
  buildOfficial(THREE, scene, -5.9, -2.1, '#b5273f', 0.86);
  buildOfficial(THREE, scene, 5.9, 1.1, '#f1eee4', 0.88);
  const benches = standard(THREE, '#694d3b', 0.86);
  for (const z of [-8.5, 8.5]) {
    addBox(THREE, scene, [2.7, 0.14, 0.58], [7.5, 0.45, z], benches, true);
    addBox(THREE, scene, [2.7, 0.56, 0.1], [7.5, 0.77, z - Math.sign(z) * 0.2], benches, true);
    for (let i = 0; i < 2; i++) buildOfficial(THREE, scene, 6.8 + i * 0.75, z, i === 0 ? '#c8e5dc' : '#d1b269', 0.68);
  }

  const players = [0, 1, 2, 3].map((seat) => makePlayer(THREE, seat, lite));
  players.forEach((model) => {
    model.root.traverse((object) => {
      const mesh = object as T.Mesh;
      mesh.castShadow = !lite;
      mesh.receiveShadow = true;
    });
    scene.add(model.root);
  });

  const ballMap = ballTexture(THREE, lite);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 18), new THREE.MeshPhysicalMaterial({ map: ballMap, color: '#f6f2ca', roughness: 0.82, sheen: 0.38, clearcoat: 0.12 }));
  ball.castShadow = true;
  scene.add(ball);
  const trail = Array.from({ length: 5 }, (_, index) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS * (0.78 - index * 0.09), 12, 8), new THREE.MeshBasicMaterial({ color: '#e6ed70', transparent: true, opacity: 0.23 - index * 0.035, depthWrite: false }));
    scene.add(mesh);
    return mesh;
  });
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: '#15201b', transparent: true, opacity: 0.42, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.074;
  scene.add(ballShadow);
  const ballShadowSoft = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ color: '#1b2923', transparent: true, opacity: 0.11, depthWrite: false }));
  ballShadowSoft.rotation.x = -Math.PI / 2;
  ballShadowSoft.position.y = 0.071;
  scene.add(ballShadowSoft);
  const ballTrail: Vec3[] = [];
  const puffs: Puff[] = [];
  const puffMaterial = new THREE.MeshBasicMaterial({ color: '#e8d9bd', transparent: true, opacity: 0.28, depthWrite: false });
  let hitPulse = 0;
  let netRipple = 0;
  let pointsWon = -1;
  let time = 0;
  let viewWidth = 1;
  let viewHeight = 1;
  let currentSide = 0;
  const scoreboard = stadium.scoreCtx;
  let scoreRefresh = 0;

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
    positionCamera(0, 0);
  }

  function positionCamera(dt: number, ballX: number) {
    const portrait = camera.aspect < 0.78;
    const zoom = portrait ? 29 : camera.aspect > 1.55 ? 20.5 : 23;
    const height = portrait ? 9.5 : 6.5;
    const side = currentSide === 0 ? 1 : -1;
    const desiredX = ballX * 0.045;
    camera.position.x = damp(camera.position.x, desiredX, 1.1, dt || 1);
    camera.position.y = height;
    camera.position.z = side * zoom;
    const targetZ = -side * 0.2;
    camera.lookAt(desiredX * 0.3, 0.7, targetZ);
  }

  function update(world: World, dt: number, humanSeats: ReadonlySet<number>, side: number) {
    time += dt;
    currentSide = side;
    const half = courtWidth(world.format) / 2;
    net.sticks.forEach((stick) => { stick.visible = world.format === 'singles'; });
    for (let index = 0; index < 4; index++) {
      const player = world.players[index];
      const model = players[index];
      if (!player || !model) {
        model?.root.visible && (model.root.visible = false);
        continue;
      }
      model.root.visible = true;
      model.root.position.x = Math.max(-half - 1, Math.min(half + 1, player.x));
      updatePlayer(model, player, world.ball, dt, humanSeats.has(player.seat));
    }
    ball.visible = world.ball.inPlay || world.phase === 'serve-ready' || world.phase === 'serve-toss';
    ball.position.set(world.ball.p.x, world.ball.p.y + (world.phase === 'serve-toss' ? Math.sin(world.serveClock * 4) * 0.045 : 0), world.ball.p.z);
    const velocity = world.ball.v;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    ball.rotation.x += velocity.z * dt * 2.2 + world.ball.spin.x * dt * 0.018;
    ball.rotation.z -= velocity.x * dt * 2.2 + world.ball.spin.z * dt * 0.018;
    if (world.ball.inPlay && speed > 0.6) {
      ballTrail.unshift({ ...world.ball.p });
      if (ballTrail.length > trail.length + 1) ballTrail.length = trail.length + 1;
    } else if (ballTrail.length) ballTrail.length = 0;
    trail.forEach((mesh, index) => {
      const point = ballTrail[Math.min(index + 1, ballTrail.length - 1)];
      mesh.visible = !!point && world.ball.inPlay;
      if (point) mesh.position.set(point.x, point.y, point.z);
    });
    const drop = Math.max(0, world.ball.p.y - BALL_RADIUS);
    ballShadow.position.set(world.ball.p.x, 0.074, world.ball.p.z);
    ballShadow.scale.setScalar(1 + Math.min(1.8, drop * 0.14));
    (ballShadow.material as T.MeshBasicMaterial).opacity = Math.max(0.06, 0.42 - drop * 0.037);
    ballShadowSoft.position.set(world.ball.p.x, 0.071, world.ball.p.z);
    ballShadowSoft.scale.setScalar(1 + Math.min(3, drop * 0.19));
    (ballShadowSoft.material as T.MeshBasicMaterial).opacity = Math.max(0.025, 0.11 - drop * 0.012);
    if (hitPulse > 0) {
      hitPulse = Math.max(0, hitPulse - dt * 6);
      ball.scale.set(1 + hitPulse * 0.35, 1 - hitPulse * 0.24, 1 + hitPulse * 0.35);
    } else ball.scale.setScalar(1);
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
    for (const puff of [...puffs]) {
      if (puff.age >= puff.life) {
        puff.mesh.removeFromParent();
        puff.mesh.geometry.dispose();
        puffs.splice(puffs.indexOf(puff), 1);
      }
    }
    stadium.crowdJump.value = Math.max(0, stadium.crowdJump.value - dt * 0.65);
    const dummy = stadium.dummy;
    stadium.crowd.forEach((person, i) => {
      const jump = Math.max(0, Math.sin(time * 3.5 + person.phase)) * stadium.crowdJump.value * (person.hue > 0.75 ? 0.55 : 0.13);
      dummy.position.set(person.x, person.y + jump, person.z);
      dummy.rotation.z = Math.sin(time * 1.1 + person.phase) * 0.035;
      dummy.updateMatrix();
      stadium.bodies.setMatrixAt(i, dummy.matrix);
      dummy.position.set(person.x, person.y + 0.2 + jump, person.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      stadium.heads.setMatrixAt(i, dummy.matrix);
    });
    stadium.bodies.instanceMatrix.needsUpdate = true;
    stadium.heads.instanceMatrix.needsUpdate = true;
    if (world.match.points[0] + world.match.points[1] !== pointsWon) {
      pointsWon = world.match.points[0] + world.match.points[1];
      stadium.crowdJump.value = 1;
    }
    scoreRefresh += dt;
    if (scoreRefresh > 0.3) {
      scoreRefresh = 0;
      updateScoreboard(world);
    }
    positionCamera(dt, world.ball.p.x);
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
    disposeTree(scene);
    envTarget.dispose();
    pmrem.dispose();
    glContext.dispose();
  }

  return {
    canvas: glContext.canvas,
    resize,
    update,
    render() {
      if (!glContext.lost()) renderer.render(scene, camera);
    },
    hit(speed: number) {
      hitPulse = Math.min(1, 0.55 + speed / 210);
      sfxCrowd(stadium.crowdJump, 0.12);
    },
    bounce(x: number, z: number, line: boolean) {
      burst(x, z, line);
      if (line) stadium.crowdJump.value = Math.max(stadium.crowdJump.value, 0.2);
    },
    netHit() {
      netRipple = 1;
    },
    point(winner: number) {
      stadium.crowdJump.value = Math.max(stadium.crowdJump.value, winner === currentSide ? 1 : 0.55);
    },
    dispose,
  };
}

function sfxCrowd(crowd: { value: number }, amount: number) {
  crowd.value = Math.max(crowd.value, amount);
}
