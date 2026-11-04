// The Worker's real Boards object in one process, for testing a game's ranked runs end to end (see verify/protocol.ts):
// node:sqlite stands in for the Durable Object's SQL storage, the clock and the seeds it picks are the test's.
//
//   const w = rankedWorker();            // in a beforeEach (and w.restore() in an afterEach)
//   const { run, seed } = await w.open('flappy');
//   await w.call('/runs/start', { run, init });
//   w.clock += 8_000; await w.call('/runs/feed', { run, n: 0, e, t });
//   ...
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { FEED_MS } from '../src/os/arcade/verify/protocol.ts';

// The Worker's modules import 'cloudflare:workers' and each other without extensions, as wrangler's bundler allows.
const hooks = `
const STUB = 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: STUB, shortCircuit: true };
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL && context.parentURL.includes('/worker/src/')) return next(specifier + '.ts', context);
  return next(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const { Boards } = (await import('../worker/src/index.ts')) as unknown as { Boards: new (ctx: unknown, env: unknown) => { fetch(r: Request): Promise<Response> } };

/** A Durable Object's SQL storage on node:sqlite: exec(query, ...params) with toArray(), one() and rowsWritten. */
function sqlStorage(db: DatabaseSync) {
  return {
    exec(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      if (/^\s*select/i.test(query)) {
        const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
        return { toArray: () => rows.map((r) => ({ ...r })), one: () => ({ ...rows[0] }), rowsWritten: 0 };
      }
      const r = stmt.run(...(params as never[]));
      return { toArray: () => [], one: () => ({}), rowsWritten: Number(r.changes) };
    },
  };
}

export type Reply = { status: number; body: Record<string, unknown> };
/** One chunk of a run as the page sends it: its events, the run's clock at its end, and its game time (ms). */
export type Chunk = { e: unknown[]; t: unknown; ms: number };

export function rankedWorker(env: Record<string, unknown> = {}) {
  const realNow = Date.now;
  const realRandom = crypto.getRandomValues.bind(crypto);
  const db = new DatabaseSync(':memory:');
  let n = 0;
  // (the seeds the Worker picks are the same every time, so a test flies the same courses)
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array) for (let i = 0; i < array.length; i++) array[i] = (++n * 2_654_435_761) >>> 0;
    else return realRandom(array as never) as T;
    return array;
  }) as typeof crypto.getRandomValues;
  const storage = () => ({
    sql: sqlStorage(db),
    async setAlarm(at: number) {
      w.alarm = at;
    },
    async getAlarm() {
      return w.alarm;
    },
  });
  const w = {
    clock: 1_800_000_000_000,
    db,
    boards: new Boards({ storage: storage() }, env),
    /** When the object's alarm is set for (the Worker's clock), or null. */
    alarm: null as number | null,
    /** A fresh Boards object on the same storage (the Durable Object restarted), with `env` (secrets). */
    restart(next: Record<string, unknown> = env) {
      w.boards = new Boards({ storage: storage() }, next);
    },
    /** Moves the clock to the alarm and lets it go off, as the runtime does. */
    async ring() {
      if (w.alarm === null) throw new Error('no alarm set');
      w.clock = Math.max(w.clock, w.alarm);
      w.alarm = null;
      await (w.boards as unknown as { alarm(): Promise<void> }).alarm();
    },
    async call(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
      const res = await w.boards.fetch(new Request(`https://arcade.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers }, body: JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    async open(game: string) {
      const r = await w.call('/runs', { game });
      if (r.status !== 200) throw new Error(`could not open a ${game} run: ${JSON.stringify(r.body)}`);
      return { run: r.body.run as string, seed: r.body.seed as number };
    },
    /**
     * Plays a run's chunks to the Worker, the clock moving on to each chunk's game time (times `pace`, plus `lag` ms),
     * finishing with `score`. The last reply, and how many chunks went in before it.
     */
    async play(run: string, chunks: Chunk[], score: number, opts: { pace?: number; lag?: number } = {}) {
      const start = w.clock;
      let last: Reply = { status: 0, body: {} };
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        w.clock = start + Math.round(c.ms * (opts.pace ?? 1)) + (opts.lag ?? 50);
        const finish = i === chunks.length - 1;
        last = await w.call(finish ? '/runs/finish' : '/runs/feed', { run, n: i, e: c.e, t: c.t, ...(finish ? { score } : {}) });
        if (last.status !== 200) return { ...last, at: i };
      }
      return { ...last, at: chunks.length };
    },
    submit(game: string, score: number, run?: string, name = 'Tester') {
      return w.call('/leaderboard', run ? { game, name, score, run } : { game, name, score });
    },
    async board(game: string) {
      return ((await (await w.boards.fetch(new Request(`https://arcade.test/leaderboard?game=${encodeURIComponent(game)}`))).json()) as { entries: { name: string; score: number }[] }).entries;
    },
    restore() {
      Date.now = realNow;
      crypto.getRandomValues = realRandom as typeof crypto.getRandomValues;
    },
  };
  Date.now = () => w.clock;
  return w;
}

/** Cuts a run's recorded events into chunks the way RankedRun does: every FEED_MS of the run's own game time. */
export function chunked(events: { at: number; ms: number; e?: unknown }[], clockOf: (at: number) => unknown = (at) => at): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: unknown[] = [];
  let since = 0;
  let lastMs = 0;
  for (const ev of events) {
    if (ev.e !== undefined) cur.push(ev.e);
    since += ev.ms - lastMs;
    lastMs = ev.ms;
    if (since >= FEED_MS) {
      chunks.push({ e: cur, t: clockOf(ev.at), ms: ev.ms });
      cur = [];
      since = 0;
    }
  }
  const end = events[events.length - 1];
  chunks.push({ e: cur, t: clockOf(end?.at ?? 0), ms: end?.ms ?? 0 });
  return chunks;
}
