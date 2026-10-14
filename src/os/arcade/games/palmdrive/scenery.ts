// Each course's look and scenery: the colors of its grass, curbs and walls, and the landmarks, trees and water
// around it. buildView (scene.ts) lays the road and walls and then hands a course's builder here the scene to fill.
import type { T } from './gl';
import type { CourseId } from './courses';
import { LANDMARKS, fromMap, headingOf, locate, pointAt, type P2, type Track } from './track';
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

/** Hoover Tower: a tall sandstone shaft, the open belfry and the red dome; floodlit, its belfry glows at night. */
function makeHoover(THREE: Three, box: T.BoxGeometry, lit = false) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe0c49a, emissive: lit ? 0x5a4428 : 0x000000 });
  const dark = lit ? new THREE.MeshBasicMaterial({ color: 0xffe0a0 }) : new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a, emissive: lit ? 0x6a2410 : 0x000000 });
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
  // a red warning light on the very top
  if (lit) add(box, new THREE.MeshBasicMaterial({ color: 0xff3a2a }), 0, 60.2, 0, 0.6, 0.6, 0.6);
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

/** A Holstein's spotted hide and the rest of its colors. */
export function cowMaterials(THREE: Three) {
  const hide = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#f4f2ec';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#1d1d22';
      const spots = scatter(11);
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        g.ellipse(spots() * 64, spots() * 64, 6 + spots() * 9, 5 + spots() * 7, spots() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  return {
    hide: new THREE.MeshLambertMaterial({ map: hide }),
    pink: new THREE.MeshLambertMaterial({ color: 0xf0a3a8 }),
    hoof: new THREE.MeshLambertMaterial({ color: 0x2a2420 }),
    horn: new THREE.MeshLambertMaterial({ color: 0xeee3c4 }),
  };
}

/** A cow facing +z: spotted body, pink nose and udder, little horns and a tail. Its legs and head can be animated. */
export function makeCow(THREE: Three, geo: { box: T.BoxGeometry; ball: T.SphereGeometry; cone: T.ConeGeometry }, mats: ReturnType<typeof cowMaterials>) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.box, mats.hide);
  body.scale.set(1.05, 1, 2.1);
  body.position.y = 1.25;
  const udder = new THREE.Mesh(geo.ball, mats.pink);
  udder.scale.set(0.3, 0.2, 0.35);
  udder.position.set(0, 0.72, -0.4);
  const tail = new THREE.Mesh(geo.box, mats.hide);
  tail.scale.set(0.08, 0.9, 0.08);
  tail.position.set(0, 1.2, -1.07);
  g.add(body, udder, tail);
  const legs: T.Mesh[] = [];
  for (const [x, z] of [[-0.35, 0.75], [0.35, 0.75], [-0.35, -0.75], [0.35, -0.75]]) {
    const leg = new THREE.Mesh(geo.box, mats.hide);
    leg.scale.set(0.24, 0.85, 0.24);
    leg.position.set(x, 0.42, z);
    const hoof = new THREE.Mesh(geo.box, mats.hoof);
    hoof.scale.set(1.05, 0.18, 1.05);
    hoof.position.y = -0.42;
    leg.add(hoof);
    legs.push(leg);
    g.add(leg);
  }
  const head = new THREE.Group();
  const skull = new THREE.Mesh(geo.box, mats.hide);
  skull.scale.set(0.62, 0.62, 0.7);
  const nose = new THREE.Mesh(geo.box, mats.pink);
  nose.scale.set(0.56, 0.36, 0.25);
  nose.position.set(0, -0.14, 0.42);
  head.add(skull, nose);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(geo.cone, mats.horn);
    horn.scale.set(0.08, 0.28, 0.08);
    horn.position.set(side * 0.24, 0.42, -0.1);
    horn.rotation.z = -side * 0.5;
    const ear = new THREE.Mesh(geo.box, mats.hoof);
    ear.scale.set(0.3, 0.1, 0.16);
    ear.position.set(side * 0.42, 0.18, -0.12);
    const eye = new THREE.Mesh(geo.ball, mats.hoof);
    eye.scale.setScalar(0.07);
    eye.position.set(side * 0.2, 0.1, 0.36);
    head.add(horn, ear, eye);
  }
  head.position.set(0, 1.55, 1.25);
  g.add(head);
  return { g, legs, head };
}

/** A round sandstone planter `r` meters across the middle, with a little tree and some flowers in it. */
export function makePlanter(THREE: Three, geo: { ball: T.SphereGeometry; wheel: T.CylinderGeometry }, r: number, rand: () => number) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe2c79c });
  const add = (geom: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  // the bowl with a lip round the top, and the soil in it
  add(new THREE.CylinderGeometry(1, 0.86, 1, 20), stone, 0, 0.45, 0, r, 0.9, r);
  add(geo.wheel, stone, 0, 0.92, 0, r * 1.06, 0.12, r * 1.06);
  add(geo.wheel, new THREE.MeshLambertMaterial({ color: 0x4a3423 }), 0, 0.95, 0, r * 0.9, 0.06, r * 0.9);
  // flowers round the edge and a young oak in the middle
  const bloom = [0xe8486a, 0xf6d24a, 0xf3f0ea, 0xb04ad8][Math.floor(rand() * 4)];
  const flower = new THREE.MeshLambertMaterial({ color: bloom });
  const leaf = new THREE.MeshLambertMaterial({ color: 0x4f8a3c, flatShading: true });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rand() * 0.3;
    add(geo.ball, k % 3 ? leaf : flower, Math.cos(a) * r * 0.66, 1.05, Math.sin(a) * r * 0.66, 0.26, 0.2, 0.26);
  }
  add(geo.wheel, new THREE.MeshLambertMaterial({ color: 0x6b4f37 }), 0, 1.7, 0, 0.12, 1.6, 0.12);
  add(geo.ball, leaf, 0, 2.9, 0, r * 0.7, r * 0.6, r * 0.7);
  add(geo.ball, leaf, r * 0.25, 3.4, -r * 0.1, r * 0.45, r * 0.4, r * 0.45);
  return g;
}

/** What every bike shares: a thin wheel, a helmet, and the colors of frames, shirts and helmets to pick from. */
export function bikeKit(THREE: Three) {
  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
  return {
    wheel: new THREE.TorusGeometry(0.34, 0.035, 6, 22),
    dome: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    tire: lambert(0x222226),
    steel: lambert(0x9aa0a6),
    skin: lambert(0xd9a77f),
    legs: lambert(0x2f3a55),
    frames: [0x8c1515, 0x2d6fb7, 0x2f8a4a, 0xf2c230, 0x2a2a30, 0xe8e4dc].map(lambert),
    shirts: [0x8c1515, 0xf3f0ea, 0x2b4c7e, 0x4f8a3c, 0x9a9a9e, 0xe07a2a].map(lambert),
    helmets: [0xe53935, 0xffffff, 0x1e88e5, 0xfdd835, 0x43a047, 0xff7043, 0x8e24aa, 0x111111].map(lambert),
  };
}

/**
 * A bicycle facing +z, with a rider on it unless it is parked. `pedal(a)` turns the cranks to angle `a` and keeps
 * the rider's feet on the pedals; `wheels` spin about x.
 */
