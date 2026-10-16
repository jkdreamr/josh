// Canvas renderer for Moto Trials. Draws the world, bike, ghosts, particles and HUD.
import { HEAD_R, WHEEL_R, segActive, type PhysWorld, type Seg } from './physics.ts';
import { COUNTDOWN, type Run } from './logic.ts';
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

export function newCam(): Cam {
  return { x: 0, y: 0, scale: 30 };
}

/** How the frame should look for this canvas size. */
function viewFit(w: number, h: number) {
  const portrait = h > w * 1.2;
  // short wide screens see ~10 m vertically; always keep ~18 m across; bike stays >= 26 px long
  let scale = Math.min(w / 18, h / (portrait ? 15 : 10));
  scale = Math.max(scale, 26 / 2.0, Math.min(w / 60, h / 34));
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
  const targetScale = fit.scale / (1 + Math.max(0, bike.v.x - 6) * 0.02);
  cam.scale = cam.scale ? lerp(cam.scale, targetScale, Math.min(1, dt * 3)) : targetScale;
  const scale = cam.scale;

  // camera: lookahead down the track, soft vertical follow, anchored left of center
  const lookX = clamp(bike.v.x * 0.45, 0, 7) + 2.2;
  const tx = bike.p.x + lookX;
  const ty = bike.p.y + 1.6;
  cam.x = cam.x ? lerp(cam.x, tx, Math.min(1, dt * 5)) : tx;
  cam.y = cam.y ? lerp(cam.y, ty, Math.min(1, dt * 2.5)) : ty;
  // camera shake on crash
  const shake = run.shake;
  const shx = shake * 0.35 * Math.sin(run.t * 47);
  const shy = shake * 0.35 * Math.cos(run.t * 39);

  const anchorX = w * (fit.portrait ? 0.34 : 0.38);
  const anchorY = h * (fit.portrait ? 0.56 : touch ? 0.56 : 0.62);
  const sx = (wx: number) => (wx - cam.x) * scale + anchorX + shx * scale * 0.1;
  const sy = (wy: number) => anchorY - (wy - cam.y) * scale + shy * scale * 0.1;

  const xMin = cam.x - anchorX / scale - 2;
  const xMax = cam.x + (w - anchorX) / scale + 2;

  sky(c, w, h, th);
  parallax(c, w, h, th, cam, scale, anchorX, anchorY, fit.portrait);
  terrain(c, h, world, level, run, sx, sy, scale, xMin, xMax);
  saws(c, world, run, sx, sy, scale);
  checkpointsAndFinish(c, level, run, sx, sy, scale);
  particles(c, run, sx, sy, scale, th);
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
  hud(c, w, h, run, ghosts, scale);
}

// -------------------------------------------------------------------------------------------------------------------

function sky(c: CanvasRenderingContext2D, w: number, h: number, th: Theme) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, th.skyTop);
  g.addColorStop(1, th.skyBot);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** Deterministic pseudo-random from a column index. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

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
      // mesas: flat-topped plateaus
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
  for (const [color, par, amp] of layers) {
    c.fillStyle = color;
    c.globalAlpha = th.night ? 0.9 : 0.75;
    c.beginPath();
    c.moveTo(-4, h + 4);
    const step = Math.max(4, w / 90);
    for (let px = -4; px <= w + 8; px += step) {
      const wx = cam.x + (px - anchorX) / (scale * par) - cam.x / par + cam.x;
      // world x of this column, parallaxed
      const lx = cam.x + (px - anchorX) / scale;
      const wxp = cam.x * par + lx;
      const hh = ridgeHeight(th.scenery, wxp, par * 10) * scale * amp * (portrait ? 0.8 : 1);
      c.lineTo(px, horizonY - hh);
    }
    c.lineTo(w + 4, h + 4);
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 1;
}

