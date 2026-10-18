// three.js view of Redwood Slough's water and what is on it (scene.ts builds it for a course raced in shells): the
// channel itself, its currents running in the water, the marsh and mudflat past the brink, the lock and its gates,
// Hwy 101's piers and deck, the Caltrain swing span, the whirlpools, the vessels and their wakes, the lane buoys, the
// chain ferry, the swell rolling in off the Bay and the weir. It reads a Race every frame and never changes it.
import type { T } from './gl';
import { deltaS, edgeAt, edgeRuns, headingOf, lengthOf, pointAt, roadEdge, wrapS, type Track } from './track';
import { DAWN, GLSL_NOISE, canvas, noise, scatter, texture, type Look } from './scenery';
import { COURSES } from './courses';
import { RAMP_H, TIDE_LAP, WAKE_LEN, WAKE_SPREAD, crestsAt, hazState, hazardV, strokeAt, type LiveHazard, type Race } from './logic';

type Three = typeof import('three');
type Geo = { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; plane: T.PlaneGeometry; cone: T.ConeGeometry };

/** A flat strip along the track from s0 to s1 between lateral offsets a(s) and b(s), at height y (v runs vLen a unit). */
export function band(THREE: Three, t: Track, s0: number, s1: number, a: (s: number) => number, b: (s: number) => number, y: number, vLen: number) {
  const count = Math.max(1, Math.round((s1 - s0) / (t.step / 2)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s);
    const nx = -p.tz;
    const nz = p.tx;
    const [da, db] = [Math.min(a(s), b(s)), Math.max(a(s), b(s))];
    pos.push(p.x + nx * da, y, p.z + nz * da, p.x + nx * db, y, p.z + nz * db);
    uv.push(0, (s - s0) / vLen, 1, (s - s0) / vLen);
    if (k < count) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A vertical strip at lateral offset d(s) from s0 to s1, from height y0 to y1 (a wall's face). */
function face(THREE: Three, t: Track, s0: number, s1: number, d: (s: number) => number, y0: number, y1: number, uLen: number) {
  const count = Math.max(1, Math.round((s1 - s0) / (t.step / 2)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s, d(s));
    pos.push(p.x, y0, p.z, p.x, y1, p.z);
    uv.push(s / uLen, 0, s / uLen, 1);
    if (k < count) idx.push(2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3);
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
  uniform float uTime, uFlow, uStreak, uLap, uReflOn, uFogLift;
  uniform vec3 uDeep, uShallow, uFoam, uSun, uSunCol, uSkyLow, uSkyHigh, uHorizon;
  uniform sampler2D tNormal, tRefl;
  uniform mat4 uReflM;
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
    float st = pdNoise(vec2(across * 1.4, along * 0.06)) * pdNoise(vec2(across * 0.6 + 3.1, along * 0.025));
    c += vec3(0.9, 0.92, 0.95) * smoothstep(0.35, 0.7, st) * 0.09 * uStreak * calm;
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
    foam = max(foam, rough * smoothstep(0.55, 0.85, pdNoise(p * 1.8 + uTime * vec2(0.4, 0.1)) * (0.6 + 0.6 * n.x)) * 0.8 * calm);
    c = mix(c, uFoam, clamp(foam, 0.0, 1.0) * 0.9);
    gl_FragColor = vec4(c, 1.0);
    if (uFogLift > 0.5) gl_FragColor = vec4(refl, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** The whirlpool's spiral: foam arms wound round a dark eye, on a transparent disc. */
function spiralTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(256, 256, (g) => {
      const c = 128;
      const dark = g.createRadialGradient(c, c, 4, c, c, 128);
      dark.addColorStop(0, 'rgba(6,20,28,0.95)');
      dark.addColorStop(0.25, 'rgba(10,34,46,0.7)');
      dark.addColorStop(0.7, 'rgba(14,40,52,0.25)');
      dark.addColorStop(1, 'rgba(14,40,52,0)');
      g.fillStyle = dark;
      g.fillRect(0, 0, 256, 256);
      g.lineCap = 'round';
      for (let arm = 0; arm < 5; arm++) {
        g.beginPath();
        for (let k = 0; k <= 60; k++) {
          const u = k / 60;
          const a = (arm / 5) * Math.PI * 2 + u * Math.PI * 2.4;
          const rad = 14 + u * 108;
          const x = c + Math.cos(a) * rad;
          const y = c + Math.sin(a) * rad;
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.strokeStyle = 'rgba(244,239,230,0.85)';
        g.lineWidth = 5;
        g.stroke();
      }
      // an outer foam ring
      g.strokeStyle = 'rgba(244,239,230,0.7)';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(c, c, 118, 0, Math.PI * 2);
      g.stroke();
    }),
  );
}

/** THREE.AdditiveBlending, by value: the shared three.js chunk (kit/three-lib.ts) does not export the constant. */
const ADDITIVE = 2 as T.Blending;

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
    uFogLift: { value: 0 },
    uDeep: col(water.deep),
    uShallow: col(water.shallow),
    uFoam: col(water.foam),
    uSun: { value: new THREE.Vector3(...DAWN.sun).normalize() },
    uSunCol: col(DAWN.sunColor),
    uSkyLow: col(DAWN.low),
    uSkyHigh: col(DAWN.mid),
    uHorizon: col(DAWN.horizon),
    tNormal: { value: rippleNormals(THREE) },
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
  const capTex = texture(
    THREE,
    canvas(128, 128, (g) => {
      const r2 = scatter(31);
      for (let i = 0; i < 46; i++) {
        g.fillStyle = `rgba(255,255,255,${0.35 + r2() * 0.4})`;
        g.beginPath();
        g.ellipse(r2() * 128, r2() * 128, 3 + r2() * 5, 0.8 + r2(), 0, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  capTex.wrapS = capTex.wrapT = THREE.RepeatWrapping;
  const chops = (COURSES[r.course].surfaces ?? [])
    .filter((f) => f[3] === 'chop')
    .map(([s0, s1, , , lap]) => {
      const tex = capTex.clone();
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(band(THREE, t, s0, Math.min(s1, t.length), wet(-1), wet(1), 0.048, 9), mat);
      m.renderOrder = 1;
      scene.add(m);
      return { tex, mat, lap: lap ?? 1 };
    });

  // ---------------------------------------------------------------------------------------------------------------
  // The banks: where there is no wall, a pale line of mud at the water's edge (the brink, always readable), the
  // mudflat past it and the pickleweed beyond; where there is a wall, a concrete bulkhead (closer in through the lock)
  const mudTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, '#d9c7a0');
      grad.addColorStop(0.25, '#a68d63');
      grad.addColorStop(1, '#6e5a3c');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      noise(g, 64, 64, 300, 0.12, false);
      g.fillStyle = 'rgba(255,240,215,0.35)';
      for (let i = 0; i < 12; i++) g.fillRect((i * 37) % 64, (i * 23) % 64, 6, 1);
    }),
  );
  mudTex.wrapT = THREE.RepeatWrapping;
  const weedTex = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#5f6b34';
      g.fillRect(0, 0, 128, 128);
      const r2 = scatter(5);
      for (let i = 0; i < 500; i++) {
        g.fillStyle = r2() < 0.35 ? `rgba(150,60,48,${0.4 + r2() * 0.4})` : `rgba(${90 + r2() * 50},${110 + r2() * 40},${40 + r2() * 20},0.7)`;
        g.fillRect(r2() * 128, r2() * 128, 2 + r2() * 3, 2 + r2() * 3);
      }
    }),
  );
  weedTex.wrapS = weedTex.wrapT = THREE.RepeatWrapping;
  const foamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(water.foam) });
  /** What stays lit and readable through the last lap's fog: the lip of the marsh, the marker posts' lamps, the buoys' and the vessels' lights, the lock's lamps and the whirlpools' foam. */
  const lit: T.MeshBasicMaterial[] = [foamMat];
  const mudMat = new THREE.MeshLambertMaterial({ map: mudTex });
  const weedMat = new THREE.MeshLambertMaterial({ map: weedTex });
  const concreteTex = texture(
    THREE,
    canvas(64, 32, (g) => {
      g.fillStyle = look.wall;
      g.fillRect(0, 0, 64, 32);
      g.fillStyle = 'rgba(60,50,40,0.25)';
      for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1, 32);
      g.fillStyle = 'rgba(40,60,50,0.45)';
      g.fillRect(0, 24, 64, 8);
      g.fillStyle = look.band;
      g.fillRect(0, 0, 64, 5);
      noise(g, 64, 32, 120, 0.08, false);
    }),
  );
  concreteTex.wrapS = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshLambertMaterial({ map: concreteTex, side: THREE.DoubleSide });
  const capMat = new THREE.MeshLambertMaterial({ color: 0xd8d2c4 });
  for (const [side, s0, s1, past] of edgeRuns(t)) {
    const l = lim(side);
    if (past === 'wall') {
      // the wall's face from below the water line to a meter and a half up, its coping, and the bank behind it
      scene.add(new THREE.Mesh(face(THREE, t, s0, s1, l, -0.6, 1.5, 4), wallMat));
      scene.add(new THREE.Mesh(band(THREE, t, s0, s1, l, (s) => l(s) + side * 0.6, 1.5, 4), capMat));
      scene.add(new THREE.Mesh(band(THREE, t, s0, s1, (s) => l(s) + side * 0.6, (s) => l(s) + side * 8, 1.45, 8), mudMat));
      continue;
    }
    // (the line of foam where the water laps the mud, the mud from there to the brink and past it, then the marsh, under
    // the water so another stretch of the channel close by always shows over it, and never folded over itself on the
    // inside of a bend)
    const far = (s: number) => {
      const c = t.curv[Math.floor(wrapS(t, s) / t.step) % t.n] * side;
      return l(s) + side * Math.max(2.4, Math.min(14, c > 0.005 ? 0.92 / c - Math.abs(l(s)) : 14));
    };
    scene.add(new THREE.Mesh(band(THREE, t, s0, s1, (s) => wet(side)(s) - side * 0.12, (s) => wet(side)(s) + side * 0.12, 0.06, 2), foamMat));
    scene.add(new THREE.Mesh(band(THREE, t, s0, s1, wet(side), (s) => l(s) + side * 2.2, 0.038, 3), mudMat));
    scene.add(new THREE.Mesh(band(THREE, t, s0, s1, (s) => l(s) + side * 2.2, far, 0.03, 10), weedMat));
  }
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
  const steel = new THREE.MeshLambertMaterial({ color: 0x47505a, emissive: 0x0d1014 });
  const concrete = new THREE.MeshLambertMaterial({ color: 0xbdb6a6 });
  const lampColor = { open: new THREE.Color(0x27e36a), warn: new THREE.Color(0xffb300), shut: new THREE.Color(0xff2a1a), dim: new THREE.Color(0x163a22) };

  // the Tide Gates: a steel miter leaf hinged on each lock wall, swinging shut across its half of the chamber, with a
  // lamp on the wall beside it (green open, amber flashing before it swings, red shut)
  const gateTex = texture(
    THREE,
    canvas(64, 32, (g) => {
      g.fillStyle = '#56616b';
      g.fillRect(0, 0, 64, 32);
      g.fillStyle = '#ffcf1f';
      for (let k = -2; k < 10; k++) {
        g.beginPath();
        g.moveTo(k * 8, 0);
        g.lineTo(k * 8 + 4, 0);
        g.lineTo(k * 8 + 4 + 8, 8);
        g.lineTo(k * 8 + 8, 8);
        g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 12; y < 32; y += 6) g.fillRect(0, y, 64, 1);
    }),
  );
  const gateMat = new THREE.MeshLambertMaterial({ map: gateTex, emissive: 0x111418 });
  type GateView = { i: number; leaf: T.Mesh; lamp: T.Mesh; lampMat: T.MeshBasicMaterial; hinge: { x: number; z: number }; shut: [number, number]; open: [number, number]; w: number; lift: number };
  const gates: GateView[] = [];
  // the Hwy 101 piers and the Caltrain swing span, sweeping round on its pivot pier from lap 2
  type SwingView = { i: number; g: T.Group; f: ReturnType<typeof frame>; ang: number };
  const swings: SwingView[] = [];
  const latticeTex = texture(
    THREE,
    canvas(128, 32, (g) => {
      g.strokeStyle = '#2f3740';
      g.lineWidth = 4;
      g.strokeRect(2, 2, 124, 28);
      g.lineWidth = 3;
      for (let x = 0; x < 128; x += 16) {
        g.beginPath();
        g.moveTo(x, 2);
        g.lineTo(x + 16, 30);
        g.moveTo(x + 16, 2);
        g.lineTo(x, 30);
        g.stroke();
      }
    }),
  );
  const latticeMat = new THREE.MeshLambertMaterial({ map: latticeTex, transparent: true, side: THREE.DoubleSide, color: 0x9aa6b2 });
  let piers = 0;
  let traffic: { cars: T.InstancedMesh; f: ReturnType<typeof frame> } | null = null;
  r.hazards.forEach((h, i) => {
    if (h.kind === 'bollard' && h.look === 'gate') {
      const w = h.w ?? 6;
      const side = h.d < 0 ? -1 : 1;
      const f = frame(h.s, side * edgeAt(t, h.s, side).lim);
      const nx = -f.tz * -side;
      const nz = f.tx * -side;
      const leaf = new THREE.Mesh(geo.box, gateMat);
      leaf.scale.set(0.45, 1.6, w);
      scene.add(leaf);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x27e36a });
      lit.push(lampMat);
      const lamp = new THREE.Mesh(geo.ball, lampMat);
      lamp.scale.setScalar(0.32);
      lamp.position.set(f.x - nx * 0.6 - f.tx * 1.2, 2.4, f.z - nz * 0.6 - f.tz * 1.2);
      scene.add(lamp);
      // (a lamp post on the wall)
      const pole = new THREE.Mesh(geo.box, steel);
      pole.scale.set(0.16, 2.2, 0.16);
      pole.position.set(lamp.position.x, 1.2, lamp.position.z);
      scene.add(pole);
      gates.push({ i, leaf, lamp, lampMat, hinge: { x: f.x, z: f.z }, shut: [nx, nz], open: [-f.tx, -f.tz], w, lift: 0 });
      return;
    }
    if (h.kind === 'statue' && h.look === 'pier') {
      // a concrete pier, its footing in the water, up to the deck
      const col = new THREE.Mesh(geo.box, concrete);
      col.scale.set(h.r * 2, 9, h.r * 2.6);
      col.position.set(h.x, 4.4, h.z);
      col.rotation.y = headingOf(h.tx, h.tz);
      scene.add(col);
      const foot = new THREE.Mesh(geo.wheel, new THREE.MeshLambertMaterial({ color: 0x7c776a }));
      foot.scale.set(h.r * 1.5, 0.5, h.r * 1.5);
      foot.position.set(h.x, 0.15, h.z);
      scene.add(foot);
      piers++;
      return;
    }
    if (h.kind === 'rotor' && h.look === 'swing') {
      const f = frame(h.s, h.d);
      const pier = new THREE.Mesh(geo.wheel, concrete);
      pier.scale.set(h.r, 1.6, h.r);
      pier.position.set(f.x, 0.5, f.z);
      scene.add(pier);
      // the span: a steel truss from the pivot out over the water, low enough to hit
      const g = new THREE.Group();
      const arm = h.arm ?? 6.6;
      for (const x of [-0.55, 0.55]) {
        const truss = new THREE.Mesh(geo.box, latticeMat);
        truss.scale.set(0.12, 1.8, arm);
        truss.position.set(x, 1.95, arm / 2);
        g.add(truss);
      }
      const deck = new THREE.Mesh(geo.box, steel);
      deck.scale.set(1.2, 0.3, arm);
      deck.position.set(0, 1.05, arm / 2);
      const top = new THREE.Mesh(geo.box, steel);
      top.scale.set(1.2, 0.18, arm);
      top.position.set(0, 2.85, arm / 2);
      const hub = new THREE.Mesh(geo.wheel, steel);
      hub.scale.set(1.3, 0.6, 1.3);
      hub.position.set(0, 1.25, 0);
      const tip = new THREE.Mesh(geo.ball, new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
      tip.scale.setScalar(0.25);
      tip.position.set(0, 3.1, arm);
      g.add(deck, top, hub, tip);
      g.position.set(f.x, 0, f.z);
      scene.add(g);
      swings.push({ i, g, f, ang: 0 });
    }
  });
  // Hwy 101's deck over the piers, its shade on the water under it, and the Caltrain's tracks on their trestle
  if (piers) {
    const ps = r.hazards.filter((h) => h.kind === 'statue' && h.look === 'pier');
    const mid = (ps[0].s + ps[ps.length - 1].s) / 2;
    const f = frame(mid);
    const deck = new THREE.Mesh(geo.box, concrete);
    deck.scale.set(70, 1.3, 34);
    deck.position.set(f.x, 9.4, f.z);
    deck.rotation.y = f.h;
    scene.add(deck);
    const rail = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0x8c1515 }));
    for (const z of [-16.5, 16.5]) {
      const m = rail.clone();
      m.scale.set(70, 0.9, 0.3);
      m.position.set(f.x + Math.sin(f.h) * z, 10.4, f.z + Math.cos(f.h) * z);
      m.rotation.y = f.h;
      scene.add(m);
    }
    const shade = new THREE.Mesh(band(THREE, t, mid - 17, mid + 17, () => -9, () => 9, 0.055, 4), new THREE.MeshBasicMaterial({ color: 0x0a1820, transparent: true, opacity: 0.35, depthWrite: false }));
    shade.renderOrder = 1;
    scene.add(shade);
    // and the morning traffic on it, four lanes each way, streaming across on the clock (headlights one way, tail lights
    // the other)
    const cars = new THREE.InstancedMesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), CARS);
    const carColors = [0xd8dde2, 0x2b2f36, 0x8c1515, 0x3c6fa8, 0xe8e2d4, 0x6a6f74, 0xb8a27a];
    for (let n = 0; n < CARS; n++) cars.setColorAt(n, new THREE.Color(carColors[(n * 5) % carColors.length]));
    cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cars.frustumCulled = false;
    scene.add(cars);
    traffic = { cars, f };
  }

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
  // The whirlpools: a still faint ring before their lap, the foam turning as one is about to form, then the spiral
  // spinning fast with a dark eye and the water darkened round it as far as it pulls
  const spiral = spiralTexture(THREE);
  const pullTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(4,16,24,0.6)');
      grad.addColorStop(0.7, 'rgba(4,16,24,0.25)');
      grad.addColorStop(1, 'rgba(4,16,24,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  type WhirlView = { h: LiveHazard; disc: T.Mesh; mat: T.MeshBasicMaterial; dark: T.Mesh; darkMat: T.MeshBasicMaterial; eye: T.Mesh; ring: T.Mesh; ringMat: T.MeshBasicMaterial; a: number };
  const whirls: WhirlView[] = r.whirls.map((h) => {
    const flat = (m: T.Mesh, y: number, order: number) => {
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.renderOrder = order;
      scene.add(m);
      return m;
    };
    const darkMat = new THREE.MeshBasicMaterial({ map: pullTex, transparent: true, depthWrite: false, opacity: 0 });
    const dark = flat(new THREE.Mesh(geo.plane, darkMat), 0.07, 2);
    dark.scale.set((h.pull ?? 7) * 2, (h.pull ?? 7) * 2, 1);
    const mat = new THREE.MeshBasicMaterial({ map: spiral, transparent: true, depthWrite: false, opacity: 0 });
    const disc = flat(new THREE.Mesh(geo.plane, mat), 0.08, 3);
    const eye = flat(new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x041218 })), 0.09, 4);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf4efe6, transparent: true, depthWrite: false, opacity: 0.2 });
    lit.push(mat, ringMat);
    const ring = flat(new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), ringMat), 0.085, 3);
    ring.scale.setScalar((h.r ?? 2.6) + 0.6);
    return { h, disc, mat, dark, darkMat, eye, ring, ringMat, a: 0 };
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The vessels: the coach's launches, the tug and its barge, the logs; the chain ferry; and the lane buoys
  const alu = new THREE.MeshLambertMaterial({ color: 0xc4cad2 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262c });
  const cardinal = new THREE.MeshLambertMaterial({ color: 0x8c1515 });
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f0 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8bf98 });
  const add = (g: T.Group, geom: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  const portLight = new THREE.MeshBasicMaterial({ color: 0xff3b2a });
  const starLight = new THREE.MeshBasicMaterial({ color: 0x3bff6a });
  const sternLight = new THREE.MeshBasicMaterial({ color: 0xffe6a0 });
  lit.push(portLight, starLight, sternLight);
  type VesselView = { h: LiveHazard; g: T.Group; roll: T.Object3D | null; wake: T.Mesh | null; wakePos: T.BufferAttribute | null };
  const wakeMat = new THREE.MeshBasicMaterial({ color: 0xf6f2ea, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const WAKE_N = 12;
  const vessels: VesselView[] = r.vessels.map((h) => {
    const g = new THREE.Group();
    let roll: T.Object3D | null = null;
    const len = lengthOf(h);
    if (h.kind === 'launch') {
      // an aluminum launch: the hull, a wedge of bow, the console, the outboard and the coach in a cardinal jacket
      add(g, geo.box, alu, 0, 0.35, 0, h.r * 2, 0.7, len * 0.8);
      const bow = add(g, geo.cone, alu, 0, 0.35, len * 0.4 + 0.5, h.r, 1.3, 0.7);
      bow.rotation.x = Math.PI / 2;
      add(g, geo.box, cardinal, 0, 0.72, len * 0.1, h.r * 2.02, 0.12, len * 0.6);
      add(g, geo.box, dark, 0, 0.9, 0.6, 0.8, 0.5, 0.6);
      add(g, geo.box, dark, 0, 0.75, -len * 0.42, 0.45, 1.1, 0.5);
      add(g, geo.box, cardinal, 0.3, 1.3, -0.4, 0.5, 0.75, 0.35);
      add(g, geo.ball, skin, 0.3, 1.85, -0.4, 0.18, 0.2, 0.18);
      // the megaphone
      const horn = add(g, geo.cone, white, 0.62, 1.6, -0.1, 0.12, 0.4, 0.12);
      horn.rotation.x = Math.PI / 2;
      // (running lights, red to port and green to starboard, and a white one astern)
      add(g, geo.ball, portLight, h.r, 0.85, len * 0.3, 0.12, 0.12, 0.12);
      add(g, geo.ball, starLight, -h.r, 0.85, len * 0.3, 0.12, 0.12, 0.12);
      add(g, geo.ball, sternLight, 0, 1.5, -len * 0.42, 0.12, 0.12, 0.12);
    } else if (h.kind === 'barge') {
      // a gravel barge pushed by a black-and-red tug at its stern
      const bl = len - 9;
      add(g, geo.box, new THREE.MeshLambertMaterial({ color: 0x5e5248 }), 0, 0.6, 4.5, h.r * 2, 1.4, bl);
      add(g, geo.box, new THREE.MeshLambertMaterial({ color: 0x9a8a72 }), 0, 1.45, 4.5, h.r * 1.7, 0.5, bl - 1.5);
      add(g, geo.box, new THREE.MeshLambertMaterial({ color: 0x1c1c22 }), 0, 0.7, -len / 2 + 4.5, h.r * 1.6, 1.4, 8);
      add(g, geo.box, new THREE.MeshLambertMaterial({ color: 0xa8231a }), 0, 1.45, -len / 2 + 4.5, h.r * 1.62, 0.25, 8.05);
      add(g, geo.box, white, 0, 2.6, -len / 2 + 3.5, h.r * 1.1, 2, 3.4);
      add(g, geo.box, dark, 0, 3.9, -len / 2 + 3.5, h.r * 1.15, 0.5, 3.6);
      add(g, geo.wheel, dark, 0, 4.6, -len / 2 + 2.2, 0.35, 1.6, 0.35);
      // (a lamp on its wheelhouse)
      add(g, geo.ball, sternLight, 0, 4.3, -len / 2 + 5.3, 0.18, 0.18, 0.18);
      add(g, geo.ball, portLight, h.r, 1.7, len / 2 - 0.5, 0.2, 0.2, 0.2);
      add(g, geo.ball, starLight, -h.r, 1.7, len / 2 - 0.5, 0.2, 0.2, 0.2);
    } else {
      // a drifting log, rolling slowly
      roll = add(g, geo.wheel, new THREE.MeshLambertMaterial({ color: 0x6b4a2e }), 0, 0.12, 0, h.r, len, h.r);
      roll.rotation.x = Math.PI / 2;
      const end = add(g, geo.wheel, new THREE.MeshLambertMaterial({ color: 0xc9a476 }), 0, 0.12, len / 2, h.r * 0.92, 0.02, h.r * 0.92);
      end.rotation.x = Math.PI / 2;
    }
    g.visible = false;
    scene.add(g);
    let wake: T.Mesh | null = null;
    let wakePos: T.BufferAttribute | null = null;
    if ((h.wake ?? 0) > 0) {
      // the V: two arms of WAKE_N quads each, rebuilt from where the vessel is every frame
      const geom = new THREE.BufferGeometry();
      wakePos = new THREE.BufferAttribute(new Float32Array(2 * (WAKE_N + 1) * 2 * 3), 3);
      wakePos.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', wakePos);
      const idx: number[] = [];
      for (let arm = 0; arm < 2; arm++) {
        const o = arm * (WAKE_N + 1) * 2;
        for (let k = 0; k < WAKE_N; k++) idx.push(o + 2 * k, o + 2 * k + 1, o + 2 * k + 2, o + 2 * k + 1, o + 2 * k + 3, o + 2 * k + 2);
      }
      geom.setIndex(idx);
      wake = new THREE.Mesh(geom, wakeMat);
      wake.frustumCulled = false;
      wake.renderOrder = 2;
      scene.add(wake);
    }
    return { h, g, roll, wake, wakePos };
  });
  // the chain ferry: a pontoon with rails and a little wheelhouse, on its chain across the Port Reach
  const ferries = r.hazards
    .filter((h) => h.kind === 'ferry')
    .map((h) => {
      const g = new THREE.Group();
      const deckMat = new THREE.MeshLambertMaterial({ color: 0x3d6f7a });
      add(g, geo.box, deckMat, 0, 0.35, 0, h.r * 2, 0.6, h.r * 2.6);
      add(g, geo.box, new THREE.MeshLambertMaterial({ color: 0xffc21a }), 0, 0.7, 0, h.r * 2.04, 0.1, h.r * 2.64);
      add(g, geo.box, white, 0, 1.4, 0, 1.4, 1.3, 1.6);
      add(g, geo.box, cardinal, 0, 2.15, 0, 1.6, 0.2, 1.8);
      g.rotation.y = headingOf(h.tx, h.tz);
      scene.add(g);
      // (the chain, right across the reach)
      const f = frame(h.s);
      const chain = new THREE.Mesh(geo.box, dark);
      chain.scale.set(2 * t.edge + 4, 0.08, 0.08);
      chain.position.set(f.x, 0.12, f.z);
      chain.rotation.y = f.h;
      scene.add(chain);
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
  // The swell: each crest a line of whitecaps along the Bay Reach, rolling in from the Bay across the channel
  const CRESTS = 10;
  const crestPts = 24;
  const crestGeo = new THREE.BufferGeometry();
  const crestPos = new THREE.BufferAttribute(new Float32Array(CRESTS * (crestPts + 1) * 2 * 3), 3);
  crestPos.setUsage(THREE.DynamicDrawUsage);
  crestGeo.setAttribute('position', crestPos);
  {
    const idx: number[] = [];
    for (let c = 0; c < CRESTS; c++) {
      const o = c * (crestPts + 1) * 2;
      for (let k = 0; k < crestPts; k++) idx.push(o + 2 * k, o + 2 * k + 1, o + 2 * k + 2, o + 2 * k + 1, o + 2 * k + 3, o + 2 * k + 2);
    }
    crestGeo.setIndex(idx);
  }
  const crestMesh = new THREE.Mesh(crestGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  crestMesh.frustumCulled = false;
  crestMesh.renderOrder = 3;
  if (r.swells.length) scene.add(crestMesh);

  // ---------------------------------------------------------------------------------------------------------------
  // The weir: the stopper boiling white below its crest, and DANGER WEIR boards on both banks
  const foamTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = 'rgba(240,244,240,0.85)';
      g.fillRect(0, 0, 64, 64);
      const r3 = scatter(9);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(90,140,150,${0.2 + r3() * 0.3})`;
        g.beginPath();
        g.arc(r3() * 64, r3() * 64, 1 + r3() * 4, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
  const stoppers: T.Texture[] = [];
  // (and the white water pouring over the crest into it)
  const pours: T.Texture[] = [];
  for (const h of r.holes) {
    if ((h.w ?? h.r) < t.half + 1) continue;
    const tex = foamTex.clone();
    tex.needsUpdate = true;
    stoppers.push(tex);
    const m = new THREE.Mesh(band(THREE, t, h.s - 0.3, h.s + (h.len ?? 0), wet(-1), wet(1), 0.07, 3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.renderOrder = 2;
    scene.add(m);
    {
      const pour = foamTex.clone();
      pour.needsUpdate = true;
      pour.repeat.set(4, 1);
      pours.push(pour);
      const f = frame(h.s - 0.2);
      const w = wet(1)(h.s) - wet(-1)(h.s);
      const sheet = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ map: pour, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      sheet.scale.set(w, RAMP_H + 0.5, 1);
      const c = pointAt(t, h.s - 0.2, (wet(1)(h.s) + wet(-1)(h.s)) / 2);
      sheet.position.set(c.x, (RAMP_H - 0.5) / 2 + 0.04, c.z);
      sheet.rotation.y = f.h;
      sheet.renderOrder = 2;
      scene.add(sheet);
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
      const f = frame(h.s - 30, side * (edgeAt(t, h.s - 30, side).lim + 2.5));
      const sign = new THREE.Mesh(geo.plane, board);
      sign.scale.set(4, 1.5, 1);
      sign.position.set(f.x, 2.6, f.z);
      sign.rotation.y = f.h + Math.PI;
      scene.add(sign);
      const pole = new THREE.Mesh(geo.box, steel);
      pole.scale.set(0.15, 2, 0.15);
      pole.position.set(f.x, 1, f.z);
      scene.add(pole);
    }
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
    const w = Math.max(16, Math.round(size.x * REFLECT_RES));
    const h = Math.max(16, Math.round(size.y * REFLECT_RES));
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
      shared.uFogLift.value = (globalThis as unknown as { __dbg?: number }).__dbg ?? 0; // TEMP-DEBUG
      shared.uLap.value = lap;
      for (const tg of tongues) {
        const v = tg.f.tide && lap >= TIDE_LAP ? -tg.f.tongue![2] : tg.f.tongue![2];
        tg.tex.offset.y = (tg.tex.offset.y - (v * dt) / 5) % 1;
      }
      for (const c of chops) {
        c.mat.opacity = lap >= c.lap ? 0.55 : 0;
        c.tex.offset.set((clock * 0.05) % 1, (clock * 0.11) % 1);
      }
      for (const tex of pours) tex.offset.y = (tex.offset.y + dt * 2.4) % 1;
      if (traffic) {
        const { cars, f } = traffic;
        const ax = Math.cos(f.h);
        const az = -Math.sin(f.h);
        const bx = Math.sin(f.h);
        const bz = Math.cos(f.h);
        for (let n = 0; n < CARS; n++) {
          const lane = n % 8;
          const dir = lane < 4 ? 1 : -1;
          const z = (lane < 4 ? -1 : 1) * (2.4 + (lane % 4) * 3.4);
          const speed = 24 + (lane % 4) * 3;
          const u = ((((clock * speed * dir + n * 37.3) % 120) + 120) % 120) - 60;
          const truck = n % 9 === 0;
          dummy.position.set(f.x + ax * u + bx * z, truck ? 11.25 : 10.7, f.z + az * u + bz * z);
          dummy.rotation.set(0, f.h + Math.PI / 2, 0);
          dummy.scale.set(1.8, truck ? 2.4 : 1.3, truck ? 9 : 4.2);
          dummy.updateMatrix();
          cars.setMatrixAt(n, dummy.matrix);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        cars.instanceMatrix.needsUpdate = true;
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
      // the whirlpools
      for (const w of whirls) {
        const st = hazState(race, w.h, race.time, lap);
        const p = pointAt(t, w.h.s, st.d);
        const k = st.live ? st.lift : 0;
        const spin = w.h.spin ?? 1;
        w.a += spin * dt * (st.live ? 1.2 + 3 * k : st.warn > 0 ? 1.2 * st.warn : 0);
        for (const m of [w.disc, w.dark, w.eye, w.ring]) m.position.set(p.x, m.position.y, p.z);
        // (turning the way it pulls you round: see whirlPull)
        w.disc.rotation.z = w.a;
        const size = (w.h.pull ?? 7) * (0.45 + 0.35 * Math.max(k, st.warn * 0.7));
        w.disc.scale.set(size * 2, size * 2, 1);
        w.mat.opacity = st.live ? 0.55 + 0.4 * k : st.warn > 0 ? 0.3 + 0.5 * st.warn : 0;
        w.darkMat.opacity = st.live ? 0.9 * k : st.warn > 0 ? 0.3 * st.warn : 0;
        const eye = st.live ? (w.h.core ?? 1.3) * (0.4 + 0.9 * k) : 0.01;
        w.eye.scale.set(eye, eye, 1);
        w.eye.visible = st.live;
        // (a faint still ring marks it before its lap, and a brighter one while it warns)
        w.ringMat.opacity = st.phase === 'off' ? 0.18 : st.warn > 0 ? 0.35 + 0.5 * st.warn * (Math.floor(clock * 6) % 2 ? 1 : 0.6) : st.live ? 0.5 : 0.25;
      }
      // the vessels, where they are on the clock, with their wakes spreading behind them
      for (const v of vessels) {
        const h = v.h;
        v.g.visible = !h.gone;
        if (v.wake) v.wake.visible = !h.gone;
        if (h.gone) continue;
        v.g.position.set(h.x, Math.sin(clock * 1.7 + h.s) * 0.05, h.z);
        v.g.rotation.y = headingOf(h.tx, h.tz);
        if (v.roll) v.roll.rotation.y = clock * 0.6;
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
          puddleMesh.setColorAt(n, tint.setScalar(0.32 * (1 - age / PUDDLE_T)));
          dummy.scale.setScalar(0.5 + age * 0.8);
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
          for (const d of crestsAt(race, sw, race.time)) {
            if (c >= CRESTS) break;
            for (let k = 0; k <= crestPts; k++) {
              const s = sw.s0 + 4 + ((sw.s1 - sw.s0 - 8) * k) / crestPts;
              // (a ragged line: whitecaps, thicker as it gathers over the channel)
              const w = 0.25 + 0.35 * (1 - Math.min(1, Math.abs(d) / 25)) + 0.15 * Math.sin(k * 2.3 + clock * 4);
              const p0 = pointAt(t, s, d - w);
              const p1 = pointAt(t, s, d + w);
              const o = (c * (crestPts + 1) + k) * 2;
              crestPos.setXYZ(o, p0.x, 0.09, p0.z);
              crestPos.setXYZ(o + 1, p1.x, 0.09, p1.z);
            }
            c++;
          }
        }
        // (the rest folded away)
        for (; c < CRESTS; c++) for (let k = 0; k <= crestPts; k++) for (const q of [0, 1]) crestPos.setXYZ((c * (crestPts + 1) + k) * 2 + q, 0, -10, 0);
        crestPos.needsUpdate = true;
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
