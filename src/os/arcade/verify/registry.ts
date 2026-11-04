// Every game whose leaderboard scores the Worker checks, by game id (see verify/protocol.ts). A board's game is in
// BOARD_OWNERS (worker/src/specs.gen.ts); a board whose game is here only takes scores from runs its verifier passed.
import type { Verifier } from './protocol.ts';
import { verifier as blocks } from '../games/blocks/verify.ts';
import { verifier as flappy } from '../games/flappy/verify.ts';

export const VERIFIERS: Record<string, Verifier<any>> = {
  blocks,
  flappy,
};
