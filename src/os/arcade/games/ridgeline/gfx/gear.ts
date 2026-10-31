// Materials for soldiers, their kit and their guns. Uniforms carry painted camouflage (MultiCam-style, woodland,
// urban) laid on with triplanar mapping in the body's own space, so the pattern sits still on the cloth; carriers and
// pouches get webbing rows and a woven grain; hard kit (helmets, boots, knee pads, mags) a fine stipple; guns
// anodized aluminum, polymer, steel, glass. All painted at load.
import { mulberry32 } from '../noise.ts';
import { RGBA, UNSIGNED_BYTE, canvas, lin, patch, type Shared, type T, type Three } from './common.ts';

export type Pattern = 'multicam' | 'black' | 'ranger' | 'coyote' | 'woodland' | 'urban';

export type Outfit = {
  /** The uniform's pattern. */
  uniform: Pattern;
  /** Plate carrier, pouches, belt (cordura). */
  gear: number;
  /** Helmet shell (painted) when it has no cover. */
  helmet: number;
  /** Helmet wears a fabric cover in the uniform pattern. */
  cover: boolean;
  boots: number;
  gloves: number;
  knuckles: number;
  balaclava: number;
  pads: number;
};

export const OUTFITS: Record<string, Outfit> = {
  // your side: MultiCam uniform, ranger green kit, tan helmet cover
  multicam: { uniform: 'multicam', gear: 0x535842, helmet: 0x8a7a5c, cover: true, boots: 0x6e5c46, gloves: 0x3c3a33, knuckles: 0x2a2a27, balaclava: 0x4c4a3e, pads: 0x4a4c3c },
  // the other side: black tactical
  black: { uniform: 'black', gear: 0x34363a, helmet: 0x2e3033, cover: false, boots: 0x242528, gloves: 0x26272a, knuckles: 0x161719, balaclava: 0x222326, pads: 0x2c2e31 },
  ranger: { uniform: 'ranger', gear: 0x8a7558, helmet: 0x4a4f3c, cover: false, boots: 0x7a654b, gloves: 0x6a5a45, knuckles: 0x3a3428, balaclava: 0x3e4234, pads: 0x8a7558 },
  coyote: { uniform: 'coyote', gear: 0x4e5340, helmet: 0x9a8566, cover: false, boots: 0x7a654b, gloves: 0x7a6a52, knuckles: 0x403628, balaclava: 0x6e604a, pads: 0x4e5340 },
  woodland: { uniform: 'woodland', gear: 0x3f4632, helmet: 0x4a5038, cover: true, boots: 0x2a2620, gloves: 0x2e2c26, knuckles: 0x1c1b18, balaclava: 0x34382a, pads: 0x3f4632 },
  urban: { uniform: 'urban', gear: 0x2e3135, helmet: 0x3a3d42, cover: false, boots: 0x1e1f22, gloves: 0x26282b, knuckles: 0x141517, balaclava: 0x2a2c30, pads: 0x2e3135 },
};

const PALETTES: Record<Pattern, { base: number; blobs: number[]; twigs?: number }> = {
  multicam: { base: 0xa89b7a, blobs: [0x7f7356, 0x6a6a46, 0x8c7656, 0xc4baa0, 0x4e4a36], twigs: 0x4f3f2c },
  black: { base: 0x3c3e43, blobs: [0x35373b, 0x44464b] },
  ranger: { base: 0x4c5141, blobs: [0x484d3d, 0x52574a] },
  coyote: { base: 0x86725a, blobs: [0x7e6b54, 0x8e7a60] },
  woodland: { base: 0x6c6a48, blobs: [0x3f4a2e, 0x5c4a34, 0x22231c, 0x787456] },
  urban: { base: 0x6b6e72, blobs: [0x4a4d52, 0x8e9196, 0x2f3135, 0x5c5f63] },
};

