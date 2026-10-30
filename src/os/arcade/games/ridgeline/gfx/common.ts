// Shared pieces of the renderer: three.js constants the shared chunk leaves out, color helpers, the uniforms every
// world material reads (sun, sky, fog, terrain data, baked light), the GLSL they share, and the patch that teaches a
// stock MeshStandardMaterial about height fog and baked terrain shadows.
import type * as T from 'three';
import type { MapDef } from '../maps.ts';

export type * as T from 'three';
export type Three = typeof import('three');

export const HALF_FLOAT = 1016 as T.TextureDataType;
export const UNSIGNED_BYTE = 1009 as T.TextureDataType;
export const RGBA = 1023 as T.PixelFormat;
export const CLAMP = 1001 as T.Wrapping;
export const NEAREST = 1003 as T.MagnificationTextureFilter;
export const NO_TONE = 0 as T.ToneMapping;
export const FRONT = 0 as T.Side;
export const BACK = 1 as T.Side;
export const DOUBLE = 2 as T.Side;
export const NORMAL_BLEND = 1 as T.Blending;
export const ADDITIVE = 2 as T.Blending;
export const LINEAR_SPACE = 'srgb-linear' as T.ColorSpace;
export const NO_SPACE = '' as T.ColorSpace;

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** sRGB hex to linear [r, g, b]. */
export function lin(hex: number, k = 1): [number, number, number] {
  return [s2l(((hex >> 16) & 255) / 255) * k, s2l(((hex >> 8) & 255) / 255) * k, s2l((hex & 255) / 255) * k];
}

/** float to IEEE half bits. */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
export function toHalf(v: number) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >> 16) & 0x8000;
  let e = ((x >> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  m = m + 0x1000;
  if (m & 0x800000) {
    m = 0;
    e++;
    if (e >= 31) return sign | 0x7c00;
  }
  return sign | (e << 10) | (m >> 13);
}

export type U = { value: unknown };
export type Shared = Record<string, U>;

/** Sun light intensity per unit of the map's sun strength (three's lights divide diffuse by pi). */
export const SUN_K = 4;
/** Sky light strength (the environment map and the custom shaders' ambient term). */
export const AMBIENT_K = 0.5;

/** Uniforms shared by reference across every world material, so one write per frame updates all of them. */
export function makeShared(THREE: Three, def: MapDef, sun: [number, number, number]): Shared {
  const c = (hex: number, k = 1) => new THREE.Color(...lin(hex, k));
  const g = def.ground;
  const skyK = 1.55;
  const zen = lin(def.sky.zenith, skyK);
  const hor = lin(def.sky.horizon, skyK);
  const amb = new THREE.Color((zen[0] + hor[0] * 2) / 3, (zen[1] + hor[1] * 2) / 3, (zen[2] + hor[2] * 2) / 3).multiplyScalar(def.ambient * AMBIENT_K);
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(...sun) },
    uSunColor: { value: c(def.sun.color, def.sun.intensity * SUN_K) },
    uAmbient: { value: amb },
    uZenith: { value: new THREE.Color(...zen) },
    uHorizon: { value: new THREE.Color(...hor) },
    uGround: { value: c(def.sky.ground, 0.9) },
    uGlow: { value: def.sky.glow },
    uClouds: { value: def.sky.clouds },
    uCloudColor: { value: c(def.sky.cloudColor, 1.9) },
    uCloudShade: { value: c(def.sky.cloudShade, 1.1) },
    uDisc: { value: 1 },
    uFogColor: { value: c(def.fog.color, 1.25) },
    uFogSun: { value: c(def.fog.sun, 1.6) },
    uFogDensity: { value: def.fog.density },
    uFogFalloff: { value: def.fog.falloff },
    uTerrainData: { value: null },
    uLight: { value: null },
    uWater: { value: def.water ?? -1000 },
    uShadowRange: { value: 0 },
    uGrassA: { value: c(g.grassA) },
    uGrassB: { value: c(g.grassB) },
    uDirt: { value: c(g.dirt) },
    uRock: { value: c(g.rock) },
    uSand: { value: c(g.sand) },
    uSnow: { value: c(g.snow) },
    uSnowLine: { value: g.snowLine },
    uSnowCover: { value: g.snowCover },
    uSandLine: { value: g.sandLine },
    uStrata: { value: g.strata },
    uRockSlope: { value: g.rockSlope },
    uDirtAmt: { value: g.dirtAmt },
    uSandAmt: { value: g.sandAmt },
    uWind: { value: new THREE.Vector2(0.8, 0.6) },
  };
}

