import { useEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import { CAR_L, CAR_W, LANES, LANE_W, SPAWN_Z, create, kmh, laneX, score, steer, step, type State } from './logic';
import { meta } from './meta';
import './palmdrive.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

const ROAD_W = LANES * LANE_W;
const ROAD_LEN = 260;
const TREE_GAP = 11;
const TREES_PER_SIDE = 22;
const CHURCH_Z = 215;

type Car = { group: T.Group; body: T.MeshLambertMaterial };
type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  road: T.Mesh;
  roadTex: T.CanvasTexture;
  trunks: T.InstancedMesh;
  crowns: T.InstancedMesh;
  player: Car;
  cars: Car[];
  cones: T.Group[];
  used: Map<number, T.Object3D>;
  church: T.Group;
  shake: number;
  roll: number;
  dummy: T.Object3D;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

function roadTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3a40';
  g.fillRect(0, 0, 256, 256);
  // subtle asphalt noise
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = '#e9e4d6';
  for (let l = 1; l < LANES; l++) {
    const x = (256 / LANES) * l;
    g.fillRect(x - 3, 20, 6, 110);
  }
  g.fillRect(0, 0, 8, 256);
  g.fillRect(248, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, ROAD_LEN / 9);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCar(THREE: Three, box: T.BoxGeometry, wheel: T.CylinderGeometry, color: number, dark: T.Material): Car {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const lower = new THREE.Mesh(box, body);
  lower.scale.set(CAR_W, 0.55, CAR_L);
  lower.position.y = 0.55;
  const cabin = new THREE.Mesh(box, body);
  cabin.scale.set(CAR_W * 0.84, 0.5, CAR_L * 0.5);
  cabin.position.set(0, 1.05, -0.2);
  const glass = new THREE.Mesh(box, dark);
  glass.scale.set(CAR_W * 0.86, 0.32, CAR_L * 0.52);
  glass.position.set(0, 1.08, -0.2);
  group.add(lower, cabin, glass);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheel, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * (CAR_W / 2), 0.36, sz * (CAR_L * 0.32));
    group.add(w);
  }
  return { group, body };
}

