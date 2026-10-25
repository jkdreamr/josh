import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { KD, KW, drawGrille, drawLegends, layoutKeys, type Key3 } from './keyboard';
import { createSounds } from './audio';

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
const HY = BH + 0.08;
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

/** `curl` lifts one corner of the sticker off the surface by that many cm, the way a well-loved sticker starts to peel. */
export type StickerPlacement = { key: string; left: string; top: string; width: string; rot: number; curl?: number };
export type PalmPlacement = { key: string; x: number; z: number; w: number; rot: number; curl?: number };

export type LaptopOptions = {
  container: HTMLElement;
  host: HTMLElement;
  fsLayer: HTMLElement;
  stickerSource: HTMLElement;
  lid: readonly StickerPlacement[];
  palm: readonly PalmPlacement[];
  onPalm: (key: string) => void;
  onBody: () => boolean;
  /** A 3D key was clicked. */
  onKey: (key: Key3) => void;
  /** The visitor closed the lid by hand (open=false) or dragged it open (open=true); `remaining` is the travel left, 0..1. */
  onLid: (open: boolean, remaining: number) => void;
  /** The camera left (or returned to) the default front view. */
  onOrbit: (rotated: boolean) => void;
  /** Called once shaders are compiled and the first frame is on screen. */
  onReady: () => void;
};

export type LaptopController = {
  setOpen(open: boolean, ms: number): Promise<void>;
  setScreenOn(on: boolean): void;
  /** Lid drag and typing are only allowed once the OS is on or asleep. */
  setInteractive(on: boolean): void;
  /** Animate the lid shut by hand (same motion as a drag release). */
  closeLid(): Promise<void>;
  /** Ease the camera back to the front view. */
  resetView(): Promise<void>;
  /** Mirror a physical key press on the 3D keyboard. */
  tapKey(code: string, down: boolean): void;
  /** Keys that stay depressed (sticky modifiers, caps lock). */
  setHeld(codes: readonly string[]): void;
  enterFs(swap: () => void): Promise<void>;
  exitFs(swap: () => void): Promise<void>;
  /** Read-only view of the scene for dev tooling and tests: where a key or the lid's top edge sits on screen. */
  inspect(): { yaw: number; pitch: number; lid: number; interactive: boolean; screen: boolean; keyAt(code: string): { x: number; y: number } | null; lidTop(): { x: number; y: number }; hitAt(x: number, y: number): string; lidAngle(x: number, y: number): number | null; tweens: string[] };
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
/** Lid falling shut under its own weight. */
const easeShut = cubicBezier(0.45, 0, 0.85, 0.6);
/** Lid springing back open after a half-hearted close. */
const easeSpring = cubicBezier(0.2, 0.9, 0.3, 1.15);
const KEY_TRAVEL = 0.12;
const KEY_Y = BH - 0.12 + 0.06 + 0.035;

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

/** `rrect` whose bottom edge dips in by `nd` over `nw`: the thumb scoop at the front of the palm rest. */
function notched(w: number, h: number, r: number, nw: number, nd: number) {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  s.moveTo(x0 + r, y0);
  scoop(s, y0, nw, nd);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function scoop(s: THREE.Path, y0: number, nw: number, nd: number) {
  s.lineTo(-nw / 2, y0);
  s.bezierCurveTo(-nw * 0.3, y0, -nw * 0.28, y0 + nd, 0, y0 + nd);
  s.bezierCurveTo(nw * 0.28, y0 + nd, nw * 0.3, y0, nw / 2, y0);
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

/**
 * Product-photography studio for reflections: a dark cyclorama lit by a big overhead softbox, a front key card and
 * thin rim strips behind, so the aluminium picks up long soft gradients and bright edge highlights instead of a flat grey.
 */
function studio() {
  const s = new THREE.Scene();
  // softboxes are hottest in the middle and fall off to their edges, which is what draws gradients on metal
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(0.6, '#b8b8b8');
  grd.addColorStop(1, '#3a3a3a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const falloff = new THREE.CanvasTexture(c);
  const lit = (w: number, h: number, v: number, tint = '#ffffff', soft = true) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(v), map: soft ? falloff : null, side: THREE.DoubleSide }),
    );
    s.add(m);
    return m;
  };
  const walls = new THREE.Mesh(new THREE.BoxGeometry(70, 34, 70), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9a9b9e').multiplyScalar(0.62), side: THREE.BackSide }));
  walls.position.y = 15;
  s.add(walls);
  const floor = lit(70, 70, 0.55, '#a9aaad', false);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.9;
  const top = lit(26, 16, 4.2);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, 26, 2);
  const key = lit(12, 18, 3.2, '#fffaf4');
  key.position.set(-22, 12, 16);
  key.lookAt(0, 2, 0);
  const fill = lit(30, 6, 1.6);
  fill.position.set(0, 5, 30);
  fill.lookAt(0, 2, 0);
  for (const [x, v] of [[-24, 6], [24, 7.5]] as const) {
    const strip = lit(2.2, 26, v, '#f6f8ff');
    strip.position.set(x, 12, -22);
    strip.lookAt(0, 4, 0);
  }
  const back = lit(34, 12, 2.2);
  back.position.set(0, 16, -32);
  back.lookAt(0, 6, 0);
  return s;
}

