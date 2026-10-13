// Each course's look and scenery: the colors of its grass, curbs and walls, and the landmarks, trees and water
// around it. buildView (scene.ts) lays the road and walls and then hands a course's builder here the scene to fill.
import type { T } from './gl';
import type { CourseId } from './courses';
import { LANDMARKS, fromMap, headingOf, locate, pointAt, type Track } from './track';
import type { Race } from './logic';

export type Three = typeof import('three');

/** Deterministic scatter for scenery, so campus looks the same every visit. */
export function scatter(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

export function texture(THREE: Three, c: HTMLCanvasElement, repeat?: [number, number]) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

export const noise = (g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, light = true) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
};

function frondGeometry(THREE: Three) {
  // seven drooping blades radiating from the crown
  const pos: number[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const len = 2.8;
    const tip = [dx * len, -1, dz * len];
    const mid = [dx * len * 0.5, 0.25, dz * len * 0.5];
    const w = 0.45;
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

/** Memorial Church with its gold mosaic, framed by the Main Quad arcades. The facade faces south. */
function makeChurch(THREE: Three, box: T.BoxGeometry) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd9b98a });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  const gold = new THREE.MeshLambertMaterial({ color: 0xe6c36a, emissive: 0x3a2a00 });
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
  // long arcade wings either side, with their row of arches
  for (const side of [-1, 1]) {
    mesh(box, stone, side * 30, 4, 8, 34, 8, 10);
    mesh(roof, tile, side * 30, 9.2, 8, 27, 2.6, 9, Math.PI / 4);
    for (let a = 0; a < 7; a++) mesh(box, shadow, side * (16 + a * 4.4), 2.6, 2.9, 2.6, 4, 0.3);
  }
  mesh(box, stone, 0, 8, 14, 22, 16, 30);
  mesh(roof, tile, 0, 19.5, 14, 17, 7, 24, Math.PI / 4);
  mesh(box, stone, 0, 9.5, -2, 26, 19, 3);
  mesh(roof, stone, 0, 22, -2, 19, 6, 2.2, Math.PI / 4);
  mesh(box, gold, 0, 13.5, -3.7, 18, 7.5, 0.4);
  for (const x of [-6, 0, 6]) mesh(box, shadow, x, 4, -3.7, 3.4, 6.5, 0.4);
  mesh(new THREE.CylinderGeometry(6, 6, 6, 8), stone, 0, 26, 22);
  mesh(new THREE.SphereGeometry(6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tile, 0, 29, 22);
  return g;
}

/** Hoover Tower: a tall sandstone shaft, the open belfry and the red dome. */
function makeHoover(THREE: Three, box: T.BoxGeometry) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe0c49a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  const add = (geo: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    g.add(o);
  };
  add(box, stone, 0, 6, 0, 16, 12, 16);
  add(box, stone, 0, 26, 0, 10, 40, 10);
  for (const [x, z, sx, sz] of [[0, 5.05, 7, 0.2], [0, -5.05, 7, 0.2], [5.05, 0, 0.2, 7], [-5.05, 0, 0.2, 7]]) add(box, dark, x, 48, z, sx, 6, sz);
  add(box, stone, 0, 51.5, 0, 10.6, 1.2, 10.6);
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), tile, 0, 52, 0, 4.6, 5.5, 4.6);
  add(box, stone, 0, 58.5, 0, 1.2, 2.5, 1.2);
  return g;
}

/** A sandstone campus building with a red tile hip roof. */
function makeHall(THREE: Three, box: T.BoxGeometry, roof: T.BufferGeometry, mats: { stone: T.Material; tile: T.Material; dark: T.Material }, w: number, d: number, h: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(box, mats.stone);
  body.scale.set(w, h, d);
  body.position.y = h / 2;
  const top = new THREE.Mesh(roof, mats.tile);
  top.scale.set(w * 0.72, 4, d * 0.72);
  top.rotation.y = Math.PI / 4;
  top.position.y = h + 2;
  g.add(body, top);
  for (let x = -w / 2 + 3; x <= w / 2 - 3; x += 4) {
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(box, mats.dark);
      win.scale.set(1.6, h * 0.4, 0.2);
      win.position.set(x, h * 0.5, (side * d) / 2);
      g.add(win);
    }
  }
  return g;
}

/** Each course's colors: light, grass, curbs, walls and the banner over the start. */
export type Look = {
  fog: [number, number, number];
  sky: number;
  ground: number;
  sun: [number, number];
  field: string;
  lawn: string;
  curb: [string, string];
  wall: string;
  band: string;
  banner: string;
  /** The road surface: asphalt, or dirt out at the barn. */
  road: string;
};
export const LOOKS: Record<CourseId, Look> = {
  palm: { fog: [0xf3d6b4, 140, 720], sky: 0xfff3df, ground: 0x6e8a4a, sun: [0xffe4bd, 1.5], field: '#c4b468', lawn: '#6fa94e', curb: ['#f4f1ea', '#d23a2e'], wall: '#e6cfa6', band: '#8c1515', banner: 'PALM DRIVE', road: '#4a4a52' },
  lake: { fog: [0xeeb08e, 120, 640], sky: 0xffd8c2, ground: 0x5d6b4a, sun: [0xffb07a, 1.4], field: '#b8a862', lawn: '#79a85a', curb: ['#f4f1ea', '#2f6fb5'], wall: '#b98b5e', band: '#2f6fb5', banner: 'LAKE LAGUNITA', road: '#4a4a52' },
  barn: { fog: [0xe9e4cf, 150, 720], sky: 0xfff4dd, ground: 0x6b7a44, sun: [0xfff0d0, 1.5], field: '#c9b26a', lawn: '#88ad59', curb: ['#efe6cf', '#9a3a28'], wall: '#f3efe4', band: '#9a3a28', banner: 'RED BARN', road: '#8f6f4d' },
};

