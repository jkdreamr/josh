// Canvas art for Flappy Tree. Everything is drawn in world units (see logic.ts) with original vector shapes.
import { COL_W, type Medal } from './logic';

export const CAP = 26;

export const hash = (n: number) => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};

function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

function tier(c: CanvasRenderingContext2D, y: number, w: number, h: number, light: string, dark: string) {
  const g = c.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.strokeStyle = g;
  c.lineJoin = 'round';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(-w / 2, y);
  c.quadraticCurveTo(0, y + 3.5, w / 2, y);
  c.lineTo(0, y - h);
  c.closePath();
  c.fill();
  c.stroke();
}

export type TreePose = { wing: number; blink: boolean; dead: boolean; t: number };

/** The mascot: a round little redwood with a face and one leafy arm. Origin is the collision center. */
export function tree(c: CanvasRenderingContext2D, p: TreePose) {
  c.fillStyle = '#7b4a2b';
  rrect(c, -3.4, 10, 6.8, 9.5, 2.4);
  c.fill();
  c.fillStyle = '#5e3720';
  rrect(c, 0.6, 10, 2.8, 9.5, 1.2);
  c.fill();

  // arm behind the canopy
  const flutter = p.dead ? 0.5 : -0.25 - p.wing * 1.15 + Math.sin(p.t * 9) * 0.08 * (1 - p.wing);
  c.save();
  c.translate(-9, 5);
  c.rotate(Math.PI + flutter);
  c.fillStyle = '#2e8e55';
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(7, -6.5, 15, 0);
  c.quadraticCurveTo(7, 6.5, 0, 0);
  c.fill();
  c.strokeStyle = 'rgba(12,60,34,0.45)';
  c.lineWidth = 0.9;
  c.beginPath();
  c.moveTo(1, 0);
  c.lineTo(13, 0);
  c.stroke();
  c.restore();

  tier(c, 12, 34, 16, '#2a8a52', '#17603a');
  tier(c, 3, 28, 15, '#31995b', '#1b6e42');
  tier(c, -6.5, 20, 14, '#3aaa66', '#22804c');
  // top glint
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.beginPath();
  c.ellipse(-2.6, -15.5, 1.3, 2.6, 0.5, 0, Math.PI * 2);
  c.fill();

  // face
  const ex = [1.2, 7.4];
  if (p.dead) {
    c.strokeStyle = '#0d2417';
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    for (const x of ex) {
      c.beginPath();
      c.moveTo(x - 2, -3);
      c.lineTo(x + 2, 1);
      c.moveTo(x + 2, -3);
      c.lineTo(x - 2, 1);
      c.stroke();
    }
  } else if (p.blink) {
    c.strokeStyle = '#0d2417';
    c.lineWidth = 1.4;
    c.lineCap = 'round';
    for (const x of ex) {
      c.beginPath();
      c.moveTo(x - 2.3, -1);
      c.quadraticCurveTo(x, 0.6, x + 2.3, -1);
      c.stroke();
    }
  } else {
    for (const x of ex) {
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x, -1, 3.1, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0d2417';
      c.beginPath();
      c.arc(x + 1, -0.6, 1.65, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x + 1.6, -1.4, 0.55, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.fillStyle = 'rgba(255,140,150,0.55)';
  c.beginPath();
  c.ellipse(10.2, 3.6, 2.1, 1.3, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#0d2417';
  c.lineWidth = 1.2;
  c.lineCap = 'round';
  c.beginPath();
  if (p.dead) {
    c.moveTo(2.6, 5.4);
    c.quadraticCurveTo(4.6, 4, 6.6, 5.4);
  } else {
    c.moveTo(2.8, 3.6);
    c.quadraticCurveTo(4.6, 5.6, 6.4, 3.6);
  }
  c.stroke();
}

function pillar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (h <= 0) return;
  const g = c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#9e1d1a');
  g.addColorStop(0.32, '#b8332c');
  g.addColorStop(0.7, '#8c1515');
  g.addColorStop(1, '#6a0e0e');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.fillRect(x + w * 0.16, y, 4, h);
}

function cap(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const g = c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#a82420');
  g.addColorStop(0.3, '#c43c33');
  g.addColorStop(0.72, '#951818');
  g.addColorStop(1, '#700f0f');
  c.fillStyle = g;
  rrect(c, x, y, w, h, 5);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.2)';
  rrect(c, x + w * 0.14, y + 4, 4, h - 8, 2);
  c.fill();
}

/** A cardinal red column pair with a gap centered on gapY. `open` pushes both halves out of view while it rises in. */
export function column(c: CanvasRenderingContext2D, x: number, gapY: number, gap: number, groundY: number, open = 0) {
  const top = gapY - gap / 2;
  const bot = gapY + gap / 2;
  c.save();
  c.translate(0, -open);
  pillar(c, x, -20 - open, COL_W, top - CAP + 20 + open);
  cap(c, x - 4, top - CAP, COL_W + 8, CAP);
  c.fillStyle = 'rgba(60,0,0,0.18)';
  c.fillRect(x, top - 1, COL_W, 1);
  c.restore();
  if (open > 0) {
    c.save();
    c.beginPath();
    c.rect(x - 10, -1000, COL_W + 20, groundY + 1000);
    c.clip();
  }
  pillar(c, x, bot + CAP + open, COL_W, groundY - bot - CAP);
  cap(c, x - 4, bot + open, COL_W + 8, CAP);
  c.fillStyle = 'rgba(60,0,0,0.18)';
  c.fillRect(x, bot + CAP + open, COL_W, 3);
  if (open > 0) c.restore();
}

/** Sky and scenery colors from morning (0) through golden hour (1) and sunset (2) to night (3). */
export type Palette = { top: string; mid: string; low: string; sun: string; far: string; dish: string; near: string; pines: string; cloud: string; dusk: number; night: number };

const SKIES: Omit<Palette, 'dusk' | 'night'>[] = [
  { top: '#bcdcf2', mid: '#e4f0f4', low: '#f8efdf', sun: '#fff8e2', far: '#c2dacb', dish: '#eef2ee', near: '#a3cba9', pines: '#86b58e', cloud: '#ffffff' },
  { top: '#9cc7e6', mid: '#f1e3c8', low: '#ffd8a3', sun: '#ffe7b0', far: '#c6cfa6', dish: '#f6ecd6', near: '#a2bd86', pines: '#86a573', cloud: '#fff3df' },
  { top: '#6b78b4', mid: '#e7a39d', low: '#ffbd80', sun: '#ffb070', far: '#a597a6', dish: '#e8cfc8', near: '#869a7f', pines: '#6a8566', cloud: '#ffd6c4' },
  { top: '#111a38', mid: '#25336a', low: '#45548a', sun: '#ffd27a', far: '#36456a', dish: '#5d6c94', near: '#2c474e', pines: '#21403e', cloud: '#7b88b4' },
];

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  const ch = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

export function palette(tod: number): Palette {
  const t = Math.min(3, Math.max(0, tod));
  const i = Math.min(2, Math.floor(t));
  const f = t - i;
  const a = SKIES[i];
  const b = SKIES[i + 1];
  const out = {} as Palette;
  for (const k of Object.keys(a) as (keyof typeof a)[]) out[k] = mix(a[k], b[k], f);
  out.dusk = Math.min(1, Math.max(0, t - 1));
  out.night = Math.min(1, Math.max(0, t - 2));
  return out;
}

/** A field of twinkling stars for the night sky, fixed to the view. */
export function stars(c: CanvasRenderingContext2D, vw: number, t: number, alpha: number) {
  if (alpha <= 0) return;
  c.fillStyle = '#ffffff';
  const n = Math.round(vw / 14);
  for (let i = 0; i < n; i++) {
    const h = hash(i * 31 + 7);
    const x = (h % 10000) / 10000 * vw;
    const y = ((h >>> 12) % 1000) / 1000 * 360;
    const tw = 0.55 + 0.45 * Math.sin(t * (1.2 + (h % 7) * 0.3) + i);
    c.globalAlpha = alpha * tw * (0.35 + ((h >>> 22) % 10) / 15);
    c.fillRect(x, y, 1.6 + (h % 3) * 0.5, 1.6 + (h % 3) * 0.5);
  }
  c.globalAlpha = 1;
}

export function moon(c: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha = alpha;
  const glow = c.createRadialGradient(x, y, 10, x, y, 70);
  glow.addColorStop(0, 'rgba(220,230,255,0.35)');
  glow.addColorStop(1, 'rgba(220,230,255,0)');
  c.fillStyle = glow;
  c.fillRect(x - 70, y - 70, 140, 140);
  c.fillStyle = '#f4f1e4';
  c.beginPath();
  c.arc(x, y, 17, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(190,190,175,0.5)';
  c.beginPath();
  c.arc(x - 5, y - 4, 3.6, 0, Math.PI * 2);
  c.arc(x + 6, y + 5, 2.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

export function cloud(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.beginPath();
  c.arc(x, y, 16 * s, 0, Math.PI * 2);
  c.arc(x + 18 * s, y - 9 * s, 20 * s, 0, Math.PI * 2);
  c.arc(x + 40 * s, y - 2 * s, 15 * s, 0, Math.PI * 2);
  c.rect(x, y - 2 * s, 40 * s, 16 * s);
  c.fill();
}

export const ridge = (x: number, base: number, amp: number, seed: number) =>
  base - amp * (0.55 * Math.sin(x * 0.006 + seed) + 0.3 * Math.sin(x * 0.013 + seed * 2.1) + 0.15 * Math.sin(x * 0.031 + seed * 3.7));

export function hills(c: CanvasRenderingContext2D, vw: number, off: number, base: number, amp: number, seed: number, color: string, bottom: number) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(-10, bottom);
  for (let x = -10; x <= vw + 24; x += 12) c.lineTo(x, ridge(x + off, base, amp, seed));
  c.lineTo(vw + 24, bottom);
  c.closePath();
  c.fill();
}

/** A small radio dish perched on the far foothills. */
export function dish(c: CanvasRenderingContext2D, x: number, y: number, color: string) {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x - 6, y);
  c.lineTo(x, y - 12);
  c.lineTo(x + 6, y);
  c.stroke();
  c.save();
  c.translate(x, y - 15);
  c.rotate(-0.5);
  c.beginPath();
  c.ellipse(0, 0, 13, 5, 0, 0, Math.PI);
  c.fill();
  c.restore();
}

export function conifer(c: CanvasRenderingContext2D, x: number, y: number, h: number) {
  c.beginPath();
  c.moveTo(x, y - h);
  c.lineTo(x + h * 0.34, y);
  c.lineTo(x - h * 0.34, y);
  c.closePath();
  c.fill();
}

/** Sandstone ground with a grass lip and diagonal stripes that scroll with the columns. */
export function ground(c: CanvasRenderingContext2D, vw: number, d: number, gy: number, bottom: number) {
  c.fillStyle = '#ead7b0';
  c.fillRect(-10, gy, vw + 20, bottom - gy + 4);
  c.save();
  c.beginPath();
  c.rect(-10, gy + 9, vw + 20, bottom - gy);
  c.clip();
  c.fillStyle = 'rgba(176,132,74,0.16)';
  const p = 28;
  const o = ((d % p) + p) % p;
  for (let x = -o - 40; x < vw + 60; x += p) {
    c.beginPath();
    c.moveTo(x, gy + 9);
    c.lineTo(x + 14, gy + 9);
    c.lineTo(x - 10, bottom + 4);
    c.lineTo(x - 24, bottom + 4);
    c.fill();
  }
  c.restore();
  c.fillStyle = '#7db86d';
  c.fillRect(-10, gy, vw + 20, 7);
  c.fillStyle = '#5f9a52';
  c.fillRect(-10, gy + 7, vw + 20, 2);
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.fillRect(-10, gy, vw + 20, 1.5);
}

const MEDAL: Record<Exclude<Medal, 'none'>, [string, string, string]> = {
  bronze: ['#f2bf8c', '#c27a3e', '#8a4f22'],
  silver: ['#fbfcfd', '#b8bfc7', '#7d858e'],
  gold: ['#fff1b0', '#e3b02a', '#a87a0c'],
  platinum: ['#ffffff', '#bfe0ee', '#6f9fb6'],
};

export function medal(c: CanvasRenderingContext2D, x: number, y: number, r: number, m: Exclude<Medal, 'none'>) {
  const [hi, mid, lo] = MEDAL[m];
  c.fillStyle = '#8c1515';
  c.beginPath();
  c.moveTo(x - r * 0.75, y - r * 2.1);
  c.lineTo(x - r * 0.1, y - r * 2.1);
  c.lineTo(x + r * 0.15, y - r * 0.6);
  c.lineTo(x - r * 0.5, y - r * 0.6);
  c.closePath();
  c.fill();
  c.fillStyle = '#b1302a';
  c.beginPath();
  c.moveTo(x + r * 0.75, y - r * 2.1);
  c.lineTo(x + r * 0.1, y - r * 2.1);
  c.lineTo(x - r * 0.15, y - r * 0.6);
  c.lineTo(x + r * 0.5, y - r * 0.6);
  c.closePath();
  c.fill();
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, hi);
  g.addColorStop(0.7, mid);
  g.addColorStop(1, lo);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.lineWidth = Math.max(1, r * 0.1);
  c.beginPath();
  c.arc(x, y, r * 0.74, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = lo;
  c.globalAlpha = 0.55;
  c.beginPath();
  c.moveTo(x, y - r * 0.5);
  c.lineTo(x + r * 0.34, y + r * 0.22);
  c.lineTo(x - r * 0.34, y + r * 0.22);
  c.closePath();
  c.fill();
  c.fillRect(x - r * 0.07, y + r * 0.22, r * 0.14, r * 0.22);
  c.globalAlpha = 1;
}
