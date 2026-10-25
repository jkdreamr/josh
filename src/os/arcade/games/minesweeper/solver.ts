/**
 * No-guess board generation. A board is accepted only when a player who never guesses can clear it from the
 * first dig, using the deductions a careful player makes: single-number rules, pair rules between two nearby
 * numbers, and the remaining mine count. When the solver gets stuck, a mine on the edge of what it knows is moved
 * somewhere it has no information about yet, and the board is solved again.
 */

const UNKNOWN = 0;
const SAFE = 1;
const MINE = 2;

type Grid = { rows: number; cols: number; near: Int32Array[] };

const grids = new Map<string, Grid>();

function grid(rows: number, cols: number): Grid {
  const key = `${rows}x${cols}`;
  let g = grids.get(key);
  if (!g) {
    const near: Int32Array[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const list: number[] = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) list.push(nr * cols + nc);
      }
      near.push(Int32Array.from(list));
    }
    g = { rows, cols, near };
    grids.set(key, g);
  }
  return g;
}

export type SolveResult = { solved: boolean; state: Uint8Array };

/** Plays the board from `start` without guessing. `state` ends as what the solver knew: 0 unknown, 1 safe, 2 mine. */
export function solve(rows: number, cols: number, mines: Uint8Array, start: number): SolveResult {
  const g = grid(rows, cols);
  const n = rows * cols;
  let mineTotal = 0;
  const adj = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mines[i]) mineTotal++;
    let k = 0;
    for (const j of g.near[i]) k += mines[j];
    adj[i] = k;
  }
  const state = new Uint8Array(n);
  let safeKnown = 0;
  let minesKnown = 0;
  const queue: number[] = [];
  const open = (i: number): boolean => {
    if (state[i] !== UNKNOWN) return false;
    if (mines[i]) throw new Error('solver opened a mine');
    queue.push(i);
    while (queue.length) {
      const k = queue.pop()!;
      if (state[k] !== UNKNOWN) continue;
      state[k] = SAFE;
      safeKnown++;
      if (!adj[k]) for (const j of g.near[k]) if (state[j] === UNKNOWN) queue.push(j);
    }
    return true;
  };
  const mark = (i: number): boolean => {
    if (state[i] !== UNKNOWN) return false;
    state[i] = MINE;
    minesKnown++;
    return true;
  };
  open(start);
  const safeTotal = n - mineTotal;
  const unknownOf = (i: number, out: number[]): number => {
    out.length = 0;
    let flagged = 0;
    for (const j of g.near[i]) {
      if (state[j] === UNKNOWN) out.push(j);
      else if (state[j] === MINE) flagged++;
    }
    return adj[i] - flagged;
  };
  const a: number[] = [];
  const b: number[] = [];
  while (safeKnown < safeTotal) {
    let progress = false;
    for (let i = 0; i < n; i++) {
      if (state[i] !== SAFE || !adj[i]) continue;
      const left = unknownOf(i, a);
      if (!a.length) continue;
      if (left === 0) for (const j of a) progress = open(j) || progress;
      else if (left === a.length) for (const j of a) progress = mark(j) || progress;
    }
    if (progress) continue;
    // Pair rule: for two numbers A and B, if B needs exactly as many more mines than A as it has cells A doesn't
    // touch, those cells are all mines and A's own cells are all safe.
    for (let i = 0; i < n && !progress; i++) {
      if (state[i] !== SAFE || !adj[i]) continue;
      const leftA = unknownOf(i, a);
      if (!a.length) continue;
      const ri = Math.floor(i / cols);
      const ci = i % cols;
      for (let dr = -2; dr <= 2 && !progress; dr++) for (let dc = -2; dc <= 2 && !progress; dc++) {
        if (!dr && !dc) continue;
        const r = ri + dr;
        const c = ci + dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const k = r * cols + c;
        if (state[k] !== SAFE || !adj[k]) continue;
        const leftB = unknownOf(k, b);
        if (!b.length) continue;
        const onlyB = b.filter((x) => !a.includes(x));
        if (leftB - leftA === onlyB.length) {
          for (const x of onlyB) progress = mark(x) || progress;
          for (const x of a) if (!b.includes(x)) progress = open(x) || progress;
        }
      }
    }
    if (progress) continue;
    const minesLeft = mineTotal - minesKnown;
    const unknown = n - safeKnown - minesKnown;
    if (minesLeft === 0) {
      for (let i = 0; i < n; i++) if (state[i] === UNKNOWN) open(i);
      continue;
    }
    if (minesLeft === unknown) {
      for (let i = 0; i < n; i++) if (state[i] === UNKNOWN) mark(i);
      continue;
    }
    break;
  }
  return { solved: safeKnown === safeTotal, state };
}

export type GenerateOptions = { rand?: () => number; budgetMs?: number; now?: () => number };
export type Generated = { mines: Uint8Array; solvable: boolean; tries: number };

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Places `count` mines away from the 3x3 around (row, col) so the board can be cleared without guessing.
 * Gives up after `budgetMs` and returns the last board tried (still safe to start on), flagged unsolvable.
 */
export function generate(rows: number, cols: number, count: number, row: number, col: number, opts: GenerateOptions = {}): Generated {
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? clock;
  const deadline = now() + (opts.budgetMs ?? 160);
  const g = grid(rows, cols);
  const n = rows * cols;
  const start = row * cols + col;
  const guarded = new Uint8Array(n);
  guarded[start] = 1;
  for (const j of g.near[start]) guarded[j] = 1;
  const pick = (max: number) => Math.min(max - 1, Math.max(0, Math.floor(rand() * max)));
  let mines = new Uint8Array(n);
  let tries = 0;
  for (;;) {
    tries++;
    mines = new Uint8Array(n);
    const pool: number[] = [];
    for (let i = 0; i < n; i++) if (!guarded[i]) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < Math.min(count, pool.length); i++) mines[pool[i]] = 1;
    for (let repair = 0; repair < count * 2; repair++) {
      const { solved, state } = solve(rows, cols, mines, start);
      if (solved) return { mines, solvable: true, tries };
      if (now() > deadline) return { mines, solvable: false, tries };
      // Mines next to what the solver has seen, and unknown cells it has no clue about.
      const edge: number[] = [];
      const blind: number[] = [];
      for (let i = 0; i < n; i++) {
        if (state[i] !== UNKNOWN) continue;
        let seen = false;
        for (const j of g.near[i]) if (state[j] === SAFE) { seen = true; break; }
        if (seen) { if (mines[i]) edge.push(i); }
        else if (!mines[i] && !guarded[i]) blind.push(i);
      }
      if (!edge.length || !blind.length) break;
      mines[edge[pick(edge.length)]] = 0;
      mines[blind[pick(blind.length)]] = 1;
    }
    if (now() > deadline) return { mines, solvable: false, tries };
  }
}
