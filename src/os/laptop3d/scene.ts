import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { KD, KW, drawGrille, drawLegends, layoutKeys } from './keyboard';

// MacBook Pro 14" proportions, in centimetres.
const BW = 31.26;
const BD = 22.12;
const FOOT = 0.06;
const BT = 0.95;
const BH = FOOT + BT;
const LW = BW;
const LH = 21.3;
const LT = 0.48;
const LY0 = 0.5;
const HZ = -BD / 2 + 0.42;
const HY = BH + 0.02;
const DW = 30.24;
export const DA = 3024 / 1964;
const DH = DW / DA;
const DCY = LY0 + LH - 0.42 - DH / 2;
const OPEN = 106;
const FOV = 22;
const KZ0 = -BD / 2 + 1.15;
const TPW = 13.5;
const TPD = 7.9;
const TPZ = BD / 2 - 1.15 - TPD / 2;
const DEG = Math.PI / 180;
const PX = 110;

export type StickerPlacement = { key: string; left: string; top: string; width: string; rot: number };
export type PalmPlacement = { key: string; x: number; z: number; w: number; rot: number };

export type LaptopOptions = {
  container: HTMLElement;
  host: HTMLElement;
  fsLayer: HTMLElement;
  stickerSource: HTMLElement;
  lid: readonly StickerPlacement[];
  palm: readonly PalmPlacement[];
  onPalm: (key: string) => void;
  onBody: () => boolean;
  /** Called once shaders are compiled and the first frame is on screen. */
  onReady: () => void;
};

export type LaptopController = {
  setOpen(open: boolean, ms: number): Promise<void>;
  setScreenOn(on: boolean): void;
  enterFs(swap: () => void): Promise<void>;
  exitFs(swap: () => void): Promise<void>;
  dispose(): void;
};

type Pose = { pos: THREE.Vector3; target: THREE.Vector3; off: number };

export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 10; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 20 && Math.abs(sx(t) - x) > 1e-5; i++) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** Lid easing: a little resistance from the hinge, then a long gentle settle. */
const easeLid = cubicBezier(0.5, 0.02, 0.18, 1);
const easeCam = cubicBezier(0.45, 0, 0.2, 1);
const easeZoom = cubicBezier(0.4, 0, 0.15, 1);

function rrect(w: number, h: number, r: number, rb = r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  s.moveTo(x0 + rb, y0);
  s.lineTo(x1 - rb, y0);
  s.absarc(x1 - rb, y0 + rb, rb, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rb);
  s.absarc(x0 + rb, y0 + rb, rb, Math.PI, Math.PI * 1.5, false);
  return s;
}

