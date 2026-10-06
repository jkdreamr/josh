// Pure sudoku logic: solver, generator with a unique solution, technique grader. No DOM.

export type Level = 'easy' | 'medium' | 'hard';
export type Grid = number[]; // 81 cells, 0 = empty
export type Puzzle = { puzzle: Grid; solution: Grid; level: Level; grade: number; clues: number };

export const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const ALL = 0x3fe; // bits 1..9

export const rowOf = (i: number) => (i / 9) | 0;
export const colOf = (i: number) => i % 9;
export const boxOf = (i: number) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);

/** The 20 cells that share a row, column or box with each cell. */
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const out: number[] = [];
  for (let j = 0; j < 81; j++) if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) out.push(j);
  return out;
});

/** The 27 units (9 rows, 9 columns, 9 boxes) as lists of cell indexes. */
export const UNITS: number[][] = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (((b / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (b % 3) * 3 + (k % 3))),
];

const popcount = (m: number) => {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
};
const lowBit = (m: number) => 31 - Math.clz32(m & -m);

function shuffle<T>(a: T[], rand: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Counts solutions up to `limit` with bitmask constraint propagation and a fewest-candidates search.
 * If `out` is given, the first solution found is written into it.
 */
export function countSolutions(grid: Grid, limit = 2, rand?: () => number, out?: Grid): number {
  const g = grid.slice();
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = g[i];
    if (!v) continue;
    const b = 1 << v;
    const r = rowOf(i), c = colOf(i), x = boxOf(i);
    if (rows[r] & b || cols[c] & b || boxes[x] & b) return 0;
    rows[r] |= b;
    cols[c] |= b;
    boxes[x] |= b;
  }
  let found = 0;
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const search = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = popcount(m);
      if (n === 0) return false;
      if (n < bestN) {
        bestN = n;
        best = i;
        bestMask = m;
        if (n === 1) break;
      }
    }
    if (best < 0) {
      found++;
      if (out && found === 1) for (let i = 0; i < 81; i++) out[i] = g[i];
      return found >= limit;
    }
    const r = rowOf(best), c = colOf(best), x = boxOf(best);
    const order = rand ? shuffle(digits.slice(), rand) : digits;
    for (const d of order) {
      const b = 1 << d;
      if (!(bestMask & b)) continue;
      g[best] = d;
      rows[r] |= b;
      cols[c] |= b;
      boxes[x] |= b;
      if (search()) return true;
      rows[r] &= ~b;
      cols[c] &= ~b;
      boxes[x] &= ~b;
    }
    g[best] = 0;
    return false;
  };
  search();
  return found;
}

export const hasUniqueSolution = (grid: Grid) => countSolutions(grid, 2) === 1;

export function solve(grid: Grid): Grid | null {
  const out: Grid = new Array(81).fill(0);
  return countSolutions(grid, 1, undefined, out) ? out : null;
}

/** A random completely filled valid grid. */
export function solvedGrid(rand: () => number = Math.random): Grid {
  const out: Grid = new Array(81).fill(0);
  countSolutions(new Array(81).fill(0), 1, rand, out);
  return out;
}

/**
 * Hardest technique a human solver needs: 1 naked singles, 2 hidden singles,
 * 3 locked candidates and naked pairs, 4 anything harder (or unsolvable by these).
 */
