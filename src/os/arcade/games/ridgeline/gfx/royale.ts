// What a royale adds to the scene: the transport flying its line, a canopy over everyone gliding in, the zone's wall of
// haze, and the loot lying around (drawn only near you, rebuilt when it changes or you move on).
import type { Assets } from '../assets.ts';
import type { Match } from '../match.ts';
import { planeAt, type AmmoKind, type Item } from '../royale.ts';
import type { WeaponId } from '../weapons.ts';
import { DOUBLE, canvas, lin, patch, roundBox, type Shared, type T, type Three } from './common.ts';
import { gunLiteGeometry, gunModel } from './guns.ts';
import { modelOf, worldMaterial, type Part } from './models.ts';

/** Merges geometries (all non indexed) into one with vertex colors. */
function merged(THREE: Three, parts: [T.BufferGeometry, number][]) {
  const flat = parts.map(([g, c]) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (!f.attributes.normal) f.computeVertexNormals();
    return [f, lin(c)] as const;
  });
  const n = flat.reduce((s, [g]) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, c] of flat) {
    const k = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    for (let i = 0; i < k; i++) col.set(c, (o + i) * 3);
    o += k;
  }
  for (const [g] of parts) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** A high wing cargo transport with four turboprops, nose toward -z, about 30 m long. */
function transportGeometry(THREE: Three) {
  const body = 0x5d6250;
  const dark = 0x2c2f2a;
  const glass = 0x101820;
  const parts: [T.BufferGeometry, number][] = [];
  const add = (g: T.BufferGeometry, c: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push([g, c]);
  };
  // fuselage: a long tube, a rounded nose, and a tail sweeping up to the fin
  add(new THREE.CylinderGeometry(2.1, 2.1, 19, 20, 1, false), body, 0, 0, 0, Math.PI / 2);
  add(new THREE.SphereGeometry(2.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, 0, -9.5, -Math.PI / 2);
  add(new THREE.CylinderGeometry(0.7, 2.1, 9, 20, 1, false), body, 0, 0.9, 13.8, Math.PI / 2 - 0.12);
  add(new THREE.BoxGeometry(2.4, 0.7, 1.4), glass, 0, 1.15, -10.2, 0.35);
  // the high wing, four engines with spinning props, and the tail
  add(new THREE.BoxGeometry(40, 0.45, 4.2), body, 0, 2.15, -1.5);
  for (const x of [-12.5, -6.2, 6.2, 12.5]) {
    add(new THREE.CylinderGeometry(0.62, 0.55, 4.2, 12), body, x, 1.5, -2.6, Math.PI / 2);
    add(new THREE.ConeGeometry(0.38, 0.8, 10), dark, x, 1.5, -5.1, -Math.PI / 2);
  }
  add(new THREE.BoxGeometry(0.4, 6.5, 4.2), body, 0, 4.2, 17.2, 0.28);
  add(new THREE.BoxGeometry(13, 0.3, 3.2), body, 0, 1.6, 17.6);
  // undercarriage blisters and a stripe of windows
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.8, 1.2, 6), body, s * 2.2, -1.3, 0.5);
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.35, 0.35), glass, s * 2.08, 0.6, -6 + k * 2);
  return merged(THREE, parts);
}

/** A ram air canopy, about 8 m across, arched, with its lines down to the harness 4 m below. */
function canopyGeometry(THREE: Three) {
  const g = new THREE.PlaneGeometry(8, 2.8, 20, 3);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as T.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, 4.4 - (x * x) / 16 + Math.cos((z / 1.4) * Math.PI * 0.5) * 0.25);
  }
  g.computeVertexNormals();
  const parts: [T.BufferGeometry, number][] = [[g, 0xffffff]];
  // lines: thin quads from the canopy's edge down to the shoulders
  for (const sx of [-3.6, -1.8, 1.8, 3.6]) {
    for (const sz of [-1.1, 1.1]) {
      const top = new THREE.Vector3(sx, 4.4 - (sx * sx) / 16, sz);
      const bottom = new THREE.Vector3(Math.sign(sx) * 0.25, 1.55, 0);
      const len = top.distanceTo(bottom);
      const line = new THREE.BoxGeometry(0.025, 0.025, len);
      line.translate(0, 0, len / 2);
      line.lookAt(new THREE.Vector3().subVectors(top, bottom));
      line.translate(bottom.x, bottom.y, bottom.z);
      parts.push([line, 0x2a2a28]);
    }
  }
  return merged(THREE, parts);
}

