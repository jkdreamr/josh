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
