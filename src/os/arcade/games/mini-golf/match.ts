// Round rules shared by local hot seat and online play: lies, strokes, penalties, turn order, scorecard.
import { distTo, type Level } from './bot.ts';
import { HOLES, type Hole, type V } from './holes.ts';
import { type Ball, restBall } from './physics.ts';

export const MAX_STROKES = 7;
export const COLORS = ['#f4f1ea', '#f2c14e', '#5aa9e6', '#ef6f6c'];
export const BOT_NAMES = ['Ellie', 'Marcus', 'Priya', 'Theo'];

export type Kind = 'human' | 'bot' | 'remote';
export type Golfer = { name: string; color: string; kind: Kind; level: Level; left: boolean };
export type Lie = { ball: Ball; strokes: number; done: boolean };
export type Match = {
  holes: Hole[];
  golfers: Golfer[];
  hole: number;
  lies: Lie[];
  card: number[][];
  order: number[];
};

export function newMatch(golfers: Golfer[], holes: Hole[] = HOLES): Match {
  const m: Match = { holes, golfers, hole: 0, lies: [], card: golfers.map(() => holes.map(() => -1)), order: golfers.map((_, i) => i) };
  startHole(m, 0);
  return m;
}

export function startHole(m: Match, i: number) {
  m.hole = i;
  const h = m.holes[i];
  m.lies = m.golfers.map(() => ({ ball: restBall(h.tee.x, h.tee.z), strokes: 0, done: false }));
  if (i > 0) {
    // Honors: best score on the last hole tees off first, ties keep the previous order.
    const prev = m.order.slice();
    m.order = prev.slice().sort((a, b) => m.card[a][i - 1] - m.card[b][i - 1] || prev.indexOf(a) - prev.indexOf(b));
  }
}

export const hole = (m: Match) => m.holes[m.hole];

// Next golfer to putt in turn-based play: whoever is farthest from the cup, honors breaking ties.
export function nextUp(m: Match): number {
  const h = hole(m);
  let best = -1;
  let bd = -1;
  for (const g of m.order) {
    const l = m.lies[g];
    if (l.done) continue;
    const d = l.strokes === 0 ? 1e6 - m.order.indexOf(g) : distTo(h, l.ball.x, l.ball.z);
    if (d > bd + 1e-6) {
      bd = d;
      best = g;
    }
  }
  return best;
}

export type Outcome = 'holed' | 'water' | 'rest' | 'pickup';

// Applies a finished putt. `from` is where it was struck; water costs a stroke and replays from there.
export function applyPutt(m: Match, g: number, from: V, end: Ball): Outcome {
  const l = m.lies[g];
  l.strokes++;
  let out: Outcome = end.state === 'holed' ? 'holed' : end.state === 'water' ? 'water' : 'rest';
  if (out === 'water') {
    l.strokes++;
    l.ball = restBall(from.x, from.z, end.t);
  } else l.ball = { ...end, state: end.state === 'holed' ? 'holed' : 'rest', vx: 0, vz: 0, loop: null };
  if (out === 'holed') l.done = true;
  if (!l.done && l.strokes >= MAX_STROKES) {
    l.done = true;
    out = 'pickup';
  }
  l.strokes = Math.min(MAX_STROKES, l.strokes);
  if (l.done) m.card[g][m.hole] = l.strokes;
  return out;
}

export function forfeitHole(m: Match, g: number) {
  const l = m.lies[g];
  if (l.done) return;
  l.done = true;
  l.strokes = MAX_STROKES;
  m.card[g][m.hole] = MAX_STROKES;
}

export const holeDone = (m: Match) => m.lies.every((l) => l.done);
export const lastHole = (m: Match) => m.hole >= m.holes.length - 1;

export const total = (m: Match, g: number) => m.card[g].reduce((s, v) => s + (v > 0 ? v : 0), 0);
export const parThrough = (m: Match, g: number) => m.card[g].reduce((s, v, i) => s + (v > 0 ? m.holes[i].par : 0), 0);
export const toPar = (m: Match, g: number) => total(m, g) - parThrough(m, g);

// Lowest total among golfers still in the round; null on a tie.
export function winner(m: Match): number | null {
  let best: number | null = null;
  let tie = false;
  m.golfers.forEach((gf, g) => {
    if (gf.left) return;
    if (best === null || total(m, g) < total(m, best)) {
      best = g;
      tie = false;
    } else if (total(m, g) === total(m, best)) tie = true;
  });
  return tie ? null : best;
}

export function standings(m: Match): number[] {
  return m.golfers.map((_, i) => i).sort((a, b) => Number(m.golfers[a].left) - Number(m.golfers[b].left) || total(m, a) - total(m, b) || a - b);
}

export function label(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in One';
  const d = strokes - par;
  if (d <= -3) return 'Albatross';
  if (d === -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double Bogey';
  return `+${d}`;
}

export const fmtPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
