import { decide, type Level } from './ai.ts';
import { randomFrom, type View } from './logic.ts';

export type AiRequest = { id: number; view: View; level: Level; seed: number; ms: number };
export type AiReply = { id: number; move: ReturnType<typeof decide> };

export function answer(req: AiRequest): AiReply {
  return { id: req.id, move: decide(req.view, req.level, randomFrom(req.seed), { ms: req.ms }) };
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  (self as unknown as Worker).postMessage(answer(e.data));
};
