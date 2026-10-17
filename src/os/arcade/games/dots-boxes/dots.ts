// Dots and Boxes: rules plus the computer player. Pure, so it runs in the AI worker and under node tests.

export type Level = 0 | 1 | 2;
export type Rng = () => number;

/** Board geometry for `rows` by `cols` boxes. Horizontal lines come first (row-major), then vertical ones. */
export type Geo = {
  rows: number;
  cols: number;
  /** Number of horizontal lines; vertical line ids start here. */
  h: number;
  lines: number;
  boxes: number;
  /** Two boxes per line (-1 for the board edge). */
  lineBoxes: Int16Array;
  /** Four lines per box: top, bottom, left, right. */
  boxLines: Int16Array;
};

const geos = new Map<string, Geo>();
export function geo(rows: number, cols: number): Geo {
  const key = `${rows}x${cols}`;
  const hit = geos.get(key);
  if (hit) return hit;
  const h = (rows + 1) * cols;
  const lines = h + rows * (cols + 1);
  const boxes = rows * cols;
  const lineBoxes = new Int16Array(lines * 2).fill(-1);
  const boxLines = new Int16Array(boxes * 4);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const b = r * cols + c;
      const t = r * cols + c;
      const bo = (r + 1) * cols + c;
      const l = h + r * (cols + 1) + c;
      const ri = l + 1;
      boxLines.set([t, bo, l, ri], b * 4);
      lineBoxes[t * 2 + 1] = b;
      lineBoxes[bo * 2] = b;
      lineBoxes[l * 2 + 1] = b;
      lineBoxes[ri * 2] = b;
    }
  const g: Geo = { rows, cols, h, lines, boxes, lineBoxes, boxLines };
  geos.set(key, g);
  return g;
}

/** Ends of a line in dot coordinates: [x1, y1, x2, y2]. */
export function lineEnds(g: Geo, line: number): [number, number, number, number] {
  if (line < g.h) {
    const r = Math.floor(line / g.cols);
    const c = line % g.cols;
    return [c, r, c + 1, r];
  }
  const i = line - g.h;
  const r = Math.floor(i / (g.cols + 1));
  const c = i % (g.cols + 1);
  return [c, r, c, r + 1];
}

