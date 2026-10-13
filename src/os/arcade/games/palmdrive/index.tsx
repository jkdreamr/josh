import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useOnline, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import {
  BALLOONS,
  CAR_L,
  CAR_W,
  COUNTDOWN,
  LANES,
  LANE_W,
  SPAWN_Z,
  SPIN_T,
  create,
  fireItem,
  gas,
  kmh,
  laneX,
  ordinal,
  placeOf,
  racing,
  score,
  steer,
  step,
  zOf,
  type Item,
  type State,
} from './logic';
import { F_BOOST, F_OUT, F_SPIN, F_STAR, fallbackSeed, guestPacket, hostPacket, parseNet, predict, type Racer } from './net';
import { meta } from './meta';
import './palmdrive.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Stage />
    </GameShell>
  );
}

const ROAD_W = LANES * LANE_W;
const ROAD_LEN = 260;
const TREE_GAP = 11;
const TREES_PER_SIDE = 22;
const CHURCH_Z = 215;
const CAM_Y = 4.1;
const CAM_Z = -7.4;
/** Kart colors by seat; solo you drive the red one. */
const KART_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#ec407a', '#00acc1'];
/** Extra lead the online host gives before the countdown so every guest has the seed. */
const LEAD = 0.8;
/** Guests show "waiting for the host" until the first host packet, then fall back to a shared seed. */
const WAIT = 60;
const WAIT_FALLBACK = 4;
/** Starting lane by seat, so the karts line up across the road. */
const GRID = [1, 0, 2];

/**
 * The camera looks down +z, which puts world +x on the left of the screen. The logic numbers lanes left to right,
 * so every lateral position is flipped on its way into the scene.
 */
const wx = (x: number) => -x;

type Car = { group: T.Group; body: T.MeshLambertMaterial };
type Kart = { group: T.Group; body: T.MeshLambertMaterial; color: number; flames: T.Group; balloons: T.Group[] };
type Geo = { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; ring: T.TorusGeometry; cone: T.ConeGeometry; carWheel: T.CylinderGeometry };
type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  roadTex: T.CanvasTexture;
  dashTex: T.CanvasTexture;
  trunks: T.InstancedMesh;
  crowns: T.InstancedMesh;
  coins: T.InstancedMesh;
  player: Kart;
  ghosts: Kart[];
  cars: Car[];
  cones: T.Group[];
  boxes: T.Mesh[];
  boxMat: T.MeshBasicMaterial;
  dashes: T.Mesh[];
  shells: T.Group[];
  shake: number;
  roll: number;
  fov: number;
  dummy: T.Object3D;
  v: T.Vector3;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

/** What the scene shows of another racer, eased toward the latest network estimate. */
type Ghost = { seat: number; d: number; x: number; f: number };

function roadTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3a40';
  g.fillRect(0, 0, 256, 256);
  // subtle asphalt noise
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = '#e9e4d6';
  for (let l = 1; l < LANES; l++) {
    const x = (256 / LANES) * l;
    g.fillRect(x - 3, 20, 6, 110);
  }
  g.fillRect(0, 0, 8, 256);
  g.fillRect(248, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, ROAD_LEN / 9);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The "?" on item boxes; the material tints it through the rainbow. */
function boxTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 12;
  g.strokeRect(6, 6, 116, 116);
  g.font = 'bold 86px Inter, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(40,30,60,0.55)';
  g.strokeText('?', 64, 70);
  g.fillStyle = '#fff';
  g.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dash panel chevrons. The pad lies flat with the canvas top toward the camera, so they point down the canvas. */
function dashTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff8a1f';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#ffe14d';
  for (let i = 0; i < 2; i++) {
    const y = i * 64;
    g.beginPath();
    g.moveTo(6, y + 10);
    g.lineTo(32, y + 40);
    g.lineTo(58, y + 10);
    g.lineTo(58, y + 26);
    g.lineTo(32, y + 56);
    g.lineTo(6, y + 26);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCar(THREE: Three, geo: Geo, color: number, dark: T.Material): Car {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const lower = new THREE.Mesh(geo.box, body);
  lower.scale.set(CAR_W, 0.55, CAR_L);
  lower.position.y = 0.55;
  const cabin = new THREE.Mesh(geo.box, body);
  cabin.scale.set(CAR_W * 0.84, 0.5, CAR_L * 0.5);
  cabin.position.set(0, 1.05, -0.2);
  const glass = new THREE.Mesh(geo.box, dark);
  glass.scale.set(CAR_W * 0.86, 0.32, CAR_L * 0.52);
  glass.position.set(0, 1.08, -0.2);
  group.add(lower, cabin, glass);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(geo.carWheel, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * (CAR_W / 2), 0.36, sz * (CAR_L * 0.32));
    group.add(w);
  }
  return { group, body };
}

