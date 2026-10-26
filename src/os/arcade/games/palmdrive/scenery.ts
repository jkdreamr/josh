// Each course's look and scenery: the colors of its grass, curbs and walls, and the landmarks, trees and water
// around it. buildView (scene.ts) lays the road and walls and then hands a course's builder here the scene to fill.
import type { T } from './gl';
import type { CourseId } from './courses';
import { LANDMARKS, deltaS, fromMap, headingOf, locate, pointAt, type P2, type Track } from './track';
import type { Race } from './logic';
import { boatHull, merge, modelKit } from './model';
import { gumTrees, oakTrees, palmTrees, pineTrees, shrubs as shrubsOf } from './flora';
import { SKIES } from './sky';
import { campusExtras } from './campus';
import { boathouse, lakeLife, lilyPads, reedBeds } from './lake';
import { horse, paddockFence, redBarn, silo, tractor, windmill } from './barn';
import { holstein, knollGeometry, smallDishes } from './dish';
import { GROUNDS, groundMaterial } from './surfaces';
import { crowd, crowdTick, goalpost, lightTower, portal, scoreboard } from './stadium';
import { skyWater } from './skywater';
import { arcadeWall, bake, batchStatic, church as churchModel, dishTelescope, gableRoof, hall as hallModel, hall, hill, hooverTower, vcMats } from './landmarks';

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
  void box;
  const m = vcMats(THREE);
  return churchModel(THREE).build(m.vc, m.lit);
}

/** Hoover Tower: a tall sandstone shaft, the open belfry and the red dome; floodlit, its belfry glows at night. */
function makeHoover(THREE: Three, box: T.BoxGeometry, lit = false) {
  void box;
  const m = vcMats(THREE);
  return hooverTower(THREE, lit).build(m.vc, m.lit);
}

/** A sandstone campus building with a red tile hip roof. */
function makeHall(THREE: Three, box: T.BoxGeometry, roof: T.BufferGeometry, mats: { stone: T.Material; tile: T.Material; dark: T.Material }, w: number, d: number, h: number) {
  void box;
  void roof;
  // (after dark, given lit windows: a basic material for them, most of them lit)
  const lit = (mats.dark as T.MeshBasicMaterial).isMeshBasicMaterial ? (mats.dark as T.MeshBasicMaterial).color.getHex() : undefined;
  const mk = modelKit(THREE);
  hallModel(THREE, mk, w, d, h, w > 14, lit);
  const m = vcMats(THREE);
  return mk.build(m.vc, m.lit);
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

/**
 * A bronze of Rodin's Thinker on a sandstone plinth `r` meters out from the middle, about 4 m tall all told, spotlit from
 * above: a cone of light and a pool of it round the plinth.
 */
export function makeStatue(THREE: Three, geo: { box: T.BoxGeometry; ball: T.SphereGeometry; cone: T.ConeGeometry; plane: T.PlaneGeometry }, r: number) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xcdb48a, emissive: 0x2a2010 });
  const bronze = new THREE.MeshLambertMaterial({ color: 0x8f5e2c, emissive: 0x2e1806 });
  const add = (geom: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, 0, rz);
    g.add(m);
    return m;
  };
  const w = r * 1.45;
  // the plinth: a stepped base, the die, its cornice, a bronze plaque on the front
  const dark = new THREE.MeshLambertMaterial({ color: 0xb59c74, emissive: 0x241a0c });
  add(geo.box, dark, 0, 0.12, 0, w + 0.3, 0.24, w + 0.3);
  add(geo.box, stone, 0, 0.75, 0, w, 1.1, w);
  add(geo.box, dark, 0, 1.33, 0, w + 0.14, 0.08, w + 0.14);
  add(geo.box, stone, 0, 1.45, 0, w + 0.2, 0.14, w + 0.2);
  add(geo.box, bronze, 0, 0.8, w / 2 + 0.01, w * 0.45, 0.32, 0.02);
  // The Thinker: seated on a rock, leaning forward with his chin on his right hand and his left forearm across his
  // knee; rounded limbs, his back bowed, his feet planted on the rock's ledge
  add(geo.ball, bronze, 0, 1.78, -0.15, 0.55, 0.32, 0.5);
  add(geo.box, bronze, 0, 1.62, 0.32, 0.9, 0.22, 0.4);
  for (const sx of [-1, 1]) {
    add(geo.ball, bronze, sx * 0.2, 2.1, 0.22, 0.17, 0.15, 0.48);
    add(geo.ball, bronze, sx * 0.2, 2.06, 0.62, 0.15, 0.15, 0.15);
    add(geo.ball, bronze, sx * 0.21, 1.8, 0.66, 0.12, 0.34, 0.13, 0.12);
    add(geo.box, bronze, sx * 0.21, 1.48, 0.76, 0.15, 0.08, 0.3);
  }
  add(geo.ball, bronze, 0, 2.66, 0.02, 0.33, 0.5, 0.25, 0.45);
  add(geo.ball, bronze, 0, 2.9, -0.04, 0.36, 0.22, 0.24, 0.5);
  add(geo.ball, bronze, 0.02, 3.2, 0.38, 0.17, 0.2, 0.18, 0.3);
  add(geo.ball, bronze, 0.2, 2.78, 0.36, 0.08, 0.34, 0.08, -0.2);
  add(geo.ball, bronze, 0.18, 2.96, 0.42, 0.08, 0.1, 0.09);
  add(geo.ball, bronze, -0.24, 2.48, 0.42, 0.08, 0.08, 0.34, 0.1);
  add(geo.ball, bronze, 0.27, 2.62, 0.08, 0.1, 0.3, 0.1, 0.6);
  add(geo.ball, bronze, -0.3, 2.62, 0.08, 0.1, 0.28, 0.1, 0.4);
  // the spotlight: a soft cone down onto him, and the pool it throws round the plinth
  const beam = new THREE.Mesh(geo.cone, new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.scale.set(2.6, 8, 2.6);
  beam.position.y = 5;
  g.add(beam);
  const pool = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,236,180', 0.55), transparent: true, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(7, 7, 1);
  pool.position.y = 0.08;
  g.add(pool);
  return g;
}

/** A round sandstone planter `r` meters across the middle, with a little tree and some flowers in it. */
export function makePlanter(THREE: Three, geo0: { ball: T.SphereGeometry; wheel: T.CylinderGeometry }, r: number, rand: () => number) {
  const g = new THREE.Group();
  // (its many leaves and flowers on a lower-poly ball than the karts')
  const geo = { ...geo0, ball: new THREE.SphereGeometry(1, 8, 6) };
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
  // (bands round the bowl, and the drip of shadow under its lip)
  add(geo.wheel, new THREE.MeshLambertMaterial({ color: 0xcfb284 }), 0, 0.25, 0, r * 0.91, 0.1, r * 0.91);
  add(geo.wheel, new THREE.MeshLambertMaterial({ color: 0xcfb284 }), 0, 0.68, 0, r * 0.97, 0.08, r * 0.97);
  // flowers in clumps round the edge, trailing ivy over the lip, and a young oak in the middle
  const bloom = [0xe8486a, 0xf6d24a, 0xf3f0ea, 0xb04ad8][Math.floor(rand() * 4)];
  const flower = new THREE.MeshLambertMaterial({ color: bloom });
  const leaf = new THREE.MeshLambertMaterial({ color: 0x4f8a3c });
  const ivy = new THREE.MeshLambertMaterial({ color: 0x3a6a2e });
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + rand() * 0.3;
    add(geo.ball, leaf, Math.cos(a) * r * 0.68, 1.04, Math.sin(a) * r * 0.68, 0.24, 0.18, 0.24);
    if (k % 2) add(geo.ball, flower, Math.cos(a + 0.2) * r * 0.7, 1.16, Math.sin(a + 0.2) * r * 0.7, 0.1, 0.08, 0.1);
    if (k % 3 === 0) add(geo.ball, ivy, Math.cos(a) * r * 1.0, 0.75, Math.sin(a) * r * 1.0, 0.12, 0.3, 0.12);
  }
  const bark = new THREE.MeshLambertMaterial({ color: 0x6b4f37 });
  add(geo.wheel, bark, 0, 1.7, 0, 0.12, 1.6, 0.12);
  add(geo.wheel, bark, 0.15, 2.4, 0, 0.05, 0.6, 0.05).rotation.z = -0.6;
  add(geo.wheel, bark, -0.12, 2.5, 0.05, 0.05, 0.6, 0.05).rotation.z = 0.6;
  const crown = new THREE.MeshLambertMaterial({ color: 0x5a9442 });
  add(geo.ball, leaf, 0, 2.9, 0, r * 0.7, r * 0.6, r * 0.7);
  add(geo.ball, crown, r * 0.25, 3.4, -r * 0.1, r * 0.45, r * 0.4, r * 0.45);
  add(geo.ball, crown, -r * 0.3, 3.2, r * 0.2, r * 0.42, r * 0.38, r * 0.42);
  add(geo.ball, leaf, r * 0.1, 3.0, r * 0.35, r * 0.4, r * 0.35, r * 0.4);
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
  return { g, wheels, pedal, cranks, legs };
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

/** What every golfer shares: skin tones, polos, trousers, caps and bags to pick from. */
export function golferKit(THREE: Three) {
  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
  return {
    skin: [0xf0c8a0, 0xd9a77f, 0xb07a52, 0x7a5236].map(lambert),
    shirts: [0x8c1515, 0xf3f0ea, 0x2b6cb0, 0xf2c230, 0x3f9a4a, 0xe86a92, 0x5ab8d8, 0xff8a3d].map(lambert),
    trousers: [0xe6d8b8, 0x3a3f4a, 0xf3f0ea, 0x6b7a8f, 0x8a6f4a].map(lambert),
    caps: [0xffffff, 0x8c1515, 0x1e3a5f, 0x2f8a3c, 0x111111].map(lambert),
    bags: [0x8c1515, 0x2b2b30, 0xf3f0ea, 0x2f6b3a, 0x1e3a5f].map(lambert),
    steel: lambert(0xc4c8ce),
    grip: lambert(0x222226),
  };
}

/** A golf bag with three club heads poking out of the top, standing up along +y, its foot at the origin. */
export function golfBag(THREE: Three, geo: { box: T.BoxGeometry; wheel: T.CylinderGeometry }, kit: ReturnType<typeof golferKit>, mat: T.Material) {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(geo.wheel, mat);
  bag.scale.set(0.15, 0.85, 0.15);
  bag.position.y = 0.43;
  // the club heads sticking out of the top, in a bunch
  const clubs = new THREE.Mesh(geo.box, kit.steel);
  clubs.scale.set(0.24, 0.32, 0.16);
  clubs.position.y = 1.0;
  clubs.rotation.y = 0.4;
  g.add(bag, clubs);
  return g;
}

/**
 * A golfer facing +z in a polo and a cap: walking with the bag on their back (legs and arms swing), at a tee with a
 * club (`swing(a)` turns the arms and club through the swing, 0 at address, negative up the backswing, positive
 * through to the follow-through), or sitting at the wheel of a cart.
 */
export function makeGolfer(THREE: Three, geo: { box: T.BoxGeometry; ball: T.SphereGeometry; wheel: T.CylinderGeometry }, kit: ReturnType<typeof golferKit>, rand: () => number, pose: 'walk' | 'swing' | 'sit') {
  const pick = <M>(list: M[]) => list[Math.floor(rand() * list.length)];
  const g = new THREE.Group();
  const shirt = pick(kit.shirts);
  const skin = pick(kit.skin);
  const legsMat = pick(kit.trousers);
  const box = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  const legs: T.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.92, 0);
    box(hip, legsMat, 0, -0.44, 0.02, 0.16, 0.9, 0.22);
    if (pose === 'sit') hip.rotation.x = -1.45;
    legs.push(hip);
    g.add(hip);
  }
  const torso = box(g, shirt, 0, 1.18, 0, 0.44, 0.6, 0.27);
  const head = new THREE.Mesh(geo.ball, skin);
  head.scale.setScalar(0.125);
  head.position.set(0, 1.63, 0.01);
  g.add(head);
  const capMat = pick(kit.caps);
  const crown = new THREE.Mesh(geo.ball, capMat);
  crown.scale.set(0.13, 0.07, 0.135);
  crown.position.set(0, 1.71, 0);
  g.add(crown);
  box(g, capMat, 0, 1.68, 0.14, 0.18, 0.025, 0.13);
  const arms = new THREE.Group();
  const swingArms = new THREE.Group();
  if (pose === 'swing') {
    // both arms down to the grip in front, and the club on down to the ball
    swingArms.position.set(0, 1.42, 0.05);
    for (const side of [-1, 1]) {
      const arm = box(swingArms, side < 0 ? shirt : skin, side * 0.1, -0.28, 0.13, 0.11, 0.56, 0.11);
      arm.rotation.z = side * 0.28;
    }
    const shaft = box(swingArms, kit.steel, 0, -1.0, 0.36, 0.04, 0.95, 0.04);
    shaft.rotation.x = 0.42;
    box(swingArms, kit.steel, 0.06, -1.42, 0.55, 0.16, 0.08, 0.09);
    g.add(swingArms);
  } else {
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.28, 1.43, 0);
      box(shoulder, shirt, 0, -0.12, 0, 0.13, 0.26, 0.14);
      box(shoulder, skin, 0, -0.39, 0.02, 0.1, 0.32, 0.1);
      if (pose === 'sit') shoulder.rotation.x = -0.9;
      arms.add(shoulder);
    }
    g.add(arms);
  }
  if (pose === 'walk') {
    // the bag slung on the back, strap across the chest
    const bag = golfBag(THREE, geo, kit, pick(kit.bags));
    bag.position.set(0.1, 0.62, -0.26);
    bag.rotation.set(-0.12, 0, -0.35);
    g.add(bag);
    box(g, kit.grip, 0, 1.22, 0.14, 0.05, 0.62, 0.02).rotation.z = 0.7;
  }
  const swing = (a: number) => {
    swingArms.rotation.z = a;
    // the shoulders turn with it
    torso.rotation.y = a * 0.25;
  };
  return { g, legs, arms: arms.children as T.Group[], swing, moving: [swingArms, torso] as T.Object3D[] };
}

/**
 * A golf cart facing +z: a low white cart with a striped canopy roof, a golfer at the wheel and a bag on the back.
 * Its wheels come back with it, to roll as it drives. It is CART_LEN long and about 1.5 m wide.
 */
export function makeCart(THREE: Three, geo: { box: T.BoxGeometry; ball: T.SphereGeometry; wheel: T.CylinderGeometry; ring: T.TorusGeometry }, kit: ReturnType<typeof golferKit>, rand: () => number, driver = true) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f3ee });
  const trim = new THREE.MeshLambertMaterial({ color: 0x3a3c42 });
  const seat = new THREE.MeshLambertMaterial({ color: 0x8c1515 });
  const box = (mat: T.Material | T.Material[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  box(trim, 0, 0.36, 0, 1.44, 0.1, 3.0);
  box(white, 0, 0.6, 0, 1.4, 0.42, 2.9);
  box(white, 0, 0.92, 1.12, 1.36, 0.3, 0.66);
  box(white, 0, 0.98, -0.25, 1.3, 0.34, 0.62);
  box(seat, 0, 1.3, -0.4, 1.28, 0.62, 0.36);
  // the striped canopy on four posts
  const stripes = texture(
    THREE,
    canvas(64, 64, (c) => {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = i % 2 ? '#f4f3ee' : '#8c1515';
        c.fillRect(i * 8, 0, 8, 64);
      }
    }),
  );
  const canopy = new THREE.MeshLambertMaterial({ map: stripes });
  box(canopy, 0, 2.08, -0.12, 1.56, 0.12, 2.2);
  for (const [x, z] of [[-0.64, 0.82], [0.64, 0.82], [-0.64, -1.0], [0.64, -1.0]]) box(trim, x, 1.45, z, 0.05, 1.25, 0.05);
  // the windshield
  const glass = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xbfe0f0, transparent: true, opacity: 0.35, depthWrite: false }));
  glass.scale.set(1.24, 0.62, 0.03);
  glass.position.set(0, 1.62, 0.84);
  g.add(glass);
  // a bag or two strapped on the back
  const bags = golfBag(THREE, geo, kit, kit.bags[Math.floor(rand() * kit.bags.length)]);
  bags.position.set(-0.22, 0.85, -1.2);
  bags.rotation.x = -0.35;
  g.add(bags);
  const bag2 = golfBag(THREE, geo, kit, kit.bags[Math.floor(rand() * kit.bags.length)]);
  bag2.position.set(0.24, 0.85, -1.2);
  bag2.rotation.x = -0.35;
  g.add(bag2);
  if (driver) {
    const { g: golfer } = makeGolfer(THREE, geo, kit, rand, 'sit');
    golfer.position.set(0.33, 0.28, -0.25);
    g.add(golfer);
    const wheel = new THREE.Mesh(geo.ring, trim);
    wheel.scale.setScalar(0.17);
    wheel.position.set(0.33, 1.38, 0.42);
    wheel.rotation.x = -1.0;
    g.add(wheel);
  }
  // headlights
  for (const side of [-1, 1]) box(new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), side * 0.45, 0.82, 1.47, 0.24, 0.12, 0.04);
  const wheels: T.Mesh[] = [];
  const hub = new THREE.MeshLambertMaterial({ color: 0xdadde2 });
  for (const z of [1.0, -1.02]) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(geo.wheel, trim);
      w.scale.set(0.28, 0.22, 0.28);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 0.68, 0.28, z);
      const cap = new THREE.Mesh(geo.wheel, hub);
      cap.scale.set(0.55, 1.05, 0.55);
      w.add(cap);
      wheels.push(w);
      g.add(w);
    }
  }
  return { g, wheels };
}

/** A flagstick: a white pole with a fluttering flag (the group `flag` to wave) and the hole's number on it. */
export function makePin(THREE: Three, geo: { box: T.BoxGeometry; wheel: T.CylinderGeometry; plane: T.PlaneGeometry }, n: number, color = '#ffd23a') {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(geo.wheel, new THREE.MeshLambertMaterial({ color: 0xf6f6f2 }));
  pole.scale.set(0.07, 3, 0.07);
  pole.position.y = 1.5;
  const tip = new THREE.Mesh(geo.wheel, new THREE.MeshLambertMaterial({ color: 0x8c1515 }));
  tip.scale.set(0.09, 0.12, 0.09);
  tip.position.y = 3.02;
  g.add(pole, tip);
  const cloth = texture(
    THREE,
    canvas(64, 48, (c) => {
      c.fillStyle = color;
      c.fillRect(0, 0, 64, 48);
      c.fillStyle = '#8c1515';
      c.font = 'bold 30px Inter, Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(n), 32, 26);
    }),
  );
  const flag = new THREE.Group();
  flag.position.set(0, 2.62, 0);
  const sheet = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: cloth, side: THREE.DoubleSide }));
  sheet.scale.set(1.05, 0.72, 1);
  sheet.position.x = 0.55;
  flag.add(sheet);
  g.add(flag);
  return { g, flag };
}

/** Raked white sand with a soft, lumpy edge: a bunker seen from above. */
export function bunkerTexture(THREE: Three, seed = 3) {
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      const lumps = scatter(seed);
      g.fillStyle = '#eadcb0';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        g.beginPath();
        g.arc(64 + Math.cos(a) * 24 * lumps(), 64 + Math.sin(a) * 24 * lumps(), 30 + lumps() * 10, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-atop';
      // the rake lines, in gentle curves, then a little grain
      g.strokeStyle = 'rgba(150,120,70,0.32)';
      g.lineWidth = 1.5;
      for (let y = -20; y < 150; y += 7) {
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(40, y - 10, 88, y + 10, 128, y);
        g.stroke();
      }
      noise(g, 128, 128, 900, 0.18, false);
      noise(g, 128, 128, 500, 0.4);
      // a darker, damp lip round the edge
      g.globalCompositeOperation = 'source-over';
    }),
  );
}

/**
 * Pond water: blue with soft ripples, to be tiled in world space so overlapping ponds join up seamlessly; lit, a deep
 * teal glowing from below (fountains and pools after dark).
 */
