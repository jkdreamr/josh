// three.js view of a Wacky Walk round: the course, the jelly bean grads, confetti and the chase camera.
// It reads course and body data every frame and never changes them. Only classes kit/three-lib.ts exports are used.
import type { T } from './gl';
import { createGL, damp, disposeTree, type GL } from './gl';
import type { BodyState, Collider, Course, Decor, Look, Pose } from './types.ts';
import { groundBelow, offsetPoseLocal, rayCast } from './physics.ts';

type Three = typeof import('three');

export type BodyView = { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; state: BodyState; squash: number };
export type PlayerLook = { id: number; color: number };
export type CamState = { yaw: number; pitch: number; dist: number; lookY?: number; lookAt?: { x: number; y: number; z: number } };

export type View = {
  gl: GL;
  resize(w: number, h: number): void;
  setCourse(course: Course): void;
  setPlayers(players: PlayerLook[]): void;
  /** Moves everything for course time t and points the camera at body `focus` (null: a slow fly-by of the course). */
  frame(course: Course, t: number, bodies: readonly (BodyView | null)[], focus: number | null, cam: CamState, dt: number): void;
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  confetti(x: number, y: number, z: number, count?: number): void;
  splash(x: number, y: number, z: number): void;
  render(): void;
  dispose(): void;
};

const MAX_PLAYERS = 20;
const CARDINAL = 0xb1040e;
const CAMERA_ORBITS = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

const LOOK_COLORS: Record<Look, number> = {
  grass: 0xa8ecc4, path: 0xfff1d6, sand: 0xcdb8ff, stone: 0xd8c7f2, roof: 0xd75a48, wood: 0xb77b45, tube: 0xfffaf0,
  bar: 0xff4fa3, bumper: 0xff4fa3, water: 0x3fd0ff, wet: 0x9ceaff, hex: 0x8a5cff, gold: 0xffd23f, coconut: 0x8f5637,
  frond: 0x58b85f, pad: 0xff8a3d, start: 0x3fd0ff, finish: 0xffd23f, hidden: 0xffffff,
};

type Surface = 'plain' | 'grass' | 'sandstone' | 'pavers' | 'roof' | 'paper' | 'pad' | 'coconut' | 'water';

/** A part to bake into a merged, vertex colored mesh. */
type Part = { g: T.BufferGeometry; m: T.Matrix4; c: number; surface?: Surface };
type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type DecorBounds = { box: Aabb; parts: { box: Aabb; inverse: T.Matrix4 }[] };

function rayBox(from: T.Vector3, to: T.Vector3, box: Aabb): number {
  let near = 0;
  let far = 1;
  const dx = to.x - from.x;
  if (Math.abs(dx) < 1e-8) {
    if (from.x < box.minX || from.x > box.maxX) return 1;
  } else {
    let a = (box.minX - from.x) / dx;
    let b = (box.maxX - from.x) / dx;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return 1;
  }
  const dy = to.y - from.y;
  if (Math.abs(dy) < 1e-8) {
    if (from.y < box.minY || from.y > box.maxY) return 1;
  } else {
    let a = (box.minY - from.y) / dy;
    let b = (box.maxY - from.y) / dy;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return 1;
  }
  const dz = to.z - from.z;
  if (Math.abs(dz) < 1e-8) {
    if (from.z < box.minZ || from.z > box.maxZ) return 1;
  } else {
    let a = (box.minZ - from.z) / dz;
    let b = (box.maxZ - from.z) / dz;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return 1;
  }
  return near <= 1 && far >= 0 ? near : 1;
}

