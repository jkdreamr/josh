import type * as T from 'three';
import { FIELD } from './field.ts';
import { BOARD_METERS, adTexture, grassTextures, skyTexture } from './textures.ts';

type Three = typeof import('three');
export type Conditions = 'night' | 'golden' | 'overcast' | 'rain';
export type PitchPattern = 'stripes' | 'checker';
export type ClubColors = { shirt: string; trim: string; shorts: string };
export type StadiumFrame = {
  ball: { x: number; y: number; z: number };
  ballInNet: boolean;
  /** Excitement per club, -1 (gutted) to 1 (just scored). */
  roar: [number, number];
  camera: T.PerspectiveCamera;
  dt: number;
  time: number;
};
export type Stadium = {
  setConditions(mode: Conditions): void;
  setPattern(pattern: PitchPattern): void;
  /** True while the sun is low (golden hour): the key light should sit low and behind the far stand. */
  sunLow(): boolean;
  update(frame: StadiumFrame): void;
  reduceCrowd(): void;
  crowdCount(): number;
  dispose(): void;
};
type Lights = { renderer: T.WebGLRenderer; scene: T.Scene; hemi: T.HemisphereLight; key: T.DirectionalLight };
type V = [number, number, number];

const HL = FIELD.length / 2, HW = FIELD.width / 2;
const BOARD_X = HL + 5, BOARD_Z = HW + 5.5;
const STAND = 8;
const CORNER = 6;
const RUN_X = STAND, RUN_Z = STAND;

type Preset = {
  exposure: number; hemiSky: string; hemiGround: string; hemi: number; key: string; keyI: number; shadow: number; sunLow: boolean;
  fog: string; fogNear: number; fogFar: number; glow: number; boxes: number; crowd: string; wet: number; rain: number; wind: number;
  grassA: string; grassB: string; standShadow: number; net: number;
};
const PRESETS: Record<Conditions, Preset> = {
  night: { exposure: 1.2, hemiSky: '#bccdf0', hemiGround: '#16241b', hemi: 0.8, key: '#f4f8ff', keyI: 3.5, shadow: 1, sunLow: false, fog: '#0b1626', fogNear: 95, fogFar: 300, glow: 1, boxes: 1, crowd: '#8f9cb0', wet: 0, rain: 0, wind: 0.35, grassA: '#3f9e48', grassB: '#2b7d36', standShadow: 0, net: 0.95 },
  golden: { exposure: 1.08, hemiSky: '#ffe3c0', hemiGround: '#2c2a1a', hemi: 1.6, key: '#ffb06a', keyI: 3.3, shadow: 1, sunLow: true, fog: '#c98a66', fogNear: 110, fogFar: 320, glow: 0.14, boxes: 0.35, crowd: '#e6c7a6', wet: 0, rain: 0, wind: 0.5, grassA: '#4aa24a', grassB: '#337f37', standShadow: 0.55, net: 1 },
  overcast: { exposure: 1.06, hemiSky: '#dfe7ee', hemiGround: '#39432f', hemi: 2.3, key: '#e8eef5', keyI: 1.25, shadow: 0.4, sunLow: false, fog: '#8d9aa6', fogNear: 75, fogFar: 270, glow: 0.4, boxes: 0.6, crowd: '#b4bcc6', wet: 0.15, rain: 0, wind: 0.8, grassA: '#3d9445', grassB: '#2b7636', standShadow: 0, net: 0.9 },
  rain: { exposure: 1.14, hemiSky: '#a6b6c8', hemiGround: '#17221d', hemi: 1.1, key: '#dfe8f5', keyI: 2.7, shadow: 0.75, sunLow: false, fog: '#4d5866', fogNear: 45, fogFar: 210, glow: 0.95, boxes: 0.9, crowd: '#7f8a99', wet: 1, rain: 1, wind: 1.4, grassA: '#358c40', grassB: '#246e31', standShadow: 0, net: 0.8 },
};

/** Flat-shaded triangle soup with per-vertex color, optional uv and one extra float. */
class Mesher {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; extra: number[] = [];
  color: [number, number, number] = [1, 1, 1];
  part = 0;
  constructor(private THREE: Three, private withUv = false, private withExtra = false) {}
  setColor(color: string | T.Color, scale = 1) {
    const c = typeof color === 'string' ? new this.THREE.Color(color) : color;
    this.color = [c.r * scale, c.g * scale, c.b * scale];
  }
  private vertex(p: V, n: V, uv?: [number, number]) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(...this.color);
    if (this.withUv) this.uv.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
    if (this.withExtra) this.extra.push(this.part);
  }
  /** Quad a-b-c-d; when `facing` is given the winding is flipped so the front side looks along it. */
  quad(a: V, b: V, c: V, d: V, facing?: V, uvs?: [number, number][]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let order = [0, 1, 2, 0, 2, 3];
    if (facing && nx * facing[0] + ny * facing[1] + nz * facing[2] < 0) { order = [0, 2, 1, 0, 3, 2]; nx = -nx; ny = -ny; nz = -nz; }
    const pts = [a, b, c, d];
    for (const i of order) this.vertex(pts[i]!, [nx, ny, nz], uvs?.[i]);
  }
  /** Axis-aligned-ish box from a transform: centre, size, yaw. Bottom face skipped. */
  box(center: V, size: V, yaw = 0) {
    const [cx, cy, cz] = center, [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const p = (x: number, y: number, z: number): V => [cx + x * cos + z * sin, cy + y, cz - x * sin + z * cos];
    const c = [p(-sx, -sy, -sz), p(sx, -sy, -sz), p(sx, sy, -sz), p(-sx, sy, -sz), p(-sx, -sy, sz), p(sx, -sy, sz), p(sx, sy, sz), p(-sx, sy, sz)];
    const out = (x: number, y: number, z: number): V => [x * cos + z * sin, y, -x * sin + z * cos];
    this.quad(c[0]!, c[1]!, c[2]!, c[3]!, out(0, 0, -1));
    this.quad(c[5]!, c[4]!, c[7]!, c[6]!, out(0, 0, 1));
    this.quad(c[4]!, c[0]!, c[3]!, c[7]!, out(-1, 0, 0));
    this.quad(c[1]!, c[5]!, c[6]!, c[2]!, out(1, 0, 0));
    this.quad(c[3]!, c[2]!, c[6]!, c[7]!, [0, 1, 0]);
  }
  /** Bakes another geometry in with a transform, using the current color. */
  add(geometry: T.BufferGeometry, matrix: T.Matrix4) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    flat.applyMatrix4(matrix);
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    const p = flat.getAttribute('position') as T.BufferAttribute, n = flat.getAttribute('normal') as T.BufferAttribute;
    for (let i = 0; i < p.count; i++) this.vertex([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)]);
    flat.dispose(); geometry.dispose();
  }
  geometry() {
    const g = new this.THREE.BufferGeometry();
    g.setAttribute('position', new this.THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new this.THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new this.THREE.Float32BufferAttribute(this.col, 3));
    if (this.withUv) g.setAttribute('uv', new this.THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withExtra) g.setAttribute('aPart', new this.THREE.Float32BufferAttribute(this.extra, 1));
    g.computeBoundingSphere();
    return g;
  }
}

