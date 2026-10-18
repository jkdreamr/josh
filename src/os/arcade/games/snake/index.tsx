import { useEffect, useRef } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import {
  createSnake,
  fitBoard,
  gridFor,
  heading,
  opposite,
  queueDirection,
  speedForLength,
  stepSnake,
  wouldDie,
  type Board,
  type Direction,
  type Rect,
  type SnakeState,
} from './logic';
import { meta } from './meta';
import './snake.css';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Popup = { x: number; y: number; life: number; text: string };
type Round = {
  state: SnakeState | null;
  started: boolean;
  accumulator: number;
  grace: boolean;
  graceUsed: boolean;
  death: number;
  shake: number;
  foodAge: number;
  elapsed: number;
  nextBlink: number;
  nextTongue: number;
  gulps: number[];
  particles: Particle[];
  popups: Popup[];
  ended: boolean;
  pointer: { id: number; x: number; y: number; at: number; swiped: boolean } | null;
  board: Board | null;
  head: { x: number; y: number };
  obstacles: Rect[];
  u: number;
  measuredAt: number;
  measuredFor: string;
  scored: boolean;
};

const directions: Record<string, Direction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

const HEAD = [134, 245, 164];
const TAIL = [26, 138, 72];
const DEAD = [92, 104, 98];
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode}>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const { best } = useHighScore(meta.id);
  const round = useRef<Round>({
    state: null,
    started: false,
    accumulator: 0,
    grace: false,
    graceUsed: false,
    death: 0,
    shake: 0,
    foodAge: 0,
    elapsed: 0,
    nextBlink: 2.5,
    nextTongue: 1.6,
    gulps: [],
    particles: [],
    popups: [],
    ended: false,
    pointer: null,
    board: null,
    head: { x: 0, y: 0 },
    obstacles: [],
    u: 1,
    measuredAt: -1,
    measuredFor: '',
    scored: false,
  }).current;
  const { ref, size, ctx } = useCanvas();

  // A phone or iPad frame scales the game down; the toolbar and text grow by the same factor so they stay finger sized.
  useEffect(() => {
    const el = shell.root.current;
    if (!el || !shell.touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil(100 / k) / 100) : 1;
        el.style.setProperty('--g-snake-u', String(u));
        round.u = u;
        round.measuredAt = -1;
        shell.invalidate();
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.style.removeProperty('--g-snake-u');
      round.u = 1;
    };
  }, [shell.touch, shell.root, shell.invalidate, round]);

  const steer = (next: Direction) => {
    const state = round.state;
    if (!state || !state.alive || state.won || shell.status !== 'playing') return;
    if (!round.started) {
      if (opposite(next, state.direction)) {
        state.segments.reverse();
        state.previous = state.segments.map((p) => ({ ...p }));
        state.direction = next;
      } else if (next !== state.direction) state.queue.push(next);
      round.started = true;
      round.accumulator = 1 / speedForLength(state.segments.length);
      sfx.play('blip', 1.4);
      return;
    }
    queueDirection(state, next);
  };

  useKeys((code, e) => {
    const next = directions[code];
    if (!next) return;
    e?.preventDefault();
    steer(next);
  });

  useGameLoop(
    (dt) => {
      if (!round.state) ensureState(round, size.w, size.h);
      if (shell.status === 'playing' && !round.scored) {
        round.scored = true;
        shell.setScore(0);
      }
      const state = round.state;
      if (!state) return;
      round.elapsed += dt;
      round.foodAge += dt;
      round.shake = Math.max(0, round.shake - dt * 3.2);
      round.particles = round.particles.filter((p) => {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 4;
        p.vy *= 1 - dt * 4;
        return p.life > 0;
      });
      round.popups = round.popups.filter((p) => (p.life -= dt) > 0);
      const speed = speedForLength(state.segments.length);
      round.gulps = round.gulps.map((g) => g + dt * speed * 1.4).filter((g) => g < state.segments.length);
      if (!state.alive) {
        round.death += dt;
        if (round.death > 0.95 && !round.ended) {
          round.ended = true;
          const length = state.segments.length;
          shell.gameOver(state.score, {
            title: state.cause === 'wall' ? 'You Hit the Wall' : 'You Bit Your Tail',
            detail: `Your snake reached a length of ${length}.`,
          });
        }
        return;
      }
      if (!round.started || state.won) return;
      round.accumulator += dt;
      for (;;) {
        const interval = 1 / speedForLength(state.segments.length);
        const due = interval * (round.grace ? 1.55 : 1);
        if (round.accumulator < due) break;
        if (!round.grace && !round.graceUsed && wouldDie(state)) {
          round.grace = true;
          round.graceUsed = true;
          continue;
        }
        round.accumulator -= due;
        round.grace = false;
        const oldFood = state.food;
        const result = stepSnake(state);
        if (result === 'moved' || result === 'ate') round.graceUsed = false;
        if (result === 'ate' || result === 'won') {
          round.foodAge = 0;
          round.gulps.push(0);
          shell.setScore(state.score);
          sfx.play('coin', 1 + Math.min(0.5, state.segments.length / 90));
          const b = round.board;
          if (b && oldFood) {
            const fx = b.x + (oldFood.x + 0.5) * b.cell;
            const fy = b.y + (oldFood.y + 0.5) * b.cell;
            burst(round.particles, fx, fy, b.cell, ['#ff6b5e', '#ffb199', '#8af5a8'], 12);
            round.popups.push({ x: fx, y: fy, life: 0.75, text: '+10' });
          }
        }
        if (result === 'dead') {
          round.death = 0.001;
          round.shake = 1;
          sfx.play('hit');
          sfx.play('lose');
          const b = round.board;
          if (b) burst(round.particles, round.head.x, round.head.y, b.cell, ['#e8efe9', '#86f5a4', '#5c6862'], 14);
          break;
        }
        if (result === 'won') {
          sfx.play('win');
          round.ended = true;
          const b = round.board;
          if (b) burst(round.particles, b.x + b.width / 2, b.y + b.height / 2, b.cell * 3, ['#86f5a4', '#ffd60a', '#ff6b5e', '#64d2ff'], 40);
          shell.gameOver(state.score, { title: 'You Win', detail: 'You filled the whole board.' });
          break;
        }
      }
    },
    () => draw(ctx(), size.w, size.h, round, shell, best),
  );

  const local = (event: React.PointerEvent<HTMLCanvasElement>) => ({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });

  return (
    <canvas
      ref={ref}
      className="g-snake-canvas"
      onPointerDown={(event) => {
        event.preventDefault();
        shell.root.current?.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = local(event);
        round.pointer = { id: event.pointerId, x: p.x, y: p.y, at: performance.now(), swiped: false };
      }}
      onPointerMove={(event) => {
        const start = round.pointer;
        if (!start || start.id !== event.pointerId) return;
        const p = local(event);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
        steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
        start.x = p.x;
        start.y = p.y;
        start.swiped = true;
      }}
      onPointerUp={(event) => {
        const start = round.pointer;
        round.pointer = null;
        const state = round.state;
        const board = round.board;
        if (!start || start.swiped || !state || !board || performance.now() - start.at > 450) return;
        const p = local(event);
        const dx = p.x - round.head.x;
        const dy = p.y - round.head.y;
        const dead = board.cell * 0.35;
        if (!round.started) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < dead) steer(state.direction);
          else steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
          return;
        }
        const dir = heading(state);
        if (dir === 'left' || dir === 'right') {
          if (Math.abs(dy) > dead) steer(dy > 0 ? 'down' : 'up');
        } else if (Math.abs(dx) > dead) steer(dx > 0 ? 'right' : 'left');
      }}
      onPointerCancel={() => {
        round.pointer = null;
      }}
    />
  );
}

