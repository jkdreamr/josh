// three.js view of Redwood Slough's water and what is on it (scene.ts builds it for a course raced in shells): the
// channel itself, its currents running in the water, the marsh and mudflat past the brink, the lock and its gates,
// Hwy 101's piers and deck, the Caltrain swing span, the Port crane, Docktown's floats, the rocks in the rapids, the
// whirlpools, the vessels and their wakes, any buoys, the chain ferry, the swell rolling in off the Bay and the weir. It
// reads a Race every frame and never changes it.
import type { T } from './gl';
import { deltaS, edgeAt, edgeRuns, headingOf, lengthOf, locate, pointAt, roadEdge, wrapS, type Track } from './track';
import { DAWN, GLSL_NOISE, canvas, noise, scatter, texture, type Look } from './scenery';
import { boatHull, modelKit, person, type ModelKit } from './model';
import { COURSES } from './courses';
import { RAMP_H, TIDE_LAP, WAKE_LEN, WAKE_SPREAD, crestsAt, hazState, hazardV, strokeAt, windAt, type LiveHazard, type Race } from './logic';

type Three = typeof import('three');
type Geo = { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; plane: T.PlaneGeometry; cone: T.ConeGeometry };

/**
 * A strip along the track from s0 to s1 between lateral offsets a(s) and b(s), at height y (or sloping across it from
 * y[0] at a to y[1] at b). v runs a unit every vLen meters; u runs across it, from 0 at a to 1 at b when fromA, or else
 * left to right.
 */
