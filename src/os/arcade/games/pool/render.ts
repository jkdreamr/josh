import { CUSHIONS, HEAD_X, L, POCKETS, R, W, FOOT, type Ball } from './logic.ts';

export const RAIL = 0.11;
const CUSH = 0.034;
const OUT_W = L + RAIL * 2;
const OUT_H = W + RAIL * 2;

export const BALL_COLORS = ['#f6f1e4', '#f2b705', '#1d4ed8', '#d42a2a', '#5b2a86', '#ef7a1a', '#168a4c', '#7c1d1d', '#141414'];
export const ballColor = (id: number) => BALL_COLORS[id > 8 ? id - 8 : id];

/** Table to screen mapping. Portrait screens stand the table up, head rail at the bottom. */
export type View = { rot: boolean; s: number; ox: number; oy: number; side: boolean; panelW: number; w: number; h: number };

export function layout(w: number, h: number): View {
  const rot = h > w * 1.12;
  if (rot) {
    const s = Math.max(10, Math.min((w - 20) / OUT_H, (h - 52 - 74) / OUT_W));
    const tw = OUT_H * s;
    const th = OUT_W * s;
    const top = 52 + Math.max(0, (h - 52 - 74 - th) / 2);
    return { rot, s, ox: (w - tw) / 2 + RAIL * s, oy: top + RAIL * s, side: false, panelW: 0, w, h };
  }
  const panelW = Math.round(Math.max(96, Math.min(150, w * 0.17)));
  const sSide = Math.min((w - panelW * 2 - 28) / OUT_W, (h - 14) / OUT_H);
  const sBottom = Math.min((w - 20) / OUT_W, (h - 48 - 66) / OUT_H);
  const side = sSide >= sBottom * 0.9;
  const s = Math.max(10, side ? sSide : sBottom);
  const tw = OUT_W * s;
  const th = OUT_H * s;
  const top = side ? (h - th) / 2 : 46 + Math.max(0, (h - 46 - 66 - th) / 2);
  return { rot, s, ox: (w - tw) / 2 + RAIL * s, oy: top + RAIL * s, side, panelW, w, h };
}

/** Outer table box on screen (rails included). */
export function tableBox(v: View) {
  const tw = (v.rot ? OUT_H : OUT_W) * v.s;
  const th = (v.rot ? OUT_W : OUT_H) * v.s;
  return { x: v.ox - RAIL * v.s, y: v.oy - RAIL * v.s, w: tw, h: th };
}

export const toScreen = (v: View, x: number, y: number) => (v.rot ? { x: v.ox + y * v.s, y: v.oy + (L - x) * v.s } : { x: v.ox + x * v.s, y: v.oy + y * v.s });
export const toTable = (v: View, X: number, Y: number) => (v.rot ? { x: L - (Y - v.oy) / v.s, y: (X - v.ox) / v.s } : { x: (X - v.ox) / v.s, y: (Y - v.oy) / v.s });

export function tableTransform(c: CanvasRenderingContext2D, v: View, dpr: number) {
  if (v.rot) c.setTransform(0, -v.s * dpr, v.s * dpr, 0, v.ox * dpr, (v.oy + L * v.s) * dpr);
  else c.setTransform(v.s * dpr, 0, 0, v.s * dpr, v.ox * dpr, v.oy * dpr);
}

/** Orientation of each ball: n is the number spot, a the stripe axis (kept perpendicular). Rolling turns both. */
export type Spin3 = { n: [number, number, number]; a: [number, number, number] };
export const freshSpins = (): Spin3[] => Array.from({ length: 16 }, () => ({ n: [0, 0, 1], a: [1, 0, 0] }));

function rotate(v: [number, number, number], k: [number, number, number], ang: number) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = k[1] * v[2] - k[2] * v[1];
  const y = k[2] * v[0] - k[0] * v[2];
  const z = k[0] * v[1] - k[1] * v[0];
  v[0] = v[0] * c + x * s + k[0] * d * (1 - c);
  v[1] = v[1] * c + y * s + k[1] * d * (1 - c);
  v[2] = v[2] * c + z * s + k[2] * d * (1 - c);
}

