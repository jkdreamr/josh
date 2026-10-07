import { BLACK, isOwnEye, legalMoves, pass, play, score, type GameState, type Point } from '../go.ts';

export type NetOutput = {
  policy: Float32Array;
  win: number;
  loss: number;
  noResult: number;
  scoreLead: number;
  ownership: Float32Array;
};

export interface Evaluator {
  evaluate(states: GameState[]): Promise<NetOutput[]>;
  evaluateSymmetric?(state: GameState): Promise<NetOutput>;
}

export type SearchOptions = {
  maxVisits: number;
  maxTimeMs: number;
  batchSize: number;
  openingSampleMoves?: number;
  rng?: () => number;
  shouldStop?: () => boolean;
  rootSymmetries?: boolean;
};

export const STRONG: SearchOptions = { maxVisits: 400, maxTimeMs: 1500, batchSize: 8, rootSymmetries: true };
export const FAST: SearchOptions = { maxVisits: 12, maxTimeMs: 400, batchSize: 4, openingSampleMoves: 10 };

export type SearchResult = {
  move: Point | null;
  visits: number;
  winrate: number;
  scoreLead: number;
  elapsedMs: number;
  children: { move: Point | null; visits: number; prior: number; q: number }[];
};

type Node = {
  state: GameState;
  move: Point | null;
  prior: number;
  visits: number;
  valueSum: number;
  output?: NetOutput;
  children?: Node[];
};

const utility = (output: NetOutput): number => (output.win - output.loss) + 0.15 * (2 / Math.PI) * Math.atan(output.scoreLead / 3.6);
const pointIndex = (point: Point): number => point.y * 9 + point.x;

export function deadFromOwnership(state: GameState, ownershipBlack: ArrayLike<number>, threshold = 0.7): Set<number> {
  const dead = new Set<number>();
  state.board.forEach((stone, index) => {
    if ((stone === BLACK && ownershipBlack[index]! < -threshold) || (stone === -BLACK && ownershipBlack[index]! > threshold)) dead.add(index);
  });
  return dead;
}

function ownershipBlackFromOutput(state: GameState, output: NetOutput): Float32Array {
  const sign = state.toPlay === BLACK ? 1 : -1;
  return Float32Array.from(output.ownership, (value) => value * sign);
}

function createChildren(node: Node, output: NetOutput): void {
  const moves = legalMoves(node.state);
  const passIndex = 81;
  let priorSum = output.policy[passIndex] ?? 0;
  for (const move of moves) priorSum += Math.max(0, output.policy[pointIndex(move)] ?? 0);
  const uniformPrior = !(priorSum > 0);
  if (uniformPrior) priorSum = moves.length + 1;
  node.children = moves.map((move) => {
    const value = Math.max(0, output.policy[pointIndex(move)] ?? 0);
    return { state: play(node.state, move.x, move.y).state, move, prior: uniformPrior ? 1 / priorSum : value / priorSum, visits: 0, valueSum: 0 };
  });
  const afterPass = pass(node.state);
  const passPrior = Math.max(0, output.policy[passIndex] ?? 0);
  node.children.push({ state: afterPass, move: null, prior: uniformPrior ? 1 / priorSum : passPrior / priorSum, visits: 0, valueSum: 0 });
}

function selectLeaf(root: Node, pending: Set<Node>): { leaf: Node; path: Node[] } | null {
  const path = [root];
  let node = root;
  while (node.children && node.state.phase === 'play') {
    const available = node.children.filter((child) => !pending.has(child));
    if (!available.length) return null;
    const parentVisits = Math.sqrt(Math.max(1, node.visits));
    const visitedPrior = node.children.reduce((sum, child) => child.visits > 0 ? sum + child.prior : sum, 0);
    let best: Node | undefined;
    let bestScore = -Infinity;
    for (const child of available) {
      const reduction = node === root ? 0.1 : 0.2;
      const q = child.visits ? -child.valueSum / child.visits : node.visits ? node.valueSum / node.visits - reduction * Math.sqrt(visitedPrior) : 0;
      const value = q + 1.1 * child.prior * parentVisits / (1 + child.visits);
      if (value > bestScore) {
        best = child;
        bestScore = value;
      }
    }
    if (!best) return null;
    node = best;
    path.push(node);
  }
  return { leaf: node, path };
}

function terminalUtility(state: GameState, output: NetOutput): number {
  const dead = deadFromOwnership(state, ownershipBlackFromOutput(state, output));
  const result = score(state, dead);
  const margin = (result.black - result.white) * state.toPlay;
  const winLoss = Math.sign(margin);
  return winLoss + 0.15 * (2 / Math.PI) * Math.atan(margin / 3.6);
}

function countMargin(state: GameState, output: NetOutput, perspective: number): number {
  const count = score(state, deadFromOwnership(state, ownershipBlackFromOutput(state, output)));
  return (count.black - count.white) * perspective;
}

