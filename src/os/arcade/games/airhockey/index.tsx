import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { T } from './gl';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createGL, damp, disposeTree, type GL } from './gl';
import { GOAL_W, L, MALLET_R, PUCK_R, TO_WIN, W, aiHit, create, moveMalletTo, nudgeMallet, step, stepAI, type Difficulty, type Event, type Mode, type State, type V2 } from './logic';
import { meta } from './meta';
import './airhockey.css';

type Three = typeof import('three');

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />}>
      <Play />
    </GameShell>
  );
}

const SUBSTEP = 1 / 120;
const P1 = 0x34c3ff;
const P2 = 0xff6b8a;
const PUCK_INK = 0x15171c;
const RAIL_H = 0.14;
const RAIL_T = 0.1;
const TRAIL = 7;
/** A mallet hit softer than this is resting contact: no sound, spark or new computer decision. */
const SOFT = 0.3;

type Burst = { mesh: T.Mesh; life: number; max: number; size: number };

type World = {
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  puck: T.Mesh;
  puckRing: T.Mesh;
  mallets: [T.Mesh, T.Mesh];
  glow: [T.Mesh, T.Mesh];
  /** blob shadows: puck, then each mallet */
  shadows: T.Mesh[];
  trail: T.Mesh[];
  trailPts: V2[];
  bursts: Burst[];
  /** goal mouths: the top goal (the one blue shoots at) first */
  mouths: [T.Mesh, T.Mesh];
  mouthGlow: [number, number];
  squash: [number, number];
  ray: T.Raycaster;
  plane: T.Plane;
  tmp: T.Vector3;
  flash: T.Mesh;
  flashLife: number;
  shake: number;
  portrait: boolean;
  viewW: number;
  viewH: number;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

function tableTexture(THREE: Three, aniso: number) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * L) / W);
  const g = c.getContext('2d')!;
  const u = c.width / W;
  const mid = c.height / 2;
  const base = g.createLinearGradient(0, 0, 0, c.height);
  base.addColorStop(0, '#eef2f8');
  base.addColorStop(0.5, '#fbfcfe');
  base.addColorStop(1, '#eef2f8');
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  // each half leans toward its player's color
  const tint = (y0: number, y1: number, rgb: string) => {
    const t = g.createLinearGradient(0, y0, 0, y1);
    t.addColorStop(0, `rgba(${rgb}, 0.1)`);
    t.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = t;
    g.fillRect(0, Math.min(y0, y1), c.width, Math.abs(y1 - y0));
  };
  tint(0, mid, '255, 107, 138');
  tint(c.height, mid, '52, 195, 255');
  // air holes
  g.fillStyle = 'rgba(60, 80, 112, 0.2)';
  const gap = 34;
  for (let y = gap / 2; y < c.height; y += gap)
    for (let x = gap / 2; x < c.width; x += gap) {
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  // centre line and circle
  g.strokeStyle = 'rgba(30, 44, 70, 0.38)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(c.width, mid);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.arc(c.width / 2, mid, 0.3 * u, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(30, 44, 70, 0.38)';
  g.beginPath();
  g.arc(c.width / 2, mid, 9, 0, Math.PI * 2);
  g.fill();
  // goal creases in each player's color
  for (const [y, rgb] of [[0, '255, 107, 138'], [c.height, '52, 195, 255']] as const) {
    g.beginPath();
    g.arc(c.width / 2, y, (GOAL_W / 2 + 0.14) * u, 0, Math.PI * 2);
    g.fillStyle = `rgba(${rgb}, 0.1)`;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = `rgba(${rgb}, 0.75)`;
    g.stroke();
    g.fillStyle = `rgba(${rgb}, 0.5)`;
    g.fillRect(0, y === 0 ? 0 : c.height - 8, c.width, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

/** A soft round shadow, shared by everything that sits on the table. */
function shadowTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(10, 16, 28, 0.55)');
  r.addColorStop(0.55, 'rgba(10, 16, 28, 0.25)');
  r.addColorStop(1, 'rgba(10, 16, 28, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function build(THREE: Three, host: HTMLElement): World | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 8, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd4ff, 0.7);
  fill.position.set(-4, 5, -5);
  scene.add(fill);

  const flat = (geo: T.BufferGeometry, mat: T.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    scene.add(m);
    return m;
  };

  flat(new THREE.PlaneGeometry(W, L), new THREE.MeshLambertMaterial({ map: tableTexture(THREE, gl.renderer.capabilities.getMaxAnisotropy()) }), 0);
  // rails with goal gaps, each with a thin light strip along its inner edge in the color of that half
  const railMat = new THREE.MeshLambertMaterial({ color: 0x1f2636 });
  const railY = RAIL_H / 2 - 0.02;
  const side = new THREE.BoxGeometry(RAIL_T, RAIL_H, L + RAIL_T * 2);
  const ledMats = [new THREE.MeshBasicMaterial({ color: P1 }), new THREE.MeshBasicMaterial({ color: P2 })];
  const ledSide = new THREE.BoxGeometry(0.014, 0.012, L / 2);
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(side, railMat);
    r.position.set(sx * (W / 2 + RAIL_T / 2), railY, 0);
    scene.add(r);
    for (const sz of [1, -1]) {
      const led = new THREE.Mesh(ledSide, ledMats[sz > 0 ? 0 : 1]);
      led.position.set(sx * (W / 2 + 0.008), RAIL_H - 0.02 + 0.004, (sz * L) / 4);
      scene.add(led);
    }
  }
  const endLen = (W - GOAL_W) / 2;
  const end = new THREE.BoxGeometry(endLen, RAIL_H, RAIL_T);
  const ledEnd = new THREE.BoxGeometry(endLen, 0.012, 0.014);
  for (const sz of [-1, 1])
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(end, railMat);
      r.position.set(sx * (GOAL_W / 2 + endLen / 2), railY, sz * (L / 2 + RAIL_T / 2));
      scene.add(r);
      const led = new THREE.Mesh(ledEnd, ledMats[sz > 0 ? 0 : 1]);
      led.position.set(sx * (GOAL_W / 2 + endLen / 2), RAIL_H - 0.02 + 0.004, sz * (L / 2 + 0.008));
      scene.add(led);
    }
  // goal mouths: they light up when someone scores
  const mouths = [-1, 1].map((sz): T.Mesh => {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(GOAL_W, 0.02, 0.26), new THREE.MeshBasicMaterial({ color: sz > 0 ? P1 : P2, transparent: true, opacity: 0.55 }));
    mouth.position.set(0, 0.005, sz * (L / 2 + 0.12));
    scene.add(mouth);
    return mouth;
  }) as [T.Mesh, T.Mesh];
  const apron = new THREE.Mesh(new THREE.BoxGeometry(W + RAIL_T * 2, 0.22, L + RAIL_T * 2), new THREE.MeshLambertMaterial({ color: 0x12161f }));
  apron.position.y = -0.13;
  scene.add(apron);

  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const shadows = [PUCK_R * 3, MALLET_R * 3, MALLET_R * 3].map((size) => {
    const s = flat(shadowGeo, shadowMat, 0.0008);
    s.scale.set(size, size, 1);
    return s;
  });

  const trailGeo = new THREE.CircleGeometry(PUCK_R, 24);
  const trail = Array.from({ length: TRAIL }, () => {
    const t = flat(trailGeo, new THREE.MeshBasicMaterial({ color: PUCK_INK, transparent: true, opacity: 0, depthWrite: false }), 0.0012);
    t.visible = false;
    return t;
  });

  const puck = new THREE.Mesh(new THREE.CylinderGeometry(PUCK_R, PUCK_R, 0.03, 32), new THREE.MeshPhongMaterial({ color: PUCK_INK, shininess: 60 }));
  puck.position.y = 0.015;
  scene.add(puck);
  // a ring on top of the puck takes the color of whoever touched it last
  const puckRing = new THREE.Mesh(new THREE.RingGeometry(PUCK_R * 0.5, PUCK_R * 0.78, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  puckRing.rotation.x = -Math.PI / 2;
  puckRing.position.y = 0.0152;
  puck.add(puckRing);

  const malletGeo = new THREE.CylinderGeometry(MALLET_R, MALLET_R * 0.94, 0.05, 40);
  const knobGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.09, 24);
  const glowGeo = new THREE.RingGeometry(MALLET_R + 0.01, MALLET_R + 0.05, 40);
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
    glow.push(flat(glowGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }), 0.002));
  });

  const burstGeo = new THREE.RingGeometry(0.84, 1, 48);
  const bursts = Array.from({ length: 8 }, (): Burst => {
    const mesh = flat(burstGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), 0.004);
    mesh.visible = false;
    return { mesh, life: 0, max: 1, size: 0.2 };
  });

  const flash = flat(new THREE.PlaneGeometry(W, L), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), 0.003);

  const world: World = {
    gl,
    scene,
    camera,
    puck,
    puckRing,
    mallets: mallets as [T.Mesh, T.Mesh],
    glow: glow as [T.Mesh, T.Mesh],
    shadows,
    trail,
    trailPts: [],
    bursts,
    mouths,
    mouthGlow: [0, 0],
    squash: [0, 0],
    ray: new THREE.Raycaster(),
    plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    tmp: new THREE.Vector3(),
    flash,
    flashLife: 0,
    shake: 0,
    portrait: false,
    viewW: 1,
    viewH: 1,
    resize(w, h) {
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      world.portrait = camera.aspect < 1;
      world.viewW = Math.max(1, w);
      world.viewH = Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
      gl.dispose();
    },
  };
  return world;
}

