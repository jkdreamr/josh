import { useEffect, useRef, useState } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useOnline, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createBreakout, fieldFor, resizeBreakout, serve, stepBreakout, type Ball, type Brick, type BreakoutState, type Field, type PowerKind } from './logic';
import { meta } from './meta';
import './breakout.css';

type Fit = ReturnType<typeof fieldFor>;
type Shard = { x: number; y: number; vx: number; vy: number; spin: number; a: number; size: number; life: number; max: number; tint: string };
type Popup = { x: number; y: number; text: string; tint: string; life: number };
type Glow = { x: number; y: number; life: number };
type Hud = { mode: 'top' | 'bottom'; x: number };
type Round = {
  game: BreakoutState;
  pointerX: number | null;
  drag: { id: number; x: number; target: number; moved: number } | null;
  mouse: boolean;
  shards: Shard[];
  popups: Popup[];
  glows: Glow[];
  trails: WeakMap<Ball, number[]>;
  flashes: WeakMap<Brick, number>;
  shake: number;
  squash: number;
  hurt: number;
  ended: boolean;
  u: number;
  hud: Hud;
  frame: number;
};

const ROW_COLORS = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#5e5ce6'];
const STEEL = '#c9ced8';
const POWER_COLORS: Record<PowerKind, string> = { wide: '#30d158', multi: '#bf5af2', slow: '#64d2ff' };
const POWER_NAMES: Record<PowerKind, string> = { wide: 'Wide Paddle', multi: 'Multiball', slow: 'Slow Ball' };
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
/** The shell's score pill and control row sit over the top this many CSS px. */
const TOP_BAND = 44;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

function brickColor(brick: Brick) {
  return brick.maxHp >= 3 ? STEEL : ROW_COLORS[brick.row % ROW_COLORS.length];
}

/** Lays the field out for this canvas: bricks start under the shell's top controls, and room is left under the paddle when the HUD sits at the bottom. */
function layout(w: number, h: number, hud: Hud) {
  const fit = fieldFor(w, h);
  const s = fit.scale || 1;
  const top = Math.max(fit.height * 0.1, (TOP_BAND - fit.y) / s + 4);
  const bottom = hud.mode === 'bottom' ? Math.max(fit.height * 0.06, (30 - fit.y) / s + 7) : Math.max(22, fit.height * 0.05);
  const field: Field = { width: fit.width, height: fit.height, top, bottom };
  return { fit, field };
}

