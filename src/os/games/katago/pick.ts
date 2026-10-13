import { isOwnEye, type GameState, type Point } from '../go.ts';
import type { Evaluator } from './search.ts';

/**
 * Rank-limited play from the raw policy, after KaTrain's calibrated rank strategy (MIT): look at
 * a handful of random legal moves and play the one the network likes best. The weaker the rank,
 * the fewer moves it looks at, so it misses more of the good ones. Obvious moves (one the network
 * is very sure of) are always found, and once pass is among the top five ideas it plays the top
 * one, so it finishes games cleanly instead of filling its own territory.
 *
 * `kyu` is the target rank on 19x19: 18 is a beginner, 1 is a strong club player, 0 is 1 dan.
 * `null` always plays the network's first choice.
 */
export function candidateCount(kyu: number, area: number, legal: number): number {
  const calibrated = 0.063015 + 0.7624 * area / 10 ** (-0.05737 * kyu + 1.9482);
  const share = legal / area;
  const modified = (0.3931 + 0.6559 * share * Math.exp(-((3.002 * share * share - share - 0.034889 * kyu - 0.5097) ** 2)) - 0.01093 * kyu) * calibrated;
  return Math.max(1, Math.round(area * share / (1.31165 * (modified + 1) - 0.082653)));
}

export async function pickMove(state: GameState, evaluator: Evaluator, kyu: number | null, rng: () => number = Math.random): Promise<Point | null> {
  if (state.phase !== 'play') return null;
  const [output] = await evaluator.evaluate([state]);
  const size = state.size;
  const area = size * size;
  const policy = output!.policy;
  const ranked: { index: number; prior: number }[] = [];
  for (let index = 0; index <= area; index += 1) {
    if (policy[index]! > 0) ranked.push({ index, prior: policy[index]! });
  }
  ranked.sort((a, b) => b.prior - a.prior);
  const toPoint = (index: number): Point | null => (index === area ? null : { x: index % size, y: Math.floor(index / size) });
  const top = ranked[0];
  if (!top) return null;
  if (ranked.slice(0, 5).some((move) => move.index === area)) return toPoint(top.index);

  const legal = ranked.filter((move) => move.index !== area && !isOwnEye(state.board, size, move.index, state.toPlay));
  if (!legal.length) return toPoint(top.index);
  if (kyu === null) return toPoint(legal[0]!.index);
  const override = 0.8 * (1 - 0.5 * (area - legal.length) / area);
  const overrideTwo = 0.85 + Math.max(0, 0.02 * (kyu - 8));
  if (top.prior > override || top.prior + (ranked[1]?.prior ?? 0) > overrideTwo) return toPoint(top.index);

  // A partial Fisher-Yates shuffle draws `count` distinct moves; `legal` is sorted, so the best
  // drawn is the one with the lowest position.
  const count = Math.min(legal.length, candidateCount(kyu, area, legal.length));
  const order = legal.map((_, position) => position);
  let best = Infinity;
  for (let drawn = 0; drawn < count; drawn += 1) {
    const swap = drawn + Math.floor(rng() * (order.length - drawn));
    [order[drawn], order[swap]] = [order[swap]!, order[drawn]!];
    best = Math.min(best, order[drawn]!);
  }
  return toPoint(legal[best]!.index);
}
