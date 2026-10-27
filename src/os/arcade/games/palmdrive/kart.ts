// A kart and its driver, after a real 125cc race kart (makeKart in scene.ts puts them together): the steel tube
// chassis on four bare wheels (no suspension: the frame flexes), the plastic bodywork in the paint (the nose cone, the
// front fairing, the side pods and the rear bumper), the bucket seat, the engine on the right with its chain down to
// the live rear axle and the exhaust round behind the seat, the radiator on the left, number plates and stickers; and
// the driver in a race suit, gloves, boots and a full-face helmet, posed each frame (leaning out of the turns, the head
// turning into them, hands on the wheel, a fist in the air at the finish).
//
// Everything but the paint is drawn with one shared material: vertex colours over a small sticker atlas, each vertex
// carrying how glossy it is (rubber, cloth, carbon, paint, chrome) and whether it glows. So a kart is a handful of
// draws: the paint, the trim, the chassis, the driver (one skinned mesh: torso, arms, helmet and steering wheel), the
// two front wheels and the rear axle with both its wheels; a far one swaps all but the paint for a few boxes.
import type { T } from './gl';
import type { Wheel } from './garage';
import { canvas, texture } from './scenery';

type Three = typeof import('three');
type RGB = [number, number, number];
/** A rectangle of the sticker atlas, as texture coordinates [u0, v0, u1, v1]. */
type UV = [number, number, number, number];
type V3 = [number, number, number];

/** How a part catches the light: s, how glossy (0 rubber or cloth to over 1 chrome); e, how much it glows; uv, a sticker. */
type Look = { s?: number; e?: number; uv?: UV | null };
const RUBBER: Look = { s: 0.05 };
const CLOTH: Look = { s: 0.06 };
const PLASTIC: Look = { s: 0.2 };
const SATIN: Look = { s: 0.1 };
const GLOSS: Look = { s: 0.75 };
const CARBON: Look = { s: 0.45 };
const ALLOY: Look = { s: 0.8 };
const CHROME: Look = { s: 1.2 };
const GLASS: Look = { s: 1.4 };
const GLOW: Look = { s: 0, e: 1 };

type Part = { g: T.BufferGeometry; m: T.Matrix4; c: RGB; s: number; e: number; uv: UV | null; bone: number };

// ---------------------------------------------------------------------------------------------------------------
// The sticker atlas: a white block (what every plain part samples), the Stanford and Palm Drive stickers, the Block S,
// the Tree, a checker, the digits for the number plates and the lettering round a tyre's sidewall.

const AW = 512;
const AH = 256;
const rect = (x: number, y: number, w: number, h: number): UV => [x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH];
const PLAIN: UV = rect(60, 60, 8, 8);
const STICKER = {
  stanford: rect(128, 0, 256, 64),
  blockS: rect(384, 0, 64, 64),
  tree: rect(448, 0, 64, 64),
  palm: rect(128, 64, 256, 64),
  checker: rect(384, 64, 64, 64),
  digit: (d: number) => rect(d * 40 + 3, 131, 34, 58),
  tyre: rect(0, 192, 512, 32),
  cardinal: rect(0, 224, 256, 32),
};

function drawAtlas(g: CanvasRenderingContext2D) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, AW, AH);
  const text = (s: string, x: number, y: number, font: string, color: string) => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };
  // Stanford, white on cardinal, with a pinstripe
  g.fillStyle = '#8c1515';
  g.fillRect(128, 0, 256, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.strokeRect(134, 6, 244, 52);
  text('Stanford', 256, 34, 'bold 40px Georgia, serif', '#ffffff');
  // the Block S
  g.fillStyle = '#8c1515';
  g.fillRect(384, 0, 64, 64);
  g.beginPath();
  g.arc(416, 32, 28, 0, Math.PI * 2);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.stroke();
  text('S', 416, 35, 'bold 40px Georgia, serif', '#ffffff');
  // the Tree: a green redwood on white
  g.fillStyle = '#2f8a3c';
  for (let i = 0; i < 4; i++) {
    const y = 6 + i * 11;
    const w = 7 + i * 6;
    g.beginPath();
    g.moveTo(480, y);
    g.lineTo(480 + w, y + 16);
    g.lineTo(480 - w, y + 16);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#8c1515';
  g.fillRect(476, 54, 8, 9);
  // Palm Drive, black italic on white with a cardinal underline
  g.fillStyle = '#f7f7f2';
  g.fillRect(128, 64, 256, 64);
  text('PALM DRIVE', 256, 90, 'italic bold 36px Arial, sans-serif', '#1b1c22');
  g.fillStyle = '#8c1515';
  g.fillRect(148, 112, 216, 7);
  // a checker
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) % 2 ? '#1b1c22' : '#ffffff';
      g.fillRect(384 + i * 8, 64 + j * 8, 8, 8);
    }
  }
  // the digits, black on white
  for (let d = 0; d < 10; d++) text(String(d), d * 40 + 20, 163, 'bold 52px Arial, sans-serif', '#111111');
  // a tyre's sidewall lettering, light on black (twice round)
  g.fillStyle = '#16171b';
  g.fillRect(0, 192, 512, 32);
  for (const x of [128, 384]) text('PALM DRIVE  ·  SLICK  ·', x, 209, 'bold 19px Arial, sans-serif', '#d0d0d0');
  // Cardinal, cardinal on gold
  g.fillStyle = '#f2c230';
  g.fillRect(0, 224, 256, 32);
  text('CARDINAL', 128, 241, 'italic bold 26px Arial, sans-serif', '#8c1515');
}

// ---------------------------------------------------------------------------------------------------------------
// What every kart shares, kept with the race's shared kart materials.

type Kit = {
  /** The material everything but the paint is drawn with; the primitives parts are made of; the shapes made so far. */
  mat: T.MeshPhongMaterial;
  prims: { box: T.BoxGeometry; cyl: T.CylinderGeometry; cyl6: T.CylinderGeometry; pipe: T.CylinderGeometry; ball: T.SphereGeometry; ball6: T.SphereGeometry; plane: T.PlaneGeometry; torus: T.TorusGeometry };
  cache: Map<string, T.BufferGeometry>;
  /** The soft shadow under a kart. */
  shadow: T.MeshBasicMaterial;
};
const kits = new WeakMap<object, Kit>();
const ADD_OPERATION = 2 as T.Combine;

/**
 * The shared material: vertex colours times the atlas, lit like Phong with each vertex's own gloss (attribute sheen.x
 * scales the highlight and the sky's reflection) and glow (sheen.y).
 */
function kitMaterial(THREE: Three, atlas: T.Texture, env: T.Texture | null) {
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, map: atlas, specular: 0x8a8a8a, shininess: 55, envMap: env, combine: ADD_OPERATION, reflectivity: 0.25 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 sheen;\nvarying vec2 vSheen;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSheen = sheen;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSheen;')
      .replace('#include <specularmap_fragment>', 'float specularStrength = vSheen.x;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSheen.y;');
  };
  mat.customProgramCacheKey = () => 'palmdrive-kart';
  return mat;
}

