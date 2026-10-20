// three.js view of the golf course's set pieces (scene.ts builds it for a course that has any): the Canada geese guarding
// the island green's bank, each on its nest, crouching and hissing and then going for you; and the gang mower crossing
// the end of the first-tee straight on its cart path, its beacon flashing before it sets off. It reads a Race every
// frame and never changes it.
import type { T } from './gl';
import { deltaS, headingOf, lengthOf, pointAt, type Track } from './track';
import { canvas, texture } from './scenery';
import { hazState, mowerRun, type LiveHazard, type Race } from './logic';

type Three = typeof import('three');
type Geo = { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; plane: T.PlaneGeometry; cone: T.ConeGeometry; ring: T.TorusGeometry };

/** How wide (along the road) the mower's cart path is, and how far out past the middle of the road it runs either side. */
const PATH_W = 6;
const pathTo = (h: LiveHazard) => (h.cross ?? 16) + lengthOf(h) + 4;

/** Where the walls open for the mower's cart path: [side, from, to] (the logic's walls stay where they are; only not drawn). */
export function mowerGaps(r: Race): [number, number, number][] {
  return r.hazards.filter((h) => h.kind === 'mower').flatMap((h) => [-1, 1].map((side): [number, number, number] => [side, h.s - PATH_W / 2, h.s + PATH_W / 2]));
}

/** Whether (s, d) is on the mower's cart path out past the road, give or take `margin` (the scenery keeps off it). */
export function onPath(t: Track, r: Race, s: number, d: number, margin: number) {
  return r.hazards.some((h) => h.kind === 'mower' && Math.abs(deltaS(t, h.s, s)) < PATH_W / 2 + margin && Math.abs(d) < pathTo(h) + margin);
}

type GooseView = { i: number; g: T.Group; body: T.Group; neck: T.Group; wings: T.Group[]; mark: T.Sprite; rest: { x: number; z: number }; face: number; out: number; flap: number };
type MowerView = { i: number; g: T.Group; reels: T.Mesh[]; wheels: T.Mesh[]; beacon: T.Mesh; flare: T.Sprite; litMat: T.MeshBasicMaterial; offMat: T.MeshBasicMaterial; roll: number; face: number };

export type Fairway = { tick: (race: Race, me: number, clock: number, dt: number) => void };

