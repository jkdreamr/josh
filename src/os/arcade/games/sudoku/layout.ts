// Places the board, clock, tools and number pad in the game area. Pure, so it is easy to test.
export type Box = { x: number; y: number; w: number; h: number };
export type Layout = {
  kind: 'tall' | 'side' | 'split';
  board: Box;
  info: Box;
  tools: Box;
  toolCols: number;
  pad: Box;
  padCols: number;
  labels: boolean;
  ok: boolean;
};
/** The shell's control pill in the top right corner: its left edge and bottom, in game coordinates. */
export type Pill = { left: number; bottom: number } | null;

const box = (x: number, y: number, w: number, h: number): Box => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

function tall(W: number, H: number, pill: Pill, touch: boolean, u: number): Layout {
  const m = W < 480 ? 12 : 20;
  const g = 12;
  const toolH = touch ? 52 * u : 46;
  const padH = touch ? 58 * u : 50;
  const top = pill ? Math.max(m, pill.bottom + 10) : m;
  const B = Math.floor(Math.min(W - 2 * m, H - top - m - 2 * g - toolH - padH, 720));
  const groupH = B + 2 * g + toolH + padH;
  const x0 = (W - B) / 2;
  const y0 = top + Math.max(0, (H - m - top - groupH) / 2);
  const toolW = Math.min((B * 0.62 - 18) / 4, touch ? 64 * u : 60);
  const toolsW = 4 * toolW + 18;
  const yb = y0 + B + g;
  return {
    kind: 'tall',
    board: box(x0, y0, B, B),
    info: box(x0, yb, B - toolsW - 8, toolH),
    tools: box(x0 + B - toolsW, yb, toolsW, toolH),
    toolCols: 4,
    pad: box(x0, yb + toolH + g, B, padH),
    padCols: 9,
    labels: toolW >= 54 && toolH >= 46,
    ok: B >= 150 && B / 9 >= (touch ? 30 : 24),
  };
}

function side(W: number, H: number, pill: Pill, touch: boolean, u: number): Layout {
  const m = 16;
  const g = 22;
  const ig = 12;
  const infoH = 34;
  const sideTop = pill ? pill.bottom + 10 : m;
  const p = Math.min(touch ? 72 * u : 62, (H - m - sideTop - infoH - 2 * ig) / 3.8);
  const S = 3 * p;
  const toolH = 0.8 * p;
  const sideH = infoH + ig + toolH + ig + 3 * p;
  const B = Math.floor(Math.min(H - 2 * m, 720, W - 2 * m - g - S));
  const x0 = (W - (B + g + S)) / 2;
  const by = (H - B) / 2;
  const sx = x0 + B + g;
  const under = pill && sx + S > pill.left - 8 ? sideTop : m;
  const sy = Math.min(H - m - sideH, Math.max(under, by + (B - sideH) / 2));
  const clear = !pill || x0 + B < pill.left - 8 || by > pill.bottom + 8;
  return {
    kind: 'side',
    board: box(x0, by, B, B),
    info: box(sx, sy, S, infoH),
    tools: box(sx, sy + infoH + ig, S, toolH),
    toolCols: 4,
    pad: box(sx, sy + infoH + ig + toolH + ig, S, 3 * p),
    padCols: 3,
    labels: toolH >= 46 && S / 4 >= 52,
    ok: clear && p >= (touch ? 46 * u : 42) && B >= 200,
  };
}

function split(W: number, H: number, pill: Pill, touch: boolean, u: number): Layout {
  const short = H < 230;
  const m = short ? 6 : 12;
  const g = short ? 10 : 16;
  const infoH = short ? 24 : 30;
  const ig = 6;
  let B = Math.min(H - 2 * m, 720);
  const ts = Math.min(touch ? 58 * u : 50, (B - infoH - ig) / 2);
  const L = 2 * ts;
  const padTop = pill ? pill.bottom + 6 : m;
  const p = Math.min(touch ? 66 * u : 58, (H - m - padTop) / 3);
  const P = 3 * p;
  B = Math.floor(Math.min(B, W - 2 * m - L - 2 * g - P));
  let x0 = (W - (L + 2 * g + B + P)) / 2;
  let by = (H - B) / 2;
  if (pill && by < pill.bottom + 6) {
    // keep the board's top right corner clear of the pill: slide the group left, then shrink
    const over = x0 + L + g + B - (pill.left - 8);
    if (over > 0) {
      const shift = Math.min(over, x0 - m);
      x0 -= shift;
      if (over > shift) {
        B = Math.floor(B - (over - shift));
        by = (H - B) / 2;
      }
    }
  }
  const bx = x0 + L + g;
  const colH = infoH + ig + 2 * ts;
  const cy = Math.max(m, by + (B - colH) / 2);
  const px = bx + B + g;
  const py = Math.min(H - m - P, Math.max(pill && px + P > pill.left - 8 ? padTop : m, by + (B - P) / 2));
  return {
    kind: 'split',
    board: box(bx, by, B, B),
    info: box(x0, cy, L, infoH),
    tools: box(x0, cy + infoH + ig, L, 2 * ts),
    toolCols: 2,
    pad: box(px, py, P, P),
    padCols: 3,
    labels: false,
    ok: B >= 90 && p >= (touch ? 36 * u : 24),
  };
}

const BONUS = { tall: 0, side: 14, split: 0 };

export function layout(W: number, H: number, pill: Pill, touch: boolean, u = 1): Layout {
  const all = [tall(W, H, pill, touch, u), side(W, H, pill, touch, u), split(W, H, pill, touch, u)];
  const good = all.filter((l) => l.ok);
  const pool = good.length ? good : [all[2]];
  return pool.reduce((a, b) => (b.board.w + BONUS[b.kind] > a.board.w + BONUS[a.kind] ? b : a));
}
