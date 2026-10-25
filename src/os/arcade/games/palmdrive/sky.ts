// The sky and the light for the courses raced on the road (Redwood Slough has its own dawn: see scenery.ts): a dome
// round the camera with the time of day's gradient, the sun (or the moon) and its glow, clouds and, after dark, stars;
// hills on the horizon in layers of haze; and the sun, the sky light and the fog matched to it, with the sun's shadows
// following the camera where the screen can afford them.
import type { T } from './gl';
import type { CourseId } from './courses';
import { GLSL_NOISE, canvas, scatter, texture } from './scenery';

type Three = typeof import('three');

/** How much a screen can afford: shadows, the denser grass and the second layer of clouds only on 'high'. */
export type Quality = 'high' | 'low';

/** Small or touch screens (and anything with few cores) draw less. */
export function qualityOf(host: HTMLElement): Quality {
  const w = host.clientWidth || window.innerWidth;
  const h = host.clientHeight || window.innerHeight;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 8;
  return w * h < 520000 || coarse || cores <= 2 ? 'low' : 'high';
}

export type SkyLook = {
  /** A unit vector toward the sun (or the moon after dark). */
  sun: [number, number, number];
  zenith: number;
  mid: number;
  low: number;
  /** The horizon all round, and under the sun. The fog is the horizon's color, so the far distance melts into it. */
  horizon: number;
  glowHorizon: number;
  sunColor: number;
  /** The sun's light on the ground, and how bright; the sky light from above and the ground's bounce. */
  light: [number, number];
  hemi: [number, number, number];
  /** How much of the sky the clouds cover (0 to 1), their sunlit and shaded colors, and high cirrus (0 to 1). */
  clouds: number;
  cloudLit: number;
  cloudShade: number;
  cirrus: number;
  /** Stars after dark (0 to 1), and a moon's disc rather than the sun's. */
  stars?: number;
  moon?: boolean;
  /** How big the sun's disc looks (its cosine: nearer 1 is smaller). */
  disc?: number;
  /** The hills on the horizon: the far range, the middle and the near foothills (rgb), and their lit rim. */
  hills: [[number, number, number], [number, number, number], [number, number, number]];
  /** Where the hills rise highest (radians round from +z), and how tall overall. */
  hillsAt?: number;
  hillsTall?: number;
  /** Shadows from the sun on the ground (off over the sky road). */
  shadows?: boolean;
  /** How dark the shadows are (the share of the sun's light they take away is set by the sky light). */
};

