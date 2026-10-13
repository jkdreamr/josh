import { aiMove, ownership, type GameState } from './go.ts';
import type { Ownership, Point } from './go.ts';
import { goLevel, isGoLevel, type GoLevelId } from './go-levels.ts';
import type { KataGo } from './katago/engine.ts';

type Request =
  | { id: number; type: 'ai'; state: GameState; level?: GoLevelId; budgetMs?: number }
  | { id: number; type: 'ownership'; state: GameState; playouts?: number };
type Incoming = Request | { type: 'load' };
type Response =
  | { id: number; type: 'ai'; move: Point | null }
  | { id: number; type: 'ownership'; values: Ownership[] }
  | { type: 'engine'; status: 'loading' | 'ready' | 'failed'; backend?: string };

const scope = self as unknown as {
  onmessage: (event: MessageEvent<Incoming>) => void;
  postMessage: (message: Response) => void;
};
let latestId = 0;
let engine: KataGo | null = null;
let enginePromise: Promise<KataGo> | null = null;
let queue = Promise.resolve();

function loadEngine(): Promise<KataGo> {
  if (engine) {
    scope.postMessage({ type: 'engine', status: 'ready', backend: engine.backend });
    return Promise.resolve(engine);
  }
  if (enginePromise) {
    return enginePromise.then(
      (loaded) => {
        scope.postMessage({ type: 'engine', status: 'ready', backend: loaded.backend });
        return loaded;
      },
      (error: unknown) => {
        scope.postMessage({ type: 'engine', status: 'failed' });
        throw error;
      },
    );
  }
  scope.postMessage({ type: 'engine', status: 'loading' });
  enginePromise = (async () => {
    const [{ KataGo, fetchModel }, { BROWSER_BACKENDS }] = await Promise.all([
      import('./katago/engine.ts'),
      import('./katago/backends.ts'),
    ]);
    const model = await fetchModel('/models/kata1-b10c128-s1141046784-d204142634.bin.gz');
    const loaded = await KataGo.load(model, BROWSER_BACKENDS);
    engine = loaded;
    scope.postMessage({ type: 'engine', status: 'ready', backend: loaded.backend });
    return loaded;
  })().catch((error: unknown) => {
    scope.postMessage({ type: 'engine', status: 'failed' });
    throw error;
  });
  return enginePromise;
}

async function waitForEngine(): Promise<KataGo | null> {
  if (!enginePromise) loadEngine();
  if (engine) return engine;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      enginePromise!,
      new Promise<null>((resolve) => { timer = globalThis.setTimeout(() => resolve(null), 25_000); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The pick levels answer in one network call; a short pause keeps them from replying instantly. */
const PICK_MIN_MS = 350;

async function engineMove(engine: KataGo, request: Request & { type: 'ai' }): Promise<Point | null> {
  const level = goLevel(isGoLevel(request.level) ? request.level : 'strong');
  if ('search' in level) {
    return (await engine.genmove(request.state, level.search, { shouldStop: () => latestId !== request.id })).move;
  }
  const started = performance.now();
  const move = await engine.pickmove(request.state, level.kyu);
  const wait = PICK_MIN_MS - (performance.now() - started);
  if (wait > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, wait));
  return move;
}

async function processRequest(request: Request): Promise<void> {
  if (request.type === 'ai') {
    const loaded = await waitForEngine();
    // Without the network, the Monte Carlo player stands in: a short budget below Master, the long one at it.
    const fallbackMs = request.budgetMs ?? (request.level === undefined || request.level === 'strong' ? 700 : 150);
    let move: Point | null;
    if (loaded) {
      try {
        move = await engineMove(loaded, request);
      } catch {
        move = aiMove(request.state, fallbackMs);
      }
    } else {
      move = aiMove(request.state, fallbackMs);
    }
    scope.postMessage({ id: request.id, type: 'ai', move });
    return;
  }
  if (engine) {
    try {
      scope.postMessage({ id: request.id, type: 'ownership', values: await engine.ownership(request.state) });
      return;
    } catch {
      // Use the existing local analysis if a network evaluation fails.
    }
  }
  scope.postMessage({ id: request.id, type: 'ownership', values: ownership(request.state, request.playouts ?? 400) });
}

scope.onmessage = ({ data }) => {
  if (data.type === 'load') {
    void loadEngine().catch(() => {});
    return;
  }
  latestId = data.id;
  queue = queue.then(() => processRequest(data)).catch(() => {});
};
