// What a royale adds to the scene: the transport flying its line, a canopy over everyone gliding in, the zone's wall of
// haze, supply crates coming down under their parachutes, a red wall around a bombardment, and the loot lying around
// (guns, ammo, armor, backpacks, heals, boosts and attachments, each with a look of its own: drawn only near you,
// rebuilt when it changes or you move on).
import type { Assets } from '../assets.ts';
import type { Match } from '../match.ts';
import { SUPPLY_MAX, planeAt, type AmmoKind, type Item } from '../royale.ts';
import { floorAt } from '../terrain.ts';
import { WEAPON_IDS } from '../weapons.ts';
import { DOUBLE, canvas, lin, patch, roundBox, type Shared, type T, type Three } from './common.ts';
import { gunLiteGeometry, gunModel } from './guns.ts';
import { modelOf, worldMaterial, type Part } from './models.ts';

/** Merges geometries (all non indexed) into one with vertex colors. */
export function merged(THREE: Three, parts: [T.BufferGeometry, number][]) {
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

/** A supply crate, about 1.3 m square and a meter tall, its bottom at the origin: blue panels in a dark steel frame
 * with a yellow band round it. */
function crateGeometry(THREE: Three) {
  const parts: [T.BufferGeometry, number][] = [];
  const add = (g: T.BufferGeometry, c: number, x: number, y: number, z: number) => {
    g.translate(x, y, z);
    parts.push([g, c]);
  };
  const frame = 0x262c31;
  add(roundBox(THREE, 1.24, 0.9, 1.24, 0.06, 2), 0x2b6ca3, 0, 0.47, 0);
  add(new THREE.BoxGeometry(1.28, 0.12, 1.28), 0xd9a92c, 0, 0.5, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.98, 0.1), frame, sx * 0.62, 0.49, sz * 0.62);
  for (const y of [0.04, 0.94]) {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(1.32, 0.08, 0.08), frame, 0, y, s * 0.62);
      add(new THREE.BoxGeometry(0.08, 0.08, 1.32), frame, s * 0.62, y, 0);
    }
  }
  return merged(THREE, parts);
}

/** A round cargo parachute in orange and white gores, about 7 m across, with lines down to the corners of the crate
 * hanging under it (whose top is 1 m above the origin). */
function chuteGeometry(THREE: Three) {
  const parts: [T.BufferGeometry, number][] = [];
  const R = 3.5;
  const theta = Math.PI / 2.5;
  const lift = 8;
  const squash = 0.55;
  const gores = 12;
  for (let k = 0; k < gores; k++) {
    const g = new THREE.SphereGeometry(R, 3, 7, (k / gores) * Math.PI * 2, (Math.PI * 2) / gores, 0, theta);
    g.scale(1, squash, 1);
    g.translate(0, lift, 0);
    parts.push([g, k % 2 ? 0xeeeae0 : 0xe0582a]);
  }
  const rimR = R * Math.sin(theta);
  const rimY = lift + R * Math.cos(theta) * squash;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const top = new THREE.Vector3(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR);
    const bottom = new THREE.Vector3(Math.sign(Math.cos(a)) * 0.6, 1, Math.sign(Math.sin(a)) * 0.6);
    const len = top.distanceTo(bottom);
    const line = new THREE.BoxGeometry(0.03, 0.03, len);
    line.translate(0, 0, len / 2);
    line.lookAt(new THREE.Vector3().subVectors(top, bottom));
    line.translate(bottom.x, bottom.y, bottom.z);
    parts.push([line, 0x2a2a28]);
  }
  return merged(THREE, parts);
}

/** Builds a small loot model from parts: [geometry, color, x, y, z, rotation x, y, z]. */
function lootGeometry(THREE: Three, list: [T.BufferGeometry, number, number, number, number, number?, number?, number?][]) {
  const parts: [T.BufferGeometry, number][] = [];
  for (const [g, c, x, y, z, rx = 0, ry = 0, rz = 0] of list) {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push([g, c]);
  }
  return merged(THREE, parts);
}

/** A backpack lying on its back, its bottom at the origin: a rounded pack with a top flap, a front pocket and two
 * dark straps across it. The body is white so each level's color tints it. */