/** Deterministic PRNG so procedural wear is the same on every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (str: string) => [...str].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

/** Tangent-space normal map of blurred noise: the faint orange-peel ripple of a laminated vinyl sticker. */
function peelNormals(size: number, strength: number) {
  const src = document.createElement('canvas');
  src.width = src.height = size;
  const g = src.getContext('2d')!;
  const r = rng(7);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = r() * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // blur by drawing the tile onto itself shifted, which keeps it seamless
  const h = document.createElement('canvas');
  h.width = h.height = size;
  const hg = h.getContext('2d')!;
  hg.filter = 'blur(2.2px)';
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) hg.drawImage(src, dx, dy);
  const hd = hg.getImageData(0, 0, size, size).data;
  const at = (x: number, y: number) => hd[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  const out = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return src;
}

/** Light handling wear on a sticker: hairline scuffs and a slightly dulled, grubby die-cut edge, clipped to the art. */
function weather(c: HTMLCanvasElement, seed: number) {
  const g = c.getContext('2d')!;
  const r = rng(seed);
  const S = Math.max(c.width, c.height);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = r() * c.width;
    const y = r() * c.height;
    const a = r() * Math.PI;
    const len = S * (0.02 + r() * 0.09);
    g.strokeStyle = r() < 0.7 ? `rgba(255,255,255,${0.05 + r() * 0.1})` : `rgba(0,0,0,${0.04 + r() * 0.06})`;
    g.lineWidth = S * (0.0012 + r() * 0.0018);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * len * 0.2, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // edges collect a little grime and lose some ink
  const edge = document.createElement('canvas');
  edge.width = c.width;
  edge.height = c.height;
  const eg = edge.getContext('2d')!;
  eg.drawImage(c, 0, 0);
  eg.globalCompositeOperation = 'source-in';
  eg.fillStyle = '#6d6a64';
  eg.fillRect(0, 0, c.width, c.height);
  const inner = document.createElement('canvas');
  inner.width = c.width;
  inner.height = c.height;
  const ig = inner.getContext('2d')!;
  ig.filter = `blur(${S * 0.006}px)`;
  ig.drawImage(c, 0, 0);
  eg.globalCompositeOperation = 'destination-out';
  eg.drawImage(inner, 0, 0);
  g.globalAlpha = 0.5;
  g.drawImage(edge, 0, 0);
  g.restore();
}

/** Soft contact shadow cut from a sticker's own silhouette; `pad` is the margin added on every side, as a fraction of the art. */
function contactShadow(c: HTMLCanvasElement, pad: number) {
  const p = Math.round(Math.max(c.width, c.height) * pad);
  const out = document.createElement('canvas');
  out.width = c.width + p * 2;
  out.height = c.height + p * 2;
  const g = out.getContext('2d')!;
  const sil = document.createElement('canvas');
  sil.width = c.width;
  sil.height = c.height;
  const sg = sil.getContext('2d')!;
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, c.width, c.height);
  g.filter = `blur(${p * 0.35}px)`;
  g.drawImage(sil, p, p);
  return out;
}