/** The undrawn line nearest to (x, y) in dot units, if it is within `reach`. */
export function lineAt(g: Geo, lines: ArrayLike<number>, x: number, y: number, reach = 0.5): number {
  let best = -1;
  let bestD = reach;
  for (let l = 0; l < g.lines; l++) {
    if (lines[l]) continue;
    const [x1, y1, x2, y2] = lineEnds(g, l);
    const px = Math.max(Math.min(x, Math.max(x1, x2)), Math.min(x1, x2));
    const py = Math.max(Math.min(y, Math.max(y1, y2)), Math.min(y1, y2));
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** The line a keyboard cursor moves to from `from` in direction (dx, dy). */
export function stepCursor(g: Geo, from: number, dx: number, dy: number): number {
  const mid = (l: number) => {
    const [x1, y1, x2, y2] = lineEnds(g, l);
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  };
  if (from < 0 || from >= g.lines) return 0;
  const [fx, fy] = mid(from);
  let best = from;
  let bestS = Infinity;
  for (let l = 0; l < g.lines; l++) {
    if (l === from) continue;
    const [x, y] = mid(l);
    const along = (x - fx) * dx + (y - fy) * dy;
    const perp = Math.abs((x - fx) * dy - (y - fy) * dx);
    if (along <= 0.01 || perp > along + 0.01) continue;
    const s = along + perp * 0.5 + (perp > 0 ? 0 : 0.01);
    if (s < bestS - 1e-9) {
      bestS = s;
      best = l;
    }
  }
  return best;
}

export type Game = {
  rows: number;
  cols: number;
  players: number;
  /** 0 while undrawn, else the drawing player + 1. */
  lines: number[];
  /** -1 while open, else the owner. */
  boxes: number[];
  scores: number[];
  turn: number;
  moves: number;
  last: number;
  over: boolean;
};

export function newGame(rows: number, cols: number, players: number, first = 0): Game {
  const g = geo(rows, cols);
  return {
    rows,
    cols,
    players,
    lines: new Array(g.lines).fill(0),
    boxes: new Array(g.boxes).fill(-1),
    scores: new Array(players).fill(0),
    turn: ((first % players) + players) % players,
    moves: 0,
    last: -1,
    over: false,
  };
}

/** Draws a line for the player to move. A finished box scores and keeps the turn. Null if the move is illegal. */
export function play(game: Game, line: number): { game: Game; completed: number[] } | null {
  const g = geo(game.rows, game.cols);
  if (game.over || !Number.isInteger(line) || line < 0 || line >= g.lines || game.lines[line]) return null;
  const lines = game.lines.slice();
  const boxes = game.boxes.slice();
  const scores = game.scores.slice();
  lines[line] = game.turn + 1;
  const completed: number[] = [];
  for (let k = 0; k < 2; k++) {
    const b = g.lineBoxes[line * 2 + k];
    if (b < 0) continue;
    let sides = 0;
    for (let s = 0; s < 4; s++) if (lines[g.boxLines[b * 4 + s]]) sides++;
    if (sides === 4) {
      boxes[b] = game.turn;
      scores[game.turn]++;
      completed.push(b);
    }
  }
  const over = boxes.every((o) => o >= 0);
  const turn = completed.length || over ? game.turn : (game.turn + 1) % game.players;
  return { game: { ...game, lines, boxes, scores, turn, moves: game.moves + 1, last: line, over }, completed };
}

export function leaders(game: Game): number[] {
  const top = Math.max(...game.scores);
  return game.scores.flatMap((s, i) => (s === top ? [i] : []));
}

export function isGame(v: unknown): v is Game {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const int = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
  if (!int(o.rows, 1, 8) || !int(o.cols, 1, 8) || !int(o.players, 1, 4) || !int(o.turn, 0, 3)) return false;
  const g = geo(o.rows as number, o.cols as number);
  const arr = (a: unknown, n: number, lo: number, hi: number) => Array.isArray(a) && a.length === n && a.every((x) => int(x, lo, hi));
  return arr(o.lines, g.lines, 0, 4) && arr(o.boxes, g.boxes, -1, 3) && arr(o.scores, o.players as number, 0, g.boxes) && typeof o.over === 'boolean';
}

// ---------------------------------------------------------------------------------------------------------------
// Computer player

/** Mutable search position. Players are "the one to move" and "the other", so values are net boxes for the mover. */
type Pos = { g: Geo; drawn: Uint8Array; sides: Uint8Array; owned: Uint8Array };

function posOf(game: Pick<Game, 'rows' | 'cols' | 'lines'>): Pos {
  const g = geo(game.rows, game.cols);
  const drawn = new Uint8Array(g.lines);
  const sides = new Uint8Array(g.boxes);
  const owned = new Uint8Array(g.boxes);
  for (let l = 0; l < g.lines; l++) if (game.lines[l]) drawn[l] = 1;
  for (let b = 0; b < g.boxes; b++) {
    for (let s = 0; s < 4; s++) if (drawn[g.boxLines[b * 4 + s]]) sides[b]++;
    if (sides[b] === 4) owned[b] = 1;
  }
  return { g, drawn, sides, owned };
}
const clone = (p: Pos): Pos => ({ g: p.g, drawn: p.drawn.slice(), sides: p.sides.slice(), owned: p.owned.slice() });

function draw(p: Pos, l: number): number {
  p.drawn[l] = 1;
  let done = 0;
  for (let k = 0; k < 2; k++) {
    const b = p.g.lineBoxes[l * 2 + k];
    if (b < 0) continue;
    if (++p.sides[b] === 4) {
      p.owned[b] = 1;
      done++;
    }
  }
  return done;
}
function undraw(p: Pos, l: number) {
  p.drawn[l] = 0;
  for (let k = 0; k < 2; k++) {
    const b = p.g.lineBoxes[l * 2 + k];
    if (b < 0) continue;
    if (p.sides[b]-- === 4) p.owned[b] = 0;
  }
}
const otherBox = (p: Pos, l: number, b: number) => (p.g.lineBoxes[l * 2] === b ? p.g.lineBoxes[l * 2 + 1] : p.g.lineBoxes[l * 2]);
const deg = (p: Pos, b: number) => 4 - p.sides[b];
function openLines(p: Pos, b: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < 4; s++) {
    const l = p.g.boxLines[b * 4 + s];
    if (!p.drawn[l]) out.push(l);
  }
  return out;
}
function isSafe(p: Pos, l: number) {
  if (p.drawn[l]) return false;
  for (let k = 0; k < 2; k++) {
    const b = p.g.lineBoxes[l * 2 + k];
    if (b >= 0 && p.sides[b] >= 2) return false;
  }
  return true;
}
const undrawn = (p: Pos) => {
  const out: number[] = [];
  for (let l = 0; l < p.g.lines; l++) if (!p.drawn[l]) out.push(l);
  return out;
};
export const safeCount = (game: Pick<Game, 'rows' | 'cols' | 'lines'>) => safeLines(posOf(game)).length;
function safeLines(p: Pos) {
  const out: number[] = [];
  for (let l = 0; l < p.g.lines; l++) if (isSafe(p, l)) out.push(l);
  return out;
}
function capturable(p: Pos) {
  const out: number[] = [];
  for (let b = 0; b < p.g.boxes; b++) if (!p.owned[b] && p.sides[b] === 3) out.push(b);
  return out;
}

type Comp = { loop: boolean; n: number };

/** Chains and loops of a position with no safe move left (junctions are peeled into chains, shortest arm first). */
function components(p0: Pos): Comp[] {
  const p = clone(p0);
  const out: Comp[] = [];
  for (let guard = 0; guard < 200; guard++) {
    // anything capturable after a peel goes to whoever took the arm
    let caps = capturable(p);
    while (caps.length) {
      for (const b of caps) {
        if (p.owned[b]) continue;
        const l = openLines(p, b)[0];
        if (l !== undefined) draw(p, l);
        if (out.length) out[out.length - 1].n++;
      }
      caps = capturable(p);
    }
    const seen = new Uint8Array(p.g.boxes);
    let junctionArm: { boxes: number[] } | null = null;
    const simple: Comp[] = [];
    for (let s = 0; s < p.g.boxes; s++) {
      if (p.owned[s] || seen[s]) continue;
      const stack = [s];
      const comp: number[] = [];
      seen[s] = 1;
      let ground = 0;
      let junctions = 0;
      while (stack.length) {
        const b = stack.pop()!;
        comp.push(b);
        if (deg(p, b) >= 3) junctions++;
        for (const l of openLines(p, b)) {
          const o = otherBox(p, l, b);
          if (o < 0) ground++;
          else if (!seen[o]) {
            seen[o] = 1;
            stack.push(o);
          }
        }
      }
      if (!junctions) {
        simple.push({ loop: ground === 0, n: comp.length });
        continue;
      }
      // walk each arm from a junction or the edge to the next junction or the edge
      for (const b of comp) {
        const starts: { box: number; from: number }[] = [];
        if (deg(p, b) >= 3) for (const l of openLines(p, b)) {
          const o = otherBox(p, l, b);
          if (o >= 0 && deg(p, o) === 2) starts.push({ box: o, from: l });
        }
        for (const st of starts) {
          const arm: number[] = [];
          let cur = st.box;
          let from = st.from;
          while (cur >= 0 && deg(p, cur) === 2 && !arm.includes(cur)) {
            arm.push(cur);
            const next = openLines(p, cur).find((l) => l !== from);
            if (next === undefined) break;
            from = next;
            cur = otherBox(p, next, cur);
          }
          if (arm.length && (!junctionArm || arm.length < junctionArm.boxes.length)) junctionArm = { boxes: arm };
        }
      }
    }
    if (!junctionArm) return out.concat(simple);
    out.push({ loop: false, n: junctionArm.boxes.length });
    for (const b of junctionArm.boxes) for (const l of openLines(p, b)) draw(p, l);
  }
  return out;
}

const dpMemo = new Map<string, number>();
/** Net boxes for the player who must open one of these chains or loops, both sides playing perfectly. */
export function chainValue(comps: readonly Comp[]): number {
  if (!comps.length) return 0;
  const sorted = comps.map((c) => (c.loop ? 'l' : 'c') + c.n).sort();
  const key = sorted.join(',');
  const hit = dpMemo.get(key);
  if (hit !== undefined) return hit;
  let best = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    if (i && sorted[i] === sorted[i - 1]) continue;
    const loop = sorted[i][0] === 'l';
    const n = Number(sorted[i].slice(1));
    const rest = sorted.filter((_, j) => j !== i).map((s) => ({ loop: s[0] === 'l', n: Number(s.slice(1)) }));
    const r = chainValue(rest);
    let opp = n + r;
    if (loop) opp = Math.max(opp, n - 8 - r);
    else if (n >= 3) opp = Math.max(opp, n - 4 - r);
    best = Math.max(best, -opp);
  }
  best += 0;
  if (dpMemo.size > 50_000) dpMemo.clear();
  dpMemo.set(key, best);
  return best;
}
const loonyValue = (p: Pos) => chainValue(components(p));

