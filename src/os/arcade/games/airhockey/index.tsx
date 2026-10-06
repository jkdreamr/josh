import { useEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import { GOAL_W, L, MALLET_R, PUCK_R, TO_WIN, W, create, moveMalletTo, nudgeMallet, step, stepAI, type Difficulty, type Event, type Mode, type State } from './logic';
import { meta } from './meta';
import './airhockey.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

const SUBSTEP = 1 / 120;
const P1 = 0x34c3ff;
const P2 = 0xff6b8a;

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  puck: T.Mesh;
  mallets: [T.Mesh, T.Mesh];
  glow: [T.Mesh, T.Mesh];
  ray: T.Raycaster;
  plane: T.Plane;
  flash: T.Mesh;
  flashLife: number;
  shake: number;
  portrait: boolean;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

function tableTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 870;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f4f8';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(40, 60, 90, 0.35)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, c.height / 2);
  g.lineTo(c.width, c.height / 2);
  g.stroke();
  g.beginPath();
  g.arc(c.width / 2, c.height / 2, 70, 0, Math.PI * 2);
  g.stroke();
  for (const y of [90, c.height - 90]) {
    g.beginPath();
    g.arc(c.width / 2, y < c.height / 2 ? 0 : c.height, 150, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = 'rgba(52, 195, 255, 0.18)';
  g.fillRect(0, c.height - 6, c.width, 6);
  g.fillStyle = 'rgba(255, 107, 138, 0.18)';
  g.fillRect(0, 0, c.width, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 40);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 8, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd4ff, 0.7);
  fill.position.set(-4, 5, -5);
  scene.add(fill);

  const top = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshLambertMaterial({ map: tableTexture(THREE) }));
  top.rotation.x = -Math.PI / 2;
  scene.add(top);
  // rails with goal gaps
  const railMat = new THREE.MeshLambertMaterial({ color: 0x1c2230 });
  const railH = 0.14;
  const railT = 0.1;
  const side = new THREE.BoxGeometry(railT, railH, L + railT * 2);
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(side, railMat);
    r.position.set(sx * (W / 2 + railT / 2), railH / 2 - 0.02, 0);
    scene.add(r);
  }
  const endLen = (W - GOAL_W) / 2;
  const end = new THREE.BoxGeometry(endLen, railH, railT);
  for (const sz of [-1, 1])
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(end, railMat);
      r.position.set(sx * (GOAL_W / 2 + endLen / 2), railH / 2 - 0.02, sz * (L / 2 + railT / 2));
      scene.add(r);
    }
  // goal mouths
  for (const sz of [-1, 1]) {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(GOAL_W, 0.02, 0.26), new THREE.MeshBasicMaterial({ color: sz > 0 ? P1 : P2, transparent: true, opacity: 0.55 }));
    mouth.position.set(0, 0.005, sz * (L / 2 + 0.12));
    scene.add(mouth);
  }
  // legs and apron
  const apron = new THREE.Mesh(new THREE.BoxGeometry(W + railT * 2, 0.22, L + railT * 2), new THREE.MeshLambertMaterial({ color: 0x12161f }));
  apron.position.y = -0.13;
  scene.add(apron);

  const puck = new THREE.Mesh(new THREE.CylinderGeometry(PUCK_R, PUCK_R, 0.03, 32), new THREE.MeshPhongMaterial({ color: 0x15171c, shininess: 60 }));
  puck.position.y = 0.015;
  scene.add(puck);

  const malletGeo = new THREE.CylinderGeometry(MALLET_R, MALLET_R, 0.05, 36);
  const knobGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.09, 24);
  const mallets: T.Mesh[] = [];
  const glow: T.Mesh[] = [];
  [P1, P2].forEach((color) => {
    const m = new THREE.Mesh(malletGeo, new THREE.MeshPhongMaterial({ color, shininess: 50 }));
    m.position.y = 0.025;
    const knob = new THREE.Mesh(knobGeo, new THREE.MeshPhongMaterial({ color: 0xf5f7fa, shininess: 30 }));
    knob.position.y = 0.07;
    m.add(knob);
    scene.add(m);
    mallets.push(m);
    const g = new THREE.Mesh(new THREE.RingGeometry(MALLET_R + 0.01, MALLET_R + 0.05, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = 0.002;
    scene.add(g);
    glow.push(g);
  });

  const flash = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  flash.rotation.x = -Math.PI / 2;
  flash.position.y = 0.003;
  scene.add(flash);

  const world: World = {
    gl,
    scene,
    camera,
    puck,
    mallets: mallets as [T.Mesh, T.Mesh],
    glow: glow as [T.Mesh, T.Mesh],
    ray: new THREE.Raycaster(),
    plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    flash,
    flashLife: 0,
    shake: 0,
    portrait: false,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      world.portrait = camera.aspect < 1;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };
  return world;
}

/**
 * Camera: a gentle perspective from the bottom player's end for single player; top-down for two players,
 * turned so the table runs along the longer side of the screen (blue on the left or bottom).
 */
function placeCamera(w: World, twoPlayer: boolean) {
  const cam = w.camera;
  const a = cam.aspect;
  if (twoPlayer) {
    const landscape = a >= 1;
    const span = landscape ? Math.max(L / a, W) : Math.max(L, W * a);
    cam.fov = 50;
    const dist = span / 2 / Math.tan((cam.fov * Math.PI) / 360) + 0.35;
    cam.up.set(landscape ? -1 : 0, 0, landscape ? 0 : -1);
    cam.position.set(0, dist, 0);
    cam.lookAt(0, 0, 0);
  } else {
    cam.up.set(0, 1, 0);
    cam.position.set(0, w.portrait ? 3.6 : 2.9, w.portrait ? 2.6 : 2.5);
    cam.lookAt(0, 0, w.portrait ? 0.1 : 0.2);
    cam.fov = w.portrait ? 60 : 50;
  }
  cam.updateProjectionMatrix();
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const [mode, setMode] = useState<Mode>('cpu');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [menu, setMenu] = useState(true);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [pop, setPop] = useState<{ text: string; id: number } | null>(null);
  const pointers = useRef(new Map<number, { side: 0 | 1; x: number; z: number }>());
  const lastTick = useRef(0);
  const cfg = useRef({ mode, difficulty, menu });
  cfg.current = { mode, difficulty, menu };

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    placeCamera(w, mode === '2p');
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    const w = world.current;
    if (!w) return;
    w.resize(size.w, size.h);
    placeCamera(w, mode === '2p');
  }, [size.w, size.h, THREE, mode]);

  const begin = () => {
    state.current = create(mode, difficulty);
    setScore([0, 0]);
    setMenu(false);
    sfx.play('select');
    shell.root.current?.focus({ preventScroll: true });
  };

  /** Pointer position on the table plane, in table coordinates. */
  const tablePoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    if (!w || !THREE) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    w.ray.setFromCamera(ndc, w.camera);
    const p = new THREE.Vector3();
    if (!w.ray.ray.intersectPlane(w.plane, p)) return null;
    return { x: p.x, z: p.z };
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cfg.current.menu || shell.status !== 'playing') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = tablePoint(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // in two player mode each half of the table belongs to one player; against the computer every touch is yours
    const side: 0 | 1 = cfg.current.mode === '2p' && p.z < 0 ? 1 : 0;
    if ([...pointers.current.values()].some((q) => q.side === side)) return;
    pointers.current.set(e.pointerId, { side, x: p.x, z: p.z });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ptr = pointers.current.get(e.pointerId);
    if (ptr) {
      const p = tablePoint(e);
      if (p) {
        ptr.x = p.x;
        ptr.z = p.z;
      }
      return;
    }
    // a mouse with no button down still steers the bottom mallet against the computer
    if (e.pointerType === 'mouse' && cfg.current.mode === 'cpu' && !cfg.current.menu && shell.status === 'playing') {
      const p = tablePoint(e);
      if (p) pointers.current.set(-1, { side: 0, x: p.x, z: p.z });
    }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const driveMallets = (s: State, dt: number) => {
    const driven = new Set<number>();
    for (const ptr of pointers.current.values()) {
      moveMalletTo(s, ptr.side, { x: ptr.x, z: ptr.z }, dt, 9);
      driven.add(ptr.side);
    }
    // keyboard: WASD for the bottom player, arrows for the top player (or either set in single player)
    if (!driven.has(0)) {
      const kx = (keys.down('KeyD') ? 1 : 0) - (keys.down('KeyA') ? 1 : 0) + (s.mode === 'cpu' ? (keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0) : 0);
      const kz = (keys.down('KeyS') ? 1 : 0) - (keys.down('KeyW') ? 1 : 0) + (s.mode === 'cpu' ? (keys.down('ArrowDown') ? 1 : 0) - (keys.down('ArrowUp') ? 1 : 0) : 0);
      if (kx || kz) nudgeMallet(s, 0, kx, kz, dt);
      else {
        s.mallets[0].vx = 0;
        s.mallets[0].vz = 0;
      }
    }
    if (s.mode === '2p') {
      if (!driven.has(1)) {
        const kx = (keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0);
        const kz = (keys.down('ArrowDown') ? 1 : 0) - (keys.down('ArrowUp') ? 1 : 0);
        if (kx || kz) nudgeMallet(s, 1, kx, kz, dt);
        else {
          s.mallets[1].vx = 0;
          s.mallets[1].vz = 0;
        }
      }
    } else stepAI(s, dt);
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      const s = state.current;
      if (!w) return;
      // simulate real elapsed time (capped) in fixed sub-steps, so slow devices play at full speed
      // and fast mallets never tunnel through the puck
      const now = performance.now();
      const gap = lastTick.current ? (now - lastTick.current) / 1000 : dt;
      lastTick.current = now;
      const simDt = gap > 0.5 ? dt : Math.min(0.25, Math.max(dt, gap));
      if (!cfg.current.menu && s.winner === null) {
        const n = Math.max(1, Math.ceil(simDt / SUBSTEP));
        const h = simDt / n;
        const ev: Event = {};
        for (let i = 0; i < n && s.winner === null; i++) {
          driveMallets(s, h);
          const e = step(s, h);
          if (e.wall) ev.wall = true;
          if (e.hit !== undefined) ev.hit = e.hit;
          if (e.goal !== undefined) ev.goal = e.goal;
          if (e.win !== undefined) ev.win = e.win;
        }
        if (ev.wall) sfx.play('tick', 0.6);
        if (ev.hit !== undefined) sfx.play('hit', 2.2);
        if (ev.goal !== undefined) {
          setScore([s.score[0], s.score[1]]);
          w.flashLife = 1;
          (w.flash.material as T.MeshBasicMaterial).color.setHex(ev.goal === 0 ? P1 : P2);
          w.shake = 0.35;
          const you = s.mode === 'cpu';
          if (ev.win !== undefined) {
            const won = ev.win === 0;
            sfx.play(won || !you ? 'win' : 'lose');
            const title = you ? (won ? 'You win' : 'Computer wins') : ev.win === 0 ? 'Blue wins' : 'Pink wins';
            shell.gameOver(you ? s.score[0] : undefined, { title, detail: `${s.score[0]} to ${s.score[1]}${you ? `, ${s.difficulty} computer.` : '.'}` });
          } else {
            sfx.play(ev.goal === 0 || !you ? 'coin' : 'lose', 1.2);
            setPop({ text: you ? (ev.goal === 0 ? 'Goal' : 'Computer scores') : ev.goal === 0 ? 'Blue scores' : 'Pink scores', id: Date.now() });
          }
          if (you) shell.setScore(s.score[0]);
        }
      }
      // visuals
      w.puck.position.x = s.puck.x;
      w.puck.position.z = s.puck.z;
      s.mallets.forEach((m, i) => {
        w.mallets[i].position.x = m.x;
        w.mallets[i].position.z = m.z;
        w.glow[i].position.x = m.x;
        w.glow[i].position.z = m.z;
      });
      if (w.flashLife > 0) {
        w.flashLife = Math.max(0, w.flashLife - dt * 2);
        (w.flash.material as T.MeshBasicMaterial).opacity = w.flashLife * 0.35;
      }
      w.shake = Math.max(0, w.shake - dt);
      const sh = w.shake * 0.06;
      w.camera.position.x = damp(w.camera.position.x, (Math.random() - 0.5) * sh, 20, dt);
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const playing = shell.status === 'playing';
  const two = mode === '2p';
  return (
    <>
      <div ref={ref} className={`g-airhockey-host ${menu ? 'is-menu' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp} />
      {!menu && (
        <div className="g-airhockey-score">
          <i style={{ background: '#34c3ff' }} />
          <strong>{score[0]}</strong>
          <span>first to {TO_WIN}</span>
          <strong>{score[1]}</strong>
          <i style={{ background: '#ff6b8a' }} />
        </div>
      )}
      {pop && (
        <div key={pop.id} className="g-airhockey-pop">
          {pop.text}
        </div>
      )}
      {playing && menu && (
        <div className="g-airhockey-menu">
          <h3>Pick a match</h3>
          <div className="g-airhockey-row" role="radiogroup" aria-label="Mode">
            <button type="button" className={`g-airhockey-opt ${!two ? 'is-on' : ''}`} onClick={() => setMode('cpu')} aria-pressed={!two}>
              vs computer
            </button>
            <button type="button" className={`g-airhockey-opt ${two ? 'is-on' : ''}`} onClick={() => setMode('2p')} aria-pressed={two}>
              2 players
            </button>
          </div>
          {!two ? (
            <div className="g-airhockey-row" role="radiogroup" aria-label="Difficulty">
              {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
                <button key={d} type="button" className={`g-airhockey-opt ${difficulty === d ? 'is-on' : ''}`} onClick={() => setDifficulty(d)} aria-pressed={difficulty === d}>
                  {d}
                </button>
              ))}
            </div>
          ) : (
            <p>{shell.touch ? 'Each player drags the mallet on their half of the table.' : 'Blue uses WASD or the mouse, pink uses the arrow keys.'}</p>
          )}
          <div className="g-airhockey-row">
            <button type="button" className="g-airhockey-opt g-airhockey-go" onClick={begin}>
              Play
            </button>
          </div>
        </div>
      )}
      {playing && !menu && state.current.score[0] + state.current.score[1] === 0 && (
        <div className="g-airhockey-hint">
          {shell.touch ? (two ? 'each player drags on their own side' : 'drag to move your mallet') : two ? 'blue: WASD or mouse, pink: arrow keys' : 'move the mouse or use WASD'}
        </div>
      )}
    </>
  );
}