function canvasTex(c: HTMLCanvasElement, aniso: number, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function noise(size: number, lo: number, hi: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = lo + Math.random() * (hi - lo);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Rasterises a sticker's SVG (text drawn with canvas so the page's web fonts are used). */
async function svgTexture(svg: SVGSVGElement, aniso: number) {
  const vb = svg.viewBox.baseVal;
  const vw = vb?.width || 100;
  const vh = vb?.height || 100;
  const k = 1024 / Math.max(vw, vh);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(vw * k)));
  clone.setAttribute('height', String(Math.round(vh * k)));
  const texts = [...clone.querySelectorAll('text')].map((t) => {
    const cs = getComputedStyle(svg.querySelectorAll('text')[[...clone.querySelectorAll('text')].indexOf(t)] ?? t);
    t.remove();
    return {
      s: t.textContent ?? '',
      x: +(t.getAttribute('x') ?? 0),
      y: +(t.getAttribute('y') ?? 0),
      fill: t.getAttribute('fill') ?? '#fff',
      size: +(t.getAttribute('font-size') ?? 16),
      weight: t.getAttribute('font-weight') ?? '400',
      ls: +(t.getAttribute('letter-spacing') ?? 0),
      family: t.getAttribute('font-family') ?? cs.fontFamily,
    };
  });
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(vw * k);
    c.height = Math.round(vh * k);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, c.width, c.height);
    g.scale(k, k);
    for (const t of texts) {
      g.fillStyle = t.fill;
      g.font = `${t.weight} ${t.size}px ${t.family}`;
      (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.ls}px`;
      g.textBaseline = 'alphabetic';
      g.fillText(t.s, t.x, t.y);
    }
    return { tex: canvasTex(c, aniso), aspect: vw / vh };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createLaptop(o: LaptopOptions): LaptopController {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'l3d-gl';
  o.container.appendChild(renderer.domElement);

  const css = new CSS3DRenderer();
  css.domElement.className = 'l3d-css';
  css.domElement.style.pointerEvents = 'none';
  o.container.appendChild(css.domElement);
  // Focus inside the projected screen would otherwise scroll the overflow:hidden roots and shift the display.
  const unscroll = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.scrollLeft || t.scrollTop) t.scrollLeft = t.scrollTop = 0;
  };
  for (const el of [o.container, css.domElement]) el.addEventListener('scroll', unscroll);

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let dirty = true;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTex = keep(pmrem.fromScene(room, 0.035).texture);
  room.dispose();
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.85;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);

  // ---------------------------------------------------------------- materials
  const grain = keep(canvasTex(noise(256, 205, 255), aniso, false));
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(0.3, 0.3);
  const alu = keep(
    new THREE.MeshPhysicalMaterial({ color: '#bcbcbd', metalness: 1, roughness: 0.46, roughnessMap: grain, envMapIntensity: 0.85 }),
  );
  const black = keep(new THREE.MeshStandardMaterial({ color: '#08080a', roughness: 0.75 }));
  const keyMat = keep(new THREE.MeshStandardMaterial({ color: '#09090b', roughness: 0.62, metalness: 0 }));
  // Lit glass picks up the studio environment and reads as silver; the real bezel is a deep black.
  const glass = keep(new THREE.MeshBasicMaterial({ color: '#050506' }));
  const panel = keep(new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.18, metalness: 0, envMapIntensity: 0.05 }));
  const hingeMat = keep(new THREE.MeshPhysicalMaterial({ color: '#232428', metalness: 0.8, roughness: 0.36 }));
  const padMat = keep(
    new THREE.MeshPhysicalMaterial({ color: '#a4a5a8', metalness: 0.7, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.75 }),
  );

  const root = new THREE.Group();
  scene.add(root);
  const shadowed = (m: THREE.Mesh, cast = true, receive = true) => ((m.castShadow = cast), (m.receiveShadow = receive), m);

  // ---------------------------------------------------------------- base
  const bev = 0.14;
  const baseShape = rrect(BW - 2 * bev, BD - 2 * bev, 0.95);
  baseShape.holes.push(rrect(KW + 0.36, KD + 0.36, 0.32, 0.32, 0, -(KZ0 + KD / 2)));
  const baseGeo = keep(
    new THREE.ExtrudeGeometry(baseShape, { depth: BT - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 6, curveSegments: 28 }),
  );
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate(0, FOOT + bev, 0);
  const base = shadowed(new THREE.Mesh(baseGeo, alu));
  root.add(base);

  const well = new THREE.Mesh(keep(new THREE.PlaneGeometry(KW + 0.4, KD + 0.4)), black);
  well.rotation.x = -Math.PI / 2;
  well.position.set(0, BH - 0.12, KZ0 + KD / 2);
  root.add(shadowed(well, false));
  // keys
  const keys = layoutKeys();
  const keyGeos = new Map<string, THREE.BufferGeometry>();
  const keyGroup = new THREE.Group();
  for (const k of keys) {
    const id = `${k.w.toFixed(3)}x${k.d.toFixed(3)}`;
    let geo = keyGeos.get(id);
    if (!geo) keyGeos.set(id, (geo = keep(new RoundedBoxGeometry(k.w, 0.12, k.d, 3, 0.06))));
    const m = new THREE.Mesh(geo, keyMat);
    m.position.set(-KW / 2 + k.x, BH - 0.12 + 0.06 + 0.035, KZ0 + k.z);
    keyGroup.add(shadowed(m));
  }
  root.add(keyGroup);
  const legendTex = keep(canvasTex(drawLegends(keys, PX), aniso));
  const legends = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(KW, KD)),
    keep(new THREE.MeshStandardMaterial({ map: legendTex, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })),
  );
  legends.rotation.x = -Math.PI / 2;
  legends.position.set(0, BH - 0.12 + 0.035 + 0.122, KZ0 + KD / 2);
  root.add(legends);

  // trackpad: flush glass with a thin dark seam
  const seamShape = rrect(TPW + 0.07, TPD + 0.07, 0.64);
  seamShape.holes.push(rrect(TPW - 0.02, TPD - 0.02, 0.6));
  const seam = new THREE.Mesh(keep(new THREE.ShapeGeometry(seamShape, 24)), keep(new THREE.MeshBasicMaterial({ color: '#5d5e62', polygonOffset: true, polygonOffsetFactor: -2 })));
  seam.rotation.x = -Math.PI / 2;
  seam.position.set(0, BH + 0.001, TPZ);
  root.add(seam);
  const pad = new THREE.Mesh(keep(new THREE.ShapeGeometry(rrect(TPW - 0.02, TPD - 0.02, 0.6), 24)), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, BH + 0.002, TPZ);
  pad.receiveShadow = true;
  root.add(pad);
  padMat.polygonOffset = true;
  padMat.polygonOffsetFactor = -3;

  // speaker grilles
  const gw = 1.05;
  const grilleTex = keep(canvasTex(drawGrille(gw, KD, PX * 2), aniso));
  const grilleMat = keep(new THREE.MeshStandardMaterial({ map: grilleTex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const grilleGeo = keep(new THREE.PlaneGeometry(gw, KD));
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(grilleGeo, grilleMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(side * (KW / 2 + 0.6 + gw / 2), BH + 0.001, KZ0 + KD / 2);
    root.add(g);
  }

  // hinge
  const hinge = shadowed(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.43, 0.43, LW - 3.4, 40)), hingeMat));
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, HY - 0.06, HZ);
  root.add(hinge);

  // ground: soft contact shadow + cast shadow
  const ao = document.createElement('canvas');
  ao.width = ao.height = 256;
  {
    const g = ao.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.8)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  const aoMesh = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(BW * 1.18, BD * 1.25)),
    keep(new THREE.MeshBasicMaterial({ map: keep(canvasTex(ao, aniso)), transparent: true, depthWrite: false })),
  );
  aoMesh.rotation.x = -Math.PI / 2;
  aoMesh.position.y = 0.002;
  root.add(aoMesh);
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 400)), keep(new THREE.ShadowMaterial({ opacity: 0.3 })));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // ---------------------------------------------------------------- lid
  const lid = new THREE.Group();
  lid.position.set(0, HY, HZ);
  root.add(lid);
  const lb = 0.1;
  const lidGeo = keep(
    new THREE.ExtrudeGeometry(rrect(LW - 2 * lb, LH - 2 * lb, 0.95, 0.35, 0, LY0 + LH / 2), {
      depth: LT - 2 * lb,
      bevelEnabled: true,
      bevelThickness: lb,
      bevelSize: lb,
      bevelSegments: 5,
      curveSegments: 28,
    }),
  );
  lidGeo.translate(0, 0, -(LT - lb));
  lid.add(shadowed(new THREE.Mesh(lidGeo, alu)));
  const bezel = new THREE.Mesh(keep(new THREE.ShapeGeometry(rrect(LW - 0.28, LH - 0.28, 0.84, 0.26, 0, LY0 + LH / 2), 28)), glass);
  bezel.position.z = 0.004;
  lid.add(bezel);
  const display = new THREE.Mesh(keep(new THREE.ShapeGeometry(rrect(DW, DH, 0.32, 0.06, 0, DCY), 20)), panel);
  display.position.z = 0.007;
  lid.add(display);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, DCY, 0.012);
  lid.add(anchor);
  const screenLight = new THREE.RectAreaLight('#e8eeff', 0, DW, DH);
  screenLight.rotation.y = Math.PI;
  anchor.add(screenLight);

  // apple-style mirror logo on the back
  {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.font = '700 200px Inter, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '-8px';
    g.fillText('jk', 256, 120);
    const logo = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(3.4, 1.7)),
      keep(
        new THREE.MeshPhysicalMaterial({ color: '#e8e9ec', alphaMap: keep(canvasTex(c, aniso, false)), transparent: true, metalness: 1, roughness: 0.08, polygonOffset: true, polygonOffsetFactor: -2 }),
      ),
    );
    logo.rotation.x = Math.PI;
    logo.position.set(0, LY0 + LH / 2, -LT - 0.002);
    lid.add(logo);
  }

  const css3d = document.createElement('div');
  css3d.className = 'l3d-display';
  css3d.appendChild(o.host);
  const cssObj = new CSS3DObject(css3d);
  anchor.add(cssObj);

  // ---------------------------------------------------------------- stickers
  const palmMeshes: THREE.Mesh[] = [];
  const lift = new Map<THREE.Mesh, { cur: number; to: number; y: number }>();
  const stickerMat = (tex: THREE.Texture) =>
    keep(
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.72, envMapIntensity: 0.35, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
  const stickersDone = (async () => {
    await document.fonts?.ready;
    const art = (key: string) => o.stickerSource.querySelector<SVGSVGElement>(`[data-sticker="${key}"] svg`);
    for (const s of o.lid) {
      const svg = art(s.key);
      if (!svg) continue;
      const { tex, aspect } = await svgTexture(svg, aniso);
      const w = (parseFloat(s.width) / 100) * LW;
      const h = w / aspect;
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), stickerMat(tex));
      m.rotation.set(Math.PI, 0, -s.rot * DEG);
      m.position.set(-LW / 2 + (parseFloat(s.left) / 100) * LW + w / 2, LY0 + (parseFloat(s.top) / 100) * LH + h / 2, -LT - 0.004);
      lid.add(m);
    }
    for (const s of o.palm) {
      const svg = art(s.key);
      if (!svg) continue;
      const { tex, aspect } = await svgTexture(svg, aniso);
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(s.w, s.w / aspect)), stickerMat(tex));
      m.rotation.set(-Math.PI / 2, 0, -s.rot * DEG);
      m.position.set(s.x, BH + 0.004, s.z);
      m.userData.key = s.key;
      root.add(m);
      palmMeshes.push(m);
      lift.set(m, { cur: 0, to: 0, y: BH + 0.004 });
    }
    dirty = true;
  })().catch((e) => console.warn('sticker textures', e));
  let disposed = false;

  // ---------------------------------------------------------------- lights
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(-6, 52, 26);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 7;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 10, far: 120 });
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 0.4);
  rim.position.set(20, 18, -30);
  scene.add(rim);

  // ---------------------------------------------------------------- state
  let angle = 0; // degrees open
  let camT = 0; // 0 = closed pose, 1 = desk pose
  let zoomT = 0; // 1 = display fills viewport
  let light = 0;
  let lightTo = 0;
  let inFs = false;
  let W = 1, H = 1, Wd = 800;
  const P = { C: null as Pose | null, F: null as Pose | null, Z: null as Pose | null };

  const setAngle = (a: number) => {
    angle = a;
    lid.rotation.x = Math.PI / 2 - a * DEG;
    css3d.style.visibility = a > 78 ? 'visible' : 'hidden';
  };
  setAngle(0);

  type Tw = { t0: number; ms: number; from: number; to: number; ease: (x: number) => number; set: (v: number) => void; done: () => void };
  const tweens = new Map<string, Tw>();
  const tween = (ch: string, from: number, to: number, ms: number, ease: (x: number) => number, set: (v: number) => void) =>
    new Promise<void>((done) => {
      tweens.get(ch)?.done();
      if (ms <= 0 || reduce) {
        set(to);
        dirty = true;
        tweens.delete(ch);
        return done();
      }
      tweens.set(ch, { t0: performance.now(), ms, from, to, ease, set, done });
      dirty = true;
    });

  const v = new THREE.Vector3();
  const bbox = (pts: THREE.Vector3[]) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      v.copy(p).project(camera);
      const x = ((v.x + 1) / 2) * W;
      const y = ((1 - v.y) / 2) * H;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { w: x1 - x0, h: y1 - y0, cy: (y0 + y1) / 2 };
  };
  const place = (pos: THREE.Vector3, target: THREE.Vector3) => {
    camera.clearViewOffset();
    camera.aspect = W / H;
    camera.position.copy(pos);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  const lidPoints = (a: number) => {
    const prev = angle;
    setAngle(a);
    lid.updateMatrixWorld(true);
    const pts = [-1, 1].flatMap((sx) => [0, -LT].map((z) => new THREE.Vector3((sx * LW) / 2, LY0 + LH, z).applyMatrix4(lid.matrixWorld)));
    const c = anchor.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 0, 1).transformDirection(anchor.matrixWorld);
    setAngle(prev);
    lid.updateMatrixWorld(true);
    return { pts, c, n };
  };
  const basePts = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, BH].map((y) => new THREE.Vector3((sx * BW) / 2, y, (sz * BD) / 2))));

  const fit = () => {
    W = o.container.clientWidth || window.innerWidth;
    H = o.container.clientHeight || window.innerHeight;
    renderer.setSize(W, H, false);
    css.setSize(W, H);
    const f = H / (2 * Math.tan((FOV * DEG) / 2));
    const small = W <= 760;
    const top = small ? H * 0.14 : 24;
    const availH = small ? H * 0.6 : H - 24 - 100;
    const availW = W * (small ? 0.94 : 0.9);
    const midY = top + availH / 2;
    const open = lidPoints(OPEN);
    const pts = [...basePts, ...open.pts];
    let d = 120;
    for (let i = 0; i < 4; i++) {
      place(open.c.clone().addScaledVector(open.n, d), open.c);
      const b = bbox(pts);
      const k = Math.min(availW / b.w, availH / b.h, 1240 / ((DW * f) / d));
      d /= k;
    }
    Wd = Math.max(200, Math.round((DW * f) / d));
    d = (DW * f) / Wd;
    const fPos = open.c.clone().addScaledVector(open.n, d);
    place(fPos, open.c);
    P.F = { pos: fPos, target: open.c.clone(), off: bbox(pts).cy - midY };

    const ct = new THREE.Vector3(0, BH, 1.2);
    const el = 34 * DEG;
    const cPos = ct.clone().add(new THREE.Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(d * 1.06));
    place(cPos, ct);
    P.C = { pos: cPos, target: ct, off: bbox([...basePts, ...lidPoints(0).pts]).cy - midY };

    const dz = (DW * f) / Math.min(W, H * DA);
    P.Z = { pos: open.c.clone().addScaledVector(open.n, dz), target: open.c.clone(), off: 0 };

    css3d.style.width = `${Wd}px`;
    css3d.style.height = `${Wd / DA}px`;
    css3d.style.setProperty('--lw', `${Wd / 0.972}px`);
    cssObj.scale.setScalar(DW / Wd);
    dirty = true;
  };

  const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({ pos: a.pos.clone().lerp(b.pos, t), target: a.target.clone().lerp(b.target, t), off: a.off + (b.off - a.off) * t });
  const applyCamera = () => {
    if (!P.C || !P.F || !P.Z) return;
    const p = lerpPose(lerpPose(P.C, P.F, camT), P.Z, zoomT);
    camera.aspect = W / H;
    camera.position.copy(p.pos);
    camera.lookAt(p.target);
    camera.setViewOffset(W, H, 0, p.off, W, H);
    camera.updateMatrixWorld();
  };

  // ---------------------------------------------------------------- loop
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    for (const [ch, t] of tweens) {
      const p = Math.min(1, (now - t.t0) / t.ms);
      t.set(t.from + (t.to - t.from) * t.ease(p));
      dirty = true;
      if (p >= 1) {
        tweens.delete(ch);
        t.done();
      }
    }
    if (Math.abs(light - lightTo) > 0.002) {
      light += (lightTo - light) * 0.08;
      screenLight.intensity = light * 0.7;
      dirty = true;
    }
    for (const [m, s] of lift) {
      if (Math.abs(s.cur - s.to) > 0.002) {
        s.cur += (s.to - s.cur) * 0.25;
        m.position.y = s.y + s.cur * 0.05;
        m.scale.setScalar(1 + s.cur * 0.06);
        dirty = true;
      }
    }
    if (!dirty || inFs) return;
    dirty = false;
    applyCamera();
    renderer.render(scene, camera);
    css.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => fit());
  ro.observe(o.container);
  fit();
  Promise.race([stickersDone, new Promise((r) => setTimeout(r, 1500))])
    .then(() => {
      applyCamera();
      return renderer.compileAsync(scene, camera);
    })
    .catch(() => undefined)
    .then(() => {
      if (disposed) return;
      applyCamera();
      renderer.render(scene, camera);
      css.render(scene, camera);
      requestAnimationFrame(() => !disposed && o.onReady());
    });

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e: PointerEvent | MouseEvent) => {
    const r = o.container.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    applyCamera();
    ray.setFromCamera(ndc, camera);
    return ray;
  };
  let hover: THREE.Mesh | null = null;
  const onMove = (e: PointerEvent) => {
    if (inFs || o.host.contains(e.target as Node)) return;
    const hit = pick(e).intersectObjects(palmMeshes, false)[0]?.object as THREE.Mesh | undefined;
    if (hit !== hover) {
      if (hover) lift.get(hover)!.to = 0;
      hover = hit ?? null;
      if (hover) lift.get(hover)!.to = 1;
      o.container.style.cursor = hover ? 'pointer' : '';
    }
  };
  const onClick = (e: MouseEvent) => {
    if (inFs || o.host.contains(e.target as Node)) return;
    const r = pick(e);
    const hit = r.intersectObjects(palmMeshes, false)[0];
    if (hit) return o.onPalm(hit.object.userData.key);
    if (r.intersectObjects([base, lid], true).length) o.onBody();
  };
  o.container.addEventListener('pointermove', onMove);
  o.container.addEventListener('click', onClick);

  const flip = (el: HTMLElement, first: DOMRect, ms: number) => {
    const last = el.getBoundingClientRect();
    const k = last.width / (el.offsetWidth || 1) || 1;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    const dx = (first.left - last.left) / k;
    const dy = (first.top - last.top) / k;
    if (Math.abs(sx - 1) < 0.002 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return Promise.resolve();
    return el
      .animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }], {
        duration: reduce ? 0 : ms,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
      .finished.then(() => undefined, () => undefined);
  };

  return {
    setOpen(open, ms) {
      const to = open ? OPEN : 0;
      const dur = open ? ms : ms * 0.7;
      const a = tween('lid', angle, to, dur, easeLid, setAngle);
      const c = tween('cam', camT, open ? 1 : 0, dur, easeCam, (x) => (camT = x));
      return Promise.all([a, c]).then(() => undefined);
    },
    setScreenOn(on) {
      lightTo = on ? 1 : 0;
      dirty = true;
    },
    async enterFs(swap) {
      await tween('zoom', zoomT, 1, 640, easeZoom, (x) => (zoomT = x));
      const first = o.host.getBoundingClientRect();
      swap();
      inFs = true;
      o.fsLayer.appendChild(o.host);
      await flip(o.host, first, 260);
    },
    async exitFs(swap) {
      const first = o.host.getBoundingClientRect();
      swap();
      css3d.appendChild(o.host);
      inFs = false;
      zoomT = 1;
      applyCamera();
      renderer.render(scene, camera);
      css.render(scene, camera);
      await flip(o.host, first, 220);
      await tween('zoom', 1, 0, 720, easeZoom, (x) => (zoomT = x));
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      o.container.removeEventListener('pointermove', onMove);
      o.container.removeEventListener('click', onClick);
      for (const el of [o.container, css.domElement]) el.removeEventListener('scroll', unscroll);
      for (const t of tweens.values()) t.done();
      disposables.forEach((d) => d.dispose());
      keyGeos.clear();
      renderer.dispose();
      renderer.domElement.remove();
      css.domElement.remove();
    },
  };
}