/** What a course's scenery builder gets: the scene, the track and shared helpers. */
export type Scenery = {
  THREE: Three;
  scene: T.Scene;
  t: Track;
  r: Race;
  geo: { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; ring: T.TorusGeometry; cone: T.ConeGeometry; plane: T.PlaneGeometry; roof: T.CylinderGeometry };
  mats: { stone: T.MeshLambertMaterial; tile: T.MeshLambertMaterial; dark: T.MeshLambertMaterial };
  rand: () => number;
  /** True when (x, z) is at least `margin` outside the walls of every stretch of road. */
  clear: (x: number, z: number, margin: number) => boolean;
  dummy: T.Object3D;
};

/** Palm Drive: palms down the drive and round the Oval, the Arboretum, Memorial Church, Hoover Tower, the Dish. */
function campus(c: Scenery) {
  const { THREE, scene, t, r, geo, mats, rand, clear, dummy } = c;
  // palms: down both sides of Palm Drive and around the Oval
  const palms: { x: number; z: number; hgt: number }[] = [];
  const [pd0, pd1] = r.lay.palmDrive ?? [0, 0];
  const pdLen = (pd1 - pd0 + t.length) % t.length;
  for (let a = 0; a < pdLen; a += 11) {
    for (const side of [-1, 1]) {
      const p = pointAt(t, pd0 + a, side * (t.edge + 2.6));
      if (clear(p.x, p.z, 1.5)) palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
    }
  }
  const oval = LANDMARKS.oval;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
    const x = oval.x + Math.cos(a) * (oval.rx + 3);
    const z = oval.z + Math.sin(a) * (oval.rz + 3);
    if (clear(x, z, 1.5)) palms.push({ x, z, hgt: 8 + rand() * 3 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), palms.length);
  const crowns = new THREE.InstancedMesh(frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), palms.length);
  palms.forEach((p, i) => {
    dummy.position.set(p.x, p.hgt / 2, p.z);
    dummy.scale.set(1, p.hgt, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, p.hgt + 0.2, p.z);
    dummy.scale.set(1.1, 1.1, 1.1);
    dummy.rotation.set(0, i * 1.3, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunks, crowns);

  // oaks and eucalyptus in the Arboretum, east of Palm Drive
  const oaks: { x: number; z: number; r: number }[] = [];
  for (let n = 0; oaks.length < 110 && n < 2000; n++) {
    const x = -20 - rand() * 170;
    const z = -260 + rand() * 300;
    const near = [LANDMARKS.cantor, LANDMARKS.hoover].some((b) => Math.hypot(b.x - x, b.z - z) < 24);
    if (!near && clear(x, z, 3.5)) oaks.push({ x, z, r: 2.2 + rand() * 2.2 });
  }
  for (let n = 0; oaks.length < 170 && n < 3000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 150 + rand() * 260;
    const x = -20 + Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    if (clear(x, z, 4) && Math.hypot(x - LANDMARKS.church.x, z - LANDMARKS.church.z) > 60) oaks.push({ x, z, r: 2.5 + rand() * 3 });
  }
  const oakTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6b4f37 }), oaks.length);
  const oakTop = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color: 0x4f7d3a, flatShading: true }), oaks.length);
  oaks.forEach((o, i) => {
    dummy.rotation.set(0, i, 0);
    dummy.position.set(o.x, o.r * 0.6, o.z);
    dummy.scale.set(1, o.r * 1.2, 1);
    dummy.updateMatrix();
    oakTrunk.setMatrixAt(i, dummy.matrix);
    dummy.position.set(o.x, o.r * 1.5, o.z);
    dummy.scale.set(o.r * 1.15, o.r * 0.9, o.r * 1.15);
    dummy.updateMatrix();
    oakTop.setMatrixAt(i, dummy.matrix);
  });
  scene.add(oakTrunk, oakTop);

  // landmarks
  const church = makeChurch(THREE, geo.box);
  church.position.set(LANDMARKS.church.x, 0, LANDMARKS.church.z);
  church.scale.setScalar(1.25);
  scene.add(church);
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(LANDMARKS.hoover.x, 0, LANDMARKS.hoover.z);
  scene.add(hoover);
  const cantor = makeHall(THREE, geo.box, geo.roof, mats, 30, 16, 11);
  cantor.position.set(LANDMARKS.cantor.x, 0, LANDMARKS.cantor.z);
  cantor.rotation.y = Math.PI / 2;
  scene.add(cantor);
  for (const [x, z, w, d, h, ry] of [
    [70, 150, 26, 14, 10, 0.2],
    [-70, 175, 30, 14, 12, -0.1],
    [60, 60, 24, 12, 9, Math.PI / 2],
    [-120, 215, 26, 16, 12, 0.3],
    [95, 230, 28, 14, 12, -0.2],
    [-150, -60, 22, 12, 9, 1.2],
  ]) {
    if (!clear(x, z, Math.max(w, d) / 2 + 2)) continue;
    const hall = makeHall(THREE, geo.box, geo.roof, mats, w, d, h);
    hall.position.set(x, 0, z);
    hall.rotation.y = ry;
    scene.add(hall);
  }

  // the Oval lawn with its big red S
  {
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ color: 0x8fca62 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.scale.set(oval.rx, oval.rz, 1);
    lawn.position.set(oval.x, 0.03, oval.z);
    scene.add(lawn);
    const letter = texture(
      THREE,
      canvas(256, 256, (g) => {
        g.fillStyle = '#8c1515';
        g.font = 'bold 230px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('S', 128, 140);
      }),
    );
    const s = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: letter, transparent: true, depthWrite: false }));
    s.rotation.x = -Math.PI / 2;
    // read the right way round from the Palm Drive end: canvas top toward the church
    s.rotation.z = Math.PI;
    s.scale.set(24, 24, 1);
    s.position.set(oval.x, 0.05, oval.z);
    scene.add(s);
  }

  // golden foothills all round, and the Dish up on one of them
  const hillMat = new THREE.MeshLambertMaterial({ color: 0xc8b06a, flatShading: true });
  const hillGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
    const dist = 560 + rand() * 160;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(-20 + Math.cos(a) * dist, -4, Math.sin(a) * dist);
    hill.scale.set(110 + rand() * 90, 40 + rand() * 70, 110 + rand() * 90);
    scene.add(hill);
  }
  {
    const dish = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide });
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(14, 18, 8, 0, Math.PI * 2, 0, 0.9), white);
    bowl.rotation.x = -2.2;
    bowl.position.y = 26;
    const stand = new THREE.Mesh(geo.box, white);
    stand.scale.set(4, 22, 4);
    stand.position.y = 11;
    dish.add(bowl, stand);
    dish.position.set(LANDMARKS.dish.x, 20, LANDMARKS.dish.z);
    scene.add(dish);
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(LANDMARKS.dish.x, -6, LANDMARKS.dish.z);
    hill.scale.set(120, 30, 120);
    scene.add(hill);
  }
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false }));
  sunDisc.position.set(320, 230, -900);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
}