export function makeBike(THREE: Three, geo: { box: T.BoxGeometry; ball: T.SphereGeometry }, kit: ReturnType<typeof bikeKit>, rand: () => number, rider = true) {
  const g = new THREE.Group();
  const pick = <M>(list: M[]) => list[Math.floor(rand() * list.length)];
  const frame = pick(kit.frames);
  /** A thin bar from (y0, z0) to (y1, z1), x to the side. */
  const rod = (parent: T.Object3D, mat: T.Material, x: number, y0: number, z0: number, y1: number, z1: number, w = 0.05) => {
    const m = new THREE.Mesh(geo.box, mat);
    const len = Math.hypot(y1 - y0, z1 - z0);
    m.scale.set(w, len, w);
    m.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
    m.rotation.x = Math.atan2(z1 - z0, y1 - y0);
    parent.add(m);
    return m;
  };
  const wheels: T.Group[] = [];
  for (const z of [-0.52, 0.52]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(kit.wheel, kit.tire);
    tire.rotation.y = Math.PI / 2;
    w.add(tire);
    rod(w, kit.steel, 0, -0.32, 0, 0.32, 0, 0.02);
    rod(w, kit.steel, 0, 0, -0.32, 0, 0.32, 0.02);
    w.position.set(0, 0.34, z);
    wheels.push(w);
    g.add(w);
  }
  // the frame: down tube, seat tube, top tube, stays and fork, then the bars and the saddle
  const BB = [0.34, 0.04] as const;
  rod(g, frame, 0, BB[0], BB[1], 0.86, 0.4);
  rod(g, frame, 0, BB[0], BB[1], 0.9, -0.12);
  rod(g, frame, 0, 0.86, -0.1, 0.88, 0.4);
  rod(g, frame, 0, BB[0], BB[1], 0.34, -0.52, 0.035);
  rod(g, frame, 0, 0.34, -0.52, 0.86, -0.1, 0.035);
  rod(g, frame, 0, 0.88, 0.4, 0.34, 0.52, 0.045);
  rod(g, kit.steel, 0, 0.88, 0.4, 1.02, 0.38, 0.04);
  const bars = new THREE.Mesh(geo.box, kit.tire);
  bars.scale.set(0.5, 0.04, 0.04);
  bars.position.set(0, 1.02, 0.38);
  const saddle = new THREE.Mesh(geo.box, kit.tire);
  saddle.scale.set(0.14, 0.05, 0.26);
  saddle.position.set(0, 0.94, -0.13);
  g.add(bars, saddle);
  // the cranks, with a pedal on each end
  const cranks = new THREE.Group();
  cranks.position.set(0, BB[0], BB[1]);
  for (const side of [-1, 1]) {
    rod(cranks, kit.steel, side * 0.08, 0, 0, side * 0.17, 0, 0.03);
    const pedal = new THREE.Mesh(geo.box, kit.tire);
    pedal.scale.set(0.1, 0.025, 0.07);
    pedal.position.set(side * 0.12, side * 0.17, 0);
    cranks.add(pedal);
  }
  g.add(cranks);
  const legs: T.Mesh[] = [];
  if (rider) {
    // leaning on the bars: body from the saddle, head with a helmet, arms down to the grips
    const body = new THREE.Group();
    body.position.set(0, 0.98, -0.12);
    body.rotation.x = 0.55;
    const torso = new THREE.Mesh(geo.box, pick(kit.shirts));
    torso.scale.set(0.36, 0.6, 0.22);
    torso.position.y = 0.3;
    const head = new THREE.Mesh(geo.ball, kit.skin);
    head.scale.setScalar(0.13);
    head.position.set(0, 0.76, 0.02);
    const helmet = new THREE.Mesh(kit.dome, pick(kit.helmets));
    helmet.scale.set(0.155, 0.13, 0.18);
    helmet.position.set(0, 0.78, 0);
    body.add(torso, head, helmet);
    g.add(body);
    for (const side of [-1, 1]) {
      rod(g, torso.material as T.Material, side * 0.2, 1.44, 0.18, 1.03, 0.38, 0.08);
      const leg = new THREE.Mesh(geo.box, kit.legs);
      leg.scale.set(0.13, 1, 0.13);
      legs.push(leg);
      g.add(leg);
    }
  }
  const HIP = [1.0, -0.12] as const;
  const pedal = (a: number) => {
    cranks.rotation.x = a;
    legs.forEach((leg, n) => {
      // each foot follows its pedal round, the leg stretched from the hip down to it
      const side = n ? 1 : -1;
      const py = BB[0] + Math.cos(a) * 0.17 * side;
      const pz = BB[1] + Math.sin(a) * 0.17 * side;
      const dy = py - HIP[0];
      const dz = pz - HIP[1];
      leg.scale.y = Math.hypot(dy, dz);
      leg.position.set(side * 0.1, (HIP[0] + py) / 2, (HIP[1] + pz) / 2);
      leg.rotation.x = Math.atan2(dz, dy);
    });
  };
  pedal(rand() * Math.PI * 2);
  return { g, wheels, pedal };
}

/**
 * The Marguerite, Stanford's free shuttle, facing +z: white with a cardinal stripe, its windows lit from inside,
 * MARGUERITE on the sign over the windshield, headlights throwing light on the road ahead and red tail lights.
 * `len` and `half` are its length and half its width; its wheels come back with it, to roll as it drives.
 */
