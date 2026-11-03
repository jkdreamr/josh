// Effects: billboard particles (dust, sparks, splashes, smoke, fire), bullet tracers, bullet holes, grenades in the
// air, smoke clouds, a royale supply crate's column of colored smoke and the weather. Each kind is one instanced draw
// whose buffers are refilled each frame.
import type { Match } from '../match.ts';
import { WEAPONS } from '../weapons.ts';
import type { Surface, World } from '../world.ts';
import { mulberry32 } from '../noise.ts';
import { SUPPLY_SMOKE } from '../royale.ts';
import { ADDITIVE, COMMON, DOUBLE, NORMAL_BLEND, lin, type Shared, type T, type Three } from './common.ts';
import { worldMaterial, type Part } from './models.ts';

const PVERT = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute vec4 iColor;
attribute float iRot;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWp;
varying float vSeed;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iRot);
  float s = sin(iRot);
  mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize;
  vUv = position.xy;
  vColor = iColor;
  vWp = iPos;
  vSeed = fract(iRot * 3.17);
  gl_Position = projectionMatrix * mv;
}
`;
const PFRAG_ALPHA = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWp;
varying float vSeed;
void main() {
  float d = length(vUv);
  float n = dzNoise(vUv * 2.6 + vSeed * 17.0) * 0.6 + dzNoise(vUv * 5.3 - vSeed * 9.0) * 0.4;
  float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.55) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(dzFog(vColor.rgb * (0.85 + 0.3 * n), vWp), a);
}
`;
const PFRAG_ADD = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWp;
varying float vSeed;
void main() {
  float d = length(vUv);
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
}
`;

class Particles {
  max: number;
  n = 0;
  d: Float32Array;
  static F = 18;
  mesh: T.Mesh;
  pos: T.InstancedBufferAttribute;
  size: T.InstancedBufferAttribute;
  color: T.InstancedBufferAttribute;
  rot: T.InstancedBufferAttribute;
  geo: T.InstancedBufferGeometry;
  constructor(THREE: Three, shared: Shared, max: number, additive: boolean) {
    this.max = max;
    this.d = new Float32Array(max * Particles.F);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.rot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.pos, this.size, this.color, this.rot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.pos);
    g.setAttribute('iSize', this.size);
    g.setAttribute('iColor', this.color);
    g.setAttribute('iRot', this.rot);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: PVERT,
      fragmentShader: additive ? PFRAG_ADD : PFRAG_ALPHA,
      transparent: true,
      depthWrite: false,
      blending: additive ? ADDITIVE : NORMAL_BLEND,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
  }
  /** pos, vel, life, size from/to, rgb, alpha, gravity, drag */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number, grav = 0, drag = 0) {
    if (this.n >= this.max) return;
    const o = this.n++ * Particles.F;
    const d = this.d;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = vx;
    d[o + 4] = vy;
    d[o + 5] = vz;
    d[o + 6] = 0;
    d[o + 7] = life;
    d[o + 8] = s0;
    d[o + 9] = s1;
    d[o + 10] = r;
    d[o + 11] = g;
    d[o + 12] = b;
    d[o + 13] = a;
    d[o + 14] = Math.random() * 6.28;
    d[o + 15] = (Math.random() - 0.5) * 1.2;
    d[o + 16] = grav;
    d[o + 17] = drag;
  }
  update(dt: number) {
    const d = this.d;
    const F = Particles.F;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * F;
      d[o + 6] += dt;
      if (d[o + 6] >= d[o + 7]) continue;
      const k = Math.exp(-d[o + 17] * dt);
      d[o + 3] *= k;
      d[o + 5] *= k;
      d[o + 4] = d[o + 4] * k - d[o + 16] * dt;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += d[o + 5] * dt;
      d[o + 14] += d[o + 15] * dt;
      if (w !== i) d.copyWithin(w * F, o, o + F);
      w++;
    }
    this.n = w;
    const P = this.pos.array as Float32Array;
    const S = this.size.array as Float32Array;
    const C = this.color.array as Float32Array;
    const R = this.rot.array as Float32Array;
    for (let i = 0; i < w; i++) {
      const o = i * F;
      const t = d[o + 6] / d[o + 7];
      P[i * 3] = d[o];
      P[i * 3 + 1] = d[o + 1];
      P[i * 3 + 2] = d[o + 2];
      S[i] = d[o + 8] + (d[o + 9] - d[o + 8]) * Math.sqrt(t);
      C[i * 4] = d[o + 10];
      C[i * 4 + 1] = d[o + 11];
      C[i * 4 + 2] = d[o + 12];
      C[i * 4 + 3] = d[o + 13] * (1 - t) * Math.min(1, t * 12 + 0.2);
      R[i] = d[o + 14];
    }
    this.geo.instanceCount = w;
    for (const a of [this.pos, this.size, this.color, this.rot]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, w * a.itemSize);
      a.needsUpdate = true;
    }
  }
  clear() {
    this.n = 0;
  }
}

const TVERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iC;
attribute float iW;
varying vec2 vUv;
varying vec4 vC;
varying float vFade;
void main() {
  vec3 p = mix(iA, iB, position.x);
  vec3 toCam = p - cameraPosition;
  // (a line seen end on, or of no length, has no side: it collapses to nothing rather than to NaN, which some GPUs
  // draw as black streaks that the bloom then smears)
  vec3 c = cross(iB - iA, toCam);
  float l = length(c);
  vec3 side = l > 1e-6 ? c / l : vec3(0.0);
  float d = length(toCam);
  p += side * position.y * iW * (0.6 + d * 0.004);
  vUv = position.xy;
  vC = iC;
  // never right in front of the eye
  vFade = smoothstep(2.0, 6.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const TFRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vC;
varying float vFade;
void main() {
  float a = clamp((1.0 - abs(vUv.y)) * smoothstep(0.0, 0.6, vUv.x) * vFade, 0.0, 1.0);
  gl_FragColor = vec4(max(vC.rgb * a * vC.a, vec3(0.0)), 1.0);
}
`;

const DVERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWp;
void main() {
  vUv = uv - 0.5;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const DFRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWp;
void main() {
  float d = length(vUv) * 2.0;
  float a = smoothstep(1.0, 0.55, d) * 0.85 + smoothstep(0.45, 0.2, d) * 0.15;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.03, 0.025, 0.02, a);
}
`;

const WVERT = /* glsl */ `
uniform float uTime;
uniform float uBox;
uniform float uFall;
uniform float uSize;
uniform float uScale;
attribute vec4 aSeed;
varying float vA;
void main() {
  vec3 p = aSeed.xyz * uBox;
  p.y -= uTime * uFall * (0.7 + aSeed.w * 0.6);
  p.x += sin(uTime * 0.6 + aSeed.w * 30.0) * 1.2 + uTime * 0.8;
  p.z += cos(uTime * 0.5 + aSeed.w * 20.0) * 1.2;
  vec3 c = cameraPosition - vec3(uBox * 0.5);
  p = c + mod(p - c, uBox);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vA = smoothstep(uBox * 0.5, uBox * 0.25, d) * smoothstep(0.3, 1.5, d);
  gl_PointSize = uSize * uScale * (0.6 + aSeed.w * 0.8) / max(d, 0.5);
  gl_Position = projectionMatrix * mv;
}
`;
const WFRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/** What a hit on each surface throws up: puff color, debris color, sparks? */
const SURF: Record<Surface, [number, number, boolean]> = {
  dirt: [0x8a7258, 0x5a4a3a, false],
  sand: [0xd8c098, 0xb09a70, false],
  snow: [0xf4f8ff, 0xe8eef8, false],
  stone: [0xb0aaa0, 0x6a6660, true],
  wood: [0x9a7a56, 0x6a4a2a, false],
  metal: [0x9a9a9a, 0x505050, true],
  leaf: [0x6a8a4a, 0x4a6a2a, false],
  water: [0xdfeaf2, 0xcfe0ea, false],
};

export type Fx = {
  group: T.Group;
  update(m: Match, dt: number, camera: T.Camera, muzzleOf: (id: number, out: T.Vector3) => T.Vector3, you: number): void;
  setWeather(scale: number): void;
  clear(): void;
  /** How deep in smoke a point is, 0 to 1 (for the screen). */
  smokeAt(x: number, y: number, z: number, m: Match): number;
};

export function effects(THREE: Three, w: World, shared: Shared, sunVisAt: (x: number, z: number) => number, frags: (Part | null)[] = []): Fx {
  const group = new THREE.Group();
  const alpha = new Particles(THREE, shared, 2200, false);
  const add = new Particles(THREE, shared, 900, true);
  group.add(alpha.mesh, add.mesh);
  const sunC = shared.uSunColor.value as T.Color;
  const amb = shared.uAmbient.value as T.Color;
  /** A lit tint for alpha particles (they are not lit per pixel). */
  const litRGB = (hex: number, x: number, z: number, out: number[]) => {
    const c = lin(hex);
    const s = sunVisAt(x, z) * 0.32;
    out[0] = c[0] * (sunC.r * s + amb.r);
    out[1] = c[1] * (sunC.g * s + amb.g);
    out[2] = c[2] * (sunC.b * s + amb.b);
    return out;
  };
  const rgb = [0, 0, 0];

  // tracers
  const TMAX = 96;
  const tg = new THREE.InstancedBufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  tg.setIndex([0, 1, 2, 0, 2, 3]);
  const tA = new THREE.InstancedBufferAttribute(new Float32Array(TMAX * 3), 3);
  const tB = new THREE.InstancedBufferAttribute(new Float32Array(TMAX * 3), 3);
  const tC = new THREE.InstancedBufferAttribute(new Float32Array(TMAX * 4), 4);
  const tW = new THREE.InstancedBufferAttribute(new Float32Array(TMAX), 1);
  for (const a of [tA, tB, tC, tW]) a.setUsage(THREE.DynamicDrawUsage);
  tg.setAttribute('iA', tA);
  tg.setAttribute('iB', tB);
  tg.setAttribute('iC', tC);
  tg.setAttribute('iW', tW);
  tg.instanceCount = 0;
  tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const tracers = new THREE.Mesh(tg, new THREE.ShaderMaterial({ vertexShader: TVERT, fragmentShader: TFRAG, transparent: true, depthWrite: false, blending: ADDITIVE, side: DOUBLE }));
  tracers.frustumCulled = false;
  tracers.renderOrder = 7;
  group.add(tracers);
  const origins = new WeakMap<object, [number, number, number]>();

  // bullet holes
  const DMAX = 160;
  const dg = new THREE.PlaneGeometry(0.12, 0.12);
  const decals = new THREE.InstancedMesh(dg, new THREE.ShaderMaterial({ vertexShader: DVERT, fragmentShader: DFRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), DMAX);
  decals.count = 0;
  decals.frustumCulled = false;
  decals.renderOrder = 3;
  group.add(decals);
  let decalNext = 0;
  const dm = new THREE.Matrix4();
  const dq = new THREE.Quaternion();
  const dn = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const dpos = new THREE.Vector3();
  const dscale = new THREE.Vector3();

  // grenades in the air
  // a frag is the real M67 (the other side throws RGD-5s) when they have loaded
  const fragGeo = new THREE.SphereGeometry(0.055, 10, 8);
  const smokeGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10);
  const nadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4430, roughness: 0.6, metalness: 0.3 });
  const fragLook = [0, 1].map((k) => {
    const f = frags[k] ?? frags[0];
    return f ? { geo: f.geo, mat: worldMaterial(THREE, f.mat, shared) } : { geo: fragGeo, mat: nadeMat };
  });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.4 });
  // a flashbang: the same can, pale with a dark band
  const flashGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.13, 10);
  const flashMat = new THREE.MeshStandardMaterial({ color: 0xc9cdc4, roughness: 0.45, metalness: 0.5 });
  // an incendiary: a red can; an impact grenade: a squat yellow banded ball; a decoy: a grey green can
  const fireMat = new THREE.MeshStandardMaterial({ color: 0x8c2a1c, roughness: 0.5, metalness: 0.4 });
  const impactGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.07, 12);
  const impactMat = new THREE.MeshStandardMaterial({ color: 0xb8962c, roughness: 0.45, metalness: 0.5 });
  const decoyMat = new THREE.MeshStandardMaterial({ color: 0x55665a, roughness: 0.55, metalness: 0.4 });
  const LOOKS = { smoke: { geo: smokeGeo, mat: smokeMat }, flash: { geo: flashGeo, mat: flashMat }, fire: { geo: smokeGeo, mat: fireMat }, impact: { geo: impactGeo, mat: impactMat }, decoy: { geo: flashGeo, mat: decoyMat } } as const;
  // each starts in one of the looks a grenade can take, so the shader warm up compiles every one of them
  const nades = Array.from({ length: 12 }, (_, i) => {
    const look = i < 3 ? fragLook[0] : i < 6 ? fragLook[1] : i < 7 ? LOOKS.smoke : i < 8 ? LOOKS.flash : i < 9 ? LOOKS.fire : i < 10 ? LOOKS.impact : LOOKS.decoy;
    const mesh: T.Mesh<T.BufferGeometry, T.Material> = new THREE.Mesh(look.geo, look.mat);
    mesh.visible = false;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  });

  // crossbow bolts in flight (yours too: a slow bolt is worth watching)
  const boltGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6).rotateX(Math.PI / 2);
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.6, metalness: 0.2 });
  const bolts = Array.from({ length: 6 }, () => {
    const mesh = new THREE.Mesh(boltGeo, boltMat);
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  });

  // weather
  const def = w.def;
  let weather: T.Points | null = null;
  if (def.weather !== 'none') {
    const n = def.weather === 'snow' ? 7000 : def.weather === 'dust' ? 1400 : 900;
    const r = mulberry32(9);
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = r();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const col = def.weather === 'snow' ? lin(0xffffff, 1.4) : def.weather === 'dust' ? lin(0xd8b890, 1.1) : lin(0xfff0b0, 2.2);
    weather = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uBox: { value: def.weather === 'snow' ? 46 : 60 }, uFall: { value: def.weather === 'snow' ? 1.6 : def.weather === 'dust' ? 0.2 : 0.05 }, uSize: { value: def.weather === 'snow' ? 11 : def.weather === 'dust' ? 9 : 4 }, uScale: { value: 1 }, uColor: { value: new THREE.Color(...col) } },
        vertexShader: WVERT,
        fragmentShader: WFRAG,
        transparent: true,
        depthWrite: false,
        blending: def.weather === 'pollen' ? ADDITIVE : NORMAL_BLEND,
      }),
    );
    weather.frustumCulled = false;
    weather.renderOrder = 8;
    group.add(weather);
  }

  let fireT = 0;
  const smokeIds = new WeakSet<object>();

  let columnT = 0;
  const v = new THREE.Vector3();
  const rnd = (a: number) => (Math.random() - 0.5) * a;

  function impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, s: Surface, near: number) {
    const [puff, deb, sparks] = SURF[s];
    litRGB(puff, x, z, rgb);
    const k = s === 'water' ? 2 : 1;
    for (let i = 0; i < 2 + near * 2; i++) alpha.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 1.2 + rnd(0.8), ny * 1.2 + rnd(0.8) + 0.4 * k, nz * 1.2 + rnd(0.8), 0.5 + Math.random() * 0.5, 0.12 * k, 0.75 * k, rgb[0], rgb[1], rgb[2], 0.75, -0.2, 2.2);
    litRGB(deb, x, z, rgb);
    for (let i = 0; i < 3 + near * 3; i++) alpha.spawn(x, y, z, nx * 3 + rnd(3), ny * 3 + rnd(2) + 2, nz * 3 + rnd(3), 0.6 + Math.random() * 0.4, 0.025, 0.02, rgb[0], rgb[1], rgb[2], 1, 9.8, 0.4);
    if (sparks) for (let i = 0; i < 4; i++) add.spawn(x, y, z, nx * 4 + rnd(6), ny * 4 + rnd(6) + 1, nz * 4 + rnd(6), 0.12 + Math.random() * 0.12, 0.03, 0.01, 6, 3.6, 1.4, 1, 9.8, 1);
    if (s !== 'dirt' && s !== 'sand' && s !== 'snow' && s !== 'water' && s !== 'leaf') {
      dn.set(nx, ny, nz).normalize();
      dq.setFromUnitVectors(zAxis, dn);
      dq.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, Math.random() * 6.28));
      dpos.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
      dscale.setScalar(0.7 + Math.random() * 0.6);
      dm.compose(dpos, dq, dscale);
      decals.setMatrixAt(decalNext, dm);
      decalNext = (decalNext + 1) % DMAX;
      decals.count = Math.min(DMAX, decals.count + 1);
      decals.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    setWeather(scale) {
      if (weather) (weather.material as T.ShaderMaterial).uniforms.uScale.value = scale;
    },
    clear() {
      alpha.clear();
      add.clear();
      decals.count = 0;
    },
    smokeAt(x, y, z, m) {
      let best = 0;
      for (const s of m.smokes) {
        const d = Math.hypot(x - s.x, (y - s.y - 1.2) * 1.3, z - s.z);
        best = Math.max(best, 1 - Math.min(1, d / Math.max(0.1, s.r)));
      }
      return best;
    },
    update(m, dt, camera, muzzleOf, you) {
      const cam = camera.position;
      for (const e of m.events) {
        const near = Math.max(0, 1 - Math.hypot(cam.x - ('x' in e ? e.x : cam.x), cam.z - ('z' in e ? e.z : cam.z)) / 60);
        if (e.t === 'impact') impact(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.s, near > 0.2 ? 1 : 0);
        else if (e.t === 'hit') {
          litRGB(e.armor ? 0x9ab0c8 : 0x8a1a12, e.x, e.z, rgb);
          for (let i = 0; i < 5; i++) alpha.spawn(e.x, e.y, e.z, rnd(1.5), rnd(1.5) + 0.3, rnd(1.5), 0.35 + Math.random() * 0.25, 0.08, 0.45, rgb[0], rgb[1], rgb[2], e.armor ? 0.5 : 0.7, 1.5, 3);
          if (e.armor) for (let i = 0; i < 4; i++) add.spawn(e.x, e.y, e.z, rnd(5), rnd(5), rnd(5), 0.1, 0.03, 0.01, 3, 4, 6, 1, 6, 1);
        } else if (e.t === 'shot' && e.a !== you) {
          muzzleOf(e.a, v);
          if (v.y > -500) {
            add.spawn(v.x, v.y, v.z, 0, 0, 0, 0.05, 0.22, 0.32, 9, 6, 2.6, 1);
            litRGB(0xb0b0b0, v.x, v.z, rgb);
            alpha.spawn(v.x, v.y, v.z, e.dx * 1.5, 0.4, e.dz * 1.5, 0.6, 0.08, 0.5, rgb[0], rgb[1], rgb[2], 0.25, -0.3, 2);
          }
        } else if (e.t === 'decoy') {
          // a decoy's fake shot: a little flash and a wisp, to sell it
          add.spawn(e.x, e.y + 0.05, e.z, 0, 0.5, 0, 0.05, 0.15, 0.25, 9, 6, 2.6, 1);
        } else if (e.t === 'fire') {
          // an incendiary catching: a burst of flame
          for (let i = 0; i < 18; i++) add.spawn(e.x + rnd(1.2), e.y + 0.2, e.z + rnd(1.2), rnd(3), 1.5 + Math.random() * 3, rnd(3), 0.35 + Math.random() * 0.3, 0.5, 1.4, 10, 4.2, 1, 1, -1, 2);
        } else if (e.t === 'block' && e.broke) {
          // a shield breaking: a shower of sparks and bits
          for (let i = 0; i < 14; i++) add.spawn(e.x, e.y, e.z, rnd(6), Math.random() * 4, rnd(6), 0.2 + Math.random() * 0.2, 0.04, 0.01, 6, 4, 2, 1, 9.8, 0.5);
          litRGB(0x3a3f44, e.x, e.z, rgb);
          for (let i = 0; i < 10; i++) alpha.spawn(e.x, e.y, e.z, rnd(4), Math.random() * 4, rnd(4), 0.8 + Math.random() * 0.5, 0.04, 0.03, rgb[0], rgb[1], rgb[2], 1, 9.8, 0.3);
        } else if (e.t === 'flash') {
          // a flashbang: a hot white burst and a few sparks, gone in a blink
          for (let i = 0; i < 6; i++) add.spawn(e.x + rnd(0.2), e.y + 0.2 + rnd(0.2), e.z + rnd(0.2), rnd(1), rnd(1), rnd(1), 0.12 + Math.random() * 0.06, 1.2, 4.2, 14, 14, 13, 1, 0, 5);
          for (let i = 0; i < 12; i++) add.spawn(e.x, e.y + 0.2, e.z, rnd(10), Math.random() * 6, rnd(10), 0.25 + Math.random() * 0.2, 0.05, 0.02, 9, 8, 6, 1, 9.8, 0.5);
        } else if (e.t === 'boom' || (e.t === 'shell' && Math.hypot(cam.x - e.x, cam.z - e.z) < 450)) {
          for (let i = 0; i < 10; i++) add.spawn(e.x + rnd(0.6), e.y + 0.4 + rnd(0.6), e.z + rnd(0.6), rnd(6), rnd(5) + 3, rnd(6), 0.28 + Math.random() * 0.2, 0.8, 3.4, 12, 6.5, 2, 1, -1, 4);
          litRGB(0x3a3632, e.x, e.z, rgb);
          for (let i = 0; i < 16; i++) alpha.spawn(e.x + rnd(1.5), e.y + 0.5 + Math.random(), e.z + rnd(1.5), rnd(4), Math.random() * 3 + 1.5, rnd(4), 2.2 + Math.random() * 1.8, 1, 4.5, rgb[0], rgb[1], rgb[2], 0.75, -0.4, 1.4);
          litRGB(0x2a241e, e.x, e.z, rgb);
          for (let i = 0; i < 24; i++) alpha.spawn(e.x, e.y + 0.2, e.z, rnd(16), Math.random() * 10 + 2, rnd(16), 0.9 + Math.random() * 0.6, 0.05, 0.04, rgb[0], rgb[1], rgb[2], 1, 12, 0.3);
          for (let i = 0; i < 16; i++) add.spawn(e.x, e.y + 0.3, e.z, rnd(18), Math.random() * 12, rnd(18), 0.4 + Math.random() * 0.3, 0.05, 0.02, 9, 5, 1.5, 1, 9.8, 0.5);
        }
      }
      // a landed supply crate's smoke: a tall blue column, thick at first and thinning out toward its end, so it can be
      // seen (and found) from across the map
      columnT += dt * 14;
      const puffs = Math.floor(columnT);
      columnT -= puffs;
      for (let p = 0; p < puffs; p++)
        for (const s of m.supplies) {
          const age = s.landed < 0 ? -1 : m.time - s.landed;
          if (age < 0 || age > SUPPLY_SMOKE || Math.random() > 1 - (age / SUPPLY_SMOKE) * 0.6) continue;
          litRGB(0x2a7cf0, s.x, s.z, rgb);
          alpha.spawn(s.x + rnd(0.5), s.y + 0.9, s.z + rnd(0.5), rnd(0.8) + 0.5, 4.5 + Math.random() * 2.5, rnd(0.8), 8 + Math.random() * 4, 0.7, 5.5 + Math.random() * 2, rgb[0] * 1.15, rgb[1] * 1.15 + 0.01, rgb[2] * 1.15 + 0.04, 0.85, -0.05, 0.12);
        }
      // burning ground: flames licking up all over the patch, and dark smoke off it, while it burns
      fireT += dt;
      const lick = Math.floor(fireT * 60);
      if (lick > 0) {
        fireT -= lick / 60;
        for (const f of m.fires) {
          if (Math.hypot(cam.x - f.x, cam.z - f.z) > 220) continue;
          const fade = 1 - Math.max(0, f.age - (f.life - 1));
          for (let i = 0; i < lick * 2; i++) {
            const a = Math.random() * 6.28;
            const rr = Math.sqrt(Math.random()) * f.r;
            add.spawn(f.x + Math.cos(a) * rr, f.y + 0.05, f.z + Math.sin(a) * rr, rnd(0.4), 1 + Math.random() * 1.6, rnd(0.4), 0.35 + Math.random() * 0.35, 0.28 + Math.random() * 0.2, 0.06, 7 * fade, 2.8 * fade, 0.6 * fade, 1, -0.5, 1);
          }
          if (Math.random() < lick * 0.25) {
            litRGB(0x2a2522, f.x, f.z, rgb);
            alpha.spawn(f.x + rnd(f.r), f.y + 0.6, f.z + rnd(f.r), rnd(0.4), 1.2 + Math.random(), rnd(0.4), 2.5 + Math.random() * 1.5, 0.5, 2.6, rgb[0], rgb[1], rgb[2], 0.5, -0.1, 0.6);
          }
        }
      }
      // smoke clouds: puffs are added while a cloud grows, then live as long as it does
      for (const s of m.smokes) {
        if (smokeIds.has(s)) continue;
        smokeIds.add(s);
        litRGB(0xd8dadc, s.x, s.z, rgb);
        for (let i = 0; i < 34; i++) {
          const a = Math.random() * 6.28;
          const rr = Math.sqrt(Math.random()) * 4;
          alpha.spawn(s.x + Math.cos(a) * rr * 0.3, s.y + 0.5, s.z + Math.sin(a) * rr * 0.3, Math.cos(a) * rr * 0.9, 0.5 + Math.random() * 1.2, Math.sin(a) * rr * 0.9, s.life - 0.5 + Math.random(), 1.2, 4.6 + Math.random() * 1.4, rgb[0], rgb[1], rgb[2], 0.92, 0.12, 0.9);
        }
      }
      // bullets in flight become tracers
      let n = 0;
      const A = tA.array as Float32Array;
      const Bv = tB.array as Float32Array;
      const C = tC.array as Float32Array;
      const W = tW.array as Float32Array;
      let nb = 0;
      for (const b of m.bullets) {
        if (n >= TMAX) break;
        // a crossbow bolt is drawn as itself, no tracer
        if (WEAPONS[b.w].cls === 'crossbow') {
          if (b.live && nb < bolts.length) {
            const mesh = bolts[nb++];
            mesh.visible = true;
            mesh.position.set(b.x, b.y, b.z);
            v.set(b.x + b.vx, b.y + b.vy, b.z + b.vz);
            mesh.lookAt(v);
          }
          continue;
        }
        // your own shots draw no line (the flash and where they land say enough); others' show where fire comes from
        if (b.owner === you) continue;
        const len = Math.hypot(b.vx, b.vy, b.vz) || 1;
        let o = origins.get(b);
        if (!o) {
          // the tracer starts at the shooter's muzzle, unless that is unknown or not where this bullet came from
          // (a soldier far off is posed now and then): then where the bullet really started
          const sx = b.x - (b.vx / len) * b.dist;
          const sy = b.y - (b.vy / len) * b.dist;
          const sz = b.z - (b.vz / len) * b.dist;
          muzzleOf(b.owner, v);
          o = v.y > -500 && Math.hypot(v.x - sx, v.y - sy, v.z - sz) < 3 ? [v.x, v.y, v.z] : [sx, sy, sz];
          origins.set(b, o);
        }
        const tail = Math.min(b.dist + 0.001, 12);
        let ax = b.x - (b.vx / len) * tail;
        let ay = b.y - (b.vy / len) * tail;
        let az = b.z - (b.vz / len) * tail;
        if (b.dist < 12) {
          ax = o[0];
          ay = o[1];
          az = o[2];
        }
        A.set([ax, ay, az], n * 3);
        Bv.set([b.x, b.y, b.z], n * 3);
        C.set([4.2, 3.2, 1.8, 0.45], n * 4);
        W[n] = 0.008;
        n++;
      }
      for (let i = nb; i < bolts.length; i++) bolts[i].visible = false;
      tg.instanceCount = n;
      for (const a of [tA, tB, tC, tW]) a.needsUpdate = true;
      // grenades
      nades.forEach((mesh, i) => {
        const g = m.nades[i];
        mesh.visible = !!g;
        if (!g) return;
        const look = fragLook[m.mode === 'breach' ? (m.actors[g.owner]?.team ?? 0) : g.owner % 2];
        const lk = g.kind === 'frag' ? look : LOOKS[g.kind];
        mesh.geometry = lk.geo;
        mesh.material = lk.mat;
        mesh.position.set(g.x, g.y, g.z);
        mesh.rotation.set(g.spin, g.spin * 0.7, 0);
      });
      alpha.update(dt);
      add.update(dt);
    },
  };
}