/** Each road course's time of day. */
export const SKIES: Partial<Record<CourseId, SkyLook>> = {
  // a clear California late morning, a few fair-weather cumulus over the foothills
  palm: { sun: [0.42, 0.62, -0.66], zenith: 0x2a5fb4, mid: 0x5f95d8, low: 0xa9c9ea, horizon: 0xe6dccb, glowHorizon: 0xf3e2c4, sunColor: 0xfff0d0, light: [0xfff1d8, 1.65], hemi: [0xcfe2ff, 0x6e7a4a, 0.95], clouds: 0.32, cloudLit: 0xffffff, cloudShade: 0xa9b4c8, cirrus: 0.35, hills: [[150, 160, 176], [176, 160, 116], [166, 138, 78]], hillsAt: 2.2, shadows: true },
  // the sun going down over the lake: the west on fire, violet overhead, clouds lit from below
  lake: { sun: [0.96, 0.07, 0.26], zenith: 0x272a5e, mid: 0x6a4d8e, low: 0xdc7a8c, horizon: 0xf2a97e, glowHorizon: 0xffc070, sunColor: 0xffa860, light: [0xffb27a, 1.55], hemi: [0xffcfb8, 0x4f4a48, 0.85], clouds: 0.42, cloudLit: 0xffb08a, cloudShade: 0x6a5274, cirrus: 0.6, disc: 0.99935, hills: [[118, 96, 132], [96, 78, 104], [74, 66, 70]], hillsAt: 4.4, shadows: true },
  // a bright summer morning out at the barn, big puffy clouds
  barn: { sun: [-0.5, 0.58, -0.64], zenith: 0x2e67bd, mid: 0x6aa2e0, low: 0xb9d5ee, horizon: 0xe8e2cc, glowHorizon: 0xf4ead0, sunColor: 0xfff4dc, light: [0xfff3dc, 1.65], hemi: [0xd4e6ff, 0x6b7a44, 0.95], clouds: 0.45, cloudLit: 0xffffff, cloudShade: 0x9eabc0, cirrus: 0.2, hills: [[146, 158, 172], [170, 158, 112], [150, 132, 76]], hillsAt: 1.2, shadows: true },
  // high noon on the hill: a hot, hazy pale sky over the dry grass
  dish: { sun: [0.25, 0.84, -0.48], zenith: 0x2f6dc4, mid: 0x74a9e2, low: 0xc4dbee, horizon: 0xe9e2c8, glowHorizon: 0xf2e8cc, sunColor: 0xfff6e2, light: [0xfff6e6, 1.75], hemi: [0xdfeaff, 0x7a7448, 0.95], clouds: 0.18, cloudLit: 0xffffff, cloudShade: 0xb6c0cf, cirrus: 0.5, hills: [[150, 162, 178], [178, 166, 120], [176, 150, 90]], hillsAt: 5.4, shadows: true },
  // game day: a crisp blue afternoon
  stadium: { sun: [-0.38, 0.6, 0.7], zenith: 0x1f58b8, mid: 0x5a95dc, low: 0xadcff0, horizon: 0xe0e6ea, glowHorizon: 0xf2ecdc, sunColor: 0xfff4e0, light: [0xfff4e2, 1.7], hemi: [0xd0e2ff, 0x5f7a4a, 0.95], clouds: 0.26, cloudLit: 0xffffff, cloudShade: 0xa6b2c6, cirrus: 0.3, hills: [[146, 160, 180], [160, 156, 120], [140, 128, 84]], hillsAt: 0.4, shadows: true },
  // golden late afternoon in the Quad, long shadows across the sandstone
  quad: { sun: [-0.7, 0.36, 0.62], zenith: 0x2a62b8, mid: 0x6b9fdc, low: 0xbcd3ea, horizon: 0xf0dfc0, glowHorizon: 0xffd9a0, sunColor: 0xffd9a8, light: [0xffe2b8, 1.7], hemi: [0xdce6f6, 0x8a7a55, 0.9], clouds: 0.22, cloudLit: 0xfff0dc, cloudShade: 0xb0a8b4, cirrus: 0.45, hills: [[150, 154, 170], [176, 156, 112], [168, 138, 80]], hillsAt: 2.4, shadows: true },
  // a clear night: the moon high in the south-west, stars, the glow of campus along the horizon
  hoover: { sun: [0.45, 0.62, -0.64], zenith: 0x02040e, mid: 0x07102a, low: 0x13204a, horizon: 0x22325e, glowHorizon: 0x2c3c6c, sunColor: 0xc8d8ff, light: [0xb4c8ff, 0.8], hemi: [0x8d9fdc, 0x2a3150, 1.05], clouds: 0.18, cloudLit: 0x4a5a86, cloudShade: 0x10182e, cirrus: 0.2, stars: 1, moon: true, disc: 0.99985, hills: [[22, 30, 56], [16, 22, 42], [12, 16, 30]], hillsAt: 2.2 },
  // a warm, low late-afternoon sun over the course
  golf: { sun: [0.62, 0.3, -0.72], zenith: 0x2b62b6, mid: 0x6c9fd8, low: 0xbcd2e6, horizon: 0xf1e0bc, glowHorizon: 0xffdca0, sunColor: 0xffe0a8, light: [0xffe4b4, 1.7], hemi: [0xd6e4f6, 0x4f7a34, 0.95], clouds: 0.3, cloudLit: 0xfff2dc, cloudShade: 0xa8a8b8, cirrus: 0.5, hills: [[140, 150, 166], [150, 150, 104], [120, 128, 70]], hillsAt: 0.8, shadows: true },
  // night ninety meters up: stars, a thin moon, the Bay Area glowing along the horizon far below
  skyway: { sun: [-0.4, 0.45, -0.8], zenith: 0x010210, mid: 0x060928, low: 0x15123e, horizon: 0x0b0d26, glowHorizon: 0x2a1a4a, sunColor: 0xd8dcff, light: [0xc8ccff, 0.75], hemi: [0x8d93d8, 0x2a1030, 1.05], clouds: 0.12, cloudLit: 0x2a2858, cloudShade: 0x06061a, cirrus: 0.15, stars: 1.3, moon: true, disc: 0.99988, hills: [[18, 14, 40], [12, 10, 30], [8, 6, 20]], hillsAt: 3.5, hillsTall: 0.5 },
};

