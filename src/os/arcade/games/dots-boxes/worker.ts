import { chooseMove, mulberry, type Level } from './dots.ts';

export type AiRequest = { id: number; rows: number; cols: number; lines: number[]; level: Level; seed: number; ms: number };
export type AiReply = { id: number; line: number };

export function answer(req: AiRequest): AiReply {
  return { id: req.id, line: chooseMove(req, req.level, mulberry(req.seed), req.ms) };
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  (self as unknown as Worker).postMessage(answer(e.data));
};
