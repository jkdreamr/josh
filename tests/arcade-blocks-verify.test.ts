// Blocks' ranked runs (see games/blocks/verify.ts): games recorded the way the page records them, at several frame
// rates, replay to the same score on the Worker's verifier, and the Worker takes their scores once; scores the run
// didn't reach, runs played too fast or too slow, and edited or borrowed moves are refused.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { loopSteps } from '../src/os/arcade/kit/loop-core.ts';
import {
  advance, cellsFor, collides, createGame, dragDown, hardDrop, HEIGHT, holdPiece, move, rotate, runRandom, STEP, WIDTH, type ActivePiece,
  type Board, type BlocksGame,
} from '../src/os/arcade/games/blocks/logic.ts';
import { MAX_CHUNK_EVENTS, MAX_CHUNK_TICKS, verifier } from '../src/os/arcade/games/blocks/verify.ts';
import { FEED_MS, paceError } from '../src/os/arcade/verify/protocol.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS } from '../worker/src/specs.gen.ts';
import { rankedWorker, type Chunk } from './ranked-harness.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

/** How good a spot is for a piece, by the usual stacking measures (height, holes, bumps, lines). */
function worth(board: Board, piece: ActivePiece): number {
  const b = board.map((row) => [...row]);
  for (const [dx, dy] of cellsFor(piece.type, piece.rotation)) b[piece.y + dy][piece.x + dx] = piece.type;
  const kept = b.filter((row) => row.some((c) => c === null));
  const lines = HEIGHT - kept.length;
  while (kept.length < HEIGHT) kept.unshift(Array(WIDTH).fill(null));
  let height = 0;
  let holes = 0;
  let bumps = 0;
  let prev = -1;
  for (let x = 0; x < WIDTH; x++) {
    let top = kept.findIndex((row) => row[x] !== null);
    if (top < 0) top = HEIGHT;
    for (let y = top + 1; y < HEIGHT; y++) if (kept[y][x] === null) holes++;
    const h = HEIGHT - top;
    height += h;
    if (prev >= 0) bumps += Math.abs(h - prev);
    prev = h;
  }
  return -0.51 * height + 0.76 * lines - 0.36 * holes - 0.18 * bumps;
}

/** Where the bot puts the falling piece: the best rotation and column, by worth. */
function plan(g: BlocksGame): { rot: number; x: number } {
  const a = g.active!;
  let best = { rot: a.rotation, x: a.x, v: -Infinity };
  for (let rot = 0; rot < (a.type === 'O' ? 1 : 4); rot++) {
    for (let x = -3; x <= WIDTH; x++) {
      const p = { ...a, rotation: rot, x };
      if (collides(g.board, p)) continue;
      while (!collides(g.board, { ...p, y: p.y + 1 })) p.y++;
      const v = worth(g.board, p);
      if (v > best.v) best = { rot, x, v };
    }
  }
  return best;
}

type Played = { init: unknown; chunks: Chunk[]; score: number; ticks: number; events: unknown[] };

/**
 * Plays a game the way the page does, recording what took effect (stamped with the step it came before) and cutting
 * chunks every FEED_MS of play. A bot stacks `good` pieces well, using every kind of move, then drops the rest where
 * they spawn until the stack tops out. Frames come at about `hz` (jittered, with an occasional long one).
 */