type Clock = { until: number; aborted: boolean };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ABORT = Symbol('abort');

/** Exact negamax over the safe moves left (the order never matters, so a bitmask of drawn ones is the whole state). */
function searchSafe(p: Pos, clock: Clock, rng: Rng): { line: number; value: number } | null {
  const S = safeLines(p);
  if (!S.length || S.length > 26) return null;
  const memo = new Map<number, number>();
  let nodes = 0;
  const rec = (mask: number): number => {
    const hit = memo.get(mask);
    if (hit !== undefined) return hit;
    if ((++nodes & 255) === 0 && now() > clock.until) throw ABORT;
    let best = -Infinity;
    for (let i = 0; i < S.length; i++) {
      if (mask & (1 << i) || !isSafe(p, S[i])) continue;
      draw(p, S[i]);
      const v = -rec(mask | (1 << i));
      undraw(p, S[i]);
      if (v > best) best = v;
    }
    if (best === -Infinity) best = loonyValue(p);
    memo.set(mask, best);
    return best;
  };
  const drawnBefore = p.drawn.slice();
  try {
    let best: number[] = [];
    let bestV = -Infinity;
    for (let i = 0; i < S.length; i++) {
      draw(p, S[i]);
      const v = -rec(1 << i);
      undraw(p, S[i]);
      if (v > bestV) {
        bestV = v;
        best = [S[i]];
      } else if (v === bestV) best.push(S[i]);
    }
    return { line: best[Math.floor(rng() * best.length)], value: bestV };
  } catch (e) {
    if (e !== ABORT) throw e;
    // put the position back the way it was
    for (let l = 0; l < p.g.lines; l++) if (p.drawn[l] && !drawnBefore[l]) undraw(p, l);
    clock.aborted = true;
    return null;
  }
}

