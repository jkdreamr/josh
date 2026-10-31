// An armored tactical truck in the style of the police and military rescue vehicles on duty today: a steel monocoque
// hull with a raked windshield of thick ballistic glass, small armored side windows with gun ports, a roof hatch and
// light bar, a push bumper, running boards, rear doors and big off road wheels. Drawn instanced, one call a material.
import type { World } from '../world.ts';
import { lin, patch, roundBox, type Shared, type T, type Three } from './common.ts';

type Mat = 'paint' | 'steel' | 'rubber' | 'glass' | 'light' | 'red';

function truckParts(THREE: Three) {
  const parts = new Map<Mat, T.BufferGeometry[]>();
  const push = (m: Mat, g: T.BufferGeometry) => {
    let l = parts.get(m);
    if (!l) parts.set(m, (l = []));
    l.push(g);
  };
  const box = (m: Mat, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, round = 0.12) => {
    const g = round > 0 ? roundBox(THREE, w, h, d, round) : new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    push(m, g);
  };
  // the hull from a side profile (z forward is -z, y up), extruded across
  const shape = new THREE.Shape();
  const prof: [number, number][] = [
    [3.0, 0.72],
    [3.0, 2.72],
    [2.85, 2.82],
    [-0.95, 2.82],
    [-1.62, 1.86],
    [-2.88, 1.66],
    [-3.02, 1.42],
    [-3.02, 0.72],
  ];
  prof.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 4 });
  hull.translate(0, 0, -1.1);
  hull.rotateY(-Math.PI / 2);
  push('paint', hull);
  // windshield panes on the rake, and armored side and rear windows
  const rake = Math.atan2(2.82 - 1.86, 1.62 - 0.95);
  for (const x of [-0.52, 0.52]) box('glass', 0.92, 1.0, 0.03, x, 2.35, -1.3, rake, 0);
  for (const s of [-1, 1]) {
    for (const z of [-0.6, 0.6, 1.8]) {
      box('glass', 0.03, 0.42, 0.55, s * 1.165, 2.2, z, 0, 0);
      box('steel', 0.04, 0.09, 0.09, s * 1.17, 1.85, z, 0, 0.3);
    }
    // wheel arches, running boards, mirrors
    for (const z of [-2.05, 1.9]) box('paint', 0.2, 0.42, 1.25, s * 1.08, 1.0, z, 0, 0.3);
    box('steel', 0.22, 0.06, 1.6, s * 1.2, 0.62, 0.1, 0, 0.2);
    box('steel', 0.07, 0.28, 0.18, s * 1.25, 2.05, -1.55, 0, 0.3);
    // headlights and turn lights
    box('light', 0.32, 0.14, 0.04, s * 0.78, 1.42, -3.06, 0, 0.3);
  }
  // rear doors: seams, handles, ladder
  box('steel', 0.04, 1.7, 0.03, 0, 1.75, 3.08, 0, 0);
  for (const s of [-1, 1]) box('steel', 0.18, 0.05, 0.05, s * 0.25, 1.6, 3.1, 0, 0.3);
  for (let y = 1.0; y < 2.8; y += 0.32) box('steel', 0.4, 0.035, 0.035, 0.75, y, 3.12, 0, 0);
  // roof: hatch ring and cupola, light bar, rails
  const hatch = new THREE.CylinderGeometry(0.42, 0.45, 0.16, 24);
  hatch.translate(0, 2.9, 0.4);
  push('paint', hatch);
  const lid = new THREE.CylinderGeometry(0.38, 0.38, 0.05, 24);
  lid.translate(0, 3.0, 0.4);
  push('steel', lid);
  box('steel', 1.4, 0.1, 0.22, 0, 2.9, -0.75, 0, 0.3);
  box('red', 0.5, 0.07, 0.18, -0.4, 2.97, -0.75, 0, 0.3);
  box('light', 0.5, 0.07, 0.18, 0.4, 2.97, -0.75, 0, 0.3);
  for (const s of [-1, 1]) box('steel', 0.05, 0.06, 2.6, s * 0.9, 2.88, 1.4, 0, 0.3);
  // push bumper and ram frame
  box('steel', 2.3, 0.28, 0.22, 0, 0.95, -3.18, 0, 0.2);
  for (const x of [-0.85, -0.3, 0.3, 0.85]) box('steel', 0.1, 0.7, 0.12, x, 1.25, -3.24, 0, 0.3);
  box('steel', 2.0, 0.1, 0.12, 0, 1.58, -3.24, 0, 0.3);
  // wheels: tire with tread blocks, rim, hub
  for (const s of [-1, 1])
    for (const z of [-2.05, 1.9]) {
      const tire = new THREE.CylinderGeometry(0.56, 0.56, 0.4, 28);
      tire.rotateZ(Math.PI / 2);
      tire.translate(s * 0.98, 0.56, z);
      push('rubber', tire);
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const g = new THREE.BoxGeometry(0.42, 0.06, 0.12);
        g.rotateX(a);
        g.translate(s * 0.98, 0.56 + Math.cos(a) * 0.565, z + Math.sin(a) * 0.565);
        push('rubber', g);
      }
      const rim = new THREE.CylinderGeometry(0.3, 0.3, 0.42, 20);
      rim.rotateZ(Math.PI / 2);
      rim.translate(s * 0.985, 0.56, z);
      push('steel', rim);
      const hub = new THREE.CylinderGeometry(0.1, 0.12, 0.46, 12);
      hub.rotateZ(Math.PI / 2);
      hub.translate(s * 0.99, 0.56, z);
      push('paint', hub);
    }
  // underbody shadow block
  box('rubber', 1.9, 0.3, 5.2, 0, 0.55, 0, 0, 0.1);
  const out = new Map<Mat, T.BufferGeometry>();
  for (const [m, list] of parts) {
    const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const n = flat.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of flat) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      o += g.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    out.set(m, geo);
    for (const g of list) g.dispose();
    for (const g of flat) g.dispose();
  }
  return out;
}