/** (built when first needed: GLSL_NOISE comes from scenery.ts, which may still be loading when this file is) */
const skyFrag = () => /* glsl */ `
  uniform vec3 uSun, uZenith, uMid, uLow, uHorizon, uGlowHorizon, uSunCol, uCloudLit, uCloudShade;
  uniform float uTime, uClouds, uCirrus, uStars, uMoon, uDisc, uDim;
  varying vec3 vDir;
  ${GLSL_NOISE}
  float pdStar(vec3 d) {
    // a fixed field of stars: one cell of a grid on the dome each, twinkling a little
    vec2 p = vec2(atan(d.z, d.x) * 120.0, d.y * 190.0);
    vec2 i = floor(p);
    float h = pdHash(i);
    vec2 f = fract(p) - vec2(pdHash(i + 3.1), pdHash(i + 7.7)) * 0.6 - 0.2;
    float s = smoothstep(0.09, 0.0, length(f)) * step(0.93, h);
    return s * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 40.0)) * (0.4 + h);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float mu = dot(d, uSun);
    float az = dot(normalize(d.xz + 1e-5), normalize(uSun.xz + 1e-5)) * 0.5 + 0.5;
    float hp = max(h, 0.0);
    vec3 hor = mix(uHorizon, uGlowHorizon, pow(az, 4.0));
    vec3 c = mix(hor, uLow, smoothstep(0.02, 0.18, hp));
    c = mix(c, uMid, smoothstep(0.14, 0.45, hp));
    c = mix(c, uZenith, smoothstep(0.4, 1.0, hp));
    float m = max(mu, 0.0);
    // the glow round the sun (only a halo round the moon)
    c += uSunCol * (1.0 - uMoon * 0.85) * (pow(m, 6.0) * 0.28 + pow(m, 48.0) * 0.45 + pow(m, 600.0) * 0.6);
    c += uSunCol * (1.0 - uMoon) * pow(az, 10.0) * 0.12 * (1.0 - smoothstep(0.0, 0.3, hp));
    if (h > 0.0) {
      // stars, fading toward the horizon's glow
      c += vec3(0.9, 0.93, 1.0) * uStars * pdStar(d) * smoothstep(0.05, 0.35, h);
      // clouds: a deck of cumulus (or broken altocumulus), lit on the sun's side and shaded under, and high cirrus
      vec2 p = d.xz / (h + 0.1);
      float fade = smoothstep(0.02, 0.22, h);
      float n = pdFbm(p * 0.9 + vec2(uTime * 0.005, uTime * 0.0018));
      #ifdef PD_LOW
      float n2 = n;
      #else
      float n2 = pdFbm(p * 2.6 - vec2(uTime * 0.004, 0.0));
      #endif
      float thr = mix(0.78, 0.46, uClouds);
      float cov = smoothstep(thr, thr + 0.2, n * 0.8 + n2 * 0.3) * fade;
      float lit = pow(m * 0.5 + 0.5, 3.0);
      vec3 cloud = mix(uCloudShade, uCloudLit, clamp(0.3 + 0.55 * lit + (n2 - 0.45) * 0.9, 0.0, 1.0));
      cloud += uSunCol * (1.0 - smoothstep(thr, thr + 0.1, n * 0.8 + n2 * 0.3)) * lit * 0.35 * (1.0 - uMoon * 0.7);
      c = mix(c, cloud, cov * 0.92);
      vec2 q = vec2(p.x * 0.35 + p.y * 0.2, p.y * 3.0 - p.x * 0.4);
      float ci = smoothstep(0.56, 0.86, pdFbm(q * 1.3 + vec2(uTime * 0.003, 0.0))) * smoothstep(0.1, 0.5, h);
      c = mix(c, mix(uCloudShade, uCloudLit, 0.8), ci * 0.4 * uCirrus);
    }
    // the sun's disc (or the moon's, pale with its seas)
    float disc = smoothstep(uDisc, uDisc + 0.00012, mu);
    vec3 face = mix(vec3(1.0, 0.97, 0.88) * 1.6, vec3(0.92, 0.93, 0.98) * (0.85 + 0.15 * pdNoise(d.xz * 900.0)), uMoon);
    c = mix(c, face, disc);
    // and the haze under the horizon
    c = mix(c, hor * 0.95, 1.0 - smoothstep(-0.06, 0.0, h));
    c *= 1.0 - 0.6 * uDim;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The dome: it goes where the camera goes. */
function skyDome(THREE: Three, s: SkyLook, quality: Quality) {
  const col = (hex: number) => ({ value: new THREE.Color(hex) });
  const uniforms = {
    uSun: { value: new THREE.Vector3(...s.sun).normalize() },
    uZenith: col(s.zenith),
    uMid: col(s.mid),
    uLow: col(s.low),
    uHorizon: col(s.horizon),
    uGlowHorizon: col(s.glowHorizon),
    uSunCol: col(s.sunColor),
    uCloudLit: col(s.cloudLit),
    uCloudShade: col(s.cloudShade),
    uClouds: { value: s.clouds },
    uCirrus: { value: s.cirrus },
    uStars: { value: s.stars ?? 0 },
    uMoon: { value: s.moon ? 1 : 0 },
    uDisc: { value: s.disc ?? 0.99955 },
    uDim: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    defines: quality === 'low' ? { PD_LOW: 1 } : {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 1400.0, 1.0);
      }`,
    fragmentShader: skyFrag(),
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return { mesh, uniforms };
}

