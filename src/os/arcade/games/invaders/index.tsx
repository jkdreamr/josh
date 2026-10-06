import { useRef } from 'react';
import { GameShell, sfx, TouchControls, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createInvaders, firePlayerShot, stepInvaders, type InvadersState } from './logic';
import { meta } from './meta';
import './invaders.css';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Round = { game: InvadersState; particles: Particle[]; ended: boolean; march: number };
const colors = ['#30d158', '#64d2ff', '#5e5ce6'];

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
      <TouchControls dpad="x" buttons={[{ key: 'Space', label: 'fire' }]} />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { best } = useHighScore(meta.id);
  const { ref, size, ctx } = useCanvas();
  const round = useRef<Round>({ game: createInvaders(), particles: [], ended: false, march: 0 }).current;

  useGameLoop(
    (dt) => {
      const game = round.game;
      if (keys.pressed('action') && firePlayerShot(game)) sfx.play('blip', 0.95);
      stepInvaders(game, dt, keys.axis('left', 'right'));
      for (const effect of game.effects) {
        if (effect.type === 'march') {
          round.march++;
          sfx.play('tick', [0.75, 0.86, 0.98, 1.1][round.march % 4]);
        } else if (effect.type === 'alien') {
          sfx.play('boom', 0.7);
          burst(round.particles, effect.x, effect.y, colors[Math.floor(effect.points! / 10) % colors.length]);
        } else if (effect.type === 'player') {
          sfx.play('lose');
          burst(round.particles, effect.x, effect.y, '#ff453a');
        } else if (effect.type === 'ufo') {
          sfx.tone({ freq: 480, to: 820, dur: 0.32, type: 'sine', vol: 0.17 });
          burst(round.particles, effect.x, effect.y, '#ff375f');
        } else if (effect.type === 'shot') sfx.play('blip', 0.72);
        else if (effect.type === 'wave') sfx.play('win');
      }
      round.particles = round.particles.filter((p) => {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 24 * dt;
        return p.life > 0;
      });
      shell.setScore(game.score);
      if (game.ended && !round.ended) {
        round.ended = true;
        shell.gameOver(game.score, { detail: `you held through ${game.wave} ${game.wave === 1 ? 'wave' : 'waves'}.` });
      }
    },
    () => draw(ctx(), size.w, size.h, round, shell.touch, best),
  );

  return <canvas ref={ref} className="g-invaders-canvas" />;
}

function fitCourt(w: number, h: number, touch: boolean) {
  const reservedBottom = touch ? 136 : 22;
  const availHeight = Math.max(1, h - 72 - reservedBottom);
  const scale = Math.min((w - 20) / 500, availHeight / 700);
  return { scale, x: (w - 500 * scale) / 2, y: 54 + Math.max(0, (availHeight - 700 * scale) / 2) };
}

function burst(particles: Particle[], x: number, y: number, color: string) {
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const speed = 24 + (i % 4) * 14;
    particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.32 + (i % 3) * 0.08, color });
  }
}

