import { DEADLINE_Y, FIELD_H, FIELD_W, R, ROW_H, SHOOTER, cellCenter, lowestBubbleBottom, type Game, type Pt } from './logic';

export const PALETTE = [
  { base: '#ff453a', light: '#ffb0aa', dark: '#9e1209' },
  { base: '#ff9f0a', light: '#ffd596', dark: '#9c5600' },
  { base: '#ffd60a', light: '#fff3a8', dark: '#9a7c00' },
  { base: '#30d158', light: '#aef3c0', dark: '#0f6f28' },
  { base: '#0a84ff', light: '#9ccbff', dark: '#00449c' },
  { base: '#bf5af2', light: '#ebc4fb', dark: '#661a92' },
] as const;

export const NEXT: Pt = { x: SHOOTER.x - 104, y: SHOOTER.y + 10 };
export const NEXT_R = R * 0.82;

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; delay: number };
export type Popping = { x: number; y: number; color: number; delay: number; t: number };
export type Falling = { x: number; y: number; vx: number; vy: number; color: number; t: number };
export type FloatText = { x: number; y: number; text: string; size: number; color: string; t: number; life: number };
export type View = {
  game: Game;
  aim: number;
  guide: { points: Pt[]; cell: { r: number; c: number } | null } | null;
  particles: Particle[];
  popping: Popping[];
  falling: Falling[];
  texts: FloatText[];
  shake: number;
  kick: number;
  swapAnim: number;
  banner: { title: string; detail: string } | null;
  hint: string | null;
  calm: boolean;
};

export type Fit = { scale: number; x: number; y: number };

/** Field placement in CSS px. Uses the top strip only when the score pill and controls would overlap the board. */
export function fitField(w: number, h: number): Fit {
  const fitWith = (top: number) => {
    const scale = Math.max(0.05, Math.min((w - 16) / FIELD_W, (h - top - 8) / FIELD_H));
    return { scale, x: (w - FIELD_W * scale) / 2, y: top + Math.max(0, (h - top - 8 - FIELD_H * scale) / 2) };
  };
  const roomy = fitWith(8);
  return roomy.x >= 150 ? roomy : fitWith(50);
}

export function toField(fit: Fit, x: number, y: number): Pt {
  return { x: (x - fit.x) / fit.scale, y: (y - fit.y) / fit.scale };
}

const sprites = new Map<string, HTMLCanvasElement>();