/** Declarations of the shared uniforms plus noise, terrain lookups, fog and the sky. */
export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec3 uFogSun;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform sampler2D uTerrainData;
uniform sampler2D uLight;
uniform float uWater;
uniform float uShadowRange;
uniform vec2 uWind;

vec2 dzUV(vec2 xz) { return ((xz + 512.0) * 0.5 + 0.5) / 513.0; }
float dzHeight(vec2 xz) { return texture2D(uTerrainData, dzUV(xz)).r; }
vec3 dzNormal(vec2 xz) {
  vec2 n = texture2D(uTerrainData, dzUV(xz)).gb;
  return vec3(n.x, sqrt(max(0.0, 1.0 - dot(n, n))), n.y);
}
vec4 dzBaked(vec2 xz) { return texture2D(uLight, dzUV(xz)); }

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
float dzFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += dzNoise(p) * a;
    p = p * 2.03 + vec2(17.1, -9.3);
    a *= 0.5;
  }
  return s / 0.9375;
}

vec3 dzFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 0.001);
  float a = uFogDensity * exp(-uFogFalloff * max(cameraPosition.y - uWater, -20.0));
  float b = uFogFalloff * dir.y * dist;
  float amount = abs(b) > 0.0001 ? a * dist * (1.0 - exp(-b)) / b : a * dist;
  float f = 1.0 - exp(-max(amount, 0.0));
  float s = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  return mix(col, mix(uFogColor, uFogSun, s * 0.75), clamp(f, 0.0, 1.0));
}
`;

/** The sky as a function of direction (needs COMMON). Shared by the dome, the water's reflection and the env map. */
export const SKY = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uGlow;
uniform float uClouds;
uniform vec3 uCloudColor;
uniform vec3 uCloudShade;
uniform float uDisc;

vec3 dzSkyBase(vec3 dir) {
  float y = dir.y;
  vec3 c = mix(uZenith, uHorizon, pow(1.0 - clamp(y, 0.0, 1.0), 3.5));
  c = mix(c, uGround, smoothstep(0.0, -0.2, y));
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uFogSun * (pow(sd, 5.0) * 0.3 + pow(sd, 42.0) * 0.55) * uGlow;
  return c;
}

vec3 dzSky(vec3 dir, vec3 from, int octaves) {
  vec3 c = dzSkyBase(dir);
  float sd = max(dot(dir, uSunDir), 0.0);
  if (dir.y > 0.005 && uClouds > 0.0) {
    float t = (1100.0 - from.y) / dir.y;
    vec2 p = (from.xz + dir.xz * t) * 0.0009 + uWind * uTime * 0.0035;
    float d = 0.0;
    float a = 0.5;
    vec2 q = p;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      d += dzNoise(q) * a;
      q = q * 2.07 + vec2(3.1, 7.7);
      a *= 0.5;
    }
    d /= 0.97;
    float cover = smoothstep(1.0 - uClouds - 0.08, 1.0 - uClouds + 0.32, d);
    vec2 ps = p + uSunDir.xz * 0.06;
    float d2 = dzNoise(ps) * 0.5 + dzNoise(ps * 2.07 + vec2(3.1, 7.7)) * 0.25;
    float lit = clamp(0.55 + (d * 0.75 - d2) * 2.2, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudColor, lit);
    cc += uFogSun * pow(sd, 10.0) * (1.0 - cover) * 2.5 * uGlow;
    float fade = smoothstep(0.01, 0.16, dir.y);
    c = mix(c, cc, cover * fade * 0.95);
  }
  c += uSunColor * smoothstep(0.99955, 0.9998, sd) * 3.0 * uDisc * smoothstep(-0.02, 0.02, dir.y);
  return c;
}
`;

const PATCH_VERT_DECL = /* glsl */ `
varying vec3 vDzWp;
`;
const PATCH_VERT = /* glsl */ `
#include <project_vertex>
{
  vec4 dzw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  dzw = instanceMatrix * dzw;
  #endif
  vDzWp = (modelMatrix * dzw).xyz;
}
`;