function frondGeometry(THREE: Three) {
  // seven drooping blades radiating from the crown
  const pos: number[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const len = 2.6;
    const tip = [dx * len, -0.9, dz * len];
    const mid = [dx * len * 0.5, 0.25, dz * len * 0.5];
    const w = 0.42;
    const px = -dz * w;
    const pz = dx * w;
    pos.push(0, 0, 0, mid[0] + px, mid[1], mid[2] + pz, mid[0] - px, mid[1], mid[2] - pz);
    pos.push(mid[0] + px, mid[1], mid[2] + pz, tip[0], tip[1], tip[2], mid[0] - px, mid[1], mid[2] - pz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function makeChurch(THREE: Three, box: T.BoxGeometry) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd9b98a });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  const gold = new THREE.MeshLambertMaterial({ color: 0xe6c36a });
  const shadow = new THREE.MeshLambertMaterial({ color: 0x5a3f2e });
  const mesh = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  // long arcade wings either side
  mesh(box, stone, -26, 4, 8, 30, 8, 10);
  mesh(box, stone, 26, 4, 8, 30, 8, 10);
  mesh(roof, tile, -26, 9.2, 8, 24, 2.6, 9, Math.PI / 4);
  mesh(roof, tile, 26, 9.2, 8, 24, 2.6, 9, Math.PI / 4);
  // nave
  mesh(box, stone, 0, 8, 14, 22, 16, 30);
  const nave = mesh(roof, tile, 0, 19.5, 14, 17, 7, 24, Math.PI / 4);
  nave.scale.set(17, 7, 24);
  // facade with gable and the big mosaic
  mesh(box, stone, 0, 9.5, -2, 26, 19, 3);
  const gable = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), stone);
  gable.rotation.y = Math.PI / 4;
  gable.scale.set(19, 6, 2.2);
  gable.position.set(0, 22, -2);
  g.add(gable);
  mesh(box, gold, 0, 13.5, -3.7, 18, 7.5, 0.4);
  mesh(box, shadow, -6, 4, -3.7, 3.4, 6.5, 0.4);
  mesh(box, shadow, 0, 4, -3.7, 3.4, 6.5, 0.4);
  mesh(box, shadow, 6, 4, -3.7, 3.4, 6.5, 0.4);
  // crossing with a low octagonal drum and dome
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 6, 8), stone);
  drum.position.set(0, 26, 22);
  g.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tile);
  dome.position.set(0, 29, 22);
  g.add(dome);
  return g;
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf4cfa6, 60, 300);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 600);

  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x6b7a4a, 1.0));
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
  sun.position.set(-30, 40, 120);
  scene.add(sun);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const dark = new THREE.MeshLambertMaterial({ color: 0x15161a });

  // ground, road, curbs
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, ROAD_LEN + 60), new THREE.MeshLambertMaterial({ color: 0x8fa35a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, ROAD_LEN / 2 - 20);
  scene.add(ground);
  const roadTex = roadTexture(THREE);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshLambertMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, ROAD_LEN / 2 - 20);
  scene.add(road);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: 0xd8cbb0 }));
    curb.scale.set(1.2, 0.18, ROAD_LEN);
    curb.position.set(side * (ROAD_W / 2 + 0.6), 0.09, ROAD_LEN / 2 - 20);
    scene.add(curb);
  }

  // palms, instanced
  const n = TREES_PER_SIDE * 2;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), n);
  const crowns = new THREE.InstancedMesh(frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), n);
  scene.add(trunks, crowns);

  const player = makeCar(THREE, box, wheel, 0xf2f2f4, dark);
  scene.add(player.group);
  const cars: Car[] = [];
  for (let i = 0; i < 8; i++) {
    const c = makeCar(THREE, box, wheel, 0xffffff, dark);
    c.group.rotation.y = Math.PI;
    c.group.visible = false;
    scene.add(c.group);
    cars.push(c);
  }
  const cones: T.Group[] = [];
  const coneGeo = new THREE.ConeGeometry(0.42, 1.1, 10);
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a1f });
  const bandGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.16, 10);
  const bandMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = 0.55;
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.62;
    g.add(cone, band);
    g.visible = false;
    scene.add(g);
    cones.push(g);
  }

  const church = makeChurch(THREE, box);
  church.position.set(0, 0, CHURCH_Z);
  scene.add(church);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false }));
  sunDisc.position.set(-40, 48, 420);
  scene.add(sunDisc);

  const world: World = {
    gl,
    scene,
    camera,
    road,
    roadTex,
    trunks,
    crowns,
    player,
    cars,
    cones,
    used: new Map(),
    church,
    shake: 0,
    roll: 0,
    dummy: new THREE.Object3D(),
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = camera.aspect < 0.8 ? 80 : camera.aspect < 1.2 ? 68 : 58;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      box.dispose();
      wheel.dispose();
      dark.dispose();
      gl.dispose();
    },
  };
  return world;
}