export function waterTexture(THREE: Three, lit = false) {
  const tex = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = lit ? '#0d5d6c' : '#3f8cc4';
      g.fillRect(0, 0, 128, 128);
      const r = scatter(17);
      for (let i = 0; i < 34; i++) {
        g.strokeStyle = lit ? `rgba(150,255,240,${0.12 + r() * 0.3})` : `rgba(255,255,255,${0.1 + r() * 0.18})`;
        g.lineWidth = 1 + r() * 1.5;
        const x = r() * 128;
        const y = r() * 128;
        const w = 10 + r() * 22;
        g.beginPath();
        g.ellipse(x, y, w, 2 + r() * 2, 0, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
      noise(g, 128, 128, 400, 0.06);
    }),
  );
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
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
  /**
   * Where the road drops away: a striped lip with blinking studs and lit water or a dark pit past it (the default), on
   * the golf course just red stakes along the water's edge (the ponds show themselves), or on the Dish the lip with the
   * hillside falling away past it, a broken-down ranch fence on the slope.
   */
  edge?: 'lip' | 'stakes' | 'slope';
  /**
   * What fishes a kart out after a fall: the night crew's crane hook (the default), a giant golf ball retriever, a drone,
   * or on the water the coach's launch, towing you off the mud.
   */
  rescue?: 'hook' | 'retriever' | 'drone' | 'launch';
  /**
   * A road of glass in the sky (the Cardinal Skyway): no ground under it, the road a lit ribbon with white edge lines and a
   * neon lip where it ends, glass rails where it has walls, and campus far below (see skyway()).
   */
  glass?: boolean;
  /** From this lap of your own the road's glow fades to almost nothing and the fog closes in (the Skyway's last lap). */
  blackout?: number;
  /** On the water (Redwood Slough): the channel's colors, deep in the middle to shallow at its banks, and its foam. */
  water?: { deep: string; shallow: string; foam: string };
  /** From this lap of your own the fog comes in: near and far, and its color. */
  fogLap?: { lap: number; near: number; far: number; color: number };
  /** From this lap of your own the night closes in and half the street lamps go out (Hoover Nights' last lap). */
  lightsOut?: number;
  /** Where the sun's light comes from (the default is high in the south-west). */
  sunAt?: [number, number, number];
};
export const LOOKS: Record<CourseId, Look> = {
  palm: { fog: [0xf3d6b4, 140, 720], sky: 0xfff3df, ground: 0x6e8a4a, sun: [0xffe4bd, 1.5], field: '#c4b468', lawn: '#6fa94e', curb: ['#f4f1ea', '#d23a2e'], wall: '#e6cfa6', band: '#8c1515', banner: 'PALM DRIVE', road: '#4a4a52' },
  lake: { fog: [0xeeb08e, 120, 640], sky: 0xffd8c2, ground: 0x5d6b4a, sun: [0xffb07a, 1.4], field: '#b8a862', lawn: '#79a85a', curb: ['#f4f1ea', '#2f6fb5'], wall: '#b98b5e', band: '#2f6fb5', banner: 'LAKE LAGUNITA', road: '#4a4a52' },
  barn: { fog: [0xe9e4cf, 150, 720], sky: 0xfff4dd, ground: 0x6b7a44, sun: [0xfff0d0, 1.5], field: '#c9b26a', lawn: '#88ad59', curb: ['#efe6cf', '#9a3a28'], wall: '#f3efe4', band: '#9a3a28', banner: 'RED BARN', road: '#8f6f4d' },
  dish: { fog: [0xe6e0c8, 160, 760], sky: 0xfff6e6, ground: 0x7a7448, sun: [0xfff2d8, 1.55], field: '#cdb46c', lawn: '#b0a95e', curb: ['#f2efe6', '#5d7a3a'], wall: '#d9cfb8', band: '#5d7a3a', banner: 'THE DISH', road: '#5e5d62', edge: 'slope' },
  stadium: { fog: [0xe2e8ef, 170, 760], sky: 0xf4f8ff, ground: 0x5f7a4a, sun: [0xfff4e0, 1.55], field: '#c4b98a', lawn: '#5aa04a', curb: ['#f4f1ea', '#8c1515'], wall: '#ebe6db', band: '#8c1515', banner: 'STANFORD STADIUM', road: '#4c4c54' },
  quad: { fog: [0xf1e3c6, 150, 700], sky: 0xfff4e0, ground: 0x8a7a55, sun: [0xffecc8, 1.55], field: '#d8c39a', lawn: '#7fae58', curb: ['#f4efe4', '#8c1515'], wall: '#efe0bf', band: '#8c1515', banner: 'MAIN QUAD', road: '#c9b089', joints: '#a08766' },
  // cool moonlight, low enough to read as night with the road and karts still clear
  hoover: { fog: [0x22325e, 80, 470], sky: 0x8d9fdc, ground: 0x2a3150, sun: [0xb4c8ff, 0.8], field: '#33402c', lawn: '#3b5734', curb: ['#f4f1ea', '#d9a52e'], wall: '#c9c0b0', band: '#ffc53d', banner: 'HOOVER NIGHTS', road: '#4e4e58', night: true, lightsOut: 5 },
  // a bright late afternoon: deep green rough all round, the fairway mown in stripes beside the road
  golf: { fog: [0xf1e2bf, 150, 720], sky: 0xfff2d6, ground: 0x4f7a34, sun: [0xffe0a8, 1.6], field: '#4c8a32', lawn: '#6fb34a', curb: ['#f4f1ea', '#2f7a3a'], wall: '#efe9da', band: '#2f6b3a', banner: 'STANFORD GOLF', road: '#57575f', edge: 'stakes', rescue: 'retriever' },
  // night ninety meters up: a deep blue haze that swallows campus far below, starlight and the glow off the road
  skyway: { fog: [0x0b0d26, 120, 470], sky: 0x8d93d8, ground: 0x2a1030, sun: [0xc8ccff, 0.75], field: '#05060c', lawn: '#14161d', curb: ['#ffffff', '#ff2d6f'], wall: '#9fe8ff', band: '#c8143c', banner: 'CARDINAL SKYWAY', road: '#4a0a18', night: true, rescue: 'drone', glass: true, blackout: 5 },
  // dawn on the sloughs: a peach horizon in the east, violet overhead, low mist, and the water the road
  slough: { sunAt: [-460, 190, -160], fog: [0xf0c9ad, 140, 620], sky: 0xffd9b8, ground: 0x5d5a38, sun: [0xffc08a, 1.35], field: '#6b6a3c', lawn: '#7a6844', curb: ['#e8e2d0', '#8c1515'], wall: '#b7b0a0', band: '#8c1515', banner: 'HEAD OF THE SLOUGH', road: '#3f6f84', water: { deep: '#173f4d', shallow: '#3f6e66', foam: '#f4efe6' }, rescue: 'launch', fogLap: { lap: 5, near: 30, far: 150, color: 0xd8d4cc } },
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
/** What a course's scenery does every frame, if anything moves in it: race time, wall-clock seconds and the frame's dt. */
export type SceneryTick = (race: Race, clock: number, dt: number) => void;

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
  palmTrees(THREE, scene, dummy, palms);

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
  oakTrees(THREE, scene, dummy, oaks);

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

  // the Dish up in the foothills (the hills on the horizon all round are the sky's: see sky.ts), and the rest of
  // campus: see campus.ts
  foothills(c, 0, 0, LANDMARKS.dish);
  campusExtras(c);
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
  if (!items.length) return null;
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
  return mesh;
}

/** Oaks scattered where there is room. */
function oaks(c: Scenery, spots: { x: number; z: number; r: number }[]) {
  const { THREE, scene, dummy } = c;
  oakTrees(THREE, scene, dummy, spots);
}

/** Golden foothills in a ring 560-720 m round (cx, cz), with the Dish up on one of them unless `dish` is null. */
function foothills(c: Scenery, cx: number, cz: number, dish: { x: number; z: number } | null) {
  // (the hills on the horizon all round are the sky's: see sky.ts)
  void cx;
  void cz;
  if (!dish) return;
  const { THREE, scene } = c;
  const m = vcMats(THREE);
  scene.add(new THREE.Mesh(hill(THREE, dish.x, dish.z, 150, 34), m.vc));
  const mk = modelKit(THREE);
  mk.place(dish.x, 31, dish.z, 2.4);
  dishTelescope(THREE, mk, 0.8);
  scene.add(mk.build(m.vc, m.lit));
}

/**
 * Lake Lagunita: water fills the loop, reeds and lily pads line the shore, sailboats and ducks are out on the water,
 * the boathouse stands on its peninsula inside the hairpin, oaks and foothills all round, and the sun is going down.
 */
function lake(c: Scenery): SceneryTick {
  const { THREE, scene, t, geo, rand, clear, dummy } = c;
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
  // (the evening sky mirrored in it: see skywater.ts)
  ripples.dispose();
  scene.add(new THREE.Mesh(waterGeo, skyWater(THREE, SKIES.lake!, 0x1b3a50, 0x3a6474)));

  // reed beds of cattails and rushes along the shore, and lily pads just off it (see lake.ts)
  const reeds: { x: number; z: number; s: number }[] = [];
  const pads: { x: number; z: number; s: number }[] = [];
  const flowers: { x: number; z: number }[] = [];
  for (let s = 0; s < t.length; s += 3.5) {
    if (rand() < 0.4) continue;
    const p = pointAt(t, s, -(t.edge + 1.2 + rand() * 3));
    if (!clear(p.x, p.z, 0.8) || !insideLoop(t, p.x, p.z)) continue;
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) reeds.push({ x: p.x + (rand() - 0.5) * 2.6, z: p.z + (rand() - 0.5) * 2.6, s: 0.8 + rand() * 0.5 });
    if (rand() < 0.45) {
      const q = pointAt(t, s, -(t.edge + 5 + rand() * 9));
      if (clear(q.x, q.z, 1) && insideLoop(t, q.x, q.z)) {
        for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) {
          const x = q.x + (rand() - 0.5) * 3;
          const z = q.z + (rand() - 0.5) * 3;
          pads.push({ x, z, s: 0.5 + rand() * 0.6 });
          if (rand() < 0.25) flowers.push({ x: x + 0.15, z });
        }
      }
    }
  }
  reedBeds(THREE, scene, dummy, reeds);
  lilyPads(THREE, scene, dummy, pads, flowers);

  // somewhere out on the open water, well clear of the road
  const onWater = (margin: number) => {
    for (let n = 0; n < 400; n++) {
      const x = minX + rand() * (maxX - minX);
      const z = minZ + rand() * (maxZ - minZ);
      if (insideLoop(t, x, z) && clear(x, z, margin)) return { x, z };
    }
    return null;
  };
  // sailing dinghies with cardinal and white sails, and mallards paddling about, bobbing
  const boats: { x: number; z: number }[] = [];
  for (let b = 0; b < 6; b++) {
    const at = onWater(12);
    if (at) boats.push(at);
  }
  const ducks: { x: number; z: number }[] = [];
  for (let n = 0; n < 9; n++) {
    const at = onWater(3);
    if (at) ducks.push(at);
  }
  const life = lakeLife(THREE, scene, boats, ducks, rand);

  // the boathouse at the middle of the hairpin, on the peninsula it wraps around
  let apex = 0;
  for (let i = 0; i < t.n; i++) if (t.curv[i] > t.curv[apex]) apex = i;
  const mid = pointAt(t, apex * t.step, 1 / t.curv[apex]);
  if (clear(mid.x, mid.z, 3)) {
    const mk = modelKit(THREE);
    boathouse(THREE, mk, mid.x, mid.z, headingOf(mid.tx, mid.tz) - Math.PI / 2);
    scene.add(mk.build(new THREE.MeshLambertMaterial({ vertexColors: true }), new THREE.MeshBasicMaterial({ vertexColors: true })));
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
  palmTrees(THREE, scene, dummy, palms);

  // foothills and the Dish, Hoover Tower off across campus, and the sun going down in the west (+x)
  foothills(c, cx, cz, { x: cx + 160, z: cz - 420 });
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(cx - 260, 0, cz + 330);
  hoover.scale.setScalar(1.4);
  scene.add(hoover);
  return (_race: Race, clock: number) => life.tick(clock);
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

/**
 * The Red Barn: the big red barn and its silo along the front straight, white-railed paddocks with horses grazing,
 * the riding arena inside the hairpin, a windmill, a tractor, round bales stacked up, eucalyptus windbreaks and the
 * Dish up in the foothills.
 */
function barn(c: Scenery): SceneryTick {
  const { THREE, scene, t, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  const K = 0.9;
  const at = (e: number, n: number) => fromMap(e * K, n * K);
  const white = new THREE.MeshLambertMaterial({ color: 0xf3efe4 });
  const vm = vcMats(THREE);
  const farm = modelKit(THREE);

  // the barn itself, set back from the front straight and facing the road; the silo beside it (see barn.ts)
  const front = pointAt(t, 110, -(t.edge + 24));
  farm.place(front.x, 0, front.z, headingOf(-front.tz, front.tx));
  redBarn(THREE, farm);
  const siloAt = pointAt(t, 72, -(t.edge + 22));
  silo(farm, siloAt.x, siloAt.z);

  // round bales stacked up by the door, their straw wrapped round
  const straw = new THREE.MeshLambertMaterial({
    map: texture(
      THREE,
      canvas(64, 64, (g) => {
        g.fillStyle = '#d8b450';
        g.fillRect(0, 0, 64, 64);
        for (let i = 0; i < 90; i++) {
          g.strokeStyle = i % 3 ? 'rgba(150,110,30,0.45)' : 'rgba(255,240,170,0.6)';
          g.lineWidth = 1;
          g.beginPath();
          const y = Math.random() * 64;
          g.moveTo(0, y);
          g.lineTo(64, y + (Math.random() - 0.5) * 6);
          g.stroke();
        }
      }),
    ),
  });
  const bales: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx?: number; ry?: number }[] = [];
  const stack = pointAt(t, 150, -(t.edge + 13));
  const along = headingOf(stack.tx, stack.tz);
  for (const [row, n] of [[0, 4], [1, 3], [2, 2]] as const) {
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 2.5;
      bales.push({ x: stack.x + stack.tx * off, y: 1.2 + row * 2.1, z: stack.z + stack.tz * off, sx: 1.2, sy: 1.5, sz: 1.2, rx: Math.PI / 2, ry: along + Math.PI / 2 });
    }
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 18), straw, bales);

  // a green tractor parked by the barn
  const tractorAt = pointAt(t, 60, -(t.edge + 9));
  tractor(farm, tractorAt.x, tractorAt.z, headingOf(tractorAt.tx, tractorAt.tz) + 0.4);

  // paddocks inside the loop with horses grazing
  const coats = [0x7a4a2a, 0xa0522d, 0x2a2420, 0xe8e2d6, 0x5c3a24, 0xb98b5e];
  const manes = [0x1f1a17, 0xe9dcc0];
  const fits = (x: number, z: number, w: number, d: number) => [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([a, b2]) => clear(x + (a * w) / 2, z + (b2 * d) / 2, 3));
  for (const [e, n, w, d] of [[130, -60, 60, 44], [-110, -50, 70, 50], [-20, -30, 44, 34]] as const) {
    const p = at(e, n);
    if (!fits(p.x, p.z, w, d)) continue;
    paddockFence(farm, p.x, p.z, w, d, 0);
    for (let k = 0; k < 3; k++) {
      horse(farm, p.x + (rand() - 0.5) * (w - 10), p.z + (rand() - 0.5) * (d - 10), rand() * Math.PI * 2, coats[Math.floor(rand() * coats.length)], manes[k % 2], rand() < 0.6, rand() < 0.4);
    }
  }

  // the riding arena inside the hairpin, as big as fits: raked sand, a white rail and a couple of jumps
  const arena = roomiest(t, at(135, 185), 30);
  const ar = Math.min(20, arena.room - t.edge - 3);
  if (ar > 9) {
    const az = ar * 0.7;
    const sand = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshLambertMaterial({ map: bunkerTexture(THREE, 5) }));
    sand.rotation.x = -Math.PI / 2;
    sand.scale.set(ar, az, 1);
    sand.position.set(arena.x, 0.03, arena.z);
    sand.userData.flat = true;
    scene.add(sand);
    farm.place();
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) farm.box(0xe8e2d4, arena.x + Math.cos(a) * ar, 0.7, arena.z + Math.sin(a) * az, 0.2, 1.4, 0.2);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 4, 48), white);
    rail.rotation.x = Math.PI / 2;
    rail.scale.set(ar, az, 6);
    rail.position.set(arena.x, 1.15, arena.z);
    scene.add(rail);
    for (const [ox, oz] of [[-ar * 0.35, 0], [ar * 0.3, az * 0.2]]) {
      for (let k = 0; k < 4; k++) farm.box(k % 2 ? 0xf3efe4 : 0xc8352b, arena.x + ox - 1.5 + k, 1, arena.z + oz, 1, 0.16, 0.16);
      for (const side of [-1, 1]) farm.box(0xf3efe4, arena.x + ox + side * 2, 0.8, arena.z + oz, 0.25, 1.6, 0.25);
    }
    horse(farm, arena.x + 3, arena.z - 4, 1.2, coats[3], manes[0], false, false);
  }

  // a windmill out in the field, its fan turning
  const mill = at(-175, -10);
  let fan: T.Group | null = null;
  if (clear(mill.x, mill.z, 6)) {
    const wm = windmill(THREE, mill.x, mill.z, 2.4, vm);
    scene.add(wm.tower, wm.hub);
    fan = wm.fan;
  }
  farm.place();
  scene.add(farm.build(vm.vc, vm.lit));

  // eucalyptus windbreaks outside the loop, and oaks further out
  const gums: { x: number; z: number; h: number }[] = [];
  for (let s = 0; s < t.length; s += 9) {
    const p = pointAt(t, s, t.edge + 7 + rand() * 4);
    if (clear(p.x, p.z, 4) && !insideLoop(t, p.x, p.z) && rand() < 0.75) gums.push({ x: p.x, z: p.z, h: 15 + rand() * 9 });
  }
  gumTrees(THREE, scene, dummy, gums);
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
  return (_race: Race, clock: number) => {
    if (fan) fan.rotation.z = clock * 1.6;
  };
}

/**
 * The Dish: the big radio telescope inside the loop, smaller antennas about, rolling golden hills dotted with oaks,
 * cattle grazing, barbed wire along the road, a cattle grid by the gate and campus off in the distance.
 */