export function roll(sp: Spin3, dx: number, dy: number) {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-7) return;
  const k: [number, number, number] = [-dy / d, dx / d, 0];
  rotate(sp.n, k, d / R);
  rotate(sp.a, k, d / R);
}

export type Sink = { id: number; x: number; y: number; px: number; py: number; t: number };

export function drawTable(c: CanvasRenderingContext2D, opts: { kitchen: boolean; called: number | null; pulse: number }) {
  // Rails
  const wood = c.createLinearGradient(0, -RAIL, 0, W + RAIL);
  wood.addColorStop(0, '#5a3119');
  wood.addColorStop(0.5, '#3f2112');
  wood.addColorStop(1, '#5a3119');
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.beginPath();
  c.roundRect(-RAIL + 0.012, -RAIL + 0.02, OUT_W, OUT_H, 0.06);
  c.fill();
  c.fillStyle = wood;
  c.beginPath();
  c.roundRect(-RAIL, -RAIL, OUT_W, OUT_H, 0.06);
  c.fill();
  c.strokeStyle = 'rgba(255,220,180,0.16)';
  c.lineWidth = 0.006;
  c.beginPath();
  c.roundRect(-RAIL + 0.008, -RAIL + 0.008, OUT_W - 0.016, OUT_H - 0.016, 0.054);
  c.stroke();
  // Sights
  c.fillStyle = 'rgba(244,236,220,0.75)';
  const sight = (x: number, y: number) => {
    c.beginPath();
    c.arc(x, y, 0.009, 0, Math.PI * 2);
    c.fill();
  };
  for (const k of [1, 2, 3, 5, 6, 7]) {
    sight((L / 8) * k, -RAIL * 0.55);
    sight((L / 8) * k, W + RAIL * 0.55);
  }
  for (const k of [1, 2, 3]) {
    sight(-RAIL * 0.55, (W / 4) * k);
    sight(L + RAIL * 0.55, (W / 4) * k);
  }
  // Felt
  const felt = c.createRadialGradient(L / 2, W / 2, 0.1, L / 2, W / 2, L * 0.62);
  felt.addColorStop(0, '#22895a');
  felt.addColorStop(1, '#155f3d');
  c.fillStyle = felt;
  c.fillRect(-CUSH, -CUSH, L + CUSH * 2, W + CUSH * 2);
  // Pockets
  for (const p of POCKETS) {
    const r = p.side ? 0.064 : 0.07;
    c.fillStyle = '#2a1a10';
    c.beginPath();
    c.arc(p.x, p.y, r + 0.012, 0, Math.PI * 2);
    c.fill();
    const hole = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    hole.addColorStop(0, '#000');
    hole.addColorStop(1, '#0d0907');
    c.fillStyle = hole;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fill();
  }
  // Cushions: the rubber nose follows the physics segments
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#11533a';
  c.lineWidth = 0.022;
  for (const s of CUSHIONS) {
    const nx = s.ay === s.by ? 0 : s.ax === s.bx ? (s.ax < L / 2 ? -1 : 1) : 0;
    const ny = s.ay === s.by ? (s.ay < W / 2 ? -1 : 1) : 0;
    c.beginPath();
    c.moveTo(s.ax + nx * 0.011, s.ay + ny * 0.011);
    c.lineTo(s.bx + nx * 0.011, s.by + ny * 0.011);
    c.stroke();
  }
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.lineWidth = 0.004;
  for (const s of CUSHIONS) {
    c.beginPath();
    c.moveTo(s.ax, s.ay);
    c.lineTo(s.bx, s.by);
    c.stroke();
  }
  // Markings
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.beginPath();
  c.arc(FOOT.x, FOOT.y, 0.007, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(HEAD_X, W / 2, 0.007, 0, Math.PI * 2);
  c.fill();
  if (opts.kitchen) {
    c.fillStyle = 'rgba(255,255,255,0.045)';
    c.fillRect(0, 0, HEAD_X, W);
    c.strokeStyle = 'rgba(255,255,255,0.32)';
    c.lineWidth = 0.004;
    c.setLineDash([0.02, 0.016]);
    c.beginPath();
    c.moveTo(HEAD_X, 0);
    c.lineTo(HEAD_X, W);
    c.stroke();
    c.setLineDash([]);
  }
  if (opts.called !== null) {
    const p = POCKETS[opts.called];
    c.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * Math.sin(opts.pulse * 5)})`;
    c.lineWidth = 0.008;
    c.beginPath();
    c.arc(p.x, p.y, 0.085, 0, Math.PI * 2);
    c.stroke();
  }
}

export function drawBall(c: CanvasRenderingContext2D, b: { id: number; x: number; y: number }, sp: Spin3, v: View, scale = 1, alpha = 1) {
  const r = R * scale;
  const { x, y, id } = b;
  c.globalAlpha = alpha * 0.4;
  c.fillStyle = '#000';
  c.beginPath();
  c.ellipse(x + r * 0.22, y + r * 0.3, r * 1.02, r * 0.96, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = alpha;
  c.save();
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.clip();
  const stripe = id > 8;
  c.fillStyle = stripe ? '#f6f1e4' : ballColor(id);
  c.fillRect(x - r, y - r, r * 2, r * 2);
  const [ax, ay, az] = sp.a;
  if (stripe) {
    c.strokeStyle = ballColor(id);
    c.lineWidth = 2 * r * 0.6 * (1 - 0.68 * Math.abs(az));
    c.beginPath();
    c.ellipse(x, y, r, Math.max(0.0005, r * Math.abs(az)), Math.atan2(ay, ax), 0, Math.PI * 2);
    c.stroke();
  }
  const [nx, ny, nz] = sp.n;
  if (nz > -0.1) {
    const rs = id === 0 ? 0.2 : 0.5;
    const ang = Math.atan2(ny, nx);
    c.save();
    c.translate(x + nx * r, y + ny * r);
    c.rotate(ang);
    c.scale(Math.max(0.06, nz), 1);
    c.fillStyle = id === 0 ? '#c8322f' : '#f6f1e4';
    c.beginPath();
    c.arc(0, 0, r * rs, 0, Math.PI * 2);
    c.fill();
    c.restore();
    if (id > 0 && nz > 0.45 && r * v.s * 2 >= 13) {
      c.save();
      c.translate(x + nx * r, y + ny * r);
      if (v.rot) c.rotate(Math.PI / 2);
      c.globalAlpha = alpha * Math.min(1, (nz - 0.45) * 4);
      c.fillStyle = '#16161a';
      c.font = `700 ${r * (id > 9 ? 0.56 : 0.66)}px -apple-system, system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(id), 0, r * 0.04);
      c.restore();
      c.globalAlpha = alpha;
    }
  }
  const lx = v.rot ? x + r * 0.38 : x - r * 0.38;
  const ly = y - r * 0.4;
  const shine = c.createRadialGradient(lx, ly, 0, lx, ly, r * 0.75);
  shine.addColorStop(0, 'rgba(255,255,255,0.75)');
  shine.addColorStop(0.25, 'rgba(255,255,255,0.18)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = shine;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  const rim = c.createRadialGradient(x, y, r * 0.55, x, y, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.38)');
  c.fillStyle = rim;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
  c.globalAlpha = 1;
}