function packGeometry(THREE: Three) {
  const strap = 0x3a3a36;
  return lootGeometry(THREE, [
    [roundBox(THREE, 0.38, 0.2, 0.52, 0.35, 2), 0xffffff, 0, 0.1, 0],
    [roundBox(THREE, 0.4, 0.07, 0.16, 0.4, 2), 0xd8d8d8, 0, 0.19, -0.2],
    [roundBox(THREE, 0.26, 0.08, 0.2, 0.35, 2), 0xe6e6e6, 0, 0.22, 0.09],
    [new THREE.BoxGeometry(0.035, 0.012, 0.5), strap, -0.09, 0.205, 0],
    [new THREE.BoxGeometry(0.035, 0.012, 0.5), strap, 0.09, 0.205, 0],
    [new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI), strap, 0, 0.12, -0.27, 0, Math.PI / 2],
  ]);
}

/** An energy drink can standing up: a bright green body, a dark band and a silver top. */
function drinkGeometry(THREE: Three) {
  return lootGeometry(THREE, [
    [new THREE.CylinderGeometry(0.04, 0.04, 0.15, 14), 0x7ddc2e, 0, 0.075, 0],
    [new THREE.CylinderGeometry(0.0405, 0.0405, 0.04, 14), 0x1d2a18, 0, 0.08, 0],
    [new THREE.CylinderGeometry(0.034, 0.04, 0.012, 14), 0xc9cccf, 0, 0.156, 0],
  ]);
}

/** A bottle of painkillers standing up: amber with a white cap and label. */
function pillsGeometry(THREE: Three) {
  return lootGeometry(THREE, [
    [new THREE.CylinderGeometry(0.038, 0.038, 0.1, 14), 0xc8741e, 0, 0.05, 0],
    [new THREE.CylinderGeometry(0.0385, 0.0385, 0.05, 14), 0xf0ede4, 0, 0.05, 0],
    [new THREE.CylinderGeometry(0.042, 0.042, 0.035, 14), 0xf6f6f2, 0, 0.117, 0],
  ]);
}

/** A red dot sight on its mount: a squat dark housing round a lens with a red glint, about twice true size so it can
 * be seen on the ground. */
function dotGeometry(THREE: Three) {
  const body = 0x2a2d30;
  return lootGeometry(THREE, [
    [new THREE.BoxGeometry(0.1, 0.03, 0.16), body, 0, 0.015, 0],
    [new THREE.CylinderGeometry(0.05, 0.05, 0.13, 14, 1, true), body, 0, 0.08, 0, Math.PI / 2],
    [new THREE.CircleGeometry(0.046, 14), 0xd8302a, 0, 0.08, 0.06],
    [new THREE.CircleGeometry(0.046, 14), 0x6a1a18, 0, 0.08, -0.06, 0, Math.PI],
    [new THREE.BoxGeometry(0.03, 0.035, 0.03), body, 0.06, 0.09, 0],
  ]);
}

/** A 4x scope: a long black tube with bells at both ends and a turret on top, on two rings. */
function scopeGeometry(THREE: Three) {
  const black = 0x1b1d1f;
  return lootGeometry(THREE, [
    [new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12), black, 0, 0.075, 0, Math.PI / 2],
    [new THREE.CylinderGeometry(0.048, 0.03, 0.09, 12), black, 0, 0.075, 0.18, Math.PI / 2],
    [new THREE.CylinderGeometry(0.03, 0.04, 0.06, 12), black, 0, 0.075, -0.17, Math.PI / 2],
    [new THREE.CircleGeometry(0.044, 12), 0x3c6e8a, 0, 0.075, 0.226],
    [new THREE.CylinderGeometry(0.02, 0.02, 0.05, 10), black, 0, 0.115, 0],
    [new THREE.BoxGeometry(0.05, 0.045, 0.03), 0x3a3d40, 0, 0.022, 0.08],
    [new THREE.BoxGeometry(0.05, 0.045, 0.03), 0x3a3d40, 0, 0.022, -0.08],
  ]);
}

/** An extended magazine lying on its side: long and curved (three segments), with a yellow witness band. */
function extGeometry(THREE: Three) {
  const steel = 0x2e3236;
  return lootGeometry(THREE, [
    [new THREE.BoxGeometry(0.11, 0.04, 0.12), steel, 0, 0.02, -0.11],
    [new THREE.BoxGeometry(0.11, 0.04, 0.12), steel, 0.012, 0.02, 0.0, 0, -0.12],
    [new THREE.BoxGeometry(0.11, 0.04, 0.12), steel, 0.035, 0.02, 0.11, 0, -0.24],
    [new THREE.BoxGeometry(0.115, 0.042, 0.025), 0xe2b43a, 0.012, 0.021, 0.0, 0, -0.12],
    [new THREE.BoxGeometry(0.13, 0.05, 0.03), 0x1a1c1e, 0.05, 0.025, 0.18, 0, -0.24],
  ]);
}

