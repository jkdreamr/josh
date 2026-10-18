/** Table geometry for the roomy layout: how big the cards are and where the piles sit so the top rival never covers them. */
export type LayoutIn = { w: number; h: number; n: number; online: boolean; nameH: number; barH: number; rowH?: number };
export type Layout = { short: boolean; cw: number; ch: number; seatTop: number; pad: number; handH: number };

const SEAT_GAP = 6;
const PILE_GAP = 10;
const BELOW_PILE = 34;
const HAND_PAD = 30;
const ONLINE_TOP = 42;
/** Short layout: the rivals row (taller online, below the room badge) and the room under your hand for its slot offset and arc. */
export const SHORT_ROW = 38;
export const SHORT_ROW_ONLINE = 60;
export const SHORT_HAND_PAD = 14;

export const topSeatBottom = (l: Layout, nameH: number) => l.seatTop + l.ch * 0.56 + SEAT_GAP + nameH;

/** Top of the draw and discard piles inside the table, given the grid rows the layout produces. */
export const pileTop = (l: Layout, h: number, barH: number) => {
  const middle = h - barH - l.handH;
  return l.pad + (middle - l.pad - l.ch) / 2;
};

export function tableLayout({ w, h, n, online, nameH, barH, rowH = 0 }: LayoutIn): Layout {
  // Short laptop windows put the pile on the left and the rivals in a row above your hand.
  const short = h < 340 && w > h * 1.4;
  if (short) {
    // Rivals row, your bar and your whole hand have to fit the height, even in the ~157px framed laptop.
    const row = Math.max(rowH, online ? SHORT_ROW_ONLINE : SHORT_ROW);
    const fit = (h - row - barH - SHORT_HAND_PAD) / 1.4;
    const cw = Math.floor(Math.max(online ? 30 : 34, Math.min(h * 0.34, w * 0.1, 80, fit)));
    const ch = Math.round(cw * 1.4);
    return { short, cw, ch, seatTop: 0, pad: 0, handH: ch + SHORT_HAND_PAD };
  }
  const hasTop = n === 2 || n === 4;
  // Online, the room badge sits top center, so a rival up there drops below it.
  const seatTop = online ? ONLINE_TOP : h < 420 ? 4 : 10;
  let cw = Math.max(46, Math.min(w < 560 ? w * 0.15 : w * 0.11, h * (h < 460 ? 0.24 : 0.2), 104));
  if (hasTop) {
    // Rival, gap, pile, its labels, your bar and your hand all stack up the height of the table.
    const fit = (h - barH - HAND_PAD - BELOW_PILE - PILE_GAP - SEAT_GAP - seatTop - nameH - 2) / (2.56 * 1.4);
    cw = Math.max(46, Math.min(cw, fit));
  }
  cw = Math.floor(cw);
  const ch = Math.round(cw * 1.4);
  const handH = ch + HAND_PAD;
  let pad = Math.round(ch * (hasTop ? 0.62 : 0.3));
  if (hasTop) {
    const middle = h - barH - handH;
    const want = seatTop + ch * 0.56 + SEAT_GAP + nameH + PILE_GAP;
    pad = Math.max(pad, Math.ceil(2 * want - middle + ch));
  }
  return { short, cw, ch, seatTop, pad, handH };
}
