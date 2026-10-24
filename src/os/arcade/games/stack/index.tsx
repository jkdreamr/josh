import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import { BASE, HEIGHT, chimeFor, create, drop, hueFor, revealView, step, towerTop, type Slab, type State } from './logic';
import { meta } from './meta';
import './stack.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

/** How long the missed slab falls and the camera pulls back before the Game Over card. */
const END_DELAY = 1.3;
/** Slabs drawn below the top while climbing; the rest are hidden until the end of round reveal. */
const VISIBLE = 26;

type Debris = { mesh: T.Mesh; vx: number; vy: number; vz: number; rx: number; rz: number; life: number };
type Ripple = { mesh: T.Mesh; life: number; delay: number };
type Glow = { mat: T.MeshLambertMaterial; life: number };
type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.OrthographicCamera;
  tower: T.Group;
  moving: T.Mesh;
  debris: Debris[];
  ripples: Ripple[];
  glows: Glow[];
  camY: number;
  zoom: number;
  half: number;
  shake: number;
  hueSeed: number;
  geo: T.BoxGeometry;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

const colorFor = (THREE: Three, level: number, seed: number) => new THREE.Color().setHSL(hueFor(level, seed) / 360, 0.6, 0.62);

function fitSlab(mesh: T.Object3D, slab: Slab, level: number) {
  mesh.position.set(slab.x, level * HEIGHT + HEIGHT / 2, slab.z);
  mesh.scale.set(Math.max(0.001, slab.w), HEIGHT, Math.max(0.001, slab.d));
}

/** A flat outline that hugs a slab's top face, for the perfect drop ripple (XY plane, rotated flat by the caller). */
function outline(THREE: Three, w: number, d: number, t: number) {
  const W = w / 2 + t;
  const D = d / 2 + t;
  const pts = [-W, -D, W, -D, W, D, -W, D, -w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2];
  const pos: number[] = [];
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    for (const v of [k, n, n + 4, k, n + 4, k + 4]) pos.push(pts[v * 2], pts[v * 2 + 1], 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(12, 12, 12);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2f55, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.45);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffd6c2, 0.3);
  fill.position.set(-6, 4, -4);
  scene.add(fill);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const tower = new THREE.Group();
  scene.add(tower);
  const hueSeed = Math.floor(Math.random() * 360);
  const base = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, 0, hueSeed) }));
  fitSlab(base, { x: 0, z: 0, w: BASE, d: BASE }, 0);
  tower.add(base);
  // a tall plinth under the first slab so the tower never floats
  const plinth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, 0, hueSeed).multiplyScalar(0.72) }));
  plinth.position.set(0, -15, 0);
  plinth.scale.set(BASE, 30, BASE);
  tower.add(plinth);

  const moving = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, 1, hueSeed) }));
  scene.add(moving);

  const world: World = {
    gl,
    scene,
    camera,
    tower,
    moving,
    debris: [],
    ripples: [],
    glows: [],
    camY: 0,
    zoom: 1,
    half: 6,
    shake: 0,
    hueSeed,
    geo,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      const aspect = w / h;
      // short wide windows (the framed laptop) get a closer view so the slabs stay big; tall phones widen to fit the slide
      const half = Math.max(h < 230 ? 4.4 : 5.6, 5.4 / aspect);
      world.half = half;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const r of world.ripples) r.mesh.geometry.dispose();
      disposeTree(scene);
      geo.dispose();
      gl.dispose();
    },
  };
  return world;
}

