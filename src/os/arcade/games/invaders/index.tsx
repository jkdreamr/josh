import { useRef, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, TouchControls, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { fitCourt, viewHeight, viewTop, type Fit } from './layout';
import { alienHeight, alienWidth, createInvaders, firePlayerShot, stepInvaders, type InvadersState } from './logic';
import { meta } from './meta';
import './invaders.css';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Burst = { x: number; y: number; time: number; color: string; big: boolean };
type Drag = { id: number; startX: number; ship: number };
type Round = {
  game: InvadersState;
  particles: Particle[];
  bursts: Burst[];
  ended: boolean;
  over: boolean;
  endTimer: number;
  march: number;
  shake: number;
  flash: number;
  time: number;
  fireTimer: number;
  fireHeld: boolean;
  target: number | null;
  drag: Drag | null;
  fit: Fit | null;
};

const colors = ['#30d158', '#64d2ff', '#7d7aff'];
const fireRepeat = 0.3;
const stars = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 127.1 + n * 311.7) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1), y: r(2), size: 0.6 + r(3) * 1.1, phase: r(4) * Math.PI * 2, speed: 0.8 + r(5) * 1.6 };
});

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
      <TouchControls dpad="x" buttons={[{ key: 'Space', label: 'Fire' }]} />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { best } = useHighScore(meta.id);
  const { ref, size, ctx } = useCanvas();
  const round = useRef<Round | null>(null);
  if (!round.current) {
    const game = createInvaders();
    game.waveBanner = 1;
    round.current = {
      game, particles: [], bursts: [], ended: false, over: false, endTimer: 0, march: 0, shake: 0, flash: 0, time: 0,
      fireTimer: 0, fireHeld: false, target: null, drag: null, fit: null,
    };
  }
  const r = round.current;

  useGameLoop(
    (dt) => {
      const game = r.game;
      r.time += dt;
      r.shake = Math.max(0, r.shake - dt);
      r.flash = Math.max(0, r.flash - dt);
      r.fireTimer = Math.max(0, r.fireTimer - dt);
      const keyAxis = keys.axis('left', 'right');
      if (keyAxis !== 0) r.target = null;
      let axis: number = keyAxis;
      if (r.target !== null && !game.ended) {
        const gap = r.target - game.player.x;
        axis = Math.abs(gap) < 0.5 ? 0 : Math.max(-1, Math.min(1, gap / Math.max(1e-6, game.player.speed * dt)));
      }
      const tapped = keys.pressed('action');
      if (!r.ended && (tapped || ((keys.down('action') || r.fireHeld) && r.fireTimer <= 0))) {
        if (firePlayerShot(game)) r.fireTimer = fireRepeat;
      }
      stepInvaders(game, dt, axis);
      for (const effect of game.effects) {
        if (effect.type === 'march') {
          r.march++;
          sfx.play('tick', [0.75, 0.86, 0.98, 1.1][r.march % 4]);
        } else if (effect.type === 'alien') {
          sfx.play('boom', 0.7 + Math.random() * 0.12);
          const color = colors[effect.points === 30 ? 0 : effect.points === 20 ? 1 : 2];
          burst(r.particles, effect.x, effect.y, color, 12, 70);
          r.bursts.push({ x: effect.x, y: effect.y, time: 0.22, color, big: false });
        } else if (effect.type === 'player') {
          sfx.play('lose');
          burst(r.particles, effect.x, effect.y, '#ff453a', 22, 120);
          burst(r.particles, effect.x, effect.y, '#ffd60a', 10, 70);
          r.bursts.push({ x: effect.x, y: effect.y, time: 0.5, color: '#ff9f0a', big: true });
          r.shake = 0.4;
          r.flash = 0.25;
          r.target = null;
        } else if (effect.type === 'ufo') {
          sfx.tone({ freq: 480, to: 820, dur: 0.32, type: 'sine', vol: 0.17 });
          burst(r.particles, effect.x + 19, effect.y, '#ff375f', 18, 100);
          r.bursts.push({ x: effect.x + 19, y: effect.y, time: 0.35, color: '#ff375f', big: true });
          r.shake = Math.max(r.shake, 0.15);
        } else if (effect.type === 'clash') {
          sfx.play('tick', 1.7);
          burst(r.particles, effect.x, effect.y, '#ffd60a', 6, 50);
        } else if (effect.type === 'shield') {
          burst(r.particles, effect.x, effect.y, '#30d158', 4, 40);
        } else if (effect.type === 'life') sfx.play('coin', 1.2);
        else if (effect.type === 'shot') sfx.play('blip', 0.72);
        else if (effect.type === 'wave') sfx.play('win');
      }
      if (game.ufo && Math.floor(r.time * 6) !== Math.floor((r.time - dt) * 6)) sfx.tone({ freq: 620, to: 560, dur: 0.12, type: 'triangle', vol: 0.04 });
      r.particles = r.particles.filter((p) => {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 2.2 * dt;
        p.vy = p.vy * (1 - 2.2 * dt) + 40 * dt;
        return p.life > 0;
      });
      r.bursts = r.bursts.filter((b) => (b.time -= dt) > 0);
      shell.setScore(game.score);
      if (game.ended && !r.ended) {
        r.ended = true;
        r.fireHeld = false;
        r.endTimer = 1.1;
      }
      if (r.ended && !r.over && (r.endTimer -= dt) <= 0) {
        r.over = true;
        const waves = `${game.wave} ${game.wave === 1 ? 'wave' : 'waves'}`;
        const landed = game.aliens.some((a) => a.y + alienHeight >= game.player.y - 12);
        shell.gameOver(game.score, { detail: landed ? `They landed on wave ${game.wave}.` : `You held through ${waves}.` });
      }
    },
    () => {
      const canvas = ref.current;
      const obstacles = measure(canvas, shell.root.current, shell.touch);
      r.fit = fitCourt(size.w, size.h, obstacles);
      draw(ctx(), size.w, size.h, r, r.fit, shell.touch, best);
    },
  );

  const toWorldX = (offsetX: number) => (r.fit ? (offsetX - r.fit.ox) / r.fit.sx : r.game.player.x);
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (shell.status !== 'playing' || r.ended) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    sfx.unlock();
    const x = e.nativeEvent.offsetX;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      r.target = toWorldX(x);
    } else {
      r.drag = { id: e.pointerId, startX: x, ship: r.game.player.x };
    }
    r.fireHeld = true;
    if (firePlayerShot(r.game)) r.fireTimer = fireRepeat;
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (shell.status !== 'playing' || r.ended) return;
    const x = e.nativeEvent.offsetX;
    if (e.pointerType === 'mouse') r.target = toWorldX(x);
    else if (r.drag && r.drag.id === e.pointerId && r.fit) r.target = r.drag.ship + (x - r.drag.startX) / r.fit.sx;
  };
  const onPointerEnd = (e: RPointerEvent<HTMLCanvasElement>) => {
    r.fireHeld = false;
    if (r.drag && r.drag.id === e.pointerId) {
      r.drag = null;
      r.target = null;
    }
  };

  return (
    <canvas
      ref={ref}
      className="g-invaders-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Where the shell's control pill sits over the canvas, in canvas CSS pixels (the laptop screen is transformed). */
function measure(canvas: HTMLCanvasElement | null, root: HTMLElement | null, touch: boolean) {
  const fallback = { touch, ctrlLeft: Infinity, ctrlBottom: 44 };
  const ctrl = root?.querySelector('.arcade-ctrl');
  if (!canvas || !ctrl || !canvas.offsetWidth) return fallback;
  const box = canvas.getBoundingClientRect();
  const rect = ctrl.getBoundingClientRect();
  const scale = box.width / canvas.offsetWidth || 1;
  if (!rect.width) return fallback;
  return { touch, ctrlLeft: (rect.left - box.left) / scale, ctrlBottom: (rect.bottom - box.top) / scale };
}

function burst(particles: Particle[], x: number, y: number, color: string, count: number, power: number) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const speed = power * (0.35 + Math.random() * 0.75);
    const life = 0.3 + Math.random() * 0.35;
    particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, max: life, color, size: 1.6 + Math.random() * 1.6 });
  }
}