function syncWorld(w: World, s: State) {
  const { dummy } = w;
  // palms slide past, recycled by distance
  const total = TREES_PER_SIDE * TREE_GAP;
  for (let i = 0; i < TREES_PER_SIDE * 2; i++) {
    const side = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    const z = ((k * TREE_GAP - s.dist) % total + total) % total - 8;
    const x = side * (ROAD_W / 2 + 3.2);
    const hgt = 6.5 + ((k * 7) % 5) * 0.5;
    dummy.position.set(x, hgt / 2, z);
    dummy.scale.set(1, hgt, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    w.trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, hgt + 0.2, z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, k * 1.3, 0);
    dummy.updateMatrix();
    w.crowns.setMatrixAt(i, dummy.matrix);
  }
  w.trunks.instanceMatrix.needsUpdate = true;
  w.crowns.instanceMatrix.needsUpdate = true;
  w.roadTex.offset.y = s.dist / 9;

  // obstacles: pool cars and cones by obstacle id
  const live = new Set<number>();
  for (const o of s.obstacles) {
    if (o.z > SPAWN_Z + 10) continue;
    live.add(o.id);
    let obj = w.used.get(o.id);
    if (!obj) {
      if (o.kind === 'car') {
        const c = w.cars.find((c) => !c.group.visible);
        if (!c) continue;
        c.body.color.setHSL(o.hue / 360, 0.55, 0.5);
        obj = c.group;
      } else {
        const g = w.cones.find((g) => !g.visible);
        if (!g) continue;
        obj = g;
      }
      obj.visible = true;
      w.used.set(o.id, obj);
    }
    obj.position.set(laneX(o.lane), 0, o.z);
  }
  for (const [id, obj] of w.used) {
    if (!live.has(id)) {
      obj.visible = false;
      w.used.delete(id);
    }
  }
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const [hud, setHud] = useState('');
  const [crash, setCrash] = useState(0);
  const pending = useRef<(-1 | 1)[]>([]);
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const crashTimer = useRef(0);
  const hudTick = useRef(0);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    syncWorld(w, state.current);
    w.camera.position.set(0, 3.4, -7);
    w.camera.lookAt(0, 1.2, 12);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE]);

  useGameLoop(
    (dt) => {
      const w = world.current;
      const s = state.current;
      if (!w) return;
      if (!s.crashed) {
        if (keys.pressed('left')) pending.current.push(-1);
        if (keys.pressed('right')) pending.current.push(1);
        for (const d of pending.current) {
          const before = s.lane;
          steer(s, d);
          if (s.lane !== before) sfx.play('tick', 0.8);
        }
        pending.current.length = 0;
        step(s, dt);
        if (s.crashed) {
          sfx.play('boom');
          sfx.play('hit', 0.6);
          w.shake = 0.7;
          setCrash(Date.now());
          crashTimer.current = 1.1;
        } else {
          shell.setScore(score(s));
          hudTick.current -= dt;
          if (hudTick.current <= 0) {
            hudTick.current = 0.25;
            setHud(`${kmh(s)} km/h`);
          }
        }
      } else if (crashTimer.current > 0) {
        crashTimer.current -= dt;
        if (crashTimer.current <= 0) shell.gameOver(score(s), { title: 'Crashed', detail: `${score(s)} m down Palm Drive.` });
      }
      pending.current.length = 0;

      // player car and camera
      const p = w.player.group;
      const targetRoll = (laneX(s.lane) - s.x) * 0.12;
      w.roll = damp(w.roll, targetRoll, 10, dt);
      p.position.set(s.x, 0, 0);
      p.rotation.set(0, -(laneX(s.lane) - s.x) * 0.18, w.roll);
      if (s.crashed) {
        p.rotation.y += dt * 3;
        p.position.y = Math.max(0, p.position.y + (crashTimer.current > 0.7 ? 2.5 * dt : -3 * dt));
      }
      w.shake = Math.max(0, w.shake - dt);
      const sh = w.shake * 0.5;
      const cx = damp(w.camera.position.x, s.x * 0.6, 6, dt);
      w.camera.position.set(cx + (Math.random() - 0.5) * sh, 3.4 + (Math.random() - 0.5) * sh, -7);
      w.camera.lookAt(s.x * 0.3, 1.2, 12);
      w.church.position.x = 0;
      syncWorld(w, s);
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
    pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = null;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) pending.current.push(dx < 0 ? -1 : 1);
    else if (Math.abs(dx) <= 24 && Math.abs(dy) <= 24) {
      const rect = e.currentTarget.getBoundingClientRect();
      pending.current.push(e.clientX < rect.left + rect.width / 2 ? -1 : 1);
    }
  };

  return (
    <>
      <div
        ref={ref}
        className="g-palmdrive-host"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointer.current = null)}
      />
      {shell.status !== 'ready' && hud && !state.current.crashed && <div className="g-palmdrive-hud">{hud}</div>}
      {crash > 0 && <div key={crash} className="g-palmdrive-crash" />}
      {shell.touch && shell.status === 'playing' && state.current.dist < 60 && (
        <div className="g-palmdrive-zones" aria-hidden="true">
          <span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </span>
          <span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      )}
    </>
  );
}