/**
 * The hills on the horizon round (cx, cz), in three layers of haze: a far range blue with distance, the middle hills and
 * the near foothills, golden in the dry season with dark oaks in their folds. Each layer is one open cylinder with a
 * painted silhouette, lit along its crest on the sun's side.
 */
function horizonHills(THREE: Three, scene: T.Scene, s: SkyLook, cx: number, cz: number, r: number) {
  const sun = Math.atan2(s.sun[0], s.sun[2]);
  const peak = s.hillsAt ?? 0;
  const tall = s.hillsTall ?? 1;
  const hz = new THREE.Color(s.horizon);
  const haze = [hz.r * 255, hz.g * 255, hz.b * 255];
  const rim = new THREE.Color(s.sunColor);
  const layers = [
    { R: r + 900, top: 150 * tall, rgb: s.hills[0], rim: 0.35, seed: 5, rough: 1, oaks: 0, haze: 0.45 },
    { R: r + 700, top: 80 * tall, rgb: s.hills[1], rim: 0.5, seed: 11, rough: 1.4, oaks: 0.25, haze: 0.3 },
    { R: r + 500, top: 34 * tall, rgb: s.hills[2], rim: 0.6, seed: 17, rough: 2.2, oaks: 0.6, haze: 0.18 },
  ];
  const W = 2048;
  const H = 128;
  return layers.map((L, n) => {
    const rnd = scatter(L.seed);
    const oct = Array.from({ length: 6 }, (_, k) => ({ f: 2 + k * k * 2 + Math.floor(rnd() * 3), a: 1 / (1 + k * L.rough), p: rnd() * Math.PI * 2 }));
    const ridge = (u: number) => {
      let v = 0;
      let tot = 0;
      for (const o of oct) {
        v += o.a * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * o.f + o.p));
        tot += o.a;
      }
      return v / tot;
    };
    // (dark oak woodland in the folds of the nearer hills: a field of blobs, thicker low down)
    const blob = scatter(L.seed * 7 + 1);
    const c = canvas(W, H, (g) => {
      const img = g.createImageData(W, H);
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const th = u * Math.PI * 2;
        const dir = Math.atan2(Math.sin(th), Math.cos(th));
        const toSun = Math.cos(dir - sun) * 0.5 + 0.5;
        const high = Math.cos(dir - peak) * 0.5 + 0.5;
        const hgt = Math.max(0, (0.2 + 0.8 * ridge(u)) * (0.45 + 0.55 * high ** 1.5));
        const top = H - 1 - hgt * (H - 4);
        const k = toSun ** 3;
        for (let y = 0; y < H; y++) {
          const o = (y * W + x) * 4;
          if (y < top || hgt <= 0.01) {
            img.data[o + 3] = 0;
            continue;
          }
          const depth = (y - top) / (H - top + 1);
          const lit = Math.max(0, 1 - (y - top) / 3) * L.rim * k;
          const shade = 0.82 + 0.18 * (1 - k);
          const hz = L.haze + depth * 0.35;
          for (let i = 0; i < 3; i++) {
            const base = L.rgb[i] * (1.08 - 0.16 * shade);
            img.data[o + i] = Math.min(255, base + (haze[i] - base) * hz + [rim.r, rim.g, rim.b][i] * 255 * lit * 0.5);
          }
          img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      if (L.oaks > 0) {
        for (let i = 0; i < 2600 * L.oaks; i++) {
          const x = blob() * W;
          const u = x / W;
          const th = u * Math.PI * 2;
          const high = Math.cos(Math.atan2(Math.sin(th), Math.cos(th)) - peak) * 0.5 + 0.5;
          const hgt = Math.max(0, (0.2 + 0.8 * ridge(u)) * (0.45 + 0.55 * high ** 1.5));
          const top = H - 1 - hgt * (H - 4);
          const y = top + 2 + blob() ** 0.6 * (H - top);
          if (y > H) continue;
          const a = 0.35 + 0.4 * blob();
          g.fillStyle = `rgba(${Math.round(L.rgb[0] * 0.35 + haze[0] * 0.25)},${Math.round(L.rgb[1] * 0.4 + haze[1] * 0.25)},${Math.round(L.rgb[2] * 0.3 + haze[2] * 0.25)},${a})`;
          g.beginPath();
          g.ellipse(x, y, 1.5 + blob() * 3, 1 + blob() * 1.6, 0, 0, Math.PI * 2);
          g.fill();
        }
        // (the haze still thickening toward the foot, over the trees too)
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(${haze.map(Math.round).join(',')},0.35)`);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
    });
    const tex = texture(THREE, c);
    tex.wrapS = THREE.RepeatWrapping;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(L.R, L.R, L.top, 128, 1, true), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.BackSide, fog: false }));
    m.position.set(cx, L.top / 2 - 2 - n * 0.5, cz);
    m.renderOrder = -1;
    scene.add(m);
    return m;
  });
}

export type Atmosphere = {
  /** Whether the sun casts real shadows here (so the karts' painted blobs under them can go). */
  shadows: boolean;
  /** Follows the camera (the dome) and the kart (the sun's shadows); dim darkens the sky (lights out, the blackout). */
  tick: (camera: T.Camera, focus: { x: number; z: number } | null, clock: number, dim: number) => void;
  /** Turns shadows on for everything that stands up, once the scene is built. */
  shade: (scene: T.Scene) => void;
};

/**
 * The sky, the hills on the horizon and the light for a road course: the sun and the sky light colored and placed to
 * match the sky, the fog the horizon's color.
 */
export function buildAtmosphere(THREE: Three, scene: T.Scene, renderer: T.WebGLRenderer, id: CourseId, track: { x: Float32Array | number[]; z: Float32Array | number[]; n: number }, lights: { hemi: T.HemisphereLight; sun: T.DirectionalLight }, quality: Quality): Atmosphere | null {
  const s = SKIES[id];
  if (!s) return null;
  const dome = skyDome(THREE, s, quality);
  scene.add(dome.mesh);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.x[i]);
    maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]);
    maxZ = Math.max(maxZ, track.z[i]);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  horizonHills(THREE, scene, s, cx, cz, Math.max(maxX - minX, maxZ - minZ) / 2);
  const { hemi, sun } = lights;
  // (the far distance melts into the horizon)
  (scene.fog as T.Fog | null)?.color.setHex(s.horizon);
  hemi.color.setHex(s.hemi[0]);
  hemi.groundColor.setHex(s.hemi[1]);
  hemi.intensity = s.hemi[2];
  sun.color.setHex(s.light[0]);
  sun.intensity = s.light[1];
  const dir = new THREE.Vector3(...s.sun).normalize();
  sun.position.copy(dir).multiplyScalar(300);
  const shadows = quality === 'high' && !!s.shadows;
  if (shadows) {
    renderer.shadowMap.enabled = true;
    // (soft-edged: in this three.js PCF shadows are filtered softly)
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera as T.OrthographicCamera;
    cam.left = -55;
    cam.right = 55;
    cam.top = 55;
    cam.bottom = -55;
    cam.near = 10;
    cam.far = 700;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun.target);
  }
  const texel = 110 / 2048;
  const at = new THREE.Vector3();
  return {
    shadows,
    tick(camera, focus, clock, dim) {
      dome.uniforms.uTime.value = clock;
      dome.uniforms.uDim.value = dim;
      if (shadows && focus) {
        // (the shadow box centered a little ahead of the camera, snapped to its texels so the edges do not crawl)
        at.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
        sun.target.position.copy(at);
        sun.position.copy(dir).multiplyScalar(300).add(at);
        sun.target.updateMatrixWorld();
      }
      void camera;
    },
    shade(root) {
      if (!shadows) return;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      root.traverse((o) => {
        const m = o as T.Mesh;
        if (!m.isMesh) return;
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as T.Material & { isMeshBasicMaterial?: boolean; isShaderMaterial?: boolean };
        if (!mat || mat.isMeshBasicMaterial || mat.isShaderMaterial) return;
        m.receiveShadow = true;
        if (mat.transparent || o.userData.flat || o.userData.noCast) return;
        // (only what stands up casts: not the road, the ground, the lawns or the decals lying on them)
        box.setFromObject(m);
        if (box.max.y - box.min.y > 0.15) m.castShadow = true;
      });
    },
  };
}