/** A seamless camouflage tile: irregular blobs (drawn wrapped at the edges) and, for MultiCam, thin twig strokes. */
function camoTexture(THREE: Three, pattern: Pattern, seed: number) {
  const S = 256;
  const cv = canvas(S, S);
  const g = cv.getContext('2d')!;
  const pal = PALETTES[pattern];
  const r = mulberry32(seed);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(pal.base);
  g.fillRect(0, 0, S, S);
  const plain = pattern === 'black' || pattern === 'ranger' || pattern === 'coyote';
  const count = plain ? 90 : 46;
  for (let i = 0; i < count; i++) {
    const col = pal.blobs[i % pal.blobs.length];
    const cx = r() * S;
    const cy = r() * S;
    const size = plain ? 6 + r() * 14 : pattern === 'multicam' ? 14 + r() * 26 : 18 + r() * 34;
    const stretch = pattern === 'multicam' ? 1.4 + r() * 0.8 : 0.7 + r() * 0.8;
    const pts: [number, number][] = [];
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = size * (0.55 + r() * 0.6);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * stretch]);
    }
    g.fillStyle = hex(col);
    g.globalAlpha = plain ? 0.35 : 0.92;
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        pts.forEach(([x, y], k) => {
          const nx = pts[(k + 1) % n];
          const mx = cx + ox + (x + nx[0]) / 2;
          const my = cy + oy + (y + nx[1]) / 2;
          if (k === 0) g.moveTo(cx + ox + x, cy + oy + y);
          g.quadraticCurveTo(cx + ox + x, cy + oy + y, mx, my);
        });
        g.closePath();
        g.fill();
      }
  }
  g.globalAlpha = 1;
  if (pal.twigs) {
    g.strokeStyle = hex(pal.twigs);
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = r() * S;
      let y = r() * S;
      g.lineWidth = 1 + r() * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 16;
        y += 6 + r() * 12;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const img = g.getImageData(0, 0, S, S);
  const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer.slice(0)), S, S, RGBA, UNSIGNED_BYTE);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Kinds of surface on a soldier, stored per vertex (aKind): 0 uniform cloth in the pattern, 1 cordura with MOLLE
 * webbing rows, 2 plain knit (balaclava, cuffs), 3 helmet cover in the pattern.
 */
export const KIND = { uniform: 0, webbing: 1, knit: 2, cover: 3 } as const;

const FABRIC_DECL = /* glsl */ `
uniform sampler2D tCamo;
uniform float uCamoScale;
varying float vKind;
varying vec3 vOP;
varying vec3 vON;
`;

const FABRIC_ALBEDO = /* glsl */ `
{
  vec3 an = abs(normalize(vON));
  an = pow(an, vec3(3.0));
  an /= an.x + an.y + an.z + 1e-4;
  vec2 pa = vOP.zy * uCamoScale;
  vec2 pb = vOP.xz * uCamoScale;
  vec2 pc = vOP.xy * uCamoScale;
  vec3 camo = texture2D(tCamo, pa).rgb * an.x + texture2D(tCamo, pb).rgb * an.y + texture2D(tCamo, pc).rgb * an.z;
  bool patterned = vKind < 0.5 || vKind > 2.5;
  diffuseColor.rgb = patterned ? camo : vec3(1.0);
  // creases and the weave
  float crease = dzNoise(vOP.xy * 19.0 + vOP.zz * 11.0) * 0.6 + dzNoise(vOP.zy * 31.0) * 0.4;
  diffuseColor.rgb *= 0.8 + 0.32 * crease;
  diffuseColor.rgb *= 0.93 + 0.1 * dzNoise(vec2(vOP.x + vOP.z, vOP.y) * 420.0);
  // MOLLE: rows of 1 inch webbing with dark gaps and bar tacks
  if (vKind > 0.5 && vKind < 1.5) {
    float row = fract(vOP.y / 0.0381);
    float gap = smoothstep(0.0, 0.06, row) * (1.0 - smoothstep(0.62, 0.7, row));
    float tack = step(0.9, fract((vOP.x + vOP.z) / 0.0381 + 0.5));
    diffuseColor.rgb *= mix(0.62, 1.04, gap) * (1.0 - tack * gap * 0.12);
  }
}
`;

/** Materials for one outfit: the cloth (pattern by vertex kind) and the hard kit. */
export function outfitMaterials(THREE: Three, shared: Shared | null, pattern: Pattern, seed: number) {
  const camo = camoTexture(THREE, pattern, seed);
  const fabric = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const opts = {
    key: 'dz-fabric',
    uniforms: { tCamo: { value: camo }, uCamoScale: { value: pattern === 'multicam' ? 2.6 : 2.1 } },
    vertDecl: 'attribute float aKind;\nvarying float vKind;\nvarying vec3 vOP;\nvarying vec3 vON;',
    vertBody: 'vKind = aKind;\nvOP = position;\nvON = normal;',
    fragDecl: FABRIC_DECL,
    albedo: FABRIC_ALBEDO,
  };
  if (shared) patch(fabric, shared, opts);
  else patchLocal(fabric, opts);
  const hard = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
  const hardOpts = {
    key: 'dz-hard',
    vertDecl: 'varying vec3 vOP;',
    vertBody: 'vOP = position;',
    fragDecl: 'varying vec3 vOP;',
    albedo: 'diffuseColor.rgb *= 0.9 + 0.14 * dzNoise(vec2(vOP.x + vOP.z * 0.7, vOP.y) * 260.0);',
  };
  if (shared) patch(hard, shared, hardOpts);
  else patchLocal(hard, hardOpts);
  const lens = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(0x0b0d10)), roughness: 0.06, metalness: 0.95 });
  if (shared) patch(lens, shared, { key: 'dz-lens' });
  return { fabric, hard, lens, camo };
}