/** Whether (x, z) is inside the loop the centerline makes. */
function insideLoop(t: Track, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = t.n - 1; i < t.n; j = i++) {
    const zi = t.z[i];
    const zj = t.z[j];
    if (zi > z !== zj > z && x < ((t.x[j] - t.x[i]) * (z - zi)) / (zj - zi) + t.x[i]) inside = !inside;
  }
  return inside;
}

/** Instanced meshes from a list of transforms. */
function instances(THREE: Three, scene: T.Scene, dummy: T.Object3D, geo: T.BufferGeometry, mat: T.Material, items: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number }[]) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z);
    dummy.scale.set(it.sx, it.sy, it.sz);
    dummy.rotation.set(it.rx ?? 0, it.ry ?? 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  scene.add(mesh);
}

/** Oaks scattered where there is room. */
function oaks(c: Scenery, spots: { x: number; z: number; r: number }[]) {
  const { THREE, scene, dummy } = c;
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.3, 0.45, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6b4f37 }), spots.map((o, i) => ({ x: o.x, y: o.r * 0.6, z: o.z, sx: 1, sy: o.r * 1.2, sz: 1, ry: i })));
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color: 0x4f7d3a, flatShading: true }), spots.map((o, i) => ({ x: o.x, y: o.r * 1.5, z: o.z, sx: o.r * 1.15, sy: o.r * 0.9, sz: o.r * 1.15, ry: i })));
}

/** Golden foothills in a ring at `dist` around (cx, cz), with the Dish on one of them. */
function foothills(c: Scenery, cx: number, cz: number, dish: { x: number; z: number }) {
  const { THREE, scene, geo, rand } = c;
  const hillMat = new THREE.MeshLambertMaterial({ color: 0xc8b06a, flatShading: true });
  const hillGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
    const dist = 560 + rand() * 160;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(cx + Math.cos(a) * dist, -4, cz + Math.sin(a) * dist);
    hill.scale.set(110 + rand() * 90, 40 + rand() * 70, 110 + rand() * 90);
    scene.add(hill);
  }
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide });
  const d = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(14, 18, 8, 0, Math.PI * 2, 0, 0.9), white);
  bowl.rotation.x = -2.2;
  bowl.position.y = 26;
  const stand = new THREE.Mesh(geo.box, white);
  stand.scale.set(4, 22, 4);
  stand.position.y = 11;
  d.add(bowl, stand);
  d.position.set(dish.x, 20, dish.z);
  scene.add(d);
  const hill = new THREE.Mesh(hillGeo, hillMat);
  hill.position.set(dish.x, -6, dish.z);
  hill.scale.set(120, 30, 120);
  scene.add(hill);
}

