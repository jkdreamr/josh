import { useEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { clamp, createGL, damp, disposeTree, type GL } from './gl';
import {
  BALL_R,
  BOARD_BOTTOM,
  BOARD_OFF,
  BOARD_TOP,
  BOARD_W,
  HOOP_Z,
  RIM_R,
  RIM_TUBE,
  RIM_Y,
  START,
  aimFromDrag,
  canShoot,
  create,
  fire,
  fmtClock,
  launchVelocity,
  stepGame,
  targetFor,
  type Aim,
  type Game as State,
} from './logic';
import { meta } from './meta';
import './hoops.css';

type Three = typeof import('three');

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

const PREVIEW_N = 36;

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  hoop: T.Group;
  net: T.Mesh;
  ball: T.Mesh;
  preview: T.Line;
  reticle: T.Mesh;
  netPulse: number;
  shake: number;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

function courtTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c99763';
  g.fillRect(0, 0, 512, 1024);
  // planks
  g.strokeStyle = 'rgba(0,0,0,0.08)';
  g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 1024);
    g.stroke();
  }
  // key
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 6;
  g.strokeRect(256 - 100, 0, 200, 420);
  g.beginPath();
  g.arc(256, 420, 100, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(256, 0, 420, 0, Math.PI);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function boardTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f6';
  g.fillRect(0, 0, 512, 300);
  g.lineWidth = 10;
  g.strokeStyle = '#1b1b1f';
  g.strokeRect(5, 5, 502, 290);
  g.strokeStyle = '#e24a3a';
  g.strokeRect(512 / 2 - 85, 300 - 10 - 130, 170, 130);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ballTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8702a';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#2a1a12';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(256, 64);
  g.stroke();
  for (const x of [64, 192]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 128);
    g.stroke();
  }
  g.beginPath();
  g.ellipse(128, 64, 40, 70, 0, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x15161d, 14, 30);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
  camera.position.set(0, 2.4, 3.1);
  camera.lookAt(0, 2.45, HOOP_Z + 0.4);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3a30, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa9c4ff, 1.2);
  rim.position.set(-4, 5, -6);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 28), new THREE.MeshLambertMaterial({ map: courtTexture(THREE) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, HOOP_Z - BOARD_OFF - 1.2 + 14);
  scene.add(floor);

  // back wall
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshLambertMaterial({ color: 0x23252f }));
  wall.position.set(0, 6, HOOP_Z - BOARD_OFF - 1.3);
  scene.add(wall);

  const hoop = new THREE.Group();
  scene.add(hoop);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.6, roughness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.9, 12), metal);
  pole.position.set(0, 1.95, HOOP_Z - BOARD_OFF - 0.95);
  hoop.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.95), metal);
  arm.position.set(0, 3.75, HOOP_Z - BOARD_OFF - 0.53);
  hoop.add(arm);
  const boardH = BOARD_TOP - BOARD_BOTTOM;
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, boardH, 0.05), [
    new THREE.MeshLambertMaterial({ color: 0xd9d9de }),
    new THREE.MeshLambertMaterial({ color: 0xd9d9de }),
    new THREE.MeshLambertMaterial({ color: 0xd9d9de }),
    new THREE.MeshLambertMaterial({ color: 0xd9d9de }),
    new THREE.MeshLambertMaterial({ map: boardTexture(THREE) }),
    new THREE.MeshLambertMaterial({ color: 0xbfc0c6 }),
  ]);
  board.position.set(0, (BOARD_TOP + BOARD_BOTTOM) / 2, HOOP_Z - BOARD_OFF - 0.025);
  hoop.add(board);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE, 10, 40), new THREE.MeshStandardMaterial({ color: 0xff6a2a, metalness: 0.3, roughness: 0.45 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RIM_Y, HOOP_Z);
  hoop.add(ring);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, BOARD_OFF - RIM_R), new THREE.MeshStandardMaterial({ color: 0xff6a2a }));
  bracket.position.set(0, RIM_Y - 0.01, HOOP_Z - RIM_R - (BOARD_OFF - RIM_R) / 2);
  hoop.add(bracket);
  const net = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R - 0.01, 0.14, 0.42, 12, 5, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 }));
  net.position.set(0, RIM_Y - 0.22, HOOP_Z);
  hoop.add(net);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), new THREE.MeshStandardMaterial({ map: ballTexture(THREE), roughness: 0.75 }));
  ball.position.set(START.x, START.y, START.z);
  scene.add(ball);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(START.x, 0.005, START.z);
  shadow.name = 'shadow';
  scene.add(shadow);

  const previewGeo = new THREE.BufferGeometry();
  previewGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_N * 3), 3));
  const preview = new THREE.Line(previewGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
  preview.visible = false;
  preview.frustumCulled = false;
  scene.add(preview);
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  reticle.rotation.x = -Math.PI / 2;
  reticle.visible = false;
  scene.add(reticle);

  const world: World = {
    gl,
    scene,
    camera,
    hoop,
    net,
    ball,
    preview,
    reticle,
    netPulse: 0,
    shake: 0,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = aspect < 0.8 ? 74 : aspect < 1.3 ? 60 : 48;
      camera.position.z = aspect < 0.8 ? 3.4 : 3.1;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };
  return world;
}