/** A go-kart with its driver, exhaust flames and three balloons. Ghosts are see-through. */
function makeKart(THREE: Three, geo: Geo, color: string, ghost: boolean): Kart {
  const group = new THREE.Group();
  const mat = (c: number | string) => {
    const m = new THREE.MeshLambertMaterial({ color: c });
    if (ghost) {
      m.transparent = true;
      m.opacity = 0.5;
      m.depthWrite = false;
    }
    return m;
  };
  const body = mat(color);
  const dark = mat(0x1b1c22);
  const skin = mat(0xf2c7a0);
  const white = mat(0xf6f6f8);
  const add = (parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    parent.add(o);
    return o;
  };
  add(group, geo.box, body, 0, 0.34, 0.05, 1.3, 0.22, 2.6);
  add(group, geo.box, body, 0, 0.42, 1.45, 0.95, 0.22, 0.7);
  add(group, geo.box, dark, 0, 0.32, 1.86, 1.45, 0.16, 0.18);
  for (const sx of [-1, 1]) add(group, geo.box, body, sx * 0.66, 0.46, -0.1, 0.2, 0.3, 1.5);
  add(group, geo.box, dark, 0, 0.78, -0.62, 0.78, 0.72, 0.16);
  add(group, geo.box, body, 0, 0.8, -0.28, 0.6, 0.56, 0.5);
  add(group, geo.ball, skin, 0, 1.24, -0.2, 0.28, 0.28, 0.28);
  add(group, geo.ball, white, 0, 1.3, -0.26, 0.34, 0.32, 0.34);
  add(group, geo.ring, dark, 0, 1.0, 0.3, 0.24, 0.24, 0.24).rotation.x = -0.9;
  for (const sx of [-1, 1]) {
    add(group, geo.wheel, dark, sx * 0.8, 0.28, 0.95, 0.28, 0.3, 0.28).rotation.z = Math.PI / 2;
    add(group, geo.wheel, dark, sx * 0.84, 0.36, -0.82, 0.36, 0.42, 0.36).rotation.z = Math.PI / 2;
    add(group, geo.wheel, dark, sx * 0.3, 0.45, -1.32, 0.09, 0.3, 0.09).rotation.x = Math.PI / 2;
  }
  const flames = new THREE.Group();
  const fire = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9, depthWrite: false });
  for (const sx of [-1, 1]) add(flames, geo.cone, fire, sx * 0.3, 0.45, -1.85, 0.16, 0.8, 0.16).rotation.x = -Math.PI / 2;
  flames.visible = false;
  group.add(flames);
  const balloons: T.Group[] = [];
  for (const [x, y] of [[-0.62, 1.55], [0, 1.78], [0.62, 1.55]]) {
    const b = new THREE.Group();
    add(b, geo.ball, body, x, y, -1.2, 0.22, 0.27, 0.22);
    add(b, geo.box, white, x * 0.8, (y + 0.6) / 2, -1.1, 0.025, y - 0.65, 0.025);
    group.add(b);
    balloons.push(b);
  }
  // drawn a touch smaller than the hitbox (CAR_W) so a near miss looks like one
  group.scale.setScalar(0.82);
  return { group, body, color: new THREE.Color(color).getHex(), flames, balloons };
}

function frondGeometry(THREE: Three) {
  // seven drooping blades radiating from the crown
  const pos: number[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const len = 2.6;
    const tip = [dx * len, -0.9, dz * len];
    const mid = [dx * len * 0.5, 0.25, dz * len * 0.5];
    const w = 0.42;
    const px = -dz * w;
    const pz = dx * w;
    pos.push(0, 0, 0, mid[0] + px, mid[1], mid[2] + pz, mid[0] - px, mid[1], mid[2] - pz);
    pos.push(mid[0] + px, mid[1], mid[2] + pz, tip[0], tip[1], tip[2], mid[0] - px, mid[1], mid[2] - pz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function makeChurch(THREE: Three, box: T.BoxGeometry) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd9b98a });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  const gold = new THREE.MeshLambertMaterial({ color: 0xe6c36a });
  const shadow = new THREE.MeshLambertMaterial({ color: 0x5a3f2e });
  const mesh = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  // long arcade wings either side
  mesh(box, stone, -26, 4, 8, 30, 8, 10);
  mesh(box, stone, 26, 4, 8, 30, 8, 10);
  mesh(roof, tile, -26, 9.2, 8, 24, 2.6, 9, Math.PI / 4);
  mesh(roof, tile, 26, 9.2, 8, 24, 2.6, 9, Math.PI / 4);
  // nave
  mesh(box, stone, 0, 8, 14, 22, 16, 30);
  const nave = mesh(roof, tile, 0, 19.5, 14, 17, 7, 24, Math.PI / 4);
  nave.scale.set(17, 7, 24);
  // facade with gable and the big mosaic
  mesh(box, stone, 0, 9.5, -2, 26, 19, 3);
  const gable = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), stone);
  gable.rotation.y = Math.PI / 4;
  gable.scale.set(19, 6, 2.2);
  gable.position.set(0, 22, -2);
  g.add(gable);
  mesh(box, gold, 0, 13.5, -3.7, 18, 7.5, 0.4);
  mesh(box, shadow, -6, 4, -3.7, 3.4, 6.5, 0.4);
  mesh(box, shadow, 0, 4, -3.7, 3.4, 6.5, 0.4);
  mesh(box, shadow, 6, 4, -3.7, 3.4, 6.5, 0.4);
  // crossing with a low octagonal drum and dome
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 6, 8), stone);
  drum.position.set(0, 26, 22);
  g.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tile);
  dome.position.set(0, 29, 22);
  g.add(dome);
  return g;
}