function playBlocks(seed: number, opts: { hz?: number; good?: number } = {}): Played {
  const hz = opts.hz ?? 60;
  const good = opts.good ?? 150;
  const rand = runRandom(seed);
  const g = createGame(rand);
  const chunks: Chunk[] = [];
  const all: unknown[] = [];
  let events: unknown[] = [];
  const flush = () => {
    chunks.push({ e: events, t: g.ticks, ms: g.ticks * STEP * 1000 });
    events = [];
  };
  const record = (e: unknown[]) => {
    events.push(e);
    all.push(e);
    if (events.length >= 1_000) flush();
  };
  // what the page does with each input: only what takes effect is recorded
  const page = {
    shift: (dx: -1 | 1) => move(g, dx) && (record([g.ticks, dx < 0 ? 'l' : 'r']), true),
    turn: (dir: 1 | -1) => rotate(g, dir) && (record([g.ticks, dir === 1 ? 'cw' : 'ccw']), true),
    hold: () => holdPiece(g, rand) && (record([g.ticks, 'hold']), true),
    drag: () => dragDown(g) && (record([g.ticks, 'd']), true),
    drop: () => {
      if (!g.active || g.over) return;
      hardDrop(g, rand);
      record([g.ticks, 'drop']);
    },
  };
  let soft = false;
  let recordedSoft = false;
  let target: { rot: number; x: number } | null = null;
  let piece = -1;
  let drags = 0;
  let botClock = 0;
  let jitter = 12_345;
  let sinceFeed = 0;
  for (let frame = 0; frame < 2_000_000 && !g.over; frame++) {
    jitter = (jitter * 1_103_515_245 + 12_345) >>> 0;
    const long = frame % 173 === 172;
    const elapsed = long ? 0.3 : (1 / hz) * (0.8 + 0.4 * (jitter / 2 ** 32));
    for (const dt of loopSteps(frame === 0 ? 0 : elapsed, true)) {
      if (g.over) break;
      // the bot: an input every 45 ms or so, like quick fingers
      botClock += dt;
      const id = g.seq * 2 + (g.canHold ? 0 : 1);
      if (id !== piece) {
        piece = id;
        target = g.pieces < good ? plan(g) : null;
        soft = false;
        drags = 0;
      }
      while (botClock >= 0.045 && g.active && !g.over) {
        botClock -= 0.045;
        const n = g.pieces;
        if (!target) {
          page.drop();
          break;
        }
        const a = g.active;
        if (n % 9 === 4 && g.canHold) {
          page.hold();
          break;
        }
        if (a.rotation !== target.rot) {
          const ok = target.rot === 3 && a.rotation === 0 ? page.turn(-1) : page.turn(1);
          if (!ok) target.rot = a.rotation;
        } else if (a.x !== target.x) {
          if (!page.shift(a.x < target.x ? 1 : -1)) target.x = a.x;
        } else if (n % 5 === 2) {
          soft = true;
        } else if (n % 5 === 3 && drags < 3) {
          if (!page.drag()) drags = 3;
          drags++;
        } else {
          page.drop();
        }
        if (g.seq * 2 + (g.canHold ? 0 : 1) !== piece) break;
      }
      // the page's frame: the soft drop key's changes, then the rules in fixed steps
      if (soft !== recordedSoft) {
        recordedSoft = soft;
        record([g.ticks, 'soft', soft ? 1 : 0]);
      }
      advance(g, dt, soft, rand);
    }
    sinceFeed += elapsed * 1000;
    if (sinceFeed >= FEED_MS && !g.over) {
      flush();
      sinceFeed = 0;
    }
  }
  flush();
  return { init: { board: 'blocks' }, chunks, score: g.score, ticks: g.ticks, events: all };
}

