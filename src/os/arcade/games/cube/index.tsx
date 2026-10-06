import { useEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { clamp, createGL, disposeTree, type GL } from './gl';
import { apply, create, faceTurn, fmtTime, inLayer, inferTurn, notation, scramble, snapAxis, tick, undo, type Cube, type Face, type Turn, type Vec } from './logic';
import { meta } from './meta';
import './cube.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} lowerIsBetter formatScore={(ms) => `${fmtTime(ms)}s`}>
      <Play />
    </GameShell>
  );
}

const SIZE = 0.94;
const COLORS: Record<string, number> = { px: 0xff453a, nx: 0xff9f0a, py: 0xf5f5f7, ny: 0xffd60a, pz: 0x30d158, nz: 0x0a84ff, inner: 0x16171c };
type QueueItem = { turn: Turn; record: boolean; fast: boolean; undo?: boolean; marker?: boolean };
const TURN_MS = 190;
const FAST_MS = 60;

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  rig: T.Group;
  cube: T.Group;
  pivot: T.Group;
  yaw: number;
  pitch: number;
  meshes: T.Mesh[];
  ray: T.Raycaster;
  anim: QueueItem & { t: number; ms: number } | null;
  queue: QueueItem[];
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

function cubieGeometry(THREE: Three, home: Vec) {
  const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const faces: [string, number, number][] = [
    ['px', 0, 1],
    ['nx', 0, -1],
    ['py', 1, 1],
    ['ny', 1, -1],
    ['pz', 2, 1],
    ['nz', 2, -1],
  ];
  const c = new THREE.Color();
  faces.forEach(([key, axis, sign], i) => {
    c.setHex(home[axis] === sign ? COLORS[key] : COLORS.inner);
    for (let v = 0; v < 4; v++) {
      const k = (i * 4 + v) * 3;
      colors[k] = c.r;
      colors[k + 1] = c.g;
      colors[k + 2] = c.b;
    }
  });
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function build(THREE: Three, host: HTMLElement, model: Cube): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  camera.position.set(0, 0, 8.2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x333a4a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(4, 7, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  fill.position.set(-6, -3, -4);
  scene.add(fill);

  const rig = new THREE.Group();
  rig.rotation.order = 'XYZ';
  rig.rotation.set(0.52, -0.62, 0);
  scene.add(rig);
  const cube = new THREE.Group();
  rig.add(cube);
  const pivot = new THREE.Group();
  rig.add(pivot);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.04 });
  const meshes = model.cubies.map((c) => {
    const m = new THREE.Mesh(cubieGeometry(THREE, c.home), mat);
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
    yaw: -0.62,
    pitch: 0.52,
    meshes,
    ray: new THREE.Raycaster(),
    anim: null,
    queue: [],
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = camera.aspect < 0.7 ? 14 : camera.aspect < 0.85 ? 12.5 : camera.aspect < 1.2 ? 9.5 : 8.2;
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
    mesh.scale.setScalar(1);
  });
  w.pivot.rotation.set(0, 0, 0);
}

type Drag = { id: number; x: number; y: number; mode: 'orbit' | 'face' | 'done'; cubie?: number; normal?: Vec; plane?: T.Plane; start?: T.Vector3 };