function Play() {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const [cursorHidden, setCursorHidden] = useState(false);
  const roundRef = useRef<Round | null>(null);
  if (!roundRef.current) {
    roundRef.current = {
      game: createBreakout(1, layout(500, 700, { mode: 'top', x: 250 }).field),
      pointerX: null,
      drag: null,
      mouse: false,
      shards: [],
      popups: [],
      glows: [],
      trails: new WeakMap(),
      flashes: new WeakMap(),
      shake: 0,
      squash: 0,
      hurt: 0,
      ended: false,
      u: 1,
      hud: { mode: 'top', x: 250 },
      frame: 0,
    };
  }
  const round = roundRef.current;
  const onlineRef = useRef(online !== null);
  onlineRef.current = online !== null;

  // A phone or iPad frame is scaled down to fit; canvas text and shell controls grow by the same factor so they stay readable.
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = shell.touch && k > 0.2 && k < 0.99 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1;
        round.u = u;
        el.style.setProperty('--g-breakout-u', String(u));
        shell.invalidate();
      });
    };
    measure();
    const late = window.setTimeout(measure, 700);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-breakout-u');
    };
  }, [shell.touch, shell.status, shell.root, shell.invalidate, round]);

  useEffect(() => {
    if (shell.status !== 'playing') setCursorHidden(false);
  }, [shell.status]);

  const placeHud = () => {
    const root = shell.root.current;
    const canvas = ref.current;
    if (onlineRef.current || !root || !canvas) {
      round.hud = { mode: onlineRef.current ? 'bottom' : 'top', x: size.w / 2 };
      return;
    }
    // Center the HUD in the gap between the score pill and the control row, or move it under the paddle when they leave no room.
    const ctrl = root.querySelector<HTMLElement>('.arcade-ctrl');
    const score = root.querySelector<HTMLElement>('.arcade-score');
    const left = score ? score.offsetLeft + score.offsetWidth + 8 : 10;
    const right = ctrl ? ctrl.offsetLeft - 8 : size.w - 10;
    const need = 120 * round.u;
    round.hud = right - left >= need ? { mode: 'top', x: Math.max(left + need / 2, Math.min(right - need / 2, size.w / 2)) } : { mode: 'bottom', x: size.w / 2 };
  };

  const view = () => {
    const { fit, field } = layout(size.w, size.h, round.hud);
    resizeBreakout(round.game, field);
    return fit;
  };

  useGameLoop(
    (dt) => {
      const game = round.game;
      if (round.frame++ % 20 === 0) placeHud();
      view();
      const axis = keys.axis('left', 'right');
      if (axis) {
        round.pointerX = null;
        round.drag = null;
      }
      if (keys.pressed('action')) serve(game);
      stepBreakout(game, dt, axis, round.pointerX);
      react(round, game);
      tick(round, dt);
      shell.setScore(game.score);
      if (game.ended && !round.ended) {
        round.ended = true;
        const cleared = game.level - 1;
        shell.gameOver(game.score, { detail: cleared ? `You cleared ${cleared} ${cleared === 1 ? 'wall' : 'walls'}.` : 'Clear the wall to reach level 2.' });
      }
    },
    () => {
      if (shell.status !== 'playing') placeHud();
      const fit = view();
      draw(ctx(), size.w, size.h, fit, round, shell.status === 'playing', shell.touch);
    },
  );

  const toField = (offsetX: number) => {
    const fit = fieldFor(size.w, size.h);
    return (offsetX - fit.x) / (fit.scale || 1);
  };

  return (
    <canvas
      ref={ref}
      className={`g-breakout-canvas${cursorHidden ? ' is-hidden-cursor' : ''}`}
      onPointerMove={(event) => {
        const x = event.nativeEvent.offsetX;
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
          round.mouse = true;
          round.pointerX = toField(x);
          if (shell.status === 'playing' && !cursorHidden) setCursorHidden(true);
          return;
        }
        const drag = round.drag;
        if (!drag || drag.id !== event.pointerId) return;
        // Touch moves the paddle by how far the finger slides, so the finger never has to cover the ball.
        const fit = fieldFor(size.w, size.h);
        const game = round.game;
        const half = game.paddle.width / 2;
        drag.target = Math.max(half, Math.min(game.width - half, drag.target + (x - drag.x) / (fit.scale || 1) * 1.15));
        drag.moved += Math.abs(x - drag.x);
        drag.x = x;
        round.pointerX = drag.target;
      }}
      onPointerDown={(event) => {
        if (shell.status !== 'playing') return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
          round.mouse = true;
          round.pointerX = toField(event.nativeEvent.offsetX);
          setCursorHidden(true);
          if (event.button === 0) serve(round.game);
          return;
        }
        round.mouse = false;
        round.drag = { id: event.pointerId, x: event.nativeEvent.offsetX, target: round.game.paddle.x, moved: 0 };
        round.pointerX = round.game.paddle.x;
      }}
      onPointerUp={(event) => {
        const drag = round.drag;
        if (drag?.id !== event.pointerId) return;
        round.drag = null;
        round.pointerX = null;
        if (shell.status === 'playing' && drag.moved < 14) serve(round.game);
      }}
      onPointerCancel={(event) => {
        if (round.drag?.id !== event.pointerId) return;
        round.drag = null;
        round.pointerX = null;
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setCursorHidden(false);
      }}
    />
  );
}

