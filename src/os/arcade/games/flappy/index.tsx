import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { cloud, column, conifer, dish, ground, hash, hills, medal, ridge, tree } from './draw';
import { GROUND, H, START_SPEED, createState, hover, medalFor, nextMedal, resize, step, type Medal } from './logic';
import { meta } from './meta';
import './flappy.css';

const UI = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type Leaf = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; max: number; size: number; color: string };

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
  const { ref, size, ctx } = useCanvas();
  const { best } = useHighScore(meta.id);
  const s = useRef({
    world: createState(800),
    started: false,
    idle: 0,
    t: 0,
    wing: 0,
    pop: 0,
    flash: 0,
    shake: 0,
    deadT: -1,
    over: false,
    tap: false,
    blink: false,
    blinkT: 2.2,
    toast: null as null | { medal: Exclude<Medal, 'none'>; t: number },
    leaves: [] as Leaf[],
  }).current;
  const { status, touch } = shell;

  useEffect(() => {
    shell.setScore(null);
  }, [shell]);

  const view = () => {
    const { w, h } = size;
    const k = h / H;
    return { W: w, Hc: h, k, vw: k > 0 ? w / k : 0 };
  };

  const puff = (x: number, y: number, n: number, power: number) => {
    const greens = ['#2e8e55', '#3aaa66', '#1f6f43', '#7db86d'];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.55 + Math.random() * 0.9);
      const v = power * (0.5 + Math.random());
      s.leaves.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 + 40, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, life: 0, max: 0.5 + Math.random() * 0.5, size: 2.4 + Math.random() * 2.2, color: greens[i % greens.length] });
    }
  };

  useGameLoop(
    (dt) => {
      const { vw } = view();
      if (!vw) return;
      const w = s.world;
      if (w.w !== vw) resize(w, vw);
      s.t += dt;
      const flapIn = keys.pressed('action', 'up') || s.tap;
      s.tap = false;

      if (!s.started) {
        s.idle += START_SPEED * dt;
        w.y = hover(s.t);
        w.rot = 0;
        if (flapIn) s.started = true;
      }
      if (s.started) {
        const before = w.score;
        const ev = step(w, dt, { flap: flapIn }, Math.random);
        if (ev.flapped) {
          s.wing = 1;
          sfx.tone({ freq: 460, to: 760, dur: 0.09, type: 'triangle', vol: 0.09 });
          if (Math.random() < 0.6) puff(w.birdX - 10, w.y + 6, 2, 70);
        }
        if (ev.scored) {
          s.pop = 1;
          const m = medalFor(w.score);
          if (m !== 'none' && m !== medalFor(before)) {
            s.toast = { medal: m, t: 0 };
            sfx.play('win');
          } else sfx.play('coin');
        }
        if (ev.crashed) {
          s.deadT = 0;
          s.flash = 1;
          s.shake = 1;
          sfx.play('hit');
          puff(w.birdX, w.y, 14, 160);
        }
        if (ev.landed && w.dead && s.deadT > 0.05) {
          s.shake = Math.max(s.shake, 0.5);
          sfx.tone({ freq: 140, to: 70, dur: 0.12, type: 'sine', vol: 0.12 });
        }
        if (s.deadT >= 0) {
          s.deadT += dt;
          if (!s.over && ((w.grounded && s.deadT > 0.75) || s.deadT > 2.5)) {
            s.over = true;
            const n = w.score;
            const m = medalFor(n);
            const next = nextMedal(n);
            const nextName = next === null ? '' : medalFor(next);
            const more = next === null ? 'that is the top of the tree.' : `${next - n} more for ${nextName}.`;
            shell.gameOver(n, {
              title: m === 'none' ? undefined : `${m} medal`,
              detail: `you cleared ${n} ${n === 1 ? 'column' : 'columns'}. ${more}`,
            });
          }
        }
      }

      for (const p of s.leaves) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        p.vx *= 1 - dt * 1.5;
        p.rot += p.vr * dt;
      }
      s.leaves = s.leaves.filter((p) => p.life < p.max);
      s.wing = Math.max(0, s.wing - dt * 4.5);
      s.pop = Math.max(0, s.pop - dt * 5);
      s.flash = Math.max(0, s.flash - dt * 4);
      s.shake = Math.max(0, s.shake - dt * 3);
      if (s.toast) {
        s.toast.t += dt;
        if (s.toast.t > 2) s.toast = null;
      }
      s.blinkT -= dt;
      if (s.blinkT < 0) {
        s.blink = !s.blink;
        s.blinkT = s.blink ? 0.12 : 2 + Math.random() * 3;
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { W, Hc, k, vw } = view();
      if (!W || !Hc) return;
      const w = s.world;
      const d = s.idle + w.dist;

      c.save();
      const sky = c.createLinearGradient(0, 0, 0, Hc);
      sky.addColorStop(0, '#bcdcf2');
      sky.addColorStop(0.62, '#e4f0f4');
      sky.addColorStop(1, '#f8efdf');
      c.fillStyle = sky;
      c.fillRect(0, 0, W, Hc);
      if (s.shake > 0) c.translate((Math.random() - 0.5) * s.shake * 8 * k, (Math.random() - 0.5) * s.shake * 6 * k);
      c.scale(k, k);

      // sun
      const sun = c.createRadialGradient(vw * 0.8, 110, 4, vw * 0.8, 110, 90);
      sun.addColorStop(0, 'rgba(255,248,226,0.95)');
      sun.addColorStop(0.35, 'rgba(255,240,205,0.55)');
      sun.addColorStop(1, 'rgba(255,240,205,0)');
      c.fillStyle = sun;
      c.fillRect(vw * 0.8 - 90, 20, 180, 180);

      // clouds, slowest layer
      c.fillStyle = 'rgba(255,255,255,0.85)';
      const ct = 300;
      const co = d * 0.08;
      for (let i = Math.floor(co / ct) - 1; i < Math.floor((co + vw) / ct) + 2; i++) {
        const hv = hash(i * 13 + 5);
        if (hv % 3 === 0) continue;
        cloud(c, i * ct - co + (hv % 120), 70 + ((hv >> 8) % 170), 0.7 + ((hv >> 16) % 50) / 100);
      }

      // far foothills with a dish now and then
      const fo = d * 0.18;
      hills(c, vw, fo, 445, 42, 1.3, '#c2dacb', H);
      c.fillStyle = '#f2f5f1';
      const dt0 = 900;
      for (let i = Math.floor(fo / dt0) - 1; i < Math.floor((fo + vw) / dt0) + 2; i++) {
        const x = i * dt0 + 420 - fo;
        if (x > -40 && x < vw + 40) dish(c, x, ridge(x + fo, 445, 42, 1.3) + 2, '#eef2ee');
      }

      // near hills with a row of small conifers
      const no = d * 0.42;
      hills(c, vw, no, 488, 24, 4.1, '#a3cba9', H);
      c.fillStyle = '#86b58e';
      const tt = 46;
      for (let i = Math.floor(no / tt) - 1; i < Math.floor((no + vw) / tt) + 2; i++) {
        const hv = hash(i * 7 + 1);
        if (hv % 5 < 2) continue;
        const x = i * tt - no + (hv % 20);
        conifer(c, x, ridge(x + no, 488, 24, 4.1) + 4, 18 + ((hv >> 8) % 16));
      }

      for (const col of w.cols) if (col.x < vw + 20 && col.x > -100) column(c, col.x, col.gapY, col.gap, GROUND);

      ground(c, vw, d, GROUND, H);

      for (const p of s.leaves) {
        c.save();
        c.globalAlpha = Math.max(0, 1 - p.life / p.max);
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.beginPath();
        c.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      c.save();
      c.translate(w.birdX, w.y);
      c.rotate(w.rot);
      const sq = 1 + s.wing * 0.06;
      c.scale(2 - sq, sq);
      tree(c, { wing: s.wing, blink: s.blink, dead: w.dead, t: s.t });
      c.restore();
      c.restore();

      if (s.flash > 0) {
        c.fillStyle = `rgba(255,255,255,${s.flash * 0.75})`;
        c.fillRect(0, 0, W, Hc);
      }

      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const fs = Math.round(Math.max(30, Math.min(64, Hc * 0.085)));
      if (s.started && status !== 'over' && !s.over) {
        const pop = 1 + s.pop * 0.22;
        c.save();
        c.translate(W / 2, Math.max(fs * 0.9, Hc * 0.12));
        c.scale(pop, pop);
        c.font = `700 ${fs}px ${UI}`;
        c.lineJoin = 'round';
        c.lineWidth = Math.max(4, fs * 0.12);
        c.strokeStyle = 'rgba(40,20,20,0.28)';
        c.strokeText(String(w.score), 0, 2);
        c.fillStyle = '#fff';
        c.fillText(String(w.score), 0, 0);
        c.restore();
      }

      if (status === 'playing' && !s.started) {
        const a = 0.55 + 0.25 * Math.sin(s.t * 4);
        c.font = `600 ${Math.max(13, Math.round(fs * 0.3))}px ${UI}`;
        c.fillStyle = `rgba(30,50,40,${a})`;
        c.fillText(touch ? 'tap to flap' : 'space or click to flap', W / 2, Math.min(Hc - 50 * k - 30, (w.y + 70) * k));
        if (best) {
          c.font = `500 ${Math.max(12, Math.round(fs * 0.24))}px ${UI}`;
          c.fillStyle = 'rgba(30,50,40,0.45)';
          c.fillText(`best ${best}`, W / 2, Math.min(Hc - 50 * k - 8, (w.y + 70) * k + fs * 0.45));
        }
      }

      if (s.toast) {
        const t = s.toast.t;
        const ease = t < 0.25 ? 1 - Math.pow(1 - t / 0.25, 3) : t > 1.7 ? Math.max(0, (2 - t) / 0.3) : 1;
        const label = `${s.toast.medal} medal`;
        const ts = Math.max(13, Math.round(fs * 0.3));
        c.font = `600 ${ts}px ${UI}`;
        const pw = c.measureText(label).width + ts * 3.4;
        const ph = ts * 2.4;
        const px = W / 2 - pw / 2;
        const py = Math.max(fs * 0.9, Hc * 0.12) + fs * 0.75 + (1 - ease) * -12;
        c.save();
        c.globalAlpha = ease;
        c.fillStyle = 'rgba(255,255,255,0.88)';
        c.beginPath();
        c.roundRect(px, py, pw, ph, ph / 2);
        c.fill();
        medal(c, px + ts * 1.25, py + ph / 2 + ts * 0.15, ts * 0.62, s.toast.medal);
        c.fillStyle = '#1d1d1f';
        c.textAlign = 'left';
        c.fillText(label, px + ts * 2.3, py + ph / 2 + 1);
        c.restore();
      }
    },
  );

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (status !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    s.tap = true;
  };

  return <canvas ref={ref} className="g-flappy-canvas" aria-label={`flappy tree, score ${s.world.score}`} onPointerDown={onDown} />;
}
