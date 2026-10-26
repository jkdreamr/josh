/**
 * Pure helpers for Tank Maze's score chips and its Game Over copy.
 */

export type Span = { x0: number; x1: number };

/** The free stretches of the HUD row: [x0, x1] with every blocked span (plus a margin) cut out. */
export function freeSpans(x0: number, x1: number, blocked: readonly Span[], margin = 8): Span[] {
  let spans: Span[] = x1 > x0 ? [{ x0, x1 }] : [];
  for (const b of blocked) {
    const bx0 = b.x0 - margin;
    const bx1 = b.x1 + margin;
    spans = spans.flatMap((s) => {
      if (bx1 <= s.x0 || bx0 >= s.x1) return [s];
      const out: Span[] = [];
      if (bx0 > s.x0) out.push({ x0: s.x0, x1: bx0 });
      if (bx1 < s.x1) out.push({ x0: bx1, x1: s.x1 });
      return out;
    });
  }
  return spans;
}

/**
 * Lays chips (in order) into the free spans, filling one span before moving to the next, and centers each span's chips.
 * Returns each chip's left x, or null when they don't all fit.
 */
export function packChips(widths: readonly number[], spans: readonly Span[], gap: number): number[] | null {
  return packSpans(widths, spans, gap)?.xs ?? null;
}

/**
 * Like packChips over rows of spans (row 0 first): returns each chip's left x and its row, or null when they don't all fit.
 */
export function packChipRows(widths: readonly number[], rows: readonly (readonly Span[])[], gap: number): { x: number; row: number }[] | null {
  const spans = rows.flat();
  const rowOf = rows.flatMap((r, ri) => r.map(() => ri));
  const packed = packSpans(widths, spans, gap);
  return packed ? packed.xs.map((x, i) => ({ x, row: rowOf[packed.span[i]] })) : null;
}

function packSpans(widths: readonly number[], spans: readonly Span[], gap: number): { xs: number[]; span: number[] } | null {
  const groups: number[][] = spans.map(() => []);
  let s = 0;
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    while (s < spans.length) {
      const need = used + (groups[s].length ? gap : 0) + widths[i];
      if (need <= spans[s].x1 - spans[s].x0) {
        groups[s].push(i);
        used = need;
        break;
      }
      s++;
      used = 0;
    }
    if (s >= spans.length) return null;
  }
  const xs = new Array<number>(widths.length).fill(0);
  const span = new Array<number>(widths.length).fill(0);
  groups.forEach((g, gi) => {
    const total = g.reduce((a, i) => a + widths[i], 0) + gap * Math.max(0, g.length - 1);
    let x = spans[gi].x0 + Math.max(0, (spans[gi].x1 - spans[gi].x0 - total) / 2);
    for (const i of g) {
      xs[i] = x;
      span[i] = gi;
      x += widths[i] + gap;
    }
  });
  return { xs, span };
}

/** Shortens a chip label to `max` characters (never below 5); a seat's "(Left)" or "(Bot)" tag survives the clip. */
export function clipName(label: string, max: number): string {
  const tag = /\s\((Left|Bot)\)$/.exec(label)?.[0] ?? '';
  const name = label.slice(0, label.length - tag.length);
  return name.length > Math.max(max, 5) ? `${name.slice(0, Math.max(1, max - 1)).trimEnd()}…${tag}` : label;
}

export type ChipLayout = {
  font: number;
  gap: number;
  /** Chip-relative x of the color dot's center, the label's start, and the space between label and score. */
  dot: number;
  padL: number;
  nameGap: number;
  /** Shown labels: clipped, or '' when the chips are down to a dot and a score. */
  names: string[];
  widths: number[];
  placed: { x: number; row: number }[];
  /** False only when nothing fit and the chips were laid out left to right anyway. */
  fits: boolean;
};

/**
 * Lays out the score chips in the free spans of the HUD row (row1) and, when allowed or as a last resort, the row
 * below the controls (row2). Tries, in order: full chips on one row; full chips on two rows (tall stages only);
 * tighter chips with ever shorter names; a dot and score only. Short stages wrap only once even that misses.
 */
export function layoutChips(
  labels: readonly { name: string; score: string }[],
  row1: readonly Span[],
  row2: readonly Span[],
  o: { u: number; rowH: number; wrap: boolean; measure: (text: string, px: number, weight: 600 | 700) => number },
): ChipLayout {
  const u = o.u;
  const minFont = 11.25 * u;
  const startFont = Math.max(minFont, Math.min(13 * u, o.rowH * 0.4 * u));
  const baseGap = (o.rowH < 30 ? 8 : 14) * u;
  const attempt = (rows: readonly (readonly Span[])[], compact: boolean, maxName: number, showNames: boolean): ChipLayout | null => {
    const dot = (compact ? 7.5 : 9) * u;
    const padL = (compact ? 14 : 17) * u;
    const nameGap = (compact ? 5 : 8) * u;
    const padR = (compact ? 6 : 7) * u;
    const names = labels.map((l) => (showNames ? clipName(l.name, maxName) : ''));
    for (const gap of [baseGap, 4 * u]) {
      for (let font = startFont; ; font = Math.max(minFont, font - 1)) {
        const widths = labels.map((l, i) => padL + (names[i] ? o.measure(names[i], font, 600) + nameGap : 0) + o.measure(l.score, font, 700) + padR);
        const placed = packChipRows(widths, rows, gap);
        if (placed) return { font, gap, dot, padL, nameGap, names, widths, placed, fits: true };
        if (font <= minFont) break;
      }
    }
    return null;
  };
  const one = [row1];
  const two = [row1, row2];
  const best = o.wrap ? two : one;
  const plans: [readonly (readonly Span[])[], boolean, number, boolean][] = [[one, false, 24, true]];
  if (o.wrap) plans.push([two, false, 24, true]);
  for (const max of [24, 12, 8, 5]) plans.push([best, true, max, true]);
  plans.push([best, true, 24, false]);
  if (!o.wrap) plans.push([two, true, 24, true], [two, true, 8, true], [two, true, 24, false]);
  for (const [rows, compact, max, show] of plans) {
    const got = attempt(rows, compact, max, show);
    if (got) return got;
  }
  const font = minFont;
  const widths = labels.map((l) => 20 * u + o.measure(l.score, font, 700));
  let x = 12;
  const placed = widths.map((cw) => ({ x: (x += cw + 4 * u) - cw - 4 * u, row: 0 }));
  return { font, gap: 4 * u, dot: 7.5 * u, padL: 14 * u, nameGap: 5 * u, names: labels.map(() => ''), widths, placed, fits: false };
}

/** "and"-joined list: "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Final score, highest first, every number labeled: "Bot 2 3, Bot 1 2 and You 0 after 6 rounds." */
export function finalLine(names: readonly string[], scores: readonly number[], rounds: number): string {
  const order = names.map((_, i) => i).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);
  const parts = order.map((i) => `${names[i]} ${scores[i] ?? 0}`);
  return `${listNames(parts)} after ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`;
}

/** Who is in the room: "2 people here: You and Sam." */
export function rosterLine(people: readonly string[]): string {
  if (people.length === 0) return '';
  if (people.length === 1) return `Just ${people[0] === 'You' ? 'you' : people[0]} here.`;
  return `${people.length} people here: ${listNames(people)}.`;
}