/** Random safe playouts to the loony endgame, scored with the chain values, for positions too big to search. */
function sampleSafe(p: Pos, clock: Clock, rng: Rng): { line: number; value: number } {
  const S = safeLines(p);
  const totals = new Float64Array(S.length);
  const counts = new Uint32Array(S.length);
  let round = 0;
  do {
    for (let i = 0; i < S.length; i++) {
      const trail = [S[i]];
      draw(p, S[i]);
      let depth = 1;
      for (;;) {
        const opts = safeLines(p);
        if (!opts.length) break;
        const l = opts[Math.floor(rng() * opts.length)];
        draw(p, l);
        trail.push(l);
        depth++;
      }
      const v = loonyValue(p);
      totals[i] += depth % 2 === 0 ? v : -v;
      counts[i]++;
      for (let k = trail.length - 1; k >= 0; k--) undraw(p, trail[k]);
    }
    round++;
  } while (now() < clock.until && round < 400);
  let best = 0;
  for (let i = 1; i < S.length; i++) if (totals[i] / counts[i] > totals[best] / counts[best]) best = i;
  return { line: S[best], value: totals[best] / counts[best] };
}

/** Net boxes for the player to move, who has nothing to capture. */
function moverValue(p: Pos, clock: Clock, rng: Rng): number {
  if (capturable(p).length) return capturerValue(clone(p), clock, rng);
  if (!safeLines(p).length) return loonyValue(p);
  const exact = now() < clock.until ? searchSafe(p, clock, rng) : null;
  if (exact) return exact.value;
  return sampleSafe(p, { until: Math.min(clock.until, now() + 4), aborted: false }, rng).value;
}

type Capture = { line: number; kind: 'free' | 'decide'; group?: number[]; k?: number; decline?: number };
/** What the capturer's options look like now: a box to take with no decision, or the final decision of a chain or loop. */
function nextCapture(p: Pos): Capture | null {
  const caps = capturable(p);
  if (!caps.length) return null;
  let decide: Capture | null = null;
  for (const b of caps) {
    const e = openLines(p, b)[0];
    const n = otherBox(p, e, b);
    if (n < 0 || deg(p, n) !== 2) return { line: e, kind: 'free' };
    const f = openLines(p, n).find((l) => l !== e)!;
    const fo = otherBox(p, f, n);
    if (fo < 0 || deg(p, fo) >= 3) {
      decide ??= { line: e, kind: 'decide', group: [b, n], k: 2, decline: f };
      continue;
    }
    if (deg(p, fo) === 2) {
      const g = openLines(p, fo).find((l) => l !== f)!;
      const b2 = otherBox(p, g, fo);
      if (b2 >= 0 && b2 !== b && deg(p, b2) === 1) {
        decide ??= { line: e, kind: 'decide', group: [b, n, fo, b2], k: 4, decline: f };
        continue;
      }
    }
    return { line: e, kind: 'free' };
  }
  return decide;
}

