import { bestCol, type Board, type Level, type Player } from './connect4.ts';

export type AiRequest = { id: number; board: number[]; side: Player; level: Level };
export type AiReply = { id: number; col: number };

/** Hard stops thinking after this long even when its node budget isn't spent, so slow devices still move promptly. */
export const THINK_MS = 1100;

export function answer(req: AiRequest, ms = THINK_MS): AiReply {
  return { id: req.id, col: bestCol(req.board as Board, req.side, req.level, Math.random, { ms }) };
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  (self as unknown as Worker).postMessage(answer(e.data));
};