export function makeBus(THREE: Three, geo: { box: T.BoxGeometry; wheel: T.CylinderGeometry; plane: T.PlaneGeometry }, len: number, half: number) {
  const g = new THREE.Group();
  const w = half * 2;
  // a little light of its own, so it still reads white at night
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, emissive: 0x3a3a38 });
  const cardinal = new THREE.MeshLambertMaterial({ color: 0x8c1515, emissive: 0x2a0606 });
  const black = new THREE.MeshLambertMaterial({ color: 0x1c1d22 });
  const box = (mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  const panel = (mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, ry: number) => {
    const m = new THREE.Mesh(geo.plane, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, 1);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  box(white, 0, 1.75, 0, w, 2.6, len);
  box(white, 0, 3.12, 0, w - 0.2, 0.16, len - 0.4);
  box(white, 0, 3.32, -len * 0.15, w * 0.55, 0.3, len * 0.3);
  // the cardinal stripe down both sides and round the back
  for (const side of [-1, 1]) box(cardinal, side * (half + 0.01), 1.05, 0, 0.04, 0.42, len + 0.02);
  box(cardinal, 0, 1.05, -len / 2 - 0.01, w + 0.02, 0.42, 0.04);
  box(black, 0, 0.62, len / 2 + 0.05, w + 0.04, 0.34, 0.16);
  box(black, 0, 0.62, -len / 2 - 0.05, w + 0.04, 0.34, 0.16);
  // windows down each side, warm with the lights on inside and a few riders in silhouette
  const glass = texture(
    THREE,
    canvas(256, 32, (c) => {
      const glow = c.createLinearGradient(0, 0, 0, 32);
      glow.addColorStop(0, '#ffe6b0');
      glow.addColorStop(1, '#d8a960');
      c.fillStyle = glow;
      c.fillRect(0, 0, 256, 32);
      const heads = scatter(5);
      c.fillStyle = 'rgba(40,30,30,0.65)';
      for (let i = 0; i < 9; i++) {
        const x = 8 + heads() * 240;
        c.beginPath();
        c.arc(x, 18, 5, 0, Math.PI * 2);
        c.fillRect(x - 7, 22, 14, 10);
        c.fill();
      }
      c.fillStyle = '#2a2a30';
      for (let x = 0; x <= 256; x += 32) c.fillRect(x - 2, 0, 4, 32);
      c.fillRect(0, 0, 256, 3);
      c.fillRect(0, 29, 256, 3);
    }),
  );
  const windows = new THREE.MeshBasicMaterial({ map: glass });
  for (const side of [-1, 1]) panel(windows, side * (half + 0.02), 2.25, -0.3, len - 1.8, 1.05, side * (Math.PI / 2));
  // the windshield and the sign over it
  panel(new THREE.MeshBasicMaterial({ color: 0x3a4660 }), 0, 2.15, len / 2 + 0.02, w - 0.3, 1.3, 0);
  const sign = texture(
    THREE,
    canvas(256, 40, (c) => {
      c.fillStyle = '#111';
      c.fillRect(0, 0, 256, 40);
      c.fillStyle = '#ffb63a';
      c.font = 'bold 28px Inter, Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('MARGUERITE', 128, 22);
    }),
  );
  panel(new THREE.MeshBasicMaterial({ map: sign }), 0, 2.95, len / 2 + 0.03, w - 0.5, 0.32, 0);
  // headlights, a pool of their light on the road ahead, and tail lights
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
  const tail = new THREE.MeshBasicMaterial({ color: 0xff2a1e });
  for (const side of [-1, 1]) {
    box(lamp, side * (half - 0.35), 0.95, len / 2 + 0.03, 0.45, 0.24, 0.06);
    box(tail, side * (half - 0.25), 1.45, -len / 2 - 0.03, 0.3, 0.5, 0.06);
  }
  const beam = new THREE.Mesh(
    geo.plane,
    new THREE.MeshBasicMaterial({
      map: texture(
        THREE,
        // the top of the canvas is the end nearest the bus (the plane lies flat with its top toward -z)
        canvas(64, 128, (c) => {
          const fade = c.createLinearGradient(0, 0, 0, 128);
          fade.addColorStop(0, 'rgba(255,240,200,0.55)');
          fade.addColorStop(1, 'rgba(255,240,200,0)');
          c.fillStyle = fade;
          c.beginPath();
          c.moveTo(18, 0);
          c.lineTo(46, 0);
          c.lineTo(64, 128);
          c.lineTo(0, 128);
          c.closePath();
          c.fill();
        }),
      ),
      transparent: true,
      depthWrite: false,
    }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.scale.set(w + 1.6, 12, 1);
  beam.position.set(0, 0.08, len / 2 + 6);
  beam.renderOrder = 2;
  g.add(beam);
  // four wheels with silver hubs
  const wheels: T.Mesh[] = [];
  const hub = new THREE.MeshLambertMaterial({ color: 0xb8bcc2 });
  for (const z of [len / 2 - 1.7, -len / 2 + 1.9]) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(geo.wheel, black);
      wheel.scale.set(0.52, 0.34, 0.52);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (half - 0.12), 0.52, z);
      const cap = new THREE.Mesh(geo.wheel, hub);
      cap.scale.set(0.6, 1.05, 0.6);
      wheel.add(cap);
      wheels.push(wheel);
      g.add(wheel);
    }
  }
  return { g, wheels };
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
  /** The color of the joints between paving stones, for a paved road. */
  joints?: string;
  /** After dark: the curbs, wall tops, signs and oil slicks glow a little so the edges and hazards always read. */
  night?: boolean;
};
export const LOOKS: Record<CourseId, Look> = {
  palm: { fog: [0xf3d6b4, 140, 720], sky: 0xfff3df, ground: 0x6e8a4a, sun: [0xffe4bd, 1.5], field: '#c4b468', lawn: '#6fa94e', curb: ['#f4f1ea', '#d23a2e'], wall: '#e6cfa6', band: '#8c1515', banner: 'PALM DRIVE', road: '#4a4a52' },
  lake: { fog: [0xeeb08e, 120, 640], sky: 0xffd8c2, ground: 0x5d6b4a, sun: [0xffb07a, 1.4], field: '#b8a862', lawn: '#79a85a', curb: ['#f4f1ea', '#2f6fb5'], wall: '#b98b5e', band: '#2f6fb5', banner: 'LAKE LAGUNITA', road: '#4a4a52' },
  barn: { fog: [0xe9e4cf, 150, 720], sky: 0xfff4dd, ground: 0x6b7a44, sun: [0xfff0d0, 1.5], field: '#c9b26a', lawn: '#88ad59', curb: ['#efe6cf', '#9a3a28'], wall: '#f3efe4', band: '#9a3a28', banner: 'RED BARN', road: '#8f6f4d' },
  dish: { fog: [0xe6e0c8, 160, 760], sky: 0xfff6e6, ground: 0x7a7448, sun: [0xfff2d8, 1.55], field: '#cdb46c', lawn: '#b0a95e', curb: ['#f2efe6', '#5d7a3a'], wall: '#d9cfb8', band: '#5d7a3a', banner: 'THE DISH', road: '#5e5d62' },
  stadium: { fog: [0xe2e8ef, 170, 760], sky: 0xf4f8ff, ground: 0x5f7a4a, sun: [0xfff4e0, 1.55], field: '#c4b98a', lawn: '#5aa04a', curb: ['#f4f1ea', '#8c1515'], wall: '#ebe6db', band: '#8c1515', banner: 'STANFORD STADIUM', road: '#4c4c54' },
  quad: { fog: [0xf1e3c6, 150, 700], sky: 0xfff4e0, ground: 0x8a7a55, sun: [0xffecc8, 1.55], field: '#d8c39a', lawn: '#7fae58', curb: ['#f4efe4', '#8c1515'], wall: '#efe0bf', band: '#8c1515', banner: 'MAIN QUAD', road: '#c9b089', joints: '#a08766' },
  // cool moonlight, low enough to read as night with the road and karts still clear
  hoover: { fog: [0x22325e, 80, 470], sky: 0x8d9fdc, ground: 0x2a3150, sun: [0xb4c8ff, 0.8], field: '#33402c', lawn: '#3b5734', curb: ['#f4f1ea', '#d9a52e'], wall: '#c9c0b0', band: '#ffc53d', banner: 'HOOVER NIGHTS', road: '#4e4e58', night: true },
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

/** Golden foothills in a ring 560-720 m round (cx, cz), with the Dish up on one of them unless `dish` is null. */
function foothills(c: Scenery, cx: number, cz: number, dish: { x: number; z: number } | null) {
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
  if (!dish) return;
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

/**
 * The Dish: the big radio telescope inside the loop, smaller antennas about, rolling golden hills dotted with oaks,
 * cattle grazing, barbed wire along the road, a cattle grid by the gate and campus off in the distance.
 */
function dish(c: Scenery) {
  const { THREE, scene, t, geo, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  const K = 0.82;
  const white = new THREE.MeshLambertMaterial({ color: 0xf1f0ea, side: THREE.DoubleSide });
  const steel = new THREE.MeshLambertMaterial({ color: 0xb9bcbf });
  const concrete = new THREE.MeshLambertMaterial({ color: 0xc9c3b6 });

  // the Dish: a 30 m white bowl tilted to the sky on its yoke, with the feed held out on a tripod
  const big = roomiest(t, fromMap(90 * K, 150 * K), 60);
  const d = new THREE.Group();
  const pedestal = new THREE.Mesh(geo.box, concrete);
  pedestal.scale.set(10, 6, 10);
  pedestal.position.y = 3;
  d.add(pedestal);
  /** A strut from a to b (in its parent's space). */
  const strut = (mat: T.Material, w: number, a: T.Vector3, b: T.Vector3) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(w, a.distanceTo(b), w);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  // the yoke: an arm up from each side of the pedestal to the bowl's pivot
  for (const side of [-1, 1]) d.add(strut(white, 2, new THREE.Vector3(side * 4, 6, 0), new THREE.Vector3(side * 11, 20, 0)));
  const reflector = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(22, 28, 10, 0, Math.PI * 2, 0, 0.75), white);
  bowl.rotation.x = Math.PI;
  bowl.position.y = 22;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(15, 0.5, 6, 40), steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 22 - 22 * Math.cos(0.75);
  reflector.add(bowl, rim);
  // the feed over the middle of the bowl, held up by three legs from the rim
  const feed = new THREE.Mesh(geo.box, steel);
  feed.scale.set(2, 2.4, 2);
  feed.position.y = rim.position.y + 12;
  reflector.add(feed);
  const focus = new THREE.Vector3(0, feed.position.y - 1, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    reflector.add(strut(steel, 0.4, new THREE.Vector3(Math.cos(a) * 14.6, rim.position.y, Math.sin(a) * 14.6), focus));
  }
  reflector.position.y = 18;
  reflector.rotation.x = -0.75;
  d.add(reflector);
  d.position.set(big.x, 0, big.z);
  d.rotation.y = 2.2;
  d.scale.setScalar(Math.min(1, (big.room - t.edge - 6) / 24));
  scene.add(d);

  // smaller antennas dotted about the hills outside the loop
  for (let n = 0, made = 0; made < 4 && n < 200; n++) {
    const a = rand() * Math.PI * 2;
    const x = cx + Math.cos(a) * (rx + 40 + rand() * 120);
    const z = cz + Math.sin(a) * (rz + 40 + rand() * 120);
    if (!clear(x, z, 12)) continue;
    const g = new THREE.Group();
    const post = new THREE.Mesh(geo.box, white);
    post.scale.set(1.2, 7, 1.2);
    post.position.y = 3.5;
    const small = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 6, 0, Math.PI * 2, 0, 0.8), white);
    small.rotation.x = Math.PI - 0.9;
    small.position.y = 9;
    g.add(post, small);
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    made++;
  }

  // rolling golden hills inside the loop and round about, clear of the road
  const hillMat = new THREE.MeshLambertMaterial({ color: 0xc6ad66, flatShading: true });
  const hillGeo = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const hills: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = [];
  for (let n = 0; hills.length < 26 && n < 600; n++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * (Math.max(rx, rz) + 220);
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    const size = 16 + rand() * 30;
    if (!clear(x, z, size + 4) || Math.hypot(x - big.x, z - big.z) < 34) continue;
    hills.push({ x, y: -1, z, sx: size, sy: 4 + rand() * size * 0.35, sz: size * (0.7 + rand() * 0.5), ry: rand() * 3 });
  }
  instances(THREE, scene, dummy, hillGeo, hillMat, hills);

  // oaks scattered over the hillsides
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 150 && n < 5000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * (Math.max(rx, rz) + 380);
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    const r = 2.4 + rand() * 3.4;
    // the whole crown clear of the walls and the start gantry
    if (clear(x, z, r * 1.15 + 1.5) && Math.hypot(x - big.x, z - big.z) > 30) spots.push({ x, z, r });
  }
  oaks(c, spots);

  // cattle grazing off the road
  const cowMats = cowMaterials(THREE);
  for (let n = 0, made = 0; made < 12 && n < 400; n++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * (Math.max(rx, rz) + 120);
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    if (!clear(x, z, 5) || Math.hypot(x - big.x, z - big.z) < 30) continue;
    const { g, head } = makeCow(THREE, geo, cowMats);
    head.rotation.x = 0.9;
    head.position.y = 1.2;
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    made++;
  }

  // barbed wire on wooden posts outside the walls
  const posts: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  const wires: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = [];
  for (const side of [-1, 1]) {
    let last: { x: number; z: number } | null = null;
    for (let s = 0; s <= t.length; s += 7) {
      const p = pointAt(t, s, side * (t.edge + 3));
      const ok = clear(p.x, p.z, 2);
      if (ok) posts.push({ x: p.x, y: 0.7, z: p.z, sx: 0.16, sy: 1.4, sz: 0.16 });
      if (ok && last) {
        const len = Math.hypot(p.x - last.x, p.z - last.z);
        for (const y of [0.7, 1.2]) wires.push({ x: (p.x + last.x) / 2, y, z: (p.z + last.z) / 2, sx: 0.03, sy: 0.03, sz: len, ry: headingOf(p.x - last.x, p.z - last.z) });
      }
      last = ok ? p : null;
    }
  }
  instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0x7a5c3e }), posts);
  instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0x55575a }), wires);

  // a cattle grid across the road just past the gate
  const bars: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = [];
  for (let k = -5; k <= 5; k++) {
    const p = pointAt(t, 32 + k * 0.45, 0);
    bars.push({ x: p.x, y: 0.06, z: p.z, sx: t.half * 2, sy: 0.05, sz: 0.16, ry: headingOf(p.tx, p.tz) });
  }
  instances(THREE, scene, dummy, geo.box, steel, bars);
  const pit = pointAt(t, 32, 0);
  const shade = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ color: 0x1e1d1c }));
  shade.rotation.set(-Math.PI / 2, 0, headingOf(pit.tx, pit.tz));
  shade.scale.set(t.half * 2, 5, 1);
  shade.position.set(pit.x, 0.05, pit.z);
  scene.add(shade);

  // the foothills beyond, and campus down below with Hoover Tower
  foothills(c, cx, cz, null);
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(cx - 120, 0, cz + 470);
  hoover.scale.setScalar(1.5);
  scene.add(hoover);
}

