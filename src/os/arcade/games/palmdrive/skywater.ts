// Open water on the road courses (Lake Lagunita, the pools past the lip, the fountains' basins): small wind ripples
// drifting over it, the sky mirrored in it (more of it the flatter you look across the water), the sun's glitter, and
// the water's own color looking down into it. Redwood Slough's channel, with its reflections, is water.ts.
import type { SkyLook } from './sky';
import { canvas, scatter } from './scenery';

type Three = typeof import('three');

/** A tiling normal map of ripples: a few octaves of wrapping value noise and wave trains, its normals from its slopes. */
function ripples(THREE: Three) {
  const N = 128;
  const h = new Float32Array(N * N);
  const rnd = scatter(57);
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
  octave(8, 0.5);
  octave(16, 0.28);
  for (const [kx, ky, amp] of [[3, 5, 0.3], [-4, 6, 0.24], [7, -2, 0.15], [9, 11, 0.08]]) {
    const ph = rnd() * Math.PI * 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] += amp * (1 - Math.abs(Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + ph)));
  }
  const c = canvas(N, N, (g) => {
    const img = g.createImageData(N, N);
    const H = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * 1.6;
        const dy = (H(x, y + 1) - H(x, y - 1)) * 1.6;
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
  tex.anisotropy = 4;
  return tex;
}

/** The time for every sheet of it (set once a frame). */
const clock = { value: 0 };
export function waterTick(t: number) {
  clock.value = t;
}

/** A material for open water under the sky `s`; deep and shallow are its own colors (deep looking straight down). */
export function skyWater(THREE: Three, s: SkyLook, deep: number, shallow: number) {
  const col = (hex: number) => ({ value: new THREE.Color(hex) });
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      uTime: clock,
      uSun: { value: new THREE.Vector3(...s.sun).normalize() },
      uSunCol: col(s.sunColor),
      uZenith: col(s.zenith),
      uMid: col(s.mid),
      uLow: col(s.low),
      uHorizon: col(s.horizon),
      uDeep: col(deep),
      uShallow: col(shallow),
      uMoon: { value: s.moon ? 1 : 0 },
      tNormal: { value: ripples(THREE) },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
      fogDensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uMoon;
      uniform vec3 uSun, uSunCol, uZenith, uMid, uLow, uHorizon, uDeep, uShallow;
      uniform sampler2D tNormal;
      varying vec3 vW;
      #include <fog_pars_fragment>
      vec2 rip(vec2 p) { return texture2D(tNormal, p).xy * 2.0 - 1.0; }
      void main() {
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vW.xz;
        vec2 n = rip(p * 0.05 + uTime * vec2(0.012, 0.007)) * 0.6 + rip(p * 0.16 - uTime * vec2(0.014, 0.019)) * 0.4;
        // (calmer with distance, where the ripples would only shimmer)
        n *= mix(1.0, 0.3, smoothstep(15.0, 180.0, dist));
        vec3 N = normalize(vec3(n.x * 0.32, 1.0, n.y * 0.32));
        vec3 R = reflect(-V, N);
        float h = abs(R.y);
        vec3 sky = mix(uHorizon, uLow, smoothstep(0.02, 0.18, h));
        sky = mix(sky, uMid, smoothstep(0.14, 0.45, h));
        sky = mix(sky, uZenith, smoothstep(0.4, 1.0, h));
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 body = mix(uDeep, uShallow, 0.3 + 0.25 * n.x);
        vec3 c = mix(body, sky, clamp(0.15 + 0.75 * fres, 0.0, 0.82));
        float m = max(dot(R, uSun), 0.0);
        c += uSunCol * (pow(m, 220.0) * mix(3.0, 1.2, uMoon) + pow(m, 24.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}
