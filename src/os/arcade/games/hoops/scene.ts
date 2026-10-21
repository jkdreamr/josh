// The arena for Hoops: court, stands, glass backboard, rim, a string net that reacts to the ball, the balls and their trails.
import type { T } from './gl';
import { clamp, createGL, damp, disposeTree, type GL } from './gl';
import {
  BALL_R,
  BOARD_BOTTOM,
  BOARD_OFF,
  BOARD_T,
  BOARD_TOP,
  BOARD_W,
  G,
  HOOP_Z,
  NET_H,
  RIM_R,
  RIM_TUBE,
  RIM_Y,
  THREE_D,
  netRadius,
  type Ball,
  type V3,
} from './logic';

type Three = typeof import('three');

const BASELINE = HOOP_Z - BOARD_OFF - 1.2;
const COURT_W = 15;
const COURT_D = 14;
const NET_N = 12;
const NET_RINGS = 5;
const GUIDE_N = 12;
const POOL = 4;
const TRAIL = 22;

export type Frame = {
  balls: Ball[];
  /** the ball waiting in the hands, if any */
  hand: V3 | null;
  hoopX: number;
  /** where the camera stands behind the shooter, and what it frames */
  spot: V3;
  sway: number;
  fire: boolean;
  guide: { p: V3; v: V3 } | null;
};

