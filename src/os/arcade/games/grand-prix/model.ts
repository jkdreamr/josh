// The car model: a sculpted body lofted through superellipse sections (nose, tub, airbox, engine cover, sidepods),
// front and rear wings with endplates and a working DRS flap, the floor and diffuser, halo, mirrors, suspension
// arms and four wheels that spin, steer and glow under braking. Local frame: +x forward, +y up, +z right. Meters.
import type * as T from 'three';
import type { Team } from './teams.ts';

type Three = typeof import('three');

export type CarView = {
  root: T.Group;
  /** The sprung body: pitches and rolls on its suspension. */
  body: T.Group;
  /** Wheel spinners (rotate about their axle) and the front uprights (steer). */
  spin: T.Object3D[];
  steer: T.Object3D[];
  flap: T.Object3D;
  discs: T.MeshStandardMaterial;
  rain: T.MeshStandardMaterial;
  helmet: T.Object3D;
  wheel: T.Object3D;
  dispose: () => void;
};

/** Shared geometry and materials every car uses (tyres, rims, carbon), built once per scene. */
export type CarKit = {
  carbon: T.Material;
  tyre: T.Material;
  rim: T.Material;
  tyreF: T.BufferGeometry;
  tyreR: T.BufferGeometry;
  rimF: T.BufferGeometry;
  rimR: T.BufferGeometry;
  dispose: () => void;
};

export const WHEEL_R = 0.36;
const WB = 3.6;
const FRONT_X = 1.98;
const REAR_X = FRONT_X - WB;
const TRACK_F = 1.6;
const TRACK_R = 1.56;

type Section = { x: number; w: number; top: number; bot: number; z?: number; n?: number };

/** A smooth closed body through cross sections (superellipses), Catmull-Rom between sections. */
function loft(THREE: Three, sections: Section[], around = 20, between = 4): T.BufferGeometry {
  const pts: Section[] = [];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[Math.max(0, i - 1)];
    const b = sections[i];
    const c = sections[i + 1];
    const d = sections[Math.min(sections.length - 1, i + 2)];
    for (let k = 0; k < between; k++) {
      const t = k / between;
      const f = (key: 'x' | 'w' | 'top' | 'bot' | 'z' | 'n') => cr(a[key] ?? (key === 'n' ? 2.6 : 0), b[key] ?? (key === 'n' ? 2.6 : 0), c[key] ?? (key === 'n' ? 2.6 : 0), d[key] ?? (key === 'n' ? 2.6 : 0), t);
      pts.push({ x: f('x'), w: Math.max(0.005, f('w')), top: f('top'), bot: f('bot'), z: f('z'), n: f('n') });
    }
  }
  pts.push(sections[sections.length - 1]);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of pts) {
    const mid = (s.top + s.bot) / 2;
    const hh = Math.max(0.005, (s.top - s.bot) / 2);
    const n = s.n ?? 2.6;
    for (let j = 0; j < around; j++) {
      const th = (j / around) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const z = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n) + (s.z ?? 0);
      const y = mid + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      pos.push(s.x, y, z);
    }
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = 0; j < around; j++) {
      const a = i * around + j;
      const b = i * around + ((j + 1) % around);
      const c = (i + 1) * around + j;
      const d = (i + 1) * around + ((j + 1) % around);
      idx.push(a, c, b, b, c, d);
    }
  // caps
  const capAt = (ring: number, flip: boolean) => {
    const s = pts[ring];
    const center = pos.length / 3;
    pos.push(s.x, (s.top + s.bot) / 2, s.z ?? 0);
    for (let j = 0; j < around; j++) {
      const a = ring * around + j;
      const b = ring * around + ((j + 1) % around);
      if (flip) idx.push(center, b, a);
      else idx.push(center, a, b);
    }
  };
  capAt(0, true);
  capAt(pts.length - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Thin rod between two points (suspension arms, pillars). */
function rod(THREE: Three, a: [number, number, number], b: [number, number, number], r: number) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
  g.translate(0, len / 2, 0);
  const dir = vb.clone().sub(va).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate(va.x, va.y, va.z);
  return g;
}