function dish(c: Scenery) {
  const { THREE, scene, t, geo, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  const K = 0.82;
  const steel = new THREE.MeshLambertMaterial({ color: 0xb9bcbf });

  // the Dish: the 150-foot telescope on its yoke, its bowl tipped to the sky, the feed held out on four legs (see
  // landmarks.ts), as big as fits inside the loop
  const big = roomiest(t, fromMap(90 * K, 150 * K), 60);
  const vm = vcMats(THREE);
  {
    const mk = modelKit(THREE);
    mk.box(0xc9c3b6, 0, 0.15, 0, 30, 0.3, 30);
    dishTelescope(THREE, mk, 0.78);
    const d = mk.build(vm.vc, vm.lit);
    d.position.set(big.x, 0, big.z);
    d.rotation.y = 2.2;
    // (its rim as wide as the old one's was, 15 m out, at most)
    d.scale.setScalar(Math.min(1, (big.room - t.edge - 6) / 24) * (15 / 23));
    scene.add(d);
  }

  // smaller antennas dotted about the hills outside the loop
  const minis: { x: number; z: number; ry: number }[] = [];
  for (let n = 0; minis.length < 4 && n < 200; n++) {
    const a = rand() * Math.PI * 2;
    const x = cx + Math.cos(a) * (rx + 40 + rand() * 120);
    const z = cz + Math.sin(a) * (rz + 40 + rand() * 120);
    if (clear(x, z, 12)) minis.push({ x, z, ry: rand() * Math.PI * 2 });
  }
  smallDishes(THREE, scene, minis, vm, modelKit);

  // rolling golden hills inside the loop and round about, clear of the road
  // (their grass the ground's own, so they rise out of it: see surfaces.ts)
  const hillMat = groundMaterial(THREE, GROUNDS.dish!);
  const hillGeo = knollGeometry(THREE);
  const hills: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = [];
  for (let n = 0; hills.length < 26 && n < 600; n++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * (Math.max(rx, rz) + 220);
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    const size = 16 + rand() * 30;
    if (!clear(x, z, size + 4) || Math.hypot(x - big.x, z - big.z) < 34) continue;
    hills.push({ x, y: -0.6, z, sx: size, sy: 4 + rand() * size * 0.35, sz: size * (0.7 + rand() * 0.5), ry: rand() * 3 });
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

  // Holstein cattle grazing off the road (all one mesh: see dish.ts)
  const herd = modelKit(THREE);
  for (let n = 0, made = 0; made < 12 && n < 400; n++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * (Math.max(rx, rz) + 120);
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    if (!clear(x, z, 5) || Math.hypot(x - big.x, z - big.z) < 30) continue;
    holstein(herd, x, z, rand() * Math.PI * 2, rand() < 0.75, made);
    made++;
  }
  herd.place();
  if (herd.count()) scene.add(herd.build(vm.vc, vm.lit));

  // barbed wire on wooden posts outside the walls
  const posts: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  const wires: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = [];
  // (with a gap where a boulder chute comes down to the road)
  const chutes = c.r.hazards.filter((h) => h.kind === 'boulder').map((h) => h.s);
  for (const side of [-1, 1]) {
    let last: { x: number; z: number } | null = null;
    for (let s = 0; s <= t.length; s += 7) {
      const p = pointAt(t, s, side * (t.edge + 3));
      const ok = clear(p.x, p.z, 2) && !chutes.some((at) => Math.abs(deltaS(t, at, s)) < 7);
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
function stadium(c: Scenery): SceneryTick {
  const { THREE, scene, t, geo, rand, clear, dummy } = c;
  const { cx, cz } = bounds(t);
  const K = 0.85;
  const concrete = new THREE.MeshLambertMaterial({ color: 0xbdb6aa });
  const cardinal = new THREE.MeshLambertMaterial({ color: 0x8c1515 });
  const white = new THREE.MeshLambertMaterial({ color: 0xf3f1ec });

  // the stands: rising tiers on the outside of the bowl, each row with its strip of cardinal seats and a crowd
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number };
  const tiers: Item[] = [];
  const seats: Item[] = [];
  const fans: { x: number; y: number; z: number; ry: number; color: number }[] = [];
  const backs: Item[] = [];
  const aisles: Item[] = [];
  const ROWS = 8;
  const STEP = 5;
  /** A block along the stretch of row `d` from s - STEP/2 to s + STEP/2, sized to that chord so bends leave no gaps. */
  const chord = (s: number, d: number) => {
    const a = pointAt(t, s - STEP / 2, d);
    const b = pointAt(t, s + STEP / 2, d);
    return { a, b, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len: Math.hypot(b.x - a.x, b.z - a.z), ry: headingOf(b.x - a.x, b.z - a.z) };
  };
  // round from the home straight to the tunnel, so the road runs out through the portal
  let block = 0;
  for (let s = -60; s <= 395; s += STEP) {
    // (an aisle of steps down the stands every seventh block)
    const aisle = block++ % 7 === 3;
    for (let row = 0; row < ROWS; row++) {
      const p = chord(s, t.edge + 3.4 + row * 2.6);
      if (!clear(p.x, p.z, 1.5)) continue;
      const h = 1.1 + row * 1.25;
      tiers.push({ x: p.x, y: h / 2, z: p.z, sx: 2.6, sy: h, sz: p.len + 0.3, ry: p.ry });
      const seat = chord(s, t.edge + 2.6 + row * 2.6);
      if (aisle) {
        aisles.push({ x: seat.x, y: h + 0.02, z: seat.z, sx: 2.62, sy: 0.06, sz: 1.2, ry: seat.ry });
        continue;
      }
      seats.push({ x: seat.x, y: h + 0.15, z: seat.z, sx: 0.9, sy: 0.3, sz: seat.len + 0.3, ry: seat.ry });
      // (the back wall along the top of the stands, and its rail)
      if (row === ROWS - 1) backs.push({ x: p.x + Math.cos(p.ry) * 1.3, y: h + 0.9, z: p.z - Math.sin(p.ry) * 1.3, sx: 0.35, sy: 1.8, sz: p.len + 0.3, ry: p.ry });
      const f = chord(s, t.edge + 2.4 + row * 2.6);
      for (let k = 0; k < 3; k++) {
        if (rand() < 0.15) continue;
        const u = (k + 0.3 + rand() * 0.4) / 3;
        const pick = rand();
        // (sitting facing the field)
        fans.push({ x: f.a.x + (f.b.x - f.a.x) * u, y: h + 0.75, z: f.a.z + (f.b.z - f.a.z) * u, ry: f.ry + Math.PI / 2, color: pick < 0.45 ? 0x8c1515 : pick < 0.75 ? 0xf6f4ef : pick < 0.88 ? 0x2a2a30 : 0xe8b34a });
      }
    }
  }
  instances(THREE, scene, dummy, geo.box, concrete, tiers);
  instances(THREE, scene, dummy, geo.box, cardinal, seats);
  instances(THREE, scene, dummy, geo.box, concrete, backs);
  instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0xd8d2c6 }), aisles);
  crowd(THREE, scene, dummy, fans);

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
  // goalposts at both ends (see stadium.ts)
  const kit = modelKit(THREE);
  for (const end of [-1, 1]) {
    const gx = fx + Math.sin(along) * end * (len / 2 - 1);
    const gz = fz + Math.cos(along) * end * (len / 2 - 1);
    goalpost(kit, gx, gz, along + (end > 0 ? 0 : Math.PI));
  }

  // the scoreboard over the east end, and light towers round the rim
  const board = pointAt(t, 190, t.edge + 30);
  if (clear(board.x, board.z, 6)) {
    const sb = new THREE.Group();
    scoreboard(kit, board.x, board.z, headingOf(board.tz, -board.tx));
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
    sb.add(screen);
    sb.position.set(board.x, 0, board.z);
    sb.rotation.y = headingOf(board.tz, -board.tx);
    scene.add(sb);
  }
  for (const s of [-40, 120, 250, 360]) {
    const p = pointAt(t, s, t.edge + 26);
    if (!clear(p.x, p.z, 2)) continue;
    lightTower(kit, p.x, p.z, headingOf(p.tz, -p.tx));
  }

  // a portal over the road where it runs out through the tunnel
  const gate = pointAt(t, 392, 0);
  portal(THREE, scene, kit, gate.x, gate.z, headingOf(gate.tx, gate.tz), t.edge * 2);
  kit.place();
  const vm = vcMats(THREE);
  scene.add(kit.build(vm.vc, vm.lit));

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
  palmTrees(THREE, scene, dummy, palms);

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
  return (_race: Race, clock: number) => crowdTick(clock);
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
  // (one mesh: it never moves)
  scene.add(bake(THREE, g, vcMats(THREE)));
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
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number };
  const columns: Item[] = [];
  const blocks: Item[] = [];
  const palms: { x: number; z: number; hgt: number }[] = [];

  const COL = 3.6;
  /**
   * An arcade with its front along a..b and its back toward (ox, oz): columns, the arched front, the walkway ceiling
   * and a tile roof sloping down to the path. Behind it, unless `deep` is 0, a hall that deep and `tall` high, running
   * on past the ends of the arcade by `past` (at a's end and b's end) to fill a corner.
   */
  const quadKit = modelKit(THREE);
  const arcade = (a: P2, b: P2, ox: number, oz: number, deep: number, tall: number, past: [number, number] = [0, 0]) => {
    let len = Math.hypot(b.x - a.x, b.z - a.z);
    let [ux, uz] = [(b.x - a.x) / len, (b.z - a.z) / len];
    // run a..b so that the group's +z points away from the path
    if (-uz * ox + ux * oz < 0) [a, b, ux, uz, past] = [b, a, -ux, -uz, [past[1], past[0]]];
    len = Math.hypot(b.x - a.x, b.z - a.z);
    const bays = Math.max(2, Math.round(len / 4.2));
    const bay = len / bays;
    const ry = Math.atan2(-uz, ux);
    const g = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, ry };
    for (let k = 0; k <= bays; k++) {
      const x = a.x + ux * k * bay;
      const z = a.z + uz * k * bay;
      columns.push({ x, y: COL / 2, z, sx: 0.3, sy: COL, sz: 0.3 });
      blocks.push({ x, y: COL - 0.15, z, sx: 0.75, sy: 0.3, sz: 0.75, ry }, { x, y: 0.15, z, sx: 0.7, sy: 0.3, sz: 0.7, ry });
    }
    const band = 0.75 * bay;
    const top = COL + band;
    // the front: a sandstone wall with a round arch through it for each bay, springing from the columns' capitals; the
    // walkway's ceiling behind it, its floor, and the tile roof over it sloping down to the path (see landmarks.ts)
    quadKit.place(g.x, 0, g.z, ry);
    quadKit.geo(arcadeWall(THREE, len, top, bays, bay - 0.55, COL, 0.5), 0xe4cfa4, 0, 0, 0);
    quadKit.box(0xd2b789, 0, top - 0.3, -0.3, len + 0.1, 0.35, 0.2);
    quadKit.box(0xc9ae80, 0, top - 0.17, 2.1, len, 0.35, 4.2);
    quadKit.box(0xcdb894, 0, 0.04, 2.1, len, 0.08, 4.2);
    quadKit.box(0xb4553a, 0, top + 0.55, 2.2, len + 0.6, 0.3, 4.9, -0.25, 0, 0);
    for (let k = 0; k < Math.round(len / 0.5); k++) quadKit.box(0x9a4530, -len / 2 + 0.25 + k * 0.5, top + 0.72, 2.2, 0.06, 0.12, 4.9, -0.25, 0, 0);
    if (deep > 0) {
      const long = len + past[0] + past[1];
      // the hall behind: two floors of framed windows, its doors on the arcade, a tile hip roof (see landmarks.ts)
      quadKit.place(g.x + Math.cos(ry) * ((past[1] - past[0]) / 2) + Math.sin(ry) * (4.2 + deep / 2), 0, g.z - Math.sin(ry) * ((past[1] - past[0]) / 2) + Math.cos(ry) * (4.2 + deep / 2), ry);
      hall(THREE, quadKit, long, deep, tall, false);
    }
    quadKit.place();
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
    quadKit.place(g.x, 0, g.z, g.ry);
    quadKit.box(0xc9ae80, 0, top + 0.1, -off, 2 * half, 0.45, 2 * off);
    quadKit.geo(gableRoof(THREE, off * 2.7, 2 * half + 0.6, 3.6), 0xb4553a, 0, top + 0.3, -off, 1, 1, 1, 0, Math.PI / 2, 0);
    quadKit.place();
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 12), stone, columns);
  instances(THREE, scene, dummy, geo.box, stone, blocks);
  const vm = vcMats(THREE);
  scene.add(quadKit.build(vm.vc, vm.lit));

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
  shrubsOf(THREE, scene, dummy, shrubs.map((b) => ({ x: b.x, z: b.z, r: b.sx * 0.9 })), 0x4f8a3a, 0x1c3a16);

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
  // (all of them baked into one mesh: they never move)
  const parked = new THREE.Group();
  scene.add(parked);
  for (const [e, n, count] of [[-60, -86, 4], [10, -86, 4], [-27, 56, 3]]) {
    for (let k = 0; k < count; k++) {
      const p = at(e + k, n);
      if (!clear(p.x, p.z, 1)) continue;
      const { g } = makeBike(THREE, geo, kit, rand, false);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = (n < 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.15;
      parked.add(g);
      const hoop = new THREE.Mesh(geo.box, rack);
      hoop.scale.set(0.06, 0.8, 0.06);
      hoop.position.set(p.x, 0.4, p.z + (n < 0 ? 0.6 : -0.6));
      parked.add(hoop);
    }
  }
  scene.add(bake(THREE, parked, vm));
  scene.remove(parked);

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
  palmTrees(THREE, scene, dummy, palms);

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
 * Hoover Nights: campus after dark, under construction. Hoover Tower floodlit with its belfry aglow, straight ahead down
 * the start; Tanner Fountain lit up inside the first hairpin, and the Claw's basin inside the third; the Dig between the
 * second hairpin's legs, with its rebar, work lights and the tower crane whose hook fishes karts out; the reflecting pool
 * outside the sweeper and the Arboretum's ditch down the west side; sandstone halls with their windows lit, lamp posts
 * along the walled stretches throwing pools of light across the road, uplit palms down the start straight and oaks in
 * silhouette, a Marguerite stop where each bus waits for the start, Memorial Church lit up beyond the north straight, and
 * the moon and the stars. (Map points are world meters times 1.25, like the route.)
 */
function hoover(c: Scenery): SceneryTick {
  const { THREE, scene, t, r, geo, mats, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number };
  const flat = -Math.PI / 2;
  const K = 1.25;
  const at = (east: number, north: number) => fromMap(east * K, north * K);

  // Hoover Tower beyond the first hairpin, straight down the start straight, floodlit from its base
  const foot = roomiest(t, fromMap(156, -132), 20);
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

  // the water inside the hairpins: Tanner Fountain inside the first, its lit jets and mist, and the Claw's basin inside
  // the third with the bronze claw rising out of it; laid in world space like the water along the road's edge, so the
  // two join up
  const ripples = waterTexture(THREE, true);
  const pondMat = new THREE.MeshBasicMaterial({ map: ripples, color: 0x9fe6f0 });
  const basinOf = (p: { x: number; z: number }, radius: number) => {
    const disc = new THREE.CircleGeometry(radius, 40);
    disc.rotateX(flat);
    const pos = disc.getAttribute('position');
    const uv = disc.getAttribute('uv');
    for (let j = 0; j < pos.count; j++) uv.setXY(j, (pos.getX(j) + p.x) / 12, (pos.getZ(j) + p.z) / 12);
    const m = new THREE.Mesh(disc, pondMat);
    m.position.set(p.x, 0.029, p.z);
    scene.add(m);
  };
  const tanner = at(70, -106);
  basinOf(tanner, 7);
  const spray = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.7, depthWrite: false });
  const jets: T.Mesh[] = [];
  const jetGeo = new THREE.CylinderGeometry(0.12, 0.45, 1, 8, 1, true);
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI * 2;
    const j = new THREE.Mesh(jetGeo, spray);
    const rr = k === 6 ? 0 : 3;
    j.position.set(tanner.x + Math.cos(a) * rr, 0, tanner.z + Math.sin(a) * rr);
    jets.push(j);
    scene.add(j);
  }
  const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, '200,240,255', 0.45), transparent: true, depthWrite: false }));
  mist.position.set(tanner.x, 3, tanner.z);
  mist.scale.set(12, 9, 1);
  scene.add(mist);
  const claw = at(117, 78);
  basinOf(claw, 6.2);
  const bronze = new THREE.MeshLambertMaterial({ color: 0x8f5e2c, emissive: 0x3a1e08 });
  for (let k = 0; k < 5; k++) {
    // five curled bronze fingers rising out of the water
    const a = (k / 5) * Math.PI * 2;
    const finger = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.22, 6, 12, Math.PI * 0.9), bronze);
    finger.position.set(claw.x + Math.cos(a) * 1.1, 0.2, claw.z + Math.sin(a) * 1.1);
    finger.rotation.set(0, -a + Math.PI / 2, Math.PI / 2);
    scene.add(finger);
  }
  for (const p of [tanner, claw]) {
    const pool = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '120,230,255', 0.35), transparent: true, depthWrite: false }));
    pool.rotation.x = flat;
    pool.scale.set(18, 18, 1);
    pool.position.set(p.x, 0.04, p.z);
    scene.add(pool);
  }

  // the Dig between the legs of the second hairpin: rebar sticking up out of the dark, work lights on tall posts and a
  // hoarding with the banner; and the tower crane beside it, its jib slowly swinging and its beacon blinking
  const rebar: Item[] = [];
  const lights: Item[] = [];
  for (let n = 0; rebar.length < 70 && n < 900; n++) {
    const p = at(-30 + rand() * 110, -85 + rand() * 16);
    const a2 = locate(t, p.x, p.z);
    if (Math.abs(a2.d) < t.half + 3) continue;
    rebar.push({ x: p.x, y: -0.2, z: p.z, sx: 0.08, sy: 1.5 + rand() * 2.5, sz: 0.08, rx: (rand() - 0.5) * 0.3 });
  }
  instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0x8a4a2a, emissive: 0x2a1006 }), rebar);
  for (const [e, n] of [[-20, -77], [25, -77], [70, -77], [-35, -48], [60, -48], [120, -48]] as const) {
    const p = at(e, n);
    if (Math.abs(locate(t, p.x, p.z).d) < t.half + 1.5) continue;
    lights.push({ x: p.x, y: 4, z: p.z, sx: 0.25, sy: 8, sz: 0.25 });
  }
  instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0xffb300, emissive: 0x3a2a00 }), lights);
  instances(THREE, scene, dummy, geo.box, new THREE.MeshBasicMaterial({ color: 0xfff6dc }), lights.map((l) => ({ ...l, y: 8.2, sx: 1.4, sy: 0.6, sz: 0.5 })));
  instances(THREE, scene, dummy, geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,240,200', 0.4), transparent: true, depthWrite: false }), lights.map((l) => ({ ...l, y: 0.06, sx: 16, sy: 16, sz: 1, rx: flat })));
  {
    const banner = texture(
      THREE,
      canvas(256, 48, (g2) => {
        g2.fillStyle = '#8c1515';
        g2.fillRect(0, 0, 256, 48);
        g2.fillStyle = '#fff';
        g2.font = 'bold 24px Inter, Arial, sans-serif';
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.fillText('BUILDING THE FUTURE', 128, 26);
      }),
    );
    // on the hoarding down the middle of the Dig, read from both legs of the hairpin
    const p = at(25, -77);
    const board = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: banner, side: THREE.DoubleSide }));
    board.position.set(p.x, 3.6, p.z);
    board.scale.set(16, 3, 1);
    scene.add(board);
  }
  const craneAt = at(20, -20);
  const crane = new THREE.Group();
  crane.position.set(craneAt.x, 0, craneAt.z);
  const craneMat = new THREE.MeshLambertMaterial({ color: 0xf2b705, emissive: 0x3a2a00 });
  const part = (parent: T.Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: T.Material = craneMat) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  part(crane, 0, 20, 0, 1.6, 40, 1.6);
  const jib = new THREE.Group();
  jib.position.y = 40.5;
  crane.add(jib);
  part(jib, 0, 0, 16, 1.2, 1.2, 38);
  part(jib, 0, 0, -9, 1.2, 1.2, 14);
  part(jib, 0, -0.6, -14, 3, 2.4, 3, new THREE.MeshLambertMaterial({ color: 0x55585e }));
  part(jib, 0, 1.6, 0, 2, 2, 2.4);
  const beacon = part(jib, 0, 3, 0, 0.6, 0.6, 0.6, new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  scene.add(crane);

  // the reflecting pool's lamp reflections, quivering on the water outside the sweeper
  const glints: Item[] = [];
  for (let s = 436; s < 486; s += 7) {
    const p = pointAt(t, s, t.edge + 4 + rand() * 3);
    glints.push({ x: p.x, y: 0.05, z: p.z, sx: 1.2, sy: 4 + rand() * 2, sz: 1, rx: flat, ry: rand() * 0.4 });
  }
  instances(THREE, scene, dummy, geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,230,170', 0.5), transparent: true, depthWrite: false }), glints);

  // the sprinkler planters along the inside verge of the sweeper, one per wet patch, with a pop-up head each (the
  // sprinklers that turn across the road are the set pieces themselves: see the scene)
  const planters: Item[] = [];
  const nozzles: Item[] = [];
  for (const h of r.hazards) {
    if (h.kind !== 'wet') continue;
    const p = pointAt(t, h.s, -(t.half + 1.9));
    planters.push({ x: p.x, y: 0.3, z: p.z, sx: 2.2, sy: 0.6, sz: 1.2, ry: headingOf(p.tx, p.tz) });
    nozzles.push({ x: p.x, y: 0.75, z: p.z, sx: 0.16, sy: 0.3, sz: 0.16 });
  }
  if (planters.length) {
    instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0xcdb48a, emissive: 0x2a2214 }), planters);
    instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0x2f6a3a, emissive: 0x0a2010 }), planters.map((p) => ({ ...p, y: 0.62, sx: 2.0, sy: 0.08, sz: 1.0 })));
    instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0x3a3d46 }), nozzles);
  }

  // ferns along the far side of the Arboretum's ditch
  const ferns: Item[] = [];
  for (let s = 896; s < 972; s += 2.5) {
    const p = pointAt(t, s, t.half + 0.6 + 8 + rand() * 2);
    if (clear(p.x, p.z, -1)) ferns.push({ x: p.x, y: 0.4, z: p.z, sx: 0.9 + rand() * 0.6, sy: 0.7 + rand() * 0.4, sz: 0.9 + rand() * 0.6, ry: rand() * 6 });
  }
  instances(THREE, scene, dummy, frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x2f6a3a, emissive: 0x0a2010, side: THREE.DoubleSide }), ferns);

  // lamp posts down alternate sides of the road, each with a glowing head and a pool of light across the road; on the
  // last lap every other one down Memorial Church's straight and the west straight goes out (see the tick), leaving the
  // headlights and the beacons
  const posts: Item[] = [];
  const arms: Item[] = [];
  const heads: Item[] = [];
  const pools: Item[] = [];
  const outHeads: Item[] = [];
  const outPools: Item[] = [];
  let side = 1;
  let dark = 0;
  for (let s = 6; s < t.length - 4; s += 23) {
    side = -side;
    const base = pointAt(t, s, side * (t.edge + 0.9));
    if (!clear(base.x, base.z, 0.4)) continue;
    const ry = headingOf(base.tx, base.tz);
    const head = pointAt(t, s, side * (t.edge - 0.7));
    const pool = pointAt(t, s, side * (t.edge - 4.5));
    posts.push({ x: base.x, y: 3.2, z: base.z, sx: 0.2, sy: 6.4, sz: 0.2 });
    arms.push({ x: (base.x + head.x) / 2, y: 6.35, z: (base.z + head.z) / 2, sx: 1.8, sy: 0.12, sz: 0.12, ry });
    const goes = ((s > 762 && s < 898) || (s > 928 && s < 1052)) && dark++ % 2 === 0;
    (goes ? outHeads : heads).push({ x: head.x, y: 6.2, z: head.z, sx: 0.9, sy: 0.2, sz: 0.5, ry });
    (goes ? outPools : pools).push({ x: pool.x, y: 0.075, z: pool.z, sx: 12, sy: 12, sz: 1, rx: flat });
  }
  // (the poles: a flared cast base, a tapering shaft, the arm out over the road on its bracket; one mesh)
  const poles = modelKit(THREE);
  for (const [k, p] of posts.entries()) {
    const a = arms[k];
    poles.place(p.x, 0, p.z, 0);
    poles.cyl(0x2a2d34, 0, 0.35, 0, 0.32, 0.7, 0.32);
    poles.cyl(0x30333c, 0, 3.4, 0, 0.1, 5.8, 0.1);
    poles.cyl(0x2a2d34, 0, 6.3, 0, 0.13, 0.25, 0.13);
    poles.place(a.x, 0, a.z, a.ry ?? 0);
    poles.box(0x30333c, 0, 6.35, 0, a.sx, 0.1, 0.1);
    poles.box(0x30333c, 0, 6.0, 0, a.sx * 0.5, 0.06, 0.06, 0, 0, 0.45);
  }
  poles.place();
  if (poles.count()) scene.add(poles.build(new THREE.MeshLambertMaterial({ vertexColors: true }), new THREE.MeshBasicMaterial({ vertexColors: true })));
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,222,160', 0.34), transparent: true, depthWrite: false });
  instances(THREE, scene, dummy, geo.box, headMat, heads);
  instances(THREE, scene, dummy, geo.plane, poolMat, pools);
  const goingOut = [instances(THREE, scene, dummy, geo.box, headMat, outHeads), instances(THREE, scene, dummy, geo.plane, poolMat, outPools)];
  const deadHeads = instances(THREE, scene, dummy, geo.box, new THREE.MeshLambertMaterial({ color: 0x3a3a40 }), outHeads);
  if (deadHeads) deadHeads.visible = false;
  let outAt = -1;

  // sandstone halls round the course with their long sides to the road, most of their windows lit (but none down the
  // start straight, to keep the view of the tower)
  const lit = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const unlit = new THREE.MeshLambertMaterial({ color: 0x23262e });
  const hallMats = { stone: new THREE.MeshLambertMaterial({ color: 0xd9b98a, emissive: 0x1e160c }), tile: mats.tile, dark: lit };
  const fits = (x: number, z: number, ax: number, az: number, w: number, d: number) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([a, b]) => clear(x + (ax * a * w) / 2 - (az * b * d) / 2, z + (az * a * w) / 2 + (ax * b * d) / 2, 2.5)) && Math.hypot(x - foot.x, z - foot.z) > 30 && Math.hypot(x - craneAt.x, z - craneAt.z) > 14;
  const hall = (x: number, z: number, ry: number, w: number, d: number, h: number) => {
    const g = makeHall(THREE, geo.box, geo.roof, hallMats, w, d, h);
    void unlit;
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
  palmTrees(THREE, scene, dummy, palms);
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

  // Memorial Church lit up beyond the north straight, the foothills beyond, and the moon and the stars
  const church = makeChurch(THREE, geo.box);
  const mem = at(-40, 140);
  church.position.set(mem.x, 0, mem.z);
  church.scale.setScalar(1.1);
  church.traverse((o) => {
    const m = o as T.Mesh;
    if (m.isMesh && (m.material as T.MeshLambertMaterial).emissive) (m.material as T.MeshLambertMaterial).emissive.setHex(0x3a2a14);
  });
  scene.add(church);
  const front = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,214,150', 0.45), transparent: true, depthWrite: false }));
  front.rotation.x = flat;
  front.scale.set(50, 50, 1);
  front.position.set(mem.x, 0.04, mem.z - 8);
  scene.add(front);
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

  return (race, clock) => {
    // lights out on the last lap (with a flicker as they go)
    const out = (race.karts[race.me]?.lap ?? 1) >= (LOOKS.hoover.lightsOut ?? 5);
    if (out && outAt < 0) outAt = clock;
    if (!out) outAt = -1;
    const lit = !out || (clock - outAt < 1.4 && Math.floor((clock - outAt) * 9) % 3 === 1);
    for (const m of goingOut) if (m) m.visible = lit;
    if (deadHeads) deadHeads.visible = !lit;
    // the fountain's jets dance, the crane's jib swings slowly to and fro and its beacon blinks
    jets.forEach((j, k) => {
      const h = k === 6 ? 5 + Math.sin(clock * 1.7) * 1.2 : 2 + Math.sin(clock * 2.3 + k) * 0.6;
      j.scale.set(1, h, 1);
      j.position.y = h / 2;
    });
    // (moving with the water along the road's edge, see the scene)
    ripples.offset.set((clock * 0.02) % 1, (clock * 0.013) % 1);
    jib.rotation.y = 0.6 + Math.sin(clock * 0.07) * 0.8;
    beacon.visible = Math.floor(clock * 1.5) % 2 === 0;
  };
}