export function grade(grid: Grid): number {
  const g = grid.slice();
  const cand: number[] = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    let m = ALL;
    for (const p of PEERS[i]) if (g[p]) m &= ~(1 << g[p]);
    cand[i] = m;
  }
  const place = (i: number, d: number) => {
    g[i] = d;
    cand[i] = 0;
    for (const p of PEERS[i]) cand[p] &= ~(1 << d);
  };
  let hardest = 0;
  for (;;) {
    if (g.every((v) => v)) return Math.max(1, hardest);
    if (cand.some((m, i) => !g[i] && m === 0)) return 4;
    // Naked single.
    let i = cand.findIndex((m, k) => !g[k] && popcount(m) === 1);
    if (i >= 0) {
      place(i, lowBit(cand[i]));
      hardest = Math.max(hardest, 1);
      continue;
    }
    // Hidden single.
    let progressed = false;
    for (const unit of UNITS) {
      for (let d = 1; d <= 9 && !progressed; d++) {
        const b = 1 << d;
        let spot = -1;
        let n = 0;
        for (const k of unit) if (!g[k] && cand[k] & b) {
          n++;
          spot = k;
        }
        if (n === 1) {
          place(spot, d);
          progressed = true;
        }
      }
      if (progressed) break;
    }
    if (progressed) {
      hardest = Math.max(hardest, 2);
      continue;
    }
    // Locked candidates (pointing and claiming) and naked pairs: eliminations only.
    let eliminated = false;
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const b = 1 << d;
        const spots = unit.filter((k) => !g[k] && cand[k] & b);
        if (spots.length < 2) continue;
        for (const other of UNITS) {
          if (other === unit || !spots.every((k) => other.includes(k))) continue;
          for (const k of other) if (!spots.includes(k) && !g[k] && cand[k] & b) {
            cand[k] &= ~b;
            eliminated = true;
          }
        }
      }
      const pairs = unit.filter((k) => !g[k] && popcount(cand[k]) === 2);
      for (let a = 0; a < pairs.length; a++)
        for (let c = a + 1; c < pairs.length; c++) {
          const m = cand[pairs[a]];
          if (m !== cand[pairs[c]]) continue;
          for (const k of unit) if (k !== pairs[a] && k !== pairs[c] && !g[k] && cand[k] & m) {
            cand[k] &= ~m;
            eliminated = true;
          }
        }
    }
    if (eliminated) {
      hardest = 3;
      continue;
    }
    return 4;
  }
}

const TARGET: Record<Level, number> = { easy: 38, medium: 30, hard: 0 };

/**
 * Generates a puzzle with exactly one solution. Removal is 180-degree symmetric.
 * easy: ~38 clues, singles only. medium: ~30 clues, singles only. hard: as few clues as uniqueness allows
 * and needs locked candidates or naked pairs. Each attempt takes about a millisecond.
 */
export function generate(level: Level, rand: () => number = Math.random): Puzzle {
  let fallback: Puzzle | null = null;
  const attempts = level === 'hard' ? 40 : 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const solution = solvedGrid(rand);
    const puzzle = solution.slice();
    let clues = 81;
    const order = shuffle(Array.from({ length: 41 }, (_, i) => i), rand);
    for (const i of order) {
      if (clues <= TARGET[level]) break;
      const j = 80 - i;
      const a = puzzle[i];
      const b = puzzle[j];
      puzzle[i] = 0;
      puzzle[j] = 0;
      if (hasUniqueSolution(puzzle)) clues -= i === j ? 1 : 2;
      else {
        puzzle[i] = a;
        puzzle[j] = b;
      }
    }
    const gr = grade(puzzle);
    const result: Puzzle = { puzzle, solution, level, grade: gr, clues };
    if (level === 'hard' ? gr === 3 : gr <= 2) return result;
    const better = !fallback || (level === 'hard' ? fallback.grade < 3 && gr > fallback.grade : gr < fallback.grade);
    if (better) fallback = result;
  }
  return fallback!;
}

/** Cells whose value repeats in a row, column or box. */
export function conflicts(grid: Grid): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    for (const p of PEERS[i]) if (grid[p] === grid[i]) {
      out.add(i);
      break;
    }
  }
  return out;
}

export const isSolved = (grid: Grid, solution: Grid) => grid.every((v, i) => v === solution[i]);

/** Units (0-26) that are completely and correctly filled after placing at cell i. */
export function completedUnits(grid: Grid, i: number): number[] {
  const out: number[] = [];
  [rowOf(i), 9 + colOf(i), 18 + boxOf(i)].forEach((u) => {
    const vals = UNITS[u].map((k) => grid[k]);
    if (vals.every((v) => v) && new Set(vals).size === 9) out.push(u);
  });
  return out;
}

/** Seeded PRNG (mulberry32) for tests and reproducible boards. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