type Station = { cx: number; cz: number; nx: number; nz: number; side: 'n' | 's' | 'e' | 'w' | 'c' };
function ringStations(lite: boolean): Station[] {
  const ax = HL + STAND - CORNER, az = HW + STAND - CORNER;
  const out: Station[] = [];
  const sides: { side: Station['side']; from: [number, number]; to: [number, number]; theta: number; n: number }[] = [
    { side: 's', from: [-ax, -az], to: [ax, -az], theta: -90, n: lite ? 12 : 18 },
    { side: 'e', from: [ax, -az], to: [ax, az], theta: 0, n: lite ? 8 : 12 },
    { side: 'n', from: [ax, az], to: [-ax, az], theta: 90, n: lite ? 12 : 18 },
    { side: 'w', from: [-ax, az], to: [-ax, -az], theta: 180, n: lite ? 8 : 12 },
  ];
  const corner = lite ? 4 : 7;
  for (const s of sides) {
    const rad = s.theta * Math.PI / 180;
    for (let i = 0; i < s.n; i++) {
      const t = i / s.n;
      out.push({ cx: s.from[0] + (s.to[0] - s.from[0]) * t, cz: s.from[1] + (s.to[1] - s.from[1]) * t, nx: Math.cos(rad), nz: Math.sin(rad), side: s.side });
    }
    for (let j = 0; j < corner; j++) {
      const a = rad + (j / corner) * Math.PI / 2;
      out.push({ cx: s.to[0], cz: s.to[1], nx: Math.cos(a), nz: Math.sin(a), side: 'c' });
    }
  }
  return out;
}
const at = (s: Station, d: number, y: number): V => [s.cx + s.nx * (CORNER + d), y, s.cz + s.nz * (CORNER + d)];

type Row = { d: number; y: number; tier: number; index: number };
type Kind = 'wall' | 'tread' | 'riser' | 'aisle' | 'glass' | 'back' | 'roofUnder' | 'roofFront' | 'roofTop';
function standProfile() {
  const points: { d: number; y: number }[] = [{ d: 0, y: 0 }];
  const kinds: Kind[] = [];
  const rows: Row[] = [];
  let d = 0, y = 0;
  const step = (dd: number, dy: number, kind: Kind) => { d += dd; y += dy; points.push({ d, y }); kinds.push(kind); };
  step(0, 1.3, 'wall');
  for (let i = 0; i < 13; i++) { rows.push({ d: d + 0.42, y, tier: 0, index: i }); step(0.85, 0, 'tread'); step(0, 0.44, 'riser'); }
  step(1.3, 0, 'aisle');
  const glass = { d, y0: y, y1: y + 3 };
  step(0, 3, 'glass');
  step(0.7, 0, 'aisle');
  for (let i = 0; i < 14; i++) { rows.push({ d: d + 0.42, y, tier: 1, index: i }); step(0.85, 0, 'tread'); step(0, 0.6, 'riser'); }
  const back = d;
  step(0, 23.2 - y, 'back');
  step(-back, 1.7, 'roofUnder');
  step(0, 1.3, 'roofFront');
  step(back + 1.5, -1.2, 'roofTop');
  return { points, kinds, rows, glass, back };
}

function clubSide(side: Station['side']) {
  return side === 'e' ? 1 : side === 'c' ? -1 : 0;
}

const vertexFog = /* glsl */`
uniform vec3 uFogColor; uniform vec2 uFog;
varying float vFogF;`;

function shaderMaterial(THREE: Three, params: ConstructorParameters<typeof THREE.ShaderMaterial>[0]) {
  return new THREE.ShaderMaterial(params);
}

