import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { clamp, createGL, damp, disposeTree, type GL } from './gl';
import { apply, create, fmtTime, frameNotation, frameTurn, inferTurn, inLayer, scramble, seeded, sliceTurn, snapAxis, tick, undo, viewFrame, type Axis, type Cube, type Face, type Turn, type Vec } from './logic';
import { meta } from './meta';
import './cube.css';

type Three = typeof import('three');

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={(ms) => `${fmtTime(ms)}s`}>
      <Play />
    </GameShell>
  );
}

const BODY = 0.97;
const STICKER = 0.84;
const STICKER_R = 0.13;
const COLORS: Record<string, number> = { px: 0xe0283a, nx: 0xff7417, py: 0xf4f4f1, ny: 0xffd23a, pz: 0x1aa85f, nz: 0x1f64e0 };
const TURN_MS = 170;
const QUICK_MS = 95;
const FAST_MS = 55;
const QUARTER = Math.PI / 2;
/** Drag distance (in cube units) that turns a layer a quarter. */
const DRAG_PER_QUARTER = 1.7;
const DEFAULT_YAW = -0.62;
const DEFAULT_PITCH = 0.5;

type QueueItem = { turn: Turn; record: boolean; fast?: boolean; undo?: boolean; marker?: boolean };
type Anim = { axis: Axis; layer: -1 | 0 | 1; from: number; to: number; t: number; ms: number; items: QueueItem[]; quarters: number };

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  rig: T.Group;
  cube: T.Group;
  pivot: T.Group;
  yaw: number;
  pitch: number;
  spin: { yaw: number; pitch: number };
  pop: number;
  party: number;
  meshes: T.Mesh[];
  ray: T.Raycaster;
  anim: Anim | null;
  queue: QueueItem[];
  view: { w: number; h: number; cx: number; cy: number; s: number };
  fit: () => void;
  dispose: () => void;
};

/** Rounded square, centered, in the XY plane facing +Z. */
function stickerGeometry(THREE: Three) {
  const h = STICKER / 2;
  const r = STICKER_R;
  const pts: number[] = [0, 0, 0];
  const seg = 5;
  const corners: [number, number, number][] = [
    [h - r, h - r, 0],
    [-h + r, h - r, Math.PI / 2],
    [-h + r, -h + r, Math.PI],
    [h - r, -h + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (Math.PI / 2);
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0);
  }
  const n = pts.length / 3 - 1;
  const idx: number[] = [];
  for (let i = 1; i <= n; i++) idx.push(0, i, (i % n) + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A cubie body with softly rounded edges. */
function bodyGeometry(THREE: Three) {
  const b = 0.07;
  const half = BODY / 2 - b;
  const r = 0.05;
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: BODY - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 2 });
  geo.translate(0, 0, -(BODY - 2 * b) / 2);
  geo.computeVertexNormals();
  return geo;
}

function build(THREE: Three, host: HTMLElement, model: Cube): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4152, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(3, 6, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc8d8ff, 0.7);
  rim.position.set(-6, 3, -5);
  scene.add(rim);
  const low = new THREE.DirectionalLight(0xffe2c8, 0.35);
  low.position.set(2, -6, 3);
  scene.add(low);

  const rig = new THREE.Group();
  rig.rotation.order = 'XYZ';
  rig.rotation.set(DEFAULT_PITCH, DEFAULT_YAW, 0);
  scene.add(rig);
  const cube = new THREE.Group();
  rig.add(cube);
  const pivot = new THREE.Group();
  rig.add(pivot);

  const bodyGeo = bodyGeometry(THREE);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.42, metalness: 0.05 });
  const stickerGeo = stickerGeometry(THREE);
  const stickerMats: Record<string, T.Material> = {};
  for (const k of Object.keys(COLORS)) stickerMats[k] = new THREE.MeshStandardMaterial({ color: COLORS[k], roughness: 0.3, metalness: 0 });
  const faces: [string, number, 1 | -1][] = [
    ['px', 0, 1],
    ['nx', 0, -1],
    ['py', 1, 1],
    ['ny', 1, -1],
    ['pz', 2, 1],
    ['nz', 2, -1],
  ];
  const meshes = model.cubies.map((c) => {
    const m = new THREE.Mesh(bodyGeo, bodyMat);
    for (const [k, axis, sign] of faces) {
      if (c.home[axis] !== sign) continue;
      const s = new THREE.Mesh(stickerGeo, stickerMats[k]);
      const off = BODY / 2 + 0.004;
      if (axis === 0) s.rotation.y = (sign * Math.PI) / 2;
      else if (axis === 1) s.rotation.x = (-sign * Math.PI) / 2;
      else if (sign < 0) s.rotation.y = Math.PI;
      s.position.setComponent(axis, sign * off);
      s.raycast = () => {};
      m.add(s);
    }
    m.position.set(c.pos[0], c.pos[1], c.pos[2]);
    cube.add(m);
    return m;
  });

  const world: World = {
    gl,
    scene,
    camera,
    rig,
    cube,
    pivot,
    yaw: DEFAULT_YAW,
    pitch: DEFAULT_PITCH,
    spin: { yaw: 0, pitch: 0 },
    pop: 0,
    party: 0,
    meshes,
    ray: new THREE.Raycaster(),
    anim: null,
    queue: [],
    view: { w: 0, h: 0, cx: 0, cy: 0, s: 0 },
    fit() {
      const { w, h, cx, cy, s } = world.view;
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // distance that makes the cube's turning radius fill the free square `s`
      const R = 2.55;
      const tan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
      camera.position.z = clamp((R * h) / (Math.max(40, s) * tan), 6, 60);
      camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };
  return world;
}