type Hud = { clock: string; round: number; makes: number; target: number; low: boolean };

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const aim = useRef<Aim | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const kb = useRef({ lateral: 0, charging: false, power: 0, dir: 1 });
  const [hud, setHud] = useState<Hud>({ clock: '1:00', round: 1, makes: 0, target: targetFor(1), low: false });
  const [power, setPower] = useState<number | null>(null);
  const [pop, setPop] = useState<{ text: string; swish: boolean; id: number } | null>(null);
  const [banner, setBanner] = useState<{ text: string; sub: string; id: number } | null>(null);
  const hudKey = useRef('');
  const lastTick = useRef(0);

  useEffect(() => {
    if (shell.status !== 'playing') lastTick.current = 0;
  }, [shell.status]);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
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

  const showPreview = (a: Aim | null) => {
    const w = world.current;
    if (!w) return;
    const g = state.current;
    if (!a || !canShoot(g)) {
      w.preview.visible = false;
      w.reticle.visible = false;
      return;
    }
    const target = { x: g.hoop.x + a.lateral, y: g.hoop.y, z: g.hoop.z - a.depth };
    const v = launchVelocity(START, target);
    const pos = w.preview.geometry.getAttribute('position') as T.BufferAttribute;
    const dt = 0.06;
    let x = START.x;
    let y = START.y;
    let z = START.z;
    let vy = v.y;
    for (let i = 0; i < PREVIEW_N; i++) {
      pos.setXYZ(i, x, y, z);
      vy -= 9.81 * dt;
      x += v.x * dt;
      y += vy * dt;
      z += v.z * dt;
      if (y < 0.1 || z < g.hoop.z - BOARD_OFF) {
        for (let j = i + 1; j < PREVIEW_N; j++) pos.setXYZ(j, x, Math.max(0.1, y), z);
        break;
      }
    }
    pos.needsUpdate = true;
    w.preview.visible = true;
    w.reticle.visible = true;
    w.reticle.position.set(target.x, target.y + 0.01, target.z);
  };

  const shoot = (a: Aim) => {
    const g = state.current;
    if (!fire(g, a)) return;
    sfx.play('jump', 0.9);
    showPreview(null);
    const w = world.current;
    if (w) w.shake = 0.08;
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      const g = state.current;
      if (!w) return;
      if (!g.over) {
        // keyboard aim: arrows drift the target, hold space to charge, release to shoot
        const k = kb.current;
        const ax = keys.axis('left', 'right');
        if (ax) k.lateral = clamp(k.lateral + ax * 2.4 * dt, -1.6, 1.6);
        const holding = keys.down('action');
        if (holding && canShoot(g)) {
          if (!k.charging) {
            k.charging = true;
            k.power = 0;
            k.dir = 1;
          }
          k.power += k.dir * 2.1 * dt;
          if (k.power > 1.7) {
            k.power = 1.7;
            k.dir = -1;
          } else if (k.power < 0) {
            k.power = 0;
            k.dir = 1;
          }
          aim.current = { lateral: k.lateral, depth: (k.power - 1) * 1.4 };
          setPower(k.power);
        } else if (k.charging) {
          k.charging = false;
          setPower(null);
          if (aim.current && canShoot(g)) shoot(aim.current);
          aim.current = null;
        } else if (!drag.current && Math.abs(k.lateral) > 0.01 && ax && canShoot(g)) {
          aim.current = { lateral: k.lateral, depth: 0 };
        }
        if (aim.current && !drag.current && !k.charging && !ax) aim.current = null;
        showPreview(aim.current);

        const now = performance.now();
        const clockDt = lastTick.current ? Math.min(0.25, (now - lastTick.current) / 1000) : dt;
        lastTick.current = now;
        const out = stepGame(g, dt, clockDt);
        if (out.rim) sfx.play('tick', 0.8);
        if (out.board) sfx.play('hit', 1.6);
        if (out.score) {
          const swish = out.score === 'swish';
          sfx.play(swish ? 'win' : 'coin', swish ? 1.1 : 1);
          setPop({ text: swish ? 'swish +3' : '+2', swish, id: Date.now() });
          shell.setScore(g.score);
          w.netPulse = 1;
        }
        if (out.floor && !g.ball.scored && g.ball.bounces === 1) sfx.play('blip', 0.5);
        if (out.roundUp) {
          sfx.play('win', 1.3);
          setBanner({ text: `Round ${g.round}`, sub: g.round === 2 ? 'The hoop moves now. Make ' + targetFor(g.round) + '.' : `Faster hoop. Make ${targetFor(g.round)}.`, id: Date.now() });
        }
        if (out.over) {
          sfx.play('lose');
          shell.gameOver(g.score, { detail: `${g.attempts} shots, ${g.makes} of ${targetFor(g.round)} in round ${g.round}.` });
        }
        const low = g.timeLeft < 10;
        const next = `${fmtClock(g.timeLeft)}|${g.round}|${g.makes}|${low}`;
        if (next !== hudKey.current) {
          hudKey.current = next;
          setHud({ clock: fmtClock(g.timeLeft), round: g.round, makes: g.makes, target: targetFor(g.round), low });
        }
      }
      // visuals
      w.hoop.position.x = g.hoop.x;
      const b = g.ball;
      if (b.live) w.ball.position.set(b.p.x, b.p.y, b.p.z);
      else {
        // bring the next ball back into the hands
        w.ball.position.x = damp(w.ball.position.x, START.x, 10, dt);
        w.ball.position.y = damp(w.ball.position.y, START.y, 10, dt);
        w.ball.position.z = damp(w.ball.position.z, START.z, 10, dt);
        b.p.x = w.ball.position.x;
        b.p.y = w.ball.position.y;
        b.p.z = w.ball.position.z;
      }
      w.ball.rotation.x = -b.spin;
      const shadow = w.scene.getObjectByName('shadow');
      if (shadow) {
        shadow.position.set(b.p.x, 0.005, b.p.z);
        const s = clamp(1 - b.p.y / 6, 0.3, 1);
        shadow.scale.setScalar(s);
      }
      if (w.netPulse > 0) {
        w.netPulse = Math.max(0, w.netPulse - dt * 2.5);
        const s = 1 + Math.sin(w.netPulse * Math.PI) * 0.18;
        w.net.scale.set(s, 1 + (1 - s) * 0.5 + 0.08 * w.netPulse, s);
      }
      w.shake = Math.max(0, w.shake - dt);
      const base = w.camera.position.z;
      w.camera.position.set((Math.random() - 0.5) * w.shake * 0.3, 2.4 + (Math.random() - 0.5) * w.shake * 0.3, base);
      // camera follows the ball a touch
      const look = damp(w.camera.userData.lookX ?? 0, b.live ? b.p.x * 0.25 : 0, 3, dt);
      w.camera.userData.lookX = look;
      w.camera.lookAt(look, 2.45, HOOP_Z + 0.4);
    },
    () => {
      const w = world.current;
      if (!w || w.gl.lost()) return;
      w.gl.renderer.render(w.scene, w.camera);
    },
  );

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (shell.status !== 'playing' || !canShoot(state.current) || drag.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dy = e.clientY - d.y;
    if (-dy < 8) {
      aim.current = null;
      return;
    }
    aim.current = aimFromDrag(e.clientX - d.x, dy, r.width, r.height);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const a = aim.current;
    aim.current = null;
    if (a && shell.status === 'playing') shoot(a);
    else showPreview(null);
  };

  const playing = shell.status === 'playing';
  const sweet = power !== null && Math.abs(power - 1) < 0.12;
  return (
    <>
      <div ref={ref} className="g-hoops-host" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <div className="g-hoops-hud" aria-live="off">
        <span className={hud.low ? 'is-low' : undefined}>{hud.clock}</span>
        <span>round {hud.round}</span>
        <span>
          {hud.makes}/{hud.target}
        </span>
      </div>
      {power !== null && (
        <div className="g-hoops-power">
          <i className={sweet ? 'is-sweet' : undefined} style={{ width: `${(power / 1.7) * 100}%` }} />
          <b />
        </div>
      )}
      {pop && (
        <div key={pop.id} className={`g-hoops-pop ${pop.swish ? 'is-swish' : ''}`}>
          {pop.text}
        </div>
      )}
      {banner && (
        <div key={banner.id} className="g-hoops-banner">
          <strong>{banner.text}</strong>
          <small>{banner.sub}</small>
        </div>
      )}
      {playing && state.current.attempts === 0 && power === null && (
        <div className="g-hoops-hint">{shell.touch ? 'swipe up to shoot, drift sideways to aim' : 'drag up to shoot, or hold space and release'}</div>
      )}
    </>
  );
}