export function drawBalls(c: CanvasRenderingContext2D, balls: readonly Ball[], spins: Spin3[], v: View, cue: { x: number; y: number } | null, sinks: Sink[]) {
  for (const k of sinks) {
    const t = Math.min(1, k.t / 0.28);
    drawBall(c, { id: k.id, x: k.x + (k.px - k.x) * t, y: k.y + (k.py - k.y) * t }, spins[k.id], v, 1 - t * 0.45, 1 - t);
  }
  for (const b of balls) {
    if (b.down) continue;
    if (b.id === 0 && cue) drawBall(c, { id: 0, x: cue.x, y: cue.y }, spins[0], v);
    else drawBall(c, b, spins[b.id], v);
  }
}

export function drawHandRing(c: CanvasRenderingContext2D, x: number, y: number, ok: boolean, t: number) {
  c.strokeStyle = ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,90,80,0.95)';
  c.lineWidth = 0.005;
  c.setLineDash([0.012, 0.009]);
  c.lineDashOffset = -t * 0.05;
  c.beginPath();
  c.arc(x, y, R * 1.65, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.lineDashOffset = 0;
}

export function drawGuide(
  c: CanvasRenderingContext2D,
  from: { x: number; y: number },
  tr: { hit: number | null; ghost: { x: number; y: number }; cueDir: { x: number; y: number } | null; objDir: { x: number; y: number } | null; rail: { x: number; y: number } | null },
  legal: boolean,
  balls: readonly Ball[],
  px: number,
) {
  const end = tr.hit !== null ? tr.ghost : tr.rail ?? tr.ghost;
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.62)';
  c.lineWidth = 1.3 * px;
  c.beginPath();
  c.moveTo(from.x, from.y);
  c.lineTo(end.x, end.y);
  c.stroke();
  if (tr.hit === null) return;
  c.strokeStyle = legal ? 'rgba(255,255,255,0.8)' : 'rgba(255,95,85,0.95)';
  c.lineWidth = 1.3 * px;
  c.beginPath();
  c.arc(tr.ghost.x, tr.ghost.y, R, 0, Math.PI * 2);
  c.stroke();
  if (!legal) {
    const d = R * 0.5;
    c.beginPath();
    c.moveTo(tr.ghost.x - d, tr.ghost.y - d);
    c.lineTo(tr.ghost.x + d, tr.ghost.y + d);
    c.moveTo(tr.ghost.x + d, tr.ghost.y - d);
    c.lineTo(tr.ghost.x - d, tr.ghost.y + d);
    c.stroke();
    return;
  }
  const ob = balls[tr.hit];
  if (tr.objDir && ob) {
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 1.6 * px;
    c.beginPath();
    c.moveTo(ob.x + tr.objDir.x * R, ob.y + tr.objDir.y * R);
    c.lineTo(ob.x + tr.objDir.x * 0.3, ob.y + tr.objDir.y * 0.3);
    c.stroke();
  }
  if (tr.cueDir) {
    c.strokeStyle = 'rgba(255,255,255,0.32)';
    c.lineWidth = 1.2 * px;
    c.beginPath();
    c.moveTo(tr.ghost.x, tr.ghost.y);
    c.lineTo(tr.ghost.x + tr.cueDir.x * 0.18, tr.ghost.y + tr.cueDir.y * 0.18);
    c.stroke();
  }
}