function syncMeshes(THREE: Three, w: World, model: Cube) {
  const m4 = new THREE.Matrix4();
  model.cubies.forEach((c, i) => {
    const mesh = w.meshes[i];
    if (mesh.parent !== w.cube) w.cube.attach(mesh);
    mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
    const r = c.rot;
    m4.set(r[0][0], r[0][1], r[0][2], 0, r[1][0], r[1][1], r[1][2], 0, r[2][0], r[2][1], r[2][2], 0, 0, 0, 0, 1);
    mesh.quaternion.setFromRotationMatrix(m4);
  });
  w.pivot.rotation.set(0, 0, 0);
}

function setPivot(w: World, axis: Axis, angle: number) {
  w.pivot.rotation.set(axis === 0 ? angle : 0, axis === 1 ? angle : 0, axis === 2 ? angle : 0);
}

/** Layout offset of an element inside the shell root, unaffected by the frame's CSS transforms. */
function offsetIn(el: HTMLElement | null, root: HTMLElement | null) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return el ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}

type Drag = {
  id: number;
  x: number;
  y: number;
  t: number;
  mode: 'orbit' | 'face' | 'turn';
  vx: number;
  vy: number;
  cubie?: number;
  normal?: Vec;
  plane?: T.Plane;
  start?: T.Vector3;
  axis?: Axis;
  layer?: -1 | 0 | 1;
  along?: Axis;
  sign?: number;
  angle?: number;
  vel?: number;
};
type Phase = 'idle' | 'scrambling' | 'waiting' | 'inspect' | 'solving' | 'solved';

const FACE_KEYS: Record<string, Face> = { KeyU: 'U', KeyD: 'D', KeyL: 'L', KeyR: 'R', KeyF: 'F', KeyB: 'B' };
const SLICE_KEYS: Record<string, 'M' | 'E' | 'S'> = { KeyM: 'M', KeyE: 'E', KeyS: 'S' };
const isSeed = (d: unknown): d is { t: 'cube-seed'; seed: number } => !!d && typeof d === 'object' && (d as { t?: unknown }).t === 'cube-seed' && Number.isInteger((d as { seed?: unknown }).seed);
const isSeedAsk = (d: unknown) => !!d && typeof d === 'object' && (d as { t?: unknown }).t === 'cube-seed?';