/** A ring that spreads out from a hit and fades. */
function burst(w: World, at: V2, color: number, size: number, max = 0.36) {
  const b = w.bursts.reduce((a, c) => (c.life < a.life ? c : a));
  b.life = b.max = max;
  b.size = size;
  b.mesh.position.x = at.x;
  b.mesh.position.z = at.z;
  b.mesh.visible = true;
  (b.mesh.material as T.MeshBasicMaterial).color.setHex(color);
}

const TABLE_CORNERS: [number, number, number][] = [];
for (const x of [-1, 1])
  for (const z of [-1, 1]) {
    for (const y of [0, RAIL_H]) TABLE_CORNERS.push([x * (W / 2 + RAIL_T), y, z * (L / 2 + RAIL_T)]);
    TABLE_CORNERS.push([(x * GOAL_W) / 2, 0, z * (L / 2 + 0.25)]);
  }

/**
 * Camera: a perspective from your own end of the table (the top end for the second online seat); top-down for two
 * players sharing a screen, turned so the table runs along the longer side (blue on the left or bottom). Either way it
 * moves in until the table just fits the space under the score, and shifts the picture to sit centred in that space.
 */
function placeCamera(w: World, shared: boolean, flipped: boolean, hudTop: number) {
  const cam = w.camera;
  const a = cam.aspect;
  cam.clearViewOffset();
  let dir: [number, number, number];
  if (shared) {
    const landscape = a >= 1;
    const d = flipped ? 1 : -1;
    cam.up.set(landscape ? d : 0, 0, landscape ? 0 : d);
    cam.fov = 40;
    dir = [0, 1, 0];
  } else {
    cam.up.set(0, 1, 0);
    // wide, short windows look along the table a little more so it comes out bigger
    const elev = ((w.portrait ? 58 : a > 1.6 ? 44 : 50) * Math.PI) / 180;
    cam.fov = w.portrait ? 50 : 42;
    dir = [0, Math.sin(elev), Math.cos(elev) * (flipped ? -1 : 1)];
  }
  cam.updateProjectionMatrix();
  const top = 1 - (2 * Math.min(hudTop, w.viewH * 0.45)) / w.viewH - 0.02;
  const bottom = -0.97;
  const box = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const measure = (dist: number) => {
    cam.position.set(dir[0] * dist, dir[1] * dist, dir[2] * dist);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    box.x0 = box.y0 = Infinity;
    box.x1 = box.y1 = -Infinity;
    for (const [x, y, z] of TABLE_CORNERS) {
      const p = w.tmp.set(x, y, z).project(cam);
      box.x0 = Math.min(box.x0, p.x);
      box.x1 = Math.max(box.x1, p.x);
      box.y0 = Math.min(box.y0, p.y);
      box.y1 = Math.max(box.y1, p.y);
    }
    return box.x1 - box.x0 <= 1.94 && box.y1 - box.y0 <= top - bottom;
  };
  let lo = 1;
  let hi = 40;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (measure(mid)) hi = mid;
    else lo = mid;
  }
  measure(hi);
  const sx = -(box.x0 + box.x1) / 2;
  const sy = (top + bottom) / 2 - (box.y0 + box.y1) / 2;
  cam.setViewOffset(w.viewW, w.viewH, (-sx * w.viewW) / 2, (sy * w.viewH) / 2, w.viewW, w.viewH);
}