/** Plays a recorded game through the verifier alone: its score, or why it was refused. */
function replay(seed: number, played: Pick<Played, 'init' | 'chunks'>): number | string {
  const begun = verifier.start(seed, played.init);
  if (typeof begun === 'string') return begun;
  for (const c of played.chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
    assert.equal(fed.ms, c.ms);
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : ended.score;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

test('blocks is checked, on its own board', () => {
  assert.equal(VERIFIERS.blocks, verifier);
  assert.equal(BOARD_OWNERS.blocks, 'blocks');
  assert.equal(typeof verifier.start(1, { board: 'blocks' }), 'object');
  assert.equal(verifier.partial, undefined);
});

test('a game recorded at any frame rate replays to the score the page showed', () => {
  const kinds = new Set<unknown>();
  for (const hz of [30, 60, 144]) {
    for (const seed of [7, 2_654_435_761]) {
      const played = playBlocks(seed, { hz });
      for (const e of played.events) kinds.add((e as unknown[])[1]);
      assert.ok(played.score > 1_000, `${hz} Hz: the bot only made ${played.score}`);
      assert.ok(played.chunks.length > 3, `${hz} Hz: only ${played.chunks.length} chunks`);
      assert.equal(replay(seed, played), played.score, `${hz} Hz, seed ${seed}`);
    }
  }
  assert.deepEqual([...kinds].sort(), ['ccw', 'cw', 'd', 'drop', 'hold', 'l', 'r', 'soft']);
});

test('an honest game, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('blocks');
  const played = playBlocks(seed);
  assert.equal((await w.call('/runs/start', { run, init: played.init })).status, 200);
  const done = await w.play(run, played.chunks, played.score);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal((await w.submit('blocks', played.score + 1, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('blocks', played.score, run)).status, 200);
  assert.deepEqual((await w.board('blocks')).map((e) => [e.name, e.score]), [['Tester', played.score]]);
  assert.equal((await w.submit('blocks', played.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or a score the game did not reach, is refused', async () => {
  assert.equal((await w.submit('blocks', 123_456)).status, 403);
  assert.equal((await w.submit('blocks', 123_456, 'not-a-run')).status, 403);
  const { run, seed } = await w.open('blocks');
  const played = playBlocks(seed);
  await w.call('/runs/start', { run, init: played.init });
  const claimed = await w.play(run, played.chunks, played.score + 100);
  assert.equal(claimed.status, 403);
  assert.equal(claimed.body.error, 'score does not replay');
  assert.equal((await w.submit('blocks', played.score + 100, run)).status, 403);
  assert.equal((await w.submit('blocks', played.score, run)).status, 403);
  assert.deepEqual(await w.board('blocks'), []);
});

test('a game that has not ended has no score', async () => {
  const { run, seed } = await w.open('blocks');
  const played = playBlocks(seed);
  await w.call('/runs/start', { run, init: played.init });
  const cut = await w.play(run, played.chunks.slice(0, 3), played.score);
  assert.equal(cut.status, 403);
  assert.equal(cut.body.error, 'still playing');
});

test('a game played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('blocks');
  const quick = playBlocks(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('blocks');
  const played = playBlocks(slow.seed);
  const ms = played.ticks * STEP * 1000;
  assert.ok(ms * 3 > ms * 1.15 + 90_000, `this game lasts only ${ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: played.init });
  const dragged = await w.play(slow.run, played.chunks, played.score, { pace: 3 });
  assert.equal(dragged.status, 403);
  assert.equal(dragged.body.error, 'too slow');
  assert.equal(paceError(ms, ms * 1.1 + 60_000, verifier.pace), null, 'a frame dropped and a pause or two is fine');
});

test("another seed's moves don't play this seed's pieces", async () => {
  const { run, seed } = await w.open('blocks');
  const other = playBlocks(seed + 1);
  await w.call('/runs/start', { run, init: other.init });
  const wrong = await w.play(run, other.chunks, other.score);
  assert.equal(wrong.status, 403);
  assert.notEqual(replay(seed, other), other.score);
});

test('edited moves are refused', () => {
  const seed = 99;
  const played = playBlocks(seed);
  assert.equal(replay(seed, played), played.score);
  const edits: [string, (p: Played) => void][] = [
    ['an extra hard drop', (p) => {
      const c = p.chunks[2];
      c.e.push([c.t, 'drop']);
    }],
    ['a move dropped', (p) => {
      const c = p.chunks[1];
      c.e.splice(c.e.findIndex((e) => (e as unknown[])[1] === 'drop'), 1);
    }],
    ['a turn made the other way', (p) => {
      const e = p.chunks[1].e.find((x) => (x as unknown[])[1] === 'cw') as unknown[];
      e[1] = 'ccw';
    }],
    ['a move put off', (p) => {
      const e = p.chunks[1].e.find((x) => (x as unknown[])[1] === 'drop') as number[];
      e[0] += 30;
    }],
    ['the soft drop held twice', (p) => {
      const c = p.chunks[1];
      const i = c.e.findIndex((x) => (x as unknown[])[1] === 'soft' && (x as unknown[])[2] === 1);
      c.e.splice(i + 1, 0, [(c.e[i] as number[])[0], 'soft', 1]);
    }],
    ['the clock run on past the end', (p) => {
      p.chunks[p.chunks.length - 1].t = (p.chunks[p.chunks.length - 1].t as number) + 50;
    }],
    ['a move after the game ended', (p) => {
      const c = p.chunks[p.chunks.length - 1];
      c.e.push([c.t, 'l']);
    }],
  ];
  for (const [what, edit] of edits) {
    const p = clone(played);
    edit(p);
    // (the last chunk's ms is the page's own; an edited clock's ms isn't checked here)
    const got = (() => {
      const begun = verifier.start(seed, p.init);
      if (typeof begun === 'string') return begun;
      for (const c of p.chunks) {
        const fed = verifier.feed(begun.state, c.e, c.t);
        if (typeof fed === 'string') return fed;
      }
      const ended = verifier.end(begun.state);
      return typeof ended === 'string' ? ended : ended.score;
    })();
    assert.ok(typeof got === 'string' || got !== played.score, `${what}: replayed to ${got}`);
  }
});

test('starts and chunks that are not from the game are refused', async () => {
  for (const init of [undefined, null, {}, { board: 'flappy' }, { board: 'blocks', level: 9 }, ['blocks'], 'blocks']) {
    assert.equal(typeof verifier.start(1, init), 'string', JSON.stringify(init));
  }
  const fresh = () => verifier.start(5, { board: 'blocks' }) as { state: Parameters<typeof verifier.feed>[0] };
  const bad: [unknown, unknown][] = [
    ['moves', 10],
    [[], -1],
    [[], 1.5],
    [[], MAX_CHUNK_TICKS + 1],
    [[[11, 'l']], 10],
    [[[5, 'l'], [3, 'r']], 10],
    [[[5, 'jump']], 10],
    [[[5]], 10],
    [[[5, 'l', 1]], 10],
    [[[5, 'soft']], 10],
    [[[5, 'soft', 2]], 10],
    [[[5, 'soft', 0]], 10],
    [[['5', 'l']], 10],
    [[[5, 'hold'], [6, 'hold']], 10],
    [Array.from({ length: MAX_CHUNK_EVENTS + 1 }, () => [0, 'cw']), 10],
    [Array.from({ length: 40 }, () => [0, 'drop']), 10],
  ];
  for (const [e, t] of bad) assert.equal(typeof verifier.feed(fresh().state, e, t), 'string', JSON.stringify([e, t]).slice(0, 80));
  // (the same moves at the right steps are fine)
  assert.deepEqual(verifier.feed(fresh().state, [[5, 'l'], [5, 'r'], [6, 'soft', 1], [9, 'hold']], 10), { ms: 10 * STEP * 1000 });

  const { run } = await w.open('blocks');
  assert.equal((await w.call('/runs/start', { run, init: { board: 'flappy' } })).status, 403, 'another game’s board');
  const ok = await w.open('blocks');
  await w.call('/runs/start', { run: ok.run, init: { board: 'blocks' } });
  w.clock += 1_000;
  assert.equal((await w.call('/runs/feed', { run: ok.run, n: 0, e: [[0, 'teleport']], t: 10 })).status, 403);
});

test('a blocks run only counts on the blocks board', async () => {
  const { run, seed } = await w.open('blocks');
  const played = playBlocks(seed);
  await w.call('/runs/start', { run, init: played.init });
  assert.equal((await w.play(run, played.chunks, played.score)).status, 200);
  assert.notEqual((await w.submit('flappy', played.score, run)).status, 200);
  assert.notEqual((await w.submit('flappy', 42, run)).status, 200);
  assert.equal((await w.submit('blocks', played.score, run)).status, 200);
  // and another game's checked run doesn't count here
  w.db.prepare('INSERT INTO ranked_runs (id, game, seed, issued, started, finished, board, score, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run('flown', 'flappy', 1, w.clock, w.clock, w.clock, 'flappy', 42);
  assert.equal((await w.submit('blocks', 42, 'flown')).status, 403);
  assert.equal((await w.submit('flappy', 42, 'flown')).status, 200);
});