/**
 * Lake Lagunita: water fills the loop, reeds and lily pads line the shore, sailboats and ducks are out on the water,
 * the boathouse stands on its peninsula inside the hairpin, oaks and foothills all round, and the sun is going down.
 */
function lake(c: Scenery) {
  const { THREE, scene, t, geo, mats, rand, clear, dummy } = c;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < t.n; i++) {
    minX = Math.min(minX, t.x[i]);
    maxX = Math.max(maxX, t.x[i]);
    minZ = Math.min(minZ, t.z[i]);
    maxZ = Math.max(maxZ, t.z[i]);
    cx += t.x[i] / t.n;
    cz += t.z[i] / t.n;
  }
  // The water is many small tiles rather than a few huge triangles (see the ground), each kept if its middle is
  // inside the loop; the walls and lawn along the shore hide the ragged edge.
  const CELL = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let x = minX; x < maxX; x += CELL) {
    for (let z = minZ; z < maxZ; z += CELL) {
      if (!insideLoop(t, x + CELL / 2, z + CELL / 2)) continue;
      // wound so the tiles face up (+y)
      const q = [x, z, x, z + CELL, x + CELL, z + CELL, x, z, x + CELL, z + CELL, x + CELL, z];
      for (let k = 0; k < q.length; k += 2) {
        pos.push(q[k], -0.01, q[k + 1]);
        uv.push(q[k] / 20, q[k + 1] / 20);
      }
    }
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  waterGeo.computeVertexNormals();
  const ripples = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#4a7db0';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,225,200,0.22)';
      g.lineWidth = 2;
      for (let k = 0; k < 16; k++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 9, y - 3, x + 18, y);
        g.stroke();
      }
    }),
  );
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({ map: ripples })));

  // reeds and cattails in clumps along the shore, and lily pads just off it
  const reeds: Parameters<typeof instances>[5] = [];
  const tops: Parameters<typeof instances>[5] = [];
  const pads: Parameters<typeof instances>[5] = [];
  const flowers: Parameters<typeof instances>[5] = [];
  for (let s = 0; s < t.length; s += 3.5) {
    if (rand() < 0.45) continue;
    const p = pointAt(t, s, -(t.edge + 1.2 + rand() * 3));
    if (!clear(p.x, p.z, 0.8) || !insideLoop(t, p.x, p.z)) continue;
    for (let k = 0; k < 3 + Math.floor(rand() * 4); k++) {
      const x = p.x + (rand() - 0.5) * 2.2;
      const z = p.z + (rand() - 0.5) * 2.2;
      const h = 1.3 + rand() * 1.4;
      reeds.push({ x, y: h / 2, z, sx: 0.09, sy: h, sz: 0.09, rx: (rand() - 0.5) * 0.25 });
      if (rand() < 0.4) tops.push({ x, y: h * 0.92, z, sx: 0.12, sy: 0.4, sz: 0.12 });
    }
    if (rand() < 0.35) {
      const q = pointAt(t, s, -(t.edge + 5 + rand() * 9));
      if (clear(q.x, q.z, 1) && insideLoop(t, q.x, q.z)) {
        const size = 0.7 + rand() * 0.6;
        pads.push({ x: q.x, y: 0.01, z: q.z, sx: size, sy: size, sz: size, rx: -Math.PI / 2 });
        if (rand() < 0.3) flowers.push({ x: q.x + 0.2, y: 0.12, z: q.z, sx: 0.22, sy: 0.16, sz: 0.22 });
      }
    }
  }
  instances(THREE, scene, dummy, new THREE.ConeGeometry(1, 1, 4), new THREE.MeshLambertMaterial({ color: 0x5f7f3a }), reeds);
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial({ color: 0x5a3b22 }), tops);
  instances(THREE, scene, dummy, new THREE.CircleGeometry(1, 10), new THREE.MeshLambertMaterial({ color: 0x4f8f3f, side: THREE.DoubleSide }), pads);
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xf6a8c8 }), flowers);

  // somewhere out on the open water, well clear of the road
  const onWater = (margin: number) => {
    for (let n = 0; n < 400; n++) {
      const x = minX + rand() * (maxX - minX);
      const z = minZ + rand() * (maxZ - minZ);
      if (insideLoop(t, x, z) && clear(x, z, margin)) return { x, z };
    }
    return null;
  };
  // sailboats with cardinal and white sails
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  sail.computeVertexNormals();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf4f1ea });
  const mastMat = new THREE.MeshLambertMaterial({ color: 0x3e3128 });
  const sailMats = [new THREE.MeshLambertMaterial({ color: 0xfafafa, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: 0xb1282a, side: THREE.DoubleSide })];
  for (let b = 0; b < 6; b++) {
    const at = onWater(10);
    if (!at) break;
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(geo.box, hullMat);
    hull.scale.set(1.4, 0.7, 3.6);
    hull.position.y = 0.3;
    const mast = new THREE.Mesh(geo.box, mastMat);
    mast.scale.set(0.12, 5.2, 0.12);
    mast.position.set(0, 3, 0.4);
    const sl = new THREE.Mesh(sail, sailMats[b % 2]);
    sl.scale.set(1, 4.6, -2.6);
    sl.position.set(0.05, 0.9, 0.35);
    boat.add(hull, mast, sl);
    boat.position.set(at.x, 0, at.z);
    boat.rotation.y = rand() * Math.PI * 2;
    scene.add(boat);
  }
  // mallards paddling about
  const duck = { body: new THREE.MeshLambertMaterial({ color: 0x8a6a4a }), head: new THREE.MeshLambertMaterial({ color: 0x2f7d4a }), beak: new THREE.MeshLambertMaterial({ color: 0xf2a531 }) };
  for (let n = 0; n < 12; n++) {
    const at = onWater(3);
    if (!at) break;
    const d = new THREE.Group();
    const body = new THREE.Mesh(geo.ball, duck.body);
    body.scale.set(0.32, 0.22, 0.48);
    body.position.y = 0.12;
    const head = new THREE.Mesh(geo.ball, duck.head);
    head.scale.setScalar(0.17);
    head.position.set(0, 0.38, 0.36);
    const beak = new THREE.Mesh(geo.cone, duck.beak);
    beak.scale.set(0.06, 0.16, 0.06);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.36, 0.55);
    d.add(body, head, beak);
    d.position.set(at.x, 0, at.z);
    d.rotation.y = rand() * Math.PI * 2;
    scene.add(d);
  }

  // the boathouse at the middle of the hairpin, on the peninsula it wraps around
  let apex = 0;
  for (let i = 0; i < t.n; i++) if (t.curv[i] > t.curv[apex]) apex = i;
  const mid = pointAt(t, apex * t.step, 1 / t.curv[apex]);
  if (clear(mid.x, mid.z, 3)) {
    const wood = new THREE.MeshLambertMaterial({ color: 0x9c6b43 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2f5d3a });
    const house = makeHall(THREE, geo.box, geo.roof, { stone: wood, tile: roofMat, dark: mats.dark }, 8, 6, 4.5);
    house.position.set(mid.x, 0, mid.z);
    house.rotation.y = headingOf(mid.tx, mid.tz);
    scene.add(house);
    const pole = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.scale.set(0.15, 9, 0.15);
    pole.position.set(mid.x + 5, 4.5, mid.z);
    const flag = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0x8c1515 }));
    flag.scale.set(0.05, 1.2, 2);
    flag.position.set(mid.x + 5, 8.2, mid.z + 1);
    scene.add(pole, flag);
  }

  // oaks all round outside the loop, and a row of palms behind the dam
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 170 && n < 4000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 40 + rand() * 420;
    const x = cx + Math.cos(a) * ((maxX - minX) / 2 + dist);
    const z = cz + Math.sin(a) * ((maxZ - minZ) / 2 + dist);
    if (!insideLoop(t, x, z) && clear(x, z, 4)) spots.push({ x, z, r: 2.4 + rand() * 2.8 });
  }
  oaks(c, spots);
  const palms: { x: number; z: number; hgt: number }[] = [];
  for (let s = 0; s < 120; s += 12) {
    const p = pointAt(t, s - 40, t.edge + 3);
    if (clear(p.x, p.z, 1.5)) palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), palms.map((p) => ({ x: p.x, y: p.hgt / 2, z: p.z, sx: 1, sy: p.hgt, sz: 1 })));
  instances(THREE, scene, dummy, frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), palms.map((p, i) => ({ x: p.x, y: p.hgt + 0.2, z: p.z, sx: 1.1, sy: 1.1, sz: 1.1, ry: i * 1.3 })));

  // foothills and the Dish, Hoover Tower off across campus, and the sun going down in the west (+x)
  foothills(c, cx, cz, { x: cx + 160, z: cz - 420 });
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(cx - 260, 0, cz + 330);
  hoover.scale.setScalar(1.4);
  scene.add(hoover);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(46, 40), new THREE.MeshBasicMaterial({ color: 0xffa45c, fog: false }));
  sunDisc.position.set(cx + 820, 70, cz + 120);
  sunDisc.lookAt(cx, 0, cz);
  const glow = new THREE.Mesh(new THREE.RingGeometry(46, 96, 40), new THREE.MeshBasicMaterial({ color: 0xffc58a, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
  glow.position.copy(sunDisc.position);
  glow.lookAt(cx, 0, cz);
  scene.add(sunDisc, glow);
}

/** The middle and extent of a course's loop. */
function bounds(t: Track) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) {
    minX = Math.min(minX, t.x[i]);
    maxX = Math.max(maxX, t.x[i]);
    minZ = Math.min(minZ, t.z[i]);
    maxZ = Math.max(maxZ, t.z[i]);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, rx: (maxX - minX) / 2, rz: (maxZ - minZ) / 2 };
}