/**
 * Stanford Stadium on game day: tiered stands packed with a cardinal-and-white crowd round the outside of the bowl,
 * the football field in the middle with its end zones and goalposts, the scoreboard, light towers, a portal over the
 * tunnel, and tailgate tents and palms out on the plaza.
 */
function stadium(c: Scenery) {
  const { THREE, scene, t, geo, mats, rand, clear, dummy } = c;
  const { cx, cz } = bounds(t);
  const K = 0.85;
  const concrete = new THREE.MeshLambertMaterial({ color: 0xbdb6aa });
  const cardinal = new THREE.MeshLambertMaterial({ color: 0x8c1515 });
  const white = new THREE.MeshLambertMaterial({ color: 0xf3f1ec });
  const gold = new THREE.MeshLambertMaterial({ color: 0xf2c230 });

  // the stands: rising tiers on the outside of the bowl, each row with its strip of cardinal seats and a crowd
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number };
  const tiers: Item[] = [];
  const seats: Item[] = [];
  const fans: Item[][] = [[], [], [], []];
  const ROWS = 8;
  const STEP = 5;
  /** A block along the stretch of row `d` from s - STEP/2 to s + STEP/2, sized to that chord so bends leave no gaps. */
  const chord = (s: number, d: number) => {
    const a = pointAt(t, s - STEP / 2, d);
    const b = pointAt(t, s + STEP / 2, d);
    return { a, b, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len: Math.hypot(b.x - a.x, b.z - a.z), ry: headingOf(b.x - a.x, b.z - a.z) };
  };
  // round from the home straight to the tunnel, so the road runs out through the portal
  for (let s = -60; s <= 395; s += STEP) {
    for (let row = 0; row < ROWS; row++) {
      const p = chord(s, t.edge + 3.4 + row * 2.6);
      if (!clear(p.x, p.z, 1.5)) continue;
      const h = 1.1 + row * 1.25;
      tiers.push({ x: p.x, y: h / 2, z: p.z, sx: 2.6, sy: h, sz: p.len + 0.3, ry: p.ry });
      const seat = chord(s, t.edge + 2.6 + row * 2.6);
      seats.push({ x: seat.x, y: h + 0.15, z: seat.z, sx: 0.9, sy: 0.3, sz: seat.len + 0.3, ry: seat.ry });
      const f = chord(s, t.edge + 2.4 + row * 2.6);
      for (let k = 0; k < 3; k++) {
        if (rand() < 0.15) continue;
        const u = (k + 0.3 + rand() * 0.4) / 3;
        const pick = rand();
        fans[pick < 0.45 ? 0 : pick < 0.75 ? 1 : pick < 0.88 ? 2 : 3].push({ x: f.a.x + (f.b.x - f.a.x) * u, y: h + 0.75, z: f.a.z + (f.b.z - f.a.z) * u, sx: 0.55, sy: 0.9, sz: 0.45, ry: f.ry });
      }
    }
  }
  instances(THREE, scene, dummy, geo.box, concrete, tiers);
  instances(THREE, scene, dummy, geo.box, cardinal, seats);
  [0x8c1515, 0xf6f4ef, 0x2a2a30, 0xe8b34a].forEach((color, i) => instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color }), fans[i]));

  // the field in the middle of the bowl, running along the home straight
  const home = pointAt(t, 60, 0);
  const across = pointAt(t, 60, -(t.edge + 30));
  const fx = across.x;
  const fz = across.z;
  const along = headingOf(home.tx, home.tz);
  let len = 100;
  const fits = (l: number) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => {
      const x = fx + Math.sin(along) * (a * l) / 2 + Math.cos(along) * (b * 22);
      const z = fz + Math.cos(along) * (a * l) / 2 - Math.sin(along) * (b * 22);
      return clear(x, z, 1);
    });
  while (len > 50 && !fits(len)) len -= 5;
  const turf = texture(
    THREE,
    canvas(512, 224, (g) => {
      for (let i = 0; i < 12; i++) {
        g.fillStyle = i % 2 ? '#3f8f3a' : '#4a9a42';
        g.fillRect((i * 512) / 12, 0, 512 / 12 + 1, 224);
      }
      // end zones with STANFORD in white
      g.fillStyle = '#8c1515';
      g.fillRect(0, 0, 43, 224);
      g.fillRect(469, 0, 43, 224);
      g.fillStyle = '#fff';
      g.font = 'bold 30px Inter, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [x, a] of [[21, -Math.PI / 2], [491, Math.PI / 2]] as const) {
        g.save();
        g.translate(x, 112);
        g.rotate(a);
        g.fillText('STANFORD', 0, 2);
        g.restore();
      }
      // yard lines, hash marks and the S at midfield
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k = 0; k <= 10; k++) g.fillRect(43 + k * 42.6 - 1, 8, 2, 208);
      g.fillRect(43, 6, 426, 3);
      g.fillRect(43, 215, 426, 3);
      g.font = 'bold 64px Georgia, serif';
      g.fillStyle = '#8c1515';
      g.fillText('S', 256, 116);
    }),
  );
  const field = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: turf }));
  field.rotation.set(-Math.PI / 2, 0, along - Math.PI / 2);
  field.scale.set(len, 44, 1);
  field.position.set(fx, 0.03, fz);
  scene.add(field);
  // goalposts at both ends
  for (const end of [-1, 1]) {
    const gx = fx + Math.sin(along) * end * (len / 2 - 1);
    const gz = fz + Math.cos(along) * end * (len / 2 - 1);
    const post = new THREE.Group();
    const stem = new THREE.Mesh(geo.box, gold);
    stem.scale.set(0.3, 3, 0.3);
    stem.position.y = 1.5;
    const bar = new THREE.Mesh(geo.box, gold);
    bar.scale.set(5.6, 0.25, 0.25);
    bar.position.y = 3;
    post.add(stem, bar);
    for (const side of [-1, 1]) {
      const up = new THREE.Mesh(geo.box, gold);
      up.scale.set(0.2, 6, 0.2);
      up.position.set(side * 2.8, 6, 0);
      post.add(up);
    }
    post.position.set(gx, 0, gz);
    post.rotation.y = along;
    scene.add(post);
  }

  // the scoreboard over the east end, and light towers round the rim
  const board = pointAt(t, 190, t.edge + 30);
  if (clear(board.x, board.z, 6)) {
    const sb = new THREE.Group();
    const legs = new THREE.Mesh(geo.box, mats.dark);
    legs.scale.set(2, 16, 2);
    legs.position.y = 8;
    const frame = new THREE.Mesh(geo.box, cardinal);
    frame.scale.set(26, 11, 1.4);
    frame.position.y = 21;
    const screen = new THREE.Mesh(
      geo.plane,
      new THREE.MeshBasicMaterial({
        map: texture(
          THREE,
          canvas(256, 104, (g) => {
            g.fillStyle = '#111';
            g.fillRect(0, 0, 256, 104);
            g.fillStyle = '#fff';
            g.font = 'bold 30px Inter, Arial, sans-serif';
            g.textAlign = 'center';
            g.fillText('STANFORD', 128, 44);
            g.fillStyle = '#f2c230';
            g.font = 'bold 22px Inter, Arial, sans-serif';
            g.fillText('GO CARDINAL!', 128, 82);
          }),
        ),
      }),
    );
    screen.scale.set(24, 9.4, 1);
    screen.position.set(0, 21, 0.75);
    sb.add(legs, frame, screen);
    sb.position.set(board.x, 0, board.z);
    sb.rotation.y = headingOf(board.tz, -board.tx);
    scene.add(sb);
  }
  for (const s of [-40, 120, 250, 360]) {
    const p = pointAt(t, s, t.edge + 26);
    if (!clear(p.x, p.z, 2)) continue;
    const pole = new THREE.Mesh(geo.box, mats.dark);
    pole.scale.set(0.8, 30, 0.8);
    pole.position.set(p.x, 15, p.z);
    const lamps = new THREE.Mesh(geo.box, new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
    lamps.scale.set(6, 3, 0.6);
    lamps.position.set(p.x, 30.5, p.z);
    lamps.rotation.y = headingOf(p.tz, -p.tx);
    scene.add(pole, lamps);
  }

  // a portal over the road where it runs out through the tunnel
  const gate = pointAt(t, 392, 0);
  const portal = new THREE.Group();
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(geo.box, concrete);
    pillar.scale.set(2, 9, 2);
    pillar.position.set(side * (t.edge + 1), 4.5, 0);
    portal.add(pillar);
  }
  const beam = new THREE.Mesh(geo.box, cardinal);
  beam.scale.set(t.edge * 2 + 4, 2.4, 1.6);
  beam.position.y = 9.6;
  portal.add(beam);
  portal.position.set(gate.x, 0, gate.z);
  portal.rotation.y = headingOf(gate.tx, gate.tz);
  scene.add(portal);

  // tailgate tents and palms out on the plaza
  const legs: Item[] = [];
  const canopies: Item[][] = [[], []];
  for (let n = 0, made = 0; made < 22 && n < 900; n++) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 170;
    const p = fromMap((-160 + Math.cos(a) * 60) * K, (150 + Math.sin(a) * 60) * K);
    const x = p.x + Math.cos(a) * (r - 30) * 0.4;
    const z = p.z + Math.sin(a) * (r - 30) * 0.4;
    if (!clear(x, z, 4)) continue;
    const ry = rand() * Math.PI;
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      legs.push({ x: x + Math.cos(ry) * lx + Math.sin(ry) * lz, y: 1.1, z: z - Math.sin(ry) * lx + Math.cos(ry) * lz, sx: 0.1, sy: 2.2, sz: 0.1, ry });
    }
    // two cardinal tents for every white one
    canopies[made % 3 ? 0 : 1].push({ x, y: 2.6, z, sx: 2.3, sy: 1, sz: 2.3, ry: ry + Math.PI / 4 });
    made++;
  }
  instances(THREE, scene, dummy, geo.box, white, legs);
  instances(THREE, scene, dummy, geo.roof, cardinal, canopies[0]);
  instances(THREE, scene, dummy, geo.roof, white, canopies[1]);
  const palms: { x: number; z: number; hgt: number }[] = [];
  // along the plaza loop, stopping short of the stands at the start of the home straight
  for (let s = 400; s < 700; s += 14) {
    for (const side of [-1, 1]) {
      const p = pointAt(t, s, side * (t.edge + 4));
      if (clear(p.x, p.z, 2)) palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
    }
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), palms.map((p) => ({ x: p.x, y: p.hgt / 2, z: p.z, sx: 1, sy: p.hgt, sz: 1 })));
  instances(THREE, scene, dummy, frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), palms.map((p, i) => ({ x: p.x, y: p.hgt + 0.2, z: p.z, sx: 1.1, sy: 1.1, sz: 1.1, ry: i * 1.3 })));

  // campus beyond: oaks, Hoover Tower and the foothills with the Dish
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 80 && n < 3000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 170 + rand() * 300;
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    if (clear(x, z, 8)) spots.push({ x, z, r: 2.6 + rand() * 3 });
  }
  oaks(c, spots);
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(cx + 160, 0, cz - 320);
  hoover.scale.setScalar(1.4);
  scene.add(hoover);
  foothills(c, cx, cz, { x: cx - 200, z: cz - 420 });
}

