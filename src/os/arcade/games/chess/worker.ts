// Runs the chess search off the main thread. Messages: { id, fen, keys, level } -> { id, from, to, promo }.
import { bestMove, type Level } from './ai.ts';
import { fromFen, moveFrom, movePromo, moveTo } from './engine.ts';

export type AiRequest = { id: number; fen: string; keys: string[]; level: Level };
export type AiReply = { id: number; from: number; to: number; promo: number } | { id: number; from: -1; to: -1; promo: 0 };

export function answer(req: AiRequest): AiReply {
  const r = bestMove(fromFen(req.fen), req.level, req.keys);
  if (!r) return { id: req.id, from: -1, to: -1, promo: 0 };
  return { id: req.id, from: moveFrom(r.move), to: moveTo(r.move), promo: movePromo(r.move) };
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  (self as unknown as Worker).postMessage(answer(e.data));
};
