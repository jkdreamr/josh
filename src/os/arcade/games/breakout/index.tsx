import { useRef } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createBreakout, launchBall, stepBreakout, type BreakoutState, type PowerKind } from './logic';
import { meta } from './meta';
import './breakout.css';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; tint: string };
type Round = { game: BreakoutState; pointerX: number | null; particles: Particle[]; shake: number; squash: number; ended: boolean };
const FIELD_W = 500;
const FIELD_H = 700;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { best } = useHighScore(meta.id);
  const { ref, size, ctx } = useCanvas();
  const round = useRef<Round>({ game: createBreakout(), pointerX: null, particles: [], shake: 0, squash: 0, ended: false }).current;
  const map = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const fit = fitCourt(rect.width, rect.height);
    const x = (clientX - rect.left - fit.x) / fit.scale;
    const y = (clientY - rect.top - fit.y) / fit.scale;
    return { x: Math.max(25, Math.min(475, x)), inside: x >= 0 && x <= FIELD_W && y >= 0 && y <= FIELD_H };
  };

  useGameLoop(
    (dt) => {
      const game = round.game;
      if (keys.pressed('action')) {
        const attached = game.balls.find((ball) => ball.attached);
        if (attached) {
          launchBall(attached, (345 + game.level * 12) * (game.slowActive ? 0.7 : 1));
          sfx.play('jump');
        }
      }
      stepBreakout(game, dt, keys.axis('left', 'right'), round.pointerX);
      for (const effect of game.effects) {
        if (effect.type === 'brick') {
          sfx.play('hit', 0.9 + Math.random() * 0.25);
          round.shake = 0.022;
          burst(round.particles, effect.x, effect.y, '#ff9f0a');
        } else if (effect.type === 'paddle') {
          round.squash = 0.16;
          sfx.play('blip', 0.8);
        } else if (effect.type === 'power') {
          sfx.play('coin');
          burst(round.particles, effect.x, effect.y, effect.value === 'wide' ? '#30d158' : effect.value === 'multi' ? '#5e5ce6' : '#64d2ff');
        } else if (effect.type === 'clear') sfx.play('win');
        else if (effect.type === 'life') sfx.play('lose');
      }
      round.particles = round.particles.filter((p) => {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 35 * dt;
        return p.life > 0;
      });
      round.shake = Math.max(0, round.shake - dt);
      round.squash = Math.max(0, round.squash - dt);
      shell.setScore(game.score);
      if (game.ended && !round.ended) {
        round.ended = true;
        shell.gameOver(game.score, { detail: `You cleared ${game.level - 1} ${game.level - 1 === 1 ? 'level' : 'levels'}.` });
      }
    },
    () => draw(ctx(), size.w, size.h, round, best),
  );

  return (
    <canvas
      ref={ref}
      className="g-breakout-canvas"
      onPointerMove={(event) => {
        const pos = map(event.clientX, event.clientY);
        if (pos?.inside) round.pointerX = pos.x;
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const pos = map(event.clientX, event.clientY);
        if (pos?.inside) round.pointerX = pos.x;
        const ball = round.game.balls.find((entry) => entry.attached);
        if (ball) {
          launchBall(ball, (345 + round.game.level * 12) * (round.game.slowActive ? 0.7 : 1));
          sfx.play('jump');
        }
      }}
      onPointerUp={() => {
        round.pointerX = null;
      }}
      onPointerCancel={() => {
        round.pointerX = null;
      }}
    />
  );
}

function fitCourt(w: number, h: number) {
  const scale = Math.min((w - 20) / FIELD_W, (h - 74) / FIELD_H);
  return { scale, x: (w - FIELD_W * scale) / 2, y: 54 + Math.max(0, (h - 74 - FIELD_H * scale) / 2) };
}

function burst(particles: Particle[], x: number, y: number, tint: string) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    particles.push({ x, y, vx: Math.cos(a) * (20 + (i % 3) * 10), vy: Math.sin(a) * (20 + (i % 3) * 10), life: 0.3 + (i % 2) * 0.12, tint });
  }
}