export type GunMat = 'anodized' | 'polymer' | 'fde' | 'od' | 'steel' | 'rubber' | 'glass' | 'lens' | 'dot' | 'wood';
export const GUN_MATS: GunMat[] = ['anodized', 'polymer', 'fde', 'od', 'steel', 'rubber', 'glass', 'lens', 'dot', 'wood'];

export const GUN_LOOK: Record<GunMat, { color: number; rough: number; metal: number; grain: number; emissive?: number }> = {
  anodized: { color: 0x1d1e21, rough: 0.42, metal: 0.62, grain: 0.06 },
  polymer: { color: 0x18191b, rough: 0.66, metal: 0.02, grain: 0.14 },
  fde: { color: 0x8a7558, rough: 0.68, metal: 0.02, grain: 0.12 },
  od: { color: 0x4a4f39, rough: 0.68, metal: 0.02, grain: 0.12 },
  steel: { color: 0x2a2b2e, rough: 0.3, metal: 0.92, grain: 0.04 },
  rubber: { color: 0x121214, rough: 0.92, metal: 0, grain: 0.2 },
  glass: { color: 0x0a1018, rough: 0.04, metal: 0.95, grain: 0 },
  lens: { color: 0x7fa0b8, rough: 0.05, metal: 0.6, grain: 0 },
  dot: { color: 0x000000, rough: 1, metal: 0, grain: 0, emissive: 0xff2418 },
  wood: { color: 0x5e3f26, rough: 0.55, metal: 0, grain: 0.3 },
};

/** Gun materials: with `shared` they live in the world (fog, baked light); without, in the first person pass. */
export function gunMaterials(THREE: Three, shared: Shared | null): Record<GunMat, T.MeshStandardMaterial> {
  const out = {} as Record<GunMat, T.MeshStandardMaterial>;
  for (const k of GUN_MATS) {
    const d = GUN_LOOK[k];
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(d.color)), roughness: d.rough, metalness: d.metal });
    if (d.emissive) m.emissive.setRGB(...lin(d.emissive, 8));
    if (k === 'lens') {
      // the holographic window: a faint tinted pane you can see through
      m.transparent = true;
      m.opacity = 0.16;
      m.depthWrite = false;
    }
    if (d.grain > 0) {
      const opts = {
        key: `dz-gun-${k}`,
        vertDecl: 'varying vec3 vOP;',
        vertBody: 'vOP = position;',
        fragDecl: 'varying vec3 vOP;',
        albedo: `diffuseColor.rgb *= ${(1 - d.grain).toFixed(3)} + ${(d.grain * 2).toFixed(3)} * dzNoise(vec2(vOP.x * 0.7 + vOP.z, vOP.y + vOP.x) * 900.0);`,
        rough: `float roughnessFactor = roughness * (0.88 + 0.24 * dzNoise(vec2(vOP.z, vOP.y) * 140.0));`,
      };
      if (shared) patch(m, shared, opts);
      else patchLocal(m, opts);
    } else if (shared) patch(m, shared, { key: `dz-gun-${k}` });
    out[k] = m;
  }
  return out;
}

const LOCAL_NOISE = /* glsl */ `
float dzHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float dzNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dzHash(i), dzHash(i + vec2(1.0, 0.0)), u.x), mix(dzHash(i + vec2(0.0, 1.0)), dzHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** The same hooks as patch(), for the first person pass: no fog, no baked terrain light, just the surface. */
function patchLocal(mat: T.Material, o: { key: string; uniforms?: Record<string, T.IUniform>; vertDecl?: string; vertBody?: string; fragDecl?: string; albedo?: string; rough?: string }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, o.uniforms ?? {});
    sh.vertexShader = `${o.vertDecl ?? ''}\n${sh.vertexShader}`;
    if (o.vertBody) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.vertBody}`);
    let f = sh.fragmentShader.replace('#include <common>', `#include <common>\n${LOCAL_NOISE}\n${o.fragDecl ?? ''}`);
    if (o.albedo) f = f.replace('#include <map_fragment>', o.albedo);
    if (o.rough) f = f.replace('#include <roughnessmap_fragment>', o.rough);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `${o.key}-local`;
}
