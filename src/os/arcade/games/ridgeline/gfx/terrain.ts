// The ground and the water. The ground is one grid cut into chunks (so the camera skips what it cannot see), shaded by
// a stock PBR material taught to paint itself: grass, dirt, layered rock, beach sand and snow chosen per pixel from
// height, slope and noise, with per pixel normals from the height data and the baked light on top. No image files.
import { CELL, T_HALF, T_RES } from '../terrain.ts';
import { ARENA, type World } from '../world.ts';
import { CLAMP, COMMON, HALF_FLOAT, NO_SPACE, NORMAL_BLEND, RGBA, SKY, UNSIGNED_BYTE, lin, patch, toHalf, type Shared, type T, type Three } from './common.ts';

/** Height and normal (x, z) per vertex as half floats, and the baked light as bytes. */
export function terrainTextures(THREE: Three, w: World) {
  const t = w.terrain;
  const n = T_RES;
  const data = new Uint16Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const hl = t.h[j * n + Math.max(0, i - 1)];
      const hr = t.h[j * n + Math.min(n - 1, i + 1)];
      const hd = t.h[Math.max(0, j - 1) * n + i];
      const hu = t.h[Math.min(n - 1, j + 1) * n + i];
      const nx = hl - hr;
      const nz = hd - hu;
      const ny = 4 * CELL * 0.5;
      const l = Math.hypot(nx, ny, nz);
      data[k * 4] = toHalf(t.h[k]);
      data[k * 4 + 1] = toHalf(nx / l);
      data[k * 4 + 2] = toHalf(nz / l);
      data[k * 4 + 3] = toHalf(1);
    }
  const tex = new THREE.DataTexture(data, n, n, RGBA, HALF_FLOAT);
  tex.colorSpace = NO_SPACE;
  tex.wrapS = tex.wrapT = CLAMP;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const light = new THREE.DataTexture(w.light, n, n, RGBA, UNSIGNED_BYTE);
  light.colorSpace = NO_SPACE;
  light.wrapS = light.wrapT = CLAMP;
  light.magFilter = THREE.LinearFilter;
  light.minFilter = THREE.LinearFilter;
  light.generateMipmaps = false;
  light.needsUpdate = true;
  return { data: tex, light };
}

const GROUND_DECL = /* glsl */ `
uniform vec3 uGrassA;
uniform vec3 uGrassB;
uniform vec3 uDirt;
uniform vec3 uRock;
uniform vec3 uSand;
uniform vec3 uSnow;
uniform float uSnowLine;
uniform float uSnowCover;
uniform float uSandLine;
uniform float uStrata;
uniform float uRockSlope;
uniform float uDirtAmt;
uniform float uSandAmt;

/** Layer weights (rock, sand, dirt, snow) and grass tone at a point: the grass shader uses the same rules. */
vec4 dzLayers(vec3 wp, vec3 n, float bare, out float grassMix) {
  vec2 p = wp.xz;
  float macro = dzNoise(p * 0.0045) * 0.65 + dzNoise(p * 0.013) * 0.35;
  float mid = dzNoise(p * 0.06);
  grassMix = smoothstep(0.3, 0.75, macro + (mid - 0.5) * 0.35);
  float slope = 1.0 - n.y;
  float rock = smoothstep(uRockSlope - 0.07, uRockSlope + 0.07, slope + (mid - 0.5) * 0.12);
  float up = wp.y - uWater;
  float sand = (1.0 - smoothstep(uSandLine - 0.6, uSandLine + 0.9, up + (mid - 0.5) * 0.9)) * step(-500.0, uWater);
  sand = max(sand, uSandAmt * smoothstep(0.5, 0.75, macro * 0.9 + mid * 0.3) * (1.0 - smoothstep(0.05, 0.2, slope)));
  float dirt = max(bare, uDirtAmt * smoothstep(0.62, 0.8, mid * 0.55 + macro * 0.6));
  float snow = smoothstep(uSnowLine - 5.0, uSnowLine + 5.0, wp.y + (mid - 0.5) * 14.0);
  snow = max(snow, uSnowCover * smoothstep(0.26, 0.12, slope + (mid - 0.5) * 0.08));
  snow *= 1.0 - rock * 0.75;
  return vec4(rock, sand, dirt * (1.0 - snow * 0.6), snow);
}

vec3 dzGrassColor(vec3 wp, float grassMix, float fine) {
  return mix(uGrassA, uGrassB, grassMix) * (0.82 + 0.3 * fine);
}
`;