export type World = {
  gl: GL;
  resize: (w: number, h: number) => void;
  update: (f: Frame, dt: number) => void;
  /** screen position (css px) of a world point */
  project: (p: V3) => { x: number; y: number };
  kick: (kind: 'rim' | 'board' | 'swish', power: number) => void;
  render: () => void;
  dispose: () => void;
};

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function courtTexture(THREE: Three) {
  const S = 64;
  const [c, g] = canvas(COURT_W * S, COURT_D * S);
  const X = (x: number) => (x + COURT_W / 2) * S;
  const Z = (z: number) => (z - BASELINE) * S;
  // maple boards with a little grain and tone
  for (let i = 0; i * 0.09 * S < c.width; i++) {
    const x = i * 0.09 * S;
    for (let z = 0; z < c.height; ) {
      const len = (1.2 + ((i * 7919 + z) % 13) / 6) * S;
      const t = 0.92 + (((i * 31 + z * 17) % 97) / 97) * 0.14;
      g.fillStyle = `rgb(${Math.round(214 * t)},${Math.round(162 * t)},${Math.round(104 * t)})`;
      g.fillRect(x, z, 0.09 * S, len);
      g.fillStyle = 'rgba(70,40,10,0.18)';
      g.fillRect(x, z, 0.09 * S, 1.5);
      z += len;
    }
    g.fillStyle = 'rgba(70,40,10,0.14)';
    g.fillRect(x, 0, 1, c.height);
  }
  // painted key
  g.fillStyle = 'rgba(196,74,34,0.82)';
  g.fillRect(X(-2.45), 0, 4.9 * S, Z(BASELINE + 5.8));
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 0.05 * S;
  g.strokeRect(X(-2.45), -10, 4.9 * S, Z(BASELINE + 5.8) + 10);
  g.beginPath();
  g.arc(X(0), Z(BASELINE + 5.8), 1.8 * S, 0, Math.PI);
  g.stroke();
  g.setLineDash([0.35 * S, 0.3 * S]);
  g.beginPath();
  g.arc(X(0), Z(BASELINE + 5.8), 1.8 * S, Math.PI, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // restricted area
  g.beginPath();
  g.arc(X(0), Z(HOOP_Z), 1.25 * S, 0, Math.PI);
  g.stroke();
  // three point line
  const side = 6.6;
  const cut = Math.sqrt(THREE_D * THREE_D - side * side);
  const a0 = Math.atan2(cut, side);
  g.beginPath();
  g.moveTo(X(-side), 0);
  g.lineTo(X(-side), Z(HOOP_Z + cut));
  g.arc(X(0), Z(HOOP_Z), THREE_D * S, Math.PI - a0, a0, true);
  g.lineTo(X(side), 0);
  g.stroke();
  // half court
  g.beginPath();
  g.arc(X(0), Z(BASELINE + COURT_D), 1.8 * S, Math.PI, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(0, Z(BASELINE + COURT_D) - 0.05 * S, c.width, 0.05 * S);
  // centre logo, original: a ring with a dot
  g.strokeStyle = 'rgba(196,74,34,0.75)';
  g.lineWidth = 0.18 * S;
  g.beginPath();
  g.arc(X(0), Z(BASELINE + COURT_D), 1.1 * S, Math.PI, Math.PI * 2);
  g.stroke();
  const tex = new (THREE.CanvasTexture)(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function ballTexture(THREE: Three) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const dx = Math.cos(lat) * Math.cos(lon);
      const dy = Math.sin(lat);
      const dz = Math.cos(lat) * Math.sin(lon);
      const curve = Math.abs(Math.abs(dx) - 0.68 - 0.26 * dz * dz);
      const seam = Math.min(Math.abs(dy), Math.abs(dz), curve);
      const n = Math.sin(x * 2.7 + Math.sin(y * 3.1) * 3) * Math.sin(y * 2.9 + Math.cos(x * 1.7) * 2);
      const pebble = 0.93 + n * 0.07;
      const i = (y * W + x) * 4;
      if (seam < 0.022) {
        img.data[i] = 34;
        img.data[i + 1] = 20;
        img.data[i + 2] = 14;
      } else {
        const edge = seam < 0.035 ? 0.82 : 1;
        img.data[i] = 214 * pebble * edge;
        img.data[i + 1] = 98 * pebble * edge;
        img.data[i + 2] = 38 * pebble * edge;
      }
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function softDot(THREE: Three, inner: string, outer: string) {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bannerTexture(THREE: Three) {
  const [c, g] = canvas(1024, 64);
  g.fillStyle = '#101218';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = 'rgba(232,112,42,0.5)';
  g.fillRect(0, 61, 1024, 3);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 8; i++) g.fillRect(i * 128 + 8, 10, 112, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type NetNode = { rest: V3; off: V3; vel: V3 };

export function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { maxDpr: 2 });
  if (!gl) return null;
  const { renderer } = gl;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x0c0d12, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0c0d12, 13, 30);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);

  scene.add(new THREE.HemisphereLight(0xfff3e4, 0x2a2018, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(3, 10, 8);
  scene.add(key);
  const rimLight = new THREE.DirectionalLight(0xffd6a8, 0.6);
  rimLight.position.set(-4, 6, -6);
  scene.add(rimLight);

  // court and the dark apron around it
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x23201e }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.005, 6);
  scene.add(apron);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_D), new THREE.MeshStandardMaterial({ map: courtTexture(THREE), roughness: 0.38, metalness: 0 }));
  court.rotation.x = -Math.PI / 2;
  court.position.set(0, 0, BASELINE + COURT_D / 2);
  scene.add(court);

  // stands behind the baseline, rows of fans as small boxes
  const rows = 9;
  const per = 46;
  const fans = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.42, 0.26), new THREE.MeshLambertMaterial({ color: 0xffffff }), rows * per * 3);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const shirts = [0x2b3a67, 0xe8702a, 0xdedede, 0x3c3c44, 0x8a2f2f, 0x2f6a4f, 0xc9a14a, 0x5a4a7a];
  let n = 0;
  const steps = new THREE.Group();
  const stepMat = new THREE.MeshLambertMaterial({ color: 0x1a1b22 });
  const sections: { x: number; z: number; rot: number }[] = [
    { x: 0, z: BASELINE - 3.2, rot: 0 },
    { x: -11.5, z: 5, rot: Math.PI / 2 },
    { x: 11.5, z: 5, rot: -Math.PI / 2 },
  ];
  for (const s of sections) {
    for (let r = 0; r < rows; r++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(per * 0.5, 0.45, 0.8), stepMat);
      const lz = -r * 0.8;
      const ly = 0.6 + r * 0.45;
      tier.position.set(s.x + Math.sin(s.rot) * lz, ly - 0.22, s.z + Math.cos(s.rot) * lz);
      tier.rotation.y = s.rot;
      steps.add(tier);
      for (let i = 0; i < per; i++) {
        if (((i * 13 + r * 7) % 11) === 0) continue;
        const lx = (i - per / 2) * 0.5 + (r % 2) * 0.2;
        const x = s.x + Math.cos(s.rot) * lx + Math.sin(s.rot) * lz;
        const z = s.z - Math.sin(s.rot) * lx + Math.cos(s.rot) * lz;
        m.makeRotationY(s.rot);
        m.setPosition(x, ly + 0.25, z);
        fans.setMatrixAt(n, m);
        col.setHex(shirts[(i * 5 + r * 3 + (i >> 2)) % shirts.length]).multiplyScalar(0.13 + ((i * 7 + r) % 5) * 0.03);
        fans.setColorAt(n, col);
        n++;
      }
    }
  }
  fans.count = n;
  scene.add(steps, fans);
  const ads = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.75), new THREE.MeshBasicMaterial({ map: bannerTexture(THREE) }));
  ads.material.map!.wrapS = THREE.RepeatWrapping;
  ads.material.map!.repeat.x = 2;
  ads.position.set(0, 0.38, BASELINE - 2.2);
  scene.add(ads);
  // arena lights hanging in the dark
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (let i = -2; i <= 2; i++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.5), lampMat);
    lamp.position.set(i * 4, 11, 2);
    scene.add(lamp);
  }

  // hoop: stanchion, glass board, rim and net, moving together
  const hoop = new THREE.Group();
  scene.add(hoop);
  const pad = new THREE.MeshStandardMaterial({ color: 0x1d2a4a, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.45, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.6), pad);
  base.position.set(0, 0.45, BASELINE - 1.9);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.9, 0.3), pad);
  pole.position.set(0, 2.3, BASELINE - 1.5);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.1), steel);
  arm.position.set(0, 3.55, (BASELINE - 1.5 + HOOP_Z - BOARD_OFF) / 2 - 0.1);
  arm.rotation.x = -0.12;
  hoop.add(base, pole, arm);

  const boardZ = HOOP_Z - BOARD_OFF - BOARD_T / 2;
  const bh = BOARD_TOP - BOARD_BOTTOM;
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, bh, BOARD_T),
    new THREE.MeshPhysicalMaterial({ color: 0xdfe9f2, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  glass.position.set(0, (BOARD_TOP + BOARD_BOTTOM) / 2, boardZ);
  hoop.add(glass);
  const white = new THREE.MeshBasicMaterial({ color: 0xf6f6f6 });
  const bar = (w: number, h: number, x: number, y: number, z = HOOP_Z - BOARD_OFF + 0.003, mat: T.Material = white) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat);
    b.position.set(x, y, z);
    hoop.add(b);
  };
  const e = 0.05;
  bar(BOARD_W, e, 0, BOARD_TOP - e / 2);
  bar(BOARD_W, e, 0, BOARD_BOTTOM + e / 2);
  bar(e, bh, -BOARD_W / 2 + e / 2, (BOARD_TOP + BOARD_BOTTOM) / 2);
  bar(e, bh, BOARD_W / 2 - e / 2, (BOARD_TOP + BOARD_BOTTOM) / 2);
  const sqB = RIM_Y + 0.03;
  bar(0.59, e, 0, sqB + 0.45 - e / 2);
  bar(0.59, e, 0, sqB + e / 2);
  bar(e, 0.45, -0.295 + e / 2, sqB + 0.225);
  bar(e, 0.45, 0.295 - e / 2, sqB + 0.225);
  const padBottom = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.04, 0.07, BOARD_T + 0.05), pad);
  padBottom.position.set(0, BOARD_BOTTOM - 0.02, boardZ);
  hoop.add(padBottom);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0482a, roughness: 0.35, metalness: 0.4, emissive: 0x000000 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE + 0.006, 10, 48), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, RIM_Y, HOOP_Z);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, BOARD_OFF - RIM_R), rimMat);
  bracket.position.set(0, RIM_Y - 0.01, HOOP_Z - RIM_R - (BOARD_OFF - RIM_R) / 2);
  hoop.add(rim, bracket);

  // net: rings of nodes on springs; strands zig-zag between rings
  const nodes: NetNode[][] = [];
  const step = (Math.PI * 2) / NET_N;
  for (let j = 0; j < NET_RINGS; j++) {
    const y = RIM_Y - (j / (NET_RINGS - 1)) * NET_H;
    const r = netRadius(y);
    const ring: NetNode[] = [];
    for (let k = 0; k < NET_N; k++) {
      const a = (k + j * 0.5) * step;
      ring.push({ rest: { x: Math.cos(a) * r, y, z: HOOP_Z + Math.sin(a) * r }, off: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } });
    }
    nodes.push(ring);
  }
  const netMat = new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.9 });
  const strands: { line: T.Line; pick: [number, number][] }[] = [];
  for (let k = 0; k < NET_N; k++) {
    for (const dir of [1, -1]) {
      const pick: [number, number][] = [];
      for (let j = 0; j < NET_RINGS; j++) pick.push([j, (((k + (dir > 0 ? 0 : -j)) % NET_N) + NET_N) % NET_N]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NET_RINGS * 3), 3));
      const line = new THREE.Line(geo, netMat);
      line.frustumCulled = false;
      hoop.add(line);
      strands.push({ line, pick });
    }
  }
  // bottom loop
  const loopGeo = new THREE.BufferGeometry();
  loopGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((NET_N + 1) * 3), 3));
  const loop = new THREE.Line(loopGeo, netMat);
  loop.frustumCulled = false;
  hoop.add(loop);

  // balls
  const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 20);
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(THREE), roughness: 0.62, metalness: 0, emissive: 0xff5a10, emissiveIntensity: 0 });
  const shadowMat = new THREE.MeshBasicMaterial({ map: softDot(THREE, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(BALL_R * 3.4, BALL_R * 3.4);
  const pool: { mesh: T.Mesh; shadow: T.Mesh; id: number; q: T.Quaternion }[] = [];
  for (let i = 0; i < POOL; i++) {
    const mesh = new THREE.Mesh(ballGeo, ballMat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    mesh.visible = shadow.visible = false;
    scene.add(mesh, shadow);
    pool.push({ mesh, shadow, id: -1, q: new THREE.Quaternion() });
  }
  const trailMat = new THREE.SpriteMaterial({ map: softDot(THREE, 'rgba(255,220,140,1)', 'rgba(255,80,0,0)'), transparent: true, depthWrite: false, blending: 2 });
  const trail: { s: T.Sprite; life: number; vy: number }[] = [];
  for (let i = 0; i < TRAIL; i++) {
    const s = new THREE.Sprite(trailMat);
    s.visible = false;
    scene.add(s);
    trail.push({ s, life: 0, vy: 0 });
  }
  let trailAt = 0;
  let trailClock = 0;

  // aim guide: a few dots along the first part of the flight
  const guide = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), GUIDE_N);
  guide.frustumCulled = false;
  guide.visible = false;
  scene.add(guide);

  const tmpQ = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const look = new THREE.Vector3();
  const proj = new THREE.Vector3();
  let W = 1;
  let H = 1;
  const cam = { x: 0, y: 2.5, z: 6, pitch: 0, fov: 50, lx: 0, ready: false };
  let rimGlow = 0;
  let shake = 0;
  let boardWobble = 0;

  const frameCamera = (f: Frame, dt: number) => {
    const s = f.spot;
    const d = Math.hypot(s.x, s.z - HOOP_Z) || 1;
    const ux = s.x / d;
    const uz = (s.z - HOOP_Z) / d;
    const back = 2.6 + d * 0.1;
    const tx = s.x + ux * back;
    const tz = s.z + uz * back;
    const ty = 2.85 + d * 0.04;
    const aspect = W / H;
    // vertical: the ball in the hands near the bottom, the top of the board near the top
    const handD = back + 0.3;
    const boardD = d + back + BOARD_OFF;
    const lo = Math.atan2(1.42 - ty, handD);
    const hi = Math.atan2(BOARD_TOP + 0.25 - ty, boardD);
    let vf = (hi - lo) * 1.12;
    const pitch = (hi + lo) / 2 + (hi - lo) * 0.04;
    // horizontal: the board plus however far it swings
    const half = BOARD_W / 2 + f.sway + 0.5;
    const hf = 2 * Math.atan2(half, boardD);
    vf = Math.max(vf, 2 * Math.atan(Math.tan(hf / 2) / aspect));
    // wide, short windows: keep the hoop big and let the hands drop below the frame
    const most = 2 * Math.atan(Math.tan(Math.atan2(BOARD_W / 2, boardD) / 0.4) / aspect);
    let tilt = pitch;
    if (vf > most) {
      vf = most;
      tilt = hi + 0.02 - vf / 2;
    }
    const fov = clamp((vf * 180) / Math.PI, 30, 88);
    const k = cam.ready ? 3.2 : 1000;
    cam.x = damp(cam.x, tx, k, dt);
    cam.y = damp(cam.y, ty, k, dt);
    cam.z = damp(cam.z, tz, k, dt);
    cam.pitch = damp(cam.pitch, tilt, k, dt);
    cam.fov = damp(cam.fov, fov, k, dt);
    cam.lx = damp(cam.lx, f.hoopX * 0.35, cam.ready ? 2 : 1000, dt);
    cam.ready = true;
    shake = Math.max(0, shake - dt * 1.6);
    const j = shake * shake * 0.06;
    camera.position.set(cam.x + (Math.random() - 0.5) * j, cam.y + (Math.random() - 0.5) * j, cam.z);
    const hx = cam.lx - cam.x;
    const hz = HOOP_Z - cam.z;
    const hl = Math.hypot(hx, hz) || 1;
    look.set(cam.x + hx / hl, cam.y + Math.tan(cam.pitch), cam.z + hz / hl);
    camera.lookAt(look);
    if (Math.abs(camera.fov - cam.fov) > 0.01) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  };

  const updateNet = (f: Frame, dt: number) => {
    const hx = f.hoopX;
    const near = f.balls.filter((b) => b.live && Math.abs(b.p.y - (RIM_Y - NET_H / 2)) < NET_H && Math.hypot(b.p.x - hx, b.p.z - HOOP_Z) < RIM_R + BALL_R * 2);
    for (let j = 1; j < NET_RINGS; j++) {
      for (const nd of nodes[j]) {
        const px = hx + nd.rest.x + nd.off.x;
        const py = nd.rest.y + nd.off.y;
        const pz = nd.rest.z + nd.off.z;
        for (const b of near) {
          const dx = px - b.p.x;
          const dy = py - b.p.y;
          const dz = pz - b.p.z;
          const dd = Math.hypot(dx, dy, dz);
          const lim = BALL_R + 0.012;
          if (dd < lim && dd > 1e-5) {
            const p = (lim - dd) / dd;
            nd.off.x += dx * p;
            nd.off.y += dy * p * 0.4;
            nd.off.z += dz * p;
            nd.vel.x += b.v.x * 0.08;
            nd.vel.y += Math.min(0, b.v.y) * 0.08;
            nd.vel.z += b.v.z * 0.08;
          }
        }
        const stiff = 90 / (j * 0.7 + 1);
        for (const a of ['x', 'y', 'z'] as const) {
          nd.vel[a] += (-nd.off[a] * stiff - nd.vel[a] * 6) * dt;
          nd.off[a] += nd.vel[a] * dt;
        }
      }
    }
    for (const s of strands) {
      const pos = s.line.geometry.getAttribute('position') as T.BufferAttribute;
      s.pick.forEach(([j, k], i) => {
        const nd = nodes[j][k];
        pos.setXYZ(i, nd.rest.x + nd.off.x, nd.rest.y + nd.off.y, nd.rest.z + nd.off.z);
      });
      pos.needsUpdate = true;
    }
    const lp = loop.geometry.getAttribute('position') as T.BufferAttribute;
    for (let k = 0; k <= NET_N; k++) {
      const nd = nodes[NET_RINGS - 1][k % NET_N];
      lp.setXYZ(k, nd.rest.x + nd.off.x, nd.rest.y + nd.off.y, nd.rest.z + nd.off.z);
    }
    lp.needsUpdate = true;
  };

  const world: World = {
    gl,
    resize(w, h) {
      if (!w || !h) return;
      W = w;
      H = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    project(p) {
      proj.set(p.x, p.y, p.z).project(camera);
      return { x: ((proj.x + 1) / 2) * W, y: ((1 - proj.y) / 2) * H };
    },
    kick(kind, power) {
      if (kind === 'rim') {
        rimGlow = Math.min(1, 0.4 + power * 0.2);
        shake = Math.min(1, shake + power * 0.12);
      } else if (kind === 'board') {
        boardWobble = Math.min(1, power * 0.15);
        shake = Math.min(1, shake + power * 0.1);
      } else {
        for (const ring of nodes) for (const nd of ring) nd.vel.y -= 0.6 * power;
      }
    },
    update(f, dt) {
      frameCamera(f, dt);
      hoop.position.x = f.hoopX;
      rimGlow = Math.max(0, rimGlow - dt * 3);
      rimMat.emissive.setRGB(rimGlow * 0.6, rimGlow * 0.18, 0);
      boardWobble = Math.max(0, boardWobble - dt * 2.5);
      glass.rotation.x = Math.sin(performance.now() / 30) * boardWobble * 0.01;
      updateNet(f, dt);
      ballMat.emissiveIntensity = damp(ballMat.emissiveIntensity, f.fire ? 0.55 : 0, 4, dt);

      const shown = f.balls.filter((b) => b.live).slice(0, POOL - 1);
      const used = new Set<number>();
      const place = (id: number, p: V3, w: V3 | null) => {
        let slot = pool.find((s) => s.id === id && !used.has(pool.indexOf(s)));
        if (!slot) slot = pool.find((s, i) => !used.has(i) && !shown.some((b) => b.id === s.id)) ?? pool.find((_, i) => !used.has(i))!;
        used.add(pool.indexOf(slot));
        slot.id = id;
        slot.mesh.visible = slot.shadow.visible = true;
        slot.mesh.position.set(p.x, p.y, p.z);
        if (w) {
          const sp = Math.hypot(w.x, w.y, w.z);
          if (sp > 1e-4) {
            axis.set(w.x / sp, w.y / sp, w.z / sp);
            tmpQ.setFromAxisAngle(axis, sp * dt);
            slot.q.premultiply(tmpQ);
          }
        }
        slot.mesh.quaternion.copy(slot.q);
        slot.shadow.position.set(p.x, 0.004, p.z);
        slot.shadow.scale.setScalar(clamp(1.15 - p.y / 8, 0.45, 1.1));
        (slot.shadow.material as T.MeshBasicMaterial).opacity = 1;
      };
      for (const b of shown) place(b.id, b.p, b.w);
      if (f.hand) place(0, f.hand, null);
      pool.forEach((s, i) => {
        if (!used.has(i)) {
          s.mesh.visible = s.shadow.visible = false;
          s.id = -1;
        }
      });

      // fire trail
      trailClock += dt;
      if (f.fire) {
        const src = shown.length ? shown : [];
        while (trailClock > 0.018) {
          trailClock -= 0.018;
          for (const b of src) {
            const t = trail[trailAt++ % TRAIL];
            t.life = 1;
            t.vy = 0.4 + Math.random() * 0.4;
            t.s.position.set(b.p.x + (Math.random() - 0.5) * 0.08, b.p.y + (Math.random() - 0.5) * 0.08, b.p.z + (Math.random() - 0.5) * 0.08);
          }
          if (!src.length && f.hand && Math.random() < 0.5) {
            const t = trail[trailAt++ % TRAIL];
            t.life = 0.6;
            t.vy = 0.6;
            t.s.position.set(f.hand.x + (Math.random() - 0.5) * 0.18, f.hand.y + 0.05, f.hand.z + (Math.random() - 0.5) * 0.18);
          }
        }
      } else trailClock = 0;
      for (const t of trail) {
        if (t.life <= 0) {
          t.s.visible = false;
          continue;
        }
        t.life -= dt * 2.6;
        t.s.visible = t.life > 0;
        t.s.position.y += t.vy * dt;
        t.s.scale.setScalar(0.08 + 0.22 * Math.max(0, t.life));
        t.s.material.opacity = Math.max(0, t.life);
      }

      // guide
      if (f.guide) {
        const { p, v } = f.guide;
        const tt = Math.max(0.5, (2 * v.y) / G) * 0.42;
        for (let i = 0; i < GUIDE_N; i++) {
          const t = ((i + 2) / (GUIDE_N + 1)) * tt;
          m.makeScale(1 - i / (GUIDE_N * 1.6), 1 - i / (GUIDE_N * 1.6), 1 - i / (GUIDE_N * 1.6));
          m.setPosition(p.x + v.x * t, p.y + v.y * t - 0.5 * G * t * t, p.z + v.z * t);
          guide.setMatrixAt(i, m);
        }
        guide.instanceMatrix.needsUpdate = true;
        guide.visible = true;
      } else guide.visible = false;
    },
    render() {
      if (gl.lost()) return;
      renderer.render(scene, camera);
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };
  return world;
}
