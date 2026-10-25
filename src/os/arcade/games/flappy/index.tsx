import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { cloud, column, conifer, dish, ground, hash, hills, medal, moon, palette, ridge, stars, tree } from './draw';
import { GROUND, H, R, START_SPEED, createState, hover, medalFor, nextMedal, resize, riseOf, rng32, step, type Medal } from './logic';
import { meta } from './meta';
import './flappy.css';

const UI = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const title = (m: string) => `${m[0].toUpperCase()}${m.slice(1)}`;
/** Columns cleared for each step of the day: golden hour at 12, sunset at 24, night at 36. */
const TOD_EVERY = 12;

/** Everyone in an online race flies the same course: a seed from the room's round and its players. */
function courseSeed(round: number, players: { seat: number; name: string }[]) {
  let h = 2166136261 ^ round;
  for (const p of [...players].sort((a, b) => a.seat - b.seat)) for (const ch of `${p.seat}:${p.name};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

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
  const online = useOnline();
  const { ref, size, ctx } = useCanvas();
  const { best } = useHighScore(meta.id);
  const s = useRef({
    world: createState(800),
    rng: online ? rng32(courseSeed(online.round, online.players)) : Math.random,
    started: false,
    idle: 0,
    t: 0,
    wing: 0,
    pop: 0,
    flash: 0,
    shake: 0,
    freeze: 0,
    tod: 0,
    deadT: -1,
    over: false,
    tap: false,
    blink: false,
    blinkT: 2.2,
    toast: null as null | { medal: Exclude<Medal, 'none'>; t: number },
    leaves: [] as Leaf[],
    rings: [] as { x: number; y: number; t: number }[],
    /** 1 / the frame's CSS scale (the iPad frame shrinks everything), so canvas text stays readable. */
    u: 1,
    /** Top-of-canvas areas the shell covers (controls, online status), in canvas pixels. */
    covers: [] as { l: number; r: number; b: number }[],
    measured: 0,
  }).current;
  const { status, touch, root, setScore } = shell;

  useEffect(() => {
    setScore(null);
  }, [setScore]);

  // Measure the frame scale again on every status change too: the iPad frame may still be scaling in at mount.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = touch && k > 0.3 && k < 0.99 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1;
        s.u = u;
        el.style.setProperty('--g-flappy-u', String(u));
        shell.invalidate();
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [root, touch, status, s, shell.invalidate]);

  const view = () => {
    const { w, h } = size;
    const k = h / H;
    return { W: w, Hc: h, k, vw: k > 0 ? w / k : 0 };
  };

  const measureCovers = () => {
    const cv = ref.current;
    const box = cv?.closest('.arcade-shell') as HTMLElement | null;
    if (!cv || !box) return;
    const out: { l: number; r: number; b: number }[] = [];
    box.querySelectorAll<HTMLElement>(':scope > .arcade-ctrl, :scope > .arcade-online-status').forEach((el) => {
      if (!el.offsetWidth) return;
      out.push({ l: el.offsetLeft - cv.offsetLeft, r: el.offsetLeft + el.offsetWidth - cv.offsetLeft, b: el.offsetTop + el.offsetHeight - cv.offsetTop });
    });
    s.covers = out;
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
      if (s.started && s.freeze > 0) s.freeze = Math.max(0, s.freeze - dt);
      else if (s.started) {
        const before = w.score;
        const ev = step(w, dt, { flap: flapIn }, s.rng);
        if (ev.flapped) {
          s.wing = 1;
          sfx.tone({ freq: 460, to: 760, dur: 0.09, type: 'triangle', vol: 0.09 });
          if (Math.random() < 0.6) puff(w.birdX - 10, w.y + 6, 2, 70);
        }
        if (ev.scored) {
          s.pop = 1;
          s.rings.push({ x: w.birdX, y: w.y, t: 0 });
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
          s.freeze = 0.09;
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
            const more = next === null ? 'That is the top of the tree.' : `${next - n} more for ${title(medalFor(next))}.`;
            shell.gameOver(n, {
              title: m === 'none' ? undefined : `${title(m)} Medal`,
              detail: `You cleared ${n} ${n === 1 ? 'column' : 'columns'}. ${more}`,
            });
          }
        }
      }
      s.tod += (Math.min(3, w.score / TOD_EVERY) - s.tod) * Math.min(1, dt * 0.8);

      for (const p of s.leaves) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        p.vx *= 1 - dt * 1.5;
        p.rot += p.vr * dt;
      }
      s.leaves = s.leaves.filter((p) => p.life < p.max);
      for (const r of s.rings) r.t += dt;
      s.rings = s.rings.filter((r) => r.t < 0.45);
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
      const now = performance.now();
      if (now - s.measured > 500) {
        s.measured = now;
        measureCovers();
      }
      const w = s.world;
      const d = s.idle + w.dist;
      const pal = palette(s.tod);

      c.save();
      const sky = c.createLinearGradient(0, 0, 0, Hc);
      sky.addColorStop(0, pal.top);
      sky.addColorStop(0.62, pal.mid);
      sky.addColorStop(1, pal.low);
      c.fillStyle = sky;
      c.fillRect(0, 0, W, Hc);
      if (s.shake > 0) c.translate((Math.random() - 0.5) * s.shake * 8 * k, (Math.random() - 0.5) * s.shake * 6 * k);
      c.scale(k, k);

      stars(c, vw, s.t, pal.night);
      moon(c, vw * 0.22, 90, pal.night);

      // the sun sinks behind the far hills as the day goes on
      const sunY = 110 + Math.min(2.6, s.tod) * 125;
      const sunR = 90 + pal.dusk * 40;
      const sun = c.createRadialGradient(vw * 0.8, sunY, 4, vw * 0.8, sunY, sunR);
      sun.addColorStop(0, pal.sun);
      sun.addColorStop(0.35, `${pal.sun}8c`);
      sun.addColorStop(1, `${pal.sun}00`);
      c.globalAlpha = 0.95 * (1 - pal.night);
      c.fillStyle = sun;
      c.fillRect(vw * 0.8 - sunR, sunY - sunR, sunR * 2, sunR * 2);
      if (pal.dusk > 0) {
        c.globalAlpha = pal.dusk * (1 - pal.night) * 0.9;
        c.beginPath();
        c.arc(vw * 0.8, sunY, 26, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      // clouds, slowest layer
      c.fillStyle = pal.cloud;
      c.globalAlpha = 0.85 - pal.night * 0.45;
      const ct = 300;
      const co = d * 0.08;
      for (let i = Math.floor(co / ct) - 1; i < Math.floor((co + vw) / ct) + 2; i++) {
        const hv = hash(i * 13 + 5);
        if (hv % 3 === 0) continue;
        cloud(c, i * ct - co + (hv % 120), 70 + ((hv >> 8) % 170), 0.7 + ((hv >> 16) % 50) / 100);
      }
      c.globalAlpha = 1;

      // far foothills with a dish now and then
      const fo = d * 0.18;
      hills(c, vw, fo, 445, 42, 1.3, pal.far, H);
      const dt0 = 900;
      for (let i = Math.floor(fo / dt0) - 1; i < Math.floor((fo + vw) / dt0) + 2; i++) {
        const x = i * dt0 + 420 - fo;
        if (x > -40 && x < vw + 40) dish(c, x, ridge(x + fo, 445, 42, 1.3) + 2, pal.dish);
      }

      // near hills with a row of small conifers
      const no = d * 0.42;
      hills(c, vw, no, 488, 24, 4.1, pal.near, H);
      c.fillStyle = pal.pines;
      const tt = 46;
      for (let i = Math.floor(no / tt) - 1; i < Math.floor((no + vw) / tt) + 2; i++) {
        const hv = hash(i * 7 + 1);
        if (hv % 5 < 2) continue;
        const x = i * tt - no + (hv % 20);
        conifer(c, x, ridge(x + no, 488, 24, 4.1) + 4, 18 + ((hv >> 8) % 16));
      }

      for (const col of w.cols) {
        if (col.x > vw + 20 || col.x < -100) continue;
        const p = riseOf(w, col);
        const e = 1 - Math.pow(1 - p, 3);
        column(c, col.x, col.gapY, col.gap, GROUND, (1 - e) * (GROUND + 60));
      }
      if (pal.night > 0) {
        c.fillStyle = `rgba(16,24,58,${pal.night * 0.3})`;
        c.fillRect(-10, -10, vw + 20, GROUND + 10);
      }

      ground(c, vw, d, GROUND, H);
      if (pal.dusk > 0) {
        c.fillStyle = `rgba(40,30,70,${pal.dusk * 0.12 + pal.night * 0.38})`;
        c.fillRect(-10, GROUND, vw + 20, H - GROUND + 4);
      }

      for (const r of s.rings) {
        const q = r.t / 0.45;
        c.strokeStyle = `rgba(255,255,255,${0.7 * (1 - q)})`;
        c.lineWidth = 3 * (1 - q) + 0.5;
        c.beginPath();
        c.arc(r.x, r.y, R + 6 + q * 26, 0, Math.PI * 2);
        c.stroke();
      }

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
      // A soft rim keeps the tree easy to spot when the window is small or the sky is dark.
      c.shadowColor = pal.night > 0.5 ? 'rgba(255,244,214,0.75)' : 'rgba(8,40,24,0.45)';
      c.shadowBlur = Math.max(2, 7 * k);
      tree(c, { wing: s.wing, blink: s.blink, dead: w.dead, t: s.t });
      c.restore();

      // a small pointer while the tree is above the top of the view
      if (w.y < -R * 0.6) {
        c.fillStyle = pal.night > 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(23,96,58,0.85)';
        c.beginPath();
        c.moveTo(w.birdX, 4);
        c.lineTo(w.birdX - 9, 18);
        c.lineTo(w.birdX + 9, 18);
        c.closePath();
        c.fill();
      }
      c.restore();

      if (s.flash > 0) {
        c.fillStyle = `rgba(255,255,255,${s.flash * 0.75})`;
        c.fillRect(0, 0, W, Hc);
      }

      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const u = s.u;
      const fs = Math.round(Math.max(30, Math.min(64, Hc * 0.085)));
      // Keep the score clear of the shell's controls and the online status pill.
      let scoreY = Math.max(fs * 0.9, Hc * 0.12);
      const half = fs * 0.9;
      for (const cv of s.covers) if (cv.l < W / 2 + half && cv.r > W / 2 - half && cv.b + 4 > scoreY - fs * 0.5) scoreY = Math.max(scoreY, cv.b + 4 + fs * 0.55);
      if (s.started && status !== 'over' && !s.over) {
        const pop = 1 + s.pop * 0.22;
        c.save();
        c.translate(W / 2, scoreY);
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
        const a = 0.62 + 0.25 * Math.sin(s.t * 4);
        const hs = Math.round(Math.max(14, fs * 0.3) * u);
        const bs = Math.round(Math.max(13.5, fs * 0.24) * u);
        const y = Math.min(Hc - 50 * k - hs - (best ? bs : 0), (w.y + 62) * k + hs);
        c.font = `600 ${hs}px ${UI}`;
        c.fillStyle = `rgba(30,50,40,${a})`;
        c.fillText(touch ? 'Tap to Flap' : 'Space or Click to Flap', W / 2, y);
        if (best) {
          c.font = `500 ${bs}px ${UI}`;
          c.fillStyle = 'rgba(30,50,40,0.6)';
          c.fillText(`Best ${best}`, W / 2, y + hs * 0.6 + bs * 0.75);
        }
      }

      if (s.toast) {
        const t = s.toast.t;
        const ease = t < 0.25 ? 1 - Math.pow(1 - t / 0.25, 3) : t > 1.7 ? Math.max(0, (2 - t) / 0.3) : 1;
        const label = `${title(s.toast.medal)} Medal`;
        const ts = Math.round(Math.max(14, fs * 0.3) * u);
        c.font = `600 ${ts}px ${UI}`;
        const pw = c.measureText(label).width + ts * 3.4;
        const ph = ts * 2.4;
        const px = W / 2 - pw / 2;
        const py = Math.min(Hc - 50 * k - ph - 4, scoreY + fs * 0.75 + (1 - ease) * -12);
        c.save();
        c.globalAlpha = ease;
        c.fillStyle = 'rgba(255,255,255,0.9)';
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
