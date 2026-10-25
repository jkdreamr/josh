// What the road courses are made of, close up: the asphalt (its aggregate, tar-sealed cracks, patches, the dark lines
// worn in by tires and the paint, chipped), the paving of the Quad and the dirt out at the barn; the curbs and the
// sandstone walls; the ground all round, worked out from where it is so it never shows a repeat; the mown verges; and
// the grass growing along them, in tufts that sway. Redwood Slough's water and marsh are in water.ts.
import type { T } from './gl';
import type { CourseId } from './courses';
import { GLSL_NOISE, canvas, scatter, texture, type Look } from './scenery';
import { edgeAt, locate, pointAt, type Track } from './track';
import type { Quality } from './sky';

type Three = typeof import('three');

type Ground = {
  /** The ground's two main colors (great patches of one and the other), a third in smaller patches, and a dark fleck. */
  a: number;
  b: number;
  c: number;
  /** The mown verge: its light and dark stripes. */
  lawn: [number, number];
  /** Paint down the middle of the road (null: none). */
  center: string | null;
  /** The road's lines along its edges. */
  edges: string | null;
  /** Grass tufts along the verges and out across the ground: how thick (per meter of road, each side), their base and tip colors. */
  tufts: number;
  tuftBase: [number, number, number];
  tuftTip: [number, number, number];
  /** Wildflowers among them (rgb), if any. */
  flowers?: [number, number, number][];
  /** Nothing grows inside the loop (it is water). */
  wet?: boolean;
  /** The ground is paved in sandstone flags (the Quad's courts), the grass only along the walls. */
  paved?: boolean;
};

export const GROUNDS: Partial<Record<CourseId, Ground>> = {
  palm: { a: 0xbfae6a, b: 0x8f9a50, c: 0x6a8c44, lawn: [0x76b052, 0x67a046], center: '#f2c230', edges: '#f4f2ea', tufts: 3, tuftBase: [0.2, 0.26, 0.1], tuftTip: [0.62, 0.62, 0.3], flowers: [[0.96, 0.84, 0.3], [0.95, 0.95, 0.9]] },
  lake: { wet: true, a: 0xb2a462, b: 0x8f9a56, c: 0x6e8a48, lawn: [0x7aab5a, 0x6c9c4e], center: null, edges: '#f4f2ea', tufts: 3, tuftBase: [0.18, 0.24, 0.1], tuftTip: [0.58, 0.6, 0.3], flowers: [[0.95, 0.6, 0.75], [0.96, 0.84, 0.3]] },
  barn: { a: 0xc9b26a, b: 0xa59a58, c: 0x8aa04e, lawn: [0x8cae5c, 0x7d9f50], center: null, edges: null, tufts: 4, tuftBase: [0.24, 0.24, 0.1], tuftTip: [0.78, 0.68, 0.36], flowers: [[0.96, 0.84, 0.3], [0.62, 0.5, 0.86]] },
  dish: { a: 0xcdb46c, b: 0xb49a58, c: 0x8e8a4c, lawn: [0xb3a960, 0xa49b56], center: '#f2c230', edges: '#f4f2ea', tufts: 4, tuftBase: [0.32, 0.27, 0.12], tuftTip: [0.86, 0.74, 0.42], flowers: [[0.95, 0.7, 0.25]] },
  stadium: { a: 0xb9b080, b: 0x8f9a5c, c: 0x6f9050, lawn: [0x5ea64c, 0x519942], center: '#f4f2ea', edges: '#f4f2ea', tufts: 2, tuftBase: [0.16, 0.24, 0.1], tuftTip: [0.5, 0.62, 0.3] },
  quad: { paved: true, a: 0xd8c49a, b: 0xc8b088, c: 0xb8a27c, lawn: [0x82b05a, 0x74a24e], center: null, edges: null, tufts: 1.5, tuftBase: [0.18, 0.26, 0.1], tuftTip: [0.52, 0.64, 0.3], flowers: [[0.95, 0.4, 0.4], [0.96, 0.84, 0.3]] },
  hoover: { a: 0x34402e, b: 0x2c3828, c: 0x3a4630, lawn: [0x3d5a36, 0x35502f], center: '#e8c040', edges: '#d8d8d0', tufts: 2.5, tuftBase: [0.06, 0.09, 0.05], tuftTip: [0.2, 0.26, 0.16] },
  golf: { a: 0x4f8a34, b: 0x427a2c, c: 0x5c9a3c, lawn: [0x72b84e, 0x62a642], center: null, edges: null, tufts: 2.5, tuftBase: [0.1, 0.2, 0.06], tuftTip: [0.36, 0.56, 0.2], flowers: [[0.96, 0.95, 0.9]] },
};