const PAINT: Record<string, number> = { vale: 0x3f4434, mesa: 0x9c8664, frost: 0x2b2e31, isles: 0x2f3337 };

export function vehicles(THREE: Three, w: World, shared: Shared, shadows: boolean) {
  const group = new THREE.Group();
  if (!w.vehicles.length) return group;
  const geos = truckParts(THREE);
  const look: Record<Mat, { color: number; rough: number; metal: number; emissive?: number }> = {
    paint: { color: PAINT[w.id] ?? 0x2b2e31, rough: 0.62, metal: 0.35 },
    steel: { color: 0x26282b, rough: 0.45, metal: 0.7 },
    rubber: { color: 0x141415, rough: 0.94, metal: 0 },
    glass: { color: 0x0e1a24, rough: 0.05, metal: 0.9 },
    light: { color: 0xe8e4d8, rough: 0.2, metal: 0, emissive: 0x6a6658 },
    red: { color: 0x8a1410, rough: 0.3, metal: 0, emissive: 0x3a0604 },
  };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  for (const [m, geo] of geos) {
    const d = look[m];
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(d.color)), roughness: d.rough, metalness: d.metal });
    if (d.emissive) mat.emissive.setRGB(...lin(d.emissive, 2));
    patch(mat, shared, {
      key: `dz-truck-${m}`,
      vertDecl: 'varying vec3 vOP;',
      vertBody: 'vOP = position;',
      fragDecl: 'varying vec3 vOP;',
      albedo: m === 'paint' ? 'diffuseColor.rgb *= 0.86 + 0.18 * dzNoise(vOP.xy * 9.0 + vOP.zz * 5.0) - 0.12 * smoothstep(1.2, 0.7, vOP.y);' : '',
    });
    const mesh = new THREE.InstancedMesh(geo, mat, w.vehicles.length);
    w.vehicles.forEach((v, i) => {
      q.setFromAxisAngle(up, (v.rot * Math.PI) / 2);
      p.set(v.x, v.y, v.z);
      m4.compose(p, q, one);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows && m !== 'glass' && m !== 'light' && m !== 'red';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