function ensureState(round: Round, w: number, h: number) {
  if (round.state || w <= 0 || h <= 0) return;
  const grid = gridFor(w, h);
  round.state = createSnake(grid.cols, grid.rows);
}

/** The shell's score pill, toolbar and online badge, in the stage's layout pixels. */
function measureOverlays(root: HTMLElement | null, w: number): Rect[] {
  if (!root) return [];
  const box = root.getBoundingClientRect();
  const k = root.offsetWidth ? box.width / root.offsetWidth : 1;
  const rect = (el: Element | null): Rect | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k };
  };
  const ctrl = rect(root.querySelector(':scope > .arcade-ctrl'));
  const status = rect(root.querySelector(':scope > .arcade-online-status'));
  const pill = rect(root.querySelector(':scope > .arcade-score'));
  const top = ctrl?.y ?? 10;
  const h = Math.max(pill?.h ?? 0, ctrl?.h ?? 28);
  // Leave room for a four digit score so the board doesn't shift as it grows.
  const score = { x: pill?.x ?? 10, y: pill?.y ?? top, w: Math.max(pill?.w ?? 0, 62), h: pill?.h ?? h };
  return [score, ctrl, status].filter((r): r is Rect => !!r && r.x < w);
}

function burst(particles: Particle[], x: number, y: number, cell: number, colors: string[], count: number) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const speed = cell * (2.4 + Math.random() * 3.2);
    const life = 0.35 + Math.random() * 0.3;
    particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, max: life, color: colors[i % colors.length], size: Math.max(1.6, cell * (0.06 + Math.random() * 0.06)) });
  }
}

