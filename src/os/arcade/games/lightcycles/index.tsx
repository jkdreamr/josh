import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { alive, createArena, roundOver, steer, step, swipeDir, think, DX, DY, type Arena, type Dir, type Level } from './cycles.ts';
import { meta } from './meta';
import './lightcycles.css';

type Mode = '2p' | 1 | 2 | 3;
const MODE = defineSetting('lightcycles:mode', PLAY_MODES, 'cpu');
const RIVALS = defineSetting('lightcycles:rivals', ['1', '2', '3'] as const, '1');
const LEVEL = defineSetting('lightcycles:level', LEVEL_NAMES, 'normal');
const rivalOptions = [
  ['1', '1 Rival'],
  ['2', '2 Rivals'],
  ['3', '3 Rivals'],
] as const;
const modeOf = (mode: 'cpu' | '2p', rivals: '1' | '2' | '3'): Mode => (mode === '2p' ? '2p' : (Number(rivals) as 1 | 2 | 3));
const TARGET = 3;
const COLORS = ['#32d4ff', '#ff9f0a', '#bf5af2', '#30d158'];
const NAMES = ['Player 1', 'Player 2', 'Rider 3', 'Rider 4'];

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} formatScore={(n) => `${n} cells`} setup={<Setup />}>
      <Cycles />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [rivals, setRivals] = useSetting(RIVALS);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />}
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string };
type Phase = 'ready' | 'run' | 'crash' | 'done';
type Match = {
  arena: Arena;
  cols: number;
  rows: number;
  wins: number[];
  round: number;
  phase: Phase;
  timer: number;
  acc: number;
  speed: number;
  queue: Dir[][];
  particles: Particle[];
  flash: number;
  shake: number;
  banner: string;
  sub: string;
  longest: number;
  lastWinner: number | null;
};

const grid = (w: number, h: number) => {
  const cols = w >= h ? 44 : 28;
  const rows = Math.max(16, Math.min(72, Math.round((cols * h) / w)));
  return { cols, rows };
};

