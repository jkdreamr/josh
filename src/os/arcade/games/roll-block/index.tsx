import { useEffect, useMemo, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, TouchControls, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { clamp, createGL, disposeTree, type GL } from './gl';
import { bridgeOn, cells, initialState, parseLevel, step, swipeDir, type Block, type Dir, type Level, type State } from './logic';
import { LEVELS } from './levels';
import { readProgress, writeProgress, type Progress } from './storage';
import { meta } from './meta';
import './roll-block.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

const ROLL_MS = 160;
const FALL_MS = 700;
const WIN_MS = 500;
const INTRO_MS = 700;
const FLIP_MS = 250;
const SPAWN_MS = 350;
const ACCENT = 0x14857a;

type Assets = {
  tileGeo: T.BufferGeometry;
  fragHalfGeo: T.BufferGeometry;
  switchGeo: T.BufferGeometry;
  barGeo: T.BufferGeometry;
  frameGeo: T.BufferGeometry;
  holeGeo: T.BufferGeometry;
  blockGeo: T.BufferGeometry;
  floorA: T.Material;
  floorB: T.Material;
  fragHalf: T.Material;
  bridge: T.Material;
  hole: T.Material;
  frame: T.Material;
  swSoft: T.Material;
  swHard: T.Material;
  blockMats: T.Material[];
};

type TileRec = {
  i: number;
  mesh: T.Mesh;
  pivot?: T.Group; // bridge hinge
  delay: number;
  dipT?: number; // pressed switch dip timer
};

type Anim =
  | { kind: 'intro'; t: number }
  | { kind: 'roll'; t: number; dir: Dir; next: State; win: boolean }
  | { kind: 'fall'; t: number; dir: Dir; fragileCell: [number, number] | null }
  | { kind: 'spawn'; t: number }
  | { kind: 'sink'; t: number };

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  assets: Assets;
  levelGroup: T.Group;
  blockPivot: T.Group;
  blockMesh: T.Mesh;
  tiles: Map<number, TileRec>;
  extras: TileRec[]; // frames, switch bars: same intro rise, no gameplay role
  bridgeCells: Map<string, TileRec[]>;
  switchCells: Map<number, TileRec>;
  bounds: { cx: number; cz: number; w: number; h: number };
  fit: (w: number, h: number, margins?: { top?: number; bottom?: number }) => void;
  dispose: () => void;
};

function setBlockPose(mesh: T.Object3D, b: Block, lift = 0) {
  if (b.o === 'stand') mesh.position.set(b.x, 1 + lift, b.z);
  else if (b.o === 'x') mesh.position.set(b.x + 0.5, 0.5 + lift, b.z);
  else mesh.position.set(b.x, 0.5 + lift, b.z + 0.5);
  mesh.rotation.set(b.o === 'z' ? Math.PI / 2 : 0, 0, b.o === 'x' ? Math.PI / 2 : 0);
}