function box(THREE: Three, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

/**
 * Merges geometries (positions and normals, uvs if every part has them) into one non-indexed geometry. With
 * `colors`, each part is painted a flat vertex color, so differently colored parts can share one material.
 */
export function merge(THREE: Three, parts: T.BufferGeometry[], colors?: T.Color[]): T.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const withUv = flat.every((p) => p.getAttribute('uv'));
  let count = 0;
  for (const p of flat) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = withUv ? new Float32Array(count * 2) : null;
  const col = colors ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const [n, p] of flat.entries()) {
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    const pa = p.getAttribute('position');
    const na = p.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      pos[(o + i) * 3] = pa.getX(i);
      pos[(o + i) * 3 + 1] = pa.getY(i);
      pos[(o + i) * 3 + 2] = pa.getZ(i);
      nor[(o + i) * 3] = na.getX(i);
      nor[(o + i) * 3 + 1] = na.getY(i);
      nor[(o + i) * 3 + 2] = na.getZ(i);
    }
    if (col && colors) {
      const cc = colors[n];
      for (let i = 0; i < pa.count; i++) col.set([cc.r, cc.g, cc.b], (o + i) * 3);
    }
    if (uv) {
      const ua = p.getAttribute('uv');
      for (let i = 0; i < ua.count; i++) {
        uv[(o + i) * 2] = ua.getX(i);
        uv[(o + i) * 2 + 1] = ua.getY(i);
      }
    }
    o += pa.count;
  }
  for (const p of parts) p.dispose();
  for (const p of flat) p.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Tyre texture atlas: tread on the left half, the sidewall with its colored compound band on the right. */
function tyreTexture(THREE: Three, band: string) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#16171a';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  g.fillStyle = '#141518';
  g.fillRect(256, 0, 256, 256);
  g.strokeStyle = band;
  g.lineWidth = 9;
  g.beginPath();
  g.arc(384, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(384, 128, 120, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A tyre as one mesh: the tread band and both sidewalls, mapped onto the atlas. Axle along z. */
function tyreGeometry(THREE: Three, width: number) {
  const side = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, width, 32, 1, true);
  const uvs = side.getAttribute('uv');
  for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * 0.5);
  const caps = [1, -1].map((sgn) => {
    const g = new THREE.RingGeometry(0.22, WHEEL_R, 32, 1);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0.5 + uv.getX(i) * 0.5);
    g.rotateX(sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, (sgn * width) / 2, 0);
    return g;
  });
  const g = merge(THREE, [side, ...caps]);
  g.rotateX(Math.PI / 2);
  return g;
}

export function createKit(THREE: Three): CarKit {
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.3 });
  const atlas = tyreTexture(THREE, '#e6232a');
  const tyreMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const rim = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.35, metalness: 0.85 });
  // tyres: about z (the axle), 18 inch rims with covers
  const tyre = (width: number) => tyreGeometry(THREE, width);
  const rimG = (width: number) => {
    const g = new THREE.CylinderGeometry(0.235, 0.235, width + 0.012, 24, 1, false);
    g.rotateX(Math.PI / 2);
    return g;
  };
  const kit: CarKit = {
    carbon,
    tyre: tyreMat,
    rim,
    tyreF: tyre(0.305),
    tyreR: tyre(0.405),
    rimF: rimG(0.305),
    rimR: rimG(0.405),
    dispose() {
      for (const g of [kit.tyreF, kit.tyreR, kit.rimF, kit.rimR]) g.dispose();
      for (const m of [carbon, rim, tyreMat]) m.dispose();
      atlas.dispose();
    },
  };
  return kit;
}

