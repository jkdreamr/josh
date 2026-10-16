// Canvas renderer for Moto Trials. Draws the world, bike, ghosts, particles and HUD.
import { HEAD_R, TOP_SPEED, WHEEL_R, segActive, type PhysWorld, type Seg } from './physics.ts';
import type { Run } from './logic.ts';
import type { Level, Theme } from './levels.ts';

export type Cam = { x: number; y: number; scale: number };

export type Ghost = {
  x: number;
  y: number;
  a: number;
  fwr: number;
  rwr: number;
  crashed: boolean;
  done: boolean;
  name: string;
  color: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const FONT = '-apple-system, system-ui, sans-serif';
const OUTLINE = 'rgba(16,14,18,0.85)';

export function newCam(): Cam {
  return { x: 0, y: 0, scale: 0 };
}

/** How the frame should look for this canvas size. The bike stays big. */
function viewFit(w: number, h: number) {
  const portrait = h > w * 1.15;
  // landscape: ~7 m tall view on short screens, capped by ~16 m across
  // portrait: zoomed so the bike is about a quarter of the width
  const scale = portrait ? Math.min(w / 9, h / 13) : Math.min(w / 16, h / 6.8);
  return { scale, portrait };
}

export function render(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  run: Run,
  cam: Cam,
  ghosts: Ghost[],
  dt: number,
  lean: number,
  touch: boolean,
) {
  const { level, world, bike } = run;
  const th = level.theme;
  const fit = viewFit(w, h);
  const spd = Math.hypot(bike.v.x, bike.v.y);
  const targetScale = fit.scale / (1 + Math.max(0, bike.v.x - 7) * 0.022);
  cam.scale = cam.scale ? lerp(cam.scale, targetScale, Math.min(1, dt * 3)) : targetScale;
  const scale = cam.scale;

  // camera: lookahead down the track, soft vertical follow, bike sits left of center
  const lookX = clamp(bike.v.x * 0.4, 0, 5.5) + 1.4;
  const tx = bike.p.x + lookX;
  const ty = bike.p.y + 1.5;
  cam.x = cam.x ? lerp(cam.x, tx, Math.min(1, dt * 5)) : tx;
  cam.y = cam.y ? lerp(cam.y, ty, Math.min(1, dt * 2.5)) : ty;
  const shake = run.shake;
  const shx = shake * 0.35 * Math.sin(run.t * 47);
  const shy = shake * 0.35 * Math.cos(run.t * 39);

  const anchorX = w * (fit.portrait ? 0.36 : 0.33);
  const anchorY = h * (fit.portrait ? (touch ? 0.58 : 0.56) : touch ? 0.56 : 0.6);
  const sx = (wx: number) => (wx - cam.x) * scale + anchorX + shx * scale * 0.1;
  const sy = (wy: number) => anchorY - (wy - cam.y) * scale + shy * scale * 0.1;

  const xMin = cam.x - anchorX / scale - 2;
  const xMax = cam.x + (w - anchorX) / scale + 2;

  sky(c, w, h, th, cam, scale, anchorX);
  parallax(c, w, h, th, cam, scale, anchorX, anchorY, fit.portrait);
  terrain(c, h, world, level, run, sx, sy, scale, xMin, xMax);
  props(c, level, sx, sy, scale, xMin, xMax);
  saws(c, world, run, sx, sy, scale);
  checkpointsAndFinish(c, level, run, sx, sy, scale);
  particles(c, run, sx, sy, scale, th);
  speedLines(c, w, h, spd, sx, sy, bike.p.x, bike.p.y, run.t);
  ghosts.forEach((g) => {
    const cs = Math.cos(g.a);
    const sn = Math.sin(g.a);
    const off = (lx: number, ly: number) => ({ x: lx * cs - ly * sn, y: lx * sn + ly * cs });
    const fo = off(0.625, -0.42);
    const ro = off(-0.625, -0.42);
    drawBike(c, sx, sy, { x: g.x, y: g.y, a: g.a, fwx: g.x + fo.x, fwy: g.y + fo.y, rwx: g.x + ro.x, rwy: g.y + ro.y, fwr: g.fwr, rwr: g.rwr }, scale, g.color, 0, true, g.name, g.done || g.crashed);
  });
  if (run.phase !== 'crash')
    drawBike(c, sx, sy, { x: bike.p.x, y: bike.p.y, a: bike.a, fwx: bike.fw.p.x, fwy: bike.fw.p.y, rwx: bike.rw.p.x, rwy: bike.rw.p.y, fwr: bike.fw.rot, rwr: bike.rw.rot }, scale, '#ff6a2b', lean, false, null, false);
  else wreck(c, run, sx, sy, scale);
  hud(c, w, h, run, ghosts, sx, sy);
}

// -------------------------------------------------------------------------------------------------------------------

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function sky(c: CanvasRenderingContext2D, w: number, h: number, th: Theme, cam: Cam, scale: number, anchorX: number) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, th.skyTop);
  g.addColorStop(1, th.skyBot);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // sun (or a pale moon on night themes) drifting very slowly
  const sunX = w * 0.78 - cam.x * scale * 0.02;
  const sunY = h * (th.night ? 0.16 : 0.2);
  const sr = Math.max(14, h * 0.055);
  if (th.night) {
    c.fillStyle = th.sun;
    c.globalAlpha = 0.25;
    c.beginPath();
    c.arc(sunX, sunY, sr * 1.7, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(sunX, sunY, sr * 0.8, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.55;
    c.fillStyle = th.skyTop;
    c.beginPath();
    c.arc(sunX + sr * 0.3, sunY - sr * 0.2, sr * 0.65, 0, Math.PI * 2);
    c.fill();
  } else {
    c.fillStyle = th.sun;
    c.globalAlpha = 0.35;
    c.beginPath();
    c.arc(sunX, sunY, sr * 1.9, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.95;
    c.beginPath();
    c.arc(sunX, sunY, sr, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  // soft clouds, slow parallax
  c.fillStyle = th.cloud;
  for (let i = 0; i < 5; i++) {
    const span = w + 240;
    const cx = ((hash(i * 3.7) * span + i * 97 - cam.x * scale * 0.06) % span + span) % span - 120;
    const cy = h * (0.08 + hash(i * 9.1) * 0.26);
    const r = 18 + hash(i * 5.3) * 26;
    c.beginPath();
    c.ellipse(cx, cy, r * 1.9, r * 0.55, 0, 0, Math.PI * 2);
    c.ellipse(cx + r * 0.9, cy - r * 0.25, r * 1.2, r * 0.5, 0, 0, Math.PI * 2);
    c.ellipse(cx - r, cy - r * 0.1, r * 1.1, r * 0.42, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function ridgeHeight(scenery: Theme['scenery'], wx: number, layer: number): number {
  switch (scenery) {
    case 'hills':
      return Math.max(0, 2.2 + Math.sin(wx * 0.045 + layer * 9) * 1.8 + Math.sin(wx * 0.013 + layer * 3) * 1.4);
    case 'trees': {
      const cell = Math.floor(wx / 5);
      const f = wx / 5 - cell;
      const ph = hash(cell * 7 + layer * 31) * 2.6 + 1.4;
      return ph * Math.max(0, 1 - Math.abs(f - 0.5) * 2);
    }
    case 'city': {
      const cell = Math.floor(wx / 7);
      return 1 + hash(cell * 13 + layer * 17) * 5.5;
    }
    case 'rocks': {
      const cell = Math.floor(wx / 12);
      const f = wx / 12 - cell;
      const ph = 1 + hash(cell * 11 + layer * 23) * 4;
      return f < 0.15 || f > 0.85 ? 0.4 : ph;
    }
    case 'snow':
      return Math.max(0, 2 + Math.sin(wx * 0.06 + layer * 7) * 2.4 + Math.sin(wx * 0.017 + layer * 5) * 1.6);
  }
}

function parallax(c: CanvasRenderingContext2D, w: number, h: number, th: Theme, cam: Cam, scale: number, anchorX: number, anchorY: number, portrait: boolean) {
  const layers: [string, number, number][] = [
    [th.far, 0.15, 0.9],
    [th.mid, 0.35, 0.55],
    [th.near, 0.62, 0.3],
  ];
  const horizonY = anchorY - (cam.y - 4) * scale * 0.4;
  const step = Math.max(4, w / 90);
  for (const [color, par, amp] of layers) {
    c.fillStyle = color;
    c.globalAlpha = th.night ? 0.9 : 0.78;
    const tops: number[] = [];
    if (th.scenery === 'city') {
      // blocky skyline: rectangles per building cell
      for (let px = -4; px <= w + 8; px += step) {
        const lx = cam.x + (px - anchorX) / scale;
        const wxp = cam.x * par + lx;
        const cell = Math.floor(wxp / 7);
        const bh = (1 + hash(cell * 13 + par * 10 * 17) * 5.5) * scale * amp * (portrait ? 0.85 : 1);
        const nx = px + step;
        c.fillRect(px, horizonY - bh, nx - px + 1, bh + h);
        tops.push(bh);
        // lit windows at night
        if (th.night) {
          const lx2 = cam.x + (nx - anchorX) / scale;
          const cellW = (7 * scale * (1 / (1 + 0))) / 1;
          void cellW;
          void lx2;
          for (let wi = 0; wi < 3; wi++) {
            if (hash(cell * 31 + wi * 7 + par * 100) > 0.45) {
              c.fillStyle = 'rgba(255,214,130,0.8)';
              const wy = horizonY - bh + 6 + hash(cell * 11 + wi) * Math.max(0, bh - 14);
              const wx2 = px + 3 + hash(cell * 17 + wi * 3) * Math.max(2, step - 8);
              c.fillRect(wx2, wy, 2.5, 3.5);
              c.fillStyle = color;
            }
          }
        }
      }
    } else {
      c.beginPath();
      c.moveTo(-4, h + 4);
      const pts: [number, number][] = [];
      for (let px = -4; px <= w + 8; px += step) {
        const lx = cam.x + (px - anchorX) / scale;
        const wxp = cam.x * par + lx;
        const hh = ridgeHeight(th.scenery, wxp, par * 10) * scale * amp * (portrait ? 0.85 : 1);
        c.lineTo(px, horizonY - hh);
        pts.push([px, horizonY - hh]);
      }
      c.lineTo(w + 4, h + 4);
      c.closePath();
      c.fill();
      // decorations on the nearer two layers
      if (par > 0.2) {
        if (th.scenery === 'trees') {
          // pines standing on the ridge
          c.fillStyle = color;
          for (let i = 0; i < pts.length; i += 3) {
            const [px, py] = pts[i];
            const lx = cam.x + (px - anchorX) / scale;
            const wxp = cam.x * par + lx;
            const k = hash(Math.floor(wxp / 2.5) * 13 + par * 50);
            if (k < 0.35) continue;
            const th2 = (0.5 + k * 0.5) * scale * amp;
            c.beginPath();
            c.moveTo(px - th2 * 0.34, py + 1);
            c.lineTo(px, py - th2);
            c.lineTo(px + th2 * 0.34, py + 1);
            c.closePath();
            c.fill();
          }
        } else if (th.scenery === 'snow' && par === layers[2][1]) {
          // white caps on the tallest near peaks
          c.fillStyle = 'rgba(255,255,255,0.85)';
          for (let i = 4; i < pts.length - 4; i += 6) {
            const [px, py] = pts[i];
            if (py < pts[i - 4][1] && py <= pts[i + 4][1] && horizonY - py > 8) {
              const cap = Math.min(9, (horizonY - py) * 0.4);
              c.beginPath();
              c.moveTo(px - cap, py + cap * 0.9);
              c.lineTo(px, py);
              c.lineTo(px + cap, py + cap * 0.9);
              c.closePath();
              c.fill();
            }
          }
        }
      }
      void tops;
    }
  }
  c.globalAlpha = 1;
}

/** Continuous runs of ground, so gap segments never get filled across. */
function groundRuns(world: PhysWorld, xMin: number, xMax: number): Seg[][] {
  const runs: Seg[][] = [];
  let cur: Seg[] = [];
  for (const s of world.segs) {
    if (s.kind === 'loop' || Math.max(s.ax, s.bx) < xMin || Math.min(s.ax, s.bx) > xMax) continue;
    const prev = cur[cur.length - 1];
    if (prev && (Math.abs(s.ax - prev.bx) > 0.01 || Math.abs(s.ay - prev.by) > 0.01)) {
      runs.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function terrain(c: CanvasRenderingContext2D, h: number, world: PhysWorld, level: Level, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number, xMin: number, xMax: number) {
  const th = level.theme;
  const bottom = h + 40;
  const runs = groundRuns(world, xMin, xMax);
  const act = (list: Seg[]) => list.filter((s) => segActive(world, s));

  // soil body per run
  for (const r0 of runs) {
    const r = act(r0);
    if (!r.length) continue;
    c.fillStyle = th.ground;
    c.beginPath();
    const x0 = sx(Math.min(r[0].ax, r[0].bx)) - 4;
    c.moveTo(x0, bottom);
    for (const s of r) c.lineTo(sx(s.ax), sy(s.ay));
    const last = r[r.length - 1];
    c.lineTo(sx(last.bx), sy(last.by));
    c.lineTo(sx(Math.max(last.ax, last.bx)) + 4, bottom);
    c.closePath();
    c.fill();
    // strata: faint darker bands following the surface down
    c.strokeStyle = th.speckle;
    for (const depth of [1.1, 2.2]) {
      c.lineWidth = Math.max(1, 0.05 * scale);
      c.beginPath();
      for (const s of r) {
        const nx = s.nx * depth;
        const ny = s.ny * depth;
        c.moveTo(sx(s.ax - nx), sy(s.ay - ny));
        c.lineTo(sx(s.bx - nx), sy(s.by - ny));
      }
      c.stroke();
    }
    // speckles in the dirt, seeded by world x
    c.fillStyle = th.speckle;
    for (const s of r) {
      const n = Math.floor(s.len / 0.9);
      for (let i = 0; i < n; i++) {
        const t = i + 0.5;
        const wx = s.ax + ((s.bx - s.ax) * t) / (n || 1);
        const wy = s.ay + ((s.by - s.ay) * t) / (n || 1);
        const k = hash(wx * 7.3 + wy * 3.1);
        const dy = 0.6 + k * 2.4;
        const px = wx - s.nx * dy;
        const py = wy - s.ny * dy;
        const pyS = sy(py);
        if (pyS > bottom || pyS < sy(wy) + 4) continue;
        c.beginPath();
        c.arc(sx(px), pyS, Math.max(0.8, 0.07 * scale), 0, Math.PI * 2);
        c.fill();
      }
    }
    // the bright surface band
    c.strokeStyle = th.soil;
    c.lineWidth = Math.max(2, 0.34 * scale);
    c.lineCap = 'round';
    c.beginPath();
    for (const s of r) {
      c.moveTo(sx(s.ax) - s.nx * 0.1 * scale * 0, sy(s.ay) + 0.1 * scale);
      c.lineTo(sx(s.bx), sy(s.by) + 0.1 * scale);
    }
    c.stroke();
  }

  // wood ramps: planks plus struts down to the base ground
  for (const r0 of runs) {
    for (const s of act(r0)) {
      if (s.kind !== 'wood') continue;
      const axp = sx(s.ax);
      const ayp = sy(s.ay);
      const bxp = sx(s.bx);
      const byp = sy(s.by);
      // plank body
      const gy0 = levelBaseY(level, s.ax);
      const gy1 = levelBaseY(level, s.bx);
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.beginPath();
      c.moveTo(axp, ayp);
      c.lineTo(bxp, byp);
      c.lineTo(bxp, sy(gy1 - 0.02) + 2);
      c.lineTo(axp, sy(gy0 - 0.02) + 2);
      c.closePath();
      c.fill();
      c.strokeStyle = th.wood;
      c.lineWidth = Math.max(2, 0.26 * scale);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(axp, ayp);
      c.lineTo(bxp, byp);
      c.stroke();
      // struts + plank seams
      c.lineWidth = Math.max(1.5, 0.1 * scale);
      for (let i = 0; i <= 2; i++) {
        const px = s.ax + ((s.bx - s.ax) * i) / 2;
        const py = s.ay + ((s.by - s.ay) * i) / 2;
        c.beginPath();
        c.moveTo(sx(px), sy(py - 0.12));
        c.lineTo(sx(px), sy(levelBaseY(level, px)));
        c.stroke();
      }
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = Math.max(1, 0.04 * scale);
      const n = Math.floor(s.len / 0.7);
      const ux = (s.bx - s.ax) / s.len;
      const uy = (s.by - s.ay) / s.len;
      for (let i = 1; i < n; i++) {
        const px = s.ax + ux * i * 0.7;
        const py = s.ay + uy * i * 0.7;
        c.beginPath();
        c.moveTo(sx(px + uy * 0.14), sy(py - ux * 0.14));
        c.lineTo(sx(px - uy * 0.05), sy(py + ux * 0.05));
        c.stroke();
      }
      continue;
    }
    // surface edge line for dirt
    c.strokeStyle = th.edge;
    c.lineWidth = Math.max(1.5, 0.07 * scale);
    c.lineCap = 'round';
    c.beginPath();
    for (const s of act(r0)) {
      if (s.kind === 'wood') continue;
      c.moveTo(sx(s.ax), sy(s.ay));
      c.lineTo(sx(s.bx), sy(s.by));
    }
    c.stroke();
  }

  // loops: a thick banded ring on supports
  for (const l of world.loops) {
    const cx = sx(l.cx);
    const cy = sy(l.cy);
    const rr = l.r * scale;
    c.strokeStyle = th.wood;
    c.lineWidth = Math.max(3, 0.5 * scale);
    c.beginPath();
    c.arc(cx, cy, rr, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = Math.max(1, 0.1 * scale);
    c.beginPath();
    c.arc(cx, cy, rr - 0.16 * scale, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.3)';
    c.lineWidth = Math.max(1.5, 0.09 * scale);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (rr - 0.25 * scale), cy + Math.sin(a) * (rr - 0.25 * scale));
      c.lineTo(cx + Math.cos(a) * (rr + 0.25 * scale), cy + Math.sin(a) * (rr + 0.25 * scale));
      c.stroke();
    }
    const gy = levelBaseY(level, l.cx);
    c.strokeStyle = th.wood;
    c.lineWidth = Math.max(2, 0.18 * scale);
    for (const dx of [-l.r * 0.7, l.r * 0.7]) {
      c.beginPath();
      c.moveTo(sx(l.cx + dx), sy(gy));
      c.lineTo(sx(l.cx + dx * 0.55), sy(l.cy - l.r * 0.55));
      c.stroke();
    }
  }
}

function levelBaseY(level: Level, x: number) {
  let best = -Infinity;
  for (const s of level.segs) {
    if (s.kind === 'loop') continue;
    if (x >= Math.min(s.ax, s.bx) && x <= Math.max(s.ax, s.bx)) {
      const t = Math.max(0, Math.min(s.len, (x - s.ax) * ((s.bx - s.ax) / s.len) + (0 - s.ay) * ((s.by - s.ay) / s.len)));
      best = Math.max(best, s.ay + ((s.by - s.ay) / s.len) * t);
    }
  }
  return best === -Infinity ? 0 : best;
}

/** Small seeded props on gentle ground: bushes, cacti, pines, rocks, cones. */
function props(c: CanvasRenderingContext2D, level: Level, sx: (x: number) => number, sy: (y: number) => number, scale: number, xMin: number, xMax: number) {
  const th = level.theme;
  let x = Math.max(6, xMin - 4);
  const lvlSeed = parseInt(level.id.slice(6), 10) * 91;
  while (x < xMax) {
    const step = 7 + hash(Math.floor(x) + lvlSeed) * 9;
    x += step;
    const gy = levelBaseY(level, x);
    if (gy === -Infinity || Math.abs(levelBaseY(level, x + 1.5) - levelBaseY(level, x - 1.5)) > 0.6) continue;
    const px = sx(x);
    const py = sy(gy);
    const k = hash(x * 3.7 + lvlSeed);
    const s = scale * (0.8 + k * 0.5);
    c.save();
    c.translate(px, py);
    switch (th.prop) {
      case 'cactus':
        c.strokeStyle = '#3f7a44';
        c.lineWidth = Math.max(2, 0.14 * s);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -0.9 * s);
        c.moveTo(0, -0.5 * s);
        c.lineTo(-0.28 * s, -0.5 * s);
        c.lineTo(-0.28 * s, -0.75 * s);
        c.moveTo(0, -0.6 * s);
        c.lineTo(0.3 * s, -0.6 * s);
        c.lineTo(0.3 * s, -0.9 * s);
        c.stroke();
        break;
      case 'pine':
        c.fillStyle = th.near;
        for (const [dy, w2, hh] of [[0.9, 0.55, 0.6], [0.55, 0.42, 0.5], [0.25, 0.3, 0.42]] as const) {
          c.beginPath();
          c.moveTo(-w2 * s, -dy * s + hh * s);
          c.lineTo(0, -dy * s);
          c.lineTo(w2 * s, -dy * s + hh * s);
          c.closePath();
          c.fill();
        }
        c.fillStyle = '#5d4326';
        c.fillRect(-0.05 * s, -0.2 * s, 0.1 * s, 0.2 * s);
        break;
      case 'rock':
        c.fillStyle = th.mid;
        c.beginPath();
        c.moveTo(-0.5 * s, 0);
        c.lineTo(-0.3 * s, -0.3 * s);
        c.lineTo(0.1 * s, -0.42 * s);
        c.lineTo(0.48 * s, -0.15 * s);
        c.lineTo(0.5 * s, 0);
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.14)';
        c.beginPath();
        c.moveTo(-0.3 * s, -0.3 * s);
        c.lineTo(0.1 * s, -0.42 * s);
        c.lineTo(0.2 * s, -0.24 * s);
        c.closePath();
        c.fill();
        break;
      case 'cone':
        c.fillStyle = '#e06428';
        c.beginPath();
        c.moveTo(-0.26 * s, 0);
        c.lineTo(0, -0.62 * s);
        c.lineTo(0.26 * s, 0);
        c.closePath();
        c.fill();
        c.fillStyle = '#f2f2f6';
        c.fillRect(-0.13 * s, -0.34 * s, 0.26 * s, 0.1 * s);
        break;
      default:
        // bush
        c.fillStyle = th.mid;
        c.beginPath();
        c.arc(-0.25 * s, -0.14 * s, 0.22 * s, 0, Math.PI * 2);
        c.arc(0.1 * s, -0.26 * s, 0.28 * s, 0, Math.PI * 2);
        c.arc(0.38 * s, -0.1 * s, 0.16 * s, 0, Math.PI * 2);
        c.fill();
    }
    c.restore();
  }
}

function saws(c: CanvasRenderingContext2D, world: PhysWorld, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
  for (const s of world.saws) {
    const cx = sx(s.x);
    const cy = sy(s.y);
    const r = s.r * scale;
    // motion blur halo
    c.strokeStyle = 'rgba(220,220,230,0.28)';
    c.lineWidth = Math.max(2, 0.16 * scale);
    c.beginPath();
    c.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
    c.stroke();
    c.save();
    c.translate(cx, cy);
    c.rotate(run.t * 6);
    c.fillStyle = '#d8d8e0';
    c.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const a2 = a + Math.PI / teeth;
      c.lineTo(Math.cos(a) * r * 1.18, Math.sin(a) * r * 1.18);
      c.lineTo(Math.cos(a2) * r * 0.82, Math.sin(a2) * r * 0.82);
    }
    c.closePath();
    c.fill();
    c.strokeStyle = OUTLINE;
    c.lineWidth = Math.max(1, 0.04 * scale);
    c.stroke();
    c.fillStyle = '#8a8a96';
    c.beginPath();
    c.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#55555e';
    c.beginPath();
    c.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.4)';
    c.lineWidth = Math.max(1.5, 0.08 * scale);
    c.beginPath();
    c.moveTo(cx, cy - r * 1.1);
    c.lineTo(cx, cy - r * 1.1 - 2.2 * scale);
    c.stroke();
  }
}

function checkpointsAndFinish(c: CanvasRenderingContext2D, level: Level, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
  // checkpoint flags: once taken the flag sits higher and waves harder
  level.checkpoints.forEach((x, i) => {
    const gy = levelBaseY(level, x);
    const px = sx(x);
    const py = sy(gy);
    const taken = i < run.cp;
    const poleH = (taken ? 2.5 : 2.0) * scale;
    c.strokeStyle = taken ? '#ffd76a' : 'rgba(255,255,255,0.75)';
    c.lineWidth = Math.max(1.5, 0.07 * scale);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, py - poleH);
    c.stroke();
    const wave = Math.sin(run.t * (taken ? 9 : 5) + i) * (taken ? 0.2 : 0.1);
    const fw = (taken ? 1.15 : 0.85) * scale;
    c.fillStyle = taken ? '#ff6a2b' : 'rgba(255,255,255,0.5)';
    c.beginPath();
    c.moveTo(px, py - poleH);
    c.lineTo(px + fw + wave * scale, py - poleH + 0.3 * scale);
    c.lineTo(px, py - poleH + 0.62 * scale);
    c.closePath();
    c.fill();
  });
  // finish: two poles and a checkered banner across the top
  const gy = levelBaseY(level, level.finishX);
  const fy = sy(gy);
  const archW = 3.4 * scale;
  const poleH = 3.4 * scale;
  c.strokeStyle = '#e8e8ee';
  c.lineWidth = Math.max(2, 0.12 * scale);
  for (const px of [sx(level.finishX - 0.6), sx(level.finishX + 2.8)]) {
    c.beginPath();
    c.moveTo(px, fy);
    c.lineTo(px, fy - poleH);
    c.stroke();
  }
  const bx = sx(level.finishX - 0.6);
  const bw = archW / 6;
  const bh = 0.5 * scale;
  for (let r2 = 0; r2 < 2; r2++)
    for (let i = 0; i < 6; i++) {
      c.fillStyle = (i + r2) % 2 ? '#14141a' : '#f2f2f6';
      c.fillRect(bx + i * bw, fy - poleH + r2 * bh, bw + 0.5, bh);
    }
}

function particles(c: CanvasRenderingContext2D, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number, th: Theme) {
  for (const p of run.fx) {
    const age = run.t - p.t;
    const k = 1 - age / p.life;
    if (k <= 0) continue;
    const px = sx(p.x);
    const py = sy(p.y);
    c.globalAlpha = Math.min(1, k * 1.4);
    if (p.kind === 'confetti') {
      c.fillStyle = p.c ?? '#fff';
      c.save();
      c.translate(px, py);
      c.rotate(age * 9 + p.x);
      c.fillRect(-0.09 * scale, -0.05 * scale, 0.18 * scale, 0.1 * scale);
      c.restore();
    } else {
      c.fillStyle = p.kind === 'debris' ? '#3a3230' : th.dust;
      const r = (p.kind === 'dust' ? 0.09 + (1 - k) * 0.16 : 0.1) * scale;
      c.beginPath();
      c.arc(px, py, Math.max(1, r), 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

/** Speed streaks once the bike is flying. */
function speedLines(c: CanvasRenderingContext2D, w: number, h: number, spd: number, sx: (x: number) => number, sy: (y: number) => number, bx: number, by: number, t: number) {
  const k = clamp((spd - TOP_SPEED * 0.62) / (TOP_SPEED * 0.3), 0, 1);
  if (k <= 0) return;
  const bxp = sx(bx);
  const byp = sy(by);
  c.strokeStyle = `rgba(255,255,255,${0.35 * k})`;
  c.lineWidth = Math.max(1, h * 0.003);
  c.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const yy = byp + (hash(i * 7 + Math.floor(t * 12)) - 0.5) * h * 0.5;
    const xx = (bxp + w * (hash(i * 13 + Math.floor(t * 12)) - 0.4)) % (w + 80);
    const len = (30 + hash(i * 5) * 70) * k;
    c.beginPath();
    c.moveTo(xx, yy);
    c.lineTo(xx + len, yy);
    c.stroke();
  }
}

// -------------------------------------------------------------------------------------------------------------------

/** Bike pose in world units: chassis centre, angle and the two wheel centres. */
export type BikePose = { x: number; y: number; a: number; fwx: number; fwy: number; rwx: number; rwy: number; fwr: number; rwr: number };

/** Motocross bike + rider. Local coords are y-up meters; wheels at their real sprung spots. */
function drawBike(
  c: CanvasRenderingContext2D,
  sx: (x: number) => number,
  sy: (y: number) => number,
  b: BikePose,
  scale: number,
  accent: string,
  lean: number,
  ghost: boolean,
  name: string | null,
  faded: boolean,
) {
  if (ghost) c.globalAlpha = 0.5;
  if (faded) c.globalAlpha = 0.22;
  const cs = Math.cos(b.a);
  const sn = Math.sin(b.a);
  const P = (lx: number, ly: number) => [sx(b.x + lx * cs - ly * sn), sy(b.y + lx * sn + ly * cs)] as const;
  const r = WHEEL_R * scale;
  const fw = [sx(b.fwx), sy(b.fwy)] as const;
  const rw = [sx(b.rwx), sy(b.rwy)] as const;
  const outline = Math.max(1, 0.045 * scale);

  const poly = (pts: readonly (readonly number[])[], fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.fill();
    c.strokeStyle = OUTLINE;
    c.lineWidth = outline;
    c.lineJoin = 'round';
    c.stroke();
  };
  const stroke = (pts: readonly (readonly number[])[], color: string, lw: number) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(1, lw * scale);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  };

  const wheel = (wx: number, wy: number, rot: number) => {
    // knobby tire, rim, hub, spokes
    c.fillStyle = '#191922';
    c.beginPath();
    c.arc(wx, wy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = OUTLINE;
    c.lineWidth = outline;
    c.stroke();
    // knobs
    c.strokeStyle = '#191922';
    c.lineWidth = Math.max(1, 0.07 * scale);
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5;
      c.beginPath();
      c.moveTo(wx + Math.cos(a) * r * 0.94, wy + Math.sin(a) * r * 0.94);
      c.lineTo(wx + Math.cos(a) * r * 1.05, wy + Math.sin(a) * r * 1.05);
      c.stroke();
    }
    c.fillStyle = '#aab0bc';
    c.beginPath();
    c.arc(wx, wy, r * 0.58, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#7d8492';
    c.lineWidth = Math.max(1, 0.04 * scale);
    c.stroke();
    c.strokeStyle = ghost ? '#666' : '#cfd4de';
    c.lineWidth = Math.max(1, 0.035 * scale);
    for (let i = 0; i < 5; i++) {
      const sa = rot * 1.5 + (i * Math.PI * 2) / 5;
      c.beginPath();
      c.moveTo(wx, wy);
      c.lineTo(wx + Math.cos(sa) * r * 0.55, wy + Math.sin(sa) * r * 0.55);
      c.stroke();
    }
    c.fillStyle = accent;
    c.beginPath();
    c.arc(wx, wy, r * 0.16, 0, Math.PI * 2);
    c.fill();
  };

  const dark = ghost ? '#55555e' : '#23232b';
  const body = ghost ? '#8f95a0' : accent;
  const mid = ghost ? '#777c88' : '#d8541e';

  // 1. rear wheel
  wheel(rw[0], rw[1], b.rwr);
  // 2. swingarm
  poly([rw, P(0.02, -0.14), P(-0.02, -0.24)], dark);
  // chain run
  stroke([rw, P(0.0, -0.1)], 'rgba(20,20,26,0.8)', 0.045);
  // 3. rider back leg (behind the bike)
  const hipL = -0.14 + lean * 0.1;
  const hipH = 0.4 - Math.abs(lean) * 0.04;
  const hip = P(hipL, hipH);
  const knee = P(0.04 + lean * 0.06, 0.04);
  const peg = P(-0.02 + lean * 0.03, -0.1);
  poly([hip, knee, peg], ghost ? '#666' : '#1d1d26');
  // 4. bike body
  // engine block
  poly([P(0.28, -0.18), P(0.3, 0.1), P(-0.08, 0.14), P(-0.2, -0.12)], dark);
  // exhaust pipe up under the seat
  stroke([P(0.16, -0.08), P(-0.05, 0.02), P(-0.42, 0.14), P(-0.5, 0.3)], ghost ? '#777' : '#b9bfc9', 0.09);
  // tank + seat + tail (accent, two-tone via dark seat line)
  poly([P(-0.5, 0.32), P(-0.52, 0.46), P(-0.18, 0.5), P(0.24, 0.44), P(0.38, 0.34), P(0.2, 0.18), P(-0.3, 0.18)], body);
  stroke([P(-0.48, 0.4), P(-0.2, 0.44)], dark, 0.09);
  // rear fender flick
  poly([P(-0.5, 0.44), P(-0.88, 0.5), P(-0.86, 0.32), P(-0.56, 0.3)], body);
  // steering head + number plate
  poly([P(0.44, 0.14), P(0.56, 0.52), P(0.66, 0.5), P(0.6, 0.2)], body);
  // handlebar
  stroke([P(0.56, 0.5), P(0.5, 0.66), P(0.62, 0.68)], dark, 0.05);
  // 5. rider torso, arms, helmet
  const shoL = hipL + 0.26 + lean * 0.26;
  const shoH = hipH + 0.44 - Math.abs(lean) * 0.08;
  const sho = P(shoL, shoH);
  // far arm
  stroke([sho, P(0.56, 0.62)], ghost ? '#777' : '#1d1d26', 0.1);
  // jersey torso (accent)
  poly([P(hipL - 0.1, hipH - 0.02), P(shoL - 0.14, shoH), P(shoL + 0.1, shoH + 0.06), P(hipL + 0.16, hipH + 0.02)], body);
  // near leg over the bike
  poly([P(hipL + 0.06, hipH + 0.02), P(0.1 + lean * 0.08, 0.06), P(0.02 + lean * 0.04, -0.1)], ghost ? '#888' : '#2b2b36');
  // helmet: accent shell, dark visor, small peak
  const hmL = shoL + 0.14 + lean * 0.06;
  const hmH = shoH + 0.22;
  const hm = P(hmL, hmH);
  c.fillStyle = body;
  c.beginPath();
  c.arc(hm[0], hm[1], Math.max(2.5, HEAD_R * scale), 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = OUTLINE;
  c.lineWidth = outline;
  c.stroke();
  // visor
  c.fillStyle = '#141420';
  c.beginPath();
  const va = Math.atan2(0.2, 1);
  c.arc(hm[0], hm[1], HEAD_R * scale * 0.72, -va - 0.5, -va + 0.9);
  c.lineTo(hm[0], hm[1]);
  c.closePath();
  c.fill();
  // peak
  stroke([P(hmL + 0.05, hmH + 0.12), P(hmL + 0.3, hmH + 0.16)], body, 0.06);
  // 6. front fork + front wheel on top
  stroke([P(0.52, 0.2), [fw[0], fw[1]]], ghost ? '#999' : '#c9ced8', 0.08);
  stroke([P(0.58, 0.18), [fw[0], fw[1]]], dark, 0.04);
  // front fender
  c.save();
  c.translate(fw[0], fw[1]);
  c.rotate(-b.a);
  c.fillStyle = body;
  c.beginPath();
  c.arc(0, 0, r * 1.14, -Math.PI * 0.85, -Math.PI * 0.15);
  c.arc(0, 0, r * 0.95, -Math.PI * 0.15, -Math.PI * 0.85, true);
  c.closePath();
  c.fill();
  c.strokeStyle = OUTLINE;
  c.lineWidth = Math.max(1, 0.03 * scale);
  c.stroke();
  c.restore();
  wheel(fw[0], fw[1], b.fwr);

  c.globalAlpha = 1;

  if (name) {
    c.save();
    c.globalAlpha = 0.9;
    c.font = `600 11px ${FONT}`;
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    const top = P(0, 1.6);
    c.fillText(name, top[0], top[1] - 8);
    c.restore();
  }
}

/** Tumbling rider during a crash: the bike skids while the rider bounces off. */
function wreck(c: CanvasRenderingContext2D, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
  const b = run.bike;
  const t = run.crashT;
  drawBike(c, sx, sy, { x: b.p.x, y: b.p.y, a: b.a + t * 3, fwx: b.fw.p.x, fwy: b.fw.p.y, rwx: b.rw.p.x, rwy: b.rw.p.y, fwr: 0, rwr: 0 }, scale, '#ff6a2b', 0, false, null, false);
  // ragdoll: flies forward, arcs down, skids along the ground
  const vx = Math.max(2, b.v.x * 0.6);
  let rx = b.p.x + 0.8 + vx * t;
  let ry = b.p.y + 0.6 + Math.max(0, 3.4 * t - 11 * t * t);
  const g = levelBaseY(run.level, rx);
  if (ry < g + 0.2) {
    ry = g + 0.2;
    rx = b.p.x + 0.8 + vx * 0.35 + (t - 0.35 > 0 ? (t - 0.35) * vx * 0.4 : 0);
  }
  c.save();
  c.translate(sx(rx), sy(ry));
  c.rotate(-t * 7);
  const s2 = scale;
  c.strokeStyle = '#2b2b36';
  c.lineWidth = Math.max(2, 0.11 * s2);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(0, -0.28 * s2);
  c.lineTo(0, 0.24 * s2);
  c.moveTo(-0.22 * s2, 0.1 * s2);
  c.lineTo(0.22 * s2, -0.06 * s2);
  c.moveTo(-0.18 * s2, -0.3 * s2);
  c.lineTo(0.18 * s2, -0.3 * s2);
  c.stroke();
  c.fillStyle = '#ff6a2b';
  c.beginPath();
  c.arc(0, -0.4 * s2, Math.max(2.5, 0.17 * s2), 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// -------------------------------------------------------------------------------------------------------------------

const fmt = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return m ? `${m}:${ss}` : ss;
};

/** Where the shell's own pills sit, measured in canvas px, so the HUD dodges them. */
function chromeRects(c: CanvasRenderingContext2D, w: number) {
  const stage = c.canvas.parentElement;
  const cr = c.canvas.getBoundingClientRect();
  const k = w / (cr.width || w || 1);
  const box = (sel: string) => {
    const el = stage?.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { l: (r.left - cr.left) * k, r: (r.right - cr.left) * k, t: (r.top - cr.top) * k, b: (r.bottom - cr.top) * k };
  };
  return { pill: box('.arcade-score'), ctrl: box('.arcade-ctrl'), status: box('.arcade-online-status') };
}

function hud(c: CanvasRenderingContext2D, w: number, h: number, run: Run, ghosts: Ghost[], sx: (x: number) => number, sy: (y: number) => number) {
  const level = run.level;
  const chrome = chromeRects(c, w);
  const pillR = chrome.pill?.r ?? 0;
  const ctrlL = chrome.ctrl?.l ?? w;
  const rowB = Math.max(chrome.ctrl?.b ?? 0, chrome.pill?.b ?? 0);
  const freeW = ctrlL - pillR - 24;
  const bw = Math.min(w * 0.42, 340);
  let bx: number;
  let by: number;
  if (freeW >= 120) {
    bx = clamp(w / 2 - bw / 2, pillR + 12, ctrlL - 12 - bw);
    by = Math.max(12, (chrome.pill?.t ?? 12));
  } else {
    bx = w / 2 - bw / 2;
    by = rowB + 10;
  }

  const prog = clamp((run.bike.p.x - level.start.x) / (level.finishX - level.start.x), 0, 1);
  // track pill
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath();
  c.roundRect(bx - 8, by - 6, bw + 16, 16, 8);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.fillRect(bx, by, bw, 4);
  c.fillStyle = '#ff6a2b';
  c.fillRect(bx, by, bw * prog, 4);
  c.fillStyle = 'rgba(255,255,255,0.7)';
  for (const cp of level.checkpoints) {
    const t = (cp - level.start.x) / (level.finishX - level.start.x);
    c.fillRect(bx + bw * t - 1, by - 2, 2, 8);
  }
  for (const g of ghosts) {
    const t = clamp((g.x - level.start.x) / (level.finishX - level.start.x), 0, 1);
    c.fillStyle = g.color;
    c.beginPath();
    c.arc(bx + bw * t, by + 2, 3.2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    c.stroke();
  }
  // player dot rides on top
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(bx + bw * prog, by + 2, 3.4, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.5)';
  c.lineWidth = 1;
  c.stroke();

  // level name in a soft pill under the bar
  const nx = bx + bw / 2;
  const ny = by + 16;
  c.font = `600 11px ${FONT}`;
  const nw = c.measureText(level.name).width;
  c.fillStyle = 'rgba(0,0,0,0.38)';
  c.beginPath();
  c.roundRect(nx - nw / 2 - 8, ny - 2, nw + 16, 16, 8);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.textAlign = 'center';
  c.fillText(level.name, nx, ny + 10);

  // countdown / waiting
  if (run.phase === 'count') {
    const n = Math.ceil(run.countT);
    c.font = `800 ${Math.min(64, h * 0.3)}px ${FONT}`;
    c.fillStyle = n <= 0 ? '#7ddf8a' : '#fff';
    c.fillText(n > 0 ? String(n) : 'Go', w / 2, h * 0.42);
  } else if (run.phase === 'wait') {
    c.font = `600 13px ${FONT}`;
    const txt = 'waiting for the host';
    const tw = c.measureText(txt).width;
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.beginPath();
    c.roundRect(w / 2 - tw / 2 - 10, h * 0.4 - 16, tw + 20, 24, 12);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillText(txt, w / 2, h * 0.4);
  }

  // toasts pop in next to the bike
  const bxp = sx(run.bike.p.x);
  const byp = sy(run.bike.p.y);
  c.textAlign = 'center';
  run.toasts.forEach((t, i) => {
    const age = run.t - t.t;
    if (age > 1.8) return;
    const pop = Math.min(1, age * 7);
    const ease = 1 - (1 - pop) * (1 - pop);
    c.globalAlpha = Math.min(1, 1.8 - age);
    const fs = Math.max(11, 15 * ease);
    c.font = `700 ${fs}px ${FONT}`;
    c.fillStyle = '#fff';
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.lineWidth = 3;
    const yy = byp - 46 - i * 22 - ease * 8;
    c.strokeText(t.text, bxp, yy);
    c.fillText(t.text, bxp, yy);
  });
  c.globalAlpha = 1;
}