/**
 * A golfer's swing through time, `dt` seconds from the strike: up the backswing, down through the ball, a held
 * follow-through and back to address.
 */
export function swingAt(dt: number) {
  const ease = (u: number) => u * u * (3 - 2 * u);
  if (dt < -1.1 || dt > 2.6) return 0;
  if (dt < -0.25) return -2.3 * ease((dt + 1.1) / 0.85);
  if (dt < 0) return -2.3 * (-dt / 0.25);
  if (dt < 0.3) return 2.4 * (dt / 0.3);
  if (dt < 1.5) return 2.4;
  return 2.4 * (1 - ease((dt - 1.5) / 1.1));
}

/** A green seen from above: the mown fringe round the edge and the putting surface in stripes. */
export function greenTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#5ea844';
      g.beginPath();
      g.arc(64, 64, 63, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(64, 64, 55, 0, Math.PI * 2);
      g.clip();
      for (let i = -2; i < 18; i++) {
        g.fillStyle = i % 2 ? '#8fd468' : '#83ca5e';
        g.beginPath();
        g.moveTo(i * 10, 0);
        g.lineTo(i * 10 + 10, 0);
        g.lineTo(i * 10 - 30, 128);
        g.lineTo(i * 10 - 40, 128);
        g.closePath();
        g.fill();
      }
      g.restore();
      noise(g, 128, 128, 300, 0.05);
    }),
  );
}

/**
 * The Stanford Golf Course late on a bright afternoon. The clubhouse with its red tile roofs and bell tower by the
 * first tee, a putting green in front and the cart barn round the corner; the driving range across the first straight,
 * golfers swinging in a row under the range shelter and balls flying out over the road into the range, where the
 * target greens and the netting poles are; fairways mown in stripes, bunkers, greens with their flags; the island green
 * in its pond inside the loop with a boardwalk out to it and lily pads round the edge; a fountain in the pond down
 * the 18th and a leaderboard by the 18th green; golfers swinging at tee boxes round the course, balls arcing over;
 * oaks and pines, and the foothills with the Dish beyond.
 */