/** Rasterises a sticker's SVG (text drawn with canvas so the page's web fonts are used). */
async function svgTexture(svg: SVGSVGElement, aniso: number, seed: number) {
  const vb = svg.viewBox.baseVal;
  const vw = vb?.width || 100;
  const vh = vb?.height || 100;
  const k = 1024 / Math.max(vw, vh);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(vw * k)));
  clone.setAttribute('height', String(Math.round(vh * k)));
  // the flat page art fakes its sheen; in 3D the clearcoat catches the real lights instead
  clone.querySelectorAll('.sticker-gloss').forEach((el) => el.remove());
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
    g.setTransform(1, 0, 0, 1, 0, 0);
    weather(c, seed);
    return { tex: canvasTex(c, aniso), aspect: vw / vh, canvas: c };
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
  const room = studio();
  const envTex = keep(pmrem.fromScene(room, 0.02).texture);
  room.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      m.geometry.dispose();
      (m.material as THREE.MeshBasicMaterial).map?.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 1;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);

  // ---------------------------------------------------------------- materials
  // bead-blasted anodised aluminium: a fine, slightly uneven sparkle in the roughness
  const grain = keep(canvasTex(noise(512, 196, 255), aniso, false));
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(0.45, 0.45);
  const alu = keep(
    new THREE.MeshPhysicalMaterial({ color: '#cfd0d3', metalness: 1, roughness: 0.4, roughnessMap: grain, specularIntensity: 1, envMapIntensity: 1 }),
  );
  const black = keep(new THREE.MeshStandardMaterial({ color: '#060608', roughness: 0.8, emissive: '#e4e9ff', emissiveIntensity: 0 }));
  // PBT-ish caps: matte, with the faint sheen worn into them by fingertips
  const keyMat = keep(new THREE.MeshPhysicalMaterial({ color: '#0b0b0d', roughness: 0.5, metalness: 0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: '#3a3a44' }));
  // Lit glass picks up the studio environment and reads as silver; the real bezel is a deep black.
  const glass = keep(new THREE.MeshPhysicalMaterial({ color: '#010102', roughness: 0.06, metalness: 0, envMapIntensity: 0.55 }));
  const panel = keep(new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.18, metalness: 0, envMapIntensity: 0.05 }));
  const hingeMat = keep(new THREE.MeshPhysicalMaterial({ color: '#1d1e22', metalness: 0.85, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.4 }));
  // etched glass over a silver backing: reads like the body, but smoother and a touch cooler
  const padMat = keep(
    new THREE.MeshPhysicalMaterial({ color: '#b9bbc0', metalness: 0.75, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.22, envMapIntensity: 0.9 }),
  );
  {
    // a day's worth of fingertips: oily smudges and swipe arcs only show where they catch a highlight
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgb(0,74,0)';
    g.fillRect(0, 0, 512, 300);
    const r = rng(31);
    g.filter = 'blur(9px)';
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(0,${92 + r() * 18},0,${0.2 + r() * 0.25})`;
      g.beginPath();
      g.ellipse(80 + r() * 352, 50 + r() * 200, 10 + r() * 16, 13 + r() * 18, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.filter = 'blur(5px)';
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = `rgba(0,100,0,${0.12 + r() * 0.12})`;
      g.lineWidth = 8 + r() * 10;
      g.beginPath();
      const x = 120 + r() * 270, y = 70 + r() * 160;
      g.arc(x, y, 60 + r() * 120, r() * Math.PI * 2, r() * Math.PI * 2 + 0.6 + r() * 0.8);
      g.stroke();
    }
    const t = keep(canvasTex(c, aniso, false));
    t.repeat.set(1 / TPW, 1 / TPD);
    t.offset.set(0.5, 0.5);
    padMat.roughness = 1;
    padMat.roughnessMap = t;
    padMat.clearcoatRoughnessMap = t;
  }
  const portMat = keep(new THREE.MeshStandardMaterial({ color: '#030304', roughness: 0.9 }));
  const portInner = keep(new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.5, metalness: 0.6 }));
  const rubber = keep(new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.92 }));

  const root = new THREE.Group();
  scene.add(root);
  const shadowed = (m: THREE.Mesh, cast = true, receive = true) => ((m.castShadow = cast), (m.receiveShadow = receive), m);

  // ---------------------------------------------------------------- base
  const bev = 0.14;
  const NW = 6.6;
  const ND = 0.42;
  const baseShape = notched(BW - 2 * bev, BD - 2 * bev, 0.95, NW, ND);
  baseShape.holes.push(rrect(KW + 0.36, KD + 0.36, 0.32, 0.32, 0, -(KZ0 + KD / 2)));
  const baseGeo = keep(
    new THREE.ExtrudeGeometry(baseShape, { depth: BT - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 6, curveSegments: 28 }),
  );
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate(0, FOOT + bev, 0);
  const base = shadowed(new THREE.Mesh(baseGeo, alu));
  root.add(base);
  // the scoop only cuts the top of the edge; its floor is a rounded ledge halfway down the edge
  {
    const y0 = -(BD / 2 - bev);
    // same bevel as the case so the bottom edge runs on unbroken; the bevel grows the outline by `fb`, so the front
    // line starts that far in to land flush
    const fb = bev;
    const floorH = BT * 0.5;
    const fill = new THREE.Shape();
    fill.moveTo(-NW / 2, y0 - bev + fb);
    fill.lineTo(-NW / 2, y0);
    scoop(fill, y0, NW, ND);
    fill.lineTo(NW / 2, y0 - bev + fb);
    fill.closePath();
    const geo = keep(new THREE.ExtrudeGeometry(fill, { depth: floorH - 2 * fb, bevelEnabled: true, bevelThickness: fb, bevelSize: fb, bevelSegments: 4, curveSegments: 20 }));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, FOOT + fb, 0);
    root.add(shadowed(new THREE.Mesh(geo, alu)));
  }

  // baked occlusion on the palm rest: the open lid hides the sky near the hinge, and the keyboard cutout and scoop
  // gather a little shadow at their lips
  {
    const S = 40;
    const c = document.createElement('canvas');
    c.width = Math.round(BW * S);
    c.height = Math.round(BD * S);
    const g = c.getContext('2d')!;
    g.scale(S, S);
    g.translate(BW / 2, BD / 2);
    const grd = g.createLinearGradient(0, -BD / 2, 0, -BD / 2 + 5);
    grd.addColorStop(0, 'rgba(0,0,0,0.5)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(-BW / 2, -BD / 2, BW, 5);
    g.filter = `blur(${0.18 * S}px)`;
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 0.22;
    const lip = rrect(KW + 0.36, KD + 0.36, 0.32, 0.32, 0, KZ0 + KD / 2);
    g.beginPath();
    for (const p of lip.getPoints(12)) g.lineTo(p.x, p.y);
    g.closePath();
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 0.16;
    g.beginPath();
    g.ellipse(0, BD / 2 - bev - ND, NW * 0.36, ND * 1.3, 0, Math.PI, 0);
    g.stroke();
    const t = keep(canvasTex(c, aniso, false));
    const occ = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(BW, BD)),
      keep(new THREE.MeshBasicMaterial({ color: '#000', alphaMap: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })),
    );
    occ.rotation.x = -Math.PI / 2;
    occ.position.y = BH + 0.0006;
    occ.raycast = () => {};
    root.add(occ);
  }

  const well = new THREE.Mesh(keep(new THREE.PlaneGeometry(KW + 0.4, KD + 0.4)), black);
  well.rotation.x = -Math.PI / 2;
  well.position.set(0, BH - 0.12, KZ0 + KD / 2);
  root.add(shadowed(well, false));
  // keys
  const keys = layoutKeys();
  const keyGeos = new Map<string, THREE.BufferGeometry>();
  const keyGroup = new THREE.Group();
  const keyMeshes = new Map<string, THREE.Mesh>();
  const keyDown = keep(keyMat.clone());
  keyDown.color.set('#15151a');
  const legendTex = keep(canvasTex(drawLegends(keys, PX), aniso));
  const legendMat = keep(
    new THREE.MeshStandardMaterial({ map: legendTex, emissiveMap: legendTex, emissive: '#dfe6ff', emissiveIntensity: 0, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  for (const k of keys) {
    const id = `${k.w.toFixed(3)}x${k.d.toFixed(3)}`;
    let geo = keyGeos.get(id);
    if (!geo) keyGeos.set(id, (geo = keep(new RoundedBoxGeometry(k.w, 0.12, k.d, 3, 0.06))));
    const m = new THREE.Mesh(geo, keyMat);
    m.position.set(-KW / 2 + k.x, KEY_Y, KZ0 + k.z);
    m.userData.key = k;
    // each key carries its own slice of the legend sheet so the print travels with the cap
    const lg = keep(new THREE.PlaneGeometry(k.w, k.d));
    const u0 = (k.x - k.w / 2) / KW, u1 = (k.x + k.w / 2) / KW;
    const v0 = 1 - (k.z + k.d / 2) / KD, v1 = 1 - (k.z - k.d / 2) / KD;
    lg.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2));
    const legend = new THREE.Mesh(lg, legendMat);
    legend.rotation.x = -Math.PI / 2;
    legend.position.y = 0.062;
    legend.userData.key = k;
    m.add(legend);
    keyGroup.add(shadowed(m));
    keyMeshes.set(k.code, m);
  }
  root.add(keyGroup);
  // caps lock indicator
  const capsLed = new THREE.Mesh(keep(new THREE.CircleGeometry(0.045, 16)), keep(new THREE.MeshBasicMaterial({ color: '#45e36a' })));
  capsLed.rotation.x = -Math.PI / 2;
  capsLed.visible = false;
  {
    const caps = keyMeshes.get('CapsLock')!;
    const k = caps.userData.key as Key3;
    capsLed.position.set(-k.w / 2 + 0.26, 0.064, -k.d / 2 + 0.26);
    caps.add(capsLed);
  }

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

  // ports, as on the 14": MagSafe, two Thunderbolt and the headphone jack on the left; HDMI, Thunderbolt and SDXC on the right
  {
    const PY = FOOT + BT * 0.5;
    const port = (side: -1 | 1, z: number, w: number, h: number, r: number) => {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(keep(new THREE.ShapeGeometry(rrect(w, h, r), 12)), portMat);
      const tongue = new THREE.Mesh(keep(new THREE.ShapeGeometry(rrect(w * 0.62, h * 0.26, h * 0.1), 6)), portInner);
      tongue.position.z = 0.002;
      g.add(shell, tongue);
      g.rotation.y = side * Math.PI / 2;
      g.position.set(side * (BW / 2 + 0.003), PY, z);
      root.add(g);
      return g;
    };
    const back = -BD / 2;
    port(-1, back + 2.4, 1.65, 0.32, 0.16).children[1].visible = false;
    port(-1, back + 4.7, 0.86, 0.3, 0.15);
    port(-1, back + 6.2, 0.86, 0.3, 0.15);
    const jack = new THREE.Mesh(keep(new THREE.CircleGeometry(0.17, 24)), portMat);
    jack.rotation.y = -Math.PI / 2;
    jack.position.set(-(BW / 2 + 0.003), PY, back + 14.6);
    root.add(jack);
    port(1, back + 3.2, 1.42, 0.42, 0.06);
    port(1, back + 5.6, 0.86, 0.3, 0.15);
    port(1, back + 14.2, 2.45, 0.13, 0.06).children[1].visible = false;
  }

  // rubber feet
  {
    const footGeo = keep(new THREE.CylinderGeometry(0.62, 0.66, FOOT + 0.04, 28));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const f = new THREE.Mesh(footGeo, rubber);
        f.position.set(sx * (BW / 2 - 2.3), (FOOT + 0.04) / 2, sz * (BD / 2 - 2.3));
        root.add(f);
      }
    }
  }

  // ground: soft contact shadow + cast shadow
  const ao = document.createElement('canvas');
  ao.width = 512;
  ao.height = Math.round((512 * BD * 1.25) / (BW * 1.18));
  {
    // tight and dark where the case nearly touches the desk, with a broad soft falloff around it
    const g = ao.getContext('2d')!;
    const k = 512 / (BW * 1.18);
    g.translate(256, ao.height / 2);
    g.scale(k, k);
    for (const [grow, blur, a] of [[3.2, 2.4, 0.35], [0.6, 0.7, 0.55], [-0.2, 0.18, 0.75]] as const) {
      g.filter = `blur(${blur * k}px)`;
      g.fillStyle = `rgba(0,0,0,${a})`;
      const sh = rrect(BW + grow, BD + grow, 1 + grow / 2);
      g.beginPath();
      for (const p of sh.getPoints(16)) g.lineTo(p.x, p.y);
      g.fill();
    }
  }
  const aoMesh = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(BW * 1.18, BD * 1.25)),
    keep(new THREE.MeshBasicMaterial({ map: keep(canvasTex(ao, aniso)), transparent: true, depthWrite: false })),
  );
  aoMesh.rotation.x = -Math.PI / 2;
  aoMesh.position.y = 0.002;
  root.add(aoMesh);
  const groundMat = keep(new THREE.ShadowMaterial({ opacity: 0.34 }));
  groundMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec2 vFloor;\nvoid main() {\n\tvFloor = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying vec2 vFloor;\nvoid main() {')
      .replace('opacity * ( 1.0 - getShadowMask() )', 'opacity * ( 1.0 - getShadowMask() ) * ( 1.0 - smoothstep( 14.0, 46.0, length( vFloor ) ) )');
  };
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 400)), groundMat);
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
  const lidBack = shadowed(new THREE.Mesh(lidGeo, alu));
  lid.add(lidBack);
  const bezel = new THREE.Mesh(keep(new THREE.ShapeGeometry(rrect(LW - 0.28, LH - 0.28, 0.84, 0.26, 0, LY0 + LH / 2), 28)), glass);
  bezel.position.z = 0.004;
  lid.add(bezel);
  // the thin black rubber gasket that cushions the closed lid, just inside the aluminium rim
  const gasketShape = rrect(LW - 0.2, LH - 0.2, 0.9, 0.3, 0, LY0 + LH / 2);
  gasketShape.holes.push(rrect(LW - 0.36, LH - 0.36, 0.8, 0.22, 0, LY0 + LH / 2));
  const gasket = new THREE.Mesh(keep(new THREE.ShapeGeometry(gasketShape, 28)), rubber);
  gasket.position.z = 0.006;
  lid.add(gasket);
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
  let lidShown = false;
  let shown = false;
  let refocus: HTMLElement | null = null;
  css3d.style.visibility = 'hidden';
  css3d.style.pointerEvents = 'none';
  css3d.inert = true;

  // ---------------------------------------------------------------- stickers
  const palmMeshes: THREE.Mesh[] = [];
  const lift = new Map<THREE.Mesh, { cur: number; to: number; y: number; shadow: THREE.Mesh }>();
  const peel = keep(canvasTex(peelNormals(256, 2.4), aniso, false));
  peel.wrapS = peel.wrapT = THREE.RepeatWrapping;
  // laminated vinyl: satin print under a thin glossy overlaminate with a faint orange-peel ripple
  const stickerMat = (tex: THREE.Texture, w: number) => {
    const t = peel.clone();
    t.repeat.set(w / 2.2, w / 2.2);
    t.needsUpdate = true;
    keep(t);
    return keep(
      new THREE.MeshPhysicalMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.02,
        roughness: 0.55,
        clearcoat: 0.65,
        clearcoatRoughness: 0.2,
        clearcoatNormalMap: t,
        clearcoatNormalScale: new THREE.Vector2(0.35, 0.35),
        envMapIntensity: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
  };
  const SHADOW_PAD = 0.05;
  const shadowMat = (c: HTMLCanvasElement) =>
    keep(new THREE.MeshBasicMaterial({ color: '#000', alphaMap: keep(canvasTex(contactShadow(c, SHADOW_PAD), aniso, false)), transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  /** A sticker and the soft shadow its thickness leaves on the surface beneath it. */
  const sticker = async (svg: SVGSVGElement, key: string, w: number, curl = 0) => {
    const { tex, aspect, canvas } = await svgTexture(svg, aniso, hash(key));
    const h = w / aspect;
    const geo = keep(new THREE.PlaneGeometry(w, h, curl ? 28 : 1, curl ? 28 : 1));
    if (curl) {
      // peel one corner up along a straight fold line, rising faster towards the tip
      const pos = geo.attributes.position;
      const reach = Math.min(w, h) * 0.32;
      const dx = Math.SQRT1_2, dy = Math.SQRT1_2;
      for (let i = 0; i < pos.count; i++) {
        const s = (w / 2 - pos.getX(i)) * dx + (h / 2 - pos.getY(i)) * dy;
        const t = Math.max(0, 1 - s / reach);
        pos.setZ(i, curl * t * t);
      }
      geo.computeVertexNormals();
    }
    const m = new THREE.Mesh(geo, stickerMat(tex, w));
    const grow = 1 + SHADOW_PAD * 2 * (Math.max(canvas.width, canvas.height) / canvas.width);
    const growY = 1 + SHADOW_PAD * 2 * (Math.max(canvas.width, canvas.height) / canvas.height);
    const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(w * grow, h * growY)), shadowMat(canvas));
    return { m, shadow, h };
  };
  const stickersDone = (async () => {
    await document.fonts?.ready;
    const art = (key: string) => o.stickerSource.querySelector<SVGSVGElement>(`[data-sticker="${key}"] svg`);
    // decode every sticker at once so a busy main thread cannot leave the lid half-dressed when the intro starts
    const lidDone = o.lid.map(async (s) => {
      const svg = art(s.key);
      if (!svg) return;
      const w = (parseFloat(s.width) / 100) * LW;
      const { m, shadow, h } = await sticker(svg, s.key, w, s.curl);
      for (const [mesh, z, dy] of [[m, -LT - 0.006, 0], [shadow, -LT - 0.003, -0.05]] as const) {
        mesh.rotation.set(Math.PI, 0, -s.rot * DEG);
        mesh.position.set(-LW / 2 + (parseFloat(s.left) / 100) * LW + w / 2, LY0 + (parseFloat(s.top) / 100) * LH + h / 2 + dy, z);
        lid.add(mesh);
      }
    });
    const palmDone = o.palm.map(async (s) => {
      const svg = art(s.key);
      if (!svg) return;
      const { m, shadow } = await sticker(svg, s.key, s.w, s.curl);
      for (const mesh of [m, shadow]) mesh.rotation.set(-Math.PI / 2, 0, -s.rot * DEG);
      m.position.set(s.x, BH + 0.006, s.z);
      shadow.position.set(s.x, BH + 0.003, s.z + 0.05);
      m.userData.key = s.key;
      root.add(m, shadow);
      palmMeshes.push(m);
      lift.set(m, { cur: 0, to: 0, y: BH + 0.006, shadow });
    });
    await Promise.all([...lidDone, ...palmDone]);
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

  const dn = new THREE.Vector3(), dc = new THREE.Vector3(), toCam = new THREE.Vector3();
  /** The projected screen has no depth test, so it is only shown while the camera is in front of the display plane. */
  const syncDisplay = () => {
    anchor.updateWorldMatrix(true, false);
    dn.set(0, 0, 1).transformDirection(anchor.matrixWorld);
    anchor.getWorldPosition(dc);
    toCam.copy(camera.position).sub(dc);
    const on = lidShown && dn.dot(toCam) > 0.01 * toCam.length();
    if (on === shown) return;
    shown = on;
    if (!on) {
      const a = document.activeElement;
      refocus = a instanceof HTMLElement && css3d.contains(a) ? a : null;
    }
    css3d.style.visibility = on ? 'visible' : 'hidden';
    css3d.style.pointerEvents = on ? 'auto' : 'none';
    css3d.inert = !on;
    if (on) {
      const a = document.activeElement;
      if (refocus?.isConnected && css3d.contains(refocus) && (!a || a === document.body)) refocus.focus({ preventScroll: true });
      refocus = null;
    }
  };

  const setAngle = (a: number) => {
    angle = a;
    lid.rotation.x = Math.PI / 2 - a * DEG;
    lidShown = a > 14;
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
  // orbit: yaw around the laptop, pitch above or below the default eye level
  let yaw = 0;
  let pitch = 0;
  let yawV = 0;
  let pitchV = 0;
  let rotated = false;
  const PITCH_MIN = -0.32;
  const PITCH_MAX = 1.05;
  const sph = new THREE.Spherical();
  const applyCamera = () => {
    if (!P.C || !P.F || !P.Z) return;
    const p = lerpPose(lerpPose(P.C, P.F, camT), P.Z, zoomT);
    if (yaw || pitch) {
      const off = p.pos.clone().sub(p.target);
      sph.setFromVector3(off);
      sph.theta += yaw;
      sph.phi = THREE.MathUtils.clamp(sph.phi - pitch, 0.18, Math.PI / 2 + 0.12);
      p.pos.copy(p.target).add(off.setFromSpherical(sph));
    }
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
      // keyboard backlight: legends light up and a faint glow escapes around the caps
      legendMat.emissiveIntensity = light * 0.55;
      black.emissiveIntensity = light * 0.03;
      dirty = true;
    }
    for (const [m, s] of lift) {
      if (Math.abs(s.cur - s.to) > 0.002) {
        s.cur += (s.to - s.cur) * 0.25;
        m.position.y = s.y + s.cur * 0.05;
        m.scale.setScalar(1 + s.cur * 0.06);
        s.shadow.scale.setScalar(1 + s.cur * 0.1);
        s.shadow.position.z = m.position.z + 0.05 + s.cur * 0.12;
        (s.shadow.material as THREE.MeshBasicMaterial).opacity = 0.38 - s.cur * 0.12;
        dirty = true;
      }
    }
    for (const [code, s] of press) {
      const m = keyMeshes.get(code)!;
      const to = Math.max(s.to, held.has(code) ? 0.6 : 0);
      if (Math.abs(s.cur - to) > 0.004) {
        s.cur += (to - s.cur) * (to > s.cur ? 0.6 : 0.28);
        m.position.y = KEY_Y - s.cur * KEY_TRAVEL;
        m.material = s.cur > 0.3 ? keyDown : keyMat;
        dirty = true;
      } else if (to === 0 && s.to === 0) {
        m.position.y = KEY_Y;
        m.material = keyMat;
        press.delete(code);
        dirty = true;
      }
    }
    if (!drag && (Math.abs(yawV) > 1e-4 || Math.abs(pitchV) > 1e-4)) {
      yaw += yawV;
      pitch = THREE.MathUtils.clamp(pitch + pitchV, PITCH_MIN, PITCH_MAX);
      yawV *= 0.88;
      pitchV *= 0.85;
      if (Math.abs(yawV) <= 1e-4 && Math.abs(pitchV) <= 1e-4) yawV = pitchV = 0;
      dirty = true;
    }
    const nowRotated = Math.abs(yaw) > 0.004 || Math.abs(pitch) > 0.004;
    if (nowRotated !== rotated) {
      rotated = nowRotated;
      o.onOrbit(rotated);
    }
    if (!dirty || inFs) return;
    dirty = false;
    applyCamera();
    renderer.render(scene, camera);
    syncDisplay();
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
      syncDisplay();
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
  type Hit = { kind: 'key'; key: Key3 } | { kind: 'palm'; key: string } | { kind: 'lid' } | { kind: 'body' } | { kind: 'bg' };
  const hitPoint = new THREE.Vector3();
  const classify = (e: PointerEvent): Hit => {
    const hit = pick(e).intersectObject(root, true)[0];
    if (!hit) return { kind: 'bg' };
    hitPoint.copy(hit.point);
    let obj: THREE.Object3D | null = hit.object;
    while (obj && obj !== root) {
      if (obj.userData.key && typeof obj.userData.key === 'object') return { kind: 'key', key: obj.userData.key as Key3 };
      if (obj === lid) return { kind: 'lid' };
      obj = obj.parent;
    }
    if (hit.object === ground || hit.object === aoMesh) return { kind: 'bg' };
    if (palmMeshes.includes(hit.object as THREE.Mesh)) return { kind: 'palm', key: hit.object.userData.key as string };
    return { kind: 'body' };
  };

  // keys
  const sounds = createSounds();
  const press = new Map<string, { cur: number; to: number }>();
  const held = new Set<string>();
  const releaseTimers = new Map<string, number>();
  const setPressed = (code: string, down: boolean, sound: boolean) => {
    const m = keyMeshes.get(code);
    if (!m) return;
    const st = press.get(code) ?? { cur: 0, to: 0 };
    if (down === (st.to === 1) && press.has(code)) return;
    st.to = down ? 1 : 0;
    press.set(code, st);
    dirty = true;
    if (sound) sounds.key(down, (m.userData.key as Key3).w > 3);
  };

  // lid
  let interactive = false;
  /**
   * Where the grabbed point of the lid would sit under the pointer: the point stays `R` from the hinge axis, so the
   * pointer ray is intersected with that cylinder (in the hinge's YZ plane). Past the arc's silhouette the nearest
   * tangent is used, which pins the lid at its extreme instead of letting it jump.
   */
  const lidAngleAt = (e: PointerEvent, R: number): number | null => {
    const { origin, direction } = pick(e).ray;
    const oy = origin.y - HY, oz = origin.z - HZ;
    const dy = direction.y, dz = direction.z;
    const a = dy * dy + dz * dz;
    if (a < 1e-9) return null;
    const b = 2 * (oy * dy + oz * dz);
    const c = oy * oy + oz * oz - R * R;
    const disc = b * b - 4 * a * c;
    const t = disc < 0 ? -b / (2 * a) : (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) return null;
    return Math.atan2(oy + t * dy, oz + t * dz) / DEG;
  };
  let dip = 0;
  const setDip = (v: number) => {
    dip = v;
    root.position.y = -dip * 0.07;
  };
  const thud = async () => {
    sounds.thud();
    await tween('dip', dip, 1, 70, (x) => x, setDip);
    await tween('dip', 1, 0, 260, easeCam, setDip);
  };
  const shut = async () => {
    const from = angle;
    const ms = Math.max(260, 620 * (from / OPEN));
    const cam = tween('cam', camT, 0, ms + 300, easeCam, (x) => (camT = x));
    await tween('lid', from, 0, ms, easeShut, setAngle);
    void thud();
    await cam;
  };
  const closeLid = async () => {
    if (angle <= 0.01) return;
    await shut();
    o.onLid(false, 0);
  };

  // pointer state machine: one gesture at a time, classified on pointerdown
  type Drag = { id: number; hit: Hit; x0: number; y0: number; x: number; y: number; tm: number; vx: number; vy: number; moved: boolean; a0: number; th0: number | null; R: number; wasOpen: boolean };
  let drag: Drag | null = null;
  let lastUp = { t: 0, x: 0, y: 0 };
  let hover: THREE.Mesh | null = null;
  const setHover = (m: THREE.Mesh | null) => {
    if (m === hover) return;
    if (hover) lift.get(hover)!.to = 0;
    hover = m;
    if (hover) lift.get(hover)!.to = 1;
    o.container.style.cursor = hover ? 'pointer' : '';
  };
  const onDown = (e: PointerEvent) => {
    yawV = pitchV = 0;
    if (inFs || drag || o.host.contains(e.target as Node) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const hit = classify(e);
    drag = { id: e.pointerId, hit, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, tm: e.timeStamp, vx: 0, vy: 0, moved: false, a0: angle, th0: null, R: 1, wasOpen: angle > OPEN / 2 };
    // keep focus inside the screen while clicking the hardware
    e.preventDefault();
    try {
      o.container.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (hit.kind === 'key') {
      setPressed(hit.key.code, true, true);
      if (shown) o.onKey(hit.key);
    } else if (hit.kind === 'lid' && interactive && !tweens.has('lid')) {
      drag.R = Math.max(2, Math.hypot(hitPoint.y - HY, hitPoint.z - HZ));
      drag.th0 = lidAngleAt(e, drag.R);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (inFs) return;
    if (!drag) {
      if (o.host.contains(e.target as Node)) return setHover(null);
      setHover((pick(e).intersectObjects(palmMeshes, false)[0]?.object as THREE.Mesh | undefined) ?? null);
      return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const now = e.timeStamp;
    const dt = Math.max(1, now - drag.tm);
    // px per ms, smoothed, so a flick on release carries believable momentum at any frame rate
    const k = Math.min(1, dt / 40);
    drag.vx += ((dx / dt) - drag.vx) * k;
    drag.vy += ((dy / dt) - drag.vy) * k;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.tm = now;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
      drag.moved = true;
      if (drag.hit.kind === 'lid' && drag.th0 === null) drag.hit = { kind: 'body' };
      if (drag.hit.kind === 'lid' || drag.hit.kind === 'body' || drag.hit.kind === 'bg') o.container.style.cursor = 'grabbing';
    }
    if (!drag.moved) return;
    if (drag.hit.kind === 'lid') {
      const th = lidAngleAt(e, drag.R);
      if (th !== null && drag.th0 !== null) setAngle(THREE.MathUtils.clamp(drag.a0 + (th - drag.th0), 0, OPEN));
      dirty = true;
    } else if (drag.hit.kind === 'body' || drag.hit.kind === 'bg') {
      yaw += (-dx / W) * Math.PI * 1.3;
      pitch = THREE.MathUtils.clamp(pitch + (dy / H) * Math.PI * 0.8, PITCH_MIN, PITCH_MAX);
      dirty = true;
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    o.container.style.cursor = '';
    try {
      o.container.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d.hit.kind === 'key') return setPressed(d.hit.key.code, false, e.type === 'pointerup');
    if (e.type !== 'pointerup') {
      if (d.hit.kind === 'lid' && d.moved) void (d.wasOpen ? tween('lid', angle, OPEN, 420, easeSpring, setAngle) : tween('lid', angle, 0, 320, easeShut, setAngle));
      return;
    }
    if (d.hit.kind === 'lid' && d.moved) {
      if (d.wasOpen) {
        if (angle < OPEN * 0.5) void closeLid();
        else void tween('lid', angle, OPEN, 420, easeSpring, setAngle);
      } else if (angle > OPEN * 0.3) o.onLid(true, 1 - angle / OPEN);
      else void tween('lid', angle, 0, 320, easeShut, setAngle).then(() => void (angle === 0 && thud()));
      return;
    }
    if (d.moved) {
      // only a flick keeps spinning; a drag that paused before release stops dead
      if (d.hit.kind !== 'lid' && e.timeStamp - d.tm < 120) {
        yawV = THREE.MathUtils.clamp((-d.vx * 16 / W) * Math.PI * 1.3, -0.12, 0.12);
        pitchV = THREE.MathUtils.clamp((d.vy * 16 / H) * Math.PI * 0.8, -0.08, 0.08);
      }
      return;
    }
    yawV = pitchV = 0;
    if (d.hit.kind === 'palm') return o.onPalm(d.hit.key);
    if (d.hit.kind === 'lid' || d.hit.kind === 'body') return void o.onBody();
    const now = performance.now();
    if (now - lastUp.t < 360 && Math.hypot(e.clientX - lastUp.x, e.clientY - lastUp.y) < 8) {
      lastUp = { t: 0, x: 0, y: 0 };
      void resetView();
    } else lastUp = { t: now, x: e.clientX, y: e.clientY };
  };
  const resetView = async () => {
    yawV = pitchV = 0;
    await Promise.all([tween('yaw', yaw, 0, 640, easeCam, (x) => (yaw = x)), tween('pitch', pitch, 0, 640, easeCam, (x) => (pitch = x))]);
    yaw = pitch = 0;
    dirty = true;
  };
  o.container.addEventListener('pointerdown', onDown);
  o.container.addEventListener('pointermove', onMove);
  o.container.addEventListener('pointerup', onUp);
  o.container.addEventListener('pointercancel', onUp);
  o.container.addEventListener('lostpointercapture', onUp);

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
      const full = open ? ms : ms * 0.7;
      // a lid the visitor already moved by hand only has the remaining travel to cover
      const a = Math.abs(to - angle) < 0.01 ? Promise.resolve() : tween('lid', angle, to, full * (Math.abs(to - angle) / OPEN), easeLid, setAngle);
      const ct = open ? 1 : 0;
      const c = Math.abs(ct - camT) < 0.001 ? Promise.resolve() : tween('cam', camT, ct, full * Math.abs(ct - camT), easeCam, (x) => (camT = x));
      return Promise.all([a, c]).then(() => undefined);
    },
    setScreenOn(on) {
      lightTo = on ? 1 : 0;
      dirty = true;
    },
    setInteractive(on) {
      interactive = on;
    },
    closeLid,
    resetView,
    tapKey(code, down) {
      if (inFs || !keyMeshes.has(code)) return;
      clearTimeout(releaseTimers.get(code));
      setPressed(code, down, false);
      // modifier keyup can be swallowed by the browser (⌘Tab), so never leave a key stuck
      if (down) releaseTimers.set(code, window.setTimeout(() => setPressed(code, false, false), 1200));
    },
    setHeld(codes) {
      held.clear();
      for (const c of codes) {
        held.add(c);
        if (!press.has(c)) press.set(c, { cur: 0, to: 0 });
      }
      capsLed.visible = held.has('CapsLock');
      dirty = true;
    },
    inspect() {
      const toScreen = (p: THREE.Vector3) => {
        applyCamera();
        const v = p.clone().project(camera);
        return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
      };
      return {
        yaw,
        pitch,
        lid: angle,
        interactive,
        screen: shown,
        tweens: [...tweens.keys()],
        lidAngle: (x, y) => {
          const r = o.container.getBoundingClientRect();
          return lidAngleAt({ clientX: r.left + x, clientY: r.top + y } as PointerEvent, LH);
        },
        hitAt: (x, y) => {
          const r = o.container.getBoundingClientRect();
          return classify({ clientX: r.left + x, clientY: r.top + y } as PointerEvent).kind;
        },
        keyAt: (code) => {
          const m = keyMeshes.get(code);
          return m ? toScreen(m.getWorldPosition(new THREE.Vector3())) : null;
        },
        lidTop: () => toScreen(lid.localToWorld(new THREE.Vector3(0, LY0 + LH - 0.12, -0.25))),
      };
    },
    async enterFs(swap) {
      drag = null;
      o.container.style.cursor = '';
      if (rotated) await resetView();
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
      syncDisplay();
      css.render(scene, camera);
      await flip(o.host, first, 220);
      await tween('zoom', 1, 0, 720, easeZoom, (x) => (zoomT = x));
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      o.container.removeEventListener('pointerdown', onDown);
      o.container.removeEventListener('pointermove', onMove);
      o.container.removeEventListener('pointerup', onUp);
      o.container.removeEventListener('pointercancel', onUp);
      o.container.removeEventListener('lostpointercapture', onUp);
      for (const t of releaseTimers.values()) clearTimeout(t);
      sounds.dispose();
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