function draw(c: CanvasRenderingContext2D | null, w: number, h: number, round: Round, touch: boolean, best: number | null) {
  if (!c) return;
  c.clearRect(0, 0, w, h);
  const bg = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
  bg.addColorStop(0, 'rgba(94,92,230,0.15)');
  bg.addColorStop(1, '#0c0c10');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const fit = fitCourt(w, h, touch);
  c.save();
  c.translate(fit.x, fit.y);
  c.scale(fit.scale, fit.scale);
  c.strokeStyle = 'rgba(255,255,255,0.055)';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(7, 0, 486, 700, 20);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.018)';
  c.beginPath();
  c.roundRect(7, 0, 486, 700, 20);
  c.fill();
  const frame = round.game.animation;
  for (const type of [0, 1, 2] as const) {
    const color = colors[2 - type];
    c.shadowColor = color;
    c.shadowBlur = 9;
    for (const alien of round.game.aliens) {
      if (alien.type === type) drawAlien(c, alien.x, alien.y, type, frame, color);
    }
  }
  c.shadowBlur = 0;
  for (const shield of round.game.shields) {
    c.fillStyle = 'rgba(48,209,88,0.78)';
    for (let row = 0; row < shield.rows; row++) {
      for (let col = 0; col < shield.cols; col++) {
        if (shield.cells[row][col]) c.fillRect(shield.x + col * shield.cell, shield.y + row * shield.cell, shield.cell - 0.7, shield.cell - 0.7);
      }
    }
  }
  if (round.game.ufo) {
    c.fillStyle = '#ff375f';
    c.shadowColor = '#ff375f';
    c.shadowBlur = 12;
    c.beginPath();
    c.roundRect(round.game.ufo.x + 5, 62, 28, 11, 6);
    c.fill();
    c.fillStyle = '#ff8295';
    c.beginPath();
    c.arc(round.game.ufo.x + 19, 61, 5, Math.PI, 0);
    c.fill();
    c.shadowBlur = 0;
  }
  for (const shot of round.game.playerShots) {
    c.fillStyle = '#f5f5f7';
    c.shadowColor = '#fff';
    c.shadowBlur = 10;
    c.beginPath();
    c.roundRect(shot.x - 1.5, shot.y - 9, 3, 12, 2);
    c.fill();
  }
  for (const shot of round.game.alienShots) {
    c.strokeStyle = '#ff9f0a';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(shot.x - 3, shot.y - 5);
    c.lineTo(shot.x + 3, shot.y);
    c.lineTo(shot.x - 3, shot.y + 5);
    c.stroke();
  }
  c.shadowBlur = 0;
  const playerVisible = round.game.player.invulnerable <= 0 || Math.floor(round.game.elapsed * 10) % 2 === 0;
  if (playerVisible) {
    c.fillStyle = '#f5f5f7';
    c.shadowColor = '#a7a6ff';
    c.shadowBlur = 13;
    c.beginPath();
    c.roundRect(round.game.player.x - 19, round.game.player.y - 7, 38, 12, 5);
    c.fill();
    c.beginPath();
    c.moveTo(round.game.player.x - 7, round.game.player.y - 7);
    c.lineTo(round.game.player.x - 2, round.game.player.y - 17);
    c.lineTo(round.game.player.x + 5, round.game.player.y - 17);
    c.lineTo(round.game.player.x + 9, round.game.player.y - 7);
    c.fill();
  }
  c.shadowBlur = 0;
  for (const p of round.particles) {
    c.globalAlpha = Math.max(0, p.life / 0.55);
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  if (round.game.pointsFlash) {
    c.fillStyle = `rgba(255,255,255,${Math.min(1, round.game.pointsFlash.time)})`;
    c.textAlign = 'center';
    c.font = '700 13px Inter, -apple-system, sans-serif';
    c.fillText(String(round.game.pointsFlash.value), round.game.pointsFlash.x, round.game.pointsFlash.y - 12);
  }
  if (round.game.waveBanner > 0) {
    c.fillStyle = 'rgba(8,8,12,0.5)';
    c.fillRect(7, 0, 486, 700);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.font = '650 28px Inter, -apple-system, sans-serif';
    c.fillText(`wave ${round.game.wave}`, 250, 350);
  }
  c.restore();
  c.fillStyle = 'rgba(245,245,247,0.55)';
  c.textAlign = 'center';
  c.font = '600 12px Inter, -apple-system, sans-serif';
  c.fillText(`wave ${round.game.wave}${best === null ? '' : ` · best ${best.toLocaleString('en-US')}`}`, w / 2, 29);
  for (let i = 0; i < round.game.lives; i++) {
    c.fillStyle = '#f5f5f7';
    c.beginPath();
    c.arc(w / 2 - (round.game.lives - 1) * 10 + i * 20, 45, 3, 0, Math.PI * 2);
    c.fill();
  }
  if (touch && round.game.elapsed < 2) {
    c.fillStyle = 'rgba(245,245,247,0.3)';
    c.font = '500 11px Inter, -apple-system, sans-serif';
    c.fillText('move left or right, then fire', w / 2, h - 148);
  }
}

function drawAlien(c: CanvasRenderingContext2D, x: number, y: number, type: 0 | 1 | 2, frame: number, color: string) {
  if (type === 0) {
    const footShift = frame === 0 ? 0 : 1.3;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x + 2, y + 1.5, 24, 15, 7);
    c.fill();
    c.beginPath();
    c.roundRect(x + 5 - footShift, y + 15, 6.5, 4.5, 2.25);
    c.roundRect(x + 16.5 + footShift, y + 15, 6.5, 4.5, 2.25);
    c.fill();
    c.fillStyle = '#f5f5f7';
    c.beginPath();
    c.arc(x + 9.5, y + 8, 2.7, 0, Math.PI * 2);
    c.arc(x + 18.5, y + 8, 2.7, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#171722';
    c.beginPath();
    c.arc(x + 10, y + 9, 1.25, 0, Math.PI * 2);
    c.arc(x + 19, y + 9, 1.25, 0, Math.PI * 2);
    c.fill();
    return;
  }

  if (type === 1) {
    const wave = frame === 0 ? 1 : -1;
    c.fillStyle = color;
    c.beginPath();
    c.arc(x + 14, y + 11, 10.5, Math.PI, 0);
    c.lineTo(x + 24.5, y + 12);
    c.lineTo(x + 3.5, y + 12);
    c.closePath();
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    for (const [index, offset] of [-1, 0, 1].entries()) {
      const startX = x + 14 + offset * 6.2;
      const sway = index === 1 ? -wave : wave;
      c.beginPath();
      c.moveTo(startX, y + 11.5);
      c.quadraticCurveTo(startX + sway * 2.5, y + 15, startX + sway * 2, y + 19.5);
      c.stroke();
    }
    c.fillStyle = '#f5f5f7';
    c.beginPath();
    c.roundRect(x + 8.5, y + 6.5, 11, 2.6, 1.3);
    c.fill();
    return;
  }

  const spread = frame === 0 ? 10 : 7;
  c.strokeStyle = color;
  c.lineWidth = 1.8;
  c.lineCap = 'round';
  for (const side of [-1, 1]) {
    const tipX = x + 14 + side * spread;
    c.beginPath();
    c.moveTo(x + 14 + side * 3.4, y + 8);
    c.lineTo(tipX, y + 2);
    c.stroke();
    c.fillStyle = color;
    c.beginPath();
    c.arc(tipX, y + 2, 1.8, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x + 14, y + 12, 6, 4.2, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f5f5f7';
  c.beginPath();
  c.ellipse(x + 14, y + 11.5, 3.4, 3, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#171722';
  c.beginPath();
  c.arc(x + 14, y + 12.2, 1.5, 0, Math.PI * 2);
  c.fill();
}