const TERRAIN_FRAG_DECL = /* glsl */ `
${GROUND_DECL}
vec3 dzN;
float dzRoughV;
float dzAO;
float dzObjShadow;
`;

const TERRAIN_ALBEDO = /* glsl */ `
{
  vec2 p = vDzWp.xz;
  vec4 baked = dzBaked(p);
  dzAO = baked.g;
  dzObjShadow = baked.b;
  vec3 n0 = dzNormal(p);
  float camD = length(vDzWp - cameraPosition);
  float near = 1.0 - smoothstep(30.0, 140.0, camD);
  float fine = dzNoise(p * 1.7) * 0.55 + dzNoise(p * 6.3) * 0.45 * near + 0.225 * (1.0 - near);
  float gm;
  vec4 L = dzLayers(vDzWp, n0, baked.a, gm);
  vec3 grass = dzGrassColor(vDzWp, gm, fine);
  float strata = sin(vDzWp.y * 1.9 + dzNoise(p * 0.05) * 7.0) * 0.5 + 0.5;
  vec3 rock = uRock * (0.72 + 0.34 * dzNoise(p * 0.35 + vDzWp.y * 0.21) + uStrata * (strata - 0.5) * 0.55) * (0.9 + 0.2 * fine);
  vec3 sand = uSand * (0.9 + 0.16 * fine);
  vec3 dirt = uDirt * (0.78 + 0.4 * fine);
  vec3 snow = uSnow * (0.93 + 0.07 * fine);
  vec3 col = grass;
  col = mix(col, dirt, L.z);
  col = mix(col, sand, L.y);
  col = mix(col, rock, L.x);
  col = mix(col, snow, L.w);
  // wet ground at the water's edge
  float wet = (1.0 - smoothstep(0.0, 0.7, vDzWp.y - uWater)) * step(-500.0, uWater) * (1.0 - L.w);
  col *= 1.0 - wet * 0.45;
  diffuseColor.rgb = col;
  dzRoughV = mix(0.93, 0.78, L.x) - wet * 0.55 - L.w * 0.25;
  // detail normal: noise slopes, strongest on rock and sand ripples, faded with distance
  float e = 0.35;
  float h0 = dzNoise(p * 1.3);
  float hx = dzNoise((p + vec2(e, 0.0)) * 1.3);
  float hz = dzNoise((p + vec2(0.0, e)) * 1.3);
  float amt = (0.25 + L.x * 0.9 + L.y * 0.35) * near;
  dzN = normalize(n0 + vec3(h0 - hx, 0.0, h0 - hz) * amt * 2.2);
}
`;

const TERRAIN_LIGHT = /* glsl */ `
{
  float camD = length(vDzWp - cameraPosition);
  float far = uShadowRange > 0.0 ? smoothstep(uShadowRange * 0.7, uShadowRange, camD) : 1.0;
  float obj = mix(1.0, dzObjShadow, far);
  reflectedLight.directDiffuse *= obj;
  reflectedLight.directSpecular *= obj;
  reflectedLight.indirectDiffuse *= dzAO * mix(1.0, 0.85 + 0.15 * dzObjShadow, 1.0);
  reflectedLight.indirectSpecular *= dzAO;
}
`;