/** Pivot point + rotation for a roll in direction d: the bottom edge the block tips over. */
function rollPivot(b: Block, d: Dir) {
  const cs = cells(b);
  const xs = cs.map((c) => c[0]);
  const zs = cs.map((c) => c[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  if (d === 'right') return { x: Math.max(...xs) + 0.5, z: cz, axis: 'z', ang: -Math.PI / 2 };
  if (d === 'left') return { x: Math.min(...xs) - 0.5, z: cz, axis: 'z', ang: Math.PI / 2 };
  if (d === 'down') return { x: cx, z: Math.max(...zs) + 0.5, axis: 'x', ang: Math.PI / 2 };
  return { x: cx, z: Math.min(...zs) - 0.5, axis: 'x', ang: -Math.PI / 2 };
}

function makeAssets(THREE: Three): Assets {
  const std = (color: number, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness });
  const side = std(ACCENT, 0.55);
  const top = std(0x4fd8c4, 0.45);
  const bottom = std(0x0b3f3a, 0.8);
  return {
    tileGeo: new THREE.BoxGeometry(0.94, 0.22, 0.94),

    switchGeo: new THREE.CylinderGeometry(0.32, 0.36, 0.07, 24),
    barGeo: new THREE.BoxGeometry(0.5, 0.07, 0.12),
    frameGeo: new THREE.BoxGeometry(1.0, 0.06, 0.08),
    holeGeo: new THREE.BoxGeometry(0.86, 0.2, 0.86),
    blockGeo: new THREE.BoxGeometry(0.94, 2, 0.94),
    floorA: std(0xd7dbe2, 0.85),
    floorB: std(0xc8ced8, 0.85),
    fragHalf: std(0xd97c22, 0.8),
    fragHalfGeo: new THREE.BoxGeometry(0.42, 0.12, 0.9),
    bridge: std(0x5a7aa8, 0.6),
    hole: std(0x06080f, 1),
    frame: std(0x2a3550, 0.7),
    swSoft: std(0x0d7d72, 0.4),
    swHard: std(0xc2410c, 0.5),
    blockMats: [side, side, top, bottom, side, side],
  };
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  gl.renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0e18, 18, 42);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a3140, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(5, 10, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x88a4ff, 0.35);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  const assets = makeAssets(THREE);
  const levelGroup = new THREE.Group();
  scene.add(levelGroup);
  const blockPivot = new THREE.Group();
  scene.add(blockPivot);
  const blockMesh = new THREE.Mesh(assets.blockGeo, assets.blockMats);
  blockMesh.castShadow = true;
  scene.add(blockMesh);

  const world: World = {
    gl,
    scene,
    camera,
    assets,
    levelGroup,
    blockPivot,
    blockMesh,
    tiles: new Map(),
    extras: [],
    bridgeCells: new Map(),
    switchCells: new Map(),
    bounds: { cx: 0, cz: 0, w: 0, h: 0 },
    fit(w, h, margins) {
      if (w <= 0 || h <= 0) return;
      const topPx = margins?.top ?? 46;
      const bottomPx = margins?.bottom ?? 12;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const { cx, cz } = world.bounds;
      // south of the board, elevated ~55deg, slight yaw for depth
      const yaw = 0.22;
      const el = (55 * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
      const look = new THREE.Vector3(cx, -0.4, cz + 0.4);
      const bw = world.bounds.w;
      const bh = world.bounds.h;
      const corners = [
        new THREE.Vector3(-0.6, 0, -0.6),
        new THREE.Vector3(bw - 0.4, 0, -0.6),
        new THREE.Vector3(-0.6, 0, bh - 0.4),
        new THREE.Vector3(bw - 0.4, 0, bh - 0.4),
        // standing block tops above the board corners
        new THREE.Vector3(-0.6, 2.1, -0.6),
        new THREE.Vector3(bw - 0.4, 2.1, -0.6),
        new THREE.Vector3(-0.6, 2.1, bh - 0.4),
        new THREE.Vector3(bw - 0.4, 2.1, bh - 0.4),
      ];
      // pixel margins -> NDC bounds (ndc y is up, screen top is +1)
      const nx = 1 - 16 / w;
      const nyt = 1 - (2 * topPx) / h;
      const nyb = -1 + (2 * bottomPx) / h;
      let lo = 2;
      let hi = 60;
      for (let i = 0; i < 24; i++) {
        const d = (lo + hi) / 2;
        camera.position.copy(look).addScaledVector(dir, d);
        camera.lookAt(look);
        camera.updateMatrixWorld();
        let ok = true;
        for (const c of corners) {
          const p = c.clone().project(camera);
          if (Math.abs(p.x) > nx || p.y > nyt || p.y < nyb) ok = false;
        }
        if (ok) hi = d;
        else lo = d;
      }
      camera.position.copy(look).addScaledVector(dir, hi);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      // shift the look point along camera-up so the board centers in the free area
      const targetY = (nyt + nyb) / 2;
      const p0 = new THREE.Vector3(cx, 0.9, cz).project(camera);
      const off = p0.y - targetY;
      if (Math.abs(off) > 0.002) {
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        look.addScaledVector(camUp, off * hi * Math.tan(((camera.fov / 2) * Math.PI) / 180));
        camera.position.copy(look).addScaledVector(dir, hi);
        camera.lookAt(look);
      }
      const r = Math.max(world.bounds.w, world.bounds.h) * 0.8 + 2;
      sun.position.set(cx + 5, 10, cz + 7);
      sun.target.position.set(cx, 0, cz);
      sun.target.updateMatrixWorld();
      const sc = sun.shadow.camera;
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.near = 1;
      sc.far = 40;
      sc.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };
  return world;
}

/** Rebuilds tile meshes for a level. Geometries and materials are shared, so children are only detached. */
function buildLevel(THREE: Three, world: World, level: Level) {
  const g = world.levelGroup;
  while (g.children.length) g.remove(g.children[0]);
  world.tiles.clear();
  world.extras = [];
  world.bridgeCells.clear();
  world.switchCells.clear();
  world.bounds = { cx: (level.w - 1) / 2, cz: (level.h - 1) / 2, w: level.w, h: level.h };

  const [sx, sz] = [level.start.x, level.start.z];
  for (let z = 0; z < level.h; z++) {
    for (let x = 0; x < level.w; x++) {
      const i = z * level.w + x;
      const t = level.tiles[i];
      if (t === 'void') continue;
      const delay = Math.hypot(x - sx, z - sz) * 55;
      const rec: TileRec = { i, mesh: undefined as unknown as T.Mesh, delay };
      if (t === 'bridge') {
        // hinge on the tile's north edge: off state hangs down like an open trapdoor
        const pivot = new THREE.Group();
        pivot.position.set(x, 0, z - 0.47);
        const mesh = new THREE.Mesh(world.assets.tileGeo, world.assets.bridge);
        mesh.position.set(0, -0.11, 0.47);
        mesh.receiveShadow = true;
        pivot.add(mesh);
        const gLetter = level.bridgeAt[i]!;
        rec.pivot = pivot;
        rec.mesh = mesh;
        if (!world.bridgeCells.has(gLetter)) world.bridgeCells.set(gLetter, []);
        world.bridgeCells.get(gLetter)!.push(rec);
        pivot.userData.on = false;
        g.add(pivot);
      } else if (t === 'goal') {
        const mesh = new THREE.Mesh(world.assets.holeGeo, world.assets.hole);
        mesh.position.set(x, -0.1, z);
        g.add(mesh);
        rec.mesh = mesh;
        for (const [ox, oz, rot] of [
          [0, -0.46, 0],
          [0, 0.46, 0],
          [-0.46, 0, 1],
          [0.46, 0, 1],
        ] as const) {
          const f = new THREE.Mesh(world.assets.frameGeo, world.assets.frame);
          f.position.set(x + ox, 0.02, z + oz);
          if (rot) f.rotation.y = Math.PI / 2;
          g.add(f);
          world.extras.push({ i, mesh: f, delay });
        }
      } else if (t === 'switch') {
        const sw = level.switchAt[i]!;
        const pad = new THREE.Mesh(world.assets.tileGeo, (x + z) % 2 === 0 ? world.assets.floorA : world.assets.floorB);
        pad.position.set(x, -0.11, z);
        pad.receiveShadow = true;
        g.add(pad);
        world.extras.push({ i, mesh: pad, delay });
        const mesh = new THREE.Mesh(world.assets.switchGeo, sw.kind === 'soft' ? world.assets.swSoft : world.assets.swHard);
        mesh.position.set(x, 0.02, z);
        mesh.receiveShadow = true;
        g.add(mesh);
        rec.mesh = mesh;
        world.switchCells.set(i, rec);
        if (sw.kind === 'hard') {
          for (const ry of [Math.PI / 4, -Math.PI / 4]) {
            const bar = new THREE.Mesh(world.assets.barGeo, world.assets.swHard);
            bar.position.set(x, 0.09, z);
            bar.rotation.y = ry;
            g.add(bar);
            world.extras.push({ i, mesh: bar, delay: delay + 60 });
          }
        }
      } else if (t === 'fragile') {
        // two sunken half slabs with a crack down the middle
        const grp = new THREE.Group();
        grp.position.set(x, -0.1, z);
        for (const ox of [-0.24, 0.24]) {
          const half = new THREE.Mesh(world.assets.fragHalfGeo, world.assets.fragHalf);
          half.position.x = ox;
          half.receiveShadow = true;
          grp.add(half);
        }
        g.add(grp);
        rec.mesh = grp as unknown as T.Mesh;
      } else {
        const checker = (x + z) % 2 === 0;
        const mesh = new THREE.Mesh(world.assets.tileGeo, checker ? world.assets.floorA : world.assets.floorB);
        mesh.position.set(x, -0.11, z);
        mesh.receiveShadow = true;
        g.add(mesh);
        rec.mesh = mesh;
      }
      world.tiles.set(i, rec);
    }
  }
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const KEY_DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };

function Play() {
  const shell = useShell();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const progress = useRef<Progress>(readProgress(LEVELS.length));
  const [levelIdx, setLevelIdx] = useState(progress.current.current);
  const level = useMemo(() => parseLevel(LEVELS[levelIdx]), [levelIdx]);

  const st = useRef<State>(initialState(level));
  const undoStack = useRef<State[]>([]);
  const queue = useRef<Dir[]>([]);
  const anim = useRef<Anim | null>({ kind: 'intro', t: 0 });
  const [moves, setMoves] = useState(0);
  const [cleared, setCleared] = useState<{ moves: number; par: number; best: number; isBest: boolean } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [, bump] = useState(0);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const persist = (p: Progress) => {
    progress.current = p;
    writeProgress(p);
  };

  const press = (fn: () => void) => {
    fn();
    shell.root.current?.focus({ preventScroll: true });
  };

  function syncBridges(w: World, lvl: Level, mask: number, instant: boolean) {
    for (const g of lvl.groups) {
      const on = bridgeOn(lvl, mask, g);
      for (const rec of w.bridgeCells.get(g) ?? []) {
        if (!rec.pivot) continue;
        rec.pivot.userData.on = on;
        if (instant) rec.pivot.rotation.x = on ? 0 : -Math.PI / 2;
      }
    }
  }

  function beginPivot(w: World, from: Block, d: Dir) {
    const p = rollPivot(from, d);
    w.blockPivot.position.set(p.x, 0, p.z);
    w.blockPivot.rotation.set(0, 0, 0);
    w.blockPivot.attach(w.blockMesh);
    w.blockPivot.userData.axis = p.axis;
    w.blockPivot.userData.ang = p.ang;
  }

  // pixel margins for the camera fit: top clears the bar, bottom clears the dpad on portrait phones
  const fitMargins = () => {
    const host = ref.current;
    const bar = shell.root.current?.querySelector('.g-roll-block-bar');
    let top = size.w < 640 ? 86 : 46;
    if (host && bar) top = bar.getBoundingClientRect().bottom - host.getBoundingClientRect().top + 8;
    let bottom = 12;
    if (shell.touch && size.h > size.w) bottom = Math.min(190, size.h * 0.34);
    return { top, bottom };
  };

  const loadLevel = (idx: number) => {
    const l = parseLevel(LEVELS[idx]);
    st.current = initialState(l);
    undoStack.current = [];
    queue.current = [];
    setMoves(0);
    setCleared(null);
    setUndoCount(0);
    anim.current = { kind: 'intro', t: 0 };
    setLevelIdx(idx);
    const w = world.current;
    if (w && THREE) {
      buildLevel(THREE, w, l);
      setBlockPose(w.blockMesh, l.start, 2.2);
      w.blockPivot.rotation.set(0, 0, 0);
      syncBridges(w, l, l.initialMask, true);
      w.fit(size.w, size.h, fitMargins());
    }
    bump((v) => v + 1);
  };

  const doRoll = (d: Dir) => {
    if (cleared || !world.current) return;
    if (anim.current) {
      if (anim.current.kind !== 'fall' && anim.current.kind !== 'sink' && queue.current.length < 2) queue.current.push(d);
      return;
    }
    const from: Block = { ...st.current.block };
    const r = step(level, st.current, d);
    undoStack.current.push({ ...st.current, block: { ...st.current.block } });
    setUndoCount(undoStack.current.length);
    st.current = r.state;
    setMoves(r.state.moves);
    const w = world.current;
    if (r.outcome.kind === 'fall') {
      beginPivot(w, from, d);
      anim.current = { kind: 'fall', t: 0, dir: d, fragileCell: r.outcome.fragile ? [from.x, from.z] : null };
    } else {
      beginPivot(w, from, d);
      anim.current = { kind: 'roll', t: 0, dir: d, next: r.state, win: r.outcome.kind === 'win' };
      sfx.play('tick', 0.9);
      if (r.pressed.length) sfx.play('coin', 1.3);
      for (const [x, z] of r.pressed) {
        const rec = w.switchCells.get(z * level.w + x);
        if (rec) rec.dipT = 1;
      }
      if (r.changed.length) syncBridges(w, level, r.state.mask, false);
    }
  };

  const doUndo = () => {
    if (anim.current || cleared) return;
    const s = undoStack.current.pop();
    if (!s || !world.current) return;
    st.current = s;
    setMoves(s.moves);
    setUndoCount(undoStack.current.length);
    setBlockPose(world.current.blockMesh, s.block);
    syncBridges(world.current, level, s.mask, true);
    sfx.play('blip', 0.8);
  };

  const doRetry = () => {
    if (anim.current || cleared) return;
    undoStack.current.push({ ...st.current, block: { ...st.current.block } });
    setUndoCount(undoStack.current.length);
    st.current = initialState(level);
    setMoves(0);
    const w = world.current;
    if (w) {
      setBlockPose(w.blockMesh, st.current.block, 2.2);
      syncBridges(w, level, st.current.mask, true);
    }
    anim.current = { kind: 'spawn', t: 0 };
    sfx.play('select', 0.7);
  };

  const doReplay = () => {
    setCleared(null);
    st.current = initialState(level);
    setMoves(0);
    undoStack.current = [];
    setUndoCount(0);
    anim.current = { kind: 'intro', t: 0 };
    const w = world.current;
    if (w && THREE) {
      buildLevel(THREE, w, level);
      setBlockPose(w.blockMesh, level.start, 2.2);
      syncBridges(w, level, level.initialMask, true);
    }
  };

  const nextLevel = () => {
    if (levelIdx + 1 < LEVELS.length) loadLevel(levelIdx + 1);
  };

  useKeys((code, e) => {
    if (shell.status !== 'playing' || e?.repeat) return;
    if (cleared) {
      if (code === 'Space' || code === 'Enter') nextLevel();
      return;
    }
    if (panelOpen) {
      if (code === 'KeyL' || code === 'Escape') setPanelOpen(false);
      return;
    }
    const d = KEY_DIRS[code];
    if (d) {
      doRoll(d);
      e?.preventDefault();
    } else if (code === 'KeyZ' || code === 'KeyU' || code === 'Backspace') doUndo();
    else if (code === 'KeyR') doRetry();
    else if (code === 'KeyL') setPanelOpen(true);
  });

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    buildLevel(THREE, w, level);
    syncBridges(w, level, level.initialMask, true);
    setBlockPose(w.blockMesh, level.start, 2.2);
    w.fit(size.w, size.h, fitMargins());
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
    // world build only depends on the three.js module arriving
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE]);

  useEffect(() => {
    world.current?.fit(size.w, size.h, fitMargins());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, THREE]);

  useEffect(() => {
    shell.setScore(moves || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves]);

  useGameLoop(
    (dt) => {
      const w = world.current;
      if (!w || !THREE) return;

      // bridge hinges swing toward their on/off pose; pressed switches dip
      for (const recs of w.bridgeCells.values()) {
        for (const rec of recs) {
          const p = rec.pivot;
          if (!p) continue;
          const target = p.userData.on ? 0 : -Math.PI / 2;
          if (p.rotation.x !== target) {
            const stepN = (dt * 1000 * (Math.PI / 2)) / FLIP_MS;
            p.rotation.x = clamp(p.rotation.x + Math.sign(target - p.rotation.x) * stepN, Math.min(0, target), Math.max(0, target));
          }
        }
      }
      for (const rec of w.switchCells.values()) {
        if (rec.dipT && rec.dipT > 0) {
          rec.dipT = Math.max(0, rec.dipT - dt * 3);
          rec.mesh.position.y = 0.02 - 0.06 * Math.sin(Math.PI * (1 - rec.dipT));
        }
      }

      const a = anim.current;
      if (!a) {
        if (queue.current.length && !cleared && !panelOpen) doRoll(queue.current.shift()!);
        return;
      }
      if (a.kind === 'intro') {
        a.t = Math.min(1, a.t + (dt * 1000) / INTRO_MS);
        const rise = (recs: Iterable<TileRec>) => {
          for (const rec of recs) {
            const tt = clamp((a.t * INTRO_MS - rec.delay) / 260, 0, 1);
            const e = ease(tt);
            const m = rec.mesh;
            m.visible = tt > 0;
            const base = rec.pivot ? -0.11 : m.userData.baseY ?? (m.userData.baseY = m.position.y);
            m.position.y = base - (1 - e) * 0.6;
          }
        };
        rise(w.tiles.values());
        rise(w.extras);
        const bd = clamp((a.t * INTRO_MS - 320) / (INTRO_MS - 320), 0, 1);
        setBlockPose(w.blockMesh, st.current.block, 2.2 * (1 - ease(bd)));
        if (a.t >= 1) {
          for (const rec of w.tiles.values()) rec.mesh.visible = true;
          for (const rec of w.extras) rec.mesh.visible = true;
          setBlockPose(w.blockMesh, st.current.block);
          anim.current = null;
        }
        return;
      }
      if (a.kind === 'roll' || a.kind === 'fall') {
        const ms = a.kind === 'roll' ? ROLL_MS : FALL_MS;
        a.t = Math.min(1, a.t + (dt * 1000) / ms);
        const axis = w.blockPivot.userData.axis as 'x' | 'z';
        const ang = w.blockPivot.userData.ang as number;
        let mag: number;
        if (a.kind === 'roll') {
          mag = ease(a.t) * ang;
        } else {
          // tumble past the edge, then drop away
          const spin = a.t < 0.35 ? ease(a.t / 0.35) : 1 + (a.t - 0.35) * 1.1;
          mag = ang * spin;
          const d = a.t < 0.35 ? 0 : (a.t - 0.35) / 0.65;
          w.blockPivot.position.y = -d * d * 4;
          w.blockPivot.userData.yaw = d * 0.15;
          if (a.fragileCell) {
            const rec = w.tiles.get(a.fragileCell[1] * level.w + a.fragileCell[0]);
            if (rec) rec.mesh.position.y = -0.06 - d * d * 4;
          }
        }
        w.blockPivot.rotation.set(axis === 'x' ? mag : 0, w.blockPivot.userData.yaw ?? 0, axis === 'z' ? mag : 0);
        if (a.t >= 1) {
          w.scene.attach(w.blockMesh);
          w.blockPivot.rotation.set(0, 0, 0);
          w.blockPivot.position.set(0, 0, 0);
          w.blockPivot.userData.yaw = 0;
          if (a.kind === 'roll') {
            setBlockPose(w.blockMesh, a.next.block);
            if (a.win) {
              anim.current = { kind: 'sink', t: 0 };
              sfx.play('win');
            } else {
              anim.current = null;
            }
          } else {
            sfx.play('lose', 0.7);
            setToast({ id: Date.now(), text: 'fell off' });
            st.current = initialState(level);
            setMoves(0);
            setBlockPose(w.blockMesh, st.current.block, 2.2);
            syncBridges(w, level, st.current.mask, true);
            if (a.fragileCell) {
              const rec = w.tiles.get(a.fragileCell[1] * level.w + a.fragileCell[0]);
              if (rec) rec.mesh.position.y = -0.1;
            }
            anim.current = { kind: 'spawn', t: 0 };
          }
        }
        return;
      }
      if (a.kind === 'spawn') {
        a.t = Math.min(1, a.t + (dt * 1000) / SPAWN_MS);
        setBlockPose(w.blockMesh, st.current.block, 2.2 * (1 - ease(a.t)));
        if (a.t >= 1) {
          setBlockPose(w.blockMesh, st.current.block);
          anim.current = null;
        }
        return;
      }
      // sink into the hole
      a.t = Math.min(1, a.t + (dt * 1000) / WIN_MS);
      setBlockPose(w.blockMesh, st.current.block, -1.15 * ease(a.t));
      if (a.t >= 1) {
        anim.current = null;
        const id = level.def.id;
        const p = progress.current;
        const prev = p.best[id];
        const best = Math.min(prev ?? Infinity, st.current.moves);
        const isLast = levelIdx + 1 >= LEVELS.length;
        const best2 = { ...p.best, [id]: best };
        if (isLast) {
          let cur = 0;
          for (let i = 0; i < LEVELS.length; i++) {
            if (best2[LEVELS[i].id] === undefined) {
              cur = i;
              break;
            }
          }
          persist({ current: cur, best: best2 });
          const atPar = LEVELS.filter((d) => (best2[d.id] ?? Infinity) <= d.par).length;
          shell.gameOver(undefined, { title: 'All Levels Cleared', detail: `${atPar} of ${LEVELS.length} at par` });
        } else {
          persist({ current: levelIdx + 1, best: best2 });
          setCleared({ moves: st.current.moves, par: level.def.par, best, isBest: prev === undefined || best < prev });
        }
      }
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const swipeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || shell.status !== 'playing') return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const swipeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const w = world.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!w || !THREE) return;
    const rect = ref.current!.getBoundingClientRect();
    const { cx, cz } = w.bounds;
    const toPx = (v: T.Vector3) => {
      const p = v.clone().project(w.camera);
      return [(p.x * 0.5 + 0.5) * rect.width, (-p.y * 0.5 + 0.5) * rect.height] as [number, number];
    };
    const o = toPx(new THREE.Vector3(cx, 0.5, cz));
    const ax = toPx(new THREE.Vector3(cx + 1, 0.5, cz));
    const az = toPx(new THREE.Vector3(cx, 0.5, cz + 1));
    const dir = swipeDir(e.clientX - d.x, e.clientY - d.y, {
      x: [ax[0] - o[0], ax[1] - o[1]],
      z: [az[0] - o[0], az[1] - o[1]],
    });
    if (dir && !cleared && !panelOpen) doRoll(dir);
  };

  const def = level.def;
  const playing = shell.status === 'playing';
  const showHint = playing && levelIdx === 0 && moves === 0 && !cleared && size.h >= 200;
  return (
    <>
      <div ref={ref} className="g-roll-block-host" onPointerDown={swipeStart} onPointerUp={swipeEnd} onPointerCancel={() => (drag.current = null)} />
      <div className="g-roll-block-bar">
        <div className="g-roll-block-pill">
          <strong>level {levelIdx + 1}</strong>
          <span>par {def.par}</span>
        </div>
        <button type="button" className="arcade-btn" onClick={() => press(doUndo)} disabled={!playing || !undoCount || !!cleared} aria-label="Undo">
          Undo
        </button>
        <button type="button" className="arcade-btn" onClick={() => press(() => setPanelOpen(true))} disabled={!playing || !!cleared} aria-label="Levels">
          Levels
        </button>
      </div>
      {showHint && <div className="g-roll-block-hint">{shell.touch ? 'swipe to roll the block. stand it up in the hole' : 'arrow keys roll the block. stand it up in the hole'}</div>}
      {toast && (
        <div key={toast.id} className="g-roll-block-toast" onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}
      {cleared && (
        <div className="g-roll-block-card" role="dialog" aria-label="Level cleared">
          <div className="g-roll-block-card-title">cleared in {cleared.moves} moves</div>
          <div className="g-roll-block-card-sub">{cleared.isBest ? `par ${cleared.par} · new best` : `par ${cleared.par} · best ${cleared.best}`}</div>
          <div className="g-roll-block-card-btns">
            <button type="button" className="arcade-btn" onClick={() => press(doReplay)}>
              Replay
            </button>
            <button type="button" className="arcade-btn arcade-btn-primary" autoFocus onClick={() => press(nextLevel)}>
              Next Level
            </button>
          </div>
        </div>
      )}
      {panelOpen && (
        <div className="g-roll-block-panel" role="dialog" aria-label="Levels">
          <div className="g-roll-block-panel-head">
            <button type="button" className="arcade-btn" onClick={() => press(() => setPanelOpen(false))}>
              Done
            </button>
            <span>levels</span>
          </div>
          <div className="g-roll-block-grid">
            {LEVELS.map((d, i) => {
              const best = progress.current.best[d.id];
              const cls = `g-roll-block-cell${best !== undefined ? ' is-clear' : ''}${i === levelIdx ? ' is-current' : ''}${best !== undefined && best <= d.par ? ' is-par' : ''}`;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={cls}
                  onClick={() =>
                    press(() => {
                      loadLevel(i);
                      setPanelOpen(false);
                    })
                  }
                >
                  <span>{i + 1}</span>
                  {best !== undefined && <em>best {best}</em>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {playing && !panelOpen && !cleared && <TouchControls dpad />}
    </>
  );
}
