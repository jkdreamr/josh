import { useRef } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createSnake, queueDirection, speedForLength, stepSnake, type Direction, type SnakeState } from './logic';
import { meta } from './meta';
import './snake.css';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Round = {
  state: SnakeState | null;
  accumulator: number;
  death: number;
  foodAge: number;
  elapsed: number;
  swipeX: number | null;
  swipeY: number | null;
  particles: Particle[];
  ended: boolean;
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

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const { best } = useHighScore(meta.id);
  const round = useRef<Round>({
    state: null,
    accumulator: 0,
    death: 0,
    foodAge: 0,
    elapsed: 0,
    swipeX: null,
    swipeY: null,
    particles: [],
    ended: false,
  }).current;
  const { ref, size, ctx } = useCanvas();
  useKeys((code) => {
    const next = directions[code];
    if (next && round.state) queueDirection(round.state, next);
  });

  useGameLoop(
    (dt) => {
      const top = 54;
      const bottom = 20;
      const playH = Math.max(1, size.h - top - bottom);
      if (!round.state && size.w > 0 && size.h > 0) {
        const cols = Math.max(20, Math.min(28, Math.floor((size.w - 30) / 18)));
        const cell = Math.min((size.w - 30) / cols, playH / 18);
        round.state = createSnake(cols, Math.max(5, Math.floor(playH / cell)));
        shell.setScore(0);
      }
      const state = round.state;
      if (!state) return;
      round.elapsed += dt;
      round.foodAge += dt;
      round.particles = round.particles.filter((p) => {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.98;
        p.vy *= 0.98;
        return p.life > 0;
      });
      if (!state.alive) {
        round.death += dt;
        if (round.death > 0.55 && !round.ended) {
          round.ended = true;
          shell.gameOver(state.score, { detail: `You grew to ${state.segments.length} ${state.segments.length === 1 ? 'link' : 'links'}.` });
        }
        return;
      }
      round.accumulator += dt;
      const interval = 1 / speedForLength(state.segments.length);
      while (round.accumulator >= interval && state.alive && !state.won) {
        round.accumulator -= interval;
        const oldFood = state.food;
        const result = stepSnake(state);
        if (result === 'ate') {
          round.foodAge = 0;
          shell.setScore(state.score);
          sfx.play('coin', 1 + Math.min(0.35, state.score / 300));
          if (state.food) {
            const rect = boardRect(size.w, size.h, shell.touch, state.cols, state.rows);
            burst(round.particles, rect.x + (oldFood!.x + 0.5) * rect.cell, rect.y + (oldFood!.y + 0.5) * rect.cell, meta.accent);
          }
        } else if (result === 'dead') {
          round.death = 0.001;
          sfx.play('lose');
        } else if (result === 'won') {
          shell.setScore(state.score);
          sfx.play('win');
          round.ended = true;
          shell.gameOver(state.score, { title: 'You Win', detail: 'A perfect board.' });
        }
      }
    },
    () => draw(ctx(), size.w, size.h, round, shell.touch, best),
  );

  return (
    <canvas
      ref={ref}
      className="g-snake-canvas"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        round.swipeX = event.clientX;
        round.swipeY = event.clientY;
      }}
      onPointerMove={(event) => {
        if (round.swipeX === null || round.swipeY === null || !round.state?.alive) return;
        const dx = event.clientX - round.swipeX;
        const dy = event.clientY - round.swipeY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
        queueDirection(round.state, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        round.swipeX = event.clientX;
        round.swipeY = event.clientY;
      }}
      onPointerUp={() => {
        round.swipeX = null;
        round.swipeY = null;
      }}
      onPointerCancel={() => {
        round.swipeX = null;
        round.swipeY = null;
      }}
    />
  );
}

function boardRect(w: number, h: number, touch: boolean, cols: number, rows: number) {
  const top = 54;
  const bottom = touch ? 24 : 20;
  const cell = Math.max(1, Math.floor(Math.min((w - 30) / cols, (h - top - bottom) / rows)));
  const width = cell * cols;
  const height = cell * rows;
  return { x: (w - width) / 2, y: top + (h - top - bottom - height) / 2, cell, width, height };
}

function burst(particles: Particle[], x: number, y: number, color: string) {
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const speed = 22 + (i % 3) * 11;
    particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.35 + (i % 3) * 0.08, color });
  }
}