function react(round: Round, game: BreakoutState) {
  for (const effect of game.effects) {
    if (effect.type === 'brick') {
      const step = Math.min(effect.chain, 12);
      if (effect.broke) {
        sfx.play('hit', 0.85 + step * 0.06);
        round.shake = Math.max(round.shake, 0.06);
        shatter(round.shards, effect.x, effect.y, effect.w, effect.h, effect.maxHp >= 3 ? STEEL : ROW_COLORS[effect.row % ROW_COLORS.length]);
        if (effect.chain >= 3) round.popups.push({ x: effect.x, y: effect.y, text: `+${effect.points}`, tint: '#ffd60a', life: 0.8 });
      } else {
        sfx.tone({ freq: 880 + step * 40, to: 620, dur: 0.06, type: 'triangle', vol: 0.12 });
        round.shake = Math.max(round.shake, 0.03);
      }
      const brick = game.bricks.find((b) => Math.abs(b.x + b.w / 2 - effect.x) < 0.5 && Math.abs(b.y + b.h / 2 - effect.y) < 0.5);
      if (brick) round.flashes.set(brick, 0.14);
    } else if (effect.type === 'paddle') {
      round.squash = 0.16;
      sfx.play('blip', 0.75 + Math.min(game.rally, 20) * 0.012);
    } else if (effect.type === 'wall') {
      round.glows.push({ x: effect.x, y: effect.y, life: 0.25 });
      sfx.tone({ freq: 300, dur: 0.035, type: 'square', vol: 0.035 });
    } else if (effect.type === 'power') {
      sfx.play('coin');
      const tint = POWER_COLORS[effect.value];
      shatter(round.shards, effect.x, effect.y, game.paddle.width, game.paddle.height, tint);
      round.popups.push({ x: effect.x, y: effect.y - 26, text: POWER_NAMES[effect.value], tint, life: 1.1 });
    } else if (effect.type === 'launch') sfx.play('jump');
    else if (effect.type === 'clear') {
      sfx.play('win');
      round.shake = 0.12;
    } else if (effect.type === 'life') {
      sfx.play('lose');
      round.shake = 0.3;
      round.hurt = 0.6;
    }
  }
  for (const ball of game.balls) {
    if (ball.attached) {
      round.trails.delete(ball);
      continue;
    }
    let trail = round.trails.get(ball);
    if (!trail) round.trails.set(ball, (trail = []));
    trail.push(ball.x, ball.y);
    if (trail.length > 16) trail.splice(0, trail.length - 16);
  }
}

function tick(round: Round, dt: number) {
  round.shards = round.shards.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 520 * dt;
    p.a += p.spin * dt;
    return p.life > 0;
  });
  if (round.shards.length > 260) round.shards.splice(0, round.shards.length - 260);
  round.popups = round.popups.filter((p) => (p.life -= dt) > 0);
  round.glows = round.glows.filter((g) => (g.life -= dt) > 0);
  round.shake = Math.max(0, round.shake - dt);
  round.squash = Math.max(0, round.squash - dt);
  round.hurt = Math.max(0, round.hurt - dt);
}

function shatter(shards: Shard[], x: number, y: number, w: number, h: number, tint: string) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    shards.push({
      x: x + (Math.random() - 0.5) * w * 0.8,
      y: y + (Math.random() - 0.5) * h * 0.6,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 90,
      spin: (Math.random() - 0.5) * 14,
      a: Math.random() * Math.PI,
      size: 3 + Math.random() * 4,
      life: 0.45 + Math.random() * 0.35,
      max: 0.8,
      tint,
    });
  }
}