function mix(a: number[], b: number[], t: number) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function easeOutBack(t: number) {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function draw(c: CanvasRenderingContext2D | null, w: number, h: number, round: Round, shell: ReturnType<typeof useShell>, best: number | null) {
  if (!c || w <= 0 || h <= 0) return;
  c.fillStyle = '#09100c';
  c.fillRect(0, 0, w, h);
  ensureState(round, w, h);
  const state = round.state;
  if (!state) return;

  const now = performance.now();
  const key = `${w}x${h}:${shell.status}`;
  if (key !== round.measuredFor || now - round.measuredAt > 500) {
    round.obstacles = measureOverlays(shell.root.current, w);
    round.measuredAt = now;
    round.measuredFor = key;
  }
  const b = fitBoard(w, h, state.cols, state.rows, round.obstacles);
  round.board = b;
  const cell = b.cell;
  const u = round.u;

  const glow = c.createRadialGradient(b.x + b.width / 2, b.y + b.height / 2, 0, b.x + b.width / 2, b.y + b.height / 2, Math.max(b.width, b.height) * 0.9);
  glow.addColorStop(0, 'rgba(48,209,88,0.10)');
  glow.addColorStop(1, 'rgba(48,209,88,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);

  c.save();
  if (round.shake > 0) {
    const s = round.shake * round.shake * Math.max(2, cell * 0.28);
    c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  const radius = Math.min(14, Math.max(3, cell * 0.45));
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = Math.min(28, cell * 1.2);
  c.shadowOffsetY = Math.min(8, cell * 0.25);
  c.fillStyle = '#111c15';
  c.beginPath();
  c.roundRect(b.x, b.y, b.width, b.height, radius);
  c.fill();
  c.restore();
  c.save();
  c.beginPath();
  c.roundRect(b.x, b.y, b.width, b.height, radius);
  c.clip();
  c.fillStyle = '#14231a';
  for (let y = 0; y < state.rows; y++) {
    for (let x = (y % 2); x < state.cols; x += 2) c.fillRect(b.x + x * cell, b.y + y * cell, cell, cell);
  }
  c.restore();
  c.strokeStyle = 'rgba(134,245,164,0.10)';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(b.x + 0.5, b.y + 0.5, b.width - 1, b.height - 1, radius);
  c.stroke();

  const px = (p: { x: number; y: number }) => ({ x: b.x + (p.x + 0.5) * cell, y: b.y + (p.y + 0.5) * cell });

  if (state.food) {
    const f = px(state.food);
    const pop = easeOutBack(Math.min(1, round.foodAge / 0.32));
    const bob = Math.sin(round.elapsed * 3.2) * cell * 0.035;
    if (round.foodAge < 0.6) {
      c.strokeStyle = `rgba(255,120,104,${0.45 * (1 - round.foodAge / 0.6)})`;
      c.lineWidth = Math.max(1, cell * 0.06);
      c.beginPath();
      c.arc(f.x, f.y, cell * (0.3 + round.foodAge * 1.3), 0, Math.PI * 2);
      c.stroke();
    }
    const halo = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, cell * 1.1);
    halo.addColorStop(0, `rgba(255,90,72,${0.26 + Math.sin(round.elapsed * 4) * 0.06})`);
    halo.addColorStop(1, 'rgba(255,90,72,0)');
    c.fillStyle = halo;
    c.fillRect(f.x - cell * 1.1, f.y - cell * 1.1, cell * 2.2, cell * 2.2);
    c.save();
    c.translate(f.x, f.y + bob);
    c.scale(pop, pop);
    const r = cell * 0.31;
    const body = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
    body.addColorStop(0, '#ffb0a3');
    body.addColorStop(0.45, '#ff5b4d');
    body.addColorStop(1, '#c9302c');
    c.fillStyle = body;
    c.beginPath();
    c.arc(0, r * 0.05, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#5a3a1e';
    c.lineWidth = Math.max(1, cell * 0.05);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, -r * 0.75);
    c.lineTo(r * 0.12, -r * 1.15);
    c.stroke();
    c.fillStyle = '#5fd47f';
    c.beginPath();
    c.ellipse(r * 0.42, -r * 1.02, r * 0.38, r * 0.17, -0.5, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // The body runs through cell centres; only the head and the tip of the tail slide, so corners stay square.
  const t = round.started ? Math.min(1, round.accumulator * speedForLength(state.segments.length)) : 1;
  const n = state.segments.length;
  const grew = state.previous.length < n;
  const lerp = (a: { x: number; y: number }, z: { x: number; y: number }) => ({ x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t });
  const pts = [px(lerp(state.previous[0] ?? state.segments[0], state.segments[0]))];
  for (let i = 1; i < n; i++) pts.push(px(state.segments[i]));
  pts.push(px(grew || !state.previous[n - 1] ? state.segments[n - 1] : lerp(state.previous[n - 1], state.segments[n - 1])));
  round.head = pts[0];

  const dying = !state.alive ? Math.min(1, round.death / 0.6) : 0;
  const widthAt = (i: number) => cell * (0.76 - 0.2 * (i / Math.max(1, pts.length - 1)));
  const colorAt = (i: number) => {
    const f = i / Math.max(1, pts.length - 1);
    const base = HEAD.map((v, k) => v + (TAIL[k] - v) * f);
    const grey = dying > 0 && f <= dying * 1.4 ? Math.min(1, dying * 1.4 - f + 0.3) : 0;
    return mix(base, DEAD, grey);
  };
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(0,0,0,0.32)';
  c.lineWidth = widthAt(0);
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y + cell * 0.1) : c.moveTo(p.x, p.y + cell * 0.1)));
  c.stroke();
  for (let i = pts.length - 2; i >= 0; i--) {
    c.strokeStyle = colorAt(i);
    c.lineWidth = widthAt(i);
    c.beginPath();
    c.moveTo(pts[i + 1].x, pts[i + 1].y);
    c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
  }
  for (const g of round.gulps) {
    const i = Math.min(pts.length - 2, Math.floor(g));
    const f = g - i;
    const a = pts[i];
    const z = pts[i + 1] ?? a;
    const swell = Math.sin(Math.min(1, g / Math.max(1, n - 1)) * Math.PI) * 0.6 + 0.4;
    c.fillStyle = colorAt(i);
    c.beginPath();
    c.arc(a.x + (z.x - a.x) * f, a.y + (z.y - a.y) * f, widthAt(i) * (0.5 + 0.16 * swell), 0, Math.PI * 2);
    c.fill();
  }

  const head = pts[0];
  const dir = state.direction;
  const fx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  const fy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
  const side = { x: -fy, y: fx };
  if (state.alive && round.started && round.elapsed > round.nextTongue) {
    const k = (round.elapsed - round.nextTongue) / 0.28;
    if (k > 1) round.nextTongue = round.elapsed + 1.8 + Math.random() * 2.4;
    else {
      const len = cell * (0.42 + Math.sin(k * Math.PI) * 0.34);
      const tip = { x: head.x + fx * len, y: head.y + fy * len };
      c.strokeStyle = '#ff5b6e';
      c.lineWidth = Math.max(1, cell * 0.06);
      c.beginPath();
      c.moveTo(head.x + fx * cell * 0.35, head.y + fy * cell * 0.35);
      c.lineTo(tip.x, tip.y);
      c.lineTo(tip.x + (fx + side.x) * cell * 0.1, tip.y + (fy + side.y) * cell * 0.1);
      c.moveTo(tip.x, tip.y);
      c.lineTo(tip.x + (fx - side.x) * cell * 0.1, tip.y + (fy - side.y) * cell * 0.1);
      c.stroke();
    }
  }
  const flash = !state.alive && round.death < 0.12;
  c.fillStyle = flash ? '#ffffff' : colorAt(0);
  c.beginPath();
  c.arc(head.x, head.y, cell * 0.46, 0, Math.PI * 2);
  c.fill();

  let blink = 1;
  if (round.elapsed > round.nextBlink) {
    const k = (round.elapsed - round.nextBlink) / 0.14;
    if (k > 1) round.nextBlink = round.elapsed + 2.2 + Math.random() * 3;
    else blink = Math.max(0.12, Math.abs(1 - k * 2));
  }
  let look = { x: fx, y: fy };
  if (state.food) {
    const f = px(state.food);
    const d = Math.hypot(f.x - head.x, f.y - head.y) || 1;
    look = { x: (f.x - head.x) / d, y: (f.y - head.y) / d };
  }
  for (const sign of [-1, 1]) {
    const ex = head.x + fx * cell * 0.13 + side.x * cell * 0.2 * sign;
    const ey = head.y + fy * cell * 0.13 + side.y * cell * 0.2 * sign;
    const er = cell * 0.135;
    if (!state.alive) {
      c.strokeStyle = '#1b2a21';
      c.lineWidth = Math.max(1, cell * 0.07);
      c.beginPath();
      c.moveTo(ex - er * 0.7, ey - er * 0.7);
      c.lineTo(ex + er * 0.7, ey + er * 0.7);
      c.moveTo(ex + er * 0.7, ey - er * 0.7);
      c.lineTo(ex - er * 0.7, ey + er * 0.7);
      c.stroke();
      continue;
    }
    c.save();
    c.translate(ex, ey);
    c.scale(1, blink);
    c.fillStyle = '#f4fff7';
    c.beginPath();
    c.arc(0, 0, er, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#0f2417';
    c.beginPath();
    c.arc(look.x * er * 0.38, look.y * er * 0.38, er * 0.58, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  for (const p of round.particles) {
    c.globalAlpha = Math.max(0, p.life / p.max);
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  c.restore();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const p of round.popups) {
    const k = 1 - p.life / 0.75;
    c.globalAlpha = Math.min(1, p.life / 0.3);
    c.fillStyle = '#e9ffef';
    c.font = `700 ${Math.round(Math.max(13 * u, Math.min(22, cell * 0.55)))}px ${FONT}`;
    c.fillText(p.text, p.x, p.y - cell * 0.5 - k * cell * 0.9);
  }
  c.globalAlpha = 1;

  if (!round.started && state.alive && shell.status === 'playing') {
    const pulse = 0.78 + Math.sin(round.elapsed * 3.4) * 0.22;
    const size = Math.round(14 * u);
    const line = shell.touch ? 'Swipe or tap to start' : 'Press an arrow key to start';
    const bestLine = best ? `Best ${best.toLocaleString('en-US')}` : '';
    c.font = `600 ${size}px ${FONT}`;
    const tw = c.measureText(line).width;
    const lineH = size * 1.35;
    const boxH = (bestLine ? lineH * 2 : lineH) + size * 0.9;
    const boxW = tw + size * 2;
    const cx = b.x + b.width / 2;
    const cy = Math.max(boxH / 2 + 2, b.y + b.height * 0.27);
    c.fillStyle = 'rgba(8,14,10,0.72)';
    c.beginPath();
    c.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, boxH / 2.4);
    c.fill();
    c.fillStyle = `rgba(240,255,244,${pulse})`;
    c.fillText(line, cx, bestLine ? cy - lineH / 2 : cy);
    if (bestLine) {
      c.font = `500 ${Math.round(13 * u)}px ${FONT}`;
      c.fillStyle = 'rgba(200,230,210,0.7)';
      c.fillText(bestLine, cx, cy + lineH / 2);
    }
  }
}