function build(THREE: Three, host: HTMLElement, mySeat: number): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf4cfa6, 60, 300);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 600);

  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x6b7a4a, 1.0));
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
  sun.position.set(-30, 40, 120);
  scene.add(sun);

  const geo: Geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    wheel: new THREE.CylinderGeometry(1, 1, 1, 14),
    ball: new THREE.SphereGeometry(1, 14, 10),
    ring: new THREE.TorusGeometry(1, 0.25, 6, 14),
    cone: new THREE.ConeGeometry(1, 1, 10),
    carWheel: new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10),
  };
  const dark = new THREE.MeshLambertMaterial({ color: 0x15161a });

  // ground, road, curbs
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, ROAD_LEN + 60), new THREE.MeshLambertMaterial({ color: 0x8fa35a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, ROAD_LEN / 2 - 20);
  scene.add(ground);
  const roadTex = roadTexture(THREE);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshLambertMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, ROAD_LEN / 2 - 20);
  scene.add(road);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xd8cbb0 }));
    curb.scale.set(1.2, 0.18, ROAD_LEN);
    curb.position.set(side * (ROAD_W / 2 + 0.6), 0.09, ROAD_LEN / 2 - 20);
    scene.add(curb);
  }

  // palms, instanced
  const n = TREES_PER_SIDE * 2;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), n);
  const crowns = new THREE.InstancedMesh(frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), n);
  scene.add(trunks, crowns);

  const player = makeKart(THREE, geo, KART_COLORS[mySeat % KART_COLORS.length], false);
  scene.add(player.group);
  const ghosts = KART_COLORS.map((c) => {
    const k = makeKart(THREE, geo, c, true);
    k.group.visible = false;
    scene.add(k.group);
    return k;
  });

  const cars: Car[] = [];
  for (let i = 0; i < 10; i++) {
    const c = makeCar(THREE, geo, 0xffffff, dark);
    c.group.rotation.y = Math.PI;
    c.group.visible = false;
    scene.add(c.group);
    cars.push(c);
  }
  const cones: T.Group[] = [];
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a1f });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(geo.cone, coneMat);
    cone.scale.set(0.42, 1.1, 0.42);
    cone.position.y = 0.55;
    const band = new THREE.Mesh(geo.wheel, bandMat);
    band.scale.set(0.32, 0.16, 0.32);
    band.position.y = 0.62;
    g.add(cone, band);
    g.visible = false;
    scene.add(g);
    cones.push(g);
  }

  const boxMat = new THREE.MeshBasicMaterial({ map: boxTexture(THREE), transparent: true, opacity: 0.92 });
  const boxes: T.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Mesh(geo.box, boxMat);
    b.scale.setScalar(1.15);
    b.visible = false;
    scene.add(b);
    boxes.push(b);
  }
  const coins = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18),
    new THREE.MeshLambertMaterial({ color: 0xf7c948, emissive: 0x5a3c00 }),
    48,
  );
  coins.count = 0;
  scene.add(coins);
  const dashTex = dashTexture(THREE);
  const dashMat = new THREE.MeshBasicMaterial({ map: dashTex, transparent: true, opacity: 0.95 });
  const dashGeo = new THREE.PlaneGeometry(1.9, 4.2);
  const dashes: T.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.y = 0.03;
    d.visible = false;
    scene.add(d);
    dashes.push(d);
  }
  const shellMat = new THREE.MeshLambertMaterial({ color: 0x2fae4e });
  const rimMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const shells: T.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(geo.ball, shellMat);
    top.scale.set(0.45, 0.34, 0.45);
    top.position.y = 0.36;
    const rim = new THREE.Mesh(geo.wheel, rimMat);
    rim.scale.set(0.5, 0.12, 0.5);
    rim.position.y = 0.3;
    g.add(top, rim);
    g.visible = false;
    scene.add(g);
    shells.push(g);
  }

  const church = makeChurch(THREE, geo.box);
  church.position.set(0, 0, CHURCH_Z);
  scene.add(church);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false }));
  sunDisc.position.set(-40, 48, 420);
  scene.add(sunDisc);

  const world: World = {
    gl,
    scene,
    camera,
    roadTex,
    dashTex,
    trunks,
    crowns,
    coins,
    player,
    ghosts,
    cars,
    cones,
    boxes,
    boxMat,
    dashes,
    shells,
    shake: 0,
    roll: 0,
    fov: 60,
    dummy: new THREE.Object3D(),
    v: new THREE.Vector3(),
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      world.fov = camera.aspect < 0.8 ? 80 : camera.aspect < 1.2 ? 68 : 58;
      camera.fov = world.fov;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      coins.dispose();
      for (const g of Object.values(geo)) g.dispose();
      dark.dispose();
      gl.dispose();
    },
  };
  return world;
}

