import type * as T from 'three';
import type { Car, World } from './logic.ts';
import { createGL, damp, disposeTree, type GL } from './gl';

type Three = typeof import('three');
type Drop = { x: number; z: number; y: number; vx: number; vz: number; vy: number; life: number };
type SplashRing = { x: number; z: number; life: number };
type Position = { x: number; y: number; visible: boolean };
export type View = {
  gl: GL;
  resize: (w: number, h: number) => void;
  update: (world: World, dt: number, mine: number) => void;
  render: () => void;
  project: (car: Car) => Position;
  hit: (power: number) => void;
  splash: (x: number, z: number) => void;
  dispose: () => void;
};

export const CAR_COLORS = ['#ff6b5a', '#3fa9ff', '#8ad83f', '#ffc23d', '#a77bff', '#34d1b6', '#ff7ac6', '#ff9a3d'] as const;
const CAR_COUNT = 8;
const CHARGE_STEPS = 24;
const DROP_COUNT = 72;
const RING_COUNT = 12;
const pitch = (55 * Math.PI) / 180;
const toColor = (THREE: Three, value: string) => new THREE.Color(value);

function setInstance(mesh: T.InstancedMesh, index: number, dummy: T.Object3D, pos: [number, number, number], rot: [number, number, number], scale: [number, number, number]) {
  dummy.position.set(...pos);
  dummy.rotation.set(...rot);
  dummy.scale.set(...scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function build(THREE: Three, host: HTMLElement, touch: boolean): View | null {
  const gl = createGL(THREE, host, { alpha: true, maxDpr: touch ? 1.25 : 1.5 });
  if (!gl) return null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
  scene.add(new THREE.HemisphereLight(0xfff4df, 0x246a73, 1.65));
  const sun = new THREE.DirectionalLight(0xffe0ad, 1.45);
  sun.position.set(-12, 22, 9);
  scene.add(sun);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshLambertMaterial({ color: 0x3d9e9e, flatShading: true }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.25;
  scene.add(water);

  const platformBase = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.38, 48),
    new THREE.MeshLambertMaterial({ color: 0xc95f55, flatShading: true }),
  );
  platformBase.position.y = -0.04;
  scene.add(platformBase);
  const platformTop = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.15, 48),
    new THREE.MeshLambertMaterial({ color: 0xf5e6c7, flatShading: true }),
  );
  platformTop.position.y = 0.225;
  scene.add(platformTop);
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.68, 2.2, 8),
    new THREE.MeshLambertMaterial({ color: 0x2b6670, flatShading: true }),
  );
  pillar.position.y = -1.3;
  scene.add(pillar);

  const dummy = new THREE.Object3D();
  const rimGeometry = new THREE.BoxGeometry(1.08, 0.1, 0.42);
  const rim = new THREE.InstancedMesh(rimGeometry, new THREE.MeshLambertMaterial({ flatShading: true }), 24);
  const coral = toColor(THREE, '#ff6b5a');
  const cream = toColor(THREE, '#fff8e8');
  for (let i = 0; i < 24; i++) rim.setColorAt(i, i % 2 ? cream : coral);
  scene.add(rim);

  const edgeRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.11, 5, 40),
    new THREE.MeshLambertMaterial({ color: 0x70484b, flatShading: true }),
  );
  edgeRing.rotation.x = Math.PI / 2;
  edgeRing.position.y = 0.08;
  scene.add(edgeRing);

  const ripple = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.035, 4, 36),
    new THREE.MeshBasicMaterial({ color: 0xb4e5d5, transparent: true, opacity: 0.44 }),
    3,
  );
  for (let i = 0; i < 3; i++) ripple.setColorAt(i, new THREE.Color(0xb4e5d5));
  scene.add(ripple);

  const body = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.7, 0.78, 0.42, 12, 1),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    CAR_COUNT,
  );
  const bumper = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.77, 0.12, 6, 14),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    CAR_COUNT,
  );
  const seat = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.18, 8),
    new THREE.MeshLambertMaterial({ color: 0x3e4548, flatShading: true }),
    CAR_COUNT,
  );
  const head = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.23, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffd5aa, flatShading: true }),
    CAR_COUNT,
  );
  const flagGeometry = new THREE.BufferGeometry();
  flagGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      0, 0, 0, 0.06, 0, 0, 0.06, 0.32, 0, 0, 0.32, 0,
      0.06, 0.1, 0, 0.29, 0.18, 0, 0.06, 0.26, 0,
    ], 3),
  );
  flagGeometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  flagGeometry.computeVertexNormals();
  const flag = new THREE.InstancedMesh(
    flagGeometry,
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: true }),
    CAR_COUNT,
  );
  const shadow = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.88, 16),
    new THREE.MeshBasicMaterial({ color: 0x174c53, transparent: true, opacity: 0.3 }),
    CAR_COUNT,
  );
  const marker = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.06, 5, 16),
    new THREE.MeshBasicMaterial(),
    CAR_COUNT,
  );
  const streak = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.78),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }),
    CAR_COUNT,
  );
  const charge = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.17, 0.055, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffc23d }),
    CAR_COUNT * CHARGE_STEPS,
  );
  for (const mesh of [body, bumper, seat, head, flag, shadow, marker, streak, charge]) {
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  for (let i = 0; i < CAR_COUNT; i++) {
    const color = toColor(THREE, CAR_COLORS[i]);
    body.setColorAt(i, color);
    flag.setColorAt(i, color);
    marker.setColorAt(i, color);
  }

  const drops = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.08, 5, 4),
    new THREE.MeshBasicMaterial({ color: 0xe6ffff }),
    DROP_COUNT,
  );
  const splashRings = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.035, 4, 24),
    new THREE.MeshBasicMaterial({ color: 0xc3f2e6, transparent: true, opacity: 0.75 }),
    RING_COUNT,
  );
  scene.add(drops, splashRings);
  const dropState: (Drop | null)[] = Array.from({ length: DROP_COUNT }, () => null);
  const ringState: (SplashRing | null)[] = Array.from({ length: RING_COUNT }, () => null);
  let dropCursor = 0;
  let ringCursor = 0;
  let clock = 0;
  let width = 1;
  let height = 1;
  let cameraDistance = 30;
  let previousRadius = 0;
  let flash = 0;
  let shake = 0;

  const resize = (w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    width = w;
    height = h;
    gl.renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const distanceFor = (radius: number) => {
    const vertical = (camera.fov * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const extent = radius + 2;
    return Math.max(extent / Math.tan(horizontal), (extent * Math.sin(pitch)) / Math.tan(vertical)) * 1.08;
  };

  const view: View = {
    gl,
    resize,
    update(world, dt, mine) {
      clock += dt;
      flash = Math.max(0, flash - dt * 2.4);
      shake = Math.max(0, shake - dt * 1.8);
      cameraDistance = damp(cameraDistance, distanceFor(world.radius || world.startRadius || 10), 2, dt);
      const jitterX = shake > 0 ? Math.sin(clock * 48) * shake * 0.18 : 0;
      const jitterZ = shake > 0 ? Math.cos(clock * 41) * shake * 0.18 : 0;
      camera.position.set(jitterX, cameraDistance * Math.sin(pitch), cameraDistance * Math.cos(pitch) + jitterZ);
      camera.lookAt(0, 0, 0);

      const radius = world.radius || world.startRadius || 10;
      platformBase.scale.set(radius + 0.12, 1, radius + 0.12);
      platformTop.scale.set(radius, 1, radius);
      edgeRing.scale.set(radius, radius, radius);
      pillar.scale.set(1, 1, 1);
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const r = radius - 0.27;
        const pulse = previousRadius > world.radius ? 1 + flash * 0.16 : 1;
        setInstance(rim, i, dummy, [Math.cos(angle) * r, 0.33, Math.sin(angle) * r], [0, angle + Math.PI / 2, 0], [pulse, 1, 1]);
      }
      rim.instanceMatrix.needsUpdate = true;
      if (previousRadius > world.radius) flash = Math.max(flash, 0.6);
      previousRadius = world.radius;

      for (let i = 0; i < 3; i++) {
        const wave = (clock * 0.22 + i / 3) % 1;
        const r = radius + 1.5 + wave * 3;
        setInstance(ripple, i, dummy, [0, -1.13 + i * 0.004, 0], [Math.PI / 2, 0, 0], [r, r, r]);
      }
      ripple.instanceMatrix.needsUpdate = true;

      for (const car of world.cars) {
        const i = car.id;
        const visible = !car.out;
        const scale = visible ? 1 : 0;
        const squash = car.charge > 0 ? 1 - car.charge * 0.16 : 1;
        setInstance(body, i, dummy, [car.x, car.y + 0.48, car.z], [0, car.yaw, 0], [scale * (1 + car.charge * 0.12), scale * squash, scale * (1 + car.charge * 0.12)]);
        setInstance(bumper, i, dummy, [car.x, car.y + 0.35, car.z], [Math.PI / 2, 0, 0], [scale, scale, scale]);
        setInstance(seat, i, dummy, [car.x, car.y + 0.75, car.z], [0, car.yaw, 0], [scale, scale, scale]);
        setInstance(head, i, dummy, [car.x + Math.sin(car.yaw) * 0.08, car.y + 0.98, car.z + Math.cos(car.yaw) * 0.08], [0, car.yaw, 0], [scale, scale, scale]);
        setInstance(flag, i, dummy, [car.x, car.y + 1.08, car.z], [0, car.yaw, 0], [scale, scale, scale]);
        setInstance(shadow, i, dummy, [car.x, -0.08, car.z], [-Math.PI / 2, 0, 0], [scale, scale * (1 - Math.min(0.6, Math.abs(car.y) * 0.12)), scale]);
        setInstance(marker, i, dummy, [car.x, 0.08, car.z], [Math.PI / 2, 0, 0], [i === mine && visible ? 1.16 : 0, 1.16, 1.16]);
        const speed = Math.hypot(car.vx, car.vz);
        const backX = car.x - Math.sin(car.yaw) * 1.1;
        const backZ = car.z - Math.cos(car.yaw) * 1.1;
        setInstance(streak, i, dummy, [backX, car.y + 0.48, backZ], [0, car.yaw, 0], [car.dashT > 0 ? scale : 0, scale, scale]);
        for (let n = 0; n < CHARGE_STEPS; n++) {
          const visibleStep = visible && car.charge > n / CHARGE_STEPS;
          const a = (n / CHARGE_STEPS) * Math.PI * 2;
          const r = 1.15;
          setInstance(charge, i * CHARGE_STEPS + n, dummy, [car.x + Math.cos(a) * r, 0.09, car.z + Math.sin(a) * r], [0, -a, 0], [visibleStep ? 1 : 0, 1, 1]);
        }
        if (speed > 6 && car.dashT > 0) shake = Math.max(shake, Math.min(0.12, speed * 0.006));
      }
      for (const mesh of [body, bumper, seat, head, flag, shadow, marker, streak, charge]) mesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < DROP_COUNT; i++) {
        const drop = dropState[i];
        if (drop) {
          drop.life -= dt;
          drop.x += drop.vx * dt;
          drop.z += drop.vz * dt;
          drop.y += drop.vy * dt;
          drop.vy -= 7 * dt;
          if (drop.life <= 0) dropState[i] = null;
          setInstance(drops, i, dummy, [drop.x, drop.y, drop.z], [0, 0, 0], drop.life > 0 ? [1, 1, 1] : [0, 0, 0]);
        } else setInstance(drops, i, dummy, [0, -20, 0], [0, 0, 0], [0, 0, 0]);
      }
      for (let i = 0; i < RING_COUNT; i++) {
        const ring = ringState[i];
        if (ring) {
          ring.life -= dt;
          if (ring.life <= 0) ringState[i] = null;
          const r = 0.3 + (1 - Math.max(0, ring.life)) * 3.2;
          setInstance(splashRings, i, dummy, [ring.x, -1.14, ring.z], [Math.PI / 2, 0, 0], ring.life > 0 ? [r, r, r] : [0, 0, 0]);
        } else setInstance(splashRings, i, dummy, [0, -20, 0], [Math.PI / 2, 0, 0], [0, 0, 0]);
      }
      drops.instanceMatrix.needsUpdate = true;
      splashRings.instanceMatrix.needsUpdate = true;
    },
    render() {
      if (!gl.lost()) gl.renderer.render(scene, camera);
    },
    project(car) {
      const point = new THREE.Vector3(car.x, car.y + 1.42, car.z).project(camera);
      return {
        x: (point.x * 0.5 + 0.5) * width,
        y: (-point.y * 0.5 + 0.5) * height,
        visible: !car.out && point.z > -1 && point.z < 1,
      };
    },
    hit(power) {
      shake = Math.max(shake, Math.min(0.65, 0.12 + power * 0.018));
    },
    splash(x, z) {
      ringState[ringCursor] = { x, z, life: 1 };
      ringCursor = (ringCursor + 1) % RING_COUNT;
      for (let n = 0; n < 10; n++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + Math.random() * 2.1;
        dropState[dropCursor] = { x, z, y: -0.92, vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, vy: 1.3 + Math.random() * 2, life: 0.75 + Math.random() * 0.55 };
        dropCursor = (dropCursor + 1) % DROP_COUNT;
      }
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };

  resize(host.clientWidth, host.clientHeight);
  const initialR = 10;
  cameraDistance = distanceFor(initialR);
  return view;
}

export function createScene(THREE: Three, host: HTMLElement, touch: boolean) {
  return build(THREE, host, touch);
}