/** Cue stick behind the ball, pulled back by power. */
export function drawCue(c: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, pull: number, alpha = 1) {
  const len = 1.25;
  const gap = R * 1.25 + pull * 0.24;
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  c.rotate(Math.atan2(dy, dx) + Math.PI);
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.beginPath();
  c.moveTo(gap + 0.01, 0.012);
  c.lineTo(gap + len + 0.01, 0.032);
  c.lineTo(gap + len + 0.01, -0.008);
  c.closePath();
  c.fill();
  const g = c.createLinearGradient(gap, 0, gap + len, 0);
  g.addColorStop(0, '#f4efe6');
  g.addColorStop(0.016, '#f4efe6');
  g.addColorStop(0.017, '#e3c991');
  g.addColorStop(0.6, '#c9a364');
  g.addColorStop(0.61, '#1e1b20');
  g.addColorStop(0.64, '#1e1b20');
  g.addColorStop(0.65, '#5a2a17');
  g.addColorStop(1, '#2a140b');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(gap, -0.0055);
  c.lineTo(gap + len, -0.014);
  c.lineTo(gap + len, 0.014);
  c.lineTo(gap, 0.0055);
  c.closePath();
  c.fill();
  c.fillStyle = '#3b82c4';
  c.fillRect(gap - 0.003, -0.0055, 0.004, 0.011);
  c.restore();
}

export function drawPower(c: CanvasRenderingContext2D, power: number) {
  const x0 = L * 0.32;
  const wBar = L * 0.36;
  const y = W + RAIL * 0.52;
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.beginPath();
  c.roundRect(x0, y - 0.013, wBar, 0.026, 0.013);
  c.fill();
  const g = c.createLinearGradient(x0, 0, x0 + wBar, 0);
  g.addColorStop(0, '#34c759');
  g.addColorStop(0.6, '#ffcc00');
  g.addColorStop(1, '#ff453a');
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(x0 + 0.004, y - 0.009, Math.max(0.018, (wBar - 0.008) * power), 0.018, 0.009);
  c.fill();
}