/** Places the scenery, course, pickups and karts for this frame. Lateral positions go through wx(). */
function syncWorld(w: World, s: State, ghosts: Ghost[], clock: number) {
  const { dummy } = w;
  // palms slide past, recycled by distance
  const total = TREES_PER_SIDE * TREE_GAP;
  for (let i = 0; i < TREES_PER_SIDE * 2; i++) {
    const side = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    const z = ((k * TREE_GAP - s.dist) % total + total) % total - 8;
    const x = side * (ROAD_W / 2 + 3.2);
    const hgt = 6.5 + ((k * 7) % 5) * 0.5;
    dummy.position.set(x, hgt / 2, z);
    dummy.scale.set(1, hgt, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    w.trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, hgt + 0.2, z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, k * 1.3, 0);
    dummy.updateMatrix();
    w.crowns.setMatrixAt(i, dummy.matrix);
  }
  w.trunks.instanceMatrix.needsUpdate = true;
  w.crowns.instanceMatrix.needsUpdate = true;
  w.roadTex.offset.y = s.dist / 9;

  // obstacles: cars and cones from small pools; knocked ones tumble off the road
  let nc = 0;
  let nk = 0;
  for (const o of s.course.obstacles) {
    const z = zOf(o, s.dist);
    if (z > SPAWN_Z || z < -15) continue;
    const t = o.hitAt === undefined ? -1 : s.time - o.hitAt;
    if (t > 1.1) continue;
    let obj: T.Object3D;
    if (o.kind === 'car') {
      const c = w.cars[nc++];
      if (!c) continue;
      c.body.color.setHSL(o.hue / 360, 0.55, 0.5);
      obj = c.group;
    } else {
      const g = w.cones[nk++];
      if (!g) continue;
      obj = g;
    }
    obj.visible = true;
    obj.position.set(wx(laneX(o.lane)), 0, z);
    obj.rotation.set(0, o.kind === 'car' ? Math.PI : 0, 0);
    if (t >= 0) {
      const side = o.id % 2 ? 1 : -1;
      obj.position.x += side * 9 * t;
      obj.position.y = 10 * t - 4 * t * t;
      obj.rotation.set(t * 7, (o.kind === 'car' ? Math.PI : 0) + t * 5, side * t * 6);
    }
  }
  for (let i = nc; i < w.cars.length; i++) w.cars[i].group.visible = false;
  for (let i = nk; i < w.cones.length; i++) w.cones[i].visible = false;

  // pickups
  let nb = 0;
  let ncoin = 0;
  let nd = 0;
  w.boxMat.color.setHSL((clock * 0.35) % 1, 0.9, 0.6);
  w.dashTex.offset.y = (clock * 2) % 1;
  for (const p of s.course.pickups) {
    const z = p.m - s.dist;
    if (p.taken || z > SPAWN_Z || z < -10) continue;
    const x = wx(laneX(p.lane));
    if (p.kind === 'box') {
      const b = w.boxes[nb++];
      if (!b) continue;
      b.visible = true;
      b.position.set(x, 1.05 + Math.sin(clock * 3 + p.lane) * 0.12, z);
      b.rotation.set(0.35, clock * 1.6 + p.lane, 0.2);
    } else if (p.kind === 'coin') {
      if (ncoin >= 48) continue;
      dummy.position.set(x, 0.75, z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(Math.PI / 2, Math.sin(clock * 4 + p.m) * 1.1, 0, 'YXZ');
      dummy.updateMatrix();
      w.coins.setMatrixAt(ncoin++, dummy.matrix);
    } else {
      const d = w.dashes[nd++];
      if (!d) continue;
      d.visible = true;
      d.position.set(x, 0.03, z);
    }
  }
  for (let i = nb; i < w.boxes.length; i++) w.boxes[i].visible = false;
  for (let i = nd; i < w.dashes.length; i++) w.dashes[i].visible = false;
  dummy.rotation.order = 'XYZ';
  w.coins.count = ncoin;
  w.coins.instanceMatrix.needsUpdate = true;

  // shells in flight
  s.shells.forEach((sh, i) => {
    const g = w.shells[i];
    if (!g) return;
    g.visible = true;
    g.position.set(wx(laneX(sh.lane)), 0, sh.p - s.dist);
    g.rotation.y = clock * 14;
  });
  for (let i = s.shells.length; i < w.shells.length; i++) w.shells[i].visible = false;

  // the player's kart
  const k = w.player;
  dressKart(k, s.balloons, s.star > 0, s.boost > 0, clock);
  const g = k.group;
  const drift = laneX(s.lane) - s.x;
  w.roll = damp(w.roll, -drift * 0.1, 10, 1 / 60);
  g.position.set(wx(s.x), 0, 0);
  g.rotation.set(0, -drift * 0.18, w.roll);
  if (s.spin > 0) g.rotation.y += (1 - s.spin / SPIN_T) ** 0.6 * Math.PI * 4;
  g.visible = !(s.safe > 0 && s.spin === 0 && Math.floor(s.safe * 14) % 2 === 1);
  if (s.out) {
    const t = Math.max(0, s.time - (s.hitBy?.hitAt ?? s.time));
    g.rotation.y += t * 9;
    g.position.y = Math.max(0, 5 * t - 5 * t * t);
    g.visible = true;
  }

  // other racers
  for (const kart of w.ghosts) kart.group.visible = false;
  for (const gh of ghosts) {
    const kart = w.ghosts[gh.seat % w.ghosts.length];
    const z = gh.d - s.dist;
    if (gh.f & F_OUT || z < -25 || z > 220) continue;
    dressKart(kart, (gh.f >> 4) & 3, !!(gh.f & F_STAR), !!(gh.f & F_BOOST), clock);
    kart.group.visible = true;
    kart.group.position.set(wx(gh.x), 0, z);
    kart.group.rotation.set(0, gh.f & F_SPIN ? clock * 14 : 0, 0);
  }
}

function dressKart(k: Kart, balloons: number, star: boolean, boost: boolean, clock: number) {
  k.balloons.forEach((b, i) => (b.visible = i < balloons));
  if (star) k.body.color.setHSL((clock * 2) % 1, 0.9, 0.55);
  else k.body.color.setHex(k.color);
  k.flames.visible = boost || star;
  if (k.flames.visible) k.flames.scale.set(1, 1, 0.8 + Math.random() * 0.5);
}

const flagsOf = (s: State) => (s.out ? F_OUT : 0) | (s.spin > 0 ? F_SPIN : 0) | (s.star > 0 ? F_STAR : 0) | (s.boost > 0 ? F_BOOST : 0) | (Math.max(0, s.balloons) << 4);

/** Keeps a fresh race for each solo round and each online round, and an idle one behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; net: boolean }>({ key: 'idle', net: false });
  if (shell.status === 'ready') current.current = { key: 'idle', net: false };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== current.current.key) current.current = { key, net: !!online };
  }
  return <Play key={current.current.key} net={current.current.net} />;
}

type Hud = { kmh: number; item: Item | null; rolling: boolean; balloons: number; coins: number; count: string | null; place: number; field: number };
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every((k) => a[k] === b[k]);
const ITEMS: Item[] = ['mushroom', 'star', 'shell'];

function Play({ net }: { net: boolean }) {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const live = net && !!online;
  const mySeat = live ? online!.seat : 0;
  const { ref, size } = useCanvas<HTMLDivElement>();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const world = useRef<World | null>(null);
  const state = useRef<State | null>(null);
  const gridLane = GRID[mySeat % GRID.length];
  if (!state.current) {
    if (!live) state.current = create();
    else if (online!.isHost) state.current = create(undefined, COUNTDOWN + LEAD, gridLane);
    else state.current = create(fallbackSeed(online!.round), WAIT, gridLane);
  }
  const netRef = useRef({ synced: !live || online!.isHost, waited: 0, ticks: 0, racers: new Map<number, Racer & { at: number }>(), ghosts: new Map<number, Ghost>() });
  const [hud, setHud] = useState<Hud>({ kmh: 0, item: null, rolling: false, balloons: BALLOONS, coins: 0, count: null, place: 1, field: 1 });
  const [flash, setFlash] = useState(0);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const pending = useRef<(-1 | 1)[]>([]);
  const itemTap = useRef(false);
  const pointer = useRef<{ x: number; y: number; id: number; gas: boolean } | null>(null);
  const outTimer = useRef(0);
  const hudTick = useRef(0);
  const clock = useRef(0);
  const labels = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host, mySeat);
    if (!w) return;
    world.current = w;
    w.resize(sizeRef.current.w, sizeRef.current.h);
    syncWorld(w, state.current!, [], 0);
    w.camera.position.set(0, CAM_Y, CAM_Z);
    w.camera.lookAt(0, 1.2, 14);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE]);

  // Online: guests send their own position, the host shares the seed, the GO time and everyone's position.
  useEffect(() => {
    if (!live) return;
    const n = netRef.current;
    const off = onlineRef.current!.onMessage((from, d) => {
      const o = onlineRef.current;
      const p = parseNet(d);
      if (!o || !p || p.round !== o.round) return;
      const at = performance.now();
      if (p.kind === 'guest') {
        if (o.isHost && from !== 0) n.racers.set(from, { seat: from, ...p.racer, at });
        return;
      }
      if (from !== 0 || o.isHost) return;
      if (!n.synced) {
        state.current = create(p.seed, p.go, GRID[o.seat % GRID.length]);
        n.synced = true;
      }
      for (const r of p.racers) if (r.seat !== o.seat) n.racers.set(r.seat, { ...r, at });
    });
    const timer = window.setInterval(() => {
      const o = onlineRef.current;
      const s = state.current;
      if (!o || !s) return;
      n.ticks++;
      const me = { d: s.dist, x: s.x, v: racing(s) ? s.speed : 0, f: flagsOf(s) };
      if (o.isHost) {
        const now = performance.now();
        const others = [...n.racers.values()].filter((r) => o.players.some((p) => p.seat === r.seat)).map((r) => ({ ...r, d: predict(r, now - r.at) }));
        o.send(hostPacket(o.round, s.course.seed, -s.time, [{ seat: o.seat, ...me }, ...others]), { fast: n.ticks % 5 !== 0 });
      } else if (n.synced) {
        o.send(guestPacket(o.round, me), { fast: !s.out && n.ticks % 5 !== 0 });
      }
    }, 100);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [live]);

  useGameLoop(
    (dt) => {
      const w = world.current;
      const s = state.current!;
      const n = netRef.current;
      const o = onlineRef.current;
      clock.current += dt;
      if (!n.synced) {
        n.waited += dt;
        if (n.waited > WAIT_FALLBACK) {
          state.current = create(fallbackSeed(o?.round ?? 0), COUNTDOWN, gridLane);
          n.synced = true;
        }
      }

      if (!s.out) {
        const steerIn = pending.current.splice(0);
        if (s.time < 0) {
          keys.pressed('left', 'right');
          if (keys.pressed('up', 'action') || steerIn.length || itemTap.current) gas(s);
        } else {
          if (keys.pressed('left')) steerIn.push(-1);
          if (keys.pressed('right')) steerIn.push(1);
          for (const d of steerIn) {
            const before = s.lane;
            steer(s, d);
            if (s.lane !== before) sfx.play('tick', 0.8);
          }
          if (keys.pressed('up', 'action') || itemTap.current) {
            const used = fireItem(s);
            if (used === 'mushroom') sfx.tone({ freq: 260, to: 900, dur: 0.3, type: 'sawtooth', vol: 0.12 });
            else if (used === 'star') sfx.play('win');
            else if (used === 'shell') sfx.tone({ freq: 700, to: 300, dur: 0.18, type: 'triangle', vol: 0.16 });
          }
        }
        itemTap.current = false;

        const ev = step(s, dt);
        if (ev.beep) sfx.tone({ freq: 440, dur: 0.16, type: 'square', vol: 0.14 });
        if (ev.go) sfx.tone({ freq: 880, dur: 0.4, type: 'square', vol: 0.16 });
        if (ev.rocket) setToast({ id: Date.now(), text: 'rocket start!' });
        if (ev.coins) sfx.play('coin', 1 + s.coins * 0.03);
        if (ev.box) sfx.play('select', 1.2);
        if (ev.got) sfx.play('blip', 1.5);
        if (ev.dash) sfx.tone({ freq: 380, to: 1200, dur: 0.22, type: 'triangle', vol: 0.14 });
        if (ev.smash.length) sfx.play('hit', 1.4);
        if (ev.hit && w) {
          sfx.play('boom');
          sfx.play('hit', 0.6);
          w.shake = 0.6;
          setFlash(Date.now());
        }
        if (ev.out) {
          sfx.play('lose');
          outTimer.current = 1.3;
        }
      } else if (outTimer.current > 0) {
        s.time += dt;
        outTimer.current -= dt;
        if (outTimer.current <= 0) shell.gameOver(score(s), { title: 'Out of Balloons', detail: `${score(s)} m down Palm Drive.` });
      }
      pending.current.length = 0;
      itemTap.current = false;

      // other racers, eased toward where the network says they are
      const now = performance.now();
      const shown: Ghost[] = [];
      const others: number[] = [];
      if (live && o) {
        for (const r of n.racers.values()) {
          if (r.seat === o.seat || !o.players.some((p) => p.seat === r.seat)) continue;
          const d = predict(r, now - r.at);
          others.push(d);
          let gh = n.ghosts.get(r.seat);
          if (!gh || Math.abs(gh.d - d) > 40) {
            gh = { seat: r.seat, d, x: r.x, f: r.f };
            n.ghosts.set(r.seat, gh);
          }
          gh.d = damp(gh.d, d, 12, dt);
          gh.x = damp(gh.x, r.x, 12, dt);
          gh.f = r.f;
          shown.push(gh);
        }
      }

      if (w) {
        syncWorld(w, s, shown, clock.current);
        w.shake = Math.max(0, w.shake - dt);
        const sh = w.shake * 0.5;
        const cam = w.camera;
        const cx = damp(cam.position.x, wx(s.x) * 0.6, 6, dt);
        cam.position.set(cx + (Math.random() - 0.5) * sh, CAM_Y + (Math.random() - 0.5) * sh, CAM_Z);
        cam.lookAt(wx(s.x) * 0.3, 1.2, 14);
        const fov = w.fov + (s.boost > 0 ? 9 : s.star > 0 ? 5 : 0);
        if (Math.abs(cam.fov - fov) > 0.05) {
          cam.fov = damp(cam.fov, fov, 5, dt);
          cam.updateProjectionMatrix();
        }
        // name tags over the other karts
        const { w: vw, h: vh } = sizeRef.current;
        for (const [seat, el] of labels.current) {
          const gh = shown.find((g) => g.seat === seat);
          const z = gh ? gh.d - s.dist : -1;
          if (!gh || gh.f & F_OUT || z < 2 || z > 160) {
            el.style.opacity = '0';
            continue;
          }
          const v = w.v.set(wx(gh.x), 2.9, z).project(cam);
          el.style.opacity = '1';
          el.style.transform = `translate(${((v.x + 1) / 2) * vw}px, ${((1 - v.y) / 2) * vh}px) translate(-50%, -100%)`;
        }
      }

      hudTick.current -= dt;
      if (hudTick.current <= 0) {
        hudTick.current = 1 / 15;
        const count = !n.synced ? 'wait' : s.time < -COUNTDOWN ? 'ready' : s.time < 0 ? String(Math.ceil(-s.time)) : s.time < 0.8 ? 'go!' : null;
        const next: Hud = {
          kmh: kmh(s),
          item: s.roll > 0 ? ITEMS[Math.floor(clock.current * 14) % ITEMS.length] : s.item,
          rolling: s.roll > 0,
          balloons: s.balloons,
          coins: s.coins,
          count,
          place: placeOf(s.dist, others),
          field: 1 + others.length,
        };
        setHud((h) => (sameHud(h, next) ? h : next));
        if (!s.out) shell.setScore(score(s));
      }
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (shell.status !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const s = state.current!;
    const early = s.time < 0;
    if (early) gas(s);
    pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId, gas: early };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = null;
    if (p.gas) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) pending.current.push(dx < 0 ? -1 : 1);
    else if (Math.abs(dx) <= 24 && Math.abs(dy) <= 24) {
      const rect = e.currentTarget.getBoundingClientRect();
      pending.current.push(e.clientX < rect.left + rect.width / 2 ? -1 : 1);
    }
  };

  const playing = shell.status === 'playing';
  const racers = live ? online!.players.filter((p) => p.seat !== online!.seat) : [];
  return (
    <>
      <div
        ref={ref}
        className="g-palmdrive-host"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointer.current = null)}
      />
      {racers.map((p) => (
        <div
          key={p.seat}
          ref={(el) => {
            if (el) labels.current.set(p.seat, el);
            else labels.current.delete(p.seat);
          }}
          className="g-palmdrive-tag"
          style={{ background: KART_COLORS[p.seat % KART_COLORS.length], opacity: 0 }}
        >
          {p.name}
        </div>
      ))}
      {shell.status !== 'ready' && (
        <>
          {!state.current!.out && hud.kmh > 0 && <div className={`g-palmdrive-hud${live ? ' is-online' : ''}`}>{hud.kmh} km/h</div>}
          {!shell.compact && (
            <div className="g-palmdrive-stats" aria-label={`${hud.balloons} balloons, ${hud.coins} coins`}>
              <span className="g-palmdrive-balloons">
                {Array.from({ length: BALLOONS }, (_, i) => (
                  <Balloon key={i} color={KART_COLORS[mySeat % KART_COLORS.length]} popped={i >= hud.balloons} />
                ))}
              </span>
              <span className="g-palmdrive-coins">
                <CoinIcon />
                {hud.coins}
              </span>
            </div>
          )}
          {!shell.compact && (
            <button
              type="button"
              tabIndex={-1}
              className={`g-palmdrive-item${shell.touch ? ' is-touch' : ''}${hud.rolling ? ' is-rolling' : ''}${hud.item && !hud.rolling ? ' is-ready' : ''}`}
              aria-label={hud.item && !hud.rolling ? `Use ${hud.item}` : 'No item'}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                if (playing) itemTap.current = true;
              }}
            >
              {hud.item ? <ItemIcon item={hud.item} /> : <span className="g-palmdrive-item-empty">?</span>}
            </button>
          )}
          {live && hud.field > 1 && (
            <div className="g-palmdrive-place">
              <b>{ordinal(hud.place)}</b>
              <span>/ {hud.field}</span>
            </div>
          )}
          {hud.count && (
            <div key={hud.count} className={`g-palmdrive-count${hud.count === 'go!' ? ' is-go' : ''}${hud.count === 'wait' || hud.count === 'ready' ? ' is-note' : ''}`}>
              {hud.count === 'wait' ? 'waiting for the host' : hud.count === 'ready' ? 'get ready' : hud.count}
            </div>
          )}
          {toast && (
            <div key={toast.id} className="g-palmdrive-toast" onAnimationEnd={() => setToast(null)}>
              {toast.text}
            </div>
          )}
        </>
      )}
      {flash > 0 && <div key={flash} className="g-palmdrive-crash" />}
      {shell.touch && playing && state.current!.time >= 0 && state.current!.dist < 60 && (
        <div className="g-palmdrive-zones" aria-hidden="true">
          <span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </span>
          <span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      )}
    </>
  );
}

const Svg = ({ children, size = 30 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {children}
  </svg>
);

function ItemIcon({ item }: { item: Item }) {
  if (item === 'mushroom')
    return (
      <Svg>
        <path d="M2.5 12.5a9.5 8.5 0 0 1 19 0z" fill="#e53935" stroke="#7a1512" strokeWidth="1" />
        <circle cx="8" cy="8.2" r="2" fill="#fff" />
        <circle cx="15.5" cy="7.6" r="2.4" fill="#fff" />
        <circle cx="12" cy="11" r="1.3" fill="#fff" />
        <rect x="7.5" y="12.5" width="9" height="8" rx="2.5" fill="#f6e7cf" stroke="#9a7f5c" strokeWidth="1" />
        <rect x="10" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
        <rect x="12.8" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
      </Svg>
    );
  if (item === 'star')
    return (
      <Svg>
        <path d="M12 2l2.9 6.6 7.1.7-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.3l7.1-.7z" fill="#ffd23f" stroke="#c98a00" strokeWidth="1.2" strokeLinejoin="round" />
        <rect x="9.6" y="9.5" width="1.3" height="3" rx="0.6" fill="#222" />
        <rect x="13.1" y="9.5" width="1.3" height="3" rx="0.6" fill="#222" />
      </Svg>
    );
  return (
    <Svg>
      <ellipse cx="12" cy="16.5" rx="9.5" ry="3.6" fill="#fff" stroke="#9aa" strokeWidth="1" />
      <path d="M3.5 15.5a8.5 9 0 0 1 17 0z" fill="#2fae4e" stroke="#16632a" strokeWidth="1" />
      <path d="M8 15l1.2-5.2h5.6L16 15M12 6.6v3.2" fill="none" stroke="#c9f2d2" strokeWidth="1.3" strokeLinejoin="round" />
    </Svg>
  );
}

const Balloon = ({ color, popped }: { color: string; popped: boolean }) => (
  <span className={popped ? 'is-popped' : undefined}>
    <Svg size={20}>
      <ellipse cx="12" cy="9.5" rx="6.5" ry="7.5" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <ellipse cx="9.6" cy="6.8" rx="1.6" ry="2.4" fill="rgba(255,255,255,0.55)" />
      <path d="M12 17l-1.3 1.6h2.6zM12 18.6q-1.6 2.4 0 4.6" fill={color} stroke="rgba(255,255,255,0.85)" strokeWidth="1" />
    </Svg>
  </span>
);

const CoinIcon = () => (
  <Svg size={18}>
    <circle cx="12" cy="12" r="9" fill="#f7c948" stroke="#b9860f" strokeWidth="1.6" />
    <rect x="10.4" y="6.5" width="3.2" height="11" rx="1.6" fill="#fff3c4" stroke="#b9860f" strokeWidth="1" />
  </Svg>
);
