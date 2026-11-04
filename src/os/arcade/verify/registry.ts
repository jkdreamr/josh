// Every game whose leaderboard scores the Worker checks, by game id (see verify/protocol.ts). A board's game is in
// BOARD_OWNERS (worker/src/specs.gen.ts); a board whose game is here only takes scores from runs its verifier passed.
import type { Verifier } from './protocol.ts';
import { verifier as blocks } from '../games/blocks/verify.ts';
import { verifier as breakout } from '../games/breakout/verify.ts';
import { verifier as bubbleShooter } from '../games/bubble-shooter/verify.ts';
import { verifier as dino } from '../games/dino/verify.ts';
import { verifier as flappy } from '../games/flappy/verify.ts';
import { verifier as game2048 } from '../games/2048/verify.ts';
import { verifier as snake } from '../games/snake/verify.ts';
import { verifier as stack } from '../games/stack/verify.ts';

export const VERIFIERS: Record<string, Verifier<any>> = {
  blocks,
  breakout,
  'bubble-shooter': bubbleShooter,
  dino,
  flappy,
  '2048': game2048,
  snake,
  stack,
};