function golf(c: Scenery): SceneryTick {
  const { THREE, scene, t, r, geo, mats, rand, clear, dummy } = c;
  // (what is already there: everything this adds that never moves is batched at the end, see landmarks.ts)
  const before = new Set(scene.children);
  const moving: T.Object3D[] = [];
  const { cx, cz, rx, rz } = bounds(t);
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number };
  const flat = -Math.PI / 2;
  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
  const kit = golferKit(THREE);
  const ponds = r.hazards.filter((h) => h.kind === 'water');
  const wet = (x: number, z: number, margin: number) => ponds.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + margin);
  /** Places kept for something already: trees stay out of them. */
  const kept: { x: number; z: number; r: number }[] = [];
  const keep = (x: number, z: number, rad: number) => kept.push({ x, z, r: rad });
  const free = (x: number, z: number, margin: number) => clear(x, z, margin) && !wet(x, z, margin) && !kept.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + margin);
  /** Facing back toward the road from (s, d): the heading that points across at the centerline. */
  const toRoad = (s: number, d: number) => {
    const p = pointAt(t, s);
    return headingOf(p.tz * Math.sign(d), -p.tx * Math.sign(d));
  };
  const mesh = (g: T.BufferGeometry, m: T.Material | T.Material[], x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    o.rotation.y = ry;
    scene.add(o);
    return o;
  };
  const decal = (m: T.Material, x: number, z: number, w: number, d: number, y: number, ry = 0, order = 1) => {
    const o = new THREE.Mesh(geo.plane, m);
    o.rotation.set(flat, 0, ry);
    o.scale.set(w, d, 1);
    o.position.set(x, y, z);
    o.renderOrder = order;
    scene.add(o);
    return o;
  };

  /** Mown strips beside the road, [from, to, between d and d], where no trees grow. */
  const lawns: [number, number, number, number][] = [];
  /** A flat strip alongside the road from s0 to s1, between offsets a and b: a fairway, the range, its mats. */
  const strip = (s0: number, s1: number, a: number, b: number, y: number, m: T.Material, vLen = 10) => {
    lawns.push([s0, s1, Math.min(a, b), Math.max(a, b)]);
    const count = Math.max(1, Math.round((s1 - s0) / 2));
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= count; k++) {
      const s = s0 + ((s1 - s0) * k) / count;
      const pa = pointAt(t, s, a);
      const pb = pointAt(t, s, b);
      pos.push(pa.x, y, pa.z, pb.x, y, pb.z);
      uv.push(0, (s - s0) / vLen, 1, (s - s0) / vLen);
      if (k < count) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, m);
    scene.add(o);
    return o;
  };
  const mown = texture(
    THREE,
    canvas(32, 64, (g) => {
      g.fillStyle = '#69ad46';
      g.fillRect(0, 0, 32, 64);
      g.fillStyle = '#5c9f3d';
      g.fillRect(0, 0, 32, 32);
      noise(g, 32, 64, 120, 0.06, false);
    }),
  );
  mown.wrapS = mown.wrapT = THREE.RepeatWrapping;
  const fairway = new THREE.MeshLambertMaterial({ map: mown, side: THREE.DoubleSide });
  const sandTex = bunkerTexture(THREE, 5);
  const sandMat = new THREE.MeshLambertMaterial({ map: sandTex, transparent: true, depthWrite: false });
  const greenMat = new THREE.MeshLambertMaterial({ map: greenTexture(THREE), transparent: true, depthWrite: false });
  const bunker = (x: number, z: number, size: number) => {
    if (!free(x, z, size * 0.6)) return;
    decal(sandMat, x, z, size * 2.3, size * 1.7, 0.05, rand() * Math.PI * 2, 2);
  };
  const flags: T.Group[] = [];
  /** A green with its flag in the cup. */
  const green = (x: number, z: number, rad: number, n: number, color?: string) => {
    decal(greenMat, x, z, rad * 2, rad * 2, 0.045, rand() * 6, 1);
    const pin = makePin(THREE, geo, n, color);
    const off = rad * 0.3;
    pin.g.position.set(x + off * (rand() - 0.5), 0, z + off * (rand() - 0.5));
    scene.add(pin.g);
    flags.push(pin.flag);
    moving.push(pin.flag);
    keep(x, z, rad + 2);
  };

  // golfers swinging at tees, and the balls they send arcing off (purely for show; the balls that land on the road
  // are the course's own, with their tees, in scene.ts)
  type Shot = { swing: (a: number) => void; ball: T.Mesh; from: T.Vector3; to: T.Vector3; every: number; phase: number; flight: number; high: number };
  const shots: Shot[] = [];
  const ballGeo = new THREE.SphereGeometry(0.42, 10, 8);
  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const markerMats = [lambert(0x2b6cb0), lambert(0xf3f0ea), lambert(0xd8312a)];
  /** A tee box at (x, z) with a golfer driving off it toward (tx, tz). */
  const tee = (x: number, z: number, tx: number, tz: number, every: number, phase: number, box = true) => {
    const dir = Math.atan2(tz - z, tx - x);
    const ux = Math.cos(dir);
    const uz = Math.sin(dir);
    if (box) {
      decal(fairway, x, z, 5, 4, 0.035, -dir, 1);
      const marker = markerMats[Math.floor(rand() * 3)];
      for (const side of [-1, 1]) mesh(geo.ball, marker, x + -uz * side * 2 + ux * 1.2, 0.15, z + ux * side * 2 + uz * 1.2, 0.16, 0.16, 0.16);
      // a ball washer by the tee
      mesh(geo.box, lambert(0x2f6b3a), x - uz * 3.2, 0.5, z + ux * 3.2, 0.08, 1, 0.08);
      mesh(geo.box, lambert(0xd8d4c8), x - uz * 3.2, 1.05, z + ux * 3.2, 0.26, 0.22, 0.18);
    }
    const golfer = makeGolfer(THREE, geo, kit, rand, 'swing');
    // standing side-on to the shot, the ball in front of them and the target off to their left
    const ry = Math.atan2(-uz, ux);
    golfer.g.rotation.y = ry;
    golfer.g.position.set(x - Math.sin(ry) * 0.85, 0, z - Math.cos(ry) * 0.85);
    golfer.g.scale.setScalar(1.1);
    scene.add(golfer.g);
    const bag = golfBag(THREE, geo, kit, kit.bags[Math.floor(rand() * kit.bags.length)]);
    bag.position.set(x - Math.sin(ry) * 2 - ux * 1.2, 0, z - Math.cos(ry) * 2 - uz * 1.2);
    bag.rotation.z = 0.15;
    scene.add(bag);
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.visible = false;
    scene.add(ball);
    const dist = Math.hypot(tx - x, tz - z);
    shots.push({ swing: golfer.swing, ball, from: new THREE.Vector3(x, 0.3, z), to: new THREE.Vector3(tx, 0.2, tz), every, phase, flight: 1.6 + dist / 70, high: 10 + dist * 0.18 });
    moving.push(...golfer.moving, ball);
    keep(x, z, 4);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the clubhouse by the first tee, Spanish style with red tile roofs, an arcade along the front and a bell tower

  const stucco = lambert(0xf1e6cc);
  const tile = mats.tile;
  const windows = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#f1e6cc';
      g.fillRect(0, 0, 64, 64);
      noise(g, 64, 64, 150, 0.05, false);
      g.fillStyle = '#f8f2e2';
      g.fillRect(20, 14, 24, 38);
      g.fillStyle = '#3c4a5a';
      g.beginPath();
      g.moveTo(23, 50);
      g.lineTo(23, 26);
      g.arc(32, 26, 9, Math.PI, 0);
      g.lineTo(41, 50);
      g.fill();
      g.fillStyle = '#7a8fa3';
      g.fillRect(31, 18, 2, 32);
    }),
  );
  windows.wrapS = THREE.RepeatWrapping;
  const clubhouse = (s: number, d: number, w: number, deep: number) => {
    const p = pointAt(t, s, d);
    const ry = toRoad(s, d);
    const g = new THREE.Group();
    const part = (geom: T.BufferGeometry, m: T.Material | T.Material[], x: number, y: number, z: number, sx: number, sy: number, sz: number, rot = 0) => {
      const o = new THREE.Mesh(geom, m);
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.rotation.y = rot;
      g.add(o);
      return o;
    };
    const front = windows.clone();
    front.repeat.set(Math.round(w / 4.5), 1);
    front.needsUpdate = true;
    const face = new THREE.MeshLambertMaterial({ map: front });
    part(geo.box, [stucco, stucco, stucco, stucco, face, face], 0, 3.5, 0, w, 7, deep);
    part(geo.roof, tile, 0, 8.7, 0, w * 0.74, 3.4, deep * 0.78, Math.PI / 4);
    // a wing on the end, a storey lower
    part(geo.box, [stucco, stucco, stucco, stucco, face, face], -w / 2 - 6, 2.4, -1, 12, 4.8, deep - 2);
    part(geo.roof, tile, -w / 2 - 6, 6, -1, 9, 2.4, (deep - 2) * 0.78, Math.PI / 4);
    // the arcade along the front, its roof sloping down toward the course
    const cols = new THREE.InstancedMesh(geo.wheel, stucco, Math.floor((w - 1.9) / 3.6) + 1);
    let nc = 0;
    dummy.rotation.set(0, 0, 0);
    for (let x = -w / 2 + 1; x <= w / 2 - 0.9; x += 3.6) {
      dummy.position.set(x, 1.95, deep / 2 + 3.4);
      dummy.scale.set(0.28, 3.9, 0.28);
      dummy.updateMatrix();
      cols.setMatrixAt(nc++, dummy.matrix);
    }
    cols.count = nc;
    g.add(cols);
    part(geo.box, stucco, 0, 4.1, deep / 2 + 1.8, w, 0.4, 3.8);
    const lean = part(geo.box, tile, 0, 4.7, deep / 2 + 1.9, w + 0.6, 0.25, 4.4);
    lean.rotation.x = 0.28;
    // the bell tower
    part(geo.box, stucco, w / 2 - 4, 7, -1, 5.5, 14, 5.5);
    for (const [x, z, sx, sz] of [[0, 2.8, 2.2, 0.1], [0, -2.8, 2.2, 0.1], [2.8, 0, 0.1, 2.2], [-2.8, 0, 0.1, 2.2]]) part(geo.box, lambert(0x3a3330), w / 2 - 4 + x, 11.6, -1 + z, sx, 2.6, sz);
    part(geo.roof, tile, w / 2 - 4, 15.6, -1, 4.6, 3.2, 4.6, Math.PI / 4);
    // the name over the arcade
    const sign = texture(
      THREE,
      canvas(512, 64, (g2) => {
        g2.fillStyle = '#f8f2e2';
        g2.fillRect(0, 0, 512, 64);
        g2.fillStyle = '#2f6b3a';
        g2.font = 'bold 34px Georgia, serif';
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.fillText('STANFORD GOLF COURSE', 256, 34);
      }),
    );
    const board = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: sign }));
    board.scale.set(14, 1.75, 1);
    board.position.set(0, 6.1, deep / 2 + 0.05);
    g.add(board);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = ry;
    scene.add(g);
    keep(p.x, p.z, w / 2 + 10);
  };
  clubhouse(4, t.edge + 34, 32, 14);

  // the putting green in front of the clubhouse, a few flags in it
  {
    const p = pointAt(t, t.length - 34, t.edge + 14);
    decal(greenMat, p.x, p.z, 20, 15, 0.045, 0.2, 1);
    for (const [a, b, n] of [[-5, 2, 1], [3, -3, 2], [6, 3, 3]]) {
      const pin = makePin(THREE, geo, n, '#ffffff');
      pin.g.position.set(p.x + a, 0, p.z + b);
      pin.g.scale.setScalar(0.55);
      scene.add(pin.g);
      flags.push(pin.flag);
    }
    keep(p.x, p.z, 11);
  }

  // the cart barn round the corner, with carts parked out front
  {
    const s = t.length - 70;
    const d = t.edge + 22;
    const p = pointAt(t, s, d);
    if (free(p.x, p.z, 14)) {
      const ry = toRoad(s, d);
      const g = new THREE.Group();
      const shed = new THREE.Mesh(geo.box, lambert(0x6f7f62));
      shed.scale.set(26, 4.2, 9);
      shed.position.set(0, 2.1, -1);
      const roof = new THREE.Mesh(geo.box, lambert(0x3f4a3a));
      roof.scale.set(27, 0.35, 10.5);
      roof.position.set(0, 4.4, -0.6);
      roof.rotation.x = -0.06;
      g.add(shed, roof);
      for (let k = 0; k < 6; k++) {
        const bay = new THREE.Mesh(geo.box, lambert(0x23262b));
        bay.scale.set(3.4, 3, 0.1);
        bay.position.set(-10.5 + k * 4.2, 1.5, 3.52);
        g.add(bay);
      }
      for (let k = 0; k < 2; k++) {
        const cart = makeCart(THREE, geo, kit, rand, false);
        cart.g.position.set(-6 + k * 9, 0, 6.5);
        cart.g.rotation.y = Math.PI + (rand() - 0.5) * 0.2;
        g.add(cart.g);
      }
      g.position.set(p.x, 0, p.z);
      g.rotation.y = ry;
      scene.add(g);
      keep(p.x, p.z, 16);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the driving range: the tee line under its shelter beside the first straight, the range itself across the road

  const tee0 = 22;
  const tee1 = 152;
  const line = t.edge + 16;
  strip(tee0, tee1, line - 3, line + 4, 0.03, new THREE.MeshLambertMaterial({ color: 0x3f7a35 }), 9);
  {
    const posts: Item[] = [];
    const roofs: Item[] = [];
    for (let s = tee0; s <= tee1; s += 9) {
      const p = pointAt(t, s, line + 4);
      posts.push({ x: p.x, y: 1.9, z: p.z, sx: 0.22, sy: 3.8, sz: 0.22 });
    }
    instances(THREE, scene, dummy, geo.box, lambert(0xece6d6), posts);
    for (let s = tee0; s < tee1; s += 9) {
      const p = pointAt(t, s + 4.5, line + 2.4);
      roofs.push({ x: p.x, y: 3.95, z: p.z, sx: 9.2, sy: 0.3, sz: 4.4, ry: headingOf(p.tx, p.tz) + Math.PI / 2 });
    }
    instances(THREE, scene, dummy, geo.box, lambert(0x2f6b3a), roofs);
    // a bucket of balls at every bay
    const buckets: Item[] = [];
    const heaps: Item[] = [];
    for (let s = tee0 + 4.5; s < tee1; s += 9) {
      const p = pointAt(t, s + 2.2, line + 1.8);
      buckets.push({ x: p.x, y: 0.22, z: p.z, sx: 0.32, sy: 0.44, sz: 0.32 });
      heaps.push({ x: p.x, y: 0.45, z: p.z, sx: 0.3, sy: 0.12, sz: 0.3 });
    }
    instances(THREE, scene, dummy, geo.wheel, lambert(0x2b6cb0), buckets);
    instances(THREE, scene, dummy, geo.ball, lambert(0xffffff), heaps);
  }
  // the range itself, mown in stripes, with target greens, yardage boards and the netting along the far side
  const farSide = -(t.edge + 92);
  strip(4, 156, -(t.edge + 1.5), farSide, 0.02, fairway, 12);
  const roadBalls = r.hazards.filter((h) => h.kind === 'ball');
  const hazardTee = (s: number) => roadBalls.some((h) => h.tee && Math.abs(h.s + h.tee[0] - s) < 4.5);
  for (let s = tee0 + 4.5, n = 0; s < tee1; s += 9) {
    if (hazardTee(s) || n++ % 3 === 1) continue;
    const p = pointAt(t, s, line);
    const q = pointAt(t, s + (rand() - 0.5) * 50, -(t.edge + 30 + rand() * 55));
    tee(p.x, p.z, q.x, q.z, 4.5 + rand() * 2.5, rand() * 6, false);
  }
  for (const [s, d, rad, n] of [[40, -40, 6, 100], [98, -58, 7.5, 150], [62, -80, 8, 200], [130, -78, 6, 250]]) {
    const p = pointAt(t, s, d);
    green(p.x, p.z, rad, n, n === 150 ? '#ff6a3a' : n === 200 ? '#3a8dff' : '#ffd23a');
    bunker(p.x + rad + 2, p.z - 2, 3);
  }
  {
    const yard = (n: number) =>
      new THREE.MeshLambertMaterial({
        map: texture(
          THREE,
          canvas(128, 64, (g) => {
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, 128, 64);
            g.fillStyle = '#2f6b3a';
            g.fillRect(4, 4, 120, 56);
            g.fillStyle = '#ffffff';
            g.font = 'bold 40px Inter, Arial, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(String(n), 64, 34);
          }),
        ),
      });
    for (const [s, d, n] of [[14, -38, 100], [14, -62, 150], [14, -86, 200]]) {
      const p = pointAt(t, s, d);
      // facing across the road at the tee line
      const face = yard(n);
      mesh(geo.box, [lambert(0x2f6b3a), lambert(0x2f6b3a), lambert(0x2f6b3a), lambert(0x2f6b3a), face, face], p.x, 2.2, p.z, 3.4, 1.7, 0.15, toRoad(s, d));
      mesh(geo.box, lambert(0x6b4f37), p.x, 0.7, p.z, 0.15, 1.4, 0.15);
    }
    // tall poles along the far side and the end of the range, with the net strung between them
    const poles: Item[] = [];
    const net = texture(
      THREE,
      canvas(32, 32, (g) => {
        g.strokeStyle = 'rgba(40,46,40,0.85)';
        g.lineWidth = 2;
        g.strokeRect(0, 0, 32, 32);
      }),
    );
    net.wrapS = net.wrapT = THREE.RepeatWrapping;
    net.repeat.set(10, 9);
    const netMat = new THREE.MeshLambertMaterial({ map: net, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const along = (s0: number, s1: number, d: number) => {
      for (let s = s0; s < s1; s += 19) {
        const a = pointAt(t, s, d);
        const b = pointAt(t, Math.min(s + 19, s1), d);
        if (!free(a.x, a.z, 1)) continue;
        poles.push({ x: a.x, y: 8, z: a.z, sx: 0.35, sy: 16, sz: 0.35 });
        const panel = new THREE.Mesh(geo.plane, netMat);
        panel.scale.set(Math.hypot(b.x - a.x, b.z - a.z), 15, 1);
        panel.position.set((a.x + b.x) / 2, 8.3, (a.z + b.z) / 2);
        panel.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
        scene.add(panel);
      }
    };
    along(4, 158, farSide - 4);
    instances(THREE, scene, dummy, geo.wheel, lambert(0x4a4f48), poles);
    keep(pointAt(t, 80, -(t.edge + 48)).x, pointAt(t, 80, -(t.edge + 48)).z, 70);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // fairways and greens round the rest of the course

  // the first fairway inside the sweeper, and the 18th down the outside of the home straight
  strip(170, 300, -(t.edge + 1.5), -(t.edge + 26), 0.02, fairway);
  strip(812, 1000, t.edge + 1.5, t.edge + 30, 0.02, fairway);
  strip(626, 735, -(t.edge + 1.5), -(t.edge + 20), 0.02, fairway);
  for (const [s, d] of [[200, -24], [270, -30], [860, 22], [930, 34], [990, 26], [660, -26], [720, -20]]) {
    const p = pointAt(t, s, d);
    bunker(p.x, p.z, 2.5 + rand() * 1.5);
  }
  for (const [s, d, n] of [[300, -32, 1], [702, -30, 12], [1000, 36, 9]]) {
    const p = pointAt(t, s, d);
    if (free(p.x, p.z, 10)) green(p.x, p.z, 8, n);
  }

  // the island green in the middle of its pond, with a bunker and the flag, and the boardwalk out to it
  const island = ponds.slice().sort((a, b) => b.r - a.r)[0];
  if (island) {
    const rad = Math.min(16, island.r * 0.3);
    const bank = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad + 0.6, 0.7, 40), lambert(0x8a7550));
    bank.position.set(island.x, 0.1, island.z);
    scene.add(bank);
    const top = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), lambert(0x5ea844));
    top.rotation.x = flat;
    top.position.set(island.x, 0.46, island.z);
    scene.add(top);
    decal(greenMat, island.x + 1, island.z - 1, rad * 1.5, rad * 1.5, 0.47, 0.4, 1);
    const pin = makePin(THREE, geo, 17, '#ff4a3a');
    pin.g.position.set(island.x + 2, 0.46, island.z - 2);
    scene.add(pin.g);
    flags.push(pin.flag);
    decal(sandMat, island.x - rad * 0.55, island.z + rad * 0.45, 7, 4.5, 0.48, 0.7, 2);
    // the boardwalk runs off to the shore away from the road
    let best = 0;
    let room = -1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      const x = island.x + Math.cos(a) * (island.r + 6);
      const z = island.z + Math.sin(a) * (island.r + 6);
      const gap = Math.abs(locate(t, x, z).d);
      if (gap > room) {
        room = gap;
        best = a;
      }
    }
    const len = island.r - rad + 4;
    const mid = rad + len / 2;
    const ux = Math.cos(best);
    const uz = Math.sin(best);
    const ry = Math.atan2(-uz, ux);
    const plank = lambert(0x9c7b58);
    mesh(geo.box, plank, island.x + ux * mid, 0.42, island.z + uz * mid, len, 0.18, 2.6, ry);
    const piles: Item[] = [];
    for (let k = 0; k <= len; k += 3) {
      for (const side of [-1, 1]) {
        const x = island.x + ux * (rad + k) - uz * side * 1.25;
        const z = island.z + uz * (rad + k) + ux * side * 1.25;
        piles.push({ x, y: 0.55, z, sx: 0.14, sy: 1.1, sz: 0.14 });
      }
    }
    instances(THREE, scene, dummy, geo.box, plank, piles);
    for (const side of [-1, 1]) mesh(geo.box, plank, island.x + ux * mid - uz * side * 1.25, 1.05, island.z + uz * mid + ux * side * 1.25, len, 0.1, 0.1, ry);
    // a foursome putting out
    for (let k = 0; k < 3; k++) {
      const golfer = makeGolfer(THREE, geo, kit, rand, 'walk');
      const a = rand() * Math.PI * 2;
      golfer.g.position.set(island.x + Math.cos(a) * rad * 0.6, 0.46, island.z + Math.sin(a) * rad * 0.6);
      golfer.g.rotation.y = rand() * Math.PI * 2;
      golfer.g.scale.setScalar(1.1);
      scene.add(golfer.g);
    }
  }

  // lily pads round the ponds (never right up by the road), and a fountain out in the pond down the 18th
  {
    const pads: Item[] = [];
    for (const p of ponds) {
      const want = Math.min(60, Math.round(p.r * 1.4));
      for (let n = 0, made = 0; made < want && n < want * 20; n++) {
        const a = rand() * Math.PI * 2;
        const dd = p.r * (0.55 + rand() * 0.4);
        const x = p.x + Math.cos(a) * dd;
        const z = p.z + Math.sin(a) * dd;
        if (Math.abs(locate(t, x, z).d) < t.edge + 4 || (island && Math.hypot(x - island.x, z - island.z) < Math.min(16, island.r * 0.3) + 2)) continue;
        // in clumps
        for (let k = 0; k < 3; k++) {
          const sz = 0.5 + rand() * 0.6;
          const px = x + (rand() - 0.5) * 3;
          const pz = z + (rand() - 0.5) * 3;
          if (ponds.some((o) => Math.hypot(o.x - px, o.z - pz) < o.r - 0.8)) pads.push({ x: px, y: 0.075 + rand() * 0.01, z: pz, sx: sz, sy: 0.02, sz: sz, ry: rand() * 6 });
        }
        made++;
      }
    }
    instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, 0.4, Math.PI * 2 - 0.4), lambert(0x3f7f3a), pads);
    const blooms = pads.filter((_, i) => i % 7 === 0).map((p) => ({ x: p.x + 0.2, y: 0.16, z: p.z, sx: 0.16, sy: 0.1, sz: 0.16 }));
    instances(THREE, scene, dummy, geo.ball, lambert(0xf3b6d0), blooms);
  }
  const jets: T.Mesh[] = [];
  const pool = ponds.filter((p) => p !== island);
  if (pool.length) {
    const p = pool[Math.floor(pool.length / 2)];
    // well out from the road
    const out = locate(t, p.x, p.z);
    const away = Math.sign(out.d) || 1;
    const fx = p.x - out.tz * away * p.r * 0.35;
    const fz = p.z + out.tx * away * p.r * 0.35;
    // a tall jet in the middle and a ring of lower ones, white water falling back into a churned-up ring
    const spray = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.6, depthWrite: false });
    const foam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 4.5, 28), foam);
    ring.rotation.x = flat;
    ring.position.set(fx, 0.09, fz);
    scene.add(ring);
    const jetGeo = new THREE.CylinderGeometry(0.1, 0.45, 1, 10, 1, true);
    jets.push(mesh(jetGeo, spray, fx, 0, fz, 1, 1, 1));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const jet = mesh(jetGeo, spray, fx + Math.cos(a) * 2.2, 0, fz + Math.sin(a) * 2.2, 0.6, 1, 0.6);
      jet.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      jets.push(jet);
    }
  }

  // tee boxes round the course with golfers driving off, away from the road
  for (const [s, d, every, phase] of [[318, 28, 6, 1], [640, -30, 5.5, 3], [784, 26, 6.5, 0.5], [900, 46, 5, 2.5], [236, -40, 7, 4]]) {
    const p = pointAt(t, s, d);
    if (!free(p.x, p.z, 5)) continue;
    const q = pointAt(t, s + 60, d + Math.sign(d) * 70);
    if (!clear(q.x, q.z, 2)) continue;
    tee(p.x, p.z, q.x, q.z, every, phase);
  }

  // yardage stakes down the 18th, and the leaderboard by the 18th green
  for (const [s, col] of [[850, 0x3a8dff], [900, 0xf3f0ea], [960, 0xd8312a]]) {
    const p = pointAt(t, s, t.edge + 1.6);
    mesh(geo.box, lambert(col), p.x, 0.5, p.z, 0.22, 1, 0.22);
  }
  {
    const s = 992;
    const d = -(t.edge + 15);
    const p = pointAt(t, s, d);
    if (free(p.x, p.z, 6)) {
      const board = texture(
        THREE,
        canvas(256, 192, (g) => {
          g.fillStyle = '#f8f6ee';
          g.fillRect(0, 0, 256, 192);
          g.fillStyle = '#2f6b3a';
          g.fillRect(0, 0, 256, 40);
          g.fillStyle = '#ffffff';
          g.font = 'bold 26px Georgia, serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('LEADERS', 128, 22);
          g.font = 'bold 20px Inter, Arial, sans-serif';
          g.textAlign = 'left';
          const rows: [string, string][] = [['TREE', '-9'], ['LELAND', '-7'], ['JANE', '-6'], ['HOOVER', '-4'], ['AXE', 'E']];
          rows.forEach(([name, score], i) => {
            g.fillStyle = '#1d2a22';
            g.fillText(`${i + 1}  ${name}`, 18, 62 + i * 27);
            g.fillStyle = score.startsWith('-') ? '#c62828' : '#1d2a22';
            g.textAlign = 'right';
            g.fillText(score, 238, 62 + i * 27);
            g.textAlign = 'left';
          });
        }),
      );
      const g = new THREE.Group();
      const face = new THREE.Mesh(geo.box, [lambert(0x2f6b3a), lambert(0x2f6b3a), lambert(0x2f6b3a), lambert(0x2f6b3a), new THREE.MeshLambertMaterial({ map: board }), lambert(0x2f6b3a)]);
      face.scale.set(10, 7.5, 0.4);
      face.position.y = 6.2;
      g.add(face);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(geo.box, lambert(0x2f6b3a));
        leg.scale.set(0.5, 3, 0.5);
        leg.position.set(side * 3.8, 1.5, 0);
        g.add(leg);
      }
      g.position.set(p.x, 0, p.z);
      // facing back up the 18th toward the karts coming down it, turned a little toward the road
      const q = pointAt(t, s);
      g.rotation.y = headingOf(-q.tx, -q.tz) - 0.45;
      scene.add(g);
      keep(p.x, p.z, 8);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // oaks and pines, the foothills with the Dish, and the sun getting low

  const spots: { x: number; z: number; r: number }[] = [];
  const pines: { x: number; z: number; h: number }[] = [];
  for (let n = 0; spots.length + pines.length < 200 && n < 6000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * 420;
    const x = cx + Math.cos(a) * (rx * 0.3 + dist);
    const z = cz + Math.sin(a) * (rz * 0.3 + dist);
    if (!free(x, z, 7)) continue;
    // keep the fairways, the range and the rough right by the road open
    const at = locate(t, x, z);
    if (Math.abs(at.d) < t.edge + 14 || lawns.some(([s0, s1, a, b]) => at.s > s0 - 6 && at.s < s1 + 6 && at.d > a - 6 && at.d < b + 6)) continue;
    if (rand() < 0.45) pines.push({ x, z, h: 9 + rand() * 6 });
    else spots.push({ x, z, r: 2.4 + rand() * 2.6 });
  }
  oaks(c, spots);
  pineTrees(THREE, scene, dummy, pines);
  foothills(c, cx, cz, { x: cx + 260, z: cz - 460 });

  // (all that never moves, a handful of meshes)
  batchStatic(THREE, scene, before, [...moving, ...flags, ...jets]);

  // every frame: golfers swing and their balls fly, the flags flutter and the fountain plays
  const at = new THREE.Vector3();
  return (race, clock) => {
    const time = race.time;
    for (const sh of shots) {
      const since = ((((time - sh.phase) % sh.every) + sh.every) % sh.every);
      // the strike is at the start of each cycle (or a cycle ahead, for the backswing)
      const toNext = sh.every - since;
      sh.swing(swingAt(toNext < 1.2 ? -toNext : since));
      const u = since / sh.flight;
      sh.ball.visible = u < 1;
      if (u < 1) {
        at.lerpVectors(sh.from, sh.to, u);
        at.y = sh.from.y + (sh.to.y - sh.from.y) * u + sh.high * 4 * u * (1 - u);
        sh.ball.position.copy(at);
      }
    }
    flags.forEach((f, i) => {
      f.rotation.y = Math.sin(clock * 2.1 + i * 1.7) * 0.35;
      f.scale.x = 0.9 + Math.sin(clock * 5.3 + i) * 0.1;
    });
    jets.forEach((j, k) => {
      const h = (k ? 2.2 : 7) + Math.sin(clock * 3 + k) * (k ? 0.3 : 0.6);
      j.scale.y = h;
      j.position.y = h / 2;
    });
  };
}

/** Redwood Slough's dawn: where the sun is (a unit vector toward it: just up in the east, world -x) and the sky's colors. */
export const DAWN = {
  sun: [-0.94, 0.1, -0.33] as [number, number, number],
  zenith: 0x1f2c62,
  mid: 0x5b5fa3,
  low: 0xd99aa6,
  horizon: 0xf3c7ad,
  /** The horizon under the sun: gold. */
  glowHorizon: 0xffd29a,
  sunColor: 0xffb070,
};

/** GLSL value noise and fbm, for the sky, the water and the marsh. */
export const GLSL_NOISE = /* glsl */ `
float pdHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float pdNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pdHash(i), pdHash(i + vec2(1.0, 0.0)), u.x), mix(pdHash(i + vec2(0.0, 1.0)), pdHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float pdFbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * pdNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
`;