const font = (weight: number, px: number) => `${weight} ${px}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;

function draw(c: CanvasRenderingContext2D | null, w: number, h: number, r: Round, fit: Fit, touch: boolean, best: number | null) {
  if (!c || w <= 0 || h <= 0) return;
  const game = r.game;
  const { ox, oy, sx, sy, k } = fit;
  const X = (x: number) => ox + x * sx;
  const Y = (y: number) => oy + (y - viewTop) * sy;
  c.save();
  c.clearRect(0, 0, w, h);
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#15143a');
  bg.addColorStop(0.55, '#0d0c22');
  bg.addColorStop(1, '#08080f');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  for (const s of stars) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(r.time * s.speed + s.phase));
    c.globalAlpha = 0.22 + 0.5 * tw;
    c.fillStyle = '#e8e8ff';
    c.fillRect(s.x * w, s.y * h, s.size, s.size);
  }
  c.globalAlpha = 1;
  if (r.shake > 0) {
    const m = r.shake * 9 * Math.max(0.4, k);
    c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  const courtW = 486 * sx;
  const courtH = viewHeight * sy;
  const radius = Math.max(6, 18 * k);
  c.fillStyle = 'rgba(255,255,255,0.025)';
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(X(7), Y(viewTop), courtW, courtH, radius);
  c.fill();
  c.stroke();

  c.save();
  c.beginPath();
  c.roundRect(X(7), Y(viewTop), courtW, courtH, radius);
  c.clip();

  const groundY = Y(672);
  c.strokeStyle = 'rgba(48,209,88,0.45)';
  c.lineWidth = Math.max(1, 2 * sy);
  c.beginPath();
  c.moveTo(X(14), groundY);
  c.lineTo(X(486), groundY);
  c.stroke();

  const frame = game.animation;
  for (const type of [0, 1, 2] as const) {
    const color = colors[2 - type];
    c.shadowColor = color;
    c.shadowBlur = 8 * k;
    for (const alien of game.aliens) {
      if (alien.type !== type) continue;
      sprite(c, X(alien.x + alienWidth / 2), Y(alien.y + alienHeight / 2), k, () => drawAlien(c, -14, -10.5, type, frame, color));
    }
  }
  c.shadowBlur = 0;

  for (const shield of game.shields) {
    const grad = c.createLinearGradient(0, Y(shield.y), 0, Y(shield.y + shield.rows * shield.cell));
    grad.addColorStop(0, '#5ef08a');
    grad.addColorStop(1, '#1f9e4a');
    c.fillStyle = grad;
    const cw = shield.cell * sx;
    const ch = shield.cell * sy;
    for (let row = 0; row < shield.rows; row++) {
      for (let col = 0; col < shield.cols; col++) {
        if (shield.cells[row][col]) c.fillRect(X(shield.x + col * shield.cell), Y(shield.y + row * shield.cell), cw + 0.4, ch + 0.4);
      }
    }
  }

  if (game.ufo) {
    const ux = game.ufo.x + 19;
    sprite(c, X(ux), Y(67), k, () => drawSaucer(c, r.time));
  }

  for (const shot of game.playerShots) {
    c.fillStyle = '#ffffff';
    c.shadowColor = '#a7a6ff';
    c.shadowBlur = 10 * k;
    const sw = Math.max(1.5, 3 * k);
    c.beginPath();
    c.roundRect(X(shot.x) - sw / 2, Y(shot.y - 10), sw, Math.max(4, 14 * sy), sw / 2);
    c.fill();
  }
  c.shadowBlur = 0;
  for (const shot of game.alienShots) {
    const x = X(shot.x);
    const y = Y(shot.y);
    if (shot.kind === 'zap') {
      c.strokeStyle = '#ff6961';
      c.shadowColor = '#ff453a';
      c.shadowBlur = 8 * k;
      c.lineWidth = Math.max(1.5, 3 * k);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x, y - 8 * sy);
      c.lineTo(x, y + 6 * sy);
      c.stroke();
    } else {
      const flip = Math.floor(r.time * 14 + shot.x) % 2 === 0 ? 1 : -1;
      c.strokeStyle = '#ffb340';
      c.shadowColor = '#ff9f0a';
      c.shadowBlur = 6 * k;
      c.lineWidth = Math.max(1.4, 2.6 * k);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(x - 3 * k * flip, y - 7 * sy);
      c.lineTo(x + 3 * k * flip, y - 2 * sy);
      c.lineTo(x - 3 * k * flip, y + 2 * sy);
      c.lineTo(x + 3 * k * flip, y + 6 * sy);
      c.stroke();
    }
  }
  c.shadowBlur = 0;

  const down = game.respawn > 0 || (r.ended && game.lives <= 0);
  const blink = game.player.invulnerable > 0 && Math.floor(game.elapsed * 12) % 2 === 1;
  if (!down && !blink) {
    sprite(c, X(game.player.x), Y(game.player.y), k, () => drawCannon(c, r.fireTimer > fireRepeat - 0.06));
  }

  for (const b of r.bursts) {
    const t = b.time;
    sprite(c, X(b.x), Y(b.y), k, () => drawBurst(c, b, t));
  }
  for (const p of r.particles) {
    c.globalAlpha = Math.max(0, p.life / p.max);
    c.fillStyle = p.color;
    const s = p.size * Math.max(0.6, k);
    c.fillRect(X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
  }
  c.globalAlpha = 1;

  if (game.pointsFlash) {
    c.fillStyle = `rgba(255,255,255,${Math.min(1, game.pointsFlash.time * 1.5)})`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = font(700, 14);
    c.fillText(String(game.pointsFlash.value), X(game.pointsFlash.x), Y(game.pointsFlash.y + 4) + 14 - (1.2 - game.pointsFlash.time) * 10);
  }
  c.restore();

  if (r.flash > 0) {
    c.fillStyle = `rgba(255,69,58,${r.flash * 0.6})`;
    c.fillRect(-20, -20, w + 40, h + 40);
  }

  if (game.waveBanner > 0 && !r.ended) {
    const t = game.waveBanner;
    const fade = Math.min(1, t * 4, (1.15 - t) * 6 + 0.2);
    c.globalAlpha = Math.max(0, fade);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const px = Math.max(18, Math.min(34, 30 * k));
    c.font = font(700, px);
    const cx = X(250);
    const cy = Y(400);
    c.fillText(`Wave ${game.wave}`, cx, cy);
    if (game.wave === 1 && game.elapsed < 1.2) {
      c.fillStyle = 'rgba(235,235,245,0.7)';
      c.font = font(500, Math.max(13.5, px * 0.48));
      const hint = touch ? ['Drag to move,', 'hold to fire'] : ['Arrows or mouse to move,', 'Space or click to fire'];
      const one = hint.join(' ');
      const lh = Math.max(13.5, px * 0.48) * 1.3;
      if (c.measureText(one).width <= courtW - 16) c.fillText(one, cx, cy + px * 1.05);
      else if (Math.max(...hint.map((line) => c.measureText(line).width)) <= courtW - 12)
        hint.forEach((line, i) => c.fillText(line, cx, cy + px * 0.95 + i * lh));
    }
    c.globalAlpha = 1;
  }

  drawHud(c, fit, game, best);
  c.restore();
}

function drawHud(c: CanvasRenderingContext2D, fit: Fit, game: InvadersState, best: number | null) {
  const { x, y, align, stack } = fit.hud;
  c.textBaseline = 'middle';
  c.font = font(600, 14);
  const wave = `Wave ${game.wave}`;
  const bestText = best === null ? '' : `Best ${best.toLocaleString('en-US')}`;
  const lifeGap = 21;
  const livesW = Math.max(0, game.lives - 1) * lifeGap + 16;
  const life = (lx: number, ly: number) => sprite(c, lx, ly + 3, 0.38, () => drawCannon(c, false));
  if (stack) {
    c.textAlign = 'left';
    c.fillStyle = 'rgba(245,245,247,0.82)';
    c.fillText(wave, x, y);
    for (let i = 0; i < game.lives; i++) life(x + 8 + i * lifeGap, y + 22);
    if (bestText) {
      c.fillStyle = 'rgba(245,245,247,0.5)';
      c.fillText(bestText, x, y + 44);
    }
    return;
  }
  c.fillStyle = 'rgba(245,245,247,0.82)';
  const waveW = c.measureText(wave).width;
  c.font = font(500, 14);
  const bestW = bestText ? c.measureText(bestText).width : 0;
  const gap = 18;
  const total = waveW + gap + livesW + (bestText ? gap + bestW : 0);
  let cx = x - total / 2;
  c.textAlign = 'left';
  c.font = font(600, 14);
  c.fillText(wave, cx, y);
  cx += waveW + gap;
  for (let i = 0; i < game.lives; i++) life(cx + 8 + i * lifeGap, y - 1);
  cx += livesW + gap;
  if (bestText) {
    c.font = font(500, 14);
    c.fillStyle = 'rgba(245,245,247,0.5)';
    c.fillText(bestText, cx, y);
  }
}

function sprite(c: CanvasRenderingContext2D, x: number, y: number, k: number, paint: () => void) {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  paint();
  c.restore();
}

function drawCannon(c: CanvasRenderingContext2D, muzzle: boolean) {
  const body = c.createLinearGradient(0, -18, 0, 6);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#b9b8ff');
  c.shadowColor = '#8e8cff';
  c.shadowBlur = 12;
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(-20, 6);
  c.lineTo(-18, -3);
  c.quadraticCurveTo(-16, -7, -10, -7);
  c.lineTo(-5, -7);
  c.lineTo(-3, -16);
  c.quadraticCurveTo(0, -19, 3, -16);
  c.lineTo(5, -7);
  c.lineTo(10, -7);
  c.quadraticCurveTo(16, -7, 18, -3);
  c.lineTo(20, 6);
  c.closePath();
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = '#5e5ce6';
  c.beginPath();
  c.roundRect(-12, -1, 24, 3, 1.5);
  c.fill();
  if (muzzle) {
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.shadowColor = '#fff';
    c.shadowBlur = 14;
    c.beginPath();
    c.arc(0, -20, 4, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
  }
}

function drawSaucer(c: CanvasRenderingContext2D, time: number) {
  c.shadowColor = '#ff375f';
  c.shadowBlur = 14;
  c.fillStyle = '#ff375f';
  c.beginPath();
  c.ellipse(0, 1, 19, 5.5, 0, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = '#ff9aac';
  c.beginPath();
  c.ellipse(0, -3, 8, 6, 0, Math.PI, 0);
  c.fill();
  for (let i = 0; i < 5; i++) {
    const on = Math.floor(time * 8 + i) % 5 === 0;
    c.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.arc(-12 + i * 6, 1.5, 1.4, 0, Math.PI * 2);
    c.fill();
  }
}

function drawBurst(c: CanvasRenderingContext2D, b: Burst, t: number) {
  const life = b.big ? 0.5 : 0.22;
  const p = 1 - t / life;
  const radius = (b.big ? 26 : 15) * (0.5 + p * 0.7);
  c.globalAlpha = Math.max(0, 1 - p);
  c.strokeStyle = b.color;
  c.fillStyle = '#ffffff';
  c.lineWidth = 2.4;
  c.lineCap = 'round';
  const spikes = b.big ? 10 : 8;
  c.beginPath();
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (b.big ? 0.2 : 0);
    const inner = radius * 0.35;
    const outer = radius * (i % 2 ? 0.75 : 1);
    c.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    c.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
  }
  c.stroke();
  c.beginPath();
  c.arc(0, 0, radius * 0.22 * (1 - p), 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
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