function Play() {
  const shell = useShell();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const model = useRef<Cube>(create());
  const drag = useRef<Drag | null>(null);
  const [hud, setHud] = useState({ time: '0.00', moves: 0 });
  const [scrambleText, setScrambleText] = useState('');
  const [last, setLast] = useState<{ text: string; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const hudKey = useRef('');
  const started = useRef(false);

  const enqueue = (item: QueueItem) => {
    const w = world.current;
    if (!w || w.queue.length > 40) return;
    w.queue.push(item);
  };
  const turnNow = (turn: Turn) => enqueue({ turn, record: true, fast: false });

  const doScramble = () => {
    const w = world.current;
    const m = model.current;
    if (!w || shell.status !== 'playing') return;
    // run the scramble on a copy so the queue animates it onto the current visual state
    const copy = create();
    copy.cubies = m.cubies.map((c) => ({ ...c }));
    const turns = scramble(copy);
    setScrambleText(turns.map(notation).join(' '));
    for (const t of turns) enqueue({ turn: t, record: false, fast: true });
    enqueue({ turn: { axis: 0, layer: 0, dir: 1 }, record: false, fast: true, marker: true });
    sfx.play('select', 0.8);
  };

  const doUndo = () => {
    const w = world.current;
    const m = model.current;
    if (!w || w.anim || w.queue.length || !m.history.length) return;
    const t = m.history[m.history.length - 1];
    enqueue({ turn: { ...t, dir: t.dir === 1 ? -1 : 1 }, record: false, fast: false, undo: true });
  };

  /** Buttons hand focus back to the game so the keyboard keeps working after a click. */
  const press = (fn: () => void) => {
    fn();
    shell.root.current?.focus({ preventScroll: true });
  };

  useKeys((code, e) => {
    if (shell.status !== 'playing' || e?.repeat) return;
    const face = code.startsWith('Key') ? (code.slice(3) as Face) : null;
    if (face && face in { U: 1, D: 1, L: 1, R: 1, F: 1, B: 1 }) {
      turnNow(faceTurn(face, !!e?.shiftKey));
      e?.preventDefault();
    } else if (code === 'KeyZ' || code === 'Backspace') doUndo();
    else if (code === 'Space') doScramble();
  });

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host, model.current);
    if (!w) return;
    world.current = w;
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE]);

  useEffect(() => {
    if (shell.status === 'playing' && !started.current && world.current) {
      started.current = true;
      doScramble();
    }
  }, [shell.status, THREE]);

  useGameLoop(
    (dt) => {
      const w = world.current;
      const m = model.current;
      if (!w || !THREE) return;
      tick(m, dt * 1000);
      // advance the current turn or start the next one
      if (!w.anim && w.queue.length) {
        const next = w.queue.shift()!;
        if (next.marker) {
          // end of scramble: the model already holds the scrambled state, reset the clock
          finishScramble(m);
        } else {
          w.anim = { ...next, t: 0, ms: next.fast ? FAST_MS : TURN_MS };
          m.cubies.forEach((c, i) => {
            if (inLayer(c, next.turn)) w.pivot.attach(w.meshes[i]);
          });
          sfx.play('tick', next.fast ? 1.4 : 1);
        }
      }
      const a = w.anim;
      if (a) {
        a.t = Math.min(1, a.t + (dt * 1000) / a.ms);
        const e = 1 - Math.pow(1 - a.t, 3);
        const ang = e * a.turn.dir * (Math.PI / 2);
        w.pivot.rotation.set(a.turn.axis === 0 ? ang : 0, a.turn.axis === 1 ? ang : 0, a.turn.axis === 2 ? ang : 0);
        if (a.t >= 1) {
          const wasSolved = m.solved;
          if (a.undo) {
            undo(m);
            setLast({ text: 'Undo', id: Date.now() });
          } else {
            apply(m, a.turn, a.record);
            if (a.record) setLast({ text: notation(a.turn), id: Date.now() });
          }
          syncMeshes(THREE, w, m);
          w.anim = null;
          if (!wasSolved && m.solved && m.scrambled) {
            sfx.play('win');
            shell.gameOver(m.time, { title: 'Solved', detail: `${m.moves} moves in ${fmtTime(m.time)}s.` });
          }
        }
      }
      const next = `${fmtTime(m.time)}|${m.moves}`;
      if (next !== hudKey.current) {
        hudKey.current = next;
        setHud({ time: fmtTime(m.time), moves: m.moves });
      }
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const finishScramble = (m: Cube) => {
    m.history = [];
    m.moves = 0;
    m.time = 0;
    m.timing = false;
    m.scrambled = true;
    m.solved = false;
  };

  const pointerNdc = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return new THREE!.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    if (!w || !THREE || drag.current) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (shell.status !== 'playing') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    w.ray.setFromCamera(pointerNdc(e), w.camera);
    const hits = w.ray.intersectObjects(w.meshes, false);
    const d: Drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: 'orbit' };
    if (hits.length && !w.anim && !w.queue.length) {
      const hit = hits[0];
      const mesh = hit.object as T.Mesh;
      const idx = w.meshes.indexOf(mesh);
      const worldNormal = hit.face!.normal.clone().transformDirection(mesh.matrixWorld);
      const localNormal = worldNormal.clone().applyQuaternion(w.rig.getWorldQuaternion(new THREE.Quaternion()).invert());
      const sn = snapAxis([localNormal.x, localNormal.y, localNormal.z]);
      const normal: Vec = [0, 0, 0];
      normal[sn.axis] = sn.sign;
      d.mode = 'face';
      d.cubie = idx;
      d.normal = normal;
      d.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(worldNormal, hit.point);
      d.start = hit.point.clone();
    }
    drag.current = d;
    setDragging(true);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    const d = drag.current;
    if (!w || !THREE || !d || d.id !== e.pointerId) return;
    if (d.mode === 'orbit') {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      // yaw around the cube's vertical axis, tilt around the screen's horizontal axis, never roll
      w.yaw += dx * 0.0045;
      w.pitch = clamp(w.pitch + dy * 0.0045, -1.25, 1.25);
      w.rig.rotation.set(w.pitch, w.yaw, 0);
      return;
    }
    if (d.mode !== 'face') return;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (dist < 14) return;
    w.ray.setFromCamera(pointerNdc(e), w.camera);
    const p = new THREE.Vector3();
    if (!w.ray.ray.intersectPlane(d.plane!, p)) return;
    const delta = p.sub(d.start!).applyQuaternion(w.rig.getWorldQuaternion(new THREE.Quaternion()).invert());
    const turn = inferTurn(d.normal!, [delta.x, delta.y, delta.z], model.current.cubies[d.cubie!].pos);
    d.mode = 'done';
    if (turn) turnNow(turn);
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const m = model.current;
  const playing = shell.status === 'playing';
  return (
    <>
      <div ref={ref} className={`g-cube-host ${dragging ? 'is-dragging' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <div className="g-cube-bar">
        <div className="g-cube-hud">
          <strong>{hud.time}</strong>
          <span>{hud.moves === 1 ? '1 move' : `${hud.moves} moves`}</span>
        </div>
        <button type="button" className="arcade-btn" onClick={() => press(doUndo)} disabled={!playing || !m.history.length} aria-label="Undo">
          Undo
        </button>
        <button type="button" className="arcade-btn arcade-btn-primary" onClick={() => press(doScramble)} disabled={!playing}>
          Scramble
        </button>
      </div>
      {last && (
        <div key={last.id} className="g-cube-last">
          {last.text}
        </div>
      )}
      {scrambleText && !m.solved && (
        <div className="g-cube-scramble" aria-label="Scramble">
          {scrambleText}
        </div>
      )}
      {playing && m.scrambled && m.moves === 0 && !world.current?.queue.length && (
        <div className="g-cube-hint">{shell.touch ? 'Drag a face to turn it, drag the background to orbit' : 'Drag a face or press U D L R F B, Shift for prime'}</div>
      )}
    </>
  );
}