function sprite(color: number, px: number): HTMLCanvasElement {
  const key = `${color}:${px}`;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size > 80) sprites.clear();
  const pad = 2;
  const size = px * 2 + pad * 2;
  s = document.createElement('canvas');
  s.width = size;
  s.height = size;
  const c = s.getContext('2d');
  if (c) {
    const p = PALETTE[color % PALETTE.length];
    const cx = size / 2;
    const g = c.createRadialGradient(cx - px * 0.35, cx - px * 0.4, px * 0.1, cx, cx, px);
    g.addColorStop(0, p.light);
    g.addColorStop(0.5, p.base);
    g.addColorStop(1, p.dark);
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cx, px - 0.5, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = Math.max(1, px * 0.06);
    c.stroke();
    const rim = c.createRadialGradient(cx, cx, px * 0.72, cx, cx, px);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(1, 'rgba(255,255,255,0.16)');
    c.fillStyle = rim;
    c.beginPath();
    c.arc(cx, cx, px - 0.5, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(cx - px * 0.34, cx - px * 0.42);
    c.rotate(-0.6);
    c.fillStyle = 'rgba(255,255,255,0.62)';
    c.beginPath();
    c.ellipse(0, 0, px * 0.3, px * 0.17, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.arc(cx + px * 0.38, cx + px * 0.36, px * 0.08, 0, Math.PI * 2);
    c.fill();
  }
  sprites.set(key, s);
  return s;
}

function bubble(c: CanvasRenderingContext2D, fit: Fit, dpr: number, x: number, y: number, color: number, r = R, alpha = 1) {
  if (r <= 0.2) return;
  const px = Math.max(2, Math.round(r * fit.scale * dpr));
  const s = sprite(color, px);
  const unit = r / px;
  c.globalAlpha = alpha;
  c.drawImage(s, x - (px + 2) * unit, y - (px + 2) * unit, s.width * unit, s.height * unit);
  c.globalAlpha = 1;
}

function danger(game: Game) {
  return game.shotsUntilDrop <= 1 || game.dropTimer < 3;
}

export function draw(c: CanvasRenderingContext2D | null, w: number, h: number, dpr: number, v: View) {
  if (!c || w <= 0 || h <= 0) return;
  const g = v.game;
  const fit = fitField(w, h);
  c.clearRect(0, 0, w, h);
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#151a33');
  bg.addColorStop(1, '#07080f');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  c.save();
  if (v.shake > 0 && !v.calm) c.translate((Math.random() - 0.5) * 10 * v.shake, (Math.random() - 0.5) * 10 * v.shake);
  c.translate(fit.x, fit.y);
  c.scale(fit.scale, fit.scale);

  c.save();
  c.beginPath();
  c.roundRect(0, 0, FIELD_W, FIELD_H, 18);
  const field = c.createLinearGradient(0, 0, 0, FIELD_H);
  field.addColorStop(0, '#1d2447');
  field.addColorStop(0.75, '#141832');
  field.addColorStop(1, '#10132a');
  c.fillStyle = field;
  c.fill();
  c.clip();

  // Ceiling plate.
  const plate = Math.max(0, g.ceiling);
  if (plate > 0) {
    const pg = c.createLinearGradient(0, 0, 0, plate);
    pg.addColorStop(0, '#3a4166');
    pg.addColorStop(1, '#4c5585');
    c.fillStyle = pg;
    c.fillRect(0, 0, FIELD_W, plate);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (let x = 20; x < FIELD_W; x += 40) {
      c.beginPath();
      c.arc(x, plate - 8, 2.4, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.fillStyle = danger(g) && !g.ended ? '#ff453a' : 'rgba(255,255,255,0.35)';
  c.fillRect(0, plate, FIELD_W, 2);
  // Timed drop bar along the ceiling edge.
  const left = Math.max(0, Math.min(1, g.dropTimer / g.dropInterval));
  c.fillStyle = g.dropTimer < 5 ? 'rgba(255,69,58,0.9)' : 'rgba(255,255,255,0.55)';
  c.fillRect(0, plate + 2, FIELD_W * left, 3);

  // Deadline.
  const low = lowestBubbleBottom(g);
  const near = low > DEADLINE_Y - ROW_H * 2;
  c.strokeStyle = near ? 'rgba(255,69,58,0.75)' : 'rgba(255,255,255,0.14)';
  c.lineWidth = 2;
  c.setLineDash([8, 8]);
  c.beginPath();
  c.moveTo(0, DEADLINE_Y);
  c.lineTo(FIELD_W, DEADLINE_Y);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(0, DEADLINE_Y + 1, FIELD_W, FIELD_H - DEADLINE_Y);

  // Grid, with the classic wobble just before the ceiling drops.
  const wobble = danger(g) && !g.ended && !v.calm && g.levelBanner <= 0 ? Math.sin(g.time * 42) * 1.4 : 0;
  for (let r = 0; r < g.grid.length; r++) {
    const row = g.grid[r];
    for (let col = 0; col < row.length; col++) {
      if (row[col] < 0) continue;
      const p = cellCenter(g, r, col);
      bubble(c, fit, dpr, p.x + wobble, p.y, row[col]);
    }
  }

  for (const p of v.popping) {
    const t = p.t - p.delay;
    if (t < 0) {
      bubble(c, fit, dpr, p.x, p.y, p.color);
      continue;
    }
    const k = Math.min(1, t / 0.16);
    bubble(c, fit, dpr, p.x, p.y, p.color, R * (1 + k * 0.35), 1 - k);
    c.strokeStyle = PALETTE[p.color].light;
    c.globalAlpha = (1 - k) * 0.8;
    c.lineWidth = 3 * (1 - k) + 0.5;
    c.beginPath();
    c.arc(p.x, p.y, R * (1 + k * 0.9), 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }
  for (const f of v.falling) bubble(c, fit, dpr, f.x, f.y, f.color, R, Math.max(0, 1 - f.t / 1.4));

  // Aim guide: flowing dots along the exact path, then a ghost where the bubble will land.
  if (v.guide && v.guide.points.length > 1 && !g.ended && g.levelBanner <= 0) {
    const pts = v.guide.points;
    const tint = PALETTE[g.current].light;
    const gap = 17;
    let travelled = 0;
    let next = R * 1.6 + ((g.time * 46) % gap);
    c.fillStyle = tint;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const end = i === pts.length - 1 ? len - R * 1.1 : len;
      while (next - travelled <= end) {
        const t = (next - travelled) / len;
        c.globalAlpha = Math.max(0.18, 0.85 - next / 1400);
        c.beginPath();
        c.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3.2, 0, Math.PI * 2);
        c.fill();
        next += gap;
      }
      travelled += len;
    }
    c.globalAlpha = 1;
    const end = pts[pts.length - 1];
    c.strokeStyle = tint;
    c.globalAlpha = 0.6;
    c.lineWidth = 2;
    c.setLineDash([5, 5]);
    c.beginPath();
    c.arc(end.x, end.y, R - 2, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
  }

  if (g.shot) {
    const s = g.shot;
    const prev = s.points[Math.max(0, s.seg)];
    const dx = s.pos.x - prev.x;
    const dy = s.pos.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 3; i >= 1; i--) bubble(c, fit, dpr, s.pos.x - (dx / len) * i * 9, s.pos.y - (dy / len) * i * 9, s.color, R * (1 - i * 0.12), 0.18);
    bubble(c, fit, dpr, s.pos.x, s.pos.y, s.color);
  }

  drawLauncher(c, fit, dpr, v);

  for (const p of v.particles) {
    if (p.delay > 0) continue;
    c.globalAlpha = Math.max(0, p.life / p.max);
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  c.restore();

  c.strokeStyle = 'rgba(255,255,255,0.1)';
  c.lineWidth = 1 / fit.scale;
  c.beginPath();
  c.roundRect(0, 0, FIELD_W, FIELD_H, 18);
  c.stroke();
  c.restore();

  drawHud(c, fit, v);
}

function drawLauncher(c: CanvasRenderingContext2D, fit: Fit, dpr: number, v: View) {
  const g = v.game;
  const { x, y } = SHOOTER;
  c.save();
  c.translate(x, y);
  c.rotate(-v.aim + Math.PI / 2);
  const barrel = c.createLinearGradient(-9, 0, 9, 0);
  barrel.addColorStop(0, '#59608c');
  barrel.addColorStop(0.5, '#a3abd6');
  barrel.addColorStop(1, '#59608c');
  c.fillStyle = barrel;
  c.beginPath();
  c.roundRect(-9, -R - 26, 18, 30, 6);
  c.fill();
  c.restore();

  c.fillStyle = '#262c52';
  c.beginPath();
  c.arc(x, y, R + 7, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.lineWidth = 2;
  c.stroke();
  const load = v.kick > 0 ? 1 - v.kick / 0.16 : 1;
  if (!g.ended) bubble(c, fit, dpr, x, y, g.current, R * (0.55 + 0.45 * load));

  const sw = v.swapAnim > 0 ? v.swapAnim / 0.18 : 0;
  c.fillStyle = 'rgba(255,255,255,0.07)';
  c.beginPath();
  c.arc(NEXT.x, NEXT.y, NEXT_R + 6, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 1.5;
  c.stroke();
  if (!g.ended) bubble(c, fit, dpr, NEXT.x, NEXT.y - sw * 10, g.next, NEXT_R * (1 - sw * 0.3));
}

function drawHud(c: CanvasRenderingContext2D, fit: Fit, v: View) {
  const g = v.game;
  const sx = (x: number) => fit.x + x * fit.scale;
  const sy = (y: number) => fit.y + y * fit.scale;
  const font = (weight: number, size: number) => `${weight} ${size}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
  c.textBaseline = 'middle';

  c.fillStyle = 'rgba(245,245,247,0.6)';
  c.font = font(600, 12);
  c.textAlign = 'center';
  c.fillText('Next', sx(NEXT.x), Math.max(sy(DEADLINE_Y) + 9, sy(NEXT.y - NEXT_R - 6) - 9));

  const rx = sx(SHOOTER.x + 104);
  const ry = sy(SHOOTER.y + 2);
  c.fillStyle = 'rgba(245,245,247,0.85)';
  c.font = font(650, 13);
  c.fillText(`Level ${g.level}`, rx, ry - 9);
  const n = g.dropEvery;
  const room = (FIELD_W - SHOOTER.x - R - 16) * fit.scale;
  const gap = Math.min(10, room / n);
  const dot = Math.min(3.2, gap * 0.36);
  const warn = g.shotsUntilDrop <= 1;
  for (let i = 0; i < n; i++) {
    c.fillStyle = i < g.shotsUntilDrop ? (warn ? '#ff453a' : 'rgba(245,245,247,0.8)') : 'rgba(245,245,247,0.18)';
    c.beginPath();
    c.arc(rx - ((n - 1) * gap) / 2 + i * gap, ry + 9, dot, 0, Math.PI * 2);
    c.fill();
  }

  for (const t of v.texts) {
    const k = t.t / t.life;
    c.globalAlpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
    c.font = font(700, t.size);
    c.textAlign = 'center';
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(8,10,20,0.7)';
    const x = sx(t.x);
    const y = sy(t.y) - k * 36;
    c.strokeText(t.text, x, y);
    c.fillStyle = t.color;
    c.fillText(t.text, x, y);
  }
  c.globalAlpha = 1;

  if (v.hint && g.shots === 0 && !g.ended) {
    c.font = font(600, 13);
    c.textAlign = 'center';
    c.fillStyle = `rgba(245,245,247,${0.55 + Math.sin(g.time * 3) * 0.2})`;
    c.fillText(v.hint, sx(FIELD_W / 2), sy(DEADLINE_Y - 24));
  }

  if (v.banner && g.levelBanner > 0) {
    const cx = sx(FIELD_W / 2);
    const cy = sy(FIELD_H * 0.42);
    const bw = Math.min(FIELD_W * fit.scale - 24, 280);
    c.fillStyle = 'rgba(12,14,28,0.82)';
    c.beginPath();
    c.roundRect(cx - bw / 2, cy - 44, bw, 88, 18);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 1;
    c.stroke();
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    c.font = font(700, 22);
    c.fillText(v.banner.title, cx, cy - 12);
    c.fillStyle = '#ffd60a';
    c.font = font(650, 14);
    c.fillText(v.banner.detail, cx, cy + 18);
  }
}