function draw(c: CanvasRenderingContext2D | null, w: number, h: number, round: Round, touch: boolean, best: number | null) {
  if (!c) return;
  c.clearRect(0, 0, w, h);
  const glow = c.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, h * 0.9);
  glow.addColorStop(0, 'rgba(48,209,88,0.12)');
  glow.addColorStop(1, '#0c0c10');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  const state = round.state;
  if (!state) return;
  const rect = boardRect(w, h, touch, state.cols, state.rows);
  c.fillStyle = 'rgba(255,255,255,0.025)';
  c.beginPath();
  c.roundRect(rect.x - 1, rect.y - 1, rect.width + 2, rect.height + 2, Math.min(20, rect.cell * 0.7));
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.045)';
  c.lineWidth = 1;
  c.stroke();
  const t = Math.min(1, round.accumulator * speedForLength(state.segments.length));
  const cells = state.segments.map((p, i) => {
    const from = state.previous[i] ?? p;
    return { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t };
  });
  if (!state.alive) c.globalAlpha = Math.max(0.25, 1 - round.death * 1.25);
  if (cells.length > 1) {
    const gradient = c.createLinearGradient(rect.x, rect.y + rect.height, rect.x + rect.width, rect.y);
    gradient.addColorStop(0, 'rgba(48,209,88,0.46)');
    gradient.addColorStop(1, '#7cf69a');
    c.strokeStyle = gradient;
    c.lineWidth = rect.cell * 0.72;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    cells.forEach((p, i) => {
      const x = rect.x + (p.x + 0.5) * rect.cell;
      const y = rect.y + (p.y + 0.5) * rect.cell;
      if (!i) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.stroke();
  }
  const head = cells[0];
  const cx = rect.x + (head.x + 0.5) * rect.cell;
  const cy = rect.y + (head.y + 0.5) * rect.cell;
  c.fillStyle = state.alive ? '#8dffac' : '#a9b0ad';
  c.beginPath();
  c.arc(cx, cy, rect.cell * 0.4, 0, Math.PI * 2);
  c.fill();
  const eyeShift = rect.cell * 0.12;
  const eyeForward = rect.cell * 0.13;
  const eyeSide = rect.cell * 0.16;
  let fx = 1;
  let fy = 0;
  if (state.direction === 'up') { fx = 0; fy = -1; }
  if (state.direction === 'down') { fx = 0; fy = 1; }
  if (state.direction === 'left') { fx = -1; fy = 0; }
  const perp = { x: -fy, y: fx };
  c.fillStyle = '#14341e';
  for (const sign of [-1, 1]) {
    c.beginPath();
    c.arc(cx + fx * eyeForward + perp.x * eyeSide * sign, cy + fy * eyeForward + perp.y * eyeSide * sign, eyeShift, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  if (state.food) {
    const pulse = 0.88 + Math.sin(round.foodAge * 4.5) * 0.08;
    const pop = Math.min(1, round.foodAge * 5);
    const foodX = rect.x + (state.food.x + 0.5) * rect.cell;
    const foodY = rect.y + (state.food.y + 0.5) * rect.cell;
    c.save();
    c.translate(foodX, foodY);
    c.scale(pop * pulse, pop * pulse);
    c.shadowColor = '#ff453a';
    c.shadowBlur = 18;
    c.fillStyle = '#ff6255';
    c.beginPath();
    c.arc(0, 0, rect.cell * 0.24, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  for (const p of round.particles) {
    c.globalAlpha = Math.max(0, p.life / 0.6);
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(245,245,247,0.48)';
  c.textAlign = 'center';
  c.font = '600 12px Inter, -apple-system, sans-serif';
  const bestLabel = best === null ? '' : ` · Best ${best.toLocaleString('en-US')}`;
  c.fillText(`Length ${state.segments.length} · ${speedForLength(state.segments.length).toFixed(1)}/s${bestLabel}`, w / 2, 31);
  if (touch && round.elapsed < 2 && state.alive) {
    c.fillStyle = `rgba(245,245,247,${0.35 * (1 - round.elapsed / 2)})`;
    c.font = '500 12px Inter, -apple-system, sans-serif';
    c.fillText('Swipe to steer', w / 2, h - 26);
  }
}
