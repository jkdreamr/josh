import { useEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import { BASE, HEIGHT, create, drop, hueFor, step, towerTop, type Slab, type State } from './logic';
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

type Debris = { mesh: T.Mesh; vx: number; vy: number; vz: number; rx: number; rz: number; life: number };
type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.OrthographicCamera;
  tower: T.Group;
  moving: T.Mesh;
  ring: T.Mesh;
  debris: Debris[];
  camY: number;
  ringLife: number;
  shake: number;
  hueSeed: number;
  geo: T.BoxGeometry;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

const colorFor = (THREE: Three, level: number, seed: number) => new THREE.Color().setHSL(hueFor(level, seed) / 360, 0.62, 0.6);

function fitSlab(mesh: T.Object3D, slab: Slab, level: number) {
  mesh.position.set(slab.x, level * HEIGHT + HEIGHT / 2, slab.z);
  mesh.scale.set(Math.max(0.001, slab.w), HEIGHT, Math.max(0.001, slab.d));
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(12, 12, 12);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2f55, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 10, 3);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffd6c2, 0.35);
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
  const plinth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, 0, hueSeed).multiplyScalar(0.7) }));
  plinth.position.set(0, -6, 0);
  plinth.scale.set(BASE, 12, BASE);
  tower.add(plinth);

  const moving = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, 1, hueSeed) }));
  scene.add(moving);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  const world: World = {
    gl,
    scene,
    camera,
    tower,
    moving,
    ring,
    debris: [],
    camY: 0,
    ringLife: 0,
    shake: 0,
    hueSeed,
    geo,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      const aspect = w / h;
      const v = Math.max(6.5, 5.2 / aspect);
      camera.left = -v * aspect;
      camera.right = v * aspect;
      camera.top = v;
      camera.bottom = -v;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      geo.dispose();
      gl.dispose();
    },
  };
  return world;
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const [flash, setFlash] = useState(0);
  const [combo, setCombo] = useState<{ n: number; id: number } | null>(null);
  const dropQueued = useRef(false);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    fitSlab(w.moving, state.current.moving, 1);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE]);

  const doDrop = () => {
    const w = world.current;
    const s = state.current;
    if (!w || !THREE || s.over) return;
    const out = drop(s);
    const { result, level } = out;
    const t = world.current!;
    const tumble = (slab: Slab, dirX: number, dirZ: number, violent: boolean) => {
      const mesh = new THREE.Mesh(t.geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, level, t.hueSeed) }));
      fitSlab(mesh, slab, level);
      t.scene.add(mesh);
      const sp = violent ? 1.2 : 2.2;
      t.debris.push({ mesh, vx: dirX * sp, vy: violent ? 1.5 : 0.6, vz: dirZ * sp, rx: (Math.random() - 0.5) * 4, rz: (Math.random() - 0.5) * 4, life: 2.6 });
    };
    if (result.kind === 'miss') {
      const slab = result.cuts[0];
      const below = s.stack[s.stack.length - 1];
      tumble(slab, Math.sign(slab.x - below.x) * 0.3, Math.sign(slab.z - below.z) * 0.3, true);
      t.moving.visible = false;
      t.shake = 0.5;
      sfx.play('lose');
      shell.gameOver(s.score, { detail: s.score === 1 ? '1 slab high.' : `${s.score} slabs high.` });
      return;
    }
    const placed = new THREE.Mesh(t.geo, new THREE.MeshLambertMaterial({ color: colorFor(THREE, level, t.hueSeed) }));
    fitSlab(placed, result.slab, level);
    t.tower.add(placed);
    for (const c of result.cuts) tumble(c, Math.sign(c.x - result.slab.x), Math.sign(c.z - result.slab.z), false);
    if (result.kind === 'perfect') {
      t.ring.position.set(result.slab.x, level * HEIGHT + HEIGHT + 0.01, result.slab.z);
      t.ring.scale.setScalar(Math.max(result.slab.w, result.slab.d) * 0.55);
      t.ringLife = 1;
      sfx.play('coin', 1 + Math.min(8, s.streak) * 0.08);
      if (s.streak >= 2) setCombo({ n: s.streak, id: Date.now() });
      if (out.grew) setFlash(Date.now());
    } else {
      sfx.play('hit', 1.3);
    }
    shell.setScore(s.score);
    // the next slab
    (t.moving.material as T.MeshLambertMaterial).color.copy(colorFor(THREE, level + 1, t.hueSeed));
    fitSlab(t.moving, s.moving, level + 1);
    // hide slabs far below the camera to keep draw calls low
    const top = s.stack.length;
    t.tower.children.forEach((c, i) => {
      if (i > 1) c.visible = i >= top - 24;
    });
    // tint the sky with the tower
    const hue = hueFor(level, t.hueSeed);
    const host = ref.current;
    if (host) host.style.background = `linear-gradient(180deg, hsl(${hue} 32% 11%) 0%, hsl(${(hue + 20) % 360} 28% 22%) 55%, hsl(${(hue + 40) % 360} 26% 34%) 100%)`;
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
      for (const d of w.debris) {
        d.vy -= 14 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.rx * dt;
        d.mesh.rotation.z += d.rz * dt;
        d.life -= dt;
      }
      for (const d of w.debris.filter((d) => d.life <= 0)) {
        w.scene.remove(d.mesh);
        (d.mesh.material as T.Material).dispose();
        w.debris.splice(w.debris.indexOf(d), 1);
      }
      if (w.ringLife > 0) {
        w.ringLife = Math.max(0, w.ringLife - dt * 2.2);
        const k = 1 - w.ringLife;
        w.ring.scale.setScalar(w.ring.scale.x * (1 + dt * 2.5));
        (w.ring.material as T.MeshBasicMaterial).opacity = w.ringLife * 0.9;
        w.ring.visible = k < 1;
      } else w.ring.visible = false;
      const targetY = towerTop(s) - HEIGHT;
      w.camY = damp(w.camY, targetY, 4, dt);
      w.shake = Math.max(0, w.shake - dt);
      const sh = w.shake * 0.25;
      w.camera.position.set(12 + (Math.random() - 0.5) * sh, 12 + w.camY + (Math.random() - 0.5) * sh, 12);
      w.camera.lookAt(0, w.camY, 0);
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  return (
    <>
      <div
        ref={ref}
        className="g-stack-host"
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          if (shell.status !== 'playing') return;
          e.preventDefault();
          dropQueued.current = true;
        }}
      />
      <div key={flash} className={`g-stack-flash ${flash ? 'is-on' : ''}`} />
      {combo && (
        <div key={combo.id} className="g-stack-combo">
          {combo.n} in a row
        </div>
      )}
      {shell.status === 'playing' && state.current.score === 0 && <div className="g-stack-hint">{shell.touch ? 'tap to drop' : 'space or click to drop'}</div>}
    </>
  );
}