export type PatchOpts = {
  /** Extra uniforms for this material (its own, not shared). */
  uniforms?: Shared;
  /** GLSL added at the top of the vertex shader. */
  vertDecl?: string;
  /** GLSL run after begin_vertex (can change `transformed`). */
  vertBody?: string;
  /** GLSL added at the top of the fragment shader (after COMMON). */
  fragDecl?: string;
  /** Replaces map_fragment: may set diffuseColor. */
  albedo?: string;
  /** Runs after normal_fragment_maps: may set `normal` (view space). */
  normal?: string;
  /** Replaces roughnessmap_fragment: must declare float roughnessFactor. */
  rough?: string;
  /** Runs after the lights: may scale reflectedLight. */
  light?: string;
  /** Leaves out the baked terrain shadow (things above the ground, like the viewmodel). */
  noBaked?: boolean;
  /** Other replacements in the fragment shader, [find, replace]. */
  replace?: [string, string][];
  /** A key for the program cache when the patch differs between materials of one type. */
  key: string;
};

/**
 * Patches a stock material: world position, height fog with sun glow instead of three's fog, and the terrain's baked
 * sun visibility on the direct light. Hooks let a material swap its albedo, normal, roughness and lighting.
 */
export function patch(mat: T.Material, shared: Shared, o: PatchOpts) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, o.uniforms ?? {});
    sh.vertexShader = `${PATCH_VERT_DECL}${o.vertDecl ?? ''}\n${sh.vertexShader.replace('#include <project_vertex>', PATCH_VERT)}`;
    if (o.vertBody) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.vertBody}`);
    let f = sh.fragmentShader;
    f = f.replace('#include <common>', `#include <common>\nvarying vec3 vDzWp;\n${COMMON}\n${o.fragDecl ?? ''}`);
    if (o.albedo) f = f.replace('#include <map_fragment>', o.albedo);
    if (o.normal) f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.normal}`);
    if (o.rough) f = f.replace('#include <roughnessmap_fragment>', o.rough);
    const baked = o.noBaked
      ? ''
      : `{ float dzSunVis = dzBaked(vDzWp.xz).r; reflectedLight.directDiffuse *= dzSunVis; reflectedLight.directSpecular *= dzSunVis; }`;
    f = f.replace('#include <aomap_fragment>', `${baked}\n${o.light ?? ''}\n#include <aomap_fragment>`);
    f = f.replace('#include <fog_fragment>', 'gl_FragColor.rgb = dzFog(gl_FragColor.rgb, vDzWp);');
    for (const [a, b] of o.replace ?? []) f = f.replace(a, b);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => o.key;
}

/** A box w x h x d with its edges rounded over a share of its smallest side, so light rolls off them softly. */
export function roundBox(THREE: Three, w: number, h: number, d: number, share = 0.28) {
  const r = Math.min(w, h, d) * share;
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const p = g.attributes.position as T.BufferAttribute;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const cx = Math.max(-hx, Math.min(hx, x));
    const cy = Math.max(-hy, Math.min(hy, y));
    const cz = Math.max(-hz, Math.min(hz, z));
    const l = Math.hypot(x - cx, y - cy, z - cz) || 1;
    p.setXYZ(i, cx + ((x - cx) / l) * r, cy + ((y - cy) / l) * r, cz + ((z - cz) / l) * r);
  }
  g.computeVertexNormals();
  return g;
}

/** A canvas (or an offscreen stand-in for it) to paint procedural textures on. */
export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Disposes every geometry, material and texture under an object. */
export function disposeTree(root: T.Object3D) {
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const m = o as T.Mesh;
    if (m.geometry && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as T.Texture).isTexture && !seen.has(v)) {
        seen.add(v);
        (v as T.Texture).dispose();
      }
      const u = (mat as T.ShaderMaterial).uniforms;
      if (u) for (const k of Object.keys(u)) {
        const v = u[k]?.value as T.Texture | undefined;
        if (v && typeof v === 'object' && v.isTexture && !seen.has(v)) {
          seen.add(v);
          v.dispose();
        }
      }
      mat.dispose();
    }
  });
}