export function terrainMesh(THREE: Three, w: World, shared: Shared, step: number) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  patch(mat, shared, {
    key: 'dz-terrain',
    fragDecl: TERRAIN_FRAG_DECL,
    albedo: TERRAIN_ALBEDO,
    rough: 'float roughnessFactor = clamp(dzRoughV, 0.08, 1.0);',
    normal: 'normal = normalize((viewMatrix * vec4(dzN, 0.0)).xyz);',
    light: TERRAIN_LIGHT,
  });
  const t = w.terrain;
  const chunks = 8;
  const per = (T_RES - 1) / chunks;
  // Chunks the arena overlaps (and their neighbors) keep the tier's detail; the rest, only ever seen from far off,
  // use half as many vertices per side, with a skirt hanging down their edges so no crack shows where they meet.
  const ARENA_CHUNK = (ci: number) => {
    const x0 = -T_HALF + ci * per * CELL;
    return x0 < ARENA + per * CELL && x0 + per * CELL > -ARENA - per * CELL;
  };
  const indexFor = new Map<number, T.BufferAttribute>();
  for (let cj = 0; cj < chunks; cj++)
    for (let ci = 0; ci < chunks; ci++) {
      const st = ARENA_CHUNK(ci) && ARENA_CHUNK(cj) ? step : step * 2;
      const verts = per / st + 1;
      const skirt = st > step;
      const n = verts * verts + (skirt ? 4 * verts : 0);
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      for (let j = 0; j < verts; j++)
        for (let i = 0; i < verts; i++) {
          const gi = ci * per + i * st;
          const gj = cj * per + j * st;
          const k = (j * verts + i) * 3;
          pos[k] = -T_HALF + gi * CELL;
          pos[k + 1] = t.h[gj * T_RES + gi];
          pos[k + 2] = -T_HALF + gj * CELL;
          nor[k + 1] = 1;
        }
      let index = indexFor.get(st);
      if (!index) {
        const idx: number[] = [];
        for (let j = 0; j < verts - 1; j++)
          for (let i = 0; i < verts - 1; i++) {
            const a = j * verts + i;
            const b = a + 1;
            const c = a + verts;
            const d = c + 1;
            idx.push(a, c, b, b, c, d);
          }
        if (skirt) {
          // four edges: each edge vertex gets a twin 3 m lower; quads join them (double sided by winding both ways)
          const edges = [
            Array.from({ length: verts }, (_, i) => i),
            Array.from({ length: verts }, (_, i) => (verts - 1) * verts + i),
            Array.from({ length: verts }, (_, j) => j * verts),
            Array.from({ length: verts }, (_, j) => j * verts + verts - 1),
          ];
          edges.forEach((edge, e) => {
            const base = verts * verts + e * verts;
            for (let k = 0; k < verts - 1; k++) {
              const a = edge[k];
              const b = edge[k + 1];
              const c = base + k;
              const d = base + k + 1;
              idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
            }
          });
        }
        index = new THREE.BufferAttribute(n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
        indexFor.set(st, index);
      }
      if (skirt) {
        const edgeVerts = [
          (k: number) => k,
          (k: number) => (verts - 1) * verts + k,
          (k: number) => k * verts,
          (k: number) => k * verts + verts - 1,
        ];
        edgeVerts.forEach((fn, e) => {
          for (let k = 0; k < verts; k++) {
            const src = fn(k) * 3;
            const dst = (verts * verts + e * verts + k) * 3;
            pos[dst] = pos[src];
            pos[dst + 1] = pos[src + 1] - 3;
            pos[dst + 2] = pos[src + 2];
            nor[dst + 1] = 1;
          }
        });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setIndex(index);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
  return group;
}

const WATER_VERT = /* glsl */ `
varying vec3 vWp;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
${COMMON}
${SKY}
uniform vec3 uShallow;
uniform vec3 uDeep;
varying vec3 vWp;

vec2 dzWave(vec2 p, float t) {
  // sum of a few drifting noise slopes
  vec2 g = vec2(0.0);
  float e = 0.08;
  vec2 q1 = p * 0.22 + vec2(t * 0.05, t * 0.03);
  vec2 q2 = p * 0.61 + vec2(-t * 0.07, t * 0.09);
  vec2 q3 = p * 1.9 + vec2(t * 0.16, -t * 0.12);
  float a = dzNoise(q1);
  g += vec2(dzNoise(q1 + vec2(e, 0.0)) - a, dzNoise(q1 + vec2(0.0, e)) - a) * 0.9;
  a = dzNoise(q2);
  g += vec2(dzNoise(q2 + vec2(e, 0.0)) - a, dzNoise(q2 + vec2(0.0, e)) - a) * 0.6;
  a = dzNoise(q3);
  g += vec2(dzNoise(q3 + vec2(e, 0.0)) - a, dzNoise(q3 + vec2(0.0, e)) - a) * 0.35;
  return g / e;
}

void main() {
  vec3 V = normalize(cameraPosition - vWp);
  float dist = length(cameraPosition - vWp);
  float ground = dzHeight(vWp.xz);
  float depth = max(0.0, uWater - ground);
  if (abs(vWp.x) > 511.0 || abs(vWp.z) > 511.0) depth = 30.0;
#ifdef ICE
  vec2 p = vWp.xz;
  float cr = abs(dzNoise(p * 0.35) - 0.5) + abs(dzNoise(p * 0.9 + 5.0) - 0.5) * 0.5;
  float crack = 1.0 - smoothstep(0.0, 0.035, cr);
  vec3 N = normalize(vec3((dzNoise(p * 2.0) - 0.5) * 0.08, 1.0, (dzNoise(p * 2.0 + 3.0) - 0.5) * 0.08));
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 4.0, depth)) * (0.9 + 0.15 * dzNoise(p * 0.15));
  base = mix(base, base * 0.55, crack * 0.6);
  float ndl = max(dot(N, uSunDir), 0.0);
  float sunVis = dzBaked(p).r;
  vec3 col = base * (uSunColor * ndl * sunVis / 3.14159 + uAmbient);
  vec3 R = reflect(-V, N);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col = mix(col, dzSkyBase(R), fres * 0.6);
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 220.0) * 0.2 * sunVis;
  gl_FragColor = vec4(dzFog(col, vWp), 1.0);
#else
  vec2 g = dzWave(vWp.xz, uTime) * (0.06 + 0.1 * smoothstep(1.0, 8.0, depth));
  float far = smoothstep(60.0, 400.0, dist);
  g *= 1.0 - far * 0.7;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = dzSky(R, vWp, 2);
  float sunVis = dzBaked(vWp.xz).r;
  vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.22));
  body *= uSunColor * max(uSunDir.y, 0.1) * 0.08 * sunVis + uAmbient * 0.9;
  vec3 col = mix(body, refl, fres);
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 900.0) * 2.4 * sunVis;
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.04 * sunVis;
  // foam where it laps the shore
  float foamN = dzNoise(vWp.xz * 1.6 + vec2(uTime * 0.25, 0.0)) * 0.6 + dzNoise(vWp.xz * 4.0 - uTime * 0.3) * 0.4;
  float foam = (1.0 - smoothstep(0.0, 0.55 + foamN * 0.5, depth)) * smoothstep(0.35, 0.75, foamN + 0.25 * sin(uTime * 1.5 + depth * 8.0));
  col = mix(col, (uSunColor * max(uSunDir.y, 0.2) * 0.1 + uAmbient) * 0.9, foam * 0.75);
  float alpha = mix(0.25, 0.97, 1.0 - exp(-depth * 0.9));
  alpha = max(alpha, fres);
  alpha = max(alpha, foam * 0.85);
  alpha = mix(alpha, 1.0, far);
  gl_FragColor = vec4(dzFog(col, vWp), alpha * smoothstep(0.0, 0.05, depth));
#endif
}
`;

export function waterMesh(THREE: Three, w: World, shared: Shared) {
  const def = w.def;
  const ice = w.terrain.ice;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uShallow: { value: new THREE.Color(...lin(def.waterColor.shallow)) }, uDeep: { value: new THREE.Color(...lin(def.waterColor.deep)) } },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: !ice,
    depthWrite: ice,
    defines: ice ? { ICE: '' } : {},
  });
  mat.blending = NORMAL_BLEND;
  const size = ice ? T_HALF * 2 : 6000;
  const g = new THREE.PlaneGeometry(size, size, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.y = w.terrain.water;
  m.renderOrder = ice ? 0 : 2;
  m.frustumCulled = false;
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  return m;
}

export { GROUND_DECL };