/** Rodin's Burghers of Calais: six weary bronze figures in long robes, standing together on a low plinth. */
function burghers(c: Scenery, x: number, z: number, ry: number) {
  const { THREE, scene, geo, rand } = c;
  const bronze = new THREE.MeshLambertMaterial({ color: 0x4a3f30, flatShading: true });
  const robe = new THREE.CylinderGeometry(0.24, 0.42, 1, 7);
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0x6f6a62 }));
  plinth.scale.set(6.4, 0.7, 4);
  plinth.position.y = 0.35;
  g.add(plinth);
  for (const [fx, fz, turn] of [[-2.2, -0.9, 0.3], [-0.8, -1.1, -0.2], [0.7, -0.8, 0.5], [2.1, -1.0, -0.4], [-1.4, 0.8, 2.6], [1.3, 0.9, -2.8]]) {
    const fig = new THREE.Group();
    const body = new THREE.Mesh(robe, bronze);
    body.scale.set(1, 1.7, 1);
    body.position.y = 0.85;
    const head = new THREE.Mesh(geo.ball, bronze);
    head.scale.set(0.17, 0.2, 0.18);
    head.position.set(0, 1.86, 0.06);
    fig.add(body, head);
    // arms hanging, raised to the head or held out in despair, each swung from the shoulder
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.3, 1.66, 0.05);
      const lift = rand() < 0.35 ? 2.5 : rand() < 0.5 ? 0.9 : 0.12;
      shoulder.rotation.set(-lift, 0, side * 0.12);
      const arm = new THREE.Mesh(geo.box, bronze);
      arm.scale.set(0.13, 0.72, 0.13);
      arm.position.y = -0.36;
      shoulder.add(arm);
      fig.add(shoulder);
    }
    fig.position.set(fx, 0.7, fz);
    fig.rotation.set((rand() - 0.5) * 0.12, turn, (rand() - 0.5) * 0.1);
    fig.scale.setScalar(1.15);
    g.add(fig);
  }
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
}

/**
 * The Main Quad: sandstone arcades with red tile roofs facing every path, with a covered colonnade over the road
 * where it runs between them, Memorial Church's gold mosaic at the head of the quad, the round planted circles of the
 * inner quad, Memorial Court with Rodin's Burghers of Calais, the Oval and Palm Drive out front, bikes parked in racks,
 * and Hoover Tower and the foothills beyond.
 */