function Play() {
  const shell = useShell();
  const THREE = useThree();
  const online = useOnline();
  const { best } = useHighScore(meta.id, { lowerIsBetter: true });
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const model = useRef<Cube>(create());
  const drag = useRef<Drag | null>(null);
  const timeEl = useRef<HTMLElement | null>(null);
  const movesEl = useRef<HTMLSpanElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const scrRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const [scrambleText, setScrambleText] = useState('');
  const [last, setLast] = useState<{ text: string; id: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rect, setRect] = useState({ cx: 0, cy: 0, top: 0, s: 0 });
  const [u, setU] = useState(1);
  const lastNow = useRef<number | null>(null);
  const measuredAt = useRef(0);
  const doneAt = useRef<number | null>(null);
  const seed = useRef<number | null>(null);
  const [seedKey, setSeedKey] = useState(0);
  const started = useRef(false);

  const isOnline = !!online;
  const isHost = !!online?.isHost;
  const round = online?.round ?? 0;
  const side = size.h > 0 && size.h < 330 && size.w > size.h * 1.45;
  const playing = shell.status === 'playing';

  // --- online: the host picks one scramble for the round and everyone plays it
  const onlineRef = useRef(online);
  onlineRef.current = online;
  useEffect(() => {
    const room = onlineRef.current;
    if (!room) return;
    if (room.isHost && seed.current == null) {
      seed.current = Math.floor(Math.random() * 2 ** 31);
      setSeedKey((k) => k + 1);
    }
    const off = room.onMessage((from, d) => {
      if (onlineRef.current?.isHost) {
        if (isSeedAsk(d) && seed.current != null) onlineRef.current.send({ t: 'cube-seed', seed: seed.current }, { to: from });
        return;
      }
      if (from === 0 && isSeed(d) && seed.current == null) {
        seed.current = d.seed;
        setSeedKey((k) => k + 1);
      }
    });
    let ask = 0;
    if (room.isHost) room.send({ t: 'cube-seed', seed: seed.current });
    else {
      room.send({ t: 'cube-seed?' }, { to: 0 });
      ask = window.setInterval(() => {
        if (seed.current == null) onlineRef.current?.send({ t: 'cube-seed?' }, { to: 0 });
        else window.clearInterval(ask);
      }, 1500);
    }
    return () => {
      off();
      window.clearInterval(ask);
    };
  }, [isOnline, isHost, round]);

  const setPhaseNow = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const frame = () => viewFrame(world.current?.yaw ?? DEFAULT_YAW);

  const enqueue = (item: QueueItem) => {
    const w = world.current;
    if (!w || w.queue.length > 40) return;
    w.queue.push(item);
  };
  const busy = () => phaseRef.current === 'scrambling' || phaseRef.current === 'solved' || phaseRef.current === 'waiting';
  const turnNow = (turn: Turn) => {
    if (busy()) return;
    enqueue({ turn, record: true });
  };

  const doScramble = (seedValue?: number) => {
    const w = world.current;
    if (!w || !THREE || shell.status !== 'playing' || drag.current?.mode === 'turn') return;
    if (phaseRef.current === 'scrambling') return;
    // start over from a solved cube, so the scramble shown is the one you can reproduce
    w.queue = [];
    w.anim = null;
    const fresh = create();
    model.current = fresh;
    syncMeshes(THREE, w, fresh);
    const copy = create();
    const turns = scramble(copy, 22, seedValue != null ? seeded(seedValue) : Math.random);
    const f = viewFrame(DEFAULT_YAW);
    setScrambleText(turns.map((t) => frameNotation(f, t)).join(' '));
    for (const t of turns) enqueue({ turn: t, record: false, fast: true });
    enqueue({ turn: { axis: 0, layer: 0, dir: 1 }, record: false, marker: true });
    fresh.solved = false;
    w.pop = 1;
    setPhaseNow('scrambling');
    setCanUndo(false);
    sfx.play('select', 0.8);
  };

  const doUndo = () => {
    const w = world.current;
    const m = model.current;
    if (!w || w.anim || w.queue.length || drag.current?.mode === 'turn' || !m.history.length || phaseRef.current !== 'solving') return;
    const t = m.history[m.history.length - 1];
    enqueue({ turn: { ...t, dir: t.dir === 1 ? -1 : 1 }, record: false, undo: true });
  };

  /** Buttons hand focus back to the game so the keyboard keeps working after a click. */
  const press = (fn: () => void) => {
    fn();
    shell.root.current?.focus({ preventScroll: true });
  };

  const startClock = () => {
    const m = model.current;
    if (m.scrambled && !m.solved && !m.timing) {
      m.timing = true;
      setPhaseNow('solving');
    }
  };

  const keys = useKeys((code, e) => {
    if (shell.status !== 'playing' || e?.repeat) return;
    if (FACE_KEYS[code]) {
      turnNow(frameTurn(frame(), FACE_KEYS[code], !!e?.shiftKey));
      e?.preventDefault();
    } else if (SLICE_KEYS[code]) {
      turnNow(sliceTurn(frame(), SLICE_KEYS[code], !!e?.shiftKey));
      e?.preventDefault();
    } else if (code === 'KeyZ' || code === 'Backspace') {
      doUndo();
      e?.preventDefault();
    } else if (code === 'Space' && !isOnline && phaseRef.current !== 'solving') doScramble();
  });

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host, model.current);
    if (!w) return;
    world.current = w;
    syncMeshes(THREE, w, model.current);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  // The phone and iPad frames scale the whole screen down; grow the HUD by the inverse so it stays finger sized.
  const measureU = () => {
    const el = shell.root.current;
    if (!el || !shell.touch || !el.offsetWidth) return;
    const k = el.getBoundingClientRect().width / el.offsetWidth;
    const next = k > 0.3 && k < 0.99 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1;
    if (Math.abs(next - u) > 0.005) setU(next);
  };
  useEffect(() => {
    measureU();
    const el = shell.root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureU());
    ro.observe(el);
    return () => ro.disconnect();
  });
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    el.style.setProperty('--g-cube-u', String(u));
    return () => {
      el.style.removeProperty('--g-cube-u');
    };
  }, [u]);

  // Fit the cube into the space the HUD leaves free.
  useLayoutEffect(() => {
    const w = world.current;
    const root = shell.root.current;
    if (!size.w || !size.h || !root) return;
    const ctrl = offsetIn(root.querySelector<HTMLElement>('.arcade-ctrl'), root);
    const host = offsetIn(ref.current, root);
    const ox = host?.x ?? 0;
    const oy = host?.y ?? 0;
    const hud = offsetIn(hudRef.current, root);
    const bar = offsetIn(barRef.current, root);
    const scr = offsetIn(scrRef.current, root);
    const top0 = 8;
    let box = { left: 8, right: size.w - 8, top: top0, bottom: size.h - 8 };
    const below = (r: ReturnType<typeof offsetIn>) => (r ? r.y - oy + r.h + 6 : top0);
    if (side) {
      let left = 8;
      for (const r of [hud, bar, scr]) if (r && r.w > 0) left = Math.max(left, r.x - ox + r.w + 10);
      // either squeeze in beside the shell controls, or sit under them, whichever leaves the bigger square
      const beside = { left, right: ctrl ? ctrl.x - ox - 8 : size.w - 8, top: isOnline ? 40 : top0, bottom: size.h - 6 };
      const under = { left, right: size.w - 8, top: Math.max(isOnline ? 40 : top0, below(ctrl) - 2), bottom: size.h - 6 };
      const area = (b: typeof box) => Math.min(b.right - b.left, b.bottom - b.top);
      box = area(beside) >= area(under) ? beside : under;
    } else {
      const tops = [hud, scr, ctrl].filter((r): r is NonNullable<typeof r> => !!r && r.h > 0 && r.y - oy < size.h / 2).map((r) => below(r));
      box.top = Math.max(top0, ...tops);
      if (bar) box.bottom = Math.min(box.bottom, bar.y - oy - 8);
    }
    const { left, top } = box;
    const rw = Math.max(40, box.right - box.left);
    const rh = Math.max(40, box.bottom - box.top);
    const cx = left + rw / 2;
    const cy = top + rh / 2;
    if (w) {
      w.view = { w: size.w, h: size.h, cx, cy, s: Math.min(rw, rh) * (side ? 1.04 : 0.94) };
      w.fit();
      shell.invalidate();
    }
    const sq = Math.min(rw, rh);
    if (Math.abs(rect.cx - cx) > 0.5 || Math.abs(rect.cy - cy) > 0.5 || Math.abs(rect.top - top) > 0.5 || Math.abs(rect.s - sq) > 0.5) setRect({ cx, cy, top, s: sq });
  });

  useEffect(() => {
    lastNow.current = null;
  }, [shell.status, shell.active]);

  useEffect(() => {
    if (shell.status !== 'playing' || started.current || !world.current) return;
    if (isOnline && seed.current == null) {
      setPhaseNow('waiting');
      return;
    }
    started.current = true;
    doScramble(seed.current ?? undefined);
  }, [shell.status, THREE, seedKey, isOnline]);

  const finishScramble = (m: Cube) => {
    m.history = [];
    m.moves = 0;
    m.time = 0;
    m.timing = false;
    m.scrambled = true;
    m.solved = false;
    setPhaseNow('inspect');
  };

  const finishAnim = (w: World, a: Anim) => {
    const m = model.current;
    const wasSolved = m.solved;
    const f = frame();
    for (const item of a.items) {
      if (item.undo) {
        undo(m);
        setLast({ text: 'Undo', id: performance.now() });
      } else apply(m, item.turn, item.record);
    }
    const shown = a.items.filter((i) => i.record);
    if (shown.length) setLast({ text: frameNotation(f, shown[0].turn, shown.length), id: performance.now() });
    syncMeshes(THREE!, w, m);
    w.anim = null;
    setCanUndo(m.history.length > 0);
    if (!wasSolved && m.solved && m.scrambled && phaseRef.current === 'solving') {
      setPhaseNow('solved');
      w.queue = [];
      w.party = 1;
      doneAt.current = m.time;
      sfx.play('win');
    }
  };

  const nextAnim = (w: World) => {
    const m = model.current;
    while (!w.anim && w.queue.length) {
      const next = w.queue.shift()!;
      if (next.marker) {
        finishScramble(m);
        continue;
      }
      if (next.record) startClock();
      const ms = next.fast ? FAST_MS : w.queue.some((q) => !q.marker) ? QUICK_MS : TURN_MS;
      w.anim = { axis: next.turn.axis, layer: next.turn.layer, from: 0, to: next.turn.dir * QUARTER, t: 0, ms, items: [next], quarters: 1 };
      m.cubies.forEach((c, i) => {
        if (inLayer(c, next.turn)) w.pivot.attach(w.meshes[i]);
      });
      sfx.play('tick', next.fast ? 1.5 : 1 + Math.random() * 0.08);
    }
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      const m = model.current;
      if (!w || !THREE) return;
      const now = performance.now();
      if (now - measuredAt.current > 600) {
        measuredAt.current = now;
        measureU();
      }
      if (shell.status !== 'playing') {
        // attract: a slow turn on the Start card
        if (shell.status === 'ready') {
          w.yaw += dt * 0.35;
          w.rig.rotation.set(w.pitch, w.yaw, 0);
        }
        return;
      }
      const real = lastNow.current == null ? dt * 1000 : Math.min(now - lastNow.current, 1000);
      lastNow.current = now;
      tick(m, real);

      // view: arrow keys orbit, flicks coast to a stop
      const kx = (keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0);
      const ky = (keys.down('ArrowDown') ? 1 : 0) - (keys.down('ArrowUp') ? 1 : 0);
      if (kx || ky) {
        w.spin.yaw = damp(w.spin.yaw, kx * 2.4, 14, dt);
        w.spin.pitch = damp(w.spin.pitch, ky * 1.6, 14, dt);
      } else if (drag.current?.mode !== 'orbit') {
        w.spin.yaw = damp(w.spin.yaw, 0, 4, dt);
        w.spin.pitch = damp(w.spin.pitch, 0, 4, dt);
      }
      if (drag.current?.mode !== 'orbit') {
        w.yaw += w.spin.yaw * dt;
        w.pitch = clamp(w.pitch + w.spin.pitch * dt, -1.2, 1.2);
      }
      let yaw = w.yaw;
      let scale = 1;
      if (w.pop > 0) {
        w.pop = Math.max(0, w.pop - dt / 0.28);
        scale = 1 - 0.06 * Math.sin(w.pop * Math.PI);
      }
      if (w.party > 0) {
        w.party = Math.max(0, w.party - dt / 1.1);
        const p = 1 - w.party;
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        yaw += e * Math.PI * 2;
        scale = 1 + 0.07 * Math.sin(p * Math.PI);
        if (w.party === 0) {
          w.rig.rotation.set(w.pitch, w.yaw, 0);
          shell.gameOver(doneAt.current ?? m.time, { title: 'Solved', detail: `${m.moves} moves in ${fmtTime(doneAt.current ?? m.time)}s.` });
          return;
        }
      }
      w.rig.rotation.set(w.pitch, yaw, 0);
      w.rig.scale.setScalar(scale);

      if (drag.current?.mode !== 'turn') nextAnim(w);
      const a = w.anim;
      if (a) {
        a.t = Math.min(1, a.t + (dt * 1000) / a.ms);
        const e = 1 - Math.pow(1 - a.t, 3);
        setPivot(w, a.axis, a.from + (a.to - a.from) * e);
        if (a.t >= 1) finishAnim(w, a);
      }
      const t = fmtTime(m.time);
      if (timeEl.current && timeEl.current.textContent !== t) timeEl.current.textContent = t;
      const mv = m.moves === 1 ? '1 Move' : `${m.moves} Moves`;
      if (movesEl.current && movesEl.current.textContent !== mv) movesEl.current.textContent = mv;
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
    { always: shell.status === 'ready' },
  );

  const local = (e: React.PointerEvent<HTMLDivElement>) => {
    const host = ref.current!;
    const ne = e.nativeEvent;
    // offsetX/Y stay in layout pixels under the laptop's 3D transform and the handheld frames' scale
    let x = ne.offsetX;
    let y = ne.offsetY;
    if (ne.target !== host && ne.target instanceof HTMLElement && ne.target.parentElement === host) {
      x += ne.target.offsetLeft;
      y += ne.target.offsetTop;
    }
    return { x, y };
  };
  const ndc = (p: { x: number; y: number }) => {
    const host = ref.current!;
    return new THREE!.Vector2((p.x / host.clientWidth) * 2 - 1, -(p.y / host.clientHeight) * 2 + 1);
  };
  const rigInverse = (w: World) => w.rig.getWorldQuaternion(new THREE!.Quaternion()).invert();

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    if (!w || !THREE || drag.current) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (shell.status !== 'playing') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    w.ray.setFromCamera(ndc(p), w.camera);
    const d: Drag = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), mode: 'orbit', vx: 0, vy: 0 };
    const hits = w.ray.intersectObjects(w.meshes, false);
    if (hits.length && !w.anim && !w.queue.length && !busy() && w.party === 0) {
      const hit = hits[0];
      const mesh = hit.object as T.Mesh;
      const worldNormal = hit.face!.normal.clone().transformDirection(mesh.matrixWorld);
      const localNormal = worldNormal.clone().applyQuaternion(rigInverse(w));
      const sn = snapAxis([localNormal.x, localNormal.y, localNormal.z]);
      const normal: Vec = [0, 0, 0];
      normal[sn.axis] = sn.sign;
      const pos = model.current.cubies[w.meshes.indexOf(mesh)].pos;
      if (pos[sn.axis] === sn.sign) {
        d.mode = 'face';
        d.cubie = w.meshes.indexOf(mesh);
        d.normal = normal;
        const n = new THREE.Vector3(normal[0], normal[1], normal[2]).applyQuaternion(w.rig.getWorldQuaternion(new THREE.Quaternion()));
        d.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
        d.start = hit.point.clone();
      }
    }
    if (d.mode === 'orbit') w.spin = { yaw: 0, pitch: 0 };
    drag.current = d;
    setDragging(true);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    const d = drag.current;
    if (!w || !THREE || !d || d.id !== e.pointerId) return;
    const p = local(e);
    const now = performance.now();
    const dtm = Math.max(1, now - d.t);
    if (d.mode === 'orbit') {
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      d.x = p.x;
      d.y = p.y;
      d.t = now;
      // yaw around the cube's vertical axis, tilt around the screen's horizontal axis, never roll
      const k = 0.0085 * (360 / Math.max(240, Math.min(size.w, size.h)));
      w.yaw += dx * k;
      w.pitch = clamp(w.pitch + dy * k, -1.2, 1.2);
      d.vx = damp(d.vx, (dx * k * 1000) / dtm, 18, dtm / 1000);
      d.vy = damp(d.vy, (dy * k * 1000) / dtm, 18, dtm / 1000);
      if (shell.status !== 'playing') shell.invalidate();
      return;
    }
    w.ray.setFromCamera(ndc(p), w.camera);
    const hitP = new THREE.Vector3();
    if (!w.ray.ray.intersectPlane(d.plane!, hitP)) return;
    const delta = hitP.sub(d.start!).applyQuaternion(rigInverse(w));
    const dv: Vec = [delta.x, delta.y, delta.z];
    if (d.mode === 'face') {
      if (Math.hypot(p.x - d.x, p.y - d.y) < 9) return;
      const turn = inferTurn(d.normal!, dv, model.current.cubies[d.cubie!].pos);
      if (!turn || w.anim || w.queue.length || busy()) {
        d.mode = 'orbit';
        d.x = p.x;
        d.y = p.y;
        return;
      }
      const nAxis = snapAxis(d.normal!).axis;
      const along = (3 - nAxis - turn.axis) as Axis;
      d.mode = 'turn';
      d.axis = turn.axis;
      d.layer = turn.layer;
      d.along = along;
      d.sign = Math.sign(dv[along]) * turn.dir;
      d.angle = 0;
      d.vel = 0;
      d.t = now;
      model.current.cubies.forEach((c, i) => {
        if (inLayer(c, turn)) w.pivot.attach(w.meshes[i]);
      });
      startClock();
      sfx.play('tick', 0.9);
    }
    if (d.mode === 'turn') {
      const angle = clamp(((dv[d.along!] * d.sign!) / DRAG_PER_QUARTER) * QUARTER, -Math.PI, Math.PI);
      d.vel = damp(d.vel!, (angle - d.angle!) / dtm, 20, dtm / 1000);
      d.angle = angle;
      d.t = now;
      setPivot(w, d.axis!, angle);
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (!w) return;
    if (d.mode === 'orbit') {
      const fresh = performance.now() - d.t < 80;
      w.spin = fresh ? { yaw: clamp(d.vx, -9, 9), pitch: clamp(d.vy, -6, 6) } : { yaw: 0, pitch: 0 };
      return;
    }
    if (d.mode !== 'turn') return;
    const angle = d.angle ?? 0;
    // a flick carries the layer on to the next quarter
    const fresh = performance.now() - d.t < 90;
    const throwTo = angle + (fresh ? clamp(d.vel ?? 0, -0.02, 0.02) * 140 : 0);
    const q = clamp(Math.round(throwTo / QUARTER), -2, 2);
    const items: QueueItem[] = [];
    for (let i = 0; i < Math.abs(q); i++) items.push({ turn: { axis: d.axis!, layer: d.layer!, dir: (q > 0 ? 1 : -1) as 1 | -1 }, record: true });
    const left = Math.abs(q * QUARTER - angle) / QUARTER;
    w.anim = { axis: d.axis!, layer: d.layer!, from: angle, to: q * QUARTER, t: 0, ms: 40 + 130 * Math.min(1, left), items, quarters: Math.abs(q) };
    if (q) sfx.play('tick', 1.05);
    if (shell.status !== 'playing') shell.invalidate();
  };

  const m = model.current;
  const hint =
    phase === 'waiting'
      ? 'Waiting for the scramble'
      : phase === 'inspect'
        ? shell.touch
          ? 'Drag a face to turn it. Drag around the cube to look.'
          : 'Drag a face or press U D L R F B. Shift turns the other way.'
        : '';
  const style = { '--g-cube-cx': `${rect.cx}px`, '--g-cube-cy': `${rect.cy}px`, '--g-cube-s': `${rect.s}px` } as React.CSSProperties;
  return (
    <div className={`g-cube-play ${side ? 'is-side' : 'is-stack'} ${isOnline ? 'is-online' : ''}`} style={style}>
      <div ref={ref} className={`g-cube-host ${dragging ? 'is-dragging' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <div ref={hudRef} className="g-cube-hud">
        <strong ref={timeEl}>{fmtTime(m.time)}</strong>
        <span ref={movesEl}>{m.moves === 1 ? '1 Move' : `${m.moves} Moves`}</span>
        {best != null && <span className="g-cube-best">Best {fmtTime(best)}</span>}
      </div>
      <div ref={barRef} className="g-cube-bar">
        <button type="button" className="arcade-btn" onClick={() => press(doUndo)} disabled={!playing || !canUndo || phase !== 'solving'}>
          Undo
        </button>
        {!isOnline && (
          <button type="button" className="arcade-btn arcade-btn-primary" onClick={() => press(() => doScramble())} disabled={!playing || phase === 'scrambling' || phase === 'solved'}>
            Scramble
          </button>
        )}
      </div>
      {scrambleText && phase !== 'solved' && (
        <div ref={scrRef} className="g-cube-scramble" aria-label="Scramble">
          {scrambleText}
        </div>
      )}
      {last && (
        <div key={last.id} className="g-cube-last" style={{ top: rect.top }}>
          {last.text}
        </div>
      )}
      {playing && hint && <div className="g-cube-hint">{hint}</div>}
    </div>
  );
}
