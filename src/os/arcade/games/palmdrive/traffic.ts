// three.js view of Hoover Nights' traffic and the Tree (scene.ts builds it for a course that has any): the oncoming cars
// and the delivery van with their headlights, out of their side streets and off into the other; the Marguerite crossing
// the west straight with its bells, lights and gates; the Stanford Tree lunging on its bungee; and the Claw's fountain
// jets. It reads a Race every frame and never changes it.
import type { T } from './gl';
import { KART_R, cycleAt, headingOf, lengthOf, pointAt, traffic, wrapAngle, type Track } from './track';
import { canvas, makeBus, texture } from './scenery';
import { TREE, hazState, hazardS, shuttleRun, shuttleSkips, spanGone, trafficD, type LiveHazard, type Race } from './logic';

type Three = typeof import('three');
type Geo = { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; plane: T.PlaneGeometry; cone: T.ConeGeometry };

/** A side street off the road on one side, centred at s and `half` either way along it, out to |d| = `to`. */
export type Street = { s: number; side: -1 | 1; half: number; to: number };
/** How far past the end of its stretch a car is seen coming down its side street, or going off down the other (s). */
const STREET_T = 1.6;

/** The side streets the traffic comes and goes by: either side of the crossing, and at each end of the cars' stretch. */
export function streetsOf(r: Race): Street[] {
  const out: Street[] = [];
  const seen = new Set<string>();
  const add = (st: Street) => {
    const key = `${Math.round(st.s)}:${st.side}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(st);
  };
  for (const h of r.hazards) {
    if (h.kind === 'shuttle') for (const side of [-1, 1] as const) add({ s: h.s, side, half: 2.6, to: (h.cross ?? 16) + lengthOf(h) + 12 });
    if (traffic(h.kind) && h.span && h.bay !== undefined) for (const s of h.span) add({ s, side: Math.sign(h.bay) as -1 | 1, half: 2.4, to: Math.abs(h.bay) + Math.abs(h.drive ?? 0) * STREET_T + 4 });
  }
  return out;
}

/**
 * Where the walls open for the side streets: [side, from, to] (the logic's walls stay where they are; these are only
 * not drawn). A car's street opens a little further along the road on the side it turns in from.
 */
export function wallGaps(r: Race): [number, number, number][] {
  const gaps: [number, number, number][] = [];
  for (const st of streetsOf(r)) {
    const car = r.hazards.find((h) => traffic(h.kind) && h.span && (h.span[0] === st.s || h.span[1] === st.s));
    if (!car) {
      gaps.push([st.side, st.s - st.half - 0.4, st.s + st.half + 0.4]);
      continue;
    }
    // (the car swings in over the first part of its stretch and out over the last, toward its middle)
    const inward = st.s === car.span![1] ? -1 : 1;
    const [a, b] = [st.s - inward * (st.half + 0.6), st.s + inward * 12];
    gaps.push([st.side, Math.min(a, b), Math.max(a, b)]);
  }
  return gaps;
}

type CarView = { i: number; g: T.Group; wheels: T.Mesh[]; h: number; roll: number; beacon: T.Mesh | null; len: number };
type BusView = { i: number; g: T.Group; wheels: T.Mesh[]; roll: number };
type TreeView = { i: number; g: T.Group; body: T.Group; eyes: T.Mesh[]; pupilMat: T.MeshBasicMaterial; cord: T.Mesh; d: number; post: T.Vector3 };
type JetView = { i: number; column: T.Mesh; mat: T.MeshBasicMaterial; crown: T.Sprite; rings: T.Mesh[]; ringMat: T.MeshBasicMaterial; vent: T.MeshBasicMaterial; x: number; z: number; r: number };

export type Traffic = { tick: (race: Race, me: number, clock: number, dt: number) => void };

export function buildTraffic(THREE: Three, scene: T.Scene, r: Race, geo: Geo): Traffic | null {
  const t = r.track;
  // (a tether dressed as a goose is the golf course's, drawn in fairway.ts)
  const has = r.hazards.some((h) => traffic(h.kind) || h.kind === 'shuttle' || (h.kind === 'tether' && h.look !== 'goose') || (h.kind === 'geyser' && h.look === 'fountain'));
  if (!has) return null;
  const glowTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  const flare = (color: number, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.scale.set(size, size, 1);
    return s;
  };
  const asphalt = new THREE.MeshLambertMaterial({ color: 0x3e3e47, emissive: 0x101014 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d8 });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x30333c });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
  const poolTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,222,160,0.34)');
      grad.addColorStop(1, 'rgba(255,222,160,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false });
  const box = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  /** A point d to the right of the road at s, and the way the road runs there. */
  const at = (s: number, d: number) => pointAt(t, s, d);
  const lampPost = (s: number, d: number) => {
    const p = at(s, d);
    const g = new THREE.Group();
    box(g, poleMat, 0, 2.8, 0, 0.18, 5.6, 0.18);
    box(g, lampMat, 0, 5.55, 0, 0.7, 0.18, 0.7);
    const pool = new THREE.Mesh(geo.plane, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(10, 10, 1);
    pool.position.set(0, 0.07, 0);
    g.add(pool);
    g.position.set(p.x, 0, p.z);
    scene.add(g);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The side streets: asphalt from the wall out across the campus, edged in white, a lamp at each corner
  for (const st of streetsOf(r)) {
    const geom = new THREE.BufferGeometry();
    // (a straight street, square off the road at s)
    const base = at(st.s, 0);
    const pos: number[] = [];
    for (const [along, d] of [[-st.half, t.edge - 0.3], [st.half, t.edge - 0.3], [st.half, st.to], [-st.half, st.to]]) {
      pos.push(base.x + base.tx * along - base.tz * d * st.side, 0.035, base.z + base.tz * along + base.tx * d * st.side);
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setIndex(st.side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    geom.computeVertexNormals();
    scene.add(new THREE.Mesh(geom, asphalt));
    for (const e of [-1, 1]) {
      const line = new THREE.Mesh(geo.box, lineMat);
      const mid = (t.edge + st.to) / 2;
      line.position.set(base.x + base.tx * e * (st.half - 0.25) - base.tz * mid * st.side, 0.045, base.z + base.tz * e * (st.half - 0.25) + base.tx * mid * st.side);
      line.rotation.y = headingOf(-base.tz * st.side, base.tx * st.side);
      line.scale.set(0.15, 0.02, st.to - t.edge);
      scene.add(line);
    }
    lampPost(st.s + st.half + 1.2, st.side * (t.edge + 1.6));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The oncoming cars and the van, headlights blazing
  const paints = [0x2b4c7e, 0x9a2020, 0xd8d8d0, 0x2f6a4a, 0x3a3a42];
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1b2433, emissive: 0x0a1018 });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x16161a });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1e });
  const beamTex = texture(
    THREE,
    canvas(64, 128, (c) => {
      const fade = c.createLinearGradient(0, 0, 0, 128);
      fade.addColorStop(0, 'rgba(255,240,200,0.6)');
      fade.addColorStop(1, 'rgba(255,240,200,0)');
      c.fillStyle = fade;
      c.beginPath();
      c.moveTo(20, 0);
      c.lineTo(44, 0);
      c.lineTo(64, 128);
      c.lineTo(0, 128);
      c.closePath();
      c.fill();
    }),
  );
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const vanSign = new THREE.MeshBasicMaterial({
    map: texture(
      THREE,
      canvas(256, 64, (g) => {
        g.fillStyle = '#f2efe6';
        g.fillRect(0, 0, 256, 64);
        g.fillStyle = '#8c1515';
        g.font = 'bold 26px Inter, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('CAMPUS DELIVERIES', 128, 33);
      }),
    ),
  });
  const amberMat = new THREE.MeshBasicMaterial({ color: 0xffa31a });
  const cars: CarView[] = [];
  r.hazards.forEach((h, i) => {
    if (!traffic(h.kind)) return;
    const van = h.kind === 'van';
    const len = lengthOf(h);
    const w = h.r * 2;
    const g = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color: van ? 0xf2efe6 : paints[i % paints.length], emissive: van ? 0x2a2a28 : 0x0c0c10 });
    if (van) {
      // a tall box with a short cab in front
      box(g, paint, 0, 1.45, -0.6, w, 2.3, len - 1.2);
      box(g, paint, 0, 0.95, len / 2 - 0.6, w, 1.3, 1.2);
      box(g, glassMat, 0, 1.55, len / 2 - 0.1, w - 0.2, 0.55, 0.3);
      for (const side of [-1, 1]) {
        const sign = new THREE.Mesh(geo.plane, vanSign);
        sign.position.set(side * (h.r + 0.02), 1.7, -0.6);
        sign.scale.set(len - 1.8, 0.8, 1);
        sign.rotation.y = (side * Math.PI) / 2;
        g.add(sign);
      }
    } else {
      box(g, paint, 0, 0.6, 0, w, 0.65, len);
      box(g, paint, 0, 1.15, -0.25, w - 0.2, 0.5, len * 0.5);
      box(g, glassMat, 0, 1.15, -0.25, w - 0.1, 0.42, len * 0.5 - 0.15);
    }
    const wheels: T.Mesh[] = [];
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const wh = new THREE.Mesh(geo.wheel, tyreMat);
      wh.rotation.z = Math.PI / 2;
      wh.scale.set(0.34, 0.24, 0.34);
      wh.position.set(x * (h.r - 0.05), 0.34, z * (len / 2 - 0.85));
      g.add(wh);
      wheels.push(wh);
    }
    for (const side of [-1, 1]) {
      box(g, headMat, side * (h.r - 0.3), 0.7, len / 2 + 0.02, 0.42, 0.2, 0.05);
      box(g, tailMat, side * (h.r - 0.25), van ? 0.9 : 0.75, -len / 2 - 0.02, 0.3, 0.22, 0.05);
      const f = flare(0xfff2cc, 4.2);
      f.position.set(side * (h.r - 0.3), 0.75, len / 2 + 0.2);
      g.add(f);
      const tf = flare(0xff3020, 0.9);
      tf.position.set(side * (h.r - 0.25), van ? 0.9 : 0.75, -len / 2 - 0.15);
      g.add(tf);
    }
    // the pool its headlights throw down the road ahead of it
    const beam = new THREE.Mesh(geo.plane, beamMat);
    beam.rotation.x = -Math.PI / 2;
    beam.scale.set(w + 3, 20, 1);
    beam.position.set(0, 0.09, len / 2 + 10);
    beam.renderOrder = 2;
    g.add(beam);
    const beacon = van ? box(g, amberMat, 0, 2.7, len / 2 - 1.4, 0.4, 0.22, 0.4) : null;
    g.visible = false;
    scene.add(g);
    cars.push({ i, g, wheels, h: 0, roll: 0, beacon, len });
  });
  /**
   * Where a car is drawn at race time `time`: on its stretch (pure, from the logic); or coming down its side street to
   * the start of it or going off down the other, for a moment either side (only drawn); or nowhere. With which way it
   * is going.
   */
  const carAt = (h: LiveHazard, time: number): { x: number; z: number; face: number } | null => {
    const span = h.span!;
    const v = Math.abs(h.drive ?? 0);
    const every = h.every ?? 60;
    const c = time - (h.phase ?? 0);
    const len = span[1] - span[0];
    const into = c < 0 ? c : c % every;
    const oncoming = (h.drive ?? 0) < 0;
    const bay = h.bay ?? h.d;
    const street = (s: number, out: number, leaving: boolean) => {
      const p = at(s, bay - Math.sign(bay) * out);
      // (square to the road, coming in or going out)
      const sg = leaving ? Math.sign(bay) : -Math.sign(bay);
      return { x: p.x, z: p.z, face: headingOf(-p.tz * sg, p.tx * sg) };
    };
    if (!spanGone(h, time)) {
      const s = hazardS(t, h, time);
      const d = trafficD(h, time);
      const p = at(s, d);
      const q = at(hazardS(t, h, time - 0.05), trafficD(h, time - 0.05));
      return { x: p.x, z: p.z, face: Math.hypot(p.x - q.x, p.z - q.z) > 1e-4 ? headingOf(p.x - q.x, p.z - q.z) : headingOf(p.tx * (oncoming ? -1 : 1), p.tz * (oncoming ? -1 : 1)) };
    }
    const lead = c < 0 ? -c : every - into;
    if (lead <= STREET_T) return street(oncoming ? span[1] : span[0], v * lead, false);
    const gone = c >= 0 ? into - len / v : Infinity;
    if (gone >= 0 && gone <= STREET_T) return street(oncoming ? span[0] : span[1], v * gone, true);
    return null;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The Marguerite crossing: the articulated bus (two halves and the bellows between), the crossbucks with their bells and
  // flashing lights, the gate arms, the hatched box on the road and the stop line
  const shuttles: BusView[] = [];
  const bellows = new THREE.MeshLambertMaterial({ color: 0x2a2b30, emissive: 0x0a0a0c });
  r.hazards.forEach((h, i) => {
    if (h.kind !== 'shuttle') return;
    const half = (lengthOf(h) - 0.8) / 2;
    const g = new THREE.Group();
    const wheels: T.Mesh[] = [];
    for (const side of [1, -1]) {
      const bus = makeBus(THREE, geo, half, h.r);
      // (the back half's lights and the pool of light ahead of it would show at the joint)
      if (side < 0) for (const o of [...bus.g.children]) if (o.position.z > half / 2 - 0.2 && (o.position.y < 1.2 || o.position.z > half / 2 + 0.5)) bus.g.remove(o);
      bus.g.position.z = side * (half / 2 + 0.4);
      g.add(bus.g);
      wheels.push(...bus.wheels);
    }
    for (let k = -2; k <= 2; k++) box(g, bellows, 0, 1.7, k * 0.17, h.r * 2 - 0.25 - (k % 2 ? 0.08 : 0), 2.5, 0.12);
    g.visible = false;
    scene.add(g);
    shuttles.push({ i, g, wheels, roll: 0 });
  });
  const xings = [...new Set(r.hazards.filter((h) => h.kind === 'shuttle').map((h) => h.s))];
  type Signal = { lamps: T.MeshBasicMaterial[]; arm: T.Group; side: number };
  const signals: { s: number; posts: Signal[] }[] = [];
  const crossTex = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.translate(64, 64);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        g.save();
        g.rotate(a);
        g.fillStyle = '#c62828';
        g.fillRect(-62, -13, 124, 26);
        g.fillStyle = '#ffffff';
        g.fillRect(-60, -10, 120, 20);
        g.restore();
      }
      g.fillStyle = '#c62828';
      g.font = 'bold 13px Inter, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.rotate(Math.PI / 4);
      g.fillText('MARGUERITE', 0, 1);
    }),
  );
  const crossMat = new THREE.MeshBasicMaterial({ map: crossTex, transparent: true, side: THREE.DoubleSide });
  const armTex = texture(
    THREE,
    canvas(64, 8, (g) => {
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 ? '#ffffff' : '#d32f2f';
        g.fillRect(k * 8, 0, 8, 8);
      }
    }),
  );
  const armMat = new THREE.MeshBasicMaterial({ map: armTex });
  const bellMat = new THREE.MeshLambertMaterial({ color: 0xd8b04a, emissive: 0x3a2a08 });
  const hatchTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.strokeStyle = 'rgba(255,207,31,0.9)';
      g.lineWidth = 5;
      for (let k = -64; k < 128; k += 16) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + 64, 64);
        g.moveTo(k + 64, 0);
        g.lineTo(k, 64);
        g.stroke();
      }
    }),
  );
  hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
  for (const s of xings) {
    const h = r.hazards.find((x) => x.kind === 'shuttle' && x.s === s)!;
    const base = at(s, 0);
    const rd = headingOf(base.tx, base.tz);
    // the box on the road the bus crosses, hatched yellow, edged white, and a stop line before it
    const hatch = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: hatchTex, transparent: true, depthWrite: false }));
    hatchTex.repeat.set((2 * t.edge) / 4, (2 * h.r) / 4);
    hatch.rotation.set(-Math.PI / 2, 0, rd);
    hatch.scale.set(2 * t.edge, 2 * h.r, 1);
    hatch.position.set(base.x, 0.062, base.z);
    hatch.renderOrder = 2;
    scene.add(hatch);
    for (const o of [-(h.r + 0.1), h.r + 0.1, -(h.r + 3.2)]) {
      const p = at(s + o, 0);
      const ln = new THREE.Mesh(geo.box, lineMat);
      ln.position.set(p.x, 0.06, p.z);
      ln.rotation.y = rd;
      ln.scale.set(2 * t.half, 0.02, o < -h.r - 1 ? 0.45 : 0.16);
      scene.add(ln);
    }
    // a crossbuck on each side, on the near side of the crossing, with two red lamps and a bell; and a gate arm that
    // lowers out over the edge of the road
    const posts: Signal[] = [];
    for (const side of [-1, 1]) {
      const p = at(s - h.r - 2.2, side * (t.edge + 0.7));
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = rd;
      box(g, poleMat, 0, 2.2, 0, 0.18, 4.4, 0.18);
      const x = new THREE.Mesh(geo.plane, crossMat);
      x.position.set(0, 4.1, -0.12);
      x.scale.set(1.9, 1.9, 1);
      x.rotation.y = Math.PI;
      g.add(x);
      box(g, poleMat, 0, 3.05, -0.1, 1.3, 0.12, 0.1);
      const lamps: T.MeshBasicMaterial[] = [];
      for (const e of [-1, 1]) {
        const m = new THREE.MeshBasicMaterial({ color: 0x3a0806 });
        const lamp = new THREE.Mesh(geo.ball, m);
        lamp.scale.setScalar(0.24);
        lamp.position.set(e * 0.52, 3.05, -0.25);
        g.add(lamp);
        lamps.push(m);
      }
      const bell = new THREE.Mesh(geo.ball, bellMat);
      bell.scale.set(0.3, 0.22, 0.3);
      bell.position.set(0, 4.95, 0);
      g.add(bell);
      // the arm: hinged at the post, swinging down from upright to out over the road
      const arm = new THREE.Group();
      arm.position.set(0, 1.1, 0);
      const bar = new THREE.Mesh(geo.box, armMat);
      bar.scale.set(0.12, 4.6, 0.12);
      bar.position.y = 2.3;
      arm.add(bar);
      g.add(arm);
      scene.add(g);
      posts.push({ lamps, arm, side });
    }
    signals.push({ s, posts });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The Stanford Tree on its bungee: its post with a lamp, the cord, the Tree (stacked green boughs, a trunk, googly eyes
  // and a grin), and its reach painted on the road
  const trees: TreeView[] = [];
  const bough = new THREE.MeshLambertMaterial({ color: 0x3aa04a, emissive: 0x1a5a24 });
  const boughDark = new THREE.MeshLambertMaterial({ color: 0x2a8038, emissive: 0x12441a });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cordMat = new THREE.MeshLambertMaterial({ color: 0xd32f2f, emissive: 0x3a0606 });
  r.hazards.forEach((h, i) => {
    if (h.kind !== 'tether' || h.look === 'goose') return;
    const post = at(h.s, h.d);
    const pg = new THREE.Group();
    pg.position.set(post.x, 0, post.z);
    box(pg, poleMat, 0, 1.8, 0, 0.22, 3.6, 0.22);
    box(pg, lampMat, 0, 3.7, 0, 0.6, 0.2, 0.6);
    const pool = new THREE.Mesh(geo.plane, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(11, 11, 1);
    pool.position.set(0, 0.075, 0);
    pg.add(pool);
    scene.add(pg);
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const cone = (y: number, rad: number, hgt: number, m: T.Material) => {
      const c = new THREE.Mesh(geo.cone, m);
      c.position.y = y;
      c.scale.set(rad, hgt, rad);
      body.add(c);
    };
    const trunk = new THREE.Mesh(geo.wheel, trunkMat);
    trunk.scale.set(0.3, 0.6, 0.3);
    trunk.position.y = 0.3;
    body.add(trunk);
    cone(1.05, h.r, 1.2, boughDark);
    cone(1.75, h.r * 0.85, 1.1, bough);
    cone(2.4, h.r * 0.62, 1.0, boughDark);
    cone(2.95, h.r * 0.4, 0.8, bough);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyes: T.Mesh[] = [];
    for (const e of [-1, 1]) {
      const eye = new THREE.Mesh(geo.ball, white);
      eye.scale.setScalar(0.26);
      eye.position.set(e * 0.3, 1.95, 0.72);
      body.add(eye);
      const pupil = new THREE.Mesh(geo.ball, pupilMat);
      pupil.scale.setScalar(0.12);
      pupil.position.set(e * 0.3, 1.95, 0.95);
      body.add(pupil);
      eyes.push(pupil);
    }
    // a big red grin
    const grin = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0xc62828 }));
    grin.position.set(0, 1.6, 0.86);
    grin.rotation.z = Math.PI;
    body.add(grin);
    const rest = h.d - TREE.rest * Math.sign(h.d || 1);
    const p0 = at(h.s, rest);
    g.position.set(p0.x, 0, p0.z);
    scene.add(g);
    const cord = new THREE.Mesh(geo.wheel, cordMat);
    cord.scale.set(0.07, 1, 0.07);
    scene.add(cord);
    trees.push({ i, g, body, eyes, pupilMat, cord, d: rest, post: new THREE.Vector3(post.x, 2.6, post.z) });
    // its reach on the road: a dashed outline from its post out to the end of its lunge
    const lo = (h.aim ?? 0) - h.r - 0.15;
    const hi = Math.min(rest + h.r, -t.half - 0.2);
    const across = Math.abs(hi - lo);
    const reachTex = texture(
      THREE,
      canvas(256, 64, (g2) => {
        g2.fillStyle = 'rgba(220,40,40,0.16)';
        g2.fillRect(4, 4, 248, 56);
        g2.strokeStyle = '#ff5a4a';
        g2.lineWidth = 6;
        g2.setLineDash([18, 12]);
        g2.strokeRect(4, 4, 248, 56);
      }),
    );
    const ring = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: reachTex, transparent: true, depthWrite: false }));
    const mid = at(h.s, (lo + hi) / 2);
    ring.rotation.set(-Math.PI / 2, 0, headingOf(mid.tx, mid.tz));
    ring.scale.set(across, h.r * 2 + 0.6, 1);
    ring.position.set(mid.x, 0.064, mid.z);
    ring.renderOrder = 2;
    scene.add(ring);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The Claw's fountain jets: a bronze vent in a stone ring on the lip, rings rippling out across the water before it
  // blows, then a column of water higher than a kart with spray at the top
  const jets: JetView[] = [];
  const columnGeo = new THREE.CylinderGeometry(0.55, 0.95, 1, 14, 1, true);
  columnGeo.translate(0, 0.5, 0);
  const ringGeo = new THREE.RingGeometry(0.86, 1, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xcdb48a, emissive: 0x2a2214 });
  const ventTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#2c3a40';
      g.beginPath();
      g.arc(32, 32, 31, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#b08040';
      g.lineWidth = 4;
      for (const rr of [10, 20, 28]) {
        g.beginPath();
        g.arc(32, 32, rr, 0, Math.PI * 2);
        g.stroke();
      }
    }),
  );
  r.hazards.forEach((h, i) => {
    if (h.kind !== 'geyser' || h.look !== 'fountain') return;
    const vent = new THREE.MeshBasicMaterial({ map: ventTex, transparent: true });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(h.r, 24), vent);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(h.x, 0.07, h.z);
    scene.add(disc);
    const rim = new THREE.Mesh(ringGeo, stoneMat);
    rim.scale.setScalar(h.r + 0.15);
    rim.position.set(h.x, 0.08, h.z);
    scene.add(rim);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const column = new THREE.Mesh(columnGeo, mat);
    column.position.set(h.x, 0, h.z);
    column.visible = false;
    scene.add(column);
    const crown = flare(0xc8f4ff, 4);
    crown.visible = false;
    scene.add(crown);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const rings = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.position.set(h.x, 0.09, h.z);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      return m;
    });
    jets.push({ i, column, mat, crown, rings, ringMat, vent, x: h.x, z: h.z, r: h.r });
  });

  return {
    tick(race, me, clock, dt) {
      const lap = race.karts[me]?.lap ?? 1;
      for (const cv of cars) {
        const h = race.hazards[cv.i];
        const p = carAt(h, race.time);
        cv.g.visible = p !== null;
        if (!p) continue;
        cv.h = Number.isNaN(cv.h) || Math.abs(wrapAngle(p.face - cv.h)) > 2.6 ? p.face : cv.h + wrapAngle(p.face - cv.h) * (1 - Math.exp(-10 * dt));
        cv.g.position.set(p.x, 0, p.z);
        cv.g.rotation.y = cv.h;
        cv.roll += (Math.abs(h.drive ?? 0) * dt) / 0.34;
        for (const w of cv.wheels) w.rotation.x = cv.roll;
        if (cv.beacon) cv.beacon.visible = Math.floor(clock * 3) % 2 === 0;
      }
      for (const bv of shuttles) {
        const h = race.hazards[bv.i];
        const run = shuttleRun(race, h);
        const every = h.every ?? 17;
        const c = cycleAt(h, race.time, every);
        const st = hazState(race, h, race.time, lap);
        // across the road, on and off it, and out along its side street a moment longer; waiting in its street while the
        // bells ring
        let d: number | null = null;
        if (!shuttleSkips(race, h, race.time - c) && c < run.pass + 2.5) d = run.at(c);
        else if (st.warn > 0) d = st.d;
        bv.g.visible = d !== null && Math.abs(d) < run.from + 12;
        if (!bv.g.visible || d === null) continue;
        const p = at(h.s, d);
        bv.g.position.set(p.x, 0, p.z);
        bv.g.rotation.y = headingOf(-p.tz * run.dir, p.tx * run.dir);
        if (c < run.pass + 2.5 && st.warn === 0) bv.roll += (Math.abs(run.v) * dt) / 0.52;
        for (const w of bv.wheels) w.rotation.x = bv.roll;
      }
      for (const sg of signals) {
        // the lights flash while any bus is due or across, and the gates come down
        let warn = 0;
        let lift = 0;
        for (const h of race.hazards) {
          if (h.kind !== 'shuttle' || h.s !== sg.s) continue;
          const st = hazState(race, h, race.time, lap);
          warn = Math.max(warn, st.warn);
          lift = Math.max(lift, st.lift);
        }
        const flash = warn > 0 ? Math.floor(race.time / 0.45) % 2 : -1;
        for (const p of sg.posts) {
          p.lamps.forEach((m, n) => m.color.setHex(flash === n ? 0xff2a1a : 0x3a0806));
          p.arm.rotation.z = (-p.side * Math.PI) / 2 * lift;
        }
      }
      for (const tv of trees) {
        const h = race.hazards[tv.i];
        const st = hazState(race, h, race.time, lap);
        tv.d += (st.d - tv.d) * (1 - Math.exp(-30 * dt));
        const p = at(h.s, tv.d);
        tv.g.position.set(p.x, 0, p.z);
        // facing the oncoming karts, leaning into its lunge
        tv.g.rotation.y = headingOf(-p.tx, -p.tz);
        const crouch = st.warn > 0 && !st.live;
        const sq = crouch ? 1 - 0.2 * Math.min(1, st.warn * 2) : st.live ? 1.08 : 1 + Math.sin(clock * 2.2) * 0.03;
        tv.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
        tv.body.rotation.z = st.live ? -Math.sign(h.d) * 0.35 * st.lift : crouch ? Math.sin(clock * 30) * 0.05 : Math.sin(clock * 1.7) * 0.04;
        // its eyes go red as it crouches to spring
        tv.pupilMat.color.setHex(crouch || st.live ? 0xff2a1a : 0x111111);
        for (const e of tv.eyes) e.position.x = Math.sign(e.position.x) * (0.3 + (crouch ? 0 : Math.sin(clock * 3) * 0.04));
        // the bungee from the top of its post to its middle
        const mid = new THREE.Vector3(p.x, 1.5 * sq, p.z);
        const dir = mid.clone().sub(tv.post);
        const len = dir.length();
        tv.cord.position.copy(tv.post).add(mid).multiplyScalar(0.5);
        tv.cord.scale.set(st.live ? 0.05 : 0.08, len, st.live ? 0.05 : 0.08);
        tv.cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      for (const jv of jets) {
        const h = race.hazards[jv.i];
        const st = hazState(race, h, race.time, lap);
        jv.vent.color.setHex(st.phase === 'off' ? 0x666666 : 0xffffff);
        jv.column.visible = st.live;
        jv.crown.visible = st.live;
        if (st.live) {
          const c = cycleAt(h, race.time, h.every ?? 2.4);
          const up = Math.min(1, c / 0.12) * (c > (h.on ?? 0.8) - 0.12 ? Math.max(0.2, ((h.on ?? 0.8) - c) / 0.12) : 1);
          jv.column.scale.set(1 + Math.sin(clock * 21 + jv.i) * 0.06, 5 * up, 1 + Math.cos(clock * 19 + jv.i) * 0.06);
          jv.mat.opacity = 0.6 + Math.sin(clock * 27) * 0.12;
          jv.crown.position.set(jv.x, 5 * up, jv.z);
          const cs = 3 + Math.sin(clock * 13 + jv.i) * 0.5;
          jv.crown.scale.set(cs, cs, 1);
        }
        // the water rippling out from the vent before it blows
        jv.rings.forEach((m, n) => {
          m.visible = st.warn > 0 && !st.live;
          if (!m.visible) return;
          const u = (st.warn * 2.2 + n / 3) % 1;
          m.scale.setScalar(jv.r * (0.3 + 1.2 * u));
        });
        jv.ringMat.opacity = 0.35 + 0.55 * st.warn;
      }
    },
  };
}

/** Whether a point is on one of the traffic's side streets (nothing else is built there). */
export function onStreet(t: Track, streets: Street[], s: number, d: number, margin: number) {
  for (const st of streets) {
    let ds = s - st.s;
    if (ds > t.length / 2) ds -= t.length;
    if (ds < -t.length / 2) ds += t.length;
    if (Math.abs(ds) < st.half + margin && Math.sign(d) === st.side && Math.abs(d) < st.to + margin) return true;
  }
  return false;
}

/** Whether a car or a van is bearing down on kart k: close ahead, closing fast and on its line (it honks). */
export function bearingDown(h: LiveHazard, k: { x: number; z: number; h: number; v: number }) {
  if (!traffic(h.kind) || h.gone) return false;
  const fx = Math.sin(k.h);
  const fz = Math.cos(k.h);
  const dx = h.x - k.x;
  const dz = h.z - k.z;
  const ahead = dx * fx + dz * fz;
  const aside = Math.abs(-dx * fz + dz * fx);
  const closing = k.v - (h.drive ?? 0) * (h.tx * fx + h.tz * fz);
  return ahead > 0 && ahead < 25 && aside < h.r + KART_R + 1.5 && closing > 15;
}