/** Lambert-lit material whose diffuse color comes from a GLSL snippet over the world position (vW) and uv (vUv2). */
function procedural(THREE: Three, key: string, uniforms: Record<string, { value: unknown }>, decl: string, body: string, opts: T.MeshLambertMaterialParameters = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, ...opts });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPdW;\nvarying vec2 vPdUv;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         #ifdef USE_INSTANCING
         vPdW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
         vPdW = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif
         vPdUv = uv;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPdW;\nvarying vec2 vPdUv;\n${GLSL_NOISE}\n${decl}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${body}`);
  };
  mat.customProgramCacheKey = () => `pd-surf-${key}`;
  return mat;
}

const col = (THREE: Three, hex: number) => ({ value: new THREE.Color(hex) });

/** The ground all round: great drifts of its colors, smaller patches, tufts and flecks, the fine grain fading off. */
export function groundMaterial(THREE: Three, g: Ground) {
  return procedural(
    THREE,
    `ground-${g.a}-${g.b}-${g.paved ? 1 : 0}`,
    { uGa: col(THREE, g.a), uGb: col(THREE, g.b), uGc: col(THREE, g.c), uPaved: { value: g.paved ? 1 : 0 } },
    'uniform vec3 uGa, uGb, uGc;\nuniform float uPaved;',
    `vec2 p = vPdW.xz;
     float far = smoothstep(30.0, 220.0, length(vPdW - cameraPosition));
     float m = pdFbm(p * 0.011);
     float d = pdFbm(p * 0.05 + 5.0);
     vec3 gc = mix(uGa, uGb, smoothstep(0.38, 0.66, m));
     gc = mix(gc, uGc, smoothstep(0.56, 0.78, d) * 0.7);
     float f = mix(pdNoise(p * 1.7) * 0.55 + pdNoise(p * 5.3) * 0.45, 0.5, far);
     gc *= 0.8 + 0.36 * f;
     gc *= 0.9 + 0.2 * pdNoise(p * 0.23);
     if (uPaved > 0.5) {
       // (flags in courses, each course half a flag over, each flag its own shade, the joints fading off with distance)
       vec2 q = p / vec2(1.8, 0.9);
       q.x += floor(q.y) * 0.5;
       vec2 f = fract(q);
       float d = min(min(f.x, 1.0 - f.x) * 1.8, min(f.y, 1.0 - f.y) * 0.9);
       float grout = (1.0 - smoothstep(0.015, 0.045, d)) * (1.0 - smoothstep(25.0, 90.0, length(vPdW - cameraPosition)));
       gc *= 0.9 + 0.2 * pdHash(floor(q));
       gc = mix(gc, gc * 0.62, grout);
     }
     diffuseColor.rgb = gc;`,
  );
}

/** The mown verge: stripes along the road (v runs a unit every 8 m), the grass's grain in them. */
export function lawnMaterial(THREE: Three, g: Ground) {
  return procedural(
    THREE,
    `lawn-${g.lawn[0]}`,
    { uLa: col(THREE, g.lawn[0]), uLb: col(THREE, g.lawn[1]) },
    'uniform vec3 uLa, uLb;',
    `vec2 p = vPdW.xz;
     float st = smoothstep(0.42, 0.58, abs(fract(vPdUv.y * 0.5) - 0.5) * 2.0);
     vec3 lc = mix(uLa, uLb, st);
     float far = smoothstep(25.0, 160.0, length(vPdW - cameraPosition));
     lc *= 0.84 + 0.3 * mix(pdNoise(p * 3.1) * 0.6 + pdNoise(p * 9.0) * 0.4, 0.5, far);
     lc *= 0.92 + 0.16 * pdFbm(p * 0.08);
     diffuseColor.rgb = lc;`,
  );
}

/**
 * The asphalt (or the Quad's paving, or the barn's dirt): its texture across the road (u) and along it (v), laid over
 * with variation from where it is so its repeats never line up, the lines worn dark by tires, and patches.
 */
export function roadMaterial(THREE: Three, look: Look, g: Ground | undefined, map: T.Texture) {
  const dirt = look.road === '#8f6f4d';
  return procedural(
    THREE,
    `road-${look.road}-${look.joints ?? ''}`,
    { uDirt: { value: dirt ? 1 : 0 } },
    'uniform float uDirt;',
    `vec2 p = vPdW.xz;
     float big = pdFbm(p * 0.02);
     float patchy = smoothstep(0.62, 0.66, pdFbm(p * 0.07 + 3.0));
     // (the racing lines worn dark, a car's track each side; out at the barn, ruts)
     float u = vPdUv.x;
     float wear = exp(-pow((u - 0.3) * 9.0, 2.0)) + exp(-pow((u - 0.7) * 9.0, 2.0));
     vec3 rc = diffuseColor.rgb;
     rc *= 0.9 + 0.2 * big;
     rc = mix(rc, rc * mix(0.78, 0.86, uDirt), wear * (0.35 + 0.3 * pdNoise(p * 0.5)));
     rc = mix(rc, rc * 0.82, patchy * (1.0 - uDirt) * 0.8);
     rc *= 0.94 + 0.12 * pdNoise(p * 0.6);
     diffuseColor.rgb = rc;`,
    { map },
  );
}

/** The asphalt's texture: aggregate, tar-sealed cracks, and its paint (edge lines, a dashed center line), worn. */
export function asphaltTexture(THREE: Three, look: Look, g: Ground | undefined) {
  const W = 512;
  const H = 512;
  const r = scatter(31);
  const dirt = look.road === '#8f6f4d';
  return texture(
    THREE,
    canvas(W, H, (c) => {
      c.fillStyle = look.road;
      c.fillRect(0, 0, W, H);
      if (look.joints) {
        // the Quad's paving: sandstone setts in courses across the road, each a little different, worn at the edges
        const rows = 16;
        for (let row = 0; row < rows; row++) {
          const y = (row * H) / rows;
          const off = (row % 2) * 24;
          for (let x = -48 + off; x < W; x += 48) {
            const v = r();
            c.fillStyle = `rgba(${v < 0.5 ? '255,245,225' : '60,40,20'},${0.04 + r() * 0.1})`;
            c.fillRect(x + 1.5, y + 1.5, 45, H / rows - 3);
            c.fillStyle = 'rgba(255,250,235,0.1)';
            c.fillRect(x + 2, y + 2, 43, 2);
            c.fillStyle = 'rgba(0,0,0,0.12)';
            c.fillRect(x + 2, y + H / rows - 5, 43, 2);
          }
          c.fillStyle = look.joints;
          for (let x = -48 + off; x < W; x += 48) c.fillRect(x, y, 3, H / rows);
          c.fillRect(0, y, W, 3);
        }
      } else if (dirt) {
        // packed dirt: stones, ruts and tire marks along it, dry grass straggling in at the edges
        for (let i = 0; i < 2600; i++) {
          const a = r();
          c.fillStyle = a < 0.5 ? `rgba(60,40,22,${0.1 + r() * 0.25})` : `rgba(230,205,160,${0.1 + r() * 0.3})`;
          const s = 1 + r() * 3;
          c.fillRect(r() * W, r() * H, s, s * (0.6 + r()));
        }
        for (const u of [0.3, 0.7]) {
          const grad = c.createLinearGradient(W * (u - 0.08), 0, W * (u + 0.08), 0);
          grad.addColorStop(0, 'rgba(50,32,18,0)');
          grad.addColorStop(0.5, 'rgba(50,32,18,0.28)');
          grad.addColorStop(1, 'rgba(50,32,18,0)');
          c.fillStyle = grad;
          c.fillRect(W * (u - 0.08), 0, W * 0.16, H);
        }
        for (let i = 0; i < 260; i++) {
          const side = r() < 0.5 ? r() * 0.08 : 1 - r() * 0.08;
          c.strokeStyle = `rgba(${150 + r() * 60},${140 + r() * 40},${60 + r() * 30},0.7)`;
          c.lineWidth = 1;
          const x = side * W;
          const y = r() * H;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 8);
          c.stroke();
        }
      } else {
        // the aggregate: light and dark stones in the tar, and fine grain
        for (let i = 0; i < 16000; i++) {
          const a = r();
          c.fillStyle = a < 0.45 ? `rgba(15,15,18,${0.18 + r() * 0.3})` : a < 0.9 ? `rgba(200,198,190,${0.06 + r() * 0.16})` : `rgba(150,120,90,${0.1 + r() * 0.2})`;
          const s = 0.8 + r() * 1.8;
          c.fillRect(r() * W, r() * H, s, s);
        }
        // tar-sealed cracks: shiny black squiggles, mostly along the road
        c.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          let x = r() * W;
          let y = r() * H;
          c.strokeStyle = `rgba(14,14,16,${0.22 + r() * 0.18})`;
          c.lineWidth = 1.2 + r() * 1.3;
          c.beginPath();
          c.moveTo(x, y);
          const across = r() < 0.3;
          for (let k = 0; k < 12; k++) {
            x += across ? 10 + r() * 8 : (r() - 0.5) * 14;
            y += across ? (r() - 0.5) * 10 : 10 + r() * 10;
            c.lineTo(x, y);
          }
          c.stroke();
        }
        // a few patches, darker and smoother
        for (let i = 0; i < 2; i++) {
          c.fillStyle = 'rgba(20,20,24,0.18)';
          const w = 60 + r() * 90;
          const h = 50 + r() * 120;
          c.fillRect(r() * (W - w), r() * (H - h), w, h);
        }
        // oil drips down the middle of a lane
        for (let i = 0; i < 40; i++) {
          c.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
          c.beginPath();
          c.ellipse(W * (r() < 0.5 ? 0.3 : 0.7) + (r() - 0.5) * 30, r() * H, 3 + r() * 9, 6 + r() * 16, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      // the paint: worn, the asphalt's grain showing through it
      const paint = (x: number, y: number, w: number, h: number, color: string) => {
        c.fillStyle = color;
        c.globalAlpha = 0.85;
        c.fillRect(x, y, w, h);
        c.globalAlpha = 1;
        for (let i = 0; i < (w * h) / 6; i++) {
          c.fillStyle = `rgba(40,40,44,${0.2 + r() * 0.5})`;
          c.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 1 + r() * 2);
        }
      };
      if (g?.edges && !look.joints && !dirt) {
        paint(10, 0, 7, H, g.edges);
        paint(W - 17, 0, 7, H, g.edges);
      }
      if (g?.center && !look.joints && !dirt) {
        // (a dash 3 m long every 12 m; or a double line)
        if (g.center === '#f2c230' || g.center === '#e8c040') {
          paint(W / 2 - 7, 0, 4, H, g.center);
          paint(W / 2 + 3, 0, 4, H, g.center);
        } else paint(W / 2 - 4, H * 0.1, 8, H * 0.28, g.center);
      }
      // dust along the edges of the road
      for (const [x0, x1] of [[0, 0.08], [1, 0.92]]) {
        const grad = c.createLinearGradient(W * x0, 0, W * x1, 0);
        grad.addColorStop(0, dirt ? 'rgba(170,150,100,0.35)' : 'rgba(150,135,110,0.3)');
        grad.addColorStop(1, 'rgba(150,135,110,0)');
        c.fillStyle = grad;
        c.fillRect(Math.min(W * x0, W * x1), 0, W * 0.08, H);
      }
    }),
  );
}

/** The curbs: red (or the course's color) and white blocks, a rounded top lit and its outer face in shadow, scuffed. */
export function curbTexture(THREE: Three, look: Look) {
  const r = scatter(5);
  return texture(
    THREE,
    canvas(32, 128, (g) => {
      g.fillStyle = look.curb[0];
      g.fillRect(0, 0, 32, 128);
      g.fillStyle = look.curb[1];
      g.fillRect(0, 0, 32, 64);
      // (its rounded profile across: dark at the road's lip, bright on the crown, in shade on the far side)
      const grad = g.createLinearGradient(0, 0, 32, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0.35)');
      grad.addColorStop(0.15, 'rgba(0,0,0,0)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 128);
      // the joints between blocks, and tire scuffs
      g.fillStyle = 'rgba(0,0,0,0.4)';
      for (const y of [0, 32, 64, 96]) g.fillRect(0, y, 32, 1.5);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(20,20,22,${0.08 + r() * 0.18})`;
        g.fillRect(r() * 14, r() * 128, 2 + r() * 10, 1 + r() * 3);
      }
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`;
        g.fillRect(r() * 32, r() * 128, 1.5, 1.5);
      }
    }),
  );
}

/** The walls: dressed sandstone in courses with a cardinal (or the course's) band, weathered and a little grimy low down. */
export function wallTexture(THREE: Three, look: Look) {
  const r = scatter(9);
  return texture(
    THREE,
    canvas(256, 128, (g) => {
      g.fillStyle = look.wall;
      g.fillRect(0, 0, 256, 128);
      const rows = [[32, 52], [52, 80], [80, 106], [106, 128]];
      rows.forEach(([y0, y1], i) => {
        const off = i % 2 ? 0 : 32;
        for (let x = -64 + off; x < 256; x += 64) {
          const v = r();
          g.fillStyle = `rgba(${v < 0.5 ? '255,248,230' : '90,60,30'},${0.05 + r() * 0.12})`;
          g.fillRect(x + 1, y0 + 1, 62, y1 - y0 - 2);
          // (its face dressed: a lighter top edge, a shadow under)
          g.fillStyle = 'rgba(255,250,235,0.12)';
          g.fillRect(x + 1, y0 + 1, 62, 2);
          g.fillStyle = 'rgba(60,40,20,0.15)';
          g.fillRect(x + 1, y1 - 3, 62, 2);
          for (let k = 0; k < 30; k++) {
            g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '70,50,30'},${r() * 0.1})`;
            g.fillRect(x + r() * 62, y0 + r() * (y1 - y0), 1.5, 1.5);
          }
        }
        g.fillStyle = 'rgba(110,85,55,0.5)';
        g.fillRect(0, y0, 256, 1.5);
        for (let x = -64 + off; x < 256; x += 64) g.fillRect(x, y0, 1.5, y1 - y0);
      });
      // the band along the top, with its drip line of shadow
      g.fillStyle = look.band;
      g.fillRect(0, 0, 256, 30);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, 0, 256, 4);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 30, 256, 3);
      // (grime splashed up from the road along its foot)
      const grad = g.createLinearGradient(0, 96, 0, 128);
      grad.addColorStop(0, 'rgba(60,50,40,0)');
      grad.addColorStop(1, 'rgba(60,50,40,0.35)');
      g.fillStyle = grad;
      g.fillRect(0, 96, 256, 32);
    }),
  );
}

