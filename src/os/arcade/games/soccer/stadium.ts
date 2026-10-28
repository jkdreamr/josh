import type * as T from 'three';
import { FIELD } from './field.ts';
import { BOARD_METERS, adTexture, grassTextures, skyTexture } from './textures.ts';

type Three = typeof import('three');
export type Conditions = 'day' | 'night' | 'golden' | 'overcast' | 'rain';
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
  day: { exposure: 0.92, hemiSky: '#e4edf6', hemiGround: '#46553a', hemi: 1.75, key: '#fff0d8', keyI: 3.1, shadow: 0.62, sunLow: false, fog: '#b3c3d2', fogNear: 140, fogFar: 380, glow: 0.1, boxes: 0.015, crowd: '#bdb6ac', wet: 0, rain: 0, wind: 0.5, grassA: '#3d5a28', grassB: '#354f22', standShadow: 0, net: 1.05 },
  night: { exposure: 1.2, hemiSky: '#bccdf0', hemiGround: '#16241b', hemi: 0.8, key: '#f4f8ff', keyI: 3.5, shadow: 1, sunLow: false, fog: '#0b1626', fogNear: 95, fogFar: 300, glow: 1, boxes: 1, crowd: '#8f9cb0', wet: 0, rain: 0, wind: 0.35, grassA: '#3f9e48', grassB: '#2b7d36', standShadow: 0, net: 0.95 },
  golden: { exposure: 1.08, hemiSky: '#ffe3c0', hemiGround: '#2c2a1a', hemi: 1.6, key: '#ffb06a', keyI: 3.3, shadow: 1, sunLow: true, fog: '#c98a66', fogNear: 110, fogFar: 320, glow: 0.14, boxes: 0.58, crowd: '#e6c7a6', wet: 0, rain: 0, wind: 0.5, grassA: '#4aa24a', grassB: '#337f37', standShadow: 0.55, net: 1 },
  overcast: { exposure: 1.06, hemiSky: '#dfe7ee', hemiGround: '#39432f', hemi: 2.3, key: '#e8eef5', keyI: 1.25, shadow: 0.4, sunLow: false, fog: '#8d9aa6', fogNear: 75, fogFar: 270, glow: 0.4, boxes: 0.74, crowd: '#b4bcc6', wet: 0.15, rain: 0, wind: 0.8, grassA: '#3d9445', grassB: '#2b7636', standShadow: 0, net: 0.9 },
  rain: { exposure: 1.14, hemiSky: '#a6b6c8', hemiGround: '#17221d', hemi: 1.1, key: '#dfe8f5', keyI: 2.7, shadow: 0.75, sunLow: false, fog: '#4d5866', fogNear: 45, fogFar: 210, glow: 0.95, boxes: 0.94, crowd: '#7f8a99', wet: 1, rain: 1, wind: 1.4, grassA: '#358c40', grassB: '#246e31', standShadow: 0, net: 0.8 },
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
  tri(a: V, b: V, c: V, facing?: V) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let order = [0, 1, 2];
    if (facing && nx * facing[0] + ny * facing[1] + nz * facing[2] < 0) { order = [0, 2, 1]; nx = -nx; ny = -ny; nz = -nz; }
    const pts = [a, b, c];
    for (const i of order) this.vertex(pts[i]!, [nx, ny, nz]);
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
  // The main-stand roof sits between the broadcast gantry and the pitch, so it lives in its own meshes.
  const nearBowl = new Mesher(THREE);
  const nearEmissive = new Mesher(THREE);
  const glowPoints: { p: V; size: [number, number]; color: string }[] = [];
  const [home, away] = opts.kits;
  const seatColor = (side: Station['side']) => side === 'e' ? away.shirt : side === 'c' ? '#3a4654' : home.shirt;
  const colors: Record<Exclude<Kind, 'tread'>, string> = { wall: '#18232d', riser: '#232a31', aisle: '#3a424a', glass: '#0b1722', back: '#20272f', roofUnder: '#2c343d', roofFront: '#141a21', roofTop: '#363e47' };
  for (let k = 0; k < stations.length; k++) {
    const s0 = stations[k]!, s1 = stations[(k + 1) % stations.length]!;
    const gangway = s0.side !== 'c' && k % 6 === 3;
    for (let i = 0; i < profile.kinds.length; i++) {
      const kind = profile.kinds[i]!, a = profile.points[i]!, b = profile.points[i + 1]!;
      if (kind === 'tread') {
        const row = profile.rows.find((r) => Math.abs(r.d - (a.d + 0.42)) < 0.01 && Math.abs(r.y - a.y) < 0.01);
        if (gangway) bowl.setColor('#3a424a');
        else bowl.setColor(seatColor(s0.side), (row?.index ?? 0) % 2 ? 0.78 : 0.95);
      } else bowl.setColor(colors[kind]);
      const dd = b.d - a.d, dy = b.y - a.y;
      const nx = (s0.nx + s1.nx) / 2, nz = (s0.nz + s1.nz) / 2;
      const facing: V = [nx * -dy, dd, nz * -dy];
      const target = s0.side === 's' && (kind === 'roofUnder' || kind === 'roofFront' || kind === 'roofTop') ? nearBowl : bowl;
      if (target === nearBowl) nearBowl.setColor(colors[kind as 'roofUnder']);
      target.quad(at(s0, a.d, a.y), at(s1, a.d, a.y), at(s1, b.d, b.y), at(s0, b.d, b.y), facing);
    }
    if (k % 3 !== 2) {
      emissive.setColor('#ffd9a3', s0.side === 'c' ? 0.55 : 1);
      const d = profile.glass.d - 0.04;
      emissive.quad(at(s0, d, profile.glass.y0 + 0.7), at(s1, d, profile.glass.y0 + 0.7), at(s1, d, profile.glass.y1 - 0.5), at(s0, d, profile.glass.y1 - 0.5), [-s0.nx, 0, -s0.nz]);
    }
    if ((s0.side === 'n' || s0.side === 's') && k % 2 === 0) {
      const p = at(s0, 0.6, 24.6);
      const lamps = s0.side === 's' ? nearEmissive : emissive;
      lamps.setColor('#e9f4ff');
      lamps.box(p, [1.6, 0.25, 0.5], Math.atan2(s0.nx, s0.nz));
      if (s0.side === 'n') glowPoints.push({ p: [p[0] - s0.nx * 0.6, p[1] - 0.4, p[2] - s0.nz * 0.6], size: [3.2, 3.2], color: '#dcefff' });
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

  // Dugouts sit on the main-stand touchline under the TV gantry, so they stay out of the broadcast shot.
  const glass = new Mesher(THREE);
  glass.setColor('#bcd5e0');
  for (const [x, club] of [[-11, home], [11, away]] as const) {
    const z = -(HW + 3.1);
    bowl.setColor('#1a242e'); bowl.box([x, 0.08, z], [5.4, 0.16, 2]);
    bowl.box([x, 0.6, z - 0.95], [5.4, 1.2, 0.12]);
    bowl.setColor(club.shirt); bowl.box([x, 0.4, z - 0.45], [5, 0.1, 0.5]);
    bowl.box([x, 0.7, z - 0.78], [5, 0.5, 0.08]);
    const shell = new THREE.CylinderGeometry(1.15, 1.15, 5.4, 10, 1, true, 0, Math.PI * 0.62);
    glass.add(shell, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationX(-0.2)).premultiply(new THREE.Matrix4().makeRotationY(Math.PI)).premultiply(new THREE.Matrix4().makeTranslation(x, 0.1, z - 0.9)));
  }
  const glassMesh = new THREE.Mesh(glass.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.28, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  root.add(glassMesh);

  // Pitchside staff: stewards in hi-vis facing the crowd, photographers crouched beside each goal.
  {
    let staffSeed = 9127;
    const rnd = () => { staffSeed = (Math.imul(staffSeed, 1664525) + 1013904223) >>> 0; return staffSeed / 4294967296; };
    const skins = ['#e2b597', '#c58c68', '#8d5a3c', '#5b3a28', '#f0c9ad'];
    const skin = () => skins[Math.floor(rnd() * skins.length)]!;
    const steward = (x: number, z: number, yaw: number) => {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const off = (f: number, y: number): V => [x + sn * f, y, z + c * f];
      bowl.setColor('#1c222b'); bowl.box(off(0, 0.44), [0.36, 0.88, 0.24], yaw);
      bowl.setColor(rnd() < 0.75 ? '#d9f03a' : '#ff8c24'); bowl.box(off(0, 1.18), [0.48, 0.62, 0.3], yaw);
      bowl.setColor('#e8eef0'); bowl.box(off(0.005, 1.2), [0.5, 0.06, 0.31], yaw);
      bowl.setColor(skin()); bowl.box(off(0, 1.62), [0.2, 0.25, 0.22], yaw);
    };
    const photographer = (x: number, z: number, yaw: number) => {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const off = (f: number, y: number): V => [x + sn * f, y, z + c * f];
      bowl.setColor('#262b33'); bowl.box(off(-0.12, 0.2), [0.42, 0.4, 0.5], yaw);
      bowl.setColor(rnd() < 0.5 ? '#f2f2ee' : '#ff7a2f'); bowl.box(off(0, 0.62), [0.46, 0.5, 0.32], yaw);
      bowl.setColor(skin()); bowl.box(off(0.02, 1.0), [0.2, 0.24, 0.22], yaw);
      bowl.setColor('#0e1013'); bowl.box(off(0.22, 0.95), [0.15, 0.15, 0.22], yaw);
      bowl.setColor('#16191d'); bowl.box(off(0.46, 0.95), [0.11, 0.11, 0.34], yaw);
      bowl.setColor('#20242a'); bowl.box(off(-0.38, 0.12), [0.34, 0.24, 0.4], yaw);
    };
    for (const sz of [-1, 1]) for (let x = -HL + 6 + rnd() * 3; x < HL - 4; x += 11 + rnd() * 4) {
      if (sz > 0 && Math.abs(Math.abs(x) - 11) < 4) continue;
      steward(x, sz * (BOARD_Z + 1.1), sz > 0 ? 0 : Math.PI);
    }
    for (const sx of [-1, 1]) {
      for (let z = -HW + 7 + rnd() * 3; z < HW - 6; z += 10 + rnd() * 4) steward(sx * (BOARD_X + 1.1), z, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (const sz of [-1, 1]) for (let i = 0; i < 6; i++) {
        const z = sz * (FIELD.goalWidth / 2 + 2.2 + i * 1.25 + rnd() * 0.35);
        photographer(sx * (HL + 3.1 + rnd() * 0.5), z, (sx > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.5 - sx * sz * 0.25);
      }
    }
  }

  const bowlMesh = new THREE.Mesh(bowl.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.04 }));
  bowlMesh.receiveShadow = !lite;
  root.add(bowlMesh);
  const emissiveMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const emissiveMesh = new THREE.Mesh(emissive.geometry(), emissiveMaterial);
  root.add(emissiveMesh);
  const nearRoof = new THREE.Group();
  nearRoof.add(new THREE.Mesh(nearBowl.geometry(), bowlMesh.material), new THREE.Mesh(nearEmissive.geometry(), emissiveMaterial));
  root.add(nearRoof);

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
  const hw = FIELD.goalWidth / 2, gh = FIELD.goalHeight, topDepth = 2.0, bottomDepth = 2.25;
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
  float alpha = mix(line * 0.95, 0.4, smoothstep(0.3, 0.85, max(fw.x, fw.y)));
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

  // Crowd: a card per seat row in one draw; each fan is drawn procedurally in the fragment shader.
  let seed = 51721;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Share of away fans per stand: home end, away end, mixed sides and corners.
  const awayShare: Record<Station['side'], number> = { w: 0.1, e: 0.88, n: 0.4, s: 0.35, c: 0.5 };
  const cards = { pos: [] as number[], uv: [] as number[], seat: [] as number[], index: [] as number[] };
  let crowdSeats = 0;
  for (const row of profile.rows) {
    if (lite && (row.tier > 0 || row.index > 9)) continue;
    const h = row.tier ? 1.55 : 1.35;
    for (let k = 0; k < stations.length; k++) {
      const s0 = stations[k]!, s1 = stations[(k + 1) % stations.length]!;
      if (s0.side !== 'c' && k % 6 === 3) continue;
      if (lite && s0.side === 's') continue;
      const d = row.d + 0.1;
      const a0 = at(s0, d, row.y), b0 = at(s1, d, row.y);
      const len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]);
      const start = cards.pos.length / 3;
      cards.pos.push(a0[0], row.y, a0[2], b0[0], row.y, b0[2], b0[0], row.y + h, b0[2], a0[0], row.y + h, a0[2]);
      cards.uv.push(0, 0, len, 0, len, h, 0, h);
      const key = row.tier * 31 + row.index + k * 0.0137 + random() * 0.5;
      for (let i = 0; i < 4; i++) cards.seat.push(awayShare[s0.side], key);
      cards.index.push(start, start + 1, start + 2, start, start + 2, start + 3);
      crowdSeats += Math.floor(len / 0.56);
    }
  }
  const crowdGeometry = new THREE.BufferGeometry();
  crowdGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cards.pos, 3));
  crowdGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(cards.uv, 2));
  crowdGeometry.setAttribute('aSeat', new THREE.Float32BufferAttribute(cards.seat, 2));
  crowdGeometry.setIndex(cards.index);
  const kitColor = (c: string) => new THREE.Color(c);
  const fullDensity = 0.94;
  const crowdUniforms = {
    uTime: time, uRoar: { value: new THREE.Vector2() }, uLight: { value: new THREE.Color('#ffffff') }, uDensity: { value: fullDensity },
    uHome: { value: [kitColor(home.shirt), kitColor(home.trim), kitColor(home.shorts)] },
    uAway: { value: [kitColor(away.shirt), kitColor(away.trim), kitColor(away.shorts)] },
    ...fogUniforms,
  };
  const crowdMaterial = shaderMaterial(THREE, {
    uniforms: crowdUniforms, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
attribute vec2 aSeat;
${vertexFog}
varying vec2 vUv; varying vec2 vSeat; varying float vHeight;
void main() {
  vUv = uv; vSeat = aSeat; vHeight = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogF = smoothstep(uFog.x, uFog.y, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */`
uniform float uTime, uDensity; uniform vec2 uRoar; uniform vec3 uLight; uniform vec3 uHome[3]; uniform vec3 uAway[3];
${vertexFog}
varying vec2 vUv; varying vec2 vSeat; varying float vHeight;
const float CELL = 0.56;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float rbox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
float capsule(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
vec3 pick(vec3 c0, vec3 c1, vec3 c2, float r) { return r < 0.58 ? c0 : r < 0.82 ? c1 : c2; }
void main() {
  float cell = floor(vUv.x / CELL);
  vec2 id = vec2(cell, vSeat.y * 53.17);
  float r0 = hash(id), r1 = hash(id + 17.1), r2 = hash(id + 41.3), r3 = hash(id + 73.9);
  if (r0 > uDensity) discard;
  float away = step(r1, vSeat.x);
  float roar = mix(uRoar.x, uRoar.y, away);
  float cheer = clamp(roar, 0.0, 1.0), gutted = clamp(-roar, 0.0, 1.0);
  float hop = cheer * (0.06 + 0.22 * max(0.0, sin(uTime * (7.0 + r2 * 4.0) + r3 * 40.0)));
  float idle = sin(uTime * (1.1 + r1) + r3 * 30.0) * 0.015;
  float build = 0.9 + r2 * 0.2;
  vec2 p = vec2((fract(vUv.x / CELL) - 0.5) * CELL + (r3 - 0.5) * 0.1, vUv.y - hop - idle + gutted * 0.07 - (r1 - 0.5) * 0.14);
  float torso = rbox(p - vec2(0.0, 0.4), vec2(0.165 * build, 0.38), 0.08);
  float head = length((p - vec2(0.0, 0.93)) * vec2(1.0, 0.88)) - 0.102;
  float lift = cheer * step(0.25, r2);
  float arms = lift > 0.05
    ? min(capsule(p, vec2(-0.15 * build, 0.72), vec2(-0.25, 0.72 + 0.56 * lift), 0.042), capsule(p, vec2(0.15 * build, 0.72), vec2(0.25, 0.72 + 0.56 * lift), 0.042))
    : 1e3;
  float px = max(fwidth(vUv.x), fwidth(vUv.y));
  float body = min(torso, arms);
  // Distant fans are only a few pixels wide: grow them into a dense mass instead of aliased speckle.
  float far = smoothstep(0.045, 0.12, px);
  if (min(body, head) > px * 0.5 + far * 0.12) discard;
  vec3 shirt = away > 0.5 ? pick(uAway[0], uAway[1], uAway[2], r2) : pick(uHome[0], uHome[1], uHome[2], r2);
  float neutral = step(0.55, fract(r3 * 7.13));
  vec3 plain = r1 < 0.3 ? vec3(0.12, 0.13, 0.15) : r1 < 0.55 ? vec3(0.86, 0.86, 0.84) : r1 < 0.8 ? vec3(0.22, 0.3, 0.45) : vec3(0.45, 0.42, 0.38);
  shirt = mix(shirt, plain, neutral) * (0.72 + fract(r0 * 9.7) * 0.3);
  shirt = mix(vec3(dot(shirt, vec3(0.3, 0.55, 0.15))), shirt, 0.78);
  vec3 skin = mix(vec3(0.3, 0.17, 0.1), vec3(0.92, 0.7, 0.56), fract(r0 * 13.7 + r1 * 3.1));
  vec3 hair = mix(vec3(0.06, 0.045, 0.035), vec3(0.42, 0.3, 0.17), step(0.75, fract(r2 * 5.3)));
  vec3 col = shirt;
  if (head < body) col = p.y > 0.95 + (r3 - 0.5) * 0.04 ? hair : skin;
  else if (arms < torso && p.y > 0.86) col = skin;
  col = mix(col, mix(shirt, skin, 0.22 * step(0.82, p.y)), far * 0.6);
  float shade = 0.42 + 0.58 * smoothstep(0.0, 0.8, p.y);
  shade *= 1.0 - 0.18 * smoothstep(0.0, 0.12, abs(p.x) / max(0.1, 0.165 * build) - 0.75);
  // Upper rows sit in the roof's shade.
  shade *= mix(1.0, 0.62, smoothstep(5.0, 22.0, vHeight));
  gl_FragColor = vec4(mix(col * shade * uLight, uFogColor, vFogF), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const crowd = new THREE.Mesh(crowdGeometry, crowdMaterial);
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
    emissiveMaterial.color.setScalar(p.boxes);
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
      nearRoof.visible = frame.camera.position.z > -(HW + STAND);
      frame.camera.getWorldDirection(forward);
      rainUniforms.uCenter.value.copy(frame.camera.position).addScaledVector(forward, 26);
      impact = frame.ballInNet ? Math.min(1, impact + frame.dt * 6) : Math.max(0, impact - frame.dt * 1.5);
      netUniforms.uBall.value.set(frame.ball.x, frame.ball.y, frame.ball.z);
      const nearGoal = Math.abs(frame.ball.x) > HL - 0.5 && Math.abs(frame.ball.z) < FIELD.goalWidth / 2 + 2.5;
      netUniforms.uImpact.value = nearGoal ? impact : 0;
      netUniforms.uRipple.value = nearGoal ? impact * impact : 0;
      crowdUniforms.uRoar.value.set(frame.roar[0], frame.roar[1]);
    },
    reduceCrowd() { crowdUniforms.uDensity.value = fullDensity * 0.55; },
    crowdCount: () => Math.round(crowdSeats * crowdUniforms.uDensity.value),
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