export function band(THREE: Three, t: Track, s0: number, s1: number, a: (s: number) => number, b: (s: number) => number, y: number | [number, number], vLen: number, fromA = false) {
  const count = Math.max(1, Math.round((s1 - s0) / (t.step / 2)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const [ya, yb] = typeof y === 'number' ? [y, y] : y;
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s);
    const nx = -p.tz;
    const nz = p.tx;
    // (left to right, so it faces up whichever side of the road it is on)
    const swap = a(s) > b(s);
    const [da, db] = swap ? [b(s), a(s)] : [a(s), b(s)];
    const [y0, y1] = swap ? [yb, ya] : [ya, yb];
    pos.push(p.x + nx * da, y0, p.z + nz * da, p.x + nx * db, y1, p.z + nz * db);
    const [u0, u1] = fromA && swap ? [1, 0] : [0, 1];
    uv.push(u0, (s - s0) / vLen, u1, (s - s0) / vLen);
    if (k < count) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A vertical strip at lateral offset d(s) from s0 to s1, from height y0 to y1: a wall's face, facing back across the channel from the wall on `side`. */
function face(THREE: Three, t: Track, s0: number, s1: number, d: (s: number) => number, y0: number, y1: number, uLen: number, side: number) {
  const count = Math.max(1, Math.round((s1 - s0) / (t.step / 2)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s, d(s));
    pos.push(p.x, y0, p.z, p.x, y1, p.z);
    uv.push(s / uLen, 0, s / uLen, 1);
    // (wound so it faces the channel: toward the right from the left-hand wall, and the other way from the right-hand one)
    if (k < count) idx.push(...(side < 0 ? [2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3] : [2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The channel's surface for the water shader: a strip from bank to bank (u across from 0 to 1, v the distance along the
 * track in meters), how wide it is at each sample, and the lap the water turns choppy there (0: never).
 */
function waterStrip(THREE: Three, t: Track, s0: number, s1: number, a: (s: number) => number, b: (s: number) => number, y: number, chopAt: (s: number) => number) {
  const g = band(THREE, t, s0, s1, a, b, y, 1);
  const n = g.getAttribute('position').count / 2;
  const wid: number[] = [];
  const chop: number[] = [];
  const uv = g.getAttribute('uv');
  for (let k = 0; k < n; k++) {
    const s = s0 + ((s1 - s0) * k) / Math.max(1, n - 1);
    const w = Math.abs(b(s) - a(s));
    wid.push(w, w);
    chop.push(chopAt(s), chopAt(s));
    uv.setY(2 * k, s);
    uv.setY(2 * k + 1, s);
  }
  g.setAttribute('wid', new THREE.Float32BufferAttribute(wid, 1));
  g.setAttribute('chop', new THREE.Float32BufferAttribute(chop, 1));
  return g;
}

/**
 * A tiling normal map of small wind ripples over a longer swell, made once: the height field is a few octaves of
 * wrapping value noise and some wave trains that tile, and the normals come from its slopes.
 */
function rippleNormals(THREE: Three) {
  const N = 256;
  const h = new Float32Array(N * N);
  const rnd = scatter(41);
  const octave = (cells: number, amp: number) => {
    const lat = Array.from({ length: cells * cells }, () => rnd());
    const at = (i: number, j: number) => lat[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const fy = (y / N) * cells;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        const u = fx - i;
        const v = fy - j;
        const su = u * u * (3 - 2 * u);
        const sv = v * v * (3 - 2 * v);
        const top = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
        const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
        h[y * N + x] += amp * (top + (bot - top) * sv);
      }
    }
  };
  octave(4, 1);
  octave(8, 0.55);
  octave(16, 0.3);
  octave(32, 0.16);
  // (wave trains on whole-number wave vectors, so they tile, sharpened into crests)
  for (const [kx, ky, amp] of [[3, 5, 0.35], [-4, 6, 0.28], [7, -2, 0.18], [9, 11, 0.1], [-13, 5, 0.08]]) {
    const ph = rnd() * Math.PI * 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] += amp * (1 - Math.abs(Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + ph)));
  }
  const c = canvas(N, N, (g) => {
    const img = g.createImageData(N, N);
    const H = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2;
        const dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
        const l = Math.hypot(dx, dy, 1);
        const o = (y * N + x) * 4;
        img.data[o] = Math.round((-dx / l) * 127.5 + 127.5);
        img.data[o + 1] = Math.round((-dy / l) * 127.5 + 127.5);
        img.data[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** How many whirlpools the water shader draws. */
const WHIRLS = 8;

const WATER_VERT = /* glsl */ `
  attribute float wid;
  attribute float chop;
  varying vec3 vW;
  varying vec2 vUv;
  varying float vWid;
  varying float vChop;
  #include <fog_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vUv = uv;
    vWid = wid;
    vChop = chop;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime, uFlow, uStreak, uLap, uReflOn;
  uniform vec3 uDeep, uShallow, uFoam, uSun, uSunCol, uSkyLow, uSkyHigh, uHorizon;
  uniform sampler2D tNormal, tRefl;
  uniform mat4 uReflM;
  uniform vec3 uWhirlA[${WHIRLS}];
  uniform vec3 uWhirlB[${WHIRLS}];
  uniform vec3 uWhirlC[${WHIRLS}];
  varying vec3 vW;
  varying vec2 vUv;
  varying float vWid;
  varying float vChop;
  #include <fog_pars_fragment>
  ${GLSL_NOISE}
  vec2 rip(vec2 p) { return texture2D(tNormal, p).xy * 2.0 - 1.0; }
  void main() {
    float across = vUv.x * vWid;
    float edge = min(vUv.x, 1.0 - vUv.x) * vWid;
    float along = vUv.y - uFlow;
    vec3 toCam = cameraPosition - vW;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    float rough = (vChop > 0.5 && uLap >= vChop - 0.01) ? 1.0 : 0.0;
    // ripples: two layers drifting over the slough in the breeze, and one carried down the channel by the current
    vec2 p = vW.xz;
    vec2 n = rip(p * 0.045 + uTime * vec2(0.011, 0.007)) * 0.55
           + rip(p * 0.13 - uTime * vec2(0.012, -0.019)) * 0.4
           + rip(vec2(across * 0.07, along * 0.035)) * 0.45;
    n += rip(p * 0.31 + uTime * vec2(0.03, 0.021)) * (0.25 + 0.5 * rough);
    float calm = mix(1.0, 0.3, smoothstep(25.0, 220.0, dist));
    // whirlpools: the surface tilted down toward each eye and twisted with its spin, its arms of foam, its dark middle
    float wDark = 0.0;
    float wFoam = 0.0;
    float wEye = 0.0;
    for (int i = 0; i < ${WHIRLS}; i++) {
      vec3 A = uWhirlA[i];
      if (A.z <= 0.0) continue;
      vec2 d = vW.xz - A.xy;
      float dl = length(d);
      float r = dl / A.z;
      if (r >= 1.0) continue;
      vec3 B = uWhirlB[i];
      vec3 C = uWhirlC[i];
      float k = B.x;
      float on = max(k, C.y * 0.8);
      vec2 dir = d / max(dl, 1e-3);
      vec2 tang = vec2(-dir.y, dir.x) * B.z;
      float slope = k * 1.8 * pow(1.0 - r, 1.4) * smoothstep(0.0, 0.25, r);
      n += (-dir + tang * 0.8) * slope / max(calm, 0.3);
      float ph = atan(d.y, d.x) + B.y;
      float arms = sin(4.0 * ph + B.z * 6.5 * log(max(r, 0.04)));
      float streak = texture2D(tNormal, vec2(ph * 0.3, r * 0.8)).x;
      float armFoam = smoothstep(0.25, 0.95, arms * (0.75 + 0.5 * streak)) * smoothstep(0.08, 0.3, r) * (1.0 - smoothstep(0.62, 1.0, r));
      wFoam = max(wFoam, armFoam * on * (0.45 + 0.55 * k));
      wFoam = max(wFoam, (1.0 - smoothstep(0.0, 0.07, abs(r - 0.84 + 0.04 * sin(ph * 3.0)))) * 0.45 * on);
      wDark = max(wDark, k * (1.0 - smoothstep(0.05, 0.8, r)));
      if (C.x > 0.0) {
        wEye = max(wEye, 1.0 - smoothstep(C.x * 0.75, C.x * 1.1, dl));
        wFoam = max(wFoam, (1.0 - smoothstep(0.0, 0.35, abs(dl - C.x * 1.25))) * 0.9 * k);
      }
    }
    float str = (0.2 + 0.18 * rough) * calm;
    vec3 N = normalize(vec3(n.x * str, 1.0, n.y * str));
    float ndv = max(dot(N, V), 0.0);
    float fres = clamp(0.03 + 0.97 * pow(1.0 - ndv, 5.0), 0.0, 1.0);
    vec3 R = reflect(-V, N);
    // what it mirrors: the scene above it (a reflection pass), or else the sky
    float hy = max(R.y, 0.0);
    vec3 sky = mix(uHorizon, uSkyLow, smoothstep(0.0, 0.2, hy));
    sky = mix(sky, uSkyHigh, smoothstep(0.15, 0.7, hy));
    vec3 refl = sky;
    if (uReflOn > 0.5) {
      vec4 rp = uReflM * vec4(vW, 1.0);
      vec2 ruv = rp.xy / rp.w + N.xz * (0.045 + 0.03 * rough) * calm;
      refl = texture2D(tRefl, clamp(ruv, 0.001, 0.999)).rgb;
    }
    // the water itself: dark and deep mid-channel, greener and lighter over the shallows by the banks
    vec3 body = mix(uShallow, uDeep, smoothstep(0.2, 5.0, edge));
    body *= 0.75 + 0.25 * smoothstep(-0.3, 0.6, N.x * uSun.x + N.z * uSun.z + 0.2);
    vec3 c = mix(body, refl * mix(vec3(1.0), uDeep * 2.2 + 0.45, 0.25), fres * 0.9);
    // the current: faint streaks of foam and slick running with it
    float st = texture2D(tNormal, vec2(across * 0.05, along * 0.004)).x * texture2D(tNormal, vec2(across * 0.021 + 0.3, along * 0.0023)).y;
    c += vec3(0.85, 0.88, 0.9) * smoothstep(0.32, 0.5, st) * 0.06 * uStreak * calm;
    // shimmer over the shallows, where the light plays on the bottom
    vec2 q = rip(p * 0.21 + uTime * vec2(0.05, 0.03)) + rip(p * 0.17 - uTime * vec2(0.04, -0.035));
    float caustic = pow(max(0.0, 1.0 - abs(q.x + q.y) * 1.6), 6.0);
    c += uSunCol * caustic * 0.12 * (1.0 - smoothstep(0.0, 3.0, edge)) * calm;
    // the sun on the water: a glitter path toward it, and a broad warm sheen
    float sd = max(dot(R, uSun), 0.0);
    vec3 Ns = normalize(vec3(n.x * str * 2.2, 1.0, n.y * str * 2.2));
    float glint = pow(max(dot(reflect(-V, Ns), uSun), 0.0), 900.0);
    c += uSunCol * (pow(sd, 60.0) * 0.55 + glint * 9.0 * (0.4 + 0.6 * calm));
    // foam where the water laps the bank, and a second line a little way out, coming and going
    float lap = pdNoise(vec2(along * 0.35, uTime * 0.6)) * 0.35 + pdNoise(vec2(along * 1.7, uTime * 1.3)) * 0.2;
    float foam = 1.0 - smoothstep(0.04, 0.4, edge - lap * 0.7);
    float ring = (1.0 - smoothstep(0.0, 0.12, abs(edge - 0.8 - 0.3 * sin(uTime * 1.3 + along * 0.4)))) * pdNoise(vec2(along * 2.0, uTime));
    foam = max(foam, ring * 0.35);
    // and flecks of white on the chop
    float fleck = texture2D(tNormal, p * 0.21 + uTime * vec2(0.05, 0.02)).x * texture2D(tNormal, p * 0.33 - uTime * vec2(0.03, 0.06)).y;
    foam = max(foam, rough * smoothstep(0.42, 0.62, fleck) * 0.75 * calm);
    c = mix(c, uFoam, clamp(foam, 0.0, 1.0) * 0.9);
    c = mix(c, c * 0.3 + uDeep * 0.15, wDark * 0.85);
    c = mix(c, uFoam * 0.92, clamp(wFoam, 0.0, 1.0) * 0.85);
    c = mix(c, vec3(0.004, 0.015, 0.02), wEye);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** The marsh's colors at a point of the world (in meters), in linear light: GLSL for the ground and the banks. */
const GLSL_MARSH = /* glsl */ `
  vec3 marshAt(vec2 p) {
    float m = pdFbm(p * 0.009);
    float d = pdFbm(p * 0.06 + 7.0);
    float f = pdNoise(p * 1.1) * 0.55 + pdNoise(p * 3.3) * 0.45;
    // cordgrass, olive going gold; pickleweed, red going green; bare mudflat; and pale salt pans
    vec3 grass = mix(vec3(0.36, 0.39, 0.17), vec3(0.6, 0.53, 0.27), smoothstep(0.3, 0.75, d));
    vec3 pickle = mix(vec3(0.5, 0.21, 0.16), vec3(0.42, 0.44, 0.19), smoothstep(0.35, 0.7, d));
    vec3 c = mix(grass, pickle, smoothstep(0.47, 0.58, m + (d - 0.5) * 0.2));
    c = mix(c, vec3(0.4, 0.33, 0.25), smoothstep(0.6, 0.66, m) * 0.85);
    c = mix(c, vec3(0.7, 0.64, 0.55), smoothstep(0.68, 0.72, m) * 0.6);
    // tufts and shadows in it
    c *= 0.72 + 0.5 * f;
    // the tidal creeks winding through it, the sky in them
    float k = abs(pdFbm(p * 0.016 + 3.0) - 0.5);
    float creek = 1.0 - smoothstep(0.006, 0.016, k);
    float edge = (1.0 - smoothstep(0.016, 0.026, k)) - creek;
    c = mix(c, vec3(0.3, 0.24, 0.18), edge * 0.8);
    c = mix(c, vec3(0.78, 0.66, 0.7), creek);
    return pow(c, vec3(2.2));
  }`;

/**
 * Lambert lit, its color worked out from where it is: the marsh (the ground all round), a bank (wet mud at the water's
 * edge drying up into the marsh; u across from the water), or a quay behind a bulkhead (gravel and weeds).
 */
export function marshMaterial(THREE: Three, kind: 'ground' | 'bank' | 'quay') {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPdW;\nvarying vec2 vPdUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPdW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPdUv = uv;');
    const color =
      kind === 'ground'
        ? 'diffuseColor.rgb = marshAt(vPdW.xz);'
        : kind === 'quay'
          ? `float n = pdNoise(vPdW.xz * 1.7) * 0.6 + pdNoise(vPdW.xz * 6.0) * 0.4;
             vec3 q = mix(vec3(0.52, 0.48, 0.42), vec3(0.62, 0.58, 0.5), n);
             q = mix(q, vec3(0.38, 0.4, 0.2), smoothstep(0.62, 0.8, pdFbm(vPdW.xz * 0.25)));
             diffuseColor.rgb = pow(q, vec3(2.2));`
          : `float n = pdNoise(vPdW.xz * 1.3) * 0.6 + pdNoise(vPdW.xz * 5.0) * 0.4;
             float u = vPdUv.x + (n - 0.5) * 0.25;
             vec3 b = mix(vec3(0.2, 0.17, 0.14), vec3(0.47, 0.4, 0.31), smoothstep(0.02, 0.45, u));
             b = mix(b, vec3(0.28, 0.23, 0.15), (1.0 - smoothstep(0.0, 0.05, abs(u - 0.42))) * 0.75);
             b *= 0.82 + 0.34 * n;
             diffuseColor.rgb = mix(pow(b, vec3(2.2)), marshAt(vPdW.xz), smoothstep(0.55, 0.95, u + (n - 0.5) * 0.3));
             pdWet = 1.0 - smoothstep(0.0, 0.3, u);`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPdW;\nvarying vec2 vPdUv;\n${GLSL_NOISE}\n${GLSL_MARSH}`)
      .replace('#include <map_fragment>', `float pdWet = 0.0;\n${color}`)
      // (wet mud shines with the dawn)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.32, 0.22, 0.2) * pdWet * 0.35;');
  };
  mat.customProgramCacheKey = () => `pd-marsh-${kind}`;
  return mat;
}

/** A weathered concrete bulkhead: form panels, rust weeping from the tie-rod bolts, weed and barnacles at the waterline. */
function bulkheadTexture(THREE: Three, look: Look) {
  return texture(
    THREE,
    canvas(256, 128, (g) => {
      g.fillStyle = '#b9b2a2';
      g.fillRect(0, 0, 256, 128);
      const r = scatter(77);
      // (stained and blotched)
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(${90 + r() * 60},${85 + r() * 50},${70 + r() * 40},${0.06 + r() * 0.1})`;
        g.beginPath();
        g.ellipse(r() * 256, r() * 128, 6 + r() * 26, 4 + r() * 14, 0, 0, Math.PI * 2);
        g.fill();
      }
      // the form panels' joints and the bolts with rust weeping down from them
      g.fillStyle = 'rgba(70,62,52,0.45)';
      for (let x = 0; x < 256; x += 64) g.fillRect(x, 10, 2, 118);
      g.fillRect(0, 62, 256, 1.5);
      for (let x = 32; x < 256; x += 64) {
        const grad = g.createLinearGradient(0, 40, 0, 96);
        grad.addColorStop(0, 'rgba(140,70,30,0.55)');
        grad.addColorStop(1, 'rgba(140,70,30,0)');
        g.fillStyle = grad;
        g.fillRect(x - 2, 40, 4 + r() * 3, 56);
        g.fillStyle = '#4a3a30';
        g.beginPath();
        g.arc(x, 40, 3, 0, Math.PI * 2);
        g.fill();
      }
      // the coping's painted lip
      g.fillStyle = look.band;
      g.fillRect(0, 0, 256, 7);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 7, 256, 3);
      // the tide line: dark weed below it, a crust of white barnacles along it
      const tide = g.createLinearGradient(0, 88, 0, 128);
      tide.addColorStop(0, 'rgba(60,70,40,0)');
      tide.addColorStop(0.25, 'rgba(48,62,36,0.85)');
      tide.addColorStop(1, 'rgba(24,34,26,1)');
      g.fillStyle = tide;
      g.fillRect(0, 88, 256, 40);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(236,232,220,${0.4 + r() * 0.5})`;
        g.fillRect(r() * 256, 96 + r() * 10, 1 + r() * 2, 1 + r() * 2);
      }
      noise(g, 256, 128, 900, 0.08, false);
    }),
  );
}

/**
 * The marsh's plants along the banks and out across it: clumps of cordgrass and reeds and tall cattails, swaying in the
 * breeze (harder when the Bay wind gusts), in patches so each can be culled when it is off screen. Kept off the water:
 * nothing stands within a few meters of any stretch of the channel.
 */
function marshPlants(THREE: Three, scene: T.Scene, t: Track, dummy: T.Object3D, lim: (side: number) => (s: number) => number) {
  const rnd = scatter(19);
  // a clump: blades fanning out from its foot, dark at the base and pale gold at the tips (single triangles, leaning)
  const clump = (blades: number, hgt: number, spread: number, heads: boolean) => {
    const pos: number[] = [];
    const colr: number[] = [];
    const base = [0.16, 0.2, 0.08];
    const tip = [0.78, 0.66, 0.36];
    for (let i = 0; i < blades; i++) {
      const a = rnd() * Math.PI * 2;
      const lean = 0.15 + rnd() * spread;
      const h = hgt * (0.55 + rnd() * 0.45);
      const w = 0.018 + rnd() * 0.02;
      const ox = Math.cos(a) * 0.16 * rnd();
      const oz = Math.sin(a) * 0.16 * rnd();
      const tx = ox + Math.cos(a) * lean * h;
      const tz = oz + Math.sin(a) * lean * h;
      const px = -Math.sin(a) * w;
      const pz = Math.cos(a) * w;
      pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
      const g = 0.85 + rnd() * 0.3;
      colr.push(...base, ...base, ...tip.map((c) => c * g));
    }
    if (heads) {
      // (cattails: stiff stems with a brown head near the top)
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2;
        const x = Math.cos(a) * 0.08;
        const z = Math.sin(a) * 0.08;
        const h = hgt * (1 + rnd() * 0.25);
        const w = 0.02;
        pos.push(x - w, 0, z, x + w, 0, z, x, h, z);
        colr.push(...base, ...base, 0.5, 0.48, 0.25);
        const [y0, y1, ww] = [h * 0.72, h * 0.9, 0.05];
        for (const q of [0, Math.PI / 2]) {
          const dx = Math.cos(q) * ww;
          const dz = Math.sin(q) * ww;
          pos.push(x - dx, y0, z - dz, x + dx, y0, z + dz, x + dx, y1, z + dz, x - dx, y0, z - dz, x + dx, y1, z + dz, x - dx, y1, z - dz);
          for (let v = 0; v < 6; v++) colr.push(0.28, 0.16, 0.08);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.computeVertexNormals();
    // (lit as if each blade faced up a little, so a clump is not black on its shady side)
    const nrm = g.getAttribute('normal');
    for (let k = 0; k < nrm.count; k++) {
      const ny = Math.abs(nrm.getY(k)) + 0.8;
      const l = Math.hypot(nrm.getX(k), ny, nrm.getZ(k));
      nrm.setXYZ(k, nrm.getX(k) / l, ny / l, nrm.getZ(k) / l);
    }
    return g;
  };
  const kinds = [clump(20, 0.9, 0.5, false), clump(14, 1.6, 0.28, false), clump(10, 1.9, 0.18, true)];
  const sway = { value: 0 };
  const gust = { value: 0 };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = sway;
    sh.uniforms.uGust = gust;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway;\nuniform float uGust;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 ip = instanceMatrix[3].xyz;
       float ph = ip.x * 0.21 + ip.z * 0.17;
       float hh = position.y * position.y;
       float wave = sin(uSway * 1.6 + ph) * 0.09 + sin(uSway * 3.1 + ph * 2.3) * 0.035;
       transformed.x += (wave + uGust * (0.25 + 0.08 * sin(uSway * 9.0 + ph))) * hh;
       transformed.z += cos(uSway * 1.2 + ph) * 0.05 * hh;`,
    );
  };
  mat.customProgramCacheKey = () => 'pd-marsh-plants';
  // where they grow: thick along the banks of the marsh, then scattered out across it
  const away = (x: number, z: number, margin: number) => {
    const at = locate(t, x, z);
    const side = at.d >= 0 ? 1 : -1;
    return Math.abs(at.d) > Math.abs(lim(side)(at.s)) + margin;
  };
  const PATCH = 160;
  const patches = new Map<string, { k: number; x: number; z: number; s: number; ry: number }[]>();
  // (those out in the marsh are not drawn again in the water's reflection: only the banks' are close enough to show)
  const put = (k: number, x: number, z: number, s: number, out = false) => {
    const key = `${Math.floor(x / PATCH)},${Math.floor(z / PATCH)},${out}`;
    let list = patches.get(key);
    if (!list) patches.set(key, (list = []));
    list.push({ k, x, z, s, ry: rnd() * Math.PI * 2 });
  };
  for (const [side, s0, s1, past] of edgeRuns(t)) {
    if (past !== 'marsh') continue;
    for (let s = s0; s < s1; s += 0.9) {
      const rows = 3 + Math.floor(rnd() * 3);
      for (let row = 0; row < rows; row++) {
        const out = 2.6 + row * 1.6 + rnd() * 2.4 + (row > 2 ? rnd() * 10 : 0);
        const p = pointAt(t, s + (rnd() - 0.5) * 0.8, side * (Math.abs(edgeAt(t, s, side).lim) + out));
        if (rnd() < 0.18 || !away(p.x, p.z, 2.4)) continue;
        const k = rnd() < 0.55 ? 0 : rnd() < 0.7 ? 1 : 2;
        put(k, p.x, p.z, 0.8 + rnd() * 0.6);
      }
    }
  }
  // (and out in the marsh, in drifts)
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
  for (let n = 0; n < 9000; n++) {
    const x = minX - 120 + rnd() * (maxX - minX + 240);
    const z = minZ - 120 + rnd() * (maxZ - minZ + 240);
    // (in drifts: thick here, bare there)
    if (Math.sin(x * 0.05 + Math.sin(z * 0.03) * 2) + Math.sin(z * 0.045 + x * 0.01) < 0.4 + rnd()) continue;
    if (!away(x, z, 5)) continue;
    put(rnd() < 0.7 ? 0 : 1, x, z, 0.7 + rnd() * 0.7, true);
  }
  const tint = new THREE.Color();
  for (const [key, list] of patches) {
    for (let k = 0; k < kinds.length; k++) {
      const items = list.filter((it) => it.k === k);
      if (!items.length) continue;
      const m = new THREE.InstancedMesh(kinds[k], mat, items.length);
      items.forEach((it, i) => {
        dummy.position.set(it.x, 0.02, it.z);
        dummy.rotation.set(0, it.ry, 0);
        dummy.scale.set(it.s, it.s * (0.85 + rnd() * 0.3), it.s);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, tint.setRGB(0.85 + rnd() * 0.3, 0.85 + rnd() * 0.25, 0.8 + rnd() * 0.2));
      });
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      m.computeBoundingSphere();
      if (key.endsWith('true')) m.layers.set(1);
      scene.add(m);
    }
  }
  return {
    tick(clock: number, wind: number) {
      sway.value = clock;
      gust.value = wind;
    },
  };
}

/** The coach's launch: a white aluminum hull with a cardinal band, the console and windscreen, the outboard, the coach. */
function launchModel(mk: ModelKit, len: number, r: number) {
  const L = len * 0.86;
  mk.geo(boatHull(mk.THREE, L, r * 2, 0.75, false), 0xdfe3e8);
  // (the floor inside, the gunwale's cardinal band and rubbing strake)
  mk.box(0x8a9098, 0, 0.2, -0.2, r * 1.7, 0.04, L * 0.8);
  for (const sd of [-1, 1]) {
    mk.box(0x8c1515, sd * r * 0.98, 0.62, -0.3, 0.05, 0.16, L * 0.78);
    mk.box(0x30343a, sd * r * 1.0, 0.76, -0.3, 0.07, 0.05, L * 0.8);
  }
  // the bow deck, the console with its windscreen and wheel
  mk.box(0xeef0f2, 0, 0.74, L * 0.36, r * 1.4, 0.05, L * 0.26);
  mk.box(0xd4d8de, 0, 0.6, 0.35, 0.8, 0.8, 0.6);
  mk.box(0x2a3d4a, 0, 1.12, 0.62, 0.84, 0.36, 0.04, -0.35);
  mk.cyl(0x1b1c22, 0.15, 1.08, 0.2, 0.14, 0.03, 0.14, 1.1);
  // the outboard on the transom: cowl, leg and skeg
  mk.box(0x1b1c22, 0, 0.95, -L / 2 - 0.22, 0.42, 0.55, 0.48);
  mk.box(0xf2f2f0, 0, 1.05, -L / 2 - 0.22, 0.43, 0.06, 0.49);
  mk.box(0x2b2d33, 0, 0.3, -L / 2 - 0.3, 0.12, 0.8, 0.18);
  // the coach, standing at the console in a cardinal jacket, megaphone in hand
  person(mk, 0.25, 0.2, -0.35, 0x8c1515, 0xf2f2f0);
  mk.cone(0xf2f2f0, 0.62, 1.55, 0.05, 0.12, 0.38, 0.12, Math.PI / 2);
  // (running lights, red to port and green to starboard, and a white one astern on its pole)
  mk.light(0xff3b2a, r * 0.95, 0.85, L * 0.3);
  mk.light(0x3bff6a, -r * 0.95, 0.85, L * 0.3);
  mk.cyl(0x9aa0a8, -0.6, 1.2, -L / 2 + 0.3, 0.025, 1.0, 0.025);
  mk.light(0xffe6a0, -0.6, 1.72, -L / 2 + 0.3);
}

/** A gravel barge pushed by a tug: rusty steel and a heap of aggregate; the tug black with a red stripe, white house. */
function bargeModel(mk: ModelKit, len: number, r: number) {
  const bl = len - 9;
  const bz = 4.5;
  const w = r * 2;
  // the barge: a box hull with raked ends, its coaming and the heaped load, bitts and tires for fenders
  mk.box(0x5a4a3e, 0, 0.75, bz, w, 1.5, bl - 2.4);
  for (const sd of [-1, 1]) mk.box(0x5a4a3e, 0, 0.95, bz + sd * (bl / 2 - 0.7), w, 1.1, 1.8, sd * 0.55);
  mk.box(0x3f342c, 0, 1.55, bz, w + 0.08, 0.12, bl - 2);
  mk.box(0x6a3b24, 0, 1.0, bz, w + 0.04, 0.16, bl - 2.2);
  for (let k = 0; k < 5; k++) {
    const z = bz - bl / 2 + 3.5 + k * ((bl - 7) / 4);
    mk.ball(0xa59479, 0, 1.55, z, w * 0.42, 1.0 + (k % 2) * 0.35, (bl - 6) / 7);
  }
  mk.ball(0xb4a386, 0.4, 1.9, bz + 1, w * 0.3, 0.8, 3.2);
  for (const sd of [-1, 1]) for (const z of [bz - bl / 2 + 1.5, bz + bl / 2 - 1.5]) mk.cyl(0x1b1c22, sd * (w / 2 - 0.4), 1.75, z, 0.14, 0.4, 0.14);
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) mk.cyl(0x141416, sd * (w / 2 + 0.12), 0.9, bz - bl / 2 + 2.5 + k * (bl - 5) / 5, 0.38, 0.22, 0.38, 0, 0, Math.PI / 2);
  // the tug: hull, red sheer stripe, push knees with fenders, the house, wheelhouse, mast and stack
  const tz = -len / 2 + 4.5;
  mk.geo(boatHull(mk.THREE, 9, w * 0.82, 1.5, true), 0x1c1c22, 0, 0, tz);
  for (const sd of [-1, 1]) mk.box(0xa8231a, sd * w * 0.41, 1.35, tz - 0.3, 0.06, 0.26, 7.2);
  for (const sd of [-1, 1]) mk.box(0x141416, sd * 1.0, 1.9, tz + 4.4, 0.35, 1.8, 0.5);
  mk.box(0xf2f2f0, 0, 2.25, tz - 0.6, w * 0.6, 1.5, 4.2);
  mk.box(0xf2f2f0, 0, 3.6, tz - 0.2, w * 0.5, 1.2, 2.4);
  mk.box(0x22303a, 0, 3.75, tz - 0.2, w * 0.51, 0.45, 2.41);
  mk.box(0x2b2d33, 0, 4.25, tz - 0.2, w * 0.56, 0.1, 2.7);
  mk.cyl(0xa8231a, 0, 4.9, tz - 2.2, 0.32, 1.6, 0.32);
  mk.cyl(0x141416, 0, 5.8, tz - 2.2, 0.33, 0.25, 0.33);
  mk.cyl(0x9aa0a8, 0, 5.4, tz + 0.3, 0.05, 2.2, 0.05);
  mk.box(0x9aa0a8, 0, 5.9, tz + 0.3, 1.2, 0.05, 0.05);
  for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) mk.cyl(0x141416, sd * (w * 0.41 + 0.12), 1.0, tz - 3 + k * 1.8, 0.3, 0.2, 0.3, 0, 0, Math.PI / 2);
  // (its lamps: the masthead, port and starboard on the barge's bow, and the wheelhouse)
  mk.light(0xffe6a0, 0, 6.5, tz + 0.3, 0.18);
  mk.light(0xffe6a0, 0, 4.4, tz + 1, 0.15);
  mk.light(0xff3b2a, r, 1.8, len / 2 - 0.5, 0.2);
  mk.light(0x3bff6a, -r, 1.8, len / 2 - 0.5, 0.2);
}

/** A drifting log: bark, a couple of snapped-off branches and its pale cut ends. */
function logModel(mk: ModelKit, len: number, r: number) {
  // (round its own axis, so it can roll)
  mk.cyl(0x5e4129, 0, 0, 0, r, len, r, Math.PI / 2);
  mk.cyl(0x4c3420, 0, 0, len * 0.15, r * 1.04, len * 0.2, r * 1.04, Math.PI / 2);
  for (const sd of [-1, 1]) mk.cyl(0xcaa676, 0, 0, sd * len * 0.501, r * 0.9, 0.02, r * 0.9, Math.PI / 2);
  mk.cyl(0x5e4129, 0.1, 0.23, len * 0.2, 0.07, 0.8, 0.07, 0.5, 0, -0.6);
  mk.cyl(0x5e4129, -0.15, 0.18, -len * 0.25, 0.06, 0.6, 0.06, -0.3, 0, 0.8);
}

/** The chain ferry: a steel pontoon, hinged ramps at both ends, yellow rails, the operator's cabin and a car aboard. */
function ferryModel(mk: ModelKit, r: number) {
  const w = r * 2;
  const l = r * 2.6;
  mk.box(0x3d6f7a, 0, 0.32, 0, w, 0.55, l);
  mk.box(0x6d737a, 0, 0.62, 0, w - 0.1, 0.06, l - 0.1);
  for (const sd of [-1, 1]) {
    // (ramps raised a little at each end, and the rails down each side)
    mk.box(0x6d737a, 0, 0.75, sd * (l / 2 + 0.6), w * 0.8, 0.08, 1.4, sd * -0.18);
    mk.box(0xffc21a, sd * (w / 2 - 0.05), 1.15, 0, 0.06, 0.06, l - 0.4);
    for (let k = -2; k <= 2; k++) mk.box(0xffc21a, sd * (w / 2 - 0.05), 0.9, (k * (l - 0.6)) / 4, 0.06, 0.5, 0.06);
    // (the chain's sheaves at each end)
    mk.cyl(0x1b1c22, 0, 0.5, sd * (l / 2 - 0.2), 0.25, 0.3, 0.25, 0, 0, Math.PI / 2);
  }
  // the operator's cabin on one side, and a little car aboard
  mk.box(0xf2f2f0, w / 2 - 0.75, 1.45, 0, 1.2, 1.6, 1.6);
  mk.box(0x2a3d4a, w / 2 - 0.75, 1.75, 0, 1.22, 0.5, 1.4);
  mk.box(0x8c1515, w / 2 - 0.75, 2.3, 0, 1.4, 0.12, 1.8);
  mk.box(0x3c6fa8, -0.55, 0.95, 0, 1.4, 0.6, 2.6);
  mk.box(0x2a3d4a, -0.55, 1.4, -0.1, 1.3, 0.45, 1.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk.cyl(0x141416, -0.55 + sx * 0.66, 0.75, sz * 0.85, 0.22, 0.14, 0.22, 0, 0, Math.PI / 2);
  mk.light(0xffb347, w / 2 - 0.75, 2.5, 0, 0.16);
}

/** A wake's foam: broken streaks along the arm, bright at the bow end (v = 0) and fading out behind. */
function wakeTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 128, (g) => {
      const r = scatter(55);
      for (let i = 0; i < 160; i++) {
        const y = r() * 128;
        // (flipped: the canvas's foot is v = 0)
        const a = 0.9 * (y / 128) ** 1.4;
        g.fillStyle = `rgba(250,248,240,${a * (0.3 + r() * 0.7)})`;
        const x = 32 + (r() - 0.5) * 44 * (0.4 + (1 - y / 128) * 0.6);
        g.beginPath();
        g.ellipse(x, y, 1.5 + r() * 4, 3 + r() * 9, 0, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
}

/** THREE.AdditiveBlending, by value: the shared three.js chunk (kit/three-lib.ts) does not export the constant. */
const ADDITIVE = 2 as T.Blending;

/** The Port crane's load hangs from its jib head this high over the middle of the reach, on this much rope (as the wrecker swings: see hazState). */
const CRANE_PIVOT = 9.5;
const CRANE_ROPE = 8.2;

/** Cars on the Hwy 101 deck. */
const CARS = 32;

export type River = {
  tick: (race: Race, me: number, clock: number, dt: number) => void;
  /** Renders what the water mirrors (call before the frame's own render), and lets the camera see the water itself. */
  reflect: (renderer: T.WebGLRenderer, scene: T.Scene, camera: T.PerspectiveCamera) => void;
  dispose: () => void;
};

/** The reflection pass draws at this fraction of the screen's resolution: the ripples blur it anyway. */
const REFLECT_RES = 0.5;
/** Where the mirror is: the water's surface. */
const WATER_Y = 0.04;

/**
 * Builds the water and everything on it for a race in shells (Race.boat). Returns what to do every frame: the currents
 * run, the gates swing, the span sweeps, the whirlpools turn, the vessels go round with their wakes, the buoys bob and
 * the swell rolls in.
 */
export function buildRiver(THREE: Three, scene: T.Scene, r: Race, look: Look, geo: Geo, dummy: T.Object3D): River {
  const t = r.track;
  const water = look.water!;
  const lim = (side: number) => (s: number) => side * edgeAt(t, s, side).lim;
  /** Where the water meets the bank: at a wall's foot, or just short of the brink of the marsh. */
  const wet = (side: number) => (s: number) => {
    const e = edgeAt(t, s, side);
    return side * (e.past === 'wall' ? e.lim : roadEdge(t, s, side));
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The channel, in one strip for each stretch of current (each with its own copy of the texture, scrolled at the
  // current's speed) and one for the still water between them
  const cuts = new Set<number>([0, t.length]);
  for (const f of r.flows) {
    cuts.add(Math.max(0, Math.min(t.length, f.s0)));
    cuts.add(Math.max(0, Math.min(t.length, f.s1)));
  }
  const edges = [...cuts].sort((a, b) => a - b);
  // (the water shader's shared uniforms; each stretch adds how far its current has carried the ripples)
  const col = (c: string | number) => ({ value: new THREE.Color(c) });
  const shared = {
    uTime: { value: 0 },
    uLap: { value: 1 },
    uReflOn: { value: 0 },
    uDeep: col(water.deep),
    uShallow: col(water.shallow),
    uFoam: col(water.foam),
    uSun: { value: new THREE.Vector3(...DAWN.sun).normalize() },
    uSunCol: col(DAWN.sunColor),
    uSkyLow: col(DAWN.low),
    uSkyHigh: col(DAWN.mid),
    uHorizon: col(DAWN.horizon),
    tNormal: { value: rippleNormals(THREE) },
    uWhirlA: { value: Array.from({ length: WHIRLS }, () => new THREE.Vector3()) },
    uWhirlB: { value: Array.from({ length: WHIRLS }, () => new THREE.Vector3()) },
    uWhirlC: { value: Array.from({ length: WHIRLS }, () => new THREE.Vector3()) },
    tRefl: { value: null as T.Texture | null },
    uReflM: { value: new THREE.Matrix4() },
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 1 },
    fogFar: { value: 1000 },
    fogDensity: { value: 0 },
  };
  const chopSpans = (COURSES[r.course].surfaces ?? []).filter((f) => f[3] === 'chop');
  const chopAt = (s: number) => {
    let lap = 0;
    for (const [s0, s1, , , from] of chopSpans) if (deltaS(t, s0, s) >= 0 && deltaS(t, s, s1) >= 0) lap = lap ? Math.min(lap, from ?? 1) : (from ?? 1);
    return lap;
  };
  const runs: { u: { value: number }; s: number; streak: { value: number } }[] = [];
  /** What the reflection pass leaves out: the water and everything lying flat on it. */
  const FLAT = 1;
  const flat = <O extends T.Object3D>(o: O) => {
    o.traverse((c) => c.layers.set(FLAT));
    return o;
  };
  for (let n = 0; n + 1 < edges.length; n++) {
    const [s0, s1] = [edges[n], edges[n + 1]];
    if (s1 - s0 < 0.5) continue;
    const u = { value: 0 };
    const streak = { value: 0 };
    const mat = new THREE.ShaderMaterial({ uniforms: { ...shared, uFlow: u, uStreak: streak }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true });
    scene.add(flat(new THREE.Mesh(waterStrip(THREE, t, s0, s1, wet(-1), wet(1), 0.04, chopAt), mat)));
    runs.push({ u, s: (s0 + s1) / 2, streak });
  }

  // the Bay to the west past the loop: open water to the horizon, the same water as the channel's (the shore at its
  // east edge, u = 0, where it laps)
  {
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
    const g = new THREE.PlaneGeometry(1400, 1800, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('wid', new THREE.Float32BufferAttribute([1e4, 1e4, 1e4, 1e4], 1));
    g.setAttribute('chop', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
    const bay = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...shared, uFlow: { value: 0 }, uStreak: { value: 0 } }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true }));
    bay.position.set(maxX + 60 + 700, 0.03, (minZ + maxZ) / 2);
    scene.add(flat(bay));
  }
  // the Port's berth, where the bulk carrier lies at the wharf (see scenery.ts): a basin of the same water, walled round
  const ferry = r.hazards.find((h) => h.kind === 'ferry');
  if (ferry) {
    const p = pointAt(t, ferry.s - 32, 62);
    const g = new THREE.PlaneGeometry(24, 96, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('wid', new THREE.Float32BufferAttribute([1e4, 1e4, 1e4, 1e4], 1));
    g.setAttribute('chop', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
    const berth = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...shared, uFlow: { value: 0 }, uStreak: { value: 0 } }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true }));
    const h = headingOf(p.tx, p.tz);
    berth.position.set(p.x, 0.04, p.z);
    berth.rotation.y = h;
    scene.add(flat(berth));
    const rim = modelKit(THREE);
    rim.place(p.x, 0, p.z, h);
    for (const [x, z, sx, sz] of [[-13, 0, 2, 100], [13, 0, 2, 100], [0, -49, 28, 2], [0, 49, 28, 2]]) rim.box(0xbdb6a6, x, 0.7, z, sx, 1.6, sz);
    scene.add(rim.build(new THREE.MeshLambertMaterial({ vertexColors: true }), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }

  // the tongue of fast water through the tide race: foam chevrons pointing the way it runs, racing along; and where the
  // water is rough (the chop), whitecaps flecking it, from their lap
  const chevronTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 5;
      g.lineCap = 'round';
      for (const y of [14, 46]) {
        g.beginPath();
        g.moveTo(10, y - 10);
        g.lineTo(32, y + 6);
        g.lineTo(54, y - 10);
        g.stroke();
      }
    }),
  );
  chevronTex.wrapS = chevronTex.wrapT = THREE.RepeatWrapping;
  const tongues: { tex: T.Texture; f: (typeof r.flows)[number] }[] = [];
  for (const f of r.flows) {
    if (!f.tongue) continue;
    const tex = chevronTex.clone();
    tex.needsUpdate = true;
    const m = new THREE.Mesh(band(THREE, t, f.s0 + 6, f.s1 - 6, () => f.tongue![0] + 0.4, () => f.tongue![1] - 0.4, 0.05, 5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.renderOrder = 1;
    scene.add(m);
    tongues.push({ tex, f });
  }
  // (where the water is rough, the chop: see the water shader)
  // the rocks in the rapids: white water piled up round the foot of each, and a tail of foam trailing off downstream
  const rocks = r.hazards.filter((h) => h.kind === 'rock');
  const foamRing = new THREE.RingGeometry(0.75, 1, 20);
  foamRing.rotateX(-Math.PI / 2);
  const rockFoamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(water.foam), transparent: true, depthWrite: false, blending: ADDITIVE });
  const rockFoam = rocks.length ? new THREE.InstancedMesh(foamRing, rockFoamMat, rocks.length * 3) : null;
  if (rockFoam) {
    rockFoam.renderOrder = 2;
    rockFoam.frustumCulled = false;
    rockFoam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(flat(rockFoam));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The banks. Where there is no wall: wet mud shining at the water's edge, drying out up the bank to a wrack line and
  // into the marsh (the same marsh the ground shows beyond, so they join up), and a thin white line at the brink that
  // shows through the last lap's fog. Where there is a wall: a weathered concrete bulkhead with a waterline of weed and
  // barnacles, its coping, and the quay behind it sloping down to the marsh.
  const foamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(water.foam) });
  /** What stays lit and readable through the last lap's fog: the lip of the marsh, the marker posts' lamps, the buoys' and the vessels' lights, the lock's lamps and the whirlpools' foam. */
  const lit: T.MeshBasicMaterial[] = [foamMat];
  const brinks: T.Mesh[] = [];
  const bankMat = marshMaterial(THREE, 'bank');
  const concreteTex = bulkheadTexture(THREE, look);
  concreteTex.wrapS = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshLambertMaterial({ map: concreteTex });
  const capMat = new THREE.MeshLambertMaterial({ color: 0xcfc8b8 });
  const quayMat = marshMaterial(THREE, 'quay');
  // Docktown along Westpoint Slough: where its houseboats lie (see scenery.ts), the wall is the line of their floats,
  // with the water running on under them to the shore behind
  const barge = r.hazards.find((h) => h.kind === 'barge');
  const dock = barge?.span ? [barge.span[0] - 1, barge.span[0] + 91] : null;
  const DOCK_SIDE = 1;
  const DOCK_W = 13;
  const floatMat = new THREE.MeshLambertMaterial({ color: 0x34373c });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x8a7a64 });
  const piles: { s: number; d: number }[] = [];
  const quayEnds: { s: number; d: number }[] = [];
  for (const [side, r0, r1, past] of edgeRuns(t)) {
    const l = lim(side);
    if (past === 'wall') {
      // (cut round Docktown's floats)
      const into = dock && side === DOCK_SIDE ? [Math.max(0, deltaS(t, r0, dock[0])), Math.min(r1 - r0, deltaS(t, r0, dock[1]))] : null;
      const cut = into && into[1] - into[0] > 2 ? [r0 + into[0], r0 + into[1]] : null;
      const spans = cut ? [[r0, cut[0]], [cut[1], r1]] : [[r0, r1]];
      for (const [s0, s1] of spans) {
        if (s1 - s0 < 0.5) continue;
        // the wall's face from below the water line to a meter and a half up, its coping, and the quay behind it
        scene.add(new THREE.Mesh(face(THREE, t, s0, s1, l, -0.6, 1.5, 6, side), wallMat));
        scene.add(new THREE.Mesh(band(THREE, t, s0, s1, l, (s) => l(s) + side * 0.6, 1.5, 4), capMat));
        scene.add(new THREE.Mesh(band(THREE, t, s0, s1, (s) => l(s) + side * 0.6, (s) => l(s) + side * 8, 1.45, 8), quayMat));
        scene.add(new THREE.Mesh(band(THREE, t, s0, s1, (s) => l(s) + side * 8, (s) => l(s) + side * 11, [1.45, -0.04], 8), quayMat));
      }
      if (cut) {
        const [s0, s1] = cut;
        // the floats: a low dark pontoon along the channel with its timber deck, piles to moor to every few meters
        scene.add(new THREE.Mesh(face(THREE, t, s0, s1, l, -0.3, 0.5, 6, side), floatMat));
        scene.add(new THREE.Mesh(band(THREE, t, s0, s1, l, (s) => l(s) + side * 1.6, 0.5, 4), deckMat));
        scene.add(new THREE.Mesh(face(THREE, t, s0, s1, (s) => l(s) + side * 1.6, -0.3, 0.5, 6, -side), floatMat));
        for (let s = s0 + 1; s < s1; s += 6) piles.push({ s, d: side * (l(s) * side + 0.2) });
        // the water on behind them, under the houseboats, to the mudflat at the shore
        const back = new THREE.ShaderMaterial({ uniforms: { ...shared, uFlow: { value: 0 }, uStreak: { value: 0 } }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true });
        scene.add(flat(new THREE.Mesh(waterStrip(THREE, t, s0 - 0.6, s1 + 0.6, (s) => l(s) + side * 1.6, (s) => l(s) + side * DOCK_W, 0.04, () => 0), back)));
        scene.add(flat(new THREE.Mesh(band(THREE, t, s0 - 0.6, s1 + 0.6, (s) => l(s) + side * DOCK_W, (s) => l(s) + side * (DOCK_W + 4), 0.038, 1, true), bankMat)));
        // (and the quay's ends either side: see the piles)
        quayEnds.push({ s: s0, d: side * (l(s0) * side + 4.3) }, { s: s1, d: side * (l(s1) * side + 4.3) });
      }
      continue;
    }
    const [s0, s1] = [r0, r1];
    // (out to where it meets the marsh, under the water so another stretch of the channel close by always shows over it,
    // and never folded over itself on the inside of a bend)
    const far = (s: number) => {
      const c = t.curv[Math.floor(wrapS(t, s) / t.step) % t.n] * side;
      return l(s) + side * Math.max(2.4, Math.min(7, c > 0.005 ? 0.92 / c - Math.abs(l(s)) : 7));
    };
    const brink = new THREE.Mesh(band(THREE, t, s0, s1, (s) => wet(side)(s) - side * 0.08, (s) => wet(side)(s) + side * 0.08, 0.06, 2), foamMat);
    brink.visible = false;
    brinks.push(brink);
    scene.add(flat(brink));
    scene.add(flat(new THREE.Mesh(band(THREE, t, s0, s1, wet(side), far, 0.038, 1, true), bankMat)));
  }
  const plants = marshPlants(THREE, scene, t, dummy, lim);
  // marker posts with a white reflector every 10 m along the brink, so the edge of the channel reads from far off
  const posts: { x: number; z: number }[] = [];
  for (const [side, s0, s1, past] of edgeRuns(t)) {
    if (past === 'wall') continue;
    for (let s = s0 + 4; s < s1 - 2; s += 10) {
      const p = pointAt(t, s, side * (edgeAt(t, s, side).lim + 1.1));
      posts.push({ x: p.x, z: p.z });
    }
  }
  if (posts.length) {
    const post = new THREE.InstancedMesh(geo.box, new THREE.MeshLambertMaterial({ color: 0x5a4632 }), posts.length);
    const capMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    lit.push(capMat);
    const cap = new THREE.InstancedMesh(geo.box, capMat, posts.length);
    posts.forEach((p, k) => {
      dummy.position.set(p.x, 0.55, p.z);
      dummy.scale.set(0.16, 1.1, 0.16);
      dummy.updateMatrix();
      post.setMatrixAt(k, dummy.matrix);
      dummy.position.y = 1.05;
      dummy.scale.set(0.2, 0.18, 0.2);
      dummy.updateMatrix();
      cap.setMatrixAt(k, dummy.matrix);
    });
    scene.add(post, cap);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The set pieces dressed for the water (see Hazard.look)
  const frame = (s: number, d = 0) => {
    const c = pointAt(t, s, d);
    return { x: c.x, z: c.z, h: headingOf(c.tx, c.tz), tx: c.tx, tz: c.tz };
  };
  const vcSet = new THREE.MeshLambertMaterial({ vertexColors: true });
  const vcSetLit = new THREE.MeshBasicMaterial({ vertexColors: true });
  lit.push(vcSetLit);
  const lampColor = { open: new THREE.Color(0x27e36a), warn: new THREE.Color(0xffb300), shut: new THREE.Color(0xff2a1a), dim: new THREE.Color(0x163a22) };
  const sets = modelKit(THREE);
  const away = (x: number, z: number, margin: number) => {
    const at = locate(t, x, z);
    const side = at.d >= 0 ? 1 : -1;
    return Math.abs(at.d) > edgeAt(t, at.s, side).lim + margin;
  };

  // the lock: where its walls stand in closer than the channel's, a handrail along their tops, black bollards to tie up
  // to and ladders down the walls (a wall's run can go on past the lock, at the channel's own width)
  const inLock = (s: number, side: number) => edgeAt(t, s, side).lim <= t.edge - 0.5;
  for (const [side, r0, r1, past] of edgeRuns(t)) {
    if (past !== 'wall') continue;
    let s0 = r0;
    while (s0 < r1 && !inLock(s0 + 0.5, side)) s0 += 0.5;
    let s1 = s0;
    while (s1 < r1 && inLock(s1 + 0.5, side)) s1 += 0.5;
    if (s1 - s0 < 4) continue;
    for (let s = s0 + 1; s < s1 - 0.5; s += 2) {
      const f = frame(s, side * (edgeAt(t, s, side).lim + 0.45));
      sets.place(f.x, 1.5, f.z, f.h);
      sets.box(0xe8e2d4, 0, 0.5, 0, 0.05, 1.0, 0.05);
      sets.box(0xe8e2d4, 0, 1.0, 0, 0.05, 0.05, 2.02);
      sets.box(0xe8e2d4, 0, 0.55, 0, 0.04, 0.04, 2.02);
    }
    for (let s = s0 + 4; s < s1 - 2; s += 9) {
      const f = frame(s, side * (edgeAt(t, s, side).lim + 0.3));
      sets.place(f.x, 1.5, f.z, f.h);
      sets.cyl(0x1b1c22, 0, 0.22, 0, 0.16, 0.44, 0.16);
      sets.cyl(0x1b1c22, 0, 0.46, 0, 0.24, 0.08, 0.24);
      const lad = frame(s + 4.5, side * (edgeAt(t, s + 4.5, side).lim - 0.04));
      sets.place(lad.x, 0, lad.z, lad.h);
      for (const sd of [-1, 1]) sets.box(0x6a7076, sd * 0.25, 0.45, 0, 0.05, 2.1, 0.06, 0, Math.PI / 2, 0);
      for (let y = -0.4; y < 1.5; y += 0.3) sets.box(0x6a7076, 0, y, 0, 0.5, 0.04, 0.04, 0, Math.PI / 2, 0);
    }
  }

  // Docktown's mooring piles along its floats
  for (const p of piles) {
    const f = frame(p.s, p.d);
    sets.place(f.x, 0, f.z, f.h);
    sets.cyl(0x4a3a2c, 0, 0.6, 0, 0.16, 2.4, 0.16);
    sets.cyl(0xe8e2d4, 0, 1.85, 0, 0.17, 0.12, 0.17);
  }
  for (const q of quayEnds) {
    const f = frame(q.s, q.d);
    sets.place(f.x, 0, f.z, f.h);
    sets.box(0xb8b1a2, 0, 0.73, 0, 8.6, 1.5, 0.5);
  }

  // the Tide Gates: a steel miter leaf hinged on each lock wall, swinging shut across its half of the chamber, a
  // walkway along its top and a balance beam back over the wall; a signal on the wall beside it (green open, amber
  // flashing before it swings, red shut)
  type GateView = { i: number; leaf: T.Group; lampMat: T.MeshBasicMaterial; hinge: { x: number; z: number }; shut: [number, number]; open: [number, number]; w: number; lift: number };
  const gates: GateView[] = [];
  // the Hwy 101 piers and the Caltrain swing span, sweeping round on its pivot pier from lap 2
  type SwingView = { i: number; g: T.Group; f: ReturnType<typeof frame>; ang: number };
  const swings: SwingView[] = [];
  const latticeTex = texture(
    THREE,
    canvas(128, 32, (g) => {
      g.strokeStyle = '#3a4550';
      g.lineWidth = 5;
      g.strokeRect(2, 2, 124, 28);
      g.lineWidth = 3;
      for (let x = 0; x < 128; x += 16) {
        g.beginPath();
        g.moveTo(x, 30);
        g.lineTo(x + 8, 2);
        g.lineTo(x + 16, 30);
        g.moveTo(x + 8, 2);
        g.lineTo(x + 8, 30);
        g.stroke();
      }
    }),
  );
  const latticeMat = new THREE.MeshLambertMaterial({ map: latticeTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x8f9cab });
  const piers: LiveHazard[] = [];
  // the Port crane: its load swinging on its hoist right across the reach (see the wrecker in hazState)
  type CraneView = { i: number; f: ReturnType<typeof frame>; load: T.Group; cable: T.Mesh; shade: T.Mesh; shadeMat: T.MeshBasicMaterial; lift: number };
  const cranes: CraneView[] = [];
  let traffic: { body: T.InstancedMesh; cab: T.InstancedMesh; road: { x: number; z: number; w: number; y: number }[]; len: number[] } | null = null;
  /**
   * A level-luffing dockside crane on the Port's wharf, in the red of the Port's gantry cranes: a portal on rails
   * straddling the quay, the machinery house and its cab on the slewing ring, an A-frame, and a lattice jib out over the
   * middle of the reach with its stays, its hoist hanging from the jib head to a grab bucket of scrap that swings right
   * across the channel (CRANE_PIVOT, CRANE_ROPE: the wrecker's pendulum). Its static parts go in with the other set
   * pieces; the load, its rope and its shadow on the water move.
   */
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0x23262c });
  const blotTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 4, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  const portCrane = (h: LiveHazard, i: number): CraneView => {
    const f = frame(h.s);
    // (on the Port's side of the reach, the outside of the Turning Basin: in the frame, something d to the right is at x = -d)
    const side = 1;
    const X = (d: number) => -side * d;
    const lim = edgeAt(t, h.s, side).lim;
    const quay = 1.45;
    const red = 0xd8452c;
    const steel = 0x3a3d42;
    const d0 = lim + 1.6;
    const d1 = lim + 7.4;
    const dc = (d0 + d1) / 2;
    sets.place(f.x, 0, f.z, f.h);
    /** A member from (d0, y0) to (d1, y1) across the channel, at z along it. */
    const strut = (hex: number, da: number, ya: number, db: number, yb: number, z: number, w: number) => {
      const dx = X(db) - X(da);
      const dy = yb - ya;
      sets.box(hex, (X(da) + X(db)) / 2, (ya + yb) / 2, z, w, Math.hypot(dx, dy), w, 0, 0, Math.atan2(-dx, dy));
    };
    // the rails along the quay, and the portal: four legs on their bogies, beams round the top, braced
    for (const d of [d0, d1]) sets.box(0x6a7076, X(d), quay + 0.04, 0, 0.22, 0.1, 16);
    for (const d of [d0, d1]) {
      for (const z of [-3, 3]) {
        sets.box(steel, X(d), quay + 0.4, z, 0.8, 0.8, 1.9);
        sets.box(red, X(d), (quay + 0.8 + 8) / 2, z, 0.7, 8 - quay - 0.8, 0.7);
      }
      sets.box(red, X(d), 8.2, 0, 0.75, 0.8, 6.75);
      for (const sg of [-1, 1]) sets.box(red, X(d), 5.2, 0, 0.22, 0.22, 7.2, sg * 0.72, 0, 0);
    }
    for (const z of [-3, 3]) sets.box(red, X(dc), 8.2, z, d1 - d0 + 0.75, 0.8, 0.75);
    // the slewing ring, the machinery house with its cab out front, and the counterweight behind
    sets.cyl(steel, X(dc), 8.9, 0, 2.3, 0.6, 2.3);
    sets.box(0xe8e2d4, X(dc + 0.7), 10.7, 0, 4.4, 3, 3.6);
    sets.box(red, X(dc + 0.7), 12.25, 0, 4.6, 0.16, 3.8);
    sets.box(0x55585c, X(dc + 3.6), 10.3, 0, 1.5, 2.4, 3.2);
    sets.box(0xe8e2d4, X(dc - 2.1), 10.4, -1.1, 1.4, 1.9, 1.3);
    sets.box(0x2a3d4a, X(dc - 2.82), 10.6, -1.1, 0.05, 1.0, 1.1);
    sets.box(0x2a3d4a, X(dc - 2.1), 10.6, -1.77, 1.1, 1.0, 0.05);
    // the A-frame over it all
    const apex = 18.5;
    for (const z of [-1.3, 1.3]) {
      strut(red, dc + 2.4, 12.3, dc + 0.3, apex, z, 0.45);
      strut(red, dc - 1.4, 12.3, dc + 0.3, apex, z, 0.45);
    }
    sets.box(red, X(dc + 0.3), apex, 0, 0.6, 0.6, 3.2);
    // the jib: two lattice girders from its heel on the house out to the head over the middle of the reach, laced
    const heel = dc - 1.6;
    const head = h.d;
    const yb = (d: number) => 9.6 + ((heel - d) / (heel - head)) * (CRANE_PIVOT + 0.15 - 9.6);
    const yt = (d: number) => yb(d) + 1.2 - ((heel - d) / (heel - head)) * 0.7;
    for (const z of [-0.55, 0.55]) {
      strut(red, heel, yb(heel), head, yb(head), z, 0.2);
      strut(red, heel, yt(heel), head, yt(head), z, 0.2);
      const n = 9;
      for (let k = 0; k < n; k++) {
        const a = heel + ((head - heel) * k) / n;
        const b = heel + ((head - heel) * (k + 1)) / n;
        strut(red, a, k % 2 ? yt(a) : yb(a), b, k % 2 ? yb(b) : yt(b), z, 0.1);
      }
    }
    for (let k = 0; k <= 9; k++) {
      const d = heel + ((head - heel) * k) / 9;
      sets.box(red, X(d), yb(d), 0, 0.12, 0.12, 1.2);
    }
    // its stays from the top of the A-frame, the head and its sheaves, and the lamps on top
    for (const z of [-0.5, 0.5]) {
      strut(0x2b2b30, dc + 0.3, apex, head, yt(head), z, 0.07);
      strut(0x2b2b30, dc + 0.3, apex, (heel + head) / 2, yt((heel + head) / 2), z, 0.07);
    }
    sets.box(0xffc21a, X(head), CRANE_PIVOT + 0.25, 0, 0.9, 0.6, 1.3);
    sets.light(0xff2a1a, X(head), yt(head) + 0.25, 0, 0.18);
    sets.light(0xff2a1a, X(dc + 0.3), apex + 0.45, 0, 0.18);
    // the load: a hook block on the hoist, and a clamshell grab heaped with scrap (its middle where the wrecker's ball is)
    const mk = modelKit(THREE);
    const r0 = h.r;
    mk.box(0xffc21a, 0, r0 + 0.55, 0, 0.55, 0.7, 0.4);
    mk.box(0x2b2b30, 0, r0 + 0.1, 0, 0.12, 0.4, 0.12);
    mk.box(0x55585c, 0, r0 - 0.15, 0, r0 * 0.9, 0.3, r0 * 1.1);
    for (const sg of [-1, 1]) for (const sz of [-1, 1]) mk.box(0x2b2b30, sg * r0 * 0.42, r0 * 0.45 - 0.15, sz * r0 * 0.5, 0.06, r0 * 0.8, 0.06, 0, 0, -sg * 0.45);
    for (const sg of [-1, 1]) {
      mk.box(0x4a4d55, sg * r0 * 0.45, -0.05, 0, r0 * 0.9, r0 * 0.95, r0 * 1.5, 0, 0, sg * 0.32);
      mk.box(0xffc21a, sg * r0 * 0.47, 0.3, 0, r0 * 0.92, 0.14, r0 * 1.52, 0, 0, sg * 0.32);
      mk.box(0x3a3d42, sg * r0 * 0.75, -0.7, 0, 0.12, 0.5, r0 * 1.5, 0, 0, sg * 0.32);
    }
    for (const [x, z, c] of [[-0.3, 0.2, 0x8a5a3a], [0.35, -0.3, 0x6a7076], [0, 0.45, 0x9a6a4a], [0.15, -0.05, 0x7a7f86]] as const) mk.box(c, x * r0, 0.55, z * r0, r0 * 0.5, r0 * 0.3, r0 * 0.6, x, z, 0.3);
    mk.light(0xffb300, 0, r0 + 0.95, 0, 0.12);
    const load = mk.build(vcSet, vcSetLit);
    scene.add(load);
    const cable = new THREE.Mesh(geo.box, ropeMat);
    scene.add(cable);
    // (its shadow on the water, darker the lower it hangs, so where it will pass reads from the boat)
    const shadeMat = new THREE.MeshBasicMaterial({ map: blotTex, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    const shade = new THREE.Mesh(geo.plane, shadeMat);
    shade.rotation.x = -Math.PI / 2;
    shade.renderOrder = 2;
    scene.add(flat(shade));
    return { i, f, load, cable, shade, shadeMat, lift: 0 };
  };
  r.hazards.forEach((h, i) => {
    if (h.kind === 'bollard' && h.look === 'gate') {
      const w = h.w ?? 6;
      const side = h.d < 0 ? -1 : 1;
      const f = frame(h.s, side * edgeAt(t, h.s, side).lim);
      const nx = -f.tz * -side;
      const nz = f.tx * -side;
      const mk = modelKit(THREE);
      // (the leaf from its hinge, z = -w/2, to its tip: a riveted frame of girders, the stripe along its top)
      mk.box(0x56616b, 0, 0.55, 0, 0.45, 1.6, w);
      for (const y of [-0.05, 0.45, 0.95]) for (const sd of [-1, 1]) mk.box(0x47515a, sd * 0.24, y, 0, 0.06, 0.16, w);
      for (let k = -2; k <= 2; k++) for (const sd of [-1, 1]) mk.box(0x47515a, sd * 0.24, 0.55, (k * w) / 5, 0.06, 1.6, 0.12);
      mk.box(0xffcf1f, 0, 1.37, 0, 0.47, 0.06, w);
      for (let k = 0; k < 6; k++) mk.box(0x1b1c22, 0, 1.37, -w / 2 + 0.5 + k * ((w - 1) / 5), 0.48, 0.065, 0.28);
      // (the walkway's handrail, and the balance beam back over the wall)
      for (let k = 0; k <= 4; k++) mk.box(0xe8e2d4, -0.2, 1.8, -w / 2 + 0.2 + (k * (w - 0.4)) / 4, 0.04, 0.8, 0.04);
      mk.box(0xe8e2d4, -0.2, 2.2, 0, 0.05, 0.05, w - 0.3);
      mk.box(0x3a2a20, 0, 1.75, -w / 2 - 2.6, 0.32, 0.36, 5.4);
      const leaf = mk.build(vcSet, vcSetLit);
      scene.add(leaf);
      // (the signal: a black head on a post, its lamp lit, a visor over it)
      const px = f.x - nx * 0.6 - f.tx * 1.2;
      const pz = f.z - nz * 0.6 - f.tz * 1.2;
      sets.place(px, 1.5, pz, f.h + (side > 0 ? Math.PI : 0));
      sets.cyl(0x2b2f36, 0, 1.1, 0, 0.07, 2.2, 0.07);
      sets.box(0x141416, 0, 2.4, 0, 0.5, 0.75, 0.4);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x27e36a });
      lit.push(lampMat);
      const lamp = new THREE.Mesh(geo.ball, lampMat);
      lamp.scale.set(0.2, 0.2, 0.12);
      lamp.position.set(px - f.tx * 0.2, 3.9, pz - f.tz * 0.2);
      scene.add(lamp);
      gates.push({ i, leaf, lampMat, hinge: { x: f.x, z: f.z }, shut: [nx, nz], open: [-f.tx, -f.tz], w, lift: 0 });
      return;
    }
    if (h.kind === 'wrecker' && h.look === 'crane') {
      cranes.push(portCrane(h, i));
      return;
    }
    if (h.kind === 'statue' && h.look === 'pier') {
      // a concrete pier on its footing, a hammerhead cap under the deck
      sets.place(h.x, 0, h.z, headingOf(h.tx, h.tz));
      sets.cyl(0x8a8578, 0, 0.12, 0, h.r * 1.6, 0.5, h.r * 1.6);
      sets.box(0xbdb6a6, 0, 4.2, 0, h.r * 1.8, 8.4, h.r * 2.2);
      sets.box(0xa8a194, 0, 0.6, 0, h.r * 1.84, 1.2, h.r * 2.24);
      sets.box(0xc4bdae, 0, 8.6, 0, h.r * 2.6, 0.8, 5.5);
      piers.push(h);
      return;
    }
    if (h.kind === 'rotor' && h.look === 'swing') {
      const f = frame(h.s, h.d);
      // the pivot pier, its fender ring of timbers, and the operator's house on the span
      sets.place(f.x, 0, f.z, 0);
      sets.cyl(0xbdb6a6, 0, 0.5, 0, h.r, 1.6, h.r);
      sets.cyl(0x5a4632, 0, 0.35, 0, h.r + 0.35, 0.5, h.r + 0.35);
      // the span: a steel through-truss from the pivot out over the water, the track on its deck, low enough to hit
      const g = new THREE.Group();
      const arm = h.arm ?? 6.6;
      const mk = modelKit(THREE);
      mk.box(0x47505a, 0, 1.05, arm / 2, 1.4, 0.3, arm + 0.6);
      for (let k = 0; k < arm; k += 0.6) mk.box(0x5a4632, 0, 1.24, k + 0.1, 1.3, 0.08, 0.18);
      for (const sd of [-1, 1]) mk.box(0x8a8f96, sd * 0.36, 1.32, arm / 2, 0.06, 0.08, arm + 0.6);
      for (const sd of [-1, 1]) mk.box(0x47505a, sd * 0.68, 2.9, arm / 2, 0.16, 0.2, arm + 0.6);
      mk.box(0x47505a, 0, 2.95, arm / 2, 1.4, 0.06, 0.2);
      mk.cyl(0x47505a, 0, 1.25, 0, 1.3, 0.6, 1.3);
      mk.box(0xe8e2d4, 0, 2.0, -0.6, 1.2, 1.4, 1.0);
      mk.box(0x2a3d4a, 0, 2.2, -0.1, 1.1, 0.5, 0.05);
      mk.light(0xff2a1a, 0, 3.15, arm, 0.22);
      mk.light(0xff2a1a, 0, 3.15, 0, 0.15);
      const span = mk.build(vcSet, vcSetLit);
      g.add(span);
      for (const x of [-0.68, 0.68]) {
        const truss = new THREE.Mesh(geo.box, latticeMat);
        truss.scale.set(0.05, 1.8, arm + 0.4);
        truss.position.set(x, 1.95, arm / 2);
        g.add(truss);
      }
      g.position.set(f.x, 0, f.z);
      scene.add(g);
      swings.push({ i, g, f, ang: 0 });
      // (and the trestle carrying the line up to the channel on either bank, square across it)
      for (const sd of [-1, 1]) {
        for (let k = 0; k < 20; k++) {
          const d = sd * (edgeAt(t, h.s, sd).lim + 1 + k * 2);
          const q = frame(h.s, d);
          if (!away(q.x, q.z, 0.5)) continue;
          // (its deck just over the quay, where the line comes down to the span's level at the wall)
          sets.place(q.x, 0, q.z, f.h + Math.PI / 2);
          sets.box(0x5a4632, 0, 1.64, 0, 2.1, 0.08, 0.22);
          sets.box(0x8a8f96, 0, 1.73, 0.36, 2.05, 0.08, 0.06);
          sets.box(0x8a8f96, 0, 1.73, -0.36, 2.05, 0.08, 0.06);
          sets.box(0x6a5a48, 0, 1.4, 0, 2.05, 0.4, 1.6);
          if (k % 2 === 0) for (const z of [-0.6, 0.6]) sets.cyl(0x4a3a2c, 0, 0.6, z, 0.14, 1.7, 0.14);
        }
      }
    }
  });
  // Hwy 101 on its viaduct over the piers: a deck on box girders, Jersey barriers, light poles down the median, a
  // gantry with the big green sign, bents of columns where it crosses the marsh, its shade on the water, and the
  // morning traffic streaming across
  if (piers.length) {
    const mid = piers.reduce((a, h) => a + h.s, 0) / piers.length;
    const f = frame(mid);
    const W = 34;
    const mk = modelKit(THREE);
    // (its line: straight across the channel, then out across the marsh on piers. Heading out of the course it bends away
    // and runs on into the haze; inside the loop it narrows to a two-lane flyover that curves away from the water into
    // the middle of the marsh and comes down there on its piers)
    const ferryS = r.hazards.find((h) => h.kind === 'ferry')?.s ?? 404;
    const tall = [[ferryS - 59, 58, 22], [ferryS - 4, 50, 22], [ferryS - 32, 62, 48], [ferryS - 20, 110, 34], [t.length - 26, t.edge + 16, 30]].map(([s0, d, rr]) => {
      const p = pointAt(t, s0, d);
      return { x: p.x, z: p.z, r: rr };
    });
    const lines = highwayLine(t, f.x, f.z, Math.cos(f.h), -Math.sin(f.h), W / 2, tall);
    const NARROW = 14;
    /** The road: one polyline from the inner end to the outer, its width and the height of its deck at each point. */
    const road: { x: number; z: number; w: number; y: number }[] = [];
    for (const { pts, out } of [...lines].sort((p, q) => Number(p.out) - Number(q.out))) {
      const n = pts.length;
      const list = pts.map((p, i) => {
        const run = i * 8;
        const w = out || run <= 24 ? W : run >= 48 ? NARROW : W + ((NARROW - W) * (run - 24)) / 24;
        // (the flyover inside comes down over its last 64 m)
        const down = out ? 1 : Math.min(1, Math.max(0, ((n - 1 - i) * 8) / 64));
        return { x: p.x, z: p.z, w, y: 0.6 + 8.95 * (out ? 1 : down) };
      });
      if (out) road.push(...list.slice(1));
      else road.push(...list.reverse());
    }
    const hw = modelKit(THREE);
    const len: number[] = [0];
    for (let i = 1; i < road.length; i++) len.push(len[i - 1] + Math.hypot(road[i].x - road[i - 1].x, road[i].z - road[i - 1].z));
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z) + 0.6;
      const ry = Math.atan2(b.x - a.x, b.z - a.z);
      const pitch = Math.atan2(b.y - a.y, segLen);
      const w = (a.w + b.w) / 2;
      const y = (a.y + b.y) / 2;
      hw.place((a.x + b.x) / 2, 0, (a.z + b.z) / 2, ry);
      // (along local z: the slab, its asphalt, girders under it, Jersey barriers along its edges and down the median)
      hw.box(0xc4bdae, 0, y, 0, w, 1.0, segLen, -pitch);
      hw.box(0x55585c, 0, y + 0.52, 0, w - 1.4, 0.04, segLen, -pitch);
      for (const gz of w > 20 ? [-12, -4, 4, 12] : [-3.5, 3.5]) hw.box(0xa8a194, gz, y - 0.95, 0, 2.6, 1.0, segLen, -pitch);
      for (const ez of w > 20 ? [-w / 2 + 0.3, 0, w / 2 - 0.3] : [-w / 2 + 0.3, w / 2 - 0.3]) {
        hw.box(0xd8d2c4, ez, y + 0.9, 0, 0.5, 0.8, segLen, -pitch);
        hw.box(0xe8e2d4, ez, y + 1.33, 0, 0.3, 0.08, segLen, -pitch);
      }
      for (const ez of [-w / 2 + 0.1, w / 2 - 0.1]) hw.box(0x8c1515, ez, y, 0, 0.06, 0.35, segLen, -pitch);
      // (piers every third span, each column clear of the water; lights down the middle)
      if (i % 3 === 1) {
        const cols = w > 20 ? [-11, 0, 11] : [0];
        let any = false;
        for (const cz of cols) {
          const qx = (a.x + b.x) / 2 + Math.cos(ry) * cz;
          const qz = (a.z + b.z) / 2 - Math.sin(ry) * cz;
          if (!away(qx, qz, 1.5) || y < 1.5) continue;
          any = true;
          hw.cyl(0xbdb6a6, cz, (y - 1) / 2, 0, w > 20 ? 0.9 : 0.75, y - 1, w > 20 ? 0.9 : 0.75);
        }
        if (any) hw.box(0xb0a99a, 0, y - 1.15, 0, w - 2, 1.2, 2);
        if (y > 8) {
          hw.cyl(0x8a8f96, 0, y + 4, 0, 0.1, 6, 0.1);
          for (const sd of [-1, 1]) {
            hw.box(0x8a8f96, sd * 1.4, y + 6.9, 0, 2.8, 0.08, 0.08);
            hw.glow(0xfff0c8, sd * 2.6, y + 6.8, 0, 0.25, 0.12, 0.5);
          }
        }
      }
    }
    hw.place();
    scene.add(hw.build(vcSet, vcSetLit));
    mk.place(f.x, 0, f.z, f.h);
    // (the sign gantry over the eastbound lanes)
    const gx = -18;
    for (const z of [-W / 2 + 0.5, -1]) mk.box(0x8a8f96, gx, 13, z, 0.3, 5.5, 0.3);
    mk.box(0x8a8f96, gx, 15.6, -W / 4, 0.4, 0.4, W / 2);
    mk.place();
    scene.add(mk.build(vcSet, vcSetLit));
    const signTex = texture(
      THREE,
      canvas(256, 96, (g) => {
        g.fillStyle = '#1f6b3a';
        g.fillRect(0, 0, 256, 96);
        g.strokeStyle = '#f2f2f0';
        g.lineWidth = 4;
        g.strokeRect(5, 5, 246, 86);
        g.fillStyle = '#f2f2f0';
        g.font = 'bold 26px Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText('101 NORTH', 128, 40);
        g.font = '22px Arial, sans-serif';
        g.fillText('San Francisco', 128, 72);
      }),
    );
    for (const sd of [-1, 1]) {
      const sign = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: signTex, side: THREE.DoubleSide }));
      sign.scale.set(7, 2.6, 1);
      const sx = f.x + Math.cos(f.h) * (gx + sd * 0.25) + Math.sin(f.h) * -W / 4;
      const sz = f.z - Math.sin(f.h) * (gx + sd * 0.25) + Math.cos(f.h) * -W / 4;
      sign.position.set(sx, 14.4, sz);
      sign.rotation.y = f.h + (sd > 0 ? Math.PI / 2 : -Math.PI / 2);
      scene.add(sign);
    }
    const shade = new THREE.Mesh(band(THREE, t, mid - W / 2, mid + W / 2, wet(-1), wet(1), 0.055, 4), new THREE.MeshBasicMaterial({ color: 0x0a1820, transparent: true, opacity: 0.4, depthWrite: false }));
    shade.renderOrder = 1;
    scene.add(flat(shade));
    // and the morning traffic on it, four lanes each way, streaming across on the clock: a body and a cabin each
    const carMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const body = new THREE.InstancedMesh(geo.box, carMat, CARS);
    const cab = new THREE.InstancedMesh(geo.box, new THREE.MeshLambertMaterial({ color: 0x2a3640 }), CARS);
    const carColors = [0xd8dde2, 0x2b2f36, 0x8c1515, 0x3c6fa8, 0xe8e2d4, 0x6a6f74, 0xb8a27a, 0xf2f2f0];
    for (let n = 0; n < CARS; n++) body.setColorAt(n, new THREE.Color(carColors[(n * 5) % carColors.length]));
    for (const m of [body, cab]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    traffic = { body, cab, road, len };
  }
  sets.place();
  if (sets.count()) scene.add(sets.build(vcSet, vcSetLit));

  // ---------------------------------------------------------------------------------------------------------------
  // Slack water along the banks where the current runs against you (hug it going upstream): a darker, stiller strip
  for (const f of r.flows) {
    if (f.bank === undefined) continue;
    const slack = new THREE.MeshBasicMaterial({ color: 0x0b2430, transparent: true, opacity: 0.22, depthWrite: false });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(band(THREE, t, f.s0 + 6, f.s1 - 6, (s) => wet(side)(s) - side * 2.5, wet(side), 0.046, 6), slack);
      m.renderOrder = 1;
      scene.add(m);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The whirlpools, drawn in the water itself (see WATER_FRAG): a still faint ring before their lap, the foam turning
  // as one is about to form, then a funnel of water spinning down into a dark eye, its arms of foam wound round it, and
  // spray flung off its rim. The ring stays lit through the fog.
  type WhirlView = { h: LiveHazard; ring: T.Mesh; ringMat: T.MeshBasicMaterial; a: number; n: number };
  const whirls: WhirlView[] = r.whirls.slice(0, WHIRLS).map((h, n) => {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf4efe6, transparent: true, depthWrite: false, opacity: 0.2 });
    lit.push(ringMat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.085;
    ring.renderOrder = 3;
    ring.scale.setScalar((h.r ?? 2.6) + 0.6);
    scene.add(flat(ring));
    return { h, ring, ringMat, a: 0, n };
  });
  const SPRAY = 18;
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const spray = whirls.length ? new THREE.InstancedMesh(blob, new THREE.MeshBasicMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.7, depthWrite: false }), whirls.length * SPRAY) : null;
  if (spray) {
    spray.frustumCulled = false;
    spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(spray);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The vessels: the coach's launches, the tug and its barge, the logs; the chain ferry; and the lane buoys. Each is one
  // mesh of vertex-colored parts, and one more for its lights (which shine through the last lap's fog)
  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const vcLit = new THREE.MeshBasicMaterial({ vertexColors: true });
  lit.push(vcLit);
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262c });
  type VesselView = { h: LiveHazard; g: T.Group; roll: T.Object3D | null; wake: T.Mesh | null; wakePos: T.BufferAttribute | null };
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture(THREE), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
  const WAKE_N = 12;
  const vessels: VesselView[] = r.vessels.map((h) => {
    const len = lengthOf(h);
    const mk = modelKit(THREE);
    let roll: T.Object3D | null = null;
    if (h.kind === 'launch') launchModel(mk, len, h.r);
    else if (h.kind === 'barge') bargeModel(mk, len, h.r);
    else logModel(mk, len, h.r ?? 0.35);
    const g = mk.build(vc, vcLit);
    if (h.kind === 'log') {
      roll = g.children[0];
      roll.position.y = 0.12;
    }
    g.visible = false;
    scene.add(g);
    let wake: T.Mesh | null = null;
    let wakePos: T.BufferAttribute | null = null;
    if ((h.wake ?? 0) > 0) {
      // the V: two arms of WAKE_N quads each, rebuilt from where the vessel is every frame, foam fading out behind
      const geom = new THREE.BufferGeometry();
      wakePos = new THREE.BufferAttribute(new Float32Array(2 * (WAKE_N + 1) * 2 * 3), 3);
      wakePos.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', wakePos);
      const uv: number[] = [];
      for (let arm = 0; arm < 2; arm++) for (let k = 0; k <= WAKE_N; k++) uv.push(0, k / WAKE_N, 1, k / WAKE_N);
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const idx: number[] = [];
      for (let arm = 0; arm < 2; arm++) {
        const o = arm * (WAKE_N + 1) * 2;
        for (let k = 0; k < WAKE_N; k++) idx.push(o + 2 * k, o + 2 * k + 1, o + 2 * k + 2, o + 2 * k + 1, o + 2 * k + 3, o + 2 * k + 2);
      }
      geom.setIndex(idx);
      wake = new THREE.Mesh(geom, wakeMat);
      wake.frustumCulled = false;
      wake.renderOrder = 2;
      scene.add(flat(wake));
    }
    return { h, g, roll, wake, wakePos };
  });
  // the chain ferry: a steel pontoon with a ramp at each end, rails, the operator's cabin and a car aboard, hauling
  // itself across the Port Reach on its chain
  const ferries = r.hazards
    .filter((h) => h.kind === 'ferry')
    .map((h) => {
      const mk = modelKit(THREE);
      ferryModel(mk, h.r);
      const g = mk.build(vc, vcLit);
      g.rotation.y = headingOf(h.tx, h.tz);
      scene.add(g);
      // (the chain, right across the reach, sagging under the water in the middle)
      const f = frame(h.s);
      for (const sd of [-1, 1]) {
        const chain = new THREE.Mesh(geo.box, dark);
        chain.scale.set(t.edge + 2, 0.07, 0.07);
        const c = pointAt(t, h.s, sd * (t.edge / 2 + 1));
        chain.position.set(c.x - f.tx * 0.6, 0.06, c.z - f.tz * 0.6);
        chain.rotation.set(0, f.h, sd * 0.02);
        scene.add(chain);
      }
      return { h, g };
    });
  // the lane buoys: orange with a white band, bobbing
  const buoys = r.hazards.filter((h) => h.kind === 'buoy');
  const buoyMesh = buoys.length ? new THREE.InstancedMesh(geo.ball, new THREE.MeshLambertMaterial({ color: 0xff6a10, emissive: 0x9a3200 }), buoys.length) : null;
  const bandMesh = buoys.length ? new THREE.InstancedMesh(geo.wheel, new THREE.MeshBasicMaterial({ color: 0xffffff }), buoys.length) : null;
  // (and on the last lap, in the fog, a lamp on each)
  const buoyLampMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  lit.push(buoyLampMat);
  const buoyLamps = buoys.length ? new THREE.InstancedMesh(geo.ball, buoyLampMat, buoys.length) : null;
  if (buoyMesh && bandMesh && buoyLamps) {
    buoyMesh.frustumCulled = bandMesh.frustumCulled = buoyLamps.frustumCulled = false;
    buoyLamps.visible = false;
    scene.add(buoyMesh, bandMesh, buoyLamps);
  }
  let fogLit = false;

  // ---------------------------------------------------------------------------------------------------------------
  // The swell: each crest a ridge of water along the Bay Reach, steeper on its leading face, breaking white along its top,
  // rolling in from the Bay across the channel
  const CRESTS = 10;
  const crestPts = 24;
  /** Across each crest: from the leading foot (in the way it rolls) over the top to the trailing foot: offset, height, color. */
  const RIDGE: [number, number, number, number, number, number][] = [
    [1.1, 0.03, 0.18, 0.4, 0.44, 0],
    [0.45, 0.26, 0.42, 0.66, 0.68, 0.75],
    [0, 0.42, 0.95, 0.97, 0.95, 1],
    [-0.6, 0.32, 0.86, 0.9, 0.9, 0.9],
    [-2.4, 0.03, 0.18, 0.4, 0.44, 0],
  ];
  const R = RIDGE.length;
  const crestGeo = new THREE.BufferGeometry();
  const crestPos = new THREE.BufferAttribute(new Float32Array(CRESTS * (crestPts + 1) * R * 3), 3);
  crestPos.setUsage(THREE.DynamicDrawUsage);
  crestGeo.setAttribute('position', crestPos);
  {
    const idx: number[] = [];
    const colr: number[] = [];
    for (let c = 0; c < CRESTS; c++) {
      const o = c * (crestPts + 1) * R;
      for (let k = 0; k <= crestPts; k++) for (const row of RIDGE) colr.push(row[2], row[3], row[4], row[5]);
      for (let k = 0; k < crestPts; k++) for (let j = 0; j < R - 1; j++) {
        const a0 = o + k * R + j;
        idx.push(a0, a0 + 1, a0 + R, a0 + 1, a0 + R + 1, a0 + R);
      }
    }
    crestGeo.setIndex(idx);
    crestGeo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 4));
  }
  const crestMesh = new THREE.Mesh(crestGeo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, emissive: 0x23303a }));
  crestMesh.frustumCulled = false;
  crestMesh.renderOrder = 3;
  if (r.swells.length) scene.add(crestMesh);

  // ---------------------------------------------------------------------------------------------------------------
  // The weir: a glassy tongue of water pouring over the concrete crest into the stopper boiling white below it, spray
  // thrown up off the boil, the abutments and a footbridge over it all, and DANGER WEIR boards on both banks
  const foamTex = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = 'rgba(236,242,240,0.92)';
      g.fillRect(0, 0, 128, 128);
      const r3 = scatter(9);
      for (let i = 0; i < 260; i++) {
        const x = r3() * 128;
        const y = r3() * 128;
        const rad = 1 + r3() * 6;
        const grad = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.7, `rgba(150,185,190,${0.25 + r3() * 0.3})`);
        grad.addColorStop(1, 'rgba(90,140,150,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
  const tongueTex = texture(
    THREE,
    canvas(64, 128, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, 'rgba(40,96,104,0.75)');
      grad.addColorStop(0.55, 'rgba(120,175,180,0.8)');
      grad.addColorStop(1, 'rgba(240,246,244,0.95)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 128);
      const r3 = scatter(4);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(255,255,255,${0.15 + r3() * 0.35})`;
        g.fillRect(r3() * 64, r3() * 128, 1 + r3() * 2, 10 + r3() * 40);
      }
    }),
  );
  tongueTex.wrapS = tongueTex.wrapT = THREE.RepeatWrapping;
  const stoppers: T.Texture[] = [];
  // (and the white water pouring over the crest into it)
  const pours: T.Texture[] = [];
  const boils: { x: number; z: number; w: number; h: number; tx: number; tz: number }[] = [];
  const weirKit = modelKit(THREE);
  for (const h of r.holes) {
    if ((h.w ?? h.r) < t.half + 1) continue;
    for (const [rep, y, order] of [[3, 0.07, 2], [2.2, 0.075, 3]] as const) {
      const tex = foamTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(rep, 1);
      stoppers.push(tex);
      const m = new THREE.Mesh(band(THREE, t, h.s - 0.3, h.s + (h.len ?? 0), wet(-1), wet(1), y, 3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: order === 3 ? 0.55 : 1, depthWrite: false }));
      m.renderOrder = order;
      scene.add(flat(m));
    }
    {
      const pour = tongueTex.clone();
      pour.needsUpdate = true;
      pour.repeat.set(5, 1);
      pours.push(pour);
      const f = frame(h.s - 0.2);
      const w = wet(1)(h.s) - wet(-1)(h.s);
      const sheet = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: pour, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      sheet.scale.set(w, RAMP_H + 0.5, 1);
      const c = pointAt(t, h.s - 0.2, (wet(1)(h.s) + wet(-1)(h.s)) / 2);
      sheet.position.set(c.x, (RAMP_H - 0.5) / 2 + 0.04, c.z);
      sheet.rotation.y = f.h;
      sheet.renderOrder = 2;
      scene.add(sheet);
      boils.push({ x: c.x, z: c.z, w, h: f.h, tx: f.tx, tz: f.tz });
    }
    // (the abutments at either end of the crest, and a footbridge high over it with its rails)
    const f = frame(h.s);
    for (const side of [-1, 1]) {
      const q = frame(h.s, side * (edgeAt(t, h.s, side).lim + 1.4));
      weirKit.place(q.x, 0, q.z, f.h);
      weirKit.box(0xbdb6a6, 0, 3.2, 0, 2.4, 6.4, 4.2);
      weirKit.box(0x9a9385, 0, 0.6, 0, 2.5, 1.2, 4.3);
      weirKit.box(0xd8d2c4, 0, 6.5, 0, 2.7, 0.25, 4.5);
    }
    const span = edgeAt(t, h.s, 1).lim + edgeAt(t, h.s, -1).lim + 2.8;
    const mid = (edgeAt(t, h.s, 1).lim - edgeAt(t, h.s, -1).lim) / 2;
    const q = frame(h.s, mid);
    weirKit.place(q.x, 0, q.z, f.h);
    weirKit.box(0x6a7076, 0, 6.2, 0, span, 0.35, 1.8);
    for (const sd of [-1, 1]) {
      weirKit.box(0xe8e2d4, 0, 7.25, sd * 0.85, span, 0.06, 0.06);
      for (let k = 0; k <= 12; k++) weirKit.box(0xe8e2d4, -span / 2 + (k * span) / 12, 6.8, sd * 0.85, 0.05, 0.9, 0.05);
      weirKit.box(0xffcf1f, 0, 6.02, sd * 0.88, span, 0.12, 0.04);
    }
    const board = new THREE.MeshBasicMaterial({
      map: texture(
        THREE,
        canvas(256, 96, (g) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 256, 96);
          g.strokeStyle = '#e65100';
          g.lineWidth = 10;
          g.strokeRect(5, 5, 246, 86);
          g.fillStyle = '#c62828';
          g.font = 'bold 34px Inter, Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('DANGER WEIR', 128, 50);
        }),
      ),
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const fs = frame(h.s - 30, side * (edgeAt(t, h.s - 30, side).lim + 2.5));
      const sign = new THREE.Mesh(geo.plane, board);
      sign.scale.set(4, 1.5, 1);
      sign.position.set(fs.x, 2.6, fs.z);
      sign.rotation.y = fs.h + Math.PI;
      scene.add(sign);
      weirKit.place(fs.x, 0, fs.z, fs.h);
      for (const sd of [-1, 1]) weirKit.box(0x47505a, sd * 1.6, 1, 0, 0.14, 2, 0.14);
    }
  }
  weirKit.place();
  if (weirKit.count()) scene.add(weirKit.build(vcSet, vcSetLit));
  // the spray off the boil
  const BOIL = 40;
  const boilMesh = boils.length ? new THREE.InstancedMesh(blob, new THREE.MeshBasicMaterial({ color: 0xf4f8f8, transparent: true, opacity: 0.75, depthWrite: false }), boils.length * BOIL) : null;
  if (boilMesh) {
    boilMesh.frustumCulled = false;
    boilMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(boilMesh);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // What the shells leave on the water: a puddle where each blade comes out at the finish of the stroke (they spread
  // and fade), and a narrow V of wake off the stern; and the chain ferry's wash as it crosses. All of it additive, so a
  // color fading to black is a fade.
  const ringTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 8, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,0.0)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
      grad.addColorStop(0.8, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  const PUDDLES = 64;
  const PUDDLE_T = 2.2;
  const puddleGeo = new THREE.PlaneGeometry(1, 1);
  puddleGeo.rotateX(-Math.PI / 2);
  const puddleMesh = new THREE.InstancedMesh(puddleGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: ADDITIVE }), PUDDLES);
  puddleMesh.frustumCulled = false;
  puddleMesh.renderOrder = 2;
  puddleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const puddles = Array.from({ length: PUDDLES }, () => ({ x: 0, z: 0, born: -99 }));
  let nextPuddle = 0;
  const lastPhase = new Map<number, number>();
  const black = new THREE.Color(0, 0, 0);
  for (let n = 0; n < PUDDLES; n++) puddleMesh.setColorAt(n, black);
  scene.add(puddleMesh);
  // the V off a stern: a strip that fades out along its length
  const vTex = texture(
    THREE,
    canvas(16, 64, (g) => {
      // (bright at the stern, the bottom of the canvas, fading out behind, and soft at its edges)
      const img = g.createImageData(16, 64);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 16; x++) {
          const o = (y * 16 + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
          img.data[o + 3] = Math.round(255 * 0.85 * (y / 63) ** 1.5 * Math.sin((Math.PI * (x + 0.5)) / 16) ** 2);
        }
      }
      g.putImageData(img, 0, 0);
    }),
  );
  const armGeo = new THREE.PlaneGeometry(1, 1);
  armGeo.rotateX(-Math.PI / 2);
  // (from its end at the stern out along local -z)
  armGeo.translate(0, 0, -0.5);
  const ARMS = 2 * r.karts.length + 2 * ferries.length;
  const armMesh = new THREE.InstancedMesh(armGeo, new THREE.MeshBasicMaterial({ map: vTex, transparent: true, depthWrite: false, blending: ADDITIVE, side: THREE.DoubleSide }), ARMS);
  armMesh.frustumCulled = false;
  armMesh.renderOrder = 2;
  armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let n = 0; n < ARMS; n++) armMesh.setColorAt(n, black);
  scene.add(armMesh);
  const tint = new THREE.Color();
  const armAt = (n: number, x: number, z: number, h: number, len: number, w: number, k: number) => {
    dummy.position.set(x, 0.075, z);
    dummy.rotation.set(0, h, 0);
    dummy.scale.set(w, 1, len);
    dummy.updateMatrix();
    armMesh.setMatrixAt(n, dummy.matrix);
    armMesh.setColorAt(n, tint.setScalar(Math.max(0, Math.min(1, k))));
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The last lap's fog: banks of mist lying on the water and drifting over the marsh, thicker in some places than
  // others, wrapping round wherever you are (one instanced draw)
  const MIST = 44;
  const mistTex = texture(
    THREE,
    canvas(128, 64, (g) => {
      const r3 = scatter(61);
      for (let i = 0; i < 26; i++) {
        const x = 20 + r3() * 88;
        const y = 22 + r3() * 26;
        const rad = 10 + r3() * 18;
        const grad = g.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, 'rgba(255,255,255,0.38)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 64);
      }
    }),
  );
  const mistMat = new THREE.MeshBasicMaterial({ map: mistTex, color: new THREE.Color(look.fogLap?.color ?? 0xd8d4cc), transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const mist = look.fogLap ? new THREE.InstancedMesh(geo.plane, mistMat, MIST) : null;
  const mistAt = Array.from({ length: MIST }, (_, n) => ({ x: ((n * 97.3) % 200) - 100, z: ((n * 61.7) % 200) - 100, w: 26 + ((n * 13) % 30), h: 5 + ((n * 7) % 7), y: 1.5 + ((n * 3) % 4) * 0.8 }));
  let mistIn = 0;
  if (mist) {
    mist.frustumCulled = false;
    mist.visible = false;
    mist.renderOrder = 4;
    mist.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(flat(mist));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The reflection: the scene drawn again from a camera mirrored under the water (clipped at the surface) into a texture
  // the water samples where each point of it would see itself, nudged by its ripples
  const rt = new THREE.WebGLRenderTarget(4, 4);
  const virt = new THREE.PerspectiveCamera();
  virt.layers.set(0);
  const v3 = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
  const size = new THREE.Vector2();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const clip = new THREE.Plane();
  shared.tRefl.value = rt.texture;
  const reflect = (renderer: T.WebGLRenderer, sc: T.Scene, camera: T.PerspectiveCamera) => {
    camera.layers.enable(FLAT);
    renderer.getDrawingBufferSize(size);
    // (a phone's small screen gets a coarser reflection: it is blurred by the ripples anyway)
    const res = Math.min(size.x, size.y) < 900 ? REFLECT_RES * 0.7 : REFLECT_RES;
    const w = Math.max(16, Math.round(size.x * res));
    const h = Math.max(16, Math.round(size.y * res));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    camera.updateMatrixWorld();
    // (the camera's position and where it looks, mirrored in the plane y = WATER_Y)
    const cam = v3.a.setFromMatrixPosition(camera.matrixWorld);
    if (cam.y <= WATER_Y + 0.05) {
      shared.uReflOn.value = 0;
      return;
    }
    const look = v3.b.set(0, 0, -1).transformDirection(camera.matrixWorld).add(cam);
    virt.position.set(cam.x, 2 * WATER_Y - cam.y, cam.z);
    const up = v3.c.set(0, 1, 0).transformDirection(camera.matrixWorld);
    virt.up.set(up.x, -up.y, up.z);
    virt.lookAt(look.x, 2 * WATER_Y - look.y, look.z);
    virt.far = camera.far;
    virt.updateMatrixWorld();
    virt.projectionMatrix.copy(camera.projectionMatrix);
    shared.uReflM.value.copy(bias).multiply(virt.projectionMatrix).multiply(virt.matrixWorldInverse);
    // (an oblique near plane at the water's surface, so nothing under it shows)
    clip.set(v3.a.set(0, 1, 0), -WATER_Y + 0.02);
    clip.applyMatrix4(virt.matrixWorldInverse);
    const e = virt.projectionMatrix.elements;
    const qx = (Math.sign(clip.normal.x) + e[8]) / e[0];
    const qy = (Math.sign(clip.normal.y) + e[9]) / e[5];
    const qz = -1;
    const qw = (1 + e[10]) / e[14];
    const k = 2 / (clip.normal.x * qx + clip.normal.y * qy + clip.normal.z * qz + clip.constant * qw);
    e[2] = clip.normal.x * k;
    e[6] = clip.normal.y * k;
    e[10] = clip.normal.z * k + 1;
    e[14] = clip.constant * k;
    virt.projectionMatrixInverse.copy(virt.projectionMatrix).invert();
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(sc, virt);
    renderer.setRenderTarget(was);
    shared.uReflOn.value = 1;
  };

  return {
    reflect,
    dispose() {
      rt.dispose();
      shared.tNormal.value.dispose();
    },
    tick(race, me, clock, dt) {
      const lap = race.karts[me]?.lap ?? 1;
      // the fog's lap: the lamps and the lip of the marsh shine through it
      const fogNow = !!look.fogLap && lap >= look.fogLap.lap;
      if (fogNow !== fogLit) {
        fogLit = fogNow;
        for (const m of lit) {
          m.fog = !fogNow;
          m.needsUpdate = true;
        }
        if (buoyLamps) buoyLamps.visible = fogNow;
        for (const b of brinks) b.visible = fogNow;
      }
      // the currents run in the water (the other way once the tide has turned)
      for (const run of runs) {
        let along = 0;
        for (const f of race.flows) {
          if (deltaS(t, f.s0, run.s) < 0 || deltaS(t, run.s, f.s1) < 0) continue;
          along = f.tide && lap >= TIDE_LAP ? -f.along : f.along;
        }
        // (and the still water just drifts)
        run.u.value = (run.u.value + (along || 0.15) * dt) % 4000;
        run.streak.value = damp(run.streak.value, Math.min(1, Math.abs(along) / 1.5), 2, dt);
      }
      shared.uTime.value = clock;
      if (mist && look.fogLap) {
        mistIn = damp(mistIn, lap >= look.fogLap.lap ? 1 : 0, 0.6, dt);
        mist.visible = mistIn > 0.01;
        const k = race.karts[me];
        if (mist.visible && k) {
          mistMat.opacity = 0.75 * mistIn;
          mistAt.forEach((m, n) => {
            // (fixed in the world but drifting on the breeze, each wrapped into a 200 m square round you)
            const wx = m.x + clock * 1.2;
            const wz = m.z + clock * 0.5;
            const x = k.x + ((((wx - k.x) % 200) + 300) % 200) - 100;
            const z = k.z + ((((wz - k.z) % 200) + 300) % 200) - 100;
            // (thinning out right round you, so it never blinds the view)
            const near = Math.min(1, Math.max(0.15, (Math.hypot(x - k.x, z - k.z) - 6) / 30));
            dummy.position.set(x, m.y, z);
            dummy.rotation.set(0, k.h + Math.PI + Math.sin(n) * 0.4, 0);
            dummy.scale.set(m.w * near, m.h * near, 1);
            dummy.updateMatrix();
            mist.setMatrixAt(n, dummy.matrix);
          });
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          mist.instanceMatrix.needsUpdate = true;
        }
      }
      {
        const k = race.karts[me];
        plants.tick(clock, k ? windAt(race, k.s, race.time, lap) * 0.02 : 0);
      }
      shared.uLap.value = lap;
      for (const tg of tongues) {
        const v = tg.f.tide && lap >= TIDE_LAP ? -tg.f.tongue![2] : tg.f.tongue![2];
        tg.tex.offset.y = (tg.tex.offset.y - (v * dt) / 5) % 1;
      }
      for (const tex of pours) tex.offset.y = (tex.offset.y + dt * 2.4) % 1;
      if (traffic) {
        const { body, cab, road, len } = traffic;
        const total = len[len.length - 1];
        let seg = 0;
        // (where a car is, `u` meters along the road from its inner end: the point, the heading, the width and height)
        const along = (u: number) => {
          while (seg > 0 && len[seg] > u) seg--;
          while (seg < len.length - 2 && len[seg + 1] < u) seg++;
          const a = road[seg];
          const b = road[seg + 1];
          const k = Math.min(1, Math.max(0, (u - len[seg]) / (len[seg + 1] - len[seg] || 1)));
          return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: Math.atan2(b.x - a.x, b.z - a.z) };
        };
        for (let n = 0; n < CARS; n++) {
          const lane = n % 8;
          const dir = lane < 4 ? 1 : -1;
          const speed = 24 + (lane % 4) * 3;
          const u = (((clock * speed * dir + n * 61.3) % total) + total) % total;
          seg = 0;
          const p = along(u);
          // (four lanes each way across the full deck, two each way on the narrow flyover)
          const narrow = p.w < 30;
          const lz = narrow ? (lane < 4 ? -1 : 1) * (1.8 + (lane % 2) * 3.4) : (lane < 4 ? -1 : 1) * (2.2 + (lane % 4) * 3.5);
          const truck = n % 9 === 0;
          const lenCar = truck ? 9 : 4.3;
          const px = p.x + Math.cos(p.h) * lz;
          const pz = p.z - Math.sin(p.h) * lz;
          const fx = Math.sin(p.h) * dir;
          const fz = Math.cos(p.h) * dir;
          dummy.position.set(px, p.y + 1.05 + (truck ? 0.8 : 0), pz);
          dummy.rotation.set(0, p.h, 0);
          dummy.scale.set(1.8, truck ? 2.6 : 0.9, lenCar);
          dummy.updateMatrix();
          body.setMatrixAt(n, dummy.matrix);
          const off = truck ? 3.3 : -0.2;
          dummy.position.set(px + fx * off, p.y + (truck ? 1.45 : 1.75), pz + fz * off);
          dummy.scale.set(1.7, truck ? 1.8 : 0.6, 2.2);
          dummy.updateMatrix();
          cab.setMatrixAt(n, dummy.matrix);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        body.instanceMatrix.needsUpdate = true;
        cab.instanceMatrix.needsUpdate = true;
      }
      if (boilMesh) {
        boils.forEach((b, n) => {
          for (let j = 0; j < BOIL; j++) {
            const life = (clock * (0.9 + (j % 5) * 0.12) + j * 0.618) % 1;
            const across = ((j * 0.377) % 1) - 0.5;
            const fwd = 0.5 + life * 3 + ((j * 0.71) % 1) * 2;
            dummy.position.set(b.x + Math.cos(b.h) * across * b.w + b.tx * fwd, 0.15 + Math.sin(life * Math.PI) * (0.8 + (j % 3) * 0.4), b.z - Math.sin(b.h) * across * b.w + b.tz * fwd);
            dummy.scale.setScalar(0.12 + 0.22 * (1 - life));
            dummy.updateMatrix();
            boilMesh.setMatrixAt(n * BOIL + j, dummy.matrix);
          }
        });
        dummy.scale.setScalar(1);
        boilMesh.instanceMatrix.needsUpdate = true;
      }
      for (const tex of stoppers) {
        tex.offset.y = (tex.offset.y + dt * 1.6) % 1;
        tex.offset.x = Math.sin(clock * 3) * 0.05;
      }
      // the gates swing on their hinges as their state says
      for (const g of gates) {
        const h = race.hazards[g.i];
        const st = hazState(race, h, race.time, lap);
        g.lift = st.phase === 'off' || st.phase === 'idle' ? damp(g.lift, 0, 5, dt) : st.lift;
        const a = (1 - g.lift) * (Math.PI / 2) * 0.95;
        const dx = g.shut[0] * Math.cos(a) + g.open[0] * Math.sin(a);
        const dz = g.shut[1] * Math.cos(a) + g.open[1] * Math.sin(a);
        g.leaf.position.set(g.hinge.x + (dx * g.w) / 2, 0.55, g.hinge.z + (dz * g.w) / 2);
        g.leaf.rotation.y = headingOf(dx, dz);
        const c = st.phase === 'off' ? lampColor.dim : st.solid ? lampColor.shut : st.warn > 0 && Math.floor(clock * 8) % 2 === 0 ? lampColor.warn : st.warn > 0 ? lampColor.dim : lampColor.open;
        g.lampMat.color.copy(c);
      }
      // the swing span: parked along the channel before its lap, sweeping round on the clock after
      for (const sv of swings) {
        const h = race.hazards[sv.i];
        const st = hazState(race, h, race.time, lap);
        sv.ang = st.live ? st.ang : dampAngle(sv.ang, 0, 2, dt);
        sv.g.rotation.y = sv.f.h - sv.ang;
      }
      // the foam round the rocks, pulsing as the current piles up on them and streams off
      if (rockFoam) {
        rocks.forEach((h, n) => {
          const p = pointAt(t, h.s, h.d);
          for (let j = 0; j < 3; j++) {
            const life = (clock * 0.7 + j / 3 + n * 0.29) % 1;
            // (each ring spreads and drifts off downstream, fading, as the next forms at the rock's foot)
            const down = life * 2.2;
            dummy.position.set(p.x + p.tx * down, 0.075 + j * 0.002, p.z + p.tz * down);
            dummy.scale.set(h.r * (1.15 + life * 0.9), 1, h.r * (1.15 + life * 1.6));
            dummy.rotation.set(0, headingOf(p.tx, p.tz), 0);
            dummy.updateMatrix();
            rockFoam.setMatrixAt(n * 3 + j, dummy.matrix);
            rockFoam.setColorAt(n * 3 + j, tint.setScalar(0.75 * (1 - life) ** 1.3));
          }
        });
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        rockFoam.instanceMatrix.needsUpdate = true;
        if (rockFoam.instanceColor) rockFoam.instanceColor.needsUpdate = true;
      }
      // the Port crane's load swinging on its hoist (and hoisted clear for a launch going through)
      for (const cv of cranes) {
        const h = race.hazards[cv.i];
        const st = hazState(race, h, race.time, lap);
        cv.lift = damp(cv.lift, st.lift, 4, dt);
        const sw = st.d - h.d;
        const y = CRANE_PIVOT - Math.sqrt(Math.max(0, CRANE_ROPE * CRANE_ROPE - sw * sw)) + cv.lift * 4;
        // (the rope from the jib head down to the hook block, and the load hanging square to it)
        const up = CRANE_PIVOT - y;
        const len = Math.hypot(sw, up) || 0.01;
        const tilt = Math.atan2(-sw, up);
        const c = Math.cos(cv.f.h);
        const sn = Math.sin(cv.f.h);
        const at = (d: number) => [cv.f.x - d * c, cv.f.z + d * sn] as const;
        const [lx, lz] = at(st.d);
        cv.load.position.set(lx, y, lz);
        cv.load.rotation.set(0, cv.f.h, tilt, 'YXZ');
        const top = h.r + 0.9;
        const rope = Math.max(0.05, len - top);
        const mid = top + rope / 2;
        const [mx, mz] = at(st.d - (sw / len) * mid);
        cv.cable.position.set(mx, y + (up / len) * mid, mz);
        cv.cable.rotation.set(0, cv.f.h, tilt, 'YXZ');
        cv.cable.scale.set(0.07, rope, 0.07);
        cv.shade.position.set(lx, 0.07, lz);
        cv.shade.scale.setScalar(h.r * 2.4);
        cv.shadeMat.opacity = 0.42 * Math.max(0, 1 - (y - h.r) / 6);
      }
      // the whirlpools: where each is and how far it has formed, for the water shader, and the spray off the rim
      for (let n = 0; n < WHIRLS; n++) shared.uWhirlA.value[n].z = 0;
      for (const w of whirls) {
        const st = hazState(race, w.h, race.time, lap);
        const p = pointAt(t, w.h.s, st.d);
        const k = st.live ? st.lift : 0;
        const spin = w.h.spin ?? 1;
        // (turning the way it pulls you round: see whirlPull)
        w.a += spin * dt * (st.live ? 1.2 + 3 * k : st.warn > 0 ? 1.2 * st.warn : 0.15);
        const size = (w.h.pull ?? 7) * (0.55 + 0.35 * Math.max(k, st.warn * 0.7));
        shared.uWhirlA.value[w.n].set(p.x, p.z, st.phase === 'off' && !st.live ? 0 : size);
        shared.uWhirlB.value[w.n].set(st.live ? 0.25 + 0.75 * k : 0, w.a, spin);
        shared.uWhirlC.value[w.n].set((w.h.core ?? 1.3) * (0.4 + 0.9 * k) * (st.live ? 1 : 0), st.warn, 0);
        w.ring.position.set(p.x, w.ring.position.y, p.z);
        // (a faint still ring marks it before its lap, and a brighter one while it warns)
        w.ringMat.opacity = st.phase === 'off' ? 0.18 : st.warn > 0 ? 0.35 + 0.5 * st.warn * (Math.floor(clock * 6) % 2 ? 1 : 0.6) : st.live ? 0.35 : 0.22;
        if (spray) {
          for (let j = 0; j < SPRAY; j++) {
            const ang = -spin * (clock * (2.2 + (j % 3) * 0.7)) + (j / SPRAY) * Math.PI * 2;
            const rad = size * (0.35 + 0.25 * ((j * 7) % 5) / 5);
            const life = (clock * 1.3 + j * 0.37) % 1;
            dummy.position.set(p.x + Math.cos(ang) * rad, 0.1 + Math.sin(life * Math.PI) * 0.9 * k, p.z + Math.sin(ang) * rad);
            dummy.scale.setScalar(k > 0.05 ? (0.06 + 0.1 * (1 - life)) * k : 0);
            dummy.updateMatrix();
            spray.setMatrixAt(w.n * SPRAY + j, dummy.matrix);
          }
        }
      }
      if (spray) {
        dummy.scale.setScalar(1);
        spray.instanceMatrix.needsUpdate = true;
      }
      // the vessels, where they are on the clock, with their wakes spreading behind them
      for (const v of vessels) {
        const h = v.h;
        v.g.visible = !h.gone;
        if (v.wake) v.wake.visible = !h.gone;
        if (h.gone) continue;
        v.g.position.set(h.x, Math.sin(clock * 1.7 + h.s) * 0.05, h.z);
        v.g.rotation.y = headingOf(h.tx, h.tz);
        if (v.roll) v.roll.rotation.z = clock * 0.6;
        if (v.wakePos) {
          const len = lengthOf(h);
          for (let arm = 0; arm < 2; arm++) {
            const sg = arm ? 1 : -1;
            for (let k = 0; k <= WAKE_N; k++) {
              const a = (k / WAKE_N) * WAKE_LEN;
              const s = h.along - len / 2 - a;
              const off = h.r + WAKE_SPREAD * a;
              const wdt = 0.1 + 0.3 * (1 - a / WAKE_LEN) * (h.wake ?? 0.5);
              const p0 = pointAt(t, s, h.at + sg * (off - wdt));
              const p1 = pointAt(t, s, h.at + sg * (off + wdt));
              const o = (arm * (WAKE_N + 1) + k) * 2;
              v.wakePos.setXYZ(o, p0.x, 0.065, p0.z);
              v.wakePos.setXYZ(o + 1, p1.x, 0.065, p1.z);
            }
          }
          v.wakePos.needsUpdate = true;
        }
      }
      for (const f of ferries) {
        f.g.position.set(f.h.x, Math.sin(clock * 1.3) * 0.04, f.h.z);
      }
      // the shells' puddles and wakes, and the ferry's wash
      race.karts.forEach((k, n) => {
        const under = k.sunk === 0 && k.y < 0.3 && k.bullet <= 0;
        const sp = Math.abs(k.v);
        // (a narrow V off the stern, longer and brighter the faster it goes)
        const sx = k.x - Math.sin(k.h) * 2.4;
        const sz = k.z - Math.cos(k.h) * 2.4;
        const len = 2 + sp * 0.3;
        // (your own, right under the camera, only faintly)
        for (const sg of [-1, 1]) armAt(2 * n + (sg > 0 ? 1 : 0), sx, sz, k.h + sg * 0.16, len, 0.4, under && sp > 4 ? Math.min(0.3, sp / 90) * (n === me ? 0.5 : 1) : 0);
        // (the puddles: at each finish, where the blades come out)
        const phase = strokeAt(race.time - (n === me ? 0 : n * 0.04));
        const was = lastPhase.get(n) ?? phase;
        lastPhase.set(n, phase);
        if (!(was < 0.38 && phase >= 0.38) || !under || sp < 3 || k.drift !== 0 || k.spin > 0) return;
        const cam = race.karts[me];
        if (cam && Math.hypot(cam.x - k.x, cam.z - k.z) > 90) return;
        for (const side of [-1, 1]) {
          // (only on the water, not out on the mud)
          if (Math.abs(k.d - side * 2.9) > roadEdge(t, k.s, k.d - side * 2.9 >= 0 ? 1 : -1) - 0.3) continue;
          const lx = side * 2.9;
          const lz = -1.3;
          const p = puddles[nextPuddle];
          p.x = k.x + Math.cos(k.h) * lx + Math.sin(k.h) * lz;
          p.z = k.z - Math.sin(k.h) * lx + Math.cos(k.h) * lz;
          p.born = clock;
          nextPuddle = (nextPuddle + 1) % PUDDLES;
        }
      });
      // (and the ferry's wash, a short V trailing it the way it has come across)
      ferries.forEach((f, n) => {
        const v = hazardV(f.h, race.time);
        const p = pointAt(t, f.h.s);
        const nx = -p.tz * Math.sign(v || 1);
        const nz = p.tx * Math.sign(v || 1);
        const h = headingOf(nx, nz);
        for (const sg of [-1, 1]) armAt(2 * race.karts.length + n * 2 + (sg > 0 ? 1 : 0), f.h.x - nx * f.h.r, f.h.z - nz * f.h.r, h + sg * 0.5, 2 + Math.abs(v) * 1.6, 0.7, Math.min(0.7, Math.abs(v) / 3));
      });
      armMesh.instanceMatrix.needsUpdate = true;
      if (armMesh.instanceColor) armMesh.instanceColor.needsUpdate = true;
      for (let n = 0; n < PUDDLES; n++) {
        const p = puddles[n];
        const age = clock - p.born;
        if (age > PUDDLE_T) {
          puddleMesh.setColorAt(n, black);
          dummy.scale.setScalar(0);
        } else {
          puddleMesh.setColorAt(n, tint.setScalar(0.2 * (1 - age / PUDDLE_T) ** 1.5));
          dummy.scale.setScalar(0.35 + age * 0.45);
        }
        dummy.position.set(p.x, 0.07, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        puddleMesh.setMatrixAt(n, dummy.matrix);
      }
      dummy.scale.setScalar(1);
      puddleMesh.instanceMatrix.needsUpdate = true;
      if (puddleMesh.instanceColor) puddleMesh.instanceColor.needsUpdate = true;
      if (buoyMesh && bandMesh) {
        buoys.forEach((h, n) => {
          const bob = Math.sin(clock * 2.2 + n * 1.3) * 0.08;
          dummy.position.set(h.x, 0.25 + bob, h.z);
          dummy.scale.set(h.r * 1.4, h.r * 1.7, h.r * 1.4);
          dummy.updateMatrix();
          buoyMesh.setMatrixAt(n, dummy.matrix);
          dummy.position.y = 0.35 + bob;
          dummy.scale.set(h.r * 1.45, 0.12, h.r * 1.45);
          dummy.updateMatrix();
          bandMesh.setMatrixAt(n, dummy.matrix);
          if (buoyLamps?.visible) {
            dummy.position.y = 0.72 + bob;
            dummy.scale.setScalar(0.13 + 0.03 * Math.sin(clock * 5 + n));
            dummy.updateMatrix();
            buoyLamps.setMatrixAt(n, dummy.matrix);
          }
        });
        buoyMesh.instanceMatrix.needsUpdate = true;
        bandMesh.instanceMatrix.needsUpdate = true;
        if (buoyLamps) buoyLamps.instanceMatrix.needsUpdate = true;
      }
      // the swell's crests (as this screen's shell's lap has them)
      if (r.swells.length) {
        let c = 0;
        for (const sw of race.swells) {
          if (lap < (sw.lap ?? 1) || lap > (sw.until ?? Infinity)) continue;
          const dir = sw.dir ?? -1;
          for (const d of crestsAt(race, sw, race.time)) {
            if (c >= CRESTS) break;
            // (taller as it gathers over the channel, and ragged along its length)
            const gather = 0.55 + 0.45 * (1 - Math.min(1, Math.abs(d) / 25));
            for (let k = 0; k <= crestPts; k++) {
              const s = sw.s0 + 4 + ((sw.s1 - sw.s0 - 8) * k) / crestPts;
              const rag = 1 + 0.25 * Math.sin(k * 2.3 + clock * 3) + 0.12 * Math.sin(k * 5.1 - clock * 5);
              RIDGE.forEach(([off, y], j) => {
                const p = pointAt(t, s, d + dir * off * (0.8 + 0.4 * gather));
                crestPos.setXYZ((c * (crestPts + 1) + k) * R + j, p.x, 0.04 + y * gather * rag, p.z);
              });
            }
            c++;
          }
        }
        // (the rest folded away)
        for (; c < CRESTS; c++) for (let k = 0; k <= crestPts; k++) for (let j = 0; j < R; j++) crestPos.setXYZ((c * (crestPts + 1) + k) * R + j, 0, -10, 0);
        crestPos.needsUpdate = true;
        crestGeo.computeVertexNormals();
      }
    },
  };
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampAngle = (a: number, b: number, k: number, dt: number) => {
  let d = b - a;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
};

/**
 * Hwy 101's line across the slough: from its crossing at (x, z), out both ways along (dx, dz) and its opposite, on piers,
 * each end steering gently round any other stretch of the channel and anything tall in `avoid`. The end heading out of
 * the course bends away from it, off into the distance; the end inside the loop of the channel (which it could only
 * leave by crossing the channel again) keeps to the middle of the marsh, as far from the water as it can. Each end is
 * a list of points `step` apart from the crossing, and whether it heads out.
 */
export function highwayLine(t: Track, x: number, z: number, dx: number, dz: number, half: number, avoid: { x: number; z: number; r: number }[], far = 1100, inner = 320, step = 8, innerHalf = 7) {
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < t.n; i++) {
    cx += t.x[i] / t.n;
    cz += t.z[i] / t.n;
  }
  /** How far the deck (its whole width) is from the water past any brink, and from everything to avoid (or < 0 in it). */
  const room = (px: number, pz: number, hx: number, hz: number, w = half) => {
    let r = Infinity;
    for (const o of [-w - 2, 0, w + 2]) {
      const qx = px - hz * o;
      const qz = pz + hx * o;
      const at = locate(t, qx, qz);
      const side = at.d >= 0 ? 1 : -1;
      r = Math.min(r, Math.abs(at.d) - edgeAt(t, at.s, side).lim);
      for (const a of avoid) r = Math.min(r, Math.hypot(qx - a.x, qz - a.z) - a.r);
    }
    return r;
  };
  // (inside the loop, it makes for the middle of the marsh there: the spot furthest from any water)
  let goal = { x: cx, z: cz, room: -Infinity };
  for (let gx = -300; gx <= 300; gx += 12) {
    for (let gz = -300; gz <= 300; gz += 12) {
      const qx = cx + gx;
      const qz = cz + gz;
      let inside = false;
      for (let i = 0, j = t.n - 1; i < t.n; j = i++) if (t.z[i] > qz !== t.z[j] > qz && qx < ((t.x[j] - t.x[i]) * (qz - t.z[i])) / (t.z[j] - t.z[i]) + t.x[i]) inside = !inside;
      if (!inside) continue;
      const rm = room(qx, qz, 1, 0, 0);
      if (rm > goal.room) goal = { x: qx, z: qz, room: rm };
    }
  }
  return [1, -1].map((sg) => {
    const pts: { x: number; z: number }[] = [{ x, z }];
    let h = Math.atan2(sg * dx, sg * dz);
    const out = ((x - cx) * Math.sin(h) + (z - cz) * Math.cos(h)) > 0;
    const len = out ? far : inner;
    let px = x;
    let pz = z;
    for (let n = 0; n * step < len; n++) {
      const run = (n + 1) * step;
      let best: number | null = null;
      let bestScore = -Infinity;
      for (let k = -8; k <= 8; k++) {
        // (straight out over its own crossing, then picking its way: gently out on the open marsh, harder inside the loop)
        const th = run < 24 ? h : h + k * (out ? 0.016 : 0.05);
        const hx = Math.sin(th);
        const hz = Math.cos(th);
        let clear = Infinity;
        // (looking a few spans on, still turning as it is, so it never turns into a corner it cannot get out of)
        if (run >= 24) {
          let ax = px;
          let az = pz;
          for (let ahead = 0; ahead < 4; ahead++) {
            const ta = th + (th - h) * ahead;
            ax += Math.sin(ta) * step;
            az += Math.cos(ta) * step;
            clear = Math.min(clear, room(ax, az, Math.sin(ta), Math.cos(ta), out ? half : innerHalf));
          }
        }
        if (clear < 5) continue;
        const nx = px + hx * step - cx;
        const nz = pz + hz * step - cz;
        const away = (nx * hx + nz * hz) / (Math.hypot(nx, nz) || 1);
        const gx = goal.x - (px + hx * step);
        const gz = goal.z - (pz + hz * step);
        const toward = (gx * hx + gz * hz) / (Math.hypot(gx, gz) || 1);
        const score = -Math.abs(k) * (out ? 0.25 : 0.04) + (out ? (run > 60 ? away * 2 : 0) : toward * 3);
        if (score > bestScore) {
          bestScore = score;
          best = th;
        }
        if (run < 24) break;
      }
      if (best === null) break;
      // (inside, it stops once it is there)
      if (!out && Math.hypot(goal.x - px, goal.z - pz) < 24) break;
      h = best;
      px += Math.sin(h) * step;
      pz += Math.cos(h) * step;
      pts.push({ x: px, z: pz });
    }
    return { pts, out };
  });
}
