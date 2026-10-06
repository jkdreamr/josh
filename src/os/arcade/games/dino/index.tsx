import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { cactus, cloud, dino, flyer, hash, mix, moon, type Pose } from './draw';
import { DINO_X, createState, isNight, pad, step, type Obstacle } from './logic';
import { meta } from './meta';
import './dino.css';

const DAY = { bg: '#f7f7f8', strip: '#f1f3f4', ink: '#4a4a50' };
const NIGHT = { bg: '#121216', ink: '#dedee3' };
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const UI = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number };
type Cloud = { x: number; y: number; s: number };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

const isTyping = (el: Element | null) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const { best } = useHighScore(meta.id);
  const s = useRef({
    world: createState(600),
    hopped: false,
    deadT: -1,
    over: false,
    shake: 0,
    squash: 1,
    flash: 0,
    flashValue: 0,
    nightT: 0,
    blink: false,
    blinkT: 2.5,
    hint: 3.2,
    t: 0,
    particles: [] as Particle[],
    clouds: [] as Cloud[],
    cleared: new WeakSet<Obstacle>(),
    clearedN: 0,
    ptr: { id: -1, y: 0, jump: false, duck: false },
  }).current;
  const { compact, status, touch } = shell;

  // Strip only: space starts the run when the New Tab page itself has focus (never while typing in the search box).
  useEffect(() => {
    if (!compact) return;
    const root = shell.root.current;
    if (!root) return;
    const page = root.closest('.newtab') ?? root.parentElement;
    const onDoc = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const a = document.activeElement;
      if (isTyping(a) || (a && a !== document.body && !page?.contains(a))) return;
      if (a && a !== document.body && a.closest('button, a') && !root.contains(a)) return;
      const win = root.closest('.win');
      if (win && !win.classList.contains('is-active')) return;
      if (!shell.active) return;
      e.preventDefault();
      if (status === 'ready') shell.start();
      else if (status === 'over') shell.restart();
      else if (status === 'paused') shell.resume();
    };
    // Focus inside the strip: the shell handles start and retry, but space should also resume a paused strip.
    const onRoot = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && status === 'paused') {
        e.preventDefault();
        shell.resume();
      }
    };
    document.addEventListener('keydown', onDoc);
    root.addEventListener('keydown', onRoot);
    return () => {
      document.removeEventListener('keydown', onDoc);
      root.removeEventListener('keydown', onRoot);
    };
  }, [compact, status, shell]);

  // Idle strip: blink now and then without running a frame loop.
  useEffect(() => {
    if (!compact || status !== 'ready') return;
    let off = 0;
    const on = window.setInterval(() => {
      s.blink = true;
      shell.invalidate();
      off = window.setTimeout(() => {
        s.blink = false;
        shell.invalidate();
      }, 150);
    }, 4200);
    return () => {
      window.clearInterval(on);
      window.clearTimeout(off);
    };
  }, [compact, status, shell, s]);

  useEffect(() => {
    shell.setScore(null);
  }, [shell]);

  const layout = () => {
    const { w, h } = size;
    const k = compact ? Math.min(h / 165, w / 440) : Math.min(2.3, Math.max(0.6, Math.min(h / 190, w / 440)));
    const ground = compact ? h - 18 : Math.round(h * 0.5 + 58 * k);
    return { w, h, k, ground, viewW: w / k };
  };

  const dust = (x: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++)
      s.particles.push({ x: x + Math.random() * 12, y: 1, vx: -40 - Math.random() * spread, vy: 20 + Math.random() * 50, life: 0, max: 0.35 + Math.random() * 0.25, r: 1 + Math.random() * 1.6 });
  };

  useGameLoop(
    (dt) => {
      const { viewW } = layout();
      const w = s.world;
      w.viewW = viewW;
      s.t += dt;
      if (s.clouds.length === 0)
        for (let i = 0; i < 4; i++) s.clouds.push({ x: (viewW / 4) * i + Math.random() * 60, y: 95 + Math.random() * 45, s: 0.8 + Math.random() * 0.5 });

      if (!s.hopped) {
        s.hopped = true;
        w.vy = 520;
        w.ground = false;
        w.holding = true;
        w.air = 0;
        sfx.play('jump');
      }

      if (s.deadT >= 0) {
        s.deadT += dt;
        if (s.deadT > 0.55 && !s.over) {
          s.over = true;
          const n = s.clearedN;
          shell.gameOver(Math.floor(w.score), {
            detail: isNight(w.score) ? `you made it into the night and cleared ${n} obstacles.` : `you cleared ${n} ${n === 1 ? 'obstacle' : 'obstacles'}.`,
          });
        }
      } else {
        const input = {
          jump: keys.down('action', 'up') || s.ptr.jump,
          duck: keys.down('down') || s.ptr.duck,
        };
        const wasAir = !w.ground;
        const ev = step(w, dt, input, Math.random);
        if (ev.jumped) sfx.play('jump');
        if (ev.landed && wasAir) {
          s.squash = 0.86;
          dust(DINO_X + 6, 5, 60);
        }
        if (ev.milestone) {
          s.flash = 1.1;
          s.flashValue = ev.milestone;
          sfx.tone({ freq: 880, dur: 0.07, type: 'triangle', vol: 0.12 });
          sfx.tone({ freq: 1320, dur: 0.12, type: 'triangle', vol: 0.12, delay: 0.07 });
        }
        for (const o of w.obstacles)
          if (o.x + o.w < DINO_X && !s.cleared.has(o)) {
            s.cleared.add(o);
            s.clearedN++;
          }
        if (ev.crashed) {
          s.deadT = 0;
          s.shake = 1;
          sfx.play('hit');
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 60 + Math.random() * 120;
            s.particles.push({ x: DINO_X + 30, y: w.y + 24, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.3, r: 1.2 + Math.random() * 1.8 });
          }
        }
        if (w.ground && !w.ducking && w.speed > 520 && Math.random() < dt * 9) dust(DINO_X + 4, 1, 40);
        for (const c of s.clouds) {
          c.x -= w.speed * 0.12 * dt;
          if (c.x < -60) {
            c.x = viewW + Math.random() * 120;
            c.y = 95 + Math.random() * 45;
            c.s = 0.8 + Math.random() * 0.5;
          }
        }
      }
      for (const p of s.particles) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 260 * dt;
      }
      s.particles = s.particles.filter((p) => p.life < p.max && p.y > -4);
      s.squash += (1 - s.squash) * Math.min(1, dt * 14);
      s.shake = Math.max(0, s.shake - dt * 3.2);
      s.flash = Math.max(0, s.flash - dt);
      s.hint = Math.max(0, s.hint - dt);
      const night = isNight(w.score) ? 1 : 0;
      s.nightT += (night - s.nightT) * Math.min(1, dt * 2.2);
      if (Math.abs(night - s.nightT) < 0.002) s.nightT = night;
      s.blinkT -= dt;
      if (s.blinkT < 0) {
        s.blink = !s.blink;
        s.blinkT = s.blink ? 0.12 : 2.5 + Math.random() * 3;
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w: W, h: H, k, ground } = layout();
      if (!W || !H) return;
      const w = s.world;
      const n = s.nightT;
      const bg = mix(compact ? DAY.strip : DAY.bg, NIGHT.bg, n);
      const ink = mix(DAY.ink, NIGHT.ink, n);
      const bgHex = n > 0.5 ? NIGHT.bg : compact ? DAY.strip : DAY.bg;

      c.save();
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);
      if (s.shake > 0) c.translate((Math.random() - 0.5) * s.shake * 5, (Math.random() - 0.5) * s.shake * 3);

      const X = (x: number) => x * k;
      const Y = (y: number) => ground - y * k;

      // night sky
      if (n > 0.01) {
        c.fillStyle = NIGHT.ink;
        for (let i = 0; i < 26; i++) {
          const hx = hash(i * 31 + 7);
          const sx = (((hx % 1000) / 1000) * W - w.distance * 0.01 * k + W * 4) % W;
          const sy = 8 + ((hx >> 10) % 1000) / 1000 * Math.max(10, ground - 60 * k - 8);
          const tw = 0.5 + 0.5 * Math.sin(s.t * (1 + (hx % 5) * 0.4) + i);
          c.globalAlpha = n * (0.35 + tw * 0.55);
          c.beginPath();
          c.arc(sx, sy, ((hx >> 20) % 3 === 0 ? 1.3 : 0.8) * Math.max(1, k * 0.8), 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = n;
        const phase = Math.floor(w.score / 1400);
        moon(c, W * (0.78 - (phase % 4) * 0.12), Math.max(18, ground - 118 * k), Math.max(7, 10 * k), bg, 'rgba(222,222,227,0.35)');
        c.globalAlpha = 1;
      }

      // clouds
      c.fillStyle = ink;
      c.globalAlpha = 0.09 + n * 0.04;
      for (const cl of s.clouds) cloud(c, X(cl.x), Y(cl.y), cl.s * k);
      c.globalAlpha = 1;

      // ground line and pebbles
      c.fillStyle = ink;
      c.fillRect(0, ground - Math.max(1, k * 0.9) / 2, W, Math.max(1, k * 0.9));
      const gap = 21;
      const first = Math.floor(w.distance / gap);
      const count = Math.ceil(W / k / gap) + 2;
      c.globalAlpha = 0.55;
      for (let i = first; i < first + count; i++) {
        const hv = hash(i);
        const px = i * gap + (hv % gap) - w.distance;
        const py = 3 + ((hv >> 8) % 8);
        const len = 1 + ((hv >> 16) % 4);
        c.fillRect(X(px), ground + py * k * 0.8, len * k, Math.max(1, k * 0.8));
        if ((hv >> 24) % 9 === 0) c.fillRect(X(px + 6), ground - k * 1.6, 3 * k, k * 1.6);
      }
      c.globalAlpha = 1;

      // obstacles
      for (const o of w.obstacles) {
        c.save();
        c.translate(X(o.x), Y(o.y));
        c.scale(k, k);
        if (o.kind === 'flyer') flyer(c, s.t + (o.seed % 7), ink, bg);
        else cactus(c, o, ink, bg);
        c.restore();
      }

      // dino
      const dead = s.deadT >= 0;
      const pose: Pose = {
        kind: dead ? 'dead' : status === 'ready' ? 'stand' : !w.ground ? 'air' : w.ducking ? 'duck' : 'run',
        phase: w.distance / 9,
        blink: s.blink && !dead,
        tilt: !w.ground && !dead ? Math.max(-0.12, Math.min(0.12, -w.vy / 5000)) : 0,
        squash: s.squash,
      };
      c.save();
      c.translate(X(DINO_X), Y(w.y));
      c.scale(k, k);
      dino(c, ink, bgHex, pose);
      c.restore();

      // particles
      c.fillStyle = ink;
      for (const p of s.particles) {
        c.globalAlpha = Math.max(0, 1 - p.life / p.max) * 0.6;
        c.beginPath();
        c.arc(X(p.x), Y(p.y), p.r * k, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.restore();

      // score
      const score = Math.floor(w.score);
      const blinkOff = s.flash > 0 && Math.floor(s.flash * 8) % 2 === 1;
      const shown = s.flash > 0 ? s.flashValue : score;
      const hi = Math.max(best ?? 0, dead ? score : 0);
      const fs = compact ? 12 : Math.round(Math.max(13, Math.min(18, 11 + k * 2.4)));
      c.font = `600 ${fs}px ${FONT}`;
      c.textBaseline = 'middle';
      const sy = compact ? 15 : 28;
      const parts: [string, number][] = [];
      if (hi > 0) parts.push([`HI ${pad(hi)}`, 0.5]);
      if (status !== 'ready') parts.push([pad(shown), blinkOff ? 0 : 1]);
      if (compact) {
        c.textAlign = 'right';
        let x = W - 14;
        for (const [txt, a] of [...parts].reverse()) {
          c.globalAlpha = a;
          c.fillStyle = ink;
          c.fillText(txt, x, sy);
          x -= c.measureText(txt).width + 12;
        }
      } else {
        c.textAlign = 'left';
        let x = 18;
        for (const [txt, a] of parts) {
          c.globalAlpha = a;
          c.fillStyle = ink;
          if (a && s.flash > 0 && txt === pad(shown)) {
            const pop = 1 + Math.max(0, s.flash - 0.85) * 0.6;
            c.save();
            c.translate(x, sy);
            c.scale(pop, pop);
            c.fillText(txt, 0, 0);
            c.restore();
          } else c.fillText(txt, x, sy);
          x += c.measureText(txt).width + 14;
        }
      }
      c.globalAlpha = 1;

      // strip prompts, drawn here instead of the shell's overlay
      if (compact && status !== 'playing') {
        const msg =
          status === 'ready'
            ? touch
              ? 'tap to play'
              : 'press space or tap to play'
            : status === 'paused'
              ? touch
                ? 'paused · tap to resume'
                : 'paused · press space or tap to resume'
              : touch
                ? 'game over · tap to retry'
                : 'game over · press space or tap to retry';
        c.font = `500 13px ${UI}`;
        c.textAlign = 'center';
        c.fillStyle = ink;
        c.globalAlpha = 0.72;
        const cx = Math.max(W / 2, X(DINO_X + 60) + c.measureText(msg).width / 2);
        c.fillText(msg, Math.min(cx, W - 14 - c.measureText(msg).width / 2), H / 2 - 4);
        c.globalAlpha = 1;
      }

      if (!compact && touch && status === 'playing' && s.hint > 0) {
        c.font = `500 13px ${UI}`;
        c.textAlign = 'center';
        c.fillStyle = ink;
        c.globalAlpha = Math.min(1, s.hint) * 0.6;
        c.fillText('tap to jump · swipe down to duck', W / 2, Math.min(H - 40, ground + 46));
        c.globalAlpha = 1;
      }
    },
  );

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (status !== 'playing') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    s.ptr = { id: e.pointerId, y: e.clientY, jump: true, duck: false };
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== s.ptr.id) return;
    if (e.clientY - s.ptr.y > 22) {
      s.ptr.duck = true;
      s.ptr.jump = false;
    }
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== s.ptr.id) return;
    s.ptr = { id: -1, y: 0, jump: false, duck: false };
  };

  return (
    <canvas
      ref={ref}
      className="g-dino-canvas"
      aria-label={`dino run, score ${Math.floor(s.world.score)}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
    />
  );
}