export async function search(state: GameState, evaluator: Evaluator, options: SearchOptions): Promise<SearchResult> {
  const started = performance.now();
  if (state.phase !== 'play') return { move: null, visits: 0, winrate: 0, scoreLead: 0, elapsedMs: 0, children: [] };
  const root: Node = { state, move: null, prior: 1, visits: 0, valueSum: 0 };
  const rootOutput = options.rootSymmetries && evaluator.evaluateSymmetric
    ? await evaluator.evaluateSymmetric(state)
    : (await evaluator.evaluate([state]))[0]!;
  root.output = rootOutput;
  createChildren(root, rootOutput);
  const pending = new Set<Node>();
  const maxVisits = Math.max(1, Math.floor(options.maxVisits));
  const batchSize = Math.max(1, Math.floor(options.batchSize));
  let stop = false;
  while (!stop && root.visits < maxVisits && performance.now() - started < options.maxTimeMs && !options.shouldStop?.()) {
    const leaves: Array<{ leaf: Node; path: Node[] }> = [];
    while (leaves.length < batchSize && root.visits + leaves.length < maxVisits) {
      const item = selectLeaf(root, pending);
      if (!item) break;
      pending.add(item.leaf);
      for (const node of item.path.slice(1)) {
        node.visits += 1;
        node.valueSum += 1;
      }
      leaves.push(item);
    }
    if (!leaves.length) break;
    const uncached = leaves.filter(({ leaf }) => !leaf.output);
    const evaluated = uncached.length ? await evaluator.evaluate(uncached.map(({ leaf }) => leaf.state)) : [];
    let evaluatedIndex = 0;
    for (let i = 0; i < leaves.length; i += 1) {
      const { leaf, path } = leaves[i]!;
      const output = leaf.output ?? evaluated[evaluatedIndex++]!;
      pending.delete(leaf);
      for (const node of path.slice(1)) {
        node.visits -= 1;
        node.valueSum -= 1;
      }
      leaf.output = output;
      const isTerminal = leaf.state.phase !== 'play';
      if (!isTerminal) createChildren(leaf, output);
      let value = isTerminal ? terminalUtility(leaf.state, output) : utility(output);
      for (let index = path.length - 1; index >= 0; index -= 1) {
        const node = path[index]!;
        node.visits += 1;
        node.valueSum += value;
        value *= -1;
      }
    }
    if (options.shouldStop?.()) break;
    const sorted = [...root.children!].sort((a, b) => b.visits - a.visits);
    const remaining = maxVisits - root.visits;
    if (sorted[0] && sorted[0].visits > (sorted[1]?.visits ?? 0) + remaining) stop = true;
  }

  const children = root.children!.map((child) => ({
    move: child.move,
    visits: child.visits,
    prior: child.prior,
    q: child.visits ? -child.valueSum / child.visits : 0,
  }));
  const sorted = [...root.children!].sort((a, b) => b.visits - a.visits || (-a.valueSum / Math.max(1, a.visits)) - (-b.valueSum / Math.max(1, b.visits)));
  let chosen = sorted[0];
  if (options.openingSampleMoves !== undefined && state.past.length < 2 * options.openingSampleMoves) {
    const candidates = sorted.filter((child) => child.visits >= 2);
    const total = candidates.reduce((sum, child) => sum + child.visits ** 2, 0);
    if (total > 0) {
      let draw = (options.rng ?? Math.random)() * total;
      chosen = candidates.find((child) => (draw -= child.visits ** 2) < 0) ?? chosen;
    }
  }
  let countAhead = false;
  let countBehind = false;
  if (state.consecutivePasses === 1) {
    const finalState = pass(state);
    const finalOutput = evaluator.evaluateSymmetric
      ? await evaluator.evaluateSymmetric(finalState)
      : (await evaluator.evaluate([finalState]))[0]!;
    const margin = countMargin(finalState, finalOutput, state.toPlay);
    countAhead = margin > 0;
    countBehind = margin < 0;
  }
  const legalNonEye = legalMoves(state).filter((move) => !isOwnEye(state.board, state.size, pointIndex(move), state.toPlay));
  const selectedPass = chosen?.move === null;
  const countPassWins = state.consecutivePasses === 1 && countAhead;
  let move = selectedPass || countPassWins ? null : chosen?.move ?? null;
  if (!countPassWins && (rootOutput.scoreLead < 0 || (state.consecutivePasses === 1 && countBehind)) && legalNonEye.length > 0 && move === null) {
    const fallback = [...root.children!]
      .filter((child) => child.move && !isOwnEye(state.board, state.size, pointIndex(child.move), state.toPlay))
      .sort((a, b) => b.visits - a.visits || b.prior - a.prior)[0];
    move = fallback?.move ?? legalNonEye[0]!;
  }
  return {
    move,
    visits: root.visits,
    winrate: rootOutput.win + rootOutput.noResult * 0.5,
    scoreLead: rootOutput.scoreLead,
    elapsedMs: performance.now() - started,
    children,
  };
}