/** Builds one car in a team's livery. */
export function createCar(THREE: Three, kit: CarKit, team: Team, opts: { shadows: boolean; lite?: boolean }): CarView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // body, accent and detail colors are vertex colors on one clear coated material (one draw call per car)
  const paint = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.18, envMapIntensity: 0.4 });
  const cBody = new THREE.Color(team.body);
  const cAccent = new THREE.Color(team.accent);
  const cDetail = new THREE.Color(team.detail);
  const rain = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 });
  const helmetMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.3, clearcoat: 1 });
  // each car's brakes glow on their own, seen through the wheel rims
  const glow = (kit.rim as T.MeshStandardMaterial).clone();
  glow.emissive.set(0xff4a10);
  glow.emissiveIntensity = 0;
  const lite = !!opts.lite;
  const seg = lite ? 14 : 22;

  // main body: nose tip to gearbox, rising through the cockpit and the airbox
  const main = loft(
    THREE,
    [
      { x: 3.0, w: 0.06, top: 0.27, bot: 0.17, n: 2.2 },
      { x: 2.7, w: 0.11, top: 0.33, bot: 0.14 },
      { x: 2.1, w: 0.18, top: 0.43, bot: 0.12 },
      { x: 1.45, w: 0.29, top: 0.54, bot: 0.1 },
      { x: 0.95, w: 0.38, top: 0.61, bot: 0.09 },
      { x: 0.35, w: 0.41, top: 0.62, bot: 0.09 },
      { x: -0.15, w: 0.37, top: 0.84, bot: 0.1 },
      { x: -0.5, w: 0.3, top: 0.92, bot: 0.1, n: 2.2 },
      { x: -1.0, w: 0.27, top: 0.78, bot: 0.12 },
      { x: -1.6, w: 0.2, top: 0.6, bot: 0.14 },
      { x: -2.1, w: 0.13, top: 0.47, bot: 0.17 },
      { x: -2.4, w: 0.07, top: 0.39, bot: 0.22 },
    ],
    seg,
    lite ? 2 : 4,
  );
  // sidepods, mirrored: an undercut inlet that sweeps down and in toward the rear
  const pod = (side: number) =>
    loft(
      THREE,
      [
        { x: 0.72, w: 0.17, top: 0.54, bot: 0.24, z: side * 0.6, n: 3.2 },
        { x: 0.55, w: 0.27, top: 0.58, bot: 0.17, z: side * 0.63, n: 3.4 },
        { x: 0.05, w: 0.3, top: 0.58, bot: 0.13, z: side * 0.6, n: 3 },
        { x: -0.6, w: 0.25, top: 0.5, bot: 0.13, z: side * 0.52 },
        { x: -1.25, w: 0.16, top: 0.38, bot: 0.15, z: side * 0.4 },
        { x: -1.8, w: 0.07, top: 0.28, bot: 0.17, z: side * 0.3 },
      ],
      seg,
      lite ? 2 : 3,
    );
  const bodyParts: T.BufferGeometry[] = [main, pod(1), pod(-1)];

  const carbonParts: T.BufferGeometry[] = [];
  const accentParts: T.BufferGeometry[] = [];
  const detailParts: T.BufferGeometry[] = [];
  // floor and plank, with the edge wings and the diffuser kicking up at the back
  carbonParts.push(box(THREE, 3.7, 0.025, 1.7, -0.15, 0.06, 0));
  carbonParts.push(box(THREE, 0.9, 0.02, 1.25, -2.2, 0.13, 0, 0, 0, -0.32));
  for (const s of [1, -1]) carbonParts.push(box(THREE, 3.2, 0.12, 0.02, -0.3, 0.1, s * 0.86));
  // front wing: four elements stacked and swept up at the tips, endplates
  for (let k = 0; k < 3; k++) {
    const g = box(THREE, 0.17 - k * 0.025, 0.018, 1.92 - k * 0.12, 3.08 - k * 0.12, 0.09 + k * 0.045, 0, 0, 0, 0.12 + k * 0.18);
    (k === 0 ? carbonParts : accentParts).push(g);
  }
  for (const s of [1, -1]) {
    detailParts.push(box(THREE, 0.42, 0.22, 0.015, 3.0, 0.17, s * 0.97));
    carbonParts.push(box(THREE, 0.18, 0.2, 0.015, 3.0, 0.14, s * 0.32));
  }
  // nose pylons
  for (const s of [1, -1]) carbonParts.push(box(THREE, 0.25, 0.12, 0.02, 2.85, 0.2, s * 0.08));
  // rear wing: mainplane, endplates, swan neck pylon and beam wing
  accentParts.push(box(THREE, 0.32, 0.022, 0.98, -2.52, 0.8, 0, 0, 0, 0.12));
  for (const s of [1, -1]) detailParts.push(box(THREE, 0.62, 0.62, 0.016, -2.45, 0.66, s * 0.5, 0, 0, 0));
  carbonParts.push(box(THREE, 0.32, 0.02, 0.9, -2.42, 0.36, 0, 0, 0, 0.18));
  carbonParts.push(box(THREE, 0.08, 0.45, 0.03, -2.36, 0.58, 0));
  // engine cover fin and the T-cam on the airbox
  paintFin(THREE, carbonParts);
  detailParts.push(box(THREE, 0.16, 0.05, 0.08, -0.52, 0.96, 0));
  // halo: a loop over the cockpit with a center pillar
  const haloParts: T.BufferGeometry[] = [];
  const hoop = new THREE.TorusGeometry(0.38, 0.032, 6, 18, Math.PI);
  hoop.rotateX(-Math.PI / 2);
  hoop.rotateY(Math.PI / 2);
  hoop.scale(1.25, 1, 1);
  hoop.translate(0.05, 0.86, 0);
  haloParts.push(hoop);
  haloParts.push(rod(THREE, [0.85, 0.6, 0], [0.48, 0.86, 0], 0.03));
  for (const s of [1, -1]) haloParts.push(rod(THREE, [-0.35, 0.62, s * 0.36], [-0.32, 0.86, s * 0.38], 0.03));
  // mirrors on stalks
  for (const s of [1, -1]) {
    carbonParts.push(rod(THREE, [0.62, 0.58, s * 0.38], [0.58, 0.7, s * 0.58], 0.012));
    carbonParts.push(box(THREE, 0.05, 0.06, 0.15, 0.58, 0.72, s * 0.6));
  }
  // cockpit opening and the steering wheel
  carbonParts.push(box(THREE, 0.75, 0.04, 0.5, 0.2, 0.62, 0));
  // suspension: upper and lower wishbones front and rear, pushrods
  if (!lite) {
    for (const s of [1, -1]) {
      const fz = (s * TRACK_F) / 2 - s * 0.17;
      const rz = (s * TRACK_R) / 2 - s * 0.22;
      for (const [y0, y1] of [
        [0.4, 0.46],
        [0.18, 0.22],
      ]) {
        carbonParts.push(rod(THREE, [FRONT_X + 0.3, y0, s * 0.18], [FRONT_X, y1, fz], 0.016));
        carbonParts.push(rod(THREE, [FRONT_X - 0.35, y0, s * 0.22], [FRONT_X, y1, fz], 0.016));
        carbonParts.push(rod(THREE, [REAR_X + 0.4, y0 + 0.02, s * 0.2], [REAR_X, y1, rz], 0.016));
        carbonParts.push(rod(THREE, [REAR_X - 0.15, y0 + 0.02, s * 0.15], [REAR_X, y1, rz], 0.016));
      }
      carbonParts.push(rod(THREE, [FRONT_X - 0.1, 0.5, s * 0.18], [FRONT_X, 0.2, fz], 0.014));
    }
  }
  // steering wheel (fixed in the merged carbon)
  const swGeo = new THREE.TorusGeometry(0.13, 0.018, 6, 16);
  swGeo.rotateY(Math.PI / 2);
  swGeo.translate(0.5, 0.64, 0);
  carbonParts.push(swGeo, ...haloParts);
  const carbonMesh = new THREE.Mesh(merge(THREE, carbonParts), kit.carbon);
  const paintGeo = merge(
    THREE,
    [...bodyParts, ...accentParts, ...detailParts],
    [...bodyParts.map(() => cBody), ...accentParts.map(() => cAccent), ...detailParts.map(() => cDetail)],
  );
  const bodyMesh = new THREE.Mesh(paintGeo, paint);
  body.add(bodyMesh, carbonMesh);

  // the DRS flap pivots on its leading edge above the mainplane
  const flap = new THREE.Group();
  flap.position.set(-2.4, 0.86, 0);
  const flapMesh = new THREE.Mesh(merge(THREE, [box(THREE, 0.24, 0.018, 0.98, -0.12, 0, 0)], [cAccent]), paint);
  flap.add(flapMesh);
  flap.rotation.z = 0.5;
  body.add(flap);

  // driver: helmet with a dark visor, low in the cockpit
  const shellGeo = new THREE.SphereGeometry(0.135, 16, 12);
  shellGeo.scale(1.1, 1, 0.95);
  const visorGeo = new THREE.SphereGeometry(0.138, 14, 8, -0.9, 1.8, 1.0, 0.7);
  visorGeo.rotateY(Math.PI / 2);
  visorGeo.scale(1.1, 1, 0.95);
  const helmet = new THREE.Mesh(merge(THREE, [shellGeo, visorGeo], [cAccent, new THREE.Color(0x08090c)]), helmetMat);
  helmet.position.set(0.12, 0.72, 0);
  body.add(helmet);
  const wheel = new THREE.Object3D();

  // rear rain light
  const rainMesh = new THREE.Mesh(box(THREE, 0.03, 0.06, 0.12, -2.44, 0.33, 0), rain);
  body.add(rainMesh);

  // wheels: uprights at the corners (fronts steer), spinners inside them
  const spin: T.Object3D[] = [];
  const steer: T.Object3D[] = [];
  const corners: [number, number, boolean][] = [
    [FRONT_X, -TRACK_F / 2, true],
    [FRONT_X, TRACK_F / 2, true],
    [REAR_X, -TRACK_R / 2, false],
    [REAR_X, TRACK_R / 2, false],
  ];
  for (const [x, z, front] of corners) {
    const upright = new THREE.Group();
    upright.position.set(x, WHEEL_R, z);
    const spinner = new THREE.Group();
    const tyre = new THREE.Mesh(front ? kit.tyreF : kit.tyreR, kit.tyre);
    const rimMesh = new THREE.Mesh(front ? kit.rimF : kit.rimR, glow);
    spinner.add(tyre, rimMesh);
    upright.add(spinner);
    root.add(upright);
    spin.push(spinner);
    if (front) steer.push(upright);
    if (opts.shadows) {
      tyre.castShadow = true;
      tyre.receiveShadow = true;
    }
  }
  if (opts.shadows) {
    for (const m of [bodyMesh, carbonMesh, flapMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  }

  return {
    root,
    body,
    spin,
    steer,
    flap,
    discs: glow,
    rain,
    helmet,
    wheel,
    dispose() {
      for (const m of [bodyMesh, carbonMesh, flapMesh, rainMesh, helmet]) m.geometry.dispose();
      for (const m of [paint, rain, helmetMat, glow]) m.dispose();
    },
  };
}

function paintFin(THREE: Three, parts: T.BufferGeometry[]) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.55, 0.9);
  shape.lineTo(-1.95, 0.62);
  shape.lineTo(-1.95, 0.5);
  shape.lineTo(-0.8, 0.72);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
  g.translate(0, 0, -0.006);
  parts.push(g);
}