/** Phone and iPad frames scale the game down; publish 1 / that scale so text and buttons stay full size on screen. */
function useFrameScale(root: RefObject<HTMLDivElement | null>, touch: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!el || !touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.4 && k < 0.99 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1;
        el.style.setProperty('--g-stack-u', String(u));
      });
    };
    measure();
    // the frame scales in when the app opens, which a ResizeObserver doesn't see, so check again once it settles
    const timers = [300, 900, 1800].map((ms) => window.setTimeout(measure, ms));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-stack-u');
    };
  }, [root, touch]);
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const ending = useRef<number | null>(null);
  const [flash, setFlash] = useState(0);
  const [combo, setCombo] = useState<{ text: string; id: number } | null>(null);
  const [score, setScore] = useState(0);
  const [sky, setSky] = useState<number | null>(null);
  const dropQueued = useRef(false);
  useFrameScale(shell.root, shell.touch);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    w.resize(host.clientWidth, host.clientHeight);
    fitSlab(w.moving, state.current.moving, 1);
    setSky(w.hueSeed);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
    shell.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, THREE]);

  const endRound = () => {
    const s = state.current;
    const parts = [s.score === 1 ? '1 Slab High' : `${s.score} Slabs High`];
    if (s.perfects) parts.push(s.perfects === 1 ? '1 Perfect Drop' : `${s.perfects} Perfect Drops`);
    if (s.bestStreak >= 3) parts.push(`Best Run of ${s.bestStreak}`);
    shell.gameOver(s.score, { detail: `${parts.join(', ')}.` });
  };

  const doDrop = () => {
    const w = world.current;
    const s = state.current;
    if (!w || !THREE || s.over) return;
    const { result, level, grew } = drop(s);
    const tumble = (slab: Slab, dirX: number, dirZ: number, miss: boolean) => {
      const mesh = new THREE.Mesh(w.geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, level, w.hueSeed) }));
      fitSlab(mesh, slab, level);
      w.scene.add(mesh);
      const sp = miss ? 1.1 : 1.6 + Math.random() * 0.8;
      const spin = miss ? 2.4 : 4;
      w.debris.push({ mesh, vx: dirX * sp, vy: miss ? 1.2 : 0.4, vz: dirZ * sp, rx: (Math.random() - 0.5) * spin + dirZ * 2, rz: (Math.random() - 0.5) * spin - dirX * 2, life: 3 });
    };

    if (result.kind === 'miss') {
      const slab = result.cuts[0];
      const below = s.stack[s.stack.length - 1];
      tumble(slab, Math.sign(slab.x - below.x) * 0.4, Math.sign(slab.z - below.z) * 0.4, true);
      w.moving.visible = false;
      w.shake = 0.35;
      // show the whole tower for the reveal
      w.tower.children.forEach((c) => (c.visible = true));
      ending.current = 0;
      sfx.play('lose');
      return;
    }

    const placed = new THREE.Mesh(w.geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, level, w.hueSeed) }));
    fitSlab(placed, result.slab, level);
    w.tower.add(placed);
    for (const c of result.cuts) tumble(c, Math.sign(c.x - result.slab.x), Math.sign(c.z - result.slab.z), false);

    if (result.kind === 'perfect') {
      const top = level * HEIGHT + HEIGHT + 0.012;
      const rings = s.streak >= 3 ? 3 : s.streak >= 2 ? 2 : 1;
      for (let i = 0; i < rings; i++) {
        const mesh = new THREE.Mesh(
          outline(THREE, result.slab.w, result.slab.d, 0.07),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(result.slab.x, top, result.slab.z);
        mesh.visible = false;
        w.scene.add(mesh);
        w.ripples.push({ mesh, life: 1, delay: i * 0.11 });
      }
      const mat = placed.material as T.MeshLambertMaterial;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 0.5;
      w.glows.push({ mat, life: 1 });
      const f = chimeFor(s.streak);
      sfx.tone({ freq: f, dur: 0.32, type: 'triangle', vol: 0.16 });
      sfx.tone({ freq: f * 2, dur: 0.18, type: 'sine', vol: 0.05, delay: 0.02 });
      if (grew) sfx.tone({ freq: f * 1.5, to: f * 2, dur: 0.22, type: 'triangle', vol: 0.08, delay: 0.08 });
      if (s.streak >= 2) setCombo({ text: `${s.streak} in a Row`, id: performance.now() });
      if (grew) setFlash(performance.now());
    } else {
      // smaller slivers make a lighter tick, big cuts a deeper thud
      const cut = result.cuts.reduce((a, c) => a + c.w * c.d, 0) / Math.max(0.01, result.slab.w * result.slab.d + result.cuts.reduce((a, c) => a + c.w * c.d, 0));
      sfx.play('hit', 1.5 - Math.min(0.6, cut * 0.9));
    }
    shell.setScore(s.score);
    setScore(s.score);

    (w.moving.material as T.MeshLambertMaterial).color.copy(colorFor(THREE, level + 1, w.hueSeed));
    fitSlab(w.moving, s.moving, level + 1);
    // hide slabs far below the camera to keep draw calls low (children 0 and 1 are the base and plinth)
    const top = s.stack.length;
    w.tower.children.forEach((c, i) => {
      if (i > 1) c.visible = i >= top - VISIBLE;
    });
    setSky(w.hueSeed + level * 6);
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      const s = state.current;
      if (!w) return;
      if (keys.pressed('action') || dropQueued.current) {
        dropQueued.current = false;
        doDrop();
      }
      if (!s.over) {
        step(s, dt);
        fitSlab(w.moving, s.moving, s.stack.length);
      }

      for (let i = w.debris.length - 1; i >= 0; i--) {
        const d = w.debris[i];
        d.vy -= 15 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.rx * dt;
        d.mesh.rotation.z += d.rz * dt;
        d.life -= dt;
        if (d.life <= 0) {
          w.scene.remove(d.mesh);
          (d.mesh.material as T.Material).dispose();
          w.debris.splice(i, 1);
        }
      }

      for (let i = w.ripples.length - 1; i >= 0; i--) {
        const r = w.ripples[i];
        if (r.delay > 0) {
          r.delay -= dt;
          continue;
        }
        r.life -= dt * 1.7;
        const k = 1 - Math.max(0, r.life);
        r.mesh.visible = true;
        r.mesh.scale.setScalar(1 + k * 0.32);
        (r.mesh.material as T.MeshBasicMaterial).opacity = Math.max(0, r.life) ** 1.4 * 0.95;
        if (r.life <= 0) {
          w.scene.remove(r.mesh);
          r.mesh.geometry.dispose();
          (r.mesh.material as T.Material).dispose();
          w.ripples.splice(i, 1);
        }
      }

      for (let i = w.glows.length - 1; i >= 0; i--) {
        const g = w.glows[i];
        g.life -= dt * 2.4;
        g.mat.emissiveIntensity = Math.max(0, g.life) * 0.5;
        if (g.life <= 0) w.glows.splice(i, 1);
      }

      let targetY = towerTop(s) - HEIGHT;
      let targetZoom = 1;
      if (ending.current != null) {
        ending.current += dt;
        const view = revealView(s.stack.length, w.half);
        if (ending.current > 0.35) {
          targetY = view.y;
          targetZoom = view.zoom;
        }
        if (ending.current >= END_DELAY) {
          ending.current = null;
          endRound();
        }
      }
      w.camY = damp(w.camY, targetY, ending.current != null ? 3 : 5, dt);
      const zoom = damp(w.zoom, targetZoom, 3.2, dt);
      if (Math.abs(zoom - w.zoom) > 1e-4) {
        w.zoom = zoom;
        w.camera.zoom = zoom;
        w.camera.updateProjectionMatrix();
      }
      w.shake = Math.max(0, w.shake - dt);
      const sh = w.shake * 0.3;
      w.camera.position.set(12 + (Math.random() - 0.5) * sh, 12 + w.camY + (Math.random() - 0.5) * sh, 12);
      w.camera.lookAt(0, w.camY, 0);
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const playing = shell.status === 'playing';
  return (
    <>
      <div
        ref={ref}
        className="g-stack-host"
        style={sky == null ? undefined : ({ '--g-stack-hue': sky } as CSSProperties)}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          if (!playing) return;
          e.preventDefault();
          dropQueued.current = true;
        }}
      />
      <div key={`flash-${flash}`} className={`g-stack-flash ${flash ? 'is-on' : ''}`} />
      {combo && (
        <div key={`combo-${combo.id}`} className="g-stack-combo">
          {combo.text}
        </div>
      )}
      {playing && score === 0 && <div className="g-stack-hint">{shell.touch ? 'Tap to Drop' : 'Press Space or Click to Drop'}</div>}
    </>
  );
}
