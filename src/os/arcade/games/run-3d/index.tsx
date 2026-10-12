import { useEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, TouchControls, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import { APOTHEM, COLS, PERIM, ROW_L, SIDES, TILE_W, create, hasTile, maskAt, rowOf, score, sideOf, step, zoneOf, type State } from './logic';
import { meta } from './meta';
import './run-3d.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

const TURN = (Math.PI * 2) / SIDES;
const DUST = 48;
/** Hue pairs per zone: tiles cycle through these every ZONE_LEN meters. */
const ZONES: [number, number][] = [
  [0.68, 0.58],
  [0.53, 0.47],
  [0.9, 0.83],
  [0.08, 0.02],
  [0.36, 0.3],
  [0.76, 0.62],
];

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  tiles: T.InstancedMesh;
  slots: Int32Array;
  rowsVis: number;
  zone: number;
  runner: T.Group;
  legs: [T.Mesh, T.Mesh];
  dust: T.InstancedMesh;
  dustPos: Float32Array;
  planets: T.Group;
  dummy: T.Object3D;
  color: T.Color;
  basis: T.Matrix4;
  roll: number;
  camLat: number;
  stride: number;
  squash: number;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

function build(THREE: Three, host: HTMLElement, lite: boolean): World | null {
  const gl = createGL(THREE, host, { alpha: true, maxDpr: lite ? 1.5 : 2 });
  if (!gl) return null;
  const rowsVis = lite ? 46 : 64;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070a1c, rowsVis * ROW_L * 0.45, rowsVis * ROW_L * 0.95);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2350, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(0, 1, 0.4);
  camera.add(key);
  key.target.position.set(0, 0, -1);
  camera.add(key.target);
  scene.add(camera);

  const tileGeo = new THREE.BoxGeometry(TILE_W * 0.92, 0.2, ROW_L * 0.92);
  tileGeo.translate(0, -0.1, 0);
  const tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), rowsVis * PERIM);
  tiles.frustumCulled = false;
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < rowsVis * PERIM; i++) tiles.setColorAt(i, white);
  scene.add(tiles);

  // runner: a round little explorer with a visor and two stubby legs
  const runner = new THREE.Group();
  const shellMat = new THREE.MeshLambertMaterial({ color: 0xf2f4fa, flatShading: true });
  const visorMat = new THREE.MeshLambertMaterial({ color: 0x1b1f3a, flatShading: true });
  const bootMat = new THREE.MeshLambertMaterial({ color: 0xffb23f, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 7), shellMat);
  body.position.y = 0.42;
  body.scale.set(1, 1.08, 1);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 6), visorMat);
  visor.scale.set(1.25, 0.7, 0.7);
  visor.position.set(0, 0.48, -0.2);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 5), visorMat);
  antenna.position.set(0.1, 0.78, 0.04);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), bootMat);
  tip.position.set(0.1, 0.9, 0.04);
  const legGeo = new THREE.BoxGeometry(0.12, 0.24, 0.16);
  legGeo.translate(0, -0.1, 0);
  const legL = new THREE.Mesh(legGeo, bootMat);
  const legR = new THREE.Mesh(legGeo, bootMat);
  legL.position.set(-0.13, 0.22, 0);
  legR.position.set(0.13, 0.22, 0);
  runner.add(body, visor, antenna, tip, legL, legR);
  scene.add(runner);

  // drifting space dust for a sense of speed
  const dust = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), new THREE.MeshBasicMaterial({ color: 0x9aa6ff, fog: true }), DUST);
  dust.frustumCulled = false;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = APOTHEM * 2 + 1 + Math.random() * 14;
    dustPos[i * 3] = Math.cos(a) * r;
    dustPos[i * 3 + 1] = Math.sin(a) * r;
    dustPos[i * 3 + 2] = -Math.random() * rowsVis * ROW_L;
  }
  scene.add(dust);

  // far planets that ride along with the camera
  const planets = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.SphereGeometry(40, 14, 10), new THREE.MeshLambertMaterial({ color: 0x5c4bd6, flatShading: true, fog: false }));
  p1.position.set(-120, 70, -520);
  const ring = new THREE.Mesh(new THREE.RingGeometry(55, 70, 40), new THREE.MeshBasicMaterial({ color: 0xb7aef7, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
  ring.position.copy(p1.position);
  ring.rotation.set(1.2, 0.3, 0.2);
  const p2 = new THREE.Mesh(new THREE.SphereGeometry(16, 10, 8), new THREE.MeshLambertMaterial({ color: 0xff8a5c, flatShading: true, fog: false }));
  p2.position.set(150, -40, -460);
  planets.add(p1, ring, p2);
  scene.add(planets);

  const world: World = {
    gl,
    scene,
    camera,
    tiles,
    slots: new Int32Array(rowsVis).fill(-1),
    rowsVis,
    zone: -1,
    runner,
    legs: [legL, legR],
    dust,
    dustPos,
    planets,
    dummy: new THREE.Object3D(),
    color: new THREE.Color(),
    basis: new THREE.Matrix4(),
    roll: 0,
    camLat: 0,
    stride: 0,
    squash: 0,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = camera.aspect < 0.7 ? 84 : camera.aspect < 1.1 ? 74 : 62;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      key.dispose();
      gl.dispose();
    },
  };
  return world;
}

/** Writes one tunnel row into its ring buffer slot. */
function writeRow(w: World, s: State, row: number) {
  const slot = ((row % w.rowsVis) + w.rowsVis) % w.rowsVis;
  w.slots[slot] = row;
  const mask = maskAt(s, row);
  const zone = zoneOf(Math.max(0, row) * ROW_L);
  const [h1, h2] = ZONES[zone % ZONES.length];
  const { dummy, color } = w;
  for (let i = 0; i < PERIM; i++) {
    const k = Math.floor(i / COLS);
    const c = i % COLS;
    const roll = k * TURN;
    const tx = Math.cos(roll);
    const ty = Math.sin(roll);
    const off = c + 0.5 - COLS / 2;
    // floor centre is -APOTHEM along the side's inward normal (-sin, cos)
    dummy.position.set(APOTHEM * ty + tx * off * TILE_W, -APOTHEM * tx + ty * off * TILE_W, -(row + 0.5) * ROW_L);
    dummy.rotation.set(0, 0, roll);
    const on = row >= 0 && hasTile(mask, i);
    dummy.scale.setScalar(on ? 1 : 0);
    dummy.updateMatrix();
    w.tiles.setMatrixAt(slot * PERIM + i, dummy.matrix);
    const checker = (row + c) % 2 === 0;
    color.setHSL(k % 2 ? h2 : h1, 0.62, (checker ? 0.62 : 0.55) - (k === 2 ? 0.06 : 0));
    w.tiles.setColorAt(slot * PERIM + i, color);
  }
}

function syncTunnel(w: World, s: State, force = false) {
  const first = rowOf(s.dist) - 4;
  let dirty = false;
  for (let r = first; r < first + w.rowsVis; r++) {
    const slot = ((r % w.rowsVis) + w.rowsVis) % w.rowsVis;
    if (!force && w.slots[slot] === r) continue;
    writeRow(w, s, r);
    dirty = true;
  }
  if (dirty) {
    w.tiles.instanceMatrix.needsUpdate = true;
    if (w.tiles.instanceColor) w.tiles.instanceColor.needsUpdate = true;
  }
}

function syncScene(w: World, s: State, dt: number) {
  const side = sideOf(s.u);
  w.roll = damp(w.roll, side * TURN, 11, dt);
  const ex = Math.cos(w.roll);
  const ey = Math.sin(w.roll);
  const nx = -ey;
  const ny = ex;

  // runner sits on its actual floor, but leans with the eased roll
  const sr = side * TURN;
  const stx = Math.cos(sr);
  const sty = Math.sin(sr);
  const local = s.u - side * COLS - COLS / 2;
  const lift = s.h;
  const px = APOTHEM * sty + stx * local - sty * lift;
  const py = -APOTHEM * stx + sty * local + stx * lift;
  const pz = -s.dist;
  w.runner.position.set(px, py, pz);
  w.runner.rotation.set(0, 0, w.roll);
  w.stride += dt * s.speed * (s.grounded ? 1.6 : 0.3);
  const swing = s.grounded ? Math.sin(w.stride) * 0.7 : 0.5;
  w.legs[0].rotation.x = swing;
  w.legs[1].rotation.x = s.grounded ? -swing : -0.3;
  w.squash = Math.max(0, w.squash - dt * 5);
  const sq = s.grounded ? 1 - w.squash * 0.25 + Math.abs(Math.sin(w.stride)) * 0.04 : 1 + Math.min(0.12, Math.abs(s.vy) * 0.015);
  w.runner.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  w.runner.visible = !s.dead;

  // camera trails behind in the eased frame
  const lat = px * ex + py * ey;
  w.camLat = damp(w.camLat, lat * 0.55, 7, dt);
  const height = -APOTHEM + 1.75;
  const cam = w.camera;
  const fall = s.falling ? Math.min(1, -s.h / 3) : 0;
  cam.position.set(ex * w.camLat + nx * (height + fall * 1.2), ey * w.camLat + ny * (height + fall * 1.2), pz + 4.3 + fall * 1.5);
  cam.up.set(nx, ny, 0);
  const look = -APOTHEM + 0.75 - fall * 1.5;
  cam.lookAt(ex * w.camLat * 0.6 + nx * look, ey * w.camLat * 0.6 + ny * look, pz - 9);

  // dust streams past
  const { dummy, dustPos } = w;
  const span = w.rowsVis * ROW_L;
  for (let i = 0; i < DUST; i++) {
    let z = dustPos[i * 3 + 2];
    if (z > pz + 6) z -= span;
    if (z < pz - span) z += span;
    dustPos[i * 3 + 2] = z;
    dummy.position.set(dustPos[i * 3], dustPos[i * 3 + 1], z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 0.6 + s.speed / 12);
    dummy.updateMatrix();
    w.dust.setMatrixAt(i, dummy.matrix);
  }
  w.dust.instanceMatrix.needsUpdate = true;
  w.planets.position.set(0, 0, pz);
  w.planets.children[0].rotation.y += dt * 0.05;

  const zone = zoneOf(s.dist);
  if (zone !== w.zone) {
    w.zone = zone;
    syncTunnel(w, s, true);
  } else syncTunnel(w, s);
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const tapJump = useRef(false);
  const overTimer = useRef(-1);
  const [zoneLabel, setZoneLabel] = useState<{ n: number; at: number } | null>(null);
  const lastZone = useRef(0);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host, shell.touch);
    if (!w) return;
    world.current = w;
    w.resize(host.clientWidth, host.clientHeight);
    syncScene(w, state.current, 1);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, THREE]);

  useGameLoop(
    (dt) => {
      const w = world.current;
      const s = state.current;
      if (!w) return;
      const jump = keys.pressed('up', 'action') || tapJump.current;
      tapJump.current = false;
      const dir = keys.axis('left', 'right');
      const ev = step(s, dt, { dir: dir as -1 | 0 | 1, jump });
      if (ev.jumped) sfx.play('jump', 1 + Math.min(0.4, s.speed / 60));
      if (ev.landed) {
        w.squash = 1;
        sfx.tone({ freq: 180, to: 120, dur: 0.06, type: 'triangle', vol: 0.18 });
      }
      if (ev.turned) sfx.tone({ freq: 520, to: 780, dur: 0.09, type: 'sine', vol: 0.12 });
      if (ev.fell) sfx.play('lose');
      if (!s.falling) {
        shell.setScore(score(s));
        const z = zoneOf(s.dist);
        if (z !== lastZone.current) {
          lastZone.current = z;
          setZoneLabel({ n: z + 1, at: Date.now() });
          sfx.play('coin', 1.2);
        }
      }
      if (s.dead && overTimer.current < 0) overTimer.current = 0.35;
      if (overTimer.current >= 0) {
        overTimer.current -= dt;
        if (overTimer.current < 0) {
          overTimer.current = 1e9;
          const m = score(s);
          shell.gameOver(m, { title: 'Lost in Space', detail: `You made it ${m.toLocaleString('en-US')} m into the void.` });
        }
      }
      syncScene(w, s, dt);
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (shell.status !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tapJump.current = true;
  };

  return (
    <>
      <div ref={ref} className="g-run-3d-host" onPointerDown={onPointerDown} />
      {zoneLabel && zoneLabel.n > 1 && shell.status === 'playing' && (
        <div key={zoneLabel.at} className="g-run-3d-zone">
          Zone {zoneLabel.n}
        </div>
      )}
      <TouchControls dpad="x" buttons={[{ key: 'Space', label: 'Jump' }]} />
    </>
  );
}