/** The slough's dawn sky: a dome that goes where the camera goes (so its reflection in the water is right too). */
function sloughSky(THREE: Three) {
  const col = (hex: number) => ({ value: new THREE.Color(hex) });
  const uniforms = {
    uSun: { value: new THREE.Vector3(...DAWN.sun).normalize() },
    uZenith: col(DAWN.zenith),
    uMid: col(DAWN.mid),
    uLow: col(DAWN.low),
    uHorizon: col(DAWN.horizon),
    uGlowHorizon: col(DAWN.glowHorizon),
    uSunCol: col(DAWN.sunColor),
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 1400.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uZenith, uMid, uLow, uHorizon, uGlowHorizon, uSunCol;
      uniform float uTime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float mu = dot(d, uSun);
        float az = dot(normalize(d.xz + 1e-5), normalize(uSun.xz)) * 0.5 + 0.5;
        float hp = max(h, 0.0);
        vec3 hor = mix(uHorizon, uGlowHorizon, pow(az, 4.0));
        vec3 c = mix(hor, uLow, smoothstep(0.02, 0.16, hp) * (1.0 - 0.6 * pow(az, 6.0)));
        c = mix(c, uMid, smoothstep(0.12, 0.42, hp));
        c = mix(c, uZenith, smoothstep(0.38, 1.0, hp));
        // the glow round the sun, wide and warm along the horizon
        float m = max(mu, 0.0);
        c += uSunCol * (pow(m, 5.0) * 0.32 + pow(m, 40.0) * 0.5 + pow(m, 400.0) * 0.8);
        c += uSunCol * pow(az, 10.0) * 0.18 * (1.0 - smoothstep(0.0, 0.25, hp));
        // clouds: a broken deck of altocumulus, lit pink and gold from below by the low sun, and high streaks of cirrus
        if (h > 0.0) {
          vec2 p = d.xz / (h + 0.08);
          float fade = smoothstep(0.015, 0.2, h);
          float n = pdFbm(p * 1.1 + vec2(uTime * 0.006, uTime * 0.002));
          float n2 = pdFbm(p * 2.7 - vec2(uTime * 0.004, 0.0));
          float cov = smoothstep(0.5, 0.74, n * 0.8 + n2 * 0.3) * fade;
          float lit = pow(m * 0.5 + 0.5, 4.0);
          vec3 shade = mix(vec3(0.36, 0.3, 0.5), vec3(0.62, 0.4, 0.5), smoothstep(0.0, 0.5, hp));
          vec3 glow = mix(vec3(1.0, 0.6, 0.55), vec3(1.0, 0.82, 0.55), lit);
          vec3 cloud = mix(shade, glow, clamp(0.25 + 0.75 * lit + (n2 - 0.5) * 0.6, 0.0, 1.0));
          // (their thin edges catch the light)
          cloud += uSunCol * (1.0 - smoothstep(0.5, 0.62, n * 0.8 + n2 * 0.3)) * lit * 0.6;
          c = mix(c, cloud, cov * 0.88);
          vec2 q = vec2(p.x * 0.35 + p.y * 0.2, p.y * 3.0 - p.x * 0.4);
          float ci = smoothstep(0.55, 0.85, pdFbm(q * 1.4 + vec2(uTime * 0.003, 0.0))) * smoothstep(0.08, 0.45, h);
          c = mix(c, mix(vec3(1.0, 0.78, 0.8), vec3(1.0, 0.86, 0.66), lit), ci * 0.45);
        }
        // the sun's disc, and the haze under the horizon
        c = mix(c, vec3(1.0, 0.95, 0.82) * 1.6, smoothstep(0.99955, 0.99975, mu));
        c = mix(c, hor * 0.92, 1.0 - smoothstep(-0.06, 0.0, h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return { mesh, tick: (clock: number) => (uniforms.uTime.value = clock) };
}

/**
 * The hills on the slough's horizon, in three layers of haze round (cx, cz): the Santa Cruz Mountains dark against the
 * sunrise in the east, rolling hills north and south, and across the Bay to the west only a low line of hills, pale in
 * the sun. Each layer is one open cylinder with a painted silhouette.
 */
function ridges(THREE: Three, scene: T.Scene, cx: number, cz: number, r: number) {
  const sun = Math.atan2(DAWN.sun[0], DAWN.sun[2]);
  const layers = [
    { R: r + 900, top: 120, base: [170, 150, 190], sunSide: [120, 92, 140], rim: 0.55, seed: 3, rough: 1 },
    { R: r + 680, top: 70, base: [128, 112, 156], sunSide: [86, 64, 110], rim: 0.75, seed: 8, rough: 1.4 },
    { R: r + 470, top: 26, base: [92, 84, 108], sunSide: [62, 50, 78], rim: 0.9, seed: 13, rough: 2.4 },
  ];
  const W = 2048;
  const H = 128;
  return layers.map((L, n) => {
    const rnd = scatter(L.seed);
    // a ridgeline from a few octaves of smooth noise round the circle (it joins up where it wraps)
    const oct = Array.from({ length: 6 }, (_, k) => ({ f: 2 + k * k * 2 + Math.floor(rnd() * 3), a: 1 / (1 + k * L.rough), p: rnd() * Math.PI * 2 }));
    const ridge = (u: number) => {
      let v = 0;
      let tot = 0;
      for (const o of oct) {
        v += o.a * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * o.f + o.p));
        tot += o.a;
      }
      return v / tot;
    };
    const c = canvas(W, H, (g) => {
      const img = g.createImageData(W, H);
      for (let x = 0; x < W; x++) {
        const u = x / W;
        // (the angle round the circle: u = 0 faces +z; the cylinder's vertices go round with sin(θ) on x)
        const th = u * Math.PI * 2;
        const dir = Math.atan2(Math.sin(th), Math.cos(th));
        const toSun = Math.cos(dir - sun) * 0.5 + 0.5;
        // (west across the Bay: low)
        const bay = Math.max(0, Math.sin(th));
        const tall = n === 0 ? 1 - 0.75 * bay ** 1.5 : 1 - bay ** 0.6;
        const hgt = Math.max(0, (0.25 + 0.75 * ridge(u)) * tall - (n === 2 ? 0.25 * bay : 0));
        const top = H - 1 - hgt * (H - 4);
        const k = toSun ** 3;
        const rgb = L.base.map((b, i) => b + (L.sunSide[i] - b) * k);
        for (let y = 0; y < H; y++) {
          const o = (y * W + x) * 4;
          if (y < top || hgt <= 0.01) {
            img.data[o + 3] = 0;
            continue;
          }
          // (a lit rim along the crest on the sun's side, and haze thickening toward the foot)
          const depth = (y - top) / (H - top + 1);
          const rim = Math.max(0, 1 - (y - top) / 3) * L.rim * k;
          const haze = depth * 0.35;
          img.data[o] = Math.min(255, rgb[0] + (243 - rgb[0]) * haze + 255 * rim * 0.6);
          img.data[o + 1] = Math.min(255, rgb[1] + (199 - rgb[1]) * haze + 190 * rim * 0.6);
          img.data[o + 2] = Math.min(255, rgb[2] + (173 - rgb[2]) * haze + 120 * rim * 0.6);
          img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    const tex = texture(THREE, c);
    tex.wrapS = THREE.RepeatWrapping;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(L.R, L.R, L.top, 160, 1, true), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.BackSide, fog: false }));
    m.position.set(cx, L.top / 2 - 2, cz);
    m.renderOrder = -1;
    scene.add(m);
    return m;
  });
}

/**
 * Redwood Slough at dawn: the sun just up over the East Bay hills, the Bay itself to the west past the salt ponds' pink
 * and orange brines inside the loop, Bair Island's marsh all round with power-line towers marching across it, the
 * Stanford Rowing Center's boathouse and docks by the start, Docktown's houseboats along Westpoint Slough, the Port's
 * gantry cranes and aggregate piles past the Turning Basin, and the lock-keeper's hut on the Tide Gates.
 */
function slough(c: Scenery): SceneryTick {
  const { THREE, scene, t, geo, rand, clear, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number };
  const lambert = (color: number, extra: T.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const at = (s: number, d: number) => pointAt(t, s, d);
  const face = (s: number) => {
    const p = at(s, 0);
    return headingOf(p.tx, p.tz);
  };

  // the dawn sky (a dome round the camera: the gradient, the sun just up in the east over the hills, its glow, and
  // clouds lit pink and gold from below), and the hills on the horizon in layers of haze
  const sky = sloughSky(THREE);
  scene.add(sky.mesh);
  // (the last lap's fog swallows them)
  const hills = ridges(THREE, scene, cx, cz, Math.max(rx, rz));
  const fogLap = LOOKS.slough.fogLap?.lap ?? Infinity;

  // (the Bay itself, to the west past the loop, is water: see water.ts)
  const vc = lambert(0xffffff, { vertexColors: true });
  const vcLit = new THREE.MeshBasicMaterial({ vertexColors: true });
  /** A spot `d` off the channel at s, turned so that local +x faces back across the channel. */
  const lot = (s: number, d: number) => {
    const p = at(s, d);
    return { x: p.x, z: p.z, ry: face(s) + (d < 0 ? Math.PI : 0) };
  };
  const hazards = c.r.hazards;
  const anchor = (pred: (h: (typeof hazards)[number]) => boolean, fallback: number) => {
    const hs = hazards.filter(pred);
    return hs.length ? hs.reduce((a, h) => a + h.s, 0) / hs.length : fallback;
  };

  // the Cargill salt ponds inside the loop: brines in pastel pinks, salmon, ochre and green between dirt levees with a
  // track along their tops, and a crust of salt round their edges
  const pondColors = [0xe87a95, 0xf2a46a, 0x9cc08a, 0xd98fb0, 0xe9c06e, 0xc96f8c];
  const ponds: { x: number; z: number; w: number; d: number; c: number }[] = [];
  for (let n = 0; n < 80 && ponds.length < 8; n++) {
    const x = cx + (rand() - 0.2) * rx * 1.3;
    const z = cz + (rand() - 0.5) * rz * 1.3;
    const w = 40 + rand() * 50;
    const d = 30 + rand() * 40;
    if (!insideLoop(t, x, z) || !clear(x, z, Math.max(w, d) / 2 + 12)) continue;
    if (ponds.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 6 && Math.abs(p.z - z) < (p.d + d) / 2 + 6)) continue;
    ponds.push({ x, z, w, d, c: pondColors[ponds.length % pondColors.length] });
  }
  if (ponds.length) {
    const brine = texture(
      THREE,
      canvas(128, 128, (g) => {
        const grad = g.createRadialGradient(64, 64, 10, 64, 64, 90);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.7, '#e8e4e4');
        grad.addColorStop(0.92, '#f8f4ee');
        grad.addColorStop(1, '#ffffff');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        const r2 = scatter(9);
        for (let i = 0; i < 70; i++) {
          g.strokeStyle = `rgba(255,255,255,${0.15 + r2() * 0.25})`;
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(r2() * 128, r2() * 128, 6 + r2() * 14, 1 + r2() * 2, 0.3, 0, Math.PI * 2);
          g.stroke();
        }
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 5;
        g.strokeRect(2, 2, 124, 124);
      }),
    );
    const plane = new THREE.PlaneGeometry(1, 1);
    const rgbOf = (hex: number): [number, number, number] => {
      const k = new THREE.Color(hex);
      return [k.r, k.g, k.b];
    };
    const M = (x: number, y: number, z: number, sx: number, sz: number) => new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(sx, 1, sz)).premultiply(new THREE.Matrix4().makeTranslation(x, y, z));
    const m = new THREE.Mesh(merge(THREE, ponds.map((p) => ({ g: plane, m: M(p.x, 0.03, p.z, p.w, p.d), color: rgbOf(p.c) }))), lambert(0xffffff, { map: brine, vertexColors: true, emissive: 0x2a1a20 }));
    scene.add(m);
    plane.dispose();
    const levees = modelKit(THREE);
    for (const p of ponds) {
      for (const [x, z, sx, sz] of [
        [p.x, p.z - p.d / 2 - 1.5, p.w + 6, 3],
        [p.x, p.z + p.d / 2 + 1.5, p.w + 6, 3],
        [p.x - p.w / 2 - 1.5, p.z, 3, p.d],
        [p.x + p.w / 2 + 1.5, p.z, 3, p.d],
      ]) {
        levees.box(0x8a7458, x, 0.35, z, sx, 0.8, sz);
        levees.box(0xb8a688, x, 0.76, z, sx > sz ? sx : 1.4, 0.04, sx > sz ? 1.4 : sz);
      }
    }
    scene.add(levees.build(vc, vcLit));
  }

  // power lines marching across the marsh on lattice pylons, the wires sagging between them
  {
    const pylon = modelKit(THREE);
    const steel = 0x8e939a;
    const spots: { x: number; z: number; ry: number; line: number }[] = [];
    [
      [cx - rx - 120, cz - rz * 0.4, cx + rx + 80, cz + rz * 0.2],
      [cx - rx * 0.3, cz - rz - 140, cx + rx * 0.1, cz + rz + 160],
    ].forEach(([ax, az, bx, bz], line) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.round(len / 70);
      const ry = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        if (clear(x, z, 30)) spots.push({ x, z, ry, line });
      }
    });
    const H = 26;
    for (const sp of spots) {
      pylon.place(sp.x, 0, sp.z, sp.ry);
      // four legs leaning in to the waist, the body up to the peak, cross-arms with insulators, and the bracing
      for (const [lx, lz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        pylon.cyl(steel, lx * 1.6, H * 0.3, lz * 1.6, 0.09, H * 0.62, 0.09, lz * 0.1, 0, -lx * 0.1);
        pylon.cyl(steel, lx * 0.65, H * 0.78, lz * 0.65, 0.07, H * 0.42, 0.07, lz * 0.02, 0, -lx * 0.02);
      }
      for (let y = 2; y < H; y += 3.2) {
        const half = y < H * 0.6 ? 2.2 - (y / (H * 0.6)) * 1.5 : 0.7 - ((y - H * 0.6) / (H * 0.4)) * 0.3;
        for (const sd of [-1, 1]) {
          pylon.box(steel, sd * half, y, 0, 0.06, 0.06, half * 2);
          pylon.box(steel, 0, y, sd * half, half * 2, 0.06, 0.06);
          pylon.box(steel, sd * half, y + 1.6, 0, 0.05, 3.6, 0.05, 0.7 * sd, 0, 0);
        }
      }
      for (const [y, w] of [[H * 0.72, 7], [H * 0.86, 5.4]]) {
        pylon.box(steel, 0, y, 0, w * 2, 0.35, 0.5);
        for (const sd of [-1, 1]) pylon.cyl(0xd8d0c4, sd * (w - 0.3), y - 0.8, 0, 0.12, 1.4, 0.12);
      }
      pylon.cone(steel, 0, H + 1, 0, 0.5, 2, 0.5);
    }
    pylon.place();
    if (pylon.count()) scene.add(pylon.build(vc, vcLit));
    // (the wires: a catenary from each arm to the next tower's)
    const wire = new THREE.LineBasicMaterial({ color: 0x2b2b30, transparent: true, opacity: 0.8 });
    for (let k = 1; k < spots.length; k++) {
      const a = spots[k - 1];
      const b = spots[k];
      if (a.line !== b.line || Math.hypot(a.x - b.x, a.z - b.z) > 90) continue;
      for (const [y, w] of [[H * 0.72, 6.7], [H * 0.86, 5.1]]) {
        for (const sd of [-1, 1]) {
          const pts: T.Vector3[] = [];
          const ox = Math.cos(a.ry) * sd * w;
          const oz = -Math.sin(a.ry) * sd * w;
          for (let q = 0; q <= 12; q++) {
            const u = q / 12;
            pts.push(new THREE.Vector3(a.x + (b.x - a.x) * u + ox, y - 1.6 - 4 * u * (1 - u) * 3.2, a.z + (b.z - a.z) * u + oz));
          }
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
        }
      }
    }
  }

  // the Stanford Rowing Center by the start: a long two-story boathouse, cream with cardinal trim, its bay doors open on
  // racks of shells, a glass band of the erg room upstairs behind a balcony, and shells on slings out on the apron
  const shellColors = [0x8c1515, 0xf2f2f0, 0x2f6fb5, 0xf2c230, 0x8c1515, 0xd0d4da];
  {
    const L = lot(t.length - 26, t.edge + 16);
    const mk = modelKit(THREE);
    mk.place(L.x, 0, L.z, L.ry);
    const cream = 0xe9e1d0;
    const trim = 0x8c1515;
    // (the plinth up to the quay, the apron in front)
    mk.box(0x9d968a, 0, 0.72, 0, 16, 1.5, 38);
    mk.box(0xb7b0a2, 6.5, 1.47, 0, 5, 0.06, 36);
    // the hall and its roof: a shallow gable in standing-seam grey
    mk.box(cream, -1.5, 5.95, 0, 12, 9, 34);
    mk.box(trim, -1.5, 1.85, 0, 12.1, 0.6, 34.1);
    mk.box(trim, -1.5, 10.6, 0, 12.6, 0.5, 34.6);
    for (const sd of [-1, 1]) mk.box(0x5a5f66, -1.5 + sd * 3.3, 11.9, 0, 7.2, 0.3, 35.4, 0, 0, -sd * 0.34);
    for (let k = -8; k <= 8; k++) for (const sd of [-1, 1]) mk.box(0x6c7178, -1.5 + sd * 3.3, 12.07, k * 2, 7.2, 0.06, 0.08, 0, 0, -sd * 0.34);
    // the bay doors, open, with racks of shells inside (hull up, in tiers)
    for (let b = -1; b <= 1; b++) {
      mk.box(0x1e1c1a, 4.52, 3.6, b * 10.5, 0.1, 3.9, 7);
      mk.box(trim, 4.56, 5.7, b * 10.5, 0.14, 0.3, 7.4);
      for (let j = 0; j < 4; j++) for (const sd of [-1, 1]) mk.box(shellColors[(b + 2 + j + (sd > 0 ? 1 : 0)) % shellColors.length], 3.9, 2.3 + j * 0.9, b * 10.5 + sd * 1.6, 1.4, 0.18, 0.42);
      for (const sd of [-1, 1]) mk.box(0x9aa0a8, 4.0, 3.7, b * 10.5 + sd * 3.2, 0.12, 3.6, 0.12);
    }
    // upstairs: a band of glass, the balcony and its rail
    mk.box(0x2c4a5e, 4.52, 8.1, 0, 0.1, 2.0, 31);
    for (let k = -7; k <= 7; k++) mk.box(cream, 4.56, 8.1, k * 2.1, 0.12, 2.0, 0.18);
    mk.box(0xd8d2c4, 5.3, 6.5, 0, 1.6, 0.18, 33);
    mk.box(0xf2f2f0, 6.05, 7.45, 0, 0.06, 0.06, 33);
    for (let k = -16; k <= 16; k++) mk.box(0xf2f2f0, 6.05, 7.0, k, 0.04, 0.9, 0.04);
    // (the gable ends' windows)
    for (const sd of [-1, 1]) for (let k = -1; k <= 1; k++) mk.box(0x2c4a5e, -1.5 + k * 3, 7.5, sd * 17.03, 1.6, 2.4, 0.08);
    // shells upside down on slings on the apron, and a coach's launch on its trailer
    for (let k = 0; k < 3; k++) {
      const z = -10 + k * 7;
      for (const sd of [-1, 1]) {
        mk.box(0x6b7078, 6.3, 0.95 + 1.45, z + sd * 2.2, 0.06, 0.9, 0.06);
        mk.box(0x2b2b30, 6.3, 1.4 + 1.45, z + sd * 2.2, 0.5, 0.05, 0.05);
      }
      mk.ball(shellColors[k * 2 % shellColors.length], 6.3, 2.95, z, 0.24, 0.16, 3.6);
    }
    mk.box(0xdfe3e8, 7.2, 2.3, 12, 1.9, 0.8, 5);
    mk.box(0x8c1515, 7.2, 2.6, 12, 1.92, 0.12, 4);
    for (const sd of [-1, 1]) mk.cyl(0x141416, 7.2 + sd * 0.95, 1.75, 11, 0.3, 0.2, 0.3, 0, 0, Math.PI / 2);
    // the flagpole, and the flag
    mk.cyl(0xe8e8e8, 8.2, 7.5, -15, 0.08, 12, 0.08);
    mk.box(trim, 8.2, 12.6, -15.9, 0.03, 1.1, 1.8);
    mk.place();
    scene.add(mk.build(vc, vcLit));
    // the banner on its side: STANFORD ROWING CENTER
    const sign = texture(
      THREE,
      canvas(512, 64, (q) => {
        q.fillStyle = '#8c1515';
        q.fillRect(0, 0, 512, 64);
        q.fillStyle = '#ffffff';
        q.font = 'bold 34px Georgia, serif';
        q.textAlign = 'center';
        q.textBaseline = 'middle';
        q.fillText('STANFORD ROWING CENTER', 256, 34);
      }),
    );
    const banner = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: sign }));
    banner.scale.set(20, 2.2, 1);
    banner.position.set(L.x + Math.cos(L.ry) * 4.65, 10.45 - 1.4, L.z - Math.sin(L.ry) * 4.65);
    banner.rotation.y = L.ry + Math.PI / 2;
    scene.add(banner);
  }

  // Docktown's houseboats along Westpoint Slough: pastel cabins on dark floats, decks with white rails, pitched and flat
  // roofs, plants in pots, a kayak or two, and a gangway each to the quay; a few windows lit
  {
    const barge = hazards.find((h) => h.kind === 'barge');
    const s0 = barge?.span ? barge.span[0] + 3 : 1068;
    const pastel = [0xf2b8a2, 0xa8d0c6, 0xf3dca0, 0xc6b7e2, 0xe6e6dc, 0xb9d6ef, 0xf0c6d4];
    const mk = modelKit(THREE);
    for (let s = s0; s < s0 + 84; s += 9.5) {
      const L = lot(s, t.edge + 6 + rand() * 2.5);
      if (!clear(L.x, L.z, 3)) continue;
      mk.place(L.x, 0, L.z, L.ry + (rand() - 0.5) * 0.2);
      const w = 4.2 + rand() * 1.2;
      const l = 6.5 + rand() * 2;
      const hue = pastel[Math.floor(rand() * pastel.length)];
      mk.box(0x3a3d42, 0, 0.35, 0, w + 0.8, 0.7, l + 1);
      mk.box(0x9a8a74, 0, 0.74, 0, w + 0.7, 0.08, l + 0.9);
      mk.box(hue, -0.2, 1.95, 0, w - 0.6, 2.4, l - 1.6);
      // (windows on the water side, a door, and the rail round the deck)
      for (let k = -1; k <= 1; k++) {
        if (rand() < 0.25) mk.glow(0xffd9a0, (w - 0.6) / 2 - 0.18, 2.1, k * 1.9, 0.04, 0.9, 1.1);
        else mk.box(0x334a58, (w - 0.6) / 2 - 0.17, 2.1, k * 1.9, 0.04, 0.9, 1.1);
        mk.box(0xf6f2ea, (w - 0.6) / 2 - 0.16, 2.1, k * 1.9, 0.03, 1.05, 0.08);
      }
      mk.box(0x6a4a34, -0.2, 1.55, (l - 1.6) / 2 + 0.01, 0.9, 1.6, 0.05);
      for (const sd of [-1, 1]) mk.box(0xf6f2ea, sd * ((w + 0.6) / 2), 1.25, 0, 0.05, 0.05, l + 0.8);
      for (let k = -3; k <= 3; k++) for (const sd of [-1, 1]) mk.box(0xf6f2ea, sd * ((w + 0.6) / 2), 1.0, (k * (l + 0.6)) / 6, 0.05, 0.5, 0.05);
      if (rand() < 0.55) {
        for (const sd of [-1, 1]) mk.box(0x4a4440, -0.2 + sd * (w / 4), 3.6, 0, w / 2 + 0.3, 0.12, l - 1.0, 0, 0, -sd * 0.5);
      } else {
        mk.box(0x4a4440, -0.2, 3.25, 0, w - 0.2, 0.18, l - 1.1);
        mk.box(0xf6f2ea, -0.2, 3.55, 0, 0.05, 0.4, l - 1.3);
      }
      mk.ball(0x4f7d3a, w / 2 - 0.1, 1.2, l / 2 - 0.3, 0.35, 0.4, 0.35);
      mk.cyl(0xa0522d, w / 2 - 0.1, 0.95, l / 2 - 0.3, 0.25, 0.4, 0.25);
      if (rand() < 0.5) mk.ball([0xff8c1a, 0xe63b2e, 0x2fa0c8][Math.floor(rand() * 3)], (w + 0.5) / 2 - 0.1, 0.95, 0, 0.2, 0.14, 1.6);
      // (the gangway to the quay, and two pilings to moor to)
      mk.box(0x7a6a58, -(w / 2 + 1.8), 1.2, 0, 3.4, 0.08, 0.9, 0, 0, -0.2);
      for (const sd of [-1, 1]) mk.cyl(0x4a3a2c, -(w / 2 + 0.7), 1.4, sd * (l / 2 - 0.5), 0.18, 3.2, 0.18);
    }
    mk.place();
    if (mk.count()) scene.add(mk.build(vc, vcLit));
  }

  // the Port of Redwood City past the Turning Basin: gantry cranes over the wharf, mounds of aggregate and the white salt
  // stack, sheds and silos, and a bulk carrier loading from a conveyor
  {
    const sp = anchor((h) => h.kind === 'ferry', 404);
    const mk = modelKit(THREE);
    const crane = (s: number, d: number) => {
      const L = lot(s, d);
      if (!clear(L.x, L.z, 10)) return;
      mk.place(L.x, 0, L.z, L.ry);
      const red = 0xd8452c;
      // (four legs on rails, the portal beams, the boom out over the water and back over the yard, the machinery house)
      for (const lx of [-5, 5]) for (const lz of [-4, 4]) mk.box(red, lx, 12, lz, 1.0, 24, 1.0);
      for (const lx of [-5, 5]) mk.box(red, lx, 23.5, 0, 1.2, 1.4, 9.4);
      for (const lz of [-4, 4]) mk.box(red, 0, 23.5, lz, 11, 1.4, 1.0);
      for (const lx of [-5, 5]) mk.box(red, lx, 12, 0, 0.5, 0.5, 8.2, 0.9, 0, 0);
      mk.box(red, 9, 26, 0, 36, 1.8, 2.2);
      mk.box(red, -12, 26, 0, 8, 1.6, 2);
      for (const sd of [-1, 1]) mk.box(red, 2 + sd * 4, 31, 0, 0.5, 9, 0.5, 0, 0, sd * 0.4);
      mk.box(0xe8e2d4, -2, 28.5, 0, 6, 3.2, 3.6);
      mk.box(0x2a3d4a, 4, 24.3, 1.8, 1.8, 1.6, 1.4);
      mk.box(0x2b2b30, 18, 21, 0, 0.08, 9, 0.08);
      mk.box(0xffc21a, 18, 16.4, 0, 1.4, 0.5, 1.0);
      mk.glow(0xff3b2a, 27, 27.1, 0, 0.3, 0.3, 0.3);
    };
    crane(sp - 59, 58);
    crane(sp - 4, 50);
    // mounds of gravel and sand, and the salt stack
    const mound = (x: number, z: number, r: number, h: number, hex: number) => {
      const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.getAttribute('position');
      const rr = scatter(Math.round(x * 13 + z * 7));
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        const j = 1 + (rr() - 0.5) * 0.18 * (1 - y);
        p.setXYZ(k, p.getX(k) * j, Math.pow(y, 0.8), p.getZ(k) * j);
      }
      g.computeVertexNormals();
      mk.place();
      mk.geo(g, hex, x, -0.2, z, r, h, r);
    };
    // (none of them spilling into the bulk carrier's berth: see water.ts)
    const berth = lot(sp - 32, 62);
    const inBerth = (x: number, z: number, r: number) => {
      const dx = x - berth.x;
      const dz = z - berth.z;
      return Math.abs(dx * Math.sin(berth.ry) + dz * Math.cos(berth.ry)) < 50 + r && Math.abs(dx * Math.cos(berth.ry) - dz * Math.sin(berth.ry)) < 14 + r;
    };
    for (let k = 0; k < 6; k++) {
      const p = at(sp - 74 + k * 15, 72 + rand() * 18);
      const rr = 8 + rand() * 4;
      if (clear(p.x, p.z, 12) && !inBerth(p.x, p.z, rr)) mound(p.x, p.z, rr, 7 + rand() * 4, [0xb9aa92, 0x9a8e7a, 0xc9b896][k % 3]);
    }
    {
      const p = at(sp - 20, 110);
      if (clear(p.x, p.z, 26)) mound(p.x, p.z, 24, 17, 0xf4f1ec);
    }
    // sheds with corrugated roofs, and silos
    for (let k = 0; k < 3; k++) {
      const L = lot(sp - 35 + k * 22, 92 + (k % 2) * 6);
      if (!clear(L.x, L.z, 12)) continue;
      mk.place(L.x, 0, L.z, L.ry);
      mk.box([0xc8c2b4, 0xa9b4bb, 0xd2c6ae][k], 0, 3.5, 0, 12, 7, 18);
      for (const sd of [-1, 1]) mk.box(0x7f878e, sd * 3.2, 7.6, 0, 6.8, 0.2, 18.6, 0, 0, -sd * 0.22);
      mk.box(0x3a3d42, 6.02, 2.5, 0, 0.1, 4.5, 6);
    }
    for (let k = 0; k < 3; k++) {
      const p = at(sp + 20 + k * 6, 80);
      if (!clear(p.x, p.z, 5)) continue;
      mk.place();
      mk.cyl(0xd8d8d4, p.x, 9, p.z, 2.6, 18, 2.6);
      mk.cone(0xbfbfba, p.x, 19, p.z, 2.7, 2, 2.7);
    }
    // the bulk carrier at the wharf: hull with its boot top, hatch covers, deck cranes, the white house aft and its stack
    {
      const L = lot(sp - 32, 62);
      if (clear(L.x, L.z, 16)) {
        mk.place(L.x, 0, L.z, L.ry);
        mk.geo(boatHull(THREE, 80, 14, 8.5, true), 0x2f4256, 0, -0.5, 0);
        mk.box(0x8c2a1e, 0, 0.5, 0, 13.4, 1.2, 74, 0, 0, 0);
        for (let k = -2; k <= 2; k++) {
          mk.box(0x4a5866, 0, 8.6, k * 12 + 8, 10, 1.0, 9);
          mk.box(0x3a4552, 0, 9.15, k * 12 + 8, 10.2, 0.1, 0.4);
        }
        for (let k = 0; k < 3; k++) {
          const z = -6 + k * 12 + 8;
          mk.cyl(0xe8d24a, 3, 12, z, 0.5, 7, 0.5);
          mk.box(0xe8d24a, 3, 15, z + 6, 0.5, 0.5, 13, -0.45, 0, 0);
        }
        mk.box(0xf2efe8, 0, 12.5, -30, 12, 8, 10);
        mk.box(0xf2efe8, 0, 17.5, -30, 10, 3, 8);
        for (let f = 0; f < 3; f++) mk.box(0x26323c, 0, 10.5 + f * 2.6, -24.95, 10, 0.8, 0.1);
        mk.box(0x26323c, 0, 18, -25.95, 9.2, 1.0, 0.1);
        mk.box(0xf2efe8, 0, 19.5, -30, 16, 0.4, 3);
        mk.cyl(0x23262c, 0, 22, -34, 1.4, 6, 1.4);
        mk.cyl(0x8c1515, 0, 21.6, -34, 1.45, 1.2, 1.45);
        mk.glow(0xffe6a0, 0, 25, -26, 0.3, 0.3, 0.3);
        // (the conveyor from the mounds up over its rail)
        mk.box(0x8a8f96, -14, 9, 12, 2, 1, 34, -0.25, 0.9, 0);
        for (let k = 0; k < 4; k++) mk.box(0x6a7076, -6 - k * 4.2, 4, 12 + k * 3.5, 0.4, 8 - k * 1.6, 0.4);
      }
    }
    mk.place();
    if (mk.count()) scene.add(mk.build(vc, vcLit));
  }

  // the lock-keeper's hut on the Tide Gates: windows all round, a red roof, a signal mast
  {
    const s = anchor((h) => h.kind === 'bollard' && h.look === 'gate', 140);
    const L = lot(s, edgeAtLim(t, s, 1) + 5);
    const mk = modelKit(THREE);
    mk.place(L.x, 1.45, L.z, L.ry);
    mk.box(0xd9d2c0, 0, 1.5, 0, 4, 3, 5);
    for (const sd of [-1, 1]) mk.box(0x8c1515, sd * 1.1, 3.55, 0, 2.6, 0.18, 5.8, 0, 0, -sd * 0.42);
    mk.box(0x2c4a5e, 2.01, 1.9, 0, 0.06, 1.1, 3.6);
    for (const sd of [-1, 1]) mk.box(0x2c4a5e, 0, 1.9, sd * 2.51, 2.6, 1.1, 0.06);
    mk.box(0x6a4a34, -2.01, 1.1, 0, 0.06, 2, 1);
    mk.cyl(0xe8e8e8, -1.5, 4.5, 2, 0.06, 6, 0.06);
    mk.box(0xe8e8e8, -1.5, 7, 2, 0.06, 0.06, 1.6);
    mk.place();
    scene.add(mk.build(vc, vcLit));
  }

  // egrets (white) and the odd heron (grey) stalking the marsh edges and the creeks: legs, body, an S of a neck, a bill
  {
    const bird = modelKit(THREE);
    const n0 = { n: 0 };
    for (let n = 0; n < 900 && n0.n < 34; n++) {
      const s = rand() * t.length;
      const side = rand() < 0.5 ? -1 : 1;
      const p = at(s, side * (edgeAtLim(t, s, side) * side + 3.5 + rand() * 14));
      if (!clear(p.x, p.z, 2.5)) continue;
      n0.n++;
      const heron = rand() < 0.2;
      const col = heron ? 0x8a8f99 : 0xfbfbf6;
      const k = heron ? 1.3 : 1;
      bird.place(p.x, 0, p.z, rand() * Math.PI * 2);
      for (const sd of [-1, 1]) bird.cyl(0x1b1c22, sd * 0.06 * k, 0.35 * k, 0, 0.018, 0.7 * k, 0.018);
      bird.ball(col, 0, 0.8 * k, -0.05, 0.16 * k, 0.17 * k, 0.32 * k, -0.4);
      bird.cyl(col, 0, 1.05 * k, 0.15 * k, 0.045 * k, 0.42 * k, 0.045 * k, 0.5);
      bird.cyl(col, 0, 1.32 * k, 0.2 * k, 0.04 * k, 0.25 * k, 0.04 * k, -0.4);
      bird.ball(col, 0, 1.45 * k, 0.26 * k, 0.06 * k, 0.06 * k, 0.08 * k);
      bird.cone(heron ? 0xd8b84a : 0xf2c230, 0, 1.45 * k, 0.42 * k, 0.025 * k, 0.24 * k, 0.025 * k, Math.PI / 2);
    }
    bird.place();
    if (bird.count()) scene.add(bird.build(vc, vcLit));
  }

  // the Dumbarton Bridge low across the Bay on the horizon, its hump over the shipping channel
  {
    const x0 = cx + rx + 330;
    const z0 = cz - rz - 420;
    const z1 = cz + rz + 420;
    const deck: Item[] = [];
    const legs: Item[] = [];
    const n = 36;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const z = z0 + (z1 - z0) * u;
      const hump = 4 + 22 * Math.max(0, 1 - Math.abs(u - 0.62) / 0.12);
      const len = (z1 - z0) / n + 0.6;
      deck.push({ x: x0, y: hump, z, sx: 7, sy: 1.2, sz: len });
      legs.push({ x: x0, y: hump / 2, z, sx: 2.2, sy: hump, sz: 2.2 });
    }
    instances(THREE, scene, dummy, geo.box, lambert(0xbcb3ad), deck);
    instances(THREE, scene, dummy, geo.box, lambert(0x9d948f), legs);
  }

  // out on the Bay: sailboats heeling in the breeze and a couple of kayakers, drifting along
  const boats = modelKit(THREE);
  for (let k = 0; k < 7; k++) {
    const bx = ((k * 53) % 150) - 75 + rand() * 20;
    const bz = k * 45 - 150;
    if (k < 5) {
      boats.place(bx, 0, bz, rand() * 6);
      boats.geo(boatHull(THREE, 7, 2.2, 0.8, true), 0xf2f2f0);
      boats.cyl(0xc8c8c8, 0, 5, 0.5, 0.06, 9, 0.06);
      boats.geo(sailGeometry(THREE), k % 3 === 1 ? 0xf2c4a8 : 0xfbf8f2, 0, 0.8, 0.5, 1, 1, 1);
    } else {
      boats.place(bx - 160, 0, bz, rand() * 6);
      boats.ball(k % 2 ? 0xff8c1a : 0xe63b2e, 0, 0.15, 0, 0.35, 0.18, 2.4);
      boats.box(0x2f6fb5, 0, 0.55, 0, 0.36, 0.5, 0.25);
      boats.ball(0xe8bf98, 0, 0.92, 0, 0.13, 0.14, 0.13);
      boats.box(0xd9d9d9, 0, 0.6, 0, 2.6, 0.03, 0.08, 0, 0, 0.4);
    }
  }
  boats.place();
  const fleet = boats.build(vc, vcLit);
  // (each boat is its own stretch of the merged mesh: moved together, they drift as one fleet; spread out by its slot)
  fleet.position.set(cx + rx + 260, 0, cz - 120);
  fleet.rotation.y = 0.3;
  scene.add(fleet);

  // pelicans gliding in a ragged V over the marsh, and gulls wheeling over the channel
  const birdGeo = new THREE.BoxGeometry(1, 1, 1);
  const pelicans = new THREE.InstancedMesh(birdGeo, lambert(0x9a8f80), 21);
  const gulls = new THREE.InstancedMesh(birdGeo, lambert(0xf4f4f0), 24);
  pelicans.frustumCulled = gulls.frustumCulled = false;
  scene.add(pelicans, gulls);
  const flyer = (mesh: T.InstancedMesh, i: number, x: number, y: number, z: number, ry: number, span: number, flap: number) => {
    const set = (j: number, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, rz: number) => {
      dummy.position.set(x + Math.cos(ry) * ox + Math.sin(ry) * oz, y + oy, z - Math.sin(ry) * ox + Math.cos(ry) * oz);
      dummy.rotation.set(0, ry, rz);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(j, dummy.matrix);
    };
    set(i, 0, 0, 0, span * 0.18, span * 0.16, span * 0.55, 0);
    set(i + 1, span * 0.45, Math.sin(flap) * span * 0.12, -0.05, span * 0.85, 0.05, span * 0.28, flap);
    set(i + 2, -span * 0.45, Math.sin(flap) * span * 0.12, -0.05, span * 0.85, 0.05, span * 0.28, -flap);
  };
  return (race, clock) => {
    sky.tick(clock);
    const seen = (race.karts[race.me]?.lap ?? 1) < fogLap;
    for (const m of hills) m.visible = seen;
    // the pelicans, in their V
    for (let n = 0; n < 7; n++) {
      const a = clock * 0.045;
      const row = Math.ceil(n / 2) * (n % 2 ? 1 : -1);
      const x0 = cx + Math.cos(a) * rx * 0.75;
      const z0 = cz + Math.sin(a) * rz * 0.7;
      const ry = Math.atan2(-Math.sin(a) * rx * 0.75, Math.cos(a) * rz * 0.7);
      const back = Math.abs(row) * 3.2;
      const x = x0 - Math.sin(ry) * back + Math.cos(ry) * row * 3;
      const z = z0 - Math.cos(ry) * back - Math.sin(ry) * row * 3;
      const flap = Math.sin(clock * 2.2 - Math.abs(row) * 0.6) * 0.25 * (Math.sin(clock * 0.3 + n) > 0.2 ? 1 : 0.1);
      flyer(pelicans, n * 3, x, 24 + Math.sin(clock * 0.4 + n) * 0.8, z, ry, 2.6, flap);
    }
    pelicans.instanceMatrix.needsUpdate = true;
    // the gulls, circling over where you are
    const me = race.karts[race.me];
    const gx = me ? me.x : cx;
    const gz = me ? me.z : cz;
    for (let n = 0; n < 8; n++) {
      const a = clock * (0.25 + (n % 3) * 0.06) * (n % 2 ? 1 : -1) + n * 0.8;
      const rad = 18 + (n % 4) * 7;
      const x = gx + Math.cos(a) * rad + Math.sin(n * 1.7) * 20;
      const z = gz + Math.sin(a) * rad + Math.cos(n * 2.3) * 20;
      const ry = a + (n % 2 ? 0 : Math.PI);
      flyer(gulls, n * 3, x, 12 + (n % 3) * 3 + Math.sin(clock + n) * 1.5, z, ry, 1.1, Math.sin(clock * 6 + n * 1.7) * 0.5);
    }
    gulls.instanceMatrix.needsUpdate = true;
    // the boats out on the Bay, drifting with the breeze
    fleet.position.z = cz - 120 + ((clock * 1.2) % 160) - 80;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
  };
}