function draw(c: CanvasRenderingContext2D | null, w: number, h: number, fit: Fit, round: Round, playing: boolean, touch: boolean) {
  if (!c || w <= 0 || h <= 0) return;
  const game = round.game;
  const s = fit.scale || 1;
  const u = round.u;
  c.clearRect(0, 0, w, h);
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#15131f');
  bg.addColorStop(1, '#09090e');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const halo = c.createRadialGradient(w / 2, fit.y + game.top * s, 0, w / 2, fit.y + game.top * s, Math.max(w, h) * 0.7);
  halo.addColorStop(0, 'rgba(255,159,10,0.10)');
  halo.addColorStop(0.5, 'rgba(94,92,230,0.05)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = halo;
  c.fillRect(0, 0, w, h);

  c.save();
  if (round.shake > 0 && playing) {
    const amp = Math.min(4, round.shake * 18);
    c.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
  }
  c.translate(fit.x, fit.y);
  c.scale(s, s);
  const px = 1 / s;
  const W = game.width;
  const H = game.height;

  // Walls: left, top and right; the bottom is open.
  c.fillStyle = 'rgba(255,255,255,0.025)';
  c.beginPath();
  c.roundRect(0, 0, W, H, [14, 14, 0, 0]);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = px;
  c.beginPath();
  c.moveTo(0.5 * px, H);
  c.lineTo(0.5 * px, 14);
  c.arcTo(0.5 * px, 0.5 * px, 14, 0.5 * px, 14);
  c.lineTo(W - 14, 0.5 * px);
  c.arcTo(W - 0.5 * px, 0.5 * px, W - 0.5 * px, 14, 14);
  c.lineTo(W - 0.5 * px, H);
  c.stroke();
  for (const g of round.glows) {
    const r = 28;
    const grad = c.createRadialGradient(g.x, g.y, 0, g.x, g.y, r);
    grad.addColorStop(0, `rgba(255,255,255,${(g.life / 0.25) * 0.3})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.fillRect(g.x - r, g.y - r, r * 2, r * 2);
  }
  if (round.hurt > 0 && playing) {
    const grad = c.createLinearGradient(0, H, 0, H * 0.6);
    grad.addColorStop(0, `rgba(255,55,95,${(round.hurt / 0.6) * 0.45})`);
    grad.addColorStop(1, 'rgba(255,55,95,0)');
    c.fillStyle = grad;
    c.fillRect(0, H * 0.6, W, H * 0.4);
  }

  // Bricks drop in row by row at the start of each level.
  const since = game.time - game.levelStart;
  for (const brick of game.bricks) {
    const t = Math.max(0, Math.min(1, (since - brick.row * 0.06 - brick.col * 0.015) / 0.32));
    if (t <= 0) continue;
    const e = 1 - Math.pow(1 - t, 3);
    const y = brick.y - (1 - e) * 26;
    const color = brickColor(brick);
    c.fillStyle = color;
    c.globalAlpha = e * 0.16;
    c.beginPath();
    c.roundRect(brick.x - 3, y - 3, brick.w + 6, brick.h + 6, 8);
    c.fill();
    c.globalAlpha = e * (brick.hp < brick.maxHp ? 0.78 : 1);
    c.beginPath();
    c.roundRect(brick.x, y, brick.w, brick.h, Math.min(6, brick.h * 0.32));
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.fillRect(brick.x, y, brick.w, brick.h * 0.38);
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.fillRect(brick.x, y + brick.h * 0.72, brick.w, brick.h * 0.28);
    if (brick.maxHp > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 1.5 * px;
      c.strokeRect(brick.x + 3, y + 3, brick.w - 6, brick.h - 6);
    }
    if (brick.hp < brick.maxHp) {
      c.strokeStyle = 'rgba(20,16,24,0.6)';
      c.lineWidth = 1.4 * px;
      c.beginPath();
      const cx = brick.x + brick.w * (0.3 + (brick.col % 3) * 0.18);
      c.moveTo(cx, y);
      c.lineTo(cx + brick.w * 0.06, y + brick.h * 0.45);
      c.lineTo(cx - brick.w * 0.04, y + brick.h);
      if (brick.maxHp - brick.hp > 1) {
        c.moveTo(cx + brick.w * 0.06, y + brick.h * 0.45);
        c.lineTo(cx + brick.w * 0.22, y + brick.h * 0.6);
      }
      c.stroke();
    }
    const flash = round.flashes.get(brick) ?? 0;
    if (flash > 0) {
      c.fillStyle = `rgba(255,255,255,${flash / 0.14 * 0.7})`;
      c.fillRect(brick.x, y, brick.w, brick.h);
      round.flashes.set(brick, flash - 1 / 60);
    }
    c.restore();
  }
  c.globalAlpha = 1;

  for (const drop of game.drops) {
    const color = POWER_COLORS[drop.kind];
    const dw = Math.max(30, 22 / s);
    const dh = dw * 0.52;
    c.fillStyle = color;
    c.globalAlpha = 0.22;
    c.beginPath();
    c.roundRect(drop.x - dw / 2 - 4, drop.y - dh / 2 - 4, dw + 8, dh + 8, dh);
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.roundRect(drop.x - dw / 2, drop.y - dh / 2, dw, dh, dh / 2);
    c.fill();
    c.fillStyle = '#101016';
    c.strokeStyle = '#101016';
    c.lineWidth = dh * 0.14;
    if (drop.kind === 'wide') {
      c.beginPath();
      c.roundRect(drop.x - dw * 0.3, drop.y - dh * 0.1, dw * 0.6, dh * 0.2, dh * 0.1);
      c.fill();
    } else if (drop.kind === 'multi') {
      for (const off of [-0.22, 0, 0.22]) {
        c.beginPath();
        c.arc(drop.x + dw * off, drop.y, dh * 0.13, 0, Math.PI * 2);
        c.fill();
      }
    } else {
      c.beginPath();
      c.arc(drop.x, drop.y, dh * 0.26, 0, Math.PI * 2);
      c.moveTo(drop.x, drop.y);
      c.lineTo(drop.x, drop.y - dh * 0.17);
      c.moveTo(drop.x, drop.y);
      c.lineTo(drop.x + dh * 0.12, drop.y);
      c.stroke();
    }
  }

  const paddle = game.paddle;
  const wide = game.time < game.wideUntil;
  const squash = round.squash > 0 ? 1 - Math.sin((round.squash / 0.16) * Math.PI) * 0.22 : 1;
  const ph = paddle.height * squash;
  const pw = paddle.width * (1 + (1 - squash) * 0.25);
  const glowColor = wide ? 'rgba(48,209,88,0.28)' : 'rgba(255,159,10,0.22)';
  c.fillStyle = glowColor;
  c.beginPath();
  c.roundRect(paddle.x - pw / 2 - 5, paddle.y - ph / 2 - 5, pw + 10, ph + 10, ph);
  c.fill();
  const body = c.createLinearGradient(0, paddle.y - ph / 2, 0, paddle.y + ph / 2);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#b9bcc6');
  c.fillStyle = body;
  c.beginPath();
  c.roundRect(paddle.x - pw / 2, paddle.y - ph / 2, pw, ph, ph / 2);
  c.fill();
  c.fillStyle = wide ? '#30d158' : '#ff9f0a';
  c.beginPath();
  c.roundRect(paddle.x - pw * 0.18, paddle.y + ph * 0.08, pw * 0.36, ph * 0.22, ph * 0.11);
  c.fill();

  const ballTint = game.slowActive ? '100,210,255' : '255,255,255';
  for (const ball of game.balls) {
    const trail = round.trails.get(ball);
    if (trail) {
      const n = trail.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const k = (i + 1) / n;
        c.fillStyle = `rgba(${ballTint},${k * 0.22})`;
        c.beginPath();
        c.arc(trail[i * 2], trail[i * 2 + 1], ball.r * (0.35 + k * 0.6), 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = `rgba(${ballTint},0.18)`;
    c.beginPath();
    c.arc(ball.x, ball.y, ball.r * 2.1, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = game.slowActive ? '#a6e6ff' : '#ffffff';
    c.beginPath();
    c.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    c.fill();
  }

  for (const p of round.shards) {
    c.globalAlpha = Math.max(0, Math.min(1, p.life / 0.35));
    c.fillStyle = p.tint;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.a);
    c.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
    c.restore();
  }
  c.globalAlpha = 1;
  c.restore();

  // Screen-space text, sized in CSS pixels (and grown inside a scaled phone or iPad frame).
  const toX = (x: number) => fit.x + x * s;
  const toY = (y: number) => fit.y + y * s;
  for (const p of round.popups) {
    const t = p.life;
    c.globalAlpha = Math.min(1, t * 3);
    c.fillStyle = p.tint;
    c.font = `650 ${Math.round(13 * u)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(p.text, toX(p.x), toY(p.y) - (1.1 - t) * 26 * u);
  }
  c.globalAlpha = 1;

  drawHud(c, h, round, u);

  const waiting = game.balls.some((b) => b.attached) && game.levelBanner <= 0 && !game.ended;
  if (waiting && playing) {
    const lowest = game.bricks.reduce((m, b) => Math.max(m, b.y + b.h), game.top);
    const y = toY(paddle.y - (paddle.y - lowest) * 0.42);
    c.globalAlpha = 0.6 + Math.sin(performance.now() / 260) * 0.25;
    c.fillStyle = '#f5f5f7';
    c.font = `600 ${Math.round(14 * u)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(touch ? 'Slide to move. Tap to launch.' : 'Click or press Space to launch', w / 2, y);
    c.globalAlpha = 1;
  }

  if (game.levelBanner > 0) {
    const t = game.levelBanner;
    const fade = Math.min(1, (1.6 - t) / 0.2, t / 0.3);
    c.fillStyle = `rgba(8,8,12,${0.5 * fade})`;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = fade;
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const big = Math.round(Math.max(22, Math.min(40, h * 0.12)) * u);
    const pop = 1 + Math.max(0, (t - 1.3) / 0.3) * 0.15;
    c.font = `700 ${Math.round(big * pop)}px ${FONT}`;
    c.fillText(`Level ${game.level + 1}`, w / 2, h / 2 - big * 0.25);
    c.fillStyle = '#ffd60a';
    c.font = `600 ${Math.round(13 * u)}px ${FONT}`;
    c.fillText('Wall cleared, +100', w / 2, h / 2 + big * 0.6);
    c.globalAlpha = 1;
  }
}

function drawHud(c: CanvasRenderingContext2D, h: number, round: Round, u: number) {
  const game = round.game;
  const parts: { text: string; tint: string }[] = [{ text: `Level ${game.level}`, tint: 'rgba(245,245,247,0.82)' }];
  if (game.time < game.wideUntil) parts.push({ text: `Wide ${Math.ceil(game.wideUntil - game.time)}`, tint: POWER_COLORS.wide });
  if (game.slowActive) parts.push({ text: `Slow ${Math.ceil(game.slowUntil - game.time)}`, tint: POWER_COLORS.slow });
  const size = Math.round(12 * u);
  c.font = `600 ${size}px ${FONT}`;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const gap = 10 * u;
  const pip = 5 * u;
  const pips = Math.max(0, game.lives);
  const widths = parts.map((p) => c.measureText(p.text).width);
  const pipW = pips ? pips * pip * 2 + (pips - 1) * 4 * u : 0;
  const total = widths.reduce((a, b) => a + b, 0) + gap * parts.length + pipW;
  const y = round.hud.mode === 'top' ? 24 : h - 13 * u;
  let x = round.hud.x - total / 2;
  parts.forEach((p, i) => {
    c.fillStyle = p.tint;
    c.fillText(p.text, x, y);
    x += widths[i] + gap;
  });
  c.fillStyle = '#ff375f';
  for (let i = 0; i < pips; i++) {
    c.beginPath();
    c.roundRect(x, y - pip * 0.55, pip * 2, pip * 1.1, pip * 0.55);
    c.fill();
    x += pip * 2 + 4 * u;
  }
}