/** A compensator lying down: a short ported muzzle device, its slots cut dark across the top. */
function compGeometry(THREE: Three) {
  const steel = 0x5a5f63;
  const list: [T.BufferGeometry, number, number, number, number, number?, number?, number?][] = [[new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), steel, 0, 0.035, 0, Math.PI / 2]];
  for (const z of [-0.04, 0, 0.04]) list.push([new THREE.BoxGeometry(0.05, 0.012, 0.016), 0x111213, 0, 0.068, z]);
  list.push([new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12), 0x3a3e41, 0, 0.035, -0.08, Math.PI / 2]);
  return lootGeometry(THREE, list);
}

const CANOPY_COLORS =[0x4f5a3a, 0xc8b28a, 0xd06a2c, 0xe8e6de, 0x3d6a8f, 0x7a2a2a, 0x2f3a2f];

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
uniform float uFade;
varying vec3 vWp;
varying float vY;
void main() {
  // a haze that is thick at the ground and thins with height, with slow bands drifting up it
  float bands = 0.55 + 0.45 * sin(vY * 140.0 - uTime * 1.6 + sin(atan(vWp.z, vWp.x) * 24.0) * 0.6);
  float low = 1.0 - smoothstep(0.0, 0.7, vY);
  float a = low * low * 0.55 * bands + low * 0.12 + 0.06;
  float d = distance(cameraPosition.xz, vWp.xz);
  a *= 0.6 + 0.4 * smoothstep(3.0, 50.0, d);
  gl_FragColor = vec4(uColor, min(a, 0.8) * uFade);
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
  canopies.setColorAt(0, new THREE.Color(1, 1, 1));
  canopies.frustumCulled = false;
  canopies.castShadow = shadows;
  group.add(canopies);
  const tint = new THREE.Color();

  // the zone: a tall open cylinder of haze
  const zoneMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(...lin(0xd86a3a, 1.4)) }, uFade: { value: 1 } },
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

  // a bombardment: a lower wall of red haze round its circle, faint while it is only marked
  const redMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(...lin(0xe0281e, 1.6)) }, uFade: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
      side: DOUBLE,
    }),
  );
  const redWall = new THREE.Mesh(zoneGeo, redMat);
  redWall.frustumCulled = false;
  redWall.renderOrder = 3;
  redWall.visible = false;
  group.add(redWall);

  // supply crates, each under its parachute while it comes down (the canopy folds away once it lands)
  const crateMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));
  patch(crateMat, shared, { key: 'dz-crate' });
  const chuteMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DOUBLE }));
  patch(chuteMat, shared, { key: 'dz-chute', noBaked: true });
  const crateGeo = keep(crateGeometry(THREE));
  const chuteGeo = keep(chuteGeometry(THREE));
  const crates = Array.from({ length: SUPPLY_MAX }, () => {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.castShadow = shadows;
    crate.receiveShadow = true;
    crate.visible = false;
    const chute = new THREE.Mesh(chuteGeo, chuteMat);
    chute.castShadow = shadows;
    chute.visible = false;
    group.add(crate, chute);
    return { crate, chute };
  });

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
    if (color) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
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
  for (const id of WEAPON_IDS) {
    const model = gunModel(THREE, id, 0);
    const full = model.real?.fp ?? [];
    bucket(gunLiteGeometry(THREE, model), lootMat, 60, (it) => it.kind === 'gun' && it.what === id && (!full.length || !near(it)), lay);
    for (const part of full) bucket(part.geo, keep(worldMaterial(THREE, part.mat, shared)), 8, (it) => it.kind === 'gun' && it.what === id && near(it), lay);
  }
  const AMMO_COLOR: Record<AmmoKind, number> = { light: 0xc9a43e, rifle: 0x5e7d34, shells: 0x9c3227, magnum: 0x6b5b8c, sniper: 0x34527a, bolts: 0x7a5a32 };
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
  // the other grenades: an incendiary's red can, an impact grenade's yellow puck, a decoy's grey green can
  const NADE_COLOR: Record<string, number> = { fire: 0x8c2a1c, impact: 0xb8962c, decoy: 0x55665a };
  bucket(keep(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10)), plainMat, 40, (it) => it.kind === 'nade' && (it.what === 'fire' || it.what === 'decoy'), (it, o) => {
    o.position.set(it.x, it.y + 0.035, it.z);
    o.rotation.set(0, yawOf(it), Math.PI / 2);
  }, (it) => NADE_COLOR[it.what]);
  bucket(keep(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 12)), plainMat, 30, (it) => it.kind === 'nade' && it.what === 'impact', (it, o) => {
    o.position.set(it.x, it.y + 0.035, it.z);
    o.rotation.set(0, yawOf(it), 0);
  }, (it) => NADE_COLOR[it.what]);
  // ballistic shields lie flat on their backs: the real model, else a plain slab
  const shield = modelOf(THREE, assets, 'shield');
  for (const p of shield?.parts ?? []) disposables.push(p.geo);
  const flat = (it: Item, o: T.Object3D) => {
    o.position.set(it.x, it.y + 0.06, it.z);
    o.rotation.set(Math.PI / 2, yawOf(it), 0, 'YXZ');
  };
  if (shield?.parts.length) for (const part of shield.parts) bucket(part.geo, keep(worldMaterial(THREE, part.mat, shared)), 12, (it) => it.kind === 'shield', flat);
  else bucket(keep(roundBox(THREE, 0.6, 1.4, 0.06, 0.2, 2).translate(0, 0.7, 0)), plainMat, 12, (it) => it.kind === 'shield', flat, () => 0x2c3034);

  // backpacks in their level's color, boosts standing up, attachments lying down
  const PACK_COLOR = [0, 0xa8946a, 0x66734a, 0x34393a];
  bucket(keep(packGeometry(THREE)), lootMat, 40, (it) => it.kind === 'pack', (it, o) => {
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(0, yawOf(it), 0);
  }, (it) => PACK_COLOR[Number(it.what)]);
  const stand = (it: Item, o: T.Object3D) => {
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(0, yawOf(it), 0);
  };
  bucket(keep(drinkGeometry(THREE)), lootMat, 40, (it) => it.kind === 'boost' && it.what === 'drink', stand);
  bucket(keep(pillsGeometry(THREE)), lootMat, 40, (it) => it.kind === 'boost' && it.what === 'pills', stand);
  bucket(keep(dotGeometry(THREE)), lootMat, 30, (it) => it.kind === 'att' && it.what === 'dot', stand);
  bucket(keep(scopeGeometry(THREE)), lootMat, 30, (it) => it.kind === 'att' && it.what === 'x4', stand);
  bucket(keep(extGeometry(THREE)), lootMat, 30, (it) => it.kind === 'att' && it.what === 'ext', stand);
  bucket(keep(compGeometry(THREE)), lootMat, 30, (it) => it.kind === 'att' && it.what === 'comp', stand);
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
  let lootOf: Match | null = null;
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
      // the bombardment
      const red = m.red;
      redWall.visible = !!red;
      if (red) {
        redWall.position.set(red.x, floorAt(m.world.terrain, red.x, red.z) - 15, red.z);
        redWall.scale.set(red.r, 50, red.r);
        redMat.uniforms.uTime.value = time;
        redMat.uniforms.uFade.value = red.warn > 0 ? 0.45 + 0.15 * Math.sin(time * 5) : 0.85 + 0.15 * Math.sin(time * 9);
      }
      // supply crates: swaying a little under the canopy on the way down, the canopy collapsing to one side once down
      crates.forEach(({ crate, chute }, i) => {
        const s = m.supplies[i];
        crate.visible = !!s;
        if (!s) {
          chute.visible = false;
          return;
        }
        const age = s.landed < 0 ? -1 : m.time - s.landed;
        const sway = age < 0 ? Math.sin(time * 1.3 + i) * 0.06 : 0;
        crate.position.set(s.x, s.y, s.z);
        crate.rotation.set(sway, s.id * 0.7, sway * 0.6, 'YXZ');
        const fold = age < 0 ? 0 : Math.min(1, age / 1.8);
        chute.visible = fold < 1;
        if (chute.visible) {
          chute.position.set(s.x + fold * 2.5, s.y - fold * 0.6, s.z);
          chute.rotation.set(sway, s.id * 0.7, sway * 0.6 - fold * 1.1, 'YXZ');
          chute.scale.set(1 + fold * 0.3, Math.max(0.05, 1 - fold), 1 + fold * 0.3);
        }
      });
      // loot near the camera
      const cx = camera.position.x;
      const cz = camera.position.z;
      if (m !== lootOf || m.lootVer !== lootVer || Math.abs(cx - lootX) > 3 || Math.abs(cz - lootZ) > 3) {
        lootOf = m;
        fillLoot(m, cx, cz);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      canopies.dispose();
      for (const b of buckets) b.mesh.dispose();
    },
  };
}