const CANOPY_COLORS = [0x4f5a3a, 0xc8b28a, 0xd06a2c, 0xe8e6de, 0x3d6a8f, 0x7a2a2a, 0x2f3a2f];

const ZONE_VERT = /* glsl */ `
varying vec3 vWp;
varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vY = uv.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ZONE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vWp;
varying float vY;
void main() {
  // a haze that is thick at the ground and thins with height, slow bands drifting up it and a bright seam low down
  float bands = 0.55 + 0.45 * sin(vY * 140.0 - uTime * 1.6 + sin(atan(vWp.z, vWp.x) * 24.0) * 0.6);
  float low = 1.0 - smoothstep(0.0, 0.7, vY);
  float a = low * low * 0.55 * bands + low * 0.12 + 0.06;
  float seam = exp(-pow((vY - 0.09) * 60.0, 2.0)) * 0.35;
  float d = distance(cameraPosition.xz, vWp.xz);
  a = (a + seam) * (0.6 + 0.4 * smoothstep(3.0, 50.0, d));
  gl_FragColor = vec4(uColor * (1.0 + seam * 2.0), min(a, 0.85));
}`;

export type Royale = { group: T.Group; update(m: Match, camera: T.Camera, time: number): void; dispose(): void };

export function royaleFx(THREE: Three, shared: Shared, assets: Assets, shadows: boolean): Royale {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x);

  // the transport
  const planeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
  patch(planeMat, shared, { key: 'dz-plane', noBaked: true });
  const plane = new THREE.Mesh(keep(transportGeometry(THREE)), planeMat);
  plane.visible = false;
  plane.castShadow = shadows;
  group.add(plane);
  const propMat = keep(new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.35, side: DOUBLE, depthWrite: false }));
  const propGeo = keep(new THREE.CircleGeometry(2.1, 24));
  const props = [-12.5, -6.2, 6.2, 12.5].map((x) => {
    const p = new THREE.Mesh(propGeo, propMat);
    p.position.set(x, 1.5, -5.3);
    plane.add(p);
    return p;
  });

  // canopies, one instance per player under one
  const canopyMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: DOUBLE }));
  patch(canopyMat, shared, { key: 'dz-canopy', noBaked: true });
  const canopies = new THREE.InstancedMesh(keep(canopyGeometry(THREE)), canopyMat, 100);
  canopies.count = 0;
  canopies.frustumCulled = false;
  canopies.castShadow = shadows;
  group.add(canopies);
  const tint = new THREE.Color();

  // the zone: a tall open cylinder of haze
  const zoneMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(...lin(0xd86a3a, 1.4)) } },
      transparent: true,
      depthWrite: false,
      side: DOUBLE,
    }),
  );
  const zoneGeo = keep(new THREE.CylinderGeometry(1, 1, 1, 160, 1, true));
  zoneGeo.translate(0, 0.5, 0);
  const zone = new THREE.Mesh(zoneGeo, zoneMat);
  zone.frustumCulled = false;
  zone.renderOrder = 3;
  group.add(zone);

  // loot: a few instanced meshes, filled with what lies within reach of the camera
  const R = 60;
  const lootMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3, emissive: new THREE.Color(0.02, 0.02, 0.02) }));
  patch(lootMat, shared, { key: 'dz-loot' });
  const plainMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 }));
  patch(plainMat, shared, { key: 'dz-loot-plain' });
  const kitTex = (() => {
    const c = canvas(64, 64);
    const g = c.getContext('2d')!;
    g.fillStyle = '#e9e6de';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#c42a22';
    g.fillRect(26, 12, 12, 40);
    g.fillRect(12, 26, 40, 12);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const kitMat = keep(new THREE.MeshStandardMaterial({ map: kitTex, roughness: 0.6 }));
  patch(kitMat, shared, { key: 'dz-loot-kit' });
  const dummy = new THREE.Object3D();
  type Bucket = { mesh: T.InstancedMesh; match: (it: Item) => boolean; place: (it: Item, o: T.Object3D) => void; color?: (it: Item) => number };
  const buckets: Bucket[] = [];
  const bucket = (geo: T.BufferGeometry, mat: T.Material, max: number, match: Bucket['match'], place: Bucket['place'], color?: Bucket['color']) => {
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    buckets.push({ mesh, match, place, color });
  };
  const yawOf = (it: Item) => ((it.id * 2.399) % (Math.PI * 2)) - Math.PI;
  // guns lie on their side: the light model, and the full one (each of its parts) close up
  const NEAR = 10;
  let nearX = 0;
  let nearZ = 0;
  const near = (it: Item) => Math.abs(it.x - nearX) < NEAR && Math.abs(it.z - nearZ) < NEAR;
  const lay = (it: Item, o: T.Object3D) => {
    o.position.set(it.x, it.y + 0.04, it.z);
    o.rotation.set(0, yawOf(it), Math.PI / 2, 'YXZ');
  };
  for (const id of ['wren', 'bulwark', 'hornet', 'mauler', 'kestrel', 'lancer', 'longbow'] as WeaponId[]) {
    const model = gunModel(THREE, id, 0);
    const full = model.real?.fp ?? [];
    bucket(gunLiteGeometry(THREE, model), lootMat, 60, (it) => it.kind === 'gun' && it.what === id && (!full.length || !near(it)), lay);
    for (const part of full) bucket(part.geo, keep(worldMaterial(THREE, part.mat, shared)), 8, (it) => it.kind === 'gun' && it.what === id && near(it), lay);
  }
  const AMMO_COLOR: Record<AmmoKind, number> = { light: 0xc9a43e, rifle: 0x5e7d34, shells: 0x9c3227, magnum: 0x6b5b8c, sniper: 0x34527a };
  bucket(keep(roundBox(THREE, 0.32, 0.17, 0.2, 0.15, 2)), plainMat, 120, (it) => it.kind === 'ammo', (it, o) => {
    o.position.set(it.x, it.y + 0.085, it.z);
    o.rotation.set(0, yawOf(it), 0);
  }, (it) => AMMO_COLOR[it.what as AmmoKind]);
  const LEVEL_COLOR = [0, 0x8b8a78, 0x5f6b45, 0x2b332a];
  bucket(keep(roundBox(THREE, 0.46, 0.1, 0.58, 0.3, 2)), plainMat, 40, (it) => it.kind === 'vest', (it, o) => {
    o.position.set(it.x, it.y + 0.05, it.z);
    o.rotation.set(0, yawOf(it), 0);
  }, (it) => LEVEL_COLOR[Number(it.what)]);
  bucket(keep(roundBox(THREE, 0.34, 0.13, 0.24, 0.2, 2)), kitMat, 40, (it) => it.kind === 'heal' && it.what === 'kit', (it, o) => {
    o.position.set(it.x, it.y + 0.065, it.z);
    o.rotation.set(0, yawOf(it), 0);
  });
  bucket(keep(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 10)), plainMat, 60, (it) => it.kind === 'heal' && it.what === 'bandage', (it, o) => {
    o.position.set(it.x, it.y + 0.05, it.z);
    o.rotation.set(0, 0, Math.PI / 2);
  }, () => 0xe2d9c4);
  bucket(keep(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10)), plainMat, 40, (it) => it.kind === 'nade' && it.what === 'smoke', (it, o) => {
    o.position.set(it.x, it.y + 0.035, it.z);
    o.rotation.set(0, yawOf(it), Math.PI / 2);
  }, () => 0x6d7276);
  // real models where they loaded: the M67 for frags, the helmet for helmets
  const realBucket = (part: Part | undefined, max: number, match: Bucket['match'], place: Bucket['place'], fallback: () => T.BufferGeometry) => {
    if (part) bucket(part.geo, keep(worldMaterial(THREE, part.mat, shared)), max, match, place);
    else bucket(keep(fallback()), plainMat, max, match, place, () => 0x4a5a3a);
  };
  const m67 = modelOf(THREE, assets, 'm67');
  for (const p of m67?.parts ?? []) disposables.push(p.geo);
  realBucket(m67?.parts[0], 40, (it) => it.kind === 'nade' && it.what === 'frag', (it, o) => {
    o.position.set(it.x, it.y + 0.03, it.z);
    o.rotation.set(0, yawOf(it), Math.PI / 2);
  }, () => new THREE.SphereGeometry(0.045, 10, 8));
  const helmet = modelOf(THREE, assets, 'helmet');
  for (const p of helmet?.parts ?? []) disposables.push(p.geo);
  const helmetParts = helmet?.parts ?? [];
  if (helmetParts.length)
    for (const part of helmetParts)
      bucket(part.geo, keep(worldMaterial(THREE, part.mat, shared)), 40, (it) => it.kind === 'helmet', (it, o) => {
        o.position.set(it.x, it.y, it.z);
        o.rotation.set(0, yawOf(it), 0);
      });
  else
    bucket(keep(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), plainMat, 40, (it) => it.kind === 'helmet', (it, o) => {
      o.position.set(it.x, it.y, it.z);
    }, (it) => LEVEL_COLOR[Number(it.what)]);

  let lootVer = -1;
  let lootX = Infinity;
  let lootZ = Infinity;
  const fillLoot = (m: Match, cx: number, cz: number) => {
    lootVer = m.lootVer;
    lootX = cx;
    lootZ = cz;
    nearX = cx;
    nearZ = cz;
    for (const b of buckets) b.mesh.count = 0;
    for (const it of m.loot) {
      if (!it.live || Math.abs(it.x - cx) > R || Math.abs(it.z - cz) > R) continue;
      for (const b of buckets) {
        if (!b.match(it) || b.mesh.count >= b.mesh.instanceMatrix.count) continue;
        b.place(it, dummy);
        dummy.updateMatrix();
        b.mesh.setMatrixAt(b.mesh.count, dummy.matrix);
        if (b.color) b.mesh.setColorAt(b.mesh.count, tint.set(b.color(it)));
        b.mesh.count++;
      }
    }
    for (const b of buckets) {
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
  };

  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  return {
    group,
    update(m, camera, time) {
      const royale = m.mode === 'royale';
      group.visible = royale;
      if (!royale) return;
      // the transport
      const p = m.plane;
      plane.visible = !!p;
      if (p) {
        const at = planeAt(p, m.time);
        plane.position.set(at.x, p.y, at.z);
        plane.rotation.set(0, Math.atan2(-(p.bx - p.ax), -(p.bz - p.az)), Math.sin(time * 0.6) * 0.015, 'YXZ');
        for (const pr of props) pr.rotation.z = time * 40;
      }
      // canopies over everyone gliding in
      let n = 0;
      for (const a of m.actors) {
        if (!a.alive || a.drop !== 3) continue;
        q.setFromAxisAngle(up, a.yaw);
        pos.set(a.body.x, a.body.y, a.body.z);
        mat4.compose(pos, q, sc);
        canopies.setMatrixAt(n, mat4);
        canopies.setColorAt(n, tint.set(CANOPY_COLORS[a.id % CANOPY_COLORS.length]));
        n++;
      }
      canopies.count = n;
      canopies.instanceMatrix.needsUpdate = true;
      if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
      // the zone
      const z = m.zone;
      zone.visible = !!z && z.r > 0.5;
      if (z) {
        zone.position.set(z.x, -40, z.z);
        zone.scale.set(Math.max(0.5, z.r), 640, Math.max(0.5, z.r));
        zoneMat.uniforms.uTime.value = time;
      }
      // loot near the camera
      const cx = camera.position.x;
      const cz = camera.position.z;
      if (m.lootVer !== lootVer || Math.abs(cx - lootX) > 3 || Math.abs(cz - lootZ) > 3) fillLoot(m, cx, cz);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      canopies.dispose();
      for (const b of buckets) b.mesh.dispose();
    },
  };
}
