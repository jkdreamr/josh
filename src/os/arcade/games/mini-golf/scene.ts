// The three.js side: builds a hole's course, decor, movers and balls, fits the camera and draws effects.
import type { T } from './gl';
import { createGL, disposeTree, damp } from './gl';
import type { Decor, Hole } from './holes';
import { type Ball, CUP_R, R, ballPos, height, segments, slidePos, sweepAngle } from './physics';

type Three = typeof import('three');
export type BallView = { ball: Ball | null; color: string; ghost: boolean };
export type World = {
  setHole: (h: Hole, fly: boolean) => void;
  update: (t: number, dt: number, balls: BallView[]) => void;
  aim: (a: { x: number; z: number; angle: number; power: number } | null) => void;
  pick: (px: number, py: number, y: number) => { x: number; z: number } | null;
  splash: (x: number, z: number) => void;
  sink: (x: number, z: number) => void;
  resize: (w: number, h: number) => void;
  render: () => void;
  dispose: () => void;
};

const STONE = '#cdb48a';
const ROOF = '#b5523b';
const BASE = -0.35;

export function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true, maxDpr: 2 });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 160);
  scene.add(new THREE.HemisphereLight(0xf3f8ff, 0x55623a, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.position.set(-5, 12, 7);
  scene.add(sun);
  let root = new THREE.Group();
  scene.add(root);
  const fx = new THREE.Group();
  scene.add(fx);
  let mats = new Map<string, T.Material>();
  const lam = (c: string) => {
    let m = mats.get(c);
    if (!m) mats.set(c, (m = new THREE.MeshLambertMaterial({ color: c })));
    return m;
  };
  const mesh = (g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0, p: T.Object3D = root) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    p.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, c: string, x: number, y: number, z: number, p: T.Object3D = root) => mesh(new THREE.BoxGeometry(w, h, d), lam(c), x, y, z, p);
  const cyl = (rt: number, rb: number, h: number, c: string, x: number, y: number, z: number, p: T.Object3D = root, seg = 14) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), lam(c), x, y, z, p);
  const ball = (r: number, c: string, x: number, y: number, z: number, p: T.Object3D = root) => mesh(new THREE.SphereGeometry(r, 12, 10), lam(c), x, y, z, p);

  let hole: Hole | null = null;
  let flag: T.Object3D | null = null;
  let sprays: T.Mesh[] = [];
  let sweeps: { o: T.Object3D; m: Extract<Hole['movers'][number], { k: 'sweep' }> }[] = [];
  let slides: { o: T.Object3D; m: Extract<Hole['movers'][number], { k: 'slide' }> }[] = [];
  let water: T.Mesh[] = [];
  const balls: { m: T.Mesh; s: T.Mesh; mat: T.MeshStandardMaterial }[] = [];
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0b1a08, transparent: true, opacity: 0.28, depthWrite: false });
  const shadowGeo = new THREE.CircleGeometry(R * 1.05, 18);
  const ballGeo = new THREE.SphereGeometry(R, 20, 14);

  const aimGroup = new THREE.Group();
  const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), aimMat);
  shaft.rotation.x = -Math.PI / 2;
  const tri = (pts: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([pts[0], pts[1], 0, pts[2], pts[3], 0, pts[4], pts[5], 0], 3));
    g.computeVertexNormals();
    return g;
  };
  const head = new THREE.Mesh(tri([0, 0.17, 0, -0.17, 0.26, 0]), aimMat);
  head.rotation.x = -Math.PI / 2;
  aimGroup.add(shaft, head);
  aimGroup.visible = false;
  scene.add(aimGroup);

  type Fx = { o: T.Mesh; life: number; max: number; kind: 'ring' | 'bit'; vx?: number; vy?: number; vz?: number };
  const effects: Fx[] = [];
  const fxGeo = { ring: new THREE.RingGeometry(0.8, 1, 32), bit: new THREE.PlaneGeometry(0.07, 0.04) };

  const camPos = new THREE.Vector3(0, 10, 10);
  const camGoal = new THREE.Vector3(0, 10, 10);
  const look = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  let aspect = 1;
  let vw = 1;
  let vh = 1;

  function decor(d: Decor) {
    const g = new THREE.Group();
    g.position.set(d.x, BASE, d.z);
    g.rotation.y = d.a ?? 0;
    g.scale.setScalar((d.s ?? 1) * (d.k === 'palm' ? 0.62 : 1));
    root.add(g);
    switch (d.k) {
      case 'palm': {
        for (let i = 0; i < 5; i++) cyl(0.07 - i * 0.008, 0.08 - i * 0.008, 0.5, '#8a6a46', Math.sin(i * 0.5) * 0.04, 0.25 + i * 0.48, 0, g, 7);
        for (let i = 0; i < 7; i++) {
          const leaf = mesh(new THREE.ConeGeometry(0.12, 1.1, 4), lam(i % 2 ? '#3f7d34' : '#4d8f3c'), 0, 2.55, 0, g);
          leaf.rotation.set(0, (i / 7) * Math.PI * 2, 1.9);
          leaf.position.set(Math.cos((i / 7) * Math.PI * 2) * 0.45, 2.45, -Math.sin((i / 7) * Math.PI * 2) * 0.45);
          leaf.rotateZ(0);
        }
        break;
      }
      case 'tree':
        cyl(0.08, 0.11, 0.9, '#6f5236', 0, 0.45, 0, g, 7);
        ball(0.75, '#4f7f3a', 0, 1.35, 0, g).scale.set(1, 0.8, 1);
        ball(0.5, '#5b8d40', 0.35, 1.7, 0.1, g);
        break;
      case 'tower': {
        box(1.5, 0.6, 1.5, STONE, 0, 0.3, 0, g);
        box(1.15, 6.4, 1.15, '#d8c39b', 0, 3.8, 0, g);
        for (let i = 0; i < 6; i++) box(1.17, 0.12, 1.17, '#bfa77c', 0, 1.4 + i * 0.95, 0, g);
        box(1.3, 0.9, 1.3, '#e3cfa6', 0, 7.4, 0, g);
        for (const s of [-1, 1]) {
          box(0.18, 0.55, 1.32, '#3d3a34', s * 0.42, 7.4, 0, g).scale.set(1, 1, 0.98);
        }
        mesh(new THREE.SphereGeometry(0.7, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lam(ROOF), 0, 7.85, 0, g);
        cyl(0.03, 0.05, 0.6, '#d8c39b', 0, 8.75, 0, g, 6);
        break;
      }
      case 'dish': {
        box(0.5, 1.6, 0.5, '#d8d8d2', 0, 0.8, 0, g);
        const bowl = mesh(new THREE.SphereGeometry(2.2, 22, 10, 0, Math.PI * 2, 0, 0.9), new THREE.MeshLambertMaterial({ color: '#f1f0ea', side: THREE.DoubleSide }), 0, 3.6, 0, g);
        bowl.rotation.x = Math.PI - 0.7;
        cyl(0.04, 0.04, 2, '#bfbfb8', 0, 3.2, 0.9, g, 6).rotation.x = -0.5;
        break;
      }
      case 'arches': {
        box(9, 1.7, 0.7, STONE, 0, 0.85, 0, g);
        box(9.2, 0.25, 1.1, ROOF, 0, 1.85, 0, g);
        for (let i = 0; i < 8; i++) {
          box(0.62, 0.95, 0.05, '#6b5640', -3.85 + i * 1.1, 0.6, 0.36, g);
          cyl(0.31, 0.31, 0.05, '#6b5640', -3.85 + i * 1.1, 1.08, 0.36, g, 12).rotation.x = Math.PI / 2;
        }
        break;
      }
      case 'church': {
        box(4.4, 3.2, 1.6, STONE, 0, 1.6, 0, g);
        const roof = mesh(new THREE.ConeGeometry(2.6, 1.4, 4), lam(ROOF), 0, 3.85, 0, g);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(1.2, 1, 0.5);
        box(2.6, 1.3, 0.06, '#d9a63a', 0, 2.3, 0.82, g);
        for (let i = 0; i < 3; i++) box(0.6, 1.1, 0.06, '#5b4734', -1.1 + i * 1.1, 0.75, 0.82, g);
        break;
      }
      case 'stands': {
        for (let i = 0; i < 4; i++) box(9, 0.35, 0.6, i % 2 ? '#c9c7c0' : '#b5b2aa', 0, 0.18 + i * 0.35, -i * 0.55, g).scale.y = 1 + i;
        box(9, 0.2, 2.4, '#8c1515', 0, 1.65, -0.9, g);
        break;
      }
      case 'goal': {
        cyl(0.05, 0.05, 1.2, '#f2d03b', 0, 0.6, 0, g, 6);
        box(0.08, 0.08, 1.6, '#f2d03b', 0, 1.2, 0, g);
        for (const s of [-1, 1]) cyl(0.04, 0.04, 1.6, '#f2d03b', 0, 2, s * 0.8, g, 6);
        break;
      }
      case 'barn': {
        box(4, 2, 2.6, '#a33a2c', 0, 1, 0, g);
        const roof = mesh(new THREE.CylinderGeometry(1.55, 1.55, 4.1, 3), lam('#5a4a44'), 0, 2.5, 0, g);
        roof.rotation.set(0, 0, Math.PI / 2);
        roof.scale.set(1, 1, 0.92);
        box(1.3, 1.4, 0.06, '#f1ece2', 0, 0.7, 1.31, g);
        box(1.1, 1.2, 0.07, '#a33a2c', 0, 0.7, 1.32, g);
        break;
      }
      case 'boathouse': {
        box(3.4, 1.4, 1.8, '#d9c7a4', 0, 0.7, 0, g);
        box(3.7, 0.2, 2.1, '#5b3d2e', 0, 1.5, 0, g);
        for (let i = 0; i < 3; i++) box(0.8, 0.9, 0.05, '#3d4752', -1.1 + i * 1.1, 0.55, 0.92, g);
        break;
      }
      case 'boat': {
        const b = box(2.2, 0.06, 0.14, '#f2efe6', 0, -BASE - 0.05, 0, g);
        b.scale.set(1, 1, 1);
        box(0.18, 0.04, 0.16, '#8c1515', 0.2, -BASE - 0.01, 0, g);
        break;
      }
      case 'reeds':
        for (let i = 0; i < 6; i++) cyl(0.012, 0.018, 0.5 + (i % 3) * 0.12, '#5f8a3a', Math.cos(i * 2.1) * 0.14, -BASE + 0.15, Math.sin(i * 2.1) * 0.14, g, 4);
        break;
    }
  }

  function terrain(h: Hole) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const v of h.outline) {
      x0 = Math.min(x0, v.x); z0 = Math.min(z0, v.z); x1 = Math.max(x1, v.x); z1 = Math.max(z1, v.z);
    }
    const S = 0.08;
    const nx = Math.ceil((x1 - x0) / S) + 1;
    const nz = Math.ceil((z1 - z0) / S) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const base = new THREE.Color(h.theme.turf);
    const bed = new THREE.Color('#5d7f6a');
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * S;
        const z = z0 + j * S;
        const y = height(h, x, z);
        const k = (j * nx + i) * 3;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
        const stripe = Math.floor((x - x0) / 0.9) % 2 ? 1 : 0.93;
        c.copy(base).multiplyScalar(stripe * (1 + Math.max(-0.25, Math.min(0.25, y * 0.5))));
        if (y < -0.02) c.lerp(bed, Math.min(1, -y * 9));
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    const idx: number[] = [];
    const ins = (x: number, z: number) => {
      let r = false;
      const o = h.outline;
      for (let a = 0, b = o.length - 1; a < o.length; b = a++) if (o[a].z > z !== o[b].z > z && x < ((o[b].x - o[a].x) * (z - o[a].z)) / (o[b].z - o[a].z) + o[a].x) r = !r;
      return r;
    };
    for (let j = 0; j + 1 < nz; j++)
      for (let i = 0; i + 1 < nx; i++) {
        if (!ins(x0 + (i + 0.5) * S, z0 + (j + 0.5) * S)) continue;
        const a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  function rails(h: Hole) {
    for (const s of segments(h)) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const n = Math.max(1, Math.ceil(L / 0.5));
      for (let i = 0; i < n; i++) {
        const ax = s.ax + ((s.bx - s.ax) * i) / n;
        const az = s.az + ((s.bz - s.az) * i) / n;
        const bx = s.ax + ((s.bx - s.ax) * (i + 1)) / n;
        const bz = s.az + ((s.bz - s.az) * (i + 1)) / n;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const top = Math.max(height(h, ax, az), height(h, bx, bz), height(h, mx, mz)) + 0.17;
        const o = box(L / n + 0.14, top - BASE, 0.14, h.theme.rail, mx, (top + BASE) / 2, mz);
        o.rotation.y = -Math.atan2(bz - az, bx - ax);
        const cap = box(L / n + 0.15, 0.03, 0.15, '#f4efe4', mx, top, mz);
        cap.rotation.y = o.rotation.y;
      }
    }
  }

  function setHole(h: Hole, fly: boolean) {
    disposeTree(root);
    scene.remove(root);
    mats = new Map();
    root = new THREE.Group();
    scene.add(root);
    hole = h;
    sweeps = [];
    slides = [];
    sprays = [];
    water = [];
    host.style.background = `linear-gradient(180deg, ${h.theme.sky[0]} 0%, ${h.theme.sky[1]} 100%)`;
    scene.fog = new THREE.Fog(h.theme.sky[1], 30, 90);
    const ground = mesh(new THREE.PlaneGeometry(140, 140), lam(h.theme.ground), 6, BASE, 0);
    ground.rotation.x = -Math.PI / 2;
    terrain(h);
    rails(h);
    for (const p of h.ponds) {
      const w = mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ color: '#3d8ec2', transparent: true, opacity: 0.88 }), p.x, -p.depth * 0.42, p.z);
      w.rotation.x = -Math.PI / 2;
      w.scale.set(p.rx * 1.02, p.rz * 1.02, 1);
      water.push(w);
    }
    const ty = height(h, h.tee.x, h.tee.z) + 0.004;
    const tee = mesh(new THREE.PlaneGeometry(0.7, 0.6), lam('#2f7d3e'), h.tee.x, ty, h.tee.z);
    tee.rotation.x = -Math.PI / 2;
    const cy = height(h, h.cup.x, h.cup.z);
    const cup = mesh(new THREE.CircleGeometry(CUP_R, 28), new THREE.MeshBasicMaterial({ color: '#141712' }), h.cup.x, cy + 0.006, h.cup.z);
    cup.rotation.x = -Math.PI / 2;
    const rim = mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.035, 28), lam('#f4f1ea'), h.cup.x, cy + 0.007, h.cup.z);
    rim.rotation.x = -Math.PI / 2;
    const f = new THREE.Group();
    f.position.set(h.cup.x + CUP_R * 0.55, cy, h.cup.z);
    root.add(f);
    cyl(0.016, 0.016, 1.15, '#f4f1ea', 0, 0.57, 0, f, 6);
    const cloth = mesh(tri([0, 0, 0, -0.27, 0.42, -0.13]), new THREE.MeshLambertMaterial({ color: '#8c1515', side: THREE.DoubleSide }), 0, 1.13, 0, f);
    flag = cloth;
    for (const p of h.posts) {
      const y = height(h, p.x, p.z);
      if (p.kind === 'fountain') {
        cyl(p.r, p.r + 0.04, 0.3, STONE, p.x, y + 0.15 + BASE / 2, p.z, root, 28).scale.y = 1 - BASE / 0.3;
        const pool = cyl(p.r - 0.12, p.r - 0.12, 0.02, '#4fa3d6', p.x, y + 0.29, p.z, root, 28);
        pool.material = new THREE.MeshLambertMaterial({ color: '#58acd9' });
        cyl(0.16, 0.24, 0.6, STONE, p.x, y + 0.5, p.z, root, 12);
        cyl(0.42, 0.3, 0.1, STONE, p.x, y + 0.82, p.z, root, 16);
        const sm = new THREE.MeshBasicMaterial({ color: '#dff3ff', transparent: true, opacity: 0.8 });
        for (let i = 0; i < 14; i++) {
          const d = mesh(new THREE.SphereGeometry(0.035, 6, 4), sm, p.x, y + 0.9, p.z);
          d.userData = { cx: p.x, cy: y + 0.9, cz: p.z, a: (i / 14) * Math.PI * 2, ph: i / 14 };
          sprays.push(d);
        }
      } else if (p.kind === 'planter') {
        cyl(p.r, p.r * 0.85, 0.32 - BASE, '#b0643f', p.x, y + (0.32 + BASE) / 2, p.z, root, 14);
        ball(p.r * 0.95, '#4a8a3a', p.x, y + 0.42, p.z).scale.y = 0.75;
      } else if (p.kind === 'hay') {
        const hay = cyl(p.r, p.r, 0.5, '#d8b45a', p.x, y + 0.25, p.z, root, 16);
        hay.rotation.z = 0;
        cyl(p.r + 0.005, p.r + 0.005, 0.04, '#a8873a', p.x, y + 0.32, p.z, root, 16);
      } else if (p.kind === 'bollard') {
        cyl(p.r, p.r, 0.55, '#8b8f94', p.x, y + 0.27, p.z, root, 14);
        cyl(p.r * 0.7, p.r, 0.12, '#a5a9ad', p.x, y + 0.6, p.z, root, 14);
      } else cyl(p.r, p.r, 0.34, '#3c3f45', p.x, y + 0.17, p.z, root, 18);
    }
    for (const m of h.movers) {
      const o = new THREE.Group();
      root.add(o);
      if (m.k === 'sweep') {
        o.position.set(m.x, height(h, m.x, m.z), m.z);
        const arm = m.look === 'dish' ? '#eeeee8' : '#9b7546';
        for (let i = 0; i < m.arms; i++) {
          const a = new THREE.Group();
          a.rotation.y = -(i * Math.PI * 2) / m.arms;
          o.add(a);
          box(m.len, 0.16, 0.13, arm, m.len / 2, 0.12, 0, a);
          box(0.18, 0.22, 0.2, m.look === 'dish' ? '#8c1515' : '#7a5a34', m.len - 0.06, 0.13, 0, a);
        }
        cyl(0.34, 0.38, 0.4, m.look === 'dish' ? '#d6d6cf' : '#7a5a34', 0, 0.2, 0, o, 16);
        if (m.look === 'dish') {
          const b = mesh(new THREE.SphereGeometry(0.42, 16, 6, 0, Math.PI * 2, 0, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), 0, 0.85, 0, o);
          b.rotation.x = Math.PI - 0.5;
        }
        sweeps.push({ o, m });
      } else {
        const stad = m.look === 'stadium';
        box(m.hx * 2, 0.3, m.hz * 2, stad ? '#b1040e' : '#a33a2c', 0, 0.15, 0, o);
        if (stad) box(m.hx * 2 + 0.01, 0.06, m.hz * 2 + 0.01, '#f4f1ea', 0, 0.2, 0, o);
        else {
          box(m.hx * 2 + 0.01, 0.04, 0.05, '#f4f1ea', 0, 0.32, m.hz, o);
          box(m.hx * 2 + 0.01, 0.04, 0.05, '#f4f1ea', 0, 0.32, -m.hz, o);
        }
        slides.push({ o, m });
      }
    }
    const L = h.loop;
    if (L) {
      const dx = Math.cos(L.a);
      const dz = Math.sin(L.a);
      for (const side of [-1, 1]) {
        const rail = mesh(new THREE.TorusGeometry(L.r, 0.03, 6, 48), lam('#e9e7e0'), L.x - dz * side * (R + 0.03), L.r, L.z + dx * side * (R + 0.03));
        rail.rotation.y = -L.a;
      }
      for (const side of [-1, 1]) {
        const leg = box(0.06, L.r, 0.06, '#9da1a6', L.x, L.r / 2, L.z + side * 0.42);
        leg.position.x += 0;
      }
    }
    for (const d of h.decor) decor(d);
    fit(fly);
  }

  function bounds() {
    const h = hole!;
    const pts: T.Vector3[] = [];
    for (const v of h.outline) {
      pts.push(new THREE.Vector3(v.x, BASE, v.z));
      pts.push(new THREE.Vector3(v.x, 0.3, v.z));
    }
    if (h.loop) pts.push(new THREE.Vector3(h.loop.x, h.loop.r * 2, h.loop.z));
    return pts;
  }

  function fit(fly: boolean) {
    if (!hole) return;
    const pts = bounds();
    const lo3 = pts.reduce((a, p) => a.min(p), pts[0].clone());
    const hi3 = pts.reduce((a, p) => a.max(p), pts[0].clone());
    const c = lo3.add(hi3).multiplyScalar(0.5);
    c.y = 0;
    const portrait = aspect < 0.95;
    const pitch = portrait ? 1.18 : 1.1;
    const dir = portrait ? new THREE.Vector3(-Math.cos(pitch), Math.sin(pitch), 0) : new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    camera.fov = portrait ? 46 : 36;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const topPad = Math.min(0.5, 70 / vh);
    const botPad = Math.min(0.5, 104 / vh);
    const sidePad = Math.min(0.3, 18 / vw);
    const ok = (d: number) => {
      camera.position.copy(c).addScaledVector(dir, d);
      camera.lookAt(c);
      camera.updateMatrixWorld();
      for (const p of pts) {
        const q = p.clone().project(camera);
        if (Math.abs(q.x) > 1 - sidePad || q.y > 1 - topPad || q.y < -1 + botPad) return false;
      }
      return true;
    };
    let lo = 2;
    let hi = 90;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    camGoal.copy(c).addScaledVector(dir, hi);
    lookGoal.copy(c);
    if (fly) {
      camPos.copy(camGoal).addScaledVector(dir, 5).add(new THREE.Vector3(portrait ? 0 : -3, 2, portrait ? -3 : 0));
      look.copy(c).add(new THREE.Vector3(-2, 0, 0));
    } else {
      camPos.copy(camGoal);
      look.copy(lookGoal);
    }
    camera.position.copy(camPos);
    camera.lookAt(look);
  }

  function update(t: number, dt: number, views: BallView[]) {
    const h = hole;
    if (!h) return;
    const k = 1 - Math.exp(-2.6 * dt);
    camPos.lerp(camGoal, k);
    look.lerp(lookGoal, k);
    camera.position.copy(camPos);
    camera.lookAt(look);
    const time = t / 120;
    if (flag) flag.rotation.y = Math.sin(time * 2.1) * 0.35;
    for (const { o, m } of sweeps) o.rotation.y = -sweepAngle(m, t);
    for (const { o, m } of slides) {
      const q = slidePos(m, t);
      o.position.set(q.x, height(h, q.x, q.z), q.z);
    }
    for (const d of sprays) {
      const u = d.userData as { cx: number; cy: number; cz: number; a: number; ph: number };
      const f = (time * 0.9 + u.ph) % 1;
      const r = 0.05 + f * 0.55;
      d.position.set(u.cx + Math.cos(u.a) * r, u.cy + 0.55 * Math.sin(f * Math.PI) + 0.1 - f * 0.45, u.cz + Math.sin(u.a) * r);
    }
    for (const w of water) w.position.y = -0.06 + Math.sin(time * 1.3) * 0.004;
    while (balls.length < views.length) {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.02, transparent: true });
      const m = new THREE.Mesh(ballGeo, mat);
      const s = new THREE.Mesh(shadowGeo, shadowMat);
      s.rotation.x = -Math.PI / 2;
      scene.add(m, s);
      balls.push({ m, s, mat });
    }
    balls.forEach((b, i) => {
      const v = views[i];
      const show = !!v?.ball && v.ball.state !== 'holed';
      b.m.visible = b.s.visible = show;
      if (!show || !v.ball) return;
      const p = ballPos(h, v.ball);
      b.m.position.set(p.x, p.y, p.z);
      b.mat.color.set(v.color);
      b.mat.opacity = v.ghost ? 0.5 : 1;
      b.mat.depthWrite = !v.ghost;
      b.s.visible = !v.ball.loop && v.ball.state !== 'water';
      b.s.position.set(p.x + 0.03, height(h, p.x, p.z) + 0.008, p.z + 0.03);
    });
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.life += dt;
      const f = e.life / e.max;
      const mat = e.o.material as T.MeshBasicMaterial;
      if (e.kind === 'ring') {
        const s = 0.15 + f * 0.7;
        e.o.scale.set(s, s, s);
        mat.opacity = 0.8 * (1 - f);
      } else {
        e.vy! -= 6 * dt;
        e.o.position.x += e.vx! * dt;
        e.o.position.y += e.vy! * dt;
        e.o.position.z += e.vz! * dt;
        e.o.rotation.x += dt * 7;
        e.o.rotation.z += dt * 5;
        mat.opacity = Math.min(1, 2 * (1 - f));
      }
      if (f >= 1) {
        fx.remove(e.o);
        mat.dispose();
        effects.splice(i, 1);
      }
    }
  }

  function ring(x: number, z: number, color: string, max: number) {
    const h = hole;
    if (!h) return;
    const o = new THREE.Mesh(fxGeo.ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    o.rotation.x = -Math.PI / 2;
    o.position.set(x, Math.max(height(h, x, z), -0.06) + 0.02, z);
    fx.add(o);
    effects.push({ o, life: 0, max, kind: 'ring' });
  }

  return {
    setHole,
    update,
    aim(a) {
      if (!a || !hole) {
        aimGroup.visible = false;
        return;
      }
      aimGroup.visible = true;
      const len = 0.35 + a.power * 2.3;
      aimGroup.position.set(a.x, height(hole, a.x, a.z) + 0.03, a.z);
      aimGroup.rotation.y = -a.angle;
      shaft.scale.set(len, 0.07 + a.power * 0.05, 1);
      shaft.position.x = R + len / 2;
      head.position.x = R + len;
      head.scale.setScalar(0.8 + a.power * 0.5);
      const c = new THREE.Color('#ffffff').lerp(new THREE.Color(a.power > 0.55 ? '#f0533f' : '#ffd24a'), a.power > 0.55 ? (a.power - 0.55) / 0.45 : a.power / 0.55);
      aimMat.color.copy(c);
    },
    pick(px, py, y) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((px / vw) * 2 - 1, -(py / vh) * 2 + 1), camera);
      const out = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out) ? { x: out.x, z: out.z } : null;
    },
    splash(x, z) {
      ring(x, z, '#e6f6ff', 0.7);
      setTimeout(() => ring(x, z, '#bfe6ff', 0.8), 120);
    },
    sink(x, z) {
      ring(x, z, '#ffd24a', 0.6);
      const colors = ['#8c1515', '#ffd24a', '#f4f1ea', '#5aa9e6', '#4caf50'];
      for (let i = 0; i < 36; i++) {
        const o = new THREE.Mesh(fxGeo.bit, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, side: THREE.DoubleSide }));
        o.position.set(x, 0.2, z);
        fx.add(o);
        const a = (i / 36) * Math.PI * 2;
        const s = 0.8 + ((i * 37) % 10) / 10;
        effects.push({ o, life: 0, max: 1.4, kind: 'bit', vx: Math.cos(a) * s, vy: 2.6 + ((i * 13) % 7) / 5, vz: Math.sin(a) * s });
      }
    },
    resize(w, h) {
      if (!w || !h) return;
      vw = w;
      vh = h;
      aspect = w / h;
      gl.renderer.setSize(w, h, false);
      fit(false);
    },
    render() {
      if (!gl.lost()) gl.renderer.render(scene, camera);
    },
    dispose() {
      disposeTree(scene);
      shadowGeo.dispose();
      ballGeo.dispose();
      fxGeo.ring.dispose();
      fxGeo.bit.dispose();
      gl.dispose();
    },
  };
}

export { damp };
