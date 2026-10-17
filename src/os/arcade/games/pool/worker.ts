import { chooseShot, type Level } from './ai.ts';
import type { Game, Shot } from './logic.ts';

export type AiRequest = { id: number; game: Game; level: Level };
export type AiReply = { id: number; shot: Shot };

export function answer(req: AiRequest): AiReply {
  return { id: req.id, shot: chooseShot(req.game, req.level) };
}

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent<AiRequest>) => {
    (self as unknown as Worker).postMessage(answer(e.data));
  };
}
