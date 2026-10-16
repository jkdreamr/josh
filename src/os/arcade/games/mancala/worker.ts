import { chooseMove, type Level, type Side } from './mancala.ts';

export type AiRequest = { id: number; board: number[]; side: Side; level: Level };
export type AiReply = { id: number; pit: number };

export function answer(req: AiRequest): AiReply {
  return { id: req.id, pit: chooseMove(req.board.slice(), req.side, req.level, req.level === 2 ? { budgetMs: 700 } : {}) };
}

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent<AiRequest>) => {
    (self as unknown as Worker).postMessage(answer(e.data));
  };
}
