import { aiMove, ownership, type GameState } from './go';

type Request =
  | { id: number; type: 'ai'; state: GameState; budgetMs: number }
  | { id: number; type: 'ownership'; state: GameState; playouts: number };

type Response =
  | { id: number; type: 'ai'; move: ReturnType<typeof aiMove> }
  | { id: number; type: 'ownership'; values: ReturnType<typeof ownership> };

const scope = self as unknown as {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage: (message: Response) => void;
};

scope.onmessage = ({ data }) => {
  if (data.type === 'ai') scope.postMessage({ id: data.id, type: 'ai', move: aiMove(data.state, data.budgetMs) });
  else scope.postMessage({ id: data.id, type: 'ownership', values: ownership(data.state, data.playouts) });
};