function takeGroup(p: Pos, c: Capture) {
  let taken = draw(p, c.line);
  for (let guard = 0; guard < 8; guard++) {
    const left = c.group!.filter((b) => !p.owned[b]);
    if (!left.length) break;
    const b = left.find((x) => p.sides[x] === 3);
    if (b === undefined) break;
    taken += draw(p, openLines(p, b)[0]);
  }
  return taken;
}

/** Net boxes for a player who has captures waiting, taking them all or declining the last ones, whichever is better. */
function capturerValue(p: Pos, clock: Clock, rng: Rng): number {
  let taken = 0;
  for (let guard = 0; guard < 400; guard++) {
    const c = nextCapture(p);
    if (!c) return taken + moverValue(p, clock, rng);
    if (c.kind === 'free') {
      taken += draw(p, c.line);
      continue;
    }
    const k = takeGroup(p, c);
    if (nextCapture(p)) {
      taken += k;
      continue;
    }
    const w = moverValue(p, clock, rng);
    return Math.max(taken + k + w, taken - k - w);
  }
  return taken;
}

/** The capture to make now, choosing at the end of a chain whether to take it all or leave the last boxes (a double cross). */
function hardCapture(p: Pos, clock: Clock, rng: Rng): number | null {
  const c = nextCapture(p);
  if (!c) return null;
  if (c.kind === 'free') return c.line;
  const q = clone(p);
  const k = takeGroup(q, c);
  if (nextCapture(q)) return c.line;
  const w = moverValue(q, clock, rng);
  return w >= -k ? c.line : c.decline!;
}

/** Boxes a greedy opponent collects after this line is drawn. */
function giveaway(p: Pos, l: number): number {
  const q = clone(p);
  draw(q, l);
  let n = 0;
  for (let caps = capturable(q); caps.length; caps = capturable(q)) for (const b of caps) if (!q.owned[b]) n += draw(q, openLines(q, b)[0]);
  return n;
}

const pickOf = <T,>(a: readonly T[], rng: Rng) => a[Math.floor(rng() * a.length)];

/**
 * The computer's line. Easy grabs most boxes and often avoids third sides. Normal always takes boxes, never gives one
 * away while it can help it, and then opens the smallest chain. Hard searches the safe moves to win the chain parity
 * fight, opens chains in the right order (two-chains split down the middle) and double crosses when it pays.
 */
export function chooseMove(game: Pick<Game, 'rows' | 'cols' | 'lines'>, level: Level, rng: Rng = Math.random, ms = 450): number {
  const p = posOf(game);
  const all = undrawn(p);
  if (!all.length) return -1;
  const caps = capturable(p);
  const safe = safeLines(p);
  if (level === 0) {
    if (caps.length && rng() < 0.75) return openLines(p, pickOf(caps, rng))[0];
    if (safe.length && rng() < 0.6) return pickOf(safe, rng);
    return pickOf(all, rng);
  }
  if (level === 1) {
    if (caps.length) return openLines(p, caps[0])[0];
    if (safe.length) return pickOf(safe, rng);
    let min = Infinity;
    let best: number[] = [];
    for (const l of all) {
      const n = giveaway(p, l);
      if (n < min) {
        min = n;
        best = [l];
      } else if (n === min) best.push(l);
    }
    return pickOf(best, rng);
  }
  const clock: Clock = { until: now() + ms, aborted: false };
  const cap = hardCapture(p, clock, rng);
  if (cap !== null) return cap;
  if (safe.length) {
    if (safe.length > 40) return pickOf(safe, rng);
    const exact = searchSafe(p, { until: now() + ms * 0.6, aborted: false }, rng);
    if (exact) return exact.line;
    return sampleSafe(p, { until: clock.until, aborted: false }, rng).line;
  }
  // every line gives something away: open the one that leaves the opponent the least
  let bestV = -Infinity;
  let best: number[] = [];
  const evalClock: Clock = { until: now() + ms, aborted: false };
  for (const l of all) {
    const q = clone(p);
    draw(q, l);
    const v = -capturerValue(q, evalClock, rng);
    if (v > bestV + 1e-9) {
      bestV = v;
      best = [l];
    } else if (Math.abs(v - bestV) <= 1e-9) best.push(l);
  }
  return pickOf(best, rng);
}

export function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
