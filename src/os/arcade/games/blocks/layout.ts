import type { LockEvent } from './logic';

export type Rect = { x: number; y: number; w: number; h: number };
export type Layout = {
  cell: number;
  boardX: number;
  boardY: number;
  hold: Rect;
  next: Rect;
  stats: Rect;
  /** How many of Score, Level and Lines fit. */
  statRows: number;
  queue: number;
  font: number;
  value: number;
  pad: number;
  radius: number;
  u: number;
};

const COLS = 10;
const ROWS = 20;

/**
 * Places the well and its side panels. Tries the full height in the gap the shell's controls leave at the top, and
 * the space under them, and keeps whichever gives bigger blocks. `u` grows text in a scaled-down iPad frame.
 */
export function blocksLayout(w: number, h: number, opts: { u?: number; avoid?: Rect[]; bottom?: number } = {}): Layout {
  const u = opts.u ?? 1;
  const avoid = (opts.avoid ?? []).filter((r) => r.y < h * 0.5);
  const edge = 8;
  const font = Math.round(11 * u * 10) / 10;
  const portrait = w < h * 0.9;
  const sideCells = portrait ? 3.4 : 5;
  const minSide = 58 * u;
  const bottom = h - edge - (opts.bottom ?? 0);

  const fit = (x0: number, x1: number, y0: number, y1: number) => {
    const availW = x1 - x0;
    const availH = y1 - y0;
    const gap = 6;
    let cell = Math.min(availH / ROWS, (availW - gap * 2) / (COLS + sideCells * 2));
    let side = sideCells * cell;
    if (side < minSide) {
      side = minSide;
      cell = Math.min(availH / ROWS, (availW - gap * 2 - side * 2) / COLS);
    }
    if (cell >= 8) cell = Math.floor(cell);
    return { cell, side, gap, x0, availW, y0, availH };
  };

  let left = edge;
  let right = w - edge;
  for (const r of avoid) {
    if (r.x + r.w / 2 > w / 2) right = Math.min(right, r.x - 6);
    else left = Math.max(left, r.x + r.w + 6);
  }
  const between = fit(left, right, edge, bottom);
  const under = fit(edge, w - edge, Math.max(edge, ...avoid.map((r) => r.y + r.h + 6)), bottom);
  const best = between.cell >= under.cell ? between : under;
  const cell = Math.max(3, best.cell);
  const side = best.side;
  const gap = best.gap;
  const boardW = cell * COLS;
  const boardH = cell * ROWS;
  const total = boardW + side * 2 + gap * 2;
  const x = Math.round(best.x0 + (best.availW - total) / 2);
  const boardX = x + side + gap;
  const boardY = Math.round(best.y0 + Math.max(0, best.availH - boardH) / 2);
  const pad = Math.max(4, Math.min(10, cell * 0.45)) * u;
  const value = Math.max(13 * u, Math.min(24, cell * 0.95));
  const radius = Math.max(6, Math.min(12, cell * 0.4));

  const holdMini = Math.min(cell * 0.8, (side - pad * 2) / 4.4);
  const hold = { x, y: boardY, w: side, h: Math.min(boardH * 0.4, font + pad * 2.6 + holdMini * 2.6) };
  const rowH = font * 1.15 + value * 1.05 + pad * 0.75;
  const room = boardH - hold.h - gap - pad * 2;
  const statRows = Math.max(0, Math.min(3, Math.floor(room / rowH)));
  const stats = { x, y: hold.y + hold.h + gap, w: side, h: statRows ? rowH * statRows + pad * 2 : 0 };
  const next = { x: boardX + boardW + gap, y: boardY, w: side, h: boardH };
  const slot = Math.max(cell * 2.1, 18 * u);
  const queue = Math.max(1, Math.min(5, Math.floor((boardH - font - pad * 2.8) / slot)));
  return { cell, boardX, boardY, hold, next, stats, statRows, queue, font, value, pad, radius, u };
}

const LINE_NAMES = ['', 'Single', 'Double', 'Triple', 'Quad'];

/** The headline for a lock: Quad, T-Spin Double, Perfect Clear. A plain single gets none. */
export function spinTitle(e: Pick<LockEvent, 'lines' | 'spin' | 'perfect'>): string {
  if (e.perfect) return 'Perfect Clear';
  if (e.spin === 'full') return `T-Spin ${LINE_NAMES[e.lines]}`.trim();
  if (e.spin === 'mini') return `Mini T-Spin ${LINE_NAMES[e.lines]}`.trim();
  return e.lines >= 2 ? LINE_NAMES[e.lines] : '';
}
