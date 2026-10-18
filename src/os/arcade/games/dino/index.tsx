import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { cactus, cloud, dino, dunes, flyer, hash, mesas, mix, moon, sun, tuft, type Pose } from './draw';
import { DINO_X, courseSeed, createState, isNight, rng32, step, type Obstacle } from './logic';
import { meta } from './meta';
import './dino.css';

const DAY = { bg: '#f7f7f8', strip: '#f1f3f4', ink: '#4a4a50' };
const NIGHT = { bg: '#121216', ink: '#dedee3' };
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

/** Draws text with every digit on the width of a zero, so a climbing score never shifts what follows it. */
function drawNum(c: CanvasRenderingContext2D, txt: string, x: number, y: number) {
  const zero = c.measureText('0').width;
  c.textAlign = 'left';
  for (const ch of txt) {
    if (ch >= '0' && ch <= '9') {
      c.fillText(ch, x + (zero - c.measureText(ch).width) / 2, y);
      x += zero;
    } else {
      c.fillText(ch, x, y);
      x += c.measureText(ch).width;
    }
  }
}
function numWidth(c: CanvasRenderingContext2D, txt: string) {
  const zero = c.measureText('0').width;
  let wd = 0;
  for (const ch of txt) wd += ch >= '0' && ch <= '9' ? zero : c.measureText(ch).width;
  return wd;
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
    duckBtn: -1,
    course: null as (() => number) | null,
    topped: false,
    toast: 0,
  }).current;
  const { compact, status, touch } = shell;
  const online = useOnline();
  const [night, setNight] = useState(false);

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
    // At least ~500 world units of road ahead on narrow screens, so top speed still leaves time to react.
    const k = compact ? Math.min(h / 165, w / 440) : Math.min(2.3, Math.max(0.6, Math.min(h / 190, w / 500)));
    const ground = compact ? h - 18 : Math.round(h * 0.5 + 58 * k);
    return { w, h, k, ground, viewW: w / k };
  };
  /** How far above the lowest cloud line clouds may drift, in world units: more sky on tall screens. */
  const cloudTop = () => {
    const { ground, k } = layout();
    return k > 0 ? Math.max(45, Math.min(260, ground / k - 150)) : 45;
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
      const skyTop = cloudTop();
      if (s.clouds.length === 0)
        for (let i = 0; i < 4; i++) s.clouds.push({ x: (viewW / 4) * i + Math.random() * 60, y: 95 + Math.random() * skyTop, s: 0.8 + Math.random() * 0.5 });
      // Online, everyone in the room races the same course: obstacles come from a seed the round and roster share.
      if (!s.course) s.course = online ? rng32(courseSeed(online.round, online.players.map((p) => p.name))) : Math.random;

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
            detail: isNight(w.score) ? `You made it into the night and cleared ${n} obstacles.` : `You cleared ${n} ${n === 1 ? 'obstacle' : 'obstacles'}.`,
          });
        }
      } else {
        const input = {
          jump: keys.down('action', 'up') || s.ptr.jump,
          duck: keys.down('down') || s.ptr.duck || s.duckBtn >= 0,
        };
        const wasAir = !w.ground;
        const ev = step(w, dt, input, s.course);
        if (ev.jumped) {
          sfx.play('jump');
          s.squash = 1.1;
          dust(DINO_X + 8, 3, 30);
        }
        if (ev.night !== null) setNight(ev.night);
        if (!s.topped && best && best > 0 && w.score > best) {
          s.topped = true;
          s.toast = 1.8;
          sfx.tone({ freq: 988, dur: 0.08, type: 'square', vol: 0.06 });
          sfx.tone({ freq: 1319, dur: 0.08, type: 'square', vol: 0.06, delay: 0.08 });
          sfx.tone({ freq: 1976, dur: 0.16, type: 'square', vol: 0.06, delay: 0.16 });
        }
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
            c.y = 95 + Math.random() * skyTop;
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
      s.toast = Math.max(0, s.toast - dt);
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

      // sun by day, moon and stars by night, kept clear of the control row at the top right
      const skyY = Math.max(compact ? 22 : 64, ground - Math.min(170, cloudTop() + 120) * k);
      if (n < 0.99 && !compact) {
        c.fillStyle = ink;
        c.globalAlpha = 0.06 * (1 - n);
        sun(c, W * 0.66, skyY, Math.max(10, 13 * k));
        c.globalAlpha = 1;
      }
      if (n > 0.01) {
        c.fillStyle = NIGHT.ink;
        for (let i = 0; i < 34; i++) {
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
        moon(c, W * (0.62 - (phase % 4) * 0.1), compact ? Math.max(18, ground - 118 * k) : skyY, Math.max(8, 11 * k), bg, 'rgba(222,222,227,0.35)');
        c.globalAlpha = 1;
      }

      // far mesas and near dunes, scrolling slower than the road
      c.fillStyle = ink;
      c.globalAlpha = (compact ? 0.035 : 0.05) + n * 0.03;
      mesas(c, W, ground, k, w.distance * 0.06, 150, compact ? 34 : 58, 3);
      c.globalAlpha = (compact ? 0.05 : 0.07) + n * 0.03;
      dunes(c, W, ground, k, w.distance * 0.2, 90, compact ? 9 : 16, 11);
      c.globalAlpha = 1;

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
      // the desert floor below the road: a faint fill and a few rocks and tufts that pass a little faster than the road
      const floor = H - ground;
      if (!compact && floor > 30 * k) {
        c.globalAlpha = 0.03 + n * 0.02;
        c.fillRect(0, ground, W, floor);
        const rows = Math.min(4, Math.floor(floor / (26 * k)));
        for (let r = 1; r <= rows; r++) {
          const depth = 1 + r * 0.18;
          const cell = 70 + r * 23;
          const scroll = w.distance * depth;
          const y0 = ground + r * 22 * k * (1 + r * 0.1);
          const firstT = Math.floor(scroll / cell) - 1;
          const nT = Math.ceil(W / k / cell) + 2;
          c.globalAlpha = (0.16 + r * 0.02) * (1 - r * 0.12);
          for (let i = firstT; i < firstT + nT; i++) {
            const hv = hash(i * 977 + r * 13);
            if (hv % 3 === 0) continue;
            const tx = X(i * cell + (hv >> 3) % cell - scroll);
            const ty = y0 + (((hv >> 9) % 10) - 5) * k;
            if ((hv >> 14) % 2) {
              c.save();
              c.translate(tx, ty);
              tuft(c, k * (0.8 + r * 0.15));
              c.restore();
            } else {
              c.beginPath();
              c.ellipse(tx, ty, (2 + ((hv >> 16) % 3)) * k, 1.2 * k, 0, 0, Math.PI * 2);
              c.fill();
            }
          }
        }
        c.globalAlpha = 1;
      }

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

      // score: the run on the left in bold, your best beside it, digits on a fixed advance so nothing jitters
      const score = Math.floor(w.score);
      const blinkOff = s.flash > 0 && Math.floor(s.flash * 8) % 2 === 1;
      const shown = s.flash > 0 ? s.flashValue : score;
      const hi = Math.max(best ?? 0, dead ? score : 0);
      const fs = compact ? (touch ? 14 : 13) : Math.round(Math.max(14, Math.min(20, 11 + k * 2.6)));
      const sy = compact ? 15 : 28;
      c.textBaseline = 'middle';
      c.fillStyle = ink;
      const parts: { txt: string; a: number; bold: boolean; pop: number }[] = [];
      if (status !== 'ready') parts.push({ txt: String(shown), a: blinkOff ? 0 : 1, bold: true, pop: s.flash > 0 ? 1 + Math.max(0, s.flash - 0.85) * 0.6 : 1 });
      // once this run passes your best, the run is the best: drop the stale number and let the toast say so
      if (hi > 0 && (dead || !best || score <= best)) parts.push({ txt: `Best ${hi}`, a: 0.5, bold: false, pop: 1 });
      const widthOf = (p: (typeof parts)[number]) => {
        c.font = `${p.bold ? 700 : 500} ${fs}px ${UI}`;
        return numWidth(c, p.txt);
      };
      let x = compact ? W - 14 - parts.reduce((t, p, i) => t + widthOf(p) + (i ? 12 : 0), 0) : 18;
      for (const p of parts) {
        const pw = widthOf(p);
        c.globalAlpha = p.a;
        c.save();
        c.translate(x, sy);
        c.scale(p.pop, p.pop);
        drawNum(c, p.txt, 0, 0);
        c.restore();
        x += pw + (compact ? 12 : 16);
      }
      c.globalAlpha = 1;
      if (s.toast > 0 && !compact) {
        c.font = `600 ${Math.max(14, fs - 2)}px ${UI}`;
        c.textAlign = 'left';
        c.globalAlpha = Math.min(1, s.toast * 2) * 0.8;
        c.fillText('New Best', 18, sy + fs + 4 - Math.max(0, s.toast - 1.5) * 12);
        c.globalAlpha = 1;
      }

      // strip prompts, drawn here instead of the shell's overlay
      if (compact && status !== 'playing') {
        const msg =
          status === 'ready'
            ? touch
              ? 'Tap to Play'
              : 'Press Space to Play'
            : status === 'paused'
              ? touch
                ? 'Paused · Tap to Resume'
                : 'Paused · Press Space to Resume'
              : touch
                ? 'Game Over · Tap to Play Again'
                : 'Game Over · Press Space to Play Again';
        c.font = `500 ${touch ? 14 : 13}px ${UI}`;
        c.textAlign = 'center';
        c.fillStyle = ink;
        c.globalAlpha = 0.72;
        const cx = Math.max(W / 2, X(DINO_X + 60) + c.measureText(msg).width / 2);
        c.fillText(msg, Math.min(cx, W - 14 - c.measureText(msg).width / 2), H / 2 - 4);
        c.globalAlpha = 1;
      }

      if (!compact && touch && status === 'playing' && s.hint > 0) {
        c.font = `500 14px ${UI}`;
        c.textAlign = 'center';
        c.fillStyle = ink;
        c.globalAlpha = Math.min(1, s.hint) * 0.6;
        c.fillText('Tap anywhere to jump. Hold Duck to duck.', W / 2, Math.min(H - 120, ground + 46));
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

  const duckDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    s.duckBtn = e.pointerId;
  };
  const duckUp = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.pointerId === s.duckBtn) s.duckBtn = -1;
  };
  useEffect(() => {
    if (status !== 'playing') s.duckBtn = -1;
  }, [status, s]);

  return (
    <>
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
      {touch && !compact && status === 'playing' && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={`g-dino-duck${night ? ' is-night' : ''}`}
          onPointerDown={duckDown}
          onPointerUp={duckUp}
          onPointerCancel={duckUp}
          onLostPointerCapture={duckUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          Duck
        </button>
      )}
    </>
  );
}