function draw(c: CanvasRenderingContext2D | null, w: number, h: number, round: Round, best: number | null) {
  if (!c) return;
  c.clearRect(0, 0, w, h);
  const bg = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
  bg.addColorStop(0, 'rgba(255,159,10,0.12)');
  bg.addColorStop(1, '#0c0c10');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const fit = fitCourt(w, h);
  c.save();
  if (round.shake > 0) c.translate((Math.random() - 0.5) * 3 * round.shake / 0.035, (Math.random() - 0.5) * 3 * round.shake / 0.035);
  c.translate(fit.x, fit.y);
  c.scale(fit.scale, fit.scale);
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(8, 0, 484, 700, 22);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.025)';
  c.beginPath();
  c.roundRect(8, 0, 484, 700, 22);
  c.fill();
  const colors = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#5e5ce6'];
  for (const brick of round.game.bricks) {
    const color = colors[brick.row % colors.length];
    c.globalAlpha = brick.hp === 1 && brick.row % 2 === 0 ? 0.72 : 0.94;
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(brick.x, brick.y, brick.w, brick.h, 7);
    c.fill();
    c.shadowBlur = 0;
    if (brick.hp > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.65)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(brick.x + 11, brick.y + 5);
      c.lineTo(brick.x + 17, brick.y + 11);
      c.lineTo(brick.x + 14, brick.y + 17);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  for (const drop of round.game.drops) {
    const color = drop.kind === 'wide' ? '#30d158' : drop.kind === 'multi' ? '#5e5ce6' : '#64d2ff';
    c.shadowColor = color;
    c.shadowBlur = 14;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(drop.x - 11, drop.y - 8, 22, 16, 8);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#101016';
    c.font = '700 11px Inter, sans-serif';
    c.textAlign = 'center';
    c.fillText(drop.kind === 'wide' ? 'W' : drop.kind === 'multi' ? '3' : 'S', drop.x, drop.y + 3.5);
  }
  c.fillStyle = '#f5f5f7';
  c.shadowColor = 'rgba(255,255,255,0.45)';
  c.shadowBlur = 16;
  const squash = round.squash > 0 ? 1 - Math.sin((round.squash / 0.16) * Math.PI) * 0.12 : 1;
  c.beginPath();
  c.roundRect(round.game.paddle.x - round.game.paddle.width / 2, round.game.paddle.y - round.game.paddle.height * squash / 2, round.game.paddle.width, round.game.paddle.height * squash, 7);
  c.fill();
  c.shadowBlur = 0;
  for (const ball of round.game.balls) {
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = 15;
    c.beginPath();
    c.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    c.fill();
  }
  c.shadowBlur = 0;
  for (const p of round.particles) {
    c.globalAlpha = Math.max(0, p.life / 0.5);
    c.fillStyle = p.tint;
    c.beginPath();
    c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  if (round.game.levelBanner > 0) {
    c.fillStyle = 'rgba(8,8,12,0.42)';
    c.fillRect(8, 0, 484, 700);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.font = '650 28px Inter, -apple-system, sans-serif';
    c.fillText(`Level ${round.game.level + 1}`, 250, 350);
  }
  c.restore();
  c.fillStyle = 'rgba(245,245,247,0.55)';
  c.font = '600 12px Inter, -apple-system, sans-serif';
  c.textAlign = 'center';
  c.fillText(`Level ${round.game.level}${best === null ? '' : ` · Best ${best.toLocaleString('en-US')}`}`, w / 2, 30);
  c.fillStyle = 'rgba(245,245,247,0.8)';
  for (let i = 0; i < round.game.lives; i++) {
    c.beginPath();
    c.arc(w / 2 - (round.game.lives - 1) * 9 + i * 18, 46, 3, 0, Math.PI * 2);
    c.fill();
  }
  const active: { kind: PowerKind; until: number }[] = [];
  if (round.game.wideUntil > round.game.time) active.push({ kind: 'wide', until: round.game.wideUntil });
  if (round.game.slowUntil > round.game.time) active.push({ kind: 'slow', until: round.game.slowUntil });
  if (active.length) {
    c.fillStyle = 'rgba(245,245,247,0.45)';
    c.font = '500 11px Inter, -apple-system, sans-serif';
    c.textAlign = 'center';
    c.fillText(active.map((p) => `${p.kind[0].toUpperCase()}${p.kind.slice(1)} ${Math.ceil(p.until - round.game.time)}s`).join('  ·  '), w / 2, h - 18);
  }
}
