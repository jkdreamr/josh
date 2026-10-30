// Buildings, cover and the uplink and spawn markers. Every box of every building is merged into one mesh per material
// (about eight draw calls for a whole town), textured with surfaces painted at load (plaster, planks, roof tiles,
// corrugated metal, concrete, sandbags) plus matching normal maps. Insides are darkened so rooms read as rooms.
import { mulberry32 } from '../noise.ts';
import { heightAt } from '../terrain.ts';
import type { Part, World } from '../world.ts';
import { ADDITIVE, DOUBLE, NO_SPACE, canvas, lin, patch, type Shared, type T, type Three } from './common.ts';

type Paint = { size: number; draw: (g: CanvasRenderingContext2D, h: CanvasRenderingContext2D, r: () => number) => void };

const S = 256;

function noiseFill(g: CanvasRenderingContext2D, r: () => number, base: number, amp: number, cells: number, alpha = 1) {
  const c = S / cells;
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const v = Math.max(0, Math.min(255, base + (r() - 0.5) * amp));
      g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
      g.fillRect(x * c, y * c, c + 1, c + 1);
    }
}

const PAINTS: Record<string, Paint> = {
  plaster: {
    size: 3,
    draw(g, h, r) {
      noiseFill(g, r, 228, 18, 8);
      noiseFill(g, r, 228, 26, 32, 0.35);
      noiseFill(g, r, 228, 30, 128, 0.25);
      noiseFill(h, r, 128, 30, 64);
      noiseFill(h, r, 128, 50, 256, 0.3);
      g.strokeStyle = 'rgba(90,85,80,0.35)';
      h.strokeStyle = 'rgba(40,40,40,0.9)';
      for (let k = 0; k < 3; k++) {
        let x = r() * S;
        let y = r() * S;
        g.beginPath();
        h.beginPath();
        g.moveTo(x, y);
        h.moveTo(x, y);
        for (let s = 0; s < 8; s++) {
          x += (r() - 0.5) * 30;
          y += r() * 18;
          g.lineTo(x, y);
          h.lineTo(x, y);
        }
        g.lineWidth = 1;
        h.lineWidth = 1.5;
        g.stroke();
        h.stroke();
      }
    },
  },
  wood: {
    size: 2,
    draw(g, h, r) {
      const rows = 8;
      const ph = S / rows;
      for (let i = 0; i < rows; i++) {
        const v = 200 + (r() - 0.5) * 50;
        g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`;
        g.fillRect(0, i * ph, S, ph);
        for (let k = 0; k < 14; k++) {
          const y = i * ph + r() * ph;
          g.strokeStyle = `rgba(60,45,30,${0.08 + r() * 0.12})`;
          g.lineWidth = 0.6 + r();
          g.beginPath();
          g.moveTo(0, y);
          for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + k) * 1.2);
          g.stroke();
        }
        const grad = h.createLinearGradient(0, i * ph, 0, (i + 1) * ph);
        grad.addColorStop(0, 'rgb(90,90,90)');
        grad.addColorStop(0.15, 'rgb(150,150,150)');
        grad.addColorStop(0.85, 'rgb(140,140,140)');
        grad.addColorStop(1, 'rgb(70,70,70)');
        h.fillStyle = grad;
        h.fillRect(0, i * ph, S, ph);
        g.fillStyle = 'rgba(40,30,20,0.55)';
        g.fillRect(0, i * ph, S, 1.5);
        const joint = r() * S;
        g.fillRect(joint, i * ph, 1.5, ph);
        h.fillStyle = 'rgb(50,50,50)';
        h.fillRect(joint, i * ph, 2, ph);
      }
    },
  },
  roof: {
    size: 2,
    draw(g, h, r) {
      const rows = 8;
      const ph = S / rows;
      const cols = 6;
      const pw = S / cols;
      for (let i = 0; i < rows; i++)
        for (let j = -1; j < cols; j++) {
          const x = j * pw + (i % 2) * pw * 0.5;
          const v = 205 + (r() - 0.5) * 40;
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(x + 1, i * ph + 1, pw - 2, ph - 1);
          const grad = h.createLinearGradient(0, i * ph, 0, (i + 1) * ph);
          grad.addColorStop(0, 'rgb(70,70,70)');
          grad.addColorStop(1, 'rgb(190,190,190)');
          h.fillStyle = grad;
          h.fillRect(x + 1, i * ph, pw - 2, ph);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x + 1, (i + 1) * ph - 3, pw - 2, 3);
        }
    },
  },
  metal: {
    size: 2.4,
    draw(g, h, r) {
      for (let x = 0; x < S; x++) {
        const s = Math.sin((x / S) * Math.PI * 2 * 12);
        const v = 200 + s * 22;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, 0, 1, S);
        const hv = 128 + s * 110;
        h.fillStyle = `rgb(${hv},${hv},${hv})`;
        h.fillRect(x, 0, 1, S);
      }
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(${110 + r() * 40},${60 + r() * 20},${30},${0.06 + r() * 0.14})`;
        const w = 6 + r() * 40;
        g.beginPath();
        g.ellipse(r() * S, r() * S, w, w * (0.4 + r()), 0, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  concrete: {
    size: 3,
    draw(g, h, r) {
      noiseFill(g, r, 200, 20, 16);
      noiseFill(g, r, 200, 40, 128, 0.3);
      noiseFill(h, r, 128, 40, 128);
      for (let k = 0; k < 900; k++) {
        const v = r() < 0.5 ? 120 : 245;
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.fillRect(r() * S, r() * S, 1.5, 1.5);
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, S / 2, S, 2);
      h.fillStyle = 'rgb(60,60,60)';
      h.fillRect(0, S / 2, S, 2);
    },
  },
  sandbag: {
    size: 1.6,
    draw(g, h, r) {
      g.fillStyle = 'rgb(150,140,120)';
      g.fillRect(0, 0, S, S);
      h.fillStyle = 'rgb(20,20,20)';
      h.fillRect(0, 0, S, S);
      const rows = 4;
      const ph = S / rows;
      for (let i = 0; i < rows; i++)
        for (let j = -1; j < 3; j++) {
          const x = j * (S / 2) + (i % 2) * (S / 4);
          const v = 210 + (r() - 0.5) * 30;
          g.fillStyle = `rgb(${v},${v * 0.98},${v * 0.93})`;
          g.beginPath();
          g.roundRect(x + 3, i * ph + 3, S / 2 - 6, ph - 6, 18);
          g.fill();
          const grad = h.createRadialGradient(x + S / 4, i * ph + ph / 2, 4, x + S / 4, i * ph + ph / 2, S / 4);
          grad.addColorStop(0, 'rgb(230,230,230)');
          grad.addColorStop(1, 'rgb(60,60,60)');
          h.fillStyle = grad;
          h.beginPath();
          h.roundRect(x + 3, i * ph + 3, S / 2 - 6, ph - 6, 18);
          h.fill();
        }
      noiseFill(g, r, 200, 30, 128, 0.18);
    },
  },
};

/** Albedo and normal map from a painter (the normal map from the height canvas by finite differences). */
function paintSet(THREE: Three, key: string, seed: number) {
  const p = PAINTS[key];
  const a = canvas(S, S);
  const h = canvas(S, S);
  const ga = a.getContext('2d')!;
  const gh = h.getContext('2d', { willReadFrequently: true })!;
  gh.fillStyle = 'rgb(128,128,128)';
  gh.fillRect(0, 0, S, S);
  p.draw(ga, gh, mulberry32(seed));
  const src = gh.getImageData(0, 0, S, S).data;
  const nc = canvas(S, S);
  const gn = nc.getContext('2d')!;
  const out = gn.createImageData(S, S);
  const H = (x: number, y: number) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * S + x) * 4;
      out.data[k] = (-dx / l) * 127 + 128;
      out.data[k + 1] = (dy / l) * 127 + 128;
      out.data[k + 2] = (1 / l) * 127 + 128;
      out.data[k + 3] = 255;
    }
  gn.putImageData(out, 0, 0);
  const map = new THREE.CanvasTexture(a);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const nmap = new THREE.CanvasTexture(nc);
  nmap.colorSpace = NO_SPACE;
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping;
  nmap.anisotropy = 8;
  return { map, nmap, size: p.size };
}

const PART_LOOK: Record<Part, { paint: string; rough: number; metal: number }> = {
  wall: { paint: 'plaster', rough: 0.92, metal: 0 },
  trim: { paint: 'wood', rough: 0.78, metal: 0 },
  roof: { paint: 'roof', rough: 0.8, metal: 0 },
  floor: { paint: 'wood', rough: 0.7, metal: 0 },
  wood: { paint: 'wood', rough: 0.86, metal: 0 },
  metal: { paint: 'metal', rough: 0.5, metal: 0.45 },
  sandbag: { paint: 'sandbag', rough: 1, metal: 0 },
  concrete: { paint: 'concrete', rough: 0.9, metal: 0 },
};

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** True when p0 p1 p2 wind counterclockwise seen from the side the normal points to. */
  private facing(p: number[][], n: number[]) {
    const ax = p[1][0] - p[0][0];
    const ay = p[1][1] - p[0][1];
    const az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0];
    const by = p[2][1] - p[0][1];
    const bz = p[2][2] - p[0][2];
    return (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] >= 0;
  }
  quad(p: number[][], n: number[], uv: number[][], c: number[]) {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...p[i]);
      this.nor.push(...n);
      this.uv.push(...uv[i]);
      this.col.push(...c);
    }
    if (this.facing(p, n)) this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  tri(p: number[][], n: number[], uv: number[][], c: number[]) {
    const b = this.pos.length / 3;
    for (let i = 0; i < 3; i++) {
      this.pos.push(...p[i]);
      this.nor.push(...n);
      this.uv.push(...uv[i]);
      this.col.push(...c);
    }
    if (this.facing(p, n)) this.idx.push(b, b + 1, b + 2);
    else this.idx.push(b, b + 2, b + 1);
  }
  build(THREE: Three) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.BufferAttribute(this.pos.length / 3 > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

export function buildings(THREE: Three, w: World, shared: Shared, shadows: boolean) {
  const group = new THREE.Group();
  const builders = new Map<string, Builder>();
  const get = (paint: string) => {
    let b = builders.get(paint);
    if (!b) builders.set(paint, (b = new Builder()));
    return b;
  };
  const inside = (x: number, y: number, z: number) => w.interiors.some((q) => x > q.x0 - 0.06 && x < q.x1 + 0.06 && z > q.z0 - 0.06 && z < q.z1 + 0.06 && y > q.y0 && y < q.y1 + 0.35);
  const sizeOf = (paint: string) => PAINTS[paint].size;
  for (const p of w.pieces) {
    const look = PART_LOOK[p.part];
    const key = `${p.part}`;
    const b = get(key);
    const ts = sizeOf(look.paint);
    const c = lin(p.color);
    const { x0, y0, z0, x1, y1, z1 } = p;
    const groundY = heightAt(w.terrain, (x0 + x1) / 2, (z0 + z1) / 2);
    const faces: [number[][], number[]][] = [
      [[[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]],
      [[[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [-1, 0, 0]],
      [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
      [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
      [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
    ];
    if (y0 > groundY + 0.4) faces.push([[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]]);
    for (const [pts, n] of faces) {
      const cx = (pts[0][0] + pts[2][0]) / 2;
      const cy = (pts[0][1] + pts[2][1]) / 2;
      const cz = (pts[0][2] + pts[2][2]) / 2;
      const dark = inside(cx, cy, cz) ? (n[1] > 0.5 ? 0.62 : 0.5) : 1;
      const uv = pts.map((q) => (n[0] !== 0 ? [q[2] / ts, q[1] / ts] : n[2] !== 0 ? [q[0] / ts, q[1] / ts] : [q[0] / ts, q[2] / ts]));
      b.quad(pts, n, uv, [c[0] * dark, c[1] * dark, c[2] * dark]);
    }
  }
  for (const gb of w.gables) {
    const roof = get('roof');
    const wall = get('wall');
    const rc = lin(gb.color);
    const wc = lin(gb.wall);
    const ts = sizeOf('roof');
    const tw = sizeOf('plaster');
    const { x0, z0, x1, z1, y, h } = gb;
    if (gb.alongX) {
      const zm = (z0 + z1) / 2;
      const half = (z1 - z0) / 2;
      const slope = Math.hypot(half, h);
      const ny = half / slope;
      const nz = h / slope;
      roof.quad([[x0, y, z0], [x1, y, z0], [x1, y + h, zm], [x0, y + h, zm]], [0, ny, -nz], [[x0 / ts, slope / ts], [x1 / ts, slope / ts], [x1 / ts, 0], [x0 / ts, 0]], rc);
      roof.quad([[x1, y, z1], [x0, y, z1], [x0, y + h, zm], [x1, y + h, zm]], [0, ny, nz], [[x1 / ts, slope / ts], [x0 / ts, slope / ts], [x0 / ts, 0], [x1 / ts, 0]], rc);
      wall.tri([[x0 + 0.5, y, z0 + 0.5], [x0 + 0.5, y, z1 - 0.5], [x0 + 0.5, y + h - 0.25, zm]], [-1, 0, 0], [[z0 / tw, y / tw], [z1 / tw, y / tw], [zm / tw, (y + h) / tw]], wc);
      wall.tri([[x1 - 0.5, y, z1 - 0.5], [x1 - 0.5, y, z0 + 0.5], [x1 - 0.5, y + h - 0.25, zm]], [1, 0, 0], [[z1 / tw, y / tw], [z0 / tw, y / tw], [zm / tw, (y + h) / tw]], wc);
    } else {
      const xm = (x0 + x1) / 2;
      const half = (x1 - x0) / 2;
      const slope = Math.hypot(half, h);
      const ny = half / slope;
      const nx = h / slope;
      roof.quad([[x0, y, z1], [x0, y, z0], [xm, y + h, z0], [xm, y + h, z1]], [-nx, ny, 0], [[z1 / ts, slope / ts], [z0 / ts, slope / ts], [z0 / ts, 0], [z1 / ts, 0]], rc);
      roof.quad([[x1, y, z0], [x1, y, z1], [xm, y + h, z1], [xm, y + h, z0]], [nx, ny, 0], [[z0 / ts, slope / ts], [z1 / ts, slope / ts], [z1 / ts, 0], [z0 / ts, 0]], rc);
      wall.tri([[x1 - 0.5, y, z0 + 0.5], [x0 + 0.5, y, z0 + 0.5], [xm, y + h - 0.25, z0 + 0.5]], [0, 0, -1], [[x1 / tw, y / tw], [x0 / tw, y / tw], [xm / tw, (y + h) / tw]], wc);
      wall.tri([[x0 + 0.5, y, z1 - 0.5], [x1 - 0.5, y, z1 - 0.5], [xm, y + h - 0.25, z1 - 0.5]], [0, 0, 1], [[x0 / tw, y / tw], [x1 / tw, y / tw], [xm / tw, (y + h) / tw]], wc);
    }
  }
  const textures: T.Texture[] = [];
  const paints = new Map<string, ReturnType<typeof paintSet>>();
  let seed = 11;
  for (const [key, b] of builders) {
    if (!b.idx.length) continue;
    const look = PART_LOOK[key as Part];
    let tex = paints.get(look.paint);
    if (!tex) {
      tex = paintSet(THREE, look.paint, seed++);
      paints.set(look.paint, tex);
      textures.push(tex.map, tex.nmap);
    }
    const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.nmap, roughness: look.rough, metalness: look.metal, vertexColors: true });
    mat.normalScale.set(0.9, 0.9);
    patch(mat, shared, {
      key: 'dz-build',
      albedo: `#include <map_fragment>
      diffuseColor.rgb *= 0.9 + 0.2 * dzNoise(vDzWp.xz * 0.35 + vDzWp.y * 0.2);
      diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(-0.2, 1.2, vDzWp.y - dzHeight(vDzWp.xz)));`,
    });
    const mesh = new THREE.Mesh(b.build(THREE), mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------------------------------------------------------
// uplink beams and rings, spawn barriers

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWp;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uMode;
uniform float uFill;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWp;
void main() {
  vec3 V = normalize(cameraPosition - vWp);
  float rim = 1.0 - abs(dot(V, normalize(vN)));
  float a;
  if (uMode < 0.5) {
    // beam: bright core, fading up
    a = (0.25 + rim * 0.75) * (1.0 - smoothstep(0.0, 1.0, vUv.y)) * (0.75 + 0.25 * sin(uTime * 3.0 - vUv.y * 40.0));
  } else if (uMode < 1.5) {
    // barrier wall: hex-ish bands and a soft top
    float band = smoothstep(0.92, 1.0, fract(vUv.y * 6.0 - uTime * 0.4)) + smoothstep(0.96, 1.0, fract(vUv.x * 60.0));
    a = (0.08 + band * 0.4 + rim * 0.15) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  } else {
    // ground ring with a progress arc
    float ang = fract(atan(vWp.z - cameraPosition.z, vWp.x - cameraPosition.x) / 6.2832);
    a = 0.6 * (0.6 + 0.4 * sin(uTime * 4.0));
    a *= step(vUv.x, uFill) * 0.7 + 0.3;
  }
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

export type Markers = { group: T.Group; update(state: { site: number; live: boolean; barrier: boolean; fill: [number, number]; team: number; time: number }): void };

export function markers(THREE: Three, w: World): Markers {
  const group = new THREE.Group();
  const make = (mode: number, color: number) =>
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(...lin(color, mode === 0 ? 2.2 : 1.4)) }, uTime: { value: 0 }, uMode: { value: mode }, uFill: { value: 0 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: ADDITIVE,
      side: DOUBLE,
    });
  const beams = w.sites.map((s) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 70, 16, 1, true), make(0, 0xffe2a0));
    m.position.set(s.x, s.y + 35, s.z);
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  const rings = w.sites.map((s) => {
    const g = new THREE.RingGeometry(8.6, 9, 96, 1);
    g.rotateX(-Math.PI / 2);
    // u runs around the ring, for the progress arc
    const uv = g.attributes.uv as T.BufferAttribute;
    const p = g.attributes.position as T.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) + 1) % 1);
    const m = new THREE.Mesh(g, make(2, 0xffe2a0));
    m.position.set(s.x, s.y + 0.15, s.z);
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  const barriers = w.spawns.map((s, k) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 5, 96, 1, true), make(1, k === 0 ? 0x4fb4ff : 0xff6a4f));
    m.position.set(s.x, s.y + 2, s.z);
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  const blue = new THREE.Color(...lin(0x4fb4ff, 2.2));
  const red = new THREE.Color(...lin(0xff6a4f, 2.2));
  const gold = new THREE.Color(...lin(0xffe2a0, 2.2));
  return {
    group,
    update(st) {
      beams.forEach((b, k) => {
        const on = st.live && k === st.site;
        b.visible = on;
        rings[k].visible = on;
        if (!on) return;
        const u = (b.material as T.ShaderMaterial).uniforms;
        const ru = (rings[k].material as T.ShaderMaterial).uniforms;
        const lead = st.fill[0] > st.fill[1] ? 0 : st.fill[1] > st.fill[0] ? 1 : -1;
        const c = lead < 0 ? gold : lead === st.team ? blue : red;
        (u.uColor.value as T.Color).copy(c);
        (ru.uColor.value as T.Color).copy(c);
        u.uTime.value = st.time;
        ru.uTime.value = st.time;
        ru.uFill.value = Math.max(st.fill[0], st.fill[1]);
      });
      barriers.forEach((b) => {
        b.visible = st.barrier;
        (b.material as T.ShaderMaterial).uniforms.uTime.value = st.time;
      });
    },
  };
}
