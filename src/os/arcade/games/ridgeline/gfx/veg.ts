// Trees, rocks and grass. Trees are trunks plus crowns of leaf cards painted at load into one atlas; their normals bow
// outward from the crown so a whole tree shades like a soft volume, the sun glows through leaves from behind, and the
// wind sways them in the vertex shader. Grass blades are placed, planted on the ground, faded and blown entirely on the
// GPU around the camera: the CPU never touches them.
import type { TreeKind } from '../maps.ts';
import { mulberry32, type Rng } from '../noise.ts';
import { ARENA, type World } from '../world.ts';
import { COMMON, DOUBLE, NO_SPACE, RGBA, UNSIGNED_BYTE, canvas, lin, patch, type Shared, type T, type Three } from './common.ts';
import { GROUND_DECL } from './terrain.ts';

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Collects triangles with normals, uvs, colors and a sway weight. */
class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  idx: number[] = [];
  vert(p: V3, n: V3, u: number, v: number, c: V3, s: number) {
    this.pos.push(...p);
    this.nor.push(...n);
    this.uv.push(u, v);
    this.col.push(...c);
    this.sway.push(s);
    return this.pos.length / 3 - 1;
  }
  /** A card from its center and half extent vectors, normals bowed out from `from`. */
  card(c: V3, right: V3, up: V3, rect: [number, number, number, number], from: V3, sway: number, col: V3 = [1, 1, 1]) {
    const face = norm(cross(right, up));
    const corners: [V3, number, number][] = [
      [sub(sub(c, right), up), rect[0], rect[3]],
      [sub(add(c, right), up), rect[2], rect[3]],
      [add(add(c, right), up), rect[2], rect[1]],
      [add(sub(c, right), up), rect[0], rect[1]],
    ];
    const ids = corners.map(([p, u, v]) => {
      const out = norm(add(sub(p, from), [0, 0.35, 0]));
      const n = norm(add(mul(out, 0.8), mul(face, Math.sign(face[1] + 1e-3) * 0.2)));
      return this.vert(p, n, u, v, col, sway + Math.hypot(p[0], p[2]) * 0.06);
    });
    this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  /** A tapered tube from p0 (radius r0) to p1 (r1). */
  tube(p0: V3, p1: V3, r0: number, r1: number, seg: number, col: V3, s0: number, s1: number, rings = 2, bend: V3 = [0, 0, 0]) {
    const d = norm(sub(p1, p0));
    const a = norm(Math.abs(d[1]) > 0.9 ? cross(d, [1, 0, 0]) : cross(d, [0, 1, 0]));
    const b = cross(d, a);
    const base = this.pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const c = add(add(p0, mul(sub(p1, p0), t)), mul(bend, Math.sin(t * Math.PI * 0.5) * t));
      const r = r0 + (r1 - r0) * t;
      const shade = 0.85 + 0.15 * Math.sin(i * 2.3);
      for (let k = 0; k <= seg; k++) {
        const ang = (k / seg) * Math.PI * 2;
        const n = add(mul(a, Math.cos(ang)), mul(b, Math.sin(ang)));
        this.vert(add(c, mul(n, r)), n, k / seg, t, mul(col, shade), s0 + (s1 - s0) * t);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let k = 0; k < seg; k++) {
        const p = base + i * (seg + 1) + k;
        const q = p + seg + 1;
        // counterclockwise seen from outside, so the bark faces out
        this.idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
  }
}

function toGeometry(THREE: Three, groups: Acc[]) {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  let start = 0;
  groups.forEach((a, gi) => {
    const off = pos.length / 3;
    pos.push(...a.pos);
    nor.push(...a.nor);
    uv.push(...a.uv);
    col.push(...a.col);
    sway.push(...a.sway);
    for (const i of a.idx) idx.push(i + off);
    if (a.idx.length) g.addGroup(start, a.idx.length, gi);
    start += a.idx.length;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// atlas cells: 0 broad leaves, 1 pine sprays, 2 palm fronds, 3 small leaves
const CELL_RECT = (k: number): [number, number, number, number] => {
  const x = (k % 2) * 0.5;
  const y = Math.floor(k / 2) * 0.5;
  return [x + 0.004, y + 0.004, x + 0.496, y + 0.496];
};

/** Paints the leaf atlas, then fills transparent texels with the leaf color so mipmaps never darken the edges. */
function leafAtlas(THREE: Three) {
  const S = 512;
  const cv = canvas(S, S);
  const g = cv.getContext('2d')!;
  const r = mulberry32(77);
  const clip = (ox: number, oy: number) => {
    g.save();
    g.beginPath();
    g.rect(ox + 2, oy + 2, 252, 252);
    g.clip();
  };
  // broad leaves
  clip(0, 0);
  g.strokeStyle = 'rgb(70,52,36)';
  g.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    g.moveTo(128, 200);
    g.lineTo(128 + (r() - 0.5) * 200, 128 + (r() - 0.5) * 200);
    g.stroke();
  }
  for (let i = 0; i < 300; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 104 * (0.78 + 0.22 * Math.sin(a * 3 + 1));
    const x = 128 + Math.cos(a) * d;
    const y = 128 + Math.sin(a) * d;
    const hue = 80 + r() * 32;
    const light = 16 + r() * 16 + (d / 104) * 12 + (1 - y / 256) * 8;
    g.fillStyle = `hsl(${hue},${36 + r() * 24}%,${light}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, 7 + r() * 6, 3.5 + r() * 2.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `hsla(${hue},40%,${light + 14}%,0.45)`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(6, 0);
    g.stroke();
    g.restore();
  }
  g.restore();
  // pine spray: a stem along x with needles
  clip(256, 0);
  for (let pass = 0; pass < 2; pass++)
    for (let t = 0; t < 1; t += 0.008) {
      const x = 256 + 12 + t * 232;
      const y = 128 + Math.sin(t * 3) * 6 + t * 10;
      for (const side of [-1, 1]) {
        const len = (34 - t * 18) * (0.7 + r() * 0.5);
        const ang = side * (0.95 + (r() - 0.5) * 0.5) - 0.35;
        g.strokeStyle = `hsl(${105 + r() * 25},${34 + r() * 14}%,${(pass ? 22 : 13) + r() * 10}%)`;
        g.lineWidth = pass ? 1.3 : 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len);
        g.stroke();
      }
    }
  g.strokeStyle = 'rgb(60,42,30)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(268, 128);
  g.lineTo(500, 138);
  g.stroke();
  g.restore();
  // palm frond: a midrib up the cell with leaflets
  clip(0, 256);
  for (let t = 0.04; t < 1; t += 0.022) {
    const y = 256 + 250 - t * 244;
    const x = 128 + Math.sin(t * 2.4) * 8;
    for (const side of [-1, 1]) {
      const len = 118 * (Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.85 + 0.15) * (0.85 + r() * 0.25);
      g.strokeStyle = `hsl(${74 + r() * 22},${44 + r() * 18}%,${24 + r() * 14}%)`;
      g.lineWidth = 4.5 - t * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + side * len * 0.5, y - 6, x + side * len, y + 18 + t * 10);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgb(120,104,60)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(128, 506);
  g.quadraticCurveTo(136, 380, 132, 262);
  g.stroke();
  g.restore();
  // small round leaves
  clip(256, 256);
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 106;
    const x = 384 + Math.cos(a) * d;
    const y = 384 + Math.sin(a) * d * 1.05;
    g.fillStyle = `hsl(${70 + r() * 30},${40 + r() * 22}%,${22 + r() * 20 + (d / 106) * 8}%)`;
    g.beginPath();
    g.ellipse(x, y, 4 + r() * 3, 3 + r() * 2, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * 256;
    const oy = Math.floor(cell / 2) * 256;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let y = oy; y < oy + 256; y++)
      for (let x = ox; x < ox + 256; x++) {
        const k = (y * S + x) * 4;
        if (d[k + 3] > 200) {
          sr += d[k];
          sg += d[k + 1];
          sb += d[k + 2];
          n++;
        }
      }
    if (!n) continue;
    for (let y = oy; y < oy + 256; y++)
      for (let x = ox; x < ox + 256; x++) {
        const k = (y * S + x) * 4;
        if (d[k + 3] < 8) {
          d[k] = sr / n;
          d[k + 1] = sg / n;
          d[k + 2] = sb / n;
          d[k + 3] = 0;
        }
      }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), S, S, RGBA, UNSIGNED_BYTE);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const BARK: Partial<Record<TreeKind, number>> = { oak: 0x4a3a2c, pine: 0x4d3a2c, birch: 0xd8d2c6, snowpine: 0x3e3026, palm: 0x7a6650, cactus: 0x4f7a3a, deadtree: 0x6b5d50 };

function tree(kind: TreeKind, lite: boolean, r: Rng): [Acc, Acc] {
  const bark = new Acc();
  const leaf = new Acc();
  const bc = lin(BARK[kind] ?? 0x4a3a2c);
  const seg = lite ? 5 : 8;
  const rnd = (a: number, b: number) => a + r() * (b - a);
  const cards = (n: number, center: V3, rad: V3, size: [number, number], cell: number) => {
    for (let i = 0; i < n; i++) {
      const u = rnd(-1, 1);
      const ph = rnd(0, Math.PI * 2);
      const sq = Math.sqrt(1 - u * u);
      const f = rnd(0.45, 1);
      const dir: V3 = [Math.cos(ph) * sq, u, Math.sin(ph) * sq];
      const c: V3 = [center[0] + dir[0] * rad[0] * f, center[1] + dir[1] * rad[1] * f, center[2] + dir[2] * rad[2] * f];
      const nrm = norm(add(dir, [rnd(-0.6, 0.6), rnd(-0.3, 0.6), rnd(-0.6, 0.6)]));
      const right = norm(cross(nrm, Math.abs(nrm[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const up = cross(right, nrm);
      const s = rnd(size[0], size[1]) / 2;
      leaf.card(c, mul(right, s), mul(up, s), CELL_RECT(cell), center, 0.5);
    }
  };
  switch (kind) {
    case 'oak': {
      bark.tube([0, -0.3, 0], [0.2, 4.3, 0.1], 0.36, 0.2, seg, bc, 0, 0.25, 3);
      if (!lite)
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + r();
          bark.tube([0.15, 3.3 + k * 0.25, 0.05], [Math.cos(a) * 2.2, 5.4 + r(), Math.sin(a) * 2.2], 0.13, 0.04, 5, bc, 0.2, 0.5, 1);
        }
      cards(lite ? 8 : 20, [0.2, 5.9, 0.1], [3.1, 2.4, 3.1], [2.2, 3.1], 0);
      break;
    }
    case 'birch': {
      bark.tube([0, -0.3, 0], [0.25, 9.5, 0], 0.18, 0.05, seg, bc, 0, 0.5, 6);
      cards(lite ? 6 : 15, [0.15, 6.6, 0], [1.8, 3, 1.8], [1.4, 2], 3);
      break;
    }
    case 'pine':
    case 'snowpine': {
      const H = kind === 'pine' ? 11.5 : 10.5;
      bark.tube([0, -0.3, 0], [0, H, 0], 0.3, 0.04, seg, bc, 0, 0.35, 3);
      const tiers = kind === 'pine' ? 7 : 8;
      const per = lite ? 3 : kind === 'pine' ? 5 : 6;
      for (let k = 0; k < tiers; k++) {
        const y = 2.4 + (k / tiers) * (H - 2.8);
        const R = 3 * (1 - k / (tiers + 1)) + 0.5;
        const off = r() * Math.PI;
        for (let i = 0; i < per; i++) {
          const a = off + (i / per) * Math.PI * 2 + rnd(-0.2, 0.2);
          const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
          const tan: V3 = [-Math.sin(a), 0, Math.cos(a)];
          const right: V3 = [dir[0] * R * 0.55, -R * 0.2, dir[2] * R * 0.55];
          const c: V3 = [dir[0] * R * 0.52, y - R * 0.12, dir[2] * R * 0.52];
          leaf.card(c, right, mul(tan, R * 0.36), CELL_RECT(1), [0, y + 0.8, 0], 0.4);
        }
      }
      leaf.card([0, H - 0.3, 0], [0.6, 0, 0], [0, 0.9, 0], CELL_RECT(1), [0, H - 1.5, 0], 0.6);
      leaf.card([0, H - 0.3, 0], [0, 0, 0.6], [0, 0.9, 0], CELL_RECT(1), [0, H - 1.5, 0], 0.6);
      break;
    }
    case 'palm': {
      const H = 7.6;
      const lean: V3 = [1.3, 0, 0.2];
      bark.tube([0, -0.3, 0], [0, H, 0], 0.25, 0.17, seg, bc, 0, 0.7, lite ? 3 : 7, lean);
      const top: V3 = [lean[0], H, lean[2]];
      const fronds = lite ? 5 : 10;
      const rect = CELL_RECT(2);
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * Math.PI * 2 + rnd(-0.2, 0.2);
        const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
        const tan: V3 = [-Math.sin(a), 0, Math.cos(a)];
        const lift = rnd(0.3, 0.9);
        const mid = add(top, [dir[0] * 1.9, lift, dir[2] * 1.9]);
        const tip = add(top, [dir[0] * 3.9, lift - rnd(1.2, 2.2), dir[2] * 3.9]);
        const vm = (rect[1] + rect[3]) / 2;
        // two quads: base to middle, middle to tip (the texture's midrib runs bottom to top)
        const w0 = 0.65;
        const w1 = 0.55;
        const seg2 = (p0: V3, p1: V3, wa: number, wb: number, v0: number, v1: number) => {
          const ids = [
            leaf.vert(sub(p0, mul(tan, wa)), norm(add(sub(p0, top), [0, 1.5, 0])), rect[0], v0, [1, 1, 1], 0.6),
            leaf.vert(add(p0, mul(tan, wa)), norm(add(sub(p0, top), [0, 1.5, 0])), rect[2], v0, [1, 1, 1], 0.6),
            leaf.vert(add(p1, mul(tan, wb)), norm(add(sub(p1, top), [0, 1.2, 0])), rect[2], v1, [1, 1, 1], 1),
            leaf.vert(sub(p1, mul(tan, wb)), norm(add(sub(p1, top), [0, 1.2, 0])), rect[0], v1, [1, 1, 1], 1),
          ];
          leaf.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        };
        seg2(top, mid, w0 * 0.6, w0, rect[3], vm);
        seg2(mid, tip, w0, w1 * 0.4, vm, rect[1]);
      }
      break;
    }
    case 'cactus': {
      bark.tube([0, -0.3, 0], [0, 3.4, 0], 0.36, 0.3, seg + 2, bc, 0, 0, 3);
      bark.tube([0, 3.4, 0], [0, 3.75, 0], 0.3, 0.08, seg + 2, bc, 0, 0, 1);
      const arm = (y: number, s: number, h: number) => {
        bark.tube([0, y, 0], [s * 0.8, y + 0.15, 0], 0.2, 0.2, seg, bc, 0, 0, 1);
        bark.tube([s * 0.8, y, 0], [s * 0.85, y + h, 0], 0.21, 0.18, seg, bc, 0, 0, 2);
        bark.tube([s * 0.85, y + h, 0], [s * 0.85, y + h + 0.2, 0], 0.18, 0.05, seg, bc, 0, 0, 1);
      };
      arm(1.4, 1, 1.2);
      if (r() < 0.7) arm(2.1, -1, 0.9);
      break;
    }
    case 'deadtree': {
      bark.tube([0, -0.3, 0], [0.3, 5.6, 0], 0.22, 0.05, seg, bc, 0, 0.3, 3);
      for (let k = 0; k < (lite ? 2 : 6); k++) {
        const a = r() * Math.PI * 2;
        const y = 2 + r() * 3;
        bark.tube([0.1, y, 0], [Math.cos(a) * 1.8, y + 1 + r(), Math.sin(a) * 1.8], 0.08, 0.02, 4, bc, 0.2, 0.5, 1);
      }
      break;
    }
    case 'shrub': {
      cards(lite ? 4 : 9, [0, 0.55, 0], [1, 0.6, 1], [1, 1.5], r() < 0.5 ? 0 : 3);
      break;
    }
  }
  return [bark, leaf];
}

const TREE_VERT = /* glsl */ `
attribute float aSway;
uniform float uTime;
uniform vec2 uWind;
`;
const TREE_SWAY = /* glsl */ `
{
  float ph = 0.0;
  #ifdef USE_INSTANCING
  ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
  #endif
  float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ph * 0.3);
  float s = (sin(uTime * 1.25 + ph) * 0.14 + sin(uTime * 2.6 + ph * 1.7) * 0.05) * gust;
  transformed.xz += uWind * s * aSway * aSway * 1.6;
  transformed.y += sin(uTime * 3.4 + position.x * 2.1 + position.z * 1.7 + ph) * 0.035 * aSway;
}
`;

export type Veg = { group: T.Group; grass: T.Mesh | null; setGrass(n: number): void; setTreeFrac(f: number): void; casters(x: number, z: number): void; dispose(): void };

export function vegetation(THREE: Three, w: World, shared: Shared, opts: { grass: number; treeFrac: number; shadows: boolean }): Veg {
  const group = new THREE.Group();
  const def = w.def;
  const atlas = leafAtlas(THREE);
  const tint = def.id === 'mesa' ? [1.12, 1.04, 0.78] : def.id === 'frost' ? [0.7, 0.82, 0.8] : def.id === 'isles' ? [1, 1.12, 0.82] : [1, 1.02, 0.92];
  const leafMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, side: DOUBLE, roughness: 0.78, color: new THREE.Color(tint[0], tint[1], tint[2]) });
  patch(leafMat, shared, {
    key: 'dz-leaf',
    vertDecl: TREE_VERT,
    vertBody: TREE_SWAY,
    fragDecl: 'uniform float uSnowCover;',
    replace: [
      [
        '#include <alphatest_fragment>',
        `{
          vec2 dzT = vMapUv * 512.0;
          float dzLod = max(0.0, 0.5 * log2(max(dot(dFdx(dzT), dFdx(dzT)), dot(dFdy(dzT), dFdy(dzT)))));
          diffuseColor.a *= 1.0 + dzLod * 0.32;
          if (diffuseColor.a < alphaTest) discard;
          vec3 dzWN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uSnowCover * smoothstep(0.25, 0.8, dzWN.y) * 0.85);
        }`,
      ],
    ],
    normal: 'normal = normalize(vNormal);',
    light: `{
      vec3 dzV = normalize(vDzWp - cameraPosition);
      float dzTr = pow(max(dot(dzV, uSunDir), 0.0), 4.0);
      reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * dzTr * 0.22 * dzBaked(vDzWp.xz).r;
    }`,
  });
  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  patch(barkMat, shared, {
    key: 'dz-bark',
    vertDecl: TREE_VERT,
    vertBody: TREE_SWAY,
    albedo: 'diffuseColor.rgb *= 0.74 + 0.42 * dzNoise(vec2(vDzWp.y * 3.0, atan(vDzWp.z - floor(vDzWp.z), vDzWp.x - floor(vDzWp.x)) * 4.0) + vDzWp.xz * 7.0);',
  });

  const byKind = new Map<TreeKind, { near: number[]; far: number[] }>();
  w.trees.forEach((t, i) => {
    let e = byKind.get(t.kind);
    if (!e) byKind.set(t.kind, (e = { near: [], far: [] }));
    (Math.abs(t.x) < ARENA + 60 && Math.abs(t.z) < ARENA + 60 ? e.near : e.far).push(i);
  });
  const meshes: { mesh: T.InstancedMesh; total: number }[] = [];
  /**
   * Shadow casters: copies of the near trees within reach of the shadow box. They draw no instances in the main pass
   * and their trees only while the shadow map renders (three calls onBeforeShadow and onAfterShadow around it).
   */
  const casterSets: { mesh: T.InstancedMesh; src: Float32Array; xz: Float32Array; total: number; n: number }[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  for (const [kind, lists] of byKind) {
    for (const lite of [false, true]) {
      const list = lite ? lists.far : lists.near;
      if (!list.length) continue;
      const geo = toGeometry(THREE, tree(kind, lite, mulberry32(kind.length * 31 + (lite ? 7 : 3))));
      const mats = geo.groups.length > 1 ? [barkMat, leafMat] : kind === 'shrub' ? [leafMat, leafMat] : [barkMat, barkMat];
      const mesh = new THREE.InstancedMesh(geo, mats, list.length);
      // shuffle so that a lower count drops trees evenly
      const order = [...list];
      const rr = mulberry32(list.length);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rr() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      order.forEach((ti, k) => {
        const t = w.trees[ti];
        q.setFromAxisAngle(up, t.rot);
        pos.set(t.x, t.y - 0.05, t.z);
        scl.setScalar(t.s);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(k, m4);
        const b = 0.84 + t.tint * 0.3;
        mesh.setColorAt(k, color.setRGB(b, b * (0.97 + t.tint * 0.05), b * 0.95));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = !lite;
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push({ mesh, total: list.length });
      if (opts.shadows && !lite) {
        const cap = Math.min(order.length, 700);
        const caster = new THREE.InstancedMesh(geo, mats, cap);
        caster.castShadow = true;
        caster.receiveShadow = false;
        caster.frustumCulled = false;
        caster.count = 0;
        group.add(caster);
        const xz = new Float32Array(order.length * 2);
        order.forEach((ti, k) => {
          xz[k * 2] = w.trees[ti].x;
          xz[k * 2 + 1] = w.trees[ti].z;
        });
        const set = { mesh: caster, src: (mesh.instanceMatrix.array as Float32Array).slice(), xz, total: order.length, n: 0 };
        caster.onBeforeShadow = () => {
          caster.count = set.n;
        };
        caster.onAfterShadow = () => {
          caster.count = 0;
        };
        casterSets.push(set);
      }
    }
  }
  let treeFrac = opts.treeFrac;
  const setTreeFrac = (f: number) => {
    treeFrac = f;
    for (const m of meshes) m.mesh.count = Math.max(1, Math.round(m.total * f));
    lastCx = Infinity;
  };
  let lastCx = Infinity;
  let lastCz = Infinity;
  const casters = (x: number, z: number) => {
    if (Math.hypot(x - lastCx, z - lastCz) < 10) return;
    lastCx = x;
    lastCz = z;
    const R2 = 85 * 85;
    for (const c of casterSets) {
      const arr = c.mesh.instanceMatrix.array as Float32Array;
      const cap = c.mesh.instanceMatrix.count;
      const shown = Math.round(c.total * treeFrac);
      let n = 0;
      for (let k = 0; k < shown && n < cap; k++) {
        const dx = c.xz[k * 2] - x;
        const dz = c.xz[k * 2 + 1] - z;
        if (dx * dx + dz * dz > R2) continue;
        arr.set(c.src.subarray(k * 16, k * 16 + 16), n * 16);
        n++;
      }
      c.n = n;
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  setTreeFrac(opts.treeFrac);

  // rocks: three shapes, each in a fine version for the arena and a coarse one beyond
  const rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(def.ground.rock)), roughness: 0.88 });
  patch(rockMat, shared, {
    key: 'dz-rock',
    fragDecl: GROUND_DECL,
    albedo: `{
      vec3 wn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
      float n1 = dzNoise(vDzWp.xz * 1.7 + vDzWp.y * 1.3);
      float n2 = dzNoise(vDzWp.xz * 7.0 - vDzWp.y * 5.0);
      float strata = sin(vDzWp.y * 6.0 + n1 * 3.0) * 0.5 + 0.5;
      vec3 c = uRock * (0.7 + 0.35 * n1 + 0.15 * n2 + uStrata * (strata - 0.5) * 0.3);
      float top = smoothstep(0.45, 0.9, wn.y + (n2 - 0.5) * 0.3);
      c = mix(c, uGrassA * 0.75, top * 0.45 * (1.0 - uSnowCover) * (1.0 - uSandAmt));
      c = mix(c, uSand, top * uSandAmt * 0.6);
      c = mix(c, uSnow, top * uSnowCover);
      diffuseColor.rgb = c;
    }`,
  });
  const rockGeos = [0, 1, 2].map((v) => [rockGeometry(THREE, v, 2), rockGeometry(THREE, v, 1)]);
  for (let v = 0; v < 3; v++)
    for (const lite of [false, true]) {
      const list = w.rockList.filter((k) => k.v === v && (Math.abs(k.x) < ARENA + 50 && Math.abs(k.z) < ARENA + 50) !== lite);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(rockGeos[v][lite ? 1 : 0], rockMat, list.length);
      list.forEach((k, i) => {
        q.setFromAxisAngle(up, k.rot);
        pos.set(k.x, k.y, k.z);
        scl.set(k.s * (1.1 + (k.v - 1) * 0.15), k.s * k.flat, k.s);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = opts.shadows && !lite;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

  const grass = grassMesh(THREE, w, shared, opts.grass);
  if (grass) group.add(grass);
  return {
    group,
    grass,
    setGrass(n: number) {
      if (grass) (grass.geometry as T.InstancedBufferGeometry).instanceCount = Math.min(n, (grass.userData.max as number) ?? n);
      if (grass) grass.visible = n > 0;
    },
    setTreeFrac,
    casters,
    dispose() {
      atlas.dispose();
    },
  };
}

/** A lumpy boulder: an icosphere pushed in and out by 3D noise, its bottom flattened into the ground. */
function rockGeometry(THREE: Three, variant: number, detail: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as T.BufferAttribute;
  const h3 = (x: number, y: number, z: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + variant * 19.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const vn = (x: number, y: number, z: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const sz = zf * zf * (3 - 2 * zf);
    let out = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1;
      const dy = (k >> 1) & 1;
      const dz = (k >> 2) & 1;
      out += h3(xi + dx, yi + dy, zi + dz) * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
    }
    return out;
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = vn(x * 1.6 + 3, y * 1.6, z * 1.6) * 0.45 + vn(x * 3.7, y * 3.7 + 9, z * 3.7) * 0.18 + vn(x * 8, y * 8, z * 8 + 4) * 0.05;
    const k = 0.72 + n;
    let ny = y * k;
    if (ny < -0.35) ny = -0.35 + (ny + 0.35) * 0.25;
    p.setXYZ(i, x * k, ny, z * k);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const GRASS_VERT = /* glsl */ `
${COMMON}
${GROUND_DECL}
attribute vec2 aOff;
attribute vec2 aRnd;
uniform float uPatch;
uniform float uBladeH;
uniform float uDensity;
uniform float uDry;
varying vec3 vWp;
varying vec3 vCol;
varying float vT;
varying vec2 vBake;
varying vec3 vN;
void main() {
  vec2 base = aOff + floor((cameraPosition.xz - aOff) / uPatch + 0.5) * uPatch;
  float dist = length(base - cameraPosition.xz);
  float fade = 1.0 - smoothstep(uPatch * 0.3, uPatch * 0.5, dist);
  vec3 n = dzNormal(base);
  float hg = dzHeight(base);
  vec4 baked = dzBaked(base);
  float gm;
  vec4 L = dzLayers(vec3(base.x, hg, base.y), n, baked.a, gm);
  float patchy = smoothstep(0.25, 0.65, dzNoise(base * 0.21) * 0.7 + dzNoise(base * 1.3) * 0.3 + uDensity - 0.6);
  float weight = (1.0 - L.x) * (1.0 - L.y) * (1.0 - L.w) * (1.0 - L.z * 0.9) * patchy * step(uWater + 0.15, hg);
  float h = uBladeH * (0.55 + 0.9 * aRnd.x) * weight * fade;
  float t = position.y;
  if (h < 0.03 || abs(base.x) > 511.0 || abs(base.y) > 511.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float ang = aRnd.y * 6.2832;
  vec2 dir = vec2(cos(ang), sin(ang));
  float wv = sin(uTime * 1.8 + base.x * 0.17 + base.y * 0.11) * 0.5 + 0.5;
  wv = wv * 0.7 + 0.3 * dzNoise(base * 0.05 + uWind * uTime * 0.25);
  vec2 lean = uWind * (0.18 + wv * 0.55) + dir * 0.18 * aRnd.x;
  float bend = t * t;
  vec3 wp = vec3(base.x, hg - 0.04, base.y);
  // thin blades, widened with distance so they never shimmer below a pixel
  wp.xz += vec2(-dir.y, dir.x) * position.x * (0.016 + 0.014 * aRnd.x) * (1.0 + dist * 0.06) + lean * bend * h;
  wp.y += t * h * (1.0 - 0.25 * bend * length(lean));
  vWp = wp;
  vT = t;
  float fine = dzNoise(base * 1.7);
  vec3 g = dzGrassColor(vec3(base.x, hg, base.y), gm, fine);
  vec3 dry = mix(g, vec3(0.42, 0.36, 0.22), 0.65);
  vCol = mix(g, dry, uDry * (0.5 + 0.5 * aRnd.x)) * (0.85 + 0.3 * aRnd.y);
  vBake = vec2(baked.r * baked.b, baked.g);
  vN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWp;
varying vec3 vCol;
varying float vT;
varying vec2 vBake;
varying vec3 vN;
void main() {
  vec3 V = normalize(vWp - cameraPosition);
  float ndl = max(dot(vN, uSunDir), 0.0) * 0.75 + 0.25;
  float sun = vBake.x;
  vec3 albedo = vCol * mix(0.4, 0.95, vT);
  vec3 lightC = uSunColor * ndl * sun / 3.14159 + uAmbient * vBake.y * mix(0.55, 1.0, vT);
  vec3 col = albedo * lightC;
  float tr = pow(max(dot(V, uSunDir), 0.0), 3.0) * vT;
  col += vCol * uSunColor * tr * 0.16 * sun;
  gl_FragColor = vec4(dzFog(col, vWp), 1.0);
}
`;

function grassMesh(THREE: Three, w: World, shared: Shared, count: number) {
  const max = Math.max(count, 0);
  const def = w.def;
  if (max <= 0 || def.grass.density <= 0) return null;
  const patchSize = 64;
  const g = new THREE.InstancedBufferGeometry();
  // a blade: three segments narrowing to a tip; x is the side (-1..1), y runs root to tip
  const pos = [-1, 0, 0, 1, 0, 0, -0.8, 0.33, 0, 0.8, 0.33, 0, -0.55, 0.66, 0, 0.55, 0.66, 0, 0, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  const r = mulberry32(5);
  const off = new Float32Array(max * 2);
  const rnd = new Float32Array(max * 2);
  for (let i = 0; i < max; i++) {
    off[i * 2] = r() * patchSize;
    off[i * 2 + 1] = r() * patchSize;
    rnd[i * 2] = r();
    rnd[i * 2 + 1] = r();
  }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
  g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 2));
  g.instanceCount = max;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uPatch: { value: patchSize }, uBladeH: { value: def.grass.height }, uDensity: { value: def.grass.density }, uDry: { value: def.grass.dry } },
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    side: DOUBLE,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.userData.max = max;
  return m;
}

export { NO_SPACE };