/** The spot within `radius` of p that is furthest from any road, and how far that is from the centerline. */
function roomiest(t: Track, p: { x: number; z: number }, radius: number) {
  let best = { x: p.x, z: p.z, room: Math.abs(locate(t, p.x, p.z).d) };
  for (let dx = -radius; dx <= radius; dx += 3) {
    for (let dz = -radius; dz <= radius; dz += 3) {
      const x = p.x + dx;
      const z = p.z + dz;
      const room = Math.abs(locate(t, x, z).d);
      if (room > best.room) best = { x, z, room };
    }
  }
  return best;
}

/** A white post-and-rail fence round a w by d rectangle centered at (x, z), turned ry. */
function paddock(c: Scenery, x: number, z: number, w: number, d: number, ry: number, mat: T.Material) {
  const { THREE, scene, geo } = c;
  const g = new THREE.Group();
  for (const [len, px, pz, rot] of [[w, 0, d / 2, 0], [w, 0, -d / 2, 0], [d, w / 2, 0, Math.PI / 2], [d, -w / 2, 0, Math.PI / 2]] as const) {
    for (const y of [0.55, 1.1]) {
      const rail = new THREE.Mesh(geo.box, mat);
      rail.scale.set(len, 0.14, 0.08);
      rail.position.set(px, y, pz);
      rail.rotation.y = rot;
      g.add(rail);
    }
    for (let k = -len / 2; k <= len / 2 + 0.01; k += 3) {
      const post = new THREE.Mesh(geo.box, mat);
      post.scale.set(0.18, 1.35, 0.18);
      post.position.set(rot ? px : px + k, 0.67, rot ? pz + k : pz);
      g.add(post);
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
}

/** A horse, grazing or with its head up. */
function horse(c: Scenery, x: number, z: number, ry: number, coat: T.Material, mane: T.Material, grazing: boolean) {
  const { THREE, scene, geo } = c;
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.box, coat);
  body.scale.set(0.8, 0.85, 2);
  body.position.y = 1.45;
  g.add(body);
  for (const [lx, lz] of [[-0.28, 0.75], [0.28, 0.75], [-0.28, -0.75], [0.28, -0.75]]) {
    const leg = new THREE.Mesh(geo.box, coat);
    leg.scale.set(0.18, 1.1, 0.2);
    leg.position.set(lx, 0.55, lz);
    g.add(leg);
  }
  const neck = new THREE.Group();
  const n = new THREE.Mesh(geo.box, coat);
  n.scale.set(0.38, 1.1, 0.5);
  n.position.y = 0.5;
  const head = new THREE.Mesh(geo.box, coat);
  head.scale.set(0.34, 0.36, 0.8);
  head.position.set(0, 1.05, 0.25);
  const m = new THREE.Mesh(geo.box, mane);
  m.scale.set(0.12, 1.1, 0.2);
  m.position.set(0, 0.55, -0.22);
  neck.add(n, head, m);
  neck.position.set(0, 1.6, 0.95);
  neck.rotation.x = grazing ? 2.2 : 0.35;
  const tail = new THREE.Mesh(geo.box, mane);
  tail.scale.set(0.14, 0.9, 0.14);
  tail.position.set(0, 1.25, -1.05);
  tail.rotation.x = 0.35;
  g.add(neck, tail);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
}

/**
 * The Red Barn: the big red barn and its silo along the front straight, white-railed paddocks with horses grazing,
 * the riding arena inside the hairpin, a windmill, a tractor, round bales stacked up, eucalyptus windbreaks and the
 * Dish up in the foothills.
 */
function barn(c: Scenery) {
  const { THREE, scene, t, geo, mats, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  const K = 0.9;
  const at = (e: number, n: number) => fromMap(e * K, n * K);
  const red = new THREE.MeshLambertMaterial({ color: 0xa3322a });
  const white = new THREE.MeshLambertMaterial({ color: 0xf3efe4 });
  const shingle = new THREE.MeshLambertMaterial({ color: 0x4a4646 });
  const straw = new THREE.MeshLambertMaterial({ color: 0xdcb553 });
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3);
  prism.rotateY(Math.PI / 2);
  prism.rotateZ(Math.PI / 2);

  // the barn itself, set back from the front straight and facing the road
  const front = pointAt(t, 110, -(t.edge + 24));
  const b = new THREE.Group();
  const walls = new THREE.Mesh(geo.box, red);
  walls.scale.set(24, 9, 15);
  walls.position.y = 4.5;
  const roof = new THREE.Mesh(prism, shingle);
  roof.scale.set(25, 5.5, 9.4);
  roof.position.y = 9 + 2.6;
  b.add(walls, roof);
  // white trim: corners, the big doors with their cross braces, and the hayloft door above
  for (const side of [-1, 1]) {
    const corner = new THREE.Mesh(geo.box, white);
    corner.scale.set(0.5, 9, 0.5);
    corner.position.set(side * 12, 4.5, 7.55);
    b.add(corner);
  }
  const door = new THREE.Group();
  const frame = new THREE.Mesh(geo.box, white);
  frame.scale.set(8, 6.4, 0.2);
  const panel = new THREE.Mesh(geo.box, red);
  panel.scale.set(7.2, 5.8, 0.3);
  door.add(frame, panel);
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const brace = new THREE.Mesh(geo.box, white);
      brace.scale.set(0.35, 6.6, 0.4);
      brace.position.x = side * 1.9;
      brace.rotation.z = lean * 0.55;
      door.add(brace);
    }
  }
  door.position.set(0, 3.2, 7.5);
  const loft = new THREE.Mesh(geo.box, white);
  loft.scale.set(3.2, 2.4, 0.3);
  loft.position.set(0, 8.6, 7.5);
  const loftIn = new THREE.Mesh(geo.box, mats.dark);
  loftIn.scale.set(2.6, 1.9, 0.35);
  loftIn.position.set(0, 8.6, 7.5);
  // a cupola on the ridge with a weathervane
  const cupola = new THREE.Mesh(geo.box, white);
  cupola.scale.set(2.4, 2.2, 2.4);
  cupola.position.y = 15.4;
  const cap = new THREE.Mesh(geo.roof, shingle);
  cap.scale.set(2.4, 1.6, 2.4);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 17.3;
  const vane = new THREE.Mesh(geo.box, mats.dark);
  vane.scale.set(0.08, 2, 0.08);
  vane.position.y = 18.6;
  const arrow = new THREE.Mesh(geo.box, mats.dark);
  arrow.scale.set(1.6, 0.1, 0.1);
  arrow.position.y = 19.2;
  b.add(door, loft, loftIn, cupola, cap, vane, arrow);
  b.position.set(front.x, 0, front.z);
  b.rotation.y = headingOf(-front.tz, front.tx);
  scene.add(b);

  // the silo beside it, and round bales stacked up by the door
  const siloAt = pointAt(t, 72, -(t.edge + 22));
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 18, 16), new THREE.MeshLambertMaterial({ color: 0x9fb0b6 }));
  silo.position.set(siloAt.x, 9, siloAt.z);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc9d2d4 }));
  dome.position.set(siloAt.x, 18, siloAt.z);
  scene.add(silo, dome);
  const bales: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx?: number; ry?: number }[] = [];
  const stack = pointAt(t, 150, -(t.edge + 13));
  const along = headingOf(stack.tx, stack.tz);
  for (const [row, n] of [[0, 4], [1, 3], [2, 2]] as const) {
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 2.5;
      bales.push({ x: stack.x + stack.tx * off, y: 1.2 + row * 2.1, z: stack.z + stack.tz * off, sx: 1.2, sy: 1.5, sz: 1.2, rx: Math.PI / 2, ry: along + Math.PI / 2 });
    }
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 14), straw, bales);

  // a green tractor parked by the barn
  const tractorAt = pointAt(t, 60, -(t.edge + 9));
  const tractor = new THREE.Group();
  const green = new THREE.MeshLambertMaterial({ color: 0x2f7a3a });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
  const hood = new THREE.Mesh(geo.box, green);
  hood.scale.set(1.3, 1.2, 2.6);
  hood.position.set(0, 1.4, 0.6);
  const cab = new THREE.Mesh(geo.box, mats.dark);
  cab.scale.set(1.7, 1.6, 1.5);
  cab.position.set(0, 2.6, -0.9);
  const top = new THREE.Mesh(geo.box, green);
  top.scale.set(1.9, 0.15, 1.7);
  top.position.set(0, 3.45, -0.9);
  tractor.add(hood, cab, top);
  for (const side of [-1, 1]) {
    const big = new THREE.Mesh(geo.wheel, mats.dark);
    big.scale.set(1.5, 0.55, 1.5);
    big.rotation.z = Math.PI / 2;
    big.position.set(side * 1.25, 1.5, -1);
    const hub = new THREE.Mesh(geo.wheel, yellow);
    hub.scale.set(0.8, 0.58, 0.8);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(big.position);
    const small = new THREE.Mesh(geo.wheel, mats.dark);
    small.scale.set(0.75, 0.4, 0.75);
    small.rotation.z = Math.PI / 2;
    small.position.set(side * 0.95, 0.75, 1.5);
    tractor.add(big, hub, small);
  }
  tractor.position.set(tractorAt.x, 0, tractorAt.z);
  tractor.rotation.y = headingOf(tractorAt.tx, tractorAt.tz) + 0.4;
  scene.add(tractor);

  // paddocks inside the loop with horses grazing
  const coats = [0x7a4a2a, 0xa0522d, 0x2a2420, 0xe8e2d6, 0x5c3a24, 0xb98b5e].map((color) => new THREE.MeshLambertMaterial({ color }));
  const manes = [new THREE.MeshLambertMaterial({ color: 0x1f1a17 }), new THREE.MeshLambertMaterial({ color: 0xe9dcc0 })];
  const fits = (x: number, z: number, w: number, d: number) => [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([a, b2]) => clear(x + (a * w) / 2, z + (b2 * d) / 2, 3));
  for (const [e, n, w, d] of [[130, -60, 60, 44], [-110, -50, 70, 50], [-20, -30, 44, 34]] as const) {
    const p = at(e, n);
    if (!fits(p.x, p.z, w, d)) continue;
    paddock(c, p.x, p.z, w, d, 0, white);
    for (let k = 0; k < 3; k++) {
      horse(c, p.x + (rand() - 0.5) * (w - 10), p.z + (rand() - 0.5) * (d - 10), rand() * Math.PI * 2, coats[Math.floor(rand() * coats.length)], manes[k % 2], rand() < 0.6);
    }
  }

  // the riding arena inside the hairpin, as big as fits: raked sand, a white rail and a couple of jumps
  const arena = roomiest(t, at(135, 185), 30);
  const ar = Math.min(20, arena.room - t.edge - 3);
  if (ar > 9) {
    const az = ar * 0.7;
    const sand = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshLambertMaterial({ color: 0xd9c49a }));
    sand.rotation.x = -Math.PI / 2;
    sand.scale.set(ar, az, 1);
    sand.position.set(arena.x, 0.03, arena.z);
    scene.add(sand);
    const posts: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) posts.push({ x: arena.x + Math.cos(a) * ar, y: 0.7, z: arena.z + Math.sin(a) * az, sx: 0.2, sy: 1.4, sz: 0.2 });
    instances(THREE, scene, dummy, geo.box, white, posts);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 4, 48), white);
    rail.rotation.x = Math.PI / 2;
    rail.scale.set(ar, az, 6);
    rail.position.set(arena.x, 1.15, arena.z);
    scene.add(rail);
    const stripe = new THREE.MeshLambertMaterial({ color: 0xc8352b });
    for (const [ox, oz] of [[-ar * 0.35, 0], [ar * 0.3, az * 0.2]]) {
      const pole = new THREE.Mesh(geo.box, stripe);
      pole.scale.set(4, 0.18, 0.18);
      pole.position.set(arena.x + ox, 1, arena.z + oz);
      scene.add(pole);
      for (const side of [-1, 1]) {
        const stand = new THREE.Mesh(geo.box, white);
        stand.scale.set(0.25, 1.6, 0.25);
        stand.position.set(arena.x + ox + side * 2, 0.8, arena.z + oz);
        scene.add(stand);
      }
    }
    horse(c, arena.x + 3, arena.z - 4, 1.2, coats[3], manes[0], false);
  }

  // a windmill out in the field
  const mill = at(-175, -10);
  if (clear(mill.x, mill.z, 6)) {
    const steel = new THREE.MeshLambertMaterial({ color: 0x8b9196 });
    const g = new THREE.Group();
    for (const [a, b2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(geo.box, steel);
      leg.scale.set(0.16, 15, 0.16);
      leg.position.set(a * 0.9, 7.4, b2 * 0.9);
      leg.rotation.set(-b2 * 0.1, 0, a * 0.1);
      g.add(leg);
    }
    const wheel = new THREE.Group();
    for (let k = 0; k < 12; k++) {
      const blade = new THREE.Mesh(geo.box, steel);
      blade.scale.set(0.5, 2.6, 0.06);
      blade.position.y = 1.6;
      const arm = new THREE.Group();
      arm.add(blade);
      arm.rotation.z = (k / 12) * Math.PI * 2;
      wheel.add(arm);
    }
    wheel.position.set(0, 15.2, 0.6);
    const tail = new THREE.Mesh(geo.box, red);
    tail.scale.set(0.06, 1.6, 2.6);
    tail.position.set(0, 15.2, -1.8);
    g.add(wheel, tail);
    g.position.set(mill.x, 0, mill.z);
    g.rotation.y = 2.4;
    scene.add(g);
  }

  // eucalyptus windbreaks outside the loop, and oaks further out
  const gums: { x: number; z: number; h: number }[] = [];
  for (let s = 0; s < t.length; s += 9) {
    const p = pointAt(t, s, t.edge + 7 + rand() * 4);
    if (clear(p.x, p.z, 4) && !insideLoop(t, p.x, p.z) && rand() < 0.75) gums.push({ x: p.x, z: p.z, h: 15 + rand() * 9 });
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.28, 0.45, 1, 6), new THREE.MeshLambertMaterial({ color: 0xd9d0c0 }), gums.map((g) => ({ x: g.x, y: g.h / 2, z: g.z, sx: 1, sy: g.h, sz: 1 })));
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 7, 6), new THREE.MeshLambertMaterial({ color: 0x6f8f6a, flatShading: true }), gums.map((g, i) => ({ x: g.x, y: g.h * 0.78, z: g.z, sx: 2.6, sy: g.h * 0.32, sz: 2.6, ry: i })));
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 90 && n < 3000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 60 + rand() * 380;
    const x = cx + Math.cos(a) * (rx + dist);
    const z = cz + Math.sin(a) * (rz + dist);
    if (clear(x, z, 6)) spots.push({ x, z, r: 2.6 + rand() * 3 });
  }
  oaks(c, spots);

  // the foothills behind, with the Dish up on one of them
  foothills(c, cx, cz, { x: cx + 120, z: cz + 420 });
}

export const SCENERY: Record<CourseId, (c: Scenery) => void> = { palm: campus, lake, barn };