/** A sloop's mainsail and jib: two triangles, a little curved, from the boom up the mast and forward to the bow. */
function sailGeometry(THREE: Three) {
  const pos = [0, 0, 0, 0, 8.5, 0.05, 0, 0.2, -3.2, 0, 0.1, 0.4, 0, 7.6, 0.4, 0.05, 0, 3.1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** How far out the edge of the course stands on one side at s (a wall's foot, or the brink of a drop). */
function edgeAtLim(t: Track, s: number, side: number) {
  const i = Math.floor((((s % t.length) + t.length) % t.length) / t.step) % t.n;
  return side > 0 ? t.hi[i] : -t.lo[i];
}

export const SKY_DROP = 90;

/**
 * The Cardinal Skyway: night, ninety meters over campus on Big Game eve. Below, campus as a dim diorama: the line of lamps
 * down Palm Drive to the Oval, the warm arcades of the Main Quad and Memorial Church lit up, the stadium's floodlights,
 * the Dish turning under the sweeper and Lake Lagunita with the Big Game Bonfire burning on its bed, right under the Gap
 * and the Wire, its embers drifting up past the road. Hoover Tower rises out of the dark in the middle of the Corkscrew,
 * its lit lantern at road level. The Bay and the city glow on the northern horizon with the Bay Bridge's lights, under
 * the stars, the Milky Way and a thin moon.
 */
function skyway(c: Scenery): SceneryTick {
  const { THREE, scene, t, geo, rand, dummy } = c;
  const { cx, cz, rx, rz } = bounds(t);
  const Y = -SKY_DROP;
  const flat = -Math.PI / 2;
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number };
  // (where things are along the road, and the centres of the Corkscrew's arcs: Hoover Tower stands in the middle of it)
  const at = (s: number, d = 0) => pointAt(t, s, d);
  const gap = at(537);
  const wire = at(730);
  const tower = { x: -110, z: -36 };
  const sweep = at(585, -60);
  // the lake: under the Gap and the Wire, the Bonfire on its bed under the Gap
  const lake = { x: (gap.x + wire.x) / 2, z: (gap.z + wire.z) / 2, r: 70 };
  const fire = { x: gap.x, z: gap.z };

  // the ground far below: one big plane painted with campus at night
  const S = 1800;
  const W = 1024;
  const px = (x: number) => ((x - (cx - S / 2)) / S) * W;
  const py = (z: number) => ((z - (cz - S / 2)) / S) * W;
  const scale = W / S;
  const ground = texture(
    THREE,
    canvas(W, W, (g) => {
      g.fillStyle = '#04050b';
      g.fillRect(0, 0, W, W);
      // dark lawns and the foothills
      for (let n = 0; n < 70; n++) {
        g.fillStyle = `rgba(${10 + rand() * 10},${18 + rand() * 14},${16 + rand() * 10},0.8)`;
        g.beginPath();
        g.ellipse(rand() * W, rand() * W, 20 + rand() * 60, 14 + rand() * 40, rand() * 3, 0, Math.PI * 2);
        g.fill();
      }
      // the Bay along the north edge (+z), dark water with a sheen
      const bay = g.createLinearGradient(0, W, 0, W * 0.82);
      bay.addColorStop(0, '#0b1a3a');
      bay.addColorStop(1, 'rgba(8,16,40,0)');
      g.fillStyle = bay;
      g.fillRect(0, W * 0.82, W, W * 0.18);
      // streets: a loose grid of warm lines, lamps along them
      g.lineCap = 'round';
      const street = (pts: [number, number][], width: number, lamps: number, color = 'rgba(255,170,90,0.55)') => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), py(z)) : g.moveTo(px(x), py(z))));
        g.stroke();
        for (let i = 0; i + 1 < pts.length; i++) {
          const [ax, az] = pts[i];
          const [bx, bz] = pts[i + 1];
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / lamps));
          for (let k = 0; k <= n; k++) {
            g.fillStyle = 'rgba(255,226,160,0.95)';
            g.fillRect(px(ax + ((bx - ax) * k) / n) - 1, py(az + ((bz - az) * k) / n) - 1, 2.5, 2.5);
          }
        }
      };
      for (let k = -6; k <= 6; k++) {
        street([[cx - 900, cz + k * 130 + rand() * 30], [cx + 900, cz + k * 130 + rand() * 30]], 1.4, 26, 'rgba(255,150,70,0.28)');
        street([[cx + k * 140 + rand() * 30, cz - 900], [cx + k * 140 + rand() * 30, cz + 900]], 1.4, 26, 'rgba(255,150,70,0.28)');
      }
      // Palm Drive: a straight double line of lamps running south to the Oval
      const oval = { x: cx + 160, z: cz - 210 };
      street([[oval.x, oval.z - 40], [oval.x, oval.z - 600]], 3, 9, 'rgba(255,200,120,0.75)');
      street([[oval.x + 10, oval.z - 40], [oval.x + 10, oval.z - 600]], 1.5, 9, 'rgba(255,200,120,0.5)');
      g.strokeStyle = 'rgba(255,200,120,0.7)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.ellipse(px(oval.x + 5), py(oval.z), 22 * scale * 1.6, 46 * scale * 1.6, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(30,60,30,0.9)';
      g.fill();
      // the Main Quad: warm arcades round a court, Memorial Church at its head
      const quad = { x: oval.x, z: oval.z + 110 };
      g.strokeStyle = 'rgba(255,190,110,0.9)';
      g.lineWidth = 4;
      g.strokeRect(px(quad.x - 50), py(quad.z - 40), 100 * scale, 80 * scale);
      g.strokeRect(px(quad.x - 28), py(quad.z - 24), 56 * scale, 48 * scale);
      g.fillStyle = 'rgba(255,214,120,1)';
      g.fillRect(px(quad.x - 9), py(quad.z + 40), 18 * scale, 12 * scale);
      // the stadium: a floodlit field in its bowl
      const stad = { x: cx - 250, z: cz + 230 };
      const flood = g.createRadialGradient(px(stad.x), py(stad.z), 4, px(stad.x), py(stad.z), 90 * scale);
      flood.addColorStop(0, 'rgba(220,255,220,0.9)');
      flood.addColorStop(0.35, 'rgba(110,200,120,0.55)');
      flood.addColorStop(1, 'rgba(40,80,40,0)');
      g.fillStyle = flood;
      g.fillRect(px(stad.x) - 100, py(stad.z) - 100, 200, 200);
      g.fillStyle = 'rgba(70,170,80,0.95)';
      g.fillRect(px(stad.x - 34), py(stad.z - 20), 68 * scale, 40 * scale);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      for (let k = -3; k <= 3; k++) {
        g.beginPath();
        g.moveTo(px(stad.x + k * 9), py(stad.z - 20));
        g.lineTo(px(stad.x + k * 9), py(stad.z + 20));
        g.stroke();
      }
      // Lake Lagunita: dark water, and the Bonfire's glow on its bed
      g.fillStyle = '#071226';
      g.beginPath();
      g.ellipse(px(lake.x), py(lake.z), lake.r * scale * 1.3, lake.r * scale, 0.4, 0, Math.PI * 2);
      g.fill();
      const glow = g.createRadialGradient(px(fire.x), py(fire.z), 2, px(fire.x), py(fire.z), 60 * scale);
      glow.addColorStop(0, 'rgba(255,200,90,1)');
      glow.addColorStop(0.3, 'rgba(255,110,30,0.7)');
      glow.addColorStop(1, 'rgba(255,60,10,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, W);
      // a scatter of lit windows and porch lights all over
      for (let n = 0; n < 900; n++) {
        g.fillStyle = `rgba(255,${190 + rand() * 50},${110 + rand() * 80},${0.25 + rand() * 0.5})`;
        g.fillRect(rand() * W, rand() * W * 0.85, 1.5, 1.5);
      }
    }),
  );
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshBasicMaterial({ map: ground }));
  floor.rotation.x = flat;
  floor.position.set(cx, Y, cz);
  scene.add(floor);

  // campus buildings far below, lit windows and all: the Quad's arcades, Memorial Church, the stadium's stands and its
  // light towers, halls round about
  const windows = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#2a2018';
      g.fillRect(0, 0, 64, 64);
      for (let y = 4; y < 64; y += 10) for (let x = 3; x < 64; x += 8) if (rand() < 0.7) {
        g.fillStyle = `rgba(255,${200 + rand() * 40},${120 + rand() * 60},${0.6 + rand() * 0.4})`;
        g.fillRect(x, y, 4, 5);
      }
    }),
    [2, 2],
  );
  const blocks: Item[] = [];
  const oval = { x: cx + 160, z: cz - 210 };
  const quad = { x: oval.x, z: oval.z + 110 };
  for (const [dx, dz, w, d] of [[-50, 0, 8, 80], [50, 0, 8, 80], [0, -40, 100, 8], [0, 40, 100, 8], [-28, 0, 6, 48], [28, 0, 6, 48]] as const) blocks.push({ x: quad.x + dx, y: Y + 6, z: quad.z + dz, sx: w, sy: 12, sz: d });
  for (let n = 0; blocks.length < 44 && n < 400; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 60 + rand() * 520;
    const x = cx + Math.cos(a) * (rx + dist) * 0.8;
    const z = cz + Math.sin(a) * (rz + dist) * 0.8;
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r + 20 || Math.hypot(x - tower.x, z - tower.z) < 30) continue;
    const h = 8 + rand() * 18;
    blocks.push({ x, y: Y + h / 2, z, sx: 18 + rand() * 26, sy: h, sz: 12 + rand() * 14, ry: rand() * 3 });
  }
  instances(THREE, scene, dummy, geo.box, new THREE.MeshBasicMaterial({ map: windows }), blocks);
  // Memorial Church's mosaic, lit gold
  const church = new THREE.Mesh(geo.box, new THREE.MeshBasicMaterial({ color: 0xffc860 }));
  church.position.set(quad.x, Y + 10, quad.z + 46);
  church.scale.set(20, 20, 10);
  scene.add(church);
  // the stadium's light towers, with a glow at each head
  const stad = { x: cx - 250, z: cz + 230 };
  const masts: Item[] = [];
  for (const [dx, dz] of [[-50, -34], [50, -34], [-50, 34], [50, 34]]) masts.push({ x: stad.x + dx, y: Y + 22, z: stad.z + dz, sx: 1.5, sy: 44, sz: 1.5 });
  instances(THREE, scene, dummy, geo.box, new THREE.MeshBasicMaterial({ color: 0x3a3e48 }), masts);
  const lampGlow = glowTexture(THREE, '230,255,230', 0.9);
  for (const m of masts) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.position.set(m.x, Y + 45, m.z);
    sp.scale.set(26, 26, 1);
    scene.add(sp);
  }

  // Hoover Tower in the middle of the Corkscrew: the shaft up out of the dark, the lantern and its observation deck lit
  // at road level, the red dome and the warning light above
  const stone = new THREE.MeshLambertMaterial({ color: 0xd9b98a, emissive: 0x4a3420 });
  const lantern = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const part = (mat: T.Material, y: number, sx: number, sy: number, sz: number, g2: T.BufferGeometry = geo.box) => {
    const m = new THREE.Mesh(g2, mat);
    m.position.set(tower.x, y, tower.z);
    m.scale.set(sx, sy, sz);
    scene.add(m);
    return m;
  };
  part(stone, Y + 9, 14, 18, 14);
  part(stone, (Y + 18 - 7) / 2, 8.6, -7 - (Y + 18), 8.6);
  part(lantern, -4, 7.8, 6, 7.8);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const pier = new THREE.Mesh(geo.box, stone);
    pier.position.set(tower.x + dx * 3.7, -4, tower.z + dz * 3.7);
    pier.scale.set(1.4, 6, 1.4);
    scene.add(pier);
  }
  part(stone, -0.6, 10.4, 1, 10.4);
  part(new THREE.MeshLambertMaterial({ color: 0xb4553a, emissive: 0x5a1e0c }), 0, 4.2, 5, 4.2, new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  part(stone, 6, 0.9, 2.2, 0.9);
  const warning = part(new THREE.MeshBasicMaterial({ color: 0xff2a1a }), 7.4, 0.6, 0.6, 0.6);
  const lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, '255,214,140', 0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  lanternGlow.position.set(tower.x, -3, tower.z);
  lanternGlow.scale.set(26, 18, 1);
  scene.add(lanternGlow);
  const base = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: glowTexture(THREE, '255,214,150', 0.5), transparent: true, depthWrite: false }));
  base.rotation.x = flat;
  base.scale.set(60, 60, 1);
  base.position.set(tower.x, Y + 0.2, tower.z);
  scene.add(base);

  // the Dish, turning slowly far below the sweeper
  const dishG = new THREE.Group();
  dishG.position.set(sweep.x, Y, sweep.z);
  const white = new THREE.MeshLambertMaterial({ color: 0xdfe4ee, emissive: 0x2a2e3a, side: THREE.DoubleSide });
  const leg = new THREE.Mesh(geo.box, white);
  leg.scale.set(3, 18, 3);
  leg.position.y = 9;
  dishG.add(leg);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(16, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), white);
  bowl.position.y = 22;
  bowl.rotation.x = Math.PI * 0.75;
  dishG.add(bowl);
  scene.add(dishG);

  // the Big Game Bonfire on the lake bed, under the Gap: a stack of flames, its glow, and embers drifting up past the road
  const flameTex = texture(
    THREE,
    canvas(64, 128, (g) => {
      const grad = g.createRadialGradient(32, 100, 2, 32, 90, 64);
      grad.addColorStop(0, 'rgba(255,250,210,1)');
      grad.addColorStop(0.25, 'rgba(255,190,70,0.95)');
      grad.addColorStop(0.6, 'rgba(255,90,20,0.6)');
      grad.addColorStop(1, 'rgba(160,20,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(32, 0);
      g.quadraticCurveTo(64, 70, 54, 110);
      g.quadraticCurveTo(32, 132, 10, 110);
      g.quadraticCurveTo(0, 70, 32, 0);
      g.fill();
    }),
  );
  const flames = Array.from({ length: 6 }, (_, k) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const a = (k / 6) * Math.PI * 2;
    m.position.set(fire.x + Math.cos(a) * 3, Y + 8, fire.z + Math.sin(a) * 3);
    scene.add(m);
    return m;
  });
  const fireGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, '255,140,50', 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  fireGlow.position.set(fire.x, Y + 12, fire.z);
  fireGlow.scale.set(90, 70, 1);
  scene.add(fireGlow);
  const emberMat = new THREE.SpriteMaterial({ map: glowTexture(THREE, '255,170,60', 1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const embers = Array.from({ length: 36 }, () => {
    const m = new THREE.Sprite(emberMat);
    m.scale.setScalar(0.5);
    m.position.set(fire.x + (rand() - 0.5) * 30, Y + rand() * (SKY_DROP + 20), fire.z + (rand() - 0.5) * 30);
    scene.add(m);
    return { m, v: 4 + rand() * 5, drift: rand() * 6 };
  });

  // the Bay and the city on the northern horizon, the Bay Bridge's string of lights, the stars, the Milky Way and a thin
  // moon (none of it in the fog)
  const skyline = texture(
    THREE,
    canvas(1024, 128, (g) => {
      g.fillStyle = 'rgba(0,0,0,0)';
      g.clearRect(0, 0, 1024, 128);
      const glowB = g.createLinearGradient(0, 128, 0, 40);
      glowB.addColorStop(0, 'rgba(255,150,90,0.35)');
      glowB.addColorStop(1, 'rgba(255,150,90,0)');
      g.fillStyle = glowB;
      g.fillRect(0, 40, 1024, 88);
      for (let x = 0; x < 1024; ) {
        const w = 6 + rand() * 18;
        const h = 10 + rand() * rand() * 80 * (Math.abs(x - 600) < 160 ? 1.4 : 0.5);
        g.fillStyle = '#0a0d1c';
        g.fillRect(x, 128 - h, w, h);
        for (let y = 128 - h + 3; y < 125; y += 4) for (let wx = x + 1; wx < x + w - 1; wx += 3) if (rand() < 0.35) {
          g.fillStyle = `rgba(255,${200 + rand() * 50},${130 + rand() * 80},0.9)`;
          g.fillRect(wx, y, 1.5, 1.5);
        }
        x += w + rand() * 4;
      }
    }),
  );
  const city = new THREE.Mesh(new THREE.PlaneGeometry(1400, 175), new THREE.MeshBasicMaterial({ map: skyline, transparent: true, fog: false, depthWrite: false }));
  city.position.set(cx - 200, Y + 60, cz + 950);
  city.lookAt(cx, Y + 60, cz);
  scene.add(city);
  const bridge: Item[] = [];
  for (let k = 0; k <= 60; k++) {
    const u = k / 60;
    bridge.push({ x: cx - 900 + u * 900, y: Y + 30 + Math.sin(u * Math.PI * 6) * 6, z: cz + 900 - u * 40, sx: 2, sy: 2, sz: 2 });
  }
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false }), bridge);
  const stars: Item[] = [];
  for (let n = 0; n < 420; n++) {
    const a = rand() * Math.PI * 2;
    const up = 0.05 + Math.pow(rand(), 0.7) * 1.25;
    const size = 0.8 + rand() * rand() * 2.6;
    stars.push({ x: cx + Math.cos(a) * Math.cos(up) * 1150, y: Math.sin(up) * 1150, z: cz + Math.sin(a) * Math.cos(up) * 1150, sx: size, sy: size, sz: size });
  }
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false }), stars);
  const milky = new THREE.Mesh(
    geo.plane,
    new THREE.MeshBasicMaterial({
      map: texture(
        THREE,
        canvas(256, 64, (g) => {
          const grad = g.createLinearGradient(0, 0, 0, 64);
          grad.addColorStop(0, 'rgba(160,170,255,0)');
          grad.addColorStop(0.5, 'rgba(190,190,255,0.22)');
          grad.addColorStop(1, 'rgba(160,170,255,0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, 256, 64);
          for (let n = 0; n < 500; n++) {
            g.fillStyle = `rgba(255,255,255,${rand() * 0.4})`;
            g.fillRect(rand() * 256, 20 + rand() * rand() * 24 * (rand() < 0.5 ? -1 : 1) + 12, 1, 1);
          }
          // (faded out toward both ends, so it has no edges)
          g.globalCompositeOperation = 'destination-in';
          const ends = g.createLinearGradient(0, 0, 256, 0);
          ends.addColorStop(0, 'rgba(0,0,0,0)');
          ends.addColorStop(0.3, 'rgba(0,0,0,1)');
          ends.addColorStop(0.7, 'rgba(0,0,0,1)');
          ends.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = ends;
          g.fillRect(0, 0, 256, 64);
        }),
      ),
      transparent: true,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  milky.scale.set(2600, 380, 1);
  milky.position.set(cx + 300, 700, cz - 300);
  milky.lookAt(cx, 0, cz);
  milky.rotateZ(0.6);
  scene.add(milky);
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(22, 32),
    new THREE.MeshBasicMaterial({
      map: texture(
        THREE,
        canvas(64, 64, (g) => {
          g.fillStyle = '#f6f2dc';
          g.beginPath();
          g.arc(32, 32, 31, 0, Math.PI * 2);
          g.fill();
          g.globalCompositeOperation = 'destination-out';
          g.beginPath();
          g.arc(40, 28, 29, 0, Math.PI * 2);
          g.fill();
        }),
      ),
      transparent: true,
      fog: false,
    }),
  );
  moon.position.set(cx - 560, 380, cz - 600);
  moon.lookAt(cx, 0, cz);
  scene.add(moon);

  return (_race, clock, dt) => {
    // the Bonfire flickers, the embers drift up past the road and start again at the fire, the Dish turns, the tower's
    // light blinks
    flames.forEach((f, k) => {
      const h = 22 + Math.sin(clock * 7 + k * 1.7) * 4 + Math.sin(clock * 13 + k) * 2;
      f.scale.set(12 + Math.sin(clock * 5 + k) * 2, h, 1);
      f.position.y = Y + h * 0.42;
    });
    (fireGlow.material as T.SpriteMaterial).opacity = 0.8 + Math.sin(clock * 9) * 0.15;
    for (const e of embers) {
      e.m.position.y += e.v * dt;
      e.m.position.x += Math.sin(clock * 0.7 + e.drift) * dt * 1.5;
      if (e.m.position.y > 20) e.m.position.set(fire.x + (Math.random() - 0.5) * 30, Y + 4, fire.z + (Math.random() - 0.5) * 30);
    }
    dishG.rotation.y = clock * 0.05;
    warning.visible = Math.floor(clock * 1.2) % 2 === 0;
  };
}

export const SCENERY: Record<CourseId, (c: Scenery) => void | SceneryTick> ={ palm: campus, lake, barn, dish, stadium, quad, hoover, golf, skyway, slough };