/** A soft shadow the shape of a kart, darkest under the four tyres, for the ground under it. */
function shadowTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 128, (g) => {
      const blob = (x: number, y: number, rx: number, ry: number, a: number) => {
        g.save();
        g.translate(x, y);
        g.scale(rx, ry);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        grad.addColorStop(0, `rgba(0,0,0,${a})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, 1, 0, Math.PI * 2);
        g.fill();
        g.restore();
      };
      blob(32, 64, 30, 62, 0.4);
      blob(32, 64, 20, 44, 0.28);
      // (the canvas's top is the kart's back: the big rear tyres there, the front ones lower down)
      for (const x of [11, 53]) {
        blob(x, 36, 11, 18, 0.6);
        blob(x, 94, 9, 15, 0.55);
      }
    }),
  );
}

function kitOf(THREE: Three, key: object, env: T.Texture | null = null): Kit {
  let k = kits.get(key);
  if (k) return k;
  const atlas = texture(THREE, canvas(AW, AH, drawAtlas));
  k = {
    mat: kitMaterial(THREE, atlas, env),
    prims: {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
      pipe: new THREE.CylinderGeometry(1, 1, 1, 7, 1, true),
      ball: new THREE.SphereGeometry(1, 9, 6),
      ball6: new THREE.SphereGeometry(1, 6, 4),
      plane: new THREE.PlaneGeometry(1, 1),
      torus: new THREE.TorusGeometry(1, 0.12, 5, 16),
    },
    cache: new Map(),
    shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false }),
  };
  kits.set(key, k);
  return k;
}

/**
 * What every kart shares, kept with the race's shared kart materials (`key`); env is what glossy parts reflect (none on
 * the cheap tier), set by the first call.
 */
export function kartKit(THREE: Three, key: object, env: T.Texture | null) {
  return kitOf(THREE, key, env);
}

// ---------------------------------------------------------------------------------------------------------------
// Building a model out of parts, each placed by its own matrix, in one geometry.

function rgb(THREE: Three, c: number | RGB): RGB {
  if (Array.isArray(c)) return c;
  const col = new THREE.Color(c);
  return [col.r, col.g, col.b];
}

function parts(THREE: Three, kit: Kit) {
  const list: Part[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let bone = 0;
  const M = (p: V3, s: V3, r: V3 = [0, 0, 0]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), q.setFromEuler(e.set(r[0], r[1], r[2])), new THREE.Vector3(...s));
  const push = (g: T.BufferGeometry, m: T.Matrix4, c: number | RGB, f: Look = PLASTIC) => {
    list.push({ g, m, c: rgb(THREE, c), s: f.s ?? 0.3, e: f.e ?? 0, uv: f.uv ?? null, bone });
  };
  const put = (g: T.BufferGeometry) => (c: number | RGB, p: V3, s: V3, r: V3 = [0, 0, 0], f: Look = PLASTIC) => push(g, M(p, s, r), c, f);
  /** A tube from a to b, r thick. */
  const tube = (c: number | RGB, a: V3, b: V3, r: number, f: Look = CHROME, g: T.BufferGeometry = kit.prims.pipe) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(r, len, r));
    push(g, m, c, f);
  };
  /** A bent tube through each point in turn (a thick one's bends rounded off with a ball). */
  const bent = (c: number | RGB, pts: V3[], r: number, f: Look = CHROME) => {
    for (let i = 0; i + 1 < pts.length; i++) tube(c, pts[i], pts[i + 1], r, f);
    if (r > 0.03) for (let i = 1; i + 1 < pts.length; i++) push(kit.prims.ball6, M(pts[i], [r, r, r]), c, f);
  };
  /** A sticker: a w by h rectangle of the atlas at p, facing the way its rotation turns +z. */
  const sticker = (uv: UV, p: V3, w: number, h: number, r: V3 = [0, 0, 0], c: number | RGB = 0xffffff, s = 0.5) => push(kit.prims.plane, M(p, [w, h, 1], r), c, { s, uv });
  /** A number: its digits side by side, w wide in all and h high, centred on the place `at` puts the origin. */
  const number = (n: number, at: T.Matrix4, w: number, h: number, c: number | RGB) => {
    const ds = String(n).split('').map(Number);
    const step = Math.min(w / ds.length, h * 0.62);
    ds.forEach((d, i) => push(kit.prims.plane, at.clone().multiply(M([step * (i - (ds.length - 1) / 2), 0, 0], [step, h, 1])), c, { s: 0.45, uv: STICKER.digit(d) }));
  };
  return {
    list,
    M,
    push,
    box: put(kit.prims.box),
    cyl: put(kit.prims.cyl),
    cyl6: put(kit.prims.cyl6),
    ball: put(kit.prims.ball),
    ball6: put(kit.prims.ball6),
    tube,
    bent,
    sticker,
    number,
    /** What is added next moves with this bone (in a skinned model). */
    bone(n: number) {
      bone = n;
    },
  };
}
type Parts = ReturnType<typeof parts>;

/**
 * For other models drawn the karts' way (the racing shells): a list of parts in the karts' material, how many vertices
 * they come to so far (to find a part again), and baking them into one geometry (skinned, or not).
 */
export function kartModel(THREE: Three, key: object) {
  const kit = kitOf(THREE, key);
  const a = parts(THREE, kit);
  return {
    ...a,
    mat: kit.mat,
    verts: () => a.list.reduce((n, p) => n + (p.g.index ? p.g.index.count : p.g.getAttribute('position').count), 0),
    bake: (skinned = false) => bake(THREE, kit, a.list, skinned),
  };
}
/** How the parts of a model catch the light (see Look), and the stickers. */
export const FINISH = { RUBBER, CLOTH, PLASTIC, SATIN, GLOSS, CARBON, ALLOY, CHROME, GLASS, GLOW };
export { STICKER };

/**
 * All the parts in one geometry: position, normal, colour, the atlas coordinates and sheen (and, skinned, the bone),
 * the parts' own geometries disposed of after (but not the kit's).
 */
function bake(THREE: Three, kit: Kit, list: Part[], skinned = false) {
  let count = 0;
  const geos = list.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    count += g.getAttribute('position').count;
    return g;
  });
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const sheen = new Float32Array(count * 2);
  const skinIndex = skinned ? new Float32Array(count * 4) : null;
  const skinWeight = skinned ? new Float32Array(count * 4) : null;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  const mu = (PLAIN[0] + PLAIN[2]) / 2;
  const mv = (PLAIN[1] + PLAIN[3]) / 2;
  let o = 0;
  list.forEach((part, n) => {
    const g = geos[n];
    const p = g.getAttribute('position');
    const nr = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    nm.copy(part.m).invert().transpose();
    const flip = part.m.determinant() < 0;
    for (let k = 0; k < p.count; k++, o++) {
      const kk = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k;
      v.fromBufferAttribute(p, kk).applyMatrix4(part.m);
      pos[o * 3] = v.x;
      pos[o * 3 + 1] = v.y;
      pos[o * 3 + 2] = v.z;
      v.fromBufferAttribute(nr, kk).transformDirection(nm);
      nrm[o * 3] = v.x;
      nrm[o * 3 + 1] = v.y;
      nrm[o * 3 + 2] = v.z;
      col[o * 3] = part.c[0];
      col[o * 3 + 1] = part.c[1];
      col[o * 3 + 2] = part.c[2];
      if (part.uv && uv) {
        uvs[o * 2] = part.uv[0] + uv.getX(kk) * (part.uv[2] - part.uv[0]);
        uvs[o * 2 + 1] = part.uv[1] + uv.getY(kk) * (part.uv[3] - part.uv[1]);
      } else {
        uvs[o * 2] = mu;
        uvs[o * 2 + 1] = mv;
      }
      sheen[o * 2] = part.s;
      sheen[o * 2 + 1] = part.e;
      if (skinIndex && skinWeight) {
        skinIndex[o * 4] = part.bone;
        skinWeight[o * 4] = 1;
      }
    }
    if (g !== part.g) g.dispose();
  });
  const shared = new Set<T.BufferGeometry>(Object.values(kit.prims));
  for (const p of list) if (!shared.has(p.g)) p.g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('sheen', new THREE.BufferAttribute(sheen, 2));
  if (skinIndex && skinWeight) {
    out.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  }
  return out;
}

/** A flat ring in the xy plane (facing +z) from radius a to b, its texture running once round it. */
function band(THREE: Three, a: number, b: number, segs: number) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    pos.push(Math.cos(t) * a, Math.sin(t) * a, 0, Math.cos(t) * b, Math.sin(t) * b, 0);
    nrm.push(0, 0, 1, 0, 0, 1);
    uv.push(1 - i / segs, 0, 1 - i / segs, 1);
    if (i < segs) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// The wheels: a slick tyre with rounded shoulders and lettering on its sidewall on a deep-dish rim, in each style the
// Garage sells. A front wheel is one mesh (it steers); the rear pair turn together on the live axle, with the sprocket
// and the brake disc, in one mesh.

/** Where the kart's wheels are, in its own frame (+z forward, +x to the kart's left, the ground at y 0). */
export const WHEELS = { front: { x: 0.8, y: 0.28, z: 0.95, r: 0.28, w: 0.3 }, rear: { x: 0.84, y: 0.36, z: -0.82, r: 0.36, w: 0.42 } };

/** The tyre's cross-section, turned round the axle (along x): r in radius and w wide, its bead at rim radius rr. */
function tyre(THREE: Three, r: number, w: number, rr: number, segs: number) {
  const h = w / 2;
  const pts = [
    [rr * 0.98, -h * 0.9],
    [r * 0.86, -h],
    [r, -h * 0.6],
    [r, h * 0.6],
    [r * 0.86, h],
    [rr * 0.98, h * 0.9],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** One wheel in a garage style, its axle along x at x0, its rim on the `side` face (-1 the -x face, 1 the +x). */
function wheelParts(THREE: Three, kit: Kit, a: Parts, style: Wheel, r: number, w: number, side: number, x0 = 0, rear = false) {
  const P = (x: number): V3 => [x0 + side * x, 0, 0];
  const disc = (x: number, rad: number, thick: number, c: number, f: Look) => a.push(kit.prims.cyl, a.M(P(x), [rad, thick, rad], [0, 0, Math.PI / 2]), c, f);
  const ring = (x: number, rad: number, thick: number, c: number, f: Look) => a.push(kit.prims.torus, a.M(P(x), [rad, rad, thick], [0, Math.PI / 2, 0]), c, f);
  const tyreGrey = 0x1d1e22;
  if (style === 'spoke') {
    // a bicycle wheel: a thin tyre on a chrome rim, spokes you can see through and a hub
    const R = r * 0.92;
    ring(0, R, 0.32, tyreGrey, RUBBER);
    ring(0, R * 0.86, 0.2, 0xd5dbe2, CHROME);
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      const lean = (i % 2 ? 1 : -1) * w * 0.14;
      a.tube(0xc9ced6, [x0 + lean, 0, 0], [x0, Math.cos(t) * R * 0.82, Math.sin(t) * R * 0.82], 0.007, CHROME, kit.prims.cyl6);
    }
    disc(0, r * 0.12, w * 0.7, 0xc9ced6, CHROME);
    a.box(0xd8261e, [x0 + side * w * 0.1, r * 0.45, 0], [0.012, r * 0.18, 0.05], [0, 0, 0], GLOSS);
    return;
  }
  const chunky = style === 'chunky';
  const R = chunky ? r * 1.12 : r;
  const W = chunky ? w * 1.3 : w;
  const rr = R * (chunky ? 0.55 : 0.64);
  const out = W * 0.43;
  a.push(tyre(THREE, R, W, rr, 16), a.M(P(0), [1, 1, 1]), tyreGrey, RUBBER);
  if (chunky) {
    // knobbly off-road tread, two staggered rows
    for (let i = 0; i < 16; i++) {
      for (const row of [-1, 1]) {
        const t = (i / 16) * Math.PI * 2 + (row > 0 ? Math.PI / 16 : 0);
        a.box(0x26272c, [x0 + row * W * 0.22, Math.cos(t) * R, Math.sin(t) * R], [W * 0.36, 0.06, R * 0.2], [t, 0, 0], RUBBER);
      }
    }
  } else {
    // the sidewall's lettering (or a whitewall's white band)
    if (style === 'whitewall') a.push(band(THREE, R * 0.7, R * 0.88, 16), a.M(P(W / 2 + 0.002), [1, 1, 1], [0, (side * Math.PI) / 2, 0]), 0xf2f2ee, { s: 0.25 });
    else a.push(band(THREE, R * 0.74, R * 0.87, 16), a.M(P(W / 2 + 0.002), [1, 1, 1], [0, (side * Math.PI) / 2, 0]), 0xffffff, { s: 0.1, uv: STICKER.tyre });
  }
  // the rim: the deep dish, its face, the spokes and the hub with its nuts (and the hub inside, on a front wheel)
  const rimC: Record<Wheel, number> = { classic: 0xc5cad1, gold: 0xd8a93a, whitewall: 0xdfe4ea, chunky: 0x5d6168, spoke: 0, cardinal: 0xb9bec6, neon: 0x2a2c34 };
  const rim = rimC[style];
  const rimLook = chunky ? PLASTIC : style === 'neon' ? GLOSS : style === 'whitewall' ? CHROME : ALLOY;
  disc(0, rr * 1.02, W * 0.86, rim, rimLook);
  disc(out, rr * 1.07, 0.02, rim, rimLook);
  disc(out + 0.006, rr * 0.88, 0.012, 0x2b2d33, PLASTIC);
  if (style === 'cardinal') {
    // a cardinal hubcap with the Block S on it (which turns with the wheel)
    a.push(kit.prims.plane, a.M(P(out + 0.016), [rr * 1.75, rr * 1.75, 1], [0, (side * Math.PI) / 2, 0]), 0xffffff, { s: 0.5, uv: STICKER.blockS });
  } else {
    const n = style === 'neon' ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      a.box(style === 'neon' ? 0x3cf2ff : rim, [x0 + side * (out + 0.016), Math.cos(t) * rr * 0.5, Math.sin(t) * rr * 0.5], [0.024, rr * 0.86, rr * (style === 'neon' ? 0.12 : 0.24)], [t, 0, 0], style === 'neon' ? GLOW : rimLook);
    }
    if (style === 'neon') ring(out + 0.016, rr * 0.92, 0.25, 0x3cf2ff, GLOW);
    a.cyl6(style === 'gold' ? 0xb88a22 : 0x8d929a, P(out + 0.03), [rr * 0.3, 0.05, rr * 0.3], [0, 0, Math.PI / 2], ALLOY);
    a.cyl6(0xe0e2e6, P(out + 0.06), [rr * 0.11, 0.02, rr * 0.11], [0, 0, Math.PI / 2], CHROME);
  }
  if (!rear) a.cyl6(0x8d929a, P(-out), [rr * 0.5, 0.04, rr * 0.5], [0, 0, Math.PI / 2], ALLOY);
}

/** One front wheel (side: -1 on the kart's -x side, 1 its +x) in a style, r in radius and w wide. */
export function frontWheel(THREE: Three, key: object, style: Wheel, r: number, w: number, side: number) {
  const kit = kitOf(THREE, key);
  const id = `front:${style}:${r}:${w}:${side}`;
  let geo = kit.cache.get(id);
  if (!geo) {
    const a = parts(THREE, kit);
    wheelParts(THREE, kit, a, style, r, w, side);
    geo = bake(THREE, kit, a.list);
    kit.cache.set(id, geo);
  }
  return new THREE.Mesh(geo, kit.mat);
}

/**
 * The rear axle and both its wheels, centred between them (`track` apart): the live axle, the sprocket the chain drives
 * on the right and the brake disc on the left.
 */
export function rearAxle(THREE: Three, key: object, style: Wheel, r: number, w: number, track: number) {
  const kit = kitOf(THREE, key);
  const id = `rear:${style}:${r}:${w}:${track}`;
  let geo = kit.cache.get(id);
  if (!geo) {
    const a = parts(THREE, kit);
    for (const side of [-1, 1]) wheelParts(THREE, kit, a, style, r, w, side, (side * track) / 2, true);
    a.tube(0xb7bcc4, [-track / 2, 0, 0], [track / 2, 0, 0], 0.032, CHROME);
    // (the sprocket, teeth all round, and the drilled brake disc)
    a.cyl(0x2a2b30, [-0.62, 0, 0], [0.155, 0.016, 0.155], [0, 0, Math.PI / 2], ALLOY);
    a.cyl6(0x8d929a, [-0.62, 0, 0], [0.08, 0.03, 0.08], [0, 0, Math.PI / 2], ALLOY);
    a.cyl(0xa9aeb5, [0.32, 0, 0], [0.17, 0.02, 0.17], [0, 0, Math.PI / 2], CHROME);
    a.cyl6(0x6f747b, [0.32, 0, 0], [0.07, 0.04, 0.07], [0, 0, Math.PI / 2], ALLOY);
    geo = bake(THREE, kit, a.list);
    kit.cache.set(id, geo);
  }
  return new THREE.Mesh(geo, kit.mat);
}

// ---------------------------------------------------------------------------------------------------------------
// The bodywork, in the kart's paint (its shape shared by every kart, each wearing it in its own materials).

const SEAT_X = 0.05;
/** The driver: the hips, how long the back is and how far it leans back, the neck; the steering wheel's hub and tilt. */
const HIP: V3 = [SEAT_X, 0.31, -0.36];
const LEAN = 0.24;
const NECK = 0.86;
const WHEEL_AT: V3 = [SEAT_X, 0.86, 0.16];
const WHEEL_R = 0.17;
const WHEEL_TILT = 0.74;
/** Where a hat goes: on top of the helmet in the head's frame, and how much smaller than it was made. */
export const HAT_AT: V3 = [0, 0.39, 0.02];
export const HAT_SCALE = 0.74;
/** Where the head is when the driver is not being posed (where a far kart's hat sits). */
export const HEAD_REST: V3 = [SEAT_X, HIP[1] + Math.cos(LEAN) * NECK, HIP[2] - Math.sin(LEAN) * NECK];

/** The nose's top at z (it slopes down toward the front), and the side pods' outer faces. */
const NOSE_SLOPE = 0.17;
const noseTop = (z: number) => 0.34 - NOSE_SLOPE * (z - 1.0);
/** How high the nose's crown rises over its middle (between the front wheels and the front, about this much). */
const CROWN = 0.058;
const POD_OUT = 0.985;
/** The front fairing's place: its foot, leaned back toward the driver. */
const PANEL = { p: [0, 0.27, 1.12] as V3, tilt: -0.4 };

/**
 * The nose cone: lofted through cross-sections along z (narrow between the front wheels, wide ahead of them, rounded off
 * at the front), each crowned across the top and rounded at its edges; smooth, like moulded plastic.
 */
function noseGeometry(THREE: Three) {
  // [z, half-width, how far the top's crown rises]
  const st: [number, number, number][] = [[1.0, 0.42, 0.02], [1.14, 0.46, 0.025], [1.22, 0.52, 0.03], [1.28, 0.72, 0.045], [1.36, 0.83, 0.055], [1.48, 0.87, 0.06], [1.62, 0.86, 0.06], [1.73, 0.81, 0.055], [1.8, 0.71, 0.045], [1.85, 0.54, 0.03], [1.875, 0.3, 0.015]];
  // (the section, from the bottom of one side over the top to the other: x as a share of the half-width, and how far
  // up from the bottom to the top's edge (0 to 1) plus how much of the crown)
  const sec: [number, number, number][] = [[-0.93, 0, 0], [-1, 0.45, 0], [-0.985, 0.9, 0], [-0.9, 1, 0.3], [-0.6, 1, 0.75], [-0.25, 1, 0.97], [0, 1, 1]];
  const full = [...sec, ...sec.slice(0, -1).reverse().map(([x, u, c]) => [-x, u, c] as [number, number, number])];
  const pos: number[] = [];
  const idx: number[] = [];
  const P = full.length;
  for (const [z, w, crown] of st) {
    const top = noseTop(z);
    const bottom = 0.1 + 0.03 * (z - 1.0);
    for (const [x, u, c] of full) pos.push(x * w, bottom + (top - bottom) * u + crown * c, z);
  }
  for (let i = 0; i + 1 < st.length; i++) {
    for (let j = 0; j + 1 < P; j++) {
      const a = i * P + j;
      idx.push(a, a + P, a + 1, a + 1, a + P, a + P + 1);
    }
  }
  // (a cap at each end: a fan from the middle of the section)
  for (const [i, dir] of [[0, -1], [st.length - 1, 1]] as const) {
    const c = pos.length / 3;
    const [z, , crown] = st[i];
    pos.push(0, (0.1 + 0.03 * (z - 1.0) + noseTop(z) + crown) / 2, z);
    for (let j = 0; j + 1 < P; j++) idx.push(...(dir > 0 ? [c, i * P + j + 1, i * P + j] : [c, i * P + j, i * P + j + 1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function podGeometry(THREE: Three) {
  const s = new THREE.Shape();
  s.moveTo(-0.4, 0.1);
  s.lineTo(0.5, 0.1);
  s.quadraticCurveTo(0.6, 0.1, 0.6, 0.2);
  s.quadraticCurveTo(0.6, 0.3, 0.48, 0.31);
  s.lineTo(-0.26, 0.41);
  s.quadraticCurveTo(-0.4, 0.43, -0.4, 0.3);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.33, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 2, curveSegments: 5 });
  // (the shape's x is the kart's z; extruded in from the outer face)
  g.rotateY(-Math.PI / 2);
  g.translate(POD_OUT - 0.035, 0, 0);
  return g;
}

function bumperGeometry(THREE: Three) {
  const s = new THREE.Shape();
  s.moveTo(-1.2, 0.09);
  s.lineTo(-1.5, 0.09);
  s.quadraticCurveTo(-1.54, 0.09, -1.54, 0.16);
  s.lineTo(-1.52, 0.33);
  s.quadraticCurveTo(-1.5, 0.39, -1.42, 0.39);
  s.lineTo(-1.24, 0.35);
  s.quadraticCurveTo(-1.2, 0.34, -1.2, 0.28);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.025, bevelSegments: 2, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);
  g.translate(0.95, 0, 0);
  return g;
}

function panelGeometry(THREE: Three) {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.25, 0.3);
  s.quadraticCurveTo(0.24, 0.36, 0.18, 0.36);
  s.lineTo(-0.18, 0.36);
  s.quadraticCurveTo(-0.24, 0.36, -0.25, 0.3);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 4 });
}

/** Geometries placed and joined into one (positions and normals; uv too when `uv`), mirrored ones rewound. */
function join(THREE: Three, list: { g: T.BufferGeometry; m: T.Matrix4 }[], uv = false) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const { g: g0, m } of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    nm.copy(m).invert().transpose();
    const flip = m.determinant() < 0;
    for (let k = 0; k < p.count; k++) {
      const kk = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k;
      v.fromBufferAttribute(p, kk).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, kk).transformDirection(nm);
      nrm.push(v.x, v.y, v.z);
      if (uv) uvs.push(u.getX(kk), u.getY(kk));
    }
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}

const place = (THREE: Three, p: V3, s: V3 = [1, 1, 1], r: V3 = [0, 0, 0]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));

/**
 * The bodywork in two parts: the paint (the nose and the rear bumper) and the trim (the side pods and the front fairing,
 * a two-tone's second colour), each near and far.
 */
export function bodywork(THREE: Three, key: object) {
  const kit = kitOf(THREE, key);
  const get = (id: string, make: () => T.BufferGeometry) => {
    let g = kit.cache.get(id);
    if (!g) kit.cache.set(id, (g = make()));
    return g;
  };
  const I = new THREE.Matrix4();
  const box = kit.prims.box;
  return {
    paint: get('paint', () => {
      const [nose, bumper] = [noseGeometry(THREE), bumperGeometry(THREE)];
      bumper.computeVertexNormals();
      const out = join(THREE, [{ g: nose, m: I }, { g: bumper, m: I }]);
      nose.dispose();
      bumper.dispose();
      return out;
    }),
    trim: get('trim', () => {
      const [panel, pod] = [panelGeometry(THREE), podGeometry(THREE)];
      panel.computeVertexNormals();
      pod.computeVertexNormals();
      const out = join(THREE, [{ g: panel, m: place(THREE, PANEL.p, [1, 1, 1], [PANEL.tilt, 0, 0]) }, { g: pod, m: I }, { g: pod, m: new THREE.Matrix4().makeScale(-1, 1, 1) }]);
      panel.dispose();
      pod.dispose();
      return out;
    }),
    paintFar: get('paintFar', () => join(THREE, [{ g: box, m: place(THREE, [0, 0.22, 1.42], [1.6, 0.2, 0.8]) }, { g: box, m: place(THREE, [0, 0.24, -1.37], [1.98, 0.28, 0.32]) }])),
    trimFar: get('trimFar', () => join(THREE, [{ g: box, m: place(THREE, [0, 0.45, 1.2], [0.52, 0.34, 0.06], [PANEL.tilt, 0, 0]) }, { g: box, m: place(THREE, [0.79, 0.26, 0.09], [0.38, 0.3, 1.0]) }, { g: box, m: place(THREE, [-0.79, 0.26, 0.09], [0.38, 0.3, 1.0]) }])),
  };
}

/** The racing stripe finish: twin stripes over the nose, up the front fairing and over the rear bumper, in one geometry. */
export function stripeGeometry(THREE: Three, key: object) {
  const kit = kitOf(THREE, key);
  let g = kit.cache.get('stripes');
  if (!g) kit.cache.set('stripes', (g = stripes(THREE)));
  return g;
}
function stripes(THREE: Three) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const slope = Math.atan(NOSE_SLOPE);
  const fairing = place(THREE, PANEL.p, [1, 1, 1], [PANEL.tilt, 0, 0]);
  const list: { g: T.BufferGeometry; m: T.Matrix4 }[] = [];
  for (const sx of [-1, 1]) {
    list.push({ g: box, m: place(THREE, [sx * 0.12, noseTop(1.5) + CROWN + 0.004, 1.5], [0.12, 0.012, 0.6], [slope, 0, 0]) });
    list.push({ g: box, m: fairing.clone().multiply(place(THREE, [sx * 0.12, 0.18, 0.062], [0.11, 0.37, 0.012])) });
    list.push({ g: box, m: place(THREE, [sx * 0.12, 0.42, -1.33], [0.12, 0.012, 0.2], [-0.22, 0, 0]) });
    list.push({ g: box, m: place(THREE, [sx * 0.12, 0.24, -1.557], [0.12, 0.26, 0.012], [-0.1, 0, 0]) });
  }
  const out = join(THREE, list);
  box.dispose();
  return out;
}

/** The flames finish: decals down the outside of both side pods and over the nose, in one geometry. */
export function flameGeometry(THREE: Three, key: object) {
  const kit = kitOf(THREE, key);
  let g = kit.cache.get('flames');
  if (!g) kit.cache.set('flames', (g = flames(THREE)));
  return g;
}
function flames(THREE: Three) {
  const plane = new THREE.PlaneGeometry(1, 1);
  // (the decal's tongues are at its right-hand edge: pointing back on both sides, so the left one is mirrored)
  const out = join(
    THREE,
    [
      { g: plane, m: place(THREE, [POD_OUT + 0.002, 0.27, 0.06], [-1.0, 0.27, 1], [0, Math.PI / 2, 0]) },
      { g: plane, m: place(THREE, [-POD_OUT - 0.002, 0.27, 0.06], [1.0, 0.27, 1], [0, -Math.PI / 2, 0]) },
      { g: plane, m: place(THREE, [0, noseTop(1.5) + CROWN + 0.006, 1.5], [0.56, 0.6, 1], [-Math.PI / 2 + Math.atan(NOSE_SLOPE), 0, Math.PI / 2]) },
    ],
    true,
  );
  plane.dispose();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Each racer's livery: the suit in their colour with panels in a second, the helmet's own design, the visor's tint, the
// gloves, boots and chassis tubes, and the number on the plates. The CPU rivals each get their own (by their place in
// the field). All just for show.

export type Livery = { suit: number; panel: number; helmet: number; stripe: number; visor: number; gloves: number; boots: number; frame: number; number: number; seat: number };
const HELMETS = [0xf4f4f2, 0x1d1e24, 0xf2c230, 0xc9ced6, 0x1d1e24, 0x2a3b8f, 0xe8e2d0, 0xf4f4f2];
const PANELS = [0xf6f6f8, 0x1b1c22, 0xf2c230, 0xf6f6f8, 0x1b1c22, 0xd9dde2, 0xf6f6f8, 0x1b1c22];
const VISORS = [0x1a2433, 0x6a4a12, 0x14161c, 0x1d4f7a, 0x1a2433, 0x5a2a6a, 0x14161c, 0x2a5a3a];
const FRAMES = [0xc4c9d0, 0xc4c9d0, 0x2b2d33, 0xc4c9d0, 0xb98a3a, 0xc4c9d0, 0x8c1515, 0x2b2d33];

export function liveryOf(THREE: Three, color: string, idx: number): Livery {
  const n = ((idx % 8) + 8) % 8;
  const c = new THREE.Color(color);
  const suit = c.getHex();
  // (a pale suit gets dark panels, a dark one light ones)
  const l = c.getHSL({ h: 0, s: 0, l: 0 }).l;
  const panel = l > 0.7 ? 0x1b1c22 : l < 0.12 ? 0xf6f6f8 : PANELS[n];
  const helmet = HELMETS[n];
  const gloves = [0x1b1c22, 0xf6f6f8, suit][n % 3];
  return { suit, panel, helmet, stripe: Math.abs(helmet - suit) < 0x080808 ? panel : suit, visor: VISORS[n], gloves, boots: n % 2 ? 0x1b1c22 : 0xf6f6f8, frame: FRAMES[n], number: n + 1, seat: 0x17181c };
}

// ---------------------------------------------------------------------------------------------------------------
// The chassis: everything that does not move but the paint and the driver's top half, one mesh per kart (it carries
// the driver's legs in the suit and the number on the plates).

export function chassis(THREE: Three, key: object, lv: Livery) {
  const kit = kitOf(THREE, key);
  const a = parts(THREE, kit);
  const steel = lv.frame;
  const dark = 0x202127;
  const black = 0x141518;
  const alu = 0xb3b8bf;
  // the frame: two main rails bent in toward the front, cross members, the outer rails out to the rear bearing hangers,
  // the front axle beams and the kingpins, the tie rods, the side pods' mounts and the rear bumper's stays
  for (const sx of [-1, 1]) {
    a.bent(steel, [[sx * 0.36, 0.14, -1.02], [sx * 0.37, 0.14, 0.55], [sx * 0.26, 0.15, 1.25], [sx * 0.2, 0.17, 1.42]], 0.028);
    a.bent(steel, [[sx * 0.37, 0.14, 0.42], [sx * 0.56, 0.15, 0.2], [sx * 0.6, 0.16, -0.5], [sx * 0.46, 0.2, -0.82]], 0.026);
    a.tube(steel, [sx * 0.3, 0.15, 0.95], [sx * 0.6, 0.2, 0.95], 0.026);
    a.tube(steel, [sx * 0.36, 0.14, 0.75], [sx * 0.6, 0.2, 0.93], 0.022);
    a.cyl6(steel, [sx * 0.63, 0.27, 0.95], [0.035, 0.24, 0.035], [0, 0, sx * 0.12], CHROME);
    a.box(alu, [sx * 0.6, 0.2, 0.86], [0.04, 0.03, 0.16], [0, 0, 0], ALLOY);
    a.tube(alu, [SEAT_X, 0.2, 0.8], [sx * 0.58, 0.2, 0.84], 0.014, ALLOY);
    a.box(alu, [sx * 0.46, 0.27, -0.82], [0.06, 0.2, 0.14], [0, 0, 0], ALLOY);
    a.cyl6(dark, [sx * 0.46, 0.36, -0.82], [0.06, 0.08, 0.06], [0, 0, Math.PI / 2], ALLOY);
    a.tube(steel, [sx * 0.56, 0.16, 0.15], [sx * 0.66, 0.2, 0.15], 0.018);
    a.tube(steel, [sx * 0.36, 0.15, -1.0], [sx * 0.62, 0.2, -1.2], 0.022);
  }
  for (const z of [1.25, 0.55, -0.3, -1.02]) a.tube(steel, [-0.37, 0.14, z], [0.37, 0.14, z], 0.024);
  // the floor tray, carbon, between the rails
  a.box(0x2c2e34, [0, 0.11, 0.42], [0.62, 0.012, 1.5], [0, 0, 0], CARBON);
  // the pedals, and the steering column up to the wheel with its bearing
  for (const sx of [-1, 1]) {
    a.tube(alu, [SEAT_X + sx * 0.13, 0.14, 0.96], [SEAT_X + sx * 0.13, 0.28, 0.99], 0.016, ALLOY);
    a.box(alu, [SEAT_X + sx * 0.13, 0.3, 0.99], [0.09, 0.12, 0.02], [-0.5, 0, 0], ALLOY);
  }
  const top: V3 = [WHEEL_AT[0], WHEEL_AT[1] - Math.sin(WHEEL_TILT) * 0.08 - 0.02, WHEEL_AT[2] + Math.cos(WHEEL_TILT) * 0.08];
  a.tube(alu, [SEAT_X, 0.2, 0.96], top, 0.022, CHROME);
  a.tube(dark, [SEAT_X, 0.62, 0.46], [SEAT_X, 0.69, 0.38], 0.04, ALLOY);
  // the fuel tank between the driver's legs, and its cap
  a.box(0xe6e2d6, [SEAT_X, 0.24, 0.66], [0.2, 0.2, 0.36], [0, 0, 0], { s: 0.5 });
  a.cyl6(0x1d6fd6, [SEAT_X, 0.36, 0.74], [0.04, 0.04, 0.04], [0, 0, 0], GLOSS);
  // the seat: a fibreglass bucket, its back up behind the driver, its sides, and its stays down to the frame
  a.box(lv.seat, [SEAT_X, 0.19, -0.36], [0.44, 0.06, 0.46], [0, 0, 0], SATIN);
  a.box(lv.seat, [SEAT_X, 0.52, -0.66], [0.46, 0.66, 0.05], [LEAN, 0, 0], SATIN);
  for (const sx of [-1, 1]) {
    a.box(lv.seat, [SEAT_X + sx * 0.225, 0.4, -0.52], [0.05, 0.34, 0.4], [LEAN * 0.6, 0, 0], SATIN);
    a.tube(steel, [SEAT_X + sx * 0.18, 0.7, -0.75], [sx * 0.42, 0.2, -1.02], 0.016);
  }
  // the engine on the right: the crankcase, the finned cylinder and its head, the plug and its lead, the clutch drum and
  // the chain down to the axle under its guard; the carburettor and the air box ahead of it
  const ex = -0.46;
  a.box(alu, [ex, 0.3, -0.56], [0.24, 0.24, 0.32], [0, 0, 0], ALLOY);
  a.cyl(alu, [ex - 0.02, 0.5, -0.54], [0.1, 0.24, 0.1], [0.18, 0, 0], ALLOY);
  for (let k = 0; k < 6; k++) a.box(0x8d929a, [ex - 0.02, 0.42 + k * 0.035, -0.54 + k * 0.006], [0.26, 0.012, 0.26], [0.18, 0, 0], ALLOY);
  a.box(0x2a2c32, [ex - 0.02, 0.66, -0.51], [0.2, 0.06, 0.2], [0.18, 0, 0], ALLOY);
  a.cyl6(0xc8302a, [ex - 0.02, 0.72, -0.5], [0.025, 0.08, 0.025], [0, 0, 0], GLOSS);
  a.tube(0xc8302a, [ex - 0.02, 0.76, -0.5], [ex + 0.12, 0.6, -0.36], 0.008, GLOSS);
  a.cyl(dark, [-0.6, 0.3, -0.56], [0.1, 0.06, 0.1], [0, 0, Math.PI / 2], ALLOY);
  a.tube(0x4a4c52, [-0.62, 0.38, -0.56], [-0.62, 0.5, -0.82], 0.014, ALLOY);
  a.tube(0x4a4c52, [-0.62, 0.22, -0.56], [-0.62, 0.21, -0.82], 0.014, ALLOY);
  a.box(black, [-0.66, 0.36, -0.68], [0.03, 0.26, 0.42], [0, 0, 0], PLASTIC);
  a.box(0x5d6168, [ex + 0.17, 0.46, -0.42], [0.12, 0.1, 0.1], [0, 0, 0], ALLOY);
  a.cyl(black, [-0.3, 0.5, -0.22], [0.1, 0.28, 0.1], [0, 0, Math.PI / 2], PLASTIC);
  a.cyl6(dark, [-0.44, 0.5, -0.22], [0.105, 0.02, 0.105], [0, 0, Math.PI / 2], PLASTIC);
  // the exhaust: the header out of the cylinder and round behind the seat into the silencer, and out of two tail pipes
  a.bent(0xa7a097, [[ex - 0.02, 0.5, -0.66], [ex - 0.02, 0.48, -0.86], [-0.3, 0.5, -1.0]], 0.045, CHROME);
  a.cyl(0xb9bec4, [0, 0.5, -1.02], [0.085, 0.62, 0.085], [0, 0, Math.PI / 2], CHROME);
  for (const sx of [-1, 1]) {
    a.cyl6(0x2a2b30, [sx * 0.31, 0.5, -1.02], [0.09, 0.03, 0.09], [0, 0, Math.PI / 2], ALLOY);
    a.tube(0xb9bec4, [sx * 0.3, 0.5, -1.06], [sx * 0.3, 0.47, -1.42], 0.035, CHROME);
    a.cyl6(0x3a3b40, [sx * 0.3, 0.47, -1.42], [0.04, 0.02, 0.04], [Math.PI / 2, 0, 0], ALLOY);
  }
  // the radiator on the left: its core and hoses
  a.box(alu, [0.43, 0.56, -0.48], [0.07, 0.42, 0.34], [0, 0, 0], ALLOY);
  a.box(0x2c2e33, [0.468, 0.56, -0.48], [0.012, 0.36, 0.28], [0, 0, 0], PLASTIC);
  for (let k = 0; k < 5; k++) a.box(0x6a6e75, [0.476, 0.42 + k * 0.07, -0.48], [0.008, 0.012, 0.28], [0, 0, 0], ALLOY);
  a.bent(black, [[0.43, 0.36, -0.58], [0.3, 0.26, -0.8], [-0.3, 0.3, -0.75]], 0.022, PLASTIC);
  a.tube(black, [0.43, 0.76, -0.4], [0.3, 0.6, -0.18], 0.018, PLASTIC);
  // the brake caliper over the disc
  a.box(0xc8302a, [0.32, 0.52, -0.82], [0.06, 0.08, 0.12], [0, 0, 0], GLOSS);
  // the driver's legs in the suit (they never move), out to the boots on the pedals
  for (const sx of [-1, 1]) {
    const hip: V3 = [SEAT_X + sx * 0.11, 0.3, -0.3];
    const knee: V3 = [SEAT_X + sx * 0.19, 0.55, 0.14];
    const ankle: V3 = [SEAT_X + sx * 0.13, 0.31, 0.86];
    a.tube(lv.suit, hip, knee, 0.088, CLOTH);
    a.ball6(lv.suit, knee, [0.088, 0.088, 0.088], [0, 0, 0], CLOTH);
    a.tube(lv.suit, knee, ankle, 0.068, CLOTH);
    // (a panel down the outside of the thigh)
    a.tube(lv.panel, [hip[0] + sx * 0.07, hip[1] + 0.02, hip[2] + 0.04], [knee[0] + sx * 0.07, knee[1] - 0.01, knee[2]], 0.03, CLOTH);
    // (the boot: up at its pedal, toe pointing up, its sole)
    a.box(lv.boots, [ankle[0], ankle[1] + 0.02, ankle[2] + 0.05], [0.1, 0.13, 0.22], [-0.95, 0, 0], PLASTIC);
    a.box(0x2a2b30, [ankle[0], ankle[1] - 0.04, ankle[2] + 0.1], [0.105, 0.03, 0.22], [-0.95, 0, 0], RUBBER);
  }
  a.ball(lv.suit, [SEAT_X, 0.3, -0.34], [0.2, 0.12, 0.2], [0, 0, 0], CLOTH);
  // the number plates and stickers: the fairing's plate, a roundel on each side pod with Stanford and Cardinal ahead of
  // it, Palm Drive on the nose, the Tree and the Block S on the bumper, the plate on the back and the rear lights
  const plate = 0xf2d23a;
  const fairing = place(THREE, PANEL.p, [1, 1, 1], [PANEL.tilt, 0, 0]);
  a.push(kit.prims.plane, fairing.clone().multiply(a.M([0, 0.19, 0.062], [0.32, 0.24, 1])), plate, { s: 0.45 });
  a.number(lv.number, fairing.clone().multiply(a.M([0, 0.19, 0.064], [1, 1, 1])), 0.26, 0.2, plate);
  for (const sx of [-1, 1]) {
    const rot: V3 = [0, (sx * Math.PI) / 2, 0];
    a.cyl(0xf6f6f2, [sx * (POD_OUT + 0.003), 0.27, -0.16], [0.13, 0.006, 0.13], [0, 0, Math.PI / 2], { s: 0.4 });
    a.number(lv.number, a.M([sx * (POD_OUT + 0.0075), 0.27, -0.16], [1, 1, 1], rot), 0.16, 0.16, 0xffffff);
    a.sticker(STICKER.stanford, [sx * (POD_OUT + 0.004), 0.27, 0.23], 0.34, 0.085, rot);
    a.sticker(STICKER.cardinal, [sx * (POD_OUT + 0.004), 0.17, 0.23], 0.32, 0.04, rot);
  }
  a.sticker(STICKER.palm, [0, noseTop(1.62) + CROWN + 0.006, 1.62], 0.42, 0.105, [-Math.PI / 2 + Math.atan(NOSE_SLOPE), 0, 0]);
  a.sticker(STICKER.tree, [0.3, 0.22, -1.565], 0.13, 0.13, [-0.1, Math.PI, 0]);
  a.sticker(STICKER.blockS, [-0.3, 0.22, -1.565], 0.13, 0.13, [-0.1, Math.PI, 0]);
  a.box(plate, [0, 0.53, -1.44], [0.34, 0.24, 0.02], [0, 0, 0], { s: 0.4 });
  a.tube(alu, [0, 0.4, -1.42], [0, 0.44, -1.3], 0.012, ALLOY);
  a.number(lv.number, a.M([0, 0.53, -1.452], [1, 1, 1], [0, Math.PI, 0]), 0.26, 0.2, plate);
  for (const sx of [-1, 1]) a.box(0xd8261e, [sx * 0.7, 0.27, -1.555], [0.16, 0.05, 0.03], [-0.1, 0, 0], { s: 0.6, e: 0.35 });
  // (it casts no shadow: a tangle of thin tubes, under the bodywork's and the driver's, which do)
  const mesh = new THREE.Mesh(bake(THREE, kit, a.list), kit.mat);
  mesh.name = 'detail';
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------
// The driver: one skinned mesh, its bones set each frame. Bone 0 is the torso (from the hips), 1 the head (from the
// neck), 2 the steering wheel (on its column), 3 and 4 the left arm (upper arm, then the forearm and glove), 5 and 6 the
// right.

export type Driver = {
  mesh: T.SkinnedMesh;
  bones: T.Object3D[];
  /** Where the helmet's stripe is in the geometry's colours (to repaint it). */
  stripe: [number, number];
  livery: Livery;
};

const UPPER = 0.4;
const FORE = 0.4;

export function driver(THREE: Three, key: object, lv: Livery): Driver {
  const kit = kitOf(THREE, key);
  const a = parts(THREE, kit);
  // the torso, in its bone's frame: up +y from the hips, the chest toward +z; panels down its sides, the zip and the
  // collar, a Block S on the chest and Stanford across the back
  a.bone(0);
  const torso = new THREE.LatheGeometry(
    [[0.001, -0.04], [0.18, -0.02], [0.2, 0.1], [0.21, 0.3], [0.25, 0.5], [0.255, 0.62], [0.225, 0.73], [0.13, 0.81], [0.07, 0.86], [0.001, 0.87]].map(([x, y]) => new THREE.Vector2(x, y)),
    12,
  );
  const deep = 0.8;
  a.push(torso, a.M([0, 0, 0], [1, 1, deep]), lv.suit, CLOTH);
  for (const sx of [-1, 1]) a.box(lv.panel, [sx * 0.222, 0.38, 0], [0.04, 0.56, 0.22], [0, 0, sx * -0.07], CLOTH);
  a.box(0x2a2b30, [0, 0.45, 0.25 * deep - 0.008], [0.014, 0.5, 0.01], [0, 0, 0], CLOTH);
  a.cyl(0x1b1c22, [0, 0.82, 0], [0.11, 0.08, 0.1], [0, 0, 0], CLOTH);
  a.sticker(STICKER.blockS, [0.11, 0.6, 0.255 * deep - 0.002], 0.09, 0.09, [-0.1, 0.35, 0], 0xffffff, 0.15);
  a.sticker(STICKER.stanford, [0, 0.58, -0.255 * deep - 0.003], 0.36, 0.09, [0.1, Math.PI, 0], 0xffffff, 0.15);
  // the head: a full-face helmet on the neck (the shell, the visor across the front, a stripe over the top, a lip of a
  // spoiler at the back, the chin vent and the open bottom), in its bone's frame
  a.bone(1);
  a.cyl(0x1b1c22, [0, 0.03, 0], [0.075, 0.12, 0.075], [0, 0, 0], CLOTH);
  const C: V3 = [0, 0.17, 0.02];
  const R: V3 = [0.24, 0.255, 0.275];
  const shell = new THREE.SphereGeometry(1, 13, 9);
  a.push(shell, a.M(C, R), lv.helmet, GLOSS);
  const visor = new THREE.SphereGeometry(1, 12, 4, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2);
  a.push(visor, a.M(C, [R[0] * 1.03, R[1] * 1.03, R[2] * 1.03]), lv.visor, GLASS);
  const stripeAt = a.list.length;
  const stripe = new THREE.SphereGeometry(1, 3, 8, Math.PI * 0.5 - 0.17, 0.34, 0, Math.PI * 0.4);
  const stripeBack = new THREE.SphereGeometry(1, 3, 10, Math.PI * 1.5 - 0.17, 0.34, 0, Math.PI * 0.62);
  a.push(stripe, a.M(C, [R[0] * 1.02, R[1] * 1.02, R[2] * 1.02]), lv.stripe, GLOSS);
  a.push(stripeBack, a.M(C, [R[0] * 1.02, R[1] * 1.02, R[2] * 1.02]), lv.stripe, GLOSS);
  a.box(lv.stripe, [0, 0.34, -0.2], [0.2, 0.025, 0.08], [0.5, 0, 0], GLOSS);
  const stripeEnd = a.list.length;
  a.box(0x2a2b30, [0, 0.04, 0.25], [0.1, 0.035, 0.03], [0.35, 0, 0], PLASTIC);
  a.cyl(0x141518, [0, -0.05, 0.01], [0.17, 0.03, 0.2], [0, 0, 0], RUBBER);
  // the steering wheel, in its bone's frame: the rim in the xy plane facing the driver (-z), three spokes, the hub and
  // the lap timer's screen
  a.bone(2);
  a.push(kit.prims.torus, a.M([0, 0, 0], [WHEEL_R, WHEEL_R, WHEEL_R * 1.3]), 0x1b1c22, RUBBER);
  for (const t of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const tt = t - Math.PI / 2;
    a.box(0x8d929a, [Math.cos(tt) * WHEEL_R * 0.5, Math.sin(tt) * WHEEL_R * 0.5, 0.01], [WHEEL_R * 0.95, 0.03, 0.012], [0, 0, tt], ALLOY);
  }
  a.cyl(0x2a2b30, [0, 0, 0.02], [0.05, 0.05, 0.05], [Math.PI / 2, 0, 0], ALLOY);
  a.box(0x1b1c22, [0, 0.075, -0.01], [0.12, 0.07, 0.03], [0, 0, 0], PLASTIC);
  a.box(0x8cf0a0, [0, 0.075, -0.027], [0.095, 0.045, 0.004], [0, 0, 0], { s: 0.8, e: 0.6 });
  // the arms in the suit, each bone from its joint along +y: the shoulder and upper arm (a panel down it), then the
  // elbow, the forearm and the glove with its cuff
  for (const [up, fore] of [[3, 4], [5, 6]]) {
    a.bone(up);
    a.ball(lv.suit, [0, 0, 0], [0.09, 0.09, 0.09], [0, 0, 0], CLOTH);
    a.push(new THREE.CylinderGeometry(0.062, 0.078, UPPER, 8, 1, true), a.M([0, UPPER / 2, 0], [1, 1, 1]), lv.suit, CLOTH);
    a.push(new THREE.CylinderGeometry(0.024, 0.024, UPPER * 0.9, 4, 1, true), a.M([0, UPPER / 2, 0.058], [1, 1, 1]), lv.panel, CLOTH);
    a.bone(fore);
    a.ball6(lv.suit, [0, 0, 0], [0.063, 0.063, 0.063], [0, 0, 0], CLOTH);
    a.push(new THREE.CylinderGeometry(0.05, 0.062, FORE * 0.8, 8, 1, true), a.M([0, FORE * 0.4, 0], [1, 1, 1]), lv.suit, CLOTH);
    a.cyl6(lv.gloves === lv.suit ? lv.panel : lv.gloves, [0, FORE * 0.8, 0], [0.06, 0.07, 0.06], [0, 0, 0], CLOTH);
    a.ball6(lv.gloves, [0, FORE * 0.97, 0], [0.058, 0.075, 0.064], [0, 0, 0], CLOTH);
  }
  // (where the stripe's vertices are, counted before the parts' geometries go)
  let from = 0;
  let to = 0;
  let n = 0;
  a.list.forEach((p, i) => {
    if (i === stripeAt) from = n;
    n += p.g.index ? p.g.index.count : p.g.getAttribute('position').count;
    if (i === stripeEnd - 1) to = n;
  });
  const geo = bake(THREE, kit, a.list, true);
  const bones = Array.from({ length: 7 }, () => new THREE.Object3D());
  const mesh = new THREE.SkinnedMesh(geo, kit.mat);
  for (const b of bones) mesh.add(b);
  // (plain objects as bones: all a skeleton needs of them is their matrices)
  mesh.bind(new THREE.Skeleton(bones as unknown as T.Bone[], bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  mesh.userData.kartBody = true;
  mesh.name = 'driver';
  const d: Driver = { mesh, bones, stripe: [from, to], livery: lv };
  poseDriver(THREE, d, REST);
  // (its bounds as it sits, for its shadow, and a generous sphere round it to cull by whatever its pose)
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.center.set(SEAT_X, 0.9, -0.1);
  mesh.boundingSphere!.radius = 1.3;
  return d;
}

/** Paints the helmet's stripe: the design's own colour, or a two-tone's trim or a racing stripe's. */
export function repaintHelmet(THREE: Three, d: Driver, color: number) {
  const col = d.mesh.geometry.getAttribute('color') as T.BufferAttribute;
  const c = new THREE.Color(color);
  for (let k = d.stripe[0]; k < d.stripe[1]; k++) col.setXYZ(k, c.r, c.g, c.b);
  col.needsUpdate = true;
}

/** How the driver sits this frame. */
export type Stance = {
  /** The steering wheel turned, -1 to 1 (1 hard right); the body leaning out of a turn (radians, + rolling toward -x). */
  steer: number;
  lean: number;
  /** The head's turn (+ to the left) and nod (+ down). */
  yaw: number;
  pitch: number;
  /** A fist in the air (0 to 1, the right hand off the wheel); both arms thrown up in a hit (0 to 1). */
  cheer: number;
  flail: number;
  clock: number;
  /** Breathing, -1 to 1. */
  breathe: number;
};
const REST: Stance = { steer: 0, lean: 0, yaw: 0, pitch: 0, cheer: 0, flail: 0, clock: 0, breathe: 0 };

type Scratch = Record<'a' | 'b' | 'c' | 'd' | 'e' | 'up' | 'sh' | 'hand' | 'elbow' | 'pole', T.Vector3>;
let V: Scratch | null = null;
let E: T.Euler | null = null;

/** Where the joint goes between bones l1 and l2 long reaching from a to b, bent toward pole (into out). */
function solve(a: T.Vector3, b: T.Vector3, l1: number, l2: number, pole: T.Vector3, out: T.Vector3) {
  const v = V!;
  v.a.subVectors(b, a);
  const d = Math.max(0.05, Math.min(v.a.length(), l1 + l2 - 1e-4));
  const dir = v.a.normalize();
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  v.b.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(a).addScaledVector(dir, x).addScaledVector(v.b, h);
}

/** Puts a bone at `from`, its +y pointing at `to`. */
function aim(bone: T.Object3D, from: T.Vector3, to: T.Vector3) {
  bone.position.copy(from);
  V!.c.subVectors(to, from).normalize();
  bone.quaternion.setFromUnitVectors(V!.up, V!.c);
}

export function poseDriver(THREE: Three, d: Driver, st: Stance) {
  if (!V) {
    const keys = ['a', 'b', 'c', 'd', 'e', 'up', 'sh', 'hand', 'elbow', 'pole'] as const;
    V = Object.fromEntries(keys.map((k) => [k, new THREE.Vector3()])) as Scratch;
    V.up.set(0, 1, 0);
    E = new THREE.Euler();
  }
  const v = V;
  const e = E!;
  const [torso, head, wheel] = d.bones;
  // the torso: leaned back in the seat, out of a turn, breathing, thrown back by a hit
  torso.position.set(...HIP);
  torso.quaternion.setFromEuler(e.set(-LEAN + st.breathe * 0.015 - st.flail * 0.12, st.lean * 0.3, st.lean, 'YXZ'));
  torso.updateMatrix();
  // the head on the neck: upright, a little against the lean, turning and nodding
  head.position.set(0, NECK, 0).applyMatrix4(torso.matrix);
  head.quaternion.setFromEuler(e.set(0.06 + st.pitch, st.yaw, st.lean * 0.35, 'YXZ'));
  // the steering wheel on its column, turned
  wheel.position.set(...WHEEL_AT);
  wheel.quaternion.setFromEuler(e.set(WHEEL_TILT, 0, st.steer * 1.2, 'XYZ'));
  wheel.updateMatrix();
  // the arms, shoulder to the hands on the wheel at a quarter to three, the elbows out and down: the right off the
  // wheel and up in a fist at the finish, both thrown up in a hit
  for (const [n, sx] of [[0, 1], [1, -1]] as const) {
    v.sh.set(sx * 0.25, 0.71, 0.01).applyMatrix4(torso.matrix);
    const t = sx > 0 ? 0.25 : Math.PI - 0.25;
    v.hand.set(Math.cos(t) * WHEEL_R, Math.sin(t) * WHEEL_R, -0.03).applyMatrix4(wheel.matrix);
    v.pole.set(sx * 0.9, -0.7, -0.4);
    const cheer = sx < 0 ? st.cheer : 0;
    const raise = Math.max(cheer, st.flail);
    if (raise > 0) {
      const pump = cheer > 0 ? Math.sin(st.clock * 9) * 0.07 : Math.sin(st.clock * 22 + sx) * 0.08;
      v.d.set(sx * (cheer > 0 ? 0.1 : 0.4), 0.82 + pump, cheer > 0 ? 0.14 : 0.06).add(v.sh);
      v.hand.lerp(v.d, raise);
      v.pole.lerp(v.e.set(sx * 0.9, -0.1, -0.5), raise);
    }
    solve(v.sh, v.hand, UPPER, FORE, v.pole, v.elbow);
    aim(d.bones[3 + n * 2], v.sh, v.elbow);
    aim(d.bones[4 + n * 2], v.elbow, v.hand);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A kart far off: the chassis, the driver and the wheels as a few boxes in one mesh (the paint swaps to its own).

export function farKart(THREE: Three, key: object, lv: Livery) {
  const kit = kitOf(THREE, key);
  const a = parts(THREE, kit);
  const { front: F, rear: B } = WHEELS;
  for (const sx of [-1, 1]) {
    for (const W of [F, B]) {
      a.cyl6(0x1d1e22, [sx * W.x, W.y, W.z], [W.r, W.w, W.r], [0, 0, Math.PI / 2], RUBBER);
      a.cyl6(0xc5cad1, [sx * (W.x + W.w / 2), W.y, W.z], [W.r * 0.6, 0.01, W.r * 0.6], [0, 0, Math.PI / 2], ALLOY);
    }
  }
  a.box(lv.frame, [0, 0.14, 0.1], [0.8, 0.04, 2.3], [0, 0, 0], CHROME);
  a.box(lv.seat, [SEAT_X, 0.5, -0.64], [0.46, 0.66, 0.08], [LEAN, 0, 0], GLOSS);
  a.box(0xb3b8bf, [-0.48, 0.42, -0.56], [0.26, 0.42, 0.34], [0, 0, 0], ALLOY);
  a.box(0xb3b8bf, [0.43, 0.56, -0.48], [0.07, 0.42, 0.34], [0, 0, 0], ALLOY);
  a.cyl6(0xb9bec4, [0, 0.5, -1.02], [0.085, 0.62, 0.085], [0, 0, Math.PI / 2], CHROME);
  a.box(lv.suit, [SEAT_X, 0.42, 0.32], [0.42, 0.18, 1.1], [0.15, 0, 0], CLOTH);
  a.box(lv.suit, [SEAT_X, 0.74, -0.44], [0.46, 0.8, 0.3], [-LEAN, 0, 0], CLOTH);
  for (const sx of [-1, 1]) a.box(lv.suit, [SEAT_X + sx * 0.25, 0.9, -0.16], [0.11, 0.11, 0.66], [-0.2, 0, 0], CLOTH);
  a.box(0x1b1c22, [SEAT_X, 0.86, 0.16], [0.34, 0.3, 0.04], [WHEEL_TILT - Math.PI / 2, 0, 0], RUBBER);
  const head: V3 = [HEAD_REST[0], HEAD_REST[1] + 0.17, HEAD_REST[2] + 0.02];
  a.ball6(lv.helmet, head, [0.235, 0.25, 0.27], [0, 0, 0], GLOSS);
  a.box(lv.visor, [head[0], head[1] + 0.02, head[2] + 0.2], [0.32, 0.1, 0.14], [0, 0, 0], GLASS);
  a.box(lv.stripe, [head[0], head[1] + 0.22, head[2] - 0.02], [0.09, 0.06, 0.42], [0, 0, 0], GLOSS);
  a.box(0xf2d23a, [0, 0.53, -1.44], [0.34, 0.24, 0.02], [0, 0, 0], PLASTIC);
  const mesh = new THREE.Mesh(bake(THREE, kit, a.list), kit.mat);
  mesh.userData.kartBody = true;
  mesh.name = 'far';
  return mesh;
}