const MODE = defineSetting('airhockey:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('airhockey:level', LEVEL_NAMES, 'normal');

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

function Play() {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const [mode] = useSetting(MODE);
  const [difficulty] = useSetting(LEVEL);
  const state = useRef<State>(create(getSetting(MODE) as Mode, getSetting(LEVEL) as Difficulty));
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [pop, setPop] = useState<{ text: string; id: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const seen = useRef(false);
  // the first-play hint goes away as soon as the player does anything
  const used = () => {
    if (seen.current) return;
    seen.current = true;
    setTouched(true);
  };
  const [hud, setHud] = useState<{ left: boolean; top: number; below: number }>({ left: false, top: 10, below: 46 });
  const pointers = useRef(new Map<number, { side: 0 | 1; x: number; z: number }>());
  const lastTick = useRef(0);
  const lastHit = useRef(0);
  const lastWall = useRef(0);
  const remoteTarget = useRef<{ x: number; z: number } | null>(null);
  const remoteState = useRef<State | null>(null);
  const sendAt = useRef(0);
  const snapshotAt = useRef(0);
  const shared = !online && mode === '2p';
  const cfg = useRef({ mode: online ? ('2p' as Mode) : mode, difficulty });
  cfg.current = { mode: online ? '2p' : mode, difficulty };

  // Setup changes made on the Start card apply to the match that is about to begin.
  useEffect(() => {
    if (shell.status !== 'ready') return;
    state.current = create(online ? '2p' : mode, difficulty);
    remoteTarget.current = null;
    remoteState.current = null;
    sendAt.current = 0;
    snapshotAt.current = 0;
    setScore([0, 0]);
    setTouched(false);
    seen.current = false;
    shell.invalidate();
  }, [mode, difficulty, shell.status, shell.invalidate, online?.seat]);

  // Going to another window pauses the match, so the computer can't score on an empty table.
  useEffect(() => {
    const win = shell.root.current?.closest('.win');
    if (!win || shell.status !== 'playing' || online) return;
    const check = () => {
      if (win.classList.contains('is-inactive')) shell.pause();
    };
    const watch = new MutationObserver(check);
    watch.observe(win, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, [shell.root, shell.status, shell.pause, online]);

  /** Who the seat is, as this player sees it. */
  const nameOf = (seat: number, s: State) => {
    if (online) return online.players.find((p) => p.seat === seat)?.name ?? (seat === 0 ? 'Blue' : 'Pink');
    if (s.mode === 'cpu' && seat === 1) return 'Computer';
    return seat === 0 ? 'Blue' : 'Pink';
  };

  /** Sound and light for whatever just happened on the table. Runs on every screen, host and guest alike. */
  const fx = (ev: Event) => {
    const w = world.current;
    if (!w) return;
    const now = performance.now();
    if (ev.hit !== undefined && (ev.power ?? 1) > SOFT) {
      const power = ev.power ?? 2;
      if (now - lastHit.current > 60) sfx.play('hit', 1.7 + Math.min(1, power / 8));
      lastHit.current = now;
      const color = ev.hit === 0 ? P1 : P2;
      (w.puckRing.material as T.MeshBasicMaterial).color.setHex(color);
      w.trail.forEach((t) => (t.material as T.MeshBasicMaterial).color.setHex(color));
      w.squash[ev.hit] = Math.min(1, 0.4 + power / 8);
      if (ev.at) burst(w, ev.at, color, 0.14 + Math.min(0.22, power * 0.03));
      if (power > 5.5) w.shake = Math.max(w.shake, 0.1);
      setTouched(true);
    }
    if (ev.wall && (ev.wallPower ?? 1) > 0.5) {
      const power = ev.wallPower ?? 1;
      if (now - lastWall.current > 50) sfx.play('tick', 0.5 + Math.min(0.5, power / 10));
      lastWall.current = now;
      if (ev.at && power > 3) burst(w, ev.at, 0xffffff, 0.1 + Math.min(0.12, power * 0.015), 0.26);
    }
    if (ev.goal !== undefined) {
      const color = ev.goal === 0 ? P1 : P2;
      w.flashLife = 1;
      (w.flash.material as T.MeshBasicMaterial).color.setHex(color);
      w.shake = 0.35;
      w.mouthGlow[ev.goal] = 1;
      burst(w, { x: 0, z: ev.goal === 0 ? -L / 2 : L / 2 }, color, 0.7, 0.6);
    }
  };

  /** Score, Goal banner and the end of the match. */
  const announce = (ev: Event, s: State) => {
    if (ev.goal === undefined) return;
    setScore([s.score[0], s.score[1]]);
    const cpu = !online && s.mode === 'cpu';
    // the seat this screen plays, or null when two people share it
    const mine = online ? online.seat : cpu ? 0 : null;
    if (ev.win !== undefined) {
      const won = mine === null || ev.win === mine;
      sfx.play(won ? 'win' : 'lose');
      const title = mine !== null && ev.win === mine ? 'You Win' : `${nameOf(ev.win, s)} Wins`;
      if (online) online.reportResult(online.round, ev.win);
      const us = mine === 1 ? s.score[1] : s.score[0];
      const them = mine === 1 ? s.score[0] : s.score[1];
      shell.gameOver(cpu ? s.score[0] : undefined, { title, detail: `${us} to ${them}${cpu ? ` against the ${levelLabel(s.difficulty).toLowerCase()} computer.` : '.'}` });
    } else {
      sfx.play(mine === null || ev.goal === mine ? 'coin' : 'lose', 1.2);
      setPop({ text: mine !== null && ev.goal === mine ? 'Goal' : `${nameOf(ev.goal, s)} Scores`, id: Date.now() });
    }
    if (cpu) shell.setScore(s.score[0]);
  };

  useEffect(() => online?.onMessage((from, data) => {
    if (!online || !data || typeof data !== 'object') return;
    const message = data as { game?: unknown; type?: unknown; x?: unknown; z?: unknown; state?: unknown; event?: unknown };
    if (message.game !== 'airhockey') return;
    if (online.seat === 0 && from !== 0 && message.type === 'mallet' && typeof message.x === 'number' && typeof message.z === 'number') {
      remoteTarget.current = { x: message.x, z: message.z };
    } else if (online.seat !== 0 && from === 0 && message.type === 'snapshot' && message.state && typeof message.state === 'object') {
      remoteState.current = message.state as State;
    } else if (online.seat !== 0 && from === 0 && message.type === 'events' && message.event && typeof message.event === 'object') {
      if (message.state && typeof message.state === 'object') remoteState.current = message.state as State;
      const event = message.event as Event;
      const s = state.current;
      fx(event);
      if (event.goal !== undefined && remoteState.current) {
        s.score = [...remoteState.current.score];
        announce(event, s);
      }
    }
  }), [online?.onMessage, online?.seat, online?.players, shell.round, shell.gameOver]);

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

  // Inside a scaled phone or iPad frame, --g-airhockey-u grows touch controls and text back to full size on screen.
  useEffect(() => {
    const el = shell.root.current;
    if (!el || !shell.touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
        el.style.setProperty('--g-airhockey-u', u.toFixed(3));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-airhockey-u');
    };
  }, [shell.root, shell.touch]);

  // Re-place the score when the shell's control row or online badge appears, goes or changes size.
  const [hudTick, setHudTick] = useState(0);
  useEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    const bump = () => setHudTick((n) => n + 1);
    const sizes = new ResizeObserver(bump);
    const attach = () => {
      sizes.disconnect();
      root.querySelectorAll(':scope > .arcade-ctrl, :scope > .arcade-online-status').forEach((el) => sizes.observe(el));
    };
    const kids = new MutationObserver(() => {
      attach();
      bump();
    });
    kids.observe(root, { childList: true });
    attach();
    return () => {
      kids.disconnect();
      sizes.disconnect();
    };
  }, [shell.root]);

  // Keep the score clear of the shell's control row and online badge: beside them when there is room, below them when not.
  useLayoutEffect(() => {
    const root = shell.root.current;
    const pill = scoreRef.current;
    if (!root || !pill || size.w === 0) return;
    const ctrl = root.querySelector<HTMLElement>(':scope > .arcade-ctrl');
    const ctrlW = ctrl ? ctrl.offsetWidth : 0;
    const ctrlBottom = ctrl ? ctrl.offsetTop + ctrl.offsetHeight : 0;
    const badgeEl = root.querySelector<HTMLElement>(':scope > .arcade-online-status');
    const box = root.getBoundingClientRect();
    const k = root.offsetWidth ? box.width / root.offsetWidth : 1;
    const b = badgeEl?.getBoundingClientRect();
    const badge = b && b.width > 0 ? { left: (b.left - box.left) / k, right: (b.right - box.left) / k, bottom: (b.bottom - box.top) / k } : null;
    const pillW = pill.offsetWidth;
    const pillH = pill.offsetHeight;
    const free = size.w - ctrlW - 20;
    const centered = (size.w + pillW) / 2 <= free - 8 && (!badge || (size.w - pillW) / 2 >= badge.right + 8 || (size.w + pillW) / 2 <= badge.left - 8);
    const besideLeft = pillW + 10 <= free - 8 && (!badge || 10 + pillW <= badge.left - 8);
    const next = centered ? { left: false, top: 10 } : besideLeft ? { left: true, top: 10 } : { left: false, top: Math.max(ctrlBottom, badge?.bottom ?? 0) + 8 };
    const below = Math.max(next.top + pillH, ctrlBottom, badge?.bottom ?? 0) + 6;
    setHud((old) => (old.left === next.left && old.top === next.top && old.below === below ? old : { ...next, below }));
  }, [size.w, size.h, shell.status, shell.root, hudTick]);

  useEffect(() => {
    const w = world.current;
    if (!w) return;
    w.resize(size.w, size.h);
    placeCamera(w, shared, online?.seat === 1, hud.below);
    shell.invalidate();
  }, [size.w, size.h, THREE, shared, online?.seat, hud.below]);

  /** Pointer position on the table plane, in table coordinates. Uses offsets so it stays right inside the laptop's tilted screen. */
  const tablePoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = world.current;
    if (!w || !THREE) return null;
    const host = e.currentTarget;
    const ne = e.nativeEvent;
    let ox = ne.offsetX;
    let oy = ne.offsetY;
    const target = ne.target;
    if (target !== host && target instanceof HTMLElement) {
      ox += target.offsetLeft;
      oy += target.offsetTop;
    }
    const ndc = new THREE.Vector2((ox / Math.max(1, host.clientWidth)) * 2 - 1, -(oy / Math.max(1, host.clientHeight)) * 2 + 1);
    w.ray.setFromCamera(ndc, w.camera);
    const p = new THREE.Vector3();
    if (!w.ray.ray.intersectPlane(w.plane, p)) return null;
    return { x: p.x, z: p.z };
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (shell.status !== 'playing') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = tablePoint(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // in two player mode each half of the table belongs to one player; against the computer every touch is yours
    const side: 0 | 1 = online ? (online.seat === 0 ? 0 : 1) : cfg.current.mode === '2p' && p.z < 0 ? 1 : 0;
    if (e.pointerType === 'mouse') pointers.current.delete(-1);
    if ([...pointers.current.values()].some((q) => q.side === side)) return;
    pointers.current.set(e.pointerId, { side, x: p.x, z: p.z });
    used();
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
    // a mouse with no button down still steers your mallet against the computer or online
    if (e.pointerType === 'mouse' && (cfg.current.mode === 'cpu' || online) && shell.status === 'playing') {
      const p = tablePoint(e);
      if (p) pointers.current.set(-1, { side: online?.seat === 1 ? 1 : 0, x: p.x, z: p.z });
    }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const axis = (plus: string, minus: string) => (keys.down(plus) ? 1 : 0) - (keys.down(minus) ? 1 : 0);
  const wasd = () => [axis('KeyD', 'KeyA'), axis('KeyS', 'KeyW')];
  const arrows = () => [axis('ArrowRight', 'ArrowLeft'), axis('ArrowDown', 'ArrowUp')];

  /** Keyboard for one mallet; the keys win over a mouse that is only hovering. */
  const keyDrive = (s: State, side: 0 | 1, kx: number, kz: number, dt: number) => {
    if (kx || kz) {
      used();
      pointers.current.delete(-1);
      nudgeMallet(s, side, kx, kz, dt);
    } else {
      s.mallets[side].vx = 0;
      s.mallets[side].vz = 0;
    }
  };

  const driveMallets = (s: State, dt: number) => {
    const driven = new Set<number>();
    const kb = [...wasd(), ...arrows()];
    const solo = s.mode === 'cpu' || !!online;
    // sharing a wide screen the table lies sideways, blue on the left, so turn the keys to match the screen
    if (s.mode === '2p' && !online && (world.current?.camera.aspect ?? 0) >= 1)
      for (const i of [0, 2]) [kb[i], kb[i + 1]] = [kb[i + 1], -kb[i]];
    // a key press takes over from a hovering mouse
    if (solo && kb.some(Boolean)) pointers.current.delete(-1);
    for (const ptr of pointers.current.values()) {
      if (online && ptr.side !== online.seat) continue;
      moveMalletTo(s, ptr.side, { x: ptr.x, z: ptr.z }, dt, 9);
      driven.add(ptr.side);
    }
    // keyboard: WASD for blue and arrows for pink when sharing a screen, either set when playing alone
    if (!driven.has(0)) keyDrive(s, 0, kb[0] + (solo ? kb[2] : 0), kb[1] + (solo ? kb[3] : 0), dt);
    if (online?.seat === 0) {
      if (remoteTarget.current) moveMalletTo(s, 1, remoteTarget.current, dt, 9);
      else {
        s.mallets[1].vx = 0;
        s.mallets[1].vz = 0;
      }
    } else if (s.mode === '2p' && !online) {
      if (!driven.has(1)) keyDrive(s, 1, kb[2], kb[3], dt);
    } else stepAI(s, dt);
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      const s = state.current;
      if (!w) return;
      sendAt.current += dt;
      snapshotAt.current += dt;
      // a guest draws the host's table, and so does a spectator (seat -1), who moves neither mallet
      const viewer = !!online && online.seat !== 0;
      if (viewer && remoteState.current) {
        const target = remoteState.current;
        const t = Math.min(1, dt * 18);
        s.puck.x += (target.puck.x - s.puck.x) * t;
        s.puck.z += (target.puck.z - s.puck.z) * t;
        s.puck.vx = target.puck.vx;
        s.puck.vz = target.puck.vz;
        s.mallets.forEach((mallet, index) => {
          if (index === 1 && !online!.watching) return;
          mallet.x += (target.mallets[index].x - mallet.x) * t;
          mallet.z += (target.mallets[index].z - mallet.z) * t;
          mallet.vx = target.mallets[index].vx;
          mallet.vz = target.mallets[index].vz;
        });
        s.score = [...target.score];
        s.freeze = target.freeze;
        s.winner = target.winner;
        setScore((old) => (old[0] === s.score[0] && old[1] === s.score[1] ? old : [s.score[0], s.score[1]]));
      }
      if (online?.seat === 1) {
        // the guest looks from the top end, so its keys are turned around
        const pointer = [...pointers.current.values()].find((item) => item.side === 1);
        const kb = [...wasd(), ...arrows()];
        if (kb.some(Boolean)) pointers.current.delete(-1);
        if (pointer && !kb.some(Boolean)) moveMalletTo(s, 1, pointer, dt, 9);
        else keyDrive(s, 1, -(kb[0] + kb[2]), -(kb[1] + kb[3]), dt);
        if (sendAt.current >= 0.05) {
          const mallet = s.mallets[1];
          online.send({ game: 'airhockey', type: 'mallet', x: mallet.x, z: mallet.z }, { fast: true });
          sendAt.current %= 0.05;
        }
      }
      // simulate real elapsed time (capped) in fixed sub-steps, so slow devices play at full speed
      // and fast mallets never tunnel through the puck
      const now = performance.now();
      const gap = lastTick.current ? (now - lastTick.current) / 1000 : dt;
      lastTick.current = now;
      const simDt = gap > 0.5 ? dt : Math.min(0.25, Math.max(dt, gap));
      if (s.winner === null && !viewer) {
        const n = Math.max(1, Math.ceil(simDt / SUBSTEP));
        const h = simDt / n;
        const ev: Event = {};
        const aiTop = s.mode === 'cpu';
        for (let i = 0; i < n && s.winner === null; i++) {
          driveMallets(s, h);
          const e = step(s, h);
          if (e.hit === 1 && aiTop && (e.power ?? 0) > SOFT) aiHit(s);
          if (e.wall) {
            ev.wall = true;
            ev.wallPower = Math.max(ev.wallPower ?? 0, e.wallPower ?? 0);
          }
          if (e.hit !== undefined && (e.power ?? 0) >= (ev.power ?? 0)) {
            ev.hit = e.hit;
            ev.power = e.power;
          }
          if (e.at) ev.at = e.at;
          if (e.goal !== undefined) ev.goal = e.goal;
          if (e.win !== undefined) ev.win = e.win;
        }
        fx(ev);
        announce(ev, s);
        const loud = ev.goal !== undefined || (ev.hit !== undefined && (ev.power ?? 0) > SOFT) || (ev.wall && (ev.wallPower ?? 0) > 0.5);
        if (online?.seat === 0 && loud) online.send({ game: 'airhockey', type: 'events', event: ev, state: s });
      }
      if (online?.seat === 0 && snapshotAt.current >= 0.05) {
        online.send({ game: 'airhockey', type: 'snapshot', state: s }, { fast: true });
        snapshotAt.current %= 0.05;
      }
      // visuals
      w.puck.position.x = s.puck.x;
      w.puck.position.z = s.puck.z;
      w.shadows[0].position.set(s.puck.x + 0.012, 0.0008, s.puck.z + 0.012);
      s.mallets.forEach((m, i) => {
        const sq = (w.squash[i] = Math.max(0, w.squash[i] - dt * 5));
        w.mallets[i].position.x = m.x;
        w.mallets[i].position.z = m.z;
        w.mallets[i].scale.set(1 + 0.1 * sq, 1 - 0.28 * sq, 1 + 0.1 * sq);
        w.glow[i].position.x = m.x;
        w.glow[i].position.z = m.z;
        w.glow[i].scale.setScalar(1 + 0.3 * sq);
        (w.glow[i].material as T.MeshBasicMaterial).opacity = 0.35 + 0.45 * sq;
        w.shadows[i + 1].position.set(m.x + 0.02, 0.0008, m.z + 0.02);
      });
      // a short fading trail behind a fast puck
      w.trailPts.unshift({ x: s.puck.x, z: s.puck.z });
      if (w.trailPts.length > TRAIL + 1) w.trailPts.length = TRAIL + 1;
      const speed = Math.hypot(s.puck.vx, s.puck.vz);
      const strength = Math.min(1, Math.max(0, (speed - 1.8) / 4.5));
      w.trail.forEach((t, i) => {
        const p = w.trailPts[i + 1];
        t.visible = !!p && strength > 0 && s.freeze <= 0;
        if (!p) return;
        t.position.x = p.x;
        t.position.z = p.z;
        t.scale.setScalar(1 - (i / TRAIL) * 0.45);
        (t.material as T.MeshBasicMaterial).opacity = strength * 0.32 * (1 - i / TRAIL);
      });
      for (const b of w.bursts) {
        if (b.life <= 0) continue;
        b.life = Math.max(0, b.life - dt);
        const k = 1 - b.life / b.max;
        b.mesh.scale.setScalar(b.size * (0.35 + 0.65 * (1 - (1 - k) * (1 - k))));
        (b.mesh.material as T.MeshBasicMaterial).opacity = 0.85 * (1 - k);
        if (b.life <= 0) b.mesh.visible = false;
      }
      w.mouths.forEach((mouth, i) => {
        w.mouthGlow[i] = Math.max(0, w.mouthGlow[i] - dt * 1.2);
        (mouth.material as T.MeshBasicMaterial).opacity = 0.55 + 0.45 * w.mouthGlow[i];
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
  const hint = shell.touch
    ? shared
      ? 'Each player drags on their own side'
      : 'Drag to move your mallet'
    : shared
      ? 'Blue: WASD. Pink: arrow keys.'
      : 'Move the mouse or use WASD';
  return (
    <>
      <div ref={ref} className="g-airhockey-host" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp} />
      <div ref={scoreRef} className={`g-airhockey-score${hud.left ? ' is-left' : ''}`} style={{ top: hud.top }}>
        <i style={{ background: '#34c3ff' }} />
        <strong>{score[0]}</strong>
        <span>First to {TO_WIN}</span>
        <strong>{score[1]}</strong>
        <i style={{ background: '#ff6b8a' }} />
      </div>
      {pop && (
        <div key={pop.id} className="g-airhockey-pop">
          {pop.text}
        </div>
      )}
      {playing && !touched && score[0] + score[1] === 0 && size.h >= 200 && <div className="g-airhockey-hint">{hint}</div>}
    </>
  );
}
