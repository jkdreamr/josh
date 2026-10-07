import { bestMove, type Color, type Level, type Move } from './checkers.ts';

export type AiRequest = { id: number; board: number[]; side: Color; level: Level };
export type AiReply = { id: number; move: Move | null };

export function answer(req: AiRequest): AiReply {
  return { id: req.id, move: bestMove(new Uint8Array(req.board), req.side, req.level) };
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  (self as unknown as Worker).postMessage(answer(e.data));
};
