/** Where the board, the stats and the touch mode switch go inside the game area. Pure, so it is unit tested. */

export type Rect = { x: number; y: number; w: number; h: number };
export type HudSize = { rowW: number; rowH: number; colW: number; colH: number };
export type LayoutInput = {
  w: number;
  h: number;
  rows: number;
  cols: number;
  /** Left edge and bottom edge of the shell's control pill, in game px. */
  ctrlLeft: number;
  ctrlBottom: number;
  hud: HudSize;
  /** Height reserved at the bottom for the Dig / Flag switch, 0 without one. */
  bar: number;
  /** Smallest cell before the board starts to pan instead of shrinking. */
  minCell: number;
  maxCell: number;
};
export type Layout = {
  /** Visible area for the board; the board pans inside it when it is bigger. */
  view: Rect;
  hud: { x: number; y: number; column: boolean };
  transposed: boolean;
  /** View rows and columns (swapped when transposed). */
  rows: number;
  cols: number;
  /** Cell size that shows the whole board, and the size used at zoom 1. */
  fit: number;
  base: number;
};

const M = 10;
const GAP = 8;

export function computeLayout(i: LayoutInput): Layout {
  const w = Math.max(1, i.w);
  const h = Math.max(1, i.h);
  const bottom = h - M - (i.bar ? i.bar + GAP : 0);
  const candidates: { view: Rect; hud: Layout['hud'] }[] = [];
  // Stats in a row at the top left, beside the control pill if they fit, else under it.
  const besideCtrl = M + i.hud.rowW <= i.ctrlLeft - GAP;
  const rowY = besideCtrl ? M : i.ctrlBottom + 6;
  const rowTop = Math.max(rowY + i.hud.rowH, i.ctrlBottom) + GAP;
  candidates.push({ view: { x: M, y: rowTop, w: w - M * 2, h: bottom - rowTop }, hud: { x: M, y: rowY, column: false } });
  // Stats in a column down the left; the board beside them, either clear of the pill or under it.
  const colX = M + i.hud.colW + GAP + 2;
  candidates.push({ view: { x: colX, y: M, w: i.ctrlLeft - GAP - colX, h: bottom - M }, hud: { x: M, y: M, column: true } });
  candidates.push({ view: { x: colX, y: i.ctrlBottom + GAP, w: w - M - colX, h: bottom - i.ctrlBottom - GAP }, hud: { x: M, y: M, column: true } });
  let best: Layout | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.view.w <= 0 || c.view.h <= 0) continue;
    if (c.hud.column && M + i.hud.colH > h - M) continue;
    for (const transposed of [false, true]) {
      if (transposed && i.rows === i.cols) continue;
      const rows = transposed ? i.cols : i.rows;
      const cols = transposed ? i.rows : i.cols;
      const fit = Math.min(c.view.w / cols, c.view.h / rows);
      // Bigger cells win until they reach the smallest comfortable size. A board that has to pan anyway goes where
      // most of it shows at once, turned to match the window. The unrotated board is kept unless rotating clearly helps.
      const fits = fit >= i.minCell * 0.9;
      const seen = Math.min(1, c.view.w / (cols * i.minCell)) * Math.min(1, c.view.h / (rows * i.minCell));
      const score = fits
        ? 1e9 + Math.min(fit, i.minCell) * 1e6 * (transposed ? 0.94 : 1) + c.view.w * c.view.h
        : Math.round(seen * 1e3) * 1e5 + fit * 1e3 + c.view.w * c.view.h / 1e3;
      if (!best || score > bestScore) {
        bestScore = score;
        // Within a few percent of the minimum, shrink a little instead of panning a sliver.
        const base = fits ? Math.min(i.maxCell, fit) : i.minCell;
        best = { view: c.view, hud: c.hud, transposed, rows, cols, fit, base };
      }
    }
  }
  if (best) return best;
  const view = { x: 0, y: 0, w, h };
  const fit = Math.min(w / i.cols, h / i.rows);
  return { view, hud: { x: M, y: M, column: false }, transposed: false, rows: i.rows, cols: i.cols, fit, base: Math.max(fit, i.minCell) };
}

/** Keeps a board of size bw x bh inside a view of vw x vh: centered when it fits, edges never pulled inside when it doesn't. */
export function clampPan(offset: number, board: number, view: number): number {
  if (board <= view) return (view - board) / 2;
  return Math.min(0, Math.max(view - board, offset));
}

/** Arrow keys move in screen directions, so on a rotated board they step across the other axis. */
export function stepCursor(pos: [number, number], dRow: number, dCol: number, transposed: boolean, rows: number, cols: number): [number, number] {
  const [br, bc] = transposed ? [dCol, dRow] : [dRow, dCol];
  return [Math.min(rows - 1, Math.max(0, pos[0] + br)), Math.min(cols - 1, Math.max(0, pos[1] + bc))];
}