export function buildStadium(THREE: Three, lights: Lights, opts: { lite: boolean; kits: readonly [ClubColors, ClubColors]; conditions: Conditions; pattern: PitchPattern }): Stadium {
  const { scene } = lights;
  const lite = opts.lite;
  const root = new THREE.Group();
  root.name = 'stadium';
  scene.add(root);
  const fogUniforms = { uFogColor: { value: new THREE.Color('#0b1626') }, uFog: { value: new THREE.Vector2(95, 300) } };
  const time = { value: 0 };
  const owned: { dispose(): void }[] = [];

  // Sky dome that follows the camera, mostly hidden by the bowl.
  const sky = skyTexture(THREE);
  owned.push(sky.texture);
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 12), new THREE.MeshBasicMaterial({ map: sky.texture, side: THREE.BackSide, depthWrite: false, fog: false }));
  skyMesh.frustumCulled = false; skyMesh.renderOrder = -10;
  root.add(skyMesh);

  // Pitch: one plane out to the stands, mowing pattern, wear and analytic lines in the shader.
  const grass = grassTextures(THREE, lite);
  owned.push(grass.detail); if (grass.normal) owned.push(grass.normal);
  const pitchW = FIELD.length + RUN_X * 2, pitchD = FIELD.width + RUN_Z * 2;
  grass.detail.repeat.set(pitchW / 3, pitchD / 3);
  grass.normal?.repeat.set(pitchW / 2.2, pitchD / 2.2);
  const pitchUniforms = {
    uGrassA: { value: new THREE.Color() }, uGrassB: { value: new THREE.Color() },
    uPattern: { value: 0 }, uWet: { value: 0 }, uStandShadow: { value: 0 },
    uSoil: { value: new THREE.Color('#77633f') }, uDry: { value: new THREE.Color('#8a9150') },
    uSurround: { value: new THREE.Color('#24372f') }, uLine: { value: new THREE.Color('#f3f3ec') },
  };
  const turf = new THREE.MeshStandardMaterial({ map: grass.detail, normalMap: grass.normal ?? null, color: '#ffffff', roughness: 0.82, metalness: 0 });
  if (grass.normal) turf.normalScale.set(0.55, 0.55);
  const f = (n: number) => n.toFixed(3);
  turf.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pitchUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPitch;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPitch = vec2(position.x, -position.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vPitch;
uniform vec3 uGrassA, uGrassB, uSoil, uDry, uSurround, uLine;
uniform float uPattern, uWet, uStandShadow;
const float HL = ${f(HL)}, HW = ${f(HW)};
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float bands(float x, float w) { float t = abs(fract(x * 0.5) * 2.0 - 1.0); return smoothstep(0.5 - w, 0.5 + w, t); }
float pitchLines(vec2 p) {
  vec2 q = vec2(abs(p.x), p.y);
  float d = abs(sdBox(p, vec2(HL, HW)));
  d = min(d, max(abs(p.x), abs(p.y) - HW));
  d = min(d, abs(length(p) - ${f(FIELD.centerRadius)}));
  d = min(d, length(p) - 0.11);
  d = min(d, abs(sdBox(q - vec2(HL - ${f(FIELD.penaltyDepth / 2)}, 0.0), vec2(${f(FIELD.penaltyDepth / 2)}, ${f(FIELD.penaltyWidth / 2)}))));
  d = min(d, abs(sdBox(q - vec2(HL - ${f(FIELD.goalAreaDepth / 2)}, 0.0), vec2(${f(FIELD.goalAreaDepth / 2)}, ${f(FIELD.goalAreaWidth / 2)}))));
  vec2 spot = vec2(HL - ${f(FIELD.penaltySpot)}, 0.0);
  d = min(d, length(q - spot) - 0.11);
  if (q.x < HL - ${f(FIELD.penaltyDepth)}) d = min(d, abs(length(q - spot) - ${f(FIELD.centerRadius)}));
  vec2 c = vec2(abs(p.x), abs(p.y));
  if (c.x < HL && c.y < HW) d = min(d, abs(length(c - vec2(HL, HW)) - 1.0));
  return d;
}`)
      .replace('#include <map_fragment>', `
vec2 p = vPitch;
vec4 grassTex = texture2D(map, vMapUv);
#ifdef PITCH_LITE
float patchy = 0.5;
#else
float patchy = texture2D(map, vMapUv * 0.083).g;
#endif
vec2 fw = fwidth(p);
float bandW = ${f(FIELD.length / 18)};
float sx = bands((p.x + HL) / bandW + 1.0, fw.x / bandW * 1.5);
float sz = bands((p.y + HW) / ${f(FIELD.width / 8)} + 1.0, fw.y / ${f(FIELD.width / 8)} * 1.5);
float checker = sx + sz - 2.0 * sx * sz;
float mow = mix(sx, checker, uPattern);
vec3 g = mix(uGrassB, uGrassA, mow);
g *= 0.72 + grassTex.r * 0.56;
g *= 0.86 + patchy * 0.28;
vec2 q = vec2(abs(p.x), p.y);
float mouth = 1.0 - smoothstep(0.0, 1.0, length((q - vec2(HL - 2.6, 0.0)) / vec2(4.4, 4.0)));
float keeperLine = 1.0 - smoothstep(0.0, 1.0, length((q - vec2(HL - 0.7, 0.0)) / vec2(1.3, 4.2)));
float spotWear = 1.0 - smoothstep(0.0, 1.0, length(q - vec2(HL - ${f(FIELD.penaltySpot)}, 0.0)) / 1.2);
float centreWear = 1.0 - smoothstep(0.0, 1.0, length(p) / 1.7);
float wear = max(max(mouth * 0.75, keeperLine), max(spotWear * 0.7, centreWear * 0.55));
wear *= smoothstep(0.15, 0.7, patchy * 0.8 + grassTex.r * 0.3 + wear * 0.35);
g = mix(g, uDry * (0.8 + grassTex.r * 0.4), wear * 0.55);
g = mix(g, uSoil * (0.75 + grassTex.r * 0.5), smoothstep(0.55, 1.0, wear) * 0.75);
float aa = max(length(fw) * 0.75, 1e-4);
float ld = pitchLines(p) - 0.06;
float line = (1.0 - smoothstep(-aa, aa, ld)) * clamp(0.18 / aa, 0.45, 1.0);
g = mix(g, uLine, line * 0.94);
float outside = max(smoothstep(${f(BOARD_X)} - 0.1, ${f(BOARD_X)} + 0.1, abs(p.x)), smoothstep(${f(BOARD_Z)} - 0.1, ${f(BOARD_Z)} + 0.1, abs(p.y)));
g = mix(g, uSurround * (0.85 + grassTex.r * 0.3), outside);
float standShade = smoothstep(-1.2, 1.2, dot(p, vec2(0.28, 0.96)) - 16.0) * uStandShadow;
g *= 1.0 - standShade;
g *= 1.0 - uWet * 0.22;
diffuseColor.rgb *= g;
float pitchWear = wear;
float pitchLine = line;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.95, pitchWear * 0.6);
roughnessFactor = mix(roughnessFactor, 0.34 + (1.0 - patchy) * 0.25, uWet * (1.0 - pitchWear * 0.5));
roughnessFactor = mix(roughnessFactor, 0.6, pitchLine * 0.5);`);
  };
  turf.customProgramCacheKey = () => `soccer-pitch-${lite ? 'lite' : 'full'}`;
  if (lite) turf.defines = { PITCH_LITE: '' };
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(pitchW, pitchD), turf);
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.005; pitch.receiveShadow = true;
  root.add(pitch);

  // The bowl: tiered stands, hospitality fascia, back wall and roof, closed all round (no sky at the ends).
  const stations = ringStations(lite);
  const profile = standProfile();
  const bowl = new Mesher(THREE);
  const emissive = new Mesher(THREE);
  const glowPoints: { p: V; size: [number, number]; color: string }[] = [];
  const [home, away] = opts.kits;
  const seatColor = (side: Station['side']) => side === 'e' ? away.shirt : side === 'c' ? '#3a4654' : home.shirt;
  const colors: Record<Exclude<Kind, 'tread'>, string> = { wall: '#18232d', riser: '#232a31', aisle: '#545d66', glass: '#0b1722', back: '#20272f', roofUnder: '#2c343d', roofFront: '#141a21', roofTop: '#56606a' };
  for (let k = 0; k < stations.length; k++) {
    const s0 = stations[k]!, s1 = stations[(k + 1) % stations.length]!;
    const gangway = s0.side !== 'c' && k % 6 === 3;
    for (let i = 0; i < profile.kinds.length; i++) {
      const kind = profile.kinds[i]!, a = profile.points[i]!, b = profile.points[i + 1]!;
      if (kind === 'tread') {
        const row = profile.rows.find((r) => Math.abs(r.d - (a.d + 0.42)) < 0.01 && Math.abs(r.y - a.y) < 0.01);
        if (gangway) bowl.setColor('#5d666f');
        else bowl.setColor(seatColor(s0.side), (row?.index ?? 0) % 2 ? 0.78 : 0.95);
      } else bowl.setColor(colors[kind]);
      const dd = b.d - a.d, dy = b.y - a.y;
      const nx = (s0.nx + s1.nx) / 2, nz = (s0.nz + s1.nz) / 2;
      const facing: V = [nx * -dy, dd, nz * -dy];
      bowl.quad(at(s0, a.d, a.y), at(s1, a.d, a.y), at(s1, b.d, b.y), at(s0, b.d, b.y), facing);
    }
    if (k % 3 !== 2) {
      emissive.setColor('#ffd9a3', s0.side === 'c' ? 0.55 : 1);
      const d = profile.glass.d - 0.04;
      emissive.quad(at(s0, d, profile.glass.y0 + 0.7), at(s1, d, profile.glass.y0 + 0.7), at(s1, d, profile.glass.y1 - 0.5), at(s0, d, profile.glass.y1 - 0.5), [-s0.nx, 0, -s0.nz]);
    }
    if ((s0.side === 'n' || s0.side === 's') && k % 2 === 0) {
      const p = at(s0, 0.6, 24.6);
      emissive.setColor('#e9f4ff');
      emissive.box(p, [1.6, 0.25, 0.5], Math.atan2(s0.nx, s0.nz));
      glowPoints.push({ p: [p[0] - s0.nx * 0.6, p[1] - 0.4, p[2] - s0.nz * 0.6], size: [3.2, 3.2], color: '#dcefff' });
    }
  }

  // Floodlight towers behind the four corners.
  const towerObject = new THREE.Object3D();
  const towerHeight = 50;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const base: V = [sx * (HL + STAND - CORNER + (CORNER + profile.back + 6) * 0.707), 0, sz * (HW + STAND - CORNER + (CORNER + profile.back + 6) * 0.707)];
    bowl.setColor('#7f8a95');
    const mast = new THREE.CylinderGeometry(0.45, 0.95, towerHeight, 6, 1, true);
    bowl.add(mast, new THREE.Matrix4().makeTranslation(base[0], towerHeight / 2, base[2]));
    towerObject.position.set(base[0], towerHeight + 2, base[2]);
    towerObject.lookAt(0, 0, 0);
    towerObject.updateMatrix();
    bowl.setColor('#2b333b');
    bowl.add(new THREE.BoxGeometry(9, 5.2, 0.8), towerObject.matrix);
    const lamp = new THREE.Vector3();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const local = new THREE.Matrix4().makeTranslation(-3.6 + c * 1.8, -1.6 + r * 1.6, 0.42);
      emissive.setColor('#f6fbff');
      emissive.add(new THREE.PlaneGeometry(1.35, 1.1), towerObject.matrix.clone().multiply(local));
      lamp.set(-3.6 + c * 1.8, -1.6 + r * 1.6, 1.2).applyMatrix4(towerObject.matrix);
      glowPoints.push({ p: [lamp.x, lamp.y, lamp.z], size: [3.6, 3.6], color: '#eef7ff' });
    }
    lamp.set(0, 0, 2.5).applyMatrix4(towerObject.matrix);
    glowPoints.push({ p: [lamp.x, lamp.y, lamp.z], size: [26, 26], color: '#9fc6ff' });
    glowPoints.push({ p: [lamp.x, lamp.y, lamp.z], size: [44, 3.2], color: '#b9d6ff' });
  }

  // LED ad boards: faces in one textured mesh, bodies baked into the bowl.
  const ads = adTexture(THREE);
  owned.push(ads);
  const boards = new Mesher(THREE, true);
  boards.setColor('#ffffff');
  const boardRuns: { a: [number, number]; b: [number, number]; n: [number, number] }[] = [
    { a: [BOARD_X, BOARD_Z], b: [-BOARD_X, BOARD_Z], n: [0, 1] },
    { a: [-BOARD_X, -BOARD_Z], b: [BOARD_X, -BOARD_Z], n: [0, -1] },
    { a: [BOARD_X, -BOARD_Z], b: [BOARD_X, BOARD_Z], n: [1, 0] },
    { a: [-BOARD_X, BOARD_Z], b: [-BOARD_X, -BOARD_Z], n: [-1, 0] },
  ];
  let u = 0;
  for (const run of boardRuns) {
    const length = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
    const u1 = u + length / BOARD_METERS;
    const tilt = 0.14;
    const A0: V = [run.a[0], 0.06, run.a[1]], B0: V = [run.b[0], 0.06, run.b[1]];
    const A1: V = [run.a[0] + run.n[0] * tilt, 0.98, run.a[1] + run.n[1] * tilt], B1: V = [run.b[0] + run.n[0] * tilt, 0.98, run.b[1] + run.n[1] * tilt];
    boards.quad(A0, B0, B1, A1, [-run.n[0], 0.15, -run.n[1]], [[u, 0], [u1, 0], [u1, 1], [u, 1]]);
    u = u1;
    bowl.setColor('#0d141b');
    const mx = (run.a[0] + run.b[0]) / 2 + run.n[0] * 0.24, mz = (run.a[1] + run.b[1]) / 2 + run.n[1] * 0.24;
    bowl.box([mx, 0.52, mz], run.n[0] ? [0.3, 1.04, length] : [length, 1.04, 0.3]);
  }
  const boardMaterial = new THREE.MeshBasicMaterial({ map: ads, toneMapped: false, color: '#ffffff' });
  const boardMesh = new THREE.Mesh(boards.geometry(), boardMaterial);
  root.add(boardMesh);

  // Dugouts on the far touchline: frame and benches in the bowl, perspex canopies in one mesh.
  const glass = new Mesher(THREE);
  glass.setColor('#bcd5e0');
  for (const [x, club] of [[-11, home], [11, away]] as const) {
    const z = HW + 3.1;
    bowl.setColor('#1a242e'); bowl.box([x, 0.08, z], [5.4, 0.16, 2]);
    bowl.box([x, 0.9, z + 0.95], [5.4, 1.8, 0.12]);
    bowl.setColor(club.shirt); bowl.box([x, 0.45, z + 0.45], [5, 0.12, 0.5]);
    bowl.box([x, 0.85, z + 0.78], [5, 0.7, 0.08]);
    const shell = new THREE.CylinderGeometry(1.55, 1.55, 5.4, 10, 1, true, 0, Math.PI * 0.62);
    glass.add(shell, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationX(-0.2)).premultiply(new THREE.Matrix4().makeTranslation(x, 0.25, z + 0.9)));
  }
  const glassMesh = new THREE.Mesh(glass.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.28, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  root.add(glassMesh);

  const bowlMesh = new THREE.Mesh(bowl.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.04 }));
  bowlMesh.receiveShadow = !lite;
  root.add(bowlMesh);
  const emissiveMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const emissiveMesh = new THREE.Mesh(emissive.geometry(), emissiveMaterial);
  root.add(emissiveMesh);

  // Floodlight glow: camera-facing quads in one additive draw.
  const glowGeometry = new THREE.BufferGeometry();
  {
    const pos: number[] = [], corner: number[] = [], size: number[] = [], color: number[] = [], index: number[] = [];
    const c = new THREE.Color();
    glowPoints.forEach((g, i) => {
      c.set(g.color);
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(...g.p); corner.push(cx!, cy!); size.push(...g.size); color.push(c.r, c.g, c.b); }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    glowGeometry.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
    glowGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
    glowGeometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    glowGeometry.setIndex(index);
  }
  const glowUniforms = { uIntensity: { value: 1 } };
  const glowMaterial = shaderMaterial(THREE, {
    uniforms: glowUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: /* glsl */`