/**
 * Grass along the verges and out across the ground: clumps of blades, dark at the foot and paler at the tips, swaying
 * in the breeze, a few wildflowers among them. In patches, so each is culled when it is off screen or far off.
 */
export function grassTufts(THREE: Three, scene: T.Scene, t: Track, g: Ground, dummy: T.Object3D, clear: (x: number, z: number, margin: number) => boolean, quality: Quality, lawnToo: boolean) {
  const rnd = scatter(23);
  const clump = (blades: number, hgt: number, spread: number, flower: [number, number, number] | null) => {
    const pos: number[] = [];
    const colr: number[] = [];
    for (let i = 0; i < blades; i++) {
      const a = rnd() * Math.PI * 2;
      const lean = 0.1 + rnd() * spread;
      const h = hgt * (0.55 + rnd() * 0.45);
      const w = 0.02 + rnd() * 0.025;
      const ox = Math.cos(a) * 0.12 * rnd();
      const oz = Math.sin(a) * 0.12 * rnd();
      const tx = ox + Math.cos(a) * lean * h;
      const tz = oz + Math.sin(a) * lean * h;
      const px = -Math.sin(a) * w;
      const pz = Math.cos(a) * w;
      pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
      const k = 0.85 + rnd() * 0.3;
      colr.push(...g.tuftBase, ...g.tuftBase, ...g.tuftTip.map((c) => c * k));
    }
    if (flower) {
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2;
        const x = Math.cos(a) * 0.12;
        const z = Math.sin(a) * 0.12;
        const h = hgt * (0.8 + rnd() * 0.3);
        pos.push(x - 0.012, 0, z, x + 0.012, 0, z, x, h, z);
        colr.push(...g.tuftBase, ...g.tuftBase, ...g.tuftBase);
        const s = 0.07;
        for (const q of [0, Math.PI / 2]) {
          const dx = Math.cos(q) * s;
          const dz = Math.sin(q) * s;
          pos.push(x - dx, h - s, z - dz, x + dx, h - s, z + dz, x, h + s, z, x - dx, h + s * 0.2, z - dz, x + dx, h + s * 0.2, z + dz, x, h - s * 0.8, z);
          for (let v = 0; v < 6; v++) colr.push(...flower);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.computeVertexNormals();
    // (lit as if each blade faced up a little, so a clump is not black on its shady side)
    const nrm = geo.getAttribute('normal');
    for (let k = 0; k < nrm.count; k++) {
      const ny = Math.abs(nrm.getY(k)) + 0.9;
      const l = Math.hypot(nrm.getX(k), ny, nrm.getZ(k));
      nrm.setXYZ(k, nrm.getX(k) / l, ny / l, nrm.getZ(k) / l);
    }
    return geo;
  };
  // (two clumps of grass, and one of wildflowers in the course's first color)
  const kinds = [clump(14, 0.38, 0.45, null), clump(12, 0.7, 0.32, null), ...(g.flowers ?? []).slice(0, 1).map((f) => clump(8, 0.5, 0.3, f))];
  const sway = { value: 0 };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = sway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 ip = instanceMatrix[3].xyz;
       float ph = ip.x * 0.21 + ip.z * 0.17;
       float hh = position.y * position.y;
       transformed.x += (sin(uSway * 1.7 + ph) * 0.12 + sin(uSway * 3.3 + ph * 2.3) * 0.04) * hh;
       transformed.z += cos(uSway * 1.3 + ph) * 0.06 * hh;`,
    );
  };
  mat.customProgramCacheKey = () => 'pd-grass-tufts';
  const density = g.tufts * (quality === 'high' ? 1 : 0.4);
  const PATCH = 80;
  const patches = new Map<string, { k: number; x: number; z: number; s: number; ry: number }[]>();
  const inside = (x: number, z: number) => {
    let r = false;
    for (let i = 0, j = t.n - 1; i < t.n; j = i++) {
      if (t.z[i] > z !== t.z[j] > z && x < ((t.x[j] - t.x[i]) * (z - t.z[i])) / (t.z[j] - t.z[i]) + t.x[i]) r = !r;
    }
    return r;
  };
  const put = (k: number, x: number, z: number, s: number) => {
    if (g.wet && inside(x, z)) return;
    const key = `${Math.floor(x / PATCH)},${Math.floor(z / PATCH)}`;
    let list = patches.get(key);
    if (!list) patches.set(key, (list = []));
    list.push({ k, x, z, s, ry: rnd() * Math.PI * 2 });
  };
  const pick = () => {
    const q = rnd();
    if (g.flowers?.length && q < 0.06) return 2;
    return q < 0.6 ? 0 : 1;
  };
  for (let s = 0; s < t.length; s += 1 / density) {
    for (const side of [-1, 1]) {
      const e = edgeAt(t, s, side);
      if (e.past !== 'wall') continue;
      // (along the foot of the wall on the verge, and thick just outside it, thinning out across the ground)
      if (lawnToo && rnd() < 0.5) {
        const p = pointAt(t, s + (rnd() - 0.5), side * (t.edge - 0.15 - rnd() * 0.5));
        put(rnd() < 0.8 ? 0 : 1, p.x, p.z, 0.6 + rnd() * 0.4);
      }
      for (let row = 0; row < (g.paved ? 1 : 3); row++) {
        const out = t.edge + 0.6 + row * 1.5 + rnd() * 2 + (row === 2 ? rnd() * 12 : 0);
        const p = pointAt(t, s + (rnd() - 0.5) * 1.2, side * out);
        if (rnd() < 0.25 || !clear(p.x, p.z, 0.4)) continue;
        put(pick(), p.x, p.z, 0.8 + rnd() * 0.7);
      }
    }
  }
  // (and out across the ground near the road, in drifts)
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) {
    minX = Math.min(minX, t.x[i]);
    maxX = Math.max(maxX, t.x[i]);
    minZ = Math.min(minZ, t.z[i]);
    maxZ = Math.max(maxZ, t.z[i]);
  }
  const scatterN = g.paved ? 0 : Math.round(2500 * density);
  for (let n = 0; n < scatterN; n++) {
    const x = minX - 60 + rnd() * (maxX - minX + 120);
    const z = minZ - 60 + rnd() * (maxZ - minZ + 120);
    if (Math.sin(x * 0.06 + Math.sin(z * 0.04) * 2) + Math.sin(z * 0.05 + x * 0.013) < 0.2 + rnd()) continue;
    const at = locate(t, x, z);
    if (Math.abs(at.d) > t.edge + 18 || !clear(x, z, 0.6)) continue;
    put(pick(), x, z, 0.8 + rnd() * 0.8);
  }
  const tint = new THREE.Color();
  const groups: { m: T.InstancedMesh; x: number; z: number }[] = [];
  for (const [, list] of patches) {
    for (let k = 0; k < kinds.length; k++) {
      const items = list.filter((it) => it.k === k);
      if (!items.length) continue;
      const m = new THREE.InstancedMesh(kinds[k], mat, items.length);
      let cx = 0;
      let cz = 0;
      items.forEach((it, i) => {
        dummy.position.set(it.x, 0, it.z);
        dummy.rotation.set(0, it.ry, 0);
        dummy.scale.set(it.s, it.s * (0.8 + rnd() * 0.4), it.s);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, tint.setRGB(0.85 + rnd() * 0.3, 0.85 + rnd() * 0.25, 0.8 + rnd() * 0.2));
        cx += it.x / items.length;
        cz += it.z / items.length;
      });
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      m.computeBoundingSphere();
      m.userData.noCast = true;
      scene.add(m);
      groups.push({ m, x: cx, z: cz });
    }
  }
  const reach = quality === 'high' ? 170 : 110;
  return {
    tick(clock: number, camera: T.Camera) {
      sway.value = clock;
      const p = camera.position;
      for (const q of groups) q.m.visible = Math.abs(q.x - p.x) < reach && Math.abs(q.z - p.z) < reach;
    },
  };
}