function Cycles() {
  const shell = useShell();
  const { ref, size, ctx } = useCanvas();
  const [banner, setBanner] = useState<{ text: string; sub: string } | null>(null);
  const [playMode] = useSetting(MODE);
  const [rivals] = useSetting(RIVALS);
  const [levelName] = useSetting(LEVEL);
  const cfg = useRef<{ mode: Mode; level: Level }>({ mode: modeOf(playMode, rivals), level: levelIndex(levelName) });
  const m = useRef<Match | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number; rider: number }>());
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const riderCount = () => (cfg.current.mode === '2p' ? 2 : cfg.current.mode + 1);
  const humans = () => (cfg.current.mode === '2p' ? 2 : 1);

  const startRound = (match: Match) => {
    const { w, h } = sizeRef.current;
    const g = grid(Math.max(1, w - 16), Math.max(1, h - 64));
    match.cols = g.cols;
    match.rows = g.rows;
    match.arena = createArena(g.cols, g.rows, riderCount(), humans());
    match.queue = match.arena.riders.map(() => []);
    match.phase = 'ready';
    match.timer = 1.1;
    match.acc = 0;
    match.particles = [];
    match.flash = 0;
    match.banner = `Round ${match.round}`;
    match.sub = match.round === 1 ? (shell.touch ? 'Swipe to turn' : cfg.current.mode === '2p' ? 'WASD vs arrow keys' : 'WASD or arrow keys to turn') : '';
    setBanner({ text: match.banner, sub: match.sub });
  };

  const reset = () => {
    const mode = modeOf(playMode, rivals);
    const level = levelIndex(levelName);
    cfg.current = { mode, level };
    const match: Match = {
      arena: createArena(2, 2, 0, 0),
      cols: 2,
      rows: 2,
      wins: new Array(mode === '2p' ? 2 : mode + 1).fill(0),
      round: 1,
      phase: 'ready',
      timer: 0,
      acc: 0,
      speed: (mode === '2p' ? 11 : [9, 11, 13][level]) as number,
      queue: [],
      particles: [],
      flash: 0,
      shake: 0,
      banner: '',
      sub: '',
      longest: 0,
      lastWinner: null,
    };
    m.current = match;
    startRound(match);
  };
  // A fresh match on mount, and again when setup changes on the Start card.
  useEffect(() => {
    if (shell.status === 'ready' || !m.current) reset();
  }, [playMode, rivals, levelName, shell.status]);

  const push = (rider: number, d: Dir) => {
    const match = m.current;
    if (!match || match.phase !== 'run') return;
    const q = match.queue[rider];
    if (!q) return;
    if (q.length < 2 && q[q.length - 1] !== d) q.push(d);
  };

  useKeys((code) => {
    const twoP = cfg.current.mode === '2p';
    const wasd: Record<string, Dir> = { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };
    const arrows: Record<string, Dir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
    if (code in wasd) push(0, wasd[code]);
    else if (code in arrows) push(twoP ? 1 : 0, arrows[code]);
  });

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const rider = cfg.current.mode === '2p' && e.clientX - r.left > r.width / 2 ? 1 : 0;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, rider });
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const d = swipeDir(e.clientX - t.x, e.clientY - t.y, 22);
    if (d === null) return;
    push(t.rider, d);
    t.x = e.clientX;
    t.y = e.clientY;
  };
  const onPointerEnd = (e: RPointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
  };
  useEffect(() => () => touches.current.clear(), []);

  const burst = (match: Match, cx: number, cy: number, color: string) => {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.6 + Math.random() * 2.2;
      match.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.5 + Math.random() * 0.5, color });
    }
    match.flash = 0.5;
    match.shake = 0.3;
  };

  const update = (dt: number) => {
    const match = m.current;
    if (!match) return;
    match.flash = Math.max(0, match.flash - dt * 2.4);
    match.shake = Math.max(0, match.shake - dt * 1.6);
    for (const p of match.particles) {
      p.life += dt;
      p.x += p.vx * dt * 14;
      p.y += p.vy * dt * 14;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    match.particles = match.particles.filter((p) => p.life < p.max);

    if (match.phase === 'ready') {
      match.timer -= dt;
      if (match.timer <= 0) {
        match.phase = 'run';
        match.banner = '';
        setBanner(null);
        sfx.play('select', 1.2);
      }
      return;
    }
    if (match.phase === 'crash') {
      match.timer -= dt;
      if (match.timer <= 0) {
        if (match.wins.some((w) => w >= TARGET)) {
          match.phase = 'done';
          const winner = match.wins.findIndex((w) => w >= TARGET);
          const cpuMode = cfg.current.mode !== '2p';
          const title = cpuMode ? (winner === 0 ? 'You Win' : 'Crashed Out') : `${NAMES[winner]} Wins`;
          const detail = `${match.wins.join(' to ')} in ${match.round} rounds. Longest ride: ${match.longest} cells.`;
          shell.gameOver(cpuMode ? match.longest : undefined, { title, detail });
          return;
        }
        match.round++;
        startRound(match);
      }
      return;
    }
    if (match.phase !== 'run') return;

    match.acc += dt;
    const period = 1 / (match.speed + (match.round - 1) * 0.6);
    while (match.acc >= period && match.phase === 'run') {
      match.acc -= period;
      const a = match.arena;
      for (const r of a.riders) {
        if (!r.alive) continue;
        if (r.cpu) {
          if (Math.abs(r.x - a.w / 2) > a.w / 2 + 1) continue;
          steer(r, think(a, r, cfg.current.level));
        } else {
          const q = match.queue[r.id];
          while (q.length) {
            const d = q.shift()!;
            if (d !== r.dir && d !== ((r.dir + 2) % 4)) {
              steer(r, d);
              break;
            }
          }
        }
      }
      const crashes = step(a);
      for (const c of crashes) {
        burst(match, c.x + 0.5, c.y + 0.5, COLORS[c.id]);
        sfx.play('boom');
      }
      if (cfg.current.mode !== '2p') {
        const me = a.riders[0];
        shell.setScore(me.trail.length);
        match.longest = Math.max(match.longest, me.trail.length);
      } else {
        match.longest = Math.max(match.longest, ...a.riders.map((r) => r.trail.length));
      }
      if (roundOver(a)) {
        const left = alive(a);
        const winner = left.length === 1 ? left[0].id : null;
        match.lastWinner = winner;
        if (winner !== null) match.wins[winner]++;
        match.phase = 'crash';
        match.timer = 1.5;
        const twoP = cfg.current.mode === '2p';
        match.banner = winner === null ? 'Draw' : twoP || winner > 0 ? `${NAMES[winner]} takes the round` : 'You take the round';
        match.sub = match.wins.some((w) => w >= TARGET) ? '' : `${match.wins.join(' to ')}`;
        setBanner({ text: match.banner, sub: match.sub });
        if (winner === 0 || (twoP && winner !== null)) sfx.play('coin');
      }
    }
  };

  const render = () => {
    const c = ctx();
    const match = m.current;
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    const bg = c.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, Math.max(w, h));
    bg.addColorStop(0, '#0f1322');
    bg.addColorStop(1, '#05060b');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (!match) return;

    const a = match.arena;
    const cell = Math.min((w - 16) / a.w, (h - 64) / a.h);
    const ox = (w - cell * a.w) / 2 + (match.shake ? (Math.random() - 0.5) * match.shake * 10 : 0);
    const oy = 44 + (h - 64 - cell * a.h) / 2 + (match.shake ? (Math.random() - 0.5) * match.shake * 10 : 0);
    const px = (x: number) => ox + x * cell;
    const py = (y: number) => oy + y * cell;

    // Arena plate and grid
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.025)';
    c.fillRect(ox, oy, cell * a.w, cell * a.h);
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= a.w; x += 4) {
      c.moveTo(px(x) + 0.5, oy);
      c.lineTo(px(x) + 0.5, oy + cell * a.h);
    }
    for (let y = 0; y <= a.h; y += 4) {
      c.moveTo(ox, py(y) + 0.5);
      c.lineTo(ox + cell * a.w, py(y) + 0.5);
    }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1.5;
    c.strokeRect(ox, oy, cell * a.w, cell * a.h);
    c.restore();

    // Trails
    const period = 1 / (match.speed + (match.round - 1) * 0.6);
    const frac = match.phase === 'run' ? Math.min(1, match.acc / period) : 0;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const r of a.riders) {
      const color = COLORS[r.id];
      const pts = r.trail;
      c.globalAlpha = r.alive ? 1 : 0.38;
      const path = () => {
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = px((pts[i] % a.w) + 0.5);
          const y = py(Math.floor(pts[i] / a.w) + 0.5);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        if (r.alive && frac > 0) c.lineTo(px(r.x + 0.5 + DX[r.dir] * frac), py(r.y + 0.5 + DY[r.dir] * frac));
      };
      path();
      c.strokeStyle = color;
      c.globalAlpha *= 0.22;
      c.lineWidth = cell * 1.1;
      c.stroke();
      c.globalAlpha = r.alive ? 1 : 0.38;
      c.lineWidth = Math.max(1.5, cell * 0.42);
      c.strokeStyle = color;
      c.stroke();
      if (r.alive) {
        const hx = px(r.x + 0.5 + DX[r.dir] * frac);
        const hy = py(r.y + 0.5 + DY[r.dir] * frac);
        c.shadowColor = color;
        c.shadowBlur = cell * 1.2;
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(hx, hy, Math.max(1.6, cell * 0.36), 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
      }
    }
    c.globalAlpha = 1;

    for (const p of match.particles) {
      const t = 1 - p.life / p.max;
      c.globalAlpha = t;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(px(p.x), py(p.y), Math.max(1, cell * 0.28 * t), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Round pips
    const n = a.riders.length;
    const pipR = 4;
    const groupW = TARGET * (pipR * 2 + 5) - 5;
    const gap = 18;
    const total = n * groupW + (n - 1) * gap;
    let x0 = w / 2 - total / 2;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < TARGET; k++) {
        const cx = x0 + k * (pipR * 2 + 5) + pipR;
        c.beginPath();
        c.arc(cx, 24, pipR, 0, Math.PI * 2);
        if (k < match.wins[i]) {
          c.fillStyle = COLORS[i];
          c.fill();
        } else {
          c.strokeStyle = COLORS[i];
          c.globalAlpha = 0.45;
          c.lineWidth = 1.5;
          c.stroke();
          c.globalAlpha = 1;
        }
      }
      x0 += groupW + gap;
    }

    if (match.flash > 0) {
      c.fillStyle = `rgba(255,255,255,${match.flash * 0.18})`;
      c.fillRect(0, 0, w, h);
    }
  };

  useGameLoop(update, render);

  return (
    <div className="g-lightcycles-stage">
      <canvas ref={ref} className="g-lightcycles-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} aria-label="Light cycle arena" />
      {cfg.current.mode === '2p' && shell.touch && <div className="g-lightcycles-split" aria-hidden="true" />}
      {banner && (
        <div className="g-lightcycles-banner" key={banner.text + m.current?.round} aria-live="polite">
          <strong>{banner.text}</strong>
          {banner.sub && <span>{banner.sub}</span>}
        </div>
      )}
    </div>
  );
}