attribute vec2 aCorner; attribute vec2 aSize;
varying vec2 vUv; varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += aCorner * aSize * 0.5;
  mv.z += min(aSize.x, aSize.y) * 0.5;
  vUv = aCorner; vColor = color;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */`
uniform float uIntensity;
varying vec2 vUv; varying vec3 vColor;
void main() {
  float r2 = dot(vUv, vUv);
  float a = exp(-r2 * 14.0) + exp(-r2 * 3.2) * 0.32;
  a *= 1.0 - smoothstep(0.7, 1.0, r2);
  gl_FragColor = vec4(vColor, a * uIntensity);
  #include <colorspace_fragment>
}`,
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.frustumCulled = false; glowMesh.renderOrder = 5;
  root.add(glowMesh);

  // Goal frames and corner-flag poles share one white mesh; both nets share one deforming mesh.
  const white = new Mesher(THREE);
  white.setColor('#f6f6ef');
  const up = new THREE.Vector3(0, 1, 0);
  const rod = (from: V, to: V, radius: number) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()), new THREE.Vector3(1, 1, 1));
    white.add(new THREE.CylinderGeometry(radius, radius, dir.length(), lite ? 6 : 10, 1, true), m);
  };
  const hw = FIELD.goalWidth / 2, gh = FIELD.goalHeight, topDepth = 1.0, bottomDepth = 2.1;
  const net = { pos: [] as number[], nor: [] as number[], grid: [] as number[], pin: [] as number[], index: [] as number[] };
  const grid = (nu: number, nv: number, fn: (u: number, v: number) => [V, [number, number]], normal: V) => {
    const start = net.pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const [p, g] = fn(i / nu, j / nv);
      net.pos.push(...p); net.nor.push(...normal); net.grid.push(...g);
      net.pin.push(Math.sin(Math.PI * i / nu) * Math.sin(Math.PI * j / nv));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = start + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      net.index.push(a, b, d, a, d, c);
    }
  };
  const detail = lite ? 0.6 : 1;
  for (const s of [-1, 1]) {
    const x0 = s * (HL + 0.06);
    rod([x0, 0, -hw], [x0, gh, -hw], 0.06); rod([x0, 0, hw], [x0, gh, hw], 0.06);
    rod([x0, gh, -hw - 0.06], [x0, gh, hw + 0.06], 0.06);
    for (const z of [-hw, hw]) {
      rod([x0, gh, z], [x0 + s * topDepth, gh, z], 0.025);
      rod([x0 + s * topDepth, gh, z], [x0 + s * bottomDepth, 0, z], 0.03);
      rod([x0, 0.02, z], [x0 + s * bottomDepth, 0.02, z], 0.025);
    }
    rod([x0 + s * topDepth, gh, -hw], [x0 + s * topDepth, gh, hw], 0.025);
    rod([x0 + s * bottomDepth, 0.02, -hw], [x0 + s * bottomDepth, 0.02, hw], 0.025);
    const nu = Math.round(16 * detail), nv = Math.max(3, Math.round(6 * detail));
    grid(nu, Math.max(2, Math.round(3 * detail)), (u, v) => [[x0 + s * topDepth * v, gh, -hw + u * hw * 2], [u * hw * 2, v * topDepth]], [0, 1, 0]);
    const backLen = Math.hypot(bottomDepth - topDepth, gh);
    grid(nu, nv, (u, v) => [[x0 + s * (topDepth + (bottomDepth - topDepth) * v), gh * (1 - v), -hw + u * hw * 2], [u * hw * 2, v * backLen]], [s * gh / backLen, (bottomDepth - topDepth) / backLen, 0]);
    for (const z of [-hw, hw]) {
      grid(Math.max(3, Math.round(5 * detail)), nv, (u, v) => {
        const y = gh * (1 - v), depth = topDepth + (bottomDepth - topDepth) * v;
        return [[x0 + s * depth * u, y, z], [depth * u, y]];
      }, [0, 0, Math.sign(z)]);
    }
  }
  const flagCloth = { pos: [] as number[], col: [] as number[], wave: [] as number[], index: [] as number[] };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * HL, pz = sz * HW;
    rod([px, 0, pz], [px, 1.5, pz], 0.022);
    const color = new THREE.Color(sx * sz > 0 ? '#f2d13a' : '#e8483c');
    const start = flagCloth.pos.length / 3, nu = 6, nv = 3, dir = -sx, phase = (sx + 2) * 1.7 + sz;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      flagCloth.pos.push(px + dir * 0.45 * i / nu, 1.16 + 0.32 * j / nv, pz);
      flagCloth.col.push(color.r, color.g, color.b);
      flagCloth.wave.push(i / nu, phase);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = start + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      flagCloth.index.push(a, b, d, a, d, c);
    }
  }
  const frameMesh = new THREE.Mesh(white.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1 }));
  frameMesh.castShadow = true;
  root.add(frameMesh);

  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(net.pos, 3));
  netGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(net.nor, 3));
  netGeometry.setAttribute('aGrid', new THREE.Float32BufferAttribute(net.grid, 2));
  netGeometry.setAttribute('aPin', new THREE.Float32BufferAttribute(net.pin, 1));
  netGeometry.setIndex(net.index);
  const netUniforms = { uBall: { value: new THREE.Vector3(0, -50, 0) }, uImpact: { value: 0 }, uRipple: { value: 0 }, uTime: time, uWind: { value: 0.4 }, uLight: { value: 1 }, ...fogUniforms };
  const netMaterial = shaderMaterial(THREE, {
    uniforms: netUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
attribute vec2 aGrid; attribute float aPin;
uniform vec3 uBall; uniform float uImpact, uRipple, uTime, uWind;
${vertexFog}
varying vec2 vGrid; varying float vShade;
void main() {
  vec3 p = position;
  float d = distance(p, uBall);
  float bulge = exp(-d * d * 1.4) * uImpact * 0.55;
  float ripple = sin(uTime * 15.0 - d * 4.0) * exp(-d * 0.55) * uRipple * 0.09;
  float sway = sin(uTime * 1.7 + p.z * 0.9 + p.y * 1.3) * 0.03 * uWind;
  p += normal * (bulge + ripple + sway) * aPin;
  vGrid = aGrid;
  vShade = 0.78 + 0.22 * normal.y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFogF = smoothstep(uFog.x, uFog.y, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */`
uniform float uLight;
${vertexFog}
varying vec2 vGrid; varying float vShade;
void main() {
  vec2 g = vGrid / 0.13;
  vec2 fw = max(fwidth(g), vec2(1e-4));
  vec2 dist = (0.5 - abs(fract(g) - 0.5)) / fw;
  float line = 1.0 - clamp(min(dist.x, dist.y) - 0.35, 0.0, 1.0);
  float alpha = mix(line * 0.9, 0.26, smoothstep(0.3, 0.85, max(fw.x, fw.y)));
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(mix(vec3(0.9, 0.93, 0.92) * vShade * uLight, uFogColor, vFogF), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const netMesh = new THREE.Mesh(netGeometry, netMaterial);
  netMesh.renderOrder = 2;
  root.add(netMesh);

  const flagGeometry = new THREE.BufferGeometry();
  flagGeometry.setAttribute('position', new THREE.Float32BufferAttribute(flagCloth.pos, 3));
  flagGeometry.setAttribute('color', new THREE.Float32BufferAttribute(flagCloth.col, 3));
  flagGeometry.setAttribute('aWave', new THREE.Float32BufferAttribute(flagCloth.wave, 2));
  flagGeometry.setIndex(flagCloth.index);
  const flagMaterial = shaderMaterial(THREE, {
    uniforms: { uTime: time, uWind: netUniforms.uWind, uLight: netUniforms.uLight, ...fogUniforms }, side: THREE.DoubleSide, vertexColors: true,
    vertexShader: /* glsl */`
attribute vec2 aWave;
uniform float uTime, uWind;
${vertexFog}
varying vec3 vColor; varying float vShade;
void main() {
  vec3 p = position;
  float u = aWave.x;
  float w = sin(uTime * (4.5 + uWind * 2.0) - u * 5.0 + aWave.y) * (0.05 + 0.05 * uWind) * u;
  p.z += w; p.y -= u * u * 0.06 * (1.2 - min(uWind, 1.0));
  vShade = 0.8 + 3.0 * w;
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFogF = smoothstep(uFog.x, uFog.y, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */`
uniform float uLight;
${vertexFog}
varying vec3 vColor; varying float vShade;
void main() {
  gl_FragColor = vec4(mix(vColor * clamp(vShade, 0.55, 1.1) * uLight, uFogColor, vFogF), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  root.add(new THREE.Mesh(flagGeometry, flagMaterial));

  // Crowd: one instanced draw, animated on the GPU, fans grouped by club.
  const person = new Mesher(THREE, false, true);
  person.part = 0;
  {
    const b = 0.38, t = 0.98, wb = 0.2, wt = 0.23, db = 0.12, dt2 = 0.12;
    const c: V[] = [[-wb, b, -db], [wb, b, -db], [wt, t, -dt2], [-wt, t, -dt2], [-wb, b, db], [wb, b, db], [wt, t, dt2], [-wt, t, dt2]];
    person.quad(c[4]!, c[5]!, c[6]!, c[7]!, [0, 0, 1]);
    person.quad(c[0]!, c[1]!, c[2]!, c[3]!, [0, 0, -1]);
    person.quad(c[0]!, c[4]!, c[7]!, c[3]!, [-1, 0, 0]);
    person.quad(c[1]!, c[5]!, c[6]!, c[2]!, [1, 0, 0]);
    person.quad(c[3]!, c[2]!, c[6]!, c[7]!, [0, 1, 0]);
    person.part = 3;
    const hy = 1.12, r = 0.115;
    const top: V = [0, hy + r * 1.1, 0], bottom: V = [0, hy - r, 0];
    const ring: V[] = [[r, hy, 0], [0, hy, r], [-r, hy, 0], [0, hy, -r]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i]!, n = ring[(i + 1) % 4]!;
      person.quad(a, n, top, top, [a[0] + n[0], 0.6, a[2] + n[2]]);
      person.quad(n, a, bottom, bottom, [a[0] + n[0], -0.6, a[2] + n[2]]);
    }
    for (const side of [-1, 1]) {
      const x = side * 0.27;
      person.part = 1;
      const s0: V = [x - 0.045, 0.94, 0.02], s1: V = [x + 0.045, 0.94, 0.02];
      person.part = 2;
      const t0: V = [x - 0.04, 0.48, 0.05], t1: V = [x + 0.04, 0.48, 0.05];
      // Shoulder vertices keep part 1, the hand end (part 2) lifts when fans cheer.
      const before = person.extra.length;
      person.quad(s0, s1, t1, t0, [0, 0, 1]);
      const order = person.extra.length - before === 6 ? [s0, s1, t1, s0, t1, t0] : [];
      void order;
      for (let i = before; i < person.extra.length; i++) person.extra[i] = person.pos[i * 3 + 1]! > 0.7 ? 1 : 2;
    }
  }
  const personGeometry = person.geometry();
  const seats: { p: V; yaw: number; side: Station['side']; key: number; tier: number }[] = [];
  let seed = 51721;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sideWeight: Record<Station['side'], number> = { n: 3, e: 2.2, w: 2.2, s: 1.3, c: 1 };
  for (const row of profile.rows) {
    if (lite && (row.tier > 0 || row.index > 9)) continue;
    for (let k = 0; k < stations.length; k++) {
      const s0 = stations[k]!, s1 = stations[(k + 1) % stations.length]!;
      if (s0.side !== 'c' && k % 6 === 3) continue;
      if (lite && s0.side === 's') continue;
      const a = at(s0, row.d, row.y), b = at(s1, row.d, row.y);
      const count = Math.floor(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.6);
      const nx = (s0.nx + s1.nx) / 2, nz = (s0.nz + s1.nz) / 2;
      const weight = sideWeight[s0.side] * (row.tier ? 0.5 : 1.25 - row.index * 0.03);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5 + (random() - 0.5) * 0.2) / count;
        seats.push({ p: [a[0] + (b[0] - a[0]) * t, row.y, a[2] + (b[2] - a[2]) * t], yaw: Math.atan2(-nx, -nz) + (random() - 0.5) * 0.3, side: s0.side, key: Math.pow(random(), 1 / weight), tier: row.tier });
      }
    }
  }
  seats.sort((x, y) => y.key - x.key);
  const crowdTotal = Math.min(seats.length, lite ? 1400 : 3800);
  const fanAttr = new Float32Array(crowdTotal * 2);
  const crowdUniforms = { uTime: time, uRoar: { value: new THREE.Vector2() }, uLight: { value: new THREE.Color('#ffffff') }, ...fogUniforms };
  const crowdMaterial = shaderMaterial(THREE, {
    uniforms: crowdUniforms, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
attribute vec2 aFan; attribute float aPart;
uniform float uTime; uniform vec2 uRoar; uniform vec3 uLight;
${vertexFog}
varying vec3 vColor;
void main() {
  vec3 p = position;
  float roar = aFan.x < 0.25 ? uRoar.x : aFan.x > 0.75 ? uRoar.y : (uRoar.x + uRoar.y) * 0.3;
  float cheer = clamp(roar, 0.0, 1.0);
  float gutted = clamp(-roar, 0.0, 1.0);
  float ph = aFan.y * 6.2831;
  float bounce = max(0.0, sin(uTime * (7.5 + aFan.y * 4.0) + ph * 5.0));
  float raise = aPart > 1.5 && aPart < 2.5 ? cheer * (0.8 + 0.2 * sin(uTime * 9.0 + ph * 3.0)) : 0.0;
  p.y += raise * 1.0;
  p.x += sign(p.x) * raise * 0.06;
  p.y += sin(uTime * 1.6 + ph) * 0.015 + cheer * (0.2 + bounce * 0.26) - gutted * 0.08;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vec3 skin = mix(vec3(0.33, 0.17, 0.09), vec3(0.85, 0.6, 0.45), fract(aFan.y * 7.31));
  vec3 base = aPart > 2.5 ? skin : instanceColor * (aPart > 0.5 ? 0.85 : 1.0);
  vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vColor = base * uLight * (0.62 + 0.38 * clamp(n.y * 0.5 + 0.55, 0.0, 1.0));
  vFogF = smoothstep(uFog.x, uFog.y, -mv.z);
}`,
    fragmentShader: /* glsl */`
${vertexFog}
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(mix(vColor, uFogColor, vFogF), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const crowd = new THREE.InstancedMesh(personGeometry, crowdMaterial, Math.max(1, crowdTotal));
  {
    const o = new THREE.Object3D(), c = new THREE.Color();
    const palettes = [home, away].map((k) => [k.shirt, k.shirt, k.shirt, k.trim, k.shorts, k.shirt].map((s) => new THREE.Color(s)));
    const neutral = ['#2a2f3a', '#4d5563', '#c9ccd1', '#3d5a80', '#6b4f3a', '#1f3b2d', '#8a8f96'].map((s) => new THREE.Color(s));
    for (let i = 0; i < crowdTotal; i++) {
      const seat = seats[i]!;
      const r = random();
      const team = seat.side === 'w' ? (r < 0.85 ? 0 : 0.5) : seat.side === 'e' ? (r < 0.82 ? 1 : 0.5) : seat.side === 'c' ? (r < 0.3 ? 0 : r < 0.5 ? 1 : 0.5) : seat.side === 's' ? (r < 0.65 ? 0 : r < 0.8 ? 1 : 0.5) : (r < 0.55 ? 0 : r < 0.8 ? 1 : 0.5);
      const palette = team === 0.5 ? neutral : palettes[team]!;
      c.copy(palette[Math.floor(random() * palette.length)]!).multiplyScalar(0.85 + random() * 0.3);
      o.position.set(...seat.p);
      o.rotation.set(0, seat.yaw, 0);
      const scale = 0.9 + random() * 0.2;
      o.scale.set(scale, 0.9 + random() * 0.2, scale);
      o.updateMatrix();
      crowd.setMatrixAt(i, o.matrix);
      crowd.setColorAt(i, c);
      fanAttr[i * 2] = team; fanAttr[i * 2 + 1] = random();
    }
    void clubSide;
  }
  personGeometry.setAttribute('aFan', new THREE.InstancedBufferAttribute(fanAttr, 2));
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.count = crowdTotal;
  crowd.frustumCulled = false;
  root.add(crowd);

  // Rain: streaks wrapped in a box that follows the camera, moved entirely on the GPU.
  const rainCount = lite ? 900 : 2600;
  const rainPos = new Float32Array(rainCount * 6), rainEnd = new Float32Array(rainCount * 2);
  for (let i = 0; i < rainCount; i++) {
    const x = random(), y = random(), z = random();
    rainPos.set([x, y, z, x, y, z], i * 6);
    rainEnd[i * 2 + 1] = 1;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rainGeometry.setAttribute('aEnd', new THREE.BufferAttribute(rainEnd, 1));
  const rainUniforms = { uTime: time, uCenter: { value: new THREE.Vector3() }, uAmount: { value: 0 } };
  const rain = new THREE.LineSegments(rainGeometry, shaderMaterial(THREE, {
    uniforms: rainUniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
attribute float aEnd;
uniform float uTime; uniform vec3 uCenter;
varying float vEnd;
void main() {
  vec3 box = vec3(70.0, 32.0, 70.0);
  vec3 q = position;
  q.y = fract(q.y - uTime * (0.38 + fract(q.x * 91.7) * 0.12));
  vec3 w = uCenter + (q - 0.5) * box;
  w += vec3(0.18, 0.95, 0.06) * aEnd * 0.8;
  vEnd = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`,
    fragmentShader: /* glsl */`
uniform float uAmount;
varying float vEnd;
void main() {
  gl_FragColor = vec4(vec3(0.78, 0.84, 0.92), (0.1 + vEnd * 0.22) * uAmount);
  #include <colorspace_fragment>
}`,
  }));
  rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 6;
  root.add(rain);

  let current: Preset = PRESETS[opts.conditions];
  let impact = 0;
  const fog = new THREE.Fog('#0b1626', 95, 300);
  scene.fog = fog;
  const forward = new THREE.Vector3();

  function setConditions(mode: Conditions) {
    const p = PRESETS[mode] ?? PRESETS.night;
    current = p;
    sky.draw(mode);
    fog.color.set(p.fog); fog.near = p.fogNear; fog.far = p.fogFar;
    fogUniforms.uFogColor.value.set(p.fog); fogUniforms.uFog.value.set(p.fogNear, p.fogFar);
    lights.hemi.color.set(p.hemiSky); lights.hemi.groundColor.set(p.hemiGround); lights.hemi.intensity = p.hemi;
    lights.key.color.set(p.key); lights.key.intensity = p.keyI; lights.key.shadow.intensity = p.shadow;
    lights.renderer.toneMappingExposure = p.exposure;
    pitchUniforms.uGrassA.value.set(p.grassA); pitchUniforms.uGrassB.value.set(p.grassB);
    pitchUniforms.uWet.value = p.wet; pitchUniforms.uStandShadow.value = p.standShadow;
    glowUniforms.uIntensity.value = p.glow;
    emissiveMaterial.color.setScalar(0.35 + p.boxes * 0.65);
    boardMaterial.color.setScalar(p.sunLow ? 0.85 : 1);
    crowdUniforms.uLight.value.set(p.crowd);
    netUniforms.uWind.value = p.wind; netUniforms.uLight.value = p.net;
    rainUniforms.uAmount.value = p.rain; rain.visible = p.rain > 0;
  }
  setConditions(opts.conditions);
  pitchUniforms.uPattern.value = opts.pattern === 'checker' ? 1 : 0;

  return {
    setConditions,
    setPattern(pattern) { pitchUniforms.uPattern.value = pattern === 'checker' ? 1 : 0; },
    sunLow: () => current.sunLow,
    update(frame) {
      time.value = frame.time % 3600;
      ads.offset.x = (frame.time * 0.06) % 1;
      skyMesh.position.copy(frame.camera.position);
      frame.camera.getWorldDirection(forward);
      rainUniforms.uCenter.value.copy(frame.camera.position).addScaledVector(forward, 26);
      impact = frame.ballInNet ? Math.min(1, impact + frame.dt * 6) : Math.max(0, impact - frame.dt * 1.5);
      netUniforms.uBall.value.set(frame.ball.x, frame.ball.y, frame.ball.z);
      const nearGoal = Math.abs(frame.ball.x) > HL - 0.5 && Math.abs(frame.ball.z) < FIELD.goalWidth / 2 + 2.5;
      netUniforms.uImpact.value = nearGoal ? impact : 0;
      netUniforms.uRipple.value = nearGoal ? impact * impact : 0;
      crowdUniforms.uRoar.value.set(frame.roar[0], frame.roar[1]);
    },
    reduceCrowd() { crowd.count = Math.ceil(crowdTotal / 2); },
    crowdCount: () => crowd.count,
    dispose() {
      root.removeFromParent();
      root.traverse((object) => {
        const mesh = object as T.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as T.Material | undefined;
        material?.dispose();
      });
      for (const item of owned) item.dispose();
      if (scene.fog === fog) scene.fog = null;
    },
  };
}