export function buildFairway(THREE: Three, scene: T.Scene, r: Race, geo: Geo): Fairway | null {
  const t = r.track;
  const pieces = r.hazards.filter((h) => (h.kind === 'tether' && h.look === 'goose') || h.kind === 'mower');
  if (!pieces.length) return null;
  const box = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  const blob = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geo.ball, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  const glowTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  // the warning over a goose about to go for you
  const warnMat = new THREE.SpriteMaterial({
    map: texture(
      THREE,
      canvas(64, 64, (g) => {
        g.fillStyle = '#ffd23a';
        g.strokeStyle = '#c62828';
        g.lineWidth = 6;
        g.beginPath();
        g.arc(32, 32, 27, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#c62828';
        g.font = 'bold 42px Inter, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', 32, 35);
      }),
    ),
    depthTest: false,
    fog: false,
  });
  /** A flat decal on the road at (s, d), turned to face along it. */
  const decal = (mat: T.Material, s: number, d: number, w: number, l: number, y = 0.07) => {
    const p = pointAt(t, s, d);
    const m = new THREE.Mesh(geo.plane, mat);
    m.rotation.set(-Math.PI / 2, 0, headingOf(p.tx, p.tz) + Math.PI);
    m.scale.set(w, l, 1);
    m.position.set(p.x, y, p.z);
    m.renderOrder = 2;
    scene.add(m);
    return m;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The geese: each on its nest on the bank, with the ring it lunges into painted on the road
  const plumage = new THREE.MeshLambertMaterial({ color: 0x8a7a66 });
  const breast = new THREE.MeshLambertMaterial({ color: 0xe2d8c6 });
  const black = new THREE.MeshLambertMaterial({ color: 0x1c1c1e });
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f4ee });
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x6c5e4e });
  const straw = new THREE.MeshLambertMaterial({ color: 0xb08a4a });
  const egg = new THREE.MeshLambertMaterial({ color: 0xf2ecdc });
  const ringMat = new THREE.MeshBasicMaterial({
    map: texture(
      THREE,
      canvas(128, 128, (g) => {
        g.strokeStyle = 'rgba(255,160,30,1)';
        g.lineWidth = 11;
        g.setLineDash([16, 9]);
        g.beginPath();
        g.arc(64, 64, 58, 0, Math.PI * 2);
        g.stroke();
        // and a goose's footprint in the middle
        g.setLineDash([]);
        g.lineWidth = 6;
        g.lineCap = 'round';
        for (const a of [-0.5, 0, 0.5]) {
          g.beginPath();
          g.moveTo(64, 78);
          g.lineTo(64 + Math.sin(a) * 26, 78 - Math.cos(a) * 26);
          g.stroke();
        }
      }),
    ),
    transparent: true,
    depthWrite: false,
  });
  const geese: GooseView[] = [];
  r.hazards.forEach((h, i) => {
    if (h.kind !== 'tether' || h.look !== 'goose') return;
    const k = h.r / 0.65;
    const g = new THREE.Group();
    // (the body tilts and the neck reaches as one: the body group sits on the legs, the neck on the body's front)
    const body = new THREE.Group();
    body.position.y = 0.62 * k;
    g.add(body);
    blob(body, plumage, 0, 0, 0, 0.34 * k, 0.3 * k, 0.6 * k);
    blob(body, breast, 0, -0.06 * k, 0.24 * k, 0.28 * k, 0.24 * k, 0.32 * k);
    blob(body, black, 0, 0.06 * k, -0.52 * k, 0.16 * k, 0.1 * k, 0.2 * k);
    blob(body, white, 0, -0.04 * k, -0.42 * k, 0.2 * k, 0.12 * k, 0.16 * k);
    const wings = [-1, 1].map((side) => {
      const w = new THREE.Group();
      w.position.set(side * 0.3 * k, 0.12 * k, 0.05 * k);
      box(w, wingMat, side * 0.32 * k, 0, -0.05 * k, 0.64 * k, 0.07 * k, 0.72 * k);
      body.add(w);
      return w;
    });
    const neck = new THREE.Group();
    neck.position.set(0, 0.12 * k, 0.48 * k);
    body.add(neck);
    const stalk = new THREE.Mesh(geo.wheel, black);
    stalk.scale.set(0.09 * k, 0.62 * k, 0.09 * k);
    stalk.position.y = 0.3 * k;
    neck.add(stalk);
    const head = new THREE.Group();
    head.position.y = 0.64 * k;
    neck.add(head);
    blob(head, black, 0, 0, 0.06 * k, 0.12 * k, 0.11 * k, 0.17 * k);
    // the white chinstrap, and the bill
    blob(head, white, 0, -0.03 * k, 0.03 * k, 0.125 * k, 0.07 * k, 0.09 * k);
    box(head, black, 0, -0.02 * k, 0.23 * k, 0.07 * k, 0.05 * k, 0.14 * k);
    for (const side of [-1, 1]) box(g, black, side * 0.12 * k, 0.17 * k, 0, 0.05 * k, 0.34 * k, 0.05 * k);
    for (const side of [-1, 1]) box(g, black, side * 0.12 * k, 0.015, 0.06 * k, 0.12 * k, 0.03, 0.16 * k);
    scene.add(g);
    // the nest on the bank by the water, three eggs in it
    const nestAt = pointAt(t, h.s - 2.4, h.d - Math.sign(h.d));
    const nest = new THREE.Mesh(geo.ring, straw);
    nest.rotation.x = -Math.PI / 2;
    nest.scale.set(0.4, 0.4, 0.7);
    nest.position.set(nestAt.x, 0.1, nestAt.z);
    scene.add(nest);
    for (let n = 0; n < 3; n++) blob(scene, egg, nestAt.x + Math.cos(n * 2.1) * 0.13, 0.12, nestAt.z + Math.sin(n * 2.1) * 0.13, 0.08, 0.06, 0.1);
    // the ring it lunges into, always painted on the road
    decal(ringMat, h.s, h.aim ?? 0, (h.r + 0.35) * 2, (h.r + 0.35) * 2, 0.075);
    const mark = new THREE.Sprite(warnMat);
    mark.scale.set(1.2, 1.2, 1);
    mark.visible = false;
    mark.renderOrder = 5;
    scene.add(mark);
    const at = pointAt(t, h.s, 0);
    // (it faces out over the road from its bank)
    const face = headingOf(-at.tz * -Math.sign(h.d), at.tx * -Math.sign(h.d));
    geese.push({ i, g, body, neck, wings, mark, rest: pointAt(t, h.s, h.d), face, out: 0, flap: 0 });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The gang mower: a tractor towing three reel units across on its cart path, the path itself out past the walls either
  // side, the crossing marked on the road, and a sign either way up the road
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xb9ad96 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  const signMat = new THREE.MeshBasicMaterial({
    map: texture(
      THREE,
      canvas(128, 128, (g) => {
        g.translate(64, 64);
        g.rotate(Math.PI / 4);
        g.fillStyle = '#ffd23a';
        g.fillRect(-42, -42, 84, 84);
        g.strokeStyle = '#1a1a1a';
        g.lineWidth = 5;
        g.strokeRect(-38, -38, 76, 76);
        g.rotate(-Math.PI / 4);
        // a little tractor
        g.fillStyle = '#1a1a1a';
        g.fillRect(-22, -14, 26, 14);
        g.fillRect(-6, -28, 10, 16);
        g.beginPath();
        g.arc(-12, 6, 12, 0, Math.PI * 2);
        g.arc(16, 10, 8, 0, Math.PI * 2);
        g.fill();
      }),
    ),
    transparent: true,
    side: THREE.DoubleSide,
  });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x55575c });
  const xingMat = new THREE.MeshBasicMaterial({
    map: texture(
      THREE,
      canvas(256, 128, (g) => {
        g.fillStyle = 'rgba(255,210,58,0.92)';
        g.font = 'bold 54px Inter, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('MOWER', 128, 36);
        g.fillText('XING', 128, 96);
      }),
    ),
    transparent: true,
    depthWrite: false,
  });
  const green = new THREE.MeshLambertMaterial({ color: 0x2f7d3a });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xe8c21a });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1b1b1d });
  const steel = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  const seatMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const vest = new THREE.MeshLambertMaterial({ color: 0xff8a1a, emissive: 0x3a1800 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc89a74 });
  const reelTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#7d848c';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = '#d6dbe0';
      g.lineWidth = 6;
      for (let k = -64; k < 128; k += 16) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + 32, 64);
        g.stroke();
      }
    }),
  );
  const reelMat = new THREE.MeshLambertMaterial({ map: reelTex });
  const mowers: MowerView[] = [];
  r.hazards.forEach((h, i) => {
    if (h.kind !== 'mower') return;
    const half = lengthOf(h) / 2;
    const far = pathTo(h);
    // the cart path, out from each wall to where it waits (the road between is the road)
    for (const side of [-1, 1]) {
      const base = pointAt(t, h.s, 0);
      const pos: number[] = [];
      for (const [along, d] of [[-PATH_W / 2, t.edge - 0.3], [PATH_W / 2, t.edge - 0.3], [PATH_W / 2, far], [-PATH_W / 2, far]]) pos.push(base.x + base.tx * along - base.tz * d * side, 0.035, base.z + base.tz * along + base.tx * d * side);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geom.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
      geom.computeVertexNormals();
      scene.add(new THREE.Mesh(geom, pathMat));
    }
    // yellow lines across the road either side of the crossing, and MOWER XING painted on the way up to it
    for (const e of [-1, 1]) decal(lineMat, h.s + e * (h.r + 0.5), 0, 2 * t.half, 0.3, 0.072);
    decal(xingMat, h.s - h.r - 9, 0, 7, 3.5, 0.072);
    // a yellow diamond sign on a pole either side, well up the road
    for (const side of [-1, 1]) {
      const p = pointAt(t, h.s - 34, side * (t.edge + 1.2));
      const pole = new THREE.Mesh(geo.box, poleMat);
      pole.scale.set(0.12, 2.6, 0.12);
      pole.position.set(p.x, 1.3, p.z);
      scene.add(pole);
      const sign = new THREE.Mesh(geo.plane, signMat);
      sign.scale.set(1.8, 1.8, 1);
      sign.position.set(p.x, 3.1, p.z);
      sign.rotation.y = headingOf(p.tx, p.tz) + Math.PI;
      scene.add(sign);
    }
    // the rig, its front (the tractor's nose) toward local +z, the way it is going
    const g = new THREE.Group();
    const front = half;
    // the tractor
    box(g, green, 0, 0.85, front - 1.9, 1.5, 0.55, 3.2);
    box(g, green, 0, 1.25, front - 0.9, 1.15, 0.7, 1.5);
    box(g, seatMat, 0, 1.35, front - 2.9, 0.75, 0.45, 0.6);
    for (const side of [-1, 1]) box(g, steel, side * 0.72, 1.85, front - 3.15, 0.09, 1.9, 0.09);
    box(g, steel, 0, 2.8, front - 3.15, 1.55, 0.09, 0.09);
    // the groundskeeper in a hi-vis vest
    box(g, vest, 0, 1.85, front - 2.85, 0.55, 0.62, 0.36);
    blob(g, skin, 0, 2.35, front - 2.8, 0.17, 0.19, 0.17);
    box(g, white, 0, 2.5, front - 2.8, 0.36, 0.1, 0.36);
    const wheels: T.Mesh[] = [];
    for (const [z, rad, w] of [[front - 2.7, 0.72, 0.42], [front - 0.6, 0.42, 0.3]] as const) {
      for (const side of [-1, 1]) {
        const wh = new THREE.Mesh(geo.wheel, tyre);
        wh.rotation.z = Math.PI / 2;
        wh.scale.set(rad, w, rad);
        wh.position.set(side * 0.95, rad, z);
        g.add(wh);
        wheels.push(wh);
      }
    }
    // its amber beacon on the roll bar, and the glow round it seen from well down the road
    const litMat = new THREE.MeshBasicMaterial({ color: 0xffb21a });
    const offMat = new THREE.MeshBasicMaterial({ color: 0x7a4a10 });
    const beacon = blob(g, offMat, 0, 3.0, front - 3.15, 0.2, 0.2, 0.2);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa31a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    flare.scale.set(3.2, 3.2, 1);
    flare.position.set(0, 3.0, front - 3.15);
    flare.visible = false;
    g.add(flare);
    // the drawbar and three reel units behind, each as wide as the rig is along the road
    box(g, steel, 0, 0.55, front - 4.1, 0.14, 0.14, 1.4);
    const reels: T.Mesh[] = [];
    const w = h.r * 2 - 0.3;
    for (const z of [front - 5.6, front - 8.3, front - 11]) {
      box(g, yellow, 0, 0.95, z, w, 0.16, 0.5);
      for (const side of [-1, 1]) box(g, yellow, side * (w / 2 - 0.1), 0.6, z, 0.12, 0.7, 0.9);
      const reel = new THREE.Mesh(geo.wheel, reelMat);
      reel.rotation.z = Math.PI / 2;
      reel.scale.set(0.34, w - 0.3, 0.34);
      reel.position.set(0, 0.36, z);
      g.add(reel);
      reels.push(reel);
      if (z > front - 11) box(g, steel, 0, 0.5, z - 1.35, 0.12, 0.12, 1.6);
    }
    g.visible = true;
    scene.add(g);
    mowers.push({ i, g, reels, wheels, beacon, flare, litMat, offMat, roll: 0, face: 1 });
  });

  const ease = (u: number) => u * u * (3 - 2 * u);
  return {
    tick(race: Race, me: number, clock: number, dt: number) {
      const lap = race.karts[me]?.lap ?? 1;
      for (const v of geese) {
        const h = race.hazards[v.i];
        const st = hazState(race, h, race.time, lap);
        const p = pointAt(t, h.s, st.d);
        v.g.position.set(p.x, 0, p.z);
        // crouched and hissing (head down, wings half out), then flying at you (wings spread and beating), then waddling
        // back; sat by its nest it looks about and bobs its head
        const crouch = st.phase === 'idle' ? st.warn : st.live ? 1 : 0;
        v.out = st.live ? st.lift : 0;
        v.flap += dt * (st.live ? 26 : crouch > 0 ? 6 : 0);
        v.g.rotation.y = v.face + (crouch > 0 ? 0 : Math.sin(clock * 0.7 + v.i) * 0.6);
        v.body.rotation.x = 0.35 * crouch;
        v.body.position.y = (0.62 - 0.1 * crouch + (st.live ? 0.25 * Math.abs(Math.sin(v.flap * 0.5)) : 0)) * (h.r / 0.65);
        v.neck.rotation.x = crouch > 0 ? 0.9 * ease(crouch) : 0.15 + Math.max(0, Math.sin(clock * 3 + v.i * 2)) * 0.5;
        for (const [n, w] of v.wings.entries()) {
          const side = n === 0 ? -1 : 1;
          const spread = st.live ? 0.9 + Math.sin(v.flap) * 0.6 : crouch * 0.5;
          w.rotation.z = side * spread;
        }
        v.mark.visible = crouch > 0 && !st.live;
        if (v.mark.visible) v.mark.position.set(p.x, 2.7 + Math.sin(clock * 10) * 0.08, p.z);
      }
      for (const v of mowers) {
        const h = race.hazards[v.i];
        const st = hazState(race, h, race.time, lap);
        const p = pointAt(t, h.s, st.d);
        v.g.position.set(p.x, 0, p.z);
        // facing the way it is going (or will go next): from the side it waits on toward the other
        const every = h.every ?? 28;
        const c0 = race.time - ((((race.time - (h.phase ?? 0)) % every) + every) % every);
        const run = mowerRun(race, h, Math.round((c0 - (h.phase ?? 0)) / every));
        const going = Math.abs(st.d) >= run.from - 0.5 ? -Math.sign(st.d) || 1 : run.dir;
        const at = pointAt(t, h.s, 0);
        v.face = going;
        v.g.rotation.y = headingOf(-at.tz * going, at.tx * going);
        const moving = Math.abs(st.d) < run.from - 0.01;
        v.roll += moving ? dt * Math.abs(run.v) : 0;
        for (const w of v.wheels) w.rotation.x = v.roll / 0.6;
        for (const reel of v.reels) reel.rotation.x = moving ? v.roll * 3 : reel.rotation.x;
        // the beacon flashing from its warning until it is off the road
        const on = (st.warn > 0 || st.live) && Math.floor(clock * 3) % 2 === 0;
        v.beacon.material = on ? v.litMat : v.offMat;
        v.flare.visible = on;
      }
    },
  };
}