function terrain(c: CanvasRenderingContext2D, h: number, world: PhysWorld, level: Level, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number, xMin: number, xMax: number) {
  const th = level.theme;
  // ground fill: walk segments left to right (skip loop arcs; the ring is drawn separately)
  const grounds = world.segs.filter((s) => s.kind !== 'loop' && Math.max(s.ax, s.bx) >= xMin && Math.min(s.ax, s.bx) <= xMax);
  // fill each continuous run of ground separately so gaps stay gaps
  const bottom = h + 40;
  c.fillStyle = th.ground;
  let prev: Seg | null = null;
  let path = false;
  const close = () => {
    if (!path || !prev) return;
    c.lineTo(sx(Math.max(prev.ax, prev.bx)) + 4, bottom);
    c.lineTo(pathStartX, bottom);
    c.closePath();
    c.fill();
    path = false;
  };
  let pathStartX = 0;
  for (const s of grounds) {
    if (!segActive(world, s)) continue;
    const axp = sx(s.ax);
    const ayp = sy(s.ay);
    const bxp = sx(s.bx);
    const byp = sy(s.by);
    const joined = prev && Math.abs(s.ax - prev.bx) < 0.01 && Math.abs(s.ay - prev.by) < 0.01;
    if (!joined) {
      close();
      c.beginPath();
      pathStartX = axp - 4;
      c.moveTo(axp - 4, bottom);
      c.lineTo(axp, ayp);
      path = true;
    } else {
      c.lineTo(axp, ayp);
    }
    c.lineTo(bxp, byp);
    prev = s;
  }
  close();
  // top edge + texture ticks
  for (const s of grounds) {
    if (!segActive(world, s)) continue;
    const axp = sx(s.ax);
    const ayp = sy(s.ay);
    const bxp = sx(s.bx);
    const byp = sy(s.by);
    c.strokeStyle = s.kind === 'wood' ? th.wood : th.edge;
    c.lineWidth = Math.max(2, (s.kind === 'wood' ? 0.34 : 0.12) * scale);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(axp, ayp);
    c.lineTo(bxp, byp);
    c.stroke();
    // dashes along the edge for texture
    const n = Math.floor(s.len / 1.3);
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = Math.max(1.5, 0.05 * scale);
    const ux = (s.bx - s.ax) / s.len;
    const uy = (s.by - s.ay) / s.len;
    for (let i = 1; i < n; i++) {
      const px = s.ax + ux * i * 1.3;
      const py = s.ay + uy * i * 1.3;
      c.beginPath();
      c.moveTo(sx(px), sy(py));
      c.lineTo(sx(px + uy * 0.4), sy(py - ux * 0.4));
      c.stroke();
    }
    if (s.kind === 'wood') {
      // plank posts down from the ramp
      c.strokeStyle = th.wood;
      c.lineWidth = Math.max(2, 0.14 * scale);
      for (let i = 0; i <= 2; i++) {
        const px = s.ax + ((s.bx - s.ax) * i) / 2;
        const py = s.ay + ((s.by - s.ay) * i) / 2;
        c.beginPath();
        c.moveTo(sx(px), sy(py - 0.15));
        c.lineTo(sx(px), sy(py - 2.4));
        c.stroke();
      }
    }
  }
  // loops: thick ring plus supports
  for (const l of world.loops) {
    const cx = sx(l.cx);
    const cy = sy(l.cy);
    const rr = l.r * scale;
    c.strokeStyle = th.wood;
    c.lineWidth = Math.max(3, 0.42 * scale);
    c.beginPath();
    c.arc(cx, cy, rr, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = Math.max(1.5, 0.08 * scale);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (rr - 0.21 * scale), cy + Math.sin(a) * (rr - 0.21 * scale));
      c.lineTo(cx + Math.cos(a) * (rr + 0.21 * scale), cy + Math.sin(a) * (rr + 0.21 * scale));
      c.stroke();
    }
    // support legs
    const gy = levelBaseY(level, l.cx);
    c.strokeStyle = th.wood;
    c.lineWidth = Math.max(2, 0.16 * scale);
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

function saws(c: CanvasRenderingContext2D, world: PhysWorld, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
  for (const s of world.saws) {
    const cx = sx(s.x);
    const cy = sy(s.y);
    const r = s.r * scale;
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
    c.fillStyle = '#8a8a96';
    c.beginPath();
    c.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#55555e';
    c.beginPath();
    c.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    c.fill();
    c.restore();
    // hanger arm above the blade
    c.strokeStyle = 'rgba(0,0,0,0.4)';
    c.lineWidth = Math.max(1.5, 0.08 * scale);
    c.beginPath();
    c.moveTo(cx, cy - r * 1.1);
    c.lineTo(cx, cy - r * 1.1 - 2.2 * scale);
    c.stroke();
  }
}

function checkpointsAndFinish(c: CanvasRenderingContext2D, level: Level, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
  // checkpoint flags
  level.checkpoints.forEach((x, i) => {
    const gy = levelBaseY(level, x);
    const px = sx(x);
    const py = sy(gy);
    const taken = i < run.cp;
    c.strokeStyle = taken ? '#ffcf5e' : 'rgba(255,255,255,0.75)';
    c.lineWidth = Math.max(1.5, 0.06 * scale);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, py - 2.1 * scale);
    c.stroke();
    const wave = Math.sin(run.t * 5 + i) * 0.12;
    c.fillStyle = taken ? '#ff6a2b' : 'rgba(255,255,255,0.5)';
    c.beginPath();
    c.moveTo(px, py - 2.1 * scale);
    c.lineTo(px + (0.9 + wave) * scale, py - 1.8 * scale);
    c.lineTo(px, py - 1.45 * scale);
    c.closePath();
    c.fill();
  });
  // finish banner
  const fx = sx(level.finishX);
  const gy = levelBaseY(level, level.finishX);
  const fy = sy(gy);
  const poleH = 3 * scale;
  c.strokeStyle = '#e8e8ee';
  c.lineWidth = Math.max(2, 0.1 * scale);
  c.beginPath();
  c.moveTo(fx, fy);
  c.lineTo(fx, fy - poleH);
  c.stroke();
  const bw = 1.7 * scale;
  const bh = 0.55 * scale;
  const cols = 6;
  for (let i = 0; i < cols * 2; i++) {
    c.fillStyle = i % 2 ? '#14141a' : '#f2f2f6';
    c.fillRect(fx + (i < cols ? i : i - cols) * (bw / cols), fy - poleH + (i < cols ? 0 : bh / 2), bw / cols, bh / 2);
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

/** Bike pose in world units: chassis centre, angle and the two wheel centres. */
export type BikePose = { x: number; y: number; a: number; fwx: number; fwy: number; rwx: number; rwy: number; fwr: number; rwr: number };

/** Draws the bike and rider. Local bike coords are y-up; wheels sit at their real (sprung) positions. */
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
  // a chassis-local point (y up) to screen space
  const P = (lx: number, ly: number) => [sx(b.x + lx * cs - ly * sn), sy(b.y + lx * sn + ly * cs)] as const;
  const r = WHEEL_R * scale;
  const fw = [sx(b.fwx), sy(b.fwy)] as const;
  const rw = [sx(b.rwx), sy(b.rwy)] as const;

  const wheel = (wx: number, wy: number, rot: number) => {
    c.fillStyle = '#1d1d22';
    c.beginPath();
    c.arc(wx, wy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#8f95a0';
    c.lineWidth = Math.max(1, 0.05 * scale);
    c.beginPath();
    c.arc(wx, wy, r * 0.62, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = ghost ? '#666' : '#c9ced8';
    c.lineWidth = Math.max(1, 0.04 * scale);
    for (let i = 0; i < 3; i++) {
      const sa = rot + (i * Math.PI * 2) / 3;
      c.beginPath();
      c.moveTo(wx, wy);
      c.lineTo(wx + Math.cos(sa) * r * 0.6, wy + Math.sin(sa) * r * 0.6);
      c.stroke();
    }
  };

  // frame: rear axle -> seat -> steering head -> front axle, plus the swingarm
  const seat = P(-0.1, 0.12);
  const head = P(0.52, 0.34);
  c.strokeStyle = ghost ? '#999' : accent;
  c.lineWidth = Math.max(2, 0.12 * scale);
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(rw[0], rw[1]);
  c.lineTo(seat[0], seat[1]);
  c.lineTo(head[0], head[1]);
  c.lineTo(fw[0], fw[1]);
  c.moveTo(seat[0], seat[1]);
  c.lineTo(...P(0.14, -0.06));
  c.lineTo(rw[0], rw[1]);
  c.stroke();
  // seat pad and tank
  c.strokeStyle = '#26262c';
  c.lineWidth = Math.max(2, 0.14 * scale);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(...P(-0.34, 0.2));
  c.lineTo(...P(0.1, 0.23));
  c.stroke();

  // rider: hips at the seat, torso shifting with lean, accent helmet
  const hip = P(-0.05, 0.3);
  const sho = P(-0.05 + 0.16 + lean * 0.2, 0.82);
  const helm = P(-0.05 + 0.26 + lean * 0.3, 1.04);
  c.strokeStyle = ghost ? '#ccc' : '#2c2c33';
  c.lineWidth = Math.max(2, 0.11 * scale);
  c.beginPath();
  c.moveTo(hip[0], hip[1]);
  c.lineTo(sho[0], sho[1]);
  // arm to the bars
  c.moveTo(sho[0], sho[1]);
  c.lineTo(...P(0.56, 0.4));
  // legs down to the peg
  c.moveTo(hip[0], hip[1]);
  c.lineTo(...P(0.08, 0.05));
  c.lineTo(...P(0.0, -0.04));
  c.stroke();
  c.fillStyle = ghost ? '#ddd' : accent;
  c.beginPath();
  c.arc(helm[0], helm[1], Math.max(2.5, HEAD_R * scale), 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.5)';
  c.beginPath();
  c.arc(helm[0] + 0.05 * scale, helm[1], Math.max(1, 0.07 * scale), -0.6, 0.9);
  c.fill();

  wheel(rw[0], rw[1], b.rwr);
  wheel(fw[0], fw[1], b.fwr);
  c.globalAlpha = 1;

  if (name) {
    c.save();
    c.globalAlpha = 0.9;
    c.font = `600 11px ${FONT}`;
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    const top = P(0, 1.5);
    c.fillText(name, top[0], top[1] - 8);
    c.restore();
  }
}

/** Tumbling rider during a crash: a helmet and a body blob spinning off. */
function wreck(c: CanvasRenderingContext2D, run: Run, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
  const b = run.bike;
  const t = run.crashT;
  // the bike keeps sliding where it fell
  drawBike(c, sx, sy, { x: b.p.x, y: b.p.y, a: b.a + t * 3, fwx: b.fw.p.x, fwy: b.fw.p.y, rwx: b.rw.p.x, rwy: b.rw.p.y, fwr: 0, rwr: 0 }, scale, '#ff6a2b', 0, false, null, false);
  // the rider tumbles ahead
  const rx = b.p.x + 0.8 + t * Math.max(2, b.v.x * 0.6);
  const ry = b.p.y + 0.6 + Math.sin(Math.min(Math.PI, t * 4)) * 1.2;
  c.save();
  c.translate(sx(rx), sy(ry));
  c.rotate(-t * 7);
  c.strokeStyle = '#2c2c33';
  c.lineWidth = Math.max(2, 0.11 * scale);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(0, -0.28 * scale);
  c.lineTo(0, 0.24 * scale);
  c.moveTo(-0.22 * scale, 0.1 * scale);
  c.lineTo(0.22 * scale, -0.06 * scale);
  c.moveTo(-0.18 * scale, -0.3 * scale);
  c.lineTo(0.18 * scale, -0.3 * scale);
  c.stroke();
  c.fillStyle = '#ff6a2b';
  c.beginPath();
  c.arc(0, -0.4 * scale, Math.max(2.5, 0.17 * scale), 0, Math.PI * 2);
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

function hud(c: CanvasRenderingContext2D, w: number, h: number, run: Run, ghosts: Ghost[], scale: number) {
  const level = run.level;
  const cx = w / 2;
  // progress bar along the top
  const bw = Math.min(w * 0.42, 340);
  const bx = cx - bw / 2;
  const by = 14;
  const prog = clamp((run.bike.p.x - level.start.x) / (level.finishX - level.start.x), 0, 1);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.roundRect(bx - 6, by - 5, bw + 12, 14, 7);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fillRect(bx, by, bw, 4);
  c.fillStyle = '#ff6a2b';
  c.fillRect(bx, by, bw * prog, 4);
  // checkpoint ticks and finish
  c.fillStyle = 'rgba(255,255,255,0.6)';
  for (const cp of level.checkpoints) {
    const t = (cp - level.start.x) / (level.finishX - level.start.x);
    c.fillRect(bx + bw * t - 1, by - 2, 2, 8);
  }
  for (const g of ghosts) {
    const t = clamp((g.x - level.start.x) / (level.finishX - level.start.x), 0, 1);
    c.fillStyle = g.color;
    c.beginPath();
    c.arc(bx + bw * t, by + 2, 3, 0, Math.PI * 2);
    c.fill();
  }
  // level name under the bar
  c.font = `600 11px ${FONT}`;
  c.textAlign = 'center';
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fillText(level.name, cx, by + 24);

  // countdown
  if (run.phase === 'count') {
    const n = Math.ceil(run.countT);
    c.font = `800 ${Math.min(64, h * 0.3)}px ${FONT}`;
    c.fillStyle = n <= 0 ? '#7ddf8a' : '#fff';
    c.textAlign = 'center';
    c.fillText(n > 0 ? String(n) : 'Go', cx, h * 0.42);
  } else if (run.phase === 'wait') {
    c.font = `600 13px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.textAlign = 'center';
    c.fillText('waiting for the host', cx, h * 0.42);
  }

  // toasts
  c.textAlign = 'center';
  run.toasts.forEach((t, i) => {
    const age = run.t - t.t;
    if (age > 1.8) return;
    c.globalAlpha = Math.min(1, 1.8 - age);
    c.font = `700 15px ${FONT}`;
    c.fillStyle = '#fff';
    c.fillText(t.text, cx, h * 0.3 + i * 20);
  });
  c.globalAlpha = 1;
}