function quad(c: Scenery) {
  const { THREE, scene, t, geo, rand, clear, dummy } = c;
  const { cx, cz } = bounds(t);
  const K = 1.25;
  const at = (e: number, n: number) => fromMap(e * K, n * K);
  const stone = new THREE.MeshLambertMaterial({ color: 0xe4cfa4 });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  // the undersides of the arcade roofs, lit by the light bouncing up off the paving
  const soffit = new THREE.MeshLambertMaterial({ color: 0xc9ae80, emissive: 0x6b5a40 });
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number };
  const columns: Item[] = [];
  const blocks: Item[] = [];
  const palms: { x: number; z: number; hgt: number }[] = [];

  // the arcade front: a sandstone band with a round arch cut out of each bay, and the windows of the halls behind
  const arches = texture(
    THREE,
    canvas(128, 96, (g) => {
      g.fillStyle = '#e4cfa4';
      g.fillRect(0, 0, 128, 96);
      noise(g, 128, 96, 300, 0.1, false);
      g.fillStyle = 'rgba(110,80,45,0.3)';
      g.fillRect(0, 0, 128, 7);
      g.strokeStyle = '#cfb07c';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(64, 96, 54, Math.PI, 0);
      g.stroke();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(64, 96, 50, Math.PI, 0);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }),
  );
  arches.wrapS = THREE.RepeatWrapping;
  const archMat = new THREE.MeshLambertMaterial({ map: arches, alphaTest: 0.5, side: THREE.DoubleSide });
  const windows = texture(
    THREE,
    canvas(64, 152, (g) => {
      g.fillStyle = '#e4cfa4';
      g.fillRect(0, 0, 64, 152);
      noise(g, 64, 152, 300, 0.1, false);
      g.fillStyle = 'rgba(110,80,45,0.35)';
      g.fillRect(0, 0, 64, 6);
      g.fillRect(0, 84, 64, 3);
      // a window upstairs with its sill, and an arched doorway on the ground floor
      g.fillStyle = '#d2b789';
      g.fillRect(19, 26, 26, 44);
      g.fillStyle = '#3a3330';
      g.fillRect(22, 29, 20, 37);
      g.fillStyle = '#5d6f7a';
      g.fillRect(24, 31, 7, 15);
      g.fillRect(33, 31, 7, 15);
      g.fillStyle = '#3a2a22';
      g.beginPath();
      g.moveTo(20, 152);
      g.lineTo(20, 112);
      g.arc(32, 112, 12, Math.PI, 0);
      g.lineTo(44, 152);
      g.fill();
    }),
  );
  windows.wrapS = THREE.RepeatWrapping;
  const hallMat = [stone, stone, stone, stone, new THREE.MeshLambertMaterial({ map: windows }), new THREE.MeshLambertMaterial({ map: windows })];
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3);
  prism.rotateY(Math.PI / 2);
  prism.rotateZ(Math.PI / 2);
  /** A geometry with its u texture coordinate run over `n` repeats. */
  const tiled = <G extends T.BufferGeometry>(g: G, n: number) => {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n);
    return g;
  };

  const COL = 3.6;
  /**
   * An arcade with its front along a..b and its back toward (ox, oz): columns, the arched front, the walkway ceiling
   * and a tile roof sloping down to the path. Behind it, unless `deep` is 0, a hall that deep and `tall` high, running
   * on past the ends of the arcade by `past` (at a's end and b's end) to fill a corner.
   */
  const arcade = (a: P2, b: P2, ox: number, oz: number, deep: number, tall: number, past: [number, number] = [0, 0]) => {
    let len = Math.hypot(b.x - a.x, b.z - a.z);
    let [ux, uz] = [(b.x - a.x) / len, (b.z - a.z) / len];
    // run a..b so that the group's +z points away from the path
    if (-uz * ox + ux * oz < 0) [a, b, ux, uz, past] = [b, a, -ux, -uz, [past[1], past[0]]];
    len = Math.hypot(b.x - a.x, b.z - a.z);
    const bays = Math.max(2, Math.round(len / 4.2));
    const bay = len / bays;
    const g = new THREE.Group();
    g.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    g.rotation.y = Math.atan2(-uz, ux);
    for (let k = 0; k <= bays; k++) {
      const x = a.x + ux * k * bay;
      const z = a.z + uz * k * bay;
      columns.push({ x, y: COL / 2, z, sx: 0.3, sy: COL, sz: 0.3 });
      blocks.push({ x, y: COL - 0.15, z, sx: 0.75, sy: 0.3, sz: 0.75, ry: g.rotation.y }, { x, y: 0.15, z, sx: 0.7, sy: 0.3, sz: 0.7, ry: g.rotation.y });
    }
    const band = 0.75 * bay;
    const front = new THREE.Mesh(tiled(new THREE.PlaneGeometry(len, band), bays), archMat);
    front.position.y = COL + band / 2;
    const top = COL + band;
    const ceiling = new THREE.Mesh(geo.box, soffit);
    ceiling.scale.set(len, 0.35, 4.2);
    ceiling.position.set(0, top - 0.17, 2.1);
    const roof = new THREE.Mesh(geo.box, tile);
    roof.scale.set(len + 0.6, 0.3, 4.9);
    roof.position.set(0, top + 0.55, 2.2);
    roof.rotation.x = -0.25;
    g.add(front, ceiling, roof);
    if (deep > 0) {
      const long = len + past[0] + past[1];
      const hall = new THREE.Mesh(tiled(new THREE.BoxGeometry(long, tall, deep), Math.max(1, Math.round(long / 4.2))), hallMat);
      hall.position.set((past[1] - past[0]) / 2, tall / 2, 4.2 + deep / 2);
      const ridge = new THREE.Mesh(prism, tile);
      ridge.scale.set(long + 0.4, 3.4, deep * 0.6);
      ridge.position.set(hall.position.x, tall + 1.55, 4.2 + deep / 2);
      g.add(hall, ridge);
    }
    scene.add(g);
    return { g, top };
  };

  // the arcades: one along the outside of every path, running on round the outside of each corner to meet the next
  // and stopping short of the road on the inside of one (the church stands at the head of the quad and the Oval opens
  // out in front, so none there). Where a path runs between two halls there is a colonnade on its other side too,
  // and a roof right over the road.
  const off = t.edge + 3.5;
  const curvAt = (s: number) => t.curv[Math.floor((((s % t.length) + t.length) % t.length) / t.step) % t.n];
  const legs: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= t.n; i++) {
    const straight = i < t.n && Math.abs(t.curv[i]) < 0.03;
    if (straight && from < 0) from = i;
    if (!straight && from >= 0) {
      legs.push([from * t.step, i * t.step]);
      from = -1;
    }
  }
  for (const [s0, s1] of legs) {
    const mid = pointAt(t, (s0 + s1) / 2);
    if (s1 - s0 < 10 || Math.abs(mid.z) > 80) continue;
    const out = insideLoop(t, mid.x - mid.tz * (t.edge + 6), mid.z + mid.tx * (t.edge + 6)) ? -1 : 1;
    const [ox, oz] = [-mid.tz * out, mid.tx * out];
    const half = (s1 - s0) / 2;
    // the front line, `along` meters from the middle of the path
    const front = (along: number, side = out): P2 => ({ x: mid.x - mid.tz * side * off + mid.tx * along, z: mid.z + mid.tx * side * off + mid.tz * along });
    // how far past the end of the path: round the outside of a bend to the corner, short of it on the inside
    const bend = (s: number) => {
      const c = curvAt(s);
      return { reach: half + 1 / Math.max(0.02, Math.abs(c)) + (Math.sign(c) === out ? -off : off), outside: Math.sign(c) !== out };
    };
    const ends = [bend(s0 - 10), bend(s1 + 10)];
    // as far as that goes toward each end without crowding the road
    const span = ends.map(({ reach }, k) => {
      let far = 0;
      while (far < reach) {
        const p = front((k ? 1 : -1) * (far + 1));
        if (!clear(p.x, p.z, 2)) break;
        far++;
      }
      return far;
    });
    const a = front(-span[0]);
    const b = front(span[1]);
    // the hall behind, as deep as fits before the next path, and on round an outside corner
    let deep = 13;
    const back = (p: P2) => clear(p.x + ox * (4.2 + deep), p.z + oz * (4.2 + deep), 1);
    while (deep > 4 && ![a, b, front(0)].every(back)) deep -= 3;
    const past = ends.map(({ outside }, k) => (outside && span[k] >= ends[k].reach - 1 ? 4.2 + deep : 0)) as [number, number];
    arcade(a, b, ox, oz, deep > 4 ? deep : 0, 9 + rand() * 2.5, past);
    const narrow = [-half, 0, half].some((along) => {
      const p = front(along, -out);
      return !clear(p.x - ox * 18, p.z - oz * 18, 0);
    });
    if (!narrow) continue;
    const { g, top } = arcade(front(-half, -out), front(half, -out), -ox, -oz, 0, 0);
    // the roof over the road, from one arcade to the other
    const ceiling = new THREE.Mesh(geo.box, soffit);
    ceiling.scale.set(2 * half, 0.45, 2 * off);
    ceiling.position.set(0, top + 0.1, -off);
    const cover = new THREE.Mesh(prism, tile);
    cover.scale.set(2 * half + 0.6, 3.8, off * 1.35);
    cover.position.set(0, top + 1.8, -off);
    g.add(ceiling, cover);
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 10), stone, columns);
  instances(THREE, scene, dummy, geo.box, stone, blocks);

  // Memorial Church at the head of the quad, its gold mosaic looking down the paths
  const church = makeChurch(THREE, geo.box);
  const head = at(11, 150);
  church.position.set(head.x, 0, head.z);
  church.scale.setScalar(1.25);
  scene.add(church);
  for (const e of [-34, 56]) {
    for (const n of [121, 135]) {
      const p = at(e, n);
      if (clear(p.x, p.z, 2)) palms.push({ x: p.x, z: p.z, hgt: 10 + rand() * 2 });
    }
  }

  // the inner quad's round planted circles: a sandstone curb, a bed of green, shrubs and a palm in each
  const bed = new THREE.MeshLambertMaterial({ color: 0x5f9a43 });
  const curbs: Item[] = [];
  const shrubs: Item[] = [];
  for (const [e, n] of [[-66, 69], [-42, 69], [-18, 69], [6, 69], [30, 69], [54, 69], [-18, 44], [6, 44], [30, 44], [54, 44]]) {
    const p = at(e, n);
    const rr = Math.min(7.5, Math.abs(locate(t, p.x, p.z).d) - t.edge - 2.5);
    if (rr < 4 || !clear(p.x, p.z, rr + 1.5)) continue;
    curbs.push({ x: p.x, y: 0.2, z: p.z, sx: rr + 0.3, sy: 0.4, sz: rr + 0.3 });
    const green = new THREE.Mesh(new THREE.CircleGeometry(rr, 28), bed);
    green.rotation.x = -Math.PI / 2;
    green.position.set(p.x, 0.41, p.z);
    scene.add(green);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + rand() * 0.3;
      const d = rr * (0.45 + rand() * 0.35);
      const sz = 0.6 + rand() * 0.6;
      shrubs.push({ x: p.x + Math.cos(a) * d, y: 0.5 + sz * 0.4, z: p.z + Math.sin(a) * d, sx: sz, sy: sz * 0.8, sz, ry: a });
    }
    palms.push({ x: p.x, z: p.z, hgt: 8 + rand() * 4 });
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 28), stone, curbs);
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color: 0x3f7a35, flatShading: true }), shrubs);

  // Memorial Court: two lawns either side of the path in, the Burghers of Calais between them, palms at the corners
  const lawn = new THREE.MeshLambertMaterial({ color: 0x79ad55 });
  for (const [e, n, w, d] of [[-50, -68, 34, 26], [20, -68, 26, 26]]) {
    const p = at(e, n);
    if (![[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => clear(p.x + (a * w) / 2, p.z + (b * d) / 2, 1))) continue;
    const m = new THREE.Mesh(geo.plane, lawn);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(p.x, 0.03, p.z);
    scene.add(m);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) palms.push({ x: p.x + (a * (w / 2 - 2)), z: p.z + (b * (d / 2 - 2)), hgt: 9 + rand() * 3 });
  }
  const court = at(-14, -66);
  burghers(c, court.x, court.z, Math.PI);

  // bikes parked in racks along the court, the way they are outside every building on campus
  const kit = bikeKit(THREE);
  const rack = new THREE.MeshLambertMaterial({ color: 0x8e9398 });
  for (const [e, n, count] of [[-60, -86, 4], [10, -86, 4], [-27, 56, 3]]) {
    for (let k = 0; k < count; k++) {
      const p = at(e + k, n);
      if (!clear(p.x, p.z, 1)) continue;
      const { g } = makeBike(THREE, geo, kit, rand, false);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = (n < 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.15;
      scene.add(g);
      const hoop = new THREE.Mesh(geo.box, rack);
      hoop.scale.set(0.06, 0.8, 0.06);
      hoop.position.set(p.x, 0.4, p.z + (n < 0 ? 0.6 : -0.6));
      scene.add(hoop);
    }
  }

  // the Oval out front with palms round it, and Palm Drive running away south
  const oval = at(-14, -170);
  const ovalLawn = new THREE.Mesh(new THREE.CircleGeometry(1, 40), lawn);
  ovalLawn.rotation.x = -Math.PI / 2;
  ovalLawn.scale.set(30, 22, 1);
  ovalLawn.position.set(oval.x, 0.03, oval.z);
  scene.add(ovalLawn);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const x = oval.x + Math.cos(a) * 33;
    const z = oval.z + Math.sin(a) * 25;
    if (clear(x, z, 2)) palms.push({ x, z, hgt: 8 + rand() * 3 });
  }
  for (let n = -200; n > -460; n -= 12) {
    for (const side of [-1, 1]) {
      const p = at(-14 + side * 9, n);
      palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
    }
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), palms.map((p) => ({ x: p.x, y: p.hgt / 2, z: p.z, sx: 1, sy: p.hgt, sz: 1 })));
  instances(THREE, scene, dummy, frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), palms.map((p, i) => ({ x: p.x, y: p.hgt + 0.2, z: p.z, sx: 1.1, sy: 1.1, sz: 1.1, ry: i * 1.3 })));

  // campus beyond: oaks, Hoover Tower off to the east, and the foothills with the Dish
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 110 && n < 3000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 175 + rand() * 300;
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    if (clear(x, z, 30) && Math.abs(x - oval.x) > 26) spots.push({ x, z, r: 2.6 + rand() * 3 });
  }
  oaks(c, spots);
  const hoover = makeHoover(THREE, geo.box);
  const tower = at(190, 30);
  hoover.position.set(tower.x, 0, tower.z);
  hoover.scale.setScalar(1.3);
  scene.add(hoover);
  foothills(c, cx, cz, { x: cx + 260, z: cz - 430 });
}