function build(THREE: Three, host: HTMLElement, touch: boolean): View | null {
  const gl = createGL(THREE, host, { maxDpr: 1.25 });
  if (!gl) return null;
  const { renderer } = gl;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = 0 as T.ToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 420);
  const hemi = new THREE.HemisphereLight(0xd8f3ff, 0x78a86f, 1.55);
  const sun = new THREE.DirectionalLight(0xffd09a, 2.4);
  sun.position.set(-44, 62, -38);
  scene.add(hemi, sun);
  const CONFETTI = touch ? 80 : 140;
  const DROPS = touch ? 72 : 120;

  // shared unit geometries (non indexed, so they bake straight into merged meshes)
  const own: T.BufferGeometry[] = [];
  const keepG = <G extends T.BufferGeometry>(g: G) => {
    own.push(g);
    return g;
  };
  const unit = {
    box: keepG(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()),
    cyl: keepG(new THREE.CylinderGeometry(1, 1, 1, touch ? 10 : 18, 1).toNonIndexed()),
    cyl6: keepG(new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed()),
    cyl8: keepG(new THREE.CylinderGeometry(1, 1, 1, touch ? 7 : 10, 1).toNonIndexed()),
    taper: keepG(new THREE.CylinderGeometry(0.78, 1, 1, 8, 1).toNonIndexed()),
    cone: keepG(new THREE.ConeGeometry(1, 1, touch ? 6 : 10, 1).toNonIndexed()),
    cone4: keepG(new THREE.ConeGeometry(1, 1, 4, 1).toNonIndexed()),
    prism: keepG(new THREE.CylinderGeometry(1, 1, 1, 3, 1).toNonIndexed()),
    sphere: keepG(new THREE.SphereGeometry(1, touch ? 9 : 16, touch ? 6 : 12).toNonIndexed()),
    flower: keepG(new THREE.SphereGeometry(1, 6, 4).toNonIndexed()),
    ico: keepG(new THREE.IcosahedronGeometry(1, 0)),
    half: keepG(new THREE.TorusGeometry(1, 0.16, 5, 10, Math.PI).toNonIndexed()),
    arch: keepG(new THREE.TorusGeometry(2.2, 0.42, touch ? 5 : 7, touch ? 16 : 24, Math.PI).toNonIndexed()),
    leaf: keepG((() => {
      const g = new THREE.BufferGeometry();
      const positions: number[] = [];
      const segments = 8;
      const edge = (i: number, side: number) => {
        const t = i / segments;
        return [t * 2.7, -t * t * 0.95 + Math.sin(t * Math.PI) * 0.23 * side, 0];
      };
      const push = (v: number[]) => positions.push(v[0], v[1], v[2]);
      for (let i = 0; i < segments; i++) {
        const left = edge(i, 1), right = edge(i, -1);
        const nextLeft = edge(i + 1, 1), nextRight = edge(i + 1, -1);
        push(left); push(right); push(nextLeft);
        push(right); push(nextRight); push(nextLeft);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      return g;
    })()),
  };
  const mats: T.Material[] = [];
  const mat = <M extends T.Material>(m: M) => {
    mats.push(m);
    return m;
  };
  const textures: T.Texture[] = [];
  const toonGradient = new THREE.CanvasTexture(document.createElement('canvas'));
  Object.assign(toonGradient, {
    isDataTexture: true,
    image: {
      data: new Uint8Array([115, 115, 115, 255, 191, 191, 191, 255, 255, 255, 255, 255]),
      width: 3,
      height: 1,
    },
    flipY: false,
    unpackAlignment: 4,
  });
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.generateMipmaps = false;
  toonGradient.needsUpdate = true;
  textures.push(toonGradient);
  const toon = (color: number, extra: T.MeshLambertMaterialParameters = {}) => {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: false, ...extra });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.wwToonGradient = { value: toonGradient };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform sampler2D wwToonGradient;\nvoid main() {')
        .replace(
          '#include <opaque_fragment>',
          `float wwIntensity = clamp(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0001), 0.0, 1.0);
          float wwShadow = texture2D(wwToonGradient, vec2(0.1666667, 0.5)).r;
          float wwMid = texture2D(wwToonGradient, vec2(0.5, 0.5)).r;
          float wwBright = texture2D(wwToonGradient, vec2(0.8333333, 0.5)).r;
          float wwTone = mix(wwShadow, wwMid, smoothstep(0.34, 0.55, wwIntensity));
          wwTone = mix(wwTone, wwBright, smoothstep(0.68, 0.88, wwIntensity));
          outgoingLight = diffuseColor.rgb * wwTone;
          #include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'wacky-walk-toon-v1';
    return material;
  };
  const makeTexture = (paint: (ctx: CanvasRenderingContext2D, size: number) => void) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    paint(ctx, canvas.width);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(touch ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
    return texture;
  };
  const shadowTex = makeTexture((ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
    gradient.addColorStop(0, 'rgba(25,34,38,.38)');
    gradient.addColorStop(0.35, 'rgba(25,34,38,.24)');
    gradient.addColorStop(0.72, 'rgba(25,34,38,.08)');
    gradient.addColorStop(1, 'rgba(25,34,38,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
  const crackTex = makeTexture((ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(86,50,38,.92)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.12;
      const x = size / 2 + Math.cos(a) * size * 0.45;
      const y = size / 2 + Math.sin(a) * size * 0.45;
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(a + 0.08) * size * 0.22, size / 2 + Math.sin(a + 0.08) * size * 0.22);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(a + 0.08) * size * 0.22, size / 2 + Math.sin(a + 0.08) * size * 0.22);
      ctx.lineTo(size / 2 + Math.cos(a + 0.25) * size * 0.31, size / 2 + Math.sin(a + 0.25) * size * 0.31);
      ctx.stroke();
    }
  });
  const surfaceForLook = (look: Look): Surface => {
    if (look === 'grass') return 'grass';
    if (look === 'wet') return 'water';
    if (look === 'sand') return 'pavers';
    if (look === 'path' || look === 'stone' || look === 'start' || look === 'finish' || look === 'hex') return 'sandstone';
    if (look === 'gold') return 'plain';
    if (look === 'roof') return 'roof';
    if (look === 'tube') return 'paper';
    if (look === 'bar') return 'plain';
    if (look === 'pad') return 'pad';
    if (look === 'coconut') return 'coconut';
    return 'plain';
  };
  const bakedMats = new Map<Surface, T.Material>();
  const bakedMat = (surface: Surface) => {
    let material = bakedMats.get(surface);
    if (!material) {
      material = mat(toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
      bakedMats.set(surface, material);
    }
    return material;
  };

  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const tmpC2 = new THREE.Color();
  const scratchMtx = new THREE.Matrix4();
  const setMtx = (out: T.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    out.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(pitch, yaw, roll, 'YXZ')), tmpS.set(sx, sy, sz));
  const mtx = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    setMtx(new THREE.Matrix4(), x, y, z, sx, sy, sz, yaw, pitch, roll);

  function bake(parts: Part[]): T.BufferGeometry {
    let n = 0;
    for (const p of parts) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    let o = 0;
    for (const p of parts) {
      const ps = p.g.attributes.position;
      const ns = p.g.attributes.normal;
      const surface = p.surface ?? 'plain';
      tmpC.setHex(p.c);
      const scale = surface === 'grass' ? 0.24 : surface === 'sandstone' ? 2 : surface === 'pavers' ? 0.8 : surface === 'roof' ? 0.42 :
        surface === 'paper' ? 0.6 : surface === 'pad' ? 0.3 : surface === 'coconut' ? 0.8 : 1;
      for (let i = 0; i < ps.count; i++) {
        tmpV.fromBufferAttribute(ps, i).applyMatrix4(p.m);
        pos[o * 3] = tmpV.x;
        pos[o * 3 + 1] = tmpV.y;
        pos[o * 3 + 2] = tmpV.z;
        tmpV.fromBufferAttribute(ns, i).transformDirection(p.m);
        nor[o * 3] = tmpV.x;
        nor[o * 3 + 1] = tmpV.y;
        nor[o * 3 + 2] = tmpV.z;
        const shade = surface === 'pad' && Math.abs(tmpV.y) < 0.55 ? 0.56 : tmpV.y > 0.55 ? 1.12 : tmpV.y < -0.55 ? 0.68 : 0.88;
        col[o * 3] = Math.min(1, tmpC.r * shade);
        col[o * 3 + 1] = Math.min(1, tmpC.g * shade);
        col[o * 3 + 2] = Math.min(1, tmpC.b * shade);
        if (Math.abs(tmpV.y) > 0.65) {
          uv[o * 2] = pos[o * 3] * scale;
          uv[o * 2 + 1] = pos[o * 3 + 2] * scale;
        } else if (Math.abs(tmpV.x) > Math.abs(tmpV.z)) {
          uv[o * 2] = pos[o * 3 + 2] * scale;
          uv[o * 2 + 1] = pos[o * 3 + 1] * scale;
        } else {
          uv[o * 2] = pos[o * 3] * scale;
          uv[o * 2 + 1] = pos[o * 3 + 1] * scale;
        }
        o++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  }

  // ---------------------------------------------------------------- sky and water
  const skyGeo = keepG(new THREE.SphereGeometry(380, 16, 10));
  const skyColors = new Float32Array(skyGeo.attributes.position.count * 3);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(skyGeo, mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xffffff, 90, 330);
  const waterMat = mat(new THREE.MeshBasicMaterial({
    color: 0x37c6d6, transparent: true, opacity: 0.96, depthWrite: false,
  }));
  const water = new THREE.Mesh(keepG(new THREE.PlaneGeometry(900, 900, 1, 1)), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const depthRing = new THREE.Mesh(
    keepG(new THREE.RingGeometry(1.015, 1.32, touch ? 48 : 80)),
    mat(new THREE.MeshBasicMaterial({ color: 0x4a9fb5, transparent: true, opacity: 0.24, depthWrite: false })),
  );
  depthRing.rotation.x = -Math.PI / 2;
  scene.add(depthRing);
  const shoreMat = mat(toon(0xa8ecc4));
  const shore = new THREE.Mesh(keepG(new THREE.RingGeometry(1, 3.2, 48, 1)), shoreMat);
  shore.rotation.x = -Math.PI / 2;
  scene.add(shore);
  const foamRing = new THREE.Mesh(
    keepG(new THREE.RingGeometry(0.99, 1.025, touch ? 48 : 80)),
    mat(new THREE.MeshBasicMaterial({ color: 0xeafaff, transparent: true, opacity: 0.3, depthWrite: false })),
  );
  foamRing.rotation.x = -Math.PI / 2;
  scene.add(foamRing);
  const flowerCount = touch ? 36 : 64;
  const flowerMat = mat(toon(0xffffff));
  const flowerMesh = new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(0.16, touch ? 5 : 7, touch ? 3 : 5)), flowerMat, flowerCount);
  const flowerCenterMesh = new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(0.07, touch ? 5 : 6, touch ? 3 : 4)), mat(toon(0xffdc68)), flowerCount);
  const bushMesh = new THREE.InstancedMesh(unit.sphere, mat(toon(0xffffff)), touch ? 10 : 18);
  flowerMesh.frustumCulled = flowerCenterMesh.frustumCulled = bushMesh.frustumCulled = false;
  const hillCount = touch ? 12 : 20;
  const hillGeo = keepG(new THREE.IcosahedronGeometry(1, 0));
  const hillMesh = new THREE.InstancedMesh(hillGeo, mat(toon(0x79bf78)), hillCount);
  hillMesh.frustumCulled = false;
  scene.add(hillMesh);
  const hillColors = [0x91c584, 0x80b978, 0xa4ce91, 0x77ad70];
  for (let i = 0; i < hillCount; i++) hillMesh.setColorAt(i, tmpC.setHex(hillColors[i % hillColors.length]));
  if (hillMesh.instanceColor) hillMesh.instanceColor.needsUpdate = true;
  const cloudGroups = touch ? 10 : 18;
  const cloudPuffs = Array.from({ length: cloudGroups * 4 }, (_, i) => {
    const puff = i % 4;
    return {
      phase: Math.floor(i / 4) * 2.399,
      x: (puff % 2 ? 1 : -1) * (1.1 + puff * 0.08),
      y: puff === 3 ? 0.18 : 0,
      z: puff < 2 ? -0.2 : 0.4,
      scale: puff === 3 ? 1.35 : 1 + puff * 0.08,
    };
  });
  const cloudMesh = new THREE.InstancedMesh(unit.sphere, mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), cloudPuffs.length);
  cloudMesh.frustumCulled = false;
  scene.add(cloudMesh);
  for (let i = 0; i < cloudPuffs.length; i++) cloudMesh.setColorAt(i, tmpC.setHex(i % 4 === 3 ? 0xf4f9ff : 0xffffff));
  if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;
  const tileShape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a), y = Math.sin(a);
    if (i === 0) tileShape.moveTo(x, y);
    else tileShape.lineTo(x, y);
  }
  tileShape.closePath();
  const tileGeo = keepG(new THREE.ExtrudeGeometry(tileShape, {
    depth: 1, bevelEnabled: true, bevelThickness: 0.065, bevelSize: 0.055, bevelSegments: 1, curveSegments: 1,
  }));
  tileGeo.translate(0, 0, -0.5);
  tileGeo.rotateX(-Math.PI / 2);
  const tileTopMat = mat(toon(0xffffff));
  const tileSideMat = mat(toon(0x76516f));
  const crackGeo = keepG(new THREE.CircleGeometry(1, 6));
  crackGeo.rotateX(-Math.PI / 2);
  const crackMat = mat(new THREE.MeshBasicMaterial({
    color: 0xffffff, map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  const crowdGeo = keepG(new THREE.CapsuleGeometry(0.18, 0.28, touch ? 2 : 3, touch ? 7 : 10));
  const crowdMat = mat(toon(0xffffff));
  const foamGeo = keepG(new THREE.TorusGeometry(1, 0.12, touch ? 4 : 6, touch ? 12 : 18));
  const foamMat = mat(new THREE.MeshBasicMaterial({ color: 0xe6ffff, transparent: true, opacity: 0.88, depthWrite: false }));
  const jetMat = mat(new THREE.MeshBasicMaterial({ color: 0x53cbed, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }));
  const jetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.18, 0.55, 0),
    new THREE.Vector3(0.62, 1.15, 0),
    new THREE.Vector3(1.02, 1.9, 0),
    new THREE.Vector3(0.9, 2.55, 0),
  ]);
  const jetGeo = keepG(new THREE.TubeGeometry(jetCurve, touch ? 12 : 18, 0.14, touch ? 4 : 6, false));
  const fountainArcCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.1, 0, 0), new THREE.Vector3(-1.05, 2.35, 0), new THREE.Vector3(0, 3.05, 0),
    new THREE.Vector3(1.05, 2.35, 0), new THREE.Vector3(2.1, 0, 0),
  ]);
  const fountainArcGeo = keepG(new THREE.TubeGeometry(fountainArcCurve, touch ? 14 : 20, 0.055, touch ? 4 : 6, false));
  const fountainArcMat = mat(new THREE.MeshBasicMaterial({
    color: 0xa7f3ff, transparent: true, opacity: 0.84, side: THREE.DoubleSide, depthWrite: false,
  }));
  const crownGoldMat = mat(toon(0xffd23f, { emissive: 0xffa800, emissiveIntensity: 0.85 }));
  const crownPaperMat = mat(toon(0xfffaf0));

  // ---------------------------------------------------------------- course
  const courseRoot = new THREE.Group();
  scene.add(courseRoot);
  let courseOwned: T.BufferGeometry[] = [];
  let moving: { c: Collider; mesh: T.Object3D }[] = [];
  let fountainArcs: T.InstancedMesh | null = null;
  let fountainOrigin: { x: number; y: number; z: number; scale: number } | null = null;
  const decorBounds: DecorBounds[] = [];
  const decorRayFrom = new THREE.Vector3();
  const decorRayTo = new THREE.Vector3();
  let tiles: { mesh: T.InstancedMesh; cracks: T.InstancedMesh; list: Collider[]; base: number[] } | null = null;
  let jets: { z: Course['zones'][number]; mesh: T.Group; foam: T.Mesh }[] = [];
  let crown: T.Group | null = null;
  let pads: T.Mesh[] = [];
  let crowdMesh: T.InstancedMesh | null = null;
  let crowdPeople: { x: number; y: number; z: number; phase: number; color: number; scale: number }[] = [];
  let waterY = -6;
  let center = { x: 0, z: 0, r: 80 };

  const shapeParts = (c: Collider, m: T.Matrix4, color: number, out: Part[]) => {
    const first = out.length;
    const s = c.shape;
    if (s.kind === 'box') {
      if (c.look === 'frond') {
        const shades = [0x318544, 0x42a04b, 0x64bd57, 0x86cf66];
        const leafletsPerSide = touch ? 5 : 7;
        out.push({
          g: unit.box,
          m: m.clone().multiply(mtx(0, 0, 0, 3.2, 0.07, 0.08)),
          c: shades[0],
          surface: 'plain',
        });
        for (const direction of [-1, 1]) for (let leaf = 0; leaf < leafletsPerSide; leaf++) {
          const spread = (leaf + 0.5) / leafletsPerSide;
          const x = -2.85 + spread * 5.7;
          const z = direction * 0.12 + (leaf % 2 ? 0.035 : -0.035);
          out.push({
            g: unit.leaf,
            m: m.clone().multiply(mtx(x, 0.035, z, 0.27, 0.82, 0.9, 0.035 * direction, 0.08 * direction, direction * Math.PI / 2)),
            c: shades[(leaf + (direction > 0 ? 1 : 0)) % shades.length],
            surface: 'plain',
          });
        }
      } else if (c.look === 'stone' && c.tint === 0xff4fa3) {
        out.push({
          g: unit.sphere,
          m: m.clone().multiply(mtx(0, 0, 0, s.hx, s.hy, s.hz)),
          c: color,
          surface: 'plain',
        });
        out.push({
          g: unit.cyl,
          m: m.clone().multiply(mtx(0, 0, 0, Math.max(s.hx, s.hz) * 1.015, s.hy * 0.16, Math.max(s.hx, s.hz) * 1.015)),
          c: 0xfffaf0,
          surface: 'plain',
        });
      } else if (c.look === 'tube' && s.hx > s.hz * 2) {
        const radius = Math.min(s.hy, s.hz) * 0.88;
        const halfLength = s.hx - radius;
        out.push({
          g: unit.cyl, m: m.clone().multiply(mtx(0, 0, 0, radius, halfLength, radius, 0, 0, Math.PI / 2)),
          c: 0xfffaf0, surface: 'paper',
        });
        for (const x of [-s.hx * 0.34, s.hx * 0.34]) out.push({
          g: unit.cyl, m: m.clone().multiply(mtx(x, 0, 0, radius * 1.04, 0.12, radius * 1.04, 0, 0, Math.PI / 2)),
          c: CARDINAL, surface: 'plain',
        });
        for (const side of [-1, 1]) {
          out.push({
            g: unit.sphere, m: m.clone().multiply(mtx(side * halfLength, 0, 0, radius, radius, radius)),
            c: LOOK_COLORS.gold, surface: 'plain',
          });
        }
      } else if (c.look === 'bar') {
        const radius = Math.min(s.hy, s.hz) * 0.95;
        const halfLength = s.hx - radius;
        out.push({
          g: unit.cyl, m: m.clone().multiply(mtx(0, 0, 0, radius, halfLength, radius, 0, 0, Math.PI / 2)),
          c: LOOK_COLORS.bar, surface: 'plain',
        });
        for (let i = 1; i < 8; i++) out.push({
          g: unit.cyl,
          m: m.clone().multiply(mtx(-halfLength + (halfLength * 2 * i) / 8, 0, 0, radius * 1.035, 0.11, radius * 1.035, 0, 0, Math.PI / 2)),
          c: 0xfffaf0, surface: 'plain',
        });
        for (const side of [-1, 1]) out.push({
          g: unit.sphere, m: m.clone().multiply(mtx(side * halfLength, 0, 0, radius, radius, radius)),
          c: LOOK_COLORS.bar, surface: 'plain',
        });
      } else out.push({ g: unit.box, m: m.clone().multiply(mtx(0, 0, 0, s.hx * 2, s.hy * 2, s.hz * 2)), c: color });
    } else if (s.kind === 'cyl') {
      const g = c.look === 'hex' ? unit.cyl6 : unit.cyl;
      if (c.look === 'sand' && s.hy > 10) {
        const levels = 6;
        for (let level = 0; level < levels; level++) {
          const radius = s.r * (1.08 - level * 0.075);
          const y = -s.hy + (level + 0.5) * (s.hy * 2 / levels);
          out.push({ g, m: m.clone().multiply(mtx(0, y, 0, radius, s.hy * 2 / levels + 0.04, radius)), c: level % 2 ? 0xe8c99a : color });
          if (level > 0) out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, y - s.hy / levels, 0, radius * 1.04, 0.12, radius * 1.04)), c: 0xf1d7ac, surface: 'plain' });
          for (let side = 0; side < 4; side++) {
            const a = side * Math.PI / 2;
            out.push({
              g: unit.box,
              m: m.clone().multiply(mtx(Math.sin(a) * radius * 0.55, y, Math.cos(a) * radius * 0.96, 0.2, 1.5, 0.05, a)),
              c: 0x71879a,
              surface: 'plain',
            });
          }
        }
      } else out.push({ g, m: m.clone().multiply(mtx(0, 0, 0, s.r, s.hy * 2, s.r)), c: color });
      if (c.look === 'tube') {
        // a cardinal ribbon round the middle and darker paper ends
        out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, 0, 0, s.r * 1.04, Math.min(0.5, s.hy * 0.12), s.r * 1.04)), c: CARDINAL });
        for (const e of [-1, 1]) out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, e * s.hy, 0, s.r * 0.86, 0.04, s.r * 0.86)), c: 0xe9dcc0 });
      }
      if (c.look === 'bar') out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, 0, 0, s.r * 1.05, s.hy * 0.3, s.r * 1.05)), c: 0xffffff });
    } else {
      out.push({ g: unit.sphere, m: m.clone().multiply(mtx(0, 0, 0, s.r, s.r, s.r)), c: color });
      if (c.look === 'coconut') for (let i = 0; i < 3; i++) out.push({ g: unit.sphere, m: m.clone().multiply(mtx(Math.cos(i * 2.1) * s.r * 0.35, s.r * 0.85, Math.sin(i * 2.1) * s.r * 0.35, s.r * 0.12, s.r * 0.12, s.r * 0.12)), c: 0x59351e });
    }
    const surface = surfaceForLook(c.look);
    for (let i = first; i < out.length; i++) if (!out[i].surface) out[i].surface = surface;
    if (c.look === 'pad' && s.kind === 'box') {
      const trimSurface: Surface = 'plain';
      for (const side of [-1, 1]) {
        out.push({ g: unit.box, m: m.clone().multiply(mtx(0, -s.hy * 0.55, side * (s.hz - 0.04), s.hx * 2 - 0.08, 0.08, 0.08)), c: 0xd9a941, surface: trimSurface });
        out.push({ g: unit.box, m: m.clone().multiply(mtx(side * (s.hx - 0.04), -s.hy * 0.55, 0, 0.08, 0.08, s.hz * 2 - 0.08)), c: 0xd9a941, surface: trimSurface });
      }
    }
    if (c.look === 'sand' && s.kind === 'box') {
      for (const side of [-1, 1]) {
        out.push({ g: unit.box, m: m.clone().multiply(mtx(0, s.hy - 0.055, side * (s.hz - 0.055), s.hx - 0.055, 0.055, 0.055)), c: 0xd9a941, surface: 'plain' });
        out.push({ g: unit.box, m: m.clone().multiply(mtx(side * (s.hx - 0.055), s.hy - 0.055, 0, 0.055, 0.055, s.hz - 0.055)), c: 0xd9a941, surface: 'plain' });
      }
    }
  };
  const poseMatrix = (p: Pose, out: T.Matrix4) => {
    const m = p.m;
    out.set(m[0], m[1], m[2], p.x, m[3], m[4], m[5], p.y, m[6], m[7], m[8], p.z, 0, 0, 0, 1);
    return out;
  };

  function decorParts(d: Decor, out: Part[]) {
    const first = out.length;
    const base = mtx(d.x, d.y, d.z, d.s, d.s, d.s, d.yaw);
    const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) => base.clone().multiply(mtx(x, y, z, sx, sy, sz, yaw, pitch, roll));
    const sand = d.color ?? 0xf1d2a5;
    switch (d.kind) {
      case 'palm': {
        let x = 0;
        let y = 0;
        const lean = ((d.x * 7 + d.z * 13) % 5) * 0.03 - 0.06;
        for (let i = 0; i < 6; i++) {
          const bend = lean + i * 0.022;
          out.push({ g: unit.cyl8, m: at(x, y + 0.45, 0, 0.24 - i * 0.014, 0.9, 0.24 - i * 0.014, 0, 0, bend), c: i % 2 ? 0xb48455 : 0xa47447 });
          x -= Math.sin(bend) * 0.95;
          y += 0.86;
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          out.push({ g: unit.leaf, m: at(x, y, 0, 1, 1, 1, -a), c: i % 2 ? 0x5cbf5f : 0x48a852 });
          out.push({ g: unit.leaf, m: at(x, y - 0.22, 0, 0.72, 0.72, 0.72, -a - 0.2), c: i % 2 ? 0x4ba451 : 0x6ac568 });
        }
        for (let i = 0; i < 3; i++) out.push({ g: unit.sphere, m: at(x + Math.cos(i * 2) * 0.3, y - 0.25, Math.sin(i * 2) * 0.3, 0.22, 0.22, 0.22), c: 0x7a4f2c });
        break;
      }
      case 'arch': {
        for (const e of [-1, 1]) {
          out.push({ g: unit.box, m: at(e * 2.2, 2.3, 0, 0.9, 4.6, 0.9), c: sand });
          out.push({ g: unit.box, m: at(e * 2.2, 0.12, 0, 1.25, 0.24, 1.25), c: 0xd9bc91 });
          out.push({ g: unit.box, m: at(e * 2.2, 4.52, 0, 1.15, 0.28, 1.15), c: 0xd9bc91 });
        }
        out.push({ g: unit.arch, m: at(0, 4.6, 0, 1, 1, 1), c: sand });
        out.push({ g: unit.box, m: at(0, 7.3, 0, 5.8, 0.24, 1.35), c: 0xb9483b });
        out.push({ g: unit.prism, m: at(0, 7.55, 0, 0.38, 5.9, 1.45, 0, 0, Math.PI / 2), c: LOOK_COLORS.roof });
        break;
      }
      case 'arcade': {
        out.push({ g: unit.box, m: at(0, 2.6, -1.6, 17, 5.2, 2), c: sand });
        for (let i = -2; i <= 2; i++) {
          out.push({ g: unit.box, m: at(i * 3.4 - 1.7 + 1.7, 1.5, 0.2, 0.7, 3, 0.7), c: sand });
          if (i < 2) out.push({ g: unit.half, m: at(i * 3.4 + 1.7, 3, 0.2, 1.4, 1.2, 2.4), c: sand });
        }
        out.push({ g: unit.box, m: at(0, 4.6, 0.2, 14.6, 1, 1), c: sand });
        out.push({ g: unit.prism, m: at(0, 5.7, -0.7, 1.6, 17.6, 2.2, 0, 0, Math.PI / 2), c: LOOK_COLORS.roof });
        break;
      }
      case 'roof': {
        out.push({ g: unit.box, m: at(0, 2.5, 0, 10, 5, 7), c: sand });
        for (let i = -1; i <= 1; i++) out.push({ g: unit.box, m: at(i * 3, 2.8, 3.52, 1.1, 1.6, 0.1), c: 0x6d8fb0 });
        out.push({ g: unit.prism, m: at(0, 6, 0, 2.2, 10.8, 4.4, 0, 0, Math.PI / 2), c: LOOK_COLORS.roof });
        break;
      }
      case 'tower': {
        out.push({ g: unit.cyl8, m: at(0, 0.35, 0, 2.6, 0.7, 2.6), c: 0xd9bf98, surface: 'plain' });
        for (const [y, radius, height] of [[3.45, 2.45, 6.2], [9.15, 1.98, 5.3], [14.1, 1.62, 4.7], [18, 1.34, 3.2]]) {
          out.push({ g: unit.taper, m: at(0, y, 0, radius, height, radius), c: sand, surface: 'plain' });
        }
        for (const [y, radius] of [[6.6, 1.94], [11.85, 1.58], [16.55, 1.3], [19.72, 1.08]]) {
          out.push({ g: unit.cyl, m: at(0, y, 0, radius, 0.12, radius), c: 0xe6cfaa, surface: 'plain' });
        }
        for (const [y, radius] of [[3.5, 2.45], [8.5, 2.05], [13.3, 1.7], [17.2, 1.42]]) {
          for (let side = 0; side < 4; side++) {
            const a = side * Math.PI / 2;
            out.push({
              g: unit.box,
              m: at(Math.sin(a) * (radius * 0.78), y, Math.cos(a) * radius, 0.25, 1.12, 0.055, a),
              c: 0x596c73,
              surface: 'plain',
            });
          }
        }
        out.push({ g: unit.cyl, m: at(0, 20, 0, 1.8, 0.42, 1.8), c: 0xe8d6b8, surface: 'plain' });
        for (const x of [-0.95, 0.95]) for (const z of [-0.95, 0.95]) {
          out.push({ g: unit.box, m: at(x, 21.45, z, 0.25, 2.55, 0.25), c: 0xe4cda8, surface: 'plain' });
        }
        for (let side = 0; side < 4; side++) {
          const a = side * Math.PI / 2;
          out.push({
            g: unit.arch,
            m: at(Math.sin(a) * 1.05, 22.7, Math.cos(a) * 1.05, 0.48, 0.48, 0.48, a),
            c: 0xe4cda8,
            surface: 'plain',
          });
        }
        out.push({ g: unit.cyl, m: at(0, 22.82, 0, 1.35, 0.22, 1.35), c: 0xd9bf98, surface: 'plain' });
        out.push({ g: unit.sphere, m: at(0, 24.35, 0, 1.45, 1.7, 1.45), c: LOOK_COLORS.roof, surface: 'roof' });
        out.push({ g: unit.cyl8, m: at(0, 25.95, 0, 0.35, 1.25, 0.35), c: 0xe8c99a, surface: 'plain' });
        out.push({ g: unit.cone, m: at(0, 26.8, 0, 0.46, 0.65, 0.46), c: LOOK_COLORS.roof, surface: 'roof' });
        out.push({ g: unit.cyl8, m: at(0, 27.42, 0, 0.08, 0.7, 0.08), c: 0xffd35c, surface: 'plain' });
        break;
      }
      case 'fountain': {
        out.push({ g: unit.cyl, m: at(0, 0.3, 0, 3.1, 0.6, 3.1), c: sand });
        out.push({ g: unit.cyl, m: at(0, 0.57, 0, 2.75, 0.18, 2.75), c: 0xb7ecf5 });
        out.push({ g: unit.cyl8, m: at(0, 1.25, 0, 0.36, 1.25, 0.36), c: 0xe3c79e });
        out.push({ g: unit.cyl, m: at(0, 1.95, 0, 1.05, 0.2, 1.05), c: sand });
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          out.push({ g: unit.cone, m: at(Math.cos(a) * 0.72, 2.15, Math.sin(a) * 0.72, 0.18, 0.72, 0.18, 0, Math.sin(a) * 0.38, -Math.cos(a) * 0.38), c: 0x9b563a, surface: 'plain' });
        }
        break;
      }
      case 'tree': {
        out.push({ g: unit.cyl8, m: at(0, 1.2, 0, 0.3, 2.4, 0.3), c: 0x8d6040 });
        out.push({ g: unit.sphere, m: at(-0.65, 3.3, 0, 1.55, 1.45, 1.5), c: d.color ?? 0x5fae5c });
        out.push({ g: unit.sphere, m: at(0.7, 3.45, 0.1, 1.45, 1.55, 1.45), c: 0x68b862 });
        out.push({ g: unit.sphere, m: at(0.05, 4.35, -0.1, 1.25, 1.32, 1.25), c: 0x7bc96d });
        break;
      }
      case 'lamp':
        out.push({ g: unit.cyl8, m: at(0, 1.6, 0, 0.08, 3.2, 0.08), c: 0x3b3b46 });
        out.push({ g: unit.sphere, m: at(0, 3.35, 0, 0.3, 0.3, 0.3), c: 0xfff4c8 });
        break;
      case 'flag':
        out.push({ g: unit.cyl8, m: at(0, 2.5, 0, 0.07, 5, 0.07), c: 0xeeeeee });
        out.push({ g: unit.box, m: at(0.8, 4.4, 0, 1.6, 1, 0.05), c: d.color ?? CARDINAL });
        break;
      case 'bush':
        out.push({ g: unit.sphere, m: at(0, 0.5, 0, 1, 0.75, 1), c: d.color ?? 0x63b35d });
        break;
      case 'hedge':
        out.push({ g: unit.box, m: at(0, 0.6, 0, 4, 1.2, 1), c: d.color ?? 0x5aa857 });
        break;
      case 'banner':
        for (const e of [-1, 1]) out.push({ g: unit.cyl8, m: at(e * 3, 2.5, 0, 0.1, 5, 0.1), c: 0xeeeeee });
        out.push({ g: unit.box, m: at(0, 4, 0, 6, 1.4, 0.06), c: d.color ?? CARDINAL });
        out.push({ g: unit.box, m: at(0, 4, 0.04, 5.4, 0.2, 0.04), c: 0xffffff });
        break;
      case 'stands': {
        for (let i = 0; i < 4; i++) out.push({ g: unit.box, m: at(0, 0.5 + i * 0.8, -i * 1.2, 14, 1 + i * 1.6, 1.2), c: i % 2 ? 0xf3e6cf : 0xe9d6b6 });
        break;
      }
    }
    const stoneDecor = d.kind === 'arch' || d.kind === 'arcade' || d.kind === 'roof' || d.kind === 'tower' || d.kind === 'fountain' || d.kind === 'stands';
    for (let i = first; i < out.length; i++) {
      if (out[i].surface) continue;
      if (out[i].c === LOOK_COLORS.roof) out[i].surface = 'roof';
      else if (d.kind === 'fountain' && out[i].c === 0xb7ecf5) out[i].surface = 'water';
      else out[i].surface = stoneDecor ? 'sandstone' : 'plain';
    }
  }

  function clearCourse() {
    for (const child of [...courseRoot.children]) courseRoot.remove(child);
    for (const g of courseOwned) g.dispose();
    courseOwned = [];
    moving = [];
    decorBounds.length = 0;
    tiles = null;
    jets = [];
    fountainArcs = null;
    fountainOrigin = null;
    crown = null;
    pads = [];
    crowdMesh = null;
    crowdPeople = [];
    flowerMesh.count = 0;
    flowerCenterMesh.count = 0;
    bushMesh.count = 0;
  }

  const movingMats = new Map<string, T.Material>();
  const lookMat = (look: Look) => {
    const key = surfaceForLook(look);
    let m = movingMats.get(key);
    if (!m) {
      m = mat(toon(0xffffff, {
        vertexColors: true,
        emissive: key === 'pad' ? 0x553300 : 0x000000,
        side: THREE.DoubleSide,
      }));
      movingMats.set(key, m);
    }
    return m;
  };

  function setCourse(course: Course) {
    clearCourse();
    const pal = course.palette;
    const pos = skyGeo.attributes.position;
    const top = new THREE.Color(0x6fb6ff);
    const horizon = new THREE.Color(0xffe6c7);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.max(0, Math.min(1, (pos.getY(i) + 12) / 370));
      const smooth = k * k * (3 - 2 * k);
      tmpC.copy(horizon).lerp(top, smooth);
      skyColors.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    skyGeo.attributes.color.needsUpdate = true;
    (scene.fog as T.Fog).color.setHex(0xffe6c7);
    shoreMat.color.setHex(0xa8ecc4);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const statics: Part[] = [];
    const tileList: Collider[] = [];
    const m4 = new THREE.Matrix4();
    for (const c of course.colliders) {
      if (c.look === 'hidden') continue;
      const p = c.pose;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      const color = c.tint ?? LOOK_COLORS[c.look];
      if (c.tile) {
        tileList.push(c);
        continue;
      }
      if (!c.at) {
        shapeParts(c, poseMatrix(c.pose, m4), color, statics);
        continue;
      }
      const parts: Part[] = [];
      shapeParts(c, new THREE.Matrix4(), color, parts);
      const g = bake(parts);
      courseOwned.push(g);
      const material = lookMat(c.look);
      if (c.look === 'pad') {
        pads.push(null as unknown as T.Mesh);
      }
      const mesh = new THREE.Mesh(g, material);
      if (c.look === 'pad') pads[pads.length - 1] = mesh;
      mesh.matrixAutoUpdate = false;
      courseRoot.add(mesh);
      moving.push({ c, mesh });
    }
    const vergeWidth = 6;
    const bankFloors = course.colliders.filter((c) =>
      c.shape.kind === 'box' && !c.at && !c.tile &&
      ['grass', 'path', 'sand', 'start', 'finish', 'wet'].includes(c.look) &&
      c.shape.hx >= 7 && c.shape.hz >= 4,
    );
    for (const c of bankFloors) {
      if (c.shape.kind !== 'box' || c.pose.m[4] < 0.97) continue;
      const shape = c.shape;
      const supportCount = Math.max(1, Math.ceil((shape.hz * 2) / 15));
      const bankBottom = shape.hy - 1.0;
      const depth = Math.max(4.5, c.pose.y + bankBottom - waterY + 0.8);
      const floorMatrix = poseMatrix(c.pose, m4).clone();
      for (let i = 0; i < supportCount; i++) {
        const z = -shape.hz + ((i + 0.5) * shape.hz * 2) / supportCount;
        for (const side of [-1, 1]) statics.push({
          g: unit.box,
          m: floorMatrix.clone().multiply(mtx(
            side * (shape.hx + vergeWidth / 2), bankBottom - depth / 2, z,
            0.62, depth / 2, 0.62,
          )),
          c: 0x8a5cff,
          surface: 'plain',
        });
      }
    }
    for (const c of bankFloors) {
      if (c.shape.kind !== 'box') continue;
      const shape = c.shape;
      const floorMatrix = poseMatrix(c.pose, m4).clone();
      const halfZ = shape.hz + 0.16;
      const topY = shape.hy - 0.08;
      const longZ = shape.hz >= shape.hx;
      for (const side of [-1, 1]) statics.push({
        g: unit.sphere,
        m: floorMatrix.clone().multiply(mtx(
          longZ ? side * (shape.hx + 0.02) : 0,
          shape.hy - 0.07,
          longZ ? 0 : side * (shape.hz + 0.02),
          longZ ? 0.3 : shape.hx * 0.98,
          0.2,
          longZ ? shape.hz * 0.98 : 0.3,
        )),
        c: 0xffd23f,
        surface: 'plain',
      });
      for (const side of [-1, 1]) {
        statics.push({
          g: unit.box,
          m: floorMatrix.clone().multiply(mtx(
            side * (shape.hx + vergeWidth / 2), topY - 0.22, 0,
            vergeWidth / 2, 0.22, halfZ,
          )),
          c: pal.ground,
          surface: 'grass',
        });
        statics.push({
          g: unit.box,
          m: floorMatrix.clone().multiply(mtx(
            side * (shape.hx + vergeWidth / 2), topY - 0.56, 0,
            vergeWidth / 2 + 0.24, 0.36, halfZ,
          )),
          c: 0xb99268,
          surface: 'plain',
        });
      }
    }
    const bankSurfaceY = (x: number, z: number, fallbackY: number) => {
      let bestY = fallbackY - 0.08;
      let bestScore = Infinity;
      for (const c of bankFloors) {
        if (c.shape.kind !== 'box') continue;
        const shape = c.shape;
        const floorMatrix = poseMatrix(c.pose, m4).clone();
        const inverse = floorMatrix.clone().invert();
        const local = new THREE.Vector3(x, fallbackY, z).applyMatrix4(inverse);
        const localX = Math.abs(local.x), localZ = Math.abs(local.z);
        if (localX < shape.hx || localX > shape.hx + vergeWidth || localZ > shape.hz + 2) continue;
        const score = Math.max(0, localZ - shape.hz) + Math.abs(localX - (shape.hx + vergeWidth / 2)) * 0.015;
        if (score >= bestScore) continue;
        bestScore = score;
        bestY = new THREE.Vector3(local.x, shape.hy - 0.08, local.z).applyMatrix4(floorMatrix).y;
      }
      return bestY;
    };
    const solidDecor = new Set<Decor['kind']>(['tower', 'arcade', 'roof', 'stands', 'arch', 'fountain']);
    const sceneryIslands = new Set<Decor['kind']>(['tower', 'stands']);
    for (const d of course.decor) {
      if (d.kind === 'lamp' || d.kind === 'banner' || d.kind === 'flag') continue;
      if (d.kind === 'stands') {
        for (let row = 0; row < 4; row++) for (let col = 0; col < 9; col += touch ? 2 : 1) {
          const lx = -6 + col * 1.5 + (row % 2) * 0.5;
          const lz = -row * 1.2;
          const hue = ((row * 9 + col) * 0.137) % 1;
          tmpC.setHSL(hue, 0.68, 0.58);
          crowdPeople.push({
            x: d.x + (Math.cos(d.yaw) * lx + Math.sin(d.yaw) * lz) * d.s,
            y: d.y + (1.6 + row * 1.6) * d.s,
            z: d.z + (-Math.sin(d.yaw) * lx + Math.cos(d.yaw) * lz) * d.s,
            phase: row * 1.7 + col * 0.83, color: tmpC.getHex(), scale: d.s,
          });
        }
      }
      const first = statics.length;
      const renderDecor = d.kind === 'palm' || d.kind === 'tree'
        ? { ...d, y: bankSurfaceY(d.x, d.z, d.y) }
        : d;
      decorParts(renderDecor, statics);
      if (d.kind === 'fountain') {
        fountainOrigin = { x: d.x, y: d.y, z: d.z, scale: d.s };
        fountainArcs = new THREE.InstancedMesh(fountainArcGeo, fountainArcMat, 3);
        fountainArcs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        fountainArcs.frustumCulled = false;
        for (let i = 0; i < 3; i++) {
          setMtx(scratchMtx, 0, 0, 0, 1, 1, 1, i * Math.PI / 3);
          fountainArcs.setMatrixAt(i, scratchMtx);
        }
        fountainArcs.instanceMatrix.needsUpdate = true;
        courseRoot.add(fountainArcs);
      }
      if (!solidDecor.has(d.kind)) continue;
      const bounds: DecorBounds = {
        box: {
          minX: Infinity, minY: Infinity, minZ: Infinity,
          maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        },
        parts: [],
      };
      for (let i = first; i < statics.length; i++) {
        const part = statics[i];
        if (!part.g.boundingBox) part.g.computeBoundingBox();
        const box = part.g.boundingBox;
        if (!box) continue;
        const partBox: Aabb = {
          minX: box.min.x,
          minY: box.min.y,
          minZ: box.min.z,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: box.max.z,
        };
        bounds.parts.push({ box: partBox, inverse: part.m.clone().invert() });
        for (let corner = 0; corner < 8; corner++) {
          tmpV.set(
            corner & 1 ? box.max.x : box.min.x,
            corner & 2 ? box.max.y : box.min.y,
            corner & 4 ? box.max.z : box.min.z,
          ).applyMatrix4(part.m);
          bounds.box.minX = Math.min(bounds.box.minX, tmpV.x);
          bounds.box.minY = Math.min(bounds.box.minY, tmpV.y);
          bounds.box.minZ = Math.min(bounds.box.minZ, tmpV.z);
          bounds.box.maxX = Math.max(bounds.box.maxX, tmpV.x);
          bounds.box.maxY = Math.max(bounds.box.maxY, tmpV.y);
          bounds.box.maxZ = Math.max(bounds.box.maxZ, tmpV.z);
        }
      }
      if (Number.isFinite(bounds.box.minX)) decorBounds.push(bounds);
    }
    // little grass islands under scenery standing over the lagoon
    for (const d of course.decor) {
      if (!sceneryIslands.has(d.kind)) continue;
      if (d.kind === 'tower' && d.y > 10) continue;
      statics.push({ g: unit.cyl, m: mtx(d.x, d.y - 0.6, d.z, d.kind === 'arcade' || d.kind === 'stands' ? 10 : d.kind === 'roof' ? 8 : d.kind === 'tower' ? 6 : 3, 1.2, d.kind === 'arcade' || d.kind === 'stands' ? 10 : d.kind === 'roof' ? 8 : d.kind === 'tower' ? 6 : 3), c: pal.ground, surface: 'grass' });
      statics.push({ g: unit.cyl, m: mtx(d.x, d.y - 4, d.z, d.kind === 'arcade' || d.kind === 'stands' ? 9.5 : d.kind === 'roof' ? 7.5 : d.kind === 'tower' ? 5.5 : 2.6, 6.8, d.kind === 'arcade' || d.kind === 'stands' ? 9.5 : d.kind === 'roof' ? 7.5 : d.kind === 'tower' ? 5.5 : 2.6), c: 0xd8b98e, surface: 'sandstone' });
    }
    // sandstone undersides beneath the play floors, so the stage reads as raised over the water
    for (const c of course.colliders) {
      if (c.at || c.tile || c.look === 'hidden' || c.shape.kind !== 'box') continue;
      if (!(c.look === 'grass' || c.look === 'path' || c.look === 'start' || c.look === 'finish' || c.look === 'wet')) continue;
      if (c.pose.m[4] < 0.97) continue;
      const s = c.shape;
      const bottom = c.pose.y - Math.abs(c.pose.m[3]) * s.hx - Math.abs(c.pose.m[4]) * s.hy - Math.abs(c.pose.m[5]) * s.hz;
      const depth = bottom - (course.killY + 4);
      if (depth < 1 || s.hx > 40) continue;
      const thickness = Math.min(depth, 3);
      const underside = offsetPoseLocal(c.pose, 0, -s.hy - thickness / 2, 0);
      statics.push({
        g: unit.box,
        m: poseMatrix(underside, m4).multiply(setMtx(scratchMtx, 0, 0, 0, s.hx * 2 * 0.96, thickness, s.hz * 2 * 0.96)),
        c: tmpC.setHex(c.tint ?? LOOK_COLORS[c.look]).multiplyScalar(0.68).getHex(),
        surface: 'plain',
      });
    }
    center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, r: Math.max(maxX - minX, maxZ - minZ) / 2 + 30 };
    const skylineRadius = center.r + 76;
    const skylineCount = touch ? 8 : 12;
    for (let i = 0; i < skylineCount; i++) {
      const a = (i / skylineCount) * Math.PI * 2;
      const x = center.x + Math.cos(a) * skylineRadius;
      const z = center.z + Math.sin(a) * skylineRadius;
      const yaw = -a;
      const base = mtx(x, 0, z, 1, 1, 1, yaw);
      const at = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
        base.clone().multiply(mtx(lx, ly, lz, sx, sy, sz, yaw, pitch, roll));
      for (const px of [-3.1, 0, 3.1]) statics.push({
        g: unit.box, m: at(px, 2.2, 0, 0.42, 4.4, 0.45), c: 0xe3c79e, surface: 'sandstone',
      });
      statics.push({ g: unit.box, m: at(0, 4.5, 0, 6.8, 0.55, 0.8), c: 0xf0d8af, surface: 'sandstone' });
      statics.push({ g: unit.prism, m: at(0, 5.25, 0, 1.25, 7.6, 1.6, 0, 0, Math.PI / 2), c: LOOK_COLORS.roof, surface: 'roof' });
      if (i % 3 === 0) {
        for (let w = -1; w <= 1; w++) statics.push({
          g: unit.box, m: at(w * 0.72, 2.5, 0.24, 0.22, 1.5, 0.06), c: 0x71879a, surface: 'plain',
        });
        statics.push({ g: unit.sphere, m: at(0, 6.9, 0, 1.2, 1.6, 1.2), c: 0xd7654d, surface: 'roof' });
        statics.push({ g: unit.cone, m: at(0, 8.4, 0, 0.42, 1.2, 0.42), c: 0xffca69, surface: 'roof' });
      }
      if (i % 2 === 1) {
        statics.push({ g: unit.cyl8, m: at(-5.4, 2.3, 0, 0.18, 4.6, 0.18), c: 0xa77a4f, surface: 'plain' });
        for (let leaf = 0; leaf < 6; leaf++) statics.push({
          g: unit.leaf, m: at(-5.4, 4.8, 0, 0.72, 0.72, 0.72, leaf * Math.PI / 3), c: leaf % 2 ? 0x62b66b : 0x4f9f58, surface: 'plain',
        });
      }
    }
    if (course.id === 'hoover') {
      statics.push({ g: unit.cyl, m: mtx(0, -4.2, 0, 27.5, 7.2, 27.5), c: 0xd4b68a, surface: 'sandstone' });
      statics.push({ g: unit.cyl, m: mtx(0, -0.82, 0, 25.8, 1.5, 25.8), c: 0x88b875, surface: 'grass' });
      statics.push({ g: unit.cyl, m: mtx(0, -0.35, 0, 26.2, 0.18, 26.2), c: 0xe9c35d, surface: 'plain' });
      for (const y of [2, 7.8, 13.6, 19.4, 25.2, 31, 36.2]) statics.push({
        g: unit.cyl, m: mtx(0, y, 0, 2.24, 0.16, 2.24), c: 0xf0dfbe, surface: 'plain',
      });
      for (const y of [2.8, 8.6, 14.4, 20.2, 26, 31.8]) for (let side = 0; side < 4; side++) {
        const a = side * Math.PI / 2;
        statics.push({
          g: unit.box,
          m: mtx(Math.sin(a) * 2.17, y, Math.cos(a) * 2.17, 0.28, 1.18, 0.09, a),
          c: 0x52636a,
          surface: 'plain',
        });
      }
      statics.push({ g: unit.cyl, m: mtx(0, 36.55, 0, 2.5, 0.18, 2.5), c: 0xe8d6b8, surface: 'plain' });
      for (let side = 0; side < 4; side++) {
        const a = side * Math.PI / 2;
        const cx = Math.sin(a) * 2.05, cz = Math.cos(a) * 2.05;
        statics.push({
          g: unit.arch,
          m: mtx(cx, 36.5, cz, 0.68, 0.68, 0.68, a),
          c: 0xe4cda8,
          surface: 'plain',
        });
        for (const edge of [-1, 1]) statics.push({
          g: unit.box,
          m: mtx(cx + Math.cos(a) * edge * 1.42, 37.42, cz - Math.sin(a) * edge * 1.42, 0.18, 0.92, 0.2, a),
          c: 0xe4cda8,
          surface: 'plain',
        });
      }
      statics.push({ g: unit.cyl, m: mtx(0, 39.88, 0, 2.38, 0.18, 2.38), c: 0xe8d6b8, surface: 'plain' });
      statics.push({ g: unit.sphere, m: mtx(0, 41.42, 0, 2.28, 1.35, 2.28), c: LOOK_COLORS.roof, surface: 'plain' });
      statics.push({ g: unit.cyl8, m: mtx(0, 42.94, 0, 0.56, 0.46, 0.56), c: 0xe6cfaa, surface: 'plain' });
      statics.push({ g: unit.cone, m: mtx(0, 43.9, 0, 0.56, 0.76, 0.56), c: LOOK_COLORS.roof, surface: 'plain' });
    }
    if (course.id === 'oval') {
      for (let i = 0; i < 16; i++) for (const side of [-1, 1]) {
        const x = side * 11.5, z = 2 + i * 8;
        for (const petal of [-1, 1]) statics.push({
          g: unit.flower,
          m: mtx(x + petal * 0.16, 0.06, z, 0.18, 0.14, 0.18),
          c: petal < 0 ? 0xff4fa3 : 0xffd23f,
          surface: 'plain',
        });
        statics.push({
          g: unit.flower,
          m: mtx(x, 0.19, z, 0.08, 0.08, 0.08),
          c: 0xfffaf0,
          surface: 'plain',
        });
      }
    }
    if (statics.length) {
      const groups = new Map<Surface, Part[]>();
      for (const part of statics) {
        const surface = part.surface ?? 'plain';
        let group = groups.get(surface);
        if (!group) groups.set(surface, (group = []));
        group.push(part);
      }
      for (const [surface, parts] of groups) {
        const g = bake(parts);
        courseOwned.push(g);
        courseRoot.add(new THREE.Mesh(g, bakedMat(surface)));
      }
    }
    if (tileList.length) {
      const im = new THREE.InstancedMesh(tileGeo, [tileTopMat, tileSideMat], tileList.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const crackMesh = new THREE.InstancedMesh(crackGeo, crackMat, tileList.length);
      crackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crackMesh.frustumCulled = false;
      const base: number[] = [];
      const layerColors = [0xffd23f, 0xff4fa3, 0x8a5cff, 0x3fd0ff];
      tileList.forEach((c, i) => {
        const b = layerColors[(c.tile?.layer ?? 0) % layerColors.length];
        tmpC.setHex(b).offsetHSL(0, 0, ((i * 37) % 7) * 0.008 - 0.02);
        base.push(tmpC.getHex());
        im.setColorAt(i, tmpC);
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      courseRoot.add(im, crackMesh);
      tiles = { mesh: im, cracks: crackMesh, list: tileList, base };
    }
    for (const z of course.zones) {
      if (z.kind === 'jet') {
        const mesh = new THREE.Group();
        mesh.add(new THREE.Mesh(jetGeo, jetMat));
        const foam = new THREE.Mesh(foamGeo, foamMat);
        foam.rotation.x = Math.PI / 2;
        courseRoot.add(mesh, foam);
        jets.push({ z, mesh, foam });
      }
      if (z.kind === 'crown') {
        crown = new THREE.Group();
        const ring = new THREE.Mesh(unit.cyl, crownGoldMat);
        ring.scale.set(0.7, 0.45, 0.7);
        crown.add(ring);
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(unit.cone, crownGoldMat);
          const a = (i / 5) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.55, 0.45, Math.sin(a) * 0.55);
          spike.scale.set(0.16, 0.5, 0.16);
          crown.add(spike);
        }
        const scroll = new THREE.Mesh(unit.cyl, crownPaperMat);
        scroll.rotation.z = Math.PI / 2;
        scroll.scale.set(0.2, 1.6, 0.2);
        scroll.position.y = -0.55;
        crown.add(scroll);
        const sparkle = new THREE.Mesh(unit.cone, crownGoldMat);
        sparkle.position.set(1.05, 0.82, 0);
        sparkle.scale.set(0.15, 0.42, 0.15);
        sparkle.rotation.z = Math.PI / 2;
        crown.add(sparkle);
        crown.position.set(z.x, z.y, z.z);
        courseRoot.add(crown);
      }
      if (z.kind === 'finish' && course.kind === 'race') {
        const parts: Part[] = [];
        const gateZ = course.id === 'palm' ? z.z - 6 : z.z;
        const postX = 9.55;
        const baseY = (
          bankSurfaceY(z.x - postX, gateZ, z.y) +
          bankSurfaceY(z.x + postX, gateZ, z.y)
        ) / 2;
        const beamY = baseY + 6.53;
        for (const side of [-1, 1]) {
          const x = z.x + side * postX;
          parts.push({ g: unit.box, m: mtx(x, baseY + 3.65, gateZ, 0.7, 7.3, 0.78), c: 0xe8d4b3 });
          parts.push({ g: unit.box, m: mtx(x, baseY + 0.22, gateZ, 1.12, 0.44, 1.15), c: 0xd4b68d });
          parts.push({ g: unit.box, m: mtx(x, baseY + 7.05, gateZ, 1.05, 0.42, 1.05), c: 0xd4b68d });
        }
        parts.push({ g: unit.box, m: mtx(z.x, beamY, gateZ, 19.1, 0.78, 0.62), c: CARDINAL });
        for (let i = 0; i < 24; i++) parts.push({
          g: unit.box,
          m: mtx(z.x - 9.55 + (i + 0.5) * (19.1 / 24), baseY + 7.12, gateZ + 0.33, 19.1 / 24 - 0.025, 0.48, 0.045),
          c: i % 2 ? 0xfffaf2 : CARDINAL,
        });
        const g = bake(parts);
        courseOwned.push(g);
        courseRoot.add(new THREE.Mesh(g, bakedMat('plain')));
      }
    }
    foamRing.position.set(center.x, waterY + 0.05, center.z);
    foamRing.scale.set(center.r + 2, center.r + 2, 1);
    depthRing.position.set(center.x, waterY + 0.02, center.z);
    depthRing.scale.set(center.r + 2, center.r + 2, 1);
    for (let i = 0; i < hillCount; i++) {
      const a = (i / hillCount) * Math.PI * 2;
      const radius = center.r + 52 + (i % 3) * 9;
      const sx = 13 + (i % 4) * 4;
      setMtx(scratchMtx, center.x + Math.cos(a) * radius, -0.4 + (i % 3) * 0.3, center.z + Math.sin(a) * radius, sx, 3.2 + (i % 3) * 0.6, 15 + (i % 4) * 3, -a);
      hillMesh.setMatrixAt(i, scratchMtx);
    }
    hillMesh.instanceMatrix.needsUpdate = true;
    if (crowdPeople.length) {
      crowdMesh = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdPeople.length);
      crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crowdPeople.forEach((person, i) => {
        crowdMesh!.setColorAt(i, tmpC.setHex(person.color));
        setMtx(scratchMtx, person.x, person.y, person.z, person.scale * 0.62, person.scale * 0.76, person.scale * 0.62);
        crowdMesh!.setMatrixAt(i, scratchMtx);
      });
      if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
      courseRoot.add(crowdMesh);
    }
    const bloomColors = [0x9b1c1f, 0xfffaf0, 0xc8424c, 0xffffff, 0xf3e4cb];
    let flowerIndex = 0;
    let bushIndex = 0;
    for (let i = 2; course.id !== 'hoover' && i < course.path.length - 2; i += 4) {
      const point = course.path[i];
      const before = course.path[i - 1], after = course.path[i + 1];
      const dx = after.x - before.x, dz = after.z - before.z;
      const length = Math.hypot(dx, dz) || 1;
      const nx = dz / length, nz = -dx / length;
      for (const side of [-1, 1]) {
        if (flowerIndex >= flowerCount) break;
        const x = point.x + nx * side * 12.2;
        const z = point.z + nz * side * 12.2;
        const bankY = bankSurfaceY(x, z, point.y);
        setMtx(scratchMtx, x, bankY + 0.16, z, 1, 0.72, 1);
        flowerMesh.setMatrixAt(flowerIndex, scratchMtx);
        flowerMesh.setColorAt(flowerIndex, tmpC.setHex(bloomColors[(i + (side > 0 ? 2 : 0)) % bloomColors.length]));
        setMtx(scratchMtx, x, bankY + 0.29, z, 1, 1, 1);
        flowerCenterMesh.setMatrixAt(flowerIndex, scratchMtx);
        flowerIndex++;
      }
      if (i % 8 === 2 && bushIndex < (touch ? 10 : 18)) {
        const side = i % 3 === 0 ? 1 : -1;
        const x = point.x + nx * side * 11.4;
        const z = point.z + nz * side * 11.4;
        setMtx(scratchMtx, x, bankSurfaceY(x, z, point.y) + 1.35, z, 1.8, 1.35, 1.8);
        bushMesh.setMatrixAt(bushIndex, scratchMtx);
        bushMesh.setColorAt(bushIndex, tmpC.setHex(bushIndex % 2 ? 0x68ab5e : 0x82bd6d));
        bushIndex++;
      }
    }
    flowerMesh.count = flowerIndex;
    flowerCenterMesh.count = flowerIndex;
    bushMesh.count = bushIndex;
    flowerMesh.instanceMatrix.needsUpdate = flowerCenterMesh.instanceMatrix.needsUpdate = bushMesh.instanceMatrix.needsUpdate = true;
    if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
    if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
    courseRoot.add(flowerMesh, flowerCenterMesh, bushMesh);
    waterY = course.killY + 5;
    water.position.set(center.x, waterY, center.z);
    shore.position.set(center.x, 0.2, center.z);
    shore.scale.set(center.r + 25, center.r + 25, 1);
    scene.fog = new THREE.Fog(pal.fog, center.r * 0.9 + 60, center.r * 2.4 + 200);
  }
  // ---------------------------------------------------------------- players
  const beanProfile = [
    new THREE.Vector2(0, -0.62), new THREE.Vector2(0.22, -0.59), new THREE.Vector2(0.38, -0.48),
    new THREE.Vector2(0.48, -0.3), new THREE.Vector2(0.51, -0.08), new THREE.Vector2(0.49, 0.16),
    new THREE.Vector2(0.42, 0.36), new THREE.Vector2(0.31, 0.52), new THREE.Vector2(0.17, 0.62),
    new THREE.Vector2(0.07, 0.66), new THREE.Vector2(0, 0.67),
  ];
  const beanGeo = keepG(new THREE.LatheGeometry(beanProfile, touch ? 16 : 24));
  beanGeo.computeVertexNormals();
  const gownProfile = [
    new THREE.Vector2(0, 0), new THREE.Vector2(0.39, 0.025), new THREE.Vector2(0.5, 0.12),
    new THREE.Vector2(0.55, 0.27), new THREE.Vector2(0.53, 0.45), new THREE.Vector2(0.48, 0.65),
    new THREE.Vector2(0.38, 0.84), new THREE.Vector2(0.26, 1.02), new THREE.Vector2(0.13, 1.09),
    new THREE.Vector2(0, 1.1),
  ];
  const gownGeo = keepG(new THREE.LatheGeometry(gownProfile, touch ? 12 : 18));
  gownGeo.computeVertexNormals();
  const beanMat = mat(toon(0xffffff, { flatShading: false }));
  const robeMat = mat(toon(CARDINAL, { side: THREE.DoubleSide, flatShading: false }));
  const outlineMat = mat(toon(0x2a1e3a, { side: THREE.BackSide }));
  const boardMat = mat(toon(0x1d1d26));
  const goldMat = mat(toon(0xffd23f));
  const parts = {
    bean: new THREE.InstancedMesh(beanGeo, beanMat, MAX_PLAYERS),
    gown: new THREE.InstancedMesh(gownGeo, robeMat, MAX_PLAYERS),
    beanOutline: new THREE.InstancedMesh(beanGeo, outlineMat, MAX_PLAYERS),
    gownOutline: new THREE.InstancedMesh(gownGeo, outlineMat, MAX_PLAYERS),
    face: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 9 : 14, touch ? 6 : 10)), mat(toon(0xfff4e6)), MAX_PLAYERS),
    board: new THREE.InstancedMesh(keepG(new THREE.BoxGeometry(0.64, 0.06, 0.64)), boardMat, MAX_PLAYERS),
    button: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(0.055, touch ? 6 : 9, touch ? 4 : 6)), goldMat, MAX_PLAYERS),
    skull: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 8 : 12, touch ? 5 : 8)), boardMat, MAX_PLAYERS),
    tassel: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.045, 0.42, 2, touch ? 6 : 9)), mat(toon(0xffffff)), MAX_PLAYERS),
    arm: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.1, 0.3, 3, touch ? 7 : 10)), mat(toon(0xffffff)), MAX_PLAYERS * 2),
    sleeve: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.13, 0.28, 2, touch ? 6 : 9)), robeMat, MAX_PLAYERS * 2),
    hand: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(0.13, touch ? 6 : 9, touch ? 5 : 7)), beanMat, MAX_PLAYERS * 2),
    foot: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.11, 0.18, 2, touch ? 7 : 10)), mat(toon(0x242536)), MAX_PLAYERS * 2),
    eye: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 8 : 12, touch ? 6 : 9)), mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), MAX_PLAYERS * 2),
    pupil: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 6 : 9, touch ? 5 : 7)), mat(new THREE.MeshBasicMaterial({ color: 0x1b1b22 })), MAX_PLAYERS * 2),
    highlight: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 6 : 8, touch ? 4 : 6)), mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), MAX_PLAYERS * 2),
    smile: new THREE.InstancedMesh(keepG(new THREE.TorusGeometry(0.085, 0.016, 4, touch ? 9 : 14, Math.PI)), mat(new THREE.MeshBasicMaterial({ color: 0x542c36 })), MAX_PLAYERS),
    shadow: new THREE.InstancedMesh(keepG(new THREE.CircleGeometry(0.72, touch ? 12 : 18)), mat(new THREE.MeshBasicMaterial({ color: 0xffffff, map: shadowTex, transparent: true, opacity: 1, depthWrite: false })), MAX_PLAYERS),
  };
  for (const p of Object.values(parts)) {
    p.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p.frustumCulled = false;
    p.count = 0;
    scene.add(p);
  }
  let looks: PlayerLook[] = [];
  const anim = Array.from({ length: MAX_PLAYERS }, () => ({ pitch: 0, roll: 0, lift: 0, bob: 0, swing: 0, spin: 0, state: 'run', squash: 0 }));
  const white = new THREE.Color(0xffffff);
  function setPlayers(list: PlayerLook[]) {
    looks = list.slice(0, MAX_PLAYERS);
    looks.forEach((l, i) => {
      tmpC.setHex(l.color);
      parts.bean.setColorAt(i, tmpC);
      parts.tassel.setColorAt(i, tmpC);
      parts.arm.setColorAt(i * 2, tmpC);
      parts.arm.setColorAt(i * 2 + 1, tmpC);
      parts.hand.setColorAt(i * 2, tmpC);
      parts.hand.setColorAt(i * 2 + 1, tmpC);
      parts.foot.setColorAt(i * 2, tmpC2.copy(tmpC).lerp(white, 0.18));
      parts.foot.setColorAt(i * 2 + 1, tmpC2.copy(tmpC));
    });
    for (let i = 0; i < MAX_PLAYERS * 2; i++) {
      parts.eye.setColorAt(i, white);
      parts.pupil.setColorAt(i, white);
    }
    if (parts.bean.instanceColor) parts.bean.instanceColor.needsUpdate = true;
    if (parts.tassel.instanceColor) parts.tassel.instanceColor.needsUpdate = true;
    if (parts.arm.instanceColor) parts.arm.instanceColor.needsUpdate = true;
    if (parts.hand.instanceColor) parts.hand.instanceColor.needsUpdate = true;
    if (parts.foot.instanceColor) parts.foot.instanceColor.needsUpdate = true;
  }

  const bodyM = new THREE.Matrix4();
  const partM = new THREE.Matrix4();
  const local = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    setMtx(new THREE.Matrix4(), x, y, z, sx, sy, sz, yaw, pitch, roll);
  const L = {
    bean: local(0, 0.9, 0, 1.13, 1.04, 1.13),
    gown: local(0, 0.14, 0, 1.08, 1.08, 1.08),
    face: local(0, 1.12, 0.48, 0.34, 0.39, 0.05),
    board: local(0, 1.65, 0, 1, 1, 1, 0, -0.08),
    button: local(0, 1.69, 0, 1, 1, 1),
    skull: local(0, 1.52, 0, 0.29, 0.12, 0.29, 0, -0.08),
    eyeL: local(-0.13, 1.15, 0.515, 0.075, 0.095, 0.025),
    eyeR: local(0.13, 1.15, 0.515, 0.075, 0.095, 0.025),
    pupL: local(-0.13, 1.15, 0.54, 0.055, 0.075, 0.025),
    pupR: local(0.13, 1.15, 0.54, 0.055, 0.075, 0.025),
    hiL: local(-0.15, 1.18, 0.564, 0.018, 0.024, 0.01),
    hiR: local(0.11, 1.18, 0.564, 0.018, 0.024, 0.01),
    smile: local(0, 1.03, 0.55, 0.82, 0.8, 0.8, 0, 0, Math.PI),
  };
  let clock = 0;
  function placePlayers(course: Course, bodies: readonly (BodyView | null)[], dt: number) {
    let n = 0;
    for (let i = 0; i < looks.length; i++) {
      const id = looks[i].id;
      const b = bodies[id];
      if (!b) continue;
      const a = anim[i];
      const speed = Math.hypot(b.vx, b.vz);
      if (b.state === 'run' && a.state !== 'run') dustBurst(b.x, b.y, b.z, 5);
      else if ((b.state === 'dive' && a.state !== 'dive') || b.squash > a.squash + 0.18) dustBurst(b.x, b.y, b.z, 3);
      a.state = b.state;
      a.squash = b.squash;
      const lying = b.state === 'dive' || b.state === 'flop';
      a.pitch = damp(a.pitch, lying ? Math.PI / 2 * 0.92 : b.state === 'stun' ? Math.PI / 2 * 0.7 : Math.min(0.25, speed * 0.02), lying ? 18 : 10, dt);
      a.spin = b.state === 'stun' || b.state === 'flop' ? a.spin + dt * (b.state === 'stun' ? 9 : 7) : damp(a.spin, 0, 8, dt);
      a.lift = damp(a.lift, lying || b.state === 'stun' ? 0.4 : 0, 14, dt);
      a.bob += dt * speed * 2.2;
      const ground = b.state === 'run' && speed > 0.5;
      let turn = Math.atan2(b.vx, b.vz) - b.yaw;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      a.roll = damp(a.roll, ground ? Math.sin(a.bob) * 0.13 + Math.max(-0.8, Math.min(0.8, turn)) * 0.24 : 0, 12, dt);
      a.swing = damp(a.swing, Math.max(-1, Math.min(1, -b.vy * 0.06 + speed * 0.05)), 6, dt);
      const s = b.squash + (ground ? Math.abs(Math.sin(a.bob)) * 0.095 : 0);
      const sy = 1 - s;
      const sxz = 1 + s * 0.55;
      bodyM.compose(tmpV.set(b.x, b.y, b.z), tmpQ.setFromEuler(tmpE.set(0, b.yaw, 0, 'YXZ')), tmpS.set(1, 1, 1));
      bodyM.multiply(setMtx(scratchMtx, 0, a.lift, 0, 1, 1, 1, 0, a.pitch, a.roll + Math.sin(a.spin) * 0.6))
        .multiply(setMtx(scratchMtx, 0, 0, 0, sxz, sy, sxz));
      parts.bean.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.bean));
      parts.beanOutline.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.bean).multiply(setMtx(scratchMtx, 0, 0, 0, 1.025, 1.025, 1.025)));
      parts.gown.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.gown));
      parts.gownOutline.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.gown).multiply(setMtx(scratchMtx, 0, 0, 0, 1.025, 1.025, 1.025)));
      parts.face.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.face));
      parts.board.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.board));
      parts.button.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.button));
      parts.skull.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.skull));
      parts.tassel.setMatrixAt(n, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, 0.3, 1.5, 0.08, 1, 1.25, 1, 0, 0, -a.swing * 1.45)));
      const armsUp = b.state === 'air' || b.state === 'dive';
      const armAngle = lying || b.state === 'stun' ? Math.sin(a.spin * 2.2) * 1.05 : armsUp ? 0.85 : Math.sin(a.bob) * 0.48;
      const footKick = lying || b.state === 'stun' ? Math.sin(a.spin * 2.7) * 0.6 : 0;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const armRoll = -sign * (armAngle + Math.sin(a.spin + side) * (lying ? 0.35 : 0));
        parts.arm.setMatrixAt(n * 2 + side, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, sign * 0.4, 0.75, 0.01, 0.92, 1, 0.92, 0, 0, armRoll)));
        parts.sleeve.setMatrixAt(n * 2 + side, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, sign * 0.4, 0.78, 0.01, 1.03, 0.97, 1.03, 0, 0, armRoll)));
        parts.hand.setMatrixAt(n * 2 + side, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, sign * 0.56, 0.57, 0.06, 0.85, 0.85, 0.85, 0, 0, armRoll)));
        const phase = a.bob + side * Math.PI;
        const footPitch = Math.PI / 2 + (ground ? Math.sin(phase) * 0.48 : armsUp ? 0.28 : footKick);
        parts.foot.setMatrixAt(n * 2 + side, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, sign * 0.22, 0.1, 0.34, 0.92, 0.72, 0.92, 0, footPitch)));
      }
      const blink = Math.sin(clock * 1.3 + i * 2.1) > 0.985 ? 0.15 : 1;
      parts.eye.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.eyeL).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.eye.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.eyeR).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.pupil.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.pupL).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.pupil.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.pupR).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.highlight.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.hiL));
      parts.highlight.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.hiR));
      parts.smile.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.smile));
      if (parts.bean.instanceColor) {
        tmpC.setHex(looks[i].color);
        parts.bean.setColorAt(n, tmpC);
        parts.tassel.setColorAt(n, tmpC);
        parts.arm.setColorAt(n * 2, tmpC);
        parts.arm.setColorAt(n * 2 + 1, tmpC);
        parts.hand.setColorAt(n * 2, tmpC);
        parts.hand.setColorAt(n * 2 + 1, tmpC);
        parts.foot.setColorAt(n * 2, tmpC2.copy(tmpC).lerp(white, 0.18));
        parts.foot.setColorAt(n * 2 + 1, tmpC2.copy(tmpC));
      }
      const gy = groundBelow(course, b.x, b.y + 0.3, b.z, 12);
      if (gy !== null) {
        const h = Math.max(0, b.y - gy);
        const k = Math.max(0.25, 1 - h * 0.12);
        parts.shadow.setMatrixAt(n, setMtx(scratchMtx, b.x, gy + 0.04, b.z, k, k, k, 0, -Math.PI / 2));
      } else parts.shadow.setMatrixAt(n, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
      n++;
    }
    for (const p of Object.values(parts)) {
      p.count = p === parts.eye || p === parts.pupil || p === parts.highlight || p === parts.arm || p === parts.sleeve || p === parts.hand || p === parts.foot ? n * 2 : n;
      p.instanceMatrix.needsUpdate = true;
    }
    if (parts.bean.instanceColor) parts.bean.instanceColor.needsUpdate = true;
    if (parts.tassel.instanceColor) parts.tassel.instanceColor.needsUpdate = true;
    if (parts.arm.instanceColor) parts.arm.instanceColor.needsUpdate = true;
    if (parts.hand.instanceColor) parts.hand.instanceColor.needsUpdate = true;
    if (parts.foot.instanceColor) parts.foot.instanceColor.needsUpdate = true;
  }
  // ---------------------------------------------------------------- confetti and splashes
  const confettiMesh = new THREE.InstancedMesh(keepG(new THREE.PlaneGeometry(0.16, 0.26)), mat(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), CONFETTI);
  confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confettiMesh.frustumCulled = false;
  scene.add(confettiMesh);
  const bits = Array.from({ length: CONFETTI }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 0, vr: 0, life: 0 }));
  const confettiColors = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb388ff, 0xff8fab, 0xffffff, CARDINAL];
  for (let i = 0; i < CONFETTI; i++) confettiMesh.setColorAt(i, tmpC.setHex(confettiColors[i % confettiColors.length]));
  if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
  for (let i = 0; i < CONFETTI; i++) confettiMesh.setMatrixAt(i, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
  confettiMesh.instanceMatrix.needsUpdate = true;
  let nextBit = 0;
  const dropMesh = new THREE.InstancedMesh(keepG(new THREE.IcosahedronGeometry(0.16, 0)), mat(toon(0xd6f6ff)), DROPS);
  dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dropMesh.frustumCulled = false;
  scene.add(dropMesh);
  const drops = Array.from({ length: DROPS }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
  for (let i = 0; i < DROPS; i++) dropMesh.setMatrixAt(i, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
  dropMesh.instanceMatrix.needsUpdate = true;
  let nextDrop = 0;
  const DUST = touch ? 36 : 64;
  const dustMesh = new THREE.InstancedMesh(
    keepG(new THREE.PlaneGeometry(1, 1)),
    mat(new THREE.MeshBasicMaterial({ color: 0xc7b18f, map: shadowTex, transparent: true, opacity: 0.56, depthWrite: false })),
    DUST,
  );
  dustMesh.rotation.x = -Math.PI / 2;
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dustMesh.frustumCulled = false;
  const dust = Array.from({ length: DUST }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
  for (let i = 0; i < DUST; i++) dustMesh.setMatrixAt(i, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
  dustMesh.instanceMatrix.needsUpdate = true;
  scene.add(dustMesh);
  let nextDust = 0;
  const splashRings = Array.from({ length: touch ? 8 : 14 }, () => ({ x: 0, y: -999, z: 0, life: 0 }));
  const splashRingMesh = new THREE.InstancedMesh(foamGeo, foamMat, splashRings.length);
  splashRingMesh.rotation.x = Math.PI / 2;
  splashRingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashRingMesh.frustumCulled = false;
  for (let i = 0; i < splashRings.length; i++) splashRingMesh.setMatrixAt(i, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
  splashRingMesh.instanceMatrix.needsUpdate = true;
  scene.add(splashRingMesh);
  let nextRing = 0;

  function dustBurst(x: number, y: number, z: number, count = 5) {
    for (let i = 0; i < count; i++) {
      const d = dust[nextDust];
      nextDust = (nextDust + 1) % DUST;
      const a = Math.random() * Math.PI * 2;
      Object.assign(d, { x, y: y + 0.05, z, vx: Math.cos(a) * (0.35 + Math.random() * 0.45), vy: 0.35 + Math.random() * 0.45, vz: Math.sin(a) * (0.35 + Math.random() * 0.45), life: 0.45 + Math.random() * 0.3 });
    }
  }

  function confetti(x: number, y: number, z: number, count = 80) {
    for (let i = 0; i < count; i++) {
      const b = bits[nextBit];
      nextBit = (nextBit + 1) % CONFETTI;
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      Object.assign(b, { x, y, z, vx: Math.cos(a) * s, vy: 5 + Math.random() * 7, vz: Math.sin(a) * s, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, life: 2.5 + Math.random() * 1.5 });
    }
  }
  function splash(x: number, y: number, z: number) {
    const ring = splashRings[nextRing];
    nextRing = (nextRing + 1) % splashRings.length;
    Object.assign(ring, { x, y: Math.max(y, waterY) + 0.07, z, life: 0.7 });
    for (let i = 0; i < 18; i++) {
      const d = drops[nextDrop];
      nextDrop = (nextDrop + 1) % DROPS;
      const a = Math.random() * Math.PI * 2;
      Object.assign(d, { x, y, z, vx: Math.cos(a) * 2.5, vy: 4 + Math.random() * 4, vz: Math.sin(a) * 2.5, life: 1.1 });
    }
  }
  function stepParticles(dt: number) {
    let confettiChanged = false;
    for (let i = 0; i < CONFETTI; i++) {
      const b = bits[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.vy -= 7 * dt;
      b.vx *= 1 - dt * 1.4;
      b.vz *= 1 - dt * 1.4;
      b.vy = Math.max(b.vy, -2.2);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.r += b.vr * dt;
      confettiMesh.setMatrixAt(i, b.life > 0
        ? setMtx(scratchMtx, b.x, b.y, b.z, 1, 1, 1, b.r, b.r * 0.7, b.r * 1.3)
        : setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
      confettiChanged = true;
    }
    if (confettiChanged) confettiMesh.instanceMatrix.needsUpdate = true;
    let dropsChanged = false;
    for (let i = 0; i < DROPS; i++) {
      const d = drops[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 18 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const active = d.life > 0;
      const k = active ? Math.min(1, d.life * 2) : 0;
      dropMesh.setMatrixAt(i, setMtx(scratchMtx, d.x, active ? d.y : -999, d.z, k, k, k));
      dropsChanged = true;
    }
    if (dropsChanged) dropMesh.instanceMatrix.needsUpdate = true;
    let dustChanged = false;
    for (let i = 0; i < DUST; i++) {
      const d = dust[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.vy -= 1.4 * dt;
      const k = d.life > 0 ? Math.max(0, d.life * 1.5) : 0;
      dustMesh.setMatrixAt(i, setMtx(scratchMtx, d.x, d.y, d.z, k, k * 0.62, 1));
      dustChanged = true;
    }
    if (dustChanged) dustMesh.instanceMatrix.needsUpdate = true;
    let ringsChanged = false;
    for (let i = 0; i < splashRings.length; i++) {
      const ring = splashRings[i];
      if (ring.life <= 0) continue;
      ring.life -= dt;
      if (ring.life <= 0) {
        splashRingMesh.setMatrixAt(i, setMtx(scratchMtx, ring.x, -999, ring.z, 0, 0, 0));
        ringsChanged = true;
        continue;
      }
      const age = 1 - Math.max(0, ring.life) / 0.7;
      const radius = 0.25 + age * 1.6;
      splashRingMesh.setMatrixAt(i, setMtx(scratchMtx, ring.x, ring.y, ring.z, radius, radius, radius));
      ringsChanged = true;
    }
    if (ringsChanged) splashRingMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- frame
  const camPos = new THREE.Vector3(0, 10, -20);
  const camLook = new THREE.Vector3();
  let camReady = false;
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  let fly = 0;
  const frameMtx = new THREE.Matrix4();
  const cameraTry = new THREE.Vector3();
  function cameraClearance(course: Course, from: T.Vector3, to: T.Vector3): number {
    let fraction = rayCast(course, from, to, true);
    for (const bounds of decorBounds) {
      if (rayBox(from, to, bounds.box) >= fraction) continue;
      for (const part of bounds.parts) {
        decorRayFrom.copy(from).applyMatrix4(part.inverse);
        if (
          decorRayFrom.x >= part.box.minX && decorRayFrom.x <= part.box.maxX &&
          decorRayFrom.y >= part.box.minY && decorRayFrom.y <= part.box.maxY &&
          decorRayFrom.z >= part.box.minZ && decorRayFrom.z <= part.box.maxZ
        ) continue;
        decorRayTo.copy(to).applyMatrix4(part.inverse);
        fraction = Math.min(fraction, rayBox(decorRayFrom, decorRayTo, part.box));
      }
    }
    return fraction;
  }
  function frame(course: Course, t: number, bodies: readonly (BodyView | null)[], focus: number | null, cam: CamState, dt: number) {
    clock += dt;
    const m4 = frameMtx;
    if (fountainArcs && fountainOrigin) {
      const { x, y, z, scale } = fountainOrigin;
      for (let i = 0; i < 3; i++) {
        const phase = clock * 0.24 + i * Math.PI * 2 / 3;
        const swell = 1 + Math.sin(clock * 1.7 + i) * 0.025;
        setMtx(scratchMtx, x, y + scale * 0.68, z, scale * swell, scale, scale * swell, phase);
        fountainArcs.setMatrixAt(i, scratchMtx);
      }
      fountainArcs.instanceMatrix.needsUpdate = true;
      const sprayCount = Math.floor(clock * 7) - Math.floor((clock - dt) * 7);
      for (let i = 0; i < sprayCount * 2; i++) {
        const angle = clock * 2.6 + i * 2.4;
        const radius = scale * (1.65 + (i % 2) * 0.28);
        const drop = drops[nextDrop];
        nextDrop = (nextDrop + 1) % DROPS;
        drop.x = x + Math.cos(angle) * radius;
        drop.y = y + scale * 3.1;
        drop.z = z + Math.sin(angle) * radius;
        drop.vx = Math.cos(angle) * 1.25;
        drop.vy = 2.6 + (i % 3) * 0.25;
        drop.vz = Math.sin(angle) * 1.25;
        drop.life = 0.7;
      }
    }
    for (let i = 0; i < cloudPuffs.length; i++) {
      const puff = cloudPuffs[i];
      const group = Math.floor(i / 4);
      const a = puff.phase + clock * 0.009;
      const radius = center.r + 92 + (group % 4) * 9;
      setMtx(scratchMtx, center.x + Math.cos(a) * radius + puff.x * 2, 37 + (group % 3) * 4 + puff.y * 5,
        center.z + Math.sin(a) * radius + puff.z * 2, puff.scale * 4.6, puff.scale * 1.9, puff.scale * 2.5);
      cloudMesh.setMatrixAt(i, scratchMtx);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
    for (const { c, mesh } of moving) {
      mesh.visible = c.on;
      if (c.on) poseMatrix(c.pose, mesh.matrix);
      mesh.matrixWorldNeedsUpdate = true;
    }
    for (const p of pads) (p.material as T.MeshLambertMaterial).emissive.setRGB(0.3 + Math.sin(clock * 6) * 0.15, 0.18, 0);
    if (crowdMesh) {
      for (let i = 0; i < crowdPeople.length; i++) {
        const person = crowdPeople[i];
        const bounce = Math.sin(clock * 2.4 + person.phase) * 0.08;
        setMtx(scratchMtx, person.x, person.y + bounce, person.z, person.scale * 0.62, person.scale * (0.76 + bounce * 0.18), person.scale * 0.62);
        crowdMesh.setMatrixAt(i, scratchMtx);
      }
      crowdMesh.instanceMatrix.needsUpdate = true;
    }
    if (tiles) {
      const { mesh, cracks, list, base } = tiles;
      let colors = false;
      list.forEach((c, i) => {
        const s = c.shape as { r: number; hy: number };
        if (!c.on) {
          mesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
          cracks.setMatrixAt(i, m4.makeScale(0, 0, 0));
          return;
        }
        const touchedAt = c.tile?.touchedAt;
        const cracking = touchedAt != null && (c.tile?.fallAt == null || t < c.tile.fallAt);
        const crackProgress = cracking ? Math.min(1, Math.max(0.08, (t - touchedAt) / 0.8)) : 0;
        const wobble = cracking ? Math.sin(clock * (24 + crackProgress * 22) + i) * 0.12 * crackProgress : 0;
        poseMatrix(c.pose, m4).multiply(setMtx(scratchMtx, wobble, 0, -wobble, s.r * 1.02, s.hy * 2, s.r * 1.02, 0, crackProgress * Math.sin(clock * 18 + i) * 0.045));
        mesh.setMatrixAt(i, m4);
        if (cracking) {
          const crackScale = 0.18 + crackProgress * 0.82;
          poseMatrix(c.pose, m4).multiply(setMtx(scratchMtx, wobble, s.hy + 0.025, -wobble, s.r * 0.88 * crackScale, 1, s.r * 0.88 * crackScale));
          cracks.setMatrixAt(i, m4);
        } else cracks.setMatrixAt(i, m4.makeScale(0, 0, 0));
        const wantC = c.tile?.touchedAt != null ? 0xff8a65 : base[i];
        mesh.getColorAt(i, tmpC);
        if (tmpC.getHex() !== wantC) {
          tmpC.setHex(wantC);
          mesh.setColorAt(i, tmpC);
          colors = true;
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      cracks.instanceMatrix.needsUpdate = true;
      if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (let jetIndex = 0; jetIndex < jets.length; jetIndex++) {
      const { z, mesh, foam } = jets[jetIndex];
      const on = z.on?.(t) ?? true;
      const h = z.hy * 2;
      mesh.visible = on;
      foam.visible = on;
      if (on) {
        const p = z.push ?? { x: 0, y: 0, z: 0 };
        const sideways = Math.abs(p.x) + Math.abs(p.z) > Math.abs(p.y);
        foam.position.set(z.x, z.y - z.hy + 0.08, z.z);
        const foamSize = 0.78 + Math.sin(clock * 8 + jetIndex) * 0.05;
        foam.scale.set(foamSize, foamSize, foamSize);
        if (sideways) {
          const yaw = Math.atan2(-p.z, p.x);
          mesh.position.set(z.x, z.y - z.hy + 0.08, z.z);
          mesh.rotation.set(0, yaw + Math.sin(clock * 5 + jetIndex) * 0.035, 0);
          mesh.scale.set(0.85 + Math.sin(clock * 7 + jetIndex) * 0.04, 0.92 + Math.sin(clock * 6 + jetIndex) * 0.08, 0.85);
        } else {
          mesh.position.set(z.x, z.y - z.hy + 0.08, z.z);
          mesh.rotation.set(0, 0, 0);
          mesh.scale.set(0.85, Math.max(0.8, h / 2.55), 0.85);
        }
        if (Math.floor(clock * 5 + jetIndex * 0.23) !== Math.floor((clock - dt) * 5 + jetIndex * 0.23)) {
          const d = drops[nextDrop];
          nextDrop = (nextDrop + 1) % DROPS;
          Object.assign(d, {
            x: z.x + (Math.random() - 0.5) * z.hx,
            y: z.y + z.hy * 2,
            z: z.z + (Math.random() - 0.5) * z.hz,
            vx: (Math.random() - 0.5) * 1.2,
            vy: 1.2 + Math.random() * 1.6,
            vz: (Math.random() - 0.5) * 1.2,
            life: 0.55 + Math.random() * 0.25,
          });
        }
      }
    }
    if (crown) {
      crown.rotation.y = clock * 0.6;
      crown.position.y = (course.zones.find((z) => z.kind === 'crown')?.y ?? 0) + 0.8 + Math.sin(clock * 2) * 0.15;
    }
    water.position.y = waterY + Math.sin(clock * 0.8) * 0.05;
    placePlayers(course, bodies, dt);
    stepParticles(dt);

    const target = focus !== null ? bodies[focus] : null;
    const devLookAt = !target ? cam.lookAt : undefined;
    const cameraDistance = course.id === 'hoover' ? Math.min(cam.dist, devLookAt ? 36 : 12) : cam.dist;
    if (target || devLookAt) {
      const cp = Math.cos(cam.pitch);
      if (target) {
        const lookY = (import.meta.env.DEV ? cam.lookY ?? 0 : 0) + (course.id === 'hoover' ? 1.5 : 0);
        look.set(
          target.x + Math.sin(course.startYaw) * 3,
          target.y + 1.2 + lookY,
          target.z + Math.cos(course.startYaw) * 3,
        );
      } else if (devLookAt) {
        look.set(devLookAt.x, devLookAt.y, devLookAt.z);
      }
      want.set(look.x - Math.sin(cam.yaw) * cp * cameraDistance, look.y + Math.sin(cam.pitch) * cameraDistance, look.z - Math.cos(cam.yaw) * cp * cameraDistance);
      let f = cameraClearance(course, look, want);
      if (f < 0.85) {
        for (const offset of CAMERA_ORBITS) {
          const yaw = cam.yaw + offset;
          cameraTry.set(
            look.x - Math.sin(yaw) * cp * cameraDistance,
            look.y + Math.sin(cam.pitch) * cameraDistance,
            look.z - Math.cos(yaw) * cp * cameraDistance,
          );
          const candidate = cameraClearance(course, look, cameraTry);
          if (candidate > f) {
            f = candidate;
            want.copy(cameraTry);
          }
          if (f >= 0.98) break;
        }
      }
      if (f < 1) want.lerpVectors(look, want, Math.max(0.04, f - 0.08));
      const ground = groundBelow(course, want.x, want.y, want.z);
      if (ground !== null && want.y < ground + 0.5) want.y = ground + 0.5;
      if (!camReady) {
        camPos.copy(want);
        camLook.copy(look);
        camReady = true;
      } else if (cameraClearance(course, look, camPos) < 0.98) {
        camPos.copy(want);
      } else {
        camPos.x = damp(camPos.x, want.x, 9, dt);
        camPos.y = damp(camPos.y, want.y, 7, dt);
        camPos.z = damp(camPos.z, want.z, 9, dt);
      }
      if (f < 1) camPos.lerp(want, 0.5);
      camLook.x = damp(camLook.x, look.x, 14, dt);
      camLook.y = damp(camLook.y, look.y, 10, dt);
      camLook.z = damp(camLook.z, look.z, 14, dt);
    } else {
      fly += dt * 0.12;
      const r = Math.min(70, center.r * 0.7);
      camPos.set(center.x + Math.sin(fly) * r, 26 + center.r * 0.12, center.z + Math.cos(fly) * r);
      camLook.set(center.x, 0, center.z);
      camReady = false;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    sky.position.copy(camPos);
    camera.updateMatrixWorld(true);
  }

  let w = 1;
  let h = 1;
  const v = new THREE.Vector3();
  const view: View = {
    gl,
    resize(nw, nh) {
      w = Math.max(1, nw);
      h = Math.max(1, nh);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 75 : 65;
      camera.updateProjectionMatrix();
    },
    setCourse,
    setPlayers,
    frame,
    project(x, y, z) {
      v.set(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    },
    confetti,
    splash,
    render() {
      if (gl.lost()) return;
      renderer.render(scene, camera);
    },
    dispose() {
      clearCourse();
      disposeTree(scene);
      for (const g of own) g.dispose();
      for (const m of mats) m.dispose();
      for (const texture of textures) texture.dispose();
      gl.dispose();
    },
  };
  return view;
}

export function createScene(THREE: Three, host: HTMLElement, touch: boolean): View | null {
  return build(THREE, host, touch);
}
