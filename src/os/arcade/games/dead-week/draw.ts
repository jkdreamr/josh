// Doodle-sticker drawing helpers: thick marker outlines, highlighter fills, notebook paper. Everything in arena units
// for micro-games (1 unit is 1/100 of the arena), or pixels for the frame, whatever the caller's transform is.

export const INK = '#1d1b22';
export const PAPER = '#fbf8ef';
export const RULE = '#b9d3ee';
export const MARGIN = '#f29aa6';
export const CARDINAL = '#8c1515';
export const YELLOW = '#fff04a';
export const GREEN = '#7cf08a';
export const PINK = '#ff7fcf';
export const BLUE = '#7cc8ff';
export const ORANGE = '#ffb347';
export const WHITE = '#ffffff';
export const BROWN = '#9a6a3f';
export const GREY = '#c9c4ba';

export const DISPLAY = "'Bricolage Grotesque', 'Arial Rounded MT Bold', system-ui, sans-serif";

/** Marker stroke width in arena units. */
export const LINE = 1.1;

type Ctx = CanvasRenderingContext2D;

export function ink(c: Ctx, width = LINE, color = INK) {
  c.lineWidth = width;
  c.strokeStyle = color;
  c.lineJoin = 'round';
  c.lineCap = 'round';
}

/** Fill then outline the current path. */
export function sticker(c: Ctx, fill: string | null, width = LINE) {
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  ink(c, width);
  c.stroke();
}

export function circle(c: Ctx, x: number, y: number, r: number, fill: string | null, width = LINE) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  sticker(c, fill, width);
}

export function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string | null, width = LINE, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  sticker(c, fill, width);
}

export function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string | null, r = 1.5, width = LINE) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  sticker(c, fill, width);
}

export function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, width = LINE, color = INK) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  ink(c, width, color);
  c.stroke();
}

/** A fat translucent highlighter swipe behind something. */
export function highlight(c: Ctx, x: number, y: number, w: number, h: number, color = YELLOW, alpha = 0.55) {
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y + h * 0.15);
  c.lineTo(x + w, y);
  c.lineTo(x + w * 0.98, y + h);
  c.lineTo(x + w * 0.02, y + h * 0.92);
  c.closePath();
  c.fill();
  c.restore();
}

/** Two googly eyes looking toward (lx, ly), a unit vector-ish. */
export function eyes(c: Ctx, x: number, y: number, gap: number, r: number, lx = 0, ly = 0) {
  for (const s of [-1, 1]) {
    circle(c, x + s * gap, y, r, WHITE, LINE * 0.7);
    c.beginPath();
    c.arc(x + s * gap + lx * r * 0.4, y + ly * r * 0.4, r * 0.45, 0, Math.PI * 2);
    c.fillStyle = INK;
    c.fill();
  }
}

export function text(c: Ctx, str: string, x: number, y: number, size: number, opts: { color?: string; align?: CanvasTextAlign; weight?: number; outline?: number; base?: CanvasTextBaseline } = {}) {
  c.font = `${opts.weight ?? 800} ${size}px ${DISPLAY}`;
  c.textAlign = opts.align ?? 'center';
  c.textBaseline = opts.base ?? 'middle';
  if (opts.outline) {
    ink(c, opts.outline);
    c.strokeText(str, x, y);
  }
  c.fillStyle = opts.color ?? INK;
  c.fillText(str, x, y);
}

/** Lined notebook paper filling w by h pixels. */
export function paper(c: Ctx, w: number, h: number, scroll = 0) {
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  const gap = Math.max(22, Math.min(34, h / 22));
  c.lineWidth = 1;
  c.strokeStyle = RULE;
  c.beginPath();
  for (let y = gap * 2 - (scroll % gap); y < h; y += gap) {
    c.moveTo(0, Math.round(y) + 0.5);
    c.lineTo(w, Math.round(y) + 0.5);
  }
  c.stroke();
  c.strokeStyle = MARGIN;
  c.lineWidth = 1.5;
  const mx = Math.min(64, w * 0.09);
  c.beginPath();
  c.moveTo(mx, 0);
  c.lineTo(mx, h);
  c.stroke();
}

/** A little timer bar of what's left, in the caller's units. */
export function fuse(c: Ctx, x: number, y: number, w: number, h: number, left: number) {
  rect(c, x, y, w, h, WHITE, h / 2, LINE * 0.8);
  if (left > 0) {
    c.beginPath();
    c.roundRect(x + 0.6, y + 0.6, Math.max(0, (w - 1.2) * left), h - 1.2, (h - 1.2) / 2);
    c.fillStyle = left < 0.3 ? PINK : YELLOW;
    c.fill();
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