/** A soft round glow, bright in the middle and fading out: pools of lamplight on the road and the like. */
function glowTexture(THREE: Three, rgb: string, alpha: number) {
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, `rgba(${rgb},${alpha})`);
      grad.addColorStop(0.55, `rgba(${rgb},${alpha * 0.45})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
}

/**
 * Hoover Nights: campus after dark. Hoover Tower floodlit with its belfry aglow, straight ahead down the start, a lit
 * fountain inside the hairpin north of it, sandstone halls with their windows lit, lamp posts all along the road
 * throwing pools of light across it, uplit palms down the start straight and oaks in silhouette, a Marguerite stop
 * where each bus waits for the start, Memorial Church off across campus, and the moon and the stars.
 */
function hoover(c: Scenery) {
  const { THREE, scene, t, r, geo, mats, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number };
  const flat = -Math.PI / 2;

  // Hoover Tower beyond the hairpins at the end of the start straight, floodlit from its base
  const foot = roomiest(t, fromMap(245, -115), 20);
  const tower = makeHoover(THREE, geo.box, true);
  tower.position.set(foot.x, 0, foot.z);
  tower.scale.setScalar(Math.min(1.3, (foot.room - t.edge - 2) / 11.3));
  scene.add(tower);
  const glow = new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,214,150', 0.5), transparent: true, depthWrite: false });
  const flood = new THREE.Mesh(geo.plane, glow);
  flood.rotation.x = flat;
  flood.scale.set(36, 36, 1);
  flood.position.set(foot.x, 0.03, foot.z);
  scene.add(flood);

  // a fountain lit up in the plaza inside the hairpin north of the tower
  const plaza = roomiest(t, fromMap(136, 86), 14);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6, 0.8, 28), new THREE.MeshLambertMaterial({ color: 0xd9c4a0, emissive: 0x2a2014 }));
  basin.position.set(plaza.x, 0.4, plaza.z);
  const water = new THREE.Mesh(new THREE.CircleGeometry(5, 28), new THREE.MeshBasicMaterial({ color: 0x6fb4ff }));
  water.rotation.x = flat;
  water.position.set(plaza.x, 0.82, plaza.z);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.7, 4, 10), new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.75 }));
  jet.position.set(plaza.x, 2.8, plaza.z);
  const pool = new THREE.Mesh(geo.plane, glow);
  pool.rotation.x = flat;
  pool.scale.set(26, 26, 1);
  pool.position.set(plaza.x, 0.03, plaza.z);
  scene.add(basin, water, jet, pool);

  // lamp posts down alternate sides of the road, each with a glowing head and a pool of light across the road
  const posts: Item[] = [];
  const arms: Item[] = [];
  const heads: Item[] = [];
  const pools: Item[] = [];
  let side = 1;
  for (let s = 6; s < t.length - 4; s += 23) {
    side = -side;
    const base = pointAt(t, s, side * (t.edge + 0.9));
    if (!clear(base.x, base.z, 0.4)) continue;
    const ry = headingOf(base.tx, base.tz);
    const head = pointAt(t, s, side * (t.edge - 0.7));
    const pool = pointAt(t, s, side * (t.edge - 4.5));
    posts.push({ x: base.x, y: 3.2, z: base.z, sx: 0.2, sy: 6.4, sz: 0.2 });
    arms.push({ x: (base.x + head.x) / 2, y: 6.35, z: (base.z + head.z) / 2, sx: 1.8, sy: 0.12, sz: 0.12, ry });
    heads.push({ x: head.x, y: 6.2, z: head.z, sx: 0.9, sy: 0.2, sz: 0.5, ry });
    pools.push({ x: pool.x, y: 0.075, z: pool.z, sx: 12, sy: 12, sz: 1, rx: flat });
  }
  const metal = new THREE.MeshLambertMaterial({ color: 0x30333c });
  instances(THREE, scene, dummy, geo.box, metal, posts);
  instances(THREE, scene, dummy, geo.box, metal, arms);
  instances(THREE, scene, dummy, geo.box, new THREE.MeshBasicMaterial({ color: 0xfff0c8 }), heads);
  instances(THREE, scene, dummy, geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,222,160', 0.34), transparent: true, depthWrite: false }), pools);

  // sandstone halls round the course with their long sides to the road, most of their windows lit (but none down the
  // start straight, to keep the view of the tower)
  const lit = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const unlit = new THREE.MeshLambertMaterial({ color: 0x23262e });
  const hallMats = { stone: new THREE.MeshLambertMaterial({ color: 0xd9b98a, emissive: 0x1e160c }), tile: mats.tile, dark: lit };
  const fits = (x: number, z: number, ax: number, az: number, w: number, d: number) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([a, b]) => clear(x + (ax * a * w) / 2 - (az * b * d) / 2, z + (az * a * w) / 2 + (ax * b * d) / 2, 2.5)) && Math.hypot(x - foot.x, z - foot.z) > 30 && Math.hypot(x - plaza.x, z - plaza.z) > 20;
  const hall = (x: number, z: number, ry: number, w: number, d: number, h: number) => {
    const g = makeHall(THREE, geo.box, geo.roof, hallMats, w, d, h);
    g.children.forEach((o) => {
      if ((o as T.Mesh).material === lit && rand() < 0.3) (o as T.Mesh).material = unlit;
    });
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
  };
  for (let s = 158; s < t.length - 80; s += 64) {
    for (const sd of [-1, 1]) {
      const w = 22 + rand() * 12;
      const d = 11 + rand() * 4;
      const p = pointAt(t, s, sd * (t.edge + 7 + d / 2));
      if (fits(p.x, p.z, p.tx, p.tz, w, d)) hall(p.x, p.z, headingOf(p.tx, p.tz) - Math.PI / 2, w, d, 9 + rand() * 5);
    }
  }

  // uplit palms down both sides of the start straight
  const palms: { x: number; z: number; hgt: number }[] = [];
  for (let s = -40; s < 140; s += 15) {
    for (const sd of [-1, 1]) {
      const p = pointAt(t, s, sd * (t.edge + 3));
      if (clear(p.x, p.z, 1.5)) palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
    }
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x6b5440, emissive: 0x2a1c0e }), palms.map((p) => ({ x: p.x, y: p.hgt / 2, z: p.z, sx: 1, sy: p.hgt, sz: 1 })));
  instances(THREE, scene, dummy, frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x2f5a3a, emissive: 0x0e2414, side: THREE.DoubleSide }), palms.map((p, i) => ({ x: p.x, y: p.hgt + 0.2, z: p.z, sx: 1.1, sy: 1.1, sz: 1.1, ry: i * 1.3 })));
  instances(THREE, scene, dummy, geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,214,150', 0.45), transparent: true, depthWrite: false }), palms.map((p) => ({ x: p.x, y: 0.05, z: p.z, sx: 4, sy: 4, sz: 1, rx: flat })));

  // oaks in silhouette further out
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 110 && n < 4000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 30 + rand() * 360;
    const x = cx + Math.cos(a) * (rx + dist);
    const z = cz + Math.sin(a) * (rz + dist);
    if (clear(x, z, 5)) spots.push({ x, z, r: 2.4 + rand() * 3 });
  }
  oaks(c, spots);

  // a Marguerite stop on the kerb where each bus waits for the start
  const sign = texture(
    THREE,
    canvas(128, 64, (g) => {
      g.fillStyle = '#8c1515';
      g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#fff';
      g.font = 'bold 17px Inter, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('MARGUERITE', 64, 24);
      g.font = 'bold 12px Inter, Arial, sans-serif';
      g.fillText('SHUTTLE STOP', 64, 45);
    }),
  );
  const signMat = new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide });
  const shelterMat = new THREE.MeshLambertMaterial({ color: 0x5a5e68 });
  for (const h of r.hazards) {
    if (h.kind !== 'bus') continue;
    const at = pointAt(t, h.s, Math.sign(h.d) * (t.edge + 2.4));
    if (!clear(at.x, at.z, 1.2)) continue;
    const stop = new THREE.Group();
    const part = (mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(geo.box, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      stop.add(m);
    };
    part(shelterMat, 0, 2.6, 0, 1.8, 0.14, 4.2);
    part(shelterMat, 0.8, 1.3, 0, 0.12, 2.6, 4.2);
    for (const z of [-2, 2]) part(shelterMat, -0.8, 1.3, z, 0.12, 2.6, 0.12);
    part(new THREE.MeshLambertMaterial({ color: 0x6b4f37 }), 0.4, 0.5, 0, 0.5, 0.1, 3);
    part(lit, 0, 2.5, 0, 1.5, 0.06, 3.8);
    const board = new THREE.Mesh(geo.plane, signMat);
    // facing the road, on the open side
    board.position.set(-0.8, 3.4, 2.3);
    board.scale.set(1.6, 0.8, 1);
    board.rotation.y = -Math.PI / 2;
    stop.add(board);
    stop.position.set(at.x, 0, at.z);
    // the open side faces the road
    stop.rotation.y = headingOf(at.tx, at.tz) + (h.d > 0 ? Math.PI : 0);
    scene.add(stop);
  }

  // Memorial Church off across campus, the foothills beyond, and the moon and the stars
  const church = makeChurch(THREE, geo.box);
  church.position.set(cx - 60, 0, cz + rz + 180);
  church.scale.setScalar(1.25);
  scene.add(church);
  foothills(c, cx, cz, null);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(24, 32), new THREE.MeshBasicMaterial({ color: 0xf6f2dc, fog: false }));
  moon.position.set(cx - 520, 320, cz + 640);
  moon.lookAt(cx, 0, cz);
  const halo = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '190,208,255', 0.4), transparent: true, fog: false, depthWrite: false }));
  halo.scale.set(170, 170, 1);
  // just behind the moon
  halo.position.set(cx + (moon.position.x - cx) * 1.01, moon.position.y * 1.01, cz + (moon.position.z - cz) * 1.01);
  halo.lookAt(cx, 0, cz);
  scene.add(moon, halo);
  const stars: Item[] = [];
  for (let n = 0; n < 320; n++) {
    const a = rand() * Math.PI * 2;
    const up = 0.08 + Math.pow(rand(), 0.7) * 1.2;
    const size = 0.9 + rand() * rand() * 2.6;
    stars.push({ x: cx + Math.cos(a) * Math.cos(up) * 1100, y: Math.sin(up) * 1100, z: cz + Math.sin(a) * Math.cos(up) * 1100, sx: size, sy: size, sz: size });
  }
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false }), stars);
}

export const SCENERY: Record<CourseId, (c: Scenery) => void> = { palm: campus, lake, barn, dish, stadium, quad, hoover };
